# seqbaby

Prompt-driven, multi-engine browser step sequencer. Mutable Instruments Plaits (via
`@vectorsize/woscillators`) plus Tone.js 808/909/303 recipes, drum samples, user
uploads, ElevenLabs prompted samples, prompted Tone.js patches, saved patches, and
Web MIDI — all triggerable from a 32-pattern bank with filter/env/fx/eq/comp/mod per
track.

## Tech stack

- Frontend: vanilla ES modules in `public/`, Tone.js via CDN, `woscillators.js`
  (Plaits WASM port) served from `public/`. No bundler — change files, reload.
- Backend:
  - Local dev: `server.js` (Node 20+, `node --env-file=.env --watch`), plain HTTP,
    serves `public/` + handles `/api/*`.
  - Deployed: Netlify. Static files from `public/`; each `/api/*` endpoint has a
    matching Netlify Function in `netlify/functions/*.mjs` that imports from the
    shared `lib/api.js`. Redirects configured in `netlify.toml`.
- LLM: Claude via `@anthropic-ai/sdk` (`claude-haiku-4-5-20251001`). Prompt
  caching enabled on every system prompt (`cache_control: { type: "ephemeral" }`).
- ElevenLabs: `v1/sound-generation` for prompted samples.
- Persistence:
  - localStorage keys: `seqbaby.patches.v1` (saved Tone.js patches),
    `seqbaby.sets.v1` (saved sessions).
  - Netlify Blobs (`@netlify/blobs`) for shareable session links. Local dev uses
    an in-memory Map fallback (lost on server restart).

## Layout

```
.
├── public/
│   ├── index.html         UI shell + <template> for tracks + OG meta + favicon
│   ├── app.js             ALL client logic — ~4000 lines, single file
│   ├── style.css
│   ├── woscillators.js    Plaits WASM port, exposes window.woscillators
│   ├── favicon.svg        Synth-baby logo (also the in-app logo)
│   └── share.svg          1200×630 OpenGraph card
├── lib/
│   └── api.js             Shared generate/plan/designSound/elevenSound/share fns
├── netlify/functions/     Thin wrappers: generate/plan/sound/eleven-sound/share
├── server.js              Local Node HTTP server wrapping lib/api.js
├── netlify.toml           publish=public, functions=netlify/functions, redirects
├── .env.example           ANTHROPIC_API_KEY, ELEVENLABS_API_KEY, PORT
└── package.json           "dev" = node --watch --env-file=.env server.js
```

## Dev commands

```
npm run dev            # local server on :5173, reads .env
npm run netlify:dev    # full Netlify emulation (functions + static) on :8888
npm run start          # prod-ish local server
```

`.env` holds the keys locally. On Netlify, set `ANTHROPIC_API_KEY` and
`ELEVENLABS_API_KEY` in Site configuration → Environment variables.

## Audio signal chain (per track)

```
voice → filterNode → eqNode → compressor → fxRack(input → fuzz → delay → reverb → output) → masterGain → ctx.destination
                                                                                    ↑
                                             per-track meterAnalyser taps fxRack.output
                                             state.masterAnalyser taps masterGain
```

- `filterNode` — native `BiquadFilterNode` (lowpass). `fireFilterEnv(t, time, duration)`
  schedules an ADSR on `frequency` that sweeps from a `closed` position (env depth
  octaves below cutoff) up to cutoff (base), then to a sustain level, then back down
  on release. For sample-based voices, sustain extends to `max(stepDuration, bufferDuration)`
  so the envelope shapes the entire sample.
- `eqNode` — `EQChain`: lowshelf 250Hz / peaking 1.2kHz Q=0.8 / highshelf 5kHz, ±18 dB.
- `compressor` — `TrackCompressor`: either a native `DynamicsCompressorNode` (self mode)
  or an analyser-driven envelope follower ducking a pre-output gain (sidechain mode).
  Sidechain source is another track's `voice.getOutputNode()`.
- `fxRack` — `FXRack`: custom fuzz (WaveShaper with DBA Fuzz War-style asymmetric
  curve + resonant lowpass + crossfade wet/dry) → `Tone.FeedbackDelay` → `Tone.Reverb`.

## Voice types (`buildVoiceForEngine`)

