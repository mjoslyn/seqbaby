// ---- electric guitar ----------------------------------------------------
// An electric guitar is not one instrument, it is a chain of four, and every
// famous tone is a set of decisions taken at each link:
//
//   STRING ──▶ PICKUP ──▶ tone pot ──▶ AMP ──▶ CAB ──▶ air ──┐
//   (six)      (position   (the knob    (gain   (speaker)     │
//              + LC peak)   on the       stack)               │
//                           guitar)        ▲                  │
//                                          └── feedback ──────┘
//
// So the model is that chain, not a pluck through a distortion box:
//
// - **The string is a waveguide.** A delay line the length of one period, with
//   the losses of a real string in the loop: a damping filter (highs die first,
//   which is why a guitar note gets duller as it rings, not just quieter), an
//   allpass pair for stiffness (the harmonics of a wound string sit sharp of
//   where the maths says, and that inharmonicity is most of "wound string"), and
//   a fractional-delay allpass so it is actually in tune. The pluck is a noise
//   burst combed at the pick position — the notch that comb puts in the spectrum
//   is the difference between picking over the neck and picking by the bridge.
// - **The pickup is a comb and a resonance.** It reads the string at one point,
//   which combs the spectrum again, and its own inductance rings: a single coil
//   peaks around 6kHz, a humbucker around 3, and that peak is the single biggest
//   difference between the two.
// - **The amp is gain stages around a tone stack**, and the order matters: the
//   first stage clips asymmetrically (even harmonics, the "warmth"), the stack
//   sits after it so the tone controls shape what was already distorted, and the
//   power amp clips again into a supply that sags under load.
// - **The cab is the biggest filter in the chain.** Nothing below ~90Hz and
//   nothing above ~5kHz survives a guitar speaker, which is the only reason a
//   distorted guitar is listenable at all.
// - **And then the loop closes.** Air couples the speaker back to the string:
//   at volume a note stops decaying and starts blooming, and eventually the
//   string gives up its fundamental and sings a harmonic instead. That is
//   feedback, and it is an instrument in its own right — so it is a control
//   here (the BLOOM slider), driven by the amp's real output level.
//
// Polyphony lives inside the processor: six strings, one amp. That is what a
// guitar rig is, and it also means the modulation targets are the whole
// instrument's rather than voice 0's (the limitation the pooled emulators have).
//
// Simplifications, stated plainly: the six strings are a voice pool rather than
// a real fretboard, so nothing stops two notes landing on the same "string" and
// nothing sympathetically rings; the tone stack is three shelving filters rather
// than the passive RC network's interacting one; the cab is five biquads rather
// than a measured impulse response; and there is no oversampling, so the gain
// stages alias — as a cheap pedal does.

/** @typedef {import("./types.js").Track} Track */

