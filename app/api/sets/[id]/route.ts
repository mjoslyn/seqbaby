import { NextResponse } from "next/server";
import { cfEnv } from "@/lib/cf";
import { currentUserId } from "@/lib/auth/session";
import { deleteSet, loadSet, renameSet, setSetPublic } from "@/lib/data/sets.js";

export const dynamic = "force-dynamic";

// GET    /api/sets/<id>                      -> { set, recording }  yours, or a public one
// PATCH  /api/sets/<id> { title?, isPublic? } -> { ok }
// DELETE /api/sets/<id>                      -> { ok }

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const [env, userId] = await Promise.all([cfEnv(), currentUserId()]);
  const res = await loadSet(env, userId, id);
  return NextResponse.json(res, { status: "error" in res ? 404 : 200, headers: { "cache-control": "private, no-store" } });
}

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const [env, userId] = await Promise.all([cfEnv(), currentUserId()]);
  let body: { title?: unknown; isPublic?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  let res: { ok?: boolean; error?: string; title?: string } = { ok: true };
  if (typeof body.title === "string") res = await renameSet(env, userId, id, body.title);
  if (!res.error && typeof body.isPublic === "boolean") res = { ...res, ...(await setSetPublic(env, userId, id, body.isPublic)) };
  return NextResponse.json(res, { status: res.error ? 404 : 200 });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const [env, userId] = await Promise.all([cfEnv(), currentUserId()]);
  const res = await deleteSet(env, userId, id);
  return NextResponse.json(res, { status: res.error ? 404 : 200 });
}
