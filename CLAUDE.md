# seqbaby

Multi-engine browser step sequencer. A hand-written vanilla Web Audio engine
(Mutable Instruments Plaits via `@vectorsize/woscillators`, Tone.js drum/synth
recipes, worklet models of the TB-303 / Access Virus / DX7 plus seven
analog-mono emulators, wavetable + granular + unified sampler
engines, Web MIDI) wrapped in a thin Next.js + Supabase shell for accounts,
cloud songs, a patch gallery, and share links. 32-pattern bank with filter /
env / fx / eq / comp / mod / automation per track.

## Tech stack

- **Shell**: Next.js 15 (App Router) + React 19 in `app/`. SSRs the engine's
  static DOM (`app/studioMarkup.ts`), then `app/ScriptLoader.tsx` injects the
  engine scripts in order: Tone.js 15 (CDN) → `public/woscillators.js` →
  `public/js/main.js` (ES module). `middleware.ts` refreshes the Supabase
  session on every request *except* static engine assets.
- **Engine**: ~43 dependency-free vanilla ES modules in `public/js/`. No
  bundler — edit, reload. `window.seqbaby` (from `appApi.js`) exposes `state`
  and serialize/apply hooks to the React shell (typed in `app/seqbaby.d.ts`).
- **Accounts + data**: Supabase (Postgres + Auth + RLS). Tables: `profiles`,
  `songs`, `patches` (see `supabase/migrations/`). Server actions in
  `app/{songs,patches,profile,auth,account}/actions.ts`.
- **Anonymous sharing**: `app/api/share/route.ts` (public songs rows);
  `lib/api.js` + `netlify/functions/share.mjs` are the legacy Netlify Blobs
  path.
- **Persistence (local)**: localStorage `seqbaby.patches.v1` (saved patches),
  `seqbaby.sets.v1` (saved sessions).
- **Deploy**: Netlify via `@netlify/plugin-nextjs` (`netlify.toml`, Node 22).
  Push to `main` auto-deploys production; branch pushes get deploy previews
  (stable alias: `<branch-with-dashes>--seqbaby.netlify.app`).

## Layout

```
.
├── app/                       Next.js shell — routing, auth, account UI, server actions
│   ├── page.tsx               studio route: SSRs engine DOM, boots engine, AccountBar
│   ├── studioMarkup.ts        engine's static DOM skeleton (raw HTML string)
│   ├── ScriptLoader.tsx       injects Tone → woscillators → js/main.js in order
│   ├── AccountBar/SongsMenu/PatchesMenu/SaveButton/OpenSongOnLoad.tsx
│   ├── login/ settings/ u/[username]/       auth, account settings, public profiles
│   ├── api/share/route.ts     anonymous ?s=<slug> share endpoint
│   └── {songs,patches,profile,auth,account}/actions.ts   Supabase server actions
├── public/
│   ├── js/                    THE ENGINE — see module map below
│   ├── woscillators.js        Plaits WASM port, exposes window.woscillators
│   ├── wavetables/akwf/       bundled AKWF wavetables (CC0)
│   └── style.css  favicon.svg  share.{svg,png}
├── lib/
│   ├── supabase/{client,server,middleware}.ts   Supabase SSR helpers
│   └── api.js                 legacy Blobs share put/get (+ in-memory dev fallback)
├── middleware.ts              Supabase session refresh (skips engine assets)
├── supabase/migrations/       profiles, songs, patches, delete_own_account RPC
├── netlify/functions/share.mjs  legacy function wrapper
├── server.js                  legacy static server (npm run legacy:dev)
└── netlify.toml  next.config.mjs  tsconfig.json (excludes public/js from TS)
```

### Engine module map (`public/js/`)

- `main.js` — bootstrap `init()`: creates the AudioContext, binds Tone to it,
  wires all UI, starter tracks, unlock listeners. Entry point.
- `transport.js` — `ensureAudio()`, `togglePlay()`, the single
  `Tone.Transport.scheduleRepeat` loop, `loadWorklet()`, `requestMidiIfNeeded()`.
- `voices.js` — every voice class + `buildVoiceForEngine` dispatch + the
  emulator builder functions.
- `state.js` — global `state`, `emptyPattern`, `aliasPattern`, `switchPattern`.
- `catalog.js` — `buildEngineCatalog()`, saved-patch storage, engine dropdowns.
- `signal.js` — per-track graph wiring (filter/eq/comp/fxRack), filter env.
- `fxRack.js` — `FXRack` chain + `defaultFxConfig`.
- `lfo.js` — LFO configs, `getModTarget`/`canModulate`, tempo sync, setter loop.
- `automation.js` — per-step parameter automation (`AUTOMATION_TARGETS`).
- `paramTargets.js` — control class → `{lfo, auto}` key map, the mod/automation
  exclusivity helpers, the label indicators, and the per-parameter descriptions
  (generic fallbacks only — the engines describe their own sliders, see below).
- `paramMenu.js` — right-click a parameter → its mod + automation, in a modal.
- `syncTrackSoundUI(t)` (render.js) — writes a track's whole sound back into its
  controls. The one place that job lives: session load, patch load and a
  pattern-lock recall all call it (it used to be copy-pasted in two of them,
  which is how the eq/comp sliders came to be missing from session load).
- `render.js` / `stepGrid.js` / `stepEditor.js` / `pianoRoll.js` /
  `patternBar.js` / `scaleUI.js` / `meters.js` / `beat.js` — UI.
- `keyboard.js` — computer-keyboard performance mode + capture.
- `knob.js` — the rotary knob layer, drawn over the native range inputs without
  replacing them. See the Knobs section below.
- `macro.js` — XY macro pads, cross-track. See the Macro pads section below.
- `session.js` — serialize/apply sets + track patches, legacy migration.
- `patternSound.js` — p-lock: a track's sound stored per pattern, captured on
  the way out of a pattern and diff-applied on the way in.
- `track.js` — track lifecycle (create/resize/clone).
- `bounce.js` — WAV render via MediaRecorder.
- `buffers.js` — sample decode/normalize cache, `startSampleSource`.
- `wavetableEditor.js` — in-app wavetable frame editor for `wt:akwf`.
- `tb303.js` — the TB-303 circuit model: AudioWorklet processor source +
  registration + voice builder. See the TB-303 section below.
- `virus.js` — the Access Virus model, same shape: processor source string,
  Blob-URL registration, voice builder, and its panel key lists.
- `guitar.js` — the electric guitar: the whole rig (waveguide string, pickup,
  amp, cab, speaker-to-string feedback) in one AudioWorklet, plus the famous-tone
  table. Same file shape as the three above. See the guitar section below.
- `bass.js` — the electric bass, guitar.js's sibling: same waveguide, wound and
  stiffer, with a parallel dirt path, a rig compressor and an octaver.
- `dx7.js` — the Yamaha DX7, same shape again, plus the 32-algorithm
  table, the panel's generated key lists and the preset voices. See the DX7
  section below.
- `theory.js` / `meter.js` / `generate.js` / `curves.js` / `params.js` /
  `constants.js` / `dialogs.js` / `dom.js` / `icons.js` / `appApi.js` /
  `types.js` (JSDoc typedefs — data-model source of truth).

## Dev commands

```
npm run dev            # Next.js dev server on :3000 (studio + engine work with no env)
npm run build && npm run start   # production build + serve
npm run netlify:dev    # full Netlify emulation on :8888
npm run legacy:dev     # pre-Next static Node server on :5173 (engine assets only)
```

