/**
 * The arrangement view: a ruler of bars across the top, a row per track, and
 * on each row the track's blocks (arrangement.js) — which pattern plays from
 * which bar, for how long — drawn to a bar width you can zoom. Arrange mode
 * (`patternMode === "arrange"`, the `play arrangement` toggle here or the
 * pattern bar's mode button) is what plays it; `rec` arms the recorder so clip
 * launches in the other views write blocks here.
 *
 * Editing is pointer events on the lanes: drag a block to move it (snapped to
 * the bar), drag its right edge to resize, alt-drag to duplicate, click to
 * select (delete / backspace removes, escape lets go), drag across empty lane
 * to draw a new block of the pattern the track is on, and the number on a
 * selected block opens a 32-cell picker for its pattern. Every edit goes
 * through arrangement.js, lands in `t.arrangement` (which is in the session,
 * so undo, save, a jam and the code drawer all see it without being told) and
 * repaints. The drag previews by moving the element and commits on release.
 *
 * Under the timeline sits the selected track's card (trackDetail.js):
 * clicking a block, or a track's name, selects that track.
 *
 * The start marker on the ruler is where a play press starts the arrangement
 * from (`state.arrStartBar`): click a bar to put it there, and while the
 * arrangement plays the click is a jump, landed at the next bar line. The
 * marker is drawn as the playhead's resting place when nothing plays.
 *
 * The playhead is a line placed by a rAF loop from the tick being heard
 * (`state._nowTick`, the transport's) against `state._arrOrigin`, so it moves
 * at the audible time as the step playhead does; while recording it shows
 * the bar being written instead.
 */

import { PATTERN_COUNT } from "./constants.js";
import { setStatus } from "./dom.js";
import { arrangementBars, blockAt, chainToBlocks, moveBlock, placeBlock, removeBlock, resizeBlock, setBlockSlot } from "./arrangement.js";
import { announceClips, arrangeLength, setArrangeRecord, setArrangeStart } from "./clips.js";
import { showConfirmDialog } from "./dialogs.js";
import { patternMeter, stepsPerBarForMeter, transportMeter } from "./meter.js";
import { setPatternMode } from "./patternBar.js";
import { patternLocked } from "./patternSound.js";
import { isPatternNonEmpty, state, trackSlot } from "./state.js";
import { makeTrackDetail } from "./trackDetail.js";
import { onViewChange } from "./views.js";

const ZOOMS = [24, 48, 96, 160];
const STRIP_W = 150;            // the strip column, in px (style.css agrees)
const MIN_BARS = 16;            // the ruler never shows fewer bars than this

let root = null;
let grid = null;      // the rebuilt half: ruler, lanes, blocks
let detail = null;    // the persistent half: the selected track's card (trackDetail.js)
let raf = 0;
let headRaf = 0;
let zoom = 1;
/** @type {{trackId: number, i: number}|null} the selected block */
let sel = null;
let drag = null;

export function installArrangeView() {
  root = document.getElementById("arrange");
  if (!root) return;
  grid = document.createElement("div");
  grid.className = "sq-arr__view";
  root.appendChild(grid);
  detail = makeTrackDetail(root, scheduleArrangePaint);
  root.addEventListener("click", onClick);
  root.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("keydown", onKey);
  onViewChange((v) => { if (v === "arrange") { render(); headLoop(); } else { stopHead(); detail.release(); } });
  for (const ev of ["seqbaby:clips", "seqbaby:songedited", "seqbaby:setapplied", "seqbaby:newset", "seqbaby:transport"]) {
    window.addEventListener(ev, scheduleArrangePaint);
  }
  window.addEventListener("seqbaby:setapplied", () => { sel = null; });
  window.addEventListener("seqbaby:newset", () => { sel = null; });
}

