// Vim mode: the studio as a modal editor. Off by default; ` (backquote) or the
// transport's `vim` button switches it on, and the choice is remembered per
// browser, like the metronome's level.
//
//   NORMAL   the letters are commands. The cursor is the step-input cursor
//            (state.kbdCursor) on the keyboard's track, so every motion here
//            and every edit lands exactly where step input would write.
//   INSERT   i. The piano keys write at the cursor (stopped) or the playhead
//            (playing): it is recording armed, keyboard.js's step input.
//   PLAY     a. The piano keys only sound. For jamming without writing.
//   VISUAL   v. A range of steps on the track, for y / d / p / > / <.
//   COMMAND  :. A line at the bottom: :bpm 128, :p 3, :fx reverb .4, :w ...
//
// It is a layer, not a second keyboard: it listens on WINDOW capture, so it
// sees every key before shortcuts.js (document capture) and keyboard.js
// (document bubble), and a key it takes is `preventDefault`ed, which both of
// those skip. A key it does not take falls through to them, which is how space
// still plays, ? still lists, shift + a number still switches an fx, and - / =
// still nudge a panel's knob. keyboard.js also refuses to play notes while the
// mode is anything but insert or play.
//
// Edits go through the same step helpers the grid and step input use
// (startNote / removeNote), so undo, the jam and a save see them as edits, and
// history.js's keyup watch makes each command one undo step.

import { setStatus } from "./dom.js";
import { flushHistory, markExternalEdit, redo, undo } from "./history.js";
import { isDesktopKeyboard, isTypingTarget, noteForKey, setKbdRecord } from "./keyboard.js";
import { PANEL_KEYS, activeTrack, fxControl, navArrow, panelOpen, pressTrackButton, stepTrack, toggleHelp, togglePanel } from "./shortcuts.js";
import { FX_STAGE_LABELS, FX_STAGE_LEVEL_KEY } from "./constants.js";
import { emptyPattern, requestPatternSwitch, state } from "./state.js";
import { paintStepCursor, renderStepGrid } from "./stepGrid.js";
import { liveGeneratorOf } from "./stepSource.js";
import { SCALES, midiToScaleIndex, scaleIndexToMidi } from "./theory.js";
import { anchorCovering, removeNote, startNote } from "./track.js";

/** @typedef {import("./types.js").Track} Track */

const STORE_KEY = "seqbaby.vim.v1";
const MODE_LABEL = { normal: "NORMAL", insert: "INSERT", play: "PLAY", visual: "VISUAL", command: "" };

/** Every per-step array a pattern has: what a yank copies and a paste writes. */
const STEP_FIELDS = (() => {
  const p = emptyPattern(1);
  return Object.keys(p).filter(k => Array.isArray(p[k]));
})();

let bar = null, modeEl = null, keysEl = null, cmdEl = null;
let count = "";           // a count being typed: 4 in 4l
let pending = "";         // an operator waiting for its second key: g, d, y, r
/** @type {{len: number, cells: Array<{i: number, data: Record<string, any>}>} | null} */
let register = null;
/** The last edit, for `.`: a function of the count. */
let lastEdit = null;

// ---- the track and the cursor ------------------------------------------------

function track() {
  const t = activeTrack();
  return t && Array.isArray(t.steps) ? t : null;
}
const trackLen = (t) => t.length || t.steps.length;
function cursor(t) {
  const len = trackLen(t);
  return Math.max(0, Math.min(len - 1, (((state.kbdCursor | 0) % len) + len) % len));
}
function setCursor(t, idx) {
  state.kbdCursor = Math.max(0, Math.min(trackLen(t) - 1, idx));
  if (state.vimSel) state.vimSel.to = state.kbdCursor;
  paintStepCursor(t);
  t.el?.querySelector(".sq-step.is-cursor")?.scrollIntoView({ block: "nearest" });
}
/** A track whose steps can be edited here: not one a generator is playing. */
function editable(t) {
  if (!t) return false;
  if (liveGeneratorOf(t)) { setStatus(`"${t.name}" is playing a live generator. Switch it off to edit steps`, true); return false; }
  return true;
}
function redraw(t) { try { renderStepGrid(t); } catch {} }

// ---- motions -----------------------------------------------------------------