Account features need `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY`
(see `.env.example`). The engine itself runs without any env.

## Audio signal chain (per track)

```
voice → filterNode → eqNode → compressor → fxRack → masterGain → masterLimiter → ctx.destination
                                              ↑                        ↑
                       per-track meterAnalyser taps fxRack.output      masterAnalyser taps masterGain (pre-limiter)
```

- `filterNode` — native `BiquadFilterNode` (lowpass). `fireFilterEnv(t, time,
  duration)` schedules an ADSR sweep on `frequency`. For sampler voices the
  sustain extends to the buffer duration so the env shapes the whole sample.
- `eqNode` — `EQChain`: lowshelf 250Hz / peaking 1.2kHz / highshelf 5kHz.
- `compressor` — `TrackCompressor`: native `DynamicsCompressorNode` (self) or
  an analyser-driven envelope follower ducking a pre-output gain (sidechain
  from any track's `voice.getOutputNode()`).
- `fxRack` — `FXRack`, serial chain in this order: **vinyl → cassette → fuzz →
  ring mod → wave shaper → crush → auto-wah → chorus → phaser → flanger →
  pitch shift → delay → reverb**. `defaultFxConfig()` keys match. Chain order
  matters for LFO/automation targets.
- Master bus: `masterGain` → `masterLimiter` (DynamicsCompressor as brickwall
  safety, threshold −2dB ratio 20) → destination.

## Audio start / unlock (hard-won — don't regress)

All of this lives in `main.js` `init()` and `transport.js`:

- The AudioContext is created at `init()` and `Tone.setContext(ctx)` runs
  BEFORE anything reads `Tone.Transport` (its clock latches onto the context's
  time at first access).
- **First-gesture unlock**: capture-phase `pointerdown/keydown/touchstart`
  listeners call `primeAudioForIOS()` whenever the context is suspended.
  Installed permanently — also recovers from browser re-suspends.
- **Keep-alive**: on the context's first transition to "running" (statechange),
  a silent ConstantSource pins the output device open for the session, and
  `state._outputRunningSince` is recorded.
- **Adaptive transport lead**: `togglePlay` starts at `+0.5` when the output
  just spun up (macOS drops the first fraction of a second of DAC output on
  cold start — playhead moves, no sound), `+0.1` when warm.
- **Web MIDI is lazy and never awaited on the play path**: Chrome 124+ pops a
  permission prompt for `requestMIDIAccess`, which burns the play click's user
  activation and leaves the context suspended. `requestMidiIfNeeded()` fires
  in the background, and only when a track actually uses a MIDI engine (play,
  engine switch, session load, track create all call it).
- **Worklet preload**: `loadWorklet()` (single-flight, retries on failure)
  starts the Plaits WASM fetch+compile at init; `ensureAudio`'s await is
  usually instant. `addModule` works on a suspended context.
- **bfcache**: `pagehide` only closes the context when `!e.persisted` —
  closing on bfcache entry leaves the restored page with a dead "closed"
  context (silent forever until reload).
- **Visual latency compensation**: playhead/beat paints are scheduled at
  `time + visualOutputLatency()` — Chrome's reported `ctx.outputLatency`,
  or an ear-tuned 0.18s estimate on Safari (no outputLatency API there).
  `?vlat=<seconds>` URL param overrides for calibration.
- The iOS unlock dance (silent looping `<audio>`, silent buffer + inaudible
  osc primer, touch-only suspend/resume kick, up-front gate dialog on touch
  devices) is in `main.js` — the kick cycle must stay touch-only (on desktop
  Chrome it runs past the gesture and the resume gets rejected).

## Voice types (`buildVoiceForEngine`, voices.js)

| engine type   | class            | notes |
|---|---|---|
| `plaits`      | `PlaitsVoice`    | 4-voice round-robin pool of Plaits WASM oscillators. `modLevelPatched=1, modLevel=0` at init (without the zero, empty tracks emit a continuous tone). Glide via ramp on `noteAudioParameter`. The four sliders keep the hardware's generic names across all 16 models; what each does per model is `PLAITS_MACRO_TIPS` (catalog.js), hung on the fields by `updatePlaitsControlsVisibility`. |
| `drum-synth`  | `DrumSynthVoice` | Recipes via `buildDrumSynthGraph(kind, output)`: 808/909 kit, poly-saw, fm-bell, pad, plus the emulators (below). All Tone.js except the 303 and the Virus, which are AudioWorklet models (`tb303.js`, `virus.js`). |
| `sampler`     | `SamplerVoice`   | THE unified sample voice — plays a user upload or a bundled kit sample chosen via `track.sampleSource` ({kind:"upload"|"bundled", ...}). Absorbed the old `SampleVoice`/`UploadVoice`/`ElevenVoice`. Per-step region/fade/loop via `startSampleSource`; slicing via `t.slices`/`sliceOn`. Pitch from `pitchBase` (36 drum-kit, 60 otherwise); `t.pitchLock` keeps 1×bpm fits pitch-true. |
| `custom` / `saved` | `CustomToneVoice` | Tone.js synth tree from a saved-patch JSON config (`saved:<name>` keys, localStorage). |
| `granular`    | `GranularVoice`  | Granular sampler (`dm:granular`, "texture" group). See the granular section below. |
| `wavetable`   | `WavetableVoice` | Multi-frame AKWF wavetable synth (`wt:akwf`), morphable, editable in `wavetableEditor.js`. |
| `midi`        | `MidiVoice`      | Web MIDI out; converts audio time → DOMHighResTimeStamp for `output.send`. |

Voice interface: `hit(midi, time, dur, vel, opts?)`, `setParam`,
`getAudioParam`, `setEngine`, `canInPlaceChange`, `getOutputNode`,
`setDestination`, `silence`, `dispose`. Legacy engine keys (`smp:*`, `upload`,
`eleven`) are migrated to `sampler` in `session.js` on load.

## Emulators (`"Emulators"` optgroup)

All engine type `drum-synth`. The five Tone.js analog-mono presets are each
wrapped in `makePolyPool(size, buildOne)`; the 303, the Virus, the DX7, the
guitar and the bass are the odd ones out — AudioWorklet models that handle their
own voicing (the 303 is mono like the machine, the rest polyphonic). See their
sections below. The guitar and bass keep their old pluck builders in voices.js
(`buildPluckGuitarVoice` / `buildPluckBassVoice`) purely as worklet fallbacks.

| key             | builder               | pool | character |
|---|---|---|---|
| `dm:303`        | `buildTb303Voice`     | mono | TB-303 circuit model, AudioWorklet (`tb303.js`) |
| `dm:virus`      | `buildVirusVoice`     | 8 (internal) | Access Virus architecture, AudioWorklet (`virus.js`) |
| `dm:dx7`        | `buildDx7Voice`       | 16 (internal) | Yamaha DX7, 6-op FM, AudioWorklet (`dx7.js`) |
| `dm:mini-brute` | `buildMiniBruteVoice` | 4 | saw + ultrasaw + PWM pulse + metalized tri + sub, Brute Factor |
| `dm:moog`       | `buildMoogVoice`      | 4 | 3 osc w/ wave + range selects, ±7-semi osc2/3, noise |
| `dm:juno`       | `buildJunoVoice`      | 6 | DCO + sub + noise → HPF → baked-in chorus |
| `dm:guitar`     | `buildGuitarVoice`    | 6 (internal) | electric guitar rig, AudioWorklet (`guitar.js`) |
| `dm:bass`       | `buildBassVoice`      | 4 (internal) | electric bass rig, AudioWorklet (`bass.js`) |
| `dm:rhodes`     | `buildRhodesVoice`    | 6 | electric piano |
| `dm:prophet6`   | `buildProphet6Voice`  | 6 | poly analog |

`makePolyPool` exposes `trigger` (round-robin) / `release` / `setGlide` /
`setParam` (broadcast) / `getAudioParam` (voice 0 only — LFO mod hits voice 0,
chord tones on other voices play the baseline; same limitation as
`PlaitsVoice`). The stock harm/timb/morph/decay sliders are relabeled
per-engine by `updatePlaitsControlsVisibility`.

## TB-303 (`dm:303`, `public/js/tb303.js`)

A model of the machine's circuits, not a saw-through-a-lowpass preset. It runs
as an AudioWorklet because none of it is expressible in native nodes: Web Audio
has no 3-pole filter, no way to put a saturator inside a filter's feedback path,
and no sample-accurate way to run an envelope into a cutoff.

```
VCO ──▶ VCF (3-pole diode ladder, 18 dB/oct) ──▶ VCA ──▶ out
         ▲                                       ▲
         │  MEG × ENV MOD                        │  ACCENT
         └── accent sweep (RC, resonance-fed) ────┘
```

- **Filter** — three one-pole TPT stages with asymmetric (diode) soft clipping
  in the feedback path, 2× oversampled, decimated through a 2-pole Butterworth.
  18 dB/oct, no key tracking, and the passband loses level as resonance climbs
  (only partially compensated — that thinning is the 303).
- **Accent** is one circuit doing three things: louder note, MEG decay forced to
  a fixed 200 ms, and a charge into an RC network whose time constant tracks
  RESONANCE — so consecutive accents at high reso stack instead of resetting.
  Driven by **step velocity** (accent ramps in above 0.6).
- **Slide** — a note slides when the step before it was written longer than one
  step and this one lands as that gate ends. Pitch lags ~60 ms (linear in
  pitch, it's a CV lag) and the envelopes are *not* retriggered. Untied steps
  get the machine's short gate (60% of the step), which is why the part reads
  clipped rather than legato. The transport passes the written span in the hit
  `opts` (`{span}`) for this.
- **Controls** — the four timbre sliders are CUTOFF / RESONANCE / ENV MOD /
  DECAY (real `AudioParam`s on the worklet node, so LFO + automation work
  normally). `sq-param-group--tb303` carries wave, accent depth, and tuning
  (`wave303` / `accent303` / `tune303` in `t.params`).
- **Mod + automation for those three** — accent and tune are AudioParams too,
  reached under their own keys and gated to `dm:303`: LFO `tb303_accent` /
  `tb303_tune` (`LFO_KEYS` + `LFO_LABELS` + `LFO_AMP_SCALE` in constants.js,
  `getModTarget` + `canModulate` in lfo.js, `getAudioParam` in tb303.js), and
  automation `tb303.accent` / `tb303.tune` / `tb303.wave`. Tune's lane spans
  the slider's own ±50 cents. Wave has no AudioParam — the lane flips it at
  0.5, written to the live voice so the track's select stays put (same
  convention as `gran.*` and `wt.scan.*`).
  Note ACCENT is a *depth*: it scales an accent the step already has from its
  velocity, so it does nothing on unaccented steps — as on the machine.
- **Loading** — the processor source is a string in `tb303.js`, registered from
  a Blob URL so it travels with the module graph (no extra fetch, no coupling to
  the `public/e/<sha>/` asset versioning). `loadWorklet()` in transport.js
  registers it alongside Plaits; a failure is swallowed and `buildVoiceForEngine`
  falls back to a Tone.MonoSynth so the track is never silent.

## Access Virus (`dm:virus`, `public/js/virus.js`)

The Virus is a digital synth, so the model is of its architecture, not its
circuits — there aren't any. Four things define it:

```
osc1 ─┐                    ┌─ FILTER 1 (multimode, 2 or 4 pole) ─┐
osc2 ─┤                    │              │                      │
sub  ─┼─ mix ─▶ routing ──▶┤            SAT stage                ├─ bal ─▶ VCA ─▶ L/R
noise─┤                    │              │                      │
ring ─┘                    └─ FILTER 2 (multimode, 2 pole) ──────┘
```

- **Two multimode filters** (LP/HP/BP/BS each) in series, parallel or split
  across the stereo field, with BALANCE crossfading their outputs. Both are TPT
  state-variable filters — one structure, all four responses. Filter 1's 4-pole
  mode cascades two SVF stages; **each carries `sqrt(Q)`, not the full Q**, or
  the peaks multiply and the resonance doubles in dB.
- **A saturation stage between them** (9 curves, off → rate reducer), which is
  where the hardware puts it: filter 2 tidies up what the saturator did.
- **A continuous shape morph**, sine → tri → saw → pulse, all four derived from
  one phase accumulator so the crossfades stay coherent. polyBLEP on saw/pulse.
- **Unison to 8** with detune and stereo spread — the hypersaw.

- **Polyphony lives inside the processor** (8 voices, steal-quietest), not in
  `makePolyPool`. That's a real gain: a pool exposes only voice 0's params to
  modulation, while one node with one param set modulates the whole instrument.
- **Control blocks** — envelopes, cutoff and filter coefficients update every 16
  samples, so `tan()` runs at 3 kHz rather than per sample. Note events are
  handled at block boundaries (≤0.33 ms late, never early).
- **Controls** — the four timbre sliders are CUTOFF / RESONANCE / SHAPE / DECAY;
  the shared osc1..osc4 sliders are osc1 / osc2 / sub / noise; the rest live in
  `sq-param-group--virus` as `VIRUS_NUM_KEYS` / `VIRUS_SEL_KEYS` (render.js and
  session.js walk those lists, as they do for granular).
- **Mod + automation** — LFO `virus_*` and automation `virus.*`, gated to
  `dm:virus`, all real AudioParams: every numeric control on the panel is
  reachable, envelope and osc detail included (the k-rate ones take a connection
  and a ramp fine — the value is sampled once per control block). `virus_cut2` /
  `virus_envamt` are bipolar and `virus_osc2semi` spans ±24 semitones, so their
  automation lanes map through their own range, not 0..1. One key doesn't match
  its param: `virus_sat` is the saturation *amount*, `vsatamt` on the voice
  (`vsat` is the curve select), aliased in `getModTarget` /
  `applyAutomationAtStep`.
- **Resonance is cubed** (`0.7 + reso³·12`). `timb` defaults to 0.5 for every
  engine, and a squared curve put that default far too resonant.
- **Noise is squared** for the same reason: `osc4` defaults to 0.4 everywhere,
  and linear noise at 0.4 hisses over the patch.
- Simplifications, stated in the file too: unison copies share their note's
  filter pair; the morph crossfades four classic waves rather than walking the
  Virus's 64 spectral wavetables; no oversampling, so the saturator aliases (as
  the hardware's does); cutoff keyfollow is fixed at 33%.

## Yamaha DX7 (`dm:dx7`, `public/js/dx7.js`)

Six sine operators through one of 32 fixed algorithms. No filter, no sub, no
analogue anything — the instrument *is* the routing plus the levels.

```
op6 ─▶ op5 ─▶ op4 ─▶ op3 ─┐          (alg 1: two stacks, ops 1 and 3 audible)
              op2 ─▶ op1 ─┴─▶ out     feedback: op6 into itself
```

- **The algorithm table is decoded, not remembered.** The 32 wirings come from
  the bit-encoded table in Dexed's `fm_core.cc` (Apache 2.0), decoded once into
  the adjacency list at the top of the processor source: per operator, who
  modulates it; which are carriers; and the feedback path's `[source,
  destination]` (the same operator except algorithms 4 and 6, whose loops span
  three and two operators). Operators always run **6 → 1**: in every algorithm a
  modulator has a higher number than its target, so one pass per sample is
  enough.
- **Output level is exponential** (`2^((lvl-1)*7)`): half the slider is a
  sixteenth of full scale. That law is most of what makes programming an FM
  synth feel like an FM synth, and it's why the useful range is all at the top.
- **Per-operator envelopes** are what make it an instrument rather than a
  spectrum — a modulator decaying under a sustaining carrier is a struck sound.
  Modulator decay/release scale with the `morph` macro, carriers' with `decay`,
  so which macro an operator follows depends on the current algorithm.
- **Key scaling and velocity go to the modulators**, not the amplifier: playing
  harder raises the modulation index (brighter, not just louder) and playing
  higher lowers it (or the top octave screams).
- **Controls** — the four track sliders are BRIGHT (master modulation index) /
  FBK (feedback) / MOD DEC / DECAY. Everything else is `sq-param-group--dx7`:
  three global rows plus a 6×8 operator grid (level, ratio, fine, detune, and an
  ADSR each) with a ratio/fixed select per operator. The osc-mix row is hidden —
  a DX7's six operator levels live in the grid.
- **One list, three namespaces.** Every control is `d` + a short key, and that
  short key spells its LFO target (`dx7_<short>`) and its automation lane
  (`dx7.<short>`) — so `d3lvl` / `dx7_3lvl` / `dx7.3lvl` are one control.
  `DX7_MOD_KEYS` in dx7.js generates all 56 of them, and `constants.js`,
  `automation.js` and `paramTargets.js` map over it rather than listing them.
  `DX7_MOD_RANGE` gives each its span, so a ratio lane sweeps 0..31 and a detune
  lane ±7. Adding a control is one entry in `DX7_OP_CTLS` / `DX7_GLOBAL_CTLS`
  plus its markup column.
- **The panel markup is generated** in `app/studioMarkup.ts` (`DX7_PANEL`) — 54
  hand-copied inputs differing only by operator number is a typo waiting to
  happen. The algorithm and voice dropdowns ship **empty** and are filled at
  runtime by `renderTrack` from `DX7_ALG_LABELS` / `DX7_PRESET_NAMES`, so the 32
  diagrams live only in dx7.js. Ranges and defaults in the markup must match
  `DX7_DEFAULTS`.
- **`refreshDx7Algorithm`** (params.js) redraws the carrier / feedback markers on
  the operator rows when the algorithm changes — the panel is the same six rows
  in every wiring, so those markers are the only thing saying what a row means.
  Called from `updatePlaitsControlsVisibility`, so engine switch / session load /
  patch apply all cover it.
- **Presets** (`dx7Preset(name)`) return a *complete* set of panel params plus
  the four track sliders, so nothing of the previous voice survives a load.
  They're in the spirit of the machine's own, not its ROM (which is 155-byte
  sysex of controls this panel doesn't have).
- **Loading** — same Blob-URL registration as the 303 and the Virus, from
  `loadWorklet()` in transport.js; a failure falls back to a Tone `FMSynth`
  (two operators, one algorithm) so the track is never silent.

## Electric guitar (`dm:guitar`, `public/js/guitar.js`)

Not a pluck through a distortion box — the whole chain, because on a guitar the
chain *is* the instrument:

```
STRING ──▶ PICKUP ──▶ tone pot ──▶ AMP ──▶ CAB ──▶ air ──┐
(six)      (position   (on the      (gain   (speaker)     │
            + LC peak)   guitar)     stack)      ▲        │
                                                 └─ feedback ─┘
