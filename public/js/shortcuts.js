// Keyboard shortcuts: the studio played from the computer keyboard, no mouse.
//
// keyboard.js owns the note keys (a..l, w..o, z/x). Everything here lives on
// the keys it leaves free, so the two never argue about a key:
//
//   space          play / stop
//   ↑ ↓            previous / next track (the one the note keys play)
//   m / shift-m    mute / solo that track
//   r              arm recording. Playing: notes land on the playhead.
//                  Stopped: STEP INPUT, notes land on the cursor.
//   ← →            move the cursor (shift: a beat). → with keys down ties the note on
//   enter          toggle the cursor's step and move on (drums, no pitch needed)
//   backspace/del  clear the step behind / under the cursor
//   1 .. 0         hold to throw an fx on the track: 1 reverb, 2 delay, 3 crush,
//                  4 fuzz, 5 flanger, 6 phaser, 7 chorus, 8 ring mod, 9 shaper, 0 auto-wah
//   shift 1 .. 0   switch that fx on or off for good
//   ?              this list
//
// **A throw is a performance, not an edit**, the macro pads' momentary bargain:
// the level goes up through the automation path while the key is down and back
// on release, the stored fx config never moves, so a save, undo and the p-lock
// snapshot never see it. The stage is held wired into the rack for as long as
// the key is down (`state._fxThrows`, read by signal.js's isStageHeld), since a
// bypassed stage would take the level and make no sound. Reverb and delay let
// go slowly, so a throw leaves a tail rather than a cut.
//
// shift + a number is the opposite: the control's own `input` event, exactly
// the knob dragged there, so it is an edit that saves and undoes.

import { applyAutomationAtStep } from "./automation.js";
import { FX_STAGE_LABELS, FX_STAGE_LEVEL_KEY, fxStageLevel } from "./constants.js";
import { setStatus } from "./dom.js";
import { clearStepAtCursor, extendStepEntry, isDesktopKeyboard, isTypingTarget, moveStepCursor, setKbdRecord, stepInputActive, toggleStepAtCursor } from "./keyboard.js";
import { CLASS_FOR_AUTO } from "./paramTargets.js";
import { setActiveTrack } from "./render.js";
import { state } from "./state.js";
import { ensureAudio } from "./transport.js";

/** @typedef {import("./types.js").Track} Track */

const FX_KEYS = {
  Digit1: "reverb", Digit2: "delay", Digit3: "crush", Digit4: "fuzz", Digit5: "flanger",
  Digit6: "phaser", Digit7: "chorus", Digit8: "ringmod", Digit9: "shaper", Digit0: "autowah",
};
/** How far a throw opens each stage. A stage already set higher stays where it is. */
const THROW_LEVEL = {
  reverb: 0.7, delay: 0.6, crush: 0.9, fuzz: 0.8, flanger: 0.8,
  phaser: 0.8, chorus: 0.8, ringmod: 0.7, shaper: 0.7, autowah: 0.8,
};
const THROW_ATTACK = 0.02;
const THROW_RELEASE = 0.06;
/** Reverb and delay close slowly: the tail is the point of throwing them. */
const TAIL_RELEASE = { reverb: 1.2, delay: 0.8 };

/** code → the throw that key is holding */
const throws = new Map();

function activeTrack() {
  return state.tracks.find(t => t.id === state.activeTrackId) || state.tracks.find(t => t.engineKey !== "bus") || null;
}

// ---- tracks ----------------------------------------------------------------

/** @param {number} d */
function stepTrack(d) {
  const list = state.tracks.filter(t => t.engineKey !== "bus");
  if (!list.length) return;
  const i = list.findIndex(t => t.id === state.activeTrackId);
  const next = list[i < 0 ? 0 : (i + d + list.length) % list.length];
  setActiveTrack(next);
  next.el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  setStatus(`track ${list.indexOf(next) + 1}/${list.length}: ${next.name}`);
}

/** Mute or solo through the track's own button, so every rule the click runs still runs. */
function pressTrackButton(which) {
  const t = activeTrack();
  const btn = t?.el?.querySelector(`.sq-track__${which}`);
  if (!btn) return;
  if (btn.disabled) { setStatus(`${t.name} is ${which === "mute" ? "soloed" : "muted"}. Undo that first`, true); return; }
  btn.click();
  setStatus(`${t.name}: ${which} ${(which === "mute" ? t.muted : t.soloed) ? "on" : "off"}`);
}

// ---- fx --------------------------------------------------------------------

