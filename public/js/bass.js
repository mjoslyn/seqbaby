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
// - **The pluck is a pulse, not a burst of noise.** The loop starts with the
//   velocity wave of a string pulled aside at the pick position and let go: a
//   1/n spectrum with the pick's comb on it, so the fundamental leads and the
//   note begins with a thump. The Karplus-Strong noise burst the guitar gets
//   away with is 24ms of hash on a low E, and measured it left the fundamental
//   15dB under the 3rd harmonic. See pluck().
// - **The losses are a rate in time, not a loss per trip** (setLosses): a loop
//   filter applied once per period costs a 41Hz note a third as much per second
//   as a 110Hz one, which is why a fixed coefficient had every partial of E1
//   decaying at the same 10dB/s. Scaled by the period, the top of a low note
//   dies in under a second while its fundamental rings on.
// - **The strings are stiff and wound**, so their partials sit noticeably
//   sharp — far more than a guitar's. That inharmonicity is why a bass note has
//   a *pitch* and a *clank* that do not quite agree, and it is most of what
//   flatwounds take away. It is a real coefficient here (dispCoef), solved per
//   note: a roundwound E at the default puts its 8th partial ~16 cents sharp
//   and its 12th ~35, where real ones measure.
// - **A string vibrates in two planes** (makeString), and the second one is
//   sensed less, decays faster and sits a fraction of a hertz away: the
//   two-stage decay and the slow swell of a real note, in place of a single
//   exponential.
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
const NAP  = 8;        // dispersion allpasses per polarization (see dispCoef)
const FREF = 110;      // the note the loss knobs are calibrated at (A2)

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

// The fretboard, in standard tuning: the open strings low to high.
const OPEN_F = [41.2, 55.0, 73.42, 98.0];
const NSTR = 4;
// A velocity at or under this is a ghost note: the fretting hand lying on the
// string, the pluck heard as a thud with hardly a pitch. Half of what makes a
// funk or a rock line move.
const DEAD_VEL = 0.1;
function fretOf(s, f) { return 12 * Math.log2(f / OPEN_F[s]); }
// What a note costs the left hand on a fret, with the hand at a position (the
// index finger's fret, reaching four up): open strings are cheap, a fret
// inside the hand's reach free, anything else the distance to move, plus a
// little for the top of the neck, which is where nobody plays a bass line.
function placeCost(fret, hand) {
  if (fret < -0.3 || fret > 24.3) return 1e9;
  if (fret < 0.5) return 0.3 + (hand > 7 ? 0.8 : 0);
  const d = fret < hand ? hand - fret : (fret > hand + 3 ? fret - hand - 3 : 0);
  return d + (fret > 12 ? 0.5 : 0);
}
function softClip(x) {
  if (x > 3) return 1; if (x < -3) return -1;
  const x2 = x * x;
  return x * (27 + x2) / (27 + 9 * x2);
}

// One polarization of a string: a delay line, the fractional-delay allpass that
// tunes it, the dispersion cascade, and the loss filter. A string has two.
function makeLine() {
  return {
    buf: new Float32Array(DLEN), w: 0,
    len: 400, eta: 0, apX: 0, apZ: 0,
    c: 0, ap: new Float64Array(NAP * 2),
    lp: 0, g: 0.97,
  };
}
function resetLine(ln) {
  ln.buf.fill(0); ln.lp = 0; ln.apX = 0; ln.apZ = 0; ln.ap.fill(0);
}

// A string vibrates in two planes, and the pickup, the bridge and the
// fretboard do not treat them alike: the plane towards the pickup is sensed
// fully and is the one that can hit the frets; the other is sensed less, is
// lost into the bridge faster, and sits a fraction of a hertz away because
// the bridge is not equally stiff in both directions. Together that is what
// gives a real note its two-stage decay (quick at first, then the long ring)
// and the slow swell under a held note. One line gives a single exponential,
// and a single exponential is one of the things the ear reads as a synth.
function makeString() {
  return {
    id: -1, active: false, gate: false, age: 0,
    note: 40, freq: 55, target: 55, glide: 1, vel: 1,
    a: makeLine(), b: makeLine(),
    dcX: 0, dcY: 0,
    g: 0.97, damp: 0.4, relG: 1,
    pkTap: 12,
    subPh: 0,
    str: 0, fret: 0, r: 1,                 // which string, where on it, the vibrating length (1 open)
    struckAt: -1e9, dead: false, relAt: -1,
    env: 0, quiet: 0,
  };
}

// ---- dispersion ---------------------------------------------------------
// A stiff string's partials run sharp: partial n sits at n*f0*sqrt(1 + B*n*n),
// B the inharmonicity coefficient (a few 1e-4 for a roundwound E, which puts
// the 8th partial ~15 cents sharp and the 16th ~60: that is the clank). In a
// waveguide that is a loop whose delay FALLS with frequency: partial n fits
// where the loop's PHASE delay is a whole number of its periods, so the loop
// has to be a fraction 1 - 1/sqrt(1 + B*n*n) shorter at that frequency than at
// DC. A cascade of NAP identical first-order allpasses does that: each one's
// delay is (1-c)/(1+c) at DC and falls, quadratically at first, towards one
// sample. Its shape is fixed by c, so the coefficient is solved (bisection,
// below) to put ONE partial exactly where the law says, the 10th, which on a
// bass is the top of what the ear hears as the clank; the partials either
// side follow the law as closely as a first-order cascade's shape allows,
// within a few cents below it and running sharp of it above, where the
// partials are weak and brief anyway. Solving it from the small-angle
// (group-delay) coefficient instead, as a first version did, came out at a
// third of the stretch asked for: the phase delay's quadratic term is a third
// of the group delay's. Eight stages rather than four keep the knee above the
// partials a bass has energy in. Two allpasses at a fixed coefficient (what
// this file had) swing ~2 samples over the whole band, which on a 1165-sample
// E string is 3 cents at the very top and nothing anywhere a bass has energy:
// measured, every partial came out dead harmonic.

