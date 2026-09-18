// ---- writing a session onto a LIVE engine -------------------------------
//
// `applySet` (session.js) is how a song arrives: it stops the transport, tears
// down every track and voice, and builds the whole thing again. That is right
// for opening a song and wrong for every case where the session you are
// holding is *nearly* the one that is playing — an undo, and the compose
// panel's audition, which exists so a track can be dropped into a playing
// session without the playing stopping.
//
// So this module is the other half: the same session format, written onto the
// engine in place. Three pieces, in order of how much they cost.
//
//   applyGlobalsInPlace   tempo, swing, scale, the pattern meters / repeats,
//                         chain mode, the macro pads — every one guarded on
//                         having actually moved.
//   applyTrackInPlace     one track's patterns, fields and SOUND, the last
//                         through `applyPatternSound`, which is already the
//                         thing in this app that knows how to change a sound
//                         under a running transport without re-registering
//                         130 LFOs or rebuilding a reverb.
//   mergeSet              a whole session: the two above, plus the tracks
//                         that appeared, the ones that went, and the ones
//                         whose engine or sample changed under them.
//
// The first two were history.js's, which is why they read as a diff against a
// snapshot: they are exactly what an undo needs, and giving the merge a second
// copy of them is how the two would come to disagree about what putting a
// track back means. history.js still owns WHEN a session is written; this owns
// HOW.
//
// **A track that needs its voice rebuilt is removed and re-made**, through
// `loadTrackFromData` — session.js's own per-track reader, the one `applySet`
// uses. Rebuilding a voice in place would be a third loader; removing one
// track and making another costs a fraction of a session teardown and leaves
// every other track playing.

import { PATTERN_COUNT } from "./constants.js";
import { cloneChance, refreshChanceUI, renderChancePanel } from "./chance.js";
import { setStatus } from "./dom.js";
import { refreshEuclidUI, renderEuclidPanel } from "./euclid.js";
import { sameTree } from "./historyStore.js";
import { ICON_CHAIN, ICON_FINISH, ICON_NOW, ICON_REPEAT } from "./icons.js";
import { applySampleSpeed } from "./lfo.js";
import { applyMacroPads } from "./macro.js";
import { parseMeter } from "./meter.js";
import { refreshParamIndicators } from "./paramTargets.js";
import { updateGranularSpeedEnabled, updatePlaitsControlsVisibility } from "./params.js";
import { renderPatternGrid } from "./patternBar.js";
import { applyPatternSound, refreshAllPatternLockUI, refreshPatternSoundUI } from "./patternSound.js";
import { refreshAutIfOpen, refreshRollIfOpen } from "./pianoRoll.js";
import { applyBusMute, paintDiceDensity, placeBusesLast } from "./render.js";
import { syncScaleUI } from "./scaleUI.js";
import { loadTrackFromData, migrateTrackData, serializeSet, trackShellFor } from "./session.js";
import { migrateLegacyNames, validateSet } from "./sessionFormat.js";
import { applyCompressorConfig, refreshAllTrackOutputs, refreshCompSourceDropdowns, refreshNoiseBeds, refreshOutputSelects, wouldFeedback } from "./signal.js";
import { aliasPattern, clonePattern, state, syncMeterUI, syncRepeatsUI } from "./state.js";
import { renderStepGrid } from "./stepGrid.js";
import { createTrack, removeTrack } from "./track.js";
import { requestMidiIfNeeded } from "./transport.js";

/** @typedef {import("./types.js").Track} Track */

// A track field `applyTrackInPlace` cannot write: putting it back needs the
// voice rebuilt, the graph re-wired or the track's DOM rebuilt. What to do
// about that is the caller's: history.js falls back to `applySet` wholesale,
// while `mergeSet` below remakes the one track (see MERGE_REBUILD_KEYS).
export const TRACK_REBUILD_KEYS = [
  "engineKey", "customConfig", "wavetable", "sampleSource",
  "uploadAudio", "uploadAudioMime", "granularSample", "midi",
  "outIndex", "compSourceIndex",
];

