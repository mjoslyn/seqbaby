import { SHAPER_MODES, makeCassetteSatCurve, makeFuzzCurve, makeShaperCurve, makeTapeHissBuffer, makeVinylCrackleBuffer, shaperPreampGain } from "./curves.js";
import { buildCrusherNode } from "./crusher.js";
import { fxStageLevel } from "./constants.js";
import { currentBpm } from "./lfo.js";
import { setParam } from "./params.js";

export function defaultFxConfig() {
  return {
    // Rack input drive + output level. 0.5 = unity on both.
    amp:        { preamp: 0.5, level: 0.5 },
    vinyl:      { amount: 0, warmth: 0.4, wow: 0.3 },
    cassette:   { amount: 0, flutter: 0.3, sat: 0.4 },
    fuzz:       { amount: 0, drive: 0.7, tone: 0.4, level: 0.5 },
    ringmod:    { wet: 0, freq: 0.35 },           // freq is 0..1, log-mapped to ~20..3000 Hz
    shaper:     { wet: 0, preamp: 0.5, amount: 0.5, mode: "fold" },  // wave shaper: wet/dry + input preamp + curve drive + mode
    crush:      { bits: 8, rate: 1, wet: 0 },   // rate is the converter clock, 0..1 log-mapped to 250Hz..48kHz; 1 = no decimation
    autowah:    { wet: 0, sens: 0.5, range: 0.5 },
    chorus:     { wet: 0, rate: 0.5, depth: 0.5 },
    phaser:     { wet: 0, rate: 0.3, depth: 0.5 },
    flanger:    { wet: 0, rate: 0.3, fbk: 0.5 },
    pitchshift: { wet: 0, semitones: 0 },
    delay:      { time: 0.375, fbk: 0.35, wet: 0, sync: false, div: 0.5 },
    reverb:     { decay: 2, wet: 0 },
  };
}

// Minimum gap between two impulse-response renders on one rack (see
// FXRack._requestReverb). Four a second is far more often than a tail length
// can be heard to change, and far fewer than a lane or an LFO would ask for.
const REVERB_REGEN_MS = 400;
// ...and only one render in flight for the whole app: six racks each
// rendering their own eight-second tail at once, throttled or not, still
// measured as 180ms frames. Each rack's regeneration waits its turn.
let reverbRegenChain = Promise.resolve();
// ...with a breath between renders, so the main thread paints between them.
const REVERB_GLOBAL_GAP_MS = 120;

// LFO mod keys (see lfo.js getModTarget) → the FX stage they touch. Used to
// keep a stage engaged (see FXRack chain rewiring) while an LFO targets it,
// even when its stored wet is 0 — the LFO signal adds on top of that base.
export const FX_LFO_STAGE = {
  vinyl: "vinyl", vinyl_warmth: "vinyl", vinyl_wow: "vinyl",
  cassette: "cassette", cassette_flutter: "cassette", cassette_sat: "cassette",
  fuzz: "fuzz", fuzz_drive: "fuzz", fuzz_tone: "fuzz", fuzz_level: "fuzz",
  ringmod: "ringmod", ring_freq: "ringmod",
  shaper: "shaper", shaper_preamp: "shaper", shaper_amt: "shaper",
  crush: "crush", crush_bits: "crush", crush_rate: "crush",
  autowah: "autowah", autowah_sens: "autowah", autowah_range: "autowah",
  chorus: "chorus", chorus_rate: "chorus", chorus_depth: "chorus",
  phaser: "phaser", phaser_rate: "phaser", phaser_depth: "phaser",
  flanger: "flanger", flanger_rate: "flanger", flanger_fbk: "flanger",
  pitch: "pitchshift", pitch_semi: "pitchshift",
  delay: "delay", delay_time: "delay", delay_fbk: "delay",
  verb: "reverb", reverb_decay: "reverb",
};

// Tone wrappers don't accept a native connect() — unwrap to the node underneath.
const nativeInputOf = (node) => node?.input?.input ?? node?.input ?? node;

