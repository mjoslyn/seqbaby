// A transition from the song playing to another session: the compose panel's
// audition, stop and keep. Instead of writing the session the moment a button
// is pressed (mid-bar, wherever the playhead happens to be), it lands on a bar
// line, shaped (transitionPlan.js has the arithmetic):
//
//   cut      the next bar line (or at once, `when: "now"`)
//   sweep    the two songs overlap for `bars` bars: the new one plays from
//            the start while the old one's tracks are swept down (a -36dB
//            high shelf on each, its corner sliding to 400Hz) and gone at the
//            end
//   drop     the playing song thins over `bars`: harmony and lead leave, then
//            the bass, then the drums, and the last bar is the near-silence
//            before the new song hits
//   fade     the two songs overlap for `bars` bars: the old one's tracks dip
//            to -36dB while the new one's rise from there
//   stagger  the new song arrives a group at a time across `bars`: drums,
//            bass, harmony, lead (one a bar over four, one a beat over one),
//            the old song's same group making way as each arrives
//   bridge   a section the model wrote for the join (a free pattern slot of
//            the new song) plays for `bars` bars, then the new song
//
// The tempo (`tempoMode`): a ramp moves the transport's bpm a step at a time
// across the length, so the new song lands already at its own tempo; a jump
// changes it where the new song (or, staggered, its drums) arrives, which is
// where the merge writes the bpm field anyway. During a ramp only the
// transport's bpm moves: the field, the synced LFOs and the synced delays are
// retuned once, by the merge, since retuning them per step would rebuild LFOs
// inside the scheduler callback.
//
// The transport calls `transitionStep` once per step, after the bar line is
// worked out, and every merge runs there, synchronously, for the reason the
// queued pattern switch does: the next callback is the next step and must
// read what it plays.
import { announceClips } from "./clips.js";
import { flushJam } from "./jam.js";
import { markExternalEdit } from "./history.js";
import { mergeSet } from "./liveSet.js";
import { removeTrack } from "./track.js";
import { serializeSet } from "./session.js";
import { releaseSilencedTracks } from "./signal.js";
import { state, switchPattern } from "./state.js";
import { stepsPerBarForMeter, stepsPerBeatForMeter, transportMeter } from "./meter.js";
import {
  SWEEP_TOP,
  compositeSession,
  overlapSession,
  trackKey,
  fadeGain,
  groupStages,
  normalizeTransition,
  rampBpm,
  sweepHz,
  tempoMode,
  trackGroup,
  transitionSteps,
} from "./transitionPlan.js";

/** The transition on its way, if one is. */
let pending = null;
/** The most bars a landing waits for its new tracks to be built. */
const MAX_DEFER = 4;

// ---- a longer lookahead while one is on its way ----------------------------
//
// Building tracks ahead (below) is done a track per task, but a task is still
// tens of milliseconds of main thread (hundreds on a phone), and the landing's
// merge more. Tone's clock ticks on the main thread and schedules
// `lookAhead` seconds ahead, so a stall longer than that is audio that never
// got scheduled: the choppiness. For as long as a transition is on its way the
// lookahead is raised; raising it only schedules further ahead (the ticks in
// between are still scheduled at their own times) and lowering it after only
// pauses scheduling until the clock catches up, so neither skips or doubles a
// note. Knob moves land that much later meanwhile, which is the trade.
const TRANSITION_LOOKAHEAD = 1.0;
let baseLookAhead = null;   // the studio's own, read the first time it is stretched
let stretched = false;
function stretchLookAhead() {
  try {
    const ctx = Tone.getContext();
    if (baseLookAhead == null) baseLookAhead = ctx.lookAhead;
    stretched = true;
    ctx.lookAhead = Math.max(baseLookAhead, TRANSITION_LOOKAHEAD);
  } catch {}
}
function restoreLookAhead() {
  if (!stretched) return;
  stretched = false;
  // After the landing's own work has been scheduled past, and only if no
  // other transition has stretched it again since.
  setTimeout(() => {
    if (stretched || pending || baseLookAhead == null) return;
    try { Tone.getContext().lookAhead = baseLookAhead; } catch {}
  }, TRANSITION_LOOKAHEAD * 1000 + 200);
}
function fieldBpm() {
  return Number(document.getElementById("bpm")?.value) || 120;
}

/** A track's own output level: what a fade moves (the rack's output gain). */
function outGain(t) {
  return t?.fxRack?.output?.gain || null;
}

