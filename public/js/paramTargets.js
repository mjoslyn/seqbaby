import { LFO_KEYS } from "./constants.js";


/** @typedef {import("./types.js").Track} Track */

// The join between a control in the DOM and the two key namespaces behind it —
// LFO keys (constants.js LFO_KEYS) and automation keys (automation.js
// AUTOMATION_TARGETS). They don't share a spelling: the fx delay wet slider is
// "delay" to the LFO and "fx.delay" to automation, and the 303's accent is
// "tb303_accent" / "tb303.accent".
//
// Two things read this: the right-click parameter menu (paramMenu.js), and the
// mod/aut exclusivity below — a parameter takes an LFO or an automation lane,
// never both, and knowing that they're the same parameter needs this table.
//
// Adding a control: one entry, keyed by the class the markup already uses.
// `null` on a side means that side has no target for it (e.g. the 303 waveform
// is a switch — automatable, not modulatable).
/** @type {Record<string, {lfo: string|null, auto: string|null}>} */
export const CONTROL_TARGETS = {};
const def = (cls, lfo, auto) => { CONTROL_TARGETS[cls] = { lfo, auto }; };

// Voice / instrument sliders — same key in both namespaces (metal has no LFO).
for (const k of ["vol", "harm", "timb", "morph", "decay",
                 "osc1", "osc2", "osc3", "osc4", "ultra", "fm", "metal", "noise"]) {
  def(`p-${k}`, LFO_KEYS.includes(k) ? k : null, k);
}
// Track filter.
def("p-cutoff", "cutoff", "cutoff");
def("p-reson",  "reson",  "reson");
// TB-303 panel.
def("p-accent303", "tb303_accent", "tb303.accent");
def("p-tune303",   "tb303_tune",   "tb303.tune");
def("p-wave303",   null,           "tb303.wave");
// Access Virus panel. The slider classes carry the "v" prefix the worklet uses;
// the LFO / automation keys spell the same control out differently.
for (const [cls, name] of [["vpw", "pw"], ["vfm", "fm"], ["vring", "ring"],
                           ["vunidet", "unidet"], ["vcut2", "cut2"], ["vbal", "bal"],
                           ["vsatamt", "sat"], ["venvamt", "envamt"],
                           ["vosc2semi", "osc2semi"], ["vosc2det", "osc2det"],
                           ["vunispread", "unispread"],
                           ["vatk", "atk"], ["vsus", "sus"], ["vrel", "rel"]]) {
  def(`p-${cls}`, `virus_${name}`, `virus.${name}`);
}
// Granular grain controls. Also reachable from the wav modal's own copies.
for (const k of ["speed", "pitch", "window", "jitter", "detune", "pan"]) {
  def(`p-g${k}`,  `gran_${k}`, `gran.${k}`);
  def(`gw-g${k}`, `gran_${k}`, `gran.${k}`);
}
for (const k of ["harm", "timb", "morph", "decay"]) def(`gw-${k}`, k, k);
// Wavetable wave-scan window (wavetable editor modal).
def("sq-wt__scan-start", "wt_scan_start", "wt.scan.start");
def("sq-wt__scan-range", "wt_scan_range", "wt.scan.range");
// FX rack. LFO keys are the historic short names; automation keys are dotted.
for (const [cls, lfo, auto] of [
  ["fx-vinyl-amount",     "vinyl",            "fx.vinyl"],
  ["fx-vinyl-warmth",     "vinyl_warmth",     "fx.vinyl.warmth"],
  ["fx-vinyl-wow",        "vinyl_wow",        "fx.vinyl.wow"],
  ["fx-cassette-amount",  "cassette",         "fx.cassette"],
  ["fx-cassette-flutter", "cassette_flutter", "fx.cassette.flutter"],
  ["fx-cassette-sat",     "cassette_sat",     "fx.cassette.sat"],
  ["fx-fuzz-amount",      "fuzz",             "fx.fuzz"],
  ["fx-fuzz-drive",       "fuzz_drive",       "fx.fuzz.drive"],
  ["fx-fuzz-tone",        "fuzz_tone",        "fx.fuzz.tone"],
  ["fx-fuzz-level",       "fuzz_level",       "fx.fuzz.level"],
  ["fx-ringmod-wet",      "ringmod",          "fx.ringmod"],
  ["fx-ringmod-freq",     "ring_freq",        "fx.ringmod.freq"],
  ["fx-shaper-wet",       "shaper",           "fx.shaper"],
  ["fx-shaper-preamp",    "shaper_preamp",    "fx.shaper.preamp"],
  ["fx-shaper-amt",       "shaper_amt",       "fx.shaper.amt"],
  ["fx-crush-wet",        "crush",            "fx.crush"],
  ["fx-crush-bits",       "crush_bits",       "fx.crush.bits"],
  ["fx-autowah-wet",      "autowah",          "fx.autowah"],
  ["fx-autowah-sens",     "autowah_sens",     "fx.autowah.sens"],
  ["fx-autowah-range",    "autowah_range",    "fx.autowah.range"],
  ["fx-chorus-wet",       "chorus",           "fx.chorus"],
  ["fx-chorus-rate",      "chorus_rate",      "fx.chorus.rate"],
  ["fx-chorus-depth",     "chorus_depth",     "fx.chorus.depth"],
  ["fx-phaser-wet",       "phaser",           "fx.phaser"],
  ["fx-phaser-rate",      "phaser_rate",      "fx.phaser.rate"],
  ["fx-phaser-depth",     "phaser_depth",     "fx.phaser.depth"],
  ["fx-flanger-wet",      "flanger",          "fx.flanger"],
  ["fx-flanger-rate",     "flanger_rate",     "fx.flanger.rate"],
  ["fx-flanger-fbk",      "flanger_fbk",      "fx.flanger.fbk"],
  ["fx-pitchshift-wet",   "pitch",            "fx.pitchshift"],
  ["fx-pitchshift-semi",  "pitch_semi",       "fx.pitchshift.semi"],
  ["fx-delay-wet",        "delay",            "fx.delay"],
  ["fx-delay-time",       "delay_time",       "fx.delay.time"],
  ["fx-delay-fbk",        "delay_fbk",        "fx.delay.fbk"],
  ["fx-reverb-wet",       "verb",             "fx.reverb"],
  ["fx-reverb-decay",     "reverb_decay",     "fx.reverb.decay"],
]) def(cls, lfo, auto);

