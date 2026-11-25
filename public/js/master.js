/**
 * The master chain: tone, glue and drive on the whole mix.
 *
 *   masterGain ─▶ [EQ low · mid · high] ─▶ [GLUE + trim] ─▶ [DRIVE] ─▶ masterLimiter ─▶ out
 *
 * The master used to be a gain into a safety limiter and nothing else, so
 * every song left the app as the bare sum of its tracks. This is the stage a
 * mix bus has: three bands, a bus compressor and a saturator, ahead of the
 * limiter that was always there.
 *
 * - **A neutral stage is out of the circuit**, not set to do nothing. A
 *   DynamicsCompressorNode delays its signal by its lookahead and adds makeup
 *   gain whatever its ratio, and an oversampled waveshaper filters, so "glue
 *   0" left in the path would change every old song. The chain is rewired
 *   when a stage crosses zero (`wire`), in one task: the links that go and
 *   the links that come are made together.
 * - **`state.master` is the config** (soundDefaults.js: MASTER_DEFAULTS),
 *   saved with the song as `master` only when something in it is on, and so
 *   undoable and shared in a jam like any global. Outside p-lock: it is the
 *   mix's, not a track's.
 * - The master analyser still taps `masterGain`, before all of this, and the
 *   bounce and the compose panel's listen still take the limiter's output.
 */
import { setStatus } from "./dom.js";
import { upgradeKnobs } from "./knob.js";
import {
  MASTER_DEFAULTS, MASTER_KEYS, MASTER_LABELS, MASTER_RANGE, MASTER_TIPS,
  driveCurve, driveSettings, glueSettings, masterIsNeutral, normalizeMaster,
} from "./soundDefaults.js";
import { state } from "./state.js";

/** @type {null | {low: BiquadFilterNode, mid: BiquadFilterNode, high: BiquadFilterNode, glue: DynamicsCompressorNode, trim: GainNode, pre: GainNode, shaper: WaveShaperNode, post: GainNode, links: [AudioNode, AudioNode][], sig: string}} */
let chain = null;

/** The master config, always whole. */
export function masterConfig() {
  if (!state.master) state.master = { ...MASTER_DEFAULTS };
  return state.master;
}

/** What a song stores: the config when something is on, else nothing. */
export function serializeMaster() {
  return masterIsNeutral(state.master) ? undefined : normalizeMaster(state.master);
}

/**
 * Build the chain's nodes and wire it between the master gain and the
 * limiter. Called once, by ensureAudio, in place of the direct connection.
 */
export function initMasterChain() {
  const ctx = state.audioCtx;
  if (!ctx || !state.masterGain || !state.masterLimiter || chain) return;
  const low = ctx.createBiquadFilter();  low.type = "lowshelf";  low.frequency.value = 120;
  const mid = ctx.createBiquadFilter();  mid.type = "peaking";   mid.frequency.value = 1000; mid.Q.value = 0.7;
  const high = ctx.createBiquadFilter(); high.type = "highshelf"; high.frequency.value = 6000;
  const glue = ctx.createDynamicsCompressor();
  const trim = ctx.createGain();
  const pre = ctx.createGain();
  const shaper = ctx.createWaveShaper();
  shaper.curve = driveCurve();
  shaper.oversample = "4x";
  const post = ctx.createGain();
  // the links inside each stage never change
  low.connect(mid); mid.connect(high);
  glue.connect(trim);
  pre.connect(shaper); shaper.connect(post);
  chain = { low, mid, high, glue, trim, pre, shaper, post, links: [], sig: "" };
  applyMaster();
}

/** Which stages are in the circuit for a config: "eq", "glue", "drive". */
function activeStages(m) {
  const out = [];
  if (Math.abs(m.low) > 1e-6 || Math.abs(m.mid) > 1e-6 || Math.abs(m.high) > 1e-6) out.push("eq");
  if (m.glue > 1e-6) out.push("glue");
  if (m.drive > 1e-6) out.push("drive");
  return out;
}

function wire(stages) {
  const sig = stages.join(">");
  if (chain.sig === sig && chain.links.length) return;
  const ends = {
    eq: [chain.low, chain.high], glue: [chain.glue, chain.trim], drive: [chain.pre, chain.post],
  };
  /** @type {[AudioNode, AudioNode][]} */
  const next = [];
  let from = state.masterGain;
  for (const s of stages) { next.push([from, ends[s][0]]); from = ends[s][1]; }
  next.push([from, state.masterLimiter]);
  // The new path first, then the old one away, in this one task: nothing is
  // heard twice and nothing drops out between them.
  const same = (a, b) => a[0] === b[0] && a[1] === b[1];
  for (const l of next) if (!chain.links.some(o => same(o, l))) { try { l[0].connect(l[1]); } catch {} }
  for (const o of chain.links) if (!next.some(l => same(o, l))) { try { o[0].disconnect(o[1]); } catch {} }
  chain.links = next;
  chain.sig = sig;
}

/** Write `state.master` onto the nodes. Safe before the audio exists. */
export function applyMaster() {
  const m = state.master = normalizeMaster(state.master);
  if (!chain || !state.audioCtx) return;
  const now = state.audioCtx.currentTime;
  const set = (param, v) => { try { param.setTargetAtTime(v, now, 0.02); } catch { param.value = v; } };
  set(chain.low.gain, m.low);
  set(chain.mid.gain, m.mid);
  set(chain.high.gain, m.high);
  const g = glueSettings(m.glue);
  set(chain.glue.threshold, g.threshold);
  set(chain.glue.ratio, g.ratio);
  chain.glue.knee.value = g.knee;
  chain.glue.attack.value = g.attack;
  chain.glue.release.value = g.release;
  set(chain.trim.gain, Math.pow(10, g.trimDb / 20));
  const d = driveSettings(m.drive);
  set(chain.pre.gain, d.pre);
  set(chain.post.gain, d.post);
  wire(activeStages(m));
}

