import { setStatus } from "./dom.js";
import { holdParamAt } from "./paramHold.js";
import { FXRack, FX_LFO_STAGE } from "./fxRack.js";
import { ANALOG_FILTER_TYPES, buildAnalogFilterNode, disposeAnalogFilterNode, setAnalogFilterModel } from "./filterModels.js";
import { state } from "./state.js";


/** @typedef {import("./types.js").Track} Track */

// A stage stays wired into the rack's chain while any enabled LFO targets one
// of its params — the LFO adds on top of a stored wet of 0 (see FXRack bypass).
function stageHeldByLfo(t, stage) {
  for (const lfoKey in FX_LFO_STAGE) {
    if (FX_LFO_STAGE[lfoKey] === stage && t.lfoConfig?.[lfoKey]?.enabled) return true;
  }
  return false;
}

export function ensureFxRack(t) {
  if (!state.audioCtx || t.fxRack) return;
  t.fxRack = new FXRack(state.audioCtx, t.fxConfig, {
    isStageHeld: (stage) => stageHeldByLfo(t, stage),
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
  if (t.muted) return false;
  if (!soloAudible) return true;
  if (soloAudible.has(t)) return true;
  if (t.engineKey !== "bus") return false;
  // A bus fed by an audible track is audible itself.
  for (const src of soloAudible) {
    const seen = new Set();
    let cur = src;
    while (cur?.out && cur.out !== "master" && !seen.has(cur.id)) {
      seen.add(cur.id);
      cur = trackById(cur.out);
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
  for (const t of state.tracks) {
    if (!t.fxRack) continue;
    try { t.fxRack.setNoiseBedActive(noiseBedActive(t, soloAudible)); } catch {}
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
  const seen = new Set();
  let cur = trackById(busId);
  while (cur) {
    if (cur === t || seen.has(cur.id)) return true;
    seen.add(cur.id);
    if (!cur.out || cur.out === "master") return false;
    cur = trackById(cur.out);
  }
  return false;
}

/**
 * The node a track's fx rack should feed. Falls back to the master bus for
 * anything that doesn't resolve to a live, loop-free bus — including a bus
 * whose voice hasn't been built yet, which is why `refreshAllTrackOutputs()`
 * runs once after `ensureAudio` has built every voice.
 * @param {Track} t @returns {AudioNode|null}
 */
export function outputTargetFor(t) {
  const master = state.masterGain || state.audioCtx?.destination || null;
  if (!t.out || t.out === "master") return master;
  const bus = trackById(t.out);
  if (!bus || bus === t || bus.engineKey !== "bus") return master;
  if (wouldFeedback(t, bus.id)) return master;
  return bus.voice?.getInputNode?.() || master;
}

/** Point a track's fx-rack output at its send target (and its own meter). */
export function routeTrackOutput(t) {
  const rack = t.fxRack;
  if (!rack) return;
  const dest = outputTargetFor(t);
  // Under the rack's fade (FXRack.softSwitch): this is called on a running
  // signal from track add / remove, an `out` change and a session load.
  rack.softSwitch(() => {
    if (t.fxRack !== rack) return;               // rebuilt in the meantime
    try { rack.output.disconnect(); } catch {}
    if (dest) { try { rack.output.connect(dest); } catch {} }
    if (t.meterAnalyser) { try { rack.output.connect(t.meterAnalyser); } catch {} }
  });
}

/**
 * Re-point every track. Cheap, and the only safe thing to do whenever a bus
 * voice is rebuilt (engine switch, session load, audio init) — the feeders were
 * connected to the *old* summing gain and nothing else would notice.
 */
export function refreshAllTrackOutputs() {
  for (const t of state.tracks) routeTrackOutput(t);
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
    if (!bus || bus === t || bus.engineKey !== "bus" || wouldFeedback(t, bus.id)) {
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

// low/mid/high are the original three bands, unmoved — an old song with only
// those three keys in t.eq still sounds exactly as it did. lomid and himid
// are new peaking bands slotted either side of mid, default gain 0, so a
// session that has never heard of them plays back unchanged.
export const EQ_BANDS = [
  { key: "low",   type: "lowshelf", freq: 250,  label: "low",    desc: "low shelf at 250Hz, ±18dB" },
  { key: "lomid", type: "peaking",  freq: 600,  q: 1.0, label: "lo mid", desc: "peaking bell at 600Hz, ±18dB" },
  { key: "mid",   type: "peaking",  freq: 1200, q: 0.8, label: "mid",    desc: "peaking bell at 1.2kHz, ±18dB" },
  { key: "himid", type: "peaking",  freq: 3000, q: 1.0, label: "hi mid", desc: "peaking bell at 3kHz, ±18dB" },
  { key: "high",  type: "highshelf", freq: 5000, label: "high",  desc: "high shelf at 5kHz, ±18dB" },
];

export class EQChain {
  constructor(ctx, cfg) {
    let prev = null;
    for (const band of EQ_BANDS) {
      const f = ctx.createBiquadFilter();
      f.type = band.type;
      f.frequency.value = band.freq;
      if (band.q != null) f.Q.value = band.q;
      f.gain.value = cfg[band.key] ?? 0;
      this[band.key] = f;
      if (prev) prev.connect(f);
      else this.input = f;
      prev = f;
    }
    this.output = prev;
  }
  setBand(name, db) {
    if (this[name]) this[name].gain.value = db;
  }
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
    const seen = new Set();
    let cur = t;
    // Bounded by `seen`: a loop can't be routed through the UI, but a
    // hand-edited song could still describe one.
    while (cur?.out && cur.out !== "master" && !seen.has(cur.id)) {
      seen.add(cur.id);
      cur = trackById(cur.out);
      if (cur?.soloed) { audible.add(t); break; }
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
  const buses = state.tracks.filter(x => x.engineKey === "bus");
  for (const t of state.tracks) {
    const sel = t.el?.querySelector(".sq-track__out");
    if (!sel) continue;
    const targets = buses.filter(b => b !== t && !wouldFeedback(t, b.id));
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
  }
  refreshBusSourceLabels();
}

// What each bus is carrying, written on the bus itself. Without it the routing
// is only visible from the sending end, and a bus whose feeders you have
// forgotten looks identical to one nothing reaches.
function refreshBusSourceLabels() {
  for (const t of state.tracks) {
    const el = t.el?.querySelector(".sq-track__bus-in");
    if (!el) continue;
    if (t.engineKey !== "bus") { el.hidden = true; el.textContent = ""; continue; }
    const feeders = state.tracks.filter(x => x !== t && String(x.out) === String(t.id));
    el.hidden = false;
    el.textContent = feeders.length
      ? `◂ ${feeders.map(x => x.name?.trim() || `track ${x.id}`).join(" · ")}`
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

