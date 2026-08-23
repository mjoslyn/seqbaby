import { AUTOMATION_KEYS, AUTOMATION_TARGETS, canAutomate } from "./automation.js";
import { engineByKey, loadPatches, populateEngineSelect, savePatch } from "./catalog.js";
import { applyTrackPatch, serializeTrackPatch } from "./session.js";
import { LFO_KEYS, lfoLabel, rateToSlider, sliderToRate } from "./constants.js";
import { showInputDialog, showSavedPatchPicker } from "./dialogs.js";
import { setStatus } from "./dom.js";
import { DX7_ALG_LABELS, DX7_DEFAULTS, DX7_NUM_KEYS, DX7_PRESET_NAMES, DX7_SEL_KEYS, dx7Preset } from "./dx7.js";
import { BASS_DEFAULTS, BASS_NUM_KEYS, BASS_SEL_KEYS, BASS_TONE_NAMES, bassTone, bassToneDescription } from "./bass.js";
import { refreshEuclidUI, renderEuclidPanel, wireEuclidPanel } from "./euclid.js";
import { randomizeMelody, randomizeTimbre } from "./generate.js";
import { GUITAR_DEFAULTS, GUITAR_NUM_KEYS, GUITAR_SEL_KEYS, GUITAR_TONE_NAMES, guitarTone, guitarToneDescription } from "./guitar.js";
import { ICON_CLEAR, ICON_DICE, ICON_EUCLID, ICON_LOAD, ICON_ROLL, ICON_SAVE, ICON_SLIDERS, ICON_WAV } from "./icons.js";
import { upgradeKnobs } from "./knob.js";
import { canModulate, currentBpm, rateFromSync, syncLFO } from "./lfo.js";
import { autoOwns, modOwns, refreshParamIndicators } from "./paramTargets.js";
import { patternLocked, refreshPatternLockUI, refreshPatternSoundUI, setPatternLock } from "./patternSound.js";
import { openGranularSourceModal, openSamplerSourceModal, pickAudioFileForTrack } from "./main.js";
import { defaultFxConfig } from "./fxRack.js";
import { patternMeter, redetectDrumKit, stepsPerBarForMeter } from "./meter.js";
import { refreshDx7Algorithm, setEngineKey, setParam, updateGranularSpeedEnabled, updatePlaitsControlsVisibility } from "./params.js";
import { bestRollViewOct } from "./pianoRoll.js";
import { applyCompressorConfig, refreshCompSourceDropdowns, refreshOutputSelects, setEQ, setFilter, setTrackOutput } from "./signal.js";
import { state } from "./state.js";
import { openAutAsModal, openCompAsModal, openEnvAsModal, openEqAsModal, openFilterAsModal, openFxAsModal, openGranularWavModal, openModAsModal, openEuclidAsModal, openRollAsModal, openSampleEditorModal, openTrackMenu } from "./stepEditor.js";
import { openWavetableEditor } from "./wavetableEditor.js";
import { attachGridInteraction, renderStepGrid } from "./stepGrid.js";
import { duplicateTrack, extendPatternByDuplicate, removeTrack, resizePattern, resizeTrack, shiftTrackOctave, truncatePattern } from "./track.js";
import { VIRUS_NUM_KEYS, VIRUS_SEL_KEYS } from "./virus.js";
import { GRAN_DEFAULTS, GRAN_NUM_KEYS, GRAN_SEL_KEYS } from "./voices.js";


/** @typedef {import("./types.js").Track} Track */
/**
 * Build (or rebuild) a track's full DOM: head controls, synth row, step
 * grid, and the collapsible filter/env/fx/eq/comp/mod panels.
 * @param {Track} t
 */
/**
 * Mark a track as the target for computer-keyboard notes (and highlight it).
 * The highlight only shows while keyboard-notes mode is on (body.kbd-notes-on).
 * @param {Track} t
 */
export function setActiveTrack(t) {
  if (!t) return;
  // An fx bus has no instrument in it, so making it the keyboard's target would
  // just swallow every key. Clicking one leaves the previous track selected.
  if (t.engineKey === "bus") return;
  state.activeTrackId = t.id;
  for (const other of state.tracks) other.el?.classList.toggle("is-kbd-active", other.id === t.id);
}

/**
 * Mute on an fx bus has to cut the audio. Everywhere else mute is the transport
 * withholding triggers, and a bus has none to withhold — it would go on passing
 * the tracks feeding it, untouched.
 * @param {Track} t
 */
export function applyBusMute(t) {
  if (t.voice?.type !== "bus") return;
  t.voice.setMuted?.(!!t.muted);
}

/**
 * Paint the dice button's fill level from the track's density, so the icon
 * shows how full the next roll will be.
 * @param {Track} t
 */
export function paintDiceDensity(t) {
  const btn = t.el?.querySelector(".track-dice");
  if (!btn) return;
  const d = Math.max(0, Math.min(1, t.density ?? 0.5));
  btn.style.setProperty("--dice-level", `${Math.round(d * 100)}%`);
  btn.title = `random pattern — ${Math.round(d * 100)}% dense (drag up/down to set)`;
  btn.setAttribute("aria-valuenow", String(Math.round(d * 100)));
}

// The dice is also the density control: click rolls a new pattern, dragging it
// up/down sets how full that roll comes out (drawn as the fill behind the icon).
// Same drag idiom as the BPM field — a press only becomes a drag past a few
// pixels, so an ordinary click still rolls.
function attachDiceDensity(t, btn) {
  const PX_FULL_TRAVEL = 90;    // px from empty to full
  const PX_THRESH = 4;
  btn.style.touchAction = "none";
  btn.setAttribute("role", "button");
  btn.setAttribute("aria-valuemin", "0");
  btn.setAttribute("aria-valuemax", "100");
  paintDiceDensity(t);
  let drag = null;
  btn.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    drag = { id: e.pointerId, startY: e.clientY, startVal: t.density ?? 0.5, moved: false };
    // Capture straight away: the button is only ~28px tall, so a drag leaves it
    // almost immediately and without capture the moves would go elsewhere.
    try { btn.setPointerCapture(e.pointerId); } catch {}
  });
  btn.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    // Pointer capture retargets every move here until the button is released —
    // and Chrome emits a synthetic move after a scroll. If no button is down,
    // the drag is over (a pointerup we never saw), so drop it.
    if (e.pointerType === "mouse" && e.buttons === 0) { drag = null; return; }
    const dy = e.clientY - drag.startY;
    if (!drag.moved) {
      if (Math.abs(dy) < PX_THRESH) return;
      drag.moved = true;
    }
    t.density = Math.max(0, Math.min(1, drag.startVal - dy / PX_FULL_TRAVEL));
    paintDiceDensity(t);
    e.preventDefault();
  });
  const end = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    try { btn.releasePointerCapture(e.pointerId); } catch {}
    // A drag ends with a click event we don't want to act on — swallow it.
    btn._diceDragged = drag.moved;
    drag = null;
  };
  btn.addEventListener("pointerup", end);
  btn.addEventListener("pointercancel", end);
  btn.addEventListener("lostpointercapture", end);
  // Kept as a click handler so the keyboard (Enter / Space) still rolls.
  btn.addEventListener("click", () => {
    if (btn._diceDragged) { btn._diceDragged = false; return; }
    randomizeMelody(t);
  });
}

/**
 * Write a track's whole sound — every synth param, the filter and its
 * envelope, the eq and the compressor — from the track state back into its
 * controls. For wherever the values changed underneath the sliders rather than
 * because of them: a session load, a patch load, a pattern-locked track
 * recalling a different sound.
 *
 * The fx rack and the mod matrix have their own repaint (refreshFxPanelUI /
 * renderModPanel) because they rebuild rows rather than set values.
 * @param {Track} t
 */
export function syncTrackSoundUI(t) {
  if (!t?.el) return;
  const q = (s) => (t.el.querySelector(s));
  const set = (sel, val) => { const el = q(sel); if (el != null && val != null) el.value = val; };
  set(".p-vol",   t.params.vol);
  set(".p-harm",  t.params.harm);
  set(".p-timb",  t.params.timb);
  set(".p-morph", t.params.morph);
  set(".p-decay", t.params.decay);
  for (const k of ["osc1", "osc2", "osc3", "osc4", "ultra", "fm", "metal",
                   "osc1range", "osc2range", "osc3range",
                   "osc1wave", "osc2wave", "osc3wave",
                   "osc2freq", "osc3freq", "noise", "noisetype",
                   "wave303", "accent303", "tune303",
                   ...GRAN_NUM_KEYS, ...GRAN_SEL_KEYS,
                   ...VIRUS_NUM_KEYS, ...VIRUS_SEL_KEYS,
                   ...DX7_NUM_KEYS, ...DX7_SEL_KEYS,
                   ...GUITAR_NUM_KEYS, ...GUITAR_SEL_KEYS,
                   ...BASS_NUM_KEYS, ...BASS_SEL_KEYS]) {
    const el = q(`.p-${k}`);
    if (el && t.params[k] != null) el.value = t.params[k];
  }
  const gsync = q(".p-gsync");
  if (gsync) gsync.checked = !!t.params.gsync;
  set(".p-cutoff", t.filter.cutoff);
  set(".p-reson",  t.filter.reson);
  set(".p-envamt", t.filter.env);
  set(".p-envatk", t.filter.attack);
  set(".p-envdec", t.filter.decay);
  set(".p-envsus", t.filter.sustain);
  set(".p-envrel", t.filter.release);
  const eqPanel = t._eqPanelEl || q(".sq-track__eq-panel");
  if (eqPanel) {
    eqPanel.querySelector(".p-eq-low").value  = t.eq.low;
    eqPanel.querySelector(".p-eq-mid").value  = t.eq.mid;
    eqPanel.querySelector(".p-eq-high").value = t.eq.high;
  }
  const compPanel = t._compPanelEl || q(".sq-track__comp-panel");
  if (compPanel) {
    compPanel.querySelector(".comp-enabled").checked = !!t.comp.enabled;
    compPanel.querySelector(".comp-threshold").value = t.comp.threshold;
    compPanel.querySelector(".comp-ratio").value     = t.comp.ratio;
    compPanel.querySelector(".comp-attack").value    = t.comp.attack;
    compPanel.querySelector(".comp-release").value   = t.comp.release;
    compPanel.querySelector(".comp-knee").value      = t.comp.knee;
    // The sidechain source belongs here with the rest of the compressor — it is
    // in the p-lock snapshot, so a pattern switch can change it under you. The
    // OPTIONS are refreshCompSourceDropdowns's job (it is the one that knows the
    // track list); this only restores the selection, and skips a value that has
    // no option yet — during a session load the other tracks don't all exist,
    // and that pass runs afterwards.
    const srcSel = compPanel.querySelector(".sq-comp__source");
    const want = String(t.comp.source || "self");
    if (srcSel && [...srcSel.options].some(o => o.value === want)) srcSel.value = want;
  }
  refreshDx7Algorithm(t);
}

