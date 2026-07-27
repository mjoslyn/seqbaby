// ---- Access Virus -------------------------------------------------------
// The Virus is a digital synth, so "modelling" it means its architecture, not
// its circuits — there aren't any. What makes a Virus sound like a Virus is the
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
//   crossfading their outputs. Almost every other synth of the era had one
//   filter and one response; the Virus's filter pair is the instrument.
// - **A saturation stage between them.** On the real thing it offers everything
//   from a gentle tube-ish curve to a bit reducer, and it sits *inside* the
//   filter chain, so filter 2 cleans up what the saturator did to filter 1's
//   output. That ordering is why a Virus can be filthy and still controlled.
// - **A continuous oscillator shape morph.** One knob sweeps sine → triangle →
//   saw → pulse, with pulse width taking over at the top.
// - **Unison up to 8** with detune and stereo spread — the hypersaw. Detuned
//   copies of the whole oscillator section, panned across the field.
//
// Polyphony lives inside the processor rather than in a `makePolyPool` wrapper.
// That's a real gain beyond tidiness: a pool exposes only voice 0's params to
// modulation (the limitation documented for every other emulator here), while
// one node with one set of AudioParams modulates the whole instrument.
//
// Simplifications, stated plainly: the unison copies share their note's filter
// pair rather than each getting its own (the detune is what you hear, not the
// eight filters); the shape morph crossfades four classic waves rather than
// walking the Virus's 64 spectral wavetables; and there is no oversampling, so
// the saturator aliases — as the hardware's does. Filter cutoff tracks the
// keyboard at a fixed 33%.

/** @typedef {import("./types.js").Track} Track */

