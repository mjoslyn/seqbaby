/**
 * The performance cluster in the transport: the fill button and the mute
 * scenes. Both are things a hand does while the song plays, and neither is a
 * parameter of any track.
 *
 * **Fill** is `state.fill`, read by the transport for every written step that
 * carries a trig condition (trigCond.js): while it is true the steps marked
 * "fill only" play and the ones marked "not in a fill" rest. Hold the button
 * for as long as the fill should last; a quick tap latches it until the next
 * tap. Performance state: not saved, not undone, not shared in a jam. A
 * recorded live set does carry it (setRecorder.js samples it every step).
 *
 * **Mute scenes** are four stored sets of muted tracks. A tap on an empty
 * slot stores the mutes as they stand; a tap on a stored one puts them in
 * force at once, and a second tap on it puts back the mutes it replaced, so a
 * drop is two taps: everything but the kick out, everything back. Shift-click
 * (or a long press) stores over a slot, alt-click (or a right-click) clears
 * it. The scenes are the song's (`muteScenes`, by track index, as the macro
 * pads store their tracks); which one is in force is not.
 */
import { setStatus } from "./dom.js";
import { ICON_LIVE } from "./icons.js";
import { applyBusMute, refreshMuteSoloUI } from "./render.js";
import { refreshNoiseBeds, releaseSilencedTracks } from "./signal.js";
import { inSong, state } from "./state.js";

/** @typedef {import("./types.js").Track} Track */

export const MUTE_SCENE_COUNT = 4;

// ---- fill -------------------------------------------------------------------

/** Set the fill state and paint the button. */
export function setFill(on) {
  state.fill = !!on;
  const btn = document.getElementById("fill-btn");
  if (btn) {
    btn.classList.toggle("is-on", state.fill);
    btn.setAttribute("aria-pressed", String(state.fill));
    if (!state.fill) btn.classList.remove("is-latched");
  }
}

const TAP_MS = 260;

function initFill() {
  const btn = document.getElementById("fill-btn");
  if (!btn) return;
  let downAt = 0, wasOn = false, held = false;
  btn.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    held = true;
    downAt = performance.now();
    wasOn = state.fill;
    try { btn.setPointerCapture(e.pointerId); } catch {}
    setFill(true);
    e.preventDefault();
  });
  const up = () => {
    if (!held) return;
    held = false;
    // A quick tap latches (or lets a latched fill go); a hold ends with it.
    const tap = performance.now() - downAt < TAP_MS;
    setFill(tap ? !wasOn : false);
    btn.classList.toggle("is-latched", tap && !wasOn);
  };
  btn.addEventListener("pointerup", up);
  btn.addEventListener("pointercancel", up);
  // The keyboard's enter / space has no hold to give: it toggles.
  btn.addEventListener("click", (e) => { if (e.detail === 0) { setFill(!state.fill); btn.classList.toggle("is-latched", state.fill); } });
  btn.addEventListener("contextmenu", (e) => e.preventDefault());
}

// ---- mute scenes --------------------------------------------------------------

const mutedIds = () => state.tracks.filter(t => inSong(t) && t.muted).map(t => t.id);

/** Mute exactly the tracks in `ids` (of the song's own), through everything a mute button does. */
function applyMutes(ids) {
  const set = new Set(ids);
  for (const t of state.tracks) {
    if (!inSong(t)) continue;
    const want = set.has(t.id);
    if (!!t.muted === want) continue;
    t.muted = want;
    if (want) t.soloed = false;          // a track is muted or soloed, never both
    refreshMuteSoloUI(t);
    applyBusMute(t);
  }
  refreshNoiseBeds();
  releaseSilencedTracks();
}

/** Store the mutes as they stand into slot `i`. */
export function storeMuteScene(i) {
  if (i < 0 || i >= MUTE_SCENE_COUNT) return;
  const ids = mutedIds();
  state.muteScenes[i] = ids;
  state._muteScene = i;
  state._muteBefore = null;
  paintMuteScenes();
  setStatus(`mute scene ${i + 1} stored: ${ids.length ? `${ids.length} muted` : "everything on"}`);
}

/** Empty slot `i`. */
export function clearMuteScene(i) {
  if (!state.muteScenes[i]) return;
  state.muteScenes[i] = null;
  if (state._muteScene === i) { state._muteScene = -1; state._muteBefore = null; }
  paintMuteScenes();
  setStatus(`mute scene ${i + 1} cleared`);
}

