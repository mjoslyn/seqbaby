// A song's tags as stored (lib/songTags.js), and a compose turn's genre as one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { TAGS_MAX, TAG_MAX_LEN, mergeTags, normalizeTag, normalizeTags } from "../lib/songTags.js";
import { genreTag } from "../mcp/tools.mjs";
import { newCtx, runTool } from "../mcp/composeTurn.mjs";

test("one spelling per tag", () => {
  assert.equal(normalizeTag("  Dub   Techno "), "dub techno");
  assert.equal(normalizeTag("#Late-Night"), "late-night");
  assert.equal(normalizeTag("a,b"), "a b");
  assert.equal(normalizeTag("<b>x</b>"), "b x /b");
  assert.equal(normalizeTag(7), "");
  assert.equal(normalizeTag("x".repeat(80)).length, TAG_MAX_LEN);
});

test("a list is distinct, in order, and bounded", () => {
  assert.deepEqual(normalizeTags(["Acid", "acid ", "", null, "House"]), ["acid", "house"]);
  assert.deepEqual(normalizeTags("acid"), []);
  assert.equal(normalizeTags(Array.from({ length: 30 }, (_, i) => `t${i}`)).length, TAGS_MAX);
  assert.deepEqual(mergeTags(["a", "b"], ["B", "c"]), ["a", "b", "c"]);
});

test("a turn's genre is the picker's name for it when it has one", () => {
  assert.equal(genreTag("Dub-Techno"), "dub techno");
  assert.equal(genreTag("deep house"), "deep house");
  assert.equal(genreTag("sea shanty core"), "sea shanty core");
  assert.equal(genreTag("  "), null);
  const ctx = newCtx(null);
  const r = runTool(ctx, "name_song", { name: "cold squelch", genre: "Acid" });
  assert.ok(r.ok);
  assert.equal(ctx.songName, "cold squelch");
  assert.ok(ctx.songGenre && ctx.songGenre.length <= TAG_MAX_LEN);
  assert.equal(normalizeTag(ctx.songGenre), ctx.songGenre);
});
