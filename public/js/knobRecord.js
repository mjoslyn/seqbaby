// Recording knob moves into automation lanes.
//
// Record armed (the transport's record button, or vim's insert) with the
// transport playing: turning any knob writes where it is into that track's
// lane for the parameter, on the current pattern, one value per step it passes.
// "Touch" mode, as a DAW has it: while a knob is held the lane stops playing
// and records instead, so holding it still overwrites what was there too; let
// go and the lane plays back what it now holds.
//
// Nothing about the knobs changed for this. It listens to the `input` event
// every control already sends (knob drags, the wheel, vim's `-` / `=`, the
// parameter menu's reset), and the step-by-step write happens in
// runAutomationForStep (automation.js), which reads `t._autRec`: the held
// parameters and where they are, in the 0..1 a lane speaks.

import { canAutomate } from "./automation.js";
import { setStatus } from "./dom.js";
import { hasMacroOn, modOwns, refreshParamIndicators, targetsForControl, trackForControl } from "./paramTargets.js";
import { refreshAutIfOpen } from "./pianoRoll.js";
import { ensureAutomationLane } from "./render.js";
import { state } from "./state.js";
import { AUTOMATION_TARGETS, autoLabel, baseModKey } from "./constants.js";

/** How long a hold outlives its last move when no pointer is down (the wheel,
 *  vim's keys): long enough that one notch after another is one gesture. */
const IDLE_RELEASE_MS = 300;

/** @type {Map<string, {t: any, key: string, last: number}>} "trackId|key" → a live hold */
const holds = new Map();
/** Where a control was when a pointer landed on it, so a new lane is filled
 *  with the sound as it was before the gesture, not after its first move. */
const bases = new WeakMap();
/** Pointers down anywhere: a hold is released when the last one lifts. */
const pointers = new Set();
let raf = 0;

/** A range input's value as a lane's 0..1: the slider's own normalisation
 *  (the lane and the slider share a range by construction, see macro.js). */
function unitOf(el) {
  const min = Number(el.min === "" ? 0 : el.min);
  const max = Number(el.max === "" ? 1 : el.max);
  if (!(max > min)) return null;
  return Math.max(0, Math.min(1, (Number(el.value) - min) / (max - min)));
}

export const knobRecordActive = () => !!state.kbdRecord && !!state.playing;

/** The track and lane key behind a control, if a move on it can be recorded. */
function recordable(el) {
  if (!(el instanceof HTMLInputElement) || el.type !== "range") return null;
  const key = targetsForControl(el)?.auto;
  if (!key || !AUTOMATION_TARGETS[baseModKey(key)]) return null;
  const t = trackForControl(el);
  if (!t || !canAutomate(t, key)) return null;
  return { t, key };
}

let warned = "";
function refuse(t, key, why) {
  const id = `${t.id}|${key}`;
  if (warned === id) return;
  warned = id;
  setStatus(`${autoLabel(key)} on "${t.name}" ${why}, so its moves aren't recorded`, true);
}

function onInput(e) {
  if (!knobRecordActive()) return;
  const hit = recordable(e.target);
  if (!hit) return;
  const { t, key } = hit;
  // One owner per parameter (paramTargets.js): a lane under an LFO or a pad
  // axis would fight it.
  if (modOwns(t, key)) { refuse(t, key, "has an LFO on it"); return; }
  if (hasMacroOn(t, key)) { refuse(t, key, "is on a havoc pad"); return; }
  const unit = unitOf(e.target);
  if (unit == null) return;

  const id = `${t.id}|${key}`;
  if (!holds.has(id)) {
    const existed = !!t.automation?.[key];
    const lane = ensureAutomationLane(t, key);
    if (!existed) {
      const base = bases.get(e.target);
      lane.values.fill(base ?? unit);
    }
    const wasOn = lane.enabled;
    lane.enabled = true;
    if (!existed || !wasOn) { refreshAutIfOpen(t); refreshParamIndicators(t); }
  }
  (t._autRec || (t._autRec = {}))[key] = unit;
  holds.set(id, { t, key, last: performance.now() });
  if (!raf) raf = requestAnimationFrame(tick);
}

function release(id) {
  const h = holds.get(id);
  if (!h) return;
  holds.delete(id);
  if (h.t._autRec) delete h.t._autRec[h.key];
  paintLane(h.t, h.key);
}

function releaseAll() { for (const id of [...holds.keys()]) release(id); }

/** Repaint every lane grid drawn for this track and key (the aut panel, the
 *  roll's lanes, the parameter menu), so the recording shows as it lands. */
function paintLane(t, key) {
  const values = t.automation?.[key]?.values;
  if (!values) return;
  for (const row of document.querySelectorAll(`.sq-aut__lane[data-key="${CSS.escape(key)}"][data-aut-track="${t.id}"]`)) {
    const cells = row.querySelector(".sq-aut__grid")?.children;
    if (!cells) continue;
    for (let i = 0; i < cells.length; i++) cells[i].style.setProperty("--v", String(values[i] ?? 0));
  }
}

function tick() {
  raf = 0;
  if (!knobRecordActive()) { releaseAll(); return; }
  const now = performance.now();
  for (const [id, h] of holds) {
    if (!pointers.size && now - h.last > IDLE_RELEASE_MS) { release(id); continue; }
    paintLane(h.t, h.key);
  }
  if (holds.size) raf = requestAnimationFrame(tick);
}

/** Install once, from init(). Capture phase: the knob's own listeners and the
 *  step grid's stopPropagation must not hide a gesture from it. */
export function installKnobRecord() {
  document.addEventListener("pointerdown", (e) => {
    pointers.add(e.pointerId);
    const el = e.target;
    if (el instanceof HTMLInputElement && el.type === "range") {
      const u = unitOf(el);
      if (u != null) bases.set(el, u);
    }
  }, true);
  const up = (e) => {
    pointers.delete(e.pointerId);
    if (!pointers.size) { releaseAll(); warned = ""; }
  };
  document.addEventListener("pointerup", up, true);
  document.addEventListener("pointercancel", up, true);
  document.addEventListener("input", onInput, true);
}
