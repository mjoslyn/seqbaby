"use client";

import { generateSongName } from "@/app/songs/songName";

// The name a save field offers for a session that has never been saved.
//
// Both save UIs call this when their popup opens, so the generated name is
// something you can read and edit before pressing save rather than something
// the save springs on you afterwards.
//
// Serializing the session just to name it is cheaper than it looks: the blob
// references the base64 sample payloads, it does not copy them, and the
// generator only reads tempo, scale, engine keys and the steps. It is the same
// call the save itself makes a moment later. Failing is never worth breaking a
// popup over -- an empty string just leaves the field blank, and the save path
// generates a name again anyway.
//
// A compose turn can name the song it made (the `name_song` tool), and when
// the session has never been saved that name is the better offer: it was
// chosen by whatever wrote the song, knowing what it is. Kept here until a
// different session arrives (opened, a share link, `new`), so it never names
// someone else's song.
let composedTitle: string | null = null;
let listening = false;

export function setComposedTitle(title: string | null): void {
  composedTitle = title && title.trim() ? title.trim().slice(0, 60) : null;
  if (listening || typeof window === "undefined") return;
  listening = true;
  const clear = () => { composedTitle = null; };
  window.addEventListener("seqbaby:newset", clear);
  window.addEventListener("seqbaby:setapplied", clear);
}

export function suggestSongName(): string {
  if (composedTitle) return composedTitle;
  try {
    const data = window.seqbaby?.serializeSet();
    return data ? generateSongName(data) : "";
  } catch {
    return "";
  }
}
