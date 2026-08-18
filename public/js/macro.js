/**
 * Macro pads — a Kaoss-pad style XY surface, several of them, each axis driving
 * a list of parameters that may span tracks.
 *
 * The point of the thing is the crossing of tracks: one thumb opening the
 * bass filter while ducking the lead's reverb is a move the mod matrix and the
 * automation lanes can't make, because both of those belong to a single track.
 *
 * Three decisions carry the design:
 *
 *   - **Assignments speak the automation namespace.** `AUTOMATION_TARGETS` is
 *     the superset of what can be driven — `canAutomate` is broader than
 *     `canModulate` precisely because it doesn't need an AudioParam behind the
 *     control — and `applyAutomationAtStep` already knows how to write every
 *     one of those keys, with a short ramp that is exactly what a pad wants.
 *     So a pad move is one call per assignment into code that already exists.
 *
 *   - **The knobs move.** An LFO deliberately writes around the slider and
 *     leaves it as the base, because you aren't looking at an LFO. A pad is a
 *     control you are staring at while you play it, so the assigned knobs
 *     sweep — otherwise you can't see what the gesture is doing.
 *
 *   - **Momentary is non-destructive by snapshot, not by avoidance.** Rather
 *     than route around the branches of `applyAutomationAtStep` that write
 *     `t.params` / `t.filter`, the pad records where every assigned parameter
 *     was when you touched it and ramps back there when you let go. Latch mode
 *     instead commits, by dispatching the ordinary `input` event each control
 *     already listens for — which is precisely "as if you had moved the knobs".
 *
 * Pads are global and are NOT part of the p-lock snapshot: a performance macro
 * that rearranged itself at every pattern switch would be unplayable.
 */

import { AUTOMATION_TARGETS, applyAutomationAtStep, canAutomate } from "./automation.js";
import { CLASS_FOR_AUTO, controlFromEventTarget, hasMacroOn, refreshParamIndicators, targetsForControl, trackForControl } from "./paramTargets.js";
import { state } from "./state.js";

/** @typedef {import("./types.js").Track} Track */
/** @typedef {import("./types.js").MacroAssign} MacroAssign */
/** @typedef {import("./types.js").MacroPad} MacroPad */

/** Ramp for a live pad move. Long enough not to zipper, short enough that the
 *  pad still feels connected to the finger. */
const MACRO_RAMP = 0.03;
/** Ramp back to base when a momentary gesture ends. */
const RELEASE_RAMP = 0.05;

let _nextPadId = 1;
let _modal = null;
/** Which axis, if any, is waiting for you to touch a control. */
let _learn = null;      // { padId, axis }

// ---- model ---------------------------------------------------------------

/** @returns {MacroPad} */
export function defaultMacroPad(n) {
  return { id: _nextPadId++, name: `pad ${n}`, latch: false, pos: { x: 0.5, y: 0.5 }, x: [], y: [] };
}

export function macroPads() {
  if (!Array.isArray(state.macroPads)) state.macroPads = [];
  return state.macroPads;
}

export function addMacroPad() {
  const pads = macroPads();
  const pad = defaultMacroPad(pads.length + 1);
  pads.push(pad);
  return pad;
}

export function removeMacroPad(id) {
  const pads = macroPads();
  const i = pads.findIndex(p => p.id === id);
  if (i >= 0) pads.splice(i, 1);
}

const trackById = (id) => state.tracks.find(t => t.id === id) || null;

export function assignmentsFor(t, autoKey) {
  const out = [];
  for (const pad of macroPads()) {
    for (const axis of ["x", "y"]) {
      for (const a of pad[axis]) if (a.trackId === t?.id && a.key === autoKey) out.push({ pad, axis, a });
    }
  }
  return out;
}

/** Attach a parameter to an axis, if nothing else already owns it. Returns the
 *  new assignment, or null with a reason. */
export function assignToAxis(pad, axis, t, autoKey) {
  if (!pad || !t || !canAutomate(t, autoKey)) return { ok: false, why: "this engine has no such parameter" };
  if (hasMacroOn(t, autoKey)) return { ok: false, why: "already on a macro pad" };
  const a = { trackId: t.id, key: autoKey, lo: 0, hi: 1, invert: false };
  pad[axis].push(a);
  refreshParamIndicators(t);
  return { ok: true, a };
}

export function unassign(pad, axis, a) {
  const i = pad[axis].indexOf(a);
  if (i < 0) return;
  // Put the parameter back where it was before pulling it off the axis,
  // otherwise a latched pad leaves it stranded mid-sweep.
  const t = trackById(a.trackId);
  if (t && a._base != null) writeParam(t, a.key, a._base, RELEASE_RAMP, true);
  pad[axis].splice(i, 1);
  if (t) refreshParamIndicators(t);
}

