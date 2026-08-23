/**
 * Rotary knobs, as a skin over the native range inputs.
 *
 * Every parameter in the app is an `<input type=range>` — around 180 of them in
 * the markup, and the track template is cloned per track, so a full session has
 * over a thousand. They are wired in a hundred places (`setParam`, `setFilter`,
 * the fx `applyX()` closures), read back by class in `paramTargets.js`, resolved
 * from the DOM by the right-click menu, and written to directly — with no event
 * — by `syncTrackSoundUI`, `refreshFxPanelUI` and the pattern-lock recall.
 *
 * So the input stays. `upgradeKnobs` wraps it, hides it, and draws a knob on
 * top; the input remains the value, the focus target and the pointer target.
 * Nothing else in the codebase has to know this module exists.
 *
 * Two things keep the drawing honest:
 *
 *   - an `input` listener, which catches the native arrow keys and our own
 *     dispatches;
 *   - a shadowed `value` accessor, which catches `el.value = x` written by code
 *     that has no reason to fire an event. That is the one that matters: a
 *     session load, a patch load and a p-lock recall all write straight to
 *     `.value`, and without the shadow every knob on screen would keep drawing
 *     the value the sound used to have.
 *
 * What makes it playable is the drag, not the shape. A native range jumps to
 * wherever you click, which is the one thing a control you play must never do,
 * and its travel is the width of the widget, which in the DX7 grid is 60px for
 * the whole parameter. Here the whole body is the target, the value doesn't move
 * until the pointer does, travel is unbounded, and resolution gets finer the
 * further out you drag. None of that is round — the shape is CSS's business
 * (see `--knob-v` / `--knob-a` below), which is why a rack that reads badly as
 * dials can become bars without touching this file.
 */

/** Controls that stay as they are. The wavetable's harmonic bars are a drawing
 *  of a spectrum — sixteen of them side by side ARE the waveform, and a row of
 *  little dials would say nothing. */
const KNOB_EXCLUDE = ".sq-wt__harm-bar";

/** Pixels of vertical drag for the full range at normal resolution. */
const PX_FULL_TRAVEL = 140;
/** Horizontal distance at which resolution has halved (see `fineFactor`). */
const PX_FINE_FALLOFF = 90;
/** Floor on the fine factor — 1/8 speed is fine enough to place any value. */
const FINE_MIN = 0.125;
/** Shift (desktop) forces fine mode outright. */
const FINE_SHIFT = 0.15;
/** Hold this long without moving on a touch and you get the parameter menu. */
const LONG_PRESS_MS = 500;
/** Movement over this many px cancels a long press and counts as a drag. */
const LONG_PRESS_SLOP = 8;
/** Two taps inside this window reset the control to its markup default. */
const DBL_TAP_MS = 320;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// ---- painting ------------------------------------------------------------
// JS writes two custom properties and knows nothing about circles: `--knob-v`
// is the value as 0..1, `--knob-a` the same thing as an angle over a 270°
// sweep. The dial, the arc, the pointer and the bipolar variant are all CSS.
//
// Paints are batched through one rAF pass over a dirty set, so a macro pad
// sweeping twenty assigned parameters costs one frame's work rather than
// twenty synchronous style recalcs.

/** @type {Set<HTMLInputElement>} */
const dirty = new Set();
let rafId = null;

function flush() {
  rafId = null;
  for (const input of dirty) paintNow(input);
  dirty.clear();
}

function schedulePaint(input) {
  if (!input._knob) return;
  dirty.add(input);
  if (rafId == null) rafId = requestAnimationFrame(flush);
}

function paintNow(input) {
  const k = input._knob;
  if (!k) return;
  const { wrap, min, max } = k;
  const span = max - min;
  const v = span > 0 ? clamp((Number(input.value) - min) / span, 0, 1) : 0;
  wrap.style.setProperty("--knob-v", String(v));
  // 270° of sweep starting at 7 o'clock, so the dead zone sits at the bottom
  // where a rack of knobs has nothing to say anyway.
  wrap.style.setProperty("--knob-a", `${-135 + v * 270}deg`);
}

// ---- readout -------------------------------------------------------------
// One shared bubble, parked above the knob being dragged. Above, not below,
// because on a phone everything below is under the finger.

let readoutEl = null;

function decimalsOf(step) {
  const s = String(step ?? "1");
  const dot = s.indexOf(".");
  return dot < 0 ? 0 : s.length - dot - 1;
}

/** Park the bubble over the knob. Reads layout, so it runs once per drag —
 *  not per move, which would force a sync reflow on every pointer sample. */
function openReadout(input) {
  const k = input._knob;
  if (!k) return;
  if (!readoutEl) {
    readoutEl = document.createElement("div");
    readoutEl.className = "sq-knob__readout";
    document.body.appendChild(readoutEl);
  }
  const r = k.wrap.getBoundingClientRect();
  readoutEl.style.left = `${r.left + r.width / 2}px`;
  readoutEl.style.top = `${r.top}px`;
  readoutEl.hidden = false;
  updateReadout(input);
}

