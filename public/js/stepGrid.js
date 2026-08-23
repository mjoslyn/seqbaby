import { stepGateAt } from "./euclid.js";
import { updatePatternCell } from "./patternBar.js";
import { refreshRollIfOpen, rollViewOcts } from "./pianoRoll.js";
import { state } from "./state.js";
import { closeStepEditor, openStepEditor } from "./stepEditor.js";
import { SCALES, applyScale, midiToName, midiToScaleIndex, noteColor, scaleIndexToMidi } from "./theory.js";
import { anchorCovering, extendNote, maxLengthAt, removeNote, startNote } from "./track.js";


/** @typedef {import("./types.js").Track} Track */
export function stepGridCols() { return window.innerWidth <= 768 ? 8 : 16; }

/**
 * Render a track's step cells for the active pattern.
 * @param {Track} t
 */
export function renderStepGrid(t) {
  const grid = t.el.querySelector(".sq-steps");
  const total = t.length;
  const cols = Math.min(stepGridCols(), total);
  grid.style.setProperty("--count", String(cols));
  grid.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
  grid.replaceChildren();
  updatePatternCell(t._patternIdx);
  // A track in live euclid mode plays a generated rhythm rather than its
  // written steps, so that is what the grid has to show — otherwise the one
  // picture of what the track is doing would be a lie. It goes read-only with
  // it (see `.sq-track.is-euclid` in style.css); the pattern underneath is
  // untouched and comes straight back when live mode goes off.
  const live = !!t.euclid?.on;
  let i = 0;
  while (i < total) {
    const gate = stepGateAt(t, i);
    if (gate) {
      const span = live ? gate.span : Math.max(1, Math.min(t.lengths[i] || 1, maxLengthAt(t, i)));
      if (!live) t.lengths[i] = span;
      // Visually split a held note that crosses row boundaries. Each chunk
      // points at the same data anchor (data-idx=i); only the first chunk
      // renders the note-name label.
      let remaining = span;
      let visualIdx = i;
      let first = true;
      while (remaining > 0) {
        const colInRow = visualIdx % cols;
        const chunkSpan = Math.min(remaining, cols - colInRow);
        grid.appendChild(makeCell(t, i, chunkSpan, true, /* continuation */ !first, gate.vel));
        remaining -= chunkSpan;
        visualIdx += chunkSpan;
        first = false;
      }
      i += span;
    } else {
      grid.appendChild(makeCell(t, i, 1, false));
      i += 1;
    }
  }
  refreshRollIfOpen(t);
}

// Piano roll panel: a pitches × steps grid per track. Clicking a cell places
// (or moves) a note at that pitch on that step; clicking an already-active cell
// clears the step; double-clicking an active cell sets velocity to full. Shows
// scale pitches only when a scale is active and "all notes" is off; chromatic
// otherwise. Viewport spans rollViewOcts() octaves starting at t.rollViewOct
// (1 on mobile to fit the screen without vertical scroll, 2 on desktop).
export function makeCell(t, idx, span, on, isContinuation = false, velOverride) {
  const cell = document.createElement("div");
  cell.className = "sq-step";
  cell.dataset.idx = String(idx);
  cell.dataset.span = String(span);
  if (on) {
    cell.classList.add("is-on");
    const vel = velOverride ?? t.velocities[idx] ?? 0.5;
    cell.style.setProperty("--vel", String(vel));
    if (t.notes[idx] != null) {
      const col = noteColor(t.notes[idx]);
      if (col) cell.style.setProperty("--note-color", col);
    }
  }
  if (span > 1) cell.classList.add("is-held");
  if (span > 1) cell.style.gridColumn = `span ${span}`;
  // Drive the held cell's aspect-ratio off its column span so its height
  // stays one-column-tall (width / span) even when it fills the whole row.
  // Without this a full-bar note has no aspect-ratio:1 sibling to reference
  // and the row collapses to the grid-auto-rows floor.
  if (span > 1) cell.style.setProperty("--hspan", String(span));
  if (idx % 4 === 0 && !isContinuation) cell.classList.add("is-beat");
  if (t.accents.has(idx) && !isContinuation) cell.classList.add("is-accent");
  if (on && t.notes[idx] != null && !isContinuation) {
    const label = document.createElement("span");
    label.className = "sq-step__note";
    const chord = t.chords[idx];
    label.textContent = chord ? `${midiToName(t.notes[idx])}${chord}` : midiToName(t.notes[idx]);
    cell.appendChild(label);
  }
  return cell;
}

