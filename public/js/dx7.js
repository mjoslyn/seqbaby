// ---- Yamaha DX7 ---------------------------------------------------------
// The DX7 has no filter, no sub oscillator and no analogue anything. Six sine
// operators, wired into one of 32 fixed algorithms, is the whole instrument —
// every sound it ever made came out of deciding which sines modulate which:
//
//   alg 5              alg 16                    alg 32
//   6   4   2          6                         6 5 4 3 2 1
//   |   |   |          |                         | | | | | |
//   5   3   1          5  3                      ▼ ▼ ▼ ▼ ▼ ▼
//   ▼   ▼   ▼           \ |                        (six carriers)
//                        4  2
//                         \ |
//                          1 ▼
//
// Four things make it sound like a DX7 rather than "an FM synth":
//
// - **An operator's output level is its modulation index.** The level control
//   is exponential, so the top of the slider is where the spectrum explodes and
//   the bottom is a whisper. Everything about programming one is level.
// - **Every operator has its own envelope**, which means the *timbre* has an
//   envelope. A modulator that decays fast under a carrier that doesn't is a
//   struck sound; it's the whole reason the DX7's electric pianos and basses
//   sounded like nothing before them.
// - **Feedback** on one operator per algorithm — the only thing in the machine
//   that makes anything other than a sine's harmonics. Wound up it goes to
//   noise, which is where the DX's breath and cymbals come from.
// - **Key scaling and velocity go to the modulators, not the amplifier.** Play
//   harder and the modulation index rises: the note gets brighter, not just
//   louder. Play higher and it falls, or the top octave screams.
//
// The 32 algorithms here are not from memory — they're decoded from the
// bit-encoded table in Dexed's fm_core.cc (Apache 2.0, Google's music-synth
// code), which is itself a faithful transcription of the machine's ROM. Each
// entry lists, per operator, which operators modulate it, which are carriers,
// and where the feedback path runs.
//
// Simplifications, stated plainly: the envelopes are four-stage ADSR rather
// than the DX7's four rate/level pairs (so you can't program a rising decay);
// key scaling is one global depth on the modulators rather than a breakpoint
// with two curves per operator; the LFO is global with no per-op sensitivity;
// and there's no per-op amp-mod switch. What is here is the architecture, the
// exponential level law, the per-operator envelopes and the feedback.

/** @typedef {import("./types.js").Track} Track */

