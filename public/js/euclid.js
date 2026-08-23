/**
 * Euclidean rhythms — Bjorklund's algorithm, and the two ways a track can use
 * it.
 *
 *   - **write to pattern**: print the ring into the step grid, once. What you
 *     get is ordinary steps, editable by hand from then on.
 *   - **live**: the transport asks the generator for every step instead of
 *     reading the written pattern. Nothing is written, so pulses / steps /
 *     rotate can be driven by an LFO, an automation lane or a macro pad — a
 *     rotation sweep is a performance, not an edit, and switching live off
 *     hands you back exactly the pattern you had.
 *
 * That split is the whole reason live mode exists. Modulating the one-shot
 * would mean rewriting the pattern under the playhead sixty times a second,
 * and this app has no undo.
 */

import { setStatus } from "./dom.js";
import { refreshKnobRange, upgradeKnobs } from "./knob.js";
import { patternMeter, stepsPerBeatForMeter } from "./meter.js";
import { state } from "./state.js";
import { renderStepGrid } from "./stepGrid.js";
import { lastUsedNote } from "./track.js";


/** @typedef {import("./types.js").Track} Track */

/**
 * @typedef {Object} EuclidConfig
 * @property {boolean} on      Live mode: the transport generates instead of reading steps.
 * @property {number} pulses   Hits in the cycle.
 * @property {number} steps    Cycle length in sixteenth-note steps.
 * @property {number} rotate   Steps to push the cycle later (0..steps-1).
 * @property {"short"|"legato"} gate  One-step hits, or each hit held to the next.
 * @property {boolean} accent  Louder on the beat, quieter off it.
 */

/** @type {EuclidConfig} */
export const EUCLID_DEFAULTS = { on: false, pulses: 4, steps: 16, rotate: 0, gate: "short", accent: true };

/** The three modulatable controls, in every namespace they answer to. */
export const EUCLID_MOD_KEYS = ["pulses", "steps", "rotate"];
export const EUCLID_MOD_LABELS = {
  pulses: "euclid pulses", steps: "euclid cycle", rotate: "euclid rotate",
};

// The fields a written rhythm touches. Snapshot and the clear pass both walk
// this list, so a new per-step array is added in one place.
const EUCLID_FIELDS = [
  "steps", "lengths", "notes", "velocities", "chords", "offsets",
  "arps", "arpRates", "arpRanges", "arpDirs", "ratchets", "complexities",
  "extraNotes", "extraLengths",
];

const clampInt = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(v) || 0)));

// ---- the algorithm -------------------------------------------------------

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

// ---- the track's settings ------------------------------------------------

/**
 * A track's stored euclid settings, defaulted on first use and clamped to the
 * track's current length (which the length buttons can shrink underneath it).
 * @param {Track} t
 * @returns {EuclidConfig}
 */
export function trackEuclid(t) {
  const len = Math.max(1, t.length | 0);
  const src = t.euclid || {};
  const cycle = clampInt(src.steps ?? Math.min(len, EUCLID_DEFAULTS.steps), 1, len);
  return {
    on: !!src.on,
    steps: cycle,
    pulses: clampInt(src.pulses ?? EUCLID_DEFAULTS.pulses, 0, cycle),
    rotate: clampInt(src.rotate ?? 0, 0, Math.max(0, cycle - 1)),
    gate: src.gate === "legato" ? "legato" : "short",
    accent: src.accent !== false,
  };
}

/**
 * The settings the generator is actually running on: the stored ones with any
 * live modulation laid over the top.
 *
 * The overrides live in `t._euclidMod` and are never written back or saved —
 * the same bargain the granular LFOs strike with their sliders. A knob you can
 * see stays where you left it while something else drives the sound.
 * @param {Track} t
 * @returns {EuclidConfig}
 */
