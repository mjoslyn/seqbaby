import { setStatus } from "./dom.js";
import { FXRack, FX_LFO_STAGE } from "./fxRack.js";
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
  if (!t.fxRack) return;
  try { t.fxRack.output.disconnect(); } catch {}
  const dest = outputTargetFor(t);
  if (dest) { try { t.fxRack.output.connect(dest); } catch {} }
  if (t.meterAnalyser) { try { t.fxRack.output.connect(t.meterAnalyser); } catch {} }
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

export function ensureFilter(t) {
  if (!state.audioCtx || t.filterNode) return;
  const ctx = state.audioCtx;
  const f = ctx.createBiquadFilter();
  f.type = "lowpass";
  f.frequency.value = cutoffToHz(t.filter.cutoff);
  f.Q.value = resonToQ(t.filter.reson);
  t.filterNode = f;
}

export class EQChain {
  constructor(ctx, cfg) {
    this.low = ctx.createBiquadFilter();
    this.low.type = "lowshelf";
    this.low.frequency.value = 250;
    this.low.gain.value = cfg.low ?? 0;
    this.mid = ctx.createBiquadFilter();
    this.mid.type = "peaking";
    this.mid.frequency.value = 1200;
    this.mid.Q.value = 0.8;
    this.mid.gain.value = cfg.mid ?? 0;
    this.high = ctx.createBiquadFilter();
    this.high.type = "highshelf";
    this.high.frequency.value = 5000;
    this.high.gain.value = cfg.high ?? 0;
    this.low.connect(this.mid);
    this.mid.connect(this.high);
    this.input = this.low;
    this.output = this.high;
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
    const buf = new Float32Array(this._analyser.fftSize);
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

export function defaultCompConfig() {
  return { enabled: false, source: "self", threshold: -20, ratio: 4, attack: 0.01, release: 0.2, knee: 6 };
}

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
  f.Q.value = resonToQ(t.filter.reson);
  const env = t.filter.env;
  if (env <= 0.001) {
    f.frequency.cancelScheduledValues(time);
    f.frequency.setValueAtTime(base, time);
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
  const atkEnd = time + atk;
  const decEnd = atkEnd + dec;
  const sustainEnd = Math.max(decEnd + 0.005, time + Math.max(0.05, duration));
  const relEnd = sustainEnd + rel;
  f.frequency.cancelScheduledValues(time);
  f.frequency.setValueAtTime(closed, time);
  f.frequency.exponentialRampToValueAtTime(base, atkEnd);
  f.frequency.exponentialRampToValueAtTime(susLevel, decEnd);
  f.frequency.setValueAtTime(susLevel, sustainEnd);
  f.frequency.exponentialRampToValueAtTime(closed, relEnd);
}

/**
 * Update one filter/env parameter and apply it live.
 * @param {Track} t @param {string} key @param {number} val
 */
export function setFilter(t, key, val) {
  t.filter[key] = val;
  if (!t.filterNode) return;
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

