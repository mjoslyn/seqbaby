// ---- cue: hearing a track on its own, apart from the mix -----------------------
//
// A DJ's headphone cue. A track's `cue` button sends it to a cue bus, and the
// cue bus goes somewhere the mix does not:
//
//   split   the mix summed to mono on the LEFT, the cue summed to mono on the
//           RIGHT. A splitter cable (or one ear of the headphones) is the
//           whole rig: nothing but the stereo output every device has.
//   multi   the mix on outputs 1/2 and the cue on another pair (3/4, 5/6 ...)
//           of an audio interface with more than two outputs.
//
//   track ─▶ rack.switchGain ─┬─▶ rack.gate ─▶ rack.output ─▶ mix
//                             └─▶ cue tap ─▶ cue bus ─▶ the cue's output
//
// The tap is before the rack's output gain, which is the crossfader on a mix
// deck's bus, so a deck is heard in the cue before it is brought in. And a
// cued track that is MUTED (or soloed out) still plays: the transport fires
// it, and its gate shuts it out of the mix, so it is in the headphones only.
// That is the point of a cue: hear it, then unmute it.
//
// Which tracks are cued and how the outputs are wired are this browser's, not
// the song's: nothing here is saved with a song, undone or shared in a jam.
// The mode, pair, level and blend are remembered per browser.

import { setStatus } from "./dom.js";
import { upgradeKnobs } from "./knob.js";
import { state } from "./state.js";

const KEY = "seqbaby.cue.v1";
export const CUE_MODES = ["off", "split", "multi"];

function load() {
  const d = { mode: "off", pair: 1, level: 0.8, blend: 0 };
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || "null");
    if (s && typeof s === "object") {
      if (CUE_MODES.includes(s.mode)) d.mode = s.mode;
      if (Number.isInteger(s.pair) && s.pair >= 1 && s.pair <= 15) d.pair = s.pair;
      if (Number.isFinite(s.level)) d.level = Math.max(0, Math.min(1, s.level));
      if (Number.isFinite(s.blend)) d.blend = Math.max(0, Math.min(1, s.blend));
    }
  } catch {}
  return d;
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(cue)); } catch {} }

// Module-local, not on `state`: this module is imported by signal.js and so
// can run before state.js has (an import cycle).
const cue = load();
/** The cue's settings, live. */
export function cueConfig() { return cue; }

/** Whether a cue output is switched on (the cue buttons mean something). */
export function cueActive() { return cue.mode !== "off"; }
/** Whether the transport should fire this track for the cue although it is muted. */
export function cuePlays(t) { return !!t._cue && cueActive(); }
/** How many outputs the device the browser plays through has. */
export function maxOutputs() { return state.audioCtx?.destination?.maxChannelCount || 2; }
/** The level law of the cue knob: the top is unity. */
export function cueGains(level, blend) {
  const l = Math.max(0, Math.min(1, level)), b = Math.max(0, Math.min(1, blend));
  return { cue: l * l * (1 - b), mix: l * l * b };
}

// ---- the output ----------------------------------------------------------------

/** @type {null | {bus: GainNode, cueG: GainNode, mixG: GainNode, sum: GainNode}} */
let nodes = null;
let route = [];            // the nodes of the mode in force, torn down on a change
let outTo = [];            // what the master's last node is connected to, by us
let speakers = true;       // false while a bounce or a listen renders in silence

function masterOut() { return state.masterLimiter || state.masterGain || null; }

function ensureNodes() {
  const ctx = state.audioCtx;
  if (nodes || !ctx) return nodes;
  const bus = ctx.createGain(), cueG = ctx.createGain(), mixG = ctx.createGain(), sum = ctx.createGain();
  bus.connect(cueG); cueG.connect(sum); mixG.connect(sum);
  nodes = { bus, cueG, mixG, sum };
  applyCueLevels(true);
  return nodes;
}

function applyCueLevels(now = false) {
  if (!nodes) return;
  const g = cueGains(cue.level, cue.blend);
  const t = state.audioCtx.currentTime;
  for (const [n, v] of [[nodes.cueG, g.cue], [nodes.mixG, g.mix]]) {
    try {
      if (now) n.gain.value = v;
      else n.gain.setTargetAtTime(v, t, 0.015);
    } catch {}
  }
}

