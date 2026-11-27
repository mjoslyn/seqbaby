import { NextResponse } from "next/server";
import { cfEnv } from "@/lib/cf";
import { SOUND_MAX_SECONDS, SoundError, fetchSound } from "@/lib/freesound.js";

// GET /api/sounds/<freesound id> -> the sound's audio (an mp3 preview)
//
// What the sampler's search loads onto a track. Fetched here, not from
// freesound by the browser: the licence is checked again on the way (CC0 or
// nothing) and the bytes come back same-origin, so they can be decoded and
// kept in the song. The id is in the path, so a cache may hold it.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d{1,12}$/.test(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  try {
    const env = await cfEnv();
    const s = await fetchSound({ key: env.FREESOUND_API_KEY, id: Number(id), maxSeconds: SOUND_MAX_SECONDS.granular });
    return new Response(s.bytes, {
      headers: { "Content-Type": s.mime, "Cache-Control": "public, max-age=86400, s-maxage=86400" },
    });
  } catch (e) {
    const err = e instanceof SoundError ? e : new SoundError("could not load that sound");
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
}