/**
 * Push a track's dx7 params back into the panel. Needed wherever the values
 * change underneath the controls rather than because of them — loading a voice,
 * applying a session or a patch. The four track sliders come too: brightness
 * and feedback are part of an FM voice, so a preset sets them.
 * @param {Track} t
 */
export function syncDx7Panel(t) {
  const root = t._dx7GroupEl || t.el?.querySelector(".sq-param-group--dx7");
  if (root) {
    for (const k of [...DX7_NUM_KEYS, ...DX7_SEL_KEYS]) {
      const el = root.querySelector(`.p-${k}`);
      if (el && t.params[k] != null) el.value = t.params[k];
    }
  }
  const timbre = t._timbreGroupEl || t.el;
  for (const k of ["harm", "timb", "morph", "decay"]) {
    const el = timbre?.querySelector(`.p-${k}`);
    if (el && t.params[k] != null) el.value = t.params[k];
  }
  refreshDx7Algorithm(t);
}

/**
 * Push a track's guitar params back into the panel, for wherever they changed
 * underneath the controls rather than because of them — loading a tone, a
 * session, a patch. The four track sliders come too: on a guitar the drive and
 * the sustain are as much part of the sound as the amp is.
 * @param {Track} t
 */
export function syncGuitarPanel(t) {
  const root = t._guitarGroupEl || t.el?.querySelector(".sq-param-group--guitar");
  if (root) {
    for (const k of [...GUITAR_NUM_KEYS, ...GUITAR_SEL_KEYS]) {
      const el = root.querySelector(`.p-${k}`);
      if (el && t.params[k] != null) el.value = t.params[k];
    }
  }
  const timbre = t._timbreGroupEl || t.el;
  for (const k of ["harm", "timb", "morph", "decay"]) {
    const el = timbre?.querySelector(`.p-${k}`);
    if (el && t.params[k] != null) el.value = t.params[k];
  }
}

/**
 * The same, for the bass panel — a tone loads the whole rig, so every control
 * and the four track sliders have to be written back at once.
 * @param {Track} t
 */
export function syncBassPanel(t) {
  const root = t._bassGroupEl || t.el?.querySelector(".sq-param-group--bass");
  if (root) {
    for (const k of [...BASS_NUM_KEYS, ...BASS_SEL_KEYS]) {
      const el = root.querySelector(`.p-${k}`);
      if (el && t.params[k] != null) el.value = t.params[k];
    }
  }
  const timbre = t._timbreGroupEl || t.el;
  for (const k of ["harm", "timb", "morph", "decay"]) {
    const el = timbre?.querySelector(`.p-${k}`);
    if (el && t.params[k] != null) el.value = t.params[k];
  }
}

