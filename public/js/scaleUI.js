import { NOTE_NAMES } from "./constants.js";
import { ICON_PALETTE } from "./icons.js";
import { init } from "./main.js";
import { refreshRollIfOpen } from "./pianoRoll.js";
import { state } from "./state.js";
import { renderStepGrid } from "./stepGrid.js";
import { CHORD_TYPES, SCALES } from "./theory.js";

// The keyboard chord-type selector collapses to a simple off/on when a scale is
// active (chords are built diatonically from the scale, so the fixed maj/min/…
// qualities don't apply); it expands back to the full chord list otherwise.
export function refreshChordTypeSelect() {
  const sel = document.getElementById("kbd-chord-type");
  if (!sel) return;
  if (state.scale.active) {
    const on = !!state.kbdChordType;
    sel.innerHTML = '<option value="">off</option><option value="on">on</option>';
    state.kbdChordType = on ? "on" : "";
    sel.title = "chord mode — on plays diatonic chords quantized to the scale";
  } else {
    sel.innerHTML = Object.keys(CHORD_TYPES).map(k => `<option value="${k}">${k || "off"}</option>`).join("");
    if (!CHORD_TYPES[state.kbdChordType]) state.kbdChordType = "";   // "on" isn't a real chord type
    sel.title = "chord mode — play each key as a chord (off = single notes)";
  }
  sel.value = state.kbdChordType;
}

export function syncScaleUI() {
  const on = document.getElementById("scale-on");
  const root = document.getElementById("scale-root");
  const mode = document.getElementById("scale-mode");
  on.checked = state.scale.active;
  root.value = String(state.scale.root);
  mode.value = state.scale.mode;
  refreshChordTypeSelect();
}

export function initScaleUI() {
  const on = document.getElementById("scale-on");
  const root = document.getElementById("scale-root");
  const mode = document.getElementById("scale-mode");
  // populate roots
  root.replaceChildren();
  NOTE_NAMES.forEach((n, i) => {
    const opt = document.createElement("option");
    opt.value = String(i); opt.textContent = n;
    root.appendChild(opt);
  });
  // populate modes
  mode.replaceChildren();
  Object.keys(SCALES).filter(m => m !== "off").forEach(m => {
    const opt = document.createElement("option");
    opt.value = m; opt.textContent = m;
    mode.appendChild(opt);
  });
  syncScaleUI();
  // Scale changes affect both the open piano-roll panels (visible pitch rows)
  // and the step-grid note coloring on every track — re-render both.
  const refreshOnScaleChange = () => {
    for (const t of state.tracks) {
      refreshRollIfOpen(t);
      renderStepGrid(t);
    }
  };
  on.addEventListener("change", () => { state.scale.active = on.checked; refreshChordTypeSelect(); refreshOnScaleChange(); });
  root.addEventListener("change", () => { state.scale.root = Number(root.value); refreshOnScaleChange(); });
  mode.addEventListener("change", () => { state.scale.mode = mode.value; refreshOnScaleChange(); });

  // Palette toggle — diatonic pitch-class coloring on/off.
  const palBtn = document.getElementById("note-colors");
  if (palBtn) {
    palBtn.innerHTML = ICON_PALETTE;
    palBtn.setAttribute("aria-pressed", String(state.noteColors));
    palBtn.addEventListener("click", () => {
      state.noteColors = !state.noteColors;
      palBtn.setAttribute("aria-pressed", String(state.noteColors));
      refreshOnScaleChange();
    });
  }
}

// ---- init --------------------------------------------------------------

// ---- level meters -------------------------------------------------------

