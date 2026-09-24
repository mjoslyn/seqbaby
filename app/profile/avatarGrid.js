// An avatar is a step grid: 16 rows of 16 steps, each unlit or lit in one of
// the studio's own colours -- a sequencer pattern standing in for a face.
// Stored as one string in `profiles.avatar_grid` (migration 0014):
//
//   256 characters, one per cell, row by row: "0" unlit, "1".."d" a colour
//   from PALETTE (so "1" is the lime every lit step in the studio is drawn in)
//
// Nobody is without one: a profile that never drew a grid gets one generated
// from its name (`defaultGrid`), stable for as long as the name is.
//
// No imports, for songName.js's reason: pure, so `node --test` exercises it
// (test/avatarGrid.test.js), and the database's CHECK constraint says the
// same thing AVATAR_GRID_RE says (the test holds the two together).

export const SIZE = 16;

/** The colours, all lifted from the studio's stylesheets. Index 0 is unlit;
 *  the order is the order the editor shows them in. */
export const PALETTE = [
  null,
  { name: "step", hex: "#c2f04a" }, //  --accent, a lit step
  { name: "cyan", hex: "#6ee7ff" }, //  --accent-2
  { name: "mint", hex: "#6ee7b7" }, //  the account UI's accent
  { name: "sky", hex: "#8ec7ff" },
  { name: "lilac", hex: "#d5a6ff" },
  { name: "violet", hex: "#a68bff" },
  { name: "pink", hex: "#ff9ad5" },
  { name: "hot pink", hex: "#ff6fa3" },
  { name: "orange", hex: "#ffa94d" },
  { name: "yellow", hex: "#ffd35a" },
  { name: "red", hex: "#f87171" },
  { name: "white", hex: "#e8e8ea" },
  { name: "grey", hex: "#6b7280" },
];
export const COLOR_COUNT = PALETTE.length - 1;
export const AVATAR_GRID_RE = /^[0-9a-d]{256}$/;

/** @typedef {{ cells: number[] }} Grid  256 palette indices, row-major, 0 unlit */

const empty = () => new Array(SIZE * SIZE).fill(0);
const clampColor = (c) => Math.max(1, Math.min(COLOR_COUNT, c | 0 || 1));

/** @param {unknown} s @returns {Grid | null} */
export function decodeGrid(s) {
  if (typeof s !== "string" || !AVATAR_GRID_RE.test(s)) return null;
  return { cells: [...s].map((ch) => parseInt(ch, 16)) };
}

/** @param {Grid} g @returns {string} */
export function encodeGrid(g) {
  let out = "";
  for (let i = 0; i < SIZE * SIZE; i++) {
    const v = g.cells[i] | 0;
    out += (v >= 0 && v <= COLOR_COUNT ? v : 0).toString(16);
  }
  return out;
}

// In the drawn shapes: "." unlit, "x" the colour being drawn with, and a few
// fixed colours for the parts of a face that are always the same colour.
const FIXED = { w: 12, y: 10, p: 7, r: 11, k: 13 };

/** Rows drawn as text. A row of 8 is the LEFT half of a symmetric shape and
 *  is mirrored onto the right; a row of 16 is taken as it is. */
function fromRows(rows, color) {
  const cells = empty();
  for (let r = 0; r < SIZE; r++) {
    const line = rows[r] ?? "";
    const full = line.length === SIZE / 2 ? line + [...line].reverse().join("") : line;
    for (let c = 0; c < SIZE; c++) {
      const ch = full[c];
      cells[r * SIZE + c] = ch === "x" ? color : FIXED[ch] ?? 0;
    }
  }
  return cells;
}

function plot(points, color) {
  const cells = empty();
  for (const [r, c] of points)
    if (r >= 0 && r < SIZE && c >= 0 && c < SIZE) cells[r * SIZE + c] = color;
  return cells;
}