// Processor source. Kept as a string so it travels with the module graph and
// registers from a Blob URL — no extra fetch, no coupling to the versioned
// asset path (same approach as tb303.js). No backticks or ${ in here.
const VIRUS_PROCESSOR_SOURCE = `
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
  let sq = p < pw ? 1 : -1;
  sq += blep(p, dt);
  let p2 = p - pw; if (p2 < 0) p2 += 1;
  sq -= blep(p2, dt);
  return saw * (1 - m) + sq * m;
}

// The saturation stage. Sits between the two filters, exactly where the Virus
// puts it, so filter 2 tidies up whatever this does to filter 1's output.
function saturate(x, curve, a, st, si) {
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
    case 3: {                                   // hard — clipping with a knee
      const d = 1 + a * 12; let y = x * d;
      if (y > 1) y = 1; else if (y < -1) y = -1;
      return y * (1 - a * 0.35);
    }
    case 4: {                                   // digital — brickwall, no knee
      const lim = 1 - a * 0.8; let y = x * (1 + a * 4);
      return y > lim ? lim : (y < -lim ? -lim : y);
    }
    case 5: {                                   // wave shaper — folds back
      const y = x * (1 + a * 5);
      return fsin(((y * 0.25) % 1 + 1) % 1);
    }
    case 6: {                                   // rectifier
      const r = x < 0 ? -x : x;
      return x * (1 - a) + (r * 2 - 1) * a * 0.7;
    }
    case 7: {                                   // bit reducer
      const steps = Math.pow(2, 15 - a * 13);
      return Math.round(x * steps) / steps;
    }
    case 8: {                                   // rate reducer (sample + hold)
      const hold = 1 + Math.round(a * 24);
      if (st[si + 1] >= hold) { st[si] = x; st[si + 1] = 0; }
      st[si + 1]++;
      return st[si];
    }
  }
  return x;
}

function makeVoice() {
  return {
    id: -1, note: 60, active: false, gate: false, age: 0,
    freq: 440, target: 440, glide: 1,
    vel: 1,
    aStage: 0, amp: 0,        // amp env: 0 idle, 1 atk, 2 dec, 3 sus, 4 rel
    fStage: 0, fenv: 0,       // filter env
    ph1: new Float64Array(MAXU), ph2: new Float64Array(MAXU), phS: new Float64Array(MAXU),
    det: new Float32Array(MAXU), panL: new Float32Array(MAXU), panR: new Float32Array(MAXU),
    // Filter state, [L,R] x [f1 stage A, f1 stage B, f2] x [ic1eq, ic2eq]
    s: new Float64Array(12),
    // Saturation state per channel: [held sample, counter] x 2
    sat: new Float64Array(4),
    // Per-block filter coefficients
    g1: 0, k1: 1, g2: 0, k2: 1,
  };
}

class VirusProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    const a = (name, defaultValue, minValue, maxValue) =>
      ({ name, defaultValue, minValue, maxValue, automationRate: "a-rate" });
    const k = (name, defaultValue, minValue, maxValue) =>
      ({ name, defaultValue, minValue, maxValue, automationRate: "k-rate" });
    return [
      // The four track sliders
      a("cutoff", 0.6, 0, 1), a("reso", 0.25, 0, 1), a("shape", 0.66, 0, 1), k("decay", 0.4, 0, 1),
      // Oscillator mix — driven by the shared osc1..osc4 sliders
      a("lvl1", 0.8, 0, 1), a("lvl2", 0.6, 0, 1), a("lvlSub", 0, 0, 1), a("lvlNoise", 0, 0, 1),
      // Oscillator detail
      a("pw", 0.5, 0.02, 0.98), a("fm", 0, 0, 1), a("ring", 0, 0, 1),
      k("osc2semi", 0, -24, 24), k("osc2det", 0.08, 0, 1),
      // Unison
      a("uniDet", 0.3, 0, 1), k("uniSpread", 0.6, 0, 1),
      // Filters
      a("cut2", 0, -1, 1), a("balance", 0, 0, 1), a("satAmt", 0.3, 0, 1), a("envAmt", 0.5, -1, 1),
      // Envelopes (decay is the slider above; these are the rest)
      k("attack", 0.02, 0, 1), k("sustain", 0.6, 0, 1), k("release", 0.25, 0, 1),
    ];
  }

  constructor() {
    super();
    this.sr = sampleRate;
    this.alive = true;
    this.queue = [];
    this.voices = []; for (let i = 0; i < MAXV; i++) this.voices.push(makeVoice());
    this.tick = 0;
    this.lastFreq = 440;      // portamento reference: the note played before
    this.glideSec = 0;
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
    v.id = ev.id; v.note = ev.note; v.vel = ev.vel;
    v.active = true; v.gate = true; v.age = ++this.tick;
    v.target = ev.freq;
    // Portamento glides from the note played before, as the Virus does in poly.
    const gl = ev.glide > 0 ? ev.glide : this.glideSec;
    if (gl > 0) { v.freq = this.lastFreq; v.glide = 1 - Math.exp(-3 / (gl * this.sr / BLK)); }
    else { v.freq = ev.freq; v.glide = 1; }
    this.lastFreq = ev.freq;
    v.aStage = 1; v.fStage = 1;
    v.amp = 0; v.fenv = 0;
    v.s.fill(0); v.sat.fill(0);
    // Random start phases: eight unison copies launched together would comb.
    for (let u = 0; u < MAXU; u++) {
      v.ph1[u] = Math.random(); v.ph2[u] = Math.random(); v.phS[u] = Math.random();
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
    const decayK = kv(P.decay), atkK = kv(P.attack), susK = kv(P.sustain), relK = kv(P.release);
    const semi = kv(P.osc2semi), det2 = kv(P.osc2det), spread = kv(P.uniSpread);

    // Envelope rates, per control block.
    const bps = sr / BLK;
    const atkC = 1 - Math.exp(-1 / (Math.max(0.0005, 0.001 * Math.pow(4000, atkK)) * bps));
    const decC = 1 - Math.exp(-1 / (Math.max(0.002, 0.004 * Math.pow(1200, decayK)) * bps));
    const relC = 1 - Math.exp(-1 / (Math.max(0.003, 0.006 * Math.pow(900, relK)) * bps));
    const susL = susK;
    const uni = this.uni, uniN = 1 / Math.sqrt(uni);
    const osc2Ratio = Math.pow(2, semi / 12);
    const mode1 = this.mode1, mode2 = this.mode2, poles4 = this.poles === 4;
    const route = this.route, satCurve = this.satCurve, subTri = this.subWave === 1, sync = this.sync;

    for (let base = 0; base < N; base += BLK) {
      const blk = Math.min(BLK, N - base);
      const frame = n0 + base;

      while (this.queue.length && this.queue[0].at <= frame) {
        const ev = this.queue.shift();
        if (ev.off) this.noteOff(ev.id); else this.noteOn(ev);
      }
      if (this.allOff !== undefined && frame >= this.allOff) {
        for (const v of this.voices) if (v.gate) { v.gate = false; v.aStage = 4; v.fStage = 4; }
        this.allOff = undefined;
      }

      // a-rate params: one read per control block is plenty for these.
      const i = base;
      const cutoffP = P.cutoff.length > 1 ? P.cutoff[i] : P.cutoff[0];
      const resoP   = P.reso.length   > 1 ? P.reso[i]   : P.reso[0];
      const shape   = P.shape.length  > 1 ? P.shape[i]  : P.shape[0];
      const lvl1    = P.lvl1.length   > 1 ? P.lvl1[i]   : P.lvl1[0];
      const lvl2    = P.lvl2.length   > 1 ? P.lvl2[i]   : P.lvl2[0];
      const lvlSub  = P.lvlSub.length > 1 ? P.lvlSub[i] : P.lvlSub[0];
      const lvlNz   = P.lvlNoise.length > 1 ? P.lvlNoise[i] : P.lvlNoise[0];
      const pw      = P.pw.length     > 1 ? P.pw[i]     : P.pw[0];
      const fmAmt   = P.fm.length     > 1 ? P.fm[i]     : P.fm[0];
      const ringAmt = P.ring.length   > 1 ? P.ring[i]   : P.ring[0];
      const uniDet  = P.uniDet.length > 1 ? P.uniDet[i] : P.uniDet[0];
      const cut2Off = P.cut2.length   > 1 ? P.cut2[i]   : P.cut2[0];
      const bal     = P.balance.length> 1 ? P.balance[i]: P.balance[0];
      const satAmt  = P.satAmt.length > 1 ? P.satAmt[i] : P.satAmt[0];
      const envAmt  = P.envAmt.length > 1 ? P.envAmt[i] : P.envAmt[0];

      // Resonance. Cubed rather than squared so the lower half of the slider
      // stays musical: the timb slider defaults to 0.5 for every engine, and a
      // squared curve put that default somewhere only an acid line wants to be.
      const qT = 0.7 + resoP * resoP * resoP * 12;
      // A 4-pole is two 2-pole stages in series, and peaks multiply: giving both
      // stages the full Q would square the resonance. Split it across them.
      const kq1 = 1 / (poles4 ? Math.sqrt(qT) : qT);
      const kq2 = 1 / (0.7 + resoP * resoP * resoP * 9);
      const wet1 = 1 - bal, wet2 = bal;

      for (const v of this.voices) {
        if (!v.active) continue;

        // ---- envelopes (block rate) ----
        if (v.aStage === 1) { v.amp += (1.05 - v.amp) * atkC; if (v.amp >= 1) { v.amp = 1; v.aStage = 2; } }
        else if (v.aStage === 2) { v.amp += (susL - v.amp) * decC; if (Math.abs(v.amp - susL) < 1e-4) v.aStage = 3; }
        else if (v.aStage === 4) { v.amp -= v.amp * relC; if (v.amp < 1e-4) { v.amp = 0; v.active = false; continue; } }
        if (v.fStage === 1) { v.fenv += (1.05 - v.fenv) * atkC; if (v.fenv >= 1) { v.fenv = 1; v.fStage = 2; } }
        else if (v.fStage === 2) { v.fenv += (susL - v.fenv) * decC; if (Math.abs(v.fenv - susL) < 1e-4) v.fStage = 3; }
        else if (v.fStage === 4) { v.fenv -= v.fenv * relC; if (v.fenv < 1e-4) v.fenv = 0; }

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
        const amp = v.amp * v.vel * 0.4;

        for (let n = 0; n < blk; n++) {
          let sigL = 0, sigR = 0;
          for (let u = 0; u < uni; u++) {
            const f1 = v.freq * v.det[u];
            const dt1 = f1 / sr, dt2 = f1 * osc2Ratio * (1 + det2 * 0.03) / sr;
            // osc 2 first — it feeds osc 1 through FM and the ring modulator
            let p2 = v.ph2[u] + dt2; if (p2 >= 1) p2 -= 1;
            let p1 = v.ph1[u] + dt1;
            let wrapped = false;
            if (p1 >= 1) { p1 -= 1; wrapped = true; }
            if (sync && wrapped) p2 = 0;             // osc 2 hard-synced to osc 1
            v.ph1[u] = p1; v.ph2[u] = p2;
            const o2 = oscAt(p2, dt2, shape, pw);
            // FM as phase modulation of osc 1 by osc 2
            let pm = p1 + fmAmt * o2 * 0.5; pm -= Math.floor(pm);
            const o1 = oscAt(pm, dt1, shape, pw);
            let mix = o1 * lvl1 + o2 * lvl2 + o1 * o2 * ringAmt;
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

          // ---- filter pair, per channel ----
          for (let ch = 0; ch < 2; ch++) {
            const o = ch * 6;
            let x = ch === 0 ? sigL : sigR;
            // filter 1 (one or two SVF stages)
            let y1 = svf(x, s, o, a1_1, a2_1, a3_1, kq1, mode1);
            if (poles4) y1 = svf(y1, s, o + 2, a1_1, a2_1, a3_1, kq1, mode1);
            let y;
            if (route === 0) {
              // serial: 1 -> saturation -> 2, balance blends pre/post filter 2
              const d = saturate(y1, satCurve, satAmt, sat, ch * 2);
              const y2 = svf(d, s, o + 4, a1_2, a2_2, a3_2, kq2, mode2);
              y = d * wet1 + y2 * wet2;
            } else if (route === 1) {
              // parallel: both filters see the same source, balance crossfades
              const y2 = svf(x, s, o + 4, a1_2, a2_2, a3_2, kq2, mode2);
              y = saturate(y1, satCurve, satAmt, sat, ch * 2) * wet1 + y2 * wet2;
            } else {
              // split: filter 1 to the left, filter 2 to the right
              y = ch === 0
                ? saturate(y1, satCurve, satAmt, sat, 0)
                : svf(x, s, o + 4, a1_2, a2_2, a3_2, kq2, mode2);
            }
            if (ch === 0) outL[base + n] += y * amp; else outR[base + n] += y * amp;
          }
        }
      }
    }

    // Master soft limit — eight voices of unison stack up fast.
    for (let n = 0; n < N; n++) {
      outL[n] = Math.tanh(outL[n]);
      if (outR !== outL) outR[n] = Math.tanh(outR[n]);
    }
    return true;
  }
}

// Topology-preserving state-variable filter. One structure, all four responses,
// which is exactly what a multimode filter needs.
function svf(v0, s, o, a1, a2, a3, k, mode) {
  const ic1 = s[o], ic2 = s[o + 1];
  const v3 = v0 - ic2;
  const v1 = a1 * ic1 + a2 * v3;
  const v2 = ic2 + a2 * ic1 + a3 * v3;
  s[o] = 2 * v1 - ic1;
  s[o + 1] = 2 * v2 - ic2;
  if (mode === 0) return v2;                 // low pass
  if (mode === 1) return v0 - k * v1 - v2;   // high pass
  if (mode === 2) return v1;                 // band pass
  return v0 - k * v1;                        // band stop
}

registerProcessor("access-virus", VirusProcessor);
`;

