import test from "node:test";
import assert from "node:assert/strict";
import { applyPerf, clockLabel, diffPerf, eventIndexAt, secondsAtStep, stepAtSeconds, summarizeRecording, validateRecording } from "../public/js/setFormat.js";

const rec = () => ({
  _set: 1, bpm: 124, steps: 32, seconds: 4,
  start: { session: { tracks: [] }, decks: [{ id: "b", session: { tracks: [] } }] },
  events: [[0, 0, "perf", {}], [3, 0.25, "ctl", {}], [3, 0.5, "deck", { id: "c" }]],
});

test("a recording is checked before it is stored or played", () => {
  assert.ok(validateRecording(rec()).ok);
  assert.equal(validateRecording(null).ok, false);
  assert.match(validateRecording({ ...rec(), _set: 9 }).errors[0], /newer/);
  assert.match(validateRecording({ ...rec(), events: [[1, 0, "x", {}], [0, 0, "x", {}]] }).errors.join(), /out of order/);
  assert.match(validateRecording({ ...rec(), events: [[1, 2, "x", {}]] }).errors.join(), /frac/);
  assert.match(validateRecording({ ...rec(), start: { session: { tracks: "no" } } }).errors.join(), /tracks/);
});

test("a summary counts the decks loaded at the start and on the way", () => {
  assert.deepEqual(summarizeRecording(rec()), { seconds: 4, steps: 32, events: 3, decks: 2, bpm: 124 });
});

test("the perf diff writes only what moved, and lays back over the state it came from", () => {
  const a = { scene: 0, tracks: { "a:0": { slot: 0, off: false }, "a:1": { slot: 0, off: false } }, mix: null };
  const b = { scene: 1, tracks: { "a:0": { slot: 1, off: false }, "a:1": { slot: 0, off: false } }, mix: { x: 0.5 } };
  const d = diffPerf(a, b);
  assert.deepEqual(d, { scene: 1, tracks: { "a:0": { slot: 1 } }, mix: { x: 0.5 } });
  assert.deepEqual(applyPerf(a, d), b);
  assert.equal(diffPerf(b, JSON.parse(JSON.stringify(b))), null);
  const c = { scene: 1, tracks: { "a:0": { slot: 1, off: false } }, mix: { x: 0.5 } };
  assert.deepEqual(applyPerf(b, diffPerf(b, c)), c);
});

test("steps and seconds map both ways through the marks", () => {
  const marks = [[0, 0], [16, 2], [32, 3]];
  assert.equal(secondsAtStep(marks, 8), 1);
  assert.equal(secondsAtStep(marks, 24), 2.5);
  assert.equal(secondsAtStep(marks, 40), 3.5);
  assert.equal(stepAtSeconds(marks, 2.5), 24);
  assert.equal(eventIndexAt(rec().events, 3), 1);
  assert.equal(eventIndexAt(rec().events, 4), 3);
  assert.equal(clockLabel(3725), "1:02:05");
  assert.equal(clockLabel(65), "1:05");
});

import * as server from "../lib/setRecording.js";

test("the server reads a recording as the engine does", () => {
  const cases = [rec(), null, { ...rec(), _set: 9 }, { ...rec(), events: [[1, 0, "x", {}], [0, 0, "x", {}]] }, { ...rec(), steps: -1 }, { ...rec(), events: "no" }];
  for (const c of cases) {
    assert.equal(server.checkRecording(c).ok, validateRecording(c).ok, JSON.stringify(c)?.slice(0, 80));
  }
  assert.deepEqual(server.recordingSummary(rec()), summarizeRecording(rec()));
  assert.equal(server.clockLabel(3725), clockLabel(3725));
});

test("the fill button is a sampled field: its press and its release are each one diff", () => {
  const off = { scene: 0, fill: false, tracks: {}, mix: null };
  const on = { ...off, fill: true };
  assert.equal(diffPerf(off, off), null);
  assert.deepEqual(diffPerf(off, on), { fill: true });
  assert.deepEqual(diffPerf(on, off), { fill: false });
  assert.equal(applyPerf(off, { fill: true }).fill, true);
  // a set recorded before the fill was sampled: nothing to write back
  assert.equal("fill" in applyPerf({ scene: 0, tracks: {}, mix: null }, { scene: 1 }), false);
});
