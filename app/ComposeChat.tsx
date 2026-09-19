"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { getOpenSong, subscribeOpenSong } from "@/app/songs/openSong";
import { loadSongChat, saveSongChat } from "@/app/songs/actions";
import { COMPOSE_MODELS, DEFAULT_COMPOSE_MODEL, composeModelLabel, isComposeModel } from "@/lib/composeModels.js";
import { API_KEY_CONSOLE_URL, looksLikeApiKey, maskApiKey } from "@/lib/composeKey.js";
import { formatInviteCode, looksLikeInviteCode, normalizeInviteCode } from "@/lib/composeInvite.js";
import styles from "@/app/ui.module.css";

type Msg =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; model?: string; activity?: string[]; warnings?: string[] }
  | { role: "error"; text: string };

type ComposeResponse = {
  jobId?: string;
  jobToken?: string;
  error?: string;
  /** Turns left on the invite code this turn was let in on, once it has been
   *  spent. Null means the code is uncapped, absent means no code was used. */
  inviteRemaining?: number | null;
};

/**
 * A turn's changes, sitting between the model and the studio.
 *
 * A turn used to be written straight into the session with `applySet`, which
 * stops the transport and rebuilds every voice — so asking for a hi-hat while
 * a track was playing stopped the track. `mergeSet` (public/js/liveSet.js)
 * writes the same session onto the engine without stopping it, which is what
 * makes an audition possible at all: the new track joins on the step everyone
 * else is on, and everything already playing goes on playing.
 *
 * `before` is what was playing when the audition started, kept so stopping one
 * is the same operation in reverse. Null means the changes are not in the
 * session at all yet.
 */
type Proposal = { session: unknown; before: unknown | null };

type JobStatus = {
  status?: "running" | "done" | "error";
  events?: { type: string; summary?: string }[];
  reply?: string;
  /** Which model ran the turn. Absent on a record written before the panel
   *  could ask for one, which is why the transcript prints it only when it
   *  is there. */
  model?: string;
  session?: unknown;
  /** Whether the turn actually altered the song. False for a question, or for
   *  edits that cancelled out. Absent on a record written before this existed,
   *  which is why the check below is `!== false` rather than truthiness. */
  changed?: boolean;
  warnings?: string[];
  error?: string;
};

// How long to keep polling before giving up on a worker that has gone quiet.
// The worker's own ceiling is 15 minutes, so this sits just past it rather
// than cutting off a song that is still being written.
const POLL_INTERVAL_MS = 1500;
const POLL_LIMIT_MS = 16 * 60 * 1000;
// Consecutive polls that couldn't get an answer at all before giving up: at
// the interval above, roughly half a minute of no contact.
const MAX_POLL_MISSES = 20;

// Where the picked model is remembered. Per browser, not per song and not on
// the server: it is a preference about how you want to work, and a song opened
// on another machine has no business changing which model that one spends its
// turns on.
const MODEL_KEY = "seqbaby.composeModel.v1";

// The visitor's own Anthropic key, and which key they compose on. Both are
// per browser for the model preference's reasons, and the key for a stronger
// one: it is a secret, and the one place it is meant to live is the machine
// its owner typed it into. The server never stores it (see lib/composeKey.js)
// -- it rides each message, is spent, and is gone.
//
// localStorage is the honest trade here and worth naming: it survives a
// reload, which is what makes the feature usable at all, and it is readable
// by anything that gets script into this origin. Hence `remember`, which is
// the visitor's to turn off -- unchecked, the key lives in this tab's memory
// and nowhere else.
const KEY_STORE = "seqbaby.anthropicKey.v1";
const KEY_MODE = "seqbaby.composeKeyMode.v1";

// An invite code, kept for the same reason and with less to weigh: unlike a
// key it is worth a fixed number of turns on this site and nothing anywhere
// else, so it is simply remembered rather than offered a choice about it --
// the alternative is retyping it every visit, which is most of the way back
// to the signup this exists to avoid. `forget` is the way out.
const INVITE_STORE = "seqbaby.composeInvite.v1";

/** Which ways of paying for a turn this visitor has. Ordered: whichever is
 *  first is what a browser with nothing stored starts on. */
type KeyMode = "site" | "invite" | "own";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** What to say when the response wasn't the route's own JSON. */
function describeFailure(status: number, raw: string, data: ComposeResponse | null): string {
  if (data?.error) return data.error;
  // 502/504 with an HTML body is the hosting layer, not the route: nothing
  // the route says ever gets this far, so the status is all there is to go on.
  if (status === 504 || status === 408) {
    return `that took too long and the server cut it off (${status}). A big request can run past the hosting timeout — try asking for one change at a time.`;
  }
  if (status === 502 || status === 503) {
    return `the server couldn't complete the request (${status}) — it may have run too long or run out of memory.`;
  }
  const snippet = raw.trim().slice(0, 160);
  if (snippet.startsWith("<")) return `the server returned a ${status} page instead of a reply.`;
  return snippet || `the server returned ${status} with an empty reply.`;
}