// Processor source. Kept as a string so it travels with the module graph and
// registers from a Blob URL — no extra fetch, no coupling to the versioned
// asset path (same approach as tb303.js, virus.js and dx7.js). No backticks or
// dollar-brace in here: this whole thing is one template literal.
const GUITAR_PROCESSOR_SOURCE = `
const MAXV = 6;        // six strings
const BLK  = 16;       // control-block size: envelopes, coefficients, events
const DLEN = 4096;     // string delay line (down to ~11Hz at 48k)
const DMASK = DLEN - 1;

// ---- biquads (RBJ cookbook) --------------------------------------------
// Transposed direct form II: one multiply-add chain, and the state stays small
// enough that a whole amp is a handful of objects.
function bq() { return { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0, z1: 0, z2: 0 }; }
function bqRun(f, x) {
  const y = f.b0 * x + f.z1;
  f.z1 = f.b1 * x - f.a1 * y + f.z2;
  f.z2 = f.b2 * x - f.a2 * y;
  return y;
}
function bqSet(f, b0, b1, b2, a0, a1, a2) {
  const ia = 1 / a0;
  f.b0 = b0 * ia; f.b1 = b1 * ia; f.b2 = b2 * ia;
  f.a1 = a1 * ia; f.a2 = a2 * ia;
}
function bqLP(f, sr, freq, q) {
  const w = 2 * Math.PI * Math.min(freq, sr * 0.47) / sr;
  const c = Math.cos(w), al = Math.sin(w) / (2 * q);
  bqSet(f, (1 - c) / 2, 1 - c, (1 - c) / 2, 1 + al, -2 * c, 1 - al);
}
function bqHP(f, sr, freq, q) {
  const w = 2 * Math.PI * Math.min(freq, sr * 0.47) / sr;
  const c = Math.cos(w), al = Math.sin(w) / (2 * q);
  bqSet(f, (1 + c) / 2, -(1 + c), (1 + c) / 2, 1 + al, -2 * c, 1 - al);
}
function bqPeak(f, sr, freq, q, db) {
  const A = Math.pow(10, db / 40);
  const w = 2 * Math.PI * Math.min(freq, sr * 0.47) / sr;
  const c = Math.cos(w), al = Math.sin(w) / (2 * q);
  bqSet(f, 1 + al * A, -2 * c, 1 - al * A, 1 + al / A, -2 * c, 1 - al / A);
}
function bqLowShelf(f, sr, freq, db) {
  const A = Math.pow(10, db / 40), sq = Math.sqrt(A);
  const w = 2 * Math.PI * Math.min(freq, sr * 0.47) / sr;
  const c = Math.cos(w), al = Math.sin(w) / 2 * Math.SQRT2;
  bqSet(f,
    A * ((A + 1) - (A - 1) * c + 2 * sq * al),
    2 * A * ((A - 1) - (A + 1) * c),
    A * ((A + 1) - (A - 1) * c - 2 * sq * al),
    (A + 1) + (A - 1) * c + 2 * sq * al,
    -2 * ((A - 1) + (A + 1) * c),
    (A + 1) + (A - 1) * c - 2 * sq * al);
}
function bqHighShelf(f, sr, freq, db) {
  const A = Math.pow(10, db / 40), sq = Math.sqrt(A);
  const w = 2 * Math.PI * Math.min(freq, sr * 0.47) / sr;
  const c = Math.cos(w), al = Math.sin(w) / 2 * Math.SQRT2;
  bqSet(f,
    A * ((A + 1) + (A - 1) * c + 2 * sq * al),
    -2 * A * ((A - 1) + (A + 1) * c),
    A * ((A + 1) + (A - 1) * c - 2 * sq * al),
    (A + 1) - (A - 1) * c + 2 * sq * al,
    2 * ((A - 1) - (A + 1) * c),
    (A + 1) - (A - 1) * c - 2 * sq * al);
}

// ---- the amps -----------------------------------------------------------
// g: how much gain the preamp can be given; bias: how far off centre the first
// stage sits (asymmetry is even harmonics, which is the whole of "warm");
// s2: the second stage's share of it; lo/mid/hi + midQ: where the tone stack
// works; vf/vg/vq: the amp's own voicing, the bump or scoop it has before you
// touch anything; pwr: how hard the power amp is driven; pres: the presence
// shelf's corner.
const AMPS = [
  // clean — a blackface combo. Enormous headroom, scooped mids, glassy top.
  { g: 9,   bias: 0.04, s2: 1.1, lo: 100, mid: 500, hi: 3200, midQ: 0.75,
    vf: 500,  vg: -3.5, vq: 0.8, pwr: 1.0,  pres: 4200 },
  // tweed — small, cathode-biased, breaking up from about a third of the way up.
  { g: 30,  bias: 0.2,  s2: 2.2, lo: 120, mid: 700, hi: 2900, midQ: 0.7,
    vf: 800,  vg: 3,    vq: 0.7, pwr: 1.4,  pres: 3600 },
  // brit — the plexi. That famous 800Hz honk, tight bass, and it wants to be
  // loud: most of the distortion is the power amp, not the preamp.
  { g: 70,  bias: 0.12, s2: 3.2, lo: 130, mid: 800, hi: 3300, midQ: 0.9,
    vf: 820,  vg: 4.5,  vq: 1.1, pwr: 2.2,  pres: 5000 },
  // hi-gain — cascaded preamp, a deep scoop and a hard low cut so the palm
  // mutes stay tight instead of turning to mud.
  { g: 300, bias: 0.05, s2: 6.5, lo: 160, mid: 650, hi: 4200, midQ: 1.1,
    vf: 700,  vg: -6,   vq: 1.0, pwr: 1.0,  pres: 6200 },
  // jazz — clean to the point of sterile, dark, and it never breaks up.
  { g: 4,   bias: 0.02, s2: 1,   lo: 80,  mid: 400, hi: 2000, midQ: 0.6,
    vf: 2500, vg: -4,   vq: 0.7, pwr: 0.9,  pres: 2600 },
];

// ---- the cabs -----------------------------------------------------------
// hp/lp: what the speaker simply cannot reproduce; peak: the presence bump
// every guitar speaker has around 2-4kHz; notch: the dip that stops it honking.
const CABS = [
  { hp: 85,  lp: 4200,  pf: 2400, pg: 5,   nf: 1150, ng: -4 },   // 4x12
  { hp: 95,  lp: 4700,  pf: 2700, pg: 4.5, nf: 1050, ng: -3 },   // 2x12
  { hp: 105, lp: 5100,  pf: 3000, pg: 4,   nf: 950,  ng: -3 },   // 1x12
  { hp: 190, lp: 5800,  pf: 3400, pg: 3.5, nf: 850,  ng: -2 },   // 1x8 (small)
  { hp: 25,  lp: 15000, pf: 3000, pg: 0,   nf: 1000, ng: 0 },    // di — no cab
];

// Pickups: where the resonance sits and how sharp it is. This peak, and not the
// number of coils, is what you hear when you flick the selector.
const PICKUPS = [
  { f: 6200, q: 2.2, g: 7.5, lp: 11000 },   // single coil — bright, peaky
  { f: 3100, q: 1.5, g: 5,   lp: 6500 },    // humbucker — lower, fatter, darker
  { f: 4400, q: 1.8, g: 6,   lp: 8500 },    // p90 — between the two
];

function softClip(x) {
  // Cheap tanh-alike: rational, monotonic, and it flattens rather than folds.
  if (x > 3) return 1; if (x < -3) return -1;
  const x2 = x * x;
  return x * (27 + x2) / (27 + 9 * x2);
}

function makeString() {
  return {
    id: -1, active: false, gate: false, age: 0,
    note: 60, freq: 110, target: 110, glide: 1, vel: 1,
    buf: new Float32Array(DLEN), w: 0,
    len: 200, eta: 0, apX: 0, apZ: 0,     // fractional-delay allpass
    lp: 0,                                 // loop damping
    disp: 0,                               // dispersion allpass coefficient
    d1x: 0, d1y: 0, d2x: 0, d2y: 0,        // dispersion allpasses (stiffness)
    dcX: 0, dcY: 0,                        // dc blocker on the way out
    g: 0.96, damp: 0.5, relG: 1,
    pkTap: 8,
    env: 0, quiet: 0,
  };
}

class GuitarProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    const a = (name, defaultValue, minValue, maxValue) =>
      ({ name, defaultValue, minValue, maxValue, automationRate: "a-rate" });
    const k = (name, defaultValue, minValue, maxValue) =>
      ({ name, defaultValue, minValue, maxValue, automationRate: "k-rate" });
    return [
      // The four track sliders
      a("drive", 0.5, 0, 1), a("tone", 0.5, 0, 1), a("bloom", 0.5, 0, 1), k("sustain", 0.4, 0, 1),
      // String + pickup
      k("pick", 0.28, 0.02, 0.5), k("pnoise", 0.5, 0, 1), k("stiff", 0.25, 0, 1),
      k("pkup", 0.12, 0.02, 0.5), a("mute", 0, 0, 1),
      // Amp
      a("bass", 0.5, 0, 1), a("mid", 0.5, 0, 1), a("treb", 0.5, 0, 1),
      a("pres", 0.4, 0, 1), a("mast", 0.5, 0, 1), a("sag", 0.3, 0, 1),
      // Cab + amp-side effects
      a("mic", 0.35, 0, 1), a("trem", 0, 0, 1), a("tremr", 0.4, 0, 1), a("sprg", 0, 0, 1),
    ];
  }

  constructor() {
    super();
    this.sr = sampleRate;
    this.alive = true;
    this.queue = [];
    this.voices = []; for (let i = 0; i < MAXV; i++) this.voices.push(makeString());
    this.tick = 0;
    this.lastFreq = 110;
    this.glideSec = 0;
    // Discrete settings — messages, not params
    this.ampModel = 2; this.cabModel = 0; this.pkupType = 1; this.tremSquare = 0;
    // k-rate control values the note handlers need, read once per block.
    this.pickPos = 0.28; this.pickHard = 0.5; this.pkupPos = 0.12;
    // Scratch for building a pluck. Allocating one on the audio thread per note
    // is exactly the sort of thing that shows up as a click under load.
    this.scratch = new Float32Array(DLEN);

    // The guitar's own tone pot, before the amp.
    this.toneLP = 0;
    // Pickup: resonance then the cable's roll-off.
    this.pkPeak = bq(); this.pkLP = bq();
    // Amp: two gain stages around the stack, then presence into the power amp.
    this.inHP = bq(); this.stackLo = bq(); this.stackMid = bq(); this.stackHi = bq();
    this.ampVoice = bq(); this.presence = bq();
    this.stage1DC = 0; this.stage1DCx = 0;
    this.sagEnv = 0;
    // Cab
    this.cabHP = bq(); this.cabPeak = bq(); this.cabLP = bq(); this.cabNotch = bq();
    this.outDC = 0; this.outDCx = 0;
    // Tremolo
    this.tremPh = 0;
    // Spring reverb: four allpasses for the dispersion (the "boing"), two combs
    // for the tail, and a band-pass because a spring pan has no top or bottom.
    this.spAP = [];
    for (const n of [149, 211, 331, 461]) this.spAP.push({ b: new Float32Array(n), i: 0, n });
    this.spC = [];
    for (const n of [1237, 1747]) this.spC.push({ b: new Float32Array(n), i: 0, n });
    this.spHP = bq(); this.spLP = bq(); this.spOut = 0;
    // The air path from the speaker back to the strings — about 6ms of it.
    this.fbBuf = new Float32Array(2048); this.fbW = 0;
    this.fbBP = bq(); this.fbSig = 0;

    this.coefKey = -1;
    this.port.onmessage = (e) => this.onMessage(e.data);
  }

  onMessage(m) {
    if (!m) return;
    if (m.type === "note") {
      if (this.queue.length > 128) this.queue.shift();
      const at = Math.max(0, Math.round(m.when * this.sr));
      this.queue.push({ at, off: false, id: m.id, note: m.note, freq: m.freq, vel: m.vel, glide: m.glide });
      this.queue.push({ at: at + Math.max(1, Math.round(m.dur * this.sr)), off: true, id: m.id });
      this.queue.sort((x, y) => x.at - y.at);
    } else if (m.type === "off") {
      const at = Math.max(0, Math.round(m.when * this.sr));
      this.queue = this.queue.filter(ev => ev.off && ev.at < at);
      this.allOff = at;
    } else if (m.type === "set") {
      if (m.amp !== undefined) this.ampModel = Math.max(0, Math.min(AMPS.length - 1, m.amp | 0));
      if (m.cab !== undefined) this.cabModel = Math.max(0, Math.min(CABS.length - 1, m.cab | 0));
      if (m.pkupType !== undefined) this.pkupType = Math.max(0, Math.min(PICKUPS.length - 1, m.pkupType | 0));
      if (m.tremSquare !== undefined) this.tremSquare = m.tremSquare ? 1 : 0;
      if (m.glide !== undefined) this.glideSec = Math.max(0, m.glide);
      this.coefKey = -1;       // force a coefficient rebuild on the next block
    } else if (m.type === "dispose") {
      this.alive = false;
    }
  }

  // Pluck: fill the string's delay line with a noise burst, combed at the pick
  // position. A string already ringing keeps some of what it had — that is what
  // re-picking a held note sounds like, and it is free here.
  pluck(v, hard, vel) {
    const L = v.len;
    // Pick hardness is the burst's own brightness: a plectrum excites the top of
    // the string's range, a thumb barely touches it.
    const a = 0.06 + hard * hard * 0.9;
    let z = 0;
    const off = Math.max(1, Math.min(L - 1, Math.round(this.pickPos * L)));
    const tmp = this.scratch;
    for (let i = 0; i < L; i++) {
      z += a * ((Math.random() * 2 - 1) - z);
      tmp[i] = z;
    }
    const keep = v.env > 1e-4 ? 0.45 : 0;
    const amp = 0.85 * (0.25 + vel * 0.75);
    for (let i = 0; i < L; i++) {
      // The comb at the pick position: the string cannot carry a harmonic with a
      // node where it was plucked, so those harmonics are missing. Pick by the
      // bridge and the notch moves up out of the way, which is the whole reason
      // bridge picking sounds thin and cutting.
      const c = tmp[i] - tmp[(i - off + L) % L] * 0.9;
      const idx = (v.w - L + i + DLEN * 2) & DMASK;
      v.buf[idx] = v.buf[idx] * keep + c * amp;
    }
    v.env = amp;
    v.quiet = 0;
  }

  noteOn(ev, sustain, stiff) {
    let v = null;
    for (const c of this.voices) if (!c.active) { v = c; break; }
    if (!v) {
      // Steal the quietest — a string that has almost stopped ringing is the one
      // nobody would miss, and on a guitar it is also the one a hand would mute.
      let worst = Infinity;
      for (const c of this.voices) { const s = c.gate ? c.env + 10 : c.env; if (s < worst) { worst = s; v = c; } }
      v.buf.fill(0); v.lp = 0; v.apX = 0; v.apZ = 0;
    }
    if (!v.active) { v.buf.fill(0); v.lp = 0; v.apX = 0; v.apZ = 0; v.d1x = v.d1y = v.d2x = v.d2y = 0; }
    v.id = ev.id; v.note = ev.note; v.vel = ev.vel;
    v.active = true; v.gate = true; v.age = ++this.tick;
    v.target = ev.freq;
    const gl = ev.glide > 0 ? ev.glide : this.glideSec;
    if (gl > 0) { v.freq = this.lastFreq; v.glide = 1 - Math.exp(-3 / (gl * this.sr / BLK)); }
    else { v.freq = ev.freq; v.glide = 1; }
    this.lastFreq = ev.freq;
    v.relG = 1;
    this.retune(v, stiff);
    this.pluck(v, this.pickHard, ev.vel);
  }

  // Letting go of a fretted note damps the string — it does not silence it, and
  // it does not sustain either. That in-between is most of what makes a guitar
  // part sound played rather than sequenced, so note-off sets a release damping
  // scaled by the sustain macro instead of cutting the voice.
  noteOff(id, sustain) {
    for (const v of this.voices) {
      if (!v.active || v.id !== id || !v.gate) continue;
      v.gate = false;
      const T = 0.05 + sustain * 0.55;
      v.relG = Math.exp(-6.9 / Math.max(1, v.freq * T)) / Math.max(1e-6, v.g);
      if (v.relG > 1) v.relG = 1;
    }
  }

  // Delay length for the note, minus the phase delay everything else in the loop
  // adds — without that subtraction the string plays flat, and further flat the
  // darker it is set.
  retune(v, stiff) {
    const c = -stiff * 0.42;                       // dispersion allpass coefficient
    const apD = (1 - c) / (1 + c);                 // its phase delay, per stage
    const a = Math.max(0.06, v.damp);
    const lpD = (1 - a) / a;                       // the damping filter's
    let D = this.sr / Math.max(20, v.freq) - lpD - 2 * apD;
    if (D < 8) D = 8;
    if (D > DLEN - 4) D = DLEN - 4;
    const len = Math.floor(D - 0.1);
    const frac = D - len;
    v.len = len;
    v.eta = (1 - frac) / (1 + frac);
    v.disp = c;
    // Where along the string the pickup sits, as a tap into the same line.
    v.pkTap = Math.max(1, Math.min(len - 1, Math.round(this.pkupPos * 2 * len)));
  }

  process(inputs, outputs, params) {
    if (!this.alive) return false;
    const out = outputs[0];
    if (!out || !out[0]) return true;
    const o = out[0];
    const N = o.length;
    const sr = this.sr, n0 = currentFrame;
    const P = params;
    const kv = (p) => p[0];
    const sustain = kv(P.sustain);
    const stiff = kv(P.stiff);
    this.pickPos  = kv(P.pick);
    this.pickHard = kv(P.pnoise);
    this.pkupPos  = kv(P.pkup);

    const A = AMPS[this.ampModel], C = CABS[this.cabModel], PK = PICKUPS[this.pkupType];

    for (let base = 0; base < N; base += BLK) {
      const blk = Math.min(BLK, N - base);
      const frame = n0 + base;

      while (this.queue.length && this.queue[0].at <= frame) {
        const ev = this.queue.shift();
        if (ev.off) this.noteOff(ev.id, sustain); else this.noteOn(ev, sustain, stiff);
      }
      if (this.allOff !== undefined && frame >= this.allOff) {
        for (const v of this.voices) if (v.gate) this.noteOff(v.id, sustain);
        this.allOff = undefined;
      }

      const i = base;
      const drive = P.drive.length > 1 ? P.drive[i] : P.drive[0];
      const tone  = P.tone.length  > 1 ? P.tone[i]  : P.tone[0];
      const bloom = P.bloom.length > 1 ? P.bloom[i] : P.bloom[0];
      const mute  = P.mute.length  > 1 ? P.mute[i]  : P.mute[0];
      const bass  = P.bass.length  > 1 ? P.bass[i]  : P.bass[0];
      const mid   = P.mid.length   > 1 ? P.mid[i]   : P.mid[0];
      const treb  = P.treb.length  > 1 ? P.treb[i]  : P.treb[0];
      const pres  = P.pres.length  > 1 ? P.pres[i]  : P.pres[0];
      const mast  = P.mast.length  > 1 ? P.mast[i]  : P.mast[0];
      const sag   = P.sag.length   > 1 ? P.sag[i]   : P.sag[0];
      const mic   = P.mic.length   > 1 ? P.mic[i]   : P.mic[0];
      const trem  = P.trem.length  > 1 ? P.trem[i]  : P.trem[0];
      const tremr = P.tremr.length > 1 ? P.tremr[i] : P.tremr[0];
      const sprg  = P.sprg.length  > 1 ? P.sprg[i]  : P.sprg[0];

      // Coefficients only move when a control does — a guitar rig is a dozen
      // biquads, and rebuilding them three thousand times a second for nothing
      // is waste. The key packs the rig's discrete choices and every control
      // that feeds a coefficient into one number (each to 1%, which is finer
      // than the sliders' own step).
      let key = (this.ampModel * 5 + this.cabModel) * 3 + this.pkupType;
      for (const q of [tone, bass, mid, treb, pres, mic]) key = key * 100 + (q * 99 | 0);
      if (key !== this.coefKey) {
        this.coefKey = key;
        bqPeak(this.pkPeak, sr, PK.f, PK.q, PK.g);
        bqLP(this.pkLP, sr, PK.lp, 0.7);
        bqHP(this.inHP, sr, 60 + A.lo * 0.4, 0.7);
        bqLowShelf(this.stackLo, sr, A.lo, (bass - 0.5) * 24);
        bqPeak(this.stackMid, sr, A.mid, A.midQ, (mid - 0.5) * 20);
        bqHighShelf(this.stackHi, sr, A.hi, (treb - 0.5) * 22);
        bqPeak(this.ampVoice, sr, A.vf, A.vq, A.vg);
        bqHighShelf(this.presence, sr, A.pres, pres * 14 - 2);
        // Mic position: on-axis is a bright, peaky cone; move off it and the top
        // goes first. One control standing in for the whole dance in front of a
        // speaker, because that dance is mostly a lowpass.
        bqHP(this.cabHP, sr, C.hp, 0.72);
        bqPeak(this.cabPeak, sr, C.pf, 1.3, C.pg * (0.4 + mic));
        bqLP(this.cabLP, sr, C.lp * (0.62 + mic * 0.8), 0.9);
        bqPeak(this.cabNotch, sr, C.nf, 1.1, C.ng);
        bqHP(this.spHP, sr, 320, 0.7);
        bqLP(this.spLP, sr, 3600, 0.7);
        bqLP(this.fbBP, sr, 2600, 0.6);
      }

      // The guitar's tone pot: a plain one-pole between the pickup and the amp.
      // Rolled right down it is the darkest sound the instrument has; wide open
      // it is barely there at all.
      const toneFc = 700 * Math.pow(2, tone * 4.8);
      const toneA = 1 - Math.exp(-2 * Math.PI * Math.min(toneFc, sr * 0.45) / sr);

      // String losses. The loop gain sets how long the note rings; the damping
      // filter decides that the highs go first, which is why a decaying guitar
      // note gets duller and not just quieter.
      const g = (0.93 + sustain * 0.065) * (1 - mute * 0.22);
      const damp = Math.max(0.06, 0.58 - mute * 0.44);
      for (const v of this.voices) {
        if (!v.active) continue;
        if (Math.abs(v.g - g) > 1e-4 || Math.abs(v.damp - damp) > 1e-3) { v.g = g; v.damp = damp; this.retune(v, stiff); }
        if (v.glide < 1) {
          v.freq += (v.target - v.freq) * v.glide;
          if (Math.abs(v.target - v.freq) < 0.05) { v.freq = v.target; v.glide = 1; }
          this.retune(v, stiff);
        }
      }

      // Gain structure. Exponential in the slider, because that is what a gain
      // pot is: half way up a hundred-times amp is not fifty times, it is ten,
      // and every useful setting would otherwise live in the bottom tenth.
      const dr = drive * drive;
      const inG = 2.2 * Math.pow(A.g, dr);
      const s2G = Math.pow(A.s2, dr);
      const pwrG = (0.6 + mast * mast * 2.4) * A.pwr;
      // Distortion compresses, so a cranked amp is louder as well as dirtier —
      // by a lot, since a clipped signal is close to a square wave whatever went
      // in. Trim it back on the way out so drive changes the tone and not the
      // level, and a clean setting is still audible next to a saturated one.
      const outTrim = 0.42 / (0.13 + drive * 1.5);
      // Bloom is cubed. Every engine's morph slider defaults to 0.5, and a rig
      // that howls the moment you load it would be a joke; at 0.5 this is the
      // faint lift a loud amp gives a held note, and the top of the slider is
      // where you stand in front of the speaker.
      const fbAmt = bloom * bloom * bloom * 0.6;
      const tremHz = 1.5 + tremr * tremr * 12;
      const tremInc = tremHz / sr;
      const sagC = 1 - Math.exp(-1 / (0.012 * sr));

      for (let n = 0; n < blk; n++) {
        // ---- the six strings ----
        let mono = 0;
        for (let vi = 0; vi < MAXV; vi++) {
          const v = this.voices[vi];
          if (!v.active) continue;
          const buf = v.buf, w = v.w, len = v.len;
          const xi = buf[(w - len + DLEN) & DMASK];
          // Fractional delay, so the string is in tune between samples too.
          let y = v.eta * (xi - v.apZ) + v.apX;
          v.apX = xi; v.apZ = y;
          // Stiffness: two allpasses stretch the upper partials sharp, which is
          // what a wound string does and a mathematical string does not.
          const c = v.disp;
          const y1 = c * y + v.d1x - c * v.d1y; v.d1x = y; v.d1y = y1;
          const y2 = c * y1 + v.d2x - c * v.d2y; v.d2x = y1; v.d2y = y2;
          // Damping + loss.
          v.lp += v.damp * (y2 - v.lp);
          let fed = v.lp * v.g * v.relG;
          // The air path back from the speaker. Scaled by how hard this string
          // is already moving, which is both true (the speaker drives loudest
          // what is already resonating) and what makes BLOOM a threshold rather
          // than a switch: below it the injection is smaller than the string's
          // own losses and the note decays; above it the two swap over and the
          // note grows into a howl instead of dying. A cranked amp crosses that
          // line far earlier than a clean one, exactly as a real rig does.
          // Only into a note that is still being held: taking the hand off the
          // string is how a player stops feedback, and without that a bloomed
          // note would ring for the rest of the session.
          if (fbAmt > 0.0005 && v.gate) fed += this.fbSig * fbAmt * (v.env < 0.5 ? v.env * 2 : 1);
          if (fed > 4) fed = 4; else if (fed < -4) fed = -4;
          buf[w] = fed;
          v.w = (w + 1) & DMASK;
          // The pickup reads one point of the string, which combs it again.
          const tap = buf[(w - len + v.pkTap + DLEN) & DMASK];
          let s = y - tap * 0.78;
          // DC blocker: the comb and the pluck both leave an offset behind.
          const dy = s - v.dcX + 0.9995 * v.dcY;
          v.dcX = s; v.dcY = dy;
          s = dy;
          const as = s < 0 ? -s : s;
          v.env += 0.0008 * (as - v.env);
          if (!v.gate || v.relG < 1) {
            if (v.env < 2e-5) { if (++v.quiet > 3000) { v.active = false; v.buf.fill(0); v.env = 0; } }
            else v.quiet = 0;
          }
          mono += s;
        }

        // ---- pickup resonance, then the tone pot ----
        let x = bqRun(this.pkLP, bqRun(this.pkPeak, mono)) * 0.55;
        this.toneLP += toneA * (x - this.toneLP);
        x = this.toneLP;

        // ---- preamp ----
        x = bqRun(this.inHP, x * inG);
        // Stage one, biased off centre: the asymmetry is the even harmonics
        // everyone means by "tube warmth". Its own DC offset is removed after.
        let s1 = softClip(x + A.bias) - softClip(A.bias);
        const s1dc = s1 - this.stage1DCx + 0.9995 * this.stage1DC;
        this.stage1DCx = s1; this.stage1DC = s1dc;
        s1 = s1dc;
        // The stack sits after the first stage, as it does in the chassis — so
        // the tone controls shape what is already distorted, not what is not.
        s1 = bqRun(this.stackHi, bqRun(this.stackMid, bqRun(this.stackLo, s1)));
        s1 = bqRun(this.ampVoice, s1);
        if (s2G > 1.02) s1 = softClip(s1 * s2G) * 0.85;

        // ---- power amp: presence in the feedback loop, then sag ----
        let p = bqRun(this.presence, s1) * pwrG;
        const ap = p < 0 ? -p : p;
        this.sagEnv += sagC * (ap - this.sagEnv);
        // A power supply that droops under load: the note ducks as it is struck
        // and swells back as it decays, which is the "give" of a small amp.
        p = softClip(p * (1 - sag * Math.min(0.85, this.sagEnv * 1.4)));

        // ---- tremolo (amp side, after the power tubes) ----
        if (trem > 0.001) {
          this.tremPh += tremInc; if (this.tremPh >= 1) this.tremPh -= 1;
          const lfo = this.tremSquare
            ? (this.tremPh < 0.5 ? 1 : 0)
            : 0.5 - 0.5 * Math.cos(2 * Math.PI * this.tremPh);
          p *= 1 - trem * 0.92 * (1 - lfo);
        }

        // ---- cab ----
        let y = bqRun(this.cabNotch, bqRun(this.cabLP, bqRun(this.cabPeak, bqRun(this.cabHP, p))));

        // ---- spring reverb, on the amp side of everything ----
        if (sprg > 0.001 || (this.spOut > 1e-6 || this.spOut < -1e-6)) {
          let sp = bqRun(this.spLP, bqRun(this.spHP, y));
          for (let k = 0; k < 4; k++) {
            const ap2 = this.spAP[k];
            const bufd = ap2.b[ap2.i];
            const inp = sp + bufd * 0.62;
            ap2.b[ap2.i] = inp;
            ap2.i = (ap2.i + 1) % ap2.n;
            sp = bufd - inp * 0.62;
          }
          let tail = 0;
          for (let k = 0; k < 2; k++) {
            const cm = this.spC[k];
            const bufd = cm.b[cm.i];
            cm.b[cm.i] = sp + bufd * 0.72;
            cm.i = (cm.i + 1) % cm.n;
            tail += bufd;
          }
          this.spOut = tail * 0.5;
          y += this.spOut * sprg * 1.2;
        }

        // ---- the loop back to the strings ----
        if (fbAmt > 0.0005) {
          this.fbBuf[this.fbW] = y;
          this.fbW = (this.fbW + 1) & 2047;
          // ~6ms of air between the speaker and the strings, band-limited to
          // where a guitar body couples, and clamped so it can bloom but never
          // run away: the string's own loop is lossy, so a bounded injection is
          // bounded output.
          const dly = this.fbBuf[(this.fbW - 280 + 2048) & 2047];
          this.fbSig = softClip(bqRun(this.fbBP, dly) * 1.6) * 0.09;
        } else {
          this.fbSig = 0;
        }

        // Output trim + a final safety limit. Six strings into a cranked amp is
        // a lot of signal, and drive should change the tone, not the level.
        let z = y * outTrim;
        const dz = z - this.outDCx + 0.9995 * this.outDC;
        this.outDCx = z; this.outDC = dz;
        o[base + n] = softClip(dz);
      }
    }
    return true;
  }
}

registerProcessor("electric-guitar", GuitarProcessor);
`;

