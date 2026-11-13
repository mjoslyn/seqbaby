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
//   bridge   the song playing reaches its last `patterns` patterns and plays
//            them as they are while the new song is worked in over them a
//            group at a time (chords, lead, bass), the old kick out and a
//            roll through the last bar, and the new song lands, from its own
//            start, where the old one would have started over
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
import { activeArrangeLoop, announceClips, arrangeLength } from "./clips.js";
import { nextArrangeBar } from "./arrangement.js";
import { flushJam } from "./jam.js";
import { markExternalEdit } from "./history.js";
import { mergeSet } from "./liveSet.js";
import { removeTrack } from "./track.js";
import { serializeSet } from "./session.js";
import { releaseSilencedTracks } from "./signal.js";
import { loopRange, nextChainPattern, songTracks, state, switchPattern } from "./state.js";
import { stepsPerBarForMeter, stepsPerBeatForMeter, transportMeter } from "./meter.js";
import {
  SWEEP_TOP,
  compositeSession,
  freeSlot,
  isKick,
  isSnare,
  overlapSession,
  rollVelocity,
  workInEntries,
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
export function stretchLookAhead() {
  try {
    const ctx = Tone.getContext();
    if (baseLookAhead == null) baseLookAhead = ctx.lookAhead;
    stretched = true;
    ctx.lookAhead = Math.max(baseLookAhead, TRANSITION_LOOKAHEAD);
  } catch {}
}
export function restoreLookAhead() {
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

/**
 * The new song as it plays while it overlaps the old one: on the slot the
 * transport is on, which the chain holds until the landing, so with a target
 * picked every track's target pattern is copied there. The landing then
 * switches to the target itself.
 */
function aimed(p) {
  const cur = state.activePattern;
  if (p.into == null || p.into === cur || !p.session?.tracks) return p.session;
  return {
    ...p.session,
    tracks: p.session.tracks.map(t => {
      const patterns = (t.patterns || []).slice();
      const src = patterns[p.into];
      const here = patterns[cur];
      if (!src && !here) return t;
      while (patterns.length <= cur) patterns.push(null);
      patterns[cur] = src || { ...here, steps: (here.steps || []).map(() => false) };
      for (let k = 0; k < patterns.length; k++) if (!patterns[k]) patterns[k] = { ...patterns[cur], steps: (patterns[cur].steps || []).map(() => false) };
      return { ...t, patterns };
    }),
  };
}

/** Both songs in: the merge, and which live tracks are whose. */
function startOverlap(p) {
  const oldKeys = new Set(p.old.tracks.map(trackKey));
  const newKeys = new Set((p.session?.tracks || []).map(trackKey));
  safeMerge(overlapSession(p.old, aimed(p)), p);
  p.merged = true;
  // The song's own tracks: a second song on deck B (mix.js) is neither.
  p.oldOnly = songTracks().filter(t => !newKeys.has(trackKey(t)));
  p.newOnly = songTracks().filter(t => !oldKeys.has(trackKey(t)) && t.engineKey !== "bus");
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
    ? songTracks().filter(t => !t._staged && !t._leaving && t.engineKey !== "bus" && !keys.has(trackKey(t)))
    : [];
  if (leaving.length) {
    const cur = serializeSet({ staged: true }).tracks;          // parallel to state.tracks
    const live = songTracks();                                  // what `cur` runs parallel to
    const extra = leaving.map(t => ({
      ...cur[live.indexOf(t)], soloed: false, outIndex: -1, compSourceIndex: -1,
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
      // The notes are this session's own: a staged track was read back from
      // the new song, and a bridge's work-in gives it other slots.
      return {
        ...d,
        ...(t.patterns ? { patterns: t.patterns } : {}),
        ...(t.arrangement ? { arrangement: t.arrangement } : {}),
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
  if (shape === "stagger") target = p.events.length ? compositeSession(p.old, aimed(p), new Set(p.events[0].groups)) : null;
  const live = new Set(songTracks().map(trackKey));
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
  // A bridge can wait a whole song for its work-in: with its tracks built,
  // the knobs need not lag that long. Stretched again when it starts.
  else if (p.opts.shape === "bridge") restoreLookAhead();
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
  unhold();
  safeMerge(p.session, p);
  const to = p.opts.shape === "bridge" ? (p.into ?? p.session?.activePattern ?? 0) : p.into;
  if (state.playing && to != null && to !== state.activePattern) switchPattern(to, { deferUi: true });
  told(p);
}

/** Every track held out of a work-in plays again (a landing, a cancel). */
function unhold() {
  for (const t of state.tracks) t._held = false;
}

/**
 * Write `session` onto the running engine on a bar line, shaped (see the top
 * of the file). Stopped, it lands at once. Resolves `{landed}`: false when the
 * transition was cancelled before it landed. A second call replaces a pending
 * one, which resolves unlanded.
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
      // The new song's pattern to land on (`options.into`). Unset: a bridge
      // lands on the new song's own start, every other shape on the slot
      // playing, as it always did.
      into: Number.isInteger(options.into) && options.into >= 0 && options.into < 32 ? options.into : null,
    };
    if (!state.playing) return landFinal(p);
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
      // Over the song's last patterns, whatever `when` says (workInStep).
      p.wait = 0;
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
      p.oldTracks = songTracks();
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
      safeMerge(compositeSession(p.old, aimed(p), p.arrived), p);
      p.merged = true;
    }
  }
  return landed;
}

// ---- bridge: the work-in ------------------------------------------------------

const reps = (slot) => Math.max(1, state.patternRepeats?.[slot] ?? 1);

/** The chain's slots from `from` to where it goes back round. */
function chainTail(from) {
  const out = [from];
  let cur = from;
  for (let i = 0; i < 64; i++) {
    const n = nextChainPattern(cur);
    if (n < 0 || n <= cur) break;
    out.push(n);
    cur = n;
  }
  return out;
}

/** The track whose part takes longest to come round: what a pass of the pattern is. */
function longestTrack() {
  let best = null, most = -1;
  for (const t of songTracks()) {
    if (t.engineKey === "bus" || t._staged || t._leaving || !t.length) continue;
    const cycle = t.length / Math.max(0.0001, t.speed ?? 1);
    if (cycle > most) { most = cycle; best = t; }
  }
  return best;
}

/**
 * Where the song stands at the bar line the transport is on (asked before the
 * chain or the arrangement advances): whether the bar starting here is inside
 * its last `n` patterns, how many bars are left to its end from here, and the
 * slots it plays on the way (null in arrange mode, where every track has its
 * own). `{ inside: false }` when not there yet.
 */
function songTail(n) {
  if (state.patternMode === "arrange") {
    const len = arrangeLength();
    const loop = activeArrangeLoop();
    const from = loop?.start ?? 0, to = loop?.end ?? len;
    const u = nextArrangeBar(state.arrBar ?? 0, len, loop);
    // A section starts wherever any track's block does.
    const starts = new Set([from]);
    for (const t of songTracks()) for (const b of t.arrangement || []) if (b.start > from && b.start < to) starts.add(b.start);
    const sorted = [...starts].sort((a, b) => a - b);
    const begin = sorted[Math.max(0, sorted.length - n)];
    return { inside: u >= begin, bars: Math.max(1, to - u), slots: null, bar: u };
  }
  if (state.patternMode === "chain" || loopRange()) {
    const a = state.activePattern;
    const done = (state.chainBarCount ?? 0) + 1;
    let u = a, doneU = done;
    if (done >= reps(a)) {
      const nx = nextChainPattern(a);
      u = nx < 0 ? a : nx;
      doneU = 0;
    }
    const tail = chainTail(u);
    const bars = reps(u) - doneU + tail.slice(1).reduce((s, k) => s + reps(k), 0);
    return { inside: tail.length <= n, bars: Math.max(1, bars), slots: tail };
  }
  // Repeat: a pass of the pattern is a "pattern", from the top of one.
  const t = longestTrack();
  if (!t) return { inside: true, bars: n, slots: [state.activePattern] };
  const barLen = stepsPerBarForMeter(transportMeter());
  const speed = Math.max(0.0001, t.speed ?? 1);
  const pass = Math.max(1, Math.ceil(t.length / speed / barLen));
  const into = Math.round(((t.trackTick ?? 0) % t.length) / speed / barLen) % pass;
  return { inside: into === 0, bars: n * pass, slots: [state.activePattern] };
}

/** One step of a bridge: waiting for the song's last patterns, then working the new song in. */
function workInStep(p, nextTime, stepDur, barLine) {
  if (p.phase === "wait") {
    if (!barLine) return null;
    if (p.endIn == null) {
      const tail = songTail(p.opts.patterns);
      if (!tail.inside) return null;
      p.endIn = tail.bars;
      p.tail = tail;
    } else {
      p.endIn -= 1;
      // The arrangement's bar moves with each bar line deferred.
      if (p.tail.bar != null) p.tail.bar += 1;
    }
    // The new tracks still being built: give them a bar (the work-in is a bar
    // shorter), unless that would leave no work-in at all.
    if (p.toStage?.length && (p.deferred ?? 0) < MAX_DEFER && p.endIn > 1) {
      p.deferred = (p.deferred ?? 0) + 1;
      return null;
    }
    startWorkIn(p);
  } else if (barLine && ++p.barsIn >= p.endIn) {
    landFinal(p);
    return "land";
  }
  workInMoment(p, nextTime, stepDur);
  p.step++;
  return null;
}

/**
 * Merge the new song's tracks the old one does not have into what is playing,
 * held silent until their group's moment. They play the new song's start
 * pattern in every slot the old song has left (in arrange mode, a block of a
 * free slot to the end of the arrangement).
 */
function startWorkIn(p) {
  stretchLookAhead();
  const live = serializeSet();
  const liveKeys = new Set(live.tracks.map(trackKey));
  const start = p.into ?? p.session?.activePattern ?? 0;
  const arrange = !p.tail.slots;
  const free = arrange ? freeSlot({ tracks: [...live.tracks, ...(p.session?.tracks || [])] }) : -1;
  const into = arrange ? (free >= 0 ? [free] : []) : p.tail.slots;
  const adds = [];
  for (const t of p.session?.tracks || []) {
    if (t.engineKey === "bus" || liveKeys.has(trackKey(t))) continue;
    const src = t.patterns?.[start];
    if (!src) continue;
    const patterns = (t.patterns || []).slice();
    const blank = { ...src, steps: (src.steps || []).map(() => false) };
    for (const k of into) {
      while (patterns.length <= k) patterns.push(blank);
      patterns[k] = src;
    }
    for (let k = 0; k < patterns.length; k++) if (!patterns[k]) patterns[k] = blank;
    const out = {
      ...t, patterns, soloed: false, outIndex: -1, compSourceIndex: -1,
      comp: t.comp ? { ...t.comp, source: "self" } : t.comp,
    };
    if (arrange) out.arrangement = free >= 0 ? [{ slot: free, start: p.tail.bar, bars: p.endIn }] : [];
    adds.push(out);
  }
  const addKeys = new Set(adds.map(trackKey));
  const newKeys = new Set((p.session?.tracks || []).map(trackKey));
  const oldSlot = state.activePattern;
  const oldGroup = new Map(live.tracks.map(t => [trackKey(t), trackGroup(t, oldSlot)]));
  const newGroup = new Map(adds.map(t => [trackKey(t), trackGroup(t, start)]));
  if (adds.length) safeMerge({ ...live, tracks: [...live.tracks, ...adds] }, p);
  p.merged = true;
  p.phase = "work";
  p.step = 0;
  p.barsIn = 0;
  // Who comes in and who makes way, as live tracks.
  p.incoming = new Map();   // group -> tracks to let in
  p.outgoing = new Map();   // group -> old tracks to hold
  p.kicks = [];
  p.rollers = [];
  for (const t of songTracks()) {
    const k = trackKey(t);
    if (addKeys.has(k)) {
      t._held = true;
      const g = newGroup.get(k);
      if (!p.incoming.has(g)) p.incoming.set(g, []);
      p.incoming.get(g).push(t);
      continue;
    }
    if (newKeys.has(k)) continue;   // in both songs: it carries on, then takes its new part
    const g = oldGroup.get(k);
    if (g === "drums") {
      if (isKick(t)) p.kicks.push(t);
      else if (isSnare(t)) p.rollers.push(t);
      continue;
    }
    if (!p.outgoing.has(g)) p.outgoing.set(g, []);
    p.outgoing.get(g).push(t);
  }
  const meter = transportMeter();
  p.barLen = stepsPerBarForMeter(meter);
  p.entries = workInEntries(p.endIn * p.barLen, p.barLen, stepsPerBeatForMeter(meter));
  releaseSilencedTracks();
}

/** What changes on the step about to sound, `p.step` steps into the work-in. */
function workInMoment(p, nextTime, stepDur) {
  const i = p.step;
  let moved = false;
  for (const g of ["harmony", "lead", "bass"]) {
    if (p.entries[g] !== i) continue;
    for (const t of p.incoming.get(g) || []) t._held = false;
    for (const t of p.outgoing.get(g) || []) t._held = true;
    moved = true;
  }
  if (i === p.entries.last) {
    for (const t of [...p.kicks, ...p.rollers]) t._held = true;
    moved = true;
  }
  if (moved) releaseSilencedTracks();
  if (i < p.entries.last) return;
  const v = rollVelocity(i - p.entries.last, p.barLen);
  if (!v) return;
  for (const t of p.rollers) {
    if (t.muted || !t.voice || !state.tracks.includes(t)) continue;
    const at = t.steps?.findIndex(Boolean) ?? -1;
    const note = at >= 0 && Number.isFinite(t.notes?.[at]) ? t.notes[at] : 36;
    try { t.voice.hit(note, nextTime, stepDur, v); } catch {}
  }
}

/** Drop a pending transition: nothing more lands, and what already did goes back. */
export function cancelTransition() {
  const p = pending;
  if (!p) return false;
  pending = null;
  releaseDropped(p);
  endOverlap(p, true);
  unhold();
  if (!p.merged) dropStaged();
  restoreLookAhead();
  if (p.merged && p.old) safeMerge(p.old);
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
 *   "hold"   a stagger is under way: leave the queue and the
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
  if (shape !== "bridge" && !p.merged && p.toStage?.length && p.done >= p.wait && (p.deferred ?? 0) < MAX_DEFER) {
    p.deferred = (p.deferred ?? 0) + 1;
    p.wait += stepsPerBarForMeter(transportMeter());
    return null;
  }

  if (shape === "bridge") return workInStep(p, nextTime, stepDur, barLine);

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
