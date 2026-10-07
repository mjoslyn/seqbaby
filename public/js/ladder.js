// ---- ladder: the transistor-ladder monosynth -------------------------------
// A model of the Minimoog-style signal path rather than three Tone oscillators
// into a waveshaper, which is what this engine was: that version had no ladder
// in it at all, and the ladder is the instrument.
//
//   OSC 1 ─┐
//   OSC 2 ─┼─ MIXER ─▶ LADDER VCF (4-pole, 24 dB/oct) ─▶ VCA ─▶ out
//   OSC 3 ─┤  (the     ▲  cutoff · emphasis · kbd       ▲
//   NOISE ─┘  overload) │  ◀── FILTER CONTOUR × amount   │  ◀── LOUDNESS CONTOUR
//      │                └── mod wheel (osc 3 / noise) ───┘      (decay switch)
//      └── osc 3 in LO is the LFO; the wheel sends it to the oscillators and the filter
//
// - **The filter is a feedback ladder with the saturator inside the loop**:
//   four one-pole stages, the resonance fed back through a tanh at the input
//   transistor pair, 2x oversampled. That topology is what makes a ladder
//   lose passband level as the emphasis climbs (1/(1+k) at DC), and the
//   machine never compensated: a high-emphasis line is thin, and the whistle
//   past about three quarters of the knob is the loop's own oscillation,
//   bounded by that tanh. A quarter of the loss is clawed back here, the
//   same figure filterModels.js's `fat` character uses, so the default
//   emphasis does not read as a fault; the rest is the sound.
// - **Keyboard tracking is a switch pair** (off, 1/3, 2/3, full), so a
//   whistling filter at full tracking plays in tune.
// - **The mixer overloads the filter.** Each oscillator at its default level
//   arrives clean; three of them up together push the input stage into
//   saturation, and that overdrive is most of what "fat" means on this
//   machine. The levels are the mixer knobs, nothing else.
// - **The oscillators are the machine's six waves**: triangle, the
//   triangle-saw (shark), saw, square, wide and narrow pulse, with polyBLEP on
//   every edge, and six ranges from LO (the LFO range, seven octaves under
//   8') to 2'. Osc 2 and osc 3 tune ±7 semitones, continuous. Osc 3 can be
//   taken off the keyboard, which is how it becomes a fixed-rate LFO.
// - **Two contours, attack / decay / sustain each, and one decay switch**:
//   on, a note releases at its decay time; off, it stops a few ms after the
//   gate, as the panel switch does. The filter contour's amount is a track
//   slider because it is the knob a Moog player lives on.
// - **The mod wheel carries osc 3 or noise** (a mix of the two) to the
//   oscillators (a vibrato, or audio-rate FM once osc 3 is in an audio
//   range) and to the filter, each behind its own switch. Osc 3 is read
//   before the mixer, so it modulates with its mixer level at zero.
// - **Drift**: each oscillator walks a few cents on its own, slowly, and the
//   three never sit exactly together, as the machine's never did. The knob
//   is how much; zero is a calibrated reissue.
// - **Mono mode is the machine**: low-note priority, single trigger (a note
//   arriving while one is held changes the pitch and leaves the contours
//   where they are), the track's glide as the glide knob. Poly mode is six
//   of them, for the chords a step can already carry; a voice is stolen
//   quietest first.
// - **Velocity is a level** (the keyboard had none; a sequencer step does).
//
// One list, three namespaces, as in the other emulators: every panel control
// is `ldr` + a short key, which spells its LFO target (`ladder_<short>`) and
// its automation lane (`ladder.<short>`). The oscillator bank's keys predate
// the prefix (`osc1wave`, `osc2freq`, `noise`...) and keep their spelling.
// The four track sliders are CUTOFF / EMPHASIS / CONTOUR / DECAY.

