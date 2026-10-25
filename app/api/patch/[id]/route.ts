import { NextResponse } from "next/server";
import { cfEnv } from "@/lib/cf";
import { first } from "@/lib/data/db.js";
import { unpackJson } from "@/lib/data/blob.js";

// GET /api/patch/<uuid> -> { name, config }
//
// A published patch's whole config, for the homepage's patch cards to play
// (app/home/patchPreview.js turns it into a one-track session). The feed
// never selects `config` itself: a sampler patch carries its sample as
// base64, so it is fetched only for the card someone presses.
//
// Public rows only and no session read, for feed.ts's reason: nothing a
// session could add to the answer, and no cookies means a cacheable response.
// The id is in the PATH, not the query, so any cache keyed on the path alone
// still tells two patches apart.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  try {
    const env = await cfEnv();
    const row = await first(env.DB, "select name, config from patches where id = ?1 and is_public = 1", id);
    if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(
      { name: row.name, config: await unpackJson(env.BLOBS, row.config) },
      { headers: { "Cache-Control": "public, max-age=60, s-maxage=300" } },
    );
  } catch {
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
