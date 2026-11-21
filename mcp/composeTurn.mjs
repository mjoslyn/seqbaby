// One compose turn: the agent loop that turns "make me a techno beat" into
// calls against the song-editing tools, and the song that comes out.
//
// Plain JS on purpose, like tools.mjs beside it, because it has callers that
// cannot share a build: the compose job's Durable Object (workers/composeJob.ts,
// bundled by wrangler into the Worker, outside Next entirely) and the MCP
// server under plain Node. A whole song takes minutes, which is far longer
// than a request is allowed to run, so the Durable Object runs it in an alarm
// and the route only starts it. Same loop either way; only who calls it
// differs.

import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import * as sb from "../public/js/songBuilder.js";
import { TOOLS, FORMAT_NOTES, GUIDE_RELATIVE, guideText } from "./tools.mjs";
import { DEFAULT_COMPOSE_MODEL } from "../lib/composeModels.js";
import { polishSong, wantsMechanical } from "./polish.mjs";
import { hearingNudge, sanitizeReport } from "./hearing.mjs";

// What a turn runs on when its caller doesn't say, which is every compose
// chat turn: the deploy's ANTHROPIC_MODEL, else the shared default.
export const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || DEFAULT_COMPOSE_MODEL;
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
// How many times a turn that stopped short is sent back to finish.
const MAX_NUDGES = 3;

// A request that asks for music to be made or changed, as opposed to a
// question about the song. Only these are sent back for changing nothing.
const MAKE_RE = /\b(build|make|write|create|compose|add|give|put|turn|change|replace|remix|generate|start|song|beat|track|groove|loop|bassline|melody|chords?)\b/i;

/**
 * Why a turn that has stopped calling tools is not finished, as a message to
 * send it back with, or null when it may stop. Two cases: asked to make
 * something, it changed nothing; or tracks it was building will be silent.
 * And once, after it changed the song, the production check (productionNotes).
 */
export function unfinished(ctx, before, toolCalls, message) {
  const after = JSON.stringify(ctx.song);
  if (after === before && MAKE_RE.test(String(message || ""))) {
    return "You haven't changed the song yet. Make what was asked for with the tools now, then reply.";
  }
  if (toolCalls === 0) return null;
  const silent = (sb.validate(ctx.song).warnings || []).filter((w) => /silent/.test(w));
  if (silent.length) return `Not finished: validate_song says ${silent.join("; ")}. Give those tracks parts (or remove the ones the song doesn't need), then reply.`;
  // Once a turn, and only when it changed the song: the production check,
  // the habits that make a sequenced song sound like a video game. The model
  // cannot hear, so this is the closest it gets to listening back.
  if (after !== before && !ctx.productionChecked) {
    ctx.productionChecked = true;
    const notes = sb.productionNotes(ctx.song);
    if (notes.length) return `Before you reply, a production check on the song as it stands (it should sound like a produced record, not video game music, unless the request is chiptune or something deliberately mechanical):\n- ${notes.join("\n- ")}\nFix the ones that apply to what was asked, leave the rest, then reply.`;
  }
  return null;
}

// Enough to work with if the guide file can't be found. Deliberately NOT a
// second copy of it -- a degraded mode that points at the tools that describe
// themselves, so a missing file costs taste, not the feature.
const GUIDE_FALLBACK = `The compose guide isn't available in this environment. Work from the tools themselves: list_engines and describe_engine say what every engine and its controls do, and each tool's refusal names the valid choices. Prefer a small number of tracks that play well together over a crowded arrangement.`;

let cachedGuide = null;

/** Hand the guide in from a caller that has it as text. The Worker imports
 *  the skill file as a string at build time (wrangler's Text rule), since a
 *  Worker has no files to read at runtime. */
export function setComposeGuide(text) {
  if (typeof text === "string" && text) cachedGuide = text.replace(/^---[\s\S]*?---\s*/, "");
}

