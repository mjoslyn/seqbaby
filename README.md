# seqbaby

<p align="center">
  <img src="public/share.png" alt="seqbaby — browser step sequencer" width="640">
</p>

A multi-engine step sequencer that runs entirely in the browser. No installs, no
plugins — open a tab and build a track from synthesis engines, drum machines,
analog-mono emulations, samples, and live Web MIDI, then share the whole session
as a single link.

**Live demo:** https://seqbaby.netlify.app · **Repo:** https://github.com/mjoslyn/seqbaby

---

## What it is

seqbaby is a 32-pattern step sequencer with a deep per-track signal chain. Each
track can drive any of ~40 sound sources and carries its own filter, envelope,
EQ, compressor, multi-effect rack, and LFO modulation matrix. Patterns can be
played in repeat or chained into songs, recorded to WAV in the browser, and
shared via a generated URL.

It is built as a single-page vanilla-JavaScript app with no build step — the
goal was to see how far the raw Web Audio API and ES modules go before a
framework or bundler earns its place. The answer turned out to be ~9,000 lines
of client code and a lot of audio-graph plumbing.

## Highlights for the curious

- **Real synthesis, in the browser.** Integrates a WebAssembly port of Mutable
  Instruments' *Plaits* oscillator (16 synthesis models) alongside Tone.js
  drum/synth recipes (808/909 kits, a 303-style mono, FM bell, poly saw, pad).
- **Hand-built analog emulations.** Five mono-synth voices modeled from the
  ground up in the Web Audio graph — MiniBrute, Minimoog, Juno-60, electric
  guitar, and electric bass — each with period-appropriate quirks (Brute Factor
  distortion, 3-oscillator Moog tuning with octave/range selects, the Juno's
  baked-in chorus, Karplus-Strong plucked strings).
- **A full mixing channel per track.** Native `BiquadFilterNode` with an ADSR
  filter envelope, 3-band EQ, a compressor that can self-compress *or* sidechain
  off any other track's output, and an ordered FX rack (asymmetric fuzz →
  bitcrusher → feedback delay → reverb).
- **Modulation matrix.** Per-track LFOs route to engine-internal parameters
  (oscillator detune, PWM rate, filter cutoff, FX sends) with sync-to-tempo and
  free-rate modes. Available targets are gated per engine so the UI only offers
  what actually patches.
- **Expressive step editing.** Per-step note, chord (scale-filtered), arpeggiator
  (rate/range/direction), ratchet, velocity, micro-timing offset, and complexity.
  Vertical drag on a step transposes it, scale-aware.
- **In-browser bounce.** Records the live master output via `MediaRecorder`,
  decodes it, and encodes 16-bit PCM WAV by hand (RIFF header + interleaved
  int16) — pattern or full chained song.
- **Sessions as links.** Serializes the entire arrangement (including base64
  user samples) and stores it in Netlify Blobs; opening `?s=<id>` rehydrates it.

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | Vanilla ES modules, no bundler | Direct control of the audio graph; reload-to-iterate |
| Audio | Web Audio API + Tone.js 15 | Native nodes for the hot path, Tone for higher-level voices/FX |
| Synthesis | `@vectorsize/woscillators` (Plaits WASM) | Authentic Mutable Instruments models in the browser |
| Backend | Node 20 HTTP server (dev) / Netlify Functions (prod) | Sessions sharing is the only server concern; everything else is client-side |
| Persistence | localStorage + Netlify Blobs | Patches/sessions local; shareable links in Blobs |
| Deploy | Netlify (static + functions) | Push to `main` auto-deploys |

## Architecture in one breath

A single `Tone.Transport.scheduleRepeat` at a 16th-note grid drives everything.
On each tick, every track accumulates its own speed (enabling per-track tempo
multiples and polymeter), fires due steps, expands chords and arps, applies swing
and per-step micro-timing, schedules a filter envelope, and triggers its voice.
Each voice implements a common interface (`hit / setParam / getAudioParam /
setEngine / getOutputNode / silence / dispose`) so the transport, modulation, and
UI code stay engine-agnostic.

```
voice → filter → eq → compressor → fxRack(fuzz → crusher → delay → reverb) → masterGain → output
```

See [`CLAUDE.md`](./CLAUDE.md) for a thorough tour of the data model, voice
catalog, and signal chain.

## Running locally

```bash
npm install
npm run dev          # local server on http://localhost:5173
```

Other commands:

```bash
npm run netlify:dev  # full Netlify emulation (functions + static) on :8888
npm run start        # production-style local server
```

No build step — edit files in `public/` and reload.

## Project layout

```
public/
  index.html       UI shell + track <template> + OpenGraph meta
  app.js           all client logic (~9k lines)
  style.css
  woscillators.js  Plaits WASM port
lib/api.js         shared session share put/get (Netlify Blobs + memory fallback)
netlify/functions/ thin function wrappers
server.js          local Node HTTP server
netlify.toml       publish/functions/redirects config
```

## Known limitations

- No undo/redo yet.
- Voice-pool LFO modulation currently targets the first voice in a pool only.
- Bounce captures in real time (via `MediaRecorder`); offline rendering would
  require rebuilding voices under an `OfflineAudioContext`, which the native
  Plaits WASM voice doesn't accommodate.

## License

Personal project. Plaits synthesis models originate from Mutable Instruments
(open-source hardware); Tone.js is MIT-licensed.
