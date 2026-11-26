import { setCueResync, syncCue } from "./cue.js";
import { setStatus } from "./dom.js";
import { upgradeKnobs } from "./knob.js";
import { holdParamAt } from "./paramHold.js";
import { FXRack } from "./fxRack.js";
import { fxStageOfModKey } from "./constants.js";
import { ANALOG_FILTER_TYPES, buildAnalogFilterNode, disposeAnalogFilterNode, setAnalogFilterModel } from "./filterModels.js";
import { deckOf, deckSilent, masterBusTrack, state } from "./state.js";
import { EQ_BAND_DEFS, eqValue, splitEqKey } from "./soundDefaults.js";


/** @typedef {import("./types.js").Track} Track */

// A stage stays wired into the rack's chain while any enabled LFO targets one
// of its params — the LFO adds on top of a stored wet of 0 (see FXRack bypass).
function stageHeldByLfo(t, stage) {
  for (const lfoKey in t.lfoConfig || {}) {
    if (t.lfoConfig[lfoKey]?.enabled && fxStageOfModKey(lfoKey) === stage) return true;
  }
  return false;
}

// ...and while a macro pad holds one: a momentary pad writes the wet without
// the control's own handler, so nothing else would wire a bypassed stage in,
// and sweeping it would move the knob and nothing you can hear.
function stageHeldByMacro(t, stage) {
  for (const pad of state.macroPads || []) {
    for (const axis of ["x", "y"]) {
      for (const a of pad[axis] || []) {
        if (a.trackId === t.id && fxStageOfModKey(a.key) === stage) return true;
      }
    }
  }
  return false;
}

export function ensureFxRack(t) {
  if (!state.audioCtx || t.fxRack) return;
  t.fxRack = new FXRack(state.audioCtx, t.fxConfig, {
    isStageHeld: (stage) => stageHeldByLfo(t, stage) || stageHeldByMacro(t, stage),
  });
  if (!t.meterAnalyser) {
    t.meterAnalyser = state.audioCtx.createAnalyser();
    t.meterAnalyser.fftSize = 512;
    t.meterAnalyser.smoothingTimeConstant = 0.15;
  }
  // Off ctx.destination (where FXRack points itself) and onto wherever this
  // track sends — the master, or an fx bus track. Also taps the post-fx signal
  // for the per-track level meter.
  routeTrackOutput(t);
  // A new rack's crackle bed starts closed; open it only if the track is
  // playing right now (a rack built mid-play, e.g. an added track).
  t.fxRack.setNoiseBedActive(noiseBedActive(t, soloAudibleTracks()));
}

// ---- the vinyl crackle bed: only while the track plays -------------------
//
// The vinyl sim's crackle is a looping noise source inside the rack, so without
// this it plays whenever the master bus is open — before the first play, after
// a keyboard note has reopened the bus (wakeMasterBus), and on a muted or
// solo-silenced track while the transport runs. "Playing" here is the transport
// running AND the track being audible under the current mute / solo state. A
// bus counts as audible when something audible feeds it, since that is when it
// makes a sound.

/**
 * @param {Track} t
 * @param {Set<Track>|null} soloAudible  soloAudibleTracks(), passed in so a
 *   loop over every track computes it once.
 * @returns {boolean}
 */
export function noiseBedActive(t, soloAudible) {
  const held = !!t._bedHolds || (t._bedHeldUntil ?? 0) > (state.audioCtx?.currentTime ?? 0);
  if (!state.playing && !held) return false;
  // A note played by hand goes through mute — mute withholds the transport's
  // triggers, and this trigger was not the transport's — so the bed follows it.
  if (held && t.engineKey !== "bus") return true;
  if (t.muted || deckSilent(t)) return false;
  if (!soloAudible) return true;
  if (soloAudible.has(t)) return true;
  if (t.engineKey !== "bus") return false;
  // A bus fed by an audible track is audible itself.
  for (const src of soloAudible) {
    const seen = new Set();
    let cur = src;
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      cur = sendOf(cur);
      if (cur === t) return true;
      if (cur?.muted) break;
    }
  }
  return false;
}

// How long the beds stay open after a hand-played note ends: the note's own
// release is still sounding, and a bed that cut off before it did would read as
// the record stopping mid-note.
const BED_NOTE_TAIL = 1.5;

/**
 * A note played outside the transport — the computer keyboard, a sample
 * audition — means the track is playing for as long as it sounds, so its beds
 * open with it. With `seconds` they close that long (plus a tail) after the
 * call; without, they stay open until `releaseNoiseBed`, one per hold, which is
 * the held-key case where nothing knows the length in advance.
 * @param {Track} t @param {number} [seconds]
 */
export function holdNoiseBed(t, seconds) {
  if (!t || !state.audioCtx) return;
  if (seconds == null) {
    t._bedHolds = (t._bedHolds || 0) + 1;
  } else {
    armBedTail(t, Math.max(0, Number(seconds) || 0));
  }
  refreshNoiseBeds();
}

/** The end of a hold opened without a length: the beds close after the tail. */
export function releaseNoiseBed(t) {
  if (!t || !t._bedHolds) return;
  t._bedHolds -= 1;
  if (!t._bedHolds) armBedTail(t, 0);
  refreshNoiseBeds();
}

function armBedTail(t, seconds) {
  const until = state.audioCtx.currentTime + seconds + BED_NOTE_TAIL;
  if (until <= (t._bedHeldUntil ?? 0)) return;      // an earlier hold already outlasts this one
  t._bedHeldUntil = until;
  if (t._bedHoldTimer) clearTimeout(t._bedHoldTimer);
  t._bedHoldTimer = setTimeout(() => {
    t._bedHoldTimer = null;
    refreshNoiseBeds();
  }, (seconds + BED_NOTE_TAIL) * 1000 + 30);
}

/**
 * Re-decide every track's crackle bed. Call after anything that changes the
 * answer: play / stop, a mute or solo toggle, a session or history restore,
 * a track duplicated or removed.
 */
