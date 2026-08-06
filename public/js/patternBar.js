import { PATTERN_COUNT } from "./constants.js";
import { setStatus } from "./dom.js";
import { recallPatternSound, refreshPatternSoundUI } from "./patternSound.js";
import { aliasPattern, clonePattern, isPatternNonEmpty, requestPatternSwitch, state } from "./state.js";
import { renderStepGrid } from "./stepGrid.js";
import { maxLengthAt } from "./track.js";

export function copyPattern(from, to) {
  if (from === to) return;
  for (const t of state.tracks) {
    const src = t.patterns?.[from];
    if (!src) continue;
    t.patterns[to] = clonePattern(src);
  }
  // Meter + customization travel with the duped pattern so it keeps its
  // time signature and stays independent from pattern 1's meter.
  const srcMeter = state.patternMeters[from];
  if (srcMeter) state.patternMeters[to] = { num: srcMeter.num, den: srcMeter.den };
  if (to !== 0) state.patternMeterCustomized[to] = !!state.patternMeterCustomized[from]
    || (srcMeter && (srcMeter.num !== state.patternMeters[0].num || srcMeter.den !== state.patternMeters[0].den));
  if (state.activePattern === to) {
    // Copying over the pattern you're standing on: nothing switches, so re-bind
    // and repaint here. A locked track's sound came with the copy, so it has to
    // be recalled too or the pattern would sound like the one it replaced until
    // you next left it and came back.
    for (const t of state.tracks) {
      aliasPattern(t, to);
      if (recallPatternSound(t, to)) refreshPatternSoundUI(t);
      renderStepGrid(t);
    }
  }
  renderPatternGrid();
  setStatus(`copied pattern ${from + 1} → ${to + 1}`);
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
    cell.textContent = String(i + 1);
    cell.title = `pattern ${i + 1} — drag onto another slot to copy it there and go to it`;
    cell.draggable = true;
    cell.dataset.patternIdx = String(i);
    cell.addEventListener("click", () => requestPatternSwitch(i));
    cell.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/pattern-idx", String(i));
      e.dataTransfer.effectAllowed = "copy";
    });
    cell.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      cell.classList.add("is-drag-over");
    });
    cell.addEventListener("dragleave", () => cell.classList.remove("is-drag-over"));
    cell.addEventListener("drop", (e) => {
      e.preventDefault();
      cell.classList.remove("is-drag-over");
      const from = Number(e.dataTransfer.getData("text/pattern-idx"));
      if (!Number.isFinite(from) || from === i) return;
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
    if (child.id === "set-share" || child.id === "pattern-menu-btn") continue;
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

