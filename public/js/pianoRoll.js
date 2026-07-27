import { randomizeMelody } from "./generate.js";
import { ICON_DICE } from "./icons.js";
import { activeMeter, stepsPerBarForMeter, stepsPerBeatForMeter } from "./meter.js";
import { renderAutomationPanel } from "./render.js";
import { state } from "./state.js";
import { openStepEditor } from "./stepEditor.js";
import { renderStepGrid } from "./stepGrid.js";
import { SCALES, midiToName, noteColor } from "./theory.js";
import { anchorCovering, applyRollPitchUp, extendNote, extendPatternByDuplicate, removeNote, startNote, truncatePattern } from "./track.js";

export const rollViewOcts = () => (window.innerWidth <= 768 ? 1 : 2);
export const ROLL_MIN_OCT = 1;
export const ROLL_MAX_OCT = 6;

// Pick the starting octave whose rollViewOcts()-tall window contains the most
// triggered notes in the track's active pattern. Used the first time the roll
// is opened (and whenever rollViewOct is reset). Once the user pages oct +/-
// manually, their choice is preserved.
export function bestRollViewOct(t) {
  const counts = new Map();
  for (let i = 0; i < t.length; i++) {
    if (!t.steps[i] || t.notes[i] == null) continue;
    // seqbaby octave naming: C4 = MIDI 60 → octave 4 = floor(60/12) - 1
    const oct = Math.floor(t.notes[i] / 12) - 1;
    counts.set(oct, (counts.get(oct) || 0) + 1);
  }
  if (counts.size === 0) return 3;
  let bestStart = 3, bestCount = -1;
  const span = rollViewOcts();
  for (let start = ROLL_MIN_OCT; start + span - 1 <= ROLL_MAX_OCT; start++) {
    let c = 0;
    for (let o = start; o < start + span; o++) c += counts.get(o) || 0;
    if (c > bestCount) { bestCount = c; bestStart = start; }
  }
  return bestStart;
}
export const BLACK_KEYS = new Set([1, 3, 6, 8, 10]);

export function refreshRollIfOpen(t) {
  // t._rollPanelEl follows the panel even when it's been moved into a modal.
  const panel = t._rollPanelEl || t.el?.querySelector(".sq-track__roll-panel");
  if (!panel || panel.hidden) return;
  // A full re-render replaces the grid element, which kills any pointer capture
  // held by an in-progress drag on the roll. Skip while a drag is live — the
  // drag handlers paint their own updates via paintColumn.
  if (panel._rollDragActive) return;
  renderRollPanel(t, panel);
}

export function refreshAutIfOpen(t) {
  // _autPanelEl follows the panel even when it's been moved into a modal.
  const panel = t._autPanelEl || t.el?.querySelector(".sq-track__aut-panel");
  if (!panel || panel.hidden) return;
  renderAutomationPanel(t, panel);
}

