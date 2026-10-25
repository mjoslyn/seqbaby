import { NextResponse } from "next/server";
import { currentUserId } from "@/lib/auth/session";
import { cfEnv } from "@/lib/cf";
import { bucketFor, hashApiKey, newJobId, newSecret, siteOutOfBudget } from "@/lib/composeJobs.js";
import { newCtx } from "@/mcp/composeTurn.mjs";
import { SITE_OUT_OF_BUDGET, looksLikeApiKey } from "@/lib/composeKey.js";

export const dynamic = "force-dynamic";

type ChatTurn = { role: "user" | "assistant"; text: string };

// POST /api/compose { message, history, session, apiKey? } -> { jobId, jobToken }
//
// This route does NOT write the song. Writing a whole song is dozens of model
// rounds and takes minutes, longer than a request may run. So the turn goes to
// a Durable Object (workers/composeJob.ts) that runs it in an alarm nobody is
// waiting on, and the browser polls /api/compose/status.
//
// Two ways a turn gets paid for, and which one it is decides what it needs:
//
//   the deploy's key   an account, because the spend is the site's
//   a brought key      nothing at all, because the spend is the visitor's
//
// A brought key is never stored: it goes from this request into the call that
// starts the job, which holds it in memory for the turn and nowhere else.
export async function POST(req: Request) {
  let body: {
    message?: string;
    history?: ChatTurn[];
    session?: unknown;
    apiKey?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  // A brought key decides the whole shape of the request, so it is read before
  // anything else. Shape-checked rather than tried: only Anthropic can say
  // whether a key works, and a typo is worth catching before it becomes a job
  // somebody has to poll for the failure of.
  const brought = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  if (brought && !looksLikeApiKey(brought)) {
    return NextResponse.json(
      { error: "that doesn't look like an Anthropic API key: they start sk-ant-" },
      { status: 400 },
    );
  }

  const env = await cfEnv();
  const userId = brought ? null : await currentUserId();

  // No key of their own: the deploy's, which is the account holders'.
  if (!brought) {
    if (!userId) {
      return NextResponse.json(
        { error: "sign in to compose on this site's key, or add your own Anthropic key" },
        { status: 401 },
      );
    }
    if (!env.ANTHROPIC_API_KEY) {
      return NextResponse.json(
        { error: "this deploy has no Anthropic key of its own: add your own key to compose" },
        { status: 400 },
      );
    }
    // Known to be out of credit: refuse now rather than start a job that can
    // only fail the same way a minute from now.
    if (await siteOutOfBudget(env.DB)) {
      return NextResponse.json({ error: SITE_OUT_OF_BUDGET }, { status: 503 });
    }
  }

  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) return NextResponse.json({ error: "say something first" }, { status: 400 });
  if (message.length > 4000) return NextResponse.json({ error: "that message is too long" }, { status: 400 });

  // Adopting the session validates it, so a blob the studio couldn't have
  // written is a bad request -- worth finding out now rather than inside a
  // job whose only way to report it is a record someone has to poll for.
  try {
    newCtx(body.session);
  } catch (e) {
    const err = e as { message?: string };
    return NextResponse.json({ error: `couldn't read the open song: ${err?.message ?? e}` }, { status: 400 });
  }

  // Only what the turn will read (mcp/composeTurn.mjs keeps 16 turns), and
  // each clipped: the history is sent to the model on the key paying for it.
  const history = (Array.isArray(body.history) ? body.history : [])
    .filter((h) => h && typeof h.text === "string")
    .slice(-16)
    .map((h) => ({ role: h.role, text: h.text.slice(0, 20000) }));

  // A brought-key turn counts against the caller's ADDRESS when Cloudflare
  // names one, else the key: a key is only shape-checked here, so counted per
  // key a script sending a fresh made-up one each time had no limit at all.
  // It counts there even when an account is signed in: one person with a key
  // of their own should not also spend the account allowance they aren't using.
  const ip = req.headers.get("cf-connecting-ip");
  const keyHash = brought ? hashApiKey(ip || brought) : null;
  const bucket = bucketFor({ userId, keyHash });
  if (!bucket) return NextResponse.json({ error: "couldn't tell whose turn that is" }, { status: 400 });

  const id = newJobId();
  const viewToken = newSecret();
  const limits = env.COMPOSE_LIMITS.get(env.COMPOSE_LIMITS.idFromName(bucket));
  const slot = await limits.take(id);
  // Over this bucket's limits. 429 so the panel can say so plainly rather than
  // treating it as a failure to start.
  if (slot.error) return NextResponse.json({ error: slot.error }, { status: 429 });

  try {
    const job = env.COMPOSE_JOB.get(env.COMPOSE_JOB.idFromName(id));
    await job.start(
      { id, userId, keyHash, bucket, viewToken, message, history, session: body.session },
      brought || undefined,
    );
  } catch (e) {
    console.error("[compose] could not start the job", e);
    await limits.release(id).catch(() => {});
    return NextResponse.json({ error: "couldn't start that" }, { status: 500 });
  }

  // The view token is how the browser proves this job is its own to poll --
  // the only proof a signed-out visitor has. Handed back once, held in memory
  // for the life of the turn, and never stored by the browser.
  return NextResponse.json({ jobId: id, jobToken: viewToken }, { status: 202 });
}
