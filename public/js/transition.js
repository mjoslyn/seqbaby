// A transition from the song playing to another session: the compose panel's
// audition, stop and keep. Instead of writing the session the moment a button
// is pressed (mid-bar, wherever the playhead happens to be), it lands on a bar
// line, after an optional sweep, with the tempo carried across.
//
//   cut    the next bar line (or at once, `when: "now"`)
//   sweep  a lowpass on the master closes over `bars` bars and the new song
//          lands under it on the downbeat, the filter opening again over a bar
//
// The tempo (transitionPlan.js `tempoMode`): a ramp moves the transport's bpm
// a step at a time across the sweep, so the new song lands already at its own
// tempo; a jump changes it on the landing downbeat, which is where the merge
// writes the bpm field anyway. During a ramp only the transport's bpm moves.
// The bpm field, the synced LFOs and the synced delays are retuned once, by
// the merge, when it lands: retuning them every step would rebuild LFOs inside
// the scheduler callback, and the field is the song's tempo, which is the old
// song's until the new one arrives (so a history check mid-ramp sees nothing).
//
// The transport calls `transitionStep` once per step, after the bar line is
// worked out, and the landing runs there, synchronously, for the reason the
// queued pattern switch does: the next callback is the new bar's first step
// and must read the new session.
import { flushJam } from "./jam.js";
import { markExternalEdit } from "./history.js";
import { mergeSet } from "./liveSet.js";
import { state } from "./state.js";
import {
  SWEEP_TOP,
  normalizeTransition,
  openSteps,
  rampBpm,
  sweepHz,
  tempoMode,
  transitionSteps,
} from "./transitionPlan.js";
import { stepsPerBarForMeter, transportMeter } from "./meter.js";

/** @type {null | {session: any, opts: any, from: number, to: number, tempo: string, wait: number, run: number, done: number, resolve: (r: {landed: boolean}) => void}} */
let pending = null;
/** The master lowpass, made the first time a sweep runs and left in place (open). */
let sweepFilter = null;

function fieldBpm() {
  return Number(document.getElementById("bpm")?.value) || 120;
}

function ensureSweepFilter() {
  if (sweepFilter || !state.audioCtx || !state.masterGain || !state.masterLimiter) return sweepFilter;
  const f = state.audioCtx.createBiquadFilter();
  f.type = "lowpass";
  f.frequency.value = SWEEP_TOP;
  f.Q.value = 0.707;
  // Open at 20kHz it is a wire to the ear, so the swap from the direct
  // connection is inaudible; it stays in for the session after that.
  f.connect(state.masterLimiter);
  state.masterGain.connect(f);
  try { state.masterGain.disconnect(state.masterLimiter); } catch {}
  sweepFilter = f;
  state._sweepFilter = f;   // for a test, or a console, to read
  return f;
}

/** Ramp the master lowpass open over `secs` from `at` (now when omitted). */
function openFilter(at, secs) {
  if (!sweepFilter || !state.audioCtx) return;
  const t0 = Math.max(at ?? 0, state.audioCtx.currentTime);
  const fr = sweepFilter.frequency, q = sweepFilter.Q;
  try {
    fr.cancelScheduledValues(t0);
    fr.setValueAtTime(fr.value, t0);
    fr.exponentialRampToValueAtTime(SWEEP_TOP, t0 + secs);
    q.cancelScheduledValues(t0);
    q.setValueAtTime(q.value, t0);
    q.linearRampToValueAtTime(0.707, t0 + secs);
  } catch {}
}

/** The step's position in its bar that the scheduler will play next. */
function nextBarTick() {
  const barLen = stepsPerBarForMeter(transportMeter());
  return { barLen, barTick: state.barTick ?? 0 };
}

