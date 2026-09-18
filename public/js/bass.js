// ---- electric bass ------------------------------------------------------
// Same chain as the guitar (see guitar.js — this is its sibling, and the string
// model is the same waveguide), but a bass is not a guitar an octave down, and
// the four things that make it its own instrument are all in here:
//
//   STRING ──▶ PICKUP ──▶ tone ──┬── clean (the low end, kept clean) ──┐
//   (four,                       ├── dirt  (highpassed, then clipped) ─┼─▶ COMP ─▶ AMP ─▶ CAB
//    wound,                      └── sub octave (tracked, an octave    │
//    stiff)                          under the note)                   │
//
// - **The strings are stiff and wound**, so their harmonics sit noticeably
//   sharp — far more than a guitar's. That inharmonicity is why a bass note has
//   a *pitch* and a *clank* that do not quite agree, and it is most of what
//   flatwounds take away.
// - **The dirt is parallel and highpassed.** Distorting a bass whole turns it to
//   mush: the fundamental intermodulates with everything above it and the low
//   end disappears. Every bass overdrive worth having splits the signal, dirties
//   only what is above a crossover, and puts the clean lows back underneath. So
//   that is what GRIND and XOVER do.
// - **There is always a compressor**, and it is not a subtle one. A bass part
//   holding still under everything else is a compressor doing that, and it is
//   as much a part of the sound as the amp is — which is why it gets one of the
//   four track sliders rather than a corner of the panel.
// - **The right hand is the instrument.** Fingers, a plectrum, or a thumb
//   against the frets are three different sounds before the amp sees anything,
//   and the string clattering against the fretboard — a one-sided clip inside
//   the waveguide's own loop, because the fretboard is only on one side — is
//   what slap actually is.
//
// Four strings, one rig, all inside one AudioWorklet: the modulation targets are
// the whole instrument's rather than voice 0's.
//
// Simplifications, stated plainly: four strings is a voice pool and not a
// fretboard; the cab is four biquads rather than a measured impulse; the
// octaver is a tracked oscillator rather than a flip-flop divider chasing zero
// crossings (so it never glitches, which a real one does, charmingly); and
// nothing here is oversampled, so the dirt aliases as a pedal's does.

/** @typedef {import("./types.js").Track} Track */

