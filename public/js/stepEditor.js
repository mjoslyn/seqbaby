import { engineByKey } from "./catalog.js";
import { setStatus } from "./dom.js";
import { applySampleSpeed, currentBpm } from "./lfo.js";
import { renderRollPanel } from "./pianoRoll.js";
import { renderAutomationPanel } from "./render.js";
import { aliasPattern, invertChord, state } from "./state.js";
import { renderStepGrid } from "./stepGrid.js";
import { CHORD_TYPES, SCALES, applyScale, chordFitsScale, chordNotes, midiToName } from "./theory.js";
import { applySampleSettingsToAllSteps } from "./track.js";
import { ensureAudio } from "./transport.js";


/** @typedef {import("./types.js").Track} Track */
export let stepEditor = null;
// Host a track panel inside a centered modal overlay. The panel is physically
// moved into the modal so existing render + event wiring keeps working
// unchanged; on close it slots back into the track via a placeholder anchor,
// so DOM order is preserved. Used by the piano roll, mod, and aut panels.
export function openPanelAsModal(t, opts) {
  const { panel, modalClass, btnSel, modalKey, afterMount } = opts;
  if (!panel || t[modalKey]) return;
  const anchor = document.createComment("panel-anchor");
  panel.replaceWith(anchor);

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  const modal = document.createElement("div");
  modal.className = "modal panel-modal " + modalClass;
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");

  panel.hidden = false;
  modal.appendChild(panel);

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "panel-modal-close";
  closeBtn.textContent = "done";
  modal.appendChild(closeBtn);

  const close = () => {
    if (!t[modalKey]) return;
    anchor.replaceWith(panel);
    panel.hidden = true;
    overlay.remove();
    const btn = t.el?.querySelector(btnSel);
    if (btn) btn.setAttribute("aria-pressed", "false");
    document.removeEventListener("keydown", escHandler);
    t[modalKey] = null;
  };
  const escHandler = (e) => { if (e.key === "Escape") close(); };
  closeBtn.addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  document.addEventListener("keydown", escHandler);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  t[modalKey] = { overlay, close };
  if (afterMount) afterMount();
}

export function openRollAsModal(t) {
  openPanelAsModal(t, {
    panel: t._rollPanelEl,
    modalClass: "roll-modal",
    btnSel: ".track-roll",
    modalKey: "_rollModal",
    afterMount: () => renderRollPanel(t, t._rollPanelEl),
  });
}

export function openModAsModal(t) {
  openPanelAsModal(t, {
    panel: t._modPanelEl,
    modalClass: "mod-modal",
    btnSel: ".track-mod",
    modalKey: "_modModal",
  });
}

export function openAutAsModal(t) {
  openPanelAsModal(t, {
    panel: t._autPanelEl,
    modalClass: "aut-modal",
    btnSel: ".track-aut",
    modalKey: "_autModal",
    afterMount: () => renderAutomationPanel(t, t._autPanelEl),
  });
}

export function openFilterAsModal(t) {
  openPanelAsModal(t, {
    panel: t._filterPanelEl,
    modalClass: "filter-modal",
    btnSel: ".track-filter",
    modalKey: "_filterModal",
  });
}

export function openEnvAsModal(t) {
  openPanelAsModal(t, {
    panel: t._envPanelEl,
    modalClass: "env-modal",
    btnSel: ".track-env",
    modalKey: "_envModal",
  });
}

export function openFxAsModal(t) {
  openPanelAsModal(t, {
    panel: t._fxPanelEl,
    modalClass: "fx-modal",
    btnSel: ".track-fx",
    modalKey: "_fxModal",
  });
}

export function openEqAsModal(t) {
  openPanelAsModal(t, {
    panel: t._eqPanelEl,
    modalClass: "eq-modal",
    btnSel: ".track-eq",
    modalKey: "_eqModal",
  });
}

export function openCompAsModal(t) {
  openPanelAsModal(t, {
    panel: t._compPanelEl,
    modalClass: "comp-modal",
    btnSel: ".track-comp",
    modalKey: "_compModal",
  });
}

