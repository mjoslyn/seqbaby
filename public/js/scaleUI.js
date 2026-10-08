import { NOTE_NAMES } from "./constants.js";
import { ICON_KEYBOARD, ICON_PALETTE } from "./icons.js";
import { syncKbdArpUI } from "./keyboard.js";
import { init } from "./main.js";
import { refreshChanceScale } from "./chance.js";
import { refreshRollIfOpen } from "./pianoRoll.js";
import { state } from "./state.js";
import { renderStepGrid } from "./stepGrid.js";
import { CHORD_TYPES, SCALES } from "./theory.js";
import { chordNotes, scalesFitting } from "./theoryData.js";

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
// The button is one of a row of six fixed-width icon buttons, so the caption is
// kept to one short line (`C min`, `C# dor+`, `min7`): the scale abbreviated,
// and a `+` when a chord is on too. The whole setting goes in the title and the
// accessible name. "scale" is what it reads when neither is on.
function shortMode(mode) {
  const m = String(mode);
  if (/\d/.test(m)) return m;   // 12-tet, 24-tet: already short, and "12-" says nothing
  const words = m.split(/\s+/).filter(Boolean);
  return words.length > 1 ? words.map(w => w[0]).join("") : m.slice(0, 3);
}
export function syncChordMenuBtn() {
  const btn = document.getElementById("chord-menu-btn");
  if (!btn) return;
  if (!btn.firstElementChild) btn.innerHTML = ICON_KEYBOARD;
  const type = state.kbdChordType;
  const root = NOTE_NAMES[state.scale.root] ?? "";
  const on = state.scale.active;
  // "on" is the scale-mode picker's value (chords are diatonic there), not a
  // chord quality, so it reads as plain "chord" rather than being printed.
  let chord = !type ? "" : (type === "on" ? "chord" : type);
  if (chord && state.kbdArp) chord += " arp";
  else if (chord && state.kbdStrum) chord += " strum";
  const full = [on ? `${root} ${state.scale.mode}` : "", chord].filter(Boolean).join(" · ");
  btn.dataset.label = on
    ? `${root} ${shortMode(state.scale.mode)}${chord ? "+" : ""}`
    : (type ? (type === "on" ? "chord" : type) : "scale");
  btn.title = full ? `scale & chord: ${full}` : "scale and chord: which notes a tapped step snaps to, and what chord it writes";
  btn.setAttribute("aria-label", full ? `scale and chord settings: ${full}` : "scale and chord settings");
  btn.setAttribute("aria-pressed", String(!!full));
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
  on.checked = state.scale.active;
  rebuildScaleOptions();
  refreshChordTypeSelect();
}

// ---- "fits song": a scale for the notes already written ------------------
// With the scale off, a checkbox narrows the root and mode pickers to the
// scales that hold every note the instruments play, so turning the scale on
// afterwards snaps nothing. It only narrows the LISTS: a refresh never moves
// the song's root or mode, it keeps the current pick in its list marked
// "(doesn't fit)". Only a person's own action (ticking the box, picking a root)
// moves the pick to one that fits. UI state, not the song's.
let _fitOn = false;

/** Every pitch class written on a melodic track, in every pattern: roots,
 *  chord tones and the roll's extras. Drum kits and buses play no key, and a
 *  live chance part's pitches are not in the pattern. */
export function songPitchClasses() {
  const pcs = new Set();
  const add = (n) => { if (Number.isFinite(Number(n))) pcs.add(((Number(n) % 12) + 12) % 12); };
  for (const t of state.tracks) {
    if (t.isDrumKit || t.engineKey === "bus" || t.chance?.on) continue;
    for (const p of t.patterns || []) {
      if (!p?.steps) continue;
      p.steps.forEach((on, i) => {
        if (!on || p.notes?.[i] == null) return;
        const tones = p.chords?.[i] ? chordNotes(p.notes[i], p.chords[i]) : [p.notes[i]];
        tones.forEach(add);
        (p.extraNotes?.[i] || []).forEach(add);
      });
    }
  }
  return pcs;
}

