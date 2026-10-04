// The arrangement view: the song as SECTIONS laid out across bars, with a row
// per track saying which of them play in each.
//
// The pattern bank is 32 slots, and chain mode plays the non-empty ones in
// slot order for `patternRepeats` bars each — which is a song only when the
// song happens to be its patterns in the order they were written, once each.
// A verse that comes back after the chorus is not that, so `state.arrangement`
// is an ordered list of `{p, bars, off}`: pattern p for that many bars, the
// same pattern as often as the song wants it; a REST (`p: null`) for bars of
// silence without a slot spent on them; `off`, the tracks held back for that
// section; and `pat`, a track's OWN pattern for the section where the rest
// play `p` (both live ids here, indices in the format). The last two are the
// LANES: every instrument track has a row where each section is
// the default pattern, a pattern of its own, or nothing — so the drums can
// play pattern 1 under a bass on pattern 3, and a song brings instruments in
// and out without copying patterns. Chain mode follows
// it whenever it is non-empty (transport.js) and falls back to slot order when
// it is not, so a song written before this plays exactly as it did.
//
// This module is the picture of that list and the hands on it, in a TAB of its
// own beside the track list (the strip under the pattern bar, `body[data-view]`):
// a strip of blocks, each as wide as the bars it plays, drawn with the
// pattern's own steps; under it one row per track, a cell per section, lit
// when the track plays there. Drag a slot from the pattern grid onto the strip
// to add a section, drag a block to move it, drag its right edge to set the
// bars, click it to go there, × to take it out, click a cell to hold a track
// back or let it in. Nothing here is told about undo, jam or the live merge:
// the list is in `serializeSet`, which is what all three watch, and the events
// a hand leaves on this panel (pointerup, keyup, drop) are the ones history.js
// listens for.
//
// `state.arrangePos` — which section is playing, or would on the next play —
// is view state like `activePattern`, and not in the format.

import { ARRANGE_MAX_BARS, arrangementBars, normalizeArrangement } from "./sessionFormat.js";
import { PATTERN_COUNT } from "./constants.js";
import { setStatus } from "./dom.js";
import { patternMeter, stepsPerBarForMeter } from "./meter.js";
import { applySectionTracks, isPatternNonEmpty, requestPatternSwitch, state } from "./state.js";

const VIEW_KEY = "seqbaby.view.v1";
const PIC_ROWS = 8;                 // tracks drawn in a block's picture, at most
const MIME_SECTION = "text/arrange-idx";
const MIME_PATTERN = "text/pattern-idx";   // what the pattern grid's cells put on a drag (patternBar.js)

let root = null, lane = null, rows = null, head = null;
let resizing = null;                // the grip drag in progress
let resizedAt = 0;                  // when the last one ended, so the click it leaves behind is not a "go to"

const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const bpm = () => Number(document.getElementById("bpm")?.value) || 120;
const hueOf = (p) => Math.round((p * 137.508) % 360);
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
/** The tracks a section can hold back: every instrument, buses left out (they play no notes). */
const arrangeable = () => state.tracks.filter(t => t.engineKey !== "bus");

/** Beats the arrangement plays through once, meter by meter. 0 for none. A
 *  rest keeps the bar of the section before it (the transport leaves the
 *  active pattern, and so its meter, where it was), or pattern 1's at the top. */
export function arrangementBeats(arr = state.arrangement) {
  let beats = 0, meterOf = 0;
  for (const e of arr) {
    if (e.p != null) meterOf = e.p;
    beats += Math.max(1, e.bars) * stepsPerBarForMeter(patternMeter(meterOf)) / 4;
  }
  return beats;
}

/** Whether section `e` holds track `t` back. */
export function sectionHolds(e, t) { return !!e?.off?.includes(t.id); }
/** The pattern track `t` plays in section `e`: its own lane's, else the
 *  section's, else null — held back (by `off`, or a rest with nothing of its own). */