// The phase delay of one stage at w, in samples (its group delay at DC is
// (1-c)/(1+c); this is what the loop's resonances actually follow).
function apPhaseDelay(c, w) {
  const cw = Math.cos(w), sw = Math.sin(w);
  const ph = Math.atan2(-sw, c + cw) - Math.atan2(-c * sw, 1 + c * cw);
  return -ph / w;
}
// Solve c so the cascade's phase delay at wRef is drop samples short of its
// delay at DC. Monotonic in c, so bisection. The cap keeps the cascade's own
// DC delay inside a short loop's budget: a high note has fewer samples to
// spend than the stretch would like, and the solve is simply capped there.
function dispCoef(drop, wRef, maxDelay) {
  if (drop <= 0 || maxDelay < NAP) return 0;
  const tau = maxDelay / NAP;
  let lo = Math.max(-0.95, (1 - tau) / (1 + tau)), hi = 0;
  for (let i = 0; i < 28; i++) {
    const c = 0.5 * (lo + hi);
    const d = NAP * ((1 - c) / (1 + c) - apPhaseDelay(c, wRef));
    if (d > drop) lo = c; else hi = c;
  }
  return 0.5 * (lo + hi);
}

// ---------------------------------------------------------------------------
// The event queue: parallel typed arrays, not an array of objects.
//
// It used to be a plain array, and every note cost two object literals, a
// sort() with a fresh comparator closure, and — on a stop — a filter() building
// a whole new array. All of that is garbage generated ON THE AUDIO THREAD, and
// a GC pause there is a dropout, which is the one failure this file cannot
// afford. Nothing below allocates after construction.
//
// It stays ordered by inserting from the back rather than by sorting the whole
// queue: the transport schedules ahead in time order, so the common case moves
// nothing at all and an out-of-order arrival walks past a handful of pending
// note-offs. The walk stops on a tie, so equal timestamps keep their insertion
// order — the same guarantee the stable sort it replaces gave, and what makes
// a note-on and the note-off of the step before it land in the right order.
// ---------------------------------------------------------------------------
// The caller's own cap is soft: it drops ONE event when the queue is over 128
// and then pushes two, so a burst posted faster than it is consumed grows by
// one event per note. That is the behaviour this replaced and it is preserved
// exactly, quirk included, so no song renders differently. QCAP is a hard
// backstop far above it — reaching it needs ~900 notes queued on one track at
// once, which nothing this transport can do — and it exists only so a fixed
// buffer can never be overrun.
const QCAP = 1024;
class EventQueue {
  constructor() {
    // Frames are f64: at 48k an int32 runs out after about twelve hours, and a
    // f32 stops being able to name every frame after about three minutes.
    this.at    = new Float64Array(QCAP);
    this.id    = new Float64Array(QCAP);
    this.note  = new Float64Array(QCAP);
    // freq, vel and glide are f64 as well, and deliberately. An f32 round trip
    // moves a frequency by about a part in ten million, which is inaudible on
    // its own and still enough to decorrelate an oscillator's phase within a
    // few hundred samples — so a song would not render the same as it used to.
    // Six arrays of 1024 f64 is 48KB a track; bit-exactness is worth more.
    this.freq  = new Float64Array(QCAP);
    this.vel   = new Float64Array(QCAP);
    this.glide = new Float64Array(QCAP);
    this.off   = new Uint8Array(QCAP);
    this.head = 0;
    this.len = 0;
    // One scratch event, reused by every shift(). The consumers copy the
    // primitives they want straight out of it and never keep a reference, so
    // a second one could never be observed.
    this.ev = { at: 0, off: false, leg: false, id: 0, note: 0, freq: 0, vel: 0, glide: 0 };
  }

  _move(d, s) {
    this.at[d] = this.at[s]; this.id[d] = this.id[s]; this.note[d] = this.note[s];
    this.freq[d] = this.freq[s]; this.vel[d] = this.vel[s]; this.glide[d] = this.glide[s];
    this.off[d] = this.off[s];
  }

  // Slide the live window back to the front. copyWithin is a memmove on a
  // typed array — no allocation — and it only runs once the window has walked
  // to the end of the buffer: with a couple of events live that is one memmove
  // of a couple of events per thousand pushed, about once a minute of playing.
  _compact() {
    const h = this.head, e = h + this.len;
    if (h === 0) return;
    this.at.copyWithin(0, h, e); this.id.copyWithin(0, h, e);
    this.note.copyWithin(0, h, e); this.freq.copyWithin(0, h, e);
    this.vel.copyWithin(0, h, e); this.glide.copyWithin(0, h, e);
    this.off.copyWithin(0, h, e);
    this.head = 0;
  }