/**
 * Set the whole master config (a song arriving, an undo, a jam patch).
 * @param {any} m a config, or nothing for neutral
 */
export function setMaster(m) {
  state.master = normalizeMaster(m);
  applyMaster();
  syncMasterUI();
}

/** dB the glue is taking off right now (0 or negative), for the panel. */
export function glueReduction() {
  return chain && state.master?.glue > 0 ? Number(chain.glue.reduction) || 0 : 0;
}

// ---- the panel ------------------------------------------------------------

let open = null;        // { overlay, inputs, gr, raf }

const fmt = (k, v) => (k === "glue" || k === "drive")
  ? (v > 0 ? `${Math.round(v * 100)}%` : "off")
  : `${v > 0 ? "+" : ""}${v.toFixed(1)}dB`;

/** The button says whether anything is on; the panel's knobs follow the config. */
export function syncMasterUI() {
  const btn = document.getElementById("master-btn");
  if (btn) btn.classList.toggle("is-on", !masterIsNeutral(state.master));
  if (!open) return;
  const m = masterConfig();
  for (const [k, input] of Object.entries(open.inputs)) {
    if (!input.matches(":active")) input.value = String(m[k]);
    const read = input.closest(".sq-field")?.querySelector(".sq-master__val");
    if (read) read.textContent = fmt(k, m[k]);
  }
}

export function openMasterPanel() {
  if (open) return;
  const m = masterConfig();
  const overlay = document.createElement("div");
  overlay.className = "sq-modal-overlay";
  const modal = document.createElement("div");
  modal.className = "sq-modal sq-panel__modal sq-master__modal";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-label", "master");
  const title = document.createElement("div");
  title.className = "sq-panel__modal-title";
  title.textContent = "master";
  const hint = document.createElement("p");
  hint.className = "sq-master__hint";
  hint.textContent = "the whole mix, after every track and bus and before the limiter. Saved with the song.";
  const row = document.createElement("div");
  row.className = "sq-master__row";
  /** @type {Record<string, HTMLInputElement>} */
  const inputs = {};
  for (const k of MASTER_KEYS) {
    const [lo, hi] = MASTER_RANGE[k];
    const field = document.createElement("div");
    field.className = "sq-field sq-master__field";
    const label = document.createElement("label");
    label.textContent = MASTER_LABELS[k];
    const input = document.createElement("input");
    input.type = "range"; input.min = String(lo); input.max = String(hi);
    input.step = k === "glue" || k === "drive" ? "0.01" : "0.5";
    // the attribute is the knob's double-click default (knob.js): neutral
    input.setAttribute("value", String(MASTER_DEFAULTS[k]));
    input.value = String(m[k]);
    input.className = `p-master-${k}`;
    input.title = MASTER_TIPS[k];
    input.setAttribute("aria-label", `master ${MASTER_LABELS[k]}`);
    const val = document.createElement("span");
    val.className = "sq-master__val";
    input.addEventListener("input", () => {
      masterConfig()[k] = Number(input.value);
      applyMaster();
      syncMasterUI();
    });
    field.append(label, input, val);
    row.appendChild(field);
    inputs[k] = input;
  }
  const gr = document.createElement("div");
  gr.className = "sq-master__gr";
  gr.title = "how much the glue compressor is taking off right now";
  const tools = document.createElement("div");
  tools.className = "sq-master__tools";
  const reset = document.createElement("button");
  reset.type = "button";
  reset.className = "sq-btn--ghost";
  reset.textContent = "reset";
  reset.title = "everything back to neutral: the mix as the tracks sum";
  reset.addEventListener("click", () => { setMaster(null); setStatus("master: neutral"); });
  const done = document.createElement("button");
  done.type = "button";
  done.className = "sq-panel__modal-close";
  done.textContent = "done";
  tools.append(gr, reset);
  modal.append(title, hint, row, tools, done);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  upgradeKnobs(overlay);

  const close = () => {
    if (!open) return;
    cancelAnimationFrame(open.raf);
    document.removeEventListener("keydown", esc);
    overlay.remove();
    open = null;
    document.getElementById("master-btn")?.setAttribute("aria-pressed", "false");
  };
  const esc = (e) => { if (e.key === "Escape") close(); };
  done.addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  document.addEventListener("keydown", esc);

  open = { overlay, inputs, gr, raf: 0 };
  const tick = () => {
    if (!open) return;
    const r = glueReduction();
    gr.textContent = state.master?.glue > 0 ? `glue ${r < -0.05 ? r.toFixed(1) : "0.0"} dB` : "";
    open.raf = requestAnimationFrame(tick);
  };
  tick();
  document.getElementById("master-btn")?.setAttribute("aria-pressed", "true");
  syncMasterUI();
}

/** Wire the transport's `master` button. */
export function initMasterUI() {
  const btn = document.getElementById("master-btn");
  if (!btn) return;
  btn.addEventListener("click", () => openMasterPanel());
  syncMasterUI();
}
