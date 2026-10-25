// Patches: the account's patch bay, the public gallery, and hearts on them.
//
// The rules Row Level Security used to hold, said here in each query:
//   patches       the owner may do anything; anyone may READ a public one
//   patch_likes   your own, and only on a public patch

import { all, bool, first, idList, json, run, uuid } from "./db.js";
import { dropPrefix, packJson, patchPrefix, unpackJson } from "./blob.js";

/** The engine type the gallery has always shown for a config. */
export function engineTypeOf(config) {
  const c = config && typeof config === "object" ? config : null;
  return (
    (typeof c?.engineKey === "string" && c.engineKey) ||
    (typeof c?.type === "string" && c.type) ||
    (typeof c?.synth?.type === "string" && c.synth.type) ||
    null
  );
}

/** What the cards and the bay index read out of a config, stored beside it. */
export function patchColumns(config) {
  const c = config && typeof config === "object" ? config : {};
  return {
    engine_type: engineTypeOf(config),
    engine_key: typeof c.engineKey === "string" ? c.engineKey : null,
    kind: typeof c._kind === "string" ? c._kind : null,
    drum: c.isDrumKit === undefined ? null : JSON.stringify(c.isDrumKit),
    sample: typeof c.sampleSource?.id === "string" ? c.sampleSource.id : null,
  };
}

async function insertPatch(env, ownerId, { name, config, savedFrom = null }) {
  const id = uuid();
  const cols = patchColumns(config);
  const packed = await packJson(env.BLOBS, patchPrefix(id), config);
  await run(
    env.DB,
    `insert into patches (id, owner_id, name, engine_type, config, engine_key, kind, drum, sample, is_public, saved_from)
     values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 0, ?10)`,
    id,
    ownerId,
    name.slice(0, 120),
    cols.engine_type,
    packed,
    cols.engine_key,
    cols.kind,
    cols.drum,
    cols.sample,
    savedFrom,
  );
  return id;
}

/** A name not already in this account's bay: `name`, `name 2`, ... */
async function freeName(env, ownerId, base) {
  const rows = await all(env.DB, "select name from patches where owner_id = ?1", ownerId);
  const taken = new Set(rows.map((r) => r.name));
  let name = base.slice(0, 120);
  for (let i = 2; taken.has(name); i++) name = `${base} ${i}`.slice(0, 120);
  return name;
}

/** Save someone's published patch into your own bay, as a private copy that
 *  remembers where it came from, so a second save finds the first. */
export async function savePatchToBay(env, userId, sourceId) {
  if (!userId) return { error: "not signed in" };
  const src = await first(
    env.DB,
    "select id, owner_id, name, config from patches where id = ?1 and (is_public = 1 or owner_id = ?2)",
    sourceId,
    userId,
  );
  if (!src) return { error: "patch not found" };
  if (src.owner_id === userId) return { id: src.id, name: src.name, already: true };
  const prior = await first(
    env.DB,
    "select id, name from patches where owner_id = ?1 and saved_from = ?2 limit 1",
    userId,
    sourceId,
  );
  if (prior) return { id: prior.id, name: prior.name, already: true };
  const name = await freeName(env, userId, src.name);
  const config = await unpackJson(env.BLOBS, src.config);
  const id = await insertPatch(env, userId, { name, config, savedFrom: sourceId });
  return { id, name };
}

export async function setPatchPublic(env, userId, id, isPublic) {
  if (!userId) return { error: "not signed in" };
  const changed = await run(
    env.DB,
    "update patches set is_public = ?1 where id = ?2 and owner_id = ?3",
    isPublic ? 1 : 0,
    id,
    userId,
  );
  if (!changed) return { error: "patch not found" };
  return { ok: true };
}

export async function listMyPatches(env, userId) {
  if (!userId) return { patches: [] };
  const rows = await all(
    env.DB,
    "select id, name, engine_type, is_public, created_at from patches where owner_id = ?1 order by created_at desc",
    userId,
  );
  return { patches: rows.map((r) => ({ ...r, is_public: bool(r.is_public) })) };
}

export async function deletePatch(env, userId, id) {
  if (!userId) return { error: "not signed in" };
  const changed = await run(env.DB, "delete from patches where id = ?1 and owner_id = ?2", id, userId);
  if (!changed) return { error: "patch not found" };
  await dropPrefix(env.BLOBS, patchPrefix(id)).catch(() => {});
  return { ok: true };
}

// ---- the studio's bay ------------------------------------------------------

/** The account's patches, newest first and one per name, with configs only
 *  for the small legacy ones (a custom-Tone patch is built as an engine). */
export async function bayIndex(env, userId) {
  if (!userId) return null;
  const rows = await all(
    env.DB,
    "select id, name, engine_key, kind, config from patches where owner_id = ?1 order by updated_at desc",
    userId,
  );
  const seen = new Set();
  const list = [];
  for (const r of rows) {
    if (seen.has(r.name)) continue;
    seen.add(r.name);
    const entry = { id: r.id, name: r.name, engineKey: r.engine_key ?? null, kind: r.kind ?? null };
    if (r.kind !== "track-patch") entry.config = await unpackJson(env.BLOBS, r.config);
    list.push(entry);
  }
  return list;
}