  push(at, off, id, note, freq, vel, glide) {
    if (this.len >= QCAP) this.dropOldest();          // the callers cap first
    if (this.head + this.len >= QCAP) this._compact();
    let j = this.head + this.len - 1;
    while (j >= this.head && this.at[j] > at) { this._move(j + 1, j); j--; }
    const i = j + 1;
    // off: 1 a note-off, 0 a note-on, 2 a note-on asked for legato.
    this.at[i] = at; this.off[i] = off === true ? 1 : (off | 0); this.id[i] = id;
    this.note[i] = note; this.freq[i] = freq; this.vel[i] = vel; this.glide[i] = glide;
    this.len++;
  }

  headAt() { return this.at[this.head]; }

  shift() {
    const i = this.head, e = this.ev;
    e.at = this.at[i]; e.off = this.off[i] === 1; e.leg = this.off[i] === 2; e.id = this.id[i];
    e.note = this.note[i]; e.freq = this.freq[i]; e.vel = this.vel[i]; e.glide = this.glide[i];
    this.head++; this.len--;
    if (this.len === 0) this.head = 0;
    return e;
  }

  // A stop keeps only the note-offs that land before it: a note that has not
  // started must not start, and a release past the stop has nothing left to
  // release. Compacted in place, in order, so the filter() is gone as well.
  keepOffsBefore(limit) {
    const h = this.head, end = h + this.len;
    let w = h;
    for (let r = h; r < end; r++) {
      if (this.off[r] === 1 && this.at[r] < limit) { if (w !== r) this._move(w, r); w++; }
    }
    this.len = w - h;
    if (this.len === 0) this.head = 0;
  }

