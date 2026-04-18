// Shared prompt/generation logic used by both the local Node server and the Netlify Functions.
import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-haiku-4-5-20251001";

// Build the Anthropic client on-demand so env vars that load AFTER module import
// (e.g. Netlify deploy contexts, --env-file after bundle) still work.
let _client;
function getClient() {
  if (_client) return _client;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new Error("ANTHROPIC_API_KEY is not set on this environment. Set it locally in .env (loaded by `node --env-file=.env`) or in Netlify → Site configuration → Environment variables, then redeploy.");
  }
  _client = new Anthropic({ apiKey: key });
  return _client;
}

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, Number(n))); }

function validateFx(fx) {
  if (!fx || typeof fx !== "object") return undefined;
  const out = {};
  if (fx.fuzz && typeof fx.fuzz === "object") {
    out.fuzz = {};
    for (const k of ["amount","drive","tone","level"]) {
      const v = Number(fx.fuzz[k]);
      if (Number.isFinite(v)) out.fuzz[k] = clamp(v, 0, 1);
    }
  }
  if (fx.delay && typeof fx.delay === "object") {
    out.delay = {};
    if (typeof fx.delay.sync === "boolean") out.delay.sync = fx.delay.sync;
    const div = Number(fx.delay.div);  if (Number.isFinite(div))  out.delay.div  = div;
    const time = Number(fx.delay.time);if (Number.isFinite(time)) out.delay.time = clamp(time, 0.02, 2);
    const fbk = Number(fx.delay.fbk);  if (Number.isFinite(fbk))  out.delay.fbk  = clamp(fbk, 0, 0.95);
    const wet = Number(fx.delay.wet);  if (Number.isFinite(wet))  out.delay.wet  = clamp(wet, 0, 1);
  }
  if (fx.reverb && typeof fx.reverb === "object") {
    out.reverb = {};
    const decay = Number(fx.reverb.decay); if (Number.isFinite(decay)) out.reverb.decay = clamp(decay, 0.2, 10);
    const wet   = Number(fx.reverb.wet);   if (Number.isFinite(wet))   out.reverb.wet   = clamp(wet, 0, 1);
  }
  return Object.keys(out).length ? out : undefined;
}

// ---- generate ---------------------------------------------------------

const GEN_SYSTEM = `You generate step-sequencer patterns for a music sequencer whose tracks can use Mutable Instruments Plaits engines, Roland-style 808/909/303 synth models, sample players, or Web MIDI instruments.

Respond with ONLY a JSON object — no prose, no markdown fences — of the form:

{
  "steps":      [0|1, ...],
  "notes":      [<midi-number>|null, ...],
  "lengths":    [<int>, ...],
  "velocities": [<0..1>, ...],
  "chords":     ["" | "maj"|"min"|"dom7"|"maj7"|"min7"|"dim"|"aug"|"sus2"|"sus4"|"m7b5"|"add9", ...],
  "offsets":    [<-0.5..0.5>, ...],
  "swing":      <0..0.75>,
  "filter":     { "cutoff": 0..1, "reson": 0..1, "env": 0..1, "attack": 0..1, "decay": 0..1, "sustain": 0..1, "release": 0..1 }
}

Rules:
- All arrays have length exactly equal to the requested step count.
- "steps": 1 = trigger, 0 = rest.
- "notes": for melodic engines each triggered step has a MIDI note number (0–127, middle C = 60); rests MUST be null. Percussive engines may use null everywhere or supply a MIDI note to pitch the hit.
- "lengths": duration in 16th-note cells. 1 = staccato, 2+ = sustained / held. Rests use 0 or 1 (ignored when step=0). A held note of length L starting at i occupies cells i..i+L-1; don't place another trigger inside that span.
- "velocities": 0.0–1.0 per step. Use dynamics — ghost notes at 0.3-0.5, accents near 1.0, normal hits around 0.7-0.9.
- "chords": optional per step. Empty string means single note.
- "filter": optional track-level filter + ADSR envelope. All values 0–1.
- "swing" (track-level): 0 = straight, ~0.3 = relaxed groove, ~0.55 = heavy swing.
- "offsets" (per step): push single hits early (negative) or late (positive) by a fraction of a step.
- Stay in-scale unless the prompt overrides. Avoid MIDI notes outside 24–96 unless the prompt demands it.`;