```

- **The string is a waveguide** — a delay line one period long with a damping
  filter (highs die first, which is why a guitar note gets duller as it rings),
  two allpasses for stiffness/inharmonicity, and a fractional-delay allpass so
  it's actually in tune. Measured at ≤1.2 cents across four octaves; the
  compensation for the loop filters' own phase delay in `retune()` is what buys
  that, and removing it makes the whole instrument play flat.
- **The pluck is a noise burst combed at the pick position**, which is the
  difference between picking over the neck and by the bridge. The pickup combs
  it again on the way out and adds its own LC resonance (single 6.2kHz /
  humbucker 3.1kHz / p90 4.4kHz — that peak is what you hear when you flick the
  selector, not the coil count).
- **Amp**: asymmetric first stage → tone stack → second stage → presence in the
  power-amp loop → soft clip into a sagging supply. Five models (clean / tweed /
  brit / hi-gain / jazz) differing in gain, bias, stack frequencies and voicing.
  Drive is **exponential** (`0.7·g^drive²`) because a gain pot is.
- **Cab**: four biquads, five cabs. It's the biggest filter in the chain.
- **BLOOM is real feedback**: a delayed, bandpassed copy of the cab output is
  injected back into each *gated* string, scaled by that string's own envelope.
  That gating makes it a **threshold** rather than a switch — below it the
  injection is smaller than the string's losses and the note decays, above it
  they swap over and the note grows into a howl. Gated-only, or a bloomed note
  would ring for the rest of the session. `bloom` is cubed (morph defaults to
  0.5 on every engine and a rig that howls on load would be a joke).
- **Controls** — the four sliders are DRIVE / TONE (the knob on the guitar, a
  passive lowpass 700Hz→open) / BLOOM / SUSTAIN. The rest is
  `sq-param-group--guitar`: string row, amp row, cab row, plus the tone dropdown.
- **One list, three namespaces**, as in dx7.js: every control is `gt` + a short
  key, which spells its LFO target (`gtr_<short>`) and its automation lane
  (`gtr.<short>`). `GUITAR_NUM_CTLS` generates all of them and constants.js /
  automation.js / paramTargets.js map over `GUITAR_MOD_KEYS` rather than listing.
  `GUITAR_MOD_RANGE` gives each its span (pick/pickup position are 0.02..0.5).
- **The famous tones** (`guitarTone(name)`) return a *complete* set of params
  plus the four sliders. Named for what they sound like, with a one-line
  description shown beside the dropdown and in the status bar. The panel markup
  is in `app/studioMarkup.ts` (`GUITAR_PANEL`) and the dropdown ships **empty** —
  `renderTrack` fills it from `GUITAR_TONE_NAMES`, so the tones live only here.
- **Loading** — same Blob-URL registration as the 303/Virus/DX7 from
  `loadWorklet()`; a failure falls back to `buildPluckGuitarVoice` (the old
  PluckSynth voice, still in voices.js) so a track is never silent.

## Electric bass (`dm:bass`, `public/js/bass.js`)

guitar.js's sibling — same waveguide, wound and stiffer — with the four things
that make a bass its own instrument:

```
STRING ──▶ PICKUP ──▶ tone ──┬── clean (lows, kept clean) ──┐
(four)                       ├── dirt (highpassed, clipped) ┼─▶ COMP ─▶ AMP ─▶ CAB
                             └── sub octave (tracked) ──────┘
