// Daily cleanup for stored samples (migration 0020).
//
// Always: forget quota rows older than two days. The quota only ever looks
// back 24 hours, and a table of salted addresses has no reason to outlive it.
//
// Only when SAMPLE_GC_DELETE=1: delete stored samples that no song, version,
// patch or share names and that are older than the grace period
// (SAMPLE_GC_GRACE_DAYS, 30 by default). Off by default, because the
// database is not the only place a reference can live: a session saved in a
// browser's local list, or sitting in an open tab's undo stack, can name a
// sample no row does yet. Without the flag the job only logs how many it
// would delete, so the number can be watched before anything is removed.
import { adminClient } from "../../lib/supabase/admin.js";
import { SAMPLE_BUCKET } from "../../lib/sampleStore.js";

export const config = { schedule: "@daily" };

export default async () => {
  const db = adminClient();
  if (!db) return new Response("sample storage is not configured", { status: 200 });

  const cutoff = new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString();
  const { error: qErr } = await db.from("sample_uploads").delete().lt("created_at", cutoff);
  if (qErr) console.error("[sample-gc] quota rows:", qErr.message);

  const graceDays = Math.max(7, Number(process.env.SAMPLE_GC_GRACE_DAYS) || 30);
  const { data, error } = await db.rpc("unreferenced_samples", { p_older_than: `${graceDays} days` });
  if (error) {
    console.error("[sample-gc] unreferenced:", error.message);
    return new Response("failed", { status: 500 });
  }
  const hashes = (data ?? []).map((r) => r.hash).filter(Boolean);
  if (process.env.SAMPLE_GC_DELETE !== "1") {
    console.log(`[sample-gc] ${hashes.length} unreferenced samples older than ${graceDays} days (not deleted: SAMPLE_GC_DELETE is off)`);
    return new Response("ok");
  }
  for (let i = 0; i < hashes.length; i += 100) {
    const batch = hashes.slice(i, i + 100);
    const { error: rmErr } = await db.storage.from(SAMPLE_BUCKET).remove(batch);
    if (rmErr) { console.error("[sample-gc] remove:", rmErr.message); continue; }
    await db.from("samples").delete().in("hash", batch);
  }
  console.log(`[sample-gc] deleted ${hashes.length} unreferenced samples`);
  return new Response("ok");
};