// A chat panel that edits the song open in the studio, backed by
// app/api/compose (the same songBuilder tools the MCP server exposes to an
// external agent, run server-side against an Anthropic key).
//
// WHOSE key is the panel's other choice, beside the model. The site's needs an
// account and is rationed; the visitor's own needs nothing at all, which is
// why this panel is shown to a signed-out visitor as well -- a key of your own
// is the one way to compose here without one.
//
// The SONG's state is not kept here -- the studio's own session is the source
// of truth (serializeSet) and each message resends it, so a change made by hand
// between messages is what the next one edits. The one thing held is a turn's
// RESULT, until it is auditioned or kept (see `Proposal`): a session is what
// the model hands back, and it is a snapshot of the one it was given, so a
// change made by hand while a turn was in flight is not in it -- keeping the
// turn drops that change, exactly as writing it straight in always did.
//
// The CONVERSATION is kept, attached to the song (song_chats, migration 0011):
// it is the record of how a song came to sound the way it does, and coming
// back to one a week later used to mean re-explaining it from scratch. It
// follows whichever song is open, which is why this reads the same open-song
// store the save and songs menus do.
/**
 * @param signedIn whether there is an account behind this panel at all.
 * @param serverKey whether this deploy has an Anthropic key of its own. The
 *        two together decide whether composing on the SITE's key is offered;
 *        a visitor's own key is offered always, which is what makes the panel
 *        worth showing to someone signed out.
 */
