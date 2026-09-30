// A Supabase client holding the SECRET key: it bypasses every RLS policy, so
// it is for server code that has already decided a write is allowed (the
// sample upload route, anonymous shares, the backfill and cleanup scripts)
// and never for anything a request can steer into reading someone else's rows.
//
// Plain JS, no Next imports: lib/api.js runs under plain Node (server.js) and
// as a Netlify Function too. Null when the env is not there -- the engine and
// the share button are meant to work with no Supabase at all.
import { createClient } from "@supabase/supabase-js";

let cached;

export function adminClient() {
  if (cached !== undefined) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  cached = url && key
    ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
    : null;
  return cached;
}

/** Where a stored sample is served from, or null with no Supabase URL. */
export function publicSampleUrl(hash) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  return url ? `${url.replace(/\/+$/, "")}/storage/v1/object/public/samples/${hash}` : null;
}
