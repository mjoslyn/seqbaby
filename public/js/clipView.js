/**
 * The clip view: tracks as rows, the 32 pattern slots as columns, every cell a
 * clip to launch on that track alone (clips.js). A row of scene buttons along
 * the top launches a whole column, which is the pattern bar's switch under
 * another name; a stop square per row stops that track's clip, and one at the
 * head stops them all. The `rec` button arms the arrangement recorder, so
 * launching clips here writes the arrangement (arrangeView.js plays it back).
 *
 * It is a PICTURE of state the engine already holds — `trackSlot(t)`,
 * `t._queuedSlot`, `t._clipOff`, `patternLocked`, `isPatternNonEmpty` — so it
 * is rebuilt whole whenever any of that moves (a few hundred buttons, cheap),
 * coalesced onto one frame and only while it is the open view. It hears about
 * launches from `seqbaby:clips` (clips.js, and state.js's pattern repaint),
 * and about the song from the three session events history.js and the code
 * drawer already listen to.
 *
 * Dragging a cell onto another copies the pattern there, through the same
 * routine as the track head's paste (`writePatternOnto`), so across tracks
 * the lanes the target engine cannot play are dropped the same way.
 *
 * **The detail under the grid is the selected track's own card**
 * (trackDetail.js): its instrument row, inline fx / mod / filter panels and
 * the step grid of the pattern it is on. So the selected CLIP is the one its
 * track is on: clicking a cell launches it and selects the track; clicking a
 * track's name selects without launching; double-clicking a cell mutes the
 * clip (the track stops, as its ■ does).
 *
 * Every DISTINCT clip on a track gets its own shade of the track's colour
 * (`clipShades`: a signature of the pattern's per-step arrays, numbered in
 * order of first appearance across the 32 slots, so two copies of one pattern
 * look the same and a pattern that differs by one note does not). The shade
 * is a hue nudge plus a lightness step off `--track-hue` (`SHADES`), written
 * on the cell as `--clip-c`; the first distinct clip is the track's own colour.
 *
 * A clip's length in bars is written on its cell, and the cell's right edge
 * is a FILL handle: drag it across the cells beside it and the clip is copied
 * into each of those scenes on release (a spreadsheet's fill handle), through
 * `writePatternOnto` again, so a p-lock a target already holds stays its own.
 * Either direction; the cells it will fill are marked while the drag lasts.
 * SHIFT-drag the same handle to change the clip's LENGTH instead, a bar at a
 * time (grown by duplicating what is there, as the track head's x2 does;
 * shrunk by truncating): the cell previews its width over its neighbours.
 * Both are relative to the grab, as a knob's drag is.
 */

import { PATTERN_COUNT } from "./constants.js";
import { setStatus } from "./dom.js";
import { announceClips, requestClipLaunch, setArrangeRecord, stopClip } from "./clips.js";
import { MODE_UI, SWITCH_UI, setPatternMode } from "./patternBar.js";
import { patternLocked } from "./patternSound.js";
import { isPatternNonEmpty, requestPatternSwitch, state, switchPattern, trackSlot } from "./state.js";
import { extendPatternByDuplicate, truncatePattern, writePatternOnto } from "./track.js";
import { patternMeter, stepsPerBarForMeter } from "./meter.js";
import { makeTrackDetail } from "./trackDetail.js";
import { onViewChange } from "./views.js";

let root = null;
let grid = null;      // the rebuilt half: scenes and cells
let detail = null;    // the persistent half: the selected track's card (trackDetail.js)
let raf = 0;

export function installClipView() {
  root = document.getElementById("clips");
  if (!root) return;
  grid = document.createElement("div");
  grid.className = "sq-clips__grid";
  root.appendChild(grid);
  detail = makeTrackDetail(root, scheduleClipPaint);
  root.addEventListener("click", onClick);
  root.addEventListener("dblclick", onDblClick);
  root.addEventListener("pointerdown", onFillStart);
  root.addEventListener("dragstart", onDragStart);
  root.addEventListener("dragover", onDragOver);
  root.addEventListener("dragleave", onDragLeave);
  root.addEventListener("drop", onDrop);
  onViewChange((v) => { if (v === "clips") render(); else detail.release(); });
  for (const ev of ["seqbaby:clips", "seqbaby:songedited", "seqbaby:setapplied", "seqbaby:newset", "seqbaby:transport"]) {
    window.addEventListener(ev, scheduleClipPaint);
  }
}