export function refreshNoiseBeds() {
  const soloAudible = soloAudibleTracks();
  // the cue's taps and gates turn on the same things (mute, solo, a rack rebuilt)
  syncCue(soloAudible);
  for (const t of state.tracks) {
    if (!t.fxRack) continue;
    try { t.fxRack.setNoiseBedActive(noiseBedActive(t, soloAudible)); } catch {}
  }
}

/**
 * Let go of the notes a muted (or soloed-out) track is holding. Mute withholds
 * the transport's triggers, which silences every engine whose notes end on
 * their own; a latching one (the drone's HOLD) holds until the next note, and
 * a muted track never gets one, so without this it droned on through mute and
 * solo. Called wherever `muted` / `soloed` change. Releasing, not cutting: the
 * note fades on the patch's own release, as any other note does when muted.
 */
export function releaseSilencedTracks() {
  const soloAudible = soloAudibleTracks();
  const now = state.audioCtx?.currentTime ?? 0;
  for (const t of state.tracks) {
    if (t.engineKey === "bus") continue;
    if (!t.muted && !t._clipOff && !t._leaving && !t._staged && !deckSilent(t) && (!soloAudible || soloAudible.has(t))) continue;
    try { t.voice?.releaseHeld?.(now); } catch {}
  }
}

// ---- output routing: master, or an fx bus track ------------------------
//
// `t.out` is "master" or the id of a track running the `bus` engine. Sending
// several tracks into one bus is what lets a single fx rack / mod matrix /
// automation lane act on all of them at once, which nothing else in the app can
// do: the rack and the matrix belong to a track, and the lanes belong to a
// track's pattern. The tap is the fx rack's OUTPUT, so a track keeps its own
// sound on the way to the bus, exactly as a mixer's output assignment works.

/** @param {Track} t @returns {Track|undefined} */
function trackById(id) {
  return state.tracks.find(x => String(x.id) === String(id));
}

/**
 * Would routing `t` into bus `busId` close a loop? Walks the send chain from
 * the bus onwards, and reports true if it comes back to `t` — or if it is
 * already a cycle among other tracks, which a hand-edited song could describe.
 * Web Audio would happily build that graph and it would run away.
 * @param {Track} t @param {string|number} busId @returns {boolean}
 */
export function wouldFeedback(t, busId) {
  // Every way out of a track counts: its `out` and each of its sends (below).
  // A search rather than a walk, since a track with sends has several.
  const seen = new Set();
  const stack = [trackById(busId)];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur) continue;
    if (cur === t) return true;
    if (seen.has(cur.id)) continue;
    seen.add(cur.id);
    if (cur.out && cur.out !== "master") stack.push(trackById(cur.out));
    for (const s of cur.sends || []) if (s.amt > 0) stack.push(trackById(s.bus));
  }
  return false;
}

// ---- sends: a share of a track into a bus, beside its output ------------
//
// `t.out` MOVES a track into a bus. A send copies some of it there and leaves
// the track where it was: `t.sends = [{bus: <bus track id>, amt: 0..1}]`, the
// tap the same one the output uses (the rack's output, so after the fader),
// each through a gain of its own into the bus's summing input. That is what a
// shared reverb is: three tracks at three amounts into one tank, dry signal
// untouched. Outside the p-lock snapshot, like `out`. Serialized by track
// INDEX (`sends: [{busIndex, amt}]`, written only when a track has one).

/** A send's gain: squared, so the top of the knob is unity and half is -12dB. */
export function sendGain(amt) {
  const a = Math.max(0, Math.min(1, Number(amt) || 0));
  return a * a;
}

/** The buses a track could send to: its own deck's, never itself, never a loop. */
export function sendTargets(t) {
  if (!t || t._deckBus || t._masterBus) return [];
  return state.tracks.filter(b => b.engineKey === "bus" && !b._deckBus && !b._masterBus && b !== t
    && (b._deck || "") === (t._deck || "") && !wouldFeedback(t, b.id));
}

/** A track's send amount into a bus, 0 when it has none. */
export function sendAmount(t, busId) {
  return (t.sends || []).find(s => String(s.bus) === String(busId))?.amt ?? 0;
}

/**
 * Set a track's send into a bus (0 removes it). Refuses a loop, and says so.
 * @param {Track} t @param {string|number} busId @param {number} amt 0..1
 */
export function setTrackSend(t, busId, amt) {
  const a = Math.max(0, Math.min(1, Number(amt) || 0));
  const id = String(busId);
  const list = (t.sends || []).filter(s => String(s.bus) !== id);
  if (a > 0) {
    const bus = trackById(id);
    if (!bus || bus === t || bus.engineKey !== "bus" || bus._deckBus || bus._masterBus || wouldFeedback(t, id)) {
      setStatus("that send would feed back on itself, so it was left off");
      t.sends = list;
      syncTrackSends(t);
      return;
    }
    list.push({ bus: id, amt: a });
  }
  t.sends = list;
  syncTrackSends(t);
  refreshBusSourceLabels();
}

/** A track's sends in the session format, or undefined when it has none. */
export function serializeSends(t, tracks = state.tracks) {
  const out = [];
  for (const s of t.sends || []) {
    const i = tracks.findIndex(x => String(x.id) === String(s.bus));
    if (i >= 0 && s.amt > 0) out.push({ busIndex: i, amt: s.amt });
  }
  return out.length ? out : undefined;
}

/**
 * A serialized track's sends as live ones: indices into the session resolved
 * against the tracks made from it, as `outIndex` is.
 * @param {any} list @param {Track[]} made @param {Track} t
 */
export function resolveSends(list, made, t) {
  const out = [];
  for (const s of Array.isArray(list) ? list : []) {
    const bus = Number.isInteger(s?.busIndex) ? made[s.busIndex] : null;
    const amt = Math.max(0, Math.min(1, Number(s?.amt) || 0));
    if (!bus || bus === t || bus.engineKey !== "bus" || !(amt > 0)) continue;
    if (out.some(x => x.bus === String(bus.id))) continue;
    out.push({ bus: String(bus.id), amt });
  }
  return out;
}

