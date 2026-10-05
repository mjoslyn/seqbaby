// ---- Prism: a four-module colour console ------------------------------------
// One rack stage that is four effects in series, each module picking one of
// five characters and taking one amount knob, with a handful of global knobs
// shared between them. The point of the format is that the four modules are
// built to be STACKED: a drive that is voiced for a doubler after it, a delay
// that a tape texture then wears down.
//
//   in ─▶ CHARACTER ─▶ MOVEMENT ─▶ DIFFUSION ─▶ TEXTURE ─▶ TILT ─▶ out
//          drive        doubler     cascade      filter
//          sweeten      vibrato     reels        squash
//          fuzz         phaser      space        cassette
//          howl         tremolo     collage      broken
//          swell        pitch       reverse      interference
//
//   rate   the movement module's speed (0.05..12Hz)
//   time   the diffusion module's time: echo spacing, tail, grain size
//   sens   how readily the envelope-driven characters respond (swell, fuzz
//          gate, howl, filter)
//   drift  slow random wander across everything that moves
//   tilt   a ±6dB see-saw around 700Hz on the way out
//
// - **A module at amount 0 is out of the circuit**, and costs nothing: its
//   state is skipped, and cleared when it comes back, so an old echo cannot
//   replay out of a buffer nobody was listening to.
// - **The amount fades the module in**, so the first fifth of each knob is a
//   crossfade from clean rather than a step from bypassed to on.
// - **Switching a module's character fades it out, swaps, and fades back in**
//   (12ms each way). A diffusion buffer is cleared on the swap: a space tail
//   read back as a cascade echo is not a sound, it is a bug.
// - **Every noise this stage makes follows its input.** The cassette hiss, the
//   interference static, the howl's feedback: all scaled by an envelope of the
//   signal, so a silent track stays silent. That is the same promise the rack's
//   own noise beds keep (setNoiseBedActive), kept here without the transport's
//   help.
// - **The idle skip waits out the longest path** (a 3s reverse buffer) on
//   silent INPUT, and then also needs silent OUTPUT, so a 12s space tail is
//   never cut off. The reverb's lesson, see reverb.js.
// - The wet/dry is the rack's own linear crossfade around this node (mix), like
//   every other parallel stage, and is what the `prism` LFO and lane drive.
//
// Not a model of any particular pedal: the twenty characters are reasoned
// versions of what their names describe, voiced to sit together.
//
// Runs as an AudioWorklet because almost all of it has state — delay lines,
// envelope followers, grain schedulers — and none of it is expressible in
// native nodes without a few hundred of them per track. Registered from a Blob
// URL like the other worklets here.

/** Each module's characters, in the order the processor indexes them. */
export { PRISM_MODES, PRISM_KNOBS } from "./soundDefaults.js";
import { PRISM_MODES } from "./soundDefaults.js";