function rampTo(prm, v, at, exp = false) {
  if (!prm) return;
  try {
    if (exp) prm.exponentialRampToValueAtTime(Math.max(1e-4, v), at);
    else prm.linearRampToValueAtTime(v, at);
  } catch {}
}

function holdNow(prm, at) {
  if (!prm) return;
  try { prm.cancelScheduledValues(at); prm.setValueAtTime(Math.max(1e-4, prm.value), at); } catch {}
}

/** Both songs in: the merge, and which live tracks are whose. */
function startOverlap(p) {
  const oldKeys = new Set(p.old.tracks.map(trackKey));
  const newKeys = new Set((p.session?.tracks || []).map(trackKey));
  safeMerge(overlapSession(p.old, p.session), p);
  p.merged = true;
  p.oldOnly = state.tracks.filter(t => !newKeys.has(trackKey(t)));
  p.newOnly = state.tracks.filter(t => !oldKeys.has(trackKey(t)) && t.engineKey !== "bus");
  p.saved = p.oldOnly.map(t => ({
    t,
    gain: outGain(t)?.value ?? 1,
    freq: t.eqNode?.high?.frequency.value,
    shelf: t.eqNode?.high?.gain.value,
  }));
  const now = state.audioCtx?.currentTime ?? 0;
  if (p.opts.shape === "sweep") {
    for (const t of p.oldOnly) {
      const hs = t.eqNode?.high;
      if (!hs) continue;
      holdNow(hs.frequency, now); hs.frequency.setValueAtTime(SWEEP_TOP, now + 0.005);
      holdNow(hs.gain, now); rampTo(hs.gain, -36, now + 0.01);
    }
  } else {
    // A fade's new tracks start where the old ones are going.
    for (const t of p.newOnly) { const g = outGain(t); holdNow(g, now); try { g?.setValueAtTime(fadeGain(1), now + 0.005); } catch {} }
  }
}

/** Put the old tracks' sound back (a cancel), and the new tracks' level up (always). */
function endOverlap(p, restoreOld) {
  const now = state.audioCtx?.currentTime ?? 0;
  for (const t of p.newOnly || []) { const g = outGain(t); holdNow(g, now); rampTo(g, 1, now + 0.03); }
  if (!restoreOld) return;
  for (const s of p.saved || []) {
    const g = outGain(s.t); holdNow(g, now); rampTo(g, s.gain, now + 0.03);
    const hs = s.t.eqNode?.high;
    if (hs && s.freq != null) { holdNow(hs.frequency, now); rampTo(hs.frequency, s.freq, now + 0.03, true); holdNow(hs.gain, now); rampTo(hs.gain, s.shelf ?? 0, now + 0.03); }
  }
}

/** Bring back every track a drop stopped. */
function releaseDropped(p) {
  if (!p.off?.size) return;
  for (const t of p.off) t._clipOff = false;
  p.off.clear();
  announceClips();
}

function told(p) {
  restoreLookAhead();
  // The click that asked for this settled long ago, so the undo stack and a
  // jam are told now, when the song actually changed.
  markExternalEdit("compose");
  setTimeout(() => { try { flushJam(); } catch {} }, 0);
  window.dispatchEvent(new CustomEvent("seqbaby:transition", { detail: { pending: false } }));
  p.resolve({ landed: true });
}

function safeMerge(session, p = null) {
  let target = densify(p, session);
  // The tracks this merge removes are kept a little longer, stopped and
  // hidden (`_leaving`), until the audio reaches the bar line the merge is
  // for. The scheduler runs a lookahead in front of the audio, so removing
  // them at once cut the end of their last bar, already scheduled: a gap
  // before every landing, the size of the lookahead.
  const keys = new Set((target?.tracks || []).map(trackKey));
  for (const t of state.tracks) {
    if (t._leaving && keys.has(trackKey(t))) unleave(t);    // wanted again (a cancel)
  }
  const leaving = state.playing && p?.at
    ? state.tracks.filter(t => !t._staged && !t._leaving && t.engineKey !== "bus" && !keys.has(trackKey(t)))
    : [];
  if (leaving.length) {
    const cur = serializeSet({ staged: true }).tracks;          // parallel to state.tracks
    const extra = leaving.map(t => ({
      ...cur[state.tracks.indexOf(t)], soloed: false, outIndex: -1, compSourceIndex: -1,
    }));
    target = { ...target, tracks: [...target.tracks, ...extra] };
  }
  let out = null;
  try { out = mergeSet(target); } catch (e) { console.error("transition: merge failed", e); }
  // A track built ahead (staged, below) that the merge kept is now the song's.
  for (const t of state.tracks) {
    if (!t._staged) continue;
    t._staged = false;
    t._clipOff = false;
    t.el?.classList.remove("is-staged");
  }
  if (leaving.length) {
    for (const t of leaving) {
      if (!state.tracks.includes(t)) continue;
      t._leaving = true;
      t._clipOff = true;
      t.el?.classList.add("is-staged");
    }
    releaseSilencedTracks();
    const ctx = state.audioCtx;
    const wait = Math.max(0, (p.at - (ctx?.currentTime ?? 0)) * 1000) + LEAVE_TAIL_MS;
    setTimeout(dropLeaving, wait);
  }
  return out;
}

