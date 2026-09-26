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

const BLURBS = {
  "plaits:0": "two detuned analog oscillators",
  "plaits:1": "a triangle pushed through folders",
  "plaits:2": "two-operator fm with feedback",
  "plaits:3": "formant grains, vocal and buzzy",
  "plaits:4": "summed harmonics, a sweepable organ",
  "plaits:5": "morphs across a map of wavetables",
  "plaits:6": "four-voice chords from one note",
  "plaits:7": "formants, vowels and robot words",
  "plaits:8": "a cloud of detuned voices",
  "plaits:9": "noise through two resonant peaks",
  "plaits:10": "dust and droplets through a resonator",
  "plaits:11": "a plucked string",
  "plaits:12": "struck bars, bells and plates",
  "plaits:13": "analog-style kick",
  "plaits:14": "analog-style snare",
  "plaits:15": "metallic hat, closed to open",
  "dm:808-kick": "the long sine boom",
  "dm:808-snare": "two tones and a hiss",
  "dm:808-chat": "six squares of metal, short",
  "dm:808-ohat": "six squares of metal, long",
  "dm:808-clap": "flammed noise bursts",
  "dm:808-cowbell": "two squares, bandpassed",
  "dm:909-kick": "punchy kick with a click",
  "dm:909-snare": "bright, noisy snare",
  "dm:909-chat": "tight closed hat",
  "dm:909-ohat": "sizzling open hat",
  "dm:909-clap": "the house clap",
  "dm:poly-saw": "detuned saw chords",
  "dm:fm-bell": "glassy fm bell",
  "dm:pad": "slow, wide pad",
  "dm:silverbox": "acid box: diode ladder, accent, slide",
  "dm:contagion": "hypersaw, two multimode filters",
  "dm:hexop": "six operators, 32 algorithms",
  "dm:snarl": "saws, pulse and a growl",
  "dm:ladder": "three oscillators into a ladder",
  "dm:drift": "dco, sub and chorus",
  "dm:guitar": "string, pickup, amp, cab, feedback",
  "dm:bass": "wound string, dirt, comp, octaver",
  "dm:sub": "sub bass you can hear on a phone",
  "dm:tines": "electric piano",
  "dm:oracle": "big poly analog",
  "dm:granular": "clouds of grains from a sample",
  "wt:akwf": "morphable, editable wavetables",
  "sampler": "your file or a bundled kit",
  "midi": "notes out to a midi device",
  "bus": "no instrument: other tracks run through it",
};

function blurbFor(key) {
  if (BLURBS[key]) return BLURBS[key];
  if (key.startsWith("saved:")) return "saved patch";
  return "";
}

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

/** Read the select's optgroups into [{group, items: [{key, label}]}]. */
function readGroups(sel) {
  const groups = [];
  for (const og of sel.querySelectorAll("optgroup")) {
    const items = [...og.querySelectorAll("option")].map(o => ({ key: o.value, label: o.textContent }));
    if (items.length) groups.push({ group: og.label, items });
  }
  // Options outside any optgroup (none today) still get a home.
  const loose = [...sel.children].filter(c => c.tagName === "OPTION");
  if (loose.length) groups.push({ group: "other", items: loose.map(o => ({ key: o.value, label: o.textContent })) });
  return groups;
}

/** Open the grid for one track's select. Picking commits through the select's
 *  own `change`; cancelling leaves everything as it was. */
export function openEnginePicker(sel) {
  const groups = readGroups(sel);
  const current = sel.value;
  const overlay = document.createElement("div");
  overlay.className = "sq-modal-overlay sq-engine-picker__overlay";

  const chips = [`<button type="button" class="sq-engine-picker__chip is-on" data-group="">all</button>`]
    .concat(groups.map(g => `<button type="button" class="sq-engine-picker__chip" data-group="${esc(g.group)}">${esc(g.group.toLowerCase())}</button>`))
    .join("");
  const sections = groups.map(g => `
    <section class="sq-engine-picker__group" data-group="${esc(g.group)}">
      <h3 class="sq-engine-picker__heading">${esc(g.group.toLowerCase())}</h3>
      <div class="sq-engine-picker__grid">
        ${g.items.map(it => {
          const blurb = blurbFor(it.key);
          const on = it.key === current;
          return `<button type="button" class="sq-engine-picker__card${on ? " is-current" : ""}" data-key="${esc(it.key)}"
            data-search="${esc(`${it.label} ${blurb} ${g.group}`.toLowerCase())}"${on ? ` aria-current="true"` : ""}>
            <span class="sq-engine-picker__name">${esc(it.label)}</span>
            ${blurb ? `<span class="sq-engine-picker__blurb">${esc(blurb)}</span>` : ""}
          </button>`;
        }).join("")}
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
  const pick = (key) => {
    close();
    if (key === sel.value) return; // a native select fires nothing here either
    sel.value = key;
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  };

  const onKey = (e) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); return; }
    const active = document.activeElement;
    if (active === search) {
      if (e.key === "Enter") {
        e.preventDefault();
        const first = visibleCards()[0];
        if (first) pick(first.dataset.key);
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
    const card = e.target.closest(".sq-engine-picker__card");
    if (card) pick(card.dataset.key);
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
