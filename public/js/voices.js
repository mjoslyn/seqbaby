import { applySampleFadeEnvelope, loadBuffer, startSampleSource } from "./buffers.js";
import { SAMPLE_BASE, engineByKey } from "./catalog.js";
import { wosc } from "./constants.js";
import { makeMetalizerCurve } from "./curves.js";
import { sampleHitRate } from "./lfo.js";
import { setParam } from "./params.js";


/** @typedef {import("./types.js").Voice} Voice */
/** @typedef {import("./types.js").Track} Track */
/** @typedef {import("./types.js").TrackParams} TrackParams */
/** @typedef {import("./types.js").SampleOpts} SampleOpts */
export class PlaitsVoice {
  constructor(ctx, key, params) {
    this.ctx = ctx;
    this.type = "plaits";
    this.poly = true;                 // fan-out across a voice pool for chords
    this.glide = 0;
    this.setKey(key);
    this.poolSize = 4;
    this.pool = [];
    this.voiceIdx = 0;
    this.output = ctx.createGain();
    this.output.gain.value = 1;
    for (let i = 0; i < this.poolSize; i++) {
      const node = wosc.createOscillator();
      node.modTriggerPatchedAudioParameter.value = 1;
      node.modLevelPatchedAudioParameter.value  = 1;
      node.modLevelAudioParameter.value = 0;
      node.engineAudioParameter.value = this.plaitsIdx;
      node.volumeAudioParameter.value = params.vol;
      node.harmonicsAudioParameter.value = params.harm;
      node.timbreAudioParameter.value = params.timb;
      node.morphAudioParameter.value = params.morph;
      node.decayAudioParameter.value = params.decay;
      node.noteAudioParameter.value = 60;
      node.connect(this.output);
      node.start();
      this.pool.push({ node, lastNote: null });
    }
    this.output.connect(ctx.destination);
  }
  getOutputNode() { return this.output; }
  setDestination(target) {
    try { this.output.disconnect(); } catch {}
    this.output.connect(target);
  }
  setKey(key) {
    this.key = key;
    this.plaitsIdx = Number(key.split(":")[1]);
  }
  canInPlaceChange(newKey) { return newKey.startsWith("plaits:"); }
  setEngine(key) {
    this.setKey(key);
    for (const v of this.pool) v.node.engineAudioParameter.value = this.plaitsIdx;
  }
  _paramName(key) {
    return {
      vol: "volumeAudioParameter", harm: "harmonicsAudioParameter",
      timb: "timbreAudioParameter", morph: "morphAudioParameter", decay: "decayAudioParameter",
    }[key];
  }
  setParam(key, val) {
    const name = this._paramName(key);
    if (!name) return;
    for (const v of this.pool) v.node[name].value = val;
  }
  getAudioParam(key) {
    // For LFO modulation: route to all pool voices by returning the first voice's param.
    // (LFO.connect only targets one param; chord tones on other pool voices won't pick up
    // the modulation. For true poly mod, a per-voice LFO bus would be needed.)
    if (key === "vol") return this.output.gain;
    const name = this._paramName(key);
    return name ? this.pool[0].node[name] : null;
  }
  hit(midiNote, time, duration, velocity = 1) {
    const v = this.pool[this.voiceIdx];
    this.voiceIdx = (this.voiceIdx + 1) % this.poolSize;
    const gateOff = Math.max(time + 0.002, time + duration - 0.004);
    const vel = Math.max(0, Math.min(1, velocity));
    const noteParam = v.node.noteAudioParameter;
    if (this.glide > 0 && v.lastNote != null && v.lastNote !== midiNote) {
      noteParam.cancelScheduledValues(time);
      noteParam.setValueAtTime(v.lastNote, time);
      noteParam.linearRampToValueAtTime(midiNote, time + this.glide);
    } else {
      noteParam.setValueAtTime(midiNote, time);
    }
    v.lastNote = midiNote;
    v.node.modLevelAudioParameter.setValueAtTime(vel, time);
    v.node.modTriggerAudioParameter.setValueAtTime(0, time);
    v.node.modTriggerAudioParameter.setValueAtTime(1, time + 0.001);
    v.node.modTriggerAudioParameter.setValueAtTime(0, gateOff);
    v.node.modLevelAudioParameter.setTargetAtTime(0, gateOff, 0.25);
  }
  // Held-note support for the computer keyboard: attack now, release on noteOff.
  noteOn(midiNote, time, velocity = 1) {
    if (!this._held) this._held = new Map();
    const v = this.pool[this.voiceIdx];
    this.voiceIdx = (this.voiceIdx + 1) % this.poolSize;
    const vel = Math.max(0, Math.min(1, velocity));
    const noteParam = v.node.noteAudioParameter;
    if (this.glide > 0 && v.lastNote != null && v.lastNote !== midiNote) {
      noteParam.cancelScheduledValues(time);
      noteParam.setValueAtTime(v.lastNote, time);
      noteParam.linearRampToValueAtTime(midiNote, time + this.glide);
    } else {
      noteParam.setValueAtTime(midiNote, time);
    }
    v.lastNote = midiNote;
    v.node.modLevelAudioParameter.cancelScheduledValues(time);
    v.node.modLevelAudioParameter.setValueAtTime(vel, time);
    v.node.modTriggerAudioParameter.cancelScheduledValues(time);
    v.node.modTriggerAudioParameter.setValueAtTime(0, time);
    v.node.modTriggerAudioParameter.setValueAtTime(1, time + 0.001);
    this._held.set(midiNote, v);
  }
  noteOff(midiNote, time) {
    const v = this._held?.get(midiNote);
    if (!v) return;
    this._held.delete(midiNote);
    try {
      v.node.modTriggerAudioParameter.cancelScheduledValues(time);
      v.node.modTriggerAudioParameter.setValueAtTime(0, time);
      v.node.modLevelAudioParameter.setTargetAtTime(0, time, 0.12);
    } catch {}
  }
  setGlide(seconds) { this.glide = Math.max(0, Number(seconds) || 0); }
  silence(now) {
    this._held?.clear();
    for (const v of this.pool) {
      try {
        v.node.modTriggerAudioParameter.cancelScheduledValues(now);
        v.node.modTriggerAudioParameter.setValueAtTime(0, now);
        v.node.modLevelAudioParameter.cancelScheduledValues(now);
        v.node.modLevelAudioParameter.setValueAtTime(0, now);
      } catch {}
    }
  }
  dispose() {
    for (const v of this.pool) {
      try { v.node.stop(); } catch {}
      try { v.node.dispose(); } catch {}
    }
    try { this.output.disconnect(); } catch {}
  }
}

// Wrap a mono voice-builder in a round-robin pool so chord tones don't stomp
// each other. Each voice in the pool is an independent copy of the same build;
// trigger routes successive hits across voices.
/**
 * Wrap `size` independent voices in a round-robin pool so chord tones spread
 * across them. getAudioParam returns voice 0's param only (LFO hits voice 0).
 * @param {number} size
 * @param {() => any} buildOne  Builds one pooled voice.
 * @returns {{ trigger:Function, release:Function, setGlide:Function, setParam:Function, getAudioParam:(k:string)=>any }}
 */
export function makePolyPool(size, buildOne) {
  const voices = [];
  const nodes = [];
  for (let i = 0; i < size; i++) {
    const v = buildOne();
    voices.push(v);
    nodes.push(...v.nodes);
  }
  let idx = 0;
  return {
    nodes,
    trigger: (note, time, dur, vel) => {
      const v = voices[idx];
      idx = (idx + 1) % size;
      v.trigger(note, time, dur, vel);
    },
    release: (time) => voices.forEach(v => v.release?.(time)),
    setGlide: (g) => voices.forEach(v => v.setGlide?.(g)),
    setParam: (k, val) => voices.forEach(v => v.setParam?.(k, val)),
    // LFO modulation targets only the first pool voice — identical limitation
    // as PlaitsVoice's voice pool (documented in CLAUDE.md).
    getAudioParam: (k) => voices[0].getAudioParam?.(k) ?? null,
  };
}

