// ---- recorded live sets: capture a performance, play it back ------------------
//
// A set is a starting picture of the studio and a timeline of what was done to
// it while the transport ran (the format is setFormat.js). This file is both
// halves: the recorder, in the studio, and the replay, in the set player
// (app/set/[id]), which drives a hidden-chrome studio through window.seqbaby.
//
// **The clock is the transport's step, not the wall.** The transport calls
// one hook at the top of every step (setStepHook, transport.js). Anything done
// between two steps first reaches the sequencer at the next one, so an event
// is stamped with the step it was in place for (`state.tick`, which already
// points at the next step between callbacks) and how far through the step
// before it it happened (`frac`). Played back, the events for step T are laid
// down at the top of step T at the latest, and those with a `frac` on a timer
// from the top of step T-1, so a knob turned through a step turns through it.
// A replay is therefore in step with the music it is replaying whatever the
// tempo does, and pausing it is stopping the clock.
//
// **What a step can change is sampled, not logged.** Which clip each track is
// on, stopped or frozen or queued, mute and solo, the scene and its queue, the
// mix's crossfader, fade, tempo slider and every deck's state: read whole at
// the top of every step and diffed (setFormat.js's diffPerf). Every way of
// doing any of those (a click, a queue landing on a bar line, a chain moving
// on, a fade, window.seqbaby) is caught without being told, and a replay that
// writes the sample back at the same step is the recording, not a guess at it.
//
// **What a step cannot change is logged**: a control moved (`ctl`, the knob's
// own input event, played back through the same event), the song edited
// (`patch`, jamSync's diff, written with mergeSet as a jam peer's is), a havoc
// pad played (`macro`), a song loaded onto a deck or taken off (`deck`,
// `eject`) and a deck landed, promoted or both kept (`mix`).

import { setStatus } from "./dom.js";
import { pinAutomated } from "./history.js";
import { applySessionPatch, diffSession } from "./jamSync.js";
import { deepCopy, mergeSet } from "./liveSet.js";
import { onMacroGesture, playMacroGesture } from "./macro.js";
import {
  captureMixRuntime, deckReady, ejectDeckB, getDeck, keepBothDecks, landDeckB, loadDeckB, mergeDeckB,
  mixDecks, onMixEvent, promoteDeckById, restoreMixRuntime, serializeDeckB,
} from "./mix.js";
import { trackForControl } from "./paramTargets.js";
import { setPatternMode } from "./patternBar.js";
import { applySet, serializeSet } from "./session.js";
import { SET_FORMAT, applyPerf, diffPerf, eventIndexAt, secondsAtStep } from "./setFormat.js";
import { refreshNoiseBeds, releaseSilencedTracks } from "./signal.js";
import { paintTrackSlotBadge, state, trackSlot } from "./state.js";
import { announceClips, launchClip } from "./clips.js";
import { setStepHook, startPlayback, stopPlayback } from "./transport.js";
import { setView } from "./views.js";
import { setFill } from "./perform.js";
import { renderPatternGrid } from "./patternBar.js";

// ---- a track, named the same on both sides ----------------------------------

/** `deck:n`, the n-th track of deck A (the song) or of a deck, or `bus:deck`. */
function trackRefs() {
  const map = new Map();
  const counts = {};
  for (const t of state.tracks) {
    if (t._deckBus) { map.set(t, `bus:${t._deckBus}`); continue; }
    const d = t._deck || "a";
    if (d === "~") continue;                         // on its way out
    const n = counts[d] = (counts[d] ?? -1) + 1;
    map.set(t, `${d}:${n}`);
  }
  return map;
}
function refOf(t) { return trackRefs().get(t) ?? null; }
function trackOf(ref) {
  for (const [t, r] of trackRefs()) if (r === ref) return t;
  return null;
}

// ---- the sampled state -------------------------------------------------------

