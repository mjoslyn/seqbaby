import { canSavePatches, deletePatch, engineByKey, listPatches } from "./catalog.js";
import { setStatus } from "./dom.js";

export function showInputDialog({ title, defaultValue = "", placeholder = "", multiline = false }) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "sq-modal-overlay";
    const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;").replace(/\n/g, "&#10;");
    const field = multiline
      ? `<textarea class="sq-modal__input sq-modal__input--multiline" rows="5" placeholder="${esc(placeholder)}">${esc(defaultValue)}</textarea>`
      : `<input class="sq-modal__input" type="text" value="${esc(defaultValue)}" placeholder="${esc(placeholder)}" />`;
    overlay.innerHTML = `
      <div class="sq-modal" role="dialog" aria-modal="true">
        <div class="sq-modal__title">${esc(title)}</div>
        ${field}
        <div class="sq-modal__actions">
          <button class="modal-cancel sq-btn--ghost">cancel</button>
          <button class="sq-modal__ok">ok</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const input = overlay.querySelector(".sq-modal__input");
    setTimeout(() => { input.focus(); if (input.select) input.select(); }, 0);
    const close = (val) => { overlay.remove(); resolve(val); };
    overlay.querySelector(".sq-modal__ok").addEventListener("click", () => close(input.value));
    overlay.querySelector(".modal-cancel").addEventListener("click", () => close(null));
    input.addEventListener("keydown", (e) => {
      // single-line: Enter submits. multiline: Cmd/Ctrl+Enter submits, plain Enter adds newline.
      if (!multiline && e.key === "Enter") { e.preventDefault(); close(input.value); }
      if (multiline && e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); close(input.value); }
      if (e.key === "Escape") close(null);
    });
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(null); });
  });
}

/**
 * Modal: name a patch and say what goes in it. Two boxes: the sound (with its
 * fx, mods and the pattern's automation lanes), ticked to start, and the
 * pattern's notes. Both ticked saves the two together, of the current pattern.
 * Resolves `{name, sound, pattern}`, or null on cancel.
 * @param {{defaultValue?: string}} [opts]
 */
export function showPatchSaveDialog({ defaultValue = "" } = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "sq-modal-overlay";
    const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
    overlay.innerHTML = `
      <div class="sq-modal sq-patchsave" role="dialog" aria-modal="true" aria-label="save patch">
        <div class="sq-modal__title">save patch as</div>
        <input class="sq-modal__input" type="text" value="${esc(defaultValue)}" placeholder="my-patch-name" />
        <div class="sq-patchsave__what">
          <label title="the instrument and everything shaping it: its knobs, filter, eq, compressor, fx chain, mods, and this pattern's automation lanes"><input type="checkbox" class="sq-patchsave__sound" checked /> sound <span>with fx, mods and automation</span></label>
          <label title="the notes of the pattern this track is on"><input type="checkbox" class="sq-patchsave__pattern" /> pattern <span>the notes</span></label>
        </div>
        <div class="sq-modal__body sq-patchsave__says"></div>
        <div class="sq-modal__actions">
          <button class="modal-cancel sq-btn--ghost">cancel</button>
          <button class="sq-modal__ok">save</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const input = overlay.querySelector(".sq-modal__input");
    const sound = overlay.querySelector(".sq-patchsave__sound");
    const pattern = overlay.querySelector(".sq-patchsave__pattern");
    const says = overlay.querySelector(".sq-patchsave__says");
    const ok = overlay.querySelector(".sq-modal__ok");
    const paint = () => {
      ok.disabled = !sound.checked && !pattern.checked;
      says.textContent = sound.checked && pattern.checked
        ? "saves the sound and this pattern's notes together. Loading it onto a track changes its sound and writes the notes over the pattern it is on."
        : sound.checked ? "saves the sound. Loading it onto a track changes how the track sounds and leaves its notes alone."
        : pattern.checked ? "saves this pattern's notes. Loading it onto a track writes them over the pattern it is on and keeps that track's sound."
        : "tick at least one.";
    };
    sound.addEventListener("change", paint);
    pattern.addEventListener("change", paint);
    paint();
    setTimeout(() => { input.focus(); input.select(); }, 0);
    const close = (val) => { overlay.remove(); resolve(val); };
    const submit = () => { if (!ok.disabled) close({ name: input.value, sound: sound.checked, pattern: pattern.checked }); };
    ok.addEventListener("click", submit);
    overlay.querySelector(".modal-cancel").addEventListener("click", () => close(null));
    overlay.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.target === input) { e.preventDefault(); submit(); }
      if (e.key === "Escape") close(null);
    });
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(null); });
  });
}