export function buildDrumSynthNode(kind, output) {
  switch (kind) {
    case "808-kick": {
      const s = new Tone.MembraneSynth({
        pitchDecay: 0.08, octaves: 10,
        oscillator: { type: "sine" },
        envelope: { attack: 0.001, decay: 0.5, sustain: 0.01, release: 1.4, attackCurve: "exponential" },
      }).connect(output);
      return {
        nodes: [s],
        trigger: (note, time, dur, vel) => s.triggerAttackRelease(Tone.Frequency(note, "midi"), Math.max(0.08, dur), time, vel),
        release: (time) => s.triggerRelease(time),
      };
    }
    case "808-snare": {
      const noise = new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.001, decay: 0.15, sustain: 0 } }).connect(output);
      const tone = new Tone.MembraneSynth({ pitchDecay: 0.02, octaves: 2, envelope: { attack: 0.001, decay: 0.1, sustain: 0 } }).connect(output);
      return {
        nodes: [noise, tone],
        trigger: (note, time, dur, vel) => {
          noise.triggerAttackRelease(0.12, time, vel);
          tone.triggerAttackRelease(Tone.Frequency(note, "midi"), 0.08, time, vel * 0.6);
        },
        release: () => {},
      };
    }
    case "808-chat": {
      const s = new Tone.MetalSynth({
        envelope: { attack: 0.001, decay: 0.05, release: 0.01 },
        harmonicity: 5.1, modulationIndex: 32, resonance: 4000, octaves: 1.5,
      }).connect(output);
      return { nodes: [s], trigger: (n, time, dur, vel) => s.triggerAttackRelease(Tone.Frequency(n, "midi"), "32n", time, vel), release: () => {} };
    }
    case "808-ohat": {
      const s = new Tone.MetalSynth({
        envelope: { attack: 0.001, decay: 0.5, release: 0.3 },
        harmonicity: 5.1, modulationIndex: 32, resonance: 4000, octaves: 1.5,
      }).connect(output);
      return { nodes: [s], trigger: (n, time, dur, vel) => s.triggerAttackRelease(Tone.Frequency(n, "midi"), "4n", time, vel), release: () => {} };
    }
    case "808-clap": {
      const noise = new Tone.NoiseSynth({ noise: { type: "pink" }, envelope: { attack: 0.001, decay: 0.28, sustain: 0 } }).connect(output);
      return { nodes: [noise], trigger: (n, time, dur, vel) => noise.triggerAttackRelease(0.3, time, vel), release: () => {} };
    }
    case "808-cowbell": {
      const a = new Tone.Synth({ oscillator: { type: "square" }, envelope: { attack: 0.001, decay: 0.3, sustain: 0, release: 0.2 } }).connect(output);
      const b = new Tone.Synth({ oscillator: { type: "square" }, envelope: { attack: 0.001, decay: 0.3, sustain: 0, release: 0.2 } }).connect(output);
      return {
        nodes: [a, b],
        trigger: (n, time, dur, vel) => {
          a.triggerAttackRelease(560, 0.2, time, vel * 0.6);
          b.triggerAttackRelease(845, 0.2, time, vel * 0.6);
        },
        release: () => {},
      };
    }
    case "909-kick": {
      const s = new Tone.MembraneSynth({
        pitchDecay: 0.04, octaves: 6,
        envelope: { attack: 0.001, decay: 0.18, sustain: 0, release: 0.5 },
      });
      const dist = new Tone.Distortion({ distortion: 0.2, wet: 0.35 });
      s.connect(dist); dist.connect(output);
      return {
        nodes: [s, dist],
        trigger: (note, time, dur, vel) => s.triggerAttackRelease(Tone.Frequency(note, "midi"), 0.2, time, vel),
        release: (time) => s.triggerRelease(time),
      };
    }
    case "909-snare": {
      const noise = new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.001, decay: 0.1, sustain: 0 } }).connect(output);
      const body = new Tone.MembraneSynth({ pitchDecay: 0.01, octaves: 2, envelope: { attack: 0.001, decay: 0.08, sustain: 0 } }).connect(output);
      return {
        nodes: [noise, body],
        trigger: (note, time, dur, vel) => {
          noise.triggerAttackRelease(0.08, time, vel);
          body.triggerAttackRelease(Tone.Frequency(note, "midi"), 0.06, time, vel * 0.7);
        },
        release: () => {},
      };
    }
    case "909-chat": {
      const s = new Tone.MetalSynth({
        envelope: { attack: 0.001, decay: 0.04, release: 0.01 },
        harmonicity: 12, modulationIndex: 40, resonance: 7000, octaves: 1,
      }).connect(output);
      // Tone 15's MetalSynth.triggerAttackRelease signature is (note, duration,
      // time, velocity) — the old (duration, time, velocity) call passed "32n"
      // as the note, which made the synth fall over silently.
      return { nodes: [s], trigger: (n, time, dur, vel) => s.triggerAttackRelease(Tone.Frequency(n, "midi"), "32n", time, vel), release: () => {} };
    }
    case "909-ohat": {
      const s = new Tone.MetalSynth({
        envelope: { attack: 0.001, decay: 0.6, release: 0.4 },
        harmonicity: 12, modulationIndex: 40, resonance: 7000, octaves: 1,
      }).connect(output);
      return { nodes: [s], trigger: (n, time, dur, vel) => s.triggerAttackRelease(Tone.Frequency(n, "midi"), "4n", time, vel), release: () => {} };
    }
    case "909-clap": {
      const noise = new Tone.NoiseSynth({ noise: { type: "pink" }, envelope: { attack: 0.001, decay: 0.18, sustain: 0 } }).connect(output);
      return { nodes: [noise], trigger: (n, time, dur, vel) => noise.triggerAttackRelease(0.18, time, vel), release: () => {} };
    }
    case "303": {
      const s = new Tone.MonoSynth({
        oscillator: { type: "sawtooth" },
        envelope: { attack: 0.002, decay: 0.2, sustain: 0.2, release: 0.1 },
        filter: { Q: 8, rolloff: -24, type: "lowpass" },
        filterEnvelope: { attack: 0.002, decay: 0.25, sustain: 0.15, release: 0.3, baseFrequency: 80, octaves: 4.5, exponent: 2 },
      });
      const dist = new Tone.Distortion({ distortion: 0.2, wet: 0.25 });
      s.connect(dist); dist.connect(output);
      return {
        nodes: [s, dist],
        trigger: (note, time, dur, vel) => s.triggerAttackRelease(Tone.Frequency(note, "midi"), dur, time, vel),
        release: (time) => s.triggerRelease(time),
      };
    }
    case "poly-saw": {
      const s = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: "sawtooth" },
        envelope: { attack: 0.005, decay: 0.2, sustain: 0.4, release: 0.4 },
      }).connect(output);
      return {
        nodes: [s],
        trigger: (note, time, dur, vel) => s.triggerAttackRelease(Tone.Frequency(note, "midi"), dur, time, vel),
        release: () => s.releaseAll(),
      };
    }
    case "fm-bell": {
      const s = new Tone.PolySynth(Tone.FMSynth, {
        harmonicity: 3, modulationIndex: 12,
        envelope: { attack: 0.001, decay: 0.6, sustain: 0.1, release: 1.2 },
        modulation: { type: "sine" },
        modulationEnvelope: { attack: 0.01, decay: 0.3, sustain: 0, release: 0.3 },
      }).connect(output);
      return {
        nodes: [s],
        trigger: (note, time, dur, vel) => s.triggerAttackRelease(Tone.Frequency(note, "midi"), dur, time, vel),
        release: () => s.releaseAll(),
      };
    }
    case "pad": {
      const s = new Tone.PolySynth(Tone.AMSynth, {
        envelope: { attack: 0.3, decay: 0.5, sustain: 0.7, release: 1.4 },
      }).connect(output);
      return {
        nodes: [s],
        trigger: (note, time, dur, vel) => s.triggerAttackRelease(Tone.Frequency(note, "midi"), Math.max(dur, 0.3), time, vel),
        release: () => s.releaseAll(),
      };
    }
    case "mini-brute": return makePolyPool(4, () => buildMiniBruteVoice(output));
    case "moog":       return makePolyPool(4, () => buildMoogVoice(output));
    case "juno":       return makePolyPool(6, () => buildJunoVoice(output));
    case "guitar":     return makePolyPool(6, () => buildGuitarVoice(output));
    case "bass":       return makePolyPool(4, () => buildBassVoice(output));
    case "rhodes":     return makePolyPool(6, () => buildRhodesVoice(output));
    case "prophet6":   return makePolyPool(6, () => buildProphet6Voice(output));
  }
  throw new Error("unknown drum-synth kind: " + kind);
}

// ---- mini-brute builder -------------------------------------------------
// One voice instance — see makePolyPool for the 4-voice pool used by the
// public engine entry. Oscillators: saw + detuned-saw (ultrasaw) + PWM pulse +
// metalized triangle + sub sine. All summed through a "brute factor" soft-clip
// and an amp envelope. The track-level filter + filter env provide the sweep.
export function buildMiniBruteVoice(output) {
  const freqSig = new Tone.Signal({ units: "frequency", value: 110 });
  const saw   = new Tone.Oscillator({ type: "sawtooth" }).start();
  const sawD  = new Tone.Oscillator({ type: "sawtooth", detune: 10 }).start();
  const pulse = new Tone.PulseOscillator({ width: 0 }).start();
  const tri   = new Tone.Oscillator({ type: "triangle" }).start();
  const sub   = new Tone.Oscillator({ type: "sine" }).start();
  const subMul = new Tone.Multiply(0.5);
  freqSig.connect(saw.frequency);
  freqSig.connect(sawD.frequency);
  freqSig.connect(pulse.frequency);
  freqSig.connect(tri.frequency);
  freqSig.chain(subMul, sub.frequency);

  let pwBaseVal = 0.5;
  let pwDepth   = 0;
  const pwmLfo = new Tone.LFO({ frequency: 0, min: 0.5, max: 0.5, type: "sine" }).start();
  pwmLfo.connect(pulse.width);
  const updatePW = () => {
    pwmLfo.min = Math.max(0.05, pwBaseVal - pwDepth * 0.4);
    pwmLfo.max = Math.min(0.95, pwBaseVal + pwDepth * 0.4);
  };

  const metal = new Tone.WaveShaper(makeMetalizerCurve(0), 2048);
  tri.connect(metal);

  const ultra = new Tone.Gain(0.35);
  sawD.connect(ultra);

  const fmOsc   = new Tone.Oscillator({ type: "sine" }).start();
  const fmMul   = new Tone.Multiply(2);
  freqSig.chain(fmMul, fmOsc.frequency);
  const fmDepth = new Tone.Gain(0);
  fmOsc.connect(fmDepth);
  fmDepth.connect(saw.detune);
  fmDepth.connect(sawD.detune);
  fmDepth.connect(pulse.detune);
  fmDepth.connect(tri.detune);

  const mixSaw   = new Tone.Gain(0.55);
  const mixPulse = new Tone.Gain(0.35);
  const mixTri   = new Tone.Gain(0.2);
  const mixSub   = new Tone.Gain(0.4);
  saw.connect(mixSaw);
  ultra.connect(mixSaw);
  pulse.connect(mixPulse);
  metal.connect(mixTri);
  sub.connect(mixSub);

  const brute = new Tone.Distortion({ distortion: 0.22, oversample: "2x", wet: 0.55 });
  const amp   = new Tone.AmplitudeEnvelope({ attack: 0.004, decay: 0.2, sustain: 0.7, release: 0.3 });
  const trim  = new Tone.Gain(0.38);
  mixSaw.connect(brute);
  mixPulse.connect(brute);
  mixTri.connect(brute);
  mixSub.connect(amp);
  brute.connect(amp);
  amp.connect(trim);
  trim.connect(output);

  let lastFreq = 110;
  let glideSec = 0.015;
  const setMBParam = (key, val) => {
    const v = Math.max(0, Math.min(1, Number(val) || 0));
    if (key === "osc1")         mixSaw.gain.value   = v;
    else if (key === "osc2")    mixPulse.gain.value = v;
    else if (key === "osc3")    mixTri.gain.value   = v;
    else if (key === "osc4")    mixSub.gain.value   = v;
    else if (key === "harm")    { pwmLfo.frequency.value = v * 8; pwDepth = v; updatePW(); }
    else if (key === "timb")    { pwBaseVal = 0.1 + v * 0.8; updatePW(); }
    else if (key === "metal")   metal.curve = makeMetalizerCurve(v);
    else if (key === "ultra")   ultra.gain.value = v;
    else if (key === "fm")      fmDepth.gain.value = v * 1800;
  };
  return {
    nodes: [saw, sawD, pulse, tri, sub, subMul, freqSig, pwmLfo, fmOsc, fmMul, fmDepth, metal, ultra, mixSaw, mixPulse, mixTri, mixSub, brute, amp, trim],
    setGlide: (g) => { glideSec = Math.max(0.002, Number(g) || 0); },
    setParam: setMBParam,
    getAudioParam: (key) => {
      switch (key) {
        case "osc1": return mixSaw.gain;
        case "osc2": return mixPulse.gain;
        case "osc3": return mixTri.gain;
        case "osc4": return mixSub.gain;
        case "ultra": return ultra.gain;
        case "fm":    return fmDepth.gain;
        case "harm":  return pwmLfo.frequency;
      }
      return null;
    },
    trigger: (note, time, dur, vel) => {
      const f = Tone.Frequency(note, "midi").toFrequency();
      freqSig.cancelScheduledValues(time);
      freqSig.setValueAtTime(lastFreq, time);
      freqSig.linearRampToValueAtTime(f, time + glideSec);
      lastFreq = f;
      amp.triggerAttackRelease(Math.max(0.02, dur), time, vel);
    },
    release: (time) => amp.triggerRelease(time),
  };
}

