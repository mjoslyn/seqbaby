import { applyAutomationAtStep, canAutomate } from "./automation.js";
import { engineByKey } from "./catalog.js";
import { clearEuclidLive, euclidFromUnit, euclidToUnit, euclideanRhythm, setEuclidLive, trackEuclid } from "./euclid.js";
import { LFO_AMP_SCALE, LFO_KEYS } from "./constants.js";
import { makeCassetteSatCurve, makeShaperCurve } from "./curves.js";
import { setParam } from "./params.js";
import { aliasPattern, state } from "./state.js";
import { GRAN_DEFAULTS, granFromUnit, granToUnit } from "./voices.js";


/** @typedef {import("./types.js").Track} Track */
export function defaultLFOConfig() {
  const cfg = {};
  for (const k of LFO_KEYS) {
    cfg[k] = { enabled: false, type: "sine", rate: 1.0, depth: 0.5, sync: true, div: 1 };
  }
  return cfg;
}

export function currentBpm() { return Number(document.getElementById("bpm").value || 120); }

/** Default wave-scan config for the wavetable synth (see WavetableVoice.setScan). */
export function defaultWavetableScan() {
  return { enabled: false, rate: 0.5, sync: true, div: 1, dir: "up", start: 0, range: 1, retrig: false };
}

/** Push a track's wavetable wave-scan config down to its voice (resolving bpm-sync to Hz). */
export function applyWavetableScan(t) {
  if (t.voice?.type !== "wavetable" || typeof t.voice.setScan !== "function") return;
  const cfg = t.wavetable?.scan;
  if (!cfg?.enabled) { t.voice.setScan(null, 0); return; }
  const hz = cfg.sync ? rateFromSync(cfg.div) : cfg.rate;
  t.voice.setScan(cfg, hz);
}

// Vertical pointer-drag on the BPM number input. Mobile number inputs have no
// spinner and tapping pops the numeric keypad — drag-to-scrub gives a way to
// nudge tempo without typing. A drag past PX_THRESH engages scrub mode and
// suppresses focus/keyboard; an un-dragged tap focuses the input as normal.
export function attachBpmDrag(el) {
  if (!el) return;
  const PX_PER_BPM = 4;
  const PX_THRESH = 6;
  let drag = null;
  el.style.touchAction = "none";
  el.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const min = Number(el.min) || 40;
    const max = Number(el.max) || 240;
    drag = {
      id: e.pointerId, type: e.pointerType,
      startY: e.clientY, startVal: Number(el.value) || 120,
      min, max, moved: false,
    };
    // Touch: block default focus so the keyboard doesn't pop while scrubbing.
    // We restore focus on pointerup if no drag happened.
    if (e.pointerType !== "mouse") e.preventDefault();
  });
  el.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dy = e.clientY - drag.startY;
    if (!drag.moved) {
      if (Math.abs(dy) < PX_THRESH) return;
      drag.moved = true;
      try { el.setPointerCapture(e.pointerId); } catch {}
      if (document.activeElement === el) el.blur();
    }
    const next = Math.max(drag.min, Math.min(drag.max, drag.startVal + Math.round(-dy / PX_PER_BPM)));
    if (Number(el.value) !== next) {
      el.value = String(next);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
    e.preventDefault();
  });
  const end = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    try { el.releasePointerCapture(e.pointerId); } catch {}
    // Tap-without-drag on touch: we suppressed the default focus, so restore it
    // so the user can still tap-to-type a BPM value.
    if (!drag.moved && drag.type !== "mouse") {
      el.focus();
      try { el.select(); } catch {}
    }
    drag = null;
  };
  el.addEventListener("pointerup", end);
  el.addEventListener("pointercancel", end);
}

// Compute the base playback rate for a sample buffer so its natural length fits the
// selected bar-count at the current BPM. Returns 1 for "native" (no time-sync).
export function computeSampleBaseRate(buffer, mode, bpm) {
  if (!buffer || mode === "native" || !mode) return 1;
  const barSec = (60 / bpm) * 4;  // one 4/4 bar at BPM
  const targets = { "2xbpm": 0.5, "1xbpm": 1, "1/2bpm": 2, "1/4bpm": 4 };
  const bars = targets[mode];
  if (!bars) return 1;
  return buffer.duration / (bars * barSec);
}

