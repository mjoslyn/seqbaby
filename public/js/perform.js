/**
 * The perform view — the song laid out as a rack for playing it rather than
 * writing it: an instruments grid, one shared fx rack with every stage in it
 * and the instruments as its inputs, a grid of the modulations and lanes, and
 * a drawer that opens an instrument's pattern and roll. The `perform` button
 * in the transport is a toggle; the track list is hidden while it is up and
 * comes back exactly as it was when it goes down.
 *
 * Three decisions carry the design:
 *
 *   - **It is a view over the real controls, not a second control surface.**
 *     Every parameter in the studio is one native range input with a shadowed
 *     `value` accessor (knob.js), and undo, the jam, p-lock, knob recording,
 *     the modulation needle, the owner dots and the right-click menu all hang
 *     off that element. A rack that drew its own knobs and forwarded values
 *     would have to re-plumb all of that. So the cards MOVE the track's own
 *     elements — the vol field, the synth row, the inline-panel wrapper, the
 *     fx rows, the step grid, the roll panel — leaving a comment anchor where
 *     each was, the way `openPanelAsModal` moves a whole panel, and put them
 *     back on the way out. The card is stamped `data-track-id`, so
 *     `controlForKey` and `trackRoots` (paramTargets.js) keep resolving a
 *     moved control, and the repaints that look one up under `t.el`
 *     (`syncTrackSoundUI`, `refreshFxPanelUI`, the engine panel syncs,
 *     `renderStepGrid`) fall back to `t._perfStrip.q`.
 *
 *   - **Every stage in the rack is its own fx bus.** A stage card has its own
 *     inputs: chips for the instruments and for the other live stages, each
 *     lit while that thing feeds this stage. A lit chip is `setTrackOutput`
 *     under the existing fade, so solo follows the chain, bus mute cuts the
 *     audio, and a loop is refused, all as for any bus. A stage's bus is made
 *     the first time something is plugged into it (`fx:<stage>`, engine
 *     `bus`), so an empty rack costs nothing; until then the card is a name
 *     and its chips. Everything has one output, so lighting a chip here takes
 *     it off whichever card had it, and a stage fed into another stage is
 *     the rack's chain.
 *
 *   - **The mods grid is drawn from state, not moved.** `renderModPanel`
 *     rebuilds the mod matrix's rows wholesale on every change, so a row
 *     moved out of it would be orphaned by the next edit. The grid builds
 *     its own rows with `buildLfoRow` / `buildAutomationLane` — the same
 *     widgets the right-click menu builds over the same track state — and
 *     rebuilds when the set of them changes.
 *
 * A scene is the performance subset: mute and solo per track, which
 * instruments feed the rack, and the pattern. Recalling one goes through
 * `setMute` / `setSolo` / `setTrackOutput`, the setters the track head uses,
 * so it is an undo step, reaches a jam and lands in the p-lock snapshot
 * without any of those knowing what a scene is. While the transport runs a
 * recall waits for the bar line (`barLineHooks`, transport.js), as a
 * launched pattern does. Scenes are the song's (`state.perform`, serialized
 * beside the macro pads by track index — performStore.js).
 */

import { FX_STAGE_KEYS, FX_STAGE_LABELS, FX_STAGE_NEUTRAL, PATTERN_COUNT, autoLabel, fxStageLevel, lfoLabel } from "./constants.js";
import { setStatus } from "./dom.js";
import { flushHistory, markExternalEdit } from "./history.js";
import { inJam, jamTogglePlay } from "./jam.js";
import { isDesktopKeyboard, isTypingTarget } from "./keyboard.js";
import { upgradeKnobs } from "./knob.js";
import { attachPadSurface, macroPads, openMacroPads, releasePad } from "./macro.js";
import { activeMeter, stepsPerBarForMeter } from "./meter.js";
import { refreshParamIndicators } from "./paramTargets.js";
import { updatePlaitsControlsVisibility } from "./params.js";
import { emptyPerform, readPerform, serializePerform } from "./performStore.js";
import { renderRollPanel } from "./pianoRoll.js";
import { writeParam } from "./momentary.js";
import { buildAutomationLane, buildLfoRow, setMute, setSolo } from "./render.js";
import { setTrackOutput, wouldFeedback } from "./signal.js";
import { isPatternNonEmpty, queuePatternSwitch, requestPatternSwitch, state } from "./state.js";
import { createTrack } from "./track.js";
import { barLineHooks, togglePlay } from "./transport.js";

/** @typedef {import("./types.js").Track} Track */