// ---- the control behind a parameter --------------------------------------
// Every one of the 162 automation keys maps to a control class (checked), so
// this always resolves for a track whose engine has that parameter.

function controlFor(t, key) {
  const cls = CLASS_FOR_AUTO[key];
  if (!cls || !t?.el) return null;
  // The track's own row is the canonical copy; panels reparented into modals
  // are still inside t.el, so one query covers both.
  return t.el.querySelector(`.${cls}`);
}

/** A control's value as the 0..1 an automation lane speaks. The lane and the
 *  slider share a range by construction — that is what makes a lane sweeping
 *  0→1 cover the same ground as dragging the slider end to end — so this
 *  inverse is just the slider's own normalisation. */
function readUnit(t, key) {
  const el = controlFor(t, key);
  if (!el) return null;
  const min = Number(el.min === "" ? 0 : el.min);
  const max = Number(el.max === "" ? 1 : el.max);
  if (!(max > min)) return null;
  return Math.max(0, Math.min(1, (Number(el.value) - min) / (max - min)));
}

/**
 * Drive one parameter to a 0..1 value: the audio graph through the automation
 * path, and the control itself so the knob follows the pad.
 * @param {boolean} commit dispatch the control's `input` event, making this the
 *   track's actual sound rather than a performance overlay.
 */
function writeParam(t, key, unit, ramp, commit) {
  const v = Math.max(0, Math.min(1, unit));
  const el = controlFor(t, key);
  if (el) {
    const min = Number(el.min === "" ? 0 : el.min);
    const max = Number(el.max === "" ? 1 : el.max);
    const step = Number(el.step === "" || el.step === "any" ? 0 : el.step);
    let phys = min + v * (max - min);
    if (step > 0) phys = min + Math.round((phys - min) / step) * step;
    // Assigning .value repaints the knob (knob.js shadows the accessor) without
    // running the control's own handler — which is what keeps a momentary move
    // out of the track's stored sound.
    el.value = String(phys);
  }
  if (commit && el) {
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return;
  }
  const ctx = state.audioCtx;
  if (!ctx) {
    // Before the first play there is no graph to write, so the control's own
    // handler is the only path — and it is safe, because nothing is sounding.
    el?.dispatchEvent(new Event("input", { bubbles: true }));
    return;
  }
  try { applyAutomationAtStep(t, key, v, ctx.currentTime, v, ramp); } catch {}
}

// ---- playing a pad -------------------------------------------------------

/** Where an assignment sits for a given axis position, through its own range
 *  and inversion. */
const axisValue = (a, pos) => {
  const p = a.invert ? 1 - pos : pos;
  return a.lo + p * (a.hi - a.lo);
};

/** Remember where everything was, so a momentary gesture can put it back. */
function snapshot(pad) {
  for (const axis of ["x", "y"]) {
    for (const a of pad[axis]) {
      const t = trackById(a.trackId);
      a._base = t ? readUnit(t, a.key) : null;
    }
  }
}

function applyPad(pad, commit) {
  for (const axis of ["x", "y"]) {
    for (const a of pad[axis]) {
      const t = trackById(a.trackId);
      if (!t) continue;
      writeParam(t, a.key, axisValue(a, pad.pos[axis]), MACRO_RAMP, commit);
    }
  }
}

function releasePad(pad) {
  if (pad.latch) {
    // Latch: the gesture becomes the sound. Committing through each control's
    // own handler is the same thing as having moved the knobs by hand, so the
    // patch, the p-lock snapshot and a save all see it.
    applyPad(pad, true);
    for (const axis of ["x", "y"]) for (const a of pad[axis]) a._base = null;
    return;
  }
  for (const axis of ["x", "y"]) {
    for (const a of pad[axis]) {
      const t = trackById(a.trackId);
      if (t && a._base != null) writeParam(t, a.key, a._base, RELEASE_RAMP, false);
      a._base = null;
    }
  }
}

/** Wire an element as pad `pad`'s playing surface. Same idiom as the wavetable
 *  canvas: rect + clamp + pointer capture, and `pointercancel` handled. */
