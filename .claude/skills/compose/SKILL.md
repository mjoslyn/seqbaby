---
name: compose
description: Write a song for seqbaby through its MCP server (mcp/server.mjs). Which engine to reach for, how step strings are spelled, the idioms each engine rewards, song structures (sections, forms, chain mode), and the order of work. Load when asked to make, sketch, arrange or remix a track, beat, bassline or song in seqbaby.
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
   the scale, so a wrong note is impossible on a scale track. Decide now
   whether this is a LOOP or a SONG (see Song structure): a song needs its
   section plan before the first note, because sections are pattern numbers.
2. Drums first: kick, then snare or clap, then hats. One track per drum.
3. Bass. Then chords or a pad, then a lead or a hook. Fewer tracks played
   with intent beat many tracks with something on each.
4. Sound: presets where an engine has them, then the filter, then one or two
   fx per track. A reverb or a delay shared on an fx bus, not on every track.
5. Movement: one LFO or lane per track at most, on the thing that matters
   (cutoff, a send, the euclid rotate).
6. For a song: `copy_section` the full section into the others' slots and
   carve each into what it is (Song structure below), then
   `set_arrangement` chain with the bar counts.
7. `validate_song`, read the warnings. `audition_song` if a browser is
   available: a track whose peak is under -40 dB is not being heard.
8. `export_song` or `share_song`.

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

