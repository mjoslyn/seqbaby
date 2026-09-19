# seqbaby

Multi-engine browser step sequencer. A hand-written vanilla Web Audio engine
(Mutable Instruments Plaits via `@vectorsize/woscillators`, Tone.js drum/synth
recipes, worklet models of the silverbox / contagion / hexop plus seven
analog-mono emulators, wavetable + granular + unified sampler
engines, Web MIDI) wrapped in a thin Next.js + Supabase shell for accounts,
cloud songs, a patch gallery, and share links. 32-pattern bank with filter /
env / fx / eq / comp / mod / automation per track.

## Tech stack

- **Shell**: Next.js 15 (App Router) + React 19 in `app/`. SSRs the engine's
  static DOM (`app/studioMarkup.ts`), then `app/ScriptLoader.tsx` injects the
  engine scripts in order: `public/tone.js` (Tone.js 15, vendored) →
  `public/woscillators.js` →
  `public/js/main.js` (ES module). `middleware.ts` refreshes the Supabase
  session on every request *except* static engine assets.
- **Engine**: ~54 dependency-free vanilla ES modules in `public/js/`. No
  bundler — edit, reload. `window.seqbaby` (from `appApi.js`) exposes `state`
  and serialize/apply hooks to the React shell (typed in `app/seqbaby.d.ts`).
- **Accounts + data**: Supabase (Postgres + Auth + RLS). Tables: `profiles`,
  `songs`, `song_versions`, `patches` (see `supabase/migrations/`). Server
  actions in `app/{songs,patches,profile,auth,account}/actions.ts`. Saving an
  existing song appends to its version tree — see the song versions section.
