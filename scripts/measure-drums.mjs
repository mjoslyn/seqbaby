#!/usr/bin/env node
// Render every TR-808 / TR-909 voice and measure it.
//
// The drum machines are built from native Web Audio nodes, so unlike reverb.js
// they cannot be exercised by `node --test` — there is no oscillator, no biquad
// and no waveshaper in Node. What there IS, on any machine that can build this,
// is a headless Chrome with an OfflineAudioContext, which renders faster than
// real time and gives back the samples. Every number in CLAUDE.md's 808 / 909
// section comes from here.
//
//   node scripts/measure-drums.mjs                  # needs `npm i playwright`
//   SEQBABY_CHROME=/path/to/chrome node scripts/...  # or point it at a Chromium
//
// playwright, for mcp/audition.mjs's reasons: it is the one already-optional
// way this repo drives a browser, and driving one by hand means reading the
// DevTools protocol to know when an async render has finished.
//
// It serves public/ over localhost rather than using file://, because a module
// graph will not load off file:// — and it imports the engine's own
// drumMachine.js, so there is no second copy of the model to drift.

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pub = join(root, "public");

async function loadPlaywright() {
  // playwright is CommonJS, so a dynamic import may hand its exports back on
  // `default`; either way the object with `chromium` on it is what is wanted.
  const unwrap = (m) => (m?.chromium ? m : m?.default?.chromium ? m.default : null);
  try { const m = unwrap(await import("playwright")); if (m) return m; } catch {}
  try { const req = createRequire(process.cwd() + "/"); const m = unwrap(await import(req.resolve("playwright"))); if (m) return m; } catch {}
  throw new Error("measure-drums needs the playwright package: npm i playwright");
}