// The processor source. Lives here as a string; keep it free of backticks and
// dollar-brace so the template literal stays intact (see CLAUDE.md's gotchas).
const PRISM_PROCESSOR_SOURCE = `
const TAU = 2 * Math.PI;
function clamp(x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }
function onePole(hz) { return 1 - Math.exp(-TAU * hz / sampleRate); }
function timeK(sec) { return 1 - Math.exp(-1 / (sec * sampleRate)); }

// RBJ biquad, transposed direct form II.
class Biquad {
  constructor() { this.b0 = 1; this.b1 = 0; this.b2 = 0; this.a1 = 0; this.a2 = 0; this.z1 = 0; this.z2 = 0; }
  // type: 0 lowpass, 1 highpass, 2 bandpass (0dB peak), 3 peaking
  set(type, f, q, db) {
    const w = TAU * clamp(f, 10, sampleRate * 0.45) / sampleRate;
    const cw = Math.cos(w), alpha = Math.sin(w) / (2 * q);
    let b0, b1, b2, a0, a1, a2;
    if (type === 0) { b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; }
    else if (type === 1) { b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; }
    else if (type === 2) { b0 = alpha; b1 = 0; b2 = -alpha; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; }
    else {
      const A = Math.pow(10, db / 40);
      b0 = 1 + alpha * A; b1 = -2 * cw; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * cw; a2 = 1 - alpha / A;
    }
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0;
  }
  run(x) {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }
  reset() { this.z1 = 0; this.z2 = 0; }
}

// A delay line, power-of-two sized, read with linear interpolation.
class Line {
  constructor(n) { let s = 2; while (s < n) s *= 2; this.b = new Float32Array(s); this.m = s - 1; this.w = 0; this.size = s; }
  push(x) { this.b[this.w] = x; this.w = (this.w + 1) & this.m; }
  // d samples behind the newest sample pushed (0 = that sample).
  tap(d) {
    const p = this.w - 1 - d;
    const i = Math.floor(p);
    const a = this.b[i & this.m];
    return a + (this.b[(i + 1) & this.m] - a) * (p - i);
  }
  clear() { this.b.fill(0); this.w = 0; }
}

// Schroeder allpass on a Line of n samples.
class Allpass {
  constructor(n) { this.n = Math.max(1, Math.round(n)); this.line = new Line(this.n + 2); }
  run(x, g) {
    const wd = this.line.tap(this.n - 1);
    const wn = x + g * wd;
    this.line.push(wn);
    return wd - g * wn;
  }
  clear() { this.line.clear(); }
}

const PITCH_LADDER = [-12, -7, -5, 5, 7, 12];
// Space: four lines, as times so a room is the same at 44.1k and 96k.
const SPACE_LENS = [0.0531, 0.0677, 0.0791, 0.0893];
const SPACE_DIFF = [0.0061, 0.0107, 0.0157];
const CASCADE_AP = [[0.0047, 0.0083, 0.0129], [0.0053, 0.0091, 0.0137]];
// Measured ratio of asked to heard tail, by time-knob position (0, 0.1, .. 1).
const SPACE_COMP = [0.83, 1.0, 1.17, 1.33, 1.49, 1.58, 1.66, 1.71, 1.76, 1.8, 1.81];
function spaceComp(t) {
  const x = clamp(t, 0, 1) * 10, i = Math.min(9, Math.floor(x));
  return SPACE_COMP[i] + (SPACE_COMP[i + 1] - SPACE_COMP[i]) * (x - i);
}
const DIFF_SECONDS = 3.4;   // the longest a diffusion buffer has to remember
const KN = ["char", "move", "diff", "tex"];

class PrismProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    const p = (name, d) => ({ name: name, defaultValue: d, minValue: 0, maxValue: 1, automationRate: "k-rate" });
    return [
      p("char", 0.25), p("move", 0.3), p("diff", 0.35), p("tex", 0.25),
      p("tilt", 0.5), p("rate", 0.35), p("time", 0.4), p("sens", 0.5), p("drift", 0.2),
    ];
  }

  constructor(options) {
    super();
    const o = options && options.processorOptions ? options.processorOptions : {};
    const sr = sampleRate;
    this.alive = true;
    this.mode = Array.isArray(o.modes) ? o.modes.slice(0, 4).map((m) => m | 0) : [0, 0, 2, 2];
    while (this.mode.length < 4) this.mode.push(0);
    this.pend = [-1, -1, -1, -1];
    this.fade = [1, 1, 1, 1];
    this.on = [false, false, false, false];
    this.fadeStep = 1 / (0.012 * sr);
    this.sm = { char: 0, move: 0, diff: 0, tex: 0, tilt: 0.5, rate: 0.35, time: 0.4, sens: 0.5, drift: 0.2 };
    this.smK = timeK(0.02);
    this.seed = (0x9e3779b9 ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0 || 1;

    // Mono detectors on the console's input.
    this.envF = 0; this.envS = 0; this.envO = 0;
    this.aF = timeK(0.001); this.rF = timeK(0.03);
    this.aS = timeK(0.03);  this.rS = timeK(0.25);
    // ...and on the texture module's input, which is after the delays.
    this.envT = 0; this.aT = timeK(0.005); this.rT = timeK(0.2);
    this.envC = 0; this.rC = timeK(0.1);

    // Character, shared
    this.cg = 1; this.cbias = 0; this.cbiasT = 0; this.ccomp = 1;
    this.swellG = 1; this.swellDuck = false; this.armed = true; this.swHold = 0;
    this.aO = timeK(0.003);
    this.duckK = timeK(0.002); this.riseK = timeK(0.3);
    this.gate = 1; this.gateA = timeK(0.001); this.gateR = timeK(0.06);
    this.howlFb = 0; this.exK = onePole(3000); this.swG = 1;

    // Movement, shared
    this.mph = 0; this.mInc = 0;
    this.pRatio = 1; this.pTarget = 1; this.pRatioK = timeK(0.08);
    this.pWin = Math.round(0.07 * sr);

    // Diffusion, shared: the space tank and its diffusers
    this.space = SPACE_LENS.map((s) => {
      const n = Math.round(s * sr);
      return { n: n, line: new Line(n + 2), lp: 0, g: 0.5 };
    });
    this.spaceAp = SPACE_DIFF.map((s) => new Allpass(s * sr));
    this.spaceDamp = onePole(5500);
    this.spaceTrim = 0.5;
    this.wph = 0; this.fph = 0;
    this.dTK = timeK(0.15); this.dTarget2 = 0.3 * sr; this.rvTarget = Math.round(0.4 * sr); this.diffFb = 0;
    this.oL = 0; this.oR = 0; this.drift = 0;
    this.lpK = onePole(3200); this.hpK = onePole(120); this.dampK = onePole(6000);

    // Texture, shared
    this.svfA1 = 1; this.svfA2 = 0; this.svfA3 = 0;
    // the squash's gain drops at once and recovers slowly: a compressor that
    // let the attack through at full makeup would be a transient booster
    this.sqG = 1; this.sqTarget = 1; this.sqRel = timeK(0.06);
    this.cwph = 0; this.cfph = 0; this.hissK = onePole(6000);
    this.dropOn = false; this.dropT = 0; this.dropG = 1; this.dropK = timeK(0.001);
    this.stOn = false; this.stLen = 0; this.stK = 0; this.stEnd = 0;
    this.holdN = 1; this.step = 0;
    this.fadeAM = 1; this.fadeTarget = 1; this.fadeTimer = 0; this.fadeK = timeK(0.05);
    this.crackle = 0; this.crackK = timeK(0.0005);
    this.wf = 2400; this.wfTarget = 2400; this.wfTimer = 0; this.wph2 = 0;

    // Tilt
    this.tiltK = onePole(700); this.gLo = 1; this.gHi = 1;

    // Drift: a slow random walk, -1..1
    this.dval = 0; this.dTarget = 0; this.dTimer = 0;

    this.ch = [this.makeChannel(0), this.makeChannel(1)];
    this.silentIn = 0;
    this.sleeping = false;
    this.tail = Math.round((DIFF_SECONDS + 0.2) * sr);

    this.port.onmessage = (e) => {
      const d = e.data;
      if (!d) return;
      if (d.type === "dispose") this.alive = false;
      else if (d.type === "modes" && Array.isArray(d.modes)) {
        for (let k = 0; k < 4; k++) {
          const m = d.modes[k] | 0;
          if (m === this.mode[k] && this.pend[k] < 0) continue;
          if (!this.on[k]) { this.mode[k] = m; this.pend[k] = -1; }
          else this.pend[k] = m;
        }
      }
    };
  }

  makeChannel(c) {
    const sr = sampleRate;
    const ch = {
      // character
      peak: new Biquad(), lp: new Biquad(), hp: new Biquad(), tone: new Biquad(), bp: new Biquad(),
      ex: 0, howlY: 0,
      // movement
      mline: new Line(Math.round(0.2 * sr)),
      ax: new Float64Array(6), ay: new Float64Array(6), apA: 0, phY: 0, pph: c * 0.25,
      // diffusion
      // The diffusion buffer is seconds long, so it is made the first time the
      // module is switched on (reset), not for every track that never uses it.
      dl: null,
      ap: CASCADE_AP[c].map((s) => new Allpass(s * sr)),
      dT: 0.3 * sr, damp: 0, lpS: 0, hpS: 0,
      grains: [this.makeGrain(), this.makeGrain()], gwait: 0, cfb: 0,
      rvC: Math.round(0.4 * sr), rvN: 0, rvLast: 0,
      // texture
      ic1: 0, ic2: 0,
      cline: new Line(Math.round(0.05 * sr)), chp: new Biquad(), clp: new Biquad(), hiss: 0,
      sline: null, hv: 0, hc: 0,
      ihp: new Biquad(), ilp: new Biquad(),
      // tilt
      tlp: 0,
    };
    ch.chp.set(1, 50, 0.7, 0);
    ch.ihp.set(1, 350, 0.7, 0);
    return ch;
  }

  makeGrain() { return { on: false, d: 0, inc: 0, len: 1, t: 0, g: 0 }; }

  rnd() {
    let x = this.seed;
    x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0;
    this.seed = x;
    return x / 4294967296;
  }

  reset(k) {
    for (const c of this.ch) {
      if (k === 0) { c.peak.reset(); c.lp.reset(); c.hp.reset(); c.tone.reset(); c.bp.reset(); c.ex = 0; c.howlY = 0; }
      else if (k === 1) { c.mline.clear(); c.ax.fill(0); c.ay.fill(0); c.phY = 0; }
      else if (k === 2) {
        if (c.dl) c.dl.clear(); else c.dl = new Line(Math.round(DIFF_SECONDS * sampleRate));
        for (const a of c.ap) a.clear();
        c.damp = 0; c.lpS = 0; c.hpS = 0; c.cfb = 0; c.rvLast = 0; c.rvN = 0; c.gwait = 0;
        for (const g of c.grains) g.on = false;
      } else { c.ic1 = 0; c.ic2 = 0; c.cline.clear(); c.chp.reset(); c.clp.reset(); c.hiss = 0; c.ihp.reset(); c.ilp.reset();
        if (c.sline) c.sline.clear(); else c.sline = new Line(Math.round(0.9 * sampleRate)); }
    }
    if (k === 0) { this.swellG = 1; this.swellDuck = false; this.armed = true; this.gate = 1; }
    if (k === 2) { for (const s of this.space) { s.line.clear(); s.lp = 0; } for (const a of this.spaceAp) a.clear(); }
    if (k === 3) { this.dropOn = false; this.dropG = 1; this.stOn = false; this.sqG = 1; this.crackle = 0; }
  }

  // ---- per-block coefficients, from the smoothed knobs ----
  block(n) {
    const sm = this.sm, sr = sampleRate;
    // drift: a new target every 0.3..1.2s, eased into
    this.dTimer -= n;
    if (this.dTimer <= 0) { this.dTarget = this.rnd() * 2 - 1; this.dTimer = (0.3 + this.rnd() * 0.9) * sr; }
    this.dval += (this.dTarget - this.dval) * (1 - Math.exp(-n / (0.4 * sr)));
    const drift = sm.drift * this.dval;

    const a0 = sm.char, s = sm.sens;
    switch (this.mode[0]) {
      case 0: {   // drive: a mid hump into an asymmetric soft clip
        this.cg = Math.pow(2, a0 * 6);
        this.cbias = 0.15 * a0; this.cbiasT = Math.tanh(this.cbias);
        this.ccomp = Math.pow(this.cg, -0.55);
        for (const c of this.ch) { c.peak.set(3, 720, 0.8, a0 * 9); c.lp.set(0, 7500 - 3500 * a0, 0.7, 0); }
        break;
      }
      case 2: {   // fuzz
        this.cg = 15 + a0 * 350;
        for (const c of this.ch) { c.hp.set(1, 100, 0.7, 0); c.tone.set(0, 4700 - 2500 * a0, 0.7, 0); }
        break;
      }
      case 3: {   // howl: a resonant band that follows the playing, fed back into the clipper
        this.cg = 1.5 + a0 * 12;
        const fc = 220 * Math.pow(18, clamp(this.envS * 8 * (0.25 + s), 0, 1));
        for (const c of this.ch) c.bp.set(2, fc, 5, 0);
        break;
      }
      case 4:     // swell: how long the volume takes to come up
        this.riseK = timeK(0.02 + a0 * 1.2);
        break;
    }

    // movement: 0.05..12Hz, exponential, wandering with the drift
    const hz = 0.05 * Math.pow(240, sm.rate) * (1 + 0.35 * drift);
    this.mInc = hz / sr;
    if (this.mode[1] === 4) {
      const a1 = sm.move;
      const semi = PITCH_LADDER[Math.min(5, Math.floor(a1 * 6))] + drift * 0.15;
      this.pTarget = Math.pow(2, semi / 12);
    }

    // diffusion
    const t = sm.time, a2 = sm.diff;
    switch (this.mode[2]) {
      case 0: this.dTarget2 = 0.04 * Math.pow(30, t) * sr; break;     // 40ms..1.2s
      case 1: this.dTarget2 = 0.06 * Math.pow(14, t) * sr; break;     // 60ms..0.84s
      case 2: {
        const t60 = 0.5 * Math.pow(24, t);                             // 0.5..12s
        // The damping inside the loop takes the top off every lap, so a tank
        // whose coefficients ask for 12s rings for under 7: the coefficients
        // are computed for a longer target so the knob reads true. Measured,
        // not derived (test/prism.test.js pins it), as reverb.js's DECAY_COMP.
        const comp = spaceComp(t);
        for (const l of this.space) l.g = Math.pow(10, -3 * l.n / (t60 * comp * sr));
        // a tank holds more energy the longer it holds it; trim it back
        this.spaceTrim = 0.55 * Math.pow(2 / t60, 0.22);
        break;
      }
      case 4: this.rvTarget = Math.round(0.12 * Math.pow(12, t) * sr); break; // 0.12..1.44s
    }
    this.diffFb = a2;

    // texture
    const a3 = sm.tex;
    switch (this.mode[3]) {
      case 1: break;
      case 2: for (const c of this.ch) c.clp.set(0, 14000 - a3 * 9500, 0.6, 0); break;
      case 3: {
        this.holdN = 1 + Math.floor(a3 * a3 * 7);
        this.step = Math.pow(2, 1 - (16 - a3 * 9));
        break;
      }
      case 4: for (const c of this.ch) c.ilp.set(0, 3600 - a3 * 1800, 0.7, 0); break;
    }

    // tilt: ±6dB around 700Hz, flat in the middle
    const db = (sm.tilt - 0.5) * 24;
    this.gLo = Math.pow(10, -db / 40); this.gHi = Math.pow(10, db / 40);
    this.drift = drift;
  }

  // ---- CHARACTER ----
  charStep(c, x, a) {
    switch (this.mode[0]) {
      case 0: {
        const y = Math.tanh(this.cg * c.peak.run(x) + this.cbias) - this.cbiasT;
        return c.lp.run(y) * this.ccomp;
      }
      case 1: {   // sweeten: a little compression, a little air
        c.ex += this.exK * (x - c.ex);
        const hi = x - c.ex;
        return x * this.swG * (1 + a * 0.9) + Math.tanh(hi * (2 + a * 6)) * a * 0.25;
      }
      case 2: {
        const h = c.hp.run(x) * this.cg;
        const y = h > 0 ? 1 - Math.exp(-h) : -0.75 * (1 - Math.exp(h / 0.75));
        return c.tone.run(y) * 0.2 * this.gate;
      }
      case 3: {
        const v = Math.tanh(this.cg * x + this.howlFb * c.howlY);
        c.howlY = c.bp.run(v);
        return (v * 0.35 + c.howlY * 0.9) * 0.6 / (1 + a * 1.5);
      }
      default: return x * this.swellG;
    }
  }

  // ---- MOVEMENT ----
  moveStep(c, ci, x, a, i) {
    c.mline.push(x);
    const sr = sampleRate;
    switch (this.mode[1]) {
      case 0: {   // doubler: a second player a few tens of ms late, wandering
        const base = ci === 0 ? 0.017 : 0.023;
        const d = (base + 0.0012 * Math.sin(TAU * (this.mph * 0.37 + ci * 0.25)) + this.drift * 0.001) * sr;
        return (x + a * 0.85 * c.mline.tap(d)) / (1 + a * 0.4);
      }
      case 1: {   // vibrato: all wet, pitch only
        const d = (0.0045 + a * 0.004 * Math.sin(TAU * this.mph)) * sr;
        return c.mline.tap(d);
      }
      case 2: {   // phaser: six allpasses, swept, with feedback; quadrature in stereo
        if ((i & 7) === 0) {
          const l = 0.5 + 0.5 * Math.sin(TAU * (this.mph + ci * 0.25));
          const f = 180 * Math.pow(20, l * (0.35 + 0.65 * a));
          const tn = Math.tan(Math.PI * Math.min(f, sr * 0.45) / sr);
          c.apA = (tn - 1) / (tn + 1);
        }
        const A = c.apA;
        let v = x + c.phY * (0.3 + 0.5 * a);
        for (let k = 0; k < 6; k++) {
          const o = A * v + c.ax[k] - A * c.ay[k];
          c.ax[k] = v; c.ay[k] = o; v = o;
        }
        c.phY = v;
        return 0.65 * (x + v);
      }
      case 3: {   // tremolo: sine to square as it deepens; drift spreads it into a pan
        const ph = this.mph + (ci === 1 ? this.sm.drift * 0.5 : 0);
        const k = 1 + a * a * 8;
        const sq = Math.tanh(Math.sin(TAU * ph) * k) / Math.tanh(k);
        return x * (1 - a * (0.5 + 0.5 * sq));
      }
      default: {  // pitch: a two-head shifter, mixed with the dry
        const W = this.pWin;
        c.pph += (1 - this.pRatio) / W;
        c.pph -= Math.floor(c.pph);
        const p2 = (c.pph + 0.5) % 1;
        const s1 = Math.sin(Math.PI * c.pph), s2 = Math.sin(Math.PI * p2);
        const y = c.mline.tap(c.pph * W + 2) * s1 * s1 + c.mline.tap(p2 * W + 2) * s2 * s2;
        return 0.7 * (x + y);
      }
    }
  }

  // ---- DIFFUSION (both channels at once: some of it crosses over) ----
  diffStep(xL, xR, a) {
    const sr = sampleRate, cL = this.ch[0], cR = this.ch[1];
    const mix = Math.min(1, a * 1.6);
    switch (this.mode[2]) {
      case 0: {   // cascade: ping-pong echoes that smear further every pass
        cL.dT += (this.dTarget2 - cL.dT) * this.dTK; cR.dT = cL.dT;
        const w = this.drift * 0.002 * sr;
        const rL = cL.dl.tap(cL.dT + w), rR = cR.dl.tap(cR.dT - w);
        const g = 0.35 + 0.35 * a, fb = 0.25 + 0.65 * a;
        let sL = cL.ap[2].run(cL.ap[1].run(cL.ap[0].run(rR, g), g), g);
        let sR = cR.ap[2].run(cR.ap[1].run(cR.ap[0].run(rL, g), g), g);
        cL.damp += this.dampK * (sL - cL.damp); cR.damp += this.dampK * (sR - cR.damp);
        cL.dl.push(xL + fb * cL.damp); cR.dl.push(xR + fb * cR.damp);
        this.oL = xL + rL * mix * 0.9; this.oR = xR + rR * mix * 0.9;
        return;
      }
      case 1: {   // reels: a tape echo, wobbling, darker every repeat
        cL.dT += (this.dTarget2 - cL.dT) * this.dTK; cR.dT = cL.dT;
        this.wph += 0.55 / sr; this.fph += 6.5 / sr;
        if (this.wph >= 1) this.wph -= 1;
        if (this.fph >= 1) this.fph -= 1;
        const wob = (Math.sin(TAU * this.wph) * (0.0012 + this.sm.drift * 0.002) + Math.sin(TAU * this.fph) * 0.00012) * sr;
        const fb = 0.2 + 0.75 * a;
        for (let ci = 0; ci < 2; ci++) {
          const c = this.ch[ci], x = ci === 0 ? xL : xR;
          const r = c.dl.tap(c.dT + wob + 1);
          const s = Math.tanh(r * 1.3) / 1.3;
          c.lpS += this.lpK * (s - c.lpS);
          c.hpS += this.hpK * (c.lpS - c.hpS);
          c.dl.push(x + fb * (c.lpS - c.hpS));
          if (ci === 0) this.oL = x + r * mix * 0.85; else this.oR = x + r * mix * 0.85;
        }
        return;
      }
      case 2: {   // space: a four-line tank behind three diffusers
        let m = 0.5 * (xL + xR);
        for (const ap of this.spaceAp) m = ap.run(m, 0.6);
        const S = this.space;
        const o0 = S[0].line.tap(S[0].n - 1), o1 = S[1].line.tap(S[1].n - 1);
        const o2 = S[2].line.tap(S[2].n - 1), o3 = S[3].line.tap(S[3].n - 1);
        S[0].lp += this.spaceDamp * (o0 - S[0].lp); S[1].lp += this.spaceDamp * (o1 - S[1].lp);
        S[2].lp += this.spaceDamp * (o2 - S[2].lp); S[3].lp += this.spaceDamp * (o3 - S[3].lp);
        const a_ = S[0].lp * S[0].g, b_ = S[1].lp * S[1].g, c_ = S[2].lp * S[2].g, d_ = S[3].lp * S[3].g;
        // 4-point Hadamard, orthonormal: the gains above are then the decay
        S[0].line.push(m * 0.5 + 0.5 * (a_ + b_ + c_ + d_));
        S[1].line.push(m * 0.5 + 0.5 * (a_ - b_ + c_ - d_));
        S[2].line.push(m * 0.5 + 0.5 * (a_ + b_ - c_ - d_));
        S[3].line.push(m * 0.5 + 0.5 * (a_ - b_ - c_ + d_));
        const tr = this.spaceTrim * a;
        this.oL = xL + (o0 + o2) * tr; this.oR = xR + (o1 + o3) * tr;
        return;
      }
      case 3: {   // collage: fragments of the last few seconds, some backwards, some an octave off
        for (let ci = 0; ci < 2; ci++) {
          const c = this.ch[ci], x = ci === 0 ? xL : xR;
          c.dl.push(x + c.cfb);
          let sum = 0;
          for (const g of c.grains) {
            if (!g.on) continue;
            const w = 0.5 - 0.5 * Math.cos(TAU * g.t / g.len);
            sum += c.dl.tap(g.d) * w * g.g;
            g.d += g.inc; g.t++;
            if (g.t >= g.len) g.on = false;
          }
          c.gwait--;
          if (c.gwait <= 0) {
            const g = c.grains[0].on ? (c.grains[1].on ? null : c.grains[1]) : c.grains[0];
            if (g) this.spawnGrain(c, g, a);
            c.gwait = Math.round((0.02 + (1 - a) * 0.6 * this.rnd()) * sr);
          }
          c.cfb = 0.25 * a * sum;
          if (ci === 0) this.oL = x + sum * mix * 0.9; else this.oR = x + sum * mix * 0.9;
        }
        return;
      }
      default: {  // reverse: each slice of the input played backwards, under two overlapping windows
        const fb = a * 0.55;
        for (let ci = 0; ci < 2; ci++) {
          const c = this.ch[ci], x = ci === 0 ? xL : xR;
          c.dl.push(x + fb * c.rvLast);
          if (c.rvN >= c.rvC) {
            c.rvN -= c.rvC;
            c.rvC = Math.max(64, Math.min(this.rvTarget || c.rvC, Math.floor((c.dl.size - 8) / 2)));
            if (c.rvN >= c.rvC) c.rvN = 0;
          }
          const C = c.rvC, n1 = c.rvN, n2 = (n1 + C / 2) % C;
          const s1 = Math.sin(Math.PI * n1 / C), s2 = Math.sin(Math.PI * n2 / C);
          const y = c.dl.tap(2 * n1 + 1) * s1 * s1 + c.dl.tap(2 * n2 + 1) * s2 * s2;
          c.rvN++;
          c.rvLast = y;
          if (ci === 0) this.oL = x + y * mix * 0.9; else this.oR = x + y * mix * 0.9;
        }
      }
    }
  }

  spawnGrain(c, g, a) {
    const sr = sampleRate, size = c.dl.size - 8;
    const t = this.sm.time;
    const look = Math.min(DIFF_SECONDS - 0.6, 0.25 + t * 2.6) * sr;
    const len = Math.round((0.05 + t * 0.35 + this.rnd() * 0.1) * sr);
    const r = this.rnd();
    const rate = r < 0.45 ? 1 : r < 0.65 ? -1 : r < 0.8 ? 0.5 : r < 0.92 ? 2 : -0.5;
    let d = len * Math.max(0, rate - 1) + 2 + this.rnd() * look;
    const grow = Math.max(0, 1 - rate) * len;
    if (d + grow > size) d = Math.max(2, size - grow);
    g.on = true; g.d = d; g.inc = 1 - rate; g.len = Math.max(32, len); g.t = 0;
    g.g = 0.6 + 0.4 * this.rnd();
  }

  // ---- TEXTURE ----
  texStep(c, ci, x, a, i) {
    const sr = sampleRate;
    switch (this.mode[3]) {
      case 0: {   // filter: a resonant lowpass the playing opens
        const A1 = this.svfA1, A2 = this.svfA2, A3 = this.svfA3;
        const v3 = x - c.ic2;
        const v1 = A1 * c.ic1 + A2 * v3;
        const v2 = c.ic2 + A2 * c.ic1 + A3 * v3;
        c.ic1 = 2 * v1 - c.ic1; c.ic2 = 2 * v2 - c.ic2;
        return v2;
      }
      case 1: return x * this.sqG;
      case 2: {   // cassette: wow, flutter, saturation, a narrower band, and hiss under the signal
        c.cline.push(x);
        const d = (0.004 + Math.sin(TAU * this.cwph) * 0.0008 * (0.3 + a) + Math.sin(TAU * this.cfph) * 0.00008 + this.drift * 0.0005) * sr;
        const r = c.cline.tap(d);
        const y = Math.tanh(r * (1 + a * 2.5)) / (1 + a * 2.5);
        c.hiss += this.hissK * ((this.rnd() * 2 - 1) - c.hiss);
        return c.clp.run(c.chp.run(y)) + c.hiss * a * 0.05 * Math.min(1, this.envT * 8);
      }
      case 3: {   // broken: dropouts, stutters, a converter running out of bits
        c.sline.push(x);
        let src = x;
        if (this.stOn) {
          const k = this.stK, L = this.stLen, pos = k % L;
          // the slice that was playing when the stutter caught, again
          src = c.sline.tap(L + k - pos - 1);
          const e = Math.min(1, pos / (0.002 * sr), (L - pos) / (0.002 * sr));
          src *= e;
        }
        if (c.hc <= 0) { c.hv = this.step * Math.round(src / this.step); c.hc = this.holdN; }
        c.hc--;
        return c.hv * this.dropG;
      }
      default: {  // interference: a radio band, fading, with static and a whistle riding the signal
        const y = c.ilp.run(c.ihp.run(x));
        const env = Math.min(1, this.envT * 10);
        const nz = this.rnd() * 2 - 1;
        const n = (this.crackle * nz + Math.sin(TAU * this.wph2) * 0.02 * a + nz * 0.012 * a) * env;
        return y * this.fadeAM * (1 + a * 0.4) + n;
      }
    }
  }

  process(inputs, outputs, params) {
    if (!this.alive) return false;
    const out = outputs[0];
    const L = out[0], R = out[1] || out[0];
    if (!L) return true;
    const n = L.length;
    const inp = inputs[0];
    const iL = inp && inp.length ? inp[0] : null;
    const iR = inp && inp.length ? (inp[1] || inp[0]) : null;

    let pk = 0;
    if (iL) for (let i = 0; i < n; i++) { const v = Math.abs(iL[i]) + Math.abs(iR[i]); if (v > pk) pk = v; }
    if (pk < 1e-7) this.silentIn += n; else { this.silentIn = 0; this.sleeping = false; }
    if (this.sleeping) { L.fill(0); if (R !== L) R.fill(0); return true; }

    const sm = this.sm, k = this.smK;
    const tg = {
      char: params.char[0], move: params.move[0], diff: params.diff[0], tex: params.tex[0],
      tilt: params.tilt[0], rate: params.rate[0], time: params.time[0], sens: params.sens[0], drift: params.drift[0],
    };
    // knobs that only set coefficients ease once a block; the four amounts per sample below
    const kb = 1 - Math.pow(1 - k, n);
    sm.tilt += (tg.tilt - sm.tilt) * kb; sm.rate += (tg.rate - sm.rate) * kb;
    sm.time += (tg.time - sm.time) * kb; sm.sens += (tg.sens - sm.sens) * kb;
    sm.drift += (tg.drift - sm.drift) * kb;

    // modules switching in or out
    for (let m = 0; m < 4; m++) {
      const want = tg[KN[m]] > 0 || sm[KN[m]] > 1e-4;
      if (want && !this.on[m]) { this.reset(m); this.on[m] = true; }
      else if (!want && this.on[m]) { this.on[m] = false; sm[KN[m]] = 0; if (this.pend[m] >= 0) { this.mode[m] = this.pend[m]; this.pend[m] = -1; this.fade[m] = 1; } }
    }
    this.block(n);

    const sr = sampleRate, sens = sm.sens;
    const thr = 0.002 + (1 - sens) * 0.03;
    const on0 = this.on[0], on1 = this.on[1], on2 = this.on[2], on3 = this.on[3];
    let opk = 0;

    for (let i = 0; i < n; i++) {
      let xL = iL ? iL[i] : 0, xR = iR ? iR[i] : 0;

      // smoothed amounts, and the fades around a character change
      for (let m = 0; m < 4; m++) {
        if (!this.on[m]) continue;
        sm[KN[m]] += (tg[KN[m]] - sm[KN[m]]) * k;
        if (this.pend[m] >= 0) {
          this.fade[m] -= this.fadeStep;
          if (this.fade[m] <= 0) { this.fade[m] = 0; this.mode[m] = this.pend[m]; this.pend[m] = -1; this.reset(m); }
        } else if (this.fade[m] < 1) this.fade[m] = Math.min(1, this.fade[m] + this.fadeStep);
      }

      // input detectors
      const mono = Math.abs(0.5 * (xL + xR));
      this.envF += (mono > this.envF ? this.aF : this.rF) * (mono - this.envF);
      this.envS += (mono > this.envS ? this.aS : this.rS) * (mono - this.envS);

      if (on0) {
        const a = sm.char;
        switch (this.mode[0]) {
          case 1: this.swG = 1 / (1 + a * 2.5 * this.envS); break;
          case 2: { const tgt = this.envS > thr ? 1 : 0; this.gate += (tgt - this.gate) * (tgt > this.gate ? this.gateA : this.gateR); break; }
          case 3: this.howlFb = a * 1.5 * Math.min(1, this.envS * 25); break;
          case 4:
            // An onset is the fast envelope jumping well clear of the slow one.
            // A rectified tone ripples, so the fast one is smoothed a little
            // more here, and after a trigger nothing re-arms for 80ms: without
            // that, a held note's own ripple retriggered it every few cycles.
            this.envO += (mono > this.envO ? this.aO : this.rF) * (mono - this.envO);
            if (this.swHold > 0) this.swHold--;
            if (this.armed && this.envO > this.envS * 2 + thr) { this.swellDuck = true; this.armed = false; this.swHold = Math.round(0.08 * sr); }
            else if (!this.armed && this.swHold <= 0 && this.envO < this.envS * 1.1) this.armed = true;
            if (this.swellDuck) { this.swellG -= this.swellG * this.duckK; if (this.swellG < 0.002) this.swellDuck = false; }
            else this.swellG += (1 - this.swellG) * this.riseK;
            break;
        }
        const e = Math.min(1, a * 5) * this.fade[0];
        if (e > 0) {
          const yL = this.charStep(this.ch[0], xL, a), yR = this.charStep(this.ch[1], xR, a);
          xL += (yL - xL) * e; xR += (yR - xR) * e;
        }
      }

      if (on1) {
        const a = sm.move;
        this.mph += this.mInc; if (this.mph >= 1) this.mph -= 1;
        // On pitch the amount picks the interval rather than a depth, so the
        // octave-down zone at the bottom of the knob cannot also be its fade-in.
        const pitch = this.mode[1] === 4;
        if (pitch) this.pRatio += (this.pTarget - this.pRatio) * this.pRatioK;
        const e = Math.min(1, a * (pitch ? 30 : 5)) * this.fade[1];
        const yL = this.moveStep(this.ch[0], 0, xL, a, i), yR = this.moveStep(this.ch[1], 1, xR, a, i);
        xL += (yL - xL) * e; xR += (yR - xR) * e;
      }

      if (on2) {
        const a = sm.diff;
        const e = Math.min(1, a * 5) * this.fade[2];
        this.diffStep(xL, xR, a);
        xL += (this.oL - xL) * e; xR += (this.oR - xR) * e;
      }

      if (on3) {
        const a = sm.tex;
        const tm = Math.abs(0.5 * (xL + xR));
        this.envT += (tm > this.envT ? this.aT : this.rT) * (tm - this.envT);
        switch (this.mode[3]) {
          case 0:
            if ((i & 15) === 0) {
              const fc = Math.min(18000, 18000 * Math.pow(0.01, a) * Math.pow(2, Math.min(5, this.envT * 30 * sens)));
              const g = Math.tan(Math.PI * Math.min(fc, sr * 0.45) / sr);
              const kq = 1 / (0.7 + a * 3.3);
              this.svfA1 = 1 / (1 + g * (g + kq)); this.svfA2 = g * this.svfA1; this.svfA3 = g * this.svfA2;
            }
            break;
          case 1:
            // a peak detector, instant on the way up
            this.envC = tm > this.envC ? tm : this.envC + this.rC * (tm - this.envC);
            {   // every sample: at a note's first sample the gain must already be down
              const lvl = 20 * Math.log10(this.envC + 1e-9);
              const th = -8 - a * 32, ratio = 2 + a * 14, slope = 1 - 1 / ratio;
              const gr = lvl > th ? (lvl - th) * slope : 0;
              // makeup brings a -14dB signal back to where it was
              this.sqTarget = Math.pow(10, (Math.max(0, -14 - th) * slope - gr) / 20);
            }
            if (this.sqTarget < this.sqG) this.sqG = this.sqTarget; else this.sqG += (this.sqTarget - this.sqG) * this.sqRel;
            break;
          case 2:
            this.cwph += 0.7 / sr; if (this.cwph >= 1) this.cwph -= 1;
            this.cfph += 9 / sr; if (this.cfph >= 1) this.cfph -= 1;
            break;
          case 3: {
            const a2 = a * a;
            if (!this.dropOn && this.rnd() < a2 * 3 / sr) { this.dropOn = true; this.dropT = Math.round((0.01 + this.rnd() * 0.12) * sr); }
            if (this.dropOn && --this.dropT <= 0) this.dropOn = false;
            this.dropG += ((this.dropOn ? 0 : 1) - this.dropG) * this.dropK;
            if (this.stOn) { if (++this.stK >= this.stEnd) this.stOn = false; }
            else if (this.rnd() < a2 * 1.5 / sr) {
              this.stOn = true; this.stK = 0;
              this.stLen = Math.round((0.025 + this.rnd() * 0.07) * sr);
              this.stEnd = this.stLen * (2 + Math.floor(this.rnd() * 4));
            }
            break;
          }
          case 4:
            this.fadeTimer--;
            if (this.fadeTimer <= 0) { this.fadeTarget = 1 - a * 0.7 * this.rnd(); this.fadeTimer = Math.round((0.08 + this.rnd() * 0.3) * sr); }
            this.fadeAM += (this.fadeTarget - this.fadeAM) * this.fadeK;
            if (this.rnd() < a * a * 40 / sr) this.crackle = 0.1 + 0.3 * this.rnd();
            this.crackle -= this.crackle * this.crackK;
            this.wfTimer--;
            if (this.wfTimer <= 0) { this.wfTarget = 1500 + 2500 * this.rnd(); this.wfTimer = Math.round((0.5 + this.rnd()) * sr); }
            this.wf += (this.wfTarget - this.wf) * 0.0002;
            this.wph2 += this.wf / sr; if (this.wph2 >= 1) this.wph2 -= 1;
            break;
        }
        const e = Math.min(1, a * 5) * this.fade[3];
        const yL = this.texStep(this.ch[0], 0, xL, a, i), yR = this.texStep(this.ch[1], 1, xR, a, i);
        xL += (yL - xL) * e; xR += (yR - xR) * e;
      }

      // tilt
      const cL = this.ch[0], cR = this.ch[1];
      cL.tlp += this.tiltK * (xL - cL.tlp); cR.tlp += this.tiltK * (xR - cR.tlp);
      xL = cL.tlp * this.gLo + (xL - cL.tlp) * this.gHi;
      xR = cR.tlp * this.gLo + (xR - cR.tlp) * this.gHi;

      // a soft ceiling, so a feedback setting pushed to the end of its range is
      // loud, not a blowup: linear to 1, then bending over to 1.5
      if (xL > 1) xL = 1 + 0.5 * Math.tanh(2 * (xL - 1)); else if (xL < -1) xL = -1 - 0.5 * Math.tanh(-2 * (xL + 1));
      if (xR > 1) xR = 1 + 0.5 * Math.tanh(2 * (xR - 1)); else if (xR < -1) xR = -1 - 0.5 * Math.tanh(-2 * (xR + 1));
      L[i] = xL; if (R !== L) R[i] = xR;
      const v = Math.abs(xL) + Math.abs(xR);
      if (v > opk) opk = v;
    }

    if (!(opk < 1e3)) {   // NaN or worse: start clean rather than stay broken
      for (let m = 0; m < 4; m++) this.reset(m);
      for (const c of this.ch) c.tlp = 0;
      L.fill(0); if (R !== L) R.fill(0);
      opk = 0;
    }
    if (this.silentIn > this.tail && opk < 1e-6) this.sleeping = true;
    return true;
  }
}
registerProcessor("sq-prism", PrismProcessor);
`;

