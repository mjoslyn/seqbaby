import test from "node:test";
import assert from "node:assert/strict";
import { hotScore, rankSongs } from "../app/home/rank.js";

const NOW = Date.parse("2026-09-24T12:00:00Z");
const ago = (days) => new Date(NOW - days * 86400000).toISOString();

test("with no likes anywhere, the order is freshness", () => {
  const rows = [
    { id: "old", likes: 0, updatedAt: ago(5) },
    { id: "new", likes: 0, updatedAt: ago(0.1) },
    { id: "mid", likes: 0, updatedAt: ago(1) },
  ];
  assert.deepEqual(rankSongs(rows, NOW).map((r) => r.id), ["new", "mid", "old"]);
});

test("at the same age, more likes rank higher", () => {
  const rows = [
    { id: "a", likes: 1, updatedAt: ago(2) },
    { id: "b", likes: 9, updatedAt: ago(2) },
  ];
  assert.deepEqual(rankSongs(rows, NOW).map((r) => r.id), ["b", "a"]);
});

test("a liked song from yesterday beats an unheard one from this morning", () => {
  assert.ok(hotScore(10, ago(1), NOW) > hotScore(0, ago(0.2), NOW));
});

test("likes do not keep a song on top forever", () => {
  assert.ok(hotScore(0, ago(0), NOW) > hotScore(10, ago(30), NOW));
});

test("a brand new song with no likes still scores", () => {
  assert.equal(hotScore(0, ago(0), NOW), 1);
});

test("bad input never throws or ranks first", () => {
  assert.ok(Number.isFinite(hotScore(NaN, "not a date", NOW)));
  const rows = [
    { id: "junk", likes: null, updatedAt: "nope" },
    { id: "ok", likes: 0, updatedAt: ago(3) },
  ];
  assert.deepEqual(rankSongs(rows, NOW).map((r) => r.id), ["ok", "junk"]);
});

test("a song edited in the future counts as brand new, not newer", () => {
  assert.equal(hotScore(0, ago(-1), NOW), 1);
});
