// ---- TB-303 -------------------------------------------------------------
// A model of the Roland TB-303's actual signal path rather than a "saw through
// a resonant lowpass" preset. The things that make a 303 sound like a 303 are
// all in the details the generic version threw away:
//
//   VCO ──▶ VCF (3-pole diode ladder, 18 dB/oct) ──▶ VCA ──▶ out
//            ▲                                       ▲
//            │  MEG × ENV MOD                        │  ACCENT
//            └── accent sweep (RC, resonance-fed) ────┘
//
// - The filter is 18 dB/octave, not 24, and its resonance feedback runs through
//   a diode pair — asymmetric soft clipping, which is where the squelch and the
//   even harmonics come from. It's a feedback topology, so the passband loses
//   level as resonance goes up: a high-resonance 303 line really is thin, which
//   is exactly why everyone runs one into a distortion pedal.
// - There is no keyboard tracking on the filter. High notes are duller than low
//   ones, and that's correct.
// - The main envelope generator (MEG) is attack/decay with no sustain, and it
//   keeps decaying whether or not the gate is still open.
// - ACCENT does three things at once, all from one circuit: it makes the note
//   louder, it forces the MEG decay to a fixed ~200 ms no matter where the
//   DECAY knob sits, and it dumps charge into an RC network whose time constant
//   is set by the RESONANCE control. That last one is why consecutive accented
//   notes at high resonance pile up into a rising wooOWW instead of each being
//   an isolated blip — the cap hasn't drained before the next one lands.
// - SLIDE is a CV lag, so it's linear in pitch (~60 ms), and it does not
//   retrigger the envelopes: the gate stays open across the pair.
//
// This runs as an AudioWorklet because none of it can be built from native
// nodes: Web Audio has no 3-pole filter, no way to put a saturator inside a
// filter's feedback path, and no sample-accurate way to run an envelope that
// feeds a cutoff. The processor is registered from a Blob URL so the source
// travels with the module graph — no extra fetch, no path/versioning coupling.

/** @typedef {import("./types.js").Track} Track */

