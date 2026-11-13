// The arithmetic of a transition between the song playing and another one
// (transition.js): when it lands, how the tempo travels, how far the sweep has
// closed. No imports, so `node --test` runs it (test/transition.test.js).

export const TRANSITION_SHAPES = ["cut", "sweep"];
export const TRANSITION_BARS = [1, 2, 4, 8];
export const TRANSITION_TEMPOS = ["auto", "jump", "ramp"];
export const TRANSITION_WHENS = ["bar", "now"];

/** What an unset or hand-edited setting means. */
export function normalizeTransition(o = {}) {
  const when = TRANSITION_WHENS.includes(o.when) ? o.when : "bar";
  const shape = TRANSITION_SHAPES.includes(o.shape) ? o.shape : "cut";
  const bars = TRANSITION_BARS.includes(Number(o.bars)) ? Number(o.bars) : 2;
  const tempo = TRANSITION_TEMPOS.includes(o.tempo) ? o.tempo : "auto";
  return { when, shape, bars, tempo };
}

/**
 * How the tempo gets from `from` to `to`. A cut has no time to travel in, so
 * it jumps. Auto ramps a small difference (within RAMP_SPAN of the old tempo)
 * and jumps a half / double time pair (the beat already lines up) or a large
 * gap, where a glide is a tape slowing down rather than a mix.
 */
export const RAMP_SPAN = 0.15;
export function tempoMode(mode, from, to, shape) {
  if (!(from > 0) || !(to > 0) || from === to) return "none";
  if (shape === "cut") return "jump";
  if (mode === "jump" || mode === "ramp") return mode;
  const r = to / from;
  if (Math.abs(r - 2) < 0.06 || Math.abs(r - 0.5) < 0.03) return "jump";
  return Math.abs(r - 1) <= RAMP_SPAN ? "ramp" : "jump";
}

/**
 * Steps from now until the transition lands, on a bar line.
 *   bar, cut   the next bar line
 *   bar, sweep the bar line `bars` bars after the next one (the sweep runs
 *              across those whole bars)
 *   now, cut   0: lands at once
 *   now, sweep the bar line ending `bars` bars counted from here, the bar
 *              we are in counting as one only when at least half is left
 * `barTick` is where in its bar the next step falls (0 = on the bar line).
 * Returns `{ wait, run }`: steps before the sweep starts, then steps it runs.
 */
export function transitionSteps({ when, shape, bars }, barLen, barTick) {
  barLen = Math.max(1, barLen | 0);
  const pos = ((barTick % barLen) + barLen) % barLen;
  const toLine = pos === 0 ? 0 : barLen - pos;
  if (shape === "cut") {
    if (when === "now") return { wait: 0, run: 0 };
    return { wait: toLine, run: 0 };
  }
  if (when === "bar") return { wait: toLine, run: bars * barLen };
  let run = toLine + (bars - 1) * barLen;
  if (toLine === 0) run = bars * barLen;
  else if (toLine < barLen / 2) run += barLen;
  return { wait: 0, run };
}

/** The tempo `p` (0..1) of the way through a ramp. */
export function rampBpm(from, to, p) {
  const q = Math.min(1, Math.max(0, p));
  return from + (to - from) * q;
}

/**
 * The sweep's cutoff `p` of the way down, in hertz: exponential in pitch, so
 * it moves evenly to the ear, and slow at first (p^1.6) so the first bar is a
 * hint and the last one the dive.
 */
export const SWEEP_TOP = 20000;
export const SWEEP_BOTTOM = 280;
export function sweepHz(p) {
  const q = Math.min(1, Math.max(0, p));
  return SWEEP_TOP * Math.pow(SWEEP_BOTTOM / SWEEP_TOP, Math.pow(q, 1.6));
}

/** Steps the filter takes to open again after landing: a bar, or a half for a one-bar sweep. */
export function openSteps(bars, barLen) {
  return Math.max(1, bars <= 1 ? Math.round(barLen / 2) : barLen);
}
