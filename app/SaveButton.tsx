"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { saveNamedSong } from "@/app/songs/actions";
import { generateSongName } from "@/app/songs/songName";
import { suggestSongName } from "@/app/songs/suggestName";
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
  // The name this popup offered, so save can tell an offer left alone from a
  // name the user typed -- only the first is the app's to disambiguate.
  const suggestedRef = useRef("");
  const offeredRef = useRef(false);
  const openSong = useSyncExternalStore(
    subscribeOpenSong,
    getOpenSong,
    getOpenSong,
  );

  // Opening the popup offers a name: the loaded song's, so the common case
  // (save what I am working on) is one click and does not fork by typo, and for
  // a session that has never been saved, one generated from what is in it --
  // visible and editable before you press save rather than sprung on you after.
  //
  // Once per opening, tracked by a ref rather than by depending on `title`:
  // re-offering the moment the field goes empty would make it unclearable.
  useEffect(() => {
    if (!open) {
      offeredRef.current = false;
      return;
    }
    if (offeredRef.current || title) return;
    offeredRef.current = true;
    if (openSong.title) return setTitle(openSong.title);
    const name = suggestSongName();
    suggestedRef.current = name;
    if (name) setTitle(name);
  }, [open, title, openSong.title]);

  // "new" (and a click on the logo) clear the open song. The field must not go
  // on holding the name of the song that was open, or the next save files a
  // blank session under it.
  useEffect(() => {
    if (!openSong.title) setTitle("");
  }, [openSong.title]);

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
    // Nothing typed and nothing open: the session names itself from what is in
    // it, rather than joining a list of rows all called "untitled". Falling
    // back to the open song's name first matters -- clearing the field on a
    // loaded song means "save this again", not "rename it to something else".
    const typed = title.trim();
    const carried = openSong.title.trim();
    // Generated covers both ways of not naming it: the offered name accepted as
    // it stood, and an empty field. A name the user typed over the offer is
    // theirs, and upserts by title like any other.
    const generated = !carried && (!typed || typed === suggestedRef.current);
    const t = typed || carried || generateSongName(data);
    const sameSong = t === openSong.title && openSong.versionId;
    const res = await saveNamedSong({
      title: t,
      data,
      isPublic,
      parentVersionId: sameSong ? openSong.versionId : undefined,
      titleGenerated: generated,
    });
    setSaving(false);
    if (res.error) return setStatus({ text: res.error, err: true });
    // The server disambiguates a generated name against the account's songs, so
    // what came back is what it is actually called. Show it: a save that names
    // your song for you has to say what it named it.
    const saved = res.title ?? t;
    setTitle(saved);
    setOpenSong({
      id: res.id ?? null,
      title: saved,
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
          : generated
            ? `Saved “${saved}” as v${res.versionSeq}`
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
            placeholder="session name (or leave blank)"
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