/**
 * Put scene `i` in force, or, when it already is, put back the mutes it
 * replaced. An empty slot stores instead.
 */
export function tapMuteScene(i) {
  if (i < 0 || i >= MUTE_SCENE_COUNT) return;
  const scene = state.muteScenes[i];
  if (!scene) { storeMuteScene(i); return; }
  if (state._muteScene === i && state._muteBefore) {
    applyMutes(state._muteBefore);
    state._muteScene = -1;
    state._muteBefore = null;
    setStatus(`mute scene ${i + 1} off`);
  } else {
    // going scene to scene keeps the mutes from before the first one
    if (state._muteScene < 0 || !state._muteBefore) state._muteBefore = mutedIds();
    applyMutes(scene);
    state._muteScene = i;
    setStatus(`mute scene ${i + 1}`);
  }
  paintMuteScenes();
}

/**
 * Put scene `i` in force, or with -1 put back the mutes from before any scene.
 * Idempotent, where a tap toggles: for a caller that says which scene it
 * wants rather than pressing a button (window.seqbaby.perform, a game driving
 * the engine from a hidden frame). An empty slot is left alone.
 */
export function setMuteScene(i) {
  if (i === state._muteScene) return;
  if (i == null || i < 0) {
    if (state._muteBefore) applyMutes(state._muteBefore);
    state._muteScene = -1;
    state._muteBefore = null;
  } else {
    const scene = i < MUTE_SCENE_COUNT ? state.muteScenes[i] : null;
    if (!scene) return;
    if (state._muteScene < 0 || !state._muteBefore) state._muteBefore = mutedIds();
    applyMutes(scene);
    state._muteScene = i;
  }
  paintMuteScenes();
}

function paintMuteScenes() {
  const box = document.getElementById("mute-scenes");
  if (!box) return;
  for (const b of box.querySelectorAll("button[data-scene]")) {
    const i = Number(b.dataset.scene);
    const scene = state.muteScenes[i];
    const live = new Set(state.tracks.filter(inSong).map(t => t.id));
    const n = scene ? scene.filter(id => live.has(id)).length : 0;
    b.classList.toggle("is-set", !!scene);
    b.setAttribute("aria-pressed", String(state._muteScene === i));
    b.title = scene
      ? `mute scene ${i + 1}: ${n ? `${n} track${n === 1 ? "" : "s"} muted` : "everything on"}. Click to switch to it, click again to go back. Shift-click stores the current mutes over it, alt-click clears it`
      : `mute scene ${i + 1}: empty. Click to store which tracks are muted right now`;
  }
}

/** The scenes in the session format (track indices), or undefined when all are empty. */
export function serializeMuteScenes() {
  if (!state.muteScenes.some(Boolean)) return undefined;
  const idx = new Map(state.tracks.map((t, i) => [t.id, i]));
  return state.muteScenes.map(s => s ? s.filter(id => idx.has(id)).map(id => idx.get(id)) : null);
}

/**
 * @param {any} data serialized scenes @param {Track[]} [order] the tracks the
 *   stored indices count along (applyMacroPads's reason)
 */
export function applyMuteScenes(data, order = state.tracks) {
  const out = [];
  for (let i = 0; i < MUTE_SCENE_COUNT; i++) {
    const s = Array.isArray(data) ? data[i] : null;
    out.push(Array.isArray(s) ? s.map(j => order[j]?.id).filter(id => id != null) : null);
  }
  state.muteScenes = out;
  state._muteScene = -1;
  state._muteBefore = null;
  paintMuteScenes();
}

function initMuteScenes() {
  const box = document.getElementById("mute-scenes");
  if (!box) return;
  let pressTimer = null, longPressed = false;
  box.addEventListener("pointerdown", (e) => {
    const b = e.target.closest?.("button[data-scene]");
    if (!b || e.pointerType !== "touch") return;
    longPressed = false;
    clearTimeout(pressTimer);
    pressTimer = setTimeout(() => { longPressed = true; storeMuteScene(Number(b.dataset.scene)); }, 550);
  });
  const cancel = () => clearTimeout(pressTimer);
  box.addEventListener("pointerup", cancel);
  box.addEventListener("pointercancel", cancel);
  box.addEventListener("pointerleave", cancel);
  box.addEventListener("click", (e) => {
    const b = e.target.closest?.("button[data-scene]");
    if (!b) return;
    if (longPressed) { longPressed = false; return; }      // the long press already stored
    const i = Number(b.dataset.scene);
    if (e.altKey) clearMuteScene(i);
    else if (e.shiftKey) storeMuteScene(i);
    else tapMuteScene(i);
  });
  box.addEventListener("contextmenu", (e) => {
    const b = e.target.closest?.("button[data-scene]");
    if (!b) return;
    e.preventDefault();
    if (!longPressed) clearMuteScene(Number(b.dataset.scene));
  });
  paintMuteScenes();
}

