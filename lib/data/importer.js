// Rows from the Supabase database, written into D1 and R2. Run once, by
// scripts/migrate-from-supabase.mjs through /api/admin/import, so every row
// goes through the same helpers the app writes with: big values to R2
// (packJson), samples lifted out of sessions (extractSamples / putSamples),
// the list columns computed (songColumns, patchColumns).
//
// Every insert is `on conflict do nothing`, so a run that stopped half way can
// simply be run again. Order matters only for foreign keys, and the script
// sends the kinds in order: users, songs, samples, versions, song links,
// chats, likes, patches, patch links, patch likes.

import { createHash } from "node:crypto";
import { run } from "./db.js";
import { packJson, patchPrefix, putSamples, songPrefix } from "./blob.js";
import { songColumns } from "./songs.js";
import { patchColumns } from "./patches.js";
import { extractSamples } from "../../app/songs/sampleStore.js";
import { nameBase } from "../auth/nameBase.js";

const iso = (v) => (v ? new Date(v).toISOString() : new Date().toISOString());
const b = (v) => (v ? 1 : 0);
const hashData = (data) => createHash("sha256").update(JSON.stringify(data) ?? "").digest("hex");

/** One Supabase auth user plus their profile: a Better Auth user, its
 *  password account (the bcrypt hash carries over), and the profile. */
async function importUser(env, u) {
  const created = iso(u.created_at);
  await run(
    env.DB,
    `insert into "user" (id, name, email, emailVerified, image, createdAt, updatedAt)
     values (?1, '', ?2, ?3, null, ?4, ?5) on conflict do nothing`,
    u.id,
    String(u.email).toLowerCase(),
    b(u.email_confirmed_at),
    created,
    iso(u.updated_at ?? u.created_at),
  );
  if (u.encrypted_password) {
    await run(
      env.DB,
      `insert into account (id, accountId, providerId, userId, password, createdAt, updatedAt)
       select ?1, ?2, 'credential', ?2, ?3, ?4, ?4
       where not exists (select 1 from account where userId = ?2 and providerId = 'credential')`,
      crypto.randomUUID(),
      u.id,
      u.encrypted_password,
      created,
    );
  }
  const p = u.profile ?? {};
  const username = p.username || nameBase(String(u.email).split("@")[0]);
  await run(
    env.DB,
    `insert into profiles (id, username, display_name, avatar_url, avatar_grid, bio, is_public, created_at, updated_at)
     values (?1, ?2, ?2, ?3, ?4, ?5, ?6, ?7, ?8) on conflict do nothing`,
    u.id,
    username,
    p.avatar_url ?? null,
    p.avatar_grid ?? null,
    p.bio ?? null,
    p.is_public === false ? 0 : 1,
    iso(p.created_at ?? u.created_at),
    iso(p.updated_at ?? u.updated_at ?? u.created_at),
  );
}

/** A song and its samples. Its tip (current_version_id) is set by `tips`,
 *  once its versions exist. */
async function importSong(env, s) {
  const samples = new Map(Object.entries(s.samples ?? {}));
  const { data: stored, samples: inline } = extractSamples(s.data);
  for (const [h, payload] of inline) samples.set(h, payload);
  await putSamples(env.BLOBS, s.id, samples);
  const cols = songColumns(stored);
  await run(
    env.DB,
    `insert into songs (id, owner_id, title, data, bpm, preview, engines, is_public, share_slug, forked_from,
                        is_template, is_default_template, created_at, updated_at)
     values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, null, ?10, ?11, ?12, ?13) on conflict do nothing`,
    s.id,
    s.owner_id,
    String(s.title || "untitled").slice(0, 200),
    await packJson(env.BLOBS, songPrefix(s.id), stored),
    cols.bpm,
    cols.preview,
    cols.engines,
    b(s.is_public),
    s.share_slug ?? null,
    b(s.is_template),
    b(s.is_default_template),
    iso(s.created_at),
    iso(s.updated_at),
  );
}