const PAGE = `<!doctype html><meta charset=utf8><body><pre id=out>working</pre>
<script>
// Say what went wrong rather than hanging: a headless run has no console to
// read, so anything thrown comes back down the same pipe the numbers do.
const tell = (t) => fetch("/__result", { method: "POST", body: t });
addEventListener("error", (e) => tell("page error: " + (e.message || e.type) + " " + (e.filename || "")));
addEventListener("unhandledrejection", (e) => tell("page rejection: " + (e.reason && e.reason.message || e.reason)));
</script>
<script type="module">
import { buildDrumMachineVoice } from "/js/drumMachine.js";
fetch("/__ping", { method: "POST", body: "module loaded" });

const KINDS = ["808-kick","808-snare","808-chat","808-ohat","808-clap","808-cowbell",
               "909-kick","909-snare","909-chat","909-ohat","909-clap"];
const SR = 48000;
const db = (x) => 20 * Math.log10(Math.max(x, 1e-12));

async function render(kind, hits, seconds, params) {
  const ctx = new OfflineAudioContext(1, Math.ceil(seconds * SR), SR);
  const out = ctx.createGain();
  out.gain.value = 1;
  out.connect(ctx.destination);
  const v = buildDrumMachineVoice(kind, out, ctx);
  for (const [k, val] of Object.entries(params || {})) v.setParam(k, val);
  for (const h of hits) v.trigger(h.note ?? 36, h.t, 0.1, h.vel ?? 1);
  return (await ctx.startRendering()).getChannelData(0);
}
const peak = (d, from = 0, to = null) => {
  let p = 0;
  for (let i = Math.floor(from * SR); i < (to == null ? d.length : Math.floor(to * SR)); i++) p = Math.max(p, Math.abs(d[i]));
  return db(p);
};
const rmsOf = (d, from, to) => {
  const a = Math.floor(from * SR), b = Math.min(d.length, Math.floor(to * SR));
  let s = 0;
  for (let i = a; i < b; i++) s += d[i] * d[i];
  return db(Math.sqrt(s / (b - a)));
};
const dcOf = (d, from, to) => {
  const a = Math.floor(from * SR), b = Math.floor(to * SR);
  let s = 0;
  for (let i = a; i < b; i++) s += d[i];
  return s / (b - a);
};
// Zero crossings, but only pairs with real signal between them: the floor
// between hits otherwise reads as a very high pitch.
function pitchAt(d, t0, ms, gate = 0.05) {
  const want = t0 + ms / 1000;
  let last = null, hi = 0, best = null;
  for (let i = Math.floor(t0 * SR) + 1; i < Math.floor((t0 + 0.6) * SR); i++) {
    hi = Math.max(hi, Math.abs(d[i]));
    if (d[i - 1] <= 0 && d[i] > 0) {
      const frac = d[i - 1] === d[i] ? 0 : -d[i - 1] / (d[i] - d[i - 1]);
      const t = (i - 1 + frac) / SR;
      if (last != null && hi > gate && (best == null || Math.abs(t - want) < Math.abs(best.t - want))) best = { t, hz: 1 / (t - last) };
      last = t; hi = 0;
    }
  }
  return best ? best.hz.toFixed(1) : "-";
}

const L = [];
const say = (...x) => L.push(x.join(" "));

say("one hit at vel 1, default knobs");
for (const k of KINDS) {
  const d = await render(k, [{ t: 0.05 }], 2.5);
  let ring = 0.05;
  for (let i = d.length - 1; i > 0; i--) if (Math.abs(d[i]) > 3e-4) { ring = i / SR; break; }
  say("  " + k.padEnd(12), "peak", peak(d).toFixed(1).padStart(6), "dB   rms",
      rmsOf(d, 0.05, 0.8).toFixed(1).padStart(6), "dB   ring", (ring - 0.05).toFixed(3), "s");
}

say("");
say("DC left on the output, 2s after three kicks");
for (const k of ["808-kick", "909-kick"]) {
  const d = await render(k, [{ t: 0.05 }, { t: 0.4 }, { t: 0.8 }], 2.5);
  say("  " + k.padEnd(12), dcOf(d, 2.0, 2.5).toExponential(2));
}

say("");
say("kick pitch sweep, click off (Hz at ms after the trigger)");
for (const k of ["808-kick", "909-kick"]) {
  const d = await render(k, [{ t: 0.02 }], 1.0, { morph: 0, timb: 0 });
  say("  " + k.padEnd(12), [5, 10, 20, 40, 60, 100].map((ms) => String(ms).padStart(3) + "ms:" + pitchAt(d, 0.02, ms).padStart(6)).join("  "));
}

say("");
say("monophony: a hit 50..100ms in, with and without an earlier one on top");
for (const k of ["808-ohat", "909-ohat", "808-cowbell", "808-snare"]) {
  const solo = await render(k, [{ t: 0.30 }], 1.6, { decay: 1 });
  const both = await render(k, [{ t: 0.05 }, { t: 0.30 }], 1.6, { decay: 1 });
  const a = rmsOf(solo, 0.35, 0.40), b = rmsOf(both, 0.35, 0.40);
  say("  " + k.padEnd(12), "alone", a.toFixed(1), "dB   after an earlier hit", b.toFixed(1),
      "dB   excess", (b - a).toFixed(1), "dB");
}

say("");
say("the retrigger's own step, over the wave's biggest step while ringing");
for (const k of ["808-ohat", "909-ohat", "808-cowbell", "808-chat"]) {
  const d = await render(k, [{ t: 0.05 }, { t: 0.20 }], 1.0, { decay: 1 });
  let jump = 0, base = 0;
  for (let i = Math.floor(0.1985 * SR); i < Math.floor(0.2015 * SR); i++) jump = Math.max(jump, Math.abs(d[i] - d[i - 1]));
  for (let i = Math.floor(0.055 * SR); i < Math.floor(0.09 * SR); i++) base = Math.max(base, Math.abs(d[i] - d[i - 1]));
  say("  " + k.padEnd(12), (jump / Math.max(base, 1e-9)).toFixed(2), "x");
}

say("");
say("two hits of one voice, correlated over the first 80ms");
for (const k of ["808-chat", "808-ohat", "808-cowbell", "909-chat", "808-clap", "808-kick"]) {
  const d = await render(k, [{ t: 0.05 }, { t: 0.60 }], 1.2);
  const n = Math.floor(0.08 * SR), a0 = Math.floor(0.05 * SR), b0 = Math.floor(0.60 * SR);
  let num = 0, da = 0, dbb = 0;
  for (let i = 0; i < n; i++) { num += d[a0 + i] * d[b0 + i]; da += d[a0 + i] ** 2; dbb += d[b0 + i] ** 2; }
  say("  " + k.padEnd(12), (num / Math.sqrt(Math.max(da * dbb, 1e-12))).toFixed(3));
}

say("");
say("clap: the three slaps and the tail, peak in a 3ms window at each");
for (const [k, gap] of [["808-clap", 0.0105], ["909-clap", 0.0078]]) {
  const d = await render(k, [{ t: 0.02 }], 1.0);
  const at = (ms) => peak(d, 0.02 + ms / 1000, 0.02 + ms / 1000 + 0.003).toFixed(1).padStart(6);
  const at_ = (s) => at(s * 1000);
  say("  " + k.padEnd(12), "slaps", at_(0), at_(gap * 1.08), at_(2 * gap * 1.16),
      "  tail", at_(3.2 * gap), at(3.2 * gap * 1000 + 20), at(3.2 * gap * 1000 + 50), "dB");
}

say("");
say("nodes built by 64 hits (what the transport callback leaves behind)");
for (const k of ["808-chat", "808-kick", "808-clap"]) {
  const ctx = new OfflineAudioContext(1, SR * 5, SR);
  const out = ctx.createGain();
  out.connect(ctx.destination);
  let made = 0;
  for (const f of ["createOscillator", "createGain", "createBiquadFilter", "createBufferSource", "createWaveShaper"]) {
    const orig = ctx[f].bind(ctx);
    ctx[f] = () => { made++; return orig(); };
  }
  const v = buildDrumMachineVoice(k, out, ctx);
  const built = made;
  made = 0;
  for (let i = 0; i < 64; i++) v.trigger(36, 0.05 + i * 0.06, 0.05, 1);
  say("  " + k.padEnd(12), String(built).padStart(3), "at build,", String(made).padStart(4), "over 64 hits");
}

const text = L.join("\\n");
document.getElementById("out").textContent = text;
// Hand the numbers back over the same connection the page came down, which is
// the one signal that says the work is DONE. --dump-dom fires at load, long
// before an OfflineAudioContext has rendered anything, and --virtual-time-budget
// never expires here because nothing in this page waits on a timer.
tell(text);
</script>`;

