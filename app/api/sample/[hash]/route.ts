import { NextResponse } from "next/server";
import { publicSampleUrl } from "@/lib/supabase/admin.js";
import { HASH_RE } from "@/lib/sampleStore.js";

// GET /api/sample/<sha256> -> 308 to the stored file
//
// The one address a song names a stored sample by. The studio fetches this
// rather than the bucket's own URL because the engine has no env of its own:
// which project the samples live in is the server's to know, and a song saved
// today should still play if that ever moves. The name is the file's content
// hash, so the answer never changes, and it is cached as long as a cache will
// keep it.
export async function GET(_req: Request, { params }: { params: Promise<{ hash: string }> }) {
  const { hash } = await params;
  if (!HASH_RE.test(hash)) return NextResponse.json({ error: "bad hash" }, { status: 400 });
  const url = publicSampleUrl(hash);
  if (!url) return NextResponse.json({ error: "sample storage is not configured" }, { status: 404 });
  return new NextResponse(null, {
    status: 308,
    headers: {
      Location: url,
      "Cache-Control": "public, max-age=31536000, immutable",
      "Netlify-CDN-Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