function capturePerf() {
  const tracks = {};
  for (const [t, ref] of trackRefs()) {
    tracks[ref] = {
      slot: trackSlot(t),
      off: !!t._clipOff,
      fz: !!t._frozen,
      q: t._queuedSlot ?? null,
      qp: !!t._queuePhrase,
      mute: !!t.muted,
      solo: !!t.soloed,
    };
  }
  const mix = captureMixRuntime();
  const decks = mix ? mix.decks : null;
  if (mix) delete mix.decks;
  return {
    scene: state.activePattern,
    queued: state.queuedPattern ?? null,
    qop: !!state._queueOnPattern,
    mode: state.patternMode,
    view: state.view,
    fill: !!state.fill,          // the fill button (perform.js), held or latched
    tracks, mix, decks,
  };
}

/** The transport's counters: not diffed, written with a perf event that moves a clip. */
function captureCounters() {
  const tracks = {};
  for (const [t, ref] of trackRefs()) tracks[ref] = [t.trackTick ?? 0, t.speedAccum ?? 0];
  return {
    tick: state.tick,
    barTick: state.barTick ?? 0,
    chain: state.chainBarCount ?? 0,
    origin: state._countOrigin ?? 0,
    arrBar: state.arrBar ?? 0,
    arrOrigin: state._arrOrigin ?? 0,
    tracks,
  };
}

function restoreCounters(c, { tick = false } = {}) {
  if (!c) return;
  if (tick) state.tick = c.tick;
  state.barTick = c.barTick;
  state.chainBarCount = c.chain;
  state._countOrigin = c.origin;
  state.arrBar = c.arrBar;
  state._arrOrigin = c.arrOrigin;
  for (const [ref, v] of Object.entries(c.tracks || {})) {
    const t = trackOf(ref);
    if (t && Array.isArray(v)) { t.trackTick = v[0]; t.speedAccum = v[1]; }
  }
}

function clickTrackButton(t, cls) {
  const b = t.el?.querySelector(cls);
  if (b) b.click();
}

/** Write a sampled state (whole, or the part that moved) onto the engine. */
function restorePerf(p, at) {
  if (!p) return;
  let silence = false;
  let repaint = false;
  for (const [ref, d] of Object.entries(p.tracks || {})) {
    if (!d) continue;
    const t = trackOf(ref);
    if (!t) continue;
    if ("slot" in d && d.slot !== trackSlot(t)) { launchClip(t, d.slot, { deferUi: !!state.playing }); repaint = true; }
    if ("off" in d) { if (d.off && !t._clipOff) silence = true; t._clipOff = d.off; repaint = true; }
    if ("fz" in d) t._frozen = d.fz;
    if ("q" in d) t._queuedSlot = d.q;
    if ("qp" in d) t._queuePhrase = d.qp;
    if ("mute" in d && !!t.muted !== d.mute) clickTrackButton(t, ".sq-track__mute");
    if ("solo" in d && !!t.soloed !== d.solo) clickTrackButton(t, ".sq-track__solo");
    paintTrackSlotBadge(t);
  }
  if ("scene" in p && p.scene != null && p.scene !== state.activePattern) { state.activePattern = p.scene; repaint = true; }
  if ("queued" in p) { state.queuedPattern = p.queued; repaint = true; }
  if ("qop" in p) state._queueOnPattern = p.qop;
  // A set recorded before the fill was sampled has no `fill`, and leaves it alone.
  if ("fill" in p && !!p.fill !== !!state.fill) setFill(!!p.fill);
  if ("mode" in p && p.mode && p.mode !== state.patternMode) { try { setPatternMode(p.mode); } catch { state.patternMode = p.mode; } }
  if ("view" in p && p.view && p.view !== state.view && replay?.followView !== false) {
    // a view switch while playing would also switch the pattern mode at the
    // next bar line (views.js): the mode is sampled, so that is not asked for
    setView(p.view);
    state._viewSwitched = false;
  }
  if (p.mix || p.decks) restoreMixRuntime({ ...(p.mix || {}), decks: p.decks || {} }, (id) => id, at);
  if (silence) { releaseSilencedTracks(); refreshNoiseBeds(); }
  if (repaint) { announceClips(); try { renderPatternGrid(); } catch {} }
}

