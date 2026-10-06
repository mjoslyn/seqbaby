/**
 * A parameter written as a 0..1 — the macro pads' way of moving a knob, lifted
 * out of macro.js so that anything else playing a control momentarily (rather
 * than editing it) shares one definition of what that is. Two things carry
 * it:
 *
 *   - **It speaks the automation namespace.** `applyAutomationAtStep` already
 *     knows how to write every one of those keys with a short ramp, so a
 *     momentary move is one call into code that exists.
 *   - **The knob moves.** `.value` is assigned straight through knob.js's
 *     shadowed accessor, so the dial follows without the control's own handler
 *     running — which is what keeps a momentary move out of the stored sound.
 *     `commit` instead dispatches the control's `input` event: "as if you had
 *     moved the knob", so the patch, the p-lock snapshot, undo and a jam all
 *     see it.
 */

import { applyAutomationAtStep } from "./automation.js";
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