const el = (id) => document.getElementById(id);
export const deepCopy = (v) => (v == null ? v
  : typeof structuredClone === "function" ? structuredClone(v)
  : JSON.parse(JSON.stringify(v)));

/**
 * Write a session's globals onto the live engine, each guarded on having
 * actually moved.
 * @param {Object} cur what the engine holds now, serialized
 * @param {Object} target what it should hold
 * @param {{pads?: boolean, order?: Track[]}} [opts] `pads: false` leaves the
 *   macro pads alone: their assignments are indices into `target`'s track list,
 *   and a merge cannot resolve those until it has finished making the tracks.
 * @returns {boolean} whether the pattern meters moved (the accents follow them,
 *   so every track has to be re-aliased)
 */
export function applyGlobalsInPlace(cur, target, { pads = true, order = state.tracks } = {}) {
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
  if (pads && !sameTree(cur.macroPads, target.macroPads)) applyMacroPads(target.macroPads, order);
  return metersMoved;
}

/**
 * Write one serialized track onto a live track without rebuilding it. Every
 * branch is guarded on the field having actually moved — for an undo, where
 * `a` and `b` have been through `shareStructure`, most of them are one pointer
 * comparison — because this runs on a sequencer that may be playing.
 *
 * @param {Track} t the live track
 * @param {Object} a what it holds now, serialized
 * @param {Object} b what it should hold
 * @param {(i: number) => Track} resolveTrack what a cross-track INDEX in `b`
 *   names. `state.tracks` for an undo, where the session is already built; the
 *   tracks the merge is making, for a merge, since the one being pointed at may
 *   have been created a moment ago and not yet be where it will end up.
 * @returns {{grid: boolean, sound: boolean, names: boolean}} what has to repaint
 */
