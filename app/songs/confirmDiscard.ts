"use client";

// The shell's way into the engine's unsaved-changes prompt (session.js
// `confirmDiscard`): opening a song or a version over the one in the studio
// throws the session away exactly as `new` does, so it asks the same question
// in the same dialog. Resolves true when it may go ahead, which is always the
// answer for an engine too old to ask.
export async function confirmOpen(what: string): Promise<boolean> {
  const ask = window.seqbaby?.confirmDiscard;
  if (!ask) return true;
  return ask({
    title: `open ${what}?`,
    body: `This song has changes that are not saved or shared yet. Opening ${what} replaces it; undo can bring it back until you leave the page.`,
    confirmLabel: "open",
  });
}

/** The studio's session is saved now: `data` is the blob that was written. */
export function markSaved(data: unknown): void {
  window.seqbaby?.markSaved?.(data);
}
