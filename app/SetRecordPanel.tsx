"use client";

import { useEffect, useRef, useState } from "react";
import { getOpenSong } from "@/app/songs/openSong";
import { takeFork } from "@/app/set/forkStore";

// The shell's half of a recorded set (public/js/setRecorder.js). The engine
// records; when the recording ends it fires `seqbaby:setrecorded`, and this
// asks what to call it and saves it to the account (POST /api/sets), or, signed
// out, offers it as a file. It also lands a fork: a studio opened on
// `?fork=1` takes the fork point the set player left in IndexedDB and opens
// on it, armed to record.
//
// Mounted outside the account bar's signed-in branch: the recorder works for
// everyone, and only the saving needs an account.

type Saved = { id: string; title: string };

function suggestTitle(): string {
  const song = getOpenSong();
  const d = new Date();
  const when = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return song.title ? `${song.title} live ${when}` : `live set ${when}`;
}

function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export default function SetRecordPanel() {
  const [rec, setRec] = useState<any>(null);
  const [title, setTitle] = useState("");
  const [isPublic, setIsPublic] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const forked = useRef<{ setId: string | null; title?: string } | null>(null);

  useEffect(() => {
    const onRecorded = (e: Event) => {
      const r = (e as CustomEvent).detail?.recording;
      if (!r) return;
      setRec(r);
      setSaved(null);
      setError(null);
      setTitle(forked.current?.title ? `${forked.current.title} (fork)` : suggestTitle());
      if (signedIn === null) {
        fetch("/api/me").then((r) => r.json() as Promise<{ id?: string }>).then((m) => setSignedIn(!!m?.id)).catch(() => setSignedIn(false));
      }
    };
    window.addEventListener("seqbaby:setrecorded", onRecorded);
    return () => window.removeEventListener("seqbaby:setrecorded", onRecorded);
  }, [signedIn]);

  // A fork waiting to be opened (the set player wrote it, then sent us here).
  useEffect(() => {
    const qs = new URLSearchParams(location.search);
    if (!qs.has("fork")) return;
    let cancelled = false;
    const land = async () => {
      const h = await takeFork();
      const api = window.seqbaby;
      if (cancelled || !h || !api?.sets) return;
      forked.current = { setId: h.setId, title: h.title };
      await api.sets.openFork(h.point, { setId: h.setId });
      const url = new URL(location.href);
      url.searchParams.delete("fork");
      history.replaceState(history.state, "", url);
    };
    if (window.seqbaby?.sets) void land();
    else window.addEventListener("seqbaby:ready", () => void land(), { once: true });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!rec) return null;

  const close = () => {
    setRec(null);
    setSaved(null);
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/sets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title,
          recording: rec,
          songId: getOpenSong().id,
          forkedFrom: rec.forkedFrom ?? forked.current?.setId ?? null,
          forkStep: rec.forkStep ?? null,
          isPublic,
        }),
      });
      const out = (await res.json().catch(() => ({}))) as { id?: string; title?: string; error?: string };
      if (!res.ok || out.error) throw new Error(out.error || `save failed (${res.status})`);
      setSaved({ id: String(out.id), title: String(out.title ?? title) });
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const download = () => {
    const blob = new Blob([JSON.stringify(rec)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${(title || "set").replace(/[^\w.-]+/g, "-")}.seqbaby-set.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  return (
    <div className="sq-modal-overlay sq-setrec-ignore" onClick={(e) => e.target === e.currentTarget && !busy && close()}>
      <div className="sq-modal" role="dialog" aria-modal="true" aria-label="save the set">
        <div className="sq-modal__title">{saved ? "set saved" : "save the set"}</div>
        <p style={{ margin: "0 0 10px", opacity: 0.75, fontSize: 12 }}>
          {clock(rec.seconds)} · {rec.steps} steps · {rec.events.length} moves
          {rec.start?.decks?.length ? ` · ${rec.start.decks.length + 1} decks` : ""}
          {rec.forkedFrom ? " · forked" : ""}
        </p>
        {saved ? (
          <>
            <p style={{ margin: "0 0 12px" }}>
              &ldquo;{saved.title}&rdquo; is in your sets{isPublic ? ", and anyone with the link can play it" : ""}.
            </p>
            <div className="sq-modal__actions">
              <button className="sq-btn--ghost" onClick={close}>
                close
              </button>
              <a className="sq-modal__ok" href={`/set/${saved.id}`} target="_blank" rel="noopener" style={{ textDecoration: "none" }}>
                open in the player
              </a>
            </div>
          </>
        ) : (
          <>
            <input
              className="sq-modal__input"
              type="text"
              value={title}
              maxLength={120}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && signedIn && !busy && void save()}
              aria-label="set name"
              autoFocus
            />
            {signedIn !== false && (
              <label style={{ display: "flex", gap: 6, alignItems: "center", margin: "10px 0", fontSize: 12 }}>
                <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} />
                public: anyone with the link can play it, and it shows on your page
              </label>
            )}
            {signedIn === false && <p style={{ fontSize: 12, opacity: 0.8 }}>sign in to keep sets in your account; you can still download this one.</p>}
            {error && <p style={{ color: "#e5484d", fontSize: 12 }}>{error}</p>}
            <div className="sq-modal__actions">
              <button className="sq-btn--ghost" onClick={close} disabled={busy}>
                discard
              </button>
              <button className="sq-btn--ghost" onClick={download} disabled={busy}>
                download
              </button>
              {signedIn !== false && (
                <button className="sq-modal__ok" onClick={() => void save()} disabled={busy || !title.trim()}>
                  {busy ? "saving…" : "save"}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