// Where the right-click menu is offered at all. Controls listed above open it
// wherever they are; anything else opens it only inside one of these — the
// per-track sound controls, in the track row or in whichever modal is currently
// hosting them. That keeps it off the sequencer's own widgets (step editor,
// piano roll, the mod/aut rows themselves), which aren't instrument parameters
// and would only ever say "no". A control with no target still gets the menu
// here so the description is one right-click away.
export const PARAM_SCOPE_SELECTOR = [
  ".sq-param-group",           // every engine's synth controls
  ".sq-vol__field",            // the track's volume slider
  ".sq-track__filter-panel",
  ".sq-track__env-panel",
  ".sq-track__fx-panel",
  ".sq-track__eq-panel",
  ".sq-track__comp-panel",
  ".sq-gwav__ctl",             // granular wav modal's copies of the grain controls
  ".sq-wt__scan", ".sq-wt__uni",   // wavetable editor
  ".sq-samp__row",             // sample editor
].join(", ");

// ---- mod / automation exclusivity --------------------------------------
// A parameter is driven by an LFO or by an automation lane, never both: they
// write the same AudioParam from two schedules, and whichever ran last wins for
// as long as it holds — so the pair reads as one of them randomly dropping out.
// Every picker filters on this, and the parameter menu says which side owns the
// control, so the way to switch is to remove what's there.
/** @type {Record<string,string>} lfo key → automation key */
export const AUTO_FOR_LFO = {};
/** @type {Record<string,string>} automation key → lfo key */
export const LFO_FOR_AUTO = {};
for (const { lfo, auto } of Object.values(CONTROL_TARGETS)) {
  if (!lfo || !auto) continue;
  AUTO_FOR_LFO[lfo] = auto;
  LFO_FOR_AUTO[auto] = lfo;
}

/** Does this track have an LFO running on `lfoKey`? @param {Track} t */
export function hasMod(t, lfoKey) { return !!(lfoKey && t.lfoConfig?.[lfoKey]?.enabled); }
/** Does this track have an automation lane on `autoKey`? @param {Track} t */
export function hasAutomation(t, autoKey) { return !!(autoKey && t.automation?.[autoKey]); }
/** An automation lane already owns the parameter this LFO key targets. @param {Track} t */
export function autoOwns(t, lfoKey) { return hasAutomation(t, AUTO_FOR_LFO[lfoKey]); }
/** An LFO already owns the parameter this automation key targets. @param {Track} t */
export function modOwns(t, autoKey) { return hasMod(t, LFO_FOR_AUTO[autoKey]); }

