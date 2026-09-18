import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canReadJob, getJobProgress } from "@/lib/composeJobs.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Who is asking, if anyone. Never throws, for app/api/compose's reasons: a
 *  turn run on a brought key belongs to a visitor with no account. */
async function currentUserId(): Promise<string | null> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user?.id ?? null;
  } catch {
    return null;
  }
}

// GET /api/compose/status?id=<jobId>&t=<jobToken>
//
// What the browser polls while a turn runs. Returns the activity so far, and
// the song once there is one.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "no job" }, { status: 400 });
  const token = url.searchParams.get("t") ?? "";

  const p = await getJobProgress(id);
  // A job holds somebody's song, and its id is the only thing needed to ask
  // for one -- so whose it is has to be proved, not assumed. The token handed
  // back when the job was created is that proof, and it is the only one a
  // signed-out visitor composing on their own key has; an account still
  // reaches its own jobs without one. Answer the same way for a job that
  // isn't yours as for one that doesn't exist.
  //
  // The token is tried first, and an account resolved only if it doesn't
  // answer: validating a session costs a Supabase round trip, and this is
  // polled every couple of seconds for as long as a whole song takes.
  if (!p) return NextResponse.json({ error: "no such job" }, { status: 404 });
  if (!canReadJob(p, { token }) && !canReadJob(p, { userId: await currentUserId() })) {
    return NextResponse.json({ error: "no such job" }, { status: 404 });
  }

  return NextResponse.json({
    status: p.status,
    events: p.events ?? [],
    // Only once it is finished: a session runs to megabytes and this is polled
    // every couple of seconds.
    ...(p.status === "done"
      ? { reply: p.reply, model: p.model, session: p.session, changed: p.changed, warnings: p.warnings }
      : {}),
    ...(p.status === "error" ? { error: p.error } : {}),
  });
}