// ---- moog builder -------------------------------------------------------
// Minimoog-style voice: three oscillators each with independent waveform,
// range, and fine frequency; plus a white/pink noise source. Summed through
// a Chebyshev warmth + EQ3 shelf + amp envelope.
export function buildMoogVoice(output) {
  const freqSig = new Tone.Signal({ units: "frequency", value: 110 });
  const osc1 = new Tone.Oscillator({ type: "sawtooth", detune: 0 }).start();
  const osc2 = new Tone.Oscillator({ type: "sawtooth", detune: 5 }).start();
  const osc3 = new Tone.Oscillator({ type: "triangle", detune: -7 }).start();
  const mul1 = new Tone.Multiply(1);
  const mul2 = new Tone.Multiply(1);
  const mul3 = new Tone.Multiply(0.5);
  freqSig.chain(mul1, osc1.frequency);
  freqSig.chain(mul2, osc2.frequency);
  freqSig.chain(mul3, osc3.frequency);

  const mix1 = new Tone.Gain(0.55);
  const mix2 = new Tone.Gain(0.45);
  const mix3 = new Tone.Gain(0.35);
  osc1.connect(mix1);
  osc2.connect(mix2);
  osc3.connect(mix3);

  let noise = new Tone.Noise({ type: "white" }).start();
  const mixNoise = new Tone.Gain(0);
  noise.connect(mixNoise);

  const warm = new Tone.Chebyshev({ order: 3, wet: 0.35 });
  const shelf = new Tone.EQ3({ low: 1, mid: 0.5, high: -3 });
  const amp = new Tone.AmplitudeEnvelope({ attack: 0.006, decay: 0.22, sustain: 0.75, release: 0.45 });
  const trim = new Tone.Gain(0.34);
  mix1.connect(warm);
  mix2.connect(warm);
  mix3.connect(warm);
  mixNoise.connect(warm);
  warm.connect(shelf);
  shelf.connect(amp);
  amp.connect(trim);
  trim.connect(output);

  const osc2SemiBase = { range: 0, freq: 0 };
  const osc3SemiBase = { range: -1, freq: 0 };
  const osc1Range = { n: 0 };
  const updateMul = () => {
    mul1.factor.value = Math.pow(2, osc1Range.n / 12);
    mul2.factor.value = Math.pow(2, (osc2SemiBase.range * 12 + osc2SemiBase.freq) / 12);
    mul3.factor.value = Math.pow(2, (osc3SemiBase.range * 12 + osc3SemiBase.freq) / 12);
  };
  updateMul();

  let lastFreq = 110;
  let glideSec = 0.02;
  const setMoogParam = (key, val) => {
    if (key === "osc1")         mix1.gain.value = Math.max(0, Math.min(1, Number(val) || 0));
    else if (key === "osc2")    mix2.gain.value = Math.max(0, Math.min(1, Number(val) || 0));
    else if (key === "osc3")    mix3.gain.value = Math.max(0, Math.min(1, Number(val) || 0));
    else if (key === "harm")    osc2.detune.value = 5 + (Number(val) || 0) * 25;
    else if (key === "decay") {
      amp.decay = 0.05 + (Number(val) || 0) * 1.5;
      warm.wet.value = 0.15 + (Number(val) || 0) * 0.55;
    }
    else if (key === "osc1wave") { if (["sine","triangle","sawtooth","square"].includes(val)) osc1.type = val; }
    else if (key === "osc2wave") { if (["sine","triangle","sawtooth","square"].includes(val)) osc2.type = val; }
    else if (key === "osc3wave") { if (["sine","triangle","sawtooth","square"].includes(val)) osc3.type = val; }
    else if (key === "osc1range") { osc1Range.n = Number(val) * 12; updateMul(); }
    else if (key === "osc2range") { osc2SemiBase.range = Number(val) || 0; updateMul(); }
    else if (key === "osc3range") { osc3SemiBase.range = Number(val) || 0; updateMul(); }
    else if (key === "osc2freq")  { osc2SemiBase.freq  = Number(val) || 0; updateMul(); }
    else if (key === "osc3freq")  { osc3SemiBase.freq  = Number(val) || 0; updateMul(); }
    else if (key === "noise")     mixNoise.gain.value = Math.max(0, Math.min(1, Number(val) || 0));
    else if (key === "noisetype") {
      if (val === "white" || val === "pink") {
        try { noise.stop(); } catch {}
        try { noise.disconnect(); } catch {}
        try { noise.dispose(); } catch {}
        noise = new Tone.Noise({ type: val }).start();
        noise.connect(mixNoise);
      }
    }
  };
  return {
    nodes: [osc1, osc2, osc3, mul1, mul2, mul3, freqSig, mix1, mix2, mix3, mixNoise, warm, shelf, amp, trim],
    setGlide: (g) => { glideSec = Math.max(0.002, Number(g) || 0); },
    setParam: setMoogParam,
    getAudioParam: (key) => {
      switch (key) {
        case "osc1":  return mix1.gain;
        case "osc2":  return mix2.gain;
        case "osc3":  return mix3.gain;
        case "noise": return mixNoise.gain;
        case "harm":  return osc2.detune;
      }
      return null;
    },
    trigger: (note, time, dur, vel) => {
      const f = Tone.Frequency(note, "midi").toFrequency();
      freqSig.cancelScheduledValues(time);
      freqSig.setValueAtTime(lastFreq, time);
      freqSig.linearRampToValueAtTime(f, time + glideSec);
      lastFreq = f;
      amp.triggerAttackRelease(Math.max(0.02, dur), time, vel);
    },
    release: (time) => amp.triggerRelease(time),
  };
}

// ---- juno 60 builder ----------------------------------------------------
// Roland Juno-60-style voice. Single DCO (pulse with LFO-driven PWM) + a sub
// square one octave below + a noise source, into HPF → soft-saturation → amp
// envelope → chorus (the iconic Juno chorus). Track-level filter + filter env
// provide the VCF sweep.
export function buildJunoVoice(output) {
  const freqSig = new Tone.Signal({ units: "frequency", value: 110 });
  const dco  = new Tone.PulseOscillator({ width: 0 }).start();       // width driven by LFO below
  const sub  = new Tone.Oscillator({ type: "square" }).start();
  const subMul = new Tone.Multiply(0.5);
  freqSig.connect(dco.frequency);
  freqSig.chain(subMul, sub.frequency);

  // PWM LFO — min=max sits at base when depth = 0
  let pwBaseVal = 0.5;
  let pwDepth   = 0;
  const pwmLfo = new Tone.LFO({ frequency: 0, min: 0.5, max: 0.5, type: "sine" }).start();
  pwmLfo.connect(dco.width);
  const updatePW = () => {
    pwmLfo.min = Math.max(0.05, pwBaseVal - pwDepth * 0.4);
    pwmLfo.max = Math.min(0.95, pwBaseVal + pwDepth * 0.4);
  };

  let noise = new Tone.Noise({ type: "white" }).start();
  const mixNoise = new Tone.Gain(0);
  noise.connect(mixNoise);

  const mixDco = new Tone.Gain(0.55);
  const mixSub = new Tone.Gain(0.4);
  dco.connect(mixDco);
  sub.connect(mixSub);

  const hpf = new Tone.Filter({ type: "highpass", frequency: 60, rolloff: -12 });
  const amp = new Tone.AmplitudeEnvelope({ attack: 0.005, decay: 0.25, sustain: 0.75, release: 0.35 });
  // Classic Juno stereo chorus — baked in since it defines the character.
  const chorus = new Tone.Chorus({ frequency: 0.5, delayTime: 3.5, depth: 0.35, feedback: 0, wet: 0.6, spread: 180 }).start();
  const trim = new Tone.Gain(0.4);
  mixDco.connect(hpf);
  mixSub.connect(hpf);
  mixNoise.connect(hpf);
  hpf.connect(amp);
  amp.connect(chorus);
  chorus.connect(trim);
  trim.connect(output);

  let lastFreq = 110;
  let glideSec = 0.015;
  const setJunoParam = (key, val) => {
    const v = Math.max(0, Math.min(1, Number(val) || 0));
    if (key === "osc1")         mixDco.gain.value   = v;                         // DCO level
    else if (key === "osc2")    mixSub.gain.value   = v;                         // sub level
    else if (key === "osc3")    mixNoise.gain.value = v;                         // noise level
    else if (key === "harm")    { pwmLfo.frequency.value = v * 8; pwDepth = v; updatePW(); }  // PWM rate + depth
    else if (key === "timb")    { pwBaseVal = 0.1 + v * 0.8; updatePW(); }        // pulse width
    else if (key === "morph")   { chorus.wet.value = v; chorus.depth = 0.2 + v * 0.6; }  // chorus intensity
    else if (key === "decay") {                                                   // amp decay + HPF freq
      amp.decay = 0.05 + v * 1.5;
      hpf.frequency.value = 30 + v * 180;
    }
    else if (key === "noisetype") {
      if (val === "white" || val === "pink") {
        try { noise.stop(); } catch {}
        try { noise.disconnect(); } catch {}
        try { noise.dispose(); } catch {}
        noise = new Tone.Noise({ type: val }).start();
        noise.connect(mixNoise);
      }
    }
  };
  return {
    nodes: [dco, sub, subMul, freqSig, pwmLfo, mixDco, mixSub, mixNoise, hpf, amp, chorus, trim],
    setGlide: (g) => { glideSec = Math.max(0.002, Number(g) || 0); },
    setParam: setJunoParam,
    getAudioParam: (key) => {
      switch (key) {
        case "osc1":  return mixDco.gain;
        case "osc2":  return mixSub.gain;
        case "osc3":  return mixNoise.gain;   // juno's osc3 slot is the noise mix
        case "noise": return mixNoise.gain;
        case "harm":  return pwmLfo.frequency;
      }
      return null;
    },
    trigger: (note, time, dur, vel) => {
      const f = Tone.Frequency(note, "midi").toFrequency();
      freqSig.cancelScheduledValues(time);
      freqSig.setValueAtTime(lastFreq, time);
      freqSig.linearRampToValueAtTime(f, time + glideSec);
      lastFreq = f;
      amp.triggerAttackRelease(Math.max(0.02, dur), time, vel);
    },
    release: (time) => amp.triggerRelease(time),
  };
}