// Names for the controls the markup labels only in passing — a bare <select>
// sitting after a row heading ("filter 1", "unison") has no label of its own to
// read, so the menu would otherwise have nothing to call it.
/** @type {Record<string, string>} */
export const CONTROL_LABELS = {
  "p-vmode1": "filter 1 mode", "p-vpoles": "filter 1 slope", "p-vmode2": "filter 2 mode",
  "p-vroute": "filter routing", "p-vsat": "saturation curve", "p-vsubwave": "sub waveform",
  "p-vsync": "hard sync", "p-vuni": "unison voices",
  "p-osc1range": "osc 1 range", "p-osc2range": "osc 2 range", "p-osc3range": "osc 3 range",
  "p-osc1wave": "osc 1 wave", "p-osc2wave": "osc 2 wave", "p-osc3wave": "osc 3 wave",
  "p-noisetype": "noise colour",
  "p-gplay": "grain play mode", "p-gloop": "grain loop mode",
  "p-gpattern": "grain pattern", "p-grate": "grain rate", "p-gsync": "grain sync",
  "gw-gplay": "grain play mode", "gw-gloop": "grain loop mode",
  "gw-gpattern": "grain pattern", "gw-grate": "grain rate", "gw-gsync": "grain sync",
  "fx-delay-div": "delay division", "fx-shaper-mode": "shaper mode",
  "sq-wt__scan-en": "wave scan", "sq-wt__scan-dir": "scan direction",
  "sq-wt__scan-sync": "scan sync", "sq-wt__scan-retrig": "scan retrigger",
  "sq-wt__scan-rate": "scan speed", "sq-wt__scan-div": "scan division",
  "sq-wt__scan-start": "scan start", "sq-wt__scan-range": "scan range",
  "sq-wt__uni-count": "unison voices",
  "sq-comp__source": "sidechain source",
};

