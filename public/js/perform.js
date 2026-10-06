/**
 * The perform view — a rack for playing a song rather than writing it.
 *
 * A strip per track (name, meter, vol, mute, solo, the knobs pinned to it,
 * and a throw button per fx stage), a pattern launcher, a scene bank and the
 * macro pads docked beside them. The `perform` button in the transport is a
 * toggle; the track list is hidden while it is up and comes back exactly as
 * it was when it goes down.
 *
 * Three decisions carry the design:
 *
 *   - **It is a view over the real controls, not a second control surface.**
 *     Every parameter in the studio is one native range input with a shadowed
 *     `value` accessor (knob.js), and undo, the jam, p-lock, knob recording,
 *     the modulation needle, the owner dots and the right-click menu all hang
 *     off that element. A rack that drew its own knobs and forwarded values
 *     would have to re-plumb all of that. So the rack MOVES the element — the
 *     control's `.sq-field` wrapper — into the strip, leaving a comment anchor
 *     where it was, the way `openPanelAsModal` moves a whole panel, and puts
 *     it back on the way out. The strip is stamped `data-track-id`, so
 *     `controlForKey` and `trackRoots` (paramTargets.js) keep resolving the
 *     control wherever it sits, and the few repaints that look a control up
 *     under `t.el` fall back to `t._perfStrip.el`.
 *
 *   - **A scene is the performance subset, written through the controls.** It
 *     holds mute and solo per track, the pattern, and the pinned knobs' values
 *     — not the whole sound, which is p-lock's job. Recalling one writes each
 *     value through the control's own `input` event (momentary.js's
 *     `writeParam` with `commit`), so it is an undo step, it reaches a jam and
 *     it lands in the p-lock snapshot without any of those learning what a
 *     scene is. While the transport runs a recall waits for the bar line
 *     (`barLineHooks`, transport.js), like a launched pattern.
 *
 *   - **A throw is a momentary pad with one parameter.** Holding the button
 *     pushes a stage's wet to the throw level through momentary.js and lets
 *     it spring back, and signal.js keeps a held stage wired in, so a reverb
 *     throw on a dry track is heard. Nothing is committed, so a jam does not
 *     hear it — a throw is this screen's, as play and stop are.
 *
 * Pins and scenes are the song's (`state.perform`, serialized beside the
 * macro pads by track index — performStore.js); which strip shows what is
 * part of how a set is played.
 */

import { canAutomate } from "./automation.js";
import { FX_STAGE_LABELS, PATTERN_COUNT, autoLabel, fxChainOrder, fxStageLevel, fxStageOf } from "./constants.js";
import { setStatus } from "./dom.js";
import { flushHistory } from "./history.js";
import { inJam, jamTogglePlay } from "./jam.js";
import { isDesktopKeyboard, isTypingTarget } from "./keyboard.js";
import { upgradeKnobs } from "./knob.js";
import { attachPadSurface, macroPads, openMacroPads, releasePad } from "./macro.js";
import { holdParam, readUnit, releaseAllHolds, releaseParam, writeParam } from "./momentary.js";
import { controlForKey, fxShown, hasAutomation, hasMacroOn, modOwns, refreshParamIndicators } from "./paramTargets.js";
import { updatePlaitsControlsVisibility } from "./params.js";
import { emptyPerform, readPerform, serializePerform } from "./performStore.js";
import { setMute, setSolo } from "./render.js";
import { isPatternNonEmpty, queuePatternSwitch, requestPatternSwitch, state, switchPattern } from "./state.js";
import { barLineHooks, togglePlay } from "./transport.js";

/** @typedef {import("./types.js").Track} Track */

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** The track colours the step grids use (style.css, `#tracks > .sq-track:nth-child(8n+k)`). */
const TRACK_HUES = [35, 232, 297, 120, 253, 318, 155, 275];
/** The two classic throws, offered on every strip whether or not the stage is on the track. */
const ALWAYS_THROWS = ["delay", "reverb"];
/** A control's wrapper: the track head's `.sq-field` (a div with a label and
 *  the input), or the panels' `<label class="sq-fx__ctl">` idiom (a label
 *  wrapping a span and the input). Either moves as one. */
const FIELD_SEL = "label, .sq-field";

let rack = null;                 // the #perform element while the view is up
/** @type {{field: Element, anchor: Comment}[]} */
let moved = [];
let drawnSig = "";
let throwLevel = 0.8;
let quantize = true;
let selectedScene = null;
let _nextSceneId = 1;
let raf = 0;
let lastPainted = "";

// ---- model ---------------------------------------------------------------

