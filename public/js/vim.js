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
//   COMMAND  :. A line at the bottom: :bpm 128, :p 3, :k cutoff, :w ...
//
// It is the studio's only keyboard layer besides the piano keys themselves.
// It listens on WINDOW capture, so it sees every key before keyboard.js
// (document bubble), and a key it takes is `preventDefault`ed, which
// keyboard.js skips. keyboard.js also refuses to play notes while the mode is
// anything but insert or play. Knobs are turned through knobNav.js: f / c / :k
// pick one, hjkl move between them, the trackpad and - / = turn it.
//
// Edits go through the same step helpers the grid and step input use
// (startNote / removeNote), so undo, the jam and a save see them as edits, and
// history.js's keyup watch makes each command one undo step.

import { setStatus } from "./dom.js";
import { flushHistory, markExternalEdit, redo, undo } from "./history.js";
import { isDesktopKeyboard, isTypingTarget, noteForKey, setKbdRecord } from "./keyboard.js";
import { clearStepAtCursor, extendStepEntry, moveStepCursor, toggleStepAtCursor } from "./keyboard.js";
import { PANELS, initKnobNav, knobActive, knobArrow, knobNames, pickKnob, releaseKnob, togglePanel, turnKnob } from "./knobNav.js";
import { CLASS_FOR_AUTO } from "./paramTargets.js";
import { setActiveTrack } from "./render.js";
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

let bar = null, modeEl = null, keysEl = null, cmdEl = null, menuEl = null;
let count = "";           // a count being typed: 4 in 4l
let pending = "";         // an operator waiting for its second key: g, d, y, r
/** @type {{len: number, cells: Array<{i: number, data: Record<string, any>}>} | null} */
let register = null;
/** The last edit, for `.`: a function of the count. */
let lastEdit = null;

// ---- the track and the cursor ------------------------------------------------

/** The keyboard's track: the active one, else the first that is not a bus. */
function activeTrack() {
  return state.tracks.find(t => t.id === state.activeTrackId) || state.tracks.find(t => t.engineKey !== "bus") || null;
}

/**
 * Make the keyboard's track THE active one: its id in state AND the
 * `is-kbd-active` mark, which is what draws the cursor. Setting the id alone
 * (which vim mode used to do when nothing had been clicked yet) moved an
 * invisible cursor until j or k happened to mark a track. Also covers a song
 * arriving and taking the active track's element with it.
 */
function ensureActive() {
  const t = activeTrack();
  if (t && (state.activeTrackId !== t.id || !t.el?.classList.contains("is-kbd-active"))) setActiveTrack(t);
  return t;
}

/** j / k: `d` tracks down / up, stopping at the ends (buses are not the keyboard's). */
function stepTrack(d) {
  const list = state.tracks.filter(t => t.engineKey !== "bus");
  if (!list.length) return;
  const i = Math.max(0, list.findIndex(t => t.id === state.activeTrackId));
  const next = list[Math.max(0, Math.min(list.length - 1, i + d))];
  setActiveTrack(next);
  next.el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  setStatus(`track ${list.indexOf(next) + 1}/${list.length}: ${next.name}`);
}

/** m / s: through the track's own button, so every rule the click runs still runs. */
function pressTrackButton(which) {
  const t = activeTrack();
  const btn = t?.el?.querySelector(`.sq-track__${which}`);
  if (!btn) return;
  if (btn.disabled) { setStatus(`${t.name} is ${which === "mute" ? "soloed" : "muted"}. Undo that first`, true); return; }
  btn.click();
  setStatus(`${t.name}: ${which} ${(which === "mute" ? t.muted : t.soloed) ? "on" : "off"}`);
}

/** The level control of a track's fx stage, wherever its panel currently is. */
function fxControl(t, stage) {
  const cls = CLASS_FOR_AUTO[`fx.${stage}`];
  if (!cls || !t?.el) return null;
  return t.el.querySelector(`.${cls}`)
    || document.querySelector(`[data-track-id="${CSS.escape(String(t.id))}"] .${cls}`);
}

function playStop() { document.getElementById("play")?.click(); }

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
    ensureActive();
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
    case "k": case "knob": return pickKnob(t, args.filter(a => !/^[-.\d]+$/.test(a)).join(" "), args.find(a => /^[-.\d]+$/.test(a)));
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
  return `E: not a command: ${cmd}. Try :k :bpm :p :len :cut :res :fx :w :q :h`;
}

