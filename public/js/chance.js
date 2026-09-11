/**
 * Chance — a stochastic melody generator, in the manner of Vermona's meloDICER.
 * Where the euclid ring divides a cycle evenly, this one throws dice: you don't
 * write notes, you write the *odds* of notes, and the machine plays something
 * that fits them.
 *
 * Two sections, as on the hardware, and they are diced separately:
 *
 *   RHYTHM   note value  ·  variation  ·  legato  ·  rest
 *   MELODY   twelve semitone probabilities  ·  a low and a high note
 *
 * The rhythm is not a step mask, it is a chain of note values laid end to end —
 * see `buildChancePlan` in chanceGen.js, which is the generator proper and where
 * every design note about the walk lives. The two ways to use it are the ring's,
 * for the ring's reasons:
 *
 *   - **write to pattern**: print one throw into the step grid as ordinary
 *     steps, editable by hand from then on.
 *   - **live**: the transport asks the generator for every step. Nothing is
 *     written, so the six controls the machine puts under CV can take an LFO, an
 *     automation lane or a macro pad, and switching it off hands back the
 *     pattern exactly as you left it.
 *
 * A track has one rhythm source, so switching this on switches the ring off —
 * that rule lives in stepSource.js, which is also what the transport and the
 * step grid ask rather than asking a generator directly.
 *
 * ### What each control does, and why it is shaped that way
 *
 * - **note value** is static: no randomness at all, it just sets the base
 *   rhythm. Eight values, the triplets and the 1/32s included (see the ladder).
 * - **variation** is bipolar and off in the middle. Left brings in longer
 *   values, right shorter ones — the machine's arrangement, and the one that
 *   reads correctly under a knob, where "more" in two directions would not.
 * - **legato** is the probability that a note change makes no new gate, so the
 *   note before it is held instead. At the far right nothing ever re-gates and
 *   you get one long note, exactly as on the hardware.
 * - **rest** is the probability a note is dropped. At the far right, silence.
 * - **the twelve semitones** are probabilities, not switches, and they are the
 *   whole melody section: one at 50% against one at 100% turns up half as often,
 *   and a single raised fader is certain wherever it sits.
 * - **the range** is a low and a high note, spanning five octaves at most. A
 *   semitone raised outside it cannot play, and the panel greys it.
 * - **the window** is a first and a last step, and it TILES across the track the
 *   way euclid's cycle does — so a 16-step window on a 16-step track is the
 *   machine, and `first` is also how the window moves (the hardware's sub-range
 *   move) without changing its length.
 * - **the dice**, one per section, are the point of the thing: a throw is held,
 *   so the part repeats and you can play against it. Switch a section to
 *   realtime and it re-throws every pass instead — a repeating rhythm under a
 *   melody that never repeats is why there are two of them.
 */

import {
  CHANCE_DEFAULTS, CHANCE_MOD_INT, CHANCE_MOD_KEYS, CHANCE_MOD_RANGE, CHANCE_NOTE_MAX,
  CHANCE_NOTE_MIN, CHANCE_NOTE_VALUES, CHANCE_SPAN_MAX, buildChancePlan, chanceCandidates,
  chanceDiceDead, chanceWindow, cloneChance, normalizeChance, throwChanceDice,
} from "./chanceGen.js";
import { setStatus } from "./dom.js";
import { refreshKnobRange, setKnobReadout, upgradeKnobs } from "./knob.js";
import { patternMeter, stepsPerBeatForMeter } from "./meter.js";
import { state } from "./state.js";
import { setLiveGenerator } from "./stepSource.js";
import { renderStepGrid } from "./stepGrid.js";
import { SCALES, midiToName } from "./theory.js";

export { cloneChance } from "./chanceGen.js";


/** @typedef {import("./types.js").Track} Track */
/** @typedef {import("./chanceGen.js").ChanceConfig} ChanceConfig */

const clampInt = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(v) || 0)));
const clampNum = (v, lo, hi) => Math.max(lo, Math.min(hi, Number.isFinite(+v) ? +v : lo));

/**
 * What a dead dice says. A dice with nothing to decide is the commonest way this
 * panel looks broken — press roll on a fresh track and the part is identical,
 * because variation, legato and rest all start at zero and there is nothing
 * random in the rhythm yet. So the button says which knob to turn rather than
 * silently rolling a number that changes nothing.
 */