// Mobile track menu: physically move the "extras" nodes out of the
// track-head into a centered modal so the user can reach the rarely-used
// controls (save/load patch, len resize, oct/semi shift, synth params,
// dup, remove) without horizontal scrolling. Restored to their original
// DOM positions on close so the desktop layout is unaffected.
export function openTrackMenu(t) {
  if (t._trackMenuModal) return;
  const head = t.el?.querySelector(".track-head");
  if (!head) return;

  const selectors = [
    ".track-save",
    ".track-load-patch",
    ".track-len-extend",
    ".track-synth-row",
    ".track-dup",
    ".track-remove",
    ".track-oct",
  ];
  const captured = [];
  for (const sel of selectors) {
    const n = head.querySelector(sel);
    if (n) captured.push({ node: n, nextSibling: n.nextSibling });
  }
  const speedField = head.querySelector(".track-speed")?.closest(".field");
  if (speedField) captured.push({ node: speedField, nextSibling: speedField.nextSibling });

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  const modal = document.createElement("div");
  modal.className = "modal track-menu-modal";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");

  const title = document.createElement("div");
  title.className = "track-menu-title";
  title.textContent = t.name?.trim() || "track";
  modal.appendChild(title);

  for (const { node } of captured) modal.appendChild(node);

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "track-menu-close";
  closeBtn.textContent = "done";
  modal.appendChild(closeBtn);

  const close = () => {
    if (!t._trackMenuModal) return;
    for (const { node, nextSibling } of captured) {
      if (nextSibling && nextSibling.parentNode === head) {
        head.insertBefore(node, nextSibling);
      } else {
        head.appendChild(node);
      }
    }
    overlay.remove();
    document.removeEventListener("keydown", escHandler);
    t._trackMenuModal = null;
    if (t._trackMoreBtn) t._trackMoreBtn.setAttribute("aria-pressed", "false");
  };
  const escHandler = (e) => { if (e.key === "Escape") close(); };
  closeBtn.addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  document.addEventListener("keydown", escHandler);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  t._trackMenuModal = { overlay, close };
  if (t._trackMoreBtn) t._trackMoreBtn.setAttribute("aria-pressed", "true");
}

// Mobile pattern menu: physically move every pattern-bar child (except the
// Share + Menu buttons) into a modal. On close, return them in original
// order so the desktop pattern bar is unchanged. Children retain their
// event listeners because we only re-parent, never re-create.
export function closeStepEditor() {
  if (!stepEditor) return;
  document.removeEventListener("keydown", stepEditor.escHandler);
  (stepEditor.overlay || stepEditor.el).remove();
  stepEditor = null;
}

/**
 * Open the per-step editor modal (note pad, chord/arp, ratchet/vel/offset,
 * and the sample row for sample engines).
 * @param {Track} t @param {number} idx @param {HTMLElement} anchorEl
 */
