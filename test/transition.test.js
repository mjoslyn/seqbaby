import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SWEEP_BOTTOM,
  SWEEP_TOP,
  normalizeTransition,
  openSteps,
  rampBpm,
  sweepHz,
  tempoMode,
  transitionSteps,
} from "../public/js/transitionPlan.js";

test("defaults: next bar, cut, 2 bars, auto tempo", () => {
  assert.deepEqual(normalizeTransition(), { when: "bar", shape: "cut", bars: 2, tempo: "auto" });
  assert.deepEqual(normalizeTransition({ when: "x", shape: "sweep", bars: 3, tempo: "ramp" }),
    { when: "bar", shape: "sweep", bars: 2, tempo: "ramp" });
  assert.equal(normalizeTransition({ bars: "8" }).bars, 8);
});

test("a cut lands on the next bar line, or at once", () => {
  assert.deepEqual(transitionSteps({ when: "bar", shape: "cut", bars: 4 }, 16, 0), { wait: 0, run: 0 });
  assert.deepEqual(transitionSteps({ when: "bar", shape: "cut", bars: 4 }, 16, 5), { wait: 11, run: 0 });
  assert.deepEqual(transitionSteps({ when: "now", shape: "cut", bars: 4 }, 16, 5), { wait: 0, run: 0 });
});

test("a sweep runs whole bars and always ends on a bar line", () => {
  for (const bars of [1, 2, 4, 8]) {
    for (const barLen of [16, 14, 28, 12]) {
      for (let tick = 0; tick < barLen; tick++) {
        for (const when of ["bar", "now"]) {
          const { wait, run } = transitionSteps({ when, shape: "sweep", bars }, barLen, tick);
          assert.equal((tick + wait + run) % barLen, 0, `${when} ${bars} ${barLen} ${tick}`);
          assert.ok(run >= Math.ceil(barLen / 2) + (bars - 1) * barLen, "never shorter than half a bar under the asked length");
          if (when === "bar") assert.equal(run, bars * barLen);
          else assert.equal(wait, 0);
        }
      }
    }
  }
});

test("tempo: a cut jumps, auto ramps close tempos and jumps far ones", () => {
  assert.equal(tempoMode("auto", 120, 120, "sweep"), "none");
  assert.equal(tempoMode("ramp", 120, 128, "cut"), "jump");
  assert.equal(tempoMode("auto", 124, 128, "sweep"), "ramp");
  assert.equal(tempoMode("auto", 120, 137, "sweep"), "ramp");
  assert.equal(tempoMode("auto", 100, 140, "sweep"), "jump");
  assert.equal(tempoMode("auto", 87, 174, "sweep"), "jump");
  assert.equal(tempoMode("auto", 174, 87, "sweep"), "jump");
  assert.equal(tempoMode("ramp", 100, 140, "sweep"), "ramp");
  assert.equal(tempoMode("jump", 124, 128, "sweep"), "jump");
});

test("the ramp and the sweep run from where they are to where they land", () => {
  assert.equal(rampBpm(120, 128, 0), 120);
  assert.equal(rampBpm(120, 128, 1), 128);
  assert.equal(rampBpm(120, 128, 2), 128);
  assert.equal(rampBpm(120, 128, 0.5), 124);
  assert.equal(sweepHz(0), SWEEP_TOP);
  assert.ok(Math.abs(sweepHz(1) - SWEEP_BOTTOM) < 1e-6);
  let last = Infinity;
  for (let p = 0; p <= 1; p += 0.05) { const f = sweepHz(p); assert.ok(f <= last); last = f; }
  assert.equal(openSteps(1, 16), 8);
  assert.equal(openSteps(4, 16), 16);
});
