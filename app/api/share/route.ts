import { NextResponse } from "next/server";
import { putShare, getShare } from "@/lib/api.js";
import { createClient } from "@/lib/supabase/server";

// Node runtime: lib/api.js uses node:crypto and @netlify/blobs (with an in-memory
// fallback when no Netlify context is present, e.g. `next dev`).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/share  { session } -> { id }
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { id } = await putShare({ session: body?.session });
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
    const body = await getShare({ id });
    return NextResponse.json(body);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "not found";
    return NextResponse.json({ error: msg }, { status: 404 });
  }
}