export function openStepEditor(t, idx, anchorEl) {
  closeStepEditor();
  const eng = engineByKey(t.engineKey);
  const defaultNote = t.notes[idx] ?? eng?.defaultNote ?? 60;
  const el = document.createElement("div");
  el.className = "step-editor";
  const chordOptions = `<option value="">none</option>`;
  el.innerHTML = `
    <div class="se-title">step ${idx + 1}</div>
    <div class="se-field se-note-field">
      <label>note</label>
      <div class="se-note-header">
        <span class="se-note-label"></span>
        <div class="se-oct-pager">
          <button class="se-oct-down" type="button" title="lower octaves">oct −</button>
          <span class="se-oct-range"></span>
          <button class="se-oct-up" type="button" title="higher octaves">oct +</button>
        </div>
      </div>
      <div class="se-keyboard" tabindex="0"></div>
      <input class="se-note" type="hidden" value="${Math.max(24, Math.min(95, defaultNote))}" />
    </div>
    <div class="se-field se-chord-field">
      <label>chord</label>
      <select class="se-chord">${chordOptions}</select>
      <label class="se-arp-wrap"><input class="se-arp" type="checkbox" /> arp</label>
      <span class="se-chord-label"></span>
    </div>
    <div class="se-field se-ratchet-row">
      <label>ratchet</label>
      <input class="se-ratchet" type="range" min="1" max="8" step="1" value="${(t.ratchets && t.ratchets[idx]) || 1}" />
      <span class="se-ratchet-label"></span>
    </div>
    <div class="se-field se-cpx-row">
      <label>cpx</label>
      <select class="se-cpx">
        <option value="0">root</option>
        <option value="1">1st inv</option>
        <option value="2">2nd inv</option>
        <option value="3">3rd inv</option>
        <option value="4">drop-oct</option>
      </select>
    </div>
    <div class="se-field se-arp-row" hidden>
      <label>arp</label>
      <div class="se-arp-selects">
        <select class="se-arp-rate" title="arp rate (beats per note)">
          <option value="1">1/4</option>
          <option value="0.5">1/8</option>
          <option value="0.333">1/8t</option>
          <option value="0.25" selected>1/16</option>
          <option value="0.167">1/16t</option>
          <option value="0.125">1/32</option>
        </select>
        <select class="se-arp-range" title="octaves spanned">
          <option value="1" selected>1 oct</option>
          <option value="2">2 oct</option>
          <option value="3">3 oct</option>
          <option value="4">4 oct</option>
        </select>
        <select class="se-arp-dir" title="arp direction">
          <option value="up" selected>up</option>
          <option value="down">down</option>
          <option value="updown">up-down</option>
          <option value="random">random</option>
        </select>
      </div>
    </div>
    <div class="se-field">
      <label>vel</label>
      <input class="se-vel" type="range" min="0" max="1" step="0.01" value="${t.velocities[idx] ?? 0.5}" />
      <span class="se-vel-label"></span>
    </div>
    <div class="se-field">
      <label>offset</label>
      <input class="se-offset" type="range" min="-0.5" max="0.5" step="0.01" value="${t.offsets?.[idx] ?? 0}" />
      <span class="se-offset-label"></span>
    </div>
    <div class="se-field se-sample-row" hidden>
      <label>sample</label>
      <div class="se-sample-ctl">
        <canvas class="se-waveform" width="440" height="72"></canvas>
        <div class="se-sample-meta">
          <span class="se-smp-info">—</span>
          <label>fit
            <select class="se-smp-fit">
              <option value="native" selected>native</option>
              <option value="2xbpm">2× bpm</option>
              <option value="1xbpm">1× bpm</option>
              <option value="1/2bpm">1/2 bpm</option>
              <option value="1/4bpm">1/4 bpm</option>
            </select>
          </label>
          <label>snap
            <select class="se-smp-snap">
              <option value="free" selected>free</option>
              <option value="1">1 beat</option>
              <option value="0.5">1/8</option>
              <option value="0.25">1/16</option>
              <option value="0.125">1/32</option>
            </select>
          </label>
          <label>loop
            <select class="se-smp-loop">
              <option value="off" selected>off</option>
              <option value="loop">loop</option>
              <option value="pingpong">ping-pong</option>
            </select>
          </label>
          <button class="se-preview" type="button">preview</button>
          <button class="se-apply-all ghost" type="button" title="apply these sample settings to every step on this track and use as the default for new steps">apply to all</button>
        </div>
        <div class="se-sample-fade">
          <label>fade in <input class="se-smp-fade-in" type="range" min="0" max="2" step="0.01" value="0" /><span class="se-smp-fade-in-lbl">0 ms</span></label>
          <label>fade out <input class="se-smp-fade-out" type="range" min="0" max="2" step="0.01" value="0" /><span class="se-smp-fade-out-lbl">0 ms</span></label>
        </div>
      </div>
    </div>
    <div class="se-actions">
      <button class="se-close">done</button>
    </div>
  `;
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.appendChild(el);
  document.body.appendChild(overlay);

  const noteInput = el.querySelector(".se-note");
  const noteLbl = el.querySelector(".se-note-label");
  const velInput = el.querySelector(".se-vel");
  const velLbl = el.querySelector(".se-vel-label");
  const chordSel = el.querySelector(".se-chord");
  const chordLbl = el.querySelector(".se-chord-label");
  const arpBox   = el.querySelector(".se-arp");
  const cpxInput = el.querySelector(".se-cpx");
  cpxInput.value = String(Math.max(0, Math.min(4, (t.complexities && t.complexities[idx]) || 0)));
  const offsetInput = el.querySelector(".se-offset");
  const offsetLbl = el.querySelector(".se-offset-label");
  const rebuildChords = () => {
    const root = Number(noteInput.value) || 60;
    const prev = chordSel.value || t.chords?.[idx] || "";
    const opts = [`<option value="">none</option>`];
    for (const key of Object.keys(CHORD_TYPES)) {
      if (!key) continue;
      if (!chordFitsScale(root, key)) continue;
      opts.push(`<option value="${key}">${key}</option>`);
    }
    chordSel.innerHTML = opts.join("");
    const stillThere = Array.from(chordSel.options).some(o => o.value === prev);
    if (stillThere) chordSel.value = prev;
    else {
      chordSel.value = "";
      if (t.chords) t.chords[idx] = "";
    }
  };
  rebuildChords();
  arpBox.checked = !!(t.arps && t.arps[idx]);
  const arpRow   = el.querySelector(".se-arp-row");
  const arpRate  = el.querySelector(".se-arp-rate");
  const arpRange = el.querySelector(".se-arp-range");
  const arpDir   = el.querySelector(".se-arp-dir");
  arpRate.value  = String(t.arpRates?.[idx]  ?? 0.25);
  arpRange.value = String(t.arpRanges?.[idx] ?? 1);
  arpDir.value   = String(t.arpDirs?.[idx]   ?? "up");
  const arpWrap = el.querySelector(".se-arp-wrap");
  const cpxRow  = el.querySelector(".se-cpx-row");
  const ratchetRow = el.querySelector(".se-ratchet-row");
  const ratchetInput = el.querySelector(".se-ratchet");
  const ratchetLbl = el.querySelector(".se-ratchet-label");
  const syncChordOptsVisibility = () => {
    const hasChord = !!chordSel.value;
    if (arpWrap)     arpWrap.hidden = !hasChord;
    if (cpxRow)      cpxRow.hidden = !hasChord;
    if (chordLbl)    chordLbl.hidden = !hasChord;
    if (ratchetRow)  ratchetRow.hidden = hasChord;
  };
  ratchetInput.value = (t.ratchets && t.ratchets[idx]) || 1;
  ratchetLbl.textContent = `×${ratchetInput.value}`;
  ratchetInput.addEventListener("input", () => {
    if (!t.ratchets) t.ratchets = new Array(t.length).fill(1);
    const v = Math.max(1, Math.min(8, Math.round(Number(ratchetInput.value) || 1)));
    t.ratchets[idx] = v;
    ratchetLbl.textContent = `×${v}`;
  });
  const syncArpRowVisibility = () => { arpRow.hidden = !(chordSel.value && arpBox.checked); };
  syncChordOptsVisibility();
  syncArpRowVisibility();

  // Build Launchpad-style pad grid (bottom-left = lowest, top-right = highest).
  // Only 3 octaves are visible at a time — use the pager (oct +/−) to shift the window.
  // When a scale is active, only in-scale notes are shown and columns = scale length.
  const kb = el.querySelector(".se-keyboard");
  const octDownBtn  = el.querySelector(".se-oct-down");
  const octUpBtn    = el.querySelector(".se-oct-up");
  const octRangeLbl = el.querySelector(".se-oct-range");
  const scaleIntervals = state.scale.active ? (SCALES[state.scale.mode] || null) : null;
  const PC_NAMES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
  // Microtonal scales (Hüseyni, 24-TET) carry half-integer intervals; step the pad
  // by 0.5 semitones so quarter tones appear as clickable pads.
  const EPS = 1e-6;
  const scaleStep = scaleIntervals && scaleIntervals.some(i => i !== Math.floor(i)) ? 0.5 : 1;
  const VIEW_OCTS = 3;
  const MIN_OCT = 1, MAX_OCT = 6;
  const octaveOf = (m) => Math.floor(m / 12) - 1;
  let viewOctStart = Math.max(MIN_OCT, Math.min(MAX_OCT - VIEW_OCTS + 1, octaveOf(defaultNote) - 1));
  const COLS = scaleIntervals ? scaleIntervals.length : 12;
  kb.style.gridTemplateColumns = `repeat(${COLS}, var(--se-pad-size))`;

  const renderPads = () => {
    kb.replaceChildren();
    const lo = 24 + (viewOctStart - 1) * 12;
    const hi = lo + VIEW_OCTS * 12;
    const visible = [];
    for (let m = lo; m < hi && m <= 95; m += scaleStep) {
      if (!scaleIntervals) { visible.push(m); continue; }
      const rel = ((m - state.scale.root) % 12 + 12) % 12;
      if (scaleIntervals.some(i => Math.abs(i - rel) < EPS)) visible.push(m);
    }
    const ROWS = Math.max(1, Math.ceil(visible.length / COLS));
    for (let i = 0; i < visible.length; i++) {
      const m = visible[i];
      const basePc = ((Math.round(m) % 12) + 12) % 12;
      const isMicrotonal = m !== Math.round(m);
      const pad = document.createElement("button");
      pad.type = "button";
      pad.className = "se-pad";
      pad.dataset.note = String(m);
      if (scaleIntervals) {
        pad.classList.add("in-scale");
        if (!isMicrotonal && basePc === state.scale.root) pad.classList.add("root");
      }
      pad.title = midiToName(m);
      pad.textContent = isMicrotonal
        ? midiToName(m)
        : `${PC_NAMES[basePc]}${octaveOf(m)}`;
      pad.style.gridRow = String(ROWS - Math.floor(i / COLS));
      pad.style.gridColumn = String((i % COLS) + 1);
      kb.appendChild(pad);
    }
    // re-apply selected highlight if the current note is in view
    const cur = Number(noteInput.value);
    const active = kb.querySelector(`.se-pad[data-note="${cur}"]`);
    if (active) active.classList.add("selected");
    if (octRangeLbl) octRangeLbl.textContent = `oct ${viewOctStart}–${viewOctStart + VIEW_OCTS - 1}`;
    if (octDownBtn) octDownBtn.disabled = viewOctStart <= MIN_OCT;
    if (octUpBtn)   octUpBtn.disabled   = viewOctStart + VIEW_OCTS - 1 >= MAX_OCT;
  };
  renderPads();
  if (octDownBtn) octDownBtn.addEventListener("click", () => {
    if (viewOctStart > MIN_OCT) { viewOctStart--; renderPads(); }
  });
  if (octUpBtn) octUpBtn.addEventListener("click", () => {
    if (viewOctStart + VIEW_OCTS - 1 < MAX_OCT) { viewOctStart++; renderPads(); }
  });
  const setNote = (v, { render = true } = {}) => {
    // Preserve fractional MIDI here — microtonal scales yield quarter-tone notes
    // that applyScale will snap to the nearest scale pitch.
    let n = Math.max(24, Math.min(95, Number(v)));
    n = applyScale(n);
    noteInput.value = String(n);
    t.notes[idx] = n;
    if (!t.isDrumKit) t.lastEditedNote = n;
    const nOct = octaveOf(n);
    if (nOct < viewOctStart || nOct > viewOctStart + VIEW_OCTS - 1) {
      viewOctStart = Math.max(MIN_OCT, Math.min(MAX_OCT - VIEW_OCTS + 1, nOct - 1));
      renderPads();
    } else {
      kb.querySelectorAll(".se-pad.selected").forEach(k => k.classList.remove("selected"));
      const active = kb.querySelector(`.se-pad[data-note="${n}"]`);
      if (active) active.classList.add("selected");
    }
    rebuildChords();
    syncChordOptsVisibility();
    syncArpRowVisibility();
    if (render) { refresh(); renderStepGrid(t); }
  };
  kb.addEventListener("click", (e) => {
    const k = e.target.closest(".se-pad");
    if (!k) return;
    setNote(Number(k.dataset.note));
  });

  const refresh = () => {
    const n = Number(noteInput.value);
    noteLbl.textContent = `${midiToName(n)} (${n})`;
    velLbl.textContent = Number(velInput.value).toFixed(2);
    const ch = chordSel.value;
    let chordLbls = "single";
    if (ch) {
      const base = chordNotes(Number(noteInput.value), ch);
      const cpx = Math.max(0, Math.min(base.length - 1, Number(cpxInput.value) || 0));
      const voiced = invertChord(base, cpx);
      chordLbls = (arpBox.checked ? "arp: " : "") + voiced.map(midiToName).join(arpBox.checked ? " → " : " · ");
    }
    chordLbl.textContent = chordLbls;
    const off = Number(offsetInput.value);
    offsetLbl.textContent = `${off >= 0 ? "+" : ""}${off.toFixed(2)}`;
    arpBox.disabled = !ch;
    cpxInput.disabled = !ch;
    const cur = Number(noteInput.value);
    kb.querySelectorAll(".se-pad.selected").forEach(k => k.classList.remove("selected"));
    const sel = kb.querySelector(`.se-pad[data-note="${cur}"]`);
    if (sel) sel.classList.add("selected");
  };
  refresh();

  offsetInput.addEventListener("input", () => {
    if (!t.offsets) t.offsets = new Array(t.length).fill(0);
    t.offsets[idx] = Number(offsetInput.value);
    refresh();
  });

  // sample-engine specific row: waveform with draggable start/end handles + preview
  const sampleRow = el.querySelector(".se-sample-row");
  const engineType = engineByKey(t.engineKey)?.type;
  const isSampleEngine = engineType === "eleven" || engineType === "upload" || engineType === "sample";
  sampleRow.hidden = !isSampleEngine;
  if (isSampleEngine) {
    const canvas = sampleRow.querySelector(".se-waveform");
    const infoEl = sampleRow.querySelector(".se-smp-info");
    const snapSel = sampleRow.querySelector(".se-smp-snap");
    const fitSel  = sampleRow.querySelector(".se-smp-fit");
    const prev    = sampleRow.querySelector(".se-preview");
    const applyAllBtn = sampleRow.querySelector(".se-apply-all");
    if (fitSel) {
      fitSel.value = t.sampleSpeedMode || "native";
      fitSel.addEventListener("change", () => {
        t.sampleSpeedMode = fitSel.value || "native";
        applySampleSpeed(t);
      });
    }
    if (!t.sampleStarts) t.sampleStarts = new Array(t.length).fill(0);
    if (!t.sampleEnds)   t.sampleEnds   = new Array(t.length).fill(1);
    if (!t.sampleFadeIns)  t.sampleFadeIns  = new Array(t.length).fill(0);
    if (!t.sampleFadeOuts) t.sampleFadeOuts = new Array(t.length).fill(0);
    if (!t.sampleLoopModes) t.sampleLoopModes = new Array(t.length).fill("off");

    const loopSel = sampleRow.querySelector(".se-smp-loop");
    if (loopSel) {
      loopSel.value = t.sampleLoopModes[idx] || "off";
      loopSel.addEventListener("change", () => {
        const v = loopSel.value;
        t.sampleLoopModes[idx] = (v === "loop" || v === "pingpong") ? v : "off";
      });
    }

    const fadeInInput  = sampleRow.querySelector(".se-smp-fade-in");
    const fadeOutInput = sampleRow.querySelector(".se-smp-fade-out");
    const fadeInLbl    = sampleRow.querySelector(".se-smp-fade-in-lbl");
    const fadeOutLbl   = sampleRow.querySelector(".se-smp-fade-out-lbl");
    const fmtFade = (sec) => sec < 1 ? `${Math.round(sec * 1000)} ms` : `${sec.toFixed(2)} s`;
    if (fadeInInput) {
      fadeInInput.value = String(t.sampleFadeIns[idx] ?? 0);
      fadeInLbl.textContent = fmtFade(Number(fadeInInput.value));
      fadeInInput.addEventListener("input", () => {
        const v = Math.max(0, Math.min(2, Number(fadeInInput.value) || 0));
        t.sampleFadeIns[idx] = v;
        fadeInLbl.textContent = fmtFade(v);
      });
    }
    if (fadeOutInput) {
      fadeOutInput.value = String(t.sampleFadeOuts[idx] ?? 0);
      fadeOutLbl.textContent = fmtFade(Number(fadeOutInput.value));
      fadeOutInput.addEventListener("input", () => {
        const v = Math.max(0, Math.min(2, Number(fadeOutInput.value) || 0));
        t.sampleFadeOuts[idx] = v;
        fadeOutLbl.textContent = fmtFade(v);
      });
    }

    const snapFrac = () => {
      if (snapSel.value === "free") return 0;
      const beats = Number(snapSel.value) || 0;
      if (!beats) return 0;
      const buf = t.voice?.buffer;
      if (!buf || !buf.duration) return 0;
      const stepSec = (60 / currentBpm()) * beats;
      return stepSec / buf.duration;
    };
    const snapTo = (frac) => {
      const s = snapFrac();
      if (!s) return frac;
      return Math.round(frac / s) * s;
    };

    const drawWave = () => {
      const ctx2d = canvas.getContext("2d");
      const w = canvas.width, h = canvas.height;
      ctx2d.clearRect(0, 0, w, h);
      ctx2d.fillStyle = "#0e0f12";
      ctx2d.fillRect(0, 0, w, h);
      const buf = t.voice?.buffer;
      if (buf) {
        const data = buf.getChannelData(0);
        const step = Math.max(1, Math.floor(data.length / w));
        ctx2d.strokeStyle = "#6e7280";
        ctx2d.lineWidth = 1;
        ctx2d.beginPath();
        for (let x = 0; x < w; x++) {
          let mn = 1, mx = -1;
          const s = x * step;
          const e = Math.min(data.length, s + step);
          for (let i = s; i < e; i++) {
            const v = data[i];
            if (v < mn) mn = v;
            if (v > mx) mx = v;
          }
          ctx2d.moveTo(x + 0.5, h / 2 - mn * h / 2);
          ctx2d.lineTo(x + 0.5, h / 2 - mx * h / 2);
        }
        ctx2d.stroke();
      } else {
        ctx2d.fillStyle = "#8a8c93";
        ctx2d.font = "11px ui-monospace, monospace";
        ctx2d.textAlign = "center";
        ctx2d.textBaseline = "middle";
        ctx2d.fillText("no sample loaded", w / 2, h / 2);
      }
      // Dim outside selection
      const sFrac = t.sampleStarts[idx] ?? 0;
      const eFrac = t.sampleEnds[idx] ?? 1;
      const sx = Math.round(sFrac * w);
      const ex = Math.round(eFrac * w);
      ctx2d.fillStyle = "rgba(10,12,16,0.65)";
      ctx2d.fillRect(0, 0, sx, h);
      ctx2d.fillRect(ex, 0, w - ex, h);
      // Handles
      ctx2d.strokeStyle = "#c2f04a";
      ctx2d.lineWidth = 2;
      ctx2d.beginPath();
      ctx2d.moveTo(sx + 1, 0); ctx2d.lineTo(sx + 1, h);
      ctx2d.stroke();
      ctx2d.fillStyle = "#c2f04a";
      ctx2d.beginPath();
      ctx2d.moveTo(sx + 1, 0); ctx2d.lineTo(sx + 9, 0); ctx2d.lineTo(sx + 1, 8); ctx2d.closePath();
      ctx2d.fill();

      ctx2d.strokeStyle = "#ff6fa3";
      ctx2d.beginPath();
      ctx2d.moveTo(ex - 1, 0); ctx2d.lineTo(ex - 1, h);
      ctx2d.stroke();
      ctx2d.fillStyle = "#ff6fa3";
      ctx2d.beginPath();
      ctx2d.moveTo(ex - 1, 0); ctx2d.lineTo(ex - 9, 0); ctx2d.lineTo(ex - 1, 8); ctx2d.closePath();
      ctx2d.fill();

      if (buf) {
        const startMs = Math.round(sFrac * buf.duration * 1000);
        const endMs   = Math.round(eFrac * buf.duration * 1000);
        infoEl.textContent = `${(buf.duration).toFixed(2)}s · [${startMs} — ${endMs}] ms`;
      } else {
        infoEl.textContent = "no sample";
      }
    };

    drawWave();

    // pointer-drag editing: grab nearest handle
    let dragging = null; // "start" | "end" | null
    const fracFromEvent = (e) => {
      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      return Math.max(0, Math.min(1, x));
    };
    canvas.addEventListener("pointerdown", (e) => {
      canvas.setPointerCapture(e.pointerId);
      const f = fracFromEvent(e);
      const ds = Math.abs(f - (t.sampleStarts[idx] ?? 0));
      const de = Math.abs(f - (t.sampleEnds[idx] ?? 1));
      dragging = ds <= de ? "start" : "end";
      applyDrag(f);
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      applyDrag(fracFromEvent(e));
    });
    const endDrag = (e) => {
      if (!dragging) return;
      dragging = null;
      try { canvas.releasePointerCapture(e.pointerId); } catch {}
    };
    canvas.addEventListener("pointerup", endDrag);
    canvas.addEventListener("pointercancel", endDrag);
    function applyDrag(frac) {
      let snapped = snapTo(frac);
      if (dragging === "start") {
        const maxStart = (t.sampleEnds[idx] ?? 1) - 0.01;
        t.sampleStarts[idx] = Math.max(0, Math.min(maxStart, snapped));
      } else if (dragging === "end") {
        const minEnd = (t.sampleStarts[idx] ?? 0) + 0.01;
        t.sampleEnds[idx] = Math.max(minEnd, Math.min(1, snapped));
      }
      drawWave();
    }
    snapSel.addEventListener("change", drawWave);

    prev.addEventListener("click", async () => {
      if (!t.voice || !t.voice.buffer) { setStatus("no sample loaded yet", true); return; }
      await ensureAudio();
      const when = state.audioCtx.currentTime + 0.02;
      const note = Number(noteInput.value) || 60;
      const vel  = Number(velInput.value) || 0.8;
      try {
        t.voice.hit(note, when, t.voice.buffer.duration, vel, {
          startOffset: t.sampleStarts[idx],
          endOffset:   t.sampleEnds[idx],
          fadeIn:      t.sampleFadeIns?.[idx]  ?? 0,
          fadeOut:     t.sampleFadeOuts?.[idx] ?? 0,
          loopMode:    t.sampleLoopModes?.[idx] ?? "off",
          pitchBase:   t.isDrumKit ? 36 : 60,
        });
      } catch (err) { console.warn(err); }
    });

    if (applyAllBtn) {
      applyAllBtn.addEventListener("click", () => {
        const settings = {
          start: t.sampleStarts[idx] ?? 0,
          end: t.sampleEnds[idx] ?? 1,
          fadeIn: t.sampleFadeIns?.[idx] ?? 0,
          fadeOut: t.sampleFadeOuts?.[idx] ?? 0,
          loopMode: t.sampleLoopModes?.[idx] ?? "off",
        };
        applySampleSettingsToAllSteps(t, settings);
        t.sampleDefaults = { ...settings };
        // Re-alias the active pattern so t.sampleStarts etc. point at the fresh arrays,
        // then redraw the waveform + step grid to reflect the propagated values.
        aliasPattern(t, t._patternIdx ?? state.activePattern);
        renderStepGrid(t);
        setStatus(`applied sample settings to all steps on "${t.name}"`);
      });
    }
  }

  velInput.addEventListener("input", () => {
    t.velocities[idx] = Number(velInput.value);
    refresh();
    const cell = t.el.querySelector(`.step[data-idx="${idx}"]`);
    if (cell) cell.style.setProperty("--vel", String(t.velocities[idx]));
  });
  chordSel.addEventListener("change", () => {
    t.chords[idx] = chordSel.value;
    refresh();
    renderStepGrid(t);
  });
  arpBox.addEventListener("change", () => {
    if (!t.arps) t.arps = new Array(t.length).fill(false);
    t.arps[idx] = arpBox.checked;
    syncArpRowVisibility();
    refresh();
  });
  chordSel.addEventListener("change", () => {
    // clearing the chord also clears arp state so it doesn't "ghost" between chord selections
    if (!chordSel.value) {
      arpBox.checked = false;
      if (!t.arps) t.arps = new Array(t.length).fill(false);
      t.arps[idx] = false;
    }
    syncChordOptsVisibility();
    syncArpRowVisibility();
  });
  arpRate.addEventListener("change",  () => { if (!t.arpRates)  t.arpRates  = new Array(t.length).fill(0.25); t.arpRates[idx]  = Number(arpRate.value); });
  arpRange.addEventListener("change", () => { if (!t.arpRanges) t.arpRanges = new Array(t.length).fill(1);    t.arpRanges[idx] = Number(arpRange.value); });
  arpDir.addEventListener("change",   () => { if (!t.arpDirs)   t.arpDirs   = new Array(t.length).fill("up"); t.arpDirs[idx]   = arpDir.value; });
  cpxInput.addEventListener("input", () => {
    if (!t.complexities) t.complexities = new Array(t.length).fill(0);
    t.complexities[idx] = Math.max(0, Math.min(4, Number(cpxInput.value) || 0));
    refresh();
  });
  el.querySelector(".se-close").addEventListener("click", closeStepEditor);

  const escHandler = (e) => { if (e.key === "Escape") closeStepEditor(); };
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeStepEditor(); });
  document.addEventListener("keydown", escHandler);
  stepEditor = { overlay, el, escHandler };
}

