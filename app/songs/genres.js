// The compose panel's genre picker: search or browse a genre, press build,
// and the compose turn writes a whole song in it. Each entry is a short brief
// in the guide's own terms (tempo, which engines, what makes the genre
// itself), so the model starts from the idiom rather than from the word.
//
// No imports: pure, so test/genres.test.js pins the table, the search and
// the prompt.

/** @typedef {{ id: string, name: string, family: string, bpm: [number, number], tags?: string[], brief: string }} Genre */

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

/**
 * The message a genre's build button sends. It asks for a whole song from
 * scratch, replacing what is open; the turn still lands in the review bar, so
 * nothing is replaced until it is kept.
 * @param {Genre} g
 * @param {string} [extra] anything typed in the box, as further wishes
 */
export function genrePrompt(g, extra = "") {
  const more = String(extra || "").trim();
  return [
    `Build a complete ${g.name} song from scratch, replacing the tracks that are here.`,
    `Tempo ${g.bpm[0]}-${g.bpm[1]} bpm. The genre: ${g.brief}.`,
    "Lay it out in sections in chain mode, with an intro, the main sections and an outro, using the form the guide gives for this kind of track.",
    ...(more ? [`Also: ${more}`] : []),
  ].join("\n");
}
