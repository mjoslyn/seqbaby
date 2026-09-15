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
  setSongTemplate,
  setDefaultTemplate,
  type SongListItem,
} from "@/app/songs/actions";
import {
  getOpenSong,
  setOpenSong,
  subscribeOpenSong,
} from "@/app/songs/openSong";
import { generateSongName } from "@/app/songs/songName";
import { suggestSongName } from "@/app/songs/suggestName";
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
//
// A TEMPLATE is the one song saving does not append to. Opening one leaves the
// studio holding it as a starting point, and the first save makes a song of its
// own -- which is what the `tmpl` toggle on each row buys. `dflt` names the one
// a new session starts from.
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
  // The name this panel offered, so save can tell an offer left alone from a
  // name the user typed -- only the first is the app's to disambiguate.
  const suggestedRef = useRef("");
  const offeredRef = useRef(false);

  // Follow the shared store when something else opens a song, but leave what
  // the user is typing alone otherwise. A template is the exception: its name
  // belongs to the template, not to the song about to be made from it, so the
  // field goes blank and the offer below fills it.
  useEffect(() => {
    setTitle(openSong.isTemplate ? "" : openSong.title);
  }, [openSong.title, openSong.isTemplate]);

  // A session that has never been saved gets a name offered in the field when
  // the panel opens -- visible and editable before you press save rather than
  // sprung on you after. Once per opening, tracked by a ref rather than by
  // depending on `title`: re-offering the moment the field goes empty would
  // make it unclearable.
  useEffect(() => {
    if (!open) {
      offeredRef.current = false;
      return;
    }
    // A template counts as nothing open here: the save is a new song, and it
    // needs a name of its own.
    if (offeredRef.current || title || (openSong.title && !openSong.isTemplate))
      return;
    offeredRef.current = true;
    const name = suggestSongName();
    suggestedRef.current = name;
    if (name) setTitle(name);
  }, [open, title, openSong.title, openSong.isTemplate]);

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
      // An unnamed song names itself from what is in it rather than joining a
      // list of rows all called "untitled". A song already open keeps its name
      // even if the field was cleared: clearing it is not a rename.
      const typed = title.trim();
      // A template's name is never carried either: like `new`, this save is a
      // song of its own, and it should not be called what the template is.
      const carried = asNew || openSong.isTemplate ? "" : openSong.title.trim();
      // Generated covers both ways of not naming it: the offered name accepted
      // as it stood, and an empty field. A name typed over the offer is the
      // user's own.
      const generated = !carried && (!typed || typed === suggestedRef.current);
      const t = typed || carried || generateSongName(data);
      setStatus({ text: "Saving…" });
      const fromTemplate = openSong.isTemplate;
      const res = await saveSong({
        id: asNew || fromTemplate ? undefined : (currentId ?? undefined),
        title: t,
        data,
        // undefined means "off the tip"; a version id means "branch from here".
        parentVersionId:
          asNew || fromTemplate ? undefined : (baseVersionId ?? undefined),
        titleGenerated: generated,
        // Detaches the save AND records where the song came from. Not sent for
        // `new`, which is a copy of a song, not a use of a template.
        fromTemplateId: fromTemplate && !asNew ? currentId : undefined,
      });
      if (res.error) return setStatus({ text: res.error, err: true });
      // A generated name is disambiguated server-side against the account's
      // songs, so what came back is what the song is actually called.
      const saved = res.title ?? t;
      setTitle(saved);
      // The studio now holds the song that was just written, not the template
      // it came from: only the FIRST save off a template detaches.
      setOpenSong({
        id: res.id ?? null,
        title: saved,
        versionId: res.versionId ?? null,
        isTemplate: false,
      });
      setStatus({
        text: res.unchanged
          ? `No changes since v${res.versionSeq}`
          : generated
            ? `Saved “${saved}” as v${res.versionSeq}`
            : `Saved as v${res.versionSeq}`,
      });
      refresh();
    },
    [
      title,
      currentId,
      baseVersionId,
      openSong.title,
      openSong.isTemplate,
      refresh,
    ],
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
        isTemplate: !!res.isTemplate,
      });
      setStatus({
        text: res.isTemplate
          ? `Started from "${song.title}" — saving makes a new song`
          : `Loaded "${song.title}"`,
      });
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
        setOpenSong({ id: null, versionId: null, isTemplate: false });
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
      // A fork is a song of your own, never a template -- even of a template.
      setOpenSong({
        id: res.id,
        title: res.title ?? song.title,
        versionId: res.versionId ?? null,
        isTemplate: false,
      });
      setStatus({ text: `Forked "${song.title}"` });
      refresh();
    },
    [refresh],
  );

  const doToggleTemplate = useCallback(
    async (song: SongListItem) => {
      const res = await setSongTemplate(song.id, !song.is_template);
      if (res.error) return setStatus({ text: res.error, err: true });
      // What the studio is holding changes with the flag: marking the open song
      // a template must make the next save detach, and unmarking it must stop.
      if (currentId === song.id)
        setOpenSong({ isTemplate: !song.is_template });
      setStatus({
        text: song.is_template
          ? `"${song.title}" is a song again`
          : `"${song.title}" is a template`,
      });
      refresh();
    },
    [currentId, refresh],
  );

  const doToggleDefault = useCallback(
    async (song: SongListItem) => {
      const res = await setDefaultTemplate(
        song.is_default_template ? null : song.id,
      );
      if (res.error) return setStatus({ text: res.error, err: true });
      setStatus({
        text: song.is_default_template
          ? "New songs start blank again"
          : `New songs start from "${song.title}"`,
      });
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
  // being a surprise. Never while holding a template -- that save is not going
  // into this song's tree at all.
  const branching =
    !openSong.isTemplate &&
    !!currentSong &&
    !!baseVersionId &&
    currentSong.current_version_id !== baseVersionId;

  const templates = songs.filter((s) => s.is_template);
  const plain = songs.filter((s) => !s.is_template);

  // One row, drawn in both lists. A template's row differs only by the two
  // extra states it can be in, which is the honest shape of the feature: a
  // template is an ordinary song with a flag, and everything else you can do to
  // a song you can still do to one.
  const renderRow = (song: SongListItem) => (
    <div key={song.id}>
      <div className={styles.songRow}>
        <button
          className={`${styles.songRowTitle} ${
            currentId === song.id ? styles.songRowActive : ""
          }`}
          onClick={() => doLoad(song)}
          title={
            song.is_template
              ? "start a new song from this template"
              : "load the current version into the studio"
          }
        >
          {song.is_public && <span className={styles.pubDot}>● </span>}
          {song.title}
        </button>
        {song.is_template && (
          <button
            className={`${styles.iconBtn} ${
              song.is_default_template ? styles.iconBtnOn : ""
            }`}
            onClick={() => doToggleDefault(song)}
            aria-pressed={song.is_default_template}
            title={
              song.is_default_template
                ? "new songs start from this — click to stop"
                : "make this what a new song starts from"
            }
          >
            dflt
          </button>
        )}
        <button
          className={`${styles.iconBtn} ${
            song.is_template ? styles.iconBtnOn : ""
          }`}
          onClick={() => doToggleTemplate(song)}
          aria-pressed={song.is_template}
          title={
            song.is_template
              ? "stop being a template"
              : "make a template — saving from it makes a new song"
          }
        >
          tmpl
        </button>
        <button
          className={`${styles.iconBtn} ${
            treeFor === song.id ? styles.iconBtnOn : ""
          }`}
          onClick={() => setTreeFor((id) => (id === song.id ? null : song.id))}
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
            song.is_public ? "copy public link" : "publish + copy public link"
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
              // Every version of a template is a template: opening an older one
              // is still starting from it.
              isTemplate: song.is_template,
            })
          }
          onChanged={refresh}
          setStatus={setStatus}
        />
      )}
    </div>
  );

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
              placeholder="song title (or leave blank)"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <button
              className={`${styles.smallBtn} ${styles.smallBtnPrimary}`}
              onClick={() => doSave(false)}
              title={
                openSong.isTemplate
                  ? "save as a new song, started from this template"
                  : currentId
                    ? branching
                      ? "save as a new version branching off the one you opened"
                      : "save as a new version of this song"
                    : "save a new song"
              }
            >
              save
            </button>
            {currentId && !openSong.isTemplate && (
              <button
                className={styles.smallBtn}
                onClick={() => doSave(true)}
                title="save as a separate song, with its own history"
              >
                new
              </button>
            )}
          </div>
          {openSong.isTemplate && (
            <div className={styles.treeHint}>
              started from template &ldquo;{openSong.title}&rdquo; — saving makes
              a new song
            </div>
          )}
          {branching && (
            <div className={styles.treeHint}>
              saving branches off the version you opened
            </div>
          )}

          {templates.length > 0 && (
            <>
              <div className={styles.divider} />
              <div className={styles.panelTitle}>templates</div>
              {templates.map(renderRow)}
            </>
          )}

          <div className={styles.divider} />
          <div className={styles.panelTitle}>my songs</div>
          {plain.length === 0 ? (
            <div className={styles.empty}>
              {songs.length
                ? "every song here is a template"
                : "no saved songs yet"}
            </div>
          ) : (
            plain.map(renderRow)
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
