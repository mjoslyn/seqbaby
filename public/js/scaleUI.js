import { NOTE_NAMES } from "./constants.js";
import { ICON_KEYBOARD, ICON_PALETTE } from "./icons.js";
import { syncKbdArpUI } from "./keyboard.js";
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
    sel.title = "chord mode: on plays diatonic chords snapped to the scale";
  } else {
    sel.innerHTML = Object.keys(CHORD_TYPES).map(k => `<option value="${k}">${k || "off"}</option>`).join("");
    if (!CHORD_TYPES[state.kbdChordType]) state.kbdChordType = "";   // "on" isn't a real chord type
    sel.title = "chord mode: play each key as a chord. Off is single notes";
  }
  sel.value = state.kbdChordType;
  syncChordUI();   // the arp group only shows while chord mode is on
}

// The whole chord cluster, synced from state: the arp group's visibility
// (keyboard.js) plus the mobile button that opens the cluster as a modal. Every
// path that changes chord or arp state calls this one function, so the button
// and the panel cannot disagree about what is on.
export function syncChordUI() {
  syncKbdArpUI();
  syncChordMenuBtn();
}

// The mobile button's caption IS the setting — a phone shows this button and
// nothing else of the scale row or the chord cluster, so "scale" alone would
// say nothing about whether a tapped step is about to snap or become a chord.
// "scale" is what it reads when neither is on, which names the button.
export function syncChordMenuBtn() {
  const btn = document.getElementById("chord-menu-btn");
  if (!btn) return;
  if (!btn.firstElementChild) btn.innerHTML = ICON_KEYBOARD;
  const type = state.kbdChordType;
  const scale = state.scale.active ? `${NOTE_NAMES[state.scale.root] ?? ""} ${state.scale.mode}`.trim() : "";
  // "on" is the scale-mode picker's value (chords are diatonic there), not a
  // chord quality, so it reads as plain "chord" rather than being printed.
  let chord = !type ? "" : (type === "on" ? "chord" : type);
  if (chord && state.kbdArp) chord += " arp";
  btn.dataset.label = [scale, chord].filter(Boolean).join(" · ") || "scale";
  btn.setAttribute("aria-pressed", String(!!(scale || chord)));
}

// Scale and chord settings as one modal, for phones. Same shape as the pattern
// bar's mobile menu (patternBar.js): the two panels are MOVED rather than
// rebuilt, so main.js's change listeners, scaleUI's option rebuilding and
// syncKbdArpUI all keep working on the one set of controls, and each slots
// back where it came from on close.
let _chordMenuOpen = null;
export function openChordMenu() {
  if (_chordMenuOpen) return;
  const panels = [document.querySelector(".sq-scale__field"), document.getElementById("kbd-chord")]
    .filter(Boolean)
    .map(el => ({ el, parent: el.parentNode, next: el.nextSibling, hidden: el.hidden }));
  if (!panels.length) return;

  const overlay = document.createElement("div");
  overlay.className = "sq-modal-overlay";
  const modal = document.createElement("div");
  modal.className = "sq-modal sq-chord__menu-modal";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");

  const title = document.createElement("div");
  title.className = "sq-modal__title";
  title.textContent = "scale & chord";
  modal.appendChild(title);

  const note = document.createElement("div");
  note.className = "sq-modal__body";
  note.textContent = "with a scale on, every note played snaps to it. While chord mode is on, tapping a step writes this chord on the note it would have taken. Drum kits sit both out.";
  modal.appendChild(note);

  for (const p of panels) { p.el.hidden = false; modal.appendChild(p.el); }

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "sq-chord__menu-close";
  closeBtn.textContent = "done";
  modal.appendChild(closeBtn);

  const close = () => {
    if (!_chordMenuOpen) return;
    for (const p of panels) {
      if (p.next && p.next.parentNode === p.parent) p.parent.insertBefore(p.el, p.next);
      else p.parent.appendChild(p.el);
      p.el.hidden = p.hidden;
    }
    overlay.remove();
    document.removeEventListener("keydown", escHandler);
    _chordMenuOpen = null;
    syncChordMenuBtn();
  };
  const escHandler = (e) => { if (e.key === "Escape") close(); };
  closeBtn.addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  document.addEventListener("keydown", escHandler);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  _chordMenuOpen = { overlay, close };
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
  root.addEventListener("change", () => { state.scale.root = Number(root.value); syncChordMenuBtn(); refreshOnScaleChange(); });
  mode.addEventListener("change", () => { state.scale.mode = mode.value; syncChordMenuBtn(); refreshOnScaleChange(); });

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

