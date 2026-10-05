// ---- Repeat: a beat repeat and a slicer, on the transport's grid ------------
// One rack stage with two characters, both of which only mean anything on the
// beat, so both are clocked by the sequencer rather than by a free-running LFO:
//
//   repeat   every INTERVAL, at OFFSET into it, with CHANCE: capture GRID's
//            worth of what is playing and repeat it for GATE. Each repeat can
//            drop in PITCH and lose level (DECAY), and VARY lets each trigger
//            pick a grid either side of the knob. Ableton's Beat Repeat, more
//            or less, and the stutter / roll of every glitch plugin.
//
//   slice    the track is cut into GRID-sized slices as it plays. At each
//            slice, with CHANCE, the slice is swapped for a different one from
//            the INTERVAL-long window before it, held for GATE. VARY is the
//            chance a swapped slice plays backwards, PITCH transposes it down,
//            DECAY chops it short. A sample slicer that reshuffles a loop live.
//
//   in ──┬──────────────────────────────────────────┬─▶ mix ─▶ out
//        └─▶ ring buffer (10s) ─▶ read head(s) ──────┘
//                    ▲
//                    └── the transport's step clock (postMessage per step)
//
// - **The clock is the transport's own.** transport.js posts every 16th it
//   schedules (`clock`: the step's audio time, its global tick, its length),
//   ahead of time, as the lookahead does for notes. The processor queues them,
//   snaps its step position to each one at the exact frame it lands, and runs
//   on between them. So the grid is the sequencer's grid sample for sample,
//   a tempo change takes effect on the next step, and a jam's start on a
//   shared tick lines the triggers up too. With no clock for four steps the
//   transport has stopped, and the stage passes its input through.
// - **Every decision is a hash of (step, which decision)**, never a running
//   random generator: the same song replays the same repeats, as the chance
//   generator and the random-square LFO do (chanceGen.js, lfo.js).
// - **Insert, not mix.** While a repeat holds, the processor's output is the
//   repeat instead of the input; otherwise it is the input. The rack's linear
//   crossfade around the node then makes `wet` the classic mode switch: 1 is
//   an insert (the repeat replaces the beat), half is a mix over it.
// - **Every edge is faded** (2ms): a slice's head and tail, the entry into a
//   run and the way out of it, a mode switch. A repeat is a loop point in the
//   middle of a waveform, and without the fades every one of them clicks.
// - The discrete knobs (interval, offset, gate, grid) are 0..1 AudioParams
//   that pick from lists, read at the moment a decision is made: an LFO on
//   the grid is a ratchet that speeds up and slows down, a lane on the chance
//   is a fill on the last bar.
//
// Runs as an AudioWorklet because it is a buffer and a read head with a
// sample-accurate clock, which native nodes have no way to express. Registered
// from a Blob URL like the other worklets here.

export { REPEAT_MODES, REPEAT_KNOBS, REPEAT_KNOB_LABELS } from "./soundDefaults.js";
import {
  REPEAT_GATE, REPEAT_GRID, REPEAT_GRID_LABELS, REPEAT_INTERVAL, REPEAT_KNOBS, REPEAT_MODES, defaultFxConfig,
} from "./soundDefaults.js";

// The lists and the knobs' defaults go into the processor as a prelude, so the
// panel's readouts and the processor's choices come from one table. Joined as
// a plain string: the processor source below is a template literal, and must
// stay free of backticks and dollar-brace (see CLAUDE.md's gotchas).
const REPEAT_TABLES =
  "const GRID = " + JSON.stringify(REPEAT_GRID) + ";\n" +
  "const INTERVAL = " + JSON.stringify(REPEAT_INTERVAL) + ";\n" +
  "const GATE = " + JSON.stringify(REPEAT_GATE) + ";\n" +
  "const KNOB_DEFAULTS = " + JSON.stringify(REPEAT_KNOBS.map((k) => [k, defaultFxConfig().repeat[k]])) + ";\n";

