// ---- siege: the bass drum synth ---------------------------------------------
// A siege engine for the low end: a kick drum voice with five controls and a
// drive section that is the point of it. Not an 808 (a resonant filter rung
// by a pulse) or a 909 (a triangle through a pitch sweep and a clipper), but
// the thing the techno kick became once it was a synth of its own: a sine, a
// pitch envelope that is the attack, an amplitude envelope that is the body,
// and a drive stage AFTER the envelope that is the whole character.
//
//   TRIG ─▶ PITCH ENV ──▶ OSC (sine, V/oct) ─▶ AMP ENV ─▶ DRIVE ─▶ HPF ─▶ out
//           (click, depth)   (tune, lock)       (decay,     (fold /    (3-pole
//                                                gate)       clip)      30Hz)
//
// - **The drive comes after the envelope, and that decides everything.** A
//   drive in front of an envelope distorts the whole note the same amount; one
//   behind it distorts the loud start and leaves the quiet tail alone, so a
//   driven kick has a crushed attack over a clean sub, and the harmonics die
//   with the envelope. The gain also LIFTS the tail (12x at the top of the
//   knob), which is why kick modules call it compression: a hit that was
//   250ms long reads as half a second, and a long decay turns into a rumble.
// - **Two drives, two circuits** (`mode`). FOLD is a two-stage wavefolder: a
//   reflecting fold at the first stage, which keeps making new harmonics as
//   it is driven instead of settling into a square, then a soft knee that
//   rounds the fold's corners and squashes the peaks. Even past full scale
//   the output never grows: that is the compression it promises. CLIP is a gain into a hard clipper with a small knee: odd
//   harmonics only, a square almost at once, the loudest and the harshest.
// - **The click is a pitch envelope.** `click` is how far above the note the
//   pitch starts (up to six octaves, squared so the bottom of the knob is a
//   gentle thump) and `depth` is how long it takes to fall (1ms to 250ms).
//   At 1ms with the pitch six octaves up it is a single fast cycle: a tick.
//   At 100ms and two octaves it is the 909's sweep. The fall is exponential
//   in pitch, which is what a capacitor into an exponential converter does.
// - **The pitch is the note, V/oct.** A kick module's pitch knob spans a
//   couple of octaves around C2; here the step's note is the pitch and `tune`
//   trims it an octave either way. `lock` is a pitch lock: the tuning you set stays, and a
//   note only moves the kick by octaves (the nearest octave of C), so a
//   sequence that wanders never detunes the drum.
// - **A trigger ignores the step's length**, as a drum module ignores its gate
//   length. `gate` mode adds a hold stage: the amplitude holds while the step
//   is held and decays when it ends, which with V/oct and the track's glide
//   is a bassline. The pitch envelope does not hold (it is the attack), so a
//   held note sits at its note.
// - **Velocity is the output level**, between a floor and full, the way a
//   drum module's velocity input sets it. `floor` at 1 ignores velocity.
// - **The highpass is a third-order 30Hz low cut**: a first-order and a
//   second-order section in series, Butterworth. Off by default; on, it takes
//   the infrasound a driven sub makes and leaves the fundamental of a C1 alone.
// - **A retrigger is crossfaded**, subby's way: a kick is one sine and a
//   phase reset on top of a sounding one is a step, so the interrupted wave
//   runs on for 3ms and fades under the new note.
// - **Oscillator and drive run 2x oversampled.** A sine at 12x gain into a
//   clipper is a square with harmonics past Nyquist, and during the click the
//   fundamental is at 400Hz; folded back down those land in the body of the
//   note. Decimated through two biquads, the same pair drone.js uses.
//
// One list, three namespaces, as in hexop.js / subbass.js / drone.js: every
// panel control is `sge` + a short key, and that short key spells its LFO
// target (`siege_<short>`) and its automation lane (`siege.<short>`). The four
// track sliders are DRIVE / CLICK / DEPTH / DECAY.

