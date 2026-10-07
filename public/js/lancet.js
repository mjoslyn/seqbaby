// ---- lancet: a snare drum synthesizer, seven ways -----------------------------
// A dedicated snare synthesizer: four knobs (DECAY, TIMBRE, COLOR, PITCH), an
// FX amount and a velocity amount whose meaning changes under each of seven
// synthesis MODELS (analog, slap, modal, physical, FM, granular, blend), plus
// a randomizer that throws the knobs per hit. Named for what it does, like the
// other emulators: a lancet is a small sharp cut, which is what a snare is.
//
//   TRIG ─▶ randomizer ─▶ MODEL (one of seven) ─▶ that model's FX ─▶ ceiling ─▶ out
//            (per hit:     DECAY · TIMBRE · COLOR · PITCH · velocity
//             decay, timbre,
//             color, pitch,
//             fx, level, model)
//
// - **Each model is its own instrument, and the FX stage is the model's.** An
//   effect that suits one snare ruins another, so each model carries its own:
//   the analog's is a soft-to-hard clipper, the modal's a multiband distortion
//   that leaves the lows alone, the granular's a compressor, the blend's an
//   old sampler (bits and a clock), the FM's a fold.
// - **The knobs are latched per hit.** A snare is one event; the model, the
//   randomized knobs and the velocity are read when the hit lands and held
//   for the length of the hit, so a randomizer that lands on a different model
//   mid-roll does not retune a hit already sounding. FX is the one knob read
//   live (a lane on it sweeps the distortion), with the hit's random offset
//   added.
// - **The note is the pitch knob.** C2 (the note every blank step on a drum
//   kit gets) is the knob's middle, a 180Hz body, two octaves either side are
//   its travel, and each semitone is a semitone. `tune` trims it.
// - **Velocity is a level and a little more** (`dyn`): a hard hit is a touch
//   brighter and a touch longer, a soft one duller and shorter, by as much as
//   `dyn` says, so a ghost note is a ghost note and not only a quiet one.
// - **The randomizer** is an amount per destination (decay, timbre, color,
//   pitch, fx, level, model), thrown at every trigger. At full amount a knob
//   can land anywhere on its travel, the pitch anywhere within an octave, the
//   level anywhere down to a fifth; the model amount is the CHANCE a hit picks
//   any model. Its random stream is seeded per processor, so a render in the
//   tests is a render.
// - **Four voices, a roll's worth.** A hit on a voice already sounding fades
//   the old one out over 2ms under the new one: a flam is two hits, not a
//   click. One-shot: a note-off does nothing, the transport's stop fades
//   everything.
// - **The models are reasoned, not measured.** Each is what its name says,
//   built honestly: sine waves and noise; sines through a waveshaper; additive
//   partials at a drum head's own modes; an exciter through resonant delay
//   lines; a carrier modulated by oscillators and noise; a snare under a
//   granular engine; layered records. The blend model's "samples" are
//   synthesized layers: there are no records in here.
//
// One list, three namespaces, as in hexop.js / guitar.js / subbass.js: every
// panel control is `lnc` + a short key, which spells its LFO target
// (`lancet_<short>`) and its automation lane (`lancet.<short>`). `lnc`, not
// `l` or `la`: a prefix that is a letter is a collision with the next engine.