export function liveEuclid(t) {
  const stored = trackEuclid(t);
  const mod = t._euclidMod;
  if (!mod) return stored;
  const len = Math.max(1, t.length | 0);
  // Resolve the cycle first: it is what bounds the other two.
  const steps = mod.steps != null ? clampInt(mod.steps, 1, len) : stored.steps;
  return {
    on: stored.on,
    steps,
    pulses: clampInt(mod.pulses != null ? mod.pulses : stored.pulses, 0, steps),
    rotate: clampInt(mod.rotate != null ? mod.rotate : stored.rotate, 0, Math.max(0, steps - 1)),
    gate: stored.gate,
    accent: stored.accent,
  };
}

/**
 * A control's range, in the units the knob shows. Every other engine has a
 * constant table here; euclid's ranges move, because two of them are bounded
 * by the cycle and the cycle is bounded by the track length.
 * @param {Track} t @param {"pulses"|"steps"|"rotate"} key
 * @returns {[number, number]}
 */
export function euclidRange(t, key) {
  const len = Math.max(1, t.length | 0);
  if (key === "steps") return [1, len];
  const cyc = liveEuclid(t).steps;
  if (key === "pulses") return [0, cyc];
  return [0, Math.max(0, cyc - 1)];       // rotate
}

/** A 0..1 modulation value as a count. @param {Track} t */
export function euclidFromUnit(t, key, u) {
  const [lo, hi] = euclidRange(t, key);
  return clampInt(lo + Math.max(0, Math.min(1, u)) * (hi - lo), lo, hi);
}

/** A count back to the 0..1 an LFO swings around. @param {Track} t */
export function euclidToUnit(t, key, v) {
  const [lo, hi] = euclidRange(t, key);
  return hi > lo ? Math.max(0, Math.min(1, (Number(v) - lo) / (hi - lo))) : 0;
}

/**
 * Drive one control live. Called by the LFO setter loop (rAF), by an
 * automation lane at step time, and by a macro pad — all of which speak counts
 * once they have been through `euclidFromUnit`.
 * @param {Track} t @param {"pulses"|"steps"|"rotate"} key @param {number} v
 */
export function setEuclidLive(t, key, v) {
  if (!EUCLID_MOD_KEYS.includes(key)) return;
  const mod = t._euclidMod || (t._euclidMod = {});
  mod[key] = v;
  refreshEuclidLive(t);
}

/** Hand a control back to its knob — the LFO was switched off. @param {Track} t */
export function clearEuclidLive(t, key) {
  if (!t._euclidMod) return;
  delete t._euclidMod[key];
  refreshEuclidLive(t);
}

// ---- the generated rhythm ------------------------------------------------

// The note a generated hit gets when the pattern has nothing at that step.
// Drum kits are pinned to C2 like every other blank step in the app; a melodic
// track carries on from whatever it last played.
/** @param {Track} t */
export function euclidFallbackNote(t) {
  return t.isDrumKit ? 36 : lastUsedNote(t);
}

/** Identity of the rhythm a track is currently generating — everything the
 *  plan depends on, so a cached plan can be reused until one of them moves. */
function planKey(t, cfg) {
  return `${t.length}|${t._patternIdx}|${cfg.steps}|${cfg.pulses}|${cfg.rotate}|${cfg.gate}|${cfg.accent}`;
}

/**
 * The generated rhythm as one entry per step: `{span, vel}` for a hit, null
 * for a rest. Cached, because the transport asks for it once per step per
 * track and the answer only changes when a control moves.
 * @param {Track} t
 */
export function euclidPlan(t) {
  const cfg = liveEuclid(t);
  const key = planKey(t, cfg);
  if (t._euclidPlan?.key === key) return t._euclidPlan.plan;

  const len = Math.max(1, t.length | 0);
  const ring = euclideanRhythm(cfg.steps, cfg.pulses, cfg.rotate);
  const spb = stepsPerBeatForMeter(patternMeter(t._patternIdx ?? state.activePattern));
  const hits = [];
  for (let i = 0; i < len; i++) if (ring[i % cfg.steps]) hits.push(i);

  const plan = new Array(len).fill(null);
  for (let h = 0; h < hits.length; h++) {
    const i = hits[h];
    const next = h + 1 < hits.length ? hits[h + 1] : len;
    plan[i] = {
      span: cfg.gate === "legato" ? Math.max(1, next - i) : 1,
      vel: cfg.accent ? ((i % spb) === 0 ? 0.95 : 0.62) : 0.8,
    };
  }
  t._euclidPlan = { key, plan, ring };
  return plan;
}