// Per-hit correction so the TRIMMED slice fits the selected bars, not the full
// buffer. baseRate is computed from the full buffer duration; if a step only
// plays 25% of the buffer, the slice would otherwise finish in 25% of a bar.
// Multiplying the rate by the slice span makes the slice fill the bar.
// Returns 1 when mode is "native" (no time-sync) or when the whole buffer plays.
export function sliceFitFactor(opts) {
  const mode = opts?.sampleSpeedMode;
  if (!mode || mode === "native") return 1;
  const start = Math.max(0, Math.min(1, opts?.startOffset ?? 0));
  const end   = Math.max(0, Math.min(1, opts?.endOffset ?? 1));
  const span = Math.max(0.001, end - start);
  return span;
}

// Playback rate for one hit of a bpm-fittable sample voice (upload / eleven).
// `fit` is the bar-fit rate (baseRate × slice span) — it's 1 in "native" mode
// and stretches the loop to the selected bars in a bpm mode. When pitch-lock is
// on, timing wins: the fit rate is used verbatim and per-note pitch is ignored,
// so the sample stays on the grid (and at natural pitch) whatever note the step
// plays. When off, the note transposes the sample on top of the fit rate.
export function sampleHitRate(baseRate, midiNote, opts) {
  const fit = (baseRate || 1) * sliceFitFactor(opts);
  if (opts?.pitchLocked) return fit;
  const pitchBase = Number.isFinite(opts?.pitchBase) ? opts.pitchBase : 60;
  return fit * Math.pow(2, (midiNote - pitchBase) / 12);
}

export function applySampleSpeed(t) {
  const type = t.voice?.type;
  if (type !== "sampler") return;
  const buf = t.voice.buffer;
  const rate = computeSampleBaseRate(buf, t.sampleSpeedMode, currentBpm());
  if (t.voice.setBaseRate) t.voice.setBaseRate(rate);
}
export function rateFromSync(divBeats) { return currentBpm() / 60 / divBeats; }
export function effectiveRate(cfg) { return cfg.sync ? rateFromSync(cfg.div) : cfg.rate; }

/**
 * Resolve the AudioParam / Tone.Signal an LFO key modulates for a track.
 * @param {Track} t @param {string} key @returns {(AudioParam|{value:number}|null)}
 */
export function getModTarget(t, key) {
  if (["vol","harm","timb","morph","decay","osc1","osc2","osc3","osc4","ultra","fm","noise"].includes(key)) {
    return t.voice?.getAudioParam(key) ?? null;
  }
  // 303 accent + tune: AudioParams on the worklet node, under their own keys
  // (the generic list above only covers the shared slider names).
  if (key === "tb303_accent") return t.voice?.getAudioParam?.("accent303") ?? null;
  if (key === "tb303_tune")   return t.voice?.getAudioParam?.("tune303") ?? null;
  // Virus panel controls: AudioParams on its worklet node, under their own keys.
  // The saturation AMOUNT is `vsatamt` on the voice (`vsat` is the curve select
  // next to it, which isn't a param at all), so that one key needs translating.
  if (key.startsWith("virus_")) {
    const which = key.slice(6);
    return t.voice?.getAudioParam?.("v" + (which === "sat" ? "satamt" : which)) ?? null;
  }
  // DX7: every panel control is an AudioParam on its worklet node, and the key
  // spells the param — dx7_3lvl is operator 3's level, d3lvl on the voice.
  if (key.startsWith("dx7_")) return t.voice?.getAudioParam?.("d" + key.slice(4)) ?? null;
  // Electric guitar: same shape — gtr_bass is the amp's bass control, gtbass on
  // the voice, and an AudioParam on its worklet node.
  if (key.startsWith("gtr_")) return t.voice?.getAudioParam?.("gt" + key.slice(4)) ?? null;
  if (key.startsWith("bas_")) return t.voice?.getAudioParam?.("bs" + key.slice(4)) ?? null;
  if (key === "cutoff") return t.filterNode?.frequency ?? null;
  if (key === "reson")  return t.filterNode?.Q ?? null;
  const rack = t.fxRack;
  if (!rack) return null;
  // FX wet/amt targets (LFO adds on top of dry — crossfade fx still get movement).
  switch (key) {
    case "fuzz":         return rack.wetBus?.gain ?? null;
    case "delay":        return rack.delay?.wet ?? null;
    case "verb":         return rack.reverb?.wet ?? null;
    case "vinyl":        return rack.vinylWetBus?.gain ?? null;
    case "cassette":     return rack.cassetteWetBus?.gain ?? null;
    case "ringmod":      return rack.ringWet?.gain ?? null;
    case "shaper":       return rack.shaperWetBus?.gain ?? null;
    case "shaper_preamp":return rack.shaperPreamp?.gain ?? null;
    case "crush":        return rack.crusher?.wet ?? null;
    case "autowah":      return rack.autowah?.wet ?? null;
    case "chorus":       return rack.chorus?.wet ?? null;
    case "phaser":       return rack.phaser?.wet ?? null;
    case "flanger":      return rack.flangerWet?.gain ?? null;
    case "pitch":        return rack.pitchshift?.wet ?? null;
    // sub-params
    case "fuzz_drive":   return rack.fuzzDrive?.gain ?? null;
    case "fuzz_tone":    return rack.fuzzFilter?.frequency ?? null;
    case "fuzz_level":   return rack.fuzzLevel?.gain ?? null;
    case "vinyl_warmth": return rack.vinylLP?.frequency ?? null;
    case "ring_freq":    return rack.ringCarrier?.frequency ?? null;
    case "crush_bits":   return rack.crusher?.bits ?? null;
    case "chorus_rate":  return rack.chorus?.frequency ?? null;
    case "chorus_depth": return rack.chorus?.depth ?? null;  // may not be Signal — returns null if so
    case "phaser_rate":  return rack.phaser?.frequency ?? null;
    case "flanger_rate": return rack.flangerLFO?.frequency ?? null;
    case "flanger_fbk":  return rack.flangerFeedback?.gain ?? null;
    case "delay_time":   return rack.delay?.delayTime ?? null;
    case "delay_fbk":    return rack.delay?.feedback ?? null;
  }
  return null;
}

