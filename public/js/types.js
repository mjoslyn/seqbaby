// Shared JSDoc type definitions for seqbaby. This module has no runtime
// exports — it exists purely so other modules can reference these shapes via
//   /** @typedef {import("./types.js").Track} Track */
// giving editors/IDEs full type information without a build step.

/**
 * A MIDI note number (0..127), or null for a rest.
 * @typedef {number | null} MidiNote
 */

/**
 * Index into a track's 32-slot pattern bank (0..31).
 * @typedef {number} PatternIndex
 */

/**
 * Voice engine family. The engine key string (e.g. "plaits:0", "dm:808-kick",
 * "smp:Techno/kick", "saved:name") is the source of truth; this is its type tag.
 * @typedef {"plaits"|"drum-synth"|"sampler"|"granular"|"wavetable"|"custom"|"saved"|"midi"} EngineType
 */

/**
 * One entry in the engine catalog (see buildEngineCatalog / catalog.js).
 * @typedef {Object} EngineEntry
 * @property {string} key            Unique engine key, the source of truth.
 * @property {string} label          Human-readable name shown in the picker.
 * @property {string} group          optgroup label (e.g. "plaits", "Emulators").
 * @property {EngineType} type       Voice family dispatched in buildVoiceForEngine.
 * @property {boolean} [poly]        Voice pools chord tones across N voices.
 * @property {boolean} [melodic]     Pitched (vs. one-shot percussion) engine.
 * @property {number} [defaultNote]  Default MIDI note for blank steps.
 * @property {Object} [config]       Saved-patch JSON config (custom/saved engines).
 */

/**
 * The runtime voice interface every voice class implements. Built lazily by
 * buildVoiceForEngine once the AudioContext exists.
 * @typedef {Object} Voice
 * @property {(midi:number, time:number, duration:number, velocity?:number, opts?:SampleOpts) => void} hit
 * @property {(key:string, val:number) => void} setParam
 * @property {(key:string) => (AudioParam|import("./types.js").ToneSignal|null)} getAudioParam
 * @property {(key:string) => void} setEngine
 * @property {(newKey:string) => boolean} canInPlaceChange
 * @property {() => AudioNode} getOutputNode
 * @property {(target:AudioNode) => void} setDestination
 * @property {(now:number) => void} silence
 * @property {() => void} dispose
 */

/** A Tone.js Signal — usable as an LFO modulation target. @typedef {{value:number}} ToneSignal */

/**
 * Per-hit playback options for sample-family voices (SampleVoice, ElevenVoice,
 * UploadVoice). See startSampleSource in buffers.js.
 * @typedef {Object} SampleOpts
 * @property {number} [startOffset]  Start position, 0..1 of buffer.
 * @property {number} [endOffset]    End position, 0..1 of buffer.
 * @property {number} [fadeIn]       Fade-in seconds (click guard).
 * @property {number} [fadeOut]      Fade-out seconds.
 * @property {"off"|"loop"|"pingpong"} [loopMode]
 * @property {number} [pitchBase]    MIDI note that plays at natural rate (36 drum-kit, 60 otherwise).
 * @property {boolean} [pitchLocked]
 */

/**
 * Configuration for one LFO modulation lane (see defaultLFOConfig / lfo.js).
 * @typedef {Object} LFOConfig
 * @property {boolean} enabled
 * @property {"sine"|"triangle"|"square"|"saw"|"random"} type
 * @property {number} rate   Free-run rate in Hz.
 * @property {number} depth  0..1 modulation depth.
 * @property {boolean} sync  Sync rate to transport division.
 * @property {number} div    Beats per cycle when synced.
 */

/**
 * Per-track lowpass filter + ADSR envelope config.
 * @typedef {Object} FilterConfig
 * @property {number} cutoff  0..1 (mapped to Hz via cutoffToHz).
 * @property {number} reson   0..1 (mapped to Q via resonToQ).
 * @property {number} env     Envelope depth in octaves.
 * @property {number} attack
 * @property {number} decay
 * @property {number} sustain
 * @property {number} release
 */

/** @typedef {{ low:number, mid:number, high:number }} EQConfig */

/**
 * Per-track compressor / sidechain config.
 * @typedef {Object} CompConfig
 * @property {boolean} enabled
 * @property {"self"|string} source   "self" or another track id (sidechain).
 * @property {number} threshold
 * @property {number} ratio
 * @property {number} attack
 * @property {number} release
 * @property {number} knee
 */

/** @typedef {Object} SampleDefaults
 * @property {number} start @property {number} end @property {number} fadeIn
 * @property {number} fadeOut @property {"off"|"loop"|"pingpong"} loopMode */