// Processor source — a string, registered from a Blob URL, same as the other
// worklet models. No backticks or dollar-brace anywhere inside it.
const BASS_PROCESSOR_SOURCE = `
const MAXV = 4;        // four strings
const BLK  = 16;       // control-block size
const DLEN = 4096;     // string delay line (down to ~11Hz at 48k)
const DMASK = DLEN - 1;

// ---- biquads (RBJ cookbook), transposed direct form II ------------------
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
// A bass amp's tone stack has two mid bands, not one, and where they sit is
// most of the difference between these. bias is how asymmetrically the input
// stage clips (valve warmth); soft is how gently it gets there at all.
const AMPS = [
  // di — a clean preamp. No colour, enormous headroom: the modern record.
  { g: 3,  bias: 0.01, soft: 0.25, lo: 80, lm: 250, hm: 800,  tr: 4000,
    vf: 0,    vg: 0,   vq: 1,   pwr: 1.0 },
  // flip-top — the small valve amp under every sixties record. Warm, round,
  // mid-forward, and it breaks up softly rather than grinding.
  { g: 16, bias: 0.18, soft: 1,    lo: 90, lm: 300, hm: 700,  tr: 3000,
    vf: 450,  vg: 3.5, vq: 0.8, pwr: 1.35 },
  // svt — the big valve stack. Clean and vast until it is not.
  { g: 34, bias: 0.1,  soft: 1,    lo: 70, lm: 250, hm: 900,  tr: 4500,
    vf: 120,  vg: 2.5, vq: 0.7, pwr: 1.6 },
  // gk — solid state, bright, and it grinds rather than saturates. Roundwounds
  // and a plectrum into this is a whole genre.
  { g: 60, bias: 0.03, soft: 0.4,  lo: 60, lm: 200, hm: 1200, tr: 6000,
    vf: 2400, vg: 3,   vq: 1.1, pwr: 1.2 },
];

// ---- the cabs -----------------------------------------------------------
const CABS = [
  { hp: 45, lp: 3800,  pf: 1800, pg: 3,   nf: 520,  ng: -2 },   // 8x10
  { hp: 55, lp: 4600,  pf: 2200, pg: 3.5, nf: 460,  ng: -2 },   // 4x10
  { hp: 38, lp: 2500,  pf: 850,  pg: 3,   nf: 1600, ng: -3 },   // 1x15
  { hp: 50, lp: 3400,  pf: 1500, pg: 3,   nf: 700,  ng: -2 },   // 2x12
  { hp: 22, lp: 13000, pf: 3000, pg: 0,   nf: 1000, ng: 0 },    // di — no cab
];

// Pickups. The resonance is what you hear, and on a bass it sits an octave or
// so below a guitar's because the coils are bigger.
const PICKUPS = [
  { f: 3000, q: 1.4, g: 4.5, lp: 6000 },   // jazz — single coil, bright, growly
  { f: 1900, q: 1.1, g: 4,   lp: 4200 },   // precision — split hum, thick mids
  { f: 2600, q: 1.7, g: 5.5, lp: 5400 },   // musicman — hum, hi-fi and aggressive
];

function softClip(x) {
  if (x > 3) return 1; if (x < -3) return -1;
  const x2 = x * x;
  return x * (27 + x2) / (27 + 9 * x2);
}

function makeString() {
  return {
    id: -1, active: false, gate: false, age: 0,
    note: 40, freq: 55, target: 55, glide: 1, vel: 1,
    buf: new Float32Array(DLEN), w: 0,
    len: 400, eta: 0, apX: 0, apZ: 0,
    lp: 0, disp: 0,
    d1x: 0, d1y: 0, d2x: 0, d2y: 0,
    dcX: 0, dcY: 0,
    g: 0.97, damp: 0.4, relG: 1,
    pkTap: 12,
    subPh: 0,
    env: 0, quiet: 0,
  };
}

class BassProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    const a = (name, defaultValue, minValue, maxValue) =>
      ({ name, defaultValue, minValue, maxValue, automationRate: "a-rate" });
    const k = (name, defaultValue, minValue, maxValue) =>
      ({ name, defaultValue, minValue, maxValue, automationRate: "k-rate" });
    return [
      // The four track sliders
      a("drive", 0.5, 0, 1), a("tone", 0.5, 0, 1), a("comp", 0.5, 0, 1), k("sustain", 0.4, 0, 1),
      // Right hand + string
      k("pick", 0.14, 0.02, 0.5), k("attack", 0.4, 0, 1), k("stiff", 0.45, 0, 1),
      k("pkup", 0.1, 0.02, 0.5), a("mute", 0, 0, 1), a("fret", 0.25, 0, 1),
      // The parallel dirt, and the octave under it
      a("grind", 0, 0, 1), a("xover", 0.4, 0, 1), a("sub", 0, 0, 1),
      // Amp
      a("bass", 0.5, 0, 1), a("lomid", 0.5, 0, 1), a("himid", 0.5, 0, 1), a("treb", 0.5, 0, 1),
      a("hpf", 0.15, 0, 1), a("mic", 0.4, 0, 1),
    ];
  }

  constructor() {
    super();
    this.sr = sampleRate;
    this.alive = true;
    this.queue = [];
    this.voices = []; for (let i = 0; i < MAXV; i++) this.voices.push(makeString());
    this.tick = 0;
    this.lastFreq = 55;
    this.glideSec = 0;
    this.ampModel = 2; this.cabModel = 0; this.pkupType = 1; this.flats = 0;
    this.pickPos = 0.14; this.pickHard = 0.4; this.pkupPos = 0.1;
    this.scratch = new Float32Array(DLEN);

    this.toneLP = 0;
    this.pkPeak = bq(); this.pkLP = bq();
    // The dirt path: highpass, clip, and a lowpass to keep the fizz down.
    this.dirtHP = bq(); this.dirtLP = bq(); this.cleanLP = bq();
    // Compressor
    this.compEnv = 0;
    // Amp
    this.inHP = bq(); this.stackLo = bq(); this.stackLM = bq(); this.stackHM = bq(); this.stackHi = bq();
    this.ampVoice = bq(); this.userHP = bq();
    this.stageDC = 0; this.stageDCx = 0;
    // Cab
    this.cabHP = bq(); this.cabPeak = bq(); this.cabLP = bq(); this.cabNotch = bq();
    this.subLP = bq();
    this.outDC = 0; this.outDCx = 0;

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
      if (m.flats !== undefined) this.flats = m.flats ? 1 : 0;
      if (m.glide !== undefined) this.glideSec = Math.max(0, m.glide);
      this.coefKey = -1;
    } else if (m.type === "dispose") {
      this.alive = false;
    }
  }

  // The pluck. Hardness is the whole of the right hand: a thumb barely excites
  // the top of the string's range, a plectrum excites all of it. Flatwounds
  // start out duller than rounds whatever you hit them with.
  pluck(v, hard, vel) {
    const L = v.len;
    const bright = this.flats ? 0.45 : 1;
    const a = (0.02 + hard * hard * 0.5) * bright;
    let z = 0;
    const off = Math.max(1, Math.min(L - 1, Math.round(this.pickPos * L)));
    const tmp = this.scratch;
    for (let i = 0; i < L; i++) {
      z += a * ((Math.random() * 2 - 1) - z);
      tmp[i] = z;
    }
    const keep = v.env > 1e-4 ? 0.4 : 0;
    const amp = 0.9 * (0.3 + vel * 0.7);
    for (let i = 0; i < L; i++) {
      const c = tmp[i] - tmp[(i - off + L) % L] * 0.9;
      const idx = (v.w - L + i + DLEN * 2) & DMASK;
      v.buf[idx] = v.buf[idx] * keep + c * amp;
    }
    v.env = amp;
    v.quiet = 0;
  }

  noteOn(ev, stiff) {
    let v = null;
    for (const c of this.voices) if (!c.active) { v = c; break; }
    if (!v) {
      let worst = Infinity;
      for (const c of this.voices) { const s = c.gate ? c.env + 10 : c.env; if (s < worst) { worst = s; v = c; } }
      // The string keeps ringing: pluck() mixes the new excitation over what is
      // in the loop, which is what plucking a sounding string does. Zeroing
      // the delay line here dropped a ringing string to silence in one sample.
    }
    if (!v.active) { v.buf.fill(0); v.lp = 0; v.apX = 0; v.apZ = 0; v.d1x = v.d1y = v.d2x = v.d2y = 0; v.subPh = 0; }
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

  // A bass note does not stop when the finger lifts, it damps — and a player's
  // left hand is most of what keeps a bass line from turning to porridge, so
  // the release here is shorter than the guitar's.
  noteOff(id, sustain) {
    for (const v of this.voices) {
      if (!v.active || v.id !== id || !v.gate) continue;
      v.gate = false;
      const T = 0.04 + sustain * 0.4;
      v.relG = Math.exp(-6.9 / Math.max(1, v.freq * T)) / Math.max(1e-6, v.g);
      if (v.relG > 1) v.relG = 1;
    }
  }

  retune(v, stiff) {
    // Bass strings are wound and stiff, so the dispersion is stronger than a
    // guitar's for the same slider — this is where the clank comes from, and
    // flatwounds have markedly less of it.
    const c = -stiff * (this.flats ? 0.4 : 0.62);
    const apD = (1 - c) / (1 + c);
    const a = Math.max(0.04, v.damp);
    const lpD = (1 - a) / a;
    let D = this.sr / Math.max(15, v.freq) - lpD - 2 * apD;
    if (D < 8) D = 8;
    if (D > DLEN - 4) D = DLEN - 4;
    const len = Math.floor(D - 0.1);
    const frac = D - len;
    v.len = len;
    v.eta = (1 - frac) / (1 + frac);
    v.disp = c;
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
    this.pickHard = kv(P.attack);
    this.pkupPos  = kv(P.pkup);

    const A = AMPS[this.ampModel], C = CABS[this.cabModel], PK = PICKUPS[this.pkupType];

    for (let base = 0; base < N; base += BLK) {
      const blk = Math.min(BLK, N - base);
      const frame = n0 + base;

      while (this.queue.length && this.queue[0].at <= frame) {
        const ev = this.queue.shift();
        if (ev.off) this.noteOff(ev.id, sustain); else this.noteOn(ev, stiff);
      }
      if (this.allOff !== undefined && frame >= this.allOff) {
        for (const v of this.voices) if (v.gate) this.noteOff(v.id, sustain);
        this.allOff = undefined;
      }

      const i = base;
      const drive = P.drive.length > 1 ? P.drive[i] : P.drive[0];
      const tone  = P.tone.length  > 1 ? P.tone[i]  : P.tone[0];
      const comp  = P.comp.length  > 1 ? P.comp[i]  : P.comp[0];
      const mute  = P.mute.length  > 1 ? P.mute[i]  : P.mute[0];
      const fret  = P.fret.length  > 1 ? P.fret[i]  : P.fret[0];
      const grind = P.grind.length > 1 ? P.grind[i] : P.grind[0];
      const xover = P.xover.length > 1 ? P.xover[i] : P.xover[0];
      const sub   = P.sub.length   > 1 ? P.sub[i]   : P.sub[0];
      const bass  = P.bass.length  > 1 ? P.bass[i]  : P.bass[0];
      const lomid = P.lomid.length > 1 ? P.lomid[i] : P.lomid[0];
      const himid = P.himid.length > 1 ? P.himid[i] : P.himid[0];
      const treb  = P.treb.length  > 1 ? P.treb[i]  : P.treb[0];
      const hpf   = P.hpf.length   > 1 ? P.hpf[i]   : P.hpf[0];
      const mic   = P.mic.length   > 1 ? P.mic[i]   : P.mic[0];

      let key = ((this.ampModel * 5 + this.cabModel) * 3 + this.pkupType) * 2 + this.flats;
      for (const q of [tone, bass, lomid, himid, treb, hpf, mic, xover]) key = key * 64 + (q * 63 | 0);
      if (key !== this.coefKey) {
        this.coefKey = key;
        bqPeak(this.pkPeak, sr, PK.f, PK.q, PK.g);
        bqLP(this.pkLP, sr, PK.lp, 0.7);
        // Crossover: the dirt only ever works on what is above it, and the
        // clean path keeps everything below. This is the whole trick.
        const xf = 120 * Math.pow(2, xover * 3.6);
        bqHP(this.dirtHP, sr, xf, 0.7);
        bqLP(this.dirtLP, sr, 4500, 0.7);
        bqLP(this.cleanLP, sr, xf * 1.6, 0.7);
        bqHP(this.inHP, sr, 28, 0.7);
        bqLowShelf(this.stackLo, sr, A.lo, (bass - 0.5) * 22);
        bqPeak(this.stackLM, sr, A.lm, 0.9, (lomid - 0.5) * 18);
        bqPeak(this.stackHM, sr, A.hm, 0.9, (himid - 0.5) * 18);
        bqHighShelf(this.stackHi, sr, A.tr, (treb - 0.5) * 20);
        if (A.vg) bqPeak(this.ampVoice, sr, A.vf, A.vq, A.vg);
        else bqPeak(this.ampVoice, sr, 1000, 1, 0);
        // The low cut every bass rig has, and every live engineer reaches for
        // first: below about 30Hz there is nothing but cone excursion.
        bqHP(this.userHP, sr, 28 + hpf * hpf * 120, 0.7);
        bqHP(this.cabHP, sr, C.hp, 0.72);
        bqPeak(this.cabPeak, sr, C.pf, 1.2, C.pg * (0.4 + mic));
        bqLP(this.cabLP, sr, C.lp * (0.6 + mic * 0.85), 0.9);
        bqPeak(this.cabNotch, sr, C.nf, 1.1, C.ng);
        bqLP(this.subLP, sr, 220, 0.7);
      }

      // The tone pot on the instrument, before anything else.
      const toneFc = 400 * Math.pow(2, tone * 4.9);
      const toneA = 1 - Math.exp(-2 * Math.PI * Math.min(toneFc, sr * 0.45) / sr);

      // A bass string rings for a long time: the loop is less lossy than a
      // guitar's and the period is longer, so there are fewer trips round it per
      // second. Flats lose their highs almost at once, which is the point of them.
      const g = (0.955 + sustain * 0.042) * (1 - mute * 0.2);
      const damp = Math.max(0.04, (this.flats ? 0.22 : 0.45) - mute * 0.18);
      for (const v of this.voices) {
        if (!v.active) continue;
        if (Math.abs(v.g - g) > 1e-4 || Math.abs(v.damp - damp) > 1e-3) { v.g = g; v.damp = damp; this.retune(v, stiff); }
        if (v.glide < 1) {
          v.freq += (v.target - v.freq) * v.glide;
          if (Math.abs(v.target - v.freq) < 0.02) { v.freq = v.target; v.glide = 1; }
          this.retune(v, stiff);
        }
      }

      // The string clatters against the fretboard, which is on one side of it —
      // so the limit is one-sided, and it is inside the loop rather than after
      // it. Slap is this and nothing else.
      const fretLim = fret > 0.001 ? 0.62 - fret * 0.5 : 0;

      const dr = drive * drive;
      const inG = 1.8 * Math.pow(A.g, dr);
      const grindG = 1 + grind * grind * 40;
      const pwrG = A.pwr;
      const outTrim = 0.5 / (0.5 + drive * 0.9 + grind * 0.5);
      // Compressor: threshold falls and makeup rises together, so one slider is
      // "more compression" rather than three that have to agree.
      const thr = 0.5 - comp * 0.44;
      const ratio = 1 + comp * 7;
      const makeup = 1 + comp * comp * 2.2;
      const atkC = 1 - Math.exp(-1 / (0.006 * sr));
      const relC = 1 - Math.exp(-1 / (0.14 * sr));

      for (let n = 0; n < blk; n++) {
        let mono = 0, subSig = 0;
        for (let vi = 0; vi < MAXV; vi++) {
          const v = this.voices[vi];
          if (!v.active) continue;
          const buf = v.buf, w = v.w, len = v.len;
          const xi = buf[(w - len + DLEN) & DMASK];
          let y = v.eta * (xi - v.apZ) + v.apX;
          v.apX = xi; v.apZ = y;
          const c = v.disp;
          const y1 = c * y + v.d1x - c * v.d1y; v.d1x = y; v.d1y = y1;
          const y2 = c * y1 + v.d2x - c * v.d2y; v.d2x = y1; v.d2y = y2;
          v.lp += v.damp * (y2 - v.lp);
          let fed = v.lp * v.g * v.relG;
          if (fretLim > 0 && fed < -fretLim) fed = -fretLim + (fed + fretLim) * 0.22;
          if (fed > 4) fed = 4; else if (fed < -4) fed = -4;
          buf[w] = fed;
          v.w = (w + 1) & DMASK;
          const tap = buf[(w - len + v.pkTap + DLEN) & DMASK];
          let s = y - tap * 0.78;
          const dy = s - v.dcX + 0.9995 * v.dcY;
          v.dcX = s; v.dcY = dy;
          s = dy;
          const as = s < 0 ? -s : s;
          v.env += 0.0008 * (as - v.env);
          if (!v.gate || v.relG < 1) {
            if (v.env < 2e-5) { if (++v.quiet > 3000) { v.active = false; v.buf.fill(0); v.env = 0; } }
            else v.quiet = 0;
          }
          // The octaver tracks the note and follows the string's own level, so
          // it arrives with the note and leaves with it.
          if (sub > 0.001) {
            v.subPh += v.freq * 0.5 / sr;
            if (v.subPh >= 1) v.subPh -= 1;
            const e = v.env * 4;
            subSig += Math.sin(2 * Math.PI * v.subPh) * (e > 1 ? 1 : e);
          }
          mono += s;
        }

        // ---- pickup, then the tone pot ----
        let x = bqRun(this.pkLP, bqRun(this.pkPeak, mono)) * 0.55;
        this.toneLP += toneA * (x - this.toneLP);
        x = this.toneLP;
        if (sub > 0.001) x += bqRun(this.subLP, subSig) * sub * 0.55;

        // ---- the split: clean lows, dirty highs ----
        let sig = x;
        if (grind > 0.001) {
          const hi = bqRun(this.dirtHP, x);
          const dirty = bqRun(this.dirtLP, softClip(hi * grindG)) * (0.4 + grind * 0.5);
          sig = bqRun(this.cleanLP, x) + dirty;
        }

        // ---- compressor ----
        const ax = sig < 0 ? -sig : sig;
        this.compEnv += (ax > this.compEnv ? atkC : relC) * (ax - this.compEnv);
        if (this.compEnv > thr) {
          sig *= Math.pow(this.compEnv / thr, 1 / ratio - 1);
        }
        sig *= makeup;

        // ---- amp ----
        let s1 = bqRun(this.inHP, sig * inG);
        if (A.soft > 0.3) {
          s1 = softClip(s1 * A.soft + A.bias) - softClip(A.bias);
          const dc = s1 - this.stageDCx + 0.9995 * this.stageDC;
          this.stageDCx = s1; this.stageDC = dc;
          s1 = dc;
        }
        s1 = bqRun(this.stackHi, bqRun(this.stackHM, bqRun(this.stackLM, bqRun(this.stackLo, s1))));
        s1 = bqRun(this.ampVoice, s1);
        s1 = bqRun(this.userHP, s1);
        let p = softClip(s1 * pwrG);

        // ---- cab ----
        let y = bqRun(this.cabNotch, bqRun(this.cabLP, bqRun(this.cabPeak, bqRun(this.cabHP, p))));

        let z = y * outTrim;
        const dz = z - this.outDCx + 0.9995 * this.outDC;
        this.outDCx = z; this.outDC = dz;
        o[base + n] = softClip(dz);
      }
    }
    return true;
  }
}

registerProcessor("electric-bass", BassProcessor);
`;

