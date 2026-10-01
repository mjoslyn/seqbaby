"use client";

// Hands the engine the name of the song the studio holds, as the top bar
// shows it, so a bounce is named for it (public/js/bounce.js). The engine may
// not have booted yet, so the latest name waits for `seqbaby:ready`.
let pending: string | null = null;
let waiting = false;

export function tellEngineSongName(name: string | null): void {
  pending = name;
  if (window.seqbaby?.setSongName) {
    window.seqbaby.setSongName(name);
    return;
  }
  if (waiting) return;
  waiting = true;
  window.addEventListener(
    "seqbaby:ready",
    () => {
      waiting = false;
      window.seqbaby?.setSongName?.(pending);
    },
    { once: true },
  );
}