// ---- the session, as a diff --------------------------------------------------

function songSnapshot(prev) {
  const s = serializeSet();
  delete s.activePattern;
  return pinAutomated(prev, s);
}

/** Every deck's song, by id (a deck still loading has none yet). */
function deckSnapshots() {
  const out = {};
  for (const d of mixDecks()) {
    if (d.loading) continue;
    const s = serializeDeckB(d.id);
    if (s) { delete s.activePattern; out[d.id] = s; }
  }
  return out;
}

// ---- a starting point: read whole, written back ------------------------------

/** The studio as it is now: what a recording starts from, and what a fork carries. */
export function captureStart() {
  const session = serializeSet();
  const decks = [];
  for (const d of mixDecks()) {
    if (d.loading) continue;
    const s = serializeDeckB(d.id);
    if (s) decks.push({ id: d.id, title: d.title, clips: !!d.forClips, xf: d.xf ?? null, session: s });
  }
  return { session, decks, perf: capturePerf(), counters: captureCounters(), view: state.view };
}

/**
 * Put the studio where a starting point says: the song, then every deck (one
 * at a time, each under the id it had), then the mix's runtime and which clip
 * each track is on. The transport is stopped first and left stopped; the
 * counters are kept for the next play press (`pendingCounters`).
 * @param {any} start from captureStart
 * @param {{onProgress?: (msg: string) => void}} [opts]
 */
export async function restoreStart(start, { onProgress } = {}) {
  await stopPlayback();
  const blob = deepCopy(start.session);
  if (start.perf?.scene != null) blob.activePattern = start.perf.scene;
  applySet(blob);
  for (const [i, d] of (start.decks || []).entries()) {
    onProgress?.(`loading deck ${i + 1} of ${start.decks.length}: ${d.title || "untitled"}`);
    try {
      await loadDeckB(deepCopy(d.session), { title: d.title, clips: d.clips, xf: d.xf, id: d.id });
    } catch (e) {
      console.warn("[seqbaby] set: a deck would not load", e);
    }
  }
  restorePerf(start.perf);
  if (start.view) { setView(start.view); state._viewSwitched = false; }
  pendingCounters = start.counters || null;
}

/** Counters waiting for the next play press (a fork, a paused replay). */
let pendingCounters = null;

// ---- recording ---------------------------------------------------------------

/** @type {null | {phase: "armed"|"recording", rec?: any, base?: any, deckBase?: any, lastPerf?: any, t0?: number, wall?: number, dur?: number, first?: boolean, forkedFrom?: string|null, forkStep?: number|null, rebase?: any}} */
let recorder = null;
let replaying = 0;          // > 0 while the replay writes: nothing it does is recorded
let replay = null;          // the replay under way, see below

export function setRecordState() {
  if (!recorder) return { phase: "off" };
  const r = recorder.rec;
  const steps = r ? Math.max(0, state.tick - r.start.counters.tick) : 0;
  const seconds = r ? (performance.now() - recorder.wall0) / 1000 : 0;
  return { phase: recorder.phase, steps, seconds, events: r?.events.length ?? 0, forkedFrom: recorder.forkedFrom ?? null };
}

function announceRec() {
  const s = setRecordState();
  const btn = document.getElementById("set-record");
  if (btn) {
    btn.setAttribute("aria-pressed", String(s.phase !== "off"));
    btn.classList.toggle("is-armed", s.phase === "armed");
    btn.classList.toggle("is-recording", s.phase === "recording");
    const label = s.phase === "recording" ? "set ●" : s.phase === "armed" ? "set…" : "set";
    const l = btn.querySelector(".sq-btn__label");
    if (l) l.textContent = label;
  }
  try { window.dispatchEvent(new CustomEvent("seqbaby:setrec", { detail: s })); } catch {}
}

