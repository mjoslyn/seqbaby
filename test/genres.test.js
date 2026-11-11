// The groove picker's genres: the table, the search and the brief it sends.
import { test } from "node:test";
import assert from "node:assert/strict";
import { GENRES, GENRE_FAMILIES, genreById, genrePrompt, searchGenres } from "../app/songs/genres.js";

test("every genre is whole, unique and in a known family", () => {
  assert.ok(GENRES.length >= 100, `a big list: ${GENRES.length}`);
  const ids = new Set();
  const fams = new Set(GENRE_FAMILIES.map((f) => f.id));
  for (const g of GENRES) {
    assert.ok(!ids.has(g.id), `duplicate id ${g.id}`);
    ids.add(g.id);
    assert.ok(fams.has(g.family), `${g.id}: unknown family ${g.family}`);
    assert.ok(g.bpm[0] >= 40 && g.bpm[0] <= g.bpm[1] && g.bpm[1] <= 240, `${g.id}: bpm ${g.bpm}`);
    assert.ok(g.brief.length > 40, `${g.id}: a brief`);
  }
  for (const f of GENRE_FAMILIES) assert.ok(GENRES.some((g) => g.family === f.id), `${f.id} has genres`);
});

test("search ranks a name that starts with the query first", () => {
  assert.equal(searchGenres("tech")[0].name, "tech house");
  assert.equal(searchGenres("techno")[0].id, "techno");
  assert.ok(searchGenres("house").slice(0, 3).every((g) => g.name.includes("house")));
});

test("search finds aliases, words inside names, accents and case", () => {
  assert.equal(searchGenres("dnb")[0].id, "dnb");
  assert.equal(searchGenres("2-step")[0].id, "garage");
  assert.ok(searchGenres("hop").some((g) => g.id === "lofi"));
  assert.ok(searchGenres("BOSSA").some((g) => g.id === "bossa"));
  assert.deepEqual(searchGenres("zzzz"), []);
});

test("a family filters, and an empty query lists it", () => {
  const all = searchGenres("", "bass");
  assert.ok(all.length > 5 && all.every((g) => g.family === "bass"));
  assert.ok(searchGenres("house", "techno").every((g) => g.family === "techno"));
  assert.equal(searchGenres("").length, GENRES.length);
});

test("the prompt asks for a whole song at the genre's tempo, with extras", () => {
  const g = genreById("acid");
  const p = genrePrompt(g, " in F minor ");
  assert.match(p, /complete acid house song from scratch/);
  assert.match(p, /122-130 bpm/);
  assert.match(p, /Also: in F minor$/);
  assert.doesNotMatch(genrePrompt(g), /Also:/);
});