// ---- electric guitar builder --------------------------------------------
// Karplus-Strong plucked-string voice (Tone.PluckSynth) into a drive+tone shaping
// chain. Track-level filter + filter env can still sweep on top. Per-step
// velocity maps to pick intensity (brighter = harder pick) via dampening.
export function buildGuitarVoice(output) {
  const pluck = new Tone.PluckSynth({
    attackNoise: 1,
    dampening: 4200,
    resonance: 0.92,
    release: 0.8,
  });
  // Drive stage — moderate distortion by default; controlled by the "dist" param.
  const drive = new Tone.Distortion({ distortion: 0.22, oversample: "2x", wet: 0.55 });
  // Tone shaping — boost mids + slight high roll for a rounded electric-guitar feel.
  const eq = new Tone.EQ3({ low: -2, mid: 2, high: -1 });
  // A little body + space via short reverb and a dash of chorus for chorus-pedal vibe.
  const chorus = new Tone.Chorus({ frequency: 0.7, delayTime: 2.5, depth: 0.25, wet: 0.25 }).start();
  const trim = new Tone.Gain(0.9);
  pluck.connect(drive);
  drive.connect(eq);
  eq.connect(chorus);
  chorus.connect(trim);
  trim.connect(output);

  let lastFreq = 110;
  let glideSec = 0.005;   // guitars don't really glide, but allow a tiny ramp
  const setGuitarParam = (key, val) => {
    const v = Math.max(0, Math.min(1, Number(val) || 0));
    if (key === "harm") {                                         // drive amount
      drive.distortion = 0.05 + v * 0.65;
      drive.wet.value = 0.15 + v * 0.7;
    }
    else if (key === "timb") pluck.dampening = 500 + v * 6500;     // brightness (Hz)
    else if (key === "morph") chorus.wet.value = v;                // chorus wet
    else if (key === "decay") pluck.release = 0.15 + v * 3.2;      // string sustain
  };
  return {
    nodes: [pluck, drive, eq, chorus, trim],
    setGlide: (g) => { glideSec = Math.max(0.002, Number(g) || 0); },
    setParam: setGuitarParam,
    trigger: (note, time, dur, vel) => {
      try {
        // Harder velocity → brighter pick. Tone's PluckSynth has no velocity arg
        // so we modulate output + dampening per hit.
        const v = Math.max(0.15, Math.min(1, vel || 0.8));
        trim.gain.setValueAtTime(0.9 * v * 1.4, time);
        pluck.triggerAttackRelease(Tone.Frequency(note, "midi"), Math.max(0.05, dur), time);
      } catch {}
      lastFreq = Tone.Frequency(note, "midi").toFrequency();
    },
    release: () => { try { pluck.triggerRelease?.(); } catch {} },
  };
}

// ---- electric bass builder ---------------------------------------------
// Tuned for low-register Karplus-Strong: darker pluck, longer resonance, mild
// tube-ish drive, gentle high-shelf roll-off and a low-end boost. No chorus —
// electric bass usually lives bone-dry.
export function buildBassVoice(output) {
  const pluck = new Tone.PluckSynth({
    attackNoise: 0.6,        // softer attack than guitar — fingers, not a pick
    dampening: 2200,         // darker — bass sits below the fundamental guitar range
    resonance: 0.97,         // longer string ring
    release: 1.4,
  });
  const drive = new Tone.Distortion({ distortion: 0.12, oversample: "2x", wet: 0.4 });
  const eq = new Tone.EQ3({ low: 3, mid: 1, high: -4 });   // bass lift + upper cut
  const compGain = new Tone.Gain(1.5);                       // post-EQ makeup gain
  const trim = new Tone.Gain(1.8);
  pluck.connect(drive);
  drive.connect(eq);
  eq.connect(compGain);
  compGain.connect(trim);
  trim.connect(output);

  let lastFreq = 80;
  let glideSec = 0.005;
  const setBassParam = (key, val) => {
    const v = Math.max(0, Math.min(1, Number(val) || 0));
    if (key === "harm") {                           // drive amount (finger → pick → overdriven)
      drive.distortion = 0.03 + v * 0.55;
      drive.wet.value = 0.2 + v * 0.6;
    }
    else if (key === "timb")  pluck.dampening = 400 + v * 4000;    // brightness / pick position
    else if (key === "morph") pluck.resonance = 0.85 + v * 0.14;   // string resonance
    else if (key === "decay") pluck.release = 0.25 + v * 3.5;      // sustain
  };
  return {
    nodes: [pluck, drive, eq, compGain, trim],
    setGlide: (g) => { glideSec = Math.max(0.002, Number(g) || 0); },
    setParam: setBassParam,
    trigger: (note, time, dur, vel) => {
      try {
        const v = Math.max(0.15, Math.min(1, vel || 0.8));
        // Harder attack → fuller output; softer → more finger-style dynamic.
        trim.gain.setValueAtTime(1.8 * (0.7 + v * 0.5), time);
        pluck.triggerAttackRelease(Tone.Frequency(note, "midi"), Math.max(0.05, dur), time);
      } catch {}
      lastFreq = Tone.Frequency(note, "midi").toFrequency();
    },
    release: () => { try { pluck.triggerRelease?.(); } catch {} },
  };
}

// ---- rhodes piano builder ----------------------------------------------
// Rhodes electric piano — FM synthesis (modulator into sine carrier) is the
// classic DX7 "full tines" recipe. Harmonicity 3 + high modulation index +
// sharp modulation-envelope decay gives the bell-like attack; amp env long
// release carries the warm tail. Chorus adds the signature Rhodes warble.
export function buildRhodesVoice(output) {
  const synth = new Tone.FMSynth({
    harmonicity: 3,
    modulationIndex: 14,
    oscillator: { type: "sine" },
    envelope: { attack: 0.002, decay: 1.2, sustain: 0, release: 1.6 },
    modulation: { type: "sine" },
    modulationEnvelope: { attack: 0.002, decay: 0.4, sustain: 0, release: 0.6 },
  });
  const chorus = new Tone.Chorus({ frequency: 1.2, delayTime: 2.8, depth: 0.4, wet: 0.3 }).start();
  const trim = new Tone.Gain(0.8);
  synth.connect(chorus);
  chorus.connect(trim);
  trim.connect(output);

  let lastFreq = 261.63;
  let glideSec = 0.002;
  const setRhodesParam = (key, val) => {
    const v = Math.max(0, Math.min(1, Number(val) || 0));
    if (key === "harm")      synth.harmonicity.value = 0.5 + v * 5;        // tine color (bell ↔ deep)
    else if (key === "timb") synth.modulationIndex.value = 2 + v * 28;     // brightness / bite
    else if (key === "morph") chorus.wet.value = v;                        // chorus wet
    else if (key === "decay") {                                            // amp env decay + release
      synth.envelope.decay  = 0.1 + v * 3.5;
      synth.envelope.release = 0.3 + v * 4;
      synth.modulationEnvelope.decay = 0.1 + v * 1.2;
    }
  };
  return {
    nodes: [synth, chorus, trim],
    setGlide: (g) => { glideSec = Math.max(0.002, Number(g) || 0); },
    setParam: setRhodesParam,
    trigger: (note, time, dur, vel) => {
      try {
        const v = Math.max(0.15, Math.min(1, vel || 0.8));
        // Softer keys = less modulation bite, harder keys = bright tine spank.
        // Modulate the mod index briefly during attack for velocity-sensitivity.
        const bright = 6 + v * 20;
        synth.modulationIndex.cancelScheduledValues(time);
        synth.modulationIndex.setValueAtTime(bright, time);
        synth.triggerAttackRelease(Tone.Frequency(note, "midi"), Math.max(0.08, dur), time, v);
      } catch {}
      lastFreq = Tone.Frequency(note, "midi").toFrequency();
    },
    release: () => { try { synth.triggerRelease?.(); } catch {} },
  };
}