/** Drop any send that closes a loop (a hand-edited song could describe one). */
export function dropFeedbackSends() {
  for (const t of state.tracks) {
    if (!t.sends?.length) continue;
    t.sends = t.sends.filter(s => !wouldFeedback(t, s.bus));
  }
}

/**
 * Make the audio graph agree with `t.sends`: a gain per send from the rack's
 * output into the bus's input, faded in from silence and out to it, so a send
 * appearing or going never steps. Called from routeTrackOutput, which is what
 * runs after anything that rebuilds a voice or a rack.
 * @param {Track} t
 */
export function syncTrackSends(t) {
  const rack = t.fxRack;
  const ctx = state.audioCtx;
  if (!rack || !ctx) return;
  const now = ctx.currentTime;
  const drop = (rec) => {
    try { rec.g.gain.cancelScheduledValues(now); rec.g.gain.setTargetAtTime(0, now, 0.008); } catch {}
    setTimeout(() => { try { rec.from.disconnect(rec.g); } catch {} try { rec.g.disconnect(); } catch {} }, 80);
  };
  // A rebuilt rack has a new output node: the old gains hang off the old one.
  if (t._sendRack !== rack) {
    for (const rec of t._sendRecs?.values?.() || []) drop(rec);
    t._sendRecs = new Map();
    t._sendRack = rack;
  }
  const recs = t._sendRecs;
  const want = new Map();
  for (const s of t.sends || []) {
    const bus = trackById(s.bus);
    if (!bus || bus === t || bus.engineKey !== "bus" || bus._deckBus || bus._masterBus || !(s.amt > 0)) continue;
    if (String(t.out) === String(bus.id)) continue;      // the whole track already goes there
    if (wouldFeedback(t, bus.id)) continue;
    const input = bus.voice?.getInputNode?.();
    if (input) want.set(String(bus.id), { input, amt: s.amt });
  }
  for (const [id, rec] of recs) {
    const w = want.get(id);
    if (!w || w.input !== rec.to) { drop(rec); recs.delete(id); }   // gone, or its bus was rebuilt
  }
  for (const [id, w] of want) {
    let rec = recs.get(id);
    if (!rec) {
      const g = ctx.createGain();
      g.gain.value = 0;
      try { rack.output.connect(g); g.connect(w.input); } catch {}
      rec = { g, to: w.input, from: rack.output };
      recs.set(id, rec);
    }
    try { rec.g.gain.setTargetAtTime(sendGain(w.amt), now, 0.012); } catch {}
  }
}

/** The buses a track's signal reaches directly: its output's, and its sends'. */
function feedsOf(t) {
  const out = [];
  const main = sendOf(t);
  if (main) out.push(main);
  for (const s of t?.sends || []) {
    if (!(s.amt > 0)) continue;
    const b = trackById(s.bus);
    if (b && b !== main) out.push(b);
  }
  return out;
}

/**
 * The node a track's fx rack should feed. Falls back to the master bus for
 * anything that doesn't resolve to a live, loop-free bus — including a bus
 * whose voice hasn't been built yet, which is why `refreshAllTrackOutputs()`
 * runs once after `ensureAudio` has built every voice.
 * @param {Track} t @returns {AudioNode|null}
 */
export function outputTargetFor(t) {
  // With a second song loaded (mix.js) each deck sums into its own bus on the
  // way to the master, so "master" means the deck's bus for everything but
  // the deck buses themselves. `t.out` is untouched: the routing is the
  // mix's, not the song's.
  // `_landGain` stands in for the master after a mix has landed, until the
  // transport next stops: the landed tracks were crossfaded onto it rather
  // than re-pointed under a duck (mix.js, landDeckB).
  // And with a master fx bus on the desk (mix.js), the master itself is that
  // bus's input for everything but the bus.
  const master = deckBusFor(t)?.voice?.getInputNode?.() || (t._masterBus ? null : state._landGain || feedFor(t._deckBus ? t : "song")?.in)
    || state.masterGain || state.audioCtx?.destination || null;
  if (!t.out || t.out === "master") return master;
  const bus = trackById(t.out);
  if (!bus || bus === t || bus.engineKey !== "bus") return master;
  if (wouldFeedback(t, bus.id)) return master;
  return bus.voice?.getInputNode?.() || master;
}

/**
 * The deck bus a track's master-bound output really goes to while a mix is
 * loaded (mix.js), or null: no mix, or `t` is a deck bus itself.
 * @param {Track} t @returns {Track|null}
 */
export function deckBusFor(t) {
  const m = state.mix;
  if (!m || !t || t._deckBus || t._masterBus) return null;
  const bus = t._deck ? deckOf(t)?.bus : m.busA;
  return bus && state.tracks.includes(bus) ? bus : null;
}

/** The bus a track feeds: its send, else its deck's bus, else null (the master). */
function sendOf(t) {
  const master = () => deckBusFor(t) || (t && !t._masterBus ? masterBusTrack() : null);
  if (t?.out && t.out !== "master") return trackById(t.out) || master();
  return master();
}

/**
 * Where the mix leaves for the master: the master fx bus's input when there
 * is one (mix.js), else the master gain.
 * @returns {AudioNode|null}
 */
export function mixOutNode() {
  return feedFor("song")?.in || state.masterGain || state.audioCtx?.destination || null;
}

// ---- the master fx bus's feeds: a wet / dry per deck ---------------------------
//
// With a master fx bus on the desk, what leaves for the master goes through a
// FEED: one node in, split into a wet gain (into the master fx bus) and a dry
// gain (straight to the master gain, round it). One feed per deck's bus, keyed
// by the bus TRACK (a deck that moves up a letter keeps its own), and one for
// the song when no deck is loaded ("song": its tracks go into it directly).
// The crossfade is linear: with nothing on the bus the two paths carry the
// same signal, and a linear pair holds its level. The desk's, like the bus:
// never saved.

