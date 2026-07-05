import { NextResponse } from "next/server";
import { putShare, getShare } from "@/lib/api.js";

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
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  try {
    const body = await getShare({ id });
    return NextResponse.json(body);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "not found";
    return NextResponse.json({ error: msg }, { status: 404 });
  }
}