// Processor source. Kept as a string so it travels with the module graph and
// registers from a Blob URL — no extra fetch, no coupling to the versioned
// asset path (same approach as tb303.js and virus.js). No backticks or ${ here.
const DX7_PROCESSOR_SOURCE = `
const MAXV = 16;     // voices, as the machine had
const NOP  = 6;      // operators
const BLK  = 16;     // control-block size: envelopes, ratios, gains, the LFO

// Sine table. Six operators across sixteen voices is a hundred sines a sample,
// which is exactly why the DX7 had a sine ROM rather than a sine calculation.
const LUTN = 2048;
const SIN = new Float32Array(LUTN + 1);
for (let i = 0; i <= LUTN; i++) SIN[i] = Math.sin(2 * Math.PI * i / LUTN);
function sine(p) {
  const x = (p - Math.floor(p)) * LUTN;
  const i = x | 0;
  const f = x - i;
  return SIN[i] + (SIN[i + 1] - SIN[i]) * f;
}

// The 32 algorithms. mod[i] lists the operators modulating operator i+1, car
// lists the carriers, fb is [source, destination] for the feedback path — the
// same operator in all but algorithms 4 and 6, where the loop spans three and
// two operators respectively.
const ALG = [
  { mod: [[2],[],[4],[5],[6],[]], car: [1,3], fb: [6,6] },
  { mod: [[2],[],[4],[5],[6],[]], car: [1,3], fb: [2,2] },
  { mod: [[2],[3],[],[5],[6],[]], car: [1,4], fb: [6,6] },
  { mod: [[2],[3],[],[5],[6],[]], car: [1,4], fb: [4,6] },
  { mod: [[2],[],[4],[],[6],[]], car: [1,3,5], fb: [6,6] },
  { mod: [[2],[],[4],[],[6],[]], car: [1,3,5], fb: [5,6] },
  { mod: [[2],[],[4,5],[],[6],[]], car: [1,3], fb: [6,6] },
  { mod: [[2],[],[4,5],[],[6],[]], car: [1,3], fb: [4,4] },
  { mod: [[2],[],[4,5],[],[6],[]], car: [1,3], fb: [2,2] },
  { mod: [[2],[3],[],[5,6],[],[]], car: [1,4], fb: [3,3] },
  { mod: [[2],[3],[],[5,6],[],[]], car: [1,4], fb: [6,6] },
  { mod: [[2],[],[4,5,6],[],[],[]], car: [1,3], fb: [2,2] },
  { mod: [[2],[],[4,5,6],[],[],[]], car: [1,3], fb: [6,6] },
  { mod: [[2],[],[4],[5,6],[],[]], car: [1,3], fb: [6,6] },
  { mod: [[2],[],[4],[5,6],[],[]], car: [1,3], fb: [2,2] },
  { mod: [[2,3,5],[],[4],[],[6],[]], car: [1], fb: [6,6] },
  { mod: [[2,3,5],[],[4],[],[6],[]], car: [1], fb: [2,2] },
  { mod: [[2,3,4],[],[],[5],[6],[]], car: [1], fb: [3,3] },
  { mod: [[2],[3],[],[6],[6],[]], car: [1,4,5], fb: [6,6] },
  { mod: [[3],[3],[],[5,6],[],[]], car: [1,2,4], fb: [3,3] },
  { mod: [[3],[3],[],[6],[6],[]], car: [1,2,4,5], fb: [3,3] },
  { mod: [[2],[],[6],[6],[6],[]], car: [1,3,4,5], fb: [6,6] },
  { mod: [[],[3],[],[6],[6],[]], car: [1,2,4,5], fb: [6,6] },
  { mod: [[],[],[6],[6],[6],[]], car: [1,2,3,4,5], fb: [6,6] },
  { mod: [[],[],[],[6],[6],[]], car: [1,2,3,4,5], fb: [6,6] },
  { mod: [[],[3],[],[5,6],[],[]], car: [1,2,4], fb: [6,6] },
  { mod: [[],[3],[],[5,6],[],[]], car: [1,2,4], fb: [3,3] },
  { mod: [[2],[],[4],[5],[],[]], car: [1,3,6], fb: [5,5] },
  { mod: [[],[],[4],[],[6],[]], car: [1,2,3,5], fb: [6,6] },
  { mod: [[],[],[4],[5],[],[]], car: [1,2,3,6], fb: [5,5] },
  { mod: [[],[],[],[],[6],[]], car: [1,2,3,4,5], fb: [6,6] },
  { mod: [[],[],[],[],[],[]], car: [1,2,3,4,5,6], fb: [6,6] },
];

function makeVoice() {
  return {
    id: -1, note: 60, active: false, gate: false, vel: 1, amp: 0,
    freq: 440, target: 440, glide: 1,
    ph:  new Float64Array(NOP),
    inc: new Float64Array(NOP),
    g:   new Float64Array(NOP),   // unit gain: envelope x level curve x sens
    env: new Float64Array(NOP),
    out: new Float64Array(NOP),   // scaled: cycles for a modulator, level for a carrier
    stage: new Int8Array(NOP),    // 0 idle, 1 attack, 2 decay, 3 sustain, 4 release
    fb1: 0, fb2: 0,               // last two feedback-source outputs
    peg: 0,                       // pitch envelope, 1 -> 0
  };
}

class Dx7Processor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    const a = (name, defaultValue, minValue, maxValue) =>
      ({ name, defaultValue, minValue, maxValue, automationRate: "a-rate" });
    // Everything an operator owns is k-rate: it is read once per control block,
    // which is all a per-note envelope or a frequency ratio can act on anyway.
    // An LFO connection and an automation ramp both still work — the value is
    // simply sampled at the top of each block.
    const k = (name, defaultValue, minValue, maxValue) =>
      ({ name, defaultValue, minValue, maxValue, automationRate: "k-rate" });
    const p = [
      // The four track sliders
      a("bright", 0.5, 0, 1), a("feedback", 0.25, 0, 1),
      k("modDecay", 0.5, 0, 1), k("decay", 0.4, 0, 1),
      // Globals
      k("ks", 0.35, 0, 1), k("vs", 0.5, 0, 1),
      k("peg", 0, -1, 1), k("pegr", 0.3, 0, 1),
      k("lfor", 0.35, 0, 1), k("lfod", 0, 0, 1), k("pmd", 0, 0, 1), k("amd", 0, 0, 1),
    ];
    // Per operator: level, coarse ratio, fine ratio, detune, and an envelope.
    for (let i = 1; i <= NOP; i++) {
      p.push(k("lv" + i, 0, 0, 1));
      p.push(k("rt" + i, 1, 0, 31));
      p.push(k("fn" + i, 0, 0, 0.99));
      p.push(k("dt" + i, 0, -7, 7));
      p.push(k("ea" + i, 0.01, 0, 1));
      p.push(k("ed" + i, 0.4,  0, 1));
      p.push(k("es" + i, 0.7,  0, 1));
      p.push(k("er" + i, 0.3,  0, 1));
    }
    return p;
  }

  constructor() {
    super();
    this.sr = sampleRate;
    this.alive = true;
    this.queue = [];
    this.voices = []; for (let i = 0; i < MAXV; i++) this.voices.push(makeVoice());
    this.tick = 0;
    this.lastFreq = 440;
    this.glideSec = 0;
    // Discrete settings arrive as messages, not params.
    this.algo = 0;                        // 0-based
    this.lfoWave = 0;                     // 0 tri, 1 saw down, 2 saw up, 3 square, 4 sine, 5 s+h
    this.lfoKeySync = 1;
    this.fixed = new Int8Array(NOP);      // per-op: ratio (0) or fixed frequency (1)
    this.lfoPh = 0; this.lfoSH = 0; this.lfoDelay = 0;
    this.setAlgorithm(0);
    this.port.onmessage = (e) => this.onMessage(e.data);
  }

  // Flatten the algorithm into typed arrays: the per-sample loop should not be
  // walking arrays of arrays.
  setAlgorithm(n) {
    this.algo = Math.max(0, Math.min(31, n | 0));
    const a = ALG[this.algo];
    this.modIdx = new Int8Array(NOP * 3);
    this.modCnt = new Int8Array(NOP);
    for (let i = 0; i < NOP; i++) {
      const m = a.mod[i];
      this.modCnt[i] = m.length;
      for (let j = 0; j < m.length; j++) this.modIdx[i * 3 + j] = m[j] - 1;
    }
    this.isCar = new Int8Array(NOP);
    for (const c of a.car) this.isCar[c - 1] = 1;
    this.fbSrc = a.fb[0] - 1;
    this.fbDst = a.fb[1] - 1;
    // Carriers sum straight into the output, so keep the level in range whether
    // the algorithm has one carrier or six.
    this.carGain = 1 / Math.sqrt(a.car.length);
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
      if (m.algo !== undefined) this.setAlgorithm(m.algo);
      if (m.lfoWave !== undefined) this.lfoWave = m.lfoWave | 0;
      if (m.lfoKeySync !== undefined) this.lfoKeySync = m.lfoKeySync ? 1 : 0;
      if (m.fixOp !== undefined) this.fixed[m.fixOp | 0] = m.fixOn ? 1 : 0;
      if (m.glide !== undefined) this.glideSec = Math.max(0, m.glide);
    } else if (m.type === "dispose") {
      this.alive = false;
    }
  }

  noteOn(ev) {
    let v = null;
    for (const c of this.voices) if (!c.active) { v = c; break; }
    if (!v) {
      // Steal the quietest, and prefer one already released over a held note.
      let worst = Infinity;
      for (const c of this.voices) { const s = c.gate ? c.amp + 10 : c.amp; if (s < worst) { worst = s; v = c; } }
    }
    v.id = ev.id; v.note = ev.note; v.vel = ev.vel;
    v.active = true; v.gate = true; v.amp = 0;
    v.target = ev.freq;
    const gl = ev.glide > 0 ? ev.glide : this.glideSec;
    if (gl > 0) { v.freq = this.lastFreq; v.glide = 1 - Math.exp(-3 / (gl * this.sr / BLK)); }
    else { v.freq = ev.freq; v.glide = 1; }
    this.lastFreq = ev.freq;
    v.peg = 1;
    v.fb1 = 0; v.fb2 = 0;
    for (let i = 0; i < NOP; i++) { v.stage[i] = 1; v.env[i] = 0; v.ph[i] = 0; v.out[i] = 0; }
    // Operators start in phase on every note, as the machine does — it is why
    // a DX7 attack is identical every time, and why it sounds so consistent.
    if (this.lfoKeySync) { this.lfoPh = 0; this.lfoDelay = 0; }
  }

  noteOff(id) {
    for (const v of this.voices) if (v.active && v.id === id && v.gate) {
      v.gate = false;
      for (let i = 0; i < NOP; i++) v.stage[i] = 4;
    }
  }

  process(inputs, outputs, params) {
    if (!this.alive) return false;
    const out = outputs[0];
    if (!out || !out[0]) return true;
    const buf = out[0];
    const N = buf.length;
    buf.fill(0);

    const sr = this.sr, n0 = currentFrame, P = params;
    const kv = (p) => p[0];
    const modDecK = kv(P.modDecay), decK = kv(P.decay);
    const ks = kv(P.ks), vs = kv(P.vs);
    const pegAmt = kv(P.peg), pegR = kv(P.pegr);
    const lfoRate = 0.06 + Math.pow(kv(P.lfor), 2.2) * 24;      // 0.06 .. 24 Hz
    const lfoDelaySec = Math.pow(kv(P.lfod), 2) * 4;
    const pmd = kv(P.pmd), amd = kv(P.amd);

    const bps = sr / BLK;
    // Decay and release are scaled by the two macros: modulators follow "mod
    // dec" (how fast the timbre falls away), carriers follow "decay".
    const modDecScale = Math.pow(2, (modDecK - 0.5) * 5);
    const carDecScale = Math.pow(2, (decK   - 0.5) * 5);
    const pegC = 1 - Math.exp(-1 / (Math.max(0.004, 0.006 * Math.pow(400, pegR)) * bps));

    const modIdx = this.modIdx, modCnt = this.modCnt, isCar = this.isCar;
    const fbSrc = this.fbSrc, fbDst = this.fbDst, carGain = this.carGain;

    // Per-operator settings: identical for every voice, so resolve them once.
    const T = this.tmp || (this.tmp = {
      ratio: new Float64Array(NOP), fixHz: new Float64Array(NOP), lvl: new Float64Array(NOP),
      atkC: new Float64Array(NOP), decC: new Float64Array(NOP), relC: new Float64Array(NOP),
      susL: new Float64Array(NOP), scale: new Float64Array(NOP),
    });
    const ratio = T.ratio, fixHz = T.fixHz, lvl = T.lvl;
    const atkC = T.atkC, decC = T.decC, relC = T.relC, susL = T.susL, scale = T.scale;

    for (let base = 0; base < N; base += BLK) {
      const blk = Math.min(BLK, N - base);
      const frame = n0 + base;

      while (this.queue.length && this.queue[0].at <= frame) {
        const ev = this.queue.shift();
        if (ev.off) this.noteOff(ev.id); else this.noteOn(ev);
      }
      if (this.allOff !== undefined && frame >= this.allOff) {
        for (const v of this.voices) if (v.gate) { v.gate = false; for (let i = 0; i < NOP; i++) v.stage[i] = 4; }
        this.allOff = undefined;
      }

      const i0 = base;
      const bright = (P.bright.length > 1 ? P.bright[i0] : P.bright[0]) * 2;
      const fbK    = P.feedback.length > 1 ? P.feedback[i0] : P.feedback[0];
      // Feedback is squared: the useful range of the machine's 0-7 is all at
      // the top, where it stops being a harmonic and starts being noise.
      const fbAmt = fbK * fbK * 3;

      // ---- LFO (one for the whole instrument, as on the DX7) ----
      this.lfoPh += lfoRate * BLK / sr;
      if (this.lfoPh >= 1) {
        this.lfoPh -= Math.floor(this.lfoPh);
        this.lfoSH = Math.random() * 2 - 1;
      }
      const lp = this.lfoPh;
      let lfo;
      switch (this.lfoWave) {
        case 1:  lfo = 1 - 2 * lp; break;                                  // saw down
        case 2:  lfo = 2 * lp - 1; break;                                  // saw up
        case 3:  lfo = lp < 0.5 ? 1 : -1; break;                           // square
        case 4:  lfo = sine(lp); break;                                    // sine
        case 5:  lfo = this.lfoSH; break;                                  // sample + hold
        default: lfo = lp < 0.5 ? 4 * lp - 1 : 3 - 4 * lp;                 // triangle
      }
      if (lfoDelaySec > 0 && this.lfoDelay < 1) {
        this.lfoDelay = Math.min(1, this.lfoDelay + BLK / sr / lfoDelaySec);
        lfo *= this.lfoDelay * this.lfoDelay;
      } else this.lfoDelay = 1;
      const pitchLfo = Math.pow(2, pmd * lfo / 12);          // up to a semitone
      const ampLfo = 1 - amd * (0.5 - 0.5 * lfo);

      for (let i = 0; i < NOP; i++) {
        const coarse = Math.round(kv(P["rt" + (i + 1)]));
        const fine = kv(P["fn" + (i + 1)]);
        // Detune is the machine's own unit: seven steps of about 1.75 cents,
        // which is exactly enough to make two operators at the same ratio beat.
        const det = Math.pow(2, kv(P["dt" + (i + 1)]) * 1.75 / 1200);
        // Coarse 0 is the machine's half-ratio; the fine control multiplies.
        ratio[i] = (coarse === 0 ? 0.5 : coarse) * (1 + fine) * det;
        // Fixed mode: coarse picks the decade, fine sweeps within it — 1Hz to
        // ~10kHz, exactly the machine's fixed-frequency law. A fixed operator
        // ignores the note, the pitch envelope and the LFO, as it does there.
        fixHz[i] = Math.pow(10, (coarse % 4) + fine) * det;
        // Output level is exponential. Half-way is a sixteenth of full scale:
        // that is what makes the top of the slider the only place a modulator
        // gets violent, and it is the single most DX7 thing about the panel.
        const L = kv(P["lv" + (i + 1)]);
        lvl[i] = L <= 0.004 ? 0 : Math.pow(2, (L - 1) * 7);
        const dScale = isCar[i] ? carDecScale : modDecScale;
        const a = kv(P["ea" + (i + 1)]), d = kv(P["ed" + (i + 1)]), r = kv(P["er" + (i + 1)]);
        atkC[i] = 1 - Math.exp(-1 / (Math.max(0.0005, 0.0008 * Math.pow(3000, a)) * bps));
        decC[i] = 1 - Math.exp(-1 / (Math.max(0.002, 0.004 * Math.pow(1500, d)) * dScale * bps));
        relC[i] = 1 - Math.exp(-1 / (Math.max(0.003, 0.005 * Math.pow(1000, r)) * dScale * bps));
        susL[i] = kv(P["es" + (i + 1)]);
        // A carrier's output is amplitude; a modulator's is phase, in cycles.
        scale[i] = isCar[i] ? carGain : bright * 1.8;
      }

      for (const v of this.voices) {
        if (!v.active) continue;

        // ---- envelopes + pitch (block rate) ----
        let amp = 0, live = false, rising = false;
        for (let i = 0; i < NOP; i++) {
          const st = v.stage[i];
          if (st === 1) { v.env[i] += (1.02 - v.env[i]) * atkC[i]; if (v.env[i] >= 1) { v.env[i] = 1; v.stage[i] = 2; } }
          else if (st === 2) { v.env[i] += (susL[i] - v.env[i]) * decC[i]; if (Math.abs(v.env[i] - susL[i]) < 1e-4) v.stage[i] = 3; }
          else if (st === 4) { v.env[i] -= v.env[i] * relC[i]; if (v.env[i] < 1e-5) v.env[i] = 0; }
          if (isCar[i]) {
            if (v.env[i] > amp) amp = v.env[i];
            if (v.env[i] > 1e-5) live = true;
            if (v.stage[i] === 1) rising = true;
          }
        }
        v.amp = amp;
        // The note is over when every carrier has faded, whatever the
        // modulators are still doing — they are inaudible on their own. A held
        // note whose carriers decayed to a zero sustain is over too: nothing
        // brings it back, and the operators would otherwise run all bar.
        if (!live && !rising) { v.active = false; continue; }

        if (v.glide < 1) {
          v.freq += (v.target - v.freq) * v.glide;
          if (Math.abs(v.target - v.freq) < 0.01) { v.freq = v.target; v.glide = 1; }
        }
        if (v.peg > 1e-4) v.peg -= v.peg * pegC; else v.peg = 0;
        const pitch = v.freq * pitchLfo * Math.pow(2, pegAmt * v.peg * 2);

        // Key scaling and velocity go to the modulators: high notes get less
        // modulation (or the top octave screams), hard hits get more.
        const keyAmt = Math.pow(2, -ks * (v.note - 48) / 12);
        const velMod = Math.pow(Math.max(0.02, v.vel), vs * 2);

        for (let i = 0; i < NOP; i++) {
          const f = this.fixed[i] ? fixHz[i] : pitch * ratio[i];
          v.inc[i] = Math.min(0.49, f / sr);
          v.g[i] = isCar[i]
            ? v.env[i] * lvl[i] * v.vel
            : v.env[i] * lvl[i] * keyAmt * velMod;
        }

        const ph = v.ph, inc = v.inc, g = v.g, o = v.out;
        const gain = ampLfo;

        for (let n = 0; n < blk; n++) {
          let acc = 0;
          // Operators run 6 down to 1: in every algorithm a modulator has a
          // higher number than what it modulates, so one pass is enough.
          for (let i = NOP - 1; i >= 0; i--) {
            let m = 0;
            const c = modCnt[i], b = i * 3;
            if (c > 0) {
              m = o[modIdx[b]];
              if (c > 1) m += o[modIdx[b + 1]];
              if (c > 2) m += o[modIdx[b + 2]];
            }
            // The feedback operator reads its own last two outputs, averaged —
            // the machine does the same, and without it the loop just squeals.
            if (i === fbDst) m += (v.fb1 + v.fb2) * 0.5 * fbAmt;
            // The feedback tap is the operator's own output before the cycles
            // scale, so winding the feedback up doesn't also multiply by
            // whatever brightness the modulator happens to be running at.
            const r = sine(ph[i] + m) * g[i];
            o[i] = r * scale[i];
            if (i === fbSrc) { v.fb2 = v.fb1; v.fb1 = r; }
            ph[i] += inc[i];
            if (ph[i] >= 1) ph[i] -= Math.floor(ph[i]);
            if (isCar[i]) acc += o[i];
          }
          buf[base + n] += acc * gain;
        }
      }
    }

    // Sixteen voices of six operators add up; keep the bus honest.
    for (let n = 0; n < N; n++) buf[n] = Math.tanh(buf[n] * 0.8);
    return true;
  }
}

registerProcessor("yamaha-dx7", Dx7Processor);
`;

