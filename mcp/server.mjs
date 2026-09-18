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
// public/js/songBuilder.js (pure, tested under node --test), and this file is
// the wiring: zod schemas, error shaping, the share call, the optional
// audition through a headless browser (audition.mjs).
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
import { fileURLToPath } from "node:url";
import * as sb from "../public/js/songBuilder.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SEQBABY_URL = (process.env.SEQBABY_URL || "https://seqbaby.netlify.app").replace(/\/$/, "");

// ---- the one song ------------------------------------------------------------
let song = sb.newSong();
let songName = "untitled";

const text = (v) => ({ content: [{ type: "text", text: typeof v === "string" ? v : JSON.stringify(v, null, 1) }] });
const oops = (e) => ({ isError: true, content: [{ type: "text", text: e instanceof sb.SongError ? e.message : `error: ${e?.message || e}` }] });
/** Wrap a builder call: its return value as text, a SongError as a tool error. */
const run = (fn) => async (args, extra) => { try { return text(await fn(args, extra)); } catch (e) { return oops(e); } };

const server = new McpServer({ name: "seqbaby", version: "1.0.0" }, {
  instructions: `Write songs for seqbaby, a browser step sequencer. Read the resource seqbaby://guide before composing: it says which engine to reach for, how the step strings are spelled, and the order of work. Tracks are addressed by index, patterns by 0..31. Finish with validate_song, then export_song or share_song.`,
});

// ---- resources -------------------------------------------------------------------
function guideText() {
  const p = path.join(ROOT, ".claude", "skills", "compose", "SKILL.md");
  const raw = fs.readFileSync(p, "utf8");
  return raw.replace(/^---[\s\S]*?---\s*/, "");      // drop the skill front matter
}
const resources = {
  "seqbaby://guide": { name: "compose guide", description: "How to write music for seqbaby: which engine for which role, the step-string grammar, the idioms each engine rewards, and the order of work. Read this first.", mime: "text/markdown", body: guideText },
  "seqbaby://engines": { name: "engine catalog", description: "Every engine: key, label, group, what its four sliders do, its panel controls with ranges, its presets, and which LFO and automation targets it takes.", mime: "application/json", body: () => JSON.stringify(sb.describeEngines(), null, 1) },
  "seqbaby://targets": { name: "modulation targets", description: "The LFO target keys and the automation lane keys, with labels. Per-engine availability is in seqbaby://engines.", mime: "application/json",
    body: () => JSON.stringify({ lfo: sb.LFO_KEYS.map(k => ({ key: k, label: sb.LFO_LABELS[k] || k })), automation: Object.entries(sb.AUTOMATION_TARGETS).map(([k, v]) => ({ key: k, label: v.label })) }, null, 1) },
  "seqbaby://samples": { name: "bundled samples and textures", description: "The bundled drum samples a sampler track can load, and the textures a granular track can stream.", mime: "application/json",
    body: () => JSON.stringify({ samples: sb.BUNDLED_SAMPLE_LIST, textures: sb.TEXTURE_LIST }, null, 1) },
  "seqbaby://format": { name: "session format notes", description: "What the exported JSON is, how the studio loads it, and the conventions the tools use (indices, step strings, units).", mime: "text/markdown", body: () => FORMAT_NOTES },
  "seqbaby://song": { name: "the current song", description: "The song being written, summarised: tempo, scale, every track's engine, patterns as step strings, sound, modulation.", mime: "application/json", body: () => JSON.stringify({ name: songName, ...sb.summarize(song) }, null, 1) },
};
for (const [uri, r] of Object.entries(resources)) {
  server.registerResource(r.name, uri, { title: r.name, description: r.description, mimeType: r.mime },
    async (u) => ({ contents: [{ uri: u.href, mimeType: r.mime, text: r.body() }] }));
}