// ---- prophet 6 builder --------------------------------------------------
// Two VCOs (saw + saw/pulse morph) with cent-level detune for the classic
// "fat" unison, a square sub at -1 oct, noise, an analog-style drive stage,
// amp envelope, and a touch of chorus — the baked-in character of the P6's
// stereo effects block. Filter + filter-env come from the track's own chain.
export function buildProphet6Voice(output) {
  const freqSig = new Tone.Signal({ units: "frequency", value: 220 });

  // VCO 1 — saw (the workhorse)
  const vco1 = new Tone.Oscillator({ type: "sawtooth", frequency: 220 }).start();
  freqSig.connect(vco1.frequency);

  // VCO 2 — saw/pulse crossfade controlled by `timb`; detuned by `harm`
  const vco2Saw   = new Tone.Oscillator({ type: "sawtooth", frequency: 220 }).start();
  const vco2Pulse = new Tone.PulseOscillator({ width: 0.5, frequency: 220 }).start();
  freqSig.connect(vco2Saw.frequency);
  freqSig.connect(vco2Pulse.frequency);

  // Sub — square at -1 octave
  const sub    = new Tone.Oscillator({ type: "square" }).start();
  const subMul = new Tone.Multiply(0.5);
  freqSig.chain(subMul, sub.frequency);

  // Noise
  const noise = new Tone.Noise({ type: "white" }).start();

  // Mixers
  const mixVco1   = new Tone.Gain(0.6);
  const mixVco2   = new Tone.Gain(0.5);
  const mixSub    = new Tone.Gain(0.25);
  const mixNoise  = new Tone.Gain(0);

  // VCO 2 shape crossfade (saw↔pulse)
  const vco2SawGain   = new Tone.Gain(1);
  const vco2PulseGain = new Tone.Gain(0);
  const vco2Sum       = new Tone.Gain(1);
  vco2Saw.connect(vco2SawGain);
  vco2Pulse.connect(vco2PulseGain);
  vco2SawGain.connect(vco2Sum);
  vco2PulseGain.connect(vco2Sum);
  vco2Sum.connect(mixVco2);

  vco1.connect(mixVco1);
  sub.connect(mixSub);
  noise.connect(mixNoise);

  // Summing bus → drive → amp envelope → chorus
  const preDrive = new Tone.Gain(1);
  mixVco1.connect(preDrive);
  mixVco2.connect(preDrive);
  mixSub.connect(preDrive);
  mixNoise.connect(preDrive);

  // Drive stage — wet controlled by `morph`; distortion kept at 0.5 so turning
  // morph up crossfades to a fixed-character saturation instead of ramping
  // harshness without limit.
  const drive = new Tone.Distortion({ distortion: 0.5, wet: 0 });
  preDrive.connect(drive);

  const amp = new Tone.AmplitudeEnvelope({ attack: 0.005, decay: 0.35, sustain: 0.7, release: 0.45 });
  drive.connect(amp);

  const chorus = new Tone.Chorus({ frequency: 0.45, delayTime: 2.8, depth: 0.3, feedback: 0, wet: 0.22, spread: 180 }).start();
  amp.connect(chorus);

  const trim = new Tone.Gain(0.5);
  chorus.connect(trim);
  trim.connect(output);

  let lastFreq = 220;
  let glideSec = 0.005;
  const setP6Param = (key, val) => {
    const v = Math.max(0, Math.min(1, Number(val) || 0));
    if (key === "osc1")       mixVco1.gain.value  = v;
    else if (key === "osc2")  mixVco2.gain.value  = v;
    else if (key === "osc3")  mixSub.gain.value   = v;
    else if (key === "osc4")  mixNoise.gain.value = v;
    else if (key === "noise") mixNoise.gain.value = v;
    else if (key === "harm") {
      // detune VCO2 ±30 cents; 0.5 = unison, extremes = fat chorus-y width
      const cents = (v - 0.5) * 60;
      vco2Saw.detune.value   = cents;
      vco2Pulse.detune.value = cents;
    }
    else if (key === "timb") {
      // saw↔pulse crossfade via equal-power; also sweep pulse width
      vco2SawGain.gain.value   = Math.cos(v * Math.PI / 2);
      vco2PulseGain.gain.value = Math.sin(v * Math.PI / 2);
      vco2Pulse.width.value    = 0.1 + v * 0.8;
    }
    else if (key === "morph") {
      drive.wet.value = v;
    }
    else if (key === "decay") {
      amp.decay   = 0.05 + v * 2;
      amp.release = 0.1  + v * 2.5;
    }
  };

  return {
    nodes: [vco1, vco2Saw, vco2Pulse, sub, noise, freqSig, subMul,
            mixVco1, mixVco2, mixSub, mixNoise,
            vco2SawGain, vco2PulseGain, vco2Sum,
            preDrive, drive, amp, chorus, trim],
    setGlide: (g) => { glideSec = Math.max(0.002, Number(g) || 0); },
    setParam: setP6Param,
    getAudioParam: (key) => {
      switch (key) {
        case "osc1":  return mixVco1.gain;
        case "osc2":  return mixVco2.gain;
        case "osc3":  return mixSub.gain;
        case "osc4":  return mixNoise.gain;
        case "noise": return mixNoise.gain;
        case "harm":  return vco2Saw.detune;
      }
      return null;
    },
    trigger: (note, time, dur, vel) => {
      const f = Tone.Frequency(note, "midi").toFrequency();
      freqSig.cancelScheduledValues(time);
      freqSig.setValueAtTime(lastFreq, time);
      freqSig.linearRampToValueAtTime(f, time + glideSec);
      lastFreq = f;
      amp.triggerAttackRelease(Math.max(0.05, dur), time, vel);
    },
    release: (time) => amp.triggerRelease(time),
  };
}

export class DrumSynthVoice {
  constructor(ctx, key, params) {
    this.ctx = ctx;
    this.type = "drum-synth";
    const e = engineByKey(key);
    this.poly = !!e?.poly;
    this.key = key;
    this.glide = 0;
    this.output = new Tone.Gain(params.vol).toDestination();
    this.kind = key.split(":")[1];
    this.params = { ...params };
    this.built = buildDrumSynthNode(this.kind, this.output);
    this._applyParams();
  }
  _applyParams() {
    if (!this.built.setParam) return;
    for (const k of ["harm", "timb", "morph", "decay",
                     "osc1", "osc2", "osc3", "osc4",
                     "ultra", "fm", "metal",
                     "osc1wave", "osc2wave", "osc3wave",
                     "osc1range", "osc2range", "osc3range",
                     "osc2freq", "osc3freq", "noise", "noisetype"]) {
      if (this.params?.[k] != null) this.built.setParam(k, this.params[k]);
    }
  }
  getOutputNode() { return this.output.output ?? this.output.input; }
  setDestination(target) {
    try { this.output.disconnect(); } catch {}
    this.output.connect(target);
  }
  setGlide(seconds) {
    this.glide = Math.max(0, Number(seconds) || 0);
    // Tone.MonoSynth has a portamento property
    for (const n of this.built.nodes) {
      if (n instanceof Tone.MonoSynth) n.portamento = this.glide;
    }
    // Custom voices (e.g. mini-brute) can opt in via built.setGlide
    this.built.setGlide?.(this.glide);
  }
  canInPlaceChange(newKey) { return false; }
  setEngine(key) {
    this.rebuild(key);
  }
  rebuild(key) {
    for (const n of this.built.nodes) { try { n.dispose(); } catch {} }
    this.kind = key.split(":")[1];
    this.key = key;
    const e = engineByKey(key);
    this.poly = !!e?.poly;
    this.built = buildDrumSynthNode(this.kind, this.output);
    this._applyParams();
  }
  setParam(key, val) {
    if (key === "vol") this.output.gain.value = val;
    else {
      if (!this.params) this.params = {};
      this.params[key] = val;
      this.built.setParam?.(key, val);
    }
  }
  getAudioParam(key) {
    if (key === "vol") return this.output.gain;
    return this.built?.getAudioParam?.(key) ?? null;
  }
  hit(midiNote, time, duration, velocity = 1) {
    try { this.built.trigger(midiNote, time, duration, Math.max(0, Math.min(1, velocity))); }
    catch (e) { console.warn("drum-synth trigger", e); }
  }
  // Held-note support for the computer keyboard: attack with a long duration so
  // the envelope sustains, then release once no keyboard keys remain held. (The
  // Tone builders expose only a synth-wide release, so a held chord releases when
  // the last key lifts — fine for playing, and it also releases any sequencer
  // notes if you play while the transport runs.)
  noteOn(midiNote, time, velocity = 1) {
    if (!this._heldNotes) this._heldNotes = new Set();
    this._heldNotes.add(midiNote);
    try { this.built.trigger(midiNote, time, 30, Math.max(0, Math.min(1, velocity))); }
    catch (e) { console.warn("drum-synth noteOn", e); }
  }
  noteOff(midiNote, time) {
    this._heldNotes?.delete(midiNote);
    if (!this._heldNotes || this._heldNotes.size === 0) { try { this.built.release?.(time); } catch {} }
  }
  silence(now) {
    this._heldNotes?.clear();
    try { this.built.release?.(now); } catch {}
  }
  dispose() {
    for (const n of this.built.nodes) { try { n.dispose(); } catch {} }
    try { this.output.dispose(); } catch {}
  }
}

