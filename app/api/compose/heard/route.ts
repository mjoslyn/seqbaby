import { NextResponse } from "next/server";
import { currentUserId } from "@/lib/auth/session";
import { cfEnv } from "@/lib/cf";
import { canReadJob } from "@/lib/composeJobs.js";
import type { ComposeProgress } from "@/workers/composeJob";

export const dynamic = "force-dynamic";

const ID_RE = /^[A-Za-z0-9_-]{8,40}$/;

// POST /api/compose/heard { id, t, seq, report }
//
// The panel's answer to a turn that asked to be listened to: the meters it
// read while playing the turn's song silently (public/js/measure.js), or a
// null report when it could not. Whoever may poll the job may answer it. The
// report is numbers the job cuts down and checks against the song itself
// (mcp/hearing.mjs); nothing in it reaches the model as text.
export async function POST(req: Request) {
  let body: { id?: string; t?: string; seq?: number; report?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  const id = body.id;
  if (!id || !ID_RE.test(id) || !Number.isInteger(body.seq)) return NextResponse.json({ error: "no job" }, { status: 400 });
  // A report is a few numbers a track a section: anything large is not one.
  if (JSON.stringify(body.report ?? null).length > 64 * 1024) return NextResponse.json({ error: "too big" }, { status: 413 });

  const env = await cfEnv();
  const job = env.COMPOSE_JOB.get(env.COMPOSE_JOB.idFromName(id));
  const p = (await job.progress()) as unknown as ComposeProgress | null;
  if (!p || (!canReadJob(p, { token: body.t ?? "" }) && !canReadJob(p, { userId: await currentUserId() }))) {
    return NextResponse.json({ error: "no such job" }, { status: 404 });
  }
  const ok = await job.heard(body.seq as number, body.report ?? null);
  return NextResponse.json({ ok });
}
