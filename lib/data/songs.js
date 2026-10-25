// Songs, their version trees, templates, likes and compose chats, over D1.
//
// This is app/songs/actions.ts's logic with the Supabase client taken out.
// What Row Level Security used to guarantee is said here, in every query:
//
//   songs           the owner may do anything; anyone may READ a public one
//   song_versions   the owner only (no public read: publishing a song
//                   publishes the state chosen, not every draft behind it)
//   song_chats      the owner only, both ways
//   song_likes      your own, and only on a public song
//
// test/data.test.js holds these to the behaviour supabase/tests/rls_test.sql
// used to check. Every function takes `env` ({ DB, BLOBS }) and the caller's
// user id (null when signed out) and never trusts anything else about who is
// asking.

import { createHash, randomBytes } from "node:crypto";
import { all, bool, first, idList, isUnique, json, run, uuid } from "./db.js";
import { copySamples, dropPrefix, packJson, putSamples, songPrefix, unpackJson, withSamples } from "./blob.js";
import { extractSamples } from "../../app/songs/sampleStore.js";
import { previewFromSession } from "../../app/songs/songPreview.js";

export function newSlug() {
  return randomBytes(6).toString("base64url").replace(/[-_]/g, "").slice(0, 8) || randomBytes(4).toString("hex");
}

const hashData = (data) => createHash("sha256").update(JSON.stringify(data) ?? "").digest("hex");

/** The distinct engine keys a session is made of, buses left out (what
 *  Supabase migration 0019's song_engines computed). */
export function songEngines(d) {
  const keys = new Set();
  for (const t of Array.isArray(d?.tracks) ? d.tracks : []) {
    const k = t && typeof t === "object" ? t.engineKey : null;
    if (typeof k === "string" && k && k !== "bus") keys.add(k);
  }
  return [...keys].sort();
}

/** What the lists read without pulling `data`, computed when it is written. */
export function songColumns(stored) {
  const bpm = typeof stored?.bpm === "number" && Number.isFinite(stored.bpm) ? stored.bpm : null;
  let preview = null;
  try {
    preview = previewFromSession(stored);
  } catch {
    /* a card without a picture */
  }
  return { bpm, preview: preview ? JSON.stringify(preview) : null, engines: JSON.stringify(songEngines(stored)) };
}

const title200 = (t) => (t || "untitled").slice(0, 200);

function versionLabel(label) {
  const trimmed = (label ?? "").trim().slice(0, 120);
  return trimmed || null;
}

/**
 * Append a version to a song's tree and return its id. `parentId` is the
 * version the save was made FROM, which is what makes the history a tree.
 * A save identical to its parent returns the parent instead of inserting.
 */
async function appendVersion(env, { songId, ownerId, parentId, data, label }) {
  const hash = hashData(data);
  let parent = parentId;
  if (parent) {
    // Also the parent's existence check: a version id from a stale client, or
    // one belonging to another song, must not become a parent here.
    const row = await first(
      env.DB,
      "select id, seq, data_hash from song_versions where id = ?1 and song_id = ?2",
      parent,
      songId,
    );
    if (!row) parent = null;
    else if (row.data_hash === hash) return { versionId: row.id, seq: row.seq, unchanged: true };
  }
  const packed = await packJson(env.BLOBS, songPrefix(songId), data);
  // `seq` is unique per song; max()+1 inside the insert is one statement, and
  // a second tab racing it retries on the unique index.
  for (let attempt = 0; attempt < 5; attempt++) {
    const id = uuid();
    try {
      const row = await first(
        env.DB,
        `insert into song_versions (id, song_id, owner_id, parent_id, data, data_hash, seq, label)
         values (?1, ?2, ?3, ?4, ?5, ?6,
                 (select coalesce(max(seq), 0) + 1 from song_versions where song_id = ?2), ?7)
         returning seq`,
        id,
        songId,
        ownerId,
        parent,
        packed,
        hash,
        label ?? null,
      );
      return { versionId: id, seq: row?.seq };
    } catch (e) {
      if (!isUnique(e)) return { error: String(e?.message ?? e) };
    }
  }
  return { error: "could not allocate a version number" };
}

/** A free title for a name the USER DID NOT CHOOSE: "cold squelch", "cold squelch 2". */
async function freeTitle(env, ownerId, base) {
  const candidates = [base, ...Array.from({ length: 24 }, (_, i) => `${base} ${i + 2}`)];
  try {
    const rows = await all(
      env.DB,
      "select title from songs where owner_id = ?1 and title in (select value from json_each(?2))",
      ownerId,
      JSON.stringify(candidates),
    );
    const taken = new Set(rows.map((r) => r.title));
    const free = candidates.find((c) => !taken.has(c));
    return (free ?? `${base} ${Date.now().toString(36)}`).slice(0, 200);
  } catch {
    return base;
  }
}

