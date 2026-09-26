// The instrument picker: a button on the track head that opens a searchable
// grid of every engine, grouped the way the catalog groups them.
//
// It is a skin over the track's `<select class="sq-track__engine">`, the same
// bargain knob.js strikes with the range inputs. The select stays in the DOM
// (hidden) and stays the value: populateEngineSelect still fills it, renderTrack
// / session.js / track.js / main.js still assign `.value` straight to it, the
// change listener in renderTrack still decides what a pick does (the sampler
// and granular source modals included), undo still hears its `change`, and
// jamActivity still finds it by class. The button reads the select; picking a
// card writes the select and dispatches its `change`, exactly as choosing an
// option would.
//
// The engines with a preset table (hexop voices, guitar / bass / subby tones)
// get a section of preset cards too. Picking one picks the engine the ordinary
// way, then writes the track's own preset dropdown and dispatches ITS change,
// so the preset is applied by the same listener the panel uses.

import { BASS_TONE_NAMES, GUITAR_TONE_NAMES, HEXOP_PRESET_NAMES, SUB_TONE_NAMES } from "./engineData.js";

/** Engine key -> its presets, the track dropdown that applies them, and what
 *  the engine calls them. */
const PRESET_TABLES = {
  "dm:hexop":  { noun: "voices", sel: ".sq-hexop__preset", names: HEXOP_PRESET_NAMES },
  "dm:guitar": { noun: "tones",  sel: ".sq-guitar__tone",  names: GUITAR_TONE_NAMES },
  "dm:bass":   { noun: "tones",  sel: ".sq-bass__tone",    names: BASS_TONE_NAMES },
  "dm:sub":    { noun: "tones",  sel: ".sq-sub__tone",     names: SUB_TONE_NAMES },
};

function currentLabel(sel) {
  const opt = sel.options[sel.selectedIndex];
  return opt ? opt.textContent : "choose instrument";
}

function paint(sel) {
  const btn = sel._enginePicker;
  if (!btn) return;
  const label = currentLabel(sel);
  btn.querySelector(".sq-engine-btn__name").textContent = label;
  btn.title = `instrument: ${label}. Click to choose another`;
  btn.setAttribute("aria-label", `instrument: ${label}`);
}

/** Code all over the engine assigns `sel.value` without dispatching, so the
 *  accessor is shadowed per element to keep the button's label true. */
function shadowValue(sel) {
  const desc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");
  if (!desc?.get || !desc?.set) return;
  Object.defineProperty(sel, "value", {
    configurable: true,
    enumerable: false,
    get() { return desc.get.call(this); },
    set(v) { desc.set.call(this, v); paint(this); },
  });
}

/** Put the picker button beside a track's engine select and hide the select.
 *  Idempotent. @param {HTMLSelectElement} sel */
export function upgradeEngineSelect(sel) {
  if (!sel || sel._enginePicker) return;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "sq-track__engine-btn";
  btn.setAttribute("aria-haspopup", "dialog");
  btn.innerHTML = `<span class="sq-engine-btn__name"></span><span class="sq-engine-btn__caret" aria-hidden="true">▾</span>`;
  sel.after(btn);
  sel.hidden = true;
  sel.setAttribute("aria-label", "instrument");
  sel._enginePicker = btn;
  shadowValue(sel);
  btn.addEventListener("click", () => openEnginePicker(sel));
  paint(sel);
}

/** The ring jamActivity draws for a peer's engine change belongs on the
 *  button, since the select itself is hidden. */
export function enginePickerFor(sel) {
  return sel?._enginePicker || null;
}

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

/** Read the select's optgroups into [{group, chip, items: [{key, label}]}],
 *  with a preset section after the group holding each engine that has them. */
function readGroups(sel) {
  const groups = [];
  const add = (label, items) => {
    if (!items.length) return;
    groups.push({ group: label, chip: label, items });
    for (const it of items) {
      const table = PRESET_TABLES[it.key];
      if (!table) continue;
      it.presets = table;
      groups.push({
        group: `${it.label} ${table.noun}`, chip: "presets", presetOf: it.key,
        items: table.names.filter(Boolean).map(name => ({
          key: it.key, label: name, preset: name, engineLabel: it.label,
        })),
      });
    }
  };
  for (const og of sel.querySelectorAll("optgroup")) {
    add(og.label, [...og.querySelectorAll("option")].map(o => ({ key: o.value, label: o.textContent })));
  }
  // Options outside any optgroup (none today) still get a home.
  add("other", [...sel.children].filter(c => c.tagName === "OPTION").map(o => ({ key: o.value, label: o.textContent })));
  // Engine groups first, then the preset sections, so "all" reads as the
  // instruments and then what they come loaded with.
  return [...groups.filter(g => !g.presetOf), ...groups.filter(g => g.presetOf)];
}