const DEAD_DICE = {
  "no-variance": "nothing in the rhythm is random yet — turn variation, legato or rest up and the dice has something to throw",
  "no-pitch": "no semitone is raised — the melody dice has nothing to choose from",
  "one-pitch": "only one pitch is playable — raise another semitone, or widen the range",
  "no-notes": "the part is all rests — there is no note for the melody dice to pitch",
  same: "every throw comes out the same here — there are too few outcomes to choose between",
};

// ---- the track's settings ------------------------------------------------

/**
 * A track's stored settings, defaulted and clamped to its current length (which
 * the length buttons can shrink underneath a window).
 * @param {Track} t @returns {ChanceConfig}
 */
export function trackChance(t) {
  return normalizeChance(t.chance, t.length);
}

/**
 * The settings the generator is actually running on: the stored ones with any
 * live modulation laid over the top.
 *
 * The overrides live in `t._chanceMod` and are never written back or saved — the
 * same bargain the granular sliders and euclid's counts strike. A knob you can
 * see stays where you left it while something else drives the part.
 * @param {Track} t @returns {ChanceConfig}
 */
export function liveChance(t) {
  const stored = trackChance(t);
  const mod = t._chanceMod;
  if (!mod) return stored;
  const out = { ...stored };
  for (const k of CHANCE_MOD_KEYS) if (mod[k] != null) out[k] = mod[k];
  // Re-clamp once both ends of the range are laid on: a lane sweeping `lo` past
  // a still `hi` would otherwise collapse the range to nothing mid-sweep.
  out.lo = clampInt(out.lo, CHANCE_NOTE_MIN, CHANCE_NOTE_MAX);
  out.hi = clampInt(out.hi, out.lo, Math.min(CHANCE_NOTE_MAX, out.lo + CHANCE_SPAN_MAX));
  out.note = clampInt(out.note, 0, CHANCE_NOTE_VALUES.length - 1);
  out.var = clampNum(out.var, -1, 1);
  out.leg = clampNum(out.leg, 0, 1);
  out.rest = clampNum(out.rest, 0, 1);
  return out;
}

/**
 * Drive one control live. Called by the LFO setter loop (rAF), by an automation
 * lane at step time and by a macro pad — all of which speak the control's own
 * units, having been through `chanceFromUnit`.
 * @param {Track} t @param {string} key @param {number} v
 */
export function setChanceLive(t, key, v) {
  if (!CHANCE_MOD_KEYS.includes(key)) return;
  const mod = t._chanceMod || (t._chanceMod = {});
  mod[key] = v;
  refreshChanceLive(t);
}

/** Hand a control back to its knob — the LFO was switched off. @param {Track} t */
export function clearChanceLive(t, key) {
  if (!t._chanceMod) return;
  delete t._chanceMod[key];
  refreshChanceLive(t);
}

// ---- the generated part --------------------------------------------------

/**
 * Which pass of the window the track is on — the only state realtime-mode needs.
 * `trackTick` is the track's own step counter and has already moved past the step
 * being scheduled by the time the transport asks (see its step loop), so it runs
 * one ahead.
 * @param {Track} t @param {number} win
 */
function passOf(t, win) {
  return Math.floor(Math.max(0, (t.trackTick ?? 0) - 1) / Math.max(1, win));
}

/** Identity of the part a track is currently generating — everything the throw
 *  depends on, so a built plan can be reused until one of them moves. */
function planKey(t, c) {
  const win = chanceWindow(c);
  return [
    t.length, t._patternIdx, c.first, c.last, c.note, c.var.toFixed(4), c.leg.toFixed(4),
    c.rest.toFixed(4), c.lo, c.hi, c.trips, c.x32, c.pcs.join(","), c.rseed, c.mseed,
    c.rfree ? passOf(t, win) : 0, c.mfree ? passOf(t, win) : 0,
  ].join("|");
}

/**
 * The build options a plan is generated with — the meter's beat, for where the
 * accents fall, and which pass of the window realtime-mode is on. Named because
 * the dice has to generate with exactly the same ones as the transport, or it
 * would be comparing its candidate throws against a part nobody is playing.
 * @param {Track} t @param {ChanceConfig} c
 */
function planOpts(t, c) {
  const win = chanceWindow(c);
  return {
    spb: stepsPerBeatForMeter(patternMeter(t._patternIdx ?? state.activePattern)),
    rpass: passOf(t, win),
    mpass: passOf(t, win),
  };
}