function updateReadout(input) {
  if (readoutEl && !readoutEl.hidden) {
    readoutEl.textContent = Number(input.value).toFixed(input._knob.decimals);
  }
}

function hideReadout() {
  if (readoutEl) readoutEl.hidden = true;
}

// ---- value writes --------------------------------------------------------

/** Write a value through the input so every existing listener sees it, and
 *  quantise to the control's own step so a knob can't produce a value the
 *  slider couldn't. */
function writeValue(input, raw) {
  const k = input._knob;
  const { min, max, step } = k;
  let v = clamp(raw, min, max);
  if (step > 0) v = min + Math.round((v - min) / step) * step;
  v = clamp(v, min, max);
  const next = k.decimals ? v.toFixed(k.decimals) : String(Math.round(v));
  if (next === input.value) return;
  input.value = next;                                  // repaints via the shadow
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Resolution multiplier: 1 at the knob, falling off with horizontal distance.
 *  Dragging away from the control to trim it needs no modifier key, which is
 *  the only way fine mode can exist on a touch screen. */
function fineFactor(dx, shift) {
  if (shift) return FINE_SHIFT;
  return Math.max(FINE_MIN, 1 / (1 + Math.abs(dx) / PX_FINE_FALLOFF));
}

// ---- the drag ------------------------------------------------------------
// Same idiom as attachDiceDensity in render.js: capture straight away (a 36px
// target is left within a few pixels), drop the drag if a mouse move arrives
// with no buttons down, and end on pointercancel and lostpointercapture as well
// as pointerup.

function attachDrag(input) {
  const k = input._knob;
  let drag = null;

  const onDown = (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;   // right-click → menu
    // Kill the native range's click-to-jump. That also suppresses focus, so
    // take it explicitly — the arrow keys are the accessible path in.
    e.preventDefault();
    try { input.focus({ preventScroll: true }); } catch { input.focus(); }
    const now = e.timeStamp;
    drag = {
      id: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      lastY: e.clientY,
      val: Number(input.value),
      moved: false,
      // A drag also produces a click, so double-tap-to-reset has to check that
      // neither tap moved rather than trusting the dblclick event.
      isDouble: now - (k.lastTapAt || 0) < DBL_TAP_MS && !k.lastTapMoved,
      startedAt: now,
    };
    try { input.setPointerCapture(e.pointerId); } catch {}
    if (e.pointerType !== "mouse") {
      k.longPressId = setTimeout(() => {
        if (!drag || drag.moved) return;
        k.longPressId = null;
        drag = null;
        try { input.releasePointerCapture(e.pointerId); } catch {}
        hideReadout();
        // Re-raise as a contextmenu so the one document-level handler in
        // paramMenu.js does the work — it already resolves the control, the
        // owning track and the scope. Touch has no right-click, so this is the
        // only route to the LFO / automation / macro UI on a phone.
        input.dispatchEvent(new MouseEvent("contextmenu", {
          bubbles: true, cancelable: true,
          clientX: e.clientX, clientY: e.clientY,
        }));
      }, LONG_PRESS_MS);
    }
  };

  const applyMove = (x, y, shift) => {
    const span = k.max - k.min;
    const dy = drag.lastY - y;                    // up is more
    drag.lastY = y;
    drag.val = clamp(
      drag.val + (dy * fineFactor(x - drag.startX, shift) * span) / PX_FULL_TRAVEL,
      k.min, k.max,
    );
    writeValue(input, drag.val);
  };

  const onMove = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    // Pointer capture retargets everything here until release, and Chrome emits
    // a synthetic move after a scroll — if no button is down the drag is over.
    if (e.pointerType === "mouse" && e.buttons === 0) { drag = null; hideReadout(); return; }
    // Measured from where the press began, not from the last sample — a slow
    // drag never travels far between two moves and would otherwise never count
    // as a drag at all.
    if (!drag.moved) {
      const far = Math.abs(e.clientY - drag.startY) + Math.abs(e.clientX - drag.startX);
      if (far > LONG_PRESS_SLOP) {
        drag.moved = true;
        if (k.longPressId) { clearTimeout(k.longPressId); k.longPressId = null; }
        openReadout(input);
      }
    }
    // Coalesced events give the whole gesture rather than one sample per frame,
    // which is the difference between a smooth sweep and a staircase.
    const pts = e.getCoalescedEvents?.() || [e];
    for (const p of pts) applyMove(p.clientX, p.clientY, e.shiftKey);
    updateReadout(input);
    e.preventDefault();
  };

  const end = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (k.longPressId) { clearTimeout(k.longPressId); k.longPressId = null; }
    try { input.releasePointerCapture(e.pointerId); } catch {}
    if (!drag.moved && drag.isDouble) {
      writeValue(input, Number(input.defaultValue));
      k.lastTapAt = 0;
    } else {
      k.lastTapAt = e.timeStamp;
      k.lastTapMoved = drag.moved;
    }
    drag = null;
    hideReadout();
  };

  input.addEventListener("pointerdown", onDown);
  input.addEventListener("pointermove", onMove);
  input.addEventListener("pointerup", end);
  input.addEventListener("pointercancel", end);
  input.addEventListener("lostpointercapture", end);

  // The wheel is free real estate — nothing else in the engine uses it.
  input.addEventListener("wheel", (e) => {
    const dir = e.deltaY < 0 ? 1 : -1;
    const unit = k.step > 0 ? k.step : (k.max - k.min) / 100;
    e.preventDefault();
    writeValue(input, Number(input.value) + dir * unit * (e.shiftKey ? 1 : 4));
  }, { passive: false });
}

