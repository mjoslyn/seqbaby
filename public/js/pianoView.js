/**
 * The piano view: one track's patterns as a full-height piano roll, in the
 * manner of FL Studio's, every pattern the song uses laid end to end across
 * the timeline (and one more, empty, to draw into). A keyboard down the left (click a key to hear it),
 * bars across the top, the notes as bars you draw, drag, stretch and paint,
 * the other tracks' notes behind them as ghosts, and the velocity stalks
 * under it all. The fourth view beside groove, clips and arrange (views.js).
 *
 * What it edits is the track's patterns, all of them at once: each is a
 * section with its own header (its number, its length and the buttons that
 * change it, and a ▶ that launches it on this track), its own meter's grid,
 * and the other tracks' notes for the same pattern as ghosts. A note dragged
 * across a section line moves to that pattern, its step's fields with it
 * (stepSnapshot). The track is the keyboard's (`state.activeTrackId`), so the
 * computer keys play what is shown, and the playhead runs in the section of
 * the pattern the track is on. A pattern stores notes per step (track.js), so every
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
 *   erase   click or sweep: delete
 *   select  drag: a box; click a note: select it (shift adds)
 *   any     ctrl/⌘-drag: a box   double-click a note: delete it
 *           right-click a note: its step editor
 * Keys, with nothing focused: delete removes the selection, ↑ ↓ transpose it
 * (shift: an octave), ← → move it by the snap (shift: a bar), ctrl/⌘-A
 * selects all, ctrl/⌘-B duplicates the selection after itself, alt + ← →
 * nudges it off the grid (the nudge buttons do too), escape lets go.
 *
 * "scale only" (a box in the top bar's scale row, shown in this view only),
 * with a scale switched on, folds the roll to the scale's rows,
 * so a note drawn is in key and a drag up or down moves by scale degree (↑ ↓
 * too). A note already off the scale sits on the row below it, outlined.
 *
 * Chords come from the top bar's chord mode, the same one the computer
 * keyboard and a step click use: with it on, a click (or a paint stroke)
 * draws the chord, in key when the scale is on. A chord type is stored as
 * the root's chord and voicing (the step's, as the step editor sets it) and
 * drawn as dashed tones under the root; an in-key voicing that is no chord
 * type is written as the root plus extras.
 *
 * `sound` opens the track's own card in a window over the roll: the
 * instrument, the fx, the filter, the mod matrix and the automation lanes.
 *
 * The patterns are the sequencer's, and switching one is switching the scene
 * for every track, as the pattern bar does: a header's ▶ is
 * `requestPatternSwitch` (so it honours now / finish). Dragging across the
 * headers marks a LOOP of patterns (`state.patLoop`, not saved): `loop` is
 * repeat mode, which plays that range round (`loopRange`, state.js), and off
 * is chain, so it reads the same as the pattern bar and the clip view. `follow` (per browser)
 * keeps the playhead in view, turning the page as it nears the edge; a
 * scroll by hand while playing switches it off, as the arrangement's does.
 *
 * A note is cut at its pattern's end; a pattern's length is its header's,
 * and changing it there moves the pattern's chain repeat with it when the
 * two agreed (chain mode counts a pattern's repeat in bars).
 * Every edit is committed on release, so a drag is one undo step (history.js
 * watches the pointerup) and the view is rebuilt from the pattern afterwards.
 */

import { announceClips } from "./clips.js";
import { PATTERN_COUNT } from "./constants.js";
import { setStatus } from "./dom.js";
import { chordSelectionFor, hitOptsFor, isTypingTarget, noteForKey } from "./keyboard.js";
import { patternMeter, stepsPerBarForMeter, stepsPerBeatForMeter } from "./meter.js";
import { refreshRollIfOpen } from "./pianoRoll.js";
import { setActiveTrack } from "./render.js";
import { pitchesAt, readNotes, stepSnapshot, writeNotes } from "./rollNotes.js";
import { holdNoiseBed } from "./signal.js";
import { MODE_UI, meterOptions, setPatternMeter, setPatternMode } from "./patternBar.js";
import { invertChord, isPatternNonEmpty, requestPatternSwitch, state, switchPattern, trackSlot } from "./state.js";
import { openStepEditor } from "./stepEditor.js";
import { renderStepGrid } from "./stepGrid.js";
import { liveGeneratorOf } from "./stepSource.js";
import { SCALES, chordNotes, midiToName } from "./theory.js";
import { extendPatternByDuplicate, resizePattern, truncatePattern } from "./track.js";
import { restoreTrackCard, trackHue } from "./trackDetail.js";
import { ensureAudio, wakeMasterBus } from "./transport.js";
import { onViewChange } from "./views.js";