export const TRACK_FX_LFO_KEYS = new Set([
  "fuzz","delay","verb","vinyl","cassette","ringmod","shaper","crush","autowah","chorus","phaser","flanger","pitch",
  "fuzz_drive","fuzz_tone","fuzz_level","vinyl_warmth","shaper_preamp","ring_freq","crush_bits",
  "chorus_rate","chorus_depth","phaser_rate","flanger_rate","flanger_fbk","delay_time","delay_fbk",
  // setter-driven (non-AudioParam) FX params
  "vinyl_wow","cassette_flutter","cassette_sat",
  "shaper_amt",
  "autowah_sens","autowah_range",
  "phaser_depth","pitch_semi","reverb_decay",
]);

// FX params with no AudioParam / Signal handle — driven by a JS-side LFO that
// polls in a RAF loop and applies values through the corresponding setter.
export const SETTER_LFO_KEYS = new Set([
  "vinyl_wow","cassette_flutter","cassette_sat",
  "shaper_amt",
  "autowah_sens","autowah_range",
  "phaser_depth","chorus_depth","pitch_semi","reverb_decay",
  "wt_scan_start","wt_scan_range",
  "gran_speed","gran_pitch","gran_window","gran_jitter","gran_detune","gran_pan",
  "euclid_pulses","euclid_steps","euclid_rotate",
]);

// Granular mod keys → the track param each drives. Grains read these when they
// are scheduled, so a sequenced note takes one value per hit and a held note
// re-reads every scheduler tick.
export const GRAN_LFO_PARAM = {
  gran_speed: "gspeed", gran_pitch: "gpitch", gran_window: "gwindow",
  gran_jitter: "gjitter", gran_detune: "gdetune", gran_pan: "gpan",
};

