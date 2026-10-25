import { NextResponse } from "next/server";
import { cfEnv } from "@/lib/cf";
import { currentUserId } from "@/lib/auth/session";
import { bayIndex, importPatches, putPatch } from "@/lib/data/patches.js";

export const dynamic = "force-dynamic";

// The studio's patch bay (app/patches/bay.ts). Routes rather than server
// actions because a sampler patch carries its sample as base64, and a server
// action's body has a limit of its own.
//
// GET  /api/bay                         -> { patches }   (401 signed out)
// POST /api/bay { name, config }        -> { id }        save by name
// POST /api/bay { import: {name: cfg} } -> { moved }     the old localStorage bay

export async function GET() {
  const [env, userId] = await Promise.all([cfEnv(), currentUserId()]);
  if (!userId) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  return NextResponse.json({ patches: await bayIndex(env, userId) });
}

export async function POST(req: Request) {
  const [env, userId] = await Promise.all([cfEnv(), currentUserId()]);
  if (!userId) return NextResponse.json({ error: "sign in to save patches" }, { status: 401 });
  let body: { name?: unknown; config?: unknown; import?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  if (body.import && typeof body.import === "object") {
    return NextResponse.json(await importPatches(env, userId, body.import as Record<string, unknown>));
  }
  const res = await putPatch(env, userId, String(body.name ?? ""), body.config);
  return NextResponse.json(res, { status: res.error ? 400 : 200 });
}
