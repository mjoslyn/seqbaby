"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  listSongs,
  saveSong,
  loadSong,
  deleteSong,
  publishSong,
  type SongListItem,
} from "@/app/songs/actions";
import styles from "@/app/ui.module.css";

// Client island that bridges the React shell to the vanilla engine via
// window.seqbaby (serializeSet / applySet), backing Save/Load with the account's
// cloud songs.
export default function SongsMenu() {
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [songs, setSongs] = useState<SongListItem[]>([]);
  const [title, setTitle] = useState("");
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [status, setStatus] = useState<{ text: string; err?: boolean }>({
    text: "",
  });
  const wrapRef = useRef<HTMLDivElement>(null);

  // Wait for the engine to install window.seqbaby.
  useEffect(() => {
    if (window.seqbaby) {
      setReady(true);
      return;
    }
    const onReady = () => setReady(true);
    window.addEventListener("seqbaby:ready", onReady);
    return () => window.removeEventListener("seqbaby:ready", onReady);
  }, []);

  const refresh = useCallback(async () => {
    const res = await listSongs();
    if (res.error) setStatus({ text: res.error, err: true });
    else setSongs(res.songs);
  }, []);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    refresh();
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, refresh]);

  const doSave = useCallback(
    async (asNew: boolean) => {
      if (!window.seqbaby) return;
      const data = window.seqbaby.serializeSet();
      const t = title.trim() || "untitled";
      setStatus({ text: "Saving…" });
      const res = await saveSong({
        id: asNew ? undefined : (currentId ?? undefined),
        title: t,
        data,
      });
      if (res.error) return setStatus({ text: res.error, err: true });
      setCurrentId(res.id ?? null);
      setStatus({ text: "Saved" });
      refresh();
    },
    [title, currentId, refresh],
  );

  const doLoad = useCallback(async (song: SongListItem) => {
    const res = await loadSong(song.id);
    if (res.error) return setStatus({ text: res.error, err: true });
    try {
      window.seqbaby?.applySet(res.data);
      setCurrentId(song.id);
      setTitle(song.title);
      setStatus({ text: `Loaded "${song.title}"` });
      setOpen(false);
    } catch (e) {
      setStatus({ text: `Load failed: ${(e as Error).message}`, err: true });
    }
  }, []);

  const doDelete = useCallback(
    async (song: SongListItem) => {
      const res = await deleteSong(song.id);
      if (res.error) return setStatus({ text: res.error, err: true });
      if (currentId === song.id) setCurrentId(null);
      setStatus({ text: "Deleted" });
      refresh();
    },
    [currentId, refresh],
  );

  const doPublish = useCallback(
    async (song: SongListItem) => {
      const res = await publishSong(song.id);
      if (res.error || !res.slug)
        return setStatus({ text: res.error ?? "Publish failed", err: true });
      const url = `${location.origin}/?s=${res.slug}`;
      try {
        await navigator.clipboard.writeText(url);
        setStatus({ text: "Public link copied" });
      } catch {
        setStatus({ text: url });
      }
      refresh();
    },
    [refresh],
  );

  if (!ready) return null;

  return (
    <div className={styles.songsWrap} ref={wrapRef}>
      <button
        className={styles.accountBtn}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        songs
      </button>
      {open && (
        <div className={styles.panel}>
          <div className={styles.panelTitle}>save current</div>
          <div className={styles.saveRow}>
            <input
              className={styles.saveInput}
              placeholder="song title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <button
              className={`${styles.smallBtn} ${styles.smallBtnPrimary}`}
              onClick={() => doSave(false)}
              title={currentId ? "update this song" : "save a new song"}
            >
              {currentId ? "save" : "save"}
            </button>
            {currentId && (
              <button
                className={styles.smallBtn}
                onClick={() => doSave(true)}
                title="save as a new song"
              >
                new
              </button>
            )}
          </div>

          <div className={styles.divider} />
          <div className={styles.panelTitle}>my songs</div>
          {songs.length === 0 ? (
            <div className={styles.empty}>no saved songs yet</div>
          ) : (
            songs.map((song) => (
              <div className={styles.songRow} key={song.id}>
                <button
                  className={`${styles.songRowTitle} ${
                    currentId === song.id ? styles.songRowActive : ""
                  }`}
                  onClick={() => doLoad(song)}
                  title="load into the studio"
                >
                  {song.is_public && <span className={styles.pubDot}>● </span>}
                  {song.title}
                </button>
                <button
                  className={styles.iconBtn}
                  onClick={() => doPublish(song)}
                  title={
                    song.is_public
                      ? "copy public link"
                      : "publish + copy public link"
                  }
                >
                  link
                </button>
                <button
                  className={styles.iconBtn}
                  onClick={() => doDelete(song)}
                  title="delete"
                >
                  del
                </button>
              </div>
            ))
          )}

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
