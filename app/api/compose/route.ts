import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createJob, hashApiKey } from "@/lib/composeJobs.js";
import { newCtx, runComposeTurn } from "@/mcp/composeTurn.mjs";
import { appendJobEvent, finishJob } from "@/lib/composeJobs.js";
import { isComposeModel } from "@/lib/composeModels.js";
import { describeTurnFailure, looksLikeApiKey } from "@/lib/composeKey.js";

// Node runtime: the loop imports public/js/songBuilder.js (dependency-free --
// the same guarantee that lets mcp/server.mjs and the tests run it under
// plain Node) and the Anthropic SDK.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ChatTurn = { role: "user" | "assistant"; text: string };

/**
 * Who is asking, if anyone. Never throws: composing on a brought key needs no
 * account, and a deploy running with no Supabase env at all (which the engine
 * is meant to do) would otherwise fail every request here inside the client
 * constructor rather than answering one.
 */
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

// POST /api/compose { message, history, session, model?, apiKey? } -> { jobId, jobToken }
//
// This route does NOT write the song. Writing a whole song is dozens of model
// rounds and takes minutes; a synchronous function gets 26 seconds (measured:
// a turn died at 28s, streaming included -- keeping the connection busy does
// not buy time, it only changes where the cut lands). So the turn goes to a
// background worker that nothing is waiting on, and the browser polls
// /api/compose/status.
//
// Two ways a turn gets paid for, and which one it is decides what it needs:
//
//   the deploy's key   an account, because the spend is the site's
//   a brought key      nothing at all, because the spend is the visitor's
//
// A brought key is never stored: it goes from this request into the POST that
// starts the worker and nowhere else (see lib/composeJobs.js).
export async function POST(req: Request) {
  let body: {
    message?: string;
    history?: ChatTurn[];
    session?: unknown;
    model?: string;
    apiKey?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  // A brought key decides the whole shape of the request, so it is read before
  // anything else. Shaped-checked rather than tried: only Anthropic can say
  // whether a key works, and a typo is worth catching before it becomes a job
  // somebody has to poll for the failure of.
  const brought = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  if (brought && !looksLikeApiKey(brought)) {
    return NextResponse.json(
      { error: "that doesn't look like an Anthropic API key — they start sk-ant-" },
      { status: 400 },
    );
  }

  const userId = brought ? null : await currentUserId();

  // No key of their own: the deploy's, which is the account holders'.
  if (!brought) {
    if (!userId) {
      return NextResponse.json(
        { error: "sign in to compose on this site's key, or add your own Anthropic key" },
        { status: 401 },
      );
    }
    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json(
        { error: "this deploy has no Anthropic key of its own — add your own key to compose" },
        { status: 400 },
      );
    }
  }

  // The model is the browser's to pick per message, but not to invent. On the
  // deploy's key that is because the turn is billed to the site; on a brought
  // key it is because an id nobody has vetted is a request this app would be
  // making on someone's behalf without knowing what it costs. Absent is fine
  // and means the deploy's own default (ANTHROPIC_MODEL, else the shared one).
  const model = typeof body.model === "string" && body.model ? body.model : undefined;
  if (model && !isComposeModel(model)) {
    return NextResponse.json({ error: "that isn't a model this deploy will run" }, { status: 400 });
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
  // A brought-key turn counts against the KEY even when an account is signed
  // in: the limits ration this site's worker, and one person with a key of
  // their own should not also be spending the account allowance they aren't
  // using. What is stored is the hash; the key itself stops here.
  const { id, token, viewToken, error } = await createJob({
    userId,
    keyHash: brought ? hashApiKey(brought) : null,
    message,
    history,
    session: body.session,
    model,
  });
  // Over this bucket's limits. 429 so the panel can say so plainly rather than
  // treating it as a failure to start.
  if (error || !id) return NextResponse.json({ error: error ?? "couldn't start that" }, { status: 429 });

  // Aim the worker at the deploy this request arrived on, rather than at
  // whatever a site-wide env var names: a branch preview has to hand its job
  // to its own worker, not to production's.
  const origin = new URL(req.url).origin;
  const workerUrl = `${origin}/.netlify/functions/compose-background`;

  try {
    const res = await fetch(workerUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      // The key rides this hop and no other. It is not in the job record, so
      // this POST is the only place a brought key exists outside the browser
      // that typed it and the worker invocation that spends it.
      body: JSON.stringify({ jobId: id, token, ...(brought ? { apiKey: brought } : {}) }),
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
    runInline(id, brought || undefined);
  }

  // The view token is how the browser proves this job is its own to poll --
  // the only proof a signed-out visitor has. Handed back once, held in memory
  // for the life of the turn, and never stored anywhere.
  return NextResponse.json({ jobId: id, jobToken: viewToken }, { status: 202 });
}

/**
 * The `next dev` path: no background functions, and no 26-second ceiling
 * either, so the turn runs right here. Deliberately NOT awaited -- the
 * response has to go back now so the browser can start polling, exactly as it
 * does against a real worker, which keeps one client path for both.
 *
 * The brought key is passed in rather than re-read from the job, because the
 * job does not have it.
 */
function runInline(jobId: string, apiKey?: string) {
  (async () => {
    try {
      const { getJobInput } = await import("@/lib/composeJobs.js");
      const job = await getJobInput(jobId);
      if (!job) return;
      const key = apiKey || process.env.ANTHROPIC_API_KEY;
      if (!key) {
        await finishJob(jobId, { status: "error", error: "no Anthropic key to run that on" });
        return;
      }
      const out = await runComposeTurn({
        apiKey: key,
        // Undefined here takes runComposeTurn's own default parameter, which
        // is the deploy's -- so a job with no model on it behaves exactly as
        // every job did before there was a choice.
        model: job.model,
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
        model: out.model,
        session: out.session,
        changed: out.changed,
        warnings: out.warnings,
        ms: out.ms,
      });
    } catch (e) {
      await finishJob(jobId, { status: "error", error: describeTurnFailure(e, !!apiKey) }).catch(() => {});
    }
  })();
}