- **Anonymous sharing**: `app/api/share/route.ts` (public songs rows);
  `lib/api.js` + `netlify/functions/share.mjs` are the legacy Netlify Blobs
  path. The link preview is `app/shareCard.ts` (one card, built in one place
  because og/twitter metadata does not inherit field-by-field between
  segments), titled with the song when the URL names one — see the share card
  section below.
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
│   ├── NewSongButton.tsx      top-bar `new`: blanks the engine, clears the open song
│   ├── DefaultTemplate.tsx    what a new song starts from, when the account named one
│   ├── VersionTree.tsx        a song's version history, drawn as the tree it is
│   ├── songs/openSong.ts      which song + version the studio holds, and whether it is a template (shared by the two save UIs)
│   ├── songs/songName.js     names a song nobody named, from what is in it
│   ├── songs/suggestName.ts  the name both save UIs offer in a blank name field
│   ├── Preloader.tsx + preloaderMarkup.ts  loading overlay: markup + inline driver
│   ├── login/ settings/ u/[username]/       auth, account settings, public profiles
│   ├── ComposeChat.tsx        the in-studio compose panel: ask for a song, in words; a turn's changes land in a review bar (audition / keep), never straight in
│   ├── api/share/route.ts     anonymous ?s=<slug> share endpoint
│   ├── api/compose/route.ts   starts a compose turn; api/compose/status polls one
│   └── {songs,patches,profile,auth,account}/actions.ts   Supabase server actions
├── public/
│   ├── js/                    THE ENGINE — see module map below
│   ├── woscillators.js        Plaits WASM port, exposes window.woscillators
│   ├── wavetables/akwf/       bundled AKWF wavetables (CC0)
│   ├── style.css  favicon.svg  share.{svg,png}
│   ├── icons/                 homescreen PNGs, baked from favicon.svg
│   │                          by scripts/make-app-icons.mjs
│   └── manifest.webmanifest   installed-app name / colours / icon sizes
├── lib/
│   ├── supabase/{client,server,middleware}.ts   Supabase SSR helpers
│   ├── composeModels.js       which models a compose turn may run on (allowlist + dropdown)
│   ├── composeKey.js          whose key it runs on: the shape check + the mask
│   ├── composeJobs.js         a running turn's record, its two secrets, and the limits
│   └── api.js                 legacy Blobs share put/get (+ in-memory dev fallback)
├── middleware.ts              Supabase session refresh (skips engine assets)
├── supabase/
│   ├── migrations/            profiles, songs, patches, song versions, templates, delete_own_account RPC
│   └── tests/                 negative RLS tests + the local auth stub they need
├── test/                      node --test suites (engine-side, no browser)
├── mcp/                       the MCP server: an agent writes a song through songBuilder.js
│   ├── server.mjs             tools + resources over stdio (.mcp.json names it for Claude Code)
│   ├── audition.mjs           plays a song in a headless browser and reads the meters
│   └── README.md              connecting a client, the tool list, env
├── .claude/skills/compose/    the compose guide: which engine, step strings, order of work
│                              (served by the server as seqbaby://guide)
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
- `signal.js` — per-track graph wiring (filter/eq/comp/fxRack), filter env, and
  output routing: `t.out` → master or an fx bus track (`routeTrackOutput`,
  `wouldFeedback`, `soloAudibleTracks`, `refreshOutputSelects`).
- `fxRack.js` — `FXRack` chain + `defaultFxConfig`.
- `crusher.js` — the bitcrusher: a converter model (sample-and-hold clock +
  quantiser) as an AudioWorklet, same file shape as the engine worklets. See
  the bitcrush section below.
- `reverb.js` — the reverb: a feedback delay network as an AudioWorklet, same
  file shape again. It is the rack's, not an engine's, and it exists because a
  convolution reverb's decay cannot be changed without re-rendering it. See the
  reverb section below.
- `lfo.js` — LFO configs, `getModTarget`/`canModulate`, tempo sync, setter loop.
- `automation.js` — per-step parameter automation (`AUTOMATION_TARGETS`).
- `paramHold.js` — `holdParamAt` / `fadeStop`, no imports (see the clicks and
  timing section).
- `paramTargets.js` — control class → `{lfo, auto}` key map, the mod/automation
  exclusivity helpers, the label indicators, and the per-parameter descriptions
  (generic fallbacks only — the engines describe their own sliders, see below).
- `paramMenu.js` — right-click a parameter → its mod + automation, in a modal.
- `syncTrackSoundUI(t)` (render.js) — writes a track's whole sound back into its
  controls. The one place that job lives: session load, patch load and a
  pattern-lock recall all call it (it used to be copy-pasted in two of them,
  which is how the eq/comp sliders came to be missing from session load — and
  the sidechain-source select, which is in the p-lock snapshot, was missing from
  all three). It writes the source select's VALUE only; the options belong to
  `refreshCompSourceDropdowns`, which is the one that knows the track list.
- `render.js` / `stepGrid.js` / `stepEditor.js` / `pianoRoll.js` /
  `patternBar.js` / `scaleUI.js` / `meters.js` / `beat.js` — UI.
- `keyboard.js` — computer-keyboard performance mode + capture.
- `knob.js` — the rotary knob layer, drawn over the native range inputs without
  replacing them. See the Knobs section below.
- `modMotion.js` — the second needle: where an LFO or an automation lane has
  actually pushed a parameter, drawn on the knob while the slider stays the
  base. See the modulation section below.
- `macro.js` — XY macro pads, cross-track. See the Macro pads section below.
- `session.js` — serialize/apply sets + track patches, legacy migration, and
  `newSet()` / `onNewSet()`: blanking the session back to `STARTER_TRACKS`
  (the same list main.js builds at boot) by running a blank blob through
  `applySet`, so every global a song can touch is written rather than left
  behind. Behind the top bar's `new` and a click on the logo — which is an
  `<a href="/">`, so opening it in a new tab gives a blank editor too. It
  fires `seqbaby:newset` for the shell, whose open-song slot has to clear
  with it (`app/NewSongButton.tsx`). Its per-track reader — `migrateTrackData`
  / `trackShellFor` / `loadTrackFromData` — is exported, because liveSet.js
  loads a track through exactly the same one.
- `liveSet.js` — the same session format written onto a **running** engine:
  `applyGlobalsInPlace`, `applyTrackInPlace` and `mergeSet`. history.js's
  in-place restore was the first two, and the compose panel's audition needed
  the same thing, so they live here and history.js owns only when. See the
  live merge section below.
- `engineData.js` / `soundDefaults.js` / `theoryData.js` — the engine as DATA,
  with **no imports** (engineData none at all; the other two only each other
  and constants.js): the engine catalog, the four sliders' labels per engine,
  every emulator panel's control list / ranges / defaults / presets and the
  granular controls (engineData); the fx rack, track params, filter, eq,
  compressor and euclid defaults (soundDefaults); the scales, chord types and
  note names (theoryData). The engine modules that owned these
  (catalog.js, hexop.js, guitar.js, bass.js, subbass.js, contagion.js,
  voices.js, fxRack.js, signal.js, track.js, euclid.js, theory.js) import
  their own tables back and re-export them, so every existing
  `import { GUITAR_DEFAULTS } from "./guitar.js"` still holds. `constants.js`
  is pure for the same reason (it no longer reads `window.woscillators`;
  `wosc` lives in voices.js) and holds the LFO keys, the automation targets
  and the gates over an engine KEY (`canModulateKey`, `canAutomateKey`,
  `voiceAutoKeysForEngineKey`), which lfo.js and automation.js hand a
  track's engine to. See the song builder section below for why.
- `songBuilder.js` — writing a song without a browser: builds the serialized
  session from calls (add a track, spell its steps, set its sound, put an LFO
  on it) validated against the tables above. Not imported by the engine; run
  by `mcp/server.mjs` and `test/songBuilder.test.js`. See its section.
- `sessionFormat.js` — the serialized-session format: `SET_VERSION` and
  `validateSet()`. No imports, deliberately: every other engine module
  touches the DOM or Tone at import time, and keeping this one pure is what
  lets `node --test` exercise it outside a browser. `applySet` calls it
  before its teardown, so a bad blob fails instead of emptying the session.
  Also `migrateLegacyNames` / `migrateTrackNames`, which undo the emulator
  rename on the way in — same reasoning, same test file.
- `patternSound.js` — p-lock: a track's sound stored per pattern, captured on
  the way out of a pattern and diff-applied on the way in.
- `history.js` / `historyStore.js` — undo/redo over the whole session. The store
  is the stack and the structural sharing that pays for it, and has **no
  imports** for `chanceGen.js`'s reasons; `history.js` is the engine half, and
  only the *when*: what a snapshot is taken from and when one is taken. Putting
  one back is `mergeSet` (liveSet.js). See the undo/redo section below.
- `track.js` — track lifecycle (create/resize/clone).
- `bounce.js` — WAV render via MediaRecorder.
- `buffers.js` — sample decode/normalize cache, `startSampleSource`.
- `wavetableEditor.js` — in-app wavetable frame editor for `wt:akwf`.
- `drumMachine.js` — the eleven TR-808 / TR-909 voices, built from native nodes.
  Importable with **nothing but a raw AudioContext** (its one import is
  paramHold.js, which has none), which is what lets `scripts/measure-drums.mjs`
  render them and `test/drumMachine.test.js` check the arithmetic. See the
  808 / 909 section below.
- `silverbox.js` — the silverbox circuit model: AudioWorklet processor source +
  registration + voice builder. See the silverbox section below.
- `contagion.js` — the contagion model, same shape: processor source string,
  Blob-URL registration, voice builder, and its panel key lists.
- `guitar.js` — the electric guitar: the whole rig (waveguide string, pickup,
  amp, cab, speaker-to-string feedback) in one AudioWorklet, plus the famous-tone
  table. Same file shape as the three above. See the guitar section below.
- `bass.js` — the electric bass, guitar.js's sibling: same waveguide, wound and
  stiffer, with a parallel dirt path, a rig compressor and an octaver.
- `subbass.js` — **subby**, the sub bass: a monophonic synth for the bottom two
  octaves, whose defining part is the parallel harmonics path that makes a 40Hz
  note audible on a speaker that cannot reproduce 40Hz, plus a 303 resonator
  band-split above the crossover so the acid never reaches the fundamental. See
  the subby section.
- `hexop.js` — the hexop, same shape again, plus the 32-algorithm
  table, the panel's generated key lists and the preset voices. See the hexop
  section below.
- `euclid.js` — the euclidean rhythm generator behind the ring button beside the
  dice: Bjorklund proper (not the `(i*k)%n < k` shortcut, which lands on a
  rotation of the canonical pattern), its panel, and **live mode** — where the
  transport generates the track's rhythm instead of reading its steps, which is
  what makes the three counts modulatable. The ring is also an LFO shape
  (lfo.js). See the euclid section below.
- `chance.js` / `chanceGen.js` — the chance generator behind the die button
  beside the ring: a whole part (rhythm AND pitch) from probabilities, in the
  manner of Vermona's meloDICER. `chanceGen.js` is the generator proper and has
  **no imports**, for `sessionFormat.js`'s reasons; `chance.js` is the track and
  DOM half. See the chance section below.
- `stepSource.js` — `stepGateAt(t, idx)`: what a step plays, and which of the
  three things decided it — the written pattern, the euclid ring, or the chance
  generator. Also the exclusivity: a track has ONE rhythm source, so switching
  one generator on switches the other off (`setLiveGenerator`). transport.js and
  stepGrid.js ask this rather than asking a generator, and neither generator
  imports the other.
- `theory.js` / `meter.js` / `generate.js` / `curves.js` / `params.js` /
  `constants.js` / `dialogs.js` / `dom.js` / `icons.js` / `appApi.js` /
  `types.js` (JSDoc typedefs — data-model source of truth).

## Dev commands

```
npm run dev            # Next.js dev server on :3000 (studio + engine work with no env)
npm run build && npm run start   # production build + serve
npm run netlify:dev    # full Netlify emulation on :8888
npm run legacy:dev     # pre-Next static Node server on :5173 (engine assets only)
npm test               # node --test: the pure modules (session format, chance gen,
                       #   version tree, song names, the song builder)
npm run mcp            # the MCP server on stdio (mcp/server.mjs) — an agent writes songs
npm run test:rls       # RLS policy tests — builds a throwaway Postgres in docker
```

Account features need `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY`
(see `.env.example`). The engine itself runs without any env.

## Audio signal chain (per track)

```
voice → filterNode → eqNode → compressor → fxRack → masterGain → masterLimiter → ctx.destination
                                              ↑           ↑            ↑
       per-track meterAnalyser taps fxRack.output         │   masterAnalyser taps masterGain (pre-limiter)
                                                          │
                            or, when t.out names an fx bus track, into that
                            track's BusVoice input and down its chain instead
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
- **crush is a converter, not a rounding function** (`crusher.js`) — see the
  bitcrush section below.
- **reverb is a feedback delay network, not a convolver** (`reverb.js`) — see
  the reverb section below. Its wet/dry is still a `Tone.CrossFade`, so `wet`
  is the same Tone.Param an LFO connects to and a lane ramps.
- **The vinyl crackle and cassette hiss beds only play while the track plays.**
  Each is a looping noise source inside the rack, so left alone they sounded
  whenever the master bus was open: before the first play, after a keyboard
  note reopened the bus, and on a muted track. `vinylNoiseGate` /
  `cassetteHissGate` (fxRack.js, `setNoiseBedActive`) sit after the level gains
  the automation lanes ramp, and `refreshNoiseBeds` (signal.js)
  decides them from the transport plus mute / solo (`noiseBedActive`; a bus counts
  as playing when something audible feeds it). Called from play / stop, the mute
  and solo buttons, history restore, `applySet`, duplicate / remove track, and
  once when a rack is built. A note played by hand counts too: the computer
  keyboard holds the beds open per key (`holdNoiseBed` / `releaseNoiseBed`) and
  the sample auditions hold them for the sample's length, each closing a 1.5s
  tail after the note so a release is not cut off. A hand-played note goes
  through mute, so its hold does as well.
- Master bus: `masterGain` → `masterLimiter` (DynamicsCompressor as brickwall
  safety, threshold −2dB ratio 20) → destination.
- Where the rack's output goes is `t.out` — `"master"` or an fx bus track's id
  (`routeTrackOutput` in signal.js). See the fx bus section below.

## Bitcrush (`crusher.js`) — a converter, not a rounding function

The crush stage models the whole path through a converter that is too slow and
too short, because that is what "crushed" means:

```
in ──▶ S/H clock (rate) ──▶ quantiser (bits, clips at full scale) ──▶ out
           ▲                        no reconstruction filter
           └── one clock for every channel, free of the host's rate
```

- **The sample rate is the bigger half of the effect**, and it is what the
  stage was missing: it was `Tone.BitCrusher`, which quantises and nothing
  else. Quantisation alone is a noise floor — measured, 8 bits puts its
  harmonics 44dB under the signal and 4 bits 20dB under, ~6dB per bit, which is
  correct and which on a drum loop is hiss. What everyone means by crushed is
  the aliasing: decimate to 4kHz and a 3kHz tone folds down to 1kHz **louder
  than what is left of the original** (measured +9.5dB), off the harmonic
  series and out of tune with the track. With the clock at 8kHz a 1kHz tone
  grows images at 7k / 9k / 15k (−17 / −19 / −22dB, the zero-order hold's own
  sinc rolloff) and nothing at 5k, which is not an image of it.
- **The clock is free-running and fractional.** The hold period is almost never
  a whole number of host samples, so it is a phase accumulator and the input is
  read by linear interpolation at the instant the clock actually fires.
  Snapping ticks to host samples instead quantises the rate itself — at 48k you
  could only have 48000/n, so 24k, 16k, 12k and nothing in between up top — and
  puts jitter sidebands on everything. Measured: 8000Hz asked, 8000 delivered;
  7300 asked, 7300 delivered.
- **A converter clips at full scale**: past +FS there are no codes left. The
  levels are laid out as two's complement — 2^bits codes, mid-tread, −1 to
  1 − step — so negative full scale is one code further out than positive
  (measured at 8 bits: −1 and +0.992188), zero is a code, and digital silence
  stays silent. This is the one way an old song can sound different: a signal
  the rack's drive pushed past ±1 used to sail through the crusher and now
  clips, which is the accurate behaviour and the reason driving a crushed track
  reads as a converter overloading.
- **No anti-alias filter in, no reconstruction filter out**, deliberately. Both
  are what a good converter has and what the machines this sounds like did not;
  either one removes the effect.
- **It is a worklet because a sample-and-hold has state.** A WaveShaper is
  memoryless — it can quantise (that is all Tone's crusher is) but it can never
  hold a value across samples. Registered from a Blob URL by `loadWorklet()`
  with the engine worklets; if that fails the rack falls back to
  `Tone.BitCrusher` (quantise-only, which is exactly what this stage used to
  be) so the track is never silent — and `crushRateParam` is null on that path,
  which every write already checks.
- **Controls** — `wet` / `bits` / `rate` in `t.fxConfig.crush`. `rate` is a
  0..1 knob mapped exponentially to 250Hz..48kHz, in **hertz rather than a
  fraction of the host rate**, so a song does not change character between a
  44.1k machine and a 48k one; the top of the knob is one hold per host sample,
  which is no decimation at all, and reads `off` (`crushRateLabel`, through
  `setKnobReadout` — the number under the knob is a clock, not a fraction).
  Mod + automation as `crush_rate` / `fx.crush.rate`, both real AudioParams on
  the worklet node, so a swept clock ramps rather than stepping.
- **A song written before the clock has no `rate`, and gets 1** — no
  decimation, which is all the stage ever did. That default is written by
  `migrateCrushRate` in sessionFormat.js (with the emulator rename, and tested
  beside it) rather than where the value is read, because `applyCrush` takes
  partial configs — the automation lane sends bits alone — so an absent rate
  there means "leave it", not "1".
- **The wet/dry is the rack's own linear crossfade** now, not a Tone effect's
  equal-power one, matching every other parallel stage in the file (vinyl,
  cassette, fuzz, ring mod, shaper). For an effect whose output is correlated
  with its input, linear is what keeps the level put; equal power lifts it by
  up to 3dB in the middle of the knob.

## Reverb (`reverb.js`) — a tank, not an impulse response

A feedback delay network, and it replaced a convolution reverb for one reason:
**a convolution reverb's decay IS its impulse response**, so the decay knob
could not be turned without rendering `decay` seconds of noise through an
OfflineAudioContext and re-partitioning the convolver's FFT.

```
in ─ dc ─ predelay ─ 4 allpass diffusers ─┬─▶ 8 delay lines ─┬─▶ L
                                          │   damp · decay   │
                                          │   Hadamard mix   ├─▶ R
                                          └──────────────────┘
```

- **The decay is a coefficient.** A line of L samples keeps
  `10^(-3L/(T·sr))` of itself each lap, so a tail length is eight `pow()`
  calls when it moves and nothing at all when it does not. That is the whole
  point: see the clicks-and-timing section for what it replaced and what the
  numbers were.
- **The gain is per line, and it has to be.** The short lines come round more
  often, so one gain for all eight would give eight different decay times and a
  tail that changes colour as the short ones drop out.
- **The lengths are times, not sample counts**, rounded up to primes at
  construction: the same room at 44.1k and at 48k, and no two lines sharing a
  period, so the tank's modes spread instead of piling up. Measured: RT60 2.01s
  at 44.1k, 2.01s at 48k, 1.98s at 96k, all for a 2s decay.
- **The mixing matrix is an 8-point Hadamard**, applied as a butterfly — 24
  adds and a scale where the matrix is 64 multiplies. Orthonormal, which is
  what makes the energy the lines lose exactly the energy the coefficients
  asked them to lose. With a matrix that is not, the gains mean nothing and the
  tank either dies early or runs away.
- **Damping is one pole per line, inside the loop.** Its DC gain is 1, so it
  does not touch the decay the coefficients ask for — but it still takes the
  top off a little further every lap, and the broadband tail comes out about
  12% short. Flat across 0.35..8s, so the coefficients are computed for a
  target `DECAY_COMP` longer and the knob then reads true: measured, RT60
  tracks the knob within 1% from 0.35s to 8s. Below ~0.3s it stops holding (the
  long lines are damped so hard the short ones carry the tail, which runs
  long), so 0.2s asks for 0.25s. Pinned in the tests rather than fixed — the
  alternative is line lengths that make every longer setting sound like a
  smaller room.
- **Sweeping the decay must not sweep the volume.** A tank holds more energy
  the longer it holds it, worth a full 6dB across the knob, and the convolution
  reverb this replaces was normalized per impulse response and did not do that
  — every saved song's wet setting was chosen against that. So the output trim
  moves with the decay (`LEVEL_EXP`, measured rather than derived: the
  ideal-delay-line model says amplitude should go as `sqrt(decay)` and the
  damping flattens it to nearly a fifth of that). Measured, the wet level now
  varies under 1dB across the whole range. The trim is **ramped, not stepped** —
  the coefficients may jump, since changing how fast a signal is decaying is
  not a discontinuity in it, but a gain on the output may not.
- **The read heads wander.** Without it the tank is a bank of fixed resonators
  and a long tail rings on a chord of its own modes; half a millisecond at well
  under a hertz smears them, on mutually prime-ish rates so the eight never
  line up.
- **The wet/dry stays a `Tone.CrossFade`**, deliberately. `wet` is then the
  same equal-power Tone.Param an LFO connected to (`rack.reverbCross.fade`) and
  an automation lane ramped, so every saved song's reverb balance is exactly
  what it was. Only the box between `a` and `b` changed.
- **The idle skip counts silent INPUT as well as silent output**, and that is
  not an optimisation detail — keying it off the output alone swallowed the
  tail of every sound arriving after a pause. A sample can be sitting in the
  predelay or partway down a line with the output still silent, so the block
  carrying a new sound was processed, the next had no input, the output had not
  caught up, and the tank was skipped from there on. The threshold is well past
  the longest path through it (predelay + longest line, ~90ms).
- **`process()` never returns false.** A processor that does is finished for
  good, and a reverb that retired itself during a quiet passage would be gone
  for the rest of the session.
- **Loading** — same Blob-URL registration as the engine worklets, from
  `loadWorklet()` in transport.js. A failure falls back to `Tone.Reverb` with
  the throttle that used to be the only thing standing between a decay lane and
  a 180ms frame, so a track never loses its tail.
- `reverb.js` is importable from Node (no DOM, no Tone), which is what lets
  `test/reverb.test.js` render the tank and measure all of the above.

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
| `drum-synth`  | `DrumSynthVoice` | Recipes via `buildDrumSynthNode(kind, output)`: poly-saw, fm-bell, pad, plus the emulators (below). Tone.js, except the 808/909 kit, which is native nodes in `drumMachine.js` (that dispatch runs first), and the silverbox / contagion / hexop / guitar / bass / subby, which are AudioWorklet models. |
| `sampler`     | `SamplerVoice`   | THE unified sample voice — plays a user upload or a bundled kit sample chosen via `track.sampleSource` ({kind:"upload"|"bundled", ...}). Absorbed the old `SampleVoice`/`UploadVoice`/`ElevenVoice`. Per-step region/fade/loop via `startSampleSource`; slicing via `t.slices`/`sliceOn`. Pitch from `pitchBase` (36 drum-kit, 60 otherwise); `t.pitchLock` keeps 1×bpm fits pitch-true. |
| `custom` / `saved` | `CustomToneVoice` | Tone.js synth tree from a saved-patch JSON config (`saved:<name>` keys, localStorage). |
| `granular`    | `GranularVoice`  | Granular sampler (`dm:granular`, "texture" group). See the granular section below. |
| `wavetable`   | `WavetableVoice` | Multi-frame AKWF wavetable synth (`wt:akwf`), morphable, editable in `wavetableEditor.js`. |
| `midi`        | `MidiVoice`      | Web MIDI out; converts audio time → DOMHighResTimeStamp for `output.send`. |
| `bus`         | `BusVoice`       | The fx bus (`bus`). No instrument — a summing gain other tracks are routed into, plus a mute gain, then the ordinary per-track chain. See the fx bus section below. |

Voice interface: `hit(midi, time, dur, vel, opts?)`, `setParam`,
`getAudioParam`, `setEngine`, `canInPlaceChange`, `getOutputNode`,
`setDestination`, `silence`, `dispose`. Legacy engine keys (`smp:*`, `upload`,
`eleven`) are migrated to `sampler` in `session.js` on load.

## Emulators (`"Emulators"` optgroup)

All engine type `drum-synth`. The five Tone.js analog-mono presets are each
wrapped in `makePolyPool(size, buildOne)`; the silverbox, the contagion, the hexop, the
guitar, the bass and subby are the odd ones out — AudioWorklet models that handle
their own voicing (the silverbox and subby are mono, deliberately; the rest
polyphonic). See their
sections below. The guitar and bass keep their old pluck builders in voices.js
(`buildPluckGuitarVoice` / `buildPluckBassVoice`) purely as worklet fallbacks.

| key             | builder               | pool | character |
|---|---|---|---|
| `dm:silverbox` | `buildSilverboxVoice` | mono | acid-box circuit model, AudioWorklet (`silverbox.js`) |
| `dm:contagion` | `buildContagionVoice` | 8 (internal) | digital multi-filter architecture, AudioWorklet (`contagion.js`) |
| `dm:hexop`     | `buildHexopVoice`     | 16 (internal) | 6-op FM, AudioWorklet (`hexop.js`) |
| `dm:snarl`     | `buildSnarlVoice`     | 4 | saw + ultrasaw + PWM pulse + metalized tri + sub, growl soft-clip |
| `dm:ladder`    | `buildLadderVoice`    | 4 | 3 osc w/ wave + range selects, ±7-semi osc2/3, noise |
| `dm:drift`     | `buildDriftVoice`     | 6 | DCO + sub + noise → HPF → baked-in chorus |
| `dm:guitar`    | `buildGuitarVoice`    | 6 (internal) | electric guitar rig, AudioWorklet (`guitar.js`) |
| `dm:bass`      | `buildBassVoice`      | 4 (internal) | electric bass rig, AudioWorklet (`bass.js`) |
| `dm:sub`       | `buildSubBassVoice`   | mono | subby, the sub bass, AudioWorklet (`subbass.js`) |
| `dm:tines`     | `buildTinesVoice`     | 6 | electric piano |
| `dm:oracle`    | `buildOracleVoice`    | 6 | poly analog |

### The emulator names (`migrateLegacyNames`, sessionFormat.js)

All eight are named for what they do rather than for the hardware they model:
`dm:303 → dm:silverbox`, `dm:virus → dm:contagion`, `dm:dx7 → dm:hexop`,
`dm:mini-brute → dm:snarl`, `dm:moog → dm:ladder`, `dm:juno → dm:drift`,
`dm:rhodes → dm:tines`, `dm:prophet6 → dm:oracle`.

A name is spelled in four places, not one — the engine key, the silverbox's
three `params` keys (`sbwave` / `sbaccent` / `sbtune`), the LFO targets
(`hexop_3lvl`) and the automation lanes (`hexop.3lvl`), which the macro pads
store too — so a song written before the rename is rewritten on the way in by
`migrateLegacyNames`, called from `applySet` before it tears anything down, and
`migrateTrackNames` from `applyTrackPatch` for saved patches. Both live in
sessionFormat.js for the reason `validateSet` does: pure functions over a plain
object, so `node --test` can exercise them.

The `params` keys the other emulators use were already spelled with a neutral
prefix and did not move: the contagion's are `v…` and the hexop's `d…`, which
is why `d3lvl` / `hexop_3lvl` / `hexop.3lvl` are one control with three
spellings rather than a consistent one.

`makePolyPool` exposes `trigger` (round-robin) / `release` / `setGlide` /
`setParam` (broadcast) / `getAudioParam` (voice 0 only — LFO mod hits voice 0,
chord tones on other voices play the baseline; same limitation as
`PlaitsVoice`). The stock harm/timb/morph/decay sliders are relabeled
per-engine by `updatePlaitsControlsVisibility`.

## The 808 and the 909 (`public/js/drumMachine.js`)

Eleven voices — six 808, five 909 — modelled on the machines' own circuits.
Native Web Audio nodes rather than a worklet, because every piece of them (a
ringing sine, a square, a biquad, a soft clipper) is a node the browser already
has; what the file is for is arranging them the way the schematics do. Three
facts about the hardware decide the shape of the code:

- **A voice is one circuit, so it is monophonic.** Retriggering recharges the
  envelope generator's capacitor — it does not start a second copy of the
  instrument beside the first. So each voice has a persistent VCA whose
  re-attack IS the choke (hold whatever is left, ramp up from there, no step),
  and the struck resonators register with `rig.ring()` so the next hit takes
  them away over 4 ms. Two open hats ringing over each other is the one thing a
  real 808 cannot do, and it used to be the default here. Measured: an open hat
  50–100 ms into its decay reads the same level whether or not there was a hit
  a quarter of a second earlier (excess 0.0 dB, was +0.3), and the retrigger's
  own step is 0.4–0.8× the size of the steps the wave is already making.
- **The metal oscillators and the noise source free-run.** The cymbal section's
  six squares and the noise transistor are always going; a hit only opens a VCA
  on them. Building them per hit — which is what this did — starts every one at
  phase zero, so every hat off the track was **the same sample, bit for bit**:
  measured, two hits of the 808 closed hat correlated 1.000, and now 0.04. It is
  audible as more than variety: six squares in phase are mostly a DC block that
  the 7 kHz high-pass throws away, while six at scattered phases put six times as
  many edges through it, which is the density the machine actually has. (The
  levels are trimmed back so the hats sit where they always did, within 0.5 dB.)
  Free-running also takes the allocation off the transport callback: a 64-hit
  bar builds **0** nodes for a hat or a clap where it used to build 576 and 768.
- **The drums are struck resonators.** A bridged-T network rings when a pulse
  hits it and is silent otherwise, so the kick's body and the snare's two shells
  ARE built per hit, from rest — the free-running rule is about the parts that
  free-run on the machine, not about avoiding allocation.

Then four numbers and a bug:

- **The oscillator bank is the machine's six**: 205.3, 304.4, 369.6, 522.7, 540
  and 800 Hz. It had 254.3 in place of 540 — a frequency that is on neither
  machine — while the cowbell, which taps 540 and 800 out of that same bank,
  had 540 hard-coded beside it. `TR808_METAL_HZ` is now the one list and the
  cowbell reads its pair out of it.
- **The pitch envelope is an RC discharge.** An exponential VCO fed a
  discharging capacitor moves linearly in SEMITONES at an exponentially decaying
  rate: out fast, then settling onto the note. A single
  `exponentialRampToValueAtTime` is linear in semitones at a CONSTANT rate and
  then stops dead, and that corner is exactly where a 909 kick's punch lives.
  The sweep is four ramps laid along `exp(-t/tau)` instead (`pitchSweep`,
  exported and pinned by the test to within 90 cents of the curve), which costs
  no allocation where `setValueCurveAtTime` would want a Float32Array a hit.
  The depths went with it: the 808's drop is small and quick (×1.26, tau 12 ms —
  measured 69 Hz at the trigger, 59 at 20 ms, 55.4 by 60) where the 909 dives
  (×3.8, tau 9 ms — 190 Hz, 89 at 20 ms, 53 by 100).
- **The saturation curve was half a cell out.** A WaveShaper reads its curve at
  index `(x + 1) / 2 * (n - 1)`; this one was laid out over `i * 2 / n - 1`, so
  an input of zero came out at −0.004 and both kicks put **DC on the bus for the
  life of the voice** — and, since the shaper was built per hit and left
  connected, one more copy of it per kick. Odd length now, mapped over `n - 1`,
  and the shaper is persistent. Measured DC after three kicks: −1.2e-2 → 0.
- **A VCA parked at the exponential's floor is not silent** when what it is
  gating never stops. `strike` ends its decay with a step to a true zero,
  because 1e-4 of six free-running squares is −64 dB of hum under a track that
  is not playing (it was audible in the measurement as a 909 hat that never
  stopped ringing).
- **The clap is one noise source, one filter, one retriggered VCA**, which is
  what the circuit is: the slaps are the same noise re-gated, not four unrelated
  bursts, so they share a grain and a colour. Their spacing stretches ~8% a lap,
  because the retrigger oscillator's RC slows as it goes and three evenly spaced
  pulses read as a machine gun. The 909's tail hangs off a wider band than its
  slaps and was 15 dB above them; it is now under.

**A drum voice ignores note-off.** A trigger input has no gate, so `release` is
a no-op and the hard stop is `silence` (which `DrumSynthVoice.silence` prefers
when a voice has one). Without that split, lifting a computer-keyboard key cut
off a hat that was still ringing.

**Known departure**: on the machines a closed hat chokes the OPEN hat, because
they share one circuit. Here they are separate engines on separate tracks, so
each chokes only itself.

**Measuring it** — `node scripts/measure-drums.mjs` (needs `npm i playwright`)
renders all eleven in a headless OfflineAudioContext and prints the levels,
decays, DC, pitch sweeps, monophony, hit-to-hit correlation and node counts
above. Every number in this section came from it. What is left over is pure
arithmetic — the oscillator list, the saturation curve's symmetry, the shape of
the pitch envelope — and that is `test/drumMachine.test.js`, which runs under
`npm test` with no browser.

## Silverbox (`dm:silverbox`, `public/js/silverbox.js`)

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
  (only partially compensated — that thinning is the silverbox).
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
  normally). `sq-param-group--silverbox` carries wave, accent depth, and tuning
  (`sbwave` / `sbaccent` / `sbtune` in `t.params`).
- **Mod + automation for those three** — accent and tune are AudioParams too,
  reached under their own keys and gated to `dm:silverbox`: LFO `silverbox_accent` /
  `silverbox_tune` (`LFO_KEYS` + `LFO_LABELS` + `LFO_AMP_SCALE` in constants.js,
  `getModTarget` + `canModulate` in lfo.js, `getAudioParam` in silverbox.js), and
  automation `silverbox.accent` / `silverbox.tune` / `silverbox.wave`. Tune's lane spans
  the slider's own ±50 cents. Wave has no AudioParam — the lane flips it at
  0.5, written to the live voice so the track's select stays put (same
  convention as `gran.*` and `wt.scan.*`).
  Note ACCENT is a *depth*: it scales an accent the step already has from its
  velocity, so it does nothing on unaccented steps — as on the machine.
- **Loading** — the processor source is a string in `silverbox.js`, registered from
  a Blob URL so it travels with the module graph (no extra fetch, no coupling to
  the `public/e/<sha>/` asset versioning). `loadWorklet()` in transport.js
  registers it alongside Plaits; a failure is swallowed and `buildVoiceForEngine`
  falls back to a Tone.MonoSynth so the track is never silent.

## Contagion (`dm:contagion`, `public/js/contagion.js`)

The contagion is a digital synth, so the model is of its architecture, not its
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
  `sq-param-group--contagion` as `CONTAGION_NUM_KEYS` / `CONTAGION_SEL_KEYS` (render.js and
  session.js walk those lists, as they do for granular).
- **Mod + automation** — LFO `contagion_*` and automation `contagion.*`, gated to
  `dm:contagion`, all real AudioParams: every numeric control on the panel is
  reachable, envelope and osc detail included (the k-rate ones take a connection
  and a ramp fine — the value is sampled once per control block). `contagion_cut2` /
  `contagion_envamt` are bipolar and `contagion_osc2semi` spans ±24 semitones, so their
  automation lanes map through their own range, not 0..1. One key doesn't match
  its param: `contagion_sat` is the saturation *amount*, `vsatamt` on the voice
  (`vsat` is the curve select), aliased in `getModTarget` /
  `applyAutomationAtStep`.
- **Resonance is cubed** (`0.7 + reso³·12`). `timb` defaults to 0.5 for every
  engine, and a squared curve put that default far too resonant.
- **Noise is squared** for the same reason: `osc4` defaults to 0.4 everywhere,
  and linear noise at 0.4 hisses over the patch.
- Simplifications, stated in the file too: unison copies share their note's
  filter pair; the morph crossfades four classic waves rather than walking the
  contagion's 64 spectral wavetables; no oversampling, so the saturator aliases (as
  the hardware's does); cutoff keyfollow is fixed at 33%.

## Hexop (`dm:hexop`, `public/js/hexop.js`)

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
  FBK (feedback) / MOD DEC / DECAY. Everything else is `sq-param-group--hexop`:
  three global rows plus a 6×8 operator grid (level, ratio, fine, detune, and an
  ADSR each) with a ratio/fixed select per operator. The osc-mix row is hidden —
  a hexop's six operator levels live in the grid.
- **One list, three namespaces.** Every control is `d` + a short key, and that
  short key spells its LFO target (`hexop_<short>`) and its automation lane
  (`hexop.<short>`) — so `d3lvl` / `hexop_3lvl` / `hexop.3lvl` are one control.
  `HEXOP_MOD_KEYS` in hexop.js generates all 56 of them, and `constants.js`,
  `automation.js` and `paramTargets.js` map over it rather than listing them.
  `HEXOP_MOD_RANGE` gives each its span, so a ratio lane sweeps 0..31 and a detune
  lane ±7. Adding a control is one entry in `HEXOP_OP_CTLS` / `HEXOP_GLOBAL_CTLS`
  plus its markup column.
- **The panel markup is generated** in `app/studioMarkup.ts` (`HEXOP_PANEL`) — 54
  hand-copied inputs differing only by operator number is a typo waiting to
  happen. The algorithm and voice dropdowns ship **empty** and are filled at
  runtime by `renderTrack` from `HEXOP_ALG_LABELS` / `HEXOP_PRESET_NAMES`, so the 32
  diagrams live only in hexop.js. Ranges and defaults in the markup must match
  `HEXOP_DEFAULTS`.
- **`refreshHexopAlgorithm`** (params.js) redraws the carrier / feedback markers on
  the operator rows when the algorithm changes — the panel is the same six rows
  in every wiring, so those markers are the only thing saying what a row means.
  Called from `updatePlaitsControlsVisibility`, so engine switch / session load /
  patch apply all cover it.
- **Presets** (`hexopPreset(name)`) return a *complete* set of panel params plus
  the four track sliders, so nothing of the previous voice survives a load.
  They're in the spirit of the machine's own, not its ROM (which is 155-byte
  sysex of controls this panel doesn't have).
- **Loading** — same Blob-URL registration as the silverbox and the contagion, from
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
- **One list, three namespaces**, as in hexop.js: every control is `gt` + a short
  key, which spells its LFO target (`gtr_<short>`) and its automation lane
  (`gtr.<short>`). `GUITAR_NUM_CTLS` generates all of them and constants.js /
  automation.js / paramTargets.js map over `GUITAR_MOD_KEYS` rather than listing.
  `GUITAR_MOD_RANGE` gives each its span (pick/pickup position are 0.02..0.5).
- **The famous tones** (`guitarTone(name)`) return a *complete* set of params
  plus the four sliders. Named for what they sound like, with a one-line
  description on each option's tooltip and in the status bar. The panel markup
  is in `app/studioMarkup.ts` (`GUITAR_PANEL`) and the dropdown ships **empty** —
  `renderTrack` fills it from `GUITAR_TONE_NAMES`, so the tones live only here.
- **Loading** — same Blob-URL registration as the silverbox/contagion/hexop from
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

## Subby — the sub bass (`dm:sub`, `public/js/subbass.js`)

An instrument for the bottom two octaves and nothing else. The 20-80Hz region
has four problems no general-purpose engine solves, and each one is a feature:

```
        PITCH ENV (the 808 drop)
                |
                v
OSC x stack ----+--> clean (the actual sub, kept clean) ------+
(shape morph,   |                                             |
 detuned)       +--> SHAPER -> HPF(xover) -> LPF(tone) -------+--> [split at xover] -> GLUE -> CEILING
                |    (the harmonics that make it audible)     |     below: straight past
SUB OCT --------+---------------------------------------------+     above: RESONATOR
```

- **Most listeners cannot hear it.** A phone speaker starts around 500Hz and a
  laptop around 180Hz, so a 35Hz sine is *literally silent* on the two things
  most people listen on. The fix isn't level, it's **harmonics**: generate them
  and the ear rebuilds the fundamental it cannot hear. That parallel harmonics
  path is the whole reason the engine exists, and it's why DRIVE gets a track
  slider. Measured: at drive 0.9 the >180Hz energy is ~1.7x the fundamental; at
  drive 0 it's -47dB (a genuinely pure sine).
- **The shaping is parallel and highpassed**, for the same reason bass.js's dirt
  is — distort a sub whole and the fundamental intermodulates with everything
  above it and the bottom disappears. `xover` (60Hz..800Hz) is where the shaped
  path starts; nothing below it is ever distorted.
- **EDGE biases the signal BEFORE the drive gain**, which is the only place it
  does anything (past a 50x gain an offset is invisible). Biased first, a
  clipper makes a pulse whose duty cycle is no longer half — and an uneven duty
  cycle *is* the even harmonics. Four shapers: tube / fold / fuzz / **rect**,
  and rect has to rectify the *bounded* signal, because full-wave rectifying an
  already-clipped square gives a constant that the DC blocker then eats.
- **Monophonic, always.** Two notes a third apart at 40Hz beat at a rate you
  feel as lumpiness rather than hear as harmony. Last-note priority plus glide,
  and `subglidem` picks always/legato — legato slides only into a note arriving
  while another sounds, which is the 808 slide and the whole of a drill bassline.
  The glide TIME is the track's own `glide`.
- **Asymmetric shaping at 30Hz makes DC**, and DC is a cone held off-centre with
  the amplifier's headroom spent holding it there. Hence DC blockers after the
  shaper and at the output, a rumble filter (`hpf`), and a ceiling that stays
  **linear until 75% of the limit** — a curve that bent everywhere put harmonics
  on the one patch whose point is having none.
- **The 303 resonator is a band split, not a stage in the chain.** The
  silverbox's filter — 3-pole diode ladder, 18dB/oct, diode-clipped feedback,
  2x oversampled — with its own MEG (`renv` / `rdec`) and its own accent RC
  whose time constant tracks resonance, so consecutive hard-hit steps stack
  into a climb instead of each being an isolated blip (velocity above 0.6,
  same ramp as the silverbox's). It hangs behind a highpass at **the same
  `xover`** the harmonics path uses, and the low band is taken as the
  *complement* of that highpass (`sig - hi`) so the two always sum: below the
  crossover the sub goes past untouched, above it everything goes through the
  ladder. Measured, the fundamental moves under 0.4dB across the whole cutoff
  range while 2-6kHz drops 13dB.
  The obvious wrong version is putting it inside the harmonics path, and it
  looks right until you morph the shape towards saw: the clean path is the RAW
  oscillator, full range, so its harmonics run straight past a filter buried in
  the shaped branch — measured, that cut 3.2kHz by 0.3dB where it should have
  cut 30. `reso` 0 bypasses the whole stage (and resets its state), so every
  patch written before it exists is unchanged and a sub that isn't acid costs
  nothing.
- **The pitch drop is the attack transient.** It's why an 808 has a beater sound
  at all when it is otherwise a sine. `drop` spans 40 semitones and lands exactly
  on the note; `click` adds the band of noise that is often the only part of the
  note a small speaker reproduces at all.
- **A retrigger is crossfaded, because the phase reset is a step.** Every note
  starts at `phase` (that is the control's whole point), but snapping the
  accumulator while the last note is still ringing is a discontinuity scaled by
  whatever that note had got down to — and carrying the envelope across a
  retrigger, which the voice does deliberately, only makes it bigger. The
  interrupted wave is kept as a tail running at the old note's pitch and faded
  out under the new one over 3ms, smoothstepped so neither the value nor its
  slope steps at either end. Measured over 64 patches, the worst jump at a
  retrigger went from 140x the wave's own slope to 4x. Deleting the tail brings
  the click back on any two consecutive notes close enough for the first to
  still be sounding.
- **The shapes share one phase accumulator** (sine -> tri -> saw -> square,
  polyBLEP on saw/square) and are **zero-crossing aligned**, so `phase` means the
  same thing whichever shape is loaded. The detune spread hangs either side of
  the note, so changing `stack` never retunes the track.
- **Controls** — the four sliders are DRIVE / TONE / SHAPE / DECAY; the rest is
  `sq-param-group--sub`. Keys are **`sub`** + short key -> `sub_<short>` /
  `sub.<short>`, generated from `SUB_NUM_CTLS`. **Not `sb`** — that prefix is the
  silverbox's (`sbwave` / `sbaccent` / `sbtune`), and two engines sharing one
  prefix on the same flat `t.params` is a collision waiting for whichever of them
  gains a control the other already has. Patches via `subTone(name)`; panel
  markup is `SUB_PANEL` in `app/studioMarkup.ts` with the dropdown filled at
  runtime from `SUB_TONE_NAMES`.
- **Loading** — same Blob-URL registration as the silverbox/contagion/hexop/
  guitar/bass from `loadWorklet()`; a failure falls back to a plain Tone
  `MonoSynth` sine (no harmonics path, so inaudible on a small speaker, but
  never silent).

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

## Euclidean rhythms (`euclid.js`)

Bjorklund's algorithm — N hits spread as evenly as possible over M steps — with
the ring button beside the dice. The dice rolls; this one divides.

**The algorithm is the real recursion**, not the `(i*k)%n < k` shortcut. The
shortcut is maximally even too, but it lands on a *rotation* of the canonical
pattern, so E(5,8) would come out `x.x.xx.x` instead of the `x.xx.xx.` printed
on the box of every drum machine with this feature.

**Two ways to use it, and the split is the whole design:**

- **write to pattern** — print the ring into the step grid, once. Ordinary
  steps afterwards, editable by hand. Destructive and labelled so, like `clear`
  and the dice.
- **live** (`t.euclid.on`) — the transport asks the generator for every step
  instead of reading the written pattern (`stepGateAt`, called from
  transport.js and from `renderStepGrid`). Nothing is ever written, so the
  three counts can take an LFO, an automation lane or a macro pad. Switch it
  off and the pattern you wrote is exactly as you left it.

Modulating the *one-shot* was the alternative, and it would mean rewriting the
pattern under the playhead sixty times a second — an edit, sixty times a second,
with the undo stack to match.

- **Only the step mask is generated.** Pitch, chords, arps, ratchets, nudges
  and the automation lanes all still come from the pattern, so a live euclid
  track is an ordinary track with its rhythm replaced. A generated hit on a
  step the pattern never wrote falls back to C2 on a drum kit, the track's
  last-used note otherwise.
- **The grid shows what is playing** and goes read-only with it
  (`.sq-track.is-euclid`) — it can't be both a picture of a generated rhythm
  and the thing you edit.
- **Modulation writes `t._euclidMod`, never `t.euclid`** — the knobs stay the
  base an LFO swings around, exactly as the granular controls do, and the
  overrides are live-only (never saved). The panel marks a driven control
  (`is-driven`) because a still knob beside a turning ring reads as a bug.
- **One list, three namespaces**: `p-euc<key>` / `euclid_<key>` / `euclid.<key>`
  for pulses, steps and rotate. `canModulate` / `canAutomate` gate all three on
  live mode being on — with the pattern in charge they would say nothing.
  The LFO path is setter-driven (`SETTER_LFO_KEYS`); the generator reads the
  value at step time. Ranges move with the track length, so `euclidRange` is a
  function where the other engines have a constant table.
- **The panel lives on the track**, not in a modal built on demand, for the
  same reason the filter and the rack do: the controls have to be in the DOM
  whether or not anyone has opened it, or the parameter menu, the mod/aut dots
  and the macro pads have nothing to find. The button hosts it in a modal
  (`openPanelAsModal`) like every other panel.
- The plan is cached on the resolved config, and repaints are coalesced onto
  one frame and skipped when the rhythm hasn't moved — the LFO setter loop runs
  at 60Hz while these controls are counts.
- Settings are **outside the p-lock snapshot**, like `t.out` and the macro
  pads: a generator that rearranged itself at every pattern switch would be a
  trap, not a feature.

### The euclid LFO shape (`lfo.js`)

The same ring, as the mod matrix's fifth shape — so any of the ~180 LFO targets
can be tapped in a euclidean rhythm instead of swept by a waveform. One shape
entry buys "euclidean filter gate", "euclidean reverb throw" and "a euclidean
LFO rotating a euclidean track".

- **The rate is the STEP rate**, not the cycle rate: a division of 1/16 is one
  ring step per sixteenth, as on every euclidean module, so the cycle is
  `steps` long. The rate label says `hz/step` when the shape is euclid, because
  1/16 otherwise reads as a very long cycle.
- **It starts unipolar** where the waveforms start bipolar: rests sit at zero
  and taps rise to the full amount. A tap should lift a parameter off its knob
  and let it fall back, not swing it either side. That is now the ± switch's
  default rather than a fixed property of the shape (see `lfoBipolar` in the
  modulation section) — bipolar hangs the same peak-to-peak half either side,
  so rests pull down as far as taps push up. Same peak-to-peak from the same
  amount knob whichever way it is set.
- **`decay` 0 is a gate**, holding the tap for its whole step; above that each
  tap decays exponentially (`setTargetAtTime`), which is the pluck.
- **A rhythm is not an oscillator type**, so the audio path swaps the source: a
  `Tone.Signal` scheduled ahead (`scheduleEuclidTaps`, 250ms lookahead) instead
  of a `Tone.LFO`, summed onto the same param the same way — so the slider is
  still the base and disconnect/dispose/`t.lfos` are unchanged. Scheduling
  ahead is what keeps the tap edges sample-accurate off a 60Hz loop, the same
  bargain the transport strikes. Switching *shape* between euclid and a
  waveform rebuilds rather than retunes.
- **Synced rings hang off `state._transportStartTime`** (`euclidOrigin`), not
  off whenever the LFO was switched on. A sine drifting against the beat is a
  texture; a gate pattern drifting against it is a mistake.
- Setter-path targets (reverb decay, the granular controls, euclid's own
  counts) take the shape too, sampled per frame from the same absolute phase.
- **The four settings are written lazily**, only once the euclid shape is
  picked (`lfoEuclid` reads with defaults). `lfoConfig` serializes all ~180
  entries per track, and four more numbers on each of them, forever, to say
  "this one is a sine" is real weight in a share link.

## Chance — a part from probabilities (`chance.js` + `chanceGen.js`)

A stochastic melody generator in the manner of Vermona's meloDICER, behind the
die button beside the ring. Where euclid divides a cycle evenly, this throws
dice — and unlike euclid it decides the **pitch** as well as the rhythm, which
is the point of it: dicing the rhythm and reading the melody off the grid would
be two unrelated parts stacked on each other.

```
RHYTHM   note value · variation · legato · rest        [dice]  [realtime]
MELODY   twelve semitone probabilities · low + high    [dice]  [realtime]
WINDOW   first step · last step
```

- **The rhythm is a chain of note values, not a step mask.** From the window's
  first step: draw a length, decide what happens over it (a rest, a tie onto the
  note before, or a note of its own), advance by that length, draw again. That
  is the one structural difference from euclid, which can only say yes or no to
  a step that was already there — and it is why the part has phrasing rather
  than holes.
- **A throw is a SEED**, and every decision is a hash of (seed, step, which
  decision) — never a draw from a running generator. Same bargain as the random
  square LFO (lfo.js), same three payoffs: the transport, the step grid and
  `write to pattern` agree without sharing state; a saved song replays note for
  note with none of the notes in it; and realtime-mode is one number away (mix
  the pass count into the seed). Two seeds, because the machine has two dice —
  a rhythm that repeats under a melody that never does is what they are for.
- **A throw is only accepted if it changes the part.** A seed only matters where
  a decision is left to make with it, so on a fresh track — variation, legato and
  rest all at zero, which is the panel's default — the rhythm dice rolled a new
  number and produced the identical part, and one semitone raised did the same to
  the melody dice. `throwChanceDice` draws until the plan's signature moves
  (the generator is pure and cheap, so it just looks), and `chanceDiceDead` names
  the reason when nothing could: the button is struck through and says which knob
  to turn instead of silently doing nothing.
- **Each decision gets its own hash stream, keyed by STEP.** Deliberately better
  than the machine, which runs one: turning REST up only removes notes and the
  faders only change pitches, instead of reshuffling the part every time a knob
  moves. A part you are half happy with survives being tuned.
- **The triplets and the 1/32s are ratchets.** The transport runs on sixteenths,
  so a 1/8 triplet is not a step length — it is three notes evenly across a
  quarter, which is exactly the `ratchet` the transport already has. Hence the
  ladder's `{span, hits}`: 1/4T is 8 steps × 3, 1/8T is 4 × 3, 1/32 is 1 × 2.
  **A value cut to fit the window loses its ratchet with its length** (a 1/4T
  squeezed into six steps is three notes across a dotted quarter, which is not a
  triplet), and `applyChance` cuts the written one the same way.
- **Only six controls are modulatable**: note value, variation, legato, rest and
  the two range knobs — precisely the ones the hardware puts under CV. The twelve
  probabilities, the window and the dice are knobs and buttons only, which is
  what keeps one generator from adding a seventh of the app's mod targets.
  `chance_*` / `chance.*`, setter-driven, gated on `t.chance.on` (`canModulate` /
  `canAutomate`), overrides in `t._chanceMod` and never saved.
- **The generated pitch bypasses `applyScale`.** Every other note in the app is
  snapped on its way out, but here the twelve faders ARE the scale, and snapping
  would quietly delete whichever faders the session scale disagreed with while
  the panel went on claiming them. `from scale` is where the two meet instead.
- **The window tiles across the track** from `first`, exactly as euclid's cycle
  does, and no note crosses its seam.
- **`chanceGen.js` has no imports** — `constants.js` needs the mod-key tables at
  the top of the module graph, and (the better reason) the generator is then a
  pure function that `node --test` can exercise: `test/chanceGen.test.js` pins
  the properties the panel promises, which for the one part of this app whose
  output is *random* is worth a great deal.
- **Settings are outside the p-lock snapshot**, like euclid's and `t.out`.
  Serialized whole (`cloneChance`, not a spread — `pcs` is an array).
- The twelve probabilities stay **sliders**, in `KNOB_EXCLUDE` beside the
  wavetable's harmonic bars and for the same reason: side by side they are the
  pitch profile, and a row of little dials would say nothing.
- The panel's picture is **pitch against time**, not a ring: there is no evenness
  to see here, and a rest, a tie and a leap all have to read at a glance.

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
`out` (`"master"` or an fx bus track's id — where the rack's output goes),
`baseSound` (the sound every unlocked pattern shares),
`glide, swing, density, speed` (`density` is the
dice button's fill level — how full `randomizeMelody` rolls; drag the dice
up/down, painted by `paintDiceDensity`),
`euclid {on, pulses, steps, rotate, gate, accent}` (the euclid generator; `on`
is live mode — see below),
`sampleSpeedMode ("native"|"1xbpm"), sampleDefaults, sampleSource, slices,
sliceOn, sliceBase, slicePlayMode, pitchLock`, sound config
`params/filter/eq/comp/lfoConfig/fxConfig` + live handles
`filterNode/eqNode/compNode/fxRack/lfos/voice/meterAnalyser`,
`midi {outputId, channel}`, `patterns[32]`, `el`, legacy
`uploadAudio/elevenAudio` (base64-persisted sample payloads).

### Global `state`

`tracks, playing, tick, repeatId, nextId, metronome, metronomeLevel (the
metronome button's fill: click volume, dragged like the dice, kept in
localStorage rather than the song), noteColors,
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
  load-bearing bit. `syncTrackSoundUI`, `refreshFxPanelUI`, the hexop / guitar /
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
- **A finger is not a small mouse**, and three things are decided by which is
  driving (`drag.touchLike`). All three are why a phone knob used to hand back
  the value it had before you touched it:
  - **The value stays still inside the long-press slop on touch.** A finger
    resting on a control is never still, and the phone skin puts the whole
    range in 72px, so two pixels of hold were already a couple of steps — a
    press meant as a long press had retuned the parameter by the time the menu
    opened. The drag re-anchors on the crossing, so nothing jumps when it comes
    alive and the whole range is still reachable.
  - **Double-tap-to-default is a mouse gesture only.** Two brief taps on a 44px
    control in a dense panel are something that happens to you on a phone, and
    what it did was discard whatever you had just dialled in. The reset lives in
    the long-press parameter menu instead (`reset to default`, paramMenu.js),
    written through the control's own `input` event so it is indistinguishable
    from turning the knob back by hand — undo included. The mouse path also
    checks whether the gesture WROTE anything (`drag.changed`), not just whether
    it travelled: a sub-slop drag that moved the value is an adjustment, never
    half a double-click.
  - **One pointer drives a knob at a time.** A second finger landing mid-drag
    used to replace the drag outright, after which the first finger's release
    was ignored (wrong pointerId) and the second's, having moved nowhere, read
    as the second of two taps.
- **JS writes two custom properties and knows nothing about circles**:
  `--knob-v` (0..1) and `--knob-a` (the same as an angle). All the shape is in
  `style.css`, so a rack that reads badly as dials becomes bars by overriding
  one selector. Paints are rAF-batched through a dirty set, so a macro pad
  sweeping twenty parameters costs one frame, not twenty. All four are
  **registered with `@property`**, and written to the dial as well as the
  wrapper: the arc is a stop in a cached background-image and the pointer is a
  pseudo-element inheriting from its ancestor, which are the two cases WebKit
  does not re-resolve when an untyped custom property changes — on iOS the
  value moved and the dial went on drawing where the parameter used to be.
- **`setKnobMotion` writes two more** — `--knob-m` / `--knob-ma` plus a
  `data-moving` flag — for the second needle a driven parameter gets
  (modMotion.js). It paints from `--motion-dot`, the same property the dot
  beside the label reads, so the needle and the dot can't disagree about which
  of the two is driving the control. The needle is `.sq-knob`'s own `::after`
  rather than a third element: a span each, hidden or not, is a thousand nodes
  bought to draw a handful of needles.
- **Sizing is `--knob-size` per context** (44px volume, 36px timbre, 26px in the
  hexop operator grid), and `--knob-hit` guarantees a **≥44px target wherever the
  layout has gone mobile** even when the dial is drawn smaller — keyed on
  `(any-pointer: coarse), (max-width: 768px)`, because a touchscreen laptop and
  a phone-width layout both need fingers' room.
- **On a phone every knob is a vertical slider** (the KNOBS ON A PHONE block in
  style.css, keyed on `(pointer: coarse), (max-width: 768px)` — the PRIMARY
  pointer, so a touchscreen laptop keeps its dials). Same wrapper, same
  `--knob-v`; `--knob-len` is the bar's height (72px, shorter in the hexop grid
  and the transport) and `--knob-bar` the drawn track's width. knob.js's one
  concession is `travelFor`: it measures the dial at the start of a drag and,
  finding it taller than wide, takes its height as the full-range travel, so the
  thumb follows the finger 1:1. The drag is still relative — a slider that
  jumped to the touch would be the native range's fault all over again — and
  the horizontal fine-trim, long-press and double-tap are unchanged.
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
  `canModulate(t, key)` gates the picker per engine. Shapes are sine /
  triangle / saw / square, **rnd square** and **euclid**. The last two aren't
  waveforms — they hold a value for a whole step and then jump, so neither is a
  Tone.LFO oscillator type and both take the scheduled-signal path
  (`isSteppedShape`, `makeStepGate`, `scheduleSteppedTaps`); what differs
  between them is only where step *n*'s value comes from, the ring or the hash.
  See the euclid section, and:
  - **rnd square** is sample-and-hold: a fresh random value each cycle, held
    flat until the next. Step *n*'s value is a **hash** of (track id, target,
    *n*) rather than a draw from a running generator, because three paths have
    to agree on it — the taps scheduled into the graph, the rAF setter loop and
    the needle on the knob — and a hash gives all three the same answer from
    the step index alone, with no shared state and nothing extra in the saved
    song. The track id is in the seed so two tracks with a random square on the
    same parameter don't move together; ids are handed out afresh on load, so a
    song replays with a different sequence than it was written with (a random
    modulation that came back identical every time would be a sequence).
  - The row's **phase** knob (`cfg.phase`, 0..1 turns, read through `lfoPhase`,
    shown in degrees) is where in its cycle a shape starts — a quarter turn
    between two LFOs at the same rate is a circular pan. It's applied in one
    place for the value paths (`evalLfoShape` adds it, so the setter loop and
    modMotion's needle get it for free), as degrees on the oscillator for a
    Tone.LFO, and as a shift of the ring's origin for the scheduled shapes,
    which is the only way a scheduled edge can express it. On the euclid ring
    the cycle is one ring STEP — that's what its rate counts — so the knob
    nudges taps off the grid where `rotate` moves whole steps.
    Written lazily, like the euclid fields and for the same reason.
  - The row's two numbers are **amount** and **length**. Amount is the
    peak-to-peak; the **± switch** beside it (`cfg.bipolar`, `lfoBipolar`)
    decides where that hangs — half either side of the slider, or all of it
    above. Unset means the shape's default (a waveform swings, a euclid ring
    taps upward), which is what both did before the switch existed, so no
    saved song changes; it's written only when the switch is touched, for the
    same reason the euclid fields are. One formula covers all three paths
    (Tone.LFO min/max, the scheduled euclid gate, the rAF setter loop):
    normalize the shape to a 0..1 lift, then `(u - 0.5) * amt` or `u * amt`.
  - **Length** is a knob indexing `LFO_DIVS` (constants.js) — the synced
    `cfg.div` in beats, named in steps (½ step … 64 steps), shortest first so
    a rightward turn lengthens the cycle. The knob rounds an off-list value
    (a hand-edited song) to the nearest entry but nothing snaps `cfg.div`, so
    `lfoDivLabel` prints the true step count rather than the nearest name.
    `lfoRateLabel` is the one place the reading beside it is written — the bpm
    field repaints it too. Unsynced, the same slot shows the hz knob and the
    field's label says "rate"; `setKnobReadout` (knob.js) is what makes the
    length knob's drag bubble say "16 steps" instead of "5".
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

