// The knob navigator: vim mode's way of turning knobs without the mouse.
//
// One knob is PICKED at a time (outlined, `.is-kbd-nav`), and then the
// trackpad turns it, as do `-` / `=` from vim.js. There are two ways to have
// one picked:
//
//   a panel     a sound panel open as a modal (filter, env, eq, comp),
//               however it was opened. Its controls are what hjkl walk. The
//               fx button opens a picker of stage names instead, and a
//               stage's knobs live on the track, where :k picks them.
//   :k <name>   vim's knob command, which finds a control on the keyboard's
//               track by what it is called (`:k cutoff`, `:k reverb decay`,
//               `:k fx.delay.time`) and picks it, opening its panel first when
//               the knob is not on screen. A knob showing on the track itself
//               is picked where it is, and hjkl walk the track's knobs.
//
// A turn is `writeKnobValue` (knob.js), the knob's own write, so it is an edit
// exactly as a drag is, and history's per-control coalescing makes one swipe
// one undo step. The trackpad is read as distance, not clicks: its events come
// in dozens of small deltas, and a knob's own wheel step (4 units an event)
// would fling it end to end. Arrows move SPATIALLY, to the nearest control in
// that direction as drawn: the fx rack is a grid of cards on desktop and a
// column on a phone, and neither matches the markup's order.

import { AUTOMATION_TARGETS } from "./constants.js";
import { setStatus } from "./dom.js";
import { readoutText, writeKnobValue } from "./knob.js";
import { CLASS_FOR_AUTO, fxShown, refreshPanelBadges } from "./paramTargets.js";

/** Vim's f / c: the button that opens the panel, and the control to start on. */
export const PANELS = {
  fx: { btn: ".sq-track__fx", label: "fx", start: null },
  filter: { btn: ".sq-track__filter", label: "filter", start: ".p-cutoff" },
};
/** The track panels a picked knob can live in, and the button that opens each. */
const PANEL_SEL = [".sq-track__filter-panel", ".sq-track__env-panel", ".sq-track__eq-panel", ".sq-track__comp-panel", ".sq-track__fx-panel"].join(", ");
const panelButton = (panel) => {
  for (const cls of panel.classList) if (cls.endsWith("-panel")) return "." + cls.slice(0, -"-panel".length);
  return null;
};

/** Scroll distance (px) for a knob's whole range; shift is five times finer. */
const SCROLL_FULL = 300;
/** A mouse wheel notch is ~100px in one event; cap an event so it cannot jump a third of the range. */
const SCROLL_MAX_STEP = 0.08;
/** A select or a checkbox moves one notch per this much scroll. */
const DISCRETE_STEP = 0.1;

const nav = {
  /** a panel modal, or a track element for a knob picked on the track */
  scope: /** @type {Element|null} */ (null),
  free: false,        // picked on the track by :k, not inside a panel
  el: /** @type {any} */ (null),
  /** what the next panel to open should start on: a selector or an element */
  prefer: /** @type {string|Element|null} */ (null),
  acc: 0,             // the value a scroll is heading for, unquantised
  accEl: /** @type {any} */ (null),
  discrete: 0,        // scroll gathered towards the next option / toggle
};

function openPanelModal() {
  const all = [...document.querySelectorAll(".sq-panel__modal")];
  for (let i = all.length - 1; i >= 0; i--) if (all[i].querySelector(".sq-fx__row")) return all[i];
  return null;
}
function closePanelModal() {
  /** @type {HTMLElement|null} */ (openPanelModal()?.querySelector(".sq-panel__modal-close"))?.click();
}

const NAV_CONTROLS = 'input[type="range"], select, input[type="checkbox"]';
function navBox(el) { return el.closest(".sq-fx__ctl") || el.closest(".sq-field") || el.closest(".sq-knob") || el; }
function navVisible(el) { return !el.disabled && navBox(el).getClientRects().length > 0; }

/** What hjkl walk: a panel's controls, or the knobs showing on a track. */
function navItems(scope) {
  if (!scope) return [];
  if (!nav.free) return [...scope.querySelectorAll(`.sq-fx__row :is(${NAV_CONTROLS})`)].filter(navVisible);
  return [...scope.querySelectorAll('input[type="range"]')]
    .filter(el => !el.closest(".sq-steps") && navVisible(el));
}

