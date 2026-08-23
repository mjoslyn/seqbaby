import { setStatus } from "./dom.js";
import { patternMeter, stepsPerBeatForMeter } from "./meter.js";
import { state } from "./state.js";
import { renderStepGrid } from "./stepGrid.js";
import { lastUsedNote } from "./track.js";


/** @typedef {import("./types.js").Track} Track */

/**
 * @typedef {Object} EuclidConfig
 * @property {number} pulses   Hits in the cycle.
 * @property {number} steps    Cycle length in sixteenth-note steps.
 * @property {number} rotate   Steps to push the cycle later (0..steps-1).
 * @property {"short"|"legato"} gate  One-step hits, or each hit held to the next.
 * @property {boolean} accent  Louder on the beat, quieter off it.
 */

/** @type {EuclidConfig} */
export const EUCLID_DEFAULTS = { pulses: 4, steps: 16, rotate: 0, gate: "short", accent: true };

// The fields a generated rhythm writes. Snapshot/restore and the clear pass
// both walk this list, so a new per-step array is added in one place.
const EUCLID_FIELDS = [
  "steps", "lengths", "notes", "velocities", "chords", "offsets",
  "arps", "arpRates", "arpRanges", "arpDirs", "ratchets", "complexities",
  "extraNotes", "extraLengths",
];

/**
 * Bjorklund's algorithm — spread `pulses` hits as evenly as possible over
 * `steps` slots. This is the real recursion (the one Toussaint drew the
 * parallel with Euclid's GCD from), not the `(i*k)%n < k` shortcut: the
 * shortcut is maximally even too, but it lands on a *rotation* of the
 * canonical pattern, so E(5,8) would come out as x.x.xx.x instead of the
 * x.xx.xx. every drum machine with this feature prints on the box.
 *
 * @param {number} steps  Cycle length (≥1).
 * @param {number} pulses Hits to place (clamped to 0..steps).
 * @param {number} [rotation] Steps to push the whole cycle later.
 * @returns {boolean[]} One flag per step.
 */
export function euclideanRhythm(steps, pulses, rotation = 0) {
  const n = Math.max(1, steps | 0);
  const k = Math.max(0, Math.min(n, pulses | 0));
  let pat;
  if (k === 0)      pat = new Array(n).fill(false);
  else if (k === n) pat = new Array(n).fill(true);
  else              pat = bjorklund(n, k);
  const r = ((rotation | 0) % n + n) % n;
  if (!r) return pat;
  // Positive rotation pushes every hit later, so the ring turns the way the
  // playhead runs.
  return pat.map((_, i) => pat[(i - r + n) % n]);
}

// The recursion proper: repeatedly divide the sequence into groups of
// "pulse + trailing rests", then divide the remainder the same way, until the
// remainder is 0 or 1. `counts`/`remainders` per level are the quotients and
// remainders of exactly Euclid's GCD algorithm on (pulses, steps - pulses).
function bjorklund(n, k) {
  const counts = [];
  const remainders = [k];
  let divisor = n - k;
  let level = 0;
  for (;;) {
    counts.push(Math.floor(divisor / remainders[level]));
    remainders.push(divisor % remainders[level]);
    divisor = remainders[level];
    level++;
    if (remainders[level] <= 1) break;
  }
  counts.push(divisor);

  const out = [];
  const build = (lvl) => {
    if (lvl === -1)      out.push(false);   // a rest
    else if (lvl === -2) out.push(true);    // a pulse
    else {
      for (let i = 0; i < counts[lvl]; i++) build(lvl - 1);
      if (remainders[lvl] !== 0) build(lvl - 2);
    }
  };
  build(level);
  // The recursion builds the cycle starting from a rest; every published
  // E(k,n) starts on its downbeat, so turn it round to the first pulse.
  const first = out.indexOf(true);
  return first <= 0 ? out : out.slice(first).concat(out.slice(0, first));
}

/**
 * A track's euclid settings, defaulted on first use and clamped to the
 * track's current length (which the length buttons can shrink underneath it).
 * @param {Track} t
 * @returns {EuclidConfig}
 */
export function trackEuclid(t) {
  const len = Math.max(1, t.length | 0);
  const src = t.euclid || {};
  const cycle = clampInt(src.steps ?? Math.min(len, EUCLID_DEFAULTS.steps), 1, len);
  return {
    steps: cycle,
    pulses: clampInt(src.pulses ?? EUCLID_DEFAULTS.pulses, 0, cycle),
    rotate: clampInt(src.rotate ?? 0, 0, cycle - 1),
    gate: src.gate === "legato" ? "legato" : "short",
    accent: src.accent !== false,
  };
}