async function importVersion(env, v) {
  const { data: stored, samples } = extractSamples(v.data);
  await putSamples(env.BLOBS, v.song_id, samples);
  await run(
    env.DB,
    `insert into song_versions (id, song_id, owner_id, parent_id, data, data_hash, seq, label, created_at)
     values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9) on conflict do nothing`,
    v.id,
    v.song_id,
    v.owner_id,
    v.parent_id ?? null,
    await packJson(env.BLOBS, songPrefix(v.song_id), stored),
    hashData(stored),
    v.seq,
    v.label ?? null,
    iso(v.created_at),
  );
}

/** What a song points back at, once everything it points at exists. The
 *  write stamps updated_at, so the song's own date is put back after it (a
 *  write of updated_at alone does not fire the trigger). */
async function importSongLinks(env, s) {
  await run(
    env.DB,
    `update songs set current_version_id = (select id from song_versions where id = ?2),
                      forked_from = (select id from songs where id = ?3)
     where id = ?1`,
    s.id,
    s.current_version_id ?? null,
    s.forked_from ?? null,
  );
  await run(env.DB, "update songs set updated_at = ?2 where id = ?1", s.id, iso(s.updated_at));
}

async function importChat(env, c) {
  await run(
    env.DB,
    `insert into song_chats (song_id, owner_id, messages, updated_at) values (?1, ?2, ?3, ?4) on conflict do nothing`,
    c.song_id,
    c.owner_id,
    await packJson(env.BLOBS, `${songPrefix(c.song_id)}chat/`, c.messages ?? []),
    iso(c.updated_at),
  );
}

async function importPatch(env, p) {
  const cols = patchColumns(p.config);
  await run(
    env.DB,
    `insert into patches (id, owner_id, name, engine_type, config, engine_key, kind, drum, sample, is_public,
                          saved_from, created_at, updated_at)
     values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, null, ?11, ?12) on conflict do nothing`,
    p.id,
    p.owner_id,
    String(p.name).slice(0, 120),
    p.engine_type ?? cols.engine_type,
    await packJson(env.BLOBS, patchPrefix(p.id), p.config),
    cols.engine_key,
    cols.kind,
    cols.drum,
    cols.sample,
    b(p.is_public),
    iso(p.created_at),
    iso(p.updated_at),
  );
}

async function importPatchLinks(env, p) {
  if (!p.saved_from) return;
  await run(env.DB, "update patches set saved_from = (select id from patches where id = ?2) where id = ?1", p.id, p.saved_from);
  await run(env.DB, "update patches set updated_at = ?2 where id = ?1", p.id, iso(p.updated_at));
}

const KINDS = {
  users: importUser,
  // One stored sample (Supabase's song_samples), sent alone: each is megabytes.
  samples: (env, x) => putSamples(env.BLOBS, x.song_id, new Map([[x.hash, x.payload]])),
  songs: importSong,
  versions: importVersion,
  songLinks: importSongLinks,
  chats: importChat,
  songLikes: (env, l) =>
    run(env.DB, "insert into song_likes (song_id, user_id, created_at) values (?1, ?2, ?3) on conflict do nothing", l.song_id, l.user_id, iso(l.created_at)),
  patches: importPatch,
  patchLinks: importPatchLinks,
  patchLikes: (env, l) =>
    run(env.DB, "insert into patch_likes (patch_id, user_id, created_at) values (?1, ?2, ?3) on conflict do nothing", l.patch_id, l.user_id, iso(l.created_at)),
};

export const IMPORT_KINDS = Object.keys(KINDS);

/** Import a batch of one kind. Returns how many rows went in and which failed. */
export async function importRows(env, kind, rows) {
  const fn = KINDS[kind];
  if (!fn) throw new Error(`unknown kind ${kind}`);
  const failed = [];
  let done = 0;
  for (const row of rows ?? []) {
    try {
      await fn(env, row);
      done++;
    } catch (e) {
      failed.push({ id: row?.id ?? row?.song_id ?? row?.patch_id ?? null, error: String(e?.message ?? e) });
    }
  }
  return { done, failed };
}
