"use client";

import { useEffect } from "react";
import { loadSong } from "@/app/songs/actions";

// Studio deep-link: /?open=<songId> loads one of your (or a public) songs into
// the engine once it's booted. Used by "fork" and "open from your songs".
export default function OpenSongOnLoad() {
  useEffect(() => {
    const id = new URLSearchParams(location.search).get("open");
    if (!id) return;
    let cancelled = false;

    const run = async () => {
      const res = await loadSong(id);
      if (cancelled || res.error || res.data === undefined) return;
      try {
        window.seqbaby?.applySet(res.data);
      } catch {
        /* engine not ready yet — will retry on seqbaby:ready */
      }
      history.replaceState({}, "", location.origin + location.pathname);
    };

    if (window.seqbaby) {
      run();
    } else {
      const onReady = () => run();
      window.addEventListener("seqbaby:ready", onReady, { once: true });
      return () => {
        cancelled = true;
        window.removeEventListener("seqbaby:ready", onReady);
      };
    }
    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