const LANCET_PROCESSOR_SOURCE = `
const BLK = 16;            // control-block size
const NV = 4;              // hits sounding at once
const NG = 12;             // grains per voice (granular model)
const SRC_LEN = 8192;      // the granular source, ~170ms at 48k
const NRES = 3;            // resonant lines (physical model)
const TWO_PI = 2 * Math.PI;

// A membrane's modes, as ratios of the fundamental (the Bessel zeros a
// circular drum head rings on), for the modal model.
const MODES = [1, 1.59, 2.14, 2.30, 2.65, 2.92, 3.16, 3.50];
// The chain the granular model's "chain" source rings on: inharmonic, the way
// a cymbal's partials are.
const CHAIN = [1340, 2070, 3310, 4780, 6230, 8900];
// A level trim per model, measured so the model select changes the sound and
// not the level (test/lancet.test.js pins the spread).
const MODEL_TRIM = [1.0, 0.95, 1.1, 1.15, 0.95, 1.0, 1.05];

function bq() { return { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0, z1: 0, z2: 0 }; }
function bqRun(f, x) {
  const y = f.b0 * x + f.z1;
  f.z1 = f.b1 * x - f.a1 * y + f.z2;
  f.z2 = f.b2 * x - f.a2 * y;
  return y;
}
function bqClear(f) { f.z1 = 0; f.z2 = 0; }
// type: 0 lowpass, 1 highpass, 2 bandpass (constant peak gain)
function bqSet(f, type, sr, freq, q) {
  const w = TWO_PI * Math.min(Math.max(freq, 10), sr * 0.45) / sr;
  const c = Math.cos(w), a = Math.sin(w) / (2 * q), n = 1 / (1 + a);
  if (type === 0) { f.b0 = (1 - c) / 2 * n; f.b1 = (1 - c) * n; f.b2 = f.b0; }
  else if (type === 1) { f.b0 = (1 + c) / 2 * n; f.b1 = -(1 + c) * n; f.b2 = f.b0; }
  else { f.b0 = a * n; f.b1 = 0; f.b2 = -a * n; }
  f.a1 = -2 * c * n; f.a2 = (1 - a) * n;
}
// one-pole lowpass coefficient
function lpc(sr, hz) { return 1 - Math.exp(-TWO_PI * Math.min(Math.max(hz, 5), sr * 0.45) / sr); }
// per-sample multiplier for a T60 of t seconds
function dk(sr, t) { return Math.exp(-6.9078 / (Math.max(0.0005, t) * sr)); }
function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
function soft(x) { return x / (1 + (x < 0 ? -x : x)); }
function hard(x) { return x > 1 ? 1 : x < -1 ? -1 : x; }
// triangle fold into -1..1
function fold(x) {
  x = (x + 1) * 0.5;
  x = x - Math.floor(x * 0.5) * 2;
  if (x > 1) x = 2 - x;
  return x * 2 - 1;
}

// ---- the event queue ------------------------------------------------------
// Allocation-free, as in subbass.js: parallel typed arrays, kept in order by
// inserting from the back, one scratch event reused by every shift().
const QCAP = 512;
class HitQueue {
  constructor() {
    this.at = new Float64Array(QCAP); this.id = new Float64Array(QCAP);
    this.freq = new Float64Array(QCAP); this.vel = new Float64Array(QCAP);
    this.head = 0; this.len = 0;
    this.ev = { at: 0, id: 0, freq: 0, vel: 0 };
  }
  _move(d, s) { this.at[d] = this.at[s]; this.id[d] = this.id[s]; this.freq[d] = this.freq[s]; this.vel[d] = this.vel[s]; }
  _compact() {
    const h = this.head, e = h + this.len;
    if (h === 0) return;
    this.at.copyWithin(0, h, e); this.id.copyWithin(0, h, e); this.freq.copyWithin(0, h, e); this.vel.copyWithin(0, h, e);
    this.head = 0;
  }
  push(at, id, freq, vel) {
    if (this.len >= QCAP) this.dropOldest();
    if (this.head + this.len >= QCAP) this._compact();
    let j = this.head + this.len - 1;
    while (j >= this.head && this.at[j] > at) { this._move(j + 1, j); j--; }
    const i = j + 1;
    this.at[i] = at; this.id[i] = id; this.freq[i] = freq; this.vel[i] = vel;
    this.len++;
  }
  headAt() { return this.at[this.head]; }
  shift() {
    const i = this.head, e = this.ev;
    e.at = this.at[i]; e.id = this.id[i]; e.freq = this.freq[i]; e.vel = this.vel[i];
    this.head++; this.len--;
    if (this.len === 0) this.head = 0;
    return e;
  }
  dropAfter(limit) {
    const h = this.head, end = h + this.len;
    let w = h;
    for (let r = h; r < end; r++) if (this.at[r] < limit) { if (w !== r) this._move(w, r); w++; }
    this.len = w - h;
    if (this.len === 0) this.head = 0;
  }
  dropOldest() { if (this.len === 0) return; this.head++; this.len--; if (this.len === 0) this.head = 0; }
}

class LancetProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    const a = (name, defaultValue, minValue = 0, maxValue = 1) => ({ name, defaultValue, minValue, maxValue, automationRate: "a-rate" });
    return [
      // The four track sliders. Defaults match the track's own (harm/timb/morph 0.5, decay 0.4).
      a("timbre", 0.5), a("color", 0.5), a("fx", 0.5), a("decay", 0.4),
      // The panel
      a("tune", 0, -12, 12), a("dyn", 0.7),
      // The randomizer: an amount per destination
      a("rdecay", 0), a("rtimbre", 0), a("rcolor", 0), a("rpitch", 0), a("rfx", 0), a("rlevel", 0), a("rmodel", 0),
    ];
  }

  constructor() {
    super();
    const sr = this.sr = sampleRate;
    this.alive = true;
    this.queue = new HitQueue();
    this.model = 0;
    this.seed = 0x9e3779b9;
    this.age = 0;
    this.resLen = Math.ceil(sr / 40) + 4;   // a resonant line down to 40Hz
    this.voices = [];
    for (let v = 0; v < NV; v++) this.voices.push(this.makeVoice());
    this.port.onmessage = (e) => this.onMessage(e.data);
  }

  makeVoice() {
    const res = [];
    for (let n = 0; n < NRES; n++) res.push(new Float32Array(this.resLen));
    return {
      on: 0, age: 0, life: 0, model: 0, f0: 180, lvl: 1, T: 0.25, tim: 0.5, col: 0.5, fxOff: 0, vel: 1,
      fade: 1, fadeK: 0, env: new Float64Array(8), ph: new Float64Array(8), amp: new Float64Array(8),
      fr: new Float64Array(8), ek: new Float64Array(8),
      pEnv: 0, pEnvK: 1, bend: 1,
      nEnv: 0, nK: 1, nAmp: 0, tEnv: 0, tK: 1,
      n1: 0, n1c: 1, n2: 0, n2c: 1, n3: 0, n3c: 1,
      f1: bq(), f2: bq(), f3: bq(), f4: bq(),
      res, rw: 0, rLen: new Int32Array(NRES), rG: new Float64Array(NRES), rLP: new Float64Array(NRES), rLPc: 1, rCoup: 0, rOut: new Float64Array(NRES),
      xEnv: 0, xK: 1, wEnv: 0,
      src: new Float32Array(SRC_LEN), gOn: new Uint8Array(NG), gPos: new Float64Array(NG), gLen: new Float64Array(NG), gAge: new Float64Array(NG),
      gInc: 1, gLenS: 0.02, gRate: 50, gGain: 1, gNext: 0, gEnv: 0, gK: 1,
      comp: 0, hold: 0, holdPh: 0, dcx: 0, dcy: 0,
      wL: new Float64Array(4), wB: new Float64Array(3),
    };
  }

  // xorshift32, -1..1 and 0..1
  rnd() { let s = this.seed; s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; this.seed = s; return s / 2147483648 - 1; }
  rnd01() { return this.rnd() * 0.5 + 0.5; }

  onMessage(m) {
    if (!m) return;
    if (m.type === "note") {
      if (this.queue.len > 128) this.queue.dropOldest();
      const at = Math.max(0, Math.round(m.when * this.sr));
      this.queue.push(at, m.id, m.freq, m.vel);
    } else if (m.type === "off") {
      const at = Math.max(0, Math.round(m.when * this.sr));
      this.queue.dropAfter(at);
      this.allOff = at;
    } else if (m.type === "set") {
      if (m.model !== undefined) this.model = Math.max(0, Math.min(6, m.model | 0));
    } else if (m.type === "dispose") {
      this.alive = false;
    }
  }

  pv(P, name, i) { const p = P[name]; return p.length > 1 ? p[i] : p[0]; }

  pickVoice() {
    let best = -1, old = Infinity;
    for (let v = 0; v < NV; v++) {
      const V = this.voices[v];
      if (!V.on) return v;
      if (V.age < old) { old = V.age; best = v; }
    }
    return best;
  }

  // ---- a hit --------------------------------------------------------------
  strike(ev, P, i) {
    const sr = this.sr;
    const V = this.voices[this.pickVoice()];
    // The randomizer: thrown per hit, each destination its own throw.
    const r = (name) => { const a = this.pv(P, name, i); return a > 0.0005 ? this.rnd() * a : 0; };
    const dyn = this.pv(P, "dyn", i);
    const vel = clamp01(ev.vel);
    const push = dyn * (vel - 0.75);
    let dec = clamp01(this.pv(P, "decay", i) + r("rdecay") + push * 0.15);
    let tim = clamp01(this.pv(P, "timbre", i) + r("rtimbre") + push * 0.3);
    let col = clamp01(this.pv(P, "color", i) + r("rcolor"));
    const semis = this.pv(P, "tune", i) + r("rpitch") * 12;
    const rlvl = this.pv(P, "rlevel", i);
    const rmod = this.pv(P, "rmodel", i);
    let model = this.model;
    if (rmod > 0.0005 && this.rnd01() < rmod) model = Math.floor(this.rnd01() * 7) % 7;

    V.on = 1; V.age = ++this.age; V.model = model; V.life = 0;
    V.f0 = Math.min(sr * 0.2, Math.max(20, ev.freq * Math.pow(2, semis / 12)));
    V.lvl = (1 - dyn * (1 - vel)) * (1 - (rlvl > 0.0005 ? this.rnd01() * rlvl * 0.8 : 0)) * MODEL_TRIM[model];
    V.T = 0.06 * Math.pow(40, dec);           // 60ms .. 2.4s
    V.tim = tim; V.col = col; V.vel = vel;
    V.fxOff = r("rfx");
    // A voice retaken mid-hit: the old hit is kept 2ms as a tail under the
    // new one (in fadeTail), the rest starts over.
    V.fade = 1; V.fadeK = 0;
    V.env.fill(1); V.ph.fill(0); V.amp.fill(0); V.ek.fill(1);
    V.pEnv = 1; V.pEnvK = 1; V.bend = 1;
    V.nEnv = 1; V.nK = 1; V.nAmp = 0; V.tEnv = 1; V.tK = 1;
    V.n1 = 0; V.n2 = 0; V.n3 = 0;
    bqClear(V.f1); bqClear(V.f2); bqClear(V.f3); bqClear(V.f4);
    V.comp = 0; V.hold = 0; V.holdPh = 0; V.dcx = 0; V.dcy = 0;
    V.gOn.fill(0); V.gEnv = 0;
    const T = V.T;
    switch (model) {
      case 0: this.initAnalog(V, T, tim, col); break;
      case 1: this.initSlap(V, T, tim, col); break;
      case 2: this.initModal(V, T, tim, col); break;
      case 3: this.initPhysical(V, T, tim, col); break;
      case 4: this.initFm(V, T, tim, col); break;
      case 5: this.initGranular(V, T, tim, col); break;
      default: this.initBlend(V, T, tim, col); break;
    }
  }

  // ---- 1. analog: sines and noise, the early drum machines ------------------
  // Two shells (the 808's 185 / 330Hz pair, scaled to the note) with a short
  // pitch envelope, and a noise band. TIMBRE is the noise: its level, how
  // bright the band is and how long it lasts against the shells. COLOR is the
  // pitch envelope (how far the shells drop in, and how fast) and the balance
  // between the two shells.
  initAnalog(V, T, tim, col) {
    const sr = this.sr;
    V.fr[0] = V.f0; V.fr[1] = V.f0 * 1.83;
    V.ek[0] = dk(sr, T * 0.55); V.ek[1] = dk(sr, T * 0.35);
    V.amp[0] = (1 - col * 0.45) * 0.9; V.amp[1] = (0.25 + col * 0.6) * 0.8;
    V.bend = 1 + col * 1.4;
    V.pEnvK = dk(sr, 0.004 + col * 0.03);
    bqSet(V.f1, 1, sr, 500 * Math.pow(12, tim), 0.7);
    bqSet(V.f2, 2, sr, 2500 * Math.pow(3.2, tim), 0.7);
    V.nAmp = (0.25 + tim * 0.75) * 0.9;
    V.nK = dk(sr, T * (0.45 + tim * 0.9));
    V.tK = dk(sr, 0.003);
  }
  analog(V) {
    const sr = this.sr;
    const bend = 1 + (V.bend - 1) * V.pEnv;
    V.pEnv *= V.pEnvK;
    let y = 0;
    for (let k = 0; k < 2; k++) {
      V.ph[k] += V.fr[k] * bend / sr; if (V.ph[k] >= 1) V.ph[k] -= 1;
      y += Math.sin(TWO_PI * V.ph[k]) * V.amp[k] * V.env[k];
      V.env[k] *= V.ek[k];
    }
    const nz = bqRun(V.f2, bqRun(V.f1, this.rnd())) * 1.6;
    y += nz * V.nAmp * V.nEnv + this.rnd() * V.tEnv * 0.3;
    V.nEnv *= V.nK; V.tEnv *= V.tK;
    return y;
  }
  fxAnalog(V, x, fx) {
    // soft clipping at the bottom of the knob to hard clipping at the top
    const drive = 1 + fx * fx * 24;
    const d = x * drive;
    const y = soft(d * 1.4) * (1 - fx) + hard(d) * fx;
    return y * (0.9 - fx * 0.3);
  }

  // ---- 2. slap: sines through a waveshaper, noise with the emphasis ---------
  // Three sines (the third a little off the harmonic series) summed and run
  // through a sine waveshaper; COLOR is how much of the body is the shaped
  // version. The noise is bright and clipped, with a transient of its own and
  // a tail; TIMBRE is the mix between body and noise.
  initSlap(V, T, tim, col) {
    const sr = this.sr;
    V.fr[0] = V.f0; V.fr[1] = V.f0 * 1.5; V.fr[2] = V.f0 * 2.2;
    V.ek[0] = dk(sr, T * 0.5); V.ek[1] = dk(sr, T * 0.3); V.ek[2] = dk(sr, T * 0.2);
    V.amp[0] = 0.8; V.amp[1] = 0.45; V.amp[2] = 0.25;
    V.bend = 1.45; V.pEnvK = dk(sr, 0.012);
    V.tK = dk(sr, 0.004 + tim * 0.004);
    V.nK = dk(sr, T * (0.3 + tim * 0.55));
    bqSet(V.f1, 1, sr, 2500 * Math.pow(3.2, tim), 0.8);
  }
  slap(V) {
    const sr = this.sr;
    const bend = 1 + (V.bend - 1) * V.pEnv;
    V.pEnv *= V.pEnvK;
    let body = 0;
    for (let k = 0; k < 3; k++) {
      V.ph[k] += V.fr[k] * bend / sr; if (V.ph[k] >= 1) V.ph[k] -= 1;
      body += Math.sin(TWO_PI * V.ph[k]) * V.amp[k] * V.env[k];
      V.env[k] *= V.ek[k];
    }
    const col = V.col, tim = V.tim;
    const shaped = Math.sin(body * (1.5 + col * 6));
    const b = body * (1 - col) + shaped * col * 0.9;
    const nz = hard(bqRun(V.f1, this.rnd()) * 4) * 0.6;
    const n = nz * (V.tEnv + V.nEnv * 0.55);
    V.tEnv *= V.tK; V.nEnv *= V.nK;
    return b * (1 - tim * 0.7) + n * (0.2 + tim * 0.8);
  }
  fxSlap(V, x, fx) {
    const d = x * (1 + fx * 5);
    return d / (1 + (d < 0 ? -d : d) * 0.7) * (1 - fx * 0.25);
  }

  // ---- 3. modal: a membrane's partials and processed noise ------------------
  // The fundamental and seven inharmonic partials at a drum head's own mode
  // ratios, each a decaying sine, the high ones dying first; COLOR is the
  // level of the partials against the fundamental, and how fast their level
  // falls up the series. TIMBRE is the noise: its band, its level and how
  // long it lasts. A hair of detune per hit keeps a roll from being one hit
  // eight times.
  initModal(V, T, tim, col) {
    const sr = this.sr;
    for (let n = 0; n < 8; n++) {
      const r = MODES[n] * (1 + this.rnd() * 0.004);
      V.fr[n] = V.f0 * r;
      V.amp[n] = n === 0 ? 1 : (0.12 + 0.88 * col) / Math.pow(r, 1.5 - col * 0.9);
      V.ek[n] = dk(sr, T * 0.9 / Math.pow(r, 0.6));
    }
    V.bend = 1.12; V.pEnvK = dk(sr, 0.006);
    bqSet(V.f1, 2, sr, 1200 * Math.pow(5, tim), 0.9);
    V.nAmp = 0.25 + tim * 0.75;
    V.nK = dk(sr, T * (0.35 + tim * 0.55));
    V.tK = dk(sr, 0.003);
    V.n1c = lpc(sr, 700);
  }
  modal(V) {
    const sr = this.sr;
    const bend = 1 + (V.bend - 1) * V.pEnv;
    V.pEnv *= V.pEnvK;
    let y = 0;
    for (let n = 0; n < 8; n++) {
      V.ph[n] += V.fr[n] * bend / sr; if (V.ph[n] >= 1) V.ph[n] -= 1;
      y += Math.sin(TWO_PI * V.ph[n]) * V.amp[n] * V.env[n];
      V.env[n] *= V.ek[n];
    }
    const nz = bqRun(V.f1, this.rnd()) * 1.5 * V.nAmp * V.nEnv + this.rnd() * V.tEnv * 0.4;
    V.nEnv *= V.nK; V.tEnv *= V.tK;
    return y * 0.55 + nz * 0.8;
  }
  fxModal(V, x, fx) {
    // multiband: the top band is driven, the bottom goes past untouched
    V.n1 += V.n1c * (x - V.n1);
    const lo = V.n1, hi = x - lo;
    const d = hi * (1 + fx * 14);
    const hi2 = soft(d) * (1 / (1 + fx * 2.2)) * (1 + fx * 0.8);
    return lo + hi2;
  }

  // ---- 4. physical: an exciter through resonant delay lines -----------------
  // A noise burst, lowpassed by TIMBRE (dull to bright) and a few ms long,
  // into three comb filters tuned to the body and two more modes, each with a
  // lowpass in its loop (TIMBRE again: the damping, which is the EQ of the
  // body) and a gain set for the decay. COLOR moves the mode ratios from a
  // harmonic set (a tom, a tube) to a membrane's, and couples the lines so
  // they blend into one body rather than ringing apart. The wires are a
  // bandpassed noise riding an envelope of the head's own motion, so they
  // rattle for as long as the head moves.
  initPhysical(V, T, tim, col) {
    const sr = this.sr;
    V.xK = dk(sr, 0.0025 + (1 - tim) * 0.006);
    V.n1c = lpc(sr, 1200 * Math.pow(10, tim));
    const H = [1, 2.0, 3.01], M = [1, 1.59, 2.65];
    for (let n = 0; n < NRES; n++) {
      const r = H[n] * (1 - col) + M[n] * col;
      const len = Math.max(8, Math.min(this.resLen - 2, Math.round(sr / (V.f0 * r))));
      V.rLen[n] = len;
      V.rG[n] = Math.pow(0.001, len / (T * (0.9 - 0.25 * n) * sr));
      V.rLP[n] = 0; V.rOut[n] = 0;
      V.res[n].fill(0);
    }
    V.rw = 0;
    V.rLPc = lpc(sr, 1500 * Math.pow(6, tim));
    V.rCoup = col * 0.12;
    V.xEnv = 1; V.wEnv = 0;
    bqSet(V.f2, 2, sr, 3800, 2.5);
    V.tK = dk(sr, 0.002);
    V.n2c = lpc(sr, 1800 * Math.pow(5, tim));
  }
  physical(V) {
    let x = this.rnd() * V.xEnv; V.xEnv *= V.xK;
    // the lowpass takes most of white noise's power with it; the burst is
    // brought back up so a dull hit is as hard as a bright one
    V.n1 += V.n1c * (x - V.n1); x = V.n1 * 3.5 + this.rnd() * V.tEnv * 0.5; V.tEnv *= V.tK;
    const L = this.resLen, w = V.rw;
    let sum = 0, prev = V.rOut[NRES - 1];
    for (let n = 0; n < NRES; n++) {
      let rp = w - V.rLen[n]; if (rp < 0) rp += L;
      const read = V.res[n][rp];
      V.rLP[n] += V.rLPc * (read - V.rLP[n]);
      const fb = V.rLP[n] * V.rG[n];
      const inp = x + fb + prev * V.rCoup * 0.5;
      V.res[n][w] = inp;
      prev = fb;
      V.rOut[n] = fb;
      sum += fb * (n === 0 ? 1 : n === 1 ? 0.7 : 0.5);
    }
    V.rw = w + 1 >= L ? 0 : w + 1;
    const a = sum < 0 ? -sum : sum;
    V.wEnv += (a - V.wEnv) * (a > V.wEnv ? 0.3 : 0.003);
    V.n2 += V.n2c * (this.rnd() - V.n2);
    const wire = bqRun(V.f2, V.n2) * V.wEnv * 2.5;
    return sum * 1.6 + wire * 0.8 + x * 0.05;
  }
  fxPhysical(V, x, fx) {
    const d = x * (1 + fx * 12) + 0.18 * fx;
    let y = soft(d);
    const dc = y - V.dcx + 0.9995 * V.dcy;
    V.dcx = y; V.dcy = dc;
    return dc * (0.9 - fx * 0.3);
  }

  // ---- 5. fm: a carrier under several modulators and noise -----------------
  // A sine carrier at the body, two sine modulators whose indices decay fast,
  // and a noise modulator through a lowpass. TIMBRE is a macro: the noise
  // modulator's level and tone together (dark and quiet at the bottom, a
  // bright digital clap at the top). COLOR moves both
  // modulator ratios, from near-harmonic (a struck tube) up through the
  // inharmonic (a bell, a pan).
  initFm(V, T, tim, col) {
    const sr = this.sr;
    V.fr[0] = V.f0; V.amp[0] = 1;
    V.fr[1] = V.f0 * Math.pow(2, col * 2.3);
    V.fr[2] = V.f0 * 1.41 * Math.pow(2, col * 1.6);
    V.amp[1] = 2.5; V.amp[2] = 1.5;
    V.ek[0] = dk(sr, T * 0.7); V.ek[1] = dk(sr, T * 0.3); V.ek[2] = dk(sr, T * 0.15);
    V.n1c = lpc(sr, 400 * Math.pow(20, tim));
    V.nAmp = tim * tim * 6;
    V.nK = dk(sr, 0.01 + T * 0.25);
    V.bend = 1.3; V.pEnvK = dk(sr, 0.008);
  }
  fm(V) {
    const sr = this.sr;
    const bend = 1 + (V.bend - 1) * V.pEnv;
    V.pEnv *= V.pEnvK;
    V.ph[1] += V.fr[1] / sr; if (V.ph[1] >= 1) V.ph[1] -= 1;
    V.ph[2] += V.fr[2] / sr; if (V.ph[2] >= 1) V.ph[2] -= 1;
    const m1 = Math.sin(TWO_PI * V.ph[1]) * V.amp[1] * V.env[1];
    const m2 = Math.sin(TWO_PI * V.ph[2]) * V.amp[2] * V.env[2];
    V.n1 += V.n1c * (this.rnd() - V.n1);
    const nz = V.n1 * V.nAmp * V.nEnv * 3;
    V.ph[0] += V.fr[0] * bend / sr; if (V.ph[0] >= 1) V.ph[0] -= 1;
    const c = Math.sin(TWO_PI * V.ph[0] + m1 + m2 + nz);
    V.env[0] *= V.ek[0]; V.env[1] *= V.ek[1]; V.env[2] *= V.ek[2]; V.nEnv *= V.nK;
    return c * V.env[0] * 0.85;
  }
  fxFm(V, x, fx) {
    const d = x * (1 + fx * 6);
    const y = fold(d * 0.9) * 0.55 + soft(d) * 0.6;
    return y * (0.95 - fx * 0.3);
  }

  // ---- 6. granular: a snare with something on the head ----------------------
  // The analog snare, plainly set, under a cloud of grains read from a source
  // made for the hit: TIMBRE picks the material (crossfading rattle, chain,
  // paper, coin and sand), the drummer's coin or chain laid on the head. COLOR
  // is the grain engine on one knob: pitch, duration and density together,
  // low and sparse at the bottom, high, short and dense at the top. The cloud
  // decays with the hit.
  initGranular(V, T, tim, col) {
    const sr = this.sr;
    V.fr[0] = V.f0; V.fr[1] = V.f0 * 1.83;
    V.ek[0] = dk(sr, T * 0.5); V.ek[1] = dk(sr, T * 0.35);
    V.amp[0] = 0.75; V.amp[1] = 0.4;
    V.bend = 1.5; V.pEnvK = dk(sr, 0.012);
    bqSet(V.f1, 1, sr, 2000, 0.7);
    V.nAmp = 0.5; V.nK = dk(sr, T * 0.6); V.tK = dk(sr, 0.003);
    // the source
    const a = tim * 4, i0 = Math.min(3, Math.floor(a)), fr = a - i0;
    V.src.fill(0);
    this.fillSource(V, i0, 1 - fr);
    if (fr > 0.001) this.fillSource(V, i0 + 1, fr);
    V.gInc = Math.pow(2, (col - 0.5) * 2);
    V.gLenS = 0.06 - col * 0.052;
    V.gRate = 20 * Math.pow(10, col);
    V.gGain = 2.4 / Math.sqrt(Math.max(1, V.gRate * V.gLenS));
    V.gNext = 0; V.gEnv = 1; V.gK = dk(sr, T * 0.8);
    V.gOn.fill(0);
    V.n3c = lpc(sr, 3000);
  }
  fillSource(V, kind, g) {
    const sr = this.sr, src = V.src, N = SRC_LEN;
    const f = bq(), det = 1 + this.rnd() * 0.08;
    switch (kind) {
      case 0: { // rattle: sparse impulses through a resonance
        bqSet(f, 2, sr, 2200 * det, 8);
        for (let i = 0; i < N; i++) {
          const imp = this.rnd01() < 0.004 ? this.rnd() * 4 : 0;
          src[i] += bqRun(f, imp) * 1.5 * Math.exp(-i / (sr * 0.12)) * g;
        }
        break;
      }
      case 1: { // chain: inharmonic partials, the high ones dying first
        for (let i = 0; i < N; i++) {
          let s = 0;
          for (let k = 0; k < 6; k++) s += Math.sin(TWO_PI * CHAIN[k] * det * i / sr) * Math.exp(-i / (sr * 0.07 * (6 - k) / 6)) / (k + 1.5);
          src[i] += s * 1.1 * g;
        }
        break;
      }
      case 2: { // paper: a band of noise
        bqSet(f, 2, sr, 3000 * det, 1.2);
        for (let i = 0; i < N; i++) src[i] += bqRun(f, this.rnd()) * 2.2 * Math.exp(-i / (sr * 0.08)) * g;
        break;
      }
      case 3: { // coin: two high rings
        for (let i = 0; i < N; i++) src[i] += (Math.sin(TWO_PI * 5210 * det * i / sr) + Math.sin(TWO_PI * 7930 * det * i / sr) * 0.6) * 0.7 * Math.exp(-i / (sr * 0.09)) * g;
        break;
      }
      default: { // sand: dense noise, dull
        bqSet(f, 0, sr, 2500, 0.7);
        for (let i = 0; i < N; i++) src[i] += bqRun(f, this.rnd()) * 1.6 * Math.exp(-i / (sr * 0.1)) * g;
      }
    }
  }
  granular(V) {
    const sr = this.sr;
    const bend = 1 + (V.bend - 1) * V.pEnv;
    V.pEnv *= V.pEnvK;
    let y = 0;
    for (let k = 0; k < 2; k++) {
      V.ph[k] += V.fr[k] * bend / sr; if (V.ph[k] >= 1) V.ph[k] -= 1;
      y += Math.sin(TWO_PI * V.ph[k]) * V.amp[k] * V.env[k];
      V.env[k] *= V.ek[k];
    }
    y += bqRun(V.f1, this.rnd()) * 1.4 * V.nAmp * V.nEnv + this.rnd() * V.tEnv * 0.3;
    V.nEnv *= V.nK; V.tEnv *= V.tK;
    // the cloud
    if (--V.gNext <= 0) {
      V.gNext = Math.max(4, Math.round(sr / V.gRate * (0.5 + this.rnd01())));
      if (V.gEnv > 0.003) {
        let gi = -1;
        for (let j = 0; j < NG; j++) if (!V.gOn[j]) { gi = j; break; }
        if (gi >= 0) {
          const len = Math.max(16, Math.round(V.gLenS * sr));
          const span = Math.max(1, SRC_LEN - len * Math.max(1, V.gInc) - 2);
          V.gOn[gi] = 1; V.gPos[gi] = this.rnd01() * span * 0.45; V.gLen[gi] = len; V.gAge[gi] = 0;
        }
      }
    }
    let g = 0;
    for (let gi = 0; gi < NG; gi++) {
      if (!V.gOn[gi]) continue;
      const x = V.gAge[gi] / V.gLen[gi];
      if (x >= 1) { V.gOn[gi] = 0; continue; }
      const w = 0.5 - 0.5 * Math.cos(TWO_PI * x);
      const p = V.gPos[gi], i0 = p | 0, fr = p - i0;
      const i1 = i0 + 1 < SRC_LEN ? i0 + 1 : i0;
      g += (V.src[i0] + (V.src[i1] - V.src[i0]) * fr) * w;
      V.gPos[gi] = p + V.gInc; V.gAge[gi] += 1;
    }
    V.gEnv *= V.gK;
    return y * 0.6 + g * V.gEnv * V.gGain;
  }
  fxGranular(V, x, fx) {
    // a compressor, a little soft clipping, and presence
    const a = x < 0 ? -x : x;
    V.comp += (a - V.comp) * (a > V.comp ? 0.05 : 0.0008);
    const thr = 0.25;
    const gain = V.comp > thr ? Math.pow(thr / V.comp, 0.75) : 1;
    let y = x * gain * (1 + fx * 1.6);
    V.n3 += V.n3c * (y - V.n3);
    y += (y - V.n3) * fx * 0.8;
    return soft(y * 1.2) * 0.9;
  }

  // ---- 7. blend: layered records --------------------------------------------
  // Four high layers (paper, splash, crack, brush) that TIMBRE crossfades
  // between, over three bodies (deep, wood, ring) that COLOR blends, all
  // band-limited and warmed the way a record and a sampler leave a snare.
  // There are no records in here; every layer is synthesized.
  initBlend(V, T, tim, col) {
    const sr = this.sr;
    const m = T / 0.26;
    const a = tim * 3, i0 = Math.min(2, Math.floor(a)), fa = a - i0;
    V.wL.fill(0); V.wL[i0] = 1 - fa; V.wL[i0 + 1] = fa;
    const b = col * 2, j0 = Math.min(1, Math.floor(b)), fb = b - j0;
    V.wB.fill(0); V.wB[j0] = 1 - fb; V.wB[j0 + 1] = fb;
    // the high layers' envelopes: slots 4..7 of env; their rings in 6 / 7
    V.ek[4] = dk(sr, 0.09 * m); V.ek[5] = dk(sr, 0.16 * m); V.ek[6] = dk(sr, 0.07 * m); V.ek[7] = dk(sr, 0.22 * m);
    bqSet(V.f1, 2, sr, 2500, 1.0);
    bqSet(V.f2, 1, sr, 4000, 0.8);
    bqSet(V.f3, 2, sr, 1600, 2.0);
    bqSet(V.f4, 0, sr, 3000, 0.8);
    V.nK = dk(sr, 0.05 * m);   // the splash's ring
    V.tK = dk(sr, 0.02 * m);   // the crack's ping
    // the bodies: slots 0..3
    V.fr[0] = V.f0 * 0.8; V.fr[1] = V.f0; V.fr[2] = V.f0 * 1.5; V.fr[3] = V.f0 * 1.3;
    V.amp[0] = V.wB[0] * 0.9; V.amp[1] = V.wB[1] * 0.85; V.amp[2] = V.wB[1] * 0.35; V.amp[3] = V.wB[2] * 0.8;
    V.ek[0] = dk(sr, T * 0.9); V.ek[1] = dk(sr, T * 0.5); V.ek[2] = dk(sr, T * 0.4); V.ek[3] = dk(sr, T * 0.8);
    V.bend = 1 + 0.5 * V.wB[0] + 0.15; V.pEnvK = dk(sr, 0.01);
    V.n2c = lpc(sr, 9000);
  }
  blend(V) {
    const sr = this.sr;
    const bend = 1 + (V.bend - 1) * V.pEnv;
    V.pEnv *= V.pEnvK;
    let y = 0;
    for (let k = 0; k < 4; k++) {
      if (V.amp[k] === 0) continue;
      V.ph[k] += V.fr[k] * bend / sr; if (V.ph[k] >= 1) V.ph[k] -= 1;
      y += Math.sin(TWO_PI * V.ph[k]) * V.amp[k] * V.env[k];
      V.env[k] *= V.ek[k];
    }
    const nz = this.rnd();
    const w = V.wL;
    if (w[0] > 0) y += bqRun(V.f1, nz) * 1.6 * V.env[4] * w[0];
    if (w[1] > 0) {
      V.ph[5] += 6300 / sr; if (V.ph[5] >= 1) V.ph[5] -= 1;
      y += (bqRun(V.f2, nz) * 0.9 + Math.sin(TWO_PI * V.ph[5]) * 0.3 * V.nEnv) * V.env[5] * w[1];
    }
    if (w[2] > 0) {
      V.ph[6] += 1000 / sr; if (V.ph[6] >= 1) V.ph[6] -= 1;
      y += (bqRun(V.f3, nz) * 2.0 + Math.sin(TWO_PI * V.ph[6]) * 0.5 * V.tEnv) * V.env[6] * w[2];
    }
    if (w[3] > 0) {
      V.ph[7] += 60 / sr; if (V.ph[7] >= 1) V.ph[7] -= 1;
      y += bqRun(V.f4, nz) * 0.9 * (0.7 + 0.3 * Math.sin(TWO_PI * V.ph[7])) * V.env[7] * w[3];
    }
    V.env[4] *= V.ek[4]; V.env[5] *= V.ek[5]; V.env[6] *= V.ek[6]; V.env[7] *= V.ek[7];
    V.nEnv *= V.nK; V.tEnv *= V.tK;
    // the record: band-limited, a little warm
    V.n2 += V.n2c * (y - V.n2);
    const r = V.n2;
    return (r + 0.08 * r * (r < 0 ? -r : r)) * 0.8;
  }
  fxBlend(V, x, fx) {
    // an old sampler: a slower clock, fewer bits, a soft clip
    const sr = this.sr;
    const hz = 44100 * Math.pow(0.25, fx);
    V.holdPh += hz / sr;
    if (V.holdPh >= 1) {
      V.holdPh -= Math.floor(V.holdPh);
      const bits = 16 - fx * 10;
      const step = 2 / Math.pow(2, bits);
      V.hold = Math.round(x / step) * step;
    }
    const d = V.hold * (1 + fx * 2);
    return d / (1 + (d < 0 ? -d : d) * 0.35) * (1 - fx * 0.2);
  }

  // ---- one sample of one voice ---------------------------------------------
  voice(V, fxLive) {
    let x;
    switch (V.model) {
      case 0: x = this.analog(V); break;
      case 1: x = this.slap(V); break;
      case 2: x = this.modal(V); break;
      case 3: x = this.physical(V); break;
      case 4: x = this.fm(V); break;
      case 5: x = this.granular(V); break;
      default: x = this.blend(V); break;
    }
    const fx = clamp01(fxLive + V.fxOff);
    // the first fifth of the knob brings the stage in from clean
    const w = fx < 0.2 ? fx * 5 : 1;
    if (w > 0) {
      let y;
      switch (V.model) {
        case 0: y = this.fxAnalog(V, x, fx); break;
        case 1: y = this.fxSlap(V, x, fx); break;
        case 2: y = this.fxModal(V, x, fx); break;
        case 3: y = this.fxPhysical(V, x, fx); break;
        case 4: y = this.fxFm(V, x, fx); break;
        case 5: y = this.fxGranular(V, x, fx); break;
        default: y = this.fxBlend(V, x, fx); break;
      }
      x = x * (1 - w) + y * w;
    }
    if (V.fadeK > 0) { V.fade -= V.fadeK; if (V.fade <= 0) { V.fade = 0; V.on = 0; } }
    V.life++;
    return x * V.lvl * V.fade;
  }

  // Is this hit finished? Every envelope under -80dB and no grain alive. Not
  // before it is 60ms old: the physical model's lines have not come round
  // once in a block, and the exciter alone would read as finished.
  finished(V) {
    if (V.life < this.sr * 0.06) return false;
    for (let k = 0; k < 8; k++) if (V.env[k] > 1e-4 && V.amp[k] !== 0) return false;
    if (V.nEnv > 1e-4 && V.nAmp > 0) return false;
    if (V.model === 3 && V.wEnv > 1e-4) return false;
    if (V.model === 3) { for (let n = 0; n < NRES; n++) if (Math.abs(V.rOut[n]) > 1e-4) return false; }
    if (V.model === 5) { if (V.gEnv > 1e-4) return false; for (let g = 0; g < NG; g++) if (V.gOn[g]) return false; }
    if (V.model === 6) { for (let k = 4; k < 8; k++) if (V.env[k] > 1e-4 && V.wL[k - 4] > 0) return false; }
    return true;
  }

  fadeAll(ms) {
    const k = 1 / Math.max(1, ms * 0.001 * this.sr);
    for (let v = 0; v < NV; v++) { const V = this.voices[v]; if (V.on && V.fadeK === 0) V.fadeK = k; }
  }

  process(inputs, outputs, params) {
    if (!this.alive) return false;
    const out = outputs[0];
    if (!out || !out.length) return true;
    const o0 = out[0], o1 = out[1] || null;
    const n128 = o0.length;
    const P = params;
    const startFrame = currentFrame;

    for (let base = 0; base < n128; base += BLK) {
      const blk = Math.min(BLK, n128 - base);
      const at = startFrame + base;
      if (this.allOff !== undefined && at >= this.allOff) { this.fadeAll(10); this.allOff = undefined; }
      while (this.queue.len && this.queue.headAt() <= at) {
        const ev = this.queue.shift();
        // A voice retaken while sounding: fade the old hit out under the new
        // one rather than cutting it. pickVoice prefers a free one.
        let free = false;
        for (let v = 0; v < NV; v++) if (!this.voices[v].on) { free = true; break; }
        if (!free) { this.fadeAll(2); }
        this.strike(ev, P, base);
      }
      let any = false;
      for (let v = 0; v < NV; v++) if (this.voices[v].on) { any = true; break; }
      if (!any) {
        for (let s = 0; s < blk; s++) { o0[base + s] = 0; if (o1) o1[base + s] = 0; }
        continue;
      }
      const fxLive = this.pv(P, "fx", base);
      for (let s = 0; s < blk; s++) {
        let y = 0;
        for (let v = 0; v < NV; v++) { const V = this.voices[v]; if (V.on) y += this.voice(V, fxLive); }
        // a soft ceiling: four hits on one voice and a driven fx stage can add up
        y = y / Math.sqrt(1 + y * y);
        o0[base + s] = y; if (o1) o1[base + s] = y;
      }
      for (let v = 0; v < NV; v++) { const V = this.voices[v]; if (V.on && V.fadeK === 0 && this.finished(V)) V.on = 0; }
    }
    return true;
  }
}

registerProcessor("lancet", LancetProcessor);
`;