export function renderTrack(t) {
  const tpl = document.getElementById("track-template");
  const node = tpl.content.firstElementChild.cloneNode(true);
  t.el = node;
  node.dataset.trackId = String(t.id);
  // Clicking anywhere in a track makes it the active target for computer-keyboard
  // notes. Capture phase + no preventDefault so it never interferes with the
  // control the user actually clicked.
  node.addEventListener("pointerdown", () => setActiveTrack(t), true);

  const engineSel = node.querySelector(".sq-track__engine");
  populateEngineSelect(engineSel);
  engineSel.value = t.engineKey;

  node.querySelector(".sq-track__name").value = t.name;
  node.querySelector(".sq-track__len").value = t.length;
  node.querySelector(".p-vol").value = t.params.vol;
  node.querySelector(".p-harm").value = t.params.harm;
  node.querySelector(".p-timb").value = t.params.timb;
  node.querySelector(".p-morph").value = t.params.morph;
  node.querySelector(".p-decay").value = t.params.decay;
  for (const k of ["osc1", "osc2", "osc3", "osc4", "ultra", "fm", "metal",
                   "osc1range", "osc2range", "osc3range",
                   "osc1wave",  "osc2wave",  "osc3wave",
                   "osc2freq",  "osc3freq",  "noise", "noisetype",
                   "wave303",   "accent303", "tune303",
                   ...VIRUS_NUM_KEYS, ...VIRUS_SEL_KEYS]) {
    const el = node.querySelector(`.p-${k}`);
    if (el && t.params[k] != null) el.value = t.params[k];
  }
  // Granular grain-engine controls fall back to GRAN_DEFAULTS when the track has
  // no saved value yet (fresh track or a session predating these params).
  for (const k of [...GRAN_NUM_KEYS, ...GRAN_SEL_KEYS]) {
    const el = node.querySelector(`.p-${k}`);
    if (el) el.value = t.params[k] ?? GRAN_DEFAULTS[k];
  }
  // The dx7's algorithm and voice dropdowns ship empty: their contents live in
  // dx7.js, so the 32 wirings are written down exactly once.
  const algSel = node.querySelector(".p-dalg");
  if (algSel && !algSel.options.length) {
    for (let i = 0; i < DX7_ALG_LABELS.length; i++) {
      const o = document.createElement("option");
      o.value = String(i + 1);
      o.textContent = `${i + 1}   ${DX7_ALG_LABELS[i]}`;
      algSel.appendChild(o);
    }
  }
  const presetSel = node.querySelector(".sq-dx7__preset");
  if (presetSel && !presetSel.options.length) {
    for (const name of ["", ...DX7_PRESET_NAMES]) {
      const o = document.createElement("option");
      o.value = name;
      o.textContent = name || "—";
      presetSel.appendChild(o);
    }
  }
  for (const k of [...DX7_NUM_KEYS, ...DX7_SEL_KEYS]) {
    const el = node.querySelector(`.p-${k}`);
    if (el) el.value = t.params[k] ?? DX7_DEFAULTS[k];
  }
  // The guitar's tone dropdown ships empty for the same reason the dx7's does:
  // the rigs live in guitar.js, and the markup should not be a second copy.
  const toneSel = node.querySelector(".sq-guitar__tone");
  if (toneSel && !toneSel.options.length) {
    for (const name of ["", ...GUITAR_TONE_NAMES]) {
      const o = document.createElement("option");
      o.value = name;
      o.textContent = name || "—";
      o.title = guitarToneDescription(name);
      toneSel.appendChild(o);
    }
  }
  for (const k of [...GUITAR_NUM_KEYS, ...GUITAR_SEL_KEYS]) {
    const el = node.querySelector(`.p-${k}`);
    if (el) el.value = t.params[k] ?? GUITAR_DEFAULTS[k];
  }
  const bassToneSel = node.querySelector(".sq-bass__tone");
  if (bassToneSel && !bassToneSel.options.length) {
    for (const name of ["", ...BASS_TONE_NAMES]) {
      const o = document.createElement("option");
      o.value = name;
      o.textContent = name || "—";
      o.title = bassToneDescription(name);
      bassToneSel.appendChild(o);
    }
  }
  for (const k of [...BASS_NUM_KEYS, ...BASS_SEL_KEYS]) {
    const el = node.querySelector(`.p-${k}`);
    if (el) el.value = t.params[k] ?? BASS_DEFAULTS[k];
  }
  const gsyncEl = node.querySelector(".p-gsync");
  if (gsyncEl) gsyncEl.checked = t.params.gsync ?? GRAN_DEFAULTS.gsync;
  node.querySelector(".p-cutoff").value = t.filter.cutoff;
  node.querySelector(".p-reson").value  = t.filter.reson;
  node.querySelector(".p-envamt").value = t.filter.env;
  node.querySelector(".p-envatk").value = t.filter.attack;
  node.querySelector(".p-envrel").value = t.filter.release;

  node.querySelector(".sq-track__name").addEventListener("input", e => {
    t.name = e.target.value;
    redetectDrumKit(t);
    // This track is listed by name in every other track's out dropdown and
    // sidechain-source dropdown, and named in the "what feeds me" line on a bus.
    refreshOutputSelects();
    refreshCompSourceDropdowns();
  });
  node.querySelector(".sq-track__len").addEventListener("change", e => {
    const n = Math.max(1, Math.min(128, Number(e.target.value) || 1));
    resizeTrack(t, n);
  });
  engineSel.addEventListener("change", e => {
    const val = e.target.value;
    // The sampler needs a source (file or bundled) and the granular engine needs
    // a file: intercept and open the matching picker, only committing the engine
    // change if a source is chosen (revert the dropdown otherwise).
    if (val === "sampler") {
      const prev = t.engineKey;
      openSamplerSourceModal(t).then(ok => { if (!ok) engineSel.value = prev; });
      return;
    }
    if (val === "dm:granular") {
      const prev = t.engineKey;
      openGranularSourceModal(t).then(ok => { if (!ok) engineSel.value = prev; });
      return;
    }
    setEngineKey(t, val);
  });

  const outSel = node.querySelector(".sq-track__out");
  if (outSel) outSel.addEventListener("change", () => setTrackOutput(t, outSel.value));

  node.querySelector(".p-vol").addEventListener("input", e => setParam(t, "vol", Number(e.target.value)));
  node.querySelector(".p-harm").addEventListener("input", e => setParam(t, "harm", Number(e.target.value)));
  node.querySelector(".p-timb").addEventListener("input", e => setParam(t, "timb", Number(e.target.value)));
  node.querySelector(".p-morph").addEventListener("input", e => setParam(t, "morph", Number(e.target.value)));
  node.querySelector(".p-decay").addEventListener("input", e => setParam(t, "decay", Number(e.target.value)));
  for (const k of ["osc1", "osc2", "osc3", "osc4", "ultra", "fm", "metal",
                   "osc2freq", "osc3freq", "noise", "accent303", "tune303",
                   ...VIRUS_NUM_KEYS]) {
    const el = node.querySelector(`.p-${k}`);
    if (el) el.addEventListener("input", e => setParam(t, k, Number(e.target.value)));
  }
  for (const k of ["osc1range", "osc2range", "osc3range"]) {
    const el = node.querySelector(`.p-${k}`);
    if (el) el.addEventListener("change", e => setParam(t, k, Number(e.target.value)));
  }
  for (const k of ["osc1wave", "osc2wave", "osc3wave", "noisetype", "wave303", ...VIRUS_SEL_KEYS]) {
    const el = node.querySelector(`.p-${k}`);
    if (el) el.addEventListener("change", e => setParam(t, k, e.target.value));
  }
  // Granular grain-engine controls: numeric sliders, string selects, sync toggle.
  for (const k of GRAN_NUM_KEYS) {
    const el = node.querySelector(`.p-${k}`);
    if (el) el.addEventListener("input", e => setParam(t, k, Number(e.target.value)));
  }
  for (const k of GRAN_SEL_KEYS) {
    const el = node.querySelector(`.p-${k}`);
    if (el) el.addEventListener("change", e => {
      setParam(t, k, e.target.value);
      if (k === "gplay") updateGranularSpeedEnabled(t);   // speed is moving-only
    });
  }
  const gsyncInput = node.querySelector(".p-gsync");
  if (gsyncInput) gsyncInput.addEventListener("change", e => setParam(t, "gsync", e.target.checked));
  // DX7: 48 operator sliders plus the globals, then the selects — the algorithm
  // redraws the panel's carrier / feedback markers, the rest just set a param.
  for (const k of DX7_NUM_KEYS) {
    const el = node.querySelector(`.p-${k}`);
    if (el) el.addEventListener("input", e => setParam(t, k, Number(e.target.value)));
  }
  for (const k of DX7_SEL_KEYS) {
    const el = node.querySelector(`.p-${k}`);
    if (el) el.addEventListener("change", e => {
      setParam(t, k, e.target.value);
      if (k === "dalg") refreshDx7Algorithm(t);
    });
  }
  // Guitar rig: sliders on input, the amp / cab / pickup / tremolo selects on
  // change, and the tone dropdown loading a whole rig at once.
  for (const k of GUITAR_NUM_KEYS) {
    const el = node.querySelector(`.p-${k}`);
    if (el) el.addEventListener("input", e => setParam(t, k, Number(e.target.value)));
  }
  for (const k of GUITAR_SEL_KEYS) {
    const el = node.querySelector(`.p-${k}`);
    if (el) el.addEventListener("change", e => setParam(t, k, e.target.value));
  }
  if (toneSel) {
    const descEl = node.querySelector(".sq-guitar__desc");
    toneSel.addEventListener("change", e => {
      const name = e.target.value;
      const tone = guitarTone(name);
      if (descEl) descEl.textContent = guitarToneDescription(name);
      if (!tone) return;
      for (const [key, val] of Object.entries(tone)) setParam(t, key, val);
      syncGuitarPanel(t);
      refreshParamIndicators(t);
      setStatus(`guitar tone "${name}" — ${guitarToneDescription(name)}`);
    });
  }
  // Bass rig: the same three groups again.
  for (const k of BASS_NUM_KEYS) {
    const el = node.querySelector(`.p-${k}`);
    if (el) el.addEventListener("input", e => setParam(t, k, Number(e.target.value)));
  }
  for (const k of BASS_SEL_KEYS) {
    const el = node.querySelector(`.p-${k}`);
    if (el) el.addEventListener("change", e => setParam(t, k, e.target.value));
  }
  if (bassToneSel) {
    const descEl = node.querySelector(".sq-bass__desc");
    bassToneSel.addEventListener("change", e => {
      const name = e.target.value;
      const tone = bassTone(name);
      if (descEl) descEl.textContent = bassToneDescription(name);
      if (!tone) return;
      for (const [key, val] of Object.entries(tone)) setParam(t, key, val);
      syncBassPanel(t);
      refreshParamIndicators(t);
      setStatus(`bass tone "${name}" — ${bassToneDescription(name)}`);
    });
  }
  // Loading a voice writes every panel control at once — the operators, the
  // algorithm, and the four track sliders, which are as much part of an FM
  // patch as the operators are.
  if (presetSel) {
    presetSel.addEventListener("change", e => {
      const preset = dx7Preset(e.target.value);
      if (!preset) return;
      for (const [key, val] of Object.entries(preset)) setParam(t, key, val);
      syncDx7Panel(t);
      setStatus(`dx7 voice "${e.target.value}"`);
    });
  }
  // Header wave/sample icon (between engine dropdown + save): opens the granular
  // visualizer for the granular engine, else the sampler's sample/slice editor.
  // Visibility is toggled per engine in updatePlaitsControlsVisibility.
  const wavBtn = node.querySelector(".sq-track__wav");
  if (wavBtn) {
    wavBtn.innerHTML = ICON_WAV;
    wavBtn.addEventListener("click", () => {
      if (t.engineKey === "dm:granular") openGranularWavModal(t);
      else if (t.engineKey === "sampler") openSampleEditorModal(t);
      else if (t.engineKey === "wt:akwf") openWavetableEditor(t);
    });
  }
  node.querySelector(".p-cutoff").addEventListener("input", e => setFilter(t, "cutoff", Number(e.target.value)));
  node.querySelector(".p-reson").addEventListener("input",  e => setFilter(t, "reson",  Number(e.target.value)));
  node.querySelector(".p-envamt").addEventListener("input", e => setFilter(t, "env",     Number(e.target.value)));
  node.querySelector(".p-envatk").addEventListener("input", e => setFilter(t, "attack",  Number(e.target.value)));
  node.querySelector(".p-envrel").addEventListener("input", e => setFilter(t, "release", Number(e.target.value)));

  node.querySelector(".track-rand").addEventListener("click", () => randomizeTimbre(t));

  const saveBtn = node.querySelector(".sq-track__save");
  saveBtn.innerHTML = ICON_SAVE;
  // Any track's sound can be saved as a patch now (engine + params + fx + audio).
  const refreshSaveEnabled = () => { saveBtn.disabled = false; };
  refreshSaveEnabled();
  saveBtn.addEventListener("click", async () => {
    const suggested = t.soundPromptText ? t.soundPromptText.split(/[.,;]/)[0].slice(0, 40) : t.name;
    const name = await showInputDialog({
      title: "save patch as",
      defaultValue: suggested,
      placeholder: "my-patch-name",
    });
    if (!name || !name.trim()) return;
    savePatch(name.trim(), serializeTrackPatch(t));
    setStatus(`saved patch "${name.trim()}"`);
  });

  const loadPatchBtn = node.querySelector(".sq-track__load-patch");
  if (loadPatchBtn) {
    loadPatchBtn.innerHTML = ICON_LOAD;
    loadPatchBtn.addEventListener("click", async () => {
      const name = await showSavedPatchPicker();
      if (!name) return;
      const patch = loadPatches()[name];
      if (!patch) return;
      if (patch._kind === "track-patch") {
        applyTrackPatch(t, patch);
      } else {
        // legacy custom-Tone patch: load it as a saved engine
        setEngineKey(t, `saved:${name}`);
        if (node.querySelector(".sq-track__engine")) node.querySelector(".sq-track__engine").value = `saved:${name}`;
      }
      setStatus(`loaded patch "${name}"`);
    });
  }
  // glide + swing are wired in renderModPanel (they live in the mod panel row now).
  const speedSel = node.querySelector(".sq-track__speed");
  if (speedSel) {
    speedSel.value = String(t.speed ?? 1);
    speedSel.addEventListener("change", e => {
      t.speed = Number(e.target.value) || 1;
      t.speedAccum = 0;
    });
  }
  // density slider is rendered inside the mod panel alongside glide + swing

  const octDownBtn = node.querySelector(".track-oct-down");
  const octUpBtn   = node.querySelector(".track-oct-up");
  if (octDownBtn) octDownBtn.addEventListener("click", () => shiftTrackOctave(t, -12));
  if (octUpBtn)   octUpBtn.addEventListener("click",   () => shiftTrackOctave(t, +12));
  const semiDownBtn = node.querySelector(".track-semi-down");
  const semiUpBtn   = node.querySelector(".track-semi-up");
  if (semiDownBtn) semiDownBtn.addEventListener("click", () => shiftTrackOctave(t, -1));
  if (semiUpBtn)   semiUpBtn.addEventListener("click",   () => shiftTrackOctave(t, +1));

  node.querySelector(".track-len-plus1")?.addEventListener("click", () => {
    const spb = stepsPerBarForMeter(patternMeter(state.activePattern));
    resizePattern(t, state.activePattern, t.length + spb);
  });
  node.querySelector(".track-len-2x")?.addEventListener("click", () => {
    extendPatternByDuplicate(t, state.activePattern, t.length * 2);
  });
  node.querySelector(".track-len-4x")?.addEventListener("click", () => {
    extendPatternByDuplicate(t, state.activePattern, t.length * 4);
  });
  node.querySelector(".track-len-half")?.addEventListener("click", () => {
    truncatePattern(t, state.activePattern, Math.max(1, Math.floor(t.length / 2)));
  });
  node.querySelector(".track-len-quarter")?.addEventListener("click", () => {
    truncatePattern(t, state.activePattern, Math.max(1, Math.floor(t.length / 4)));
  });

  const soloBtn = node.querySelector(".sq-track__solo");
  soloBtn.addEventListener("click", () => {
    t.soloed = !t.soloed;
    soloBtn.setAttribute("aria-pressed", String(t.soloed));
    node.classList.toggle("is-soloed", t.soloed);
  });

  // p-lock: this track's sound becomes part of THIS pattern (patternSound.js).
  // The state belongs to the pattern, so the button is repainted on every
  // pattern switch as well as here.
  const plockBtn = node.querySelector(".sq-track__plock");
  if (plockBtn) {
    refreshPatternLockUI(t);
    plockBtn.addEventListener("click", () => {
      const idx = state.activePattern;
      const on = !patternLocked(t, idx);
      if (setPatternLock(t, idx, on)) refreshPatternSoundUI(t);
      setStatus(on
        ? `"${t.name}" locked to pattern ${idx + 1} — its sound lives here now`
        : `"${t.name}" unlocked on pattern ${idx + 1} — back to the track's sound`);
    });
  }

  engineSel.addEventListener("change", () => refreshSaveEnabled());
  // also update save button when customConfig is assigned later — keep a ref on track
  t._refreshSaveEnabled = refreshSaveEnabled;

  const panelModals = [
    { btnSel: ".sq-track__mod",    modalKey: "_modModal" },
    { btnSel: ".track-aut",    modalKey: "_autModal" },
    { btnSel: ".sq-track__roll",   modalKey: "_rollModal" },
    { btnSel: ".sq-track__filter", modalKey: "_filterModal" },
    { btnSel: ".sq-track__env",    modalKey: "_envModal" },
    { btnSel: ".sq-track__fx",     modalKey: "_fxModal" },
    { btnSel: ".sq-track__eq",     modalKey: "_eqModal" },
    { btnSel: ".sq-track__comp",   modalKey: "_compModal" },
  ];
  function closeOtherPanels(keepBtnSel) {
    for (const p of panelModals) {
      if (p.btnSel === keepBtnSel) continue;
      if (t[p.modalKey]) t[p.modalKey].close();
    }
  }

  // Stash stable refs to every collapsible panel — once opened as a modal the
  // panel is reparented out of the track, so t.el.querySelector(...) would
  // miss it. All panels open as a centered modal overlay.
  t._modPanelEl    = node.querySelector(".sq-track__mod-panel");
  t._autPanelEl    = node.querySelector(".sq-track__aut-panel");
  t._rollPanelEl   = node.querySelector(".sq-track__roll-panel");
  t._filterPanelEl = node.querySelector(".sq-track__filter-panel");
  t._envPanelEl    = node.querySelector(".sq-track__env-panel");
  t._fxPanelEl     = node.querySelector(".sq-track__fx-panel");
  t._eqPanelEl     = node.querySelector(".sq-track__eq-panel");
  t._compPanelEl   = node.querySelector(".sq-track__comp-panel");
  t._euclidPanelEl = node.querySelector(".sq-track__euclid-panel");
  t._modModal    = null;
  t._autModal    = null;
  t._rollModal   = null;
  t._filterModal = null;
  t._envModal    = null;
  t._fxModal     = null;
  t._eqModal     = null;
  t._compModal   = null;
  t._euclidModal = null;

  // Same idea for the synth-row sub-groups — they're reparented into the
  // track-menu-modal on mobile, so updatePlaitsControlsVisibility queries
  // these stashed refs instead of t.el.querySelector.
  t._timbreGroupEl  = node.querySelector(".sq-param-group--timbre");
  t._oscMixGroupEl  = node.querySelector(".sq-param-group--osc-mix");
  t._oscModGroupEl  = node.querySelector(".sq-param-group--osc-mod");
  t._moogOscGroupEl = node.querySelector(".sq-param-group--moog");
  t._tb303GroupEl   = node.querySelector(".sq-param-group--tb303");
  t._virusGroupEl   = node.querySelector(".sq-param-group--virus");
  t._dx7GroupEl     = node.querySelector(".sq-param-group--dx7");
  t._guitarGroupEl  = node.querySelector(".sq-param-group--guitar");
  t._bassGroupEl    = node.querySelector(".sq-param-group--bass");
  t._granGroupEl    = node.querySelector(".sq-param-group--granular");

  // Everything above can be reparented out of the track (panels into their
  // modals, the synth groups into the mobile track menu), and the right-click
  // parameter menu resolves a control's track by walking up to a track id —
  // so stamp each one rather than relying on the track node being an ancestor.
  for (const el of [t._modPanelEl, t._autPanelEl, t._rollPanelEl, t._filterPanelEl,
                    t._envPanelEl, t._fxPanelEl, t._eqPanelEl, t._compPanelEl,
                    t._euclidPanelEl,
                    t._timbreGroupEl, t._oscMixGroupEl, t._oscModGroupEl,
                    t._moogOscGroupEl, t._tb303GroupEl, t._virusGroupEl,
                    t._dx7GroupEl, t._guitarGroupEl, t._bassGroupEl, t._granGroupEl]) {
    if (el) el.dataset.trackId = String(t.id);
  }

  renderModPanel(t, t._modPanelEl);
  wireFxPanel(t, t._fxPanelEl);
  const eqPanel = t._eqPanelEl;
  eqPanel.querySelector(".p-eq-low").value  = t.eq.low;
  eqPanel.querySelector(".p-eq-mid").value  = t.eq.mid;
  eqPanel.querySelector(".p-eq-high").value = t.eq.high;
  eqPanel.querySelector(".p-eq-low").addEventListener("input",  e => setEQ(t, "low",  Number(e.target.value)));
  eqPanel.querySelector(".p-eq-mid").addEventListener("input",  e => setEQ(t, "mid",  Number(e.target.value)));
  eqPanel.querySelector(".p-eq-high").addEventListener("input", e => setEQ(t, "high", Number(e.target.value)));

  const bindModalOpen = (btnSel, openFn, modalKey, beforeOpen) => {
    const btn = node.querySelector(btnSel);
    btn.addEventListener("click", () => {
      if (t[modalKey]) { t[modalKey].close(); return; }
      closeOtherPanels(btnSel);
      if (beforeOpen) beforeOpen();
      openFn(t);
      btn.setAttribute("aria-pressed", "true");
    });
  };
  bindModalOpen(".sq-track__mod",    openModAsModal,    "_modModal");
  bindModalOpen(".track-aut",    openAutAsModal,    "_autModal");
  bindModalOpen(".sq-track__roll",   openRollAsModal,   "_rollModal", () => {
    if (t.steps.some(s => s)) t.rollViewOct = bestRollViewOct(t);
  });
  bindModalOpen(".sq-track__filter", openFilterAsModal, "_filterModal");
  bindModalOpen(".sq-track__env",    openEnvAsModal,    "_envModal");
  bindModalOpen(".sq-track__fx",     openFxAsModal,     "_fxModal");
  bindModalOpen(".sq-track__eq",     openEqAsModal,     "_eqModal");
  bindModalOpen(".sq-track__comp",   openCompAsModal,   "_compModal");
  bindModalOpen(".track-euclid",     openEuclidAsModal, "_euclidModal");
  wireCompPanel(t, t._compPanelEl);

  node.querySelector(".sq-track__mute").addEventListener("click", () => {
    t.muted = !t.muted;
    node.classList.toggle("is-muted", t.muted);
    applyBusMute(t);
  });
  // clear: icon + label — desktop shows the label, mobile the icon (same
  // flip as roll, see the mobile media block)
  const clearBtn = node.querySelector(".sq-track__clear");
  clearBtn.innerHTML = `${ICON_CLEAR}<span class="sq-btn__label">clear</span>`;
  clearBtn.addEventListener("click", () => {
    t.steps.fill(0);
    t.lengths.fill(0);
    t.notes.fill(null);
    t.velocities.fill(0.5);
    t.chords.fill("");
    renderStepGrid(t);
  });
  const diceBtn = node.querySelector(".track-dice");
  if (diceBtn) {
    diceBtn.innerHTML = ICON_DICE;
    attachDiceDensity(t, diceBtn);
  }
  // The other generator, beside the dice: the dice rolls, this one divides.
  const euclidBtn = node.querySelector(".track-euclid");
  if (euclidBtn) euclidBtn.innerHTML = ICON_EUCLID;
  // roll: icon + label — desktop shows the label (matches its text siblings),
  // mobile shows the icon (see the roll rules in the mobile media block)
  const rollBtn = node.querySelector(".sq-track__roll");
  if (rollBtn) rollBtn.innerHTML = `${ICON_ROLL}<span class="sq-btn__label">roll</span>`;
  node.querySelector(".sq-track__remove").addEventListener("click", () => removeTrack(t));
  const dupBtn = node.querySelector(".sq-track__dup");
  if (dupBtn) dupBtn.addEventListener("click", () => duplicateTrack(t));

  // mobile: "more" toggle button opens a modal hosting the hidden track-head
  // extras (save/load patch, len-extend, oct/semi, synth params, dup, remove).
  const moreBtn = document.createElement("button");
  moreBtn.type = "button";
  moreBtn.className = "sq-track__more sq-icon-btn sq-btn--ghost sq-mobile-only";
  moreBtn.setAttribute("aria-pressed", "false");
  moreBtn.setAttribute("aria-label", "show more track controls");
  moreBtn.title = "more";
  moreBtn.innerHTML = ICON_SLIDERS;
  moreBtn.addEventListener("click", () => {
    if (t._trackMenuModal) { t._trackMenuModal.close(); return; }
    openTrackMenu(t);
  });
  const panelGrp = node.querySelector(".sq-panel__btn-group");
  if (panelGrp) panelGrp.before(moreBtn);
  t._trackMoreBtn = moreBtn;
  t._trackMenuModal = null;

  // midi-specific controls
  const midiSel = node.querySelector(".midi-out");
  const midiCh = node.querySelector(".midi-ch");
  midiSel.addEventListener("change", () => {
    t.midi.outputId = midiSel.value;
    if (t.voice?.type === "midi") {
      const out = state.midi?.outputs.get(midiSel.value) || null;
      t.voice.setOutput(out);
    }
  });
  midiCh.addEventListener("change", () => {
    const ch = Math.max(1, Math.min(16, Number(midiCh.value) || 1));
    midiCh.value = ch;
    t.midi.channel = ch;
    if (t.voice?.type === "midi") t.voice.setChannel(ch);
  });

  attachGridInteraction(t, node.querySelector(".sq-steps"));
  renderStepGrid(t);
  document.getElementById("tracks").appendChild(node);
  // After the subtree is in the document: the knob measures nothing at upgrade
  // time, but the readout positions against a laid-out box, and the panels
  // below are all built by now.
  upgradeKnobs(node);
  updateMidiUI(t);
  updatePlaitsControlsVisibility(t);
  // The euclid panel wires once here rather than on open: its three counts are
  // ordinary parameters, so they have to exist in the track's DOM for the
  // parameter menu, the mod/aut dots and the macro pads to find them whether
  // or not the panel has ever been looked at.
  wireEuclidPanel(t, t._euclidPanelEl);
  renderEuclidPanel(t, t._euclidPanelEl);
  refreshEuclidUI(t);
  refreshParamIndicators(t);
}

