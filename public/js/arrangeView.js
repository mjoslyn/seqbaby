/**
 * The arrangement view: a ruler of bars across the top, a row per track, and
 * on each row the track's blocks (arrangement.js) — which pattern plays from
 * which bar, for how long — drawn to a bar width you can zoom. Arrange mode
 * (`patternMode === "arrange"`) is what plays it, and the transport's play
 * goes there on its own in this view (and comes to it at the next bar line
 * when the view is opened while playing: transport.js); `play` here is the
 * transport's own button. `rec` arms the recorder so clip launches in the
 * other views write blocks here.
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
 * Dragging across the ruler draws a LOOP section (`state.arrLoop`, clips.js):
 * with the loop on, arrange mode plays those bars round and round instead of
 * the whole arrangement, and a play press starts inside it. The `loop` button
 * switches it on and off (with no section drawn, it loops the selected
 * block's bars). Not saved, like the marker.
 *
 * The playhead is a line placed by a rAF loop from the tick being heard
 * (`state._nowTick`, the transport's) against `state._arrOrigin` (or the
 * origin before it, for ticks heard from before a wrap), so it moves at the
 * audible time as the step playhead does; while recording it shows the bar
 * being written instead. `follow` keeps it in view, turning the page when it
 * reaches the right edge; scrolling by hand while it plays switches follow
 * off. Remembered per browser.
 *
 * Each block draws its pattern: the notes of one pass, pitch against time,
 * repeated across the block as it loops (`patternPicture`), and every
 * distinct pattern on a track wears the shade it wears in the clip view.
 *
 * The scroll position survives a repaint: the view is rebuilt whole on every
 * bar line while playing, and rebuilding the scroller used to put it back at
 * bar 1.
 */

import { PATTERN_COUNT } from "./constants.js";
import { setStatus } from "./dom.js";
import { arrangementBars, blockAt, blocksEnd, chainToBlocks, moveBlock, normalizeLoop, placeBlock, removeBlock, resizeBlock, setBlockSlot } from "./arrangement.js";
import { activeArrangeLoop, announceClips, arrangeLength, setArrangeLoop, setArrangeLoopOn, setArrangeRecord, setArrangeStart } from "./clips.js";
import { clipShadeColor, clipShades } from "./clipView.js";
import { showConfirmDialog } from "./dialogs.js";
import { patternMeter, stepsPerBarForMeter, transportMeter } from "./meter.js";
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
let follow = readFollow();
let autoScroll = -1;      // the scrollLeft this view last set itself, so a scroll event from it is not taken for a hand
let suppressClick = false; // a loop drawn on the ruler is not also a click on it
let headShown = false;
const FOLLOW_KEY = "seqbaby.arrFollow.v1";

function readFollow() {
  try { return localStorage.getItem("seqbaby.arrFollow.v1") !== "0"; } catch { return true; }
}
function setFollow(on) {
  follow = !!on;
  try { localStorage.setItem(FOLLOW_KEY, follow ? "1" : "0"); } catch {}
  root?.querySelector('[data-act="follow"]')?.setAttribute("aria-pressed", String(follow));
}

