import assert from "node:assert/strict";
import test from "node:test";

import { TR808_METAL_HZ, pitchSweep, satCurve } from "../public/js/drumMachine.js";

// What can be checked of the drum machines without an audio graph.
//
// The voices themselves are native Web Audio nodes, so hearing them needs a
// browser — `scripts/measure-drums.mjs` renders all eleven in a headless
// OfflineAudioContext and is where the level, decay, monophony and DC numbers
// in CLAUDE.md come from. What is left over is pure arithmetic, and it is the
// arithmetic that is easy to get quietly wrong: a frequency nobody would notice
// was invented, a waveshaper laid out half a cell off, a pitch envelope shaped
// like the wrong curve.

test("the 808's oscillator bank is the machine's six, and the cowbell's two are in it", () => {
  // The TR-808's cymbal / hi-hat section runs six square oscillators at these
  // frequencies, and the cowbell is the 540 and 800 Hz pair out of that same
  // bank — which is why the cowbell's 1.48 ratio is a fact about the bank
  // rather than a number of its own.
  assert.deepEqual([...TR808_METAL_HZ].sort((a, b) => a - b),
    [205.3, 304.4, 369.6, 522.7, 540, 800]);
  assert.ok(TR808_METAL_HZ.includes(540) && TR808_METAL_HZ.includes(800));
  assert.equal(new Set(TR808_METAL_HZ).size, 6, "no two oscillators share a frequency");
});

test("the saturation curve is odd-symmetric, so silence in is silence out", () => {
  for (const amount of [0, 0.25, 0.5, 1]) {
    const { c } = satCurve(amount);
    assert.equal(c.length % 2, 1, "an odd length is what puts a sample at zero");
    const mid = (c.length - 1) / 2;
    assert.equal(c[mid], 0, "the centre of the curve is zero");
    for (let i = 1; i <= mid; i++) {
      assert.ok(Math.abs(c[mid + i] + c[mid - i]) < 1e-6,
        `curve is not odd about its centre at ${i} (amount ${amount})`);
      assert.ok(c[mid + i] >= c[mid + i - 1], "curve is not monotonic");
    }
    assert.ok(Math.abs(c[c.length - 1] - 1) < 1e-6, "full scale in, full scale out");
  }
});

test("a waveshaper reading the curve leaves no DC on a silent input", () => {
  // A WaveShaper maps x to index (x + 1) / 2 * (n - 1) and interpolates. The
  // old curve was laid out over `i * 2 / n - 1`, half a cell out, so an input of
  // zero came out at -0.004 and both kicks carried that as DC for the life of
  // the voice. Read the curve the way the node does and check it.
  for (const amount of [0, 0.3, 1]) {
    const { c } = satCurve(amount);
    const read = (x) => {
      const p = ((x + 1) / 2) * (c.length - 1);
      const i = Math.floor(p);
      return c[i] + (c[Math.min(i + 1, c.length - 1)] - c[i]) * (p - i);
    };
    assert.ok(Math.abs(read(0)) < 1e-9, `silence became ${read(0)} at amount ${amount}`);
    // and a symmetric signal stays symmetric, so no DC appears under a sine
    for (const x of [0.1, 0.37, 0.8]) {
      assert.ok(Math.abs(read(x) + read(-x)) < 1e-6, `asymmetric at ${x}`);
    }
  }
});

test("the kick's pitch envelope is an RC discharge, not a straight line", () => {
  // An exponential VCO fed a discharging capacitor moves linearly in SEMITONES
  // at an exponentially decaying rate. A single exponentialRampToValueAtTime is
  // linear in semitones at a CONSTANT rate, which is a corner where a 909's
  // punch lives; the sweep is laid out as four ramps along exp(-t/tau) instead.
  for (const [freq, bend, tau] of [[55, 1.26, 0.012], [50, 3.8, 0.009]]) {
    const pts = pitchSweep(freq, bend, tau);
    const ideal = (t) => freq * Math.pow(bend, Math.exp(-t / tau));

    // Every scheduled point sits on the curve it is approximating.
    for (const [t, hz] of pts.slice(0, -1)) {
      assert.ok(Math.abs(1200 * Math.log2(hz / ideal(t))) < 1,
        `tap at ${t}s is ${hz}Hz, curve says ${ideal(t)}Hz`);
    }

    // And between the taps — where the ramp is geometric, so linear in cents —
    // it never strays far from the curve either.
    let worst = 0;
    for (let i = 1; i < pts.length; i++) {
      const [t0, f0] = pts[i - 1], [t1, f1] = pts[i];
      for (let u = 0; u <= 1; u += 0.02) {
        const t = t0 + (t1 - t0) * u;
        const hz = f0 * Math.pow(f1 / f0, u);       // what an exponential ramp does
        worst = Math.max(worst, Math.abs(1200 * Math.log2(hz / ideal(t))));
      }
    }
    assert.ok(worst < 90, `sweep strays ${worst.toFixed(0)} cents from the RC curve`);

    // It starts a whole bend up and lands exactly on the note.
    assert.equal(pts[0][1], freq * bend);
    assert.equal(pts.at(-1)[1], freq);
    // Monotonically down, or the ramps would fight each other.
    for (let i = 1; i < pts.length; i++) assert.ok(pts[i][1] < pts[i - 1][1]);
  }
});

test("a sweep with no bend is a single point at the note", () => {
  const pts = pitchSweep(185, 1, 0.003);
  for (const [, hz] of pts) assert.equal(hz, 185);
});