export function updateMidiUI(t) {
  const row = t.el?.querySelector(".sq-track__midi");
  if (!row) return;
  const isMidi = engineByKey(t.engineKey)?.type === "midi";
  row.hidden = !isMidi;
  if (!isMidi) return;
  const sel = row.querySelector(".midi-out");
  const cur = t.midi.outputId || "";
  sel.replaceChildren();
  const none = document.createElement("option");
  none.value = ""; none.textContent = "— no device —";
  sel.appendChild(none);
  if (state.midi) {
    for (const [id, out] of state.midi.outputs) {
      const opt = document.createElement("option");
      opt.value = id; opt.textContent = out.name || id;
      sel.appendChild(opt);
    }
  }
  sel.value = cur;
  row.querySelector(".midi-ch").value = t.midi.channel;
}

export function wireCompPanel(t, panel) {
  const q = s => panel.querySelector(s);
  const en = q(".comp-enabled");
  const src = q(".sq-comp__source");
  const thr = q(".comp-threshold");
  const ratio = q(".comp-ratio");
  const atk = q(".comp-attack");
  const rel = q(".comp-release");
  const knee = q(".comp-knee");
  en.checked = !!t.comp.enabled;
  thr.value = t.comp.threshold;
  ratio.value = t.comp.ratio;
  atk.value = t.comp.attack;
  rel.value = t.comp.release;
  knee.value = t.comp.knee;
  const apply = () => {
    t.comp.enabled   = en.checked;
    t.comp.source    = src.value || "self";
    t.comp.threshold = Number(thr.value);
    t.comp.ratio     = Number(ratio.value);
    t.comp.attack    = Number(atk.value);
    t.comp.release   = Number(rel.value);
    t.comp.knee      = Number(knee.value);
    applyCompressorConfig(t);
  };
  en.addEventListener("change", apply);
  src.addEventListener("change", apply);
  for (const c of [thr, ratio, atk, rel, knee]) c.addEventListener("input", apply);
}