function dropPick() {
  if (nav.el) navBox(nav.el).classList.remove("is-kbd-nav");
  nav.el = null; nav.scope = null; nav.free = false;
}

/** Whether a knob is picked, settling which one first (a panel that just opened or closed). */
export function knobActive() {
  const modal = openPanelModal();
  if (modal) {
    if (nav.scope !== modal || !nav.el || !modal.contains(nav.el) || !navVisible(nav.el)) {
      nav.free = false;
      nav.scope = modal;
      const p = nav.prefer;
      nav.prefer = null;
      const want = typeof p === "string" ? modal.querySelector(p) : (p && modal.contains(p) ? p : null);
      selectNav(want && navVisible(want) ? want : navItems(modal)[0] || null);
    }
    return !!nav.el;
  }
  if (nav.free && nav.el?.isConnected && navVisible(nav.el)) return true;
  dropPick();
  return false;
}

/** Esc: let go of a knob :k picked on the track. A panel's pick goes when the panel closes. */
export function releaseKnob() {
  if (!nav.free || !nav.el) return false;
  dropPick();
  setStatus("");
  return true;
}

function navLabel(el) {
  const row = el.closest(".sq-fx__row");
  const stage = (row?.querySelector(".sq-fx__title")?.textContent || "").replace(/\(.*\)/, "").trim();
  const wrap = el.closest(".sq-fx__ctl, .sq-field, label");
  const name = wrap?.querySelector("span, label")?.textContent?.trim()
    || (el.tagName === "SELECT" ? "option" : el.type === "checkbox" ? "switch" : "");
  const value = el.tagName === "SELECT" ? (el.selectedOptions[0]?.textContent ?? el.value)
    : el.type === "checkbox" ? (el.checked ? "on" : "off")
    : (el._knob ? readoutText(el) : el.value);
  return `${stage ? stage + " · " : ""}${name}: ${value}`;
}

function selectNav(el) {
  if (nav.el) navBox(nav.el).classList.remove("is-kbd-nav");
  nav.el = el;
  nav.accEl = null;
  nav.discrete = 0;
  if (!el) return;
  const box = navBox(el);
  box.classList.add("is-kbd-nav");
  box.scrollIntoView({ block: "nearest", inline: "nearest" });
  setStatus(`${navLabel(el)}. Scroll or - = to turn, hjkl to move`);
}

