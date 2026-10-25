"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Reassembler, chunkMessage } from "@/lib/jamWire.js";
import styles from "@/app/ui.module.css";

// A jam: several studios holding one song, editing it together, live.
//
// This is the ROOM: who is in it, the connection, the invite link. What an
// edit is, and how a peer's edit is written onto a running sequencer, is the
// engine's (public/js/jam.js), reached through `window.seqbaby.jam`. The split
// is deliberate and the same one the compose panel makes: the engine knows
// nothing about the transport, and this file knows nothing about sessions
// beyond "a message came in, hand it over".
//
// The room is a Durable Object (workers/jamRoom.ts) reached over a WebSocket
// at /api/jam/<room>: it relays every message to the other members and tells
// everyone who is here whenever that changes. A room id is an unguessable
// string in `?jam=<id>`, and anyone with the link can join: the same trust
// model as a share link, and for the same reason -- the point of it is to send
// it to someone.
//
// **Joining takes the room's session.** A newcomer asks the member who has
// been here longest for the whole song, and until it arrives their own edits
// go nowhere: a session they were about to replace is not one the room needs
// to hear about. Nobody answering (an empty room, or a link whose host has
// gone) leaves them with what they have, which then becomes the room's song
// for the next person to arrive. Whoever STARTS a jam is simply the first
// member, with no other status: the room outlives them.
//
// **A refused patch is a resync, not a corruption.** The engine refuses a peer's
// patch when its copy is not the one the patch was written against (a track
// removed under it, say -- see jamSync.js), and the answer is to ask that peer
// for the whole session. One outstanding ask at a time: a burst of refusals
// while a resync is in flight is the same problem, not several.

/** A message on the wire, once its parts are back together. */
type Wire =
  | { type: "hello"; from: string; to: string }
  | { type: "need-state"; from: string; to: string }
  | { type: "state"; from: string; to: string; session: unknown }
  | { type: "patch"; from: string; patch: unknown }
  | { type: "playhead"; from: string; originMs: number; bpm: number };

/** A message as this studio sends it: `from` is stamped on the way out. A
 *  plain Omit over the union would keep only the keys every member shares. */
type Outgoing = { [K in Wire["type"]]: Omit<Extract<Wire, { type: K }>, "from"> }[Wire["type"]];

type Peer = { id: string; name: string; color: string; joinedAt: number };
/** What the room sends: another member's message part, or who is here. */
type RoomFrame = { t: "msg"; part: unknown } | { t: "presence"; peers: Peer[] };

type Status =
  | "idle"
  | "connecting"
  | "syncing" // in the room, waiting for its session
  | "live"
  | "error";

const ROOM_PARAM = "jam";
/** Who sent the invite, on the link: the card a pasted link gets is built by
 *  studio/page.tsx's generateMetadata, and a room has no record anywhere of who
 *  started it -- so the link carries the host's handle, and the server checks
 *  it against the profiles before naming anyone. See jamHostName. */
const BY_PARAM = "by";
const NAME_KEY = "seqbaby.jamName.v1";
/** How long a newcomer waits for the room's session before keeping their own. */
const SYNC_WAIT_MS = 8000;
/** A dropped connection is retried after this, doubling to RETRY_MAX_MS. */
const RETRY_MS = 1000;
const RETRY_MAX_MS = 15000;
/** Keepalive: the room answers "ping" without waking (workers/jamRoom.ts). */
const PING_MS = 25000;

/** A socket to the room, plus what it needs to reconnect. */
type Conn = { ws: WebSocket | null; room: string; closed: boolean; retry: number; timer: ReturnType<typeof setTimeout> | null; ping: ReturnType<typeof setInterval> | null };

const randomId = (n = 12) => {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  // base64url without padding: short, and safe in a query string.
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

/** A colour per member, from their id, so the same person is the same colour
 *  on every screen without anyone having to agree on it. */
function colorFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 70% 62%)`;
}

function roomFromUrl(): string | null {
  try {
    return new URLSearchParams(location.search).get(ROOM_PARAM);
  } catch {
    return null;
  }
}

// The address bar is a link too -- a signed-in member who copies it straight
// from there (or a browser's own share sheet) instead of the panel's `copy
// link` button should still hand the next reader a card that names them, so
// this carries `by=` exactly as that button's own link does.
function writeRoomToUrl(room: string | null, by: string | null) {
  try {
    const url = new URL(location.href);
    if (room) {
      url.searchParams.set(ROOM_PARAM, room);
      if (by) url.searchParams.set(BY_PARAM, by);
      else url.searchParams.delete(BY_PARAM);
    } else {
      url.searchParams.delete(ROOM_PARAM);
      // The handle rode in on the invite; out of the room it names nobody.
      url.searchParams.delete(BY_PARAM);
    }
    history.replaceState({}, "", url.toString());
  } catch {
    /* a URL we cannot rewrite is still a room we can be in */
  }
}

