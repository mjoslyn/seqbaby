// When a compose turn may stop: unfinished() sends a turn back that stopped
// short of what it was asked for.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as sb from "../public/js/songBuilder.js";
import { newCtx, unfinished } from "../mcp/composeTurn.mjs";

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
  assert.deepEqual(sb.productionNotes(ctx.song), []);
  assert.equal(unfinished(ctx, before, 3, "make it acid"), null);
});
