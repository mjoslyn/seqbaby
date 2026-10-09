import test from "node:test";
import assert from "node:assert/strict";
import { extractSamples, restoreSamples, sampleRefs } from "../app/songs/sampleStore.js";

const session = () => ({
  bpm: 120,
  tracks: [
    { name: "kick", uploadAudio: "AAAA", uploadAudioMime: "audio/wav" },
    { name: "same", uploadAudio: "AAAA" },
    { name: "old", elevenAudio: "BBBB" },
    { name: "none", uploadAudio: null },
  ],
});

test("payloads leave the session, once each, and come back exactly", () => {
  const full = session();
  const { data, samples } = extractSamples(full);
  assert.equal(samples.size, 2);
  assert.ok(!JSON.stringify(data).includes("AAAA"));
  assert.equal(sampleRefs(data).length, 2);
  assert.deepEqual(restoreSamples(data, samples), full);
  assert.deepEqual(full, session(), "the input is not touched");
});

test("a stored session extracts to itself, so storing twice is safe", () => {
  const { data } = extractSamples(session());
  const again = extractSamples(data);
  assert.equal(again.samples.size, 0);
  assert.deepEqual(again.data, data);
});

test("a marker with nothing behind it loads as no sample", () => {
  const { data } = extractSamples(session());
  const back = restoreSamples(data, new Map());
  assert.equal(back.tracks[0].uploadAudio, null);
});

test("a session with no samples, or no tracks, passes through", () => {
  for (const d of [{ bpm: 90, tracks: [{ name: "a" }] }, {}, null, "junk"]) {
    assert.deepEqual(extractSamples(d).data, d);
    assert.equal(restoreSamples(d, new Map()), d);
  }
});