/**
 * The current throw, built and cached — the transport asks once per step per
 * track, and the answer only changes when a control moves or the throw does.
 * @param {Track} t
 */
export function chancePlan(t) {
  const c = liveChance(t);
  const key = planKey(t, c);
  if (t._chancePlan?.key === key) return t._chancePlan.plan;
  // A plan replaced while live is a part the grid is now drawing wrongly. Mostly
  // whatever moved the control has already asked for a repaint; a realtime pass
  // rolling over is the one case where nothing else knows, and a grid showing the
  // throw before last is a lie about what you are hearing.
  const staleGrid = !!t._chancePlan && !!t.chance?.on;

  const plan = buildChancePlan(c, planOpts(t, c));
  t._chancePlan = { key, plan, cfg: c };
  if (staleGrid) requestChanceRepaint(t);
  return plan;
}

/** The plan and the config it was built from, for the panel's drawing. @param {Track} t */
export function chanceThrow(t) {
  const plan = chancePlan(t);
  return { plan, cfg: t._chancePlan.cfg };
}

/**
 * What a step plays when this generator is the one in charge. Null means silence
 * — either a rest, or the middle of a note already sounding.
 *
 * The window tiles across the track from `first`, exactly as euclid's cycle does.
 * Unlike euclid this decides the PITCH as well as the rhythm, which is the point
 * of it, so `note` comes back too — and the ratchet with it, because that is how
 * the triplets and the 1/32s reach a sixteenth grid. Everything else still comes
 * from the pattern: a chord written on a step the generator happens to hit voices
 * the generated root, and the automation lanes run as always.
 * @param {Track} t @param {number} idx
 * @returns {{span: number, vel: number, note: number, ratchet: number}|null}
 */
export function chanceGateAt(t, idx) {
  const plan = chancePlan(t);
  const c = t._chancePlan.cfg;
  const win = plan.length;
  const hit = plan[(((idx - c.first) % win) + win) % win];
  if (!hit) return null;
  return { span: hit.span, vel: hit.vel, note: hit.note, ratchet: hit.hits };
}

// ---- writing the pattern -------------------------------------------------

/**
 * The pattern object a generator writes into: the one currently aliased onto the
 * track's arrays. Naming it matters for anything that stays open across a pattern
 * switch — chain mode advances patterns from inside the transport's scheduler,
 * and `t.steps` is re-pointed at the new one underneath you.
 * @param {Track} t
 */
function livePattern(t) {
  return t.patterns?.[t._patternIdx ?? state.activePattern] ?? null;
}

/**
 * Print one throw into a pattern, as ordinary steps.
 *
 * Unlike euclid's write this sets the pitches too — there is no written melody to
 * preserve, because the melody is what was just generated. The window tiles
 * across the whole track, so what gets written is exactly what live mode was
 * playing.
 *
 * @param {Track} t @param {Object} [pat] Pattern to write (defaults to the aliased one).
 * @returns {number} how many notes were written
 */
export function applyChance(t, pat) {
  const p = pat || livePattern(t) || t;
  const plan = chancePlan(t);
  const c = t._chancePlan.cfg;
  const len = Math.max(1, t.length | 0);
  const win = plan.length;

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
    // Stacked piano-roll notes only sound on an active step, so a step the throw
    // just switched back on would otherwise play someone else's chord.
    if (p.extraNotes)   p.extraNotes[i] = null;
    if (p.extraLengths) p.extraLengths[i] = null;
  }

  let written = 0;
  for (let i = 0; i < len; i++) {
    const hit = plan[(((i - c.first) % win) + win) % win];
    if (!hit) continue;
    p.steps[i] = 1;
    // A note starting near the end of the track is cut to fit, the same way the
    // walk cuts one at the end of the window — and loses its ratchet with its
    // length for the same reason (see buildChancePlan): a triplet squeezed into
    // less than its own span is not a triplet.
    const span = Math.max(1, Math.min(hit.span, len - i));
    p.lengths[i] = span;
    p.notes[i] = hit.note;
    p.velocities[i] = hit.vel;
    if (p.ratchets) p.ratchets[i] = span === hit.span ? hit.hits : 1;
    written++;
  }
  return written;
}