async function ownedSongId(env, ownerId, id) {
  const row = await first(env.DB, "select id from songs where id = ?1 and owner_id = ?2", id, ownerId);
  return row?.id ?? null;
}

/** Insert a new song row (and its samples, and its first version). */
async function insertSong(env, ownerId, { title, stored, samples, forkedFrom, label, isPublic = false }) {
  const id = uuid();
  const cols = songColumns(stored);
  const packed = await packJson(env.BLOBS, songPrefix(id), stored);
  await run(
    env.DB,
    `insert into songs (id, owner_id, title, data, bpm, preview, engines, forked_from, is_public)
     values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
    id,
    ownerId,
    title,
    packed,
    cols.bpm,
    cols.preview,
    cols.engines,
    forkedFrom ?? null,
    isPublic ? 1 : 0,
  );
  try {
    await putSamples(env.BLOBS, id, samples);
  } catch (e) {
    // A song whose tracks point at samples that never arrived is worse than a
    // save that says it failed.
    await run(env.DB, "delete from songs where id = ?1", id);
    await dropPrefix(env.BLOBS, songPrefix(id)).catch(() => {});
    return { error: `could not store a sample: ${e?.message ?? e}` };
  }
  const ver = await appendVersion(env, { songId: id, ownerId, parentId: null, data: stored, label });
  if (ver.error) return { id, error: ver.error };
  await run(env.DB, "update songs set current_version_id = ?1 where id = ?2 and owner_id = ?3", ver.versionId, id, ownerId);
  return { id, versionId: ver.versionId, seq: ver.seq };
}

/** Update a song's data in place: samples, a new version, then the row. */
async function updateSongData(env, ownerId, songId, { stored, samples, parentId, label, title }) {
  await putSamples(env.BLOBS, songId, samples);
  const ver = await appendVersion(env, { songId, ownerId, parentId, data: stored, label });
  if (ver.error) return { error: ver.error };
  const cols = songColumns(stored);
  const packed = await packJson(env.BLOBS, songPrefix(songId), stored);
  const changed = await run(
    env.DB,
    `update songs set title = coalesce(?7, title), data = ?1, bpm = ?2, preview = ?3, engines = ?4, current_version_id = ?5
     where id = ?6 and owner_id = ?8`,
    packed,
    cols.bpm,
    cols.preview,
    cols.engines,
    ver.versionId,
    songId,
    title ?? null,
    ownerId,
  );
  if (!changed) return { error: "song not found" };
  return { versionId: ver.versionId, seq: ver.seq, unchanged: ver.unchanged };
}

/** Save the current song: update in place when `id` is owned, else insert. */
export async function saveSong(env, userId, input) {
  if (!userId) return { error: "not signed in" };
  const fromTemplate = !!input.fromTemplateId;
  const songId = fromTemplate ? undefined : input.id;
  const { data: stored, samples } = extractSamples(input.data);
  const remixedFrom = fromTemplate ? await ownedSongId(env, userId, input.fromTemplateId) : null;

  let title = title200(input.title);
  if (input.titleGenerated && !songId) title = await freeTitle(env, userId, title);

  if (songId) {
    const song = await first(env.DB, "select current_version_id from songs where id = ?1 and owner_id = ?2", songId, userId);
    if (!song) return { error: "song not found" };
    const parentId = input.parentVersionId !== undefined ? input.parentVersionId : song.current_version_id;
    try {
      const r = await updateSongData(env, userId, songId, {
        stored,
        samples,
        parentId,
        label: versionLabel(input.label),
        title,
      });
      if (r.error) return { id: songId, error: r.error };
      return { id: songId, title, versionId: r.versionId, versionSeq: r.seq, unchanged: r.unchanged };
    } catch (e) {
      return { id: songId, error: String(e?.message ?? e) };
    }
  }

  const made = await insertSong(env, userId, {
    title,
    stored,
    samples,
    forkedFrom: remixedFrom,
    label: versionLabel(input.label) ?? (fromTemplate ? "from template" : "first save"),
  });
  if (made.error) return { id: made.id, title, error: made.error };
  return { id: made.id, title, versionId: made.versionId, versionSeq: made.seq };
}

/** The readable song row: the owner's, or anyone's if public. */
async function readableSong(env, userId, id, cols) {
  return first(
    env.DB,
    `select ${cols} from songs where id = ?1 and (is_public = 1 or owner_id = ?2)`,
    id,
    userId ?? "",
  );
}

/** Remix a public (or owned) song into the caller's account, as a new tree. */
export async function remixSong(env, userId, sourceId, sourceVersionId) {
  if (!userId) return { error: "not signed in" };
  const src = await readableSong(env, userId, sourceId, "title, data");
  if (!src) return { error: "that song was not found" };

  let data = await unpackJson(env.BLOBS, src.data);
  let suffix = "remix";
  if (sourceVersionId) {
    // Only your own versions are readable.
    const ver = await first(
      env.DB,
      "select data, seq from song_versions where id = ?1 and song_id = ?2 and owner_id = ?3",
      sourceVersionId,
      sourceId,
      userId,
    );
    if (!ver) return { error: "version not found" };
    data = await unpackJson(env.BLOBS, ver.data);
    suffix = `v${ver.seq}`;
  }

  // The source's samples hang off the SOURCE song; a source saved with them
  // inline comes out stored the new way.
  const { data: stored, samples } = extractSamples(await withSamples(env.BLOBS, sourceId, data));
  const title = `${src.title} (${suffix})`.slice(0, 200);
  const made = await insertSong(env, userId, {
    title,
    stored,
    samples,
    forkedFrom: sourceId,
    label: sourceVersionId ? `remixed from ${suffix}` : "remixed",
  });
  if (made.error) return { id: made.id, title, error: made.error };
  return { id: made.id, title, versionId: made.versionId };
}

/** Save under a name (upserting the owner's song of that name), public or not. */
export async function saveNamedSong(env, userId, input) {
  if (!userId) return { error: "not signed in" };
  const fromTemplate = !!input.fromTemplateId;
  const remixedFrom = fromTemplate ? await ownedSongId(env, userId, input.fromTemplateId) : null;

  let title = title200(input.title);
  if (input.titleGenerated || fromTemplate) title = await freeTitle(env, userId, title);

  const existing = fromTemplate
    ? null
    : await first(
        env.DB,
        "select id, share_slug, current_version_id from songs where owner_id = ?1 and title = ?2 order by updated_at desc limit 1",
        userId,
        title,
      );
  let id = existing?.id;
  let slug = existing?.share_slug ?? null;

  const { data: stored, samples } = extractSamples(input.data);
  let versionId, versionSeq, unchanged;
  if (id) {
    try {
      const r = await updateSongData(env, userId, id, {
        stored,
        samples,
        parentId: input.parentVersionId !== undefined ? input.parentVersionId : (existing.current_version_id ?? null),
      });
      if (r.error) return { id, error: r.error };
      ({ versionId, seq: versionSeq, unchanged } = r);
    } catch (e) {
      return { id, error: String(e?.message ?? e) };
    }
  } else {
    const made = await insertSong(env, userId, {
      title,
      stored,
      samples,
      forkedFrom: remixedFrom,
      label: fromTemplate ? "from template" : "first save",
    });
    if (made.error) return { id: made.id, error: made.error };
    id = made.id;
    versionId = made.versionId;
    versionSeq = made.seq;
  }

  if (input.isPublic) {
    if (!slug) {
      const pub = await publishSong(env, userId, id);
      if (pub.error) return { error: pub.error };
      slug = pub.slug;
    } else {
      const changed = await run(env.DB, "update songs set is_public = 1 where id = ?1 and owner_id = ?2", id, userId);
      if (!changed) return { error: "song not found" };
    }
    return { id, title, slug: slug ?? undefined, versionId, versionSeq, unchanged };
  }
  const changed = await run(env.DB, "update songs set is_public = 0 where id = ?1 and owner_id = ?2", id, userId);
  if (!changed) return { error: "song not found" };
  return { id, title, versionId, versionSeq, unchanged };
}

const LIST_COLS =
  "id, title, updated_at, is_public, share_slug, current_version_id, is_template, is_default_template, preview";

export const songListItem = (r) => ({
  id: r.id,
  title: r.title,
  updated_at: r.updated_at,
  is_public: bool(r.is_public),
  share_slug: r.share_slug ?? null,
  current_version_id: r.current_version_id ?? null,
  is_template: bool(r.is_template),
  is_default_template: bool(r.is_default_template),
  preview: json(r.preview),
});

export async function listSongs(env, userId) {
  if (!userId) return { songs: [] };
  const rows = await all(env.DB, `select ${LIST_COLS} from songs where owner_id = ?1 order by updated_at desc`, userId);
  return { songs: rows.map(songListItem) };
}

/** A song's data: the owner's, or anyone's if public. */
export async function loadSong(env, userId, id) {
  const row = await readableSong(env, userId, id, "title, data, owner_id, current_version_id, is_template");
  if (!row) return { error: "song not found" };
  const owned = !!userId && row.owner_id === userId;
  return {
    title: row.title,
    data: await withSamples(env.BLOBS, id, await unpackJson(env.BLOBS, row.data)),
    versionId: row.current_version_id ?? null,
    owned,
    isTemplate: owned && bool(row.is_template),
  };
}

// ---- templates -------------------------------------------------------------

export async function setSongTemplate(env, userId, id, isTemplate) {
  if (!userId) return { error: "not signed in" };
  const changed = await run(
    env.DB,
    isTemplate
      ? "update songs set is_template = 1 where id = ?1 and owner_id = ?2"
      : "update songs set is_template = 0, is_default_template = 0 where id = ?1 and owner_id = ?2",
    id,
    userId,
  );
  if (!changed) return { error: "song not found" };
  return { ok: true };
}

export async function setDefaultTemplate(env, userId, id) {
  if (!userId) return { error: "not signed in" };
  await run(env.DB, "update songs set is_default_template = 0 where owner_id = ?1 and is_default_template = 1", userId);
  if (!id) return { ok: true };
  const changed = await run(
    env.DB,
    "update songs set is_template = 1, is_default_template = 1 where id = ?1 and owner_id = ?2",
    id,
    userId,
  );
  if (!changed) return { error: "song not found" };
  return { ok: true };
}

export async function getDefaultTemplate(env, userId) {
  if (!userId) return { template: null };
  const row = await first(
    env.DB,
    "select id, title, data, current_version_id from songs where owner_id = ?1 and is_default_template = 1",
    userId,
  );
  if (!row) return { template: null };
  return {
    template: {
      id: row.id,
      title: row.title,
      data: await withSamples(env.BLOBS, row.id, await unpackJson(env.BLOBS, row.data)),
      versionId: row.current_version_id ?? null,
    },
  };
}

// ---- versions ----------------------------------------------------------------

export async function getVersionSeq(env, userId, versionId) {
  if (!userId) return { error: "not signed in" };
  const row = await first(env.DB, "select seq from song_versions where id = ?1 and owner_id = ?2", versionId, userId);
  if (!row) return { error: "version not found" };
  return { seq: row.seq };
}

export async function listVersions(env, userId, songId) {
  if (!userId) return { versions: [] };
  const versions = await all(
    env.DB,
    "select id, parent_id, seq, label, created_at from song_versions where song_id = ?1 and owner_id = ?2 order by created_at asc, seq asc",
    songId,
    userId,
  );
  const song = await first(env.DB, "select current_version_id from songs where id = ?1 and owner_id = ?2", songId, userId);
  return { versions, currentId: song?.current_version_id ?? null };
}

export async function loadVersion(env, userId, versionId) {
  if (!userId) return { error: "not signed in" };
  const row = await first(
    env.DB,
    "select v.song_id, v.seq, v.data, s.title from song_versions v join songs s on s.id = v.song_id where v.id = ?1 and v.owner_id = ?2",
    versionId,
    userId,
  );
  if (!row) return { error: "version not found" };
  return {
    songId: row.song_id,
    title: row.title ?? undefined,
    seq: row.seq,
    data: await withSamples(env.BLOBS, row.song_id, await unpackJson(env.BLOBS, row.data)),
  };
}

export async function labelVersion(env, userId, versionId, label) {
  if (!userId) return { error: "not signed in" };
  const trimmed = String(label ?? "").trim().slice(0, 120);
  const changed = await run(
    env.DB,
    "update song_versions set label = ?1 where id = ?2 and owner_id = ?3",
    trimmed || null,
    versionId,
    userId,
  );
  if (!changed) return { error: "version not found" };
  return { ok: true };
}

/** Prune one version; refused for the tip and for any version with children
 *  (parent_id cascades, so the branch would go with it). */
export async function deleteVersion(env, userId, versionId) {
  if (!userId) return { error: "not signed in" };
  const ver = await first(env.DB, "select id, song_id from song_versions where id = ?1 and owner_id = ?2", versionId, userId);
  if (!ver) return { error: "version not found" };
  const song = await first(env.DB, "select current_version_id from songs where id = ?1 and owner_id = ?2", ver.song_id, userId);
  if (song?.current_version_id === versionId) return { error: "that is the current version" };
  const kid = await first(env.DB, "select id from song_versions where parent_id = ?1 limit 1", versionId);
  if (kid) return { error: "delete the branches off it first" };
  const changed = await run(env.DB, "delete from song_versions where id = ?1 and owner_id = ?2", versionId, userId);
  if (!changed) return { error: "version not found" };
  return { ok: true };
}

// ---- the song itself -----------------------------------------------------------

export async function renameSong(env, userId, id, title) {
  if (!userId) return { error: "not signed in" };
  const changed = await run(env.DB, "update songs set title = ?1 where id = ?2 and owner_id = ?3", title200(title), id, userId);
  if (!changed) return { error: "song not found" };
  return { ok: true };
}

export async function deleteSong(env, userId, id) {
  if (!userId) return { error: "not signed in" };
  const changed = await run(env.DB, "delete from songs where id = ?1 and owner_id = ?2", id, userId);
  if (!changed) return { error: "song not found" };
  await dropPrefix(env.BLOBS, songPrefix(id)).catch(() => {});
  return { ok: true };
}

/** Mark public and make sure it has a share slug. */
export async function publishSong(env, userId, id) {
  if (!userId) return { error: "not signed in" };
  const existing = await first(env.DB, "select share_slug from songs where id = ?1 and owner_id = ?2", id, userId);
  if (!existing) return { error: "song not found" };
  let slug = existing.share_slug ?? null;
  for (let attempt = 0; !slug && attempt < 5; attempt++) {
    const candidate = newSlug();
    try {
      const changed = await run(
        env.DB,
        "update songs set is_public = 1, share_slug = ?1 where id = ?2 and owner_id = ?3",
        candidate,
        id,
        userId,
      );
      if (!changed) return { error: "song not found" };
      slug = candidate;
    } catch (e) {
      if (!isUnique(e)) return { error: String(e?.message ?? e) };
    }
  }
  if (!slug) return { error: "could not allocate a share link" };
  const changed = await run(env.DB, "update songs set is_public = 1 where id = ?1 and owner_id = ?2", id, userId);
  if (!changed) return { error: "song not found" };
  return { slug };
}

export async function unpublishSong(env, userId, id) {
  if (!userId) return { error: "not signed in" };
  const changed = await run(env.DB, "update songs set is_public = 0 where id = ?1 and owner_id = ?2", id, userId);
  if (!changed) return { error: "song not found" };
  return { ok: true };
}

// ---- compose chats: the author's alone -------------------------------------------

export async function loadSongChat(env, userId, songId) {
  if (!userId) return { error: "not signed in" };
  const row = await first(env.DB, "select messages from song_chats where song_id = ?1 and owner_id = ?2", songId, userId);
  return { messages: row ? ((await unpackJson(env.BLOBS, row.messages)) ?? []) : [] };
}

export async function saveSongChat(env, userId, songId, messages) {
  if (!userId) return { error: "not signed in" };
  // The song must be the caller's (what the RLS check on 0011 said).
  if (!(await ownedSongId(env, userId, songId))) return { error: "song not found" };
  const packed = await packJson(env.BLOBS, `${songPrefix(songId)}chat/`, Array.isArray(messages) ? messages : []);
  await run(
    env.DB,
    `insert into song_chats (song_id, owner_id, messages, updated_at)
     values (?1, ?2, ?3, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
     on conflict (song_id) do update set messages = excluded.messages, updated_at = excluded.updated_at
     where song_chats.owner_id = excluded.owner_id`,
    songId,
    userId,
    packed,
  );
  return { ok: true };
}

// ---- likes ---------------------------------------------------------------------------

/** How many hearts a readable song has. */
export async function songLikes(env, songId) {
  const row = await first(env.DB, "select count(*) as n from song_likes where song_id = ?1", songId);
  return Number(row?.n ?? 0);
}

/** Heart a PUBLIC song, or take the heart back. Idempotent both ways. */
export async function setLike(env, userId, songId, liked) {
  if (!userId) return { error: "not signed in" };
  if (liked) {
    const changed = await run(
      env.DB,
      `insert into song_likes (song_id, user_id)
       select id, ?2 from songs where id = ?1 and is_public = 1
       on conflict do nothing`,
      songId,
      userId,
    );
    if (!changed) {
      const ok = await first(env.DB, "select 1 as ok from songs where id = ?1 and is_public = 1", songId);
      if (!ok) return { error: "song not found" };
    }
  } else {
    await run(env.DB, "delete from song_likes where song_id = ?1 and user_id = ?2", songId, userId);
  }
  return { liked, likes: await songLikes(env, songId) };
}

/** Which of these songs the caller has hearted. */
export async function likedSongs(env, userId, ids) {
  if (!userId || !ids.length) return [];
  const rows = await all(
    env.DB,
    "select song_id from song_likes where user_id = ?1 and song_id in (select value from json_each(?2))",
    userId,
    idList(ids),
  );
  return rows.map((r) => r.song_id);
}
