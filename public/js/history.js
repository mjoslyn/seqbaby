// ---- undo / redo --------------------------------------------------------
//
// The stack itself, and why it is a stack of session snapshots rather than a
// log of inverse commands, is historyStore.js. This is the engine half: what a
// snapshot is taken FROM, when one is taken, and how one is put back onto a
// running sequencer.
//
// Three things are load-bearing here.
//
// **Nothing had to be instrumented.** The alternative was a `markEdit()` call
// at every mutation site — the step grid, the piano roll, both generators, the
// dice, clear, every track button, the pattern bar, all 1063 parameter
// controls. One forgotten site is an edit you cannot undo, and a forgotten site
// is what an app with fifty modules and three ways to write the same parameter
// guarantees. Instead a single delegated listener watches the events a human
// interaction actually ends in (a pointer coming up, a key going up, an input
// settling), waits for the gesture to finish, and asks the session whether it
// changed. If it did, that is an edit, whatever produced it — so a feature
// added later is undoable without knowing this file exists.
//
// **Restoring is diffed, and falls back to `applySet` wholesale.** Undoing a
// step toggle must not stop the transport, and `applySet` tears down every
// track and voice in the session, so the common cases are put back in place:
// patterns, the track's own fields, and the sound (through `applyPatternSound`,
// which already knows how to install a sound while the transport runs, and for
// exactly the same reason). Anything that needs a voice or the graph rebuilt —
// an engine change, a new sample, a track added or removed, a send re-routed —
// falls back to `applySet` on the snapshot, which is the same path a song load
// takes. One loader, not two that drift.
//
// **An automated parameter is pinned.** See `pinAutomated` below.

import { VOICE_AUTO_KEYS } from "./automation.js";
import { PATTERN_COUNT } from "./constants.js";
import { setStatus } from "./dom.js";
import { cloneChance, refreshChanceUI, renderChancePanel } from "./chance.js";
import { refreshEuclidUI, renderEuclidPanel } from "./euclid.js";
import { HistoryStack, sameTree, shareStructure } from "./historyStore.js";
import { ICON_CHAIN, ICON_FINISH, ICON_NOW, ICON_REDO, ICON_REPEAT, ICON_UNDO } from "./icons.js";
import { applySampleSpeed } from "./lfo.js";
import { applyMacroPads } from "./macro.js";
import { parseMeter } from "./meter.js";
import { CONTROL_LABELS, controlFromEventTarget, refreshParamIndicators } from "./paramTargets.js";
import { updateGranularSpeedEnabled } from "./params.js";
import { renderPatternGrid } from "./patternBar.js";
import { applyPatternSound, refreshAllPatternLockUI, refreshPatternSoundUI } from "./patternSound.js";
import { refreshAutIfOpen, refreshRollIfOpen } from "./pianoRoll.js";
import { applyBusMute, paintDiceDensity } from "./render.js";
import { syncScaleUI } from "./scaleUI.js";
import { applySet, serializeSet } from "./session.js";
import { refreshCompSourceDropdowns, refreshNoiseBeds, refreshOutputSelects } from "./signal.js";
import { aliasPattern, clonePattern, state, syncMeterUI, syncRepeatsUI } from "./state.js";
import { renderStepGrid } from "./stepGrid.js";

/** @typedef {import("./types.js").Track} Track */

/** How long after the last interaction the session is checked for changes.
 *  Long enough that a knob drag, a step painted across eight cells or a
 *  generator's repaint settle into one entry; short enough that the undo button
 *  lights up while you are still looking at what you did. */
const SETTLE_MS = 420;

const stack = new HistoryStack();

/** The snapshot that describes the live engine right now. Kept so the next
 *  check has something to fold onto — and so a restore can diff against where
 *  it is starting from without rebuilding it. */
let live = null;
/** Set while a restore is writing to the engine: the writes go through the same
 *  controls a human uses (the bpm field is restored by dispatching its own
 *  `input` event, which is the one place that knows what a tempo change
 *  entails), and those must not be read back as fresh edits. */