// One registration per AudioContext, single-flight; a failure clears the slot
// so the next attempt retries (same contract as the Plaits and 303 worklets).
const _loads = new WeakMap();
const _ready = new WeakSet();

/**
 * Register the access-virus processor on this context. Called at init() so the
 * await on the play path has already resolved by the time a voice is built.
 * @param {BaseAudioContext} ctx @returns {Promise<void>}
 */
export function loadVirusWorklet(ctx) {
  if (!ctx?.audioWorklet) return Promise.reject(new Error("no AudioWorklet"));
  let p = _loads.get(ctx);
  if (!p) {
    const url = URL.createObjectURL(new Blob([VIRUS_PROCESSOR_SOURCE], { type: "text/javascript" }));
    p = ctx.audioWorklet.addModule(url)
      .then(() => { URL.revokeObjectURL(url); _ready.add(ctx); })
      .catch((e) => { URL.revokeObjectURL(url); _loads.delete(ctx); throw e; });
    _loads.set(ctx, p);
  }
  return p;
}

/** Has the processor finished registering on this context? */
export function virusReady(ctx) { return !!ctx && _ready.has(ctx); }

// Panel controls, in UI order. render.js / session.js walk these lists so the
// wiring stays in one place (same convention as GRAN_NUM_KEYS).
export const VIRUS_NUM_KEYS = [
  "vosc2semi", "vosc2det", "vpw", "vfm", "vring",
  "vunidet", "vunispread",
  "vcut2", "vbal", "vsatamt", "venvamt",
  "vatk", "vsus", "vrel",
];
export const VIRUS_SEL_KEYS = ["vmode1", "vpoles", "vmode2", "vroute", "vsat", "vsubwave", "vsync", "vuni"];

