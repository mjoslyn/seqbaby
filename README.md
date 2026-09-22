# seqbaby

<p align="center">
  <img src="public/share.png" alt="seqbaby, a browser step sequencer" width="640">
</p>

A multi-engine step sequencer that runs entirely in the browser. No installs, no
plugins: open a tab and build a track from synthesis engines, drum machines,
circuit models, wavetables, samples and live Web MIDI, then save it to your
account, share it as a link, jam on it with friends in real time, or ask an
agent to write parts of it for you.

**Live demo:** https://www.playseqbaby.com · **Repo:** https://github.com/mjoslyn/seqbaby

---

## What it is

A 32-pattern step sequencer with a deep per-track signal chain. Every track can
drive any of 40+ sound sources and carries its own filter (native or one of
eight analog-modeled characters), envelope, 5-band EQ, compressor with
sidechain, a 13-stage effect rack, an LFO matrix and per-step automation.
Patterns repeat or chain into songs, can be locked to their own sound per
pattern, bounced to WAV, played from the computer keyboard, and saved to a
Supabase-backed account with a full version tree.

The audio engine is ~65 hand-written, dependency-free vanilla ES modules talking
to the Web Audio API, with no bundler: edit a file, reload. It is wrapped in a
thin **Next.js + React** shell that owns routing, auth, accounts, sharing, the
compose panel and the jam room. The two meet only through `window.seqbaby`.

## Features

### Sound

- **Plaits**: a WebAssembly port of Mutable Instruments' Plaits oscillator, all
  16 synthesis models, with per-model tooltips on the four macro sliders.
- **Drum and synth recipes**: 808 / 909 kits, poly saw, FM bell and pad, built
  from Tone.js.
- **Circuit models as AudioWorklets**, each written from the circuit or
  architecture up rather than as a preset:
  - **silverbox**: the acid box. 3-pole diode ladder, the accent RC network
    that stacks at high resonance, slides from tied steps.
  - **contagion**: a digital virtual-analog. Two multimode SVFs in series /
    parallel / split, a saturation stage between them, shape morph, 8-voice
    unison.
  - **hexop**: 6-operator FM with all 32 algorithms, decoded from Dexed's table,
    per-operator envelopes and presets.
  - **guitar** and **bass**: waveguide strings through pickup, amp, cab and (on
    the guitar) real speaker-to-string feedback. The bass adds parallel
    highpassed dirt, an always-on compressor, fret buzz and an octaver.
  - **subby**: a mono sub bass whose parallel harmonics path makes a 40Hz note
    audible on a phone speaker, with an 808 pitch drop and a band-split 303
    resonator above the crossover.
- **Analog-mono pools** in Tone.js: *snarl*, *ladder*, *drift*, *tines*,
  *oracle*.
- **Wavetable** (bundled AKWF tables, in-app frame editor), **granular**
  (independent speed and pitch, modulatable grain controls) and a **unified
  sampler** (bundled kits or uploads, per-step region / fade / loop, slicing,
  pitch lock).
- **Web MIDI** out, and an **fx bus** engine: a track with no instrument that
  other tracks route through to share one filter, rack and mod matrix.

### Per-track channel

```
voice → filter → eq → compressor → fx rack → master (or an fx bus) → limiter → out
```

- **Filter**: native lowpass / highpass / bandpass / notch, or eight analog
  characters (`fat`, `crisp`, `squelch`, `edge`, `poly`, `velvet`, `scream`,
  `growl`) built as ladder and SVF worklets with the saturator inside the
  feedback path. ADSR filter envelope.
- **EQ**: five bands. **Compressor**: self or sidechained from any track.
- **FX rack**, in order: vinyl → cassette → fuzz → ring mod → wave shaper →
  crush → auto-wah → chorus → phaser → flanger → pitch shift → delay → reverb.
  The crusher is a real converter model (fractional sample-and-hold clock plus
  quantiser, so it aliases like one). The reverb is an 8-line feedback delay
  network whose decay is a coefficient, so it can be swept per step without
  re-rendering an impulse response.
- Engaged stages, active LFOs and non-default filter / EQ / comp settings show
  inline on the track as cards, so what a track is doing is visible without
  opening every panel.

### Sequencing

- 32 patterns per track, repeat or chain mode, per-pattern time signatures and
  repeat counts, immediate or end-of-bar switching.
- Per step: note, chord (scale-filtered, with inversions), stacked piano-roll
  notes, arpeggiator, ratchet, velocity, micro-timing offset, length / ties.
- Per-track speed multiples (polymeter), swing, glide, drum-kit mode.
- **p-lock**: lock a track's whole sound to one pattern, so the bass can sound
  different in the chorus while other patterns share the track's sound.
- **Euclidean generator**: Bjorklund proper, write-once or live, where live
  mode makes pulses / steps / rotate modulatable.
- **Chance generator**: a meloDICER-style part from probabilities, rhythm and
  pitch together, seeded so a saved song replays note for note.
