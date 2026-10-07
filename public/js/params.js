import { ENGINE_MACRO_TIPS, PLAITS_MACRO_TIPS, engineByKey, engineSliderLabels } from "./catalog.js";
import { HEXOP_ALG_FEEDBACK, HEXOP_ALG_LABELS, hexopCarriers } from "./hexop.js";
import { applySampleSpeed, disposeLFOs, syncAllLFOs } from "./lfo.js";
import { redetectDrumKit } from "./meter.js";
import { applyBusMute, placeBusesLast, refreshFxPanelUI, updateMidiUI } from "./render.js";
import { ensureFxRack, refreshAllTrackOutputs, refreshOutputSelects, routeVoiceToRack } from "./signal.js";
import { state } from "./state.js";
import { requestMidiIfNeeded } from "./transport.js";
import { buildVoiceForEngine, GRAN_DEFAULTS } from "./voices.js";
import { voxPhrase } from "./vox.js";


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
 * The vox's consonant select only decides what a note starts with while the
 * words are off and the lyric is empty: either of those carries its own
 * consonants and wins. So grey it out then, and say why, rather than let it
 * look broken. Call after anything that can change `sngwords` / `sngtext`.
 * @param {Track} t
 */
export function updateVoxConsEnabled(t) {
  const el = t.el?.querySelector(".p-sngcons");
  if (!el) return;
  if (el.dataset.title == null) el.dataset.title = el.title;
  const typed = voxPhrase("off", t.params.sngtext ?? "").length > 0;
  const words = (t.params.sngwords ?? "off") !== "off";
  el.disabled = typed || words;
  el.title = typed ? "off while the lyric is sung: its syllables carry their own consonants. Clear the lyric to use this"
    : words ? "off while the words are on: each syllable carries its own consonant. Set the words to off to use this"
    : el.dataset.title;
}
/**
 * Redraw the hexop panel's algorithm readout: the chain diagram beside the
 * dropdown, which operators are carriers (the ones you actually hear), and
 * which one the feedback loop runs through. Programming FM is guesswork until
 * you know those two things, and the algorithm's number alone doesn't say.
 * @param {Track} t
 */
