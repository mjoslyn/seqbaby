"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { saveNamedSong } from "@/app/songs/actions";
import {
  getOpenSong,
  setOpenSong,
  subscribeOpenSong,
} from "@/app/songs/openSong";
import styles from "@/app/ui.module.css";

// Top-bar "save" with a name + public popup. Saves the current session to the
// cloud (upsert by name); when public, publishes it and copies the share link.
//
// A save under the open song's own name is a new version of it, branching off
// whichever version is loaded -- the same rule the songs menu follows. Saving
// under a different name is a different song, so the parent is dropped and that
// song starts its own tree.
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
  const openSong = useSyncExternalStore(
    subscribeOpenSong,
    getOpenSong,
    getOpenSong,
  );

  // Opening the popup offers the name of whatever is loaded, so the common case
  // (save what I am working on) is one click and does not fork by typo.
  useEffect(() => {
    if (open && !title && openSong.title) setTitle(openSong.title);
  }, [open, title, openSong.title]);

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
    const t = title.trim() || "untitled";
    const sameSong = t === openSong.title && openSong.versionId;
    const res = await saveNamedSong({
      title: t,
      data,
      isPublic,
      parentVersionId: sameSong ? openSong.versionId : undefined,
    });
    setSaving(false);
    if (res.error) return setStatus({ text: res.error, err: true });
    setOpenSong({
      id: res.id ?? null,
      title: t,
      versionId: res.versionId ?? null,
    });
    if (isPublic && res.slug) {
      const url = `${location.origin}/?s=${res.slug}`;
      try {
        await navigator.clipboard.writeText(url);
        setStatus({ text: "Saved · public link copied" });
      } catch {
        setStatus({ text: "Saved (public)" });
      }
    } else {
      setStatus({
        text: res.unchanged
          ? `No changes since v${res.versionSeq}`
          : `Saved as v${res.versionSeq}`,
      });
    }
  }, [title, isPublic, openSong.title, openSong.versionId]);

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
          {openSong.title && title.trim() === openSong.title && (
            <div className={styles.treeHint}>
              saves as a new version of &ldquo;{openSong.title}&rdquo;
            </div>
          )}
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