const REPEAT_PROCESSOR_SOURCE = REPEAT_TABLES + `
const BUF_SECONDS = 10;     // the longest a slice can reach back, and a repeat hold
const FADE_SECONDS = 0.002; // every edge
const QN = 64;              // clock events in flight (the lookahead is a few steps)
function clamp(x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }
function pickIndex(list, v) { return Math.round(clamp(v, 0, 1) * (list.length - 1)); }
function pick(list, v) { return list[pickIndex(list, v)]; }
// 0..1 from (n, salt): the same number every time a step comes round.
function hash(n, salt) {
  let h = Math.imul(n | 0, 0x9e3779b1) ^ Math.imul((salt | 0) + 0x632be5ab, 0x85ebca77);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

class RepeatProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return KNOB_DEFAULTS.map((e) => ({ name: e[0], defaultValue: e[1], minValue: 0, maxValue: 1, automationRate: "k-rate" }));
  }

  constructor(options) {
    super();
    const o = options && options.processorOptions ? options.processorOptions : {};
    this.alive = true;
    this.mode = clamp(o.mode | 0, 0, 1);
    this.pend = -1;
    this.N = Math.round(BUF_SECONDS * sampleRate);
    // Ten seconds of stereo is made the first time audio arrives, not for every
    // track that has the stage and never turns it on.
    this.bufL = null; this.bufR = null;
    this.w = 0; this.recorded = 0;
    this.F = Math.max(1, Math.round(FADE_SECONDS * sampleRate));
    this.frame = 0;

    // The clock: a step position, advanced per sample, snapped to the
    // transport's steps as they land.
    this.running = false; this.pos = 0; this.sps = 0; this.lastSync = 0;
    this.qF = new Float64Array(QN); this.qS = new Float64Array(QN); this.qR = new Float64Array(QN);
    this.qHead = 0; this.qLen = 0;
    this.lastStep = -1; this.lastSlice = -1;

    // The run: what is being played instead of the input.
    this.active = false;   // holding (the gate has not run out)
    this.sounding = false; // still being read (holding, or fading out of it)
    this.src = 0; this.len = 0; this.el = 0; this.gridLen = 1; this.k = 0; this.local = 0;
    this.rate = 1; this.gain = 1; this.semis = 0; this.dec = 1;
    this.rev = false; this.chop = 1; this.j0 = 0;
    this.m = 0;            // the crossfade from input to run

    this.port.onmessage = (e) => {
      const d = e.data;
      if (!d) return;
      if (d.type === "dispose") this.alive = false;
      else if (d.type === "clock") this.queueClock(d);
      else if (d.type === "stop") this.stop();
      else if (d.type === "mode") {
        const m = clamp(d.mode | 0, 0, 1);
        if (m === this.mode && this.pend < 0) return;
        this.pend = m;
        this.active = false;   // fade out, swap, carry on
      }
    };
  }

  queueClock(d) {
    const t = Number(d.time), step = Number(d.step), dur = Number(d.stepDur);
    if (!(t >= 0) || !Number.isFinite(step) || !(dur > 0)) return;
    if (this.qLen === QN) { this.qHead = (this.qHead + 1) % QN; this.qLen--; }
    const at = (this.qHead + this.qLen) % QN;
    this.qF[at] = Math.round(t * sampleRate);
    this.qS[at] = step;
    this.qR[at] = 1 / (dur * sampleRate);
    this.qLen++;
  }

  stop() {
    this.running = false;
    this.qLen = 0;
    this.active = false;
    this.lastStep = -1; this.lastSlice = -1;
  }

  // Bring the clock to frame fr: apply the transport's steps that have landed.
  clockAt(fr) {
    while (this.qLen && this.qF[this.qHead] <= fr) {
      const h = this.qHead;
      this.pos = this.qS[h] + (fr - this.qF[h]) * this.qR[h];
      this.sps = this.qR[h];
      this.running = true;
      this.lastSync = fr;
      this.qHead = (h + 1) % QN; this.qLen--;
    }
    // Four steps without one: the transport stopped without saying so.
    if (this.running && fr - this.lastSync > 4 / this.sps) this.stop();
  }

  // A repeat: maybe trigger on step n.
  onStep(n, P) {
    if (this.mode !== 0 || this.pend >= 0 || this.active) return;
    const I = pick(INTERVAL, P.interval);
    const off = Math.min(I - 1, Math.floor(clamp(P.offset, 0, 1) * I));
    if (((n % I) + I) % I !== off) return;
    if (hash(n, 1) >= P.chance) return;
    const spStep = 1 / this.sps;
    const wander = Math.round((hash(n, 2) * 2 - 1) * clamp(P.vary, 0, 1) * 2);
    const gi = clamp(pickIndex(GRID, P.grid) + wander, 0, GRID.length - 1);
    this.gridLen = Math.max(4 * this.F, Math.round(GRID[gi] * spStep));
    // The captured slice is overwritten once the write head comes round again.
    this.len = Math.min(Math.round(pick(GATE, P.gate) * spStep), this.N - this.gridLen - this.F);
    this.src = this.w;
    this.semis = Math.round(clamp(P.pitch, 0, 1) * 24) / 2;
    this.dec = 1 - 0.7 * clamp(P.decay, 0, 1);
    this.rate = 1; this.gain = 1;
    this.begin();
  }

  // A slice: maybe swap slice j for one from the window before.
  onSlice(j, G, P) {
    if (this.mode !== 1 || this.pend >= 0 || this.active) return;
    if (hash(j, 3) >= P.chance) return;
    const spStep = 1 / this.sps;
    const gridLen = Math.round(G * spStep);
    if (gridLen < 4 * this.F) return;
    const nS = Math.max(1, Math.round(pick(INTERVAL, P.interval) / G));
    const jIn = ((j % nS) + nS) % nS;
    // A different slice from the one that would play anyway.
    let s = Math.floor(hash(j, 4) * Math.max(1, nS - 1));
    if (nS > 1 && s >= jIn) s++;
    const backSamples = Math.round((jIn + nS - s) * G * spStep);
    if (backSamples > this.recorded || backSamples > this.N - 4 * this.F - 128) return;
    // Never read past where the write head is now.
    const slices = Math.max(1, Math.min(Math.round(pick(GATE, P.gate) / G), Math.floor(backSamples / gridLen)));
    this.gridLen = gridLen;
    this.len = slices * gridLen;
    this.src = (this.w - backSamples + this.N) % this.N;
    this.j0 = j;
    this.semis = Math.round(clamp(P.pitch, 0, 1) * 24) / 2;
    this.rate = Math.pow(2, -this.semis / 12);
    this.gain = 1;
    this.chop = Math.max(2 * this.F, Math.round(gridLen * (1 - 0.9 * clamp(P.decay, 0, 1))));
    this.rev = hash(j, 5) < P.vary;
    this.begin();
  }

  begin() {
    this.el = 0; this.k = 0; this.local = 0;
    this.active = true; this.sounding = true;
  }

  nextSlice() {
    this.k++; this.local = 0;
    if (this.mode === 0) {
      this.rate = Math.pow(2, -Math.min(48, this.semis * this.k) / 12);
      this.gain = Math.pow(this.dec, this.k);
    } else {
      this.rev = hash(this.j0 + this.k, 5) < this.vary;
    }
  }

  process(inputs, outputs, parameters) {
    if (!this.alive) return false;
    const out = outputs[0];
    const oL = out[0], oR = out[1] || out[0];
    const n = oL.length;
    const f0 = typeof currentFrame === "number" ? currentFrame : this.frame;
    this.frame = f0 + n;
    const inp = inputs[0];

    if (!inp || inp.length === 0) {
      // Out of the chain: keep the clock, drop any run.
      for (let i = 0; i < n; i++) { this.clockAt(f0 + i); if (this.running) this.pos += this.sps; }
      this.lastStep = Math.floor(this.pos); this.lastSlice = -1;
      this.active = false; this.sounding = false; this.m = 0;
      if (this.pend >= 0) { this.mode = this.pend; this.pend = -1; }
      return true;
    }
    if (!this.bufL) { this.bufL = new Float32Array(this.N); this.bufR = new Float32Array(this.N); }
    const iL = inp[0], iR = inp[1] || inp[0];
    const P = {};
    for (const e of KNOB_DEFAULTS) { const a = parameters[e[0]]; P[e[0]] = a && a.length ? a[0] : e[1]; }
    this.vary = clamp(P.vary, 0, 1);
    const G = GRID[pickIndex(GRID, P.grid)];
    const N = this.N, F = this.F, bL = this.bufL, bR = this.bufR;

    for (let i = 0; i < n; i++) {
      const fr = f0 + i;
      this.clockAt(fr);
      if (this.running) {
        // Decisions on the grid. A resync can nudge the position back across
        // a boundary already passed; only a real jump back is a new start.
        const st = Math.floor(this.pos + 1e-9);
        if (st > this.lastStep || st < this.lastStep - 1) { this.lastStep = st; this.onStep(st, P); }
        const sl = Math.floor(this.pos / G + 1e-9);
        if (sl > this.lastSlice || sl < this.lastSlice - 1) { this.lastSlice = sl; this.onSlice(sl, G, P); }
      } else this.active = false;

      const xl = iL[i], xr = iR[i];
      bL[this.w] = xl; bR[this.w] = xr;

      let rl = 0, rr = 0;
      if (this.sounding) {
        const repeat = this.mode === 0;
        let off;
        if (repeat) off = this.local * this.rate;
        else off = this.k * this.gridLen + (this.rev ? this.gridLen - 1 - this.local : this.local) * this.rate;
        const end = repeat ? this.gridLen : this.chop;
        let env = 0;
        if (this.local < end) {
          env = 1;
          // The first pass of a repeat IS the input: no fade in.
          if (!(repeat && this.k === 0) && this.local < F) env = this.local / F;
          const tail = end - this.local;
          if (tail < F) env *= tail / F;
        }
        if (env > 0) {
          const x = this.src + off;
          const i0 = Math.floor(x), fr0 = x - i0;
          const a = ((i0 % N) + N) % N, b = a + 1 === N ? 0 : a + 1;
          const g = env * this.gain;
          rl = g * (bL[a] + (bL[b] - bL[a]) * fr0);
          rr = g * (bR[a] + (bR[b] - bR[a]) * fr0);
        }
        this.local++; this.el++;
        if (this.local >= this.gridLen) this.nextSlice();
        if (this.el >= this.len) this.active = false;
      }

      const target = this.active && this.pend < 0 ? 1 : 0;
      if (this.m < target) this.m = Math.min(1, this.m + 1 / F);
      else if (this.m > target) this.m = Math.max(0, this.m - 1 / F);
      if (this.m === 0 && !this.active) {
        this.sounding = false;
        if (this.pend >= 0) { this.mode = this.pend; this.pend = -1; }
      }
      const m = this.m;
      oL[i] = xl + (rl - xl) * m;
      if (oR !== oL) oR[i] = xr + (rr - xr) * m;

      this.w = this.w + 1 === N ? 0 : this.w + 1;
      if (this.recorded < N) this.recorded++;
      if (this.running) this.pos += this.sps;
    }
    return true;
  }
}
registerProcessor("sq-repeat", RepeatProcessor);
`;