const _loads = new WeakMap();
const _ready = new WeakSet();

/**
 * Register the electric-bass processor on this context. Called at init() so the
 * await on the play path has already resolved by the time a voice is built.
 * @param {BaseAudioContext} ctx @returns {Promise<void>}
 */
export function loadBassWorklet(ctx) {
  if (!ctx?.audioWorklet) return Promise.reject(new Error("no AudioWorklet"));
  let p = _loads.get(ctx);
  if (!p) {
    const url = URL.createObjectURL(new Blob([BASS_PROCESSOR_SOURCE], { type: "text/javascript" }));
    p = ctx.audioWorklet.addModule(url)
      .then(() => { URL.revokeObjectURL(url); _ready.add(ctx); })
      .catch((e) => { URL.revokeObjectURL(url); _loads.delete(ctx); throw e; });
    _loads.set(ctx, p);
  }
  return p;
}

/** Has the processor finished registering on this context? */
export function bassReady(ctx) { return !!ctx && _ready.has(ctx); }

// ---- the panel ----------------------------------------------------------
// One list, three namespaces, as in hexop.js and guitar.js: every control is
// `bs` + a short key, and that short key spells its LFO target (`bas_<short>`)
// and its automation lane (`bas.<short>`). The list, the ranges, the defaults
// and the tones are data in engineData.js; re-exported here.
import { BASS_DEFAULTS, BASS_MOD_KEYS } from "./engineData.js";
export {
  BASS_NUM_CTLS, BASS_SEL_CTLS, BASS_MOD_KEYS, BASS_NUM_KEYS, BASS_SEL_KEYS,
  BASS_MOD_RANGE, BASS_MOD_LABELS, BASS_DEFAULTS, bassFromUnit,
  BASS_TONE_NAMES, bassToneDescription, bassTone,
} from "./engineData.js";