function land(p) {
  pending = null;
  let res = null;
  try { res = mergeSet(p.session); } catch (e) { console.error("transition: merge failed", e); }
  // The click that asked for this settled long ago, so the undo stack and a
  // jam are told now, when the song actually changed.
  markExternalEdit("compose");
  setTimeout(() => { try { flushJam(); } catch {} }, 0);
  window.dispatchEvent(new CustomEvent("seqbaby:transition", { detail: { pending: false } }));
  p.resolve({ landed: res !== null });
}

/**
 * Write `session` onto the running engine on a bar line (see the top of the
 * file). Stopped, it lands at once. Resolves `{landed}`: false when the
 * transition was cancelled before it landed. A second call replaces a pending
 * one, which resolves unlanded.
 */
export function transitionTo(session, options = {}) {
  cancelTransition();
  const opts = normalizeTransition(options);
  return new Promise((resolve) => {
    const from = Number(Tone.getTransport().bpm.value) || fieldBpm();
    const to = Number(session?.bpm) || from;
    const p = { session, opts, from, to, tempo: tempoMode(opts.tempo, from, to, opts.shape), wait: 0, run: 0, done: 0, resolve };
    if (!state.playing) return land(p);
    const { barLen, barTick } = nextBarTick();
    const { wait, run } = transitionSteps(opts, barLen, barTick);
    if (wait === 0 && run === 0) return land(p);
    p.wait = wait;
    p.run = run;
    if (opts.shape === "sweep") ensureSweepFilter();
    pending = p;
    window.dispatchEvent(new CustomEvent("seqbaby:transition", { detail: { pending: true, ...opts, wait, run } }));
  });
}

/** Drop a pending transition: nothing lands, the tempo and the filter go back. */
export function cancelTransition() {
  const p = pending;
  if (!p) return false;
  pending = null;
  if (state.ready) Tone.getTransport().bpm.value = fieldBpm();
  openFilter(null, 0.25);
  window.dispatchEvent(new CustomEvent("seqbaby:transition", { detail: { pending: false } }));
  p.resolve({ landed: false });
  return true;
}

/** Land a pending transition now (the transport stopping, the next turn being sent). */
export function finishTransition() {
  const p = pending;
  if (!p) return false;
  openFilter(null, 0.05);
  land(p);
  return true;
}

export function transitionPending() {
  return !!pending;
}

/**
 * Called by the transport once per step, after the bar line is worked out.
 * `nextTime` is when the next step sounds, `stepDur` a step's length now.
 * Returns true when the session landed on this bar line, which is the
 * transport's cue to start every track from its first step and leave the
 * queue and the chain alone for this bar.
 */
export function transitionStep(nextTime, stepDur, barLine) {
  const p = pending;
  if (!p) return false;
  p.done++;
  const into = p.done - p.wait;
  if (into > 0 && p.run > 0) {
    const prog = Math.min(1, into / p.run);
    if (p.tempo === "ramp") Tone.getTransport().bpm.value = rampBpm(p.from, p.to, prog);
    if (p.opts.shape === "sweep" && sweepFilter) {
      const fr = sweepFilter.frequency, q = sweepFilter.Q;
      try {
        if (into === 1) { fr.setValueAtTime(fr.value, Math.max(state.audioCtx.currentTime, nextTime - stepDur)); q.setValueAtTime(q.value, Math.max(state.audioCtx.currentTime, nextTime - stepDur)); }
        fr.exponentialRampToValueAtTime(sweepHz(prog), nextTime);
        q.linearRampToValueAtTime(0.707 + 4 * prog, nextTime);
      } catch {}
    }
  }
  // Land on the bar line the plan counted to, or the first one after it (a
  // meter changed by hand mid-transition moves the bar lines).
  if (p.done < p.wait + p.run || !barLine) return false;
  if (p.opts.shape === "sweep") {
    const { barLen } = nextBarTick();
    const newStep = 60 / (p.to || p.from) / 4;
    openFilter(nextTime, openSteps(p.opts.bars, barLen) * newStep);
  }
  land(p);
  return true;
}
