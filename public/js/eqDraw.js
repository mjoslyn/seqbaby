// The eq as a curve you play with, after the big software parametric eqs: a
// spectrum running behind it, one coloured node per band, drag a node across
// for its frequency and up or down for its gain, the wheel over a bell for its
// width. Drag across empty space and the stroke DRAWS the gains: every band it
// passes takes the height the stroke had there.
//
// The inputs stay the value. Each band's gain (`.p-eq-low`), frequency
// (`.p-eq-lowFreq`) and, on a bell, Q (`.p-eq-lomidQ`) is a hidden range input
// in the panel; setEQ hears their `input` events and syncTrackSoundUI /
// applyPatternSound / applySet write their `.value`. This draws what they say
// and turns gestures into writes on them, so save, undo, p-lock, a jam and the
// right-click menu work as they did for the five sliders.
//
// An LFO or a lane on a band (`eq_lowFreq` / `eq.lowFreq`) drives the biquad
// and leaves the inputs alone, so what is drawn there is the base. modMotion
// hands each driven input's `_motion` sink where the modulation has got to:
// the curve follows that (it is what is heard), a small dot in the band's
// colour trails the handle, and the handle stays the base you drag.
//
// No imports and nothing at the top level touches the DOM, so the response
// math runs under `node --test` (test/eqDraw.test.js). The bands are handed in.

export const EQ_DB_MAX = 18;      // the inputs' own range
const VIEW_DB = 20;               // the graph's, a little headroom over it
const F_LO = 20, F_HI = 20000;
const Q_LO = 0.1, Q_HI = 18;
const SR = 48000;
const W = 360, H = 160;           // viewBox
const PAD_L = 4, PAD_R = 22, PAD_TOP = 6, PAD_BOT = 14;
const SPEC_TOP = -6, SPEC_BOT = -96;   // the spectrum's dBFS span, bottom to top
const HIT = 13;                   // how near a node a press grabs it, viewBox units

/** The band colours, low to high. */
export const EQ_BAND_COLORS = ["#ff6b6b", "#ffa94d", "#ffd43b", "#69db7c", "#4dabf7"];

// ---- the response, RBJ cookbook biquads --------------------------------------

/** A band's frequency, Q and gain in `eq`, its defaults where absent. */
export function bandState(band, eq) {
  const num = (v, d) => (typeof v === "number" && Number.isFinite(v) ? v : d);
  return {
    type: band.type,
    freq: num(eq?.[band.key + "Freq"], band.freq),
    q: band.q != null ? num(eq?.[band.key + "Q"], band.q) : null,
    gain: num(eq?.[band.key], 0),
  };
}

/** Biquad coefficients the way a BiquadFilterNode makes them (shelves at
 *  slope 1, Q ignored for them). */
export function bandCoefs({ type, freq, q, gain }, sr = SR) {
  const A = Math.pow(10, gain / 40);
  const w0 = 2 * Math.PI * Math.min(freq, sr * 0.49) / sr;
  const cos = Math.cos(w0), sin = Math.sin(w0);
  if (type === "peaking") {
    const alpha = sin / (2 * (q ?? 1));
    return norm(1 + alpha * A, -2 * cos, 1 - alpha * A, 1 + alpha / A, -2 * cos, 1 - alpha / A);
  }
  const alpha = sin / 2 * Math.SQRT2;            // shelf slope S = 1
  const sq = 2 * Math.sqrt(A) * alpha;
  if (type === "lowshelf") {
    return norm(
      A * ((A + 1) - (A - 1) * cos + sq), 2 * A * ((A - 1) - (A + 1) * cos), A * ((A + 1) - (A - 1) * cos - sq),
      (A + 1) + (A - 1) * cos + sq, -2 * ((A - 1) + (A + 1) * cos), (A + 1) + (A - 1) * cos - sq);
  }
  return norm(                                   // highshelf
    A * ((A + 1) + (A - 1) * cos + sq), -2 * A * ((A - 1) + (A + 1) * cos), A * ((A + 1) + (A - 1) * cos - sq),
    (A + 1) - (A - 1) * cos + sq, 2 * ((A - 1) - (A + 1) * cos), (A + 1) - (A - 1) * cos - sq);
}
function norm(b0, b1, b2, a0, a1, a2) {
  return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
}

