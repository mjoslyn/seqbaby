import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EMPTY_QUERY,
  explorePeople,
  gatherPeople,
  instrumentCounts,
  matches,
  medianBpm,
  parseQuery,
  queryString,
} from "../app/people/people.js";

const NOW = Date.parse("2026-09-25T12:00:00Z");
const daysAgo = (d) => new Date(NOW - d * 86400000).toISOString();
const q = (over) => ({ ...EMPTY_QUERY, ...over });
const handles = (list) => list.map((p) => p.handle);

const profile = (handle, bio = null) => ({ handle, bio, avatarGrid: null });
const PROFILES = new Map([
  ["u-mike", profile("mike", "acid at dawn")],
  ["u-ana", profile("ana")],
  ["u-zed", profile("zed", "patches only")],
]);
const SONGS = [
  { owner: "u-mike", bpm: 138, likes: 3, at: daysAgo(2), engines: ["dm:808-kick", "dm:303"] },
  { owner: "u-mike", bpm: 132, likes: 1, at: daysAgo(4), engines: ["dm:silverbox", "bus"] },
  { owner: "u-mike", bpm: 174, likes: 0, at: daysAgo(9), engines: ["plaits:0"] },
  { owner: "u-ana", bpm: 84, likes: 9, at: daysAgo(0.5), engines: ["dm:guitar"] },
  { owner: "u-private", bpm: 120, likes: 50, at: daysAgo(0.1), engines: ["dm:909-hat"] },
];
const PATCHES = [
  { owner: "u-zed", likes: 2, at: daysAgo(1), engine: "dm:hexop" },
  { owner: "u-zed", likes: 0, at: daysAgo(3), engine: "custom" },
  { owner: "u-ana", likes: 1, at: daysAgo(6), engine: "dm:sub" },
];
const PEOPLE = gatherPeople(SONGS, PATCHES, PROFILES);
const find = (h) => PEOPLE.find((p) => p.handle === h);

test("gatherPeople counts songs, patches and hearts per public profile", () => {
  assert.deepEqual(handles(PEOPLE).sort(), ["ana", "mike", "zed"]);
  const mike = find("mike");
  assert.equal(mike.songs, 3);
  assert.equal(mike.patches, 0);
  assert.equal(mike.likes, 4);
  assert.equal(mike.bio, "acid at dawn");
  assert.equal(mike.latest, daysAgo(2));
  const ana = find("ana");
  assert.equal(ana.songs, 1);
  assert.equal(ana.patches, 1);
  assert.equal(ana.likes, 10);
  assert.equal(ana.latest, daysAgo(0.5));
});

test("gatherPeople names instruments from songs and patches, legacy names folded", () => {
  assert.deepEqual(find("mike").instruments, ["808", "plaits", "silverbox"]);
  assert.deepEqual(find("ana").instruments, ["guitar", "subby"]);
  assert.deepEqual(find("zed").instruments, ["hexop", "tone synth"]);
});

test("medianBpm is the median, ignores junk, and is null with nothing to read", () => {
  assert.equal(medianBpm([138, 132, 174]), 138);
  assert.equal(medianBpm([120, 130]), 125);
  assert.equal(medianBpm([null, "fast", 0, 90]), 90);
  assert.equal(medianBpm([]), null);
  assert.equal(find("mike").bpm, 138);
  assert.equal(find("zed").bpm, null);
});

test("search reads handle, bio and instruments, any order, @ optional", () => {
  assert.deepEqual(handles(PEOPLE.filter((p) => matches(p, q({ q: "@mike" })))), ["mike"]);
  assert.deepEqual(handles(PEOPLE.filter((p) => matches(p, q({ q: "dawn ACID" })))), ["mike"]);
  assert.deepEqual(handles(PEOPLE.filter((p) => matches(p, q({ q: "subby" })))), ["ana"]);
  assert.equal(PEOPLE.filter((p) => matches(p, q({ q: "nobody" }))).length, 0);
});

test("tempo bounds read the median and leave out anyone with none", () => {
  assert.deepEqual(handles(explorePeople(PEOPLE, q({ min: 130, max: 149 }))), ["mike"]);
  assert.deepEqual(handles(explorePeople(PEOPLE, q({ max: 89 }))), ["ana"]);
});

test("instruments must all be used; makes needs one of each kind picked", () => {
  assert.deepEqual(handles(explorePeople(PEOPLE, q({ with: ["808", "silverbox"] }))), ["mike"]);
  assert.deepEqual(handles(explorePeople(PEOPLE, q({ with: ["808", "guitar"] }))), []);
  assert.deepEqual(handles(explorePeople(PEOPLE, q({ makes: ["patches"] }))), ["ana", "zed"]);
  assert.deepEqual(handles(explorePeople(PEOPLE, q({ makes: ["songs", "patches"] }))), ["ana"]);
});

test("sorts: busiest, recently active, most liked, a to z", () => {
  assert.deepEqual(handles(explorePeople(PEOPLE, q({ sort: "busy" }))), ["mike", "ana", "zed"]);
  assert.deepEqual(handles(explorePeople(PEOPLE, q({ sort: "recent" }))), ["ana", "zed", "mike"]);
  assert.deepEqual(handles(explorePeople(PEOPLE, q({ sort: "liked" }))), ["ana", "mike", "zed"]);
  assert.deepEqual(handles(explorePeople(PEOPLE, q({ sort: "handle" }))), ["ana", "mike", "zed"]);
});

test("busiest ties go to whoever published most recently", () => {
  // ana and zed have two things each; ana's newest is half a day old, zed's a day.
  const two = PEOPLE.filter((p) => p.handle !== "mike");
  assert.deepEqual(handles(explorePeople(two, q({}))), ["ana", "zed"]);
});

test("instrumentCounts counts people the pick would leave, keeps a picked zero", () => {
  const all = instrumentCounts(PEOPLE, q({}));
  assert.equal(all.length, 7);
  assert.ok(all.every((c) => c.count === 1));
  const withGuitar = instrumentCounts(PEOPLE, q({ with: ["guitar"] }));
  assert.equal(withGuitar.find((c) => c.name === "subby").count, 1);
  assert.equal(withGuitar.find((c) => c.name === "808").count, 0);
  const gone = instrumentCounts(PEOPLE, q({ with: ["theremin"] }));
  assert.deepEqual(gone.find((c) => c.name === "theremin"), { name: "theremin", count: 0 });
});

test("the URL round-trips, defaults are left out, junk is ignored", () => {
  assert.equal(queryString(EMPTY_QUERY), "");
  const full = q({ q: "acid", sort: "liked", min: 120, max: 135, with: ["808", "silverbox"], makes: ["patches"], page: 2 });
  assert.deepEqual(parseQuery(queryString(full)), full);
  const junk = parseQuery("?sort=loudest&bpm=abc-&makes=albums,songs&page=-3");
  assert.equal(junk.sort, "busy");
  assert.equal(junk.min, null);
  assert.deepEqual(junk.makes, ["songs"]);
  assert.equal(junk.page, 1);
});