// One registration per AudioContext, single-flight; a failure clears the slot
// so the next attempt retries (same contract as the other worklet models).
const _loads = new WeakMap();
const _ready = new WeakSet();

/**
 * Register the electric-guitar processor on this context. Called at init() so
 * the await on the play path has already resolved by the time a voice is built.
 * @param {BaseAudioContext} ctx @returns {Promise<void>}
 */
export function loadGuitarWorklet(ctx) {
  if (!ctx?.audioWorklet) return Promise.reject(new Error("no AudioWorklet"));
  let p = _loads.get(ctx);
  if (!p) {
    const url = URL.createObjectURL(new Blob([GUITAR_PROCESSOR_SOURCE], { type: "text/javascript" }));
    p = ctx.audioWorklet.addModule(url)
      .then(() => { URL.revokeObjectURL(url); _ready.add(ctx); })
      .catch((e) => { URL.revokeObjectURL(url); _loads.delete(ctx); throw e; });
    _loads.set(ctx, p);
  }
  return p;
}

/** Has the processor finished registering on this context? */
export function guitarReady(ctx) { return !!ctx && _ready.has(ctx); }

// ---- the panel ----------------------------------------------------------
// One list, three namespaces — the same trick the dx7 panel uses. Every control
// is `gt` + a short key, and that short key spells its LFO target (`gtr_<short>`)
// and its automation lane (`gtr.<short>`), so `gtbass` / `gtr_bass` / `gtr.bass`
// are one control. constants.js, automation.js and paramTargets.js map over
// GUITAR_MOD_KEYS rather than listing them.

