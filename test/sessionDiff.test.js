// What a compose turn changed, read off the session sent and the one that
// came back (app/songs/sessionDiff.js): the review card's summary.
import test from "node:test";
import assert from "node:assert/strict";
import * as sb from "../public/js/songBuilder.js";
import { diffSessions, diffHeadline, engineName } from "../app/songs/sessionDiff.js";

const blob = (song) => JSON.parse(JSON.stringify(song));
function base() {
  const song = sb.newSong();
  sb.setTempo(song, { bpm: 120 });
  sb.addTrack(song, { engine: "dm:siege", name: "kick" });
  sb.addTrack(song, { engine: "dm:silverbox", name: "bass" });
  sb.setSteps(song, 0, { steps: "x...x...x...x..." });
  return song;
}

test("the same session, or one with its keys in another order, is no change", () => {
  const a = blob(base());
  const b = blob(base());
  b.tracks[0] = Object.fromEntries(Object.entries(b.tracks[0]).reverse());
  const d = diffSessions(a, b);
  assert.equal(d.empty, true);
  assert.equal(diffHeadline(d), "");
});

test("a track added, a part written, a sound and the tempo moved", () => {
  const a = blob(base());
  const song = sb.fromBlob(blob(base()));
  sb.setTempo(song, { bpm: 128 });
  sb.addTrack(song, { engine: "dm:halo", name: "hats" });
  sb.setSteps(song, 2, { steps: "x.x.x.x.x.x.x.x." });
  sb.setSteps(song, 1, { steps: "x..x..x." });
  sb.setFilter(song, 1, { cutoff: 0.3 });
  sb.setFx(song, 0, "delay", { wet: 0.4 });
  const d = diffSessions(a, blob(song));
  assert.deepEqual(d.globals, ["120 → 128 bpm"]);
  const by = Object.fromEntries(d.tracks.map((t) => [t.name, t]));
  assert.equal(by.hats.kind, "added");
  assert.deepEqual(by.hats.parts, ["pattern 1"]);
  assert.deepEqual(by.bass.parts, ["wrote pattern 1", "filter"]);
  assert.deepEqual(by.kick.parts, ["fx: delay"]);
  assert.equal(diffHeadline(d), "1 track added · 2 changed · 120 → 128 bpm");
});

test("edited and cleared patterns, a second section, chain mode", () => {
  const a = blob(base());
  const song = sb.fromBlob(blob(base()));
  sb.setSteps(song, 0, { steps: "x.x.x...x...x..." });
  sb.setSteps(song, 0, { pattern: 1, steps: "x...x..." });
  sb.setArrangement(song, { mode: "chain" });
  const d = diffSessions(a, blob(song));
  assert.deepEqual(d.tracks[0].parts, ["wrote pattern 2", "notes in pattern 1"]);
  assert.ok(d.globals.includes("chains its patterns"));
  assert.ok(d.globals.includes("1 → 2 patterns"));
});

test("a removed track, a rename, and a song written from nothing", () => {
  const a = blob(base());
  const b = blob(base());
  b.tracks.pop();
  b.tracks[0].name = "boom";
  const d = diffSessions(a, b);
  assert.equal(d.removed, 1);
  assert.deepEqual(d.tracks.find((t) => t.kind === "changed").parts, ["renamed from kick"]);
  const fresh = diffSessions({ bpm: 120, tracks: [] }, a);
  assert.equal(fresh.added, 2);
  assert.equal(fresh.changed, 0);
});

test("never throws, and engines read as words", () => {
  assert.equal(diffSessions(null, undefined).empty, true);
  assert.equal(diffSessions({ tracks: [null, 3] }, { tracks: "no" }).empty, true);
  assert.equal(engineName("dm:silverbox"), "silverbox");
  assert.equal(engineName("plaits:0"), "plaits");
  assert.equal(engineName("inst:guitar-acoustic"), "guitar acoustic");
});