// ---- upgrade -------------------------------------------------------------

/**
 * Turn every range input under `root` into a knob. Idempotent — track DOM is
 * rebuilt constantly and panels move in and out of modals, so this gets called
 * from renderTrack, from every modal that builds controls, and once over the
 * document at boot.
 * @param {ParentNode} root
 */
export function upgradeKnobs(root) {
  if (!root?.querySelectorAll) return;
  for (const input of root.querySelectorAll("input[type=range]:not([data-knob])")) {
    if (input.matches(KNOB_EXCLUDE)) continue;
    upgradeOne(/** @type {HTMLInputElement} */ (input));
  }
}

function upgradeOne(input) {
  const min = Number(input.min === "" ? 0 : input.min);
  const max = Number(input.max === "" ? 100 : input.max);
  const step = Number(input.step === "" || input.step === "any" ? 0 : input.step);
  if (!(max > min)) return;

  const wrap = document.createElement("span");
  wrap.className = "sq-knob";
  // A control that runs through zero reads from twelve o'clock — the 303's
  // tuning and the DX7's pitch envelope are the whole point of the variant.
  if (min < 0 && max > 0) wrap.dataset.bipolar = "1";
  const dial = document.createElement("span");
  dial.className = "sq-knob__dial";
  dial.setAttribute("aria-hidden", "true");

  input.replaceWith(wrap);
  wrap.appendChild(dial);
  wrap.appendChild(input);
  input.dataset.knob = "1";

  input._knob = { wrap, min, max, step, decimals: decimalsOf(input.step || "1"),
                  longPressId: null, lastTapAt: 0, lastTapMoved: false };

  // The field wrapper is what the mod/aut dot and the parameter menu look at,
  // and it now has to stack the label under a square control rather than beside
  // a wide one. Flagging it here keeps that CSS off any slider left unupgraded.
  input.closest(".sq-field, .sq-fx__ctl, .sq-virus__f, .sq-dx7__f, .sq-guitar__f, .sq-bass__f, .sq-moog__freq, .sq-moog__noise, label")
    ?.setAttribute("data-knob", "");

  shadowValue(input);
  input.addEventListener("input", () => schedulePaint(input));
  attachDrag(input);
  paintNow(input);
}

/**
 * Re-read a control's min/max/step after code has changed them.
 *
 * The range is cached at upgrade time because the drag reads it on every
 * pointer sample, and for the ~1000 knobs in a session it never moves. A
 * control whose bounds are rewritten at runtime — the euclid dialog's pulses
 * knob, which can only reach as far as the current cycle length — has to say
 * so, or the knob would go on scaling its drag and its arc to the old span.
 * @param {HTMLInputElement} input
 */
export function refreshKnobRange(input) {
  const k = input?._knob;
  if (!k) return;
  k.min = Number(input.min === "" ? 0 : input.min);
  k.max = Number(input.max === "" ? 100 : input.max);
  k.step = Number(input.step === "" || input.step === "any" ? 0 : input.step);
  k.decimals = decimalsOf(input.step || "1");
  k.wrap.toggleAttribute("data-bipolar", k.min < 0 && k.max > 0);
  paintNow(input);
}

/**
 * Make `el.value = x` repaint. Half the codebase writes values back into these
 * inputs without dispatching anything — syncTrackSoundUI, refreshFxPanelUI, the
 * DX7 / guitar / bass panel syncs, applyPatternSound, applySet — because until
 * now nothing was listening. Shadowing the accessor per element means none of
 * those call sites has to change and none of them can be forgotten.
 */
function shadowValue(input) {
  const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  if (!desc?.get || !desc?.set) return;
  Object.defineProperty(input, "value", {
    configurable: true,
    enumerable: false,
    get() { return desc.get.call(this); },
    set(v) { desc.set.call(this, v); schedulePaint(this); },
  });
}