/** The level control of a track's fx stage, wherever its panel currently is. */
function fxControl(t, stage) {
  const cls = CLASS_FOR_AUTO[`fx.${stage}`];
  if (!cls || !t?.el) return null;
  return t.el.querySelector(`.${cls}`)
    || document.querySelector(`[data-track-id="${CSS.escape(String(t.id))}"] .${cls}`);
}

/** Show a level on the knob without running its handler (knob.js repaints on `.value`). */
function showLevel(el, unit) {
  if (!el) return;
  const min = Number(el.min === "" ? 0 : el.min);
  const max = Number(el.max === "" ? 1 : el.max);
  el.value = String(min + unit * (max - min));
}

/** Ramp a stage's level from `from` to `to` on the live graph, leaving the stored config alone. */
function rampStage(t, stage, from, to, dur) {
  const rack = t.fxRack;
  if (!rack || !state.audioCtx) return;
  const lk = FX_STAGE_LEVEL_KEY[stage];
  const stored = rack.config?.[stage]?.[lk];
  try { applyAutomationAtStep(t, `fx.${stage}`, from, state.audioCtx.currentTime, to, dur); } catch {}
  // The automation path writes the level into the config as it goes; put it back.
  if (rack.config?.[stage] && stored != null) rack.config[stage][lk] = stored;
}

async function startThrow(code, stage) {
  const t = activeTrack();
  if (!t) return;
  const rec = { t, stage, from: 0, to: 0, knob: null, knobValue: null, live: false };
  throws.set(code, rec);
  await ensureAudio();
  if (throws.get(code) !== rec || !t.fxRack) { if (throws.get(code) === rec) throws.delete(code); return; }
  rec.from = fxStageLevel(t.fxConfig, stage);
  rec.to = Math.max(rec.from, THROW_LEVEL[stage]);
  state._fxThrows.add(`${t.id}:${stage}`);
  t.fxRack.refreshStageActivity();
  rampStage(t, stage, rec.from, rec.to, THROW_ATTACK);
  rec.knob = fxControl(t, stage);
  rec.knobValue = rec.knob?.value ?? null;
  showLevel(rec.knob, rec.to);
  rec.live = true;
  setStatus(`${t.name}: ${FX_STAGE_LABELS[stage]} throw`);
}

function endThrow(code) {
  const rec = throws.get(code);
  if (!rec) return;
  throws.delete(code);
  if (!rec.live) return;
  const { t, stage } = rec;
  // Another key throwing the same stage on the same track keeps it open.
  for (const other of throws.values()) if (other.live && other.t === t && other.stage === stage) return;
  rampStage(t, stage, rec.to, fxStageLevel(t.fxConfig, stage), TAIL_RELEASE[stage] ?? THROW_RELEASE);
  if (rec.knob && rec.knobValue != null) rec.knob.value = rec.knobValue;
  // Released from the hold after the ramp has landed; the rack's own debounce
  // then decides whether a stage at level 0 leaves the chain.
  setTimeout(() => {
    for (const other of throws.values()) if (other.t === t && other.stage === stage) return;
    state._fxThrows.delete(`${t.id}:${stage}`);
    t.fxRack?.refreshStageActivity();
  }, ((TAIL_RELEASE[stage] ?? THROW_RELEASE) + 0.05) * 1000);
}

function releaseAllThrows() {
  for (const code of [...throws.keys()]) endThrow(code);
}

/** shift + number: switch the stage on at its throw level, or off, as an edit. */
function toggleFx(stage) {
  const t = activeTrack();
  if (!t) return;
  const el = fxControl(t, stage);
  if (!el) { setStatus(`${t.name} has no ${FX_STAGE_LABELS[stage]} control`, true); return; }
  const on = fxStageLevel(t.fxConfig, stage) > 0;
  showLevel(el, on ? 0 : THROW_LEVEL[stage]);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  setStatus(`${t.name}: ${FX_STAGE_LABELS[stage]} ${on ? "off" : "on"}`);
}

// ---- help ------------------------------------------------------------------

const HELP_ROWS = [
  ["a s d f g h j k l", "play notes (w e t y u o: sharps)"],
  ["z / x", "octave down / up"],
  ["space", "play / stop"],
  ["↑ / ↓", "previous / next track"],
  ["m / shift m", "mute / solo the track"],
  ["r", "record. Playing: onto the playhead. Stopped: step input at the cursor"],
  ["← / →", "move the cursor (shift: a beat). → while holding notes: longer note"],
  ["enter", "toggle the step at the cursor"],
  ["backspace / delete", "clear the step behind / under the cursor"],
  ["hold 1 .. 0", "throw an fx: " + Object.values(FX_KEYS).map((s, i) => `${(i + 1) % 10} ${FX_STAGE_LABELS[s]}`).join(", ")],
  ["shift 1 .. 0", "switch that fx on / off"],
  ["ctrl/⌘ z", "undo (shift: redo)"],
  ["?", "this list"],
];