/** @type {Map<any, {in: GainNode, wet: GainNode, dry: GainNode, to: AudioNode|null}>} */
const feeds = new Map();
let wetSong = 1;

/** How much of a deck (its bus track, or "song") goes through the master fx bus: 0..1. */
export function masterFeedAmount(key) {
  if (!key || key === "song") return wetSong;
  if (key._mfxWet == null) key._mfxWet = key === state.mix?.busA ? wetSong : 1;
  return key._mfxWet;
}

/** Set it: 1 all through the master fx bus, 0 all round it. */
export function setMasterFeed(key, amt) {
  const a = Math.max(0, Math.min(1, Number(amt) || 0));
  if (!key || key === "song") wetSong = a;
  else { key._mfxWet = a; if (key === state.mix?.busA) wetSong = a; }
  for (const k of key === state.mix?.busA ? [key, "song"] : [key || "song"]) {
    const f = feeds.get(k);
    const now = state.audioCtx?.currentTime ?? 0;
    if (!f) continue;
    try { f.wet.gain.setTargetAtTime(a, now, 0.015); f.dry.gain.setTargetAtTime(1 - a, now, 0.015); } catch {}
  }
}

/** A deck's feed, made on first use and kept pointed at the bus's current input. Null: no master fx bus. */
function feedFor(key) {
  const ctx = state.audioCtx;
  const to = masterBusTrack()?.voice?.getInputNode?.();
  if (!ctx || !to || !state.masterGain) return null;
  let f = feeds.get(key);
  if (!f) {
    f = { in: ctx.createGain(), wet: ctx.createGain(), dry: ctx.createGain(), to: null };
    const a = masterFeedAmount(key);
    f.wet.gain.value = a;
    f.dry.gain.value = 1 - a;
    f.in.connect(f.wet);
    f.in.connect(f.dry);
    f.dry.connect(state.masterGain);
    feeds.set(key, f);
  }
  if (f.to !== to) {                               // the bus's voice was rebuilt
    try { f.wet.disconnect(); } catch {}
    try { f.wet.connect(to); } catch {}
    f.to = to;
  }
  return f;
}

/** Let go of the feeds nothing uses: a deck's that has gone, or all of them once the bus has. */
function pruneFeeds() {
  if (!feeds.size) return;
  const all = !state.tracks.some(t => t._masterBus);
  for (const [k, f] of feeds) {
    if (!all && (k === "song" || state.tracks.includes(k))) continue;
    for (const n of [f.in, f.wet, f.dry]) { try { n.disconnect(); } catch {} }
    feeds.delete(k);
  }
}

export function routeTrackOutput(t, swap = false) {
  const rack = t.fxRack;
  if (!rack) return;
  const dest = outputTargetFor(t);
  const from = rack._routedTo;
  // Already going there: nothing to do. Every merge (an undo, a jam patch, a
  // compose audition, a track built ahead of a transition) re-points every
  // track, and each re-point ducks the track under the fade below for ~18ms,
  // so re-pointing a track that was not moving was the whole mix dipping on
  // every one of them. A bus rebuilt has a new summing node, so its feeders'
  // `dest` is a different object and they are still re-pointed.
  syncTrackSends(t);
  if (t._cue) syncCue(soloAudibleTracks());      // a rebuilt rack has a new tap point
  if (rack._routedTo === dest && rack._routedMeter === t.meterAnalyser) return;
  // `swap`: the new path carries the same signal at the same level as the
  // old one (the master, or a deck's bus at unity: mix.js), so there is
  // nothing to hide under a fade, and the fade itself, on every track of a
  // song at once, was a dip in the whole mix. The new connection is made
  // before the old one is taken away, in one task.
  if (swap && from && dest && rack._routedMeter === t.meterAnalyser && !rack._softTimer) {
    rack._routedTo = dest;
    try { rack.output.connect(dest); } catch {}
    try { rack.output.disconnect(from); } catch {}
    return;
  }
  rack._routedTo = dest;
  rack._routedMeter = t.meterAnalyser;
  // Under the rack's fade (FXRack.softSwitch): this is called on a running
  // signal from track add / remove, an `out` change and a session load.
  rack.softSwitch(() => {
    if (t.fxRack !== rack) return;               // rebuilt in the meantime
    try { rack.output.disconnect(); } catch {}
    if (dest) { try { rack.output.connect(dest); } catch {} }
    if (t.meterAnalyser) { try { rack.output.connect(t.meterAnalyser); } catch {} }
    // the sends hang off the same node the line above just cleared
    if (t._sendRack === rack) for (const rec of t._sendRecs?.values?.() || []) { try { rack.output.connect(rec.g); } catch {} }
  });
}

/**
 * Re-point every track. Cheap, and the only safe thing to do whenever a bus
 * voice is rebuilt (engine switch, session load, audio init) — the feeders were
 * connected to the *old* summing gain and nothing else would notice.
 */
export function refreshAllTrackOutputs({ swap = false } = {}) {
  // A track on its way out (a transition's or a mix's `_leaving`) stays where
  // it is until it is removed: re-pointing it could only make it heard again.
  pruneFeeds();
  for (const t of state.tracks) if (!t._leaving) routeTrackOutput(t, swap);
}

/**
 * Set a track's send. Refuses anything that would feed back, leaving it on the
 * master and saying so rather than silently doing nothing.
 * @param {Track} t @param {string} out  "master" or a bus track id
 */
export function setTrackOutput(t, out) {
  const next = out && out !== "master" ? String(out) : "master";
  if (next !== "master") {
    const bus = trackById(next);
    if (!bus || bus === t || bus.engineKey !== "bus" || bus._masterBus || wouldFeedback(t, bus.id)) {
      t.out = "master";
      routeTrackOutput(t);
      refreshOutputSelects();
      setStatus("that send would feed back on itself — left on master");
      return;
    }
  }
  t.out = next;
  routeTrackOutput(t);
  refreshOutputSelects();
}

