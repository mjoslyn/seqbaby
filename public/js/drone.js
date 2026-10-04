// ---- drone: an equation oscillator into a screaming filter and a cloud ----
// Modelled on Maneco Labs' Grone: a drone voice whose oscillator is not a wave
// table or an analogue core but sixteen integer EQUATIONS of a running counter
// (bytebeat), three numbers fed into them (A0 / A1 / A2), and a sample-rate
// control that decides how fast the counter runs. The rest of the box is what
// turns that into an instrument: noise, an MS-20 style lowpass with an LFO on
// its cutoff, and Mutable Instruments' Clouds behind it. The Grone 2 put a
// tap-tempo delay with a reverse mode in front of its reverb; that delay is
// here too, ahead of the cloud.
//
//   EQUATION OSC x6 ─┐   (16 equations, A0 / A1 / A2, rate)
//   (per note, env)  │
//   NOISE ───────────┼─▶ VCF (MS-20 style 12dB, clipped resonance) ─▶ DELAY ─▶ CLOUD ─▶ L/R
//                    │         ▲ MOD1                                  ▲ fwd/rev  (grains, freeze,
//   LFO (8 shapes) ──┴─────────┴────────────────────────────────────────┘           feedback)
//
// - **The oscillator is a counter and a formula.** Each sample the counter `t`
//   advances, the equation is evaluated in 32-bit integers, and its low eight
//   bits are the output — an 8-bit DAC, held between ticks. That is what makes
//   the sound: the terms with a small shift (`t*a`) are pitch, the terms with a
//   large one (`t>>12`) change a few times a second, and the bitwise operators
//   between them are a rhythm and a timbre at once. Most of the sixteen are
//   classic bytebeat shapes with A0 / A1 / A2 standing in for their constants.
// - **The note is the sample rate.** On the hardware the rate knob is the
//   pitch. Here the step's note sets it, so a drone can be sequenced, and the
//   `rate` knob trims it by up to two octaves either way. The counter runs at
//   `256 f / a` ticks a second: every equation's `t*a` term then ramps exactly
//   once per period of the note, so A0 changes how fast the hidden counters run
//   against the pitch rather than retuning the track. Without that, A0 would be
//   a harmonic selector and the default patch would sound four octaves up.
// - **A0 / A1 / A2 are integers**, because they are on the hardware and
//   because a bitwise formula has nothing between 7 and 8. A0 is the
//   multiplier (1..16), A1 and A2 are shifts (2..15). Sweeping one steps; an
//   LFO on one is a sequence.
// - **The filter is the MS-20's character, not a measurement of one**: a
//   12dB/oct state-variable lowpass whose bandpass state is clipped inside the
//   loop, so the resonance screams and then limits itself rather than running
//   away, plus an input drive. The oscillator and filter run 2x oversampled:
//   an 8-bit ramp is nothing but edges, and the clipper in the loop folds what
//   is left over back down.
// - **The LFO is the Grone's eight**: ramp up, ramp down, square, triangle,
//   sine, sweep, random levels, random slopes. It free-runs (a drone has no
//   downbeat to reset on) into the cutoff (MOD1) and, as on the Grone 2, the
//   delay time — which bends the pitch of everything in the delay line.
// - **The delay reverses** with two read heads walking backwards through the
//   line under crossfading triangular windows, the usual reverse-delay
//   construction: each head plays a delay-time-long chunk backwards and the
//   two overlap by half so the seams never show.
// - **The cloud is Clouds' granular mode, simplified**: a four-second record
//   buffer, grains read from it at POSITION back from the write head, SIZE
//   long, PITCHed, at a DENSITY, windowed by TEXTURE, scattered in the stereo
//   field by SPREAD, with FEEDBACK into the buffer and FREEZE to stop
//   recording. Freeze holds whatever was in the buffer for as long as it is
//   on, notes or no notes, which is the drone the hardware is famous for.
//   Not modelled: Clouds' pitch-shifter, looping-delay and spectral modes, its
//   built-in reverb (the rack has one) and the Parasites firmware's extras.
// - **HOLD latches.** A drone in a step sequencer wants one note a bar, held
//   until the next. In `latch` the step's length is ignored and a note sounds
//   until a note arrives at a later instant (notes on the same instant are a
//   chord and are all held), or the transport stops. `gate` is an ordinary
//   synth. With the track's glide up, a latched note SLIDES into the next one
//   instead of crossfading — the voices carry over chord tone by chord tone.
//
// One list, three namespaces, as in hexop.js / guitar.js / subbass.js: every
// panel control is `drn` + a short key, and that short key spells its LFO
// target (`drone_<short>`) and its automation lane (`drone.<short>`). `drn`,
// not `d` or `dr`: `d` is the hexop's, and a prefix that is another engine's
// prefix plus a letter is a collision waiting for its next control.