let helpOverlay = null;
function toggleHelp() {
  if (helpOverlay) { helpOverlay.remove(); helpOverlay = null; return; }
  const overlay = document.createElement("div");
  overlay.className = "sq-modal-overlay";
  const rows = HELP_ROWS.map(([k, v]) => `<dt><kbd>${k}</kbd></dt><dd>${v}</dd>`).join("");
  overlay.innerHTML = `
    <div class="sq-modal sq-shortcuts" role="dialog" aria-modal="true" aria-label="keyboard shortcuts">
      <div class="sq-modal__title">keyboard shortcuts</div>
      <dl class="sq-shortcuts__list">${rows}</dl>
      <div class="sq-modal__actions"><button class="sq-modal__ok">done</button></div>
    </div>`;
  const close = () => { overlay.remove(); if (helpOverlay === overlay) helpOverlay = null; };
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  overlay.querySelector(".sq-modal__ok").addEventListener("click", close);
  document.body.appendChild(overlay);
  helpOverlay = overlay;
}

// ---- dispatch --------------------------------------------------------------

/** A focused range the user reached with Tab keeps its own arrow keys; one left focused by a drag does not. */
function ownsArrows(el) {
  if (!el) return false;
  if (el.tagName === "SELECT") return true;
  if (el.tagName === "INPUT" && el.type === "range") {
    try { return el.matches(":focus-visible"); } catch { return false; }
  }
  return false;
}

function onKeyDown(e) {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (!isDesktopKeyboard() || isTypingTarget(e.target)) return;
  const target = /** @type {HTMLElement} */ (e.target);
  const inDialog = !!target?.closest?.('[aria-modal="true"]');

  if (e.key === "Escape" && helpOverlay) { toggleHelp(); e.preventDefault(); return; }
  if (e.key === "?" || (e.code === "Slash" && e.shiftKey)) { if (!e.repeat) toggleHelp(); e.preventDefault(); return; }

  const stage = FX_KEYS[e.code];
  if (stage) {
    e.preventDefault();
    if (e.repeat) return;
    if (e.shiftKey) toggleFx(stage);
    else if (!throws.has(e.code)) startThrow(e.code, stage);
    return;
  }

  // Keys a dialog's own buttons answer to stay theirs.
  if (inDialog && (e.key === " " || e.key === "Enter" || e.key === "Backspace" || e.key === "Delete")) return;

  switch (e.key) {
    case " ":
      e.preventDefault();
      if (e.repeat) return;
      // A focused button would also take the space as a click on keyup.
      if (target && target !== document.body && typeof target.blur === "function") target.blur();
      document.getElementById("play")?.click();
      return;
    case "ArrowUp":
    case "ArrowDown":
      if (ownsArrows(target)) return;
      e.preventDefault();
      stepTrack(e.key === "ArrowUp" ? -1 : 1);
      return;
    case "ArrowLeft":
    case "ArrowRight": {
      if (!stepInputActive() || ownsArrows(target)) return;
      e.preventDefault();
      const d = (e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 4 : 1);
      if (d === 1 && extendStepEntry()) return;
      moveStepCursor(d);
      return;
    }
    case "Enter":
      if (!stepInputActive() || e.repeat) return;
      e.preventDefault();
      toggleStepAtCursor();
      return;
    case "Backspace":
    case "Delete":
      if (!stepInputActive()) return;
      e.preventDefault();
      clearStepAtCursor(e.key === "Backspace");
      return;
  }

  if (e.repeat) return;
  const k = e.key.toLowerCase();
  if (k === "m") { e.preventDefault(); pressTrackButton(e.shiftKey ? "solo" : "mute"); return; }
  if (k === "r" && !e.shiftKey) {
    e.preventDefault();
    // The cursor is drawn on the keyboard's track, so there has to be one.
    if (state.activeTrackId == null) { const t = activeTrack(); if (t) setActiveTrack(t); }
    const on = !state.kbdRecord;
    setKbdRecord(on);
    setStatus(!on ? "recording off"
      : state.playing ? "recording: notes land on the playhead"
      : "step input: notes land on the cursor. ← → move it, enter toggles a step, space plays");
  }
}

function onKeyUp(e) {
  if (throws.has(e.code)) endThrow(e.code);
}

let installed = false;
export function initShortcuts() {
  if (installed) return;
  installed = true;
  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", releaseAllThrows);
}
