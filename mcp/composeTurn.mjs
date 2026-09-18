// One compose turn: the agent loop that turns "make me a techno beat" into
// calls against the song-editing tools, and the song that comes out.
//
// Plain JS on purpose, like tools.mjs beside it, because it has TWO callers
// that cannot share a build: app/api/compose (bundled into a Next route) and
// netlify/functions/compose-background.mjs (bundled by Netlify, outside Next
// entirely). A whole song takes minutes, which is far longer than a request
// is allowed to run, so in production the background worker does the work and
// the route only starts it -- but `next dev` has no background functions and
// no timeout either, so there the route runs this inline. Same loop either
// way; only who calls it differs.

import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import * as sb from "../public/js/songBuilder.js";
import { TOOLS, FORMAT_NOTES, GUIDE_RELATIVE, guideText } from "./tools.mjs";

export const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5";
// How hard the model works a turn, and so how many rounds it takes. Lower
// effort consolidates tool calls instead of trickling one out per round.
// Deliberately not "disable thinking": on this model that makes it write tool
// calls into visible text, where they never run.
export const DEFAULT_EFFORT = process.env.ANTHROPIC_EFFORT || "medium";
// A whole song is a lot of tracks, each needing steps, a sound and often
// modulation, so the ceiling is high. The worker has 15 minutes; this is what
// stops a loop that has lost the plot from spending all of them.
const MAX_TOOL_ROUNDS = Number(process.env.COMPOSE_MAX_ROUNDS || 60);
const MAX_HISTORY_TURNS = 16;

// Enough to work with if the guide file can't be found. Deliberately NOT a
// second copy of it -- a degraded mode that points at the tools that describe
// themselves, so a missing file costs taste, not the feature.
const GUIDE_FALLBACK = `The compose guide isn't available in this environment. Work from the tools themselves: list_engines and describe_engine say what every engine and its controls do, and each tool's refusal names the valid choices. Prefer a small number of tracks that play well together over a crowded arrangement.`;

let cachedGuide = null;

/**
 * The compose guide, resolved the way a BUNDLED function has to resolve it.
 *
 * tools.mjs's guideText() derives its path from import.meta.url, which is
 * right for `node mcp/server.mjs` and useless here: a bundler rewrites it to
 * the build machine's path (webpack) or drops it (esbuild). process.cwd() is
 * what both hosts document for reading a file shipped alongside the code --
 * Next's outputFileTracingIncludes and Netlify's included_files -- and the
 * walk up covers a runtime whose cwd sits below where that file landed.
 */