export function applyFxToTrack(t, fx) {
  if (!fx || typeof fx !== "object") return;
  const cfg = t.fxConfig;
  if (!cfg.amp)        cfg.amp        = { preamp: 0.5, level: 0.5 };
  if (!cfg.vinyl)      cfg.vinyl      = { amount: 0, warmth: 0.4, wow: 0.3 };
  if (!cfg.cassette)   cfg.cassette   = { amount: 0, flutter: 0.3, sat: 0.4 };
  if (!cfg.chorus)     cfg.chorus     = { wet: 0, rate: 0.5, depth: 0.5 };
  if (!cfg.ringmod)    cfg.ringmod    = { wet: 0, freq: 0.35 };
  if (!cfg.autowah)    cfg.autowah    = { wet: 0, sens: 0.5, range: 0.5 };
  if (!cfg.phaser)     cfg.phaser     = { wet: 0, rate: 0.3, depth: 0.5 };
  if (!cfg.flanger)    cfg.flanger    = { wet: 0, rate: 0.3, fbk: 0.5 };
  if (!cfg.pitchshift) cfg.pitchshift = { wet: 0, semitones: 0 };
  const readUnit = (group, keys) => {
    if (!fx[group] || typeof fx[group] !== "object") return;
    for (const k of keys) {
      const v = Number(fx[group][k]);
      if (Number.isFinite(v)) cfg[group][k] = Math.max(0, Math.min(1, v));
    }
  };
  readUnit("vinyl",    ["amount","warmth","wow"]);
  readUnit("cassette", ["amount","flutter","sat"]);
  readUnit("fuzz",     ["amount","drive","tone","level"]);
  readUnit("ringmod",  ["wet","freq"]);
  readUnit("autowah",  ["wet","sens","range"]);
  readUnit("chorus",   ["wet","rate","depth"]);
  readUnit("phaser",   ["wet","rate","depth"]);
  readUnit("flanger",  ["wet","rate","fbk"]);
  if (fx.pitchshift && typeof fx.pitchshift === "object") {
    const w = Number(fx.pitchshift.wet);       if (Number.isFinite(w)) cfg.pitchshift.wet       = Math.max(0, Math.min(1, w));
    const s = Number(fx.pitchshift.semitones); if (Number.isFinite(s)) cfg.pitchshift.semitones = Math.max(-24, Math.min(24, Math.round(s)));
  }
  if (fx.delay && typeof fx.delay === "object") {
    if (typeof fx.delay.sync === "boolean") cfg.delay.sync = fx.delay.sync;
    const div = Number(fx.delay.div);  if (Number.isFinite(div)) cfg.delay.div  = div;
    const time = Number(fx.delay.time);if (Number.isFinite(time)) cfg.delay.time = Math.max(0.02, Math.min(2, time));
    const fbk = Number(fx.delay.fbk);  if (Number.isFinite(fbk))  cfg.delay.fbk  = Math.max(0, Math.min(0.95, fbk));
    const wet = Number(fx.delay.wet);  if (Number.isFinite(wet))  cfg.delay.wet  = Math.max(0, Math.min(1, wet));
  }
  if (fx.reverb && typeof fx.reverb === "object") {
    const decay = Number(fx.reverb.decay); if (Number.isFinite(decay)) cfg.reverb.decay = Math.max(0.2, Math.min(10, decay));
    const wet   = Number(fx.reverb.wet);   if (Number.isFinite(wet))   cfg.reverb.wet   = Math.max(0, Math.min(1, wet));
  }
  if (fx.crush && typeof fx.crush === "object") {
    if (!cfg.crush) cfg.crush = { bits: 8, wet: 0 };
    const bits = Number(fx.crush.bits); if (Number.isFinite(bits)) cfg.crush.bits = Math.max(1, Math.min(16, Math.round(bits)));
    const wet  = Number(fx.crush.wet);  if (Number.isFinite(wet))  cfg.crush.wet  = Math.max(0, Math.min(1, wet));
  }
  if (t.fxRack) {
    t.fxRack.applyAmp(cfg.amp);
    t.fxRack.applyVinyl(cfg.vinyl);
    t.fxRack.applyCassette(cfg.cassette);
    t.fxRack.applyFuzz(cfg.fuzz);
    t.fxRack.applyRingMod(cfg.ringmod);
    t.fxRack.applyWaveShaper(cfg.shaper || { wet: 0, amount: 0.5 });
    t.fxRack.applyCrush(cfg.crush || { bits: 8, wet: 0 });
    t.fxRack.applyAutoWah(cfg.autowah);
    t.fxRack.applyChorus(cfg.chorus);
    t.fxRack.applyPhaser(cfg.phaser);
    t.fxRack.applyFlanger(cfg.flanger);
    t.fxRack.applyPitchShift(cfg.pitchshift);
    t.fxRack.applyDelay(cfg.delay);
    t.fxRack.applyReverb(cfg.reverb);
  }
  refreshFxPanelUI(t);
}

