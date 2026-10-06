/**
 * Momentary parameter holds — the one mechanism under a macro pad's momentary
 * mode, an fx throw in the perform view, and anything else that pushes a
 * parameter somewhere for as long as a finger is on it and lets it spring
 * back after.
 *
 * It was macro.js's, and moved here so the throw buttons could share it
 * without the pads knowing about them. Three things carry it:
 *
 *   - **It speaks the automation namespace.** `applyAutomationAtStep` already
 *     knows how to write every one of those keys with a short ramp, so a hold
 *     is one call into code that exists.
 *   - **The knob moves.** `.value` is assigned straight through knob.js's
 *     shadowed accessor, so the dial follows without the control's own handler
 *     running — which is what keeps a momentary move out of the stored sound.
 *   - **Non-destructive by snapshot.** `holdParam` records where the parameter
 *     was the first time it is held, and `releaseParam` ramps it back there.
 *     `commit` instead dispatches the control's `input` event: "as if you had
 *     moved the knob", so the patch, the p-lock snapshot, undo and a jam all
 *     see it.
 */

import { applyAutomationAtStep } from "./automation.js";
import { fxStageOfModKey } from "./constants.js";
import { controlForKey } from "./paramTargets.js";
import { state } from "./state.js";

/** @typedef {import("./types.js").Track} Track */

/** Ramp for a live move. Long enough not to zipper, short enough that the
 *  control still feels connected to the finger. */
export const MOMENTARY_RAMP = 0.03;
/** Ramp back to base when a momentary gesture ends. */
export const RELEASE_RAMP = 0.05;

/** A control's value as the 0..1 an automation lane speaks. The lane and the
 *  slider share a range by construction — that is what makes a lane sweeping
 *  0→1 cover the same ground as dragging the slider end to end — so this
 *  inverse is just the slider's own normalisation. */
export function readUnit(t, key) {
  const el = controlForKey(t, key);
  if (!el) return null;
  const min = Number(el.min === "" ? 0 : el.min);
  const max = Number(el.max === "" ? 1 : el.max);
  if (!(max > min)) return null;
  return Math.max(0, Math.min(1, (Number(el.value) - min) / (max - min)));
}

/**
 * Drive one parameter to a 0..1 value: the audio graph through the automation
 * path, and the control itself so the knob follows.
 * @param {Track} t
 * @param {string} key an automation key
 * @param {number} unit 0..1
 * @param {number} ramp seconds
 * @param {boolean} commit dispatch the control's `input` event, making this the
 *   track's actual sound rather than a performance overlay.
 */
export function writeParam(t, key, unit, ramp, commit) {
  const v = Math.max(0, Math.min(1, unit));
  const el = controlForKey(t, key);
  if (el) {
    const min = Number(el.min === "" ? 0 : el.min);
    const max = Number(el.max === "" ? 1 : el.max);
    const step = Number(el.step === "" || el.step === "any" ? 0 : el.step);
    let phys = min + v * (max - min);
    if (step > 0) phys = min + Math.round((phys - min) / step) * step;
    el.value = String(phys);
  }
  if (commit && el) {
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return;
  }
  const ctx = state.audioCtx;
  if (!ctx) {
    // Before the first play there is no graph to write, so the control's own
    // handler is the only path — and it is safe, because nothing is sounding.
    el?.dispatchEvent(new Event("input", { bubbles: true }));
    return;
  }
  try { applyAutomationAtStep(t, key, v, ctx.currentTime, v, ramp); } catch {}
}

// ---- holds ---------------------------------------------------------------
// A hold is keyed by track id and parameter, so two buttons on one parameter
// share one base: the second to let go is the one that puts it back.

/** @type {Map<string, {t: Track, key: string, base: number|null, count: number}>} */
const held = new Map();
const holdKey = (t, key) => `${t.id}:${key}`;

/** Push a parameter to `unit` for as long as something holds it. The first
 *  hold snapshots the base; later ones on the same parameter just move it. */
export function holdParam(t, key, unit, ramp = MOMENTARY_RAMP) {
  const k = holdKey(t, key);
  let h = held.get(k);
  if (!h) {
    h = { t, key, base: readUnit(t, key), count: 0 };
    held.set(k, h);
  }
  h.count++;
  writeParam(t, key, unit, ramp, false);
  // A held stage is wired in whatever its level (signal.js asks
  // stageHeldByHold); the rack re-evaluates only when poked.
  if (h.count === 1 && key.startsWith("fx.")) { try { t.fxRack?.refreshStageActivity?.(); } catch {} }
  return h;
}

/** Let a hold go. The parameter ramps back to its base once nothing holds it;
 *  `commit` makes the held value the sound instead (the latch). */
export function releaseParam(t, key, { commit = false, ramp = RELEASE_RAMP } = {}) {
  const k = holdKey(t, key);
  const h = held.get(k);
  if (!h) return;
  if (--h.count > 0) return;
  held.delete(k);
  if (commit) writeParam(t, key, readUnit(t, key) ?? h.base ?? 0, 0, true);
  else if (h.base != null) writeParam(t, key, h.base, ramp, false);
  // Let the rack see the hold is gone: it keeps the stage a few seconds for
  // the tail and bypasses it then.
  if (key.startsWith("fx.")) { try { t.fxRack?.refreshStageActivity?.(); } catch {} }
}

/** Whether anything is holding this parameter right now. */
export function isHeld(t, key) { return held.has(holdKey(t, key)); }

/** Let go of every hold on a track (the track is going, or the view is). */
export function releaseAllHolds(t = null) {
  for (const h of [...held.values()]) {
    if (t && h.t !== t) continue;
    h.count = 1;
    releaseParam(h.t, h.key);
  }
}

/** Whether a hold is on one of this stage's controls — signal.js keeps a held
 *  stage wired in, as it does for a pad's, or a throw on a bypassed reverb
 *  would move the knob and nothing you can hear. */
export function stageHeldByHold(t, stage) {
  for (const h of held.values()) {
    if (h.t === t && fxStageOfModKey(h.key) === stage) return true;
  }
  return false;
}