| engine type    | class              | notes |
|---|---|---|
| `plaits`       | `PlaitsVoice`      | 4-voice round-robin pool of Plaits oscillators for poly/chord support. Uses modTriggerPatched+modLevelPatched; glide via linearRampToValueAtTime on `noteAudioParameter`. |
| `drum-synth`   | `DrumSynthVoice`   | Tone.js recipes for 808/909 kit + 303/poly-saw/fm-bell/pad. `buildDrumSynthNode(kind, output)` returns `{nodes, trigger, release}`. |
| `sample`       | `SampleVoice`      | Fetches Tone.js-hosted drum samples (`tonejs.github.io/audio/drum-samples/*`). Per-hit BufferSource, pitch-shifted by MIDI. |
| `custom`       | `CustomToneVoice`  | Tone.js synth+effects tree built from a JSON config returned by `/api/sound`. |
| `saved`        | `CustomToneVoice`  | Same class, config loaded from `loadPatches()` (localStorage). |
| `eleven`       | `ElevenVoice`      | Plays a base64 MP3 returned by `/api/eleven-sound`, decoded once and cached. Has +8dB boost + `baseRate` for BPM-sync. |
| `upload`       | `UploadVoice`      | User-picked file, decoded + base64-persisted. Same shape as ElevenVoice minus boost. |
| `midi`         | `MidiVoice`        | Web MIDI output. Hit converts audio-time → `DOMHighResTimeStamp` for `output.send` scheduling. |

All voices implement: `hit(note, time, duration, velocity)`, `setParam(key, val)`,
`getAudioParam(key)` (for LFO mod routing), `setEngine(key)`,
`canInPlaceChange(newKey)`, `getOutputNode()`, `setDestination(target)`,
`silence(now)`, `dispose()`.

## Data model

### Track (`state.tracks[]`)

```js
{
  id, name, engineKey, length, accents (Set of 0-indexed),
  // aliased from patterns[activePattern] (see below):
  steps: Int[], lengths: Int[], notes: (MIDI|null)[],
  velocities: 0..1[], chords: ("" | "maj" | "min" | ... )[],
  offsets: -0.5..0.5[], arps: bool[], arpRates: number[],
  arpRanges: 1..4[], arpDirs: ("up"|"down"|"updown"|"random")[],
  complexities: 0..4[], ratchets: 1..8[],
  // track-level:
  muted, soloed, lockInstrument, lockPattern,
  glide, swing, sampleSpeedMode, density, speed,
  trackTick, speedAccum, repeatId,
  soundPromptText, customConfig, elevenAudio, elevenAudioMime,
  elevenBuffer, uploadAudio, uploadAudioMime, uploadFileName, uploadBuffer,
  params: { vol, harm, timb, morph, decay },
  filter: { cutoff, reson, env, attack, decay, sustain, release },
  filterNode, eq: {low, mid, high}, eqNode,
  comp: { enabled, source, threshold, ratio, attack, release, knee }, compNode,
  lfoConfig: { [key]: { enabled, type, rate, depth, sync, div } }, lfos: {},
  fxConfig: defaultFxConfig(), fxRack,
  midi: { outputId, channel }, voice, meterAnalyser,
  patterns: emptyPattern(len)[32], _patternIdx,
  el  // DOM node
}
```

### Pattern (per track, 32 slots)

```js
{ steps, lengths, notes, velocities, chords, offsets, arps, arpRates,
  arpRanges, arpDirs, complexities, ratchets }
```

`aliasPattern(t, idx)` rebinds `t.steps`/`lengths`/etc. to reference
`t.patterns[idx].*` directly so UI mutations flow straight into the pattern.
Switching patterns = re-aliasing + re-render.

### Global state (`state`)

```js
{
  tracks, playing, tick, repeatId, nextId,
  audioCtx, masterGain, masterAnalyser, ready,
  midi, scale: { active, root, mode },
  activePattern, patternMode ("repeat"|"chain"), queuedPattern,
  patternRepeats: Int[32], chainBarCount,
  patternMeta: [{regenPattern, regenInstrument}][32],
}
```

## Transport

Single `Tone.Transport.scheduleRepeat` at `"16n"`. Each callback:

1. For each track, accumulate `t.speedAccum += t.speed`; while `≥ 1`, fire a step
   (supports fractional/integer speeds by firing 0..N times per global tick).
2. Per firing: read chord tones (with complexity/inversion), expand for arp if on,
   apply per-track swing + per-step offset, compute `hitTime`, fire filter envelope,
   then `voice.hit(n, hitTime, duration, velocity)` for each tone — ratchet
   retriggers single notes when no chord is selected.
3. `Tone.Draw.schedule(paintNowIndicator, time)`.
4. Chain mode: at every 16 ticks, increment `state.chainBarCount`; if `≥
   patternRepeats[active]`, `switchPattern(findNextNonEmptyPattern(active))`.

Stop silences all voices (`cancelScheduledValues` on Plaits modTrigger/modLevel,
`triggerRelease` on Tone synths, `stop()` on active BufferSources, MIDI
all-notes-off).

## Server endpoints (shared via `lib/api.js`)

| route             | fn              | notes |
|---|---|---|
| `POST /api/generate`    | `generate({...})`    | step pattern from prompt + context (accents, density, scale, seedPattern, variation info, siblingTracks for cross-track awareness). Returns `{steps, notes, lengths, velocities, chords, offsets?, swing?, filter?}`. |
| `POST /api/plan`        | `plan({...})`        | arrangement planner. `allowReshape=true` returns full `tracks` array with engineKey/length/prompt/soundPrompt/vol/fx; `false` returns parallel `prompts` array. BPM + scale + mixing guidance. |
| `POST /api/sound`       | `designSound({...})` | returns a Tone.js `{synth, poly, options, effects[]}` config. |
| `POST /api/eleven-sound`| `elevenSound({...})` | proxies to ElevenLabs; returns `{audio: base64, mime}`. |
| `POST /api/share`       | `putShare({session})`| writes to Netlify Blobs (or in-memory locally); returns `{id}`. |
| `GET /api/share?id=…`   | `getShare({id})`     | reads back. |

All endpoints use the same Anthropic client (lazily initialized to avoid
module-load errors when the key is missing).

## Key UI flows

- **generate button** — reads `gen-pattern` + `gen-instruments` toggles + `gen-bars`
  + `gen-count` + `gen-sound-engine` dropdown. `instruments` has three states:
  `off` (patterns only), `on` (reshape tracks for the current gen),
  `all` (swap instruments in place across every pattern, preserving pattern data).
  Calls `promptFromMaster({reshape, designSounds, regenPatterns, keepPatterns, bars})`.
- **variate button** — takes the active pattern as a seed, finds the next N empty
  pattern slots, and regenerates each non-pattern-locked track there with the
  seed included in the prompt. Never overwrites filled slots.
- **sound… button** — opens `showSoundDesignDialog`. Preview (temporary synth or
  decoded buffer) / regenerate / apply / cancel. Dispatches to either `/api/sound`
  or `/api/eleven-sound` based on the track's current engine.
- **Share** — `serializeSet()` → `putShare` → copies `?s=<id>` URL to clipboard.
  On load, `loadShareFromUrl()` fetches and `applySet()`.
- **Save / Load / Export / Import** — same `serializeSet`/`applySet` shape;
  differs only in where the JSON lives (localStorage vs file).

## Planner reshape logic

- **`instruments` off + `pattern` on** → legacy prompts mode. For each non-lock-pattern
  track, `/api/plan` returns a per-track prompt, which is stuffed into that track's
  prompt input and then `promptTrack(t)` is called.
- **`instruments` on + `pattern` on** → reshape. Sends replaceable tracks
  (`!lockInstrument && !lockPattern`) + kept context + availableEngines + designSounds.
  Planner emits a full `tracks` array; client removes replaceables and creates
  fresh tracks from the specs. Each new track gets `promptTrack` at the end.
- **`instruments` = all** → keepPatterns path. For each non-instrument-locked
  track, match the planner's emitted spec by index and update engine/fx/params
  *in place*, preserving all 32 patterns. Pattern data survives the instrument swap.

## Engines catalog

