// Two small helpers for changing an AudioParam that may already be moving.
//
// No imports, deliberately: voices.js and signal.js both need these and sit at
// different depths of the module graph.

/**
 * Freeze `param` at whatever value it has reached at `time` and drop every
 * event scheduled after it, so a ramp that follows starts from the value
 * being heard rather than from the previous ramp's TARGET. `cancelScheduledValues`
 * + `setValueAtTime(lastTarget)` is the usual spelling and it is a pitch tick on
 * every fast legato line: the value snaps forward to where the old ramp was
 * heading, then ramps.
 *
 * Browsers without `cancelAndHoldAtTime` (none current, but the fallback is
 * cheap) get the closest thing: hold at the value the param reports NOW.
 * @param {AudioParam} param @param {number} time
 */
export function holdParamAt(param, time) {
  if (!param) return;
  if (typeof param.cancelAndHoldAtTime === "function") {
    try { param.cancelAndHoldAtTime(time); return; } catch {}
  }
  try {
    param.cancelScheduledValues(time);
    param.setValueAtTime(param.value, time);
  } catch {}
}

/**
 * Stop a source through a short fade on its gain instead of cutting it: a
 * sample or a looped wavetable oscillator stopped at full amplitude is a step,
 * and a step is a click. `gainNode` may be null, in which case this is a plain
 * stop. The fade starts at `now`, which should be the context's current time.
 * @param {AudioScheduledSourceNode} src @param {GainNode|null} gainNode
 * @param {number} now @param {number} [seconds]
 */
export function fadeStop(src, gainNode, now, seconds = 0.006) {
  const g = gainNode?.gain;
  if (g) {
    try {
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(0.0001, now + seconds);
    } catch {}
  }
  try { src.stop(now + (g ? seconds + 0.001 : 0)); } catch {}
}

// ---- one parameter across a pool of voices -----------------------------------
//
// A pooled voice (the Plaits pool, the analog-mono pools in voices.js) has
// one copy of every parameter per voice, and `getAudioParam` can hand back
// only one object. It used to hand back voice 0's and stop there, so an LFO
// or a lane reached one voice of the pool: a modulated chord had one moving
// note and three still ones, and a round-robin line was modulated every
// fourth note. Now the pool ties the other voices' copies to the one it
// returns, and whoever connects a source to it or ramps it does the same to
// each (`fanOf`): lfo.js's connectMod and automation.js's ramp.
//
// A WeakMap rather than a property on the param: a native AudioParam is a
// wrapper the browser owns. The pool ties again on every `getAudioParam`, so
// the answer is always fresh for whoever asked.
const FAN = new WeakMap();

/**
 * Tie the other voices' copies of a parameter to the first one.
 * @template T @param {T} first @param {any[]} rest @returns {T} `first`, for the caller to return
 */
export function tieParams(first, rest) {
  if (first && typeof first === "object") {
    const others = (rest || []).filter(p => p && p !== first);
    if (others.length) FAN.set(first, others);
    else FAN.delete(first);
  }
  return first;
}

/**
 * Every copy of a parameter: the one given, then the ones tied to it.
 * @param {any} param @returns {any[]}
 */
export function fanOf(param) {
  if (!param) return [];
  const rest = typeof param === "object" ? FAN.get(param) : null;
  return rest ? [param, ...rest] : [param];
}
