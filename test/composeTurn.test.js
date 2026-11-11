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
  assert.equal(unfinished(ctx, before, 3, "make it bebop"), null);
});