- **Dice**: fill-level-aware random melodies.

### Modulation

- **LFOs** on ~180 targets: sine / triangle / saw / square, sample-and-hold
  random square, and a euclidean gate shape. Tempo sync, phase, unipolar or
  bipolar amount.
- **Automation lanes**: per-step values for ~190 targets, stored in the pattern.
- **Macro pads**: XY pads whose axes drive parameters across tracks, momentary
  or latched, with a learn mode.
- One owner per parameter (LFO, lane or macro), enforced in every picker. A
  second needle on the knob shows where modulation has pushed the value right
  now.
- Right-click (long-press on touch) any parameter for its description, LFO,
  lane, macro assignment and reset.

### Playing and editing

- Rotary knobs over native range inputs, with relative drag and fine-trim; on a
  phone they become vertical sliders.
- Computer-keyboard performance mode (Ableton layout, scale mapping, chord
  mode), live record and retroactive Capture of the last phrase.
- **Undo / redo** over the whole session (100 states, structurally shared),
  fed by watching the session rather than instrumenting every control.
- In-browser **bounce** to 16-bit WAV, pattern or full song.
- A phone layout with labelled icon buttons, drill-down panels and a
  collapsing account bar.

### Accounts, sharing and collaboration

- **Cloud songs** with a **version tree**: every save appends a version, and
  saving from an older one branches instead of overwriting.
- **Templates**: mark a song as a template (and one as the default for `new`);
  the first save from it makes a new song.
- Auto-generated song names from what is in the session (`basement squelch`).
- **Share links** (`?s=<slug>`) for published songs and anonymous quick shares,
  with link previews that name the song and who shared it.
- **Patch gallery** and public profiles at `/u/<name>` with fork buttons.
- **Jam rooms** (`?jam=<room>`): several studios holding one song over Supabase
  Realtime. Edits travel as small diffs and merge into the running engine
  without stopping playback; a peer's edit is an undo step in their name and
  draws a border in their colour on the control they touched. Play presses
  land on a shared beat phase.
- **Compose panel**: ask for changes in words. A turn runs as a background job
  on the site's key (signed in) or your own Anthropic key (no account needed,
  never stored server-side). Its changes arrive in a review bar to
  **audition** into what is playing, **keep** (auto-saving a labelled version)
  or **discard**.

## Let an agent write one

The repo ships an [MCP server](mcp/README.md) (`npm run mcp`) that exposes the
song format as tools: add a track, spell its rhythm as a step string
(`x..X.o_.`), set its sound, put an LFO on the filter, turn on a euclidean or
chance generator, audition it in headless Chromium and read the meters, then
export the JSON or post it for a share link. Every call is validated against the
same tables the engine uses, and refusals name the valid choices. A `compose`
skill (`.claude/skills/compose/SKILL.md`, also served as `seqbaby://guide`)
tells the agent which engine to reach for and how each likes to be played.
`.mcp.json` wires it up for Claude Code. The in-studio compose panel runs the
same tools.

## Tech stack

| Layer | Choice |
|---|---|
| Shell / routing / auth | Next.js 15 (App Router) + React 19 |
| Audio engine | Vanilla ES modules + Web Audio API + AudioWorklets, Tone.js 15 (vendored) |
| Synthesis | `@vectorsize/woscillators` (Plaits WASM) plus hand-written worklet DSP |
| Accounts + data | Supabase (Postgres, Auth, Row-Level Security, Realtime for jams) |
| Compose | Anthropic API, run in a Netlify background function |
| Anonymous sharing | Netlify Blobs (in-memory fallback in dev) |
| Agent tooling | MCP server over stdio, Playwright for auditions |
| Deploy | Netlify (`@netlify/plugin-nextjs`, Node 22); push to `main` deploys |

## Architecture

**Boot.** The studio route server-renders the engine's static DOM
([`app/studioMarkup.ts`](./app/studioMarkup.ts)) and the engine script tags
([`app/EngineScripts.tsx`](./app/EngineScripts.tsx)): Tone → `woscillators.js` →
`js/main.js`. [`EnginePreload.tsx`](./app/EnginePreload.tsx) emits
`modulepreload` hints for every module so the 8-deep import graph arrives in
parallel, and a raw-markup [preloader](./app/Preloader.tsx) with measured
progress covers the gap. On a client-side navigation
[`ScriptLoader.tsx`](./app/ScriptLoader.tsx) injects the same scripts in order.
Production deploys publish engine assets under a per-commit path
(`public/e/<sha>/`) so they can be cached as immutable.

**Engine.** A single `Tone.Transport.scheduleRepeat` at a 16th-note grid drives
everything. Each tick, every track advances by its own speed, runs its
automation, asks `stepSource.js` what the step plays (written pattern, euclid
ring or chance generator), expands chords and arps, applies swing and
micro-timing, fires the filter envelope and triggers its voice. Voices share one
interface (`hit / setParam / getAudioParam / setEngine / getOutputNode /
silence / dispose`), so transport, modulation and UI stay engine-agnostic.

