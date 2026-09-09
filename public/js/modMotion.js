/**
 * Live modulation on the knobs — the second needle.
 *
 * An LFO and an automation lane both write AROUND the slider rather than to
 * it: the slider stays the base you set, and the modulation is summed onto the
 * AudioParam underneath. That is the right arrangement (see lfo.js), and it
 * left the interface saying nothing — a filter being swept four times a bar
 * drew exactly the same knob as one sitting still, and the only clue was the
 * coloured dot beside the label, which says THAT something is moving it but
 * never where it has got to.
 *
 * So this: one rAF loop that works out where each driven parameter actually is
 * and hands it to `setKnobMotion`, which draws a needle in the same colour as
 * that dot. The slider is untouched — nothing here writes a value, and the
 * needle disappears the moment the modulation is removed.
 *
 * Where the numbers come from, per kind of target:
 *
 *   - **automation** is exact. `runAutomationForStep` records the segment it
 *     just scheduled (`t._autoLive`) and this interpolates it at the audio
 *     time now being heard, so the needle steps with the part rather than with
 *     the scheduler's lookahead.
 *   - **setter-driven LFOs** (the fx sub-params, the grain controls, euclid's
 *     counts) are exact too: that loop already computes a value in the
 *     slider's own 0..1 and records it (`t._modLive`).
 *   - **AudioParam LFOs** are computed from the shape, because a Tone.LFO
 *     free-runs inside the audio graph with nothing to read back — a param
 *     with a signal connected still reports only its intrinsic value. Rate,
 *     depth and shape are therefore right and the phase is the display's own.
 *
 * A macro pad is deliberately absent: a pad moves the real knob (macro.js), so
 * there is nothing for a shadow to add.
 */

import { LFO_AMP_SCALE } from "./constants.js";
import { shaperPreampGain } from "./curves.js";
import { setKnobMotion } from "./knob.js";
import { SETTER_LFO_KEYS, lfoBipolar, lfoLiftNow } from "./lfo.js";
import { state } from "./state.js";
import { visualOutputLatency } from "./transport.js";

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// ---- depth in the target's units → distance along the knob ---------------
// `LFO_AMP_SCALE` measures an LFO's depth in whatever units the AudioParam it
// drives is in — Hz for a cutoff, seconds for a delay time, a gain for a fuzz
// drive — while the needle has to be placed in the units the knob is drawn in.
// For most targets those are the same thing (a 0..1 knob on a 0..1 param, and
// every hexop / guitar / bass / contagion control, whose scale IS its knob's range),
// so the knob's own min..max is the divisor and there is nothing to say.
//
// These are the ones where they differ: how much of the target's unit one full
// sweep of the knob covers.
const PARAM_SPAN = {
  reson: 19.5,            // Q 0.5 → 20
  silverbox_tune: 1,          // the knob reads in cents, the param in semitones
  fuzz_drive: 30,         // gain 1 → 31
  fuzz_tone: 7800,        // Hz 200 → 8000
  fuzz_level: 0.9,        // gain 0 → 0.9
  vinyl_warmth: -7200,    // Hz 9000 → 1800: warmth turns the top DOWN
  chorus_rate: 4.9,       // Hz 0.1 → 5
  phaser_rate: 3.95,      // Hz 0.05 → 4
  flanger_rate: 3.95,
  flanger_fbk: 0.9,
};

// And the three that aren't linear at all, so a fixed distance in the param's
// units is a different distance along the knob depending on where the knob is.
// A cutoff sweep of 3kHz is most of the dial down at 200Hz and barely a nudge
// up at 15k, which is the whole reason the slider is exponential in the first
// place.
const PARAM_CURVE = {
  cutoff: {
    to: (u) => 60 * Math.pow(20000 / 60, u),
    from: (hz) => Math.log(Math.max(1e-6, hz) / 60) / Math.log(20000 / 60),
  },
  ring_freq: {
    to: (u) => 20 * Math.pow(150, u),
    from: (hz) => Math.log(Math.max(1e-6, hz) / 20) / Math.log(150),
  },
  shaper_preamp: {
    to: shaperPreampGain,
    from: (g) => (g <= 1 ? (g - 0.25) / 1.5 : 0.5 + Math.log(Math.max(1e-6, g)) / Math.log(8) / 2),
  },
};

