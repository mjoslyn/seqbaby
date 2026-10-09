import type { SupabaseClient } from "@supabase/supabase-js";
import { restoreSamples, sampleRefs } from "@/app/songs/sampleStore";

// The database half of app/songs/sampleStore.js. Not in actions.ts: every
// export of a "use server" file is an endpoint, and the share route needs
// `withSamples` too.

/** Store the payloads this song does not have yet. Only the missing ones are
 *  sent: they are megabytes each, and a save usually adds none. */
export async function putSamples(
  supabase: SupabaseClient,
  songId: string,
  samples: Map<string, string>,
): Promise<string | null> {
  if (!samples.size) return null;
  const { data: have, error: readErr } = await supabase
    .from("song_samples")
    .select("hash")
    .eq("song_id", songId)
    .in("hash", [...samples.keys()]);
  if (readErr) return readErr.message;
  const held = new Set((have ?? []).map((r) => r.hash as string));
  const rows = [...samples]
    .filter(([hash]) => !held.has(hash))
    .map(([hash, payload]) => ({ song_id: songId, hash, payload }));
  if (!rows.length) return null;
  // ignoreDuplicates: a second tab saving the same sample at the same moment
  // is the same row, not an error.
  const { error } = await supabase
    .from("song_samples")
    .upsert(rows, { onConflict: "song_id,hash", ignoreDuplicates: true });
  return error?.message ?? null;
}

/** A stored session with its samples put back. Never throws and never fails
 *  a load: a sample that cannot be read is a track without one. */
export async function withSamples<T>(supabase: SupabaseClient, songId: string, data: T): Promise<T> {
  const refs = sampleRefs(data);
  if (!refs.length) return data;
  const { data: rows } = await supabase
    .from("song_samples")
    .select("hash,payload")
    .eq("song_id", songId)
    .in("hash", refs);
  const payloads = new Map((rows ?? []).map((r) => [r.hash as string, r.payload as string]));
  return restoreSamples(data, payloads) as T;
}