// The processor source. Lives here as a string (see the note above); keep it
// free of backticks and ${ so the template literal stays intact.
const TB303_PROCESSOR_SOURCE = `
// One TB-303 voice. Monophonic, like the machine.
class TB303Processor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      // The four panel knobs the track's timbre sliders drive. a-rate so LFOs
      // and per-step automation can sweep them inside a single note.
      { name: "cutoff",    defaultValue: 0.42, minValue: 0, maxValue: 1, automationRate: "a-rate" },
      { name: "resonance", defaultValue: 0.45, minValue: 0, maxValue: 1, automationRate: "a-rate" },
      { name: "envMod",    defaultValue: 0.55, minValue: 0, maxValue: 1, automationRate: "a-rate" },
      // Read when a note starts, so k-rate is enough.
      { name: "decay",     defaultValue: 0.35, minValue: 0, maxValue: 1, automationRate: "k-rate" },
      { name: "accent",    defaultValue: 0.6,  minValue: 0, maxValue: 1, automationRate: "k-rate" },
      { name: "tune",      defaultValue: 0,    minValue: -1, maxValue: 1, automationRate: "k-rate" },
    ];
  }

  constructor() {
    super();
    this.sr  = sampleRate;
    this.sr2 = sampleRate * 2;          // the VCO + VCF run 2x oversampled
    this.alive = true;
    this.queue = [];                     // pending notes, sorted by frame
    this.wave = 0;                       // 0 = saw, 1 = square

    // VCO
    this.phase = 0;
    this.logF = Math.log2(110);
    this.logTarget = this.logF;
    this.slideCoef = 1;                  // 1 = jump straight to the new pitch
    this.hpX = 0; this.hpY = 0;          // output coupling cap
    this.hpR = 1 - (2 * Math.PI * 25) / this.sr2;

    // Gate + envelopes
    this.gateOpen = false;
    this.gateOffFrame = -1;
    this.offFrame = -1;
    this.amp = 0;
    this.ampLevel = 1;                   // accent raises this per note
    this.ampAtk = 1 - Math.exp(-1 / (0.0018 * this.sr));   // ~4 ms to full
    this.ampRel = 1 - Math.exp(-1 / (0.0045 * this.sr));   // ~14 ms tail
    this.meg = 0;
    this.megStage = 0;                   // 0 idle, 1 attack, 2 decay
    this.megAtk = 1 - Math.exp(-1 / (0.0009 * this.sr));   // fixed ~3 ms attack
    this.megDecMul = Math.exp(-1 / (0.2 * this.sr));
    this.accEnv = 0;                     // the accent circuit's cap charge

    // VCF state (three one-pole TPT stages + the ladder's feedback tap)
    this.s1 = 0; this.s2 = 0; this.s3 = 0;
    this.fb = 0;

    // 2x decimator: 2-pole Butterworth at 0.45 * sr, running at sr2.
    const wc = Math.tan(Math.PI * 0.45 * this.sr / this.sr2);
    const k = Math.SQRT2 * wc, w2 = wc * wc, a0 = 1 + k + w2;
    this.db0 = w2 / a0; this.db1 = 2 * this.db0; this.db2 = this.db0;
    this.da1 = (2 * (w2 - 1)) / a0; this.da2 = (1 - k + w2) / a0;
    this.dx1 = 0; this.dx2 = 0; this.dy1 = 0; this.dy2 = 0;

    this.port.onmessage = (e) => this.onMessage(e.data);
  }

  onMessage(m) {
    if (!m) return;
    if (m.type === "note") {
      if (this.queue.length > 64) this.queue.shift();
      this.queue.push({
        at: Math.max(0, Math.round(m.when * this.sr)),
        freq: Math.max(8, m.freq || 110),
        gate: Math.max(0.005, m.gate || 0.05),
        accent: Math.max(0, Math.min(1, m.accent || 0)),
        slide: !!m.slide,
        slideTime: Math.max(0.002, m.slideTime || 0.058),
      });
      this.queue.sort((a, b) => a.at - b.at);
    } else if (m.type === "off") {
      // Drop anything queued past the stop, and shorten the gate of anything
      // queued before it — the transport schedules ~100 ms ahead, so a stop can
      // land in the middle of notes that haven't been triggered yet.
      const at = Math.max(0, Math.round(m.when * this.sr));
      this.queue = this.queue.filter(ev => ev.at < at);
      for (const ev of this.queue) ev.gate = Math.min(ev.gate, (at - ev.at) / this.sr);
      if (this.gateOffFrame < 0 || at < this.gateOffFrame) this.gateOffFrame = at;
      this.offFrame = at;   // also truncates notes that arrive after this message
    } else if (m.type === "wave") {
      this.wave = m.value === "square" ? 1 : 0;
    } else if (m.type === "dispose") {
      this.alive = false;
    }
  }

  noteOn(ev, decayKnob, accentKnob) {
    const strength = ev.accent * accentKnob;
    this.logTarget = Math.log2(ev.freq);
    if (ev.slide && this.gateOpen) {
      // Slide: the CV lag pulls the pitch across, and because the gate never
      // drops the envelopes are left exactly where they are.
      this.slideCoef = 1 - Math.exp(-3 / (ev.slideTime * this.sr));
    } else {
      this.slideCoef = 1;
      this.logF = this.logTarget;
      this.megStage = 1;
      this.amp = Math.min(this.amp, 0.0001);   // fresh gate: start from silence
    }
    // ACCENT shorts the MEG's decay resistor — a fixed ~200 ms regardless of
    // where DECAY sits. Unaccented, DECAY spans roughly 200 ms to 2.5 s.
    const decT = strength > 0.01 ? 0.2 : 0.2 * Math.pow(12.5, decayKnob);
    this.megDecMul = Math.exp(-3 / (decT * this.sr));
    this.ampLevel = 1 + strength * 0.85;
    if (strength > 0) this.accEnv = Math.min(1.8, this.accEnv + strength);
    this.gateOpen = true;
    this.gateOffFrame = ev.at + Math.round(ev.gate * this.sr);
    // A stop can be posted before the notes it cancels (the scheduler runs
    // ahead), so honour it here too rather than only when the message lands.
    if (this.offFrame > ev.at && this.offFrame < this.gateOffFrame) this.gateOffFrame = this.offFrame;
  }

  // polyBLEP corrector for the discontinuity at phase 0 / phase pw.
  static blep(t, dt) {
    if (t < dt) { const x = t / dt; return x + x - x * x - 1; }
    if (t > 1 - dt) { const x = (t - 1) / dt; return x * x + x + x + 1; }
    return 0;
  }

  process(inputs, outputs, params) {
    if (!this.alive) return false;
    const out = outputs[0] && outputs[0][0];
    if (!out) return true;

    const sr = this.sr, sr2 = this.sr2, n0 = currentFrame;
    const cutA = params.cutoff, resA = params.resonance, envA = params.envMod;
    const decK = params.decay[0], accK = params.accent[0], tuneK = params.tune[0];
    const tuneMul = Math.pow(2, tuneK / 12);
    const B = TB303Processor.blep;

    // The accent cap drains through the resonance network, so its time constant
    // moves with the RESONANCE control — the reason accents stack at high reso.
    const accDecMul = Math.exp(-1 / ((0.05 + 0.28 * resA[0]) * sr));

    for (let i = 0; i < out.length; i++) {
      const n = n0 + i;
      while (this.queue.length && this.queue[0].at <= n) {
        this.noteOn(this.queue.shift(), decK, accK);
      }
      if (this.gateOpen && this.gateOffFrame >= 0 && n >= this.gateOffFrame) this.gateOpen = false;

      const cut = cutA.length > 1 ? cutA[i] : cutA[0];
      const res = resA.length > 1 ? resA[i] : resA[0];
      const env = envA.length > 1 ? envA[i] : envA[0];

      // --- envelopes -----------------------------------------------------
      if (this.megStage === 1) {
        this.meg += (1.05 - this.meg) * this.megAtk;
        if (this.meg >= 1) { this.meg = 1; this.megStage = 2; }
      } else if (this.megStage === 2) {
        this.meg *= this.megDecMul;
        if (this.meg < 1e-5) { this.meg = 0; this.megStage = 0; }
      }
      this.accEnv *= accDecMul;
      const ampTgt = this.gateOpen ? this.ampLevel : 0;
      this.amp += (ampTgt - this.amp) * (ampTgt > this.amp ? this.ampAtk : this.ampRel);

      // --- pitch ---------------------------------------------------------
      this.logF += (this.logTarget - this.logF) * this.slideCoef;
      const freq = Math.pow(2, this.logF) * tuneMul;
      const dt = freq / sr2;

      // --- cutoff CV ------------------------------------------------------
      // No key tracking (the machine has none). Resonance pulls the corner down
      // a little, as the diode ladder's loading does.
      const base = 80 * Math.pow(62.5, cut) * (1 - 0.16 * res);
      const oct = env * this.meg * 4.2 + this.accEnv * (0.5 + 1.5 * res);
      let fc = base * Math.exp(oct * Math.LN2);
      if (fc > 16000) fc = 16000; else if (fc < 30) fc = 30;
      const G = Math.tan(Math.PI * fc / sr2);
      const g = G / (1 + G);
      const k = 7.2 * res;
      // Partial makeup only: the feedback costs ~1/(1+k) of passband level and
      // the 303 never compensated. Clawing all of it back would erase the
      // thinning that makes a high-resonance line sound like a 303.
      const makeup = Math.pow(1 + k, 0.35);

      let y = 0;
      for (let o = 0; o < 2; o++) {
        // --- VCO (2x oversampled, polyBLEP) ------------------------------
        this.phase += dt;
        if (this.phase >= 1) this.phase -= 1;
        let osc;
        if (this.wave === 1) {
          osc = this.phase < 0.5 ? 1 : -1;
          osc += B(this.phase, dt);
          let p2 = this.phase - 0.5; if (p2 < 0) p2 += 1;
          osc -= B(p2, dt);
        } else {
          // Falling saw, as the 303's core produces it. Polarity matters here
          // because the resonance clipper below is asymmetric.
          osc = 1 - 2 * this.phase + B(this.phase, dt);
        }
        // Output coupling cap: gives the square its droop and kills any DC.
        this.hpY = this.hpR * (this.hpY + osc - this.hpX);
        this.hpX = osc;
        const x = this.hpY * 0.85;

        // --- VCF: 3 one-pole TPT stages, diode-clipped feedback -----------
        const f = this.fb;
        const sat = f >= 0 ? f / (1 + 0.6 * f) : f / (1 - 1.1 * f);
        let u = x - k * sat;
        u = u / (1 + 0.25 * Math.abs(u));      // the input stage clips too
        let v = (u - this.s1) * g; const y1 = v + this.s1; this.s1 = y1 + v;
        v = (y1 - this.s2) * g;    const y2 = v + this.s2; this.s2 = y2 + v;
        v = (y2 - this.s3) * g;    const y3 = v + this.s3; this.s3 = y3 + v;
        this.fb = y3;

        // --- decimation filter (runs at sr2, we keep the 2nd sample) -------
        const xn = y3;
        y = this.db0 * xn + this.db1 * this.dx1 + this.db2 * this.dx2
          - this.da1 * this.dy1 - this.da2 * this.dy2;
        this.dx2 = this.dx1; this.dx1 = xn;
        this.dy2 = this.dy1; this.dy1 = y;
      }

      // The output amp's soft knee. Near-linear below about -8 dBFS and bounded
      // at 1, so an accent at wide-open settings compresses instead of clipping.
      out[i] = Math.tanh(y * makeup * this.amp * 0.65);
    }
    return true;
  }
}
registerProcessor("tb-303", TB303Processor);
`;