// Build a ping-pong buffer from a sub-region of an input buffer: [forward | reversed].
// Caches per (buffer, startFrac, endFrac) so step-loop playback doesn't rebuild it each hit.
// The one unified sampler voice. Source is either a user upload
// (track.uploadBuffer, base64-persisted) or a bundled sample (loaded by id from
// track.sampleSource). Replaces the old SampleVoice / UploadVoice / ElevenVoice.
// Region/fade/loop come from the track-level sample settings via opts; the
// note-triggered slicer (Stage 3) overrides the region per note.
export class SamplerVoice {
  constructor(ctx, key, params, track) {
    this.ctx = ctx;
    this.type = "sampler";
    this.poly = true;
    this.key = key;
    this.track = track || null;
    this.boost = ctx.createGain();
    this.boost.gain.value = 1;                    // user samples are usually already hot
    this.output = ctx.createGain();
    this.output.gain.value = params.vol ?? 0.8;
    this.boost.connect(this.output);
    this.output.connect(ctx.destination);
    this.active = new Set();
    this.baseRate = 1;
    this.buffer = track?.uploadBuffer ?? null;
    // Bundled source with no decoded buffer yet → fetch it.
    if (!this.buffer && track?.sampleSource?.kind === "bundled" && track.sampleSource.id) {
      this.loadBundled(track.sampleSource.id);
    }
  }
  loadBundled(id) {
    const url = `${SAMPLE_BASE}/${id}.mp3`;
    loadBuffer(this.ctx, url).then(buf => {
      if (this.track?.sampleSource?.id === id) { this.buffer = buf; if (this.track) this.track.uploadBuffer = buf; }
    }).catch(err => console.warn("sample load", err));
  }
  getOutputNode() { return this.output; }
  setDestination(target) {
    try { this.output.disconnect(); } catch {}
    this.output.connect(target);
  }
  canInPlaceChange(newKey) { return newKey === "sampler"; }
  setEngine() {}
  setBuffer(buf) { this.buffer = buf; }
  setBaseRate(rate) { this.baseRate = Math.max(0.01, Number(rate) || 1); }
  setParam(key, val) { if (key === "vol") this.output.gain.value = val; }
  getAudioParam(key) { return key === "vol" ? this.output.gain : null; }
  hit(midiNote, time, duration, velocity = 1, opts = null) {
    if (!this.buffer) return;
    // Slicer: the note selects a slice (chromatic from sliceBase); the slice
    // plays at natural rate (no transpose) as a one-shot region, with the
    // track-level fades. Region ends at the next marker, or the sample end when
    // slicePlayMode is "toend". Out-of-range notes are silent.
    const tr = this.track;
    if (tr?.sliceOn && Array.isArray(tr.slices) && tr.slices.length) {
      const idx = Math.round(midiNote) - (tr.sliceBase ?? 60);
      if (idx < 0 || idx >= tr.slices.length) return;
      const sd = tr.sampleDefaults || {};
      const start = Math.max(0, Math.min(1, tr.slices[idx]));
      const rawEnd = (tr.slicePlayMode === "toend") ? (sd.end ?? 1) : (tr.slices[idx + 1] ?? sd.end ?? 1);
      const end = Math.max(start + 0.001, Math.min(1, rawEnd));
      const sopts = { startOffset: start, endOffset: end, fadeIn: sd.fadeIn ?? 0, fadeOut: sd.fadeOut ?? 0, loopMode: "off" };
      const regionWall = ((end - start) * this.buffer.duration) / Math.max(0.01, this.baseRate);
      const { src, stopTime } = startSampleSource(this.ctx, this.buffer, this.baseRate, time, Math.max(0.05, regionWall), sopts);
      const g = this.ctx.createGain();
      applySampleFadeEnvelope(g, time, stopTime, Math.max(0, Math.min(1, velocity)), sopts);
      src.connect(g).connect(this.boost);
      src.stop(stopTime + 0.01);
      this.active.add(src);
      src.onended = () => this.active.delete(src);
      return;
    }
    const rate = sampleHitRate(this.baseRate, midiNote, opts);
    const { src, stopTime } = startSampleSource(this.ctx, this.buffer, rate, time, duration, opts);
    const g = this.ctx.createGain();
    applySampleFadeEnvelope(g, time, stopTime, Math.max(0, Math.min(1, velocity)), opts);
    src.connect(g).connect(this.boost);
    src.stop(stopTime + 0.01);
    this.active.add(src);
    src.onended = () => this.active.delete(src);
  }
  // Held-note support for the computer keyboard: start the region/slice with a
  // long duration (loops sustain; one-shots play through) and fade it out on
  // noteOff. Resolves the slice/region exactly like hit().
  noteOn(midiNote, time, velocity = 1, opts = null) {
    if (!this.buffer) return;
    if (!this._held) this._held = new Map();
    const tr = this.track;
    let start, end, fadeIn, fadeOut, loopMode, rate;
    if (tr?.sliceOn && Array.isArray(tr.slices) && tr.slices.length) {
      const idx = Math.round(midiNote) - (tr.sliceBase ?? 60);
      if (idx < 0 || idx >= tr.slices.length) return;
      const sd = tr.sampleDefaults || {};
      start = Math.max(0, Math.min(1, tr.slices[idx]));
      const rawEnd = (tr.slicePlayMode === "toend") ? (sd.end ?? 1) : (tr.slices[idx + 1] ?? sd.end ?? 1);
      end = Math.max(start + 0.001, Math.min(1, rawEnd));
      fadeIn = sd.fadeIn ?? 0; fadeOut = sd.fadeOut ?? 0; loopMode = "off"; rate = this.baseRate;
    } else {
      start = opts?.startOffset ?? 0; end = opts?.endOffset ?? 1;
      fadeIn = opts?.fadeIn ?? 0; fadeOut = opts?.fadeOut ?? 0; loopMode = opts?.loopMode ?? "off";
      rate = sampleHitRate(this.baseRate, midiNote, opts);
    }
    const sopts = { startOffset: start, endOffset: end, fadeIn, fadeOut, loopMode };
    const { src, stopTime } = startSampleSource(this.ctx, this.buffer, rate, time, 30, sopts);
    const g = this.ctx.createGain();
    applySampleFadeEnvelope(g, time, stopTime, Math.max(0, Math.min(1, velocity)), sopts);
    src.connect(g).connect(this.boost);
    src.stop(stopTime + 0.01);
    this.active.add(src);
    src.onended = () => this.active.delete(src);
    const prev = this._held.get(midiNote);
    if (prev) this._stopHeld(prev, time);
    this._held.set(midiNote, { src, g });
  }
  noteOff(midiNote, time) {
    const rec = this._held?.get(midiNote);
    if (!rec) return;
    this._held.delete(midiNote);
    this._stopHeld(rec, time);
  }
  _stopHeld(rec, time) {
    try {
      rec.g.gain.cancelScheduledValues(time);
      rec.g.gain.setValueAtTime(rec.g.gain.value, time);
      rec.g.gain.linearRampToValueAtTime(0.0001, time + 0.03);
    } catch {}
    try { rec.src.stop(time + 0.05); } catch {}
  }
  silence(now) {
    this._held?.clear();
    for (const s of this.active) { try { s.stop(now); } catch {} }
    this.active.clear();
  }
  dispose() {
    this.silence(this.ctx.currentTime);
    try { this.boost.disconnect(); } catch {}
    try { this.output.disconnect(); } catch {}
  }
}

export class CustomToneVoice {
  constructor(ctx, key, params, config) {
    this.ctx = ctx;
    this.type = "custom";
    this.key = key;
    this.config = config;
    this.poly = !!config?.poly;
    this.output = new Tone.Gain(params.vol).toDestination();
    this.build();
  }
  getOutputNode() { return this.output.output ?? this.output.input; }
  setDestination(target) {
    try { this.output.disconnect(); } catch {}
    this.output.connect(target);
  }
  build() {
    const cfg = this.config;
    if (!cfg) { this.synth = null; this.effectNodes = []; return; }
    try {
      const ToneClass = Tone[cfg.synth];
      if (!ToneClass) throw new Error("no Tone class " + cfg.synth);
      const opts = cfg.options || {};
      const effects = (cfg.effects || []).map(e => {
        const EffectClass = Tone[e.type];
        if (!EffectClass) return null;
        try { return new EffectClass(e.options || {}); } catch { return null; }
      }).filter(Boolean);
      const synth = cfg.poly
        ? new Tone.PolySynth(ToneClass, opts)
        : new ToneClass(opts);
      // chain: synth -> effects... -> output
      let last = synth;
      for (const fx of effects) {
        last.connect(fx);
        last = fx;
      }
      last.connect(this.output);
      this.synth = synth;
      this.effectNodes = effects;
    } catch (err) {
      console.warn("custom voice build failed:", err);
      this.synth = null;
      this.effectNodes = [];
    }
  }
  canInPlaceChange(newKey) { return newKey === "custom"; }
  setEngine(key) { this.key = key; }
  applyConfig(newConfig) {
    this.teardown();
    this.config = newConfig;
    this.poly = !!newConfig?.poly;
    this.build();
  }
  setParam(key, val) { if (key === "vol") this.output.gain.value = val; }
  getAudioParam(key) { return key === "vol" ? this.output.gain : null; }
  hit(midiNote, time, duration, velocity = 1) {
    if (!this.synth) return;
    try {
      this.synth.triggerAttackRelease(
        Tone.Frequency(midiNote, "midi"),
        Math.max(0.02, duration),
        time,
        Math.max(0, Math.min(1, velocity))
      );
    } catch (e) { console.warn("custom hit", e); }
  }
  silence() {
    try { this.synth?.releaseAll?.(); } catch {}
    try { this.synth?.triggerRelease?.(); } catch {}
  }
  teardown() {
    for (const fx of this.effectNodes || []) { try { fx.dispose(); } catch {} }
    try { this.synth?.dispose(); } catch {}
    this.synth = null;
    this.effectNodes = [];
  }
  dispose() {
    this.teardown();
    try { this.output.dispose(); } catch {}
  }
}

// Loudness-normalize an AudioBuffer in place using an RMS target, capped at a safe peak
// so transients don't clip. Target is -14 dBFS RMS (≈0.2), matching typical loud-but-not-
// crushed sample levels. Tapers the last ~5ms to zero to kill end-of-sample clicks.
// Return a new AudioBuffer with leading + trailing silence trimmed.
// Uses a short (~10ms) sliding-window RMS to find the first/last above-threshold
// region; preserves a small pad on each side so transients aren't clipped.
// (ElevenVoice + UploadVoice removed — both collapsed into SamplerVoice above.)

// Amp contour for a granular note: quick attack, full level through the note,
// then a linear release tail. Returns 0..1 at grain-onset offset `dt` seconds.
function envAt(dt, noteDur, attackT, releaseT) {
  if (dt < attackT) return dt / attackT;
  if (dt <= noteDur) return 1;
  const rt = dt - noteDur;
  if (rt >= releaseT) return 0;
  return 1 - rt / releaseT;
}

// ---- granular voice -----------------------------------------------------
// A true granular synth modeled on the 1010music nanobox | lemondrop grain
// engine. It granulates the track's uploaded sample (`track.uploadBuffer`).
// Every note sprays a cloud of short, Hann-windowed grains, each a
// BufferSourceNode reading a small slice of the sample, pitched to the note and
// panned across the stereo field.
//
// The play head is either Fixed (grains drawn from a window around `pos`) or
// Moving (the head scans through the buffer at `speed`, wrapping per `loop`).
// Window spreads the read position, Detune adds per-grain random pitch, Jitter
// randomizes grain timing, Pan randomizes stereo placement, and Pattern layers
// octave/fifth pitch jumps. Grain rate follows `density` grains/sec, or a
// tempo-locked musical division when `sync` is on. No sample → silent.
//
// Macro params (track sliders): harm → grain size, timb → density,
// morph → play position, decay → spray (a global diffusion macro that boosts
// window + detune + jitter together). Detailed params (granular group):
// gplay, gspeed, gloop, gwindow, gjitter, gdetune, gpan, gpattern, gsync, grate.

// Musical division → beats (quarter note = 1 beat) for beat-synced grain rate.
export const GRAN_RATE_BEATS = {
  "1/64": 1 / 16, "1/32t": 1 / 12, "1/32": 1 / 8, "1/16t": 1 / 6, "1/16": 1 / 4,
  "1/8t": 1 / 3, "1/8": 1 / 2, "1/4t": 2 / 3, "1/4": 1, "1/2t": 4 / 3, "1/2": 2,
  "1bar": 4, "2bar": 8, "4bar": 16, "8bar": 32,
};