**The knob shows where the modulation has got to** (`modMotion.js`). An LFO and
a lane both write around the slider and leave it as the base, which is right —
but it also meant a parameter being swept four times a bar drew exactly the same
knob as one sitting still. One rAF loop resolves each driven parameter's current
value and hands it to `setKnobMotion`, which draws a second needle in the same
colour as the label's dot. Nothing here writes a value: the slider, the stored
sound and a save are all untouched, and a macro pad is left out because a pad
moves the real knob already.

- **The list of what to draw is built by `refreshParamIndicators`**
  (`t._motionCtls`), not by modMotion: that walk already resolves every
  control's owner and works out which side is driving it, and everything that
  changes the answer already calls it.
- **Automation and the setter-driven LFOs are exact.** `runAutomationForStep`
  records the segment it just scheduled (`t._autoLive`) and the loop
  interpolates it at the audio time being heard, so the needle steps with the
  part rather than with the scheduler's lookahead; the setter LFO loop records
  the value it wrote (`t._modLive`), already in the slider's own 0..1.
- **AudioParam LFOs are computed from the shape** (`lfoLiftNow` in lfo.js),
  because a Tone.LFO free-runs inside the graph with nothing to read back — a
  param with a signal connected still reports only its intrinsic value. Rate,
  depth and shape are right; the phase is the display's own.
