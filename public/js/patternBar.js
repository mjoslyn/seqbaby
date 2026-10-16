import { PATTERN_COUNT, PATTERN_MODES, patternModeOf } from "./constants.js";
import { setStatus } from "./dom.js";
import { ICON_ARRANGE, ICON_CHAIN, ICON_FINISH, ICON_NOW, ICON_REPEAT } from "./icons.js";
import { flushPatternSound, recallPatternSound, refreshPatternSoundUI } from "./patternSound.js";
import { aliasPattern, clonePattern, emptyPattern, inLoop, isPatternNonEmpty, repaintPatternUI, requestPatternSwitch, state, syncMeterUI, trackSlot } from "./state.js";
import { remapSlots } from "./arrangement.js";
import { renderStepGrid } from "./stepGrid.js";
import { maxLengthAt, resizePattern } from "./track.js";
import { COMMON_METERS, autoAccents, parseMeter, patternMeter, stepsPerBarForMeter } from "./meter.js";
import { paintBeatIndicator } from "./beat.js";
import { announceClips } from "./clips.js";

/** The pattern-mode button's icon and title per mode; the clip view's toolbar draws the same. */
export const MODE_UI = {
  repeat:  { icon: ICON_REPEAT,  title: "repeat: loop the current pattern. Click for chain" },
  chain:   { icon: ICON_CHAIN,   title: "chain: play through the non-empty patterns in order. Click for arrange" },
  arrange: { icon: ICON_ARRANGE, title: "arrange: each track plays its arrangement of pattern blocks. Click for repeat" },
};

/**
 * Paint the pattern-mode button from `state.patternMode`. The one place it is
 * drawn: main.js's click, a session load, a merge and the arrangement view's
 * own toggle all call this rather than each spelling the three icons.
 */
export function syncPatternModeUI() {
  const btn = document.getElementById("pattern-mode");
  if (!btn) return;
  const mode = patternModeOf(state.patternMode);
  btn.innerHTML = MODE_UI[mode].icon;
  btn.title = MODE_UI[mode].title;
  btn.setAttribute("aria-pressed", String(mode !== "repeat"));
  // The caption under the icon in the session menu on a phone, where the title
  // above is a hover nobody can reach. It names the mode the button is IN, not
  // the one it switches to, so it reads as a state and not a verb.
  btn.dataset.label = mode;
  renderPatternGrid();   // the loop range shows on the slots in repeat mode only
}

/** The switch button's icon and title per setting (main.js and the clip view's toolbar). */
export const SWITCH_UI = {
  finish:    { icon: ICON_FINISH, title: "switch: finish. Waits for the current bar to end" },
  immediate: { icon: ICON_NOW,    title: "switch: now. Changes pattern immediately" },
};

/** Set the pattern mode and paint it. Arrange mode starts its bar count over. */
export function setPatternMode(mode) {
  state.patternMode = patternModeOf(mode);
  if (state.patternMode === "arrange") state.arrBar = 0;
  else state._loopMode = state.patternMode;     // what the clip view's play comes back to
  syncPatternModeUI();
}

/** The mode after this one, the button's cycle. */
export function nextPatternMode(mode) {
  return PATTERN_MODES[(PATTERN_MODES.indexOf(patternModeOf(mode)) + 1) % PATTERN_MODES.length];
}

export function copyPattern(from, to) {
  if (from === to) return;
  // A duplicate is an exact copy, p-lock sound (and the preset in it) included.
  // A locked sound is only written back when its pattern is left, so flush
  // each track at ITS slot first, or the copy gets the sound as it was when
  // the source was last left rather than what is playing now.
  for (const t of state.tracks) flushPatternSound(t, trackSlot(t));
  for (const t of state.tracks) {
    const src = t.patterns?.[from];
    if (!src) continue;
    t.patterns[to] = clonePattern(src);
  }
  // Meter + customization travel with the duped pattern so it keeps its
  // time signature and stays independent from pattern 1's meter.
  const srcMeter = state.patternMeters[from];
  if (srcMeter) state.patternMeters[to] = { num: srcMeter.num, den: srcMeter.den };
  state.patternRepeats[to] = state.patternRepeats[from];
  if (to !== 0) state.patternMeterCustomized[to] = !!state.patternMeterCustomized[from]
    || (srcMeter && (srcMeter.num !== state.patternMeters[0].num || srcMeter.den !== state.patternMeters[0].den));
  // Copying over the pattern a track is standing on: nothing switches, so
  // re-bind and repaint it here. A locked track's sound came with the copy, so
  // it has to be recalled too or the pattern would sound like the one it
  // replaced until you next left it and came back. Per track, not "is the scene
  // `to`": a launched clip can have a track on another slot (trackSlot).
  for (const t of state.tracks) {
    if (trackSlot(t) !== to) continue;
    aliasPattern(t, to);
    if (recallPatternSound(t, to)) refreshPatternSoundUI(t);
    renderStepGrid(t);
  }
  renderPatternGrid();
  setStatus(`copied pattern ${from + 1} → ${to + 1}`);
}

