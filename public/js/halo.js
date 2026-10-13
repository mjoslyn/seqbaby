// ---- halo: a cymbal synthesizer ----------------------------------------------
// Hats, rides, crashes, chinas, splashes and gongs from one voice: four
// synthesis models under four knobs (TONE, SIZE, SPREAD, DECAY), a strike
// transient, a swell that is the crash's bloom, a choke that makes one track a
// hi-hat whose step length is how far the pedal is open, and a stereo width.
// Named for what it does, like the other emulators: a halo is a ring of
// light, which is what a cymbal is to the ear.
//
//   TRIG ─▶ vary ─▶ MODEL ──────────▶ AMP ─▶ TONE (hp + lp) ─▶ + ─▶ WIDTH ─▶ L/R
//                   metal · fm ·       ▲      read live         ▲    (mono-safe
//                   modal · noise      │                        │     side)
//                     ▲ BLOOM ─────────┘              STICK ────┘
//                       (the swell)            (the strike's tick)
//
// - **Four models, because "a cymbal" is four different machines.** METAL is
//   the 808's six square waves at its own inharmonic frequencies through two
//   bandpasses, the hat and cymbal every drum machine since has copied. FM is
//   three inharmonic carrier / modulator pairs at a high index, the digital
//   cymbal. MODAL is forty damped partials on a plate's stretched series, each
//   decaying faster the higher it sits, as metal does: the acoustic one, and
//   with the size down and the spread up, a gong. NOISE is filtered noise in
//   two bands, the cheapest hat there is and still the right one for a shaker
//   or a trashy splash. SPREAD is each model's own character (the metal's
//   ratios stretched or squeezed, the fm's index, the modes' spacing, the
//   noise's bandwidth); SIZE scales every partial together.
// - **Tone is read live; everything else is latched per hit.** A cymbal is one
//   event, so the model, the size, the spread, the decay and the hit's random
//   offsets are read when it lands and held; the tone is the hp / lp pair
//   after the model, recomputed every block, so a lane on it opens a crash
//   that is already ringing.
// - **A cymbal's envelope has two speeds.** The strike falls fast and the
//   wash rings on: the amplitude is half a decay at a seventh of the knob and
//   half at the knob. The modal model needs neither, since its partials decay
//   on their own, each at its own rate.
// - **BLOOM is the swell.** A struck crash gets louder after the hit as the
//   energy moves from the low modes into the high ones. Here that is a second
//   envelope that rises over 40ms to 300ms and then decays at the knob; on the
//   modal model it drives noise into the partials, so they ring up rather than
//   the output being turned up.
// - **CHOKE makes it a hi-hat.** In choke mode a hit is cut 18ms after its
//   step ends, as a pedal closing on it, and a new hit cuts every hit before
//   it: one hat, one sound. Write a short step for a closed hat and a tied one
//   for an open hat, on one track. In trig mode the step's length is ignored
//   and hits ring over each other, as crashes do.
// - **Velocity is a level and a little brightness** (`dyn`), and `vary`
//   throws the tone, pitch, decay and level a little on every hit, so a ride
//   pattern is not one sample played eight times. The random stream is seeded
//   per processor, so a render in the tests is a render.
// - **The width is mono-safe.** One channel gets the signal plus a
//   decorrelated copy, the other the signal minus it, so the two sum back to
//   the signal exactly: a mono speaker hears no comb.
// - **The note is the pitch.** C2, every blank step on a drum kit, is the
//   nominal cymbal; a semitone up the keyboard is a semitone up. `tune` trims.
// - **Reasoned, not measured.** The 808's oscillator frequencies are the
//   circuit's; the rest is what the names say, built honestly, with no
//   cymbal under test.
//
// One list, three namespaces, as in hexop.js / lancet.js / siege.js: every
// panel control is `hlo` + a short key, which spells its LFO target
// (`halo_<short>`) and its automation lane (`halo.<short>`). The four track
// sliders are TONE / SIZE / SPREAD / DECAY.

