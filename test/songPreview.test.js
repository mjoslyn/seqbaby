import test from "node:test";
import assert from "node:assert/strict";
import { decodePreview, euclideanRhythm, previewFromSession } from "../app/songs/songPreview.js";
import { recipes } from "./songPreviewRecipes.js";
import { readFileSync } from "node:fs";

// euclid.js touches the DOM at import, so its two functions are lifted out of
// the source and run on their own: the preview must draw the ring the studio
// plays, and this is the studio's own code rather than a third copy.
const studioEuclid = (() => {
  const src = readFileSync(new URL("../public/js/euclid.js", import.meta.url), "utf8");
  const grab = (re) => src.match(re)?.[0] ?? assert.fail(`${re} not found in euclid.js`);
  const rhythm = grab(/function euclideanRhythm\([\s\S]*?\n\}\n/);
  const bj = grab(/function bjorklund\([\s\S]*?\n\}\n/);
  return new Function(`${bj}\n${rhythm}\nreturn euclideanRhythm;`)();
})();

const mask = (cells) => cells.map((c) => (c ? (c.tie ? "-" : "x") : ".")).join("");

test("the ring is the studio's ring, not a rotation of it", () => {
  assert.equal(euclideanRhythm(8, 5).map((b) => (b ? "x" : ".")).join(""), "x.xx.xx.");
  for (let n = 1; n <= 32; n++)
    for (let k = 0; k <= n; k++)
      for (const r of [0, 3])
        assert.deepEqual(euclideanRhythm(n, k, r), studioEuclid(n, k, r), `E(${k},${n}) rot ${r}`);
});

test("written steps: velocity digits, holds and rests", () => {
  const p = decodePreview({ p: 2, t: [{ s: "9..3--." }] });
  assert.equal(p.pattern, 2);
  assert.equal(mask(p.rows[0].cells), "x..x--.");
  assert.equal(p.rows[0].cells[0].v, 1);
  assert.ok(Math.abs(p.rows[0].cells[3].v - 1 / 3) < 1e-9);
  assert.equal(p.rows[0].cells[4].v, p.rows[0].cells[3].v, "a hold carries its hit's velocity");
});

test("a hold with nothing before it is a rest", () => {
  assert.equal(mask(decodePreview({ t: [{ s: "-9" }] }).rows[0].cells), ".x");
});

test("shorter tracks tile across the longest, as they play", () => {
  const p = decodePreview({ t: [{ s: "9..." }, { s: "9......." }] });
  assert.equal(p.cols, 8);
  assert.equal(mask(p.rows[0].cells), "x...x...");
});

test("a live euclid track draws its ring, legato holding to the next hit", () => {
  const p = decodePreview({ t: [{ n: 16, g: { p: 5, n: 8, r: 0, l: false, a: true } }] });
  assert.equal(mask(p.rows[0].cells), "x.xx.xx.x.xx.xx.");
  assert.equal(p.rows[0].gen, "euclid");
  assert.ok(p.rows[0].cells[0].v > p.rows[0].cells[2].v, "downbeats accented");
  const legato = decodePreview({ t: [{ n: 8, g: { p: 2, n: 8, l: true } }] });
  assert.equal(mask(legato.rows[0].cells), "x---x---");
});

test("euclid settings out of range are clamped the way the studio clamps them", () => {
  const p = decodePreview({ t: [{ n: 4, g: { p: 99, n: 99, r: -3 } }] });
  assert.equal(mask(p.rows[0].cells), "xxxx");
});

test("a live chance track stays inside its window, the same every time", () => {
  const raw = { t: [{ n: 16, c: { f: 4, l: 11, s: 1234 } }] };
  const a = mask(decodePreview(raw).rows[0].cells);
  assert.equal(a, mask(decodePreview(raw).rows[0].cells));
  assert.match(a, /^\.{4}[x.]{8}\.{4}$/);
  assert.ok(a.includes("x"));
});

test("anything unreadable is no preview, never a throw", () => {
  for (const raw of [null, undefined, 3, "x", {}, { t: "no" }, { t: [] }, { t: [null, 5] }, { t: [{ s: "" }] }])
    assert.equal(decodePreview(raw), null);
  const p = decodePreview({ t: [{ s: 42 }, { s: "9x" }] });
  assert.equal(p.rows.length, 1, "a row that is not a step string is dropped");
  assert.equal(mask(p.rows[0].cells), "x.");
});

// The JS port answers exactly what Postgres answers. The expected file is
// song_preview's own output for each recipe, produced against a database with
// the migrations applied:
//
//   node -e 'import("./test/songPreviewRecipes.js").then(({recipes}) =>
//     console.log(JSON.stringify(Object.fromEntries(
//       Object.entries(recipes).map(([k, f]) => [k, f()])))))' > /tmp/cases.json
//   psql -At -v data="$(cat /tmp/cases.json)" <<< \
//     "select jsonb_object_agg(key, public.song_preview(value)) from jsonb_each(:'data'::jsonb);"
//
// Change one side without the other and this fails.
test("previewFromSession is song_preview, case for case", () => {
  const expected = JSON.parse(
    readFileSync(new URL("./fixtures/songPreview.expected.json", import.meta.url), "utf8"),
  );
  assert.deepEqual(Object.keys(expected).sort(), Object.keys(recipes).sort(), "a recipe without an expected output");
  for (const [name, build] of Object.entries(recipes))
    assert.deepEqual(previewFromSession(build()), expected[name], name);
});