// Move pattern `from` so it sits before slot `at` (0..PATTERN_COUNT; `at` is an
// insertion point in the OLD numbering, so dropping after slot 5 is at = 6).
// Everything a slot owns travels with it: every track's pattern (p-lock sound
// included), its meter and its repeat count. The slots in between shift by one.
export function movePattern(from, at) {
  const dest = at > from ? at - 1 : at;
  if (from === dest) return;
  const order = Array.from({ length: PATTERN_COUNT }, (_, i) => i);
  order.splice(from, 1);
  order.splice(dest, 0, from);
  // A locked pattern's sound is only written back when it is left; do it now so
  // the permuted copy holds what is audible. Each track at ITS slot (trackSlot).
  for (const t of state.tracks) flushPatternSound(t, trackSlot(t));
  const pick = (arr, fn = (v) => v) => order.map((i) => fn(arr[i]));
  const renumber = (i) => (i == null ? i : order.indexOf(i));
  for (const t of state.tracks) {
    if (t.patterns) t.patterns = pick(t.patterns);
    // Everything that names a slot by number follows it: where each track is,
    // what it has queued, and its arrangement's blocks.
    t._patternIdx = renumber(trackSlot(t));
    t._queuedSlot = renumber(t._queuedSlot);
    if (t.arrangement?.length) t.arrangement = remapSlots(t.arrangement, order);
  }
  state.patternMeters = pick(state.patternMeters, (m) => ({ num: m.num, den: m.den }));
  state.patternRepeats = pick(state.patternRepeats);
  state.patternMeterCustomized = pick(state.patternMeterCustomized);
  state.activePattern = renumber(state.activePattern);
  state.queuedPattern = renumber(state.queuedPattern);
  // Same pattern objects, new numbers: re-alias each track where it already is
  // (no sound change, so no recall) and repaint everything a switch would. Not
  // switchPattern: that would put every track on the scene, and a launched clip
  // off it has to stay where it was.
  for (const t of state.tracks) aliasPattern(t, trackSlot(t));
  repaintPatternUI();
  setStatus(`moved pattern ${from + 1} → ${dest + 1}`);
}

/**
 * Open an empty column at insertion point `at` (0..PATTERN_COUNT, in the
 * current numbering: `at` = 3 puts it between slots 3 and 4 as the bar
 * numbers them). The bank is a fixed 32, so a column comes from a FREE slot
 * (no steps on any track, no arrangement block on it), moved there with
 * movePattern so everything that names a slot follows: the farthest free slot
 * to the right, so everything from `at` on shifts right by one, or failing
 * that the nearest to the left, the slots in between shifting left. The slot
 * arrives fresh: no lanes, no p-lock, the song's meter, one repeat.
 * @param {number} at
 * @returns {number} the new empty slot, or -1 when every slot is in use
 */
export function insertEmptyPattern(at) {
  const free = (i) => !isPatternNonEmpty(i) && !state.tracks.some((t) => t.arrangement?.some((b) => b.slot === i));
  let from = -1;
  for (let i = PATTERN_COUNT - 1; i > at - 1 && i >= 0; i--) if (i !== at && free(i)) { from = i; break; }
  if (from < 0) for (let i = Math.min(at, PATTERN_COUNT) - 1; i >= 0; i--) if (free(i)) { from = i; break; }
  if (from < 0) { setStatus("no room for a new column: all 32 patterns are in use", true); return -1; }
  movePattern(from, at);
  const dest = at > from ? at - 1 : at;
  for (const t of state.tracks) {
    const p = t.patterns?.[dest];
    if (p) t.patterns[dest] = emptyPattern(p.steps.length);
  }
  const m0 = state.patternMeters[0];
  state.patternMeters[dest] = { num: m0.num, den: m0.den };
  if (dest !== 0) state.patternMeterCustomized[dest] = false;
  state.patternRepeats[dest] = 1;
  for (const t of state.tracks) if (trackSlot(t) === dest) aliasPattern(t, dest);
  repaintPatternUI();
  setStatus(`new empty pattern ${dest + 1}`);
  return dest;
}

