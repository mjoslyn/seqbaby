// The compose panel's genre picker: search or browse a genre, press build,
// and the compose turn writes a whole song in it. Each entry is a short brief
// in the guide's own terms (tempo, which engines, what makes the genre
// itself), so the model starts from the idiom rather than from the word.
//
// No imports: pure, so test/genres.test.js pins the table, the search and
// the prompt.

/** @typedef {{ id: string, name: string, family: string, bpm: [number, number], tags?: string[], brief: string, plan?: GenrePlan }} Genre */

/**
 * What a rewritten genre knows beyond its brief: pools the dice draw one
 * build from (rollGenre). An engine is `key` or `key/preset`; a step string
 * anywhere in prose is in backticks. `bass` is how the FIRST core role plays.
 * A harmony entry is `scale/scale: progression`: the scale comes with the
 * chords, because notes snap to it and a progression only fits its own. test/genres.test.js holds every engine,
 * preset, scale, kit and step string to the engine's own tables.
 * @typedef {{
 *   swing?: [number, number], kits: string[],
 *   drums: Record<string, string>[],
 *   core: Record<string, string[]>, optional?: Record<string, string[]>, extras?: [number, number],
 *   bass?: string[], harmony: string[], moves: string[], avoid: string[],
 *   forms?: string[], angles?: string[], layered?: boolean,
 * }} GenrePlan
 */

/** The filter chips, in the order they are drawn. */
export const GENRE_FAMILIES = [
  { id: "house", name: "house" },
  { id: "techno", name: "techno" },
  { id: "trance", name: "trance & hard" },
  { id: "bass", name: "bass music" },
  { id: "breaks", name: "breaks & dnb" },
  { id: "hiphop", name: "hip hop" },
  { id: "pop", name: "pop & r&b" },
  { id: "rock", name: "rock & metal" },
  { id: "soul", name: "jazz, funk & soul" },
  { id: "world", name: "latin & world" },
  { id: "reggae", name: "reggae & dub" },
  { id: "retro", name: "synth & retro" },
  { id: "ambient", name: "ambient & experimental" },
];

const G = (id, name, family, lo, hi, brief, tags) => ({ id, name, family, bpm: [lo, hi], brief, ...(tags ? { tags } : {}) });

