#!/usr/bin/env node
// Copy every anonymous share out of Netlify Blobs into Supabase's `shares`
// table (migration 0020). Run once, after the migration is applied and
// before the Blobs read fallback in lib/api.js is taken out.
//
// Safe to run again: a share already in the table is skipped, never
// overwritten, so a share someone made after the move is untouched. It does
// not delete anything from Blobs; that store can be dropped by hand once the
// counts agree.
//
// Needs, in the environment:
//   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY    the target project
//   NETLIFY_SITE_ID, NETLIFY_AUTH_TOKEN              to read the Blobs store
//
// Usage:
//   node --env-file=.env scripts/migrate-shares.mjs          dry run: counts only
//   node --env-file=.env scripts/migrate-shares.mjs --write  copy them
import { getStore } from "@netlify/blobs";
import { adminClient } from "../lib/supabase/admin.js";
import { SHARE_NS } from "../lib/api.js";

const write = process.argv.includes("--write");
const ID_RE = /^[a-zA-Z0-9]{4,32}$/;

const db = adminClient();
if (!db) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY are required");
  process.exit(1);
}
const siteID = process.env.NETLIFY_SITE_ID;
const token = process.env.NETLIFY_AUTH_TOKEN;
if (!siteID || !token) {
  console.error("NETLIFY_SITE_ID and NETLIFY_AUTH_TOKEN are required to read the Blobs store");
  process.exit(1);
}
const store = getStore({ name: SHARE_NS, siteID, token });

let seen = 0, copied = 0, present = 0, bad = 0;
for await (const page of store.list({ paginate: true })) {
  for (const { key } of page.blobs) {
    seen++;
    if (!ID_RE.test(key)) { bad++; console.warn(`skip ${key}: not a share id`); continue; }
    const { data: have } = await db.from("shares").select("id").eq("id", key).maybeSingle();
    if (have) { present++; continue; }
    const body = await store.get(key, { type: "json" }).catch(() => null);
    if (!body?.session || typeof body.session !== "object") { bad++; console.warn(`skip ${key}: no session`); continue; }
    if (!write) { copied++; continue; }
    const { error } = await db.from("shares").insert({
      id: key,
      session: body.session,
      title: typeof body.title === "string" ? body.title : null,
      owner_id: typeof body.ownerId === "string" && body.ownerId ? body.ownerId : null,
      created_at: body.createdAt || new Date().toISOString(),
    });
    if (error && error.code !== "23505") { bad++; console.warn(`failed ${key}: ${error.message}`); continue; }
    copied++;
  }
  process.stdout.write(`\r${seen} seen, ${copied} ${write ? "copied" : "to copy"}, ${present} already there, ${bad} skipped`);
}
console.log(`\ndone${write ? "" : " (dry run: pass --write to copy)"}`);
