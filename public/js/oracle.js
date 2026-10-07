// ---- oracle: the poly analog -------------------------------------------------
// Modelled on the Prophet-6's signal path, in the places a Tone.js pool could
// not reach. What this engine was: two phase-locked Tone oscillators (VCO 2 a
// saw/pulse crossfade, its pulse thresholded from a saw and so not
// band-limited), a Tone.Distortion blended in parallel (which cut the level
// 7dB at full "drive" and changed the spectrum by 2dB) and a chorus that
// could not be turned off. Measured, the two VCOs at the default detune
// summed to exactly 2.00x one of them: one louder saw, never two
// oscillators. That is the one thing a poly analog must not do.
//
//   VCO 1 (shape, width) ─┐
//   VCO 2 (shape, width, ├─ MIXER ─▶ VCA (ADSR) ─┐
//          detune)       │                       │  x6 voices
//   SUB (square, -1 oct) ┤                       │
//   NOISE ───────────────┘                       ▼
//                              Σ ─▶ DRIVE (gain, knee, 2x) ─▶ CHORUS (stereo) ─▶ L/R
//
// - **Free-running oscillators with slop.** Every VCO starts a note at a
//   random phase, and each voice carries its own fixed tuning offset per VCO
//   (the calibration spread between six analog voice cards) plus a slow
//   random walk, both scaled by `slop`. Two VCOs at the same pitch therefore
//   beat, and a chord has six voices that are not copies of each other.
//   Measured: the same note rendered twice is never sample-identical, and
//   the sum of the two VCOs at the default detune averages the uncorrelated
//   1.41x rather than the phase-locked 2.00x.
// - **The shape is a morph, on both VCOs**: triangle to saw to pulse across
//   one knob, the pulse's width on a knob of its own per VCO, as on the
//   machine. VCO 1's shape used to be a fixed saw. The waves are polyBLEP, so
//   the pulse at E5 aliases at -40dB where the thresholded one did at -19.
// - **The drive is after the VCAs, on the summed voices**, which is where
//   the machine's distortion circuit is (post-VCA, one circuit for the
//   instrument). A chord intermodulates through it, a release tail falls
//   out of it: a gain into a knee, 2x oversampled, with a small bias for the
//   even harmonics, normalised so one note at the default mixer keeps its
//   level however far the knob is turned. At zero the stage is a wire below
//   the knee. The track's own filter follows it, which is the simplification
//   stated below.
// - **The chorus is a knob**, zero meaning none; two taps of one delay line
//   under a slow sine in antiphase, equal-power against the dry, on the sum.
//   It was six Tone.Chorus instances, one per pool voice, at a fixed mix.
// - **The envelope is an ADSR**: the decay slider keeps its old range, the
//   attack, sustain and release are the panel's. A sound from before the
//   model (no `orcv` marker) gets the release the old decay slider implied,
//   no slop, and its old shape and drive knobs mapped onto the new ones so it
//   plays as it did; see migrateOracleModel in sessionFormat.js.
// - **Six voices, stolen quietest first**, a glide per voice from whatever
//   it last played, which is how the machine glides in poly mode.
// - **Simplifications**: no filter inside the voice (the track's filter
//   stands in; its `poly` character is the chip ladder the machine's filter
//   is), so the drive sits before the filter rather than after it; no hard
//   sync, no poly mod, no unison mode; one LFO is the track's matrix. The
//   slop, drive and chorus figures are reasoned, not measured against a unit.
//
// The processor source is a string registered from a Blob URL, like every
// other worklet here. Keep backticks and `${` out of it.