// One registration per AudioContext. Single-flight, and a failure clears the
// slot so the next attempt retries (same contract as the Plaits worklet).
const _loads = new WeakMap();
const _ready = new WeakSet();

/**
 * Register the tb-303 processor on this context. Called at init() so the await
 * on the play path is already resolved by the time a voice is built.
 * @param {BaseAudioContext} ctx @returns {Promise<void>}
 */
export function loadTb303Worklet(ctx) {
  if (!ctx?.audioWorklet) return Promise.reject(new Error("no AudioWorklet"));
  let p = _loads.get(ctx);
  if (!p) {
    const url = URL.createObjectURL(new Blob([TB303_PROCESSOR_SOURCE], { type: "text/javascript" }));
    p = ctx.audioWorklet.addModule(url)
      .then(() => { URL.revokeObjectURL(url); _ready.add(ctx); })
      .catch((e) => { URL.revokeObjectURL(url); _loads.delete(ctx); throw e; });
    _loads.set(ctx, p);
  }
  return p;
}

/** Has the processor finished registering on this context? */
export function tb303Ready(ctx) { return !!ctx && _ready.has(ctx); }

// Tone wrappers don't accept a native connect() — unwrap to the node underneath.
const nativeIn = (node) => node?.input?.input ?? node?.input ?? node;