/** A gain that sums whatever it is fed to `ch` channels, as speakers would. */
function fold(ctx, ch) {
  const g = ctx.createGain();
  g.channelCount = ch;
  g.channelCountMode = "explicit";
  g.channelInterpretation = "speakers";
  return g;
}

/**
 * Wire the master and the cue to the device, for the mode in force. The one
 * place the master's last node meets `ctx.destination`.
 */
export function wireOutput() {
  const ctx = state.audioCtx, out = masterOut();
  if (!ctx || !out) return;
  const dest = ctx.destination;
  for (const n of outTo) { try { out.disconnect(n); } catch {} }
  outTo = [];
  for (const n of route) { try { n.disconnect(); } catch {} }
  route = [];
  if (nodes) { try { nodes.sum.disconnect(); } catch {} }
  const link = (n) => { out.connect(n); outTo.push(n); };

  let mode = cue.mode;
  if (mode === "multi" && maxOutputs() < 4) mode = "off";       // the interface went away
  const stereo = () => {
    try { dest.channelCount = Math.min(2, dest.maxChannelCount); dest.channelCountMode = "explicit"; dest.channelInterpretation = "speakers"; } catch {}
  };
  if (!speakers) { stereo(); return; }
  if (mode === "off") { stereo(); link(dest); return; }

  const n = ensureNodes();
  link(n.mixG);
  if (mode === "split") {
    stereo();
    const merger = ctx.createChannelMerger(2);
    const l = fold(ctx, 1), r = fold(ctx, 1);
    link(l); l.connect(merger, 0, 0);
    n.sum.connect(r); r.connect(merger, 0, 1);
    merger.connect(dest);
    route = [l, r, merger];
    return;
  }
  // multi: the mix on 1/2, the cue on its own pair
  const pair = Math.max(1, Math.min(Math.floor(maxOutputs() / 2) - 1, cue.pair));
  const chans = Math.min(maxOutputs(), (pair + 1) * 2);
  try { dest.channelCount = chans; dest.channelCountMode = "explicit"; dest.channelInterpretation = "discrete"; } catch {}
  const merger = ctx.createChannelMerger(chans);
  // a splitter reads its input as discrete channels, so a mono signal would
  // reach one side only: fold to stereo first
  const mSt = fold(ctx, 2), cSt = fold(ctx, 2);
  const mSp = ctx.createChannelSplitter(2), cSp = ctx.createChannelSplitter(2);
  link(mSt); mSt.connect(mSp);
  mSp.connect(merger, 0, 0); mSp.connect(merger, 1, 1);
  n.sum.connect(cSt); cSt.connect(cSp);
  cSp.connect(merger, 0, pair * 2); cSp.connect(merger, 1, pair * 2 + 1);
  merger.connect(dest);
  route = [mSt, cSt, mSp, cSp, merger];
}

/** A silent render (bounce, the compose panel's listen): nothing reaches the device. */
export function speakersOff() { speakers = false; wireOutput(); }
export function speakersOn() { speakers = true; wireOutput(); }

// ---- the tracks ----------------------------------------------------------------

function syncTrack(t, audible) {
  const rack = t.fxRack, ctx = state.audioCtx;
  if (!rack || !ctx || !rack.switchGain) return;
  const now = ctx.currentTime;
  const want = cuePlays(t) && !t._leaving && !!ensureNodes();
  const rec = t._cueRec;
  if (rec && (!want || rec.from !== rack.switchGain)) {
    try { rec.g.gain.cancelScheduledValues(now); rec.g.gain.setTargetAtTime(0, now, 0.008); } catch {}
    setTimeout(() => { try { rec.from.disconnect(rec.g); } catch {} try { rec.g.disconnect(); } catch {} }, 80);
    t._cueRec = null;
  }
  if (want && !t._cueRec) {
    const g = ctx.createGain();
    g.gain.value = 0;
    try { rack.switchGain.connect(g); g.connect(nodes.bus); g.gain.setTargetAtTime(1, now, 0.008); } catch {}
    t._cueRec = { g, from: rack.switchGain };
  }
  // out of the mix while it is cued and would not otherwise be heard
  const shut = want && !audible;
  if (rack.gate && rack._cueShut !== shut) {
    rack._cueShut = shut;
    try { rack.gate.gain.cancelScheduledValues(now); rack.gate.gain.setTargetAtTime(shut ? 0 : 1, now, 0.008); } catch {}
  }
}

