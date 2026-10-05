// ---- Contagion -------------------------------------------------------
// The contagion is a digital synth, so "modelling" it means its architecture, not
// its circuits — there aren't any. What makes a contagion sound like a contagion is the
// shape of the signal path, and specifically four things nothing else had:
//
//   osc1 ─┐                    ┌─ FILTER 1 (multimode, 2 or 4 pole) ─┐
//   osc2 ─┤                    │              │                      │
//   sub  ─┼─ mix ─▶ routing ──▶┤            SAT stage                ├─ bal ─▶ VCA ─▶ L/R
//   noise─┤                    │              │                      │
//   ring ─┘                    └─ FILTER 2 (multimode, 2 pole) ──────┘
//
// - **Two independent multimode filters** (LP/HP/BP/BS each) that can run in
//   series, in parallel, or split across the stereo field, with a BALANCE knob
//   crossfading their outputs, each with its own resonance, both able to
//   self-oscillate at the top of the knob. Almost every other synth of the era
//   had one filter and one response; the contagion's filter pair is the
//   instrument.
// - **A saturation stage between them.** On the real thing it offers everything
//   from a gentle tube-ish curve to a bit reducer and a pair of one-pole filters
//   (some of them following the note), and it sits *inside* the filter chain,
//   so filter 2 cleans up what the saturator did to filter 1's output. That
//   ordering is why a contagion can be filthy and still controlled.
// - **A continuous oscillator shape morph**, per oscillator. One knob sweeps
//   sine → triangle → saw → pulse, with pulse width taking over at the top.
// - **Unison up to 8** with detune and stereo spread: detuned copies of the
//   whole oscillator section, panned across the field. (Not the TI's HyperSaw,
//   which is a separate oscillator model stacking saws inside one oscillator.)
//
// Osc 1 is the master: osc 2 hard-syncs to it and is frequency-modulated by it,
// as on the hardware. The filter envelope and the amp envelope are separate
// ADSR + sustain slope envelopes (the hardware's ADSTR).
//
// Polyphony lives inside the processor rather than in a `makePolyPool` wrapper.
// That's a real gain beyond tidiness: a pool exposes only voice 0's params to
// modulation (the limitation documented for every other emulator here), while
// one node with one set of AudioParams modulates the whole instrument.
//
// Simplifications, stated plainly: the unison copies share their note's filter
// pair rather than each getting its own (the detune is what you hear, not the
// eight filters); the shape morph crossfades four classic waves rather than
// walking the contagion's 64 spectral wavetables; there is no osc 3; the two
// filters share one envelope amount and a fixed 33% keyfollow; filter slope and
// routing are chosen separately (series with a 4-pole filter 1 is the
// hardware's SER 6, with a 2-pole its SER 4); and there is no oversampling, so
// the saturator aliases, as the hardware's does.

/** @typedef {import("./types.js").Track} Track */