// The precanned shapes. Symmetric ones are drawn as their left half.
const DRAWN = {
  heart: [
    "........", "........", "...xxx..", "..xwxxx.",
    ".xwxxxxx", ".xxxxxxx", ".xxxxxxx", ".xxxxxxx",
    "..xxxxxx", "...xxxxx", "....xxxx", ".....xxx",
    "......xx", ".......x", "........", "........",
  ],
  smile: [
    ".....xxx", "...xx...", "..x.....", ".x......",
    ".x...ww.", "x....ww.", "x.......", "x.......",
    "x..x....", "x...x...", ".x...xxx", ".x......",
    "..x.....", "...xx...", ".....xxx", "........",
  ],
  invader: [
    "........", "........", "........", "........",
    "..x.....", "...x....", "..xxxxxx", ".xx.xxxx",
    "xxxxxxxx", "x.xxxxxx", "x.x.....", "...xx...",
    "........", "........", "........", "........",
  ],
  ghost: [
    "........", ".....xxx", "...xxxxx", "..xxxxxx",
    ".xxxxxxx", ".xxwwxxx", ".xwwwwxx", ".xww.wxx",
    ".xxwwxxx", ".xxxxxxx", ".xxxxxxx", ".xxxxxxx",
    ".xxxxxxx", ".xx.xxx.", ".x...x..", "........",
  ],
  skull: [
    "........", "....xxxx", "..xxxxxx", ".xxxxxxx",
    ".xxxxxxx", ".xx...xx", ".xx...xx", ".xx...xx",
    ".xxxxxxx", "..xxxxx.", "...xxxxx", "...xxxxx",
    "...x.x.x", "...xxxxx", "....xxxx", "........",
  ],
  cat: [
    "........", ".x......", ".xp.....", ".xxx....",
    ".xxxxxxx", ".xxxxxxx", "xxxxxxxx", "xxyyxxxx",
    "xxyyxxxx", "xxxxxxxx", "xxxxxxxp", "xxxxxx.x",
    ".xxxxxxx", "..xxxxxx", "....xxxx", "........",
  ],
  robot: [
    ".......r", ".......x", "....xxxx", ".xxxxxxx",
    ".x......", ".x......", ".x..ww..", ".x..ww..",
    ".x......", ".x......", ".x..rrrr", ".x......",
    ".xxxxxxx", "...x....", "..xxx...", "........",
  ],
  star: [
    ".......x", ".......x", "......xx", "......xx",
    "xxxxxxxx", ".xxxxxxx", "..xxxxxx", "...xxxxx",
    "...xxxxx", "..xxxxxx", "..xxx.xx", ".xxx...x",
    ".xx.....", "x.......", "........", "........",
  ],
  headphones: [
    "........", "....xxxx", "..xx....", ".x......",
    ".x......", "x.......", "x.......", "x.......",
    "xkk.....", "xkkk....", "xkkk....", "xkkk....",
    "xkk.....", ".xx.....", "........", "........",
  ],
  cassette: [
    "........", "xxxxxxxx", "x.......", "x.xxxxxx",
    "x.x.....", "x.x.ww..", "x.x.w.w.", "x.x.ww..",
    "x.x.....", "x.xxxxxx", "x.......", "x...xxxx",
    "x..x....", "xxxxxxxx", "........", "........",
  ],
  note: [
    "................", ".....xxxxxxxxxx.", ".....xxxxxxxxxx.", ".....x........x.",
    ".....x........x.", ".....x........x.", ".....x........x.", ".....x........x.",
    ".....x........x.", ".....x........x.", "..xxxx.....xxxx.", ".xxxxx....xxxxx.",
    ".xxxxx....xxxxx.", "..xxx......xxx..", "................", "................",
  ],
  bolt: [
    ".........xxxxx..", "........xxxxx...", ".......xxxxx....", "......xxxxx.....",
    ".....xxxxx......", "....xxxxxxxxxx..", "...xxxxxxxxxx...", ".........xxxx...",
    "........xxxx....", ".......xxxx.....", "......xxx.......", ".....xxx........",
    "....xx..........", "...xx...........", "..x.............", "................",
  ],
  beat: [
    "................", "x...x...x...x...", "x...x...x...x...", "................",
    "....x.......x...", "....x.......x...", "................", "..x...x...x...x.",
    "..x...x...x...x.", "................", "x.x.x.x.x.x.x.x.", "x.x.x.x.x.x.x.x.",
    "................", "...........x..x.", "...........x..x.", "................",
  ],
};