const HALO_PROCESSOR_SOURCE = `
const BLK = 16;            // control-block size
const NV = 8;              // voice slots
const NACTIVE = 6;         // hits sounding at once before the oldest is faded
const NM = 40;             // partials (modal model)
const TWO_PI = 2 * Math.PI;

// The 808's six cymbal / hat oscillators, in hertz: the circuit's own values.
const METAL = [205.3, 304.4, 369.6, 522.7, 540.0, 800.0];
// The fm model's three pairs: carrier ratios and modulator ratios, both off
// the harmonic series so nothing in them sums to a pitch.
const FM_C = [1, 1.4173, 2.2107];
const FM_M = [2.7613, 3.1729, 1.8331];
// A level trim per model, measured so the model select changes the sound and
// not the level (test/halo.test.js pins the spread).
const MODEL_TRIM = [1.6, 1.0, 0.72, 0.8];

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
// per-sample multiplier for a T60 of t seconds
function dk(sr, t) { return Math.exp(-6.9078 / (Math.max(0.0005, t) * sr)); }
function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
// A fixed number in -1..1 per index: the same cymbal every time.
function hash(i) {
  let h = (i + 1) * 0x9e3779b1;
  h ^= h >>> 15; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) / 2147483648 - 1;
}
// A polyBLEP square: the corrections on both edges.
function blep(t, dt) {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
}

// ---- the event queue ------------------------------------------------------
// Allocation-free, as in subbass.js: parallel typed arrays, kept in order by
// inserting from the back, one scratch event reused by every shift().
const QCAP = 512;
class HitQueue {
  constructor() {
    this.at = new Float64Array(QCAP); this.id = new Float64Array(QCAP);
    this.freq = new Float64Array(QCAP); this.vel = new Float64Array(QCAP); this.dur = new Float64Array(QCAP);
    this.head = 0; this.len = 0;
    this.ev = { at: 0, id: 0, freq: 0, vel: 0, dur: 0 };
  }
  _move(d, s) { this.at[d] = this.at[s]; this.id[d] = this.id[s]; this.freq[d] = this.freq[s]; this.vel[d] = this.vel[s]; this.dur[d] = this.dur[s]; }
  _compact() {
    const h = this.head, e = h + this.len;
    if (h === 0) return;
    this.at.copyWithin(0, h, e); this.id.copyWithin(0, h, e); this.freq.copyWithin(0, h, e);
    this.vel.copyWithin(0, h, e); this.dur.copyWithin(0, h, e);
    this.head = 0;
  }
  push(at, id, freq, vel, dur) {
    if (this.len >= QCAP) this.dropOldest();
    if (this.head + this.len >= QCAP) this._compact();
    let j = this.head + this.len - 1;
    while (j >= this.head && this.at[j] > at) { this._move(j + 1, j); j--; }
    const i = j + 1;
    this.at[i] = at; this.id[i] = id; this.freq[i] = freq; this.vel[i] = vel; this.dur[i] = dur;
    this.len++;
  }
  headAt() { return this.at[this.head]; }
  shift() {
    const i = this.head, e = this.ev;
    e.at = this.at[i]; e.id = this.id[i]; e.freq = this.freq[i]; e.vel = this.vel[i]; e.dur = this.dur[i];
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

// ---- the width: a decorrelated side, three short Schroeder allpasses ----------
// (a longer chain decorrelates lower down, and smears a choked hat into a tail)
function apMake(sr, ms) { const n = Math.max(1, Math.round(ms * 0.001 * sr)); return { buf: new Float32Array(n), i: 0 }; }
function apRun(a, x, g) {
  const d = a.buf[a.i];
  const v = x + g * d;
  a.buf[a.i] = v;
  a.i = a.i + 1 === a.buf.length ? 0 : a.i + 1;
  return d - g * v;
}

class HaloProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    const a = (name, defaultValue, minValue = 0, maxValue = 1) => ({ name, defaultValue, minValue, maxValue, automationRate: "a-rate" });
    return [
      // The four track sliders. Defaults match the track's own (harm/timb/morph 0.5, decay 0.4).
      a("tone", 0.5), a("size", 0.5), a("spread", 0.5), a("decay", 0.4),
      // The panel
      a("tune", 0, -12, 12), a("dyn", 0.6), a("bloom", 0), a("stick", 0.4), a("width", 0.5), a("vary", 0.1),
    ];
  }

  constructor() {
    super();
    const sr = this.sr = sampleRate;
    this.alive = true;
    this.queue = new HitQueue();
    this.model = 0;
    this.choke = 0;
    this.seed = 0x2545f491;
    this.age = 0;
    this.voices = [];
    for (let v = 0; v < NV; v++) this.voices.push(this.makeVoice());
    this.ap = [apMake(sr, 1.3), apMake(sr, 2.1), apMake(sr, 3.1)];
    this.idle = 0;
    this.port.onmessage = (e) => this.onMessage(e.data);
  }

  makeVoice() {
    return {
      on: 0, age: 0, life: 0, offAt: -1, model: 0, k: 1, lvl: 1, T: 0.3,
      toneOff: 0, spread: 0.5, bloom: 0, fade: 1, fadeK: 0,
      // the amplitude: a fast and a slow decay, and the swell
      eF: 0, eFk: 1, eS: 0, eSk: 1, sw: 0, swA: 0, swK: 1, swPk: 1,
      // the strike
      st: 0, stK: 1, stLvl: 0, stF: bq(),
      // metal: six squares, two bands
      ph: new Float64Array(6), dt: new Float64Array(6), bA: bq(), bB: bq(), mix: 0.5,
      // fm: three pairs
      cph: new Float64Array(3), mph: new Float64Array(3), cf: new Float64Array(3), mf: new Float64Array(3), idx: 4,
      // modal: forty resonators
      m1: new Float64Array(NM), m2: new Float64Array(NM), mc: new Float64Array(NM), mr2: new Float64Array(NM),
      mn: new Float64Array(NM), nm: 0, mEnv: 0, mEnvK: 1,
      // noise: two bands
      nA: bq(), nB: bq(), nG: 1,
      // the tone: hp + lp, recomputed per block
      hp: bq(), lp: bq(),
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
      this.queue.push(at, m.id, m.freq, m.vel, Math.max(0, Number(m.dur) || 0));
    } else if (m.type === "off") {
      const at = Math.max(0, Math.round(m.when * this.sr));
      this.queue.dropAfter(at);
      this.allOff = at;
    } else if (m.type === "release") {
      // A key let go: in choke mode the pedal closes, in trig mode a crash
      // rings on.
      if (this.choke) this.relAt = Math.max(0, Math.round(m.when * this.sr));
    } else if (m.type === "set") {
      if (m.model !== undefined) this.model = Math.max(0, Math.min(3, m.model | 0));
      if (m.choke !== undefined) this.choke = m.choke ? 1 : 0;
    } else if (m.type === "dispose") {
      this.alive = false;
    }
  }

  pv(P, name, i) { const p = P[name]; return p.length > 1 ? p[i] : p[0]; }

  fadeVoice(V, ms) {
    const k = 1 / Math.max(1, ms * 0.001 * this.sr);
    if (V.on && (V.fadeK === 0 || V.fadeK < k)) V.fadeK = k;
  }
  fadeAll(ms) { for (let v = 0; v < NV; v++) this.fadeVoice(this.voices[v], ms); }

  // A free slot, after fading the oldest hit if six are already sounding. If
  // every slot is taken (a roll faster than a fade), the most faded one.
  pickVoice() {
    let active = 0, oldest = -1, oldAge = Infinity, free = -1;
    for (let v = 0; v < NV; v++) {
      const V = this.voices[v];
      if (!V.on) { if (free < 0) free = v; continue; }
      if (V.fadeK === 0) { active++; if (V.age < oldAge) { oldAge = V.age; oldest = v; } }
    }
    if (active >= NACTIVE && oldest >= 0) this.fadeVoice(this.voices[oldest], 3);
    if (free >= 0) return free;
    let best = 0, least = Infinity;
    for (let v = 0; v < NV; v++) if (this.voices[v].fade < least) { least = this.voices[v].fade; best = v; }
    return best;
  }

  // ---- a hit --------------------------------------------------------------
  strike(ev, P, i) {
    const sr = this.sr;
    // A hat is one object: in choke mode a new hit closes every hit before it.
    if (this.choke) this.fadeAll(8);
    const V = this.voices[this.pickVoice()];
    const vary = this.pv(P, "vary", i);
    const r = (amt) => vary > 0.0005 ? this.rnd() * vary * amt : 0;
    const dyn = this.pv(P, "dyn", i);
    const vel = clamp01(ev.vel);
    const size = clamp01(this.pv(P, "size", i));
    const spread = clamp01(this.pv(P, "spread", i));
    const decay = clamp01(this.pv(P, "decay", i));
    const semis = this.pv(P, "tune", i) + r(0.7);

    V.on = 1; V.age = ++this.age; V.life = 0; V.model = this.model;
    V.offAt = this.choke ? Math.max(1, Math.round(ev.dur * sr)) : -1;
    // C2 at size 0.5 is the nominal cymbal; size scales every partial an
    // octave and a half either way (bigger is lower), the note a semitone a
    // semitone.
    V.k = (ev.freq / 65.40639132514966) * Math.pow(2, semis / 12 + (0.5 - size) * 3);
    V.lvl = (1 - dyn * (1 - vel)) * (1 - (vary > 0.0005 ? this.rnd01() * vary * 0.3 : 0)) * MODEL_TRIM[V.model];
    V.toneOff = dyn * (vel - 0.75) * 0.25 + r(0.12);
    V.T = 0.03 * Math.pow(300, decay) * (1 + r(0.3));     // 30ms .. 9s
    V.spread = spread;
    V.bloom = clamp01(this.pv(P, "bloom", i));
    V.fade = 1; V.fadeK = 0;

    // The amplitude: half falls at a seventh of the decay, half at the decay.
    V.eF = 0.5; V.eFk = dk(sr, V.T / 7);
    V.eS = 0.5; V.eSk = dk(sr, V.T);
    // The swell: rises over 40..300ms, then decays at the knob. Normalised
    // so its peak is about the strike's.
    const tau = 0.04 + V.bloom * 0.26;
    V.sw = 0; V.swA = 1 - Math.exp(-1 / (tau * sr)); V.swK = V.eSk;
    V.swPk = 1;

    // The strike: a few milliseconds of bandpassed noise, brighter and
    // louder the harder the stick.
    const stick = clamp01(this.pv(P, "stick", i) + r(0.3));
    V.st = 1; V.stK = dk(sr, 0.02); V.stLvl = stick * 1.4;
    bqClear(V.stF); bqSet(V.stF, 2, sr, 2200 * (0.6 + 1.2 * stick) * Math.min(2, Math.sqrt(V.k)), 0.8);

    bqClear(V.hp); bqClear(V.lp);
    switch (V.model) {
      case 0: this.initMetal(V); break;
      case 1: this.initFm(V); break;
      case 2: this.initModal(V); break;
      default: this.initNoise(V); break;
    }
  }

  // ---- 1. metal: the 808's six squares through two bands --------------------
  // SPREAD stretches the ratios between the six (0.5 is the circuit's own,
  // lower squeezes them toward a chord, higher pulls them apart). The two
  // bands are the 808's 3.44kHz and 7.1kHz; the low one is the cymbal's body,
  // and it fades out as the size goes down, which is what makes a small one
  // a hat.
  initMetal(V) {
    const sr = this.sr;
    const ex = 0.5 + V.spread;
    for (let j = 0; j < 6; j++) {
      const f = METAL[0] * Math.pow(METAL[j] / METAL[0], ex) * V.k;
      V.dt[j] = Math.min(0.45, f / sr);
      V.ph[j] = hash(j + 11) * 0.5 + 0.5;
    }
    const b = Math.min(1.6, Math.sqrt(V.k));
    bqClear(V.bA); bqClear(V.bB);
    bqSet(V.bA, 2, sr, 3440 * b, 1.6);
    bqSet(V.bB, 2, sr, 7100 * b, 1.4);
    V.mix = clamp01(0.75 - 0.35 * Math.log2(V.k));
  }
  metal(V) {
    let s = 0;
    for (let j = 0; j < 6; j++) {
      const dt = V.dt[j];
      let p = V.ph[j] + dt; if (p >= 1) p -= 1;
      V.ph[j] = p;
      let q = p < 0.5 ? 1 : -1;
      q += blep(p, dt);
      let p2 = p + 0.5; if (p2 >= 1) p2 -= 1;
      q -= blep(p2, dt);
      s += q;
    }
    s *= 0.25;
    return bqRun(V.bA, s) * V.mix * 1.3 + bqRun(V.bB, s) * 1.6;
  }

  // ---- 2. fm: three inharmonic pairs at a high index -------------------------
  // SPREAD is the index, from a glassy ring to a wall of sidebands; the index
  // falls with the hit, so the attack is the brightest part.
  initFm(V) {
    const base = 1180 * V.k;
    for (let j = 0; j < 3; j++) {
      V.cf[j] = Math.min(this.sr * 0.45, base * FM_C[j]);
      V.mf[j] = Math.min(this.sr * 0.45, base * FM_M[j]);
      V.cph[j] = 0; V.mph[j] = hash(j + 31) * 0.5 + 0.5;
    }
    V.idx = 1.5 + V.spread * V.spread * 14;
  }
  fm(V) {
    const sr = this.sr;
    const I = V.idx * (0.45 + 0.55 * (V.eF * 2));
    let s = 0;
    for (let j = 0; j < 3; j++) {
      V.mph[j] += V.mf[j] / sr; if (V.mph[j] >= 1) V.mph[j] -= 1;
      V.cph[j] += V.cf[j] / sr; if (V.cph[j] >= 1) V.cph[j] -= 1;
      s += Math.sin(TWO_PI * V.cph[j] + I * Math.sin(TWO_PI * V.mph[j]));
    }
    return s * 0.42;
  }

  // ---- 3. modal: forty partials on a plate's stretched series -----------------
  // Partial m sits at (1 + 0.35m)^p over a 420Hz bottom, p from 1.2 (dense,
  // a trashy china) to 2 (sparse, a bell, and with the size down a gong),
  // each nudged a few percent by a fixed hash so the series never lines up.
  // A partial decays faster the higher it sits; each is a resonator, struck
  // at the hit and driven by the bloom's noise after it.
  initModal(V) {
    const sr = this.sr;
    const p = 1.2 + V.spread * 0.8;
    const base = 420 * V.k;
    let n = 0, norm = 0;
    let longest = 0;
    for (let m = 0; m < NM; m++) {
      const ratio = Math.pow(1 + 0.35 * m, p) * (1 + hash(m) * 0.03);
      const f = base * ratio;
      if (f > sr * 0.45 || f > 19000) break;
      const T = V.T * Math.pow(ratio, -0.4) * (1 + hash(m + 97) * 0.15);
      const rr = Math.exp(-6.9078 / (Math.max(0.003, T) * sr));
      const w = TWO_PI * f / sr;
      const a = Math.pow(ratio, -0.3) * (0.7 + 0.3 * (hash(m + 53) * 0.5 + 0.5));
      V.mc[n] = 2 * rr * Math.cos(w); V.mr2[n] = rr * rr;
      // Struck: each partial starts at its own fixed phase. In phase, forty
      // of them sum to one spike four times the cymbal's level.
      const ph = Math.PI * hash(m + 7);
      V.m1[n] = a * Math.sin(ph - w) / rr; V.m2[n] = a * Math.sin(ph - 2 * w) / (rr * rr);
      // noise drive: enough that a partial held by noise rings at about the
      // level a strike gives it
      V.mn[n] = a * Math.sqrt(Math.max(1e-6, 1 - rr * rr)) * 1.6;
      norm += a * a;
      if (T > longest) longest = T;
      n++;
    }
    V.nm = n;
    const g = 1 / Math.sqrt(Math.max(1e-6, norm));
    // With the bloom up the strike gives way to the swell, as it does on the
    // other models.
    const gs = g * (1 - 0.5 * V.bloom);
    for (let j = 0; j < n; j++) { V.m1[j] *= gs; V.m2[j] *= gs; V.mn[j] *= g; }
    V.mEnv = 1; V.mEnvK = dk(sr, longest);
  }
  modal(V, drive) {
    const nz = drive > 1e-5 ? this.rnd() * drive : 0;
    let s = 0;
    for (let j = 0; j < V.nm; j++) {
      const y = V.mc[j] * V.m1[j] - V.mr2[j] * V.m2[j] + V.mn[j] * nz;
      V.m2[j] = V.m1[j]; V.m1[j] = y;
      s += y;
    }
    V.mEnv *= V.mEnvK;
    return s;
  }

  // ---- 4. noise: two bands of noise -----------------------------------------
  // SPREAD is the bandwidth, from two narrow ringing bands (a whistle of
  // metal in the hiss) to two wide ones (plain hiss).
  initNoise(V) {
    const sr = this.sr;
    const q = 6 * Math.pow(0.12, V.spread);
    const b = Math.min(2, V.k);
    bqClear(V.nA); bqClear(V.nB);
    bqSet(V.nA, 2, sr, 5200 * b, q);
    bqSet(V.nB, 2, sr, 9300 * b, q * 0.8);
    // a band's noise power goes as its width: put back what a narrow one loses
    V.nG = Math.sqrt(q / 0.72);
  }
  noise(V) {
    const n = this.rnd();
    return (bqRun(V.nA, n) * 1.1 + bqRun(V.nB, n) * 1.3) * V.nG;
  }

  // The tone, live: a highpass from 150Hz to 2.4kHz and a lowpass from 1.6kHz
  // up past hearing, both rising with the knob, both two-pole.
  setTone(V, tone) {
    const t = clamp01(tone + V.toneOff);
    bqSet(V.hp, 1, this.sr, 150 * Math.pow(16, t), 0.6);
    bqSet(V.lp, 0, this.sr, 1600 * Math.pow(14, t), 0.6);
  }

  // ---- one sample of one voice ---------------------------------------------
  voice(V) {
    // the amplitude, and the swell
    const strikeEnv = V.eF + V.eS;
    V.eF *= V.eFk; V.eS *= V.eSk;
    V.sw += V.swA * (1 - V.sw);
    V.swPk *= V.swK;
    const swell = V.sw * V.swPk;
    let x;
    if (V.model === 2) {
      // the partials carry their own decay; the bloom drives noise into them
      x = this.modal(V, V.bloom * swell * 0.7);
    } else {
      let src;
      switch (V.model) {
        case 0: src = this.metal(V); break;
        case 1: src = this.fm(V); break;
        default: src = this.noise(V); break;
      }
      x = src * ((1 - V.bloom * 0.7) * strikeEnv + V.bloom * swell * 0.85);
    }
    // the tone
    x = bqRun(V.lp, bqRun(V.hp, x));
    // the strike's tick, after the tone so a dark cymbal still has a stick
    if (V.st > 1e-4) { x += bqRun(V.stF, this.rnd()) * V.st * V.stLvl; V.st *= V.stK; }

    V.life++;
    if (V.offAt > 0 && V.life >= V.offAt) { this.fadeVoice(V, 18); V.offAt = -1; }
    if (V.fadeK > 0) { V.fade -= V.fadeK; if (V.fade <= 0) { V.fade = 0; V.on = 0; } }
    return x * V.lvl * V.fade;
  }

  // Is this hit finished? Every envelope under -100dB, after its first 50ms.
  finished(V) {
    if (V.life < this.sr * 0.05) return false;
    if (V.st > 1e-4) return false;
    if (V.model === 2) return V.mEnv < 1e-5 && V.bloom * V.sw * V.swPk < 1e-5;
    return V.eF + V.eS < 1e-5 && V.bloom * V.sw * V.swPk < 1e-5;
  }

  process(inputs, outputs, params) {
    if (!this.alive) return false;
    const out = outputs[0];
    if (!out || !out.length) return true;
    const o0 = out[0], o1 = out[1] || null;
    const n128 = o0.length;
    const P = params;
    const startFrame = currentFrame;
    const sr = this.sr;

    for (let base = 0; base < n128; base += BLK) {
      const blk = Math.min(BLK, n128 - base);
      const at = startFrame + base;
      if (this.allOff !== undefined && at >= this.allOff) { this.fadeAll(30); this.allOff = undefined; }
      if (this.relAt !== undefined && at >= this.relAt) { this.fadeAll(18); this.relAt = undefined; }
      while (this.queue.len && this.queue.headAt() <= at) this.strike(this.queue.shift(), P, base);

      let any = false;
      for (let v = 0; v < NV; v++) if (this.voices[v].on) { any = true; break; }
      if (any) this.idle = 0; else this.idle += blk;
      // Nothing sounding and the width's allpasses emptied: digital silence.
      if (!any && this.idle > sr * 0.05) {
        if (this.idle - blk <= sr * 0.05) for (const a of this.ap) a.buf.fill(0);
        for (let s = 0; s < blk; s++) { o0[base + s] = 0; if (o1) o1[base + s] = 0; }
        continue;
      }
      const tone = this.pv(P, "tone", base);
      for (let v = 0; v < NV; v++) { const V = this.voices[v]; if (V.on) this.setTone(V, tone); }
      const w = clamp01(this.pv(P, "width", base)) * 0.7;
      const norm = 1 / Math.sqrt(1 + w * w);
      for (let s = 0; s < blk; s++) {
        let y = 0;
        if (any) for (let v = 0; v < NV; v++) { const V = this.voices[v]; if (V.on) y += this.voice(V); }
        const d = apRun(this.ap[2], apRun(this.ap[1], apRun(this.ap[0], y, 0.45), 0.45), 0.45);
        const l = (y + w * d) * norm, r = (y - w * d) * norm;
        o0[base + s] = this.ceil(l);
        if (o1) o1[base + s] = this.ceil(r);
      }
      for (let v = 0; v < NV; v++) { const V = this.voices[v]; if (V.on && V.fadeK === 0 && this.finished(V)) V.on = 0; }
    }
    return true;
  }

  // The ceiling: linear to 0.75, then a smooth bend to 1 (siege's knee). A
  // single cymbal never reaches it; six crashes at once can.
  ceil(x) {
    const a = x < 0 ? -x : x;
    if (a <= 0.75) return x;
    const u = (a - 0.75) * 4;
    return (x < 0 ? -1 : 1) * (0.75 + 0.25 * u / (1 + u));
  }
}

registerProcessor("halo", HaloProcessor);
`;