/** @type {Genre[]} */
export const GENRES = [
  // house
  G("house", "house", "house", 120, 126, "four on the floor, claps on 2 and 4, shuffled hats with swing, a warm bassline, offbeat piano or organ stabs (tines or oracle chords), a soulful lift into each drop"),
  G("deep-house", "deep house", "house", 118, 124, "a soft round kick, laid-back swung hats, lush jazzy seventh and ninth chords on tines or oracle, a deep rolling bass, filter sweeps, warm and late-night"),
  G("tech-house", "tech house", "house", 124, 128, "a tight punchy kick, crisp shuffled percussion, a groovy rubbery bassline that carries the track, minimal chord stabs, vocal chops on vox, funky and stripped back"),
  G("acid", "acid house", "house", 122, 130, "a silverbox line with accents (velocity) and slides (ties), cutoff and resonance automated so it squelches and opens across the song, 909-style drums, minimal everything else", ["303", "acid"]),
  G("chicago", "chicago house", "house", 118, 126, "raw 808 and 909 drums, a jacking pattern, a simple bassline, piano chords, a repeated vox hook, lo-fi and direct"),
  G("garage-house", "garage house", "house", 118, 124, "soulful gospel chords on organ or tines, a swung shuffle, a walking bass, a big vox hook, uplifting"),
  G("progressive-house", "progressive house", "house", 122, 128, "long builds, a steady four on the floor, evolving arpeggios and pads, filter and reverb lanes that open slowly, an emotional breakdown and a euphoric return"),
  G("afro-house", "afro house", "house", 118, 124, "a rolling four on the floor under layered polyrhythmic percussion (euclid rhythms on toms, shakers, congas-like halo and lancet hits), a deep bass, a chanted vox hook"),
  G("french-house", "french house", "house", 120, 126, "a filtered disco loop feel, pumping sidechain on the chords from the kick, a funky bass, the filter on the whole loop opening and closing, phaser on the chords"),
  G("lofi-house", "lo-fi house", "house", 116, 124, "dusty saturated drums, detuned chords, cassette and vinyl in the rack, a warm wobbly bass, hazy and nostalgic"),
  G("minimal", "minimal", "house", 122, 128, "sparse clicky percussion, a tiny bass motif, microscopic changes over long sections, delay throws and filter lanes, lots of space", ["microhouse", "minimal techno"]),

  // techno
  G("techno", "techno", "techno", 126, 134, "four on the floor on a siege kick, off-beat open hats and a closed hat line on halo, a clap on 2 and 4, a driving rolling bassline, hypnotic repetition with filter and delay automation doing the work, dark and minor"),
  G("detroit", "detroit techno", "techno", 124, 132, "machine drums, soulful string or pad chords, a melodic synth line, futuristic and emotional, the chords carrying the hope"),
  G("berlin", "berlin techno", "techno", 130, 138, "a big rumbling kick (siege rumble), a dark hypnotic loop, reverb-drenched percussion, almost no melody, relentless", ["warehouse"]),
  G("dub-techno", "dub techno", "techno", 118, 126, "a soft kick, one chord stab drenched in delay and reverb (on a bus), the filter on the stab automated, deep sub, hiss from the cassette stage, foggy and endless"),
  G("hard-techno", "hard techno", "techno", 145, 155, "a distorted kick (siege with clip or fold drive), rumbling bass, fast offbeat hats, an acid or rave stab, relentless energy"),
  G("industrial-techno", "industrial techno", "techno", 128, 140, "a pounding distorted kick, metallic noise hits, crushed percussion, a menacing low drone, mechanical"),
  G("melodic-techno", "melodic techno", "techno", 120, 126, "a driving rolling bass, a long arpeggiated lead, big emotional pads, slow filter builds, a dramatic breakdown"),
  G("electro", "electro", "techno", 120, 132, "a syncopated 808 beat (kick off the grid, claps on 2 and 4, tom accents), a rubbery staccato bass, robotic synth stabs, a vocoder-ish vox line"),
  G("ebm", "ebm", "techno", 115, 130, "a stomping straight kick, a sequenced eighth-note bass, harsh snares, a shouted vox hook, cold and physical", ["body music"]),

  // trance & hard
  G("trance", "trance", "trance", 134, 140, "four on the floor, offbeat bass, supersaw chords (contagion with unison), a soaring lead, a long breakdown with a riser and a euphoric drop"),
  G("psytrance", "psytrance", "trance", 138, 146, "a short tight kick on every beat with a rolling sixteenth bass in the gaps (kick-bass-bass-bass), squelchy acid and fm effects, swirling delays"),
  G("goa", "goa trance", "trance", 135, 145, "a rolling bass, twisting acid lines, eastern-flavoured scales (phrygian), layered arpeggios, psychedelic"),
  G("hardstyle", "hardstyle", "trance", 148, 155, "a distorted pitched kick that carries the melody (siege, clip drive, pitch envelope), a reverse bass, an epic lead, a euphoric breakdown"),
  G("gabber", "gabber", "trance", 160, 190, "a massively distorted kick on every beat (siege gabber), a fast offbeat hat, a crunchy stab, aggressive and fast", ["hardcore"]),
  G("happy-hardcore", "happy hardcore", "trance", 165, 180, "a fast four on the floor, a bouncy offbeat bass, piano stabs, a cheerful major lead and a high vox hook"),
  G("eurodance", "eurodance", "trance", 130, 142, "four on the floor, an offbeat bass, big piano or brass stabs, a catchy major-key synth riff, a vox chorus"),
  G("hands-up", "hands up", "trance", 138, 145, "a pumping kick, sidechained supersaws, a catchy lead riff, a big build and a euphoric drop"),

  // bass music
  G("dubstep", "dubstep", "bass", 138, 142, "half time: kick on 1, snare on 3, sparse hats, a wobbling bass (contagion or subby with an LFO on the cutoff synced to 1/8 or 1/16), a big drop after a tense build"),
  G("brostep", "brostep", "bass", 140, 150, "half time, aggressive growling and screeching bass edits (contagion, fold drive, fast LFOs and lanes), huge snare, a riser into the drop"),
  G("riddim", "riddim", "bass", 140, 150, "half time, a repetitive minimal wobble bass on a tight rhythmic pattern, lots of space, heavy sub"),
  G("future-bass", "future bass", "bass", 140, 160, "half-time beat, big detuned supersaw chords that swell with sidechain pumping, pitched vocal chops, a bright melodic drop"),
  G("garage", "uk garage", "bass", 130, 136, "a two-step beat with a skippy swung shuffle (kick on 1 and the 'and' of 3, snare on 2 and 4), organ or piano chord stabs on the offbeat, a bouncing sub bass, chopped vox", ["ukg"]),
  G("2-step", "2-step", "bass", 130, 136, "no kick on 2 or 4: the kick skips (1, the 'and' of 2, a ghost before 3), a crisp snare or clap on 2 and 4, heavy swing on the shuffled hats and rims, a warm bouncing sub that answers the kick, tines or organ chords chopped on the offbeats, a pitched-up R&B vox hook, smooth and late-night", ["2 step", "2step", "two step", "two-step garage", "uk garage"]),
  G("speed-garage", "speed garage", "bass", 132, 138, "four on the floor with garage swing, a big wobbly reese bass, dub sirens, chopped vox"),
  G("bassline", "bassline", "bass", 136, 142, "a bouncy four on the floor, a wobbling detuned bassline that leads, organ stabs, a pitched vox hook"),
  G("grime", "grime", "bass", 138, 142, "sparse cold square-wave melodies (plaits or drift), eski clicks, a punchy kick and snare in half time, sub bass hits, gaps for an MC"),
  G("uk-funky", "uk funky", "bass", 128, 132, "four on the floor with tribal syncopated percussion (euclid on toms and rims), a deep bass, soulful chords"),
  G("halftime", "halftime", "bass", 160, 175, "drum and bass tempo felt in half time: kick on 1, snare on 3, rolling ghost hats, a deep sub and a menacing bass"),
  G("wave", "wave", "bass", 130, 150, "half-time trap drums, huge reverbed supersaw chords, a melancholy lead, pitched vocal chops, ethereal and heavy"),

  // breaks & dnb
  G("dnb", "drum & bass", "breaks", 170, 176, "a fast two-step breakbeat (kick on 1 and the 'and' of 2, snare on 2 and 4), busy ghost-noted hats, a deep sub or a growling reese bass, atmospheric pads in the intro and break", ["dnb", "drum and bass"]),
  G("liquid", "liquid dnb", "breaks", 170, 176, "a smooth two-step beat, lush jazzy chords on tines, a warm rolling sub, soulful vox, uplifting and melodic", ["liquid funk"]),
  G("neurofunk", "neurofunk", "breaks", 172, 178, "a tight punchy two-step, gnarly modulated reese basses (contagion with lanes on filter and shape), dark technical edits"),
  G("jungle", "jungle", "breaks", 160, 172, "chopped, rolling breaks with ratchets and fills, a huge sub bass under them, reggae-flavoured stabs or a vocal chop, dub delays on the snare"),
  G("jump-up", "jump up", "breaks", 172, 176, "a bouncy two-step, a cartoonish wobbling bass riff, big energy, simple and catchy"),
  G("breakbeat", "breakbeat", "breaks", 125, 140, "funky syncopated breaks, a fat bass, rave stabs, filter sweeps, big and bouncy", ["nu skool breaks"]),
  G("big-beat", "big beat", "breaks", 120, 140, "heavy distorted breakbeats, a fat riff, acid squelches, rock energy, sirens and samples"),
  G("footwork", "footwork", "breaks", 155, 165, "frantic syncopated 808 kicks and toms, rapid hat rolls, chopped repeated vox, a sparse half-time feel under triplet patterns", ["juke"]),
  G("breakcore", "breakcore", "breaks", 160, 200, "frantic chopped breaks with ratchets and stutters (the repeat stage), distorted kicks, chaotic edits against a melancholy pad"),

  // hip hop
  G("hiphop", "boom bap", "hiphop", 86, 96, "a dusty swung beat, kick and snare with ghost notes, swing on the hats, a jazzy sample-like loop on tines with vinyl and cassette in the rack, a round bassline following the chords", ["hip hop", "90s"]),
  G("lofi", "lo-fi hip hop", "hiphop", 70, 88, "a lazy swung beat, mellow seventh chords on tines or oracle, a soft bass, vinyl crackle and cassette wow, tape-dark tone, relaxed and warm", ["lofi", "chillhop"]),
  G("trap", "trap", "hiphop", 130, 150, "half-time 808 kick and a long sliding 808 bass on subby (legato glide), snare or clap on 3, rattling hi-hats with ratchets and triplet rolls, a dark minor bell or pluck melody"),
  G("drill", "drill", "hiphop", 138, 146, "half time, a sliding 808 bass with drill slides, sparse triplet hats and syncopated snares off the grid, a dark minor piano or string melody", ["uk drill"]),
  G("phonk", "phonk", "hiphop", 130, 145, "a cowbell melody (hexop or halo), a distorted sliding 808, memphis-style chopped vox, rattling hats, gritty saturation"),
  G("memphis", "memphis rap", "hiphop", 65, 80, "a slow dark 808 beat, eerie minor keys, lo-fi saturation, chanted vox, cowbell and hat patterns"),
  G("cloud-rap", "cloud rap", "hiphop", 60, 80, "slow trap drums, dreamy reverb-washed pads and pitched vox, a soft sub, hazy"),
  G("west-coast", "g-funk", "hiphop", 88, 98, "a laid-back funky beat, a whiny portamento lead (ladder with glide), a fat synth bass, funky seventh chords", ["west coast"]),
  G("jazz-rap", "jazz rap", "hiphop", 85, 95, "a swung boom bap beat, upright-bass-like electric bass, muted jazzy piano or horn-like chords, warm"),
  G("abstract", "abstract hip hop", "hiphop", 75, 95, "off-kilter drums with nudged steps, wonky detuned synths, unusual chords, experimental textures"),

  // pop & r&b
  G("pop", "pop", "pop", 100, 128, "a punchy modern beat, a catchy vox hook in the chorus, bright chords, a clear verse / pre / chorus form with a big lift"),
  G("synthpop", "synthpop", "pop", 110, 128, "drum machine beats, bright analog synth chords and arpeggios, a catchy synth lead, a vox melody, upbeat 80s feel"),
  G("electropop", "electropop", "pop", 115, 130, "a punchy electronic beat, sidechained synth chords, a hooky lead, glossy and modern"),
  G("rnb", "r&b", "pop", 65, 95, "a smooth swung beat, rich extended chords on tines, a deep sub bass, a sung vox melody, sensual", ["rnb"]),
  G("neo-soul", "neo soul", "pop", 75, 95, "a loose swung beat with nudged steps, warm extended jazz chords, a melodic bass, soulful vox"),
  G("hyperpop", "hyperpop", "pop", 140, 170, "maximalist: distorted kicks, pitched-up vox, sugary supersaw chords, glitchy edits and sudden switches"),
  G("kpop", "k-pop", "pop", 110, 130, "punchy beats with genre switches between sections, a big hooky chorus, layered synths and a rap-like verse", ["kpop"]),
  G("dream-pop", "dream pop", "pop", 80, 110, "hazy reverb-washed guitars and pads, a soft beat, breathy vox, chorus and delay everywhere"),
  G("indie-dance", "indie dance", "pop", 115, 125, "a driving four on the floor, a live-feeling bass, guitar chops, an arpeggiated synth, a vox hook"),

  // rock & metal
  G("rock", "rock", "rock", 100, 140, "a live-feeling acoustic kit (a sampler kit like salamander) with kick, snare on 2 and 4 and crash at section starts, driven electric guitar power chords, a locked-in electric bass, verse and chorus with a big lift"),
  G("punk", "punk", "rock", 160, 200, "fast and loud: a straight driving beat, distorted power chords, a pumping eighth-note bass, short sections"),
  G("post-punk", "post-punk", "rock", 120, 150, "a tight motorik beat, a melodic chorused bass that leads, angular clean guitar, cold and moody"),
  G("psych-rock", "psychedelic rock", "rock", 100, 130, "a loose live kit with busy tom fills, a melodic electric bass, a fuzz lead guitar (dm:guitar fuzz lead) through phaser and a long delay, organ or mellotron-like chords on oracle, modal and mixolydian, swirling flanger and reverb, a jam section that builds", ["psych", "psychedelia", "60s psych"]),
  G("acid-rock", "acid rock", "rock", 110, 140, "heavier and louder psych: a driving beat, a fuzzed riff doubled by the bass, a wah-like auto-wah on the lead guitar, long distorted solos, feedback swells (dm:guitar with bloom up), a big wet reverb"),
  G("stoner-rock", "stoner rock", "rock", 70, 110, "a heavy groovy beat, a down-tuned fuzz riff on dm:guitar (fuzz lead or grunge) doubled by a fuzzed bass, a hypnotic repeated riff, desert-dry room, long jams", ["stoner", "desert rock"]),
  G("space-rock", "space rock", "rock", 100, 140, "a motorik or driving beat, a pulsing eighth-note bass, droning synths and swooshing noise (the drone engine, phaser, delay feedback), echoing guitars, cosmic and repetitive", ["cosmic rock"]),
  G("neo-psych", "neo-psychedelia", "rock", 90, 125, "a groovy modern beat, a melodic bass, chorused and phased guitars, a dreamy vox, vintage synths (oracle, drift), tape saturation (cassette) and lots of delay", ["modern psych"]),
  G("psych-folk", "psych folk", "rock", 70, 110, "strummed inst:guitar-acoustic chords with a strum, a nylon guitar picking a drone figure, hand percussion, a hazy vox, reverb and a slow phaser, modal and dreamy", ["freak folk", "acid folk"]),
  G("garage-psych", "garage psych", "rock", 120, 160, "a raw fast beat, a farfisa-like organ riff (oracle or drift), a fuzzy surf-ish guitar, a simple driving bass, tremolo and spring-style reverb, snotty vox", ["60s garage"]),
  G("heavy-psych", "heavy psych", "rock", 80, 120, "long jams over a slow heavy groove, a fuzz bass riff, a wah and fuzz lead that wanders, organ swells, a huge reverb on the drums, builds into a wall of noise", ["proto metal"]),
  G("shoegaze", "shoegaze", "rock", 90, 130, "walls of fuzzy, chorused, reverb-soaked guitars, a steady beat buried in the mix, dreamy vox"),
  G("metal", "metal", "rock", 100, 180, "palm-muted distorted guitar riffs on the hi-gain amp, a double-kick pattern, a tight bass doubling the riff, crash-heavy"),
  G("doom", "doom metal", "rock", 50, 75, "slow crushing riffs on a guitar tuned low through a cranked hi-gain amp, a fuzzed bass doubling it, a huge slow beat with long crash tails, minor and phrygian, every chord left to ring", ["sludge"]),
  G("drone-metal", "drone metal", "rock", 40, 60, "no riffs to speak of: one detuned guitar chord held for bars through a saturated amp with bloom up so it feeds back, a sub bass under it, a fuzz or the drone engine for the wall of noise, drums sparse or absent, glacial and enormous", ["drone doom"]),
  G("surf", "surf rock", "rock", 140, 170, "a driving beat, a twangy reverbed lead guitar (surf twang), tremolo picking, a walking bass"),
  G("blues", "blues", "rock", 70, 120, "a shuffle beat, a twelve-bar progression, an electric guitar with bends and a warm tweed amp, a walking bass"),
  G("indie", "indie rock", "rock", 110, 140, "a live kit, jangly clean or slightly driven guitars, a melodic bass, a vox melody, verse and chorus"),
  G("math-rock", "math rock", "rock", 110, 160, "odd meters (7/8, 5/4 patterns), intricate clean guitar tapping lines, tight complex drums"),

  // jazz, funk & soul
  G("funk", "funk", "soul", 95, 115, "a tight syncopated beat with ghost notes on the one, a slap bass line, choppy muted guitar, brass-like stabs"),
  G("disco", "disco", "soul", 112, 122, "four on the floor, open hats on every offbeat, an octave-jumping bassline on the electric bass, funky rhythm guitar chops, string or brass stabs, joyful major chords"),
  G("nu-disco", "nu disco", "soul", 110, 122, "a disco groove with modern synths, a filtered bass, sidechained chords, a dreamy lead"),
  G("jazz", "jazz", "soul", 100, 180, "a swung ride and brushed snare feel (high swing), a walking bass, extended chords on tines, a melodic lead improvising over them"),
  G("bebop", "bebop", "soul", 180, 240, "very fast and heavily swung: a ride ping on every beat with the skip, hats on 2 and 4, kick and snare dropping bombs off the beat, a walking bass on every quarter, sparse comped min7 / dom7 chords on tines moving every two beats, a long fast eighth-note lead line full of chromatic passing notes", ["bop"]),
  G("hard-bop", "hard bop", "soul", 140, 200, "bebop slowed a little and made bluesier and churchier: a driving swung ride, a hard walking bass, punchy two-voice horn-like lead lines (hexop brass), funky blues phrases, piano comping on tines"),
  G("cool-jazz", "cool jazz", "soul", 110, 150, "relaxed and airy: brushes on the snare, a soft swung ride, a light walking bass, soft maj7 and min9 chords, a mellow breathy lead (hexop or a filtered ladder) playing long tones and space"),
  G("modal-jazz", "modal jazz", "soul", 120, 160, "long stretches on one mode (dorian, then up a half step), quartal chord voicings on tines, a swung ride, a bass walking around the mode, a spacious lead that explores the scale"),
  G("swing-big-band", "swing", "soul", 140, 200, "big band swing: four on the floor kick feathered quietly, a swung ride, hats on 2 and 4, a walking bass, unison riffs and shout chords from brass (hexop brass, oracle poly brass), call and response sections", ["big band", "swing era"]),
  G("gypsy-jazz", "gypsy jazz", "soul", 180, 240, "no drums: la pompe rhythm guitar (inst:guitar-acoustic, short chords on every beat, accented 2 and 4, decay low), a walking upright-style bass, a fast virtuosic nylon or acoustic guitar lead with arpeggios, minor 6 chords", ["manouche", "django"]),
  G("latin-jazz", "latin jazz", "soul", 160, 220, "a clave-driven groove: congas and cowbell as euclid rhythms, a montuno piano pattern on tines, a syncopated tumbao bass that anticipates the beat, bright horn-like leads", ["afro-cuban jazz"]),
  G("jazz-fusion", "jazz fusion", "soul", 100, 140, "tight funk-rock drums, a busy electric bass (dm:bass slap or modern di), extended chords on oracle and tines, a fast singing lead on dm:guitar or a ladder, odd meters and unison runs", ["fusion"]),
  G("smooth-jazz", "smooth jazz", "soul", 85, 105, "a clean laid-back r&b groove, lush maj9 chords on tines, a warm fretless-feeling bass, a sweet sax-like lead (hexop), soft clean guitar fills"),
  G("jazz-ballad", "jazz ballad", "soul", 55, 75, "slow brushes swirling on the snare, a sparse two-feel bass, rich extended chords on tines with long release, a tender lead with lots of space"),
  G("spiritual-jazz", "spiritual jazz", "soul", 70, 120, "a modal drone over one chord, rolling tom and cymbal swells, a bass ostinato, harp-like arpeggios (plaits:11), a searching lead, reverb and patience", ["cosmic jazz"]),
  G("free-jazz", "free jazz", "soul", 80, 240, "loose time: chance generators on every part, clusters on tines, rubbery bass runs, drums as texture (rolls and crashes), squalling leads, abrupt stops"),
  G("nu-jazz", "nu jazz", "soul", 100, 125, "jazz chords and a walking or upright bass over programmed broken beats, electronic textures and delays, a muted trumpet-like lead", ["electro jazz"]),
  G("jazz-waltz", "jazz waltz", "soul", 120, 180, "in 3/4: a swung ride in three, the bass on beat one and walking through the bar, rotating maj7 and min7 chords on tines, a lyrical lead"),
  G("dixieland", "dixieland", "soul", 180, 240, "early New Orleans jazz: a two-beat bass (sampled electric bass playing the root and fifth), a banjo-like strum on inst:guitar-acoustic on every beat, snare press rolls, three bright lead lines weaving around each other", ["trad jazz", "new orleans"]),
  G("ragtime", "ragtime", "soul", 90, 120, "piano style on tines: an oom-pah left hand (low root on 1 and 3, chord on 2 and 4), a syncopated right-hand melody, march form, no drums"),
  G("acid-jazz", "acid jazz", "soul", 95, 115, "a funky breakbeat, organ and electric piano chords, a groovy bass, jazzy horns-like leads"),
  G("soul", "soul", "soul", 70, 110, "a warm laid-back beat, electric piano and organ chords, a melodic bass, a big soulful vox"),
  G("gospel", "gospel", "soul", 70, 130, "rich organ and piano chords with passing changes, a choir on vox (many voices), clapping on 2 and 4"),
  G("motown", "motown", "soul", 110, 130, "a four on the floor snare-on-every-beat feel, a busy melodic bass, tambourine, bright piano and strings"),

  // latin & world
  G("reggaeton", "reggaeton", "world", 88, 98, "the dembow rhythm (kick on every beat, snare on the 'and' of 2 and the 4 pattern), a deep 808 bass, a catchy minor synth or plucked hook"),
  G("dembow", "dembow", "world", 115, 125, "fast dominican dembow rhythm, chopped vox, a punchy kick and snare, a repetitive synth hook"),
  G("baile-funk", "baile funk", "world", 128, 135, "the tamborzão rhythm on 808 kicks and toms, chopped vox, a heavy 808 bass, raw and energetic", ["funk carioca"]),
  G("afrobeats", "afrobeats", "world", 98, 115, "a bouncy syncopated beat with log drum or tom patterns, shakers, a warm bass, bright guitar or plucked melodies, a vox hook"),
  G("amapiano", "amapiano", "world", 110, 116, "a laid-back shuffled four on the floor, the log drum bass (subby with a pitch drop, sliding), jazzy piano chords, shakers"),
  G("afrobeat", "afrobeat", "world", 100, 120, "a polyrhythmic groove, interlocking guitar lines, a repetitive bass, horn-like stabs, long hypnotic sections"),
  G("bossa", "bossa nova", "world", 120, 140, "a gentle syncopated rim and kick pattern, nylon-like clean guitar chords with sevenths and ninths, a soft bass, intimate"),
  G("samba", "samba", "world", 95, 105, "busy syncopated percussion (euclid rhythms on toms, rims and shakers), a two-feel bass, bright chords"),
  G("salsa", "salsa", "world", 160, 210, "a clave-based groove, montuno piano patterns, an anticipated bass (tumbao), brass-like stabs"),
  G("cumbia", "cumbia", "world", 85, 110, "a steady scratchy güiro-like hat pattern, a bouncing bass, an accordion-like lead on oracle or drift"),
  G("flamenco", "flamenco", "world", 90, 150, "phrygian guitar strumming, handclap patterns (palmas) in twelve-beat feel, a passionate melody"),
  G("bhangra", "bhangra", "world", 90, 110, "the chaal rhythm on tom-like drums (dhol), a bouncy bass, a tumbi-like plucked riff, energetic"),
  G("arabic", "arabic pop", "world", 90, 110, "maqsum rhythm on darbuka-like percussion, a phrygian or harmonic minor melody, strings-like pads"),
  G("balkan", "balkan beat", "world", 120, 150, "odd-meter folk rhythms (7/8, 9/8), brass-like leads, a bouncy bass, accordion-like riffs"),
  G("kpop-trot", "city pop", "world", 100, 120, "a smooth funky beat, lush jazzy chords on tines, a slap-ish bass, a bright sax-like lead, 80s japanese nostalgia", ["citypop"]),

  // reggae & dub
  G("reggae", "reggae", "reggae", 70, 90, "a one-drop beat (kick and snare on 3), offbeat guitar and organ skanks, a deep melodic bass, relaxed"),
  G("dub", "dub", "reggae", 65, 85, "a one-drop beat, a heavy bass, sparse skanks with long delay and spring-like reverb throws (lanes on the wets), elements dropping in and out"),
  G("dancehall", "dancehall", "reggae", 90, 105, "a punchy digital riddim, a syncopated kick and snare, a deep bass, a catchy synth hook"),
  G("ska", "ska", "reggae", 140, 180, "an upbeat offbeat guitar skank, a walking bass, a driving beat, brass-like stabs"),
  G("steppers", "steppers", "reggae", 70, 80, "four kicks to the bar under a one-drop, a heavy rolling bass, dub sirens and delays"),

  // synth & retro
  G("synthwave", "synthwave", "retro", 96, 118, "a punchy gated-reverb snare on 2 and 4, a driving eighth-note bass, lush detuned poly chords (oracle with chorus), an arpeggio, a soaring lead, 80s nostalgia", ["outrun", "retrowave"]),
  G("darksynth", "darksynth", "retro", 100, 130, "aggressive distorted synth bass, dark minor arpeggios, heavy drums, horror-film menace"),
  G("italo", "italo disco", "retro", 115, 125, "a steady four on the floor, an octave bass, bright arpeggios, a catchy synth melody, a vocoder-ish vox"),
  G("new-wave", "new wave", "retro", 120, 150, "a driving beat, chorused bass, bright synth stabs and clean guitar, a catchy vox"),
  G("chiptune", "chiptune", "retro", 120, 180, "square and pulse wave leads and arpeggios (plaits or drift), a triangle bass, noise percussion, fast arps for chords, 8-bit", ["8-bit", "8bit"]),
  G("vaporwave", "vaporwave", "retro", 60, 90, "slowed-down smooth jazz and muzak chords, heavy reverb, cassette wow and flutter, a lazy beat, dreamy and hazy"),
  G("krautrock", "krautrock", "retro", 110, 140, "a motorik beat (steady hats and kick), a hypnotic repetitive bass, droning synths and guitars, long sections"),
  G("electro-funk", "electro funk", "retro", 100, 120, "808 beats, funky synth bass, talk-box-like vox, bright synth stabs"),
  G("berlin-school", "berlin school", "retro", 100, 130, "sequenced analog arpeggios that evolve over many minutes (filter lanes), pads and mellotron-like strings, cosmic"),

  // ambient & experimental
  G("ambient", "ambient", "ambient", 60, 84, "no drums or only the faintest pulse, long evolving pads and a drone, slow LFOs and lanes on the filter and the reverb, sparse bell or pluck notes, wide and spacious with long reverb tails"),
  G("drone", "drone", "ambient", 50, 80, "the drone engine holding long chords that barely move, slow filter and cloud changes, no beat"),
  G("idm", "idm", "ambient", 90, 140, "intricate glitchy drum programming with ratchets, nudges and euclid rhythms, melancholy pads, unusual synth textures", ["braindance"]),
  G("glitch", "glitch", "ambient", 90, 130, "stuttering repeats and slices (the repeat stage), crushed and clicky percussion, fragmented melodies"),
  G("downtempo", "downtempo", "ambient", 80, 100, "a slow head-nod beat, lush pads, a deep bass, delays and reverbs, relaxed", ["chillout", "trip-hop"]),
  G("trip-hop", "trip hop", "ambient", 70, 95, "a slow heavy swung breakbeat, dark jazzy chords, a deep bass, vinyl crackle, a moody vox"),
  G("cinematic", "cinematic", "ambient", 60, 100, "big swelling strings and brass-like pads, deep booms (siege rumble), a slow build to a huge climax, a gentle theme"),
  G("dark-ambient", "dark ambient", "ambient", 50, 80, "low rumbling drones, metallic scrapes, distant echoes, unsettling slowly moving harmony"),
  G("new-age", "new age", "ambient", 60, 90, "gentle bell and pad textures, a slow melody, major and lydian harmony, calming"),
  G("musique", "experimental", "ambient", 60, 160, "unusual sounds and rhythms: euclid and chance generators, odd meters, the drone and vox engines used strangely, surprising textures"),
];