/** w / b: the next / previous note start, n times. */
function noteJump(t, from, dir, n) {
  let at = from;
  for (let k = 0; k < n; k++) {
    let i = at + dir;
    while (i >= 0 && i < trackLen(t) && !t.steps[i]) i += dir;
    if (i < 0 || i >= trackLen(t)) break;
    at = i;
  }
  return at;
}

// ---- edits -------------------------------------------------------------------

function snapshotStep(t, i) {
  const data = {};
  for (const f of STEP_FIELDS) {
    if (!Array.isArray(t[f])) continue;
    const v = t[f][i];
    data[f] = Array.isArray(v) ? v.slice() : v;
  }
  return data;
}

function yank(t, from, to) {
  const lo = Math.min(from, to), hi = Math.max(from, to);
  const cells = [];
  for (let i = lo; i <= hi; i++) if (t.steps[i]) cells.push({ i: i - lo, data: snapshotStep(t, i) });
  register = { len: hi - lo + 1, cells };
  setStatus(`yanked ${hi - lo + 1} step${hi === lo ? "" : "s"} (${cells.length} note${cells.length === 1 ? "" : "s"})`);
}

/** Remove every note that starts in lo..hi. */
function deleteRange(t, lo, hi) {
  let n = 0;
  for (let i = lo; i <= hi; i++) if (t.steps[i]) { removeNote(t, i); n++; }
  // A note held into the range from before it stops where the range starts.
  const a = anchorCovering(t, lo);
  if (a >= 0 && a < lo) t.lengths[a] = lo - a;
  return n;
}

function paste(t, at) {
  if (!register) { setStatus("nothing yanked yet", true); return false; }
  const len = trackLen(t);
  const hi = Math.min(len - 1, at + register.len - 1);
  deleteRange(t, at, hi);
  for (const { i, data } of register.cells) {
    const j = at + i;
    if (j >= len) break;
    for (const f in data) {
      if (!Array.isArray(t[f])) continue;
      const v = data[f];
      t[f][j] = Array.isArray(v) ? v.slice() : v;
    }
  }
  return true;
}

/** > / <: the note's pitch up / down n scale degrees (semitones with no scale). */
function shiftPitch(t, i, n) {
  if (!t.steps[i] || t.notes[i] == null) return false;
  const intervals = state.scale.active ? (SCALES[state.scale.mode] || null) : null;
  const root = state.scale.root;
  let p = t.notes[i];
  const dir = Math.sign(n);
  for (let k = 0; k < Math.abs(n); k++) {
    let next = p + dir;
    if (intervals) {
      const idx = midiToScaleIndex(p, root, intervals);
      if (idx != null) next = scaleIndexToMidi(idx + dir, root, intervals);
    }
    p = Math.max(0, Math.min(127, next));
  }
  const delta = p - t.notes[i];
  t.notes[i] = p;
  if (Array.isArray(t.extraNotes) && t.extraNotes[i]) {
    t.extraNotes[i] = t.extraNotes[i].map(m => Math.max(0, Math.min(127, m + delta)));
  }
  if (!t.isDrumKit) t.lastEditedNote = p;
  return true;
}

/** Around every edit: one undo step each, however fast the keys come. */
function beginEdit() { flushHistory(); }
function endEdit(label) { markExternalEdit(`vim ${label}`); }

/** Run an edit on the track and remember it for `.`. */
function edit(fn, n, label = "edit") {
  const t = track();
  if (!editable(t)) return;
  beginEdit();
  const msg = fn(t, n);
  redraw(t);
  endEdit(label);
  lastEdit = { fn, label };
  if (msg) setStatus(msg);
}

