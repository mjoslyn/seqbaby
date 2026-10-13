/**
 * The piano view: one track's pattern as a full-height piano roll, in the
 * manner of FL Studio's. A keyboard down the left (click a key to hear it),
 * bars across the top, the notes as bars you draw, drag, stretch and paint,
 * the other tracks' notes behind them as ghosts, and the velocity stalks
 * under it all. The fourth view beside groove, clips and arrange (views.js).
 *
 * What it edits is the track's pattern, the one it is on (`trackSlot`), and
 * the track is the keyboard's (`state.activeTrackId`), so the computer keys
 * play what is shown. A pattern stores notes per step (track.js), so every
 * edit here reads the pattern as a free list of notes (rollNotes.js), changes
 * the list, and folds it back: notes starting on one step stack on it, and
 * notes may overlap (a new note never shortens one it lands on).
 * Moving a note moves its step's chord, arp, ratchet and nudge with it.
 *
 * Gestures (the tools are the toolbar's, since the letters FL gives them are
 * the computer keyboard's piano keys here):
 *   draw    click empty: a note of the last length used, dragged into place
 *           drag a note: move it (a selected note moves the selection)
 *           drag its right edge: resize   shift-drag: copy
 *   paint   drag across: a note every length, at the row under the pointer
 *   erase   click or sweep: delete (right-click and right-drag, any tool)
 *   select  drag: a box; click a note: select it (shift adds)
 *   any     ctrl/⌘-drag: a box   double-click a note: its step editor
 * Keys, with nothing focused: delete removes the selection, ↑ ↓ transpose it
 * (shift: an octave), ← → move it by the snap (shift: a bar), ctrl/⌘-A
 * selects all, ctrl/⌘-B duplicates the selection after itself, escape lets go.
 *
 * "scale only", with a scale switched on, folds the roll to the scale's rows,
 * so a note drawn is in key and a drag up or down moves by scale degree (↑ ↓
 * too). A note already off the scale sits on the row below it, outlined.
 *
 * Chords come from the top bar's chord mode, the same one the computer
 * keyboard and a step click use: with it on, a click (or a paint stroke)
 * draws the chord, in key when the scale is on. A chord type is stored as
 * the root's chord and voicing (the step's, as the step editor sets it) and
 * drawn as dashed tones under the root; an in-key voicing that is no chord
 * type is written as the root plus extras. `apply chord` puts it on the
 * selected notes (or takes their chords off when chord mode is off).
 *
 * Notes drawn past the pattern's end make it longer, to the next bar line.
 * Every edit is committed on release, so a drag is one undo step (history.js
 * watches the pointerup) and the view is rebuilt from the pattern afterwards.
 */

import { launchClip } from "./clips.js";
import { PATTERN_COUNT } from "./constants.js";
import { setStatus } from "./dom.js";
import { chordSelectionFor, hitOptsFor, isTypingTarget } from "./keyboard.js";
import { patternMeter, stepsPerBarForMeter, stepsPerBeatForMeter } from "./meter.js";
import { refreshRollIfOpen } from "./pianoRoll.js";
import { setActiveTrack } from "./render.js";
import { pitchesAt, readNotes, writeNotes } from "./rollNotes.js";
import { holdNoiseBed } from "./signal.js";
import { invertChord, state, trackSlot } from "./state.js";
import { openStepEditor } from "./stepEditor.js";
import { renderStepGrid } from "./stepGrid.js";
import { liveGeneratorOf } from "./stepSource.js";
import { SCALES, chordNotes, midiToName } from "./theory.js";
import { extendPatternByDuplicate, resizePattern, truncatePattern } from "./track.js";
import { trackHue } from "./trackDetail.js";
import { ensureAudio, wakeMasterBus } from "./transport.js";
import { onViewChange } from "./views.js";

const LO = 24;                 // C1
const HI = 108;                // C8
const ZX = [8, 12, 16, 22, 30, 42];   // px per step
const ZY = [9, 12, 15, 19];           // px per row
const MAX_LEN = 128;
const BLACK = new Set([1, 3, 6, 8, 10]);
const TOOLS = [
  ["draw", "✎ draw", "draw: click to place a note of the last length you used and drag it into place; drag a note to move it, its right edge to resize; shift-drag copies; double-click opens its step editor"],
  ["paint", "▤ paint", "paint: drag across to lay a note every length, at the row under the pointer"],
  ["erase", "✕ erase", "erase: click or sweep across notes to delete them (right-click and right-drag delete with any tool)"],
  ["select", "⬚ select", "select: drag a box around notes, click one to pick it (shift adds); drag the selection to move it. The arrows move it, delete removes it"],
];
const SNAPS = [["step", "step"], ["half", "½ beat"], ["beat", "beat"], ["bar", "bar"]];
const PREF_KEY = "seqbaby.piano.v1";

let root = null;
let raf = 0;
let headRaf = 0;
let pref = readPref();
/** @type {import("./rollNotes.js").RollNote[]} the shown track's notes */
let notes = [];
/** @type {Set<string>} the selection, by `start:pitch` (one note per pair) */
let sel = new Set();
let drag = null;
let shownId = null;
let litKey = "";
let keepMem = false;
let lastDown = { at: 0, key: "" };             // a zoom has already written where the scroll goes
const lastLen = new Map();       // track id -> the length a new note takes
const scrollMem = new Map();     // track id -> {x, y}

function readPref() {
  const d = { tool: "draw", snap: "step", zx: 3, zy: 1, ghosts: true, fold: false };
  try { return { ...d, ...JSON.parse(localStorage.getItem(PREF_KEY) || "{}") }; } catch { return d; }
}
function savePref() { try { localStorage.setItem(PREF_KEY, JSON.stringify(pref)); } catch {} }

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const rows = () => state.tracks.filter((t) => t.engineKey !== "bus");
const key = (n) => `${n.start}:${n.pitch}`;
const SW = () => ZX[Math.max(0, Math.min(ZX.length - 1, pref.zx))];
const RH = () => ZY[Math.max(0, Math.min(ZY.length - 1, pref.zy))];