**Session format.** `serializeSet` / `applySet` (session.js) are the song. Two
more paths write that same format onto a running engine without stopping it:
`mergeSet` (liveSet.js), shared by undo, the compose audition and jam patches.
The format's tables and validators (`engineData.js`, `soundDefaults.js`,
`theoryData.js`, `constants.js`, `sessionFormat.js`, `chanceGen.js`,
`historyStore.js`, `jamSync.js`, `songBuilder.js`) import nothing browser-side,
which is what lets `node --test` and the MCP server run them.

**Shell.** Supabase server actions under `app/*/actions.ts` handle songs,
versions, templates, patches, profiles and accounts. `middleware.ts` refreshes
the auth session on every request except engine assets. The compose panel
(`ComposeChat.tsx`) and jam room (`JamPanel.tsx`) talk to the engine only
through `window.seqbaby` (typed in `app/seqbaby.d.ts`).

See [`CLAUDE.md`](./CLAUDE.md) for the detailed tour: module map, data model,
each engine's design notes, timing rules and the load-bearing audio-unlock
behaviour.

## Running locally

```bash
npm install
npm run dev          # Next.js dev server → http://localhost:3000
```

The studio and audio engine run with no env at all. Account features need
Supabase credentials: copy `.env.example` and set `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_ANON_KEY`. Compose on the site's key needs
`ANTHROPIC_API_KEY`; with your own key pasted into the panel it needs nothing.

```bash
npm run build && npm run start   # production build + serve
npm run netlify:dev              # full Netlify emulation (functions + Next) on :8888
npm run legacy:dev               # pre-Next static Node server on :5173 (engine only)
npm test                         # node --test over the pure engine modules and lib/
npm run test:rls                 # Supabase RLS policy tests in a throwaway Postgres (docker)
npm run mcp                      # the MCP server on stdio
```

The engine has no build step: edit files under `public/js/` and reload. The
React shell hot-reloads via `next dev`.

## Project layout

```
app/                         Next.js App Router: shell, auth, account UI, server actions
  page.tsx                   studio route: SSRs engine DOM, boots engine, AccountBar
  studioMarkup.ts            the engine's static DOM skeleton
  EngineScripts / EnginePreload / ScriptLoader / Preloader   engine boot
  AccountBar / SongsMenu / SaveButton / PatchesMenu / NewSongButton / VersionTree
  ComposeChat.tsx            the compose panel and its review bar
  JamPanel.tsx               jam room: presence, Realtime channel, invite link
  shareCard.ts + shareCopy.js   link previews
  api/share/                 anonymous share endpoint
  api/compose/               start a compose turn, poll its status
  {songs,patches,profile,auth,account}/actions.ts   Supabase server actions
  login/ settings/ manual/ u/[username]/            auth, settings, manual, profiles
public/
  js/                        the engine: ~65 dependency-free ES modules
  tone.js  woscillators.js   vendored Tone.js, Plaits WASM port
  wavetables/akwf/           bundled AKWF wavetables (CC0)
  style.css  icons/  manifest.webmanifest
lib/
  supabase/                  Supabase SSR helpers
  composeModels / composeKey / composeJobs   compose allowlist, key handling, jobs + limits
  jamWire.js                 splits jam messages to fit the broadcast cap
  api.js                     legacy Netlify Blobs share store
mcp/                         MCP server, headless audition, tool definitions
netlify/functions/           compose-background worker, legacy share wrapper
supabase/migrations/         profiles, songs, patches, versions, templates, chats
supabase/tests/              negative RLS tests
test/                        node --test suites
.claude/skills/compose/      the compose guide
```

## Known limitations

- Undo is in memory and per page, capped at 100 states.
- LFOs on pooled voices (Plaits and the Tone.js analog pools) reach the first
  voice only; the worklet engines modulate the whole instrument.
- Bounce is real-time capture; offline rendering would need the voices rebuilt
  under an `OfflineAudioContext`, which the Plaits WASM voice doesn't support.
- Keyboard performance mode is desktop-only.
- Jam members share which step plays, not a sample clock.
- Safari reports no output latency, so visuals use an estimate (`?vlat=` to
  calibrate).

## Credits & license

Personal project. Plaits synthesis models originate from Mutable Instruments
(open-source hardware); Tone.js is MIT-licensed. The hexop's algorithm table is
decoded from Dexed (Apache 2.0). The bundled wavetables are from
[AKWF, Adventure Kid Waveforms](https://github.com/KristofferKarlAxelEkstrand/AKWF-FREE)
by Kristoffer Karl Axel Ekstrand, released under CC0-1.0 (see
[`public/wavetables/akwf/ATTRIBUTION.md`](./public/wavetables/akwf/ATTRIBUTION.md)).
