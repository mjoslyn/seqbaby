"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  listSongs,
  saveSong,
  loadSong,
  deleteSong,
  publishSong,
  forkSong,
  type SongListItem,
} from "@/app/songs/actions";
import {
  getOpenSong,
  setOpenSong,
  subscribeOpenSong,
} from "@/app/songs/openSong";
import VersionTree from "@/app/VersionTree";
import styles from "@/app/ui.module.css";

// Client island that bridges the React shell to the vanilla engine via
// window.seqbaby (serializeSet / applySet), backing Save/Load with the account's
// cloud songs.
//
// Saving an existing song appends to its version tree rather than overwriting
// it: the save hangs off whichever version is currently open, so saving from an
// older version branches instead of burying it. Which version that is lives in
// the shared open-song store, because the top-bar save has to agree.
export default function SongsMenu() {
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [songs, setSongs] = useState<SongListItem[]>([]);
  const [treeFor, setTreeFor] = useState<string | null>(null);
  const [status, setStatus] = useState<{ text: string; err?: boolean }>({
    text: "",
  });
  const openSong = useSyncExternalStore(
    subscribeOpenSong,
    getOpenSong,
    getOpenSong,
  );
  const currentId = openSong.id;
  const baseVersionId = openSong.versionId;
  const [title, setTitle] = useState(openSong.title);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Follow the shared store when something else opens a song, but leave what
  // the user is typing alone otherwise.
  useEffect(() => {
    setTitle(openSong.title);
  }, [openSong.title]);

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
        // undefined means "off the tip"; a version id means "branch from here".
        parentVersionId: asNew ? undefined : (baseVersionId ?? undefined),
      });
      if (res.error) return setStatus({ text: res.error, err: true });
      setOpenSong({
        id: res.id ?? null,
        title: t,
        versionId: res.versionId ?? null,
      });
      setStatus({
        text: res.unchanged
          ? `No changes since v${res.versionSeq}`
          : `Saved as v${res.versionSeq}`,
      });
      refresh();
    },
    [title, currentId, baseVersionId, refresh],
  );

  const doLoad = useCallback(async (song: SongListItem) => {
    const res = await loadSong(song.id);
    if (res.error) return setStatus({ text: res.error, err: true });
    try {
      window.seqbaby?.applySet(res.data);
      setOpenSong({
        id: song.id,
        title: song.title,
        versionId: res.versionId ?? null,
      });
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
      if (currentId === song.id)
        setOpenSong({ id: null, versionId: null });
      if (treeFor === song.id) setTreeFor(null);
      setStatus({ text: "Deleted" });
      refresh();
    },
    [currentId, treeFor, refresh],
  );

  const doFork = useCallback(
    async (song: SongListItem) => {
      setStatus({ text: "Forking…" });
      const res = await forkSong(song.id);
      if (res.error || !res.id)
        return setStatus({ text: res.error ?? "Fork failed", err: true });
      setOpenSong({
        id: res.id,
        title: res.title ?? song.title,
        versionId: res.versionId ?? null,
      });
      setStatus({ text: `Forked "${song.title}"` });
      refresh();
    },
    [refresh],
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

  const currentSong = songs.find((s) => s.id === currentId);
  // Sitting on something other than the tip: the next save is a branch, and
  // saying so beforehand is the difference between that being a feature and
  // being a surprise.
  const branching =
    !!currentSong &&
    !!baseVersionId &&
    currentSong.current_version_id !== baseVersionId;

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
              title={
                currentId
                  ? branching
                    ? "save as a new version branching off the one you opened"
                    : "save as a new version of this song"
                  : "save a new song"
              }
            >
              save
            </button>
            {currentId && (
              <button
                className={styles.smallBtn}
                onClick={() => doSave(true)}
                title="save as a separate song, with its own history"
              >
                new
              </button>
            )}
          </div>
          {branching && (
            <div className={styles.treeHint}>
              saving branches off the version you opened
            </div>
          )}

          <div className={styles.divider} />
          <div className={styles.panelTitle}>my songs</div>
          {songs.length === 0 ? (
            <div className={styles.empty}>no saved songs yet</div>
          ) : (
            songs.map((song) => (
              <div key={song.id}>
                <div className={styles.songRow}>
                  <button
                    className={`${styles.songRowTitle} ${
                      currentId === song.id ? styles.songRowActive : ""
                    }`}
                    onClick={() => doLoad(song)}
                    title="load the current version into the studio"
                  >
                    {song.is_public && <span className={styles.pubDot}>● </span>}
                    {song.title}
                  </button>
                  <button
                    className={`${styles.iconBtn} ${
                      treeFor === song.id ? styles.iconBtnOn : ""
                    }`}
                    onClick={() =>
                      setTreeFor((id) => (id === song.id ? null : song.id))
                    }
                    title="version history"
                    aria-expanded={treeFor === song.id}
                  >
                    hist
                  </button>
                  <button
                    className={styles.iconBtn}
                    onClick={() => doFork(song)}
                    title="fork into a new session"
                  >
                    fork
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
                {treeFor === song.id && (
                  <VersionTree
                    songId={song.id}
                    baseVersionId={currentId === song.id ? baseVersionId : null}
                    onOpen={(versionId, loadedTitle) =>
                      setOpenSong({
                        id: song.id,
                        title: loadedTitle ?? song.title,
                        versionId,
                      })
                    }
                    onChanged={refresh}
                    setStatus={setStatus}
                  />
                )}
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