/** One biquad's magnitude in dB at `f`. */
export function coefDb([b0, b1, b2, a1, a2], f, sr = SR) {
  const w = 2 * Math.PI * f / sr;
  const c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
  const nr = b0 + b1 * c1 + b2 * c2, ni = -(b1 * s1 + b2 * s2);
  const dr = 1 + a1 * c1 + a2 * c2, di = -(a1 * s1 + a2 * s2);
  return 10 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di));
}

/** The whole chain's response in dB at each frequency in `freqs`. */
export function eqResponseDb(bands, eq, freqs, sr = SR) {
  const coefs = bands.map(b => bandCoefs(bandState(b, eq), sr));
  return freqs.map(f => coefs.reduce((s, c) => s + coefDb(c, f, sr), 0));
}

/** The band whose frequency is nearest `f`, by log distance. */
export function nearestBand(freqs, f) {
  let best = 0, bestD = Infinity;
  freqs.forEach((bf, i) => {
    const d = Math.abs(Math.log(bf / f));
    if (d < bestD) { bestD = d; best = i; }
  });
  return best;
}

// ---- geometry ------------------------------------------------------------------

const LOG_LO = Math.log(F_LO), LOG_SPAN = Math.log(F_HI) - LOG_LO;
const PW = W - PAD_L - PAD_R, PH = H - PAD_TOP - PAD_BOT;
const xOfF = f => PAD_L + (Math.log(f) - LOG_LO) / LOG_SPAN * PW;
const fOfX = x => Math.exp(LOG_LO + (x - PAD_L) / PW * LOG_SPAN);
const yOfDb = db => PAD_TOP + (1 - (db + VIEW_DB) / (2 * VIEW_DB)) * PH;
const dbOfY = y => (1 - (y - PAD_TOP) / PH) * 2 * VIEW_DB - VIEW_DB;
const clampDb = db => Math.max(-VIEW_DB, Math.min(VIEW_DB, db));
const snapDb = db => Math.max(-EQ_DB_MAX, Math.min(EQ_DB_MAX, Math.round(db * 2) / 2));
const snapF = f => Math.round(Math.max(F_LO, Math.min(F_HI, f)));
const snapQ = q => Math.round(Math.max(Q_LO, Math.min(Q_HI, q)) * 100) / 100;
export const fmtHz = f => f >= 1000 ? `${+(f / 1000).toFixed(f >= 10000 ? 1 : 2)} kHz` : `${Math.round(f)} Hz`;
const fmtDb = db => `${db > 0 ? "+" : ""}${db.toFixed(1)} dB`;
const axisHz = f => f >= 1000 ? `${f / 1000}k` : `${f}`;

// ---- the drawing ----------------------------------------------------------------

