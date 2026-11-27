// The sampler's trigger / gate switch: how long a hit sounds.
import test from "node:test";
import assert from "node:assert/strict";
import { samplePlayMode, startSampleSource } from "../public/js/buffers.js";
import * as sb from "../public/js/songBuilder.js";

const ctx = { createBufferSource: () => ({ playbackRate: { value: 1 }, start() {} }) };
const buffer = { duration: 2 };
const len = (dur, opts) => +(startSampleSource(ctx, buffer, 1, 10, dur, opts).stopTime - 10).toFixed(3);

test("trigger plays the whole region, gate stops with the note, unset is the old rule", () => {
  assert.equal(len(0.1, { playMode: "trigger" }), 2);
  assert.equal(len(0.1, { playMode: "trigger", startOffset: 0.5 }), 1, "the region, not the file");
  assert.equal(len(0.25, { playMode: "gate" }), 0.25);
  assert.equal(len(0.25, { playMode: "gate", isDrumKit: true }), 0.25, "a drum kit too");
  assert.equal(len(5, { playMode: "gate" }), 2, "never past the sample's end");
  assert.equal(len(0.25, {}), 0.25);
  assert.equal(len(0.25, { isDrumKit: true }), 0.75, "an untouched drum kit rings half a second on");
  assert.equal(len(0.25, { playMode: "trigger", loopMode: "loop" }), 0.25, "a loop still stops with its note");
  assert.equal(len(0.1, { playMode: "trigger", }), len(0.1, { playMode: "trigger", isDrumKit: true }));
});

test("the switch shows what an untouched track does", () => {
  assert.equal(samplePlayMode({ isDrumKit: true, sampleDefaults: {} }), "trigger");
  assert.equal(samplePlayMode({ isDrumKit: false }), "gate");
  assert.equal(samplePlayMode({ isDrumKit: true, sampleDefaults: { play: "gate" } }), "gate");
});

test("the builder sets it on a sampler and refuses it elsewhere", () => {
  const song = sb.newSong();
  const a = sb.addTrack(song, { engine: "sampler", sample: "techno kick" }).index;
  const b = sb.addTrack(song, { engine: "silverbox" }).index;
  sb.setTrack(song, a, { samplePlay: "gate" });
  assert.equal(song.tracks[a].sampleDefaults.play, "gate");
  assert.throws(() => sb.setTrack(song, b, { samplePlay: "gate" }), /sampler/);
  assert.throws(() => sb.setTrack(song, a, { samplePlay: "hold" }), /trigger/);
});