// Read the user's current 0..1 base value for a setter LFO target so the LFO
// swings AROUND that value instead of overwriting it.
export function setterLfoBase(t, key) {
  // Euclid's counts: the knobs on the panel are the base, as 0..1 across their
  // own (track-length-dependent) range.
  if (key.startsWith("euclid_")) {
    const k = key.slice(7);
    // trackEuclid, not liveEuclid: the base has to be the stored knob, or the
    // LFO would swing around its own output.
    return euclidToUnit(t, k, trackEuclid(t)[k]);
  }
  // Wave-scan window lives on the track's wavetable config, not the fx rack.
  if (key === "wt_scan_start") return t.wavetable?.scan?.start ?? 0;
  if (key === "wt_scan_range") return t.wavetable?.scan?.range ?? 1;
  // Granular grain controls: the track's own sliders are the base, converted
  // into the 0..1 the LFO swings around.
  const granParam = GRAN_LFO_PARAM[key];
  if (granParam) return granToUnit(granParam, t.params?.[granParam] ?? GRAN_DEFAULTS[granParam]);
  const c = t.fxRack?.config;
  if (!c) return 0.5;
  switch (key) {
    case "vinyl_wow":        return c.vinyl?.wow ?? 0.3;
    case "cassette_flutter": return c.cassette?.flutter ?? 0.3;
    case "cassette_sat":     return c.cassette?.sat ?? 0.4;
    case "shaper_amt":       return c.shaper?.amount ?? 0.5;
    case "autowah_sens":     return c.autowah?.sens ?? 0.5;
    case "autowah_range":    return c.autowah?.range ?? 0.5;
    case "phaser_depth":     return c.phaser?.depth ?? 0.5;
    case "chorus_depth":     return c.chorus?.depth ?? 0.5;
    case "pitch_semi":       return (((c.pitchshift?.semitones ?? 0) + 12) / 24);
    case "reverb_decay":     return Math.max(0, Math.min(1, ((c.reverb?.decay ?? 2) - 0.2) / 7.8));
  }
  return 0.5;
}

// Apply a 0..1 LFO value to a setter-only FX target. Pokes the audio graph
// directly WITHOUT updating rack.config — the user's slider value remains the
// stored base, and the slider's onInput keeps writing config on user moves.
export function applySetterLfoValue(t, key, v) {
  v = Math.max(0, Math.min(1, v));
  // Euclid: write the live override, never the stored setting, so the knob
  // stays the base the LFO swings around. The generator reads it at step time.
  if (key.startsWith("euclid_")) {
    setEuclidLive(t, key.slice(7), euclidFromUnit(t, key.slice(7), v));
    return;
  }
  // The wave scan reads its window off the voice's own live scan object, so the
  // modulation moves the sweep without disturbing the stored slider values.
  if (key === "wt_scan_start" || key === "wt_scan_range") {
    const sc = t.voice?.scan;
    if (sc) sc[key === "wt_scan_start" ? "start" : "range"] = v;
    return;
  }
  // Granular: write the live voice only, never t.params, so the slider stays the
  // base the LFO swings around.
  const granParam = GRAN_LFO_PARAM[key];
  if (granParam) {
    try { t.voice?.setParam?.(granParam, granFromUnit(granParam, v)); } catch {}
    return;
  }
  const rack = t.fxRack;
  if (!rack) return;
  switch (key) {
    case "vinyl_wow": {
      const base = 0.005, span = 0.0008 + v * 0.006;
      try { rack.vinylWowLFO.min = base - span; rack.vinylWowLFO.max = base + span; } catch {}
      return;
    }
    case "cassette_flutter": {
      const base = 0.003, span = 0.0004 + v * 0.004;
      try { rack.cassetteFlutterLFO.min = base - span; rack.cassetteFlutterLFO.max = base + span; } catch {}
      return;
    }
    case "cassette_sat":
      try { rack.cassetteSat.curve = makeCassetteSatCurve(v); } catch {}
      return;
    case "shaper_amt":
      try {
        const mode = rack.config?.shaper?.mode ?? "fold";
        rack.shaperNode.curve = makeShaperCurve(mode, v);
      } catch {}
      return;
    case "autowah_sens":
      try { rack.autowah.sensitivity = -10 - v * 30; } catch {}
      return;
    case "autowah_range":
      try { rack.autowah.octaves = 1 + v * 4; } catch {}
      return;
    case "phaser_depth":
      try { rack.phaser.octaves = 1 + v * 5; } catch {}
      return;
    case "chorus_depth":
      try { rack.chorus.depth = v; } catch {}
      return;
    case "pitch_semi":
      // Don't round — Tone.PitchShift.pitch accepts fractional semitones, and
      // rounding eats every modulation narrower than ±0.5 semitone (which is
      // exactly the range a vibrato-style mod wants to live in).
      try { rack.pitchshift.pitch = v * 24 - 12; } catch {}
      return;
    case "reverb_decay": {
      // IR rebuild is heavy — only regenerate on perceptible change.
      const decay = 0.2 + v * 7.8;
      const cur = rack._lfoReverbDecay ?? rack.config?.reverb?.decay ?? decay;
      if (Math.abs(decay - cur) > 0.3) {
        rack._lfoReverbDecay = decay;
        try { rack.reverb.decay = decay; rack.reverb.generate().catch(() => {}); } catch {}
      }
      return;
    }
  }
}

