// The arrangement view: the song as SECTIONS laid out across bars.
//
// The pattern bank is 32 slots, and chain mode plays the non-empty ones in
// slot order for `patternRepeats` bars each — which is a song only when the
// song happens to be its patterns in the order they were written, once each.
// A verse that comes back after the chorus is not that, so `state.arrangement`
// is an ordered list of `{p, bars}`: pattern p for that many bars, the same
// pattern as often as the song wants it, an empty pattern as a break. Chain
// mode follows it whenever it is non-empty (transport.js) and falls back to
// slot order when it is not, so a song written before this plays exactly as
// it did.
//
// This module is the picture of that list and the hands on it: a strip of
// blocks under the pattern bar, each as wide as the bars it plays, drawn
// with the pattern's own steps. Drag a slot from the pattern grid onto it to
// add a section, drag a block to move it, drag its right edge to set the bars,
// click it to go there, × to take it out. Nothing here is told about undo,
// jam or the live merge: the list is in `serializeSet`, which is what all
// three watch, and the events a hand leaves on this panel (pointerup, keyup,
// drop) are the ones history.js listens for.
//
// `state.arrangePos` — which section is playing, or would on the next play —
// is view state like `activePattern`, and not in the format.

import { ARRANGE_MAX_BARS, arrangementBars } from "./sessionFormat.js";
import { setStatus } from "./dom.js";
import { patternMeter, stepsPerBarForMeter } from "./meter.js";
import { isPatternNonEmpty, requestPatternSwitch, state } from "./state.js";

const SHOW_KEY = "seqbaby.arrange.v1";
const PIC_ROWS = 8;                 // tracks drawn in a block's picture, at most
const MIME_SECTION = "text/arrange-idx";
const MIME_PATTERN = "text/pattern-idx";   // what the pattern grid's cells put on a drag (patternBar.js)

let root = null, lane = null, head = null;
let resizing = null;                // the grip drag in progress
let resizedAt = 0;                  // when the last one ended, so the click it leaves behind is not a "go to"

const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const bpm = () => Number(document.getElementById("bpm")?.value) || 120;
const hueOf = (p) => Math.round((p * 137.508) % 360);

/** Beats the arrangement plays through once, meter by meter. 0 for none. */
export function arrangementBeats(arr = state.arrangement) {
  let beats = 0;
  for (const e of arr) beats += Math.max(1, e.bars) * stepsPerBarForMeter(patternMeter(e.p)) / 4;
  return beats;
}