`write_code` is the other way in, and often the faster one: Strudel code, mini-notation and all. `$: s("bd*4, ~ cp, [~ hh]*4")` is three drum
tracks in one line; `bass: note("<c2 eb2 g1 bb1>*8").s("tb303").lpf(900)` a
silverbox line four bars long; `chord("<Cm7 Ab^7>").voicing().s("gm_epiano1")`
chords on tines. seqbaby's own instruments and controls have names there too:
`s("silverbox")`, `.knob("sbaccent", 0.9)`, `.preset("surf twang")`,
`.fx("chorus.wet", 0.3)`, `.lfo("cutoff", "sine", 0.4, 16)`, `.aut("fx.delay",
"0 0.5 1")`. A song in parts is `pattern(1)` ... `pattern(2).repeat(4)` ...
with `chain()`, and `.lock()` gives one part its own sound. Each pattern is as
long as its part (a one-bar verse, a four-bar chorus), and a section with no
`.repeat` plays its longest part. Read its warnings: what Strudel does live (`every`, `jux`,
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

Drums: `dm:siege` (the bass drum synth: see below, the first choice for a
techno or house kick), `dm:808-kick` (long, tuned, drive for a distorted
808), `dm:909-kick` (punch, attack click), `plaits:13` (bass drum model,
harm is the drive),
`sampler` with a bundled kit (`sample: "techno kick"`, `"break snare"`,
`"cr78 hat"`, `"live snare"`, `"r8 kick"`). Snares: `dm:808-snare` (snappy
is the noise balance), `dm:909-snare`, `plaits:14`, and `dm:lancet`, a
snare synthesizer with seven models (`lncmodel`: "analog", "slap", "modal",
"physical", "fm", "granular", "blend"): harm is TIMBRE (the noise, on most
models), timb is COLOR (the pitch envelope and shell balance on analog, the
partials on modal, the body on physical, the modulator ratios on fm, the
grains on granular, the bodies on blend), morph the FX amount (each model's
own stage, clean at 0), decay the length. The note is the pitch, C2 the
middle of a two-octave travel. `lncdyn` is how much velocity does (level,
and a little brightness and length), so write ghost notes as `o` and
accents as `X`. The randomizer, `lncrdecay` / `lncrtimbre` / `lncrcolor` /
`lncrpitch` / `lncrfx` / `lncrlevel` / `lncrmodel` (0..1 each), throws
that knob on every hit: a little `lncrtimbre` and `lncrlevel` (0.1..0.3)
is a drummer, `lncrmodel` 0.5 is a different snare every hit.
`apply_preset` "tight analog", "fat analog", "slap crack", "wood modal",
"piccolo", "tin head", "fm clap", "metal fm", "coins on the head", "boom
bap", "dusty funk", "roll the dice". Hats: `dm:808-chat` /
`dm:808-ohat` / `dm:909-chat` / `dm:909-ohat`, `plaits:15` (morph is closed
to open). Clap:
`dm:808-clap`, `dm:909-clap`. Cowbell: `dm:808-cowbell`. The 808 / 909 voices
ignore the step's note except the kick's tune. Every drum kit track plays C2
on a blank note, and `drumKit` is guessed from the name.

A real drummer's kit is a `sampler` per piece from one of the three acoustic
kits: `salamander` (a garage rock kit, punchy and roomy), `virtuosity` (a
jazz club kit, dry and detailed) and `drskit` (big, multi-mic, rock to
pop). Each has the same nine pieces: `kick`, `snare`, `rim`, `hihat`,
`openhat`, `tom1` (high), `tom2` (floor), `ride`, `crash`, so the sample is
`"salamander/snare"`, `"virtuosity/ride"`, `"drskit/tom2"`. Use one kit for
the whole drum part: mixing kits sounds like two rooms. Play them like a
drummer: ghost notes on the snare (`o`), the hat or the ride carrying the
time with a few accents, the open hat on an offbeat, a crash on the one
after a fill, toms only in fills. In code, `.bank("salamander")` (or
`virtuosity`, `drskit`) maps `bd sd rim hh oh ht lt rd cr` onto them.
`describe_engine` `sampler` lists every bundled sample.

Bass: `dm:silverbox` for acid and anything squelchy: harm is cutoff, timb
resonance, morph the envelope depth, decay the envelope; an ACCENT comes from
velocity above 0.6 (`X`), a SLIDE from a tie into the next note (`x_x`); set
`sbaccent` 0.6..1 for how much accents do. `dm:sub` (subby) for 808 bass,
sub, reese, drill: `apply_preset` "808", "distorted 808", "reese", "acid",
"dub", "drill slide", "memphis", "house sub", "growl", "cinematic drop"; it
is monophonic and its drive is what makes it audible on a small speaker, so
never leave harm at 0 unless the preset did. `dm:bass` for a played bass:
presets "motown", "svt fingers", "pick grind", "slap funk", "dub", "modern
di", "walking jazz", "growl", "octave sub", "pop punk". `dm:ladder` for the
Minimoog bass and lead: `apply_preset` "model d bass", "funk lead", "brass",
"whistle", "pedal bass", "vibrato lead", "percussive", "noise pad"; harm is
the cutoff (0.3..0.5 for bass), timb the emphasis (it whistles past 0.75),
morph the contour amount, decay the decay; `ldrmode` "mono" for a line (low
note wins, a tie is legato), the osc levels up together for the overdrive.
`plaits:0` for a plainer analog synth bass with the filter closed to 0.3..0.5.

Chords and keys: `dm:tines` (electric piano), `dm:hexop` with a preset
("e.piano", "bell", "brass", "marimba", "organ", "pad", "bass"), `dm:pad`
(slow), `dm:drift` (chorused analog), `dm:oracle` (the poly analog: harm
detunes VCO 2, timb is its shape, morph the drive on the summed voices;
`orcslop` is the analog in it, `orcchorus` the width, `orcatk` / `orcsus` /
`orcrel` the envelope; presets "poly brass", "strings", "warm pad", "pulse
keys", "unison bass", "glass", "dirty stab"), `wt:akwf` (wavetable), `plaits:6` (the chord model: one note plays a
chord, harm picks which). `dm:poly-saw` for supersaw stabs. Put a chord on
the step (`set_step` chord "min7") on any poly engine.

Leads and hooks: `plaits:0` (virtual analog), `plaits:1` (waveshaping:
timb folds, morph skews), `plaits:2` (fm), `plaits:4` (additive),
`plaits:5` (wavetable: timb and morph walk the map), `plaits:11` (string,
plucked), `plaits:12` (modal, mallets),
`dm:contagion` (the supersaw: `vuni` 4..8 and `vunidet` 0.3 for the wide
one; its filter envelope is its own, so `vfdec` short with `vfsus` low and
`venvamt` up is a pluck over whatever the amp sustains), `dm:snarl` (aggressive mono), `dm:fm-bell`, `dm:guitar` with a tone
("surf twang", "funk clean", "jangle", "chime", "country twang", "blues
burn", "brit stack", "rolled off", "fuzz lead", "singing lead", "scooped
metal", "djent chug", "grunge", "jazz box").

Textures: `dm:granular` with a `texture` (choir, ambient pad, harmonic
strings, sleepy tines ...; `describe_engine` `dm:granular` lists them): a
held note (a long tie) over a whole bar, morph for the position in the
sample, harm for grain size. The odder Plaits models are textures too:
`plaits:3` (grain, formant-shaped: vocal and buzzy), `plaits:8` (swarm, a
cloud of detuned saws, for pads and drones), `plaits:10` (particle,
dripping and crackling: timb is density), `plaits:9` (filtered noise: wind,
risers, snare-ish hits with a short decay), `plaits:7` (speech: morph picks
the phoneme, for vocal chops and robot words). All Plaits models have a
low-pass gate on decay, so a long decay is what lets them ring.

Drones: `dm:drone`, after the Grone: an equation (bytebeat) oscillator into
a screaming MS-20 style filter, a delay that can run backwards, and a
granular cloud. It LATCHES by default (`drnhold` "latch"): one note a bar,
or one every few bars, and it holds until the next; notes on the same step
are a chord and all hold. Write a single `x` and leave the rest empty, not a
tie. harm is the cutoff; timb / morph / decay are the equation's A0 / A1 /
A2, which step (they are integers inside) and change the rhythm inside the
note rather than its pitch. `drneq` picks the equation ("octaves", "xor",
"arp", "chaos" ...). `apply_preset` "dark grone", "cathedral", "machine
hum", "bit swarm", "reverse tide", "arp ghost", "subterranean",
"screamer", "glacier". Put the track's glide up and a new latched note
slides into the old one. Low notes (C1..C3) suit it; it brings its own
delay and cloud, so it wants no reverb on top beyond a little.

Kicks: `dm:siege`, the bass drum synth, a siege engine for the low end: a sine
under a pitch envelope, a drive after the amplitude envelope. harm is DRIVE
(it crushes the attack, keeps the tail a clean sub, and lifts that tail up
to twelve times, so a driven kick reads longer), timb is CLICK (how far
above the note the pitch starts, up to six octaves), morph is DEPTH (how
long the pitch takes to fall onto the note, 1ms a tick, 250ms the 909's
sweep), decay the body (50ms to 4s). `sgemode` "fold" is a wavefolder that
compresses more than it distorts, "clip" is a clipper, harsher and louder.
`sgehpf` "on" is a 30Hz low cut, worth switching on under a driven kick.
`sgegate` "gate" holds the body for the step: with notes, ties and the
track's glide it is a bassline. `sgelock` "on" pins the tuning and lets a
note only move the kick by octaves. `sgetune` is an octave either way,
`sgefloor` the level a velocity-0 step plays at. Write it `X...x...` so the
accents land; a C2 note at the default is the kick, C1 is a sub drum.
`apply_preset` "808", "909", "techno", "rumble", "tick", "gabber", "sub
drum", "hard trance", "bassline". It brings its own drive, so it wants no
distortion in the rack; a sidechain from it onto the bass is the usual move.

Voices: `dm:vox`, a singing voice (a glottal pulse through five formants).
harm is the VOWEL (0 u, 0.25 o, 0.5 a, 0.75 e, 1 i), timb the throat SIZE
(0 soprano .. 1 bass), morph BREATH (keep it under 0.6; above 0.75 it
whispers), decay the release. A lane on harm sings a lyric of vowels.
`sngwords` sings a phrase, one syllable a note ("doo wop", "la la", "ooh
aah", "na na", "shoo bee", "ba da", "mama", "hey yeah", "hallelujah", "oh
no"); `sngtext` is a typed lyric instead, one syllable a note, spelled as it
sounds: a consonant, a vowel, a consonant ("twin kel twin kel lit tel
star"; the last consonant is sung as the note ends, so give it a note at
least an eighth long). Two vowels glide ("ai" eye, "ow" now, "ey" day),
"oo" is u, "ee" is i, "mmm" hums. It wins over `sngwords`; with both off, `sngcons` starts every note with one consonant ("m",
"l", "s", "t" ...). `sngvoices` 1..8 is a choir per note (with
`sngdetune` / `sngspread`), `sngmode` "mono" is a lead that slides between
notes. `apply_preset` "choir aah", "angel ooh", "basso", "soul lead", "doo
wop", "la la", "robot choir", "monk chant", "whisper", "hallelujah". Ties
make held choir chords; a lead wants notes a step or two long. Keep a lead
in its size's range (soprano C4..C6, bass E2..E4), and give a choir a bus
reverb.

`midi`: sends the track's notes to a MIDI device instead of playing them.
Only for a song that drives outboard gear; it is silent in the browser and in
`audition_song`, so never use it unless asked.

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
  autowah, chorus, phaser, flanger, pitchshift, repeat, prism, delay, reverb. A stage is on
  when its wet (or amount) is above 0. Delay: `sync: true` with `div` 0.75
  for a dotted eighth, 0.5 an eighth, 0.333 a triplet; `fbk` 0.3..0.5.
  Reverb: `decay` 1..2 s tight, 4..8 s a wash. Crush: `bits` 6..8 and
  `rate` 0.3..0.5 for lo-fi. Fuzz or shaper for weight; vinyl or cassette
  for a bed of noise that only plays while the track plays.
- Prism is a whole pedalboard in one stage: four modules (character,
  movement, diffusion, texture), each a mode and an amount, 0 takes one out.
  Drive + doubler + reels + cassette at 0.3 each is warm and worn; swell +
  space at a high `time` turns a pluck into a pad; fuzz + pitch (move 1,
  octave up) + reverse is a lead that falls apart; `broken` or `interference`
  on a texture for a part that should sound damaged. `wet` 1 puts the whole
  track through it.
- The fx run in the order given by `set_fx_chain` (default: gain, vinyl, ...
  pan, delay, reverb), and a stage can be on twice: `set_fx` on "delay#2"
  makes a second delay, whose LFO and lane keys are the stage's with #2 after
  them (delay_time#2, fx.delay.time#2). gain (drive 0.5 = unity, up to +18dB)
  placed before a fuzz or shaper drives it; pan (pos 0.5 = centre) takes an
  LFO for an auto-pan.
- Repeat is a beat repeat and a slicer, on the sequencer's grid. `mode:
  "repeat"` captures `grid` of the track at `offset` into every `interval`
  and repeats it for `gate`, with `chance`: the defaults are a sixteenth
  rolled over the last beat of the bar, half the time. `pitch` moves each
  repeat, 24 semitones down at 0 to 24 up at 1 with 0.5 no change (below
  0.5, a roll that falls like a tape stopping), `decay` fades each one.
  `mode: "slice"` cuts the track into `grid` slices and swaps them, with
  `chance`, for others from the `interval` before: a drum loop reshuffled
  live; `vary` plays some backwards, `decay` chops them short. The discrete
  knobs are 0..1 picks from lists (grid 1/64 .. 1 bar, interval 4 .. 64
  steps, gate 1 .. 32 steps). `wet` 1 is an insert, the repeat replacing the
  beat; a lane on `fx.repeat.chance` at 0 then 1 on the last bar is a fill.
  Put it on the drums or a bus, before the delay and reverb (it is).
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

## Song structure

**A loop or a song.** "A beat", "a loop", "a groove", "a bassline" is one
pattern in repeat mode: pattern 0, done. "A song", "a track", "a tune", a
length ("three minutes"), or a form ("with a drop", "verse and chorus") is
sections in chain mode. When unsure, write the song: a song contains the loop.

**How chain mode plays**, which decides how a song is laid out:

- A section is a **pattern number**, the same slot on every track. Chain plays
  the slots in numeric order, each for `repeats[slot]` bars, then loops back
  to the first. There is no jumping back: a second chorus is its own slot (a
  copy of the first, which is the chance to make it bigger).
- A slot with no steps on any track is **skipped**, so a silent bar or a
  breakdown with nothing written is not a section. Keep at least one step.
- `repeats` counts **bars**, 1..16, not plays of the pattern. A 32-step
  pattern needs at least 2 or the chain moves on halfway through it; a
  section longer than 16 bars takes two consecutive slots.
- A pattern loops within its section, so an 8-bar section on a 1-bar pattern
  is the same bar eight times. That is fine for a groove; for a section that
  moves, give the parts longer patterns (32 or 64 steps: a 2 or 4 bar phrase)
  or follow the section with a one-bar fill slot (`repeats` 1).
- Every track restarts its pattern at a section change, so a 12-step
  polymeter lines up again at each section.
- `get_song` shows `arrangement.sections`, the slots chain will actually play
  with their bars; `validate_song` warns about a section cut short, a chain
  with one section, and sections written under repeat mode (which plays only
  the active one).

**The plan.** Pick a form, map its sections onto slots 0, 1, 2 ... in playing
order, and give each a bar count. Length is `bars x 4 x 60 / bpm` seconds:
64 bars at 128 is two minutes, at 90 nearly three. Six to nine sections is
plenty. Forms that work (bars per section):

```
house / techno 122-132   intro 16 | groove 16 | build 8 | drop 16 | break 16 | build 8 | drop 16 | outro 16
drum & bass 170-176      intro 16 | build 8 | drop 16 | break 8 | build 4 | drop 16 | outro 8
pop / indie 100-128      intro 4 | verse 8 | pre 4 | chorus 8 | verse 8 | pre 4 | chorus 8 | bridge 8 | chorus 8 | outro 4
hip hop / lo-fi 75-95    intro 4 | A 8 | B 8 | A 8 | B 8 | outro 4      (A verse beat, B the hook)
trap 130-150 (half time) intro 8 | hook 16 | verse 16 | hook 16 | outro 8
ambient / drone 60-90    A 16 | B 16 | A' 16 | coda 8                    (64-step patterns, slow lanes)
```

Phrases come in 4, 8 and 16 bars; a section of 6 or 7 sounds like a mistake
unless the brief is odd on purpose.

**Building it: write the fullest section, then subtract.** Taking parts out
of a finished section is quicker and more coherent than building each from
nothing, and every section then shares the song's material.

1. Write the main section (drop, chorus, hook) complete in its slot, every
   part playing, sound designed. Leave the other slots empty.
2. `copy_section` it into every other slot.
3. Carve each copy with `clear_pattern` (a part out of one section),
   `set_steps` / `set_notes` on the copy (a thinner beat, different chords),
   `set_step` (fills, ratchets) and `set_automation` (lanes are per pattern,
   so each section moves its own way).
4. `set_arrangement` mode "chain", `repeats` per slot, `active` the first.

What each section is, carved from the full one:

- **intro**: drums thinned (kick and hats, or hats alone), bass out or under
  a low cutoff lane that opens across the section; no lead. Sets the tempo
  and the key and holds the best things back.
- **verse / A / groove**: drums, bass, chords; the lead out or sparse. Room
  for a vocal line or a vox track.
- **build / pre-chorus**: the snare or clap in quarters, then eighths, then
  sixteenths (ratchet 2..4 on the last bar's steps), a cutoff lane rising
  across it, a reverb or delay send rising, and the kick dropped from the
  last bar or the last beat so the next downbeat lands. A noise or drone
  track with a rising lane is the riser.
- **drop / chorus / hook**: everything, and the hook at its fullest. The
  second one is a copy, so add something the first did not have: a
  counter-melody, an octave on the lead, an extra percussion track.
- **break / breakdown**: kick and bass out (one sub note held is fine), the
  pad and the lead carry it, more reverb. Keep a step somewhere or chain
  skips it.
- **bridge**: different chords (`set_notes` on the chord track's copy, a
  bass line that follows them), often thinner drums. The point is contrast
  before the last chorus.
- **outro**: the intro in reverse, parts dropping out, cutoff closing. The
  chain loops back to slot 0 after it, so an outro that thins to the intro's
  parts loops cleanly.

**A fill** is the last bar of a section doing something else: a one-bar slot
after the section (`repeats` 1) holding a snare roll, a drum drop or a
reverse cymbal, or a longer pattern whose last bar differs. Fills at the end
of every 8 bars are what make a song sound played rather than looped.

**Sound per section.** Track settings (`set_params`, `set_fx` ...) are the
whole song's. A section that sounds different gets it from a lane on its own
pattern, or from `write_code` with `.lock()` on that part (its pattern keeps a
sound of its own). A lane's value **stays where it left off** when the next
section has no lane on that control, so a cutoff that opens across the intro
is still open in the verse: give the control a lane in every section that
follows (a flat one is fine), or none at all.

**In code** the same song is sections: `pattern(1).repeat(16)` ... the parts
of the intro ..., `pattern(2).repeat(8)` ... the build ..., then `chain()`.
Each part is as long as it takes to repeat; a section with no `.repeat` plays
its longest part once. `arrange([16, intro], [8, build], [16, drop])` fills
consecutive slots in chain mode, Strudel's way. Writing the drop in code and
carving the rest with the tools works well.

`set_meter` for 7/8 or 6/8 is per slot, so a song can change meter at a
section.

## What to check

`validate_song` names silent tracks and empty buses. `audition_song` plays
the song in the real engine and reports per-track rms / peak in dB: a track
under -40 dB peak is effectively silent (a closed filter, a sub on a
speaker, a euclid with 0 pulses); a master near the limiter means the levels
are too high together. Fix, then share.