const DRONE_PROCESSOR_SOURCE = `
const BLK = 16;           // control-block size, at the host rate
const NV = 6;             // notes sounding at once: a held chord and the one it is fading under
const NG = 32;            // grains alive at once
const CLOUD_SEC = 4;      // the cloud's record buffer
const DLY_SEC = 3.2;      // the delay line: 1.5s of time, doubled for reverse
const T0 = 0x5a5a5a;      // where a note's counter starts (see noteOn)

function bq() { return { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0, z1: 0, z2: 0 }; }
function bqRun(f, x) {
  const y = f.b0 * x + f.z1;
  f.z1 = f.b1 * x - f.a1 * y + f.z2;
  f.z2 = f.b2 * x - f.a2 * y;
  return y;
}
function bqLP(f, sr, freq, q) {
  const w = 2 * Math.PI * Math.min(Math.max(freq, 10), sr * 0.45) / sr;
  const c = Math.cos(w), a = Math.sin(w) / (2 * q), n = 1 / (1 + a);
  f.b0 = (1 - c) / 2 * n; f.b1 = (1 - c) * n; f.b2 = (1 - c) / 2 * n;
  f.a1 = -2 * c * n; f.a2 = (1 - a) * n;
}

// ---- the sixteen equations ------------------------------------------------
// t is the counter, a the multiplier (A0), b and c two shifts (A1, A2). Every
// one is dominated by a t*a term so it is pitched at the note (see the
// header); what differs is what the slow terms do to it. Evaluated in int32,
// low eight bits out.
function equation(n, t, a, b, c) {
  const ta = t * a;
  switch (n) {
    case 0:  return ta & (t >> b);                                   // sierpinski
    case 1:  return ta | (t >> b);                                   // or
    case 2:  return ta ^ (t >> b) ^ (t >> c);                        // xor
    case 3:  return (ta & (t >> b)) | (((ta * 3) >> 1) & (t >> c));  // fifths
    case 4:  return ta * ((((t >> b) | (t >> c)) & 3) + 1);          // harmonics
    case 5:  return ta | (t >> b) | (t >> c);                        // smear
    case 6:  return ta % (((t >> b) & 127) + 128);                   // stairs
    case 7:  return ta >> ((t >> b) & 3);                            // octaves
    case 8:  return ta * (((t >> b) & 7) + 1);                       // sweep
    case 9:  return (ta & 128) ^ ((t >> b) & (t >> c) & 127);        // pulse bits
    case 10: return ta & ((t >> b) | (t >> c));                      // gates
    case 11: return ((ta & 255) + (((ta * 5) >> 2) & (t >> b) & 255)) >> 1;  // thirds
    case 12: return (ta * ((0xCA98 >> ((t >> b) & 14)) & 15)) >> 3;  // arp
    case 13: return ta ^ ((ta >> c) & (t >> b));                     // fold
    case 14: return (ta & (t >> b)) | ((ta >> 1) & (t >> c));        // split
    default: return ta ^ ((t * (t >> b)) >> c);                      // chaos
  }
}

// A level trim per equation, so the select is a change of timbre and not of
// level. An OR pushes most of the bits high and an AND most of them low, and
// either way the DC blocker takes what was a full-scale ramp down to a sliver:
// measured across a grid of A0 / A1 / A2 and three octaves, the sixteen spread
// 9dB before this table, and fifteen of them sit within 0.2dB of each other
// after it. Smear stays 4dB under: an OR of three terms holds most bits high
// most of the time, so most of it is DC, and more trim only drives what is
// left into the filter's input clipper.
const EQ_TRIM = [1.87, 2.41, 0.85, 1.01, 0.88, 3.0, 1.14, 0.87,
                 0.87, 0.95, 0.98, 1.52, 0.86, 0.85, 0.98, 0.94];

// ---- the LFO's eight ----------------------------------------------------
// p is the phase 0..1; s0/s1 the random values either side of this cycle.
function lfoShape(shape, p, s0, s1) {
  switch (shape) {
    case 0: return 2 * p - 1;                                  // ramp up
    case 1: return 1 - 2 * p;                                  // ramp down
    case 2: return p < 0.5 ? 1 : -1;                           // square
    case 3: return p < 0.5 ? 4 * p - 1 : 3 - 4 * p;            // triangle
    case 4: return Math.sin(2 * Math.PI * p);                  // sine
    case 5: return 2 * Math.exp(-5 * p) - 1;                   // sweep: a fall each cycle
    case 6: return s1;                                         // random levels
    default: return s0 + (s1 - s0) * p;                        // random slopes
  }
}

// ---- the event queue ------------------------------------------------------
// The same allocation-free queue as subbass.js / bass.js / guitar.js: parallel
// typed arrays, kept in order by inserting from the back, one scratch event
// reused by every shift(). See subbass.js for why each of those matters.
const QCAP = 1024;
class EventQueue {
  constructor() {
    this.at    = new Float64Array(QCAP);
    this.id    = new Float64Array(QCAP);
    this.note  = new Float64Array(QCAP);
    this.freq  = new Float64Array(QCAP);
    this.vel   = new Float64Array(QCAP);
    this.glide = new Float64Array(QCAP);
    this.off   = new Uint8Array(QCAP);
    this.head = 0;
    this.len = 0;
    this.ev = { at: 0, off: false, id: 0, note: 0, freq: 0, vel: 0, glide: 0 };
  }

  _move(d, s) {
    this.at[d] = this.at[s]; this.id[d] = this.id[s]; this.note[d] = this.note[s];
    this.freq[d] = this.freq[s]; this.vel[d] = this.vel[s]; this.glide[d] = this.glide[s];
    this.off[d] = this.off[s];
  }

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
    if (this.len >= QCAP) this.dropOldest();
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

class DroneProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    const a = (name, defaultValue) => ({ name, defaultValue, minValue: 0, maxValue: 1, automationRate: "a-rate" });
    return [
      // The four track sliders: the cutoff and the equation's three numbers.
      // Defaults match the track's own (harm/timb/morph 0.5, decay 0.4).
      a("cut", 0.5), a("a0", 0.5), a("a1", 0.5), a("a2", 0.4),
      // Oscillator and envelope
      a("rate", 0.5), a("osc", 0.8), a("noise", 0), a("atk", 0.3), a("rel", 0.5),
      // VCF
      a("reso", 0.35), a("drive", 0.2), a("mod1", 0.3),
      // LFO
      a("lrate", 0.25), a("ldly", 0),
      // Delay
      a("dtime", 0.45), a("dfbk", 0.45), a("dmix", 0.25),
      // Cloud
      a("cpos", 0.3), a("csize", 0.5), a("cpitch", 0.5), a("cdens", 0.5),
      a("ctex", 0.5), a("cspread", 0.5), a("cfbk", 0.3), a("cmix", 0.35),
    ];
  }

  constructor() {
    super();
    const sr = this.sr = sampleRate;
    this.alive = true;
    this.queue = new EventQueue();
    this.eq = 7; this.latch = 1; this.lshape = 3; this.reverse = 0; this.freeze = 0;
    this.glideSec = 0;

    // ---- voices: one counter and one envelope per held note ----
    this.vOn    = new Uint8Array(NV);      // gate open
    this.vEnv   = new Float64Array(NV);
    this.vPeak  = new Float64Array(NV);
    this.vAtk   = new Uint8Array(NV);      // still attacking
    this.vT     = new Float64Array(NV);    // the counter, fractional
    this.vFreq  = new Float64Array(NV);
    this.vTgt   = new Float64Array(NV);
    this.vGlA   = new Float64Array(NV);    // glide coefficient, 1 = none
    this.vHold  = new Float64Array(NV);    // the DAC's held value
    this.vId    = new Float64Array(NV);
    this.vAge   = new Float64Array(NV);
    this.vPend  = new Uint8Array(NV);      // marked for release by a glide chord
    this.vEnvC  = new Float64Array(NV);    // attack coefficient per voice
    this.age = 0;
    this.lastOnAt = -1;
    this.group = new Int8Array(NV).fill(-1);  // the latched chord, in arrival order
    this.groupLen = 0;
    this.prevGroup = new Int8Array(NV).fill(-1);
    this.prevLen = 0;

    // ---- filter (at 2x) and the decimator back down ----
    this.ic1 = 0; this.ic2 = 0;
    this.dec1 = bq(); this.dec2 = bq();
    bqLP(this.dec1, sr * 2, sr * 0.42, 0.54);
    bqLP(this.dec2, sr * 2, sr * 0.42, 1.31);
    this.fG = 0; this.fK = 1; this.fDrive = 1;
    this.dcX = 0; this.dcY = 0;

    // ---- LFO ----
    this.lPh = 0; this.lS0 = 0; this.lS1 = Math.random() * 2 - 1; this.lfo = 0;

    // ---- delay ----
    this.dLen = Math.ceil(DLY_SEC * sr) + 4;
    this.dBuf = new Float32Array(this.dLen);
    this.dW = 0;
    this.dTime = 0.3 * sr;                 // smoothed, in samples
    this.dRevD = 0.3 * sr;                 // the reverse window, latched per cycle
    this.dRevP = 0;
    this.dOut = 0;

    // ---- cloud ----
    this.cLen = Math.ceil(CLOUD_SEC * sr);
    this.cBuf = new Float32Array(this.cLen);
    this.cW = 0;
    this.cFill = 0;                        // how much of the buffer has been written
    this.gOn  = new Uint8Array(NG);
    this.gPos = new Float64Array(NG);
    this.gInc = new Float64Array(NG);
    this.gLen = new Float64Array(NG);
    this.gAge = new Float64Array(NG);
    this.gL   = new Float64Array(NG);
    this.gR   = new Float64Array(NG);
    this.gTex = new Float64Array(NG);
    this.gNext = 0;                        // samples until the next grain
    this.cOutL = 0; this.cOutR = 0;

    // Silence detection, so an idle drone costs nothing (unless frozen).
    this.quiet = 0;

    this.port.onmessage = (e) => this.onMessage(e.data);
  }

  onMessage(m) {
    if (!m) return;
    if (m.type === "note") {
      if (this.queue.len > 128) this.queue.dropOldest();
      const at = Math.max(0, Math.round(m.when * this.sr));
      this.queue.push(at, false, m.id, 0, m.freq, m.vel, m.glide);
      this.queue.push(at + Math.max(1, Math.round(m.dur * this.sr)), true, m.id, 0, 0, 0, 0);
    } else if (m.type === "off") {
      const at = Math.max(0, Math.round(m.when * this.sr));
      this.queue.keepOffsBefore(at);
      this.allOff = at;
    } else if (m.type === "set") {
      if (m.eq !== undefined) this.eq = Math.max(0, Math.min(15, m.eq | 0));
      if (m.latch !== undefined) {
        // Out of latch, a held note has no note-off coming (it was ignored),
        // so it would hang until the next stop. Let the held ones go.
        const latch = m.latch ? 1 : 0;
        if (this.latch && !latch) this.allNotesOff();
        this.latch = latch;
      }
      if (m.lshape !== undefined) this.lshape = Math.max(0, Math.min(7, m.lshape | 0));
      if (m.reverse !== undefined) this.reverse = m.reverse ? 1 : 0;
      if (m.freeze !== undefined) this.freeze = m.freeze ? 1 : 0;
      if (m.glide !== undefined) this.glideSec = Math.max(0, m.glide);
    } else if (m.type === "dispose") {
      this.alive = false;
    }
  }

  // A free voice, else the quietest one that is releasing, else the oldest.
  pickVoice() {
    let best = -1, bestScore = Infinity;
    for (let v = 0; v < NV; v++) {
      const score = this.vEnv[v] === 0 && !this.vOn[v] ? -1 : (this.vOn[v] ? 10 + this.vAge[v] * 1e-9 : this.vEnv[v]);
      if (score < bestScore) { bestScore = score; best = v; }
    }
    if (bestScore >= 10) {
      // every voice is held: take the oldest
      let old = Infinity;
      for (let v = 0; v < NV; v++) if (this.vAge[v] < old) { old = this.vAge[v]; best = v; }
    }
    return best;
  }

  noteOn(ev, atk) {
    const gl = ev.glide > 0 ? ev.glide : this.glideSec;
    // A new instant in latch mode closes the chord that was held. Notes on the
    // same instant are one chord and all stay.
    if (this.latch && ev.at !== this.lastOnAt) {
      this.prevGroup.set(this.group); this.prevLen = this.groupLen;
      this.group.fill(-1); this.groupLen = 0;
      // Without glide the old chord simply lets go and the new one comes in
      // over its release. With glide its voices are only MARKED: the new
      // chord's tones claim them one by one below, and whatever is left
      // unclaimed when this instant's events are done is released then
      // (process(), after the event loop), since only then is it known how
      // many tones the new chord has.
      for (let v = 0; v < NV; v++) {
        if (!this.vOn[v]) continue;
        if (gl > 0) this.vPend[v] = 1; else this.vOn[v] = 0;
      }
    }
    this.lastOnAt = ev.at;

    // Latched with glide: the k-th tone of this chord takes over the k-th voice
    // of the last one and slides there.
    let v = -1, sliding = false;
    if (this.latch && gl > 0 && this.groupLen < this.prevLen) {
      const cand = this.prevGroup[this.groupLen];
      if (cand >= 0 && this.vPend[cand] && this.vEnv[cand] > 1e-4) { v = cand; sliding = true; }
    }
    if (v < 0) v = this.pickVoice();
    this.vPend[v] = 0;
    if (this.groupLen < NV) this.group[this.groupLen++] = v;

    this.vTgt[v] = ev.freq;
    if (sliding) {
      this.vGlA[v] = 1 - Math.exp(-3 / Math.max(1, gl * this.sr / BLK));
    } else {
      this.vFreq[v] = ev.freq; this.vGlA[v] = 1;
      // Every note starts deep into the counter, not at zero. At zero the
      // slow terms (t >> 12 and the like) are all zeros for seconds, and an
      // equation masked by them is silent until they fill in: four of the
      // sixteen came out 30dB down at the default settings. A fixed start keeps
      // a note the same note every time it is played.
      this.vT[v] = T0;
      // A retrigger starts from the level the voice is at, never from zero.
      const atkT = 0.002 + atk * atk * 12;
      this.vEnvC[v] = 1 - Math.exp(-1 / (atkT * this.sr / 3));
    }
    this.vPeak[v] = 0.45 + ev.vel * 0.55;
    this.vAtk[v] = this.vEnv[v] < this.vPeak[v] ? 1 : 0;
    this.vOn[v] = 1;
    this.vId[v] = ev.id;
    this.vAge[v] = ++this.age;
  }

  // The voices a glide chord marked and nobody claimed.
  releasePending() {
    for (let v = 0; v < NV; v++) if (this.vPend[v]) { this.vPend[v] = 0; this.vOn[v] = 0; }
  }

  noteOff(id) {
    if (this.latch) return;                 // latched notes wait for the next note
    for (let v = 0; v < NV; v++) if (this.vOn[v] && this.vId[v] === id) this.vOn[v] = 0;
  }

  allNotesOff() {
    for (let v = 0; v < NV; v++) { this.vOn[v] = 0; this.vPend[v] = 0; }
    this.groupLen = 0; this.prevLen = 0; this.lastOnAt = -1;
  }

  process(inputs, outputs, params) {
    if (!this.alive) return false;
    const out = outputs[0];
    if (!out || !out.length) return true;
    const oL = out[0], oR = out[1] || out[0];
    const n128 = oL.length;
    const sr = this.sr, sr2 = sr * 2;
    const P = params;
    const startFrame = currentFrame;

    for (let base = 0; base < n128; base += BLK) {
      const blk = Math.min(BLK, n128 - base);
      const i = base;
      const at = startFrame + base;

      if (this.allOff !== undefined && at >= this.allOff) { this.allNotesOff(); this.allOff = undefined; }
      while (this.queue.len && this.queue.headAt() <= at) {
        const ev = this.queue.shift();
        if (ev.off) this.noteOff(ev.id);
        else this.noteOn(ev, this.pv(P, "atk", i));
      }
      this.releasePending();

      let anyVoice = false;
      for (let v = 0; v < NV; v++) if (this.vOn[v] || this.vEnv[v] > 0) { anyVoice = true; break; }
      if (anyVoice) this.quiet = 0;
      // Idle: nothing sounding, the output under -100dB for longer than the
      // cloud's buffer reaches back (so no grain can still find something loud
      // in it, and the delay's longest reverse read is inside that too), and
      // nothing frozen. Skip the lot until a note arrives.
      if (!anyVoice && !this.freeze && this.quiet > sr * (CLOUD_SEC + 1)) {
        for (let s = 0; s < blk; s++) { oL[base + s] = 0; if (oR !== oL) oR[base + s] = 0; }
        continue;
      }

      // ---- control rate ----
      const a  = 1 + Math.min(15, Math.floor(this.pv(P, "a0", i) * 16));
      const b  = 2 + Math.min(13, Math.floor(this.pv(P, "a1", i) * 14));
      const c  = 2 + Math.min(13, Math.floor(this.pv(P, "a2", i) * 14));
      const cut = this.pv(P, "cut", i), reso = this.pv(P, "reso", i), drive = this.pv(P, "drive", i);
      const rateMul = Math.pow(2, (this.pv(P, "rate", i) - 0.5) * 4);
      const oscL = this.pv(P, "osc", i), noiseL = this.pv(P, "noise", i);
      const oscTrim = 0.7 * EQ_TRIM[this.eq];
      const relT = 0.01 + Math.pow(this.pv(P, "rel", i), 2) * 20;
      const relC = Math.exp(-1 / (relT * sr / 3));
      const mod1 = this.pv(P, "mod1", i), ldly = this.pv(P, "ldly", i);
      const lHz = 0.02 * Math.pow(1000, this.pv(P, "lrate", i));      // 0.02Hz .. 20Hz
      const dtime = this.pv(P, "dtime", i), dfbk = this.pv(P, "dfbk", i), dmix = this.pv(P, "dmix", i);
      const cpos = this.pv(P, "cpos", i), csize = this.pv(P, "csize", i), cpitch = this.pv(P, "cpitch", i);
      const cdens = this.pv(P, "cdens", i), ctex = this.pv(P, "ctex", i), cspread = this.pv(P, "cspread", i);
      const cfbk = this.pv(P, "cfbk", i), cmix = this.pv(P, "cmix", i);

      // LFO, advanced once per block: its fastest setting is 20Hz and a block is
      // a third of a millisecond, so the staircase is far below anything heard.
      this.lPh += lHz * blk / sr;
      if (this.lPh >= 1) {
        this.lPh -= Math.floor(this.lPh);
        this.lS0 = this.lS1; this.lS1 = Math.random() * 2 - 1;
      }
      const lfo = this.lfo = lfoShape(this.lshape, this.lPh, this.lS0, this.lS1);

      // VCF coefficients. MOD1 throws the cutoff up to four octaves each way.
      let fc = 50 * Math.pow(2, cut * 8.5 + mod1 * lfo * 4);
      if (fc > sr2 * 0.42) fc = sr2 * 0.42; else if (fc < 20) fc = 20;
      const g = Math.tan(Math.PI * fc / sr2);
      const k = 2 - 1.97 * reso;
      const a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2;
      const driveG = 1 + drive * drive * 9;
      const drvNorm = 1 / (1 + drive * 1.5);

      // Delay time: 20ms .. 1.5s, plus the LFO's push (Grone 2's delay block).
      const dTarget = Math.min(1.5 * sr, Math.max(0.02 * sr,
        (0.02 + dtime * dtime * 1.48) * sr * (1 + ldly * 0.3 * lfo)));

      // Cloud: how often a grain starts, how long one is, how fast it reads.
      const gRate = 0.5 * Math.pow(120, cdens);                 // 0.5 .. 60 / s
      const gLenS = 0.02 * Math.pow(50, csize);                 // 20ms .. 1s
      const gInc = Math.pow(2, (cpitch - 0.5) * 4);             // +/- 2 octaves
      const overlap = Math.max(1, gRate * gLenS);
      const cNorm = 1.6 / Math.sqrt(overlap);

      for (let s = 0; s < blk; s++) {
        // ---- the voices: counter, equation, DAC, at 2x ----
        let x0 = 0, x1 = 0, envMax = 0;
        for (let v = 0; v < NV; v++) {
          if (!this.vOn[v] && this.vEnv[v] === 0) continue;
          if (this.vGlA[v] < 1) {
            this.vFreq[v] += (this.vTgt[v] - this.vFreq[v]) * this.vGlA[v];
            if (Math.abs(this.vTgt[v] - this.vFreq[v]) < 0.001) { this.vFreq[v] = this.vTgt[v]; this.vGlA[v] = 1; }
          }
          if (this.vOn[v]) {
            if (this.vAtk[v]) {
              this.vEnv[v] += this.vEnvC[v] * (this.vPeak[v] * 1.02 - this.vEnv[v]);
              if (this.vEnv[v] >= this.vPeak[v]) { this.vEnv[v] = this.vPeak[v]; this.vAtk[v] = 0; }
            } else this.vEnv[v] += (this.vPeak[v] - this.vEnv[v]) * 0.001;
          } else {
            this.vEnv[v] *= relC;
            if (this.vEnv[v] < 1e-5) { this.vEnv[v] = 0; continue; }
          }
          const env = this.vEnv[v];
          if (env > envMax) envMax = env;
          const step = 256 * this.vFreq[v] * rateMul / a / sr2;
          let t = this.vT[v];
          for (let o = 0; o < 2; o++) {
            const before = Math.floor(t);
            t += step;
            const now = Math.floor(t);
            if (now !== before) {
              const val = equation(this.eq, now, a, b, c) & 255;
              this.vHold[v] = (val - 127.5) / 127.5;
            }
            if (o === 0) x0 += this.vHold[v] * env; else x1 += this.vHold[v] * env;
          }
          if (t >= 16777216) t -= 16777216;
          this.vT[v] = t;
        }

        // ---- noise, riding the loudest note, into the VCF at 2x ----
        let y = 0;
        for (let o = 0; o < 2; o++) {
          let x = (o === 0 ? x0 : x1) * oscL * oscTrim;
          if (noiseL > 0.0005 && envMax > 0) x += (Math.random() * 2 - 1) * noiseL * envMax * 0.5;
          x = x * driveG;
          x = x / (1 + (x < 0 ? -x : x) * 0.5) * drvNorm;
          // TPT state-variable lowpass with the bandpass state clipped in the
          // loop: the resonance screams and then holds its own level instead of
          // running away, which is what the MS-20's diodes do.
          const v3 = x - this.ic2;
          const v1 = a1 * this.ic1 + a2 * v3;
          const v2 = this.ic2 + a2 * this.ic1 + a3 * v3;
          let n1 = 2 * v1 - this.ic1;
          n1 = n1 / (1 + 0.12 * (n1 < 0 ? -n1 : n1));
          this.ic1 = n1;
          this.ic2 = 2 * v2 - this.ic2;
          y = bqRun(this.dec2, bqRun(this.dec1, v2));
        }
        // DC: an 8-bit ramp masked by a slow term is not centred, and a
        // bitwise formula can sit on one value for a second.
        const dc = y - this.dcX + 0.9995 * this.dcY;
        this.dcX = y; this.dcY = dc;
        let sig = dc;

        // ---- delay ----
        this.dTime += (dTarget - this.dTime) * 0.0004;
        let wet;
        if (!this.reverse) {
          let rp = this.dW - this.dTime;
          while (rp < 0) rp += this.dLen;
          const i0 = rp | 0, fr = rp - i0, i1 = i0 + 1 >= this.dLen ? 0 : i0 + 1;
          wet = this.dBuf[i0] + (this.dBuf[i1] - this.dBuf[i0]) * fr;
        } else {
          // Two heads, each walking backwards through a chunk one delay-time
          // long, half a chunk apart, under triangular windows that sum to one.
          const D = this.dRevD;
          wet = 0;
          for (let h = 0; h < 2; h++) {
            let p = this.dRevP + h * D * 0.5;
            if (p >= D) p -= D;
            let rp = this.dW - 2 * p - 1;
            while (rp < 0) rp += this.dLen;
            const w = 1 - Math.abs(2 * p / D - 1);
            wet += this.dBuf[rp | 0] * w;
          }
          this.dRevP += 1;
          if (this.dRevP >= D) { this.dRevP -= D; this.dRevD = Math.max(64, Math.round(this.dTime)); }
        }
        let fb = sig + wet * dfbk * 0.98;
        fb = fb / (1 + (fb < 0 ? -fb : fb) * 0.25);
        this.dBuf[this.dW] = fb;
        this.dW = this.dW + 1 >= this.dLen ? 0 : this.dW + 1;
        sig = sig * (1 - dmix) + wet * dmix;

        // ---- cloud ----
        if (!this.freeze) {
          let rec = sig + (this.cOutL + this.cOutR) * 0.5 * cfbk * 0.9;
          rec = rec / (1 + (rec < 0 ? -rec : rec) * 0.3);
          this.cBuf[this.cW] = rec;
          this.cW = this.cW + 1 >= this.cLen ? 0 : this.cW + 1;
          if (this.cFill < this.cLen) this.cFill++;
        }
        if (--this.gNext <= 0) {
          // Poisson-ish: the mean is the density, the scatter is half of it.
          this.gNext = Math.max(8, Math.round(sr / gRate * (0.5 + Math.random())));
          this.spawnGrain(gLenS, gInc, cpos, cspread, ctex);
        }
        let gl = 0, gr = 0;
        for (let gi = 0; gi < NG; gi++) {
          if (!this.gOn[gi]) continue;
          const x = this.gAge[gi] / this.gLen[gi];
          if (x >= 1) { this.gOn[gi] = 0; continue; }
          const w = this.window(x, this.gTex[gi]);
          let p = this.gPos[gi];
          if (p >= this.cLen) p -= this.cLen;
          const i0 = p | 0, fr = p - i0, i1 = i0 + 1 >= this.cLen ? 0 : i0 + 1;
          const smp = (this.cBuf[i0] + (this.cBuf[i1] - this.cBuf[i0]) * fr) * w;
          gl += smp * this.gL[gi]; gr += smp * this.gR[gi];
          p += this.gInc[gi];
          if (p >= this.cLen) p -= this.cLen;
          this.gPos[gi] = p;
          this.gAge[gi] += 1;
        }
        gl *= cNorm; gr *= cNorm;
        this.cOutL = gl; this.cOutR = gr;

        let l = sig * (1 - cmix) + gl * cmix;
        let r = sig * (1 - cmix) + gr * cmix;
        // A soft ceiling at full scale: a screaming filter into a feedback
        // delay into a feedback cloud can add up, and the rack after this
        // expects sense. Nearly linear at ordinary levels (0.3 comes out 0.29).
        l = l / Math.sqrt(1 + l * l);
        r = r / Math.sqrt(1 + r * r);
        oL[base + s] = l;
        if (oR !== oL) oR[base + s] = r;

        const al = l < 0 ? -l : l;
        if (anyVoice || al > 1e-5) this.quiet = 0; else this.quiet++;
      }
    }
    return true;
  }

  pv(P, name, i) { const p = P[name]; return p.length > 1 ? p[i] : p[0]; }

  spawnGrain(lenS, inc, pos, spread, tex) {
    let gi = -1;
    for (let j = 0; j < NG; j++) if (!this.gOn[j]) { gi = j; break; }
    if (gi < 0) return;
    const len = Math.max(32, Math.round(lenS * this.sr));
    // How far back the grain starts: POSITION across the buffer, scattered by
    // SPREAD, and far enough back that a grain reading faster than the write
    // head never catches it.
    const ahead = Math.max(0, len * (inc - 1));
    const avail = Math.max(0, Math.min(this.cFill, this.cLen) - len * Math.max(1, inc) - 64);
    let back = pos * avail + spread * Math.random() * 0.25 * this.sr + ahead + 64;
    if (back > avail + ahead + 64) back = avail + ahead + 64;
    let p = this.cW - back;
    while (p < 0) p += this.cLen;
    this.gOn[gi] = 1;
    this.gPos[gi] = p;
    this.gInc[gi] = inc;
    this.gLen[gi] = len;
    this.gAge[gi] = 0;
    this.gTex[gi] = tex;
    const pan = 0.5 + spread * (Math.random() - 0.5);
    this.gL[gi] = Math.cos(pan * Math.PI * 0.5);
    this.gR[gi] = Math.sin(pan * Math.PI * 0.5);
  }

  // TEXTURE: from a near-rectangle (hard-edged grains, a buzz), through a
  // triangle at the middle, to a narrowing Hann (soft, sparse, a wash).
  window(x, tex) {
    if (tex < 0.5) {
      const f = 0.03 + tex * 0.94;              // fade fraction, 3% .. 50%
      if (x < f) return x / f;
      if (x > 1 - f) return (1 - x) / f;
      return 1;
    }
    const h = 0.5 - 0.5 * Math.cos(2 * Math.PI * x);
    return Math.pow(h, 1 + (tex - 0.5) * 6);
  }
}

registerProcessor("drone", DroneProcessor);
`;

