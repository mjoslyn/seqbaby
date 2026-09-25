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
  /**
   * What is open is a TEMPLATE, so the next save detaches: it makes a new song
   * off this one rather than another version of it. Cleared by that save, so
   * only the FIRST save off a template detaches and everything after it is an
   * ordinary version of the new song.
   *
   * Lives here rather than being re-read from the row at save time because both
   * save UIs have to agree, and because the studio can be holding a template
   * nobody opened -- `new` starts from the account's default one.
   */
  isTemplate: boolean;
};

let current: OpenSong = {
  id: null,
  title: "",
  versionId: null,
  isTemplate: false,
};
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

/**
 * Point the address bar at this song (`?open=<id>`), so a refresh or a
 * copied link reopens it -- the studio's half of a song having a URL at
 * all. Called from the moments that OPEN a song (the songs menu, a remix, a
 * version, the `?open=` deep link) and the ones that empty the slot again
 * (`new`, deleting the open song), not from every `setOpenSong` write --
 * the default template applied under a blank session is not something the
 * user opened, and must not hijack the URL out from under it.
 */
export function syncSongUrl(id: string | null): void {
  try {
    const url = new URL(location.href);
    if (id) url.searchParams.set("open", id);
    else url.searchParams.delete("open");
    history.replaceState({}, "", url.toString());
  } catch {
    /* a URL we cannot rewrite is still a song we can hold open */
  }
}
