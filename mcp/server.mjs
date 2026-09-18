#!/usr/bin/env node
// The seqbaby MCP server: a way for an agent to write a song.
//
// Runs on stdio, holds ONE song in memory (the serialized session the studio
// loads), and exposes songBuilder.js as tools: add a track, spell its steps,
// set its sound, put an LFO on a parameter, turn a generator on, then export
// the JSON or post it to /api/share for a link. The reference material an
// agent needs -- the engine catalog with what each slider does, the LFO and
// automation targets, the format notes, and the compose guide -- is served as
// resources rather than packed into tool descriptions, so the tool list stays
// short.
//
// Nothing here knows how a sound is made. The engine half is
// public/js/songBuilder.js (pure, tested under node --test). The song-editing
// tool TABLE (name, schema, handler) lives in tools.mjs, shared with the
// studio's own compose chat (app/compose/tools.ts) so the two surfaces can't
// drift on what a tool does or accepts; this file adds the resources, the
// two file/network tools that only make sense over stdio (export_song's
// `path`, load_song's `path`, share_song, audition_song), and the wiring:
// zod -> MCP tool registration, error shaping.
//
// Connect it:
//   Claude Code   -- the repo's .mcp.json already names it (node mcp/server.mjs)
//   Claude Desktop -- add { "command": "node", "args": ["<repo>/mcp/server.mjs"] }
//                     under mcpServers in claude_desktop_config.json
// Env: SEQBABY_URL (default https://seqbaby.netlify.app) is where share_song
// posts and audition_song opens the studio.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import * as sb from "../public/js/songBuilder.js";
import { TOOLS, FORMAT_NOTES as BASE_FORMAT_NOTES, guideText } from "./tools.mjs";

const SEQBABY_URL = (process.env.SEQBABY_URL || "https://seqbaby.netlify.app").replace(/\/$/, "");

// ---- the one song ------------------------------------------------------------
const ctx = { song: sb.newSong(), songName: "untitled" };

const text = (v) => ({ content: [{ type: "text", text: typeof v === "string" ? v : JSON.stringify(v, null, 1) }] });
const oops = (e) => ({ isError: true, content: [{ type: "text", text: e instanceof sb.SongError ? e.message : `error: ${e?.message || e}` }] });
/** Wrap a builder call: its return value as text, a SongError as a tool error. */
const run = (fn) => async (args, extra) => { try { return text(await fn(args, extra)); } catch (e) { return oops(e); } };

const server = new McpServer({ name: "seqbaby", version: "1.0.0" }, {
  instructions: `Write songs for seqbaby, a browser step sequencer. Read the resource seqbaby://guide before composing: it says which engine to reach for, how the step strings are spelled, and the order of work. Tracks are addressed by index, patterns by 0..31. Finish with validate_song, then export_song or share_song.`,
});

// ---- resources -------------------------------------------------------------------
const resources = {
  "seqbaby://guide": { name: "compose guide", description: "How to write music for seqbaby: which engine for which role, the step-string grammar, the idioms each engine rewards, and the order of work. Read this first.", mime: "text/markdown", body: guideText },
  "seqbaby://engines": { name: "engine catalog", description: "Every engine: key, label, group, what its four sliders do, its panel controls with ranges, its presets, and which LFO and automation targets it takes.", mime: "application/json", body: () => JSON.stringify(sb.describeEngines(), null, 1) },
  "seqbaby://targets": { name: "modulation targets", description: "The LFO target keys and the automation lane keys, with labels. Per-engine availability is in seqbaby://engines.", mime: "application/json",
    body: () => JSON.stringify({ lfo: sb.LFO_KEYS.map(k => ({ key: k, label: sb.LFO_LABELS[k] || k })), automation: Object.entries(sb.AUTOMATION_TARGETS).map(([k, v]) => ({ key: k, label: v.label })) }, null, 1) },
  "seqbaby://samples": { name: "bundled samples and textures", description: "The bundled drum samples a sampler track can load, and the textures a granular track can stream.", mime: "application/json",
    body: () => JSON.stringify({ samples: sb.BUNDLED_SAMPLE_LIST, textures: sb.TEXTURE_LIST }, null, 1) },
  "seqbaby://format": { name: "session format notes", description: "What the exported JSON is, how the studio loads it, and the conventions the tools use (indices, step strings, units).", mime: "text/markdown", body: () => FORMAT_NOTES },
  "seqbaby://song": { name: "the current song", description: "The song being written, summarised: tempo, scale, every track's engine, patterns as step strings, sound, modulation.", mime: "application/json", body: () => JSON.stringify({ name: ctx.songName, ...sb.summarize(ctx.song) }, null, 1) },
};
for (const [uri, r] of Object.entries(resources)) {
  server.registerResource(r.name, uri, { title: r.name, description: r.description, mimeType: r.mime },
    async (u) => ({ contents: [{ uri: u.href, mimeType: r.mime, text: r.body() }] }));
}

