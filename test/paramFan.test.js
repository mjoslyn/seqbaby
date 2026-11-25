// One parameter across a pool of voices (public/js/paramHold.js): the pool
// ties its voices' copies together, and an LFO or a lane reaches each.
import test from "node:test";
import assert from "node:assert/strict";
import { fanOf, tieParams } from "../public/js/paramHold.js";

test("an untied param is itself alone, and nothing is nothing", () => {
  const p = { value: 0 };
  assert.deepEqual(fanOf(p), [p]);
  assert.deepEqual(fanOf(null), []);
  assert.deepEqual(fanOf(undefined), []);
});

test("tying returns the first and fans out to every voice's copy, once each", () => {
  const a = {}, b = {}, c = {}, d = {};
  assert.equal(tieParams(a, [b, c, d]), a);
  assert.deepEqual(fanOf(a), [a, b, c, d]);
  // missing copies (a voice without that param) and the first itself are left out
  tieParams(a, [null, b, a, undefined]);
  assert.deepEqual(fanOf(a), [a, b]);
  // the others are not tied back: whoever holds one of them holds one voice
  assert.deepEqual(fanOf(b), [b]);
});

test("a pool of one, or a re-tie with nothing, unties", () => {
  const a = {}, b = {};
  tieParams(a, [b]);
  tieParams(a, []);
  assert.deepEqual(fanOf(a), [a]);
  assert.equal(tieParams(null, [b]), null);
});