/** The track colours the step grids use (style.css, `#tracks > .sq-track:nth-child(8n+k)`). */
const TRACK_HUES = [35, 232, 297, 120, 253, 318, 155, 275];

let rack = null;                 // the #perform element while the view is up
/** @type {{el: Element, anchor: Comment}[]} */
let moved = [];
let drawnSig = "";
let drawnPattern = -1;
let quantize = true;
let selectedScene = null;
let selectedTrack = null;        // the instrument whose pattern the drawer shows
let _nextSceneId = 1;
let raf = 0;
let lastPainted = "";

// ---- model ---------------------------------------------------------------

export function perform() {
  if (!state.perform || typeof state.perform !== "object") state.perform = emptyPerform();
  if (!Array.isArray(state.perform.scenes)) state.perform.scenes = [];
  return state.perform;
}

export function isPerformOpen() { return !!rack; }

const trackById = (id) => state.tracks.find(t => t.id === id) || null;
const isBus = (t) => t.engineKey === "bus";
const instruments = () => state.tracks.filter(t => !isBus(t));
/** A stage's bus is a bus track named for it. */
const stageBusName = (stage) => `fx:${stage}`;
const stageBus = (stage) => state.tracks.find(t => isBus(t) && t.name === stageBusName(stage)) || null;
/** The stage a bus is, or null for a bus someone made by hand. */
const busStage = (t) => { const m = /^fx:([a-z]+)$/.exec(t.name || ""); return m && FX_STAGE_KEYS.includes(m[1]) ? m[1] : null; };
/** Where a track's output goes: a track, or null for the master. */
const outOf = (t) => (t.out && t.out !== "master" ? state.tracks.find(x => String(x.id) === String(t.out)) || null : null);

// ---- scenes --------------------------------------------------------------

function captureScene(name) {
  const perf = perform();
  const scene = {
    id: _nextSceneId++,
    name: name || `scene ${perf.scenes.length + 1}`,
    pattern: state.activePattern,
    tracks: state.tracks.map(t => ({ trackId: t.id, muted: !!t.muted, soloed: !!t.soloed, out: outOf(t)?.id ?? null })),
  };
  perf.scenes.push(scene);
  return scene;
}

/** Overwrite a scene with the state as it is now, keeping its name. */
function updateScene(scene) {
  const fresh = captureScene(scene.name);
  perform().scenes.pop();
  Object.assign(scene, { pattern: fresh.pattern, tracks: fresh.tracks });
}

/** Write a scene's mutes, solos and sends. The pattern is the caller's. */
function applyScene(scene) {
  for (const x of scene.tracks) {
    const t = trackById(x.trackId);
    if (!t) continue;
    // Solo and mute exclude each other in the UI, so the order matters: a
    // track soloed in the scene is unmuted first, one muted is unsoloed first.
    if (x.soloed) { setMute(t, false); setSolo(t, true); }
    else { setSolo(t, false); setMute(t, !!x.muted); }
    const want = x.out != null && trackById(x.out) ? String(x.out) : "master";
    if (String(t.out || "master") !== want) setTrackOutput(t, want);
  }
}

/** Recall a scene: now when stopped, on the bar line while playing (with
 *  quantize on), through the same queue a launched pattern waits in. */
export function recallScene(scene) {
  if (!scene) return;
  selectedScene = scene.id;
  flushHistory();
  const hasPattern = Number.isInteger(scene.pattern) && scene.pattern >= 0 && scene.pattern < PATTERN_COUNT;
  if (state.playing && quantize) {
    state.queuedScene = scene.id;
    if (hasPattern) queuePatternSwitch(scene.pattern);
    setStatus(`scene "${scene.name}" on the next bar`);
  } else {
    state.queuedScene = null;
    applyScene(scene);
    if (hasPattern) requestPatternSwitch(scene.pattern);
    // Its own undo step. The click's pointerup scheduled a check before the
    // scene was written (the flush above banked whatever was settling), so
    // the change is announced here, after it, the way vim's commands are.
    markExternalEdit(`scene ${scene.name}`);
    setStatus(`scene "${scene.name}"`);
  }
  paintScenes();
  paintInputs();
}

/** The bar line: land the queued scene. The pattern it queued is consumed by
 *  the transport right after this, in the same callback. */
function onBarLine() {
  if (state.queuedScene == null) return;
  const scene = perform().scenes.find(s => s.id === state.queuedScene);
  state.queuedScene = null;
  if (scene) { applyScene(scene); markExternalEdit(`scene ${scene.name}`); paintInputs(); }
}

