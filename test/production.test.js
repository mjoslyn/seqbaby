// The production check: what makes a sequenced song sound like a video game.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as sb from "../public/js/songBuilder.js";

const song = () => {
  const s = sb.newSong({ bpm: 120 });
  sb.addTrack(s, { engine: "dm:808-kick", name: "kick" });
  sb.addTrack(s, { engine: "plaits:0", name: "lead" });
  sb.addTrack(s, { engine: "plaits:12", name: "hook" });
  sb.setSteps(s, 0, { steps: "x...x...x...x..." });
  sb.setSteps(s, 1, { steps: "xxxxxxxxxxxxxxxx" });
  sb.setSteps(s, 2, { steps: "xxxxxxxxxxxxxxxx" });
  return s;
};

test("names each habit, on the track that has it", () => {
  const n = sb.validate(song()).production.join("\n");
  assert.match(n, /track 1 \(lead\): all 16 hits are the same velocity/);
  assert.match(n, /track 1 \(lead\): every note is one step long/);
  assert.match(n, /track 1 \(lead\): plays 16 steps without a rest/);
  assert.match(n, /plaits:0 is a bare oscillator/);
  assert.match(n, /plaits:12 \(modal\) plays 16 notes/);
  assert.match(n, /no track has reverb or delay/);
  assert.match(n, /nothing is off the grid/);
  assert.doesNotMatch(n, /track 0/, "a kick may be one velocity");
});

test("each fix clears its note", () => {
  const s = song();
  sb.setSteps(s, 1, { steps: "X.o_x...X_o.x..." });
  sb.setSteps(s, 2, { steps: "x.......x......." });
  sb.setFilter(s, 1, { cutoff: 0.4, env: 0.5 });
  sb.setFx(s, 1, "reverb", { wet: 0.2 });
  sb.setTempo(s, { swing: 0.1 });
  assert.deepEqual(sb.productionNotes(s), []);
});

test("it is advice: a song full of notes still validates", () => {
  const v = sb.validate(song());
  assert.ok(v.ok && v.production.length > 0);
});

test("a synth sitting in octave 5 is told to come down", () => {
  const s = sb.newSong({ bpm: 120 });
  sb.addTrack(s, { engine: "dm:ladder", name: "lead" });
  sb.setSteps(s, 0, { steps: "x.x.x.x.x.x.x.x.", notes: ["D#5", "F#5", "F5", "G#5", "A#5", "F#5", "F5", "D#5"] });
  assert.match(sb.productionNotes(s).join("\n"), /lead\): its notes sit around (D#5|F5|F#5)/);
  sb.setSteps(s, 0, { steps: "x.x.x.x.x.x.x.x.", notes: ["D#4", "F#4", "F4", "G#4", "A#4", "F#4", "F4", "D#4"] });
  assert.doesNotMatch(sb.productionNotes(s).join("\n"), /sit around/);
});