/** One of the caller's patches' config, or a public one's. */
export async function patchConfig(env, userId, id) {
  const row = await first(
    env.DB,
    "select config from patches where id = ?1 and (is_public = 1 or owner_id = ?2)",
    id,
    userId ?? "",
  );
  if (!row) return { error: "patch not found" };
  return { config: await unpackJson(env.BLOBS, row.config) };
}

/** Save by name, as the studio always has: the patch of that name is
 *  replaced, else a private one is made. Returns its id. */
export async function putPatch(env, userId, name, config) {
  if (!userId) return { error: "sign in to save patches" };
  name = String(name ?? "").slice(0, 120);
  if (!name) return { error: "a patch needs a name" };
  const existing = await first(
    env.DB,
    "select id from patches where owner_id = ?1 and name = ?2 order by updated_at desc limit 1",
    userId,
    name,
  );
  if (!existing) return { id: await insertPatch(env, userId, { name, config }) };
  const cols = patchColumns(config);
  const packed = await packJson(env.BLOBS, patchPrefix(existing.id), config);
  await run(
    env.DB,
    `update patches set config = ?1, engine_type = ?2, engine_key = ?3, kind = ?4, drum = ?5, sample = ?6
     where id = ?7 and owner_id = ?8`,
    packed,
    cols.engine_type,
    cols.engine_key,
    cols.kind,
    cols.drum,
    cols.sample,
    existing.id,
    userId,
  );
  return { id: existing.id };
}

/** Bring a browser's old localStorage patches into the account (bay.ts). A
 *  patch the account already holds under that name is skipped when identical
 *  and saved beside it as `name 2` when not. Returns the names that made it. */
export async function importPatches(env, userId, local) {
  if (!userId) return { error: "not signed in" };
  const moved = [];
  const rows = await all(env.DB, "select id, name, config from patches where owner_id = ?1", userId);
  const taken = new Map(rows.map((r) => [r.name, r]));
  for (const [name, config] of Object.entries(local ?? {})) {
    try {
      const have = taken.get(name);
      if (have && canonical(await unpackJson(env.BLOBS, have.config)) === canonical(config)) {
        moved.push(name);
        continue;
      }
      let as = name.slice(0, 120);
      for (let i = 2; taken.has(as); i++) as = `${name} ${i}`.slice(0, 120);
      const id = await insertPatch(env, userId, { name: as, config });
      taken.set(as, { id, name: as, config: "null" });
      moved.push(name);
    } catch {
      /* stays in the browser for next time */
    }
  }
  return { moved };
}

// Key order is not meaningful in a config, so "the same patch" is compared on
// sorted keys.
function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`)
      .join(",")}}`;
  return JSON.stringify(v) ?? "null";
}

/** The fields a patch card reads, from a row selected with the extracted columns. */
export const patchCardFields = (r) => ({
  kind: r.kind ?? null,
  engine: r.engine_key ?? null,
  drum: json(r.drum),
  sample: r.sample ?? null,
});

// ---- likes ---------------------------------------------------------------------

export async function patchLikes(env, patchId) {
  const row = await first(env.DB, "select count(*) as n from patch_likes where patch_id = ?1", patchId);
  return Number(row?.n ?? 0);
}

export async function setPatchLike(env, userId, patchId, liked) {
  if (!userId) return { error: "not signed in" };
  if (liked) {
    const changed = await run(
      env.DB,
      `insert into patch_likes (patch_id, user_id)
       select id, ?2 from patches where id = ?1 and is_public = 1
       on conflict do nothing`,
      patchId,
      userId,
    );
    if (!changed) {
      const ok = await first(env.DB, "select 1 as ok from patches where id = ?1 and is_public = 1", patchId);
      if (!ok) return { error: "patch not found" };
    }
  } else {
    await run(env.DB, "delete from patch_likes where patch_id = ?1 and user_id = ?2", patchId, userId);
  }
  return { liked, likes: await patchLikes(env, patchId) };
}

export async function likedPatches(env, userId, ids) {
  if (!userId || !ids.length) return [];
  const rows = await all(
    env.DB,
    "select patch_id from patch_likes where user_id = ?1 and patch_id in (select value from json_each(?2))",
    userId,
    idList(ids),
  );
  return rows.map((r) => r.patch_id);
}

/** Which of these patches the caller already has a copy of (SavePatchButton). */
export async function savedFrom(env, userId, ids) {
  if (!userId || !ids.length) return [];
  const rows = await all(
    env.DB,
    `select id as src from patches where owner_id = ?1 and id in (select value from json_each(?2))
     union select saved_from as src from patches where owner_id = ?1 and saved_from in (select value from json_each(?2))`,
    userId,
    idList(ids),
  );
  return rows.map((r) => r.src);
}
