import { NextResponse } from "next/server";
import { cfEnv } from "@/lib/cf";
import { currentUserId } from "@/lib/auth/session";
import { getShare, putShare } from "@/lib/data/shares.js";
import { first } from "@/lib/data/db.js";
import { unpackJson, withSamples } from "@/lib/data/blob.js";

export const dynamic = "force-dynamic";

// POST /api/share  { session, title? } -> { id }
//
// The studio's own quick "share" button (public/js/session.js onShareSet):
// no account needed, nothing typed, works signed out. A signed-in sharer
// still gets tagged, so the link preview (app/songs/linkedSongTitle.ts) can
// put their name on the card. `title`, when the studio has a song open, is
// that song's own name; only a session with none gets a generated one.
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { session?: unknown; title?: unknown };
    const [env, ownerId] = await Promise.all([cfEnv(), currentUserId()]);
    const title = typeof body?.title === "string" ? body.title : undefined;
    const { id } = await putShare(env, { session: body?.session, ownerId, title });
    return NextResponse.json({ id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "share failed";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

// GET /api/share?id=... -> { session, createdAt }
// A published song by its share slug first, then a quick share.
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "bad id" }, { status: 404 });
  const env = await cfEnv();
  try {
    const row = await first(
      env.DB,
      "select id, data, updated_at from songs where share_slug = ?1 and is_public = 1",
      id,
    );
    if (row) {
      // A song's samples are stored beside it in R2, not in it.
      const session = await withSamples(env.BLOBS, row.id, await unpackJson(env.BLOBS, row.data));
      return NextResponse.json({ session, createdAt: row.updated_at });
    }
    const share = await getShare(env, id);
    if (share) return NextResponse.json({ session: share.session, createdAt: share.createdAt });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "not found";
    return NextResponse.json({ error: msg }, { status: 404 });
  }
  return NextResponse.json({ error: "share not found" }, { status: 404 });
}
