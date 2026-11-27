import { NextResponse } from "next/server";
import { cfEnv } from "@/lib/cf";
import { SOUND_MAX_SECONDS, SoundError, searchSounds } from "@/lib/freesound.js";

// GET /api/sounds?q=<words>&max=<seconds> -> { count, sounds }
//
// The sampler's sound search (public/js/soundSearch.js): CC0 sounds from
// freesound.org, searched on this deploy's key (FREESOUND_API_KEY), which is
// why the browser asks here and not there. No account needed, as the sampler
// needs none; nothing about the caller is sent on. 503 when there is no key,
// which the picker reads as "not set up here".
export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get("q") || "";
  const max = Number(url.searchParams.get("max")) || SOUND_MAX_SECONDS.sampler;
  try {
    const env = await cfEnv();
    const out = await searchSounds({ key: env.FREESOUND_API_KEY, query: q, maxSeconds: max, limit: 20 });
    // The browser's own cache only: the query is in the query string, and a
    // shared cache keyed on the path would hand one search to everyone.
    return NextResponse.json(out, { headers: { "Cache-Control": "private, max-age=600" } });
  } catch (e) {
    const err = e instanceof SoundError ? e : new SoundError("the search failed");
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
}