// The pitches drawn as rows, top down: every semitone, or with "scale only"
// on (and a scale switched on) only the scale's, FL's fold. Rebuilt by each
// render, so they hold still through a drag.
let rowPitches = [];
let rowIdx = new Map();
const scaleIntervals = () => (state.scale.active ? (SCALES[state.scale.mode] || null) : null);
function inScale(p) {
  const sc = scaleIntervals();
  return !sc || sc.some((i) => Math.abs(i - (((p - state.scale.root) % 12) + 12) % 12) < 1e-6);
}
const folded = () => !!(pref.fold && scaleIntervals());
function buildRows() {
  rowPitches = [];
  for (let p = HI; p >= LO; p--) if (!folded() || inScale(p)) rowPitches.push(p);
  if (!rowPitches.length) for (let p = HI; p >= LO; p--) rowPitches.push(p);
  rowIdx = new Map(rowPitches.map((p, i) => [p, i]));
}
/** A pitch's row; one off the rows (off the scale) sits on the row below it. */
function rowOf(p) {
  const i = rowIdx.get(p);
  if (i != null) return i;
  for (let j = 0; j < rowPitches.length; j++) if (rowPitches[j] <= p) return j;
  return rowPitches.length - 1;
}
const onRow = (p) => rowIdx.has(p);
const yOf = (p) => rowOf(p) * RH();
/** A pitch moved `d` rows down (up when negative): semitones, or scale degrees when folded. */
function shiftRows(p, d) {
  if (!folded()) return p - d;
  return rowPitches[Math.max(0, Math.min(rowPitches.length - 1, rowOf(p) + d))];
}
/** The row move a group can make without any note leaving the rows. */
function clampRows(ps, d) {
  const idx = ps.map(rowOf);
  return Math.max(-Math.min(...idx), Math.min(rowPitches.length - 1 - Math.max(...idx), d));
}

function currentTrack() {
  let t = state.tracks.find((o) => o.id === state.activeTrackId);
  if (!t || t.engineKey === "bus") t = rows()[0] || null;
  return t;
}
function meterOf(t) {
  const m = patternMeter(trackSlot(t));
  return { bar: stepsPerBarForMeter(m), beat: stepsPerBeatForMeter(m) };
}
function snapUnit(t) {
  const { bar, beat } = meterOf(t);
  if (pref.snap === "bar") return bar;
  if (pref.snap === "beat") return beat;
  if (pref.snap === "half") return Math.max(1, Math.round(beat / 2));
  return 1;
}
/**
 * Steps drawn: the pattern, then two bars past the next bar line to draw
 * into, and whole bars beyond that to fill the view's width.
 */
function viewSteps(t) {
  const { bar } = meterOf(t);
  const len = t.steps.length;
  const fit = Math.ceil(Math.max(0, (root?.clientWidth ?? 0) - 100) / SW() / bar) * bar;
  return Math.min(MAX_LEN, Math.max(len, Math.ceil(len / bar) * bar + 2 * bar, fit));
}
const lenFor = (t) => lastLen.get(t.id) ?? Math.max(1, Math.min(4, meterOf(t).beat));

export function installPianoView() {
  root = document.getElementById("piano");
  if (!root) return;
  root.addEventListener("click", onClick);
  root.addEventListener("change", onChange);
  root.addEventListener("pointerdown", onPointerDown);
  root.addEventListener("contextmenu", (e) => { if (e.target.closest(".sq-pr__field")) e.preventDefault(); });
  root.addEventListener("wheel", onWheel, { passive: false });
  root.addEventListener("scroll", onScroll, true);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerUp);
  window.addEventListener("keydown", onKey);
  // the scale decides the folded rows and which rows are tinted
  document.addEventListener("change", (e) => { if (/^scale-(on|root|mode)$/.test(e.target?.id || "")) schedulePianoPaint(); });
  onViewChange((v) => { if (v === "piano") { render(); headLoop(); } });
  for (const ev of ["seqbaby:clips", "seqbaby:songedited", "seqbaby:setapplied", "seqbaby:newset", "seqbaby:transport"]) {
    window.addEventListener(ev, schedulePianoPaint);
  }
}

/** Repaint on the next frame, if this is the open view. */
export function schedulePianoPaint() {
  if (state.view !== "piano" || !root || raf) return;
  raf = requestAnimationFrame(() => { raf = 0; render(); });
}

// ---- drawing -------------------------------------------------------------