// ---- moving the track's own elements -------------------------------------

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function moveEl(node, slot) {
  if (!node || node.closest("#perform")) return null;
  const anchor = document.createComment("perform-anchor");
  node.replaceWith(anchor);
  slot.appendChild(node);
  moved.push({ el: node, anchor });
  return node;
}

function restoreAll() {
  // Last moved first, so an element moved out of another moved element lands
  // inside it after that one is home.
  for (let i = moved.length - 1; i >= 0; i--) {
    const { el: node, anchor } = moved[i];
    // The anchor's track may have been torn down since (a session arrived);
    // then the element goes with it.
    if (anchor.parentNode) anchor.replaceWith(node); else node.remove();
  }
  moved = [];
  for (const row of hiddenRows) row.hidden = false;
  hiddenRows = [];
  for (const t of state.tracks) {
    if (t._rollPanelEl && !t._rollModal) t._rollPanelEl.hidden = true;
    t._perfStrip = null;
  }
}

function stripHandle(t, card, extra = []) {
  const roots = () => [card, ...extra.filter(e => e && e.isConnected)];
  const q = (sel) => { for (const r of roots()) { const hit = r.querySelector(sel); if (hit) return hit; } return null; };
  t._perfStrip = { el: card, roots, q, paintMuteSolo: null };
  return t._perfStrip;
}

function muteSoloButtons(t, card) {
  const mute = el("button", "sq-perform__mute", "mute");
  const solo = el("button", "sq-perform__solo", "solo");
  mute.type = solo.type = "button";
  mute.addEventListener("click", () => setMute(t, !t.muted));
  solo.addEventListener("click", () => setSolo(t, !t.soloed));
  const paint = () => {
    mute.setAttribute("aria-pressed", String(!!t.muted));
    solo.setAttribute("aria-pressed", String(!!t.soloed));
    mute.disabled = !!t.soloed;
    solo.disabled = !!t.muted;
    card.classList.toggle("is-muted", !!t.muted);
    card.classList.toggle("is-soloed", !!t.soloed);
  };
  paint();
  return { mute, solo, paint };
}

/** The track's inline-panel wrapper (filter, env, eq, comp, its own fx rows),
 *  moved into a holder that carries `.sq-track` so the inline card rules in
 *  style.css apply to it as they do on the track. */
function liveHolder(t) {
  const holder = el("div", "sq-track sq-perform__live");
  const live = t.el?.querySelector(":scope > .sq-track__live");
  if (live) moveEl(live, holder);
  return holder;
}

// ---- instruments ---------------------------------------------------------

function buildInstrumentCard(t, i) {
  const card = el("div", "sq-perform__card");
  card.dataset.trackId = String(t.id);
  card.style.setProperty("--track-hue", String(TRACK_HUES[i % TRACK_HUES.length]));
  if (selectedTrack === t.id) card.classList.add("is-selected");

  const head = el("div", "sq-perform__head");
  const name = el("button", "sq-perform__name", t.name || `track ${i + 1}`);
  name.type = "button";
  name.title = "open this instrument's pattern and roll";
  name.addEventListener("click", () => selectInstrument(selectedTrack === t.id ? null : t.id));
  head.appendChild(name);
  const { mute, solo, paint } = muteSoloButtons(t, card);
  head.append(mute, solo);
  card.appendChild(head);

  const handle = stripHandle(t, card);
  handle.paintMuteSolo = paint;

  const volSlot = el("div", "sq-perform__vol");
  const vol = t.el?.querySelector(".sq-vol__field");
  if (vol) {
    moveEl(vol, volSlot);
    const meter = volSlot.querySelector(".sq-track__meter");
    if (meter) t._meterEl = meter;
  }
  card.appendChild(volSlot);

  const synth = el("div", "sq-perform__synth");
  moveEl(t.el?.querySelector(".sq-track__synth-row"), synth);
  card.appendChild(synth);
  card.appendChild(liveHolder(t));
  return card;
}

function buildInstruments() {
  const box = el("div", "sq-perform__section sq-perform__instruments");
  const head = el("div", "sq-perform__sechead");
  head.appendChild(el("span", "sq-perform__sectitle", "instruments"));
  box.appendChild(head);
  const grid = el("div", "sq-perform__cards");
  instruments().forEach((t, i) => grid.appendChild(buildInstrumentCard(t, state.tracks.indexOf(t))));
  if (!grid.children.length) grid.appendChild(el("div", "sq-perform__empty", "no instruments in the song"));
  box.appendChild(grid);
  return box;
}

// ---- the drawer: an instrument's pattern and roll ------------------------

