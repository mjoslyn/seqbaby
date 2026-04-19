# seqbaby

Prompt-driven, multi-engine browser step sequencer. Mutable Instruments Plaits
(via `@vectorsize/woscillators`) plus Tone.js drum/synth recipes (808/909/303
etc.), analog-mono emulator voices (MiniBrute, Moog, Juno-60, electric guitar,
electric bass), drum samples, user uploads, ElevenLabs prompted samples, prompted
Tone.js patches, saved patches, and Web MIDI — all triggerable from a 32-pattern
bank with filter / env / fx / eq / comp / mod per track.

## Tech stack

- Frontend: vanilla ES modules in `public/`, Tone.js 15 via CDN, `woscillators.js`
  (Plaits WASM port) served from `public/`. No bundler — change files, reload.
- Backend:
  - Local dev: `server.js` (Node 20+, `node --env-file=.env --watch`), plain HTTP,
    serves `public/` + handles `/api/*`.
  - Deployed: Netlify. Static files from `public/`; each `/api/*` endpoint has
    a matching Netlify Function in `netlify/functions/*.mjs` that imports from
    `lib/api.js`. Redirects configured in `netlify.toml`.
- LLM: Claude via `@anthropic-ai/sdk` (`claude-haiku-4-5-20251001`). Prompt
  caching on every system prompt (`cache_control: { type: "ephemeral" }`).
- ElevenLabs: `v1/sound-generation` for prompted samples.
- Persistence:
  - localStorage keys: `seqbaby.patches.v1` (saved Tone.js patches),
    `seqbaby.sets.v1` (saved sessions).
  - Netlify Blobs (`@netlify/blobs`) for shareable session links. Local dev
    uses an in-memory Map fallback (lost on server restart).

## Layout

```
.
├── public/
│   ├── index.html         UI shell + <template> for tracks + OG meta + favicon
│   ├── app.js             ALL client logic — single file, ~6k lines
│   ├── style.css
│   ├── woscillators.js    Plaits WASM port, exposes window.woscillators
│   ├── favicon.svg
│   └── share.{svg,png}    1200×630 OpenGraph card (png rendered from svg)
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
voice → filterNode → eqNode → compressor → fxRack(input → fuzz → crusher → delay → reverb → output) → masterGain → ctx.destination
                                                                                         ↑
                                             per-track meterAnalyser taps fxRack.output
                                             state.masterAnalyser taps masterGain
```

- `filterNode` — native `BiquadFilterNode` (lowpass). `fireFilterEnv(t, time,
  duration)` schedules an ADSR on `frequency` that sweeps from a closed
  position (env depth octaves below cutoff) up to cutoff, then to sustain, then
  back down on release. For sample voices, sustain extends to
  `max(stepDuration, bufferDuration)` so the envelope shapes the entire sample.
- `eqNode` — `EQChain`: lowshelf 250Hz / peaking 1.2kHz Q=0.8 / highshelf 5kHz,
  ±18 dB.
- `compressor` — `TrackCompressor`: either native `DynamicsCompressorNode`
  (self) or an analyser-driven envelope follower ducking a pre-output gain
  (sidechain). Source can be any track's `voice.getOutputNode()`.
- `fxRack` — `FXRack`: custom fuzz (WaveShaper with DBA Fuzz War asymmetric
  curve + resonant lowpass + crossfade wet/dry) → `Tone.BitCrusher` →
  `Tone.FeedbackDelay` → `Tone.Reverb`. Chain order matters for modulation
  targets (see `getModTarget`).

## Voice types (`buildVoiceForEngine`)