/**
 * Map a 0..1 amp knob to a gain multiplier: 0.5 is unity, the lower half fades
 * toward silence-ish and the upper half is exponential up to `top`, so the top
 * of the range reads as drive rather than a sudden jump.
 */
function ampGain(v, top) {
  const x = Math.max(0, Math.min(1, Number(v) || 0));
  return x <= 0.5 ? x * 2 : Math.pow(top, (x - 0.5) / 0.5);
}

// Base delay of the wow / flutter lines. The dry path is delayed to match (see
// the constructor), so the wet/dry mix stays phase-aligned.
const VINYL_WOW_BASE = 0.005;
const CASSETTE_FLUTTER_BASE = 0.003;

// SP-404 "vinyl sim" crackle bed: base hiss with sparse impulsive crackles sprinkled in.
export class FXRack {
  constructor(ctx, config, opts) {
    this.ctx = ctx;
    this.config = config;
    // Make sure legacy configs (pre-SP-404 fx) don't crash.
    if (!config.amp)        config.amp        = { preamp: 0.5, level: 0.5 };
    if (!config.vinyl)      config.vinyl      = { amount: 0, warmth: 0.4, wow: 0.3 };
    if (!config.cassette)   config.cassette   = { amount: 0, flutter: 0.3, sat: 0.4 };
    if (!config.chorus)     config.chorus     = { wet: 0, rate: 0.5, depth: 0.5 };
    if (!config.crush)      config.crush      = { bits: 8, rate: 1, wet: 0 };
    // A song written before the converter clock existed was quantise-only, so it
    // loads with the clock off — it sounds exactly as it did.
    if (config.crush.rate == null) config.crush.rate = 1;
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
    this.vinylWowDelay.delayTime.value = VINYL_WOW_BASE;
    this.vinylWowLFO = new Tone.LFO({ frequency: 0.45, min: 0.003, max: 0.007, type: "sine" }).start();
    this.vinylWowLFO.connect(this.vinylWowDelay.delayTime);
    // The wet path runs through the wow delay, so the dry path gets the same base
    // delay to keep the two time-aligned. Summing a 5 ms-delayed copy with the
    // original is a comb filter — that hollow, phasey tone the mix knob used to
    // sweep through, worst at 50/50. Aligned, the mix just blends tone + warble.
    this.vinylDryDelay = ctx.createDelay(0.05);
    this.vinylDryDelay.delayTime.value = VINYL_WOW_BASE;
    // crackle noise bed (level scales with vinyl amount)
    this.vinylNoiseSrc = ctx.createBufferSource();
    this.vinylNoiseSrc.buffer = makeVinylCrackleBuffer(ctx, 4);
    this.vinylNoiseSrc.loop = true;
    this.vinylNoiseGain = ctx.createGain();
    this.vinylNoiseGain.gain.value = 0;
    // The bed is a looping source, so left to itself it plays whether or not
    // the track does: audible before the first play, after a keyboard note
    // reopens the master bus, and on a muted track while the transport runs.
    // This gate (see setNoiseBedActive) is what ties it to the track playing.
    // A separate node from vinylNoiseGain because the automation lanes ramp
    // that one's gain directly for the level.
    this.vinylNoiseGate = ctx.createGain();
    this.vinylNoiseGate.gain.value = 0;
    this.vinylLP.connect(this.vinylWowDelay);
    this.vinylWowDelay.connect(this.vinylWetBus);
    this.vinylNoiseSrc.connect(this.vinylNoiseGain);
    this.vinylNoiseGain.connect(this.vinylNoiseGate);
    this.vinylNoiseGate.connect(this.vinylSum);
    this.vinylDryBus.connect(this.vinylDryDelay);
    this.vinylDryDelay.connect(this.vinylSum);
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
    this.cassetteFlutter.delayTime.value = CASSETTE_FLUTTER_BASE;
    // Same time-alignment as vinyl above — the dry path matches the flutter line's
    // base delay so the wet/dry mix doesn't comb.
    this.cassetteDryDelay = ctx.createDelay(0.03);
    this.cassetteDryDelay.delayTime.value = CASSETTE_FLUTTER_BASE;
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
    // Gated like the vinyl crackle (setNoiseBedActive): a looping hiss that
    // played whenever the master bus was open, playing or not.
    this.cassetteHissGate = ctx.createGain();
    this.cassetteHissGate.gain.value = 0;
    this.cassetteHP.connect(this.cassetteFlutter);
    this.cassetteFlutter.connect(this.cassetteSat);
    this.cassetteSat.connect(this.cassetteLP);
    this.cassetteLP.connect(this.cassetteWetBus);
    this.cassetteHissSrc.connect(this.cassetteHissGain);
    this.cassetteHissGain.connect(this.cassetteHissGate);
    this.cassetteHissGate.connect(this.cassetteSum);
    this.cassetteDryBus.connect(this.cassetteDryDelay);
    this.cassetteDryDelay.connect(this.cassetteSum);
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
    this.shaperPreamp.connect(this.shaperNode);
    this.shaperNode.connect(this.shaperPost);
    this.shaperPost.connect(this.shaperWetBus);
    this.shaperDryBus.connect(this.shaperSum);
    this.shaperWetBus.connect(this.shaperSum);
    this.shaperDryBus.gain.value = 1 - (config.shaper.wet ?? 0);
    this.shaperWetBus.gain.value = config.shaper.wet ?? 0;

    // ── bitcrush (crusher.js): a lo-fi converter — a sample-and-hold clock and
    //    a quantiser that clips at full scale. Parallel wet/dry like the rack's
    //    other nonlinear stages, so the crossfade is ours rather than a Tone
    //    effect's and the wet gain is a plain AudioParam an LFO can reach. ──
    this.crushDryBus = ctx.createGain();
    this.crushWetBus = ctx.createGain();
    this.crushSum    = ctx.createGain();
    this.crushIn     = ctx.createGain();
    this.crushNode   = buildCrusherNode(ctx);
    if (this.crushNode) {
      this.crushBitsParam = this.crushNode.parameters.get("bits");
      this.crushRateParam = this.crushNode.parameters.get("rate");
      this.crushIn.connect(this.crushNode);
      this.crushNode.connect(this.crushWetBus);
    } else {
      // Worklet registration failed (the whole engine's worklets would be down
      // with it). Tone's crusher quantises and nothing else — no converter
      // clock — which is exactly what this stage used to be, so the track keeps
      // an effect instead of going quiet.
      this.crusherFallback = new Tone.BitCrusher({
        bits: Math.max(1, Math.min(16, config.crush?.bits ?? 8)),
        wet: 1,
      });
      this.crushBitsParam = this.crusherFallback.bits;
      this.crushRateParam = null;
      this.crushIn.connect(nativeInputOf(this.crusherFallback));
      this.crusherFallback.connect(this.crushWetBus);
    }
    this.crushDryBus.connect(this.crushSum);
    this.crushWetBus.connect(this.crushSum);
    // The knobs themselves are installed by applyCrush at the end of the
    // constructor, with everything else.

    // ── Tone stages: autowah → chorus → phaser → flanger → pitchshift → delay → reverb ──
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
    // The impulse response the convolver holds, the one asked for since, and
    // the regeneration in flight — see _requestReverb.
    this._reverbHave = config.reverb.decay;
    this._reverbWant = null;
    this._reverbBusy = false;
    this._reverbTimer = null;
    this._reverbLast = 0;
    this.reverb.generate().catch(() => {});

    this.output = ctx.createGain();
    // The end of the serial chain lands here, and this is what softSwitch
    // ducks around a graph edit (see there). Its own node so the duck never
    // touches the amp level on `output`, which is a knob and a mod target.
    this.switchGain = ctx.createGain();
    this.switchGain.connect(this.output);
    // Native GainNode.connect() in Tone.js 15 rejects Tone wrappers — unwrap to
    // the underlying native input node before connecting from a native source.
    const toneIn = (node) => node.input?.input ?? node.input ?? node;

    // ── dynamic serial chain with per-stage bypass ──
    // Every stage's DSP (convolver reverb, granular pitch shift, worklet
    // crusher, noise beds, LFO-modulated delays) runs even at wet 0 — the
    // wet control is a crossfade after the effect, not a bypass. Thirteen
    // always-on stages per track starve the render thread on mobile. So the
    // serial chain only wires in engaged stages; a bypassed stage is
    // unreachable from the destination and the browser skips it entirely.
    // A stage engages when its wet/amount goes above 0 or an LFO holds it
    // (opts.isStageHeld); it disengages a few seconds after both stop being
    // true — the debounce rides out per-step automation flapping.
    this._stages = [
      { key: "vinyl",      ins: [this.vinylDryBus, this.vinylLP],       out: this.vinylSum },
      { key: "cassette",   ins: [this.cassetteDryBus, this.cassetteHP], out: this.cassetteSum },
      { key: "fuzz",       ins: [this.dryBus, this.fuzzDrive],          out: this.postFuzz },
      { key: "ringmod",    ins: [this.ringDry, this.ringMult],          out: this.ringSum },
      { key: "shaper",     ins: [this.shaperDryBus, this.shaperPreamp], out: this.shaperSum },
      { key: "crush",      ins: [this.crushDryBus, this.crushIn],       out: this.crushSum },
      { key: "autowah",    ins: [toneIn(this.autowah)],                 out: this.autowah },
      { key: "chorus",     ins: [toneIn(this.chorus)],                  out: this.chorus },
      { key: "phaser",     ins: [toneIn(this.phaser)],                  out: this.phaser },
      { key: "flanger",    ins: [this.flangerIn],                       out: this.flangerSum },
      { key: "pitchshift", ins: [toneIn(this.pitchshift)],              out: this.pitchshift },
      { key: "delay",      ins: [toneIn(this.delay)],                   out: this.delay },
      { key: "reverb",     ins: [toneIn(this.reverb)],                  out: this.reverb },
    ];
    this._isStageHeld = opts?.isStageHeld ?? null;
    this._active = {};
    this._bypassTimers = {};
    for (const s of this._stages) {
      this._active[s.key] = this._stageLevel(s.key) > 0 || !!this._isStageHeld?.(s.key);
    }
    this._rewire();
    this.output.connect(ctx.destination);

    this.applyAmp(config.amp);
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
    this.applyCrush(config.crush);
  }