// ---- what each parameter actually does ---------------------------------
// Shown in the parameter menu. Looked up by the control's own class first, then
// the markup's tooltip, then by automation key (falling back to the LFO key) —
// see `describe` in paramMenu.js. A class entry wins over a tooltip because the
// tooltips that exist were written for hover: some are a couple of words, and a
// few (the 303's, the Virus's, the 808's) are rewritten per engine and say it
// better than anything generic could, so those controls have no entry here.
/** @type {Record<string, string>} */
export const PARAM_DESCRIPTIONS = {
  vol:   "the track's output level, tapped for the meter and fed to the master bus",
  harm:  "first timbre macro. Harmonics on Plaits; every other engine reuses it for something of its own — the slider's label says which",
  timb:  "second timbre macro. Timbre on Plaits, relabelled per engine",
  morph: "third timbre macro. Morph on Plaits, relabelled per engine",
  decay: "how long a note takes to fall away after it is struck",
  osc1:  "level of the first oscillator in the mix",
  osc2:  "level of the second oscillator in the mix",
  osc3:  "level of the third oscillator (the sub, on most engines)",
  osc4:  "level of the fourth source — sub or noise, depending on the engine",
  ultra: "mini-brute ultrasaw: detuned copies of the saw, for a thicker single oscillator",
  fm:    "mini-brute oscillator FM depth — metallic, inharmonic tone as it climbs",
  metal: "mini-brute metalizer: folds the triangle back on itself into harsh upper harmonics",
  noise: "level of the noise source in the oscillator mix",
  cutoff: "the track's lowpass filter — sits after the voice, before the eq. The env panel can sweep it per note",
  reson:  "resonance of that lowpass: a peak right at the cutoff, from a gentle emphasis to a whistle",
  "fx.vinyl":            "how much of the vinyl simulation is in the signal — surface noise, tone loss and a slow warble, together",
  "fx.vinyl.warmth":     "how far the vinyl stage rolls the top end off",
  "fx.vinyl.wow":        "depth of the vinyl warble — an off-centre record",
  "fx.cassette":         "how much of the cassette simulation is in the signal — hiss, saturation and flutter",
  "fx.cassette.flutter": "speed instability of the tape: faster and finer than vinyl wow",
  "fx.cassette.sat":     "how hard the tape is driven, from a gentle thickening to audible compression",
  "fx.fuzz":             "dry/wet for the fuzz stage",
  "fx.fuzz.drive":       "how hard the fuzz is hit — the gain going into the clipper",
  "fx.fuzz.tone":        "brightness of the fuzz's output filter",
  "fx.fuzz.level":       "output level of the fuzz, to trim back what drive adds",
  "fx.ringmod":          "dry/wet for the ring modulator",
  "fx.ringmod.freq":     "carrier frequency the signal is multiplied by, 20Hz to 3kHz — low is tremolo, high is clangorous",
  "fx.shaper":           "dry/wet for the wave shaper",
  "fx.shaper.preamp":    "gain into the shaper — how far up its curve the signal reaches",
  "fx.shaper.amt":       "how extreme the shaping curve is (its shape is the mode select beside it)",
  "fx.crush":            "dry/wet for the bit crusher",
  "fx.crush.bits":       "bit depth, 16 down to 1 — quantisation noise on the way down",
  "fx.autowah":          "dry/wet for the auto-wah",
  "fx.autowah.sens":     "how readily the envelope follower opens the wah",
  "fx.autowah.range":    "how far the wah sweeps once it opens",
  "fx.chorus":           "dry/wet for the chorus",
  "fx.chorus.rate":      "speed of the chorus' modulation",
  "fx.chorus.depth":     "how far the chorus detunes the delayed copy",
  "fx.phaser":           "dry/wet for the phaser",
  "fx.phaser.rate":      "speed the phaser's notches sweep",
  "fx.phaser.depth":     "how far those notches travel",
  "fx.flanger":          "dry/wet for the flanger",
  "fx.flanger.rate":     "speed of the flanger sweep",
  "fx.flanger.fbk":      "flanger feedback — how resonant and metallic the sweep gets",
  "fx.pitchshift":       "dry/wet for the pitch shifter",
  "fx.pitchshift.semi":  "how far the shifted copy is transposed, in semitones",
  "fx.delay":            "how much delay is mixed in",
  "fx.delay.time":       "delay time. Setting it here switches the delay out of tempo sync",
  "fx.delay.fbk":        "how much of the delay is fed back in — how many repeats",
  "fx.reverb":           "how much reverb is mixed in",
  "fx.reverb.decay":     "reverb tail length. Changing it rebuilds the impulse response, so it moves in steps rather than smoothly",

  // Virus envelope sliders (no tooltip in the markup — the four track sliders
  // carry the engine's own tips, these don't).
  "virus.atk": "how long each note takes to reach full level. Past a few percent it stops being a click and starts being a swell",
  "virus.sus": "the level the envelope holds at after the decay, for as long as the note is held",
  "virus.rel": "how long the note takes to fade once it ends",

  // ── controls with no lfo or automation target: keyed by class ──
  // Moog oscillator bank.
  "p-osc1range": "octave for oscillator 1, in organ footages — 32' is two octaves down, 8' is concert pitch, 2' is two up",
  "p-osc2range": "octave for oscillator 2, in organ footages — 32' is two octaves down, 8' is concert pitch, 2' is two up",
  "p-osc3range": "octave for oscillator 3, in organ footages — 32' is two octaves down, 8' is concert pitch, 2' is two up",
  "p-osc1wave":  "waveform for oscillator 1",
  "p-osc2wave":  "waveform for oscillator 2",
  "p-osc3wave":  "waveform for oscillator 3",
  "p-osc2freq":  "oscillator 2's tuning against oscillator 1, ±7 semitones. A little off is what makes the stack move",
  "p-osc3freq":  "oscillator 3's tuning against oscillator 1, ±7 semitones. On the real thing this one is often detuned far enough to beat rather than harmonise",
  "p-noisetype": "noise colour: white is flat across the spectrum, pink falls 3dB an octave and sits behind a mix more easily",
  // Virus filter selects the markup only labels in passing.
  "p-vmode1": "what filter 1 does with the signal — low pass, high pass, band pass or band stop",
  "p-vmode2": "what filter 2 does with the signal — low pass, high pass, band pass or band stop",
  // Filter envelope (env panel). Not modulation targets: they shape the sweep
  // that fires per note rather than being swept themselves.
  "p-envamt": "how far the envelope moves the filter cutoff on each note. At zero the filter sits wherever the cutoff slider is",
  "p-envatk": "how long the filter sweep takes to reach its peak",
  "p-envdec": "how fast it falls from that peak to the sustain level",
  "p-envsus": "the cutoff level the sweep holds at while the note lasts",
  "p-envrel": "how long the cutoff takes to fall back once the note ends",
  // EQ.
  "p-eq-low":  "low shelf at 250Hz, ±18dB — everything below it moves together",
  "p-eq-mid":  "peaking bell at 1.2kHz, ±18dB — where most instruments' body and honk live",
  "p-eq-high": "high shelf at 5kHz, ±18dB — air and cymbal top",
  // Compressor.
  "comp-enabled":    "switches the track compressor in. Off is a straight wire, not a bypassed processor",
  "sq-comp__source": "what the compressor listens to: itself, or another track — pick a track here to duck this one under it (the classic kick-into-bass sidechain)",
  "comp-threshold":  "the level above which the compressor starts working, in dB",
  "comp-ratio":      "how hard it pulls back what crosses the threshold — 4:1 lets a quarter of the excess through, 20:1 is close to a limiter",
  "comp-attack":     "how quickly it clamps down once the signal crosses the threshold. Slow lets the transient through",
  "comp-release":    "how long it takes to let go afterwards. Too fast pumps, too slow stays ducked",
  "comp-knee":       "how gradually the ratio comes in around the threshold — a wide knee is gentler and harder to hear working",
  // FX panel controls with no target.
  "sq-track__glide": "portamento: how long a note takes to slide to the next one. Lives on the voice, not the fx rack",
  "fx-shaper-mode":  "the curve the wave shaper folds the signal through. Saturate and soft clip thicken; fold, wrap and serge break the waveform up into new harmonics",
  "fx-delay-sync":   "locks the delay time to the tempo. The division select beside it takes over from the time slider",
  "fx-delay-div":    "delay time as a division of the tempo, while sync is on",
  // Wavetable editor's wave scan.
  "sq-wt__scan-en":     "auto-cycles the wave knob through the table's frames, so the tone moves without a mod slot",
  "sq-wt__scan-dir":    "which way the scan travels through the frames — up, down, back and forth, or jumping at random",
  "sq-wt__scan-sync":   "locks the scan to the tempo instead of the speed slider",
  "sq-wt__scan-rate":   "how fast the scan travels, in hz, when it isn't tempo-synced",
  "sq-wt__scan-div":    "scan speed as a division of the tempo, while sync is on",
  "sq-wt__scan-retrig": "restarts the sweep from its start position on every note. Off leaves one free-running sweep that each note joins mid-flight",
  // Sample editor.
  "sq-samp__snap":      "quantises the region handles to a musical division as you drag them",
  "sq-samp__fit":       "stretches the sample to fit a number of bars at the current tempo, or plays it at its native speed",
  "sq-samp__pitchlock": "keeps a bpm-fitted sample at its natural pitch whatever note a step plays — timing wins over pitch",
  "sq-samp__loop":      "what a step does when it reaches the end of the region: stop, loop, or bounce back and forth",
  "sq-samp__fadein":    "fade at the start of every hit, in seconds — the cure for a click on an off-zero start point",
  "sq-samp__fadeout":   "fade at the end of every hit, in seconds",
  "sq-slice__on-cb":    "plays one slice per step instead of the whole region — the pads below map to notes from the base note up",
  "sq-slice__n":        "how many equal slices `make` cuts the sample into",
  "sq-slice__sens":     "how much of a transient `detect` needs before it calls it a slice point",
  "sq-slice__base":     "the midi note the first slice sits on; the rest follow upward",
  "sq-slice__mode":     "whether a slice stops at the next slice point or plays on to the end of the sample",
};