/** A genre by id, or undefined. @param {string} id */
export function genreById(id) {
  return GENRES.find((g) => g.id === id);
}

const norm = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9&]+/g, " ").trim();

/**
 * Genres matching a search, best first, within a family when one is picked.
 * Ranked: the name starts with the query, then a word of the name or an
 * alias does, then the query is anywhere in the name, an alias or the family,
 * then in the brief. An empty query lists the family (or everything) in
 * table order.
 * @param {string} query
 * @param {string} [family] a GENRE_FAMILIES id, or "" for all
 */
export function searchGenres(query, family = "") {
  const pool = family ? GENRES.filter((g) => g.family === family) : GENRES;
  const q = norm(query);
  if (!q) return pool.slice();
  const scored = [];
  for (const g of pool) {
    const name = norm(g.name);
    const words = [name, ...(g.tags || []).map(norm)];
    const fam = norm(GENRE_FAMILIES.find((f) => f.id === g.family)?.name);
    let score = 0;
    if (name.startsWith(q)) score = 4;
    else if (words.some((w) => w.startsWith(q) || w.split(" ").some((p) => p.startsWith(q)))) score = 3;
    else if (words.some((w) => w.includes(q)) || fam.includes(q)) score = 2;
    else if (norm(g.brief).includes(q)) score = 1;
    if (score) scored.push({ g, score });
  }
  scored.sort((a, b) => b.score - a.score || a.g.name.localeCompare(b.g.name));
  return scored.map((s) => s.g);
}