// cutoff slider [0,1] → freq 60-20000 Hz (log)
export function cutoffToHz(v) { return 60 * Math.pow(20000 / 60, Math.max(0, Math.min(1, v))); }
// reson slider [0,1] → Q 0.5-20
export function resonToQ(v) { return 0.5 + Math.max(0, Math.min(1, v)) * 19.5; }

const isAnalogFilterType = (type) => ANALOG_FILTER_TYPES.includes(type);

export function ensureFilter(t) {
  if (!state.audioCtx || t.filterNode) return;
  const ctx = state.audioCtx;
  if (isAnalogFilterType(t.filter.type)) {
    const node = buildAnalogFilterNode(ctx, t.filter.type, cutoffToHz(t.filter.cutoff), resonToQ(t.filter.reson));
    if (node) { t.filterNode = node; return; }
    // Worklet not registered yet — fall through to the plain lowpass so the
    // track is never silent, the same fallback every other worklet here
    // makes; the next call (once it registers) builds the real thing.
  }
  const f = ctx.createBiquadFilter();
  f.type = isAnalogFilterType(t.filter.type) ? "lowpass" : (t.filter.type || "lowpass");
  f.frequency.value = cutoffToHz(t.filter.cutoff);
  f.Q.value = resonToQ(t.filter.reson);
  t.filterNode = f;
}

/** Tear down whatever's in `t.filterNode`, native or worklet, and null the
 *  slot so ensureFilter will build fresh. */
function disposeFilterNode(t) {
  if (!t.filterNode) return;
  if (t.filterNode instanceof AudioWorkletNode) disposeAnalogFilterNode(t.filterNode);
  else try { t.filterNode.disconnect(); } catch {}
  t.filterNode = null;
}

// The bands are data (EQ_BAND_DEFS, soundDefaults.js), so the song builder
// and the drawn eq read the same table. Frequency and Q are per track too
// (`lowFreq`, `lomidQ` ...), moved by dragging a band on the curve.
export const EQ_BANDS = EQ_BAND_DEFS;

export class EQChain {
  constructor(ctx, cfg) {
    let prev = null;
    for (const band of EQ_BANDS) {
      const f = ctx.createBiquadFilter();
      f.type = band.type;
      f.frequency.value = eqValue(cfg, band.key + "Freq");
      if (band.q != null) f.Q.value = eqValue(cfg, band.key + "Q");
      f.gain.value = eqValue(cfg, band.key);
      this[band.key] = f;
      if (prev) prev.connect(f);
      else this.input = f;
      prev = f;
    }
    this.output = prev;
  }
  /** Any eq key: a band's gain, `<band>Freq` or `<band>Q`. Ramped over a few
   *  ms, since a drag moves these while the track plays. */
  setBand(key, v) {
    const s = splitEqKey(key);
    const f = s && this[s.band.key];
    if (!f) return;
    const param = s.field === "freq" ? f.frequency : s.field === "q" ? f.Q : f.gain;
    const now = f.context.currentTime;
    try {
      param.cancelScheduledValues(now);
      param.setValueAtTime(param.value, now);
      param.linearRampToValueAtTime(v, now + 0.012);
    } catch { param.value = v; }
  }
}

/**
 * An analyser on the eq's output, for the drawn eq's spectrum: made the first
 * time the graph is on screen with audio running, and moved if the eq chain
 * was rebuilt. A fan-out, so it changes nothing about the sound.
 */
export function eqAnalyser(t) {
  const out = t.eqNode?.output;
  if (!out || !state.audioCtx) return null;
  if (t._eqAnalyser && t._eqAnalyserFrom === out) return t._eqAnalyser;
  if (!t._eqAnalyser) {
    t._eqAnalyser = state.audioCtx.createAnalyser();
    t._eqAnalyser.fftSize = 4096;
    t._eqAnalyser.smoothingTimeConstant = 0.8;
  }
  try { out.connect(t._eqAnalyser); } catch { return null; }
  t._eqAnalyserFrom = out;
  return t._eqAnalyser;
}

export function ensureEQ(t) {
  if (!state.audioCtx || t.eqNode) return;
  t.eqNode = new EQChain(state.audioCtx, t.eq);
}