export function selectInstrument(id) {
  selectedTrack = id;
  scheduleRedraw();
}

function buildDrawer() {
  const t = selectedTrack != null ? trackById(selectedTrack) : null;
  if (!t || !t.el) { selectedTrack = null; return null; }
  const box = el("div", "sq-perform__drawer");
  box.dataset.trackId = String(t.id);
  box.style.setProperty("--track-hue", String(TRACK_HUES[state.tracks.indexOf(t) % TRACK_HUES.length]));
  const head = el("div", "sq-perform__sechead");
  head.appendChild(el("span", "sq-perform__sectitle", `${t.name}: pattern ${state.activePattern + 1}`));
  const close = el("button", "sq-btn--ghost", "close");
  close.type = "button";
  close.addEventListener("click", () => selectInstrument(null));
  head.appendChild(close);
  box.appendChild(head);
  const steps = el("div", "sq-perform__steps");
  moveEl(t.el.querySelector(":scope > .sq-steps"), steps);
  box.appendChild(steps);
  if (t._rollPanelEl && !t._rollModal) {
    const roll = el("div", "sq-perform__roll");
    moveEl(t._rollPanelEl, roll);
    t._rollPanelEl.hidden = false;
    renderRollPanel(t, t._rollPanelEl);
    box.appendChild(roll);
  }
  // The card's lookups reach the drawer too (renderStepGrid finds its grid).
  if (t._perfStrip) {
    const prev = t._perfStrip.roots;
    t._perfStrip.roots = () => [...prev(), box];
  }
  return box;
}

// ---- the fx rack: a card per stage, each its own bus ----------------------

/** @type {Element[]} rows hidden in a moved fx panel, shown again on restore */
let hiddenRows = [];

/** Make a stage's bus, and give the stage a level to be heard at: a wet of
 *  half, through the control's own event so it is an edit like any other.
 *  gain and pan sit at their neutral middle already. */
function ensureStageBus(stage) {
  let bus = stageBus(stage);
  if (bus) return bus;
  bus = createTrack({ name: stageBusName(stage), engineKey: "bus", length: stepsPerBarForMeter(activeMeter()) });
  if (FX_STAGE_NEUTRAL[stage] == null) writeParam(bus, `fx.${stage}`, 0.5, 0, true);
  return bus;
}

function paintInputs() {
  if (!rack) return;
  for (const chip of rack.querySelectorAll(".sq-perform__chip")) {
    const src = trackById(Number(chip.dataset.trackId));
    const busId = chip.closest("[data-bus-id]")?.dataset.busId;
    chip.setAttribute("aria-pressed", String(!!src && busId != null && busId !== "" && String(src.out) === busId));
  }
}

function paintStages() {
  if (!rack) return;
  for (const card of rack.querySelectorAll(".sq-perform__stagecard[data-bus-id]")) {
    const bus = trackById(Number(card.dataset.busId));
    const stage = card.dataset.fx;
    if (!bus || !stage) continue;
    card.classList.toggle("is-dim", !(fxStageLevel(bus.fxConfig, stage) > 0));
  }
}

/** The chips for one card: lit while the source feeds this bus; a click
 *  routes it here (making the bus if the stage has none yet) or back to the
 *  master. */
function buildChips(stage, bus, card) {
  const inputs = el("div", "sq-perform__inputs");
  inputs.appendChild(el("span", "sq-perform__inlabel", "in"));
  for (const src of state.tracks) {
    if (src === bus) continue;
    if (isBus(src) && !busStage(src) && src.name?.startsWith("fx:")) continue;
    const chip = el("button", "sq-perform__chip", isBus(src) ? (busStage(src) ? FX_STAGE_LABELS[busStage(src)] : src.name) : src.name);
    chip.type = "button";
    chip.dataset.trackId = String(src.id);
    if (isBus(src)) chip.classList.add("sq-perform__chip--stage");
    else chip.style.setProperty("--track-hue", String(TRACK_HUES[state.tracks.indexOf(src) % TRACK_HUES.length]));
    chip.title = isBus(src) ? `${chip.textContent}'s output: into this stage, or to the master` : `${src.name}: into this stage, or straight to the master`;
    chip.addEventListener("click", () => {
      const target = bus || ensureStageBus(stage);
      const on = String(src.out) === String(target.id);
      if (!on && wouldFeedback(src, target.id)) { setStatus(`${chip.textContent} into ${FX_STAGE_LABELS[stage] || target.name} would feed back on itself`, true); return; }
      setTrackOutput(src, on ? "master" : target.id);
      if (!bus) scheduleRedraw(); else paintInputs();
    });
    inputs.appendChild(chip);
  }
  card.appendChild(inputs);
}