const FORMAT_NOTES = `# The session format

A seqbaby song is one JSON object: the serialized session that \`serializeSet\`
writes and \`applySet\` reads (public/js/session.js). \`export_song\` returns it,
and any of these load it:

- the studio's session menu, **import** (a .json file)
- \`window.seqbaby.applySet(obj)\` in the studio's console
- \`POST ${SEQBABY_URL}/api/share\` with \`{ "session": obj }\`, which returns
  \`{ "id" }\`; the studio opens it at \`${SEQBABY_URL}/?s=<id>\` (\`share_song\`
  does this)

The tools write a SPARSE song: only what was set. The studio fills every
absent field with the same default the panels start from, so a track with
only an engine and a step string is a complete track.

## Conventions

- **Tracks** are addressed by index into the track list, in the order added.
  **Patterns** are 0..31 per track; a track plays pattern 0 unless the
  arrangement says otherwise. All tracks share the pattern number: pattern 3
  is pattern 3 on every track.
- **Step strings**: \`x\` hit, \`X\` accent (velocity 1), \`o\` soft (0.5), a digit
  1..9 a hit at that velocity in tenths, \`.\` or \`-\` rest, \`_\` extends the hit
  before it by one step. Spaces and \`|\` are ignored, so \`x... x... | x... x...\`
  is fine. A string shorter than the pattern tiles when it divides it: \`x...\`
  over 16 steps is four on the floor.
- **Notes**: MIDI numbers or names (\`C2\`, \`F#3\`, \`Bb1\`). C4 is 60, C2 is 36.
  Given fewer notes than hits they cycle over the hits in order. A step with no
  note plays the engine's default (C2 on a drum kit, the engine's own note
  otherwise).
- **Units** are the slider's own: 0..1 for the four sliders, the filter, every
  fx control unless noted; the eq in dB (-18..18); the compressor in dB /
  ratio / seconds; engine panel controls in the range \`describe_engine\` prints.
- **Steps are sixteenths.** A 16-step pattern is one bar of 4/4; \`set_meter\`
  changes what a bar is (7/8 is 14 steps).
- **One owner per parameter**: a control takes an LFO OR an automation lane,
  not both. They write the same value from different schedules.
- **A track has one rhythm source**: the written steps, the euclid ring, or
  the chance generator. Switching one generator on switches the other off.
- **Cross-track references** (\`out\`, \`comp.source\`) are track indices.
`;

// ---- tools: the song -------------------------------------------------------------------
const trackArg = z.number().int().min(0).describe("track index (0-based, in the order tracks were added)");
const patternArg = z.number().int().min(0).max(31).optional().describe("pattern 0..31 (default 0)");

server.registerTool("new_song", {
  title: "New song",
  description: "Start a new, empty song. Replaces the current one. Scale is optional: { root: \"C\", mode: \"minor\" }.",
  inputSchema: { name: z.string().optional(), bpm: z.number().min(20).max(300).optional(), swing: z.number().min(0).max(1).optional(),
    scale: z.object({ root: z.union([z.string(), z.number()]), mode: z.string() }).nullable().optional() },
}, run(({ name, bpm, swing, scale }) => { song = sb.newSong({ bpm, swing, scale: scale || null }); songName = name || "untitled"; return { name: songName, ...sb.summarize(song) }; }));

server.registerTool("get_song", {
  title: "Get song", description: "The current song, summarised: tempo, scale, every track with its patterns as step strings, its sound and its modulation. Pass a track index for one track in more detail.",
  inputSchema: { track: z.number().int().min(0).optional() },
}, run(({ track }) => track == null ? { name: songName, ...sb.summarize(song) } : sb.summarizeTrack(song, track)));

server.registerTool("set_tempo", { title: "Set tempo", description: "Tempo in bpm (20..300) and swing (0..1).",
  inputSchema: { bpm: z.number().optional(), swing: z.number().optional() } }, run((a) => sb.setTempo(song, a)));

server.registerTool("set_scale", { title: "Set scale",
  description: "The session scale: notes on every track snap to it (the chance generator excepted). Pass null to switch it off. Modes: " + sb.SCALE_NAMES.join(", "),
  inputSchema: { scale: z.object({ root: z.union([z.string(), z.number()]).describe("C, Eb, F# or 0..11"), mode: z.string() }).nullable() },
}, run(({ scale }) => sb.setScale(song, scale)));

server.registerTool("set_arrangement", { title: "Set arrangement",
  description: "How the patterns play: mode \"repeat\" loops one pattern, \"chain\" plays them in order with `repeats` bars each (array from pattern 0). `active` is the pattern the studio opens on.",
  inputSchema: { mode: z.enum(["repeat", "chain"]).optional(), repeats: z.array(z.number().int().min(1).max(16)).optional(), switchMode: z.enum(["immediate", "finish"]).optional(), active: z.number().int().min(0).max(31).optional() },
}, run((a) => sb.setArrangement(song, a)));