/** The ring itself (one cycle), for the panel's drawing. @param {Track} t */
export function euclidRing(t) {
  euclidPlan(t);
  return t._euclidPlan.ring;
}

/**
 * What a step plays — the one question the transport and the step grid both
 * ask. In live mode the answer is generated; otherwise it is read from the
 * written pattern. Null means silence.
 *
 * Only the *rhythm* is generated: pitch, chord, arp, ratchet, nudge and the
 * automation lanes all still come from the pattern, so a live euclid track is
 * an ordinary track with its step mask replaced.
 * @param {Track} t @param {number} idx
 * @returns {{span: number, vel: number}|null}
 */
export function stepGateAt(t, idx) {
  if (!t.euclid?.on) {
    return t.steps[idx]
      ? { span: Math.max(1, t.lengths[idx] || 1), vel: t.velocities[idx] ?? 0.5 }
      : null;
  }
  return euclidPlan(t)[idx] || null;
}

// ---- writing the pattern -------------------------------------------------

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
 * Copy a pattern's per-step arrays — the base a written rhythm reads its
 * pitches back from.
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
 * Print the generated rhythm into a pattern, as ordinary steps.
 *
 * Pitch is not this tool's business: a hit landing where the pattern already
 * had a note keeps that note (and its chord), so euclid-ing a written line
 * rewrites its rhythm rather than flattening it to one pitch. Everywhere else
 * it falls back to `euclidFallbackNote`.
 *
 * @param {Track} t
 * @param {EuclidConfig} [cfg] Defaults to what the track is generating now.
 * @param {Object} [pat] Pattern to write (defaults to the aliased one).
 * @returns {number} how many hits were written
 */
export function applyEuclid(t, cfg, pat) {
  const p = pat || livePattern(t) || t;
  const c = cfg || liveEuclid(t);
  const patIdx = t.patterns?.indexOf(p);
  const len = Math.max(1, t.length | 0);
  const cycle = clampInt(c.steps, 1, len);
  const ring = euclideanRhythm(cycle, c.pulses, c.rotate);
  const src = snapshotSteps(t, p);

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
  const fallback = euclidFallbackNote(t);
  for (let h = 0; h < hits.length; h++) {
    const i = hits[h];
    const next = h + 1 < hits.length ? hits[h + 1] : len;
    const kept = src.steps?.[i] ? src.notes?.[i] : null;
    p.steps[i] = 1;
    p.lengths[i] = c.gate === "legato" ? Math.max(1, next - i) : 1;
    p.notes[i] = kept != null ? kept : fallback;
    if (kept != null && p.chords && src.chords) {
      p.chords[i] = src.chords[i] || "";
      if (p.complexities && src.complexities) p.complexities[i] = src.complexities[i] | 0;
    }
    p.velocities[i] = c.accent ? ((i % spb) === 0 ? 0.95 : 0.62) : 0.8;
  }
  return hits.length;
}

// ---- the panel -----------------------------------------------------------
//
// A permanent panel on the track rather than a modal built on demand, for the
// same reason the filter and the fx rack are: the controls have to exist in
// the track's DOM whether or not anyone is looking at them, or the parameter
// menu, the mod/aut dots and the macro pads have nothing to find.

const euclidPanelOf = (t) => t?._euclidPanelEl || t?.el?.querySelector(".sq-track__euclid-panel") || null;

/** @param {Track} t */
function ensureEuclid(t) {
  if (!t.euclid) t.euclid = { ...EUCLID_DEFAULTS };
  return t.euclid;
}

// Repaints are coalesced onto one frame and skipped when the resolved rhythm
// hasn't moved: the LFO setter loop writes at 60Hz, while these controls are
// counts, so most frames are asking for the rhythm already on screen.
/** @type {Set<Track>} */
const dirty = new Set();
let rafId = null;

function flushEuclid() {
  rafId = null;
  for (const t of dirty) {
    if (!state.tracks.includes(t)) continue;
    drawEuclidViz(t);
    if (t.euclid?.on) renderStepGrid(t);
  }
  dirty.clear();
}