export async function generate({ prompt, role, stepCount, steps, bars, accents, scale, density, seedPattern, variationIndex, variationCount, siblingTracks }) {
  if (!stepCount) stepCount = (steps ?? 16) * (bars ?? 1);
  const accentLine = Array.isArray(accents) && accents.length
    ? `Accented step positions (1-indexed): ${accents.join(", ")}. Favor stronger hits there.`
    : "";
  const scaleLine = scale && scale.mode
    ? `Key/scale: ${scale.rootName || ""} ${scale.mode}. Stay in-scale unless the prompt overrides.`
    : "";
  const densityLine = (typeof density === "number" && Number.isFinite(density))
    ? `Density target: ${density.toFixed(2)} (0 = extremely sparse, 0.5 = balanced, 1 = maximum activity).`
    : "";
  const seedLine = (seedPattern && typeof seedPattern === "object" && Array.isArray(seedPattern.steps))
    ? `Seed pattern to VARY (this is variation ${variationIndex || "?"} of ${variationCount || "?"}): ${JSON.stringify(seedPattern)}
Produce a subtle variation of the seed: same key, same mood, same rough density, but change rhythm/phrasing/note pitches/accents.`
    : "";
  const siblingLine = Array.isArray(siblingTracks) && siblingTracks.length
    ? `Current arrangement — other tracks in this pattern slot. If the prompt refers to any of them by name, use their rhythm/phrasing as musical context.
${siblingTracks.slice(0, 12).map(s => `- "${String(s.name).slice(0, 20)}" (${String(s.engine).slice(0, 40)}, ${s.stepCount} steps): steps=${JSON.stringify(s.steps || []).slice(0, 160)}, notes=${JSON.stringify(s.notes || []).slice(0, 200)}`).join("\n")}`
    : "";

  const msg = await getClient().messages.create({
    model: MODEL,
    max_tokens: 1500,
    system: [{ type: "text", text: GEN_SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{
      role: "user",
      content: `Track role: ${role}
Step count: ${stepCount} (sixteenth-note grid; polymeter lengths are fine).
${scaleLine}
${accentLine}
${densityLine}
${seedLine}
${siblingLine}
Prompt: ${prompt}`,
    }],
  });
  const text = msg.content.map(b => b.type === "text" ? b.text : "").join("");
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("no json in response: " + text.slice(0, 200));
  const parsed = JSON.parse(m[0]);
  if (!Array.isArray(parsed.steps) || parsed.steps.length !== stepCount) {
    throw new Error(`bad steps length: ${parsed.steps?.length} vs ${stepCount}`);
  }
  if (!Array.isArray(parsed.notes)      || parsed.notes.length      !== stepCount) parsed.notes = Array(stepCount).fill(null);
  if (!Array.isArray(parsed.lengths)    || parsed.lengths.length    !== stepCount) parsed.lengths = Array(stepCount).fill(1);
  if (!Array.isArray(parsed.velocities) || parsed.velocities.length !== stepCount) parsed.velocities = Array(stepCount).fill(0.9);
  if (!Array.isArray(parsed.chords)     || parsed.chords.length     !== stepCount) parsed.chords = Array(stepCount).fill("");
  if (Array.isArray(parsed.offsets) && parsed.offsets.length === stepCount) {
    parsed.offsets = parsed.offsets.map(x => { const n = Number(x); return Number.isFinite(n) ? clamp(n, -0.5, 0.5) : 0; });
  } else { parsed.offsets = undefined; }
  if (typeof parsed.swing === "number" && Number.isFinite(parsed.swing)) parsed.swing = clamp(parsed.swing, 0, 0.75);
  else parsed.swing = undefined;
  if (parsed.filter && typeof parsed.filter === "object") {
    const out = {};
    for (const k of ["cutoff","reson","env","attack","decay","sustain","release"]) {
      const v = Number(parsed.filter[k]);
      if (Number.isFinite(v)) out[k] = clamp(v, 0, 1);
    }
    parsed.filter = Object.keys(out).length ? out : undefined;
  } else { parsed.filter = undefined; }
  return parsed;
}

// ---- plan -------------------------------------------------------------

const PLAN_SYSTEM = `You are a musical arranger + sound designer for a step sequencer whose tracks can use Plaits engines, 808/909/303 synth models, drum samples, Web MIDI, saved patches, or custom Tone.js patches.

You get a top-level creative prompt plus a set of "replaceable" tracks and optionally a list of "kept" tracks (do NOT touch). Respond with ONLY JSON.

PREFERRED (when allowReshape is true and availableEngines is provided):

{
  "bpm": <integer 40-200>,
  "scale": { "rootName": "C"|"C#"|...|"B", "mode": "major"|"minor"|"dorian"|"phrygian"|"lydian"|"mixolydian"|"harmonic minor"|"melodic minor"|"pentatonic"|"minor pentatonic"|"blues"|"chromatic" },
  "tracks": [
    { "name": "...", "engineKey": "...", "length": <int 4-64>, "prompt": "...",
      "soundPrompt": "... (only if designSounds)",
      "vol": 0..1,
      "fx": { "fuzz":{...}, "delay":{...}, "reverb":{...} }
    }, ...
  ]
}

LEGACY (fallback): {"bpm":...,"scale":...,"prompts":[...],"soundPrompts":[...]}

Mixing: kick/bass 0.8-0.95, snare 0.7-0.85, hats 0.35-0.55, pads 0.35-0.55, leads 0.55-0.75. Don't put everything at 0.8 — use dynamics.

Engines: PERCUSSIVE → dm:808-* / dm:909-* / smp:* (favored) or plaits:13/14/15. Bass/lead → dm:303, plaits:0/1/2, dm:poly-saw. Pads → dm:pad, plaits:6, plaits:12. Textures → plaits:7/8/9/10. Bells/plucks → dm:fm-bell, plaits:4/11. Prefer reusing existing engines that fit.

BPM ranges: dub techno 95-115, boom bap 85-95, house 120-128, drum'n'bass 160-180, trap 130-150, ambient 60-85.`;

export async function plan({ prompt, tracks, keptTracks, availableEngines, designSounds, allowReshape, scale, bars }) {
  if (!prompt || !Array.isArray(tracks) || tracks.length === 0) return { tracks: [] };
  const trackLines = tracks.map((t, i) => {
    const parts = [`engine: ${t.engine}`, `${t.stepCount} sixteenth-note steps`];
    if (t.role) parts.unshift(t.role);
    if (Array.isArray(t.accents) && t.accents.length) parts.push(`accents on ${t.accents.join(", ")}`);
    return `${i + 1}. "${t.name}" — ${parts.join("; ")}`;
  }).join("\n");
  const keptLine = Array.isArray(keptTracks) && keptTracks.length
    ? `\nKept tracks (DO NOT TOUCH):\n${keptTracks.map(t => `- "${t.name}" (${t.engine})${t.locked ? " [locked]" : ""}`).join("\n")}`
    : "";
  const catalogLine = allowReshape && Array.isArray(availableEngines) && availableEngines.length
    ? `\nAvailable engineKeys:\n${availableEngines.map(e => `  ${e.key} — ${e.label} [${e.group}]`).join("\n")}`
    : "";
  const modeLine = allowReshape && availableEngines?.length
    ? `Use "tracks" response shape.${designSounds ? " Include soundPrompt per track." : " Do NOT include soundPrompt fields."}`
    : `Use legacy "prompts" shape (one per input, same order).${designSounds ? " Also include matching soundPrompts." : ""}`;
  const scaleLine = scale && scale.mode ? `Current scale: ${scale.rootName || ""} ${scale.mode}.` : "";
  const barsLine = Number.isFinite(Number(bars)) && Number(bars) > 0
    ? `Target pattern length: ${Math.max(1, Math.min(8, Number(bars)))} bar(s) — each new track's "length" ≈ ${Math.max(1, Math.min(8, Number(bars))) * 16} steps.`
    : "";

  const msg = await getClient().messages.create({
    model: MODEL,
    max_tokens: 2000,
    system: [{ type: "text", text: PLAN_SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{
      role: "user",
      content: `Top-level prompt: ${prompt}

Replaceable tracks:
${trackLines}
${keptLine}
${catalogLine}

${scaleLine}
${barsLine}
${modeLine}`,
    }],
  });
  const text = msg.content.map(b => b.type === "text" ? b.text : "").join("");
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("plan: no json in response: " + text.slice(0, 200));
  const parsed = JSON.parse(m[0]);
  if (Array.isArray(parsed.tracks)) {
    const validKeys = new Set((availableEngines || []).map(e => e.key));
    parsed.tracks = parsed.tracks.filter(t => t && typeof t === "object").slice(0, 16).map(t => {
      const key = typeof t.engineKey === "string" && (validKeys.size === 0 || validKeys.has(t.engineKey)) ? t.engineKey : "plaits:0";
      const len = Math.max(1, Math.min(64, Number(t.length) || 16));
      const vol = Number(t.vol);
      return {
        name: String(t.name ?? "track").slice(0, 40),
        engineKey: key,
        length: len,
        prompt: String(t.prompt ?? "").trim(),
        soundPrompt: designSounds ? String(t.soundPrompt ?? "").trim() : undefined,
        vol: Number.isFinite(vol) ? clamp(vol, 0, 1) : undefined,
        fx: validateFx(t.fx),
      };
    });
    return parsed;
  }
  if (!Array.isArray(parsed.prompts) || parsed.prompts.length !== tracks.length) {
    throw new Error(`plan: bad prompts length ${parsed.prompts?.length} vs ${tracks.length}`);
  }
  parsed.prompts = parsed.prompts.map(s => String(s ?? "").trim());
  if (designSounds) {
    parsed.soundPrompts = Array.isArray(parsed.soundPrompts) && parsed.soundPrompts.length === tracks.length
      ? parsed.soundPrompts.map(s => String(s ?? "").trim())
      : parsed.prompts.slice();
  }
  return parsed;
}

// ---- designSound ------------------------------------------------------

const TONE_SYNTHS = ["Synth","MonoSynth","AMSynth","FMSynth","DuoSynth","MembraneSynth","MetalSynth","NoiseSynth","PluckSynth","PolySynth"];
const TONE_EFFECTS = ["Distortion","Chorus","FeedbackDelay","PingPongDelay","Reverb","Tremolo","Vibrato","AutoFilter","AutoPanner","BitCrusher","Filter","Phaser","Freeverb","JCReverb"];

const SOUND_SYSTEM = `You design a Tone.js v15 synth patch from a short description. Respond with ONLY a JSON object:

{"synth": "Synth"|"MonoSynth"|"AMSynth"|"FMSynth"|"DuoSynth"|"MembraneSynth"|"MetalSynth"|"NoiseSynth"|"PluckSynth",
 "poly": true|false,
 "options": { /* constructor options */ },
 "effects": [{ "type": "...", "options": {...} }, ...]}

Rules:
- synth must be one of the listed types. poly:false for MembraneSynth, NoiseSynth, MetalSynth, PluckSynth.
- options use real Tone keys: oscillator.type, envelope {a/d/s/r}, filter {Q,type,rolloff}, filterEnvelope {a/d/s/r,baseFrequency,octaves,exponent}, harmonicity, modulationIndex, pitchDecay, etc.
- effects from: Distortion, Chorus, FeedbackDelay, PingPongDelay, Reverb, Tremolo, Vibrato, AutoFilter, AutoPanner, BitCrusher, Filter, Phaser, Freeverb, JCReverb.
- All values JSON-primitives. Envelope times in seconds.`;

export async function designSound({ prompt }) {
  if (!prompt) throw new Error("empty prompt");
  const msg = await getClient().messages.create({
    model: MODEL,
    max_tokens: 900,
    system: [{ type: "text", text: SOUND_SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: `Patch description: ${prompt}` }],
  });
  const text = msg.content.map(b => b.type === "text" ? b.text : "").join("");
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("sound: no json in response: " + text.slice(0, 200));
  const parsed = JSON.parse(m[0]);
  if (!TONE_SYNTHS.includes(parsed.synth)) throw new Error("sound: invalid synth " + parsed.synth);
  parsed.poly = !!parsed.poly;
  if (!parsed.options || typeof parsed.options !== "object") parsed.options = {};
  if (!Array.isArray(parsed.effects)) parsed.effects = [];
  parsed.effects = parsed.effects
    .filter(e => e && TONE_EFFECTS.includes(e.type))
    .map(e => ({ type: e.type, options: (e.options && typeof e.options === "object") ? e.options : {} }));
  if (["MembraneSynth","NoiseSynth","MetalSynth","PluckSynth"].includes(parsed.synth)) parsed.poly = false;
  return parsed;
}