// One registration per AudioContext, single-flight; a failure clears the slot
// so the next attempt retries (same contract as the Plaits, 303 and Virus
// worklets).
const _loads = new WeakMap();
const _ready = new WeakSet();

/**
 * Register the yamaha-dx7 processor on this context. Called at init() so the
 * await on the play path has already resolved by the time a voice is built.
 * @param {BaseAudioContext} ctx @returns {Promise<void>}
 */
export function loadDx7Worklet(ctx) {
  if (!ctx?.audioWorklet) return Promise.reject(new Error("no AudioWorklet"));
  let p = _loads.get(ctx);
  if (!p) {
    const url = URL.createObjectURL(new Blob([DX7_PROCESSOR_SOURCE], { type: "text/javascript" }));
    p = ctx.audioWorklet.addModule(url)
      .then(() => { URL.revokeObjectURL(url); _ready.add(ctx); })
      .catch((e) => { URL.revokeObjectURL(url); _loads.delete(ctx); throw e; });
    _loads.set(ctx, p);
  }
  return p;
}

/** Has the processor finished registering on this context? */
export function dx7Ready(ctx) { return !!ctx && _ready.has(ctx); }

// ---- panel wiring -------------------------------------------------------
// Every control is `d` + a short key, and the same short key spells its LFO
// target (`dx7_<short>`) and its automation lane (`dx7.<short>`) — so the three
// namespaces are one list rather than three, and adding a control is one line.