  dropOldest() {
    if (this.len === 0) return;
    this.head++; this.len--;
    if (this.len === 0) this.head = 0;
  }
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
      k("fnoise", 0.35, 0, 1),
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
    this.queue = new EventQueue();
    this.voices = []; for (let i = 0; i < MAXV; i++) this.voices.push(makeString());
    this.tick = 0;
    this.lastFreq = 55;
    this.glideSec = 0;
    this.ampModel = 2; this.cabModel = 0; this.pkupType = 1; this.flats = 0;
    this.blkG = 0.972; this.blkDamp = 0.23;
    this.pickPos = 0.14; this.pickHard = 0.4; this.pkupPos = 0.1;
    this.scratch = new Float32Array(DLEN);
    // The fretboard: where the left hand is, the last string played (a slide
    // or a hammer-on stays on it), and the fixed arrays a double stop is
    // placed in and its plucks wait in. Nothing here allocates per note.
    this.hand = 1; this.lastString = -1;
    this.gId = new Float64Array(8); this.gNote = new Float64Array(8);
    this.gFreq = new Float64Array(8); this.gVel = new Float64Array(8);
    this.gGlide = new Float64Array(8); this.gStr = new Int8Array(8);
    this.gOrd = new Int8Array(8); this.gLeg = new Uint8Array(8); this.gN = 0;
    this.dp = new Float64Array(NSTR * NSTR); this.dpFrom = new Int8Array(NSTR * NSTR);
    this.pAt = new Float64Array(8); this.pStr = new Int8Array(8);
    this.pId = new Float64Array(8); this.pNote = new Float64Array(8);
    this.pFreq = new Float64Array(8); this.pVel = new Float64Array(8);
    this.pGlide = new Float64Array(8); this.pOff = new Uint8Array(8);
    this.pDead = new Uint8Array(8); this.pN = 0;
    // The fingers: a squeak when the hand jumps along the wound strings, a
    // thump when a finger lifts off one.
    this.fnoise = 0.35;
    this.lastPlayAt = -1e9; this.handMoved = 0; this.sqArmed = 0;
    this.sqT = 0; this.sqLen = 1; this.sqF0 = 800; this.sqF1 = 1600; this.sqLvl = 0; this.sqOn = false;
    this.sqY1 = 0; this.sqY2 = 0;
    this.thEnv = 0; this.thLP = 0; this.thLP2 = 0;
    this.thDecay = Math.exp(-1 / (0.015 * this.sr));
    this.curFrame = 0; this.curSustain = 0.4; this.curStiff = 0.45;

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
      if (this.queue.len > 128) this.queue.dropOldest();
      const at = Math.max(0, Math.round(m.when * this.sr));
      this.queue.push(at, m.legato ? 2 : 0, m.id, m.note, m.freq, m.vel, m.glide);
      this.queue.push(at + Math.max(1, Math.round(m.dur * this.sr)), true, m.id, 0, 0, 0, 0);
    } else if (m.type === "off") {
      const at = Math.max(0, Math.round(m.when * this.sr));
      this.queue.keepOffsBefore(at);
      this.allOff = at;
      this.pN = 0;
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

  // The pluck. What goes into the loop is the shape a plucked string actually
  // starts with — the velocity wave of a string pulled aside at the pick
  // position and let go, which in a one-period loop is a pulse the width of
  // the pick position against a shallow return of the opposite sign (zero
  // mean, so the loop carries no DC). Its spectrum is 1/n with the pick comb's
  // notches, so the fundamental is the strongest partial and the attack is a
  // thump. It used to be a period of filtered NOISE, combed at the pick
  // position (the Karplus-Strong burst). That is fine on a guitar, whose
  // period is 3ms; on a bass it is 24ms of hash at every note, and measured
  // it took ten periods — a quarter of a second at E1 — to settle into a
  // waveform at all, while a flat noise spectrum left the fundamental 13-17dB
  // under the 2nd and 3rd harmonics. Both are most of what read as unnatural.
  //
  // Hardness is the whole of the right hand, and it is the rounding of that
  // pulse's edges: a thumb lets the string go slowly (a low corner, a soft
  // 12dB/oct attack), a plectrum snaps it (the full 1/n). Playing harder
  // sharpens the edge as well as raising the level, so velocity is brightness
  // too, as on the instrument. Flatwounds start out duller whatever hits
  // them. A few milliseconds of noise ride the edge for the finger or pick
  // scraping off the winding — brighter and shorter for a plectrum — and that
  // small random part, plus a little jitter in where and how hard the string
  // is struck, is what keeps a run of equal notes from being the same sample
  // eight times.
  pluck(v, hard, vel, keepAmt = 0.4) {
    const sr = this.sr;
    const bright = this.flats ? 0.45 : 1;
    const h = Math.max(0, Math.min(1, hard * (1 + (Math.random() - 0.5) * 0.12)));
    // The pluck position is a place on the body, so on a fretted (shorter)
    // string it is further along what vibrates: rounder up the neck.
    const pos = Math.max(0.02, Math.min(0.5, this.pickPos / v.r * (1 + (Math.random() - 0.5) * 0.08)));
    const a = Math.min(0.9, (0.03 + h * h * 0.55) * bright * (0.6 + vel * 0.4));
    const keep = v.env > 1e-4 ? keepAmt : 0;
    const amp = 0.45 * (0.3 + vel * 0.7);
    const tmp = this.scratch;

    for (let side = 0; side < 2; side++) {
      const ln = side ? v.b : v.a;
      const L = ln.len;
      const off = Math.max(1, Math.min(L - 2, Math.round(pos * L)));
      const ret = off / (L - off);
      // Round the pulse with the hand, twice round the loop so the seam at
      // the period boundary is as smooth as the edges.
      let z = 0;
      for (let pass = 0; pass < 2; pass++) {
        for (let i = 0; i < L; i++) { z += a * ((i < off ? -1 : ret) - z); if (pass) tmp[i] = z; }
      }
      const g = amp;
      for (let i = 0; i < L; i++) {
        const idx = (ln.w - L + i + DLEN * 2) & DMASK;
        ln.buf[idx] = ln.buf[idx] * keep + tmp[i] * g;
      }
      if (side) break;
      // The scrape, on the pulse's edge, in the plane towards the pickup.
      const nb = Math.min(L, Math.max(8, Math.round(sr * (0.0035 - h * 0.0025))));
      const sc = amp * (0.08 + h * 0.3) * bright;
      const a2 = Math.min(0.95, a * 5);
      z = 0;
      for (let i = 0; i < nb; i++) {
        z += a2 * ((Math.random() * 2 - 1) - z);
        const idx = (ln.w - L + off + i + DLEN * 2) & DMASK;
        ln.buf[idx] += z * sc;
      }
    }
    v.env = amp;
    v.quiet = 0;
  }

  // Play a note on string s. One string, one note: a new note on a ringing
  // string replaces what it was playing. Re-plucking the same note keeps
  // some of the ring; a new fret keeps almost none, the finger having
  // stopped the string first.
  noteOn(s, id, note, freq, vel, glide, stiff, frame, dead) {
    const v = this.voices[s];
    const same = v.active && Math.abs(freq / v.target - 1) < 0.003;
    if (!v.active) { resetLine(v.a); resetLine(v.b); v.subPh = 0; }
    v.id = id; v.note = note; v.vel = vel;
    v.active = true; v.gate = true; v.age = ++this.tick;
    v.target = freq;
    v.str = s;
    v.fret = Math.max(0, fretOf(s, freq));
    v.r = Math.max(0.12, Math.min(1, Math.pow(2, -v.fret / 12)));
    v.struckAt = frame; v.dead = !!dead; v.relAt = -1;
    const gl = glide > 0 ? glide : this.glideSec;
    if (gl > 0) {
      const from = s === this.lastString && v.freq > 0 ? v.freq : this.lastFreq;
      v.freq = from; v.glide = 1 - Math.exp(-3 / (gl * this.sr / BLK));
    } else { v.freq = freq; v.glide = 1; }
    this.lastFreq = freq;
    this.lastString = s;
    v.relG = 1;
    this.setLosses(v, this.blkG, this.blkDamp);
    this.retune(v, stiff);
    this.pluck(v, dead ? Math.min(1, this.pickHard + 0.25) : this.pickHard, vel, same ? 0.4 : 0.1);
    // The hand having moved a few frets squeaks on the string it then frets:
    // decided once per gesture, and only for a quick move.
    if (!dead) {
      const gap = frame - this.lastPlayAt;
      if (gap > 0.08 * this.sr) {
        this.sqArmed = this.handMoved >= 2 && gap < this.sr ? this.handMoved : 0;
        this.handMoved = 0;
      }
      if (this.sqArmed && v.fret > 0.5) { this.squeak(this.sqArmed, vel); this.sqArmed = 0; }
      this.lastPlayAt = frame;
    }
  }

  squeak(dist, vel) {
    if (this.fnoise < 0.005) return;
    const d = Math.min(1, dist / 7);
    this.sqLen = Math.round(this.sr * (0.04 + 0.08 * d));
    this.sqT = 0;
    this.sqF0 = 600 + Math.random() * 300;
    this.sqF1 = this.sqF0 * (1.5 + d + Math.random() * 0.4);
    this.sqLvl = this.fnoise * (0.25 + 0.75 * d) * (0.5 + 0.5 * vel) * 0.5;
    this.sqOn = true;
  }

  // Which string a single note goes on: the one the hand reaches most easily,
  // off a string still held for another note, a repeated note kept on its
  // own string and a slide on the string it left.
  pickString(freq, frame, gliding) {
    let best = -1, bc = 1e18;
    const recent = frame - 0.06 * this.sr;
    for (let s = 0; s < NSTR; s++) {
      const fret = fretOf(s, freq);
      let c = placeCost(fret, this.hand);
      const v = this.voices[s];
      if (v.active) {
        if (Math.abs(fret - v.fret) < 0.3) c -= 1;
        else { if (v.gate) c += 1.5; if (v.struckAt > recent) c += 8; }
      }
      if (gliding && s === this.lastString) c -= 5;
      if (c < bc) { bc = c; best = s; }
    }
    // Under the low E nothing fits: the E string takes it, tuned down (the
    // way a drop tuning or a five-string's B would play it).
    if (bc >= 1e8) best = freq < OPEN_F[0] ? 0 : NSTR - 1;
    this.moveHand(fretOf(best, freq));
    return best;
  }

  moveHand(fret) {
    if (fret < 0.5) return;
    const h0 = this.hand;
    if (fret < this.hand) this.hand = Math.max(1, Math.round(fret));
    else if (fret > this.hand + 3) this.hand = Math.round(fret - 3);
    this.handMoved = Math.max(this.handMoved, Math.abs(this.hand - h0));
  }

  // A double stop or a chord on the strings: low to high, one hand position,
  // as near the hand as it allows (every position, and the cheapest way to
  // lay the notes in order at each). More notes than strings, or a shape no
  // hand could make, goes one note at a time.
  placeChord(k) {
    const ord = this.gOrd;
    for (let i = 0; i < k; i++) ord[i] = i;
    for (let i = 1; i < k; i++) {
      const t = ord[i]; let j = i - 1;
      while (j >= 0 && this.gFreq[ord[j]] > this.gFreq[t]) { ord[j + 1] = ord[j]; j--; }
      ord[j + 1] = t;
    }
    let bestCost = 1e18, bestHand = -1;
    if (k <= NSTR) {
      for (let h = 1; h <= 19; h++) {
        const c = this.layChord(k, h, false) + 0.15 * Math.abs(h - this.hand);
        if (c < bestCost) { bestCost = c; bestHand = h; }
      }
    }
    if (bestHand > 0 && bestCost < 1e8) {
      this.layChord(k, bestHand, true);
      this.handMoved = Math.max(this.handMoved, Math.abs(bestHand - this.hand));
      this.hand = bestHand;
      return;
    }
    for (let i = 0; i < k; i++) this.gStr[ord[i]] = this.pickString(this.gFreq[ord[i]], -1e18, false);
  }

  layChord(k, h, write) {
    const dp = this.dp, from = this.dpFrom, ord = this.gOrd;
    for (let i = 0; i < k; i++) {
      for (let s = 0; s < NSTR; s++) {
        const c = placeCost(fretOf(s, this.gFreq[ord[i]]), h);
        let prev = 0, ps = -1;
        if (i > 0) {
          prev = 1e18;
          for (let t = 0; t < s; t++) if (dp[(i - 1) * NSTR + t] < prev) { prev = dp[(i - 1) * NSTR + t]; ps = t; }
        }
        dp[i * NSTR + s] = c + prev;
        from[i * NSTR + s] = ps;
      }
    }
    let best = 1e18, bs = -1;
    for (let s = 0; s < NSTR; s++) if (dp[(k - 1) * NSTR + s] < best) { best = dp[(k - 1) * NSTR + s]; bs = s; }
    if (write && bs >= 0) {
      for (let i = k - 1; i >= 0; i--) { this.gStr[ord[i]] = bs; bs = from[i * NSTR + bs]; }
    }
    return best;
  }

  // Everything that sounds at one instant. A single note goes on its string
  // (or is hammered or pulled, if it was asked for legato); a double stop is
  // raked low to high by the plucking fingers, a few milliseconds a string.
  playGroup(frame) {
    const k = this.gN;
    if (k === 1) {
      const gl = this.gGlide[0] > 0 || this.glideSec > 0;
      if (this.gLeg[0] && !gl && this.gVel[0] > DEAD_VEL && this.tryLegato(frame)) return;
      this.gStr[0] = this.pickString(this.gFreq[0], frame, gl);
      this.queuePluck(0, frame);
      return;
    }
    this.placeChord(k);
    let vmax = 0; for (let i = 0; i < k; i++) vmax = Math.max(vmax, this.gVel[i]);
    const dt = this.sr * (0.012 - 0.005 * vmax);
    const ord = this.gOrd;
    for (let i = 0; i < k; i++) ord[i] = i;
    for (let i = 1; i < k; i++) {
      const t = ord[i]; let j = i - 1;
      while (j >= 0 && this.gStr[ord[j]] > this.gStr[t]) { ord[j + 1] = ord[j]; j--; }
      ord[j + 1] = t;
    }
    for (let n = 0; n < k; n++) this.queuePluck(ord[n], frame + Math.round(n * dt));
  }

  // A note tied into the next, on the string the last one is on, a few frets
  // away: hammered on (up) or pulled off (down) instead of plucked. Most of
  // the string's ring carries over at the new length, with the tap of the
  // finger, or the small pluck of it pulling away, on top.
  tryLegato(frame) {
    const s = this.lastString;
    if (s < 0) return false;
    const v = this.voices[s];
    if (!v.active || v.dead) return false;
    const f = this.gFreq[0], fret = fretOf(s, f);
    const d = Math.abs(fret - v.fret);
    if (fret < -0.3 || fret > 24.3 || d < 0.5 || d > 5.3) return false;
    const up = f > v.target;
    v.id = this.gId[0]; v.note = this.gNote[0]; v.vel = this.gVel[0];
    v.gate = true; v.relG = 1; v.relAt = -1; v.age = ++this.tick;
    v.target = v.freq = f; v.glide = 1;
    v.fret = Math.max(0, fret);
    v.r = Math.max(0.12, Math.min(1, Math.pow(2, -v.fret / 12)));
    v.struckAt = frame;
    this.lastFreq = f;
    this.moveHand(v.fret);
    this.setLosses(v, this.blkG, this.blkDamp);
    this.retune(v, this.curStiff);
    this.pluck(v, up ? 0.12 : 0.25, v.vel * (up ? 0.3 : 0.45), 0.9);
    return true;
  }

  queuePluck(i, at) {
    if (this.pN >= 8) return;
    const p = this.pN++;
    // A ghost note is struck as hard as a played one; its pitch is choked.
    const dead = this.gVel[i] <= DEAD_VEL;
    this.pAt[p] = at; this.pStr[p] = this.gStr[i]; this.pId[p] = this.gId[i];
    this.pNote[p] = this.gNote[i]; this.pFreq[p] = this.gFreq[i];
    this.pVel[p] = dead ? 0.4 + 4 * this.gVel[i] : this.gVel[i];
    this.pGlide[p] = this.gGlide[i];
    this.pOff[p] = 0; this.pDead[p] = dead ? 1 : 0;
  }

  runPlucks(frame, stiff) {
    let w = 0;
    for (let p = 0; p < this.pN; p++) {
      if (this.pAt[p] <= frame) {
        this.noteOn(this.pStr[p], this.pId[p], this.pNote[p], this.pFreq[p], this.pVel[p], this.pGlide[p], stiff, frame, this.pDead[p] === 1);
        if (this.pOff[p]) this.noteOff(this.pId[p], this.curSustain);
        continue;
      }
      if (w !== p) {
        this.pAt[w] = this.pAt[p]; this.pStr[w] = this.pStr[p]; this.pId[w] = this.pId[p];
        this.pNote[w] = this.pNote[p]; this.pFreq[w] = this.pFreq[p]; this.pVel[w] = this.pVel[p];
        this.pGlide[w] = this.pGlide[p]; this.pOff[w] = this.pOff[p]; this.pDead[w] = this.pDead[p];
      }
      w++;
    }
    this.pN = w;
  }

  // A finger lifting off a note the string is not about to play again: a
  // soft thump, and on a fretted note a moment of the open string before
  // the hand damps it.
  fingerOff(v) {
    const n = this.fnoise;
    if (n < 0.005) return;
    this.thEnv += n * (0.2 + 0.8 * v.vel) * 0.3;
    if (v.fret > 0.5) {
      const keep = 0.25 + 0.4 * n;
      for (const ln of [v.a, v.b]) for (let i = 0; i < DLEN; i++) ln.buf[i] *= keep;
      v.freq = v.target = OPEN_F[v.str]; v.glide = 1;
      v.fret = 0; v.r = 1;
      this.setLosses(v, this.blkG, this.blkDamp);
      this.retune(v, this.curStiff);
    }
  }

  // The loss knobs are per SECOND, not per trip round the loop. A loss filter
  // applied once per period costs a low note fewer passes per second than a
  // high one, so with one coefficient for every note (what this file had) the
  // 20th harmonic of E1 decayed at the same 10dB/s as its fundamental —
  // measured, h1 through h20 all within 2dB/s of each other — and the low
  // strings rang like an organ, while A2's harmonics died six times faster.
  // The physics is the other way about: a string's losses are a rate in time,
  // so the per-trip loss has to scale with the period. Loss in dB per trip
  // goes as sqrt(FREF / f) for the fundamental (so the open E still rings
  // longer than a high note, as it does, just less extravagantly), and the
  // loss filter's coefficient as sqrt(f / FREF), which for a one-pole holds
  // the attenuation per second at a given absolute frequency roughly constant
  // across the neck. The second polarization is lost into the bridge faster.
  setLosses(v, g, damp) {
    const fs = Math.sqrt(v.freq / FREF);
    v.damp = Math.min(0.95, Math.max(0.03, damp * fs));
    v.g = Math.pow(g, 1 / fs);
    // A ghost note: the hand stops the string in a few tens of milliseconds,
    // its top first.
    if (v.dead) {
      v.g = Math.min(v.g, Math.pow(10, -3 / (Math.max(15, v.freq) * 0.06)));
      v.damp = Math.min(0.95, v.damp * 0.35 + 0.02);
    }
    v.a.g = v.g;
    v.b.g = Math.pow(v.g, 2.6);
  }

  // A bass note does not stop when the finger lifts, it damps — and a player's
  // left hand is most of what keeps a bass line from turning to porridge, so
  // the release here is shorter than the guitar's.
  noteOff(id, sustain) {
    for (let p = 0; p < this.pN; p++) if (this.pId[p] === id) this.pOff[p] = 1;
    for (const v of this.voices) {
      if (!v.active || v.id !== id || !v.gate) continue;
      v.gate = false;
      v.relAt = v.dead ? -1 : this.curFrame + Math.round(0.006 * this.sr);
      const T = 0.04 + sustain * 0.4;
      v.relG = Math.exp(-6.9 / Math.max(1, v.freq * T)) / Math.max(1e-6, v.g);
      if (v.relG > 1) v.relG = 1;
    }
  }

  // Tune one polarization to freq: the dispersion cascade for the string's
  // stiffness, then the integer and fractional delay that make up the rest of
  // the period once the cascade's and the loss filter's own delays are paid.
  tuneLine(ln, freq, B, damp) {
    const sr = this.sr;
    const f = Math.max(15, freq);
    const Dtot = sr / f;
    const w0 = 2 * Math.PI * f / sr;
    // Partial nref must sit at nref*f0*sqrt(1 + B*nref*nref): a loop that is
    // Dtot*(1 - 1/sqrt(1 + B*nref*nref)) samples shorter at that frequency.
    const nref = Math.min(10, Math.max(2, Math.floor(0.9 / w0)));
    const drop = Dtot * (1 - 1 / Math.sqrt(1 + B * nref * nref));
    const c = dispCoef(drop, nref * w0, Dtot * 0.35);
    const apD = NAP * (1 - c) / (1 + c);
    const lpD = (1 - damp) / damp;
    let D = Dtot - lpD - apD;
    if (D < 8) D = 8;
    if (D > DLEN - 4) D = DLEN - 4;
    const len = Math.floor(D - 0.1);
    const frac = D - len;
    ln.len = len;
    ln.eta = (1 - frac) / (1 + frac);
    ln.c = c;
  }

  retune(v, stiff) {
    // Bass strings are wound and stiff, so the stretch is a real coefficient:
    // the stiff knob at its default puts a roundwound E around B = 3e-4, which
    // is where the measurements of real ones sit, and a thinner, higher string
    // has less of it. Flatwounds' tops die so fast the clank is barely heard,
    // so the knob buys less on them.
    //
    // It is the coefficient of the STRING the note is on, open, raised as
    // one over the vibrating length squared when it is fretted (to three
    // times at most): a note high on the E string clanks where the same
    // pitch on the G does not.
    const B = stiff * 6.5e-4 * Math.pow(41.2 / OPEN_F[v.str], 0.6) * Math.min(3, 1 / (v.r * v.r)) * (this.flats ? 0.65 : 1);
    this.tuneLine(v.a, v.freq, B, v.damp);
    // The other plane sits a fraction of a hertz up: a slow beat under the
    // note, the same whatever the pitch, as the bridge's asymmetry is.
    this.tuneLine(v.b, v.freq + 0.28, B, v.damp);
    const len = Math.min(v.a.len, v.b.len);
    // The pickup is on the body, so it sits further along a fretted string.
    v.pkTap = Math.max(1, Math.min(len - 1, Math.round(Math.min(0.5, this.pkupPos * 2 / v.r) * len)));
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
    this.fnoise   = kv(P.fnoise);
    this.curSustain = sustain; this.curStiff = stiff;

    const A = AMPS[this.ampModel], C = CABS[this.cabModel], PK = PICKUPS[this.pkupType];

    for (let base = 0; base < N; base += BLK) {
      const blk = Math.min(BLK, N - base);
      const frame = n0 + base;

      const i = base;
      const mute  = P.mute.length  > 1 ? P.mute[i]  : P.mute[0];

      // The losses at FREF (see setLosses for how they reach each note). A
      // bass string rings for a long time: the loop is less lossy than a
      // guitar's. Flats lose their highs almost at once, which is the point of
      // them, and the palm takes both the ring and the top.
      const g = (0.955 + sustain * 0.042) * (1 - mute * 0.2);
      const damp = Math.max(0.03, (this.flats ? 0.11 : 0.23) - mute * 0.1);
      this.blkG = g; this.blkDamp = damp;

      this.curFrame = frame;
      while (this.queue.len && this.queue.headAt() <= frame) {
        const ev = this.queue.shift();
        if (ev.off) { this.noteOff(ev.id, sustain); continue; }
        // Every note-on at this instant is one gesture (a double stop is
        // placed and raked as one).
        const at = ev.at;
        this.gN = 0;
        let e = ev;
        for (;;) {
          if (e.off) this.noteOff(e.id, sustain);
          else if (this.gN < 8) {
            const g = this.gN++;
            this.gId[g] = e.id; this.gNote[g] = e.note; this.gFreq[g] = e.freq;
            this.gVel[g] = e.vel; this.gGlide[g] = e.glide; this.gLeg[g] = e.leg ? 1 : 0;
          }
          if (!this.queue.len || this.queue.headAt() !== at) break;
          e = this.queue.shift();
        }
        this.playGroup(frame);
      }
      if (this.pN) this.runPlucks(frame, stiff);
      for (const v of this.voices) {
        if (v.relAt >= 0 && frame >= v.relAt) { v.relAt = -1; if (v.active && !v.gate) this.fingerOff(v); }
      }
      if (this.allOff !== undefined && frame >= this.allOff) {
        for (const v of this.voices) if (v.gate) this.noteOff(v.id, sustain);
        this.allOff = undefined;
      }

      const drive = P.drive.length > 1 ? P.drive[i] : P.drive[0];
      const tone  = P.tone.length  > 1 ? P.tone[i]  : P.tone[0];
      const comp  = P.comp.length  > 1 ? P.comp[i]  : P.comp[0];
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

      for (const v of this.voices) {
        if (!v.active) continue;
        let re = false;
        if (v.glide < 1) {
          v.freq += (v.target - v.freq) * v.glide;
          if (Math.abs(v.target - v.freq) < 0.02) { v.freq = v.target; v.glide = 1; }
          re = true;
        }
        const d0 = v.damp;
        this.setLosses(v, g, damp);
        if (re || Math.abs(v.damp - d0) > 1e-3) this.retune(v, stiff);
      }

      // The string clatters against the fretboard, which is on one side of it —
      // so the limit is one-sided, and it is inside the loop rather than after
      // it. Slap is this and nothing else.
      const fretLim = fret > 0.001 ? 0.78 - fret * 0.65 : 0;

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
          const dampV = v.damp, relG = v.relG, pkTap = v.pkTap;
          let s = 0;
          for (let side = 0; side < 2; side++) {
            const ln = side ? v.b : v.a;
            const buf = ln.buf, w = ln.w, len = ln.len;
            const xi = buf[(w - len + DLEN) & DMASK];
            const y = ln.eta * (xi - ln.apZ) + ln.apX;
            ln.apX = xi; ln.apZ = y;
            // The dispersion cascade: NAP first-order allpasses at one coefficient.
            const c = ln.c, st = ln.ap;
            let d = y;
            for (let k = 0; k < NAP * 2; k += 2) {
              const x = d;
              d = c * x + st[k] - c * st[k + 1];
              st[k] = x; st[k + 1] = d;
            }
            ln.lp += dampV * (d - ln.lp);
            let fed = ln.lp * ln.g * relG;
            // The fretboard is on one side of the string, and in one plane.
            if (side === 0 && fretLim > 0 && fed < -fretLim) fed = -fretLim + (fed + fretLim) * 0.22;
            if (fed > 4) fed = 4; else if (fed < -4) fed = -4;
            buf[w] = fed;
            ln.w = (w + 1) & DMASK;
            const tap = buf[(w - len + pkTap + DLEN) & DMASK];
            s += (y - tap * 0.78) * (side ? 0.55 : 1);
          }
          const dy = s - v.dcX + 0.9995 * v.dcY;
          v.dcX = s; v.dcY = dy;
          s = dy;
          const as = s < 0 ? -s : s;
          v.env += 0.0008 * (as - v.env);
          if (!v.gate || v.relG < 1) {
            if (v.env < 2e-5) { if (++v.quiet > 3000) { v.active = false; resetLine(v.a); resetLine(v.b); v.env = 0; } }
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

        // ---- the fingers: a squeak along the windings, a lifting thump ----
        if (this.sqOn) {
          const u = this.sqT / this.sqLen;
          if (u >= 1) { this.sqOn = false; this.sqY1 = this.sqY2 = 0; }
          else {
            const sw = Math.sin(Math.PI * u);
            const w = 2 * Math.PI * (this.sqF0 + (this.sqF1 - this.sqF0) * sw) / sr, rr = 0.985;
            const y = 2 * rr * Math.cos(w) * this.sqY1 - rr * rr * this.sqY2 + (Math.random() * 2 - 1);
            this.sqY2 = this.sqY1; this.sqY1 = y;
            mono += y * this.sqLvl * sw * sw * (1 - rr);
            this.sqT++;
          }
        }
        if (this.thEnv > 1e-5) {
          this.thLP += 0.04 * ((Math.random() * 2 - 1) - this.thLP);
          this.thLP2 += 0.04 * (this.thLP - this.thLP2);
          mono += this.thLP2 * this.thEnv;
          this.thEnv *= this.thDecay;
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
  // A note tied into the next asks for that next note legato (a hammer-on or
  // pull-off when it lands on the same string): the silverbox's slide rule.
  let prevEnd = -1, prevTied = false;

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
    trigger: (note, time, dur, vel, opts) => {
      const when = Math.max(Number(time) || 0, ctx.currentTime);
      const span = Math.max(1, Math.round(opts?.span ?? 1));
      const d = Math.max(0.01, Number(dur) || 0.1);
      const legato = prevTied && prevEnd >= 0 && when >= prevEnd - 0.03 && when <= prevEnd + Math.min(0.05, d * 0.35);
      prevEnd = when + d; prevTied = span > 1;
      post({
        type: "note", when, id: ++noteId, note,
        freq: 440 * Math.pow(2, (note - 69) / 12),
        dur: d,
        vel: Math.max(0.05, Math.min(1, vel ?? 1)),
        glide, legato,
      });
    },
    release: (time) => {
      prevTied = false; prevEnd = -1;
      post({ type: "off", when: Math.max(Number(time) || 0, ctx.currentTime) });
    },
  };
}