/** Numeric panel controls: [short key, min, max, default, label]. */
export const GUITAR_NUM_CTLS = [
  ["pick",   0.02, 0.5, 0.28, "pick pos"],
  ["pnoise", 0,    1,   0.5,  "pick"],
  ["stiff",  0,    1,   0.25, "stiff"],
  ["pkup",   0.02, 0.5, 0.12, "pkup pos"],
  ["mute",   0,    1,   0,    "palm"],
  ["bass",   0,    1,   0.5,  "bass"],
  ["mid",    0,    1,   0.5,  "mid"],
  ["treb",   0,    1,   0.5,  "treble"],
  ["pres",   0,    1,   0.4,  "presence"],
  ["mast",   0,    1,   0.5,  "master"],
  ["sag",    0,    1,   0.3,  "sag"],
  ["mic",    0,    1,   0.35, "mic"],
  ["trem",   0,    1,   0,    "trem"],
  ["tremr",  0,    1,   0.4,  "trem rate"],
  ["sprg",   0,    1,   0,    "spring"],
];

/** Select controls: [short key, default, [values]]. */
export const GUITAR_SEL_CTLS = [
  ["amp",   "brit",   ["clean", "tweed", "brit", "hi", "jazz"]],
  ["cab",   "4x12",   ["4x12", "2x12", "1x12", "1x8", "di"]],
  ["pkupt", "hum",    ["single", "hum", "p90"]],
  ["tremw", "sine",   ["sine", "square"]],
];