const ORACLE_PROCESSOR_SOURCE = `
const NV = 6;
const BLK = 16;
const QCAP = 1024;

// A rational tanh: within 1% of the real one to |x| 2.5, pinned past 3.
function tanhA(x) {
  if (x > 3) return 1;
  if (x < -3) return -1;
  const x2 = x * x;
  return x * (27 + x2) / (27 + 9 * x2);
}
// polyBLEP corrector for a discontinuity at phase 0.
function blep(t, dt) {
  if (t < dt) { const x = t / dt; return x + x - x * x - 1; }
  if (t > 1 - dt) { const x = (t - 1) / dt; return x * x + x + x + 1; }
  return 0;
}
// The output stage's knee: a wire to 0.75, a smooth bend to 1.
function knee(x) {
  const a = x < 0 ? -x : x;
  if (a <= 0.75) return x;
  const y = 0.75 + 0.25 * tanhA((a - 0.75) * 4);
  return x < 0 ? -y : y;
}

// ---- the event queue ------------------------------------------------------
// The same allocation-free queue as ladder.js / siege.js: parallel typed
// arrays, kept in order by inserting from the back, one scratch event reused
// by every shift().
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

// ---- the waves --------------------------------------------------------------
// One phase, three shapes: triangle, saw, pulse. The shape knob crossfades
// triangle to saw over its first half and saw to pulse over its second, so
// 0.5 is a saw. The pulse's width is 0.5 (a square) to 0.95, and its own DC
// is taken off so the mix does not shift with the knob.
// **The pulse falls where the saw falls** (at phase 0), the contagion's rule:
// drawn the other way up, its odd harmonics are the saw's negated, and
// halfway across the crossfade the fundamental is half gone (measured: the
// 2nd harmonic of the mix came out at the saw's own -6dB, which is the
// fundamental cancelling, not the 2nd growing).
function morphWave(s, p, dt, pw) {
  const saw = 2 * p - 1 - blep(p, dt);
  if (s <= 0.5) {
    const a = s * 2;
    if (a >= 1) return saw;
    const tri = 1 - 4 * Math.abs(p - 0.5);
    return tri + (saw - tri) * a;
  }
  const a = (s - 0.5) * 2;
  let q = p < pw ? -1 : 1;
  q -= blep(p, dt);
  let p2 = p - pw; if (p2 < 0) p2 += 1;
  q += blep(p2, dt);
  q -= 1 - 2 * pw;
  return saw + (q - saw) * a;
}
function squareWave(p, dt) {
  let q = p < 0.5 ? -1 : 1;
  q -= blep(p, dt);
  let p2 = p - 0.5; if (p2 < 0) p2 += 1;
  return q + blep(p2, dt);
}

class Voice {
  constructor() {
    this.ph = new Float64Array(3);        // vco 1, vco 2, sub
    this.dt = new Float64Array(3);
    // The voice card's own calibration: a fixed offset per VCO, drawn once,
    // in units of the slop span. Six cards, six different pairs.
    this.cal = new Float64Array(2);
    this.cal[0] = Math.random() * 2 - 1; this.cal[1] = Math.random() * 2 - 1;
    this.drift = new Float64Array(2);
    this.driftT = new Float64Array(2);
    this.env = 0; this.stage = 0;         // 0 idle 1 attack 2 decay 3 release
    this.logF = Math.log2(261.63); this.logT = this.logF; this.glideC = 1;
    this.id = 0; this.held = false; this.vel = 1; this.age = 0;
  }
  active() { return this.stage !== 0; }
}

class OracleProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    const a = (name, defaultValue) => ({ name, defaultValue, minValue: 0, maxValue: 1, automationRate: "a-rate" });
    const k = (name, defaultValue) => ({ name, defaultValue, minValue: 0, maxValue: 1, automationRate: "k-rate" });
    return [
      // The four track sliders: detune / VCO 2 shape / drive / decay.
      a("detune", 0.5), a("shape2", 0.5), a("drive", 0.5), k("decay", 0.4),
      // The mixer: VCO 1, VCO 2, the sub, the noise.
      k("osc1", 0.55), k("osc2", 0.45), k("osc3", 0.35), k("osc4", 0.4),
      // The panel.
      k("shape1", 0.5), k("pw1", 0), k("pw2", 0), k("slop", 0.2), k("chorus", 0.22),
      k("atk", 0.17), k("sus", 0.7), k("rel", 0.68),
    ];
  }

  constructor() {
    super();
    const sr = this.sr = sampleRate;
    this.sr2 = sr * 2;
    this.alive = true;
    this.queue = new EventQueue();
    this.voices = [];
    for (let i = 0; i < NV; i++) this.voices.push(new Voice());
    this.glideSec = 0;
    // The noise, once per block for every voice, at 2x.
    this.nz = new Float64Array(BLK * 2);
    // The 2x sum and its decimator (2-pole Butterworth at 0.45 sr).
    this.bus = new Float64Array(BLK * 2);
    const wc = Math.tan(Math.PI * 0.45 * sr / this.sr2);
    const kk = Math.SQRT2 * wc, w2 = wc * wc, a0 = 1 + kk + w2;
    this.db0 = w2 / a0; this.db1 = 2 * this.db0; this.db2 = this.db0;
    this.da1 = (2 * (w2 - 1)) / a0; this.da2 = (1 - kk + w2) / a0;
    this.dx1 = 0; this.dx2 = 0; this.dy1 = 0; this.dy2 = 0;
    this.dcX = 0; this.dcY = 0;
    // The chorus: one line, two taps in antiphase, 1x.
    this.cLen = Math.ceil(0.03 * sr);
    this.cBuf = new Float64Array(this.cLen);
    this.cW = 0;
    this.cPh = 0;
    this.cRate = 0.45 / sr;
    this.cBase = 0.0028 * sr; this.cDepth = 0.0009 * sr;
    this.quiet = 0;                       // 1x samples of silence into the chorus
    this.allOff = undefined;
    this.port.onmessage = (e) => this.onMessage(e.data);
  }

  onMessage(m) {
    if (!m) return;
    if (m.type === "note") {
      if (this.queue.len > 256) this.queue.dropOldest();
      const at = Math.max(0, Math.round(m.when * this.sr));
      this.queue.push(at, false, m.id, m.note, m.freq, m.vel, m.glide);
      this.queue.push(at + Math.max(1, Math.round(m.dur * this.sr)), true, m.id, 0, 0, 0, 0);
    } else if (m.type === "off") {
      const at = Math.max(0, Math.round(m.when * this.sr));
      this.queue.keepOffsBefore(at);
      this.allOff = at;
    } else if (m.type === "set") {
      if (m.glide !== undefined) this.glideSec = Math.max(0, +m.glide || 0);
    } else if (m.type === "dispose") {
      this.alive = false;
    }
  }

  noteOn(ev) {
    const glide = ev.glide > 0 ? ev.glide : this.glideSec;
    // A free voice, else the quietest one being stolen.
    let pick = -1;
    for (let i = 0; i < NV; i++) if (!this.voices[i].active()) { pick = i; break; }
    if (pick < 0) {
      let best = Infinity;
      for (let i = 0; i < NV; i++) {
        const v = this.voices[i];
        const score = (v.held ? 10 : 0) + v.env;
        if (score < best) { best = score; pick = i; }
      }
    }
    const v = this.voices[pick];
    const was = v.stage !== 0;
    v.logT = Math.log2(ev.freq);
    if (!was || glide <= 0) { v.logF = v.logT; v.glideC = 1; }
    else v.glideC = 1 - Math.exp(-3 / Math.max(1, glide * this.sr / BLK));
    v.id = ev.id; v.held = true; v.vel = ev.vel; v.age = 0;
    // Free-running oscillators: a note finds them wherever they are. A voice
    // still ringing keeps its phases (no step in the wave); an idle one is
    // given fresh random ones, which is the same thing cheaper.
    if (!was) { v.ph[0] = Math.random(); v.ph[1] = Math.random(); v.ph[2] = Math.random(); }
    // An analog envelope retriggers from where it is.
    v.stage = 1;
  }

  noteOff(id) {
    for (const v of this.voices) if (v.held && v.id === id) v.held = false;
  }

  releaseAll() {
    for (const v of this.voices) v.held = false;
  }

  process(inputs, outputs, params) {
    if (!this.alive) return false;
    const out = outputs[0];
    if (!out || !out.length) return true;
    const oL = out[0], oR = out.length > 1 ? out[1] : null;
    const n128 = oL.length;
    const sr = this.sr, sr2 = this.sr2;
    const P = params;
    const startFrame = currentFrame;
    const kv = (p) => p[0];

    for (let base = 0; base < n128; base += BLK) {
      const blk = Math.min(BLK, n128 - base);
      const at = startFrame + base;
      if (this.allOff !== undefined && at >= this.allOff) { this.releaseAll(); this.allOff = undefined; }
      while (this.queue.len && this.queue.headAt() <= at) {
        const ev = this.queue.shift();
        if (ev.off) this.noteOff(ev.id); else this.noteOn(ev);
      }

      const det = P.detune.length > 1 ? P.detune[base] : P.detune[0];
      const sh2 = P.shape2.length > 1 ? P.shape2[base] : P.shape2[0];
      const drv = P.drive.length > 1 ? P.drive[base] : P.drive[0];
      const decay = kv(P.decay);
      const L1 = kv(P.osc1), L2 = kv(P.osc2), L3 = kv(P.osc3), L4 = kv(P.osc4);
      const sh1 = kv(P.shape1), pw1 = 0.5 + 0.45 * kv(P.pw1), pw2 = 0.5 + 0.45 * kv(P.pw2);
      const slop = kv(P.slop), chorus = kv(P.chorus);
      const atk = kv(P.atk), sus = kv(P.sus), rel = kv(P.rel);

      // ---- the noise, once for every voice ----
      const nz = this.nz;
      for (let i = 0; i < blk * 2; i++) nz[i] = Math.random() * 2 - 1;
      // Squared, as the contagion's is: the slider's 0.4 default is a hiss
      // otherwise.
      const Ln = L4 * L4 * 0.5;

      // ---- the envelope's rates, shared by every voice ----
      // Attack 1ms..10s and release 10ms..10s, exponential in the knob; the
      // decay keeps the range the slider always had, 50ms..2.05s.
      const tAtt = 0.001 * Math.pow(10, 4 * atk);
      const tDec = 0.05 + 2 * decay;
      const tRel = 0.01 * Math.pow(1000, rel);
      const attC = 1 - Math.exp(-1.6 / (tAtt * sr2));
      const decC = Math.exp(-4 / (tDec * sr2));
      const relC = Math.exp(-4 / (tRel * sr2));

      const bus = this.bus;
      for (let i = 0; i < blk * 2; i++) bus[i] = 0;
      let anyActive = false;
      const detOct = (det - 0.5) * 0.6 / 12;       // ±30 cents on VCO 2
      const calSpan = slop * 12 / 1200;             // ±12 cents per card at the top
      const walkSpan = slop * 5 / 1200;             // and a ±5 cent wander

      for (let vi = 0; vi < NV; vi++) {
        const v = this.voices[vi];
        if (!v.active()) continue;
        anyActive = true;
        v.age += blk;

        if (v.glideC < 1) {
          v.logF += (v.logT - v.logF) * v.glideC;
          if (Math.abs(v.logT - v.logF) < 1e-5) { v.logF = v.logT; v.glideC = 1; }
        }
        for (let i = 0; i < 2; i++) {
          v.driftT[i] += (Math.random() * 2 - 1) * 0.03;
          if (v.driftT[i] > 1) v.driftT[i] = 1; else if (v.driftT[i] < -1) v.driftT[i] = -1;
          v.drift[i] += (v.driftT[i] - v.drift[i]) * 0.003;
        }
        const l1 = v.logF + v.cal[0] * calSpan + v.drift[0] * walkSpan;
        const l2 = v.logF + detOct + v.cal[1] * calSpan + v.drift[1] * walkSpan;
        const f1 = Math.pow(2, l1);
        v.dt[0] = f1 / sr2; v.dt[1] = Math.pow(2, l2) / sr2; v.dt[2] = f1 * 0.5 / sr2;
        const d1 = v.dt[0], d2 = v.dt[1], d3 = v.dt[2];
        const lvl = v.vel * 0.3;

        for (let i = 0; i < blk * 2; i++) {
          // ---- the envelope ----
          if (v.stage === 1) { v.env += (1.25 - v.env) * attC; if (v.env >= 1) { v.env = 1; v.stage = 2; } }
          else if (v.stage === 2) { v.env = sus + (v.env - sus) * decC; }
          if (!v.held && v.stage !== 3 && v.stage !== 0) v.stage = 3;
          if (v.stage === 3) { v.env *= relC; if (v.env < 1e-5) { v.env = 0; v.stage = 0; } }

          // ---- the oscillators ----
          let p = v.ph[0] + d1; if (p >= 1) p -= 1; v.ph[0] = p;
          const o1 = morphWave(sh1, p, d1, pw1);
          p = v.ph[1] + d2; if (p >= 1) p -= 1; v.ph[1] = p;
          const o2 = morphWave(sh2, p, d2, pw2);
          p = v.ph[2] + d3; if (p >= 1) p -= 1; v.ph[2] = p;
          const sb = squareWave(p, d3);

          bus[i] += (o1 * L1 + o2 * L2 + sb * L3 + nz[i] * Ln) * v.env * lvl;
        }
        if (v.stage === 0) v.held = false;
      }

      // ---- the drive, on the sum, at 2x; then decimate and block the DC ----
      // A gain into the knee, with a small bias for the even harmonics,
      // normalised so one note at the default mixer (RMS about 0.2) comes
      // out at the level it went in whatever the knob says. The RMS, not
      // the peak: driven hard a note is a square, whose RMS is its peak, so
      // holding the peak let it come out 6dB louder (measured) than clean.
      const g = Math.pow(10, 1.4 * drv * drv);
      const bias = 0.03 * drv;                 // before the gain, so it bites
      const norm = 0.2 / knee(0.2 * g);
      const silentIn = !anyActive;
      for (let i = 0; i < blk; i++) {
        let y = 0;
        for (let os = 0; os < 2; os++) {
          const xn = silentIn ? 0 : knee((bus[i * 2 + os] + bias) * g) * norm;
          y = this.db0 * xn + this.db1 * this.dx1 + this.db2 * this.dx2 - this.da1 * this.dy1 - this.da2 * this.dy2;
          this.dx2 = this.dx1; this.dx1 = xn;
          this.dy2 = this.dy1; this.dy1 = y;
        }
        const dz = y - this.dcX + 0.9995 * this.dcY;
        this.dcX = y; this.dcY = dz;
        bus[i] = dz;                     // reuse the front of the bus at 1x
      }
      if (silentIn) {
        this.dx1 = this.dx2 = this.dy1 = this.dy2 = this.dcX = this.dcY = 0;
        for (let i = 0; i < blk; i++) bus[i] = 0;
      }

      // ---- the chorus, stereo ----
      // Nothing sounding and the line run dry: digital silence, and the
      // states let go rather than left ringing down into denormals.
      if (silentIn) {
        this.quiet += blk;
        if (this.quiet > this.cLen + 64) {
          this.cBuf.fill(0);
          for (let i = 0; i < blk; i++) { oL[base + i] = 0; if (oR) oR[base + i] = 0; }
          continue;
        }
      } else this.quiet = 0;
      const cb = this.cBuf, cl = this.cLen;
      const wetA = Math.sin(chorus * 1.5707963267948966), dryA = Math.cos(chorus * 1.5707963267948966);
      for (let i = 0; i < blk; i++) {
        const x = bus[i];
        cb[this.cW] = x;
        let l = x, r = x;
        if (chorus > 0) {
          const m = Math.sin(6.283185307179586 * this.cPh);
          const dL = this.cBase + this.cDepth * m, dR = this.cBase - this.cDepth * m;
          let rp = this.cW - dL; if (rp < 0) rp += cl;
          let i0 = rp | 0, fr = rp - i0, i1 = i0 + 1; if (i1 >= cl) i1 -= cl;
          const tL = cb[i0] + (cb[i1] - cb[i0]) * fr;
          rp = this.cW - dR; if (rp < 0) rp += cl;
          i0 = rp | 0; fr = rp - i0; i1 = i0 + 1; if (i1 >= cl) i1 -= cl;
          const tR = cb[i0] + (cb[i1] - cb[i0]) * fr;
          l = x * dryA + tL * wetA;
          r = x * dryA + tR * wetA;
        }
        this.cPh += this.cRate; if (this.cPh >= 1) this.cPh -= 1;
        this.cW++; if (this.cW >= cl) this.cW = 0;
        oL[base + i] = knee(l);
        if (oR) oR[base + i] = knee(r);
      }
    }
    return true;
  }
}

registerProcessor("oracle", OracleProcessor);
`;

