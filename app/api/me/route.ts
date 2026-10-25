import { NextResponse } from "next/server";
import { cfEnv } from "@/lib/cf";
import { currentUser } from "@/lib/auth/session";
import { first } from "@/lib/data/db.js";

export const dynamic = "force-dynamic";

// GET /api/me -> { id, handle } or { id: null }
//
// Who is signed in, for the islands on cached pages that cannot know it
// (home/Who.tsx, PostHogIdentify.tsx). The id and the handle only: nothing
// here is anything the visitor does not already know about themselves.
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ id: null }, { headers: { "Cache-Control": "no-store" } });
  const env = await cfEnv();
  const card = await first(env.DB, "select username from profiles where id = ?1", user.id).catch(() => null);
  return NextResponse.json(
    { id: user.id, handle: (card?.username as string) || null },
    { headers: { "Cache-Control": "no-store" } },
  );
}