/**
 * Something drove a control live. Repaint if — and only if — the rhythm the
 * track is generating actually changed.
 * @param {Track} t
 */
export function refreshEuclidLive(t) {
  const key = planKey(t, liveEuclid(t));
  if (t._euclidPaintedKey === key) return;
  t._euclidPaintedKey = key;
  dirty.add(t);
  if (rafId == null) rafId = requestAnimationFrame(flushEuclid);
}

/**
 * The track-level consequences of live mode: the grid shows what is being
 * generated rather than what is written, so it goes read-only and says so.
 * @param {Track} t
 */
export function refreshEuclidUI(t) {
  const on = !!t.euclid?.on;
  t.el?.classList.toggle("is-euclid", on);
  const btn = t.el?.querySelector(".track-euclid");
  if (btn) btn.classList.toggle("is-live", on);
  const panel = euclidPanelOf(t);
  const live = panel?.querySelector(".sq-euclid__on");
  if (live) live.checked = on;
  t._euclidPaintedKey = null;
  renderStepGrid(t);
}

/**
 * Fill the panel from the track: knob values and ranges from the STORED
 * settings (they are the base an LFO swings around), the drawing from what is
 * actually being generated.
 * @param {Track} t @param {HTMLElement} [panelEl]
 */
export function renderEuclidPanel(t, panelEl) {
  const panel = panelEl || euclidPanelOf(t);
  if (!panel) return;
  syncEuclidControls(t, panel);
  drawEuclidViz(t, panel);
}

/** Knob values + ranges from the stored config. @param {Track} t */
function syncEuclidControls(t, panelEl) {
  const panel = panelEl || euclidPanelOf(t);
  if (!panel) return;
  const cfg = trackEuclid(t);
  const len = Math.max(1, t.length | 0);
  // The knobs are bounded by the STORED cycle, not the modulated one — a knob
  // whose travel changed under a moving LFO would be unplayable.
  const bounds = { pulses: [0, cfg.steps], steps: [1, len], rotate: [0, Math.max(0, cfg.steps - 1)] };
  for (const key of EUCLID_MOD_KEYS) {
    const el = panel.querySelector(`.p-euc${key}`);
    if (!el) continue;
    const [lo, hi] = bounds[key];
    if (el.min !== String(lo) || el.max !== String(hi)) {
      el.min = String(lo); el.max = String(hi);
      refreshKnobRange(el);
    }
    if (Number(el.value) !== cfg[key]) el.value = String(cfg[key]);
  }
  const gate = panel.querySelector(".sq-euclid__gate");
  if (gate) gate.value = cfg.gate;
  const accent = panel.querySelector(".sq-euclid__accent");
  if (accent) accent.checked = cfg.accent;
  const live = panel.querySelector(".sq-euclid__on");
  if (live) live.checked = cfg.on;
  const write = panel.querySelector(".sq-euclid__write");
  if (write) write.disabled = cfg.on;
}

/**
 * The ring, the tiled strip and the formula — all from the LIVE config, so
 * they show what is playing rather than where the knobs sit. Watching the ring
 * turn under a still knob is what modulation looks like here.
 * @param {Track} t
 */