/** Fill the root and mode selects: everything, or only what fits the song. */
function rebuildScaleOptions() {
  const root = document.getElementById("scale-root");
  const mode = document.getElementById("scale-mode");
  const wrap = document.getElementById("scale-fit-wrap");
  if (!root || !mode) return;
  const filtering = _fitOn && !state.scale.active;
  if (wrap) wrap.hidden = state.scale.active;
  const fits = filtering ? scalesFitting(songPitchClasses()) : null;
  const curRoot = state.scale.root | 0, curMode = state.scale.mode;
  const roots = fits ? Object.keys(fits).map(Number) : NOTE_NAMES.map((_, i) => i);
  if (!roots.includes(curRoot)) roots.push(curRoot), roots.sort((a, b) => a - b);
  const allModes = Object.keys(SCALES).filter(m => m !== "off");
  const modes = fits ? allModes.filter(m => m === curMode || (fits[curRoot] || []).includes(m)) : allModes;
  const unfit = (ok) => ok ? "" : " (doesn't fit)";
  root.replaceChildren(...roots.map(i => new Option(NOTE_NAMES[i] + unfit(!fits || !!fits[i]), String(i))));
  mode.replaceChildren(...modes.map(m => new Option(m + unfit(!fits || (fits[curRoot] || []).includes(m)), m)));
  root.value = String(curRoot);
  mode.value = curMode;
  const lbl = document.getElementById("scale-fit-lbl");
  if (lbl) {
    const n = fits ? Object.values(fits).reduce((s, ms) => s + ms.length, 0) : 0;
    lbl.textContent = fits ? `fits song (${n})` : "fits song";
  }
}

/** A person picked: if the current root / mode does not fit, move to one that
 *  does (the same root when it has any, else the first root that has one). */
function settleOnFit() {
  if (!_fitOn || state.scale.active) return false;
  const fits = scalesFitting(songPitchClasses());
  const r = state.scale.root | 0;
  if (fits[r]?.includes(state.scale.mode)) return false;
  const root = fits[r] ? r : Number(Object.keys(fits)[0]);
  if (!Number.isFinite(root)) return false;
  state.scale.root = root;
  state.scale.mode = fits[root][0];
  return true;
}

export function initScaleUI() {
  const on = document.getElementById("scale-on");
  const root = document.getElementById("scale-root");
  const mode = document.getElementById("scale-mode");
  // The root / mode options are rebuilt by rebuildScaleOptions (via
  // syncScaleUI), which narrows them to the song's notes when "fits song" is on.
  syncScaleUI();
  // Scale changes affect both the open piano-roll panels (visible pitch rows)
  // and the step-grid note coloring on every track — re-render both.
  const refreshOnScaleChange = () => {
    refreshChanceScale();   // a chance track on the default semitones follows the scale
    for (const t of state.tracks) {
      refreshRollIfOpen(t);
      renderStepGrid(t);
    }
  };
  on.addEventListener("change", () => { state.scale.active = on.checked; rebuildScaleOptions(); refreshChordTypeSelect(); refreshOnScaleChange(); });
  root.addEventListener("change", () => { state.scale.root = Number(root.value); settleOnFit(); rebuildScaleOptions(); syncChordMenuBtn(); refreshOnScaleChange(); });
  mode.addEventListener("change", () => { state.scale.mode = mode.value; rebuildScaleOptions(); syncChordMenuBtn(); refreshOnScaleChange(); });
  const fit = document.getElementById("scale-fit");
  if (fit) fit.addEventListener("change", () => {
    _fitOn = fit.checked;
    if (settleOnFit()) { syncChordMenuBtn(); refreshOnScaleChange(); }
    rebuildScaleOptions();
  });
  // The notes move under the lists: re-read them after every settled edit
  // (history.js fires this for undo / redo and a jam peer's edit too) and when
  // a song arrives.
  const refit = () => { if (_fitOn && !state.scale.active) rebuildScaleOptions(); };
  window.addEventListener("seqbaby:songedited", refit);
  window.addEventListener("seqbaby:setapplied", refit);
  window.addEventListener("seqbaby:newset", refit);

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