const LADDER_PROCESSOR_SOURCE = `
const BLK = 16;       // control-block size, at the host rate
const NV = 6;         // voices in poly mode
const QCAP = 1024;

// A rational tanh: within 1% of the real one to |x| 2.5 and pinned at the
// rails past 3. Five of these run per sub-sample per voice.
function tanhA(x) {
  if (x > 3) return 1;
  if (x < -3) return -1;
  const x2 = x * x;
  return x * (27 + x2) / (27 + 9 * x2);
}
// 2^x for small x, as a vibrato needs it: within 0.3% to |x| 0.5 octave.
function exp2s(x) {
  const u = x * 0.6931471805599453;
  return 1 + u + u * u * 0.5 + u * u * u * 0.1666667;
}
// polyBLEP corrector for a discontinuity at phase 0.
function blep(t, dt) {
  if (t < dt) { const x = t / dt; return x + x - x * x - 1; }
  if (t > 1 - dt) { const x = (t - 1) / dt; return x * x + x + x + 1; }
  return 0;
}

// ---- the event queue ------------------------------------------------------
// The same allocation-free queue as siege.js / subbass.js: parallel typed
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
// triangle, shark (triangle-saw), saw, square, wide pulse, narrow pulse, sine.
const W_TRI = 0, W_SHARK = 1, W_SAW = 2, W_SQR = 3, W_PULSE = 4, W_NARROW = 5, W_SINE = 6;
const PW = [0, 0, 0, 0.5, 0.3, 0.1, 0];
function wave(kind, p, dt) {
  switch (kind) {
    case W_SAW: return 2 * p - 1 - blep(p, dt);
    case W_SQR: case W_PULSE: case W_NARROW: {
      const pw = PW[kind];
      let s = p < pw ? 1 : -1;
      s += blep(p, dt);
      let p2 = p - pw; if (p2 < 0) p2 += 1;
      s -= blep(p2, dt);
      return s - (2 * pw - 1);        // the pulse's own DC, taken off
    }
    case W_TRI: return 1 - 4 * Math.abs(p - 0.5);
    case W_SHARK: return 0.55 * (1 - 4 * Math.abs(p - 0.5)) + 0.55 * (2 * p - 1 - blep(p, dt));
    default: return Math.sin(6.283185307179586 * p);
  }
}

const KBD = { off: 0, "1/3": 1 / 3, "2/3": 2 / 3, full: 1 };

class Voice {
  constructor() {
    this.ph = new Float64Array(3);
    this.dt = new Float64Array(3);        // per-osc phase step this block
    this.drift = new Float64Array(3);     // the walk, in units of the drift span
    this.driftT = new Float64Array(3);
    this.s = new Float64Array(4);         // the four ladder stages
    this.fb = 0;
    this.env = 0; this.stage = 0;         // loudness contour: 0 idle 1 atk 2 dec 3 rel
    this.fenv = 0; this.fstage = 0;       // filter contour
    this.note = 60; this.logF = Math.log2(261.63); this.logT = this.logF; this.glideC = 1;
    this.id = 0; this.held = false; this.vel = 1; this.age = 0;
    this.osc3 = 0;                        // last osc 3 sample, the mod source
    // this block's filter constants
    this.g = 0.1; this.k = 0; this.mk = 1;
    this.attC = 1; this.decC = 0; this.relC = 0; this.susL = 0.75;
    this.fattC = 1; this.fdecC = 0; this.frelC = 0; this.fsusL = 0.3;
  }
  active() { return this.stage !== 0; }
  reset() {
    this.s.fill(0); this.fb = 0;
    for (let i = 0; i < 3; i++) this.ph[i] = 0;
  }
}

class LadderProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    const a = (name, defaultValue) => ({ name, defaultValue, minValue: 0, maxValue: 1, automationRate: "a-rate" });
    const k = (name, defaultValue, minValue = 0, maxValue = 1) => ({ name, defaultValue, minValue, maxValue, automationRate: "k-rate" });
    return [
      // The four track sliders (cutoff / emphasis / contour amount / decay).
      a("cutoff", 0.5), a("emphasis", 0.5), a("contour", 0.5), k("decay", 0.4),
      // The mixer.
      k("osc1", 0.55), k("osc2", 0.45), k("osc3", 0.35), k("noise", 0),
      k("osc2freq", 0, -7, 7), k("osc3freq", 0, -7, 7),
      // The panel.
      k("fatk", 0), k("fdec", 0.45), k("fsus", 0.3), k("atk", 0.05), k("sus", 0.75),
      k("mod", 0), k("modmix", 0), k("drift", 0.25), k("tune", 0, -1, 1),
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
    this.waves = [W_SAW, W_SAW, W_TRI];
    this.ranges = [0, 0, -1];
    this.kbd = 1 / 3;
    this.osc3kbd = 1; this.oscmod = 0; this.filtmod = 0; this.decsw = 1;
    this.mono = 0; this.pink = 0;
    this.glideSec = 0;
    this.noteId = 0;
    // Mono mode's held notes, lowest wins. A small fixed table: a sequencer
    // never holds more than a chord.
    this.heldN = new Float64Array(16); this.heldId = new Float64Array(16); this.heldF = new Float64Array(16);
    this.nHeld = 0;
    // The noise: one source for the machine, written per block at 2x.
    this.nz = new Float64Array(BLK * 2);
    this.pk0 = 0; this.pk1 = 0; this.pk2 = 0;
    this.nzLP = 0;                        // the wheel's noise, slowed to a wobble
    this.nzLPc = 1 - Math.exp(-2 * Math.PI * 12 / sr);
    // The 2x mix bus and its decimator (2-pole Butterworth at 0.45 sr).
    this.bus = new Float64Array(BLK * 2);
    const wc = Math.tan(Math.PI * 0.45 * sr / this.sr2);
    const kk = Math.SQRT2 * wc, w2 = wc * wc, a0 = 1 + kk + w2;
    this.db0 = w2 / a0; this.db1 = 2 * this.db0; this.db2 = this.db0;
    this.da1 = (2 * (w2 - 1)) / a0; this.da2 = (1 - kk + w2) / a0;
    this.dx1 = 0; this.dx2 = 0; this.dy1 = 0; this.dy2 = 0;
    this.dcX = 0; this.dcY = 0;
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
      if (m.waves) for (let i = 0; i < 3; i++) if (m.waves[i] != null) this.waves[i] = m.waves[i] | 0;
      if (m.ranges) for (let i = 0; i < 3; i++) if (m.ranges[i] != null) this.ranges[i] = +m.ranges[i];
      if (m.kbd !== undefined) this.kbd = KBD[m.kbd] ?? 1 / 3;
      if (m.osc3kbd !== undefined) this.osc3kbd = m.osc3kbd ? 1 : 0;
      if (m.oscmod !== undefined) this.oscmod = m.oscmod ? 1 : 0;
      if (m.filtmod !== undefined) this.filtmod = m.filtmod ? 1 : 0;
      if (m.decsw !== undefined) this.decsw = m.decsw ? 1 : 0;
      if (m.pink !== undefined) this.pink = m.pink ? 1 : 0;
      if (m.glide !== undefined) this.glideSec = Math.max(0, +m.glide || 0);
      if (m.mono !== undefined) {
        const mono = m.mono ? 1 : 0;
        if (mono !== this.mono) {
          // Changing the keyboard's priority lets everything go: a held
          // note is the other mode's.
          for (const v of this.voices) if (v.stage) { v.held = false; v.stage = 3; v.fstage = 3; }
          this.nHeld = 0;
        }
        this.mono = mono;
      }
    } else if (m.type === "dispose") {
      this.alive = false;
    }
  }

  // ---- the keyboard ---------------------------------------------------------
  startVoice(v, ev, glide, retrigger) {
    const was = v.stage !== 0;
    v.logT = Math.log2(ev.freq);
    if (!was || glide <= 0) { v.logF = v.logT; v.glideC = 1; }
    else v.glideC = 1 - Math.exp(-3 / Math.max(1, glide * this.sr / BLK));
    v.note = ev.note; v.id = ev.id; v.held = true; v.vel = ev.vel; v.age = 0;
    if (!was) v.reset();
    if (retrigger || !was) {
      // An analog contour retriggers from where it is: no reset to zero, so a
      // note landing on a ringing one has no step in it.
      v.stage = 1; v.fstage = 1;
    }
  }

  noteOn(ev) {
    const glide = ev.glide > 0 ? ev.glide : this.glideSec;
    if (this.mono) {
      const v = this.voices[0];
      // Low-note priority, single trigger: the lowest held key is the pitch,
      // and only a note arriving on an open keyboard starts the contours.
      if (this.nHeld < 16) { this.heldN[this.nHeld] = ev.note; this.heldId[this.nHeld] = ev.id; this.heldF[this.nHeld] = ev.freq; this.nHeld++; }
      let lo = 0;
      for (let i = 1; i < this.nHeld; i++) if (this.heldN[i] < this.heldN[lo]) lo = i;
      const wasHeld = v.held && v.stage !== 0;
      if (this.heldN[lo] === ev.note || !wasHeld) {
        if (wasHeld) {
          // Legato onto a lower note: the pitch moves, the contours do not.
          v.logT = Math.log2(ev.freq);
          v.glideC = glide > 0 ? 1 - Math.exp(-3 / Math.max(1, glide * this.sr / BLK)) : 1;
          if (glide <= 0) v.logF = v.logT;
          v.note = ev.note; v.id = ev.id;
        } else {
          this.startVoice(v, ev, glide, true);
        }
      }
      v.held = true;
      return;
    }
    // Poly: a free voice, else the quietest one being stolen. Glide is from
    // whatever that voice last played, as the pooled version did.
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
    this.startVoice(this.voices[pick], ev, glide, true);
  }

  noteOff(id) {
    if (this.mono) {
      let i = 0;
      while (i < this.nHeld && this.heldId[i] !== id) i++;
      if (i === this.nHeld) return;
      this.nHeld--;
      for (; i < this.nHeld; i++) { this.heldN[i] = this.heldN[i + 1]; this.heldId[i] = this.heldId[i + 1]; this.heldF[i] = this.heldF[i + 1]; }
      const v = this.voices[0];
      if (this.nHeld === 0) { v.held = false; return; }
      // Another key is still down: the pitch goes back to the lowest of them.
      let lo = 0;
      for (let j = 1; j < this.nHeld; j++) if (this.heldN[j] < this.heldN[lo]) lo = j;
      if (this.heldN[lo] !== v.note) {
        v.logT = Math.log2(this.heldF[lo]);
        const glide = this.glideSec;
        v.glideC = glide > 0 ? 1 - Math.exp(-3 / Math.max(1, glide * this.sr / BLK)) : 1;
        if (glide <= 0) v.logF = v.logT;
        v.note = this.heldN[lo]; v.id = this.heldId[lo];
      }
      return;
    }
    for (const v of this.voices) if (v.held && v.id === id) v.held = false;
  }

  releaseAll() {
    for (const v of this.voices) v.held = false;
    this.nHeld = 0;
  }

  // ---- the block ------------------------------------------------------------
  process(inputs, outputs, params) {
    if (!this.alive) return false;
    const out = outputs[0];
    if (!out || !out.length) return true;
    const o = out[0];
    const n128 = o.length;
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

      const cut = P.cutoff.length > 1 ? P.cutoff[base] : P.cutoff[0];
      const res = P.emphasis.length > 1 ? P.emphasis[base] : P.emphasis[0];
      const amt = P.contour.length > 1 ? P.contour[base] : P.contour[0];
      const decay = kv(P.decay);
      const L1 = kv(P.osc1), L2 = kv(P.osc2), L3 = kv(P.osc3), Ln = kv(P.noise);
      const f2 = kv(P.osc2freq), f3 = kv(P.osc3freq);
      const fatk = kv(P.fatk), fdec = kv(P.fdec), fsus = kv(P.fsus), atk = kv(P.atk), sus = kv(P.sus);
      const mod = kv(P.mod), modmix = kv(P.modmix), drift = kv(P.drift), tune = kv(P.tune);

      // ---- the noise, once for every voice ----
      const nz = this.nz;
      for (let i = 0; i < blk * 2; i++) {
        const w = Math.random() * 2 - 1;
        if (this.pink) {
          // Kellet's three-pole pink approximation.
          this.pk0 = 0.99765 * this.pk0 + w * 0.0990460;
          this.pk1 = 0.96300 * this.pk1 + w * 0.2965164;
          this.pk2 = 0.57000 * this.pk2 + w * 1.0526913;
          nz[i] = (this.pk0 + this.pk1 + this.pk2 + w * 0.1848) * 0.25;
        } else nz[i] = w;
      }
      // The wheel's noise is a wobble, not a hiss: a 12Hz one-pole on it.
      this.nzLP += (nz[0] - this.nzLP) * this.nzLPc * BLK;
      const nzMod = Math.max(-1, Math.min(1, this.nzLP * 6));

      // ---- the contours' rates, shared by every voice ----
      // Attack 1ms..10s, decay 6ms..12s, both exponential in the knob. The
      // attack aims past full scale and clamps, as a charging cap does.
      const tAtt = 0.001 * Math.pow(10, 4 * atk), tDec = 0.006 * Math.pow(10, 3.3 * decay);
      const tFAtt = 0.001 * Math.pow(10, 4 * fatk), tFDec = 0.006 * Math.pow(10, 3.3 * fdec);
      const attC = 1 - Math.exp(-1.6 / (tAtt * sr2)), decC = Math.exp(-4 / (tDec * sr2));
      const fattC = 1 - Math.exp(-1.6 / (tFAtt * sr2)), fdecC = Math.exp(-4 / (tFDec * sr2));
      const relC = this.decsw ? decC : Math.exp(-4 / (0.008 * sr2));
      const frelC = this.decsw ? fdecC : Math.exp(-4 / (0.008 * sr2));

      const bus = this.bus;
      for (let i = 0; i < blk * 2; i++) bus[i] = 0;
      let anyActive = false;
      const gin = 0.8;                          // the mixer into the input pair
      const kRes = 5.3 * res;                   // the loop gain; 4 is the edge
      const mk = Math.pow(1 + kRes, 0.2);
      const driftSpan = drift * 6 / 1200;       // ±6 cents at the top, in octaves
      const driftStatic = drift * 1.5 / 1200;   // the three never sit exactly together

      for (let vi = 0; vi < (this.mono ? 1 : NV); vi++) {
        const v = this.voices[vi];
        if (!v.active()) continue;
        anyActive = true;
        v.age += blk;

        // ---- pitch: the glide, then each oscillator's own offset ----
        if (v.glideC < 1) {
          v.logF += (v.logT - v.logF) * v.glideC;
          if (Math.abs(v.logT - v.logF) < 1e-5) { v.logF = v.logT; v.glideC = 1; }
        }
        for (let i = 0; i < 3; i++) {
          v.driftT[i] += (Math.random() * 2 - 1) * 0.03;
          if (v.driftT[i] > 1) v.driftT[i] = 1; else if (v.driftT[i] < -1) v.driftT[i] = -1;
          v.drift[i] += (v.driftT[i] - v.drift[i]) * 0.003;
        }
        const baseLog = v.logF + tune / 12;
        const st1 = 0, st2 = 0.7, st3 = -1;      // the static misalignment, scaled by drift
        const l1 = baseLog + this.ranges[0] + v.drift[0] * driftSpan + st1 * driftStatic;
        const l2 = baseLog + this.ranges[1] + f2 / 12 + v.drift[1] * driftSpan + st2 * driftStatic;
        const l3 = (this.osc3kbd ? baseLog : Math.log2(440) + tune / 12) + this.ranges[2] + f3 / 12 + v.drift[2] * driftSpan + st3 * driftStatic;
        const fq1 = Math.pow(2, l1), fq2 = Math.pow(2, l2), fq3 = Math.pow(2, l3);
        v.dt[0] = fq1 / sr2; v.dt[1] = fq2 / sr2; v.dt[2] = fq3 / sr2;

        // ---- the filter's cutoff this block ----
        // kbd tracking around middle C; the contour adds up to five octaves;
        // the wheel up to three, from osc 3 / the slowed noise.
        const modSig = (1 - modmix) * v.osc3 + modmix * nzMod;
        let oct = Math.log2(30) + cut * 9.4 + this.kbd * (v.note - 60) / 12 + 5 * amt * v.fenv;
        if (this.filtmod) oct += 3 * mod * modSig;
        let fc = Math.pow(2, oct);
        if (fc > 18000) fc = 18000; else if (fc < 20) fc = 20;
        const G = Math.tan(Math.PI * fc / sr2);
        const g = G / (1 + G);
        const pitchMod = this.oscmod ? 5 / 12 * mod : 0;   // ±5 semitones at the top
        const w1 = this.waves[0], w2 = this.waves[1], w3 = this.waves[2];
        const velLvl = 0.45 + 0.55 * v.vel;
        const s = v.s;

        for (let i = 0; i < blk * 2; i++) {
          // ---- the contours (at 2x, one multiply-add each) ----
          if (v.stage === 1) { v.env += (1.25 - v.env) * attC; if (v.env >= 1) { v.env = 1; v.stage = 2; } }
          else if (v.stage === 2) { v.env = sus + (v.env - sus) * decC; }
          if (!v.held && v.stage !== 3 && v.stage !== 0) v.stage = 3;
          if (v.stage === 3) { v.env *= relC; if (v.env < 1e-5) { v.env = 0; v.stage = 0; v.fstage = 0; v.fenv = 0; } }
          if (v.fstage === 1) { v.fenv += (1.25 - v.fenv) * fattC; if (v.fenv >= 1) { v.fenv = 1; v.fstage = 2; } }
          else if (v.fstage === 2) { v.fenv = fsus + (v.fenv - fsus) * fdecC; }
          if (!v.held && v.fstage !== 3 && v.fstage !== 0) v.fstage = 3;
          if (v.fstage === 3) { v.fenv *= frelC; }

          // ---- the oscillators ----
          const m = pitchMod !== 0 ? exp2s(pitchMod * ((1 - modmix) * v.osc3 + modmix * nzMod)) : 1;
          let p = v.ph[0] + v.dt[0] * m; if (p >= 1) p -= 1; v.ph[0] = p;
          const o1 = wave(w1, p, v.dt[0] * m);
          p = v.ph[1] + v.dt[1] * m; if (p >= 1) p -= 1; v.ph[1] = p;
          const o2 = wave(w2, p, v.dt[1] * m);
          p = v.ph[2] + v.dt[2]; if (p >= 1) p -= 1; v.ph[2] = p;
          const o3 = wave(w3, p, v.dt[2]);
          v.osc3 = o3;

          // ---- the mixer, into the ladder's input pair ----
          // The input pair's own noise floor (-80dB) rides under the mix: it
          // is what lets the loop start whistling with every oscillator off.
          const x = (o1 * L1 + o2 * L2 + o3 * L3 + nz[i] * (Ln * 0.5 + 1e-4)) * gin;
          let y = tanhA(x - kRes * tanhA(v.fb));
          let t = (y - s[0]) * g; let yo = t + s[0]; s[0] = yo + t; y = yo;
          t = (y - s[1]) * g; yo = t + s[1]; s[1] = yo + t; y = yo;
          t = (y - s[2]) * g; yo = t + s[2]; s[2] = yo + t; y = yo;
          t = (y - s[3]) * g; yo = t + s[3]; s[3] = yo + t; y = yo;
          v.fb = y;

          bus[i] += y * mk * v.env * velLvl;
        }
        if (v.stage === 0) v.held = false;
      }

      // ---- decimate the bus, block the DC, the output stage's knee ----
      // Nothing sounding is digital silence: the decimator and the DC blocker
      // are let go rather than left ringing down into denormals.
      if (!anyActive) {
        this.dx1 = this.dx2 = this.dy1 = this.dy2 = this.dcX = this.dcY = 0;
        for (let i = 0; i < blk; i++) o[base + i] = 0;
        continue;
      }
      for (let i = 0; i < blk; i++) {
        let y = 0;
        for (let os = 0; os < 2; os++) {
          const xn = bus[i * 2 + os];
          y = this.db0 * xn + this.db1 * this.dx1 + this.db2 * this.dx2 - this.da1 * this.dy1 - this.da2 * this.dy2;
          this.dx2 = this.dx1; this.dx1 = xn;
          this.dy2 = this.dy1; this.dy1 = y;
        }
        const dz = y - this.dcX + 0.9995 * this.dcY;
        this.dcX = y; this.dcY = dz;
        o[base + i] = tanhA(dz * 1.1);
      }
    }
    return true;
  }
}

registerProcessor("ladder", LadderProcessor);
`;