export const VIRUS_DEFAULTS = {
  vosc2semi: 0, vosc2det: 0.08, vpw: 0.5, vfm: 0, vring: 0,
  vunidet: 0.3, vunispread: 0.6,
  vcut2: 0, vbal: 0, vsatamt: 0.3, venvamt: 0.5,
  vatk: 0.02, vsus: 0.6, vrel: 0.25,
  vmode1: "lp", vpoles: "4", vmode2: "lp", vroute: "ser", vsat: "soft",
  vsubwave: "square", vsync: "off", vuni: "1",
};

const FILTER_MODES = { lp: 0, hp: 1, bp: 2, bs: 3 };
const ROUTES = { ser: 0, par: 1, split: 2 };
const SAT_CURVES = { off: 0, light: 1, soft: 2, hard: 3, digital: 4, shaper: 5, rectify: 6, bits: 7, rate: 8 };

// Tone wrappers don't accept a native connect() — unwrap to the node underneath.
const nativeIn = (node) => node?.input?.input ?? node?.input ?? node;

/**
 * Build the Virus voice. Returns null when the worklet isn't registered yet, so
 * the caller can fall back rather than leave the track silent.
 * @param {*} output Tone node the voice writes into.
 */
export function buildVirusVoice(output) {
  const ctx = Tone.getContext().rawContext;
  if (!virusReady(ctx)) { loadVirusWorklet(ctx).catch(() => {}); return null; }

  let node;
  try {
    node = new AudioWorkletNode(ctx, "access-virus",
      { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
  } catch (e) {
    console.warn("access-virus worklet node failed", e);
    return null;
  }
  node.connect(nativeIn(output));

  const P = {};
  for (const n of ["cutoff", "reso", "shape", "decay", "lvl1", "lvl2", "lvlSub", "lvlNoise",
                   "pw", "fm", "ring", "osc2semi", "osc2det", "uniDet", "uniSpread",
                   "cut2", "balance", "satAmt", "envAmt", "attack", "sustain", "release"]) {
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
        // Virus group — numeric
        case "vosc2semi":  P.osc2semi.value  = num(val, -24, 24); return;
        case "vosc2det":   P.osc2det.value   = num(val, 0, 1); return;
        case "vpw":        P.pw.value        = num(val, 0.02, 0.98); return;
        case "vfm":        P.fm.value        = num(val, 0, 1); return;
        case "vring":      P.ring.value      = num(val, 0, 1); return;
        case "vunidet":    P.uniDet.value    = num(val, 0, 1); return;
        case "vunispread": P.uniSpread.value = num(val, 0, 1); return;
        case "vcut2":      P.cut2.value      = num(val, -1, 1); return;
        case "vbal":       P.balance.value   = num(val, 0, 1); return;
        case "vsatamt":    P.satAmt.value    = num(val, 0, 1); return;
        case "venvamt":    P.envAmt.value    = num(val, -1, 1); return;
        case "vatk":       P.attack.value    = num(val, 0, 1); return;
        case "vsus":       P.sustain.value   = num(val, 0, 1); return;
        case "vrel":       P.release.value   = num(val, 0, 1); return;
        // Virus group — discrete
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
        // Virus-only mod targets, reached under their own keys
        case "vpw":        return P.pw;
        case "vfm":        return P.fm;
        case "vring":      return P.ring;
        case "vunidet":    return P.uniDet;
        case "vcut2":      return P.cut2;
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
