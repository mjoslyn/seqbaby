import { ENGINE_MACRO_TIPS, PLAITS_MACRO_TIPS, engineByKey } from "./catalog.js";
import { applySampleSpeed, disposeLFOs, syncAllLFOs } from "./lfo.js";
import { redetectDrumKit } from "./meter.js";
import { refreshFxPanelUI, updateMidiUI } from "./render.js";
import { ensureFxRack, routeVoiceToRack } from "./signal.js";
import { state } from "./state.js";
import { requestMidiIfNeeded } from "./transport.js";
import { buildVoiceForEngine, GRAN_DEFAULTS } from "./voices.js";


/** @typedef {import("./types.js").Track} Track */
/**
 * Play-head speed only means anything while the head is moving, so grey the
 * slider out in fixed mode rather than letting it look broken. Pitch stays live
 * in both modes. Call after anything that can change `gplay`.
 * @param {Track} t
 */
export function updateGranularSpeedEnabled(t) {
  const moving = (t.params.gplay ?? GRAN_DEFAULTS.gplay) === "moving";
  const el = t.el?.querySelector(".p-gspeed");
  if (el) el.disabled = !moving;
  const modalEl = t._gWavModal?.overlay?.querySelector(".gw-gspeed");
  if (modalEl) modalEl.disabled = !moving;
}
/**
 * Set a track synth param and push it to the live voice.
 * @param {Track} t @param {string} key @param {number} val
 */
export function setParam(t, key, val) {
  t.params[key] = val;
  t.voice?.setParam(key, val);
}