/**
 * Modal: ask before something destructive. Resolves true / false.
 *
 * The one thing here the other dialogs don't do is default to CANCEL — Escape,
 * the backdrop and Enter all decline. These only ever guard something this app
 * cannot undo, so the safe answer is the one a stray keypress lands on.
 *
 * @param {{title: string, body?: string, confirmLabel?: string}} opts
 */
export function showConfirmDialog({ title, body = "", confirmLabel = "ok" }) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "sq-modal-overlay";
    const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
    overlay.innerHTML = `
      <div class="sq-modal" role="dialog" aria-modal="true">
        <div class="sq-modal__title">${esc(title)}</div>
        ${body ? `<div class="sq-modal__body">${esc(body)}</div>` : ""}
        <div class="sq-modal__actions">
          <button class="modal-cancel sq-btn--ghost">cancel</button>
          <button class="sq-modal__ok">${esc(confirmLabel)}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const ok = overlay.querySelector(".sq-modal__ok");
    setTimeout(() => ok.focus(), 0);
    const close = (v) => {
      overlay.remove();
      document.removeEventListener("keydown", onKey);
      resolve(v);
    };
    const onKey = (e) => {
      if (e.key === "Escape") close(false);
      // Enter confirms only when the confirm button itself has focus, which the
      // browser handles: nothing here turns a keypress somewhere else into a yes.
    };
    document.addEventListener("keydown", onKey);
    ok.addEventListener("click", () => close(true));
    overlay.querySelector(".modal-cancel").addEventListener("click", () => close(false));
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(false); });
  });
}

// Modal: pick one of the user's saved patches. Returns patch name or null.
export function showSavedPatchPicker() {
  return new Promise((resolve) => {
    const all = listPatches().sort((a, b) => a.name.localeCompare(b.name));
    const overlay = document.createElement("div");
    overlay.className = "sq-modal-overlay";
    const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
    // Friendly engine label for a saved patch: track-patches carry engineKey,
    // legacy custom-Tone patches are the "custom" engine.
    const engineLabelOf = (p) => {
      const key = p.engineKey || (p.kind !== "track-patch" ? "custom" : null);
      if (!key) return null;
      return engineByKey(key)?.label || key;
    };
    const rows = all.length
      ? all.map(p => {
          const eng = engineLabelOf(p);
          const suffix = eng ? ` <span class="sq-patch__eng">- ${esc(eng)}</span>` : "";
          return `<li class="sq-patch__row"><button class="sq-patch__load" data-name="${esc(p.name)}">${esc(p.name)}${suffix}</button><button class="sq-patch__del sq-btn--ghost" data-name="${esc(p.name)}" title="delete">×</button></li>`;
        }).join("")
      : canSavePatches()
        ? `<li class="sq-patch__empty">no saved patches yet. Design a sound and click save.</li>`
        : `<li class="sq-patch__empty">sign in to save and load patches. They live in your account.</li>`;
    overlay.innerHTML = `
      <div class="sq-modal" role="dialog" aria-modal="true">
        <div class="sq-modal__title">load saved patch</div>
        <ul class="sq-patch__list">${rows}</ul>
        <div class="sq-modal__actions">
          <button class="modal-cancel sq-btn--ghost">cancel</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const close = (v) => { overlay.remove(); resolve(v); };
    overlay.querySelectorAll(".sq-patch__load").forEach(btn => {
      btn.addEventListener("click", () => close(btn.dataset.name));
    });
    overlay.querySelectorAll(".sq-patch__del").forEach(btn => {
      btn.addEventListener("click", async () => {
        const row = btn.closest(".sq-patch__row");
        btn.disabled = true;
        try {
          await deletePatch(btn.dataset.name);
          row?.remove();
        } catch (e) {
          btn.disabled = false;
          setStatus(`could not delete patch: ${e?.message || e}`, true);
        }
      });
    });
    overlay.querySelector(".modal-cancel").addEventListener("click", () => close(null));
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(null); });
    document.addEventListener("keydown", function esc2(e) {
      if (e.key === "Escape") { close(null); document.removeEventListener("keydown", esc2); }
    });
  });
}

