import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getJobProgress } from "@/lib/composeJobs.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/compose/status?id=<jobId>
//
// What the browser polls while a turn runs. Returns the activity so far, and
// the song once there is one.
export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "sign in to use compose chat" }, { status: 401 });

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "no job" }, { status: 400 });

  const p = await getJobProgress(id);
  // A job holds somebody's song, and its id is the only thing needed to ask
  // for one -- so whose it is has to be checked, not assumed. Answer the same
  // way for a job that isn't yours as for one that doesn't exist.
  if (!p || p.userId !== user.id) return NextResponse.json({ error: "no such job" }, { status: 404 });

  return NextResponse.json({
    status: p.status,
    events: p.events ?? [],
    // Only once it is finished: a session runs to megabytes and this is polled
    // every couple of seconds.
    ...(p.status === "done"
      ? { reply: p.reply, session: p.session, changed: p.changed, warnings: p.warnings }
      : {}),
    ...(p.status === "error" ? { error: p.error } : {}),
  });
}
