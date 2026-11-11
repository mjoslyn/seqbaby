import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth/session";
import { cfEnv } from "@/lib/cf";
import { bucketFor, newJobId, newSecret, siteOutOfBudget } from "@/lib/composeJobs.js";
import { newCtx } from "@/mcp/composeTurn.mjs";
import { SITE_OUT_OF_BUDGET } from "@/lib/composeKey.js";
import { canPickModel, pickedModel } from "@/lib/composeModels.js";

export const dynamic = "force-dynamic";

type ChatTurn = { role: "user" | "assistant"; text: string };

// POST /api/compose { message, history, session } -> { jobId, jobToken }
//
// This route does NOT write the song. Writing a whole song is dozens of model
// rounds and takes minutes, longer than a request may run. So the turn goes to
// a Durable Object (workers/composeJob.ts) that runs it in an alarm nobody is
// waiting on, and the browser polls /api/compose/status.
//
// A turn runs on the deploy's key and needs an account: the spend is the
// site's. There is no bring-your-own-key path any more.
export async function POST(req: Request) {
  let body: {
    message?: string;
    history?: ChatTurn[];
    session?: unknown;
    model?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const env = await cfEnv();
  const user = await currentUser();
  const userId = user?.id ?? null;
  if (!userId) {
    return NextResponse.json({ error: "make an account to compose" }, { status: 401 });
  }
  if (!env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "compose isn't set up on this deploy" }, { status: 400 });
  }
  // Known to be out of credit: refuse now rather than start a job that can
  // only fail the same way a minute from now.
  if (await siteOutOfBudget(env.DB)) {
    return NextResponse.json({ error: SITE_OUT_OF_BUDGET }, { status: 503 });
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

  // A model asked for is honoured only for an account on the deploy's list,
  // and only from COMPOSE_MODELS; anything else runs on the deploy's own.
  const model = pickedModel(body.model, canPickModel(user?.email, env.COMPOSE_MODEL_PICKERS));

  const bucket = bucketFor({ userId, keyHash: null });
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
      { id, userId, keyHash: null, bucket, viewToken, message, history, session: body.session, model },
    );
  } catch (e) {
    console.error("[compose] could not start the job", e);
    await limits.release(id).catch(() => {});
    return NextResponse.json({ error: "couldn't start that" }, { status: 500 });
  }

  // The view token is how the browser proves this job is its own to poll.
  // Handed back once, held in memory
  // for the life of the turn, and never stored by the browser.
  return NextResponse.json({ jobId: id, jobToken: viewToken }, { status: 202 });
}