/**
 * Arm the set recorder, or stop it. Armed with the transport stopped, it
 * starts with the next play press; armed while playing, it starts now.
 * @param {{forkedFrom?: string|null, forkStep?: number|null}} [opts]
 */
export function toggleSetRecord(opts = {}) {
  if (recorder) { finishRecording(); return; }
  if (replay) { setStatus("a set is playing back: stop it to record", true); return; }
  recorder = { phase: "armed", forkedFrom: opts.forkedFrom ?? null, forkStep: opts.forkStep ?? null };
  if (state.playing) beginRecording();
  else setStatus("set recording armed: it starts with play, and ends with stop");
  announceRec();
}

function beginRecording() {
  if (!recorder || recorder.phase === "recording") return;
  const start = captureStart();
  recorder.phase = "recording";
  recorder.rec = {
    _set: SET_FORMAT,
    bpm: Number(Tone.getTransport().bpm.value) || Number(start.session.bpm) || 120,
    start,
    events: [],
    marks: [],
    steps: 0,
    seconds: 0,
  };
  recorder.base = songSnapshot(null);
  recorder.deckBase = deckSnapshots();
  recorder.lastPerf = start.perf;
  recorder.wall = performance.now();
  recorder.wall0 = recorder.wall;
  recorder.dur = 60 / (Number(Tone.getTransport().bpm.value) || 120) / 4;
  recorder.t0 = null;
  recorder.lastBpm = null;
  setStatus("recording the set: everything you play, launch and turn, until stop");
  announceRec();
}

/** Where an event lands: the step it is in place for, and how far through the step before. */
function stamp() {
  const r = recorder;
  const rel = Math.max(0, state.tick - r.rec.start.counters.tick);
  const frac = state.playing ? Math.min(0.999, Math.max(0, (performance.now() - r.wall) / 1000 / (r.dur || 0.125))) : 0;
  return [rel, Math.round(frac * 1000) / 1000];
}

function push(kind, data) {
  if (!recorder || recorder.phase !== "recording" || replaying) return;
  const [step, frac] = stamp();
  const ev = recorder.rec.events;
  // in order: an event stamped for a step a perf sample has already passed
  // (a timer firing late) lands with that step's
  const last = ev[ev.length - 1];
  const s = last && last[0] > step ? last[0] : step;
  ev.push([s, s === step ? frac : 0, kind, data]);
}

function recordStep(time, dur) {
  const r = recorder;
  if (r.phase !== "recording") return;
  const rel = state.tick - r.rec.start.counters.tick;
  if (r.t0 == null) r.t0 = time - 0;
  r.wall = performance.now();
  r.dur = dur;
  const bpm = Math.round(Number(Tone.getTransport().bpm.value) * 100) / 100;
  if (rel % 16 === 0 || bpm !== r.lastBpm) {
    r.rec.marks.push([rel, Math.round((time - r.t0) * 1000) / 1000]);
    r.lastBpm = bpm;
  }
  const perf = capturePerf();
  const d = diffPerf(r.lastPerf, perf);
  if (d) {
    r.lastPerf = perf;
    const data = { d };
    // a clip, a scene or a deck moved: the counters go with it, so a replay
    // counts from where the original did (an immediate launch keeps counting)
    if (d.tracks || "scene" in d || d.decks) data.c = captureCounters();
    r.rec.events.push([rel, 0, "perf", data]);
  }
  r.rec.steps = rel + 1;
  r.rec.seconds = Math.round((time - r.t0 + dur) * 1000) / 1000;
}

/** End the recording and hand it to the shell (`seqbaby:setrecorded`). */
export function finishRecording() {
  const r = recorder;
  recorder = null;
  announceRec();
  if (!r?.rec) { setStatus("set recording disarmed"); return null; }
  flushPatchNow(r);
  const rec = r.rec;
  if (!rec.marks.length || rec.marks[rec.marks.length - 1][0] < rec.steps) rec.marks.push([rec.steps, rec.seconds]);
  if (rec.steps < 1) { setStatus("nothing recorded"); return null; }
  rec.forkedFrom = r.forkedFrom ?? null;
  rec.forkStep = r.forkStep ?? null;
  setStatus(`set recorded: ${rec.steps} steps, ${rec.events.length} moves`);
  try { window.dispatchEvent(new CustomEvent("seqbaby:setrecorded", { detail: { recording: rec } })); } catch {}
  return rec;
}