const LO = 24;                 // C1
const HI = 108;                // C8
const ZX = [8, 12, 16, 22, 30, 42];   // px per step
const ZY = [9, 12, 15, 19];           // px per row
const MAX_LEN = 128;
const BLACK = new Set([1, 3, 6, 8, 10]);
const TOOLS = [
  ["draw", "✎ draw", "draw: click to place a note of the last length you used and drag it into place; drag a note to move it, its right edge to resize; shift-drag copies; double-click deletes a note, right-click opens its step editor"],
  ["paint", "▤ paint", "paint: drag across to lay a note every length, at the row under the pointer"],
  ["erase", "✕ erase", "erase: click or sweep across notes to delete them"],
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
let headSlot = -1;
let autoScroll = -1;             // the scrollLeft this view last set, so its own scroll is not taken for a hand
let keepMem = false;
let lastDown = { at: 0, key: "" };             // a zoom has already written where the scroll goes
const lastLen = new Map();       // track id -> the length a new note takes
const scrollMem = new Map();     // track id -> {x, y}

function readPref() {
  const d = { tool: "draw", snap: "step", zx: 3, zy: 1, ghosts: true, fold: false, follow: true, hear: true };
  try { return { ...d, ...JSON.parse(localStorage.getItem(PREF_KEY) || "{}") }; } catch { return d; }
}
function savePref() { try { localStorage.setItem(PREF_KEY, JSON.stringify(pref)); } catch {} }

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const rows = () => state.tracks.filter((t) => t.engineKey !== "bus");
const key = (n) => `${n.start}:${n.pitch}`;
/** Where a note is drawn: its step plus its nudge (the step's offset). */
const xOf = (n, start = n.start) => (start + (n.off || 0)) * SW();
const MICRO = 1 / 24;            // a nudge step: 1/24 of a step, vim's and the step editor's unit
const MICRO_MAX = 12;            // half a step either way
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
/**
 * The patterns laid across the timeline: every slot up to the last any track
 * has notes in (or the one this track is on), and one more to draw into.
 * Rebuilt per render, so they hold still through a drag.
 * @type {{slot: number, off: number, len: number, bar: number, beat: number}[]}
 */
let sections = [];
let secBySlot = new Map();
function buildSections(t) {
  let last = trackSlot(t);
  for (let i = 0; i < PATTERN_COUNT; i++) if (isPatternNonEmpty(i)) last = Math.max(last, i);
  last = Math.min(PATTERN_COUNT - 1, last + 1);
  sections = [];
  let off = 0;
  for (let slot = 0; slot <= last; slot++) {
    const p = t.patterns?.[slot];
    if (!p?.steps) continue;
    const m = patternMeter(slot);
    sections.push({ slot, off, len: p.steps.length, bar: stepsPerBarForMeter(m), beat: stepsPerBeatForMeter(m) });
    off += p.steps.length;
  }
  secBySlot = new Map(sections.map((sec) => [sec.slot, sec]));
}
const totalSteps = () => { const l = sections[sections.length - 1]; return l ? l.off + l.len : 0; };
/** The pattern a global step falls in. */
function sectionAt(g) {
  for (const sec of sections) if (g >= sec.off && g < sec.off + sec.len) return sec;
  return null;
}
function meterOf(t) {
  const m = patternMeter(trackSlot(t));
  return { bar: stepsPerBarForMeter(m), beat: stepsPerBeatForMeter(m) };
}
function snapUnit(sec) {
  const bar = sec?.bar ?? 16, beat = sec?.beat ?? 4;
  if (pref.snap === "bar") return bar;
  if (pref.snap === "beat") return beat;
  if (pref.snap === "half") return Math.max(1, Math.round(beat / 2));
  return 1;
}
/** A global step snapped on its own pattern's grid: floored (a click) or rounded (a drag). */
function snapG(g, how = "round") {
  const sec = sectionAt(Math.max(0, Math.min(totalSteps() - 1e-6, g))) || sections[0];
  if (!sec) return Math.round(g);
  const u = snapUnit(sec);
  const local = (g - sec.off) / u;
  return sec.off + (how === "floor" ? Math.floor(local) : Math.round(local)) * u;
}
/** Where the pattern holding a global step ends. */
const secEnd = (g) => { const sec = sectionAt(g); return sec ? sec.off + sec.len : totalSteps(); };
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
  // "scale only" lives in the top bar's scale row (shown in this view only)
  const fold = document.getElementById("scale-fold");
  fold?.addEventListener("change", () => {
    pref.fold = fold.checked; savePref();
    const t = currentTrack();
    if (t) { scrollMem.delete(t.id); keepMem = true; }    // the rows moved: centre on the notes again
    render();
  });
  // the scale decides the folded rows and which rows are tinted
  document.addEventListener("change", (e) => { if (/^scale-(on|root|mode)$/.test(e.target?.id || "")) schedulePianoPaint(); });
  onViewChange((v) => { if (v === "piano") { render(); headLoop(); } else soundModal?.close(); });
  for (const ev of ["seqbaby:clips", "seqbaby:songedited", "seqbaby:setapplied", "seqbaby:newset", "seqbaby:transport"]) {
    window.addEventListener(ev, schedulePianoPaint);
  }
  window.addEventListener("seqbaby:kbdoctave", paintOct);
}

/**
 * The computer keyboard's reach (q up to ], z / x move it an octave) as a
 * band on the keys, named by the note q plays: so it is plain which keys
 * the letters land on, in or out of a scale.
 */
function octBand() {
  const lo = noteForKey("q"), hi = noteForKey("]");
  if (lo == null || hi == null) return "";
  const top = yOf(hi), bottom = yOf(lo) + RH();
  return `<div class="sq-pr__oct" style="top:${top}px;height:${Math.max(RH(), bottom - top)}px" title="the computer keyboard plays these: q is ${midiToName(lo)}, ] is ${midiToName(hi)}. z / x move it an octave"><span>${midiToName(lo)}</span></div>`;
}