server.registerTool("set_meter", { title: "Set meter", description: "A pattern's time signature, e.g. \"7/8\". Steps are sixteenths, so 7/8 is a 14-step bar.",
  inputSchema: { pattern: z.number().int().min(0).max(31), meter: z.string() } }, run(({ pattern, meter }) => sb.setMeter(song, pattern, meter)));

// ---- tools: engines --------------------------------------------------------------------
server.registerTool("list_engines", { title: "List engines",
  description: "Every sound engine: key, label, group. Use describe_engine for what a given one's sliders and panel do. The compose guide (resource seqbaby://guide) says which to reach for.",
  inputSchema: { group: z.string().optional().describe("filter by group: plaits, drum / synth, Emulators, texture, wavetable, sampler, midi, bus") },
}, run(({ group }) => sb.describeEngines().filter(e => !group || e.group.toLowerCase() === group.toLowerCase()).map(e => ({ key: e.key, label: e.label, group: e.group, sliders: Object.fromEntries(Object.entries(e.sliders).map(([k, v]) => [k, v.label])), presets: e.presets.map(p => p.name) }))));

server.registerTool("describe_engine", { title: "Describe engine",
  description: "One engine in full: what each of its four sliders does, its panel controls with ranges and defaults, its presets, and which LFO / automation targets it takes.",
  inputSchema: { engine: z.string().describe("engine key or name, e.g. dm:silverbox, silverbox, plaits:fm") },
}, run(({ engine }) => sb.describeEngine(sb.resolveEngine(engine).key)));

// ---- tools: tracks ---------------------------------------------------------------------
server.registerTool("add_track", { title: "Add track",
  description: "Add a track. `engine` is a key or a name (808 kick, silverbox, subby, plaits:fm, fx bus ...). A sampler needs `sample` (a bundled sample id or label); a granular track needs `texture`. Returns the new track's index.",
  inputSchema: { engine: z.string(), name: z.string().optional(), length: z.number().int().min(1).max(64).optional().describe("steps per pattern (default 16)"),
    sample: z.string().optional(), texture: z.string().optional(), drumKit: z.boolean().optional().describe("blank steps play C2 and the sampler pitches from C2; guessed from the engine and name when omitted") },
}, run((a) => sb.addTrack(song, a)));

server.registerTool("remove_track", { title: "Remove track", description: "Remove a track; later indices move down, sends to it go back to master.",
  inputSchema: { track: trackArg } }, run(({ track }) => { sb.removeTrack(song, track); return sb.summarize(song); }));

server.registerTool("set_track", { title: "Set track",
  description: "Track settings: name, length (resizes every pattern), mute, solo, glide (0..0.5 s), speed (tempo multiple: 0.5 half time, 2 double), density, drumKit, out (\"master\" or the index of an fx bus track).",
  inputSchema: { track: trackArg, name: z.string().optional(), length: z.number().int().optional(), mute: z.boolean().optional(), solo: z.boolean().optional(),
    glide: z.number().optional(), speed: z.number().optional(), density: z.number().optional(), drumKit: z.boolean().optional(),
    out: z.union([z.literal("master"), z.number().int()]).optional() },
}, run(({ track, ...opts }) => sb.setTrack(song, track, opts)));

// ---- tools: steps ------------------------------------------------------------------------
server.registerTool("set_steps", { title: "Set steps",
  description: "Write a pattern's rhythm from a step string: x hit, X accent, o soft, 1-9 velocity, . rest, _ tie; spaces and | ignored; a shorter string tiles. Optional `notes` go to the hits in order (cycling), `velocity` scales every hit. Replaces the pattern's steps.",
  inputSchema: { track: trackArg, pattern: patternArg, steps: z.string(), notes: z.array(z.union([z.string(), z.number(), z.null()])).optional(), velocity: z.number().min(0).max(1).optional() },
}, run(({ track, ...a }) => sb.setSteps(song, track, a)));