export function updatePlaitsControlsVisibility(t) {
  if (!t.el) return;
  const eng = engineByKey(t.engineKey);
  const engineType = eng?.type;
  const isPlaits = engineType === "plaits";
  // The analog mono engines (mini-brute, moog) reuse the harm/timb/morph/decay
  // sliders for their own params, so keep the timbre group visible for them too.
  const isMiniBrute = t.engineKey === "dm:mini-brute";
  const isMoog      = t.engineKey === "dm:moog";
  const isJuno      = t.engineKey === "dm:juno";
  const isGuitar    = t.engineKey === "dm:guitar";
  const isBass      = t.engineKey === "dm:bass";
  const isRhodes    = t.engineKey === "dm:rhodes";
  const isProphet6  = t.engineKey === "dm:prophet6";
  const isGranular  = t.engineKey === "dm:granular";
  const isWavetable = t.engineKey === "wt:akwf";
  const isTb303     = t.engineKey === "dm:303";
  const isVirus     = t.engineKey === "dm:virus";
  // The 808 voices are modelled on the machine's circuits, so their sliders are
  // its panel knobs (see buildDrumSynthNode).
  const is808 = t.engineKey.startsWith("dm:808-");
  const is909 = t.engineKey.startsWith("dm:909-");
  const showTimbre = isPlaits || isMiniBrute || isMoog || isJuno || isGuitar || isBass || isRhodes || isProphet6 || isGranular || isWavetable || isTb303 || isVirus || is808 || is909;
  const group = t._timbreGroupEl || t.el.querySelector(".sq-param-group--timbre");
  if (group) {
    group.hidden = !showTimbre;
    group.style.removeProperty("display");
  }
  const modPanel = t._modPanelEl || t.el.querySelector(".sq-track__mod-panel");
  if (modPanel) {
    for (const key of ["harm", "timb", "morph", "decay"]) {
      const row = modPanel.querySelector(`.sq-lfo__row[data-key="${key}"]`);
      if (row) {
        row.hidden = !showTimbre;
        row.style.removeProperty("display");
      }
    }
  }
  // Relabel the timbre sliders for each analog engine so the control intent is
  // visible. null = hide the field (control isn't used by this engine).
  if (group) {
    const labels = isMiniBrute
      ? { harm: "pwm rate", timb: "pw",     morph: null,        decay: null }
      : isMoog
      ? { harm: "detune",   timb: null,     morph: null,        decay: "warm" }
      : isJuno
      ? { harm: "pwm rate", timb: "pw",     morph: "chorus",    decay: "dec" }
      : isGuitar
      ? { harm: "drive",    timb: "bright", morph: "chorus",    decay: "sustain" }
      : isBass
      ? { harm: "drive",    timb: "tone",   morph: "resonance", decay: "sustain" }
      : isRhodes
      ? { harm: "tine",     timb: "bite",   morph: "chorus",    decay: "decay" }
      : isProphet6
      ? { harm: "detune",   timb: "shape",  morph: "drive",     decay: "decay" }
      : isGranular
      ? { harm: "grain",    timb: "dense",  morph: "pos",       decay: "spray" }
      : isWavetable
      ? { harm: "wave",     timb: "warm",   morph: "detune",    decay: "decay" }
      : isTb303
      ? { harm: "cutoff",   timb: "reso",   morph: "env mod",   decay: "decay" }
      : isVirus
      ? { harm: "cutoff",   timb: "reso",   morph: "shape",     decay: "decay" }
      : t.engineKey === "dm:808-kick"
      ? { harm: "tune",     timb: "tone",   morph: "drive",     decay: "decay" }
      : t.engineKey === "dm:808-snare"
      ? { harm: "tune",     timb: "tone",   morph: "snappy",    decay: "decay" }
      : t.engineKey === "dm:808-clap"
      ? { harm: "tune",     timb: "tone",   morph: "spread",    decay: "decay" }
      : (t.engineKey === "dm:808-chat" || t.engineKey === "dm:808-ohat" || t.engineKey === "dm:808-cowbell")
      ? { harm: "tune",     timb: "tone",   morph: null,        decay: "decay" }
      : t.engineKey === "dm:909-kick"
      ? { harm: "tune",     timb: "attack", morph: "drive",     decay: "decay" }
      : t.engineKey === "dm:909-snare"
      ? { harm: "tune",     timb: "tone",   morph: "snappy",    decay: "decay" }
      : t.engineKey === "dm:909-clap"
      ? { harm: "tune",     timb: "tone",   morph: "spread",    decay: "decay" }
      : (t.engineKey === "dm:909-chat" || t.engineKey === "dm:909-ohat")
      ? { harm: "tune",     timb: "tone",   morph: null,        decay: "decay" }
      : { harm: "harm",     timb: "timb",    morph: "morph",    decay: "decay" };
    // What the four sliders do varies enough per engine that the label alone
    // isn't much help — hang an explanation off the ones worth explaining.
    const tips = isGranular
      ? {
          harm: "grain length. Short grains rattle and buzz; long ones overlap into a smooth wash",
          timb: "grains per second, 8 to 90. Ignored while sync is on — rate takes over",
          morph: "play position in the sample. Dragging the window in the wave editor sets this too",
          decay: "diffusion macro: widens the window, loosens the jitter and adds detune, all at once. Leave it at zero if you want a tight, in-tune cloud",
        }
      : isTb303
      ? {
          harm: "the 303's own filter — an 18dB/oct diode ladder, ahead of the track filter. It doesn't track the keyboard, so high notes really are duller than low ones",
          timb: "resonance. The feedback costs the passband level as it climbs, so the line gets thinner and squelchier the further you push it — that thinning is why a 303 wants a distortion after it",
          morph: "how much of the filter envelope reaches the cutoff",
          decay: "filter envelope decay, 200ms to 2.5s. Accented steps ignore this and use a fixed 200ms, exactly as the accent circuit does on the machine",
        }
      : isVirus
      ? {
          harm: "cutoff for both filters — filter 2 sits at whatever offset its own cut 2 slider sets. Tracks the keyboard at a third of an octave per octave",
          timb: "resonance, shared by both filters",
          morph: "oscillator shape, a continuous morph from sine through triangle and saw to pulse. Pulse width takes over at the very top",
          decay: "decay for both envelopes — how fast each note falls from its peak to the sustain level",
        }
      : (is808 || is909)
      ? {
          harm: "tuning for this voice. The machines tune only their toms, so this stands in for the trimmer inside — and unlike the kick, these voices ignore the step's note",
          timb: t.engineKey === "dm:909-kick"
            ? "level of the beater click on the attack — most of what makes a 909 kick cut through"
            : t.engineKey.endsWith("-kick")
            ? "level of the attack click mixed in over the body"
            : t.engineKey.endsWith("-snare")
            ? "opens the noise band up, from a dull rasp to a bright crack"
            : t.engineKey.endsWith("-clap")
            ? "width of the noise band the slaps are struck through"
            : "brightness of the filter the metal cluster runs through",
          morph: t.engineKey.endsWith("-kick")
            ? "saturation on the way out — pushes the body into soft clipping"
            : t.engineKey.endsWith("-snare")
            ? "balance between the noise and the drum shells"
            : t.engineKey.endsWith("-clap")
            ? "spacing of the three slaps that make up the clap"
            : null,
          decay: "how long the voice rings out",
        }
      // Plaits keeps the hardware's generic slider names across all sixteen
      // models, so the per-model explanation has to come through the tooltip.
      : isPlaits ? (PLAITS_MACRO_TIPS[eng?.plaitsIdx] ?? null)
      // Every other engine that borrows these four sliders (see catalog.js).
      : (ENGINE_MACRO_TIPS[t.engineKey] ?? null);
    for (const key of Object.keys(labels)) {
      const field = group.querySelector(`.p-${key}`)?.closest(".sq-field");
      if (!field) continue;
      if (labels[key] == null) {
        field.hidden = true;
      } else {
        field.hidden = false;
        const lbl = field.querySelector("label");
        if (lbl) lbl.textContent = labels[key];
        // Clear a previous engine's tip rather than leaving it behind.
        field.title = tips?.[key] ?? "";
      }
    }
    // Randomize button only makes sense for Plaits' generic harm/timb/morph/decay —
    // hide it for the analog engines where those sliders do engine-specific things.
    const randBtn = group.querySelector(".track-rand");
    if (randBtn) randBtn.hidden = isMiniBrute || isMoog || isJuno || isGuitar || isBass || isRhodes || isProphet6 || isGranular || isWavetable || isTb303 || isVirus || is808 || is909;
  }
  // Per-oscillator volume sliders: only shown for the analog mono engines.
  const oscGroup = t._oscMixGroupEl || t.el.querySelector(".sq-param-group--osc-mix");
  if (oscGroup) {
    const showOsc = isMiniBrute || isMoog || isJuno || isProphet6 || isVirus;
    oscGroup.hidden = !showOsc;
    if (showOsc) {
      const oscLabels = isMiniBrute
        ? { osc1: "saw",  osc2: "pulse", osc3: "tri",   osc4: "sub", hide4: false }
        : isJuno
        ? { osc1: "dco",  osc2: "sub",   osc3: "noise", osc4: "",    hide4: true }
        : isProphet6
        ? { osc1: "vco1", osc2: "vco2",  osc3: "sub",   osc4: "noise", hide4: false }
        : isVirus
        ? { osc1: "osc1", osc2: "osc2",  osc3: "sub",   osc4: "noise", hide4: false }
        : { osc1: "osc1", osc2: "osc2",  osc3: "osc3",  osc4: "",    hide4: true };
      const oscTips = ENGINE_MACRO_TIPS[t.engineKey]?.osc;
      for (const k of ["osc1", "osc2", "osc3", "osc4"]) {
        const field = oscGroup.querySelector(`.p-${k}`)?.closest(".sq-field");
        if (!field) continue;
        if (k === "osc4" && oscLabels.hide4) { field.hidden = true; continue; }
        field.hidden = false;
        const lbl = field.querySelector("label");
        if (lbl) lbl.textContent = oscLabels[k];
        field.title = oscTips?.[k] ?? "";      // clear the last engine's line
      }
    }
  }
  // Oscillator-modifier group (ultrasaw / FM / metalizer): mini-brute only for now.
  const modGroup = t._oscModGroupEl || t.el.querySelector(".sq-param-group--osc-mod");
  if (modGroup) {
    modGroup.hidden = !isMiniBrute;
    const modTips = ENGINE_MACRO_TIPS[t.engineKey]?.oscMod;
    for (const k of ["ultra", "fm", "metal"]) {
      const field = modGroup.querySelector(`.p-${k}`)?.closest(".sq-field");
      if (field) field.title = modTips?.[k] ?? "";
    }
  }
  // Moog osc-bank group (per-osc range + waveform + osc2/3 freq + noise).
  const moogGroup = t._moogOscGroupEl || t.el.querySelector(".sq-param-group--moog");
  if (moogGroup) moogGroup.hidden = !isMoog;
  // TB-303 panel controls with no home among the four timbre sliders.
  const tb303Group = t._tb303GroupEl || t.el.querySelector(".sq-param-group--tb303");
  if (tb303Group) tb303Group.hidden = !isTb303;
  // Virus oscillator / unison / filter-pair panel.
  const virusGroup = t._virusGroupEl || t.el.querySelector(".sq-param-group--virus");
  if (virusGroup) virusGroup.hidden = !isVirus;
  // Granular grain-engine group (play mode / window / jitter / detune / pan / …).
  const granGroup = t._granGroupEl || t.el.querySelector(".sq-param-group--granular");
  if (granGroup) granGroup.hidden = !isGranular;
  if (isGranular) updateGranularSpeedEnabled(t);
  // Header wave/sample icon button (between the engine dropdown and save): only
  // usable for the granular + sampler engines; greyed out (disabled) otherwise.
  // (The icon-button display overrides [hidden], so disable rather than hide.)
  const isSampler = t.engineKey === "sampler";
  const wavBtn = t.el.querySelector(".sq-track__wav");
  if (wavBtn) wavBtn.disabled = !(isGranular || isSampler || isWavetable);
}