export const GUITAR_MOD_KEYS = GUITAR_NUM_CTLS.map(c => c[0]);
export const GUITAR_NUM_KEYS = GUITAR_MOD_KEYS.map(k => `gt${k}`);
export const GUITAR_SEL_KEYS = GUITAR_SEL_CTLS.map(c => `gt${c[0]}`);

/** Each control's own span, so a lane or an LFO covers the slider, not 0..1. */
export const GUITAR_MOD_RANGE = Object.fromEntries(GUITAR_NUM_CTLS.map(c => [c[0], [c[1], c[2]]]));

export const GUITAR_MOD_LABELS = Object.fromEntries(
  GUITAR_NUM_CTLS.map(([k, , , , label]) => [k, `guitar ${label}`]));

export const GUITAR_DEFAULTS = {
  ...Object.fromEntries(GUITAR_NUM_CTLS.map(c => [`gt${c[0]}`, c[3]])),
  ...Object.fromEntries(GUITAR_SEL_CTLS.map(c => [`gt${c[0]}`, c[1]])),
};

/** A 0..1 lane value in this control's own units. @param {string} k short key */
export function guitarFromUnit(k, u) {
  const [lo, hi] = GUITAR_MOD_RANGE[k] ?? [0, 1];
  return lo + Math.max(0, Math.min(1, u)) * (hi - lo);
}

