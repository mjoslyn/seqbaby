import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createJob } from "@/lib/composeJobs.js";
import { newCtx, runComposeTurn } from "@/mcp/composeTurn.mjs";
import { appendJobEvent, finishJob } from "@/lib/composeJobs.js";

// Node runtime: the loop imports public/js/songBuilder.js (dependency-free --
// the same guarantee that lets mcp/server.mjs and the tests run it under
// plain Node) and the Anthropic SDK.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ChatTurn = { role: "user" | "assistant"; text: string };

// POST /api/compose { message, history, session } -> { jobId }
//
// This route does NOT write the song. Writing a whole song is dozens of model
// rounds and takes minutes; a synchronous function gets 26 seconds (measured:
// a turn died at 28s, streaming included -- keeping the connection busy does
// not buy time, it only changes where the cut lands). So the turn goes to a
// background worker that nothing is waiting on, and the browser polls
// /api/compose/status.
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "sign in to use compose chat" }, { status: 401 });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "compose chat isn't configured on this deploy" }, { status: 500 });
  }

  let body: { message?: string; history?: ChatTurn[]; session?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) return NextResponse.json({ error: "say something first" }, { status: 400 });
  if (message.length > 4000) return NextResponse.json({ error: "that message is too long" }, { status: 400 });

  // Adopting the session validates it, so a blob the studio couldn't have
  // written is a bad request -- worth finding out now rather than inside a
  // worker whose only way to report it is a record someone has to poll for.
  try {
    newCtx(body.session);
  } catch (e) {
    const err = e as { message?: string };
    return NextResponse.json({ error: `couldn't read the open song: ${err?.message ?? e}` }, { status: 400 });
  }

  const history = Array.isArray(body.history) ? body.history : [];
  const { id, token } = await createJob({
    userId: user.id,
    message,
    history,
    session: body.session,
  });

  // Aim the worker at the deploy this request arrived on, rather than at
  // whatever a site-wide env var names: a branch preview has to hand its job
  // to its own worker, not to production's.
  const origin = new URL(req.url).origin;
  const workerUrl = `${origin}/.netlify/functions/compose-background`;

  try {
    const res = await fetch(workerUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jobId: id, token }),
    });
    // A background function answers 202 and runs on. Any 2xx means it took
    // the job -- checking for 202 exactly would risk reading "accepted" as
    // "missing" and running the turn a second time here, which is worse than
    // not running it at all. A 404 is the honest miss, and what `next dev`
    // gives, since it serves no /.netlify/ paths.
    if (!res.ok) throw new Error(`worker answered ${res.status}`);
  } catch (e) {
    // No worker, so run it here. That is the local case: `next dev` has no
    // background functions and no 26-second ceiling either, so the same loop
    // runs to completion in-process while the browser polls.
    //
    // In production this is a poor substitute -- the runtime is free to
    // freeze the container once this response goes out -- so it is worth
    // seeing in the logs rather than silently limping.
    console.warn(`[compose] no background worker (${(e as Error).message}); running inline`);
    runInline(id);
  }

  return NextResponse.json({ jobId: id }, { status: 202 });
}

/**
 * The `next dev` path: no background functions, and no 26-second ceiling
 * either, so the turn runs right here. Deliberately NOT awaited -- the
 * response has to go back now so the browser can start polling, exactly as it
 * does against a real worker, which keeps one client path for both.
 */
function runInline(jobId: string) {
  (async () => {
    try {
      const { getJobInput } = await import("@/lib/composeJobs.js");
      const job = await getJobInput(jobId);
      if (!job) return;
      const out = await runComposeTurn({
        apiKey: process.env.ANTHROPIC_API_KEY,
        message: job.message,
        history: job.history,
        session: job.session,
        onEvent: async (e: { type: string }) => {
          if (e.type === "tool") await appendJobEvent(jobId, e);
        },
      });
      await finishJob(jobId, {
        status: "done",
        reply: out.reply,
        session: out.session,
        warnings: out.warnings,
        ms: out.ms,
      });
    } catch (e) {
      const err = e as { message?: string };
      await finishJob(jobId, { status: "error", error: `compose failed: ${err?.message ?? e}` }).catch(() => {});
    }
  })();
}