/** The processor source, for test/drone.test.js — evaluated there against
 *  the worklet globals a test stubs, as reverb.js's is. */
export function droneProcessorSource() { return DRONE_PROCESSOR_SOURCE; }

const _loads = new WeakMap();
const _ready = new WeakSet();

/**
 * Register the drone processor on this context. Called at init() so the await
 * on the play path has already resolved by the time a voice is built.
 * @param {BaseAudioContext} ctx @returns {Promise<void>}
 */
export function loadDroneWorklet(ctx) {
  if (!ctx?.audioWorklet) return Promise.reject(new Error("no AudioWorklet"));
  let p = _loads.get(ctx);
  if (!p) {
    const url = URL.createObjectURL(new Blob([DRONE_PROCESSOR_SOURCE], { type: "text/javascript" }));
    p = ctx.audioWorklet.addModule(url)
      .then(() => { URL.revokeObjectURL(url); _ready.add(ctx); })
      .catch((e) => { URL.revokeObjectURL(url); _loads.delete(ctx); throw e; });
    _loads.set(ctx, p);
  }
  return p;
}

/** Has the processor finished registering on this context? */
export function droneReady(ctx) { return !!ctx && _ready.has(ctx); }

// ---- the panel ----------------------------------------------------------
// Keys are `drn` + short key -> `drone_<short>` / `drone.<short>`. The list,
// the ranges, the defaults and the patches are data in engineData.js;
// re-exported here.
import { DRONE_MOD_KEYS, DRONE_EQUATIONS, DRONE_LFO_SHAPES } from "./engineData.js";
export {
  DRONE_NUM_CTLS, DRONE_SEL_CTLS, DRONE_MOD_KEYS, DRONE_NUM_KEYS, DRONE_SEL_KEYS,
  DRONE_MOD_RANGE, DRONE_MOD_LABELS, DRONE_DEFAULTS, droneFromUnit,
  DRONE_EQUATIONS, DRONE_LFO_SHAPES,
  DRONE_TONE_NAMES, droneToneDescription, droneTone,
} from "./engineData.js";

