import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LEGACY_ENGINE_KEYS,
  EMPTY_QUERY,
  explore,
  instrumentCounts,
  instrumentOf,
  instrumentsOf,
  matches,
  parseQuery,
  queryString,
} from "../app/songs/explore.js";
import { LEGACY_ENGINE_KEYS as ENGINE_LEGACY } from "../public/js/sessionFormat.js";
import { STATIC_ENGINES } from "../public/js/engineData.js";

const NOW = Date.parse("2026-09-25T12:00:00Z");
const daysAgo = (d) => new Date(NOW - d * 86400000).toISOString();

const song = (id, over = {}) => ({
  id,
  title: id,
  owner: { handle: "mike", name: "mike" },
  bpm: 120,
  likes: 0,
  updatedAt: daysAgo(1),
  instruments: [],
  ...over,
});

const SONGS = [
  song("cold squelch", { bpm: 138, likes: 3, updatedAt: daysAgo(2), instruments: ["808", "silverbox"] }),
  song("soft vapour", { bpm: 84, likes: 0, updatedAt: daysAgo(0.1), instruments: ["pad", "plaits"], owner: { handle: "ana", name: "ana" } }),
  song("basement fretwork", { bpm: 124, likes: 9, updatedAt: daysAgo(5), instruments: ["909", "guitar"] }),
  song("no tempo", { bpm: null, likes: 1, updatedAt: daysAgo(3), instruments: ["808"] }),
];
const q = (over) => ({ ...EMPTY_QUERY, ...over });
const ids = (list) => list.map((s) => s.id);

test("the legacy engine names are the engine's own", () => {
  assert.deepEqual(LEGACY_ENGINE_KEYS, ENGINE_LEGACY);
});

test("every engine in the catalog is an instrument, a bus is not", () => {
  assert.ok(STATIC_ENGINES.length > 20);
  for (const e of STATIC_ENGINES) {
    const name = instrumentOf(e.key);
    if (e.key === "bus") assert.equal(name, null);
    else assert.ok(name && !name.includes(":"), `${e.key} reads as "${name}"`);
  }
});

test("engine keys fold into the instruments a person would name", () => {
  assert.equal(instrumentOf("plaits:7"), "plaits");
  assert.equal(instrumentOf("dm:808-kick"), "808");
  assert.equal(instrumentOf("dm:909-ohat"), "909");
  assert.equal(instrumentOf("dm:303"), "silverbox");
  assert.equal(instrumentOf("dm:silverbox"), "silverbox");
  assert.equal(instrumentOf("dm:sub"), "subby");
  assert.equal(instrumentOf("smp:CR78/kick"), "sampler");
  assert.equal(instrumentOf("sampler"), "sampler");
  assert.equal(instrumentOf("wt:akwf"), "wavetable");
  assert.equal(instrumentOf("saved:my lead"), "tone synth");
  assert.equal(instrumentOf("bus"), null);
  assert.equal(instrumentOf(""), null);
  assert.equal(instrumentOf(42), null);
  assert.deepEqual(instrumentsOf(["dm:808-kick", "dm:808-snare", "bus", "dm:303", "dm:silverbox"]), ["808", "silverbox"]);
  assert.deepEqual(instrumentsOf(null), []);
});

test("search matches every word, anywhere in title, owner or instruments", () => {
  assert.deepEqual(ids(explore(SONGS, q({ q: "SQUELCH" }), NOW)), ["cold squelch"]);
  assert.deepEqual(ids(explore(SONGS, q({ q: "@ana" }), NOW)), ["soft vapour"]);
  assert.deepEqual(ids(explore(SONGS, q({ q: "guitar basement" }), NOW)), ["basement fretwork"]);
  assert.deepEqual(ids(explore(SONGS, q({ q: "guitar squelch" }), NOW)), []);
});

test("a bpm range keeps its ends and drops songs with no bpm", () => {
  assert.deepEqual(ids(explore(SONGS, q({ min: 124, max: 138, sort: "bpm-up" }), NOW)), ["basement fretwork", "cold squelch"]);
  assert.deepEqual(ids(explore(SONGS, q({ max: 100 }), NOW)), ["soft vapour"]);
  assert.equal(matches(SONGS[3], q({ min: 1 })), false);
  assert.equal(matches(SONGS[3], q({})), true);
});

test("picked instruments must all be in the song", () => {
  assert.deepEqual(ids(explore(SONGS, q({ with: ["808"], sort: "new" }), NOW)), ["cold squelch", "no tempo"]);
  assert.deepEqual(ids(explore(SONGS, q({ with: ["808", "silverbox"] }), NOW)), ["cold squelch"]);
  assert.deepEqual(ids(explore(SONGS, q({ with: ["808", "guitar"] }), NOW)), []);
});

test("sorts, with no-bpm songs last either way", () => {
  assert.deepEqual(ids(explore(SONGS, q({ sort: "new" }), NOW)), ["soft vapour", "cold squelch", "no tempo", "basement fretwork"]);
  assert.deepEqual(ids(explore(SONGS, q({ sort: "liked" }), NOW)), ["basement fretwork", "cold squelch", "no tempo", "soft vapour"]);
  assert.deepEqual(ids(explore(SONGS, q({ sort: "bpm-up" }), NOW)), ["soft vapour", "basement fretwork", "cold squelch", "no tempo"]);
  assert.deepEqual(ids(explore(SONGS, q({ sort: "bpm-down" }), NOW)), ["cold squelch", "basement fretwork", "soft vapour", "no tempo"]);
  assert.deepEqual(ids(explore(SONGS, q({ sort: "title" }), NOW)), ["basement fretwork", "cold squelch", "no tempo", "soft vapour"]);
  // hot: the homepage's order (rank.js). Fresh and unliked beats old and liked.
  assert.equal(explore(SONGS, q({}), NOW)[0].id, "soft vapour");
});

test("explore does not reorder its input", () => {
  const before = ids(SONGS);
  explore(SONGS, q({ sort: "title" }), NOW);
  assert.deepEqual(ids(SONGS), before);
});

test("instrument counts are what picking one more would leave", () => {
  const all = Object.fromEntries(instrumentCounts(SONGS, q({})).map((c) => [c.name, c.count]));
  assert.equal(all["808"], 2);
  assert.equal(all.silverbox, 1);
  const with808 = Object.fromEntries(instrumentCounts(SONGS, q({ with: ["808"] })).map((c) => [c.name, c.count]));
  assert.equal(with808.silverbox, 1);
  assert.equal(with808.guitar, 0);
  // A picked instrument no song has is still listed, so it can be unpicked.
  assert.ok(instrumentCounts(SONGS, q({ with: ["theremin"] })).some((c) => c.name === "theremin"));
});

test("the query round-trips through the URL, defaults left out", () => {
  assert.equal(queryString(EMPTY_QUERY), "");
  const full = { q: "acid line", sort: "new", min: 120, max: null, with: ["silverbox", "808"] };
  assert.deepEqual(parseQuery(queryString(full)), full);
  assert.deepEqual(parseQuery(""), EMPTY_QUERY);
  assert.deepEqual(parseQuery("?sort=nonsense&bpm=abc-&with=,,"), EMPTY_QUERY);
  assert.deepEqual(parseQuery("?bpm=-140"), { ...EMPTY_QUERY, max: 140 });
});
