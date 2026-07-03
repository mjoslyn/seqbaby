import { SHAPER_MODES, makeCassetteSatCurve, makeFuzzCurve, makeShaperCurve, makeTapeHissBuffer, makeVinylCrackleBuffer, shaperPreampGain } from "./curves.js";
import { currentBpm } from "./lfo.js";
import { setParam } from "./params.js";

export function defaultFxConfig() {
  return {
    vinyl:      { amount: 0, warmth: 0.4, wow: 0.3 },
    cassette:   { amount: 0, flutter: 0.3, sat: 0.4 },
    fuzz:       { amount: 0, drive: 0.7, tone: 0.4, level: 0.5 },
    ringmod:    { wet: 0, freq: 0.35 },           // freq is 0..1, log-mapped to ~20..3000 Hz
    shaper:     { wet: 0, preamp: 0.5, amount: 0.5, mode: "fold" },  // wave shaper: wet/dry + input preamp + curve drive + mode
    crush:      { bits: 8, wet: 0 },
    autowah:    { wet: 0, sens: 0.5, range: 0.5 },
    chorus:     { wet: 0, rate: 0.5, depth: 0.5 },
    phaser:     { wet: 0, rate: 0.3, depth: 0.5 },
    flanger:    { wet: 0, rate: 0.3, fbk: 0.5 },
    pitchshift: { wet: 0, semitones: 0 },
    delay:      { time: 0.375, fbk: 0.35, wet: 0, sync: false, div: 0.5 },
    reverb:     { decay: 2, wet: 0 },
  };
}

