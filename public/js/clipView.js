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
 */

import { PATTERN_COUNT } from "./constants.js";
import { setStatus } from "./dom.js";
import { announceClips, requestClipLaunch, setArrangeRecord, stopAllClips, stopClip } from "./clips.js";
import { setPatternMode } from "./patternBar.js";
import { patternLocked } from "./patternSound.js";
import { isPatternNonEmpty, requestPatternSwitch, state, trackSlot } from "./state.js";
import { writePatternOnto } from "./track.js";
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

function render() {
  if (!root) return;
  const ap = state.activePattern;
  const scenes = [];
  for (let i = 0; i < PATTERN_COUNT; i++) {
    const cls = ["sq-clips__scene"];
    if (isPatternNonEmpty(i)) cls.push("is-filled");
    if (i === ap) cls.push("is-active");
    if (i === state.queuedPattern) cls.push("is-queued");
    scenes.push(`<button type="button" class="${cls.join(" ")}" data-scene="${i}" title="scene ${i + 1}: every track to pattern ${i + 1}">${i + 1}</button>`);
  }
  const trackRows = rows().map((t) => {
    const slot = trackSlot(t);
    const cells = [];
    for (let i = 0; i < PATTERN_COUNT; i++) {
      const p = t.patterns?.[i];
      const cls = ["sq-clip"];
      if (p?.steps?.some(Boolean)) cls.push("is-filled");
      if (i === slot && !t._clipOff) cls.push("is-now");
      if (i === t._queuedSlot) cls.push("is-queued");
      if (patternLocked(t, i)) cls.push("is-locked");
      if (i === ap) cls.push("is-scene");
      cells.push(`<button type="button" class="${cls.join(" ")}" data-slot="${i}" draggable="true" title="${esc(t.name)}: pattern ${i + 1}. Click to launch it on this track, double-click to mute it; drag onto another cell to copy it there">${i + 1}</button>`);
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
      <button type="button" class="sq-clips__mode sq-btn--ghost" data-act="mode" aria-pressed="${mode !== "repeat"}" title="${mode === "chain" ? "chain: the non-empty patterns play in order, every track together. Click for repeat" : mode === "arrange" ? "arrange: each track follows its arrangement. Click for repeat" : "repeat: the scene loops. Click for chain"}">${mode}</button>
      <button type="button" class="sq-clips__rec" data-act="rec" aria-pressed="${!!state.arrRecord}" title="record: write the clips you launch into the arrangement, bar by bar">● rec</button>
      <button type="button" class="sq-clips__stop sq-clips__stopall sq-btn--ghost" data-act="stopall" title="stop every clip">■ stop all</button>
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
  const scene = e.target.closest("[data-scene]");
  if (scene) { requestPatternSwitch(Number(scene.dataset.scene)); return; }
  const act = e.target.closest("[data-act]")?.dataset.act;
  if (act === "rec") { setArrangeRecord(!state.arrRecord); setStatus(state.arrRecord ? "recording the arrangement: launch clips, each bar is written as it plays" : "arrangement record off"); return; }
  if (act === "stopall") { stopAllClips(); return; }
  // the transport's own button, so a jam's shared start goes the same way
  if (act === "play") { document.getElementById("play")?.click(); return; }
  if (act === "mode") { setPatternMode(state.patternMode === "repeat" ? "chain" : "repeat"); announceClips(); return; }
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
  // mute the clip: the track stops (its ■ lights); a single click plays it again
  const cell = e.target.closest(".sq-clip");
  const row = e.target.closest(".sq-clips__row");
  const t = row && trackById(row.dataset.trackId);
  if (!cell || !t) return;
  stopClip(t);
}

function onDragStart(e) {
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
