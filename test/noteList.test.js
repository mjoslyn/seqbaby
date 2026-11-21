// A list of notes sent as a string: what a model does now and then.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as sb from "../public/js/songBuilder.js";
import { TOOLS } from "../mcp/tools.mjs";

const bass = () => {
  const s = sb.newSong({ bpm: 120 });
  sb.addTrack(s, { engine: "dm:sub", name: "bass" });
  sb.setSteps(s, 0, { steps: "x.x.x.x.x.x.x.x." });
  return s;
};
const hits = (s) => s.tracks[0].patterns[0].notes.filter((n, i) => s.tracks[0].patterns[0].steps[i]);

test("a JSON array written as a string is a list", () => {
  const s = bass();
  sb.setNotes(s, 0, { notes: '["Db2", "Db2", "Ab1", "Db2", "F2", "Ab2", "F2", "Eb2"]' });
  assert.deepEqual(hits(s), [37, 37, 32, 37, 41, 44, 41, 39]);
});

test("names split by spaces or commas are a list; one name is one note", () => {
  const s = bass();
  sb.setNotes(s, 0, { notes: "C2 Eb2, G2" });
  assert.deepEqual(hits(s).slice(0, 3), [36, 39, 43]);
  sb.setNotes(s, 0, { notes: "F2" });
  assert.ok(hits(s).every((n) => n === 41));
  assert.deepEqual(sb.noteList("[C2, 'D2', null]"), ["C2", "D2", null]);
});

test("the tools take the string form too", () => {
  const ctx = { song: bass() };
  const steps = TOOLS.find((t) => t.name === "set_steps");
  const args = { track: 0, steps: "x.x.x.x.", notes: '["C2", "G1"]' };
  for (const [k, schema] of Object.entries(steps.inputSchema)) assert.ok(schema.safeParse(args[k]).success, k);
  steps.handler(ctx, args);
  assert.deepEqual(hits(ctx.song).slice(0, 2), [36, 31]);
  sb.setStep(ctx.song, 0, { step: 0, extraNotes: '["E2", "G2"]' });
  assert.deepEqual(ctx.song.tracks[0].patterns[0].extraNotes[0], [40, 43]);
});