function buildStageCard(stage) {
  const bus = stageBus(stage);
  const card = el("div", "sq-perform__stagecard");
  card.dataset.fx = stage;
  if (bus) card.dataset.busId = String(bus.id);
  else card.classList.add("is-dead");
  const head = el("div", "sq-perform__head");
  head.appendChild(el("span", "sq-perform__stagename", FX_STAGE_LABELS[stage]));
  if (bus) {
    const { mute, paint } = muteSoloButtons(bus, card);
    stripHandle(bus, card).paintMuteSolo = paint;
    head.appendChild(mute);
  }
  card.appendChild(head);
  buildChips(stage, bus, card);
  if (!bus) {
    card.appendChild(el("div", "sq-perform__empty", "plug something in"));
    return card;
  }
  // The stage's row, inside the bus's whole fx panel (its handlers read their
  // values back through the panel, so a row cannot leave it); every other row
  // is hidden until the panel goes home. The bus's own vol is the return.
  const body = el("div", "sq-perform__stagebody");
  const panel = bus._fxPanelEl;
  if (panel) {
    for (const row of panel.querySelectorAll(":scope > .sq-fx__row")) {
      if (row.dataset.fx === stage && !row.dataset.fxId) continue;
      if (!row.hidden) { row.hidden = true; hiddenRows.push(row); }
    }
    moveEl(panel, body);
  }
  const volSlot = el("div", "sq-perform__vol sq-perform__return");
  const vol = bus.el?.querySelector(".sq-vol__field");
  if (vol) {
    moveEl(vol, volSlot);
    const meter = volSlot.querySelector(".sq-track__meter");
    if (meter) bus._meterEl = meter;
  }
  body.appendChild(volSlot);
  body.addEventListener("input", paintStages);
  body.addEventListener("change", paintStages);
  card.appendChild(body);
  return card;
}

/** A bus made by hand (not `fx:<stage>`): its whole rack, with chips. */
function buildBusCard(bus) {
  const card = el("div", "sq-perform__stagecard sq-perform__stagecard--bus");
  card.dataset.busId = String(bus.id);
  const head = el("div", "sq-perform__head");
  head.appendChild(el("span", "sq-perform__stagename", bus.name || "bus"));
  const { mute, paint } = muteSoloButtons(bus, card);
  stripHandle(bus, card).paintMuteSolo = paint;
  head.appendChild(mute);
  card.appendChild(head);
  buildChips(null, bus, card);
  const body = el("div", "sq-perform__stagebody");
  const volSlot = el("div", "sq-perform__vol sq-perform__return");
  const vol = bus.el?.querySelector(".sq-vol__field");
  if (vol) { moveEl(vol, volSlot); const meter = volSlot.querySelector(".sq-track__meter"); if (meter) bus._meterEl = meter; }
  body.appendChild(volSlot);
  body.appendChild(liveHolder(bus));
  card.appendChild(body);
  return card;
}

function buildFxRack() {
  const box = el("div", "sq-perform__section sq-perform__fx");
  const head = el("div", "sq-perform__sechead");
  head.appendChild(el("span", "sq-perform__sectitle", "fx rack"));
  head.appendChild(el("span", "sq-perform__hint", "each stage has its own inputs: instruments, or another stage"));
  box.appendChild(head);
  const grid = el("div", "sq-perform__stages");
  for (const stage of FX_STAGE_KEYS) grid.appendChild(buildStageCard(stage));
  for (const bus of state.tracks.filter(t => isBus(t) && !busStage(t))) grid.appendChild(buildBusCard(bus));
  box.appendChild(grid);
  return box;
}

// ---- the mods grid -------------------------------------------------------

function modCards(t, onChange) {
  const out = [];
  const hue = String(TRACK_HUES[state.tracks.indexOf(t) % TRACK_HUES.length]);
  for (const key of Object.keys(t.lfoConfig || {})) {
    if (!t.lfoConfig[key]?.enabled) continue;
    const card = el("div", "sq-perform__mod sq-perform__mod--lfo");
    card.dataset.trackId = String(t.id);
    card.style.setProperty("--track-hue", hue);
    card.appendChild(el("div", "sq-perform__cap", `${t.name} · ${lfoLabel(key)}`));
    try { card.appendChild(buildLfoRow(t, key, onChange)); } catch { continue; }
    out.push(card);
  }
  for (const key of Object.keys(t.automation || {})) {
    if (!t.automation[key]?.enabled) continue;
    const card = el("div", "sq-perform__mod sq-perform__mod--aut");
    card.dataset.trackId = String(t.id);
    card.style.setProperty("--track-hue", hue);
    card.appendChild(el("div", "sq-perform__cap", `${t.name} · ${autoLabel(key)} · lane`));
    try { card.appendChild(buildAutomationLane(t, key, onChange)); } catch { continue; }
    out.push(card);
  }
  return out;
}