// SP-404 "vinyl sim" crackle bed: base hiss with sparse impulsive crackles sprinkled in.
export class FXRack {
  constructor(ctx, config) {
    this.ctx = ctx;
    this.config = config;
    // Make sure legacy configs (pre-SP-404 fx) don't crash.
    if (!config.vinyl)      config.vinyl      = { amount: 0, warmth: 0.4, wow: 0.3 };
    if (!config.cassette)   config.cassette   = { amount: 0, flutter: 0.3, sat: 0.4 };
    if (!config.chorus)     config.chorus     = { wet: 0, rate: 0.5, depth: 0.5 };
    if (!config.crush)      config.crush      = { bits: 8, wet: 0 };
    if (!config.ringmod)    config.ringmod    = { wet: 0, freq: 0.35 };
    if (!config.autowah)    config.autowah    = { wet: 0, sens: 0.5, range: 0.5 };
    if (!config.phaser)     config.phaser     = { wet: 0, rate: 0.3, depth: 0.5 };
    if (!config.flanger)    config.flanger    = { wet: 0, rate: 0.3, fbk: 0.5 };
    if (!config.pitchshift) config.pitchshift = { wet: 0, semitones: 0 };

    this.input = ctx.createGain();

    // ── vinyl sim stage (parallel wet/dry + crackle bed) ──
    // wet path: lowpass (warmth) → wow (LFO-modulated delay)
    this.vinylDryBus = ctx.createGain();
    this.vinylWetBus = ctx.createGain();
    this.vinylSum    = ctx.createGain();
    this.vinylLP = ctx.createBiquadFilter();
    this.vinylLP.type = "lowpass";
    this.vinylLP.Q.value = 0.7;
    this.vinylWowDelay = ctx.createDelay(0.05);
    this.vinylWowDelay.delayTime.value = 0.005;
    this.vinylWowLFO = new Tone.LFO({ frequency: 0.45, min: 0.003, max: 0.007, type: "sine" }).start();
    this.vinylWowLFO.connect(this.vinylWowDelay.delayTime);
    // crackle noise bed (level scales with vinyl amount)
    this.vinylNoiseSrc = ctx.createBufferSource();
    this.vinylNoiseSrc.buffer = makeVinylCrackleBuffer(ctx, 4);
    this.vinylNoiseSrc.loop = true;
    this.vinylNoiseGain = ctx.createGain();
    this.vinylNoiseGain.gain.value = 0;
    this.input.connect(this.vinylDryBus);
    this.input.connect(this.vinylLP);
    this.vinylLP.connect(this.vinylWowDelay);
    this.vinylWowDelay.connect(this.vinylWetBus);
    this.vinylNoiseSrc.connect(this.vinylNoiseGain);
    this.vinylNoiseGain.connect(this.vinylSum);
    this.vinylDryBus.connect(this.vinylSum);
    this.vinylWetBus.connect(this.vinylSum);
    try { this.vinylNoiseSrc.start(); } catch {}

    // ── cassette stage (parallel wet/dry + flutter + sat + hiss) ──
    this.cassetteDryBus = ctx.createGain();
    this.cassetteWetBus = ctx.createGain();
    this.cassetteSum    = ctx.createGain();
    // tape bandwidth: gentle HPF + LPF sandwich
    this.cassetteHP = ctx.createBiquadFilter();
    this.cassetteHP.type = "highpass";
    this.cassetteHP.frequency.value = 60;
    this.cassetteLP = ctx.createBiquadFilter();
    this.cassetteLP.type = "lowpass";
    this.cassetteLP.frequency.value = 9500;
    // flutter: short LFO-modulated delay
    this.cassetteFlutter = ctx.createDelay(0.03);
    this.cassetteFlutter.delayTime.value = 0.003;
    this.cassetteFlutterLFO = new Tone.LFO({ frequency: 5.2, min: 0.002, max: 0.004, type: "sine" }).start();
    this.cassetteFlutterLFO.connect(this.cassetteFlutter.delayTime);
    // saturation
    this.cassetteSat = ctx.createWaveShaper();
    this.cassetteSat.oversample = "2x";
    // hiss (gain scales with cassette amount)
    this.cassetteHissSrc = ctx.createBufferSource();
    this.cassetteHissSrc.buffer = makeTapeHissBuffer(ctx, 4);
    this.cassetteHissSrc.loop = true;
    this.cassetteHissGain = ctx.createGain();
    this.cassetteHissGain.gain.value = 0;
    this.vinylSum.connect(this.cassetteDryBus);
    this.vinylSum.connect(this.cassetteHP);
    this.cassetteHP.connect(this.cassetteFlutter);
    this.cassetteFlutter.connect(this.cassetteSat);
    this.cassetteSat.connect(this.cassetteLP);
    this.cassetteLP.connect(this.cassetteWetBus);
    this.cassetteHissSrc.connect(this.cassetteHissGain);
    this.cassetteHissGain.connect(this.cassetteSum);
    this.cassetteDryBus.connect(this.cassetteSum);
    this.cassetteWetBus.connect(this.cassetteSum);
    try { this.cassetteHissSrc.start(); } catch {}

    // ── fuzz stage (DBA-style parallel wet/dry) ──
    this.dryBus = ctx.createGain();
    this.wetBus = ctx.createGain();
    this.fuzzDrive = ctx.createGain();
    this.fuzzShaper = ctx.createWaveShaper();
    this.fuzzShaper.oversample = "4x";
    this.fuzzFilter = ctx.createBiquadFilter();
    this.fuzzFilter.type = "lowpass";
    this.fuzzFilter.Q.value = 2.2;
    this.fuzzLevel = ctx.createGain();
    this.cassetteSum.connect(this.dryBus);
    this.cassetteSum.connect(this.fuzzDrive);
    this.fuzzDrive.connect(this.fuzzShaper);
    this.fuzzShaper.connect(this.fuzzFilter);
    this.fuzzFilter.connect(this.fuzzLevel);
    this.fuzzLevel.connect(this.wetBus);
    this.postFuzz = ctx.createGain();
    this.dryBus.connect(this.postFuzz);
    this.wetBus.connect(this.postFuzz);

    // ── ring mod stage (native: carrier-modulated gain, parallel wet/dry) ──
    // Standard trick: set gain.value = 0, connect carrier osc to gain.gain → output = input * carrier.
    this.ringDry = ctx.createGain();
    this.ringWet = ctx.createGain();
    this.ringSum = ctx.createGain();
    this.ringMult = ctx.createGain();
    this.ringMult.gain.value = 0;
    this.ringCarrier = ctx.createOscillator();
    this.ringCarrier.type = "sine";
    this.ringCarrier.frequency.value = 220;
    this.ringCarrier.connect(this.ringMult.gain);
    this.postFuzz.connect(this.ringDry);
    this.postFuzz.connect(this.ringMult);
    this.ringMult.connect(this.ringWet);
    this.ringDry.connect(this.ringSum);
    this.ringWet.connect(this.ringSum);
    try { this.ringCarrier.start(); } catch {}

    // ── wave shaper (native waveshaper, parallel wet/dry crossfade) ──
    // Mode picks the nonlinearity (saturate / softclip / clip / serge / fold /
    // wrap); amount is the drive baked into the curve; preamp is a clean
    // input boost (0..1 → 0.25x..8x) BEFORE the curve, controllable
    // independently. Sits between ring mod and crusher.
    if (!config.shaper) config.shaper = { wet: 0, preamp: 0.5, amount: 0.5, mode: "fold" };
    if (!config.shaper.mode) config.shaper.mode = "fold";
    if (config.shaper.preamp == null) config.shaper.preamp = 0.5;
    this.shaperDryBus = ctx.createGain();
    this.shaperWetBus = ctx.createGain();
    this.shaperSum    = ctx.createGain();
    this.shaperPreamp = ctx.createGain();
    this.shaperPreamp.gain.value = shaperPreampGain(config.shaper.preamp);
    this.shaperNode   = ctx.createWaveShaper();
    this.shaperNode.curve = makeShaperCurve(config.shaper.mode, config.shaper.amount ?? 0.5);
    this.shaperNode.oversample = "2x";
    this.shaperPost = ctx.createGain();
    this.shaperPost.gain.value = 0.85;  // small trim — the curve outputs already clamp to ±1
    this.ringSum.connect(this.shaperDryBus);
    this.ringSum.connect(this.shaperPreamp);
    this.shaperPreamp.connect(this.shaperNode);
    this.shaperNode.connect(this.shaperPost);
    this.shaperPost.connect(this.shaperWetBus);
    this.shaperDryBus.connect(this.shaperSum);
    this.shaperWetBus.connect(this.shaperSum);
    this.shaperDryBus.gain.value = 1 - (config.shaper.wet ?? 0);
    this.shaperWetBus.gain.value = config.shaper.wet ?? 0;

    // ── Tone stages: crusher → autowah → chorus → phaser → flanger → pitchshift → delay → reverb ──
    this.crusher = new Tone.BitCrusher({
      bits: Math.max(1, Math.min(16, config.crush?.bits ?? 8)),
      wet: config.crush?.wet ?? 0,
    });
    this.autowah = new Tone.AutoWah({
      baseFrequency: 100,
      octaves: 1 + (config.autowah.range ?? 0.5) * 4,
      sensitivity: -10 - (config.autowah.sens ?? 0.5) * 30,
      Q: 2,
      gain: 2,
      wet: config.autowah.wet ?? 0,
    });
    this.chorus = new Tone.Chorus({
      frequency: 0.5 + (config.chorus.rate ?? 0.5) * 4.5,
      delayTime: 3.2,
      depth: config.chorus.depth ?? 0.5,
      feedback: 0,
      wet: config.chorus.wet ?? 0,
      spread: 180,
    }).start();
    this.phaser = new Tone.Phaser({
      frequency: 0.05 + (config.phaser.rate ?? 0.3) * 3.95,
      octaves: 1 + (config.phaser.depth ?? 0.5) * 5,
      baseFrequency: 350,
      Q: 10,
      wet: config.phaser.wet ?? 0,
    });

    // flanger: native short feedback-delay + LFO-modulated delay time
    this.flangerIn = ctx.createGain();
    this.flangerDry = ctx.createGain();
    this.flangerWet = ctx.createGain();
    this.flangerSum = ctx.createGain();
    this.flangerDelayNode = ctx.createDelay(0.02);
    this.flangerDelayNode.delayTime.value = 0.003;
    this.flangerFeedback = ctx.createGain();
    this.flangerFeedback.gain.value = 0.5;
    this.flangerLFO = new Tone.LFO({
      frequency: 0.05 + (config.flanger.rate ?? 0.3) * 3.95,
      min: 0.0005,
      max: 0.005,
      type: "sine",
    }).start();
    this.flangerLFO.connect(this.flangerDelayNode.delayTime);
    this.flangerIn.connect(this.flangerDry);
    this.flangerIn.connect(this.flangerDelayNode);
    this.flangerDelayNode.connect(this.flangerFeedback);
    this.flangerFeedback.connect(this.flangerDelayNode);
    this.flangerDelayNode.connect(this.flangerWet);
    this.flangerDry.connect(this.flangerSum);
    this.flangerWet.connect(this.flangerSum);

    this.pitchshift = new Tone.PitchShift({
      pitch: config.pitchshift.semitones ?? 0,
      windowSize: 0.1,
      delayTime: 0,
      feedback: 0,
      wet: config.pitchshift.wet ?? 0,
    });

    this.delay = new Tone.FeedbackDelay({
      delayTime: config.delay.time,
      feedback: config.delay.fbk,
      wet: config.delay.wet,
      maxDelay: 2,
    });
    this.reverb = new Tone.Reverb({ decay: config.reverb.decay, wet: config.reverb.wet, preDelay: 0.02 });
    this.reverb.generate().catch(() => {});

    this.output = ctx.createGain();
    // Native GainNode.connect() in Tone.js 15 rejects Tone wrappers — unwrap to
    // the underlying native input node before connecting from a native source.
    const toneIn = (node) => node.input?.input ?? node.input ?? node;
    this.shaperSum.connect(toneIn(this.crusher));
    this.crusher.connect(this.autowah);
    this.autowah.connect(this.chorus);
    this.chorus.connect(this.phaser);
    this.phaser.connect(this.flangerIn);
    this.flangerSum.connect(toneIn(this.pitchshift));
    this.pitchshift.connect(this.delay);
    this.delay.connect(this.reverb);
    this.reverb.connect(this.output);
    this.output.connect(ctx.destination);

    this.applyVinyl(config.vinyl);
    this.applyCassette(config.cassette);
    this.applyFuzz(config.fuzz);
    this.applyRingMod(config.ringmod);
    this.applyWaveShaper(config.shaper);
    this.applyAutoWah(config.autowah);
    this.applyChorus(config.chorus);
    this.applyPhaser(config.phaser);
    this.applyFlanger(config.flanger);
    this.applyPitchShift(config.pitchshift);
  }