export const GRAN_DEFAULTS = {
  gplay: "fixed", gspeed: 0.5, gloop: "fwd", gwindow: 0.15, gjitter: 0.1,
  gdetune: 0, gpan: 0.3, gpattern: "none", gsync: false, grate: "1/16",
};

export class GranularVoice {
  constructor(ctx, key, params, track) {
    this.ctx = ctx;
    this.type = "granular";
    this.poly = true;
    this.key = key;
    this.output = ctx.createGain();
    this.output.gain.value = params.vol ?? 0.8;
    this.output.connect(ctx.destination);
    this.buffer = track?.uploadBuffer ?? null;
    this.params = { ...params };
    this.active = new Set();
    // macro params (0..1 slider values mapped in setParam)
    this.grainSize = 0.16;  // seconds  (harm)
    this.density   = 49;    // grains/sec (timb)
    this.pos       = 0;     // 0..1 scan position into the buffer (morph)
    this.spray     = 0.2;   // global diffusion macro (decay)
    // detailed grain params (granular group) — seeded from defaults
    this.gplay    = GRAN_DEFAULTS.gplay;
    this.gspeed   = GRAN_DEFAULTS.gspeed;
    this.gloop    = GRAN_DEFAULTS.gloop;
    this.gwindow  = GRAN_DEFAULTS.gwindow;
    this.gjitter  = GRAN_DEFAULTS.gjitter;
    this.gdetune  = GRAN_DEFAULTS.gdetune;
    this.gpan     = GRAN_DEFAULTS.gpan;
    this.gpattern = GRAN_DEFAULTS.gpattern;
    this.gsync    = GRAN_DEFAULTS.gsync;
    this.grate    = GRAN_DEFAULTS.grate;
    // WAV-modal visualization state (populated during hit()).
    this.grainViz = [];   // [{ s: startT, e: endT, p: posFrac }]
    this.headViz  = null; // last note's scan params for the moving play head
    this._applyParams();
  }
  _applyParams() {
    for (const k of ["harm", "timb", "morph", "decay", "gplay", "gspeed", "gloop",
                     "gwindow", "gjitter", "gdetune", "gpan", "gpattern", "gsync", "grate"]) {
      if (this.params?.[k] != null) this.setParam(k, this.params[k]);
    }
  }
  getOutputNode() { return this.output; }
  setDestination(target) {
    try { this.output.disconnect(); } catch {}
    this.output.connect(target);
  }
  // A granular track keeps its sample across engine no-ops but rebuilds on any
  // real change, same as the sample voices.
  canInPlaceChange(newKey) { return newKey === this.key; }
  setEngine() {}
  setBuffer(buf) { this.buffer = buf; }
  setGlide() {}
  setParam(key, val) {
    if (key === "vol") { this.output.gain.value = val; return; }
    if (!this.params) this.params = {};
    this.params[key] = val;
    const v = Math.max(0, Math.min(1, Number(val) || 0));
    switch (key) {
      case "harm":  this.grainSize = 0.02 + v * 0.98; break;  // 20 ms ↔ ~1 s
      case "timb":  this.density   = 8 + v * 82;       break;  // sparse ↔ dense
      case "morph": this.pos       = v;                break;  // play position
      case "decay": this.spray     = v;                break;  // diffusion macro
      case "gspeed":  this.gspeed  = v; break;
      case "gwindow": this.gwindow = v; break;
      case "gjitter": this.gjitter = v; break;
      case "gdetune": this.gdetune = v; break;
      case "gpan":    this.gpan    = v; break;
      case "gplay":    this.gplay    = String(val); break;
      case "gloop":    this.gloop    = String(val); break;
      case "gpattern": this.gpattern = String(val); break;
      case "grate":    this.grate    = String(val); break;
      case "gsync":    this.gsync    = !!val; break;
    }
  }
  getAudioParam(key) { return key === "vol" ? this.output.gain : null; }
  // Map a fraction along the scan to a wrapped play position per the loop mode.
  _scanPos(startPos, advance, loop = this.gloop) {
    if (loop === "none") return Math.max(0, Math.min(1, startPos + advance));
    const x = startPos + advance;
    if (loop === "bidir") {
      const m = ((x % 2) + 2) % 2;            // triangle 0..1..0
      return m <= 1 ? m : 2 - m;
    }
    return ((x % 1) + 1) % 1;                  // forward wrap
  }
  // Snapshot for the WAV modal: the current play-head position, the window
  // half-width (as a 0..1 fraction), and the read positions of every grain
  // playing at `now`. Grain + head records are stamped during hit().
  vizFrame(now) {
    const t = Number.isFinite(now) ? now : this.ctx.currentTime;
    const bufDur = this.buffer?.duration || 1;
    const windowSec = Math.min((this.gwindow + this.spray * 0.5) * 2.0, bufDur * 0.5);
    const windowFrac = windowSec / bufDur;
    let head = this.pos;
    const h = this.headViz;
    if (h && h.moving && t <= h.until) {
      head = this._scanPos(h.startPos, (h.speed * (t - h.t0)) / bufDur, h.loop);
    }
    const grains = [];
    const keep = [];
    for (const g of this.grainViz) {
      if (g.e < t) continue;                  // expired → drop
      keep.push(g);
      if (g.s <= t) grains.push(g.p);
    }
    if (keep.length !== this.grainViz.length) this.grainViz = keep;
    return { head, windowFrac, grains };
  }
  hit(midiNote, time, duration, velocity = 1, opts = null) {
    if (!this.buffer) return;
    const bufDur = this.buffer.duration;
    if (!(bufDur > 0)) return;
    // Pitch relative to opts.pitchBase (60 = C4 plays the sample at natural rate).
    const pitchBase = Number.isFinite(opts?.pitchBase) ? opts.pitchBase : 60;
    const baseRate = Math.pow(2, (midiNote - pitchBase) / 12);
    const t0 = Math.max(time, this.ctx.currentTime + 0.005);
    const noteDur = Math.max(0.05, duration);
    const attackT = 0.01, releaseT = 0.15;
    const span = noteDur + releaseT;
    const gs = this.grainSize;

    // Grain trigger interval: tempo-locked division when synced, else density.
    let interval;
    if (this.gsync) {
      const bpm = (typeof Tone !== "undefined" && Tone.Transport?.bpm?.value) || 120;
      const beats = GRAN_RATE_BEATS[this.grate] ?? 0.25;
      interval = Math.max(0.01, beats * (60 / bpm));
    } else {
      interval = 1 / this.density;
    }

    // spray (decay macro) boosts window / detune / jitter together.
    const spray = this.spray;
    const windowSec = Math.min((this.gwindow + spray * 0.5) * 2.0, bufDur * 0.5);
    const jitterAmt = Math.min(1, this.gjitter + spray * 0.4);
    const detuneCents = this.gdetune * 100 + spray * 50;
    const moving = this.gplay === "moving";
    const speed = this.gspeed * 2;            // 0..200%

    // Sum overlapping grains toward unity rather than clipping.
    const overlap = Math.max(1, (1 / interval) * gs);
    const grainAmp = (0.9 / Math.sqrt(overlap)) * Math.max(0.05, Math.min(1, velocity));
    const n = Math.min(200, Math.ceil(span / interval));
    // Stamp the play-head scan for the WAV modal (moving head sweeps over `span`).
    this.headViz = { t0, startPos: this.pos, speed, moving, loop: this.gloop, until: t0 + span };
    for (let i = 0; i < n; i++) {
      const dt = i * interval + (Math.random() - 0.5) * interval * jitterAmt * 2;
      if (dt < 0) continue;
      const env = envAt(dt, noteDur, attackT, releaseT);
      if (env < 0.02) continue;
      // Play-head center: fixed at `pos`, or scanning while moving.
      const center = moving ? this._scanPos(this.pos, (speed * dt) / bufDur) : this.pos;
      const winJit = (Math.random() * 2 - 1) * (windowSec / bufDur);
      const posFrac = ((center + winJit) % 1 + 1) % 1;
      // Per-grain pitch: random detune + optional octave/fifth pattern jump.
      const cents = (Math.random() * 2 - 1) * detuneCents;
      let semis = 0;
      if (this.gpattern === "oct")   semis = (Math.floor(Math.random() * 3) - 1) * 12;
      else if (this.gpattern === "fifth") semis = (Math.floor(Math.random() * 3) - 1) * 7;
      const rate = baseRate * Math.pow(2, semis / 12 + cents / 1200);
      const pan = (Math.random() * 2 - 1) * this.gpan;
      this._scheduleGrain(t0 + dt, posFrac * bufDur, gs, rate, grainAmp * env, pan);
      this.grainViz.push({ s: t0 + dt, e: t0 + dt + gs, p: posFrac });
    }
    // Bound the viz log so long held notes don't grow it without limit.
    if (this.grainViz.length > 600) this.grainViz.splice(0, this.grainViz.length - 600);
  }
  _scheduleGrain(startT, offset, gs, rate, amp, pan) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    src.playbackRate.value = rate;
    // clamp so the grain doesn't read past the buffer end
    const consumed = gs * rate;
    const off = Math.max(0, Math.min(offset, this.buffer.duration - consumed - 0.001));
    const g = this.ctx.createGain();
    const half = gs * 0.5;
    g.gain.setValueAtTime(0.0001, startT);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, amp), startT + half);
    g.gain.exponentialRampToValueAtTime(0.0001, startT + gs);
    let tail = g;
    if (pan) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      g.connect(p);
      tail = p;
      src._pan = p;
    }
    src.connect(g);
    tail.connect(this.output);
    src.onended = () => {
      try { src.disconnect(); } catch {}
      try { g.disconnect(); } catch {}
      try { src._pan?.disconnect(); } catch {}
      this.active.delete(src);
    };
    try { src.start(startT, off); } catch { return; }
    src.stop(startT + gs + 0.02);
    this.active.add(src);
  }
  silence(now) {
    const at = Math.max(this.ctx.currentTime, Number(now) || this.ctx.currentTime);
    for (const s of this.active) { try { s.stop(at); } catch {} }
  }
  dispose() {
    this.silence(this.ctx.currentTime);
    try { this.output.disconnect(); } catch {}
  }
}

