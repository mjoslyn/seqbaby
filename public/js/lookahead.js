/**
 * A longer lookahead while the main thread has heavy work to do with the
 * transport running (a mix deck being built, landed or ejected).
 *
 * The work is done a track per task, but a task is still tens of milliseconds
 * of main thread (hundreds on a phone). Tone's clock ticks on the main thread
 * and schedules `lookAhead` seconds ahead, so a stall longer than that is
 * audio that never got scheduled. Raising it only schedules further ahead
 * (the ticks in between are still scheduled at their own times) and lowering
 * it after only pauses scheduling until the clock catches up, so neither skips
 * nor doubles a note. Knob moves land that much later meanwhile.
 */
const STRETCHED_LOOKAHEAD = 1.0;
let baseLookAhead = null;   // the studio's own, read the first time it is stretched
let stretched = false;

export function stretchLookAhead() {
  try {
    const ctx = Tone.getContext();
    if (baseLookAhead == null) baseLookAhead = ctx.lookAhead;
    stretched = true;
    ctx.lookAhead = Math.max(baseLookAhead, STRETCHED_LOOKAHEAD);
  } catch {}
}

export function restoreLookAhead() {
  if (!stretched) return;
  stretched = false;
  // After the work already scheduled has been played past, and only if
  // nothing has stretched it again since.
  setTimeout(() => {
    if (stretched || baseLookAhead == null) return;
    try { Tone.getContext().lookAhead = baseLookAhead; } catch {}
  }, STRETCHED_LOOKAHEAD * 1000 + 200);
}