  applyVinyl({ amount, warmth, wow }) {
    if (amount !== undefined) {
      this.config.vinyl.amount = amount;
      this.vinylDryBus.gain.value = 1 - amount;
      this.vinylWetBus.gain.value = amount;
      this.vinylNoiseGain.gain.value = amount * 0.45;
    }
    if (warmth !== undefined) {
      this.config.vinyl.warmth = warmth;
      // warmth 0 → 9 kHz (bright), warmth 1 → 1.8 kHz (dull)
      this.vinylLP.frequency.value = 9000 - warmth * 7200;
    }
    if (wow !== undefined) {
      this.config.vinyl.wow = wow;
      const base = 0.005;
      const span = 0.0008 + wow * 0.006; // up to ±6 ms
      this.vinylWowLFO.min = base - span;
      this.vinylWowLFO.max = base + span;
    }
  }

  applyCassette({ amount, flutter, sat }) {
    if (amount !== undefined) {
      this.config.cassette.amount = amount;
      this.cassetteDryBus.gain.value = 1 - amount;
      this.cassetteWetBus.gain.value = amount;
      this.cassetteHissGain.gain.value = amount * 0.18;
    }
    if (flutter !== undefined) {
      this.config.cassette.flutter = flutter;
      const base = 0.003;
      const span = 0.0004 + flutter * 0.004;
      this.cassetteFlutterLFO.min = base - span;
      this.cassetteFlutterLFO.max = base + span;
    }
    if (sat !== undefined) {
      this.config.cassette.sat = sat;
      this.cassetteSat.curve = makeCassetteSatCurve(sat);
    }
  }

