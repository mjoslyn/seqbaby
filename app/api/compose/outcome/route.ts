import { NextResponse } from "next/server";
import { currentUserId } from "@/lib/auth/session";
import { cfEnv } from "@/lib/cf";
import { OUTCOMES, setTurnOutcome } from "@/lib/data/composeTurns.js";

export const dynamic = "force-dynamic";

const ID_RE = /^[A-Za-z0-9_-]{8,40}$/;

// POST /api/compose/outcome { id, t, outcome, auditioned }
//
// What became of a turn's changes: kept, discarded, superseded by the next
// ask, or dropped when another song arrived. The one signal of whether a
// turn was any good (lib/data/composeTurns.js). Set by the turn's starter:
// the account on its row, or the job's view token.
export async function POST(req: Request) {
  let body: { id?: string; t?: string; outcome?: string; auditioned?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  if (!body.id || !ID_RE.test(body.id) || !OUTCOMES.includes(body.outcome ?? "")) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  const env = await cfEnv();
  const ok = await setTurnOutcome(
    env.DB,
    { id: body.id, userId: await currentUserId(), token: typeof body.t === "string" ? body.t : "" },
    { outcome: body.outcome as string, auditioned: body.auditioned === true },
  ).catch(() => false);
  return NextResponse.json({ ok });
}