/**
 * Set one pattern's time signature: the pattern bar's `sig`, the clip view's
 * meter row, the piano view's section headers and the arrangement's toolbar
 * all come here. Every track's copy of the pattern is resized to keep its bar
 * count (1 bar of 4/4 = 16 steps -> 1 bar of 7/4 = 28). Pattern 1 is the
 * song's default: its meter follows into every slot not set by hand; setting
 * any other slot marks it as its own.
 * @param {number} patIdx @param {string|{num:number,den:number}} meter
 * @returns {boolean} whether anything changed
 */
export function setPatternMeter(patIdx, meter) {
  const m = typeof meter === "string" ? parseMeter(meter) : meter;
  if (!m || patIdx < 0 || patIdx >= PATTERN_COUNT) return false;
  const prev = patternMeter(patIdx);
  if (prev.num === m.num && prev.den === m.den) return false;
  // The meter belongs to the pattern NUMBER, every track alike: the slot set,
  // plus (for pattern 1) every slot following it, each with its meter before
  // the change, so every track's copy of each can be resized to keep its bars.
  const moved = [[patIdx, prev]];
  if (patIdx === 0) {
    for (let i = 1; i < PATTERN_COUNT; i++) {
      if (!state.patternMeterCustomized[i]) moved.push([i, patternMeter(i)]);
    }
  } else {
    state.patternMeterCustomized[patIdx] = true;
  }
  for (const [i] of moved) state.patternMeters[i] = { num: m.num, den: m.den };
  const newSpb = stepsPerBarForMeter(m);
  for (const t of state.tracks) {
    for (const [i, was] of moved) {
      const oldSpb = stepsPerBarForMeter(was);
      if (oldSpb === newSpb) continue;
      // the pattern's OWN length, not t.length: a track with a clip launched
      // is on another slot, and t.length mirrors that one
      const curLen = t.patterns?.[i]?.steps.length || newSpb;
      const bars = Math.max(1, Math.round(curLen / oldSpb));
      const newLen = Math.max(1, Math.min(128, bars * newSpb));
      if (newLen !== curLen) resizePattern(t, i, newLen);
    }
    if (moved.some(([i]) => i === trackSlot(t))) {
      t.accents = autoAccents(t.length, patternMeter(trackSlot(t)));
      renderStepGrid(t);
    }
  }
  syncMeterUI();
  paintBeatIndicator(state.tick);
  announceClips();
  setStatus(`pattern ${patIdx + 1}: ${m.num}/${m.den}${patIdx === 0 ? " (and every pattern not set on its own)" : ""}`);
  return true;
}

/**
 * The options of a meter picker: the common meters, plus the slot's own when
 * it is not one of them (a song or code can set any N/D).
 * @param {number} patIdx
 */
export function meterOptions(patIdx) {
  const cur = patternMeter(patIdx);
  const v = `${cur.num}/${cur.den}`;
  const list = COMMON_METERS.includes(v) ? COMMON_METERS : [v, ...COMMON_METERS];
  return list.map((o) => `<option value="${o}"${o === v ? " selected" : ""}>${o}</option>`).join("");
}