/** The processor source, for test/halo.test.js — evaluated there against the
 *  worklet globals a test stubs, as drone.js's is. */
export function haloProcessorSource() { return HALO_PROCESSOR_SOURCE; }

const _loads = new WeakMap();
const _ready = new WeakSet();

/**
 * Register the halo processor on this context. Called at init() so the await
 * on the play path has already resolved by the time a voice is built.
 * @param {BaseAudioContext} ctx @returns {Promise<void>}
 */
export function loadHaloWorklet(ctx) {
  if (!ctx?.audioWorklet) return Promise.reject(new Error("no AudioWorklet"));
  let p = _loads.get(ctx);
  if (!p) {
    const url = URL.createObjectURL(new Blob([HALO_PROCESSOR_SOURCE], { type: "text/javascript" }));
    p = ctx.audioWorklet.addModule(url)
      .then(() => { URL.revokeObjectURL(url); _ready.add(ctx); })
      .catch((e) => { URL.revokeObjectURL(url); _loads.delete(ctx); throw e; });
    _loads.set(ctx, p);
  }
  return p;
}

/** Has the processor finished registering on this context? */
export function haloReady(ctx) { return !!ctx && _ready.has(ctx); }

// ---- the panel ----------------------------------------------------------
// Keys are `hlo` + short key -> `halo_<short>` / `halo.<short>`. The list, the
// ranges, the defaults, the models and the cymbals are data in engineData.js;
// re-exported here.
import { HALO_MOD_KEYS, HALO_MODELS } from "./engineData.js";
export {
  HALO_NUM_CTLS, HALO_SEL_CTLS, HALO_MOD_KEYS, HALO_NUM_KEYS, HALO_SEL_KEYS,
  HALO_MOD_RANGE, HALO_MOD_LABELS, HALO_DEFAULTS, haloFromUnit,
  HALO_MODELS, HALO_MODEL_TIPS, haloModelTip,
  HALO_TONE_NAMES, haloToneDescription, haloTone,
} from "./engineData.js";