function drawEuclidViz(t, panelEl) {
  const panel = panelEl || euclidPanelOf(t);
  if (!panel) return;
  const c = liveEuclid(t);
  const len = Math.max(1, t.length | 0);
  const pat = euclideanRhythm(c.steps, c.pulses, c.rotate);

  for (const key of EUCLID_MOD_KEYS) {
    const out = panel.querySelector(`.sq-euclid__val--${key}`);
    if (out) out.textContent = String(c[key]);
    const field = panel.querySelector(`.p-euc${key}`)?.closest(".sq-euclid__f");
    // Say when a control is being driven from somewhere else, or the still
    // knob beside a moving ring reads as a bug.
    if (field) field.classList.toggle("is-driven", t._euclidMod?.[key] != null);
  }

  const formula = panel.querySelector(".sq-euclid__formula");
  if (formula) formula.textContent = `E(${c.pulses}, ${c.steps})${c.rotate ? ` rotated ${c.rotate}` : ""}`;
  const bits = panel.querySelector(".sq-euclid__bits");
  if (bits) bits.textContent = pat.map(on => (on ? "x" : ".")).join("");
  const hint = panel.querySelector(".sq-euclid__hint");
  if (hint) {
    hint.textContent = c.on
      ? `generating live across the track's ${len} steps — the grid is read-only until you switch it off`
      : `the cycle tiles across the track's ${len} steps`;
  }

  // The ring: one node per step of the cycle, playhead order clockwise from
  // the top. This is the picture the algorithm is actually about — evenness is
  // visible on a circle and invisible on a line.
  const ring = panel.querySelector(".sq-euclid__ring");
  if (ring) {
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
    ring.innerHTML = `<circle class="sq-euclid__orbit" cx="${cx}" cy="${cy}" r="${R}" />${shape}${dots}`;
  }

  // The strip is the track as the sequencer sees it: the cycle tiled out to
  // the track's length, with the cycle joins marked.
  const strip = panel.querySelector(".sq-euclid__strip");
  if (strip) {
    strip.innerHTML = Array.from({ length: len }, (_, i) => {
      const cls = ["sq-euclid__cell"];
      if (pat[i % c.steps]) cls.push("is-on");
      if (i && i % c.steps === 0) cls.push("is-cycle");
      if (i % 4 === 0) cls.push("is-beat");
      return `<span class="${cls.join(" ")}"></span>`;
    }).join("");
  }
  t._euclidPaintedKey = planKey(t, c);
}

/**
 * Wire the panel once, at track render. The three counts write the track's
 * stored settings — they are ordinary parameters, and everything that can
 * drive them (LFO, lane, macro pad) goes through `setEuclidLive` instead, so
 * a performance never touches the base.
 * @param {Track} t @param {HTMLElement} panel
 */
export function wireEuclidPanel(t, panel) {
  if (!panel) return;
  const changed = () => {
    syncEuclidControls(t, panel);
    drawEuclidViz(t, panel);
    if (t.euclid?.on) renderStepGrid(t);
  };
  for (const key of EUCLID_MOD_KEYS) {
    const el = panel.querySelector(`.p-euc${key}`);
    el?.addEventListener("input", () => {
      const cfg = ensureEuclid(t);
      cfg[key] = clampInt(el.value, Number(el.min), Number(el.max));
      // The cycle bounds the other two, so shrinking it pulls them in.
      if (key === "steps") {
        cfg.pulses = clampInt(cfg.pulses, 0, cfg.steps);
        cfg.rotate = clampInt(cfg.rotate, 0, Math.max(0, cfg.steps - 1));
      }
      changed();
    });
  }
  panel.querySelector(".sq-euclid__gate")?.addEventListener("change", (e) => {
    ensureEuclid(t).gate = e.target.value === "legato" ? "legato" : "short";
    changed();
  });
  panel.querySelector(".sq-euclid__accent")?.addEventListener("change", (e) => {
    ensureEuclid(t).accent = !!e.target.checked;
    changed();
  });
  panel.querySelector(".sq-euclid__on")?.addEventListener("change", (e) => {
    ensureEuclid(t).on = !!e.target.checked;
    refreshEuclidUI(t);
    renderEuclidPanel(t, panel);
    setStatus(t.euclid.on
      ? `"${t.name}" — euclid live`
      : `"${t.name}" — euclid off, pattern as you left it`);
  });
  panel.querySelector(".sq-euclid__write")?.addEventListener("click", () => {
    // Destructive and labelled as such, like clear and the dice — and unlike
    // those two it has a non-destructive rehearsal right beside it, which is
    // what live mode is.
    const n = applyEuclid(t);
    ensureEuclid(t).on = false;
    refreshEuclidUI(t);
    renderEuclidPanel(t, panel);
    const c = liveEuclid(t);
    setStatus(`"${t.name}" — wrote E(${c.pulses}, ${c.steps})${c.rotate ? ` rot ${c.rotate}` : ""}, ${n} hits`);
  });
  upgradeKnobs(panel);
}
