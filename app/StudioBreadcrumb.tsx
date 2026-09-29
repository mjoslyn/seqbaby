"use client";

import { useEffect } from "react";
import { getOpenSong } from "@/app/songs/openSong";
import { STUDIO_KEY, studioSnapshot } from "@/app/superbugs/bugContext";

type EngineTrack = { name?: string; engineKey?: string };
type EngineState = { tracks?: EngineTrack[]; activePattern?: number; playing?: boolean };

// Leaves a note in localStorage saying what the studio had open, so a bug
// report filed from /superbugs can say where it came from without anyone
// typing it (app/superbugs/bugContext.js). The superbugs page is usually
// reached another way than straight from here (the manual opens in a new
// tab), so the referrer alone would rarely name the studio.
//
// Written when the tab is hidden or left, which is exactly when someone goes
// off to report something: the address bar by then carries whatever
// `?open=` / `?s=` the session got, and the engine has booted.
function record() {
  // On a client-side navigation the unmount runs with the address bar already
  // on the next page, which is not a studio session.
  if (!location.pathname.startsWith("/studio")) return;
  try {
    const sb = window.seqbaby;
    const st = (sb?.state ?? {}) as EngineState;
    const bpmEl = document.getElementById("bpm") as HTMLInputElement | null;
    const snap = studioSnapshot({
      href: location.href,
      origin: location.origin,
      title: getOpenSong().title,
      bpm: bpmEl ? Number(bpmEl.value) : NaN,
      tracks: st.tracks,
      activePattern: st.activePattern,
      playing: st.playing,
      jam: sb?.jam?.active?.() ?? false,
      now: Date.now(),
    });
    localStorage.setItem(STUDIO_KEY, JSON.stringify(snap));
  } catch {
    /* no storage (a private window): the report goes without it */
  }
}

export default function StudioBreadcrumb() {
  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === "hidden") record();
    };
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", record);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", record);
      record(); // a client-side navigation away fires neither
    };
  }, []);
  return null;
}