const NS = "http://www.w3.org/2000/svg";
const el = (tag, attrs = {}) => {
  const n = document.createElementNS(NS, tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  return n;
};

const CURVE_N = 160;
const CURVE_FREQS = Array.from({ length: CURVE_N + 1 }, (_, i) => fOfX(PAD_L + i / CURVE_N * PW));
const pathOf = (dbs) => "M" + dbs.map((d, i) => `${xOfF(CURVE_FREQS[i]).toFixed(1)},${yOfDb(clampDb(d)).toFixed(1)}`).join("L");
const areaOf = (dbs) => `${pathOf(dbs)}L${xOfF(F_HI).toFixed(1)},${yOfDb(0)}L${xOfF(F_LO).toFixed(1)},${yOfDb(0)}Z`;

/**
 * Put the drawable eq into an eq panel, over its hidden inputs. Idempotent.
 * @param {HTMLElement} panel the `.sq-track__eq-panel`
 * @param {{key:string,freq:number,type:string,q?:number,label:string,desc?:string}[]} bands
 * @param {() => AnalyserNode|null} [getAnalyser] the eq's output, for the spectrum
 */
export function mountEqDraw(panel, bands, getAnalyser) {
  if (!panel || panel.querySelector(".sq-eqdraw")) return;
  const find = (k) => /** @type {HTMLInputElement|null} */ (panel.querySelector(`.p-eq-${k}`));
  const ins = bands.map(b => ({ gain: find(b.key), freq: find(b.key + "Freq"), q: b.q != null ? find(b.key + "Q") : null }));
  if (ins.some(i => !i.gain || !i.freq)) return;
  const row = ins[0].gain.closest(".sq-fx__row") || panel;

  const read = () => {
    const eq = {};
    bands.forEach((b, i) => {
      eq[b.key] = Number(ins[i].gain.value) || 0;
      eq[b.key + "Freq"] = Number(ins[i].freq.value) || b.freq;
      if (ins[i].q) eq[b.key + "Q"] = Number(ins[i].q.value) || b.q;
    });
    return eq;
  };

  const wrap = document.createElement("div");
  wrap.className = "sq-eqdraw";
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, class: "sq-eqdraw__svg", role: "group",
    "aria-label": "eq: drag a band's dot across for its frequency and up or down for its gain, the wheel for a bell's width; drag across empty space to draw" });

  // grid: dB lines with labels on the right, frequency lines with labels below
  for (const db of [-18, -12, -6, 0, 6, 12, 18]) {
    svg.append(el("line", { x1: PAD_L, x2: PAD_L + PW, y1: yOfDb(db), y2: yOfDb(db),
      class: db === 0 ? "sq-eqdraw__zero" : "sq-eqdraw__grid" }));
    if (db % 12 === 0 || db === 0) {
      const tx = el("text", { x: W - 2, y: yOfDb(db) + 3, class: "sq-eqdraw__axis sq-eqdraw__axis--db" });
      tx.textContent = db > 0 ? `+${db}` : `${db}`;
      svg.append(tx);
    }
  }
  for (const f of [30, 50, 100, 200, 500, 1000, 2000, 5000, 10000]) {
    const major = f === 100 || f === 1000 || f === 10000;
    svg.append(el("line", { x1: xOfF(f), x2: xOfF(f), y1: PAD_TOP, y2: PAD_TOP + PH,
      class: major ? "sq-eqdraw__grid sq-eqdraw__grid--major" : "sq-eqdraw__grid" }));
    const tx = el("text", { x: xOfF(f), y: H - 3, class: "sq-eqdraw__axis" });
    tx.textContent = axisHz(f);
    svg.append(tx);
  }

  const spectrum = el("path", { class: "sq-eqdraw__spectrum" });
  svg.append(spectrum);
  const bandShapes = bands.map((b, i) => {
    const p = el("path", { class: "sq-eqdraw__shape" });
    p.style.setProperty("--c", EQ_BAND_COLORS[i % EQ_BAND_COLORS.length]);
    svg.append(p);
    return p;
  });
  const fill = el("path", { class: "sq-eqdraw__fill" });
  const curve = el("path", { class: "sq-eqdraw__curve" });
  svg.append(fill, curve);

  const nodes = bands.map((b, i) => {
    const g = el("g", { class: "sq-eqdraw__band", tabindex: "0", role: "slider",
      "aria-label": `${b.label} gain`, "aria-valuemin": String(-EQ_DB_MAX), "aria-valuemax": String(EQ_DB_MAX) });
    g.style.setProperty("--c", EQ_BAND_COLORS[i % EQ_BAND_COLORS.length]);
    const tip = el("title");
    tip.textContent = `${b.label}: drag across for frequency, up and down for gain${b.q != null ? ", the wheel for width" : ""}. Double-click resets it`;
    const ring = el("circle", { r: 9, class: "sq-eqdraw__ring" });
    const dot = el("circle", { r: 6.5, class: "sq-eqdraw__dot" });
    const num = el("text", { class: "sq-eqdraw__num", "text-anchor": "middle" });
    num.textContent = String(i + 1);
    // where an LFO or a lane has moved the band to; hidden unless driven
    const live = el("circle", { r: 3.5, class: "sq-eqdraw__live" });
    g.append(tip, ring, dot, num, live);
    g.addEventListener("focus", () => select(i));
    g.addEventListener("keydown", (e) => {
      const s = state();
      const fine = e.shiftKey;
      let used = true;
      if (e.key === "ArrowUp") write(i, { gain: s[i].gain + (fine ? 0.5 : 1) });
      else if (e.key === "ArrowDown") write(i, { gain: s[i].gain - (fine ? 0.5 : 1) });
      else if (e.key === "ArrowRight") write(i, { freq: s[i].freq * Math.pow(2, fine ? 1 / 24 : 1 / 6) });
      else if (e.key === "ArrowLeft") write(i, { freq: s[i].freq / Math.pow(2, fine ? 1 / 24 : 1 / 6) });
      else if ((e.key === "]" || e.key === "+") && s[i].q != null) write(i, { q: s[i].q * 1.15 });
      else if ((e.key === "[" || e.key === "-") && s[i].q != null) write(i, { q: s[i].q / 1.15 });
      else if (e.key === "0" || e.key === "Delete" || e.key === "Backspace") reset(i);
      else used = false;
      if (!used) return;
      e.preventDefault();
      e.stopPropagation();
      settle();
    });
    svg.append(g);
    return { g, ring, dot, num, live };
  });
  wrap.append(svg);

  // The selected band's numbers under the graph, and its width on buttons,
  // since a finger has no wheel.
  const info = document.createElement("div");
  info.className = "sq-eqdraw__info";
  const infoName = document.createElement("span");
  infoName.className = "sq-eqdraw__name";
  // The selected band's three numbers, each its own control: a right-click
  // (a long-press on touch) opens that one's parameter menu, which is how a
  // frequency or a Q gets an LFO or a lane — the dot itself opens the gain's.
  const infoVals = document.createElement("span");
  infoVals.className = "sq-eqdraw__vals";
  const valSpan = (field) => {
    const sp = document.createElement("span");
    sp.className = `sq-eqdraw__val sq-eqdraw__val--${field}`;
    sp.title = `right-click: modulate or automate this band's ${field === "q" ? "width (Q)" : field}`;
    sp.addEventListener("contextmenu", (e) => {
      const input = ins[sel][field];
      if (!input) return;
      e.preventDefault();
      e.stopPropagation();
      input.dispatchEvent(new MouseEvent("contextmenu", {
        bubbles: true, cancelable: true, clientX: e.clientX, clientY: e.clientY }));
    });
    infoVals.append(sp);
    return sp;
  };
  const valFreq = valSpan("freq"), valGain = valSpan("gain"), valQ = valSpan("q");
  const qBtns = document.createElement("span");
  qBtns.className = "sq-eqdraw__q";
  const mkBtn = (label, title, fn) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "sq-btn--ghost";
    btn.textContent = label;
    btn.title = title;
    btn.addEventListener("click", fn);
    return btn;
  };
  qBtns.append(
    mkBtn("wider", "a wider bell (lower Q)", () => { const s = state()[sel]; if (s.q != null) { write(sel, { q: s.q / 1.25 }); settle(); } }),
    mkBtn("narrower", "a narrower bell (higher Q)", () => { const s = state()[sel]; if (s.q != null) { write(sel, { q: s.q * 1.25 }); settle(); } }),
  );
  const resetBtn = mkBtn("reset", "put this band back: 0 dB at its own frequency", () => { reset(sel); settle(); });
  info.append(infoName, infoVals, qBtns, resetBtn);
  wrap.append(info);
  row.append(wrap);
  panel.classList.add("has-eqdraw");

  let sel = 0;           // the band the info strip shows
  let hover = -1;        // the band under the pointer, lit
  const state = () => {
    const eq = read();
    return bands.map(b => bandState(b, eq));
  };

  // Where modulation has each band, per field, in its own units; empty when
  // nothing drives it. Filled by the inputs' `_motion` sinks (modMotion.js).
  const moved = bands.map(() => ({}));
  const fromUnit = (input, u) => {
    const lo = Number(input.min), hi = Number(input.max);
    const c = Math.max(0, Math.min(1, u));
    return input.dataset.scale === "log" && lo > 0 ? lo * Math.pow(hi / lo, c) : lo + c * (hi - lo);
  };
  bands.forEach((b, i) => {
    for (const field of ["gain", "freq", "q"]) {
      const input = ins[i][field];
      if (!input) continue;
      input._motion = (u) => {
        const had = field in moved[i];
        if (u == null) { if (!had) return; delete moved[i][field]; }
        else moved[i][field] = fromUnit(input, u);
        schedule();
      };
    }
  });

  const paint = () => {
    const eq = read();
    const st = bands.map(b => bandState(b, eq));
    // what is heard: the base, with whatever the modulation has moved
    const heard = st.map((s, i) => ({ ...s, ...moved[i] }));
    const total = new Array(CURVE_FREQS.length).fill(0);
    st.forEach((s, i) => {
      // the shapes and the curve are what is heard; the handle is the base
      const c = bandCoefs(heard[i]);
      const dbs = CURVE_FREQS.map(f => coefDb(c, f));
      dbs.forEach((d, k) => { total[k] += d; });
      bandShapes[i].setAttribute("d", areaOf(dbs));
      bandShapes[i].classList.toggle("is-lit", i === sel || i === hover);
      const n = nodes[i];
      const x = xOfF(s.freq), y = yOfDb(clampDb(s.gain));
      n.ring.setAttribute("cx", x); n.ring.setAttribute("cy", y);
      n.dot.setAttribute("cx", x); n.dot.setAttribute("cy", y);
      n.num.setAttribute("x", x); n.num.setAttribute("y", y + 3);
      n.g.classList.toggle("is-on", Math.abs(s.gain) >= 0.5 || Math.abs(s.freq - bands[i].freq) > 0.5);
      const driven = Object.keys(moved[i]).length > 0;
      n.g.classList.toggle("is-driven", driven);
      if (driven) {
        const h = heard[i];
        n.live.setAttribute("cx", xOfF(Math.max(F_LO, Math.min(F_HI, h.freq))));
        n.live.setAttribute("cy", yOfDb(clampDb(h.gain)));
      }
      n.g.classList.toggle("is-sel", i === sel);
      n.g.classList.toggle("is-hover", i === hover);
      n.g.setAttribute("aria-valuenow", String(s.gain));
      n.g.setAttribute("aria-valuetext", `${bands[i].label}: ${fmtDb(s.gain)} at ${fmtHz(s.freq)}${s.q != null ? `, Q ${s.q.toFixed(2)}` : ""}`);
    });
    curve.setAttribute("d", pathOf(total));
    fill.setAttribute("d", areaOf(total));
    const s = st[sel];
    infoName.textContent = bands[sel].label;
    infoName.style.color = EQ_BAND_COLORS[sel % EQ_BAND_COLORS.length];
    valFreq.textContent = fmtHz(s.freq);
    valGain.textContent = fmtDb(s.gain);
    valQ.textContent = s.q != null ? `Q ${s.q.toFixed(2)}` : "";
    valQ.hidden = s.q == null;
    // which of the three something is moving (the input's wrapper says, as
    // the dot beside a knob's label does)
    for (const [sp, field] of [[valFreq, "freq"], [valGain, "gain"], [valQ, "q"]]) {
      const m = ins[sel][field]?.closest("label")?.dataset.motion;
      if (m) sp.dataset.motion = m; else delete sp.dataset.motion;
    }
    qBtns.hidden = s.q == null;
  };
  let queued = false;
  const schedule = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; paint(); });
  };
  const select = (i) => { if (i !== sel) { sel = i; schedule(); } };

  // `.value = x` from anywhere (session load, p-lock recall, undo, a jam peer)
  // repaints, the same shadowing knob.js does for its knobs.
  const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  for (const input of ins.flatMap(i => [i.gain, i.freq, i.q]).filter(Boolean)) {
    input.addEventListener("input", schedule);
    if (!desc?.get || !desc?.set) continue;
    Object.defineProperty(input, "value", {
      configurable: true, enumerable: false,
      get() { return desc.get.call(this); },
      set(v) { desc.set.call(this, v); schedule(); },
    });
  }

  /** Write a band through its inputs, as if their sliders had been dragged. */
  const touched = new Set();
  function put(input, v) {
    if (!input || Number(input.value) === v) return;
    input.value = String(v);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    touched.add(input);
  }
  function write(i, { gain, freq, q }) {
    select(i);
    if (gain != null) put(ins[i].gain, snapDb(gain));
    if (freq != null) put(ins[i].freq, snapF(freq));
    if (q != null && ins[i].q) put(ins[i].q, snapQ(q));
    schedule();
  }
  function reset(i) {
    write(i, { gain: 0, freq: bands[i].freq, q: bands[i].q ?? undefined });
  }
  /** End of a gesture: a `change` on what moved, as a slider's release sends. */
  function settle() {
    for (const input of touched) input.dispatchEvent(new Event("change", { bubbles: true }));
    touched.clear();
  }

  const toView = (e) => {
    const r = svg.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width * W, y: (e.clientY - r.top) / r.height * H };
  };
  const nodeAt = (p) => {
    const st = state();
    let best = -1, bestD = HIT;
    st.forEach((s, i) => {
      const d = Math.hypot(xOfF(s.freq) - p.x, yOfDb(clampDb(s.gain)) - p.y);
      if (d < bestD) { bestD = d; best = i; }
    });
    return best;
  };
  const nearestTo = (x) => nearestBand(state().map(s => s.freq), fOfX(x));

  // A press on a node drags it (shift for fine). Anywhere else it draws: every
  // band the stroke passes takes its height there, interpolated between
  // pointer events so a fast stroke misses none.
  let drag = null;
  const drawTo = (p) => {
    const st = state();
    const last = drag.last;
    let hit = false;
    if (last && last.x !== p.x) {
      const xa = Math.min(last.x, p.x), xb = Math.max(last.x, p.x);
      st.forEach((s, i) => {
        const bx = xOfF(s.freq);
        if (bx < xa || bx > xb) return;
        const t = (bx - last.x) / (p.x - last.x);
        write(i, { gain: dbOfY(last.y + t * (p.y - last.y)) });
        hit = true;
      });
    }
    if (!hit) write(nearestTo(p.x), { gain: dbOfY(p.y) });
    drag.last = p;
  };

  svg.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    svg.setPointerCapture(e.pointerId);
    const p = toView(e);
    const i = nodeAt(p);
    if (i >= 0) {
      const s = state()[i];
      drag = { mode: "node", i, p0: p, f0: s.freq, g0: s.gain };
      select(i);
      nodes[i].g.focus({ preventScroll: true });
    } else {
      drag = { mode: "draw", last: null };
      drawTo(p);
    }
    wrap.classList.add("is-dragging");
  });
  svg.addEventListener("pointermove", (e) => {
    const p = toView(e);
    if (drag && svg.hasPointerCapture(e.pointerId)) {
      if (drag.mode === "draw") { drawTo(p); return; }
      const k = e.shiftKey ? 0.2 : 1;
      const f = Math.exp(Math.log(drag.f0) + (p.x - drag.p0.x) * k / PW * LOG_SPAN);
      const g = drag.g0 + (dbOfY(p.y) - dbOfY(drag.p0.y)) * k;
      write(drag.i, { freq: f, gain: g });
      return;
    }
    const i = nodeAt(p);
    const h = i >= 0 ? i : -1;
    svg.classList.toggle("is-over-node", h >= 0);
    if (h !== hover) { hover = h; schedule(); }
  });
  const end = (e) => {
    if (!svg.hasPointerCapture(e.pointerId)) return;
    svg.releasePointerCapture(e.pointerId);
    drag = null;
    wrap.classList.remove("is-dragging");
    settle();
  };
  svg.addEventListener("pointerup", end);
  svg.addEventListener("pointercancel", end);
  svg.addEventListener("pointerleave", () => {
    if (drag) return;
    if (hover !== -1) { hover = -1; schedule(); }
  });
  // The wheel is a bell's width (or, on a shelf, nothing to do).
  svg.addEventListener("wheel", (e) => {
    const p = toView(e);
    const n = nodeAt(p);
    const i = n >= 0 ? n : nearestTo(p.x);
    const s = state()[i];
    if (s.q == null) return;
    e.preventDefault();
    write(i, { q: s.q * Math.pow(1.0015, -e.deltaY * (e.shiftKey ? 0.25 : 1)) });
    clearTimeout(wheelEnd);
    wheelEnd = setTimeout(settle, 300);
  }, { passive: false });
  let wheelEnd = 0;
  // Double-click a node resets it; anywhere else flattens the nearest band.
  svg.addEventListener("dblclick", (e) => {
    const p = toView(e);
    const n = nodeAt(p);
    if (n >= 0) reset(n);
    else write(nearestTo(p.x), { gain: 0 });
    settle();
  });
  // Right-click is the band's parameter menu, resolved through its gain input.
  svg.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const p = toView(e);
    const n = nodeAt(p);
    const i = n >= 0 ? n : nearestTo(p.x);
    select(i);
    ins[i].gain.dispatchEvent(new MouseEvent("contextmenu", {
      bubbles: true, cancelable: true, clientX: e.clientX, clientY: e.clientY }));
  });

  // The spectrum: the eq's output, read only while the graph is on screen.
  let bins = null, raf = 0, onScreen = false;
  const specFreqs = Array.from({ length: 121 }, (_, i) => fOfX(PAD_L + i / 120 * PW));
  const specFrame = () => {
    raf = 0;
    if (!onScreen || !svg.isConnected) return;
    const an = getAnalyser?.();
    if (an) {
      if (!bins || bins.length !== an.frequencyBinCount) bins = new Float32Array(an.frequencyBinCount);
      an.getFloatFrequencyData(bins);
      const hz = an.context.sampleRate / an.fftSize;
      let d = "";
      specFreqs.forEach((f, k) => {
        // the loudest bin between this point and the next, so the top end,
        // where a point spans dozens of bins, is not a random one of them
        const b0 = Math.max(1, Math.round(f / hz));
        const b1 = Math.max(b0, Math.round((specFreqs[k + 1] ?? f) / hz) - 1);
        let v = -Infinity;
        for (let b = b0; b <= b1 && b < bins.length; b++) v = Math.max(v, bins[b]);
        if (!Number.isFinite(v)) v = bins[Math.min(b0, bins.length - 1)];
        // tilted up 4.5dB an octave from 1k, as music is pink and a flat
        // display of it slopes away under the curve
        const tilt = 4.5 * Math.log2(f / 1000);
        const u = Math.max(0, Math.min(1, ((Number.isFinite(v) ? v : SPEC_BOT) + tilt - SPEC_BOT) / (SPEC_TOP - SPEC_BOT)));
        const y = PAD_TOP + (1 - u) * PH;
        d += `${k ? "L" : "M"}${xOfF(f).toFixed(1)},${y.toFixed(1)}`;
      });
      spectrum.setAttribute("d", `${d}L${xOfF(F_HI).toFixed(1)},${PAD_TOP + PH}L${xOfF(F_LO).toFixed(1)},${PAD_TOP + PH}Z`);
    } else {
      spectrum.removeAttribute("d");
    }
    raf = requestAnimationFrame(specFrame);
  };
  if (typeof IntersectionObserver === "function") {
    new IntersectionObserver((entries) => {
      onScreen = entries.some(en => en.isIntersecting);
      if (onScreen && !raf) raf = requestAnimationFrame(specFrame);
    }).observe(svg);
  }

  paint();
}