/**
 * Load the session's active scale into the semitone probabilities — the one place
 * the global scale and this generator meet.
 *
 * They cannot meet in the transport. Every other note in the app is snapped by
 * `applyScale` on its way out, but here the twelve faders ARE the scale, and
 * snapping a generated note would quietly delete any fader the scale disagreed
 * with while the panel went on claiming it. So the generated pitch bypasses the
 * scale (see the transport's step loop), and this button is how you get the scale
 * into the faders instead — where you can see it, and argue with it.
 * @param {Track} t @returns {boolean} whether there was a scale to load
 */
export function loadScaleIntoChance(t) {
  const degrees = SCALES[state.scale?.mode];
  if (!state.scale?.active || !Array.isArray(degrees)) return false;
  const root = (((state.scale.root | 0) % 12) + 12) % 12;
  const pcs = new Array(12).fill(0);
  // The root above the rest: a scale with every degree equally likely wanders,
  // and it costs nothing to say where home is.
  for (const d of degrees) pcs[(root + d) % 12] = d === 0 ? 1 : 0.7;
  ensureChance(t).pcs = pcs;
  return true;
}

// ---- the panel -----------------------------------------------------------
//
// A permanent panel on the track rather than a modal built on demand, for the
// same reason the filter, the fx rack and the euclid ring are: the controls have
// to exist in the track's DOM whether or not anyone is looking at them, or the
// parameter menu, the mod/aut dots and the macro pads have nothing to find.

const chancePanelOf = (t) =>
  t?._chancePanelEl || t?.el?.querySelector(".sq-track__chance-panel") || null;

/** @param {Track} t */
function ensureChance(t) {
  if (!t.chance) t.chance = cloneChance(CHANCE_DEFAULTS);
  if (!Array.isArray(t.chance.pcs) || t.chance.pcs.length !== 12) {
    t.chance.pcs = CHANCE_DEFAULTS.pcs.slice();
  }
  return t.chance;
}

// Repaints are coalesced onto one frame and skipped when the resolved part hasn't
// moved: the LFO setter loop writes at 60Hz, while a throw only changes when a
// control actually lands somewhere new.
/** @type {Set<Track>} */
const dirty = new Set();
let rafId = null;

function flushChance() {
  rafId = null;
  for (const t of dirty) {
    if (!state.tracks.includes(t)) continue;
    drawChanceViz(t);
    if (t.chance?.on) renderStepGrid(t);
  }
  dirty.clear();
}

function requestChanceRepaint(t) {
  dirty.add(t);
  if (rafId == null) rafId = requestAnimationFrame(flushChance);
}

/**
 * Something drove a control live. Repaint if — and only if — the part the track
 * is generating actually changed.
 * @param {Track} t
 */
export function refreshChanceLive(t) {
  const key = planKey(t, liveChance(t));
  if (t._chancePaintedKey === key) return;
  t._chancePaintedKey = key;
  requestChanceRepaint(t);
}

/**
 * The track-level consequences of live mode: the grid shows what is being
 * generated rather than what is written, so it goes read-only and says so.
 * @param {Track} t
 */
export function refreshChanceUI(t) {
  const on = !!t.chance?.on;
  t.el?.classList.toggle("is-chance", on);
  const btn = t.el?.querySelector(".track-chance");
  if (btn) btn.classList.toggle("is-live", on);
  const live = chancePanelOf(t)?.querySelector(".sq-chance__on");
  if (live) live.checked = on;
  t._chancePaintedKey = null;
  renderStepGrid(t);
}

/**
 * Fill the panel from the track: control values from the STORED settings (they
 * are the base an LFO swings around), the drawing from what is actually being
 * generated.
 * @param {Track} t @param {HTMLElement} [panelEl]
 */
export function renderChancePanel(t, panelEl) {
  const panel = panelEl || chancePanelOf(t);
  if (!panel) return;
  syncChanceControls(t, panel);
  drawChanceViz(t, panel);
}

/** Every knob on the panel: the six modulatable ones, plus the window — knobs
 *  for consistency, but reaching no mod namespace (see CHANCE_MOD_KEYS). */
const CHANCE_KNOBS = [...CHANCE_MOD_KEYS, "first", "last"];

