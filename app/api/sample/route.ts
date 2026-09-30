import { NextResponse } from "next/server";
import { adminClient } from "@/lib/supabase/admin.js";
import { createClient } from "@/lib/supabase/server";
import { clientIp, hashIp, MAX_SAMPLE_BYTES, SampleError, storeSample } from "@/lib/sampleStore.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/sample  (the file's raw bytes as the body) -> { hash, mime }
//
// Where the studio puts an uploaded sample when a song is saved or shared
// (public/js/sampleStore.js). Signed in or not: an anonymous share needs its
// samples stored as much as an account's song does. What keeps that from
// being a free file host is lib/sampleStore.js -- the 5MB cap, the audio
// check, and a daily quota per address (per account when signed in).
//
// 503 when this deploy has no secret key: the studio keeps the sample inline,
// exactly as it did before any of this existed.
export async function POST(req: Request) {
  const db = adminClient();
  if (!db) return NextResponse.json({ error: "sample storage is not configured" }, { status: 503 });

  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_SAMPLE_BYTES) {
    return NextResponse.json({ error: `samples are limited to ${MAX_SAMPLE_BYTES / 1024 / 1024}MB` }, { status: 413 });
  }

  let userId: string | null = null;
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    userId = user?.id ?? null;
  } catch {
    /* no session: counted against the address */
  }

  const salt = process.env.SAMPLE_IP_SALT || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  try {
    const bytes = new Uint8Array(await req.arrayBuffer());
    const { hash, mime } = await storeSample(
      { bytes, ipHash: hashIp(clientIp(req.headers), salt), userId },
      { db },
    );
    return NextResponse.json({ hash, mime });
  } catch (err) {
    if (err instanceof SampleError) {
      const headers: Record<string, string> = {};
      if (err.retryAfter) headers["Retry-After"] = String(err.retryAfter);
      return NextResponse.json(
        { error: err.message, retryAfter: err.retryAfter ?? null },
        { status: err.status, headers },
      );
    }
    console.error("[sample] upload failed", err);
    return NextResponse.json({ error: "upload failed" }, { status: 500 });
  }
}