const EDITS = {
  x: (t, n) => {
    const c = cursor(t);
    const hi = Math.min(trackLen(t) - 1, c + n - 1);
    const a = anchorCovering(t, c);
    let gone = deleteRange(t, c, hi);
    if (a >= 0 && a < c && t.steps[a]) { removeNote(t, a); gone++; }   // x on a held note deletes that note
    return `${t.name}: deleted ${gone} note${gone === 1 ? "" : "s"}`;
  },
  o: (t, n) => {
    const c = cursor(t);
    for (let k = 0; k < n && c + k < trackLen(t); k++) if (!t.steps[c + k]) startNote(t, c + k);
    return `${t.name}: note on step ${c + 1}${n > 1 ? `..${Math.min(trackLen(t), c + n)}` : ""}`;
  },
  dd: (t) => { const gone = deleteRange(t, 0, trackLen(t) - 1); return `${t.name}: cleared ${gone} note${gone === 1 ? "" : "s"}`; },
  p: (t, n) => {
    const c = cursor(t);
    let at = c;
    for (let k = 0; k < n; k++) { if (!paste(t, at)) return null; at += register.len; }
    return `pasted at step ${c + 1}`;
  },
  ">": (t, n) => { const i = anchorCovering(t, cursor(t)); return i >= 0 && shiftPitch(t, i, n) ? null : "no note under the cursor"; },
  "<": (t, n) => { const i = anchorCovering(t, cursor(t)); return i >= 0 && shiftPitch(t, i, -n) ? null : "no note under the cursor"; },
  "+": (t, n) => velocity(t, 0.1 * n),
  "-": (t, n) => velocity(t, -0.1 * n),
};
function velocity(t, d) {
  const i = anchorCovering(t, cursor(t));
  if (i < 0) return "no note under the cursor";
  t.velocities[i] = Math.max(0.05, Math.min(1, Math.round(((t.velocities[i] ?? 0.5) + d) * 100) / 100));
  return `${t.name}: velocity ${Math.round(t.velocities[i] * 100)}%`;
}

/** r then a piano key: the note under the cursor takes that pitch (a new note on an empty step). */
function replaceWith(k) {
  const midi = noteForKey(k);
  if (midi == null) return false;
  edit((t) => {
    const c = cursor(t);
    let i = anchorCovering(t, c);
    if (i < 0) { startNote(t, c, midi); i = c; }
    const delta = midi - (t.notes[i] ?? midi);
    t.notes[i] = midi;
    if (Array.isArray(t.extraNotes) && t.extraNotes[i]) t.extraNotes[i] = t.extraNotes[i].map(m => Math.max(0, Math.min(127, m + delta)));
    if (!t.isDrumKit) t.lastEditedNote = midi;
    return null;
  }, 1, "r");
  return true;
}

// ---- modes -------------------------------------------------------------------

function setMode(mode) {
  const was = state.vimMode;
  state.vimMode = mode;
  if (was === "insert" && mode !== "insert") setKbdRecord(false);
  if (mode === "insert") setKbdRecord(true);
  if (mode !== "visual") state.vimSel = null;
  count = ""; pending = "";
  document.body.classList.toggle("vim-on", !!mode);
  for (const m of Object.keys(MODE_LABEL)) document.body.classList.toggle(`vim-${m}`, mode === m);
  const t = track();
  if (t) paintStepCursor(t);
  paintBar();
}

function paintBar() {
  if (!bar) return;
  bar.hidden = !state.vimMode;
  const label = MODE_LABEL[state.vimMode] ?? "";
  modeEl.textContent = label ? `-- ${label} --` : ":";
  keysEl.textContent = count + pending;
  cmdEl.hidden = state.vimMode !== "command";
  document.getElementById("vim-toggle")?.setAttribute("aria-pressed", String(!!state.vimMode));
}

export function setVim(on) {
  if (on && !isDesktopKeyboard()) return;
  if (on) {
    const t = track();
    if (t && state.activeTrackId == null) state.activeTrackId = t.id;
    setMode("normal");
    setStatus("vim mode: hjkl move, i insert, a play, v select, : commands, ` to leave");
  } else {
    setMode(null);
    setStatus("vim mode off");
  }
  try { localStorage.setItem(STORE_KEY, on ? "1" : "0"); } catch {}
}

// ---- the command line ----------------------------------------------------------