// ---- completion -------------------------------------------------------------------
//
// The command line lists what could come next as you type: the commands on an
// empty line, the stages after `:fx `, the track's own knobs after `:k `.
// Tab (or ↓) takes the next match into the line and shift-Tab (↑) the one
// before; typing starts the list again from what is there. A mouse click on a
// match takes it too. What runs is always the line itself, so a match is only
// ever a way of typing it.

const COMMANDS = [
  ["k", "pick a knob by name (add 0..1 to set it)", true],
  ["bpm", "tempo", true],
  ["p", "switch pattern (1..32)", true],
  ["len", "track length in steps", true],
  ["cut", "filter cutoff, 0..1", true],
  ["res", "filter resonance, 0..1", true],
  ["fx", "an effect's level: :fx reverb .5", true],
  ["w", "open the save panel", false],
  ["h", "every vim key", false],
  ["q", "vim mode off", false],
];
const MENU_MAX = 8;

const comp = { items: /** @type {Array<{value: string, label: string, hint: string}>} */ ([]), index: -1 };

/** Rank matches: a name that starts with what was typed before one that only contains it. */
function rankBy(query, list, nameOf) {
  const q = query.toLowerCase();
  if (!q) return list;
  const starts = [], has = [];
  for (const x of list) {
    const n = nameOf(x).toLowerCase();
    if (n.startsWith(q)) starts.push(x);
    // One letter only matches a start: "r" is in half the names in the rack.
    else if (q.length > 1 && (n.includes(q) || n.replace(/[^a-z0-9]/g, "").includes(q.replace(/[^a-z0-9]/g, "")))) has.push(x);
  }
  return [...starts, ...has];
}

/** What the line could become. @returns {Array<{value: string, label: string, hint: string}>} */
function completionsFor(line) {
  const text = line.replace(/^\s+/, "");
  const space = text.indexOf(" ");
  if (space < 0) {
    return rankBy(text, COMMANDS, c => c[0]).map(([name, hint, takesArg]) => ({
      value: takesArg ? `${name} ` : name, label: `:${name}`, hint,
    }));
  }
  const cmd = text.slice(0, space);
  const rest = text.slice(space + 1);
  if (cmd === "fx") {
    if (rest.includes(" ")) return [];
    return rankBy(rest, Object.keys(FX_STAGE_LEVEL_KEY), s => s).map(s => ({
      value: `fx ${s} `, label: s, hint: FX_STAGE_LABELS[s] !== s ? FX_STAGE_LABELS[s] : "",
    }));
  }
  if (cmd === "k" || cmd === "knob") {
    // A number typed after the name is the value: there is nothing left to complete.
    if (/\s[-.\d]+$/.test(rest)) return [];
    return rankBy(rest.trim(), knobNames(track()), k => k.name).map(k => ({
      value: `${cmd} ${k.name}`, label: k.name, hint: k.hint,
    }));
  }
  return [];
}

function refreshCompletions() {
  comp.items = completionsFor(cmdEl.value);
  comp.index = -1;
  paintMenu();
}

function paintMenu() {
  if (!menuEl) return;
  const open = state.vimMode === "command" && comp.items.length > 0;
  menuEl.hidden = !open;
  if (!open) { menuEl.replaceChildren(); return; }
  // Keep the picked match in view: show the window of MENU_MAX around it.
  const first = comp.index < MENU_MAX ? 0 : comp.index - MENU_MAX + 1;
  const shown = comp.items.slice(first, first + MENU_MAX);
  const rows = shown.map((it, i) => {
    const li = document.createElement("li");
    li.className = "sq-vim__opt" + (first + i === comp.index ? " is-on" : "");
    li.innerHTML = `<span class="sq-vim__opt-name"></span><span class="sq-vim__opt-hint"></span>`;
    li.firstChild.textContent = it.label;
    li.lastChild.textContent = it.hint;
    // mousedown, and kept from blurring the line: a blur closes the command line.
    li.addEventListener("mousedown", (e) => { e.preventDefault(); takeCompletion(first + i); });
    return li;
  });
  const more = comp.items.length - (first + shown.length);
  if (more > 0) {
    const li = document.createElement("li");
    li.className = "sq-vim__opt sq-vim__opt--more";
    li.textContent = `+${more} more. Keep typing or tab on`;
    rows.push(li);
  }
  menuEl.replaceChildren(...rows);
}