function buildMods() {
  const box = el("div", "sq-perform__section sq-perform__mods");
  const head = el("div", "sq-perform__sechead");
  head.appendChild(el("span", "sq-perform__sectitle", "mods and lanes"));
  box.appendChild(head);
  const grid = el("div", "sq-perform__modgrid");
  for (const t of state.tracks) for (const c of modCards(t, scheduleRedraw)) grid.appendChild(c);
  if (!grid.children.length) grid.appendChild(el("div", "sq-perform__empty", "nothing modulated yet. Right-click a knob to give it an lfo or a lane"));
  box.appendChild(grid);
  return box;
}

// ---- launcher, scenes, pads ----------------------------------------------

function buildLauncher() {
  const box = el("div", "sq-perform__launcher");
  const head = el("div", "sq-perform__sechead");
  head.appendChild(el("span", "sq-perform__sectitle", "patterns"));
  const q = el("label", "sq-perform__quant");
  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.checked = quantize;
  cb.addEventListener("change", () => { quantize = cb.checked; });
  q.append(cb, document.createTextNode(" on the bar"));
  q.title = "launch a pattern or a scene on the next bar line rather than mid-bar";
  head.appendChild(q);
  box.appendChild(head);
  const grid = el("div", "sq-perform__cells");
  for (let i = 0; i < PATTERN_COUNT; i++) {
    const c = el("button", "sq-perform__cell", String(i + 1));
    c.type = "button";
    c.dataset.idx = String(i);
    c.title = `pattern ${i + 1}${i < 10 ? ` (key ${(i + 1) % 10})` : ""}`;
    c.addEventListener("click", () => launchPattern(i));
    grid.appendChild(c);
  }
  box.appendChild(grid);
  return box;
}

export function launchPattern(i) {
  if (state.playing && quantize) queuePatternSwitch(i); else requestPatternSwitch(i);
  paintLauncher(true);
}

function paintLauncher(force = false) {
  if (!rack) return;
  const sig = `${state.activePattern}:${state.queuedPattern}:${state.queuedScene}`;
  if (!force && sig === lastPainted) return;
  lastPainted = sig;
  for (const c of rack.querySelectorAll(".sq-perform__cell")) {
    const i = Number(c.dataset.idx);
    c.classList.toggle("is-active", i === state.activePattern);
    c.classList.toggle("is-queued", i === state.queuedPattern);
  }
  for (const b of rack.querySelectorAll(".sq-perform__scene")) {
    b.classList.toggle("is-queued", Number(b.dataset.id) === state.queuedScene);
  }
}

function paintFilled() {
  if (!rack) return;
  for (const c of rack.querySelectorAll(".sq-perform__cell")) {
    c.classList.toggle("is-filled", isPatternNonEmpty(Number(c.dataset.idx)));
  }
}

function paintScenes() {
  if (!rack) return;
  for (const b of rack.querySelectorAll(".sq-perform__scene")) {
    b.classList.toggle("is-on", Number(b.dataset.id) === selectedScene);
  }
  const tools = rack.querySelector(".sq-perform__scenetools");
  if (tools) tools.hidden = selectedScene == null || !perform().scenes.some(s => s.id === selectedScene);
  paintLauncher(true);
}