export function renderRollPanel(t, panel) {
  panel.replaceChildren();
  if (t.rollViewOct == null) t.rollViewOct = bestRollViewOct(t);
  // Clamp in case the viewport size changed (desktop→mobile shrinks span; a
  // saved start near the top edge is still legal, but mobile→desktop expands
  // span so the saved start may now overflow ROLL_MAX_OCT).
  t.rollViewOct = Math.max(ROLL_MIN_OCT, Math.min(ROLL_MAX_OCT - rollViewOcts() + 1, t.rollViewOct));
  if (t.rollShowAll == null) t.rollShowAll = false;
  const scaleIntervals = state.scale.active ? (SCALES[state.scale.mode] || null) : null;
  const chromaticView = !scaleIntervals || t.rollShowAll;
  const EPS = 1e-6;

  // Header: title + all-notes toggle + octave pager + range readout + transforms.
  const head = document.createElement("div");
  head.className = "sq-roll__head";
  const title = document.createElement("span");
  title.className = "sq-roll__title";
  title.textContent = "piano roll";
  head.appendChild(title);
  if (scaleIntervals) {
    const toggle = document.createElement("label");
    toggle.innerHTML = `<input type="checkbox" class="roll-show-all" ${t.rollShowAll ? "checked" : ""}/><span>all notes</span>`;
    toggle.querySelector(".roll-show-all").addEventListener("change", (e) => {
      t.rollShowAll = e.target.checked;
      renderRollPanel(t, panel);
    });
    head.appendChild(toggle);
  }
  const octBtns = document.createElement("span");
  octBtns.className = "sq-roll__oct-btns";
  octBtns.innerHTML = `<button class="sq-btn--ghost" data-d="-1">oct −</button><button class="sq-btn--ghost" data-d="1">oct +</button>`;
  octBtns.querySelectorAll("button").forEach(b => b.addEventListener("click", () => {
    const d = Number(b.dataset.d);
    const next = t.rollViewOct + d;
    if (next < ROLL_MIN_OCT || next + rollViewOcts() - 1 > ROLL_MAX_OCT) return;
    t.rollViewOct = next;
    renderRollPanel(t, panel);
  }));
  head.appendChild(octBtns);
  const range = document.createElement("span");
  range.className = "sq-roll__range";
  range.textContent = `C${t.rollViewOct}–B${t.rollViewOct + rollViewOcts() - 1}`;
  head.appendChild(range);
  // Destructive pattern transforms — applied to the active pattern only.
  const xform = document.createElement("span");
  xform.className = "sq-roll__transforms";
  xform.innerHTML = `
    <button class="sq-btn--ghost sq-icon-btn" data-x="rand" title="random melody (replaces this pattern)" aria-label="random melody">${ICON_DICE}</button>
    <button class="sq-btn--ghost" data-x="up" title="shift all notes up one (scale-aware)">+1</button>
    <button class="sq-btn--ghost" data-x="x2" title="double pattern length (tile)">x2</button>
    <button class="sq-btn--ghost" data-x="x4" title="quadruple pattern length (tile)">x4</button>
    <button class="sq-btn--ghost" data-x="/2" title="halve pattern length (truncate)">/2</button>
    <button class="sq-btn--ghost" data-x="/4" title="quarter pattern length (truncate)">/4</button>
  `;
  xform.querySelectorAll("button").forEach(b => b.addEventListener("click", () => {
    const x = b.dataset.x;
    const pat = t._patternIdx ?? state.activePattern;
    if (x === "rand") {
      randomizeMelody(t);
      renderRollPanel(t, panel);
    } else if (x === "up") {
      applyRollPitchUp(t);
      renderRollPanel(t, panel);
      renderStepGrid(t);
    } else if (x === "x2") {
      extendPatternByDuplicate(t, pat, t.length * 2);
    } else if (x === "x4") {
      extendPatternByDuplicate(t, pat, t.length * 4);
    } else if (x === "/2") {
      truncatePattern(t, pat, Math.max(1, Math.floor(t.length / 2)));
    } else if (x === "/4") {
      truncatePattern(t, pat, Math.max(1, Math.floor(t.length / 4)));
    }
  }));
  head.appendChild(xform);
  panel.appendChild(head);

  const steps = t.length;

  // Cell width: pick a min-width so the initial view fits up to 2 bars on
  // desktop / 1 bar on mobile. Bars are sized by the active pattern's meter
  // (default 4/4 → 16 steps/bar). Tracks shorter than the bar view stretch
  // (1fr) to fill the area; tracks longer than the bar view overflow and the
  // roll-grid scrolls horizontally (`.roll-cells { min-width: max-content }`).
  const _isMobile = window.innerWidth <= 768;
  const _maxBars = _isMobile ? 1 : 2;
  const _spb = stepsPerBarForMeter(activeMeter());
  const _visibleCells = Math.max(1, Math.min(steps, _maxBars * _spb));
  const _labelCol = _isMobile ? 36 : 42;
  const _modalW = Math.min(window.innerWidth * 0.96, 1100);
  const _cellsArea = _modalW - 32 - 4 - _labelCol - 2; // modal pad + grid pad + label + gap
  const _cellMinPx = Math.max(20, Math.floor((_cellsArea - (_visibleCells - 1)) / _visibleCells));
  const rollMinW = `${_cellMinPx}px`;

  // Visible pitches (high → low so the grid reads like a keyboard).
  // C<n> in seqbaby's convention is MIDI (n+1)*12 (so C4 = 60, C3 = 48).
  // Microtonal scales (24-TET, Hüseyni, …) carry half-integer intervals; step
  // the row iteration by 0.5 so quarter tones show up as their own rows.
  const lo = (t.rollViewOct + 1) * 12;
  const hi = lo + rollViewOcts() * 12;                      // exclusive
  const rowStep = scaleIntervals && scaleIntervals.some(i => i !== Math.floor(i)) ? 0.5 : 1;
  const pitches = [];
  for (let m = hi - rowStep; m >= lo - EPS; m -= rowStep) {
    if (chromaticView) { pitches.push(m); continue; }
    const rel = ((m - state.scale.root) % 12 + 12) % 12;
    if (scaleIntervals.some(i => Math.abs(i - rel) < EPS)) pitches.push(m);
  }

  const grid = document.createElement("div");
  grid.className = "sq-roll__grid";

  // Beat ruler row: one cell per step, beat number printed on each downbeat.
  // Steps-per-beat comes from the active pattern's meter (4/4 → 4 steps/beat).
  const _stepsPerBeat = stepsPerBeatForMeter(activeMeter());
  const beatLabel = document.createElement("div");
  beatLabel.className = "sq-roll__label sq-roll__beat-label";
  grid.appendChild(beatLabel);
  const beatRow = document.createElement("div");
  beatRow.className = "sq-roll__cells sq-roll__beat-row";
  beatRow.style.gridTemplateColumns = `repeat(${steps}, minmax(${rollMinW}, 1fr))`;
  for (let i = 0; i < steps; i++) {
    const bc = document.createElement("div");
    bc.className = "sq-roll__beat-cell";
    if (i % _stepsPerBeat === 0) {
      bc.classList.add("is-beat-start");
      bc.textContent = String(Math.floor(i / _stepsPerBeat) + 1);
    }
    beatRow.appendChild(bc);
  }
  grid.appendChild(beatRow);

  for (const m of pitches) {
    const basePc = ((Math.round(m) % 12) + 12) % 12;
    const isMicrotonal = Math.abs(m - Math.round(m)) > EPS;
    const isBlack = !isMicrotonal && BLACK_KEYS.has(basePc);
    const isRoot = scaleIntervals && !isMicrotonal && basePc === state.scale.root;

    const label = document.createElement("div");
    label.className = "sq-roll__label" + (isBlack ? " black" : "") + (isRoot ? " root" : "") + (isMicrotonal ? " micro" : "");
    label.textContent = midiToName(m);
    // Diatonic pitch-class color: same hue as the corresponding note cells.
    if (!isMicrotonal) {
      const labCol = noteColor(m);
      if (labCol) label.style.setProperty("--note-color", labCol);
    }
    grid.appendChild(label);

    const cells = document.createElement("div");
    cells.className = "sq-roll__cells";
    cells.style.gridTemplateColumns = `repeat(${steps}, minmax(${rollMinW}, 1fr))`;
    // Row-level pitch color — feeds the hover tint and any other per-row paint.
    if (!isMicrotonal) {
      const rowCol = noteColor(m);
      if (rowCol) cells.style.setProperty("--row-color", rowCol);
    }
    for (let i = 0; i < steps; i++) {
      const cell = document.createElement("div");
      cell.className = "sq-roll__cell" + (isBlack ? " row-black" : "") + (isMicrotonal ? " row-micro" : "");
      if (i % 4 === 0) cell.classList.add("is-beat");
      cell.dataset.step = String(i);
      cell.dataset.note = String(m);
      // Mark the anchor and any "held" continuation columns. A multi-step note
      // lives on t.lengths[anchor]; the columns after the anchor have steps[i]=0
      // but still belong to the note visually. Fractional MIDI compares via EPS.
      // `note-joins-next` is set on every cell except the note's last column so
      // the CSS can square adjoining corners + bridge the 1px grid gap, making
      // a multi-step note read as one continuous bar.
      const anchor = anchorCovering(t, i);
      if (anchor >= 0) {
        const rootLen = Math.max(1, t.lengths[anchor] || 1);
        const isRoot = Math.abs(t.notes[anchor] - m) < EPS && i < anchor + rootLen;
        let isExtra = false;
        let slotLen = isRoot ? rootLen : 0;
        if (!isRoot) {
          const extras = t.extraNotes?.[anchor];
          const eLens  = t.extraLengths?.[anchor];
          if (Array.isArray(extras)) {
            for (let e = 0; e < extras.length; e++) {
              if (Math.abs(extras[e] - m) < EPS) {
                const eLen = Math.max(1, Math.min(rootLen, (Array.isArray(eLens) ? eLens[e] : null) ?? rootLen));
                if (i < anchor + eLen) {
                  isExtra = true;
                  slotLen = eLen;
                }
                break;
              }
            }
          }
        }
        if (isRoot || isExtra) {
          cell.classList.add("is-on");
          if (anchor !== i) cell.classList.add("is-held");
          if (i < anchor + slotLen - 1) cell.classList.add("is-note-joins-next");
          // Mark the cells a resize gesture grabs (see the gesture map below), so
          // the cursor advertises resize vs move. A length-1 note has no edges —
          // dragging it anywhere moves it.
          if (slotLen > 1 && (i === anchor + slotLen - 1 || (isRoot && i === anchor))) {
            cell.classList.add("is-edge");
          }
          const col = noteColor(m);
          if (col) cell.style.setProperty("--note-color", col);
          // Label the anchor cell only.
          if (anchor === i) {
            if (isRoot) {
              const ch = t.chords[anchor] || "";
              cell.textContent = ch ? `${midiToName(t.notes[anchor])} ${ch}` : midiToName(t.notes[anchor]);
            } else {
              cell.textContent = midiToName(m);
            }
          }
        }
      }
      cells.appendChild(cell);
    }
    grid.appendChild(cells);
  }
  panel.appendChild(grid);

  // Velocity lane — built first so paintColumn() can reference velCells below.
  const velLane = document.createElement("div");
  velLane.className = "sq-roll__vel-lane";
  const velSpacer = document.createElement("div");
  velSpacer.className = "sq-roll__vel-spacer";
  velSpacer.textContent = "vel";
  velLane.appendChild(velSpacer);
  const velCells = document.createElement("div");
  velCells.className = "sq-roll__vel-cells";
  velCells.style.gridTemplateColumns = `repeat(${steps}, minmax(${rollMinW}, 1fr))`;
  for (let i = 0; i < steps; i++) {
    const cell = document.createElement("div");
    cell.className = "sq-roll__vel-cell";
    if (i % 4 === 0) cell.classList.add("is-beat");
    cell.dataset.step = String(i);
    const bar = document.createElement("div");
    bar.className = "sq-roll__vel-bar";
    if (t.steps[i]) {
      cell.classList.add("is-on");
      bar.style.height = `${Math.round((t.velocities[i] ?? 0.5) * 100)}%`;
    }
    cell.appendChild(bar);
    velCells.appendChild(cell);
  }
  velLane.appendChild(velCells);
  panel.appendChild(velLane);

  // Sync horizontal scroll between the pitch grid and the velocity lane so
  // dragging either keeps the columns aligned. Guarded by a re-entry flag so
  // each direction doesn't loop back on the other.
  let _scrollSyncing = false;
  grid.addEventListener("scroll", () => {
    if (_scrollSyncing) return;
    _scrollSyncing = true;
    velLane.scrollLeft = grid.scrollLeft;
    _scrollSyncing = false;
  });
  velLane.addEventListener("scroll", () => {
    if (_scrollSyncing) return;
    _scrollSyncing = true;
    grid.scrollLeft = velLane.scrollLeft;
    _scrollSyncing = false;
  });

  // In-place cell updater. We mutate the DOM instead of re-rendering the whole
  // panel on every drag tick — re-rendering destroys the grid element that
  // holds the active pointer capture, which kills the drag. Fractional MIDI
  // (microtonal pitches) compares via EPS to avoid floating-point misses.
  const paintColumn = (step) => {
    const anchor = anchorCovering(t, step);
    const rootLen = anchor >= 0 ? Math.max(1, t.lengths[anchor] || 1) : 0;
    const coverNote = anchor >= 0 ? t.notes[anchor] : null;
    const extras = anchor >= 0 ? t.extraNotes?.[anchor] : null;
    const eLens  = anchor >= 0 ? t.extraLengths?.[anchor] : null;
    grid.querySelectorAll(`.sq-roll__cell[data-step="${step}"]`).forEach(c => {
      const note = Number(c.dataset.note);
      const isRoot = anchor >= 0 && Math.abs(coverNote - note) < EPS && step < anchor + rootLen;
      let isExtra = false;
      let slotLen = isRoot ? rootLen : 0;
      if (!isRoot && Array.isArray(extras)) {
        for (let e = 0; e < extras.length; e++) {
          if (Math.abs(extras[e] - note) < EPS) {
            const eLen = Math.max(1, Math.min(rootLen, (Array.isArray(eLens) ? eLens[e] : null) ?? rootLen));
            if (step < anchor + eLen) {
              isExtra = true;
              slotLen = eLen;
            }
            break;
          }
        }
      }
      const on = isRoot || isExtra;
      c.classList.toggle("is-on", on);
      c.classList.toggle("is-held", on && anchor !== step);
      c.classList.toggle("is-note-joins-next", on && step < anchor + slotLen - 1);
      c.classList.toggle("is-edge", on && slotLen > 1 &&
        (step === anchor + slotLen - 1 || (isRoot && step === anchor)));
      if (on) {
        const col = noteColor(note);
        if (col) c.style.setProperty("--note-color", col);
        else c.style.removeProperty("--note-color");
      } else {
        c.style.removeProperty("--note-color");
      }
      if (on && anchor === step) {
        if (isRoot) {
          const ch = t.chords[anchor] || "";
          c.textContent = ch ? `${midiToName(coverNote)} ${ch}` : midiToName(coverNote);
        } else {
          c.textContent = midiToName(note);
        }
      } else {
        c.textContent = "";
      }
    });
    const vcell = velCells.querySelector(`.sq-roll__vel-cell[data-step="${step}"]`);
    if (vcell) {
      vcell.classList.toggle("is-on", t.steps[step] === 1);
      const bar = vcell.querySelector(".sq-roll__vel-bar");
      if (bar) bar.style.height = t.steps[step] ? `${Math.round((t.velocities[step] ?? 0.5) * 100)}%` : "0";
    }
  };
  const paintRange = (a, b) => {
    const lo = Math.max(0, Math.min(a, b));
    const hi = Math.min(steps - 1, Math.max(a, b));
    for (let i = lo; i <= hi; i++) paintColumn(i);
  };

  // Gestures on the roll grid:
  //   empty cell down + drag right        → create note, drag extends length
  //   note's right-edge cell + drag       → resize: the end follows the pointer
  //   note's left-edge cell + drag        → resize: the start follows, end stays
  //   note's middle + drag                → move the whole note (step + pitch
  //                                          follow the pointer, length kept)
  //   length-1 note + drag                → move, or resize from the cell's right
  //                                          sliver (its only tail — RESIZE_ZONE)
  //   two clicks in < 400 ms on a note    → delete it (an extra's row deletes
  //                                          only that extra)
  //   click on note (no drag), same pitch → remove the whole note (legacy)
  //   click on note (no drag), diff pitch → re-pitch to clicked row, keep length
  //   two clicks in < 400 ms              → activate + velocity to full
  const PER_STEP_KEYS = [
    "lengths","notes","velocities","chords","offsets",
    "arps","arpRates","arpRanges","arpDirs","complexities","ratchets",
    "sampleStarts","sampleEnds","sampleFadeIns","sampleFadeOuts","sampleLoopModes",
    "extraNotes","extraLengths",
  ];
  const snapStep = (idx) => {
    const out = {};
    for (const k of PER_STEP_KEYS) {
      if (!Array.isArray(t[k])) continue;
      const v = t[k][idx];
      // extraNotes entries are themselves arrays — clone so each snapshot
      // owns an independent copy (writeStep into multiple destinations
      // would otherwise share the same reference).
      out[k] = Array.isArray(v) ? v.slice() : v;
    }
    return out;
  };
  const writeStep = (idx, snap, noteOverride) => {
    t.steps[idx] = 1;
    for (const k of PER_STEP_KEYS) {
      if (!Array.isArray(t[k])) continue;
      if (k === "notes" && noteOverride != null) { t[k][idx] = noteOverride; continue; }
      if (snap[k] !== undefined) t[k][idx] = snap[k];
    }
  };
  // Wipe [from,to] inclusive and truncate any prior note whose tail reaches into it.
  const eraseSpan = (from, to) => {
    if (from > 0) {
      const cov = anchorCovering(t, from);
      if (cov >= 0 && cov < from) t.lengths[cov] = from - cov;
    }
    for (let i = Math.max(0, from); i <= Math.min(t.length - 1, to); i++) {
      t.steps[i] = 0; t.lengths[i] = 0; t.notes[i] = null;
      t.velocities[i] = 0.5; t.chords[i] = "";
      if (t.extraNotes) t.extraNotes[i] = null;
      if (t.extraLengths) t.extraLengths[i] = null;
    }
  };

  let drag = null;
  // Fraction across a length-1 note's cell where the tail (resize) zone starts.
  const RESIZE_ZONE = 0.7;
  let lastRollClickTime = 0;
  let lastRollClickKey = "";
  const ROLL_DBLCLICK_MS = 400;
  let longPressTimer = null;
  let longPressAnchor = -1;
  const cancelLongPress = () => {
    if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
    longPressAnchor = -1;
  };
  const cellFromPoint = (x, y) => {
    const el = document.elementFromPoint(x, y);
    return el?.closest?.(".sq-roll__cell") || null;
  };
  // Wrap a single-click mutation in the drag-active flag so renderStepGrid's
  // refreshRollIfOpen doesn't nuke the grid we just painted locally.
  const localMutate = (fn) => {
    panel._rollDragActive = true;
    try { fn(); }
    finally { panel._rollDragActive = false; }
  };
  grid.addEventListener("pointerdown", (e) => {
    const cell = e.target.closest?.(".sq-roll__cell");
    if (!cell || e.button !== 0) return;
    const step = Number(cell.dataset.step);
    const note = Number(cell.dataset.note);
    const key = `${step}:${note}`;
    const now = performance.now();
    if (now - lastRollClickTime < ROLL_DBLCLICK_MS && key === lastRollClickKey) {
      // Manual double-click deletes the note under the pointer. It works from any
      // of a multi-step note's cells (the anchor owns the data), and only on the
      // pitch row that was actually clicked: on the root it removes the note, on
      // a stacked extra just that extra. A row holding neither does nothing —
      // which is also what makes the double-click safe on a length-1 note, whose
      // first click already removed it.
      localMutate(() => {
        const anchor = anchorCovering(t, step);
        if (anchor < 0) return;
        const len = Math.max(1, t.lengths[anchor] || 1);
        const extras = Array.isArray(t.extraNotes?.[anchor]) ? t.extraNotes[anchor] : null;
        const extraIdx = extras ? extras.findIndex(x => Math.abs(x - note) < EPS) : -1;
        if (Math.abs(t.notes[anchor] - note) < EPS) {
          removeNote(t, anchor);            // root pitch → the whole note (extras included)
        } else if (extraIdx >= 0) {
          const eLens = t.extraLengths?.[anchor];
          extras.splice(extraIdx, 1);
          if (Array.isArray(eLens)) eLens.splice(extraIdx, 1);
          if (!extras.length) {
            t.extraNotes[anchor] = null;
            if (t.extraLengths) t.extraLengths[anchor] = null;
          }
        } else return;
        paintRange(anchor, anchor + len - 1);
        renderStepGrid(t);
      });
      lastRollClickTime = 0;
      lastRollClickKey = "";
      drag = null;
      e.preventDefault();
      return;
    }
    lastRollClickTime = now;
    lastRollClickKey = key;

    // Long-press on a note opens the step editor (touch alternative to
    // right-click). Only fires if pointer stays roughly put for 500 ms.
    if (e.pointerType === "touch") {
      const anchorIdx = anchorCovering(t, step);
      if (anchorIdx >= 0) {
        cancelLongPress();
        longPressAnchor = anchorIdx;
        longPressTimer = setTimeout(() => {
          longPressTimer = null;
          if (drag) {
            drag.moved = true;
            try { grid.releasePointerCapture(drag.pointerId); } catch {}
            drag = null;
          }
          panel._rollDragActive = false;
          openStepEditor(t, longPressAnchor, cell || grid);
        }, 500);
      }
    }

    const existing = anchorCovering(t, step);
    if (existing >= 0) {
      const rootLen = Math.max(1, t.lengths[existing] || 1);
      const samePitch = Math.abs(t.notes[existing] - note) < EPS;
      const extrasArr = Array.isArray(t.extraNotes?.[existing]) ? t.extraNotes[existing] : null;
      const extraIdx = extrasArr ? extrasArr.findIndex(x => Math.abs(x - note) < EPS) : -1;
      const eLensArr = Array.isArray(t.extraLengths?.[existing]) ? t.extraLengths[existing] : null;
      // Identify the slot the user grabbed.
      //   "anchor" — clicked the anchor's root pitch (i is within rootLen)
      //   "extra"  — clicked an existing extra at its pitch (within extraLen)
      //   "empty"  — clicked an empty row at this step
      let dragSlot, slotLen;
      if (samePitch && step < existing + rootLen) {
        dragSlot = { kind: "anchor" };
        slotLen  = rootLen;
      } else if (extraIdx >= 0) {
        const eLen = Math.max(1, Math.min(rootLen, (eLensArr?.[extraIdx]) ?? rootLen));
        if (step < existing + eLen) {
          dragSlot = { kind: "extra", idx: extraIdx };
          slotLen  = eLen;
        } else {
          dragSlot = { kind: "empty" };
          slotLen  = 0;
        }
      } else {
        dragSlot = { kind: "empty" };
        slotLen  = 0;
      }
      const isRightEdgeOfSlot = slotLen > 0 && step === existing + slotLen - 1;
      // A length-1 note is its own head *and* tail, so it has no cell to spare
      // for a resize edge. Split the one cell instead: the right sliver grabs
      // like a tail, the rest like a body — otherwise single notes could only
      // ever be moved, never lengthened.
      const cellRect = cell.getBoundingClientRect();
      const grabFrac = cellRect.width > 0 ? (e.clientX - cellRect.left) / cellRect.width : 0;
      const inTailZone = slotLen === 1 && grabFrac >= RESIZE_ZONE;
      // Left edge of a multi-step note → drag the start; the end stays put.
      // (Only the anchor's own note: an extra always starts where the anchor does.)
      if (slotLen > 1 && step === existing && dragSlot.kind === "anchor") {
        drag = {
          mode: "resizeLeft",
          anchor: existing,
          end: existing + rootLen - 1,
          pointerId: e.pointerId,
          moved: false,
        };
        panel._rollDragActive = true;
        try { grid.setPointerCapture(e.pointerId); } catch {}
        e.preventDefault();
        return;
      }
      // Tail of the slot → resize it.
      if (dragSlot.kind !== "empty" && ((isRightEdgeOfSlot && slotLen > 1) || inTailZone)) {
        drag = {
          mode: "resize",
          anchor: existing,
          origLen: slotLen,
          anchorLen: rootLen,
          dragSlot,
          pointerId: e.pointerId,
          moved: false,
        };
        panel._rollDragActive = true;
        try { grid.setPointerCapture(e.pointerId); } catch {}
        e.preventDefault();
        return;
      }
      drag = {
        mode: "move",
        anchor: existing,
        origLen: rootLen,
        // How far into the note the pointer grabbed, so the note slides with the
        // cursor instead of snapping its head to it.
        grabOffset: step - existing,
        startStep: step,
        startNote: note,
        startX: e.clientX,
        startY: e.clientY,
        dragSlot,
        moved: false,
        pointerId: e.pointerId,
      };
      panel._rollDragActive = true;
      try { grid.setPointerCapture(e.pointerId); } catch {}
      e.preventDefault();
      return;
    }
    // Empty step → create a fresh note at the clicked position. Dragging
    // right extends its length.
    startNote(t, step, note);
    t.notes[step] = note;
    if (!t.isDrumKit) t.lastEditedNote = note;
    drag = { mode: "create", anchor: step, lastEnd: step, moved: false, pointerId: e.pointerId };
    panel._rollDragActive = true;
    try { grid.setPointerCapture(e.pointerId); } catch {}
    paintColumn(step);
    renderStepGrid(t);
    e.preventDefault();
  });
  // Hover affordance for that split cell: the cursor has to change within one
  // cell, which CSS can't express, so mark the sliver as the pointer enters it.
  grid.addEventListener("pointermove", (e) => {
    if (drag) return;
    const cell = e.target.closest?.(".sq-roll__cell");
    if (!cell) return;
    let inZone = false;
    if (cell.classList.contains("is-on") && !cell.classList.contains("is-edge")
        && !cell.classList.contains("is-held") && !cell.classList.contains("is-note-joins-next")) {
      const r = cell.getBoundingClientRect();
      inZone = r.width > 0 && (e.clientX - r.left) / r.width >= RESIZE_ZONE;
    }
    if (cell.classList.contains("is-tail-zone") !== inZone) cell.classList.toggle("is-tail-zone", inZone);
  });
  grid.addEventListener("pointerout", (e) => {
    e.target.closest?.(".sq-roll__cell")?.classList.remove("is-tail-zone");
  });
  grid.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const cell = cellFromPoint(e.clientX, e.clientY);
    if (!cell || !grid.contains(cell)) return;
    const step = Number(cell.dataset.step);
    const note = Number(cell.dataset.note);
    // Any cell change cancels the long-press: the user is dragging, not holding.
    if (longPressTimer) cancelLongPress();

    if (drag.mode === "create") {
      if (step === drag.lastEnd) return;
      const newEnd = Math.max(drag.anchor, step);
      extendNote(t, drag.anchor, newEnd);
      paintRange(drag.anchor, Math.max(drag.lastEnd, newEnd));
      drag.lastEnd = newEnd;
      drag.moved = true;
      renderStepGrid(t);
      return;
    }

    if (drag.mode === "resizeLeft") {
      // The tail is pinned; the head follows the pointer. Moving the head means
      // relocating the anchor, since a note's data lives on its first step.
      const end = drag.end;
      const oldA = drag.anchor;
      const newA = Math.max(0, Math.min(end, step));
      if (newA === oldA) return;
      const snap = snapStep(oldA);
      eraseSpan(Math.min(oldA, newA), end);   // clears the old span + trims a note above it
      writeStep(newA, snap);
      t.lengths[newA] = end - newA + 1;
      const eLens = t.extraLengths?.[newA];   // extras can't outlive the anchor
      if (Array.isArray(eLens)) {
        for (let i = 0; i < eLens.length; i++) {
          if (eLens[i] != null && eLens[i] > t.lengths[newA]) eLens[i] = t.lengths[newA];
        }
      }
      drag.anchor = newA;
      paintRange(Math.min(oldA, newA), end);
      drag.moved = true;
      renderStepGrid(t);
      return;
    }

    if (drag.mode === "resize") {
      const a = drag.anchor;
      const newEnd = Math.max(a, step);
      if (drag.dragSlot && drag.dragSlot.kind === "extra") {
        // Resize a single extra. Capped at the anchor's length (extras can't
        // outlive the anchor).
        const eLens = t.extraLengths[a] ?? (t.extraLengths[a] = []);
        const anchorLen = Math.max(1, t.lengths[a] || 1);
        const requested = newEnd - a + 1;
        const newLen = Math.max(1, Math.min(anchorLen, requested));
        const prev = Math.max(1, Math.min(anchorLen, eLens[drag.dragSlot.idx] ?? anchorLen));
        if (newLen === prev) return;
        eLens[drag.dragSlot.idx] = newLen;
        paintRange(a, a + anchorLen - 1);
        drag.moved = true;
        renderStepGrid(t);
        return;
      }
      // Anchor resize (default). Also clamp extras that would outlive the
      // new anchor length.
      const prevLen = Math.max(1, t.lengths[a] || 1);
      const desired = newEnd - a + 1;
      if (desired === prevLen) return;
      extendNote(t, a, newEnd);
      const newLen = Math.max(1, t.lengths[a] || 1);
      const eLens = t.extraLengths?.[a];
      if (Array.isArray(eLens)) {
        for (let e = 0; e < eLens.length; e++) {
          if (eLens[e] != null && eLens[e] > newLen) eLens[e] = newLen;
        }
      }
      paintRange(a, a + Math.max(prevLen, newLen) - 1);
      drag.moved = true;
      renderStepGrid(t);
      return;
    }

    if (drag.mode === "move") {
      // Require ~8 px before committing — small wobble on a click shouldn't
      // hijack the toggle/polyphony gesture.
      if (!drag.moved) {
        const dx = e.clientX - drag.startX;
        const dy = e.clientY - drag.startY;
        if (Math.hypot(dx, dy) < 8) return;
      }
      const a = drag.anchor;
      const len = drag.origLen;
      if (drag.dragSlot.kind === "anchor") {
        // The whole note follows the pointer: horizontally by whole steps (the
        // grab point stays under the cursor), vertically by pitch row.
        const noteLen = Math.max(1, t.lengths[a] || len);
        const target = Math.max(0, Math.min(t.length - noteLen, step - drag.grabOffset));
        const pitchChanged = Math.abs(t.notes[a] - note) > EPS;
        if (target === a && !pitchChanged) return;
        if (target !== a) {
          // Lift the note (with every per-step field) and set it down again.
          const snap = snapStep(a);
          eraseSpan(a, a + noteLen - 1);
          eraseSpan(target, target + noteLen - 1);   // also trims a note it lands on
          writeStep(target, snap, note);
          drag.anchor = target;
          paintRange(Math.min(a, target), Math.max(a, target) + noteLen - 1);
        } else {
          t.notes[a] = note;
          paintRange(a, a + noteLen - 1);
        }
        if (!t.isDrumKit) t.lastEditedNote = note;
        drag.moved = true;
        renderStepGrid(t);
        return;
      }
      if (drag.dragSlot.kind === "extra") {
        const extras = t.extraNotes[a];
        if (!extras || Math.abs(extras[drag.dragSlot.idx] - note) < EPS) return;
        extras[drag.dragSlot.idx] = note;
        if (!t.isDrumKit) t.lastEditedNote = note;
        paintRange(a, a + len - 1);
        drag.moved = true;
        renderStepGrid(t);
        return;
      }
      // "empty" — drag from an empty pitch row at an existing step. Commit
      // the extra now (at the originally-clicked pitch) and switch to
      // createExtra so further pointermoves extend the new extra's length.
      if (!Array.isArray(t.extraNotes[a])) t.extraNotes[a] = [];
      if (!Array.isArray(t.extraLengths[a])) t.extraLengths[a] = [];
      t.extraNotes[a].push(drag.startNote);
      t.extraLengths[a].push(1);
      const newIdx = t.extraNotes[a].length - 1;
      drag.mode = "createExtra";
      drag.dragSlot = { kind: "extra", idx: newIdx };
      drag.lastEnd = drag.startStep;
      drag.moved = true;
      if (!t.isDrumKit) t.lastEditedNote = drag.startNote;
      // Fall through to the createExtra branch to extend right away.
    }

    if (drag.mode === "createExtra") {
      const a = drag.anchor;
      const anchorLen = Math.max(1, t.lengths[a] || 1);
      const newEnd = Math.max(a, step);
      const desired = Math.min(anchorLen, Math.max(1, newEnd - a + 1));
      const cur = t.extraLengths[a]?.[drag.dragSlot.idx];
      if (cur === desired) return;
      t.extraLengths[a][drag.dragSlot.idx] = desired;
      paintRange(a, a + anchorLen - 1);
      drag.lastEnd = newEnd;
      drag.moved = true;
      renderStepGrid(t);
      return;
    }
  });
  const endDrag = (e) => {
    cancelLongPress();
    if (!drag || e.pointerId !== drag.pointerId) return;
    try { grid.releasePointerCapture(e.pointerId); } catch {}
    // Click on an existing note without dragging → toggle semantics.
    if (!drag.moved && drag.mode === "move") {
      localMutate(() => {
        const a = drag.anchor;
        const len = drag.origLen;
        const startStep = drag.startStep;
        const startNote = drag.startNote;
        if (drag.dragSlot.kind === "anchor" && startStep === a && len === 1) {
          // Click on a length-1 anchor at its root pitch → toggle the
          // whole note off (also clears extras with it).
          removeNote(t, a);
          paintRange(a, a);
        } else if (drag.dragSlot.kind === "extra") {
          // Click on an existing extra → remove that extra.
          const extras = t.extraNotes[a];
          const eLens  = t.extraLengths?.[a];
          if (extras) {
            extras.splice(drag.dragSlot.idx, 1);
            if (Array.isArray(eLens)) eLens.splice(drag.dragSlot.idx, 1);
            if (extras.length === 0) {
              t.extraNotes[a] = null;
              if (t.extraLengths) t.extraLengths[a] = null;
            }
          }
          paintRange(a, a + len - 1);
        } else if (drag.dragSlot.kind === "empty") {
          // Click on an empty pitch row at an existing step → add a 1-step
          // extra. Drag would have extended it; pure click keeps it short.
          const list = Array.isArray(t.extraNotes[a]) ? t.extraNotes[a] : (t.extraNotes[a] = []);
          list.push(startNote);
          const lens = Array.isArray(t.extraLengths[a]) ? t.extraLengths[a] : (t.extraLengths[a] = []);
          lens.push(1);
          if (!t.isDrumKit) t.lastEditedNote = startNote;
          paintRange(a, a + len - 1);
        }
        // else: anchor mid-body / multi-step anchor click — no-op so we
        // don't accidentally tear down a long note.
        renderStepGrid(t);
      });
    }
    // Notes from "create" and "resize" drags are already committed during
    // pointermove. Nothing else to do here.
    drag = null;
    panel._rollDragActive = false;
  };
  grid.addEventListener("pointerup", endDrag);
  grid.addEventListener("pointercancel", endDrag);
  // Right-click on a note opens the step editor (matches the pattern grid).
  grid.addEventListener("contextmenu", (e) => {
    const cell = e.target.closest?.(".sq-roll__cell");
    if (!cell) return;
    const step = Number(cell.dataset.step);
    const anchor = anchorCovering(t, step);
    if (anchor < 0) return;
    e.preventDefault();
    cancelLongPress();
    if (drag) {
      try { grid.releasePointerCapture(drag.pointerId); } catch {}
      drag = null;
      panel._rollDragActive = false;
    }
    openStepEditor(t, anchor, cell);
  });

  let vdrag = null;
  const updateVelFromPoint = (cell, clientY) => {
    const step = Number(cell.dataset.step);
    if (!t.steps[step]) return;
    const r = cell.getBoundingClientRect();
    const v = 1 - Math.max(0, Math.min(1, (clientY - r.top) / r.height));
    t.velocities[step] = Math.max(0.05, Math.min(1, v));
    cell.querySelector(".sq-roll__vel-bar").style.height = `${Math.round(t.velocities[step] * 100)}%`;
  };
  velCells.addEventListener("pointerdown", (e) => {
    const cell = e.target.closest(".sq-roll__vel-cell.is-on");
    if (!cell || e.button !== 0) return;
    vdrag = { pointerId: e.pointerId };
    panel._rollDragActive = true;
    try { velCells.setPointerCapture(e.pointerId); } catch {}
    updateVelFromPoint(cell, e.clientY);
    renderStepGrid(t);
    e.preventDefault();
  });
  velCells.addEventListener("pointermove", (e) => {
    if (!vdrag || e.pointerId !== vdrag.pointerId) return;
    const cell = document.elementFromPoint(e.clientX, e.clientY)?.closest?.(".sq-roll__vel-cell.is-on");
    if (!cell || !velCells.contains(cell)) return;
    updateVelFromPoint(cell, e.clientY);
    renderStepGrid(t);
  });
  const endVDrag = (e) => {
    if (!vdrag || e.pointerId !== vdrag.pointerId) return;
    try { velCells.releasePointerCapture(e.pointerId); } catch {}
    vdrag = null;
    panel._rollDragActive = false;
  };
  velCells.addEventListener("pointerup", endVDrag);
  velCells.addEventListener("pointercancel", endVDrag);
}

