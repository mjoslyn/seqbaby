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