function buildScenes() {
  const box = el("div", "sq-perform__scenes");
  const head = el("div", "sq-perform__sechead");
  head.appendChild(el("span", "sq-perform__sectitle", "scenes"));
  const cap = el("button", "sq-perform__capture sq-btn--ghost", "+ capture");
  cap.type = "button";
  cap.title = "a scene: every track's mute and solo, which instruments feed the rack, and the pattern, as they are now (shift + number recalls one)";
  cap.addEventListener("click", () => { selectedScene = captureScene().id; draw(); });
  head.appendChild(cap);
  box.appendChild(head);

  const list = el("div", "sq-perform__scenelist");
  const scenes = perform().scenes;
  scenes.forEach((s, i) => {
    const b = el("button", "sq-perform__scene", s.name);
    b.type = "button";
    b.dataset.id = String(s.id);
    b.title = `recall "${s.name}"${i < 10 ? ` (shift ${(i + 1) % 10})` : ""}`;
    b.addEventListener("click", () => recallScene(s));
    list.appendChild(b);
  });
  if (!scenes.length) list.appendChild(el("div", "sq-perform__empty", "capture one to come back to this moment later"));
  box.appendChild(list);

  const tools = el("div", "sq-perform__scenetools");
  const upd = el("button", "sq-btn--ghost", "update");
  const ren = el("button", "sq-btn--ghost", "rename");
  const del = el("button", "sq-btn--ghost sq-perform__del", "delete");
  for (const b of [upd, ren, del]) b.type = "button";
  const sel = () => scenes.find(s => s.id === selectedScene);
  upd.title = "overwrite the selected scene with how things are now";
  upd.addEventListener("click", () => { const s = sel(); if (s) { updateScene(s); setStatus(`scene "${s.name}" updated`); } });
  ren.addEventListener("click", () => {
    const s = sel(); if (!s) return;
    const name = prompt("scene name", s.name);
    if (name && name.trim()) { s.name = name.trim(); draw(); }
  });
  del.addEventListener("click", () => {
    const s = sel(); if (!s) return;
    const i = scenes.indexOf(s);
    if (i >= 0) scenes.splice(i, 1);
    if (state.queuedScene === s.id) state.queuedScene = null;
    selectedScene = null;
    draw();
  });
  tools.append(upd, ren, del);
  box.appendChild(tools);
  return box;
}

function buildPads() {
  const box = el("div", "sq-perform__section sq-perform__pads");
  const head = el("div", "sq-perform__sechead");
  head.appendChild(el("span", "sq-perform__sectitle", "havoc"));
  const edit = el("button", "sq-btn--ghost", "edit pads");
  edit.type = "button";
  edit.title = "what each pad's axes move";
  edit.addEventListener("click", openMacroPads);
  head.appendChild(edit);
  box.appendChild(head);
  const row = el("div", "sq-perform__padrow");
  for (const pad of macroPads()) {
    const wrap = el("div", "sq-perform__padwrap");
    const surface = el("div", "sq-macro__pad sq-perform__pad");
    const cursor = el("div", "sq-macro__cursor");
    surface.appendChild(cursor);
    surface.title = `${pad.name}: ${[...pad.x, ...pad.y].length} parameters`;
    attachPadSurface(pad, surface, cursor);
    const foot = el("div", "sq-perform__padfoot");
    foot.appendChild(el("span", "sq-perform__padname", pad.name));
    const latch = el("label", "sq-macro__latch");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = !!pad.latch;
    cb.addEventListener("change", () => { pad.latch = cb.checked; surface.classList.toggle("is-latched", pad.latch); });
    latch.append(cb, document.createTextNode(" latch"));
    foot.appendChild(latch);
    wrap.append(surface, foot);
    row.appendChild(wrap);
  }
  if (!macroPads().length) row.appendChild(el("div", "sq-perform__empty", "no pads yet: edit pads makes one"));
  box.appendChild(row);
  return box;
}

// ---- drawing -------------------------------------------------------------

/** What the drawn rack depends on; a change means a rebuild. */
function signature() {
  return JSON.stringify([
    state.tracks.map(t => [t.id, t.engineKey, t.name, t._perfStrip ? 1 : 0, t.el ? 1 : 0]),
    state.tracks.map(t => [
      Object.keys(t.lfoConfig || {}).filter(k => t.lfoConfig[k]?.enabled),
      Object.keys(t.automation || {}).filter(k => t.automation[k]?.enabled),
    ]),
    perform().scenes.map(s => [s.id, s.name]),
    macroPads().map(p => [p.id, p.name]),
    selectedTrack,
  ]);
}

function draw() {
  if (!rack) return;
  // Everything moved goes home first, and the labels an engine switch may
  // have rewritten while a row was away are rewritten again now that it is
  // back, before the cards take it out once more.
  for (const pad of macroPads()) releasePad(pad);
  restoreAll();
  for (const t of state.tracks) { try { updatePlaitsControlsVisibility(t); } catch {} }
  rack.replaceChildren();
  const top = el("div", "sq-perform__top");
  top.append(buildLauncher(), buildScenes());
  rack.appendChild(top);
  rack.appendChild(buildInstruments());
  const drawer = buildDrawer();
  if (drawer) rack.appendChild(drawer);
  rack.appendChild(buildFxRack());
  rack.appendChild(buildMods());
  rack.appendChild(buildPads());
  upgradeKnobs(rack);
  for (const t of state.tracks) refreshParamIndicators(t);
  drawnSig = signature();
  drawnPattern = state.activePattern;
  lastPainted = "";
  paintFilled();
  paintScenes();
  paintInputs();
  paintStages();
}

