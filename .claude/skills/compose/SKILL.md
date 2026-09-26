---
name: compose
description: Write a song for seqbaby through its MCP server (mcp/server.mjs). Which engine to reach for, how step strings are spelled, the idioms each engine rewards, and the order of work. Load when asked to make, sketch, arrange or remix a track, beat, bassline or song in seqbaby.
---

# Composing in seqbaby

seqbaby is a 32-pattern step sequencer with a deep per-track chain: any of
~46 engines, then a filter with an envelope, a five-band eq, a compressor
with sidechain, a thirteen-stage fx rack, an LFO matrix and per-step
automation lanes. The MCP tools write a song as the JSON the studio loads.
The tools validate every value against the engine's own tables, so a refused
call names what was wrong and what the choices are: read the error and fix
the call, do not guess around it.

## Order of work

1. `new_song` with the tempo and, for melodic music, a scale. Notes snap to
   the scale, so a wrong note is impossible on a scale track.
2. Drums first: kick, then snare or clap, then hats. One track per drum.
3. Bass. Then chords or a pad, then a lead or a hook. Fewer tracks played
   with intent beat many tracks with something on each.
4. Sound: presets where an engine has them, then the filter, then one or two
   fx per track. A reverb or a delay shared on an fx bus, not on every track.
5. Movement: one LFO or lane per track at most, on the thing that matters
   (cutoff, a send, the euclid rotate).
6. `validate_song`, read the warnings. `audition_song` if a browser is
   available: a track whose peak is under -40 dB is not being heard.
7. `export_song` or `share_song`.

Use `get_song` to read back what exists before changing it. Keep track names
short and about their role (kick, bass, keys), not their engine.

## Step strings

A pattern is 16 steps of sixteenths by default: one bar of 4/4. `x` is a
hit, `X` an accent, `o` a soft hit, `.` a rest, `_` extends the hit before it,
a digit 1..9 a hit at that velocity in tenths. Spaces and `|` are ignored. A
shorter string tiles: `x...` is four on the floor.

```
kick    x... x... x... x...        or x......x..x.....  (a broken kick)
snare   .... x... .... x...
clap    .... x... .... x..x        (a flam on the last)
hats    x.x. x.x. x.x. x.x.        closed; ..x. for the off-beat open hat
bass    x.x_ x.X. x.x. X_..        ties are slides on the silverbox
```

`write_code` is the other way in, and often the faster one: Strudel or Tidal
code, mini-notation and all. `$: s("bd*4, ~ cp, [~ hh]*4")` is three drum
tracks in one line; `bass: note("<c2 eb2 g1 bb1>*8").s("tb303").lpf(900)` a
silverbox line four bars long; `chord("<Cm7 Ab^7>").voicing().s("gm_epiano1")`
chords on tines. Read its warnings: what Strudel does live (`every`, `jux`,
`sometimes`) has no equivalent here and is left out. Then shape the tracks it
made with the tools below as usual.

Velocity is how drums breathe: `x.o.x.o.` for hats, `X...x...` for a kick
that leans on the one. `set_step` adds ratchets (a roll: ratchet 2..4),
micro-timing (offset 0.1 on the off-beat hats for swing feel), chords on a
step (chord "min7", complexity 1 for an inversion), and an arp on a chord
step. A track's `length` can differ from 16 (a 12-step hat against a 16-step
kick is a polymeter); `speed` 0.5 halves a track's tempo (half-time drums),
2 doubles it.

Notes: names or MIDI. Bass lives in C1..C3 (24..48), keys around C3..C5,
leads C4 up. Given fewer notes than hits, the notes cycle over the hits in
order, which is how a bassline is usually written: `notes: ["C2","C2","Eb2","G1"]`.

## Which engine

Drums: `dm:808-kick` (long, tuned, drive for a distorted 808), `dm:909-kick`
(punch, attack click), `plaits:13` (bass drum model, harm is the drive),
`sampler` with a bundled kit (`sample: "techno kick"`, `"break snare"`,
`"cr78 hat"`, `"live snare"`, `"r8 kick"`). Snares: `dm:808-snare` (snappy
is the noise balance), `dm:909-snare`, `plaits:14`. Hats: `dm:808-chat` /
`dm:808-ohat` / `dm:909-chat`, `plaits:15` (morph is closed to open). Clap:
`dm:808-clap`, `dm:909-clap`. Cowbell: `dm:808-cowbell`. The 808 / 909 voices
ignore the step's note except the kick's tune. Every drum kit track plays C2
on a blank note, and `drumKit` is guessed from the name.

Bass: `dm:silverbox` for acid and anything squelchy: harm is cutoff, timb
resonance, morph the envelope depth, decay the envelope; an ACCENT comes from
velocity above 0.6 (`X`), a SLIDE from a tie into the next note (`x_x`); set
`sbaccent` 0.6..1 for how much accents do. `dm:sub` (subby) for 808 bass,
sub, reese, drill: `apply_preset` "808", "distorted 808", "reese", "acid",
"dub", "drill slide", "memphis", "house sub", "growl", "cinematic drop"; it
is monophonic and its drive is what makes it audible on a small speaker, so
never leave harm at 0 unless the preset did. `dm:bass` for a played bass:
presets "motown", "svt fingers", "pick grind", "slap funk", "dub", "modern
di", "walking jazz", "growl", "octave sub", "pop punk". `dm:ladder` or
`plaits:0` for analog synth bass with the filter closed to 0.3..0.5.