function attachPadSurface(pad, el, cursor, onMove) {
  el.style.touchAction = "none";
  let drag = null;
  const setFrom = (clientX, clientY) => {
    const r = el.getBoundingClientRect();
    pad.pos.x = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    // Screen y runs down; a pad runs up, like every other value in the app.
    pad.pos.y = Math.max(0, Math.min(1, 1 - (clientY - r.top) / r.height));
  };
  const paint = () => {
    cursor.style.left = `${pad.pos.x * 100}%`;
    cursor.style.top = `${(1 - pad.pos.y) * 100}%`;
    el.classList.toggle("is-latched", !!pad.latch);
    onMove?.();
  };
  paint();
  el.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    drag = e.pointerId;
    try { el.setPointerCapture(e.pointerId); } catch {}
    el.classList.add("is-held");
    snapshot(pad);
    setFrom(e.clientX, e.clientY);
    paint();
    applyPad(pad, false);
  });
  el.addEventListener("pointermove", (e) => {
    if (drag !== e.pointerId) return;
    if (e.pointerType === "mouse" && e.buttons === 0) { drag = null; return; }
    for (const p of (e.getCoalescedEvents?.() || [e])) setFrom(p.clientX, p.clientY);
    paint();
    applyPad(pad, false);
    e.preventDefault();
  });
  const end = (e) => {
    if (drag !== e.pointerId) return;
    drag = null;
    try { el.releasePointerCapture(e.pointerId); } catch {}
    el.classList.remove("is-held");
    releasePad(pad);
    paint();
  };
  el.addEventListener("pointerup", end);
  el.addEventListener("pointercancel", end);
  el.addEventListener("lostpointercapture", end);
}

// ---- learn ---------------------------------------------------------------
// Arm an axis, then touch any parameter control to attach it. One capture-phase
// listener resolves the control the same way the right-click menu does, so
// everything the menu reaches, learn reaches.

let _learnInstalled = false;

function installLearn() {
  if (_learnInstalled) return;
  _learnInstalled = true;
  document.addEventListener("pointerdown", (e) => {
    if (!_learn) return;
    const el = controlFromEventTarget(e.target);
    if (!el) return;
    const key = targetsForControl(el)?.auto;
    const t = trackForControl(el);
    if (!key || !t) return;
    e.preventDefault();
    e.stopPropagation();
    const pad = macroPads().find(p => p.id === _learn.padId);
    const res = assignToAxis(pad, _learn.axis, t, key);
    _learn = null;
    if (_modal) _modal.draw(res.ok ? "" : res.why);
  }, true);
}

// ---- the modal -----------------------------------------------------------

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function paramLabel(a) {
  const t = trackById(a.trackId);
  const name = t?.name || `track ${a.trackId}`;
  return `${name} · ${AUTOMATION_TARGETS[a.key]?.label || a.key}`;
}

