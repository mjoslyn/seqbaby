import { NextResponse } from "next/server";
import { putShare, getShare } from "@/lib/api.js";
import { createClient } from "@/lib/supabase/server";

// Node runtime: lib/api.js uses node:crypto and @netlify/blobs (with an in-memory
// fallback when no Netlify context is present, e.g. `next dev`).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/share  { session } -> { id }
//
// This is the studio's own quick "share" button (public/js/session.js
// onShareSet) -- no account needed, nothing typed, works signed out. A
// signed-in sharer still gets tagged: their id rides along so the link
// preview (linkedSong in app/songs/linkedSongTitle.ts) can put their name on
// the card, the same as a published song's owner_id does. Resolving the
// session is best-effort -- the engine is meant to work with no Supabase env
// at all, and an anonymous share is still a share.
export async function POST(req: Request) {
  try {
    const body = await req.json();
    let ownerId: string | null = null;
    try {
      const supabase = await createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      ownerId = user?.id ?? null;
    } catch {
      /* no Supabase configured, or no session -- share anonymously */
    }
    const { id } = await putShare({ session: body?.session, ownerId });
    return NextResponse.json({ id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "share failed";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

// GET /api/share?id=... -> { session, createdAt }
// Resolves published cloud songs by share_slug first (RLS allows anon to read
// public songs), then falls back to legacy Blobs shares.
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (id) {
    try {
      const supabase = await createClient();
      const { data } = await supabase
        .from("songs")
        .select("data,updated_at")
        .eq("share_slug", id)
        .eq("is_public", true)
        .maybeSingle();
      if (data) {
        return NextResponse.json({ session: data.data, createdAt: data.updated_at });
      }
    } catch {
      // songs table may not exist yet; fall through to Blobs.
    }
  }
  try {
    const { session, createdAt } = await getShare({ id });
    // title/ownerId ride along on the stored blob for getShareMeta's sake
    // (the link-preview path) -- not something this endpoint hands to
    // whoever fetches the session, which was never asking for either.
    return NextResponse.json({ session, createdAt });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "not found";
    return NextResponse.json({ error: msg }, { status: 404 });
  }
}