| engine type    | class              | notes |
|---|---|---|
| `plaits`       | `PlaitsVoice`      | 4-voice round-robin pool of Plaits oscillators. modTrigger/modLevel patched; glide via `linearRampToValueAtTime` on `noteAudioParameter`. `getAudioParam(key)` returns voice0's harm/timb/morph/decay param (LFO mod only hits voice 0). |
| `drum-synth`   | `DrumSynthVoice`   | Tone.js recipes dispatched via `buildDrumSynthNode(kind, output)`. Groups: 808/909 kit + 303/poly-saw/fm-bell/pad + Emulators. `setParam`/`getAudioParam` delegate into `this.built` (which may be a poly pool). |
| `sample`       | `SampleVoice`      | Drum samples fetched from tonejs.github.io. Per-hit BufferSource. Pitch baseline = MIDI 48 (C3) so C3 plays natural; drum-kit tracks override with pitchBase=36 so C2 plays natural. |
| `custom`       | `CustomToneVoice`  | Tone.js synth + effects tree built from a JSON config (`/api/sound`). |
| `saved`        | `CustomToneVoice`  | Same class; config loaded from `loadPatches()` (localStorage). |
| `eleven`       | `ElevenVoice`      | Plays a base64 MP3 from `/api/eleven-sound`, decoded + cached. +2.5× headroom. |
| `upload`       | `UploadVoice`      | User-picked file, decoded + base64-persisted. |
| `midi`         | `MidiVoice`        | Web MIDI output; converts audio-time → DOMHighResTimeStamp for `output.send`. |

Voice interface:
`hit(midi, time, dur, vel, opts?)`, `setParam(k, v)`, `getAudioParam(k)`,
`setEngine(k)`, `canInPlaceChange(newKey)`, `getOutputNode()`,
`setDestination(target)`, `silence(now)`, `dispose()`.

`opts` for sample voices: `{ startOffset, endOffset, fadeIn, fadeOut, loopMode,
pitchBase, pitchLocked? }`. See `startSampleSource()` — shared helper used by
`SampleVoice`, `ElevenVoice`, and `UploadVoice` for one-shot / loop / ping-pong
playback (loop = `src.loop = true` + `loopStart`/`loopEnd`; ping-pong = cached
forward+reversed buffer via `getPingPongBuffer`).

## Emulators group (Tone.js analog-mono presets)

Five additional `drum-synth` engines in their own `"Emulators"` optgroup, each
wrapped in a voice pool via `makePolyPool(size, buildOne)` so chord tones
round-robin across N independent voices:

| key           | builder              | pool | character |
|---|---|---|---|
| `dm:mini-brute` | `buildMiniBruteVoice` | 4 | Arturia MiniBrute — saw + ultrasaw (detuned twin) + PWM pulse + metalized triangle + sub sine. Brute Factor distortion, PWM LFO into `pulse.width`, triangle wave-folder via `makeMetalizerCurve`, FM sine modulator → every osc `.detune` (depth in cents). |
| `dm:moog`       | `buildMoogVoice`     | 4 | Minimoog — 3 oscillators with independent waveform + range select (32'/16'/8'/4'/2') + ±7-semitone fine freq on osc 2/3. White/pink noise mix. Tone.Chebyshev warmth + EQ3 shelf. |
| `dm:juno`       | `buildJunoVoice`     | 6 | Roland Juno-60 — single DCO (PulseOscillator + LFO-PWM) + sub square + noise → HPF → baked-in Tone.Chorus (the Juno character). |
| `dm:guitar`     | `buildGuitarVoice`   | 6 | Electric guitar — Tone.PluckSynth (Karplus-Strong) → Distortion drive → EQ3 mid-forward → subtle Chorus. Per-hit velocity shapes trim gain (harder pick = louder + brighter). |
| `dm:bass`       | `buildBassVoice`     | 4 | Electric bass — PluckSynth tuned darker (dampening 2200, resonance 0.97) + mild Distortion + EQ3 with low-end boost / upper cut. No chorus (dry). Default MIDI 40 (E1). |

`makePolyPool` exposes `trigger` (round-robin), `release`, `setGlide`,
`setParam` (broadcast to every voice), and `getAudioParam(k)` (returns voice
0's param — same "first-voice" limitation as PlaitsVoice, noted as LFO mod
affects only voice 0).

### Param mapping per emulator

The stock track params (harm / timb / morph / decay + vol) are repurposed per
engine. `updatePlaitsControlsVisibility` relabels the timbre-group sliders and
hides the `rand` button for emulator engines:

- MiniBrute: `pwm rate / pw / (hidden) / (hidden)` + osc-mix (saw / pulse /
  tri / sub) + osc-mod (ultra / fm / metal)
- Moog: `detune / (hidden) / (hidden) / warm` + osc-mix (osc1 / osc2 / osc3)
  + moog-osc-group (per-osc wave select + range select + osc2/osc3 ±7-semi
  freq + noise white/pink + level)
- Juno: `pwm rate / pw / chorus / dec` + osc-mix (dco / sub / noise)
- Guitar: `drive / bright / chorus / sustain`
- Bass: `drive / tone / resonance / sustain`

Each emulator builder returns a `getAudioParam(key)` that maps mod keys
(`osc1..osc4 / ultra / fm / noise / harm`) to actual `AudioParam`s for LFO
modulation (e.g., mini-brute `harm → pwmLfo.frequency`, moog `harm →
osc2.detune`, juno `harm → pwmLfo.frequency`). `canModulate(t, key)` lists the
applicable mod keys per engine so the mod-panel picker only shows what works.

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
  sampleStarts: 0..1[], sampleEnds: 0..1[],
  sampleFadeIns: sec[], sampleFadeOuts: sec[],
  sampleLoopModes: ("off"|"loop"|"pingpong")[],
  // track-level:
  muted, soloed, lockInstrument, lockPattern, isDrumKit,
  glide, swing, density, speed, sampleSpeedMode ("native" default),
  promptText, soundPromptText,
  sampleDefaults: { start, end, fadeIn, fadeOut, loopMode }, // seed for new steps
  trackTick, speedAccum, repeatId,
  elevenAudio, elevenAudioMime, elevenBuffer,
  uploadAudio, uploadAudioMime, uploadFileName, uploadBuffer,
  params: { vol, harm, timb, morph, decay, osc1..osc4, ultra, fm, metal,
           // moog-only: osc1wave/osc2wave/osc3wave, osc1range/osc2range/osc3range,
           // osc2freq/osc3freq, noise, noisetype
  },
  filter: { cutoff, reson, env, attack, decay, sustain, release },
  filterNode, eq: {low, mid, high}, eqNode,
  comp: { enabled, source, threshold, ratio, attack, release, knee }, compNode,
  lfoConfig: { [key]: { enabled, type, rate, depth, sync, div } }, lfos: {},
  fxConfig: defaultFxConfig(), fxRack,
  midi: { outputId, channel }, voice, meterAnalyser,
  patterns: emptyPattern(len)[32], _patternIdx,
  el,  // DOM node
  _refreshSaveEnabled, _refreshSoundEnabled, // cached UI callbacks
}
```

### Pattern (per track, 32 slots)

```js
{ steps, lengths, notes, velocities, chords, offsets,
  arps, arpRates, arpRanges, arpDirs, complexities, ratchets,
  sampleStarts, sampleEnds, sampleFadeIns, sampleFadeOuts, sampleLoopModes }