  // The wet/amount level that decides whether a stage needs to be in the chain.
  _stageLevel(key) {
    return fxStageLevel(this.config, key);
  }

  // Rebuild the serial chain from only the engaged stages. Chain edges are the
  // ONLY outgoing connections of this.input and each stage's out node, so a
  // blanket disconnect() is safe — stage-internal wiring is untouched.
  // this.output is never disconnected here (master bus + meter tap live on it).
  _rewire() {
    try { this.input.disconnect(); } catch {}
    for (const s of this._stages) { try { s.out.disconnect(); } catch {} }
    let prev = this.input;
    for (const s of this._stages) {
      if (!this._active[s.key]) continue;
      for (const dest of s.ins) { try { prev.connect(dest); } catch {} }
      prev = s.out;
    }
    try { prev.connect(this.switchGain); } catch {}
  }

  /**
   * Run a graph edit (a stage wired in or out, the output re-pointed) under a
   * short fade instead of on a live signal. A disconnect takes effect at the
   * next render quantum whatever the signal is doing, so engaging a stage by
   * turning its wet knob off zero, or the bypass timer dropping one 2.5s later
   * in the middle of a bar, was a step — small, but on every such edit.
   * Two ramps and a timer: 4ms down, the edit once the fade has landed, 6ms
   * back up. Edits asked for while one is pending join it.
   * @param {() => void} fn
   */
  softSwitch(fn) {
    if (this._disposed) return;
    (this._softQueue || (this._softQueue = [])).push(fn);
    if (this._softTimer) return;
    const ctx = this.ctx, g = this.switchGain.gain;
    const now = ctx.currentTime;
    try {
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(0, now + 0.004);
    } catch {}
    this._softTimer = setTimeout(() => {
      this._softTimer = null;
      const q = this._softQueue || [];
      this._softQueue = null;
      for (const f of q) { try { f(); } catch (e) { console.warn("fx rack switch failed", e); } }
      const t1 = ctx.currentTime + 0.003;
      try {
        g.cancelScheduledValues(t1);
        g.setValueAtTime(0, t1);
        g.linearRampToValueAtTime(1, t1 + 0.006);
      } catch {}
    }, 8);
  }