const STEP_NAMES = (n) => `${n} step${n === 1 ? "" : "s"}`;

/** What the grid knob picks: a note value. */
export function repeatGridLabel(v) { return REPEAT_GRID_LABELS[pickIndex(REPEAT_GRID, v)]; }
/** The interval knob, in steps (16 to a 4/4 bar). */
export function repeatIntervalSteps(v) { return REPEAT_INTERVAL[pickIndex(REPEAT_INTERVAL, v)]; }
export function repeatIntervalLabel(v) { return STEP_NAMES(repeatIntervalSteps(v)); }
/** Where in the interval a repeat may fire, which depends on the interval. */
export function repeatOffsetSteps(v, interval) {
  const I = repeatIntervalSteps(interval ?? defaultFxConfig().repeat.interval);
  return Math.min(I - 1, Math.floor(clamp01(v) * I));
}
export function repeatOffsetLabel(v, interval) {
  const s = repeatOffsetSteps(v, interval);
  return s === 0 ? "on the 1" : `${STEP_NAMES(s)} in`;
}
export function repeatGateLabel(v) { return STEP_NAMES(REPEAT_GATE[pickIndex(REPEAT_GATE, v)]); }
/** Semitones down: per repeat on `repeat`, for every swapped slice on `slice`. */
export function repeatPitchSemis(v) { return Math.round(clamp01(v) * 24) / 2; }
export function repeatPitchLabel(v, mode) {
  const s = repeatPitchSemis(v);
  if (s === 0) return "0 st";
  return mode === "slice" ? `-${s} st` : `-${s} st each`;
}
export function repeatPercentLabel(v) { return `${Math.round(clamp01(v) * 100)}%`; }