/**
 * The compose guide, resolved the way a BUNDLED function has to resolve it.
 *
 * The Worker hands it in as text (setComposeGuide, above). Otherwise:
 * tools.mjs's guideText() derives its path from import.meta.url, which is
 * right for `node mcp/server.mjs` and useless in a bundle, so the file is
 * looked for from process.cwd() and up, then from the module's own path.
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

The tools operate on the song currently open in the studio (already loaded for you -- call get_song if you need to see it before editing).

Call many tools in ONE reply, not one at a time: they run in the order you write them, and every reply re-reads this whole conversation, so a reply per call is the slow and costly way to work. A whole track is one reply (add_track, apply_preset, set_steps, set_params, set_fx: a new track's index is the number of tracks before it, so you can address it in the same reply), and so is a whole section, or every lookup you need (several describe_engine calls together). Look an engine up only when you need a control the guide does not already name. Asked for a whole song, work in the order the guide gives: plan its sections first (the guide's Song structure), write the fullest section track by track, then copy_section it into the other slots and carve each one, and chain them. Asked for a beat or a loop, one pattern is the answer.

Two things happen after you stop, so you need not do them by hand. A polish pass in code fills in what you left unset on what you wrote this turn: a level by role on a track you added and never set vol on, dynamics on a part you wrote at a single velocity, and offbeat hats a touch late. Set those yourself wherever you want something specific and it leaves them alone. And where the studio can, it plays the song back and reads the meters; if a part is silent or far out of balance you are told once, with the readings, and asked to fix it.

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
    songName: null,
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

// ---- what a tool result costs ---------------------------------------------
// A result stays in the conversation for the rest of the turn and is read
// again on every round after it, so the big lookups are sent in a tighter
// form than the MCP server's (an outside agent reads them once; this loop
// reads them thirty times). Nothing the model acts on is dropped: the target
// lists are the ones every engine shares, said once in a sentence, plus this
// engine's own.
let commonLfo = null, commonAuto = null;
function commonTargets() {
  if (!commonLfo) {
    const bus = sb.describeEngine("bus");
    commonLfo = new Set(bus.lfoTargets); commonAuto = new Set(bus.automationTargets);
  }
  return { commonLfo, commonAuto };
}
const ctl = (c) => `${c.key} (${c.label}) ${c.min}..${c.max}, default ${c.default}`;

/** A tool's result as the text the model is sent. */
export function resultText(name, result) {
  if (typeof result === "string") return result;
  if (!result || typeof result !== "object") return JSON.stringify(result);
  if (name === "describe_engine" && result.key) {
    const { commonLfo, commonAuto } = commonTargets();
    const out = { key: result.key, label: result.label, poly: result.poly, melodic: result.melodic, defaultNote: result.defaultNote };
    for (const k of ["character", "sliders", "oscMix", "oscMod", "presets", "samples", "textures"]) if (result[k] != null) out[k] = result[k];
    if (result.panel) {
      out.panel = {};
      if (result.panel.numeric?.length) out.panel.numeric = result.panel.numeric.map(c => c.values ? { ...c } : ctl(c));
      if (result.panel.select?.length) out.panel.select = result.panel.select.map(c => `${c.key}: ${c.values.join(" | ")} (default ${c.default})`);
      if (result.panel.text?.length) out.panel.text = result.panel.text;
    }
    out.lfoTargets = (result.lfoTargets || []).filter(k => !commonLfo.has(k)).join(" ");
    out.automationTargets = (result.automationTargets || []).filter(k => !commonAuto.has(k)).join(" ");
    out.targetsNote = "plus the targets every track has: vol, cutoff, reson, the eq keys and every fx key (LFO keys use _, lanes use a dot: delay_time / fx.delay.time)";
    return JSON.stringify(out);
  }
  if (name === "list_engines" && Array.isArray(result)) {
    return result.map(e => `${e.key} [${e.kind ?? e.group}] ${e.sound ?? e.label}${e.presets?.length ? ` | presets: ${e.presets.join(", ")}` : ""}`).join("\n");
  }
  if (name === "list_genres" && Array.isArray(result)) {
    return result.map(g => `${g.id} (${g.family}, ${Array.isArray(g.bpm) ? g.bpm.join("-") : g.bpm} bpm)`).join("; ");
  }
  if (name === "set_steps" && result.detail) {
    const { detail, ...rest } = result;
    return JSON.stringify(rest);
  }
  return JSON.stringify(result);
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
  // The song has no name yet (never saved): the turn is asked to give it one,
  // and hands it back as `title`, for the save box to offer.
  unnamed = false,
  // Play the song back and say what was heard: handed the song as it stands,
  // resolves the browser's meter report (mcp/hearing.mjs) or null when nobody
  // could listen. Called at most once a turn. Absent, the turn is not heard.
  listen = /** @type {null | ((session: unknown) => Promise<unknown>)} */ (null),
  onEvent = async (_event) => {},
}) {
  const ctx = newCtx(session);
  const anthropic = new Anthropic({ apiKey });
  const tools = anthropicTools();
  const startedAt = Date.now();
  // What the song looked like before the turn. Loading a song back into the
  // studio is not free -- applySet tears down every track and voice and stops
  // the transport -- so a turn that answered a question, or edited and undid
  // itself, must be able to say it changed nothing.
  const before = JSON.stringify(ctx.song);

  // A conversation must begin with a user turn. The transcript this comes from
  // does not reliably: a failed turn leaves a user message whose reply was an
  // error, the panel drops error turns on the way here, and that orphaned user
  // message shifts the parity -- so a window taken off the end can open on an
  // assistant turn. The API rejects that, and since the error is kept in the
  // song's stored chat, it would have rejected every later turn in that
  // conversation too. (Consecutive same-role turns are fine; the API folds
  // them into one, so only the leading edge needs cutting.)
  const recent = history
    .filter((h) => h && (h.role === "user" || h.role === "assistant") && typeof h.text === "string")
    .slice(-MAX_HISTORY_TURNS);
  while (recent.length && recent[0].role !== "user") recent.shift();

  const messages = [
    ...recent.map((h) => ({ role: h.role, content: h.text })),
    { role: "user", content: unnamed ? `${message}\n\n(This song has no name yet. Once you know what it is, give it one with name_song.)` : message },
  ];

  let reply = "";
  let toolCalls = 0;
  let toolErrors = 0;
  let nudges = 0;
  let rounds = 0;
  // What the production check found the first time the turn stopped, and how
  // the listen went: both are kept with the turn's record (compose_turns).
  let lintFirst = null;
  let heard = null;
  let hearNotes = 0;
  let listened = false;
  // What the turn cost, summed over its rounds.
  const usage = { in: 0, out: 0, cacheRead: 0, cacheWrite: 0 };
  const polished = [];
  const feel = !wantsMechanical(message);
  const polish = async () => {
    const did = polishSong(ctx.song, session, { feel });
    for (const line of did) {
      polished.push(line);
      await onEvent({ type: "tool", name: "polish", ok: true, summary: `polish: ${line}` });
    }
  };
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    // The stable prefix is big -- the compose guide plus the tool schemas --
    // and the prefix renders tools -> system -> messages, so one breakpoint on
    // the system block covers the tools too. Over the dozens of rounds a whole
    // song takes, that is most of what each round would otherwise wait on.
    // The top-level cache_control is the second breakpoint: it lands on the
    // last block of `messages`, which only ever grows by appending within a
    // turn, so each round reads every earlier round's tool calls and results
    // back from the cache and pays full price only for the newest ones.
    const res = await anthropic.messages
      .stream({
        model,
        max_tokens: 8192,
        output_config: { effort },
        cache_control: { type: "ephemeral" },
        system: [{ type: "text", text: systemPrompt(), cache_control: { type: "ephemeral" } }],
        tools,
        messages,
      })
      .finalMessage();

    const u = res.usage;
    usage.in += u.input_tokens || 0; usage.out += u.output_tokens || 0;
    usage.cacheRead += u.cache_read_input_tokens || 0; usage.cacheWrite += u.cache_creation_input_tokens || 0;
    console.log(
      `[compose] round ${round} ${Date.now() - startedAt}ms in=${u.input_tokens} cache_read=${u.cache_read_input_tokens ?? 0} cache_write=${u.cache_creation_input_tokens ?? 0} out=${u.output_tokens}`,
    );

    messages.push({ role: "assistant", content: res.content });
    rounds++;

    const toolUses = res.content.filter((b) => b.type === "tool_use");
    if (toolUses.length === 0) {
      reply = res.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      // Stopping is not the same as finishing. A smaller model handed a long
      // brief (a whole bebop song) can stop after a few calls, or none, with
      // the starter tracks still empty. When it stops with the song unchanged
      // after being asked for one, or with tracks that will be silent, say so
      // and send it back, a bounded number of times.
      const changedNow = JSON.stringify(ctx.song) !== before;
      if (lintFirst == null && changedNow) lintFirst = sb.productionNotes(ctx.song).length;
      const canGoOn = round < MAX_TOOL_ROUNDS - 1;
      const nudge = unfinished(ctx, before, toolCalls, message);
      if (nudge && nudges < MAX_NUDGES && canGoOn) {
        nudges++;
        await onEvent({ type: "tool", name: "check", ok: false, summary: "not finished yet, carrying on" });
        messages.push({ role: "user", content: nudge });
        continue;
      }
      // It says it is done. The polish pass first, so what is heard is what
      // will land; then one listen, and one more go if something is wrong.
      if (changedNow) await polish();
      if (changedNow && listen && !listened && canGoOn) {
        listened = true;
        await onEvent({ type: "tool", name: "listen", ok: true, summary: "listening back" });
        let report = null;
        try {
          report = sanitizeReport(await listen(serializeCtx(ctx)), ctx.song);
        } catch (e) {
          console.error("[compose] listen failed", e);
        }
        heard = !!report;
        const back = report ? hearingNudge(ctx.song, report) : null;
        if (back) {
          hearNotes = back.split("\n- ").length - 1;
          await onEvent({ type: "tool", name: "listen", ok: false, summary: `heard ${hearNotes} thing${hearNotes === 1 ? "" : "s"} to fix` });
          messages.push({ role: "user", content: back });
          continue;
        }
        await onEvent({ type: "tool", name: "listen", ok: true, summary: report ? "heard it: nothing silent, levels in balance" : "couldn't listen this time" });
      }
      break;
    }
    toolCalls += toolUses.length;

    const results = [];
    for (const tu of toolUses) {
      const r = runTool(ctx, tu.name, tu.input);
      if (!r.ok) toolErrors++;
      await onEvent({ type: "tool", name: tu.name, ok: r.ok, summary: r.ok ? summarize(tu.name, r.result) : r.error });
      const text = r.ok ? resultText(tu.name, r.result) : r.error;
      results.push({ type: "tool_result", tool_use_id: tu.id, content: text, is_error: !r.ok });
    }
    messages.push({ role: "user", content: results });
    await onEvent({ type: "round", round, ms: Date.now() - startedAt });

    if (round === MAX_TOOL_ROUNDS - 1) {
      reply = "I got a long way into this but ran out of steps before I could finish and explain it -- have a listen, and tell me what to pick up.";
    }
  }

  // Again at the very end: whatever the turn wrote after its listen gets the
  // same pass, and what was already polished is left as it is.
  if (JSON.stringify(ctx.song) !== before) await polish();
  const after = JSON.stringify(ctx.song);
  console.log(`[compose] turn ${rounds} rounds in=${usage.in} cache_read=${usage.cacheRead} cache_write=${usage.cacheWrite} out=${usage.out}`);
  return {
    reply: reply || "Done.",
    // Which model actually ran it, so the transcript can say so.
    model,
    session: serializeCtx(ctx),
    // Compared rather than inferred from which tools ran: a tool can be called
    // and leave the song exactly as it was, and that is still nothing to
    // reload for.
    changed: after !== before,
    // The name the turn gave the song, if it gave one.
    title: ctx.songName || null,
    warnings: sb.validate(ctx.song).warnings,
    // How the turn went, in numbers: kept with its record so one change to
    // the guide or the model can be told from another.
    stats: {
      rounds, toolCalls, toolErrors, nudges,
      lintFirst, lintLast: after !== before ? sb.productionNotes(ctx.song).length : null,
      heard, hearNotes, polished: polished.length,
      tracks: ctx.song.tracks?.length ?? 0, sections: sb.songSections(ctx.song).length,
    },
    usage,
    ms: Date.now() - startedAt,
  };
}