// A sine, one cycle across the sixteen steps, two cells thick.
function wave(color) {
  const pts = [];
  for (let c = 0; c < SIZE; c++) {
    const r = Math.round(7.5 - 5.5 * Math.sin((2 * Math.PI * c) / SIZE));
    pts.push([r, c], [r + 1, c]);
  }
  return plot(pts, color);
}

// An arpeggio in a piano roll: up the rows and back down.
function arp(color) {
  const pts = [];
  for (let c = 0; c < SIZE; c++) {
    const r = c < 8 ? 14 - c * 2 : (c - 8) * 2;
    pts.push([r, c], [r + 1, c]);
  }
  return plot(pts, color);
}

// Euclid's E(5,16) around a ring, the ring button's picture: sixteen steps,
// the five hits drawn as blocks.
function ring(color) {
  const pts = [];
  for (let i = 0; i < SIZE; i++) {
    const a = (2 * Math.PI * i) / SIZE - Math.PI / 2;
    const r = Math.round(7.5 + 6.5 * Math.sin(a));
    const c = Math.round(7.5 + 6.5 * Math.cos(a));
    pts.push([r, c]);
    if ([0, 3, 6, 10, 13].includes(i)) pts.push([r + 1, c], [r, c + 1], [r + 1, c + 1]);
  }
  return plot(pts, color);
}

const COMPUTED = { wave, arp, ring };

export const SHAPE_NAMES = [...Object.keys(DRAWN), ...Object.keys(COMPUTED)];

/** @param {string} name @param {number} [color] a PALETTE index @returns {Grid} */
export function shapeGrid(name, color = 1) {
  const c = clampColor(color);
  if (COMPUTED[name]) return { cells: COMPUTED[name](c) };
  return { cells: fromRows(DRAWN[name] ?? [], c) };
}

/** The drawn rows of a shape, for the tests. */
export function shapeRows(name) {
  return DRAWN[name] ?? null;
}