export function installArrangeView() {
  root = document.getElementById("arrange");
  if (!root) return;
  grid = document.createElement("div");
  grid.className = "sq-arr__view";
  root.appendChild(grid);
  detail = makeTrackDetail(root, scheduleArrangePaint);
  root.addEventListener("click", onClick);
  root.addEventListener("pointerdown", onPointerDown);
  root.addEventListener("scroll", onScroll, true);   // scroll does not bubble: caught on the way down
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
const rulerBars = () => Math.max(MIN_BARS, arrangementBars(state.tracks) + 4, (normalizeLoop(state.arrLoop)?.end ?? 0) + 4,
  ...state.tracks.map((t) => blocksEnd(t._take || []) + 4));
const scroller = () => root?.querySelector(".sq-arr__scroll");
function setScroll(el, x) { el.scrollLeft = x; autoScroll = el.scrollLeft; }

/**
 * One pass of a track's pattern as a picture: its notes, pitch against time
 * (the pattern's own pitch range, so a bassline and a hat both fill the
 * block), as an SVG the block wears as a mask repeated every `--rep` px,
 * which is how long a pass lasts on the ruler at this zoom (its steps over the
 * track's speed, in sixteenths, over the ruler's bar).
 * @param {Track} t @param {number} slot @param {number} barLen @param {number} w
 */
function patternPicture(t, slot, barLen, w) {
  const p = t.patterns?.[slot];
  const n = p?.steps?.length || 0;
  if (!n || !p.steps.some(Boolean)) return "";
  const fallback = t.isDrumKit ? 36 : 60;
  const hits = [];
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < n; i++) {
    if (!p.steps[i]) continue;
    const pitches = [p.notes?.[i] ?? fallback, ...(p.extraNotes?.[i] || [])].filter(Number.isFinite);
    for (const m of pitches) { lo = Math.min(lo, m); hi = Math.max(hi, m); }
    hits.push({ i, pitches, len: Math.max(1, p.lengths?.[i] || 1), off: p.offsets?.[i] || 0, vel: p.velocities?.[i] ?? 0.5 });
  }
  if (!hits.length || !Number.isFinite(lo)) return "";
  const range = hi - lo + 1;
  const H = Math.max(range, 6);
  const y0 = (H - range) / 2;
  let rects = "";
  for (const h of hits) {
    const x = Math.max(0, h.i + h.off);
    const width = Math.max(0.35, Math.min(h.len, n - x) - 0.2);
    for (const m of h.pitches) {
      rects += `<rect x="${x.toFixed(2)}" y="${(y0 + hi - m + 0.1).toFixed(2)}" width="${width.toFixed(2)}" height="0.8" fill-opacity="${(0.45 + 0.55 * Math.min(1, h.vel)).toFixed(2)}"/>`;
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${H}" preserveAspectRatio="none">${rects}</svg>`;
  const repPx = (n / Math.max(0.0001, t.speed ?? 1)) / barLen * w;
  return `<i class="sq-arr__notes" style="--rep:${repPx.toFixed(2)}px;--notes:url('data:image/svg+xml,${encodeURIComponent(svg)}')"></i>`;
}

function render({ scrollX } = {}) {
  if (!root || drag) return;                 // never under a drag: the preview is on the elements
  const keepX = scrollX ?? scroller()?.scrollLeft ?? 0;
  const w = barW();
  const barLen = stepsPerBarForMeter(transportMeter());
  const loopR = normalizeLoop(state.arrLoop);
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
    const shades = clipShades(t);
    const pictures = new Map();
    const picture = (slot) => {
      if (!pictures.has(slot)) pictures.set(slot, patternPicture(t, slot, barLen, w));
      return pictures.get(slot);
    };
    const ghosts = (t._take || []).map((b) =>
      `<div class="sq-arr__block is-take" style="left:${b.start * w}px;width:${b.bars * w}px" title="being recorded: pattern ${b.slot + 1}"><span class="sq-arr__slot">p${b.slot + 1}</span></div>`).join("");
    const blocks = (t.arrangement || []).map((b, i) => {
      const cls = ["sq-arr__block"];
      if (sel && sel.trackId === t.id && sel.i === i) cls.push("is-selected");
      if (now === b) cls.push("is-now");
      if (!t.patterns?.[b.slot]?.steps?.some(Boolean)) cls.push("is-empty");
      const shade = clipShadeColor(shades[b.slot]);
      return `<div class="${cls.join(" ")}" data-i="${i}" style="left:${b.start * w}px;width:${b.bars * w}px${shade ? `;--clip-c:${shade}` : ""}" title="${esc(t.name)}: pattern ${b.slot + 1}, bars ${b.start + 1}-${b.start + b.bars}. Drag to move, drag the right edge to resize, alt-drag to copy">
        ${picture(b.slot)}<button type="button" class="sq-arr__slot" data-act="slot" title="which pattern this block plays">p${b.slot + 1}</button>${patternLocked(t, b.slot) ? '<span class="sq-arr__lock" title="p-locked: this pattern has a sound of its own">●</span>' : ""}
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
      <div class="sq-arr__lane" style="width:${bars * w}px" title="drag across empty space to add a block of pattern ${trackSlot(t) + 1}">${blocks}${ghosts}</div>
    </div>`;
  }).join("");
  grid.innerHTML = `
    <div class="sq-arr__bar-row">
      <button type="button" class="sq-arr__play${state.playing ? " is-playing" : ""}" data-act="play" title="${state.playing ? "stop the transport" : "play the arrangement: each track follows its blocks"}">${state.playing ? "stop" : "play"}</button>
      <button type="button" class="sq-arr__rec" data-act="rec" aria-pressed="${!!state.arrRecord}" title="record: play plays the clips while this is armed, and each bar is written here as it plays; over an existing arrangement you are asked whether the recording replaces it or goes after it">● rec</button>
      <button type="button" class="sq-btn--ghost" data-act="fromchain" title="lay out the chain as blocks on every track: the non-empty patterns in order, each for its repeat count">from chain</button>
      <button type="button" class="sq-btn--ghost" data-act="clear" title="remove every block">clear</button>
      <button type="button" class="sq-arr__follow" data-act="follow" aria-pressed="${follow}" title="follow: keep the playhead in view while it plays (scrolling by hand switches it off)">follow</button>
      <button type="button" class="sq-arr__loopbtn" data-act="loop" aria-pressed="${!!(state.arrLoopOn && loopR)}" title="${loopR ? `loop bars ${loopR.start + 1}-${loopR.end}: arrange mode plays them round instead of the whole arrangement. Drag across the ruler to draw another section` : "loop a section: drag across the ruler to pick its bars (or select a block and press this to loop its bars)"}">loop</button>
      <span class="sq-arr__zoom"><button type="button" class="sq-btn--ghost" data-act="zoom-" title="zoom out">−</button><button type="button" class="sq-btn--ghost" data-act="zoom+" title="zoom in">+</button></span>
      <span class="sq-arr__len">${len} bar${len === 1 ? "" : "s"}${state.arrStartBar ? ` · starts at bar ${state.arrStartBar + 1}` : ""}${state.arrLoopOn && loopR ? ` · looping bars ${loopR.start + 1}-${loopR.end}` : ""}${state.playing && !arrange ? " · playing the clips: the arrangement takes over at the bar line" : ""}</span>
    </div>
    <div class="sq-arr__scroll">
      <div class="sq-arr__grid" style="--arr-bar-w:${w}px">
        <div class="sq-arr__ruler"><div class="sq-arr__strip"></div><div class="sq-arr__lane sq-arr__lane--ruler" style="width:${bars * w}px" title="click: play starts here. Drag across bars: loop them">${loopR ? `<div class="sq-arr__loop${state.arrLoopOn ? " is-on" : ""}" style="left:${loopR.start * w}px;width:${(loopR.end - loopR.start) * w}px"></div>` : ""}${ruler}</div></div>
        <div class="sq-arr__rows">${trackRows}</div>
        <div class="sq-arr__end" style="left:${STRIP_W + len * w}px" title="the arrangement loops here"></div>
        <div class="sq-arr__start" style="left:${STRIP_W + state.arrStartBar * w}px" title="play starts here (click the ruler to move it)"></div>
        ${state.arrLoopOn && loopR ? `<div class="sq-arr__loop-shade" style="left:${STRIP_W + loopR.start * w}px;width:${(loopR.end - loopR.start) * w}px"></div>` : ""}
        <div class="sq-arr__head" hidden></div>
      </div>
    </div>`;
  const sc = scroller();
  if (sc && keepX) setScroll(sc, keepX);
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
    // the origin the tick being heard belongs to: the transport moves it a
    // lookahead before the speakers reach a wrap or a jump
    const origin = state._nowTick >= state._arrOriginAt ? state._arrOrigin : state._arrPrevOrigin;
    const wrap = Math.max(arrangeLength(), activeArrangeLoop()?.end ?? 0);
    pos = Math.min(wrap, Math.max(0, (state._nowTick - origin) / barLen));
  } else if (state.playing && state.arrRecord) {
    pos = state._nowTick / barLen;
  }
  head.hidden = pos == null;
  headShown = pos != null;
  if (pos != null) {
    const x = pos * barW();
    head.style.left = `${STRIP_W + x}px`;
    // follow: turn the page when the head nears the right edge (or is off
    // to the left, after a wrap), leaving a little of what it came from
    const sc = follow && scroller();
    if (sc) {
      const view = sc.clientWidth - STRIP_W;
      if (view > 0 && (x < sc.scrollLeft || x > sc.scrollLeft + view - 24)) setScroll(sc, Math.max(0, x - 24));
    }
  }
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

/** A scroll this view did not make, while the head is moving, is a hand: follow lets go. */
function onScroll(e) {
  const sc = e.target;
  if (!sc?.classList?.contains("sq-arr__scroll")) return;
  if (Math.abs(sc.scrollLeft - autoScroll) <= 1) return;
  autoScroll = -1;
  if (follow && headShown) { setFollow(false); setStatus("follow off: scrolled by hand"); }
}

function onClick(e) {
  if (suppressClick) { suppressClick = false; return; }
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
  if (act === "play") { document.getElementById("play")?.click(); return; }
  if (act === "rec") { setArrangeRecord(!state.arrRecord); scheduleArrangePaint(); return; }
  if (act === "zoom+" || act === "zoom-") {
    // keep the bar at the left edge where it was
    const bar0 = (scroller()?.scrollLeft ?? 0) / barW();
    zoom = Math.max(0, Math.min(ZOOMS.length - 1, zoom + (act === "zoom+" ? 1 : -1)));
    render({ scrollX: bar0 * barW() });
    return;
  }
  if (act === "follow") {
    setFollow(!follow);
    setStatus(follow ? "follow on: the view keeps up with the playhead" : "follow off");
    if (follow) paintHead();
    return;
  }
  if (act === "loop") { toggleLoop(); return; }
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

function toggleLoop() {
  const loopR = normalizeLoop(state.arrLoop);
  if (state.arrLoopOn && loopR) {
    setArrangeLoopOn(false);
    setStatus("loop off: the whole arrangement plays");
  } else if (loopR) {
    setArrangeLoopOn(true);
    setStatus(`looping bars ${loopR.start + 1}-${loopR.end}`);
  } else {
    const t = sel && trackById(sel.trackId);
    const b = t?.arrangement?.[sel.i];
    if (!b) { setStatus("drag across the ruler to pick the bars to loop", true); return; }
    setArrangeLoop({ start: b.start, end: b.start + b.bars });
    setStatus(`looping bars ${b.start + 1}-${b.start + b.bars}`);
  }
  render();
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
  suppressClick = false;
  const ruler = e.target.closest(".sq-arr__lane--ruler");
  if (ruler) {
    // across the ruler: a loop section. A click (no travel) is left to
    // onClick, which puts the start marker there.
    const w = barW();
    const left = ruler.getBoundingClientRect().left;
    drag = { kind: "loop", lane: ruler, left, w, bar: Math.max(0, Math.floor((e.clientX - left) / w)), x0: e.clientX, moved: false, el: null };
    captureDrag(e);
    return;
  }
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
  captureDrag(e);
}

/** Follow the pointer that started a drag until it lets go. */
function captureDrag(e) {
  const target = e.target;
  try { target.setPointerCapture(e.pointerId); } catch {}
  const move = (ev) => onPointerMove(ev);
  const up = (ev) => { target.removeEventListener("pointermove", move); target.removeEventListener("pointerup", up); target.removeEventListener("pointercancel", up); onPointerUp(ev); };
  target.addEventListener("pointermove", move);
  target.addEventListener("pointerup", up);
  target.addEventListener("pointercancel", up);
}

/** The bars a loop drag covers, end exclusive. */
function loopDragRange(d, clientX) {
  const bar = Math.max(0, Math.floor((clientX - d.left) / d.w));
  return { start: Math.min(d.bar, bar), end: Math.max(d.bar, bar) + 1 };
}

function onPointerMove(e) {
  if (!drag) return;
  if (drag.kind === "loop") {
    if (Math.abs(e.clientX - drag.x0) > 4) drag.moved = true;
    if (!drag.moved) return;
    if (!drag.el) {
      drag.lane.querySelector(".sq-arr__loop")?.remove();
      drag.el = document.createElement("div");
      drag.el.className = "sq-arr__loop is-on is-drawing";
      drag.lane.prepend(drag.el);
    }
    const r = loopDragRange(drag, e.clientX);
    drag.el.style.left = `${r.start * drag.w}px`;
    drag.el.style.width = `${(r.end - r.start) * drag.w}px`;
    return;
  }
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
  if (d.kind === "loop") {
    if (!d.moved) return;                       // a click: the start marker (onClick)
    suppressClick = true;
    const r = loopDragRange(d, e.clientX);
    setArrangeLoop(r);
    render();
    setStatus(`looping bars ${r.start + 1}-${r.end}${state.playing && state.patternMode === "arrange" ? " from the next bar line" : ""}`);
    return;
  }
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