export function trackTargetPattern(e, t) {
  if (!e || !t || sectionHolds(e, t)) return null;
  const own = e.pat?.[t.id];
  return own != null ? own : e.p;
}

// The lanes: every instrument track, in the track list's order, from the
// first and as they are added (createTrack repaints). A lane with nothing in
// it follows the sections, which is what a save carries: nothing.
function lanes() { return arrangeable(); }

/**
 * Write a serialized arrangement onto the live state. `order` is the track
 * list the blob's `off` INDICES count along — applySet's `made`, the merge's
 * too — since ids are handed out fresh on every load. The one door for
 * applySet and the live merge, so both resolve the same way.
 */
export function applyArrangementBlob(raw, order = state.tracks) {
  state.arrangement = normalizeArrangement(raw, PATTERN_COUNT).map(e => {
    const pat = {};
    for (const [i, q] of Object.entries(e.pat || {})) { const id = order[Number(i)]?.id; if (id != null) pat[id] = q; }
    return { p: e.p, bars: e.bars, off: (e.off || []).map(i => order[i]?.id).filter(id => id != null), pat };
  });
  if (state.arrangePos >= state.arrangement.length) state.arrangePos = Math.max(0, state.arrangement.length - 1);
  refreshArrangement();
}

/** The arrangement as the format writes it: `off` as indices into `tracks`. */
export function serializeArrangement(tracks = state.tracks) {
  return state.arrangement.map(e => {
    const off = (e.off || []).map(id => tracks.findIndex(t => t.id === id)).filter(i => i >= 0).sort((a, b) => a - b);
    const pat = {};
    for (const [id, q] of Object.entries(e.pat || {})) { const i = tracks.findIndex(t => t.id === Number(id)); if (i >= 0) pat[i] = q; }
    return { p: e.p, bars: e.bars, ...(off.length ? { off } : {}), ...(Object.keys(pat).length ? { pat } : {}) };
  });
}

// ---- the tabs --------------------------------------------------------------

export function isArrangementShown() { return document.body.dataset.view === "arrangement"; }

/**
 * Show the arrangement tab or the tracks tab. Remembered per browser; a
 * song arriving never switches tabs, it only changes the count on the label.
 */
export function showArrangement(on, { remember = false } = {}) {
  document.body.dataset.view = on ? "arrangement" : "tracks";
  for (const tab of document.querySelectorAll(".sq-tabs__tab")) {
    const sel = (tab.dataset.view === "arrangement") === !!on;
    tab.setAttribute("aria-selected", String(sel));
    tab.tabIndex = sel ? 0 : -1;
  }
  if (remember) { try { localStorage.setItem(VIEW_KEY, on ? "arrangement" : "tracks"); } catch {} }
  if (on) render();
}

/** Repaint if shown, and the tab's count either way. Called from
 *  renderPatternGrid, so every pattern switch, copy and session load reaches
 *  it without knowing it exists. */
export function refreshArrangement() {
  const n = document.querySelector(".sq-tabs__n");
  if (n) n.textContent = state.arrangement.length ? String(state.arrangement.length) : "";
  if (isArrangementShown()) render();
}

/** Repaint the pictures of every block and cell playing pattern `p` — its steps moved. */
export function refreshArrangementPattern(p) {
  if (!isArrangementShown() || !lane) return;
  state.arrangement.forEach((e, i) => {
    if (e.p !== p) return;
    const b = lane.querySelector(`.sq-arrange__block[data-i="${i}"]`);
    if (b) { paintPic(b.querySelector("canvas"), e); b.classList.toggle("is-empty", !isPatternNonEmpty(p)); }
    for (const c of rows.querySelectorAll(`.sq-arrange__cell[data-i="${i}"]`)) {
      const t = state.tracks.find(x => x.id === Number(c.dataset.t));
      if (t) paintPic(c.querySelector("canvas"), e, [t]);
    }
  });
}

// ---- edits -----------------------------------------------------------------

