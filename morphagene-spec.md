# Make Noise / Soundhack Morphagene — Functional Spec

> Derived from the official manual at
> <https://www.makenoise-manuals.com/morphagene/> (all 25 sections crawled).
> This is a condensed engineering/reference spec — a distillation of the manual,
> not a replacement for it. Firmware behavior described is current as of **MG203**.

---

## 1. Overview

The Morphagene is a stereo **tape + microsound** Eurorack module. It records
audio into a buffer and manipulates it using three nested units of structure:

| Unit | Timescale | Meaning |
|---|---|---|
| **Reel** | Meso (minutes/seconds) | A whole collection of audio, up to ~2.9 min, stored as one file on the microSD card. |
| **Splice** | Sound-object (fraction of a sec → several sec) | A user-defined region within a Reel, delimited by Splice Markers. |
| **Gene** | Micro (down to the threshold of perception, ms) | A "playback window" carved out of a Splice by the Gene-Size control. |

Design lineage: **Musique Concrète** (tape speed/direction + splicing) and
**Microsound / granular synthesis** (Curtis Roads, *Microsound* — the module
exposes timescales 4/5/6 of Roads' nine). Every parameter is voltage
controllable; the module is intended as a dynamic digital audio buffer for a
modular system.

**Two tool-sets:**
- **Tape Music Tools** — record on the fly, layer via internal Sound-On-Sound
  (S.O.S.), manually cut into pieces via Splice, reorganize via Organize.
- **Microsound Tools** — Gene-Size, Slide, Morph, and clock-driven granulation.

---

## 2. Audio Specs

| Spec | Value |
|---|---|
| Sample rate | 48 kHz (constant) |
| Bit depth / dynamic range | 32-bit float |
| Channels | Stereo |
| Record time per Reel | ~2.9 minutes (was 1.45 min pre-MG137) |
| Max Splices per Reel | 300 (299 Splice Markers) |
| Max Reels per microSD card | 32 |
| Reel file format | 32-bit float, 48000 Hz, **stereo** `.wav` |
| Reel file naming | `mg1.wav` … `mgw.wav` |
| microSD format | FAT32 only |
| Recording | Always constant speed & forward direction, independent of playback modulation |

---

## 3. Physical / Power

| Spec | Value |
|---|---|
| Width | 20 HP |
| Current draw | +12 V: **165 mA**, −12 V: **20 mA** |
| microSD | Ships blank (no factory content) |

**Installation:** Power off and unplug the case before connecting the bus-board
cable. Orient the **RED stripe** on the ribbon cable to the **−12 V** line on
both module and bus board (on Make Noise bus boards the −12 V rail is marked
with a white stripe).

---

## 4. Inputs / Outputs & Panel Controls

### Audio I/O
| Jack | Function |
|---|---|
| **Audio In L (Mono) / R** | Line-level to modular-level, AC-coupled. No analog gain/attenuation — level is set by Auto-Leveling (digital). |
| **Audio Out L (Mono) / R** | Typically 10 Vpp, AC-coupled. |

### Sound-On-Sound
| Control | Function |
|---|---|
| **S.O.S. combo pot** | Mix of previously-recorded Loop vs. live input. Doubles as attenuator for the CV in when patched. Full CCW = live only; full CW = recorded loop only. |
| **S.O.S. CV In** | Unipolar 0 V → +8 V, normalized to +8 V, linear response. |

### Vari-Speed (playback speed + direction)
| Control | Function |
|---|---|
| **Vari-Speed panel** | Bipolar. **12:00 = playback stopped.** CW = forward (faster), CCW = reverse (faster). |
| **Vari-Speed CV attenuverter** | Bipolar attenuator. |
| **Vari-Speed CV In** | Bipolar, ±4 V. |
| **Activity window** | Shows speed/direction/Morph state. Green = original record speed (1:1, ~2:30). Baby Blue = +1 octave. Peach = −1 octave. Red = stopped. |

Range: **~12 semitones up, ~26 down.** Vari-Speed affects **playback only**, never recording.

### Gene-Size
| Control | Function |
|---|---|
| **Gene-Size panel** | Unipolar, non-destructive. Full CCW = playback window = full Splice; full CW = extremely short (potentially inaudible). Continuous; Gene shrinks smoothly. Gene length is a **constant time**, independent of Vari-Speed. |
| **Gene-Size CV attenuator** | Bipolar. |
| **Gene-Size CV In** | Bipolar, 0 V → +8 V. |

### Slide (playback-window position / scrub)
| Control | Function |
|---|---|
| **Slide panel** | Continuously variable. Sets where in the Splice the first Gene begins; scrubs material and offsets the Play Reset/Start point (and EOSG timing). Works even at full-Splice Gene-Size. |
| **Slide CV attenuverter** | Bipolar. |
| **Slide CV In** | Unipolar, 0 V → +8 V. |

### Morph (Gene overlap / layering)
| Control | Function |
|---|---|
| **Morph panel** | Unipolar. Controls overlap between the end of one Gene instance and the start of the next; staggers, stacks, layers Genes. |
| **Morph CV In** | Unity, unipolar, 0 V → +5 V. |

### Organize (Splice / Reel selection)
| Control | Function |
|---|---|
| **Organize panel** | Unipolar, **stepped**. Selects the next Splice to play (in Reel Mode, selects the Reel). Splices are evenly spaced across the knob regardless of length. **Always takes priority over Shift.** |
| **Organize CV In** | Unipolar, 0 V → +5 V. Unpatch in Reel Mode. |

### Clock / Gate I/O
| Jack | Function |
|---|---|
| **CLK In** | Sync input; needs clock/gate ≥ 2.5 V. Syncs REC, Gene-Size, Morph. Drives Gene Shift / Time Stretch (see §9). |
| **Play Gate In** | Gate HIGH triggers/re-triggers playback from start of current Splice; held HIGH loops the Splice; held LOW stops at end of Splice. **Normalled HIGH** (unpatched = Splice loops). |
| **REC Gate In** | Clock/gate, toggles Record on/off; ≥ 2.5 V. |
| **Splice Gate In** | Drops a Splice marker on Gate HIGH; ≥ 2.5 V. |
| **Shift Gate In** | Increments Splice selection; ≥ 2.5 V. |
| **EOSG Out** (End of Splice/Gene) | Gate at the end of each Splice and/or Gene, 0–10 Vpp. |
| **CV Out** | Represents average energy at the Audio Outs (envelope follower). 0 V → +8 V DC. Reconfigurable to a per-Gene ramp (see `cvop`). |

### Buttons & Windows
| Control | Function |
|---|---|
| **REC button (lit)** | Start/stop recording; lit = recording. Strobes while waiting for clock sync. |
| **Splice button (lit)** | Drops a Splice marker; lit = End of Splice/Gene. |
| **Shift button (lit)** | Increments Splice; lit = microSD mounted; **flashing = card busy (do not remove).** |
| **Reel / Splice / CV / Vari-Speed activity windows** | Visual indication of selected Reel/Splice, CV out, and speed/Morph state. Reel window flashes on CLK In and in Reel Select Mode. |
| **microSD slot** | FAT32 microSD. Mounts automatically or via Shift button. |

> **Single-button actions fire on release, not press.**

---

## 5. Button Combinations (cheat-sheet)

| Action | Combo |
|---|---|
| Auto-Level (analyze & normalize input) | Hold **REC** + press **Shift** (hold REC to keep monitoring) |
| Mount microSD (when unmounted) | Press **Shift** |
| Enter / Exit Reel Mode | Hold **Splice** + press **REC** |
| Delete current Reel | Hold **Shift** + press **REC** |
| Record into current Splice | Press **REC** (press again to stop) |
| Record into new Splice | Hold **REC** + press **Splice** |
| Create Splice marker | Press **Splice** |
| Increment Splice | Press **Shift** |
| Delete Splice marker (merge with next) | Hold **Shift** + press **Splice** |
| Delete ALL Splice markers (keep audio) | Hold **Shift** + press+hold **Splice** 3 s |
| Delete current Splice's audio | Hold **Shift** + press **REC** |
| Clear entire Reel (markers + audio) | Hold **Shift** + press+hold **REC** 3 s |

Recording auto-stops at the ~2.9-min Reel limit. Note: the `rsop` firmware
option can swap the meaning of the two REC combos (see §10).

---

## 6. Reels & Splices

**Reels** live on the microSD card, one `.wav` per Reel, up to 32 per card.
With no card present, only one Reel exists and Reel Mode cannot be entered.
The module is **always writing** latest recordings/splices to the card — to
protect a card, remove it after the desired Reel is loaded.

**Splices** subdivide a Reel (max 299 markers → 300 Splices), evenly spaced on
the Organize knob regardless of their real length. A short Reel (< 2.9 min) can
have new Splices appended (new material, overdubs, or manipulations) up to the
2.9-min ceiling.

**Copying a Reel to a card:** mount card → load desired Reel → remove card →
wait for Shift button to go dark → reinsert card → press Shift.

---

## 7. Setup & Recording Workflow

**Initialization (unmodulated 1/1 loop):** the manual's "init" settings play a
recording back exactly as recorded. After recording modulations into a Splice,
return to these to hear clean 1/1 looping.

1. Patch source to L and/or R input.
2. Set **S.O.S. full CCW** to monitor only incoming audio.
3. **Auto-Level:** hold **REC** + press **Shift** — analyzes the signal and sets
   digital gain to correct modular amplitude (hold a few seconds for a good
   dynamics snapshot). Re-do when switching between line and modular sources.
4. **Record into new Splice:** hold **REC** + press **Splice**; REC lights.
   Press **REC** again to stop.
5. Wait for the **Shift button to stop flashing** (card write complete) before
   Reel Mode / delete operations.
6. Turn **S.O.S. full CW** to hear the playback.

**Clock-synced recording:** with a clock at CLK In, the REC button strobes
after being pressed and starts recording on the next clock pulse (and likewise
waits for a pulse to stop) — aligning start/stop to the external clock.

### Types of Recording
1. **Initial Recording** — creates the first Splice in an empty Reel.
2. **Time Lag Accumulation (TLA)** — records over an existing Splice
   continuously as it loops; blends live + existing audio via S.O.S. All audible
   S.O.S./Vari-Speed/panel manipulations are baked into the next playthrough.
   Extreme Vari-Speed/Morph eventually pitches audio out of range; forward
   Vari-Speed below 1/1 gradually loses signal.
3. **Record into New Splice** — appends a new Splice (any length up to 2.9 min)
   to the end of the Reel; can combine existing Splices + new input.

> While the Morphagene does **not record in reverse**, it **plays back in
> reverse while recording** for S.O.S., letting two sounds run opposite
> directions at once.

---

## 8. Microsound / Granulation

**Micromontage** — manual: use Splice to cut and Organize to jump around
asynchronously. Automatable by patching **EOSG → Splice In** for quasi-random
splice placement while modulating.

**Granulation** — automatic, machine-like division of the buffer into
progressively smaller **Genes**. At Gene-Size full CCW, Gene = full Splice;
otherwise Gene is a **constant time length** (independent of Vari-Speed). Very
small Genes become clicks — hundreds in a row are perceived as a tone whose
timbre varies with **Slide** and pitch with **Vari-Speed**; **Morph** staggers/
layers/spreads them. Granulation is real-time and CV-modulatable; CLK In gives
strict synchronous playback (basis of Time Stretch).

### Morph detail (Gene overlap)
| Morph position | Behavior |
|---|---|
| Full CCW | Short gap of silence before each Gene (pointillist). Window = Red. |
| ~8:30 / ~9:00 | Seamless loop, "1/1", no gap/overlap. Window = Amber at integer ratios. |
| Beyond 8:30 | Next Gene starts before previous ends (overlap). |
| ~12:00 | Overlap > half a Gene; a 3rd instance is added. |
| ~1:00 | 3 instances equally spaced; panning introduced. Up to 3/1 overlap. |
| Beyond ~2:30 | 4th Gene overlap, upward pitch randomization, panning. |

Morph uses **Dynamic Enveloping** to smooth glitches across all Gene sizes /
Splice lengths. Configurable overlap ratios via `mcr1/mcr2/mcr3` (see §10).

### Stopping / re-triggering
- Vari-Speed at 12:00 halts playback; moving off 12:00 resumes from the stop
  point.
- **Play In** is checked at the end of each Gene/Splice: HIGH = continue,
  LOW = stop. A low→high transition retriggers from the Slide-defined start.
  Classic retrigger = repeat Gates to Play with Vari-Speed set for playback.
  (If Vari-Speed = 12:00, Play gates do nothing — speed is zero.)

---

## 9. Clock-Driven Modes (CLK In)

Active when Gene-Size is smaller than the whole Splice:

| Mode | Condition | Morph window |
|---|---|---|
| **Gene Shift** | Morph ≤ 2/1 (panel ≤ ~11:00) | Red — each clock/gate increments to the next Gene, played at Vari-Speed rate/direction ("Synchronous Granulation"). |
| **Time Stretch / Compression** | Morph > 2/1 (panel ~11:00 → Blue) | Blue — external clock syncs the Splice to each pulse. **Faster clock → Time Compression** (shifting), **slower clock → Time Stretch.** |

Time-Stretch requires a clock ≥ one pulse / 3.5 s. Time Compression maxes out
at ~18 Hz (no further compression above that). The `ckop` option can force
Gene-Shift-only or Time-Stretch-only regardless of Morph.

Other clock uses: **REC In** = clock/gate-rated record + S.O.S.; **Play In** =
clock-rate (re)trigger of Gene/Splice (LFO-reset-like); **Shift In** = sync
Splice incrementation to external events; **EOSG Out** = trigger at end of
playback window to sync the rest of the system.

---

## 10. Firmware & `options.txt`

Update via microSD. Notable changelog:

| Version | Changes |
|---|---|
| **MG137** | Better Vari-Speed at slow mod rates; wider SD `.wav` compatibility; **doubled record time 1.45 → 2.9 min** (still 48 kHz/32-bit); **max Splices → 300**. (Longer Splices = slower Slide scanning and much longer read/write.) |
| **MG155** | Introduced user-configurable **`options.txt`** on the SD card. |
| **MG157** | Minor bug fixes; playback gain lowered 2/3 (−3.5 dB) affecting TLA. |
| **MG203** | Morph Chord Ratio options `mcr1/mcr2/mcr3` (any ratio 0.06250 = −4 oct to 16.00000 = +4 oct); Auto-Level replaced with **4-step gain selection** (blue-green-orange-purple); playback gain reverted to pre-MG157; improved internal processing. |

### `options.txt` format
Each line: `name value //comment`. Edit the number, save, re-mount the card.
Example: `omod 1 //Organize option: 0 = at end of gene, 1 = immediate`.

| Option | Values | Meaning |
|---|---|---|
| `vsop` | 0 / 1 / 2 | Vari-Speed: 0 bidirectional classic; 1 bidirectional 1 V/oct; 2 positive-only 1 V/oct (STOP at full CCW; more low-octave precision). |
| `inop` | 0 / 1 | Input: 0 record S.O.S. mix; 1 record input only. |
| `pmin` | 0 / 1 | Phase/position mod: 0 off; 1 phase-playback modulation on right input when left input is empty. |
| `omod` | 0 / 1 | Organize/Shift: 0 take effect at end of Gene/Splice; 1 immediate (may click — no envelope). |
| `gnsm` | 0 / 1 | Gene smooth: 0 classic (click-suppression window only); 1 more pronounced windowing. |
| `rsop` | 0 / 1 | Record combos: 0 REC+Splice = new Splice, REC = current; 1 swaps them. |
| `pmod` | 0 / 1 / 2 | Play: 0 classic; 1 momentary; 2 trigger loop (no Play-input stop in this mode). |
| `ckop` | 0 / 1 / 2 | Clock control: 0 hybrid (Gene Shift ≤ 2/1, Time Stretch above); 1 Gene Shift only; 2 Time Stretch only. |
| `cvop` | 0 / 1 | CV Out: 0 envelope follower; 1 ramp synced to current Gene Size (a synced function generator). |
| `mcr1/2/3` | 0.06250–16.00000 | Morph Chord Ratios (−4 oct … +4 oct), MG203+. |

---

## 11. Tips

- Auto-Level when switching between line and modular sources.
- The module is always modulating from panel + CV; use init settings for a
  clean 1/1 loop.
- Recording is always constant speed/forward regardless of playback modulation.
- Morph affects loop length and EOSG trigger frequency.
- In Reel Mode, unpatch REC / Splice / Shift / Organize (Organize CV stays live).
- With a clock at Shift In, hold Shift to momentarily stop the clocking/mod.
- S.O.S. also works as a VC crossfader (Live↔Loop) or, with no live input, a
  VCA for the Loop.
- TLA + forward Vari-Speed below 1/1 eventually loses signal.

---

## 12. Example Patches

- **Synchronizing Recording** — clock to CLK In aligns REC start/stop to the
  external clock (REC flashes while waiting, solid when recording).
- **Combining Splices into a New Splice** — while Recording into New Splice,
  navigate Splices with Organize; all live manipulations are baked into the new
  Splice.
- **Tron Bike Race** — Wogglebug Ring Mod → Erbe-Verb → record (use Wogglebug
  Freeze to sustain); set S.O.S. + Vari-Speed to 1:1, Morph full CW for random
  Gene pitch/pan.
- **Single-Repeat Microsound Delay / Pitch Shifter** — with `inop 1`, make an
  empty Splice of the delay length, patch a source, run TLA; S.O.S. = wet/dry.

---

## 13. Warranty & Support

- **1 year** from purchase against defects in materials/construction (proof of
  purchase required).
- **Not covered:** wrong supply voltages, reversed bus-board cable, abuse,
  removing knobs, changing faceplates, other user-caused faults.
- Repair/replace at Make Noise's option, return-to-Make-Noise, customer pays
  transit.
- Support: **technical@makenoisemusic.com** — Make Noise Co., 414 Haywood Road,
  Asheville, NC 28806.