export function perform() {
  if (!state.perform || typeof state.perform !== "object") state.perform = emptyPerform();
  if (!Array.isArray(state.perform.pins)) state.perform.pins = [];
  if (!Array.isArray(state.perform.scenes)) state.perform.scenes = [];
  return state.perform;
}

export function isPerformOpen() { return !!rack; }

const trackById = (id) => state.tracks.find(t => t.id === id) || null;

/** A key a strip can hold: automatable on this engine and behind a range
 *  input with a field wrapper of its own. A copy's control (`fx.delay#2`)
 *  is resolved through its row, which a moved field has left, so copies
 *  stay in the rack panel. */
function pinnable(t, key) {
  if (!canAutomate(t, key) || key.includes("#")) return false;
  const el = controlForKey(t, key);
  return !!el && el.type === "range" && !!el.closest(FIELD_SEL);
}

/** What a strip shows before anyone has pinned anything to it: the cutoff
 *  and every engaged stage's level. */
function defaultPins(t) {
  const out = [];
  if (pinnable(t, "cutoff")) out.push("cutoff");
  for (const id of fxChainOrder(t.fxConfig)) {
    const st = fxStageOf(id);
    if (!st || st === "gain" || st === "pan" || id.includes("#")) continue;
    if (fxStageLevel(t.fxConfig, id) > 0 && pinnable(t, `fx.${id}`)) out.push(`fx.${id}`);
  }
  return out;
}

/** The keys pinned to a track's strip, explicit ones winning over the defaults. */
export function pinsFor(t) {
  const explicit = perform().pins.filter(p => p.trackId === t.id).map(p => p.key);
  if (explicit.length) return explicit.filter(k => pinnable(t, k));
  return defaultPins(t);
}

export function isPinned(t, key) { return pinsFor(t).includes(key); }

/** Whether the right-click menu may offer to pin this control. */
export function canPin(t, key) { return !!t && !!key && pinnable(t, key); }

/** Pin or unpin. The first explicit change on a track starts from what the
 *  strip was showing, so unpinning a default leaves the rest of them. */
export function setPinned(t, key, on) {
  if (!canPin(t, key)) return false;
  const perf = perform();
  const cur = pinsFor(t);
  const next = on ? (cur.includes(key) ? cur : [...cur, key]) : cur.filter(k => k !== key);
  perf.pins = perf.pins.filter(p => p.trackId !== t.id).concat(next.map(k => ({ trackId: t.id, key: k })));
  // An unpin that empties the list would fall back to the defaults, which
  // include what was just unpinned: keep an explicit empty list as a marker.
  if (!next.length) perf.pins.push({ trackId: t.id, key: "" });
  scheduleRedraw();
  return true;
}

// ---- scenes --------------------------------------------------------------

function captureScene(name) {
  const perf = perform();
  const scene = {
    id: _nextSceneId++,
    name: name || `scene ${perf.scenes.length + 1}`,
    pattern: state.activePattern,
    tracks: state.tracks.map(t => ({ trackId: t.id, muted: !!t.muted, soloed: !!t.soloed })),
    knobs: [],
  };
  for (const t of state.tracks) {
    for (const key of pinsFor(t)) {
      const unit = readUnit(t, key);
      if (unit != null) scene.knobs.push({ trackId: t.id, key, unit });
    }
  }
  perf.scenes.push(scene);
  return scene;
}

/** Overwrite a scene with the state as it is now, keeping its name. */
function updateScene(scene) {
  const fresh = captureScene(scene.name);
  perform().scenes.pop();
  Object.assign(scene, { pattern: fresh.pattern, tracks: fresh.tracks, knobs: fresh.knobs });
}

/** Write a scene's mutes, solos and knobs. The pattern is the caller's. */
function applyScene(scene) {
  for (const x of scene.tracks) {
    const t = trackById(x.trackId);
    if (!t) continue;
    // Solo and mute exclude each other in the UI, so the order matters: a
    // track soloed in the scene is unmuted first, one muted is unsoloed first.
    if (x.soloed) { setMute(t, false); setSolo(t, true); }
    else { setSolo(t, false); setMute(t, !!x.muted); }
  }
  for (const k of scene.knobs) {
    const t = trackById(k.trackId);
    if (!t || !canAutomate(t, k.key)) continue;
    // Committed through the control, so this is an edit like any other.
    writeParam(t, k.key, k.unit, 0.02, true);
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
    setStatus(`scene "${scene.name}"`);
  }
  paintScenes();
}

/** The bar line: land the queued scene. The pattern it queued is consumed by
 *  the transport right after this, in the same callback. */
