// Tests for the piano view's note model: a pattern's step arrays read as a
// free list of notes and folded back. Run with `npm test`.

import test from "node:test";
import assert from "node:assert/strict";
import { BLANK_STEP, NOTE_STEP_KEYS, pitchesAt, readNotes, writeNotes } from "../public/js/rollNotes.js";

function pattern(len) {
  const p = {};
  for (const k of ["steps", ...NOTE_STEP_KEYS]) p[k] = new Array(len).fill(BLANK_STEP[k]);
  return p;
}

test("reads roots and extras, extras capped at the root", () => {
  const p = pattern(16);
  p.steps[0] = 1; p.notes[0] = 60; p.lengths[0] = 4; p.velocities[0] = 0.8;
  p.extraNotes[0] = [64, 67]; p.extraLengths[0] = [2, 9];
  p.steps[8] = 1; p.notes[8] = 48; p.lengths[8] = 1; p.chords[8] = "min";
  const n = readNotes(p);
  assert.deepEqual(n.map((x) => [x.start, x.len, x.pitch, x.root]), [
    [0, 4, 60, true], [0, 2, 64, false], [0, 4, 67, false], [8, 1, 48, true],
  ]);
  assert.equal(n[1].vel, 0.8);
  assert.equal(n[3].chord, "min");
});

test("a round trip changes nothing", () => {
  const p = pattern(16);
  p.steps[2] = 1; p.notes[2] = 62; p.lengths[2] = 3; p.velocities[2] = 0.3; p.ratchets[2] = 3; p.offsets[2] = 0.25;
  p.extraNotes[2] = [65]; p.extraLengths[2] = [1];
  p.steps[9] = 1; p.notes[9] = 57; p.lengths[9] = 1; p.chords[9] = "maj7"; p.arps[9] = true;
  const before = JSON.parse(JSON.stringify(p));
  writeNotes(p, readNotes(p));
  assert.deepEqual(p, before);
});

test("writing keeps the same arrays (a track's are aliases)", () => {
  const p = pattern(8);
  const steps = p.steps, notes = p.notes;
  writeNotes(p, [{ start: 1, len: 2, pitch: 60, vel: 1 }]);
  assert.equal(p.steps, steps);
  assert.equal(p.notes, notes);
  assert.equal(p.steps[1], 1);
  assert.equal(p.lengths[1], 2);
});

test("a moved note carries its step's fields; its old step is blank", () => {
  const p = pattern(16);
  p.steps[0] = 1; p.notes[0] = 60; p.lengths[0] = 1; p.ratchets[0] = 4; p.chords[0] = "min";
  const n = readNotes(p);
  n[0].start = 5; n[0].pitch = 62;
  writeNotes(p, n);
  assert.equal(p.steps[0], 0);
  assert.equal(p.ratchets[0], 1);
  assert.equal(p.chords[0], "");
  assert.equal(p.steps[5], 1);
  assert.equal(p.notes[5], 62);
  assert.equal(p.ratchets[5], 4);
  assert.equal(p.chords[5], "min");
});

test("notes on one step stack: the longest is the root", () => {
  const p = pattern(16);
  writeNotes(p, [{ start: 4, len: 1, pitch: 72, vel: 0.5 }, { start: 4, len: 3, pitch: 60, vel: 0.9 }]);
  assert.equal(p.notes[4], 60);
  assert.equal(p.lengths[4], 3);
  assert.equal(p.velocities[4], 0.9);
  assert.deepEqual(p.extraNotes[4], [72]);
  assert.deepEqual(p.extraLengths[4], [1]);
});

test("a chord's root stays the root, extras clamped to it", () => {
  const p = pattern(16);
  writeNotes(p, [{ start: 0, len: 2, pitch: 48, chord: "min", root: true }, { start: 0, len: 6, pitch: 72 }]);
  assert.equal(p.notes[0], 48);
  assert.equal(p.chords[0], "min");
  assert.deepEqual(p.extraLengths[0], [2]);
});

test("a note is cut at the next anchor and at the end", () => {
  const p = pattern(8);
  const out = writeNotes(p, [{ start: 0, len: 8, pitch: 60 }, { start: 3, len: 9, pitch: 64 }, { start: 12, len: 1, pitch: 50 }]);
  assert.deepEqual(out.map((x) => [x.start, x.len]), [[0, 3], [3, 5]]);
});

test("duplicates on one step and pitch merge into the longer", () => {
  const p = pattern(8);
  const out = writeNotes(p, [{ start: 2, len: 1, pitch: 60 }, { start: 2, len: 4, pitch: 60 }]);
  assert.deepEqual(out.map((x) => [x.start, x.len, x.root]), [[2, 4, true]]);
});

test("pitchesAt", () => {
  const n = [{ start: 0, len: 4, pitch: 60 }, { start: 2, len: 1, pitch: 64 }];
  assert.deepEqual(pitchesAt(n, 2), [60, 64]);
  assert.deepEqual(pitchesAt(n, 3), [60]);
  assert.deepEqual(pitchesAt(n, 4), []);
});

test("a fresh chord root writes its chord and inversion", () => {
  const p = pattern(8);
  writeNotes(p, [{ start: 2, len: 2, pitch: 60, chord: "min7", cpx: 1 }]);
  assert.equal(p.chords[2], "min7");
  assert.equal(p.complexities[2], 1);
  const back = readNotes(p);
  assert.equal(back[0].cpx, 1);
  writeNotes(p, [{ ...back[0], chord: "" }]);
  assert.equal(p.complexities[2], 0);
});