/** The processor source, for test/ladder.test.js, which evaluates it against
 *  the worklet globals a test stubs, as siege.test.js does. */
export function ladderProcessorSource() { return LADDER_PROCESSOR_SOURCE; }

const _loads = new WeakMap();
const _ready = new WeakSet();

/**
 * Register the ladder processor on this context. Called at init() so the
 * await on the play path has already resolved by the time a voice is built.
 * @param {BaseAudioContext} ctx @returns {Promise<void>}
 */
export function loadLadderWorklet(ctx) {
  if (!ctx?.audioWorklet) return Promise.reject(new Error("no AudioWorklet"));
  let p = _loads.get(ctx);
  if (!p) {
    const url = URL.createObjectURL(new Blob([LADDER_PROCESSOR_SOURCE], { type: "text/javascript" }));
    p = ctx.audioWorklet.addModule(url)
      .then(() => { URL.revokeObjectURL(url); _ready.add(ctx); })
      .catch((e) => { URL.revokeObjectURL(url); _loads.delete(ctx); throw e; });
    _loads.set(ctx, p);
  }
  return p;
}

/** Has the processor finished registering on this context? */
export function ladderReady(ctx) { return !!ctx && _ready.has(ctx); }

// ---- the panel ----------------------------------------------------------
// Keys are `ldr` + short key -> `ladder_<short>` / `ladder.<short>`; the
// oscillator bank's are its old unprefixed ones. The lists, the ranges, the
// defaults and the patches are data in engineData.js; re-exported here.
import { LADDER_MOD_KEYS, LADDER_WAVES } from "./engineData.js";
export {
  LADDER_NUM_CTLS, LADDER_SEL_CTLS, LADDER_MOD_KEYS, LADDER_NUM_KEYS, LADDER_SEL_KEYS,
  LADDER_MOD_RANGE, LADDER_MOD_LABELS, LADDER_DEFAULTS, ladderFromUnit,
  LADDER_WAVES, LADDER_RANGES, LADDER_OSC_NUM_CTLS, LADDER_OSC_SEL_CTLS,
  LADDER_TONE_NAMES, ladderToneDescription, ladderTone,
} from "./engineData.js";

