import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createJob, hashApiKey, hashInviteCode } from "@/lib/composeJobs.js";
import { newCtx, runComposeTurn } from "@/mcp/composeTurn.mjs";
import { appendJobEvent, finishJob } from "@/lib/composeJobs.js";
import { isComposeModel } from "@/lib/composeModels.js";
import { describeTurnFailure, looksLikeApiKey } from "@/lib/composeKey.js";
import { looksLikeInviteCode, normalizeInviteCode } from "@/lib/composeInvite.js";
import { tryInviteCode } from "@/lib/composeInvites";

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

// POST /api/compose { message, history, session, model?, apiKey?, inviteCode? }
//   -> { jobId, jobToken }
//
// This route does NOT write the song. Writing a whole song is dozens of model
// rounds and takes minutes; a synchronous function gets 26 seconds (measured:
// a turn died at 28s, streaming included -- keeping the connection busy does
// not buy time, it only changes where the cut lands). So the turn goes to a
// background worker that nothing is waiting on, and the browser polls
// /api/compose/status.
//
// Three ways a turn gets paid for, and which one it is decides what it needs:
//
//   the deploy's key   an account, because the spend is the site's
//   an invite code     nothing but the code, which the site's owner minted
//                      with a budget in turns (migration 0012)
//   a brought key      nothing at all, because the spend is the visitor's
//
// The middle one is the deploy's key too -- what the code buys is permission
// to spend it, bounded, without an account. So it is checked here and spent
// here, and everything downstream (the worker, the status route) is unchanged:
// to them it is a turn on this site's key like any other.
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
    inviteCode?: string;
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

  // A code is only consulted when no key was brought: a visitor who has their
  // own key is not spending the site's, so there is nothing for a code to let
  // them do. Shape-checked here as well, so a typo costs no round trip.
  const invite = !brought && typeof body.inviteCode === "string" ? normalizeInviteCode(body.inviteCode) : "";
  if (invite && !looksLikeInviteCode(invite)) {
    return NextResponse.json({ error: "that doesn't look like an invite code" }, { status: 400 });
  }

  // Whose allowance this counts against. A brought key and a code each stand
  // on their own, so neither carries an account even when one is signed in --
  // see `bucketFor` in lib/composeJobs.js.
  const userId = brought || invite ? null : await currentUserId();

  // Nothing that says who this is: no key, no code, no account.
  if (!brought && !invite && !userId) {
    return NextResponse.json(
      { error: "sign in to compose on this site's key, or use an invite code or your own Anthropic key" },
      { status: 401 },
    );
  }
  // Anything but a brought key runs on the deploy's, so the deploy needs one.
  // A code is permission to spend that key, not a key -- so a deploy without
  // one cannot honour a code either, and says so rather than failing a minute
  // into a turn.
  if (!brought && !process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "this deploy has no Anthropic key of its own — add your own key to compose" },
      { status: 400 },
    );
  }

  // Look before starting a job: a code that is revoked, expired or spent
  // should be told so plainly, and a guessed one should not leave a job
  // record behind it. Nothing is spent yet -- that happens once the site's own
  // limits have let the turn through, so a refusal here costs the code
  // nothing.
  if (invite) {
    const check = await tryInviteCode(invite, { consume: false });
    if (!check.ok) return NextResponse.json({ error: check.reason }, { status: 403 });
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
    inviteHash: invite ? hashInviteCode(invite) : null,
    message,
    history,
    session: body.session,
    model,
  });
  // Over this bucket's limits. 429 so the panel can say so plainly rather than
  // treating it as a failure to start.
  if (error || !id) return NextResponse.json({ error: error ?? "couldn't start that" }, { status: 429 });

  // The turn is going ahead, so the code pays for it. Checked a second time
  // rather than trusted from the look above, because the two are not the same
  // question: a code on its last turn can be spent by another browser in
  // between, and the row lock in `redeem_compose_invite` is the only place
  // that race is settled. A job that loses it is ended here rather than
  // handed to a worker -- its record exists for a moment and is released with
  // it.
  let inviteRemaining: number | null | undefined;
  if (invite) {
    const spent = await tryInviteCode(invite, { consume: true });
    if (!spent.ok) {
      await finishJob(id, { status: "error", error: spent.reason ?? "that code is no longer good" }).catch(() => {});
      return NextResponse.json({ error: spent.reason }, { status: 403 });
    }
    inviteRemaining = spent.remaining ?? null;
  }

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
  // `inviteRemaining` is what the code has left after paying for this turn --
  // the panel prints it, so the budget is visible where it is being spent
  // rather than only to whoever minted the code. Absent when no code was used.
  return NextResponse.json(
    { jobId: id, jobToken: viewToken, ...(inviteRemaining !== undefined ? { inviteRemaining } : {}) },
    { status: 202 },
  );
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