export default function JamPanel({
  accountName,
  accountUsername = null,
}: {
  accountName: string | null;
  /** The account's handle, for the invite link's `by=`. A guest's typed name
   *  is not put on the link: it cannot be checked, and a card will only name
   *  someone the profiles know. */
  accountUsername?: string | null;
}) {
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [room, setRoom] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const [peers, setPeers] = useState<Peer[]>([]);
  const [name, setName] = useState("");
  const [copied, setCopied] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const connRef = useRef<Conn | null>(null);
  const meRef = useRef<string>("");
  const nameRef = useRef<string>("");
  const reasmRef = useRef(new Reassembler());
  // Waiting for the room's session: edits go nowhere until it arrives.
  const waitingRef = useRef(false);
  const waitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Who we have asked for a whole session and not yet heard back from.
  const askedRef = useRef<string | null>(null);
  const peersRef = useRef<Peer[]>([]);

  if (!meRef.current && typeof window !== "undefined") meRef.current = randomId(9);

  useEffect(() => {
    if (window.seqbaby) setReady(true);
    else {
      const onReady = () => setReady(true);
      window.addEventListener("seqbaby:ready", onReady);
      return () => window.removeEventListener("seqbaby:ready", onReady);
    }
  }, []);

  // The name: what the account says, or what was typed last time, or nothing
  // yet (the field's placeholder then names a guest).
  useEffect(() => {
    let stored = "";
    try {
      stored = window.localStorage.getItem(NAME_KEY) || "";
    } catch {
      /* fine */
    }
    const n = stored || accountName || "";
    setName(n);
    nameRef.current = n;
  }, [accountName]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const displayName = useCallback(() => nameRef.current.trim() || `guest ${meRef.current.slice(0, 4)}`, []);

  const send = useCallback((msg: Outgoing) => {
    const ws = connRef.current?.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    // In parts, because the transport caps a frame and a whole session with
    // samples in it is well over the cap; one part for a knob turn.
    for (const part of chunkMessage({ ...msg, from: meRef.current })) {
      ws.send(JSON.stringify({ t: "msg", part }));
    }
  }, []);

  /** Tell the room who this member is (on every connect, and after a rename). */
  const sendPresence = useCallback((joinedAt: number) => {
    const ws = connRef.current?.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ t: "join", id: meRef.current, name: displayName(), color: colorFor(meRef.current), joinedAt }));
  }, [displayName]);

  const peerName = useCallback((id: string) => peersRef.current.find((p) => p.id === id)?.name || "someone", []);

  const leave = useCallback(() => {
    const conn = connRef.current;
    connRef.current = null;
    if (waitTimerRef.current) clearTimeout(waitTimerRef.current);
    waitTimerRef.current = null;
    waitingRef.current = false;
    askedRef.current = null;
    window.seqbaby?.jam?.stop();
    if (conn) {
      conn.closed = true;
      if (conn.timer) clearTimeout(conn.timer);
      if (conn.ping) clearInterval(conn.ping);
      try {
        conn.ws?.close(1000, "left");
      } catch {
        /* already closed */
      }
    }
    setRoom(null);
    setPeers([]);
    peersRef.current = [];
    setStatus("idle");
    setError("");
    writeRoomToUrl(null, null);
  }, []);

  /** The room's session has arrived (or nobody had one): start sending edits.
   *  `leave` rides along so the engine can hand the room back the moment a
   *  different song arrives locally -- opening one is not an edit to this
   *  song, see jam.js's onSessionArrived. */
  const goLive = useCallback(
    (session: unknown | null, from: string | null) => {
      if (waitTimerRef.current) clearTimeout(waitTimerRef.current);
      waitTimerRef.current = null;
      waitingRef.current = false;
      const api = window.seqbaby;
      if (!api?.jam) return;
      api.jam.start({ send: (m) => send(m), leave });
      if (session && from) api.jam.receiveState(session, { name: peerName(from), id: from });
      setStatus("live");
    },
    [send, peerName, leave],
  );

  const onWire = useCallback(
    (msg: Wire) => {
      const me = meRef.current;
      const api = window.seqbaby;
      if (!api?.jam || !msg || msg.from === me) return;
      if ("to" in msg && msg.to !== me) return;
      switch (msg.type) {
        case "hello":
        case "need-state": {
          // Someone wants the whole song. Only a member who is live has one to
          // give: a newcomer still waiting on theirs would hand over the blank
          // session they are about to replace.
          if (waitingRef.current) return;
          send({ type: "state", to: msg.from, session: api.jam.state() });
          return;
        }
        case "state": {
          if (waitingRef.current) {
            goLive(msg.session, msg.from);
          } else if (askedRef.current === msg.from) {
            askedRef.current = null;
            api.jam.receiveState(msg.session, { name: peerName(msg.from), id: msg.from });
          }
          return;
        }
        case "patch": {
          if (waitingRef.current) return; // the session on its way covers this
          const r = api.jam.receivePatch(msg.patch, { name: peerName(msg.from), id: msg.from });
          if (!r.ok && !askedRef.current) {
            askedRef.current = msg.from;
            send({ type: "need-state", to: msg.from });
          }
          return;
        }
        case "playhead": {
          // A newcomer isn't live yet — the room's own session (and its own
          // sense of where the beat is) hasn't arrived to land this on.
          if (waitingRef.current) return;
          api.jam.receivePhase(msg.originMs, msg.bpm);
          return;
        }
      }
    },
    [send, goLive, peerName],
  );

  /**
   * Join a room. `first` is the member who started it, who has nobody to ask
   * for the song and goes live at once; everyone else asks the longest-present
   * member and waits.
   */
  const join = useCallback(
    (roomId: string, first: boolean) => {
      if (connRef.current) leave();
      setRoom(roomId);
      setStatus("connecting");
      setError("");
      writeRoomToUrl(roomId, accountUsername);

      const me = meRef.current;
      const conn: Conn = { ws: null, room: roomId, closed: false, retry: RETRY_MS, timer: null, ping: null };
      connRef.current = conn;
      const reasm = reasmRef.current;
      let askedForSong = false;
      // The same joinedAt across reconnects, so a blip does not move this
      // member down the list.
      const joinedAt = Date.now();

      const onPresence = (list: Peer[]) => {
        const peers = list
          .map((p) => ({ ...p, name: p.name || "guest", color: p.color || colorFor(p.id) }))
          .sort((a, b) => a.joinedAt - b.joinedAt);
        peersRef.current = peers;
        setPeers(peers);
        // The first presence is where a newcomer finds out who to ask. The
        // longest-present member has the song; an empty room means the song
        // is ours.
        if (!first && !askedForSong) {
          askedForSong = true;
          const other = peers.find((p) => p.id !== me);
          if (other) {
            waitingRef.current = true;
            setStatus("syncing");
            send({ type: "hello", to: other.id });
            waitTimerRef.current = setTimeout(() => {
              if (connRef.current === conn && waitingRef.current) goLive(null, null);
            }, SYNC_WAIT_MS);
          } else {
            goLive(null, null);
          }
        }
      };

      const connect = () => {
        if (conn.closed) return;
        const proto = location.protocol === "https:" ? "wss:" : "ws:";
        const ws = new WebSocket(`${proto}//${location.host}/api/jam/${encodeURIComponent(roomId)}`);
        conn.ws = ws;
        ws.onopen = () => {
          if (connRef.current !== conn) return ws.close();
          conn.retry = RETRY_MS;
          sendPresence(joinedAt);
          if (conn.ping) clearInterval(conn.ping);
          conn.ping = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send("ping"), PING_MS);
          setError("");
          if (first) goLive(null, null);
          else setStatus((s) => (s === "error" || s === "connecting" ? (waitingRef.current ? "syncing" : askedForSong ? "live" : "connecting") : s));
        };
        ws.onmessage = (ev) => {
          if (connRef.current !== conn || typeof ev.data !== "string" || ev.data === "pong") return;
          let frame: RoomFrame;
          try {
            frame = JSON.parse(ev.data);
          } catch {
            return;
          }
          if (frame.t === "presence") onPresence(frame.peers ?? []);
          else if (frame.t === "msg") {
            const msg = reasm.push(frame.part as Parameters<Reassembler["push"]>[0]) as Wire | undefined;
            if (msg) onWire(msg);
          }
        };
        ws.onclose = (ev) => {
          if (conn.ping) clearInterval(conn.ping);
          conn.ping = null;
          if (conn.closed || connRef.current !== conn) return;
          // 4000: this member connected again elsewhere (a second tab took the
          // same id); nothing to retry.
          if (ev.code === 4000) return;
          // Not fatal: retried with backoff, and onopen clears this. The room
          // is kept so `leave` is still on offer, and so a blip does not throw
          // the jam away.
          setStatus("error");
          setError(ev.code === 1006 || ev.code === 1001 ? "lost the connection to the room; retrying." : `could not reach the room (${ev.code}); retrying.`);
          conn.timer = setTimeout(connect, conn.retry);
          conn.retry = Math.min(conn.retry * 2, RETRY_MAX_MS);
        };
      };
      connect();
    },
    [leave, onWire, send, sendPresence, goLive, accountUsername],
  );

  // A link with a room in it: join on arrival, once the engine can take the
  // song. The URL keeps the room, so a reload rejoins.
  useEffect(() => {
    if (!ready) return;
    const r = roomFromUrl();
    if (r && !connRef.current) join(r, false);
    // Only on becoming ready: `join` is stable for the life of the panel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // Leaving the page leaves the room: the socket closing is what takes a
  // member off everyone's list.
  useEffect(() => {
    const onHide = (e: PageTransitionEvent) => {
      if (e.persisted) return; // into the back/forward cache; it may come back
      const conn = connRef.current;
      if (conn) {
        conn.closed = true;
        conn.ws?.close(1000, "page closed");
      }
    };
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, []);

  const start = useCallback(() => join(randomId(), true), [join]);

  const commitName = useCallback(() => {
    const n = name.trim();
    nameRef.current = n;
    try {
      if (n) window.localStorage.setItem(NAME_KEY, n);
      else window.localStorage.removeItem(NAME_KEY);
    } catch {
      /* fine */
    }
    sendPresence(peersRef.current.find((p) => p.id === meRef.current)?.joinedAt || Date.now());
  }, [name, sendPresence]);

  // Whoever copies the link is the one sharing the jam, so it carries THIS
  // member's handle, not the room starter's -- a joiner passing it on is the
  // person the next reader knows.
  const link = room
    ? `${location.origin}${location.pathname}?${ROOM_PARAM}=${room}` +
      (accountUsername ? `&${BY_PARAM}=${encodeURIComponent(accountUsername)}` : "")
    : "";

  const copyLink = useCallback(async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* the field is selectable; the button is a convenience */
    }
  }, [link]);

  if (!ready) return null;

  const inRoom = !!room;
  const others = peers.filter((p) => p.id !== meRef.current);
  const btnTitle = inRoom
    ? status === "syncing"
      ? "joining: taking the room's song"
      : status === "error"
        ? "jam: connection trouble"
        : `jamming with ${others.length} other${others.length === 1 ? "" : "s"}`
    : "edit this song with other people, live";

  return (
    <div className={`${styles.songsWrap} sq-jam-ignore`} ref={wrapRef}>
      <button
        className={`${styles.accountBtn} ${inRoom ? styles.jamBtnLive : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title={btnTitle}
      >
        jam{inRoom ? ` · ${peers.length}` : ""}
      </button>
      {open && (
        <div className={`${styles.panel} ${styles.jamPanel}`}>
          <div className={styles.panelTitle}>{inRoom ? "jamming" : "jam with others"}</div>
          {!inRoom && (
            <div className={styles.jamIntro}>
              start a jam and send the link. everyone who opens it edits this song
              with you: steps, knobs, tracks, all of it, as it happens. press play
              whenever you like; you'll land on the same step as everyone else who
              has.
            </div>
          )}
          {error && <div className={styles.chatWarn}>{error}</div>}
          {inRoom && (
            <>
              <div className={styles.jamLinkRow}>
                <input
                  className={styles.saveInput}
                  value={link}
                  readOnly
                  onFocus={(e) => e.currentTarget.select()}
                  title="the invite link: anyone who opens it joins this jam"
                />
                <button className={`${styles.smallBtn} ${styles.smallBtnPrimary}`} onClick={copyLink}>
                  {copied ? "copied" : "copy"}
                </button>
              </div>
              <div className={styles.jamStatus}>
                {status === "connecting" && "connecting…"}
                {status === "syncing" && "taking the room's song…"}
                {status === "live" && (others.length === 0 ? "nobody else here yet. send the link." : "live")}
              </div>
              <ul className={styles.jamPeers}>
                {peers.map((p) => (
                  <li key={p.id} className={styles.jamPeer}>
                    <span className={styles.jamDot} style={{ background: p.color }} aria-hidden />
                    <span className={styles.jamPeerName}>{p.name}</span>
                    {p.id === meRef.current && <span className={styles.jamYou}>you</span>}
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className={styles.jamNameRow}>
            <label className={styles.chatModelLabel} htmlFor="jam-name">
              your name
            </label>
            <input
              id="jam-name"
              className={styles.saveInput}
              value={name}
              placeholder={`guest ${meRef.current.slice(0, 4)}`}
              maxLength={40}
              onChange={(e) => setName(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
              }}
            />
          </div>
          <div className={styles.jamActions}>
            {inRoom ? (
              <button className={styles.smallBtn} onClick={leave} title="leave the jam; the song stays with you">
                leave
              </button>
            ) : (
              <button
                className={`${styles.smallBtn} ${styles.smallBtnPrimary}`}
                onClick={start}
                title="start a jam from this song"
              >
                start a jam
              </button>
            )}
          </div>
          {inRoom && (
            <div className={styles.jamNote}>
              anyone with the link can join. leaving keeps the song as it is on your
              screen; the room carries on without you. undo steps back over the
              others&apos; edits too: there is one song.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
