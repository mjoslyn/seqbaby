// The seqbaby tool table: name, description, zod input schema and a handler
// per tool, shared by anything that wants an agent to write a song through
// songBuilder.js. mcp/server.mjs wires these onto an McpServer for stdio
// clients; app/compose/tools.ts wires the same table onto the Anthropic
// Messages API for the studio's own chat panel. One table, so a tool's
// description or validation doesn't drift between the two.
//
// A handler takes (ctx, args) where ctx = { song, songName } is a plain
// mutable object the caller owns -- tools that replace the whole song
// (new_song, load_song) reassign ctx.song rather than returning a new one,
// since a return value can't rebind the caller's variable.

import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as sb from "../public/js/songBuilder.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The compose skill, front matter stripped -- what an agent needs to know
 *  before writing a song: which engine for which role, the order of work. */
export function guideText() {
  const raw = fs.readFileSync(path.join(ROOT, ".claude", "skills", "compose", "SKILL.md"), "utf8");
  return raw.replace(/^---[\s\S]*?---\s*/, "");
}

/** What the exported JSON is and the conventions the tools use. No
 *  SEQBABY_URL-specific lines here -- those are added where the caller knows
 *  which studio it's talking to (server.mjs's resource, the compose route's
 *  system prompt). */
export const FORMAT_NOTES = `# The session format

A seqbaby song is one JSON object: the serialized session that \`serializeSet\`
writes and \`applySet\` reads (public/js/session.js). The tools write a SPARSE
song: only what was set. The studio fills every absent field with the same
default the panels start from, so a track with only an engine and a step
string is a complete track.

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

export const trackArg = z.number().int().min(0).describe("track index (0-based, in the order tracks were added)");
export const patternArg = z.number().int().min(0).max(31).optional().describe("pattern 0..31 (default 0)");

export const TOOLS = [
  // ---- the song --------------------------------------------------------------
  {
    name: "new_song", title: "New song",
    description: "Start a new, empty song. Replaces the current one. Scale is optional: { root: \"C\", mode: \"minor\" }.",
    inputSchema: { name: z.string().optional(), bpm: z.number().min(20).max(300).optional(), swing: z.number().min(0).max(1).optional(),
      scale: z.object({ root: z.union([z.string(), z.number()]), mode: z.string() }).nullable().optional() },
    handler: (ctx, { name, bpm, swing, scale }) => { ctx.song = sb.newSong({ bpm, swing, scale: scale || null }); ctx.songName = name || "untitled"; return { name: ctx.songName, ...sb.summarize(ctx.song) }; },
  },
  {
    name: "get_song", title: "Get song",
    description: "The current song, summarised: tempo, scale, every track with its patterns as step strings, its sound and its modulation. Pass a track index for one track in more detail.",
    inputSchema: { track: z.number().int().min(0).optional() },
    handler: (ctx, { track }) => track == null ? { name: ctx.songName, ...sb.summarize(ctx.song) } : sb.summarizeTrack(ctx.song, track),
  },
  {
    name: "set_tempo", title: "Set tempo", description: "Tempo in bpm (20..300) and swing (0..1).",
    inputSchema: { bpm: z.number().optional(), swing: z.number().optional() },
    handler: (ctx, a) => sb.setTempo(ctx.song, a),
  },
  {
    name: "set_scale", title: "Set scale",
    description: "The session scale: notes on every track snap to it (the chance generator excepted). Pass null to switch it off. Modes: " + sb.SCALE_NAMES.join(", "),
    inputSchema: { scale: z.object({ root: z.union([z.string(), z.number()]).describe("C, Eb, F# or 0..11"), mode: z.string() }).nullable() },
    handler: (ctx, { scale }) => sb.setScale(ctx.song, scale),
  },
  {
    name: "set_arrangement", title: "Set arrangement",
    description: "How the patterns play: mode \"repeat\" loops one pattern, \"chain\" plays them in order with `repeats` bars each (array from pattern 0). `active` is the pattern the studio opens on.",
    inputSchema: { mode: z.enum(["repeat", "chain"]).optional(), repeats: z.array(z.number().int().min(1).max(16)).optional(), switchMode: z.enum(["immediate", "finish"]).optional(), active: z.number().int().min(0).max(31).optional() },
    handler: (ctx, a) => sb.setArrangement(ctx.song, a),
  },
  {
    name: "set_meter", title: "Set meter", description: "A pattern's time signature, e.g. \"7/8\". Steps are sixteenths, so 7/8 is a 14-step bar.",
    inputSchema: { pattern: z.number().int().min(0).max(31), meter: z.string() },
    handler: (ctx, { pattern, meter }) => sb.setMeter(ctx.song, pattern, meter),
  },

  // ---- engines -----------------------------------------------------------------
  {
    name: "list_engines", title: "List engines",
    description: "Every sound engine: key, label, group. Use describe_engine for what a given one's sliders and panel do. The compose guide says which to reach for.",
    inputSchema: { group: z.string().optional().describe("filter by group: plaits, drum / synth, Emulators, texture, wavetable, sampler, midi, bus") },
    handler: (ctx, { group }) => sb.describeEngines().filter(e => !group || e.group.toLowerCase() === group.toLowerCase()).map(e => ({ key: e.key, label: e.label, group: e.group, sliders: Object.fromEntries(Object.entries(e.sliders).map(([k, v]) => [k, v.label])), presets: e.presets.map(p => p.name) })),
  },
  {
    name: "describe_engine", title: "Describe engine",
    description: "One engine in full: what each of its four sliders does, its panel controls with ranges and defaults, its presets, and which LFO / automation targets it takes.",
    inputSchema: { engine: z.string().describe("engine key or name, e.g. dm:silverbox, silverbox, plaits:fm") },
    handler: (ctx, { engine }) => sb.describeEngine(sb.resolveEngine(engine).key),
  },

  // ---- tracks --------------------------------------------------------------------
  {
    name: "add_track", title: "Add track",
    description: "Add a track. `engine` is a key or a name (808 kick, silverbox, subby, plaits:fm, fx bus ...). A sampler needs `sample` (a bundled sample id or label); a granular track needs `texture`. Returns the new track's index.",
    inputSchema: { engine: z.string(), name: z.string().optional(), length: z.number().int().min(1).max(64).optional().describe("steps per pattern (default 16)"),
      sample: z.string().optional(), texture: z.string().optional(), drumKit: z.boolean().optional().describe("blank steps play C2 and the sampler pitches from C2; guessed from the engine and name when omitted") },
    handler: (ctx, a) => sb.addTrack(ctx.song, a),
  },
  {
    name: "remove_track", title: "Remove track", description: "Remove a track; later indices move down, sends to it go back to master.",
    inputSchema: { track: trackArg },
    handler: (ctx, { track }) => { sb.removeTrack(ctx.song, track); return sb.summarize(ctx.song); },
  },
  {
    name: "set_track", title: "Set track",
    description: "Track settings: name, length (resizes every pattern), mute, solo, glide (0..0.5 s), speed (tempo multiple: 0.5 half time, 2 double), density, drumKit, out (\"master\" or the index of an fx bus track).",
    inputSchema: { track: trackArg, name: z.string().optional(), length: z.number().int().optional(), mute: z.boolean().optional(), solo: z.boolean().optional(),
      glide: z.number().optional(), speed: z.number().optional(), density: z.number().optional(), drumKit: z.boolean().optional(),
      out: z.union([z.literal("master"), z.number().int()]).optional() },
    handler: (ctx, { track, ...opts }) => sb.setTrack(ctx.song, track, opts),
  },

  // ---- steps ------------------------------------------------------------------------
  {
    name: "set_steps", title: "Set steps",
    description: "Write a pattern's rhythm from a step string: x hit, X accent, o soft, 1-9 velocity, . rest, _ tie; spaces and | ignored; a shorter string tiles. Optional `notes` go to the hits in order (cycling), `velocity` scales every hit. Replaces the pattern's steps.",
    inputSchema: { track: trackArg, pattern: patternArg, steps: z.string(), notes: z.array(z.union([z.string(), z.number(), z.null()])).optional(), velocity: z.number().min(0).max(1).optional() },
    handler: (ctx, { track, ...a }) => sb.setSteps(ctx.song, track, a),
  },
  {
    name: "set_notes", title: "Set notes",
    description: "Pitches for a pattern: MIDI numbers or names (C2, F#3). One per step writes per step; fewer cycle over the hits in order; a single value goes to every hit. null keeps the engine's default note.",
    inputSchema: { track: trackArg, pattern: patternArg, notes: z.union([z.array(z.union([z.string(), z.number(), z.null()])), z.string(), z.number()]) },
    handler: (ctx, { track, ...a }) => sb.setNotes(ctx.song, track, a),
  },
  {
    name: "set_step", title: "Set step",
    description: "One step in detail: on, note, velocity 0..1, length in steps, chord (" + sb.CHORD_NAMES.join(" ") + "), complexity (inversion 0..4), ratchet (1..8 retriggers), offset (-0.5..0.5 of a step), arp + arpRate (beats per note) + arpRange (octaves) + arpDir, extraNotes (more pitches stacked on the step).",
    inputSchema: { track: trackArg, pattern: patternArg, step: z.number().int().min(0), on: z.boolean().optional(), note: z.union([z.string(), z.number(), z.null()]).optional(),
      velocity: z.number().optional(), length: z.number().int().optional(), chord: z.string().optional(), complexity: z.number().int().optional(), ratchet: z.number().int().optional(),
      offset: z.number().optional(), arp: z.boolean().optional(), arpRate: z.number().optional(), arpRange: z.number().int().optional(), arpDir: z.enum(["up", "down", "updown", "random"]).optional(),
      extraNotes: z.array(z.union([z.string(), z.number()])).nullable().optional() },
    handler: (ctx, { track, ...a }) => sb.setStep(ctx.song, track, a),
  },
  {
    name: "clear_pattern", title: "Clear pattern", description: "Empty a pattern on a track.",
    inputSchema: { track: trackArg, pattern: patternArg },
    handler: (ctx, { track, pattern }) => { sb.clearPattern(ctx.song, track, pattern ?? 0); return "cleared"; },
  },
  {
    name: "copy_pattern", title: "Copy pattern", description: "Copy one of a track's patterns onto another (steps, notes, lanes, everything), to vary from.",
    inputSchema: { track: trackArg, from: z.number().int().min(0).max(31), to: z.number().int().min(0).max(31) },
    handler: (ctx, { track, from, to }) => { sb.copyPattern(ctx.song, track, { from, to }); return sb.describePattern(ctx.song.tracks[track], to); },
  },

  // ---- sound ----------------------------------------------------------------------
  {
    name: "set_params", title: "Set params",
    description: "Sound parameters: vol, the four sliders harm / timb / morph / decay (what they do depends on the engine: describe_engine says), the osc mix osc1..osc4, the mod row ultra / fm / metal / noise, and any engine panel control by its key (gtpick, bsgrind, subdrop, d3lvl, vcut2, gspeed, sbaccent ...). Each is checked against its own range.",
    inputSchema: { track: trackArg, params: z.record(z.string(), z.union([z.number(), z.string()])) },
    handler: (ctx, { track, params }) => sb.setParams(ctx.song, track, params),
  },
  {
    name: "apply_preset", title: "Apply preset",
    description: "Load a preset onto a track: a hexop voice (e.piano, bass, bell, brass, marimba, organ, pad), a guitar tone (surf twang, brit stack, fuzz lead ...), a bass tone (motown, dub, slap funk ...) or a subby patch (808, reese, acid, drill slide ...). Complete: every panel control plus the four sliders. describe_engine lists them.",
    inputSchema: { track: trackArg, preset: z.string() },
    handler: (ctx, { track, preset }) => sb.applyPreset(ctx.song, track, preset),
  },
  {
    name: "set_filter", title: "Set filter",
    description: "The track's lowpass and its envelope, all 0..1: cutoff, reson, env (how far the envelope opens the filter per note), attack, decay, sustain, release.",
    inputSchema: { track: trackArg, cutoff: z.number().optional(), reson: z.number().optional(), env: z.number().optional(), attack: z.number().optional(), decay: z.number().optional(), sustain: z.number().optional(), release: z.number().optional() },
    handler: (ctx, { track, ...f }) => sb.setFilter(ctx.song, track, f),
  },
  {
    name: "set_eq", title: "Set eq", description: "Three bands in dB, -18..18: low (shelf 250 Hz), mid (peak 1.2 kHz), high (shelf 5 kHz).",
    inputSchema: { track: trackArg, low: z.number().optional(), mid: z.number().optional(), high: z.number().optional() },
    handler: (ctx, { track, ...e }) => sb.setEq(ctx.song, track, e),
  },
  {
    name: "set_comp", title: "Set compressor",
    description: "The track compressor: threshold dB (-60..0), ratio (1..20), attack s (0..1), release s (0.02..2), knee dB (0..30), enabled, and source: \"self\" or the index of a track to sidechain from (the classic: bass ducked by the kick).",
    inputSchema: { track: trackArg, enabled: z.boolean().optional(), source: z.union([z.literal("self"), z.number().int()]).optional(), threshold: z.number().optional(), ratio: z.number().optional(), attack: z.number().optional(), release: z.number().optional(), knee: z.number().optional() },
    handler: (ctx, { track, ...c }) => sb.setComp(ctx.song, track, c),
  },
  {
    name: "set_fx", title: "Set fx",
    description: "One stage of the track's fx rack. Stages, in chain order: vinyl, cassette, fuzz, ringmod, shaper, crush, autowah, chorus, phaser, flanger, pitchshift, delay, reverb (plus amp: preamp / level). A stage is on when its wet (or amount) is above 0. Controls are 0..1 except crush.bits 1..16, pitchshift.semitones -12..12, delay.time 0.05..1 s (or sync + div), reverb.decay 0.2..8 s, shaper.mode (saturate softclip clip serge fold wrap).",
    inputSchema: { track: trackArg, stage: z.enum(sb.FX_STAGES), settings: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])) },
    handler: (ctx, { track, stage, settings }) => sb.setFx(ctx.song, track, stage, settings),
  },

  // ---- modulation --------------------------------------------------------------------
  {
    name: "add_lfo", title: "Add LFO",
    description: "Modulate a parameter. target: an LFO key (cutoff, reson, vol, harm, delay, verb, fuzz_drive, gtr_pick, hexop_3lvl, sub_drop, euclid_rotate ...; describe_engine lists the engine's). shape: sine triangle sawtooth square randsq (sample-and-hold) euclid (a rhythm of taps). amount: peak-to-peak depth 0..1. length: the synced cycle (\"4 steps\", \"1 bar\", \"2 beats\"), or rate in Hz with sync false. bipolar: swing either side of the slider (waveform default) or lift from it (euclid default). For shape euclid, euclid: { pulses, steps, rotate, decay }.",
    inputSchema: { track: trackArg, target: z.string(), shape: z.enum(sb.LFO_SHAPES).optional(), amount: z.number().min(0).max(1).optional(), length: z.union([z.string(), z.number()]).optional(),
      rate: z.number().optional(), sync: z.boolean().optional(), bipolar: z.boolean().optional(), phase: z.number().min(0).max(1).optional(),
      euclid: z.object({ pulses: z.number().int().optional(), steps: z.number().int().optional(), rotate: z.number().int().optional(), decay: z.number().optional() }).optional() },
    handler: (ctx, { track, ...a }) => sb.addLfo(ctx.song, track, a),
  },
  {
    name: "remove_lfo", title: "Remove LFO", description: "Take the LFO off a target.",
    inputSchema: { track: trackArg, target: z.string() },
    handler: (ctx, { track, target }) => { sb.removeLfo(ctx.song, track, target); return "removed"; },
  },
  {
    name: "set_automation", title: "Set automation",
    description: "A per-step lane on a pattern: target (cutoff, reson, vol, fx.delay, fx.reverb.decay, gtr.pick, hexop.3lvl ...) and one value 0..1 per step (fewer values tile). A control with an LFO should not also get a lane.",
    inputSchema: { track: trackArg, pattern: patternArg, target: z.string(), values: z.array(z.number().min(0).max(1)) },
    handler: (ctx, { track, ...a }) => sb.setAutomation(ctx.song, track, a),
  },
  {
    name: "remove_automation", title: "Remove automation", description: "Take a lane off a pattern.",
    inputSchema: { track: trackArg, pattern: patternArg, target: z.string() },
    handler: (ctx, { track, ...a }) => { sb.removeAutomation(ctx.song, track, a); return "removed"; },
  },

  // ---- generators ------------------------------------------------------------------
  {
    name: "set_euclid", title: "Set euclid",
    description: "The euclidean generator: `pulses` hits spread evenly over `steps`, rotated by `rotate`. Live (on, the default) it replaces the track's written rhythm and pulses / steps / rotate become LFO and automation targets. gate: short (one-step hits) or legato. Turning it on turns the chance generator off.",
    inputSchema: { track: trackArg, on: z.boolean().optional(), pulses: z.number().int().optional(), steps: z.number().int().optional(), rotate: z.number().int().optional(), gate: z.enum(["short", "legato"]).optional(), accent: z.boolean().optional() },
    handler: (ctx, { track, ...e }) => sb.setEuclid(ctx.song, track, e),
  },
  {
    name: "set_chance", title: "Set chance",
    description: "The chance generator: a whole part, rhythm and pitch, from probabilities (a meloDICER). note: base note value (" + sb.CHANCE_NOTE_LABELS.join(" ") + "); variation -1..1 reaches shorter / longer values; legato and rest 0..1; scale: pitch names to allow ([\"C\",\"Eb\",\"G\"]) or pitches: twelve weights C..B; lo / hi: the pitch range; first / last: the window in steps; rhythmSeed / melodySeed: the two dice (change one to re-throw). Same seeds replay the same part. Turning it on turns euclid off.",
    inputSchema: { track: trackArg, on: z.boolean().optional(), note: z.union([z.string(), z.number()]).optional(), variation: z.number().optional(), legato: z.number().optional(), rest: z.number().optional(),
      scale: z.array(z.string()).optional(), pitches: z.array(z.number()).optional(), lo: z.union([z.string(), z.number()]).optional(), hi: z.union([z.string(), z.number()]).optional(),
      first: z.number().int().optional(), last: z.number().int().optional(), triplets: z.boolean().optional(), thirtySeconds: z.boolean().optional(),
      rhythmSeed: z.number().int().optional(), melodySeed: z.number().int().optional() },
    handler: (ctx, { track, ...c }) => sb.setChance(ctx.song, track, c),
  },

  // ---- out ---------------------------------------------------------------------------
  {
    name: "validate_song", title: "Validate song", description: "Check the song will load, and name silent tracks and unused buses. Run before exporting.",
    inputSchema: {},
    handler: (ctx) => sb.validate(ctx.song),
  },
  {
    name: "export_song", title: "Export song",
    description: "The song as the JSON the studio loads.",
    inputSchema: {},
    handler: (ctx) => JSON.parse(sb.toJSON(ctx.song)),
  },
  {
    name: "load_song", title: "Load song",
    description: "Adopt an existing song for editing, from its JSON text. Replaces the current song.",
    inputSchema: { json: z.string(), name: z.string().optional() },
    handler: (ctx, { json, name }) => { ctx.song = sb.fromBlob(JSON.parse(json)); ctx.songName = name || ctx.songName; return { name: ctx.songName, ...sb.summarize(ctx.song) }; },
  },
];

export const TOOLS_BY_NAME = new Map(TOOLS.map(t => [t.name, t]));