  _updateStage(key) {
    const want = this._stageLevel(key) > 0 || !!this._isStageHeld?.(key);
    if (want) {
      if (this._bypassTimers[key]) { clearTimeout(this._bypassTimers[key]); delete this._bypassTimers[key]; }
      if (!this._active[key]) { this._active[key] = true; this.softSwitch(() => this._rewire()); }
      return;
    }
    if (!this._active[key] || this._bypassTimers[key]) return;
    this._bypassTimers[key] = setTimeout(() => {
      delete this._bypassTimers[key];
      const still = this._stageLevel(key) > 0 || !!this._isStageHeld?.(key);
      if (!still && this._active[key]) { this._active[key] = false; this.softSwitch(() => this._rewire()); }
    }, 2500);
  }

  // Re-evaluate every stage's engagement. Poked by lfo.js whenever an LFO is
  // (de)configured — a stage targeted by an LFO must stay wired at wet 0.
  refreshStageActivity() {
    for (const s of this._stages) this._updateStage(s.key);
  }

  /**
   * Rack preamp + output level. The rack's own input/output gains double as the
   * amp — no extra nodes and nothing to bypass, and because the preamp sits ahead
   * of every stage it drives the whole chain (fuzz, shaper, cassette sat and the
   * compressor all respond to it), while level trims what comes back out.
   * Both knobs are 0..1 with 0.5 = unity.
   */
  applyAmp({ preamp, level }) {
    const c = this.config.amp || (this.config.amp = { preamp: 0.5, level: 0.5 });
    if (preamp !== undefined) c.preamp = preamp;
    if (level  !== undefined) c.level = level;
    this.input.gain.value  = ampGain(c.preamp ?? 0.5, 8);    // 0.25x .. 8x  (-12..+18 dB)
    this.output.gain.value = ampGain(c.level ?? 0.5, 2);     // silent .. 2x (   ..+6 dB)
  }