const clampInt = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(v) || 0)));

// The note a generated hit gets when there was nothing at that step before.
// Drum kits are pinned to C2 like every other blank step in the app; a melodic
// track carries on from whatever it last played.
function noteForHit(t) {
  return t.isDrumKit ? 36 : lastUsedNote(t);
}

/**
 * The pattern object a generator writes into: the one currently aliased onto
 * the track's arrays. Naming it matters for anything that stays open across a
 * pattern switch — chain mode advances patterns from inside the transport's
 * scheduler, and `t.steps` is re-pointed at the new one underneath you
 * (aliasPattern). Holding the pattern keeps the edit where it started.
 * @param {Track} t
 */
export function livePattern(t) {
  return t.patterns?.[t._patternIdx ?? state.activePattern] ?? null;
}

/**
 * Copy a pattern's per-step arrays. Used as the base a generated rhythm reads
 * its pitches back from, and as the restore point when the dialog is
 * cancelled.
 * @param {Track} t
 * @param {Object} [pat] Defaults to the pattern aliased onto the track now.
 */
export function snapshotSteps(t, pat) {
  const p = pat || livePattern(t) || t;
  /** @type {Record<string, any[]>} */
  const snap = {};
  for (const f of EUCLID_FIELDS) if (Array.isArray(p[f])) snap[f] = p[f].slice();
  return snap;
}

/**
 * Write a snapshot back. In place, element by element: the track's arrays are
 * the pattern's arrays (aliasPattern), so reassigning one would quietly detach
 * the track from its own pattern.
 * @param {Track} t
 * @param {Record<string, any[]>} snap
 * @param {Object} [pat] Defaults to the pattern aliased onto the track now.
 */
export function restoreSteps(t, snap, pat) {
  const p = pat || livePattern(t) || t;
  for (const f of EUCLID_FIELDS) {
    const src = snap?.[f], dst = p[f];
    if (!Array.isArray(src) || !Array.isArray(dst)) continue;
    for (let i = 0; i < dst.length && i < src.length; i++) dst[i] = src[i];
  }
}

/**
 * Replace a pattern's rhythm with a euclidean one. The cycle tiles
 * across the track length, so E(3,8) on a 16-step track plays twice.
 *
 * Pitch is not this tool's business: a hit landing where `base` already had a
 * note keeps that note (and its chord), so euclid-ing a written line rewrites
 * its rhythm rather than flattening it to one pitch. Everywhere else it falls
 * back to the track's last-used note.
 *
 * @param {Track} t
 * @param {EuclidConfig} cfg
 * @param {Record<string, any[]>} [base] Snapshot to read kept pitches from
 *   (defaults to what is in the pattern right now).
 * @param {Object} [pat] Pattern to write (defaults to the aliased one).
 */
export function applyEuclid(t, cfg, base, pat) {
  const p = pat || livePattern(t) || t;
  const patIdx = t.patterns?.indexOf(p);
  const len = t.length;
  const cycle = clampInt(cfg.steps, 1, len);
  const ring = euclideanRhythm(cycle, cfg.pulses, cfg.rotate);
  const src = base || snapshotSteps(t, p);

  for (let i = 0; i < len; i++) {
    p.steps[i] = 0;
    p.lengths[i] = 0;
    p.notes[i] = null;
    p.velocities[i] = 0.7;
    if (p.chords)       p.chords[i] = "";
    if (p.offsets)      p.offsets[i] = 0;
    if (p.arps)         p.arps[i] = false;
    if (p.ratchets)     p.ratchets[i] = 1;
    if (p.complexities) p.complexities[i] = 0;
    // Stacked piano-roll notes only sound on an active step, so a step the
    // rhythm just switched back on would otherwise play someone else's chord.
    if (p.extraNotes)   p.extraNotes[i] = null;
    if (p.extraLengths) p.extraLengths[i] = null;
  }

  const hits = [];
  for (let i = 0; i < len; i++) if (ring[i % cycle]) hits.push(i);

  const spb = stepsPerBeatForMeter(patternMeter(patIdx >= 0 ? patIdx : state.activePattern));
  const fallback = noteForHit(t);
  for (let h = 0; h < hits.length; h++) {
    const i = hits[h];
    const next = h + 1 < hits.length ? hits[h + 1] : len;
    const kept = src.steps?.[i] ? src.notes?.[i] : null;
    p.steps[i] = 1;
    p.lengths[i] = cfg.gate === "legato" ? Math.max(1, next - i) : 1;
    p.notes[i] = kept != null ? kept : fallback;
    if (kept != null && p.chords && src.chords) {
      p.chords[i] = src.chords[i] || "";
      if (p.complexities && src.complexities) p.complexities[i] = src.complexities[i] | 0;
    }
    const onBeat = (i % spb) === 0;
    p.velocities[i] = cfg.accent ? (onBeat ? 0.95 : 0.62) : 0.8;
  }
  return hits.length;
}