```

- **The dirt is parallel and highpassed.** Distorting a bass whole makes the
  fundamental intermodulate with everything above it and the low end vanishes,
  so GRIND only works above XOVER and the clean lows go back underneath.
- **There is always a compressor**, and it gets a track slider (`morph`) rather
  than a corner of the panel: threshold down and makeup up together, so it's one
  "more compression" control.
- **Fret buzz is a one-sided clip inside the string's own loop** (the fretboard
  is only on one side of the string). Wound up with the hand control at the top,
  that *is* slap.
- **Round vs flat** (`bsstrs`) scales the loop damping, the excitation
  brightness and the dispersion together — flats lose their highs at once and
  have far less clank.
- The octaver is a tracked oscillator following the string's envelope, not a
  flip-flop divider, so it never glitches (a real one does).
- **Controls** — DRIVE / TONE / COMP / SUSTAIN plus `sq-param-group--bass`
  (hand row, dirt row, amp+cab row). Keys are `bs` + short key → `bas_<short>` /
  `bas.<short>`, generated from `BASS_NUM_CTLS`. Four amps (di / flip-top / svt /
  gk), five cabs, three pickups. Tones via `bassTone(name)`; panel markup is
  `BASS_PANEL` in `app/studioMarkup.ts` with the dropdown filled at runtime.
- **Loading** — as above; falls back to `buildPluckBassVoice`.

## Granular (`dm:granular`, `GranularVoice` in voices.js)

Every note sprays a cloud of Hann-windowed grains read from `track.uploadBuffer`.
Macros: harm = grain size, timb = density, morph = play position, decay = spray.
The `sq-param-group--granular` row (and the same controls inside the WAV modal)
carries `gplay, gspeed, gpitch, gloop, gwindow, gjitter, gdetune, gpan,
gpattern, gsync, grate` in `t.params`.

- **speed / pitch are independent** — `gspeed` is the play-head rate as a plain
  multiplier (−2…2, 0 freezes, negative scans backwards; only meaningful in
  `gplay: "moving"`, so the slider greys out in fixed mode via
  `updateGranularSpeedEnabled`). `gpitch` transposes every grain ±24 semitones
  without changing how fast the sample plays through.
- **`gspeed` changed format** — it used to be a 0..1 slider meaning 0..2×. New
  ranges overlap the old, so serialized blobs carry a `gspeedV: 2` marker
  (`stampGranularParams` on write, `migrateGranularParams` on read).
- **`gwindow` is a fraction of the sample, not seconds** — `_windowFrac()` is the
  one place that relation lives; 100% spans the whole sample whatever its
  length, and the WAV modal's band + resize drag both invert that same function.
- **Mod + automation** — speed, pitch, window, jitter, detune and pan, as LFO
  `gran_*` (setter-driven, `GRAN_LFO_PARAM` maps key → param) and automation
  `gran.*` (`gran.window` → `gwindow`, mechanically). Both map 0..1 across the
  slider's range via `granFromUnit`/`granToUnit` — `GRAN_MOD_RANGE` holds every
  range, including the plain `[0, 1]` ones so there's one code path — and write
  the live voice only, never `t.params`, so the slider stays the base. Grains
  read them when scheduled, so a sequenced note takes one value per hit; a held
  note re-reads per scheduler tick.

## Data model (source of truth: `public/js/types.js`)

### Pattern (per track, 32 slots — every field a per-step parallel array)

`steps, lengths, notes, velocities, chords, offsets, arps, arpRates,
arpRanges, arpDirs, complexities, ratchets, sampleStarts, sampleEnds,
sampleFadeIns, sampleFadeOuts, sampleLoopModes, extraNotes, extraLengths,
automation`

- `extraNotes`/`extraLengths` — stacked polyphony per step (from the piano
  roll), on top of the chord/root.
- `automation` — `{ [targetKey]: {enabled, values: number[]} }` per-step
  parameter automation (see `AUTOMATION_TARGETS` in automation.js).
- `soundLocked` / `sound` — p-lock: whether this track's sound is locked to this
  pattern, and the sound itself if so. Unlocked patterns share the track's
  `baseSound` (see the p-lock section below).

`aliasPattern(t, idx)` rebinds `t.steps`/`t.notes`/etc. to reference
`t.patterns[idx].*` directly, so UI mutations flow straight into the pattern.
Switching patterns = re-aliasing + re-render.

### Track (`state.tracks[]`) — highlights beyond the aliased pattern fields

`id, name, engineKey, length, accents(Set)`, flags `muted/soloed/isDrumKit`,
`baseSound` (the sound every unlocked pattern shares),
`glide, swing, density, speed` (`density` is the
dice button's fill level — how full `randomizeMelody` rolls; drag the dice
up/down, painted by `paintDiceDensity`),
`sampleSpeedMode ("native"|"1xbpm"), sampleDefaults, sampleSource, slices,
sliceOn, sliceBase, slicePlayMode, pitchLock`, sound config
`params/filter/eq/comp/lfoConfig/fxConfig` + live handles
`filterNode/eqNode/compNode/fxRack/lfos/voice/meterAnalyser`,
`midi {outputId, channel}`, `patterns[32]`, `el`, legacy
`uploadAudio/elevenAudio` (base64-persisted sample payloads).

### Global `state`

`tracks, playing, tick, repeatId, nextId, metronome, noteColors,
currentSetName, audioCtx, ready, masterGain, masterLimiter, masterAnalyser,
midi, scale {active, root, mode}, activePattern, patternMode
("repeat"|"chain"), patternSwitchMode ("immediate"|"finish"), queuedPattern,
patternRepeats[32], patternMeters[32] ({num,den} time signatures),
chainBarCount` — plus runtime slots added by the unlock architecture
(`woscLoad, _keepAlive, _outputRunningSince`).

## Transport

Single `Tone.Transport.scheduleRepeat` at `"16n"`. Each callback, per track:

1. Accumulate `t.speedAccum += t.speed`; while `≥ 1`, fire a step (per-track
   tempo multiples / polymeter).
2. Every step (even silent ones) runs `runAutomationForStep(t, idx, ...)`.
3. Per firing step: chord tones (with complexity/inversion) + piano-roll
   `extraNotes`, arp expansion, master swing + per-step offset → `hitTime`
   (clamped to `now + 0.002`), filter env, then `voice.hit(...)` per tone.
   A note plays for its written step length. Ratchet
   retriggers 1–8× when no chord. Sampler opts carry region/fade/loop/
   pitchBase/pitchLock/sampleSpeedMode.
4. Visuals: `Tone.Draw.schedule` at `time + visualOutputLatency()` (playhead +
   beat indicator). Metronome fires on quarters when enabled.
5. Bar boundaries: manual-queue commit (`patternSwitchMode === "finish"`) and
   chain-mode advance honoring `patternRepeats` / `patternMeters`.

Stop cuts masterGain to 0 over 20ms (Tone's ~100ms lookahead keeps already-
queued native events playing otherwise) and silences all voices. The gain then
**stays down until something asks for it back** — `wakeMasterBus()`, which the
computer keyboard calls on every note. It can't be restored on a timer: silencing
a voice *releases* it, so a long-release patch fades back in over the top of the
silence you just asked for (measured: a pad still audible a second after stop).
And it can't be left down until the next start either, which is what it used to
do — the keyboard plays through the same bus, so every key was silent once you'd
pressed stop. `Tone.Transport.start(lead, 0)` with the explicit 0 offset
is the canonical rewind (avoids Tone 15's stop/cancel/position bugs).

## Knobs (`knob.js`) — a skin over the range inputs

Every parameter is a native `<input type=range>` — ~180 in the markup, and
`#track-template` is cloned per track, so a six-track session has **1063** of
them live. They were wired in a hundred places, read back by class, resolved
from the DOM by the right-click menu, and written to directly with no event. So
they stay. `upgradeKnobs(root)` wraps each one, hides it, and draws a knob over
it; the input is still the value, the focus target and the pointer target.

