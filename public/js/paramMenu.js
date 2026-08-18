import { AUTOMATION_TARGETS, canAutomate } from "./automation.js";
import { lfoLabel } from "./constants.js";
import { canModulate, syncLFO } from "./lfo.js";
import { addMacroPad, assignToAxis, assignmentsFor, macroPads, unassign } from "./macro.js";
import { CONTROL_LABELS, PARAM_DESCRIPTIONS, PARAM_SCOPE_SELECTOR, autoOwns, controlFromEventTarget, hasAutomation, hasMacroOn, hasMod, LFO_FOR_AUTO, modOwns, refreshParamIndicators, targetsForControl, trackForControl } from "./paramTargets.js";
import { buildAutomationLane, buildLfoRow, renderAutomationPanel, renderModPanel } from "./render.js";
import { state } from "./state.js";


/** @typedef {import("./types.js").Track} Track */

// Right-clicking a parameter control opens this menu: what is modulating or
// automating that one parameter, plus the way to attach either. The mod + aut
// panels list a whole track at once, which is the wrong shape when the question
// is "what is moving THIS knob". The control → target-key map lives in
// paramTargets.js, along with the rule that only one of the two can own a
// parameter at a time.

// What the control is called on screen — the engine relabels these (the 303's
// "harm" slider says cutoff), so read the DOM rather than the key.
function controlLabel(el, fallback) {
  for (const cls of el.classList) {
    if (CONTROL_LABELS[cls]) return CONTROL_LABELS[cls];
  }
  const parts = [];
  const title = el.closest(".sq-fx__row")?.querySelector(".sq-fx__title")?.textContent?.trim();
  if (title) parts.push(title);
  const field = el.closest(".sq-field, .sq-fx__ctl, .sq-virus__f, .sq-dx7__f, label");
  const own = (field?.querySelector("label, span")?.textContent || field?.textContent || "").trim();
  if (own) parts.push(own);
  return parts.join(" · ") || fallback;
}

// What the parameter itself does. A line written for this control wins; then
// the markup's tooltip, which for the 303 / Virus / 808 sliders is rewritten
// per engine by updatePlaitsControlsVisibility and says it better than anything
// generic could; then the line for the target it drives.
function describe(el, spec) {
  for (const cls of el.classList) {
    if (PARAM_DESCRIPTIONS[cls]) return PARAM_DESCRIPTIONS[cls];
  }
  const own = el.title?.trim();
  if (own) return own;
  const field = el.closest(".sq-field, .sq-fx__ctl, .sq-virus__f, .sq-dx7__f, label");
  const inherited = field?.title?.trim();
  if (inherited) return inherited;
  return PARAM_DESCRIPTIONS[spec.auto] || PARAM_DESCRIPTIONS[spec.lfo] || "";
}

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Open the modal for one parameter: its LFO, its automation lane, and the way
 * to add either. Both rows are the same widgets the mod / aut panels use and
 * write the same track state, so the panels agree with this view.
 * @param {Track} t
 * @param {{label: string, description?: string, lfo: string|null, auto: string|null}} spec
 */