// Tone wrappers don't accept a native connect() — unwrap to the node underneath.
const nativeIn = (node) => node?.input?.input ?? node?.input ?? node;

/**
 * Build the drone voice. Returns null when the worklet isn't registered yet,
 * so the caller can fall back rather than leave the track silent.
 * @param {*} output Tone node the voice writes into.
 */
export function buildDroneVoice(output) {
  const ctx = Tone.getContext().rawContext;
  if (!droneReady(ctx)) { loadDroneWorklet(ctx).catch(() => {}); return null; }

  let node;
  try {
    node = new AudioWorkletNode(ctx, "drone",
      { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
  } catch (e) {
    console.warn("drone worklet node failed", e);
    return null;
  }
  node.connect(nativeIn(output));

  const PARAM_OF = { harm: "cut", timb: "a0", morph: "a1", decay: "a2" };
  for (const k of DRONE_MOD_KEYS) PARAM_OF[`drn${k}`] = k;

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
      if (key === "drneq")     { post({ type: "set", eq: Math.max(0, DRONE_EQUATIONS.indexOf(String(val))) }); return; }
      if (key === "drnhold")   { post({ type: "set", latch: val !== "gate" }); return; }
      if (key === "drnlshape") { post({ type: "set", lshape: Math.max(0, DRONE_LFO_SHAPES.indexOf(String(val))) }); return; }
      if (key === "drndir")    { post({ type: "set", reverse: val === "reverse" }); return; }
      if (key === "drnfreeze") { post({ type: "set", freeze: val === "on" }); return; }
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