```

`aliasPattern(t, idx)` rebinds `t.steps` / `lengths` / etc. to reference
`t.patterns[idx].*` directly so UI mutations flow straight into the pattern.
Switching patterns = re-aliasing + re-render.

### Global state (`state`)

```js
{
  tracks, playing, tick, repeatId, nextId, undoSnapshot,
  audioCtx, masterGain, masterAnalyser, ready,
  midi, scale: { active, root, mode },
  activePattern, patternMode ("repeat"|"chain"),
  patternSwitchMode ("immediate"|"finish"),
  queuedPattern, patternRepeats: Int[32], chainBarCount,
  patternMeta: [{regenPattern, regenInstrument}][32],
}
```

## Transport

Single `Tone.Transport.scheduleRepeat` at `"16n"`. Each callback:

1. Per track, accumulate `t.speedAccum += t.speed`; while `≥ 1`, fire a step.
2. Per firing: read chord tones (with complexity/inversion), expand for arp if
   on, apply per-track swing + per-step offset, compute `hitTime`, fire filter
   envelope, then `voice.hit(n, hitTime, duration, velocity, opts)` per tone.
   For sample voices `opts` includes `startOffset`, `endOffset`, `fadeIn`,
   `fadeOut`, `loopMode`, and `pitchBase` (36 for drum-kit tracks, 60
   otherwise). Ratchet retriggers the single note N times when no chord.
3. `Tone.Draw.schedule(paintNowIndicator, time)`.
4. Manual-queue switch: in `patternSwitchMode === "finish"`, commit the queued
   pattern at bar boundaries.
5. Chain mode: every `BAR_TICKS=16`, increment `chainBarCount`; if `≥
   patternRepeats[active]`, `switchPattern(findNextNonEmptyPattern(active))`.

Stop silences all voices (`cancelScheduledValues` on Plaits modTrigger/modLevel,
`triggerRelease` on Tone synths, `stop()` on active BufferSources, MIDI
all-notes-off).

## Server endpoints (shared via `lib/api.js`)

| route             | fn              | notes |
|---|---|---|
| `POST /api/generate`    | `generate({...})`    | step pattern from prompt + context (accents, density, scale, seedPattern, variation info, siblingTracks, `melodic` flag). Returns `{steps, notes, lengths, velocities, chords, offsets?, swing?, filter?}`. System prompt includes MELODIC TRACKS vs PERCUSSIVE TRACKS sections + concrete JSON examples. |
| `POST /api/plan`        | `plan({...})`        | arrangement planner. `allowReshape=true` returns full `tracks` array with engineKey/length/prompt/soundPrompt/vol/fx; `false` returns parallel `prompts`. BPM + scale + mixing + ElevenLabs one-shot/loop guidance embedded in system prompt. |
| `POST /api/sound`       | `designSound({...})` | returns a Tone.js `{synth, poly, options, effects[]}` config. |
| `POST /api/eleven-sound`| `elevenSound({...})` | proxies to ElevenLabs; returns `{audio: base64, mime}`. |
| `POST /api/share`       | `putShare({session})`| writes to Netlify Blobs (in-memory locally); returns `{id}`. |
| `GET /api/share?id=…`   | `getShare({id})`     | reads back. |

All endpoints use a lazily-initialized Anthropic client so env-var load order
doesn't matter.

## Key UI flows

- **Master generate** (`#master-prompt-go`). Reads `gen-pattern` +
  `gen-instruments` toggles + `gen-bars` + `gen-count` + `gen-sound-engine`.
  `instruments`: `off` (patterns only) / `on` (reshape tracks) / `all` (swap
  instruments in place across every pattern, preserving pattern data).
  Always calls `resetProcessingForPromptedSound(t)` on every reshaped/created
  track — planner-returned fx specs are ignored so generated instruments start
  dry (no fx, no mods).
- **Per-track pattern** (`track-pattern` button, sparkle icon). Opens
  `openPatternDialog(t)` — modal with textarea + preview / regenerate /
  apply / cancel. Preview tentatively applies to the active pattern and the
  user auditions via the main transport. Apply commits (+ undo snapshot);
  cancel restores the pre-open snapshot.
- **Per-track sound** (`track-sound` button, sparkle icon). Opens
  `showSoundDesignDialog({trackName, engine, defaultValue})` for prompted
  engines (`custom` / `eleven` / `upload` / `saved`). Button is disabled for
  any other engine via `t._refreshSoundEnabled()` called from
  `updatePlaitsControlsVisibility`.
- **Share** (`set-share`). `serializeSet()` → `putShare` → copies `?s=<id>`
  URL to clipboard. `loadShareFromUrl()` fetches + `applySet()` on page load.
- **Save / Load / Export / Import**. Same `serializeSet`/`applySet` shape;
  save/load use localStorage; export/import use JSON files. `onSaveSet`
  pre-fills the dialog with `suggestSetName()` — generated from master prompt
  or track prompts via stop-word filtering + 16-entry kenning palette +
  3-char base-36 token.