function paintOct() {
  if (state.view !== "piano" || !root) return;
  const keys = root.querySelector(".sq-pr__keys");
  if (!keys) return;
  keys.querySelector(".sq-pr__oct")?.remove();
  keys.insertAdjacentHTML("beforeend", octBand());
  const oct = root.querySelector(".sq-pr__corner i");
  if (oct) oct.textContent = `keys ${midiToName(noteForKey("q") ?? 60)}`;
}

/** Repaint on the next frame, if this is the open view. */
export function schedulePianoPaint() {
  if (state.view !== "piano" || !root || raf) return;
  // a header's meter picker held open: a repaint would close it under the pointer
  const held = document.activeElement?.closest?.("#piano .sq-pr__sec-meter");
  if (held) { held.addEventListener("blur", schedulePianoPaint, { once: true }); return; }
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
  buildSections(t);
  // every pattern's notes, at global steps; slot0 / src say where each came from
  notes = sections.flatMap((sec) => readNotes(t.patterns[sec.slot]).map((n) => ({ ...n, start: n.start + sec.off, slot0: sec.slot })));
  const have = new Set(notes.map(key));
  sel = new Set([...sel].filter((k) => have.has(k)));

  const sw = SW(), rh = RH();
  const steps = totalSteps();
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
  // per pattern: a header and bar numbers in the ruler, a grid and a line in the field
  let ruler = "", grids = "", velGrids = "";
  sections.forEach((sec, si) => {
    const x = sec.off * sw, w = sec.len * sw;
    const empty = !t.patterns[sec.slot].steps.some(Boolean);
    const bars = sec.len / sec.bar;
    ruler += `<div class="sq-pr__sec${sec.slot === slot ? " is-now" : ""}" data-slot="${sec.slot}" style="left:${x}px;width:${w}px">
      <div class="sq-pr__sec-h" title="pattern ${sec.slot + 1}. Drag across headers to loop those patterns"><button type="button" class="sq-pr__sec-play" data-act="sec-play" data-slot="${sec.slot}" title="play pattern ${sec.slot + 1}: starts the transport here when stopped; while playing, every track switches to it, as the pattern bar does (now or at the bar line, by the switch setting)">▶ ${sec.slot + 1}</button><span class="sq-pr__sec-len">${Number.isInteger(bars) ? bars : bars.toFixed(2)} bar${bars === 1 ? "" : "s"}${empty ? " · empty" : ""}</span><button type="button" data-act="sec-len-" data-slot="${sec.slot}" title="pattern ${sec.slot + 1}: one bar shorter">−</button><button type="button" data-act="sec-len+" data-slot="${sec.slot}" title="pattern ${sec.slot + 1}: one bar longer, empty">+</button><button type="button" data-act="sec-x2" data-slot="${sec.slot}" title="pattern ${sec.slot + 1}: double the length, tiling what is there">x2</button><select class="sq-pr__sec-meter" data-act="sec-meter" data-slot="${sec.slot}" title="pattern ${sec.slot + 1}: its time signature, for every track (each one's copy is resized to keep its bars)" aria-label="pattern ${sec.slot + 1} time signature">${meterOptions(sec.slot)}</select></div>
      ${Array.from({ length: Math.ceil(sec.len / sec.bar) }, (_, b) => `<div class="sq-pr__rbar" style="left:${b * sec.bar * sw}px;width:${Math.min(sec.bar, sec.len - b * sec.bar) * sw}px">${b + 1}</div>`).join("")}
    </div>`;
    grids += `<div class="sq-pr__lines${si % 2 ? " is-alt" : ""}" style="left:${x}px;width:${w}px;--beat:${sec.beat};--barn:${sec.bar}"></div><div class="sq-pr__secline" style="left:${x}px"></div>`;
    velGrids += `<div class="sq-pr__vel-lines" style="left:${x}px;width:${w}px;--beat:${sec.beat};--barn:${sec.bar}"></div>`;
  });

  // the other tracks' notes for the same pattern, behind, tiled as each loops
  let ghosts = "";
  if (pref.ghosts) {
    for (const o of rows()) {
      if (o === t || o.isDrumKit) continue;
      const k = (t.speed ?? 1) / Math.max(0.0001, o.speed ?? 1);    // o's steps in t's
      const gc = trackHue(o)[1];
      for (const sec of sections) {
        const op = o.patterns?.[sec.slot];
        if (!op?.steps?.length) continue;
        const on = readNotes(op);
        if (!on.length) continue;
        const period = op.steps.length * k;
        let count = 0;
        for (let rep = 0; rep * period < sec.len && count < 400; rep++) {
          for (const n of on) {
            const at = rep * period + n.start * k;
            if (at >= sec.len || hidden(n.pitch)) continue;
            const w = Math.min(n.len * k, sec.len - at);
            ghosts += `<div class="sq-pr__ghost" style="left:${(sec.off + at) * sw}px;top:${yOf(n.pitch)}px;width:${Math.max(2, w * sw - 1)}px;height:${rh}px;--g-c:${gc}" title="${esc(o.name)}"></div>`;
            count++;
          }
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
    return `<div class="sq-pr__note${sel.has(key(n)) ? " is-sel" : ""}${n.root ? "" : " is-extra"}${off ? " is-off" : ""}${lifted ? " is-lifted" : ""}" data-i="${i}"${off ? ` title="${midiToName(n.pitch)} is off the scale: drawn on the row below it"` : lifted ? ` title="${midiToName(n.pitch)} ${esc(n.chord)}, inversion ${n.cpx}: the root sounds an octave up"` : ""} style="left:${xOf(n)}px;top:${yOf(n.pitch)}px;width:${w}px;height:${rh}px;--vel:${n.vel.toFixed(3)}"><span>${esc(label)}</span><i class="sq-pr__edge"></i></div>`;
  }).join("");
  const stalks = notes.filter((n) => n.root).map((n) =>
    `<i class="sq-pr__stalk" data-s="${n.start}" style="left:${xOf(n)}px;height:${Math.round(n.vel * 100)}%"></i>`).join("");

  const foldBox = document.getElementById("scale-fold");
  if (foldBox) { foldBox.checked = !!pref.fold; foldBox.disabled = !scale; }
  const gen = liveGeneratorOf(t);
  const trackOpts = rows().map((o) => `<option value="${o.id}"${o === t ? " selected" : ""}>${esc(o.name || "track")}</option>`).join("");

  root.innerHTML = `
    <div class="sq-pr__bar">
      <select class="sq-pr__track" data-act="track" title="the track being edited (the computer keyboard plays it too)" aria-label="track">${trackOpts}</select>
      <span class="sq-pr__tools" role="group" aria-label="tool">${TOOLS.map(([k, label, title]) =>
        `<button type="button" data-tool="${k}" aria-pressed="${pref.tool === k}" title="${esc(title)}">${label}</button>`).join("")}</span>
      <label class="sq-pr__snap" title="where notes land and how far they move, on each pattern's own grid">snap <select data-act="snap">${SNAPS.map(([k, l]) =>
        `<option value="${k}"${pref.snap === k ? " selected" : ""}>${l}</option>`).join("")}</select></label>
      <span class="sq-pr__nudge" title="nudge: move the selected notes off the grid, early or late, by 1/24 of a step (shift-click: a quarter step). 0 puts them back on it. alt + ← → does the same">nudge<button type="button" class="sq-btn--ghost" data-act="nudge-" aria-label="nudge earlier">‹</button><button type="button" class="sq-btn--ghost" data-act="nudge0" aria-label="back on the grid">0</button><button type="button" class="sq-btn--ghost" data-act="nudge+" aria-label="nudge later">›</button></span>
      <button type="button" class="sq-pr__sound" data-act="sound" title="sound: this track's instrument, effects, filter, modulation and automation lanes, in a window over the roll (its own track card, so every control is the one in the groove view)">sound</button>
      <button type="button" class="sq-pr__loopbtn" data-act="loop" aria-pressed="${looping()}" title="${looping()
        ? `loop: going round${state.patLoop && state.patLoop.end - state.patLoop.start > 1 ? ` patterns ${state.patLoop.start + 1}-${state.patLoop.end}` : " the pattern playing"}. Press for chain, playing through every pattern. Drag across the pattern headers to mark patterns to loop`
        : "chain: playing through every pattern. Press to loop (the patterns marked across the headers, or the one playing)"}">${MODE_UI[looping() ? "repeat" : state.patternMode].icon}<span>${looping() ? "loop" : state.patternMode}</span></button>
      <button type="button" class="sq-pr__followbtn" data-act="follow" aria-pressed="${!!pref.follow}" title="follow: keep the playhead in view while it plays (scrolling by hand switches it off)">follow</button>
      <button type="button" class="sq-pr__hearbtn" data-act="hear" aria-pressed="${pref.hear !== false}" title="hear: sound the notes you place, move or paint (the keyboard down the left always sounds)">hear</button>
      <button type="button" class="sq-pr__ghostbtn" data-act="ghosts" aria-pressed="${!!pref.ghosts}" title="ghosts: the other melodic tracks' notes for the same pattern, faint, behind this one's">ghosts</button>
      <span class="sq-pr__zoom" title="zoom (ctrl/⌘-wheel zooms across)">↔<button type="button" class="sq-btn--ghost" data-act="zx-">−</button><button type="button" class="sq-btn--ghost" data-act="zx+">+</button>
        ↕<button type="button" class="sq-btn--ghost" data-act="zy-">−</button><button type="button" class="sq-btn--ghost" data-act="zy+">+</button></span>
      ${gen ? `<span class="sq-pr__warn">live ${gen} is on: it decides the rhythm, not these notes</span>` : ""}
      ${t._clipOff ? `<span class="sq-pr__warn">this track's clip is stopped</span>` : ""}
    </div>
    <div class="sq-pr__scroll">
      <div class="sq-pr__canvas" style="--sw:${sw}px;--rh:${rh}px;--track-hue:${hue};--track-color:${color};grid-template-columns:var(--pr-keys) ${W}px;grid-template-rows:var(--pr-ruler) ${H}px">
        <div class="sq-pr__corner">${esc(t.name || "track")}<i title="the note the computer keyboard's q plays (z / x move it an octave)">keys ${midiToName(noteForKey("q") ?? 60)}</i></div>
        <div class="sq-pr__ruler">${ruler}${loopEls(true)}</div>
        <div class="sq-pr__keys" title="click or drag down the keys to hear them">${keys}${octBand()}</div>
        <div class="sq-pr__field">
          ${lanes}
          ${grids}
          ${loopEls(false)}${ghosts}${tones}${noteEls}
          <div class="sq-pr__marquee" hidden></div>
          <div class="sq-pr__head" hidden></div>
        </div>
      </div>
    </div>
    <div class="sq-pr__vel">
      <div class="sq-pr__vel-label" title="each step's velocity: drag across the stalks to draw it">velocity</div>
      <div class="sq-pr__vel-clip"><div class="sq-pr__vel-inner" style="width:${W}px;--sw:${sw}px;--track-color:${color}">${velGrids}${stalks}</div></div>
    </div>`;

  const nsc = root.querySelector(".sq-pr__scroll");
  const mem = scrollMem.get(t.id);
  if (mem) { nsc.scrollLeft = mem.x; nsc.scrollTop = mem.y; }
  else {
    const ps = notes.map((n) => n.pitch);
    const mid = ps.length ? (Math.min(...ps) + Math.max(...ps)) / 2 : (t.isDrumKit ? 40 : 60);
    nsc.scrollTop = Math.max(0, yOf(mid) - nsc.clientHeight / 2);
    nsc.scrollLeft = (secBySlot.get(slot)?.off ?? 0) * sw;
  }
  autoScroll = nsc.scrollLeft;
  shownId = t.id;
  syncVelScroll();
  litKey = "";
  headSlot = slot;
  paintHead();
}

function syncVelScroll() {
  const sc = root?.querySelector(".sq-pr__scroll");
  const inner = root?.querySelector(".sq-pr__vel-inner");
  if (sc && inner) inner.style.transform = `translateX(${-sc.scrollLeft}px)`;
}
function onScroll(e) {
  const sc = e.target;
  if (!sc?.classList?.contains("sq-pr__scroll")) return;
  syncVelScroll();
  // a sideways scroll this view did not make, while playing, switches follow off
  if (pref.follow && state.playing && autoScroll >= 0 && Math.abs(sc.scrollLeft - autoScroll) > 4) {
    pref.follow = false; savePref();
    root.querySelector('[data-act="follow"]')?.setAttribute("aria-pressed", "false");
  }
}

// ---- the loop of patterns ------------------------------------------------------

/** The loop's marks: in the ruler (the range) or the field (a shade), from state.patLoop. */
function loopEls(inRuler, range = state.patLoop) {
  if (!range) return "";
  const a = secBySlot.get(range.start), b = secBySlot.get(range.end - 1);
  if (!a || !b) return "";
  const x = a.off * SW(), w = (b.off + b.len - a.off) * SW();
  const on = looping() && state.activePattern >= range.start && state.activePattern < range.end ? " is-on" : "";
  return inRuler
    ? `<div class="sq-pr__loop${on}" style="left:${x}px;width:${w}px"></div>`
    : `<div class="sq-pr__loopshade${on}" style="left:${x}px;width:${w}px"></div>`;
}
function paintLoopPreview(range) {
  root.querySelectorAll(".sq-pr__loop, .sq-pr__loopshade").forEach((el) => el.remove());
  root.querySelector(".sq-pr__ruler")?.insertAdjacentHTML("beforeend", loopEls(true, range));
  root.querySelector(".sq-pr__field")?.insertAdjacentHTML("afterbegin", loopEls(false, range));
}

/**
 * Loop (repeat mode, round the range if one is drawn) or chain (through every
 * pattern). The mode is the song's, so the pattern bar's mode button and the
 * clip view's toggle show the same thing; the range shows on their slots.
 * Turning the loop on with the scene outside the range takes it in.
 */
function setPatLoop(range, on) {
  if (range) state.patLoop = range;
  setPatternMode(on ? "repeat" : "chain");
  const r = state.patLoop;
  if (on && r && (state.activePattern < r.start || state.activePattern >= r.end)) requestPatternSwitch(r.start);
  const span = r && on ? r.end - r.start : 0;
  setStatus(!on ? "chain: playing through every pattern"
    : span > 1 ? `looping patterns ${r.start + 1}-${r.end}` : `looping pattern ${(r ? r.start : state.activePattern) + 1}`);
  announceClips();
  render();
}

/** Whether the transport is going round: repeat mode, which is the loop in every view. */
const looping = () => state.patternMode === "repeat";

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
  const sec = secBySlot.get(t._nowSlot ?? trackSlot(t));
  const idx = sec && state.playing && !t._clipOff && t._nowIdx >= 0 && t._nowIdx < sec.len ? sec.off + t._nowIdx : -1;
  head.hidden = idx < 0;
  if (idx >= 0) {
    const x = idx * SW();
    head.style.transform = `translateX(${x}px)`;
    // follow: turn the page as the head nears the right edge (or has gone off the left)
    const sc = root.querySelector(".sq-pr__scroll");
    if (pref.follow && sc && !drag) {
      const keysW = root.querySelector(".sq-pr__keys")?.offsetWidth || 66;
      const viewW = sc.clientWidth - keysW;
      if (x > sc.scrollLeft + viewW - 24 || x < sc.scrollLeft) {
        sc.scrollLeft = Math.max(0, x - 24);
        autoScroll = sc.scrollLeft;
      }
    }
  }
  const nowSlot = sec ? sec.slot : -1;
  if (nowSlot !== headSlot) {
    headSlot = nowSlot;
    root.querySelectorAll(".sq-pr__sec").forEach((el) => el.classList.toggle("is-now", Number(el.dataset.slot) === nowSlot));
  }
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
    .map((p) => `<div class="sq-pr__tone" data-root="${i}" style="left:${xOf(n)}px;top:${yOf(p)}px;width:${n.len * sw - 1}px;height:${rh}px" title="${midiToName(p)}: a tone of ${midiToName(n.pitch)} ${esc(n.chord)}"></div>`).join("");
}

// ---- the track's sound, in a modal -------------------------------------------------

let soundModal = null;

/**
 * The track's own card (its instrument row, panel buttons and inline fx / mod
 * / filter, and the automation lanes behind its aut button) moved into a
 * window over the roll, as the clip and arrangement views move it into their
 * detail. Nothing is copied: every listener and `data-track-id` lookup keeps
 * working. The step grid is hidden in here, since the roll is the editor; a
 * panel the card opens stacks its own modal on top, and escape closes that
 * one first. Closing puts the card back in #tracks and redraws the roll (the
 * engine, the drum kit flag or the notes may have changed).
 */
function openSoundModal(t) {
  if (soundModal || !t.el) return;
  const overlay = document.createElement("div");
  overlay.className = "sq-modal-overlay";
  const modal = document.createElement("div");
  modal.className = "sq-modal sq-pr__soundmodal";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-label", `${t.name || "track"}: sound`);
  const [hue, color] = trackHue(t);
  modal.style.setProperty("--track-hue", String(hue));
  modal.style.setProperty("--track-color", color);
  const done = document.createElement("button");
  done.type = "button";
  done.className = "sq-panel__modal-close";
  done.textContent = "done";
  modal.append(t.el, done);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  const close = () => {
    if (!soundModal) return;
    soundModal = null;
    document.removeEventListener("keydown", onEsc);
    restoreTrackCard(t);
    overlay.remove();
    render();
  };
  // only when this is the top window: a panel opened from the card sits over it
  const onEsc = (e) => {
    if (e.key !== "Escape") return;
    const all = document.querySelectorAll(".sq-modal-overlay");
    if (all[all.length - 1] === overlay) close();
  };
  done.addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  document.addEventListener("keydown", onEsc);
  soundModal = { overlay, close, t };
}

// ---- nudge -----------------------------------------------------------------------

/**
 * Nudge the selected notes' steps by `micro` microsteps (or to `to`), off the
 * grid: the step's offset, which the transport plays and the step grid ticks.
 * A nudge is the step's, so every note starting on a selected note's step
 * moves with it.
 */
function nudgeSelection(t, micro, to = null) {
  const picked = notes.filter((n) => sel.has(key(n)));
  if (!picked.length) { setStatus("select notes first: nudge moves them off the grid by 1/24 of a step"); return; }
  const starts = new Set(picked.map((n) => n.start));
  let last = 0;
  const list = notes.map((n) => {
    if (!starts.has(n.start)) return n;
    const cur = Math.round((n.off || 0) / MICRO);
    last = Math.max(-MICRO_MAX, Math.min(MICRO_MAX, to ?? cur + micro));
    return { ...n, off: Math.round(last * MICRO * 10000) / 10000 };
  });
  commit(t, list, picked);
  setStatus(last ? `nudged ${last > 0 ? "+" : ""}${last}/24 of a step ${last < 0 ? "early" : "late"}` : "on the grid");
}

// ---- hearing a note ----------------------------------------------------------

/**
 * Sound a note on the track. Edits (placing, moving, painting notes) only
 * sound with `hear` on; the keyboard down the left always does (`force`),
 * since hearing the track is all it is for.
 */
async function audition(t, midi, dur = 0.3, vel = 0.8, force = false) {
  if (!t || t.muted || !Number.isFinite(midi)) return;
  if (!pref.hear && !force) return;
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
 * Write a new list of notes (at global steps) back into the track's patterns:
 * each note goes to the pattern its start falls in, cut at that pattern's
 * end. A note that moved between patterns brings its step's fields
 * (stepSnapshot, taken before anything is written). Then select `select`
 * (matched by start and pitch after the fold) and repaint.
 */
function commit(t, list, select = null) {
  const bySlot = new Map(sections.map((sec) => [sec.slot, []]));
  for (const n of list) {
    const sec = sectionAt(n.start);
    if (!sec) continue;
    const moved = n.slot0 != null && n.slot0 !== sec.slot && n.src != null;
    const local = { ...n, start: n.start - sec.off };
    if (moved) { local.snap = stepSnapshot(t.patterns[n.slot0], n.src); local.src = null; }
    bySlot.get(sec.slot).push(local);
  }
  for (const sec of sections) writeNotes(t.patterns[sec.slot], bySlot.get(sec.slot), t.patterns[sec.slot].steps.length);
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
  if (act === "sound") { if (t) openSoundModal(t); return; }
  if (act.startsWith("nudge")) {
    if (t) nudgeSelection(t, act === "nudge0" ? 0 : (e.shiftKey ? 6 : 1) * (act === "nudge-" ? -1 : 1), act === "nudge0" ? 0 : null);
    return;
  }
  if (act === "ghosts") { pref.ghosts = !pref.ghosts; savePref(); render(); return; }
  if (act === "hear") {
    pref.hear = pref.hear === false; savePref();
    b.setAttribute("aria-pressed", String(pref.hear));
    setStatus(pref.hear ? "piano: notes sound as you place them" : "piano: notes are placed silently (the keyboard still sounds)");
    return;
  }
  if (act === "follow") {
    pref.follow = !pref.follow; savePref();
    const sc = root.querySelector(".sq-pr__scroll");
    if (sc) autoScroll = sc.scrollLeft;
    b.setAttribute("aria-pressed", String(pref.follow));
    return;
  }
  if (act === "loop") {
    if (looping()) setPatLoop(null, false);
    else setPatLoop(state.patLoop ?? { start: state.activePattern, end: state.activePattern + 1 }, true);
    return;
  }
  if (/^z[xy][+-]$/.test(act)) {
    const axis = act[1] === "x" ? "zx" : "zy";
    const max = (axis === "zx" ? ZX : ZY).length - 1;
    zoomTo(axis, Math.max(0, Math.min(max, pref[axis] + (act[2] === "+" ? 1 : -1))));
    return;
  }
  if (!t || !act.startsWith("sec-")) return;
  const slot = Number(b.dataset.slot);
  const sec = secBySlot.get(slot);
  if (!sec) return;
  if (act === "sec-play") {
    // stopped: start the transport on this pattern (the transport's own play
    // button, as the clip view's scene double-click does); playing: switch to
    // it, now or at the bar line by the switch setting
    if (state.playing) requestPatternSwitch(slot);
    else { switchPattern(slot); document.getElementById("play")?.click(); }
    render();
    return;
  }
  const oldBars = Math.ceil(sec.len / sec.bar);
  if (act === "sec-len+") resizePattern(t, slot, Math.min(MAX_LEN, sec.len + sec.bar));
  else if (act === "sec-len-") truncatePattern(t, slot, Math.max(1, sec.len - sec.bar));
  else if (act === "sec-x2") extendPatternByDuplicate(t, slot, Math.min(MAX_LEN, sec.len * 2));
  else return;
  // chain mode plays a pattern for its repeat count in bars: keep that with
  // the length when the two agreed, or a longer pattern would be cut short
  const newBars = Math.ceil(t.patterns[slot].steps.length / sec.bar);
  if ((state.patternRepeats[slot] ?? 1) === oldBars) state.patternRepeats[slot] = Math.max(1, Math.min(16, newBars));
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
  if (s.dataset.act === "sec-meter") {
    if (setPatternMeter(Number(s.dataset.slot), s.value)) { if (t) refreshRollIfOpen(t); render(); }
    return;
  }
  if (s.dataset.act === "track") {
    const o = state.tracks.find((x) => String(x.id) === s.value);
    if (o) { setActiveTrack(o); render(); }
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
  const nEl = e.target.closest(".sq-pr__note");
  const idx = nEl ? Number(nEl.dataset.i) : -1;
  const n = idx >= 0 ? notes[idx] : null;
  // A right-click on a note opens its step editor (the field's contextmenu
  // is suppressed, so the browser's menu stays shut).
  if (n && e.button === 2) {
    e.preventDefault();
    lastDown = { at: 0, key: "" };
    openNoteEditor(t, n, nEl);
    return;
  }
  // A double-click on a note deletes it. Timed here rather than left to
  // dblclick, which the pointer capture below retargets to the view.
  const k = n && e.button === 0 ? key(n) : "";
  const now = performance.now();
  if (k && k === lastDown.key && now - lastDown.at < 350) {
    lastDown = { at: 0, key: "" };
    e.preventDefault();
    sel.delete(k);
    commit(t, notes.filter((_, i) => i !== idx));
    return;
  }
  lastDown = { at: now, key: k };
  startGesture(e);
  if (drag) try { root.setPointerCapture(e.pointerId); } catch {}
}

// The step editor edits the pattern the track is on, so a note in another
// pattern puts the track there first.
function openNoteEditor(t, n, nEl) {
  const sec = sectionAt(n.start);
  if (!sec) return;
  if (sec.slot !== trackSlot(t)) {
    switchPattern(sec.slot);
    setStatus(`pattern ${sec.slot + 1}, to edit its step`);
  }
  openStepEditor(t, n.start - sec.off, nEl);
}

function startGesture(e) {
  const t = currentTrack();
  const key_ = e.target.closest(".sq-pr__key");
  if (key_ && e.button === 0) {
    const p = Number(key_.dataset.p);
    drag = { kind: "keys", t, last: p, pointerId: e.pointerId };
    audition(t, p, 0.45, 0.8, true);
    e.preventDefault();
    return;
  }
  const head_ = e.target.closest(".sq-pr__sec-h");
  if (head_ && e.button === 0 && !e.target.closest("button, select")) {
    const slot = Number(head_.parentElement.dataset.slot);
    drag = { kind: "loop", t, a: slot, b: slot, pointerId: e.pointerId };
    paintLoopPreview({ start: slot, end: slot + 1 });
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
  if (!field || e.button !== 0) return;
  const pt = fieldPoint(e, field);
  const nEl = e.target.closest(".sq-pr__note");
  const idx = nEl ? Number(nEl.dataset.i) : -1;
  const n = idx >= 0 ? notes[idx] : null;
  const base = { t, field, pointerId: e.pointerId, x0: pt.step, y0: pt.y, px0: pt.x, r0: pt.row, moved: false };
  e.preventDefault();

  if (pref.tool === "erase") {
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
    const right = xOf(n) + n.len * SW();
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
  if (pref.tool === "paint") {
    drag = { ...base, kind: "paint", start0: snapG(pt.step, "floor"), placed: new Map() };
    paintAt(pt);
    return;
  }
  // draw: a new note, dragged into place from here
  const start = snapG(pt.step, "floor");
  if (start >= totalSteps()) { drag = { ...base, kind: "noop" }; return; }
  const made = stampNotes(t, start, Math.min(lenFor(t), secEnd(start) - start), pt.pitch);
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
    if (start < 0 || start >= totalSteps() || drag.placed.has(start)) continue;
    const made = stampNotes(t, start, Math.min(len, secEnd(start) - start), pt.pitch);
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
  const beat = sectionAt(step)?.beat ?? 4;
  for (const n of notes) if (n.root && n.start <= step && n.start > s && step - n.start < Math.max(1, beat / 2)) s = n.start;
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
    if (p != null && p !== drag.last) { drag.last = p; audition(t, p, 0.35, 0.8, true); }
    return;
  }
  if (drag.kind === "vel") { velAt(e); return; }
  if (drag.kind === "loop") {
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest?.(".sq-pr__sec");
    const b = el ? Number(el.dataset.slot) : drag.b;
    if (b !== drag.b) { drag.b = b; paintLoopPreview({ start: Math.min(drag.a, b), end: Math.max(drag.a, b) + 1 }); }
    return;
  }
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
      const nx1 = xOf(n), nx2 = nx1 + n.len * sw, ny1 = yOf(n.pitch), ny2 = ny1 + RH();
      if (nx2 > x1 && nx1 < x2 && ny2 > y1 && ny1 < y2) sel.add(key(n));
    }
    paintSel();
    return;
  }
  if (drag.kind === "resize") {
    const end = Math.min(secEnd(drag.grabStart), Math.max(drag.grabStart + 1, snapG(drag.grabEnd + pt.step - drag.x0)));
    const d = end - drag.grabEnd;
    drag.d = d;
    drag.ids.forEach((i, j) => {
      const o = drag.orig[j];
      const l = Math.max(1, Math.min(secEnd(o.start) - o.start, o.len + d));
      const el = noteEl(i);
      if (el) el.style.width = `${l * sw - 1}px`;
      drag.field.querySelectorAll(`.sq-pr__tone[data-root="${i}"]`).forEach((tEl) => { tEl.style.width = `${l * sw - 1}px`; });
    });
    return;
  }
  if (drag.kind === "move") {
    const minStart = Math.min(...drag.orig.map((o) => o.start));
    const maxEnd = Math.max(...drag.orig.map((o) => o.start + o.len));
    const dStep = Math.max(-minStart, Math.min(totalSteps() - maxEnd, snapG(drag.grab.start + pt.step - drag.x0) - drag.grab.start));
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
      el.style.left = `${xOf(o, o.start + dStep)}px`;
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
  if (d.kind === "loop") { setPatLoop({ start: Math.min(d.a, d.b), end: Math.max(d.a, d.b) + 1 }, true); return; }
  if (d.kind === "vel") {
    if (!d.changes.size) return;
    for (const [g, v] of d.changes) {
      const sec = sectionAt(g);
      const p = sec && t.patterns[sec.slot];
      if (p?.steps[g - sec.off]) p.velocities[g - sec.off] = v;
    }
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
      list[i] = { ...o, len: Math.max(1, Math.min(secEnd(o.start) - o.start, o.len + d.d)) };
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
    const copies = ps.map((n) => ({ ...n, start: n.start + span })).filter((n) => n.start < totalSteps());
    if (copies.length) commit(t, [...notes, ...copies], copies);
    e.preventDefault();
    return;
  }
  if (e.altKey && !mod && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
    nudgeSelection(t, (e.shiftKey ? 6 : 1) * (e.key === "ArrowLeft" ? -1 : 1));
    e.preventDefault();
    return;
  }
  if (mod || e.altKey) return;
  // ↑ ↓ move a row (a semitone, or a scale degree when folded), shift an octave
  let dS = 0, dP = 0, dRow = 0;
  if (e.key === "ArrowUp") { if (e.shiftKey) dP = 12; else dRow = -1; }
  else if (e.key === "ArrowDown") { if (e.shiftKey) dP = -12; else dRow = 1; }
  else if (e.key === "ArrowRight") dS = e.shiftKey ? meterOf(t).bar : snapUnit(secBySlot.get(trackSlot(t)));
  else if (e.key === "ArrowLeft") dS = -(e.shiftKey ? meterOf(t).bar : snapUnit(secBySlot.get(trackSlot(t))));
  else return;
  e.preventDefault();
  const ps = picked();
  const minS = Math.min(...ps.map((n) => n.start)), maxE = Math.max(...ps.map((n) => n.start + n.len));
  const minP = Math.min(...ps.map((n) => n.pitch)), maxP = Math.max(...ps.map((n) => n.pitch));
  dS = Math.max(-minS, Math.min(totalSteps() - maxE, dS));
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
