import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// GET /api/patch?id=<uuid> -> { name, config }
//
// A published patch's whole config, for the homepage's patch cards to play
// (app/home/patchPreview.js turns it into a one-track session). The feed
// never selects `config` itself: a sampler patch carries its sample as
// base64, so it is fetched only for the card someone presses.
//
// A plain anon client and only public rows, for feed.ts's reason: nothing a
// session could add to the answer, and no cookies means a cacheable response.
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return NextResponse.json({ error: "no database" }, { status: 404 });
  try {
    const supabase = createClient(url, key, { auth: { persistSession: false } });
    const { data, error } = await supabase
      .from("patches")
      .select("name,config")
      .eq("id", id)
      .eq("is_public", true)
      .maybeSingle();
    if (error || !data) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(
      { name: data.name, config: data.config },
      { headers: { "Cache-Control": "public, max-age=60, s-maxage=300" } },
    );
  } catch {
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
