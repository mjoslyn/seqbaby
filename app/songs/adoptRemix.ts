"use client";

import { loadSong } from "@/app/songs/actions";
import { setOpenSong, syncSongUrl } from "@/app/songs/openSong";

// A remix made in the studio is where you are afterwards: the open-song slot
// names it (so the next save is its v2, not a new song) and the URL follows.
//
// `holdingSource` says the engine already holds what was remixed -- the
// linked song under the byline, or the song / version open in the songs menu.
// Then nothing is loaded: the remix's v1 is that same state, and any hand
// edits since are exactly what the next save should put on top of it.
// Otherwise the remix is loaded, so the studio does not hold one song while
// the slot names another.
export async function adoptRemix(
  remix: { id: string; title?: string; versionId?: string },
  holdingSource: boolean,
): Promise<void> {
  let versionId = remix.versionId ?? null;
  let title = remix.title ?? "remix";
  if (!holdingSource) {
    const res = await loadSong(remix.id);
    if (res.error || res.data === undefined)
      throw new Error(res.error ?? "Remix not found");
    window.seqbaby?.applySet(res.data);
    versionId = res.versionId ?? versionId;
    title = res.title ?? title;
  }
  // A remix is a song of your own, never a template -- even of a template.
  setOpenSong({ id: remix.id, title, versionId, isTemplate: false });
  syncSongUrl(remix.id);
}