/**
 * Make every track's cue tap and gate agree with its cue button, the mode
 * and who is muted. Called by signal.js after anything that changes any of
 * those, or rebuilds a rack.
 * @param {Set<any> | null} soloAudible  signal.js's soloAudibleTracks()
 */
export function syncCue(soloAudible) {
  for (const t of state.tracks) {
    // a bus has no triggers to withhold: its mute cuts its audio (BusVoice)
    const audible = t.engineKey === "bus" ? true : (soloAudible ? soloAudible.has(t) : !t.muted);
    syncTrack(t, audible);
  }
  document.body.classList.toggle("sq-cue-on", cueActive());
}

// `var` with no initializer: signal.js sets it while this module may still
// be waiting to run (the cycle above), and a `let` would not exist yet.
var resyncFn;
function resync() { resyncFn?.(); }
/** signal.js hands over its "sync the cue with the mutes" (no import cycle). */
export function setCueResync(fn) { resyncFn = fn; }

export function paintCueButton(t) {
  const b = t.el?.querySelector(".sq-track__cue");
  if (b) b.setAttribute("aria-pressed", String(!!t._cue));
}

export function toggleCue(t, on = !t._cue) {
  t._cue = !!on;
  paintCueButton(t);
  resync();
  try { window.dispatchEvent(new CustomEvent("seqbaby:cue")); } catch {}
}

export function clearCues() {
  for (const t of state.tracks) if (t._cue) { t._cue = false; paintCueButton(t); }
  resync();
  try { window.dispatchEvent(new CustomEvent("seqbaby:cue")); } catch {}
}

/** Change the cue's settings (any of mode, pair, level, blend). */
export function setCue(patch = {}) {
  const c = cue;
  const rewire = ("mode" in patch && patch.mode !== c.mode) || ("pair" in patch && patch.pair !== c.pair);
  if ("mode" in patch && CUE_MODES.includes(patch.mode)) {
    if (patch.mode === "multi" && state.audioCtx && maxOutputs() < 4) {
      setStatus(`this output has ${maxOutputs()} channels: a cue pair needs an interface with 4 or more. Use split mono, or make the interface the system's output`, true);
    } else c.mode = patch.mode;
  }
  if ("pair" in patch && Number.isFinite(patch.pair)) c.pair = Math.max(1, Math.min(15, Math.round(patch.pair)));
  if ("level" in patch && Number.isFinite(patch.level)) c.level = Math.max(0, Math.min(1, patch.level));
  if ("blend" in patch && Number.isFinite(patch.blend)) c.blend = Math.max(0, Math.min(1, patch.blend));
  save();
  if (rewire) wireOutput();
  applyCueLevels();
  resync();
  syncCueUI();
}

// ---- the panel -----------------------------------------------------------------

let open = null;

function syncCueUI() {
  const btn = document.getElementById("cue-btn");
  if (btn) {
    btn.classList.toggle("is-on", cueActive());
    btn.setAttribute("aria-pressed", String(cueActive()));
  }
  document.body.classList.toggle("sq-cue-on", cueActive());
  open?.sync();
}

function pairLabel(p) { return `outputs ${p * 2 + 1} / ${p * 2 + 2}`; }