// ---- the dice ----------------------------------------------------------------
//
// The same sentence sent twice gets the same song back: given a tempo range
// and a list of instruments, a model settles on the middle of one and the
// first of the other. So the choices are made HERE, from a seed, and the
// prompt carries decisions. A genre with a `plan` has its drums, instruments,
// harmony and moves drawn; every genre has its tempo, key note, form and
// angle drawn.

/** A drum source, as the prompt names it. */
export const KITS = {
  "808": "the 808 voices (dm:808-kick, dm:808-snare, dm:808-clap, dm:808-chat, dm:808-ohat)",
  "909": "the 909 voices (dm:909-kick, dm:909-snare, dm:909-clap, dm:909-chat, dm:909-ohat)",
  synth: "the drum synths: dm:siege for the kick, dm:lancet for the snare, dm:halo for every hat and cymbal",
  "siege-909": "a dm:siege kick under 909 claps and hats (dm:909-clap, dm:909-chat, dm:909-ohat)",
  "siege-808": "a dm:siege kick under 808 claps and hats (dm:808-clap, dm:808-chat, dm:808-ohat)",
  techno: "the sampler's Techno kit (techno kick, techno snare, techno hat, techno tom)",
  cr78: "the sampler's CR78 kit (cr78 kick, cr78 snare, cr78 hat)",
  r8: "the sampler's R8 kit (r8 kick, r8 snare, r8 hat)",
  breaks: "the sampler's break kit (break kick, break snare, break hat)",
  live: "the sampler's live kit (live kick, live snare, live hat)",
  salamander: "a sampler per piece from the salamander acoustic kit",
  virtuosity: "a sampler per piece from the virtuosity acoustic kit",
  drskit: "a sampler per piece from the drskit acoustic kit",
};

const ROOTS = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];

/** How a build leans, when the family has no list of its own. */
const ANGLES = [
  "stripped back: few tracks, lots of space, every part earning its place",
  "peak energy: dense drums, everything forward",
  "melodic: the chords and the hook lead, the drums support",
  "dark and moody: low, filtered, tense",
  "rough and lo-fi: saturation, cassette or crush on something",
  "polished and wide: clean, bright, stereo fx",
  "hypnotic: one idea that barely changes while the sound around it moves",
  "playful: a bright hook and plenty of syncopation",
];

/** What the second pass of the main section has that the first did not. */
const LIFTS = [
  "a counter-melody over the hook",
  "the hook an octave up, or doubled on a second instrument",
  "a different bass pattern under the same chords",
  "an extra percussion track",
  "a changed drum pattern (busier hats, a displaced kick)",
  "a new chord in the progression, or its last chord swapped",
];