/** Control values + ranges from the stored config. @param {Track} t */
function syncChanceControls(t, panelEl) {
  const panel = panelEl || chancePanelOf(t);
  if (!panel) return;
  const c = trackChance(t);
  const len = Math.max(1, t.length | 0);
  // The knobs are bounded by the STORED settings, not the modulated ones — a knob
  // whose travel changed under a moving LFO would be unplayable.
  const bounds = {
    ...CHANCE_MOD_RANGE,
    hi: [c.lo, Math.min(CHANCE_NOTE_MAX, c.lo + CHANCE_SPAN_MAX)],
    first: [0, len - 1],
    last: [c.first, len - 1],
  };
  for (const key of CHANCE_KNOBS) {
    const el = panel.querySelector(`.p-chn${key}`);
    if (!el) continue;
    const [lo, hi] = bounds[key];
    if (el.min !== String(lo) || el.max !== String(hi)) {
      el.min = String(lo); el.max = String(hi);
      refreshKnobRange(el);
    }
    if (Number(el.value) !== c[key]) el.value = String(c[key]);
  }
  for (const el of panel.querySelectorAll(".sq-chance__pc")) {
    const v = c.pcs[Number(el.dataset.pc) | 0];
    if (Number(el.value) !== v) el.value = String(v);
  }
  const set = (sel, prop, v) => { const el = panel.querySelector(sel); if (el) el[prop] = v; };
  set(".sq-chance__trips", "checked", c.trips);
  set(".sq-chance__x32", "checked", c.x32);
  set(".sq-chance__rfree", "checked", c.rfree);
  set(".sq-chance__mfree", "checked", c.mfree);
  set(".sq-chance__on", "checked", c.on);
}

/**
 * The part, the readouts and the hint — all from the LIVE config, so they show
 * what is playing rather than where the knobs sit. Watching the part change under
 * a still knob is what modulation looks like here.
 * @param {Track} t
 */
