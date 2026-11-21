// When a compose turn may stop: unfinished() sends a turn back that stopped
// short of what it was asked for.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as sb from "../public/js/songBuilder.js";
import { newCtx, resultText, runTool, unfinished } from "../mcp/composeTurn.mjs";

const starter = () => {
  const song = sb.newSong({ bpm: 120 });
  sb.addTrack(song, { engine: "dm:808-kick", name: "kick" });
  sb.addTrack(song, { engine: "dm:silverbox", name: "bass" });
  return JSON.parse(JSON.stringify(song));
};

test("asked to build, changing nothing is sent back", () => {
  const ctx = newCtx(starter());
  const before = JSON.stringify(ctx.song);
  assert.match(unfinished(ctx, before, 0, "Build a complete bebop song"), /haven't changed/);
});

test("a question that changes nothing may stop", () => {
  const ctx = newCtx(starter());
  assert.equal(unfinished(ctx, JSON.stringify(ctx.song), 0, "what key is this in?"), null);
});

test("silent tracks after editing are sent back, a finished song is not", () => {
  const ctx = newCtx(starter());
  const before = JSON.stringify(ctx.song);
  sb.setTempo(ctx.song, { bpm: 200 });
  assert.match(unfinished(ctx, before, 1, "make it bebop"), /silent/);
  sb.setSteps(ctx.song, 0, { steps: "x...x...x...x..." });
  sb.setSteps(ctx.song, 1, { steps: "x.x.x.x.x.x.x.x." });
  // Once it plays, the production check sends it back once, and only once.
  assert.match(unfinished(ctx, before, 3, "make it bebop"), /production check/);
  assert.equal(unfinished(ctx, before, 4, "make it bebop"), null);
});

test("a song with nothing to fix passes the production check", () => {
  const ctx = newCtx(starter());
  const before = JSON.stringify(ctx.song);
  sb.setTempo(ctx.song, { bpm: 124, swing: 0.12 });
  sb.setSteps(ctx.song, 0, { steps: "x...x...x...x..." });
  sb.setSteps(ctx.song, 1, { steps: "X.x_o.X_..x.Xo.." });
  sb.setFx(ctx.song, 1, "delay", { wet: 0.2 });
  // a bass on the kick's steps wants ducking under it
  assert.match(sb.productionNotes(ctx.song).join("\n"), /no sidechain/);
  sb.setComp(ctx.song, 1, { source: 0, threshold: -24 });
  assert.deepEqual(sb.productionNotes(ctx.song), []);
  assert.equal(unfinished(ctx, before, 3, "make it acid"), null);
});

test("the big lookups are sent tighter than they are returned, with nothing dropped", () => {
  const ctx = newCtx(null);
  const full = runTool(ctx, "describe_engine", { engine: "dm:breath" }).result;
  const text = resultText("describe_engine", full);
  assert.ok(text.length < JSON.stringify(full).length * 0.75, "describe_engine is not smaller");
  const slim = JSON.parse(text);
  // every panel control, every preset, and this engine's own targets survive
  for (const c of full.panel.numeric) assert.ok(text.includes(c.key), c.key);
  for (const c of full.panel.select) assert.ok(text.includes(c.key), c.key);
  assert.deepEqual(slim.presets, full.presets);
  assert.deepEqual(slim.sliders, full.sliders);
  for (const k of ["harm", "breath_growl"]) assert.ok(slim.lfoTargets.split(" ").includes(k), k);
  assert.ok(slim.automationTargets.split(" ").includes("breath.fall"));
  assert.ok(!slim.lfoTargets.split(" ").includes("delay"), "a target every track has is said once, in the note");
  assert.match(slim.targetsNote, /every fx key/);
  // a sampler still lists its samples
  assert.ok(resultText("describe_engine", runTool(ctx, "describe_engine", { engine: "sampler" }).result).includes("salamander/snare"));
  // the lists keep every key
  const engines = runTool(ctx, "list_engines", {}).result;
  const lines = resultText("list_engines", engines).split("\n");
  assert.equal(lines.length, engines.length);
  assert.ok(lines.some(l => l.startsWith("dm:breath ") && l.includes("tuba")));
  const genres = runTool(ctx, "list_genres", {}).result;
  const g = resultText("list_genres", genres);
  assert.ok(g.length < JSON.stringify(genres).length / 2);
  for (const x of genres) assert.ok(g.includes(x.id), x.id);
  // everything else is the result as it is
  assert.equal(resultText("add_track", { index: 0 }), '{"index":0}');
  assert.equal(resultText("x", "plain"), "plain");
});