- **Nothing else knows.** `setParam` / `setFilter` / `setEQ` and the fx
  `applyX()` closures still hear their own `input` events (the knob dispatches
  one, the `attachBpmDrag` idiom); `targetsForControl` still matches the
  input's class; `refreshParamIndicators` still finds the same `.sq-field`
  wrapper; the parameter menu still walks from a right-click down to the input.
- **The `value` accessor is shadowed per element**, and that is the
  load-bearing bit. `syncTrackSoundUI`, `refreshFxPanelUI`, the DX7 / guitar /
  bass panel syncs, `applyPatternSound` and `applySet` all assign straight to
  `.value` without dispatching, because until now nothing was listening.
  Shadowing means none of those call sites changed and none can be forgotten.
- **The drag is what makes it playable**, not the shape: grab anywhere on the
  body, the value doesn't move until the pointer does (a native range jumps to
  your click — fatal on a control you play), travel is unbounded at 140px for
  the full range, and resolution falls off with horizontal distance so one
  gesture does both the sweep and the trim. No modifier needed, so fine mode
  works on touch too; Shift also forces it.
- Wheel, double-click-to-default, and — on touch — **long-press opens the
  parameter menu**, re-raised as a `contextmenu` event so `paramMenu.js` does
  the work unchanged. That is the only route to LFO / automation / macro
  assignment on a phone.