// Processor source. Kept as a string so it travels with the module graph and
// registers from a Blob URL — no extra fetch, no coupling to the versioned
// asset path (same approach as silverbox.js). No backticks or ${ in here.
const CONTAGION_PROCESSOR_SOURCE = `
const MAXV = 8;      // voices
const MAXU = 8;      // unison copies per voice
const BLK  = 16;     // control-block size: envelopes + filter coefficients

// Cheap sine from a phase in [0,1). Two-stage parabola, ~0.2% THD — inaudible
// on an oscillator and far cheaper than Math.sin at 8 voices x 8 unison x 2 osc.
function fsin(ph) {
  const t = ph * 2 - 1;
  const s = 4 * t * (1 - (t < 0 ? -t : t));
  return 0.225 * (s * (s < 0 ? -s : s) - s) + s;
}
// polyBLEP: corrects the step discontinuity of saw/pulse at the wrap point.
function blep(t, dt) {
  if (t < dt) { const x = t / dt; return x + x - x * x - 1; }
  if (t > 1 - dt) { const x = (t - 1) / dt; return x * x + x + x + 1; }
  return 0;
}

// One oscillator sample. shape 0..1 morphs sine -> tri -> saw -> pulse.
// Every wave is derived from the same phase so the crossfades stay coherent.
function oscAt(ph, dt, shape, pw) {
  // saw/pulse read a half-turn ahead so their zero crossing lines up with sine's
  let p = ph + 0.5; if (p >= 1) p -= 1;
  if (shape < 0.3333) {
    const m = shape * 3;
    const tri = ph < 0.25 ? 4 * ph : (ph < 0.75 ? 2 - 4 * ph : 4 * ph - 4);
    return fsin(ph) * (1 - m) + tri * m;
  }
  if (shape < 0.6667) {
    const m = (shape - 0.3333) * 3;
    const tri = ph < 0.25 ? 4 * ph : (ph < 0.75 ? 2 - 4 * ph : 4 * ph - 4);
    const saw = 2 * p - 1 - blep(p, dt);
    return tri * (1 - m) + saw * m;
  }
  const m = (shape - 0.6667) * 3;
  const saw = 2 * p - 1 - blep(p, dt);
  // The pulse falls where the saw falls, at the wrap. Drawn the other way up its
  // odd harmonics are the saw's with the sign flipped, and a third of the way
  // into this crossfade they cancelled outright: the fundamental vanished and
  // the oscillator sounded an octave up.
  let sq = p < pw ? -1 : 1;
  sq -= blep(p, dt);
  let p2 = p - pw; if (p2 < 0) p2 += 1;
  sq += blep(p2, dt);
  return saw * (1 - m) + sq * m;
}

// The saturation stage. Sits between the two filters, exactly where the contagion
// puts it, so filter 2 tidies up whatever this does to filter 1's output.
// st[si..si+4] is one channel's state: held sample, hold counter, one-pole
// state, and the DC blocker's last input and output. k is worked out once per
// control block by satCoef: the DC blocker's pole for the rectifier, the hold
// length for the following rate reducer, the one-pole coefficient for the
// filter curves.
function saturate(x, curve, a, st, si, k) {
  if (curve === 0 || a <= 0.001) return x;
  switch (curve) {
    case 1: {                                   // light — gentle soft knee
      const d = 1 + a * 2;
      return (x * d) / (1 + 0.4 * a * (x < 0 ? -x * d : x * d));
    }
    case 2: {                                   // soft — tanh-ish, more drive
      const d = 1 + a * 6, y = x * d;
      return (y / (1 + (y < 0 ? -y : y))) * (1 + a);
    }
    case 3: {                                   // middle — cubic, between soft and hard
      let y = x * (1 + a * 9);
      if (y > 1.5) y = 1.5; else if (y < -1.5) y = -1.5;
      return y - (y * y * y) / 6.75;
    }
    case 4: {                                   // hard — clipping with a knee
      const d = 1 + a * 12; let y = x * d;
      if (y > 1) y = 1; else if (y < -1) y = -1;
      return y * (1 - a * 0.35);
    }
    case 5: {                                   // digital — brickwall, no knee
      const lim = 1 - a * 0.8; let y = x * (1 + a * 4);
      return y > lim ? lim : (y < -lim ? -lim : y);
    }
    case 6: {                                   // wave shaper — folds back
      const y = x * (1 + a * 5);
      return fsin(((y * 0.25) % 1 + 1) % 1);
    }
    case 7: {                                   // rectifier — full wave, DC removed
      // |x| sits entirely above zero, so on its own it is a DC offset that
      // follows the envelope: a thump on every note. Blocked here, since in
      // parallel and split nothing comes after it, and a lowpass passes DC.
      const r = x < 0 ? -x : x;
      const y = r - st[si + 3] + k * st[si + 4];
      st[si + 3] = r; st[si + 4] = y;
      return x * (1 - a) + y * a * 1.4;
    }
    case 8: {                                   // bit reducer
      const steps = Math.pow(2, 15 - a * 13);
      return Math.round(x * steps) / steps;
    }
    case 9: {                                   // rate reducer (sample + hold)
      const hold = 1 + Math.round(a * 24);
      if (st[si + 1] >= hold) { st[si] = x; st[si + 1] = 0; }
      st[si + 1]++;
      return st[si];
    }
    case 10: {                                  // rate reducer following the note
      st[si + 1] += 1;
      if (st[si + 1] >= k) { st[si + 1] -= k; st[si] = x; }
      return st[si];
    }
    case 11: case 12:                           // one-pole lowpass (12 follows the note)
      st[si + 2] += k * (x - st[si + 2]);
      return st[si + 2];
    case 13: case 14:                           // one-pole highpass (14 follows the note)
      st[si + 2] += k * (x - st[si + 2]);
      return x - st[si + 2];
  }
  return x;
}

// The per-block constant saturate() needs for curves that have one.
function satCoef(curve, a, freq, sr, dcR) {
  if (curve === 7) return dcR;
  if (curve === 10) {
    // At the bottom of the knob 32 holds per period of the note, at the top one.
    const h = sr / (freq * Math.pow(2, (1 - a) * 5));
    return h < 1 ? 1 : h;
  }
  if (curve < 11) return 0;
  let fc;
  if (curve === 11) fc = 20 * Math.pow(2, (1 - a) * 10);        // 20k open .. 20Hz
  else if (curve === 12) fc = freq * Math.pow(2, (1 - a) * 7);  // 128x the note .. the note
  else if (curve === 13) fc = 20 * Math.pow(2, a * 10);         // 20Hz .. 20k
  else fc = freq * Math.pow(2, a * 6 - 2);                      // two octaves under .. four over
  if (fc > sr * 0.45) fc = sr * 0.45;
  return 1 - Math.exp(-2 * Math.PI * fc / sr);
}

// 1/Q of one filter stage. The knob's curve is cubed below 0.9 (see the note in
// process()); above it the damping runs on past zero, so the filter
// self-oscillates at the top, the state clip in svf() holding the level.
const K_OSC = -0.1;
function resoK(r, scale, split) {
  const kOf = (x) => { const q = 0.7 + x * x * x * scale; return split ? 1 / Math.sqrt(q) : 1 / q; };
  if (r <= 0.9) return kOf(r);
  const t = (r - 0.9) / 0.1;
  return kOf(0.9) * (1 - t) + K_OSC * t;
}

// Envelope coefficients, per control block.
function envC(sec, bps) { return 1 - Math.exp(-1 / (sec * bps)); }
// Sustain slope: 0 holds, positive falls towards silence, negative rises
// towards full, from 20s at the edge of the middle to 50ms at the ends.
function slopeC(sl, bps) { return sl === 0 ? 0 : envC(0.05 * Math.pow(400, 1 - (sl < 0 ? -sl : sl)), bps); }

// One envelope step. lvl/stage live on the voice under the names given.
function stepEnv(v, L, S, atkC, decC, susL, relC, sl, slC) {
  const st = v[S];
  if (st === 1) { v[L] += (1.05 - v[L]) * atkC; if (v[L] >= 1) { v[L] = 1; v[S] = 2; } }
  else if (st === 2) { v[L] += (susL - v[L]) * decC; if (Math.abs(v[L] - susL) < 1e-4) v[S] = 3; }
  else if (st === 3) {
    if (sl > 0) v[L] -= v[L] * slC;
    else if (sl < 0) v[L] += (1 - v[L]) * slC;
    else v[L] += (susL - v[L]) * decC;      // follows the sustain knob while held
  }
  else if (st === 4) v[L] -= v[L] * relC;
}

// The voice's output ceiling: straight through up to 0.8, then a knee with a
// matching slope that never passes 1.5. A tanh here coloured a single note
// (its third harmonic 31dB down) and squashed every chord.
function ceil(x) {
  const a = x < 0 ? -x : x;
  if (a <= 0.8) return x;
  const d = a - 0.8, y = 0.8 + d / (1 + d / 0.7);
  return x < 0 ? -y : y;
}

function makeVoice() {
  return {
    id: -1, note: 60, active: false, gate: false, age: 0,
    freq: 440, target: 440, glide: 1,
    vel: 1,
    aStage: 0, amp: 0,        // amp env: 0 idle, 1 atk, 2 dec, 3 sus, 4 rel
    fStage: 0, fenv: 0,       // filter env
    ampOut: 0,                // the gain the last block ended on, ramped from per sample
    ph1: new Float64Array(MAXU), ph2: new Float64Array(MAXU), phS: new Float64Array(MAXU),
    // Each unison copy's oscillators run one sample late, so a sync reset's
    // correction can reach the sample before it (see process()).
    d1: new Float64Array(MAXU), d2: new Float64Array(MAXU),
    det: new Float32Array(MAXU), panL: new Float32Array(MAXU), panR: new Float32Array(MAXU),
    // Filter state, [L,R] x [f1 stage A, f1 stage B, f2] x [ic1eq, ic2eq]
    s: new Float64Array(12),
    // Saturation state per channel: [held, counter, one-pole, dc in, dc out] x 2
    sat: new Float64Array(10),
    // Per-block filter coefficients
    g1: 0, k1: 1, g2: 0, k2: 1,
  };
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
    this.ev = { at: 0, off: false, id: 0, note: 0, freq: 0, vel: 0, glide: 0 };
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
    this.at[i] = at; this.off[i] = off ? 1 : 0; this.id[i] = id;
    this.note[i] = note; this.freq[i] = freq; this.vel[i] = vel; this.glide[i] = glide;
    this.len++;
  }

  headAt() { return this.at[this.head]; }

  shift() {
    const i = this.head, e = this.ev;
    e.at = this.at[i]; e.off = this.off[i] === 1; e.id = this.id[i];
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

class ContagionProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    const a = (name, defaultValue, minValue, maxValue) =>
      ({ name, defaultValue, minValue, maxValue, automationRate: "a-rate" });
    const k = (name, defaultValue, minValue, maxValue) =>
      ({ name, defaultValue, minValue, maxValue, automationRate: "k-rate" });
    return [
      // The four track sliders (shape is osc 1's, decay the amp envelope's)
      a("cutoff", 0.6, 0, 1), a("reso", 0.25, 0, 1), a("shape", 0.66, 0, 1), k("decay", 0.4, 0, 1),
      // Oscillator mix — driven by the shared osc1..osc4 sliders
      a("lvl1", 0.8, 0, 1), a("lvl2", 0.6, 0, 1), a("lvlSub", 0, 0, 1), a("lvlNoise", 0, 0, 1),
      // Oscillator detail
      a("pw", 0.5, 0.02, 0.98), a("shape2", 0.5, 0, 1), a("pw2", 0.5, 0.02, 0.98),
      a("fm", 0, 0, 1), a("ring", 0, 0, 1),
      k("osc2semi", 0, -24, 24), k("osc2det", 0.08, 0, 1),
      // Unison
      a("uniDet", 0.3, 0, 1), k("uniSpread", 0.6, 0, 1),
      // Filters
      a("cut2", 0, -1, 1), a("reso2", 0.5, 0, 1), a("balance", 0, 0, 1), a("satAmt", 0.3, 0, 1),
      a("envAmt", 0.5, -1, 1),
      // Amp envelope (decay is the slider above; these are the rest)
      k("attack", 0.02, 0, 1), k("sustain", 0.6, 0, 1), k("release", 0.25, 0, 1), k("slope", 0, -1, 1),
      // Filter envelope
      k("fattack", 0.02, 0, 1), k("fdecay", 0.4, 0, 1), k("fsustain", 0.6, 0, 1),
      k("frelease", 0.25, 0, 1), k("fslope", 0, -1, 1),
    ];
  }

  constructor() {
    super();
    this.sr = sampleRate;
    this.alive = true;
    this.queue = new EventQueue();
    this.voices = []; for (let i = 0; i < MAXV; i++) this.voices.push(makeVoice());
    this.tick = 0;
    this.lastFreq = 440;      // portamento reference when nothing has played yet
    // Portamento in a chord: the k-th note of a chord glides from the k-th note
    // of the chord before it, not from whichever note was posted just before it.
    this.chordAt = -1;
    this.prevF = new Float64Array(MAXV); this.prevN = 0;
    this.curF = new Float64Array(MAXV); this.curN = 0;
    this.glideSec = 0;
    // The rectifier's DC blocker: a pole for a 10Hz corner.
    this.dcR = 1 - 2 * Math.PI * 10 / this.sr;
    // Discrete settings — messages, not params
    this.mode1 = 0; this.mode2 = 0;   // 0 lp, 1 hp, 2 bp, 3 bs
    this.poles = 4;                   // filter 1: 2 or 4
    this.route = 0;                   // 0 serial, 1 parallel, 2 split
    this.satCurve = 2;
    this.subWave = 0;                 // 0 square, 1 triangle
    this.sync = 0;
    this.uni = 1;
    this.port.onmessage = (e) => this.onMessage(e.data);
  }

  onMessage(m) {
    if (!m) return;
    if (m.type === "note") {
      if (this.queue.len > 128) this.queue.dropOldest();
      const at = Math.max(0, Math.round(m.when * this.sr));
      this.queue.push(at, false, m.id, m.note, m.freq, m.vel, m.glide);
      this.queue.push(at + Math.max(1, Math.round(m.dur * this.sr)), true, m.id, 0, 0, 0, 0);
    } else if (m.type === "off") {
      const at = Math.max(0, Math.round(m.when * this.sr));
      this.queue.keepOffsBefore(at);
      this.allOff = at;
    } else if (m.type === "set") {
      if (m.mode1 !== undefined) this.mode1 = m.mode1 | 0;
      if (m.mode2 !== undefined) this.mode2 = m.mode2 | 0;
      if (m.poles !== undefined) this.poles = m.poles === 2 ? 2 : 4;
      if (m.route !== undefined) this.route = m.route | 0;
      if (m.sat !== undefined) this.satCurve = m.sat | 0;
      if (m.subWave !== undefined) this.subWave = m.subWave | 0;
      if (m.sync !== undefined) this.sync = m.sync ? 1 : 0;
      if (m.uni !== undefined) this.uni = Math.max(1, Math.min(MAXU, m.uni | 0));
      if (m.glide !== undefined) this.glideSec = Math.max(0, m.glide);
    } else if (m.type === "dispose") {
      this.alive = false;
    }
  }

  noteOn(ev) {
    // Free voice, else steal the quietest — a released tail is the least missed.
    let v = null;
    for (const c of this.voices) if (!c.active) { v = c; break; }
    if (!v) {
      let worst = Infinity;
      for (const c of this.voices) { const s = c.gate ? c.amp + 10 : c.amp; if (s < worst) { worst = s; v = c; } }
    }
    const stolen = v.active;
    v.id = ev.id; v.note = ev.note; v.vel = ev.vel;
    v.active = true; v.gate = true; v.age = ++this.tick;
    v.target = ev.freq;
    // Notes landing on one instant are a chord: the k-th takes over from the
    // k-th of the chord before (the last of it, when this one has more notes).
    if (ev.at !== this.chordAt) {
      const t = this.prevF; this.prevF = this.curF; this.curF = t;
      this.prevN = this.curN; this.curN = 0; this.chordAt = ev.at;
    }
    const from = this.prevN ? this.prevF[Math.min(this.curN, this.prevN - 1)] : this.lastFreq;
    if (this.curN < MAXV) this.curF[this.curN++] = ev.freq;
    const gl = ev.glide > 0 ? ev.glide : this.glideSec;
    if (gl > 0) { v.freq = from; v.glide = 1 - Math.exp(-3 / (gl * this.sr / BLK)); }
    else { v.freq = ev.freq; v.glide = 1; }
    this.lastFreq = ev.freq;
    v.aStage = 1; v.fStage = 1;
    // A stolen voice is still sounding, so it keeps its envelope levels, its
    // filter state and its phases: the attack rises from where it is (the
    // envelopes integrate towards their target, so that is free), and the
    // filter and the oscillators stay continuous. Zeroing all of it was a step
    // scaled by whatever the old note was at — a click on every chord past the
    // polyphony. Only a voice that has finished starts from silence.
    if (!stolen) {
      v.amp = 0; v.fenv = 0; v.ampOut = 0;
      v.s.fill(0); v.sat.fill(0); v.d1.fill(0); v.d2.fill(0);
      // Random start phases: eight unison copies launched together would comb.
      for (let u = 0; u < MAXU; u++) {
        v.ph1[u] = Math.random(); v.ph2[u] = Math.random(); v.phS[u] = Math.random();
      }
    }
  }

  noteOff(id) {
    for (const v of this.voices) if (v.active && v.id === id && v.gate) { v.gate = false; v.aStage = 4; v.fStage = 4; }
  }

  process(inputs, outputs, params) {
    if (!this.alive) return false;
    const out = outputs[0];
    if (!out || !out[0]) return true;
    const outL = out[0], outR = out[1] || out[0];
    const N = outL.length;
    outL.fill(0); if (outR !== outL) outR.fill(0);

    const sr = this.sr, n0 = currentFrame;
    const P = params;
    const kv = (p) => p[0];
    const semi = kv(P.osc2semi), det2 = kv(P.osc2det), spread = kv(P.uniSpread);

    // Envelope rates, per control block.
    const bps = sr / BLK;
    const atkT = (x) => Math.max(0.0005, 0.001 * Math.pow(4000, x));
    const decT = (x) => Math.max(0.002, 0.004 * Math.pow(1200, x));
    const relT = (x) => Math.max(0.003, 0.006 * Math.pow(900, x));
    const atkC = envC(atkT(kv(P.attack)), bps), decC = envC(decT(kv(P.decay)), bps);
    const relC = envC(relT(kv(P.release)), bps), susL = kv(P.sustain);
    const sl = kv(P.slope), slC = slopeC(sl, bps);
    const fatkC = envC(atkT(kv(P.fattack)), bps), fdecC = envC(decT(kv(P.fdecay)), bps);
    const frelC = envC(relT(kv(P.frelease)), bps), fsusL = kv(P.fsustain);
    const fsl = kv(P.fslope), fslC = slopeC(fsl, bps);
    const uni = this.uni, uniN = 1 / Math.sqrt(uni);
    const osc2Ratio = Math.pow(2, semi / 12);
    const mode1 = this.mode1, mode2 = this.mode2, poles4 = this.poles === 4;
    const route = this.route, satCurve = this.satCurve, subTri = this.subWave === 1, sync = this.sync;

    for (let base = 0; base < N; base += BLK) {
      const blk = Math.min(BLK, N - base);
      const frame = n0 + base;

      while (this.queue.len && this.queue.headAt() <= frame) {
        const ev = this.queue.shift();
        if (ev.off) this.noteOff(ev.id); else this.noteOn(ev);
      }
      if (this.allOff !== undefined && frame >= this.allOff) {
        for (const v of this.voices) if (v.gate) { v.gate = false; v.aStage = 4; v.fStage = 4; }
        this.allOff = undefined;
      }

      // a-rate params: one read per control block is plenty for these.
      const i = base;
      const rd = (p) => (p.length > 1 ? p[i] : p[0]);
      const cutoffP = rd(P.cutoff), resoP = rd(P.reso), reso2P = rd(P.reso2);
      const shape = rd(P.shape), pw = rd(P.pw), shape2 = rd(P.shape2), pw2 = rd(P.pw2);
      const lvl1 = rd(P.lvl1), lvl2 = rd(P.lvl2), lvlSub = rd(P.lvlSub), lvlNz = rd(P.lvlNoise);
      const fmAmt = rd(P.fm), ringAmt = rd(P.ring), uniDet = rd(P.uniDet);
      const cut2Off = rd(P.cut2), bal = rd(P.balance), satAmt = rd(P.satAmt), envAmt = rd(P.envAmt);

      // Resonance. Cubed rather than squared so the lower half of the slider
      // stays musical: the timb slider defaults to 0.5 for every engine, and a
      // squared curve put that default somewhere only an acid line wants to be.
      // A 4-pole is two 2-pole stages in series, and peaks multiply: giving both
      // stages the full Q would square the resonance, so each gets its root.
      // Past 0.9 the damping heads through zero and the filter self-oscillates.
      const kq1 = resoK(resoP, 12, poles4);
      const kq2 = resoK(reso2P, 9, false);
      const nl1 = resoP > 0.9, nl2 = reso2P > 0.9;
      const wet1 = 1 - bal, wet2 = bal;

      for (const v of this.voices) {
        if (!v.active) continue;

        // ---- envelopes (block rate) ----
        stepEnv(v, "amp", "aStage", atkC, decC, susL, relC, sl, slC);
        if (v.aStage === 4 && v.amp < 1e-4) { v.amp = 0; v.active = false; continue; }
        stepEnv(v, "fenv", "fStage", fatkC, fdecC, fsusL, frelC, fsl, fslC);
        if (v.fStage === 4 && v.fenv < 1e-4) v.fenv = 0;

        // ---- pitch ----
        if (v.glide < 1) { v.freq += (v.target - v.freq) * v.glide; if (Math.abs(v.target - v.freq) < 0.01) { v.freq = v.target; v.glide = 1; } }

        // ---- filter cutoff (33% keyfollow, as a poly synth wants) ----
        const key = (v.note - 60) / 12;
        const oct = cutoffP * 9.2 + envAmt * v.fenv * 5 + key * 0.33;
        let fc1 = 24 * Math.exp(oct * Math.LN2);
        let fc2 = fc1 * Math.exp(cut2Off * 2 * Math.LN2);
        const nyq = sr * 0.47;
        if (fc1 > nyq) fc1 = nyq; else if (fc1 < 20) fc1 = 20;
        if (fc2 > nyq) fc2 = nyq; else if (fc2 < 20) fc2 = 20;
        v.g1 = Math.tan(Math.PI * fc1 / sr);
        v.g2 = Math.tan(Math.PI * fc2 / sr);
        const satK = satCoef(satCurve, satAmt, v.freq, sr, this.dcR);

        // ---- unison layout ----
        for (let u = 0; u < uni; u++) {
          const t = uni === 1 ? 0 : (u / (uni - 1)) * 2 - 1;
          v.det[u] = Math.pow(2, (t * uniDet * 40) / 1200);
          const pan = t * spread;
          v.panL[u] = Math.sqrt((1 - pan) * 0.5);
          v.panR[u] = Math.sqrt((1 + pan) * 0.5);
        }

        const s = v.s, sat = v.sat;
        const a1_1 = 1 / (1 + v.g1 * (v.g1 + kq1)), a2_1 = v.g1 * a1_1, a3_1 = v.g1 * a2_1;
        const a1_2 = 1 / (1 + v.g2 * (v.g2 + kq2)), a2_2 = v.g2 * a1_2, a3_2 = v.g2 * a2_2;
        // The gain is ramped across the block: stepped once per 16 samples, a
        // fast attack or release was a staircase with a 3kHz buzz on it.
        const amp0 = v.ampOut, amp1 = v.amp * v.vel * 0.4, dAmp = (amp1 - amp0) / blk;
        v.ampOut = amp1;

        for (let n = 0; n < blk; n++) {
          let sigL = 0, sigR = 0;
          for (let u = 0; u < uni; u++) {
            const f1 = v.freq * v.det[u];
            const dt1 = f1 / sr, dt2 = f1 * osc2Ratio * (1 + det2 * 0.03) / sr;
            // osc 1 first: it is the master, and it modulates osc 2
            let p1 = v.ph1[u] + dt1, wrapped = false;
            if (p1 >= 1) { p1 -= 1; wrapped = true; }
            const o1 = oscAt(p1, dt1, shape, pw);
            // FM as phase modulation of osc 2 by osc 1
            const fmOff = fmAmt * o1 * 0.5;
            let p2 = v.ph2[u] + dt2, syncH = 0, frac = 0;
            if (sync && wrapped) {
              // Hard sync: osc 2 restarts the instant osc 1 wrapped, which was
              // frac of a sample ago, so it has already run on for that long.
              // The restart is a step, corrected with a polyBLEP across it.
              frac = p1 / dt1;
              let pb = v.ph2[u] + dt2 * (1 - frac) + fmOff; pb -= Math.floor(pb);
              let pa = fmOff; pa -= Math.floor(pa);
              syncH = oscAt(pa, dt2, shape2, pw2) - oscAt(pb, dt2, shape2, pw2);
              p2 = frac * dt2;
            } else if (p2 >= 1) p2 -= 1;
            v.ph1[u] = p1; v.ph2[u] = p2;
            let pm = p2 + fmOff; pm -= Math.floor(pm);
            let o2 = oscAt(pm, dt2, shape2, pw2);
            // Both oscillators sound a sample late, so half the step's
            // correction can still go on the sample before it.
            const a1 = v.d1[u];
            let a2 = v.d2[u];
            if (syncH !== 0) {
              const h = syncH * 0.5;
              a2 += h * frac * frac;
              o2 -= h * (1 - frac) * (1 - frac);
            }
            v.d1[u] = o1; v.d2[u] = o2;
            let mix = a1 * lvl1 + a2 * lvl2 + a1 * a2 * ringAmt;
            if (lvlSub > 0) {
              const dts = dt1 * 0.5;
              let ps = v.phS[u] + dts; if (ps >= 1) ps -= 1;
              v.phS[u] = ps;
              let sub;
              if (subTri) {
                sub = ps < 0.25 ? 4 * ps : (ps < 0.75 ? 2 - 4 * ps : 4 * ps - 4);
              } else {
                sub = ps < 0.5 ? 1 : -1;
                sub += blep(ps, dts);
                let pq = ps - 0.5; if (pq < 0) pq += 1;
                sub -= blep(pq, dts);
              }
              mix += sub * lvlSub;
            }
            sigL += mix * v.panL[u];
            sigR += mix * v.panR[u];
          }
          sigL *= uniN; sigR *= uniN;
          if (lvlNz > 0) {
            // Squared taper: osc4 is a shared slider that defaults to 0.4 for
            // every engine, and linear noise at 0.4 would hiss over the top of
            // the patch. Full scale is still full scale.
            const nz = lvlNz * lvlNz;
            sigL += (Math.random() * 2 - 1) * nz;
            sigR += (Math.random() * 2 - 1) * nz;
          }

          const amp = amp0 + dAmp * (n + 1);
          // ---- filter pair, per channel ----
          for (let ch = 0; ch < 2; ch++) {
            const o = ch * 6, si = ch * 5;
            let x = ch === 0 ? sigL : sigR;
            // filter 1 (one or two SVF stages)
            let y1 = svf(x, s, o, a1_1, a2_1, a3_1, kq1, mode1, nl1);
            if (poles4) y1 = svf(y1, s, o + 2, a1_1, a2_1, a3_1, kq1, mode1, nl1);
            let y;
            if (route === 0) {
              // serial: 1 -> saturation -> 2, balance blends pre/post filter 2
              const d = saturate(y1, satCurve, satAmt, sat, si, satK);
              const y2 = svf(d, s, o + 4, a1_2, a2_2, a3_2, kq2, mode2, nl2);
              y = d * wet1 + y2 * wet2;
            } else if (route === 1) {
              // parallel: both filters see the same source, balance crossfades
              const y2 = svf(x, s, o + 4, a1_2, a2_2, a3_2, kq2, mode2, nl2);
              y = saturate(y1, satCurve, satAmt, sat, si, satK) * wet1 + y2 * wet2;
            } else {
              // split: filter 1 to the left, filter 2 to the right
              y = ch === 0
                ? saturate(y1, satCurve, satAmt, sat, 0, satK)
                : svf(x, s, o + 4, a1_2, a2_2, a3_2, kq2, mode2, nl2);
            }
            if (ch === 0) outL[base + n] += y * amp; else outR[base + n] += y * amp;
          }
        }
      }
    }

    // Output ceiling — eight voices of unison stack up fast.
    for (let n = 0; n < N; n++) {
      outL[n] = ceil(outL[n]);
      if (outR !== outL) outR[n] = ceil(outR[n]);
    }
    return true;
  }
}

// Topology-preserving state-variable filter. One structure, all four responses,
// which is exactly what a multimode filter needs. With nl set (resonance in its
// self-oscillating range) the band-pass integrator is soft-clipped: with the
// damping below zero the loop gains energy every cycle, and the clip is what
// settles it into a steady sine instead of letting it run away.
function svf(v0, s, o, a1, a2, a3, k, mode, nl) {
  const ic1 = s[o], ic2 = s[o + 1];
  const v3 = v0 - ic2;
  const v1 = a1 * ic1 + a2 * v3;
  const v2 = ic2 + a2 * ic1 + a3 * v3;
  let n1 = 2 * v1 - ic1;
  if (nl) n1 = n1 / Math.sqrt(1 + n1 * n1 * 0.25);
  s[o] = n1;
  s[o + 1] = 2 * v2 - ic2;
  if (mode === 0) return v2;                 // low pass
  if (mode === 1) return v0 - k * v1 - v2;   // high pass
  if (mode === 2) return v1;                 // band pass
  return v0 - k * v1;                        // band stop
}

registerProcessor("contagion", ContagionProcessor);
`;