function clamp01(v) { return Math.min(1, Math.max(0, Number(v) || 0)); }
function pickIndex(list, v) { return Math.round(clamp01(v) * (list.length - 1)); }

/** The character as the index the processor takes. */
export function repeatModeIndex(c) {
  const j = REPEAT_MODES.indexOf(c?.mode);
  return j >= 0 ? j : 0;
}

const _loads = new WeakMap();
const _ready = new WeakSet();

/** Register the processor on a context. Single-flight per context. */
export function loadRepeatWorklet(ctx) {
  if (!ctx?.audioWorklet) return Promise.reject(new Error("no AudioWorklet"));
  let p = _loads.get(ctx);
  if (!p) {
    const url = URL.createObjectURL(new Blob([REPEAT_PROCESSOR_SOURCE], { type: "text/javascript" }));
    p = ctx.audioWorklet.addModule(url)
      .then(() => { URL.revokeObjectURL(url); _ready.add(ctx); })
      .catch((e) => { URL.revokeObjectURL(url); _loads.delete(ctx); throw e; });
    _loads.set(ctx, p);
  }
  return p;
}

/** Has the processor finished registering on this context? */
export function repeatReady(ctx) { return !!ctx && _ready.has(ctx); }

/**
 * The repeat node, or null when the worklet isn't registered — the caller
 * passes the signal through rather than leaving the stage silent.
 */
export function buildRepeatNode(ctx, config) {
  if (!repeatReady(ctx)) { loadRepeatWorklet(ctx).catch(() => {}); return null; }
  try {
    return new AudioWorkletNode(ctx, "sq-repeat", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions: { mode: repeatModeIndex(config) },
    });
  } catch (e) {
    console.warn("repeat worklet node failed", e);
    return null;
  }
}

/** The processor source, for the tests (rendered in Node, as reverb.js's is). */
export function repeatProcessorSource() { return REPEAT_PROCESSOR_SOURCE; }