/** Per-operator controls, in panel column order. */
export const DX7_OP_CTLS = ["lvl", "rat", "fin", "det", "atk", "dec", "sus", "rel"];
export const DX7_OPS = [1, 2, 3, 4, 5, 6];

/** Global (non-per-operator) numeric controls, in panel order. */
export const DX7_GLOBAL_CTLS = ["ks", "vs", "peg", "pegr", "lfor", "lfod", "pmd", "amd"];

/** Short keys — what follows `dx7_` / `dx7.`; prefix with "d" for the param. */
export const DX7_MOD_KEYS = [
  ...DX7_GLOBAL_CTLS,
  ...DX7_OPS.flatMap(i => DX7_OP_CTLS.map(c => `${i}${c}`)),
];

/** Track param keys — what render.js / session.js / the voice walk. */
export const DX7_NUM_KEYS = DX7_MOD_KEYS.map(k => `d${k}`);
export const DX7_SEL_KEYS = ["dalg", "dlfow", "dlfok", ...DX7_OPS.map(i => `d${i}fix`)];

const OP_CTL_LABEL = {
  lvl: "level", rat: "ratio", fin: "fine", det: "detune",
  atk: "attack", dec: "decay", sus: "sustain", rel: "release",
};
const GLOBAL_LABEL = {
  ks: "dx7 key scale", vs: "dx7 velocity", peg: "dx7 pitch env", pegr: "dx7 pitch env rate",
  lfor: "dx7 lfo speed", lfod: "dx7 lfo delay", pmd: "dx7 pitch mod", amd: "dx7 amp mod",
};