// controls: a knob, a select, a checkbox, a field, by where it is on its track

const RECORDED_INPUTS = new Set(["range", "checkbox", "radio", "number", "color"]);
const locCache = new WeakMap();

function scopeOf(el, t) {
  // a row the control repeats in (an LFO row, a lane, a copy of an fx stage)
  const fx = el.closest(".sq-fx__row[data-fx-id]");
  if (fx) return `.sq-fx__row[data-fx-id="${CSS.escape(fx.dataset.fxId)}"] `;
  const keyed = el.closest("[data-key]");
  if (keyed && (t.el?.contains(keyed) || keyed.closest(`[data-track-id="${t.id}"]`))) return `[data-key="${CSS.escape(keyed.dataset.key)}"] `;
  return "";
}

function matchesIn(t, sel) {
  const out = [];
  if (t.el) out.push(...t.el.querySelectorAll(sel));
  for (const root of document.querySelectorAll(`[data-track-id="${t.id}"]`)) {
    if (t.el && (root === t.el || t.el.contains(root))) continue;
    for (const el of root.matches(sel) ? [root] : root.querySelectorAll(sel)) if (!out.includes(el)) out.push(el);
  }
  return out;
}

function locate(el) {
  const hit = locCache.get(el);
  if (hit && hit.ref === refOf(hit.t)) return hit.loc;
  const t = trackForControl(el);
  if (!t) return el.id ? { g: el.id } : null;
  const ref = refOf(t);
  if (!ref) return null;
  const scope = scopeOf(el, t);
  let best = null;
  for (const cls of el.classList) {
    if (/^(is-|sq-knob|has-)/.test(cls)) continue;
    const sel = `${scope}.${CSS.escape(cls)}`;
    const all = matchesIn(t, sel);
    const i = all.indexOf(el);
    if (i < 0) continue;
    if (!best || all.length < best.n) best = { s: sel, i, n: all.length };
    if (all.length === 1) break;
  }
  if (!best && el.id) return { g: el.id };
  if (!best) return null;
  const loc = { t: ref, s: best.s, i: best.i };
  locCache.set(el, { t, ref, loc });
  return loc;
}

function findControl(loc) {
  if (loc.g) return document.getElementById(loc.g);
  const t = trackOf(loc.t);
  if (!t) return null;
  const all = matchesIn(t, loc.s);
  return all[loc.i] || all[0] || null;
}

function onControl(e) {
  if (!recorder || recorder.phase !== "recording" || replaying) return;
  const el = e.target;
  if (!(el instanceof HTMLInputElement || el instanceof HTMLSelectElement)) return;
  if (el instanceof HTMLInputElement && !RECORDED_INPUTS.has(el.type)) return;
  if (el.closest(".sq-code, .sq-setrec-ignore")) return;
  if (el instanceof HTMLInputElement && el.type === "number" && e.type === "input") return;
  const loc = locate(el);
  if (!loc) return;
  const v = el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio") ? el.checked : el.value;
  push("ctl", { ...loc, v, e: e.type });
}

// the song (and each deck's) as diffs, on the interactions an edit ends in

let patchQueued = false;
function onInteraction(e) {
  if (!recorder || recorder.phase !== "recording" || replaying || patchQueued) return;
  if (e?.target instanceof Element && e.target.closest(".sq-code")) return;
  patchQueued = true;
  requestAnimationFrame(() => { patchQueued = false; if (recorder) flushPatchNow(recorder); });
}