// A small hash-seeded generator, so a name always gives the same grid.
function rng(seed) {
  let h = 2166136261 >>> 0;
  const s = String(seed);
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

function lit(cells, r, c) {
  return r >= 0 && r < SIZE && c >= 0 && c < SIZE && cells[r * SIZE + c] > 0;
}

function neighbours(cells, r, c) {
  let n = 0;
  for (let dr = -1; dr <= 1; dr++)
    for (let dc = -1; dc <= 1; dc++) if ((dr || dc) && lit(cells, r + dr, c + dc)) n++;
  return n;
}

/**
 * A random creature, the way the arcade drew them: a 7x7 silhouette whose
 * left half is thrown and mirrored onto the right (a symmetric pattern reads
 * as a face, an asymmetric one as static), the middle columns likelier to be
 * lit than the edges, doubled up to 14x14 in the middle of the grid. Then,
 * half the time, a one-step outline around it in a second colour, and a pair
 * of eyes wherever the body is wide enough to hold them. Thrown straight at
 * 16x16 the noise came out as static, or smoothed into a featureless blob.
 * @param {string|number} seed
 * @param {{ color?: number, accent?: number }} [opts]
 * @returns {Grid}
 */
export function generateGrid(seed, { color, accent } = {}) {
  const next = rng(seed);
  const body = color ? clampColor(color) : 1 + Math.floor(next() * 11);
  const small = new Array(49).fill(false);
  for (let r = 0; r < 7; r++)
    for (let c = 0; c < 4; c++) {
      const p = [0.3, 0.5, 0.65, 0.8][c] * (r === 0 || r === 6 ? 0.6 : 1);
      const on = next() < p;
      small[r * 7 + c] = on;
      small[r * 7 + (6 - c)] = on;
    }
  if (small.filter(Boolean).length < 8) for (let r = 1; r < 6; r++) small[r * 7 + 3] = small[r * 7 + 2] = small[r * 7 + 4] = true;

  let cells = empty();
  for (let r = 0; r < 14; r++)
    for (let c = 0; c < 14; c++)
      if (small[(r >> 1) * 7 + (c >> 1)]) cells[(r + 1) * SIZE + (c + 1)] = body;

  const second = accent ? clampColor(accent) : 1 + Math.floor(next() * COLOR_COUNT);
  if (second !== body && next() < 0.5) {
    const at = (r, c) => (r >= 0 && r < SIZE && c >= 0 && c < SIZE ? cells[r * SIZE + c] : 0);
    cells = cells.map((v, i) => {
      if (v) return v;
      const r = Math.floor(i / SIZE);
      const c = i % SIZE;
      return at(r - 1, c) || at(r + 1, c) || at(r, c - 1) || at(r, c + 1) ? second : 0;
    });
  }

  // Eyes: 2x2 of white with a dark pupil, the first place from the top where
  // both fit inside the body, mirrored like everything else.
  const solid = (r, c) => [0, 1].every((dr) => [0, 1].every((dc) => cells[(r + dr) * SIZE + c + dc] === body));
  search: for (let r = 2; r < 10; r++)
    for (const c of [5, 4, 3]) {
      const m = SIZE - 2 - c;
      if (!solid(r, c) || !solid(r, m)) continue;
      for (const cc of [c, m]) for (let dr = 0; dr < 2; dr++) cells[(r + dr) * SIZE + cc] = cells[(r + dr) * SIZE + cc + 1] = 12;
      cells[(r + 1) * SIZE + c + 1] = 0;
      cells[(r + 1) * SIZE + m] = 0;
      break search;
    }
  return { cells };
}

/** The grid someone has before they draw their own. @param {string} name */
export function defaultGrid(name) {
  return generateGrid(`seqbaby:${String(name || "").toLowerCase()}`);
}

/** Their saved grid, or the one their name gives them. */
export function gridFor(stored, name) {
  return decodeGrid(stored) ?? defaultGrid(name);
}

/** Lit becomes unlit, unlit becomes `color`. */
export function invertGrid(g, color = 1) {
  const c = clampColor(color);
  return { cells: g.cells.map((v) => (v ? 0 : c)) };
}

/** Rotate every row one step, as a sequencer's shift does. @param {1|-1} dir */
export function shiftGrid(g, dir = 1) {
  const cells = new Array(SIZE * SIZE);
  for (let r = 0; r < SIZE; r++)
    for (let c = 0; c < SIZE; c++)
      cells[r * SIZE + ((c + dir + SIZE) % SIZE)] = g.cells[r * SIZE + c];
  return { cells };
}

/** Copy the left half onto the right, mirrored. */
export function mirrorGrid(g) {
  const cells = g.cells.slice();
  for (let r = 0; r < SIZE; r++)
    for (let c = 0; c < SIZE / 2; c++) cells[r * SIZE + (SIZE - 1 - c)] = cells[r * SIZE + c];
  return { cells };
}

/** Paint-bucket: every cell joined to `index` by the same value (4-way)
 *  becomes `value` (0 to clear). */
export function fillGrid(g, index, value) {
  const from = g.cells[index];
  if (from === value) return g;
  const cells = g.cells.slice();
  const stack = [index];
  while (stack.length) {
    const i = stack.pop();
    if (i < 0 || i >= SIZE * SIZE || cells[i] !== from) continue;
    cells[i] = value;
    const r = Math.floor(i / SIZE);
    const c = i % SIZE;
    if (c > 0) stack.push(i - 1);
    if (c < SIZE - 1) stack.push(i + 1);
    if (r > 0) stack.push(i - SIZE);
    if (r < SIZE - 1) stack.push(i + SIZE);
  }
  return { cells };
}
