import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  SIZE,
  PALETTE,
  COLOR_COUNT,
  SHAPE_NAMES,
  AVATAR_GRID_RE,
  decodeGrid,
  encodeGrid,
  shapeGrid,
  shapeRows,
  generateGrid,
  defaultGrid,
  gridFor,
  invertGrid,
  shiftGrid,
  mirrorGrid,
  fillGrid,
} from "../app/profile/avatarGrid.js";

const N = SIZE * SIZE;
const rows = (g) =>
  Array.from({ length: SIZE }, (_, r) =>
    g.cells.slice(r * SIZE, r * SIZE + SIZE).map((v) => (v ? "x" : ".")).join(""),
  );

test("the palette is the studio's colours, one hex digit each", () => {
  assert.equal(PALETTE[0], null, "0 is unlit");
  assert.equal(COLOR_COUNT, 13);
  assert.equal(PALETTE[1].hex, "#c2f04a", "1 is the lit-step lime");
  for (const p of PALETTE.slice(1)) assert.match(p.hex, /^#[0-9a-f]{6}$/);
  const css = readFileSync(new URL("../public/style.css", import.meta.url), "utf8") +
    readFileSync(new URL("../app/ui.module.css", import.meta.url), "utf8");
  for (const p of PALETTE.slice(1)) assert.ok(css.toLowerCase().includes(p.hex), `${p.name} ${p.hex} is not in the app's CSS`);
});

test("encode and decode round-trip, one character a cell", () => {
  const g = shapeGrid("robot", 4);
  const s = encodeGrid(g);
  assert.equal(s.length, N);
  assert.match(s, AVATAR_GRID_RE);
  assert.deepEqual(decodeGrid(s), g);
  const one = new Array(N).fill(0);
  one[0] = 13;
  assert.equal(encodeGrid({ cells: one }), "d" + "0".repeat(N - 1));
});

test("decode refuses anything the database would refuse", () => {
  for (const bad of [null, 5, "", "0".repeat(N - 1), "0".repeat(N + 1), "e" + "0".repeat(N - 1), "D" + "0".repeat(N - 1)])
    assert.equal(decodeGrid(bad), null, String(bad).slice(0, 12));
});

test("the migration's CHECK is the same rule", () => {
  // 0015 split 0014's `^[0-9a-d]{256}$` into a length and an alphabet,
  // because Postgres refuses a regex repetition count above 255.
  const sql = readFileSync(new URL("../supabase/migrations/0015_avatar_grid_check.sql", import.meta.url), "utf8");
  const [, alphabet, count] = AVATAR_GRID_RE.source.match(/^\^(\[[^\]]+\])\{(\d+)\}\$$/);
  assert.equal(Number(count), N);
  assert.ok(sql.includes(`char_length(avatar_grid) = ${count}`), "CHECK length and AVATAR_GRID_RE disagree");
  assert.ok(sql.includes(`avatar_grid !~ '[^${alphabet.slice(1)}'`), "CHECK alphabet and AVATAR_GRID_RE disagree");
  const code = sql.replace(/--.*$/gm, "");
  for (const [, n] of code.matchAll(/\{(\d+)(?:,\d*)?\}/g))
    assert.ok(Number(n) <= 255, `a Postgres regex cannot repeat ${n} times`);
});

test("every shape fills the grid, drawn halves mirror, and x takes the chosen colour", () => {
  assert.ok(SHAPE_NAMES.length >= 12);
  for (const name of SHAPE_NAMES) {
    const g = shapeGrid(name, 5);
    assert.equal(g.cells.length, N, name);
    assert.ok(g.cells.filter(Boolean).length >= 16, `${name} is nearly empty`);
    assert.ok(g.cells.includes(5), `${name} ignores the chosen colour`);
    const drawn = shapeRows(name);
    if (!drawn) continue;
    assert.equal(drawn.length, SIZE, name);
    for (const line of drawn) assert.ok(line.length === SIZE || line.length === SIZE / 2, `${name}: ${line}`);
    if (drawn.every((l) => l.length === SIZE / 2)) assert.deepEqual(mirrorGrid(g), g, `${name} not symmetric`);
  }
});

test("a generated grid is mirrored, lit enough to read, and seeded", () => {
  for (let seed = 0; seed < 200; seed++) {
    const g = generateGrid(seed);
    assert.deepEqual(mirrorGrid(g), g, `seed ${seed} not symmetric`);
    assert.ok(g.cells.filter(Boolean).length >= 24, `seed ${seed} too empty`);
    assert.ok(g.cells.every((v) => v >= 0 && v <= COLOR_COUNT));
    assert.deepEqual(generateGrid(seed), g);
    assert.match(encodeGrid(g), AVATAR_GRID_RE);
  }
  assert.notDeepEqual(generateGrid(1).cells, generateGrid(2).cells);
  assert.ok(generateGrid(3, { color: 9 }).cells.includes(9), "body takes the colour asked for");
});

test("a name always gets the same default, whatever its case", () => {
  assert.deepEqual(defaultGrid("Mike"), defaultGrid("mike"));
  assert.notDeepEqual(defaultGrid("mike").cells, defaultGrid("squelchqueen").cells);
  assert.deepEqual(gridFor("junk", "mike"), defaultGrid("mike"));
  assert.deepEqual(gridFor(encodeGrid(shapeGrid("skull")), "mike"), shapeGrid("skull"));
});

test("invert, shift, mirror and fill", () => {
  const g = shapeGrid("bolt", 2);
  assert.deepEqual(rows(invertGrid(invertGrid(g), 2)), rows(g));
  let s = g;
  for (let i = 0; i < SIZE; i++) s = shiftGrid(s, 1);
  assert.deepEqual(s, g, "sixteen shifts is a full turn");
  assert.deepEqual(shiftGrid(shiftGrid(g, 1), -1), g);

  const blank = { cells: new Array(N).fill(0) };
  assert.ok(fillGrid(blank, 0, 3).cells.every((v) => v === 3), "a fill on an empty grid floods it");
  const box = { cells: new Array(N).fill(0) };
  for (let i = 4; i <= 11; i++) box.cells[4 * SIZE + i] = box.cells[11 * SIZE + i] = box.cells[i * SIZE + 4] = box.cells[i * SIZE + 11] = 1;
  const inside = fillGrid(box, 8 * SIZE + 8, 4);
  assert.equal(inside.cells[0], 0, "the fill stays inside the box");
  assert.equal(inside.cells.filter((v) => v === 4).length, 36, "and fills all of it");
  assert.equal(inside.cells[8 * SIZE + 8], 4);
  assert.equal(fillGrid(g, 0, g.cells[0]), g, "filling with the same value changes nothing");
});
