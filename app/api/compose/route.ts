import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import {
  anthropicTools,
  composeGuide,
  FORMAT_NOTES,
  newCtx,
  runTool,
  serializeCtx,
  sb,
} from "@/app/compose/tools";

// Node runtime: app/compose/tools.ts imports public/js/songBuilder.js
// (dependency-free, no DOM/Tone/window -- the same guarantee that lets
// mcp/server.mjs and the test suite run it under plain Node) and the
// Anthropic SDK.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
const MAX_TOOL_ROUNDS = 12;
const MAX_HISTORY_TURNS = 16;

type ChatTurn = { role: "user" | "assistant"; text: string };

/** One newline-delimited JSON event on the response stream. `beat` carries
 *  nothing and exists only to keep bytes moving; the client ignores it. */
export type StreamEvent =
  | { type: "start" }
  | { type: "beat" }
  | { type: "tool"; name: string; ok: boolean; summary: string }
  | { type: "result"; reply: string; session: unknown; warnings: string[] }
  | { type: "error"; error: string; session?: unknown };

function systemPrompt() {
  return `You are the compose assistant inside seqbaby, a browser step sequencer. You write and edit the song the person has open by calling the tools -- never by describing changes in words instead of making them. Work in small, checkable steps and prefer editing what's there over starting over, unless they ask for something new.

${composeGuide()}

---

${FORMAT_NOTES}

The tools operate on the song currently open in the studio (already loaded for you -- call get_song if you need to see it before editing). When you're done with a request, stop calling tools and reply in plain, friendly, non-technical language: a sentence or two on what you changed, not a list of tool calls. If a tool call fails, read the error, fix the call, and try again rather than giving up silently.`;
}

// A tool_use turn's error becomes tool_result content the model reads, same
// as an MCP client sees a SongError -- so the agent can act on it instead of
// silently stalling.
function toolResultBlock(id: string, r: { ok: boolean; result?: unknown; error?: string }) {
  const text = r.ok ? (typeof r.result === "string" ? r.result : JSON.stringify(r.result)) : r.error!;
  return { type: "tool_result" as const, tool_use_id: id, content: text, is_error: !r.ok };
}

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

  const history = Array.isArray(body.history) ? body.history.slice(-MAX_HISTORY_TURNS) : [];

  // Adopting the studio's session validates it, so a blob the studio can't
  // have produced is a bad request -- and it has to fail HERE, while a status
  // code still means something. Once the stream opens, 200 is already sent.
  let ctx;
  try {
    ctx = newCtx(body.session);
  } catch (e) {
    const err = e as { message?: string };
    return NextResponse.json({ error: `couldn't read the open song: ${err?.message ?? e}` }, { status: 400 });
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const tools = anthropicTools();

  const messages: Anthropic.MessageParam[] = [
    ...history
      .filter((h) => h && (h.role === "user" || h.role === "assistant") && typeof h.text === "string")
      .map((h) => ({ role: h.role, content: h.text }) as Anthropic.MessageParam),
    { role: "user", content: message },
  ];

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (event: StreamEvent) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        } catch {
          open = false; // the client hung up
        }
      };

      // A turn is several model calls end to end, which is far longer than a
      // serverless request is allowed to sit silent -- the hosting layer cut
      // the whole thing off and answered with its own HTML error page, which
      // is what "Unexpected token '<'" was. So: a byte immediately, and never
      // a long silence after it. The tool events carry real progress; the
      // heartbeat covers the gaps while a model call is in flight.
      send({ type: "start" });
      const beat = setInterval(() => send({ type: "beat" }), 2000);

      let reply = "";
      try {
        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
          const res = await anthropic.messages.create({
            model: MODEL,
            max_tokens: 4096,
            system: systemPrompt(),
            tools,
            messages,
          });

          messages.push({ role: "assistant", content: res.content });

          const toolUses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
          if (toolUses.length === 0) {
            reply = res.content
              .filter((b): b is Anthropic.TextBlock => b.type === "text")
              .map((b) => b.text)
              .join("\n")
              .trim();
            break;
          }

          const resultBlocks = toolUses.map((tu) => {
            const r = runTool(ctx, tu.name, tu.input);
            send({
              type: "tool",
              name: tu.name,
              ok: r.ok,
              summary: r.ok ? summarize(tu.name, r.result) : r.error!,
            });
            return toolResultBlock(tu.id, r);
          });
          messages.push({ role: "user", content: resultBlocks });

          if (round === MAX_TOOL_ROUNDS - 1) {
            reply = "I made a batch of changes but ran out of steps to finish and explain them -- have a listen, and tell me what to adjust.";
          }
        }

        // The song goes out whatever happened above: the tools already ran,
        // so the edits exist and the studio should get them.
        send({
          type: "result",
          reply: reply || "Done.",
          session: serializeCtx(ctx),
          warnings: sb.validate(ctx.song).warnings,
        });
      } catch (e) {
        const err = e as { message?: string };
        // Past the first byte there is no status code left to fail with, so
        // the error travels as an event -- with the song, since whatever the
        // tools did before the failure is still real work.
        send({
          type: "error",
          error: `compose failed: ${err?.message ?? e}`,
          session: serializeCtx(ctx),
        });
      } finally {
        clearInterval(beat);
        open = false;
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store, no-transform",
      // Asks an intermediary not to sit on the body waiting for the end,
      // which would undo the point of streaming it.
      "x-accel-buffering": "no",
    },
  });
}

// A one-line status for the chat's activity log, so a person watching can
// follow along without reading raw tool JSON.
function summarize(name: string, result: unknown): string {
  if (name === "add_track" && result && typeof result === "object") {
    const r = result as { index?: number; engine?: string; name?: string };
    return `added track ${r.index}: ${r.name ?? r.engine}`;
  }
  if (name === "set_steps" && result && typeof result === "object") {
    const r = result as { pattern?: number; hits?: number };
    return `wrote pattern ${r.pattern}: ${r.hits} hits`;
  }
  return name.replace(/_/g, " ");
}