export function openMacroPads() {
  if (_modal) { _modal.close(); return; }
  installLearn();
  const pads = macroPads();
  if (!pads.length) addMacroPad();
  let current = pads[0].id;

  const overlay = document.createElement("div");
  overlay.className = "sq-modal-overlay";
  const modal = document.createElement("div");
  modal.className = "sq-modal sq-macro__modal";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  overlay.appendChild(modal);

  const close = () => {
    // Never leave a latched-off pad holding parameters down.
    for (const pad of macroPads()) releasePad(pad);
    overlay.remove();
    document.removeEventListener("keydown", onKey);
    _learn = null;
    _modal = null;
  };
  const onKey = (e) => { if (e.key === "Escape") close(); };

  const draw = (note = "") => {
    const list = macroPads();
    if (!list.length) addMacroPad();
    if (!list.some(p => p.id === current)) current = list[0].id;
    const pad = list.find(p => p.id === current);

    modal.replaceChildren();
    modal.insertAdjacentHTML("beforeend", `
      <div class="sq-macro__head">
        <div class="sq-macro__tabs">
          ${list.map(p => `<button type="button" class="sq-macro__tab${p.id === current ? " is-on" : ""}" data-pad="${p.id}">${esc(p.name)}</button>`).join("")}
          <button type="button" class="sq-macro__add" title="new pad">+</button>
        </div>
        <button type="button" class="sq-panel__modal-close">done</button>
      </div>
      <div class="sq-macro__body">
        <div class="sq-macro__stage">
          <div class="sq-macro__pad"><div class="sq-macro__cursor"></div></div>
          <div class="sq-macro__padfoot">
            <label class="sq-macro__latch"><input type="checkbox" class="sq-macro__latch-cb"${pad.latch ? " checked" : ""} /> latch</label>
            <span class="sq-macro__hint">${pad.latch
              ? "the pad keeps what you play — it becomes the sound"
              : "parameters spring back when you let go"}</span>
            <button type="button" class="sq-macro__del sq-btn--ghost">delete pad</button>
          </div>
        </div>
        <div class="sq-macro__axes">
          ${["x", "y"].map(ax => `
            <div class="sq-macro__axis" data-axis="${ax}">
              <div class="sq-macro__axis-head">
                <span class="sq-macro__axis-name">${ax}</span>
                <button type="button" class="sq-macro__learn${_learn && _learn.padId === pad.id && _learn.axis === ax ? " is-on" : ""}" data-axis="${ax}">${
                  _learn && _learn.padId === pad.id && _learn.axis === ax ? "touch a control…" : "learn"}</button>
              </div>
              ${pad[ax].length ? pad[ax].map((a, i) => `
                <div class="sq-macro__assign" data-axis="${ax}" data-i="${i}">
                  <span class="sq-macro__assign-name">${esc(paramLabel(a))}</span>
                  <label class="sq-macro__range">from <input type="number" class="sq-macro__lo" min="0" max="1" step="0.01" value="${a.lo}" /></label>
                  <label class="sq-macro__range">to <input type="number" class="sq-macro__hi" min="0" max="1" step="0.01" value="${a.hi}" /></label>
                  <label class="sq-macro__inv"><input type="checkbox" class="sq-macro__inv-cb"${a.invert ? " checked" : ""} /> flip</label>
                  <button type="button" class="sq-macro__rm sq-btn--ghost" title="remove">×</button>
                </div>`).join("") : `<div class="sq-macro__empty">nothing on this axis yet — press learn, then touch any knob</div>`}
            </div>`).join("")}
        </div>
      </div>
      ${note ? `<div class="sq-macro__note">${esc(note)}</div>` : ""}
    `);

    const q = (s) => modal.querySelector(s);
    const surface = q(".sq-macro__pad");
    attachPadSurface(pad, surface, q(".sq-macro__cursor"));

    modal.querySelectorAll(".sq-macro__tab").forEach(b =>
      b.addEventListener("click", () => { current = Number(b.dataset.pad); _learn = null; draw(); }));
    q(".sq-macro__add").addEventListener("click", () => { current = addMacroPad().id; draw(); });
    q(".sq-panel__modal-close").addEventListener("click", close);
    q(".sq-macro__del").addEventListener("click", () => {
      releasePad(pad);
      for (const ax of ["x", "y"]) for (const a of [...pad[ax]]) unassign(pad, ax, a);
      removeMacroPad(pad.id);
      draw();
    });
    q(".sq-macro__latch-cb").addEventListener("change", (e) => { pad.latch = e.target.checked; draw(); });
    modal.querySelectorAll(".sq-macro__learn").forEach(b => b.addEventListener("click", () => {
      const ax = b.dataset.axis;
      _learn = (_learn && _learn.padId === pad.id && _learn.axis === ax) ? null : { padId: pad.id, axis: ax };
      draw();
    }));
    // While an axis is armed the overlay has to stop swallowing pointers, or
    // there is no way to reach the control you are trying to assign — the
    // backdrop covers the whole viewport. The modal itself stays live and moves
    // out of the middle of the screen so the track rows are reachable.
    overlay.classList.toggle("is-learning", !!_learn);
    modal.querySelectorAll(".sq-macro__assign").forEach(row => {
      const ax = row.dataset.axis;
      const a = pad[ax][Number(row.dataset.i)];
      row.querySelector(".sq-macro__lo").addEventListener("input", e => { a.lo = Number(e.target.value); });
      row.querySelector(".sq-macro__hi").addEventListener("input", e => { a.hi = Number(e.target.value); });
      row.querySelector(".sq-macro__inv-cb").addEventListener("change", e => { a.invert = e.target.checked; });
      row.querySelector(".sq-macro__rm").addEventListener("click", () => { unassign(pad, ax, a); draw(); });
    });
  };

  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  document.addEventListener("keydown", onKey);
  document.body.appendChild(overlay);
  _modal = { overlay, close, draw };
  draw();
}

// ---- persistence ---------------------------------------------------------
// Track ids are handed out fresh by createTrack on every load, so what goes in
// the file is the track's index. Live state keeps the id, because indices shift
// when a track is removed and an assignment must not quietly repoint.

export function serializeMacroPads() {
  const idx = new Map(state.tracks.map((t, i) => [t.id, i]));
  const conv = (list) => list
    .filter(a => idx.has(a.trackId))
    .map(a => ({ track: idx.get(a.trackId), key: a.key, lo: a.lo, hi: a.hi, invert: !!a.invert }));
  return macroPads().map(p => ({ name: p.name, latch: !!p.latch, x: conv(p.x), y: conv(p.y) }));
}

export function applyMacroPads(data) {
  state.macroPads = [];
  _nextPadId = 1;
  if (!Array.isArray(data)) return;
  const conv = (list) => (Array.isArray(list) ? list : [])
    .map(a => {
      const t = state.tracks[a.track];
      return t ? { trackId: t.id, key: a.key, lo: Number(a.lo) || 0,
                   hi: a.hi == null ? 1 : Number(a.hi), invert: !!a.invert } : null;
    })
    .filter(Boolean);
  state.macroPads = data.map((p, i) => ({
    id: _nextPadId++, name: p.name || `pad ${i + 1}`, latch: !!p.latch,
    pos: { x: 0.5, y: 0.5 }, x: conv(p.x), y: conv(p.y),
  }));
  for (const t of state.tracks) refreshParamIndicators(t);
}