/** Picker labels for the mod / automation menus. */
export const DX7_MOD_LABELS = Object.fromEntries(DX7_MOD_KEYS.map(k => [
  k,
  GLOBAL_LABEL[k] ?? `dx7 op${k[0]} ${OP_CTL_LABEL[k.slice(1)]}`,
]));

/** [min, max] per short key. Modulation and automation both map through this,
 *  so a lane spans the slider's own range rather than a hardcoded 0..1. Keys
 *  not listed are plain 0..1 — kept in the table anyway so there's one path. */
const CTL_RANGE = { rat: [0, 31], det: [-7, 7], fin: [0, 0.99] };
export const DX7_MOD_RANGE = Object.fromEntries(DX7_MOD_KEYS.map(k => {
  if (k === "peg") return [k, [-1, 1]];                     // bipolar pitch env
  if (GLOBAL_LABEL[k]) return [k, [0, 1]];
  return [k, CTL_RANGE[k.slice(1)] ?? [0, 1]];              // per-operator
}));

/** 0..1 → the parameter's own units (automation lanes, and the mod base). */
export function dx7FromUnit(short, u) {
  const [lo, hi] = DX7_MOD_RANGE[short] ?? [0, 1];
  return lo + Math.max(0, Math.min(1, u)) * (hi - lo);
}