let restoring = false;
let settleTimer = null;
let idleHandle = null;                  // the idle slot the settle moved to
let pending = { label: "", key: null };
let started = false;

// ---- taking a snapshot --------------------------------------------------

/**
 * While the transport runs, an enabled automation lane rewrites the very field
 * it automates: `t.filter.cutoff` on every single step, and `t.params[k]` for a
 * voice with no AudioParam behind that key (applyAutomationAtStep). That value
 * is not something the user can hold — the lane overwrites it a sixteenth later
 * — so letting it into the history would fill the stack with entries nobody
 * made, and hand an undo back whatever the lane happened to be at.
 *
 * So those fields are pinned to what the previous snapshot had. They stop
 * moving in the history while the lane owns them, and the moment the lane is
 * switched off the live value enters as an ordinary edit. Only while playing:
 * stopped, nothing drifts and the snapshot is exact.
 *
 * The pin has to reach the p-lock stores as well as the live fields, because
 * `serializeSet` flushes the live sound into `baseSound` (or the locked
 * pattern's own `sound`) on its way out — the drift would otherwise arrive by
 * the back door.
 */
function pinAutomated(prev, snap) {
  if (!prev || !state.playing) return snap;
  const ap = state.activePattern;
  state.tracks.forEach((t, i) => {
    const a = prev.tracks?.[i], b = snap.tracks?.[i];
    if (!a || !b) return;
    for (const [key, lane] of Object.entries(t.automation || {})) {
      if (!lane?.enabled) continue;
      const group = (key === "cutoff" || key === "reson") ? "filter"
                  : VOICE_AUTO_KEYS.includes(key) ? "params"
                  : null;
      if (!group) continue;                      // the rest never touch a store
      pinField(a, b, group, key);
      pinField(a.baseSound, b.baseSound, group, key);
      pinField(a.patterns?.[ap]?.sound, b.patterns?.[ap]?.sound, group, key);
    }
  });
  return snap;
}

function pinField(from, to, group, key) {
  const src = from?.[group], dst = to?.[group];
  if (!src || !dst) return;
  if (Object.prototype.hasOwnProperty.call(src, key)) dst[key] = src[key];
}

/** The live session, as a snapshot folded onto `prev` (see historyStore.js). */
function snapshot(prev) {
  const snap = serializeSet();
  // Which pattern you are LOOKING at is not part of the song's history. Chain
  // mode advances it from inside the transport's scheduler, and a queued switch
  // commits a bar after the click that asked for it — neither is an edit, and
  // both would otherwise leave an entry on the stack whose undo, having nothing
  // else to put back, would do visibly nothing. So it is dropped here, and the
  // restore below hands `applySet` whichever pattern is on screen at the time:
  // an undo changes the song, never the view.
  delete snap.activePattern;
  return shareStructure(prev, pinAutomated(prev, snap));
}

// ---- what changed, and what that costs to put back ----------------------

// A track field whose restoration needs the voice rebuilt, the graph re-wired
// or the track's DOM rebuilt. `applySet` is the only thing that does all three
// correctly, so an undo that crosses one of these falls back to it rather than
// growing a second, subtly-different loader beside it.
const REBUILD_KEYS = [
  "engineKey", "customConfig", "wavetable", "sampleSource",
  "uploadAudio", "uploadAudioMime", "granularSample", "midi",
  "outIndex", "compSourceIndex",
];

function needsFullApply(cur, target) {
  if (!cur || (cur.tracks?.length ?? 0) !== (target.tracks?.length ?? 0)) return true;
  for (let i = 0; i < target.tracks.length; i++) {
    const a = cur.tracks[i], b = target.tracks[i];
    if (a === b) continue;
    for (const k of REBUILD_KEYS) if (!sameTree(a?.[k], b[k])) return true;
  }
  return false;
}

// ---- putting one back ---------------------------------------------------

const el = (id) => document.getElementById(id);
const deepCopy = (v) => (v == null ? v
  : typeof structuredClone === "function" ? structuredClone(v)
  : JSON.parse(JSON.stringify(v)));