export function openParamMenu(t, spec) {
  if (state._paramMenu) state._paramMenu.close();
  const overlay = document.createElement("div");
  overlay.className = "sq-modal-overlay";
  const modal = document.createElement("div");
  modal.className = "sq-modal sq-pmenu__modal";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  // A control neither system can reach — a waveform select, a filter mode, the
  // compressor's knee — still opens the menu, because "what does this do" is
  // worth a right-click on its own. It just says so once instead of printing
  // two sections that both read "can't".
  const settingOnly = !spec.lfo && !spec.auto;
  modal.innerHTML = `
    <div class="sq-modal__title">${esc(spec.label)} <span class="sq-pmenu__sub">— ${settingOnly ? "setting" : "modulation + automation"}</span></div>
    ${spec.description ? `<div class="sq-pmenu__desc">${esc(spec.description)}</div>` : ""}
    ${settingOnly ? `<div class="sq-pmenu__sec"><div class="sq-pmenu__none">no lfo or automation for this one — it's a fixed setting, not a value that can be swept</div></div>` : `
    <section class="sq-pmenu__sec">
      <div class="sq-pmenu__sec-head">lfo${spec.lfo ? ` <span class="sq-pmenu__key">${esc(lfoLabel(spec.lfo))}</span>` : ""}</div>
      <div class="sq-pmenu__body sq-pmenu__body--mod"></div>
    </section>
    <section class="sq-pmenu__sec">
      <div class="sq-pmenu__sec-head">per-step automation${spec.auto ? ` <span class="sq-pmenu__key">${esc(AUTOMATION_TARGETS[spec.auto]?.label ?? spec.auto)}</span>` : ""}</div>
      <div class="sq-pmenu__body sq-pmenu__body--aut"></div>
    </section>
    <section class="sq-pmenu__sec">
      <div class="sq-pmenu__sec-head">macro pad</div>
      <div class="sq-pmenu__body sq-pmenu__body--macro"></div>
    </section>`}
    <div class="sq-modal__actions"><button class="sq-modal__ok" type="button">done</button></div>
  `;
  const modBody = modal.querySelector(".sq-pmenu__body--mod");
  const autBody = modal.querySelector(".sq-pmenu__body--aut");
  const macBody = modal.querySelector(".sq-pmenu__body--macro");

  const note = (text, cls) => {
    const d = document.createElement("div");
    d.className = "sq-pmenu__none" + (cls ? ` ${cls}` : "");
    d.textContent = text;
    return d;
  };
  const addButton = (text, onClick) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "sq-pmenu__add sq-btn--ghost";
    b.textContent = text;
    b.addEventListener("click", onClick);
    return b;
  };

  // The macro section: which pad axis holds this parameter, or the way to put
  // it on one. Same shape as the other two — a parameter takes one owner, so
  // attaching here is refused while an lfo or a lane has it.
  const drawMacro = () => {
    if (!spec.auto) { macBody.appendChild(note("this control can't go on a macro pad")); return; }
    if (!canAutomate(t, spec.auto)) { macBody.appendChild(note("not available on this engine")); return; }
    const held = assignmentsFor(t, spec.auto);
    if (held.length) {
      for (const { pad, axis, a } of held) {
        const row = document.createElement("div");
        row.className = "sq-pmenu__macro-row";
        row.innerHTML = `<span class="sq-pmenu__macro-on">${esc(pad.name)} · ${axis}</span>` +
          `<label class="sq-macro__range">from <input type="number" class="sq-pmenu__lo" min="0" max="1" step="0.01" value="${a.lo}" /></label>` +
          `<label class="sq-macro__range">to <input type="number" class="sq-pmenu__hi" min="0" max="1" step="0.01" value="${a.hi}" /></label>`;
        row.querySelector(".sq-pmenu__lo").addEventListener("input", e => { a.lo = Number(e.target.value); });
        row.querySelector(".sq-pmenu__hi").addEventListener("input", e => { a.hi = Number(e.target.value); });
        row.appendChild(addButton("remove", () => { unassign(pad, axis, a); draw(); }));
        macBody.appendChild(row);
      }
      return;
    }
    if (hasMod(t, LFO_FOR_AUTO[spec.auto])) {
      macBody.appendChild(note("an lfo has this parameter — remove it to use a macro", "sq-pmenu__blocked"));
      return;
    }
    if (hasAutomation(t, spec.auto)) {
      macBody.appendChild(note("automation has this parameter — remove its lane to use a macro", "sq-pmenu__blocked"));
      return;
    }
    macBody.appendChild(note("not on a macro pad"));
    const pads = macroPads();
    if (!pads.length) pads.push(addMacroPad());
    for (const pad of pads) {
      for (const axis of ["x", "y"]) {
        macBody.appendChild(addButton(`+ ${pad.name} · ${axis}`, () => {
          assignToAxis(pad, axis, t, spec.auto);
          draw();
        }));
      }
    }
  };

  // All three sections redraw together: taking one off frees the parameter for
  // the others, so none can be refreshed alone.
  const draw = () => {
    refreshParamIndicators(t);      // the label's dot follows whatever happens here
    if (settingOnly) return;
    modBody.replaceChildren();
    autBody.replaceChildren();
    macBody.replaceChildren();
    drawMacro();

    if (!spec.lfo) modBody.appendChild(note("this control can't be modulated"));
    else if (!canModulate(t, spec.lfo)) modBody.appendChild(note("not modulatable on this engine"));
    else if (t.lfoConfig[spec.lfo]?.enabled) modBody.appendChild(buildLfoRow(t, spec.lfo, draw));
    else if (autoOwns(t, spec.lfo)) modBody.appendChild(note("automation has this parameter — remove its lane to use an lfo", "sq-pmenu__blocked"));
    else {
      modBody.appendChild(note("nothing modulating this"));
      modBody.appendChild(addButton("+ add modulation", () => {
        // A session saved before this target existed has no config for it.
        if (!t.lfoConfig[spec.lfo]) {
          t.lfoConfig[spec.lfo] = { enabled: false, type: "sine", rate: 1.0, depth: 0.5, sync: true, div: 1 };
        }
        t.lfoConfig[spec.lfo].enabled = true;
        syncLFO(t, spec.lfo);
        draw();
      }));
    }

    if (!spec.auto) autBody.appendChild(note("this control can't be automated"));
    else if (!canAutomate(t, spec.auto)) autBody.appendChild(note("not automatable on this engine"));
    else if (t.automation?.[spec.auto]) autBody.appendChild(buildAutomationLane(t, spec.auto, draw));
    else if (modOwns(t, spec.auto)) autBody.appendChild(note("an lfo has this parameter — remove it to automate", "sq-pmenu__blocked"));
    else {
      autBody.appendChild(note("no automation lane on this"));
      autBody.appendChild(addButton("+ add automation", () => {
        autBody.replaceChildren(buildAutomationLane(t, spec.auto, draw));
        draw();
      }));
    }
  };
  draw();

  const close = () => {
    if (!state._paramMenu) return;
    overlay.remove();
    document.removeEventListener("keydown", onKey);
    state._paramMenu = null;
    // The track's own panels list the same rows — rebuild them so anything
    // added or removed here shows up there too.
    if (t._modPanelEl) renderModPanel(t, t._modPanelEl);
    if (t._autPanelEl && t._autModal) renderAutomationPanel(t, t._autPanelEl);
  };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  modal.querySelector(".sq-modal__ok").addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  document.addEventListener("keydown", onKey);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  state._paramMenu = { overlay, close };
}

/**
 * One document-level contextmenu listener for every parameter control, present
 * and future — track DOM is rebuilt constantly (engine switches, session
 * loads), and panels move in and out of modals, so per-control wiring would
 * have to be re-run in a dozen places.
 */
export function installParamContextMenu() {
  document.addEventListener("contextmenu", (e) => {
    if (!(e.target instanceof Element)) return;
    const el = controlFromEventTarget(e.target);
    if (!el) return;
    // A mapped control opens the menu wherever it is; anything else has to be
    // one of the per-track sound controls (see PARAM_SCOPE_SELECTOR).
    const targets = targetsForControl(el)
      || (el.closest(PARAM_SCOPE_SELECTOR) ? { lfo: null, auto: null } : null);
    if (!targets) return;                    // not a parameter — native menu
    const t = trackForControl(el);
    if (!t) return;
    e.preventDefault();
    openParamMenu(t, {
      label: controlLabel(el, targets.auto ?? targets.lfo ?? "parameter"),
      description: describe(el, targets),
      lfo: targets.lfo,
      auto: targets.auto,
    });
  });
}