function onBarLine() {
  if (state.queuedScene == null) return;
  const scene = perform().scenes.find(s => s.id === state.queuedScene);
  state.queuedScene = null;
  if (scene) applyScene(scene);
}

// ---- the view ------------------------------------------------------------

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function moveField(control, slot) {
  const field = control.closest(FIELD_SEL);
  if (!field || field.closest("#perform")) return null;
  const anchor = document.createComment("perform-anchor");
  field.replaceWith(anchor);
  slot.appendChild(field);
  moved.push({ field, anchor });
  return field;
}

function restoreFields() {
  for (const { field, anchor } of moved) {
    // The anchor's track may have been torn down since (a session arrived);
    // then the field goes with it.
    if (anchor.parentNode) anchor.replaceWith(field); else field.remove();
  }
  moved = [];
  for (const t of state.tracks) t._perfStrip = null;
}

/** A throw's key, or why it cannot be thrown right now. */
function throwBlocked(t, key) {
  if (modOwns(t, key)) return "has an LFO on it";
  if (hasAutomation(t, key)) return "has an automation lane";
  if (hasMacroOn(t, key)) return "is on a havoc pad";
  return null;
}

function throwsFor(t) {
  const out = [];
  const seen = new Set();
  const add = (id) => {
    const st = fxStageOf(id);
    if (!st || st === "gain" || st === "pan" || seen.has(id)) return;
    const key = `fx.${id}`;
    if (!canAutomate(t, key)) return;
    seen.add(id);
    const n = id.split("#")[1];
    out.push({ id, key, label: FX_STAGE_LABELS[st] + (n ? ` ${n}` : "") });
  };
  for (const id of fxChainOrder(t.fxConfig)) {
    if (fxStageLevel(t.fxConfig, id) > 0 || fxShown(t).has(id)) add(id);
  }
  for (const id of ALWAYS_THROWS) add(id);
  return out;
}

function wireThrow(btn, t, key) {
  let held = null;
  const end = (e) => {
    if (held == null || (e && e.pointerId !== held)) return;
    held = null;
    try { btn.releasePointerCapture(e.pointerId); } catch {}
    btn.classList.remove("is-held");
    releaseParam(t, key);
  };
  btn.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (held != null) return;
    const why = throwBlocked(t, key);
    if (why) { setStatus(`${autoLabel(key)} on "${t.name}" ${why}, so it can't be thrown`, true); return; }
    e.preventDefault();
    held = e.pointerId;
    try { btn.setPointerCapture(e.pointerId); } catch {}
    btn.classList.add("is-held");
    // Never below where the knob already is: a throw adds, it does not duck.
    holdParam(t, key, Math.max(throwLevel, readUnit(t, key) ?? 0));
  });
  btn.addEventListener("pointerup", end);
  btn.addEventListener("pointercancel", end);
  btn.addEventListener("lostpointercapture", end);
}

function buildStrip(t, i) {
  const strip = el("div", "sq-perform__strip");
  strip.dataset.trackId = String(t.id);
  strip.style.setProperty("--track-hue", String(TRACK_HUES[i % TRACK_HUES.length]));
  if (t.voice?.type === "bus" || t.engineKey === "bus") strip.classList.add("is-bus");

  const head = el("div", "sq-perform__head");
  head.appendChild(el("span", "sq-perform__name", t.name || `track ${i + 1}`));
  const mute = el("button", "sq-perform__mute", "mute");
  const solo = el("button", "sq-perform__solo", "solo");
  mute.type = solo.type = "button";
  mute.addEventListener("click", () => setMute(t, !t.muted));
  solo.addEventListener("click", () => setSolo(t, !t.soloed));
  head.append(mute, solo);
  strip.appendChild(head);

  const paintMuteSolo = () => {
    mute.setAttribute("aria-pressed", String(!!t.muted));
    solo.setAttribute("aria-pressed", String(!!t.soloed));
    mute.disabled = !!t.soloed;
    solo.disabled = !!t.muted;
    strip.classList.toggle("is-muted", !!t.muted);
    strip.classList.toggle("is-soloed", !!t.soloed);
  };
  t._perfStrip = { el: strip, paintMuteSolo };
  paintMuteSolo();

  // vol + meter: the track head's own field, meter inside it.
  const volSlot = el("div", "sq-perform__vol");
  const vol = t.el?.querySelector(".p-vol");
  if (vol) {
    moveField(vol, volSlot);
    const meter = volSlot.querySelector(".sq-track__meter");
    if (meter) t._meterEl = meter;
  }
  strip.appendChild(volSlot);

  const knobs = el("div", "sq-perform__knobs");
  for (const key of pinsFor(t)) {
    const ctl = controlForKey(t, key);
    if (!ctl) continue;
    const pin = el("div", "sq-perform__pin");
    pin.dataset.key = key;
    pin.title = `${autoLabel(key)}. Right-click (long-press) for its lfo, lane, pad, and to unpin it`;
    pin.appendChild(el("span", "sq-perform__cap", autoLabel(key)));
    if (moveField(ctl, pin)) knobs.appendChild(pin);
  }
  if (!knobs.children.length) knobs.appendChild(el("div", "sq-perform__nopins", "right-click a knob in the studio to pin it here"));
  strip.appendChild(knobs);

  const throws = el("div", "sq-perform__throws");
  for (const th of throwsFor(t)) {
    const b = el("button", "sq-perform__throw", th.label);
    b.type = "button";
    b.title = `hold: ${th.label} to ${Math.round(throwLevel * 100)}%, back when you let go`;
    wireThrow(b, t, th.key);
    throws.appendChild(b);
  }
  strip.appendChild(throws);
  return strip;
}

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
  cap.title = "a scene: every track's mute and solo, the pattern, and the pinned knobs as they are now (shift + number recalls one)";
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
  if (!scenes.length) list.appendChild(el("div", "sq-perform__nopins", "capture one to come back to this moment later"));
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
  const box = el("div", "sq-perform__pads");
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
  if (!macroPads().length) row.appendChild(el("div", "sq-perform__nopins", "no pads yet: edit pads makes one"));
  box.appendChild(row);
  return box;
}

