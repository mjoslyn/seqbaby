import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyPerform, performIsEmpty, readPerform, serializePerform } from "../public/js/performStore.js";

const live = {
  pins: [{ trackId: 7, key: "cutoff" }, { trackId: 9, key: "fx.delay" }, { trackId: 99, key: "gone" }],
  scenes: [{
    id: 1, name: "drop", pattern: 3,
    tracks: [{ trackId: 7, muted: true, soloed: false }, { trackId: 9, muted: false, soloed: true }, { trackId: 99 }],
    knobs: [{ trackId: 7, key: "cutoff", unit: 0.25 }, { trackId: 9, key: "fx.delay", unit: 2 }],
  }],
};
const idx = new Map([[7, 0], [9, 1]]);

test("serialize writes indices and drops references to tracks that are gone", () => {
  const s = serializePerform(live, idx);
  assert.deepEqual(s.pins, [{ track: 0, key: "cutoff" }, { track: 1, key: "fx.delay" }]);
  assert.equal(s.scenes.length, 1);
  assert.equal(s.scenes[0].name, "drop");
  assert.equal(s.scenes[0].pattern, 3);
  assert.deepEqual(s.scenes[0].tracks, [{ track: 0, muted: true, soloed: false }, { track: 1, muted: false, soloed: true }]);
  // a unit is clamped on the way out, so a hand-edited song cannot ask for 200%
  assert.deepEqual(s.scenes[0].knobs, [{ track: 0, key: "cutoff", unit: 0.25 }, { track: 1, key: "fx.delay", unit: 1 }]);
  assert.ok(!("id" in s.scenes[0]));
});

test("read resolves indices against the order given, and round-trips", () => {
  const s = serializePerform(live, idx);
  let n = 10;
  const back = readPerform(s, [7, 9], () => n++);
  assert.deepEqual(back.pins, [{ trackId: 7, key: "cutoff" }, { trackId: 9, key: "fx.delay" }]);
  assert.equal(back.scenes[0].id, 10);
  assert.deepEqual(back.scenes[0].tracks, live.scenes[0].tracks.slice(0, 2));
  assert.deepEqual(back.scenes[0].knobs[0], { trackId: 7, key: "cutoff", unit: 0.25 });
  // the order is the FILE's: a bus moved to the bottom since does not move a pin
  const moved = readPerform(s, [9, 7], () => 1);
  assert.equal(moved.pins[0].trackId, 9);
  assert.deepEqual(serializePerform(back, idx), s);
});

test("read tolerates garbage and an index past the end", () => {
  assert.deepEqual(readPerform(null, [], () => 1), emptyPerform());
  assert.deepEqual(readPerform("nope", [], () => 1), emptyPerform());
  const r = readPerform({ pins: [{ track: 4, key: "cutoff" }, { track: 0 }, null, { track: 0, key: "vol" }, { track: 0, key: "vol" }],
                          scenes: [null, 5, { tracks: "x", knobs: [{ track: 0, key: 3 }] }] }, [1], () => 1);
  assert.deepEqual(r.pins, [{ trackId: 1, key: "vol" }]);
  assert.equal(r.scenes.length, 1);
  assert.equal(r.scenes[0].name, "scene 1");
  assert.deepEqual(r.scenes[0].knobs, []);
});

test("performIsEmpty", () => {
  assert.equal(performIsEmpty(undefined), true);
  assert.equal(performIsEmpty({ pins: [], scenes: [] }), true);
  assert.equal(performIsEmpty({ pins: [{ track: 0, key: "vol" }], scenes: [] }), false);
});