Chords and keys: `dm:tines` (electric piano), `dm:hexop` with a preset
("e.piano", "bell", "brass", "marimba", "organ", "pad", "bass"), `dm:pad`
(slow), `dm:drift` (chorused analog), `dm:oracle` (poly analog, detune and
drive), `wt:akwf` (wavetable), `plaits:6` (the chord model: one note plays a
chord, harm picks which). `dm:poly-saw` for supersaw stabs. Put a chord on
the step (`set_step` chord "min7") on any poly engine.

Leads and hooks: `plaits:0` (virtual analog), `plaits:2` (fm), `plaits:4`
(additive), `plaits:11` (string, plucked), `plaits:12` (modal, mallets),
`dm:contagion` (the hypersaw: `vuni` 4..8 and `vunidet` 0.3 for the wide
one), `dm:snarl` (aggressive mono), `dm:fm-bell`, `dm:guitar` with a tone
("surf twang", "funk clean", "jangle", "chime", "country twang", "blues
burn", "brit stack", "rolled off", "fuzz lead", "singing lead", "scooped
metal", "djent chug", "grunge", "jazz box").

Textures: `dm:granular` with a `texture` (choir, ambient pad, harmonic
strings, sleepy tines ...): a held note (a long tie) over a whole bar, morph
for the position in the sample, harm for grain size.

`bus`: an fx bus. It plays nothing; other tracks send to it (`set_track` out:
its index) and its fx, filter and lanes shape all of them at once. One reverb
bus is the normal way to give a song a room.

`describe_engine` says what a given engine's four sliders do and what its
panel offers. `plaits:N` sliders differ per model, so read them before using
one.

## Sound

- Filter: cutoff 1 is open. A bass closes to 0.3..0.5 with `env` 0.3..0.6 and
  a short decay for a plucked shape; a pad opens slowly with `attack`.
- Fx go in chain order: vinyl, cassette, fuzz, ringmod, shaper, crush,
  autowah, chorus, phaser, flanger, pitchshift, delay, reverb. A stage is on
  when its wet (or amount) is above 0. Delay: `sync: true` with `div` 0.75
  for a dotted eighth, 0.5 an eighth, 0.333 a triplet; `fbk` 0.3..0.5.
  Reverb: `decay` 1..2 s tight, 4..8 s a wash. Crush: `bits` 6..8 and
  `rate` 0.3..0.5 for lo-fi. Fuzz or shaper for weight; vinyl or cassette
  for a bed of noise that only plays while the track plays.
- Sidechain: `set_comp` on the bass with `source` the kick's index,
  threshold -30, ratio 6, release 0.15: the pumping.
- Levels: kick 0.9, snare 0.8, hats 0.5..0.6, bass 0.8, everything else
  0.5..0.7. The master limiter catches peaks but a mix that lives in it is
  flat.
- One owner per parameter: an LFO or a lane, never both on the same control.
- LFO lengths are synced by default: "4 steps" is a beat, "16 steps" a bar,
  "64 steps" four bars for a slow filter sweep. `randsq` holds a random value
  per cycle (sample and hold); `euclid` taps a rhythm into a parameter (a
  euclidean filter gate, a reverb throw).
- Lanes are per pattern: `set_automation` fx.reverb with a rise across the
  last bar of a pattern is a fill; cutoff rising over a 4-pattern chain is a
  build.

## Generators

- `set_euclid` for hats, shakers, percussion, arps: pulses over steps. E(3,8)
  is the tresillo, E(5,8) the cinquillo, E(7,16) a busy hat, E(5,16) or
  E(7,12) something off the grid. Live, its counts take an LFO: `randsq` on
  `euclid_rotate` every 16 steps is a hat pattern that never repeats. Only
  the rhythm is generated; the track's notes still come from the pattern, so
  set one note with `set_notes` for a pitched euclid part.
- `set_chance` for melodies and basslines from probabilities: `scale` the
  pitches to allow, `lo` / `hi` the range, `note` the base value ("1/8" for
  a running line, "1/16" busy), `rest` 0.2..0.4 for phrasing, `legato` for
  ties. Its notes bypass the session scale (its weights ARE the scale). The
  seeds replay the same part every time; change one to re-throw. A track has
  one rhythm source, so euclid and chance switch each other off.

## Arrangement

Pattern 0 is the loop. For a song: `copy_pattern` 0 to 1, 2, 3 and vary each
(drop the kick on 2, add the lead on 3), then `set_arrangement` mode "chain"
with `repeats` [4, 4, 2, 4] bars. Every track shares the pattern number, so
"pattern 2" is the same moment on every track. `set_meter` for 7/8 or 6/8.

## What to check

`validate_song` names silent tracks and empty buses. `audition_song` plays
the song in the real engine and reports per-track rms / peak in dB: a track
under -40 dB peak is effectively silent (a closed filter, a sub on a
speaker, a euclid with 0 pulses); a master near the limiter means the levels
are too high together. Fix, then share.
