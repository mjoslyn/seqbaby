"use client";

import { useEffect } from "react";
import { listPublicSongs, listSongs, loadSong } from "@/app/songs/actions";
import { setOpenSong, syncSongUrl } from "@/app/songs/openSong";

// Hands the engine the account's songs for the mix view's deck B
// (public/js/mix.js, setMixSource), the way PatchBay hands it the patch bay:
// the engine cannot call a server action, so the shell gives it `list` and
// `load`. Mounted by the account bar for a signed-in visitor only; signed out
// the picker still has this browser's saved sessions, a file and a share link.
//
// And the shell's half of a landing. When deck B becomes the song
// (`seqbaby:mixlanded`), the open-song slot still names the song that was
// open, so the next save would file the landed song as a version of it.
// The slot moves with the studio: onto the landed song when it is one of the
// account's own (so a save is its next version), otherwise to nothing (so a
// save asks for a name). Draws nothing.
type Landed = { title?: string; source?: { kind?: string; id?: string; versionId?: string | null; owned?: boolean } | null };

export default function MixSongs() {
  useEffect(() => {
    const backend = {
      // The account's songs, then everybody's published ones. Either may
      // fail alone: one list is better than none, and both failing is an
      // error the picker shows rather than an empty list.
      list: async () => {
        const [mine, pub] = await Promise.allSettled([listSongs(), listPublicSongs()]);
        if (mine.status === "rejected" && pub.status === "rejected") throw new Error("the song list did not load");
        if (mine.status === "fulfilled" && mine.value.error && pub.status === "rejected") throw new Error(mine.value.error);
        const own = mine.status === "fulfilled" ? mine.value.songs || [] : [];
        const seen = new Set(own.map((s) => s.id));
        return [
          ...own.map((s) => ({
            id: s.id,
            title: s.title,
            note: s.is_template ? "yours · template" : s.is_public ? "yours · public" : "yours",
          })),
          ...(pub.status === "fulfilled" ? pub.value : []).filter((s) => !seen.has(s.id)).map((s) => ({
            id: s.id,
            title: s.title,
            note: [s.by ? `by ${s.by}` : "published", s.bpm ? `${s.bpm} bpm` : ""].filter(Boolean).join(" · "),
          })),
        ];
      },
      load: async (id: string) => {
        const r = await loadSong(id);
        if (r.error || !r.data) throw new Error(r.error || "that song did not load");
        return { session: r.data, title: r.title, versionId: r.versionId ?? null, owned: r.owned !== false };
      },
    };
    const start = () => window.seqbaby?.setMixSource?.(backend);
    if (window.seqbaby) start();
    else window.addEventListener("seqbaby:ready", start, { once: true });

    const onLanded = (e: Event) => {
      const d = (e as CustomEvent<Landed>).detail || {};
      const src = d.source;
      if (src?.kind === "account" && src.id && src.owned) {
        setOpenSong({ id: src.id, title: d.title || "", versionId: src.versionId ?? null, isTemplate: false });
        syncSongUrl(src.id);
      } else {
        setOpenSong({ id: null, title: "", versionId: null, isTemplate: false });
        syncSongUrl(null);
      }
    };
    window.addEventListener("seqbaby:mixlanded", onLanded);
    return () => {
      window.removeEventListener("seqbaby:ready", start);
      window.removeEventListener("seqbaby:mixlanded", onLanded);
      window.seqbaby?.setMixSource?.(null);
    };
  }, []);
  return null;
}