// The base conventions plus the three ways THIS studio (SEQBABY_URL) loads a
// song back -- the part that's specific to talking over stdio to whichever
// studio SEQBABY_URL names, so it's added here rather than in tools.mjs's
// shared copy.
const FORMAT_NOTES = `${BASE_FORMAT_NOTES}
\`export_song\` returns the JSON. Any of these load it:

- the studio's session menu, **import** (a .json file)
- \`window.seqbaby.applySet(obj)\` in the studio's console
- \`POST ${SEQBABY_URL}/api/share\` with \`{ "session": obj }\`, which returns
  \`{ "id" }\`; the studio opens it at \`${SEQBABY_URL}/?s=<id>\` (\`share_song\`
  does this)
`;

// ---- tools: the shared table -------------------------------------------------------------
// export_song and load_song get stdio-only `path` handling below, so they're
// wired by hand instead of from the shared table.
const SPECIAL = new Set(["export_song", "load_song"]);
for (const t of TOOLS) {
  if (SPECIAL.has(t.name)) continue;
  server.registerTool(t.name, { title: t.title, description: t.description, inputSchema: t.inputSchema }, run((args, extra) => t.handler(ctx, args, extra)));
}

server.registerTool("export_song", { title: "Export song",
  description: "The song as the JSON the studio loads (import it from the session menu, or applySet it). With `path`, also writes the file.",
  inputSchema: { path: z.string().optional().describe("write the JSON here (absolute, or relative to the working directory)") },
}, run(({ path: p }) => {
  const json = sb.toJSON(ctx.song);
  if (p) { const abs = path.resolve(process.cwd(), p); fs.writeFileSync(abs, json); return `wrote ${abs} (${json.length} bytes)`; }
  return json;
}));

server.registerTool("load_song", { title: "Load song",
  description: "Adopt an existing song for editing: the JSON text, or the path of a .json file exported earlier. Replaces the current song.",
  inputSchema: { json: z.string().optional(), path: z.string().optional(), name: z.string().optional() },
}, run(({ json, path: p, name }) => {
  const raw = json ?? (p ? fs.readFileSync(path.resolve(process.cwd(), p), "utf8") : null);
  if (raw == null) throw new sb.SongError("pass json or path");
  ctx.song = sb.fromBlob(JSON.parse(raw)); ctx.songName = name || ctx.songName;
  return { name: ctx.songName, ...sb.summarize(ctx.song) };
}));

// ---- tools: network (stdio-only) ----------------------------------------------------------
server.registerTool("share_song", { title: "Share song",
  description: `Publish the song as an anonymous share link on ${SEQBABY_URL} (POST /api/share) and return the URL that opens it in the studio. The link is public to anyone who has it.`,
  inputSchema: {},
}, run(async () => {
  const json = sb.toJSON(ctx.song);
  const res = await fetch(`${SEQBABY_URL}/api/share`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ session: JSON.parse(json) }) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.id) throw new sb.SongError(`share failed: ${res.status} ${body.error || ""}`.trim());
  return { url: `${SEQBABY_URL}/?s=${body.id}`, id: body.id };
}));

server.registerTool("audition_song", { title: "Audition song",
  description: `Play the song in a headless browser against the real engine and report each track's level (rms, peak) over a few seconds, plus the master. The one way to check the song makes the sound intended: a silent track, a clipping master, a bus with nothing reaching it. Needs the playwright package and a Chromium (see mcp/README.md); opens ${SEQBABY_URL}.`,
  inputSchema: { seconds: z.number().min(1).max(30).optional().describe("how long to listen (default 4)"), url: z.string().optional().describe("a studio URL other than SEQBABY_URL, e.g. http://localhost:3000") },
}, run(async ({ seconds, url }) => {
  const { auditionSong } = await import("./audition.mjs");
  return auditionSong(JSON.parse(sb.toJSON(ctx.song)), { url: url || SEQBABY_URL, seconds: seconds || 4 });
}));

// ---- a prompt, for clients that offer them ---------------------------------------------
server.registerPrompt("compose", {
  title: "Compose a song",
  description: "Write a song in seqbaby from a brief, with the compose guide in context.",
  argsSchema: { brief: z.string().describe("what the song should be: genre, tempo, mood, length") },
}, ({ brief }) => ({ messages: [{ role: "user", content: { type: "text", text: `${guideText()}\n\n---\n\nUsing the seqbaby tools, write this: ${brief}\n\nWork in the order the guide gives, validate_song when done, then share_song and give me the link.` } }] }));

await server.connect(new StdioServerTransport());