export function renderPatternGrid() {
  const grid = document.getElementById("pattern-grid");
  if (!grid) return;
  grid.replaceChildren();
  for (let i = 0; i < PATTERN_COUNT; i++) {
    const cell = document.createElement("button");
    cell.className = "sq-pattern__cell";
    if (isPatternNonEmpty(i)) cell.classList.add("is-filled");
    if (i === state.activePattern) cell.classList.add("is-active");
    if (i === state.queuedPattern) cell.classList.add("is-queued");
    if (inLoop(i)) cell.classList.add("is-looped");
    cell.textContent = String(i + 1);
    cell.title = `pattern ${i + 1}. Drag onto the middle of another slot to copy it there, or onto its left or right edge to move it before or after`;
    cell.draggable = true;
    cell.dataset.patternIdx = String(i);
    cell.addEventListener("click", () => requestPatternSwitch(i));
    cell.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/pattern-idx", String(i));
      e.dataTransfer.effectAllowed = "copyMove";
    });
    // The outer quarters of a cell insert (move), the middle copies over it.
    const zoneOf = (e) => {
      const r = cell.getBoundingClientRect();
      const x = (e.clientX - r.left) / (r.width || 1);
      return x < 0.25 ? "before" : x > 0.75 ? "after" : "over";
    };
    const clearOver = () => cell.classList.remove("is-drag-over", "is-drop-before", "is-drop-after");
    cell.addEventListener("dragover", (e) => {
      e.preventDefault();
      const z = zoneOf(e);
      e.dataTransfer.dropEffect = z === "over" ? "copy" : "move";
      clearOver();
      cell.classList.add(z === "before" ? "is-drop-before" : z === "after" ? "is-drop-after" : "is-drag-over");
    });
    cell.addEventListener("dragleave", clearOver);
    cell.addEventListener("drop", (e) => {
      e.preventDefault();
      const z = zoneOf(e);
      clearOver();
      const from = Number(e.dataTransfer.getData("text/pattern-idx"));
      if (!Number.isFinite(from)) return;
      if (z !== "over") { movePattern(from, z === "before" ? i : i + 1); return; }
      if (from === i) return;
      copyPattern(from, i);
      // Land on the copy, the way the dup button does — you dragged it here to
      // work on it. Routed through requestPatternSwitch rather than switching
      // outright so it still obeys the finish/immediate setting: mid-bar in
      // finish mode this queues, exactly as clicking the slot would.
      requestPatternSwitch(i);
    });
    grid.appendChild(cell);
  }
}

// ---- rate helpers (LFO) ------------------------------------------------

export function updatePatternCell(idx) {
  const grid = document.getElementById("pattern-grid");
  if (!grid) return;
  const cell = grid.children[idx];
  if (cell) cell.classList.toggle("is-filled", isPatternNonEmpty(idx));
}

// Visual columns per row in the step grid. The data model uses 16-step rows
// (maxLengthAt enforces a ROW=16 cap on note span), but on mobile we wrap to
// 8 visual columns per row for finger-friendly tapping. Held notes that
// exceed the visual row are split into visual chunks at render time without
// touching the data.
export let _patternMenuOpen = null;
export function openPatternMenu() {
  if (_patternMenuOpen) return;
  const patternBar = document.querySelector(".sq-pattern-bar");
  if (!patternBar) return;
  const overlay = document.createElement("div");
  overlay.className = "sq-modal-overlay";
  const modal = document.createElement("div");
  modal.className = "sq-modal sq-pattern__menu-modal";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");

  // Snapshot child order so we can restore on close.
  const captured = [];
  for (const child of Array.from(patternBar.children)) {
    if (child.id === "set-share") continue;
    captured.push({ node: child, nextSibling: child.nextSibling });
  }

  // Group sig + rep + dup into a single row inside the modal for compactness.
  const row = document.createElement("div");
  row.className = "sq-pattern__menu-row";

  for (const { node } of captured) {
    if (node.id === "pattern-meter" || node.id === "pattern-repeats" ||
        node.id === "pattern-dup" || node.classList?.contains("mode-stack")) {
      // these go into the inline row
      row.appendChild(node);
    } else {
      modal.appendChild(node);
    }
  }
  if (row.children.length) modal.appendChild(row);

  // Trailing close button.
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "sq-pattern__menu-close";
  closeBtn.textContent = "done";
  modal.appendChild(closeBtn);

  const close = () => {
    if (!_patternMenuOpen) return;
    // Restore children to their original positions in the pattern bar.
    for (const { node, nextSibling } of captured) {
      if (nextSibling && nextSibling.parentNode === patternBar) {
        patternBar.insertBefore(node, nextSibling);
      } else {
        patternBar.appendChild(node);
      }
    }
    overlay.remove();
    document.removeEventListener("keydown", escHandler);
    _patternMenuOpen = null;
  };
  const escHandler = (e) => { if (e.key === "Escape") close(); };
  closeBtn.addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  document.addEventListener("keydown", escHandler);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  _patternMenuOpen = { overlay, close };
}