/** The processor source, for test/lancet.test.js — evaluated there against the
 *  worklet globals a test stubs, as drone.js's is. */
export function lancetProcessorSource() { return LANCET_PROCESSOR_SOURCE; }

const _loads = new WeakMap();
const _ready = new WeakSet();

/**
 * Register the lancet processor on this context. Called at init() so the await
 * on the play path has already resolved by the time a voice is built.
 * @param {BaseAudioContext} ctx @returns {Promise<void>}
 */
export function loadLancetWorklet(ctx) {
  if (!ctx?.audioWorklet) return Promise.reject(new Error("no AudioWorklet"));
  let p = _loads.get(ctx);
  if (!p) {
    const url = URL.createObjectURL(new Blob([LANCET_PROCESSOR_SOURCE], { type: "text/javascript" }));
    p = ctx.audioWorklet.addModule(url)
      .then(() => { URL.revokeObjectURL(url); _ready.add(ctx); })
      .catch((e) => { URL.revokeObjectURL(url); _loads.delete(ctx); throw e; });
    _loads.set(ctx, p);
  }
  return p;
}

/** Has the processor finished registering on this context? */
export function lancetReady(ctx) { return !!ctx && _ready.has(ctx); }

// ---- the panel ----------------------------------------------------------
// Keys are `lnc` + short key -> `lancet_<short>` / `lancet.<short>`. The list,
// the ranges, the defaults, the models and the strikes are data in
// engineData.js; re-exported here.
import { LANCET_MOD_KEYS, LANCET_MODELS } from "./engineData.js";
export {
  LANCET_NUM_CTLS, LANCET_SEL_CTLS, LANCET_MOD_KEYS, LANCET_NUM_KEYS, LANCET_SEL_KEYS,
  LANCET_MOD_RANGE, LANCET_MOD_LABELS, LANCET_DEFAULTS, lancetFromUnit,
  LANCET_MODELS, LANCET_MODEL_TIPS, lancetModelTip,
  LANCET_TONE_NAMES, lancetToneDescription, lancetTone,
} from "./engineData.js";