function flushPatchNow(r) {
  if (!r || r.phase !== "recording" || replaying || r.rebase) return;
  const next = songSnapshot(r.base);
  const p = diffSession(r.base, next);
  if (p) { r.base = next; push("patch", { p }); }
  const decks = deckSnapshots();
  for (const [id, s] of Object.entries(decks)) {
    const was = r.deckBase[id];
    if (!was) continue;                                 // a deck that arrived: its load is its event
    const dp = diffSession(was, s);
    if (dp) push("patch", { d: id, p: dp });
  }
  r.deckBase = decks;
}

/** After a landing or a deck arriving, the session moves by itself for a while: wait it out, then take a new base. */
function rebaseWhenSettled(r) {
  if (!r || r.rebase) return;
  r.rebase = setInterval(() => {
    if (recorder !== r) { clearInterval(r.rebase); return; }
    if (state.mix?.landing || mixDecks().some((d) => d.loading)) return;
    clearInterval(r.rebase);
    r.rebase = null;
    r.base = songSnapshot(r.base);
    r.deckBase = deckSnapshots();
  }, 120);
}

function onMix(kind, data) {
  if (!recorder || recorder.phase !== "recording" || replaying) return;
  if (kind === "deck") push("deck", data);
  else if (kind === "eject") push("eject", data);
  else push("mix", data);
  rebaseWhenSettled(recorder);
}

function onMacro(pad, phase, x, y) {
  push("macro", { pad, ph: phase, x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000 });
}

function onTransport() {
  // the transport stopped under a replay by something else (the studio's own
  // stop): the counts are gone, so the next play finds its place again
  if (!state.playing && replay?.playing && !replaying) {
    clearTimers(replay);
    replay.playing = false;
    replay.needsSeek = true;
  }
  if (state.playing) {
    if (pendingCounters) {
      // a fork or a paused replay: every count back where it was, before the
      // first step is scheduled (the transport starts a lead ahead)
      restoreCounters(pendingCounters, { tick: true });
      pendingCounters = null;
    }
    if (recorder?.phase === "armed") beginRecording();
  } else if (recorder?.phase === "recording") {
    finishRecording();
  }
}

// ---- replay ------------------------------------------------------------------
//
// One at a time. `load` puts the studio at the set's start; `play` starts the
// transport on the start's counters and lays the events down as it goes;
// `pause` stops the transport and keeps every count, so `play` goes on from
// the same step; `seek` is a fresh load followed by the events up to a step,
// written as fast as they will go with the transport stopped.

function replayStep(time, dur) {
  const r = replay;
  if (!r || !r.playing) return;
  const rel = state.tick - r.base;
  r.step = rel;
  r.wall = performance.now();
  // everything for this step, now: the timers for it may not have fired
  applyThrough(eventIndexAt(r.rec.events, rel + 1) - 1, time);
  // the next step's controls and edits, through this one, on timers
  clearTimers(r);
  const to = eventIndexAt(r.rec.events, rel + 2);
  for (let i = r.idx; i < to; i++) {
    const e = r.rec.events[i];
    if (e[2] === "perf") continue;
    const ms = Math.max(0, e[1] * dur * 1000);
    r.timers.push(setTimeout(() => applyThrough(i), ms));
  }
  if (rel >= r.rec.steps) { r.ended = true; setTimeout(() => endReplay(), 0); }
  r.onStep?.(rel);
}

function clearTimers(r) {
  for (const id of r.timers) clearTimeout(id);
  r.timers = [];
}

function applyThrough(i, time) {
  const r = replay;
  if (!r) return;
  while (r.idx <= i && r.idx < r.rec.events.length) {
    const e = r.rec.events[r.idx++];
    replaying++;
    try { applyEvent(e, time); }
    catch (err) { console.warn("[seqbaby] set: an event would not play back", e[2], err); }
    finally { replaying--; }
  }
}

