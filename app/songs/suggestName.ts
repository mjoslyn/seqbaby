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
// generator only reads tempo, scale, engine keys and step masks. It is the same
// call the save itself makes a moment later. Failing is never worth breaking a
// popup over -- an empty string just leaves the field blank, and the save path
// generates a name again anyway.
export function suggestSongName(): string {
  try {
    const data = window.seqbaby?.serializeSet();
    return data ? generateSongName(data) : "";
  } catch {
    return "";
  }
}