  // Both tape/vinyl stages scale their *character* with amount, not just the
  // wet/dry mix: at 10% you want a hint of a worn record, not 10% of a destroyed
  // one. So the tone rolls off from clean, the warble opens up from none, and the
  // noise bed — by far the most obtrusive part — follows amount squared.
  applyVinyl({ amount, warmth, wow }) {
    const c = this.config.vinyl;
    if (amount !== undefined) c.amount = amount;
    if (warmth !== undefined) c.warmth = warmth;
    if (wow    !== undefined) c.wow = wow;
    const a = Math.max(0, Math.min(1, c.amount ?? 0));
    this.vinylDryBus.gain.value = 1 - a;
    this.vinylWetBus.gain.value = a;
    // warmth 0 → 9 kHz (bright), warmth 1 → 1.8 kHz (dull), reached at amount 1
    const warmTarget = 9000 - (c.warmth ?? 0.4) * 7200;
    this.vinylLP.frequency.value = 18000 - a * (18000 - warmTarget);
    const span = (0.0008 + (c.wow ?? 0.3) * 0.006) * a;   // up to ±6.8 ms
    this.vinylWowLFO.min = VINYL_WOW_BASE - span;
    this.vinylWowLFO.max = VINYL_WOW_BASE + span;
    this.vinylNoiseGain.gain.value = a * a * 0.12;
    this._updateStage("vinyl");
  }

