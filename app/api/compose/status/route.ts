import { NextResponse } from "next/server";
import { currentUserId } from "@/lib/auth/session";
import { cfEnv } from "@/lib/cf";
import { canReadJob } from "@/lib/composeJobs.js";
import type { ComposeProgress } from "@/workers/composeJob";

export const dynamic = "force-dynamic";

const ID_RE = /^[A-Za-z0-9_-]{8,40}$/;

// GET /api/compose/status?id=<jobId>&t=<jobToken>
//
// What the browser polls while a turn runs. Returns the activity so far, and
// the song once there is one.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id || !ID_RE.test(id)) return NextResponse.json({ error: "no job" }, { status: 400 });
  const token = url.searchParams.get("t") ?? "";

  const env = await cfEnv();
  // Cast back from the RPC stub's serialisable view of the same object.
  const p = (await env.COMPOSE_JOB.get(env.COMPOSE_JOB.idFromName(id)).progress()) as unknown as
    | (ComposeProgress & { session?: unknown })
    | null;
  // A job holds somebody's song, and its id is the only thing needed to ask
  // for one -- so whose it is has to be proved, not assumed. The token handed
  // back when the job was created is that proof, and the only one a signed-out
  // visitor has; an account still reaches its own jobs without one. Answer the
  // same way for a job that isn't yours as for one that doesn't exist.
  //
  // The token is tried first and an account resolved only if it doesn't
  // answer: this is polled every couple of seconds for as long as a song takes.
  if (!p) return NextResponse.json({ error: "no such job" }, { status: 404 });
  if (!canReadJob(p, { token }) && !canReadJob(p, { userId: await currentUserId() })) {
    return NextResponse.json({ error: "no such job" }, { status: 404 });
  }

  return NextResponse.json({
    status: p.status,
    events: p.events ?? [],
    ...(p.status === "done"
      ? { reply: p.reply, model: p.model, session: p.session, changed: p.changed, warnings: p.warnings }
      : {}),
    ...(p.status === "error" ? { error: p.error } : {}),
  });
}