/** Move `base` (0..1 of the knob) by `off`, which is in the target's units. */
function offsetUnit(key, base, off, knobSpan) {
  const curve = PARAM_CURVE[key];
  if (curve) return curve.from(curve.to(base) + off);
  const span = PARAM_SPAN[key] ?? knobSpan;
  return span ? base + off / span : base;
}

// ---- where each kind of modulation has got to ---------------------------

/** @param {import("./types.js").Track} t */
function lfoUnit(t, key, base, knobSpan, now, dt) {
  // The setter loop writes these in the slider's own 0..1 and records what it
  // wrote, so there is nothing to convert and no second phase to keep.
  if (SETTER_LFO_KEYS.has(key)) return t._modLive?.[key] ?? null;
  // Nothing is connected until the voice exists, so an LFO switched on before
  // the first play is enabled but not yet running.
  if (!t.lfos?.[key]) return null;
  const lift = lfoLiftNow(t, key, now, dt);
  if (lift == null) return null;
  const cfg = t.lfoConfig[key];
  const amt = (cfg.depth ?? 0) * (LFO_AMP_SCALE[key] ?? 1);
  return offsetUnit(key, base, (lfoBipolar(cfg) ? lift - 0.5 : lift) * amt, knobSpan);
}

/** @param {import("./types.js").Track} t */
function autoUnit(t, key, audibleNow) {
  const seg = t._autoLive?.[key];
  if (!seg) return null;
  // Lane values are already the control's own travel — that is what makes a
  // lane drawn against a slider mean the same thing as the slider.
  const span = seg.t1 - seg.t0;
  const p = span > 0 ? clamp01((audibleNow - seg.t0) / span) : 1;
  return seg.from + (seg.to - seg.from) * p;
}

// ---- the loop -----------------------------------------------------------
// Permanently running rather than started and stopped with the modulation.
// The work when nothing is driven is one property read per track, and the
// alternative — waking the loop from wherever an LFO or a lane is switched on
// — would mean paramTargets.js and lfo.js both reaching into this module to
// say so. rAF is paused when the tab is hidden either way.

/** @type {Set<HTMLInputElement>} */
const painted = new Set();
let started = false;
let lastT = 0;

/** Start drawing live modulation on the knobs. Called once, from init(). */
export function startModMotion() {
  if (started) return;
  started = true;
  lastT = state.audioCtx?.currentTime ?? performance.now() / 1000;
  const tick = () => {
    requestAnimationFrame(tick);
    const now = state.audioCtx?.currentTime ?? performance.now() / 1000;
    // Clamped for the same reason the setter loop clamps: a backgrounded tab
    // comes back with a gap that would throw a running phase a long way on.
    const dt = Math.max(0, Math.min(0.1, now - lastT));
    lastT = now;
    const audibleNow = now - visualOutputLatency();
    const seen = new Set();
    for (const t of state.tracks) {
      const ctls = t._motionCtls;
      if (!ctls?.length) continue;
      for (const { el, kind, key } of ctls) {
        const k = el._knob;
        // A modal's copies of a track's controls go away with the modal, and
        // the lists are only rebuilt when something changes the modulation —
        // so drop what is no longer on the page rather than painting it.
        if (!k || !el.isConnected) continue;
        const knobSpan = k.max - k.min;
        const base = knobSpan > 0 ? clamp01((Number(el.value) - k.min) / knobSpan) : 0;
        const u = kind === "mod"
          ? lfoUnit(t, key, base, knobSpan, now, dt)
          : autoUnit(t, key, audibleNow);
        if (u == null) { setKnobMotion(el, null); painted.delete(el); continue; }
        setKnobMotion(el, u);
        painted.add(el);
        seen.add(el);
      }
    }
    // A control drops out of the lists when its modulation is removed, its
    // track is rebuilt or its panel is thrown away, and nobody tells us — so
    // whatever was drawn last frame and isn't in them now gets cleared.
    if (seen.size !== painted.size) {
      for (const el of painted) {
        if (!seen.has(el)) { setKnobMotion(el, null); painted.delete(el); }
      }
    }
  };
  requestAnimationFrame(tick);
}