/** The movement module's speed, knob 0..1 → Hz (exponential, 0.05..12). */
export function prismRateHz(v) {
  const x = Math.min(1, Math.max(0, Number(v) || 0));
  return 0.05 * Math.pow(240, x);
}

/** What the rate knob reads out. */
export function prismRateLabel(v) {
  const hz = prismRateHz(v);
  return hz < 1 ? `${hz.toFixed(2)}Hz` : `${hz.toFixed(1)}Hz`;
}

/**
 * What the time knob means, which depends on the diffusion character: an echo
 * spacing, a tail, a grain, a slice. Seconds, from the same curves the
 * processor uses.
 */
export function prismTimeSec(v, diffmode) {
  const x = Math.min(1, Math.max(0, Number(v) || 0));
  switch (diffmode) {
    case "cascade": return 0.04 * Math.pow(30, x);
    case "reels":   return 0.06 * Math.pow(14, x);
    case "space":   return 0.5 * Math.pow(24, x);
    case "collage": return 0.05 + x * 0.35;
    case "reverse": return 0.12 * Math.pow(12, x);
    default:        return 0.04 * Math.pow(30, x);
  }
}

export function prismTimeLabel(v, diffmode) {
  const s = prismTimeSec(v, diffmode);
  const t = s < 1 ? `${Math.round(s * 1000)}ms` : `${s.toFixed(1)}s`;
  return diffmode === "space" ? `${t} tail` : t;
}