/** The track's own preset dropdown for an engine. The panel it lives in can
 *  be reparented into a modal, so it is found by track id, not by ancestry. */
function presetSelectFor(sel, cls) {
  const root = sel.closest("[data-track-id]");
  if (!root) return null;
  return root.querySelector(cls)
    || document.querySelector(`[data-track-id="${root.dataset.trackId}"] ${cls}`);
}

function cardHtml(it, g, current) {
  const on = !it.preset && it.key === current;
  const search = [it.label, g.group, it.engineLabel || ""].join(" ").toLowerCase();
  const presetCount = it.presets
    ? `<span class="sq-engine-picker__jump" data-jump="${esc(it.key)}">${it.presets.names.filter(Boolean).length} ${esc(it.presets.noun)} ›</span>`
    : "";
  return `<button type="button" class="sq-engine-picker__card${on ? " is-current" : ""}${it.preset ? " is-preset" : ""}"
    data-key="${esc(it.key)}"${it.preset ? ` data-preset="${esc(it.preset)}"` : ""}
    data-search="${esc(search)}"${on ? ` aria-current="true"` : ""}>
    <span class="sq-engine-picker__name">${esc(it.label)}</span>
    ${presetCount}
  </button>`;
}

/** Open the grid for one track's select. Picking commits through the select's
 *  own `change`; cancelling leaves everything as it was. */