- **JS writes two custom properties and knows nothing about circles**:
  `--knob-v` (0..1) and `--knob-a` (the same as an angle). All the shape is in
  `style.css`, so a rack that reads badly as dials becomes bars by overriding
  one selector. Paints are rAF-batched through a dirty set, so a macro pad
  sweeping twenty parameters costs one frame, not twenty.
- **Sizing is `--knob-size` per context** (44px volume, 36px timbre, 26px in the
  DX7 operator grid), and `--knob-hit` guarantees a **≥44px target wherever the
  layout has gone mobile** even when the dial is drawn smaller — keyed on
  `(any-pointer: coarse), (max-width: 768px)`, because a touchscreen laptop and
  a phone-width layout both need fingers' room.
- `KNOB_EXCLUDE` keeps the wavetable's 16 harmonic bars as sliders: side by side
  they *are* the waveform, and a row of little dials would say nothing.
- Called from `renderTrack`, from every modal that builds controls
  (`stepEditor.js`, `wavetableEditor.js`), from `buildLfoRow`, and once over the
  document in `init()`. Idempotent.

## Modulation: LFO vs automation vs macro (three systems)

- **LFO** (`lfo.js`, mod panel): audio-rate, targets real `AudioParam`s /
  Tone Signals via `getModTarget(t, key)`. `LFO_KEYS` covers voice params,
  cutoff/reson, and every FX wet + sub-param; FX sub-params without an
  AudioParam handle are driven by a rAF setter loop (`SETTER_LFO_KEYS`).
  `canModulate(t, key)` gates the picker per engine.
- **Automation** (`automation.js`, aut panel): per-step value lanes stored in
  the pattern (`automation` field), applied at step time via `setParam`-style
  setters. `canAutomate` is broader than `canModulate` since it doesn't need
  an AudioParam.
- **Macro pads** (`macro.js`): an XY surface you play, driving a list of
  parameters per axis that may span tracks. See the macro-pads section below.

**One owner per parameter.** A parameter takes an LFO, an automation lane or a
macro axis — never two — because they write the same `AudioParam` from
different schedules and whichever ran last wins until it lets go, which reads
as one of them randomly dropping out. The namespaces don't share a spelling
(the delay wet slider is `delay` to the LFO and `fx.delay` to automation and
the macro), so the pairing lives in `paramTargets.js` (`CONTROL_TARGETS` →
derived `AUTO_FOR_LFO` / `LFO_FOR_AUTO` / `CLASS_FOR_AUTO`, plus `autoOwns` /
`modOwns` / `hasMacroOn`). Every picker filters on it, and the parameter menu
says which side holds the control.

**Right-click a parameter** opens `paramMenu.js`: what the control does, its
LFO row, its automation lane and its macro assignment — the same widgets the panels use
(`buildLfoRow` / `buildAutomationLane` in render.js), over the same track state
— plus a way to attach whichever side is free. One delegated `contextmenu`
listener installed from `init()` covers every track; it resolves the control
with `controlFromEventTarget` and the owning track with `trackForControl`
(both in paramTargets.js, shared with the macro pads' learn mode so the two
agree on what counts as touching a parameter), walking up to a
`data-track-id` (stamped on the track node, every
panel, every synth group, and the granular / wavetable / sample modals — panels
get reparented into modals, so track ancestry isn't reliable).

Which controls get it: any range/select/checkbox that's either in
`CONTROL_TARGETS` or inside `PARAM_SCOPE_SELECTOR` — the synth groups, the
filter/env/fx/eq/comp panels, and the engine modals' own control rows. That
whitelist keeps it off the sequencer's widgets (step editor, piano roll, the
mod/aut rows themselves) and off text/number fields, which keep the browser's
own menu. A control with no target still opens the menu as a **setting** — one
line saying so, plus the description, because "what does this do" is worth a
right-click on its own.

**The dot beside a label** — `refreshParamIndicators(t)` (paramTargets.js)
stamps `data-motion="mod" | "aut" | "off"` on each control's field wrapper, and
style.css paints a dot from it (accent / accent-2 / dim). It walks the DOM under
every `[data-track-id]` root rather than a fixed control list, so a parameter
that appears twice (the granular row and the wav modal both have speed) lights
up in both. Call it after anything that changes `lfoConfig` or `automation` —
renderTrack, both panels' add/remove/toggle paths, the parameter menu's `draw`,
and `switchPattern` (lanes belong to the pattern, so the dots change with it).

Adding a control to the menu: a `CONTROL_TARGETS` entry keyed by the class the
markup already uses (or nothing at all, if it's inside a scope and has no
target), plus `PARAM_DESCRIPTIONS` / `CONTROL_LABELS` lines where the DOM has
nothing to read. Lookup order for both is class entry → markup `title` →
target-key entry, so the per-engine tooltips (rewritten by
`updatePlaitsControlsVisibility`) win over anything generic.

## Macro pads (`macro.js`) — a Kaoss pad for the whole session

Several XY pads, each axis driving a list of parameters that **may span
tracks**. That crossing is the point: one thumb opening the bass filter while
ducking the lead's reverb is a move neither the mod matrix nor the automation
lanes can make, because both of those belong to a single track.

```
pad "sweep"   X -> bass · filter cutoff      Y -> lead · reverb wet
                   drums · crush                  pad  · delay fbk
```

- **Assignments speak the automation namespace** (`AUTOMATION_TARGETS`), which
  is the superset — `canAutomate` is broader than `canModulate` because it
  doesn't need an AudioParam — and `applyAutomationAtStep` already knows how to
  write every one of those keys with a short ramp, which is exactly what a pad
  wants. A pad move is one call per assignment into code that already existed.
