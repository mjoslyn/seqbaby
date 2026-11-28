import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth/session";
import { cfEnv } from "@/lib/cf";
import { bucketFor, newJobId, newSecret, siteOutOfBudget } from "@/lib/composeJobs.js";
import { newCtx } from "@/mcp/composeTurn.mjs";
import { SITE_OUT_OF_BUDGET } from "@/lib/composeKey.js";
import { DEFAULT_COMPOSE_MODEL, allowedModels, canPickModel, pickedModel } from "@/lib/composeModels.js";
import { UNLOCK_COOKIE, readUnlock } from "@/lib/unlock.js";
import { cookies } from "next/headers";
import { turnMeta } from "@/lib/data/composeTurns.js";
import {
  FREE_COOKIE,
  FREE_MAX_AGE,
  FREE_MODEL,
  freeBuckets,
  freeConfig,
  freeLimitMessage,
  hashIp,
  mintFree,
  readFree,
} from "@/lib/freeCompose.js";
import { turnstilePasses } from "@/lib/turnstile.js";

export const dynamic = "force-dynamic";

type ChatTurn = { role: "user" | "assistant"; text: string };

// POST /api/compose { message, history, session } -> { jobId, jobToken }
//
// This route does NOT write the song. Writing a whole song is dozens of model
// rounds and takes minutes, longer than a request may run. So the turn goes to
// a Durable Object (workers/composeJob.ts) that runs it in an alarm nobody is
// waiting on, and the browser polls /api/compose/status.
//
// A turn runs on the deploy's key and needs an account, the unlock code's
// cookie (lib/unlock.js), or a free turn (lib/freeCompose.js): a few turns on
// Haiku with no account, behind a visitor cookie, an address and a site-wide
// daily cap. There is no bring-your-own-key path any more.
export async function POST(req: Request) {
  let body: {
    message?: string;
    history?: ChatTurn[];
    session?: unknown;
    model?: string;
    /** The song has never been saved, so the turn should name it. */
    unnamed?: boolean;
    /** The panel can play the turn's song back in a hidden engine and report
     *  the meters (mcp/hearing.mjs), so the turn may ask it to. */
    canHear?: boolean;
    /** What kind of turn this is, for its record: the genre picker's choice. */
    meta?: unknown;
    /** A Turnstile token: asked for on a visitor's first free turn. */
    turnstile?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const env = await cfEnv();
  const user = await currentUser();
  const userId = user?.id ?? null;
  const jar = await cookies();
  const unlockId = await readUnlock(jar.get(UNLOCK_COOKIE)?.value, env.COMPOSE_UNLOCK_CODE);
  // Neither an account nor an unlock: a free turn, when the deploy offers them.
  const free = !userId && !unlockId ? freeConfig(env as unknown as Record<string, string | undefined>) : null;
  if (!userId && !unlockId && !free?.on) {
    return NextResponse.json({ error: "make an account to compose", signup: true }, { status: 401 });
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

  // A model asked for is honoured only when this visitor may pick it: every
  // model for an account on the deploy's list, sonnet and opus for an unlock;
  // anything else runs on the deploy's own.
  const model = pickedModel(body.model, allowedModels({
    picker: canPickModel(user?.email, env.COMPOSE_MODEL_PICKERS),
    unlocked: !!unlockId,
    defaultModel: env.ANTHROPIC_MODEL || DEFAULT_COMPOSE_MODEL,
  }));

  const id = newJobId();
  const viewToken = newSecret();
  const limitsFor = (name: string) => env.COMPOSE_LIMITS.get(env.COMPOSE_LIMITS.idFromName(name));
  // A visitor who passed the robot check keeps the cookie it earned whatever
  // happens next: a Turnstile token is single use.
  let freeCookie: string | null = null;
  const reply = (json: Record<string, unknown>, status: number) => {
    const res = NextResponse.json(json, { status });
    if (freeCookie) {
      res.cookies.set(FREE_COOKIE, freeCookie, {
        httpOnly: true,
        secure: new URL(req.url).protocol === "https:",
        sameSite: "lax",
        path: "/",
        maxAge: FREE_MAX_AGE,
      });
    }
    return res;
  };

  // A free turn: who the visitor is (their cookie, or a new one once the robot
  // check passes), then the three limits, each given back if a later one says no.
  let freeId: string | null = null;
  let freeLeft: number | null = null;
  const undo: (() => Promise<void>)[] = [];
  const unwind = () => Promise.all(undo.map((f) => f().catch(() => {})));
  if (free) {
    const ip = req.headers.get("cf-connecting-ip") || null;
    freeId = await readFree(jar.get(FREE_COOKIE)?.value, free.secret);
    if (!freeId) {
      if (!(await turnstilePasses(env.TURNSTILE_SECRET_KEY, body.turnstile, ip))) {
        return NextResponse.json({ error: "one quick robot check first", check: true }, { status: 403 });
      }
      freeCookie = await mintFree(free.secret);
      freeId = freeCookie.slice(0, freeCookie.indexOf("."));
    }
    const visitor = limitsFor(freeBuckets.visitor(freeId));
    const mine = await visitor.takeFree(id, free.turns, free.windowMs);
    if (mine.error) {
      return reply({ error: freeLimitMessage("visitor", free), signup: true, freeLeft: 0 }, 429);
    }
    freeLeft = mine.left ?? null;
    undo.push(() => visitor.dropFree(id));
    if (ip && free.ipPerDay > 0) {
      const addr = limitsFor(freeBuckets.ip(await hashIp(ip, free.secret)));
      if ((await addr.takeDay(free.ipPerDay)).error) {
        await unwind();
        return reply({ error: freeLimitMessage("ip", free), signup: true }, 429);
      }
      undo.push(() => addr.dropDay());
    }
    const site = limitsFor(freeBuckets.site());
    if ((await site.takeDay(free.sitePerDay)).error) {
      await unwind();
      return reply({ error: freeLimitMessage("site", free), signup: true }, 429);
    }
    undo.push(() => site.dropDay());
  }

  // An account's own limits; an unlocked visitor's own too, by the visitor id
  // their cookie carries; a free visitor's by theirs.
  const bucket = free && freeId ? freeBuckets.visitor(freeId) : bucketFor({ userId, keyHash: null, unlockId });
  if (!bucket) {
    await unwind();
    return reply({ error: "couldn't tell whose turn that is" }, 400);
  }

  const limits = limitsFor(bucket);
  const slot = await limits.take(id);
  // Over this bucket's limits. 429 so the panel can say so plainly rather than
  // treating it as a failure to start.
  if (slot.error) {
    await unwind();
    return reply({ error: slot.error }, 429);
  }

  try {
    const job = env.COMPOSE_JOB.get(env.COMPOSE_JOB.idFromName(id));
    await job.start(
      { id, userId, keyHash: null, bucket, viewToken, message, history, session: body.session, model: free ? FREE_MODEL : model, unnamed: body.unnamed === true, canHear: body.canHear === true, meta: turnMeta(body.meta) },
    );
  } catch (e) {
    console.error("[compose] could not start the job", e);
    await limits.release(id).catch(() => {});
    await unwind();
    return reply({ error: "couldn't start that" }, 500);
  }

  // The view token is how the browser proves this job is its own to poll.
  // Handed back once, held in memory
  // for the life of the turn, and never stored by the browser.
  return reply({ jobId: id, jobToken: viewToken, ...(free ? { freeLeft } : {}) }, 202);
}