let report = null;
const done = new Promise((r) => { report = r; });

const server = createServer((req, res) => {
  const url = req.url.split("?")[0];
  if (url === "/__ping") { res.end("ok"); return; }
  if (url === "/__result") {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => { res.end("ok"); report(body); });
    return;
  }
  if (url === "/__measure.html") {
    res.setHeader("content-type", "text/html");
    return res.end(PAGE);
  }
  const f = normalize(join(pub, url));
  if (!f.startsWith(pub)) { res.statusCode = 403; return res.end("no"); }
  try {
    if (f.endsWith(".js")) res.setHeader("content-type", "text/javascript");
    res.end(readFileSync(f));
  } catch { res.statusCode = 404; res.end("no"); }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;

const { chromium } = await loadPlaywright();
const browser = await chromium.launch(
  process.env.SEQBABY_CHROME ? { executablePath: process.env.SEQBABY_CHROME } : {});

try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => report("page error: " + e.message));
  await page.goto(`http://127.0.0.1:${port}/__measure.html`);
  console.log(await Promise.race([
    done,
    // unref'd, or the loser of this race holds the process open for five
    // minutes after the numbers have been printed.
    new Promise((_, bad) => setTimeout(() => bad(new Error("the page never reported back")), 5 * 60_000).unref()),
  ]));
} finally {
  await browser.close().catch(() => {});
  server.closeAllConnections?.();
  server.close();
}