// ---- the euclid shape ----------------------------------------------------
//
// A fifth LFO shape, and the odd one out: the other four are waveforms, this
// one is a rhythm. The ring steps at the LFO's rate — a division of 1/16 means
// one ring step per sixteenth, as on every euclidean module — so the *cycle*
// is `steps` long rather than one period of a wave. Rests sit at zero and hits
// rise to the depth, which makes it unipolar where the waveforms are bipolar:
// a tap should lift a parameter off its slider and let it fall back, not swing
// it either side.
//
// It runs on any target the mod matrix already offers, so "euclidean filter
// sweep", "euclidean reverb throw" and "euclidean rotate on a euclidean track"
// all come out of one shape entry.

/** Per-LFO euclid settings, defaulted on read. Written lazily (see
 *  `defaultLFOConfig`) so a session doesn't carry four extra numbers on each of
 *  the ~180 mod entries per track just to say "this one is a sine". */
export function lfoEuclid(cfg) {
  return {
    pulses: Math.max(0, Math.round(cfg?.epulses ?? 4)),
    steps: Math.max(1, Math.round(cfg?.esteps ?? 8)),
    rotate: Math.max(0, Math.round(cfg?.erotate ?? 0)),
    decay: Math.max(0, Math.min(1, cfg?.edecay ?? 0.4)),
  };
}

/** Cached ring for an LFO's settings — the rAF loop asks per frame per LFO. */
const _ringCache = new Map();
function lfoRing(e) {
  const key = `${e.steps}|${e.pulses}|${e.rotate}`;
  let ring = _ringCache.get(key);
  if (!ring) {
    ring = euclideanRhythm(e.steps, Math.min(e.pulses, e.steps), e.rotate);
    if (_ringCache.size > 256) _ringCache.clear();
    _ringCache.set(key, ring);
  }
  return ring;
}

/**
 * Where step 0 of the ring sits on the audio clock.
 *
 * A drifting sine is a texture; a drifting rhythm is a mistake, so a synced
 * euclid LFO hangs its ring off the moment the transport started rather than
 * free-running from whenever it was switched on. Unsynced (or stopped), it
 * runs from the context's own zero, which is stable for as long as the page is.
 */
function euclidOrigin(cfg) {
  if (cfg.sync && state.playing && state._transportStartTime != null) return state._transportStartTime;
  return 0;
}

/** How far a tap has fallen `frac` of the way through its step. */
function tapEnvelope(frac, decay) {
  if (decay <= 0.02) return 1;                    // a gate: hold for the step
  return Math.exp(-frac / Math.max(0.02, 0.6 * (1 - decay) + 0.02));
}

export function evalLfoShape(type, phase, cfg) {
  const p = phase - Math.floor(phase);
  switch (type) {
    case "sine":     return Math.sin(2 * Math.PI * p);
    case "triangle": return p < 0.5 ? (p * 4 - 1) : (3 - p * 4);
    case "sawtooth": return p * 2 - 1;
    case "square":   return p < 0.5 ? 1 : -1;
    // Unipolar 0..1: `phase` counts ring STEPS here, not wave cycles.
    case "euclid": {
      const e = lfoEuclid(cfg);
      const ring = lfoRing(e);
      const n = Math.floor(phase);
      const on = ring[((n % ring.length) + ring.length) % ring.length];
      return on ? tapEnvelope(phase - n, e.decay) : 0;
    }
  }
  return 0;
}

/** Ring steps elapsed at `now`. Absolute rather than accumulated, so the ring
 *  can't drift away from the bar over a long session. */
function euclidPhase(cfg, now) {
  const stepHz = Math.max(0.01, effectiveRate(cfg));
  return (now - euclidOrigin(cfg)) * stepHz;
}

/** How much a euclid tap lifts its target: the full depth, where a bipolar
 *  waveform gets half either side of the base. Same peak-to-peak either way. */
function euclidAmp(key, cfg) {
  return (cfg.depth ?? 0) * (LFO_AMP_SCALE[key] ?? 1);
}

// A euclid LFO on an AudioParam target is a constant source scheduled ahead,
// not a Tone.LFO: there is no oscillator type for a rhythm. The signal is
// summed onto the param exactly as the oscillator was, so the slider stays the
// base and everything downstream (disconnect, dispose, t.lfos) is unchanged.
//
// Scheduling ahead is what keeps the edges sample-accurate off a 60Hz loop —
// the same bargain the transport strikes. A tap decided this frame is placed
// at the audio time it actually belongs at.
const EUCLID_LOOKAHEAD = 0.25;

