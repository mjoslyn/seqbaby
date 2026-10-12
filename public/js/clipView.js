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
 * **The detail under the grid is the selected track's own card**: its
 * instrument row, its inline fx / mod / filter panels and the step grid of the
 * pattern it is on — the track's real `.sq-track` element, MOVED out of
 * `#tracks` (hidden in this view) into the detail and put back where it was
 * when another track is selected or the view closes, the way a panel is
 * reparented into a modal and the pattern bar's children into its phone
 * menu. Nothing is copied: every listener, every knob and every lookup by
 * `data-track-id` keep working, and the step grid shows the clip the track is
 * on because the alias is the track's. So the selected CLIP is the one its
 * track is on: clicking a cell launches it and selects the track; clicking a
 * track's name selects without launching. The grid's own repaint is
 * `innerHTML` on a sibling of the detail, never on the detail itself, since a
 * rebuilt innerHTML would take the track's card out of the document.
 */

import { PATTERN_COUNT } from "./constants.js";
import { setStatus } from "./dom.js";
import { launchClip, requestClipLaunch, setArrangeRecord, stopAllClips, stopClip } from "./clips.js";
import { patternLocked } from "./patternSound.js";
import { setActiveTrack } from "./render.js";
import { isPatternNonEmpty, requestPatternSwitch, state, trackSlot } from "./state.js";
import { writePatternOnto } from "./track.js";
import { onViewChange, setView } from "./views.js";

// the track list's eight hues (style.css), for the detail's stripe and borders
const HUES = [[35, "hsl(35 85% 58%)"], [232, "hsl(232 70% 68%)"], [297, "hsl(297 55% 68%)"], [120, "hsl(120 45% 52%)"],
  [253, "hsl(253 70% 72%)"], [318, "hsl(318 65% 68%)"], [155, "hsl(155 45% 50%)"], [275, "hsl(275 55% 70%)"]];

let root = null;
let grid = null;      // the rebuilt half: scenes and cells
let detail = null;    // the persistent half: the selected track's card
let raf = 0;
let selectedId = null;

export function installClipView() {
  root = document.getElementById("clips");
  if (!root) return;
  grid = document.createElement("div");
  grid.className = "sq-clips__grid";
  detail = document.createElement("div");
  detail.className = "sq-clips__detail";
  detail.innerHTML = `<div class="sq-clips__detail-title"></div>`;
  root.append(grid, detail);
  root.addEventListener("click", onClick);
  root.addEventListener("dblclick", onDblClick);
  root.addEventListener("dragstart", onDragStart);
  root.addEventListener("dragover", onDragOver);
  root.addEventListener("dragleave", onDragLeave);
  root.addEventListener("drop", onDrop);
  onViewChange((v) => { if (v === "clips") render(); else releaseDetail(); });
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
    return `<div class="sq-clips__row${t.muted ? " is-muted" : ""}${t.id === selectedId ? " is-selected" : ""}" data-track-id="${t.id}">
      <div class="sq-clips__strip">
        <button type="button" class="sq-clips__name" data-act="select" title="${esc(t.name)}: show this track's instrument, effects and pattern below">${esc(t.name)}</button>
        <button type="button" class="sq-clips__mute" data-act="mute" aria-pressed="${!!t.muted}" title="mute">m</button>
        <button type="button" class="sq-clips__solo" data-act="solo" aria-pressed="${!!t.soloed}" title="solo">s</button>
        <button type="button" class="sq-clips__stop${t._clipOff ? " is-on" : ""}" data-act="stop" title="stop this track's clip">■</button>
      </div>
      <div class="sq-clips__cells">${cells.join("")}</div>
    </div>`;
  }).join("");
  grid.innerHTML = `
    <div class="sq-clips__head">
      <div class="sq-clips__strip">
        <button type="button" class="sq-clips__rec" data-act="rec" aria-pressed="${!!state.arrRecord}" title="record: write the clips you launch into the arrangement, bar by bar">● rec</button>
        <button type="button" class="sq-clips__stop sq-clips__stopall" data-act="stopall" title="stop every clip">■</button>
      </div>
      <div class="sq-clips__cells sq-clips__scenes">${scenes.join("")}</div>
    </div>
    <div class="sq-clips__rows">${trackRows}</div>`;
  syncDetail();
}

// ---- the detail: the selected track's card -----------------------------------

/** Where a track's card goes back to: its place in #tracks, by state.tracks order. */
function restoreTrack(t) {
  const host = document.getElementById("tracks");
  if (!t?.el || !host || t.el.parentElement === host) return;
  const i = state.tracks.indexOf(t);
  const next = state.tracks.slice(i + 1).find((o) => o.el?.parentElement === host);
  if (next) host.insertBefore(t.el, next.el); else host.appendChild(t.el);
}

/** Put the selected track's card back in the list (the view is closing). */
function releaseDetail() {
  const t = trackById(selectedId);
  if (t) restoreTrack(t);
}

/** Select a track: its card comes into the detail, the previous one goes home. */
export function selectClipTrack(t) {
  if (!t || t.engineKey === "bus") return;
  const prev = trackById(selectedId);
  if (prev && prev !== t) restoreTrack(prev);
  selectedId = t.id;
  setActiveTrack(t);                 // the computer keyboard plays what is shown
  if (state.view === "clips") scheduleClipPaint();
}

/**
 * After a repaint: a selection that still names a track (the first one when
 * none does, or the song changed under it), its card in the detail (a merge's
 * `setTrackOrder` can have pulled it back into the list), the title.
 */
function syncDetail() {
  const title = detail.querySelector(".sq-clips__detail-title");
  let t = trackById(selectedId);
  if (!t || t.engineKey === "bus") {
    t = trackById(state.activeTrackId);
    if (!t || t.engineKey === "bus") t = rows()[0] || null;
    selectedId = t?.id ?? null;
    if (t) grid.querySelector(`.sq-clips__row[data-track-id="${t.id}"]`)?.classList.add("is-selected");
  }
  for (const o of state.tracks) if (o !== t && o.el?.parentElement === detail) restoreTrack(o);
  if (!t?.el) { title.textContent = ""; detail.hidden = true; return; }
  detail.hidden = false;
  if (t.el.parentElement !== detail) detail.appendChild(t.el);
  const [hue, color] = HUES[rows().indexOf(t) % HUES.length] || HUES[0];
  detail.style.setProperty("--track-hue", String(hue));
  detail.style.setProperty("--track-color", color);
  const slot = trackSlot(t);
  title.textContent = `${t.name || "track"} · pattern ${slot + 1}${t._clipOff ? " (stopped)" : ""}`;
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
  if (act === "select") { selectClipTrack(t); return; }
  const cell = e.target.closest(".sq-clip");
  if (cell) { requestClipLaunch(t, Number(cell.dataset.slot)); selectClipTrack(t); }
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