// ---- famous tones -------------------------------------------------------
// A guitar sound is a rig, not a patch: the pickup, where you pick, the amp,
// how hard it is driven, the cab, and what is bouncing back off the speaker.
// Each of these is a complete set of all of that plus the four track sliders,
// so loading one leaves nothing of the last behind.
//
// They are named for what they sound like rather than for who played them —
// but the line under each says what it is reaching for, because that is the
// only useful thing to know at picking time.
const TONES = {
  "surf twang": {
    d: "bridge single coil, a clean blackface combo, deep amp tremolo and a tank full of spring — the reverb IS the sound",
    drive: 0.18, tone: 0.86, bloom: 0.1, sustain: 0.42,
    p: { pick: 0.1, pnoise: 0.85, stiff: 0.3, pkup: 0.06, mute: 0.1,
         bass: 0.5, mid: 0.35, treb: 0.78, pres: 0.55, mast: 0.4, sag: 0.25,
         mic: 0.6, trem: 0.7, tremr: 0.55, sprg: 0.85,
         amp: "clean", cab: "2x12", pkupt: "single", tremw: "sine" },
  },
  "funk clean": {
    d: "bridge single coil into a clean amp with the mids pulled out, picked hard and short — the sixteenth-note chank of every disco record",
    drive: 0.22, tone: 0.8, bloom: 0.05, sustain: 0.18,
    p: { pick: 0.08, pnoise: 0.9, stiff: 0.35, pkup: 0.05, mute: 0.3,
         bass: 0.35, mid: 0.3, treb: 0.75, pres: 0.6, mast: 0.45, sag: 0.2,
         mic: 0.65, trem: 0, tremr: 0.4, sprg: 0.1,
         amp: "clean", cab: "1x12", pkupt: "single", tremw: "sine" },
  },
  "jangle": {
    d: "neck and bridge together, barely breaking up, picked over the neck — chiming sixties pop and everything that borrowed from it",
    drive: 0.34, tone: 0.72, bloom: 0.12, sustain: 0.55,
    p: { pick: 0.32, pnoise: 0.55, stiff: 0.2, pkup: 0.2, mute: 0,
         bass: 0.45, mid: 0.55, treb: 0.68, pres: 0.5, mast: 0.5, sag: 0.35,
         mic: 0.5, trem: 0, tremr: 0.4, sprg: 0.25,
         amp: "tweed", cab: "2x12", pkupt: "single", tremw: "sine" },
  },
  "chime": {
    d: "a brit combo sitting right on the edge of breaking up, bright and glassy. Add the rack's delay for the eighties arena version",
    drive: 0.42, tone: 0.82, bloom: 0.18, sustain: 0.68,
    p: { pick: 0.22, pnoise: 0.6, stiff: 0.22, pkup: 0.14, mute: 0,
         bass: 0.42, mid: 0.5, treb: 0.72, pres: 0.65, mast: 0.55, sag: 0.4,
         mic: 0.55, trem: 0, tremr: 0.4, sprg: 0.2,
         amp: "brit", cab: "2x12", pkupt: "single", tremw: "sine" },
  },
  "country twang": {
    d: "bridge pickup, picked by the bridge, clean and compressed with a fast decay — the sound of a telecaster and a plectrum held too tight",
    drive: 0.26, tone: 0.9, bloom: 0.05, sustain: 0.3,
    p: { pick: 0.05, pnoise: 1, stiff: 0.4, pkup: 0.04, mute: 0.25,
         bass: 0.4, mid: 0.45, treb: 0.82, pres: 0.7, mast: 0.5, sag: 0.45,
         mic: 0.7, trem: 0, tremr: 0.4, sprg: 0.35,
         amp: "tweed", cab: "1x12", pkupt: "single", tremw: "sine" },
  },
  "blues burn": {
    d: "a small tweed amp with everything on ten: it sags, it compresses, and it blooms if you hold a note long enough",
    drive: 0.72, tone: 0.6, bloom: 0.5, sustain: 0.72,
    p: { pick: 0.24, pnoise: 0.55, stiff: 0.28, pkup: 0.24, mute: 0,
         bass: 0.55, mid: 0.68, treb: 0.55, pres: 0.45, mast: 0.85, sag: 0.8,
         mic: 0.45, trem: 0, tremr: 0.4, sprg: 0.3,
         amp: "tweed", cab: "2x12", pkupt: "single", tremw: "sine" },
  },
  "brit stack": {
    d: "bridge humbucker into a cranked plexi and a 4x12 — the riff sound of the seventies, and mostly power amp rather than preamp",
    drive: 0.68, tone: 0.68, bloom: 0.42, sustain: 0.66,
    p: { pick: 0.16, pnoise: 0.7, stiff: 0.3, pkup: 0.09, mute: 0.12,
         bass: 0.5, mid: 0.7, treb: 0.6, pres: 0.6, mast: 0.9, sag: 0.55,
         mic: 0.5, trem: 0, tremr: 0.4, sprg: 0.1,
         amp: "brit", cab: "4x12", pkupt: "hum", tremw: "sine" },
  },
  "rolled off": {
    d: "neck humbucker with the guitar's tone knob rolled all the way down, into a cranked amp — dark, vocal, no pick attack at all",
    drive: 0.74, tone: 0.12, bloom: 0.55, sustain: 0.8,
    p: { pick: 0.42, pnoise: 0.25, stiff: 0.18, pkup: 0.36, mute: 0,
         bass: 0.6, mid: 0.72, treb: 0.5, pres: 0.35, mast: 0.85, sag: 0.6,
         mic: 0.35, trem: 0, tremr: 0.4, sprg: 0.15,
         amp: "brit", cab: "4x12", pkupt: "hum", tremw: "sine" },
  },
  "fuzz lead": {
    d: "everything past the point of politeness: hard clipping, a woolly top end and enough bloom that held notes climb into feedback",
    drive: 0.95, tone: 0.5, bloom: 0.78, sustain: 0.85,
    p: { pick: 0.3, pnoise: 0.5, stiff: 0.35, pkup: 0.3, mute: 0,
         bass: 0.62, mid: 0.62, treb: 0.55, pres: 0.5, mast: 0.8, sag: 0.7,
         mic: 0.4, trem: 0, tremr: 0.4, sprg: 0.2,
         amp: "brit", cab: "4x12", pkupt: "single", tremw: "sine" },
  },
  "singing lead": {
    d: "the sustain patch: moderate gain, huge string decay and the speaker feeding the string back hard enough that notes never stop",
    drive: 0.7, tone: 0.62, bloom: 0.88, sustain: 0.95,
    p: { pick: 0.36, pnoise: 0.35, stiff: 0.15, pkup: 0.34, mute: 0,
         bass: 0.5, mid: 0.75, treb: 0.58, pres: 0.55, mast: 0.75, sag: 0.5,
         mic: 0.4, trem: 0, tremr: 0.4, sprg: 0.25,
         amp: "brit", cab: "4x12", pkupt: "hum", tremw: "sine" },
  },
  "scooped metal": {
    d: "hi-gain with the mids taken out and the low end cut tight, palm muted — the eighties bay-area rhythm sound",
    drive: 0.88, tone: 0.72, bloom: 0.2, sustain: 0.5,
    p: { pick: 0.06, pnoise: 0.9, stiff: 0.4, pkup: 0.05, mute: 0.55,
         bass: 0.7, mid: 0.12, treb: 0.78, pres: 0.75, mast: 0.6, sag: 0.15,
         mic: 0.6, trem: 0, tremr: 0.4, sprg: 0,
         amp: "hi", cab: "4x12", pkupt: "hum", tremw: "sine" },
  },
  "djent chug": {
    d: "the same gain but nothing loose about it: hard palm mute, mids back in, and a low cut that leaves only the attack",
    drive: 0.82, tone: 0.78, bloom: 0.15, sustain: 0.35,
    p: { pick: 0.04, pnoise: 1, stiff: 0.5, pkup: 0.04, mute: 0.78,
         bass: 0.55, mid: 0.45, treb: 0.8, pres: 0.8, mast: 0.5, sag: 0.1,
         mic: 0.7, trem: 0, tremr: 0.4, sprg: 0,
         amp: "hi", cab: "4x12", pkupt: "hum", tremw: "sine" },
  },
  "grunge": {
    d: "a brit amp pushed into mush with the mids up and the strings picked hard — loose, honking, and not remotely tidy",
    drive: 0.8, tone: 0.55, bloom: 0.3, sustain: 0.45,
    p: { pick: 0.14, pnoise: 0.95, stiff: 0.45, pkup: 0.16, mute: 0.2,
         bass: 0.65, mid: 0.72, treb: 0.62, pres: 0.5, mast: 0.7, sag: 0.6,
         mic: 0.35, trem: 0, tremr: 0.4, sprg: 0.15,
         amp: "brit", cab: "4x12", pkupt: "hum", tremw: "sine" },
  },
  "jazz box": {
    d: "neck humbucker, thumb rather than pick, tone rolled back and an amp that never breaks up — round, dark, no top end at all",
    drive: 0.12, tone: 0.24, bloom: 0.05, sustain: 0.5,
    p: { pick: 0.46, pnoise: 0.12, stiff: 0.12, pkup: 0.4, mute: 0,
         bass: 0.6, mid: 0.6, treb: 0.35, pres: 0.15, mast: 0.4, sag: 0.2,
         mic: 0.25, trem: 0, tremr: 0.4, sprg: 0.1,
         amp: "jazz", cab: "1x12", pkupt: "hum", tremw: "sine" },
  },
};