server.registerTool("set_notes", { title: "Set notes",
  description: "Pitches for a pattern: MIDI numbers or names (C2, F#3). One per step writes per step; fewer cycle over the hits in order; a single value goes to every hit. null keeps the engine's default note.",
  inputSchema: { track: trackArg, pattern: patternArg, notes: z.union([z.array(z.union([z.string(), z.number(), z.null()])), z.string(), z.number()]) },
}, run(({ track, ...a }) => sb.setNotes(song, track, a)));

server.registerTool("set_step", { title: "Set step",
  description: "One step in detail: on, note, velocity 0..1, length in steps, chord (" + sb.CHORD_NAMES.join(" ") + "), complexity (inversion 0..4), ratchet (1..8 retriggers), offset (-0.5..0.5 of a step), arp + arpRate (beats per note) + arpRange (octaves) + arpDir, extraNotes (more pitches stacked on the step).",
  inputSchema: { track: trackArg, pattern: patternArg, step: z.number().int().min(0), on: z.boolean().optional(), note: z.union([z.string(), z.number(), z.null()]).optional(),
    velocity: z.number().optional(), length: z.number().int().optional(), chord: z.string().optional(), complexity: z.number().int().optional(), ratchet: z.number().int().optional(),
    offset: z.number().optional(), arp: z.boolean().optional(), arpRate: z.number().optional(), arpRange: z.number().int().optional(), arpDir: z.enum(["up", "down", "updown", "random"]).optional(),
    extraNotes: z.array(z.union([z.string(), z.number()])).nullable().optional() },
}, run(({ track, ...a }) => sb.setStep(song, track, a)));

server.registerTool("clear_pattern", { title: "Clear pattern", description: "Empty a pattern on a track.",
  inputSchema: { track: trackArg, pattern: patternArg } }, run(({ track, pattern }) => { sb.clearPattern(song, track, pattern ?? 0); return "cleared"; }));
server.registerTool("copy_pattern", { title: "Copy pattern", description: "Copy one of a track's patterns onto another (steps, notes, lanes, everything), to vary from.",
  inputSchema: { track: trackArg, from: z.number().int().min(0).max(31), to: z.number().int().min(0).max(31) } }, run(({ track, from, to }) => { sb.copyPattern(song, track, { from, to }); return sb.describePattern(song.tracks[track], to); }));

// ---- tools: sound ----------------------------------------------------------------------
server.registerTool("set_params", { title: "Set params",
  description: "Sound parameters: vol, the four sliders harm / timb / morph / decay (what they do depends on the engine: describe_engine says), the osc mix osc1..osc4, the mod row ultra / fm / metal / noise, and any engine panel control by its key (gtpick, bsgrind, subdrop, d3lvl, vcut2, gspeed, sbaccent ...). Each is checked against its own range.",
  inputSchema: { track: trackArg, params: z.record(z.string(), z.union([z.number(), z.string()])) },
}, run(({ track, params }) => sb.setParams(song, track, params)));

server.registerTool("apply_preset", { title: "Apply preset",
  description: "Load a preset onto a track: a hexop voice (e.piano, bass, bell, brass, marimba, organ, pad), a guitar tone (surf twang, brit stack, fuzz lead ...), a bass tone (motown, dub, slap funk ...) or a subby patch (808, reese, acid, drill slide ...). Complete: every panel control plus the four sliders. describe_engine lists them.",
  inputSchema: { track: trackArg, preset: z.string() },
}, run(({ track, preset }) => sb.applyPreset(song, track, preset)));

server.registerTool("set_filter", { title: "Set filter",
  description: "The track's lowpass and its envelope, all 0..1: cutoff, reson, env (how far the envelope opens the filter per note), attack, decay, sustain, release.",
  inputSchema: { track: trackArg, cutoff: z.number().optional(), reson: z.number().optional(), env: z.number().optional(), attack: z.number().optional(), decay: z.number().optional(), sustain: z.number().optional(), release: z.number().optional() },
}, run(({ track, ...f }) => sb.setFilter(song, track, f)));

server.registerTool("set_eq", { title: "Set eq", description: "Three bands in dB, -18..18: low (shelf 250 Hz), mid (peak 1.2 kHz), high (shelf 5 kHz).",
  inputSchema: { track: trackArg, low: z.number().optional(), mid: z.number().optional(), high: z.number().optional() } }, run(({ track, ...e }) => sb.setEq(song, track, e)));

