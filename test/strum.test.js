// The strum: when each note of a step's stack starts (theoryData.js), shared by
// the transport and the computer keyboard's chord mode.
import { test } from "node:test";
import assert from "node:assert/strict";
import { strumOffsets } from "../public/js/theoryData.js";
import * as sb from "../public/js/songBuilder.js";

const near = (a, b) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-9, `${a} vs ${b}`));

test("no strum, or one note, is a block chord", () => {
  assert.deepEqual(strumOffsets([60, 64, 67], 0, 1), [0, 0, 0]);
  assert.deepEqual(strumOffsets([60], 30, 1), [0]);
  assert.deepEqual(strumOffsets([60, 64, 67], undefined, 1), [0, 0, 0]);
});

test("up strums low to high, down high to low, by pitch not by list order", () => {
  // An inversion lists the root above the third: the order is the pitch's.
  near(strumOffsets([72, 64, 67], 20, 1), [0.04, 0, 0.02]);
  near(strumOffsets([72, 64, 67], -20, 1), [0, 0.04, 0.02]);
});

test("a slow strum on a short step still lands inside it", () => {
  const span = 0.1;   // a sixteenth at 150bpm
  const off = strumOffsets([48, 52, 55, 60, 64], 80, span);
  assert.ok(Math.max(...off) <= span * 0.75 + 1e-9);
  near(off, [0, 0.01875, 0.0375, 0.05625, 0.075]);
});

test("the song builder writes and reads a strum", () => {
  const song = sb.newSong();
  sb.addTrack(song, { engine: "dm:tines" });
  const step = sb.setStep(song, 0, { step: 0, on: true, note: "C3", chord: "maj", strum: -25 });
  assert.equal(step.strum, -25);
  assert.throws(() => sb.setStep(song, 0, { step: 0, strum: 200 }));
});

test("scalesFitting keeps only the scales that hold every note", async () => {
  const { scalesFitting } = await import("../public/js/theoryData.js");
  // C E G B: C major and its relatives fit, C minor does not.
  const fits = scalesFitting([0, 4, 7, 11]);
  assert.ok(fits[0].includes("major"));
  assert.ok(!fits[0].includes("minor"));
  assert.ok(fits[9].includes("minor"));     // A minor is C major's notes
  assert.deepEqual(fits[2].slice(0, 2), ["dorian", "mixolydian"]);
  assert.ok(!fits[1]);                       // nothing on C# holds them but a chromatic fill
  assert.ok(!fits[0].includes("chromatic"));
  // No notes yet: every scale at every root.
  assert.equal(Object.keys(scalesFitting([])).length, 12);
  // All twelve: only the chromatic fills.
  const all = scalesFitting([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  assert.deepEqual(all[0], ["12-tet", "24-tet", "chromatic"]);
});