// Tone wrappers don't accept a native connect() — unwrap to the node underneath.
const nativeIn = (node) => node?.input?.input ?? node?.input ?? node;

/**
 * Build the halo voice. Returns null when the worklet isn't registered yet, so
 * the caller can fall back rather than leave the track silent.
 * @param {*} output Tone node the voice writes into.
 */
export function buildHaloVoice(output) {
  const ctx = Tone.getContext().rawContext;
  if (!haloReady(ctx)) { loadHaloWorklet(ctx).catch(() => {}); return null; }

  let node;
  try {
    node = new AudioWorkletNode(ctx, "halo",
      { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
  } catch (e) {
    console.warn("halo worklet node failed", e);
    return null;
  }
  node.connect(nativeIn(output));

  const PARAM_OF = { harm: "tone", timb: "size", morph: "spread", decay: "decay" };
  for (const k of HALO_MOD_KEYS) PARAM_OF[`hlo${k}`] = k;

  const P = {};
  for (const name of Object.values(PARAM_OF)) P[name] = node.parameters.get(name);
  const post = (m) => { try { node.port.postMessage(m); } catch {} };

  let noteId = 0;
  const paramFor = (key) => P[PARAM_OF[key]] ?? null;

  return {
    nodes: [{ dispose() { try { node.port.postMessage({ type: "dispose" }); } catch {} try { node.disconnect(); } catch {} } }],
    setParam: (key, val) => {
      if (key === "hlomodel") { post({ type: "set", model: Math.max(0, HALO_MODELS.indexOf(String(val))) }); return; }
      if (key === "hlochoke") { post({ type: "set", choke: val === "choke" }); return; }
      const p = paramFor(key);
      if (!p) return;
      const v = Number(val);
      if (!Number.isFinite(v)) return;
      p.value = Math.max(p.minValue, Math.min(p.maxValue, v));
    },
    getAudioParam: (key) => paramFor(key),
    trigger: (note, time, dur, vel) => {
      const when = Math.max(Number(time) || 0, ctx.currentTime);
      // The step's length rides along: in choke mode it is how long the hat
      // stays open.
      post({
        type: "note", when, id: ++noteId, note,
        freq: 440 * Math.pow(2, (note - 69) / 12),
        dur: Math.max(0.005, Number(dur) || 0.1),
        vel: Math.max(0.05, Math.min(1, vel ?? 1)),
      });
    },
    // A key let go (the computer keyboard holds a note open): in choke mode
    // the pedal closes, in trig mode nothing, as on the lancet, so a key
    // lifted early never cuts a crash.
    release: (time) => post({ type: "release", when: Math.max(Number(time) || 0, ctx.currentTime) }),
    // The transport's stop: everything fades over 30ms, so a nine-second crash
    // is not still ringing when play comes back (DrumSynthVoice.silence).
    silence: (time) => post({ type: "off", when: Math.max(Number(time) || 0, ctx.currentTime) }),
  };
}