export function openCuePanel() {
  if (open) return;
  const overlay = document.createElement("div");
  overlay.className = "sq-modal-overlay sq-setrec-ignore";
  const modal = document.createElement("div");
  modal.className = "sq-modal sq-panel__modal sq-cue__modal";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-label", "cue");
  modal.innerHTML = `
    <div class="sq-panel__modal-title">cue</div>
    <p class="sq-cue__hint">hear a track on its own before it is in the mix. Switch an output on here, then press <b>cue</b> on any track, bus or deck. A cued track that is muted plays in the cue only.</p>
    <div class="sq-cue__modes" role="radiogroup" aria-label="cue output">
      <label class="sq-cue__mode"><input type="radio" name="sq-cue-mode" value="off" /><span><b>off</b><i>the mix in stereo, no cue</i></span></label>
      <label class="sq-cue__mode"><input type="radio" name="sq-cue-mode" value="split" /><span><b>split mono</b><i>the mix on the left, the cue on the right. A splitter cable, or one ear each</i></span></label>
      <label class="sq-cue__mode"><input type="radio" name="sq-cue-mode" value="multi" /><span><b>audio interface</b><i>the mix on outputs 1 / 2, the cue on <select class="sq-cue__pair" aria-label="cue outputs"></select></i></span></label>
    </div>
    <p class="sq-cue__dev"></p>
    <div class="sq-cue__row">
      <div class="sq-field"><label>level</label><input class="p-cue-level" type="range" min="0" max="1" step="0.01" value="0.8" title="how loud the cue is" aria-label="cue level" /></div>
      <div class="sq-field"><label>cue / mix</label><input class="p-cue-blend" type="range" min="0" max="1" step="0.01" value="0" title="what the cue output carries: the cued tracks alone at the left, the mix alone at the right, both in between" aria-label="cue to mix blend" /></div>
    </div>
    <div class="sq-cue__tools"><span class="sq-cue__count"></span><button type="button" class="sq-btn--ghost sq-cue__clear">clear cues</button></div>
    <button type="button" class="sq-panel__modal-close">done</button>`;
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  const q = (s) => modal.querySelector(s);
  const pairSel = q(".sq-cue__pair");
  const level = q(".p-cue-level"), blend = q(".p-cue-blend");

  const sync = () => {
    const c = cue, max = maxOutputs();
    for (const r of modal.querySelectorAll('input[name="sq-cue-mode"]')) r.checked = r.value === c.mode;
    const pairs = Math.max(1, Math.floor(max / 2) - 1);
    pairSel.innerHTML = "";
    for (let p = 1; p <= Math.max(pairs, max >= 4 ? 1 : 1); p++) {
      const o = document.createElement("option");
      o.value = String(p); o.textContent = pairLabel(p);
      pairSel.appendChild(o);
    }
    pairSel.value = String(Math.min(c.pair, pairs));
    const multi = q('input[value="multi"]');
    const ready = !!state.audioCtx;
    multi.disabled = ready && max < 4;
    pairSel.disabled = multi.disabled;
    q(".sq-cue__dev").textContent = !ready
      ? "the output is read once audio has started: press play once"
      : max < 4
        ? `this output has ${max} channels. For a cue pair, make a 4-output (or bigger) interface the system's sound output and reload`
        : `this output has ${max} channels`;
    level.value = String(c.level); blend.value = String(c.blend);
    const n = state.tracks.filter((t) => t._cue).length;
    q(".sq-cue__count").textContent = n ? `${n} cued` : "nothing cued";
    q(".sq-cue__clear").disabled = !n;
  };

  modal.addEventListener("change", (e) => {
    const el = e.target;
    if (el instanceof HTMLInputElement && el.name === "sq-cue-mode") setCue({ mode: el.value });
    else if (el === pairSel) setCue({ pair: Number(pairSel.value) });
  });
  level.addEventListener("input", () => setCue({ level: Number(level.value) }));
  blend.addEventListener("input", () => setCue({ blend: Number(blend.value) }));
  q(".sq-cue__clear").addEventListener("click", () => { clearCues(); sync(); });
  const onCue = () => sync();
  window.addEventListener("seqbaby:cue", onCue);

  const close = () => {
    if (!open) return;
    document.removeEventListener("keydown", esc);
    window.removeEventListener("seqbaby:cue", onCue);
    overlay.remove();
    open = null;
  };
  const esc = (e) => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", esc);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  q(".sq-panel__modal-close").addEventListener("click", close);
  open = { sync, close };
  sync();
  upgradeKnobs(overlay);
}

export function initCue() {
  document.getElementById("cue-btn")?.addEventListener("click", () => openCuePanel());
  syncCueUI();
}