/**
 * Forms per family, bars per section, chain mode's way (each section a slot,
 * 16 bars at most). A genre's own `plan.forms` replaces them.
 * @type {Record<string, { forms: string[], angles?: string[], layered?: boolean }>}
 */
export const FAMILY_PLANS = {
  house: { forms: [
    "intro 16 | groove 16 | build 8 | drop 16 | break 16 | build 8 | drop 16 | outro 16",
    "intro 8 | drop 16 | break 8 | build 8 | drop 16 | outro 8",
    "intro 16 | groove 16 | groove 16 | break 16 | build 16 | drop 16 | drop 16 | outro 16",
    "hook 8 | groove 16 | break 8 | build 8 | drop 16 | groove 16 | outro 8",
  ] },
  techno: { forms: [
    "intro 16 | groove 16 | build 8 | drop 16 | break 16 | build 8 | drop 16 | outro 16",
    "intro 16 | layer 16 | layer 16 | peak 16 | strip 8 | peak 16 | outro 16",
    "intro 8 | groove 16 | break 8 | build 8 | peak 16 | peak 16 | outro 8",
    "intro 16 | groove 16 | groove 16 | break 16 | build 16 | peak 16 | outro 16",
  ] },
  trance: { forms: [
    "intro 16 | groove 16 | break 16 | build 8 | drop 16 | drop 16 | outro 16",
    "intro 8 | groove 16 | break 16 | build 16 | drop 16 | outro 8",
    "intro 16 | drop 16 | break 16 | build 8 | drop 16 | outro 8",
  ] },
  bass: { forms: [
    "intro 16 | build 8 | drop 16 | break 8 | build 8 | drop 16 | outro 8",
    "intro 8 | drop 16 | verse 16 | build 8 | drop 16 | outro 8",
    "intro 16 | drop 16 | switch 8 | break 8 | build 4 | drop 16 | outro 8",
  ] },
  breaks: { forms: [
    "intro 16 | build 8 | drop 16 | break 8 | build 4 | drop 16 | outro 8",
    "intro 16 | drop 16 | drop 16 | break 16 | build 8 | drop 16 | outro 16",
    "intro 8 | groove 16 | break 8 | build 8 | drop 16 | switch 16 | outro 8",
  ] },
  hiphop: { forms: [
    "intro 4 | A 8 | B 8 | A 8 | B 8 | outro 4",
    "intro 4 | hook 8 | verse 16 | hook 8 | verse 16 | hook 8 | outro 4",
    "intro 8 | verse 16 | hook 8 | bridge 8 | hook 8 | outro 4",
    "hook 8 | verse 8 | hook 8 | break 4 | verse 8 | hook 8 | outro 4",
  ] },
  pop: { forms: [
    "intro 4 | verse 8 | pre 4 | chorus 8 | verse 8 | pre 4 | chorus 8 | bridge 8 | chorus 8 | outro 4",
    "intro 4 | verse 8 | chorus 8 | verse 8 | chorus 8 | bridge 8 | chorus 8 | chorus 8 | outro 4",
    "chorus 8 | verse 8 | pre 4 | chorus 8 | bridge 8 | chorus 8 | outro 4",
  ] },
  rock: { forms: [
    "intro 4 | verse 8 | chorus 8 | verse 8 | chorus 8 | solo 8 | chorus 8 | outro 4",
    "riff 8 | verse 8 | riff 4 | verse 8 | chorus 8 | jam 16 | chorus 8 | outro 4",
    "intro 8 | verse 16 | chorus 8 | verse 16 | chorus 8 | bridge 8 | chorus 16 | outro 4",
  ] },
  soul: { forms: [
    "intro 4 | head 16 | solo 16 | solo 16 | head 16 | outro 4",
    "intro 8 | A 8 | A 8 | B 8 | A 8 | solo 16 | A 8 | outro 4",
    "vamp 8 | verse 16 | chorus 8 | verse 16 | chorus 8 | breakdown 8 | chorus 8 | vamp 8",
  ] },
  world: { forms: [
    "intro 4 | verse 8 | chorus 8 | verse 8 | chorus 8 | break 8 | chorus 8 | outro 4",
    "intro 8 | groove 16 | hook 8 | groove 16 | hook 8 | percussion break 8 | hook 8 | outro 8",
    "hook 8 | verse 16 | hook 8 | verse 16 | break 8 | hook 16 | outro 4",
  ] },
  reggae: { forms: [
    "intro 4 | verse 8 | chorus 8 | verse 8 | chorus 8 | dub 16 | chorus 8 | outro 4",
    "intro 8 | riddim 16 | drop-out 8 | riddim 16 | dub 16 | outro 8",
    "intro 4 | chorus 8 | verse 16 | chorus 8 | dub 16 | chorus 8 | outro 4",
  ] },
  retro: { forms: [
    "intro 8 | verse 16 | chorus 8 | verse 16 | chorus 8 | solo 8 | chorus 8 | outro 8",
    "intro 16 | theme 16 | variation 16 | break 8 | theme 16 | outro 8",
    "intro 8 | theme 16 | break 8 | build 8 | theme 16 | theme 16 | outro 8",
  ] },
  ambient: {
    layered: true,
    forms: [
      "A 16 | B 16 | A' 16 | coda 8",
      "emerge 16 | A 16 | swell 16 | A' 16 | dissolve 16",
      "A 16 | A' 16 | B 16 | B' 16 | coda 8",
    ],
    angles: [
      "still: almost nothing changes, and what does changes slowly",
      "warm and tonal: consonant chords, soft attacks",
      "cold and uneasy: dissonance, metal, distance",
      "melodic: a sparse theme that returns",
      "textural: noise, grains and movement in place of notes",
    ],
  },
};

const ANGLES_AT = (...i) => i.map((n) => ANGLES[n]);
const FOUR = "x...x...x...x...";
const BACK = "....X.......X...";
const OFF = "..x...x...x...x.";