- **The knobs move.** An LFO deliberately writes around the slider and leaves it
  as the base, because you aren't looking at an LFO. A pad is a control you
  stare at while playing it, so the assigned knobs sweep — the pad writes
  `input.value` (repainting via the knob's shadowed accessor) without
  dispatching, so a momentary move never reaches the stored sound.
- **Momentary is non-destructive by snapshot, not by avoidance.** Rather than
  route around the branches of `applyAutomationAtStep` that write `t.params` /
  `t.filter`, the pad records where every assigned parameter was on
  `pointerdown` and ramps back on release. **Latch** instead commits, by
  dispatching each control's ordinary `input` event — which is precisely "as if
  you had moved the knobs", so the patch, the p-lock snapshot and a save all
  see it.
- **Two ways to assign**: the right-click parameter menu (a third section
  beside the LFO and the lane), and **learn** — arm an axis, then touch any
  control. Learn puts `is-learning` on the overlay so the backdrop stops eating
  pointers and the panel drops out of the middle of the screen; without that
  there is no way to reach the control you're assigning.
- **Persistence**: `state.macroPads`, serialized beside `bpm` / `scale` /
  `patternMeters`. Assignments are stored **by track index**, not `t.id` —
  `createTrack` hands out fresh ids on every load, so ids don't survive. Live
  state keeps the id, so removing a track can't silently repoint an assignment.
- Pads are **global and not p-locked** on purpose: a performance macro that
  rearranged itself at every pattern switch would be unplayable.
- `CLASS_FOR_AUTO` (paramTargets.js) is the automation key → control class map
  the pad uses to find the slider behind a parameter, both to read the base it
  returns to and to move the knob. All 162 automation keys resolve.

## p-lock — a sound per pattern (`patternSound.js`)

Normally a track has one sound and 32 patterns of notes: move the cutoff and it
moves in all of them. **p-lock is per track AND per pattern** — the button lives
on the track, its state lives on the pattern you're on. So the bass can have its
own sound in the chorus while the verse and the middle eight go on sharing the
track's.

```
bass   pattern 1  unlocked -> t.baseSound   \ these two move together
       pattern 3  unlocked -> t.baseSound   /
       pattern 2  LOCKED   -> t.patterns[1].sound
```

- **Two stores, one live state.** `t.params` / `t.filter` / `t.eq` / `t.comp` /
  `t.fxConfig` / `t.lfoConfig` stay the one truth every other module reads.
  `switchPattern` writes the live sound back to whichever store owns the pattern
  being left (`p.sound` if `p.soundLocked`, else `t.baseSound`) and reads
  whichever owns the one being entered. Editing on an unlocked pattern is
  therefore editing the shared sound — that's what makes them move together.
- **The recall is diffed, and that's load-bearing.** Chain mode advances patterns
  at bar boundaries *inside the transport's scheduler callback*. Applying every
  parameter each time would re-register ~130 LFOs and regenerate the reverb IR
  every bar. Only what differs is touched: measured at +0.2ms over the unlocked
  baseline when two patterns share a sound, +2.5ms when they differ. The reverb
  decay only reaches `applyReverb` when it really moved (it rebuilds the IR).
- **Only enabled LFO entries are stored.** The mod matrix has an entry per target
  whether used or not; keeping all of them made a snapshot 12.9KB, so 32 patterns
  of one track was 0.4MB of a session that has to fit in a share link. Pruned
  it's 2.3KB. A key absent from a snapshot means *not modulated*, so
  `applyPatternSound` walks the **live** matrix and falls back to
  `defaultLFOConfig()` — otherwise an LFO from the outgoing pattern would keep
  running under the incoming one.
- **The toggle round-trips.** Locking keeps the sound you can hear, or restores
  what this pattern had if it was locked before. Unlocking hands the pattern back
  to `baseSound` but *keeps* its snapshot. There's no undo in this app, so
  neither direction may destroy anything.
- **The button state belongs to the pattern**, so it changes under you on a
  switch — `switchPattern` calls `refreshAllPatternLockUI()`.
- `serializeSet` calls `flushAllPatternSounds()` first: a sound is only written
  back when you *leave* a pattern, so without the flush the sound you can
  currently hear is the one thing a save would miss.
- `clonePattern` copies `soundLocked` and deep-copies `sound`, so duplicating a
  locked pattern (button or drag) gives a locked duplicate that sounds the same
  and then diverges.

## Keyboard performance mode (`keyboard.js`)

Always live on desktop (≥769px; text inputs swallow keys). Ableton-style:
`a s d f g h j k l` = white keys, `w e t y u o` = black keys, `z/x` octave.
Scale-aware mapping when a scale is active; chord mode (off/root). Live
record onto the playing pattern, plus retroactive **Capture** (32s rolling
buffer, slices back to the last 1.5s silence gap and writes a clip).

## Server / data surface

| surface | what |
|---|---|
| `POST/GET app/api/share/route.ts` | anonymous `?s=<slug>` share links (public `songs` rows) |
| `app/songs/actions.ts` | `saveSong` (autosave upsert), `saveNamedSong`, `listSongs`, `loadSong`, `forkSong` |
| `app/patches/actions.ts` | `publishPatch`, `listMyPatches`, `listPublicPatches`, `getPatch`, `deletePatch` |
| `app/profile/actions.ts` | `getMyProfile`, `updateProfile`, `getPublicProfile` (+ that user's public songs/patches) |
| `app/auth/actions.ts` | `signIn`, `signUp`, `signInWithMagicLink`, `signOut` |
| `app/account/actions.ts` | `updateEmail`, `updatePassword`, `deleteAccount` (RPC `delete_own_account`) |

`/u/<username>` is the public profile page with fork buttons. The engine side
of save/share lives in `session.js` (`serializeSet`/`applySet`) and is bridged
through `window.seqbaby`.

## Bounce (`bounce.js`)

Pattern or whole-session render: taps the post-limiter master into a
`MediaStreamDestination` (disconnecting the speakers so it renders silent),
records via `MediaRecorder` (webm/mp4), decodes, re-encodes 16-bit PCM WAV by
hand (`audioBufferToWav`); falls back to the raw recording if WAV encode
fails. Real-time capture — see Known limitations.

## Engines catalog (`buildEngineCatalog`)

Groups in order: `plaits` (16) · `drum / synth` (808/909 kit + poly-saw /
fm-bell / pad) · `Emulators` (303 + virus + dx7 + guitar + bass + 5 analog-mono) · `texture` (`dm:granular`) ·
`wavetable` (`wt:akwf`) · `sampler` (single unified entry) · `saved patches`
(`saved:<name>`) · `midi`. The engine key string is the source of truth.
Bundled drum kits are no longer separate engines — they live in
`BUNDLED_SAMPLES` and are picked *inside* the sampler's source picker
(legacy `smp:Kit/part` keys migrate on load).

Adding a new engine: catalog entry + voice class dispatch in
`buildVoiceForEngine` (or a `buildDrumSynthGraph` case + builder fn for
analog-mono style) + `updatePlaitsControlsVisibility` labels + tips +
`canModulate`/`voiceAutoKeysForEngine` entries + serialize/apply if it has
unique state.

**Slider tips per engine.** harm / timb / morph / decay (and the osc-mix and
osc-mod rows) are one set of controls wired to every engine, so what they do is
explained per engine as a tooltip, applied by `updatePlaitsControlsVisibility`
alongside the relabelling: `PLAITS_MACRO_TIPS` (by Plaits model index) and
`ENGINE_MACRO_TIPS` (by engine key, with `osc` / `oscMod` sub-objects) in
catalog.js, plus the 303 / Virus / granular / 808 / 909 tips written inline next
to their labels. Each entry only needs the controls its engine actually shows.
The right-click parameter menu reads these from the DOM, so the generic lines in
`PARAM_DESCRIPTIONS` are a fallback for anything not covered.

## Drum-kit flag (`t.isDrumKit`)

Auto-detected at creation (`guessIsDrumKit`), per-track toggle. Blank steps
default to C2 (MIDI 36); the sampler pitches from `pitchBase: 36` (C2
natural) instead of 60; toggling on rewrites active steps to C2 across
patterns.

## Gotchas + conventions

- **Audio init is lazy** — voices are built in `ensureAudio()` on first play
  (or the touch gate dialog). Before that `t.voice === null`; most code
  tolerates it. Everything in "Audio start / unlock" above is load-bearing.
- **Plaits `modLevelPatched=1, modLevel=0` at init** — without the zero,
  empty tracks emit a continuous tone.
- **Voice-pool LFO limitation** — `getAudioParam` returns voice 0's param
  only (pools and PlaitsVoice both).
- **`canModulate` gates the mod picker** — new mod targets need `LFO_KEYS` +
  `getModTarget` + `LFO_AMP_SCALE` + `canModulate`, and a `getAudioParam(key)`
  on the voice/builder for voice-internal params.
- **Sample audio persists as base64** on the track; decoded on load with
  `normalizeAudioBuffer` (RMS+peak normalize, optional silence trim).
- **Chord key `"7"` renamed `"dom7"`** — integer-looking keys hoist to the
  top of JS object iteration; `canonicalChord()` aliases legacy `"7"`.
- **Hidden attribute vs display** — panels/groups with `display: grid|flex`
  need the explicit `[hidden] { display: none !important }` rules in
  style.css.
- **Sidechain compressor sources** survive voice rebuilds via
  `refreshCompSourceDropdowns()`.
- **`tsconfig.json` excludes `public/js/`** — the engine is plain JS with
  JSDoc types; don't rename it to TS or import it into the Next graph.
- **Don't use `Tone.Time(...)` for the step duration.** `Tone.setContext()` at
  init leaves Tone's time helpers resolving against a different transport than
  the one the sequence is scheduled on, so `Tone.Time("16n").toSeconds()`
  answers 0.125s — the 120bpm value — at *every* tempo, while
  `Tone.Transport.bpm` reads correctly. That silently scaled note lengths,
  swing, per-step micro-timing, automation ramps and arp spans to a fixed
  120bpm (notes half the length of their step at 60bpm, overlapping the next
  one at 180). `baseStepDur` in transport.js derives it arithmetically from
  `Tone.Transport.bpm.value` instead. Anything else needing musical time should
  do the same, or use `currentBpm()` (lfo.js) as the sync helpers do.
- **Worklet processor sources are template literals** (`tb303.js`, `virus.js`,
  `dx7.js`),
  so a stray backtick or `${` inside one — including in a comment — truncates
  the string. The module still parses, `node --check` still passes, and the
  failure only shows up as a SyntaxError at engine boot. When editing inside a
  processor source, extract it and syntax-check the extracted text:
  `node -e 'const s=require("fs").readFileSync("public/js/virus.js","utf8");
  require("fs").writeFileSync("/tmp/p.js",s.match(/SOURCE = \`([\s\S]*?)\n\`;/)[1])'
  && node --check /tmp/p.js`
- **Netlify deploy-preview hash URLs are pinned to one deploy** — retest on
  the branch alias URL, not an old hash URL. A same-SHA force-push does not
  trigger a rebuild; amend for a fresh SHA.

## Adding a feature — quick map

- New FX → extend `FXRack` + `defaultFxConfig` + apply/refresh/wire fns in
  signal.js/render.js, and (optionally) `LFO_KEYS`/`AUTOMATION_TARGETS`.
- New LFO target → see canModulate gotcha above, + a `CONTROL_TARGETS` entry
  (paramTargets.js) so its control's right-click menu finds it.
- New automation target → `AUTOMATION_TARGETS` + a setter path in
  `applyAutomationAtStep`, + the same `CONTROL_TARGETS` entry.
- New per-step control → array on `emptyPattern()` + `aliasPattern()` field +
  step-editor UI + consume in the transport loop + serialize/apply.
- New per-track sound setting → if it should follow p-lock, add it to
  `capturePatternSound` / `applyPatternSound` (patternSound.js) too, or a locked
  pattern will leave it behind on a switch.
- New engine → see Engines catalog above.
- New macro-pad behaviour → `macro.js`; assignment targets come from
  `AUTOMATION_TARGETS` for free, so a new automation target is macro-assignable
  the moment it has a `CONTROL_TARGETS` entry.
- New server data → Supabase migration + server action in `app/*/actions.ts`
  + UI in the relevant `app/*.tsx`; keep the engine side behind
  `window.seqbaby`.

## Known limitations / TODO breadcrumbs

- No undo/redo.
- Voice-pool LFO only targets voice 0.
- Bounce is real-time capture (offline rendering would need rebuilding voices
  under an OfflineAudioContext, which the Plaits WASM voice doesn't support).
- Keyboard performance mode is desktop-only.
- Safari can't report output latency — visuals use the 0.18s estimate
  (`?vlat=` to calibrate).

## Deployment

Push to `main`; Netlify auto-deploys (`@netlify/plugin-nextjs`, Node 22).
Repo: https://github.com/mjoslyn/seqbaby.

### Engine asset loading (load-bearing — see also "Audio start / unlock")

- `app/EngineScripts.tsx` server-renders the Tone → woscillators → main.js
  script tags into the document so the parser starts them immediately, rather
  than injecting them after React hydrates. It uses `dangerouslySetInnerHTML`
  **deliberately**: the parser executes those scripts on a fresh page load
  (`defer` + document order honoured), while React's innerHTML assignment on a
  client-side navigation never does — so React can't insert them unordered.
  An inline marker (`window.__seqbabyServerBoot`) tells the paths apart, and
  `ScriptLoader.tsx` keeps its onload-chained injection for the soft-nav case
  (e.g. arriving from `/login`).
- `app/EnginePreload.tsx` emits `modulepreload` for all 43 modules listed in
  `app/engineAssets.ts`. The graph is 8 levels deep, so without it the browser
  needs up to eight sequential round trips just to discover the code.
  **Adding or removing a module in `public/js/` means updating that list** —
  there's a regeneration one-liner in the file's comment.
- The account bar is behind `<Suspense>` in `app/page.tsx`. Don't await
  Supabase in the page body again: it blocks the whole document, including the
  preload hints, on two sequential round trips.
- **Asset versioning**: Netlify's build exports
  `NEXT_PUBLIC_ENGINE_VERSION=$COMMIT_REF`, and
  `scripts/stamp-engine-assets.mjs` publishes `public/js`, `woscillators.js`
  and `style.css` under `public/e/<sha>/` (gitignored). `engineAsset()` in
  `app/engineAssets.ts` points every URL at that prefix, and the prefix
  propagates through the module graph for free because relative specifiers
  resolve against the importing module's URL. That's why the version is a path
  and not a `?query` — a query is dropped during that resolution and would
  reach only `main.js`. Per-deploy URLs are what make the `immutable`
  cache-control in `netlify.toml` safe on an unbundled 41-module engine.
  Unset locally, so `npm run dev` and a plain `next build` keep the bare paths
  and the edit-and-reload loop.