function render() {
  if (!root || drag) return;
  const sc = root.querySelector(".sq-pr__scroll");
  if (sc && shownId != null && !keepMem) scrollMem.set(shownId, { x: sc.scrollLeft, y: sc.scrollTop });
  keepMem = false;
  const t = currentTrack();
  if (!t) { root.innerHTML = `<p class="sq-pr__empty">no tracks to edit</p>`; shownId = null; return; }
  if (t.id !== shownId) sel = new Set();
  buildRows();
  notes = readNotes(t);
  const have = new Set(notes.map(key));
  sel = new Set([...sel].filter((k) => have.has(k)));

  const sw = SW(), rh = RH();
  const steps = viewSteps(t);
  const len = t.steps.length;
  const { bar, beat } = meterOf(t);
  const W = steps * sw, H = rowPitches.length * rh;
  const [hue, color] = trackHue(t);
  const slot = trackSlot(t);
  const scale = scaleIntervals();
  const fold = folded();
  const hidden = (p) => p < LO || p > HI || (fold && !onRow(p));

  let keys = "", lanes = "";
  for (const p of rowPitches) {
    const pc = ((p % 12) + 12) % 12;
    const black = BLACK.has(pc);
    const out = !inScale(p);
    const isRoot = scale && pc === ((state.scale.root % 12) + 12) % 12;
    const y = yOf(p);
    keys += `<div class="sq-pr__key${black ? " is-black" : ""}${pc === 0 ? " is-c" : ""}" data-p="${p}" style="top:${y}px;height:${rh}px" title="${midiToName(p)}">${pc === 0 && rh >= 10 ? midiToName(p) : ""}</div>`;
    lanes += `<div class="sq-pr__row${black ? " is-black" : ""}${pc === 0 ? " is-c" : ""}${out ? " is-out" : ""}${isRoot ? " is-root" : ""}" style="top:${y}px;height:${rh}px"></div>`;
  }
  let ruler = "";
  for (let b = 0; b * bar < steps; b++) {
    ruler += `<div class="sq-pr__rbar${b * bar >= len ? " is-past" : ""}" style="left:${b * bar * sw}px;width:${bar * sw}px">${b + 1}</div>`;
  }

  // the other tracks' notes, behind, tiled as each loops
  let ghosts = "";
  if (pref.ghosts) {
    for (const o of rows()) {
      if (o === t || o.isDrumKit || !o.steps?.length) continue;
      const on = readNotes(o);
      if (!on.length) continue;
      const k = (t.speed ?? 1) / Math.max(0.0001, o.speed ?? 1);    // o's steps in t's
      const period = o.steps.length * k;
      const gc = trackHue(o)[1];
      let count = 0;
      for (let rep = 0; rep * period < steps && count < 800; rep++) {
        for (const n of on) {
          const x = (rep * period + n.start * k) * sw;
          if (x >= W || hidden(n.pitch)) continue;
          ghosts += `<div class="sq-pr__ghost" data-track="${o.id}" style="left:${x}px;top:${yOf(n.pitch)}px;width:${Math.max(2, n.len * k * sw - 1)}px;height:${rh}px;--g-c:${gc}" title="${esc(o.name)}"></div>`;
          count++;
        }
      }
    }
  }
  // chord tones a root plays, drawn under it (not editable: they are the chord's)
  const tones = notes.map((n, i) => (n.root && n.chord ? toneEls(n, i) : "")).join("");
  const noteEls = notes.map((n, i) => {
    const w = n.len * sw - 1;
    const label = w >= 24 && rh >= 11 ? `${midiToName(n.pitch)}${n.chord ? ` ${n.chord}` : ""}` : "";
    const off = fold && !onRow(n.pitch);
    // an inversion lifts the root an octave: its bar is where it is written, not what sounds
    const lifted = n.root && n.chord && !tonesOf(n).some((p) => Math.abs(p - n.pitch) < 1e-6);
    return `<div class="sq-pr__note${sel.has(key(n)) ? " is-sel" : ""}${n.root ? "" : " is-extra"}${off ? " is-off" : ""}${lifted ? " is-lifted" : ""}" data-i="${i}"${off ? ` title="${midiToName(n.pitch)} is off the scale: drawn on the row below it"` : lifted ? ` title="${midiToName(n.pitch)} ${esc(n.chord)}, inversion ${n.cpx}: the root sounds an octave up"` : ""} style="left:${n.start * sw}px;top:${yOf(n.pitch)}px;width:${w}px;height:${rh}px;--vel:${n.vel.toFixed(3)}"><span>${esc(label)}</span><i class="sq-pr__edge"></i></div>`;
  }).join("");
  const stalks = notes.filter((n) => n.root).map((n) =>
    `<i class="sq-pr__stalk" data-s="${n.start}" style="left:${n.start * sw}px;height:${Math.round(n.vel * 100)}%"></i>`).join("");

  const gen = liveGeneratorOf(t);
  const trackOpts = rows().map((o) => `<option value="${o.id}"${o === t ? " selected" : ""}>${esc(o.name || "track")}</option>`).join("");
  const slotOpts = Array.from({ length: PATTERN_COUNT }, (_, i) =>
    `<option value="${i}"${i === slot ? " selected" : ""}>pattern ${i + 1}${t.patterns?.[i]?.steps?.some(Boolean) ? " •" : ""}</option>`).join("");
  const bars = len / bar;

  root.innerHTML = `
    <div class="sq-pr__bar">
      <select class="sq-pr__track" data-act="track" title="the track being edited (the computer keyboard plays it too)" aria-label="track">${trackOpts}</select>
      <select class="sq-pr__slot" data-act="slot" title="the pattern this track is on; picking another launches it on this track" aria-label="pattern">${slotOpts}</select>
      <span class="sq-pr__tools" role="group" aria-label="tool">${TOOLS.map(([k, label, title]) =>
        `<button type="button" data-tool="${k}" aria-pressed="${pref.tool === k}" title="${esc(title)}">${label}</button>`).join("")}</span>
      <label class="sq-pr__snap" title="where notes land and how far they move">snap <select data-act="snap">${SNAPS.map(([k, l]) =>
        `<option value="${k}"${pref.snap === k ? " selected" : ""}>${l}</option>`).join("")}</select></label>
      <button type="button" class="sq-btn--ghost" data-act="chordsel" title="apply chord: put the chord bar's chord (type and voicing, or in key with the scale on) on the selected notes. With chord mode off it takes their chords away. New notes take the chord bar's chord as they are drawn">apply chord</button>
      <span class="sq-pr__len" title="the pattern's length">${len} steps · ${Number.isInteger(bars) ? bars : bars.toFixed(2)} bar${bars === 1 ? "" : "s"}
        <button type="button" class="sq-btn--ghost" data-act="len-" title="one bar shorter">−bar</button><button type="button" class="sq-btn--ghost" data-act="len+" title="one bar longer, empty">+bar</button><button type="button" class="sq-btn--ghost" data-act="x2" title="double the length, tiling what is there">x2</button></span>
      <button type="button" class="sq-pr__foldbtn" data-act="fold" aria-pressed="${fold}"${scale ? "" : " disabled"} title="${scale
        ? "scale only: show just the scale's rows, so every note you draw is in key and dragging up or down moves by scale degree"
        : "scale only: switch the scale on (top bar) to fold the roll to its notes"}">scale only</button>
      <button type="button" class="sq-pr__ghostbtn" data-act="ghosts" aria-pressed="${!!pref.ghosts}" title="ghosts: the other melodic tracks' notes, faint, behind this one's">ghosts</button>
      <span class="sq-pr__zoom" title="zoom (ctrl/⌘-wheel zooms across)">↔<button type="button" class="sq-btn--ghost" data-act="zx-">−</button><button type="button" class="sq-btn--ghost" data-act="zx+">+</button>
        ↕<button type="button" class="sq-btn--ghost" data-act="zy-">−</button><button type="button" class="sq-btn--ghost" data-act="zy+">+</button></span>
      <button type="button" class="sq-pr__play${state.playing ? " is-playing" : ""}" data-act="play">${state.playing ? "stop" : "play"}</button>
      ${gen ? `<span class="sq-pr__warn">live ${gen} is on: it decides the rhythm, not these notes</span>` : ""}
      ${t._clipOff ? `<span class="sq-pr__warn">this track's clip is stopped</span>` : ""}
    </div>
    <div class="sq-pr__scroll">
      <div class="sq-pr__canvas" style="--sw:${sw}px;--rh:${rh}px;--beat:${beat};--barn:${bar};--track-hue:${hue};--track-color:${color};grid-template-columns:var(--pr-keys) ${W}px;grid-template-rows:var(--pr-ruler) ${H}px">
        <div class="sq-pr__corner">${esc(t.name || "track")}</div>
        <div class="sq-pr__ruler">${ruler}</div>
        <div class="sq-pr__keys" title="click or drag down the keys to hear them">${keys}</div>
        <div class="sq-pr__field">
          ${lanes}
          <div class="sq-pr__lines"></div>
          ${len < steps ? `<div class="sq-pr__past" style="left:${len * sw}px;width:${(steps - len) * sw}px" title="past the pattern's end: a note drawn here makes it longer"></div>` : ""}
          ${ghosts}${tones}${noteEls}
          <div class="sq-pr__marquee" hidden></div>
          <div class="sq-pr__head" hidden></div>
        </div>
      </div>
    </div>
    <div class="sq-pr__vel">
      <div class="sq-pr__vel-label" title="each step's velocity: drag across the stalks to draw it">velocity</div>
      <div class="sq-pr__vel-clip"><div class="sq-pr__vel-inner" style="width:${W}px;--sw:${sw}px;--beat:${beat};--barn:${bar};--track-color:${color}">${stalks}</div></div>
    </div>`;

  const nsc = root.querySelector(".sq-pr__scroll");
  const mem = scrollMem.get(t.id);
  if (mem) { nsc.scrollLeft = mem.x; nsc.scrollTop = mem.y; }
  else {
    const ps = notes.map((n) => n.pitch);
    const mid = ps.length ? (Math.min(...ps) + Math.max(...ps)) / 2 : (t.isDrumKit ? 40 : 60);
    nsc.scrollTop = Math.max(0, yOf(mid) - nsc.clientHeight / 2);
  }
  shownId = t.id;
  syncVelScroll();
  litKey = "";
  paintHead();
}

function syncVelScroll() {
  const sc = root?.querySelector(".sq-pr__scroll");
  const inner = root?.querySelector(".sq-pr__vel-inner");
  if (sc && inner) inner.style.transform = `translateX(${-sc.scrollLeft}px)`;
}
function onScroll(e) {
  if (e.target?.classList?.contains("sq-pr__scroll")) syncVelScroll();
}

// ---- the playhead, and the keys lit under it --------------------------------

function headLoop() {
  if (headRaf) return;
  const tick = () => { headRaf = 0; if (state.view !== "piano") return; paintHead(); headRaf = requestAnimationFrame(tick); };
  headRaf = requestAnimationFrame(tick);
}
function paintHead() {
  const head = root?.querySelector(".sq-pr__head");
  const t = currentTrack();
  if (!head || !t || t.id !== shownId) return;
  const idx = state.playing && !t._clipOff && t._nowIdx >= 0 ? t._nowIdx : -1;
  head.hidden = idx < 0;
  if (idx >= 0) head.style.transform = `translateX(${idx * SW()}px)`;
  const on = idx < 0 ? [] : pitchesAt(notes, idx);
  const k = on.join(",");
  if (k === litKey) return;
  litKey = k;
  root.querySelectorAll(".sq-pr__key.is-lit").forEach((el) => el.classList.remove("is-lit"));
  for (const p of on) root.querySelector(`.sq-pr__key[data-p="${Math.round(p)}"]`)?.classList.add("is-lit");
}

// ---- chords --------------------------------------------------------------------

/**
 * What a click draws, from the top bar's chord mode (the keyboard's, so a
 * click here writes what a key or a step click would): a plain note when it
 * is off, else `chordSelectionFor`'s root, chord type, voicing and, for an
 * in-key voicing that is no chord type, explicit extras. Drum kits sit chord
 * mode out, as they do in the step grid.
 * @returns {{root: number, chord: string, cpx: number, extras: number[]}}
 */
function chordFor(t, pitch) {
  if (!state.kbdChordType || t?.isDrumKit) return { root: pitch, chord: "", cpx: 0, extras: [] };
  const c = chordSelectionFor(pitch);
  return { root: c.root, chord: c.chord || "", cpx: c.chord ? c.cpx | 0 : 0, extras: (c.extras || []).filter((p) => p >= LO && p <= HI) };
}

/** Every pitch a root sounds: its chord's tones, inverted, or itself. */
function tonesOf(n) {
  if (!n.chord) return [n.pitch];
  const ns = chordNotes(n.pitch, n.chord);
  return n.cpx ? invertChord(ns, n.cpx) : ns;
}

/** The notes a stamp writes at a step: the root first. */
function stampNotes(t, start, len, pitch) {
  const c = chordFor(t, pitch);
  const base = { start, len, vel: 0.8, src: null };
  return [{ ...base, pitch: c.root, root: true, chord: c.chord, cpx: c.cpx },
    ...c.extras.map((p) => ({ ...base, pitch: p, root: false, chord: "" }))];
}

/** The dashed chord tones of a root, for the field (`data-root` ties them to it while it moves). */
function toneEls(n, i) {
  const sw = SW(), rh = RH();
  return tonesOf(n).filter((p) => Math.abs(p - n.pitch) > 1e-6 && p >= LO && p <= HI && (!folded() || onRow(p)))
    .map((p) => `<div class="sq-pr__tone" data-root="${i}" style="left:${n.start * sw}px;top:${yOf(p)}px;width:${n.len * sw - 1}px;height:${rh}px" title="${midiToName(p)}: a tone of ${midiToName(n.pitch)} ${esc(n.chord)}"></div>`).join("");
}

/** Put the chord mode on the selected roots (off takes their chords away). */
function applyChordToSelection(t) {
  const picked = notes.filter((n) => sel.has(key(n)) && n.root);
  if (!picked.length) { setStatus("select notes first: apply chord puts the chord bar's chord on them"); return false; }
  const list = notes.slice();
  const out = [];
  for (const n of picked) {
    const c = chordFor(t, n.pitch);
    const i = list.indexOf(n);
    list[i] = { ...n, pitch: c.root, chord: c.chord, cpx: c.cpx };
    out.push(list[i]);
    for (const p of c.extras) list.push({ ...n, pitch: p, root: false, chord: "" });
  }
  commit(t, list, out);
  setStatus(state.kbdChordType && !t.isDrumKit
    ? `${out.length} note${out.length === 1 ? "" : "s"} made chords`
    : "chords taken off (chord mode is off)");
  return true;
}

// ---- hearing a note ----------------------------------------------------------

async function audition(t, midi, dur = 0.3, vel = 0.8) {
  if (!t || t.muted || !Number.isFinite(midi)) return;
  const k = root?.querySelector(`.sq-pr__key[data-p="${Math.round(midi)}"]`);
  if (k) { k.classList.add("is-down"); setTimeout(() => k.classList.remove("is-down"), dur * 1000); }
  await ensureAudio();
  if (!t.voice || !state.audioCtx) return;
  wakeMasterBus();
  holdNoiseBed(t, dur);
  try { t.voice.hit(midi, state.audioCtx.currentTime + 0.01, dur, vel, hitOptsFor(t)); } catch (e) { console.warn("piano audition", e); }
}

/** Hear what a stamp wrote: every tone of every root, and the extras. */
function auditionChord(t, made, dur = 0.3) {
  const ps = new Set();
  for (const n of made) for (const p of (n.root ? tonesOf(n) : [n.pitch])) ps.add(p);
  for (const p of ps) audition(t, p, dur, 0.7);
}

// ---- committing --------------------------------------------------------------

/**
 * Write a new list of notes into the track's pattern, growing the pattern to
 * the next bar line when a note runs past its end, then select `select`
 * (notes, matched by start and pitch after the fold) and repaint.
 */
function commit(t, list, select = null) {
  const end = list.reduce((m, n) => Math.max(m, n.start + n.len), 0);
  if (end > t.steps.length) {
    const { bar } = meterOf(t);
    resizePattern(t, trackSlot(t), Math.min(MAX_LEN, Math.ceil(end / bar) * bar));
  }
  writeNotes(t, list, t.steps.length);
  if (select) sel = new Set(select.map(key));
  const last = select?.[select.length - 1];
  if (last && !t.isDrumKit) t.lastEditedNote = last.pitch;
  renderStepGrid(t);
  refreshRollIfOpen(t);
  render();
}

// ---- toolbar -----------------------------------------------------------------

function onClick(e) {
  const tb = e.target.closest("[data-tool]");
  if (tb) { pref.tool = tb.dataset.tool; savePref(); render(); return; }
  const b = e.target.closest("button[data-act]");
  if (!b) return;
  const t = currentTrack();
  const act = b.dataset.act;
  if (act === "play") { document.getElementById("play")?.click(); return; }
  if (act === "chordsel") { if (t) applyChordToSelection(t); return; }
  if (act === "ghosts") { pref.ghosts = !pref.ghosts; savePref(); render(); return; }
  if (act === "fold") {
    pref.fold = !pref.fold; savePref();
    if (t) { scrollMem.delete(t.id); keepMem = true; }    // the rows moved: centre on the notes again
    render();
    return;
  }
  if (/^z[xy][+-]$/.test(act)) {
    const axis = act[1] === "x" ? "zx" : "zy";
    const max = (axis === "zx" ? ZX : ZY).length - 1;
    zoomTo(axis, Math.max(0, Math.min(max, pref[axis] + (act[2] === "+" ? 1 : -1))));
    return;
  }
  if (!t) return;
  const slot = trackSlot(t);
  const { bar } = meterOf(t);
  const len = t.steps.length;
  if (act === "len+") resizePattern(t, slot, Math.min(MAX_LEN, len + bar));
  else if (act === "len-") truncatePattern(t, slot, Math.max(1, len - bar));
  else if (act === "x2") extendPatternByDuplicate(t, slot, Math.min(MAX_LEN, len * 2));
  else return;
  refreshRollIfOpen(t);
  render();
}

/** Zoom, keeping the middle of the view where it was. */
function zoomTo(axis, z) {
  const sc = root?.querySelector(".sq-pr__scroll");
  const t = currentTrack();
  const before = axis === "zx" ? SW() : RH();
  pref[axis] = z; savePref();
  const after = axis === "zx" ? SW() : RH();
  if (sc && t && t.id === shownId) {
    const r = after / before;
    scrollMem.set(t.id, axis === "zx"
      ? { x: (sc.scrollLeft + sc.clientWidth / 2) * r - sc.clientWidth / 2, y: sc.scrollTop }
      : { x: sc.scrollLeft, y: (sc.scrollTop + sc.clientHeight / 2) * r - sc.clientHeight / 2 });
    keepMem = true;
  }
  render();
}

function onChange(e) {
  const s = e.target.closest("select[data-act]");
  if (!s) return;
  const t = currentTrack();
  if (s.dataset.act === "snap") { pref.snap = s.value; savePref(); return; }
  if (s.dataset.act === "track") {
    const o = state.tracks.find((x) => String(x.id) === s.value);
    if (o) { setActiveTrack(o); render(); }
    return;
  }
  if (s.dataset.act === "slot" && t) {
    launchClip(t, Number(s.value));
    setStatus(`${t.name?.trim() || "track"}: pattern ${Number(s.value) + 1}`);
    render();
  }
}

function onWheel(e) {
  if (!(e.ctrlKey || e.metaKey) || !e.target.closest(".sq-pr__scroll")) return;
  e.preventDefault();
  zoomTo("zx", Math.max(0, Math.min(ZX.length - 1, pref.zx + (e.deltaY < 0 ? 1 : -1))));
}

// ---- pointer gestures --------------------------------------------------------

function fieldPoint(e, field) {
  const r = field.getBoundingClientRect();
  const x = e.clientX - r.left, y = e.clientY - r.top;
  const row = Math.max(0, Math.min(rowPitches.length - 1, Math.floor(y / RH())));
  return { x, y, step: x / SW(), row, pitch: rowPitches[row] };
}
const noteEl = (i) => root.querySelector(`.sq-pr__note[data-i="${i}"]`);

function onPointerDown(e) {
  const t = currentTrack();
  if (!t || drag) return;
  // A double-click on a note opens its step editor. Timed here rather than
  // left to dblclick, which the pointer capture below retargets to the view.
  const nEl = e.target.closest(".sq-pr__note");
  const n = nEl ? notes[Number(nEl.dataset.i)] : null;
  const k = n && e.button === 0 ? key(n) : "";
  const now = performance.now();
  if (k && k === lastDown.key && now - lastDown.at < 350) {
    lastDown = { at: 0, key: "" };
    e.preventDefault();
    openStepEditor(t, n.start, nEl);
    return;
  }
  lastDown = { at: now, key: k };
  startGesture(e);
  if (drag) try { root.setPointerCapture(e.pointerId); } catch {}
}

function startGesture(e) {
  const t = currentTrack();
  const key_ = e.target.closest(".sq-pr__key");
  if (key_ && e.button === 0) {
    const p = Number(key_.dataset.p);
    drag = { kind: "keys", t, last: p, pointerId: e.pointerId };
    audition(t, p, 0.45);
    e.preventDefault();
    return;
  }
  const vel = e.target.closest(".sq-pr__vel-inner");
  if (vel && e.button === 0) {
    drag = { kind: "vel", t, inner: vel, changes: new Map(), pointerId: e.pointerId };
    velAt(e);
    e.preventDefault();
    return;
  }
  const field = e.target.closest(".sq-pr__field");
  if (!field || (e.button !== 0 && e.button !== 2)) return;
  const pt = fieldPoint(e, field);
  const nEl = e.target.closest(".sq-pr__note");
  const idx = nEl ? Number(nEl.dataset.i) : -1;
  const n = idx >= 0 ? notes[idx] : null;
  const base = { t, field, pointerId: e.pointerId, x0: pt.step, y0: pt.y, px0: pt.x, r0: pt.row, moved: false };
  e.preventDefault();

  if (e.button === 2 || pref.tool === "erase") {
    drag = { ...base, kind: "erase", gone: new Set() };
    if (n) eraseOne(idx);
    return;
  }
  if (!n && (pref.tool === "select" || e.ctrlKey || e.metaKey)) {
    if (!e.shiftKey) { sel.clear(); paintSel(); }
    drag = { ...base, kind: "marquee", keep: new Set(sel) };
    return;
  }
  if (n) {
    if (pref.tool === "select" && e.shiftKey && !e.altKey) {
      const k = key(n);
      if (sel.has(k)) sel.delete(k); else sel.add(k);
      paintSel();
      drag = { ...base, kind: "noop" };
      return;
    }
    const grouped = sel.has(key(n));
    if (!grouped) { sel = pref.tool === "select" ? new Set([key(n)]) : new Set(); paintSel(); }
    const ids = grouped ? notes.map((x, i) => (sel.has(key(x)) ? i : -1)).filter((i) => i >= 0) : [idx];
    const right = (n.start + n.len) * SW();
    const edge = right - pt.x <= Math.max(4, Math.min(8, n.len * SW() * 0.3));
    if (edge && !e.shiftKey) {
      drag = { ...base, kind: "resize", ids, orig: ids.map((i) => ({ ...notes[i] })), grabStart: n.start, grabEnd: n.start + n.len, grabbed: idx, grouped };
      return;
    }
    drag = { ...base, kind: "move", ids, orig: ids.map((i) => ({ ...notes[i] })), grab: n, copy: e.shiftKey, grouped, dStep: 0, dRow: 0 };
    lastLen.set(t.id, n.len);
    audition(t, n.pitch, 0.25, n.vel);
    return;
  }
  // empty space
  const u = snapUnit(t);
  if (pref.tool === "paint") {
    drag = { ...base, kind: "paint", start0: Math.floor(pt.step / u) * u, placed: new Map() };
    paintAt(pt);
    return;
  }
  // draw: a new note, dragged into place from here
  const start = Math.floor(pt.step / u) * u;
  if (start >= MAX_LEN) { drag = { ...base, kind: "noop" }; return; }
  const made = stampNotes(t, start, Math.min(lenFor(t), MAX_LEN - start), pt.pitch);
  const ids = made.map((n) => {
    notes.push(n);
    const i = notes.length - 1;
    field.insertAdjacentHTML("beforeend", `<div class="sq-pr__note is-new" data-i="${i}" style="left:${start * SW()}px;top:${yOf(n.pitch)}px;width:${n.len * SW() - 1}px;height:${RH()}px;--vel:0.8"><span>${n.chord && n.len * SW() >= 24 ? esc(`${midiToName(n.pitch)} ${n.chord}`) : ""}</span></div>`);
    if (n.chord) field.insertAdjacentHTML("beforeend", toneEls(n, i));
    return i;
  });
  sel = new Set(); paintSel();
  drag = { ...base, kind: "move", ids, orig: made.map((n) => ({ ...n })), grab: made[0], copy: false, created: true, dStep: 0, dRow: 0 };
  auditionChord(t, made);
}

function paintSel() {
  root?.querySelectorAll(".sq-pr__note").forEach((el) => {
    const n = notes[Number(el.dataset.i)];
    el.classList.toggle("is-sel", !!n && sel.has(key(n)));
  });
}

function eraseOne(i) {
  if (!drag || drag.gone.has(i)) return;
  drag.gone.add(i);
  const el = noteEl(i);
  if (el) el.hidden = true;
}

function paintAt(pt) {
  const t = drag.t;
  const len = lenFor(t);
  const k1 = Math.floor((pt.step - drag.start0) / len);
  const [a, b] = k1 >= 0 ? [0, k1] : [k1, 0];
  for (let k = a; k <= b; k++) {
    const start = drag.start0 + k * len;
    if (start < 0 || start >= MAX_LEN || drag.placed.has(start)) continue;
    const made = stampNotes(t, start, Math.min(len, MAX_LEN - start), pt.pitch);
    drag.placed.set(start, made);
    for (const n of made) {
      drag.field.insertAdjacentHTML("beforeend", `<div class="sq-pr__note is-new" style="left:${start * SW()}px;top:${yOf(n.pitch)}px;width:${n.len * SW() - 1}px;height:${RH()}px;--vel:0.8"><span></span></div>`);
      if (n.chord) drag.field.insertAdjacentHTML("beforeend", toneEls(n, -1));
    }
    if (k === k1) auditionChord(t, made, 0.15);
  }
}

function velAt(e) {
  const inner = drag.inner;
  const r = inner.getBoundingClientRect();
  const step = Math.floor((e.clientX - r.left) / SW());
  const v = Math.max(0.05, Math.min(1, 1 - (e.clientY - r.top) / r.height));
  // the stalk in this column, or the nearest one within half a beat to its left
  let s = -1;
  for (const n of notes) if (n.root && n.start <= step && n.start > s && step - n.start < Math.max(1, meterOf(drag.t).beat / 2)) s = n.start;
  if (s < 0) return;
  drag.changes.set(s, v);
  const stalk = inner.querySelector(`.sq-pr__stalk[data-s="${s}"]`);
  if (stalk) stalk.style.height = `${Math.round(v * 100)}%`;
  notes.forEach((n, i) => { if (n.start === s) noteEl(i)?.style.setProperty("--vel", v.toFixed(3)); });
}

function onPointerMove(e) {
  if (!drag || e.pointerId !== drag.pointerId) return;
  const t = drag.t;
  if (drag.kind === "keys") {
    const k = document.elementFromPoint(e.clientX, e.clientY)?.closest?.(".sq-pr__key");
    const p = k ? Number(k.dataset.p) : null;
    if (p != null && p !== drag.last) { drag.last = p; audition(t, p, 0.35); }
    return;
  }
  if (drag.kind === "vel") { velAt(e); return; }
  if (!drag.field) return;
  const pt = fieldPoint(e, drag.field);
  if (!drag.moved && Math.hypot(pt.x - drag.px0, pt.y - drag.y0) < 3) return;
  drag.moved = true;
  const sw = SW();

  if (drag.kind === "erase") {
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest?.(".sq-pr__note");
    if (el && el.dataset.i != null) eraseOne(Number(el.dataset.i));
    return;
  }
  if (drag.kind === "paint") { paintAt(pt); return; }
  if (drag.kind === "marquee") {
    const x1 = Math.min(drag.px0, pt.x), x2 = Math.max(drag.px0, pt.x);
    const y1 = Math.min(drag.y0, pt.y), y2 = Math.max(drag.y0, pt.y);
    const m = drag.field.querySelector(".sq-pr__marquee");
    Object.assign(m.style, { left: `${x1}px`, top: `${y1}px`, width: `${x2 - x1}px`, height: `${y2 - y1}px` });
    m.hidden = false;
    sel = new Set(drag.keep);
    for (const n of notes) {
      const nx1 = n.start * sw, nx2 = (n.start + n.len) * sw, ny1 = yOf(n.pitch), ny2 = ny1 + RH();
      if (nx2 > x1 && nx1 < x2 && ny2 > y1 && ny1 < y2) sel.add(key(n));
    }
    paintSel();
    return;
  }
  const u = snapUnit(t);
  const snapR = (x) => Math.round(x / u) * u;
  if (drag.kind === "resize") {
    const end = Math.max(drag.grabStart + 1, snapR(drag.grabEnd + pt.step - drag.x0));
    const d = end - drag.grabEnd;
    drag.d = d;
    drag.ids.forEach((i, j) => {
      const o = drag.orig[j];
      const l = Math.max(1, Math.min(MAX_LEN - o.start, o.len + d));
      const el = noteEl(i);
      if (el) el.style.width = `${l * sw - 1}px`;
      drag.field.querySelectorAll(`.sq-pr__tone[data-root="${i}"]`).forEach((tEl) => { tEl.style.width = `${l * sw - 1}px`; });
    });
    return;
  }
  if (drag.kind === "move") {
    const minStart = Math.min(...drag.orig.map((o) => o.start));
    const maxEnd = Math.max(...drag.orig.map((o) => o.start + o.len));
    const dStep = Math.max(-minStart, Math.min(MAX_LEN - maxEnd, snapR(drag.grab.start + pt.step - drag.x0) - drag.grab.start));
    const dRow = clampRows(drag.orig.map((o) => o.pitch), pt.row - drag.r0);
    if (dRow !== drag.dRow && drag.ids.length <= 4) {
      auditionChord(t, drag.orig.map((o) => ({ ...o, pitch: shiftRows(o.pitch, dRow) })), 0.2);
    }
    drag.dStep = dStep; drag.dRow = dRow;
    if (drag.copy && !drag.clones) {
      drag.clones = drag.ids.map((i) => {
        const c = noteEl(i)?.cloneNode(true);
        if (c) { c.removeAttribute("data-i"); c.classList.add("is-new"); drag.field.appendChild(c); }
        return c;
      });
    }
    drag.ids.forEach((i, j) => {
      const o = drag.orig[j];
      const el = drag.copy ? drag.clones[j] : noteEl(i);
      if (!el) return;
      el.style.left = `${(o.start + dStep) * sw}px`;
      el.style.top = `${yOf(shiftRows(o.pitch, dRow))}px`;
      if (drag.copy || !o.chord) return;
      // its chord tones ride along, by the root's own move
      const dy = yOf(shiftRows(o.pitch, dRow)) - yOf(o.pitch);
      drag.field.querySelectorAll(`.sq-pr__tone[data-root="${i}"]`).forEach((tEl) => {
        if (tEl._x0 == null) { tEl._x0 = parseFloat(tEl.style.left); tEl._y0 = parseFloat(tEl.style.top); }
        tEl.style.left = `${tEl._x0 + dStep * sw}px`;
        tEl.style.top = `${tEl._y0 + dy}px`;
      });
    });
  }
}

function onPointerUp(e) {
  if (!drag || e.pointerId !== drag.pointerId) return;
  const d = drag;
  drag = null;
  const t = d.t;
  if (d.kind === "keys" || d.kind === "noop") return;
  if (d.kind === "vel") {
    if (!d.changes.size) return;
    for (const [s, v] of d.changes) if (t.steps[s]) t.velocities[s] = v;
    renderStepGrid(t); refreshRollIfOpen(t); render();
    return;
  }
  if (d.kind === "erase") {
    if (!d.gone.size) return;
    commit(t, notes.filter((_, i) => !d.gone.has(i)));
    return;
  }
  if (d.kind === "paint") {
    if (!d.placed.size) return;
    commit(t, [...notes, ...[...d.placed.values()].flat()]);
    return;
  }
  if (d.kind === "marquee") {
    d.field.querySelector(".sq-pr__marquee").hidden = true;
    return;
  }
  if (d.kind === "resize") {
    if (!d.moved || !d.d) return;
    const list = notes.slice();
    const moved = [];
    d.ids.forEach((i, j) => {
      const o = d.orig[j];
      list[i] = { ...o, len: Math.max(1, Math.min(MAX_LEN - o.start, o.len + d.d)) };
      moved.push(list[i]);
      if (i === d.grabbed) lastLen.set(t.id, list[i].len);
    });
    commit(t, list, d.grouped ? moved : null);
    return;
  }
  if (d.kind === "move") {
    if (!d.created && (!d.moved || (!d.dStep && !d.dRow))) { d.clones?.forEach((c) => c?.remove()); render(); return; }
    const list = notes.slice();
    const moved = [];
    d.ids.forEach((i, j) => {
      const o = d.orig[j];
      const m = { ...o, start: o.start + d.dStep, pitch: shiftRows(o.pitch, d.dRow) };
      if (d.copy) list.push(m); else list[i] = m;
      moved.push(m);
    });
    commit(t, list, d.grouped || d.copy || pref.tool === "select" ? moved : null);
  }
}

// ---- keys ----------------------------------------------------------------------

function onKey(e) {
  if (state.view !== "piano" || e.defaultPrevented || drag) return;
  if (isTypingTarget(document.activeElement) || state.vimMode === "command" || state.vimMode === "insert") return;
  const t = currentTrack();
  if (!t || t.id !== shownId) return;
  const mod = e.ctrlKey || e.metaKey;
  const picked = () => notes.filter((n) => sel.has(key(n)));
  if (e.key === "Escape" && sel.size) { sel.clear(); paintSel(); e.preventDefault(); return; }
  if (mod && (e.key === "a" || e.key === "A")) {
    sel = new Set(notes.map(key)); paintSel(); e.preventDefault(); return;
  }
  if (!sel.size) return;
  if (e.key === "Delete" || e.key === "Backspace") {
    commit(t, notes.filter((n) => !sel.has(key(n))));
    sel.clear();
    e.preventDefault();
    return;
  }
  if (mod && (e.key === "b" || e.key === "B")) {
    const ps = picked();
    const span = Math.max(...ps.map((n) => n.start + n.len)) - Math.min(...ps.map((n) => n.start));
    const copies = ps.map((n) => ({ ...n, start: n.start + span })).filter((n) => n.start < MAX_LEN);
    if (copies.length) commit(t, [...notes, ...copies], copies);
    e.preventDefault();
    return;
  }
  if (mod || e.altKey) return;
  // ↑ ↓ move a row (a semitone, or a scale degree when folded), shift an octave
  let dS = 0, dP = 0, dRow = 0;
  if (e.key === "ArrowUp") { if (e.shiftKey) dP = 12; else dRow = -1; }
  else if (e.key === "ArrowDown") { if (e.shiftKey) dP = -12; else dRow = 1; }
  else if (e.key === "ArrowRight") dS = e.shiftKey ? meterOf(t).bar : snapUnit(t);
  else if (e.key === "ArrowLeft") dS = -(e.shiftKey ? meterOf(t).bar : snapUnit(t));
  else return;
  e.preventDefault();
  const ps = picked();
  const minS = Math.min(...ps.map((n) => n.start)), maxE = Math.max(...ps.map((n) => n.start + n.len));
  const minP = Math.min(...ps.map((n) => n.pitch)), maxP = Math.max(...ps.map((n) => n.pitch));
  dS = Math.max(-minS, Math.min(MAX_LEN - maxE, dS));
  dP = Math.max(LO - minP, Math.min(HI - maxP, dP));
  dRow = clampRows(ps.map((n) => n.pitch), dRow);
  if (!dS && !dP && !dRow) return;
  const moved = [];
  const list = notes.map((n) => {
    if (!sel.has(key(n))) return n;
    const m = { ...n, start: n.start + dS, pitch: dP ? n.pitch + dP : shiftRows(n.pitch, dRow) };
    moved.push(m);
    return m;
  });
  if ((dP || dRow) && moved.length <= 4) moved.forEach((m) => audition(t, m.pitch, 0.2, m.vel));
  commit(t, list, moved);
}