/**
 * Mark every one of this track's parameter controls with what is currently
 * moving it, so a glance at the labels says where the movement is without
 * opening a panel: `data-motion="mod"` for an LFO, `"aut"` for a live
 * automation lane, `"off"` for a lane that exists but is switched off. The
 * paint is a dot beside the control's label (see style.css).
 *
 * Driven off the DOM rather than a list of controls because the same parameter
 * appears in more than one place (the granular row and the wav modal both have
 * a speed slider), and both should light up.
 * @param {Track} t
 */
export function refreshParamIndicators(t) {
  if (!t || t.id == null) return;
  for (const root of document.querySelectorAll(`[data-track-id="${t.id}"]`)) {
    for (const el of root.querySelectorAll("input[type=range], select, input[type=checkbox]")) {
      const tg = targetsForControl(el);
      if (!tg) continue;
      const wrap = el.closest(".sq-field, .sq-fx__ctl, .sq-virus__f, label");
      if (!wrap) continue;
      // An LFO config exists for every key whether or not it was ever used, so
      // only `enabled` means anything. A lane is only there if it was added, so
      // a disabled one is worth showing as dimmed rather than hiding.
      const lane = tg.auto ? t.automation?.[tg.auto] : null;
      const motion = (tg.lfo && t.lfoConfig?.[tg.lfo]?.enabled) ? "mod"
                   : lane?.enabled ? "aut"
                   : lane ? "off"
                   : null;
      if (motion) wrap.dataset.motion = motion;
      else delete wrap.dataset.motion;
    }
  }
}

/** The mod/automation targets behind a control element, or null if it has none. */
export function targetsForControl(el) {
  if (!el || !el.classList) return null;
  for (const cls of el.classList) {
    const hit = CONTROL_TARGETS[cls];
    if (hit) return hit;
  }
  return null;
}