const SIEGE_PROCESSOR_SOURCE = `
const BLK = 16;        // control-block size, at the host rate

function bq() { return { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0, z1: 0, z2: 0 }; }
function bqRun(f, x) {
  const y = f.b0 * x + f.z1;
  f.z1 = f.b1 * x - f.a1 * y + f.z2;
  f.z2 = f.b2 * x - f.a2 * y;
  return y;
}
function bqSet(f, b0, b1, b2, a0, a1, a2) {
  const n = 1 / a0;
  f.b0 = b0 * n; f.b1 = b1 * n; f.b2 = b2 * n; f.a1 = a1 * n; f.a2 = a2 * n;
}
function bqLP(f, sr, freq, q) {
  const w = 2 * Math.PI * Math.min(Math.max(freq, 10), sr * 0.45) / sr;
  const c = Math.cos(w), a = Math.sin(w) / (2 * q);
  bqSet(f, (1 - c) / 2, 1 - c, (1 - c) / 2, 1 + a, -2 * c, 1 - a);
}
function bqHP(f, sr, freq, q) {
  const w = 2 * Math.PI * Math.min(Math.max(freq, 5), sr * 0.45) / sr;
  const c = Math.cos(w), a = Math.sin(w) / (2 * q);
  bqSet(f, (1 + c) / 2, -(1 + c), (1 + c) / 2, 1 + a, -2 * c, 1 - a);
}

// ---- the two drives ------------------------------------------------------
// FOLD: reflect off +/-1 (up to eight times, which is more than a 12x gain
// ever needs), then a soft knee whose strength rises with the drive, so at
// drive 0 the stage is a wire and at the top it rounds the fold's corners and
// pulls the peaks in. CLIP: a gain into a clipper with a small knee
// (|y|^8 under the root: linear to 0.8, flat past 1.2).
function fold(x, g, knee) {
  let f = x * g;
  for (let i = 0; i < 8; i++) {
    if (f > 1) f = 2 - f; else if (f < -1) f = -2 - f; else break;
  }
  if (knee <= 0) return f;
  return f * (1 + knee) / (1 + knee * (f < 0 ? -f : f));
}
function clip(x, g) {
  const y = x * g;
  const y2 = y * y, y4 = y2 * y2;
  return y / Math.pow(1 + y4 * y4, 0.125);
}

// ---- the event queue ------------------------------------------------------
// The same allocation-free queue as subbass.js / drone.js: parallel typed
// arrays, kept in order by inserting from the back, one scratch event reused
// by every shift(). See subbass.js for why each of those matters.
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

const C2 = 65.40639132514966;

class SiegeProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    const a = (name, defaultValue) => ({ name, defaultValue, minValue: 0, maxValue: 1, automationRate: "a-rate" });
    const k = (name, defaultValue) => ({ name, defaultValue, minValue: 0, maxValue: 1, automationRate: "k-rate" });
    return [
      // The four track sliders. Defaults match the track's own
      // (harm/timb/morph 0.5, decay 0.4).
      a("drive", 0.5), a("click", 0.5), a("depth", 0.5), a("decay", 0.4),
      // The panel
      k("tune", 0.5), k("floor", 0.5),
    ];
  }

  constructor() {
    super();
    const sr = this.sr = sampleRate;
    this.alive = true;
    this.queue = new EventQueue();
    this.nparams = { click: 0, depth: 0, tune: 0, floor: 0 };
    this.mode = 0; this.gate = 0; this.hpf = 0; this.lock = 0;
    this.glideSec = 0;

    // The one voice. A kick is one note at a time: a retrigger is the same
    // drum hit again.
    this.ph = 0;
    this.freq = C2; this.target = C2; this.glideA = 1;
    this.env = 0; this.peak = 0; this.attacking = false;
    this.held = false; this.noteId = 0;
    this.attC = 1; this.decC = 0; this.relC = 0; this.releasing = false;
    this.pEnv = 0; this.pDecC = 0; this.pSemis = 0;
    // The wave a retrigger interrupted, run on for 3ms and faded under the
    // new note (see noteOn).
    this.tailPh = 0; this.tailFreq = 0; this.tailAmp = 0; this.tailW = 0; this.tailStep = 1;

    // The highpass: a one-pole and a biquad, 30Hz, Butterworth together.
    this.hp1x = 0; this.hp1y = 0;
    this.hp1a = 1 / (1 + 2 * Math.PI * 30 / sr);
    this.hp2 = bq();
    bqHP(this.hp2, sr, 30, 1);
    this.dcX = 0; this.dcY = 0;

    // The decimator back from 2x: the same pair as drone.js.
    this.dec1 = bq(); this.dec2 = bq();
    bqLP(this.dec1, sr * 2, sr * 0.42, 0.54);
    bqLP(this.dec2, sr * 2, sr * 0.42, 1.31);

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
      if (m.mode !== undefined) this.mode = m.mode ? 1 : 0;
      if (m.gate !== undefined) this.gate = m.gate ? 1 : 0;
      if (m.hpf !== undefined) {
        const on = m.hpf ? 1 : 0;
        // Switched on, the filter must not start from yesterday's state.
        if (on && !this.hpf) { this.hp1x = 0; this.hp1y = 0; this.hp2.z1 = 0; this.hp2.z2 = 0; }
        this.hpf = on;
      }
      if (m.lock !== undefined) this.lock = m.lock ? 1 : 0;
      if (m.glide !== undefined) this.glideSec = Math.max(0, m.glide);
    } else if (m.type === "dispose") {
      this.alive = false;
    }
  }

  noteOn(ev, P) {
    const prevFreq = this.freq;
    // The pitch: the note, trimmed by tune. Locked, the tuning stays and the
    // note only picks the octave, the nearest octave of C.
    const tuneSemis = (P.tune - 0.5) * 24;
    let f;
    if (this.lock) {
      const oct = Math.round((ev.note - 36) / 12);
      f = C2 * Math.pow(2, tuneSemis / 12 + oct);
    } else {
      f = ev.freq * Math.pow(2, tuneSemis / 12);
    }
    const gl = ev.glide > 0 ? ev.glide : this.glideSec;
    const sliding = gl > 0 && this.env > 1e-4;
    this.target = f;
    if (sliding) {
      this.glideA = 1 - Math.exp(-3 / Math.max(1, gl * this.sr / BLK));
    } else {
      this.freq = f; this.glideA = 1;
    }

    // Every hit starts the sine at zero, rising: the same drum every time.
    // A reset on top of a sounding note is a step, so the interrupted wave is
    // handed to a tail that runs on at the old pitch and fades out under the
    // new note over 3ms, smoothstepped (subby's crossfade, see subbass.js).
    if (!sliding) {
      if (this.env > 1e-4) {
        this.tailPh = this.ph; this.tailFreq = prevFreq * this.pitchMul();
        this.tailAmp = this.env; this.tailW = 1;
        this.tailStep = 1 / (0.003 * this.sr);
      }
      this.ph = 0;
    }

    this.noteId = ev.id;
    this.held = true; this.releasing = false;
    // Velocity is the level, from the floor to full.
    this.peak = P.floor + (1 - P.floor) * ev.vel;
    // A retrigger over a ringing note starts from where that note is rather
    // than from silence, never above its own peak.
    if (this.env > this.peak) this.env = this.peak;
    this.attC = 1 - Math.exp(-1 / (0.0003 * this.sr));
    this.attacking = true;

    // The click: the pitch starts up to six octaves above the note and falls
    // onto it. Squared, so half the knob is an octave and a half.
    this.pSemis = P.click * P.click * 72;
    if (this.pSemis > 0.01) {
      this.pEnv = 1;
      const dT = 0.001 * Math.pow(250, P.depth);
      this.pDecC = Math.exp(-1 / (dT * this.sr * 2));
    } else this.pEnv = 0;
  }

  pitchMul() {
    const semis = this.pEnv * this.pSemis;
    return semis > 0.0001 ? Math.pow(2, semis / 12) : 1;
  }

  noteOff(id) {
    if (id !== undefined && id !== this.noteId) return;
    this.held = false;
  }

  process(inputs, outputs, params) {
    if (!this.alive) return false;
    const out = outputs[0];
    if (!out || !out.length) return true;
    const o = out[0];
    const n128 = o.length;
    const sr = this.sr, sr2 = sr * 2;
    const P = params;
    const startFrame = currentFrame;

    for (let base = 0; base < n128; base += BLK) {
      const blk = Math.min(BLK, n128 - base);
      const i = base;
      const at = startFrame + base;

      // A stop lets the drum go under a short release, whichever mode it is
      // in: a 4s decay left ringing under the master's cut would still be
      // ringing when play came back.
      if (this.allOff !== undefined && at >= this.allOff) {
        this.held = false; this.releasing = true; this.allOff = undefined;
      }
      while (this.queue.len && this.queue.headAt() <= at) {
        const ev = this.queue.shift();
        if (ev.off) this.noteOff(ev.id);
        else {
          const np = this.nparams;
          np.click = P.click.length > 1 ? P.click[i] : P.click[0];
          np.depth = P.depth.length > 1 ? P.depth[i] : P.depth[0];
          np.tune  = P.tune[0];
          np.floor = P.floor[0];
          this.noteOn(ev, np);
        }
      }

      const drive = P.drive.length > 1 ? P.drive[i] : P.drive[0];
      const decay = P.decay.length > 1 ? P.decay[i] : P.decay[0];

      // The decay: 50ms to 4s to fall 60dB. It runs whether or not the step
      // is held, unless gate mode is holding it.
      const t60 = 0.05 * Math.pow(80, decay);
      this.decC = Math.exp(-6.91 / (t60 * sr2));
      this.relC = Math.exp(-6.91 / (0.03 * sr2));
      const holding = this.gate && this.held && !this.releasing;

      // The drive's gains, once per block.
      const gFold = 1 + drive * drive * 7;
      const knee = drive * 1.5;
      const gClip = 1 + drive * drive * 11;
      const mode = this.mode;

      for (let s = 0; s < blk; s++) {
        if (this.env === 0 && !this.attacking && this.tailW <= 0) { o[base + s] = 0; continue; }

        if (this.glideA < 1) {
          this.freq += (this.target - this.freq) * this.glideA;
          if (Math.abs(this.target - this.freq) < 0.005) { this.freq = this.target; this.glideA = 1; }
        }

        // Two sub-samples: oscillator, envelope, drive, then the decimator.
        let y = 0;
        for (let os = 0; os < 2; os++) {
          // ---- the amplitude envelope ----
          if (this.attacking) {
            this.env += this.attC * (this.peak * 1.02 - this.env);
            if (this.env >= this.peak) { this.env = this.peak; this.attacking = false; }
          } else if (!holding) {
            this.env *= this.releasing ? this.relC : this.decC;
          }
          if (this.env < 1e-6) this.env = 0;

          // ---- the pitch envelope, and the sine ----
          if (this.pEnv > 1e-4) this.pEnv *= this.pDecC; else this.pEnv = 0;
          const f = this.freq * this.pitchMul();
          this.ph += f / sr2; if (this.ph >= 1) this.ph -= 1;
          let x = Math.sin(2 * Math.PI * this.ph) * this.env;

          // The tail of the wave a retrigger interrupted.
          if (this.tailW > 0) {
            this.tailPh += this.tailFreq / sr2; if (this.tailPh >= 1) this.tailPh -= 1;
            const to = Math.sin(2 * Math.PI * this.tailPh) * this.tailAmp;
            const w = this.tailW * this.tailW * (3 - 2 * this.tailW);
            x += (to - x) * w;
            this.tailW -= this.tailStep * 0.5;
            if (this.tailW < 0) this.tailW = 0;
          }

          // ---- the drive ----
          const d = mode === 0 ? fold(x, gFold, knee) : clip(x, gClip);
          y = bqRun(this.dec2, bqRun(this.dec1, d));
        }

        // ---- the output: DC blocked, the 30Hz low cut when it is on ----
        const dz = y - this.dcX + 0.9995 * this.dcY;
        this.dcX = y; this.dcY = dz;
        let sig = dz;
        if (this.hpf) {
          const h1 = this.hp1a * (this.hp1y + sig - this.hp1x);
          this.hp1x = sig; this.hp1y = h1;
          sig = bqRun(this.hp2, h1);
        }
        // The ceiling. The drives never pass full scale, but the decimator
        // rings on a folded corner (a lowpassed square overshoots by up to a
        // fifth, Gibbs), so the last stage is a knee: linear to 0.75, then a
        // smooth bend to 1, which a clean kick never reaches.
        const t = sig * 0.85;
        const at = t < 0 ? -t : t;
        if (at <= 0.75) { o[base + s] = t; }
        else {
          const u = (at - 0.75) * 4;
          o[base + s] = (t < 0 ? -1 : 1) * (0.75 + 0.25 * u / (1 + u));
        }
      }
    }
    return true;
  }
}

registerProcessor("siege", SiegeProcessor);
`;

