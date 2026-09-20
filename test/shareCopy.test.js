import test from "node:test";
import assert from "node:assert/strict";
import { songShareTitle, jamShareTitle } from "../app/shareCopy.js";

test("a shared song names who shared it and what", () => {
  assert.equal(songShareTitle("mike", "cold squelch"), 'mike has shared "cold squelch" with you');
});

test("a jam invite names who started it", () => {
  assert.equal(jamShareTitle("mike"), "mike has shared a jam with you");
});

test("nobody to name reads as someone, never as a hole", () => {
  assert.equal(songShareTitle(null, "cold squelch"), 'Someone has shared "cold squelch" with you');
  assert.equal(songShareTitle("   ", "cold squelch"), 'Someone has shared "cold squelch" with you');
  assert.equal(jamShareTitle(undefined), "Someone has shared a jam with you");
});

test("names and titles are trimmed, and a non-string never throws", () => {
  assert.equal(songShareTitle(" mike ", " cold squelch "), 'mike has shared "cold squelch" with you');
  assert.equal(songShareTitle(42, {}), 'Someone has shared "" with you');
  assert.equal(jamShareTitle(42), "Someone has shared a jam with you");
});