export const GUITAR_TONE_NAMES = Object.keys(TONES);

/** One line saying what a tone is reaching for. @param {string} name */
export function guitarToneDescription(name) { return TONES[name]?.d ?? ""; }

/**
 * A famous tone as a complete set of track params — every panel control plus
 * the four track sliders, because on a guitar the drive and the sustain are as
 * much a part of the sound as the amp is.
 * @param {string} name
 * @returns {Record<string, number|string>|null}
 */
export function guitarTone(name) {
  const v = TONES[name];
  if (!v) return null;
  const out = { ...GUITAR_DEFAULTS };
  for (const [k, val] of Object.entries(v.p)) out[`gt${k}`] = val;
  out.harm = v.drive; out.timb = v.tone; out.morph = v.bloom; out.decay = v.sustain;
  return out;
}

const AMP_IDX  = { clean: 0, tweed: 1, brit: 2, hi: 3, jazz: 4 };
const CAB_IDX  = { "4x12": 0, "2x12": 1, "1x12": 2, "1x8": 3, di: 4 };
const PKUP_IDX = { single: 0, hum: 1, p90: 2 };

// Tone wrappers don't accept a native connect() — unwrap to the node underneath.
const nativeIn = (node) => node?.input?.input ?? node?.input ?? node;

/**
 * Build the guitar voice. Returns null when the worklet isn't registered yet,
 * so the caller can fall back rather than leave the track silent.
 * @param {*} output Tone node the voice writes into.
 */
