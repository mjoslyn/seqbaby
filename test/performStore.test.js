import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyPerform, performIsEmpty, readPerform, serializePerform } from "../public/js/performStore.js";

const live = {
  scenes: [{
    id: 1, name: "drop", pattern: 3,
    tracks: [
      { trackId: 7, muted: true, soloed: false, out: 11 },
      { trackId: 9, muted: false, soloed: true, out: null },
      { trackId: 11, muted: false, soloed: false, out: null },
      { trackId: 99 },
    ],
  }],
};
const idx = new Map([[7, 0], [9, 1], [11, 2]]);

test("serialize writes indices and drops references to tracks that are gone", () => {
  const s = serializePerform(live, idx);
  assert.equal(s.scenes.length, 1);
  assert.equal(s.scenes[0].name, "drop");
  assert.equal(s.scenes[0].pattern, 3);
  assert.deepEqual(s.scenes[0].tracks, [
    { track: 0, muted: true, soloed: false, outTrack: 2 },
    { track: 1, muted: false, soloed: true, outTrack: null },
    { track: 2, muted: false, soloed: false, outTrack: null },
  ]);
  assert.ok(!("id" in s.scenes[0]));
});

test("read resolves indices against the order given, and round-trips", () => {
  const s = serializePerform(live, idx);
  let n = 10;
  const back = readPerform(s, [7, 9, 11], () => n++);
  assert.equal(back.scenes[0].id, 10);
  assert.deepEqual(back.scenes[0].tracks, live.scenes[0].tracks.slice(0, 3));
  // the order is the FILE's: a bus moved to the bottom since does not move a send
  const moved = readPerform(s, [11, 9, 7], () => 1);
  assert.deepEqual(moved.scenes[0].tracks[0], { trackId: 11, muted: true, soloed: false, out: 7 });
  assert.deepEqual(serializePerform(back, idx), s);
});

test("read tolerates garbage and an index past the end", () => {
  assert.deepEqual(readPerform(null, [], () => 1), emptyPerform());
  assert.deepEqual(readPerform("nope", [], () => 1), emptyPerform());
  const r = readPerform({ scenes: [null, 5, { tracks: "x" }, { tracks: [{ track: 4 }, { track: 0, outTrack: 9 }, null] }] }, [1], () => 1);
  assert.equal(r.scenes.length, 2);
  assert.equal(r.scenes[0].name, "scene 1");
  assert.deepEqual(r.scenes[1].tracks, [{ trackId: 1, muted: false, soloed: false, out: null }]);
});

test("performIsEmpty", () => {
  assert.equal(performIsEmpty(undefined), true);
  assert.equal(performIsEmpty({ scenes: [] }), true);
  assert.equal(performIsEmpty({ scenes: [{ name: "a" }] }), false);
});
