"use client";

import { useEffect } from "react";
import { setOpenSong } from "@/app/songs/openSong";
import styles from "@/app/ui.module.css";

// Top-bar "new": blank the studio and forget which cloud song is open.
//
// The reset itself belongs to the engine (`onNewSet` in session.js — it also
// backs a click on the logo, and it is what asks before throwing away anything
// written), so all this island adds is the button and the shell's half of the
// job: the open-song slot has to be cleared too, or the next save would file a
// brand new session as another version of the song that was open when it was
// started.
//
// Deliberately not gated on `window.seqbaby` the way the save/songs menus are.
// Before the engine has booted there is nothing to reset in place, but the
// button still has an honest answer — the studio's own URL is a blank editor —
// and rendering it either way keeps the bar from reflowing mid-load.
export default function NewSongButton() {
  // The engine announces its own resets (the logo goes through the same flow),
  // so the open-song slot is cleared from one place whichever route got here.
  useEffect(() => {
    const onNew = () => setOpenSong({ id: null, title: "", versionId: null });
    window.addEventListener("seqbaby:newset", onNew);
    return () => window.removeEventListener("seqbaby:newset", onNew);
  }, []);

  return (
    <a
      className={styles.accountBtn}
      href="/"
      title="start a new song — a blank editor"
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        if (!window.seqbaby?.onNewSet) return; // engine not up: let the link navigate
        e.preventDefault();
        window.seqbaby.onNewSet();
      }}
    >
      new
    </a>
  );
}