export function composeGuide() {
  if (cachedGuide != null) return cachedGuide;
  let dir = process.cwd();
  for (let up = 0; up < 5; up++) {
    try {
      cachedGuide = fs.readFileSync(path.join(dir, GUIDE_RELATIVE), "utf8").replace(/^---[\s\S]*?---\s*/, "");
      return cachedGuide;
    } catch {
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  try {
    cachedGuide = guideText();
  } catch {
    cachedGuide = GUIDE_FALLBACK;
  }
  return cachedGuide;
}

// Built once and reused byte for byte: prompt caching is a PREFIX match, so a
// system prompt differing by a character between rounds would miss on every
// one of them.
let cachedSystem = null;
function systemPrompt() {
  if (cachedSystem == null) {
    cachedSystem = `You are the compose assistant inside seqbaby, a browser step sequencer. You write and edit the song the person has open by calling the tools -- never by describing changes in words instead of making them. Prefer editing what's there over starting over, unless they ask for something new.

${composeGuide()}

---

${FORMAT_NOTES}

The tools operate on the song currently open in the studio (already loaded for you -- call get_song if you need to see it before editing). Asked for a whole song, work in the order the guide gives and build it track by track rather than trying to describe it all at once.

When you're done, stop calling tools and reply in plain, friendly, non-technical language: a sentence or two on what you made or changed, not a list of tool calls. If a tool call fails, read the error, fix the call and try again rather than giving up silently.`;
  }
  return cachedSystem;
}

let cachedTools = null;
/** The tool table as Anthropic tool definitions, from zod's own JSON Schema
 *  conversion so the schema an agent sees can't drift from what the handler
 *  accepts. Stable between calls, which is also what lets it be cached. */
export function anthropicTools() {
  if (!cachedTools) {
    cachedTools = TOOLS.map((t) => {
      const schema = z.toJSONSchema(z.object(t.inputSchema));
      delete schema.$schema;
      return { name: t.name, description: t.description, input_schema: schema };
    });
  }
  return cachedTools;
}

/** A context holding the studio's current session, or a blank song. */
export function newCtx(session) {
  return {
    song: session && typeof session === "object" ? sb.fromBlob(session) : sb.newSong(),
    songName: "untitled",
  };
}

/** The song as plain JSON for window.seqbaby.applySet -- deliberately not
 *  sb.toJSON, which throws on a song that doesn't fully validate yet, which
 *  mid-edit is normal. applySet does its own tolerant validate + migrate. */
export function serializeCtx(ctx) {
  return JSON.parse(JSON.stringify(ctx.song));
}

/** Run one tool call, the way run() in server.mjs does for the stdio side: a
 *  SongError becomes a message the model can act on, not a thrown error. */
export function runTool(ctx, name, args) {
  const t = TOOLS.find((t) => t.name === name);
  if (!t) return { ok: false, error: `unknown tool ${name}` };
  try {
    return { ok: true, result: t.handler(ctx, args ?? {}) };
  } catch (e) {
    return { ok: false, error: e?.name === "SongError" ? e.message : `error: ${e?.message ?? e}` };
  }
}

/** A one-line status for the activity log, so someone watching can follow
 *  along without reading raw tool JSON. */
export function summarize(name, result) {
  if (name === "add_track" && result && typeof result === "object") {
    return `added ${result.name ?? result.engine}`;
  }
  if (name === "set_steps" && result && typeof result === "object") {
    return `wrote pattern ${result.pattern}: ${result.hits} hits`;
  }
  return name.replace(/_/g, " ");
}

/**
 * Run a turn to completion.
 *
 * `onEvent` is called as work happens -- {type:"tool"} per call, {type:"round"}
 * per model turn -- so a caller can show progress while a whole song is being
 * built. It may be async; it is awaited, so a caller that persists progress
 * can do so without racing itself.
 */
export async function runComposeTurn({
  apiKey,
  model = DEFAULT_MODEL,
  effort = DEFAULT_EFFORT,
  message,
  history = [],
  session,
  onEvent = async (_event) => {},
}) {
  const ctx = newCtx(session);
  const anthropic = new Anthropic({ apiKey });
  const tools = anthropicTools();
  const startedAt = Date.now();

  const messages = [
    ...history
      .filter((h) => h && (h.role === "user" || h.role === "assistant") && typeof h.text === "string")
      .slice(-MAX_HISTORY_TURNS)
      .map((h) => ({ role: h.role, content: h.text })),
    { role: "user", content: message },
  ];

  let reply = "";
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    // The stable prefix is big -- the compose guide plus 31 tool schemas --
    // and the prefix renders tools -> system -> messages, so one breakpoint on
    // the system block covers the tools too. Over the dozens of rounds a whole
    // song takes, that is most of what each round would otherwise wait on.
    const res = await anthropic.messages
      .stream({
        model,
        max_tokens: 8192,
        output_config: { effort },
        system: [{ type: "text", text: systemPrompt(), cache_control: { type: "ephemeral" } }],
        tools,
        messages,
      })
      .finalMessage();

    const u = res.usage;
    console.log(
      `[compose] round ${round} ${Date.now() - startedAt}ms in=${u.input_tokens} cache_read=${u.cache_read_input_tokens ?? 0} cache_write=${u.cache_creation_input_tokens ?? 0} out=${u.output_tokens}`,
    );

    messages.push({ role: "assistant", content: res.content });

    const toolUses = res.content.filter((b) => b.type === "tool_use");
    if (toolUses.length === 0) {
      reply = res.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      break;
    }

    const results = [];
    for (const tu of toolUses) {
      const r = runTool(ctx, tu.name, tu.input);
      await onEvent({ type: "tool", name: tu.name, ok: r.ok, summary: r.ok ? summarize(tu.name, r.result) : r.error });
      const text = r.ok ? (typeof r.result === "string" ? r.result : JSON.stringify(r.result)) : r.error;
      results.push({ type: "tool_result", tool_use_id: tu.id, content: text, is_error: !r.ok });
    }
    messages.push({ role: "user", content: results });
    await onEvent({ type: "round", round, ms: Date.now() - startedAt });

    if (round === MAX_TOOL_ROUNDS - 1) {
      reply = "I got a long way into this but ran out of steps before I could finish and explain it -- have a listen, and tell me what to pick up.";
    }
  }

  return {
    reply: reply || "Done.",
    session: serializeCtx(ctx),
    warnings: sb.validate(ctx.song).warnings,
    ms: Date.now() - startedAt,
  };
}