server.registerTool("set_comp", { title: "Set compressor",
  description: "The track compressor: threshold dB (-60..0), ratio (1..20), attack s (0..1), release s (0.02..2), knee dB (0..30), enabled, and source: \"self\" or the index of a track to sidechain from (the classic: bass ducked by the kick).",
  inputSchema: { track: trackArg, enabled: z.boolean().optional(), source: z.union([z.literal("self"), z.number().int()]).optional(), threshold: z.number().optional(), ratio: z.number().optional(), attack: z.number().optional(), release: z.number().optional(), knee: z.number().optional() },
}, run(({ track, ...c }) => sb.setComp(song, track, c)));

server.registerTool("set_fx", { title: "Set fx",
  description: "One stage of the track's fx rack. Stages, in chain order: vinyl, cassette, fuzz, ringmod, shaper, crush, autowah, chorus, phaser, flanger, pitchshift, delay, reverb (plus amp: preamp / level). A stage is on when its wet (or amount) is above 0. Controls are 0..1 except crush.bits 1..16, pitchshift.semitones -12..12, delay.time 0.05..1 s (or sync + div), reverb.decay 0.2..8 s, shaper.mode (saturate softclip clip serge fold wrap).",
  inputSchema: { track: trackArg, stage: z.enum(sb.FX_STAGES), settings: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])) },
}, run(({ track, stage, settings }) => sb.setFx(song, track, stage, settings)));

// ---- tools: modulation --------------------------------------------------------------------
server.registerTool("add_lfo", { title: "Add LFO",
  description: "Modulate a parameter. target: an LFO key (cutoff, reson, vol, harm, delay, verb, fuzz_drive, gtr_pick, hexop_3lvl, sub_drop, euclid_rotate ...; describe_engine lists the engine's). shape: sine triangle sawtooth square randsq (sample-and-hold) euclid (a rhythm of taps). amount: peak-to-peak depth 0..1. length: the synced cycle (\"4 steps\", \"1 bar\", \"2 beats\"), or rate in Hz with sync false. bipolar: swing either side of the slider (waveform default) or lift from it (euclid default). For shape euclid, euclid: { pulses, steps, rotate, decay }.",
  inputSchema: { track: trackArg, target: z.string(), shape: z.enum(sb.LFO_SHAPES).optional(), amount: z.number().min(0).max(1).optional(), length: z.union([z.string(), z.number()]).optional(),
    rate: z.number().optional(), sync: z.boolean().optional(), bipolar: z.boolean().optional(), phase: z.number().min(0).max(1).optional(),
    euclid: z.object({ pulses: z.number().int().optional(), steps: z.number().int().optional(), rotate: z.number().int().optional(), decay: z.number().optional() }).optional() },
}, run(({ track, ...a }) => sb.addLfo(song, track, a)));
server.registerTool("remove_lfo", { title: "Remove LFO", description: "Take the LFO off a target.", inputSchema: { track: trackArg, target: z.string() } },
  run(({ track, target }) => { sb.removeLfo(song, track, target); return "removed"; }));

server.registerTool("set_automation", { title: "Set automation",
  description: "A per-step lane on a pattern: target (cutoff, reson, vol, fx.delay, fx.reverb.decay, gtr.pick, hexop.3lvl ...) and one value 0..1 per step (fewer values tile). A control with an LFO should not also get a lane.",
  inputSchema: { track: trackArg, pattern: patternArg, target: z.string(), values: z.array(z.number().min(0).max(1)) },
}, run(({ track, ...a }) => sb.setAutomation(song, track, a)));
server.registerTool("remove_automation", { title: "Remove automation", description: "Take a lane off a pattern.", inputSchema: { track: trackArg, pattern: patternArg, target: z.string() } },
  run(({ track, ...a }) => { sb.removeAutomation(song, track, a); return "removed"; }));