export default function ComposeChat({ signedIn, serverKey }: { signedIn: boolean; serverKey: boolean }) {
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  // Which model the NEXT message goes to. It sticks until changed, so a
  // conversation can be worked through on the fast one and handed to the
  // careful one for the arrangement, but nothing about it is retroactive:
  // every message carries whichever was picked when it was sent.
  const [model, setModel] = useState<string>(DEFAULT_COMPOSE_MODEL);
  // What the turn IN FLIGHT went to. The dropdown stays live while one runs
  // -- picking the next message's model is exactly the sort of thing you do
  // while waiting -- so the running line can't read the current selection.
  const [sendingModel, setSendingModel] = useState<string>("");
  // Tool activity for the turn in flight, filled in as it happens. It moves
  // onto the finished message when the turn lands.
  const [live, setLive] = useState<string[]>([]);
  // The turn's changes, waiting to be auditioned or kept. Nothing is written to
  // the studio until one of those is pressed.
  const [review, setReview] = useState<Proposal | null>(null);
  // Which key the next message runs on. "site" is only ever a choice when
  // there is both an account and a key on the deploy, so what is offered is
  // derived (`keyMode`) rather than trusted from storage.
  const [keyPref, setKeyPref] = useState<KeyMode>("site");
  // The visitor's own key, live. Empty means they haven't given one; what is
  // typed lives in `keyDraft` until it is accepted, so a half-typed key is
  // never what a message goes out on.
  const [apiKey, setApiKey] = useState("");
  const [keyDraft, setKeyDraft] = useState("");
  const [keyError, setKeyError] = useState("");
  const [remember, setRemember] = useState(true);
  const [editingKey, setEditingKey] = useState(false);
  // The invite code, once the server has said it is one. What is being typed
  // lives in `inviteDraft` until then, for the key field's reason: a
  // half-typed code is never what a message goes out on.
  const [invite, setInvite] = useState("");
  const [inviteDraft, setInviteDraft] = useState("");
  const [inviteError, setInviteError] = useState("");
  // What the code has left, as last reported -- by the check that accepted it
  // and by every turn it pays for. Null means uncapped; undefined means
  // nobody has said.
  const [inviteLeft, setInviteLeft] = useState<number | null | undefined>(undefined);
  const [checkingInvite, setCheckingInvite] = useState(false);
  const [editingInvite, setEditingInvite] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // Which song the transcript on screen belongs to. Null means it belongs to
  // no song yet -- the conversation that built a session nobody has saved --
  // which is what lets the first save adopt it instead of losing it.
  const attachedRef = useRef<string | null>(null);
  // The transcript, readable from an async callback without making every
  // message a reason to re-run the effect that loads one.
  const messagesRef = useRef<Msg[]>([]);
  // What this visitor may pay a turn with, in the order the panel offers
  // them. Composing on the site's key takes an account AND a key on the
  // deploy; an INVITE CODE takes the deploy's key and the absence of an
  // account, since someone signed in already has the thing a code buys and a
  // third option that adds nothing is just a third option. A key of your own
  // is offered always, which is what makes this panel worth showing to
  // someone signed out of a deploy with no key at all.
  const siteKeyOffered = signedIn && serverKey;
  const inviteOffered = serverKey && !signedIn;
  const modes: KeyMode[] = [
    ...(siteKeyOffered ? (["site"] as const) : []),
    ...(inviteOffered ? (["invite"] as const) : []),
    "own",
  ];
  // Derived rather than trusted from storage: what was picked last time may
  // not be on offer this time (signed out since, or the deploy's key went
  // away), and the first mode offered is the easiest one to start on.
  const keyMode: KeyMode = modes.includes(keyPref) ? keyPref : modes[0];
  const needsKey = keyMode === "own" && !apiKey;
  const needsInvite = keyMode === "invite" && !invite;
  // Nothing to run the next message on, whichever way it would be paid for.
  const unpaid = needsKey || needsInvite;
  const openSong = useSyncExternalStore(subscribeOpenSong, getOpenSong, getOpenSong);
  const songId = openSong.id;
  const isTemplate = openSong.isTemplate;

  // Read in an effect rather than in useState's initializer: this component
  // renders on the server too (it returns null until the engine says it is
  // ready), and a localStorage read there is a hydration mismatch waiting to
  // happen. A stored id that is no longer offered falls back to the default.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(MODEL_KEY);
      if (saved && isComposeModel(saved)) setModel(saved);
      const mode = window.localStorage.getItem(KEY_MODE);
      if (mode === "own" || mode === "site" || mode === "invite") setKeyPref(mode);
      // A stored code is taken at face value rather than re-checked on load:
      // it was checked when it was accepted, and what would change the answer
      // -- running out, being turned off -- is reported by the turn that finds
      // out, which is the only moment it matters.
      const code = window.localStorage.getItem(INVITE_STORE);
      if (code && looksLikeInviteCode(code)) setInvite(normalizeInviteCode(code));
      else if (code) window.localStorage.removeItem(INVITE_STORE);
      // A stored key that no longer looks like one (a truncated write, a
      // format that has moved on) is dropped rather than sent: it can only
      // fail, and it would fail a minute into a turn.
      const stored = window.localStorage.getItem(KEY_STORE);
      if (stored && looksLikeApiKey(stored)) {
        setApiKey(stored.trim());
      } else if (stored) {
        window.localStorage.removeItem(KEY_STORE);
      }
    } catch {
      /* private mode, blocked storage: the defaults are a fine answer */
    }
  }, []);

  const pickModel = useCallback((id: string) => {
    setModel(id);
    try {
      window.localStorage.setItem(MODEL_KEY, id);
    } catch {
      /* not worth failing a message over */
    }
  }, []);

  const pickKeyMode = useCallback((mode: KeyMode) => {
    setKeyPref(mode);
    try {
      window.localStorage.setItem(KEY_MODE, mode);
    } catch {
      /* not worth failing a message over */
    }
  }, []);

  // Accept what has been typed. Shape-checked here as well as in the route,
  // because the box the key was typed into is the only place a typo can be
  // fixed -- reported from a job, it arrives minutes later with the message
  // that prompted it already spent.
  const saveKey = useCallback(() => {
    const k = keyDraft.trim();
    if (!looksLikeApiKey(k)) {
      setKeyError("that doesn't look like an Anthropic API key — they start sk-ant-");
      return;
    }
    setApiKey(k);
    setKeyDraft("");
    setKeyError("");
    setEditingKey(false);
    try {
      if (remember) window.localStorage.setItem(KEY_STORE, k);
      else window.localStorage.removeItem(KEY_STORE);
    } catch {
      /* blocked storage: the key still works for this tab */
    }
  }, [keyDraft, remember]);

  const forgetKey = useCallback(() => {
    setApiKey("");
    setKeyDraft("");
    setKeyError("");
    setEditingKey(false);
    try {
      window.localStorage.removeItem(KEY_STORE);
    } catch {
      /* nothing stored is the state we wanted anyway */
    }
  }, []);

  // Try a code where it was typed. Shape first, so an obvious typo costs no
  // round trip; then the server, because only it knows whether this site
  // minted the code and whether it has anything left. Nothing is spent by
  // asking -- the turn is what spends one.
  const saveInvite = useCallback(async () => {
    const code = normalizeInviteCode(inviteDraft);
    if (!looksLikeInviteCode(code)) {
      setInviteError("that doesn't look like an invite code");
      return;
    }
    setCheckingInvite(true);
    setInviteError("");
    try {
      const res = await fetch("/api/compose/invite", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; remaining?: number | null; reason?: string }
        | null;
      if (!data?.ok) {
        setInviteError(data?.reason ?? "couldn't check that code just now");
        return;
      }
      setInvite(code);
      setInviteLeft(data.remaining ?? null);
      setInviteDraft("");
      setEditingInvite(false);
      try {
        window.localStorage.setItem(INVITE_STORE, code);
      } catch {
        /* blocked storage: the code still works for this tab */
      }
    } catch {
      setInviteError("couldn't reach the server to check that code");
    } finally {
      setCheckingInvite(false);
    }
  }, [inviteDraft]);

  const forgetInvite = useCallback(() => {
    setInvite("");
    setInviteDraft("");
    setInviteError("");
    setInviteLeft(undefined);
    setEditingInvite(false);
    try {
      window.localStorage.removeItem(INVITE_STORE);
    } catch {
      /* nothing stored is the state we wanted anyway */
    }
  }, []);

  useEffect(() => {
    if (window.seqbaby) {
      setReady(true);
      return;
    }
    const onReady = () => setReady(true);
    window.addEventListener("seqbaby:ready", onReady);
    return () => window.removeEventListener("seqbaby:ready", onReady);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [messages, sending, live]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // The conversation follows the song. Opening one brings its chat back;
  // opening a song that has none, or closing the last one, leaves a blank
  // panel rather than the previous song's transcript.
  //
  // A TEMPLATE is the exception, the same one the save field makes for a
  // template's name: what is open is a starting point, and the next save
  // detaches into a song of its own. Loading the template's conversation here
  // would put it in front of someone starting something new -- and then, on
  // that first save, write it into the new song as if it had been about it.
  // `new` goes through here whenever the account has a default template, so
  // this is the ordinary path, not a corner.
  useEffect(() => {
    // A different song is open, so changes offered against the last one are
    // not about what is loaded now -- and `before` describes a session that is
    // no longer there.
    setReview(null);
    if (!songId || isTemplate) {
      setMessages([]);
      attachedRef.current = null;
      return;
    }
    // Whether what is on screen is a transcript with no song of its own --
    // the conversation that built an unsaved session. If it belongs to some
    // OTHER song, it goes now rather than when the load returns: until then it
    // is the previous song's words sitting under this song's name, and a turn
    // landing in that window would save them onto this one.
    const carrying = attachedRef.current === null && messagesRef.current.length > 0;
    if (!carrying) setMessages([]);
    // Attached to nothing until a load says otherwise, which is what stops a
    // turn landing mid-load from writing over a chat it has not read yet.
    attachedRef.current = null;

    let alive = true;
    loadSongChat(songId).then((res) => {
      if (!alive || res.error) return;
      const stored = res.messages ?? [];
      // A transcript belonging to no song yet moves to whichever song that
      // session becomes -- which is exactly what the first save is, and
      // equally the first save off a template. Without this the conversation
      // that built the song was simply dropped at the moment it got something
      // to be attached to.
      //
      // Only ever onto a song with no conversation of its own: opening an
      // existing song while carrying one must not overwrite what is already
      // there, so a song that has a chat wins and ours is let go.
      const adopt = carrying && stored.length === 0 && messagesRef.current.length > 0;
      attachedRef.current = songId;
      if (adopt) {
        saveSongChat(songId, messagesRef.current).catch(() => {});
        return; // keep what is on screen; it is now this song's
      }
      setMessages(stored);
    });
    return () => {
      alive = false;
    };
  }, [songId, isTemplate]);

  // `new` (and the logo, which is the same thing) blanks the session. The
  // conversation about the song that was open is not about the blank one, so
  // it goes too. Needed on top of the effect above because starting from a
  // session with no song open leaves the id null either side of the `new`,
  // so nothing there would fire.
  useEffect(() => {
    const onNew = () => {
      setMessages([]);
      setInput("");
      attachedRef.current = null;
      // The session it was about has just been blanked, and `before` describes
      // one that no longer exists -- putting it back would undo the `new`.
      setReview(null);
    };
    window.addEventListener("seqbaby:newset", onNew);
    return () => window.removeEventListener("seqbaby:newset", onNew);
  }, []);

  // Opening the drawer to type is the only reason to open it.
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Grow with what's typed, up to the cap in the stylesheet: it's a box you
  // write a paragraph of brief into, not a one-line search field.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [input, open]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || sending || !window.seqbaby) return;
    // Nothing to run it on. Said here rather than by sending a message that
    // can only come back refused -- and the key row is opened, since the
    // answer is a field away.
    if (keyMode === "own" && !apiKey) {
      setEditingKey(true);
      setKeyError("add your Anthropic key first");
      return;
    }
    if (keyMode === "invite" && !invite) {
      setEditingInvite(true);
      setInviteError("add your invite code first");
      return;
    }
    const session = window.seqbaby.serializeSet();
    // Only plain text crosses the wire between turns -- what the model called
    // and why lives entirely inside one request/response, so the transcript
    // this resends stays small how ever many tool calls a turn took.
    const history = messages
      .filter((m): m is Extract<Msg, { role: "user" | "assistant" }> => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role, text: m.text }));

    // The transcript is tracked as a value as well as in state, because the
    // turn that ends this one has to be PERSISTED, and setMessages callbacks
    // can't hand anything back to do that with.
    const withUser: Msg[] = [...messages, { role: "user", text }];
    setMessages(withUser);
    setInput("");
    setSending(true);
    setSendingModel(model);
    setLive([]);
    // Asking for the next thing settles the last one. The session just
    // serialized is what the model is being asked about, so whatever is in the
    // engine -- an audition included -- is what this turn builds on, and there
    // is nothing left to put back to.
    setReview(null);

    // Attached to whichever song is open WHEN THE TURN LANDS, not when it
    // started: a turn takes minutes, and the first save of a new song happens
    // somewhere in the middle of plenty of them.
    //
    // Never onto a template -- that conversation belongs to the song the next
    // save makes, not to the starting point. Nothing is lost by waiting: the
    // whole transcript is written on the first turn after that save, by which
    // point the store names the new song.
    const land = (msg: Msg) => {
      const final = [...withUser, msg];
      setMessages(final);
      const now = getOpenSong();
      // Only onto a song this panel is actually attached to -- meaning its
      // chat has been read, or this transcript was adopted into it. A turn
      // landing while a load is still in flight, or after one failed, would
      // otherwise upsert whatever is on screen over a conversation nobody has
      // seen. That turn is not lost: `final` carries the whole transcript, so
      // the next one writes it.
      if (now.id && !now.isTemplate && attachedRef.current === now.id) {
        saveSongChat(now.id, final).catch(() => {});
      }
    };

    try {
      const res = await fetch("/api/compose", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // The key goes out with the message it pays for and is not kept
        // anywhere on the way: the route hands it to the worker and forgets
        // it. On the site's key nothing is sent, and the route decides from
        // the account instead.
        body: JSON.stringify({
          message: text,
          history,
          session,
          model,
          ...(keyMode === "own" ? { apiKey } : {}),
          // A code is not a key: it buys a turn on the SITE's key, bounded by
          // what it was minted with. The route spends one of those per
          // message and hands back what is left.
          ...(keyMode === "invite" ? { inviteCode: invite } : {}),
        }),
      });
      // Anything that failed before the route got to stream -- auth, a bad
      // request, a gateway page -- arrives as an ordinary body with a status
      // worth reading. Parse it by hand: res.json() on an HTML error page
      // throws about an unexpected "<", which reports on the parser rather
      // than on what went wrong.
      if (!res.ok || !res.body) {
        const raw = await res.text();
        let data: ComposeResponse | null = null;
        try {
          data = raw ? (JSON.parse(raw) as ComposeResponse) : null;
        } catch {
          data = null;
        }
        // 403 on a code turn is the code itself: used up, turned off, or
        // expired since it was accepted. What it has left is no longer
        // something we know, and a stale "3 turns left" sitting under "that
        // code has been used up" would be the panel arguing with itself.
        if (res.status === 403 && keyMode === "invite") setInviteLeft(undefined);
        land({ role: "error", text: describeFailure(res.status, raw, data) });
        return;
      }

      const started = (await res.json()) as ComposeResponse;
      // What the code has left after paying for this one -- the route spends a
      // turn only once the job is under way, so this arrives with the jobId or
      // not at all.
      if (started.inviteRemaining !== undefined) setInviteLeft(started.inviteRemaining);
      if (!started.jobId) {
        land({ role: "error", text: started.error ?? "couldn't start that" });
        return;
      }

      // The turn is running somewhere nothing is waiting on, so from here it
      // is polled rather than awaited -- which is what lets it take the
      // minutes a whole song takes.
      const activity: string[] = [];
      const until = Date.now() + POLL_LIMIT_MS;
      let misses = 0;
      for (;;) {
        await sleep(POLL_INTERVAL_MS);
        if (Date.now() > until) {
          land({ role: "error", text: "gave up waiting on that one — it may still be running." });
          return;
        }

        // A failed poll is usually not the job failing -- a blip must not throw
        // away a song still being written -- but "keep asking" is only right
        // for something that might recover. A 404 (no such job, or not this
        // account's) and a 401 (signed out) are answers, not blips: asking
        // again gets the same reply until the 16-minute limit reports a
        // timeout that never happened.
        let pollRes: Response;
        try {
          // The job token is how this browser proves the job is its own to
          // read. An account's session would do for a signed-in visitor, and
          // still does server-side, but a turn on a brought key has no
          // account behind it at all.
          const q = new URLSearchParams({ id: started.jobId });
          if (started.jobToken) q.set("t", started.jobToken);
          pollRes = await fetch(`/api/compose/status?${q}`);
        } catch {
          if (++misses > MAX_POLL_MISSES) {
            land({ role: "error", text: "lost contact with the server while that was running." });
            return;
          }
          continue;
        }
        if (pollRes.status === 401) {
          land({ role: "error", text: "signed out while that was running — sign in and the song may still be there." });
          return;
        }
        if (pollRes.status === 404) {
          land({ role: "error", text: "that job is no longer on the server." });
          return;
        }
        if (!pollRes.ok) {
          // Anything else (a 5xx, a rate limit) might pass, but not forever.
          if (++misses > MAX_POLL_MISSES) {
            land({ role: "error", text: `the server kept failing to report on that (${pollRes.status}).` });
            return;
          }
          continue;
        }
        misses = 0;
        const job = (await pollRes.json()) as JobStatus;

        const summaries = (job.events ?? [])
          .filter((e) => e.type === "tool" && e.summary)
          .map((e) => e.summary!);
        if (summaries.length !== activity.length) {
          activity.length = 0;
          activity.push(...summaries);
          setLive([...activity]);
        }

        if (job.status === "done") {
          // Only when the turn actually changed the song: a question changes
          // nothing, and the session it hands back was captured when the
          // message was SENT, which on a turn that takes minutes means writing
          // it would throw away anything done by hand since.
          //
          // And even then it is not written -- it is offered. The changes go
          // into the review bar, where `audition` drops them into the playing
          // session (mergeSet: no teardown, no stopped transport) and `keep`
          // makes them the song. Writing a turn straight in is what used to
          // silence a track that was playing while you asked for another one.
          if (job.session && job.changed !== false) setReview({ session: job.session, before: null });
          land({
            role: "assistant",
            text: job.reply || "Done.",
            // What it actually ran on, as the worker reported it -- not the
            // dropdown's current value, which may have been changed while
            // this turn was running.
            model: job.model,
            activity: [...activity],
            warnings: job.warnings,
          });
          return;
        }
        if (job.status === "error") {
          land({ role: "error", text: job.error ?? "that didn't work" });
          return;
        }
      }
    } catch (e) {
      land({ role: "error", text: `couldn't reach compose chat: ${(e as Error).message}` });
    } finally {
      setSending(false);
      setLive([]);
    }
  }, [input, sending, messages, model, keyMode, apiKey, invite]);

  // ---- the review bar ------------------------------------------------------
  //
  // Both directions are the same call: a session, written onto the live engine
  // in place. Auditioning writes the turn's; stopping writes back what was
  // playing before it. Neither stops the transport, which is the whole point.
  const writeLive = useCallback((session: unknown) => {
    const api = window.seqbaby;
    if (!api) return;
    // applySet is the fallback for an engine older than mergeSet (a cached
    // main.js from before this shipped). It costs the transport, which is
    // exactly what the merge exists to avoid, but it is never silence.
    if (api.mergeSet) api.mergeSet(session);
    else api.applySet(session);
  }, []);

  // Audition: keep what is playing so it can be put back, then merge the
  // turn's session over it. Nothing is saved and nothing is torn down.
  const audition = useCallback(() => {
    if (!review || review.before || !window.seqbaby) return;
    const before = window.seqbaby.serializeSet();
    writeLive(review.session);
    setReview({ session: review.session, before });
  }, [review, writeLive]);

  // Stop: back to what was playing, with the changes still on offer. Anything
  // changed BY HAND during the audition goes back with it -- undo reaches it
  // (the merge lands on the stack like any other edit), which is why this is a
  // button and not a confirm dialog.
  const stopAudition = useCallback(() => {
    if (!review?.before) return;
    writeLive(review.before);
    setReview({ session: review.session, before: null });
  }, [review, writeLive]);

  // Keep: the changes are the song now. Mid-audition there is nothing to write
  // -- the engine is already playing them, hand edits and all.
  const keepChanges = useCallback(() => {
    if (!review) return;
    if (!review.before) writeLive(review.session);
    setReview(null);
  }, [review, writeLive]);

  const discardChanges = useCallback(() => {
    if (!review) return;
    if (review.before) writeLive(review.before);
    setReview(null);
  }, [review, writeLive]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    },
    [send],
  );

  if (!ready) return null;

  return (
    <div className={styles.songsWrap} ref={wrapRef}>
      {/* A closed drawer hides the review bar but not the audition: the extra
          track goes on playing, and with nothing said here there would be no
          way to find out why it is there. */}
      <button
        className={`${styles.accountBtn} ${review ? styles.composeBtnHolding : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title={review
          ? (review.before
              ? "auditioning changes — open to keep or stop them"
              : "changes waiting — open to audition or keep them")
          : "ask for changes to this song"}
      >
        compose{review ? " ·" : ""}
      </button>
      {open && (
        <div className={styles.chatBackdrop} onClick={() => setOpen(false)} aria-hidden />
      )}
      {open && (
        <div className={`${styles.panel} ${styles.chatPanel}`}>
          <div className={styles.panelTitle}>ask for changes to this song</div>
          <div className={styles.chatLog} ref={logRef}>
            {messages.length === 0 && (
              <div className={styles.chatEmpty}>
                Tell it what to make or change — “add a dubby bassline on the
                silverbox”, “make the hats swing more”, “put a reverb on the
                bus”. It edits the song that&apos;s open, live.
                {needsKey && (
                  <>
                    {" "}
                    {siteKeyOffered
                      ? "You've chosen to run this on your own Anthropic key — add it below."
                      : inviteOffered
                        ? "Add your own Anthropic key below and it runs on that — or switch to an invite code if someone gave you one."
                        : "Add your own Anthropic key below and it runs on that; no account needed."}
                  </>
                )}
                {needsInvite && (
                  <>
                    {" "}
                    Type the invite code you were given below and it runs on this site&apos;s key — no
                    account needed.
                  </>
                )}
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i}>
                <div
                  className={`${styles.chatMsg} ${
                    m.role === "user"
                      ? styles.chatMsgUser
                      : m.role === "error"
                        ? styles.chatMsgError
                        : styles.chatMsgAssistant
                  }`}
                >
                  {m.text}
                </div>
                {m.role === "assistant" && (m.model || (m.activity && m.activity.length > 0)) && (
                  <div className={styles.chatActivity}>
                    {[...(m.model ? [composeModelLabel(m.model)] : []), ...(m.activity ?? [])].join(" · ")}
                  </div>
                )}
                {m.role === "assistant" && m.warnings && m.warnings.length > 0 && (
                  <div className={styles.chatWarn}>{m.warnings.join(" · ")}</div>
                )}
              </div>
            ))}
            {sending && (
              <div className={styles.chatActivity}>
                {[composeModelLabel(sendingModel || model), live.length > 0 ? `${live.join(" · ")} …` : "working…"].join(
                  " · ",
                )}
              </div>
            )}
          </div>
          {review && (
            <div className={`${styles.chatReview} ${review.before ? styles.chatReviewLive : ""}`}>
              <div className={styles.chatReviewText}>
                {review.before
                  ? "auditioning — you are hearing the changes, but the song does not have them yet."
                  : "these changes aren't in the song yet. audition drops them into what's playing; keep makes them the song."}
              </div>
              <div className={styles.chatReviewBtns}>
                <button
                  className={styles.smallBtn}
                  onClick={review.before ? stopAudition : audition}
                  title={review.before
                    ? "put back what was playing before the audition"
                    : "hear them now, without stopping the transport"}
                >
                  {review.before ? "stop" : "audition"}
                </button>
                <button
                  className={`${styles.smallBtn} ${styles.smallBtnPrimary}`}
                  onClick={keepChanges}
                  title="make them part of the song"
                >
                  keep
                </button>
                <button className={styles.smallBtn} onClick={discardChanges} title="throw them away">
                  discard
                </button>
              </div>
            </div>
          )}
          <div className={styles.chatTools}>
            {modes.length > 1 && (
              <>
                <label className={styles.chatModelLabel} htmlFor="compose-key-mode">
                  key
                </label>
                <select
                  id="compose-key-mode"
                  className={styles.chatModel}
                  value={keyMode}
                  onChange={(e) => pickKeyMode(e.target.value as KeyMode)}
                  title="whose Anthropic key this runs on"
                >
                  {modes.includes("site") && (
                    <option value="site" title="this site's key, shared between accounts and rate limited">
                      this site
                    </option>
                  )}
                  {modes.includes("invite") && (
                    <option value="invite" title="a code someone gave you — this site's key, for a set number of turns">
                      invite code
                    </option>
                  )}
                  <option value="own" title="your own Anthropic key — your usage, your limits">
                    your own
                  </option>
                </select>
              </>
            )}
            <label className={styles.chatModelLabel} htmlFor="compose-model">
              model
            </label>
            <select
              id="compose-model"
              className={styles.chatModel}
              value={model}
              onChange={(e) => pickModel(e.target.value)}
              title={COMPOSE_MODELS.find((m) => m.id === model)?.note}
            >
              {COMPOSE_MODELS.map((m) => (
                <option key={m.id} value={m.id} title={m.note}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
          {keyMode === "invite" && (
            <div className={styles.chatKey}>
              {invite && !editingInvite ? (
                <div className={styles.chatKeyRow}>
                  <span className={styles.chatKeyName} title="the code this browser is composing on">
                    {formatInviteCode(invite)}
                  </span>
                  <button
                    className={styles.smallBtn}
                    onClick={() => {
                      setEditingInvite(true);
                      setInviteError("");
                    }}
                  >
                    change
                  </button>
                  <button className={styles.smallBtn} onClick={forgetInvite} title="remove it from this browser">
                    forget
                  </button>
                </div>
              ) : (
                <div className={styles.chatKeyRow}>
                  <input
                    className={styles.chatKeyInput}
                    type="text"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="xxxx-xxxx-xxxx"
                    aria-label="your invite code"
                    value={inviteDraft}
                    onChange={(e) => {
                      setInviteDraft(e.target.value);
                      setInviteError("");
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        saveInvite();
                      }
                    }}
                  />
                  <button
                    className={`${styles.smallBtn} ${styles.smallBtnPrimary}`}
                    onClick={saveInvite}
                    disabled={checkingInvite || !inviteDraft.trim()}
                  >
                    {checkingInvite ? "checking…" : "use code"}
                  </button>
                </div>
              )}
              {inviteError && <div className={styles.chatKeyError}>{inviteError}</div>}
              <div className={styles.chatKeyNote}>
                {invite && inviteLeft !== undefined
                  ? inviteLeft === null
                    ? "Runs on this site's key. This code has no turn limit."
                    : `Runs on this site's key. ${inviteLeft} ${inviteLeft === 1 ? "turn" : "turns"} left on this code.`
                  : "A code from whoever runs this site. It buys a set number of composing turns on the site's key — no account, nothing to install."}
              </div>
            </div>
          )}
          {keyMode === "own" && (
            <div className={styles.chatKey}>
              {apiKey && !editingKey ? (
                <div className={styles.chatKeyRow}>
                  <span className={styles.chatKeyName} title="your key, as far as this browser will show it">
                    {maskApiKey(apiKey)}
                  </span>
                  <button
                    className={styles.smallBtn}
                    onClick={() => {
                      setEditingKey(true);
                      setKeyError("");
                    }}
                  >
                    change
                  </button>
                  <button className={styles.smallBtn} onClick={forgetKey} title="remove it from this browser">
                    forget
                  </button>
                </div>
              ) : (
                <>
                  <div className={styles.chatKeyRow}>
                    <input
                      className={styles.chatKeyInput}
                      type="password"
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="sk-ant-…"
                      aria-label="your Anthropic API key"
                      value={keyDraft}
                      onChange={(e) => {
                        setKeyDraft(e.target.value);
                        setKeyError("");
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          saveKey();
                        }
                      }}
                    />
                    <button
                      className={`${styles.smallBtn} ${styles.smallBtnPrimary}`}
                      onClick={saveKey}
                      disabled={!keyDraft.trim()}
                    >
                      use key
                    </button>
                  </div>
                  <label className={styles.chatKeyRemember}>
                    <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                    remember it in this browser
                  </label>
                </>
              )}
              {keyError && <div className={styles.chatKeyError}>{keyError}</div>}
              <div className={styles.chatKeyNote}>
                Runs on your key and bills your Anthropic account. It is sent with each message to run
                that turn and is never stored on the server.{" "}
                <a href={API_KEY_CONSOLE_URL} target="_blank" rel="noreferrer noopener">
                  get a key
                </a>
              </div>
            </div>
          )}
          <div className={styles.chatRow}>
            <textarea
              ref={inputRef}
              className={styles.chatTextarea}
              rows={2}
              placeholder={
                needsKey
                  ? "add your key above to compose…"
                  : needsInvite
                    ? "add your invite code above to compose…"
                    : "make me a techno beat…  (shift+enter for a new line)"
              }
              value={input}
              disabled={sending}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
            />
            <button
              className={`${styles.smallBtn} ${styles.smallBtnPrimary}`}
              onClick={send}
              disabled={sending || !input.trim() || unpaid}
            >
              send
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