/** The processor source, for test/oracle.test.js, which evaluates it against
 *  the worklet globals a test stubs, as ladder.test.js does. */
export function oracleProcessorSource() { return ORACLE_PROCESSOR_SOURCE; }

const _loads = new WeakMap();
const _ready = new WeakSet();

/**
 * Register the oracle processor on this context. Called at init() so the
 * await on the play path has already resolved by the time a voice is built.
 * @param {BaseAudioContext} ctx @returns {Promise<void>}
 */
export function loadOracleWorklet(ctx) {
  if (!ctx?.audioWorklet) return Promise.reject(new Error("no AudioWorklet"));
  let p = _loads.get(ctx);
  if (!p) {
    const url = URL.createObjectURL(new Blob([ORACLE_PROCESSOR_SOURCE], { type: "text/javascript" }));
    p = ctx.audioWorklet.addModule(url)
      .then(() => { URL.revokeObjectURL(url); _ready.add(ctx); })
      .catch((e) => { URL.revokeObjectURL(url); _loads.delete(ctx); throw e; });
    _loads.set(ctx, p);
  }
  return p;
}

/** Has the processor finished registering on this context? */
export function oracleReady(ctx) { return !!ctx && _ready.has(ctx); }

// ---- the panel ----------------------------------------------------------
// Keys are `orc` + short key -> `oracle_<short>` / `oracle.<short>`. The
// lists, the ranges, the defaults and the patches are data in engineData.js;
// re-exported here.
import { ORACLE_MOD_KEYS } from "./engineData.js";
export {
  ORACLE_NUM_CTLS, ORACLE_SEL_CTLS, ORACLE_MOD_KEYS, ORACLE_NUM_KEYS, ORACLE_SEL_KEYS,
  ORACLE_MOD_RANGE, ORACLE_MOD_LABELS, ORACLE_DEFAULTS, oracleFromUnit,
  ORACLE_TONE_NAMES, oracleToneDescription, oracleTone,
} from "./engineData.js";

// Tone wrappers don't accept a native connect() — unwrap to the node underneath.
const nativeIn = (node) => node?.input?.input ?? node?.input ?? node;

/**
 * Build the oracle voice. Returns null when the worklet isn't registered yet,
 * so the caller can fall back rather than leave the track silent.
 * @param {*} output Tone node the voice writes into.
 */
export function buildOracleWorkletVoice(output) {
  const ctx = Tone.getContext().rawContext;
  if (!oracleReady(ctx)) { loadOracleWorklet(ctx).catch(() => {}); return null; }

  let node;
  try {
    node = new AudioWorkletNode(ctx, "oracle",
      { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
  } catch (e) {
    console.warn("oracle worklet node failed", e);
    return null;
  }
  node.connect(nativeIn(output));

  // `noise` is the ladder bank's key and is not this engine's: its noise
  // level is the osc-mix row's fourth slider, `osc4`.
  const PARAM_OF = {
    harm: "detune", timb: "shape2", morph: "drive", decay: "decay",
    osc1: "osc1", osc2: "osc2", osc3: "osc3", osc4: "osc4",
  };
  for (const k of ORACLE_MOD_KEYS) PARAM_OF[`orc${k}`] = k;

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