export function openEnginePicker(sel) {
  const groups = readGroups(sel);
  const current = sel.value;
  const overlay = document.createElement("div");
  overlay.className = "sq-modal-overlay sq-engine-picker__overlay";

  const chipNames = [...new Set(groups.map(g => g.chip))];
  const chips = [`<button type="button" class="sq-engine-picker__chip is-on" data-group="">all</button>`]
    .concat(chipNames.map(c => `<button type="button" class="sq-engine-picker__chip" data-group="${esc(c)}">${esc(c.toLowerCase())}</button>`))
    .join("");
  const sections = groups.map(g => `
    <section class="sq-engine-picker__group" data-group="${esc(g.chip)}"${g.presetOf ? ` data-preset-of="${esc(g.presetOf)}"` : ""}>
      <h3 class="sq-engine-picker__heading">${esc(g.group.toLowerCase())}</h3>
      <div class="sq-engine-picker__grid">
        ${g.items.map(it => cardHtml(it, g, current)).join("")}
      </div>
    </section>`).join("");

  overlay.innerHTML = `
    <div class="sq-modal sq-engine-picker" role="dialog" aria-modal="true" aria-label="choose instrument">
      <div class="sq-engine-picker__top">
        <div class="sq-modal__title">instrument</div>
        <input class="sq-engine-picker__search" type="search" placeholder="search instruments" aria-label="search instruments" autocomplete="off" />
      </div>
      <div class="sq-engine-picker__chips" role="toolbar" aria-label="filter by group">${chips}</div>
      <div class="sq-engine-picker__body">${sections}
        <div class="sq-engine-picker__empty" hidden>nothing matches</div>
      </div>
      <div class="sq-modal__actions">
        <button type="button" class="modal-cancel sq-btn--ghost">cancel</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const search = overlay.querySelector(".sq-engine-picker__search");
  const body = overlay.querySelector(".sq-engine-picker__body");
  const empty = overlay.querySelector(".sq-engine-picker__empty");
  const cards = [...overlay.querySelectorAll(".sq-engine-picker__card")];
  const sectionEls = [...overlay.querySelectorAll(".sq-engine-picker__group")];
  let groupFilter = "";

  const visibleCards = () => cards.filter(c => !c.hidden && !c.closest(".sq-engine-picker__group").hidden);

  const applyFilter = () => {
    const q = search.value.trim().toLowerCase();
    const words = q ? q.split(/\s+/) : [];
    let shown = 0;
    for (const sec of sectionEls) {
      const inGroup = !groupFilter || sec.dataset.group === groupFilter;
      let any = false;
      for (const c of sec.querySelectorAll(".sq-engine-picker__card")) {
        const hit = inGroup && words.every(w => c.dataset.search.includes(w));
        c.hidden = !hit;
        if (hit) any = true, shown++;
      }
      sec.hidden = !any;
    }
    empty.hidden = shown > 0;
  };

  const close = () => {
    overlay.remove();
    document.removeEventListener("keydown", onKey, true);
    sel._enginePicker?.focus();
  };
  const pick = (key, preset) => {
    close();
    // Same engine: a native select fires nothing here either.
    if (key !== sel.value) {
      sel.value = key;
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    }
    if (!preset) return;
    const ps = presetSelectFor(sel, PRESET_TABLES[key]?.sel);
    if (!ps || sel.value !== key) return;
    ps.value = preset;
    ps.dispatchEvent(new Event("change", { bubbles: true }));
  };

  const onKey = (e) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); return; }
    const active = document.activeElement;
    if (active === search) {
      if (e.key === "Enter") {
        e.preventDefault();
        if (!search.value.trim()) return; // nothing typed: nothing to pick
        const first = visibleCards()[0];
        if (first) pick(first.dataset.key, first.dataset.preset);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        visibleCards()[0]?.focus();
      }
      return;
    }
    if (!active?.classList?.contains("sq-engine-picker__card")) return;
    const list = visibleCards();
    const i = list.indexOf(active);
    if (i < 0) return;
    // Arrows walk the grid in reading order; up / down jump a row, measured
    // from the grid's own column count so it matches what is drawn.
    const grid = active.parentElement;
    const cols = Math.max(1, getComputedStyle(grid).gridTemplateColumns.split(" ").length);
    let next = null;
    if (e.key === "ArrowRight") next = list[i + 1];
    else if (e.key === "ArrowLeft") next = list[i - 1];
    else if (e.key === "ArrowDown") next = list[Math.min(list.length - 1, i + cols)];
    else if (e.key === "ArrowUp") next = i - cols < 0 ? null : list[i - cols];
    else return;
    e.preventDefault();
    if (next) next.focus();
    else if (e.key === "ArrowUp" || e.key === "ArrowLeft") search.focus();
  };
  document.addEventListener("keydown", onKey, true);

  search.addEventListener("input", applyFilter);
  overlay.querySelector(".sq-engine-picker__chips").addEventListener("click", (e) => {
    const chip = e.target.closest(".sq-engine-picker__chip");
    if (!chip) return;
    groupFilter = chip.dataset.group;
    for (const c of overlay.querySelectorAll(".sq-engine-picker__chip")) c.classList.toggle("is-on", c === chip);
    body.scrollTop = 0;
    applyFilter();
  });
  body.addEventListener("click", (e) => {
    // "14 tones ›" on an engine card jumps to that engine's presets rather
    // than picking the engine.
    const jump = e.target.closest("[data-jump]");
    if (jump) {
      const target = overlay.querySelector(`[data-preset-of="${CSS.escape(jump.dataset.jump)}"]`);
      if (target?.hidden) {
        groupFilter = "";
        search.value = "";
        for (const c of overlay.querySelectorAll(".sq-engine-picker__chip")) c.classList.toggle("is-on", !c.dataset.group);
        applyFilter();
      }
      if (target) body.scrollTop = target.offsetTop;
      return;
    }
    const card = e.target.closest(".sq-engine-picker__card");
    if (card) pick(card.dataset.key, card.dataset.preset);
  });
  overlay.querySelector(".modal-cancel").addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

  // The current instrument in view and focused. A phone keeps its keyboard
  // down: the search field only takes focus where there is a real keyboard.
  const cur = overlay.querySelector(".sq-engine-picker__card.is-current");
  if (cur) body.scrollTop = Math.max(0, cur.offsetTop - body.clientHeight / 2);
  const coarse = window.matchMedia?.("(pointer: coarse)").matches;
  setTimeout(() => { if (coarse) cur?.focus({ preventScroll: true }); else search.focus(); }, 0);
}