- **A depth is in the TARGET's units, a needle is in the knob's.** For most
  keys those are the same (`LFO_AMP_SCALE` for a hexop / guitar / bass / contagion
  control IS its knob's range), so the knob's own min..max is the divisor.
  `PARAM_SPAN` in modMotion.js holds the ones that differ — a fuzz drive in
  gain, a silverbox tune knob reading cents into a param in semitones — and
  `PARAM_CURVE` the three that aren't linear at all, cutoff above all: 3kHz is
  most of the dial at 200Hz and a nudge at 15k.

**What is on shows on the track** (`refreshPanelBadges`, paramTargets.js).
Every sound-shaping panel opens as a modal, so a track with a delay on it, an
LFO on the cutoff and a sidechain ducking it used to look exactly like one with
nothing on it until all seven buttons had been pressed in turn. Now each panel
button carries a dot (`data-on`, a count, in the panel's own colour) and a
tooltip naming what is on, and the panel itself is shown INLINE on the track
with only the rows that are on: the rack's engaged stages (by the same level the
rack wires a stage into the chain on, `FX_STAGE_LEVEL_KEY` in constants.js), the
enabled LFO rows, the filter row once it has been closed at all or given
resonance, the env row above zero, the eq when a band moved, the compressor when
its switch is on. Nothing is moved or copied — the panel stays where the markup
put it with `is-live` on it and on its rows, and style.css hides the rest scoped
to `.sq-track`, so the same element opened as a modal is the whole panel again
and every `panel.querySelector` in the app keeps finding its controls. The
lanes stay a badge only: a per-step grid is not a row of knobs. Called from
`refreshParamIndicators` (which already runs after anything that touches the
matrix or the lanes), from `syncTrackSoundUI` (session load, patch load, p-lock
recall), from the value panels' own `input`/`change` events, and from
`openPanelAsModal`'s close, which is what puts the inline view back.

**A rack stage is taken off the track by saying so, not by reaching zero**
(`fxShown` in paramTargets.js, the `×` built in `wireFxPanel`). The stage's
level decides whether it is ON — the badge count, the tooltip, and whether the
rack wires it into the chain, all still `FX_STAGE_LEVEL_KEY` — but it no longer
decides whether its row is SHOWN, because a wet knob passes through 0 in the
middle of a gesture and the row vanishing there took the knob being dragged with
it. So a stage stays on the track once it has been engaged, at whatever level,
until the `×` at the end of its row says otherwise. That button zeroes the level
through the control's own `input` event — indistinguishable from dragging it
there, so the rack, the p-lock snapshot, a save and undo all see it — and drops
the stage from the shown set in the same move. The set is live UI state and is
never serialized: `syncTrackSoundUI` clears it, so a sound arriving from a
session, a patch or a p-lock recall brings its own answer rather than inheriting
the last one's. The `×` is inline-only (style.css): in the modal every stage is
listed whatever its level, which is where a bypassed one is turned back on, so
there is nothing there for it to remove. On desktop the inline rack is a grid
of stage cards, three across at most (`auto-fill` with a minimum of a third
of the panel, 250px at least; name and `×` on the card's top line with the
knobs wrapping under), not one stage per line: five stages stacked
cost more height than the step grid. Below 768px the phone block's
one-row-per-stage layout stands, and the modal is untouched.

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

## Fx buses (`bus` engine — `BusVoice` in voices.js, routing in signal.js)

Everything that shapes a sound in this app belongs to one track: the rack and
the mod matrix are the track's, the automation lanes are the track's pattern's.
An **fx bus** is how several tracks come to share them — a track with no
instrument in it, that other tracks are routed through on the way to the master.

```
bass  ─┐
lead  ─┼─▶ BusVoice.input ─▶ filter ─▶ eq ─▶ comp ─▶ fxRack ─▶ masterGain
drums ─┘   (fader, vol)      one filter, one rack, one mod matrix, one set of lanes
```

- **It is an engine, not a fourth kind of node**, and that is the whole design:
  the summing gain is the only new part, and everything downstream of it is the
  ordinary per-track chain. p-lock, the mod panel, the automation lanes, the
  macro pads, the meter, save/load and the parameter menu all work on a bus
  without knowing it exists.
- **The tap is `fxRack.output`** — a track keeps its own sound on the way to the
  bus, exactly as a mixer's output assignment works. `routeTrackOutput(t)`
  points it at `outputTargetFor(t)`; `refreshAllTrackOutputs()` re-points every
  track, and has to run after anything that rebuilds a voice (a bus's summing
  gain is a new node, and the feeders are still on the old one): `ensureAudio`,
  `setEngineKey`, `applySet`, `applyTrackPatch`, create/duplicate/remove track.
- **`t.out` is `"master"` or a bus track's id**, and it is deliberately outside
  the p-lock snapshot — a send that rewired itself at every pattern switch would
  be a trap. Serialized as `outIndex`, a track INDEX, because `createTrack`
  hands out fresh ids on every load (same reason the macro pads store indices).
- **Cycles are refused.** `wouldFeedback(t, busId)` walks the send chain;
  `setTrackOutput` leaves the track on the master and says so, the dropdowns
  never offer a bus that would loop, and `applySet` drops any loop a
  hand-edited song describes. Web Audio would build that graph quite happily.
- **What a bus can modulate falls out of the existing gates.** `canModulate`
  already answers true for `vol` / `cutoff` / `reson` / every fx key and false
  for the voice params of an unknown engine type; `voiceAutoKeysForEngine`
  already returns `["vol"]` by default. 39 mod targets and 39 lanes, no voice
  keys, without a line of bus-specific gating. `vol` is a real AudioParam on the
  summing gain, so the fader is modulatable too.
- **Mute cuts the audio** (`BusVoice.setMuted`, via `applyBusMute`). Everywhere
  else mute is the transport withholding triggers, and a bus has none — the
  literal reading would do nothing at all. Hence two gains: `input` carries the
  fader (the modulation target), `muteGain` the mute.
- **Solo follows the chain.** `soloAudibleTracks()` (signal.js) keeps whatever
  feeds a soloed bus, because a bus makes no sound of its own and the literal
  reading would leave the session silent.
- The transport skips a bus after `runAutomationForStep` — mute/solo can't gate
  it there (its lanes have to keep running for the tracks feeding it), and
  everything below that line fires a note.
- **A bus always sits at the bottom of the track list** (`placeBusesLast` in
  render.js, which moves `state.tracks` and the DOM together): it is the end of
  a chain, so the tracks feeding it read as a group above it. Called from
  `createTrack`, `duplicateTrack`, `setEngineKey` and `applyTrackPatch` (a patch
  carries an engine, so a track can become one), and once at the end of
  `applySet`. Once, at the end — not per track — because every cross-track
  reference in a song is an INDEX INTO THE SERIALIZED ORDER (`outIndex`,
  `compSourceIndex`, the macro pads' `track`), so `applySet` resolves those
  against the order it created the tracks in (`made`, and `applyMacroPads`'s
  second argument) and reorders only once they are ids.
- UI: `+ add fx bus` under the track list, an `out` select per track (hidden
  until a bus exists), a `◂ what feeds me` line on the bus, and `is-bus` on the
  track node, which style.css uses to hide the step grid, the roll, the dice,
  the octave shifts, the patch buttons and the envelope — a bus plays no notes.

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
  returns to and to move the knob. All 191 automation keys resolve.

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
  to `baseSound` but *keeps* its snapshot. Neither direction destroys anything,
  so a lock flipped by accident costs nothing even without reaching for undo.
- **The button state belongs to the pattern**, so it changes under you on a
  switch — `switchPattern` calls `refreshAllPatternLockUI()`.
- `serializeSet` calls `flushAllPatternSounds()` first: a sound is only written
  back when you *leave* a pattern, so without the flush the sound you can
  currently hear is the one thing a save would miss.
- **Loading recalls a LOCKED pattern's sound and nothing else**
  (`recallLoadedPatternSound`, the one call `applySet` and `mergeSet` share).
  The flush above is what makes that right: it leaves the track-level fields
  and `baseSound` agreeing, so re-applying `baseSound` on the way back in is a
  no-op for every session this app writes — and for a blob assembled some other
  way it silently undoes what the blob said. It did: the song builder writes
  `t.params` and has never heard of `baseSound`, so a sound edit from the
  compose panel was discarded on the active pattern (measured: cutoff 700 asked
  for, 1 loaded). On a pattern SWITCH the unlocked branch is still the whole
  point, so `recallPatternSound` keeps it.
- `clonePattern` copies `soundLocked` and deep-copies `sound`, so duplicating a
  locked pattern (button or drag) gives a locked duplicate that sounds the same
  and then diverges.

## Keyboard performance mode (`keyboard.js`)

Always live on desktop (≥769px; text inputs swallow keys). Ableton-style:
`a s d f g h j k l` = white keys, `w e t y u o` = black keys, `z/x` octave.
Scale-aware mapping when a scale is active; chord mode (off/root). Live
record onto the playing pattern, plus retroactive **Capture** (32s rolling
buffer, slices back to the last 1.5s silence gap and writes a clip).

**Chord mode is not only a keyboard feature**, which is why it has a way in on a
phone. `state.kbdChordType` / `kbdChordCpx` / `kbdArp*` also decide what a
*tapped step* writes (`startNote` in track.js builds the chord on whatever root
the step would have taken, and `applyKbdArpToStep` stamps the arp settings onto
it) — so hiding the cluster below 768px, as the rest of the keyboard controls
are hidden, took a sequencing feature away rather than a keyboard one.
`#chord-menu-btn` (`sq-mobile-only`) hosts the same panel in a modal
(`openChordMenu`, scaleUI.js), moved rather than rebuilt in the manner of the
pattern bar's mobile menu, so main.js's listeners and `refreshChordTypeSelect`'s
option rebuilding go on working on the one set of controls. Hence two things:
the mobile hide rule is scoped `.sq-transport #kbd-chord`, or it would reach
the panel inside the modal too; and the per-control labels
(`.sq-kbd-chord__sub`) ship in the markup hidden, appearing only in the sheet,
where the row is stacked and "chord" alone no longer names six controls.
`syncChordUI()` is the one function every chord/arp change calls — it syncs the
arp group's visibility AND the button, whose label is the current setting
(`chord min7 · arp`), because on a phone the button is all of the cluster you
can see.

## Server / data surface

| surface | what |
|---|---|
| `POST/GET app/api/share/route.ts` | anonymous `?s=<slug>` share links (public `songs` rows) |
| `POST app/api/compose/route.ts` | starts one compose turn → `{jobId, jobToken}`; the turn runs in `netlify/functions/compose-background.mjs` |
| `GET app/api/compose/status/route.ts` | what the browser polls while one runs — activity, then the song |
| `app/songs/actions.ts` | `saveSong` / `saveNamedSong` (both append a version), `listSongs`, `loadSong`, `forkSong`, `listVersions`, `loadVersion`, `labelVersion`, `deleteVersion`, `setSongTemplate`, `setDefaultTemplate`, `getDefaultTemplate` |
| `app/patches/actions.ts` | `publishPatch`, `listMyPatches`, `listPublicPatches`, `getPatch`, `deletePatch` |
| `app/profile/actions.ts` | `getMyProfile`, `updateProfile`, `getPublicProfile` (+ that user's public songs/patches) |
| `app/auth/actions.ts` | `signIn`, `signUp`, `signInWithMagicLink`, `signOut` |
| `app/account/actions.ts` | `updateEmail`, `updatePassword`, `deleteAccount` (RPC `delete_own_account`) |

`/u/<username>` is the public profile page with fork buttons. The engine side
of save/share lives in `session.js` (`serializeSet`/`applySet`) and is bridged
through `window.seqbaby`.

## The share card (`app/shareCard.ts`)

A share link points at the studio with the song in the query, so the link
preview was the studio's own card however specific the thing being shared —
twelve people posting twelve songs all got "seqbaby". A URL that names a song
(`?s=<slug>` or `?open=<id>`) is now titled with the song.

- **One card, built in one place.** og/twitter metadata does NOT inherit field
  by field between segments: a page that sets `openGraph` replaces the layout's
  whole object, so the image, the url and the type would have gone missing from
  the song card if it were written out separately. `shareCard(title, desc)`
  returns both blocks; layout.tsx passes the site's own title, page.tsx the
  song's.
- **The lookup only happens when the URL carries one.** Metadata is resolved
  before the document flushes, so a Supabase round trip on every visit would
  hold back the engine's preload hints for everyone — the same reason the
  account bar sits behind `<Suspense>`. A plain `/` does no work in
  `generateMetadata` at all; a `?s=` visit is already waiting on a fetch of the
  session itself.
- **`linkedSongTitle`** (`app/songs/linkedSongTitle.ts`) is the lookup, and it
  is deliberately not a server action — nothing on the client should be able to
  ask the server to resolve arbitrary slugs to titles. `?s=` filters
  `is_public` exactly as the share route does; `?open=` leaves it to RLS, so a
  crawler sees only published songs while the owner following their own link
  gets the real title in the tab.
- **`untitled` counts as no title**, along with an unreadable song, a legacy
  Netlify Blobs share (a bare session blob, with no title in it) and no
  Supabase env at all. Every one of those falls back to the site card rather
  than failing the page: a link preview is not worth a 500.

## The studio on a phone (the mobile block in `style.css`)

Three media queries decide what "a phone" means here, and they are deliberately
different tests:

- **`(max-width: 768px)`** — the layout. The track head's rows, the track menu,
  the session menu, the step grid's tall cells.
- **`(pointer: coarse), (max-width: 768px)`** — the knobs drawn as vertical
  sliders (see the Knobs section). The PRIMARY pointer, so a touchscreen laptop
  keeps its dials.
- **`(any-pointer: coarse), (max-width: 768px)`** — `--knob-hit`, the 44px
  target under a knob drawn smaller. A touchscreen laptop wants the room even
  though it kept the dial.
- **`(pointer: coarse) and (min-width: 769px)`** — a touch device too wide for
  the phone layout, which is what a phone in landscape is (844px). It keeps the
  desktop arrangement, which is right — every pattern slot and every track
  control on screen at once — but it was also keeping the desktop's 24-30px
  buttons under a finger while the knobs beside them already had their 44px. A
  34px floor only: 44 everywhere would wrap the transport onto four lines.

**Icon buttons name themselves.** A `title` is a hover and a finger cannot
hover, so the dice, the ring, the die, the sample editor, `clear`, `roll` and
the "more" toggle were seven unlabelled glyphs in a row with no way to find out
what any of them did — and the generators behind three of them are most of what
the app can do. Each carries its name under its icon, from `data-label` on the
button (studioMarkup.ts, plus render.js for the two it builds and main.js for
the session menu's mode / switch pair, whose captions track their state). Under
rather than beside: a caption beside the glyph doubles the button's width and
six of those do not fit across a phone, where icon-over-caption is 44px wide —
which is the target size they needed anyway. `clear` and `roll` already carried
a `.sq-btn__label` span for their desktop text, so they use that instead of a
second attribute. The `::after` that prints it is inside the 768px block, so
desktop is untouched.

**`.sq-track__head::before` is a line break.** A flex container's own
pseudo-element IS a flex item, so a zero-height one with a 100% basis breaks the
line — which is the only way to put a break at a chosen point in a wrapping row
without adding a wrapper to the markup, and the track head's children are
queried from a dozen places by their position in it. `order` places it, and the
head's children carry explicit orders around it: name / engine / len, then vol
beside solo / mute / p-lock, then the synth row, then the generator buttons.
Vol used to hold a line of its own — one 44px control centred in 374px of
nothing — with those three buttons pushed underneath it.

**Panels drill down, they do not stack.** The sound-shaping buttons are
physically moved into the track menu (`openTrackMenu`), which is itself a modal,
so a panel opened from there landed on top of it with two `done` buttons on
screen. `bindModalOpen` closes the track menu first — before `openFn`, because
closing it moves that very button back into the track head, which is where the
panel's own close looks for it to unpress it.

**The fx rack is fifteen stages deep**, and each one was a name on a line of its
own with its controls tucked under the left end: ~120px of height carrying
~140px of controls across a 374px row, so reaching the reverb was a 1900px
scroll that was mostly empty. The name sits on the stage's own line now, in a
fixed column the eye runs down, with the controls in the space they were
leaving. Measured, the panel went from ~2400px to ~1200px.

**What the keyboard cluster leaves behind.** `#kbd-octave` is hidden outright
with `#kbd-label` / `#kbd-record` / `#kbd-capture` / `#kbd-icon`: it reads the
base octave that `z` and `x` shift, and with the keys gone it was a bare "C4" in
the middle of the transport that nothing on a phone could change or act on. It
is the opposite case to the chord cluster beside it (see "Chord mode is not only
a keyboard feature" above), which had to be rehomed rather than hidden because
it decides what a tapped step writes — hence that one's hide rule is scoped
`.sq-transport` and this one's is not. `#kbd-octave` is a sibling of
`#kbd-chord` rather than inside it, so `openChordMenu` does not carry it into
the modal and the flat rule is safe.

**Copy that names a gesture has to name the right one.** The mod panel's hint
goes through `isMobileDevice()` (`long-press` / `right-click`); the preloader's
tips and `HELP_TIPS` are already scoped `any` / `touch` / `desktop` for the same
reason, and a new one belongs in whichever of those three it is true for.

## The account bar on a phone (`AccountBar.tsx` + `ui.module.css`)

The bar is one right-aligned row that does not wrap, so on a 390px phone the
items past the left edge were not squeezed — they were gone, with no way to
scroll to them, `sign out` and `settings` first. Below 768px it collapses:
`manual` stays in the bar, everything else moves behind one `menu` button and
opens as a sheet under it.

- **The items are rendered ONCE and moved by CSS**, not duplicated into a
  separate mobile menu. `SaveButton` and `SongsMenu` each hold their own open
  state, the name they have offered and a list fetched from the server; two
  live copies of that are two answers to "what is this song called".
- **A tap in the sheet closes it, except on `save` and `songs`**, whose whole
  job is to open a panel of their own. Both are `songsWrap` wrappers, so one
  `closest()` on the way up covers them and neither has to be told the sheet
  exists.
- **The dropdown panels stop being dropdowns.** A 300px panel hung off a button
  near the right edge is cut off by the viewport whatever the bar does, so
  under 768px `.panel` is a fixed sheet at the bottom of the screen — which is
  also where a thumb is. `fixed` is against the viewport, so it lands in the
  same place whether the button is in the bar or in the menu sheet.
- **The bar is raised to 250 while the sheet is open** (`topBarMenuOpen`), over
  an engine modal (z-index 200) — the sheet is what the tap is aimed at, so for
  as long as one is open it wins. It only raises the z-index: overriding
  `position` here would unpin the bar (see the pinning section below) for
  exactly as long as the menu was up. Inside that stacking context the backdrop
  is a positioned child, so `manual` and the `menu` button need a layer of
  their own or the backdrop swallows the tap that closes the sheet.
- Rows are 44px minimum, and above phone width (481px+) the sheet and the
  panels cap at 340 / 420px and hang off the right — a 700px-wide row of seven
  buttons reads as a mistake.

### The bar is pinned, and so is the transport under it

Both are `position: sticky`, and they are siblings in the document — the bar is
rendered by `page.tsx` ahead of the engine's markup, the transport is inside it
— so there is no one element to pin. The bar takes `top: 0` and the transport
takes the bar's height as its own offset, `--sq-topbar-h`. Without that they
would both stick at 0 and pile onto the same line the moment the page scrolled.

- **The height is measured, not written down.** A ResizeObserver in
  `AccountBar.tsx` writes `--sq-topbar-h` onto `<html>`; the fallback in
  `public/style.css` is `0px`, which is what the legacy static server and any
  page with no bar want. A constant that was a pixel out would show as a seam
  or a clipped border for every visitor, and the bar's height is whatever 12px
  monospace and a row of bordered buttons come out at.
- **The bar's permanent z-index is 50**: above the studio's ordinary content,
  below an engine modal (200), which is where a pinned bar belongs. Under the
  preloader the point is moot — `html.sq-preloading` sets `overflow: hidden`,
  which suspends sticky along with the scrolling it exists for.
- **A z-index makes the bar a stacking context**, and the compose drawer is a
  child of it that is meant to sit OVER a modal (z-index 300). Clamped to the
  bar's 50 it would have gone under one. So `.topBar:has(.chatPanel)` lifts the
  bar to 300 for as long as the drawer is open — the same bargain
  `topBarMenuOpen` strikes on a phone, with `:has()` meaning the drawer does
  not have to tell the bar anything.

## Song versions — a tree, not a blob (`song_versions`)

Saving an existing song used to overwrite `songs.data`, so the state before that
save was gone. Every save now also appends a row to `song_versions`, pointing at
the version it was saved FROM — which is what makes the history a tree rather
than a list:

```
v1 ──▶ v2 ──▶ v3 ──▶ v5      (kept editing)
        └───▶ v4              (opened v2, saved: a branch)
```

- **`songs.data` is untouched by all this** and still holds the song's current
  state. Share links, `/u/<username>`, `loadSong` and the anonymous `?s=` route
  read it and none of them learned anything about versions. It mirrors whatever
  `songs.current_version_id` names.
- **The parent is the client's**, not the server's: `saveSong` /
  `saveNamedSong` take `parentVersionId`, defaulting to the song's tip. Open v2
  and the next save names v2, so it branches instead of burying it. That is the
  entire mechanism.
- **Which version is open is shared module state** (`app/songs/openSong.ts`),
  because two islands need the same answer — the songs menu opens versions and
  the top-bar save is what people press afterwards. Both are mounted separately
  by a server component, so there is no React parent to hang a context on.
- **A save identical to its parent returns the parent.** These blobs are whole
  sessions, base64 sample payloads included; pressing save twice must not put a
  duplicate copy in the tree.
- **`seq` is the version's name** (`v4`), unique per song, and stable when a
  sibling branch appears later. `max()+1` is not atomic, so the writer retries on
  the unique violation the way `publishSong` retries a slug.
- **No public-read policy, deliberately** — `songs_public_read` has no
  counterpart on `song_versions`. Publishing a song publishes the state you chose
  to publish, not every draft behind it. `supabase/tests/rls_test.sql` asserts
  that both behaviourally and structurally, because adding one to "match" songs
  is exactly the plausible-looking mistake.
- **Deleting a version is refused for the tip and for any version with children**
  — `parent_id` cascades, so pruning a version with a branch under it would take
  the branch too, and undo does not reach the server. Deleting the SONG still takes its
  whole history (`song_id` cascades).
- **A fork starts a fresh tree** rooted at the copied state. The source's history
  belongs to the source's owner and isn't readable anyway; `songs.forked_from`
  still records the ancestry between songs. `fork` in the version tree is the
  same thing from one version — a way to turn a branch into its own song, and it
  is deliberately spelled the same as the songs-menu and profile buttons because
  it is the same operation with a different starting point. `branch` stays the
  word for the in-tree move (saving from an older version); `fork` always means
  leaving the tree.
- Migration `0009` backfills a root version for every existing song, so the
  first save after deploying branches off something rather than starting a second
  root.

## Templates — a song you start from (`songs.is_template`)

A template is an ordinary song with a flag on it. What the flag changes is one
thing: **the first save while a template is open makes a NEW song** instead of
another version of the template. So a starting point stays a starting point,
and the twelve songs written from it are twelve songs.

```
techno starter  (template, default)
      │  open it, write something, save
      ▼
cold squelch  v1 ──▶ v2 ──▶ v3     its own song, its own tree
```

- **Two booleans, no new table** (migration `0010`). `is_template`, and
  `is_default_template` for the one a new session starts from. Templates are
  listed apart in the songs menu, but everything else you can do to a song you
  can still do to one — publish it, fork it, walk its version tree.
- **Where a save goes is the writer's rule, not the database's.** The migration
  does not stop a version being appended to a template; opening one, unmarking
  it and saving is a perfectly reasonable way to *edit* the template. What
  detaches the save is the studio saying it is holding one.
- **`openSong.isTemplate` is that saying**, and it is cleared by the save that
  used it, so only the FIRST save detaches and everything after it is an
  ordinary new version of the song just made. It lives in the shared store
  (`app/songs/openSong.ts`) for the reason `versionId` does — both save UIs have
  to agree — and because the studio can hold a template nobody opened, since
  `new` starts from the default one.
- **`saveNamedSong` upserts BY TITLE, so dropping the id is not enough**: a save
  under the template's own name would land on the template. On the template path
  that lookup is skipped entirely, the title always goes through `freeTitle`
  (two songs sharing a title would leave the *next* save upserting onto whichever
  sorted first), and both save UIs offer a generated name rather than the
  template's — "techno starter 2" is a poor name for a song and a confusing
  neighbour for the template in the list.
- **`forked_from` records where it came from**, the same column a fork uses, and
  the new song's first version is labelled `from template`. A song made from a
  template is never itself one.
- **At most one default per account, enforced by a partial unique index**
  (`songs_one_default_template`), because `setDefaultTemplate` clears then sets
  and a second tab racing it would otherwise leave an account with two defaults
  and no way to say which is meant. A CHECK keeps a default a template: the
  toggle is only drawn on templates, and a default that was not one would be
  invisible and still be what `new` loads.
- **The engine learns nothing.** `newSet()` still means the six starter tracks;
  `app/DefaultTemplate.tsx` applies a session over the top afterwards. So the
  legacy static server, a signed-out visitor and an account with no default all
  get the blank editor they always did. It answers to `seqbaby:newset` (the top
  bar's `new` and the logo) and to a fresh load of `/` — skipped when the URL
  carries `?s=` or `?open=`, which load asynchronously too and would otherwise
  race it. The fetch is caught, not just awaited: with no Supabase env the
  action throws, and the engine is meant to run without any.

## Writing a song without a browser (`songBuilder.js` + `mcp/`)

Everything in the studio edits a live session, so an agent had no way to
make a song short of driving the UI. What it can produce is the one thing the
studio also reads: the serialized session. `songBuilder.js` builds that blob
from calls, and `mcp/server.mjs` puts those calls on the wire as MCP tools.

```
agent ──▶ mcp/server.mjs ──▶ songBuilder.js ──▶ { _version, bpm, tracks: [...] }
              │                    │                       │
   resources: the engine     validates against     applySet (the studio), the import
   catalog, the targets,     engineData.js,        button, POST /api/share → ?s=<id>,
   the compose guide         constants.js ...      or audition.mjs (headless, meters)
```

- **The builder is pure, and that decided where the engine's tables live.**
  It imports only engineData.js, soundDefaults.js, theoryData.js,
  constants.js, chanceGen.js and sessionFormat.js, none of which touch the
  DOM, Tone or a worklet, so `node --test` runs it. That is why the panel
  tables moved out of hexop.js / guitar.js / bass.js / subbass.js /
  contagion.js and the defaults out of track.js / fxRack.js / signal.js:
  validating an agent's `gtpick: 0.9` against a COPY of the guitar's range
  table would be right until the next control was added. Each engine module
  re-exports its own tables, so the "one list, three namespaces" story in
  each of them is unchanged; the list is one file over.
- **The song it writes is sparse.** A track is an engine key, a name, a
  length, and only the params / filter / fx / lfo entries that were set;
  applySet fills the rest through createTrack, from the same defaults
  (soundDefaults.js) the panels start from. Two things are written whole
  because the loader takes them whole: an fx stage (`Object.assign` on
  `t.fxConfig` is shallow, so `{ delay: { wet } }` alone would lose the
  delay's time) and an LFO entry. Patterns are written with every per-step
  array (`emptyPatternBlob`, checked against emptyPattern's field list by
  the tests), and the cross-track references are indices, as in the format.
- **It refuses what the studio would refuse, with the reason.** An engine
  that does not exist (with near misses), a param outside its slider's
  range, an LFO on a key the engine has no AudioParam for (`canModulateKey`,
  the same gate the mod picker uses), a lane on a generator that is off, a
  send that would feed back, a sidechain from itself. Every refusal is a
  `SongError` whose message names the choices, because the reader is an
  agent that will act on it.
- **Step strings** are the way in for rhythm: `x` hit, `X` accent, `o` soft,
  a digit 1..9 a velocity, `.` rest, `_` a tie extending the hit before it,
  a shorter string tiling a longer pattern. `describePattern` reads one back
  the same way, so `get_song` shows an agent what it wrote in the notation
  it wrote it in.
- **The MCP server holds one song** and keeps the tool list short (33 tools:
  song / engines / tracks / steps / sound / modulation / generators / out).
  What an agent needs to KNOW is served as resources rather than packed into
  descriptions: `seqbaby://engines` (the catalog with what each slider does
  per engine, every panel control with its range, the presets, the targets
  each engine takes), `seqbaby://targets`, `seqbaby://samples`,
  `seqbaby://format`, `seqbaby://song`, and `seqbaby://guide`.
- **The guide is the compose skill** (`.claude/skills/compose/SKILL.md`),
  read by the server at request time with its front matter stripped, so
  there is one copy. The tools give an agent the ability to write a song;
  the skill gives it taste: which engine for which role, that a silverbox
  accent is a velocity above 0.6 and a slide is a tie, that subby needs
  drive to be heard on a phone, that a reverb belongs on a bus, and the order
  of work. Its front-matter description is short on purpose: the description
  sits in every context, the body loads when someone asks for music.
- **`audition_song` is the one way an agent can hear.** `mcp/audition.mjs`
  opens the studio in a headless Chromium (playwright, optional), `applySet`s
  the song, presses play and reads every track's `meterAnalyser` and the
  master for a few seconds: rms and peak in dB, a `silent` flag, whether the
  master is near the limiter. One buffer per analyser at its own fftSize: a
  shared one kept the tail of a louder track's read and handed every quieter
  track the same peak. `SEQBABY_URL` picks the studio (the live site by
  default, a dev server for work on the engine).
- **share_song is the anonymous share route**, `POST /api/share` with
  `{ session }`, which is unauthenticated by design: an agent needs no
  account to hand back a link. Saving into an account (`saveSong`) is a
  server action behind Supabase auth and is deliberately not a tool.
- Adding a tool: a function in songBuilder.js (validate, mutate the song,
  return something an agent can read), a test, and a `registerTool` in
  server.mjs with a zod shape. Adding an engine control: its table entry in
  engineData.js is all the builder needs; the compose guide is where to say
  what it is FOR.

## Compose chat — and whose key it runs on

The same tools the MCP server hands an external agent, offered in the studio as
a panel: say what you want, and the song open in front of you changes. The
song's state is never kept here — the studio's session is the truth and each
message resends it, so an edit made by hand between messages is what the next
one edits. The reply is not written back on its own: a turn that changed the
song lands in a review bar, to be auditioned into what is playing or kept (see
the audition section below).

```
panel ──▶ POST /api/compose ──▶ createJob ──▶ POST the worker {jobId, token, apiKey?}
   │                              (record)                    │
   └── polls /api/compose/status?id=&t= ◀── progress ◀─────────┘ runComposeTurn
```

- **A turn is a job, not a request.** Writing a whole song is dozens of model
  rounds over minutes, and a synchronous function gets 26 seconds (measured: a
  turn died at 28s — streaming does not buy time, it only moves where the cut
  lands). So the route starts a background function and answers immediately,
  and the browser polls. `next dev` has no background functions and no ceiling
  either, so there the same loop runs inline; one loop, two callers.
- **Two ways a turn is paid for, and that decides what it needs.** The
  deploy's key (`ANTHROPIC_API_KEY`) needs an account, because the spend is the
  site's. A key the visitor brings needs **nothing at all** — no account, and
  no key on the deploy — because the spend is theirs. That is the whole reason
  the panel is rendered outside `AccountBar`'s signed-in branch: a key of your
  own is the one way to compose here without an account, and a deploy with no
  key of its own still has a working compose panel.
- **A brought key is never stored.** It rides the message it pays for, and the
  route hands it to the worker in the same fire-and-forget POST that starts
  one. It is deliberately NOT on the job record — that record is a Netlify
  Blob that outlives the turn, which is exactly what a key must not do. What
  the record gets is `keyHash` (sha-256, truncated), because the limits have to
  be counted against something and with no account that key is the only
  something there is.
- **Two secrets per job, because there are two readers.** The worker token says
  an invocation came from the route that created the job (the worker endpoint
  takes nothing but an id). The **view token** is how a browser proves a job is
  its own to poll: a job holds somebody's song, and a signed-out visitor has no
  account to check that against. An account still reaches its own jobs without
  one, which is what keeps a job created before view tokens existed readable.
  The status route tries the token first and only then resolves a session —
  validating one costs a Supabase round trip, and this is polled every couple
  of seconds for as long as a whole song takes.
- **The limits ration the WORKER, not the bill.** `MAX_IN_FLIGHT` /
  `MAX_PER_HOUR` apply to a brought key as they do to an account, counted in
  its own bucket (`keys/<hash>` beside `users/<id>`), because a turn holds a
  15-minute function whoever is paying for the tokens. A brought-key turn
  counts against the key even when an account is signed in: one person with
  their own key should not also be spending the account allowance they aren't
  using.
- **The model allowlist survives both paths** (`lib/composeModels.js`). On the
  site's key because the site is billed; on a brought key because an id nobody
  vetted is a request this app would be making on someone's behalf without
  knowing what it costs.
- **The key lives in the browser, and the panel says so.** `localStorage`
  (`seqbaby.anthropicKey.v1`), which survives a reload — the thing that makes
  the feature usable — and is readable by anything that gets script into this
  origin, which is the honest cost and why `remember` is a checkbox: unticked,
  the key lives in the tab and nowhere else. A stored value that no longer
  *looks* like a key is dropped rather than sent, since it can only fail, and
  it would fail a minute into a turn. It is shape-checked in the panel as well
  as in the route because the field it was typed into is the only place a typo
  can be fixed.
- **The conversation follows the song** (`song_chats`), so a signed-out
  visitor's turns keep no transcript beyond the tab: there is no song to attach
  one to. Everything else about the panel — the model picker, the activity
  line, the warnings — is the same on either key.

## A session onto a RUNNING engine (`liveSet.js`) — and the audition

`applySet` is how a song arrives: it stops the transport, tears down every
track and voice, and builds the whole session again. That is right for opening
a song and wrong for every case where the session you are holding is *nearly*
the one that is playing — an undo, and the compose panel asking for a bassline
while you are listening to the drums. Writing a turn straight in with
`applySet` is what used to silence the track you were playing.

```
mergeSet(s)   validate  ->  globals  ->  tracks gone  ->  tracks made / kept
              (first,       (each        (removeTrack)    (loadTrackFromData,
               nothing       guarded                       or updated in place)
               torn down     on having
               on a throw)   moved)      ->  the sends and sidechains  ->  order
```

- **Three pieces, and two of them were already written.**
  `applyGlobalsInPlace` and `applyTrackInPlace` are history.js's in-place
  restore, moved here: an undo and an audition want the identical thing, and a
  second copy is how the two would come to disagree about what putting a track
  back means. history.js still owns *when* a session is written; this owns
  *how*. `mergeSet` is the new part — the tracks that appeared, the ones that
  went, and the ones whose engine changed under them.
- **Undo goes through it too.** Stepping back across an added track used to
  fall back to `applySet` and stop the transport; it doesn't now. The old split
  was never about undo, it was about not having a merge (see the undo section).
- **A track that needs its voice rebuilt is removed and re-made**, through
  `loadTrackFromData` — session.js's own per-track reader, the one `applySet`
  uses, exported for this. Rebuilding a voice in place would be a third loader.
  `MERGE_REBUILD_KEYS` is `TRACK_REBUILD_KEYS` minus `outIndex` /
  `compSourceIndex`: history falls back to `applySet` for a re-routed send
  because the track it now points at may itself be being rebuilt, but a merge
  resolves every send in a pass of its own, and `routeTrackOutput` re-points a
  live output under a fade. Re-pointing is not rebuilding.
- **Which live track an incoming track IS, is `alignTracks`.** Identity is
  `engineKey` plus `name` — what the compose tools address a track by and what
  a person reads down the left of the studio — matched in three passes: same
  slot, then anywhere, then whatever is left in order. The first pass is the
  case that matters: a session that went to the model and came back with a
  track appended matches straight down the line, so **nothing that was already
  playing is touched at all** (measured: the other six tracks keep the same
  `voice` and `fxRack` objects). The third is what makes a rename or an engine
  change an edit to a track rather than one track going and another arriving.
- **Three passes over the tracks, and the order is forced.** Nothing can be
  updated in place until every track exists, because a sidechain source is an
  INDEX into the incoming session and may name a track made a moment ago; the
  sends are resolved after that for the same reason; and only once every
  cross-track reference is an id may the list be reordered (`setTrackOrder`,
  then `placeBusesLast`). Exactly `applySet`'s rule.
- **The transport is not in the format, and neither is the view.** `applySet`
  stops the transport as a consequence of tearing down, never as a decision, so
  a merge simply doesn't. `activePattern` is left alone too, the call history.js
  already makes: moving the playhead to another pattern mid-bar is not a change
  to the song.
- **A blob's own fields win over its `baseSound`**, and both loaders now say so
  — `recallLoadedPatternSound` (patternSound.js) is the one call they share.
  Only a LOCKED pattern's sound is recalled on a load; an unlocked one shares
  the track's, and the track-level fields the blob just wrote ARE that sound.
  `applySet` used to re-apply `baseSound` over them, which for every session
  this app writes is a no-op (`serializeSet` flushes, so the two agree) and for
  a blob assembled another way silently undid it. The song builder writes
  `t.params` and has never heard of `baseSound`, so that was every sound edit
  the compose panel made: measured, asking it to open the filter moved
  `t.filter.cutoff` to 700 and the load put it back to 1.
- A track that appears joins on the step everyone else is on — `createTrack`
  has set `trackTick` from `state.tick` since long before this, for exactly
  this case. Measured: merging a track into a playing session leaves `playing`
  true and the tick monotonic throughout, and the new track's meter comes up at
  the level its steps deserve.
- Exposed as `window.seqbaby.mergeSet` (appApi.js), beside `applySet`.

### The compose panel's audition (`app/ComposeChat.tsx`)

A turn that changed the song no longer lands in the studio. It lands in a
**review bar** between the log and the input, with three buttons:

```
audition   merge it into what is playing, keeping the session it replaced
stop       write that session back — the changes are still on offer
keep       they are the song now — and a version of it is saved
discard    throw them away (putting back the pre-audition session first)
```

- **Both directions are one call.** Auditioning merges the turn's session;
  stopping merges the one captured on the way in. `before` on the proposal is
  that session, and `null` means the changes are not in the engine at all yet.
- **Keeping mid-audition writes nothing.** The engine is already playing them,
  hand edits since included — which is the right answer to "keep what I am
  hearing". Stopping takes those hand edits back with it; undo reaches them,
  which is why it is a button and not a confirm dialog.
- **Nothing had to be told about undo.** history.js watches the events an
  interaction ends in, so the click on `audition` banks the merge as one
  labelled step (the label comes off the button's own text) — and `keep`
  mid-audition changes nothing, so it leaves no second entry. Undoing across it
  does fall back to `applySet` and stops the transport, which is what the
  `stop` button is for.
- **Keeping autosaves a version**, because nobody presses the top bar's `save`
  in the middle of a conversation — a kept turn used to live only in the tab it
  was asked for in, one reload from being a transcript about a song that never
  got the changes it describes. The rule is the top bar's exactly (`saveSong`,
  the open song, branching off `openSong.versionId`), so a conversation started
  from an older version still branches rather than burying it, and the store is
  moved on to the version just written so the next save — from here or the top
  bar — hangs off it. What is saved is the ENGINE's session, not the turn's:
  mid-audition that is the changes plus anything moved by hand since, which is
  the same thing `keep` means. The version is labelled with what was asked for
  (`compose: give it a hi-hat` — `label` on `saveSong`, new), because a tree of
  saves nobody pressed is unreadable without one.
  **Nothing is saved when there is no song to save into** — signed out, a
  session nobody has named, or a template, whose first save MAKES a song and is
  therefore a decision with a name attached. Inventing one here would put a row
  in somebody's list under a name they never saw, so the line where the review
  bar was says `press save to keep it for good` instead. It says what happened
  either way: a `keep` that kept nothing anywhere is the thing worth knowing.
- **Sending the next message settles the last proposal.** The session being
  serialized is what the model is being asked about, so whatever is in the
  engine — an audition included — is what that turn builds on, and there is
  nothing left to put back to.
- **A closed drawer hides the bar but not the audition**, so the `compose`
  button carries a dot and says which state it is in. An extra track playing
  with nothing on screen explaining it would be a bug report.
- `new`, and opening a different song, drop the proposal: `before` describes a
  session that is no longer there, and putting it back would undo the `new`.
- `applySet` is still the fallback in `writeLive`, for an engine cached from
  before `mergeSet` shipped. It costs the transport, which is the thing the
  merge exists to avoid, but it is never silence.

## Undo / redo (`history.js` + `historyStore.js`)

A stack of whole-session snapshots, not a log of inverse commands, and nothing
had to be instrumented to fill it.

```
edit ──▶ (420ms of quiet) ──▶ serializeSet() ──▶ fold onto the last snapshot
                                                        │
                            identical? ─ yes ─▶ no entry, nothing changed
                                       └─ no ──▶ push it (sharing everything
                                                  that did not move)
```

- **The stack is fed by watching, not by being told.** The alternative was a
  `markEdit()` call at every mutation site — the step grid, the roll, both
  generators, the dice, clear, every track button, the pattern bar, all 1063
  parameter controls — and the first one anybody forgot would be an edit you
  cannot undo. Instead one delegated capture-phase listener watches the events a
  human interaction ends in (`pointerup` / `keyup` / `change` / `input` /
  `drop`), waits for the gesture to settle, and asks the session whether it
  changed. Whatever produced the change is undoable without knowing history.js
  exists. Capture phase because the step grid and the roll stop their events
  from bubbling.
- **`serializeSet` is the snapshot**, which is what makes "cannot be forgotten"
  true: a field it missed would already be a field a *save* loses. 4ms on a full
  six-track, 32-pattern session (389KB), taken once per settled gesture.
- **Structural sharing is what makes it affordable** (`shareStructure`). Each new
  snapshot is walked against the previous one and every subtree that did not
  change is replaced by the OLD one's object, so toggling a step costs one
  pattern object and the other 191 in the session are shared with every earlier
  entry. Memory is proportional to what changed, not to the depth of the stack.
  The same pass answers three questions at once: what to store, **whether
  anything changed at all** (`shareStructure(last, fresh) === last`), and — since
  adjacent snapshots are then `===` everywhere they agree — what the restore has
  to touch.
- **Restoring never stops the transport.** A snapshot goes back through
  **`mergeSet`** (liveSet.js) — the session format written onto a running
  engine, tracks appearing and going included — so stepping back across an
  added track, an engine change or a re-routed send costs what stepping back
  across a step toggle costs. history.js decides WHEN a session is written;
  liveSet.js is the whole of HOW, shared with the compose panel's audition,
  which needs the same thing for the same reason.
  It used to split — an in-place diff for the cheap cases, `applySet` wholesale
  for anything needing a voice or the graph rebuilt — and the split was never
  about undo, it was about not having a merge. `applySet` survives as the last
  resort if one ever throws partway: the merge writes as it goes, so a throw
  leaves a session that is half of each, and a rebuild from nothing is the only
  way back to a state anybody can name. An undo that half lands is worse than
  one that costs a beat.
  Measured: every field of the format mutated one at a time, written and then
  stepped back, comes back byte for byte — with `playing` true and the tick
  monotonic throughout, a track added and a track removed included.
- **A parameter under an automation lane is pinned** (`pinAutomated`). While the
  transport runs, an enabled lane rewrites the field it automates on every step
  (`t.filter.cutoff`, and `t.params[k]` for a voice with no AudioParam behind
  that key), and that is not a value anybody can hold — the lane overwrites it a
  sixteenth later. Left alone it would fill the stack with entries nobody made
  and hand an undo back whatever the lane happened to be at. So those fields are
  pinned to the previous snapshot's, in `baseSound` and the locked pattern's
  `sound` as well, because `serializeSet` flushes the live sound into those on
  its way out. Only while playing: stopped, the snapshot is exact.
- **Which pattern you are LOOKING at is not in the history.** Chain mode advances
  it from inside the transport's scheduler and a queued switch commits a bar
  after the click asking for it — neither is an edit, and both would otherwise
  leave an entry whose undo, having nothing else to put back, did visibly
  nothing. An undo changes the song, never the view.
- **A drag is one entry.** `input` and `change` events coalesce by their control
  element inside a 1.2s window, so a knob dragged in three goes steps back in
  one. A step painted across eight cells is one gesture and therefore one entry
  already. An edit made after an undo never coalesces — it is a new branch, and
  the redo in front of it is dropped.
- **A whole session arriving is one step, not an edit inside one.**
  `applySet` and `newSet` announce themselves (`seqbaby:setapplied` /
  `seqbaby:newset`) rather than calling in, so session.js knows nothing about the
  stack. The first to land before anything has been edited *replaces* the
  baseline — a `?s=` share link loads a beat after boot, and undoing back to the
  starter tracks nobody asked for would be nonsense — and after that it is a step
  like any other, which is what makes an accidental `new` recoverable.
- Ctrl/⌘-Z and ⌘-shift-Z (and ctrl-Y), plus the two buttons in the transport.
  Text fields keep the browser's own undo: retyping a track name is the field's
  history, not the song's.
- `historyStore.js` has **no imports**, for `chanceGen.js`'s reason: the stack
  and the fold are pure functions over plain objects, so `node --test` exercises
  them (`test/history.test.js`) — including the sharing claim, measured by
  counting distinct pattern objects across a 200-entry stack.
- The stack is **in memory and per page**, capped at 100 states. `new` still
  confirms before it blanks a session with work in it: undo can bring it back,
  but only until the tab goes.

## Naming a song nobody named (`app/songs/songName.js`)

Saving with the name field blank used to produce `untitled`, and an account's
songs menu is unscannable once four rows say it. A counter would not help --
`untitled 12` is as anonymous as `untitled`. So a blank field gets a name
derived from the session itself: `<adjective> <noun>`, e.g. `basement squelch`,
`soft vapour`, `feral fretwork`.

- **Both halves mean something.** The adjective comes from the tempo band (five,
  `drift` .. `rush`) crossed with the scale's mood (bright / dark, or -- with no
  scale switched on, which is most sessions -- a seeded pick, since there is
  nothing to read). The noun comes from the engine the song is mostly made of:
  engine key -> family -> a small word pool. Two songs with different names
  really are different songs.
- **Drums lose ties.** Nearly every session has a kit in it, so the kit is the
  least distinguishing thing about any of them; it names the song only when it is
  all there is. A bus is never what a song is named for, and a session with
  nothing written in it gets told so (`shadow blank`).
- **Deterministic on the session's content**, so saving one session twice cannot
  invent two songs. The seed is a digest of tempo, swing, scale and each track's
  engine key + step mask -- deliberately NOT a hash of the whole blob, which
  carries base64 sample payloads and would rename a song for re-uploading the
  same drum hit.
- **Offered in the field, not sprung at save.** Both save UIs prefill the name
  box when they open (`app/songs/suggestName.ts`), so the generated name is
  something you read and edit before pressing save. Once per opening, tracked by
  a ref rather than by depending on the field's value -- re-offering the moment
  it goes empty would make it unclearable. A name typed over the offer is the
  user's own and upserts by title like any other; the offer left as it stood, or
  an empty field, is what counts as generated.
- **Only when nothing else names it.** A song already open keeps its name even if
  the field was cleared: clearing it means "save this again", not "rename it".
  `new` (and the logo) clear the open song, and the top-bar field clears with it
  -- otherwise the next save files a blank session under the old song's name.
- **The server disambiguates, because only it knows the account.** Two different
  sessions can still land on the same two common words, and `saveNamedSong`
  upserts by title -- right for a name you typed, silent data loss for one the
  app picked. Hence `titleGenerated` on both save actions and `freeTitle`
  (`cold squelch`, `cold squelch 2`), and both return the final `title` so the
  save UI can show what the song actually got called.
- No imports, for `versionTree.js`'s reason: pure, so `node --test` exercises it
  (`test/songName.test.js`) without a browser or a React renderer. Never throws
  and never returns empty -- it is on the save path, and losing work to a name
  generator choking on a hand-edited blob would be absurd.

## Bounce (`bounce.js`)

Pattern or whole-session render: taps the post-limiter master into a
`MediaStreamDestination` (disconnecting the speakers so it renders silent),
records via `MediaRecorder` (webm/mp4), decodes, re-encodes 16-bit PCM WAV by
hand (`audioBufferToWav`); falls back to the raw recording if WAV encode
fails. Real-time capture — see Known limitations.

## Engines catalog (`buildEngineCatalog`)

Groups in order: `plaits` (16) · `drum / synth` (808/909 kit + poly-saw /
fm-bell / pad) · `Emulators` (silverbox + contagion + hexop + guitar + bass + subby + 5 analog-mono) · `texture` (`dm:granular`) ·
`wavetable` (`wt:akwf`) · `sampler` (single unified entry) · `saved patches`
(`saved:<name>`) · `midi` · `bus` (the fx bus — not an instrument, see below).
The engine key string is the source of truth.
Bundled drum kits are no longer separate engines — they live in
`BUNDLED_SAMPLES` and are picked *inside* the sampler's source picker
(legacy `smp:Kit/part` keys migrate on load).

Adding a new engine: catalog entry + voice class dispatch in
`buildVoiceForEngine` (or a `buildDrumSynthNode` case + builder fn for
analog-mono style) + `updatePlaitsControlsVisibility` labels + tips +
`canModulate`/`voiceAutoKeysForEngine` entries + serialize/apply if it has
unique state.

**Slider tips per engine.** harm / timb / morph / decay (and the osc-mix and
osc-mod rows) are one set of controls wired to every engine, so what they do is
explained per engine as a tooltip, applied by `updatePlaitsControlsVisibility`
alongside the relabelling: `PLAITS_MACRO_TIPS` (by Plaits model index) and
`ENGINE_MACRO_TIPS` (by engine key, with `osc` / `oscMod` sub-objects) in
catalog.js, plus the silverbox / contagion / granular / 808 / 909 tips written inline next
to their labels. Each entry only needs the controls its engine actually shows.
The right-click parameter menu reads these from the DOM, so the generic lines in
`PARAM_DESCRIPTIONS` are a fallback for anything not covered.

## Drum-kit flag (`t.isDrumKit`)

Auto-detected at creation (`guessIsDrumKit`), per-track toggle. Blank steps
default to C2 (MIDI 36); the sampler pitches from `pitchBase: 36` (C2
natural) instead of 60; toggling on rewrites active steps to C2 across
patterns.

## Clicks and timing — the rules that keep the transport in time

Measured headless (Chromium, 6 tracks, every step on, chords, contagion + hexop
worklets, cutoff + delay lanes, a reson LFO per track) the `16n` callback runs
at ~1.5ms p50. Everything below is what was found to break that, or to click,
and the rule that now holds. `paramHold.js` (no imports) carries the two
helpers: `holdParamAt` (cancel-and-hold, so a ramp starts from the value being
HEARD, never from the previous ramp's target) and `fadeStop` (a source stopped
through a 6ms fade on its gain).

- **The reverb decay is a coefficient now, and that was the whole fix**
  (`reverb.js` — see its section below). It used to be an impulse response, and
  regenerating one was the single most expensive thing a parameter could do: an
  offline render of `decay` seconds of noise plus the convolver's FFT
  partitioning, reached from the `fx.reverb.decay` lane every step and the
  `reverb_decay` setter LFO every frame. That took the callback to 16ms and the
  main thread to 180ms frames, and needed a throttle — one render per rack per
  400ms, one in flight for the whole app, changes under 12% dropped — which
  made the knob lag and step. All of it is gone: a tail length is one write to
  one AudioParam. Measured in Chrome with six racks each running a
  reverb-decay LFO **and** a per-step decay lane, the exact case the throttle
  existed for: frames p50 16.7ms / p95 17.5ms / max 19.1ms, none over 50ms.
  600 decay writes in a row take 1ms. Modulation still goes through
  `setReverbDecayLive`, which leaves the stored knob alone. The throttle
  survives in `FXRack._requestReverb` for the **fallback** path only — the
  Tone.Reverb the rack builds if the worklet will not register.
- **`switchPattern` does only the audio half inside the transport.** Chain
  mode and a queued switch call it from the scheduler callback on the bar line
  with `{ deferUi: true }`; re-aliasing and the p-lock recall stay synchronous
  (the next step must read the new pattern), and the whole UI repaint
  (`paintPatternUI`: grids, roll, lanes, mod panel, pattern bar) goes to its
  own task straight after — a `setTimeout`, not rAF, which stops in an occluded
  window while the transport runs on. It measured 11ms empty and 23ms on a
  full session. A click paints synchronously, as it always did.
- **The history snapshot waits for idle time while playing**
  (`history.js` `settle`, `requestIdleCallback` with a 1.5s deadline). And only
  the first event of a gesture resolves a label; the sixty `input` events a
  knob drag sends after it do not walk the DOM.
- **`fireFilterEnv` never steps the cutoff.** The filter is the track's, shared
  by every note, so the previous note is usually still ringing through it when
  the next one snapped the frequency to `closed` (six octaves down at env 1,
  through a biquad at Q 20). It holds and ramps into `closed` over 3ms instead,
  writes Q only if something left it wrong and never under a reson lane, and
  leaves the frequency to the cutoff lane when there is no envelope.
- **A stolen worklet voice keeps its state.** The contagion and the hexop
  retrigger their envelopes from the current level (they integrate towards a
  target, so that is free), keep their phases and — the contagion — its filter
  state; the guitar and bass no longer zero a ringing delay line (`pluck` mixes
  over it); the silverbox no longer resets its VCA to silence on a fresh gate.
  Only a voice that has FINISHED starts from zero. Subby already did this with
  its crossfaded tail, and it is the model.
- **Graph edits go under a fade** (`FXRack.softSwitch`): engaging or bypassing a
  stage, and `routeTrackOutput` re-pointing a live output, duck a dedicated
  `switchGain` for 4ms, edit 8ms later, and come back over 6ms. Edits queued
  during the fade join it.
- **`silence()` fades**: the sampler, the granular grains and the wavetable
  notes keep their gain on the source (`src._g`, `rec.amp`) and stop through
  `fadeStop`. The stop button already hid the hard cut behind the master ramp; a
  session load did not.
- **Plaits `hit` cancels the slot's previous events** (`noteOn` always did): a
  round-robin slot re-taken while its old gate-off was still pending had that
  gate-off land on the new note. Glide, there and in the four analog pools,
  holds and ramps rather than restarting from the old target.
- **Nothing per hit allocates a curve or a buffer.** `makeShaperCurve` /
  `makeCassetteSatCurve` / the 808 `saturator` memoise per 1/128th of their
  amount; every `noiseBurst` reads one shared 2s noise buffer at a random
  offset instead of filling its own (60,000 randoms for a 909 open hat).
- **The worklets' event queues do not allocate** (`EventQueue` in contagion.js /
  hexop.js / guitar.js / bass.js / subbass.js, `NoteQueue` in silverbox.js).
  They were plain arrays, so every note cost two object literals, a `sort()`
  with a fresh comparator closure, and — on a stop — a `filter()` building a
  whole new array. That is garbage generated **on the audio thread**, where a
  GC pause is not a slow frame but a dropout. They are parallel typed arrays
  now, with one scratch event object reused by every `shift()` (the consumers
  copy primitives straight out of it and keep no reference), and they stay in
  order by **inserting from the back** rather than by re-sorting: the transport
  schedules ahead in time order, so the common case moves nothing and an
  out-of-order arrival walks past a handful of pending note-offs. The walk
  stops on a tie, which is what preserves the stable sort's guarantee that a
  note-on and the previous step's note-off land in the right order.
  Two things are load-bearing and were found by measuring, not by reading:
  **the fields are f64, not f32** — an f32 round trip moves a frequency by a
  part in ten million, which is inaudible alone and still enough to
  decorrelate an oscillator's phase inside a few hundred samples, so a song
  would stop rendering the same; and **the callers' `> 128` cap is soft** —
  it drops one event and then pushes two, so a burst grows by one event per
  note. That quirk is preserved deliberately, with `QCAP` a hard backstop far
  above it. Verified by rendering both versions against one message stream
  (in-order notes, chords on the same instant, out-of-order arrivals, stops
  with notes queued past them, notes posted after a stop, a 200-note
  overflow): all six engines come back **bit-identical**.
- **Granular grains are built ahead, not at trigger time** (`_enqueueGrains`):
  a long dense note is hundreds of grains × three nodes, and building them all
  inside the callback made the OTHER tracks' notes late. Slices of a quarter
  second, off a timer the note owns; `silence()` drops what is left.
- **`paintTrackNow` caches the cells** on the track (`t._stepCells`,
  invalidated by `renderStepGrid`) and toggles only what changed — it runs per
  track per step.
- Still on the list: `soloAudibleTracks` allocates per 16th; the keyboard arp
  and the granular sustain run on 25/50ms timers with a 120ms lookahead.

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
  `refreshCompSourceDropdowns()`, which is also the one place a source that has
  stopped resolving falls back to `"self"` — in `t.comp.source`, in the select
  and in the compressor (it re-runs `applyCompressorConfig`). Leaving a dead id
  there is worse than it looks: `applyCompressorConfig` finds no source node and
  takes the `!sourceNode` branch, so the track quietly self-compresses while the
  panel still claims a sidechain.
- **`comp.source` serializes as `compSourceIndex`**, a track INDEX, for the same
  reason `t.out` does — `createTrack` hands out fresh ids on every load, so the
  id in a saved song names nothing. (`comp.source` itself is still written, for
  older readers; load ignores it. A session saved before the index existed has
  no way back to the track it meant, so it falls back to `"self"`.)
- **Never `signal.connect(param)` to modulate something.** Tone routes every
  signal→param connection through `connectSignal`, which hands the signal the
  param outright: it cancels the param's schedule and pins it at 0, and a
  Tone.Param is also marked `overridden`, after which every write to it lands
  as 0 for the life of the node (`Param._fromType`). Attaching an LFO
  therefore zeroed what it was modulating — a cutoff slammed shut, a delay
  gone dry — with a native AudioParam coming back only when the slider was next
  moved and a Tone.Param (`delay.wet`, `crusher.bits`, …) never coming back at
  all. Every LFO here is summed ON TOP of the slider, so both mod sources go
  through `connectMod` (lfo.js) and `Tone.connect`, the raw graph connect with
  no override step. The rack's own internal LFOs (vinyl wow, cassette flutter,
  flanger) connect Tone's way on purpose: there the LFO's min/max ARE the
  delay time and there is no base to keep.
- **A track has one rhythm source.** The euclid ring and the chance generator
  both answer "what does this step play", so `stepSource.js` keeps them
  exclusive and both live checkboxes go through `setLiveGenerator`. It also owns
  `stepGateAt`, which used to live in euclid.js — a generator must not be the
  place the dispatch lives, or the second one has to import the first.
- **`engineData.js`, `soundDefaults.js`, `theoryData.js`, `constants.js`,
  `chanceGen.js`, `sessionFormat.js`, `historyStore.js` and `songBuilder.js`
  must stay importable from Node** — no DOM, no Tone, no `window`. The tests
  and the MCP server run them; an import of state.js or catalog.js in any of
  them breaks `npm test` at load, which is the guard.
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
- **Worklet processor sources are template literals** (`silverbox.js`,
  `contagion.js`, `hexop.js`, `guitar.js`, `bass.js`, `subbass.js`,
  `crusher.js`, `reverb.js`),
  so a stray backtick or `${` inside one — including in a comment — truncates
  the string. The module still parses, `node --check` still passes, and the
  failure only shows up as a SyntaxError at engine boot. When editing inside a
  processor source, extract it and syntax-check the extracted text:
  `node -e 'const s=require("fs").readFileSync("public/js/contagion.js","utf8");
  require("fs").writeFileSync("/tmp/p.js",s.match(/SOURCE = \`([\s\S]*?)\n\`;/)[1])'
  && node --check /tmp/p.js`
- **Netlify deploy-preview hash URLs are pinned to one deploy** — retest on
  the branch alias URL, not an old hash URL. A same-SHA force-push does not
  trigger a rebuild; amend for a fresh SHA.

## Adding a feature — quick map

- New FX → extend `FXRack` + `defaultFxConfig` + apply/refresh/wire fns in
  signal.js/render.js, and (optionally) `LFO_KEYS`/`AUTOMATION_TARGETS`.
- New LFO target → see canModulate gotcha above, + a `CONTROL_TARGETS` entry
  (paramTargets.js) so its control's right-click menu finds it. If its
  `LFO_AMP_SCALE` isn't in the same units as the slider's own range, it needs a
  `PARAM_SPAN` / `PARAM_CURVE` entry too (modMotion.js) or the live needle
  swings by the wrong amount.
- New automation target → `AUTOMATION_TARGETS` + a setter path in
  `applyAutomationAtStep`, + the same `CONTROL_TARGETS` entry.
- New per-step control → array on `emptyPattern()` + `aliasPattern()` field +
  step-editor UI + consume in the transport loop + serialize/apply.
- New per-track sound setting → if it should follow p-lock, add it to
  `capturePatternSound` / `applyPatternSound` (patternSound.js) too, or a locked
  pattern will leave it behind on a switch.
- New engine → see Engines catalog above. Its catalog entry, panel table,
  defaults and presets go in `engineData.js` (re-exported from its module),
  or the song builder and the MCP resources will not know it.
- New rhythm/melody generator → a module beside `euclid.js` / `chance.js`, a
  `<gen>GateAt` for it, and a branch in `stepSource.js` (which also owns the
  one-source-at-a-time rule). The transport and the step grid learn nothing.
- New cross-track routing → `t.out` + signal.js's routing block; anything that
  rebuilds a voice must call `refreshAllTrackOutputs()`.
- Nothing has to be told about undo: it watches the session rather than the
  call sites (see below). A new field is undoable the moment `serializeSet` /
  `applySet` carry it — and putting it back is liveSet.js's: a field a track can
  hold without a rebuild wants a branch in `applyTrackInPlace` beside the
  others, and one that needs the voice, the graph or the DOM rebuilt goes in
  `TRACK_REBUILD_KEYS` so the merge remakes the track instead of half-restoring
  it. Miss both and an undo — and an audition — will leave that field behind.
- New macro-pad behaviour → `macro.js`; assignment targets come from
  `AUTOMATION_TARGETS` for free, so a new automation target is macro-assignable
  the moment it has a `CONTROL_TARGETS` entry.
- New server data → Supabase migration + server action in `app/*/actions.ts`
  + UI in the relevant `app/*.tsx`; keep the engine side behind
  `window.seqbaby`.

## Known limitations / TODO breadcrumbs

- Undo is in memory and per page: a reload starts a fresh stack, and it is
  capped at 100 states.
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
- `app/EnginePreload.tsx` emits `modulepreload` for all 60 modules listed in
  `app/engineAssets.ts` (at `engineAsset("/js/<name>")`; the hints used to
  point at the site root and 404). The graph is 8 levels deep, so without it the browser
  needs up to eight sequential round trips just to discover the code.
  **Adding or removing a module in `public/js/` means updating that list** —
  there's a regeneration one-liner in the file's comment.
- The account bar is behind `<Suspense>` in `app/page.tsx`. Don't await
  Supabase in the page body again: it blocks the whole document, including the
  preload hints, on two sequential round trips.
- **The preloader** (`app/Preloader.tsx` + `app/preloaderMarkup.ts`) covers the gap
  between first paint and a booted engine — the studio's DOM is server-rendered,
  so without it the visitor gets a complete-looking sequencer with empty engine
  dropdowns and no tracks for as long as ~1.7MB of Tone + woscillators + 44
  modules takes to arrive. Load-bearing details:
  - **Raw markup plus an inline `<script>`, not a React component.** The engine's
    deferred scripts run before React hydrates, so a hydrated overlay would
    appear after the wait it exists to hide. It lands in the first ~14KB of the
    document, ahead of the studio markup.
  - **It ships `display:none` and the driver reveals it**, so a page whose
    scripts never run shows the bare skeleton rather than a screen that never
    leaves. Same reasoning behind the stall watchdog: the escape hatch (6s) and
    the last-resort dismissal (25s) key off progress having STOPPED, never off
    the wall clock — a phone legitimately takes half a minute, and tearing the
    overlay off a boot that is still running is worse than the wait.
  - **Progress is measured, not faked**: a PerformanceObserver counts the
    engine's own resources (weighted by size — the two big files are most of the
    wait, so counting files froze the bar at 70% for eight seconds), and the boot
    milestones raise a floor under that. Milestones come from `onload` attributes
    in EngineScripts and `window.__sqPreload?.step("engine")` / `.done()` in
    main.js's `init()`; every call site is guarded, so the engine never depends
    on the overlay existing (the legacy static server has none).
  - `PRELOADER_SCRIPT` is a source *string* because both boot paths need it: the
    server path inlines it, and ScriptLoader injects the same text on the
    soft-navigation path (scripts parsed out of innerHTML never execute).
  - The tips it rotates are scoped `any` / `touch` / `desktop` — a right-click
    hint on a phone is an instruction the reader can't follow. Related to but
    deliberately separate from `HELP_TIPS` (icons.js), which the audio gate
    rotates after this overlay clears.
- **Asset versioning**: Netlify's build exports
  `NEXT_PUBLIC_ENGINE_VERSION=$COMMIT_REF`, and
  `scripts/stamp-engine-assets.mjs` publishes `public/js`, `woscillators.js`
  and `style.css` under `public/e/<sha>/` (gitignored). `engineAsset()` in
  `app/engineAssets.ts` points every URL at that prefix, and the prefix
  propagates through the module graph for free because relative specifiers
  resolve against the importing module's URL. That's why the version is a path
  and not a `?query` — a query is dropped during that resolution and would
  reach only `main.js`. Per-deploy URLs are what make the `immutable`
  cache-control in `netlify.toml` safe on an unbundled 47-module engine.
  Unset locally, so `npm run dev` and a plain `next build` keep the bare paths
  and the edit-and-reload loop.