/** The processor source, for test/siege.test.js — evaluated there against the
 *  worklet globals a test stubs, as drone.js's is. */
export function siegeProcessorSource() { return SIEGE_PROCESSOR_SOURCE; }

const _loads = new WeakMap();
const _ready = new WeakSet();

/**
 * Register the siege processor on this context. Called at init() so the await
 * on the play path has already resolved by the time a voice is built.
 * @param {BaseAudioContext} ctx @returns {Promise<void>}
 */
export function loadSiegeWorklet(ctx) {
  if (!ctx?.audioWorklet) return Promise.reject(new Error("no AudioWorklet"));
  let p = _loads.get(ctx);
  if (!p) {
    const url = URL.createObjectURL(new Blob([SIEGE_PROCESSOR_SOURCE], { type: "text/javascript" }));
    p = ctx.audioWorklet.addModule(url)
      .then(() => { URL.revokeObjectURL(url); _ready.add(ctx); })
      .catch((e) => { URL.revokeObjectURL(url); _loads.delete(ctx); throw e; });
    _loads.set(ctx, p);
  }
  return p;
}

/** Has the processor finished registering on this context? */
export function siegeReady(ctx) { return !!ctx && _ready.has(ctx); }

// ---- the panel ----------------------------------------------------------
// Keys are `sge` + short key -> `siege_<short>` / `siege.<short>`. The list, the
// ranges, the defaults and the kicks are data in engineData.js; re-exported
// here.
import { SIEGE_MOD_KEYS } from "./engineData.js";
export {
  SIEGE_NUM_CTLS, SIEGE_SEL_CTLS, SIEGE_MOD_KEYS, SIEGE_NUM_KEYS, SIEGE_SEL_KEYS,
  SIEGE_MOD_RANGE, SIEGE_MOD_LABELS, SIEGE_DEFAULTS, siegeFromUnit,
  SIEGE_TONE_NAMES, siegeToneDescription, siegeTone,
} from "./engineData.js";

