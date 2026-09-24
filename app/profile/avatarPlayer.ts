import { SIZE, type Grid } from "@/app/profile/avatarGrid";

// An avatar is a pattern, so it plays: rows are notes of a pentatonic scale,
// top highest, the playhead walks the columns, and each colour has its own
// waveform. Shared by the editor's play button and every PlayableAvatar.
//
// One at a time across the page: starting a grid stops whichever was playing,
// and tells its owner so (onStep(-1)). A homepage of twenty avatars playing
// over each other would be a joke nobody asked for.

// Two and a bit octaves of minor pentatonic, highest first (row 0 is the top).
const NOTES = [91, 88, 86, 84, 81, 79, 76, 74, 72, 69, 67, 64, 62, 60, 57, 55];
const WAVES: OscillatorType[] = ["triangle", "square", "sawtooth", "sine"];

let current: { ctx: AudioContext; timer: number; onStep: (col: number) => void } | null = null;

export function stopAvatar() {
  if (!current) return;
  const c = current;
  current = null;
  clearInterval(c.timer);
  void c.ctx.close();
  c.onStep(-1);
}

/** Loop `getGrid()` (read per step, so an edit mid-play is heard) until
 *  stopped. Returns the stop function for this player only. */
export function playAvatar(getGrid: () => Grid, onStep: (col: number) => void): () => void {
  stopAvatar();
  const ctx = new AudioContext();
  const out = ctx.createGain();
  out.gain.value = 0.12;
  out.connect(ctx.destination);
  let col = 0;
  const tick = () => {
    const t = ctx.currentTime + 0.02;
    const g = getGrid();
    for (let r = 0; r < SIZE; r++) {
      const v = g.cells[r * SIZE + col];
      if (!v) continue;
      const o = ctx.createOscillator();
      const env = ctx.createGain();
      o.type = WAVES[v % WAVES.length];
      o.frequency.value = 440 * 2 ** ((NOTES[r] - 69) / 12);
      env.gain.setValueAtTime(0.5, t);
      env.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
      o.connect(env).connect(out);
      o.start(t);
      o.stop(t + 0.22);
    }
    onStep(col);
    col = (col + 1) % SIZE;
  };
  void ctx.resume();
  const me = { ctx, timer: 0, onStep };
  current = me;
  tick();
  me.timer = window.setInterval(tick, 125);
  return () => {
    if (current === me) stopAvatar();
  };
}