// An init voice: one carrier, one modulator at a musical level, everything else
// silent. It is what the machine powers up with, and the honest starting point
// for programming — the presets below are where the sounds are.
export const DX7_DEFAULTS = (() => {
  const d = {
    dalg: "1", dlfow: "tri", dlfok: "on",
    dks: 0.35, dvs: 0.5, dpeg: 0, dpegr: 0.3,
    dlfor: 0.35, dlfod: 0, dpmd: 0, damd: 0,
  };
  for (const i of DX7_OPS) {
    d[`d${i}lvl`] = i === 1 ? 1 : i === 2 ? 0.72 : 0;
    d[`d${i}rat`] = 1;
    d[`d${i}fin`] = 0;
    d[`d${i}det`] = 0;
    d[`d${i}atk`] = 0.01;
    d[`d${i}dec`] = 0.45;
    d[`d${i}sus`] = i === 1 ? 0.8 : 0.4;
    d[`d${i}rel`] = 0.3;
    d[`d${i}fix`] = "ratio";
  }
  return d;
})();

// Voices in the spirit of the machine's own — not its ROM patches, which are
// 155-byte sysex blobs of controls this panel doesn't have. Each one is a
// complete set of panel values, so loading it leaves nothing of the last.
const op = (lvl, rat, fin, atk, dec, sus, rel, det = 0, fix = "ratio") =>
  ({ lvl, rat, fin, atk, dec, sus, rel, det, fix });