export function refreshFxPanelUI(t) {
  if (!t.el) return;
  const panel = t._fxPanelEl || t.el.querySelector(".sq-track__fx-panel");
  if (!panel) return;
  const cfg = t.fxConfig;
  if (!cfg.amp)        cfg.amp        = { preamp: 0.5, level: 0.5 };
  if (!cfg.vinyl)      cfg.vinyl      = { amount: 0, warmth: 0.4, wow: 0.3 };
  if (!cfg.cassette)   cfg.cassette   = { amount: 0, flutter: 0.3, sat: 0.4 };
  if (!cfg.chorus)     cfg.chorus     = { wet: 0, rate: 0.5, depth: 0.5 };
  if (!cfg.ringmod)    cfg.ringmod    = { wet: 0, freq: 0.35 };
  if (!cfg.autowah)    cfg.autowah    = { wet: 0, sens: 0.5, range: 0.5 };
  if (!cfg.phaser)     cfg.phaser     = { wet: 0, rate: 0.3, depth: 0.5 };
  if (!cfg.flanger)    cfg.flanger    = { wet: 0, rate: 0.3, fbk: 0.5 };
  if (!cfg.pitchshift) cfg.pitchshift = { wet: 0, semitones: 0 };
  if (!cfg.shaper)     cfg.shaper     = { wet: 0, preamp: 0.5, amount: 0.5, mode: "fold" };
  if (!cfg.shaper.mode) cfg.shaper.mode = "fold";
  if (cfg.shaper.preamp == null) cfg.shaper.preamp = 0.5;
  const q = s => panel.querySelector(s);
  const set = (sel, v) => { const el = q(sel); if (el != null && v != null) el.value = v; };
  set(".sq-track__glide",    t.glide ?? 0);
  set(".fx-amp-preamp",      cfg.amp.preamp);
  set(".fx-amp-level",       cfg.amp.level);
  set(".fx-vinyl-amount",    cfg.vinyl.amount);
  set(".fx-vinyl-warmth",    cfg.vinyl.warmth);
  set(".fx-vinyl-wow",       cfg.vinyl.wow);
  set(".fx-cassette-amount", cfg.cassette.amount);
  set(".fx-cassette-flutter",cfg.cassette.flutter);
  set(".fx-cassette-sat",    cfg.cassette.sat);
  q(".fx-fuzz-amount").value = cfg.fuzz.amount;
  q(".fx-fuzz-drive").value  = cfg.fuzz.drive;
  q(".fx-fuzz-tone").value   = cfg.fuzz.tone;
  q(".fx-fuzz-level").value  = cfg.fuzz.level;
  set(".fx-ringmod-wet",      cfg.ringmod.wet);
  set(".fx-ringmod-freq",     cfg.ringmod.freq);
  set(".fx-shaper-wet",       cfg.shaper.wet);
  set(".fx-shaper-preamp",    cfg.shaper.preamp);
  set(".fx-shaper-amt",       cfg.shaper.amount);
  set(".fx-shaper-mode",      cfg.shaper.mode);
  set(".fx-autowah-wet",      cfg.autowah.wet);
  set(".fx-autowah-sens",     cfg.autowah.sens);
  set(".fx-autowah-range",    cfg.autowah.range);
  set(".fx-chorus-wet",       cfg.chorus.wet);
  set(".fx-chorus-rate",      cfg.chorus.rate);
  set(".fx-chorus-depth",     cfg.chorus.depth);
  set(".fx-phaser-wet",       cfg.phaser.wet);
  set(".fx-phaser-rate",      cfg.phaser.rate);
  set(".fx-phaser-depth",     cfg.phaser.depth);
  set(".fx-flanger-wet",      cfg.flanger.wet);
  set(".fx-flanger-rate",     cfg.flanger.rate);
  set(".fx-flanger-fbk",      cfg.flanger.fbk);
  set(".fx-pitchshift-wet",   cfg.pitchshift.wet);
  set(".fx-pitchshift-semi",  cfg.pitchshift.semitones);
  q(".fx-delay-time").value  = cfg.delay.time;
  q(".fx-delay-fbk").value   = cfg.delay.fbk;
  q(".fx-delay-wet").value   = cfg.delay.wet;
  q(".fx-delay-sync").checked = !!cfg.delay.sync;
  q(".fx-delay-div").value   = String(cfg.delay.div);
  q(".fx-reverb-decay").value = cfg.reverb.decay;
  q(".fx-reverb-wet").value   = cfg.reverb.wet;
  if (cfg.crush) {
    const b = q(".fx-crush-bits"); if (b) b.value = cfg.crush.bits;
    const w = q(".fx-crush-wet");  if (w) w.value = cfg.crush.wet;
  }
}

