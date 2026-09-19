import { NextResponse } from "next/server";
import { tryInviteCode } from "@/lib/composeInvites";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/compose/invite { code } -> { ok, remaining? } | { ok: false, reason }
//
// Whether a code is good, without spending it. This exists for the same
// reason the key field is shape-checked in the panel: the box a credential
// was typed into is the only place a mistake in it can be fixed, and reported
// from a turn instead it arrives minutes later with the message that prompted
// it already spent.
//
// It is POST rather than GET because a code is a secret and a GET puts it in
// a URL, which is the one place a secret reliably ends up written down -- in
// a log, in a referrer, in someone's history.
//
// It spends nothing (`consume: false`), so it is not a way to burn somebody
// else's code; what it is, is the same oracle `POST /api/compose` already is
// for anyone willing to send a message, and guessing against 31^12 codes is
// not a strategy either way.
export async function POST(req: Request) {
  let code = "";
  try {
    const body = await req.json();
    code = typeof body?.code === "string" ? body.code : "";
  } catch {
    return NextResponse.json({ ok: false, reason: "bad request" }, { status: 400 });
  }

  const res = await tryInviteCode(code, { consume: false });
  // 200 either way: "that code is expired" is an answer to the question asked,
  // not a failure of the request, and the panel reads `ok`.
  return NextResponse.json(res);
}