/** The four characters as the indices the processor takes. */
export function prismModeIndices(c) {
  const keys = ["charmode", "movemode", "diffmode", "texmode"];
  const dflt = [0, 0, 2, 2];
  return keys.map((k, i) => {
    const j = PRISM_MODES[k].indexOf(c?.[k]);
    return j >= 0 ? j : dflt[i];
  });
}

const _loads = new WeakMap();
const _ready = new WeakSet();

/** Register the processor on a context. Single-flight per context. */
export function loadPrismWorklet(ctx) {
  if (!ctx?.audioWorklet) return Promise.reject(new Error("no AudioWorklet"));
  let p = _loads.get(ctx);
  if (!p) {
    const url = URL.createObjectURL(new Blob([PRISM_PROCESSOR_SOURCE], { type: "text/javascript" }));
    p = ctx.audioWorklet.addModule(url)
      .then(() => { URL.revokeObjectURL(url); _ready.add(ctx); })
      .catch((e) => { URL.revokeObjectURL(url); _loads.delete(ctx); throw e; });
    _loads.set(ctx, p);
  }
  return p;
}

/** Has the processor finished registering on this context? */
export function prismReady(ctx) { return !!ctx && _ready.has(ctx); }

/**
 * The prism node, or null when the worklet isn't registered — the caller
 * passes the signal through rather than leaving the stage silent.
 */
export function buildPrismNode(ctx, config) {
  if (!prismReady(ctx)) { loadPrismWorklet(ctx).catch(() => {}); return null; }
  try {
    return new AudioWorkletNode(ctx, "sq-prism", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions: { modes: prismModeIndices(config) },
    });
  } catch (e) {
    console.warn("prism worklet node failed", e);
    return null;
  }
}

/** The processor source, for the tests (rendered in Node, as reverb.js's is). */
export function prismProcessorSource() { return PRISM_PROCESSOR_SOURCE; }
