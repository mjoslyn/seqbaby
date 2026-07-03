import { NOTE_NAMES } from "./constants.js";
import { ICON_PALETTE } from "./icons.js";
import { init } from "./main.js";
import { refreshRollIfOpen } from "./pianoRoll.js";
import { state } from "./state.js";
import { renderStepGrid } from "./stepGrid.js";
import { SCALES } from "./theory.js";

export function syncScaleUI() {
  const on = document.getElementById("scale-on");
  const root = document.getElementById("scale-root");
  const mode = document.getElementById("scale-mode");
  on.checked = state.scale.active;
  root.value = String(state.scale.root);
  mode.value = state.scale.mode;
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
  on.addEventListener("change", () => { state.scale.active = on.checked; refreshOnScaleChange(); });
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