// Tone wrappers don't accept a native connect() — unwrap to the node underneath.
const nativeIn = (node) => node?.input?.input ?? node?.input ?? node;

/**
 * Build the siege voice. Returns null when the worklet isn't registered yet, so
 * the caller can fall back rather than leave the track silent.
 * @param {*} output Tone node the voice writes into.
 */
export function buildSiegeVoice(output) {
  const ctx = Tone.getContext().rawContext;
  if (!siegeReady(ctx)) { loadSiegeWorklet(ctx).catch(() => {}); return null; }

  let node;
  try {
    node = new AudioWorkletNode(ctx, "siege",
      { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1] });
  } catch (e) {
    console.warn("siege worklet node failed", e);
    return null;
  }
  node.connect(nativeIn(output));

  const PARAM_OF = { harm: "drive", timb: "click", morph: "depth", decay: "decay" };
  for (const k of SIEGE_MOD_KEYS) PARAM_OF[`sge${k}`] = k;

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
      if (key === "sgemode") { post({ type: "set", mode: val === "clip" }); return; }
      if (key === "sgegate") { post({ type: "set", gate: val === "gate" }); return; }
      if (key === "sgehpf")  { post({ type: "set", hpf: val === "on" }); return; }
      if (key === "sgelock") { post({ type: "set", lock: val === "on" }); return; }
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
