// Laying a version tree out as rows. Plain JS with JSDoc types, and no imports,
// for the same reason sessionFormat.js is: it is pure, so `node --test` can
// exercise it without a browser or a React renderer.

/**
 * @typedef {{ id: string, parent_id: string|null, seq: number,
 *             label: string|null, created_at: string }} SongVersion
 * @typedef {{ v: SongVersion, depth: number, branch: boolean }} VersionRow
 */

/**
 * Flatten a version tree into the order it is drawn: each root followed by its
 * descendants, oldest child first, so a branch reads downwards from the version
 * it left.
 *
 * `branch` marks a version whose parent has more than one child -- the only
 * place the history stops being a line, and the only thing a reader needs
 * pointing out.
 *
 * A version whose parent is not in the list (a pruned ancestor, or a page of
 * rows that does not reach the root) is treated as a root rather than dropped:
 * a version that cannot be drawn is a version you cannot get back to.
 *
 * @param {SongVersion[]} versions rows for one song, any order
 * @returns {VersionRow[]}
 */
export function layoutVersions(versions) {
  const byId = new Map(versions.map((v) => [v.id, v]));
  /** @type {Map<string, SongVersion[]>} */
  const kids = new Map();
  /** @type {SongVersion[]} */
  const roots = [];
  for (const v of versions) {
    const parent = v.parent_id && byId.has(v.parent_id) ? v.parent_id : null;
    if (!parent) {
      roots.push(v);
      continue;
    }
    const list = kids.get(parent);
    if (list) list.push(v);
    else kids.set(parent, [v]);
  }

  /** @type {VersionRow[]} */
  const out = [];
  const seen = new Set();
  /** @param {SongVersion} v @param {number} depth @param {boolean} branch */
  const walk = (v, depth, branch) => {
    // A hand-edited parent chain could close a loop; walking it would hang the
    // menu rather than show a wrong picture.
    if (seen.has(v.id)) return;
    seen.add(v.id);
    out.push({ v, depth, branch });
    const children = kids.get(v.id) ?? [];
    for (const c of children) walk(c, depth + 1, children.length > 1);
  };
  for (const r of roots) walk(r, 0, roots.length > 1);
  // Anything a root could not reach -- only possible if parent_id closes a loop
  // -- is drawn as a root of its own. Every version gets exactly one row, which
  // is the invariant that matters: a version with no row is one you cannot get
  // back to.
  for (const v of versions) if (!seen.has(v.id)) walk(v, 0, false);
  return out;
}