export function wireFxPanel(t, panel) {
  const q = (sel) => panel.querySelector(sel);
  const fc = t.fxConfig;
  if (!fc.amp)        fc.amp        = { preamp: 0.5, level: 0.5 };
  if (!fc.crush)      fc.crush      = { bits: 8, wet: 0 };
  if (!fc.vinyl)      fc.vinyl      = { amount: 0, warmth: 0.4, wow: 0.3 };
  if (!fc.cassette)   fc.cassette   = { amount: 0, flutter: 0.3, sat: 0.4 };
  if (!fc.chorus)     fc.chorus     = { wet: 0, rate: 0.5, depth: 0.5 };
  if (!fc.ringmod)    fc.ringmod    = { wet: 0, freq: 0.35 };
  if (!fc.autowah)    fc.autowah    = { wet: 0, sens: 0.5, range: 0.5 };
  if (!fc.phaser)     fc.phaser     = { wet: 0, rate: 0.3, depth: 0.5 };
  if (!fc.flanger)    fc.flanger    = { wet: 0, rate: 0.3, fbk: 0.5 };
  if (!fc.pitchshift) fc.pitchshift = { wet: 0, semitones: 0 };
  if (!fc.shaper)     fc.shaper     = { wet: 0, preamp: 0.5, amount: 0.5, mode: "fold" };
  if (!fc.shaper.mode) fc.shaper.mode = "fold";
  if (fc.shaper.preamp == null) fc.shaper.preamp = 0.5;
  const set = (sel, v) => { const el = q(sel); if (el != null && v != null) el.value = v; };
  // Portamento. Not an fx-rack effect (it lives on the voice, as t.glide), but it
  // belongs with the per-track sound controls rather than buried in the mod panel.
  set(".sq-track__glide", t.glide ?? 0);
  { const g = q(".sq-track__glide"); if (g) g.addEventListener("input", e => {
      t.glide = Number(e.target.value);
      if (t.voice?.setGlide) t.voice.setGlide(t.glide);
    });
  }
  set(".fx-amp-preamp",      fc.amp.preamp);
  set(".fx-amp-level",       fc.amp.level);
  set(".fx-vinyl-amount",    fc.vinyl.amount);
  set(".fx-vinyl-warmth",    fc.vinyl.warmth);
  set(".fx-vinyl-wow",       fc.vinyl.wow);
  set(".fx-cassette-amount", fc.cassette.amount);
  set(".fx-cassette-flutter",fc.cassette.flutter);
  set(".fx-cassette-sat",    fc.cassette.sat);
  q(".fx-fuzz-amount").value = fc.fuzz.amount;
  q(".fx-fuzz-drive").value  = fc.fuzz.drive;
  q(".fx-fuzz-tone").value   = fc.fuzz.tone;
  q(".fx-fuzz-level").value  = fc.fuzz.level;
  set(".fx-ringmod-wet",      fc.ringmod.wet);
  set(".fx-ringmod-freq",     fc.ringmod.freq);
  set(".fx-shaper-wet",       fc.shaper.wet);
  set(".fx-shaper-preamp",    fc.shaper.preamp);
  set(".fx-shaper-amt",       fc.shaper.amount);
  set(".fx-shaper-mode",      fc.shaper.mode);
  set(".fx-autowah-wet",      fc.autowah.wet);
  set(".fx-autowah-sens",     fc.autowah.sens);
  set(".fx-autowah-range",    fc.autowah.range);
  set(".fx-chorus-wet",       fc.chorus.wet);
  set(".fx-chorus-rate",      fc.chorus.rate);
  set(".fx-chorus-depth",     fc.chorus.depth);
  set(".fx-phaser-wet",       fc.phaser.wet);
  set(".fx-phaser-rate",      fc.phaser.rate);
  set(".fx-phaser-depth",     fc.phaser.depth);
  set(".fx-flanger-wet",      fc.flanger.wet);
  set(".fx-flanger-rate",     fc.flanger.rate);
  set(".fx-flanger-fbk",      fc.flanger.fbk);
  set(".fx-pitchshift-wet",   fc.pitchshift.wet);
  set(".fx-pitchshift-semi",  fc.pitchshift.semitones);
  q(".fx-delay-time").value  = fc.delay.time;
  q(".fx-delay-fbk").value   = fc.delay.fbk;
  q(".fx-delay-wet").value   = fc.delay.wet;
  q(".fx-delay-sync").checked = !!fc.delay.sync;
  q(".fx-delay-div").value   = String(fc.delay.div);
  q(".fx-reverb-decay").value = fc.reverb.decay;
  q(".fx-reverb-wet").value   = fc.reverb.wet;
  { const b = q(".fx-crush-bits"); if (b) b.value = fc.crush.bits; }
  { const w = q(".fx-crush-wet");  if (w) w.value = fc.crush.wet; }

  const applyAmp = () => {
    fc.amp.preamp = Number(q(".fx-amp-preamp").value);
    fc.amp.level  = Number(q(".fx-amp-level").value);
    t.fxRack?.applyAmp(fc.amp);
  };
  const applyVinyl = () => {
    fc.vinyl.amount = Number(q(".fx-vinyl-amount").value);
    fc.vinyl.warmth = Number(q(".fx-vinyl-warmth").value);
    fc.vinyl.wow    = Number(q(".fx-vinyl-wow").value);
    t.fxRack?.applyVinyl(fc.vinyl);
  };
  const applyCassette = () => {
    fc.cassette.amount  = Number(q(".fx-cassette-amount").value);
    fc.cassette.flutter = Number(q(".fx-cassette-flutter").value);
    fc.cassette.sat     = Number(q(".fx-cassette-sat").value);
    t.fxRack?.applyCassette(fc.cassette);
  };
  const applyFuzz = () => {
    fc.fuzz.amount = Number(q(".fx-fuzz-amount").value);
    fc.fuzz.drive  = Number(q(".fx-fuzz-drive").value);
    fc.fuzz.tone   = Number(q(".fx-fuzz-tone").value);
    fc.fuzz.level  = Number(q(".fx-fuzz-level").value);
    t.fxRack?.applyFuzz(fc.fuzz);
  };
  const applyRingMod = () => {
    fc.ringmod.wet  = Number(q(".fx-ringmod-wet").value);
    fc.ringmod.freq = Number(q(".fx-ringmod-freq").value);
    t.fxRack?.applyRingMod(fc.ringmod);
  };
  const applyWaveShaper = () => {
    fc.shaper.wet    = Number(q(".fx-shaper-wet").value);
    fc.shaper.preamp = Number(q(".fx-shaper-preamp").value);
    fc.shaper.amount = Number(q(".fx-shaper-amt").value);
    const ms = q(".fx-shaper-mode");
    if (ms) fc.shaper.mode = ms.value;
    t.fxRack?.applyWaveShaper(fc.shaper);
  };
  const applyAutoWah = () => {
    fc.autowah.wet   = Number(q(".fx-autowah-wet").value);
    fc.autowah.sens  = Number(q(".fx-autowah-sens").value);
    fc.autowah.range = Number(q(".fx-autowah-range").value);
    t.fxRack?.applyAutoWah(fc.autowah);
  };
  const applyChorus = () => {
    fc.chorus.wet   = Number(q(".fx-chorus-wet").value);
    fc.chorus.rate  = Number(q(".fx-chorus-rate").value);
    fc.chorus.depth = Number(q(".fx-chorus-depth").value);
    t.fxRack?.applyChorus(fc.chorus);
  };
  const applyPhaser = () => {
    fc.phaser.wet   = Number(q(".fx-phaser-wet").value);
    fc.phaser.rate  = Number(q(".fx-phaser-rate").value);
    fc.phaser.depth = Number(q(".fx-phaser-depth").value);
    t.fxRack?.applyPhaser(fc.phaser);
  };
  const applyFlanger = () => {
    fc.flanger.wet  = Number(q(".fx-flanger-wet").value);
    fc.flanger.rate = Number(q(".fx-flanger-rate").value);
    fc.flanger.fbk  = Number(q(".fx-flanger-fbk").value);
    t.fxRack?.applyFlanger(fc.flanger);
  };
  const applyPitchShift = () => {
    fc.pitchshift.wet       = Number(q(".fx-pitchshift-wet").value);
    fc.pitchshift.semitones = Number(q(".fx-pitchshift-semi").value);
    t.fxRack?.applyPitchShift(fc.pitchshift);
  };
  const applyDelay = () => {
    fc.delay.time = Number(q(".fx-delay-time").value);
    fc.delay.fbk  = Number(q(".fx-delay-fbk").value);
    fc.delay.wet  = Number(q(".fx-delay-wet").value);
    fc.delay.sync = !!q(".fx-delay-sync").checked;
    fc.delay.div  = Number(q(".fx-delay-div").value);
    t.fxRack?.applyDelay(fc.delay);
  };
  const applyReverb = () => {
    fc.reverb.decay = Number(q(".fx-reverb-decay").value);
    fc.reverb.wet   = Number(q(".fx-reverb-wet").value);
    t.fxRack?.applyReverb(fc.reverb);
  };

  const applyCrush = () => {
    const b = q(".fx-crush-bits"); const w = q(".fx-crush-wet");
    if (b) fc.crush.bits = Number(b.value);
    if (w) fc.crush.wet  = Number(w.value);
    t.fxRack?.applyCrush(fc.crush);
  };

  ["preamp","level"].forEach(n => q(`.fx-amp-${n}`)?.addEventListener("input", applyAmp));
  ["amount","warmth","wow"].forEach(n => q(`.fx-vinyl-${n}`)?.addEventListener("input", applyVinyl));
  ["amount","flutter","sat"].forEach(n => q(`.fx-cassette-${n}`)?.addEventListener("input", applyCassette));
  ["amount","drive","tone","level"].forEach(n => q(`.fx-fuzz-${n}`).addEventListener("input", applyFuzz));
  ["wet","freq"].forEach(n => q(`.fx-ringmod-${n}`)?.addEventListener("input", applyRingMod));
  ["wet","amt","preamp"].forEach(n => q(`.fx-shaper-${n}`)?.addEventListener("input", applyWaveShaper));
  q(".fx-shaper-mode")?.addEventListener("change", applyWaveShaper);
  ["wet","sens","range"].forEach(n => q(`.fx-autowah-${n}`)?.addEventListener("input", applyAutoWah));
  ["wet","rate","depth"].forEach(n => q(`.fx-chorus-${n}`)?.addEventListener("input", applyChorus));
  ["wet","rate","depth"].forEach(n => q(`.fx-phaser-${n}`)?.addEventListener("input", applyPhaser));
  ["wet","rate","fbk"].forEach(n => q(`.fx-flanger-${n}`)?.addEventListener("input", applyFlanger));
  ["wet","semi"].forEach(n => q(`.fx-pitchshift-${n}`)?.addEventListener("input", applyPitchShift));
  ["time","fbk","wet"].forEach(n => q(`.fx-delay-${n}`).addEventListener("input", applyDelay));
  q(".fx-delay-sync").addEventListener("change", applyDelay);
  q(".fx-delay-div").addEventListener("change", applyDelay);
  q(".fx-reverb-decay").addEventListener("input", applyReverb);
  q(".fx-reverb-wet").addEventListener("input", applyReverb);
  { const b = q(".fx-crush-bits"); if (b) b.addEventListener("input", applyCrush); }
  { const w = q(".fx-crush-wet");  if (w) w.addEventListener("input", applyCrush); }

  // Double-click an effect's name to put that effect back to its defaults. The
  // panel has a lot of knobs and no undo, so getting back to a known state
  // otherwise means dragging each one to where you think it started.
  const RESET = {
    amp: applyAmp, vinyl: applyVinyl, cassette: applyCassette, fuzz: applyFuzz,
    ringmod: applyRingMod, shaper: applyWaveShaper, crush: applyCrush,
    autowah: applyAutoWah, chorus: applyChorus, phaser: applyPhaser,
    flanger: applyFlanger, pitchshift: applyPitchShift, delay: applyDelay,
    reverb: applyReverb,
  };
  const defaults = defaultFxConfig();
  panel.querySelectorAll(".sq-fx__row").forEach(row => {
    const title = row.querySelector(".sq-fx__title");
    const stage = row.dataset.fx;
    if (!title || !stage) return;
    title.title = "double-click to reset";
    title.classList.add("is-resettable");
    title.addEventListener("dblclick", () => {
      if (stage === "glide") {                 // not an fx-rack stage; lives on the track
        t.glide = 0;
        const g = q(".sq-track__glide");
        if (g) g.value = "0";
        if (t.voice?.setGlide) t.voice.setGlide(0);
        return;
      }
      const apply = RESET[stage];
      if (!apply || !defaults[stage]) return;
      fc[stage] = { ...defaults[stage] };
      refreshFxPanelUI(t);                     // writes every control from the config
      apply();                                 // …then re-read them into the rack
    });
  });
}

/**
 * Build a live LFO row for one modulation target. The row drives
 * `t.lfoConfig[key]` directly, so the mod panel and the right-click parameter
 * menu can each host one without either becoming the owner of the state.
 * @param {Track} t @param {string} key @param {() => void} [onRemove]
 * @returns {HTMLElement}
 */
export function buildLfoRow(t, key, onRemove) {
  const tpl = document.getElementById("lfo-row-template");
  const cfg = t.lfoConfig[key] || (t.lfoConfig[key] =
    { enabled: false, type: "sine", rate: 1.0, depth: 0.5, sync: true, div: 1 });
  const row = tpl.content.firstElementChild.cloneNode(true);
  row.dataset.key = key;
  row.classList.add("is-active");
  row.querySelector(".sq-lfo__target").textContent = lfoLabel(key);

  const cb    = row.querySelector(".lfo-on");
  const shape = row.querySelector(".sq-lfo__shape");
  const rate  = row.querySelector(".sq-lfo__rate");
  const rateLbl  = row.querySelector(".sq-lfo__rate-label");
  const depth = row.querySelector(".lfo-depth");
  const depthLbl = row.querySelector(".sq-lfo__depth-label");
  const syncCb = row.querySelector(".lfo-sync");
  const divSel = row.querySelector(".sq-lfo__div");
  const rateField = row.querySelector(".sq-lfo__rate-field");
  const removeBtn = row.querySelector(".sq-lfo__remove");

  cb.checked   = cfg.enabled;
  shape.value  = cfg.type;
  rate.value   = rateToSlider(cfg.rate);
  depth.value  = cfg.depth;
  depthLbl.textContent = cfg.depth.toFixed(2);
  syncCb.checked = cfg.sync;
  divSel.value = String(cfg.div);
  rateField.dataset.mode = cfg.sync ? "sync" : "hz";
  row.classList.toggle("is-active", cfg.enabled);

  const refreshLbl = () => {
    if (cfg.sync) {
      const opt = divSel.options[divSel.selectedIndex];
      rateLbl.textContent = `${opt ? opt.textContent : cfg.div} · ${rateFromSync(cfg.div).toFixed(2)} hz`;
    } else {
      rateLbl.textContent = `${cfg.rate.toFixed(2)} hz`;
    }
  };
  refreshLbl();

  cb.addEventListener("change", () => {
    cfg.enabled = cb.checked;
    row.classList.toggle("is-active", cfg.enabled);
    syncLFO(t, key);
    refreshParamIndicators(t);
  });
  shape.addEventListener("change", () => { cfg.type = shape.value; syncLFO(t, key); });
  rate.addEventListener("input", () => { cfg.rate = sliderToRate(Number(rate.value)); refreshLbl(); syncLFO(t, key); });
  depth.addEventListener("input", () => { cfg.depth = Number(depth.value); depthLbl.textContent = cfg.depth.toFixed(2); syncLFO(t, key); });
  syncCb.addEventListener("change", () => { cfg.sync = syncCb.checked; rateField.dataset.mode = cfg.sync ? "sync" : "hz"; refreshLbl(); syncLFO(t, key); });
  divSel.addEventListener("change", () => { cfg.div = Number(divSel.value); refreshLbl(); syncLFO(t, key); });
  if (removeBtn) removeBtn.addEventListener("click", () => {
    cfg.enabled = false;
    syncLFO(t, key);
    row.remove();
    onRemove?.();
  });
  upgradeKnobs(row);
  return row;
}