function drawChanceViz(t, panelEl) {
  const panel = panelEl || chancePanelOf(t);
  if (!panel) return;
  const { plan, cfg: c } = chanceThrow(t);
  const win = plan.length;
  const len = Math.max(1, t.length | 0);
  const cand = chanceCandidates(c);
  const pct = (v) => `${Math.round(v * 100)}%`;

  const text = (sel, s) => { const el = panel.querySelector(sel); if (el) el.textContent = s; };
  text(".sq-chance__val--note", CHANCE_NOTE_VALUES[c.note].label);
  text(".sq-chance__val--var", Math.abs(c.var) < 0.005 ? "off"
    : `${c.var < 0 ? "longer" : "shorter"} ${pct(Math.abs(c.var))}`);
  text(".sq-chance__val--leg", pct(c.leg));
  text(".sq-chance__val--rest", pct(c.rest));
  text(".sq-chance__val--lo", midiToName(c.lo));
  text(".sq-chance__val--hi", midiToName(c.hi));
  text(".sq-chance__val--first", String(c.first + 1));
  text(".sq-chance__val--last", String(c.last + 1));

  for (const key of CHANCE_MOD_KEYS) {
    const field = panel.querySelector(`.p-chn${key}`)?.closest(".sq-chance__f");
    // Say when a control is being driven from somewhere else, or the still knob
    // beside a changing part reads as a bug.
    if (field) field.classList.toggle("is-driven", t._chanceMod?.[key] != null);
  }
  // Mark the semitones actually in play. One raised on a pitch class the range
  // cannot reach does nothing, and the manual is explicit that it should look
  // that way.
  const reachable = new Set(cand.notes.map(n => ((n % 12) + 12) % 12));
  for (const el of panel.querySelectorAll(".sq-chance__pc")) {
    const i = Number(el.dataset.pc) | 0;
    const key = el.closest(".sq-chance__key");
    if (!key) continue;
    key.classList.toggle("is-live", c.pcs[i] > 0 && reachable.has(i));
    key.classList.toggle("is-dead", c.pcs[i] > 0 && !reachable.has(i));
  }

  const notes = plan.filter(Boolean).length;
  const octs = (c.hi - c.lo) / 12;
  text(".sq-chance__summary",
    `${notes} note${notes === 1 ? "" : "s"} over ${win} step${win === 1 ? "" : "s"}`
    + ` · ${cand.notes.length} playable pitch${cand.notes.length === 1 ? "" : "es"}`
    + ` across ${octs.toFixed(1)} octave${octs === 1 ? "" : "s"}`);

  // A dice with nothing to decide is marked as such, so the reason is visible
  // before the button is pressed rather than only in the status line after.
  for (const [sel, which] of [[".sq-chance__dice-r", "rhythm"], [".sq-chance__dice-m", "melody"]]) {
    const btn = panel.querySelector(sel);
    if (!btn) continue;
    const why = chanceDiceDead(c, which, planOpts(t, c));
    btn.classList.toggle("is-dead", !!why);
    if (!btn.dataset.title) btn.dataset.title = btn.title;
    btn.title = why ? DEAD_DICE[why] : btn.dataset.title;
  }

  const hint = panel.querySelector(".sq-chance__hint");
  if (hint) {
    let s = !cand.total
      ? "no semitone is raised — nothing to choose from, so every note is the bottom of the range"
      : c.on
        ? `generating live${win < len ? `, the window tiling across the track's ${len} steps` : ""}`
          + " — the grid is read-only until you switch it off"
        : `the window is ${win} of the track's ${len} steps`;
    const free = [c.rfree && "rhythm", c.mfree && "melody"].filter(Boolean);
    if (free.length) s += ` · ${free.join(" + ")} realtime, so a new throw every pass — this is one of them`;
    hint.textContent = s;
  }

  // The part, drawn as what it is: pitch against time. Height is the note within
  // the range, width is how long it is held — the two things this generator
  // decides, and the only picture in which a rest, a tie and a leap all read at a
  // glance. (The ring's polygon would say nothing here: there is no evenness to
  // see.)
  const rollEl = panel.querySelector(".sq-chance__roll");
  if (rollEl) {
    const pitchSpan = Math.max(1, c.hi - c.lo);
    // Which steps a note already sounding covers. Those get NO cell of their own:
    // the note's is a `grid-column: span` across them, so a cell each as well
    // would push the row past its column count and wrap it.
    const covered = new Array(win).fill(false);
    for (let i = 0; i < win; i++) {
      if (plan[i]) for (let k = 1; k < plan[i].span && i + k < win; k++) covered[i + k] = true;
    }
    // Written out rather than passed as a custom property: `repeat()` needs a
    // real integer for its count, and `repeat(var(--win), …)` makes the whole
    // declaration invalid — the row then auto-places and wraps. Same idiom
    // renderStepGrid uses for the step grid's own column count.
    rollEl.style.gridTemplateColumns = `repeat(${win}, minmax(0, 1fr))`;
    rollEl.innerHTML = plan.map((hit, i) => {
      if (covered[i]) return "";
      const beat = (c.first + i) % 4 === 0 ? ' data-beat="1"' : "";
      if (!hit) return `<span class="sq-chance__cell"${beat}></span>`;
      const h = Math.round(((hit.note - c.lo) / pitchSpan) * 100);
      return `<span class="sq-chance__cell is-on" style="--h:${h}%;--span:${hit.span};--hits:${hit.hits}"${beat}`
        + ` data-hits="${hit.hits}"`
        + ` title="${midiToName(hit.note)} · ${hit.span} step${hit.span === 1 ? "" : "s"}`
        + `${hit.hits > 1 ? ` · ${hit.hits}× ratchet` : ""}"></span>`;
    }).join("");
  }
  t._chancePaintedKey = planKey(t, c);
}

/**
 * Wire the panel once, at track render. The controls write the track's stored
 * settings — they are ordinary parameters, and everything that can drive them
 * (LFO, lane, macro pad) goes through `setChanceLive` instead, so a performance
 * never touches the base.
 * @param {Track} t @param {HTMLElement} panel
 */