Built in `buildEngineCatalog()` — rebuilt whenever saved patches change.
Groups: `plaits` (16), `drum / synth` (808/909/303/poly-saw/fm-bell/pad),
`custom` (prompted Tone.js), `eleven labs`, `user samples` (upload + saved
patches), `sample` (bundled drum kits), `midi`. Engine key string is the source
of truth (`"plaits:0"`, `"dm:808-kick"`, `"smp:Techno/kick"`, `"saved:name"`,
etc.). Adding a new engine: extend `buildEngineCatalog()` + add a case to
`buildVoiceForEngine()` + (if it has unique per-track state) extend the
serialization in `serializeSet/applySet`.

## Gotchas + conventions

- **Plaits `modLevelPatched=1`, `modLevel=0` at init** — without the zero, empty
  tracks emit a continuous tone because Plaits' LEVEL VCA stays open.
- **Audio init is lazy** — all voice construction is deferred until `ensureAudio()`
  (first `play` click or when needed by a sample prompt). Before that, tracks
  have `t.voice === null`. Most functions check for this.
- **Sample audio is persisted as base64 on the track** — `elevenAudio`,
  `uploadAudio`. Decoded into `AudioBuffer` on demand in `applySet`, `designElevenSound`,
  and the pickAudioFileForTrack flow. `normalizeAudioBuffer` (RMS + peak + 5ms end
  taper) runs on every decode.
- **Chord key renamed `"7"` → `"dom7"`** — JS engines hoist numeric-looking object
  keys to the top of iteration order, which broke the dropdown. `canonicalChord()`
  maps legacy `"7"` in saved data.
- **Hidden attribute vs display** — `.step-editor .se-field`, `.timbre-group`, and
  the track panels all have explicit `[hidden] { display: none }` rules because
  their default `display: grid|flex` would otherwise override the attribute.
- **Abort controller** — `startGen()` / `endGen()` / `cancelGen()` wrap every
  generation flow so the cancel button in the header aborts in-flight fetches.
- **Cross-track context** — when generating a pattern, `siblingTracks` (name,
  engine, stepCount, steps, notes for every other non-empty track) is sent so
  prompts like "follow the kick" work.
- **Per-track compressor sidechain** — the analyser lives on the _source_
  track's voice output, so it survives source voice rebuilds via
  `refreshCompSourceDropdowns()` + re-applying config.
- **Default step velocity is 0.5**, default cutoff is 1.0 (fully open), default
  env is 0. Prompted sounds forcibly reset filter/env/mods/fx to dry via
  `resetProcessingForPromptedSound(t)` so patches sound as designed.

## Adding a feature — quick map

- New audio effect → extend `FXRack` (native node chain; Tone Signals work as LFO
  targets via `getAudioParam`).
- New LFO mod target → add to `LFO_KEYS`, extend `getModTarget(t, key)`, add a
  target-specific amp in `LFO_AMP_SCALE`, add the label row to `renderModPanel`.
- New per-step editor control → data array on `emptyPattern()` + aliased field on
  `aliasPattern()` + row in `openStepEditor` HTML + wire-up in the dialog body +
  consume in the transport loop.
- New engine → catalog entry + voice class + `buildVoiceForEngine` dispatch +
  `updatePlaitsControlsVisibility` if it hides/shows any track-head fields.
- New LLM endpoint → add function to `lib/api.js`, route in `server.js`, create
  a matching `netlify/functions/<name>.mjs`, add the redirect in `netlify.toml`.

## Known limitations / TODO breadcrumbs

- No undo/redo.
- No per-voice poly-mod on Plaits: LFO only targets the first pool voice's
  param, so chord tones on other pool voices don't pick up modulation.
- ElevenLabs generation is capped at 2s duration client-side; the API supports
  up to 22s if you want longer clips.
- Planner sometimes returns `tracks` with wrong length for polymetric requests;
  `plan()` clamps to 1..64 + defaults to `bars*16`.
- Local-only: Netlify Blobs share IDs reset on server restart (in-memory
  fallback). On deployed Netlify, Blobs is persistent.
- No rendering / bounce-to-audio export — the app is live-only.
- Keyboard shortcuts minimal (Enter in dialogs, Escape to close).

## Deployment

Push to `main`; Netlify auto-deploys via the `netlify.toml`. Env vars
`ANTHROPIC_API_KEY` + `ELEVENLABS_API_KEY` must be set in the Netlify UI for
functions to work. Repo: https://github.com/mjoslyn/seqbaby.