export function refreshHexopAlgorithm(t) {
  const root = t._hexopGroupEl || t.el?.querySelector(".sq-param-group--hexop");
  if (!root) return;
  const n = Math.max(1, Math.min(32, Number(t.params.dalg) || 1));
  const fb = HEXOP_ALG_FEEDBACK[n - 1] ?? "6";
  const car = hexopCarriers(n);
  const out = root.querySelector(".sq-hexop__alg");
  if (out) {
    // The dropdown already shows the diagram, so say the thing it doesn't:
    // which operators you actually hear, and where the feedback is wired.
    out.textContent = `carrier${car.length > 1 ? "s" : ""} ${car.join(" ")}`;
    const tail = document.createElement("span");
    tail.className = "sq-hexop__alg-fb";
    tail.textContent = ` · feedback ${fb}`;
    out.appendChild(tail);
    out.title = `operators ${car.join(", ")} go straight to the output, so their levels are volume. The rest are modulators: a level is how hard it bends the operator below. Feedback runs through operator ${fb.replace("→", " into ")}`;
  }
  const carriers = new Set(car);
  const fbOp = Number(fb.split("→")[0]);
  for (const row of root.querySelectorAll(".sq-hexop__oprow")) {
    const op = Number(row.dataset.op);
    row.classList.toggle("is-carrier", carriers.has(op));
    row.classList.toggle("is-feedback", op === fbOp);
  }
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
  // The analog mono engines (snarl, ladder) reuse the harm/timb/morph/decay
  // sliders for their own params, so keep the timbre group visible for them too.
  const isSnarl = t.engineKey === "dm:snarl";
  const isLadder      = t.engineKey === "dm:ladder";
  const isDrift      = t.engineKey === "dm:drift";
  const isGuitar    = t.engineKey === "dm:guitar";
  const isBass      = t.engineKey === "dm:bass";
  const isSub       = t.engineKey === "dm:sub";
  const isDrone     = t.engineKey === "dm:drone";
  const isVox       = t.engineKey === "dm:vox";
  const isLancet      = t.engineKey === "dm:lancet";
  const isSiege       = t.engineKey === "dm:siege";
  const isTines    = t.engineKey === "dm:tines";
  const isOracle  = t.engineKey === "dm:oracle";
  const isGranular  = t.engineKey === "dm:granular";
  const isWavetable = t.engineKey === "wt:akwf";
  const isSilverbox     = t.engineKey === "dm:silverbox";
  const isContagion     = t.engineKey === "dm:contagion";
  const isHexop       = t.engineKey === "dm:hexop";
  // The 808 voices are modelled on the machine's circuits, so their sliders are
  // its panel knobs (see buildDrumSynthNode).
  const is808 = t.engineKey.startsWith("dm:808-");
  const is909 = t.engineKey.startsWith("dm:909-");
  const showTimbre = isPlaits || isSnarl || isLadder || isDrift || isGuitar || isBass || isSub || isDrone || isVox || isLancet || isSiege || isTines || isOracle || isGranular || isWavetable || isSilverbox || isContagion || isHexop || is808 || is909;
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
  if (group) {    const labels = engineSliderLabels(t.engineKey);    // What the four sliders do varies enough per engine that the label alone
    // isn't much help — hang an explanation off the ones worth explaining.
    const tips = isGranular
      ? {
          harm: "grain length",
          timb: "grains per second, ignored while sync is on",
          morph: "play position in the sample",
          decay: "diffusion: widens the window, loosens the jitter and adds detune",
        }
      : isSilverbox
      ? {
          harm: "an 18dB/oct diode ladder, ahead of the track filter",
          timb: "resonance, which thins and squelches the line as it climbs",
          morph: "how much of the filter envelope reaches the cutoff",
          decay: "filter envelope decay",
        }
      : isHexop
      ? {
          harm: "every modulator's output level at once: the master modulation index",
          timb: "how much the feedback operator's output goes back into its own input",
          morph: "scales every modulator's decay together",
          decay: "scales every carrier's decay and release together",
        }
      : isGuitar
      ? {
          harm: "how hard the pickup drives the amp",
          timb: "the tone knob on the guitar itself, a passive lowpass",
          morph: "how much the speaker feeds back into the strings",
          decay: "how long a string rings",
        }
      : isBass
      ? {
          harm: "how hard the bass drives the amp",
          timb: "the tone knob on the bass itself, a lowpass",
          morph: "the rig compressor, threshold and makeup on one control",
          decay: "how long a string rings",
        }
      : isSub
      ? {
          harm: "how much harmonic content is mixed in above the crossover",
          timb: "the lid on those harmonics",
          morph: "the oscillator, morphed from sine through triangle and saw to square",
          decay: "how long the note rings",
        }
      : isDrone
      ? {
          harm: "the MS-20 style lowpass the equation and the noise run through",
          timb: "A0, the equation's multiplier, 1 to 16. It changes how fast the slow terms run against the pitch, not the pitch",
          morph: "A1, the first shift in the equation, 2 to 15: how slowly its first slow term changes",
          decay: "A2, the second shift, 2 to 15. Some equations only use A1",
        }
      : isVox
      ? {
          harm: "the vowel, from u through o, a and e to i. Words, when on, choose their own",
          timb: "the size of the throat: soprano at the bottom, alto, tenor, bass at the top",
          morph: "air in the voice. A little is a real voice, the top quarter goes to a whisper",
          decay: "how long a note takes to fade once it lets go",
        }
      : isLancet
      ? {
          harm: "timbre: what it does depends on the model. On most it is the noise: its level, brightness and length",
          timb: "color: the pitch envelope and shell balance (analog), the shaper (slap), the partials (modal), the body (physical), the modulator ratios (fm), the grains (granular), the bodies (blend)",
          morph: "the fx amount: each model's own stage, from clean at the bottom. Read live, so a lane sweeps it",
          decay: "how long the hit lasts, 60ms to 2.4s",
        }
      : isSiege
      ? {
          harm: "the drive, after the envelope: it crushes the attack, leaves the tail a clean sub, and lifts that tail up to twelve times. Fold or clip is the panel's choice",
          timb: "the click: how far above the note the pitch starts, up to six octaves. The fall is the attack",
          morph: "how long the pitch takes to fall onto the note, 1ms to a quarter second. Short is a tick, long is the 909's sweep",
          decay: "how long the body rings, 50ms to four seconds",
        }
      : isContagion
      ? {
          harm: "cutoff for both filters (filter 2 follows it, offset by cut 2)",
          timb: "filter 1's resonance. Filter 2 has its own, reso 2. The last tenth self-oscillates",
          morph: "osc 1's shape, morphing sine through triangle and saw to pulse. Osc 2's is shape 2",
          decay: "the amp envelope's decay. The filter envelope has its own",
        }
      : (is808 || is909)
      ? {
          harm: "tuning for this voice",
          timb: t.engineKey === "dm:909-kick"
            ? "level of the beater click on the attack"
            : t.engineKey.endsWith("-kick")
            ? "level of the attack click mixed in over the body"
            : t.engineKey.endsWith("-snare")
            ? "opens the noise band up, from a dull rasp to a bright crack"
            : t.engineKey.endsWith("-clap")
            ? "width of the noise band the slaps are struck through"
            : "brightness of the filter the metal cluster runs through",
          morph: t.engineKey.endsWith("-kick")
            ? "saturation on the way out, pushing the body into soft clipping"
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
    if (randBtn) randBtn.hidden = isSnarl || isLadder || isDrift || isGuitar || isBass || isSub || isDrone || isVox || isLancet || isSiege || isTines || isOracle || isGranular || isWavetable || isSilverbox || isContagion || isHexop || is808 || is909;
  }
  // Per-oscillator volume sliders: only shown for the analog mono engines.
  const oscGroup = t._oscMixGroupEl || t.el.querySelector(".sq-param-group--osc-mix");
  if (oscGroup) {
    const showOsc = isSnarl || isLadder || isDrift || isOracle || isContagion;
    oscGroup.hidden = !showOsc;
    if (showOsc) {
      const oscLabels = isSnarl
        ? { osc1: "saw",  osc2: "pulse", osc3: "tri",   osc4: "sub", hide4: false }
        : isDrift
        ? { osc1: "dco",  osc2: "sub",   osc3: "noise", osc4: "",    hide4: true }
        : isOracle
        ? { osc1: "vco1", osc2: "vco2",  osc3: "sub",   osc4: "noise", hide4: false }
        : isContagion
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
  // Oscillator-modifier group (ultrasaw / FM / metalizer): snarl only for now.
  const modGroup = t._oscModGroupEl || t.el.querySelector(".sq-param-group--osc-mod");
  if (modGroup) {
    modGroup.hidden = !isSnarl;
    const modTips = ENGINE_MACRO_TIPS[t.engineKey]?.oscMod;
    for (const k of ["ultra", "fm", "metal"]) {
      const field = modGroup.querySelector(`.p-${k}`)?.closest(".sq-field");
      if (field) field.title = modTips?.[k] ?? "";
    }
  }
  // Ladder osc-bank group (per-osc range + waveform + osc2/3 freq + noise).
  const ladderGroup = t._ladderOscGroupEl || t.el.querySelector(".sq-param-group--ladder");
  if (ladderGroup) ladderGroup.hidden = !isLadder;
  // Silverbox panel controls with no home among the four timbre sliders.
  const silverboxGroup = t._silverboxGroupEl || t.el.querySelector(".sq-param-group--silverbox");
  if (silverboxGroup) silverboxGroup.hidden = !isSilverbox;
  // Contagion oscillator / unison / filter-pair panel.
  const contagionGroup = t._contagionGroupEl || t.el.querySelector(".sq-param-group--contagion");
  if (contagionGroup) contagionGroup.hidden = !isContagion;
  // Hexop operator matrix. The algorithm readout has to be redrawn with it — the
  // panel is the same six rows whichever wiring they're in, so the carrier and
  // feedback markers are the only thing saying what the rows mean.
  const hexopGroup = t._hexopGroupEl || t.el.querySelector(".sq-param-group--hexop");
  if (hexopGroup) hexopGroup.hidden = !isHexop;
  if (isHexop) refreshHexopAlgorithm(t);
  // The guitar's rig: where the string is picked and read, and the amp it runs
  // into. None of it fits the four timbre sliders.
  const guitarGroup = t._guitarGroupEl || t.el.querySelector(".sq-param-group--guitar");
  if (guitarGroup) guitarGroup.hidden = !isGuitar;
  // The bass's rig: the right hand, the parallel dirt, and the amp under it.
  const bassGroup = t._bassGroupEl || t.el.querySelector(".sq-param-group--bass");
  if (bassGroup) bassGroup.hidden = !isBass;
  // Subby's oscillator, its pitch drop, the harmonics path that makes it
  // audible on something small, and the output stage that keeps it safe.
  const subGroup = t._subGroupEl || t.el.querySelector(".sq-param-group--sub");
  if (subGroup) subGroup.hidden = !isSub;
  // The drone's equation oscillator, filter, LFO, delay and cloud.
  const droneGroup = t._droneGroupEl || t.el.querySelector(".sq-param-group--drone");
  if (droneGroup) droneGroup.hidden = !isDrone;
  // The vox's glottis, vibrato, choir and consonants.
  const voxGroup = t._voxGroupEl || t.el.querySelector(".sq-param-group--vox");
  if (voxGroup) voxGroup.hidden = !isVox;
  if (isVox) updateVoxConsEnabled(t);
  // The lancet's model, tune, velocity amount and randomizer.
  const lancetGroup = t._lancetGroupEl || t.el.querySelector(".sq-param-group--lancet");
  if (lancetGroup) lancetGroup.hidden = !isLancet;
  // The siege's drive type, tune, lock, low cut and velocity floor.
  const siegeGroup = t._siegeGroupEl || t.el.querySelector(".sq-param-group--siege");
  if (siegeGroup) siegeGroup.hidden = !isSiege;
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
  // An fx bus is a track with no instrument in it. Everything that writes or
  // plays notes goes away (style.css keys off this class); the signal chain, the
  // mod matrix and the automation lanes stay, which is the entire point of it
  // being a track. The envelope goes too — it only fires on a note.
  t.el.classList.toggle("is-bus", t.engineKey === "bus");
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
  if (!cfg.crush) cfg.crush = { bits: 8, rate: 1, wet: 0 };
  cfg.crush.wet = 0;
  if (cfg.prism) cfg.prism.wet = 0;
  if (cfg.repeat) cfg.repeat.wet = 0;
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
    if (cfg.repeat) t.fxRack.applyRepeat(cfg.repeat);
    if (cfg.prism) t.fxRack.applyPrism(cfg.prism);
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
  // Becoming (or ceasing to be) a bus changes what every other track may send
  // to, and the dropdowns are how a send is picked. It also changes where the
  // track belongs in the list: buses sit at the bottom.
  refreshOutputSelects();
  placeBusesLast();
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
  // The voice was rebuilt, so a bus's summing gain is a new node and the tracks
  // feeding it are still connected to the old one.
  refreshAllTrackOutputs();
  applyBusMute(t);
  updateMidiUI(t);
  updatePlaitsControlsVisibility(t);
  t._refreshSaveEnabled?.();
}