- **Download Pattern / Download Session** (pattern-bar). Opens a dialog with
  a filename input pre-filled by `suggestBounceFilename()` (same palette as
  session-save). `bounceAudio({bars, chainWhole, filename})`:
  1. Attaches a `MediaStreamAudioDestinationNode` to `state.masterGain`;
     disconnects masterGain from `ctx.destination` so the render is silent.
  2. Resets transport to pattern 1 (in `chain` mode for session, restored
     after).
  3. Starts `MediaRecorder`; waits `bars × 4 × 60/bpm + 0.4s` tail so
     reverbs/releases finish.
  4. Decodes the webm/mp4 blob via `decodeAudioData`, encodes to 16-bit PCM
     WAV via `audioBufferToWav` (RIFF header + interleaved int16).
  5. Shows a progress modal (`openBounceProgressDialog`) driven by rAF on
     wall-clock elapsed; closes on completion.
  6. `.wav` extension auto-appended.
- **Preview ducking** (`enterPreviewDuck / exitPreviewDuck`). Pattern and sound
  dialogs ramp the master gain to 20% of its current value while open (50ms
  ramp) so auditions don't blast. Restored on close.

## Planner reshape logic

- **`instruments` off + `pattern` on** → legacy prompts mode. Planner returns
  per-track prompts → written to `t.promptText`, `promptTrack(t)` runs.
- **`instruments` on + `pattern` on** → reshape. Sends replaceables + kept
  context + availableEngines + designSounds. Planner emits a full `tracks`
  array; client removes replaceables + creates fresh tracks from specs. Each
  new track: `resetProcessingForPromptedSound(t)` → `designSoundForTrack(t)`
  → `promptTrack(t)`.
- **`instruments` = all** → keepPatterns path. Match planner specs to
  replaceable tracks by index, update engine/params in place, preserve all 32
  patterns.

Planner-returned `spec.fx` is always ignored — generated instruments start
clean via `resetProcessingForPromptedSound`.

## Track UI (per track)

Header row:
```
name | engine | [✦] sound | lock-inst | [✦] pattern | lock-pat | save | load | drum | solo | mute | clear | remove | filter/env/fx/eq/comp/mod
```

Second row (conditional, inside `.track-synth-row` that flex-wraps to its own
line): `.timbre-group` (4 sliders) + `.osc-mix-group` (4 osc sliders) +
`.osc-mod-group` (mini-brute only: ultra/fm/metal) + `.moog-osc-group` (moog
only: 3 per-osc rows + noise).

Each of `filter / env / fx / eq / comp / mod` toggles a collapsible panel
below the track head.

The **mod panel**:
- Top strip: `glide` + `swing` sliders.
- One row per *enabled* LFO modulation (lazy-add). Each row: target label, on
  checkbox, waveform, sync checkbox, rate/div, depth, and an `×` remove
  button (single grid row with a 7-column template).
- Footer: `+ add modulation` picker → expands to a `<select>` of available
  targets (filtered by `canModulate(t, k)` so only engine-applicable keys
  show). Picking one enables the LFO and drops a fresh row.

The **step editor** (right-click a step) is a centered modal with:
- Note-pad grid (Launchpad-style, 3-octave viewport with oct +/− pager,
  scale-filtered when a scale is active — root highlighted, chromatic-mode
  shows all 12 pcs)
- Chord / arp / cpx / ratchet / vel / offset controls
- Sample row (shown for `sample` / `eleven` / `upload` engines): waveform
  canvas with draggable start/end handles + snap-to-beat dropdown + fit-speed
  select + loop mode (off / loop / ping-pong) + fade in/out sliders + preview
  + **apply to all** button (writes current settings to every active step on
  every pattern + stores as `t.sampleDefaults` so future new steps inherit).
- Chord options are filtered to scale-fitting chord types per `chordFitsScale`.

Per-step **vertical drag** on the grid adjusts the note pitch: 18px/semitone
chromatic, 22px/scale-degree scale-aware (via `midiToScaleIndex` +
`scaleIndexToMidi`). Enters pitch-mode when `|dy| > 10 && |dy| > |dx|`.

## Vol + meter control (`.vol-combo`)

