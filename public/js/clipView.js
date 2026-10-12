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
 */

import { PATTERN_COUNT } from "./constants.js";
import { setStatus } from "./dom.js";
import { launchClip, requestClipLaunch, setArrangeRecord, stopAllClips, stopClip } from "./clips.js";
import { patternLocked } from "./patternSound.js";
import { isPatternNonEmpty, requestPatternSwitch, state, trackSlot } from "./state.js";
import { writePatternOnto } from "./track.js";
import { onViewChange, setView } from "./views.js";

let root = null;
let raf = 0;

export function installClipView() {
  root = document.getElementById("clips");
  if (!root) return;
  root.addEventListener("click", onClick);
  root.addEventListener("dblclick", onDblClick);
  root.addEventListener("dragstart", onDragStart);
  root.addEventListener("dragover", onDragOver);
  root.addEventListener("dragleave", onDragLeave);
  root.addEventListener("drop", onDrop);
  onViewChange((v) => { if (v === "clips") render(); });
  for (const ev of ["seqbaby:clips", "seqbaby:songedited", "seqbaby:setapplied", "seqbaby:newset"]) {
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
      cells.push(`<button type="button" class="${cls.join(" ")}" data-slot="${i}" draggable="true" title="${esc(t.name)}: pattern ${i + 1}. Click to launch it on this track; drag onto another cell to copy it there">${i + 1}</button>`);
    }
    return `<div class="sq-clips__row${t.muted ? " is-muted" : ""}" data-track-id="${t.id}">
      <div class="sq-clips__strip">
        <span class="sq-clips__name" title="${esc(t.name)}">${esc(t.name)}</span>
        <button type="button" class="sq-clips__mute" data-act="mute" aria-pressed="${!!t.muted}" title="mute">m</button>
        <button type="button" class="sq-clips__solo" data-act="solo" aria-pressed="${!!t.soloed}" title="solo">s</button>
        <button type="button" class="sq-clips__stop${t._clipOff ? " is-on" : ""}" data-act="stop" title="stop this track's clip">■</button>
      </div>
      <div class="sq-clips__cells">${cells.join("")}</div>
    </div>`;
  }).join("");
  root.innerHTML = `
    <div class="sq-clips__head">
      <div class="sq-clips__strip">
        <button type="button" class="sq-clips__rec" data-act="rec" aria-pressed="${!!state.arrRecord}" title="record: write the clips you launch into the arrangement, bar by bar">● rec</button>
        <button type="button" class="sq-clips__stop sq-clips__stopall" data-act="stopall" title="stop every clip">■</button>
      </div>
      <div class="sq-clips__cells sq-clips__scenes">${scenes.join("")}</div>
    </div>
    <div class="sq-clips__rows">${trackRows}</div>`;
}

function onClick(e) {
  const scene = e.target.closest("[data-scene]");
  if (scene) { requestPatternSwitch(Number(scene.dataset.scene)); return; }
  const act = e.target.closest("[data-act]")?.dataset.act;
  if (act === "rec") { setArrangeRecord(!state.arrRecord); setStatus(state.arrRecord ? "recording the arrangement: launch clips, each bar is written as it plays" : "arrangement record off"); return; }
  if (act === "stopall") { stopAllClips(); return; }
  const row = e.target.closest(".sq-clips__row");
  const t = row && trackById(row.dataset.trackId);
  if (!t) return;
  if (act === "mute" || act === "solo") {
    // the track's own button, so one piece of code owns what mute means
    t.el?.querySelector(act === "mute" ? ".sq-track__mute" : ".sq-track__solo")?.click();
    scheduleClipPaint();
    return;
  }
  if (act === "stop") { stopClip(t); return; }
  const cell = e.target.closest(".sq-clip");
  if (cell) requestClipLaunch(t, Number(cell.dataset.slot));
}

function onDblClick(e) {
  // edit it: the groove view, with this track on that pattern
  const cell = e.target.closest(".sq-clip");
  const row = e.target.closest(".sq-clips__row");
  const t = row && trackById(row.dataset.trackId);
  if (!cell || !t) return;
  launchClip(t, Number(cell.dataset.slot));
  setView("groove");
  t.el?.scrollIntoView({ block: "center", behavior: "smooth" });
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