/** How long a removed track rings on past the bar line it was removed at. */
const LEAVE_TAIL_MS = 800;

function unleave(t) {
  t._leaving = false;
  t._clipOff = false;
  t.el?.classList.remove("is-staged");
}

/** Remove the tracks a landing left to finish their bar. */
function dropLeaving() {
  const gone = state.tracks.filter(t => t._leaving);
  if (!gone.length) return;
  for (const t of gone) {
    try { removeTrack(t); } catch (e) { console.error("transition: removing a track failed", e); }
  }
  announceClips();
}

// ---- staging: the new tracks built before the bar line ----------------------
//
// Building a track (its voice, its rack, its DOM) takes 50-100ms of main
// thread, and a landing that builds eight of them inside the scheduler
// callback held the clock past the lookahead: the old song stopped and the new
// one came in late, a gap on the one. So the tracks the first merge will add
// are built while the old song is still playing, one per task, stopped
// (`_clipOff`, as a stopped clip is) and hidden, and the merge on the bar line
// finds them made. serializeSet leaves them out (`_staged`), so the undo
// stack, a jam, a save and the unsaved check never see them.

/**
 * A session with each staged track as the engine read it back. A song from
 * the builder is sparse (only what was set), and merged sparse onto the track
 * staged from it, every field would read as moved and be written and repainted
 * again, inside the scheduler. The routing, the solo and the mute are the
 * session's own: staging left them out.
 */
function densify(p, session) {
  if (!p?.dense?.size || !session?.tracks) return session;
  return {
    ...session,
    tracks: session.tracks.map(t => {
      const d = p.dense.get(trackKey(t));
      if (!d) return t;
      return {
        ...d,
        outIndex: t.outIndex ?? -1,
        compSourceIndex: t.compSourceIndex ?? -1,
        soloed: !!t.soloed,
        muted: !!t.muted,
      };
    }),
  };
}

/** The tracks of the first session this transition merges that are not playing now. */
function stageList(p) {
  const shape = p.opts.shape;
  let target = p.session;
  if (shape === "bridge") target = p.bridge?.session;
  else if (shape === "stagger") target = p.events.length ? compositeSession(p.old, p.session, new Set(p.events[0].groups)) : null;
  const live = new Set(state.tracks.map(trackKey));
  return (target?.tracks || []).filter(t => t.engineKey !== "bus" && !live.has(trackKey(t)));
}

function stageNext(p) {
  if (pending !== p || p.merged || !p.toStage?.length) return;
  const td = p.toStage.shift();
  // Alone and on the master: its sends and sidechain are the landing's to
  // wire, and a solo carried in would silence the song still playing.
  const next = {
    ...td, soloed: false, muted: false, outIndex: -1, compSourceIndex: -1,
    comp: td.comp ? { ...td.comp, source: "self" } : td.comp,
  };
  // Everything there now, the tracks staged so far included, as the engine
  // reads them back, so the merge only has the one new track to make.
  const live = serializeSet({ staged: true });
  const had = new Set(state.tracks);
  try { mergeSet({ ...live, tracks: [...live.tracks, next] }); } catch (e) {
    console.error("transition: staging failed", e);
    p.toStage = [];
  }
  for (const t of state.tracks) {
    if (had.has(t)) continue;
    t._staged = true;
    t._clipOff = true;
    t.el?.classList.add("is-staged");
  }
  const back = serializeSet({ staged: true }).tracks.find(x => trackKey(x) === trackKey(td));
  if (back) p.dense.set(trackKey(td), back);
  if (p.toStage.length) setTimeout(() => stageNext(p), 0);
}

function startStaging(p) {
  p.dense = new Map();
  p.toStage = stageList(p);
  if (p.toStage.length) setTimeout(() => stageNext(p), 0);
}

/** Take back whatever was built ahead for a transition that is not landing. */
function dropStaged() {
  if (!state.tracks.some(t => t._staged)) return;
  try { mergeSet(serializeSet()); } catch (e) { console.error("transition: unstaging failed", e); }
}