// Per-track compressor with two modes:
//   - "self": native DynamicsCompressorNode inline on the track's signal
//   - "<trackId>": envelope-follower ducking driven by another track's output
export class TrackCompressor {
  constructor(ctx, config) {
    this.ctx = ctx;
    this.config = { ...config };
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.bypass = ctx.createGain();
    this.bypass.gain.value = 1;
    this.input.connect(this.bypass);
    this.bypass.connect(this.output);
    this._mode = "off";
    this._nativeComp = null;
    this._duckGain = null;
    this._analyser = null;
    this._rafId = null;
    this._sideSource = null;
    this._currentDuck = 1;
  }
  _teardown() {
    if (this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = null; }
    try { this.input.disconnect(); } catch {}
    try { this.bypass.disconnect(); } catch {}
    if (this._nativeComp) { try { this._nativeComp.disconnect(); } catch {} this._nativeComp = null; }
    if (this._duckGain)   { try { this._duckGain.disconnect();   } catch {} this._duckGain = null; }
    if (this._analyser && this._sideSource) {
      try { this._sideSource.disconnect(this._analyser); } catch {}
    }
    if (this._analyser) { try { this._analyser.disconnect(); } catch {} this._analyser = null; }
    this._sideSource = null;
  }
  configure({ enabled, sourceNode, threshold, ratio, attack, release, knee }) {
    if (threshold != null) this.config.threshold = threshold;
    if (ratio != null)     this.config.ratio = ratio;
    if (attack != null)    this.config.attack = attack;
    if (release != null)   this.config.release = release;
    if (knee != null)      this.config.knee = knee;
    this._teardown();
    this.input = this.input;   // preserve reference (recreate connections below)
    if (!enabled) {
      // straight passthrough: input → output
      this.bypass = this.ctx.createGain();
      this.input.connect(this.bypass);
      this.bypass.connect(this.output);
      this._mode = "off";
      return;
    }
    if (!sourceNode) {
      // self-compression with native node
      const c = this.ctx.createDynamicsCompressor();
      c.threshold.value = this.config.threshold ?? -20;
      c.ratio.value     = this.config.ratio ?? 4;
      c.attack.value    = this.config.attack ?? 0.01;
      c.release.value   = this.config.release ?? 0.2;
      c.knee.value      = this.config.knee ?? 6;
      this.input.connect(c);
      c.connect(this.output);
      this._nativeComp = c;
      this._mode = "self";
      return;
    }
    // external sidechain: tap source audio into analyser, run envelope follower,
    // apply gain reduction to a ducking gain on our signal path.
    const a = this.ctx.createAnalyser();
    a.fftSize = 256;
    a.smoothingTimeConstant = 0.0;
    try { sourceNode.connect(a); } catch {}
    this._analyser = a;
    this._sideSource = sourceNode;
    const g = this.ctx.createGain();
    g.gain.value = 1;
    this.input.connect(g);
    g.connect(this.output);
    this._duckGain = g;
    this._mode = "sidechain";
    this._tickSidechain();
  }
  _tickSidechain = () => {
    if (!this._analyser || !this._duckGain) return;
    // One buffer for the life of the follower, not one per frame.
    if (!this._scBuf || this._scBuf.length !== this._analyser.fftSize) this._scBuf = new Float32Array(this._analyser.fftSize);
    const buf = this._scBuf;
    this._analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    const rms = Math.sqrt(sum / buf.length);
    const db = 20 * Math.log10(Math.max(rms, 1e-6));
    const thr = this.config.threshold ?? -20;
    const ratio = Math.max(1, this.config.ratio ?? 4);
    const over = db - thr;
    const reducedDb = over > 0 ? over - over / ratio : 0;
    const target = Math.pow(10, -reducedDb / 20);
    const tc = target < this._currentDuck
      ? Math.max(0.001, this.config.attack ?? 0.01)
      : Math.max(0.01, this.config.release ?? 0.2);
    try { this._duckGain.gain.setTargetAtTime(target, this.ctx.currentTime, tc); } catch {}
    this._currentDuck = target;
    this._rafId = requestAnimationFrame(this._tickSidechain);
  };
  dispose() {
    this._teardown();
    try { this.output.disconnect(); } catch {}
  }
}
export { defaultCompConfig } from "./soundDefaults.js";
export function ensureCompressor(t) {
  if (!state.audioCtx || t.compNode) return;
  t.compNode = new TrackCompressor(state.audioCtx, t.comp);
  applyCompressorConfig(t);
}

export function applyCompressorConfig(t) {
  if (!t.compNode) return;
  let sourceNode = null;
  if (t.comp.enabled && t.comp.source && t.comp.source !== "self") {
    const src = state.tracks.find(x => String(x.id) === String(t.comp.source));
    if (src?.voice?.getOutputNode) sourceNode = src.voice.getOutputNode();
  }
  t.compNode.configure({
    enabled: t.comp.enabled,
    sourceNode,
    threshold: t.comp.threshold,
    ratio: t.comp.ratio,
    attack: t.comp.attack,
    release: t.comp.release,
    knee: t.comp.knee,
  });
}

export function setEQ(t, band, db) {
  t.eq[band] = db;
  if (t.eqNode) t.eqNode.setBand(band, db);
}

/**
 * Wire a track's voice through filter -> eq -> compressor -> fx -> master.
 * @param {Track} t
 */
export function routeVoiceToRack(t) {
  if (!t.voice || !t.fxRack) return;
  ensureFilter(t);
  ensureEQ(t);
  ensureCompressor(t);
  const dest = t.fxRack.input;
  const eqIn    = t.eqNode?.input;
  const eqOut   = t.eqNode?.output;
  const compIn  = t.compNode?.input;
  const compOut = t.compNode?.output;
  // clear existing wiring
  if (t.filterNode) try { t.filterNode.disconnect(); } catch {}
  if (eqOut)        try { eqOut.disconnect(); } catch {}
  if (compOut)      try { compOut.disconnect(); } catch {}
  // build chain: voice → filter? → eq? → comp? → fxRack.input
  const nodes = [];
  if (t.filterNode) nodes.push({ in: t.filterNode, out: t.filterNode });
  if (t.eqNode)     nodes.push({ in: eqIn, out: eqOut });
  if (t.compNode)   nodes.push({ in: compIn, out: compOut });
  for (let i = 0; i < nodes.length - 1; i++) {
    try { nodes[i].out.connect(nodes[i + 1].in); } catch {}
  }
  const last = nodes[nodes.length - 1];
  if (last) {
    try { last.out.connect(dest); } catch {}
  }
  const firstIn = nodes[0]?.in || dest;
  if (t.voice.setDestination) t.voice.setDestination(firstIn);
  // A compressor keyed off this track taps its voice's output node, connected
  // once when that compressor was configured. Every voice rebuild (an engine
  // switch, a patch, the first play building voices in list order) comes
  // through here, and left alone each one silently dropped the ducking.
  for (const x of state.tracks) {
    if (x !== t && x.comp?.enabled && String(x.comp.source) === String(t.id)) applyCompressorConfig(x);
  }
}

/**
 * Schedule the filter ADSR sweep for one hit on a track.
 * @param {Track} t @param {number} time @param {number} duration
 */