export function applyTrackInPlace(t, a, b, resolveTrack = (i) => state.tracks[i]) {
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
    const src = k >= 0 ? resolveTrack(k) : null;
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
// ---- a whole session, onto a playing engine -----------------------------

// What `applyTrackInPlace` cannot put back, so the track is removed and made
// again from the blob. `TRACK_REBUILD_KEYS` minus the two cross-track ones:
// history falls back to `applySet` for a re-routed send because the track it
// now points at may itself be being rebuilt, but a merge resolves every send
// in a pass of its own once all the tracks exist, and `routeTrackOutput`
// re-points a live output under a fade. Re-pointing is not rebuilding.
const MERGE_REBUILD_KEYS = TRACK_REBUILD_KEYS
  .filter(k => k !== "outIndex" && k !== "compSourceIndex");

function needsRebuild(a, b) {
  if (!a) return true;
  return MERGE_REBUILD_KEYS.some(k => !sameTree(a[k], b[k]));
}

/**
 * Which live track each track of the incoming session is. Identity is
 * `engineKey` plus `name`, which is what the compose tools address a track by
 * and what a person reads down the left of the studio.
 *
 * Three passes, cheapest first, and the first one is the case that matters: a
 * session that came out of this studio, went to the model and came back with a
 * track appended matches straight down the line, so nothing that was already
 * playing is touched at all. The second catches a track that moved or had one
 * inserted above it; the third hands whatever is left its old slot in order,
 * which is what makes a rename or an engine change an edit to a track rather
 * than one track going and another arriving.
 *
 * @param {Object[]} cur serialized current tracks @param {Object[]} next
 * @returns {number[]} for each `next` index, its `cur` index, or -1 for a track
 *   that is new
 */
export function alignTracks(cur, next) {
  const key = (t) => JSON.stringify([t?.engineKey ?? null, t?.name ?? null]);
  const used = new Array(cur.length).fill(false);
  const out = new Array(next.length).fill(-1);
  for (let i = 0; i < next.length; i++) {
    if (i < cur.length && !used[i] && key(cur[i]) === key(next[i])) { out[i] = i; used[i] = true; }
  }
  for (let i = 0; i < next.length; i++) {
    if (out[i] >= 0) continue;
    const j = cur.findIndex((c, k) => !used[k] && key(c) === key(next[i]));
    if (j >= 0) { out[i] = j; used[j] = true; }
  }
  let k = 0;
  for (let i = 0; i < next.length; i++) {
    if (out[i] >= 0) continue;
    while (k < cur.length && used[k]) k++;
    if (k < cur.length) { out[i] = k; used[k] = true; }
  }
  return out;
}

/** State and DOM to the order the session lists, both at once — `state.tracks`
 *  is what the transport walks and what every cross-track INDEX is counted
 *  along, so the two can never be allowed to disagree (render.js's
 *  `placeBusesLast` moves them together for the same reason, and runs after
 *  this to have the last word). */
function setTrackOrder(order) {
  if (order.length !== state.tracks.length) return;
  if (order.every((t, i) => t === state.tracks[i])) return;
  state.tracks = [...order];
  const host = document.getElementById("tracks");
  const focused = document.activeElement;
  if (host) for (const t of order) if (t.el) host.appendChild(t.el);
  if (focused instanceof HTMLElement && document.activeElement !== focused && host?.contains(focused))
    focused.focus({ preventScroll: true });
}

/**
 * Write a serialized session onto the live engine WITHOUT stopping it.
 *
 * Everything `applySet` does, minus the teardown: the transport keeps its
 * clock, the tracks that did not change keep the voices they are playing with,
 * and a track that appeared joins on the step everyone else is on
 * (`createTrack` sets `trackTick` from `state.tick` for exactly this).
 *
 * Two things it deliberately does NOT take from the blob:
 *
 * - **Which pattern you are looking at.** `activePattern` is the view, and
 *   moving the playhead to another pattern mid-bar is not a change to the
 *   song. The same call the undo stack makes (history.js), for the same
 *   reason.
 * - **Whether the transport is running.** That is not in the format at all;
 *   `applySet` stops it as a consequence of tearing down, never as a decision.
 *
 * @param {Object} s a session from serializeSet (or the song builder)
 * @returns {{version: number, warnings: string[], added: number, removed: number, rebuilt: number}}
 */
export function mergeSet(s) {
  if (!s) return null;
  // Before anything is written, as in applySet: a blob that fails halfway
  // through this one leaves a session that is half of each.
  const check = validateSet(s);
  for (const w of check.warnings) console.warn(`[seqbaby] merge: ${w}`);
  if (!check.ok)
    throw new Error(`Not a readable seqbaby session: ${check.errors.join("; ")}`);
  // A copy, because the blob belongs to the caller — an audition holds the
  // session it is previewing so it can be reverted to, migrateLegacyNames
  // rewrites in place, and loadTrackFromData keeps references into it.
  const target = deepCopy(s);
  migrateLegacyNames(target);

  // What is playing right now, in the same format, so every comparison below
  // is like for like. serializeSet flushes the live sound into whichever store
  // owns the pattern first, which is what makes the sound diff honest.
  const cur = serializeSet();
  const curTracks = cur.tracks || [];
  const nextTracks = (target.tracks || []).map(migrateTrackData);
  const liveTracks = [...state.tracks];          // parallel to curTracks, by index
  const match = alignTracks(curTracks, nextTracks);

  // The pads are held back: their assignments are indices into the incoming
  // session's track list, so they cannot be resolved until it has been made.
  const metersMoved = applyGlobalsInPlace(cur, target, { pads: false });

  // The tracks nothing points at any more. First, so the send and sidechain
  // pickers are rebuilt around what is really there before anything new is
  // offered a place in them.
  const kept = new Set(match.filter(k => k >= 0));
  let removed = 0;
  for (let k = 0; k < liveTracks.length; k++) {
    if (kept.has(k)) continue;
    removeTrack(liveTracks[k]);
    removed++;
  }

  // Pass one: every track in the incoming session gets a live track. One whose
  // engine or sample moved is remade rather than patched (MERGE_REBUILD_KEYS);
  // everything else keeps the voice it is playing with.
  let added = 0, rebuilt = 0;
  const fresh = new Array(nextTracks.length).fill(false);
  const made = nextTracks.map((td, i) => {
    const k = match[i];
    let t = k >= 0 ? liveTracks[k] : null;
    if (t && needsRebuild(curTracks[k], td)) { removeTrack(t); t = null; rebuilt++; }
    else if (!t) added++;
    if (t) return t;
    fresh[i] = true;
    const built = createTrack(trackShellFor(td));
    loadTrackFromData(built, td);
    return built;
  });

  // Pass two: the tracks that stayed, updated in place. Only now, because a
  // sidechain source is stored as an index into the incoming session and the
  // track it names may have been made a moment ago in the loop above.
  let grid = metersMoved, sound = false, names = false;
  nextTracks.forEach((td, i) => {
    if (fresh[i]) return;
    const t = made[i];
    const r = applyTrackInPlace(t, curTracks[match[i]], td, (j) => made[j]);
    if (metersMoved && !r.grid) aliasPattern(t, state.activePattern);   // accents follow the meter
    if (r.grid || metersMoved) { renderStepGrid(t); refreshRollIfOpen(t); refreshAutIfOpen(t); }
    if (r.sound) { refreshPatternSoundUI(t); updateGranularSpeedEnabled(t); }
    if (r.grid || r.sound) refreshParamIndicators(t);
    // The four sliders are relabelled per engine, and a renamed track says so
    // in its own panels too.
    if (r.names) updatePlaitsControlsVisibility(t);
    grid = grid || r.grid; sound = sound || r.sound; names = names || r.names;
  });

  // Pass three: the cross-track references, now that every track exists — both
  // are indices into the incoming session (serializeSet), so they can only be
  // resolved against the tracks it made, in its order.
  nextTracks.forEach((td, i) => {
    const t = made[i];
    const j = Number.isInteger(td.outIndex) ? td.outIndex : -1;
    const bus = j >= 0 ? made[j] : null;
    t.out = bus && bus !== t && bus.engineKey === "bus" ? String(bus.id) : "master";
    // A fresh track's compressor still carries whatever raw id the blob held;
    // the ones that stayed had theirs resolved by applyTrackInPlace above.
    if (!fresh[i]) return;
    const k = Number.isInteger(td.compSourceIndex) ? td.compSourceIndex : -1;
    const src = k >= 0 ? made[k] : null;
    t.comp.source = src && src !== t ? String(src.id) : "self";
  });
  // A hand-edited song, or a bus re-engined since it was written, can still
  // describe a loop. Web Audio would build it quite happily.
  for (const t of state.tracks) {
    if (t.out !== "master" && wouldFeedback(t, t.out)) t.out = "master";
  }

  // The order the session lists, then the buses back to the bottom. Both after
  // the index passes above, for applySet's reason: every cross-track reference
  // has to be an id before anything is allowed to move.
  if (made.length === state.tracks.length) setTrackOrder(made);
  placeBusesLast();

  refreshOutputSelects();
  refreshCompSourceDropdowns();
  if (state.ready) {
    refreshAllTrackOutputs();
    for (const t of state.tracks) { applyBusMute(t); applyCompressorConfig(t); }
    refreshNoiseBeds();
  }
  // MIDI access is lazy, and this merge may have introduced the first MIDI track.
  requestMidiIfNeeded();
  // The pads store their assignments by index into the incoming session too.
  if (!sameTree(cur.macroPads, target.macroPads)) applyMacroPads(target.macroPads, made);
  if (names) { refreshOutputSelects(); refreshCompSourceDropdowns(); }
  if (grid || added || removed || rebuilt) { refreshAllPatternLockUI(); renderPatternGrid(); }
  setStatus(added || removed || rebuilt
    ? `merged: ${added} added, ${removed} removed, ${rebuilt} rebuilt`
    : "merged");
  return { version: check.version, warnings: check.warnings, added, removed, rebuilt };
}