function buildTop() {
  const top = el("div", "sq-perform__top");
  top.appendChild(buildLauncher());
  top.appendChild(buildScenes());
  const lvl = el("div", "sq-perform__throwlevel");
  lvl.innerHTML = `<div class="sq-field"><label>throw</label><input class="sq-perform__throwlevel-in" type="range" min="0" max="1" step="0.01" value="${throwLevel}" title="how far a throw button pushes a stage's wet" /></div>`;
  lvl.querySelector("input").addEventListener("input", (e) => { throwLevel = Number(e.target.value); });
  top.appendChild(lvl);
  return top;
}

/** What the drawn rack depends on; a change means a rebuild. */
function signature() {
  const perf = perform();
  return JSON.stringify([
    state.tracks.map(t => [t.id, t.engineKey, t.name, t._perfStrip?.el ? 1 : 0]),
    perf.pins, perf.scenes.map(s => [s.id, s.name]),
    macroPads().map(p => [p.id, p.name]),
    state.tracks.map(t => throwsFor(t).map(x => x.id)),
  ]);
}

function draw() {
  if (!rack) return;
  // Everything moved goes home first, and the labels the engine switch may
  // have rewritten while a field was away are rewritten again now that it
  // is back, before the strips take it out once more.
  releaseAllHolds();
  for (const pad of macroPads()) releasePad(pad);
  restoreFields();
  for (const t of state.tracks) { try { updatePlaitsControlsVisibility(t); } catch {} }
  rack.replaceChildren();
  rack.appendChild(buildTop());
  const strips = el("div", "sq-perform__strips");
  state.tracks.forEach((t, i) => strips.appendChild(buildStrip(t, i)));
  rack.appendChild(strips);
  rack.appendChild(buildPads());
  upgradeKnobs(rack);
  for (const t of state.tracks) refreshParamIndicators(t);
  drawnSig = signature();
  lastPainted = "";
  paintFilled();
  paintScenes();
}

let redrawTimer = null;
function scheduleRedraw() {
  if (!rack || redrawTimer != null) return;
  redrawTimer = setTimeout(() => { redrawTimer = null; if (rack) draw(); }, 0);
}

/** After a settled edit: rebuild only when the rack's shape changed (a
 *  track added, renamed, re-engined or rebuilt under a merge; a pin, a
 *  scene, a pad), never for a knob turn. */
function onSongEdited() {
  if (!rack) return;
  if (signature() !== drawnSig) scheduleRedraw();
  else { paintFilled(); paintScenes(); }
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
    setStatus("perform: strips, patterns, scenes, throws. Number keys launch patterns, shift + number recalls a scene");
  } else {
    cancelAnimationFrame(raf);
    window.removeEventListener("seqbaby:songedited", onSongEdited);
    window.removeEventListener("seqbaby:setapplied", scheduleRedraw);
    window.removeEventListener("seqbaby:newset", scheduleRedraw);
    window.removeEventListener("keydown", onKeyDown, true);
    barLineHooks.delete(onBarLine);
    state.queuedScene = null;
    releaseAllHolds();
    for (const pad of macroPads()) releasePad(pad);
    restoreFields();
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