// Tone wrappers don't accept a native connect() — unwrap to the node underneath.
const nativeIn = (node) => node?.input?.input ?? node?.input ?? node;

/**
 * Build the ladder voice. Returns null when the worklet isn't registered yet,
 * so the caller can fall back rather than leave the track silent.
 * @param {*} output Tone node the voice writes into.
 */
export function buildLadderWorkletVoice(output) {
  const ctx = Tone.getContext().rawContext;
  if (!ladderReady(ctx)) { loadLadderWorklet(ctx).catch(() => {}); return null; }

  let node;
  try {
    node = new AudioWorkletNode(ctx, "ladder",
      { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1] });
  } catch (e) {
    console.warn("ladder worklet node failed", e);
    return null;
  }
  node.connect(nativeIn(output));

  const PARAM_OF = {
    harm: "cutoff", timb: "emphasis", morph: "contour", decay: "decay",
    osc1: "osc1", osc2: "osc2", osc3: "osc3", noise: "noise",
    osc2freq: "osc2freq", osc3freq: "osc3freq",
  };
  for (const k of LADDER_MOD_KEYS) PARAM_OF[`ldr${k}`] = k;

  const P = {};
  for (const name of Object.values(PARAM_OF)) P[name] = node.parameters.get(name);
  const post = (m) => { try { node.port.postMessage(m); } catch {} };
  const waveIdx = (w) => { const i = LADDER_WAVES.indexOf(String(w)); return i < 0 ? 2 : i; };

  const waves = [2, 2, 0];
  const ranges = [0, 0, -1];
  let noteId = 0;
  let glide = 0;
  const paramFor = (key) => P[PARAM_OF[key]] ?? null;

  return {
    nodes: [{ dispose() { try { node.port.postMessage({ type: "dispose" }); } catch {} try { node.disconnect(); } catch {} } }],
    setGlide: (g) => { glide = Math.max(0, Number(g) || 0); post({ type: "set", glide }); },
    setParam: (key, val) => {
      const osc = /^osc([123])(wave|range)$/.exec(key);
      if (osc) {
        const i = Number(osc[1]) - 1;
        if (osc[2] === "wave") { waves[i] = waveIdx(val); post({ type: "set", waves }); }
        else { const r = Number(val); if (Number.isFinite(r)) { ranges[i] = r; post({ type: "set", ranges }); } }
        return;
      }
      switch (key) {
        case "noisetype":  post({ type: "set", pink: val === "pink" }); return;
        case "ldrkbd":     post({ type: "set", kbd: String(val) }); return;
        case "ldrosc3kbd": post({ type: "set", osc3kbd: val !== "off" }); return;
        case "ldroscmod":  post({ type: "set", oscmod: val === "on" }); return;
        case "ldrfiltmod": post({ type: "set", filtmod: val === "on" }); return;
        case "ldrdecsw":   post({ type: "set", decsw: val !== "off" }); return;
        case "ldrmode":    post({ type: "set", mono: val === "mono" }); return;
      }
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