const PRESET_VOICES = {
  "init": { alg: 1, bright: 0.5, fb: 0.25, ks: 0.35, vs: 0.5, ops: [
    op(1, 1, 0, 0.01, 0.45, 0.8, 0.3), op(0.72, 1, 0, 0.01, 0.45, 0.4, 0.3),
    op(0, 1, 0, 0.01, 0.45, 0.4, 0.3), op(0, 1, 0, 0.01, 0.45, 0.4, 0.3),
    op(0, 1, 0, 0.01, 0.45, 0.4, 0.3), op(0, 1, 0, 0.01, 0.45, 0.4, 0.3)] },

  // Three carrier/modulator pairs. The bark is op 2 at a high ratio decaying
  // fast under a carrier that doesn't — the tine hitting the tone bar.
  "e.piano": { alg: 5, bright: 0.52, fb: 0.12, ks: 0.55, vs: 0.85, ops: [
    op(1,    1,  0,    0.005, 0.42, 0.28, 0.25),
    op(0.78, 14, 0,    0.005, 0.16, 0,    0.2),
    op(0.86, 1,  0,    0.005, 0.5,  0.34, 0.28),
    op(0.6,  1,  0,    0.005, 0.34, 0.1,  0.22),
    op(0.5,  1,  0,    0.02,  0.62, 0.5,  0.35, 3),
    op(0.42, 2,  0.01, 0.02,  0.4,  0.2,  0.3, -3)] },

  // One carrier, everything else stacked into it, feedback wound up for grit.
  "bass": { alg: 16, bright: 0.46, fb: 0.5, ks: 0.2, vs: 0.6, ops: [
    op(1,    1, 0,    0.002, 0.32, 0.18, 0.16),
    op(0.62, 1, 0,    0.002, 0.24, 0.06, 0.14),
    op(0.4,  2, 0,    0.002, 0.2,  0,    0.14),
    op(0.55, 1, 0,    0.002, 0.26, 0.1,  0.16),
    op(0.34, 0, 0,    0.002, 0.3,  0.14, 0.16),
    op(0.3,  3, 0.02, 0.002, 0.18, 0,    0.14)] },

  // Inharmonic ratios and a long tail — the sound that put the DX7 on every
  // record of 1984. Nothing here is a whole number but the carriers.
  "bell": { alg: 5, bright: 0.6, fb: 0.05, ks: 0.5, vs: 0.7, ops: [
    op(1,    1, 0,    0.002, 0.78, 0, 0.72),
    op(0.7,  3, 0.5,  0.002, 0.6,  0, 0.5),
    op(0.72, 2, 0,    0.002, 0.72, 0, 0.66),
    op(0.62, 7, 0.13, 0.002, 0.5,  0, 0.44),
    op(0.5,  1, 0.02, 0.002, 0.82, 0, 0.76, 4),
    op(0.55, 11, 0.4, 0.002, 0.42, 0, 0.4, -4)] },

  // Slow attack on the modulators, so the spectrum opens after the note does.
  "brass": { alg: 18, bright: 0.55, fb: 0.35, ks: 0.3, vs: 0.65, ops: [
    op(1,    1, 0,    0.12, 0.5, 0.75, 0.3),
    op(0.62, 1, 0,    0.3,  0.5, 0.6,  0.3),
    op(0.5,  1, 0.01, 0.34, 0.5, 0.55, 0.3, 3),
    op(0.45, 2, 0,    0.26, 0.5, 0.5,  0.3),
    op(0.5,  1, 0,    0.2,  0.5, 0.6,  0.3),
    op(0.34, 1, 0.02, 0.3,  0.5, 0.45, 0.3, -3)] },

  // Everything decays, nothing sustains, and the modulator goes first.
  "marimba": { alg: 5, bright: 0.5, fb: 0.08, ks: 0.6, vs: 0.8, ops: [
    op(1,    1, 0, 0.002, 0.4,  0, 0.3),
    op(0.66, 7, 0, 0.002, 0.14, 0, 0.12),
    op(0.55, 1, 0, 0.002, 0.34, 0, 0.28),
    op(0.5,  4, 0, 0.002, 0.1,  0, 0.1),
    op(0.34, 1, 0, 0.002, 0.46, 0, 0.36, 5),
    op(0.4,  3, 0, 0.002, 0.08, 0, 0.1)] },

  // Algorithm 32 is six carriers and no modulation at all — which is to say it
  // is a drawbar organ, if you tune the operators in octaves and fifths.
  "organ": { alg: 32, bright: 0.5, fb: 0.15, ks: 0.1, vs: 0.3, ops: [
    op(1,    1, 0, 0.006, 0.3, 1,    0.1),
    op(0.86, 2, 0, 0.006, 0.3, 1,    0.1),
    op(0.66, 3, 0, 0.006, 0.3, 0.95, 0.1),
    op(0.6,  4, 0, 0.006, 0.3, 0.95, 0.1),
    op(0.5,  6, 0, 0.006, 0.3, 0.9,  0.1),
    op(0.46, 8, 0, 0.006, 0.3, 0.9,  0.1)] },

  // The three-operator feedback loop of algorithm 4, detuned, opening slowly.
  "pad": { alg: 4, bright: 0.44, fb: 0.3, ks: 0.4, vs: 0.4, ops: [
    op(1,    1, 0,    0.3,  0.6, 0.85, 0.7, 3),
    op(0.5,  1, 0.01, 0.4,  0.6, 0.7,  0.6),
    op(0.42, 2, 0,    0.45, 0.6, 0.6,  0.6),
    op(0.9,  1, 0,    0.34, 0.6, 0.85, 0.7, -3),
    op(0.46, 3, 0.01, 0.4,  0.6, 0.65, 0.6),
    op(0.38, 1, 0.02, 0.5,  0.6, 0.6,  0.6)] },
};

/**
 * A preset as a complete set of track params (every panel control, so nothing
 * of the previous voice survives). The four track sliders come with it —
 * brightness and feedback are as much part of an FM voice as the operators.
 * @param {string} name
 * @returns {Record<string, number|string>|null}
 */
export function dx7Preset(name) {
  const v = PRESET_VOICES[name];
  if (!v) return null;
  const p = { ...DX7_DEFAULTS, dalg: String(v.alg) };
  if (v.ks != null) p.dks = v.ks;
  if (v.vs != null) p.dvs = v.vs;
  v.ops.forEach((o, idx) => {
    const i = idx + 1;
    p[`d${i}lvl`] = o.lvl; p[`d${i}rat`] = o.rat; p[`d${i}fin`] = o.fin;
    p[`d${i}det`] = o.det; p[`d${i}atk`] = o.atk; p[`d${i}dec`] = o.dec;
    p[`d${i}sus`] = o.sus; p[`d${i}rel`] = o.rel; p[`d${i}fix`] = o.fix;
  });
  // The four track sliders come with the voice — brightness and feedback are as
  // much a part of an FM patch as the operators, and the two decay macros have
  // to land back at neutral or the last preset's timing bleeds into this one.
  p.harm = v.bright;
  p.timb = v.fb;
  p.morph = v.modDec ?? 0.5;
  p.decay = v.dec ?? 0.5;
  return p;
}

