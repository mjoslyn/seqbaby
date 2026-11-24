// Recorded live sets (db/migrations/0003_sets.sql). The recording is in R2
// under sets/<id>/set.json; the row is what a list, a card or the player's
// header needs. Readable by its owner, or by anyone once public; written by
// its owner only. test/data.test.js holds each rule.

import { all, bool, first, run, uuid } from "./db.js";
import { dropPrefix } from "./blob.js";
import { checkRecording as validateRecording, recordingSummary as summarizeRecording } from "../setRecording.js";

export const setPrefix = (id) => `sets/${id}/`;
const setKey = (id) => `${setPrefix(id)}set.json`;

const cleanTitle = (t) => String(t ?? "").replace(/\s+/g, " ").trim().slice(0, 120);

const metaOf = (r) => ({
  id: r.id,
  title: r.title,
  ownerId: r.owner_id,
  songId: r.song_id ?? null,
  forkedFrom: r.forked_from ?? null,
  forkStep: r.fork_step ?? null,
  bpm: r.bpm ?? null,
  seconds: r.seconds ?? 0,
  steps: r.steps ?? 0,
  events: r.events ?? 0,
  decks: r.decks ?? 0,
  isPublic: bool(r.is_public),
  createdAt: r.created_at,
});

const COLS = "id, owner_id, title, song_id, forked_from, fork_step, bpm, seconds, steps, events, decks, is_public, created_at";

/**
 * Store a recording as a new set of the caller's.
 * @param {{title?: string, recording: any, songId?: string|null, forkedFrom?: string|null, forkStep?: number|null, isPublic?: boolean}} input
 */
export async function saveSet(env, userId, input) {
  if (!userId) return { error: "sign in to save a set" };
  const rec = input?.recording;
  const check = validateRecording(rec);
  if (!check.ok) return { error: `not a readable set: ${check.errors.slice(0, 3).join("; ")}` };
  const title = cleanTitle(input.title) || "untitled set";
  // A song or a set named here must be one the caller could name: their own
  // song, a set of theirs or a public one. Anything else is dropped, not refused.
  let songId = null;
  if (typeof input.songId === "string" && input.songId) {
    const s = await first(env.DB, "select id from songs where id = ?1 and owner_id = ?2", input.songId, userId);
    songId = s?.id ?? null;
  }
  let forkedFrom = null;
  if (typeof input.forkedFrom === "string" && input.forkedFrom) {
    const s = await first(env.DB, "select id from sets where id = ?1 and (owner_id = ?2 or is_public = 1)", input.forkedFrom, userId);
    forkedFrom = s?.id ?? null;
  }
  const forkStep = forkedFrom && Number.isInteger(input.forkStep) && input.forkStep >= 0 ? input.forkStep : null;
  const sum = summarizeRecording(rec);
  const id = uuid();
  await env.BLOBS.put(setKey(id), JSON.stringify(rec));
  try {
    await run(
      env.DB,
      `insert into sets (id, owner_id, title, song_id, forked_from, fork_step, bpm, seconds, steps, events, decks, is_public)
       values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`,
      id, userId, title, songId, forkedFrom, forkStep, sum.bpm, sum.seconds, sum.steps, sum.events, sum.decks, input.isPublic ? 1 : 0,
    );
  } catch (e) {
    await dropPrefix(env.BLOBS, setPrefix(id)).catch(() => {});
    throw e;
  }
  return { id, title };
}

/** A set's row, for its owner or anyone when public; null otherwise. */
export async function setMeta(env, userId, id) {
  const r = await first(env.DB, `select ${COLS} from sets where id = ?1 and (is_public = 1 or owner_id = ?2)`, String(id ?? ""), userId ?? "");
  if (!r) return null;
  return { ...metaOf(r), owned: !!userId && r.owner_id === userId };
}

/** A set's recording, under the same rule as its row. */
export async function loadSet(env, userId, id) {
  const meta = await setMeta(env, userId, id);
  if (!meta) return { error: "set not found" };
  const obj = await env.BLOBS.get(setKey(meta.id));
  if (!obj) return { error: "the recording is missing" };
  return { set: meta, recording: JSON.parse(await obj.text()) };
}

export async function listMySets(env, userId) {
  if (!userId) return { sets: [] };
  const rows = await all(env.DB, `select ${COLS} from sets where owner_id = ?1 order by created_at desc`, userId);
  return { sets: rows.map(metaOf) };
}

/** Someone's public sets, newest first (a profile page). */
export async function listPublicSets(env, ownerId, limit = 50) {
  const rows = await all(
    env.DB,
    `select ${COLS} from sets where owner_id = ?1 and is_public = 1 order by created_at desc limit ?2`,
    ownerId,
    Math.max(1, Math.min(200, limit | 0)),
  );
  return rows.map(metaOf);
}

export async function setSetPublic(env, userId, id, isPublic) {
  if (!userId) return { error: "not signed in" };
  const n = await run(env.DB, "update sets set is_public = ?1 where id = ?2 and owner_id = ?3", isPublic ? 1 : 0, id, userId);
  return n ? { ok: true } : { error: "set not found" };
}

export async function renameSet(env, userId, id, title) {
  if (!userId) return { error: "not signed in" };
  title = cleanTitle(title);
  if (!title) return { error: "a set needs a name" };
  const n = await run(env.DB, "update sets set title = ?1 where id = ?2 and owner_id = ?3", title, id, userId);
  return n ? { ok: true, title } : { error: "set not found" };
}

export async function deleteSet(env, userId, id) {
  if (!userId) return { error: "not signed in" };
  const n = await run(env.DB, "delete from sets where id = ?1 and owner_id = ?2", id, userId);
  if (!n) return { error: "set not found" };
  await dropPrefix(env.BLOBS, setPrefix(id)).catch(() => {});
  return { ok: true };
}
