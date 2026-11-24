"use client";

import { useEffect, useRef, useState } from "react";
import { putFork } from "@/app/set/forkStore";
import styles from "./setPlayer.module.css";

// The set player's controls over a visible studio. The studio is the real one,
// in a same-origin frame on `/studio?embed`, driven through
// `window.seqbaby.sets` (setRecorder.js): load puts it at the set's start,
// play lays the recording down step by step, pause stops the transport and
// keeps the place, the scrubber goes to a step, and fork hands the studio as
// it stands to a fresh studio tab, armed to record a new set from there.
//
// While it plays, a shield covers the frame: a click in the studio would be
// an edit the recording does not know about, and the replay would go on over
// it. Paused, the studio is yours to look around before forking.

type Api = NonNullable<Window["seqbaby"]>;
type Status = "booting" | "loading" | "ready" | "playing" | "paused" | "error";

function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(r)}` : `${m}:${pad(r)}`;
}

export default function SetPlayer({ id, title, owned, isPublic }: { id: string; title: string; owned: boolean; isPublic: boolean }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const apiRef = useRef<Api | null>(null);
  const [status, setStatus] = useState<Status>("booting");
  const [msg, setMsg] = useState("starting the studio…");
  const [pos, setPos] = useState<SetReplayState | null>(null);
  const [scrub, setScrub] = useState<number | null>(null);
  const [pub, setPub] = useState(isPublic);
  const [copied, setCopied] = useState(false);

  // the engine in the frame, then the recording into it
  useEffect(() => {
    let cancelled = false;
    const t0 = Date.now();
    const poll = async () => {
      if (cancelled) return;
      const api = frameRef.current?.contentWindow?.seqbaby;
      if (!api?.sets) {
        if (Date.now() - t0 > 90000) { setStatus("error"); setMsg("the studio did not load"); return; }
        setTimeout(poll, 200);
        return;
      }
      apiRef.current = api;
      setStatus("loading");
      setMsg("fetching the set…");
      try {
        const res = await fetch(`/api/sets/${encodeURIComponent(id)}`);
        const out = (await res.json()) as { recording?: unknown; error?: string };
        if (!res.ok || out.error) throw new Error(out.error || `could not load (${res.status})`);
        setMsg("setting up the studio…");
        const st = await api.sets.load(out.recording, { onProgress: (m) => !cancelled && setMsg(m) });
        if (cancelled) return;
        setPos(st);
        setStatus("ready");
        setMsg("");
      } catch (e) {
        setStatus("error");
        setMsg(String((e as Error)?.message ?? e));
      }
    };
    void poll();
    return () => {
      cancelled = true;
      try { void apiRef.current?.sets?.close(); } catch {}
    };
  }, [id]);

  // where the replay is, a few times a second
  useEffect(() => {
    if (status !== "playing") return;
    const iv = setInterval(() => {
      const st = apiRef.current?.sets?.replay();
      if (!st) return;
      setPos(st);
      if (!st.playing) setStatus(st.ended ? "ready" : "paused");
    }, 200);
    return () => clearInterval(iv);
  }, [status]);

  const play = async () => {
    const api = apiRef.current;
    if (!api?.sets) return;
    // inside the click: the frame's audio has to be unlocked by this gesture
    try { api.unlock(); } catch {}
    setStatus("playing");
    const st = await api.sets.play();
    if (st) setPos(st);
    if (!st?.playing) setStatus("paused");
  };

  const pause = async () => {
    const st = await apiRef.current?.sets?.pause();
    if (st) setPos(st);
    setStatus("paused");
  };

  const seek = async (step: number) => {
    const api = apiRef.current;
    if (!api?.sets) return;
    const was = status === "playing";
    setStatus("loading");
    setMsg("finding the place…");
    const st = await api.sets.seek(step);
    setScrub(null);
    setMsg("");
    if (st) setPos(st);
    setStatus(was ? "playing" : "paused");
  };

  const fork = async () => {
    const api = apiRef.current;
    if (!api?.sets) return;
    if (status === "playing") await api.sets.pause();
    setMsg("handing the studio over…");
    try {
      const point = api.sets.forkPoint();
      // across realms: the frame's objects, made plain before they are stored
      await putFork({ point: JSON.parse(JSON.stringify(point)), setId: id, title });
      window.location.href = "/studio?fork=1";
    } catch (e) {
      setMsg(`could not fork: ${String((e as Error)?.message ?? e)}`);
    }
  };

  const togglePublic = async () => {
    const next = !pub;
    const res = await fetch(`/api/sets/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ isPublic: next }),
    });
    if (res.ok) setPub(next);
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  const steps = pos?.steps ?? 0;
  const step = scrub ?? pos?.step ?? 0;
  const busy = status === "booting" || status === "loading" || status === "error";
  const playing = status === "playing";

  return (
    <div className={styles.player}>
      <div className={styles.bar}>
        <button className={styles.play} onClick={() => void (playing ? pause() : play())} disabled={busy} aria-label={playing ? "pause" : "play"}>
          {playing ? "❚❚ pause" : status === "paused" ? "▶ resume" : "▶ play"}
        </button>
        <span className={styles.time}>
          {clock(pos?.seconds ?? 0)} / {clock(pos?.total ?? 0)}
        </span>
        <input
          className={styles.scrub}
          type="range"
          min={0}
          max={Math.max(1, steps)}
          step={1}
          value={Math.min(step, Math.max(1, steps))}
          disabled={busy}
          aria-label="position in the set"
          onChange={(e) => setScrub(Number(e.target.value))}
          onPointerUp={() => scrub != null && void seek(scrub)}
          onKeyUp={() => scrub != null && void seek(scrub)}
        />
        <button className={styles.btn} onClick={() => void fork()} disabled={busy} title="take the studio as it is at this moment, and record a new set from here">
          fork from here
        </button>
        {owned && (
          <button className={styles.btn} onClick={() => void togglePublic()} title={pub ? "make it private" : "let anyone with the link play it"}>
            {pub ? "public" : "private"}
          </button>
        )}
        <button className={styles.btn} onClick={() => void copyLink()}>
          {copied ? "copied" : "copy link"}
        </button>
      </div>
      {msg && <div className={status === "error" ? styles.error : styles.msg}>{msg}</div>}
      <div className={styles.stage}>
        <iframe ref={frameRef} className={styles.frame} src="/studio?embed" title={`${title}: the studio`} allow="autoplay" />
        {(playing || busy) && (
          <div className={styles.shield} aria-hidden>
            {playing ? <span>playing back · pause to look around or fork</span> : null}
          </div>
        )}
      </div>
    </div>
  );
}