  applyChorus({ wet, rate, depth }) {
    if (wet !== undefined) {
      this.config.chorus.wet = wet;
      try { this.chorus.wet.value = wet; } catch {}
    }
    if (rate !== undefined) {
      this.config.chorus.rate = rate;
      try { this.chorus.frequency.value = 0.1 + rate * 4.9; } catch {}
    }
    if (depth !== undefined) {
      this.config.chorus.depth = depth;
      try { this.chorus.depth = depth; } catch {}
    }
  }

  applyRingMod({ wet, freq }) {
    if (wet !== undefined) {
      this.config.ringmod.wet = wet;
      this.ringDry.gain.value = 1 - wet;
      this.ringWet.gain.value = wet;
    }
    if (freq !== undefined) {
      this.config.ringmod.freq = freq;
      // log map slider 0..1 → 20..3000 Hz
      const hz = 20 * Math.pow(150, Math.max(0, Math.min(1, freq)));
      try { this.ringCarrier.frequency.value = hz; } catch {}
    }
  }

  applyWaveShaper({ wet, preamp, amount, mode }) {
    if (!this.config.shaper) this.config.shaper = { wet: 0, preamp: 0.5, amount: 0.5, mode: "fold" };
    if (wet !== undefined) {
      this.config.shaper.wet = wet;
      this.shaperDryBus.gain.value = 1 - wet;
      this.shaperWetBus.gain.value = wet;
    }
    if (preamp !== undefined) {
      this.config.shaper.preamp = preamp;
      try { this.shaperPreamp.gain.value = shaperPreampGain(preamp); } catch {}
    }
    if (amount !== undefined) this.config.shaper.amount = amount;
    if (mode !== undefined && SHAPER_MODES.includes(mode)) this.config.shaper.mode = mode;
    if (amount !== undefined || mode !== undefined) {
      try {
        this.shaperNode.curve = makeShaperCurve(this.config.shaper.mode, this.config.shaper.amount);
      } catch {}
    }
  }

