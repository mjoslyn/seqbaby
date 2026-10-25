#!/usr/bin/env node
// Move everything from the Supabase project into the Cloudflare deploy: every
// account (password hashes included, so nobody has to reset), profile, song,
// version, sample, compose chat, patch and like.
//
// It reads Supabase's Postgres directly (the only place the password hashes
// can be read from) and posts the rows, a kind at a time and in foreign-key
// order, to the deployed Worker's /api/admin/import, which writes them with
// the app's own code (lib/data/importer.js): samples and big sessions to R2,
// the list columns computed, every insert idempotent. Run it again after a
// failure and it carries on.
//
//   1. npx wrangler secret put MIGRATION_TOKEN        (any long random string)
//   2. SUPABASE_DB_URL=postgresql://postgres:...@db.<ref>.supabase.co:5432/postgres \
//      SITE_URL=https://www.playseqbaby.com MIGRATION_TOKEN=<the same string> \
//      npm run migrate:supabase
//   3. npx wrangler secret delete MIGRATION_TOKEN     (switches the endpoint off)
//
// SUPABASE_DB_URL is the project's direct connection string (Project Settings
// -> Database), as the `postgres` role: auth.users is not readable otherwise.
// Add `--dry-run` to count what would move without sending anything.

import pg from "pg";

const DB_URL = process.env.SUPABASE_DB_URL;
const SITE = (process.env.SITE_URL || "").replace(/\/$/, "");
const TOKEN = process.env.MIGRATION_TOKEN;
const DRY = process.argv.includes("--dry-run");

if (!DB_URL || (!DRY && (!SITE || !TOKEN))) {
  console.error("needs SUPABASE_DB_URL, and SITE_URL + MIGRATION_TOKEN unless --dry-run");
  process.exit(1);
}

/** How much JSON goes in one request. Well under what a Worker will read. */
const BATCH_CHARS = 4_000_000;

const client = new pg.Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
const q = async (sql, params) => (await client.query(sql, params)).rows;

let failures = 0;

async function send(kind, rows) {
  if (DRY || !rows.length) return;
  const res = await fetch(`${SITE}/api/admin/import`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ kind, rows }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${kind}: ${res.status} ${body.error ?? ""}`);
  for (const f of body.failed ?? []) {
    failures++;
    console.warn(`  ! ${kind} ${f.id}: ${f.error}`);
  }
}

/** Send rows in batches no bigger than BATCH_CHARS (one row may be alone). */
async function sendAll(kind, rows) {
  let batch = [];
  let size = 0;
  for (const row of rows) {
    const n = JSON.stringify(row).length;
    if (batch.length && size + n > BATCH_CHARS) {
      await send(kind, batch);
      batch = [];
      size = 0;
    }
    batch.push(row);
    size += n;
  }
  await send(kind, batch);
  console.log(`${kind}: ${rows.length}`);
}

const hasTable = async (name) =>
  (await q("select to_regclass($1) is not null as ok", [`public.${name}`]))[0].ok;

// ---- accounts ------------------------------------------------------------------
const users = await q(`
  select u.id, u.email, u.encrypted_password, u.email_confirmed_at, u.created_at, u.updated_at,
         to_jsonb(p) as profile
    from auth.users u left join public.profiles p on p.id = u.id
   where u.email is not null and u.deleted_at is null
   order by u.created_at`);
await sendAll("users", users);

// ---- songs, their samples, their versions ------------------------------------------
// to_jsonb for the template flags: a project from before migration 0010 has
// no such columns, and this reads them as false rather than failing.
const songCols = `id, owner_id, title, data, is_public, share_slug, forked_from, current_version_id,
  created_at, updated_at,
  coalesce((to_jsonb(s) ->> 'is_template')::boolean, false) as is_template,
  coalesce((to_jsonb(s) ->> 'is_default_template')::boolean, false) as is_default_template`;
// One at a time: a song is the whole session, and there may be many.
const songIds = await q("select id from public.songs order by created_at");
const links = [];
for (const { id } of songIds) {
  const [s] = await q(`select ${songCols} from public.songs s where id = $1`, [id]);
  links.push({ id: s.id, current_version_id: s.current_version_id, forked_from: s.forked_from, updated_at: s.updated_at });
  await send("songs", [s]);
}
console.log(`songs: ${songIds.length}`);

if (await hasTable("song_samples")) {
  const keys = await q("select song_id, hash from public.song_samples order by created_at");
  for (const k of keys) {
    const [x] = await q("select song_id, hash, payload from public.song_samples where song_id = $1 and hash = $2", [k.song_id, k.hash]);
    await send("samples", [x]);
  }
  console.log(`samples: ${keys.length}`);
}

if (await hasTable("song_versions")) {
  // Parents before children: a version's parent always has a lower seq.
  const ids = await q("select id from public.song_versions order by song_id, seq");
  let batch = [];
  let size = 0;
  for (const { id } of ids) {
    const [v] = await q("select id, song_id, owner_id, parent_id, data, seq, label, created_at from public.song_versions where id = $1", [id]);
    const n = JSON.stringify(v).length;
    if (batch.length && size + n > BATCH_CHARS) {
      await send("versions", batch);
      batch = [];
      size = 0;
    }
    batch.push(v);
    size += n;
  }
  await send("versions", batch);
  console.log(`versions: ${ids.length}`);
}

// Tips and remix ancestry, now that everything they point at exists.
await sendAll("songLinks", links);

if (await hasTable("song_chats")) await sendAll("chats", await q("select song_id, owner_id, messages, updated_at from public.song_chats"));
if (await hasTable("song_likes")) await sendAll("songLikes", await q("select song_id, user_id, created_at from public.song_likes"));

// ---- patches ----------------------------------------------------------------------
const patchRows = await q(`
  select id, owner_id, name, engine_type, config, is_public, created_at, updated_at,
         to_jsonb(p) ->> 'saved_from' as saved_from
    from public.patches p order by created_at`);
await sendAll("patches", patchRows);
await sendAll(
  "patchLinks",
  patchRows.filter((p) => p.saved_from).map((p) => ({ id: p.id, saved_from: p.saved_from, updated_at: p.updated_at })),
);
if (await hasTable("patch_likes")) await sendAll("patchLikes", await q("select patch_id, user_id, created_at from public.patch_likes"));

await client.end();
console.log(DRY ? "dry run: nothing sent" : failures ? `done, with ${failures} rows that did not go in (above)` : "done");
process.exit(failures ? 1 : 0);