function takeCompletion(i) {
  const it = comp.items[i];
  if (!it) return;
  comp.index = i;
  cmdEl.value = it.value;
  cmdEl.setSelectionRange(it.value.length, it.value.length);
  // A command that takes an argument goes straight on to completing that.
  if (it.value.endsWith(" ")) refreshCompletions();
  else paintMenu();
}

function cycleCompletion(dir) {
  if (!comp.items.length) return;
  const n = comp.items.length;
  const i = comp.index < 0 ? (dir > 0 ? 0 : n - 1) : (comp.index + dir + n) % n;
  const it = comp.items[i];
  comp.index = i;
  cmdEl.value = it.value;
  cmdEl.setSelectionRange(it.value.length, it.value.length);
  paintMenu();
}

function openCommand() {
  setMode("command");
  cmdEl.value = "";
  cmdEl.focus();
  refreshCompletions();
}
function closeCommand() {
  cmdEl.blur();
  setMode("normal");
  comp.items = []; comp.index = -1;
  paintMenu();
}

// ---- help ----------------------------------------------------------------------

const HELP_ROWS = [
  ["`", "vim mode on / off"],
  ["esc", "back to normal (in normal: let go of a knob)"],
  ["h l / j k", "cursor along the steps / between tracks (a count first: 4l)"],
  ["w b 0 $ N|", "next / previous note, first / last step, step N"],
  ["gg G", "first / last track (NG: track N)"],
  ["space", "play / stop"],
  ["i / a / v", "insert (keys write) / play (keys only sound) / select steps"],
  ["in insert", "← → move, → with notes held: longer, enter toggles, backspace clears"],
  ["x o r", "delete / add a note, r then a piano key: that note's pitch"],
  ["> < + -", "pitch up / down, velocity up / down"],
  ["dd yy p .", "clear the track, copy it, paste at the cursor, repeat the last edit"],
  ["v … y d p > <", "copy / delete / paste over / shift the selected steps"],
  ["u / U, ctrl r", "undo / redo"],
  ["m s", "mute / solo the track"],
  ["f c", "fx / filter panel. hjkl walk its knobs"],
  [":k cutoff", "pick any knob by name (:k reverb decay, :k fx.delay.time; add a 0..1 value to set it)"],
  ["scroll, - =", "turn the picked knob: trackpad (shift: finer), or 1% a key (10= is 10%)"],
  [":", ":bpm 128  :p 3  :len 32  :cut .4  :res .6  :fx reverb .5  :12  :w  :q  :h"],
  ["tab / shift tab", "on the command line: take the next / previous match (commands, :fx stages, :k knobs)"],
];