  applyAutoWah({ wet, sens, range }) {
    if (wet !== undefined) {
      this.config.autowah.wet = wet;
      try { this.autowah.wet.value = wet; } catch {}
    }
    if (sens !== undefined) {
      this.config.autowah.sens = sens;
      // higher slider = more sensitive (more negative dB threshold)
      try { this.autowah.sensitivity = -10 - sens * 30; } catch {}
    }
    if (range !== undefined) {
      this.config.autowah.range = range;
      try { this.autowah.octaves = 1 + range * 4; } catch {}
    }
  }

  applyPhaser({ wet, rate, depth }) {
    if (wet !== undefined) {
      this.config.phaser.wet = wet;
      try { this.phaser.wet.value = wet; } catch {}
    }
    if (rate !== undefined) {
      this.config.phaser.rate = rate;
      try { this.phaser.frequency.value = 0.05 + rate * 3.95; } catch {}
    }
    if (depth !== undefined) {
      this.config.phaser.depth = depth;
      try { this.phaser.octaves = 1 + depth * 5; } catch {}
    }
  }

  applyFlanger({ wet, rate, fbk }) {
    if (wet !== undefined) {
      this.config.flanger.wet = wet;
      this.flangerDry.gain.value = 1 - wet;
      this.flangerWet.gain.value = wet;
    }
    if (rate !== undefined) {
      this.config.flanger.rate = rate;
      try { this.flangerLFO.frequency.value = 0.05 + rate * 3.95; } catch {}
    }
    if (fbk !== undefined) {
      this.config.flanger.fbk = fbk;
      this.flangerFeedback.gain.value = Math.max(0, Math.min(0.9, fbk * 0.9));
    }
  }

  applyPitchShift({ wet, semitones }) {
    if (wet !== undefined) {
      this.config.pitchshift.wet = wet;
      try { this.pitchshift.wet.value = wet; } catch {}
    }
    if (semitones !== undefined) {
      this.config.pitchshift.semitones = semitones;
      try { this.pitchshift.pitch = semitones; } catch {}
    }
  }

