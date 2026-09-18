// Bridges the shared song-editing tool table (mcp/tools.mjs, which wraps
// public/js/songBuilder.js) onto the Anthropic Messages API, for the
// studio's own "compose chat" panel. Server-only: imported by
// app/api/compose/route.ts, never by a client component, so songBuilder's
// Node-only guarantee (no DOM, no Tone, no window) is never asked to hold in
// a browser bundle.
//
// The MCP server (mcp/server.mjs) is the other consumer of the same table,
// over stdio for an external agent. Sharing it here means a tool's
// description, its validation and what it refuses can't drift between the
// two surfaces -- an engine control added to songBuilder.js's tables is a
// control both the studio's chat and an external agent know about, still
// from one place.
import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import * as sb from "@/public/js/songBuilder.js";
import { TOOLS, FORMAT_NOTES, guideText } from "@/mcp/tools.mjs";

export type ComposeSong = ReturnType<typeof sb.newSong>;
export interface ComposeCtx {
  song: ComposeSong;
  songName: string;
}

/** A fresh context, or one adopting the studio's current session (from
 *  window.seqbaby.serializeSet() on the client) so the chat edits what's
 *  actually open rather than starting over on every message. */
export function newCtx(session?: unknown): ComposeCtx {
  const song =
    session && typeof session === "object"
      ? (sb.fromBlob(session) as ComposeSong)
      : sb.newSong();
  return { song, songName: "untitled" };
}

/** The song as a plain JSON-serializable object for window.seqbaby.applySet
 *  -- deliberately not sb.toJSON, which throws on a song that doesn't fully
 *  validate yet (mid-edit, between tool calls, that's normal). applySet on
 *  the client does its own tolerant validate + migrate. */
export function serializeCtx(ctx: ComposeCtx): unknown {
  return JSON.parse(JSON.stringify(ctx.song));
}

let cachedTools: Anthropic.Tool[] | null = null;
/** The tool table as Anthropic tool definitions: zod's own JSON Schema
 *  conversion, so the schema an agent sees can't drift from what the
 *  handler actually accepts. */
export function anthropicTools(): Anthropic.Tool[] {
  if (!cachedTools) {
    cachedTools = TOOLS.map((t) => {
      const schema = z.toJSONSchema(z.object(t.inputSchema)) as Record<string, unknown>;
      delete schema.$schema;
      return { name: t.name, description: t.description, input_schema: schema as Anthropic.Tool["input_schema"] };
    });
  }
  return cachedTools;
}

export interface ToolRunResult {
  ok: boolean;
  result?: unknown;
  error?: string;
}

/** Run one tool call by name against a context, the way run() in
 *  mcp/server.mjs does for the stdio side: a SongError becomes a message the
 *  model can read and try again from, anything else is an unexpected error. */
export function runTool(ctx: ComposeCtx, name: string, args: unknown): ToolRunResult {
  const t = TOOLS.find((t) => t.name === name);
  if (!t) return { ok: false, error: `unknown tool ${name}` };
  const handler = t.handler as (ctx: ComposeCtx, args: unknown) => unknown;
  try {
    const result = handler(ctx, args ?? {});
    return { ok: true, result };
  } catch (e) {
    const err = e as { name?: string; message?: string };
    return { ok: false, error: err?.name === "SongError" ? err.message : `error: ${err?.message ?? e}` };
  }
}

export { FORMAT_NOTES, guideText, sb };