/**
 * The euclid dialog: pulses / cycle length / rotation, drawn as the ring the
 * algorithm is named for.
 *
 * It writes the pattern on every change rather than on OK, so a rotation sweep
 * is audible against the transport while you make it — and takes a snapshot on
 * open to put back on cancel, which is the only undo this app has (the same
 * bargain the macro pads strike for a momentary move).
 *
 * @param {Track} t
 */
export function openEuclidDialog(t) {
  if (t._euclidModal) return;
  const len = Math.max(1, t.length | 0);
  const cfg = trackEuclid(t);
  // Hold the pattern, not the track's aliases: chain mode can advance the
  // pattern under an open dialog, and writing (or cancelling) into whatever
  // came next would overwrite a pattern nobody asked to change.
  const pat = livePattern(t);
  if (!pat) return;
  const base = snapshotSteps(t, pat);

  const overlay = document.createElement("div");
  overlay.className = "sq-modal-overlay";
  const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  overlay.innerHTML = `
    <div class="sq-modal sq-euclid__modal" role="dialog" aria-modal="true" aria-label="euclidean rhythm">
      <div class="sq-modal__title">euclidean rhythm — ${esc(t.name?.trim() || "track")}</div>
      <div class="sq-euclid__viz">
        <svg class="sq-euclid__ring" viewBox="0 0 120 120" width="120" height="120" aria-hidden="true"></svg>
        <div class="sq-euclid__readout">
          <div class="sq-euclid__formula"></div>
          <div class="sq-euclid__bits"></div>
          <div class="sq-euclid__hint">the cycle tiles across the track's ${len} steps</div>
        </div>
      </div>
      <div class="sq-euclid__strip" aria-hidden="true"></div>
      <div class="sq-euclid__ctls">
        <label class="sq-euclid__row">
          <span>pulses</span>
          <input class="sq-euclid__pulses" type="range" min="0" max="${len}" step="1" value="${cfg.pulses}" />
          <output class="sq-euclid__val"></output>
        </label>
        <label class="sq-euclid__row">
          <span>steps</span>
          <input class="sq-euclid__steps" type="range" min="1" max="${len}" step="1" value="${cfg.steps}" />
          <output class="sq-euclid__val"></output>
        </label>
        <label class="sq-euclid__row">
          <span>rotate</span>
          <input class="sq-euclid__rotate" type="range" min="0" max="${Math.max(0, cfg.steps - 1)}" step="1" value="${cfg.rotate}" />
          <output class="sq-euclid__val"></output>
        </label>
      </div>
      <div class="sq-euclid__opts">
        <label title="hold each hit until the next one instead of a one-step gate"
          >gate <select class="sq-euclid__gate">
            <option value="short">short</option>
            <option value="legato">legato</option>
          </select></label>
        <label title="louder on the beat, quieter off it — the pattern reads as a groove rather than a flat line"
          ><input class="sq-euclid__accent" type="checkbox" /> accent the beat</label>
      </div>
      <div class="sq-modal__actions">
        <button class="modal-cancel sq-btn--ghost" type="button">cancel</button>
        <button class="sq-modal__ok" type="button">apply</button>
      </div>
    </div>
  `;

  const q = (sel) => overlay.querySelector(sel);
  const pulsesEl = q(".sq-euclid__pulses");
  const stepsEl  = q(".sq-euclid__steps");
  const rotateEl = q(".sq-euclid__rotate");
  const gateEl   = q(".sq-euclid__gate");
  const accentEl = q(".sq-euclid__accent");
  gateEl.value = cfg.gate;
  accentEl.checked = cfg.accent;

  const read = () => {
    const cycle = clampInt(stepsEl.value, 1, len);
    return {
      steps: cycle,
      pulses: clampInt(pulsesEl.value, 0, cycle),
      rotate: clampInt(rotateEl.value, 0, Math.max(0, cycle - 1)),
      gate: gateEl.value === "legato" ? "legato" : "short",
      accent: accentEl.checked,
    };
  };

  const ring = q(".sq-euclid__ring");
  const strip = q(".sq-euclid__strip");
  const formula = q(".sq-euclid__formula");
  const bits = q(".sq-euclid__bits");
  const vals = overlay.querySelectorAll(".sq-euclid__val");

  const draw = (c) => {
    // pulses can't exceed the cycle, and a rotation past its end is the same
    // pattern again — keep the sliders honest about both.
    pulsesEl.max = String(c.steps);
    rotateEl.max = String(Math.max(0, c.steps - 1));
    if (Number(pulsesEl.value) !== c.pulses) pulsesEl.value = String(c.pulses);
    if (Number(rotateEl.value) !== c.rotate) rotateEl.value = String(c.rotate);
    vals[0].textContent = String(c.pulses);
    vals[1].textContent = String(c.steps);
    vals[2].textContent = String(c.rotate);

    const pat = euclideanRhythm(c.steps, c.pulses, c.rotate);
    formula.textContent = `E(${c.pulses}, ${c.steps})${c.rotate ? ` rotated ${c.rotate}` : ""}`;
    bits.textContent = pat.map(on => (on ? "x" : ".")).join("");

    // The ring: one node per step of the cycle, playhead order clockwise from
    // the top. This is the picture the algorithm is actually about — evenness
    // is visible on a circle and invisible on a line.
    const R = 46, cx = 60, cy = 60;
    const n = pat.length;
    const pts = pat.map((_, i) => {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2;
      return [cx + R * Math.cos(a), cy + R * Math.sin(a)];
    });
    const poly = pts.filter((_, i) => pat[i]);
    const shape = poly.length > 1
      ? `<polygon class="sq-euclid__poly" points="${poly.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ")}" />`
      : "";
    const dots = pts.map(([x, y], i) =>
      `<circle class="sq-euclid__node${pat[i] ? " is-on" : ""}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${pat[i] ? 5.4 : 2.6}" />`
    ).join("");
    ring.innerHTML =
      `<circle class="sq-euclid__orbit" cx="${cx}" cy="${cy}" r="${R}" />${shape}${dots}`;

    // The strip is the track as the sequencer sees it: the cycle tiled out to
    // the track's length, with the cycle joins marked.
    strip.innerHTML = Array.from({ length: len }, (_, i) => {
      const on = pat[i % c.steps];
      const cls = ["sq-euclid__cell"];
      if (on) cls.push("is-on");
      if (i && i % c.steps === 0) cls.push("is-cycle");
      if (i % 4 === 0) cls.push("is-beat");
      return `<span class="${cls.join(" ")}"></span>`;
    }).join("");
  };

  const write = () => {
    const c = read();
    draw(c);
    applyEuclid(t, c, base, pat);
    renderStepGrid(t);
  };

  for (const el of [pulsesEl, stepsEl, rotateEl]) el.addEventListener("input", write);
  for (const el of [gateEl, accentEl]) el.addEventListener("change", write);

  const close = () => {
    if (!t._euclidModal) return;
    overlay.remove();
    document.removeEventListener("keydown", escHandler);
    t._euclidModal = null;
    t.el?.querySelector(".track-euclid")?.setAttribute("aria-pressed", "false");
  };
  const cancel = () => {
    restoreSteps(t, base, pat);
    renderStepGrid(t);
    close();
  };
  const commit = () => {
    const c = read();
    t.euclid = { ...c };
    applyEuclid(t, c, base, pat);
    renderStepGrid(t);
    close();
    setStatus(`"${t.name}" — E(${c.pulses}, ${c.steps})${c.rotate ? ` rot ${c.rotate}` : ""}`);
  };
  const escHandler = (e) => {
    if (e.key === "Escape") { e.preventDefault(); cancel(); }
    if (e.key === "Enter" && !e.repeat) { e.preventDefault(); commit(); }
  };
  q(".modal-cancel").addEventListener("click", cancel);
  q(".sq-modal__ok").addEventListener("click", commit);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) cancel(); });
  document.addEventListener("keydown", escHandler);

  document.body.appendChild(overlay);
  t._euclidModal = { overlay, close: cancel };
  t.el?.querySelector(".track-euclid")?.setAttribute("aria-pressed", "true");
  write();
}