export function wireChancePanel(t, panel) {
  if (!panel) return;
  const changed = () => {
    syncChanceControls(t, panel);
    drawChanceViz(t, panel);
    if (t.chance?.on) renderStepGrid(t);
  };

  // What the drag bubble says while a knob moves: what the value MEANS, not what
  // number it is — "1/8T" and "shorter 40%" rather than 5 and 0.4. The same job
  // setKnobReadout does for the mod row's length knob.
  const READOUT = {
    note: (v) => CHANCE_NOTE_VALUES[clampInt(v, 0, CHANCE_NOTE_VALUES.length - 1)].label,
    var: (v) => (Math.abs(v) < 0.005 ? "off"
      : `${v < 0 ? "longer" : "shorter"} ${Math.round(Math.abs(v) * 100)}%`),
    leg: (v) => `${Math.round(v * 100)}%`,
    rest: (v) => `${Math.round(v * 100)}%`,
    lo: (v) => midiToName(Math.round(v)),
    hi: (v) => midiToName(Math.round(v)),
    first: (v) => `step ${Math.round(v) + 1}`,
    last: (v) => `step ${Math.round(v) + 1}`,
  };
  for (const key of CHANCE_KNOBS) {
    const el = panel.querySelector(`.p-chn${key}`);
    if (!el) continue;
    setKnobReadout(el, READOUT[key]);
    const int = CHANCE_MOD_INT.has(key) || key === "first" || key === "last";
    el.addEventListener("input", () => {
      const c = ensureChance(t);
      c[key] = int ? clampInt(el.value, Number(el.min), Number(el.max))
                   : clampNum(el.value, Number(el.min), Number(el.max));
      // The low note bounds the high one and the first step bounds the last, so
      // pushing one along carries the other with it rather than refusing to move.
      // (The machine simply will not let you set last before first; here these
      // are knobs, and a knob that stops has no way to say why.)
      if (key === "lo") c.hi = clampInt(c.hi, c.lo, Math.min(CHANCE_NOTE_MAX, c.lo + CHANCE_SPAN_MAX));
      if (key === "first") c.last = clampInt(c.last, c.first, Math.max(0, (t.length | 0) - 1));
      changed();
    });
  }

  for (const el of panel.querySelectorAll(".sq-chance__pc")) {
    el.addEventListener("input", () => {
      ensureChance(t).pcs[Number(el.dataset.pc) | 0] = clampNum(el.value, 0, 1);
      changed();
    });
  }

  const flag = (sel, key) => panel.querySelector(sel)?.addEventListener("change", (e) => {
    ensureChance(t)[key] = !!e.target.checked;
    changed();
  });
  flag(".sq-chance__trips", "trips");
  flag(".sq-chance__x32", "x32");
  flag(".sq-chance__rfree", "rfree");
  flag(".sq-chance__mfree", "mfree");

  const dice = (sel, key, which) => panel.querySelector(sel)?.addEventListener("click", () => {
    const c = ensureChance(t);
    // Throw against the config the part is actually generated from, not the
    // stored one: with a lane or a pad driving `rest`, a throw that changes the
    // unmodulated part but not the one being played is no throw at all.
    const live = liveChance(t);
    const { seed, why } = throwChanceDice(live, which, planOpts(t, live));
    if (seed == null) {
      setStatus(`"${t.name}" — ${DEAD_DICE[why] || DEAD_DICE.same}`);
      return;
    }
    c[key] = seed;
    changed();
    setStatus(`"${t.name}" — new ${which} throw`);
  });
  dice(".sq-chance__dice-r", "rseed", "rhythm");
  dice(".sq-chance__dice-m", "mseed", "melody");

  panel.querySelector(".sq-chance__scale")?.addEventListener("click", () => {
    if (loadScaleIntoChance(t)) {
      changed();
      setStatus(`"${t.name}" — semitones set from ${state.scale.mode}`);
    } else {
      setStatus("no scale is active — pick one in the top bar first");
    }
  });
  panel.querySelector(".sq-chance__clear-pcs")?.addEventListener("click", () => {
    ensureChance(t).pcs = new Array(12).fill(0);
    changed();
  });

  panel.querySelector(".sq-chance__on")?.addEventListener("change", (e) => {
    ensureChance(t);
    // One rhythm source at a time — the ring and the dice would both be answering
    // "what does this step play", so switching this on switches the ring off
    // (stepSource.js owns that rule, and refreshes whichever it turned off).
    setLiveGenerator(t, e.target.checked ? "chance" : null);
    renderChancePanel(t, panel);
    setStatus(t.chance.on
      ? `"${t.name}" — chance live`
      : `"${t.name}" — chance off, pattern as you left it`);
  });
  panel.querySelector(".sq-chance__write")?.addEventListener("click", () => {
    // Destructive and labelled so, like clear and the dice — and unlike those two
    // it has a non-destructive rehearsal right beside it, which is what live mode
    // is.
    const n = applyChance(t);
    setLiveGenerator(t, null);
    renderChancePanel(t, panel);
    setStatus(`"${t.name}" — wrote ${n} note${n === 1 ? "" : "s"} from the throw`);
  });
  upgradeKnobs(panel);
}