/** @type {Record<string, GenrePlan>} */
const PLANS = {
  house: {
    swing: [0.08, 0.18], kits: ["909", "siege-909", "synth"],
    drums: [
      { kick: FOUR, clap: BACK, hat: "x.x.x.x.x.x.x.x.", "open hat": OFF },
      { kick: FOUR, clap: "....X.......X..o", hat: "x.oxx.oxx.oxx.ox", "open hat": OFF },
      { kick: "x...x...x...x.x.", clap: "....X..o....X...", "open hat": OFF, rim: "..x..x....x..x.." },
    ],
    core: { bass: ["dm:sub/house sub", "dm:ladder/model d bass", "dm:hexop/bass", "dm:bass/modern di"], chords: ["dm:tines", "dm:hexop/organ", "dm:oracle/pulse keys", "dm:oracle/dirty stab"] },
    optional: { lead: ["dm:ladder/funk lead", "dm:drift", "dm:poly-saw"], pad: ["dm:oracle/strings", "dm:oracle/warm pad", "dm:pad"], vox: ["dm:vox/soul lead", "dm:vox/la la"], shaker: ["dm:halo/shaker"] },
    extras: [1, 2],
    bass: ["off the kick: notes on the offbeats `..x...x...x.x...`, root and fifth", "a syncopated two-bar line that walks up to the next chord `x..x..x...x.x_..`", "an octave bounce `x.x.x.x.x.x.x.x.`, low on the beat and high off it"],
    harmony: ["minor: i7 - iv7 - bVII - i7, stabbed on the offbeats", "dorian: i7 - IV7, two bars each, the dorian vamp", "minor: i9 - bVI maj7 - bVII, one chord a bar", "major: ii7 - V7 - I maj7 - vi7, a gospel piano feel", "mixolydian: I7 - bVII - IV, bright and bluesy"],
    moves: ["the chords under a cutoff lane that opens through the build", "sidechain the chords and pad from the kick", "a piano or organ stab rhythm `..x..x....x..x..` that never lands on the beat", "a one-bar kick drop-out before each drop", "a clap flam and an open-hat lift in the last bar of every eight"],
    avoid: ["a bass note on every kick", "a lead that plays all the way through", "unswung, same-velocity hats"],
  },
  "deep-house": {
    swing: [0.1, 0.2], kits: ["909", "siege-808", "cr78"],
    drums: [
      { kick: FOUR, clap: "....x.......x...", hat: "..o...o...o...o.", shaker: "xoxoxoxoxoxoxoxo" },
      { kick: FOUR, rim: ".......x..x.....", hat: "x.ox..oxx.ox..ox", clap: "............x..." },
      { kick: FOUR, clap: "....x.......x...", "open hat": OFF, rim: "..x....x....x..." },
    ],
    core: { bass: ["dm:sub/house sub", "dm:hexop/bass", "dm:ladder/pedal bass"], chords: ["dm:tines", "dm:oracle/warm pad", "dm:hexop/e.piano", "dm:oracle/glass"] },
    optional: { pad: ["dm:oracle/strings", "dm:pad"], lead: ["dm:hexop/bell", "dm:hexop/marimba", "plaits:12"], vox: ["dm:vox/soul lead", "dm:vox/whisper"] },
    extras: [1, 2],
    bass: ["long round notes, one or two a bar, sliding into the next root `x_____..x___....`", "a rolling offbeat line `..x_..x_..x_.xx_`", "a sparse call every two bars, silent in between"],
    harmony: ["minor: i min9 - iv min9, four bars each", "dorian: i min7 - bVII maj7 - bIII maj7 - v min7", "dorian/minor: one chord, i min9 or min11, held, the bass moving under it (1, b7, 4)", "major: ii min9 - V13 - I maj9, slow"],
    angles: ANGLES_AT(0, 2, 3, 6, 5),
    moves: ["chords held long with a slow LFO on the cutoff", "a delay throw on the last chord of every eight bars", "a chord stab answered by a bell note two beats later", "the kick alone with the pad in the break", "everything quiet: velocities under X, nothing harsh"],
    avoid: ["a bright or aggressive lead", "a snare: this is claps and rims", "resonance high on anything"],
  },
  acid: {
    swing: [0, 0.1], kits: ["909", "siege-909", "808"],
    drums: [
      { kick: FOUR, clap: BACK, "open hat": OFF, hat: "xoxoxoxoxoxoxoxo" },
      { kick: "x...x...x...x..x", clap: BACK, "open hat": OFF, rim: "..x..x..x..x..x." },
      { kick: FOUR, snare: "....X.......X.xx", hat: "x.x.x.x.x.x.x.x.", "open hat": OFF },
    ],
    core: { acid: ["dm:silverbox"] },
    optional: { bass: ["dm:sub/acid", "dm:sub/house sub"], stab: ["dm:oracle/dirty stab", "dm:hexop/organ"], pad: ["dm:oracle/warm pad", "dm:pad"], "second acid": ["dm:silverbox"] },
    extras: [0, 2],
    bass: ["the silverbox IS the bass: a sixteen-step line with three accents (X) and two slides (ties) `x.xXx_x.X.x.x_xX`, mostly the root with an octave jump and a b2 or b7", "a sparser line with rests that the accents punch through `X..x.x_.X.x...x_`, two bars, the second bar ending differently", "a line of straight sixteenths where only pitch and accent move `xxXxxxXxxXxxx_Xx`"],
    harmony: ["minor/phrygian/minor pentatonic: no chords: one root, the line itself implying the key with its b7 (and the b2 in phrygian)", "minor/phrygian: no chords; the line moved up a fourth for the last two bars of every eight", "minor: a single held minor stab on the offbeat, nothing else harmonic"],
    angles: ANGLES_AT(0, 1, 3, 4, 6),
    moves: ["cutoff and reson lanes on the silverbox that differ in EVERY section: closed in the intro, wide open in the drop", "sbaccent high so the accents bark", "a second silverbox an octave up answering the first in the last drop", "delay on the silverbox, wet rising through the build", "the kick out for the last bar of the build while the resonance peaks"],
    avoid: ["a silverbox line with no accents or no ties", "pads or chords carrying the track", "the cutoff sitting still for a whole section"],
  },
  techno: {
    swing: [0, 0.08], kits: ["synth", "siege-909", "techno"],
    drums: [
      { kick: FOUR, "open hat": OFF, clap: BACK, hat: "xoxoxoxoxoxoxoxo" },
      { kick: FOUR, hat: "..xo..xo..xo..xo", rim: "...x..x...x..x..", ride: "x.x.x.x.x.x.x.x." },
      { kick: FOUR, tom: "..x..x....x..x..", clap: "............x...", hat: "oxXxoxXxoxXxoxXx" },
    ],
    core: { bass: ["dm:sub/reese", "dm:sub/growl", "dm:ladder/pedal bass", "dm:contagion", "dm:silverbox"] },
    optional: { stab: ["dm:oracle/dirty stab", "dm:hexop/bell", "plaits:6"], pad: ["dm:drone/machine hum", "dm:ladder/noise pad", "dm:pad"], blip: ["dm:hexop/init", "plaits:2", "dm:snarl"], perc: ["dm:halo/trash", "dm:lancet/metal fm", "plaits:10"], vox: ["dm:vox/robot choir", "dm:vox/monk chant"] },
    extras: [1, 3],
    bass: ["a rolling sixteenth line in the gaps between kicks `.xxx.xxx.xxx.xxx`, one note, the filter doing the work", "an offbeat pulse `..x...x...x...x.` on the root", "a three-note phrase five steps long against the bar (track length 5 or 10), a polymeter"],
    harmony: ["minor/phrygian: one root for the whole track, the b2 or b6 the only colour", "minor/harmonic minor: a single minor stab, the same chord throughout, its filter and delay moving", "minor/phrygian: two bass notes a minor third apart, alternating every four bars"],
    angles: ANGLES_AT(0, 1, 3, 4, 6),
    moves: ["a 3-against-4 percussion line (a 12-step track against 16)", "the stab on a euclid ring, its rotate under a slow LFO", "a hat or ride that enters only at the peak", "reverb on a bus with one percussion hit thrown into it", "a rumble: a siege kick (preset rumble) or a low drone under the kick", "one lane per section on the bass cutoff, each a different shape"],
    avoid: ["a chord progression", "a singable lead melody", "fills every four bars: change by adding and removing layers"],
  },
  trance: {
    swing: [0, 0.04], kits: ["909", "siege-909", "synth"],
    drums: [
      { kick: FOUR, clap: BACK, "open hat": OFF, hat: "xoxoxoxoxoxoxoxo" },
      { kick: FOUR, clap: BACK, "open hat": OFF, ride: "x.x.x.x.x.x.x.x." },
    ],
    core: { bass: ["dm:sub/house sub", "dm:ladder/model d bass", "dm:contagion"], chords: ["dm:contagion", "dm:poly-saw", "dm:oracle/strings"], lead: ["dm:contagion", "dm:ladder/vibrato lead", "dm:poly-saw"] },
    optional: { arp: ["dm:hexop/bell", "plaits:0", "dm:oracle/pulse keys"], pad: ["dm:oracle/warm pad", "dm:pad"], vox: ["dm:vox/angel ooh", "dm:vox/choir aah"], riser: ["plaits:9", "dm:halo/reverse swell"] },
    extras: [1, 3],
    bass: ["offbeat eighths `..x...x...x...x.` following the chord roots", "rolling sixteenths between the kicks `.xxx.xxx.xxx.xxx`", "offbeats with an octave on the last `..x...x...x..x.x`"],
    harmony: ["minor: i - bVI - bIII - bVII, one chord a bar or two", "minor: bVI - bVII - i - i", "harmonic minor: i - iv - bVI - V, the major V pulling back to i", "major: I - V - vi - IV"],
    moves: ["contagion unison up (supersaw) on the chords, sidechained from the kick", "the lead melody first heard alone in the break, on a soft sound, then full in the drop", "a snare roll through the build: quarters, eighths, sixteenths, ratchets", "a gated chord rhythm `x.xxx.xxx.xxx.xx` on the pad", "the arp a 3-step figure against the bar"],
    avoid: ["a break with the kick still in", "a drop that is not the break's melody", "a short dry lead: long notes, delay and reverb"],
  },
  dubstep: {
    swing: [0, 0.06], kits: ["synth", "siege-808", "808"],
    drums: [
      { kick: "x.........x.....", snare: "........X.......", hat: "x.x.x.x.x.x.x.x." },
      { kick: "x......x..x.....", snare: "........X.......", hat: "..x...x...x..xx." },
      { kick: "x..x......x.....", snare: "........X.....o.", hat: "x...x.x.x...x.x." },
    ],
    core: { bass: ["dm:contagion", "dm:sub/growl", "dm:sub/reese", "dm:snarl"], sub: ["dm:sub/pure sine", "dm:sub/dub"] },
    optional: { pad: ["dm:drone/subterranean", "dm:oracle/warm pad", "dm:pad"], lead: ["dm:hexop/bell", "plaits:12", "dm:fm-bell"], vox: ["dm:vox/whisper", "dm:vox/monk chant"], perc: ["dm:halo/trash", "dm:lancet/tin head"] },
    extras: [1, 2],
    bass: ["the wobble: long notes with a synced LFO on the cutoff, the LFO length changing by section (2 steps, 4 steps, a triplet feel)", "call and response: a growl for two beats, silence or the sub alone for two", "short stabs on a rhythm `x..x..x.....x.x.` with a cutoff lane per step, no LFO"],
    harmony: ["phrygian: one root, the b2 above it for menace", "minor: i - bVI, four bars each, on the pad only", "phrygian: the bass moves i, i, bIII, bII across four bars", "harmonic minor: i - V, the raised seventh in the melody"],
    angles: ANGLES_AT(0, 1, 3, 4, 6),
    moves: ["the sub and the mid bass as two tracks, same notes, the sub clean", "everything out for the beat before the drop", "the snare huge: reverb on it alone, long decay", "a sparse, reverbed bell melody in the intro that returns in the break", "the second drop on a different LFO length and a different bass rhythm"],
    avoid: ["four on the floor", "a snare anywhere but beat 3 (step 9) outside fills", "a busy intro: space and dread first"],
  },
  "2-step": {
    swing: [0.18, 0.3], kits: ["909", "siege-909", "r8"],
    drums: [
      { kick: "x......x..x.....", snare: BACK, hat: "x.xox.xox.xox.xo" },
      { kick: "x.....x......x..", snare: "....X.......X..o", hat: OFF, rim: ".o...o...o.o...." },
      { kick: "x.........x..x..", clap: BACK, hat: "x.ox..oxx.ox..ox", rim: ".......o.....o.." },
    ],
    core: { bass: ["dm:sub/house sub", "dm:sub/reese", "dm:hexop/bass"], chords: ["dm:tines", "dm:hexop/organ", "dm:hexop/e.piano", "dm:oracle/pulse keys"] },
    optional: { vox: ["dm:vox/soul lead", "dm:vox/la la"], lead: ["dm:hexop/bell", "dm:hexop/marimba"], pad: ["dm:oracle/strings", "dm:oracle/warm pad"], shaker: ["dm:halo/shaker"] },
    extras: [1, 2],
    bass: ["answers the kick and rests on 2 and 4 `..x_..x....x_...`", "one long sub note a bar with a slide into the next `x_______..x_x_..`", "a bouncing octave figure in the second half of the bar only `........x.x..x.x`"],
    harmony: ["minor: i min9 - iv min9", "minor: i min7 - bVII - bVI maj7, chopped short", "dorian/minor: one min9 chord, its rhythm doing the work `..x..x....x.x...`", "dorian: i min7 - IV7 - i min7 - v min7"],
    moves: ["a pitched vox chop answering the snare", "the chords filtered down in the verse and open in the drop", "the bass out for one bar before the drop", "ghost rims at velocity o between the snares", "a nudge (offset) late on the hats on top of the swing"],
    avoid: ["a kick on beat 2 or 4", "straight unswung hats", "a bass that plays through the whole bar"],
  },
  dnb: {
    swing: [0, 0.08], kits: ["breaks", "synth", "live"],
    drums: [
      { kick: "x.........x.....", snare: BACK, hat: "x.x.x.x.x.x.x.x.", "ghost snare": ".......o.o......" },
      { kick: "x.....x...x.....", snare: "....X..o.o..X...", hat: "x.xxx.x.x.xxx.x." },
      { kick: "x.x.......xx....", snare: "....X..o.o....X.", hat: "x.x.x.x.x.x.x.x.", ride: "x...x...x...x..." },
    ],
    core: { sub: ["dm:sub/pure sine", "dm:sub/reese", "dm:sub/808"] },
    optional: { reese: ["dm:contagion", "dm:sub/growl", "dm:snarl"], pad: ["dm:oracle/strings", "dm:oracle/warm pad", "dm:pad"], keys: ["dm:tines", "dm:hexop/e.piano"], lead: ["dm:hexop/bell", "plaits:12"], vox: ["dm:vox/angel ooh", "dm:vox/soul lead"] },
    extras: [2, 3],
    bass: ["long sub notes, two a bar, following the roots `x_______x_____..`", "a rolling line with a slide into the snare `x_..x_.x_...x_x_`", "a two-note stab pattern that leaves the first beat empty `...x_..x_....x_.`"],
    harmony: ["minor: i min9 - bVI maj7, four bars each, on the pad", "minor: i - bVII - bVI - bVII", "dorian: i min7 - IV7 with the sub on the roots", "minor/phrygian: one chord: the bass line is the harmony"],
    moves: ["a two-bar drum pattern (length 32) whose second bar ends in a fill", "pads and keys only in the intro, drums entering with a roll", "a reese with a slow LFO on the cutoff or the contagion's shape", "the break's snare thrown into a long delay", "the second drop on a displaced kick"],
    avoid: ["a four on the floor kick", "the same one-bar drum loop for sixteen bars", "a sub above C2"],
  },
  hiphop: {
    swing: [0.18, 0.33], kits: ["breaks", "live", "synth"],
    drums: [
      { kick: "x.....x.x.......", snare: BACK, hat: "x.x.x.x.x.x.x.x." },
      { kick: "x..x......x..x..", snare: "....X..o....X...", hat: "x.xxx.x.x.xxx.x." },
      { kick: "x.......x.x.....", snare: "....X.....o.X...", hat: "x.o.x.o.x.o.x.ox" },
    ],
    core: { bass: ["dm:bass/motown", "dm:bass/svt fingers", "dm:sub/dub", "inst:bass-electric"], keys: ["dm:tines", "dm:hexop/e.piano", "inst:guitar-nylon", "dm:oracle/strings"] },
    optional: { lead: ["dm:hexop/bell", "dm:hexop/brass", "plaits:12"], vox: ["dm:vox/soul lead", "dm:vox/doo wop"], scratch: ["plaits:7", "plaits:9"], horn: ["dm:hexop/brass", "dm:oracle/poly brass"] },
    extras: [1, 2],
    bass: ["follows the kick, short notes on the roots with one walk-up a bar", "a two-bar line, busy in the first bar and one long note in the second", "root on the one and a syncopated answer after the snare `x_.....x..x_....`"],
    harmony: ["minor: i min7 - iv min7, two bars each", "phrygian: i min7 - bII maj7 - i min7 - bvii min7, a chromatic step looped like a sample", "dorian: i min7 - IV7, the keys choppy", "minor pentatonic: one min7 chord and a riff over it, the bass carrying the movement"],
    moves: ["vinyl and cassette on the keys, the filter closed to about half", "the loop chopped: the keys' rhythm changes in the hook, the chords do not", "the drums drop out for the last beat before the hook", "ghost snares at velocity o", "kick nudged late (offset) so it drags behind the hat"],
    avoid: ["quantised, unswung drums", "a bright clean mix: this is dusty", "more than two melodic parts at once in a verse"],
  },
  lofi: {
    swing: [0.16, 0.3], kits: ["live", "cr78", "breaks"],
    drums: [
      { kick: "x.....x...x.....", rim: "....x.......x...", hat: "x.o.x.o.x.o.x.o." },
      { kick: "x......x.x......", snare: "....x.......x..o", hat: OFF },
      { kick: "x.........x.x...", snare: "....x.......x...", hat: "x.x.x.x.x.x.x.xo" },
    ],
    core: { bass: ["dm:bass/motown", "dm:sub/pure sine", "inst:bass-electric", "dm:bass/walking jazz"], keys: ["dm:tines", "dm:hexop/e.piano", "inst:guitar-nylon", "inst:guitar-electric"] },
    optional: { lead: ["dm:hexop/bell", "dm:hexop/marimba", "inst:guitar-nylon", "plaits:12"], pad: ["dm:oracle/warm pad", "dm:pad"], vox: ["dm:vox/angel ooh", "dm:vox/whisper"], texture: ["dm:drone/glacier", "plaits:9"] },
    extras: [1, 2],
    bass: ["one soft note a chord, sometimes a walk to the next", "root, then the fifth late in the bar `x_______..x_....`", "a lazy two-bar melody of its own under held chords"],
    harmony: ["major: ii min9 - V13 - I maj9 - vi min7", "major: I maj7 - iii min7 - IV maj7 - V7", "dorian: i min9 - IV9 - bVII maj7 - i min9", "major: IV maj7 - iii min7 - ii min7 - I maj7, descending", "minor: i min9 - iv min9 - bVII7 - bIII maj7"],
    angles: ANGLES_AT(0, 2, 4, 6),
    moves: ["vinyl crackle and cassette wow on the keys or the whole mix bus", "the keys' filter low, nothing bright anywhere", "chords strummed (strum) or arpeggiated slowly", "the drums out for a bar at the end of each eight", "velocities soft and uneven; a nudge late on the snare"],
    avoid: ["anything loud, bright or fast", "a build and a drop", "hard quantised hats at one velocity"],
  },
  trap: {
    swing: [0, 0.06], kits: ["808", "synth", "siege-808"],
    drums: [
      { kick: "x.....x...x.....", clap: "........X.......", hat: "x.x.x.x.x.x.x.x." },
      { kick: "x..x......x...x.", clap: "........X.......", hat: "x.x.x.xxx.x.x.x.", "open hat": "..............x." },
      { kick: "x.........x..x..", snare: "........X.....o.", hat: "x.xxx.x.x.x.xxx." },
    ],
    core: { "808 bass": ["dm:sub/808", "dm:sub/distorted 808", "dm:sub/drill slide", "dm:sub/memphis"], melody: ["dm:hexop/bell", "dm:fm-bell", "dm:tines", "inst:guitar-nylon", "plaits:12", "dm:oracle/glass"] },
    optional: { pad: ["dm:oracle/strings", "dm:oracle/warm pad", "dm:drone/cathedral"], vox: ["dm:vox/monk chant", "dm:vox/choir aah"], counter: ["dm:hexop/brass", "dm:ladder/whistle", "dm:hexop/marimba"], perc: ["dm:808-cowbell", "dm:halo/trash"] },
    extras: [0, 2],
    bass: ["the 808 follows the kick pattern, long notes that slide (legato glide) into the next", "two notes a bar, root then a fifth or octave up, sliding", "sparse: one long 808 every two beats, a fast slide up at the end of each four bars"],
    harmony: ["minor: i - bVI - v, the melody outlining them", "minor: i - i - bVI - bVII", "phrygian: one minor chord, the b2 as a passing note in the melody", "harmonic minor: i - iv, two bars each, the raised seventh in the melody"],
    angles: ANGLES_AT(0, 1, 2, 3, 4),
    moves: ["hat rolls by ratchet (2, 3 and 4) on two or three steps a bar, in different places each section", "the melody a two-bar motif repeated with its last note changed", "the 808 and kick tuned to the key, the 808 on the root", "the melody alone, filtered, for the intro", "drums out for the last beat before the hook"],
    avoid: ["a clap or snare anywhere but beat 3 (step 9) outside fills", "a busy bass: the 808 is long notes", "hats at one velocity with no rolls"],
  },
  synthwave: {
    swing: [0, 0.04], kits: ["r8", "synth", "909"],
    drums: [
      { kick: FOUR, snare: BACK, hat: "x.x.x.x.x.x.x.x." },
      { kick: "x.......x.x.....", snare: BACK, hat: "xoxoxoxoxoxoxoxo" },
      { kick: "x...x...x...x...", snare: BACK, hat: "x.x.x.x.x.x.x.x.", tom: "............oxxX" },
    ],
    core: { bass: ["dm:ladder/model d bass", "dm:hexop/bass", "dm:oracle/unison bass", "dm:drift"], chords: ["dm:oracle/warm pad", "dm:oracle/strings", "dm:drift", "dm:oracle/poly brass"] },
    optional: { lead: ["dm:ladder/vibrato lead", "dm:oracle/poly brass", "dm:guitar/singing lead", "dm:poly-saw"], arp: ["dm:oracle/pulse keys", "dm:hexop/bell", "plaits:0"], vox: ["dm:vox/robot choir", "dm:vox/angel ooh"], bell: ["dm:fm-bell", "dm:oracle/glass"] },
    extras: [2, 3],
    bass: ["driving eighths on the root `x.x.x.x.x.x.x.x.`, the octave on the last", "sixteenths with an accent pattern `XxxxXxxxXxxxXxXx`", "an octave bounce, low then high `x.x.x.x.x.x.x.x.` alternating notes"],
    harmony: ["minor: i - bVI - bIII - bVII", "minor: bVI - bVII - i - i", "major: I - vi - IV - V", "dorian: i - IV - bVII - i, the pad holding each for two bars"],
    moves: ["a big gated snare: lancet or a sampled snare with a short loud reverb", "chorus on the chords and the bass", "an arp of sixteenths across the chord, delay in dotted eighths", "the lead enters in the second chorus only", "a tom fill into every chorus"],
    avoid: ["swing", "modern sidechain pumping as the main effect", "a dry snare"],
  },
};
for (const g of GENRES) if (PLANS[g.id]) g.plan = PLANS[g.id];