let helpOverlay = null;
function toggleHelp() {
  if (helpOverlay) { helpOverlay.remove(); helpOverlay = null; return; }
  const overlay = document.createElement("div");
  overlay.className = "sq-modal-overlay";
  const rows = HELP_ROWS.map(([k, v]) => `<dt><kbd>${k}</kbd></dt><dd>${v}</dd>`).join("");
  overlay.innerHTML = `
    <div class="sq-modal sq-shortcuts" role="dialog" aria-modal="true" aria-label="vim mode">
      <div class="sq-modal__title">vim mode</div>
      <dl class="sq-shortcuts__list">${rows}</dl>
      <div class="sq-modal__actions"><button class="sq-modal__ok">done</button></div>
    </div>`;
  const close = () => { overlay.remove(); if (helpOverlay === overlay) helpOverlay = null; };
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  overlay.querySelector(".sq-modal__ok").addEventListener("click", close);
  document.body.appendChild(overlay);
  helpOverlay = overlay;
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

  // A knob picked (an open panel, or :k): hjkl walk the knobs, - / = turn it.
  const arrow = { h: "ArrowLeft", j: "ArrowDown", k: "ArrowUp", l: "ArrowRight" }[k] || (k.startsWith("Arrow") ? k : null);
  if (arrow && knobActive()) { count = ""; paintBar(); return knobArrow(arrow); }
  if ((k === "-" || k === "=" || k === "+") && knobActive()) {
    const { n } = takeCount();
    paintBar();
    return turnKnob((k === "-" ? -1 : 1) * n * 0.01);
  }

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
    case "|": setCursor(t, n - 1); return done();
    case " ": if (!e.repeat) playStop(); return done();
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
    case "f": togglePanel(t, PANELS.fx); return done();
    case "c": togglePanel(t, PANELS.filter); return done();
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

function insertKey(e, writing) {
  const k = e.key;
  if (k === " ") { if (!e.repeat) playStop(); return true; }
  if (!writing || state.playing) return false;
  switch (k) {
    case "ArrowRight": if (!e.shiftKey && extendStepEntry()) return true; moveStepCursor(e.shiftKey ? 4 : 1); return true;
    case "ArrowLeft": moveStepCursor(e.shiftKey ? -4 : -1); return true;
    case "Enter": if (!e.repeat) toggleStepAtCursor(); return true;
    case "Backspace": case "Delete": clearStepAtCursor(k === "Backspace"); return true;
  }
  return false;
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
  // A modifier on its own is half of a key still coming (shift for | $ > G),
  // not a key: it must not spend a count typed before it.
  if (e.key === "Shift" || e.key === "Control" || e.key === "Alt" || e.key === "Meta" || e.key === "CapsLock") return;

  if (e.key === "Escape" && helpOverlay) { toggleHelp(); e.preventDefault(); e.stopPropagation(); return; }
  // A button or menu focused inside a dialog keeps space and enter for itself.
  if ((e.key === " " || e.key === "Enter") && e.target !== document.body && e.target?.closest?.('[aria-modal="true"]')) return;
  if (e.key === "Escape") {
    // Leaving a mode is all this Escape does: stopped here, it does not also
    // close the panel it was pressed over. In normal mode it passes, so an
    // open panel or the help list still closes on it.
    if (mode === "normal") {
      const took = !!(count || pending) | releaseKnob();
      if (count || pending) { count = ""; pending = ""; paintBar(); }
      if (took) { e.preventDefault(); e.stopPropagation(); }
      return;
    }
    e.preventDefault(); e.stopPropagation();
    if (mode === "visual" || mode === "insert" || mode === "play") { const t = track(); setMode("normal"); if (t) setCursor(t, cursor(t)); }
    return;
  }
  if (mode === "insert" || mode === "play") {
    // The piano keys fall through to keyboard.js. What else these modes answer
    // to is space, and in insert the step cursor: ← →, → with notes held ties
    // the note longer, enter a step on / off, backspace / delete clear.
    if (!bare) return;
    const took = insertKey(e, mode === "insert");
    if (took) { e.preventDefault(); e.stopPropagation(); }
    return;
  }
  if (e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === "r" && mode === "normal") {
    e.preventDefault(); redo(); return;
  }
  if (!bare) return;
  ensureActive();
  const took = mode === "visual" ? visualKey(e) : normalKey(e);
  if (took) { e.preventDefault(); e.stopPropagation(); }
}

function buildBar() {
  bar = document.createElement("div");
  bar.className = "sq-vim";
  bar.hidden = true;
  bar.innerHTML = `<ul class="sq-vim__menu" role="listbox" hidden></ul><span class="sq-vim__mode"></span><input class="sq-vim__cmd" type="text" spellcheck="false" autocomplete="off" aria-label="vim command" hidden><span class="sq-vim__keys"></span>`;
  document.body.appendChild(bar);
  modeEl = bar.querySelector(".sq-vim__mode");
  keysEl = bar.querySelector(".sq-vim__keys");
  cmdEl = bar.querySelector(".sq-vim__cmd");
  menuEl = bar.querySelector(".sq-vim__menu");
  cmdEl.addEventListener("input", refreshCompletions);
  cmdEl.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Escape") { e.preventDefault(); closeCommand(); return; }
    if (e.key === "Tab" || e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      cycleCompletion(e.key === "ArrowUp" || (e.key === "Tab" && e.shiftKey) ? -1 : 1);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const line = cmdEl.value;
      closeCommand();
      const msg = runCommand(line);
      if (msg) setStatus(msg.replace(/^E: /, ""), msg.startsWith("E:"));
    }
  });
  cmdEl.addEventListener("blur", () => { if (state.vimMode === "command") closeCommand(); });
}

let installed = false;
export function initVim() {
  if (installed || !isDesktopKeyboard()) return;
  installed = true;
  buildBar();
  initKnobNav(() => !!state.vimMode);
  window.addEventListener("keydown", onKeyDown, true);
  const btn = document.getElementById("vim-toggle");
  btn?.addEventListener("click", () => { setVim(!state.vimMode); btn.blur(); });
  let saved = null;
  try { saved = localStorage.getItem(STORE_KEY); } catch {}
  if (saved === "1") setVim(true);
}