// ---- the phone's live menu ------------------------------------------------------
//
// Below 768px master, cue, the track switcher, fill and the mute scenes are
// hidden in the transport (style.css) and #perf-menu-btn hosts them in one
// modal. MOVED, not rebuilt, as openChordMenu moves the scale row: master.js,
// cue.js, trackSwitch.js and the listeners above all find their own elements
// by id, so nothing about them changes.

let _perfMenu = null;

/** The button is lit while anything behind it is on. */
export function syncPerformMenuBtn() {
  const btn = document.getElementById("perf-menu-btn");
  if (!btn) return;
  if (!btn.firstElementChild) btn.innerHTML = ICON_LIVE;
  const on = !!state.fill
    || !!document.querySelector("#master-btn.is-on, #cue-btn.is-on, #mute-scenes button[aria-pressed='true']");
  btn.setAttribute("aria-pressed", String(on));
}

export function openPerformMenu() {
  if (_perfMenu) return;
  const pick = (sel) => document.querySelector(sel);
  const rows = [
    ["the mix", [pick("#master-btn"), pick("#cue-btn")]],
    ["go to a track", [pick(".sq-track-switch")]],
    ["play", [pick("#perf")]],
  ].map(([label, els]) => [label, els.filter(Boolean)]).filter(([, els]) => els.length);
  if (!rows.length) return;
  const moved = rows.flatMap(([, els]) => els).map(el => ({ el, parent: el.parentNode, next: el.nextSibling }));

  const overlay = document.createElement("div");
  overlay.className = "sq-modal-overlay";
  const modal = document.createElement("div");
  modal.className = "sq-modal sq-perf__menu-modal";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  const title = document.createElement("div");
  title.className = "sq-modal__title";
  title.textContent = "live";
  modal.appendChild(title);
  for (const [label, els] of rows) {
    const row = document.createElement("div");
    row.className = "sq-perf__menu-row";
    const cap = document.createElement("span");
    cap.textContent = label;
    row.append(cap, ...els);
    modal.appendChild(row);
  }
  const note = document.createElement("div");
  note.className = "sq-modal__body";
  note.textContent = "fill: hold it, or tap to latch. mutes: tap an empty slot to store the mutes as they are, tap it again to go back, long-press to store over it.";
  modal.appendChild(note);
  const done = document.createElement("button");
  done.type = "button";
  done.className = "sq-panel__modal-close";
  done.textContent = "done";
  modal.appendChild(done);

  const close = () => {
    if (!_perfMenu) return;
    _perfMenu = null;
    for (const m of moved) {
      if (m.next && m.next.parentNode === m.parent) m.parent.insertBefore(m.el, m.next);
      else m.parent.appendChild(m.el);
    }
    overlay.remove();
    document.removeEventListener("keydown", esc);
    syncPerformMenuBtn();
  };
  const esc = (e) => { if (e.key === "Escape") close(); };
  done.addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  document.addEventListener("keydown", esc);
  // Drill down, do not stack: master and cue open panels of their own, and a
  // track picked here is one to look at, so each closes this first. Capture
  // phase, so the buttons are back in the transport before their own
  // handlers run (a click's path is fixed when it is dispatched).
  modal.addEventListener("click", (e) => { if (e.target.closest?.("#master-btn, #cue-btn")) close(); }, true);
  modal.addEventListener("change", (e) => { if (e.target.id === "track-switch") close(); });

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  _perfMenu = { close };
}

/** Wire the cluster. Called once from init(). */
export function initPerform() {
  initFill();
  initMuteScenes();
  document.getElementById("perf-menu-btn")?.addEventListener("click", openPerformMenu);
  syncPerformMenuBtn();
  // master and cue come and go with a song or a panel, not with this menu
  for (const ev of ["seqbaby:setapplied", "seqbaby:newset", "seqbaby:songedited"]) window.addEventListener(ev, () => setTimeout(syncPerformMenuBtn, 0));
}