const AMP_IDX  = { di: 0, flip: 1, svt: 2, gk: 3 };
const CAB_IDX  = { "8x10": 0, "4x10": 1, "1x15": 2, "2x12": 3, di: 4 };
const PKUP_IDX = { j: 0, p: 1, mm: 2 };

// Tone wrappers don't accept a native connect() — unwrap to the node underneath.
const nativeIn = (node) => node?.input?.input ?? node?.input ?? node;

/**
 * Build the bass voice. Returns null when the worklet isn't registered yet, so
 * the caller can fall back rather than leave the track silent.
 * @param {*} output Tone node the voice writes into.
 */
export function buildBassVoice(output) {
  const ctx = Tone.getContext().rawContext;
  if (!bassReady(ctx)) { loadBassWorklet(ctx).catch(() => {}); return null; }

  let node;
  try {
    node = new AudioWorkletNode(ctx, "electric-bass",
      { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1] });
  } catch (e) {
    console.warn("electric-bass worklet node failed", e);
    return null;
  }
  node.connect(nativeIn(output));

  const PARAM_OF = { harm: "drive", timb: "tone", morph: "comp", decay: "sustain" };
  for (const k of BASS_MOD_KEYS) PARAM_OF[`bs${k}`] = k;

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
      if (key === "bsamp")   { post({ type: "set", amp: AMP_IDX[val] ?? 2 }); return; }
      if (key === "bscab")   { post({ type: "set", cab: CAB_IDX[val] ?? 0 }); return; }
      if (key === "bspkupt") { post({ type: "set", pkupType: PKUP_IDX[val] ?? 1 }); return; }
      if (key === "bsstrs")  { post({ type: "set", flats: val === "flat" }); return; }
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