/**
 * The stock synth params, repurposed per engine (see updatePlaitsControlsVisibility).
 * @typedef {Object} TrackParams
 * @property {number} vol
 * @property {number} harm @property {number} timb @property {number} morph @property {number} decay
 * @property {number} [osc1] @property {number} [osc2] @property {number} [osc3] @property {number} [osc4]
 * @property {number} [ultra] @property {number} [fm] @property {number} [metal] @property {number} [noise]
 * @property {"saw"|"square"} [wave303] @property {number} [accent303] @property {number} [tune303] TB-303 panel.
 */

/**
 * One of a track's 32 patterns. Every field is a per-step parallel array of
 * `length` entries. See emptyPattern in state.js.
 * @typedef {Object} Pattern
 * @property {number[]} steps          1 = active, 0 = off.
 * @property {number[]} lengths        Note length in steps (0 = single).
 * @property {MidiNote[]} notes        Anchor pitch per step.
 * @property {number[]} velocities     0..1.
 * @property {string[]} chords         "" | "maj" | "min" | ... (see CHORD_TYPES).
 * @property {number[]} offsets        Micro-timing, -0.5..+0.5 step fractions.
 * @property {boolean[]} arps
 * @property {number[]} arpRates       Beats per arp note.
 * @property {number[]} arpRanges      Octave range 1..4.
 * @property {("up"|"down"|"updown"|"random")[]} arpDirs
 * @property {number[]} complexities   Chord inversion / voicing level 0..4.
 * @property {number[]} ratchets       Retrigger count 1..8.
 * @property {number[]} sampleStarts   0..1.
 * @property {number[]} sampleEnds     0..1.
 * @property {number[]} sampleFadeIns  seconds.
 * @property {number[]} sampleFadeOuts seconds.
 * @property {("off"|"loop"|"pingpong")[]} sampleLoopModes
 * @property {(number[]|null)[]} extraNotes    Stacked polyphony pitches per step.
 * @property {(number[]|null)[]} extraLengths  Parallel per-extra lengths.
 * @property {Object<string, {enabled:boolean, values:number[]}>} automation
 */

/**
 * A sequencer track. Its `steps`/`notes`/etc. are aliased to
 * `patterns[activePattern]` by aliasPattern so UI mutations flow into the
 * active pattern. See the full data model in CLAUDE.md.
 * @typedef {Object} Track
 * @property {number} id
 * @property {string} name
 * @property {string} engineKey
 * @property {number} length
 * @property {Set<number>} accents          0-indexed accented steps.
 * @property {number[]} steps               Aliased from patterns[activePattern].
 * @property {number[]} lengths
 * @property {MidiNote[]} notes
 * @property {number[]} velocities
 * @property {string[]} chords
 * @property {number[]} offsets
 * @property {boolean[]} arps
 * @property {boolean} muted
 * @property {boolean} soloed
 * @property {boolean} isDrumKit
 * @property {number} glide
 * @property {number} swing
 * @property {number} density
 * @property {number} speed
 * @property {string} sampleSpeedMode       "native" default.
 * @property {SampleDefaults} sampleDefaults
 * @property {TrackParams} params
 * @property {FilterConfig} filter
 * @property {BiquadFilterNode} [filterNode]
 * @property {EQConfig} eq
 * @property {CompConfig} comp
 * @property {Object<string, LFOConfig>} lfoConfig
 * @property {Object} lfos                   Live LFO runtime handles.
 * @property {Object} fxConfig
 * @property {Object} [fxRack]               FXRack instance (lazy).
 * @property {{ outputId:string|null, channel:number }} midi
 * @property {Voice|null} voice              Null until ensureAudio().
 * @property {AnalyserNode} [meterAnalyser]
 * @property {Pattern[]} patterns            32-slot bank.
 * @property {HTMLElement} [el]              DOM node.
 * @property {string} [uploadAudio]          base64-persisted user sample.
 * @property {string} [elevenAudio]          legacy base64 sample.
 */

/** @typedef {{ active:boolean, root:number, mode:string }} ScaleState */

/**
 * Global application state — one mutable object mutated in place by the audio
 * engine and UI (see state.js).
 * @typedef {Object} AppState
 * @property {Track[]} tracks
 * @property {boolean} playing
 * @property {number} tick
 * @property {number|null} repeatId
 * @property {number} nextId
 * @property {boolean} metronome
 * @property {boolean} noteColors
 * @property {string|null} currentSetName
 * @property {AudioContext|null} audioCtx
 * @property {boolean} ready
 * @property {GainNode|null} masterGain
 * @property {DynamicsCompressorNode|null} masterLimiter
 * @property {AnalyserNode|null} masterAnalyser
 * @property {MIDIAccess|null} midi
 * @property {ScaleState} scale
 * @property {PatternIndex} activePattern
 * @property {"repeat"|"chain"} patternMode
 * @property {"immediate"|"finish"} patternSwitchMode
 * @property {PatternIndex|null} queuedPattern
 * @property {number[]} patternRepeats
 * @property {Array<{num:number, den:number}>} patternMeters
 * @property {number} chainBarCount
 */

export {}; // ensure this file is treated as a module