function applyEvent([, , kind, data], time) {
  const r = replay;
  switch (kind) {
    case "perf":
      r.perf = applyPerf(r.perf, data.d);
      restorePerf(data.d, time);
      if (data.c) restoreCounters(data.c);
      return;
    case "ctl": {
      const el = findControl(data);
      if (!el) return;
      if (el.type === "checkbox" || el.type === "radio") el.checked = !!data.v;
      else el.value = data.v;
      el.dispatchEvent(new Event(data.e || "input", { bubbles: true }));
      return;
    }
    case "patch": {
      if (data.d) {
        const cur = serializeDeckB(data.d);
        if (!cur) return;
        const res = applySessionPatch(cur, data.p);
        if (res.ok) mergeDeckB(res.session, data.d);
        return;
      }
      const cur = songSnapshot(null);
      const res = applySessionPatch(cur, data.p);
      if (res.ok) mergeSet(res.session);
      return;
    }
    case "macro":
      playMacroGesture(data.pad, data.ph, data.x, data.y);
      return;
    case "deck":
      r.waits.push(loadDeckB(deepCopy(data.session), { title: data.title, clips: data.clips, xf: data.xf, replace: data.replace ?? undefined, id: data.id }));
      return;
    case "eject":
      ejectDeckB({ id: data.id, quiet: true });
      return;
    case "mix": {
      const run = () => {
        replaying++;
        try {
          if (data.op === "land") return landDeckB(data.id);
          if (data.op === "promote") return promoteDeckById(data.id);
          if (data.op === "keep") return keepBothDecks();
        } finally { replaying--; }
      };
      const d = data.id ? getDeck(data.id) : null;
      if (d?.loading) deckReady(d.id).then(run);
      else run();
      return;
    }
    default:
  }
}

function endReplay() {
  const r = replay;
  if (!r) return;
  clearTimers(r);
  r.playing = false;
  stopPlayback();
  r.onEnd?.();
}

/**
 * Load a recorded set into the studio, at its start, transport stopped.
 * @param {any} rec @param {{onProgress?: (m: string) => void, onStep?: (step: number) => void, onEnd?: () => void, followView?: boolean}} [opts]
 */
export async function loadReplay(rec, opts = {}) {
  if (recorder) finishRecording();
  if (replay) { clearTimers(replay); replay = null; }
  replaying++;
  try { await restoreStart(rec.start, opts); }
  finally { replaying--; }
  replay = {
    rec, base: rec.start.counters.tick, idx: 0, step: 0, timers: [], waits: [], playing: false,
    perf: rec.start.perf, counters: rec.start.counters,
    onStep: opts.onStep, onEnd: opts.onEnd, followView: opts.followView !== false,
  };
  return replayState();
}

/** Play the loaded set from where it is (its start, or where it was paused). */
export async function playReplay() {
  const r = replay;
  if (!r || r.playing) return replayState();
  if (r.ended) await seekReplay(0);
  else if (r.needsSeek) await seekReplay(r.step);
  r.needsSeek = false;
  pendingCounters = r.paused || r.counters;
  r.paused = null;
  r.playing = true;
  replaying++;
  try {
    await startPlayback({ tick: (pendingCounters?.tick ?? r.base) });
    // a play press picks a pattern mode for the open view, and a stop let go
    // of every queued clip: the recording's own say goes back over both,
    // before the first step (the transport starts a lead ahead)
    restorePerf(r.perf);
  } finally { replaying--; }
  if (!state.playing) r.playing = false;
  return replayState();
}

/** Stop the transport and keep the set's place: play goes on from the same step. */
export async function pauseReplay() {
  const r = replay;
  if (!r || !r.playing) return replayState();
  clearTimers(r);
  r.playing = false;
  // everything the next step would have been scheduled with is in place
  r.paused = captureCounters();
  replaying++;
  try { await stopPlayback(); } finally { replaying--; }
  // stopPlayback zeroes the counts; the place is kept in `paused`
  return replayState();
}

/**
 * Go to a step: back to the start and every event up to it, written with the
 * transport stopped (perf samples and edits; knob moves only the last of each
 * control, which is where it was). Paused afterwards.
 */