// One registration per AudioContext, single-flight; a failure clears the slot
// so the next attempt retries (same contract as the Plaits and silverbox worklets).
const _loads = new WeakMap();
const _ready = new WeakSet();

/**
 * Register the contagion processor on this context. Called at init() so the
 * await on the play path has already resolved by the time a voice is built.
 * @param {BaseAudioContext} ctx @returns {Promise<void>}
 */
export function loadContagionWorklet(ctx) {
  if (!ctx?.audioWorklet) return Promise.reject(new Error("no AudioWorklet"));
  let p = _loads.get(ctx);
  if (!p) {
    const url = URL.createObjectURL(new Blob([CONTAGION_PROCESSOR_SOURCE], { type: "text/javascript" }));
    p = ctx.audioWorklet.addModule(url)
      .then(() => { URL.revokeObjectURL(url); _ready.add(ctx); })
      .catch((e) => { URL.revokeObjectURL(url); _loads.delete(ctx); throw e; });
    _loads.set(ctx, p);
  }
  return p;
}

/** Has the processor finished registering on this context? */
export function contagionReady(ctx) { return !!ctx && _ready.has(ctx); }
// The panel's key lists and defaults are data, in engineData.js (readable from
// Node); re-exported so the imports elsewhere in the engine are unchanged.
export { CONTAGION_NUM_KEYS, CONTAGION_SEL_KEYS, CONTAGION_DEFAULTS } from "./engineData.js";