function makeEuclidGate(param) {
  const signal = new Tone.Signal(0);
  try { signal.connect(param); } catch {}
  return {
    isEuclid: true,
    signal,
    nextStep: null,
    origin: null,
    stop() { try { this.signal.cancelScheduledValues(0); } catch {} },
    disconnect() { try { this.signal.disconnect(); } catch {} },
    dispose() { try { this.signal.dispose(); } catch {} },
  };
}

/** Place every tap that starts inside the lookahead window. */
function scheduleEuclidTaps(t, key, cfg, now) {
  const g = t.lfos[key];
  if (!g?.isEuclid) return;
  const e = lfoEuclid(cfg);
  const ring = lfoRing(e);
  const stepDur = 1 / Math.max(0.01, effectiveRate(cfg));
  const origin = euclidOrigin(cfg);
  const peak = euclidAmp(key, cfg);
  // The transport starting (or stopping) moves the ring's origin under us, so
  // anything already queued against the old one has to go.
  if (g.origin !== origin) {
    g.origin = origin;
    g.nextStep = null;
    try { g.signal.cancelScheduledValues(now); } catch {}
  }
  let n = g.nextStep ?? Math.floor((now - origin) / stepDur);
  for (let guard = 0; guard < 256; guard++) {
    const at = origin + n * stepDur;
    if (at > now + EUCLID_LOOKAHEAD) break;
    if (at >= now - stepDur) {
      const on = ring[((n % ring.length) + ring.length) % ring.length];
      const when = Math.max(at, now);
      try {
        g.signal.setValueAtTime(on ? peak : 0, when);
        if (on && e.decay > 0.02) {
          g.signal.setTargetAtTime(0, when, Math.max(0.004, stepDur * 0.6 * (1 - e.decay)));
        }
      } catch {}
    }
    n++;
  }
  g.nextStep = n;
}

// One RAF loop drives every active setter LFO across every track.
export let _setterLfoRafId = null;
export function startSetterLfoLoopIfNeeded() {
  if (_setterLfoRafId != null) return;
  let lastT = (state.audioCtx?.currentTime ?? performance.now() / 1000);
  const tick = () => {
    const now = state.audioCtx?.currentTime ?? performance.now() / 1000;
    const dt = Math.max(0, Math.min(0.1, now - lastT));
    lastT = now;
    let anyActive = false;
    for (const t of state.tracks) {
      // Euclid-shaped LFOs on AudioParam targets: this loop only decides what
      // to queue — the taps themselves are placed at their exact audio times
      // (scheduleEuclidTaps), so the edges don't inherit the frame rate.
      if (t._euclidLfoKeys?.size) {
        for (const key of t._euclidLfoKeys) {
          const cfg = t.lfoConfig[key];
          if (!cfg?.enabled || cfg.type !== "euclid") continue;
          anyActive = true;
          scheduleEuclidTaps(t, key, cfg, now);
        }
      }
      // The rack gate is for the fx targets; euclid's counts are the
      // sequencer's, and run whether or not audio has been built.
      if (!t._setterLfoPhase) continue;
      const hasRack = !!t.fxRack;
      for (const key of SETTER_LFO_KEYS) {
        const cfg = t.lfoConfig[key];
        if (!cfg?.enabled) continue;
        if (!hasRack && !key.startsWith("euclid_")) continue;
        anyActive = true;
        const euclidShape = cfg.type === "euclid";
        // A rhythm is timed from the clock, not accumulated frame by frame —
        // see euclidOrigin. A waveform can keep its running phase, which is
        // what lets its rate change without a jump.
        let phase;
        if (euclidShape) {
          phase = euclidPhase(cfg, now);
        } else {
          phase = (t._setterLfoPhase[key] ?? 0) + dt * effectiveRate(cfg);
        }
        t._setterLfoPhase[key] = phase;
        const shape = evalLfoShape(cfg.type || "sine", phase, cfg);
        const base = setterLfoBase(t, key);
        // Unipolar shapes lift by the whole depth; bipolar ones swing half
        // either side of the base. Same peak-to-peak from the same slider.
        const swing = euclidShape ? (cfg.depth ?? 0) : (cfg.depth ?? 0) * 0.5;
        applySetterLfoValue(t, key, base + shape * swing);
      }
    }
    _setterLfoRafId = anyActive ? requestAnimationFrame(tick) : null;
  };
  _setterLfoRafId = requestAnimationFrame(tick);
}