Native `<input type="range">` stacked on top of a 4px meter strip at matching
width. `.meter-bar` is solid green; `paintMeter` toggles a `.clip` class
(red) when the sampled peak is `≥ 0.995` (effective 0 dBFS).

## Engines catalog

Built in `buildEngineCatalog()` — rebuilt whenever saved patches change.
Groups: `plaits` (16) · `drum / synth` (808/909/303/poly-saw/fm-bell/pad) ·
`Emulators` (mini-brute/moog/juno/guitar/bass) · `custom` · `eleven labs` ·
`user samples` (upload + saved patches) · `sample` (bundled drum kits) ·
`midi`. Engine key string is the source of truth (`"plaits:0"`,
`"dm:808-kick"`, `"dm:mini-brute"`, `"smp:Techno/kick"`, `"saved:name"`,
etc.).

Adding a new engine: extend `buildEngineCatalog()` + add a case to
`buildVoiceForEngine()` (or for drum-synth-family voices, add a case to
`buildDrumSynthNode` + a builder function) + (if it has unique state) extend
`serializeSet`/`applySet` + add it to `canModulate()` if it exposes
modulatable params.

## Drum-kit flag (`t.isDrumKit`)

Auto-detected at track creation via `guessIsDrumKit({engineKey, name})`
(engine type `"sample"` or regex match on kick/snare/hat/clap/tom/perc/drum in
engine key, label, or name). Per-track toggle via the `drum` button. Effects:

- Blank steps default to **C2** (MIDI 36) regardless of scale.
- Sample voices (`SampleVoice`, `ElevenVoice`, `UploadVoice`) pitch from
  `pitchBase: 36` so C2 = natural rate. Other tracks use `pitchBase: 60` (C4).
- `applyPattern` overrides every generated step's note to C2 for drum-kit
  tracks regardless of what the planner returned.
- Flipping the toggle on retroactively rewrites every active step on every
  pattern to C2.

## Melodic generation

Client sends `melodic: isMelodicTrack(t)` with every `/api/generate` request
(true for plaits melodic, dm:303/poly-saw/fm-bell/pad, all emulators, custom
tone, eleven, upload, saved, midi melodic; false for drum kits + percussive).

`GEN_SYSTEM` contains a strongly-worded `MELODIC TRACKS` section (phrase →
motif → variation → contour → voice leading → resolution → rests) with three
concrete JSON examples (melodic phrase in C minor, C minor bassline, pad
holding `min7`). The user message leads with `THIS IS A MELODIC TRACK…` or
`THIS IS A PERCUSSIVE TRACK…` based on the flag.

Client-side `smoothMelodicLeaps(t)` runs after `applyPattern` for melodic
tracks: walks consecutive triggered notes, octave-shifts any interval wider
than an octave back into range, then re-snaps to scale. Keeps voice leading
sane even when the model emits a wide jump.

## Gotchas + conventions

- **Plaits `modLevelPatched=1, modLevel=0` at init** — without the zero, empty
  tracks emit a continuous tone.
- **Audio init is lazy** — all voice construction is deferred until
  `ensureAudio()` (first `play` click). Before that `t.voice === null`. Most
  functions tolerate this.
- **Sample audio is persisted as base64** on the track (`elevenAudio`,
  `uploadAudio`). Decoded in `applySet`, `designSoundForTrack`,
  `pickAudioFileForTrack`. `normalizeAudioBuffer(buf, {trim})` runs on every
  decode; `trim: true` (passed by every eleven path) removes leading/trailing
  silence via `trimSilenceFromBuffer` before the RMS+peak normalize.
- **Sample default playback speed** is `"native"`. In `designSoundForTrack`
  (eleven path), we auto-set `"1xbpm"` when the prompt contains `loop` but not
  `no loop` (so planner-tagged loop samples stretch to one bar at tempo).
- **Chord key renamed `"7"` → `"dom7"`** — JS engines hoist integer-looking
  keys to the top of iteration order, which broke the dropdown order.
  `canonicalChord()` aliases legacy `"7"`.
