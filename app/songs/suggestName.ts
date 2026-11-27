"use client";

import { generateSongName } from "@/app/songs/songName";
import { normalizeTags } from "@/lib/songTags.js";

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
// The same for its tags: a kept turn's genre, offered in the save box of a
// session that has no song to put it on yet.
let composedTags: string[] = [];
let listening = false;

function listen(): void {
  if (listening || typeof window === "undefined") return;
  listening = true;
  const clear = () => { composedTitle = null; composedTags = []; };
  window.addEventListener("seqbaby:newset", clear);
  window.addEventListener("seqbaby:setapplied", clear);
}

export function setComposedTitle(title: string | null): void {
  composedTitle = title && title.trim() ? title.trim().slice(0, 60) : null;
  listen();
}

/** Add a kept turn's tags to what the save box will offer. */
export function addComposedTags(tags: string[]): void {
  composedTags = normalizeTags([...composedTags, ...tags]);
  listen();
}

/** The tags a save box starts with for a session never saved. */
export function suggestSongTags(): string[] {
  return [...composedTags];
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

/**
 * A name for `save new`: the session's generated name, drawn again until it
 * is not the name of the song it is being saved from (`avoid`). A new song
 * offered its source's name reads as saving over it.
 */
export function suggestNewSongName(avoid: string): string {
  const not = avoid.trim().toLowerCase();
  if (composedTitle && composedTitle.toLowerCase() !== not) return composedTitle;
  try {
    const data = window.seqbaby?.serializeSet();
    if (!data) return "";
    for (let salt = 0; salt < 12; salt++) {
      const name = generateSongName(data, salt);
      if (name && name.toLowerCase() !== not) return name;
    }
  } catch {
    /* an empty field, and the save names it */
  }
  return "";
}