// Tone wrappers don't accept a native connect() — unwrap to the node underneath.
const nativeIn = (node) => node?.input?.input ?? node?.input ?? node;

/**
 * Build the lancet voice. Returns null when the worklet isn't registered yet,
 * so the caller can fall back rather than leave the track silent.
 * @param {*} output Tone node the voice writes into.
 */
export function buildLancetVoice(output) {
  const ctx = Tone.getContext().rawContext;
  if (!lancetReady(ctx)) { loadLancetWorklet(ctx).catch(() => {}); return null; }

  let node;
  try {
    node = new AudioWorkletNode(ctx, "lancet",
      { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
  } catch (e) {
    console.warn("lancet worklet node failed", e);
    return null;
  }
  node.connect(nativeIn(output));

  const PARAM_OF = { harm: "timbre", timb: "color", morph: "fx", decay: "decay" };
  for (const k of LANCET_MOD_KEYS) PARAM_OF[`lnc${k}`] = k;

  const P = {};
  for (const name of Object.values(PARAM_OF)) P[name] = node.parameters.get(name);
  const post = (m) => { try { node.port.postMessage(m); } catch {} };

  let noteId = 0;
  const paramFor = (key) => P[PARAM_OF[key]] ?? null;

  return {
    nodes: [{ dispose() { try { node.port.postMessage({ type: "dispose" }); } catch {} try { node.disconnect(); } catch {} } }],
    setParam: (key, val) => {
      if (key === "lncmodel") { post({ type: "set", model: Math.max(0, LANCET_MODELS.indexOf(String(val))) }); return; }
      const p = paramFor(key);
      if (!p) return;
      const v = Number(val);
      if (!Number.isFinite(v)) return;
      p.value = Math.max(p.minValue, Math.min(p.maxValue, v));
    },
    getAudioParam: (key) => paramFor(key),
    trigger: (note, time, dur, vel) => {
      const when = Math.max(Number(time) || 0, ctx.currentTime);
      // C2, the note every blank step on a drum kit gets, is the pitch knob's
      // middle: a 180Hz body. Each semitone is a semitone from there.
      post({
        type: "note", when, id: ++noteId, note,
        freq: 180 * Math.pow(2, (note - 36) / 12),
        vel: Math.max(0.05, Math.min(1, vel ?? 1)),
      });
    },
    // One-shot: a drum has nothing to let go of, and a keyboard key lifted
    // early must not cut a snare's tail, so release is a no-op as it is for the
    // 808 voices. The processor's "off" (a fade of everything sounding) is
    // reachable through the port for the tests and for anything that needs it.
    release: () => {},
  };
}