export const DX7_PRESET_NAMES = Object.keys(PRESET_VOICES);

// A one-line diagram per algorithm for the dropdown: "1←2 3←4←5←6" reads as
// "operator 2 modulates 1, and 6 through 4 stack into 3", which is the only
// thing about an algorithm anyone needs at picking time.
export const DX7_ALG_LABELS = [
  "1←2 3←4←5←6", "1←2 3←4←5←6", "1←2←3 4←5←6", "1←2←3 4←5←6",
  "1←2 3←4 5←6", "1←2 3←4 5←6", "1←2 3←4+5←6", "1←2 3←4+5←6",
  "1←2 3←4+5←6", "1←2←3 4←5+6", "1←2←3 4←5+6", "1←2 3←4+5+6",
  "1←2 3←4+5+6", "1←2 3←4←5+6", "1←2 3←4←5+6", "1←2+3←4+5←6",
  "1←2+3←4+5←6", "1←2+3+4←5←6", "1←2←3 4←6 5←6", "1←3 2←3 4←5+6",
  "1←3 2←3 4←6 5←6", "1←2 3←6 4←6 5←6", "1 2←3 4←6 5←6", "1 2 3←6 4←6 5←6",
  "1 2 3 4←6 5←6", "1 2←3 4←5+6", "1 2←3 4←5+6", "1←2 3←4←5 6",
  "1 2 3←4 5←6", "1 2 3←4←5 6", "1 2 3 4 5←6", "1 2 3 4 5 6",
];

/**
 * Which operators you actually hear in this algorithm — the carriers. Read back
 * out of the diagram rather than kept as a second table: a carrier is exactly
 * an operator with no arrow pointing into it, which is what the leading number
 * of each group in the label means.
 * @param {number} alg 1-based algorithm number @returns {number[]}
 */
export function dx7Carriers(alg) {
  const d = DX7_ALG_LABELS[Math.max(0, Math.min(31, (alg | 0) - 1))] || "";
  return d.split(" ").map(g => Number(g.split("←")[0])).filter(Boolean);
}

// Which operator carries the feedback loop, per algorithm — the panel says so,
// because "feedback" means nothing until you know where it is wired.
export const DX7_ALG_FEEDBACK = [
  "6", "2", "6", "6→4", "6", "6→5", "6", "4", "2", "3", "6", "2",
  "6", "6", "2", "6", "2", "3", "6", "3", "3", "6", "6", "6",
  "6", "6", "3", "5", "6", "5", "6", "6",
];

const LFO_WAVES = { tri: 0, sawdn: 1, sawup: 2, square: 3, sine: 4, sh: 5 };

// Tone wrappers don't accept a native connect() — unwrap to the node underneath.
const nativeIn = (node) => node?.input?.input ?? node?.input ?? node;

/**
 * Build the DX7 voice. Returns null when the worklet isn't registered yet, so
 * the caller can fall back rather than leave the track silent.
 * @param {*} output Tone node the voice writes into.
 */
export function buildDx7Voice(output) {
  const ctx = Tone.getContext().rawContext;
  if (!dx7Ready(ctx)) { loadDx7Worklet(ctx).catch(() => {}); return null; }

  let node;
  try {
    node = new AudioWorkletNode(ctx, "yamaha-dx7",
      { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1] });
  } catch (e) {
    console.warn("yamaha-dx7 worklet node failed", e);
    return null;
  }
  node.connect(nativeIn(output));

  // Track param key → worklet parameter name.
  const PARAM_OF = { harm: "bright", timb: "feedback", morph: "modDecay", decay: "decay" };
  for (const g of DX7_GLOBAL_CTLS) PARAM_OF[`d${g}`] = g;
  const OP_PARAM = { lvl: "lv", rat: "rt", fin: "fn", det: "dt", atk: "ea", dec: "ed", sus: "es", rel: "er" };
  for (const i of DX7_OPS) for (const c of DX7_OP_CTLS) PARAM_OF[`d${i}${c}`] = OP_PARAM[c] + i;

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
      // Discrete settings: the algorithm, the LFO waveform, key sync, and each
      // operator's ratio/fixed switch. None of them is a value to ramp.
      if (key === "dalg")  { post({ type: "set", algo: (Number(val) || 1) - 1 }); return; }
      if (key === "dlfow") { post({ type: "set", lfoWave: LFO_WAVES[val] ?? 0 }); return; }
      if (key === "dlfok") { post({ type: "set", lfoKeySync: val === "off" ? 0 : 1 }); return; }
      const fix = /^d([1-6])fix$/.exec(key);
      if (fix) { post({ type: "set", fixOp: Number(fix[1]) - 1, fixOn: val === "fixed" }); return; }
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