/** hjkl: the nearest control that way as drawn. Along the arrow plus twice the drift across it. */
export function knobArrow(key) {
  if (!knobActive()) return false;
  const items = navItems(nav.scope);
  if (!items.includes(nav.el)) { selectNav(items[0] || null); return true; }
  const centre = (el) => { const r = navBox(el).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
  const [x0, y0] = centre(nav.el);
  const horiz = key === "ArrowLeft" || key === "ArrowRight";
  const sign = key === "ArrowLeft" || key === "ArrowUp" ? -1 : 1;
  let best = null, bestScore = Infinity;
  for (const el of items) {
    if (el === nav.el) continue;
    const [x, y] = centre(el);
    const along = (horiz ? x - x0 : y - y0) * sign;
    if (along <= 4) continue;
    const score = along + 2 * Math.abs(horiz ? y - y0 : x - x0);
    if (score < bestScore) { bestScore = score; best = el; }
  }
  if (best) selectNav(best);
  return true;
}

/** Turn the picked control by `frac` of its range (a select / checkbox: towards a notch). */
export function turnKnob(frac) {
  if (!knobActive()) return false;
  const el = nav.el;
  if (!frac) return true;
  if (el.type === "range") {
    const min = Number(el.min === "" ? 0 : el.min), max = Number(el.max === "" ? 100 : el.max);
    const span = max - min;
    const step = Number(el.step) > 0 ? Number(el.step) : span / 100;
    // Keep the unquantised target between events, or a run of small trackpad
    // deltas each round back to where they started and the knob never moves.
    if (nav.accEl !== el || Math.abs(nav.acc - Number(el.value)) > step) { nav.acc = Number(el.value); nav.accEl = el; }
    nav.acc = Math.max(min, Math.min(max, nav.acc + frac * span));
    if (!el._knob) {
      el.value = String(nav.acc);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    } else writeKnobValue(el, nav.acc);
  } else {
    nav.discrete += frac;
    if (Math.abs(nav.discrete) < DISCRETE_STEP) return true;
    const dir = Math.sign(nav.discrete);
    nav.discrete = 0;
    if (el.tagName === "SELECT") {
      const i = Math.max(0, Math.min(el.options.length - 1, el.selectedIndex + dir));
      if (i === el.selectedIndex) return true;
      el.selectedIndex = i;
    } else {
      if (el.checked === dir > 0) return true;
      el.checked = dir > 0;
    }
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }
  setStatus(navLabel(el));
  return true;
}

/** Set the picked range control to a 0..1 position (`:k cutoff .4`). */
function setKnobUnit(el, unit) {
  const min = Number(el.min === "" ? 0 : el.min), max = Number(el.max === "" ? 1 : el.max);
  const v = min + Math.max(0, Math.min(1, unit)) * (max - min);
  if (el._knob) writeKnobValue(el, v);
  else { el.value = String(v); el.dispatchEvent(new Event("input", { bubbles: true })); }
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

/** Vim's f / c: open that panel on the track, or close it if it is the one open. */
export function togglePanel(t, spec) {
  const btn = t?.el?.querySelector(spec.btn);
  if (!btn) return;
  const open = openPanelModal();
  const own = open && btn.getAttribute("aria-pressed") === "true";
  if (open && !own) closePanelModal();
  if (!own) { dropPick(); nav.prefer = spec.start; }
  btn.click();
  if (!own && knobActive()) setStatus(`${t.name} ${spec.label}: ${navLabel(nav.el)}. hjkl pick a knob, scroll turns it`);
}

// ---- :k, a knob by name ------------------------------------------------------

const norm = (s) => String(s || "").toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z0-9]/g, "");
let classToAuto = null;

/** Every knob of a track worth naming, with the names it answers to. */
function knobCandidates(t) {
  if (!classToAuto) {
    classToAuto = {};
    for (const [key, cls] of Object.entries(CLASS_FOR_AUTO)) if (!classToAuto[cls]) classToAuto[cls] = key;
  }
  const roots = [t.el, ...document.querySelectorAll(`[data-track-id="${CSS.escape(String(t.id))}"]`)];
  const seen = new Set(), out = [];
  for (const root of roots) {
    if (!root) continue;
    for (const el of root.querySelectorAll('input[type="range"], .sq-fx__ctl select')) {
      if (seen.has(el)) continue;
      seen.add(el);
      if (el.closest(".sq-steps, .sq-track__mod-panel")) continue;
      // Another engine's controls sit in the track hidden; a closed panel's do too, and those count.
      const hidden = el.closest("[hidden]");
      if (hidden && !hidden.matches(PANEL_SEL)) continue;
      const row = el.closest(".sq-fx__row");
      const stage = (row?.querySelector(".sq-fx__title")?.textContent || "").replace(/\(.*\)/, "").trim();
      const label = el.closest(".sq-fx__ctl, .sq-field, label")?.querySelector("span, label")?.textContent?.trim() || "";
      const names = [label, stage && `${stage} ${label}`, row?.dataset.fx && `${row.dataset.fx} ${label}`];
      for (const cls of el.classList) {
        const key = classToAuto[cls];
        if (key) names.push(key, AUTOMATION_TARGETS[key]?.label);
      }
      // What the command line offers for this knob: stage and label, as drawn.
      const display = (stage && label ? `${stage} ${label}` : label || stage).toLowerCase().replace(/\s+/g, " ").trim();
      out.push({ el, display, names: [...new Set(names.filter(Boolean).map(norm))].filter(Boolean) });
    }
  }
  return out;
}

/**
 * The names `:k` can be completed with on this track (vim.js's command line):
 * each knob once, as drawn ("reverb decay", "morph"), with where it is now.
 * @returns {Array<{name: string, hint: string}>}
 */