- **Hidden attribute vs display** — `.step-editor .se-field`, `.timbre-group`,
  `.osc-mix-group`, `.osc-mod-group`, `.moog-osc-group` all have explicit
  `[hidden] { display: none !important }` rules because their default
  `display: grid | flex` would otherwise beat the attribute.
- **Abort controller** — `startGen()`/`endGen()`/`cancelGen()` wrap every
  generation so the cancel button in the header aborts in-flight fetches.
- **Cross-track context** — `promptTrack` sends a 12-track `siblingTracks`
  context (name/engine/stepCount/steps/notes) so prompts like "follow the
  kick" have something to react to.
- **Per-track compressor sidechain** — the analyser lives on the source
  track's voice output, surviving voice rebuilds via
  `refreshCompSourceDropdowns()`.
- **Voice-pool LFO limitation** — `makePolyPool.getAudioParam` returns the
  first voice's param only. LFO modulation on emulator engines affects voice
  0; chord tones on voices 1..N-1 play the baseline. Same limitation as
  `PlaitsVoice`.
- **Generated instruments stay clean** — every reshape/design path calls
  `resetProcessingForPromptedSound(t)` (filter wide open, env depth 0, all
  LFOs disabled, every fx wet → 0). The user adds fx manually.
- **`t.promptText` is the source of truth** — the old `.prompt-input` field
  is gone; planner writes, variate reads, promptTrack/promptTrackFull read
  from `t.promptText`.
- **`canModulate` gates the mod picker** — if you add a new modulation target,
  update `canModulate` and ensure the voice's `getAudioParam(key)` returns an
  `AudioParam` / `Signal` so the LFO connect works.

## Adding a feature — quick map

- New audio effect → extend `FXRack` (native node chain; Tone Signals work as
  LFO targets via `getAudioParam`). Add to `defaultFxConfig`,
  `applyFxToTrack`, `refreshFxPanelUI`, `wireFxPanel`, and `resetFxDry`.
- New LFO mod target → add to `LFO_KEYS`, extend `getModTarget(t, key)`, add
  a target-specific amp in `LFO_AMP_SCALE`, and update `canModulate` so it
  appears in the picker for engines that support it. For voice-internal
  params expose a `getAudioParam(key)` on the builder.
- New per-step editor control → data array on `emptyPattern()` + aliased
  field on `aliasPattern()` + row in the step-editor HTML + wire-up in the
  modal + consume in the transport loop.
- New engine → catalog entry + voice class + `buildVoiceForEngine` dispatch
  (or `buildDrumSynthNode` case + builder fn for analog-mono style) +
  `updatePlaitsControlsVisibility` if it hides/shows any track-head fields +
  `canModulate` entry if it has modulatable params.
- New LLM endpoint → add function to `lib/api.js`, route in `server.js`,
  create matching `netlify/functions/<name>.mjs`, add redirect in
  `netlify.toml`.

## Known limitations / TODO breadcrumbs

- No undo/redo beyond single-slot session-level undo for generate actions
  (`state.undoSnapshot`).
- Voice-pool LFO only targets voice 0 — chord tones don't pick up mod.
- ElevenLabs generation capped at 2s duration client-side; the API supports
  up to 22s if you want longer clips.
- Planner sometimes returns `tracks` with wrong length for polymetric
  requests; `plan()` clamps to 1..64 + defaults to `bars*16`.
- Netlify Blobs share IDs reset on local server restart (in-memory
  fallback). On deployed Netlify, Blobs is persistent.
- Bounce captures live via `MediaRecorder` (real-time). Offline rendering
  would require rebuilding every voice under an `OfflineAudioContext`, which
  doesn't play well with the native Plaits WASM voice.
- Keyboard shortcuts minimal (Enter in dialogs, Cmd/Ctrl+Enter to trigger
  pattern preview, Escape to close).

## Deployment

Push to `main`; Netlify auto-deploys via `netlify.toml`. Env vars
`ANTHROPIC_API_KEY` + `ELEVENLABS_API_KEY` must be set in the Netlify UI for
functions to work. Repo: https://github.com/mjoslyn/seqbaby.
