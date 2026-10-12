// Tests for the pattern picture the clip cells and arrangement blocks draw.
// Run with `npm test`.

import test from "node:test";
import assert from "node:assert/strict";
import { patternSvg, svgUrl } from "../public/js/patternPicture.js";

const pat = (n) => ({ steps: Array(n).fill(0), notes: Array(n).fill(null), extraNotes: Array(n).fill(null), lengths: Array(n).fill(0), offsets: Array(n).fill(0), velocities: Array(n).fill(0.5) });
const rects = (svg) => [...svg.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)"/g)].map((m) => m.slice(1).map(Number));

test("an empty pattern draws nothing", () => {
  assert.equal(patternSvg(pat(16)), "");
  assert.equal(patternSvg(null), "");
  assert.equal(patternSvg({ steps: [] }), "");
});

test("one pass, a rect per note, the viewBox one unit a step", () => {
  const p = pat(16);
  p.steps[0] = 1; p.notes[0] = 48;
  p.steps[4] = 1; p.notes[4] = 55; p.lengths[4] = 3;
  p.steps[8] = 1; p.notes[8] = 48; p.extraNotes[8] = [52];
  const svg = patternSvg(p);
  assert.match(svg, /viewBox="0 0 16 8"/);           // 48..55 is eight rows
  const r = rects(svg);
  assert.equal(r.length, 4);
  assert.deepEqual(r.map((x) => x[0]), [0, 4, 8, 8]);
  assert.ok(r[1][2] > 2.5, "a three-step note is three steps wide");
  // higher pitch, higher on the picture
  assert.ok(r[1][1] < r[0][1]);
});

test("a single pitch sits in the middle of a six-row box", () => {
  const p = pat(8);
  p.steps[0] = p.steps[4] = 1;
  const svg = patternSvg(p, 36);
  assert.match(svg, /viewBox="0 0 8 6"/);
  assert.ok(rects(svg).every(([, y]) => y > 2 && y < 3));
});

test("a long note stops at the end of the pass, and a nudge moves it", () => {
  const p = pat(4);
  p.steps[3] = 1; p.notes[3] = 60; p.lengths[3] = 8; p.offsets[3] = 0.25;
  const [[x, , w]] = rects(patternSvg(p));
  assert.equal(x, 3.25);
  assert.ok(x + w <= 4);
});

test("svgUrl survives a double-quoted style attribute", () => {
  const u = svgUrl(`<svg a="b">'</svg>`);
  assert.ok(!u.slice(5, -2).includes('"') && !u.slice(5, -2).includes("'"));
  assert.ok(u.startsWith("url('data:image/svg+xml,"));
});

test("a fat note stays inside the box", () => {
  const p = pat(4);
  p.steps[0] = 1; p.notes[0] = 40; p.steps[1] = 1; p.notes[1] = 70;
  const svg = patternSvg(p, 60, { fat: 2.4 });
  const H = Number(svg.match(/viewBox="0 0 4 ([\d.]+)"/)[1]);
  for (const m of svg.matchAll(/y="([-\d.]+)" width="[\d.]+" height="([\d.]+)"/g)) {
    assert.ok(Number(m[1]) >= -0.001 && Number(m[1]) + Number(m[2]) <= H + 0.001, `${m[1]} + ${m[2]} in ${H}`);
  }
});
