import test from "node:test";
import assert from "node:assert/strict";
import { layoutVersions } from "../app/songs/versionTree.js";

// Rows are `{id, parent, seq}` here; the layout only reads id and parent_id.
function v(id, parent) {
  return { id, parent_id: parent, seq: Number(id.slice(1)), label: null, created_at: "" };
}

const rowIds = (rows) => rows.map((r) => r.v.id);
const depths = (rows) => rows.map((r) => r.depth);

test("a straight history stays a straight line", () => {
  const rows = layoutVersions([v("v1", null), v("v2", "v1"), v("v3", "v2")]);
  assert.deepEqual(rowIds(rows), ["v1", "v2", "v3"]);
  assert.deepEqual(depths(rows), [0, 1, 2]);
  assert.deepEqual(rows.map((r) => r.branch), [false, false, false]);
});

test("two saves off one version read as two branches under it", () => {
  const rows = layoutVersions([
    v("v1", null),
    v("v2", "v1"),
    v("v3", "v2"),
    v("v4", "v2"), // opened v2 again and saved: the branch
  ]);
  assert.deepEqual(rowIds(rows), ["v1", "v2", "v3", "v4"]);
  assert.deepEqual(depths(rows), [0, 1, 2, 2]);
  // Only the two children of v2 are marked -- the split is the thing worth
  // pointing at, not everything under it.
  assert.deepEqual(rows.map((r) => r.branch), [false, false, true, true]);
});

test("a branch's own descendants sit under it, not under the trunk", () => {
  const rows = layoutVersions([
    v("v1", null),
    v("v2", "v1"),
    v("v3", "v2"),
    v("v4", "v2"),
    v("v5", "v4"),
  ]);
  assert.deepEqual(rowIds(rows), ["v1", "v2", "v3", "v4", "v5"]);
  assert.deepEqual(depths(rows), [0, 1, 2, 2, 3]);
  assert.equal(rows[4].branch, false);
});

test("input order does not change the drawing", () => {
  const forward = layoutVersions([v("v1", null), v("v2", "v1"), v("v3", "v1")]);
  const shuffled = layoutVersions([v("v3", "v1"), v("v1", null), v("v2", "v1")]);
  // Children keep the order they arrive in (the query sorts by created_at), so
  // only the shape is order-independent -- every row is still drawn once, at the
  // same depth.
  assert.deepEqual(depths(forward), depths(shuffled));
  assert.deepEqual(rowIds(forward).sort(), rowIds(shuffled).sort());
  assert.equal(shuffled[0].v.id, "v1");
});

test("a version whose parent is gone is drawn as a root, never dropped", () => {
  // deleteVersion refuses a version with children, but a hand-edited row or a
  // partial list must not make a version invisible.
  const rows = layoutVersions([v("v2", "v1-missing"), v("v3", "v2")]);
  assert.deepEqual(rowIds(rows), ["v2", "v3"]);
  assert.deepEqual(depths(rows), [0, 1]);
});

test("a parent cycle terminates, and still draws every version once", () => {
  const rows = layoutVersions([v("v1", "v2"), v("v2", "v1"), v("v3", null)]);
  // The walk returns (that is the point), and the versions no root can reach
  // are drawn as roots rather than vanishing.
  assert.deepEqual(rowIds(rows).sort(), ["v1", "v2", "v3"]);
  assert.equal(new Set(rowIds(rows)).size, 3);
});

test("an empty history lays out as nothing", () => {
  assert.deepEqual(layoutVersions([]), []);
});