export function knobNames(t) {
  if (!t) return [];
  const seen = new Set(), out = [];
  for (const c of knobCandidates(t)) {
    if (!c.display || seen.has(c.display)) continue;
    seen.add(c.display);
    const el = c.el;
    const hint = el.tagName === "SELECT" ? (el.selectedOptions[0]?.textContent ?? "") : (el._knob ? readoutText(el) : el.value);
    out.push({ name: c.display, hint: String(hint) });
  }
  return out;
}

/**
 * `:k <name> [value]`: pick the track's knob of that name (exact, then a name
 * starting with it, then one containing it; the first in the track wins a tie),
 * opening its panel when it is not on screen, and set it when a 0..1 value
 * comes too. @returns {string} what happened, "E: ..." when nothing did
 */
export function pickKnob(t, query, value) {
  const want = norm(query);
  if (!t) return "E: no track";
  if (!want) return "E: :k <knob> [0..1], e.g. :k cutoff, :k reverb decay .6";
  let best = null, rank = 3;
  for (const c of knobCandidates(t)) {
    for (const n of c.names) {
      const r = n === want ? 0 : n.startsWith(want) ? 1 : n.includes(want) ? 2 : 3;
      if (r < rank) { rank = r; best = c; }
    }
    if (rank === 0) break;
  }
  if (!best) return `E: no knob called "${query}" on ${t.name}`;
  const el = best.el;
  const modal = openPanelModal();
  if (modal && !modal.contains(el)) closePanelModal();
  if (modal && modal.contains(el)) {
    nav.free = false; nav.scope = modal; selectNav(el);
  } else if (navVisible(el)) {
    dropPick();
    nav.free = true; nav.scope = t.el; selectNav(el);
  } else if (el.closest(".sq-track__fx-panel")) {
    // The fx button opens a picker of names, not the rack: a stage's knobs
    // only exist on the track. So show the stage there (without engaging it,
    // which would change the sound) and pick the knob where it now is.
    const navRow = el.closest(".sq-fx__row");
    const stage = navRow && !navRow.dataset.fxId ? navRow.dataset.fx : null;
    if (stage) { fxShown(t).add(stage); refreshPanelBadges(t); }
    if (!navVisible(el)) return `E: ${navLabel(el)} is not showing on ${t.name}`;
    dropPick();
    nav.free = true; nav.scope = t.el; selectNav(el);
  } else {
    const panel = el.closest(PANEL_SEL);
    const btn = panel && panelButton(panel) && t.el.querySelector(panelButton(panel));
    if (!btn) return `E: ${navLabel(el)} is not showing on ${t.name}`;
    dropPick();
    nav.prefer = el;
    btn.click();
    if (!knobActive() || nav.el !== el) return `E: could not open the panel for ${query}`;
  }
  if (value != null && value !== "") {
    const v = Number(value);
    if (!(v >= 0 && v <= 1)) return "E: a knob's value is 0 to 1";
    if (el.type !== "range") return "E: that one is a menu. Scroll to change it";
    setKnobUnit(el, v);
  }
  return `${t.name}: ${navLabel(el)}. Scroll or - = to turn, esc to let go`;
}

// ---- the trackpad ----------------------------------------------------------------

let installed = false;
/** @param {() => boolean} enabled whether the wheel is ours (vim mode on) */
export function initKnobNav(enabled) {
  if (installed) return;
  installed = true;
  window.addEventListener("wheel", (e) => {
    if (e.ctrlKey || !enabled()) return;                     // ctrl-wheel is a trackpad pinch
    if (!knobActive()) return;
    if (e.target?.closest?.(".sq-knob")) return;              // the knob under the pointer turns itself
    let d = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? -e.deltaY : e.deltaX;
    if (e.deltaMode === 1) d *= 16; else if (e.deltaMode === 2) d *= 400;
    e.preventDefault();
    const frac = d / (e.shiftKey ? SCROLL_FULL * 5 : SCROLL_FULL);
    turnKnob(Math.max(-SCROLL_MAX_STEP, Math.min(SCROLL_MAX_STEP, frac)));
  }, { capture: true, passive: false });
}