/** Repaint on the next frame, if this is the open view. */
export function scheduleClipPaint() {
  if (state.view !== "clips" || !root || raf) return;
  raf = requestAnimationFrame(() => { raf = 0; render(); });
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const trackById = (id) => state.tracks.find((t) => String(t.id) === String(id));
const rows = () => state.tracks.filter((t) => t.engineKey !== "bus");

// The shades a track's distinct clips wear, as [hue nudge (deg), saturation
// %, lightness %] off the row's `--track-hue`. Shade 0 is the track's own
// colour (no override); the rest stay within a third of a turn of it, so a
// clip never reads as another track's.
const SHADES = [
  null, [22, 65, 55], [-22, 65, 66], [0, 40, 46], [12, 85, 72], [-12, 45, 58], [36, 70, 62], [-36, 55, 68],
  [8, 30, 40], [-8, 90, 76], [28, 50, 50], [-28, 80, 60],
];

/**
 * The colour a track's distinct clip wears, as a CSS value off `--track-hue`,
 * or "" for shade 0 (the track's own colour) and an empty slot. The
 * arrangement's blocks wear the same, so a pattern reads the same in both.
 * @param {number} n a clipShades entry
 */
export function clipShadeColor(n) {
  const shade = n > 0 ? SHADES[n % SHADES.length] : null;
  return shade ? `hsl(calc(var(--track-hue) + ${shade[0]}) ${shade[1]}% ${shade[2]}%)` : "";
}

const SIG_FIELDS = ["steps", "lengths", "notes", "velocities", "chords", "extraNotes", "extraLengths", "ratchets", "arps", "offsets", "strums"];

/** A number per slot: which distinct clip it is on this track, in order of first appearance. Empty slots get -1. */
export function clipShades(t) {
  const seen = new Map();
  const out = [];
  for (let i = 0; i < PATTERN_COUNT; i++) {
    const p = t.patterns?.[i];
    if (!p?.steps?.some(Boolean)) { out.push(-1); continue; }
    let sig = "";
    for (const k of SIG_FIELDS) sig += JSON.stringify(p[k] ?? null) + "|";
    sig += JSON.stringify(p.automation ?? null);
    let n = seen.get(sig);
    if (n == null) { n = seen.size; seen.set(sig, n); }
    out.push(n);
  }
  return out;
}

function render() {
  if (!root) return;
  const ap = state.activePattern;
  const scenes = [];
  for (let i = 0; i < PATTERN_COUNT; i++) {
    const cls = ["sq-clips__scene"];
    if (isPatternNonEmpty(i)) cls.push("is-filled");
    if (i === ap) cls.push("is-active");
    if (i === state.queuedPattern) cls.push("is-queued");
    scenes.push(`<button type="button" class="${cls.join(" ")}" data-scene="${i}" title="scene ${i + 1}: every track to pattern ${i + 1}. Double-click to play it now">${i + 1}</button>`);
  }
  const trackRows = rows().map((t) => {
    const slot = trackSlot(t);
    const cells = [];
    const shades = clipShades(t);
    for (let i = 0; i < PATTERN_COUNT; i++) {
      const p = t.patterns?.[i];
      const cls = ["sq-clip"];
      const shade = clipShadeColor(shades[i]);
      const style = shade ? ` style="--clip-c:${shade}"` : "";
      const bars = p ? Math.max(1, Math.ceil(p.steps.length / stepsPerBarForMeter(patternMeter(i)))) : 1;
      if (bars > 1) cls.push("is-long");
      if (p?.steps?.some(Boolean)) cls.push("is-filled");
      if (i === slot && !t._clipOff) cls.push("is-now");
      if (i === t._queuedSlot) cls.push("is-queued");
      if (patternLocked(t, i)) cls.push("is-locked");
      if (i === ap) cls.push("is-scene");
      cells.push(`<button type="button" class="${cls.join(" ")}" data-slot="${i}"${style} draggable="true" title="${esc(t.name)}: pattern ${i + 1}, ${bars} bar${bars === 1 ? "" : "s"}. Click to launch it on this track, double-click to mute it; drag onto another cell to copy it there; drag its right edge across the cells beside it to copy it into those scenes, or shift-drag it to make it longer or shorter">${i + 1}${bars > 1 ? `<i class="sq-clip__bars">${bars}</i>` : ""}<span class="sq-clip__fill"></span></button>`);
    }
    return `<div class="sq-clips__row${t.muted ? " is-muted" : ""}" data-track-id="${t.id}">
      <div class="sq-clips__strip">
        <button type="button" class="sq-clips__name" data-act="select" title="${esc(t.name)}: show this track's instrument, effects and pattern below">${esc(t.name)}</button>
        <button type="button" class="sq-clips__mute" data-act="mute" aria-pressed="${!!t.muted}" title="mute">m</button>
        <button type="button" class="sq-clips__solo" data-act="solo" aria-pressed="${!!t.soloed}" title="solo">s</button>
        <button type="button" class="sq-clips__stop${t._clipOff ? " is-on" : ""}" data-act="stop" title="${t._clipOff ? `play this track's clip again (pattern ${slot + 1})` : "stop this track's clip"}">${t._clipOff ? "▶" : "■"}</button>
      </div>
      <div class="sq-clips__cells">${cells.join("")}</div>
    </div>`;
  }).join("");
  const mode = state.patternMode;
  grid.innerHTML = `
    <div class="sq-clips__bar">
      <button type="button" class="sq-clips__play${state.playing ? " is-playing" : ""}" data-act="play" title="${state.playing ? "stop the transport" : "play"}">${state.playing ? "stop" : "play"}</button>
      <button type="button" class="sq-clips__mode sq-btn--ghost sq-icon-btn" data-act="mode" aria-pressed="${mode !== "repeat"}" title="${MODE_UI[mode].title}">${MODE_UI[mode].icon}</button>
      <button type="button" class="sq-clips__switch sq-btn--ghost sq-icon-btn" data-act="switch" aria-pressed="${state.patternSwitchMode === "finish"}" title="${SWITCH_UI[state.patternSwitchMode === "finish" ? "finish" : "immediate"].title}">${SWITCH_UI[state.patternSwitchMode === "finish" ? "finish" : "immediate"].icon}</button>
      <button type="button" class="sq-clips__rec" data-act="rec" aria-pressed="${!!state.arrRecord}" title="record: write the clips you launch into the arrangement, bar by bar; over an existing arrangement you are asked whether the recording replaces it or goes after it">● rec</button>
    </div>
    <div class="sq-clips__head">
      <div class="sq-clips__strip"></div>
      <div class="sq-clips__cells sq-clips__scenes">${scenes.join("")}</div>
    </div>
    <div class="sq-clips__rows">${trackRows}</div>`;
  const shown = detail.sync();
  if (shown) grid.querySelector(`.sq-clips__row[data-track-id="${shown.id}"]`)?.classList.add("is-selected");
}

function onClick(e) {
  // the click that follows a handle drag (the pointer was captured, so it
  // lands on the source cell) is not a launch
  if (e.target.closest(".sq-clip__fill") || dragged) { dragged = false; return; }
  const scene = e.target.closest("[data-scene]");
  if (scene) { requestPatternSwitch(Number(scene.dataset.scene)); return; }
  const act = e.target.closest("[data-act]")?.dataset.act;
  if (act === "rec") { setArrangeRecord(!state.arrRecord); setStatus(state.arrRecord ? "recording the arrangement: launch clips, each bar is written as it plays" : "arrangement record off"); return; }
  // the transport's own button, so a jam's shared start goes the same way
  if (act === "play") { document.getElementById("play")?.click(); return; }
  if (act === "mode") { setPatternMode(state.patternMode === "repeat" ? "chain" : "repeat"); announceClips(); return; }
  // the pattern bar's own switch button, so flipping to "now" commits a queued switch there too
  if (act === "switch") { document.getElementById("pattern-switch")?.click(); announceClips(); return; }
  const row = e.target.closest(".sq-clips__row");
  const t = row && trackById(row.dataset.trackId);
  if (!t) return;
  if (act === "mute" || act === "solo") {
    // the track's own button, so one piece of code owns what mute means
    t.el?.querySelector(act === "mute" ? ".sq-track__mute" : ".sq-track__solo")?.click();
    scheduleClipPaint();
    return;
  }
  // the row's square is a toggle: stopped, it plays the track's clip again,
  // the way a cell click would (so in finish mode it waits for the bar)
  if (act === "stop") { if (t._clipOff) requestClipLaunch(t, trackSlot(t)); else stopClip(t); return; }
  if (act === "select") { detail.select(t); return; }
  const cell = e.target.closest(".sq-clip");
  if (cell) { requestClipLaunch(t, Number(cell.dataset.slot)); detail.select(t); }
}

function onDblClick(e) {
  // a scene number: play that scene now, whatever the switch setting, and
  // start the transport if it is stopped
  const scene = e.target.closest("[data-scene]");
  if (scene) {
    switchPattern(Number(scene.dataset.scene));
    if (!state.playing) document.getElementById("play")?.click();
    return;
  }
  // mute the clip: the track stops (its ■ lights); a single click plays it again
  const cell = e.target.closest(".sq-clip");
  const row = e.target.closest(".sq-clips__row");
  const t = row && trackById(row.dataset.trackId);
  if (!cell || !t) return;
  stopClip(t);
}

// ---- the length drag ---------------------------------------------------------

let dragged = false;   // a handle drag just ended: swallow the click it leaves behind
let fill = null;   // { mode: "fill" | "grow", t, slot, cell, row, x0, pitch, from, to, spb, bars0, bars, maxBars }

function onFillStart(e) {
  if (e.button !== 0 || !e.target.classList.contains("sq-clip__fill")) return;
  const cell = e.target.closest(".sq-clip");
  const row = e.target.closest(".sq-clips__row");
  const t = row && trackById(row.dataset.trackId);
  if (!cell || !t) return;
  const slot = Number(cell.dataset.slot);
  const p = t.patterns?.[slot];
  if (!p) return;
  const r = cell.getBoundingClientRect();
  const next = cell.nextElementSibling?.getBoundingClientRect() || cell.previousElementSibling?.getBoundingClientRect();
  const pitch = next ? Math.abs(next.left - r.left) : r.width;      // a cell plus its gap
  // relative to the grab, as a knob's drag is: nothing happens until the
  // pointer has crossed into the next cell (a cell is drawn one column wide
  // whatever its length, so an absolute read would snap a long clip to one
  // bar the moment the handle moved)
  const spb = stepsPerBarForMeter(patternMeter(slot));
  const bars0 = Math.max(1, Math.ceil(p.steps.length / spb));
  fill = { mode: e.shiftKey ? "grow" : "fill", t, slot, cell, row, x0: e.clientX, pitch, from: slot, to: slot,
           spb, bars0, bars: bars0, maxBars: Math.max(1, Math.floor(128 / spb)) };
  cell.draggable = false;                                   // not a copy drag
  cell.classList.add(fill.mode === "grow" ? "is-growing" : "is-filling");
  if (fill.mode === "grow") cell.style.width = `calc(${bars0 * pitch}px - var(--clip-gap, 3px))`;
  e.preventDefault();
  try { e.target.setPointerCapture(e.pointerId); } catch {}
  const move = (ev) => onFillMove(ev);
  const up = (ev) => { e.target.removeEventListener("pointermove", move); e.target.removeEventListener("pointerup", up); e.target.removeEventListener("pointercancel", up); onFillEnd(ev); };
  e.target.addEventListener("pointermove", move);
  e.target.addEventListener("pointerup", up);
  e.target.addEventListener("pointercancel", up);
}

function fillRange(f, clientX) {
  const n = Math.round((clientX - f.x0) / f.pitch);
  if (n > 0) return [f.slot + 1, Math.min(PATTERN_COUNT - 1, f.slot + n)];
  if (n < 0) return [Math.max(0, f.slot + n), f.slot - 1];
  return [f.slot, f.slot];
}

function onFillMove(e) {
  if (!fill) return;
  if (fill.mode === "grow") {
    const bars = Math.max(1, Math.min(fill.maxBars, fill.bars0 + Math.round((e.clientX - fill.x0) / fill.pitch)));
    if (bars === fill.bars) return;
    fill.bars = bars;
    fill.cell.style.width = `calc(${bars * fill.pitch}px - var(--clip-gap, 3px))`;
    fill.cell.querySelector(".sq-clip__bars")?.remove();
    if (bars > 1) fill.cell.insertAdjacentHTML("beforeend", `<i class="sq-clip__bars">${bars}</i>`);
    return;
  }
  const [from, to] = fillRange(fill, e.clientX);
  if (from === fill.from && to === fill.to) return;
  fill.from = from; fill.to = to;
  for (const c of fill.row.querySelectorAll(".sq-clip")) {
    const i = Number(c.dataset.slot);
    c.classList.toggle("is-fill-target", i !== fill.slot && i >= from && i <= to);
  }
}

function onFillEnd() {
  const f = fill;
  fill = null;
  if (!f) return;
  dragged = true;
  setTimeout(() => { dragged = false; }, 0);   // only the click of this gesture
  for (const c of f.row.querySelectorAll(".sq-clip")) { c.classList.remove("is-fill-target", "is-filling", "is-growing"); c.style.width = ""; c.draggable = true; }
  const { t, slot } = f;
  if (f.mode === "grow") {
    const { spb, bars, bars0 } = f;
    if (bars === bars0) { scheduleClipPaint(); return; }
    if (bars > bars0) extendPatternByDuplicate(t, slot, bars * spb);
    else truncatePattern(t, slot, bars * spb);
    announceClips();
    setStatus(`${t.name}: pattern ${slot + 1} is ${bars} bar${bars === 1 ? "" : "s"} long`);
    return;
  }
  const targets = [];
  for (let i = f.from; i <= f.to; i++) if (i !== slot) targets.push(i);
  if (!targets.length) { scheduleClipPaint(); return; }
  const pattern = t.patterns[slot];
  for (const i of targets) writePatternOnto(t, i, pattern);
  announceClips();
  setStatus(`${t.name}: pattern ${slot + 1} copied to ${targets.length === 1 ? `pattern ${targets[0] + 1}` : `patterns ${targets[0] + 1} to ${targets[targets.length - 1] + 1}`}`);
}

function onDragStart(e) {
  if (fill) { e.preventDefault(); return; }
  const cell = e.target.closest(".sq-clip");
  const row = e.target.closest(".sq-clips__row");
  if (!cell || !row) return;
  e.dataTransfer.setData("text/clip", `${row.dataset.trackId}:${cell.dataset.slot}`);
  e.dataTransfer.effectAllowed = "copy";
}
function onDragOver(e) {
  const cell = e.target.closest(".sq-clip");
  if (!cell) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "copy";
  cell.classList.add("is-drag-over");
}
function onDragLeave(e) {
  e.target.closest?.(".sq-clip")?.classList.remove("is-drag-over");
}
function onDrop(e) {
  const cell = e.target.closest(".sq-clip");
  const row = e.target.closest(".sq-clips__row");
  if (!cell || !row) return;
  e.preventDefault();
  cell.classList.remove("is-drag-over");
  const [fromId, fromSlot] = (e.dataTransfer.getData("text/clip") || "").split(":");
  const src = trackById(fromId), dst = trackById(row.dataset.trackId);
  const from = Number(fromSlot), to = Number(cell.dataset.slot);
  if (!src || !dst || !Number.isInteger(from) || (src === dst && from === to)) return;
  const pattern = src.patterns?.[from];
  if (!pattern) return;
  writePatternOnto(dst, to, pattern);
  scheduleClipPaint();
  setStatus(`copied ${src.name} pattern ${from + 1} → ${dst.name} pattern ${to + 1}`);
}