// ---- engine catalog ----------------------------------------------------

/**
 * A question with a few answers: `choices` are `{ label, value, danger? }`,
 * resolved to the chosen value, or null for cancel / escape / the backdrop.
 */
export function showChoiceDialog({ title, body = "", choices = [] }) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "sq-modal-overlay";
    const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
    overlay.innerHTML = `
      <div class="sq-modal" role="dialog" aria-modal="true">
        <div class="sq-modal__title">${esc(title)}</div>
        ${body ? `<div class="sq-modal__body">${esc(body)}</div>` : ""}
        <div class="sq-modal__actions">
          <button class="modal-cancel sq-btn--ghost">cancel</button>
          ${choices.map((c, i) => `<button class="${i === choices.length - 1 ? "sq-modal__ok" : "sq-btn--ghost"}${c.danger ? " sq-btn--danger" : ""}" data-choice="${esc(c.value)}">${esc(c.label)}</button>`).join("")}
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const close = (v) => { overlay.remove(); document.removeEventListener("keydown", onKey); resolve(v); };
    const onKey = (e) => { if (e.key === "Escape") close(null); };
    document.addEventListener("keydown", onKey);
    overlay.querySelector(".modal-cancel").addEventListener("click", () => close(null));
    overlay.querySelectorAll("[data-choice]").forEach((b) => b.addEventListener("click", () => close(b.dataset.choice)));
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(null); });
    setTimeout(() => overlay.querySelector(".sq-modal__ok")?.focus(), 0);
  });
}

export function showSelectDialog({ title, options }) {
  return new Promise(resolve => {
    const overlay = document.createElement("div");
    overlay.className = "sq-modal-overlay";
    const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
    // Options may be plain strings or `{label, value}` objects.
    const opts = options.map(o => {
      const value = typeof o === "string" ? o : o.value;
      const label = typeof o === "string" ? o : (o.label ?? o.value);
      return `<option value="${esc(value)}">${esc(label)}</option>`;
    }).join("");
    overlay.innerHTML = `
      <div class="sq-modal" role="dialog" aria-modal="true">
        <div class="sq-modal__title">${esc(title)}</div>
        <select class="sq-modal__input" size="8" style="min-height:140px">${opts}</select>
        <div class="sq-modal__actions">
          <button class="modal-cancel sq-btn--ghost">cancel</button>
          <button class="modal-delete sq-btn--ghost sq-btn--danger">delete</button>
          <button class="sq-modal__ok">load</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const sel = overlay.querySelector(".sq-modal__input");
    setTimeout(() => sel.focus(), 0);
    const close = (val) => { overlay.remove(); resolve(val); };
    overlay.querySelector(".sq-modal__ok").addEventListener("click", () => close({ action: "load", value: sel.value }));
    overlay.querySelector(".modal-cancel").addEventListener("click", () => close(null));
    overlay.querySelector(".modal-delete").addEventListener("click", () => close({ action: "delete", value: sel.value }));
    sel.addEventListener("keydown", e => {
      if (e.key === "Enter") { e.preventDefault(); close({ action: "load", value: sel.value }); }
      if (e.key === "Escape") close(null);
    });
    sel.addEventListener("dblclick", () => close({ action: "load", value: sel.value }));
    overlay.addEventListener("click", e => { if (e.target === overlay) close(null); });
  });
}