function fmtTime(sec) {
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// ---- show / hide -----------------------------------------------------------

export function isArrangementShown() { return !!root && !root.hidden; }

/**
 * Show or hide the panel. The button remembers its setting per browser; a
 * song arriving with sections (applySet) shows the panel without writing
 * that memory, since it was the song asking and not the person.
 */
export function showArrangement(on, { remember = false } = {}) {
  if (!root) return;
  root.hidden = !on;
  document.getElementById("arrange-btn")?.setAttribute("aria-pressed", String(!!on));
  if (remember) { try { localStorage.setItem(SHOW_KEY, on ? "1" : "0"); } catch {} }
  if (on) render();
}

/** Repaint if shown. Called from renderPatternGrid, so every pattern switch,
 *  copy and session load reaches it without knowing it exists. */
export function refreshArrangement() {
  if (isArrangementShown()) render();
}

/** Repaint the pictures of every block playing pattern `p` — its steps moved. */
export function refreshArrangementPattern(p) {
  if (!isArrangementShown() || !lane) return;
  for (const b of lane.querySelectorAll(".sq-arrange__block")) {
    const e = state.arrangement[Number(b.dataset.i)];
    if (e && e.p === p) { paintPic(b.querySelector("canvas"), e); b.classList.toggle("is-empty", !isPatternNonEmpty(p)); }
  }
}

// ---- edits -----------------------------------------------------------------

function edit(fn, status) {
  fn(state.arrangement);
  if (state.arrangePos >= state.arrangement.length) state.arrangePos = Math.max(0, state.arrangement.length - 1);
  render();
  if (status) setStatus(status);
}

/** Append a section: the active pattern, for as many bars as its repeat count says. */
export function addSection(p = state.activePattern, at = state.arrangement.length) {
  const bars = Math.max(1, Math.min(ARRANGE_MAX_BARS, Number(state.patternRepeats[p]) || 1));
  edit(arr => arr.splice(Math.max(0, Math.min(arr.length, at)), 0, { p, bars }), `pattern ${p + 1} added to the arrangement`);
  focusBlock(Math.min(at, state.arrangement.length - 1));
}

function removeSection(i) {
  edit(arr => arr.splice(i, 1), `section ${i + 1} removed`);
  focusBlock(Math.min(i, state.arrangement.length - 1));
}

function moveSection(from, to) {
  if (from === to || from < 0 || from >= state.arrangement.length) return;
  edit(arr => { const [e] = arr.splice(from, 1); arr.splice(Math.max(0, Math.min(arr.length, to)), 0, e); });
  focusBlock(Math.max(0, Math.min(to, state.arrangement.length - 1)));
}

function setBars(i, bars, { paint = true } = {}) {
  const e = state.arrangement[i];
  if (!e) return;
  e.bars = Math.max(1, Math.min(ARRANGE_MAX_BARS, Math.round(bars)));
  if (paint) render();
}

/** What chain mode would play with no arrangement: the non-empty slots in order, each its repeats. */
function fillFromPatterns() {
  const list = [];
  for (let i = 0; i < state.patternRepeats.length; i++) {
    if (isPatternNonEmpty(i)) list.push({ p: i, bars: Math.max(1, Number(state.patternRepeats[i]) || 1) });
  }
  if (!list.length) { setStatus("no patterns with notes to arrange", true); return; }
  edit(arr => arr.splice(0, arr.length, ...list), `arranged ${list.length} pattern${list.length === 1 ? "" : "s"} in order`);
}

function goTo(i) {
  const e = state.arrangement[i];
  if (!e) return;
  // Position first, then the switch: syncArrangePos keeps a position that
  // already plays the pattern, so the second of two verses stays the second.
  state.arrangePos = i;
  requestPatternSwitch(e.p);
  render();
}

function focusBlock(i) {
  lane?.querySelector(`.sq-arrange__block[data-i="${i}"]`)?.focus({ preventScroll: false });
}

// ---- the picture -----------------------------------------------------------

let stepColor = null;
function paintPic(canvas, e) {
  if (!canvas) return;
  const tracks = state.tracks.filter(t => t.engineKey !== "bus").slice(0, PIC_ROWS);
  const perBar = stepsPerBarForMeter(patternMeter(e.p));
  const w = Math.max(1, e.bars * perBar), h = Math.max(1, tracks.length);
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const g = canvas.getContext("2d");
  g.clearRect(0, 0, w, h);
  if (!stepColor) stepColor = getComputedStyle(document.documentElement).getPropertyValue("--step-on").trim() || "#c2f04a";
  g.fillStyle = stepColor;
  tracks.forEach((t, row) => {
    const pat = t.patterns?.[e.p];
    if (!pat || !pat.steps?.length) return;
    const len = pat.steps.length;
    // One pixel per sixteenth, the pattern tiled across the bars as it plays.
    for (let x = 0; x < w; x++) {
      const i = x % len;
      if (!pat.steps[i]) continue;
      const v = pat.velocities?.[i];
      g.globalAlpha = typeof v === "number" ? 0.35 + 0.65 * Math.max(0, Math.min(1, v)) : 1;
      g.fillRect(x, row, 1, 1);
    }
  });
  g.globalAlpha = 1;
}

// ---- rendering -------------------------------------------------------------

function render() {
  if (!root || root.hidden || !lane) return;
  const arr = state.arrangement;
  stepColor = null;
  // header
  const bars = arrangementBars(arr);
  const secs = arrangementBeats(arr) * 60 / bpm();
  head.querySelector(".sq-arrange__sum").textContent = arr.length
    ? `${arr.length} section${arr.length === 1 ? "" : "s"} · ${bars} bar${bars === 1 ? "" : "s"} · ${fmtTime(secs)}`
    : "no sections yet";
  head.querySelector("[data-act=add]").textContent = `+ pattern ${state.activePattern + 1}`;
  const hint = head.querySelector(".sq-arrange__hint");
  hint.hidden = !(arr.length && state.patternMode !== "chain");
  head.querySelector("[data-act=clear]").disabled = !arr.length;

  // blocks
  const focused = document.activeElement?.closest?.(".sq-arrange__block")?.dataset.i;
  lane.replaceChildren();
  let at = 1;
  arr.forEach((e, i) => {
    const b = el("div", "sq-arrange__block");
    b.draggable = true;
    b.tabIndex = 0;
    b.dataset.i = String(i);
    b.style.setProperty("--arr-bars", String(e.bars));
    b.style.setProperty("--arr-hue", String(hueOf(e.p)));
    b.classList.toggle("is-empty", !isPatternNonEmpty(e.p));
    b.classList.toggle("is-now", i === state.arrangePos);
    b.classList.toggle("is-active", e.p === state.activePattern);
    b.setAttribute("role", "button");
    b.setAttribute("aria-label", `section ${i + 1}: pattern ${e.p + 1}, ${e.bars} bar${e.bars === 1 ? "" : "s"}, from bar ${at}`);
    b.title = `pattern ${e.p + 1} for ${e.bars} bar${e.bars === 1 ? "" : "s"}, from bar ${at}. Click to go there, drag to move, drag the right edge for bars. Keys: + − bars, shift+arrows move, delete removes`;
    const pic = el("canvas", "sq-arrange__pic");
    b.appendChild(pic);
    const meta = el("div", "sq-arrange__meta");
    meta.appendChild(el("span", "sq-arrange__at", String(at)));
    meta.appendChild(el("span", "sq-arrange__num", String(e.p + 1)));
    meta.appendChild(el("span", "sq-arrange__bars", `${e.bars} bar${e.bars === 1 ? "" : "s"}`));
    b.appendChild(meta);
    const x = el("button", "sq-arrange__x", "×");
    x.type = "button";
    x.title = "remove this section";
    x.setAttribute("aria-label", `remove section ${i + 1}`);
    b.appendChild(x);
    const grip = el("div", "sq-arrange__grip");
    grip.title = "drag to set how many bars it plays";
    b.appendChild(grip);
    lane.appendChild(b);
    paintPic(pic, e);
    at += e.bars;
  });
  const tail = el("div", "sq-arrange__tail", arr.length
    ? "drop a pattern here"
    : "drag a pattern from the bar above, or press + to add the one you are on");
  lane.appendChild(tail);
  if (focused != null) focusBlock(Number(focused));
}

/**
 * The playhead, from the transport at the moment a step is heard: the block
 * playing, and how far through its bars it is (a line drawn by style.css
 * from --arr-head, only while body.sq-playing).
 */
export function paintArrangementNow({ pos, bar, barTick, barLen }) {
  if (!isArrangementShown() || !lane || state.patternMode !== "chain") return;
  const e = state.arrangement[pos];
  if (!e) return;
  for (const b of lane.children) {
    if (!b.classList.contains("sq-arrange__block")) continue;
    const now = Number(b.dataset.i) === pos;
    b.classList.toggle("is-now", now);
    if (now) b.style.setProperty("--arr-head", String(Math.max(0, Math.min(1, (bar + barTick / Math.max(1, barLen)) / Math.max(1, e.bars)))));
  }
}

// ---- hands -----------------------------------------------------------------

/** Where in the list a drop at clientX lands: before the first block whose middle is past it. */
function dropIndexAt(clientX) {
  const blocks = [...lane.querySelectorAll(".sq-arrange__block")];
  for (const b of blocks) {
    const r = b.getBoundingClientRect();
    if (clientX < r.left + r.width / 2) return Number(b.dataset.i);
  }
  return blocks.length;
}

function clearDropMarks() {
  for (const n of lane.querySelectorAll(".is-drop-before, .is-drop-end")) n.classList.remove("is-drop-before", "is-drop-end");
}

function markDrop(i) {
  clearDropMarks();
  const b = lane.querySelector(`.sq-arrange__block[data-i="${i}"]`);
  if (b) b.classList.add("is-drop-before"); else lane.querySelector(".sq-arrange__tail")?.classList.add("is-drop-end");
}

function wireLane() {
  lane.addEventListener("dragover", e => {
    const types = e.dataTransfer?.types || [];
    const section = types.includes(MIME_SECTION), pattern = types.includes(MIME_PATTERN);
    if (!section && !pattern) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = section ? "move" : "copy";
    markDrop(dropIndexAt(e.clientX));
  });
  lane.addEventListener("dragleave", e => { if (!lane.contains(e.relatedTarget)) clearDropMarks(); });
  lane.addEventListener("drop", e => {
    clearDropMarks();
    const sec = e.dataTransfer.getData(MIME_SECTION);
    const pat = e.dataTransfer.getData(MIME_PATTERN);
    if (sec === "" && pat === "") return;
    e.preventDefault();
    let to = dropIndexAt(e.clientX);
    if (sec !== "") {
      const from = Number(sec);
      if (!Number.isFinite(from)) return;
      if (to > from) to--;            // the gap closes behind the block being moved
      moveSection(from, to);
    } else {
      const p = Number(pat);
      if (!Number.isFinite(p)) return;
      addSection(p, to);
    }
  });

  lane.addEventListener("dragstart", e => {
    const b = e.target.closest?.(".sq-arrange__block");
    if (!b || resizing) { e.preventDefault(); return; }
    e.dataTransfer.setData(MIME_SECTION, b.dataset.i);
    e.dataTransfer.effectAllowed = "move";
    b.classList.add("is-dragging");
  });
  lane.addEventListener("dragend", e => { e.target.closest?.(".sq-arrange__block")?.classList.remove("is-dragging"); clearDropMarks(); });

  lane.addEventListener("click", e => {
    const b = e.target.closest?.(".sq-arrange__block");
    if (!b) return;
    const i = Number(b.dataset.i);
    if (e.target.closest(".sq-arrange__x")) { removeSection(i); return; }
    if (e.target.closest(".sq-arrange__grip") || resizing || performance.now() - resizedAt < 250) return;
    goTo(i);
  });

  // The grip: bars from how far the pointer has travelled, in units of one
  // bar's drawn width. Live while dragging; the pointerup is what history.js
  // hears, so the whole drag is one undo step.
  lane.addEventListener("pointerdown", e => {
    const grip = e.target.closest?.(".sq-arrange__grip");
    if (!grip || e.button !== 0) return;
    const b = grip.closest(".sq-arrange__block");
    const i = Number(b.dataset.i);
    const start = state.arrangement[i]?.bars ?? 1;
    // A bar's drawn width is the stylesheet's, not the block's width over its
    // bars: a one-bar block is held at a minimum width, and dividing that
    // would make the first bars of a drag cost more travel than the rest.
    const barPx = parseFloat(getComputedStyle(root).getPropertyValue("--arr-bar-w")) || 28;
    resizing = { i, x0: e.clientX, start, barPx: Math.max(4, barPx), pointerId: e.pointerId, b };
    b.classList.add("is-resizing");
    try { grip.setPointerCapture(e.pointerId); } catch {}
    e.preventDefault();
    e.stopPropagation();
  }, true);
  const onMove = e => {
    if (!resizing || e.pointerId !== resizing.pointerId) return;
    const bars = Math.max(1, Math.min(ARRANGE_MAX_BARS, Math.round(resizing.start + (e.clientX - resizing.x0) / resizing.barPx)));
    const cur = state.arrangement[resizing.i];
    if (!cur || cur.bars === bars) return;
    setBars(resizing.i, bars, { paint: false });
    resizing.b.style.setProperty("--arr-bars", String(bars));
    resizing.b.querySelector(".sq-arrange__bars").textContent = `${bars} bar${bars === 1 ? "" : "s"}`;
    paintPic(resizing.b.querySelector("canvas"), cur);
  };
  const onUp = e => {
    if (!resizing || e.pointerId !== resizing.pointerId) return;
    const { i } = resizing;
    resizing.b.classList.remove("is-resizing");
    resizing = null;
    resizedAt = performance.now();
    render();
    setStatus(`section ${i + 1}: ${state.arrangement[i]?.bars ?? 1} bars`);
  };
  lane.addEventListener("pointermove", onMove);
  lane.addEventListener("pointerup", onUp);
  lane.addEventListener("pointercancel", onUp);

  lane.addEventListener("keydown", e => {
    const b = e.target.closest?.(".sq-arrange__block");
    if (!b) return;
    const i = Number(b.dataset.i);
    const cur = state.arrangement[i];
    if (!cur) return;
    let handled = true;
    switch (e.key) {
      case "Delete": case "Backspace": removeSection(i); break;
      case "+": case "=": case "ArrowUp": setBars(i, cur.bars + 1); focusBlock(i); break;
      case "-": case "_": case "ArrowDown": setBars(i, cur.bars - 1); focusBlock(i); break;
      case "ArrowLeft": if (e.shiftKey) moveSection(i, i - 1); else focusBlock(Math.max(0, i - 1)); break;
      case "ArrowRight": if (e.shiftKey) moveSection(i, i + 1); else focusBlock(Math.min(state.arrangement.length - 1, i + 1)); break;
      case "Enter": case " ": goTo(i); break;
      case "d": addSection(cur.p, i + 1); setBars(i + 1, cur.bars); break;
      default: handled = false;
    }
    if (handled) { e.preventDefault(); e.stopPropagation(); }
  });
}

// ---- init ------------------------------------------------------------------

/** Build the panel into #arrangement and wire the pattern bar's button. Once, from init(). */
export function initArrangement() {
  root = document.getElementById("arrangement");
  if (!root) return;
  root.replaceChildren();
  head = el("div", "sq-arrange__head");
  head.appendChild(el("span", "sq-arrange__title", "arrangement"));
  head.appendChild(el("span", "sq-arrange__sum", ""));
  const hint = el("button", "sq-arrange__hint sq-btn--ghost", "plays in chain mode: switch");
  hint.type = "button";
  hint.title = "the arrangement plays in chain mode; repeat mode loops the pattern you are on";
  hint.addEventListener("click", () => { if (state.patternMode !== "chain") document.getElementById("pattern-mode")?.click(); render(); });
  head.appendChild(hint);
  const tools = el("span", "sq-arrange__tools");
  const mk = (act, text, title) => { const b = el("button", "sq-btn--ghost", text); b.type = "button"; b.dataset.act = act; b.title = title; tools.appendChild(b); return b; };
  mk("add", "+ pattern", "add the pattern you are on to the end of the arrangement");
  mk("fill", "from patterns", "arrange every pattern with notes in slot order, each for its rep count — what chain mode plays without an arrangement");
  mk("clear", "clear", "remove every section; chain mode goes back to playing the patterns in order");
  mk("close", "×", "hide the arrangement view");
  tools.addEventListener("click", e => {
    const act = e.target.closest("button")?.dataset.act;
    if (act === "add") addSection();
    else if (act === "fill") fillFromPatterns();
    else if (act === "clear") edit(arr => arr.splice(0, arr.length), "arrangement cleared");
    else if (act === "close") showArrangement(false, { remember: true });
  });
  head.appendChild(tools);
  lane = el("div", "sq-arrange__lane");
  root.appendChild(head);
  root.appendChild(lane);
  wireLane();

  const btn = document.getElementById("arrange-btn");
  btn?.addEventListener("click", () => showArrangement(root.hidden, { remember: true }));
  // The mode button repaints the hint: an arrangement in repeat mode is not playing.
  document.getElementById("pattern-mode")?.addEventListener("click", () => refreshArrangement());
  let shown = false;
  try { shown = localStorage.getItem(SHOW_KEY) === "1"; } catch {}
  showArrangement(shown);
}