// ---- tools: generators ------------------------------------------------------------------
server.registerTool("set_euclid", { title: "Set euclid",
  description: "The euclidean generator: `pulses` hits spread evenly over `steps`, rotated by `rotate`. Live (on, the default) it replaces the track's written rhythm and pulses / steps / rotate become LFO and automation targets. gate: short (one-step hits) or legato. Turning it on turns the chance generator off.",
  inputSchema: { track: trackArg, on: z.boolean().optional(), pulses: z.number().int().optional(), steps: z.number().int().optional(), rotate: z.number().int().optional(), gate: z.enum(["short", "legato"]).optional(), accent: z.boolean().optional() },
}, run(({ track, ...e }) => sb.setEuclid(song, track, e)));

server.registerTool("set_chance", { title: "Set chance",
  description: "The chance generator: a whole part, rhythm and pitch, from probabilities (a meloDICER). note: base note value (" + sb.CHANCE_NOTE_LABELS.join(" ") + "); variation -1..1 reaches shorter / longer values; legato and rest 0..1; scale: pitch names to allow ([\"C\",\"Eb\",\"G\"]) or pitches: twelve weights C..B; lo / hi: the pitch range; first / last: the window in steps; rhythmSeed / melodySeed: the two dice (change one to re-throw). Same seeds replay the same part. Turning it on turns euclid off.",
  inputSchema: { track: trackArg, on: z.boolean().optional(), note: z.union([z.string(), z.number()]).optional(), variation: z.number().optional(), legato: z.number().optional(), rest: z.number().optional(),
    scale: z.array(z.string()).optional(), pitches: z.array(z.number()).optional(), lo: z.union([z.string(), z.number()]).optional(), hi: z.union([z.string(), z.number()]).optional(),
    first: z.number().int().optional(), last: z.number().int().optional(), triplets: z.boolean().optional(), thirtySeconds: z.boolean().optional(),
    rhythmSeed: z.number().int().optional(), melodySeed: z.number().int().optional() },
}, run(({ track, ...c }) => sb.setChance(song, track, c)));

// ---- tools: out ---------------------------------------------------------------------------
server.registerTool("validate_song", { title: "Validate song", description: "Check the song will load, and name silent tracks and unused buses. Run before exporting.",
  inputSchema: {} }, run(() => sb.validate(song)));

server.registerTool("export_song", { title: "Export song",
  description: "The song as the JSON the studio loads (import it from the session menu, or applySet it). With `path`, also writes the file.",
  inputSchema: { path: z.string().optional().describe("write the JSON here (absolute, or relative to the working directory)") },
}, run(({ path: p }) => {
  const json = sb.toJSON(song);
  if (p) { const abs = path.resolve(process.cwd(), p); fs.writeFileSync(abs, json); return `wrote ${abs} (${json.length} bytes)`; }
  return json;
}));

server.registerTool("load_song", { title: "Load song",
  description: "Adopt an existing song for editing: the JSON text, or the path of a .json file exported earlier. Replaces the current song.",
  inputSchema: { json: z.string().optional(), path: z.string().optional(), name: z.string().optional() },
}, run(({ json, path: p, name }) => {
  const raw = json ?? (p ? fs.readFileSync(path.resolve(process.cwd(), p), "utf8") : null);
  if (raw == null) throw new sb.SongError("pass json or path");
  song = sb.fromBlob(JSON.parse(raw)); songName = name || songName;
  return { name: songName, ...sb.summarize(song) };
}));

server.registerTool("share_song", { title: "Share song",
  description: `Publish the song as an anonymous share link on ${SEQBABY_URL} (POST /api/share) and return the URL that opens it in the studio. The link is public to anyone who has it.`,
  inputSchema: {},
}, run(async () => {
  const json = sb.toJSON(song);
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
  return auditionSong(JSON.parse(sb.toJSON(song)), { url: url || SEQBABY_URL, seconds: seconds || 4 });
}));

// ---- a prompt, for clients that offer them ---------------------------------------------
server.registerPrompt("compose", {
  title: "Compose a song",
  description: "Write a song in seqbaby from a brief, with the compose guide in context.",
  argsSchema: { brief: z.string().describe("what the song should be: genre, tempo, mood, length") },
}, ({ brief }) => ({ messages: [{ role: "user", content: { type: "text", text: `${guideText()}\n\n---\n\nUsing the seqbaby tools, write this: ${brief}\n\nWork in the order the guide gives, validate_song when done, then share_song and give me the link.` } }] }));

await server.connect(new StdioServerTransport());