// ---- wavetable voice ----------------------------------------------------
// A wavetable oscillator built from single-cycle AKWF waveforms (CC0, bundled
// in public/wavetables/akwf/). Each note loops one cycle at the pitched rate
// (loop frequency = 1 / cycleDuration), so the "wave" param scans a palette of
// timbres from clean basic shapes to instrument models. Per-voice lowpass
// ("warm") and 2-osc unison detune ("detune") round it out; standard amp env
// on "decay". Cycles load once and cache by URL (shared across all voices).
// Param map: harm → wave (table position), timb → warm, morph → detune,
// decay → amp decay/release.
export const WAVETABLE_WAVES = [
  { name: "bw_sin", label: "sine" }, { name: "bw_tri", label: "tri" },
  { name: "bw_sawrounded", label: "saw soft" }, { name: "bw_saw", label: "saw" },
  { name: "bw_sawbright", label: "saw bright" }, { name: "bw_squrounded", label: "squ soft" },
  { name: "bw_squ", label: "square" }, { name: "eorgan", label: "organ" },
  { name: "epiano", label: "e.piano" }, { name: "piano", label: "piano" },
  { name: "cello", label: "cello" }, { name: "violin", label: "violin" },
  { name: "flute", label: "flute" }, { name: "oboe", label: "oboe" },
  { name: "clarinett", label: "clarinet" }, { name: "altosax", label: "sax" },
  { name: "ebass", label: "e.bass" }, { name: "eguitar", label: "e.guitar" },
  { name: "theremin", label: "theremin" }, { name: "fmsynth", label: "fm" },
  { name: "overtone", label: "overtone" }, { name: "distorted", label: "distort" },
  { name: "oscchip", label: "chip" }, { name: "vgame", label: "vgame" },
];
let _wtBuffers = null;
let _wtLoading = null;
function loadWavetable(ctx) {
  if (_wtBuffers) return Promise.resolve(_wtBuffers);
  if (_wtLoading) return _wtLoading;
  _wtLoading = Promise.all(
    WAVETABLE_WAVES.map(w => loadBuffer(ctx, `/wavetables/akwf/${w.name}.wav`).catch(() => null))
  ).then(bufs => { _wtBuffers = bufs; return bufs; });
  return _wtLoading;
}

export class WavetableVoice {
  constructor(ctx, key, params) {
    this.ctx = ctx;
    this.type = "wavetable";
    this.poly = true;
    this.key = key;
    this.output = ctx.createGain();
    this.output.gain.value = params.vol ?? 0.8;
    this.output.connect(ctx.destination);
    this.active = new Set();
    this.params = { ...params };
    this.wavePos = 0;     // 0..1 index into the table (harm)
    this.warm = 0.7;      // lowpass amount (timb)
    this.detune = 0;      // unison detune (morph)
    this.ampDecay = 0.3;  // (unused directly; kept for parity)
    this.ampRelease = 0.3;
    this.buffers = null;
    loadWavetable(ctx).then(b => { this.buffers = b; }).catch(e => console.warn("wavetable load", e));
    this._applyParams();
  }
  _applyParams() {
    for (const k of ["harm", "timb", "morph", "decay"]) {
      if (this.params?.[k] != null) this.setParam(k, this.params[k]);
    }
  }
  getOutputNode() { return this.output; }
  setDestination(target) {
    try { this.output.disconnect(); } catch {}
    this.output.connect(target);
  }
  canInPlaceChange(newKey) { return newKey === this.key; }
  setEngine() {}
  setGlide() {}
  setParam(key, val) {
    if (key === "vol") { this.output.gain.value = val; return; }
    if (!this.params) this.params = {};
    this.params[key] = val;
    const v = Math.max(0, Math.min(1, Number(val) || 0));
    if (key === "harm")       this.wavePos = v;
    else if (key === "timb")  this.warm = v;
    else if (key === "morph") this.detune = v;
    else if (key === "decay") { this.ampDecay = 0.03 + v * 1.2; this.ampRelease = 0.05 + v * 1.5; }
  }
  getAudioParam(key) { return key === "vol" ? this.output.gain : null; }
  hit(midiNote, time, duration, velocity = 1) {
    if (!this.buffers || !this.buffers.length) return;
    const idx = Math.min(this.buffers.length - 1, Math.max(0, Math.round(this.wavePos * (this.buffers.length - 1))));
    const buf = this.buffers[idx];
    if (!buf || !(buf.duration > 0)) return;
    const loopFreq = 1 / buf.duration;                       // Hz the raw cycle loops at
    const targetFreq = Tone.Frequency(midiNote, "midi").toFrequency();
    const rate = targetFreq / loopFreq;
    const t0 = Math.max(time, this.ctx.currentTime + 0.002);
    const noteDur = Math.max(0.03, duration);
    const peak = Math.max(0.0001, Math.min(1, velocity)) * 0.5;
    const atk = 0.005;
    const amp = this.ctx.createGain();
    amp.gain.setValueAtTime(0.0001, t0);
    amp.gain.exponentialRampToValueAtTime(peak, t0 + atk);
    const relStart = Math.max(t0 + atk, t0 + noteDur);
    amp.gain.setValueAtTime(peak, relStart);
    amp.gain.exponentialRampToValueAtTime(0.0001, relStart + this.ampRelease);
    // Per-voice lowpass for "warm" (independent of the track filter).
    let tail = amp, filt = null;
    if (this.warm < 0.99) {
      filt = this.ctx.createBiquadFilter();
      filt.type = "lowpass";
      filt.frequency.value = 200 * Math.pow(2, this.warm * 7);   // ~200Hz..25kHz
      filt.Q.value = 0.3;
      amp.connect(filt);
      tail = filt;
    }
    tail.connect(this.output);
    const stopAt = relStart + this.ampRelease + 0.02;
    const detCents = this.detune * this.detune * 30;             // up to ±30 cents
    const voicesN = this.detune > 0.01 ? 2 : 1;
    const srcs = [];
    for (let u = 0; u < voicesN; u++) {
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.loopStart = 0;
      src.loopEnd = buf.duration;
      src.playbackRate.value = rate;
      if (voicesN === 2) src.detune.value = u === 0 ? -detCents : detCents;
      src.connect(amp);
      src.start(t0);
      src.stop(stopAt);
      srcs.push(src);
    }
    const rec = { srcs };
    srcs[0].onended = () => {
      for (const s of srcs) { try { s.disconnect(); } catch {} }
      try { amp.disconnect(); } catch {}
      try { filt && filt.disconnect(); } catch {}
      this.active.delete(rec);
    };
    this.active.add(rec);
  }
  silence(now) {
    const at = Math.max(this.ctx.currentTime, Number(now) || this.ctx.currentTime);
    for (const rec of this.active) { for (const s of rec.srcs) { try { s.stop(at); } catch {} } }
  }
  dispose() {
    this.silence(this.ctx.currentTime);
    try { this.output.disconnect(); } catch {}
  }
}

export class MidiVoice {
  constructor(ctx, key, params) {
    this.ctx = ctx;
    this.type = "midi";
    this.poly = true;
    this.key = key;
    this.output = null;
    this.channel = 0;
    this.pending = [];
  }
  canInPlaceChange() { return true; }
  setEngine() {}
  setParam() {}
  getAudioParam() { return null; }
  getOutputNode() { return null; }
  setDestination() {}
  setOutput(out) { this.output = out; }
  setChannel(ch) { this.channel = Math.max(0, Math.min(15, (ch | 0) - 1)); }
  _audioTimeToPerf(time) {
    return performance.now() + (time - this.ctx.currentTime) * 1000;
  }
  hit(midiNote, time, duration, velocity = 1) {
    if (!this.output) return;
    // MIDI is integer-noted; microtonal pitches round to the nearest semitone here.
    // Real microtonal MIDI output would need per-note pitch-bend or MPE.
    const n = Math.max(0, Math.min(127, Math.round(midiNote)));
    const v = Math.max(1, Math.min(127, Math.round(velocity * 127)));
    const onMs = this._audioTimeToPerf(time);
    const offMs = this._audioTimeToPerf(time + Math.max(0.02, duration - 0.01));
    try {
      this.output.send([0x90 | this.channel, n, v], onMs);
      this.output.send([0x80 | this.channel, n, 0], offMs);
    } catch (e) { console.warn("midi send", e); }
  }
  // Held-note support for the computer keyboard: real MIDI note-on / note-off.
  noteOn(midiNote, time, velocity = 1) {
    if (!this.output) return;
    const n = Math.max(0, Math.min(127, Math.round(midiNote)));
    const v = Math.max(1, Math.min(127, Math.round(velocity * 127)));
    try { this.output.send([0x90 | this.channel, n, v], this._audioTimeToPerf(time)); } catch (e) { console.warn("midi noteOn", e); }
  }
  noteOff(midiNote, time) {
    if (!this.output) return;
    const n = Math.max(0, Math.min(127, Math.round(midiNote)));
    try { this.output.send([0x80 | this.channel, n, 0], this._audioTimeToPerf(time)); } catch (e) { console.warn("midi noteOff", e); }
  }
  silence() {
    if (!this.output) return;
    try { this.output.send([0xB0 | this.channel, 123, 0]); } catch {}
  }
  dispose() { this.silence(); }
}

/**
 * Construct the runtime voice for an engine key. Dispatches on engine type
 * (plaits / drum-synth / sample / custom / eleven / upload / midi).
 * @param {AudioContext} ctx
 * @param {string} key         Engine key, the source of truth.
 * @param {TrackParams} params
 * @param {Track} track
 * @returns {Voice}
 */
export function buildVoiceForEngine(ctx, key, params, track) {
  const e = engineByKey(key);
  if (!e) throw new Error("no such engine: " + key);
  switch (e.type) {
    case "plaits":     return new PlaitsVoice(ctx, key, params);
    case "drum-synth": return new DrumSynthVoice(ctx, key, params);
    case "sampler":    return new SamplerVoice(ctx, key, params, track);
    case "midi":       return new MidiVoice(ctx, key, params);
    case "custom":     return new CustomToneVoice(ctx, key, params, track?.customConfig ?? null);
    case "saved":      return new CustomToneVoice(ctx, key, params, e.config);
    case "granular":   return new GranularVoice(ctx, key, params, track);
    case "wavetable":  return new WavetableVoice(ctx, key, params);
  }
  throw new Error("unknown engine type: " + e.type);
}

// ---- LFOs ---------------------------------------------------------------