export function attachGridInteraction(t, grid) {
  let drag = null;
  let longPressTimer = null;
  let longPressIdx = -1;
  const cancelLongPress = () => {
    if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
    longPressIdx = -1;
  };
  const idxFromPoint = (x, y) => {
    const r = grid.getBoundingClientRect();
    const total = t.length;
    if (r.width <= 0 || r.height <= 0) return 0;
    const cols = Math.min(stepGridCols(), total);
    const rows = Math.max(1, Math.ceil(total / cols));
    const col = Math.max(0, Math.min(cols - 1, Math.floor(((x - r.left) / r.width) * cols)));
    const row = Math.max(0, Math.min(rows - 1, Math.floor(((y - r.top) / r.height) * rows)));
    return Math.max(0, Math.min(total - 1, row * cols + col));
  };

  // Manual double-click detection — renderStepGrid() rebuilds step cells on
  // every pointerdown, so the browser's native dblclick (which requires the
  // same element for both clicks) never fires. Track time+index between clicks.
  let lastClickTime = 0;
  let lastClickIdx = -1;
  const DBLCLICK_MS = 400;

  grid.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    closeStepEditor();
    const idx = idxFromPoint(e.clientX, e.clientY);
    const now = performance.now();
    if (now - lastClickTime < DBLCLICK_MS && idx === lastClickIdx) {
      // Double-click: ensure the step is on at `idx` and bump velocity to full.
      // The preceding single click may have just toggled it off via endDrag;
      // re-activate as needed.
      const anchor = anchorCovering(t, idx);
      const target = anchor >= 0 ? anchor : idx;
      if (!t.steps[target]) startNote(t, target);
      t.velocities[target] = 1;
      renderStepGrid(t);
      drag = null;
      lastClickTime = 0;
      lastClickIdx = -1;
      e.preventDefault();
      return;
    }
    lastClickTime = now;
    lastClickIdx = idx;

    const existing = anchorCovering(t, idx);
    let anchor, wasOn = false;
    if (existing >= 0) { anchor = existing; wasOn = true; }
    else { anchor = idx; startNote(t, anchor); renderStepGrid(t); }
    try { grid.setPointerCapture(e.pointerId); } catch {}
    drag = {
      anchor, wasOn, startIdx: idx, lastIdx: idx, moved: false, pointerId: e.pointerId,
      startX: e.clientX, startY: e.clientY,
      startNote: t.notes[anchor] ?? 60,
      pitchMode: false,
    };
    // Long-press → open step editor (touch alternative to right-click).
    if (e.pointerType === "touch") {
      cancelLongPress();
      longPressIdx = anchor;
      longPressTimer = setTimeout(() => {
        longPressTimer = null;
        if (drag) {
          drag.moved = true; // prevent endDrag from toggling the step off
          try { grid.releasePointerCapture(drag.pointerId); } catch {}
          drag = null;
        }
        const cell = grid.querySelector(`.sq-step[data-idx="${longPressIdx}"]`);
        openStepEditor(t, longPressIdx, cell || grid);
      }, 500);
    }
    e.preventDefault();
  });
  const endDrag = (e) => {
    cancelLongPress();
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (!drag.moved && drag.wasOn) { removeNote(t, drag.anchor); renderStepGrid(t); }
    try { grid.releasePointerCapture(e.pointerId); } catch {}
    drag = null;
  };
  grid.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    // Safety: if no buttons are pressed but pointerup never fired (pointer
    // capture can get dropped mid-drag when the grid's children are rebuilt
    // by renderStepGrid), end the drag here so the pitch stops tracking.
    if (e.buttons === 0) { endDrag(e); return; }
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (longPressTimer && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) cancelLongPress();
    // Enter pitch mode once the drag is clearly more vertical than horizontal —
    // but not once a horizontal resize has begun, so dragging down into the next
    // bar row keeps extending the note instead of flipping to pitch.
    if (!drag.pitchMode && !drag.lengthMode && Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) {
      drag.pitchMode = true;
    }
    if (drag.pitchMode) {
      let target;
      if (state.scale.active && SCALES[state.scale.mode]) {
        // 22 px per scale degree — roomy enough to hold a pitch steady.
        const intervals = SCALES[state.scale.mode];
        const startIdx = midiToScaleIndex(drag.startNote, state.scale.root, intervals);
        const steps = Math.round(-dy / 22);
        target = (startIdx != null)
          ? scaleIndexToMidi(startIdx + steps, state.scale.root, intervals)
          : applyScale(drag.startNote + steps);
      } else {
        // 18 px per semitone in chromatic mode.
        const semis = Math.round(-dy / 18);
        target = drag.startNote + semis;
      }
      target = Math.max(24, Math.min(95, target));
      if (t.notes[drag.anchor] !== target) {
        t.notes[drag.anchor] = target;
        if (!t.isDrumKit) t.lastEditedNote = target;
        renderStepGrid(t);
      }
      drag.moved = true;   // prevent endDrag from treating this as a click-to-toggle-off
      return;
    }
    const idx = idxFromPoint(e.clientX, e.clientY);
    if (idx !== drag.startIdx) drag.moved = true;
    if (idx === drag.lastIdx) return;
    drag.lastIdx = idx;
    if (idx > drag.anchor) drag.lengthMode = true;  // committed to resizing
    if (idx >= drag.anchor) { extendNote(t, drag.anchor, idx); renderStepGrid(t); }
  });
  grid.addEventListener("contextmenu", (e) => {
    const idx = idxFromPoint(e.clientX, e.clientY);
    const anchor = anchorCovering(t, idx);
    if (anchor < 0) return;
    e.preventDefault();
    const cell = grid.querySelector(`.sq-step[data-idx="${anchor}"]`);
    openStepEditor(t, anchor, cell || grid);
  });

  grid.addEventListener("dblclick", (e) => {
    // Two clicks in the same cell normally toggle on→off; nudge it back on and
    // crank velocity to full so a double-click slams the step to 100%.
    const idx = idxFromPoint(e.clientX, e.clientY);
    if (idx < 0 || idx >= t.length) return;
    e.preventDefault();
    if (!t.steps[idx]) startNote(t, idx);
    if (!t.velocities) t.velocities = new Array(t.length).fill(0.5);
    const anchor = anchorCovering(t, idx);
    const target = anchor >= 0 ? anchor : idx;
    t.velocities[target] = 1;
    renderStepGrid(t);
  });
  grid.addEventListener("pointerup", endDrag);
  grid.addEventListener("pointercancel", endDrag);
}

// ---- step editor popover ------------------------------------------------