// One decision, one stream: a hash of (seed, genre, which), so adding a
// decision later does not reshuffle the others (chanceGen.js's bargain).
function rnd(seed, id, key) {
  let h = (2166136261 ^ (Number(seed) >>> 0)) >>> 0;
  const s = id + "|" + key;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** `dm:sub/house sub` -> { engine, preset }. @param {string} spec */
export function parseVoice(spec) {
  const i = spec.indexOf("/");
  return i < 0 ? { engine: spec } : { engine: spec.slice(0, i), preset: spec.slice(i + 1) };
}

/** A form string as `[{ name, bars }]`. @param {string} form */
export function parseForm(form) {
  return form.split("|").map((part) => {
    const m = /^(.*\S)\s+(\d+)$/.exec(part.trim());
    return { name: m ? m[1] : part.trim(), bars: m ? Number(m[2]) : 0 };
  });
}

/**
 * One build's decisions, drawn from the seed: the same genre and seed give
 * the same roll, a different seed a different song.
 * @param {Genre} g
 * @param {number} [seed]
 */
export function rollGenre(g, seed = 0) {
  const r = (key) => rnd(seed, g.id, key);
  const pick = (key, list) => list[Math.floor(r(key) * list.length)];
  const some = (key, list, n) => list.map((v) => ({ v, k: r(key + ":" + v) })).sort((a, b) => a.k - b.k).slice(0, n).map((x) => x.v);
  const fam = FAMILY_PLANS[g.family] || { forms: [] };
  const plan = g.plan;
  const forms = plan?.forms || fam.forms;
  const [lo, hi] = g.bpm;
  /** @type {any} */
  const roll = {
    bpm: lo + Math.floor(r("bpm") * (hi - lo + 1)),
    root: pick("root", ROOTS),
    form: forms.length ? pick("form", forms) : "",
    angle: pick("angle", plan?.angles || fam.angles || ANGLES),
    lift: pick("lift", LIFTS),
    layered: !!(plan?.layered ?? fam.layered) && r("layered") < 0.5,
  };
  if (!plan) return roll;
  const harmony = pick("harmony", plan.harmony);
  const cut = harmony.indexOf(": ");
  roll.scale = pick("scale", harmony.slice(0, cut).split("/"));
  roll.harmony = harmony.slice(cut + 2);
  if (plan.swing) roll.swing = Math.round((plan.swing[0] + r("swing") * (plan.swing[1] - plan.swing[0])) * 100) / 100;
  roll.kit = pick("kit", plan.kits);
  roll.drums = pick("drums", plan.drums);
  const voice = (role, pool) => ({ role, ...parseVoice(pick("voice:" + role, pool)) });
  roll.voices = Object.entries(plan.core).map(([role, pool]) => voice(role, pool));
  if (plan.bass) roll.voices[0].how = pick("bass", plan.bass);
  const opt = Object.keys(plan.optional || {});
  const [emin, emax] = plan.extras || [1, 2];
  const n = Math.min(opt.length, emin + Math.floor(r("extras") * (emax - emin + 1)));
  roll.voices.push(...some("extra", opt, n).map((role) => voice(role, plan.optional[role])));
  roll.left = opt.filter((role) => !roll.voices.some((v) => v.role === role));
  roll.moves = some("move", plan.moves, 2);
  roll.avoid = plan.avoid;
  return roll;
}

/** A roll in a line, for the picker: `128 bpm · F# dorian · intro 8 | ...`. */
export function rollSummary(roll) {
  return [`${roll.bpm} bpm`, roll.scale ? `${roll.root} ${roll.scale}` : `root ${roll.root}`,
    ...(roll.voices ? [roll.voices.map((v) => v.role).join(", ")] : []), roll.form].filter(Boolean).join(" · ");
}

/**
 * The message a genre's build button sends. It asks for a whole song from
 * scratch, replacing what is open; the turn still lands in the review bar, so
 * nothing is replaced until it is kept. The seed draws this build's choices
 * (rollGenre); what is typed in the box wins over them.
 * @param {Genre} g
 * @param {string} [extra] anything typed in the box, as further wishes
 * @param {number} [seed]
 */
export function genrePrompt(g, extra = "", seed = 0) {
  const more = String(extra || "").trim();
  const roll = rollGenre(g, seed);
  const lines = [
    `Build a complete ${g.name} song from scratch, replacing the tracks that are here.`,
    `The genre: ${g.brief}.`,
    "Decided for this build, so that it is not the same song as the last one. Follow them:",
  ];
  const add = (s) => lines.push("- " + s);
  if (roll.scale) add(`${roll.bpm} bpm${roll.swing ? `, swing ${roll.swing}` : ""}, in ${roll.root} ${roll.scale}.`);
  else add(`${roll.bpm} bpm, rooted on ${roll.root} (the scale is the genre's).`);
  add(`Angle: ${roll.angle}.`);
  if (roll.drums) {
    add(`Drums: ${KITS[roll.kit]}. Start the main section from this bar, one track per line, and vary it by section: ${
      Object.entries(roll.drums).map(([k, v]) => `${k} \`${v}\``).join(", ")}.`);
  }
  for (const v of roll.voices || []) {
    add(`${v.role}: ${v.engine}${v.preset ? `, preset "${v.preset}"` : ""}.${v.how ? ` ${v.how[0].toUpperCase()}${v.how.slice(1)}.` : ""}`);
  }
  if (roll.voices) add(`No other melodic parts${roll.left.length ? ` (no ${roll.left.join(", no ")})` : ""}; a riser or an fx bus is fine.`);
  if (roll.harmony) add(`Harmony, in that scale: ${roll.harmony}.`);
  if (roll.moves) add(`Make these two moves audible: ${roll.moves.join("; ")}.`);
  if (roll.avoid) add(`Avoid: ${roll.avoid.join("; ")}.`);
  if (roll.form) {
    add(roll.voices
      ? `Form, bars per section: ${roll.form}.`
      : `Form to start from, bars per section: ${roll.form}. Bend it where the genre has a form of its own.`);
  }
  add(roll.layered
    ? "Lay it out in arrange mode: each layer on its own timeline, entering and leaving at different bars across that plan."
    : "Lay it out in chain mode, one slot per section.");
  add(`The second time the main section comes round it adds ${roll.lift}.`);
  if (more) lines.push(`Also, and this wins over anything above: ${more}`);
  return lines.join("\n");
}