function edit(fn, status) {
  fn(state.arrangement);
  if (state.arrangePos >= state.arrangement.length) state.arrangePos = Math.max(0, state.arrangement.length - 1);
  render();
  if (status) setStatus(status);
}

/** Append a section: the active pattern, for as many bars as its repeat count
 *  says; or a rest (`p` null) of one bar. */
export function addSection(p = state.activePattern, at = state.arrangement.length, bars = null, off = [], pat = {}) {
  const n = bars ?? (p == null ? 1 : Math.max(1, Math.min(ARRANGE_MAX_BARS, Number(state.patternRepeats[p]) || 1)));
  edit(arr => arr.splice(Math.max(0, Math.min(arr.length, at)), 0, { p, bars: n, off: [...off], pat: { ...pat } }), p == null ? "a rest added to the arrangement" : `pattern ${p + 1} added to the arrangement`);
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

/** Hold track `t` back in section `i`, or let it in. */
function setHeld(i, t, held) {
  const e = state.arrangement[i];
  if (!e) return;
  e.off = e.off || [];
  const at = e.off.indexOf(t.id);
  if (held && at < 0) e.off.push(t.id);
  if (!held && at >= 0) e.off.splice(at, 1);
}

/** Give track `t` a pattern of its own in section `i` (`null` takes it away: back to the section's). */
function setOwn(i, t, p) {
  const e = state.arrangement[i];
  if (!e) return;
  e.pat = e.pat || {};
  if (p == null) delete e.pat[t.id]; else e.pat[t.id] = p;
}

/** Clear a track's lane: nothing of its own anywhere, nowhere held back — it follows the sections. */
function clearLane(t) {
  for (const e of state.arrangement) { setHeld(state.arrangement.indexOf(e), t, false); if (e.pat) delete e.pat[t.id]; }
}

/** What chain mode would play with no arrangement: the non-empty slots in order, each its repeats. */
function fillFromPatterns() {
  const list = [];
  for (let i = 0; i < state.patternRepeats.length; i++) {
    if (isPatternNonEmpty(i)) list.push({ p: i, bars: Math.max(1, Number(state.patternRepeats[i]) || 1), off: [] });
  }
  if (!list.length) { setStatus("no patterns with notes to arrange", true); return; }
  edit(arr => arr.splice(0, arr.length, ...list), `arranged ${plural(list.length, "pattern")} in order`);
}

function goTo(i) {
  const e = state.arrangement[i];
  if (!e) return;
  // Position first, then the switch: syncArrangePos keeps a position that
  // already plays the pattern, so the second of two verses stays the second.
  // A rest has no pattern to switch to: the position is the whole move.
  state.arrangePos = i;
  if (e.p != null) requestPatternSwitch(e.p);
  if (state.queuedPattern == null) applySectionTracks(e);     // the lanes too, unless the switch itself is waiting for the bar
  render();
}

function focusBlock(i) {
  lane?.querySelector(`.sq-arrange__block[data-i="${i}"]`)?.focus({ preventScroll: false });
}

// ---- the picture -----------------------------------------------------------

let stepColor = null;
/** Draw section `e`'s steps: one pixel a sixteenth, one row a track, tiled
 *  across the bars as it plays, each track from the pattern IT plays there.
 *  `tracks` defaults to the first few instruments. */
function paintPic(canvas, e, tracks = null) {
  if (!canvas) return;
  const list = (tracks || arrangeable().slice(0, PIC_ROWS)).filter(t => trackTargetPattern(e, t) != null);
  const meterOf = e.p ?? (list.length ? trackTargetPattern(e, list[0]) : 0) ?? 0;
  const perBar = stepsPerBarForMeter(patternMeter(meterOf));
  const w = Math.max(1, e.bars * perBar), h = Math.max(1, (tracks || list).length);
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const g = canvas.getContext("2d");
  g.clearRect(0, 0, w, h);
  if (!stepColor) stepColor = getComputedStyle(document.documentElement).getPropertyValue("--step-on").trim() || "#c2f04a";
  g.fillStyle = stepColor;
  if (!list.length) return;
  list.forEach((t, row) => {
    const pat = t.patterns?.[trackTargetPattern(e, t)];
    if (!pat || !pat.steps?.length) return;
    const len = pat.steps.length;
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

function fmtTime(sec) {
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function render() {
  if (!root || !lane || !isArrangementShown()) return;
  const arr = state.arrangement;
  stepColor = null;
  // header
  const bars = arrangementBars(arr);
  const secs = arrangementBeats(arr) * 60 / bpm();
  head.querySelector(".sq-arrange__sum").textContent = arr.length
    ? `${plural(arr.length, "section")} · ${plural(bars, "bar")} · ${fmtTime(secs)}`
    : "no sections yet";
  head.querySelector("[data-act=add]").textContent = `+ pattern ${state.activePattern + 1}`;
  const hint = head.querySelector(".sq-arrange__hint");
  hint.hidden = !(arr.length && state.patternMode !== "chain");
  head.querySelector("[data-act=clear]").disabled = !arr.length;

  // blocks
  const focused = document.activeElement?.closest?.(".sq-arrange__block")?.dataset.i;
  lane.replaceChildren();
  lane.appendChild(el("div", "sq-arrange__label sq-arrange__label--lane", arr.length ? "sections" : ""));
  let at = 1;
  arr.forEach((e, i) => {
    const rest = e.p == null;
    const what = rest ? "a rest" : `pattern ${e.p + 1}`;
    const b = el("div", "sq-arrange__block");
    b.draggable = true;
    b.tabIndex = 0;
    b.dataset.i = String(i);
    b.style.setProperty("--arr-bars", String(e.bars));
    if (!rest) b.style.setProperty("--arr-hue", String(hueOf(e.p)));
    b.classList.toggle("is-rest", rest);
    b.classList.toggle("is-empty", !rest && !isPatternNonEmpty(e.p));
    b.classList.toggle("is-now", i === state.arrangePos);
    b.classList.toggle("is-active", !rest && e.p === state.activePattern);
    b.setAttribute("role", "button");
    b.setAttribute("aria-label", `section ${i + 1}: ${what}, ${plural(e.bars, "bar")}, from bar ${at}`);
    b.title = `${what} for ${plural(e.bars, "bar")}, from bar ${at}. ${rest ? "Silence: every track is held back. " : "Click to go there, "}drag to move, drag the right edge for bars. Keys: + − bars, shift+arrows move, delete removes, r adds a rest after`;
    const pic = el("canvas", "sq-arrange__pic");
    b.appendChild(pic);
    const meta = el("div", "sq-arrange__meta");
    meta.appendChild(el("span", "sq-arrange__at", String(at)));
    meta.appendChild(el("span", "sq-arrange__num", rest ? "rest" : String(e.p + 1)));
    meta.appendChild(el("span", "sq-arrange__bars", plural(e.bars, "bar")));
    b.appendChild(meta);
    // The small buttons: move left / right and remove. Hover-only on a mouse,
    // where a block can be dragged instead; always on a touch screen, where
    // it cannot (style.css).
    const btns = el("span", "sq-arrange__btns");
    const mk = (cls, text, title, label, dir) => {
      const n = el("button", cls, text);
      n.type = "button"; n.title = title; n.setAttribute("aria-label", label);
      if (dir) n.dataset.dir = String(dir);
      btns.appendChild(n);
      return n;
    };
    mk("sq-arrange__mv", "‹", "move this section earlier", `move section ${i + 1} earlier`, -1).disabled = i === 0;
    mk("sq-arrange__mv", "›", "move this section later", `move section ${i + 1} later`, 1).disabled = i === arr.length - 1;
    mk("sq-arrange__x", "×", "remove this section", `remove section ${i + 1}`);
    b.appendChild(btns);
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

  // the lanes: a row per instrument track, a cell per section: the section's
  // pattern, one of the track's own, or nothing
  rows.replaceChildren();
  rows.hidden = !arr.length;
  for (const t of (arr.length ? lanes() : [])) {
    const row = el("div", "sq-arrange__row");
    row.dataset.t = String(t.id);
    const hue = t.el ? getComputedStyle(t.el).getPropertyValue("--track-hue").trim() : "";
    if (hue) row.style.setProperty("--track-hue", hue);
    const label = el("div", "sq-arrange__label sq-arrange__label--track");
    const name = el("button", "sq-arrange__lanename", t.name || "track");
    name.type = "button";
    const heldEverywhere = arr.every(e => trackTargetPattern(e, t) == null);
    name.title = `${t.name}: ${heldEverywhere ? "let it play in every section" : "hold it back in every section"}`;
    name.dataset.all = heldEverywhere ? "on" : "off";
    label.appendChild(name);
    const says = arr.some(e => sectionHolds(e, t) || e.pat?.[t.id] != null);
    const rm = el("button", "sq-arrange__lanex", "×");
    rm.type = "button";
    rm.title = `clear ${t.name}'s lane: it follows the sections again, everywhere`;
    rm.setAttribute("aria-label", `clear ${t.name}'s lane`);
    rm.hidden = !says;
    label.appendChild(rm);
    row.appendChild(label);
    arr.forEach((e, i) => {
      const rest = e.p == null;
      const own = e.pat?.[t.id];
      const target = trackTargetPattern(e, t);
      const held = target == null;
      const mode = held ? "off" : own != null ? "own" : "follow";
      const c = el("div", "sq-arrange__cell");
      c.tabIndex = 0;
      c.setAttribute("role", "button");
      c.dataset.i = String(i); c.dataset.t = String(t.id); c.dataset.mode = mode;
      c.style.setProperty("--arr-bars", String(e.bars));
      if (own != null) c.style.setProperty("--arr-hue", String(hueOf(own)));
      c.classList.toggle("is-on", !held);
      c.classList.toggle("is-rest", rest && own == null);
      c.classList.toggle("is-now", i === state.arrangePos);
      c.setAttribute("aria-pressed", String(!held));
      c.setAttribute("aria-label", `${t.name} in section ${i + 1}: ${held ? "silent" : own != null ? `pattern ${own + 1}, its own` : `pattern ${e.p + 1}, the section's`}`);
      c.title = `${t.name} in section ${i + 1}: ${held ? "silent" : own != null ? `pattern ${own + 1}, its own` : `pattern ${e.p + 1}, the section's`}. Click to ${held ? "let it in" : "hold it back"}; drop a pattern number here for one of its own${own != null ? "; × to go back to the section's" : ""}`;
      const pic = el("canvas", "sq-arrange__pic");
      c.appendChild(pic);
      if (own != null) {
        c.appendChild(el("span", "sq-arrange__own", String(own + 1)));
        const x = el("button", "sq-arrange__cellx", "×");
        x.type = "button"; x.tabIndex = -1;
        x.title = "back to the section's pattern";
        x.setAttribute("aria-label", `${t.name}: back to the section's pattern in section ${i + 1}`);
        c.appendChild(x);
      }
      row.appendChild(c);
      paintPic(pic, e, [t]);
    });
    rows.appendChild(row);
  }
  if (focused != null) focusBlock(Number(focused));
}

/**
 * The playhead, from the transport at the moment a step is heard: the block
 * playing, and how far through its bars it is (a line drawn by style.css
 * from --arr-head, only while body.sq-playing). The track list learns it too:
 * `is-held` on a track the section holds back.
 */
export function paintArrangementNow({ pos, bar, barTick, barLen }) {
  const e = state.arrangement[pos];
  if (!e || state.patternMode !== "chain") return;
  for (const t of state.tracks) {
    if (!t.el || t.engineKey === "bus") continue;
    const target = trackTargetPattern(e, t);
    t.el.classList.toggle("is-held", target == null);
    // a lane on a pattern of its own: the track says which, since the pattern bar shows the section's
    if (target != null && target !== state.activePattern) t.el.dataset.arrPattern = String(target + 1);
    else delete t.el.dataset.arrPattern;
  }
  if (!isArrangementShown() || !lane) return;
  const head = Math.max(0, Math.min(1, (bar + barTick / Math.max(1, barLen)) / Math.max(1, e.bars)));
  for (const n of root.querySelectorAll(".sq-arrange__block, .sq-arrange__cell")) {
    const now = Number(n.dataset.i) === pos;
    n.classList.toggle("is-now", now);
    if (now) n.style.setProperty("--arr-head", String(head));
  }
}

/** The transport stopped, or left chain mode: no track is held by a section now. */
export function clearArrangementHold() {
  for (const t of state.tracks) { t.el?.classList.remove("is-held"); if (t.el) delete t.el.dataset.arrPattern; }
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

/**
 * How far past the end a drop at clientX lands, in bars: the gap it would
 * leave between the last section and the dropped one, which becomes a REST.
 * Measured in the tail, from its left edge, in the stylesheet's bar width.
 * Dropping a bar or more past the end is how a rest is dragged into being.
 */
function gapAt(clientX) {
  const tail = lane.querySelector(".sq-arrange__tail");
  if (!tail) return 0;
  const barPx = parseFloat(getComputedStyle(root).getPropertyValue("--arr-bar-w")) || 28;
  const gap = Math.round((clientX - tail.getBoundingClientRect().left) / barPx);
  return Math.max(0, Math.min(ARRANGE_MAX_BARS, gap));
}

function clearDropMarks() {
  for (const n of lane.querySelectorAll(".is-drop-before, .is-drop-end")) n.classList.remove("is-drop-before", "is-drop-end");
  const tail = lane.querySelector(".sq-arrange__tail");
  if (tail) { delete tail.dataset.gap; tail.style.removeProperty("--arr-gap"); }
}

function markDrop(i, gap = 0) {
  clearDropMarks();
  const b = lane.querySelector(`.sq-arrange__block[data-i="${i}"]`);
  if (b) { b.classList.add("is-drop-before"); return; }
  const tail = lane.querySelector(".sq-arrange__tail");
  if (!tail) return;
  tail.classList.add("is-drop-end");
  // the ghost of the rest the gap would make, so the drop is not a surprise
  if (gap >= 1) { tail.dataset.gap = `${plural(gap, "bar")} rest`; tail.style.setProperty("--arr-gap", String(gap)); }
}

function wireLane() {
  lane.addEventListener("dragover", e => {
    const types = e.dataTransfer?.types || [];
    const section = types.includes(MIME_SECTION), pattern = types.includes(MIME_PATTERN);
    if (!section && !pattern) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = section ? "move" : "copy";
    const to = dropIndexAt(e.clientX);
    markDrop(to, to === state.arrangement.length ? gapAt(e.clientX) : 0);
  });
  lane.addEventListener("dragleave", e => { if (!lane.contains(e.relatedTarget)) clearDropMarks(); });
  lane.addEventListener("drop", e => {
    clearDropMarks();
    const sec = e.dataTransfer.getData(MIME_SECTION);
    const pat = e.dataTransfer.getData(MIME_PATTERN);
    if (sec === "" && pat === "") return;
    e.preventDefault();
    let to = dropIndexAt(e.clientX);
    // Past the end, the space left between the last section and the drop is
    // a rest: drag a block a few bars to the right and the gap is silence.
    const gap = to === state.arrangement.length ? gapAt(e.clientX) : 0;
    const rest = gap >= 1 ? { p: null, bars: gap, off: [] } : null;
    if (sec !== "") {
      const from = Number(sec);
      if (!Number.isFinite(from)) return;
      if (to > from) to--;            // the gap closes behind the block being moved
      if (rest) {
        edit(arr => { const [m] = arr.splice(from, 1); arr.push(rest, m); }, `section moved to the end, after a ${plural(gap, "bar")} rest`);
        focusBlock(state.arrangement.length - 1);
      } else moveSection(from, to);
    } else {
      const p = Number(pat);
      if (!Number.isFinite(p)) return;
      if (rest) addSection(null, to, gap);
      addSection(p, rest ? to + 1 : to);
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
    const mv = e.target.closest(".sq-arrange__mv");
    if (mv) { if (!mv.disabled) moveSection(i, i + Number(mv.dataset.dir)); return; }
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
    resizing.b.querySelector(".sq-arrange__bars").textContent = plural(bars, "bar");
    paintPic(resizing.b.querySelector("canvas"), cur);
    // the cells under it follow, so the columns stay columns
    for (const c of rows.querySelectorAll(`.sq-arrange__cell[data-i="${resizing.i}"]`)) c.style.setProperty("--arr-bars", String(bars));
  };
  const onUp = e => {
    if (!resizing || e.pointerId !== resizing.pointerId) return;
    const { i } = resizing;
    resizing.b.classList.remove("is-resizing");
    resizing = null;
    resizedAt = performance.now();
    render();
    setStatus(`section ${i + 1}: ${plural(state.arrangement[i]?.bars ?? 1, "bar")}`);
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
      case "d": addSection(cur.p, i + 1, cur.bars, cur.off, cur.pat); break;
      case "r": addSection(null, i + 1); break;
      default: handled = false;
    }
    if (handled) { e.preventDefault(); e.stopPropagation(); }
  });
}

function wireRows() {
  const trackOf = (n) => state.tracks.find(x => x.id === Number(n?.dataset.t));
  rows.addEventListener("click", e => {
    const cell = e.target.closest?.(".sq-arrange__cell");
    const row = e.target.closest?.(".sq-arrange__row");
    const t = trackOf(cell || row);
    if (!t) return;
    if (cell) {
      const i = Number(cell.dataset.i);
      const sec = state.arrangement[i];
      if (e.target.closest(".sq-arrange__cellx")) {
        setOwn(i, t, null);
        render();
        setStatus(`${t.name} plays the section's pattern in section ${i + 1}`);
        return;
      }
      // a click: in or out. In a rest a track with nothing of its own has
      // nothing to be let in to, so the click says so.
      const held = trackTargetPattern(sec, t) == null;
      if (held && sec.p == null && sec.pat?.[t.id] == null) { setStatus(`section ${i + 1} is a rest: drop a pattern number on ${t.name}'s cell to give it one there`); return; }
      setHeld(i, t, !held);
      render();
      setStatus(`${t.name} ${held ? "plays" : "is held back"} in section ${i + 1}`);
      return;
    }
    if (e.target.closest(".sq-arrange__lanex")) {
      clearLane(t);
      render();
      setStatus(`${t.name} follows the sections again`);
      return;
    }
    const name = e.target.closest?.(".sq-arrange__lanename");
    if (!name) return;
    // the whole row at once: everywhere out, or everywhere in
    const letIn = name.dataset.all === "on";
    state.arrangement.forEach((s, i) => { if (trackTargetPattern({ ...s, off: [] }, t) != null) setHeld(i, t, !letIn); });
    render();
    setStatus(`${t.name} ${letIn ? "plays in every section" : "is held back in every section"}`);
  });
  rows.addEventListener("keydown", e => {
    const cell = e.target.closest?.(".sq-arrange__cell");
    const t = trackOf(cell);
    if (!cell || !t) return;
    const i = Number(cell.dataset.i);
    if (e.key === "Enter" || e.key === " ") { cell.click(); e.preventDefault(); }
    else if (e.key === "Delete" || e.key === "Backspace") { setOwn(i, t, null); render(); e.preventDefault(); }
    else if (/^[1-9]$/.test(e.key)) {
      // a digit is a pattern of the track's own, 1..9; the grid's drag reaches the rest
      setOwn(i, t, Number(e.key) - 1); setHeld(i, t, false); render();
      rows.querySelector(`.sq-arrange__cell[data-i="${i}"][data-t="${t.id}"]`)?.focus();
      e.preventDefault();
    }
  });
  // a pattern number dropped on a cell: that track's own pattern for the section
  rows.addEventListener("dragover", e => {
    const cell = e.target.closest?.(".sq-arrange__cell");
    if (!cell || !(e.dataTransfer?.types || []).includes(MIME_PATTERN)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    for (const n of rows.querySelectorAll(".is-drop")) if (n !== cell) n.classList.remove("is-drop");
    cell.classList.add("is-drop");
  });
  rows.addEventListener("dragleave", e => { e.target.closest?.(".sq-arrange__cell")?.classList.remove("is-drop"); });
  rows.addEventListener("drop", e => {
    const cell = e.target.closest?.(".sq-arrange__cell");
    const p = Number(e.dataTransfer.getData(MIME_PATTERN));
    for (const n of rows.querySelectorAll(".is-drop")) n.classList.remove("is-drop");
    const t = trackOf(cell);
    if (!cell || !t || !Number.isFinite(p)) return;
    e.preventDefault();
    const i = Number(cell.dataset.i);
    setOwn(i, t, p);
    setHeld(i, t, false);
    render();
    setStatus(`${t.name} plays pattern ${p + 1} in section ${i + 1}`);
  });
}

// ---- init ------------------------------------------------------------------

/** Build the panel into #arrangement and wire the tab strip. Once, from init(). */
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
  mk("rest", "+ rest", "add a bar of silence to the end of the arrangement: every track is held back for it, no pattern slot is spent on it");

  mk("fill", "from patterns", "arrange every pattern with notes in slot order, each for its rep count — what chain mode plays without an arrangement");
  mk("clear", "clear", "remove every section; chain mode goes back to playing the patterns in order");
  tools.addEventListener("click", e => {
    const act = e.target.closest("button")?.dataset.act;
    if (act === "add") addSection();
    else if (act === "rest") addSection(null);
    else if (act === "fill") fillFromPatterns();
    else if (act === "clear") edit(arr => arr.splice(0, arr.length), "arrangement cleared");
  });
  head.appendChild(tools);
  const scroll = el("div", "sq-arrange__scroll");
  lane = el("div", "sq-arrange__lane");
  rows = el("div", "sq-arrange__rows");
  scroll.appendChild(lane);
  scroll.appendChild(rows);
  root.appendChild(head);
  root.appendChild(scroll);
  wireLane();
  wireRows();

  // the tabs
  for (const tab of document.querySelectorAll(".sq-tabs__tab")) {
    tab.addEventListener("click", () => showArrangement(tab.dataset.view === "arrangement", { remember: true }));
  }
  document.querySelector(".sq-tabs")?.addEventListener("keydown", e => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    showArrangement(!isArrangementShown(), { remember: true });
    document.querySelector('.sq-tabs__tab[aria-selected="true"]')?.focus();
    e.preventDefault();
  });
  // The mode button repaints the hint: an arrangement in repeat mode is not playing.
  document.getElementById("pattern-mode")?.addEventListener("click", () => { clearArrangementHold(); refreshArrangement(); });
  // A track renamed, added, removed or reordered is a row changed; the undo
  // stack already settles every such edit into one event, so listen to that.
  window.addEventListener("seqbaby:songedited", () => { if (isArrangementShown()) render(); });
  document.addEventListener("input", e => {
    if (!e.target?.classList?.contains("sq-track__name") || !isArrangementShown()) return;
    const t = state.tracks.find(x => x.el?.contains(e.target));
    const label = t && rows.querySelector(`.sq-arrange__row[data-t="${t.id}"] .sq-arrange__label--track`);
    if (label) label.textContent = e.target.value || "track";
  });
  let view = "tracks";
  try { view = localStorage.getItem(VIEW_KEY) || "tracks"; } catch {}
  showArrangement(view === "arrangement");
  refreshArrangement();
}