/** The new song, whole: the end of every shape. */
function landFinal(p) {
  pending = null;
  releaseDropped(p);
  endOverlap(p, false);
  safeMerge(p.session, p);
  if (p.opts.shape === "bridge" && p.bridge) switchPattern(p.bridge.start, { deferUi: true });
  told(p);
}

/**
 * Write `session` onto the running engine on a bar line, shaped (see the top
 * of the file). Stopped, it lands at once. Resolves `{landed}`: false when the
 * transition was cancelled before it landed. A second call replaces a pending
 * one, which resolves unlanded. A bridge needs `options.bridge`:
 * `{ session, slot, start }`, the new song with the bridge written into
 * `slot`, and the slot the new song starts from after it.
 */
export function transitionTo(session, options = {}) {
  cancelTransition();
  const opts = normalizeTransition(options);
  return new Promise((resolve) => {
    const from = Number(Tone.getTransport().bpm.value) || fieldBpm();
    const to = Number(session?.bpm) || from;
    const p = {
      session, opts, from, to, resolve,
      tempo: tempoMode(opts.tempo, from, to, opts.shape),
      wait: 0, run: 0, done: 0,
      events: [], off: new Set(), merged: false,
      bridge: opts.shape === "bridge" ? options.bridge || null : null,
    };
    if (!state.playing || (opts.shape === "bridge" && !p.bridge)) return landFinal(p);
    const meter = transportMeter();
    const barLen = stepsPerBarForMeter(meter);
    const beatLen = stepsPerBeatForMeter(meter);
    const barTick = state.barTick ?? 0;
    const plan = transitionSteps({ ...opts, shape: opts.shape === "cut" ? "cut" : "sweep" }, barLen, barTick);
    p.wait = plan.wait;
    p.run = plan.run;
    // On a bar line already: the next one, not this instant, so the new tracks
    // can be built first. Only `now` lands at once, which is what it asks for.
    if (opts.shape === "cut" && p.wait === 0) {
      if (opts.when === "now") return landFinal(p);
      p.wait = barLen;
    }

    if (opts.shape === "bridge") {
      // On a bar line whatever `when` says: a section starts on the one.
      p.wait = transitionSteps({ when: "bar", shape: "cut" }, barLen, barTick).wait;
      p.run = 0;
      p.phase = "wait";
    }
    if (opts.shape === "sweep" || opts.shape === "fade") {
      p.old = serializeSet();
      // Due at once (`now`, or already on the bar line): both songs in now.
      if (p.wait === 0) startOverlap(p);
    }
    if (opts.shape === "drop" || opts.shape === "stagger") {
      // What is playing now, to read the old song's groups off, and (for a
      // stagger, which merges part way) to put back if it is called off.
      p.old = serializeSet();
      p.oldTracks = state.tracks.slice();
      const slot = p.old.activePattern ?? 0;
      p.oldGroup = p.old.tracks.map(t => trackGroup(t, slot));
      p.events = groupStages(opts.shape, opts.bars, barLen, beatLen, p.run).map(e => ({ ...e, ran: false }));
      if (opts.shape === "stagger") {
        p.arrived = new Set();
        // The new song is whole when its last group arrives.
        p.run = p.events[p.events.length - 1].at;
      }
    }
    if (opts.shape === "bridge") p.old = serializeSet();
    pending = p;
    stretchLookAhead();
    startStaging(p);
    window.dispatchEvent(new CustomEvent("seqbaby:transition", { detail: { pending: true, ...opts, wait: p.wait, run: p.run } }));
    // A stage due at once (a stagger started on the bar line, or `now`) runs now.
    if (opts.shape === "stagger" || opts.shape === "drop") runDue(p, false);
  });
}

/** The group stages whose moment has come. Returns true when the new song landed whole. */
function runDue(p, barLine) {
  let landed = false;
  for (const e of p.events) {
    if (e.ran || p.wait + e.at > p.done) continue;
    e.ran = true;
    if (p.opts.shape === "drop") {
      p.oldTracks.forEach((t, i) => {
        if (!e.groups.includes(p.oldGroup[i]) || t.engineKey === "bus" || t._clipOff) return;
        if (!state.tracks.includes(t)) return;
        t._clipOff = true;
        p.off.add(t);
      });
      releaseSilencedTracks();
      announceClips();
    } else {
      for (const g of e.groups) p.arrived.add(g);
      if (p.arrived.size >= 4) { landFinal(p); landed = true; break; }
      safeMerge(compositeSession(p.old, p.session, p.arrived), p);
      p.merged = true;
    }
  }
  return landed;
}