export function fireFilterEnv(t, time, duration) {
  const f = t.filterNode;
  if (!f) return;
  const base = Math.max(40, cutoffToHz(t.filter.cutoff));   // user-set cutoff is the OPEN point
  // Q belongs to setFilter / the reson lane / the reson LFO; it used to be
  // written here on every hit as well, which is a coefficient step into a
  // biquad at up to Q 20, and one that silently overrode the lane. Only put
  // it right if something left it wrong, and never under a lane.
  if (!t.automation?.reson?.enabled) {
    const q = resonToQ(t.filter.reson);
    if (Math.abs(f.Q.value - q) > 1e-3) f.Q.setTargetAtTime(q, time, 0.005);
  }
  const env = t.filter.env;
  if (env <= 0.001) {
    // No envelope: the cutoff lane, if there is one, owns the frequency and
    // has just scheduled this step's ramp (runAutomationForStep runs first).
    if (t.automation?.cutoff?.enabled) return;
    holdParamAt(f.frequency, time);
    f.frequency.exponentialRampToValueAtTime(base, time + 0.003);
    return;
  }
  // env closes the filter down from base; at env=1 that's -6 octaves below cutoff
  const closed = Math.max(40, base * Math.pow(0.5, env * 6));
  // sustain level = linear (log-space) interpolation between closed and base
  const susLevel = Math.max(40, Math.min(20000,
    closed * Math.pow(base / closed, Math.max(0, Math.min(1, t.filter.sustain)))
  ));
  const atk = 0.001 + t.filter.attack * 0.5;     // 1ms – 500ms
  const dec = 0.005 + t.filter.decay   * 0.8;    // 5ms – 800ms
  const rel = 0.01  + t.filter.release * 2;      // 10ms – 2s
  // The filter is the TRACK's, shared by every note on it, so at the moment
  // this note starts the previous one is usually still ringing through it —
  // and the envelope used to begin by snapping the cutoff straight to `closed`
  // (up to six octaves down) with `setValueAtTime`. Through a biquad at high Q
  // that step is a thump on every gated step, the most audible click in the
  // engine. Hold whatever the frequency is doing at `time` and glide into the
  // closed point over 3ms instead: the sweep is still all but instant, but it
  // is a sweep, and the attack starts from there.
  const closeEnd = time + 0.003;
  const atkEnd = closeEnd + atk;
  const decEnd = atkEnd + dec;
  const sustainEnd = Math.max(decEnd + 0.005, time + Math.max(0.05, duration));
  const relEnd = sustainEnd + rel;
  holdParamAt(f.frequency, time);
  f.frequency.exponentialRampToValueAtTime(closed, closeEnd);
  f.frequency.exponentialRampToValueAtTime(base, atkEnd);
  f.frequency.exponentialRampToValueAtTime(susLevel, decEnd);
  f.frequency.setValueAtTime(susLevel, sustainEnd);
  f.frequency.exponentialRampToValueAtTime(closed, relEnd);
}

/**
 * Update one filter/env parameter and apply it live.
 * @param {Track} t @param {string} key @param {number|string} val
 */
export function setFilter(t, key, val) {
  t.filter[key] = val;
  if (!t.filterNode) return;
  if (key === "type") {
    const wantAnalog = isAnalogFilterType(val);
    const isAnalog = t.filterNode instanceof AudioWorkletNode;
    if (wantAnalog === isAnalog) {
      // Same kind of node either way — a live switch, no rebuild, matching
      // silverbox's `wave` and contagion's `mode1`/`route` switches.
      if (wantAnalog) setAnalogFilterModel(t.filterNode, val);
      else t.filterNode.type = val;
    } else {
      // Crossing between a native biquad and an analog-model worklet needs a
      // different KIND of node — dispose the old one and route the new one
      // into the chain the way ensureFilter did originally. cutoff/reson are
      // reapplied below in the same call, same order signal.js already
      // writes them in on a fresh build.
      disposeFilterNode(t);
      ensureFilter(t);
      routeVoiceToRack(t);
    }
  }
  if (key === "cutoff") {
    // bump base between hits; active envelope automation will continue until next hit schedules new values
    t.filterNode.frequency.cancelScheduledValues(state.audioCtx.currentTime);
    t.filterNode.frequency.setValueAtTime(cutoffToHz(val), state.audioCtx.currentTime);
  }
  if (key === "reson") t.filterNode.Q.value = resonToQ(val);
}

/**
 * The tracks a solo should leave audible. Normally that is just the soloed
 * ones — but a bus makes no sound of its own, so soloing one under the literal
 * reading would leave the session silent, when "solo the reverb bus" plainly
 * means "just the things going through it". So a track is audible if it is
 * soloed, or if its send chain reaches something that is.
 * @returns {Set<Track>|null}  null when nothing is soloed.
 */
export function soloAudibleTracks() {
  const soloed = state.tracks.filter(t => t.soloed);
  if (!soloed.length) return null;
  const audible = new Set(soloed);
  for (const t of state.tracks) {
    if (audible.has(t)) continue;
    // Bounded by `seen`: a loop can't be routed through the UI, but a
    // hand-edited song could still describe one. `feedsOf` follows a deck's
    // bus too (mix.js), so soloing a deck keeps everything on it, and a
    // track's sends, so soloing a shared reverb keeps what is sent to it.
    const seen = new Set([t.id]);
    const stack = feedsOf(t);
    while (stack.length) {
      const cur = stack.pop();
      if (!cur || seen.has(cur.id)) continue;
      if (cur.soloed) { audible.add(t); break; }
      seen.add(cur.id);
      stack.push(...feedsOf(cur));
    }
  }
  return audible;
}

/**
 * Repopulate every track's "out" dropdown from the bus tracks that currently
 * exist, and repaint each bus's list of what feeds it. Also the place a send
 * whose bus has gone away (removed, or switched to another engine) falls back
 * to the master — the routing itself already falls back in `outputTargetFor`,
 * but the stored value has to follow or a save would carry the dead send.
 *
 * The control is hidden while there is nowhere but the master to go, so a
 * session that never uses a bus never grows a row of pointless selects.
 */