// Force all fx wet levels to 0 (100% dry) — used when switching a track to the
// eleven-labs engine so user-applied fx don't stack on baked-in sample ambience.
export function resetFxDry(t) {
  const cfg = t.fxConfig;
  if (!cfg.vinyl)      cfg.vinyl      = { amount: 0, warmth: 0.4, wow: 0.3 };
  if (!cfg.cassette)   cfg.cassette   = { amount: 0, flutter: 0.3, sat: 0.4 };
  if (!cfg.chorus)     cfg.chorus     = { wet: 0, rate: 0.5, depth: 0.5 };
  if (!cfg.ringmod)    cfg.ringmod    = { wet: 0, freq: 0.35 };
  if (!cfg.autowah)    cfg.autowah    = { wet: 0, sens: 0.5, range: 0.5 };
  if (!cfg.phaser)     cfg.phaser     = { wet: 0, rate: 0.3, depth: 0.5 };
  if (!cfg.flanger)    cfg.flanger    = { wet: 0, rate: 0.3, fbk: 0.5 };
  if (!cfg.pitchshift) cfg.pitchshift = { wet: 0, semitones: 0 };
  if (!cfg.shaper)     cfg.shaper     = { wet: 0, amount: 0.5 };
  cfg.vinyl.amount      = 0;
  cfg.cassette.amount   = 0;
  cfg.fuzz.amount       = 0;
  cfg.ringmod.wet       = 0;
  cfg.shaper.wet        = 0;
  cfg.autowah.wet       = 0;
  cfg.chorus.wet        = 0;
  cfg.phaser.wet        = 0;
  cfg.flanger.wet       = 0;
  cfg.pitchshift.wet    = 0;
  cfg.delay.wet         = 0;
  cfg.reverb.wet        = 0;
  if (!cfg.crush) cfg.crush = { bits: 8, wet: 0 };
  cfg.crush.wet = 0;
  if (t.fxRack) {
    t.fxRack.applyVinyl(cfg.vinyl);
    t.fxRack.applyCassette(cfg.cassette);
    t.fxRack.applyFuzz(cfg.fuzz);
    t.fxRack.applyRingMod(cfg.ringmod);
    t.fxRack.applyWaveShaper(cfg.shaper);
    t.fxRack.applyAutoWah(cfg.autowah);
    t.fxRack.applyChorus(cfg.chorus);
    t.fxRack.applyPhaser(cfg.phaser);
    t.fxRack.applyFlanger(cfg.flanger);
    t.fxRack.applyPitchShift(cfg.pitchshift);
    t.fxRack.applyDelay(cfg.delay);
    t.fxRack.applyReverb(cfg.reverb);
    t.fxRack.applyCrush(cfg.crush);
  }
  refreshFxPanelUI(t);
}

