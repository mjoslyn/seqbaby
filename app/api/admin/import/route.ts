import { NextResponse } from "next/server";
import { cfEnv } from "@/lib/cf";
import { sameToken } from "@/lib/composeJobs.js";
import { importRows } from "@/lib/data/importer.js";

export const dynamic = "force-dynamic";

// POST /api/admin/import { kind, rows } -> { done, failed }
//
// The one-off move from Supabase (scripts/migrate-from-supabase.mjs). Off
// unless the MIGRATION_TOKEN secret is set, and then only for a request
// carrying it: set it for the migration, and delete it afterwards
// (npx wrangler secret delete MIGRATION_TOKEN).
export async function POST(req: Request) {
  const env = await cfEnv();
  const token = env.MIGRATION_TOKEN;
  if (!token) return NextResponse.json({ error: "not found" }, { status: 404 });
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!sameToken(given, token)) return NextResponse.json({ error: "not found" }, { status: 404 });
  let body: { kind?: string; rows?: unknown[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  try {
    return NextResponse.json(await importRows(env, String(body.kind), body.rows ?? []));
  } catch (e) {
    return NextResponse.json({ error: String((e as Error)?.message ?? e) }, { status: 400 });
  }
}
