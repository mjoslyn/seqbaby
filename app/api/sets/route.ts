import { NextResponse } from "next/server";
import { cfEnv } from "@/lib/cf";
import { currentUserId } from "@/lib/auth/session";
import { listMySets, saveSet } from "@/lib/data/sets.js";

export const dynamic = "force-dynamic";

// Recorded live sets (public/js/setRecorder.js). Routes rather than server
// actions for the patch bay's reason: a recording holds whole sessions, a
// deck's song for every deck loaded and their samples, and a server action's
// body has a limit of its own.
//
// GET  /api/sets                                   -> { sets }  yours, newest first
// POST /api/sets { title, recording, songId?, forkedFrom?, forkStep?, isPublic? } -> { id, title }

export async function GET() {
  const [env, userId] = await Promise.all([cfEnv(), currentUserId()]);
  if (!userId) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  return NextResponse.json(await listMySets(env, userId));
}

export async function POST(req: Request) {
  const [env, userId] = await Promise.all([cfEnv(), currentUserId()]);
  if (!userId) return NextResponse.json({ error: "sign in to save a set" }, { status: 401 });
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  const res = await saveSet(env, userId, {
    title: String(body.title ?? ""),
    recording: body.recording,
    songId: typeof body.songId === "string" ? body.songId : null,
    forkedFrom: typeof body.forkedFrom === "string" ? body.forkedFrom : null,
    forkStep: Number.isInteger(body.forkStep) ? (body.forkStep as number) : null,
    isPublic: body.isPublic === true,
  });
  return NextResponse.json(res, { status: "error" in res ? 400 : 200 });
}