// Which modulation keys make sense for the current engine? Voice-independent
// so the picker hides irrelevant entries even before audio is initialized.
/**
 * Whether an LFO key applies to this track's engine (gates the mod picker).
 * @param {Track} t @param {string} key @returns {boolean}
 */
export function canModulate(t, key) {
  // Always-applicable: track-level fx + master vol + filter.
  if (key === "vol" || key === "cutoff" || key === "reson") return true;
  if (TRACK_FX_LFO_KEYS.has(key)) return true;
  // Wave-scan window — wavetable engine only.
  if (key === "wt_scan_start" || key === "wt_scan_range") return t.engineKey === "wt:akwf";
  // Euclid's counts — any engine, but only while the generator is the thing
  // making the rhythm. Modulating them with the pattern in charge would say
  // nothing at all.
  if (key.startsWith("euclid_")) return !!t.euclid?.on;
  // Grain controls — granular engine only.
  if (key.startsWith("gran_")) return t.engineKey === "dm:granular";
  // Accent depth + tuning — 303 only.
  if (key === "tb303_accent" || key === "tb303_tune") return t.engineKey === "dm:303";
  // Virus oscillator / filter-pair controls — virus only.
  if (key.startsWith("virus_")) return t.engineKey === "dm:virus";
  // DX7 operator matrix + globals — dx7 only.
  if (key.startsWith("dx7_")) return t.engineKey === "dm:dx7";
  // The guitar rig's string / pickup / amp / cab controls — guitar only.
  if (key.startsWith("gtr_")) return t.engineKey === "dm:guitar";
  // The bass rig's right hand, dirt and amp — bass only.
  if (key.startsWith("bas_")) return t.engineKey === "dm:bass";
  const eng = engineByKey(t.engineKey);
  if (!eng) return false;
  // Plaits exposes harm/timb/morph/decay as voice params.
  if (eng.type === "plaits") return ["harm", "timb", "morph", "decay"].includes(key);
  // Emulator builders expose specific AudioParams via getAudioParam — only list
  // the keys that are actually wired (see each builder above).
  switch (t.engineKey) {
    // The 303's four panel knobs are AudioParams on its worklet node.
    case "dm:303":        return ["harm", "timb", "morph", "decay"].includes(key);
    // Real polyphony inside the worklet, so unlike the pooled emulators the
    // whole instrument follows the LFO, not just voice 0.
    case "dm:virus":      return ["harm", "timb", "morph", "decay", "osc1", "osc2", "osc3", "osc4", "noise"].includes(key);
    // Same: one node, one set of params, so the LFO moves the whole instrument.
    // The oscillator-mix sliders aren't wired — a DX7's six operators have their
    // own levels in the panel, which are reachable under their own keys.
    case "dm:dx7":        return ["harm", "timb", "morph", "decay"].includes(key);
    // Six strings and one amp in one worklet node, so the same holds here: drive
    // and tone are AudioParams the whole instrument follows.
    case "dm:guitar":     return ["harm", "timb", "morph", "decay"].includes(key);
    case "dm:bass":       return ["harm", "timb", "morph", "decay"].includes(key);
    case "dm:mini-brute": return ["harm", "osc1", "osc2", "osc3", "osc4", "ultra", "fm"].includes(key);
    case "dm:moog":       return ["harm", "osc1", "osc2", "osc3", "noise"].includes(key);
    case "dm:juno":       return ["harm", "osc1", "osc2", "osc3", "noise"].includes(key);
    case "dm:prophet6":   return ["harm", "osc1", "osc2", "osc3", "osc4", "noise"].includes(key);
    // Rhodes has no per-voice AudioParam targets beyond vol+track fx; its
    // timbre params are still automatable via setParam (see canAutomate).
  }
  return false;
}