function restoreGlobals(cur, target) {
  if (cur.bpm !== target.bpm) {
    const bpm = el("bpm");
    if (bpm) {
      bpm.value = target.bpm;
      // Through the field's own listener: retuning the synced LFOs, the synced
      // delays, the sample speeds and every open mod row's rate reading is what
      // a tempo change means, and main.js is where that sentence is written.
      bpm.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }
  // The transport reads the swing slider straight off the DOM each callback, so
  // the value IS the state and there is nothing else to write.
  if (cur.swing !== target.swing && el("swing")) el("swing").value = target.swing;

  if (!sameTree(cur.scale, target.scale)) {
    Object.assign(state.scale, target.scale);
    syncScaleUI();
  }
  if (cur.patternMode !== target.patternMode) {
    state.patternMode = target.patternMode === "chain" ? "chain" : "repeat";
    const btn = el("pattern-mode");
    if (btn) {
      btn.innerHTML = state.patternMode === "chain" ? ICON_CHAIN : ICON_REPEAT;
      btn.setAttribute("aria-pressed", String(state.patternMode === "chain"));
    }
  }
  if (cur.patternSwitchMode !== target.patternSwitchMode) {
    state.patternSwitchMode = target.patternSwitchMode === "finish" ? "finish" : "immediate";
    const btn = el("pattern-switch");
    if (btn) {
      btn.innerHTML = state.patternSwitchMode === "finish" ? ICON_FINISH : ICON_NOW;
      btn.setAttribute("aria-pressed", String(state.patternSwitchMode === "finish"));
    }
  }
  if (!sameTree(cur.patternRepeats, target.patternRepeats)) {
    for (let i = 0; i < PATTERN_COUNT; i++) {
      state.patternRepeats[i] = Number(target.patternRepeats?.[i]) || 1;
    }
    syncRepeatsUI();
  }
  let metersMoved = false;
  if (!sameTree(cur.patternMeters, target.patternMeters)) {
    for (let i = 0; i < PATTERN_COUNT; i++) {
      const src = target.patternMeters?.[i];
      state.patternMeters[i] = (src && parseMeter(`${src.num}/${src.den}`)) || { num: 4, den: 4 };
    }
    // Derived, exactly as applySet derives it: any slot differing from pattern
    // 1's counts as customized, so later edits to #1 don't clobber it.
    const m0 = state.patternMeters[0];
    for (let i = 0; i < PATTERN_COUNT; i++) {
      const mi = state.patternMeters[i];
      state.patternMeterCustomized[i] = i !== 0 && (mi.num !== m0.num || mi.den !== m0.den);
    }
    syncMeterUI();
    metersMoved = true;
  }
  if (!sameTree(cur.macroPads, target.macroPads)) applyMacroPads(target.macroPads);
  return metersMoved;
}

/**
 * Put one track back without rebuilding it. Every branch is guarded on the
 * field having actually moved — after `shareStructure` most of them are one
 * pointer comparison — because this runs on a sequencer that may be playing.
 * @param {Track} t
 */
function restoreTrackInPlace(t, a, b) {
  if (a === b) return { grid: false, sound: false, names: false };
  let grid = false, sound = false, names = false;

  if (!sameTree(a.patterns, b.patterns)) {
    const n = Math.min(PATTERN_COUNT, b.patterns?.length ?? 0);
    for (let i = 0; i < n; i++) {
      if (sameTree(a.patterns?.[i], b.patterns[i])) continue;
      // clonePattern is THE one place a pattern is copied (state.js): it fills
      // in any lane the snapshot predates rather than leaving it undefined.
      t.patterns[i] = clonePattern(b.patterns[i]);
    }
    // The live step arrays alias the pattern object that was just replaced, and
    // t.length / t.accents come off it too.
    aliasPattern(t, state.activePattern);
    grid = true;
  }

  if (a.name !== b.name) {
    t.name = b.name;
    const nameEl = t.el?.querySelector(".sq-track__name");
    if (nameEl) nameEl.value = b.name;
    names = true;
  }
  if (a.muted !== b.muted) {
    t.muted = !!b.muted;
    t.el?.classList.toggle("is-muted", t.muted);
    applyBusMute(t);
    refreshNoiseBeds();
  }
  if (a.soloed !== b.soloed) {
    t.soloed = !!b.soloed;
    t.el?.classList.toggle("is-soloed", t.soloed);
    t.el?.querySelector(".sq-track__solo")?.setAttribute("aria-pressed", String(t.soloed));
    refreshNoiseBeds();
  }
  if (a.glide !== b.glide) {
    t.glide = b.glide;
    const g = t.el?.querySelector(".sq-track__glide");
    if (g) g.value = b.glide;
    t.voice?.setGlide?.(b.glide);
  }
  if (a.speed !== b.speed) {
    t.speed = b.speed ?? 1;
    t.speedAccum = 0;
    const s = t.el?.querySelector(".sq-track__speed");
    if (s) s.value = String(t.speed);
  }
  if (a.density !== b.density) {
    t.density = b.density ?? 0.5;
    paintDiceDensity(t);
  }
  if (a.isDrumKit !== b.isDrumKit) t.isDrumKit = !!b.isDrumKit;
  if (a.pitchLock !== b.pitchLock) t.pitchLock = b.pitchLock !== false;
  if (a.sampleSpeedMode !== b.sampleSpeedMode) {
    t.sampleSpeedMode = b.sampleSpeedMode ?? "native";
    applySampleSpeed(t);
  }
  if (a.sliceOn !== b.sliceOn || a.sliceBase !== b.sliceBase
      || a.slicePlayMode !== b.slicePlayMode || a.sliceSensitivity !== b.sliceSensitivity
      || !sameTree(a.slices, b.slices)) {
    t.slices = Array.isArray(b.slices) ? b.slices.slice() : [];
    t.sliceOn = !!b.sliceOn;
    t.sliceBase = b.sliceBase ?? 60;
    t.slicePlayMode = b.slicePlayMode === "toend" ? "toend" : "region";
    t.sliceSensitivity = b.sliceSensitivity ?? 0.5;
    grid = true;
  }
  if (!sameTree(a.sampleDefaults, b.sampleDefaults)) {
    t.sampleDefaults = { start: 0, end: 1, fadeIn: 0, fadeOut: 0, loopMode: "off", ...(b.sampleDefaults || {}) };
  }
  if (a.uploadFileName !== b.uploadFileName) t.uploadFileName = b.uploadFileName || null;
  if (a.promptText !== b.promptText) t.promptText = b.promptText || "";
  if (a.soundPromptText !== b.soundPromptText) t.soundPromptText = b.soundPromptText || "";

  if (!sameTree(a.euclid, b.euclid)) {
    t.euclid = b.euclid ? { ...b.euclid } : null;
    t._euclidMod = null;                  // live overrides are never in a snapshot
    renderEuclidPanel(t);
    refreshEuclidUI(t);
    grid = true;
  }
  if (!sameTree(a.chance, b.chance)) {
    t.chance = cloneChance(b.chance);
    t._chanceMod = null;
    t._chancePlan = null;                 // rebuilt on demand from the seed
    renderChancePanel(t);
    refreshChanceUI(t);
    grid = true;
  }
  if (!sameTree(a.baseSound, b.baseSound)) t.baseSound = deepCopy(b.baseSound);

  // The sidechain source is resolved from its INDEX, not from the raw id the
  // snapshot's `comp` carries — `createTrack` hands out fresh ids every time
  // applySet rebuilds the session, so that id names nothing once an undo has
  // crossed one of those, and a dead id is worse than it looks: the compressor
  // finds no source node and quietly self-compresses while the panel goes on
  // claiming a sidechain. Same rule, and the same reason, as applySet's.
  // (`compSourceIndex` itself is a REBUILD_KEY, so it cannot have moved here —
  // this only rewrites the spelling of a source that is still the same track.)
  const comp = b.comp ? { ...b.comp } : undefined;
  if (comp) {
    const k = Number.isInteger(b.compSourceIndex) ? b.compSourceIndex : -1;
    const src = k >= 0 ? state.tracks[k] : null;
    comp.source = src && src !== t ? String(src.id) : "self";
  }

  // The live sound, through the same diffed installer a p-lock recall uses —
  // it is already the thing in this app that knows how to change a sound under
  // a running transport without re-registering 130 LFOs or rebuilding a reverb.
  // The snapshot carries the whole mod matrix, so its "a key that isn't here
  // means not modulated" fallback lands on the same values either way.
  if (applyPatternSound(t, {
    params: b.params, filter: b.filter, eq: b.eq, comp,
    fxConfig: b.fxConfig, lfoConfig: b.lfoConfig,
  })) sound = true;

  return { grid, sound, names };
}

/** Install a snapshot onto the live engine. */
function restore(target) {
  const cur = live;
  if (!target || cur === target) return;
  restoring = true;
  try {
    if (needsFullApply(cur, target)) {
      // applySet keeps a reference to a few of the blob's objects (the sample
      // source, the custom-patch config) and rewrites legacy names in place, so
      // it gets a copy — the snapshot has to survive being loaded more than
      // once, which is exactly what redo asks of it.
      const blob = deepCopy(target);
      blob.activePattern = state.activePattern;   // the view stays put (see snapshot)
      applySet(blob);
    } else {
      const metersMoved = restoreGlobals(cur, target);
      let grid = metersMoved, sound = false, names = false;
      state.tracks.forEach((t, i) => {
        const r = restoreTrackInPlace(t, cur.tracks[i], target.tracks[i]);
        if (metersMoved && !r.grid) aliasPattern(t, state.activePattern);  // accents follow the meter
        if (r.grid || metersMoved) { renderStepGrid(t); refreshRollIfOpen(t); refreshAutIfOpen(t); }
        if (r.sound) refreshPatternSoundUI(t);
        // Lanes belong to the pattern, so the dots beside the labels move with
        // the pattern data whether or not the sound did.
        if (r.grid || r.sound) refreshParamIndicators(t);
        if (r.sound) updateGranularSpeedEnabled(t);
        grid = grid || r.grid;
        sound = sound || r.sound;
        names = names || r.names;
      });
      // Track names are options in every other track's send and sidechain
      // pickers, so a renamed track has to be re-offered there.
      if (names) { refreshOutputSelects(); refreshCompSourceDropdowns(); }
      if (grid) { refreshAllPatternLockUI(); renderPatternGrid(); }
    }
  } finally {
    restoring = false;
  }
  // Not `live = target`: applySet normalizes (clamping, dropping a send that
  // would feed back, moving the buses to the bottom), and the in-place path
  // leaves anything it decided not to touch. Reading the engine back is the
  // only honest answer to "what state is it in now", and it keeps the next
  // fold comparing against something true.
  live = snapshot(target);
  clearPending();
}

// ---- when a snapshot is taken -------------------------------------------

function clearPending() {
  clearTimeout(settleTimer);
  settleTimer = null;
  pending = { label: "", key: null };
}

/**
 * The gesture has settled: ask the session whether it changed, and if it did,
 * that was an edit. Everything about which edit it was is a label for the
 * tooltip — the stack does not care.
 */
function checkForEdit() {
  // Cleared as well as nulled: undo() calls this early to bank a gesture that
  // has not settled yet, and the timer it was waiting on is still armed.
  clearTimeout(settleTimer);
  settleTimer = null;
  cancelIdle();
  if (restoring) return;
  const { label, key } = pending;
  pending = { label: "", key: null };
  const fresh = snapshot(live);
  if (fresh === live) return;            // nothing moved — no entry, no cost
  const r = stack.record(fresh, { label, key });
  live = r.snap;
  if (r.status !== "unchanged") refreshHistoryUI();
}

function scheduleCheck(label, key) {
  if (restoring) return;
  // The label of the thing that STARTED the gesture is the one that names it:
  // a knob drag ends with the pointer coming up somewhere else entirely.
  if (!pending.label && label) pending.label = label;
  if (key != null) pending.key = key;
  clearTimeout(settleTimer);
  cancelIdle();
  settleTimer = setTimeout(settle, SETTLE_MS);
}

// The snapshot is a few milliseconds of synchronous work (serializeSet plus
// the structural fold), which matters only while the transport runs: there it
// is taken out of the same lookahead the notes are scheduled in, 420ms after
// every knob release. So while playing it waits for an idle slot, with a
// deadline so a busy tab still gets its entry. Stopped, it runs at once.
function settle() {
  settleTimer = null;
  if (state.playing && typeof requestIdleCallback === "function") {
    idleHandle = requestIdleCallback(() => { idleHandle = null; checkForEdit(); }, { timeout: 1500 });
  } else {
    checkForEdit();
  }
}
function cancelIdle() {
  if (idleHandle == null) return;
  try { cancelIdleCallback(idleHandle); } catch {}
  idleHandle = null;
}

// Tooltips break their first clause with a colon or a full stop (they used to
// use an em dash), so both end the name here.
const firstClause = (s) => String(s || "").split(/[:.(]/)[0].trim().slice(0, 40);

/** A short name for the control an event landed on, for the tooltip. Reads the
 *  same places the right-click parameter menu does, in the same order, so the
 *  two call a control by the same name. */
function controlName(ctl) {
  for (const cls of ctl.classList) if (CONTROL_LABELS[cls]) return CONTROL_LABELS[cls];
  const wrap = ctl.closest(".sq-field, .sq-fx__ctl, .sq-contagion__f, .sq-hexop__f, label");
  const text = wrap?.querySelector("span")?.textContent?.trim()
            || (wrap?.tagName === "LABEL" ? wrap.textContent?.trim() : "");
  if (text) return firstClause(text);
  return ctl.getAttribute("aria-label") || firstClause(ctl.title) || "";
}

/** What to call the edit an event begins. Best-effort and cosmetic: an entry
 *  with no label is still an entry, it just says "undo" on its own. */
function labelForEvent(e) {
  const target = e.target instanceof Element ? e.target : null;
  if (!target) return "";
  const ctl = controlFromEventTarget(target);
  if (ctl) return controlName(ctl);
  const btn = target.closest("button");
  if (btn) {
    return btn.querySelector(".sq-btn__label")?.textContent?.trim()
        || btn.getAttribute("aria-label")
        || firstClause(btn.textContent)
        || firstClause(btn.title);
  }
  // The grid as well as the cell: painting a step re-renders the row under the
  // pointer, so by the time the pointer comes up the cell it went down on no
  // longer exists and the event lands on the container.
  if (target.closest(".sq-steps, .sq-step")) return "step";
  if (target.closest(".sq-roll__grid, .sq-roll__cells")) return "note";
  if (target.closest("#pattern-grid, .sq-pattern__cell")) return "pattern";
  return "";
}

function onInteraction(e) {
  if (restoring) return;
  if (e.target instanceof Element && e.target.closest(".sq-history")) return;
  // Only a settled control coalesces: a knob dragged in three goes is one
  // entry, while three clicks on the dice are three rolls to step back through.
  const key = (e.type === "input" || e.type === "change") ? e.target : null;
  // Only the first event of a gesture names it (scheduleCheck keeps the first
  // label), so the DOM walk that finds the name is skipped for the sixty
  // `input` events a second a knob drag sends after it.
  scheduleCheck(pending.label ? "" : labelForEvent(e), key);
}

/** Text fields keep the browser's own undo — retyping a track name is the
 *  field's history, not the song's, and stealing ⌘Z there would be wrong. */
function isTypingTarget(node) {
  const tag = node?.tagName;
  if (tag === "TEXTAREA") return true;
  if (tag === "INPUT") {
    const type = (node.type || "text").toLowerCase();
    return !["range", "checkbox", "radio", "button", "submit", "color"].includes(type);
  }
  return !!node?.isContentEditable;
}

function onKeyDown(e) {
  if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
  const k = (e.key || "").toLowerCase();
  if (k !== "z" && k !== "y") return;
  if (isTypingTarget(e.target)) return;
  e.preventDefault();
  if (k === "y" || e.shiftKey) redo(); else undo();
}

// ---- the two buttons ----------------------------------------------------

function refreshHistoryUI() {
  const u = el("undo"), r = el("redo");
  if (u) {
    u.disabled = !stack.canUndo();
    const what = stack.undoLabel();
    u.title = (stack.canUndo() ? `undo ${what}`.trim() : "nothing to undo") + " (ctrl/⌘ Z)";
  }
  if (r) {
    r.disabled = !stack.canRedo();
    const what = stack.redoLabel();
    r.title = (stack.canRedo() ? `redo ${what}`.trim() : "nothing to redo") + " (ctrl/⌘ shift Z)";
  }
}

// ---- the public surface -------------------------------------------------

export function canUndo() { return stack.canUndo(); }
export function canRedo() { return stack.canRedo(); }

export function undo() {
  // A gesture that has not been checked yet is an edit that is not on the stack
  // — take it now, or pressing undo the moment you let go of a knob would step
  // past the drag to whatever came before it.
  if (settleTimer) checkForEdit();
  const step = stack.undo();
  if (!step) { setStatus("nothing to undo"); return false; }
  restore(step.snap);
  setStatus(step.label ? `undo — ${step.label}` : "undo");
  refreshHistoryUI();
  return true;
}

export function redo() {
  if (settleTimer) checkForEdit();
  const step = stack.redo();
  if (!step) { setStatus("nothing to redo"); return false; }
  restore(step.snap);
  setStatus(step.label ? `redo — ${step.label}` : "redo");
  refreshHistoryUI();
  return true;
}

/**
 * Forget everything and start from where the engine is now. The undo stack is
 * per session, not per page: a song that arrives from the shell replaces the
 * one that was open, and being able to step from the middle of the new song
 * back into the old one's patterns would be a way to lose both.
 */
export function resetHistory() {
  clearPending();
  live = snapshot(null);
  stack.baseline(live, "");
  refreshHistoryUI();
}

/**
 * Start watching. Called once from init(), after the starter tracks exist, so
 * the floor of the stack is a session rather than an empty one.
 */
export function initHistory() {
  if (started) return;
  started = true;

  const u = el("undo"), r = el("redo");
  if (u) { u.innerHTML = ICON_UNDO; u.addEventListener("click", undo); }
  if (r) { r.innerHTML = ICON_REDO; r.addEventListener("click", redo); }

  // Capture phase, so an edit still registers when the handler that made it
  // stops the event from bubbling (the step grid and the piano roll both do).
  // `click` as well as `pointerup`, which is not redundant: a button activated
  // from the keyboard fires only the former, and so does an `el.click()` from
  // code — the shell's chrome and the engine's own buttons reach each other
  // that way. A trigger that turns out to have changed nothing costs one walk
  // and no entry, so the list is allowed to be generous.
  for (const ev of ["pointerup", "pointercancel", "click", "keyup", "change", "input", "drop"]) {
    document.addEventListener(ev, onInteraction, true);
  }
  document.addEventListener("keydown", onKeyDown, true);

  // A whole session arriving at once — `new`, a song opened from the shell, a
  // ?s= share link — is not an edit in the middle of one. The first of those to
  // land before anything has been edited is the session the stack should be
  // measuring from (a share link loads a beat or two after boot, and undoing
  // back to the starter tracks nobody asked for would be nonsense); after that
  // it is a step like any other, which is what makes an accidental `new`
  // recoverable.
  const onSessionArrived = (label) => {
    if (restoring) return;
    if (stack.size <= 1) { resetHistory(); return; }
    pending.label = label;              // this names the step, not whatever was clicked
    scheduleCheck(label, null);
  };
  window.addEventListener("seqbaby:setapplied", () => onSessionArrived("open song"));
  window.addEventListener("seqbaby:newset", () => onSessionArrived("new song"));

  resetHistory();
}
