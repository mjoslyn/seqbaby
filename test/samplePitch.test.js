// The sampler's pitch select, and the shift that keeps a sample's length.
import test from "node:test";
import assert from "node:assert/strict";
import { makeShiftPlanner, samplePitchMode, SHIFT_GRAIN, SHIFT_HOP } from "../public/js/buffers.js";
import * as sb from "../public/js/songBuilder.js";

const SR = 44100;
const sine = (hz, sec) => Float32Array.from({ length: Math.round(sec * SR) }, (_, i) => Math.sin((2 * Math.PI * hz * i) / SR));

/** What the voice builds: each grain resampled by fit * ratio under a Hann window (the first starts full). */
function render(data, o) {
  const plan = makeShiftPlanner(data, SR, o);
  const out = new Float32Array(Math.round(((o.endSec - o.startSec) / o.fit + 0.2) * SR));
  const gN = Math.round(SHIFT_GRAIN * SR), rho = o.fit * o.ratio;
  let grains = 0, last = 0;
  for (let g = plan.next(); g && grains < 4000; g = plan.next(), grains++) {
    const at = Math.round(g.t * SR);
    for (let i = 0; i < gN && at + i < out.length; i++) {
      const p = g.pos * SR + i * rho, a = Math.floor(p);
      if (a + 1 >= data.length || p >= o.endSec * SR) break;
      const w = g.first && i <= gN / 2 ? 1 : 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / gN);
      out[at + i] += w * (data[a] + (data[a + 1] - data[a]) * (p - a));
      last = Math.max(last, at + i);
    }
  }
  return { out, grains, seconds: last / SR };
}
/** The pitch, from zero crossings over the middle of a render. */
function hz(out, from, to) {
  let n = 0;
  for (let i = Math.round(from * SR) + 1; i < Math.round(to * SR); i++) if (out[i - 1] < 0 && out[i] >= 0) n++;
  return n / (to - from);
}
const rms = (out, from, len) => { let s = 0; const a = Math.round(from * SR), n = Math.round(len * SR); for (let i = 0; i < n; i++) s += out[a + i] ** 2; return Math.sqrt(s / n); };

test("the select reads the old checkbox, and shift rides in sampleDefaults", () => {
  assert.equal(samplePitchMode({}), "lock");
  assert.equal(samplePitchMode({ pitchLock: true, sampleDefaults: { pitch: "shift" } }), "lock");
  assert.equal(samplePitchMode({ pitchLock: false }), "speed");
  assert.equal(samplePitchMode({ pitchLock: false, sampleDefaults: { pitch: "shift" } }), "shift");
});

test("a shifted note moves the pitch and keeps the length", () => {
  const data = sine(220, 1);
  for (const semis of [7, 12, -5, -12]) {
    const ratio = 2 ** (semis / 12);
    const r = render(data, { startSec: 0, endSec: 1, fit: 1, ratio });
    assert.ok(Math.abs(r.seconds - 1) < 0.08, `${semis}: ${r.seconds}s, not 1s`);
    const f = hz(r.out, 0.2, 0.8);
    assert.ok(Math.abs(f / (220 * ratio) - 1) < 0.02, `${semis}: ${f}Hz, wanted ${220 * ratio}`);
  }
});

test("the grains line up: a held tone keeps its level", () => {
  const data = sine(196, 1.2);
  const r = render(data, { startSec: 0, endSec: 1.2, fit: 1, ratio: 2 ** (4 / 12) });
  for (let t = 0.1; t < 1; t += 0.02) {
    const v = rms(r.out, t, 0.02);
    assert.ok(v > 0.55 && v < 0.85, `rms ${v.toFixed(3)} at ${t.toFixed(2)}s (0.707 is a clean sine)`);
  }
});

test("the region, the fit speed and a loop", () => {
  const data = sine(220, 2);
  const half = render(data, { startSec: 0.5, endSec: 1.5, fit: 2, ratio: 1.5 });
  assert.ok(Math.abs(half.seconds - 0.5) < 0.08, "a region read at twice the speed is half as long");
  const one = makeShiftPlanner(data, SR, { startSec: 0, endSec: 0.5, fit: 1, ratio: 1.2 });
  let n = 0; while (one.next()) n++;
  assert.equal(n, Math.ceil(0.5 / SHIFT_HOP));
  const loop = makeShiftPlanner(data, SR, { startSec: 0, endSec: 0.5, fit: 1, ratio: 1.2, loop: true });
  for (let i = 0; i < 100; i++) { const g = loop.next(); assert.ok(g && g.pos >= 0 && g.pos < 0.5); }
});

test("the builder sets it on a sampler and refuses it elsewhere", () => {
  const song = sb.newSong();
  const i = sb.addTrack(song, { engine: "sampler", sample: "techno kick" }).index;
  sb.setTrack(song, i, { samplePitch: "shift" });
  assert.equal(song.tracks[i].pitchLock, false);
  assert.equal(song.tracks[i].sampleDefaults.pitch, "shift");
  sb.setTrack(song, i, { samplePitch: "lock" });
  assert.equal(song.tracks[i].pitchLock, true);
  assert.equal(song.tracks[i].sampleDefaults.pitch, undefined);
  const j = sb.addTrack(song, { engine: "silverbox" }).index;
  assert.throws(() => sb.setTrack(song, j, { samplePitch: "shift" }), /sampler/);
});