export function syncLFO(t, key) {
  const cfg = t.lfoConfig[key];
  let lfo = t.lfos[key];

  // FX-target LFOs must keep their stage wired into the rack's chain even at
  // wet 0 (the LFO signal adds on top of the base) — re-evaluate stage bypass.
  try { t.fxRack?.refreshStageActivity?.(); } catch {}

  // ── setter-driven LFO path (FX params without an AudioParam target) ──
  if (SETTER_LFO_KEYS.has(key)) {
    if (lfo) {
      try { lfo.stop(); } catch {}
      try { lfo.disconnect(); } catch {}
      try { lfo.dispose(); } catch {}
      t.lfos[key] = null;
    }
    if (!cfg.enabled) {
      if (t._setterLfoPhase && t._setterLfoPhase[key] != null) {
        delete t._setterLfoPhase[key];
        // Euclid keeps its live overrides in a separate object rather than in
        // the audio graph, so releasing means deleting the override — writing
        // the base back would leave the control looking driven forever.
        if (key.startsWith("euclid_")) clearEuclidLive(t, key.slice(7));
        // restore base value to the audio graph so the param stops where the slider sits
        else applySetterLfoValue(t, key, setterLfoBase(t, key));   // no-ops safely without a rack
      }
      return;
    }
    if (!t._setterLfoPhase) t._setterLfoPhase = {};
    if (t._setterLfoPhase[key] == null) t._setterLfoPhase[key] = 0;
    startSetterLfoLoopIfNeeded();
    return;
  }

  if (!cfg.enabled) {
    if (lfo) {
      try { lfo.stop(); } catch {}
      try { lfo.disconnect(); } catch {}
      try { lfo.dispose(); } catch {}
      t.lfos[key] = null;
    }
    t._euclidLfoKeys?.delete(key);
    return;
  }
  if (!state.ready) return;
  const param = getModTarget(t, key);
  if (!param) return;

  // A rhythm is not an oscillator type, so the euclid shape swaps the source:
  // a scheduled constant instead of a Tone.LFO, summed onto the same param.
  // Switching shape between the two therefore means rebuilding, not retuning.
  const wantEuclid = cfg.type === "euclid";
  if (lfo && !!lfo.isEuclid !== wantEuclid) {
    try { lfo.stop(); } catch {}
    try { lfo.disconnect(); } catch {}
    try { lfo.dispose(); } catch {}
    lfo = t.lfos[key] = null;
  }
  if (wantEuclid) {
    if (!lfo) lfo = t.lfos[key] = makeEuclidGate(param);
    // Anything already queued was placed against the settings that just
    // changed — depth, rate and the ring all move the taps.
    lfo.nextStep = null;
    lfo.origin = null;
    try { lfo.signal.cancelScheduledValues(state.audioCtx?.currentTime ?? 0); } catch {}
    (t._euclidLfoKeys || (t._euclidLfoKeys = new Set())).add(key);
    startSetterLfoLoopIfNeeded();
    return;
  }

  const amp = (cfg.depth / 2) * (LFO_AMP_SCALE[key] ?? 1);
  const hz = effectiveRate(cfg);
  if (!lfo) {
    lfo = new Tone.LFO({ frequency: hz, min: -amp, max: amp, type: cfg.type });
    lfo.start();
    lfo.connect(param);
    t.lfos[key] = lfo;
  } else {
    lfo.frequency.value = hz;
    lfo.min = -amp;
    lfo.max = amp;
    lfo.type = cfg.type;
  }
}

export function syncAllLFOs(t) {
  for (const k of LFO_KEYS) syncLFO(t, k);
  try { applyWavetableScan(t); } catch (e) { console.warn("wavetable scan sync failed", e); }
}

export function disposeLFOs(t) {
  for (const k of LFO_KEYS) {
    const lfo = t.lfos[k];
    if (!lfo) continue;
    try { lfo.stop(); } catch {}
    try { lfo.disconnect(); } catch {}
    try { lfo.dispose(); } catch {}
    t.lfos[k] = null;
  }
  if (t._setterLfoPhase) t._setterLfoPhase = {};
  t._euclidLfoKeys?.clear();
  try { t.fxRack?.refreshStageActivity?.(); } catch {}
}

export function retuneSyncedLFOs() {
  for (const t of state.tracks) {
    for (const k of LFO_KEYS) {
      if (t.lfoConfig[k].enabled && t.lfoConfig[k].sync) syncLFO(t, k);
    }
    if (t.wavetable?.scan?.enabled && t.wavetable.scan.sync) applyWavetableScan(t);
  }
}

// ---- per-step automation -----------------------------------------------
// Lanes live on the pattern (t.patterns[i].automation[key] = { enabled, values })
// and are aliased to t.automation by aliasPattern(). Lane values are normalized
// 0..1 per step; applyAutomationAtStep maps that to the target's physical range.