/**
 * Switch a track's engine, rebuilding the voice in place when possible and
 * relabeling the synth controls for the new engine.
 * @param {Track} t @param {string} newKey
 */
export function setEngineKey(t, newKey) {
  const same = t.engineKey === newKey;
  if (same) { updatePlaitsControlsVisibility(t); return; }
  const e = engineByKey(newKey);
  if (!e) return;
  t.engineKey = newKey;
  redetectDrumKit(t);
  // Saved patches live on the track as customConfig
  if (e.type === "saved") {
    t.customConfig = e.config;
  }
  if (!t.voice) { updateMidiUI(t); updatePlaitsControlsVisibility(t); return; }
  if (t.voice.canInPlaceChange(newKey) && t.voice.type === e.type) {
    t.voice.setEngine(newKey);
  } else {
    disposeLFOs(t);
    t.voice.dispose();
    ensureFxRack(t);
    t.voice = buildVoiceForEngine(state.audioCtx, newKey, t.params, t);
    if (t.voice.type === "midi") {
      t.voice.setChannel(t.midi.channel);
      const out = state.midi?.outputs.get(t.midi.outputId);
      if (out) t.voice.setOutput(out);
    }
    if (t.voice.setGlide) t.voice.setGlide(t.glide);
    routeVoiceToRack(t);
    applySampleSpeed(t);
    syncAllLFOs(t);
  }
  // MIDI access is lazy — this switch may be the first MIDI engine in the
  // session. Requests in the background, then wires outputs + dropdowns.
  if (e.type === "midi") requestMidiIfNeeded();
  updateMidiUI(t);
  updatePlaitsControlsVisibility(t);
  t._refreshSaveEnabled?.();
}