/** Drop a pending transition: nothing more lands, and what already did goes back. */
export function cancelTransition() {
  const p = pending;
  if (!p) return false;
  pending = null;
  releaseDropped(p);
  endOverlap(p, true);
  if (!p.merged) dropStaged();
  restoreLookAhead();
  if (p.merged && p.old) {
    safeMerge(p.old);
    if (p.opts.shape === "bridge") switchPattern(p.old.activePattern ?? 0, { deferUi: true });
  }
  if (state.ready) Tone.getTransport().bpm.value = fieldBpm();
  window.dispatchEvent(new CustomEvent("seqbaby:transition", { detail: { pending: false } }));
  p.resolve({ landed: false });
  return true;
}

/** Land a pending transition now (the transport stopping, the next turn being sent). */
export function finishTransition() {
  const p = pending;
  if (!p) return false;
  landFinal(p);
  return true;
}

export function transitionPending() {
  return !!pending;
}

/**
 * Called by the transport once per step, after the bar line is worked out.
 * `nextTime` is when the next step sounds, `stepDur` a step's length now.
 * Returns:
 *   "land"   a session landed on this bar line: start every track from its
 *            first step, and leave the queue and the chain alone this bar
 *   "bridge" the bridge landed: the same, but the arrangement is not seeded,
 *            since the bridge slot is not on it
 *   "hold"   a bridge or a stagger is under way: leave the queue and the
 *            chain alone
 *   null    carry on
 */
export function transitionStep(nextTime, stepDur, barLine) {
  const p = pending;
  if (!p) return null;
  p.done++;
  p.at = nextTime;
  const shape = p.opts.shape;
  // Reaching the first merge with the new tracks not all built yet: wait a
  // bar (up to MAX_DEFER) rather than build them here, inside the scheduler,
  // which is the stall this staging exists to keep out. Every shape's moment
  // is counted from `wait`, so moving it a bar moves the whole plan a bar.
  if (!p.merged && p.toStage?.length && p.done >= p.wait && (p.deferred ?? 0) < MAX_DEFER) {
    p.deferred = (p.deferred ?? 0) + 1;
    p.wait += stepsPerBarForMeter(transportMeter());
    return null;
  }

  if (shape === "bridge") {
    if (p.phase === "wait") {
      if (p.done < p.wait || !barLine) return null;
      safeMerge(p.bridge.session, p);
      switchPattern(p.bridge.slot, { deferUi: true });
      p.merged = true;
      p.phase = "hold";
      p.barsLeft = p.opts.bars;
      return "bridge";
    }
    if (!barLine) return null;
    if (--p.barsLeft > 0) return "hold";
    landFinal(p);
    return "land";
  }

  if (shape === "stagger") {
    const before = p.arrived.size;
    if (runDue(p, barLine)) return barLine ? "land" : null;
    // The drums arriving on a bar line start every track from the top, as a
    // landing does; while the song is half old and half new, the chain waits.
    if (before === 0 && p.arrived.size > 0 && barLine) return "land";
    return p.arrived.size > 0 && barLine ? "hold" : null;
  }

  if (shape === "drop") runDue(p, barLine);

  const blend = shape === "sweep" || shape === "fade";
  let started = false;
  if (blend && !p.merged && p.done >= p.wait) {
    startOverlap(p);
    started = true;
  }
  const into = p.done - p.wait;
  if (into > 0 && p.run > 0) {
    const prog = Math.min(1, into / p.run);
    if (p.tempo === "ramp") Tone.getTransport().bpm.value = rampBpm(p.from, p.to, prog);
    if (blend) {
      for (const t of p.oldOnly || []) {
        if (shape === "sweep") rampTo(t.eqNode?.high?.frequency, sweepHz(prog), nextTime, true);
        else rampTo(outGain(t), fadeGain(prog), nextTime, true);
      }
      if (shape === "fade") for (const t of p.newOnly || []) rampTo(outGain(t), fadeGain(1 - prog), nextTime, true);
    }
  }
  // Land on the bar line the plan counted to, or the first one after it (a
  // meter changed by hand mid-transition moves the bar lines).
  if (p.done < p.wait + p.run || !barLine) {
    // Both songs coming in on a bar line start from the top; while they
    // overlap, the chain waits.
    if (blend && p.merged && barLine) return started ? "land" : "hold";
    return null;
  }
  landFinal(p);
  return "land";
}