export function refreshOutputSelects() {
  // A deck bus (mix.js) is never a send, and a track only sends within its deck.
  const buses = state.tracks.filter(x => x.engineKey === "bus" && !x._deckBus && !x._masterBus);
  for (const t of state.tracks) {
    const sel = t.el?.querySelector(".sq-track__out");
    if (!sel) continue;
    const targets = t._deckBus || t._masterBus ? [] : buses.filter(b => b !== t && (b._deck || "") === (t._deck || "") && !wouldFeedback(t, b.id));
    if (t.out && t.out !== "master" && !targets.some(b => String(b.id) === String(t.out))) {
      t.out = "master";
    }
    const field = sel.closest(".sq-field");
    if (field) field.hidden = targets.length === 0;
    sel.replaceChildren();
    const optMaster = document.createElement("option");
    optMaster.value = "master";
    optMaster.textContent = "master";
    sel.appendChild(optMaster);
    for (const b of targets) {
      const opt = document.createElement("option");
      opt.value = String(b.id);
      opt.textContent = b.name || `bus ${b.id}`;
      sel.appendChild(opt);
    }
    sel.value = t.out || "master";
    // Sends: a send whose bus has gone goes with it, and the track gets a
    // knob per bus it could send to (not the one its whole output is on).
    if (t.sends?.length) {
      const kept = t.sends.filter(s => targets.some(b => String(b.id) === String(s.bus)));
      if (kept.length !== t.sends.length) { t.sends = kept; syncTrackSends(t); }
    }
    paintSendKnobs(t, targets.filter(b => String(b.id) !== String(t.out)));
  }
  refreshBusSourceLabels();
}

/**
 * A track's send knobs, one per bus it could send to, in `.sq-track__sends`.
 * Rebuilt only when the list of buses (or a name) moved: this runs after every
 * merge, and a knob being dragged must not be replaced under the pointer.
 * @param {Track} t @param {Track[]} buses
 */
function paintSendKnobs(t, buses) {
  const box = t.el?.querySelector(".sq-track__sends");
  if (!box) return;
  box.hidden = buses.length === 0;
  const sig = buses.map(b => `${b.id}:${b.name || ""}`).join("|");
  if (box.dataset.sig !== sig) {
    box.dataset.sig = sig;
    box.replaceChildren();
    for (const b of buses) {
      const field = document.createElement("div");
      field.className = "sq-field sq-send";
      const label = document.createElement("label");
      label.textContent = `→ ${b.name?.trim() || `bus ${b.id}`}`;
      const input = document.createElement("input");
      input.type = "range"; input.min = "0"; input.max = "1"; input.step = "0.01";
      input.className = "p-send";
      input.dataset.bus = String(b.id);
      input.title = `send: how much of this track also goes into ${b.name?.trim() || "this bus"}, beside where its output goes. 0 is off`;
      input.setAttribute("aria-label", `send to ${b.name?.trim() || "bus"}`);
      input.value = String(sendAmount(t, b.id));
      input.addEventListener("input", () => setTrackSend(t, b.id, Number(input.value)));
      field.append(label, input);
      box.appendChild(field);
    }
    upgradeKnobs(box);
    return;
  }
  for (const input of box.querySelectorAll(".p-send")) {
    const v = String(sendAmount(t, input.dataset.bus));
    if (input.value !== v && !input.matches(":active")) input.value = v;
  }
}

// What each bus is carrying, written on the bus itself. Without it the routing
// is only visible from the sending end, and a bus whose feeders you have
// forgotten looks identical to one nothing reaches.
function refreshBusSourceLabels() {
  for (const t of state.tracks) {
    const el = t.el?.querySelector(".sq-track__bus-in");
    if (!el) continue;
    if (t.engineKey !== "bus") { el.hidden = true; el.textContent = ""; continue; }
    const nm = (x) => x.name?.trim() || `track ${x.id}`;
    const feeders = state.tracks.filter(x => x !== t && sendOf(x) === t).map(nm);
    for (const x of state.tracks) {
      const a = x !== t && sendOf(x) !== t ? sendAmount(x, t.id) : 0;
      if (a > 0) feeders.push(`${nm(x)} ${Math.round(a * 100)}%`);
    }
    el.hidden = false;
    el.textContent = feeders.length
      ? `◂ ${feeders.join(" · ")}`
      : "◂ nothing sent here yet";
    el.title = feeders.length
      ? `${feeders.length} track${feeders.length === 1 ? "" : "s"} routed into this bus`
      : "set another track's out to this bus to send it here";
  }
}

// Resize just one pattern's step arrays. Each pattern can have an independent
// length. `t.length` mirrors the currently-aliased pattern's length so the rest
// of the codebase stays aware of "current pattern's steps" via t.length.
export function refreshCompSourceDropdowns() {
  for (const t of state.tracks) {
    const sel = t.el?.querySelector(".sq-comp__source");
    if (!sel) continue;
    // A source that names no live track falls back to self, in the STATE and in
    // the audio graph, not just in the select. Leaving the dead id in place is
    // worse than it looks: applyCompressorConfig finds no source node and takes
    // the `!sourceNode` branch, so the track silently becomes self-compressed
    // while the panel claims a sidechain. Reconfiguring here rather than at each
    // call site is what makes this true wherever the track list changes —
    // removing a track, loading a session, applying a patch.
    if (t.comp.source && t.comp.source !== "self" &&
        !state.tracks.some(x => x !== t && String(x.id) === String(t.comp.source))) {
      t.comp.source = "self";
      if (state.ready) applyCompressorConfig(t);
    }
    const cur = t.comp.source || "self";
    sel.replaceChildren();
    const optSelf = document.createElement("option");
    optSelf.value = "self"; optSelf.textContent = "self";
    sel.appendChild(optSelf);
    for (const other of state.tracks) {
      if (other === t) continue;
      const opt = document.createElement("option");
      opt.value = String(other.id);
      opt.textContent = other.name || `track ${other.id}`;
      sel.appendChild(opt);
    }
    sel.value = cur;
  }
}


setCueResync(() => syncCue(soloAudibleTracks()));