  /**
   * Open or close the noise beds — the vinyl crackle and the cassette hiss.
   * The levels are applyVinyl's / applyCassette's business (and the automation
   * lanes'); this only says whether the track is playing, which signal.js's
   * refreshNoiseBeds decides from the transport and the track's mute / solo
   * state. Short ramp so a bed fades rather than clicks.
   * @param {boolean} on
   */
  setNoiseBedActive(on) {
    const want = on ? 1 : 0;
    if (this._noiseBedOn === want) return;
    this._noiseBedOn = want;
    const now = this.ctx.currentTime;
    for (const g of [this.vinylNoiseGate.gain, this.cassetteHissGate.gain]) {
      try {
        g.cancelScheduledValues(now);
        g.setValueAtTime(g.value, now);
        g.linearRampToValueAtTime(want, now + 0.02);
      } catch { g.value = want; }
    }
  }

  applyCassette({ amount, flutter, sat }) {
    const c = this.config.cassette;
    if (amount  !== undefined) c.amount = amount;
    if (flutter !== undefined) c.flutter = flutter;
    if (sat     !== undefined) c.sat = sat;
    const a = Math.max(0, Math.min(1, c.amount ?? 0));
    this.cassetteDryBus.gain.value = 1 - a;
    this.cassetteWetBus.gain.value = a;
    // Tape bandwidth closes in as the amount rises (full range → 60 Hz / 9.5 kHz).
    this.cassetteHP.frequency.value = 20 + a * 40;
    this.cassetteLP.frequency.value = 18000 - a * (18000 - 9500);
    const span = (0.0004 + (c.flutter ?? 0.3) * 0.004) * a;
    this.cassetteFlutterLFO.min = CASSETTE_FLUTTER_BASE - span;
    this.cassetteFlutterLFO.max = CASSETTE_FLUTTER_BASE + span;
    this.cassetteSat.curve = makeCassetteSatCurve((c.sat ?? 0.4) * a);
    this.cassetteHissGain.gain.value = a * a * 0.09;
    this._updateStage("cassette");
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
    this._updateStage("chorus");
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
    this._updateStage("ringmod");
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
    this._updateStage("shaper");
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
    this._updateStage("autowah");
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
    this._updateStage("phaser");
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
    this._updateStage("flanger");
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
    this._updateStage("pitchshift");
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
    this._updateStage("fuzz");
  }
  applyCrush({ bits, rate, wet }) {
    if (!this.config.crush) this.config.crush = { bits: 8, rate: 1, wet: 0 };
    if (bits !== undefined) {
      const b = Math.max(1, Math.min(16, Math.round(bits)));
      this.config.crush.bits = b;
      try { this.crushBitsParam.value = b; } catch { try { this.crusherFallback?.set({ bits: b }); } catch {} }
    }
    if (rate !== undefined && Number.isFinite(Number(rate))) {
      const r = Math.max(0, Math.min(1, Number(rate)));
      this.config.crush.rate = r;
      // Null on the fallback, which has no converter clock to set.
      try { if (this.crushRateParam) this.crushRateParam.value = r; } catch {}
    }
    if (wet !== undefined && Number.isFinite(Number(wet))) {
      const w = Math.max(0, Math.min(1, Number(wet)));
      this.config.crush.wet = w;
      this.crushWetBus.gain.value = w;
      this.crushDryBus.gain.value = 1 - w;
    }
    this._updateStage("crush");
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
    this._updateStage("delay");
  }
  applyReverb({ decay, wet }) {
    if (decay !== undefined) {
      this.config.reverb.decay = decay;
      this._requestReverb(decay);
    }
    if (wet !== undefined) { this.config.reverb.wet = wet; this.reverb.wet.value = wet; }
    this._updateStage("reverb");
  }

