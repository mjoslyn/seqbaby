"use client";

// Which song (and which version of it) the studio currently holds.
//
// Two islands need this and neither owns the other: the songs menu is what
// loads a song or an older version, and the top-bar save is what most people
// press afterwards. Without a shared answer, saving from the top bar after
// opening v2 would extend the tip instead of branching off v2 -- the one thing
// the version tree exists to get right.
//
// Deliberately module state rather than a context: both components are
// independent client islands mounted by a server component, so there is no
// common React parent to hang a provider on.

export type OpenSong = {
  id: string | null;
  title: string;
  /** The version the studio's contents came from -- the next save's parent. */
  versionId: string | null;
};

let current: OpenSong = { id: null, title: "", versionId: null };
const subscribers = new Set<() => void>();

export function getOpenSong(): OpenSong {
  return current;
}

export function setOpenSong(next: Partial<OpenSong>): void {
  current = { ...current, ...next };
  for (const fn of subscribers) fn();
}

export function subscribeOpenSong(fn: () => void): () => void {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}
