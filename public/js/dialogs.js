import { engineByKey, loadPatches, rebuildEngineCatalog, refreshEngineSelect, storePatches } from "./catalog.js";
import { state } from "./state.js";

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

// Modal: pick one of the user's saved patches. Returns patch name or null.
export function showSavedPatchPicker() {
  return new Promise((resolve) => {
    const all = loadPatches();
    const names = Object.keys(all).sort();
    const overlay = document.createElement("div");
    overlay.className = "sq-modal-overlay";
    const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
    // Friendly engine label for a saved patch: track-patches carry engineKey,
    // legacy custom-Tone patches are the "custom" engine.
    const engineLabelOf = (cfg) => {
      const key = cfg?.engineKey || (cfg?.synth ? "custom" : null);
      if (!key) return null;
      return engineByKey(key)?.label || key;
    };
    const rows = names.length
      ? names.map(n => {
          const eng = engineLabelOf(all[n]);
          const suffix = eng ? ` <span class="sq-patch__eng">- ${esc(eng)}</span>` : "";
          return `<li class="sq-patch__row"><button class="sq-patch__load" data-name="${esc(n)}">${esc(n)}${suffix}</button><button class="sq-patch__del sq-btn--ghost" data-name="${esc(n)}" title="delete">×</button></li>`;
        }).join("")
      : `<li class="sq-patch__empty">no saved patches yet — design a sound and click save.</li>`;
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
      btn.addEventListener("click", () => {
        const name = btn.dataset.name;
        const map = loadPatches();
        delete map[name];
        storePatches(map);
        rebuildEngineCatalog();
        for (const t of state.tracks) refreshEngineSelect(t);
        btn.closest(".sq-patch__row")?.remove();
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