export function buildGuitarVoice(output) {
  const ctx = Tone.getContext().rawContext;
  if (!guitarReady(ctx)) { loadGuitarWorklet(ctx).catch(() => {}); return null; }

  let node;
  try {
    node = new AudioWorkletNode(ctx, "electric-guitar",
      { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1] });
  } catch (e) {
    console.warn("electric-guitar worklet node failed", e);
    return null;
  }
  node.connect(nativeIn(output));

  // Track param key → worklet parameter name. The four sliders are named for
  // what they do here; every panel control is its own short key.
  const PARAM_OF = { harm: "drive", timb: "tone", morph: "bloom", decay: "sustain" };
  for (const k of GUITAR_MOD_KEYS) PARAM_OF[`gt${k}`] = k;

  const P = {};
  for (const name of Object.values(PARAM_OF)) P[name] = node.parameters.get(name);
  const post = (m) => { try { node.port.postMessage(m); } catch {} };

  let noteId = 0;
  let glide = 0;

  const paramFor = (key) => P[PARAM_OF[key]] ?? null;

  return {
    nodes: [{ dispose() { try { node.port.postMessage({ type: "dispose" }); } catch {} try { node.disconnect(); } catch {} } }],
    setGlide: (g) => { glide = Math.max(0, Number(g) || 0); post({ type: "set", glide }); },
    setParam: (key, val) => {
      // The rig's discrete choices — which amp, which cab, which pickup, which
      // tremolo shape. None of them is a value to ramp.
      if (key === "gtamp")   { post({ type: "set", amp: AMP_IDX[val] ?? 2 }); return; }
      if (key === "gtcab")   { post({ type: "set", cab: CAB_IDX[val] ?? 0 }); return; }
      if (key === "gtpkupt") { post({ type: "set", pkupType: PKUP_IDX[val] ?? 1 }); return; }
      if (key === "gttremw") { post({ type: "set", tremSquare: val === "square" }); return; }
      const p = paramFor(key);
      if (!p) return;
      const v = Number(val);
      if (!Number.isFinite(v)) return;
      p.value = Math.max(p.minValue, Math.min(p.maxValue, v));
    },
    getAudioParam: (key) => paramFor(key),
    trigger: (note, time, dur, vel) => {
      const when = Math.max(Number(time) || 0, ctx.currentTime);
      post({
        type: "note", when, id: ++noteId, note,
        freq: 440 * Math.pow(2, (note - 69) / 12),
        dur: Math.max(0.01, Number(dur) || 0.1),
        vel: Math.max(0.05, Math.min(1, vel ?? 1)),
        glide,
      });
    },
    release: (time) => post({ type: "off", when: Math.max(Number(time) || 0, ctx.currentTime) }),
  };
}