/**
 * Build the 303 voice. Returns null when the worklet isn't registered yet, so
 * the caller can fall back rather than leave the track silent.
 * @param {*} output Tone node the voice writes into.
 */
export function buildTb303Voice(output) {
  const ctx = Tone.getContext().rawContext;
  if (!tb303Ready(ctx)) { loadTb303Worklet(ctx).catch(() => {}); return null; }

  let node;
  try {
    node = new AudioWorkletNode(ctx, "tb-303", { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1] });
  } catch (e) {
    console.warn("tb-303 worklet node failed", e);
    return null;
  }
  node.connect(nativeIn(output));

  const P = {
    cutoff: node.parameters.get("cutoff"),
    resonance: node.parameters.get("resonance"),
    envMod: node.parameters.get("envMod"),
    decay: node.parameters.get("decay"),
    accent: node.parameters.get("accent"),
    tune: node.parameters.get("tune"),
  };
  const clamp01 = (v) => Math.max(0, Math.min(1, Number(v) || 0));

  let slideTime = 0.058;      // the machine's slide is a fixed ~60 ms lag
  // Slide state: a note slides when the note before it was written longer than
  // one step and this one starts as that gate ends. That's the tie-into-the-
  // next-note gesture, which is what the 303's SLIDE switch does.
  let prevEnd = -1;
  let prevTied = false;

  const post = (m) => { try { node.port.postMessage(m); } catch {} };

  return {
    // Native node — give the disposer something with the interface it expects.
    nodes: [{ dispose() { try { node.port.postMessage({ type: "dispose" }); } catch {} try { node.disconnect(); } catch {} } }],
    setGlide: (g) => { slideTime = Number(g) > 0 ? Number(g) : 0.058; },
    setParam: (key, val) => {
      switch (key) {
        case "harm":      P.cutoff.value    = clamp01(val); return;   // CUTOFF FREQ
        case "timb":      P.resonance.value = clamp01(val); return;   // RESONANCE
        case "morph":     P.envMod.value    = clamp01(val); return;   // ENV MOD
        case "decay":     P.decay.value     = clamp01(val); return;   // DECAY
        case "accent303": P.accent.value    = clamp01(val); return;   // ACCENT
        case "tune303":   P.tune.value      = Math.max(-1, Math.min(1, (Number(val) || 0) / 100)); return;
        case "wave303":   post({ type: "wave", value: val === "square" ? "square" : "saw" }); return;
      }
    },
    getAudioParam: (key) => {
      switch (key) {
        case "harm":      return P.cutoff;
        case "timb":      return P.resonance;
        case "morph":     return P.envMod;
        case "decay":     return P.decay;
        // Not among the generic slider names, so LFO/automation reach these
        // through their own keys (tb303_accent / tb303.accent, and tune).
        case "accent303": return P.accent;
        case "tune303":   return P.tune;
      }
      return null;
    },
    trigger: (note, time, dur, vel, opts) => {
      const when = Math.max(Number(time) || 0, ctx.currentTime);
      const span = Math.max(1, Math.round(opts?.span ?? 1));
      const tied = span > 1;
      // A slide needs the previous note to have been tied and this one to land
      // where that gate ended (allowing for swing / micro-offset nudges).
      const slide = prevTied && prevEnd >= 0 && when <= prevEnd + Math.min(0.05, dur * 0.35);
      // Untied notes get the machine's short gate — a 303 sequencer holds a
      // plain step for a bit over half its length, which is most of why the
      // part sounds clipped and driving rather than legato.
      const gate = tied ? dur : dur * 0.6;
      // The 303 has no velocity, only ACCENT. Map the top of the step's
      // velocity range onto it so the step editor drives the accent switch.
      const accent = Math.max(0, Math.min(1, ((vel ?? 0.5) - 0.6) / 0.4));
      post({ type: "note", when, freq: 440 * Math.pow(2, (note - 69) / 12), gate, accent, slide, slideTime });
      prevEnd = when + gate;
      prevTied = tied;
    },
    release: (time) => {
      prevTied = false;
      prevEnd = -1;
      post({ type: "off", when: Math.max(Number(time) || 0, ctx.currentTime) });
    },
  };
}
