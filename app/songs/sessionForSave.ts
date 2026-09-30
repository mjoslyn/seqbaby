// The session as a save writes it: uploaded samples stored first, then
// written as references rather than base64 (public/js/sampleStore.js). One
// helper for every save path in the shell -- the top-bar save, the songs
// menu, compose's autosave -- so none of them can forget the first step and
// send a sample inline that could have been a few bytes.
//
// A sample that could not be stored (no storage on this deploy, the day's
// quota spent, a slow connection) is written inline, exactly as every save
// was before this existed. An engine cached from before `storeSamples`
// shipped simply serializes the old way.
export async function sessionForSave(): Promise<unknown> {
  const engine = window.seqbaby;
  if (!engine) return null;
  try {
    await engine.storeSamples?.();
  } catch {
    /* stays inline */
  }
  return engine.serializeSet({ stored: true });
}
