// The trig conditions and step probability (public/js/trigCond.js): the one
// answer the transport, the step editor and the song builder share.
import test from "node:test";
import assert from "node:assert/strict";
import {
  TRIG_CONDS, condPasses, hasTrig, isTrigCond, normalizeCond, normalizeProb,
  stepFires, trigCondLabel, trigMark, trigRoll,
} from "../public/js/trigCond.js";

test("a step with nothing on it always fires", () => {
  for (let pass = 0; pass < 20; pass++) {
    assert.equal(stepFires({ pass, step: 3, seed: 7 }), true);
    assert.equal(stepFires({ prob: 1, cond: "", pass, fill: true }), true);
  }
});

test("a:b plays the a-th of every b passes", () => {
  const plays = (cond, n = 8) => Array.from({ length: n }, (_, pass) => condPasses(cond, pass, false) ? 1 : 0).join("");
  assert.equal(plays("1:2"), "10101010");
  assert.equal(plays("2:2"), "01010101");
  assert.equal(plays("1:4"), "10001000");
  assert.equal(plays("4:4"), "00010001");
  assert.equal(plays("3:3", 9), "001001001");
  assert.equal(plays("5:8"), "00001000");
});

test("fill and !fill follow the button, first and !first the pass", () => {
  assert.equal(condPasses("fill", 0, false), false);
  assert.equal(condPasses("fill", 0, true), true);
  assert.equal(condPasses("!fill", 3, false), true);
  assert.equal(condPasses("!fill", 3, true), false);
  assert.equal(condPasses("first", 0, false), true);
  assert.equal(condPasses("first", 1, false), false);
  assert.equal(condPasses("!first", 0, false), false);
  assert.equal(condPasses("!first", 5, false), true);
});

test("every condition the editor offers is valid, labelled and normalizes to itself", () => {
  for (const c of TRIG_CONDS) {
    assert.equal(isTrigCond(c), true, c);
    assert.equal(normalizeCond(c), c);
    assert.ok(trigCondLabel(c).length > 0);
  }
  assert.equal(new Set(TRIG_CONDS).size, TRIG_CONDS.length);
});

test("an unreadable condition is none, and plays", () => {
  for (const bad of ["3:2", "0:4", "9:9", "sometimes", "1/2", null, undefined, 5]) {
    assert.equal(normalizeCond(bad), "", String(bad));
  }
  assert.equal(isTrigCond("3:2"), false);
  assert.equal(isTrigCond(undefined), false);
  assert.equal(condPasses("garbage", 2, false), true);
});

test("probability is clamped, and an unreadable one is always", () => {
  assert.equal(normalizeProb(undefined), 1);
  assert.equal(normalizeProb(null), 1);
  assert.equal(normalizeProb("x"), 1);
  assert.equal(normalizeProb(-1), 0);
  assert.equal(normalizeProb(3), 1);
  assert.equal(normalizeProb(0.25), 0.25);
  assert.equal(stepFires({ prob: 0, pass: 4 }), false);
});

test("the dice are deterministic, and land near the probability", () => {
  assert.equal(trigRoll(11, 3, 5), trigRoll(11, 3, 5));
  for (const prob of [0.1, 0.25, 0.5, 0.75, 0.9]) {
    let hits = 0;
    const n = 4000;
    for (let pass = 0; pass < n; pass++) if (stepFires({ prob, pass, step: 6, seed: 3 })) hits++;
    assert.ok(Math.abs(hits / n - prob) < 0.03, `${prob}: ${hits / n}`);
  }
});

test("a step differs pass to pass, and two steps and two tracks do not move together", () => {
  const row = (seed, step) => Array.from({ length: 64 }, (_, pass) => stepFires({ prob: 0.5, pass, step, seed }) ? 1 : 0).join("");
  const a = row(1, 0);
  assert.ok(a.includes("0") && a.includes("1"));
  assert.notEqual(a, row(1, 1));
  assert.notEqual(a, row(2, 0));
  // no short period hiding in the low bits
  for (const period of [2, 4, 8, 16]) assert.notEqual(a.slice(0, 32), a.slice(period, 32 + period));
});

test("the condition is asked before the dice: a 1:2 step at 50% never plays on pass two", () => {
  for (let pass = 1; pass < 200; pass += 2) assert.equal(stepFires({ prob: 0.5, cond: "1:2", pass, step: 2, seed: 9 }), false);
  let hits = 0;
  for (let pass = 0; pass < 2000; pass += 2) if (stepFires({ prob: 0.5, cond: "1:2", pass, step: 2, seed: 9 })) hits++;
  assert.ok(hits > 400 && hits < 600, String(hits));
});

test("the grid's mark says what decides the step", () => {
  assert.equal(hasTrig(1, ""), false);
  assert.equal(hasTrig(undefined, undefined), false);
  assert.equal(hasTrig(0.5, ""), true);
  assert.equal(hasTrig(1, "fill"), true);
  assert.equal(trigMark(0.5, ""), "50%");
  assert.equal(trigMark(1, "1:2"), "1:2");
  assert.equal(trigMark(1, "fill"), "F");
  assert.equal(trigMark(0.25, "!fill"), "!F 25%");
});
