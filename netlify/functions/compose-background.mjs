// The compose worker.
//
// A Netlify function whose name ends in `-background` answers 202 immediately
// and then keeps running for up to 15 minutes with nobody waiting on it --
// which is the only shape that fits writing a whole song. The ordinary
// request path gets 26 seconds (measured: a turn died at 28s), and a song is
// dozens of tool calls across dozens of model rounds.
//
// It owns no logic of its own: the loop is mcp/composeTurn.mjs, the same one
// `next dev` runs inline where there are no background functions and no
// timeout to escape. This file is the wiring -- read the job, run the turn,
// write the progress the browser is polling.

import { runComposeTurn } from "../../mcp/composeTurn.mjs";
import { getJobInput, appendJobEvent, finishJob } from "../../lib/composeJobs.js";

export default async (req) => {
  let jobId;
  try {
    const body = await req.json();
    jobId = body?.jobId;
    const token = body?.token;
    if (!jobId || !token) return new Response("bad request", { status: 400 });

    const job = await getJobInput(jobId);
    if (!job) return new Response("no such job", { status: 404 });
    // The id is enough to find a job, so the token is what says this
    // invocation came from the route that created it.
    if (job.token !== token) return new Response("forbidden", { status: 403 });

    const out = await runComposeTurn({
      apiKey: process.env.ANTHROPIC_API_KEY,
      message: job.message,
      history: job.history,
      session: job.session,
      // Persisted as it happens rather than at the end: the point of a job
      // that runs for minutes is being able to watch it.
      onEvent: async (e) => {
        if (e.type === "tool") await appendJobEvent(jobId, e);
      },
    });

    await finishJob(jobId, {
      status: "done",
      reply: out.reply,
      session: out.session,
      changed: out.changed,
      warnings: out.warnings,
      ms: out.ms,
    });
  } catch (e) {
    console.error("[compose-background]", e);
    // A worker nobody is awaiting has exactly one way to report anything: the
    // record the browser is polling. Failing to write it would leave the chat
    // spinning until it times itself out.
    if (jobId) {
      await finishJob(jobId, { status: "error", error: `compose failed: ${e?.message ?? e}` }).catch(() => {});
    }
  }
  return new Response("ok");
};
