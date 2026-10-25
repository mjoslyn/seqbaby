import { NextResponse } from "next/server";
import { cfEnv } from "@/lib/cf";
import { currentUserId } from "@/lib/auth/session";
import { deletePatch, patchConfig } from "@/lib/data/patches.js";

export const dynamic = "force-dynamic";

// GET    /api/bay/<id> -> { config }   one of your patches' config
// DELETE /api/bay/<id> -> { ok }

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const [env, userId] = await Promise.all([cfEnv(), currentUserId()]);
  if (!userId) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  const res = await patchConfig(env, userId, id);
  return NextResponse.json(res, { status: res.error ? 404 : 200 });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const [env, userId] = await Promise.all([cfEnv(), currentUserId()]);
  const res = await deletePatch(env, userId, id);
  return NextResponse.json(res, { status: res.error ? 404 : 200 });
}