/** Repaint on the next frame, if this is the open view. */
export function scheduleArrangePaint() {
  if (state.view !== "arrange" || !root || raf) return;
  raf = requestAnimationFrame(() => { raf = 0; render(); });
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const trackById = (id) => state.tracks.find((t) => String(t.id) === String(id));
const rows = () => state.tracks.filter((t) => t.engineKey !== "bus");
const barW = () => ZOOMS[zoom];
const rulerBars = () => Math.max(MIN_BARS, arrangementBars(state.tracks) + 4);

function render() {
  if (!root || drag) return;                 // never under a drag: the preview is on the elements
  const w = barW();
  const bars = rulerBars();
  const beats = Math.max(1, Math.round(patternMeter(0).num));
  const arrange = state.patternMode === "arrange";
  const len = arrangementBars(state.tracks);
  let ruler = "";
  for (let b = 0; b < bars; b++) {
    ruler += `<div class="sq-arr__bar${b % 4 === 0 ? " is-four" : ""}" style="left:${b * w}px;width:${w}px"><span>${b + 1}</span>${
      w >= 48 ? Array.from({ length: beats - 1 }, (_, k) => `<i style="left:${((k + 1) / beats) * 100}%"></i>`).join("") : ""}</div>`;
  }
  const trackRows = rows().map((t) => {
    const now = arrange && state.playing ? blockAt(t.arrangement || [], state.arrBar) : null;
    const blocks = (t.arrangement || []).map((b, i) => {
      const cls = ["sq-arr__block"];
      if (sel && sel.trackId === t.id && sel.i === i) cls.push("is-selected");
      if (now === b) cls.push("is-now");
      if (!t.patterns?.[b.slot]?.steps?.some(Boolean)) cls.push("is-empty");
      return `<div class="${cls.join(" ")}" data-i="${i}" style="left:${b.start * w}px;width:${b.bars * w}px" title="${esc(t.name)}: pattern ${b.slot + 1}, bars ${b.start + 1}-${b.start + b.bars}. Drag to move, drag the right edge to resize, alt-drag to copy">
        <button type="button" class="sq-arr__slot" data-act="slot" title="which pattern this block plays">p${b.slot + 1}</button>${patternLocked(t, b.slot) ? '<span class="sq-arr__lock" title="p-locked: this pattern has a sound of its own">●</span>' : ""}
        <div class="sq-arr__handle"></div>
      </div>`;
    }).join("");
    return `<div class="sq-arr__row${t.muted ? " is-muted" : ""}" data-track-id="${t.id}">
      <div class="sq-arr__strip">
        <button type="button" class="sq-arr__name" data-act="select" title="${esc(t.name)}: show this track's instrument, effects and pattern below">${esc(t.name)}</button>
        <button type="button" class="sq-arr__mute" data-act="mute" aria-pressed="${!!t.muted}" title="mute">m</button>
        <button type="button" class="sq-arr__solo" data-act="solo" aria-pressed="${!!t.soloed}" title="solo">s</button>
        <span class="sq-arr__on" title="the pattern this track is on">p${trackSlot(t) + 1}</span>
      </div>
      <div class="sq-arr__lane" style="width:${bars * w}px" title="drag across empty space to add a block of pattern ${trackSlot(t) + 1}">${blocks}</div>
    </div>`;
  }).join("");
  grid.innerHTML = `
    <div class="sq-arr__bar-row">
      <button type="button" class="sq-arr__play" data-act="play" aria-pressed="${arrange}" title="play the arrangement: each track follows its blocks (the pattern bar's mode button says the same)">${arrange ? "playing arrangement" : "play arrangement"}</button>
      <button type="button" class="sq-arr__rec" data-act="rec" aria-pressed="${!!state.arrRecord}" title="record: write the clips you launch (clip view, pattern bar) into the arrangement, bar by bar">● rec</button>
      <button type="button" class="sq-btn--ghost" data-act="fromchain" title="lay out the chain as blocks on every track: the non-empty patterns in order, each for its repeat count">from chain</button>
      <button type="button" class="sq-btn--ghost" data-act="clear" title="remove every block">clear</button>
      <span class="sq-arr__zoom"><button type="button" class="sq-btn--ghost" data-act="zoom-" title="zoom out">−</button><button type="button" class="sq-btn--ghost" data-act="zoom+" title="zoom in">+</button></span>
      <span class="sq-arr__len">${len} bar${len === 1 ? "" : "s"}${state.arrStartBar ? ` · starts at bar ${state.arrStartBar + 1}` : ""}${arrange ? "" : " · not playing: press play arrangement"}</span>
    </div>
    <div class="sq-arr__scroll">
      <div class="sq-arr__grid" style="--arr-bar-w:${w}px">
        <div class="sq-arr__ruler"><div class="sq-arr__strip"></div><div class="sq-arr__lane sq-arr__lane--ruler" style="width:${bars * w}px">${ruler}</div></div>
        <div class="sq-arr__rows">${trackRows}</div>
        <div class="sq-arr__end" style="left:${STRIP_W + len * w}px" title="the arrangement loops here"></div>
        <div class="sq-arr__start" style="left:${STRIP_W + state.arrStartBar * w}px" title="play starts here (click the ruler to move it)"></div>
        <div class="sq-arr__head" hidden></div>
      </div>
    </div>`;
  const shown = detail.sync();
  if (shown) grid.querySelector(`.sq-arr__row[data-track-id="${shown.id}"]`)?.classList.add("is-selected");
  paintHead();
}

// ---- the playhead ----------------------------------------------------------

function headLoop() {
  if (headRaf) return;
  const tick = () => { headRaf = 0; if (state.view !== "arrange") return; paintHead(); headRaf = requestAnimationFrame(tick); };
  headRaf = requestAnimationFrame(tick);
}
function stopHead() { if (headRaf) cancelAnimationFrame(headRaf); headRaf = 0; }
function paintHead() {
  const head = root?.querySelector(".sq-arr__head");
  if (!head) return;
  const barLen = stepsPerBarForMeter(transportMeter());
  let pos = null;
  if (state.playing && state.patternMode === "arrange") {
    const loop = arrangeLength();
    pos = (((state._nowTick - state._arrOrigin) / barLen) % loop + loop) % loop;
  } else if (state.playing && state.arrRecord) {
    pos = state._nowTick / barLen;
  }
  head.hidden = pos == null;
  if (pos != null) head.style.left = `${STRIP_W + pos * barW()}px`;
  // the block under the head lights up as it plays
  if (state.playing && state.patternMode === "arrange") {
    for (const row of root.querySelectorAll(".sq-arr__row")) {
      const t = trackById(row.dataset.trackId);
      const now = t ? blockAt(t.arrangement || [], state.arrBar) : null;
      row.querySelectorAll(".sq-arr__block").forEach((el, i) => el.classList.toggle("is-now", !!t && t.arrangement[i] === now));
    }
  }
}

// ---- clicks ----------------------------------------------------------------

function onClick(e) {
  // the ruler: where play starts from, or a jump while it plays
  const ruler = e.target.closest(".sq-arr__lane--ruler");
  if (ruler) {
    const bar = Math.max(0, Math.floor((e.clientX - ruler.getBoundingClientRect().left) / barW()));
    setArrangeStart(bar);
    setStatus(state.playing && state.patternMode === "arrange" ? `jumping to bar ${bar + 1} at the bar line` : `the arrangement starts at bar ${bar + 1}`);
    render();
    return;
  }
  const act = e.target.closest("[data-act]")?.dataset.act;
  if (act === "play") { setPatternMode(state.patternMode === "arrange" ? "repeat" : "arrange"); scheduleArrangePaint(); announceClips(); return; }
  if (act === "rec") { setArrangeRecord(!state.arrRecord); scheduleArrangePaint(); return; }
  if (act === "zoom+" || act === "zoom-") { zoom = Math.max(0, Math.min(ZOOMS.length - 1, zoom + (act === "zoom+" ? 1 : -1))); render(); return; }
  if (act === "fromchain") { fromChain(); return; }
  if (act === "clear") { clearAll(); return; }
  const row = e.target.closest(".sq-arr__row");
  const t = row && trackById(row.dataset.trackId);
  if (!t) return;
  if (act === "mute" || act === "solo") {
    t.el?.querySelector(act === "mute" ? ".sq-track__mute" : ".sq-track__solo")?.click();
    scheduleArrangePaint();
    return;
  }
  if (act === "select") { detail.select(t); return; }
  if (act === "slot") {
    const block = e.target.closest(".sq-arr__block");
    if (block) openSlotPicker(t, Number(block.dataset.i), e.target);
  }
}

async function fromChain() {
  const slots = [];
  for (let i = 0; i < PATTERN_COUNT; i++) if (isPatternNonEmpty(i)) slots.push(i);
  if (!slots.length) { setStatus("nothing to lay out: no pattern has steps", true); return; }
  if (state.tracks.some((t) => t.arrangement?.length)) {
    const ok = await showConfirmDialog({ title: "replace the arrangement with the chain?", body: "Every track gets the non-empty patterns in order, each for its repeat count.", confirmLabel: "replace" });
    if (!ok) return;
  }
  for (const t of rows()) t.arrangement = chainToBlocks(state.patternRepeats, slots);
  sel = null;
  commit(`arrangement from the chain: ${slots.length} block${slots.length === 1 ? "" : "s"} per track`);
}

async function clearAll() {
  if (!state.tracks.some((t) => t.arrangement?.length)) return;
  const ok = await showConfirmDialog({ title: "remove every block from the arrangement?", confirmLabel: "clear" });
  if (!ok) return;
  for (const t of state.tracks) t.arrangement = [];
  sel = null;
  commit("arrangement cleared");
}

/** After an edit: repaint, tell the views, say what happened. */
function commit(msg) {
  render();
  announceClips();
  if (msg) setStatus(msg);
}

// ---- the pattern picker on a block ------------------------------------------

function openSlotPicker(t, i, anchor) {
  closePicker();
  const pick = document.createElement("div");
  pick.className = "sq-arr__picker";
  pick.innerHTML = Array.from({ length: PATTERN_COUNT }, (_, k) =>
    `<button type="button" class="sq-pattern__cell${t.patterns?.[k]?.steps?.some(Boolean) ? " is-filled" : ""}${t.arrangement[i]?.slot === k ? " is-active" : ""}" data-pick="${k}">${k + 1}</button>`).join("");
  pick.addEventListener("click", (e) => {
    const b = e.target.closest("[data-pick]");
    if (!b) return;
    t.arrangement = setBlockSlot(t.arrangement, i, Number(b.dataset.pick));
    closePicker();
    commit(`${t.name}: block plays pattern ${Number(b.dataset.pick) + 1}`);
  });
  const r = anchor.getBoundingClientRect();
  pick.style.left = `${Math.min(r.left, window.innerWidth - 300)}px`;
  pick.style.top = `${r.bottom + 4}px`;
  document.body.appendChild(pick);
  setTimeout(() => document.addEventListener("pointerdown", onOutside, { capture: true, once: true }), 0);
}
function onOutside(e) { if (!e.target.closest?.(".sq-arr__picker")) closePicker(); }
function closePicker() { document.querySelectorAll(".sq-arr__picker").forEach((p) => p.remove()); }

// ---- keys -------------------------------------------------------------------

function onKey(e) {
  if (state.view !== "arrange" || !sel) return;
  if (document.activeElement && document.activeElement !== document.body) return;
  if (e.key === "Escape") { sel = null; render(); return; }
  if (e.key === "Delete" || e.key === "Backspace") {
    const t = trackById(sel.trackId);
    if (!t) return;
    t.arrangement = removeBlock(t.arrangement, sel.i);
    sel = null;
    e.preventDefault();
    commit(`${t.name}: block removed`);
  }
}

// ---- the drags --------------------------------------------------------------
//
// One gesture, three meanings by where it starts: on a block (move; alt copies),
// on a block's right edge (resize), on empty lane (draw a new block of the
// pattern the track is on). Snapped to bars. The element previews, the data
// changes on release, so a drag that comes back where it started changes
// nothing and leaves no undo entry.

function onPointerDown(e) {
  if (e.button !== 0) return;
  const lane = e.target.closest(".sq-arr__lane");
  const row = e.target.closest(".sq-arr__row");
  if (!lane || !row) return;
  if (e.target.closest("[data-act]")) return;           // the slot button
  const t = trackById(row.dataset.trackId);
  if (!t) return;
  const w = barW();
  const laneX = lane.getBoundingClientRect().left + lane.scrollLeft;
  const block = e.target.closest(".sq-arr__block");
  if (block) {
    const i = Number(block.dataset.i);
    const b = t.arrangement[i];
    if (!b) return;
    const onHandle = e.target.classList.contains("sq-arr__handle");
    drag = { kind: onHandle ? "resize" : "move", t, i, b, el: block, x0: e.clientX, copy: e.altKey && !onHandle, moved: false, w };
    sel = { trackId: t.id, i };
    if (detail.selectedId !== t.id) detail.select(t);     // its card below (repaints after the drag)
    root.querySelectorAll(".sq-arr__block.is-selected").forEach((el) => el.classList.remove("is-selected"));
    block.classList.add("is-selected");
  } else {
    const bar = Math.max(0, Math.floor((e.clientX - laneX) / w));
    const ghost = document.createElement("div");
    ghost.className = "sq-arr__block is-ghost";
    ghost.style.left = `${bar * w}px`; ghost.style.width = `${w}px`;
    ghost.innerHTML = `<span class="sq-arr__slot">p${trackSlot(t) + 1}</span>`;
    lane.appendChild(ghost);
    drag = { kind: "draw", t, bar, el: ghost, x0: e.clientX, moved: false, w };
    if (detail.selectedId !== t.id) detail.select(t);
  }
  e.preventDefault();
  const target = e.target;
  try { target.setPointerCapture(e.pointerId); } catch {}
  const move = (ev) => onPointerMove(ev);
  const up = (ev) => { target.removeEventListener("pointermove", move); target.removeEventListener("pointerup", up); target.removeEventListener("pointercancel", up); onPointerUp(ev); };
  target.addEventListener("pointermove", move);
  target.addEventListener("pointerup", up);
  target.addEventListener("pointercancel", up);
}

function onPointerMove(e) {
  if (!drag) return;
  const dBars = Math.round((e.clientX - drag.x0) / drag.w);
  if (dBars !== 0) drag.moved = true;
  if (drag.kind === "move") {
    drag.el.style.left = `${Math.max(0, drag.b.start + dBars) * drag.w}px`;
  } else if (drag.kind === "resize") {
    drag.el.style.width = `${Math.max(1, drag.b.bars + dBars) * drag.w}px`;
  } else {
    const bars = Math.max(1, dBars + 1);
    drag.el.style.width = `${bars * drag.w}px`;
  }
}

function onPointerUp(e) {
  const d = drag;
  drag = null;
  if (!d) return;
  const dBars = Math.round((e.clientX - d.x0) / d.w);
  const t = d.t;
  if (d.kind === "draw") {
    d.el.remove();
    const bars = Math.max(1, dBars + 1);
    t.arrangement = placeBlock(t.arrangement, { slot: trackSlot(t), start: d.bar, bars });
    sel = { trackId: t.id, i: t.arrangement.findIndex((b) => b.start === d.bar) };
    commit(`${t.name}: pattern ${trackSlot(t) + 1} on bars ${d.bar + 1}-${d.bar + bars}`);
    return;
  }
  if (!d.moved) { render(); return; }               // a click: selected, nothing moved
  if (d.kind === "resize") {
    t.arrangement = resizeBlock(t.arrangement, d.i, d.b.bars + dBars);
    sel = { trackId: t.id, i: t.arrangement.findIndex((b) => b.start === d.b.start) };
    commit(`${t.name}: block now ${Math.max(1, d.b.bars + dBars)} bar${Math.max(1, d.b.bars + dBars) === 1 ? "" : "s"}`);
    return;
  }
  const start = Math.max(0, d.b.start + dBars);
  t.arrangement = d.copy
    ? placeBlock(t.arrangement, { slot: d.b.slot, start, bars: d.b.bars })
    : moveBlock(t.arrangement, d.i, start);
  sel = { trackId: t.id, i: t.arrangement.findIndex((b) => b.start === start) };
  commit(`${t.name}: ${d.copy ? "copy of " : ""}pattern ${d.b.slot + 1} on bars ${start + 1}-${start + d.b.bars}`);
}