  applyFuzz({ amount, drive, tone, level }) {
    if (amount !== undefined) {
      this.config.fuzz.amount = amount;
      this.dryBus.gain.value = 1 - amount;
      this.wetBus.gain.value = amount;
    }
    if (drive !== undefined) {
      this.config.fuzz.drive = drive;
      this.fuzzDrive.gain.value = 1 + drive * 30;
      this.fuzzShaper.curve = makeFuzzCurve(drive);
    }
    if (tone !== undefined) {
      this.config.fuzz.tone = tone;
      this.fuzzFilter.frequency.value = 200 + tone * 7800;
    }
    if (level !== undefined) {
      this.config.fuzz.level = level;
      this.fuzzLevel.gain.value = level * 0.9;
    }
  }
  applyCrush({ bits, wet }) {
    if (!this.config.crush) this.config.crush = { bits: 8, wet: 0 };
    if (bits !== undefined) {
      const b = Math.max(1, Math.min(16, Math.round(bits)));
      this.config.crush.bits = b;
      try { this.crusher.bits.value = b; } catch { try { this.crusher.set({ bits: b }); } catch {} }
    }
    if (wet !== undefined) {
      this.config.crush.wet = wet;
      try { this.crusher.wet.value = wet; } catch {}
    }
  }
  applyDelay({ time, fbk, wet, sync, div }) {
    if (sync !== undefined) this.config.delay.sync = sync;
    if (div !== undefined) this.config.delay.div = div;
    if (time !== undefined && !this.config.delay.sync) this.config.delay.time = time;
    if (fbk !== undefined)  { this.config.delay.fbk = fbk; this.delay.feedback.value = fbk; }
    if (wet !== undefined)  { this.config.delay.wet = wet; this.delay.wet.value = wet; }
    // recompute effective delay time
    const secPerBeat = 60 / currentBpm();
    const eff = this.config.delay.sync
      ? secPerBeat * this.config.delay.div
      : this.config.delay.time;
    this.delay.delayTime.value = Math.max(0.02, Math.min(2, eff));
  }
  applyReverb({ decay, wet }) {
    if (decay !== undefined) {
      this.config.reverb.decay = decay;
      this.reverb.decay = decay;
      this.reverb.generate().catch(() => {});
    }
    if (wet !== undefined) { this.config.reverb.wet = wet; this.reverb.wet.value = wet; }
  }
  dispose() {
    try { this.input.disconnect(); } catch {}
    try { this.vinylDryBus.disconnect(); } catch {}
    try { this.vinylWetBus.disconnect(); } catch {}
    try { this.vinylLP.disconnect(); } catch {}
    try { this.vinylWowDelay.disconnect(); } catch {}
    try { this.vinylSum.disconnect(); } catch {}
    try { this.vinylNoiseSrc.stop(); } catch {}
    try { this.vinylNoiseSrc.disconnect(); } catch {}
    try { this.vinylNoiseGain.disconnect(); } catch {}
    try { this.vinylWowLFO.stop(); } catch {}
    try { this.vinylWowLFO.dispose(); } catch {}
    try { this.cassetteDryBus.disconnect(); } catch {}
    try { this.cassetteWetBus.disconnect(); } catch {}
    try { this.cassetteHP.disconnect(); } catch {}
    try { this.cassetteFlutter.disconnect(); } catch {}
    try { this.cassetteSat.disconnect(); } catch {}
    try { this.cassetteLP.disconnect(); } catch {}
    try { this.cassetteSum.disconnect(); } catch {}
    try { this.cassetteHissSrc.stop(); } catch {}
    try { this.cassetteHissSrc.disconnect(); } catch {}
    try { this.cassetteHissGain.disconnect(); } catch {}
    try { this.cassetteFlutterLFO.stop(); } catch {}
    try { this.cassetteFlutterLFO.dispose(); } catch {}
    try { this.dryBus.disconnect(); } catch {}
    try { this.wetBus.disconnect(); } catch {}
    try { this.fuzzDrive.disconnect(); } catch {}
    try { this.fuzzShaper.disconnect(); } catch {}
    try { this.fuzzFilter.disconnect(); } catch {}
    try { this.fuzzLevel.disconnect(); } catch {}
    try { this.postFuzz.disconnect(); } catch {}
    try { this.ringDry.disconnect(); } catch {}
    try { this.ringWet.disconnect(); } catch {}
    try { this.ringMult.disconnect(); } catch {}
    try { this.ringSum.disconnect(); } catch {}
    try { this.ringCarrier.stop(); } catch {}
    try { this.ringCarrier.disconnect(); } catch {}
    try { this.shaperDryBus.disconnect(); } catch {}
    try { this.shaperWetBus.disconnect(); } catch {}
    try { this.shaperSum.disconnect(); } catch {}
    try { this.shaperPreamp.disconnect(); } catch {}
    try { this.shaperNode.disconnect(); } catch {}
    try { this.shaperPost.disconnect(); } catch {}
    try { this.flangerIn.disconnect(); } catch {}
    try { this.flangerDry.disconnect(); } catch {}
    try { this.flangerWet.disconnect(); } catch {}
    try { this.flangerDelayNode.disconnect(); } catch {}
    try { this.flangerFeedback.disconnect(); } catch {}
    try { this.flangerSum.disconnect(); } catch {}
    try { this.flangerLFO.stop(); } catch {}
    try { this.flangerLFO.dispose(); } catch {}
    try { this.output.disconnect(); } catch {}
    try { this.autowah.dispose(); } catch {}
    try { this.chorus.dispose(); } catch {}
    try { this.phaser.dispose(); } catch {}
    try { this.pitchshift.dispose(); } catch {}
    try { this.delay.dispose(); } catch {}
    try { this.reverb.dispose(); } catch {}
    try { this.crusher.dispose(); } catch {}
  }
}

// ---- voices -------------------------------------------------------------

// Voice interface:
//   type: "plaits" | "drum-synth" | "sample" | "midi"
//   poly: bool — whether to trigger all chord tones
//   hit(midiNote, time, duration, velocity)
//   setParam(key, val)        // vol/harm/timb/morph/decay
//   getAudioParam(key)        // for LFO modulation, may return null
//   setEngine(engineKey)      // in-place if possible, else caller recreates
//   canInPlaceChange(newKey)  // can swap to this key without rebuild
//   silence(now)              // stop any currently-sounding note
//   dispose()

