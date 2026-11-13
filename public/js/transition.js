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
  safeMerge(overlapSession(p.old, p.session));
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
  // The click that asked for this settled long ago, so the undo stack and a
  // jam are told now, when the song actually changed.
  markExternalEdit("compose");
  setTimeout(() => { try { flushJam(); } catch {} }, 0);
  window.dispatchEvent(new CustomEvent("seqbaby:transition", { detail: { pending: false } }));
  p.resolve({ landed: true });
}

function safeMerge(session) {
  try { return mergeSet(session); } catch (e) { console.error("transition: merge failed", e); return null; }
}

/** The new song, whole: the end of every shape. */
function landFinal(p) {
  pending = null;
  releaseDropped(p);
  endOverlap(p, false);
  safeMerge(p.session);
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
    if (opts.shape === "cut" && p.wait === 0) return landFinal(p);

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
      safeMerge(compositeSession(p.old, p.session, p.arrived));
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
  const shape = p.opts.shape;

  if (shape === "bridge") {
    if (p.phase === "wait") {
      if (p.done < p.wait || !barLine) return null;
      safeMerge(p.bridge.session);
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