/** Set a range control to a 0..1 position through its own input event. */
function setUnit(el, unit) {
  if (!el) return false;
  const min = Number(el.min === "" ? 0 : el.min), max = Number(el.max === "" ? 1 : el.max);
  el.value = String(min + Math.max(0, Math.min(1, unit)) * (max - min));
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

const STAGE_NAMES = Object.fromEntries(
  Object.entries(FX_STAGE_LABELS).flatMap(([k, label]) => [[k, k], [label.replace(/[\s-]/g, ""), k]]),
);

/** @returns {string} what happened (an error starts with "E:") */
function runCommand(line) {
  const [cmd, ...args] = line.trim().split(/\s+/);
  const t = track();
  const num = (s) => Number(s);
  if (!cmd) return "";
  if (/^\d+$/.test(cmd)) { if (!t) return "E: no track"; setCursor(t, num(cmd) - 1); return `step ${cursor(t) + 1}`; }
  switch (cmd) {
    case "q": case "vim": setVim(false); return "vim mode off";
    case "h": case "help": toggleHelp(); return "";
    case "bpm": {
      const v = num(args[0]);
      if (!(v >= 40 && v <= 240)) return "E: bpm is 40 to 240";
      const el = /** @type {HTMLInputElement} */ (document.getElementById("bpm"));
      el.value = String(v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return `bpm ${v}`;
    }
    case "p": case "pattern": {
      const v = num(args[0]);
      if (!(v >= 1 && v <= 32)) return "E: patterns are 1 to 32";
      requestPatternSwitch(v - 1);
      return `pattern ${v}`;
    }
    case "len": {
      const v = num(args[0]);
      const el = /** @type {HTMLInputElement} */ (t?.el?.querySelector(".sq-track__len"));
      if (!el || !(v >= 1)) return "E: :len <steps>";
      el.value = String(v);
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return `${t.name}: ${t.length} steps`;
    }
    case "cut": case "cutoff": case "res": case "reso": {
      const v = num(args[0]);
      if (!(v >= 0 && v <= 1)) return `E: :${cmd} <0..1>`;
      const cls = cmd.startsWith("cut") ? ".p-cutoff" : ".p-reson";
      const el = t?.el?.querySelector(cls) || document.querySelector(`[data-track-id="${t?.id}"] ${cls}`);
      return setUnit(el, v) ? `${t.name}: ${cmd.startsWith("cut") ? "cutoff" : "resonance"} ${v}` : "E: this track has no filter";
    }
    case "fx": {
      const stage = STAGE_NAMES[(args[0] || "").toLowerCase().replace(/[\s-]/g, "")];
      const v = num(args[1]);
      if (!stage || !FX_STAGE_LEVEL_KEY[stage]) return `E: :fx <stage> <0..1>. Stages: ${Object.keys(FX_STAGE_LABELS).join(" ")}`;
      if (!(v >= 0 && v <= 1)) return "E: the level is 0 to 1";
      return setUnit(fxControl(t, stage), v) ? `${t.name}: ${FX_STAGE_LABELS[stage]} ${v}` : "E: no such control on this track";
    }
    case "w": {
      // Saving is the shell's (the account bar), so this opens its save panel.
      const btn = [...document.querySelectorAll("button")].find(b => b.textContent?.trim() === "save");
      if (!btn) return "E: sign in to save";
      btn.click();
      return "save: name it and press save";
    }
  }
  return `E: not a command: ${cmd}. Try :bpm :p :len :cut :res :fx :w :q :h`;
}

function openCommand() {
  setMode("command");
  cmdEl.value = "";
  cmdEl.focus();
}
function closeCommand() {
  cmdEl.blur();
  setMode("normal");
}

// ---- keys --------------------------------------------------------------------

function takeCount() {
  const n = count ? Math.max(1, Math.min(999, Number(count))) : 1;
  const had = !!count;
  count = "";
  return { n, had };
}

function normalKey(e) {
  const k = e.key;
  const t = track();

  if (pending === "r") { pending = ""; paintBar(); if (replaceWith(k.toLowerCase())) return true; return k.length === 1; }
  if (pending === "g" || pending === "d" || pending === "y") {
    const op = pending; pending = "";
    const { n } = takeCount();
    if (op === "g" && k === "g") { const list = state.tracks.filter(x => x.engineKey !== "bus"); stepTrack(-list.indexOf(t)); }
    else if (op === "d" && k === "d") edit(EDITS.dd, 1, "dd");
    else if (op === "y" && k === "y" && t) yank(t, 0, trackLen(t) - 1);
    else if (op === "y" && t && (k === "l" || k === "w")) yank(t, cursor(t), Math.min(trackLen(t) - 1, cursor(t) + n - 1));
    paintBar();
    return k.length === 1;
  }

  if (/^[1-9]$/.test(k) || (k === "0" && count)) { count += k; paintBar(); return true; }

  // A sound panel open: hjkl walk its knobs, - / = fall through to turn them.
  const arrow = { h: "ArrowLeft", j: "ArrowDown", k: "ArrowUp", l: "ArrowRight" }[k] || (k.startsWith("Arrow") ? k : null);
  if (arrow && panelOpen()) { count = ""; paintBar(); return navArrow(arrow); }
  if ((k === "-" || k === "=" || k === "+") && panelOpen()) return false;

  const { n, had } = takeCount();
  const done = (v = true) => { paintBar(); return v; };
  if (!t) return done(k.length === 1);

  switch (k) {
    case "h": case "ArrowLeft": setCursor(t, cursor(t) - n); return done();
    case "l": case "ArrowRight": setCursor(t, cursor(t) + n); return done();
    case "j": case "ArrowDown": stepTrack(n); if (track()) paintStepCursor(track()); return done();
    case "k": case "ArrowUp": stepTrack(-n); if (track()) paintStepCursor(track()); return done();
    case "w": setCursor(t, noteJump(t, cursor(t), 1, n)); return done();
    case "b": setCursor(t, noteJump(t, cursor(t), -1, n)); return done();
    case "0": setCursor(t, 0); return done();
    case "$": setCursor(t, trackLen(t) - 1); return done();
    case "^": setCursor(t, t.steps[0] ? 0 : noteJump(t, 0, 1, 1)); return done();
    case "G": {
      const list = state.tracks.filter(x => x.engineKey !== "bus");
      const want = had ? Math.min(list.length, n) - 1 : list.length - 1;
      stepTrack(want - list.indexOf(t));
      return done();
    }
    case "g": case "d": case "y": case "r":
      if (had) count = String(n);
      pending = k; return done();
    case "x": edit(EDITS.x, n, "x"); return done();
    case "o": edit(EDITS.o, n, "o"); return done();
    case "p": edit(EDITS.p, n, "p"); return done();
    case ">": case "<": case "+": case "-": edit(EDITS[k], n, k); return done();
    case "=": edit(EDITS["+"], n, "+"); return done();
    case ".":
      if (!lastEdit) { setStatus("nothing to repeat"); return done(); }
      edit(lastEdit.fn, n, lastEdit.label); return done();
    case "u": for (let i = 0; i < n; i++) if (!undo()) break; return done();
    case "U": for (let i = 0; i < n; i++) if (!redo()) break; return done();
    case "i": setMode("insert"); setStatus(state.playing ? "insert: notes land on the playhead" : "insert: notes land on the cursor and move it on"); return true;
    case "a": setMode("play"); setStatus("play: the keys sound, nothing is written"); return true;
    case "v": setMode("visual"); state.vimSel = { from: cursor(t), to: cursor(t) }; paintStepCursor(t); setStatus("visual: move to select, then y d p > <"); return true;
    case ":": openCommand(); return true;
    case "m": pressTrackButton("mute"); return done();
    case "s": pressTrackButton("solo"); return done();
    case "f": togglePanel(PANEL_KEYS.KeyF); return done();
    case "c": togglePanel(PANEL_KEYS.KeyC); return done();
  }
  // Any other letter is swallowed: in normal mode a stray key must not reach
  // the note keys or a one-letter shortcut. Everything else falls through.
  return done(/^[a-zA-Z]$/.test(k));
}

function visualKey(e) {
  const k = e.key;
  const t = track();
  if (!t) return false;
  if (/^[1-9]$/.test(k) || (k === "0" && count)) { count += k; paintBar(); return true; }
  const { n } = takeCount();
  const sel = state.vimSel;
  const lo = Math.min(sel.from, sel.to), hi = Math.max(sel.from, sel.to);
  const leave = (msg) => { setMode("normal"); setCursor(t, lo); if (msg) setStatus(msg); return true; };
  switch (k) {
    case "h": case "ArrowLeft": setCursor(t, cursor(t) - n); paintBar(); return true;
    case "l": case "ArrowRight": setCursor(t, cursor(t) + n); paintBar(); return true;
    case "w": setCursor(t, noteJump(t, cursor(t), 1, n)); return true;
    case "b": setCursor(t, noteJump(t, cursor(t), -1, n)); return true;
    case "0": setCursor(t, 0); return true;
    case "$": setCursor(t, trackLen(t) - 1); return true;
    case "y": yank(t, lo, hi); return leave();
    case "d": case "x": {
      if (!editable(t)) return leave();
      yank(t, lo, hi);                    // as in vim, a delete fills the register
      beginEdit();
      const gone = deleteRange(t, lo, hi);
      redraw(t);
      endEdit("delete");
      return leave(`${t.name}: deleted ${gone} note${gone === 1 ? "" : "s"}`);
    }
    case "p": {
      if (!editable(t) || !register) return leave(register ? "" : "nothing yanked yet");
      beginEdit();
      deleteRange(t, lo, hi);
      paste(t, lo);
      redraw(t);
      endEdit("paste");
      return leave(`pasted over steps ${lo + 1}..${hi + 1}`);
    }
    case ">": case "<": {
      if (!editable(t)) return leave();
      beginEdit();
      let moved = 0;
      for (let i = lo; i <= hi; i++) if (shiftPitch(t, i, k === ">" ? n : -n)) moved++;
      redraw(t);
      endEdit(k);
      return leave(`${moved} note${moved === 1 ? "" : "s"} ${k === ">" ? "up" : "down"}`);
    }
    case "v": return leave();
  }
  return /^[a-zA-Z]$/.test(k);
}

function onKeyDown(e) {
  if (!isDesktopKeyboard()) return;
  if (e.target === cmdEl) return;                          // the command line has its own listener
  if (isTypingTarget(e.target)) return;
  const bare = !e.metaKey && !e.ctrlKey && !e.altKey;
  if (e.code === "Backquote" && bare && !e.shiftKey) {
    e.preventDefault();
    if (!e.repeat) setVim(!state.vimMode);
    return;
  }
  const mode = state.vimMode;
  if (!mode) return;

  if (e.key === "Escape") {
    // Leaving a mode is all this Escape does: stopped here, it does not also
    // close the panel it was pressed over. In normal mode it passes, so an
    // open panel or the help list still closes on it.
    if (mode === "normal") { if (count || pending) { count = ""; pending = ""; paintBar(); e.preventDefault(); e.stopPropagation(); } return; }
    e.preventDefault(); e.stopPropagation();
    if (mode === "visual" || mode === "insert" || mode === "play") { const t = track(); setMode("normal"); if (t) setCursor(t, cursor(t)); }
    return;
  }
  if (mode === "insert" || mode === "play") return;       // the keyboard plays; shortcuts still apply
  if (e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === "r" && mode === "normal") {
    e.preventDefault(); redo(); return;
  }
  if (!bare) return;
  const took = mode === "visual" ? visualKey(e) : normalKey(e);
  if (took) { e.preventDefault(); e.stopPropagation(); }
}

function buildBar() {
  bar = document.createElement("div");
  bar.className = "sq-vim";
  bar.hidden = true;
  bar.innerHTML = `<span class="sq-vim__mode"></span><input class="sq-vim__cmd" type="text" spellcheck="false" autocomplete="off" aria-label="vim command" hidden><span class="sq-vim__keys"></span>`;
  document.body.appendChild(bar);
  modeEl = bar.querySelector(".sq-vim__mode");
  keysEl = bar.querySelector(".sq-vim__keys");
  cmdEl = bar.querySelector(".sq-vim__cmd");
  cmdEl.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Escape") { e.preventDefault(); closeCommand(); return; }
    if (e.key === "Enter") {
      e.preventDefault();
      const line = cmdEl.value;
      closeCommand();
      const msg = runCommand(line);
      if (msg) setStatus(msg.replace(/^E: /, ""), msg.startsWith("E:"));
    }
  });
  cmdEl.addEventListener("blur", () => { if (state.vimMode === "command") setMode("normal"); });
}

let installed = false;
export function initVim() {
  if (installed || !isDesktopKeyboard()) return;
  installed = true;
  buildBar();
  window.addEventListener("keydown", onKeyDown, true);
  const btn = document.getElementById("vim-toggle");
  btn?.addEventListener("click", () => { setVim(!state.vimMode); btn.blur(); });
  let saved = null;
  try { saved = localStorage.getItem(STORE_KEY); } catch {}
  if (saved === "1") setVim(true);
}
