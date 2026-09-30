#!/usr/bin/env node
// Rewrite every inline sample already in the database as a stored file and a
// reference (migration 0020). Walks songs, song_versions, patches and shares;
// for each track carrying base64 it stores the file in the `samples` bucket
// under its hash and writes `uploadRef` where the payload was.
//
// Not an edit: rows are written through `sample_backfill_write`, which keeps
// songs.updated_at as it was (it is what the homepage ranks freshness by).
// No quota: this is the server moving what it already holds.
//
// Safe to run again: a row with nothing inline is skipped, and a file already
// stored is not written twice. Run migrate-shares.mjs first so the shares it
// copies are included. A sample the upload route would refuse (not audio it
// recognises, over 5MB) is left inline and counted.
//
// Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY in the environment.
//
// Usage:
//   node --env-file=.env scripts/migrate-samples.mjs          dry run: counts only
//   node --env-file=.env scripts/migrate-samples.mjs --write  rewrite them
import { adminClient } from "../lib/supabase/admin.js";
import { externalizeSamples, hashBytes, putSampleObject } from "../lib/sampleStore.js";

const write = process.argv.includes("--write");
const PAGE = 10;   // rows carry whole sessions, samples included

const db = adminClient();
if (!db) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY are required");
  process.exit(1);
}

const KINDS = [
  { kind: "song", table: "songs", col: "data" },
  { kind: "version", table: "song_versions", col: "data" },
  { kind: "patch", table: "patches", col: "config" },
  { kind: "share", table: "shares", col: "session" },
];

const stored = new Set();
let bytesMoved = 0;

async function put(bytes, mime) {
  const hash = hashBytes(bytes);
  if (!stored.has(hash)) {
    if (write) await putSampleObject(db, bytes, mime, hash);
    stored.add(hash);
    bytesMoved += bytes.length;
  }
  return hash;
}

for (const { kind, table, col } of KINDS) {
  let rows = 0, rewritten = 0, failed = 0, before = 0, after = 0;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from(table)
      .select(`id,${col}`)
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) { console.error(`${table}: ${error.message}`); break; }
    if (!data?.length) break;
    for (const row of data) {
      rows++;
      const blob = row[col];
      try {
        const { blob: next, changed } = await externalizeSamples(blob, put);
        if (!changed) continue;
        before += JSON.stringify(blob).length;
        after += JSON.stringify(next).length;
        if (write) {
          const { error: wErr } = await db.rpc("sample_backfill_write", { p_kind: kind, p_id: String(row.id), p_data: next });
          if (wErr) throw new Error(wErr.message);
        }
        rewritten++;
      } catch (e) {
        failed++;
        console.warn(`\n${table} ${row.id}: ${e?.message ?? e}`);
      }
    }
    process.stdout.write(`\r${table}: ${rows} rows, ${rewritten} ${write ? "rewritten" : "to rewrite"}, ${failed} failed`);
  }
  const mb = (n) => (n / 1024 / 1024).toFixed(1);
  console.log(`\n${table}: ${mb(before)}MB of rewritten rows becomes ${mb(after)}MB`);
}
console.log(`${stored.size} distinct samples, ${(bytesMoved / 1024 / 1024).toFixed(1)}MB ${write ? "stored" : "to store"}`);
if (!write) console.log("dry run: pass --write to do it");