  /**
   * A modulated decay (LFO or automation lane) — changes the impulse response
   * without touching the stored knob, so the slider stays the base.
   */
  setReverbDecayLive(decay) { this._requestReverb(decay); }

  // A convolution reverb's decay IS its impulse response, and Tone.Reverb
  // regenerates that by rendering `decay` seconds of noise through an
  // OfflineAudioContext — a multi-megabyte buffer plus the convolver's FFT
  // partitioning every time. Reached from a lane every step and from a setter
  // LFO every frame, that was six racks each re-rendering an eight-second IR
  // several times a second: measured, it took the transport callback from
  // ~1ms to ~16ms and the main thread to 180ms frames. So it is throttled here:
  // one regeneration in flight per rack, at most one every REVERB_REGEN_MS,
  // always the LATEST value asked for, and skipped altogether when the change
  // is below what a tail length can be heard to differ by. Never synchronous
  // from the caller either — the transport callback is the caller.
  _requestReverb(decay) {
    if (this._disposed) return;
    this._reverbWant = decay;
    if (this._reverbTimer || this._reverbBusy) return;
    const since = performance.now() - this._reverbLast;
    const wait = Math.max(0, REVERB_REGEN_MS - since);
    this._reverbTimer = setTimeout(() => { this._reverbTimer = null; this._regenReverb(); }, wait);
  }
  async _regenReverb() {
    const want = this._reverbWant;
    this._reverbWant = null;
    if (want == null || this._disposed) return;
    const have = this._reverbHave;
    if (have != null && Math.abs(want - have) <= Math.max(0.1, have * 0.12)) return;
    this._reverbBusy = true;
    const turn = reverbRegenChain.then(async () => {
      if (this._disposed) return;
      this._reverbLast = performance.now();
      try {
        this.reverb.decay = want;
        await this.reverb.generate();
        this._reverbHave = want;
      } catch {}
    });
    reverbRegenChain = turn.catch(() => {}).then(() => new Promise(r => setTimeout(r, REVERB_GLOBAL_GAP_MS)));
    await turn;
    this._reverbBusy = false;
    // Something asked for a different tail while this one rendered.
    if (this._reverbWant != null && !this._disposed) this._requestReverb(this._reverbWant);
  }
  dispose() {
    this._disposed = true;
    if (this._reverbTimer) { try { clearTimeout(this._reverbTimer); } catch {} this._reverbTimer = null; }
    if (this._softTimer) { try { clearTimeout(this._softTimer); } catch {} this._softTimer = null; this._softQueue = null; }
    try { this.switchGain.disconnect(); } catch {}
    for (const k in this._bypassTimers) { try { clearTimeout(this._bypassTimers[k]); } catch {} }
    this._bypassTimers = {};
    try { this.input.disconnect(); } catch {}
    try { this.vinylDryBus.disconnect(); } catch {}
    try { this.vinylWetBus.disconnect(); } catch {}
    try { this.vinylLP.disconnect(); } catch {}
    try { this.vinylWowDelay.disconnect(); } catch {}
    try { this.vinylSum.disconnect(); } catch {}
    try { this.vinylNoiseSrc.stop(); } catch {}
    try { this.vinylNoiseSrc.disconnect(); } catch {}
    try { this.vinylNoiseGain.disconnect(); } catch {}
    try { this.vinylNoiseGate.disconnect(); } catch {}
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
    try { this.cassetteHissGate.disconnect(); } catch {}
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
    try { this.crushIn.disconnect(); } catch {}
    try { this.crushNode?.port.postMessage({ type: "dispose" }); } catch {}
    try { this.crushNode?.disconnect(); } catch {}
    try { this.crushDryBus.disconnect(); } catch {}
    try { this.crushWetBus.disconnect(); } catch {}
    try { this.crushSum.disconnect(); } catch {}
    try { this.crusherFallback?.dispose(); } catch {}
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