export async function seekReplay(step) {
  const r = replay;
  if (!r) return null;
  const rec = r.rec;
  const wasPlaying = r.playing;
  if (r.playing) await pauseReplay();
  const target = Math.max(0, Math.min(rec.steps, Math.round(step)));
  replaying++;
  try {
    await restoreStart(rec.start);
    r.idx = 0; r.ended = false; r.waits = []; r.perf = rec.start.perf;
    const end = eventIndexAt(rec.events, target + 1);
    // the last value of each control, not every value on the way
    const lastCtl = new Map();
    for (let i = 0; i < end; i++) if (rec.events[i][2] === "ctl") lastCtl.set(JSON.stringify([rec.events[i][3].t, rec.events[i][3].s, rec.events[i][3].i, rec.events[i][3].g]), i);
    const keep = new Set(lastCtl.values());
    let counters = rec.start.counters;
    for (let i = 0; i < end; i++) {
      const e = rec.events[i];
      r.idx = i + 1;
      if (e[2] === "ctl" && !keep.has(i)) continue;
      if (e[2] === "perf" && e[3].c) counters = e[3].c;
      replaying++;
      try { applyEvent(e); } catch (err) { console.warn(err); } finally { replaying--; }
      if (e[2] === "deck" || e[2] === "mix") await Promise.all(r.waits.splice(0));
    }
    await Promise.all(r.waits.splice(0));
    // where the counts would be at `target`: the last counted ones, carried on
    r.paused = carryCounters(counters, rec.start.counters.tick + target);
    r.step = target;
  } finally { replaying--; }
  if (wasPlaying) await playReplay();
  return replayState();
}

/** Counters from an earlier step, run on to `tick` as the transport would count them. */
function carryCounters(c, tick) {
  const n = Math.max(0, tick - c.tick);
  const out = deepCopy(c);
  out.tick = tick;
  out.origin = c.origin;
  for (const [ref, v] of Object.entries(out.tracks)) {
    const t = trackOf(ref);
    const sp = Math.max(0.0001, t?.speed ?? 1);
    let acc = v[1] + sp * n;
    const whole = Math.floor(acc);
    out.tracks[ref] = [v[0] + whole, acc - whole];
  }
  return out;
}

/** Leave the replay (the studio stays where it is). */
export async function closeReplay() {
  const r = replay;
  if (!r) return;
  clearTimers(r);
  replay = null;
  if (state.playing) await stopPlayback();
}

export function replayState() {
  const r = replay;
  if (!r) return null;
  return {
    playing: r.playing,
    step: r.step,
    steps: r.rec.steps,
    seconds: secondsAtStep(r.rec.marks, r.step),
    total: r.rec.seconds,
    ended: !!r.ended,
  };
}

/**
 * Where the replay is, as a starting point a new set can be recorded from:
 * the studio as it stands, with the counts the paused transport kept. The set
 * player hands it to the studio (app/set/forkStore.ts) and the studio opens
 * on it, armed to record.
 */
export function forkPoint() {
  const r = replay;
  const start = captureStart();
  if (r?.paused) start.counters = r.paused;
  return { start, step: r?.step ?? 0 };
}

/** Open the studio on a fork point and arm the recorder, which remembers where it came from. */
export async function openFork(point, { setId = null } = {}) {
  await restoreStart(point.start);
  recorder = null;
  toggleSetRecord({ forkedFrom: setId, forkStep: point.step ?? null });
  setStatus("forked: press play to carry on from here, recording a new set");
}

// ---- install -----------------------------------------------------------------

function step(time, dur) {
  if (replay) replayStep(time, dur);
  else if (recorder) recordStep(time, dur);
}

export function installSetRecorder() {
  setStepHook(step);
  onMixEvent(onMix);
  onMacroGesture(onMacro);
  document.addEventListener("input", onControl, true);
  document.addEventListener("change", onControl, true);
  for (const ev of ["pointerup", "click", "keyup", "change", "drop"]) document.addEventListener(ev, onInteraction, true);
  window.addEventListener("seqbaby:transport", onTransport);
  const btn = document.getElementById("set-record");
  btn?.addEventListener("click", () => toggleSetRecord());
  announceRec();
}