let redrawTimer = null;
function scheduleRedraw() {
  if (!rack || redrawTimer != null) return;
  redrawTimer = setTimeout(() => { redrawTimer = null; if (rack) draw(); }, 0);
}

/** After a settled edit: rebuild only when the rack's shape changed (a
 *  track added, renamed, re-engined or rebuilt under a merge; a stage
 *  added; an lfo or lane added or removed; a scene; a pad), never for a
 *  knob turn. */
function onSongEdited() {
  if (!rack) return;
  if (signature() !== drawnSig) scheduleRedraw();
  else { paintFilled(); paintScenes(); paintInputs(); paintStages(); }
}

// ---- keys ----------------------------------------------------------------
// Only while the rack is up, and never over vim (its own layer goes first)
// or a text field. The digits are the launcher's: they double as the
// piano's black keys in keyboard.js, which skips a key this layer took.

function onKeyDown(e) {
  if (!rack || state.vimMode || isTypingTarget(e.target)) return;
  if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
  const d = /^Digit(\d)$/.exec(e.code);
  if (d) {
    const n = (d[1] === "0" ? 10 : Number(d[1])) - 1;
    if (e.shiftKey) { const s = perform().scenes[n]; if (s) recallScene(s); }
    else launchPattern(n);
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  if (e.code === "Space") {
    e.preventDefault();
    e.stopPropagation();
    if (inJam()) jamTogglePlay(); else togglePlay();
  }
}

// ---- open / close --------------------------------------------------------

function tick() {
  if (!rack) return;
  paintLauncher();
  // The lanes belong to the pattern, so a switch (chain mode, a launch)
  // redraws the mods grid and the drawer's title.
  if (state.activePattern !== drawnPattern) scheduleRedraw();
  raf = requestAnimationFrame(tick);
}

export function setPerform(on) {
  const btn = document.getElementById("perform-toggle");
  if (on === !!rack) return;
  if (on) {
    const tracks = document.getElementById("tracks");
    if (!tracks) return;
    rack = el("section", "sq-perform");
    rack.id = "perform";
    tracks.parentNode.insertBefore(rack, tracks);
    document.body.classList.add("sq-perform-on");
    draw();
    window.addEventListener("seqbaby:songedited", onSongEdited);
    window.addEventListener("seqbaby:setapplied", scheduleRedraw);
    window.addEventListener("seqbaby:newset", scheduleRedraw);
    if (isDesktopKeyboard()) window.addEventListener("keydown", onKeyDown, true);
    barLineHooks.add(onBarLine);
    raf = requestAnimationFrame(tick);
    setStatus("perform: instruments, a stage rack with inputs per stage, mods, scenes. Number keys launch patterns, shift + number recalls a scene");
  } else {
    cancelAnimationFrame(raf);
    window.removeEventListener("seqbaby:songedited", onSongEdited);
    window.removeEventListener("seqbaby:setapplied", scheduleRedraw);
    window.removeEventListener("seqbaby:newset", scheduleRedraw);
    window.removeEventListener("keydown", onKeyDown, true);
    barLineHooks.delete(onBarLine);
    state.queuedScene = null;
    for (const pad of macroPads()) releasePad(pad);
    restoreAll();
    rack.remove();
    rack = null;
    document.body.classList.remove("sq-perform-on");
    for (const t of state.tracks) { try { updatePlaitsControlsVisibility(t); } catch {} refreshParamIndicators(t); }
  }
  btn?.setAttribute("aria-pressed", String(!!rack));
}

export function initPerform() {
  const btn = document.getElementById("perform-toggle");
  btn?.addEventListener("click", () => { setPerform(!rack); btn.blur(); });
}

// ---- persistence ---------------------------------------------------------

export function serializePerformState() {
  const idx = new Map(state.tracks.map((t, i) => [t.id, i]));
  return serializePerform(perform(), idx);
}

/**
 * @param {any} data the serialized block
 * @param {Track[]} [order] the tracks in the order the stored indices count
 *   along — the order the session file listed them in (see applyMacroPads).
 */
export function applyPerformState(data, order = state.tracks) {
  state.perform = readPerform(data, order.map(t => t.id), () => _nextSceneId++);
  state.queuedScene = null;
  if (!perform().scenes.some(s => s.id === selectedScene)) selectedScene = null;
  scheduleRedraw();
}
