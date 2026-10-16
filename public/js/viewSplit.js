/**
 * The clip, arrangement and piano views as two panes, one over the other: the
 * view's own picture on top, the selected track's card (trackDetail.js)
 * underneath, and a handle between them dragged up or down to give one more
 * of the height and the other less. The section fills the window under the
 * pinned bar and transport, and each pane scrolls on its own, so a tall track
 * card no longer pushes the grid off the screen.
 *
 * Where the handle sits is a fraction of the section's height, per view and
 * per browser (`seqbaby.split.v1`): a layout, not part of the song. Double-
 * click it for the view's default; arrow keys move it when it has focus.
 *
 * The panes are built once, here, and handed back; a view draws into `top`
 * and puts its detail in `bottom`. The transport's height is measured onto
 * `--sq-transport-h` (as AccountBar.tsx measures the bar's), since the
 * section's height is what the two pinned rows leave.
 */

const KEY = "seqbaby.split.v1";
const MIN_PX = 80;          // neither pane goes shorter than this
const DEFAULTS = { clips: 0.5, arrange: 0.5, piano: 0.62 };

/** @type {Record<string, number>} */
let saved = {};
try { saved = JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch {}

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch {}
}

let measured = false;
function measureTransport() {
  if (measured || typeof ResizeObserver !== "function") return;
  const bar = document.querySelector(".sq-transport");
  if (!bar) return;
  measured = true;
  const root = document.documentElement;
  new ResizeObserver(() => root.style.setProperty("--sq-transport-h", `${bar.offsetHeight}px`)).observe(bar);
}

/**
 * @param {HTMLElement} section  the view's section (#clips, #arrange, #piano)
 * @param {string} view          its name in views.js, the key its split is saved under
 * @returns {{ top: HTMLElement, bottom: HTMLElement }}
 */
export function makeViewSplit(section, view) {
  measureTransport();
  section.classList.add("sq-split");
  const top = document.createElement("div");
  top.className = "sq-split__top";
  const handle = document.createElement("div");
  handle.className = "sq-split__handle";
  handle.tabIndex = 0;
  handle.setAttribute("role", "separator");
  handle.setAttribute("aria-orientation", "horizontal");
  handle.setAttribute("aria-label", "resize: drag to make the view or the track below it taller");
  handle.title = "drag to resize (double-click resets)";
  const bottom = document.createElement("div");
  bottom.className = "sq-split__bottom";
  section.append(top, handle, bottom);

  const fallback = DEFAULTS[view] ?? 0.5;
  let frac = Number.isFinite(saved[view]) ? saved[view] : fallback;

  /** The pixels the two panes share (the section minus its padding and the handle). */
  function room() {
    const cs = getComputedStyle(section);
    return section.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - handle.offsetHeight;
  }
  function apply() {
    frac = Math.max(0.05, Math.min(0.95, frac));
    section.style.setProperty("--split-top", `${(frac * 100).toFixed(2)}%`);
    handle.setAttribute("aria-valuenow", String(Math.round(frac * 100)));
  }
  /** Set the top pane to `px`, kept so both panes keep MIN_PX. */
  function setTopPx(px) {
    const r = room();
    if (r <= 0) return;
    const lo = Math.min(MIN_PX, r / 2);
    frac = Math.max(lo, Math.min(r - lo, px)) / r;
    apply();
  }
  function commit() { saved[view] = frac; save(); }

  handle.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    const y0 = e.clientY;
    const h0 = top.getBoundingClientRect().height;
    section.classList.add("is-resizing");
    const move = (ev) => setTopPx(h0 + ev.clientY - y0);
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      section.classList.remove("is-resizing");
      commit();
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  });
  handle.addEventListener("dblclick", () => { frac = fallback; apply(); commit(); });
  handle.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    const step = e.shiftKey ? 80 : 20;
    setTopPx(top.getBoundingClientRect().height + (e.key === "ArrowUp" ? -step : step));
    commit();
  });

  apply();
  return { top, bottom };
}
