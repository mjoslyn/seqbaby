"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { saveNamedSong } from "@/app/songs/actions";
import styles from "@/app/ui.module.css";

// Top-bar "save" with a name + public popup. Saves the current session to the
// cloud (upsert by name); when public, publishes it and copies the share link.
export default function SaveButton() {
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [isPublic, setIsPublic] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ text: string; err?: boolean }>({
    text: "",
  });
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (window.seqbaby) return setReady(true);
    const onReady = () => setReady(true);
    window.addEventListener("seqbaby:ready", onReady);
    return () => window.removeEventListener("seqbaby:ready", onReady);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const save = useCallback(async () => {
    if (!window.seqbaby) return;
    setSaving(true);
    setStatus({ text: "Saving…" });
    const data = window.seqbaby.serializeSet();
    const res = await saveNamedSong({
      title: title.trim() || "untitled",
      data,
      isPublic,
    });
    setSaving(false);
    if (res.error) return setStatus({ text: res.error, err: true });
    if (isPublic && res.slug) {
      const url = `${location.origin}/?s=${res.slug}`;
      try {
        await navigator.clipboard.writeText(url);
        setStatus({ text: "Saved · public link copied" });
      } catch {
        setStatus({ text: "Saved (public)" });
      }
    } else {
      setStatus({ text: "Saved" });
    }
  }, [title, isPublic]);

  if (!ready) return null;

  return (
    <div className={styles.songsWrap} ref={wrapRef}>
      <button className={styles.accountBtn} onClick={() => setOpen((v) => !v)}>
        save
      </button>
      {open && (
        <div className={styles.panel}>
          <div className={styles.panelTitle}>save session</div>
          <input
            className={styles.saveInput}
            style={{ width: "100%", marginBottom: 8 }}
            placeholder="session name"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
            }}
          />
          <label className={styles.checkRow}>
            <input
              type="checkbox"
              checked={isPublic}
              onChange={(e) => setIsPublic(e.target.checked)}
            />
            public — shareable + shown on your profile
          </label>
          <button
            className={`${styles.smallBtn} ${styles.smallBtnPrimary}`}
            style={{ width: "100%" }}
            onClick={save}
            disabled={saving}
          >
            {saving ? "Saving…" : "save"}
          </button>
          <div
            className={`${styles.status} ${status.err ? styles.statusErr : ""}`}
          >
            {status.text}
          </div>
        </div>
      )}
    </div>
  );
}