const FILTER_MODES = { lp: 0, hp: 1, bp: 2, bs: 3 };
const ROUTES = { ser: 0, par: 1, split: 2 };
// Stored by NAME (the select's value), so the numbers here are free to move.
const SAT_CURVES = {
  off: 0, light: 1, soft: 2, middle: 3, hard: 4, digital: 5, shaper: 6, rectify: 7, bits: 8, rate: 9,
  ratefollow: 10, lowpass: 11, lowfollow: 12, highpass: 13, highfollow: 14,
};

// Tone wrappers don't accept a native connect() — unwrap to the node underneath.
const nativeIn = (node) => node?.input?.input ?? node?.input ?? node;

/**
 * Build the contagion voice. Returns null when the worklet isn't registered yet, so
 * the caller can fall back rather than leave the track silent.
 * @param {*} output Tone node the voice writes into.
 */
export function buildContagionVoice(output) {
  const ctx = Tone.getContext().rawContext;
  if (!contagionReady(ctx)) { loadContagionWorklet(ctx).catch(() => {}); return null; }

  let node;
  try {
    node = new AudioWorkletNode(ctx, "contagion",
      { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
  } catch (e) {
    console.warn("contagion worklet node failed", e);
    return null;
  }
  node.connect(nativeIn(output));

  const P = {};
  for (const n of ["cutoff", "reso", "shape", "decay", "lvl1", "lvl2", "lvlSub", "lvlNoise",
                   "pw", "shape2", "pw2", "fm", "ring", "osc2semi", "osc2det", "uniDet", "uniSpread",
                   "cut2", "reso2", "balance", "satAmt", "envAmt", "attack", "sustain", "release", "slope",
                   "fattack", "fdecay", "fsustain", "frelease", "fslope"]) {
    P[n] = node.parameters.get(n);
  }
  const num = (v, lo, hi) => Math.max(lo, Math.min(hi, Number(v) || 0));
  const post = (m) => { try { node.port.postMessage(m); } catch {} };

  let noteId = 0;
  let glide = 0;

  return {
    nodes: [{ dispose() { try { node.port.postMessage({ type: "dispose" }); } catch {} try { node.disconnect(); } catch {} } }],
    setGlide: (g) => { glide = Math.max(0, Number(g) || 0); post({ type: "set", glide }); },
    setParam: (key, val) => {
      switch (key) {
        // The four track sliders
        case "harm":   P.cutoff.value = num(val, 0, 1); return;
        case "timb":   P.reso.value   = num(val, 0, 1); return;
        case "morph":  P.shape.value  = num(val, 0, 1); return;
        case "decay":  P.decay.value  = num(val, 0, 1); return;
        // Shared osc-mix sliders: osc1 / osc2 / sub / noise
        case "osc1":   P.lvl1.value     = num(val, 0, 1); return;
        case "osc2":   P.lvl2.value     = num(val, 0, 1); return;
        case "osc3":   P.lvlSub.value   = num(val, 0, 1); return;
        case "osc4":   P.lvlNoise.value = num(val, 0, 1); return;
        // Contagion group — numeric
        case "vosc2semi":  P.osc2semi.value  = num(val, -24, 24); return;
        case "vosc2det":   P.osc2det.value   = num(val, 0, 1); return;
        case "vpw":        P.pw.value        = num(val, 0.02, 0.98); return;
        case "vshape2":    P.shape2.value    = num(val, 0, 1); return;
        case "vpw2":       P.pw2.value       = num(val, 0.02, 0.98); return;
        case "vfm":        P.fm.value        = num(val, 0, 1); return;
        case "vring":      P.ring.value      = num(val, 0, 1); return;
        case "vunidet":    P.uniDet.value    = num(val, 0, 1); return;
        case "vunispread": P.uniSpread.value = num(val, 0, 1); return;
        case "vcut2":      P.cut2.value      = num(val, -1, 1); return;
        case "vreso2":     P.reso2.value     = num(val, 0, 1); return;
        case "vbal":       P.balance.value   = num(val, 0, 1); return;
        case "vsatamt":    P.satAmt.value    = num(val, 0, 1); return;
        case "venvamt":    P.envAmt.value    = num(val, -1, 1); return;
        case "vatk":       P.attack.value    = num(val, 0, 1); return;
        case "vsus":       P.sustain.value   = num(val, 0, 1); return;
        case "vrel":       P.release.value   = num(val, 0, 1); return;
        case "vslope":     P.slope.value     = num(val, -1, 1); return;
        case "vfatk":      P.fattack.value   = num(val, 0, 1); return;
        case "vfdec":      P.fdecay.value    = num(val, 0, 1); return;
        case "vfsus":      P.fsustain.value  = num(val, 0, 1); return;
        case "vfrel":      P.frelease.value  = num(val, 0, 1); return;
        case "vfslope":    P.fslope.value    = num(val, -1, 1); return;
        // Contagion group — discrete
        case "vmode1":   post({ type: "set", mode1: FILTER_MODES[val] ?? 0 }); return;
        case "vmode2":   post({ type: "set", mode2: FILTER_MODES[val] ?? 0 }); return;
        case "vpoles":   post({ type: "set", poles: Number(val) === 2 ? 2 : 4 }); return;
        case "vroute":   post({ type: "set", route: ROUTES[val] ?? 0 }); return;
        case "vsat":     post({ type: "set", sat: SAT_CURVES[val] ?? 2 }); return;
        case "vsubwave": post({ type: "set", subWave: val === "triangle" ? 1 : 0 }); return;
        case "vsync":    post({ type: "set", sync: val === "on" ? 1 : 0 }); return;
        case "vuni":     post({ type: "set", uni: Number(val) || 1 }); return;
      }
    },
    getAudioParam: (key) => {
      switch (key) {
        case "harm":  return P.cutoff;
        case "timb":  return P.reso;
        case "morph": return P.shape;
        case "decay": return P.decay;
        case "osc1":  return P.lvl1;
        case "osc2":  return P.lvl2;
        case "osc3":  return P.lvlSub;
        case "osc4":  return P.lvlNoise;
        case "noise": return P.lvlNoise;
        // Contagion-only mod targets, reached under their own keys
        case "vpw":        return P.pw;
        case "vshape2":    return P.shape2;
        case "vpw2":       return P.pw2;
        case "vfm":        return P.fm;
        case "vring":      return P.ring;
        case "vunidet":    return P.uniDet;
        case "vcut2":      return P.cut2;
        case "vreso2":     return P.reso2;
        case "vbal":       return P.balance;
        case "vsatamt":    return P.satAmt;
        case "venvamt":    return P.envAmt;
        // The rest of the panel's sliders. These are k-rate (they only matter
        // per control block), which an LFO connection and an automation ramp
        // both handle — the value is just sampled once per block.
        case "vosc2semi":  return P.osc2semi;
        case "vosc2det":   return P.osc2det;
        case "vunispread": return P.uniSpread;
        case "vatk":       return P.attack;
        case "vsus":       return P.sustain;
        case "vrel":       return P.release;
        case "vslope":     return P.slope;
        case "vfatk":      return P.fattack;
        case "vfdec":      return P.fdecay;
        case "vfsus":      return P.fsustain;
        case "vfrel":      return P.frelease;
        case "vfslope":    return P.fslope;
      }
      return null;
    },
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