export function renderModPanel(t, panel) {
  panel.replaceChildren();
  // (glide lives in the fx panel now — see wireFxPanel. Swing is master-only.)

  // Container for the per-param LFO rows (added one at a time via the picker below).
  const rowsContainer = document.createElement("div");
  rowsContainer.className = "sq-mod__rows";
  panel.appendChild(rowsContainer);

  const addRow = (key) => {
    rowsContainer.appendChild(buildLfoRow(t, key, () => { refreshAdderOptions(); refreshParamIndicators(t); }));
  };

  // Picker row: a "+ add" button that expands into a select of the remaining
  // modulation targets; picking one enables the LFO and drops a fresh row in.
  const adder = document.createElement("div");
  adder.className = "sq-mod__add-row";
  adder.innerHTML = `
    <button class="sq-mod__add-btn sq-btn--ghost" type="button">+ add modulation</button>
    <select class="sq-mod__add-select" hidden></select>
    <span class="sq-mod__hint">one lfo or one automation lane per parameter · right-click a parameter to see what's on it</span>
  `;
  panel.appendChild(adder);
  const addBtn = adder.querySelector(".sq-mod__add-btn");
  const addSel = adder.querySelector(".sq-mod__add-select");
  const refreshAdderOptions = () => {
    // Only show mods that apply to the current engine, and only for parameters
    // an automation lane hasn't already claimed (see paramTargets.js).
    const available = LFO_KEYS.filter(k => !t.lfoConfig[k]?.enabled && canModulate(t, k) && !autoOwns(t, k));
    if (available.length === 0) {
      addBtn.disabled = true;
      addSel.hidden = true;
      addBtn.textContent = "(nothing left to modulate)";
    } else {
      addBtn.disabled = false;
      addBtn.textContent = "+ add modulation";
      addSel.innerHTML = `<option value="" disabled selected>pick a target…</option>`
        + available.map(k => `<option value="${k}">${lfoLabel(k)}</option>`).join("");
    }
  };
  addBtn.addEventListener("click", () => {
    refreshAdderOptions();
    if (addBtn.disabled) return;
    addSel.hidden = false;
    addSel.focus();
  });
  addSel.addEventListener("change", () => {
    const key = addSel.value;
    if (!key || !t.lfoConfig[key]) { addSel.hidden = true; return; }
    t.lfoConfig[key].enabled = true;
    syncLFO(t, key);
    addRow(key);
    addSel.hidden = true;
    refreshAdderOptions();
    refreshParamIndicators(t);
  });

  // Pre-populate rows for any LFO that's already enabled on this track.
  for (const key of LFO_KEYS) {
    if (t.lfoConfig[key]?.enabled) addRow(key);
  }
  refreshAdderOptions();
  refreshParamIndicators(t);
}

/**
 * Create the lane for an automation target if it doesn't exist, and resize its
 * values to the track's current length.
 * @param {Track} t @param {string} key
 */
export function ensureAutomationLane(t, key) {
  if (!t.automation) t.automation = {};
  if (!t.automation[key]) {
    t.automation[key] = { enabled: true, values: new Array(t.length).fill(0.5) };
  }
  const vals = t.automation[key].values;
  if (vals.length !== t.length) {
    const out = new Array(t.length).fill(0.5);
    for (let i = 0; i < Math.min(vals.length, t.length); i++) out[i] = vals[i];
    t.automation[key].values = out;
  }
  return t.automation[key];
}

/**
 * Build a per-step automation lane (label, enable, draggable value grid). Draws
 * straight from `t.automation[key].values`, so the aut panel and the
 * right-click parameter menu can each show one over the same data.
 * @param {Track} t @param {string} key @param {() => void} [onRemove]
 * @returns {HTMLElement}
 */
export function buildAutomationLane(t, key, onRemove) {
  const lane = ensureAutomationLane(t, key);
  const row = document.createElement("div");
  row.className = "sq-aut__lane" + (lane.enabled ? " is-active" : "");
  row.dataset.key = key;
  row.innerHTML = `
    <span class="sq-aut__label">${AUTOMATION_TARGETS[key]?.label ?? key}</span>
    <input type="checkbox" class="sq-aut__enable" ${lane.enabled ? "checked" : ""} title="enable lane" />
    <div class="sq-aut__grid"></div>
    <button class="sq-aut__clear sq-btn--ghost" type="button" title="reset to 0.5">clear</button>
    <button class="sq-aut__remove" type="button" title="remove lane">×</button>
  `;

  const grid = row.querySelector(".sq-aut__grid");
  for (let i = 0; i < t.length; i++) {
    const cell = document.createElement("div");
    cell.className = "sq-aut__step";
    cell.dataset.idx = i;
    cell.style.setProperty("--v", String(lane.values[i] ?? 0));
    grid.appendChild(cell);
  }

  const setFromPointer = (ev) => {
    const rect = grid.getBoundingClientRect();
    const cols = t.length;
    const relX = Math.max(0, Math.min(rect.width - 1, ev.clientX - rect.left));
    const relY = Math.max(0, Math.min(rect.height, ev.clientY - rect.top));
    const idx = Math.max(0, Math.min(cols - 1, Math.floor((relX / rect.width) * cols)));
    const v = 1 - (relY / rect.height);
    lane.values[idx] = Math.max(0, Math.min(1, v));
    const cell = grid.children[idx];
    if (cell) cell.style.setProperty("--v", String(lane.values[idx]));
  };

  let dragging = false;
  grid.addEventListener("pointerdown", (ev) => {
    dragging = true;
    try { grid.setPointerCapture(ev.pointerId); } catch {}
    setFromPointer(ev);
    ev.preventDefault();
  });
  grid.addEventListener("pointermove", (ev) => { if (dragging) setFromPointer(ev); });
  grid.addEventListener("pointerup", (ev) => {
    dragging = false;
    try { grid.releasePointerCapture(ev.pointerId); } catch {}
  });
  grid.addEventListener("pointercancel", () => { dragging = false; });

  row.querySelector(".sq-aut__enable").addEventListener("change", (ev) => {
    lane.enabled = !!ev.target.checked;
    row.classList.toggle("is-active", lane.enabled);
    refreshParamIndicators(t);
  });
  row.querySelector(".sq-aut__clear").addEventListener("click", () => {
    for (let i = 0; i < lane.values.length; i++) lane.values[i] = 0.5;
    for (let i = 0; i < grid.children.length; i++) grid.children[i].style.setProperty("--v", "0.5");
  });
  row.querySelector(".sq-aut__remove").addEventListener("click", () => {
    delete t.automation[key];
    row.remove();
    onRemove?.();
    refreshParamIndicators(t);
  });
  return row;
}

// Render per-step automation lanes for the track's active pattern. Re-run on
// pattern switch so the grids reflect the active pattern's lanes.
export function renderAutomationPanel(t, panel) {
  panel.replaceChildren();
  if (!t.automation) t.automation = {};
  const enabledKeys = Object.keys(t.automation).filter(k => AUTOMATION_TARGETS[k]);

  const rows = document.createElement("div");
  rows.className = "aut-rows";
  panel.appendChild(rows);

  const emptyMsg = document.createElement("div");
  emptyMsg.className = "sq-aut__empty";
  emptyMsg.textContent = "no automation — pick a target below to add a lane";
  panel.appendChild(emptyMsg);

  const adder = document.createElement("div");
  adder.className = "sq-aut__add-row";
  adder.innerHTML = `
    <button class="sq-aut__add-btn sq-btn--ghost" type="button">+ add automation</button>
    <select class="sq-aut__add-select" hidden></select>
  `;
  panel.appendChild(adder);
  const addBtn = adder.querySelector(".sq-aut__add-btn");
  const addSel = adder.querySelector(".sq-aut__add-select");

  const refreshAdder = () => {
    // Parameters an LFO is already driving are off the list — one owner each.
    const avail = AUTOMATION_KEYS.filter(k => !t.automation[k] && canAutomate(t, k) && !modOwns(t, k));
    if (avail.length === 0) {
      addBtn.disabled = true;
      addSel.hidden = true;
      addBtn.textContent = "(nothing left to automate)";
    } else {
      addBtn.disabled = false;
      addBtn.textContent = "+ add automation";
      addSel.innerHTML = `<option value="" disabled selected>pick a target…</option>`
        + avail.map(k => `<option value="${k}">${AUTOMATION_TARGETS[k].label}</option>`).join("");
    }
    emptyMsg.hidden = Object.keys(t.automation).length > 0;
  };

  const drawRow = (key) => {
    rows.appendChild(buildAutomationLane(t, key, () => refreshAdder()));
  };

  for (const key of enabledKeys) drawRow(key);
  refreshAdder();
  refreshParamIndicators(t);

  addBtn.addEventListener("click", () => {
    refreshAdder();
    if (addBtn.disabled) return;
    addSel.hidden = false;
    addSel.focus();
  });
  addSel.addEventListener("change", () => {
    const key = addSel.value;
    if (!key) { addSel.hidden = true; return; }
    drawRow(key);
    addSel.hidden = true;
    refreshAdder();
    refreshParamIndicators(t);
  });
}

