// MorphageneNode — main-thread wrapper around the morphagene-processor
// AudioWorklet. Mirrors the FXRack shape (input/output gains + apply* setters +
// dispose) so it splices into the master bus like any other processor.
//
// Signal: input -> dryGain -> output
//         input -> worklet -> wetGain -> output
// (SOS feedback lives inside the worklet, so there is no Web Audio feedback
// cycle here — avoids the classic runaway/latency of a graph loop.)

import { FXRack, defaultFxConfig } from "./fxRack.js";

const WORKLET_URL = "/js/morphagene-worklet.js";
const MAX_SECONDS = 12;
const SMOOTH = 0.02;   // param dezipper time constant (s)

/** @type {WeakMap<BaseAudioContext, Promise<void>>} */
const _modulePromises = new WeakMap();

/**
 * Load (once per context) the worklet module. Memoized so repeated ensureAudio
 * calls don't re-add.
 * @param {BaseAudioContext} ctx
 * @returns {Promise<void>}
 */
export function loadMorphageneModule(ctx) {
  let p = _modulePromises.get(ctx);
  if (!p) {
    p = ctx.audioWorklet.addModule(WORKLET_URL);
    _modulePromises.set(ctx, p);
  }
  return p;
}

/** Default control settings — a clean 1/1 whole-splice loop when Mix is raised. */
export function defaultMorphageneConfig() {
  return {
    variSpeed: 1,   // 0 = STOP, +1 = original speed, negative = reverse
    organize: 0,    // splice / scan position
    geneSize: 0,    // 0 = whole splice, 1 = tiny grains
    slide: 0,       // play-start offset within the splice
    morph: 0.2,     // 0 gaps -> 0.2 seamless -> 1 dense cloud + detuned genes
    sos: 0,         // overdub feedback
    mix: 0,         // wet/dry (master insert)
    frozen: false,  // stop live capture, hold the reel
    splices: 1,     // 1..16
    sync: false,    // lock the recording/reel length to the transport tempo
    div: 4,         // synced record length in beats (4 = 1 bar, 1 = 1/4, 0.25 = 1/16)
  };
}

export class MorphageneNode {
  /**
   * @param {BaseAudioContext} ctx
   * @param {ReturnType<typeof defaultMorphageneConfig>} config
   * @param {object} [fxConfig] shape of defaultFxConfig() — a full FXRack on the wet path
   */
  constructor(ctx, config, fxConfig) {
    this.ctx = ctx;
    this.config = config || defaultMorphageneConfig();
    this.filled = 0;           // last reported reel-fill fraction (0..1)
    this.recording = true;

    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.dryGain = ctx.createGain();
    this.wetGain = ctx.createGain();

    this.node = new AudioWorkletNode(ctx, "morphagene-processor", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions: { maxSeconds: MAX_SECONDS },
    });

    // A full FXRack processes only the granular (wet) signal, before wet/dry.
    this.fxRack = new FXRack(ctx, fxConfig || defaultFxConfig());
    try { this.fxRack.output.disconnect(); } catch {}  // undo its default ctx.destination hookup

    this.input.connect(this.dryGain).connect(this.output);
    this.input.connect(this.node);
    // wet path: worklet -> fx rack -> wet gain -> output
    this.node.connect(this.fxRack.input);
    this.fxRack.output.connect(this.wetGain).connect(this.output);

    this.node.port.onmessage = (e) => {
      const d = e.data;
      if (d && d.type === "status") {
        this.filled = d.filled;
        this.recording = d.recording;
        this.onStatus?.(d);
      }
    };

    this.applyAll(this.config);
  }

  _ramp(name, v) {
    const p = this.node.parameters.get(name);
    if (p) p.setTargetAtTime(v, this.ctx.currentTime, SMOOTH);
  }

  setVariSpeed(v) { this._ramp("variSpeed", v); }
  setOrganize(v)  { this._ramp("organize", v); }
  setGeneSize(v)  { this._ramp("geneSize", v); }
  setSlide(v)     { this._ramp("slide", v); }
  setMorph(v)     { this._ramp("morph", v); }
  setSos(v)       { this._ramp("sos", Math.min(v, 0.98)); }

  setMix(v) {
    const t = this.ctx.currentTime;
    this.wetGain.gain.setTargetAtTime(v, t, SMOOTH);
    this.dryGain.gain.setTargetAtTime(1 - v, t, SMOOTH);
  }

  setFreeze(b)     { this.config.frozen = !!b; this.node.port.postMessage({ type: "freeze", value: !!b }); }
  captureStart()   { this.node.port.postMessage({ type: "captureStart" }); }
  captureStop()    { this.node.port.postMessage({ type: "captureStop" }); }
  setSplices(n)    { const v = Math.max(1, Math.min(16, n | 0)); this.config.splices = v; this.node.port.postMessage({ type: "splices", value: v }); }
  /** Tempo-locked reel/record length in seconds; 0 disables sync (free ring buffer). */
  setLoopLen(seconds) { this.node.port.postMessage({ type: "loopLen", value: seconds > 0 ? seconds : 0 }); }
  resetReel()      { this.node.port.postMessage({ type: "reset" }); }

  /**
   * Schedule a param ramp at a specific audio time (step automation). `name` is
   * a worklet param name (variSpeed/organize/geneSize/slide/morph/sos) or "mix".
   */
  automate(name, v, time, dur) {
    if (name === "mix") {
      this._rampParam(this.wetGain.gain, v, time, dur);
      this._rampParam(this.dryGain.gain, 1 - v, time, dur);
      return;
    }
    this._rampParam(this.node.parameters.get(name), v, time, dur);
  }

  _rampParam(p, v, time, dur) {
    if (!p) return;
    try {
      p.cancelScheduledValues(time);
      p.setValueAtTime(p.value, time);
      p.linearRampToValueAtTime(v, time + Math.max(0.005, dur));
    } catch { try { p.value = v; } catch {} }
  }

  applyAll(c) {
    this.setVariSpeed(c.variSpeed ?? 1);
    this.setOrganize(c.organize ?? 0);
    this.setGeneSize(c.geneSize ?? 0);
    this.setSlide(c.slide ?? 0);
    this.setMorph(c.morph ?? 0.2);
    this.setSos(c.sos ?? 0);
    this.setMix(c.mix ?? 0);
    this.setSplices(c.splices ?? 1);
    // `frozen` is intentionally NOT auto-applied here — a session loads with an
    // empty reel, so honoring a saved freeze would produce silence. The panel
    // wiring pushes freeze explicitly on user action.
  }

  dispose() {
    try { this.fxRack?.dispose(); } catch {}
    for (const n of [this.node, this.input, this.output, this.dryGain, this.wetGain]) {
      try { n.disconnect(); } catch {}
    }
    try { this.node.port.onmessage = null; } catch {}
  }
}
