// The compose panel's genre picker: search or browse a genre, press build,
// and the compose turn writes a whole song in it. Each entry is a short brief
// in the guide's own terms (tempo, which engines, what makes the genre
// itself), so the model starts from the idiom rather than from the word.
//
// No imports: pure, so test/genres.test.js pins the table, the search and
// the prompt.

import { MORE_PLANS } from "./genrePlansMore.js";

/** @typedef {{ id: string, name: string, family: string, bpm: [number, number], tags?: string[], brief: string, plan?: GenrePlan }} Genre */

/**
 * What a rewritten genre knows beyond its brief: pools the dice draw one
 * build from (rollGenre). An engine is `key` or `key/preset`; a step string
 * anywhere in prose is in backticks. `bass` is how the FIRST core role plays.
 * A move that needs an optional part starts `[role] `, and is only drawn in
 * a build that has that part.
 * A harmony entry is `scale/scale: progression`: the scale comes with the
 * chords, because notes snap to it and a progression only fits its own. test/genres.test.js holds every engine,
 * preset, scale, kit and step string to the engine's own tables.
 * @typedef {{
 *   swing?: [number, number], kits?: string[],
 *   drums?: Record<string, string>[],
 *   core: Record<string, string[]>, optional?: Record<string, string[]>, extras?: [number, number],
 *   bass?: string[], harmony: string[], moves: string[], avoid: string[],
 *   forms?: string[], angles?: string[], layered?: boolean,
 *   eighths?: boolean, meter?: string, steps?: number,
 * }} GenrePlan
 *
 * `eighths`: the song is written a step to an EIGHTH note (every track at
 * speed 0.5), so master swing, which delays a track's odd steps, lands on the
 * offbeat eighths: the only way jazz, blues and a shuffle swing. `meter` is
 * the song's when it is not 4/4, and `steps` how long the plan's step strings
 * are when that is not 16.
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
  G("house", "house", "house", 120, 126, "warm, communal, hands up at four in the morning; the kick on every beat with the bass pushed off it, claps on 2 and 4 nudged a hair late, swung hats with ghost notes `x.oxx.oxx.oxx.ox`, an open hat on the offbeats; dm:sub/house sub or dm:bass/modern di under dm:tines or dm:hexop/organ stabs that never land on the beat, chorus and a reverb bus, the chords pumping from the kick; stabs held their real length, phrases that rest; for lift, drop the kick for one bar and let a dm:vox/soul lead phrase sing alone; never equal-velocity hats, never dry square-wave stabs"),
  G("deep-house", "deep house", "house", 118, 124, "late-night, intimate, a low-lit basement; a soft round kick, claps and rims instead of snares, lazily swung hats with ghost notes at o and a few nudged late, the bass gliding long between the kicks; dm:tines or dm:oracle/warm pad in minor ninths and elevenths held full length, dm:sub/house sub, dm:halo/shaker with hlovary up, vinyl or cassette for warmth, chorus, a slow LFO through the fat filter; the signature is breathing harmony that never shouts; for a great one, answer each chord with one dm:hexop/bell note into a dotted delay on a bus; never a bright bare lead, never rigid unswung percussion"),
  G("tech-house", "tech house", "house", 124, 128, "tight, cheeky, a dancefloor that grins; a punchy dm:siege/909 kick, a rubbery syncopated bassline that is the whole song `..x.x..X..x.x..o`, accents and ghost notes in it, shuffled hats with velocity rolling up and down, a rim that skips slightly late; dm:sub/house sub or dm:bass/slap funk through the squelch filter, a one-note dm:oracle/dirty stab, a dm:vox/whisper chop, a short room reverb on a bus; groove from subtraction, bass and percussion talking; for lift, a cutoff lane that pecks open one step a bar then the whole bar at the drop; never machine-gun hats, never blippy dry oscillator bass"),
  G("acid", "acid house", "house", 122, 130, "hypnotic, sweaty, the warehouse strobe; the 909 or a dm:siege kick on every beat, offbeat open hats with varied velocity, a clap on 2 and 4, and over it a dm:silverbox line where accents bark and slides bend `x.xXx_x.X.o.x_xX`; sbaccent high, a touch of fuzz or cassette saturation, delay on a bus with feedback creeping up; the signature is the cutoff and resonance played by hand, a different lane shape every section, muttering in the intro, screaming at the peak; for a great one, a second silverbox on another track length phasing against the first; never a static filter, never a line with no accents or rests", ["303", "acid"]),
  G("chicago", "chicago house", "house", 118, 126, "raw, jacking, a dusty basement party with a borrowed drum machine; 808 and 909 voices, the kick on every beat, a jacking clap and hat pattern with accents that push and pull and swing on, dm:808-cowbell answering on the offbeats; a two-note dm:bass/modern di or dm:sub/house sub riff, dm:tines stabs held their length, a repeated dm:vox/soul lead hook, tape grit from cassette on the drum bus; little reverb, everything a bit too loud and alive; for a great one, mute and unmute whole tracks on the bar like a live mixdown; never polished, never stiff equal hits"),
  G("garage-house", "garage house", "house", 118, 124, "uplifting, churchy, Sunday morning after Saturday night; a swung four on the floor, shuffled hats with ghost notes, claps doubled by a dm:halo/shaker with hlovary up, the bass walking between chord tones; gospel voicings on dm:hexop/organ and dm:tines with passing chords held full length, dm:bass/motown underneath, a dm:vox/hallelujah choir answering a dm:vox/soul lead, reverb on a bus; call and response over rich major sevenths and ninths; for a great one, a breakdown with the organ alone walking up into the return; never minor and moody, never a rigid unswung grid"),
  G("progressive-house", "progressive house", "house", 122, 128, "patient, cinematic, a sunrise set on a big system; a steady four on the floor, percussion entering one layer at a time with varied velocity and a little swing, the bass rolling between kicks; dm:oracle/pulse keys and dm:hexop/bell arpeggios with velocity contour, dm:oracle/strings swelling held long, dm:sub/house sub, long reverb and dotted delay on buses, the velvet filter opening over sixteen bars; evolution, the breakdown revealing the melody hidden in the arp; for a great one, a 3-step arp figure rotating against the bar; never sudden changes, never a dry bare pulse-wave arp"),
  G("afro-house", "afro house", "house", 118, 124, "spiritual, rolling, a ceremony under open sky; a deep four on the floor under interlocking euclid rings on toms, rims and dm:halo/shaker, a conga-like dm:lancet/wood modal with lncrlevel up so no two hits match, ghost notes and small nudges everywhere; a warm dm:sub/house sub that answers the kick, sparse chords on dm:hexop/marimba or inst:guitar-nylon ringing their full length, a dm:vox/monk chant or choir aah hook, reverb on a bus; the percussion is the melody; for a great one, add one ring at a time and rotate one each section; never straight 909 hats, never equal-velocity percussion"),
  G("french-house", "french house", "house", 120, 126, "glamorous, filtered, a disco record behind a closing door; four on the floor with a swung hat and ghost notes, a funky octave-jumping dm:bass/slap funk line, dm:guitar/funk clean chops and dm:tines chords with phaser, the whole loop pumping hard from a kick sidechain, vinyl in the rack; the master move is the filter: chords and bass through the fat filter on a long cutoff lane, muffled thump to full sparkle; for a great one, a dm:vox/robot choir hook through chorus and slapback delay, phrased like a talk box; never dry unpumped chords, never clean modern oscillators"),
  G("lofi-house", "lo-fi house", "house", 116, 124, "hazy, nostalgic, a VHS tape of a club you never went to; a soft swung four on the floor, crushed hats with ghost notes, claps nudged late, rims at o; detuned dm:oracle/warm pad or dm:tines chords with orcslop high held their length, a wobbly dm:sub/house sub, cassette and vinyl on everything, crush on the drums; warmth through damage, the top rolled off with the velvet filter; for a great one, a dm:vox/la la chop drifting in pitch on a slow LFO like stretching tape; never crisp, never bright rigid hi-hats in front"),
  G("minimal", "minimal", "house", 122, 128, "microscopic, clicky, a long set where small things are huge; a dry kick, a rim on 2 and 4, tiny percussive hits nudged off the grid with varied velocity, a two-note dm:sub/house sub or dm:bass/modern di motif with lots of silence; dm:lancet/tin head, dm:halo/fm hat with hlovary up and plaits:10 particle as texture, short delay throws on a bus, a little vinyl; restraint, one parameter change every eight bars feels like an event; for a great one, a slow LFO on one percussion decay so it grows from a click into a ring; never moving chords, never identical repeated blips", ["microhouse", "minimal techno"]),

  // techno
  G("techno", "techno", "techno", 126, 134, "hypnotic, dark, relentless, a concrete room with the lights off; a dm:siege/techno kick on every beat, a rolling bass in the gaps `.xox.xox.xox.xoX` ducked by it, off-beat open hats and a ride with accents and a little hlovary, nothing perfectly equal; dm:sub/reese or dm:ladder/pedal bass through the edge filter, a dm:oracle/dirty stab on a euclid ring, reverb on a bus with one hit thrown into it, tape saturation on the drums; the loop never changes but filters, feedback and layers always do; for a great one, a 12-step percussion line against 16 meeting at the peak; never chord progressions, never machine-gun hats"),
  G("detroit", "detroit techno", "techno", 124, 132, "futuristic and soulful, machines dreaming of strings; a 909 groove with a skipping swung hat, ghost snares, a clap on 2 and 4, a syncopated dm:bass/modern di walking between chord roots; lush dm:oracle/strings or dm:oracle/warm pad chords in minor sevenths and ninths held long, a melodic dm:hexop/bell lead with phrases that rest, chorus on the chords, delay and reverb on buses; the chords are the song and they move; for a great one, let lead and strings swap roles in the second half; never cold and atonal, never a dry bare square lead"),
  G("berlin", "berlin techno", "techno", 130, 138, "monolithic, relentless, a cavernous club at hour eight; a huge dm:siege/rumble kick on every beat with a reverbed tail that becomes the bass, off-beat hats varying in velocity, a dry ride with accents, a clap buried in reverb; almost no melody, just a dm:drone/machine hum and dm:halo/trash hits with hlovary up, a big reverb bus; the rumble, reverb tail ducked by the kick, makes the low end one breathing mass; for a great one, automate the reverb send so the room grows and shrinks across sections; never a hook, never sterile identical hits", ["warehouse"]),
  G("dub-techno", "dub techno", "techno", 118, 126, "foggy, endless, an echo chamber at dawn; a soft kick, a gentle off-beat hat with varied velocity, a rim far back nudged late, and one minor chord stab `...x.......o..x.` drenched in delay and reverb on a bus, its echoes doing the rhythm; dm:oracle/glass or dm:tines through the fat filter, dm:sub/dub underneath, cassette hiss and vinyl in the rack; the stab dissolving into its own feedback, cutoff and feedback lanes moving slowly; for a great one, a slow LFO on the delay time so the echoes drift like old tape; never more than one chord, never a dry mix"),
  G("uk-techno", "uk techno", "techno", 130, 140, "bass-heavy, broken and ravey, a warehouse off the M25 at 4am; a broken techno beat, the kick on 1 and syncopated after it instead of on every beat, a clap or snare on 2 and 4, swung shuffled hats with ghosts and a little garage swing, a chopped break layered under on the breaks kit; a big dm:sub/reese or dm:sub/pure sine phrased in short calls that leave the kick room, sidechained from it; rave stabs and hoover pads on dm:oracle/dirty stab and dm:contagion with a filter lane, a chopped pitched dm:vox phrase, tape saturation on the drum bus and reverb on a bus; the signature is sub pressure and a rolling break under a euphoric rave pad; the lift is the pad opening on a cutoff lane over a bar with the kick out, then the break and the sub slamming back; never a plain four on the floor all the way through, never thin bass, never straight unswung hats", ["uk bass", "bass techno", "breakbeat techno", "broken techno"]),
  G("hard-techno", "hard techno", "techno", 145, 155, "brutal, euphoric, a rave at full tilt; a distorted dm:siege/hard trance kick with clip drive and the low cut on, a rumble tail between kicks, fast off-beat hats with accents rolling through them, a clap on 2 and 4; a dm:silverbox acid line or dm:oracle/dirty stab on top, the scream filter, fuzz and a reverb bus so it sits in a room; the kick is the instrument, its drive, decay and pitch changing by section; for a great one, a half-bar of only the stab and a dm:halo/reverse swell before the kick returns harder; never a long pad breakdown, never flat equal-velocity hats"),
  G("industrial-techno", "industrial techno", "techno", 128, 140, "menacing, mechanical, a factory floor at night; a pounding kick with fold drive, crushed percussion, dm:lancet/metal fm and dm:halo/trash hits with their randomizers up so each strike differs, placed like machinery `..x..X...o..x..x`, a dm:drone/dark grone bed; crush, fuzz and ring mod, a short room reverb on a bus, the growl filter on the bass; noise as rhythm, every texture locked to the grid like a stamping press but never identical; for a great one, a repeat stage slice that stutters only at the peak; never a melodic lead, never clean dry oscillators"),
  G("birmingham-techno", "birmingham techno", "techno", 132, 142, "raw, loopy, functional, a dark Midlands warehouse with one strobe; a dry dm:siege/techno kick on every beat, a percussion loop of rims, toms and dm:lancet/tin head hits that repeats one bar with tiny velocity changes, a clap or snare only every other bar; a one-note dm:sub/growl or dm:snarl stab locked to a syncopated grid, almost no reverb, fuzz and tape saturation on the drum bus; the groove is the loop, built for mixing, and it shifts by one hit at a time; for a great one, a 3 or 5 step tom loop against the bar that keeps rotating the accent; never a breakdown, never a wet roomy mix", ["regis", "brum techno", "loop techno"]),
  G("dark-techno", "dark techno", "techno", 124, 134, "slow, heavy, ominous, a bunker with the fog machine stuck on; a deep dm:siege/rumble kick with a filtered reverb tail ducked by itself, sparse off-beat hats with hlovary up, a clap buried in a long dark reverb; a dm:drone/subterranean or dm:drone/dark grone bed under a two-note phrygian dm:sub/reese motif, a dm:vox/monk chant or whisper fragment thrown into delay; space and dread do the work, the filter on the bed opening over thirty-two bars; for a great one, a reverse swell into every eighth bar; never bright hats in front, never major chords", ["dungeon techno", "hypnotic dark techno"]),
  G("rhythmic-noise", "rhythmic noise", "techno", 140, 160, "harsh, physical, a power station shaking itself apart; a kick distorted with clip drive until it is mostly noise, crushed and ring-modulated percussion, dm:halo/trash and dm:lancet/metal fm hits with every randomizer up, plaits:9 noise stamped on the grid like a press; no melody, the pitch of the noise is the hook, a short room reverb only on the snare; fuzz, crush and a repeat stage slicing the loop at the peak; for a great one, a section where the kick drops to half time and the noise keeps its pace; never clean sounds, never a tonal lead", ["power noise"]),
  G("industrial-hardcore", "industrial hardcore", "techno", 160, 190, "fast, cold, crushing, a hardcore night that never warms up; a dm:siege/gabber kick in fold mode with the low cut on, darker and less euphoric than gabber, its tail tuned to one low note, fast off-beat dm:halo/trash hats, a clipped dm:lancet/metal fm snare on 2 and 4; dm:drone/screamer or dm:snarl stabs through the scream filter, machine noise from dm:drone/machine hum, a dm:vox/robot choir fragment; atonal, grinding, the kick changing drive by section; for a great one, a two-bar kick roll by ratchet into a drop where everything returns crushed harder; never a happy melody, never a long pad breakdown", ["industrial hardcore techno"]),
  G("new-beat", "new beat", "techno", 100, 115, "slow, sleazy, menacing, a Belgian club in 1988 with the record played too slow; a heavy straight kick, a big gated snare on 2 and 4, eighth-note hats, a sequenced dm:ladder/model d bass marching in sixteenths with accents; cold dm:oracle/dirty stab or dm:hexop/brass stabs, a spoken dm:vox/basso or whisper line thrown into a delay, a short dark room; the slowness is the point, every hit heavy, the bass pumping under it; for a great one, an EBM bass pitched down a fifth for the last section; never swing, never a fast tempo", ["belgian new beat"]),
  G("ritual-techno", "ritual techno", "techno", 124, 134, "tribal, occult, a ceremony in a concrete hall; a deep kick under interlocking tom and floor-drum rings, dm:lancet/wood modal and dm:halo/gong hits with their randomizers up so each strike differs, ghost notes everywhere; a dm:drone/cathedral bed on one note, a dm:vox/monk chant or choir aah on two notes, a long dark reverb on a bus; the percussion is the voice, growing one ring at a time, the chant rising under it; for a great one, rotate one tom ring each section so the accents walk; never bright hats, never chord changes", ["tribal industrial", "occult techno"]),
  G("noise-techno", "noise techno", "techno", 124, 134, "blown out, ecstatic, a basement PA pushed past its limits; a four on the floor dm:siege/techno kick in clip mode with fuzz, everything in the red so the mix pumps against the glue on the master, a ragged off-beat hat with hlovary up; a squelching dm:silverbox or dm:contagion line run through fuzz and crush until it tears, a dm:drone/screamer or bit swarm feedback squall riding on top, cassette and tape hiss on everything, the master drive up; the techno is underneath and the noise is the song, sections collapsing into a wall of distortion and the kick punching back through; for a great one, a bright arp buried deep in the noise that surfaces once, near the end; never a clean polished mix, never a drop that resets to silence", ["pete swanson", "blown-out techno", "outsider techno", "distorted techno"]),
  G("melodic-techno", "melodic techno", "techno", 120, 126, "epic, bittersweet, a festival main stage at night; a driving four on the floor, a rolling dm:sub/reese sidechained to the kick, percussion that grows with varied velocity and slight swing; a long dm:oracle/pulse keys arp with a velocity contour, big dm:oracle/strings swells held full length, reverb and dotted delay on buses, chorus for width; a minor melody unfolding over long filter builds and resolving in the drop; for a great one, a 7 or 11 step arp loop reshaping itself as the filter opens; never happy major cheese, never a dry bare pulse arp"),
  G("electro", "electro", "techno", 120, 132, "robotic, funky, a breakdancer under a streetlight; a syncopated 808 beat with the kick off the grid `x......x..x....x`, claps on 2 and 4, closed hats with accents and ghosts, tom fills; a rubbery dm:bass/slap funk or dm:ladder/percussive bass with notes held to their length, dm:oracle/dirty stab hits, a dm:vox/robot choir line as the vocoder, phaser, a short room on a bus, a little cassette; machine-cold minor stabs over a human-swung 808; for a great one, the vox and bass trading half-bars; never four on the floor, never dry square-wave bleeps"),
  G("ebm", "ebm", "techno", 115, 130, "cold, physical, stomping, a black-clad body music club; a straight kick, a harsh snare on 2 and 4 with a ghost before it, a sequenced eighth-note bass `x.X.x.o.x.X.x.o.` with accents marching through it; dm:ladder/model d bass with the edge filter and the oscillators overdriving, dm:lancet/metal fm percussion, a shouted dm:vox/basso hook, tape saturation and a short room reverb; the bass sequence is the engine, its cutoff lane making it march; for a great one, transpose the sequence up a semitone for the last section; never swing, never dry flat-velocity bleeps", ["body music"]),

  // trance & hard
  G("trance", "trance", "trance", 134, 140, "euphoric and wide open, sunrise at an outdoor festival; a straight four on the floor, an offbeat open hat, the bass in the gaps between kicks; hats with accents and softer o hits; dm:contagion supersaw chords with unison up, a velvet filter and chorus, sidechained from the kick; the lead held for its full length through a ping pong delay and a big reverb on a bus; the signature is the breakdown, the kick gone and the melody alone on a soft pad; the lift is a counter-melody hidden in the break that leads the last drop; never dry, blippy leads, never a bare square lead"),
  G("psytrance", "psytrance", "trance", 138, 146, "hypnotic and tight, a forest party at four in the morning; a short punchy kick on every beat and a rolling bass in the three sixteenths after it, the gallop so locked it reads as one instrument, its velocities rising across the bar; dm:silverbox and dm:sub/acid with fast filter envelopes and the squelch character, dm:hexop fm zaps panned and thrown into a delay bus, phaser on the fx; the signature is a bass envelope that never stops mutating under lanes; the lift is a lead whose cutoff lane changes shape every eight bars; never chords, never equal-velocity machine-gun hats"),
  G("goa", "goa trance", "trance", 135, 145, "colourful, mystical and warm, the older brighter cousin of psytrance; a driving four on the floor with a rolling offbeat bass and a looser feel, small nudges on the percussion; two dm:silverbox acid lines interlocking in call and response, each with its own accents and slides, dm:oracle/strings swelling underneath, phaser and flanger on what moves, a cassette stage for warmth; eastern colour from phrygian dominant or double harmonic; the signature is the interlocking acid conversation; the lift is the melody moving up a step for the final section while the bass holds; never a lone acid line, never dry unprocessed oscillators"),
  G("hardstyle", "hardstyle", "trance", 148, 155, "heroic, festival-sized and sincere; the kick is the instrument, a pitched dm:siege with clip drive and a long pitch envelope playing the chord root each beat, the bass tail on the offbeat; between drops dm:contagion supersaw chords with chorus, a lead on dm:ladder/vibrato lead held long with vibrato, dm:vox/choir aah pads, a huge reverb on a bus; the signature is the kick following the chords so the low end has a melody; the lift is an orchestral intro theme on dm:oracle/strings that returns as the kick melody; never an undistorted kick, never a bare square lead"),
  G("gabber", "gabber", "trance", 160, 190, "brutal and euphoric, a Rotterdam warehouse; a dm:siege/gabber kick on every quarter, driven until it is a tone, its pitch carrying the riff, a fast offbeat hat with accents and ghosts, nothing else in the low end; a crunchy dm:oracle/dirty stab through fuzz, shouted dm:vox fragments thrown into a delay; the signature is the kick tuned to the notes of the stab; the lift is a half-speed breakdown with a melancholy pad held long before the kick crashes back; never a clean kick, never dry blippy stabs", ["hardcore"]),
  G("happy-hardcore", "happy hardcore", "trance", 165, 180, "sugar-rush joy, glowsticks and big smiles; a fast four on the floor with a bouncy offbeat bass, a clap on 2 and 4, and a breakbeat fill with ratchets and rising velocity into each drop; piano stabs on dm:tines with a real sustain, a cheerful major lead on dm:contagion supersaw with chorus, a high dm:vox/la la hook; reverb on a bus for space; the signature is the major piano riff answered by the vox; the lift is a breakdown where the piano plays the hook slowly, almost a ballad; never minor and moody, never a bare square lead"),
  G("eurodance", "eurodance", "trance", 130, 142, "shiny 90s radio euphoria, strangers singing along; four on the floor, an offbeat bass and an open hat between kicks, hats with accents rather than equal hits; dm:tines piano stabs and dm:hexop/brass hits, a hooky major riff on dm:contagion with unison and chorus, a big dm:vox/soul lead chorus held for full phrases with breaths between; the signature is the riff-led chorus arriving before the vocal does; the lift is a key change up a step into the final chorus; never a song without a hummable riff, never dry unprocessed oscillators"),
  G("hands-up", "hands up", "trance", 138, 145, "bouncing euphoria, a German rave ballroom with raised arms; a pumping kick, supersaw chords sidechained so hard they breathe, an offbeat bass that bounces octaves; dm:contagion supersaws through chorus and reverb on a bus, a sing-along lead doubled an octave up on dm:hexop/bell, a plaits:9 noise riser and a snare roll whose velocity climbs into ratchets; the signature is the lead riff as the chorus; the lift is a fake drop that falls back to the break for two bars before the real one; never subtle, never equal-velocity machine-gun hats"),

  // bass music
  G("dubstep", "dubstep", "bass", 138, 142, "heavy, dark and spacious, a Bristol basement with the sub in your chest; half time, kick on 1, snare on 3 like a gunshot with a long reverb tail, sparse hats with ghost notes; a clean dm:sub/pure sine underneath and a mid bass on dm:contagion or dm:sub/growl wobbling through a synced cutoff LFO and the growl filter; delay throws on the snare; the signature is the wobble rate changing with the phrase; the lift is a reverbed dm:hexop/bell motif from the intro returning over the second drop; never four on the floor, never dry unprocessed oscillators"),
  G("brostep", "brostep", "bass", 140, 150, "aggressive and theatrical, a main stage mid-headbang; half time with a huge reverbed snare on 3 and the bass edited between every beat; screeching dm:contagion and dm:snarl basses with fold drive, per-step cutoff and shape lanes, fuzz and crush, the scream filter, all glued on a bus with saturation; the signature is call and response between two bass tracks changing voice every half beat; the lift is a gentle break with a dm:tines piano theme the second drop quotes in the bass; never a static wobble, never dry blippy bass edits"),
  G("riddim", "riddim", "bass", 140, 150, "minimal and brutal in its restraint; half time with a tight kick, snare on 3 and lots of air, the hats with ghost notes; one repeating dm:sub/growl or dm:contagion phrase of three notes, the LFO rate shifting a little each pass, a clean sub doubling it, saturation on a bus; the signature is the stutter of the wobble and the silence between hits; the lift is one bass hit nudged an eighth late on the fourth bar of each phrase so the loop trips; never melody on top, never equal-velocity machine-gun hats"),
  G("future-bass", "future bass", "bass", 140, 160, "bright, emotional and shimmering, a sunset festival with confetti; half-time drums with a clap on 3 and rolling hats whose triplet ratchets swell in velocity; massive detuned chords on dm:contagion or dm:oracle/warm pad with chorus, swelling and ducking under heavy sidechain, pitched vox chops on dm:vox through delay, a dm:sub/808 underneath; the signature is the chopped chord drop where the chords are the lead; the lift is a cutoff LFO on the chords set off the grid so the swell breathes against the beat; never a thin chord, never dry unprocessed oscillators"),
  G("garage", "uk garage", "bass", 130, 136, "swung, slick and soulful, a London club on a Sunday; a skippy 2-step shuffle with heavy swing, the kick off the beat, ghost snares and rims at low velocity, hats nudged late; dm:hexop/organ and dm:tines stabs on the offbeat, a bouncing dm:sub/house sub answering the kick, chopped pitched-up dm:vox phrases, a short reverb on a bus; the signature is swung sixteenths that make everything bounce sideways; the lift is a chord stab rhythm whose accent moves each bar; never straight unswung hats, never a heavy four on the floor", ["ukg"]),
  G("2-step", "2-step", "bass", 130, 136, "smooth and silky, Saturday night radio in a car; the kick skips 2 and 4, landing on 1 and before 3, a crisp snare on 2 and 4 with ghost rims around it, hats heavily swung and nudged; a warm dm:sub/house sub answering the kick, dm:tines or dm:hexop/organ chords chopped on the offbeats with vinyl warmth, a pitched R&B dm:vox hook; the signature is the space where the kick used to be; the lift is a bar where the drums drop out and only the sub and the vox speak; never a kick on 2 or 4, never equal-velocity machine-gun hats", ["2 step", "2step", "two step", "two-step garage", "uk garage"]),
  G("future-garage", "future garage", "bass", 128, 140, "nocturnal, rainy and wistful, the night bus home after the club; a broken 2-step with heavy swing, the kick sparse and off the beat, a soft rim or snare on 2 and 4 with low-velocity ghosts around it, shuffled hats nudged late and vinyl crackle over the kit; a deep dm:sub/pure sine or dm:sub/reese in long notes answering the kick, held dm:oracle/warm pad chords filtered dark with reverb on a bus, chopped pitched dm:vox phrases thrown into delay, a far-off dm:hexop/bell; the signature is a pitched vocal chop echoing over a 2-step skip with a huge sub and lots of space; the lift is the drums dropping out so the pad and the vox are alone, then the sub coming back first; never a four on the floor, never bright or busy, never unswung equal-velocity hats", ["post-dubstep", "post dubstep", "night bus"]),
  G("speed-garage", "speed garage", "bass", 132, 138, "dark and swaggering, a late-90s rave under a railway arch; four on the floor with garage swing on the hats, a shuffled clap and ghost rims; a big detuned dm:sub/reese with a cutoff LFO, phrased in short calls between the kicks, dub sirens from plaits:2 through a delay bus, chopped dm:vox stabs; saturation on the bass; the signature is the reese talking in the gaps; the lift is the bass dropping an octave on the last bar of every eight for weight; never polite, never unswung"),
  G("bassline", "bassline", "bass", 136, 142, "bouncy, cheeky and loud, a Sheffield club full of skankers; a four on the floor with a swung shuffle, a clap on 2 and 4 and ghosted hats; a wobbling detuned dm:sub/reese or dm:contagion bass that plays the riff and bounces octaves, dm:hexop/organ stabs, a pitched-up dm:vox hook through a short reverb; the signature is the bassline as the melody, chopped by a cutoff LFO into a stuttering riff; the lift is call and response between a wobbling bass and a plucked one; never a pad-led track, never dry blippy organ"),
  G("grime", "grime", "bass", 138, 142, "cold, raw and urban, a pirate radio studio on an estate; a sparse half-time feel, a punchy kick, a cracking snare, ghost notes on the hats, gaps left for an MC; stark minor melodies on dm:drift or dm:hexop/bell with tape saturation from cassette, eski clicks from plaits:12, dm:sub/808 hits placed like punches; the signature is a crude cold melody with silence around it; the lift is a bar where everything stops except one eski click; never warm, never a bare square lead without saturation"),
  G("uk-funky", "uk funky", "bass", 128, 132, "tribal, sweaty and joyful, carnival in a club; four on the floor with syncopated percussion across toms and rims as euclid rhythms, every hit at a different velocity and a little swing; a deep rolling dm:sub/house sub, soulful dm:tines chords with long sustain, an R&B dm:vox hook, a room reverb on a bus; the signature is three euclid percussion tracks of different lengths locking into one groove; the lift is a break where only the toms play and the chords return on the offbeat; never a plain hat line, never equal-velocity machine-gun hats"),
  G("halftime", "halftime", "bass", 160, 175, "dark, heavy and slow-motion, drum and bass tempo felt as a crawl; kick on 1, snare on 3, rolling ghost hats and shuffled percussion between, velocities rising and falling; a deep dm:sub/pure sine and a menacing dm:contagion mid bass through the growl filter and saturation, a dm:drone/subterranean bed, a big reverb on the snare; the signature is double-time hat rolls racing over the half-time beat; the lift is one bar of full double time before it falls back; never a four on the floor, never dry unprocessed oscillators"),
  G("wave", "wave", "bass", 130, 150, "melancholy and ethereal, a foggy night drive; half-time trap drums with a hard clap on 3 and hats with accents and ghosted rolls, a distorted dm:sub/808 underneath; enormous reverbed chords on dm:contagion and dm:oracle/warm pad, a mournful dm:hexop/bell lead held long, dm:vox/angel ooh chops through a long delay; the signature is the 808 and the shimmering chords with nothing in between; the lift is a dm:halo/reverse swell before each drop; never bright and happy, never dry blippy leads"),

  // breaks & dnb
  G("dnb", "drum & bass", "breaks", 170, 176, "fast, rolling and electric, a dark rave at full speed; a two-step break, kick on 1 and the and of 2, snare on 2 and 4, busy ghost notes on hats and snare at low velocity, the hats nudged; a deep dm:sub/pure sine or a growling dm:sub/reese under cutoff lanes, dm:oracle/warm pad atmospheres in the intro, reverb on a bus; the signature is ghost notes that keep the beat from touching the ground; the lift is a switch-up second drop with a new bass and a broken beat; never a four on the floor, never equal-velocity machine-gun hats", ["dnb", "drum and bass"]),
  G("liquid", "liquid dnb", "breaks", 170, 176, "smooth, soulful and uplifting, a summer evening at a beach festival; a crisp two-step with ghost-noted shuffled hats and a soft snare, small nudges keeping it human; lush jazzy dm:tines chords held full length, dm:oracle/strings, a warm rolling sub, a dm:vox/soul lead with breaths between phrases, vinyl warmth and a reverb bus; the signature is running and floating at once, fast drums under slow chords; the lift is an inst:bass-electric line walking while the sub holds; never aggressive basses, never a dry mix", ["liquid funk"]),
  G("neurofunk", "neurofunk", "breaks", 172, 178, "dark, technical and futuristic, a lab with a sound system; a tight punchy two-step with precise ghost notes and accents, no swing; gnarly reese basses on dm:contagion and dm:sub/reese with lanes on cutoff, shape and fold drive, saturation glueing them on a bus, crush and repeat for edits; the signature is a bass rewritten every beat; the lift is a dm:vox/robot choir phrase used as a percussive hit; never a sloppy beat, never dry unprocessed oscillators"),
  G("jungle", "jungle", "breaks", 160, 172, "raw, rolling and soulful, a 90s rave in a tower block; chopped sampler breaks with ratchets, ghost snares and the snare rearranged every bar, swing and nudges keeping the human shuffle; a huge slow dm:sub/dub bass under the frantic drums, reggae stabs on dm:hexop/organ, dub delay throws on the snare, vinyl on the break; the signature is fast drums over a slow bass; the lift is a break stuttered by the repeat stage before the drop; never a static loop, never a busy bass"),
  G("jump-up", "jump up", "breaks", 172, 176, "bouncy, cartoonish and rowdy, a crowd jumping in unison; a punchy two-step with a big snare and ghosted hats; a cartoonish dm:sub/growl or dm:snarl riff dancing between two or three notes under a cutoff lane, held for its real length, saturation on it, a sub underneath; the signature is a bass riff you can sing; the lift is the riff answered by a squelchier dm:silverbox in the second drop; never subtle, never equal-velocity machine-gun hats"),
  G("breakbeat", "breakbeat", "breaks", 125, 140, "funky, bouncy and big, a late-90s rave tent; syncopated breaks with ghost snares, the kick wandering off the grid, a swung shuffle and nudged hats; a fat dm:sub/reese or dm:ladder/model d bass locking into the kick, rave stabs on dm:oracle/dirty stab, acid from dm:silverbox, saturation on the drum bus; the signature is a funky break with the bass glued to its kick; the lift is a filter lane closing the drums down in the break and opening them for the drop; never four on the floor, never a stiff break", ["nu skool breaks"]),
  G("florida-breaks", "florida breaks", "breaks", 128, 136, "sunny, bouncy and booming, a Miami pool party; a funky syncopated break with an 808 kick under it, swing, ghost notes and dm:808-cowbell and tom accents at varied velocity; a booming dm:sub/808 or rolling dm:sub/reese, rave stabs, dm:silverbox squelch, chopped plaits:7 vox through delay; the signature is the 808 boom under a funky break; the lift is a bar of cowbell melody before the drop; never dark and grimy, never a straight four", ["miami breaks", "funky breaks", "florida"]),
  G("big-beat", "big beat", "breaks", 120, 140, "loud, scrappy and party-ready, a sweaty student union; heavy sampler breakbeats driven through fuzz and crush on the drum bus, swung, with ghost snares; a fat riff on dm:guitar/fuzz lead, acid from dm:silverbox, sirens from plaits:2 through delay, chopped dm:vox shouts; the signature is a break pushed into distortion and a riff repeated until it is euphoric; the lift is a breakdown filtered to a whisper before smashing back; never polished, never dry unprocessed oscillators"),
  G("footwork", "footwork", "breaks", 155, 165, "frantic and joyous, a Chicago dance battle; syncopated 808 kicks and toms, rapid hat rolls in triplets with ratchets and rising velocity, a sparse half-time snare; chopped repeated dm:vox phrases or plaits:7 speech stuttering in triplets, a dm:sub/808 underneath; the signature is triplets against the straight grid, a vocal fragment repeated until it is rhythm; the lift is a jazzy dm:tines chord held long under the chaos, vinyl on it; never a steady groove, never one tempo feel", ["juke"]),
  G("breakcore", "breakcore", "breaks", 160, 200, "chaotic, emotional and violent, a rave in a squat; frantic chopped sampler breaks with ratchets, stutters, the repeat stage at full, distorted kicks and crushed snares; a melancholy dm:oracle/warm pad or a fragile dm:hexop/bell melody held long under the chaos, a reverb bus around it; the signature is tender melody against destroyed drums; the lift is a sudden silence and a slow music box section on plaits:12 with vinyl before the breaks return; never a steady break, never a clean dry mix"),

  // hip hop
  G("hiphop", "boom bap", "hiphop", 86, 96, "a basement in 1994; a swung beat where the kick drags late, the snare cracks on 2 and 4 with ghost notes `x......xo.x..o..`, hats at uneven velocities, the bass locked to the kick like one instrument; keys on dm:tines or inst:guitar-nylon through vinyl, cassette and light crush so they read as a sample from a crate, dm:lancet/boom bap snare, a short room reverb on a bus; the loop is four bars that never resolve; lift it with one chopped stab only at the end of every fourth bar, filtered like a record's fade; never a rigid unswung grid, equal-velocity hats or a clean bright piano", ["hip hop", "90s"]),
  G("lofi", "lo-fi hip hop", "hiphop", 70, 88, "a rainy window at two in the morning; a slow beat swung hard, the snare nudged a hair late, kicks that skip, hats soft and uneven, nothing above medium velocity; warm jazz chords on dm:tines or inst:guitar-nylon held their full length, through cassette wow, vinyl crackle and a velvet filter half closed; a round quiet bass with rests between phrases; everything sounds remembered rather than played; lift it with one chord per section that drifts flat under a cassette lane, like a stretched tape; never a loud snare, a bright top end, a dry oscillator or short blippy notes", ["lofi", "chillhop"]),
  G("miami-bass", "miami bass", "hiphop", 125, 140, "a rattling trunk at a beach party; a fast electro pattern, kick syncopated off the grid `x..x..x...x.x...`, claps on 2 and 4 with a flam, 808 hats in sixteenths whose velocities rise and fall, a cowbell answering; the kick IS the bass: dm:sub/808 or dm:sub/distorted 808 with a long decay and drive so a phone hears it, tuned to the stab roots; dirty brass stabs with a plate reverb on a bus, chanted call and response on dm:vox; lift it with a breakdown of boom and claps only, the boom bending down an octave; never a separate kick fighting the bass, or machine-gun hats at one velocity", ["booty bass", "miami", "bass music"]),
  G("trap", "trap", "hiphop", 130, 150, "dark, cinematic and patient, a night drive past streetlights; half time, clap on 3, a sparse kick, and hats as the lead instrument: eighths with velocity swells, broken by ratchet rolls and triplet bursts that start soft; a long dm:sub 808 with drive, gliding on ties so the bass sings, notes held to their full length; a minor bell, nylon or glass melody with space between phrases and a long reverb on a bus; the 808 slide closing each phrase is the signature; lift it with the melody reversed through prism for the bar before the hook; never constant hat rolls, a busy melody or a dry pulse lead"),
  G("drill", "drill", "hiphop", 138, 146, "cold, menacing and sliding, a grey estate at night; half time with the snares off the grid, the second pushed late `....x.....x..o..`, sparse triplet hats with ghosted notes, kicks that dodge the snares; dm:sub/drill slide is the voice: every long note glides up or down a fifth or an octave mid-bar; a sad piano on dm:tines, dm:oracle/strings or dm:vox/choir aah with deep bus reverb and a little vinyl; parts rest between phrases; lift it with a choir that answers the slide in the second hook, then cuts dead for one beat; never four on the floor, straight sixteenth hats or a bare synth lead", ["uk drill"]),
  G("phonk", "phonk", "hiphop", 130, 145, "a drifting car in a smoky lot, a melted tape on the dash; a cowbell riff on dm:808-cowbell or dm:hexop/bell, short and catchy, its velocities uneven like a hand; rattling hats with accents, a hard kick, a slapped snare nudged late; a dm:sub/distorted 808 or dm:sub/memphis saturated until it buzzes; everything through cassette, crush and a velvet filter, vox chopped and pitched down like an old memphis tape; lift it with the cowbell through the repeat stage on the last bar, stuttering into the drop; never a clean mix, a polite cowbell, or equal-velocity hats"),
  G("memphis", "memphis rap", "hiphop", 65, 80, "a haunted ride through 1993 memphis on a fourth-generation dub tape; a slow 808 beat, heavy kick, snare snapping slightly late, hats ticking in uneven eighths with a cowbell answering; a long dm:sub/memphis 808, eerie minor keys on dm:tines or dm:hexop/bell, one ominous three-note figure held and repeated; heavy cassette wow, vinyl, crush at 8 bits, everything low-passed, a muffled chanted vox; it should sound copied ten times; lift it with one bar where the tape slows (a pitch lane on everything falling a semitone) before the hook; never a crisp modern mix, a bright lead or dry oscillators"),
  G("cloud-rap", "cloud rap", "hiphop", 60, 80, "floating, half asleep, pink light through blinds; slow trap drums pushed far back, a soft kick, a snare washed in bus reverb, sparse hats at low and varied velocity; huge pads on dm:oracle/warm pad or dm:vox/angel ooh with slow attacks, chords held for whole bars, a soft dm:sub 808 that hums; prism with swell and space on the pad, chorus and cassette everywhere; the drums sound like they are under the pad; lift it with a vox phrase pitched up and slowed so the words dissolve, only in the hook; never punchy front drums, a dry mix or blippy short notes"),
  G("west-coast", "g-funk", "hiphop", 88, 98, "sun on chrome, a slow cruise down the boulevard; a laid-back funky beat, deep kick, snare on 2 and 4 with a ghost before it, swung hats and a tambourine pushed late; a fat dm:ladder/model d bass playing funk lines with octave jumps and rests; the whine, a high portamento lead on dm:ladder/whistle or dm:ladder/vibrato lead gliding between long held notes; dm:tines chords with seventh and ninth colour, chorus, a spring-ish bus reverb; lift it with a talkbox-like dm:vox doubling the whine in the last hook; never a hard aggressive snare, a busy line under the whine or a rigid grid", ["west coast"]),
  G("jazz-rap", "jazz rap", "hiphop", 85, 95, "a smoky record store, warm and conversational; a swung boom bap beat with a brushed feel, ghost notes on the snare, a ride swung hard and played softly; an upright-ish bass on dm:bass/walking jazz or inst:bass-electric with low decay, walking through the changes; muted jazz chords on dm:tines, a horn line on dm:breath (trumpet, muted trumpet or tenor sax) that feels sampled, vinyl crackle, a small room on a bus; the bass and keys sound lifted from a 60s record while the drums hit now; lift it with a horn phrase chopped into three pieces answering the hook; never trap hats, an 808 or a quantised grid"),
  G("abstract", "abstract hip hop", "hiphop", 75, 95, "off-kilter and curious, a late-night experiment in a cramped studio; a heavy boom bap pulse with kicks and snares nudged off the grid, ghosts everywhere, a euclid ring on a rim or tom lurching across it; wonky detuned keys on dm:tines and a dm:granular choir with a slow LFO on pitch, prism with broken or interference, cassette and vinyl on the bus; everything slightly drunk yet still grooving; lift it with the beat slicing itself through the repeat stage in slice mode for one section; never a straight grid, a predictable loop or a bare square lead"),

  // pop & r&b
  G("pop", "pop", "pop", 100, 128, "bright, confident and singable, a car radio with the windows down; a punchy beat on a real-sounding kit or tight samples, the kick driving the chorus, a clap on 2 and 4, hats lighter and ghosted in the verse; a dm:vox hook with a simple memorable melody, chords on dm:tines, dm:guitar/chime or inst:guitar-acoustic with a strum, a reverb bus and gentle sidechain; the contrast is the craft: a thin verse, a held-breath pre, a chorus that opens every filter; lift it with the hook answered by itself an octave up in the last chorus; never a chorus no bigger than the verse, or a bare pulse lead carrying the hook"),
  G("synthpop", "synthpop", "pop", 110, 128, "neon and heartbreak, a bedroom in 1984 with a new synth; a drum machine with a gated snare on 2 and 4 and hats that accent the offbeats; a sequenced eighth-note bass on dm:ladder/model d bass or dm:oracle/unison bass, glossy chords on dm:oracle/pulse keys with chorus and slop, an arpeggio through a dotted-eighth delay, a lead on dm:ladder/vibrato lead or dm:oracle/poly brass, a plate reverb on a bus; the bittersweet hook is a bright melody over minor chords; lift it with an arpeggio that appears only in the second chorus in counterpoint; never a modern sidechain pump, trap hats or a dry unchorused oscillator"),
  G("electropop", "electropop", "pop", 115, 130, "glossy, punchy and sure of itself, a club where the charts are playing; a hard four on the floor or a trap-tinged groove, claps layered on 2 and 4, crisp hats with accents; pumping chords on dm:contagion or dm:oracle/pulse keys sidechained to the kick, a tight sub, a hook on dm:vox or dm:ladder/funk lead with saturation and a short delay; the pump is the signature, chords ducking so the kick breathes through; lift it with a post-chorus where the vox hook becomes a chopped riff through the repeat stage; never a flat mix with no sidechain, or a bare square lead"),
  G("rnb", "r&b", "pop", 65, 95, "intimate, sensual and late, candles and silk; a slow beat swung hard, a sparse kick, a snare cracking with ghosts before it, hats with small triplet rolls that start soft; a deep sub or dm:bass/motown gliding under ninths and elevenths on dm:tines or dm:hexop/e.piano held their full length; dm:vox/soul lead that bends and lingers, harmonies stacked in the hook, a warm bus reverb; space is the craft: few parts, every chord lush; lift it with a half-step key change into the last chorus; never a busy arrangement, plain triads or a rigid grid", ["rnb"]),
  G("new-jack-swing", "new jack swing", "pop", 98, 112, "1989, a dance floor in harlem, sneakers squeaking; hard swung sixteenths with high swing on the hats and accents that move, a syncopated kick pushing ahead, a huge gated snare layered with a clap on 2 and 4; a fat syncopated bass on dm:ladder/model d bass or dm:hexop/bass, stabby dm:hexop/brass and organ hits, r&b chords on dm:tines, a gated reverb on the snare's bus; r&b singing over hip hop drums with a swing that bounces; lift it with a breakdown of stabs and claps only, a shouted vox call bringing it back; never straight unswung hats or a soft snare", ["new jack", "njs", "jack swing", "swingbeat"]),
  G("neo-soul", "neo soul", "pop", 75, 95, "a warm living room jam, behind the beat and in no hurry; a loose swung beat with kicks and snares nudged late, ghost notes everywhere, a hat played by a drummer leaning back; warm extended chords on dm:tines through chorus and a little cassette, a melodic dm:bass/motown singing between them, nudged early; a dm:vox/soul lead with smooth sliding phrases and rests; the drunk swing is the signature, drums behind and bass ahead; lift it with a bridge in the relative major, then back; never quantised drums, plain triads or an equal-velocity hat"),
  G("hyperpop", "hyperpop", "pop", 140, 170, "a maximalist sugar rush, a cartoon breaking down at full speed; distorted kicks, glitchy snare rolls, sudden half-time switches and trap hats at double speed with wild velocity swings; supersaw chords on dm:contagion, a distorted dm:sub 808, pitched-up dm:vox/la la with a fast glide; crush, fuzz and prism on everything, the repeat stage glitching the drums, yet the vocal and chords still produced and wide on a reverb bus; the sudden switch is the signature; lift it with a moment of silence or a lone clean piano before the final drop; never restraint, unless it is a joke"),
  G("kpop", "k-pop", "pop", 110, 130, "polished, dramatic and full of switches, a stadium of lightsticks; the beat changes by section: a trap verse with ghosted hats, a disco pre-chorus with live-feeling bass, a big electro chorus with a sidechain pump; layered dm:oracle and dm:contagion synths, a bright dm:vox hook stacked in harmony, chopped vox for the rap verse, a shared reverb bus; the dance break is the signature, a section built only for choreography on a new beat; lift it with an a cappella first line before the final chorus and a key change; never one groove from start to end, or a dry square lead", ["kpop"]),
  G("dream-pop", "dream pop", "pop", 80, 110, "floating, nostalgic and soft, a summer evening that will not end; a gentle beat buried under the guitars, a round kick, a brushed snare with reverb, hats soft and uneven; chorused guitars on dm:guitar/chime or dm:guitar/jangle with delay and a long bus reverb, a pad on dm:oracle/warm pad, a melodic dm:bass/motown with rests, breathy vox with morph high; the wash, chords bleeding into each other, is the signature; lift it with a reverse swell into each chorus (dm:halo/reverse swell) and a guitar line only in the last chorus; never dry drums, a fast tempo or a clean synth lead"),
  G("indie-dance", "indie dance", "pop", 115, 125, "sweaty, joyful and a little nervous, a small club full of guitars and synths; a driving four on the floor, open hats on the offbeats with uneven accents, a clap on 2 and 4 with a flam; a live-feeling bass on dm:bass/pick grind or dm:ladder/model d bass in busy eighths with ghosts, choppy dm:guitar/funk clean, an arpeggio on dm:oracle/pulse keys or dm:drift through a delay; the guitar locks with the bass like a band; lift it with a breakdown of bass and hats only, then a filter opening on everything; never a static loop, equal-velocity hats or synths burying the guitars"),

  // rock & metal
  G("rock", "rock", "rock", 100, 140, "a sweaty bar with the amps up, a band playing like they mean it; one acoustic kit played by a drummer, kick on 1 and 3, snare on 2 and 4 with ghosts, hats or ride accented, a crash on the one after each fill; driven power chords on dm:guitar through its amp and cab, a dm:bass locked to the guitar roots, a room reverb on a bus; dynamics are the craft: a tight verse, a chorus opening into crashes and ringing chords; lift it with a solo that quotes the vocal hook and then breaks loose; never programmed-sounding drums, a synth lead, or one intensity all the way through"),
  G("punk", "punk", "rock", 160, 200, "loud, fast and snotty, a basement show with no stage; an acoustic kit hammered, kick and snare alternating, hats or ride bashed with accents and a crash on every new section; distorted power chords on dm:guitar/brit stack or dm:guitar/grunge held their full length, a pumping eighth-note dm:bass/pop punk; short sections, no solos, a shouted gang vox; speed and the eighth-note pump are the signature; lift it with a sudden half-time breakdown before the last chorus; never a long intro, a polished mix or a synth anywhere"),
  G("post-punk", "post-punk", "rock", 120, 150, "cold, tense and danceable, a concrete room in 1980; a tight motorik beat with steady hats accented on the offbeats, a dry snare, a driving kick, maybe a drum machine treated like a drummer; a melodic chorused dm:bass/pick grind or dm:bass/pop punk that leads, angular clean guitar on dm:guitar/chime with flanger and a dotted-eighth delay, a dark plate on the snare; the bass plays the melody while the guitar scratches; lift it with high single-note guitar lines in the last section; never warm chords, a big rock chorus or a dry synth lead"),
  G("psych-rock", "psychedelic rock", "rock", 100, 130, "a light show in 1967, incense and fuzz, a band stretching time; a loose acoustic kit with busy tom fills, swung cymbals and ghosts, a melodic bass wandering under modal changes; a fuzz lead on dm:guitar/fuzz lead through phaser and a long delay, organ on dm:hexop/organ or mellotron-like dm:oracle/strings, flanger and a wide spring-like reverb on a bus; the mixolydian drone and a jam that builds are the signature; lift it with a backwards solo (prism reverse) that turns forwards at its peak; never a tight short song, a clean digital sheen or a bare synth lead", ["psych", "psychedelia", "60s psych"]),
  G("acid-rock", "acid rock", "rock", 110, 140, "heavier, louder psych, a festival field at dusk; a driving acoustic kit with big crashes and loose fills, a fuzzed riff doubled by dm:bass/growl; dm:guitar/fuzz lead through auto-wah with bloom up so held notes feed back, long distorted solos, a huge wet reverb on a bus; the feedback howl on a held note is the signature; lift it with the riff dropping to half time while the solo flies into space delay; never polite guitars, a short solo or quantised drums"),
  G("stoner-rock", "stoner rock", "rock", 70, 110, "sun-baked, heavy and hypnotic, a generator party in the desert; a groovy acoustic kit, big kick, cracking snare with ghosts, a ride bell swung just slightly; a down-tuned fuzz riff on dm:guitar/fuzz lead or dm:guitar/grunge doubled by a fuzzed bass and repeated until it hypnotises; a dry room, little reverb; the riff, heavy and slightly behind the beat, is the signature; lift it with a long jam of bass and drums alone, then the riff returning an octave lower; never bright clean guitars, a fast tempo or a synth", ["stoner", "desert rock"]),
  G("space-rock", "space rock", "rock", 100, 140, "cosmic and repetitive, a nebula crossed on a motorik pulse; a driving kit with steady accented eighths on the hat, a pulsing eighth-note bass on dm:bass; droning synths and swooshes from dm:drone and plaits:9, echoing guitars with long delay feedback, phaser and flanger everywhere, a cavernous bus reverb; one riff for minutes while the sound swirls around it; lift it with a delay feedback lane rising until it self-oscillates into a breakdown; never short sections, quick changes or a dry square arpeggio", ["cosmic rock"]),
  G("neo-psych", "neo-psychedelia", "rock", 90, 125, "dreamy, groovy and modern, a festival tent with oil lights; a groovy beat with a tight snare, a disco-ish hat with accents, a melodic dm:bass/motown with ghost notes; chorused and phased dm:guitar/jangle, vintage synths on dm:oracle and dm:drift with slop, cassette saturation and plenty of delay on a bus; the vintage sound on a modern groove is the signature; lift it with a synth solo wobbling in pitch under a cassette lane; never harsh distortion, a sterile digital mix or a dry oscillator", ["modern psych"]),
  G("psych-folk", "psych folk", "rock", 70, 110, "a forest clearing, campfire smoke, hazy and modal; strummed inst:guitar-acoustic chords with a strum and uneven velocities, inst:guitar-nylon picking a drone figure that rings its full length, hand percussion on a dm:halo/shaker and soft toms played by hand; a hazy vox with a long bus reverb, a slow phaser on the guitar, a little tape; a drone string that never changes while the chords move around it; lift it with a recorder-like plaits:4 line only in the last verse; never electric drums, a fast tempo or a synth sound", ["freak folk", "acid folk"]),
  G("garage-psych", "garage psych", "rock", 120, 160, "raw, fast and snotty, a 1966 garage with egg cartons on the walls; a raw acoustic kit with a pounding snare and sloppy fills, a farfisa-like organ riff on dm:oracle or dm:drift, a fuzzy dm:guitar/surf twang, a simple driving bass; tremolo and spring-like reverb, a snotty vox; the cheap catchy organ riff is the signature; lift it with a breakdown where the organ plays alone through a ring mod; never a polished mix, slow tempos or a clean digital lead", ["60s garage"]),
  G("heavy-psych", "heavy psych", "rock", 80, 120, "long jams over a slow heavy groove, a smoky hall in 1970; a slow acoustic kit with a huge reverb on the drums and loose rolling fills, a fuzz bass riff on dm:bass/growl, a wah and fuzz lead on dm:guitar/fuzz lead that wanders and bends; organ swells on dm:hexop/organ; the build, a jam growing into a wall of noise, is the signature; lift it with everything dropping to quiet organ and bass before the final wall; never short songs, tidy endings or quantised drums", ["proto metal"]),
  G("shoegaze", "shoegaze", "rock", 90, 130, "a wall of sound, eyes on the floor, the amp humming; a steady acoustic kit buried in the mix, a ride washing over everything; walls of fuzzy chorused reverb-soaked guitars on dm:guitar/grunge or dm:guitar/fuzz lead, a second guitar on dm:guitar/chime, a steady bass, dreamy vox under the guitars; the wash is felt more than heard; lift it with a pitch shift lane bending the whole wall down a semitone in the last chorus; never a dry clean guitar, a loud vocal or a bright synth"),
  G("metal", "metal", "rock", 100, 180, "aggressive, precise and powerful, a pit under strobes; an acoustic kit with double-kick sixteenths whose velocities vary slightly, a snare on 2 and 4 or a blast, crashes on accents; palm-muted riffs on dm:guitar/scooped metal or dm:guitar/djent chug, a tight dm:bass/pick grind doubling them, a short room on a bus; riffs built on rhythm more than notes, the gallop and the chug; lift it with a half-time breakdown of one chugged note under a ringing crash; never a soft drum sound, a loose riff or a synth lead"),
  G("doom", "doom metal", "rock", 50, 75, "slow, crushing and funereal, a cathedral filled with smoke; a huge slow acoustic kit, kicks dragging, a deep snare, long crash tails; slow riffs on dm:guitar/scooped metal or dm:guitar/grunge tuned low and doubled by dm:bass/growl, every chord left to ring, phrygian and minor; the silence between hits is part of the riff; lift it with a lone clean guitar arpeggio before the riff returns at full volume; never a fast tempo, a bright tone or short choked chords", ["sludge"]),
  G("drone-metal", "drone metal", "rock", 40, 60, "glacial and enormous, a wall of amps feeding back in a dark hall; no riffs to speak of: one detuned dm:guitar chord held for bars through a saturated amp with bloom up so it feeds back, a dm:sub/pure sine under it, dm:drone for the wall of noise; drums sparse or absent, a cymbal swell at most; the chord moves once every eight bars; lift it with a slow LFO on the guitar's tone so the feedback shifts pitch; never a beat, a melody or short notes", ["drone doom"]),
  G("surf", "surf rock", "rock", 140, 170, "sun, salt and reverb, a beach party in 1963; a driving acoustic kit with tom rolls and a cracking snare, ghosts on the hat; a twangy lead on dm:guitar/surf twang with tremolo picking and a drippy spring-like reverb, a walking dm:bass; the drip, a twangy guitar drenched in reverb and tremolo, is the signature; lift it with a glissando down the neck before the final chorus (a pitch lane falling); never a dry guitar, a slow tempo or a synth"),
  G("blues", "blues", "rock", 70, 120, "a smoky bar in chicago, a guitar crying on a stool; a shuffle on an acoustic kit, swung eighths on the ride, the snare with ghosts, a twelve-bar form; dm:guitar/blues burn with bends and a warm amp, phrases with space for the answer, a walking dm:bass/walking jazz; notes that ache toward the next are the signature; lift it with call and response between the guitar and a harmonica-like dm:ladder/vibrato lead through fuzz and room reverb; never straight eighths, a modern sheen or a bare synth"),
  G("indie", "indie rock", "rock", 110, 140, "earnest, warm and slightly ramshackle, a college radio station; a live acoustic kit with loose fills and ghosts, jangly dm:guitar/jangle or dm:guitar/chime strummed openly, a melodic dm:bass/svt fingers, a vox melody that cracks a little, a room reverb on a bus; the jangle is the signature; lift it with a counter-melody guitar only in the last chorus; never a big stadium mix, overproduced drums or a synth lead"),
  G("math-rock", "math rock", "rock", 110, 160, "intricate, nerdy and joyful, a basement full of pedals; odd meters (7/8, 5/4 patterns) on an acoustic kit with precise accents and ghosts, intricate clean tapping lines on dm:guitar/chime with a light delay, a melodic dm:bass; patterns that loop in odd lengths and land together at a phrase's end are the signature; lift it with two guitars in different meters meeting only at each section's start; never four on the floor, a straight 4/4 groove or a chiptune arpeggio"),

  // jazz, funk & soul
  G("funk", "funk", "soul", 95, 115, "sweaty and locked, a band leaning hard on the one; the downbeat hits together, then sixteenth ghost notes fill the space, snare on 2 and 4 with soft ghosts around it `X.o.X.oxo.oxX.o.`, hats varying velocity every step; palette a salamander or drskit acoustic kit, dm:bass/slap funk held for their real length, dm:guitar/funk clean scratching through an auto-wah, dm:hexop/organ or dm:tines stabs, a short room reverb bus; the signature is the one: slam it, leave beat 3 almost bare; lift it with a stop where only bass and guitar play the riff, then the band crashes back on the one; never equal-velocity machine-gun hats, never a dry square lead"),
  G("disco", "disco", "soul", 112, 122, "glitter ball euphoria, a live band in one big room; four on the floor, an open hat on every offbeat `..x...x...x...x.` with shifting accents, the clap on 2 and 4, the bass bouncing in octaves so it gallops against the kick; palette dm:bass/motown or inst:bass-electric, dm:guitar/funk clean chicken scratch with ghost strums, dm:oracle/strings sweeping in runs, dm:breath/brass section stabs, a hall reverb bus for strings and brass; the signature is the octave bass and the string swoop into each chorus; lift it with a drum break that climbs back via a string run; never a thin dry synth standing in for strings, never rigid identical hats"),
  G("nu-disco", "nu disco", "soul", 110, 122, "disco at night, warm, filtered and wistful; four on the floor with a soft kick, swung closed hats with ghosted velocities and offbeat opens, the bass playing the gaps between kicks with octave pops held their full length; palette dm:ladder/model d bass or dm:oracle/unison bass, dm:oracle/pulse keys or dm:tines through chorus, a dm:guitar/funk clean riff, a dotted eighth delay bus; the signature is a slow filter on the whole band opening across eight bars; lift it with a minor chord a half step away in the break before the filter flies open; never a hard edm drop, never a bare pulse lead or shrill same-velocity hats"),
  G("jazz", "jazz", "soul", 100, 180, "a small club at midnight, a quartet listening to each other; swing is everything, so write a step as an eighth or nudge every offbeat late, the ride singing ding ding-a ding, hat on 2 and 4, kick feathered; palette the virtuosity acoustic kit, dm:bass/walking jazz on every quarter with notes held full, dm:tines comping short shell voicings off the beat, a warm room reverb bus; the signature is the walking bass meeting syncopated comping; lift it with trading fours with drum fills; never straight eighths on a grid, never a dry synth lead or chords on every beat"),
  G("bebop", "bebop", "soul", 180, 240, "a breathless sprint, virtuosity as joy; the ride pinging every beat with the skip, hat on 2 and 4, kick and snare dropping bombs off the beat, eighths as steps with swing high or offbeats nudged late; palette the virtuosity acoustic kit, dm:bass/walking jazz on every quarter, dm:tines stabbing rootless chords in short jabs, a horn lead on dm:breath/alto sax or trumpet, tongued at phrase starts and slurred (tied) inside them, through a little room reverb; the signature is a long eighth-note line full of chromatic approach notes landing on chord tones; lift it with the head played twice in unison by two horn voices an octave apart; never a sustained pad, never a square-wave lead or a robotic even line", ["bop"]),
  G("hard-bop", "hard bop", "soul", 140, 200, "bebop gone to church, bluesy, gritty and driving; a hard swung ride with accents moving, the hat snapping 2 and 4, a snare full of ghost notes, swing via eighths as steps or late-nudged offbeats; palette the virtuosity acoustic kit, dm:bass/walking jazz digging in, dm:tines comping with blues fourths, two horn lines on dm:breath/trumpet and dm:breath/tenor sax harmonised a fourth apart swelling through phrases, a room reverb bus; the signature is a riff-like head with call and response between horns and piano, blue notes bending through minor chords; lift it with a shout chorus where every instrument hits one syncopated rhythm; never polite cocktail voicings, never bare beeping horns at one velocity"),
  G("cool-jazz", "cool jazz", "soul", 110, 150, "relaxed and airy, west coast sunlight through blinds; brushes swirling on the snare at low ghosted velocities, a soft swung ride, the kick barely there, swing via eighths as steps or offbeats nudged late; palette the virtuosity acoustic kit played quiet, dm:bass/walking jazz played light, dm:tines soft maj7 and min9 voicings with long release, a mellow horn lead on dm:breath/muted trumpet or flugelhorn at soft velocities, a warm plate reverb bus; the signature is restraint: two quiet lines in counterpoint instead of solos, rests between phrases; lift it with a moment where bass and lead play a canon without drums; never loud flat accents, never a thin bright synth tone"),
  G("modal-jazz", "modal jazz", "soul", 120, 160, "spacious and searching, one mode explored like a landscape; a swung ride with long gaps and shifting accents, the bass walking only inside the mode, eighths as steps for swing or offbeats nudged late; palette the virtuosity acoustic kit with dm:halo/crash swells, dm:bass/walking jazz, dm:tines voiced in stacked fourths, a dm:breath/muted trumpet or tenor sax horn lead, a large room reverb bus; the signature is staying on one chord for many bars, then sliding the whole band up a half step; lift it with the bass holding one pedal for eight bars while quartal chords move above; never a fast progression, never a dry oscillator lead"),
  G("swing-big-band", "swing", "soul", 140, 200, "a ballroom roaring, coats off, everyone dancing; kick feathered quiet on four, a swung ride, hat on 2 and 4, swing via eighths as steps with high swing or late-nudged offbeats; palette the drskit acoustic kit, dm:bass/walking jazz, horns in sections: dm:breath/brass section trumpets and dm:breath/sax section reeds as separate tracks, a hall reverb bus; the signature is call and response between sections, riffs repeated with growing intensity; lift it with a shout chorus where all the brass hits a big chord on the and of 4 and holds it over a drum break; never one flat brass track doing everything, never a chippy pulse horn", ["big band", "swing era"]),
  G("gypsy-jazz", "gypsy jazz", "soul", 180, 240, "a campfire in a caravan, fast, proud and minor; no drums, the rhythm guitar is the kit, la pompe: a short bass note on 1 and 3, a choked chord on 2 and 4 `x...X...x...X...`, velocities never quite equal; palette inst:guitar-acoustic with low decay and a small strum, dm:bass/walking jazz or inst:bass-electric walking, a lead on inst:guitar-nylon racing through arpeggios with notes nudged slightly ahead and behind, a small room reverb; the signature is minor 6 chords and diminished runs; lift it with a violin-like second voice on dm:breath/clarinet or dm:oracle/strings, trading phrases; never a drum machine, never a robotic arpeggio on a bare synth", ["manouche", "django"]),
  G("latin-jazz", "latin jazz", "soul", 160, 220, "a hot packed room, clave in every head; the clave `x..x..x...x.x...` anchors it, congas on dm:lancet/wood modal with lncrlevel humanizing each slap, a cowbell with accents on the beat, the bass a tumbao anticipating the beat on the and of 2 and on 4; palette dm:bass/walking jazz as tumbao, dm:tines playing a two-bar syncopated octave montuno, dm:breath/trumpet or brass section for bright horn lines, dm:halo/ride bell, a room reverb bus; the signature is everything locked to the clave while the percussion breathes; lift it with a mambo section where horns riff against the montuno and the congas open up; never straight swing on the ride, never stiff same-volume percussion", ["afro-cuban jazz"]),
  G("jazz-fusion", "jazz fusion", "soul", 100, 140, "electric virtuosity, rock muscle meets jazz harmony; tight drums with ghost-heavy snare, hats that open and close with the phrase, the bass busy, melodic and sometimes ahead of the beat; palette the drskit acoustic kit, dm:bass/slap funk or modern di, dm:oracle/warm pad and dm:tines with chorus for extended chords, a singing lead on dm:guitar/singing lead or dm:ladder/vibrato lead through delay, notes bent and held; the signature is unison runs where lead and bass play the same line, slash chords over a pedal; lift it with a passage in 7/8 that resolves back to four; never a beeping square lead, never quantized robot hats", ["fusion"]),
  G("smooth-jazz", "smooth jazz", "soul", 85, 105, "glossy, warm and easy, a sunset drive; a clean laid-back r&b groove with the snare a touch late, ghosted hats with gentle swing; palette the drskit acoustic kit or a soft 808 kit filtered warm, dm:tines with chorus, dm:bass/modern di at soft velocities for a fretless feel, a sax lead on dm:breath/soprano sax or alto sax, velocity as its breath, scoops into the long notes, dm:guitar/jazz box fills, a plate reverb bus; the signature is lush maj9 and min11 colour and a singable lead that rests between phrases; lift it with a final chorus up a whole step, lead an octave higher; never harsh clicky drums, never a bright bare synth lead"),
  G("jazz-ballad", "jazz ballad", "soul", 55, 75, "tender, late, nearly empty room; brushes swirling at low ghosted velocity, the bass in two on 1 and 3 with lots of air, swing via eighths as steps when anything moves; palette the virtuosity acoustic kit played soft, dm:bass/walking jazz sparse and held, dm:tines voicings with long release, a lead on dm:breath/subtone sax or flugelhorn, or dm:vox/soul lead, a warm reverb bus; the signature is rubato: melody notes nudged late and held across bar lines; lift it with a last chorus where the band drops away and lead and piano play alone, ending on an unresolved maj7#11; never a steady loud beat, never short blippy notes"),
  G("spiritual-jazz", "spiritual jazz", "soul", 70, 120, "meditative and cosmic, a prayer that grows into a storm; a modal drone over one chord, a bass ostinato repeated forever, toms and cymbals rolling in swells rather than a beat; palette the virtuosity acoustic kit toms and dm:halo/gong with bloom, dm:bass/walking jazz on an ostinato, plaits:11 harp arpeggios with velocity rising and falling, dm:tines quartal chords, a searching dm:breath/tenor sax or soprano sax lead, dm:vox/choir aah, a long hall reverb bus; the signature is patience on one chord with rising intensity; lift it with drums adding density every eight bars to a storm, then sudden calm; never chord changes for their own sake, never a dry digital tone", ["cosmic jazz"]),
  G("free-jazz", "free jazz", "soul", 80, 240, "liberation and chaos with a beating heart; loose time, the pulse broken and reformed, parts on different track lengths so they phase; palette the virtuosity acoustic kit with rolls and crashes at wild velocities, dm:bass/walking jazz on set_chance with rest high, dm:tines clusters, a dm:breath/alto sax or growl sax squalling, brtgrowl up, through a little fuzz, a big room reverb bus so it sounds like players in a space; the signature is collective improvisation where everyone listens and reacts; lift it with a sudden unison head everyone plays together, then the chaos returns; never a steady four on the floor, never sterile even-velocity notes"),
  G("nu-jazz", "nu jazz", "soul", 100, 125, "jazz in a club at 2am, laptops beside an upright bass; programmed broken beats with shuffled, velocity-varied hats and a ghosted snare, the kick syncopated off four on the floor; palette a breaks or live sampler kit through cassette, dm:bass/walking jazz or inst:bass-electric, dm:tines with phaser, a lead on dm:breath/muted trumpet with a dotted delay bus, dm:drift pads; the signature is jazz harmony over electronic rhythm; lift it with the repeat stage slicing the drums on the last bar of every eight while the bass walks straight through; never a straight house beat, never a dry square lead", ["electro jazz"]),
  G("jazz-waltz", "jazz waltz", "soul", 120, 180, "lilting and lyrical, a dance in three; 3/4 meter, the ride swung in three with beat one accented and two and three ghosted, the bass on one and walking through the bar; palette the virtuosity acoustic kit with brushes, dm:bass/walking jazz, dm:tines rotating maj7 and min7 voicings, a lyrical lead on dm:breath/flugelhorn, soprano sax or dm:guitar/jazz box with phrases that breathe, a room reverb bus; the signature is the lilt itself; lift it with a hemiola where the bass plays in two against the three before resolving; never a phrase that forgets the waltz, never machine-flat hits"),
  G("dixieland", "dixieland", "soul", 180, 240, "a street parade in New Orleans, brassy and celebratory; a two-beat bass on root and fifth, a banjo-like strum on every beat with accents varying, snare press rolls swelling into the downbeat; palette the salamander acoustic kit, inst:guitar-acoustic strumming short chords, dm:breath/tuba on root-fifth, dm:breath/trumpet lead, dm:breath/clarinet weaving above it, dm:breath/trombone with glide for slides, a clarinet-like dm:ladder/whistle, a room reverb bus; the signature is three lead lines weaving in polyphony, each nudged a little off the grid; lift it with a stop-time chorus where the band hits on one and a horn fills the gaps; never modern harmony, never a lone dry bleep lead", ["trad jazz", "new orleans"]),
  G("ragtime", "ragtime", "soul", 90, 120, "a saloon upright piano, jaunty and precise; no drums, a march left hand: low root on 1 and 3, a chord on 2 and 4, left hand softer than the right; palette dm:tines or dm:hexop/e.piano with cassette and a small room reverb so it sounds like an old upright recording, a right hand melody syncopated against the steady left; the signature is melody notes on the and of 2 and 4 tied over the beat; lift it with a trio section in a new key, quieter and more lyrical; never a drum kit, never a chiptune bleep tone"),
  G("acid-jazz", "acid jazz", "soul", 95, 115, "funky and cool, a London basement in the nineties; a funky breakbeat with swung, ghost-noted hats and a fat snare, kick and bass syncopated; palette a breaks sampler kit with vinyl, dm:bass/slap funk, dm:hexop/organ through a phaser, dm:tines comping, dm:breath/brass section or horn stabs riffs, dm:vox/soul lead, a room reverb bus; the signature is jazz chords and a heavy organ groove over a sampled break; lift it with a jazz solo break where the drums switch to the ride; never a straight drum machine beat, never a bare square lead"),
  G("soul", "soul", "soul", 70, 110, "warm and heartfelt, a voice telling the truth; a laid-back beat with the snare sitting behind the grid and soft ghost notes, the bass melodic and singing with notes held long; palette the drskit acoustic kit, dm:bass/motown, dm:tines or dm:hexop/organ for gospel-tinged chords, dm:vox/soul lead, dm:oracle/strings swells, cassette warmth and a plate reverb bus; the signature is call and response between the lead vox and backing voices; lift it with a bridge that modulates up a half step for the last chorus; never a quantized machine beat, never a vox buried or a dry oscillator lead"),
  G("gospel", "gospel", "soul", 70, 130, "joyful noise, the church on its feet; hand claps on 2 and 4 with slightly uneven timing, a driving beat or a slow 12/8 feel, a snare full of ghost notes; palette the drskit acoustic kit, dm:hexop/organ through chorus for the rotary swirl, dm:tines piano runs, dm:vox/hallelujah or choir aah with many voices, dm:bass/motown, a long hall reverb bus; the signature is organ swells and passing chord changes under a call and response choir; lift it with a vamp where the choir repeats one phrase and the organ climbs higher each time; never a static chord, never a thin dry choir"),
  G("motown", "motown", "soul", 110, 130, "uplifting and polished, the sound of young america on a transistor radio; the snare or a tambourine on every beat with accents shifting, a busy melodic bass held its length; palette the salamander acoustic kit, dm:bass/motown, dm:tines piano, dm:oracle/strings, dm:breath/brass section stabs with a bari sax under them, dm:vox/doo wop or soul lead, dm:halo/shaker as tambourine, cassette and a small room reverb bus; the signature is that pounding snare-on-every-beat and a bass that sings; lift it with a key change for the last chorus and a string fill; never a dark minor drone, never stiff identical hits"),

  // latin & world
  G("reggaeton", "reggaeton", "world", 88, 98, "late-night perreo, heavy and patient, swaying the hips; the dembow never changes: kick on every beat, snare on the a of 1 and the and of 2 `x..xx.x.x..xx.x.`, a rim shadowing it at varied velocities with ghost notes and the odd hit nudged late; dm:sub/808 sliding between roots with notes held their full length; a minor hook on inst:guitar-nylon or dm:hexop/marimba with a short delay on a bus, saturation and eq warming it; vox phrases with rests; lift it by dropping the dembow for a bar under a filtered vox, then slamming back; never a busy hat line, never equal-velocity hits or a bare square lead"),
  G("dembow", "dembow", "world", 115, 125, "dominican street party, faster and rawer than reggaeton, built for a speaker on a motorbike; kick and snare trading on every eighth with a clap layered on the snare, accents and softer hits alternating so it breathes, a few claps nudged early; a punchy dm:siege/808, dm:lancet/fm clap with a touch of lncrlevel, dm:sub/distorted 808 hitting with the kick; one repeated three-note hook on dm:snarl through a fuzz and eq so it sits like a sample, not a chip; chopped dm:vox/la la shouts through the repeat stage; sudden one-beat gaps; never pads or a long breakdown, never a dry square lead"),
  G("baile-funk", "baile funk", "world", 128, 135, "rio favela sound system, raw, loud and joyous; the tamborzão rolls on 808 kicks and toms `x..x..x...x.x.x.` with claps cutting the backbeat, velocities uneven like a hand on a drum machine, a few toms nudged; a booming dm:808-kick that is half the bass, dm:sub/808 with drive so a phone hears it, dm:808-cowbell for the call; gated chopped vocal stabs on dm:vox/la la through repeat in slice mode, cassette saturation on the drum bus for a bootleg edge; one ominous horn stab at most; lift it with a two-bar half-time switch; never smooth chords, never clean equal hits", ["funk carioca"]),
  G("afrobeats", "afrobeats", "world", 98, 115, "lagos sunshine, warm and buoyant, effortless; a syncopated beat with the kick avoiding the obvious, shakers in swung sixteenths with accents and ghost notes, a rim on the offbeats and log-drum or tom answers, nudged a little late; a round inst:bass-electric or dm:bass/modern di dancing around the kick, notes held to their real length; a bright inst:guitar-electric riff interlocking over two bars, dm:tines for soft extended chords, chorus on the guitar and a reverb bus for air; call and response between guitar and dm:vox/soul lead; lift it with a breakdown of shaker, bass and vox alone; never hard distorted drums, never a straight machine hat"),
  G("amapiano", "amapiano", "world", 110, 116, "johannesburg after-hours, lazy, jazzy and huge in the low end; a shuffled four on the floor with soft kicks, shakers and rims skipping on swung sixteenths, velocities rolling up and down like a hand; the log drum is the star: dm:sub/808 or dm:sub/cinematic drop bending into syncopated notes `x..x..x...x..x..`; dm:tines or dm:hexop/e.piano jazzy chords with long tails through a reverb bus and a little cassette; a whistle or vocal hook floating above, phrases with long rests; lift it by muting the kick for eight bars and letting the log drum walk alone; never a busy top end, never a rigid unswung grid"),
  G("afrobeat", "afrobeat", "world", 100, 120, "seventies lagos band, hypnotic and political, ten minutes that never bore; interlocking ostinatos: a salamander or virtuosity kit with ghost-noted snare (o) and a hat carrying accents, a repetitive dm:bass/motown riff, two dm:guitar/funk clean lines, one muted on the offbeats, one picking high single notes, each nudged slightly off the other; dm:breath/brass section unison horn riffs with velocity swells, a dm:breath/tenor sax solo; a room reverb on a bus so it sounds like one band in one room; parts drop out and return rather than change; lift it with an organ solo over the bare rhythm section; never a chord every bar, never equal-velocity programmed drums"),
  G("bossa", "bossa nova", "world", 120, 140, "rio apartment at dusk, intimate and quietly sophisticated; a soft surdo-like kick on 1 and the and of 2, a rim clicking `..x..x..x...x...`, brushes on a virtuosity kit with every hit a different velocity; inst:guitar-nylon carries everything, sevenths and ninths with chromatic inner voices, a small strum, decay letting chords breathe; a soft dm:bass/walking jazz on root and fifth; a breathy dm:vox/whisper melody with rests between phrases; warm eq, a gentle room reverb on a bus; the trick is chords moving by half steps; lift it with a key change up a half step; never loud, never a stiff drum machine"),
  G("samba", "samba", "world", 95, 105, "carnival street parade, joyous and propulsive; the surdo, a low tom or dm:sub/dub, louder on beat 2 than beat 1; batucada above: a shaker in sixteenths accenting the second and fourth of each beat, tamborim figures on dm:lancet/piccolo `x.xx.x.xx.x.x.x.`, an agogô on dm:halo, every part with lncrlevel or hlovary and light swing so it sounds like many players; inst:guitar-nylon strumming bright syncopated chords; a whistle or snare roll cueing each section; a big outdoor reverb on a bus; lift it with a batucada-only break; never a backbeat on 2 and 4, never identical hits"),
  G("salsa", "salsa", "world", 160, 210, "new york ballroom, hot, tight and precise; everything locks to son clave on a dm:lancet/wood modal rim, never broken; cowbell on the beat, congá tumbaos on toms with open slaps on the and of 4, ghost touches between at low velocity; the bass plays tumbao on inst:bass-electric, anticipating the downbeat and resting on 1; the piano montuno on dm:tines, a syncopated two-bar figure that fits the clave; dm:breath/brass section shout chords with velocity swells and a hall reverb on a bus; lift it with a mambo section of trading horn riffs; never a kick on every beat, never against the clave"),
  G("cumbia", "cumbia", "world", 85, 110, "colombian coast heat, a slow swaying walk with a little sadness; a güiro scrape on dm:halo/shaker `x.xxx.xxx.xxx.xx` with the long strokes accented, a soft kick on 1 and 3, a muted tom on the and of 2 and 4, everything a hair loose; the bass bounces root to fifth on dm:bass/motown, notes held full length; an accordion lead on dm:oracle/pulse keys with vibrato and chorus, melodies in thirds, phrases ending with breaths; tape warmth from cassette; lift it with a chicha turn, dm:guitar/surf twang through phaser; never fast, never a bare synth lead"),
  G("flamenco", "flamenco", "world", 90, 150, "andalusian fire, tense, proud and grieving; the twelve-beat compás accenting 3, 6, 8, 10 and 12, a 6/8 against 3/4 hemiola, palmas on dm:808-clap and dm:lancet/slap crack with the off-claps soft (o) and lncrlevel so it sounds like hands; inst:guitar-nylon rasgueado with a fast strum, the andalusian cadence falling into the major chord in phrygian dominant colour; falsetas answering the strums; a cajón on dm:lancet/wood modal; a cante-like dm:vox/soul lead with bends; a small dry room reverb; sudden stops on the accents; lift it with a bulería speed-up; never a backbeat, never programmed-sounding claps"),
  G("bhangra", "bhangra", "world", 90, 110, "punjabi harvest festival, exuberant and bouncing; the dhol chaal drives it, the bass side on 1 and the and of 2, the high side cracking offbeats `X..x..x.X..x..x.` on a low tom and dm:lancet/slap crack, strongly swung, accents and ghosts like two hands; a bouncy bass doubling the dhol accents; the tumbi, a high plucked riff on plaits:11 with saturation and a slapback delay, one phrase repeated; shouted hoy calls on dm:vox/la la; a live room reverb on a bus; lift it with a dhol solo break; never a straight unswung beat, never lush pads"),
  G("arabic", "arabic pop", "world", 90, 110, "cairo nightlife, ornamented and emotional, made for dancing; the maqsum on darbuka-like toms, doum low on 1, the and of 2 and 3, tek high on the rest `x..x..x.x...x...`, fast ghosted ornament rolls between, a riq on dm:halo/shaker with hlovary; a deep bass following the doum; melody in maqam colour, phrygian dominant or double harmonic, with slides and glide on dm:ladder/vibrato lead or dm:vox/soul lead; dm:oracle/strings playing the same line, not chords, slightly nudged apart; a hall reverb on a bus; lift it with a free taqsim over a held drone; never western progressions, never stiff unornamented lines"),
  G("balkan", "balkan beat", "world", 120, 150, "wedding brass band at full tilt, giddy and slightly drunk; aksak meters, 7/8 as 2+2+3 or 9/8 as 2+2+2+3, the kick on each beat start and an offbeat snare chopping between, accented hits and ghosts on a salamander kit; a bouncy dm:bass/svt fingers pumping roots; tight unison brass on dm:breath/trumpet and dm:breath/low brass, a dm:breath/tuba or trombone oom-pah, a dm:breath/clarinet over the top, harmonic or hungarian minor colour, the two players nudged apart and swelling in velocity; an accordion-like dm:oracle/pulse keys lead with chorus; a room reverb so it sounds like a band; lift it with an accelerating final section; never straight 4/4, never quiet or stiff"),
  G("kpop-trot", "city pop", "world", 100, 120, "city pop: a tokyo highway at night, glossy, wistful and expensive sounding; a drskit or salamander kit with ghost notes and lightly swung hats; dm:bass/slap funk dancing around the kick; lush major seven and nine chords on dm:tines and dm:oracle/glass with chorus; dm:guitar/funk clean cutting sixteenth chops with dynamics; a bright dm:breath/alto sax or trumpet lead with phrases that breathe; polished eq, a plate reverb on a bus; sophisticated chromatic passing changes under a sunny melody; lift it with a key change into the last chorus; never lo-fi grime, never dry oscillators or a bare pulse lead", ["citypop"]),

  // reggae & dub
  G("reggae", "reggae", "reggae", 70, 90, "kingston yard, warm, unhurried and conscious; the one drop: no kick on 1, kick and rim together on beat 3, a shaker in swung eighths, ghost rims at velocity o; the bass is the melody, round on dm:bass/dub, phrased like a singer with rests and pickups, notes held full; the skank `....x.......x...` on dm:guitar/funk clean, muted and short, with a bubbling dm:hexop/organ; spring-like reverb on a bus, a touch of vinyl; the downbeat left empty for the bass; lift it with a melodica line on the second verse; never a kick on 1, never a busy bass that does not breathe"),
  G("dub", "dub", "reggae", 65, 85, "the mixing desk as instrument, deep, dreamy and full of echo; a one drop with a ghost-noted rim, the snare and skank sent to a bus with long tape delay and spring-like reverb; dm:sub/dub bass that drops out and slams back; parts mute and return by section, delay wet lanes throw single snare hits or chords into spiralling feedback, filter lanes sweep the drums, cassette saturation on the bus; the song is a riddim taken apart; lift it with delay feedback pushed to the edge of self-oscillation for one bar, then cut dead; never every part at once, never a dry mix"),
  G("dancehall", "dancehall", "reggae", 90, 105, "jamaican digital riddim, bright, rude and bouncy; a sparse syncopated pattern of kick and snare trading, the snare often on the a of 2, a few ghosted rims, light swing; a heavy dm:808-kick or dm:siege/808; dm:sub/808 short and punchy, doubling the accents; a catchy three-note hook on dm:hexop/bell or plaits:2 through saturation and a dub delay so it sounds pressed, not blippy; stabs and a siren for energy; lift it with a riddim switch under the same hook; never reggae's one drop, never lush chords or a bare pulse lead"),
  G("ska", "ska", "reggae", 140, 180, "two-tone dancefloor, upbeat, jerky and sharp; a salamander kit, snare on 2 and 4 with ghost notes, a fast hat accented on the beat; the skank on every offbeat `..x...x...x...x.` on dm:guitar/chime, short and bright; a walking dm:bass/motown in quarters with chromatic approaches; tight unison horns on dm:breath/brass section or horn stabs answering the vox, swelling in velocity; a bouncy dm:hexop/organ doubling the skank; a live room reverb on a bus; lift it with a half-time dub breakdown before the last chorus; never a slow groove, never a skank on the beat"),
  G("steppers", "steppers", "reggae", 70, 80, "sound system militance, heavy, rolling and hypnotic; four kicks on the floor under a one-drop snare and rim on 3, open hats on the offbeats with uneven velocities, a march feel; dm:sub/dub rolling a two-bar eighth figure of root, minor third and fifth; a sparse organ skank on dm:hexop/organ, a minor melodica lead on dm:oracle/pulse keys; sirens and tape delay throws on snare fills through a bus with spring reverb; lift it with a dub section of kick and bass alone; never swung bounce, never bright major"),

  // synth & retro
  G("synthwave", "synthwave", "retro", 96, 118, "a neon drive through a city that never existed, nostalgic and cinematic; a big gated snare on 2 and 4 with a room reverb, the kick on the beat, sixteenth hats with velocity accents, never flat; a driving eighth-note bass on dm:ladder/model d bass, the filter breathing; lush detuned dm:oracle/warm pad with chorus and orcslop up, sidechained from the kick; an arp on dm:oracle/pulse keys with dotted-eighth delay; a dm:ladder/vibrato lead with glide and long held notes; cassette on the master bus for tape; lift it with a dm:guitar/singing lead solo; never modern trap drums, never dry oscillators or a bare square lead", ["outrun", "retrowave"]),
  G("darksynth", "darksynth", "retro", 100, 130, "a horror film chase scene, aggressive and menacing; a pounding kick, a huge distorted gated snare, fast hats with real accents and ghosts; a dm:snarl bass grinding sixteenths through fuzz and a crisp eq, its filter moving by lane; dark minor arps on dm:oracle/dirty stab with the scream filter character; ominous dm:oracle/strings and a dm:vox/basso choir through a big reverb bus; the arp melodic, the bass refusing to resolve; lift it with a break where the arp runs alone through a closing filter, then everything returns doubled; never bright major, never thin dry oscillators"),
  G("italo", "italo disco", "retro", 115, 125, "an eighties milan disco, sweet, melancholic and a little naive; four on the floor, open hats on the offbeats, a handclap on 2 and 4, the hats with accents; the octave bass `xXxXxXxXxXxXxXxX` on dm:ladder/model d bass, filter moving; bright arps on dm:oracle/pulse keys with chorus; a singable dm:ladder/whistle melody with delay and glide, phrases leaving gaps; a dm:vox/robot choir vocoder hook; a plate reverb on a bus; the minor key sung sincerely over an optimistic bounce; lift it with a tom fill and a lead climbing an octave; never ironic, never a bare pulse lead"),
  G("new-wave", "new wave", "retro", 120, 150, "post-punk gone pop, jittery, clever and bright; a drskit or salamander kit, hats in eighths with accents, a cracking snare with ghosts; a picked dm:bass/pick grind with chorus in driving eighths and octave jumps; clean dm:guitar/jangle or dm:guitar/chime chops, nudged slightly against the hats; bright stabs on dm:oracle/pulse keys and a cold dm:hexop/bell line; a catchy vox hook with breaths between lines; a room reverb on a bus; a nervous locked rhythm under a naive melody; lift it with a surprise chord swerve in the chorus; never distorted guitars, never stiff programmed drums"),
  G("chiptune", "chiptune", "retro", 120, 180, "a cartridge in a handheld console, joyful, bright and frantic, and it SHOULD sound like a game; only what the chip had: two pulse leads on plaits:0 or dm:drift, a triangle bass, noise drums on plaits:9 short, plaits:13 for the kick; chords as very fast arpeggios; leads with vibrato and quick pitch slides; echo made by repeating notes quieter rather than delay; a duty-cycle feel switched between sections; the signature is fast arps standing in for chords; lift it with a key change into the last loop; never reverb or lush pads, never acoustic instruments", ["8-bit", "8bit"]),
  G("vaporwave", "vaporwave", "retro", 60, 90, "a mall at closing time, nostalgic, eerie and slowed down; a lazy dry beat with uneven velocities; smooth jazz chords on dm:tines or dm:hexop/e.piano drenched in reverb, through cassette with wow and flutter so they warble; dm:bass/slap funk heard as if through a wall, the eq cutting its top; a sax-like dm:ladder lead playing fragments with long tails; phrases looped oddly through the repeat stage; everything slightly too slow and too wet; lift it with a section where the filter closes as if fading into a dream; never crisp modern drums, never clean dry synths"),
  G("krautrock", "krautrock", "retro", 110, 140, "a cologne studio in 1972, motorik and hypnotic, a road that goes on forever; a salamander kit, kick on every beat `x...x...x...x...`, hats in straight eighths with natural accents, the snare on 2 and 4, never a fill; a repetitive eighth bass on dm:bass/pick grind; droning dm:guitar/jangle with delay; dm:drone/machine hum or a held dm:hexop/organ chord underneath; tape saturation on a bus; the beat fixed while textures slowly appear and disappear; lift it with a long build where phaser and delay swell together; never a chorus, never a quantized drum machine"),
  G("electro-funk", "electro funk", "retro", 100, 120, "a bronx block party in 1983, robotic, funky and futuristic, but played; an 808 beat with a booming syncopated kick, a clap on 2 and 4, cowbell accents, hats with velocity and swing; a rubbery dm:ladder/funk lead or dm:hexop/bass line in sixteenths with octave pops and ghosted notes; bright stabs on dm:oracle/poly brass; a talkbox-like hook on plaits:7 or dm:vox/robot choir; scratchy dm:guitar/funk clean nudged late; a plate on a bus; lift it with a vocoder-alone breakdown over the 808; never acoustic drums, never flat machine-gun hats"),
  G("berlin-school", "berlin school", "retro", 100, 130, "a planetarium at midnight, cosmic, meditative and slowly unfolding; no drums, the sequence is the pulse; a sixteenth sequence on dm:ladder/percussive, eight to sixteen notes with accents, its cutoff and resonance swept over minutes; a second sequence of a different length beside it so they phase; mellotron-like dm:oracle/strings or dm:vox/choir aah; dm:drone/cathedral underneath; tape delay and a long reverb on a bus, cassette warmth; a pattern slowly transposed and filtered rather than repeated; lift it with a lead entering halfway with long vibrato notes; never a backbeat, never a dry static sequence"),

  // ambient & experimental
  G("ambient", "ambient", "ambient", 60, 84, "a room filling with light, patient and spacious; no drums or the faintest pulse; long evolving pads on dm:oracle/warm pad or dm:granular with slow attacks; dm:drone/glacier or dm:drone/cathedral holding the floor; sparse notes on dm:hexop/bell or plaits:12 at varied velocities, nudged off the grid, falling into a long reverb bus; slow LFOs on cutoff and reverb decay so nothing is static, cassette for warmth; silence and decay are part of the composition; lift it with one new chord colour after minutes of stillness; never a beat that demands attention, never dry static oscillators"),
  G("drone", "drone", "ambient", 50, 80, "a single held tone that becomes a landscape, meditative and immense; dm:drone/glacier or dm:drone/subterranean latched for many bars, filter and cloud lanes moving glacially; a second drone a fifth or octave away, slightly detuned so beating appears; dm:sub/pure sine swelling in and out; dm:vox/monk chant or plaits:8 swarm adding overtones; a long reverb bus and tape saturation so it feels physical; changes measured in minutes, not bars; lift it with the cloud frozen while the drone underneath shifts a semitone; never a rhythm, never a melody"),
  G("idm", "idm", "ambient", 90, 140, "a bedroom in sheffield at 4am, intricate, melancholy and playful; drums re-edited every bar with ratchets, nudged steps and euclid rings, velocity varied on every hit; a soft melodic bass on dm:ladder; warm dm:oracle/warm pad or dm:hexop/pad chords with long tails through cassette and a reverb bus; detuned dm:hexop/bell melodies with breathing phrases; plaits:10 particle textures and the prism stage; mechanical complexity over tender harmony; lift it with the beat glitching into the repeat stage while the chords stay serene; never a static loop, never equal-velocity machine hats", ["braindance"]),
  G("glitch", "glitch", "ambient", 90, 130, "a broken laptop in a white gallery, fragmented, precise and strangely beautiful; the music is errors: stutters and slices from the repeat stage in slice mode, crushed clicks on dm:lancet/coins on the head with crush at a low rate, a micro kick and a warm sub; dm:hexop/bell shards repeated and cut at varied velocities; silences as rhythmic as the sounds; eq and a short room reverb give the debris a space; lift it with one warm chord appearing intact amid the debris; never a groove that settles, never pure sine beeps with no processing"),
  G("downtempo", "downtempo", "ambient", 80, 100, "a balcony at sunset, relaxed and head-nodding; a slow swung beat on a virtuosity kit or breaks kit, a soft kick, a crisp snare with ghost notes, shakers with real accents; a deep dm:bass/dub or inst:bass-electric playing a lazy melodic line; lush dm:oracle/warm pad and jazzy dm:tines; an inst:guitar-nylon fragment; delays and a long reverb on a bus, vinyl or cassette on the drums; a groove to sink into; lift it with a flute-like plaits:4 melody entering on the second pass; never aggressive drums, never a rigid grid", ["chillout", "trip-hop"]),
  G("trip-hop", "trip hop", "ambient", 70, 95, "bristol in the rain, smoky, cinematic and heavy; a slow swung breakbeat on the breaks kit, a fat kick, a cracking snare with ghosts, vinyl crackle and cassette on the drum bus; a deep dark dm:bass/dub or dm:sub/memphis; dark jazzy dm:tines with an orchestral dm:oracle/strings sweep; a moody dm:vox/whisper or soul lead with breaths between lines; scratches from the repeat stage; cinematic dread over a hip hop beat; lift it with strings swelling in the last chorus and the drums dropping for a bar; never bright, never a clean quantized beat"),
  G("cinematic", "cinematic", "ambient", 60, 100, "a trailer for a film that does not exist, epic and emotional; dm:oracle/strings and dm:breath/french horn or low brass with slow attacks and velocity swells, held full length; deep booms on dm:siege/rumble or dm:sub/cinematic drop at section hits; a ticking ostinato on plaits:11 or dm:hexop/marimba; a gentle theme first on a lone dm:tines, then the full orchestra; dm:vox/choir aah for the climax; a big hall reverb on a bus; dynamics building from a whisper to a roar; lift it with a bar of silence before the final hit; never a static mix, never dry synth strings"),
  G("dark-ambient", "dark ambient", "ambient", 50, 80, "an abandoned cathedral underground, unsettling, vast and cold; low rumbling dm:drone/dark grone or dm:drone/subterranean; metallic scrapes from dm:halo/gong or dm:halo/trash with long decays and prism space; a distant dm:vox/monk chant through a long reverb bus; slowly shifting dissonance, tritones and minor seconds; plaits:10 crackles and plaits:9 wind, eq carving them into distance; dread that builds slowly; lift it with a single clean bell note emerging and being swallowed; never a beat, never resolution"),
  G("new-age", "new age", "ambient", 60, 90, "a spa at dawn, calm, hopeful and gentle; no drums, or soft hand percussion with varied touch; dm:hexop/bell and plaits:12 at uneven velocities, warm dm:oracle/warm pad with slow chorus; a slow singable flute-like plaits:4 or dm:vox/angel ooh melody, phrases ending with space; major and lydian colour, the raised fourth adding light; arpeggios on dm:tines rippling slowly; plaits:10 or dm:granular nature textures; a long soft reverb bus; consonance and soft attacks everywhere; lift it with a whole-step modulation for the final theme; never dissonance, never startling percussion"),
  G("musique", "experimental", "ambient", 60, 160, "a studio as laboratory, curious, surprising and alive; euclid rings and chance generators on several parts so rhythm emerges, polymeters with tracks of 5, 7 and 11 steps; the drone and vox engines used against type, a vox singing syllables as percussion, a drone as a rhythm; dm:granular textures; prism and repeat as instruments; every sound chosen for its strangeness yet shaped like a record, with eq, saturation and a shared reverb bus; lift it with one clean conventional chord before returning to chaos; never a standard verse chorus, never raw unprocessed beeps"),
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
  chip: "noise and blips, no samples: plaits:13 for the kick, plaits:9 with a short decay for the snare and the hats",
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
 * @type {Record<string, { forms: string[], angles?: string[], lifts?: string[], layered?: boolean }>}
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
    lifts: ["a new voice above the pad", "the same chord an octave higher", "a slower, deeper drone under it", "one more note in the chord"],
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
const E8 = "x.x.x.x.x.x.x.x.";
const S16 = "xoxoxoxoxoxoxoxo";

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
    optional: { lead: ["dm:ladder/funk lead", "dm:drift"], pad: ["dm:oracle/strings", "dm:oracle/warm pad"], vox: ["dm:vox/soul lead", "dm:vox/la la"], shaker: ["dm:halo/shaker"] },
    extras: [1, 2],
    bass: ["off the kick: notes on the offbeats `..x...x...x.x...`, root and fifth", "a syncopated two-bar line that walks up to the next chord `x..x..x...x.x_..`", "an octave bounce `x.x.x.x.x.x.x.x.`, low on the beat and high off it"],
    harmony: ["minor: i7 - iv7 - bVII - i7, stabbed on the offbeats", "dorian: i7 - IV7, two bars each, the dorian vamp", "minor: i9 - bVI maj7 - bVII, one chord a bar", "major: ii7 - V7 - I maj7 - vi7, a gospel piano feel", "mixolydian: I7 - bVII - IV, bright and bluesy"],
    moves: ["the chords under a cutoff lane that opens through the build", "sidechain the chords from the kick", "a piano or organ stab rhythm `..x..x....x..x..` that never lands on the beat", "a one-bar kick drop-out before each drop", "a clap flam and an open-hat lift in the last bar of every eight"],
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
    optional: { pad: ["dm:oracle/strings"], lead: ["dm:hexop/bell", "dm:hexop/marimba"], vox: ["dm:vox/soul lead", "dm:vox/whisper"] },
    extras: [1, 2],
    bass: ["long round notes, one or two a bar, sliding into the next root `x_____..x___....`", "a rolling offbeat line `..x_..x_..x_.xx_`", "a sparse call every two bars, silent in between"],
    harmony: ["minor: i min9 - iv min9, four bars each", "dorian: i min7 - bVII maj7 - bIII maj7 - v min7", "dorian/minor: one chord, i min9 or min11, held, the bass moving under it (1, b7, 4)", "major: ii min9 - V13 - I maj9, slow"],
    angles: ANGLES_AT(0, 2, 3, 6, 5),
    moves: ["chords held long with a slow LFO on the cutoff", "a delay throw on the last chord of every eight bars", "[lead] a chord stab answered by a bell note two beats later", "the kick alone with the chords in the break", "everything quiet: velocities under X, nothing harsh"],
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
    optional: { bass: ["dm:sub/acid", "dm:sub/house sub"], stab: ["dm:oracle/dirty stab", "dm:hexop/organ"], pad: ["dm:oracle/warm pad"], "second acid": ["dm:silverbox"] },
    extras: [0, 2],
    bass: ["the silverbox IS the bass: a sixteen-step line with three accents (X) and two slides (ties) `x.xXx_x.X.x.x_xX`, mostly the root with an octave jump and a b2 or b7", "a sparser line with rests that the accents punch through `X..x.x_.X.x...x_`, two bars, the second bar ending differently", "a line of straight sixteenths where only pitch and accent move `xxXxxxXxxXxxx_Xx`"],
    harmony: ["minor/phrygian/minor pentatonic: no chords: one root, the line itself implying the key with its b7 (and the b2 in phrygian)", "minor/phrygian: no chords; the line moved up a fourth for the last two bars of every eight", "minor: a single held minor stab on the offbeat, nothing else harmonic"],
    angles: ANGLES_AT(0, 1, 3, 4, 6),
    moves: ["cutoff and reson lanes on the silverbox that differ in EVERY section: closed in the intro, wide open in the drop", "sbaccent high so the accents bark", "[second acid] a second silverbox an octave up answering the first in the last drop", "delay on the silverbox, wet rising through the build", "the kick out for the last bar of the build while the resonance peaks"],
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
    optional: { stab: ["dm:oracle/dirty stab", "dm:hexop/bell", "plaits:6"], pad: ["dm:drone/machine hum", "dm:ladder/noise pad"], blip: ["dm:hexop/init", "plaits:2", "dm:snarl"], perc: ["dm:halo/trash", "dm:lancet/metal fm", "plaits:10"], vox: ["dm:vox/robot choir", "dm:vox/monk chant"] },
    extras: [1, 3],
    bass: ["a rolling sixteenth line in the gaps between kicks `.xxx.xxx.xxx.xxx`, one note, the filter doing the work", "an offbeat pulse `..x...x...x...x.` on the root", "a three-note phrase five steps long against the bar (track length 5 or 10), a polymeter"],
    harmony: ["minor/phrygian: one root for the whole track, the b2 or b6 the only colour", "minor/harmonic minor: a single minor stab, the same chord throughout, its filter and delay moving", "minor/phrygian: two bass notes a minor third apart, alternating every four bars"],
    angles: ANGLES_AT(0, 1, 3, 4, 6),
    moves: ["a 3-against-4 percussion line (a 12-step track against 16)", "[stab] the stab on a euclid ring, its rotate under a slow LFO", "a hat or ride that enters only at the peak", "reverb on a bus with one percussion hit thrown into it", "a rumble: a siege kick (preset rumble) or a low drone under the kick", "one lane per section on the bass cutoff, each a different shape"],
    avoid: ["a chord progression", "a singable lead melody", "fills every four bars: change by adding and removing layers"],
  },
  trance: {
    swing: [0, 0.04], kits: ["909", "siege-909", "synth"],
    drums: [
      { kick: FOUR, clap: BACK, "open hat": OFF, hat: "xoxoxoxoxoxoxoxo" },
      { kick: FOUR, clap: BACK, "open hat": OFF, ride: "x.x.x.x.x.x.x.x." },
    ],
    core: { bass: ["dm:sub/house sub", "dm:ladder/model d bass", "dm:contagion"], chords: ["dm:contagion", "dm:oracle/strings"], lead: ["dm:contagion", "dm:ladder/vibrato lead"] },
    optional: { arp: ["dm:hexop/bell", "dm:oracle/pulse keys"], pad: ["dm:oracle/warm pad"], vox: ["dm:vox/angel ooh", "dm:vox/choir aah"], riser: ["plaits:9", "dm:halo/reverse swell"] },
    extras: [1, 3],
    bass: ["offbeat eighths `..x...x...x...x.` following the chord roots", "rolling sixteenths between the kicks `.xxx.xxx.xxx.xxx`", "offbeats with an octave on the last `..x...x...x..x.x`"],
    harmony: ["minor: i - bVI - bIII - bVII, one chord a bar or two", "minor: bVI - bVII - i - i", "harmonic minor: i - iv - bVI - V, the major V pulling back to i", "major: I - V - vi - IV"],
    moves: ["contagion unison up (supersaw) on the chords, sidechained from the kick", "the lead melody first heard alone in the break, on a soft sound, then full in the drop", "a snare roll through the build: quarters, eighths, sixteenths, ratchets", "a gated rhythm `x.xxx.xxx.xxx.xx` on the chords", "[arp] the arp a 3-step figure against the bar"],
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
    optional: { pad: ["dm:drone/subterranean", "dm:oracle/warm pad"], lead: ["dm:hexop/bell"], vox: ["dm:vox/whisper", "dm:vox/monk chant"], perc: ["dm:halo/trash", "dm:lancet/tin head"] },
    extras: [1, 2],
    bass: ["the wobble: long notes with a synced LFO on the cutoff, the LFO length changing by section (2 steps, 4 steps, a triplet feel)", "call and response: a growl for two beats, silence or the sub alone for two", "short stabs on a rhythm `x..x..x.....x.x.` with a cutoff lane per step, no LFO"],
    harmony: ["phrygian: one root, the b2 above it for menace", "minor: i - bVI, four bars each, as held chords or implied by the bass", "phrygian: the bass moves i, i, bIII, bII across four bars", "harmonic minor: i - V, the raised seventh in the melody"],
    angles: ANGLES_AT(0, 1, 3, 4, 6),
    moves: ["the sub and the mid bass as two tracks, same notes, the sub clean", "everything out for the beat before the drop", "the snare huge: reverb on it alone, long decay", "[lead] a sparse, reverbed bell melody in the intro that returns in the break", "the second drop on a different LFO length and a different bass rhythm"],
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
    moves: ["[vox] a pitched vox chop answering the snare", "the chords filtered down in the verse and open in the drop", "the bass out for one bar before the drop", "ghost rims at velocity o between the snares", "a nudge (offset) late on the hats on top of the swing"],
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
    optional: { reese: ["dm:contagion", "dm:sub/growl", "dm:snarl"], pad: ["dm:oracle/strings", "dm:oracle/warm pad"], keys: ["dm:tines", "dm:hexop/e.piano"], lead: ["dm:hexop/bell"], vox: ["dm:vox/angel ooh", "dm:vox/soul lead"] },
    extras: [2, 3],
    bass: ["long sub notes, two a bar, following the roots `x_______x_____..`", "a rolling line with a slide into the snare `x_..x_.x_...x_x_`", "a two-note stab pattern that leaves the first beat empty `...x_..x_....x_.`"],
    harmony: ["minor: i min9 - bVI maj7, four bars each", "minor: i - bVII - bVI - bVII", "dorian: i min7 - IV7 with the sub on the roots", "minor/phrygian: one chord: the bass line is the harmony"],
    moves: ["a two-bar drum pattern (length 32) whose second bar ends in a fill", "[pad] pads and keys only in the intro, drums entering with a roll", "[reese] a reese with a slow LFO on the cutoff or the contagion's shape", "the break's snare thrown into a long delay", "the second drop on a displaced kick"],
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
    optional: { lead: ["dm:hexop/bell", "dm:hexop/brass"], vox: ["dm:vox/soul lead", "dm:vox/doo wop"], scratch: ["plaits:7", "plaits:9"], horn: ["dm:breath/horn stabs", "dm:breath/muted trumpet", "dm:breath/tenor sax"] },
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
    optional: { lead: ["dm:hexop/bell", "dm:hexop/marimba", "inst:guitar-nylon"], pad: ["dm:oracle/warm pad"], vox: ["dm:vox/angel ooh", "dm:vox/whisper"], texture: ["dm:drone/glacier", "plaits:9"] },
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
    core: { "808 bass": ["dm:sub/808", "dm:sub/distorted 808", "dm:sub/drill slide", "dm:sub/memphis"], melody: ["dm:hexop/bell", "dm:tines", "inst:guitar-nylon", "dm:oracle/glass"] },
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
    optional: { lead: ["dm:ladder/vibrato lead", "dm:oracle/poly brass", "dm:guitar/singing lead"], arp: ["dm:oracle/pulse keys", "dm:hexop/bell"], vox: ["dm:vox/robot choir", "dm:vox/angel ooh"], bell: ["dm:oracle/glass"] },
    extras: [2, 3],
    bass: ["driving eighths on the root `x.x.x.x.x.x.x.x.`, the octave on the last", "sixteenths with an accent pattern `XxxxXxxxXxxxXxXx`", "an octave bounce, low then high `x.x.x.x.x.x.x.x.` alternating notes"],
    harmony: ["minor: i - bVI - bIII - bVII", "minor: bVI - bVII - i - i", "major: I - vi - IV - V", "dorian: i - IV - bVII - i, the pad holding each for two bars"],
    moves: ["a big gated snare: lancet or a sampled snare with a short loud reverb", "chorus on the chords and the bass", "[arp] an arp of sixteenths across the chord, delay in dotted eighths", "[lead] the lead enters in the second chorus only", "a tom fill into every chorus"],
    avoid: ["swing", "modern sidechain pumping as the main effect", "a dry snare"],
  },
};
// The second batch. Same shape; `bass` is how the FIRST core role plays,
// which is the riff or the chords where that is what leads the genre.
Object.assign(PLANS, {
  "tech-house": {
    swing: [0.06, 0.14], kits: ["909", "synth", "siege-909"],
    drums: [
      { kick: FOUR, clap: BACK, "open hat": OFF, shaker: S16, rim: "..x..x.x..x..x.." },
      { kick: FOUR, clap: "....X.......X..o", hat: "oxXxoxXxoxXxoxXx", tom: ".....x....x....x" },
      { kick: "x...x...x...x..x", clap: BACK, "open hat": OFF, rim: ".x...x..x..x...x" },
    ],
    core: { bass: ["dm:sub/house sub", "dm:ladder/model d bass", "dm:hexop/bass", "dm:sub/growl"] },
    optional: { stab: ["dm:oracle/dirty stab", "dm:hexop/organ", "plaits:6"], vox: ["dm:vox/la la", "dm:vox/robot choir"], perc: ["dm:halo/shaker", "dm:808-cowbell", "dm:lancet/tin head"], riser: ["plaits:9", "dm:halo/reverse swell"] },
    extras: [1, 3],
    bass: ["a rubbery syncopated one-bar riff that IS the hook `..x_.x..x.x_.x..`", "short notes off the kick with one slide a bar `.x.x..x_.x.x.x_.`", "a two-note figure, root and b7, the gaps as important as the notes `..x...x..x.x....`"],
    harmony: ["minor: no chords; one root, the bass riff on 1, b7 and b3", "dorian: one minor stab on the offbeat, the bass moving 1 to 4", "minor: the bass riff moved to bVI for the last two bars of every eight", "minor pentatonic: one root throughout, the riff on 1, b3 and 4"],
    angles: ANGLES_AT(0, 1, 3, 6, 7),
    moves: ["[vox] a chopped vox syllable on a rhythm of its own (short notes, one or two pitches)", "the bass under a cutoff lane that opens into each drop", "a percussion fill (tom or rim ratchets) in the last bar of every eight", "the kick out for the last two beats before the drop", "[riser] a filtered noise sweep rising through the build"],
    avoid: ["lush chords or pads", "a long melodic lead", "a bass that only plays roots on the beat"],
  },
  "afro-house": {
    swing: [0.04, 0.12], kits: ["synth", "siege-909", "909"],
    drums: [
      { kick: FOUR, shaker: S16, tom: "..x..x....x.x...", rim: "x..x..x...x.x..." },
      { kick: FOUR, clap: "....x.......x...", tom: ".x..x..x.x..x.x.", "open hat": OFF },
      { kick: FOUR, shaker: "x.xxx.xxx.xxx.xx", rim: "..x...x..x....x.", tom: "x.....x....x...." },
    ],
    core: { bass: ["dm:sub/house sub", "dm:hexop/bass", "dm:bass/dub"], mallet: ["dm:hexop/marimba", "plaits:12", "dm:hexop/bell", "inst:guitar-nylon"] },
    optional: { pad: ["dm:oracle/warm pad", "dm:oracle/strings"], chant: ["dm:vox/monk chant", "dm:vox/choir aah", "dm:vox/soul lead"], keys: ["dm:tines", "dm:hexop/e.piano"], bell: ["dm:808-cowbell", "dm:halo/ride bell"] },
    extras: [1, 3],
    bass: ["a deep two-note pulse, long then short `x__..x..x__..x..`", "offbeat notes with a pickup into the bar `..x...x...x..x.x`", "one held root per bar, the percussion doing the moving"],
    harmony: ["minor: i - bVII - bVI - bVII, two bars each", "dorian: i min7 - IV, four bars each", "minor pentatonic: one chord, the mallet pattern outlining it", "minor: i - iv, four bars each"],
    moves: ["percussion tracks of different lengths (12 steps against 16) for a polyrhythm", "a tom or rim on a live euclid ring (5 or 7 pulses over 16)", "the mallet a short repeating pattern whose last note changes every four bars", "a long build that only adds percussion layers", "[chant] the chant in a long reverb on a bus"],
    avoid: ["a snare backbeat", "the kick dropping out often: it rolls", "busy chord changes"],
  },
  "dub-techno": {
    swing: [0, 0.08], kits: ["siege-808", "synth", "cr78"],
    drums: [
      { kick: FOUR, hat: "..o...o...o...o.", rim: "..........x....." },
      { kick: FOUR, hat: "o.x.o.x.o.x.o.x.", clap: "............o..." },
      { kick: FOUR, shaker: "oxoxoxoxoxoxoxox", "open hat": "..x.......x....." },
    ],
    core: { stab: ["dm:oracle/dirty stab", "dm:tines", "dm:hexop/organ", "dm:oracle/pulse keys"], sub: ["dm:sub/dub", "dm:sub/pure sine", "dm:sub/house sub"] },
    optional: { pad: ["dm:drone/glacier", "dm:drone/subterranean"], hiss: ["plaits:9", "dm:drone/machine hum"], blip: ["dm:hexop/bell", "plaits:12"] },
    extras: [0, 2],
    bass: ["one short chord on the offbeat `..x.......x.....`, drowned in delay", "a chord every bar and a half (track length 24), drifting against the kick", "two chords a bar, the second quieter `..X......o......`"],
    harmony: ["minor: one min7 chord for the whole track, the sub on its root", "dorian: one min9 chord; the sub moves to the fourth for eight bars in the middle", "minor: two chords a whole step apart (i and bVII), eight bars each"],
    angles: ANGLES_AT(0, 3, 4, 6),
    moves: ["the stab into a dotted-eighth delay with high feedback and a long reverb, both on a bus", "a slow LFO on the stab's cutoff, 8 or 16 bars long", "delay feedback under a lane that swells at section ends", "cassette or vinyl hiss on the bus", "the kick with its cutoff down: soft, not punchy"],
    avoid: ["a melody", "a full-level clap or snare on the backbeat", "dry sounds: everything but the kick and the sub is wet"],
  },
  "melodic-techno": {
    swing: [0, 0.05], kits: ["synth", "siege-909", "909"],
    drums: [
      { kick: FOUR, clap: BACK, "open hat": OFF, hat: S16 },
      { kick: FOUR, clap: "............X...", hat: "..xo..xo..xo..xo", ride: E8 },
    ],
    core: { bass: ["dm:sub/reese", "dm:ladder/model d bass", "dm:contagion", "dm:sub/house sub"], arp: ["dm:contagion", "dm:oracle/pulse keys", "dm:ladder/percussive", "dm:hexop/bell"], pad: ["dm:oracle/strings", "dm:oracle/warm pad"] },
    optional: { lead: ["dm:ladder/vibrato lead", "dm:contagion"], vox: ["dm:vox/angel ooh", "dm:vox/choir aah"], pluck: ["dm:hexop/marimba"] },
    extras: [0, 2],
    bass: ["rolling sixteenths between the kicks `.xxx.xxx.xxx.xxx` on the chord root", "offbeat eighths `..x...x...x...x.` with an octave at the end of each bar", "one long note a bar under a cutoff lane"],
    harmony: ["minor: i - bVI - bIII - bVII, two bars each", "minor: i - iv - bVI - v", "dorian: i - IV - bVII - i", "harmonic minor: i - bVI - iv - V"],
    moves: ["the arp a 16-step figure whose cutoff opens over 16 bars", "the arp three steps long against the bar (track length 12 or 6)", "a long breakdown: pad and arp alone, the kick returning after a snare roll", "delay on the arp in dotted eighths", "the pad sidechained from the kick"],
    avoid: ["a short dry mix", "a busy drum pattern", "new arp notes every bar: the filter moves, the notes stay"],
  },
  electro: {
    swing: [0, 0.06], kits: ["808", "siege-808", "synth"],
    drums: [
      { kick: "x.....x...x.....", snare: BACK, hat: S16 },
      { kick: "x..x..x...x.x...", clap: BACK, hat: E8, cowbell: ".....x.......x.." },
      { kick: "x.....x..x.x....", snare: "....X.......X.x.", hat: "xxxxxxxxxxxxxxxx", tom: "..............xx" },
    ],
    core: { bass: ["dm:hexop/bass", "dm:ladder/model d bass", "dm:sub/acid", "dm:oracle/unison bass"] },
    optional: { stab: ["dm:oracle/dirty stab", "dm:oracle/poly brass", "plaits:6"], robot: ["dm:vox/robot choir", "plaits:7"], lead: ["dm:ladder/funk lead", "plaits:2", "dm:hexop/init"], pad: ["dm:oracle/strings"], zap: ["plaits:10", "plaits:8"] },
    extras: [1, 3],
    bass: ["a staccato sixteenth riff with rests `x.xx..x.x.xx.x..`, root, b7 and the octave", "a two-bar riff, the second bar answering the first an octave up", "short notes locked to the kick, a run of sixteenths into every fourth bar"],
    harmony: ["minor: one root, the riff on 1, b7 and the octave", "phrygian: i - bII stabs, two bars each", "minor: i - bVII - bVI - bVII", "dorian: one min7 stab; the bass moves 1 to 4"],
    moves: ["the hat in straight machine sixteenths with an accent pattern, no swing", "[robot] a robot vox line on one or two pitches", "tom or cowbell fills by ratchet at the end of every eight bars", "[stab] a string stab that answers the bass every second bar", "the kick and bass alone for the first eight bars"],
    avoid: ["four on the floor", "swing", "warm, soft sounds: this is cold and precise"],
  },
  psytrance: {
    kits: ["synth", "siege-909"],
    drums: [
      { kick: FOUR, snare: BACK, "open hat": OFF, hat: S16 },
      { kick: FOUR, clap: "............X...", "open hat": OFF, hat: "..xx..xx..xx..xx" },
    ],
    core: { bass: ["dm:sub/acid", "dm:sub/house sub", "dm:ladder/model d bass", "dm:hexop/bass"], acid: ["dm:silverbox", "dm:contagion", "dm:ladder/percussive"] },
    optional: { zap: ["plaits:2", "dm:hexop/init", "plaits:8"], pad: ["dm:drone/screamer", "dm:ladder/noise pad"], lead: ["dm:contagion", "dm:snarl"], vox: ["dm:vox/robot choir", "dm:vox/monk chant"] },
    extras: [1, 3],
    bass: ["the rolling bass: three short sixteenths after every kick `.xxx.xxx.xxx.xxx`, one note, short decay, never on the kick", "the same roll with the last sixteenth of each bar an octave up", "kick-bass-bass-bass with a note change every two bars"],
    harmony: ["phrygian: one root; the leads use the b2", "phrygian dominant: one root, the major third and the b2 for the eastern colour", "harmonic minor: one root, a rise to the b2 in the bass for the last bar of every eight", "minor: one root, the acid line implying i and bVII"],
    angles: ANGLES_AT(1, 3, 6),
    moves: ["the acid line with cutoff and reson lanes that differ in every section", "[zap] a delay throw on a zap at the end of every eight bars", "a break with no kick and a rising pitch on a noise or drone track", "the bass cutoff opening a little through each sixteen bars", "a second acid line in triplets (ratchet 3) in the last drop"],
    avoid: ["a bass note on the kick", "swing", "a chord progression"],
  },
  garage: {
    swing: [0.18, 0.3], kits: ["909", "r8", "siege-909"],
    drums: [
      { kick: FOUR, clap: BACK, "open hat": OFF, hat: "x.xox.xox.xox.xo" },
      { kick: "x......x..x.....", snare: BACK, hat: "x.ox..oxx.ox..ox" },
      { kick: "x...x.....x.x...", clap: "....X.......X..o", "open hat": OFF, rim: ".o...o.o.....o.." },
    ],
    core: { bass: ["dm:sub/house sub", "dm:sub/reese", "dm:hexop/bass", "dm:contagion"], chords: ["dm:hexop/organ", "dm:tines", "dm:oracle/pulse keys", "dm:hexop/e.piano"] },
    optional: { vox: ["dm:vox/soul lead", "dm:vox/la la"], bell: ["dm:hexop/bell", "dm:hexop/marimba"], pad: ["dm:oracle/strings", "dm:oracle/warm pad"], shaker: ["dm:halo/shaker"] },
    extras: [1, 2],
    bass: ["a bouncing sub that answers the kick `..x_..x....x_.x.`", "a wobbling long note a bar, an LFO on its cutoff at 1/8", "an organ-style walking line in eighths with one rest a bar"],
    harmony: ["minor: i min9 - iv min9", "minor: i min7 - bVII - bVI maj7, chopped short", "dorian: i min7 - IV7 - i min7 - v min7", "major: I maj7 - vi min7 - ii min7 - V7, organ stabs"],
    moves: ["organ or piano stabs on the offbeats `..x..x....x.x...`", "[vox] a pitched vox chop answering the snare", "the bass out for a bar before the drop", "ghost rims at velocity o", "the chords filtered down in the verse"],
    avoid: ["straight unswung hats", "a bass that plays through the whole bar", "a hard, dry clap: it is crisp but small"],
  },
  "future-bass": {
    kits: ["808", "synth", "siege-808"],
    drums: [
      { kick: "x.........x.....", snare: "........X.......", hat: E8 },
      { kick: "x.....x...x.....", clap: "........X.......", hat: "x.x.x.xxx.x.x.x." },
      { kick: "x..x......x.....", snare: "........X.....o.", hat: OFF },
    ],
    core: { chords: ["dm:contagion", "dm:oracle/poly brass"], bass: ["dm:sub/808", "dm:sub/pure sine", "dm:sub/house sub"] },
    optional: { lead: ["dm:hexop/bell"], vox: ["dm:vox/la la", "dm:vox/angel ooh"], arp: ["dm:oracle/glass", "dm:oracle/pulse keys"], keys: ["dm:tines", "dm:hexop/e.piano"] },
    extras: [1, 2],
    bass: ["big chords on a syncopated rhythm `x..x..x...x.x...`, each swelling in", "chords held a bar each with an LFO on the volume or the cutoff at 1/8 (the wobble)", "stabs that follow the kick, silent between"],
    harmony: ["major: IV - V - vi - I", "major: I - V - vi - IV, maj7 and add9 voicings", "minor: bVI - bVII - i - v", "lydian: I - II - vi, bright and floating"],
    moves: ["the chords sidechained hard from the kick", "[vox] pitched vox chops as the hook, one syllable a note", "[keys] a soft intro on keys with the drop's chords", "a snare roll and a rising noise into the drop", "the supersaw's cutoff opening across the build"],
    avoid: ["four on the floor", "dark, minor-only harmony", "thin chords: unison up, wide"],
  },
  jungle: {
    swing: [0, 0.1], kits: ["breaks", "live"],
    drums: [
      { kick: "x.x.......x.....", snare: "....X..o.o..X...", hat: E8 },
      { kick: "x.........xx....", snare: "....X.....o.X.o.", hat: "x.xxx.x.x.xxx.x." },
      { kick: "x.x....x..x.....", snare: "....X..o....X.oo", ride: E8 },
    ],
    core: { sub: ["dm:sub/pure sine", "dm:sub/dub", "dm:sub/808"] },
    optional: { stab: ["dm:oracle/dirty stab", "dm:hexop/organ", "dm:tines"], pad: ["dm:oracle/strings", "dm:oracle/warm pad"], vox: ["dm:vox/soul lead", "dm:vox/monk chant"], bell: ["dm:hexop/bell", "plaits:12"], reese: ["dm:sub/reese", "dm:contagion"] },
    extras: [2, 3],
    bass: ["a huge sub on long notes, two or three a bar, sliding `x_____..x___x___`", "a reggae-style line that leaves beat 1 empty `...x_.x_..x_....`", "one note held for two bars, then a three-note answer"],
    harmony: ["minor: i - bVI, eight bars each, implied by the sub", "minor: one chord; the sub moves 1, b7, b6", "dorian: i min7 - IV7 organ stabs", "phrygian: one root with the b2 in the bass line"],
    moves: ["the break chopped: a different bar every bar across a 64-step pattern", "snare ratchets (2 to 4) as fills, in different places each section", "the snare thrown into a dub delay at the end of every eight bars", "a break pitched down (note lower on the kit) for the second drop", "[pad] pads alone in the intro, the break entering by itself before the bass"],
    avoid: ["a four on the floor kick", "one drum bar looped for a whole section", "a clean modern mix: it is rough"],
  },
  liquid: {
    swing: [0, 0.08], kits: ["breaks", "live", "synth"],
    drums: [
      { kick: "x.........x.....", snare: BACK, hat: E8, "ghost snare": ".......o.o......" },
      { kick: "x.....x...x.....", snare: "....X..o....X...", hat: "x.xxx.x.x.xxx.x.", ride: "x...x...x...x..." },
    ],
    core: { sub: ["dm:sub/pure sine", "dm:sub/house sub", "dm:bass/motown"], keys: ["dm:tines", "dm:hexop/e.piano", "inst:guitar-nylon"] },
    optional: { pad: ["dm:oracle/strings", "dm:oracle/warm pad"], vox: ["dm:vox/soul lead", "dm:vox/angel ooh"], lead: ["dm:hexop/bell", "inst:guitar-electric", "dm:ladder/whistle"], reese: ["dm:sub/reese"] },
    extras: [1, 3],
    bass: ["a warm rolling line, long notes with a walk into each change `x_____x_x___.x_x`", "roots on long notes, two a bar", "a melodic two-bar line that answers the keys"],
    harmony: ["major: IV maj7 - iii min7 - ii min7 - I maj7", "minor: i min9 - bVI maj7 - bIII maj7 - bVII", "dorian: i min9 - IV9", "major: ii min9 - V13 - I maj9 - vi min7"],
    moves: ["the keys playing a syncopated chord rhythm `x..x..x...x.x...`", "[vox] a vox line of long notes over the drop", "the intro on keys alone, the drums entering with a fill", "a two-bar drum pattern whose second bar ends differently", "[pad] the pad's cutoff opening through the build"],
    avoid: ["harsh or distorted bass", "a four on the floor kick", "minor-only gloom: it is warm"],
  },
  drill: {
    kits: ["808", "siege-808", "synth"],
    drums: [
      { kick: "x.....x..x......", snare: "........X.....X.", hat: "x..x..x.x..x..x." },
      { kick: "x..x......x..x..", clap: "........X.......", hat: "x..x..x.x..x..x.", "open hat": "..............x." },
      { kick: "x.........x.x...", snare: "........X..o....", hat: "x.x..x..x.x..x.." },
    ],
    core: { "808 bass": ["dm:sub/drill slide", "dm:sub/808", "dm:sub/distorted 808"], melody: ["dm:tines", "dm:oracle/strings", "dm:hexop/bell", "inst:guitar-nylon", "dm:vox/choir aah"] },
    optional: { counter: ["dm:hexop/brass", "dm:ladder/whistle"], pad: ["dm:oracle/warm pad", "dm:drone/cathedral"], perc: ["dm:halo/trash", "dm:lancet/tin head"] },
    extras: [0, 2],
    bass: ["a sliding 808: long notes that glide up or down an octave or a fifth at the end of the bar (legato, glide up)", "the 808 on the kick's hits with one fast slide every second bar", "two notes a bar a b2 apart, sliding between them"],
    harmony: ["minor: i - bVI - v", "harmonic minor: i - V, the raised seventh in the melody", "phrygian: i - bII", "minor: i - iv - bVI - v"],
    moves: ["the hats in the 3-3-2 rhythm with ratchet rolls (2 and 3) on one or two steps a bar", "the snare displaced: beat 3, then late in the bar", "the melody a dark two-bar piano or string figure, repeated", "the 808 slide written as a tie into the next note with the track's glide up", "the drums out for the last beat before the hook"],
    avoid: ["a snare on 2 and 4", "straight eighth-note hats", "an 808 that never slides"],
  },
  phonk: {
    kits: ["808", "siege-808"],
    drums: [
      { kick: "x.....x...x.....", clap: "........X.......", hat: E8 },
      { kick: FOUR, clap: BACK, hat: E8, "open hat": OFF },
      { kick: "x..x..x...x..x..", snare: BACK, hat: "xxxxxxxxxxxxxxxx" },
    ],
    core: { "808 bass": ["dm:sub/distorted 808", "dm:sub/memphis", "dm:sub/808"], cowbell: ["dm:hexop/bell", "dm:hexop/marimba"] },
    optional: { vox: ["dm:vox/monk chant", "dm:vox/basso"], pad: ["dm:drone/dark grone", "dm:oracle/strings"], keys: ["dm:tines"], perc: ["dm:808-cowbell", "dm:halo/trash"] },
    extras: [1, 2],
    bass: ["a distorted 808 on the kick's hits, long, sliding into the next", "one 808 note a bar with a fast slide up at the end of every four", "the 808 doubling the cowbell's rhythm an octave or two below"],
    harmony: ["minor: one root; the cowbell melody on 1, b3, 4 and 5", "phrygian: i - bII", "minor: i - bVI - bVII", "minor pentatonic: a four-note cowbell riff, the 808 on the root"],
    angles: ANGLES_AT(1, 3, 4, 6),
    moves: ["the cowbell melody a short, high, repeated riff, tuned to the key", "fuzz or shaper on the 808 and saturation on the whole drum bus", "[vox] a chanted vox on one pitch, low", "hat rolls by ratchet at the end of every second bar", "cassette or vinyl on the melody"],
    avoid: ["a clean, quiet 808", "a long evolving melody", "soft, polished drums"],
  },
  "west-coast": {
    swing: [0.08, 0.2], kits: ["808", "live", "r8"],
    drums: [
      { kick: "x.....x.x.....x.", snare: BACK, hat: E8 },
      { kick: "x..x....x.x.....", clap: BACK, hat: S16 },
      { kick: "x.......x.x..x..", snare: "....X.......X..o", hat: E8, "open hat": "..............x." },
    ],
    core: { bass: ["dm:ladder/model d bass", "dm:hexop/bass", "dm:bass/slap funk", "dm:oracle/unison bass"], whine: ["dm:ladder/whistle", "dm:ladder/funk lead", "dm:ladder/vibrato lead"], keys: ["dm:tines", "dm:hexop/e.piano", "dm:oracle/pulse keys"] },
    optional: { talkbox: ["dm:vox/robot choir", "dm:vox/soul lead"], guitar: ["dm:guitar/funk clean"], strings: ["dm:oracle/strings"] },
    extras: [0, 2],
    bass: ["a fat synth line: root on the one, a syncopated answer, a slide up at the end `x_..x.x_..x_.x_.`", "a two-bar funk riff with an octave pop on the last sixteenth", "long low notes, one a chord, with a grace note below"],
    harmony: ["minor: i min7 - iv min7", "dorian: i min9 - IV9", "minor: i min7 - bVI maj7 - v min7", "mixolydian: I7 - IV7, a funk vamp"],
    moves: ["the whine: a high portamento lead (glide up, mono) holding long notes over the hook", "the lead out in the verse, back for the hook", "chords on the keys with a slow chorus or phaser", "a clap doubled with the snare", "the bass and the kick sharing the one, nothing else"],
    avoid: ["fast hats or trap rolls", "a dark, aggressive mix: it is laid back", "a lead that plays short notes"],
  },
  pop: {
    swing: [0, 0.08], kits: ["synth", "909", "drskit"],
    drums: [
      { kick: "x.....x.x.......", snare: BACK, hat: E8 },
      { kick: FOUR, clap: BACK, "open hat": OFF },
      { kick: "x..x..x.x..x..x.", snare: BACK, hat: E8 },
    ],
    core: { bass: ["dm:bass/modern di", "dm:sub/house sub", "dm:hexop/bass", "dm:ladder/model d bass"], chords: ["dm:tines", "dm:oracle/pulse keys", "dm:guitar/chime", "inst:guitar-acoustic", "dm:oracle/warm pad"], hook: ["dm:vox/soul lead", "dm:vox/la la", "dm:vox/angel ooh"] },
    optional: { lead: ["dm:hexop/bell", "dm:ladder/funk lead"], pad: ["dm:oracle/strings"], guitar: ["dm:guitar/funk clean", "dm:guitar/jangle"], shaker: ["dm:halo/shaker"] },
    extras: [1, 2],
    bass: ["roots in eighths in the chorus, long notes in the verse", "a syncopated line that follows the kick `x_....x.x_......`", "roots on the one with a walk into each chord change"],
    harmony: ["major: I - V - vi - IV", "major: vi - IV - I - V", "minor: i - bVI - bIII - bVII", "major: IV - I - V - vi", "mixolydian: I - bVII - IV"],
    moves: ["the vox hook in the chorus only: a short phrase, sung twice, the second time ending differently", "a pre-chorus that drops the kick and rises", "the verse thin (bass, drums, one chord part), the chorus everything", "a bridge on different chords before the last chorus", "the last chorus with a harmony a third above the hook"],
    avoid: ["the same arrangement in the verse and the chorus", "a hook with new notes every bar", "long instrumental stretches"],
  },
  synthpop: {
    swing: [0, 0.04], kits: ["r8", "cr78", "synth", "909"],
    drums: [
      { kick: "x.....x.x.......", snare: BACK, hat: E8 },
      { kick: FOUR, snare: BACK, hat: S16 },
      { kick: "x...x...x...x.x.", clap: BACK, hat: E8, tom: "............o.xX" },
    ],
    core: { bass: ["dm:ladder/model d bass", "dm:hexop/bass", "dm:oracle/unison bass", "dm:drift"], chords: ["dm:oracle/pulse keys", "dm:oracle/warm pad", "dm:drift", "dm:oracle/strings"], lead: ["dm:ladder/vibrato lead", "dm:oracle/poly brass", "dm:hexop/bell"] },
    optional: { arp: ["dm:oracle/pulse keys", "dm:hexop/marimba"], vox: ["dm:vox/soul lead", "dm:vox/robot choir", "dm:vox/la la"], bell: ["dm:oracle/glass"] },
    extras: [1, 2],
    bass: ["sequenced eighths on the root with the octave on the offbeats `x.x.x.x.x.x.x.x.`", "a sixteenth-note sequence, four notes, repeating", "a syncopated line with a rest on beat 3"],
    harmony: ["minor: i - bVI - bIII - bVII", "major: I - V - vi - IV", "dorian: i - IV - i - bVII", "major: vi - IV - I - V"],
    moves: ["a synth hook of four to six notes that answers the vocal line", "chorus on the chords", "[arp] an arp in sixteenths that enters in the second verse", "a drum machine fill on toms into each chorus", "the lead doubling the hook an octave up in the last chorus"],
    avoid: ["swing", "acoustic or guitar sounds", "a sub-heavy modern low end"],
  },
  rnb: {
    swing: [0.1, 0.24], kits: ["808", "live", "synth"],
    drums: [
      { kick: "x.....x...x.....", snare: BACK, hat: E8 },
      { kick: "x..x......x..x..", clap: BACK, hat: "x.xxx.x.x.x.xxx." },
      { kick: "x.......x.x.....", rim: "....x.......x..o", hat: "x.o.x.o.x.o.x.o.", "open hat": "..............x." },
    ],
    core: { bass: ["dm:sub/pure sine", "dm:sub/808", "dm:bass/motown", "dm:hexop/bass"], keys: ["dm:tines", "dm:hexop/e.piano", "dm:oracle/glass", "inst:guitar-electric"], vox: ["dm:vox/soul lead", "dm:vox/angel ooh", "dm:vox/doo wop"] },
    optional: { pad: ["dm:oracle/warm pad", "dm:oracle/strings"], lead: ["dm:hexop/bell", "inst:guitar-nylon"], harmony: ["dm:vox/choir aah"] },
    extras: [0, 2],
    bass: ["a deep sub: one long note a chord with a slide into the next", "root, then a late answer `x_______..x_.x_.`", "a slow melodic line in the gaps of the vocal"],
    harmony: ["major: I maj9 - iii min7 - IV maj9 - V11", "minor: i min9 - iv min9 - bVII13", "dorian: i min9 - IV13", "major: IV maj7 - iii min7 - ii min7 - I maj7"],
    angles: ANGLES_AT(0, 2, 3, 5),
    moves: ["chords voiced wide with ninths, strummed or rolled (strum)", "the vox in long notes with a second vox answering in the gaps", "hat rolls by ratchet, sparingly", "the drums out for a bar before the hook", "a nudge late on the snare or rim for a lazy feel"],
    avoid: ["fast, busy drums", "bright hard synths", "triads: every chord has a seventh or ninth"],
  },
  "new-jack-swing": {
    swing: [0.2, 0.32], kits: ["r8", "808", "909"],
    drums: [
      { kick: "x.....x...x..x..", snare: BACK, clap: BACK, hat: S16 },
      { kick: "x..x..x...x.....", snare: "....X.......X..o", hat: "x.xxx.xxx.xxx.xx", "open hat": "......x.......x." },
      { kick: "x.....xx..x...x.", clap: BACK, hat: S16, rim: "..o.......o..o.." },
    ],
    core: { bass: ["dm:ladder/model d bass", "dm:hexop/bass", "dm:oracle/unison bass"], stabs: ["dm:hexop/brass", "dm:oracle/poly brass", "dm:hexop/organ", "dm:oracle/dirty stab"], keys: ["dm:tines", "dm:hexop/e.piano", "dm:oracle/pulse keys"] },
    optional: { vox: ["dm:vox/soul lead", "dm:vox/doo wop"], harmony: ["dm:vox/choir aah"], bell: ["dm:hexop/bell"], perc: ["dm:808-cowbell", "dm:halo/shaker"] },
    extras: [1, 2],
    bass: ["a syncopated sixteenth riff that locks with the kick and leaves the snare alone `x..x..x...x..x..`", "short punchy notes with an octave pop before the snare `x...x.x...x..xx.`", "a two-bar riff, the second bar walking up into the next chord"],
    harmony: ["minor: i min7 - iv min7", "dorian: i min9 - IV9", "minor: i min7 - bVI maj7 - bVII7", "mixolydian: I7 - bVII - IV"],
    angles: ANGLES_AT(1, 2, 5, 7),
    moves: ["the stabs short and hard on the offbeats right after the snare, one chord shape moved around", "the snare gated: reverb with a short decay, or a clap layered on it", "a two-bar drum break with the kick doubled and a tom fill by ratchet", "[vox] a short vox hook answered by a brass stab", "the bass and the kick together on the one, then the bass off the grid"],
    avoid: ["a straight, unswung hat", "soft, washy drums: it is hard and punchy", "long held pad chords"],
  },
  "miami-bass": {
    swing: [0, 0.08], kits: ["808", "siege-808"],
    drums: [
      { kick: "x.....x...x.....", clap: BACK, hat: S16 },
      { kick: "x..x..x...x..x..", clap: "....X.......X...", hat: E8, "open hat": OFF },
      { kick: "x.....x.x.x.....", snare: BACK, clap: BACK, hat: "x.xxx.x.x.xxx.x." },
    ],
    core: { boom: ["dm:sub/808", "dm:sub/distorted 808", "dm:siege"], stab: ["dm:oracle/dirty stab", "dm:hexop/brass"] },
    optional: { vox: ["dm:vox/robot choir", "dm:vox/monk chant", "dm:vox/soul lead"], perc: ["dm:808-cowbell"], lead: ["dm:ladder/whistle", "dm:snarl"], acid: ["dm:silverbox"] },
    extras: [1, 3],
    bass: ["the boom on the kick's hits, long, sliding down a fifth at the end of every second bar", "one long 808 a bar, pitched to the chord, with a short answer before the snare", "the 808 doubling the kick pattern, the last note dropping an octave"],
    harmony: ["minor: one root, the stabs on i and bVII", "minor: i - bVI - bVII", "phrygian: i - bII", "minor pentatonic: a four-note stab riff"],
    angles: ANGLES_AT(1, 4, 6, 7),
    moves: ["drive or fuzz on the 808 so its harmonics carry on a small speaker", "hat rolls by ratchet into every fourth bar", "[vox] a chanted two-word call answered by itself an octave lower", "[perc] the cowbell on a syncopated euclid ring", "the drums out for a bar with only the boom ringing"],
    avoid: ["a thin or short kick", "swing on the hats", "busy chord changes"],
  },
  "florida-breaks": {
    swing: [0, 0.1], kits: ["breaks", "808", "siege-808"],
    drums: [
      { kick: "x.....x...x..x..", snare: BACK, hat: S16 },
      { kick: "x..x......x.....", snare: "....X..o....X...", hat: "x.xxx.x.x.xxx.x.", "open hat": "......x.......x." },
      { kick: "x.x.......x..x..", clap: BACK, hat: E8, "open hat": OFF },
    ],
    core: { bass: ["dm:sub/808", "dm:sub/reese", "dm:ladder/model d bass", "dm:hexop/bass"] },
    optional: { stab: ["dm:oracle/dirty stab", "dm:oracle/poly brass", "dm:hexop/organ"], acid: ["dm:silverbox"], vox: ["dm:vox/soul lead", "dm:vox/robot choir"], perc: ["dm:808-cowbell"], lead: ["dm:ladder/funk lead", "dm:contagion"] },
    extras: [1, 3],
    bass: ["a booming 808 that slides between the kick's hits `x_....x_..x_.x_.`", "a funky sixteenth riff on two notes with an octave pop", "a rolling line that leaves the snare clear"],
    harmony: ["minor: one root, a rave stab on i", "dorian: i7 - IV7", "minor: i - bVII - bVI - bVII", "mixolydian: I7 - bVII"],
    moves: ["808 kicks layered under the break's kick", "[stab] a funky stab answering the snare on the offbeat", "[acid] an acid line in the second drop, cutoff lane rising", "[perc] cowbell on the offbeats in the drop", "a filter sweep over the drum bus into each drop"],
    avoid: ["a four on the floor kick", "a dark, menacing mix: it is sunny and funky", "a thin bass"],
  },
  rock: {
    kits: ["salamander", "drskit"],
    drums: [
      { kick: "x.....x.x.......", snare: BACK, hat: E8 },
      { kick: "x...x.....x.x...", snare: BACK, ride: E8 },
      { kick: "x..x..x...x.....", snare: "....X.......X.o.", "open hat": "x...x...x...x..." },
    ],
    core: { guitar: ["dm:guitar/brit stack", "dm:guitar/grunge", "dm:guitar/blues burn", "dm:guitar/jangle"], bass: ["dm:bass/svt fingers", "dm:bass/pick grind", "dm:bass/pop punk", "inst:bass-electric"] },
    optional: { lead: ["dm:guitar/singing lead", "dm:guitar/fuzz lead"], organ: ["dm:hexop/organ", "dm:tines"], vox: ["dm:vox/soul lead", "dm:vox/basso"], acoustic: ["inst:guitar-acoustic"] },
    extras: [0, 2],
    bass: ["power chords (root and fifth) in driving eighths, palm-muted in the verse and open in the chorus", "a riff: a one-bar figure on the low strings, repeated, with a chord on the last beat", "chords hit on a syncopated rhythm `x..x..x.x.......` and left to ring"],
    harmony: ["major: I - IV - V - IV", "minor: i - bVII - bVI - bVII", "mixolydian: I - bVII - IV - I", "minor pentatonic: a riff on 1, b3, 4 and b7 with power chords under it", "major: vi - IV - I - V"],
    angles: ANGLES_AT(0, 1, 2, 4),
    moves: ["a crash on the first beat of every section", "a tom and snare fill in the last bar of every eight", "the bass locked to the kick, on the guitar's roots", "the verse on the hat, the chorus on the ride or open hat", "[lead] a guitar solo over the verse chords"],
    avoid: ["drum machine sounds", "every hit at one velocity: ghost notes and accents", "synth pads carrying the song"],
  },
  punk: {
    kits: ["salamander", "drskit"],
    drums: [
      { kick: "x.....x.x.....x.", snare: BACK, hat: E8 },
      { kick: "x..x....x..x....", snare: BACK, hat: E8 },
      { kick: FOUR, snare: "..X...X...X...X.", ride: E8 },
    ],
    core: { guitar: ["dm:guitar/brit stack", "dm:guitar/grunge"], bass: ["dm:bass/pop punk", "dm:bass/pick grind"] },
    optional: { lead: ["dm:guitar/fuzz lead", "dm:guitar/singing lead"], vox: ["dm:vox/soul lead", "dm:vox/basso"], "second guitar": ["dm:guitar/brit stack", "dm:guitar/jangle"] },
    extras: [0, 2],
    bass: ["power chords in straight downstroke eighths `x.x.x.x.x.x.x.x.`, one chord a bar", "chords in sixteenths, muted, opening on the change", "a stop-start riff: three pushed hits, then eighths `x..x..x.x.x.x.x.`"],
    harmony: ["major: I - IV - V", "major: I - V - vi - IV", "minor: i - bVI - bVII", "mixolydian: I - bVII - IV"],
    angles: ANGLES_AT(0, 1, 4, 7),
    forms: ["intro 4 | verse 8 | chorus 8 | verse 8 | chorus 8 | bridge 4 | chorus 8 | outro 2", "intro 2 | verse 8 | chorus 4 | verse 8 | chorus 4 | solo 8 | chorus 8 | outro 2", "chorus 8 | verse 8 | chorus 8 | break 4 | verse 8 | chorus 8 | chorus 8"],
    moves: ["the bass in pumping eighths on the roots", "a full stop (everything silent for a beat) before the last chorus", "a crash on every chord change in the chorus", "a four-click or snare count-in as the intro", "the bridge on half-time drums"],
    avoid: ["long sections: it is over in two minutes", "clean guitars", "slow builds"],
  },
  metal: {
    kits: ["drskit", "salamander"],
    drums: [
      { kick: "xxxxxxxxxxxxxxxx", snare: BACK, crash: "x...x...x...x..." },
      { kick: "x.xx..x.x.xx..x.", snare: BACK, hat: E8 },
      { kick: "x.x...xx..x.x...", snare: "........X.......", crash: "x...x...x...x..." },
    ],
    core: { guitar: ["dm:guitar/scooped metal", "dm:guitar/djent chug", "dm:guitar/brit stack"], bass: ["dm:bass/pick grind", "dm:bass/growl", "dm:bass/svt fingers"] },
    optional: { lead: ["dm:guitar/singing lead", "dm:guitar/fuzz lead"], "second guitar": ["dm:guitar/scooped metal", "dm:guitar/djent chug"], choir: ["dm:vox/choir aah", "dm:vox/basso"], strings: ["dm:oracle/strings"] },
    extras: [0, 2],
    bass: ["a palm-muted sixteenth riff on the low root with accents `X.xxX.xxX.xx.X.x`, the kick matching it", "a gallop `x.xxx.xxx.xxx.xx` on the root, a held chord on the last bar of four", "a syncopated chug `x..x..x.x..x.x..` in unison with the kick"],
    harmony: ["phrygian: a riff on the root with the b2, power chords on i, bII and bVII", "minor: i - bVI - bVII", "harmonic minor: i - iv - V, the lead using the raised seventh", "minor: a chugging root, then bIII - bVII - bVI as held chords in the chorus"],
    angles: ANGLES_AT(1, 3, 4),
    moves: ["the kick doubling the guitar riff's rhythm exactly", "the bass doubling the riff an octave down", "a half-time breakdown: snare on beat 3, the riff slower and heavier", "[lead] a harmonised lead (a second line a third above) in the solo", "palm mute up (gtmute) in the verse, open in the chorus"],
    avoid: ["a loose, swung feel", "clean or lightly driven guitar", "a drum part that ignores the riff"],
  },
  funk: {
    swing: [0.04, 0.14], kits: ["live", "salamander", "virtuosity", "synth"],
    drums: [
      { kick: "x..x......x..x..", snare: "....X..o.o..X...", hat: S16 },
      { kick: "x.x.......xx....", snare: "....X.......X..o", hat: "x.xxx.xxx.xxx.xx", "open hat": "......x.......x." },
      { kick: "x.....x..x.x....", snare: "....X..o....X.o.", hat: S16 },
    ],
    core: { bass: ["dm:bass/slap funk", "dm:bass/motown", "dm:ladder/model d bass", "inst:bass-electric"], guitar: ["dm:guitar/funk clean", "inst:guitar-electric"], keys: ["dm:tines", "dm:hexop/organ", "dm:hexop/e.piano"] },
    optional: { horns: ["dm:breath/brass section", "dm:breath/horn stabs", "dm:breath/sax section"], lead: ["dm:ladder/funk lead"], vox: ["dm:vox/soul lead", "dm:vox/doo wop"], perc: ["dm:808-cowbell", "dm:halo/shaker"] },
    extras: [1, 2],
    bass: ["a syncopated sixteenth riff that hits the one hard and leaves holes `X..x.x..x.x_.x..`", "octave pops: low on the beat, the octave on the last sixteenth `x..x..xx..x..x.x`", "a two-bar line, the second bar a fill up the scale"],
    harmony: ["dorian: i min7 - IV7, one bar each or four each", "mixolydian: one dom7 chord for the whole groove, a bVII - IV turnaround every eighth bar", "minor pentatonic: one chord; the riff is the harmony", "dorian: i min7 for twelve bars, then IV7 for four"],
    forms: ["vamp 8 | verse 16 | chorus 8 | verse 16 | chorus 8 | breakdown 8 | chorus 8 | vamp 8", "intro 4 | groove 16 | bridge 8 | groove 16 | break 4 | groove 16 | outro 4", "intro 8 | A 16 | B 8 | A 16 | B 8 | solo 16 | B 8 | outro 4"],
    moves: ["the guitar a muted sixteenth scratch with a chord stab on two or three steps `x.xxX.xx.xxxX.xx`, short decay", "[horns] horn stabs that answer the bass at the end of every second bar", "a break: drums alone for four bars", "ghost notes on the snare at velocity o between the backbeats", "everyone hits the one together, then scatters"],
    avoid: ["long held chords", "a bass that plays on every beat", "a quantised, same-velocity drum part"],
  },
  disco: {
    swing: [0, 0.08], kits: ["live", "salamander", "synth", "909"],
    drums: [
      { kick: FOUR, snare: BACK, "open hat": OFF, hat: S16 },
      { kick: FOUR, clap: BACK, "open hat": OFF, tambourine: E8 },
      { kick: FOUR, snare: "....X.......X.oo", hat: "x.xxx.xxx.xxx.xx", "open hat": OFF },
    ],
    core: { bass: ["dm:bass/motown", "dm:bass/slap funk", "inst:bass-electric", "dm:hexop/bass"], guitar: ["dm:guitar/funk clean", "inst:guitar-electric"], strings: ["dm:oracle/strings", "dm:oracle/poly brass"] },
    optional: { keys: ["dm:tines", "dm:hexop/e.piano"], vox: ["dm:vox/soul lead", "dm:vox/choir aah", "dm:vox/la la"], brass: ["dm:breath/brass section", "dm:breath/horn stabs"], perc: ["dm:808-cowbell", "dm:halo/shaker"] },
    extras: [1, 2],
    bass: ["octaves: low on the beat, high on the offbeat `x.x.x.x.x.x.x.x.`", "octaves with a walk into each chord change `x.x.x.x.x.x.xxxx`", "a syncopated line with a rest on beat 2 `x..x..x...x.x.x.`"],
    harmony: ["minor: i min7 - iv min7 - bVII - bIII maj7", "major: I maj7 - vi min7 - ii min7 - V7", "dorian: i min7 - IV7", "minor: iv min7 - bVII7 - bIII maj7 - bVI maj7"],
    forms: ["intro 8 | verse 16 | chorus 8 | verse 16 | chorus 8 | break 8 | chorus 16 | outro 8", "intro 16 | groove 16 | chorus 8 | groove 16 | chorus 8 | breakdown 8 | chorus 16 | outro 8", "intro 4 | chorus 8 | verse 16 | chorus 8 | break 8 | build 8 | chorus 16 | outro 4"],
    moves: ["string lines that rise into each chorus and hold a high note through it", "the guitar a muted sixteenth chop on the top strings", "a breakdown to kick, hats and bass, parts returning one by one", "a snare or tom fill into every eighth bar", "the open hat on every offbeat, all the way through"],
    avoid: ["a dark or minimal mix: it is full and bright", "a kick that drops out outside the breakdown", "swing on the hats"],
  },
  reggaeton: {
    kits: ["808", "synth", "909"],
    drums: [
      { kick: FOUR, snare: "...X..X....X..X.", hat: E8 },
      { kick: FOUR, rim: "...x..x....x..x.", clap: "......X.......X.", hat: S16 },
      { kick: "x...x...x...x..x", snare: "...X..X....X..X.", shaker: "x.xxx.xxx.xxx.xx" },
    ],
    core: { bass: ["dm:sub/808", "dm:sub/house sub", "dm:sub/pure sine"], hook: ["dm:hexop/marimba", "inst:guitar-nylon", "dm:hexop/bell", "dm:oracle/pulse keys"] },
    optional: { pad: ["dm:oracle/warm pad", "dm:oracle/strings"], vox: ["dm:vox/soul lead", "dm:vox/la la"], keys: ["dm:tines"], brass: ["dm:breath/brass section", "dm:hexop/brass"] },
    extras: [1, 2],
    bass: ["long sub notes on the roots, one or two a bar, following the kick", "the sub on the dembow's accents `x..x..x.x..x..x.`", "a root held for the bar with a slide up on the last beat"],
    harmony: ["minor: i - bVI - bIII - bVII", "minor: i - iv - bVII - bIII", "harmonic minor: i - iv - V - i", "minor: bVI - bVII - i - i"],
    moves: ["the dembow never stops: the kick on every beat, the snare on its two pushes", "a plucked hook of four to eight notes, repeated, its rhythm syncopated against the dembow", "the drums out except the snare pattern for the intro", "a filtered version of the hook in the verse, open in the chorus", "a roll of snare ratchets into each chorus"],
    avoid: ["a snare on 2 and 4", "swing", "a busy bass"],
  },
  afrobeats: {
    swing: [0.05, 0.15], kits: ["synth", "808", "live"],
    drums: [
      { kick: "x.....x...x..x..", rim: "...x..x....x..x.", shaker: S16 },
      { kick: "x..x....x..x....", snare: "....x.......x...", tom: "..x..x....x..x..", hat: E8 },
      { kick: "x.....x.x.....x.", clap: BACK, shaker: "x.xxx.xxx.xxx.xx", rim: "..x....x..x....x" },
    ],
    core: { bass: ["dm:sub/house sub", "dm:bass/motown", "dm:hexop/bass", "dm:sub/808"], pluck: ["inst:guitar-nylon", "dm:guitar/chime", "dm:hexop/marimba", "inst:guitar-electric"] },
    optional: { keys: ["dm:tines", "dm:hexop/e.piano", "dm:oracle/glass"], vox: ["dm:vox/soul lead", "dm:vox/la la", "dm:vox/choir aah"], pad: ["dm:oracle/warm pad"], horn: ["dm:breath/tenor sax", "dm:breath/trumpet", "dm:breath/brass section"], bell: ["dm:808-cowbell", "dm:halo/ride bell"] },
    extras: [1, 3],
    bass: ["a warm bouncing line that pushes ahead of the beat `x..x..x_..x..x_.`", "long notes on the roots with a two-note pickup into each bar", "a sparse line, two notes a bar, leaving the percussion room"],
    harmony: ["major: I - V - vi - IV", "major: IV - I - V - vi", "minor: i - bVII - bVI - bVII", "dorian: i min7 - IV"],
    moves: ["a bright guitar or mallet line of interlocking sixteenths, two bars long", "[vox] a vox hook answered by the pluck", "log-drum style tom hits tuned to the key", "the kick thinning to the first beat only in the verse", "shaker and rim carrying the groove when the kick drops"],
    avoid: ["a four on the floor kick", "a heavy, dark mix", "a snare on every backbeat at full level"],
  },
  amapiano: {
    swing: [0.06, 0.16], kits: ["synth", "siege-808", "909"],
    drums: [
      { kick: FOUR, shaker: S16, clap: "....x.......x...", rim: "..x..x....x..x.." },
      { kick: "x.......x.......", shaker: "x.xxx.xxx.xxx.xx", snare: "......x.......x.", rim: "...x..x...x..x.." },
      { kick: FOUR, shaker: S16, "open hat": OFF, tom: ".....x.....x..x." },
    ],
    core: { "log drum": ["dm:sub/808", "dm:sub/drill slide", "dm:sub/memphis"], keys: ["dm:tines", "dm:hexop/e.piano", "dm:oracle/glass"] },
    optional: { pad: ["dm:oracle/warm pad", "dm:oracle/strings"], vox: ["dm:vox/soul lead", "dm:vox/monk chant", "dm:vox/la la"], whistle: ["dm:ladder/whistle", "dm:breath/flute", "dm:hexop/bell"], bass: ["dm:sub/pure sine"] },
    extras: [1, 2],
    bass: ["syncopated short notes with slides, never on every beat `..x..x_...x.x_..`", "an answer to the shaker with a different second bar `x.....x_..x..x_.`", "sparse hits that leave the first beat empty `...x_.....x_.x..`"],
    harmony: ["minor: i min9 - iv min9", "dorian: i min9 - IV13 - i min9 - v min7", "minor: bVI maj7 - bVII - i min9", "major: ii min9 - V13 - I maj9 - vi min9"],
    forms: ["intro 16 | groove 16 | log drum 16 | break 8 | log drum 16 | outro 8", "intro 8 | keys 16 | build 8 | log drum 16 | keys 8 | log drum 16 | outro 8", "intro 16 | groove 16 | groove 16 | break 16 | log drum 16 | log drum 16 | outro 16"],
    moves: ["the log drum held back: shakers and keys alone for the first sixteen bars", "the log drum melodic: three or four pitches, the pitch drop on every hit", "jazzy piano chords on a lazy syncopated rhythm", "the shaker never stopping, soft and even", "[whistle] a whistle or bell line of long notes over the log drum"],
    avoid: ["a hard kick: it is soft and under the log drum", "the log drum on every sixteenth", "fast changes: sections are long"],
  },
  reggae: {
    swing: [0.08, 0.25], kits: ["live", "virtuosity", "salamander"],
    drums: [
      { kick: "........x.......", rim: "........X.......", hat: E8 },
      { kick: "x.......x.......", snare: "........X.....o.", hat: "x.xox.xox.xox.xo" },
      { kick: FOUR, rim: "........X.......", hat: OFF },
    ],
    core: { bass: ["dm:bass/dub", "dm:bass/motown", "inst:bass-electric", "dm:sub/dub"], skank: ["dm:guitar/funk clean", "inst:guitar-electric", "dm:guitar/chime"], organ: ["dm:hexop/organ", "dm:tines"] },
    optional: { vox: ["dm:vox/soul lead", "dm:vox/doo wop"], horns: ["dm:breath/brass section", "dm:breath/trombone", "dm:breath/tenor sax"], melodica: ["dm:ladder/whistle", "dm:hexop/marimba"], perc: ["dm:halo/shaker", "dm:808-cowbell"] },
    extras: [0, 2],
    bass: ["a melodic line that leaves beat 1 empty `..x_x_..x_..x.x.`", "a heavy two-bar riff of long notes, the last a walk down", "roots and fifths on a lazy rhythm `x_....x_x_......`"],
    harmony: ["major: I - IV, two bars each", "minor: i - bVII", "minor: i - iv - i - v", "major: I - V - vi - IV", "dorian: i - IV"],
    angles: ANGLES_AT(0, 2, 4, 6),
    moves: ["the skank: a short chord on beats 2 and 4 `....x.......x...`, nothing else from the guitar", "the organ bubble: soft sixteenths either side of the skank `..x.x.x...x.x.x.`", "the bass the loudest melodic part", "a drum fill on the rim and toms into each section", "[horns] a horn line in unison, four bars, in the chorus"],
    avoid: ["a kick on beat 1 in a one-drop", "busy guitar or keys", "a thin bass"],
  },
  dub: {
    swing: [0.08, 0.22], kits: ["live", "virtuosity", "cr78"],
    drums: [
      { kick: "........x.......", rim: "........X.......", hat: E8 },
      { kick: FOUR, rim: "........X.......", hat: OFF },
      { kick: "x.......x.......", snare: "........X.......", hat: "x.xox.xox.xox.xo" },
    ],
    core: { bass: ["dm:bass/dub", "dm:sub/dub", "inst:bass-electric"], skank: ["dm:guitar/funk clean", "dm:hexop/organ", "dm:tines"] },
    optional: { horns: ["dm:breath/brass section", "dm:breath/trombone"], melodica: ["dm:ladder/whistle", "dm:hexop/marimba"], siren: ["plaits:2", "dm:ladder/percussive"], vox: ["dm:vox/monk chant", "dm:vox/soul lead"] },
    extras: [1, 2],
    bass: ["a heavy riff of long notes that leaves beat 1 empty `..x_x_..x___....`", "a two-bar line, the second bar almost silent", "roots and fifths, slow, with one slide a bar"],
    harmony: ["minor: i - bVII", "minor: i - iv", "dorian: i - IV", "minor: one chord throughout; the bass riff is the song"],
    forms: ["intro 8 | riddim 16 | drop-out 8 | riddim 16 | dub 16 | outro 8", "intro 4 | riddim 16 | dub 16 | riddim 8 | dub 16 | outro 4", "riddim 16 | drums and bass 8 | riddim 16 | dub 16 | drums and bass 8 | outro 8"],
    moves: ["delay and reverb wets on lanes: a skank or snare hit thrown into a long echo, then dry again", "parts dropping out for whole sections: drums and bass alone", "delay feedback pushed up at a section's end until it nearly runs away", "the snare or rim in a big spring-like reverb on a bus", "a filter sweep (cutoff lane) on the skank"],
    avoid: ["every part playing at once for long", "new melodies: it is one riddim, remixed", "dry, tidy fx"],
  },
  italo: {
    swing: [0, 0.04], kits: ["r8", "cr78", "909", "synth"],
    drums: [
      { kick: FOUR, clap: BACK, "open hat": OFF, hat: S16 },
      { kick: FOUR, snare: BACK, hat: E8, tom: "............o.xX" },
    ],
    core: { bass: ["dm:ladder/model d bass", "dm:hexop/bass", "dm:oracle/unison bass", "dm:drift"], arp: ["dm:oracle/pulse keys", "dm:hexop/bell", "dm:drift"], lead: ["dm:ladder/vibrato lead", "dm:oracle/poly brass"] },
    optional: { pad: ["dm:oracle/strings", "dm:oracle/warm pad"], vocoder: ["dm:vox/robot choir", "dm:vox/la la"], bell: ["dm:oracle/glass"] },
    extras: [1, 2],
    bass: ["octaves in eighths: low on the beat, high on the offbeat `x.x.x.x.x.x.x.x.`", "octaves in sixteenths, low-low-high-low", "the octave line with a three-note walk into each chord change"],
    harmony: ["minor: i - bVI - bVII - i", "harmonic minor: i - iv - bVI - V", "major: I - vi - IV - V", "dorian: i - IV"],
    moves: ["a catchy lead melody of eight bars, simple enough to hum", "an arp in sixteenths across each chord", "[vocoder] a vocoder-like vox on the hook's rhythm", "a tom fill into each chorus", "delay on the lead in eighths"],
    avoid: ["swing", "a dark or heavy mix", "a bass that leaves the octave pattern"],
  },
  chiptune: {
    kits: ["chip"],
    drums: [
      { kick: "x.....x.x.......", snare: BACK, hat: E8 },
      { kick: FOUR, snare: BACK, hat: S16 },
      { kick: "x..x..x.x..x..x.", snare: "....X.......X.xx", hat: E8 },
    ],
    core: { lead: ["plaits:0", "dm:drift", "dm:oracle/pulse keys"], bass: ["plaits:0", "dm:hexop/bass", "dm:ladder/pedal bass"], arp: ["plaits:0", "dm:oracle/pulse keys", "dm:drift"] },
    optional: { harmony: ["plaits:0", "dm:drift"], blip: ["plaits:2", "plaits:10"] },
    extras: [0, 1],
    bass: ["a fast, busy melody in sixteenths and eighths with leaps, eight bars long", "a melody of short phrases with rests, each answered an octave up", "a march-like tune, dotted rhythms `x..xx..xx..xx.x.`"],
    harmony: ["major: I - IV - V - I", "minor: i - bVII - bVI - bVII", "major: I - V - vi - IV", "harmonic minor: i - iv - V - i"],
    angles: ANGLES_AT(1, 2, 7),
    forms: ["intro 4 | A 8 | A 8 | B 8 | A 8 | C 8 | A 8 | outro 4", "intro 2 | A 8 | B 8 | A 8 | B 8 | C 16 | A 8", "A 8 | A' 8 | B 8 | B' 8 | A 8 | outro 4"],
    moves: ["chords as fast arpeggios: one voice running the chord tones in sixteenths or with an arp on the step", "square or pulse waves only: timb (pulse width) changed between sections", "crush on the drums, bits low", "a key change up a whole step for the last section", "an echo: the lead repeated a beat later on a second track, quieter"],
    avoid: ["reverb and long delays", "pads or sustained chords", "more than four voices sounding at once"],
  },
  krautrock: {
    kits: ["live", "salamander", "cr78"],
    drums: [
      { kick: "x.....x.x.....x.", snare: BACK, hat: E8 },
      { kick: FOUR, snare: BACK, hat: E8 },
      { kick: "x...x.x.x...x.x.", snare: BACK, hat: S16 },
    ],
    core: { bass: ["dm:bass/pick grind", "dm:bass/svt fingers", "inst:bass-electric", "dm:ladder/pedal bass"], guitar: ["dm:guitar/jangle", "dm:guitar/chime", "dm:guitar/fuzz lead"] },
    optional: { synth: ["dm:drift", "dm:oracle/strings", "dm:ladder/noise pad"], organ: ["dm:hexop/organ"], drone: ["dm:drone/machine hum", "dm:drone/glacier"], seq: ["dm:oracle/pulse keys"] },
    extras: [1, 3],
    bass: ["pumping eighths on one note `x.x.x.x.x.x.x.x.`, for the whole piece", "a two-note ostinato, root and fifth, never varying", "eighths on the root with the octave on the last beat of every fourth bar"],
    harmony: ["major: one chord (I) for the whole piece", "mixolydian: I, with a move to bVII for four bars in every sixteen", "dorian: i - IV, eight bars each", "major: I - IV, sixteen bars each"],
    angles: ANGLES_AT(0, 5, 6),
    forms: ["intro 8 | groove 16 | groove 16 | lift 16 | groove 16 | peak 16 | outro 8", "fade in 16 | groove 16 | lift 16 | groove 16 | lift 16 | fade out 16", "intro 4 | groove 16 | groove 16 | break 8 | groove 16 | peak 16 | outro 4"],
    moves: ["the motorik beat unchanged from start to finish: no fills", "layers entering one at a time, each staying", "a guitar line of two or three notes repeated with delay", "a slow phaser or flanger on the guitar or synth", "the only change in a section is one part's filter opening"],
    avoid: ["drum fills", "verse and chorus contrast", "chord changes every bar"],
  },
  ambient: {
    layered: true,
    core: { pad: ["dm:oracle/warm pad", "dm:oracle/strings", "dm:vox/angel ooh"], drone: ["dm:drone/cathedral", "dm:drone/subterranean", "dm:drone/reverse tide", "dm:drone/glacier"] },
    optional: { bell: ["dm:hexop/bell", "plaits:12", "dm:oracle/glass"], texture: ["plaits:9", "plaits:3", "plaits:10"], sub: ["dm:sub/pure sine"], keys: ["dm:tines", "inst:guitar-nylon"], choir: ["dm:vox/choir aah", "dm:vox/whisper"] },
    extras: [1, 3],
    bass: ["one chord held per pattern (64 steps), its notes entering one at a time", "two chords crossfading, every note tied across the bar", "slow arpeggiation: one chord tone every beat or two, long release"],
    harmony: ["lydian: I maj7 - II, eight bars each", "major: I maj9 - IV maj9, very slow", "dorian: one min11 chord, the lowest note moving 1, 4, 1, b7", "pentatonic: no chords; a drone on the root and fifth with notes of the scale above", "minor: i - bVI - bIII, sixteen bars for the three"],
    moves: ["a slow LFO (16 bars or longer) on the pad's cutoff", "the reverb long and on a bus, its wet under a lane", "[bell] bell notes placed by a live chance generator, sparse (rest high)", "patterns of different lengths (48 against 64) so nothing lines up twice", "the drone's cloud frozen for a section"],
    avoid: ["a drum kit", "anything on every beat", "short dry sounds"],
  },
  downtempo: {
    swing: [0.08, 0.2], kits: ["live", "breaks", "cr78"],
    drums: [
      { kick: "x.....x...x.....", snare: BACK, hat: "x.o.x.o.x.o.x.o." },
      { kick: "x.......x.x.....", rim: "....x.......x..o", hat: OFF, shaker: S16 },
      { kick: "x..x......x.....", snare: "....X.......X...", hat: E8 },
    ],
    core: { bass: ["dm:sub/pure sine", "dm:bass/dub", "dm:bass/motown", "dm:hexop/bass"], pad: ["dm:oracle/warm pad", "dm:oracle/strings"] },
    optional: { keys: ["dm:tines", "dm:hexop/e.piano"], lead: ["dm:hexop/bell", "inst:guitar-nylon", "dm:ladder/whistle"], vox: ["dm:vox/angel ooh", "dm:vox/whisper"], texture: ["dm:drone/glacier", "plaits:9"], guitar: ["dm:guitar/chime", "inst:guitar-electric"] },
    extras: [1, 3],
    bass: ["a deep slow line: a long root, then a short answer `x_____....x_.x..`", "one note a chord, held", "a dub-style riff that leaves beat 1 empty in the second bar"],
    harmony: ["dorian: i min9 - IV9", "minor: i min7 - bVI maj7", "major: I maj7 - IV maj7", "minor: i min9 - iv min9 - bVII - bIII maj7"],
    angles: ANGLES_AT(0, 2, 3, 5, 6),
    moves: ["a delay in dotted eighths on one melodic part", "the pad under a slow cutoff LFO", "the drums entering after eight bars of pad and bass", "[lead] a melody of long notes with space between phrases", "reverb on a bus, shared by everything but the kick and bass"],
    avoid: ["a fast or busy drum part", "a build and a drop", "bright, hard leads"],
  },
  "trip-hop": {
    swing: [0.12, 0.28], kits: ["breaks", "live"],
    drums: [
      { kick: "x.....x...x.....", snare: BACK, hat: E8 },
      { kick: "x..x......x.....", snare: "....X..o....X...", hat: "x.xxx.x.x.xxx.x." },
      { kick: "x.......x.x.....", snare: "....X.......X.o.", hat: "x.o.x.o.x.o.x.ox" },
    ],
    core: { bass: ["dm:bass/dub", "dm:sub/dub", "dm:bass/motown", "dm:sub/pure sine"], keys: ["dm:tines", "dm:hexop/e.piano", "dm:oracle/strings", "inst:guitar-electric"] },
    optional: { vox: ["dm:vox/whisper", "dm:vox/soul lead", "dm:vox/angel ooh"], strings: ["dm:oracle/strings"], scratch: ["plaits:7", "plaits:9"], lead: ["dm:guitar/rolled off", "dm:hexop/bell", "dm:ladder/whistle"], drone: ["dm:drone/dark grone"] },
    extras: [1, 3],
    bass: ["a slow heavy line: two long notes a bar, the second sliding down", "a root held for a bar, then three notes walking to the next chord", "a dub riff `x_....x_..x_....`, the same for the whole song"],
    harmony: ["minor: i min7 - iv min7", "harmonic minor: i - bVI - V", "phrygian: i - bII", "minor: i min9 - bVI maj7 - iv min7"],
    angles: ANGLES_AT(0, 3, 4, 6),
    moves: ["vinyl crackle and cassette on the drums or the keys", "the drums pitched down and filtered: heavy, not bright", "[vox] a breathy vox of long notes, sparse", "a two-bar figure on the keys looped like a sample", "the drums out for a bar at the end of each eight"],
    avoid: ["a fast tempo feel: the drums drag", "a bright, clean mix", "busy melodies"],
  },
});
// The third batch.
Object.assign(PLANS, {
  chicago: {
    swing: [0.06, 0.16], kits: ["909", "808", "siege-909"],
    drums: [
      { kick: FOUR, clap: BACK, hat: S16, "open hat": OFF },
      { kick: FOUR, snare: "....X..x....X.xx", hat: E8, tom: "..........x..x.." },
      { kick: "x...x...x...x.x.", clap: BACK, "open hat": OFF, cowbell: "x..x..x...x..x.." },
    ],
    core: { bass: ["dm:hexop/bass", "dm:ladder/model d bass", "dm:sub/house sub", "dm:silverbox"], piano: ["dm:tines", "dm:hexop/e.piano", "dm:hexop/organ"] },
    optional: { vox: ["dm:vox/soul lead", "dm:vox/la la", "dm:vox/basso"], strings: ["dm:oracle/strings"], stab: ["dm:oracle/dirty stab", "dm:oracle/poly brass"] },
    extras: [0, 2],
    bass: ["a simple jacking line: the root on the offbeats with one octave jump `..x...x...x..x.x`", "a one-bar riff in eighths, repeated without change", "two notes, root and fifth, in a syncopated rhythm `x..x..x...x.x...`"],
    harmony: ["minor: i - bVII - bVI - bVII, piano stabs", "dorian: i7 - IV7", "major: I - IV, two bars each, gospel piano", "minor: one chord; the bassline is the song"],
    angles: ANGLES_AT(0, 1, 4, 6, 7),
    moves: ["piano chords stabbed on a syncopated rhythm `x..x..x...x.x...`", "[vox] a spoken or sung vox phrase of three or four syllables, repeated all the way through", "a snare or clap roll by ratchet into every eighth bar", "everything out but the kick and the hats for four bars, then back at once", "drum machine sounds dry and loud, a little saturation on the bus"],
    avoid: ["a polished, layered mix: it is raw", "long builds and risers", "more than three melodic parts"],
  },
  "progressive-house": {
    swing: [0, 0.08], kits: ["909", "synth", "siege-909"],
    drums: [
      { kick: FOUR, clap: BACK, "open hat": OFF, hat: S16 },
      { kick: FOUR, clap: "............X...", hat: "..xo..xo..xo..xo", shaker: S16 },
    ],
    core: { bass: ["dm:sub/house sub", "dm:ladder/model d bass", "dm:sub/reese"], arp: ["dm:oracle/pulse keys", "dm:contagion", "dm:hexop/bell"], pad: ["dm:oracle/warm pad", "dm:oracle/strings"] },
    optional: { lead: ["dm:contagion", "dm:ladder/vibrato lead"], vox: ["dm:vox/angel ooh", "dm:vox/soul lead"], piano: ["dm:tines"], riser: ["plaits:9", "dm:halo/reverse swell"] },
    extras: [1, 2],
    bass: ["offbeat eighths `..x...x...x...x.` on the chord roots", "a long note a bar with a short pickup", "rolling sixteenths between the kicks `.xxx.xxx.xxx.xxx`"],
    harmony: ["minor: i - bVI - bIII - bVII, two bars each", "major: vi - IV - I - V", "minor: bVI - bVII - i, four bars on the i", "dorian: i - IV - bVII - IV"],
    forms: ["intro 16 | groove 16 | build 16 | drop 16 | break 16 | build 16 | drop 16 | outro 16", "intro 16 | groove 16 | groove 16 | break 16 | build 8 | drop 16 | drop 16 | outro 16"],
    moves: ["every part enters under a cutoff lane that opens over its first sixteen bars", "the arp's notes fixed, its filter and delay moving", "[piano] the break on piano and pad alone, the chords as the hook", "a long reverb send that rises through each build", "the pad sidechained from the kick"],
    avoid: ["sudden changes: everything fades in or filters in", "a busy bass", "short sections"],
  },
  "french-house": {
    swing: [0.04, 0.12], kits: ["909", "siege-909", "live"],
    drums: [
      { kick: FOUR, clap: BACK, "open hat": OFF, hat: S16 },
      { kick: FOUR, snare: BACK, hat: "x.xxx.xxx.xxx.xx", "open hat": OFF },
    ],
    core: { loop: ["dm:tines", "dm:oracle/strings", "dm:guitar/funk clean", "dm:oracle/poly brass"], bass: ["dm:bass/slap funk", "dm:bass/motown", "dm:hexop/bass", "dm:ladder/model d bass"] },
    optional: { vox: ["dm:vox/robot choir", "dm:vox/soul lead"], guitar: ["dm:guitar/funk clean", "inst:guitar-electric"], strings: ["dm:oracle/strings"], lead: ["dm:ladder/funk lead"] },
    extras: [0, 2],
    bass: ["a two-bar disco chord loop with a syncopated rhythm `x..x..x...x.x.x.`, played as if sampled: the same two bars throughout", "one bar of chords chopped into four stabs, looped", "a four-chord loop, one chord a beat, repeated every bar"],
    harmony: ["dorian: i min7 - IV7", "major: I maj7 - vi min7 - ii min7 - V7", "minor: i min7 - bVII - bVI maj7 - bVII", "mixolydian: I7 - bVII - IV"],
    moves: ["a cutoff lane on the loop: closed and muffled in the intro, opening over sixteen bars, shut again before each drop", "the loop and bass sidechained hard from the kick so the whole track pumps", "a phaser on the loop", "the kick out while the filter closes, back when it opens", "[vox] a vocoder vox of one phrase, repeated"],
    avoid: ["new chords in each section: it is one loop, filtered", "a static filter", "a dry, unpumped mix"],
  },
  minimal: {
    swing: [0.04, 0.14], kits: ["synth", "cr78", "siege-909"],
    drums: [
      { kick: FOUR, hat: "..o...o...o...o.", rim: "......x......x.." },
      { kick: FOUR, clap: "....o.......o...", hat: "oxoxoxoxoxoxoxox", click: ".x.....x..x....." },
      { kick: FOUR, shaker: "x.ox..oxx.ox..ox", rim: "...x......x....." },
    ],
    core: { bass: ["dm:sub/house sub", "dm:hexop/bass", "dm:sub/pure sine", "dm:ladder/pedal bass"] },
    optional: { blip: ["plaits:2", "dm:hexop/bell", "plaits:12", "dm:hexop/marimba"], stab: ["dm:oracle/dirty stab", "dm:tines"], texture: ["plaits:10", "plaits:9", "plaits:3"], vox: ["dm:vox/whisper", "dm:vox/robot choir"] },
    extras: [1, 3],
    bass: ["a tiny motif of two or three notes with long gaps `..x.....x.x.....`", "one note, twice a bar, its length changing between sections", "a three-step figure against the bar (track length 12)"],
    harmony: ["minor: one root; a b7 or b3 as the only other note", "dorian: one min7 stab every two bars", "minor pentatonic: a three-note motif, nothing else tonal", "phrygian: the root and the b2, alternating every eight bars"],
    angles: ANGLES_AT(0, 3, 6, 7),
    moves: ["one small change every eight bars and nothing more: a hat added, a note moved", "percussion tracks of odd lengths (5, 7, 12) drifting against the kick", "[blip] a delay throw on a single blip at the end of a phrase", "a click or rim on a live euclid ring with its rotate under a slow LFO", "the bass cutoff moving by a lane over thirty-two bars"],
    avoid: ["chords and pads", "big builds, risers and drops", "filling the gaps: the space is the track"],
  },
  detroit: {
    swing: [0, 0.1], kits: ["909", "808", "siege-909"],
    drums: [
      { kick: FOUR, clap: BACK, "open hat": OFF, hat: S16 },
      { kick: FOUR, snare: "....x.......x..x", hat: E8, ride: E8, tom: ".......x.....x.." },
      { kick: "x...x...x...x..x", clap: BACK, hat: "x.xxx.xxx.xxx.xx", rim: "..x..x....x..x.." },
    ],
    core: { strings: ["dm:oracle/strings", "dm:oracle/warm pad"], bass: ["dm:hexop/bass", "dm:ladder/model d bass", "dm:sub/house sub"], lead: ["dm:hexop/bell", "dm:oracle/pulse keys", "dm:hexop/marimba", "dm:ladder/percussive"] },
    optional: { stab: ["dm:oracle/dirty stab", "dm:hexop/organ"], vox: ["dm:vox/robot choir"], arp: ["dm:oracle/glass"] },
    extras: [0, 2],
    bass: ["string chords held two bars each, hopeful, high in the register", "strings stabbed on a syncopated rhythm `x..x..x.....x...` with a long release", "one chord swelling in over each bar"],
    harmony: ["minor: i min7 - bVI maj7 - bVII", "dorian: i min9 - IV", "major: IV maj7 - iii min7 - vi min7", "minor: i min7 - iv min7 - bVII - bIII maj7"],
    moves: ["a melodic lead of short notes, syncopated, answered by the strings", "the bassline a busy machine sequence in sixteenths", "tom fills by the drum machine at the end of every eight bars", "the strings alone for the intro", "delay on the lead"],
    avoid: ["a dark, tuneless track: the chords carry feeling", "long risers and big drops", "heavy distortion"],
  },
  berlin: {
    kits: ["synth", "siege-909"],
    drums: [
      { kick: FOUR, hat: "..x...x...x...x.", clap: "............o..." },
      { kick: FOUR, "open hat": OFF, hat: "oxoxoxoxoxoxoxox", ride: E8 },
      { kick: FOUR, rim: "...x..x...x..x..", hat: "..xo..xo..xo..xo" },
    ],
    core: { rumble: ["dm:sub/reese", "dm:sub/growl", "dm:drone/subterranean", "dm:sub/dub"] },
    optional: { loop: ["plaits:2", "dm:hexop/init", "plaits:8", "dm:snarl"], texture: ["dm:drone/machine hum", "plaits:9", "plaits:10"], stab: ["dm:oracle/dirty stab", "plaits:6"], perc: ["dm:halo/trash", "dm:lancet/metal fm", "dm:halo/gong"] },
    extras: [1, 3],
    bass: ["a low rumble in the gaps between kicks `.xxx.xxx.xxx.xxx`, one note, dark, long reverb filtered low", "a sustained low note that swells between kicks (sidechained from the kick)", "offbeat sub pulses `..x...x...x...x.` into a reverb on a bus"],
    harmony: ["minor: one root, nothing else tonal", "phrygian: the root with a b2 in a high percussive loop", "minor: one root; a tritone above it in the loop"],
    angles: ANGLES_AT(0, 1, 3, 6),
    moves: ["the kick on dm:siege preset rumble or with a long decay, the heaviest thing in the mix", "percussion in a big dark reverb on a bus, the reverb lowpassed", "[loop] a short atonal loop of three or five steps repeating against the bar", "one filter opening over thirty-two bars as the only development", "a hat that enters after sixteen bars and never leaves"],
    avoid: ["melody and chord changes", "bright, clean sounds", "breakdowns with pads"],
  },
  "hard-techno": {
    kits: ["synth", "siege-909"],
    drums: [
      { kick: FOUR, "open hat": OFF, clap: BACK, hat: S16 },
      { kick: FOUR, "open hat": OFF, ride: E8, snare: "............X.xx" },
      { kick: "x...x...x...x.xx", "open hat": OFF, clap: BACK, hat: "xxxxxxxxxxxxxxxx" },
    ],
    core: { bass: ["dm:sub/distorted 808", "dm:sub/growl", "dm:sub/reese"] },
    optional: { acid: ["dm:silverbox", "dm:sub/acid"], stab: ["dm:oracle/dirty stab", "dm:contagion", "dm:snarl"], screech: ["plaits:2", "dm:snarl", "dm:drone/screamer"], vox: ["dm:vox/robot choir", "dm:vox/monk chant"] },
    extras: [1, 3],
    bass: ["a rumble: sixteenths between the kicks `.xxx.xxx.xxx.xxx`, distorted", "offbeat bass hits `..x...x...x...x.`, short and hard", "the kick's own tail as the bass: a long distorted kick, no separate line in the verse"],
    harmony: ["minor: one root", "phrygian: the root and the b2, a rave stab on both", "harmonic minor: a stab moving i - bVI - V"],
    angles: ANGLES_AT(1, 3, 4),
    moves: ["the kick on dm:siege with the clip drive up: distorted, long, loud", "[stab] a rave stab on a syncopated rhythm `x..x..x...x.x...`", "[acid] an acid line with the resonance high, its cutoff on a lane", "a snare roll and a one-bar silence before the drop", "fast offbeat open hats all the way through"],
    avoid: ["a soft or round kick", "swing", "long melodic sections"],
  },
  hardstyle: {
    kits: ["synth", "siege-909"],
    drums: [
      { kick: FOUR, clap: BACK, "open hat": OFF },
      { kick: FOUR, snare: BACK, hat: S16, "open hat": OFF },
    ],
    core: { lead: ["dm:contagion", "dm:snarl"], bass: ["dm:sub/distorted 808", "dm:sub/growl"] },
    optional: { pad: ["dm:oracle/strings"], vox: ["dm:vox/choir aah", "dm:vox/angel ooh"], pluck: ["dm:hexop/bell"], screech: ["plaits:2", "dm:snarl"] },
    extras: [1, 2],
    bass: ["a euphoric melody in eighths and quarters, eight bars, wide supersaw", "a melody of long notes over fast chord changes", "a call and answer: a four-note phrase, then its answer a third higher"],
    harmony: ["minor: i - bVI - bIII - bVII", "minor: bVI - bVII - i - i", "harmonic minor: i - bVI - iv - V", "major: vi - IV - I - V"],
    forms: ["intro 16 | break 16 | build 8 | drop 16 | break 16 | build 8 | drop 16 | outro 8", "intro 8 | drop 16 | break 16 | build 8 | drop 16 | outro 8"],
    angles: ANGLES_AT(1, 2, 5),
    moves: ["the kick on dm:siege preset hard trance or gabber: distorted, with a pitched tail tuned to the root", "the reverse bass: the bass on the offbeats `..x...x...x...x.`, between the kicks", "the melody first played softly in the break, then full in the drop", "a snare roll through the build, the kick out for its last bar", "[screech] a screech answering the melody in the second drop"],
    avoid: ["a clean kick", "a drop without the break's melody", "swing"],
  },
  gabber: {
    kits: ["synth", "siege-909"],
    drums: [
      { kick: FOUR, "open hat": OFF, clap: BACK },
      { kick: "x...x...x...x.xx", "open hat": OFF, snare: "............X..." },
      { kick: "x.x.x...x.x.x...", "open hat": OFF, clap: BACK },
    ],
    core: { stab: ["dm:oracle/dirty stab", "dm:contagion", "dm:snarl"] },
    optional: { bass: ["dm:sub/distorted 808"], screech: ["plaits:2", "dm:drone/screamer"], vox: ["dm:vox/robot choir", "dm:vox/basso"], lead: ["dm:contagion"] },
    extras: [0, 2],
    bass: ["a crunchy stab on the offbeats `..x...x...x...x.`", "a hoover-style riff of four notes in eighths", "stabs on a syncopated rhythm `x..x..x...x.x...`, one chord"],
    harmony: ["minor: one minor chord, the stab on it throughout", "phrygian: i - bII", "minor: i - bVII - bVI - bVII, one bar each", "harmonic minor: i - V"],
    forms: ["intro 8 | drop 16 | break 8 | drop 16 | break 4 | drop 16 | outro 4", "intro 4 | drop 16 | drop 16 | break 8 | build 4 | drop 16 | outro 4"],
    angles: ANGLES_AT(1, 4),
    moves: ["the kick on dm:siege preset gabber: the clipped kick's tail IS the bass", "the kick pitched to the root, and up a step for the last bar of every eight", "a kick roll by ratchet (2 to 4) into each drop", "crush or fuzz on the stab", "the break is four or eight bars and no longer"],
    avoid: ["a separate deep sub under the kick", "slow builds", "anything gentle"],
  },
  eurodance: {
    kits: ["909", "synth", "r8"],
    drums: [
      { kick: FOUR, clap: BACK, "open hat": OFF, hat: S16 },
      { kick: FOUR, snare: BACK, "open hat": OFF, tom: "............o.xX" },
    ],
    core: { bass: ["dm:hexop/bass", "dm:ladder/model d bass", "dm:oracle/unison bass"], riff: ["dm:contagion", "dm:oracle/poly brass", "dm:hexop/bell"], chords: ["dm:tines", "dm:oracle/strings", "dm:hexop/organ"] },
    optional: { vox: ["dm:vox/soul lead", "dm:vox/la la", "dm:vox/choir aah"], pad: ["dm:oracle/warm pad"], rap: ["dm:vox/basso", "dm:vox/robot choir"] },
    extras: [1, 2],
    bass: ["offbeat eighths on the roots `..x...x...x...x.`", "the offbeat line with an octave on the last eighth of each bar", "sixteenths low-low-high-low on the root"],
    harmony: ["minor: i - bVI - bIII - bVII", "minor: i - bVII - bVI - bVII", "major: I - V - vi - IV", "harmonic minor: i - iv - V - i"],
    moves: ["a synth riff of eight notes that is the chorus", "piano or organ chords stabbed on the offbeats", "the verse with the riff out and the bass alone under the drums", "a tom fill into every chorus", "[vox] the vox doubling the riff in the last chorus"],
    avoid: ["a dark, sparse mix", "swing", "a chorus without the riff"],
  },
  brostep: {
    kits: ["synth", "siege-808", "808"],
    drums: [
      { kick: "x.........x.....", snare: "........X.......", hat: E8 },
      { kick: "x.....x...x.....", snare: "........X.......", hat: "x.x.x.xxx.x.x.x." },
      { kick: "x..x......x..x..", snare: "........X.....xx", hat: OFF },
    ],
    core: { growl: ["dm:contagion", "dm:sub/growl", "dm:snarl", "dm:sub/distorted 808"], sub: ["dm:sub/pure sine", "dm:sub/808"] },
    optional: { screech: ["plaits:2", "dm:drone/screamer", "dm:contagion"], lead: ["dm:contagion"], pad: ["dm:oracle/strings"], vox: ["dm:vox/robot choir", "dm:vox/choir aah"], riser: ["plaits:9", "dm:halo/reverse swell"] },
    extras: [1, 3],
    bass: ["bass edits: a different sound every beat or half beat, by cutoff and shape lanes with a value per step", "a growl for two beats, a screech or silence for two", "a rhythm of stabs `x.xx..x.x...x.x.` with fast LFOs (1/16, 1/8 triplet) on the cutoff"],
    harmony: ["minor: one root", "phrygian: i - bII, two bars each", "harmonic minor: i - bVI - V in the intro and break only", "minor: the bass moves i, i, bIII, bII"],
    angles: ANGLES_AT(1, 3, 4),
    moves: ["a melodic, almost pretty intro before a violent drop", "one beat of silence before the drop", "fuzz, shaper or fold drive on the growl, with the sub kept clean on its own track", "the second drop a different bass rhythm and LFO length", "a huge snare with a long reverb on it alone"],
    avoid: ["four on the floor", "a bass with one static sound", "a quiet drop"],
  },
  riddim: {
    kits: ["synth", "siege-808", "808"],
    drums: [
      { kick: "x.........x.....", snare: "........X.......", hat: E8 },
      { kick: "x.....x...x.....", snare: "........X.......", hat: "..x...x...x...x." },
    ],
    core: { wobble: ["dm:contagion", "dm:sub/growl", "dm:snarl"], sub: ["dm:sub/pure sine", "dm:sub/808"] },
    optional: { perc: ["dm:halo/trash", "dm:lancet/tin head"], pad: ["dm:drone/subterranean"], blip: ["plaits:2", "dm:hexop/bell"] },
    extras: [0, 2],
    bass: ["a repetitive wobble on a tight rhythm `x.x.x...x.x.x...`, one note, the same LFO throughout", "four short wobbles and a rest `x.x.x.x.........`, every bar the same", "a triplet-feel pattern by ratchet 3 on two steps a bar"],
    harmony: ["minor: one root", "phrygian: one root, the b2 for one beat every fourth bar", "minor: the root for three bars, bIII for one"],
    angles: ANGLES_AT(0, 1, 3, 6),
    moves: ["an LFO on the wobble's cutoff synced to 2 or 4 steps, square or saw shape", "lots of empty space: half of every bar is silent but for the sub and drums", "the second drop the same pattern with the LFO twice as fast", "the sub clean on its own track, the wobble highpassed above it", "a one-beat gap before each drop"],
    avoid: ["melody and chords in the drop", "a different bass pattern every bar: repetition is the point", "a busy drum part"],
  },
  grime: {
    kits: ["synth", "808", "siege-808"],
    drums: [
      { kick: "x.....x...x.....", snare: BACK, hat: "..x...x...x...x." },
      { kick: "x..x......x..x..", clap: "....X.......X...", hat: "x.....x.x.....x." },
      { kick: "x.......x.x.....", snare: "....X.......X.x.", rim: "..x..x....x....." },
    ],
    core: { bass: ["dm:sub/pure sine", "dm:sub/808", "dm:sub/reese"], square: ["plaits:0", "dm:drift", "dm:oracle/pulse keys"] },
    optional: { strings: ["dm:oracle/strings"], brass: ["dm:hexop/brass", "dm:oracle/poly brass", "dm:breath/horn stabs"], click: ["plaits:10", "dm:halo/fm hat"], vox: ["dm:vox/basso", "dm:vox/monk chant"] },
    extras: [0, 2],
    bass: ["sub hits on a sparse rhythm `x.....x...x.....`, short", "a square-wave bass riff of four notes, the same as the melody an octave or two down", "long sub notes on the root with a drop to the b2 at the end of every four bars"],
    harmony: ["minor: one root; the melody on 1, b2 and b3", "phrygian: i - bII", "harmonic minor: a string stab on i and V", "minor: i - bVI, two bars each"],
    angles: ANGLES_AT(0, 3, 4, 6),
    moves: ["a cold square-wave melody of four to eight short notes, eight bars repeated", "gaps: a beat or two of near silence in every bar", "[strings] orchestral stabs on the first beat of every second bar", "the drums dropping out for the last bar of every eight", "everything dry: no long reverb"],
    avoid: ["warm chords and pads", "a full, busy arrangement", "swing"],
  },
  "uk-funky": {
    swing: [0.04, 0.14], kits: ["909", "synth", "siege-909"],
    drums: [
      { kick: FOUR, snare: "...x..x....x..x.", hat: E8 },
      { kick: "x..x..x...x..x..", clap: "....x.......x...", tom: "..x...x..x....x.", shaker: S16 },
      { kick: FOUR, rim: "..x..x....x.x...", tom: ".....x.x.....x..", "open hat": OFF },
    ],
    core: { bass: ["dm:sub/house sub", "dm:hexop/bass", "dm:sub/reese"], chords: ["dm:tines", "dm:hexop/organ", "dm:oracle/pulse keys"] },
    optional: { vox: ["dm:vox/soul lead", "dm:vox/la la"], mallet: ["dm:hexop/marimba", "plaits:12"], pad: ["dm:oracle/warm pad"], bell: ["dm:808-cowbell"] },
    extras: [1, 2],
    bass: ["a deep bouncing line in the gaps of the snare pattern `x.....x.x.....x.`", "a two-note riff with a slide", "long roots with a syncopated pickup `x_____.x.x_.....`"],
    harmony: ["minor: i min7 - iv min7", "dorian: i min9 - IV", "minor: i - bVII - bVI - bVII", "major: I maj7 - vi min7"],
    moves: ["the snare or rim on the soca-like pattern, never a plain backbeat", "tom fills tuned to the key", "chords stabbed short on the offbeats", "[mallet] a marimba figure of two bars", "the kick thinning to beats 1 and 3 in the break"],
    avoid: ["a clap on 2 and 4 alone", "a heavy wobble bass", "straight, unsyncopated percussion"],
  },
  neurofunk: {
    kits: ["synth", "breaks"],
    drums: [
      { kick: "x.........x.....", snare: BACK, hat: E8, "ghost snare": ".......o.o......" },
      { kick: "x.....x...x.....", snare: "....X.......X..o", hat: "x.xxx.x.x.xxx.x." },
      { kick: "x..x......x.....", snare: "....X..o....X...", hat: S16 },
    ],
    core: { reese: ["dm:contagion", "dm:sub/reese", "dm:sub/growl", "dm:snarl"], sub: ["dm:sub/pure sine"] },
    optional: { pad: ["dm:drone/dark grone", "dm:oracle/strings"], blip: ["plaits:2", "plaits:10"], stab: ["dm:oracle/dirty stab"], riser: ["plaits:9"] },
    extras: [1, 3],
    bass: ["a two-bar bass phrase with a different filter position on every note (cutoff lane, a value per step)", "long notes whose tone moves: an LFO on the cutoff plus a lane on the shape", "a call and response: a low growl, then a higher answer `x___..x_x___.x..`"],
    harmony: ["minor: one root", "phrygian: the root with the b2 at the end of each phrase", "minor: the bass moves i, i, b7, b6 across four bars"],
    angles: ANGLES_AT(1, 3, 4),
    moves: ["the reese's cutoff and shape on lanes that differ in every section", "the sub on its own track, clean, the reese highpassed above it", "a tight, dry snare, loud", "edits: a beat of silence or a reversed swell at the end of every eight bars", "the second drop on a new bass phrase"],
    avoid: ["a static bass sound", "warm chords in the drop", "a loose drum feel"],
  },
  breakbeat: {
    swing: [0, 0.1], kits: ["breaks", "live", "909"],
    drums: [
      { kick: "x.....x...x.....", snare: BACK, hat: E8 },
      { kick: "x..x......x..x..", snare: "....X..o....X...", hat: "x.xxx.x.x.xxx.x." },
      { kick: "x.x.......x.....", snare: "....X.......X.o.", hat: S16, "open hat": "......x.......x." },
    ],
    core: { bass: ["dm:sub/reese", "dm:hexop/bass", "dm:sub/acid", "dm:ladder/model d bass"] },
    optional: { stab: ["dm:oracle/dirty stab", "dm:oracle/poly brass", "dm:tines"], acid: ["dm:silverbox"], lead: ["dm:contagion", "dm:snarl"], vox: ["dm:vox/soul lead", "dm:vox/robot choir"], pad: ["dm:oracle/strings"] },
    extras: [1, 3],
    bass: ["a fat riff that follows the kick with a slide into each bar `x_....x_..x_.x_.`", "a rolling sixteenth line on two notes", "long notes with a filter sweep, one a bar"],
    harmony: ["minor: one root, a rave stab on i", "minor: i - bVII - bVI - bVII", "dorian: i7 - IV7", "phrygian: i - bII"],
    moves: ["a two-bar break whose second bar ends in a fill", "[stab] a rave stab on a syncopated rhythm", "a filter sweep (cutoff lane) over the whole drum bus into each drop", "[acid] an acid line entering in the second drop", "the drums alone for four bars as a break"],
    avoid: ["a four on the floor kick", "a one-bar drum loop for a whole section", "a thin bass"],
  },
  footwork: {
    kits: ["808", "synth"],
    drums: [
      { kick: "x..x..x...x..x..", clap: "....x.......x...", hat: E8 },
      { kick: "x.x..x..x.x..x..", snare: "............X...", tom: "..x...x...x...x.", hat: "xxxxxxxxxxxxxxxx" },
      { kick: "x..x..x..x..x..x", clap: "........X.......", hat: "x.xxx.xxx.xxx.xx", rim: "..x..x.....x...." },
    ],
    core: { sub: ["dm:sub/808", "dm:sub/pure sine"], chop: ["dm:vox/soul lead", "dm:vox/la la", "dm:tines", "dm:hexop/e.piano"] },
    optional: { pad: ["dm:oracle/warm pad", "dm:oracle/strings"], stab: ["dm:oracle/dirty stab", "dm:hexop/brass"], bell: ["dm:hexop/bell", "dm:808-cowbell"] },
    extras: [0, 2],
    bass: ["the sub on the kick's syncopations, short, three against four `x..x..x..x..x...`", "long sub notes under the busy kicks, one a bar", "sub hits only on the first and the last kick of each bar"],
    harmony: ["minor: i min7 - iv min7, two bars each", "dorian: one min9 chord, chopped", "major: I maj7 - vi min7, a soul loop", "minor: one root; the chop on 1 and b3"],
    angles: ANGLES_AT(1, 2, 6, 7),
    moves: ["the chop: one or two syllables or one chord, retriggered in bursts (ratchets, repeated sixteenths), the same sound all through", "kick patterns in threes against the bar, changing every four bars", "hat and tom rolls by ratchet", "a half-time clap: once a bar, or less", "the drums cut to the chop alone for a bar"],
    avoid: ["a steady four on the floor", "a clap on 2 and 4 throughout", "smooth, legato parts"],
  },
  memphis: {
    swing: [0, 0.08], kits: ["808", "siege-808"],
    drums: [
      { kick: "x.....x...x.....", snare: BACK, hat: S16 },
      { kick: "x..x......x..x..", clap: BACK, hat: E8, cowbell: "x..x..x...x..x.." },
      { kick: "x.......x.x.....", snare: "....X.......X..o", hat: "x.xxx.x.x.xxx.x." },
    ],
    core: { "808 bass": ["dm:sub/memphis", "dm:sub/808", "dm:sub/distorted 808"], keys: ["dm:tines", "dm:hexop/bell", "dm:oracle/strings"] },
    optional: { chant: ["dm:vox/monk chant", "dm:vox/basso"], pad: ["dm:drone/dark grone", "dm:drone/cathedral"], lead: ["dm:ladder/whistle", "dm:hexop/marimba"] },
    extras: [0, 2],
    bass: ["long 808 notes on the roots, one or two a bar", "the 808 on the kick's hits, short, with one long slide per four bars", "two notes a b2 apart, alternating bars"],
    harmony: ["minor: i - bVI", "phrygian: i - bII", "harmonic minor: i - iv - V", "minor: one root; an eerie three-note figure on 1, b3 and b6"],
    angles: ANGLES_AT(0, 3, 4, 6),
    moves: ["an eerie melody of three or four notes on keys or bells, looped, vinyl or cassette on it", "[chant] a chant on one low pitch, a short phrase repeated", "hats in sixteenths with rolls by ratchet", "saturation on the drum bus, crush lightly on the melody", "the beat dropping to the melody alone for two bars"],
    avoid: ["a bright, clean mix", "busy chord changes", "a fast feel: it is slow and heavy"],
  },
  "cloud-rap": {
    kits: ["808", "synth"],
    drums: [
      { kick: "x.....x...x.....", snare: BACK, hat: S16 },
      { kick: "x.......x.x.....", clap: BACK, hat: "x.x.x.xxx.x.x.x." },
    ],
    core: { pad: ["dm:oracle/warm pad", "dm:oracle/strings", "dm:vox/angel ooh"], "808 bass": ["dm:sub/808", "dm:sub/pure sine"] },
    optional: { bell: ["dm:hexop/bell", "dm:oracle/glass"], vox: ["dm:vox/whisper", "dm:vox/choir aah"], keys: ["dm:tines"], texture: ["dm:drone/glacier", "plaits:9"] },
    extras: [1, 2],
    bass: ["one washed-out chord a bar, long attack, long release", "two chords, four bars each, swelling", "a chord held for the whole pattern with a slow cutoff LFO"],
    harmony: ["major: IV maj7 - I maj7", "minor: i min9 - bVI maj7", "lydian: I maj7 - II", "dorian: i min9 - IV"],
    angles: ANGLES_AT(0, 2, 5, 6),
    moves: ["a long reverb on everything but the 808 and the kick, on a bus", "[bell] a bell melody of long notes, high and sparse", "hat rolls by ratchet, soft", "the 808 soft and long, following the chord roots", "the drums out for the first eight bars"],
    avoid: ["hard, dry drums", "dense melodies", "a dark, aggressive bass"],
  },
  electropop: {
    kits: ["synth", "909", "808"],
    drums: [
      { kick: FOUR, clap: BACK, hat: E8 },
      { kick: "x.....x.x.......", snare: BACK, hat: S16 },
      { kick: "x..x..x.x..x..x.", clap: BACK, "open hat": OFF },
    ],
    core: { bass: ["dm:sub/house sub", "dm:ladder/model d bass", "dm:hexop/bass", "dm:oracle/unison bass"], chords: ["dm:contagion", "dm:oracle/pulse keys", "dm:oracle/warm pad"], hook: ["dm:vox/soul lead", "dm:vox/la la", "dm:hexop/bell", "dm:ladder/funk lead"] },
    optional: { arp: ["dm:oracle/glass"], pad: ["dm:oracle/strings"], pluck: ["dm:hexop/marimba"] },
    extras: [0, 2],
    bass: ["eighths on the roots, sidechained from the kick", "a syncopated synth riff `x..x..x.x.....x.`", "long notes in the verse, eighths in the chorus"],
    harmony: ["major: vi - IV - I - V", "minor: i - bVI - bIII - bVII", "major: I - V - vi - IV", "major: IV - V - vi - vi"],
    moves: ["the chords sidechained from the kick", "a hook of four to six notes, repeated, the chorus built on it", "the verse stripped to bass, drums and one part", "a pre-chorus with the kick out and a rising cutoff", "[arp] an arp entering in the second chorus"],
    avoid: ["a verse as full as the chorus", "acoustic sounds", "a muddy low end: one bass part"],
  },
  hyperpop: {
    kits: ["808", "synth", "siege-808"],
    drums: [
      { kick: FOUR, clap: BACK, hat: "xxxxxxxxxxxxxxxx" },
      { kick: "x..x..x...x..x..", snare: "....X.......X.xx", hat: S16 },
      { kick: "x.x.x.x.x.x.x.x.", clap: "....X.......X...", "open hat": OFF },
    ],
    core: { chords: ["dm:contagion"], bass: ["dm:sub/distorted 808", "dm:sub/808"], hook: ["dm:vox/la la", "dm:vox/soul lead", "dm:hexop/bell"] },
    optional: { bell: ["dm:oracle/glass", "plaits:12"], screech: ["plaits:2", "dm:snarl"], arp: ["dm:oracle/pulse keys"], pad: ["dm:oracle/strings"] },
    extras: [1, 3],
    bass: ["sugary supersaw chords in a fast syncopated rhythm `x.xx.x.xx.xx.x.x`", "huge chords on every beat, sidechained", "arpeggiated chords in sixteenths, bright"],
    harmony: ["major: I - V - vi - IV", "major: IV - V - iii - vi", "lydian: I - II - vi", "minor: bVI - bVII - i - v"],
    forms: ["intro 4 | verse 8 | chorus 8 | switch 4 | verse 8 | chorus 8 | bridge 4 | chorus 8 | outro 2", "chorus 8 | verse 8 | switch 4 | chorus 8 | break 4 | chorus 8 | chorus 8", "intro 2 | verse 8 | pre 4 | chorus 8 | switch 8 | chorus 8 | outro 4"],
    angles: ANGLES_AT(1, 5, 7),
    moves: ["the hook pitched up: the vox an octave high, its timb slider towards the smallest voice", "a sudden switch: four bars in half time or a different kit, then back", "a distorted kick and 808 (fuzz or shaper), loud", "crush on one part, sweeping its rate", "a stutter: a beat repeated by ratchet 4 at the end of a section"],
    avoid: ["restraint", "long, slow builds", "a dark or mellow mood"],
  },
  "dream-pop": {
    swing: [0, 0.08], kits: ["cr78", "live", "r8"],
    drums: [
      { kick: "x.....x.x.......", snare: BACK, hat: E8 },
      { kick: "x.......x.x.....", snare: "....x.......x...", hat: "x.o.x.o.x.o.x.o.", tambourine: "....x.......x..." },
    ],
    core: { guitar: ["dm:guitar/chime", "dm:guitar/jangle", "inst:guitar-electric"], bass: ["dm:bass/motown", "dm:bass/svt fingers", "inst:bass-electric"], pad: ["dm:oracle/warm pad", "dm:oracle/strings"] },
    optional: { vox: ["dm:vox/angel ooh", "dm:vox/whisper", "dm:vox/soul lead"], keys: ["dm:tines", "dm:oracle/glass"], lead: ["dm:guitar/singing lead", "dm:hexop/bell"] },
    extras: [1, 2],
    bass: ["arpeggiated chords in eighths, each note ringing into the next", "chords strummed once a bar and left to ring", "a two-bar picked figure, repeated over every chord"],
    harmony: ["major: I maj7 - IV maj7", "major: vi - IV - I - V, slow", "lydian: I maj7 - II", "dorian: i min7 - IV"],
    angles: ANGLES_AT(0, 2, 5, 6),
    moves: ["chorus and a long reverb on the guitar, delay in dotted eighths", "[vox] a breathy vox of long notes, low in the mix", "the bass simple, on the roots, melodic at chord changes", "the drums soft and far back, in the same reverb", "a second guitar line an octave up in the chorus"],
    avoid: ["dry, upfront sounds", "distorted guitar", "a fast or busy drum part"],
  },
  "indie-dance": {
    swing: [0, 0.08], kits: ["909", "live", "synth"],
    drums: [
      { kick: FOUR, snare: BACK, "open hat": OFF, hat: S16 },
      { kick: FOUR, clap: BACK, hat: E8, cowbell: "..x..x....x..x.." },
    ],
    core: { bass: ["dm:bass/pick grind", "dm:bass/motown", "inst:bass-electric", "dm:ladder/model d bass"], guitar: ["dm:guitar/funk clean", "dm:guitar/jangle", "inst:guitar-electric"], synth: ["dm:oracle/pulse keys", "dm:drift", "dm:oracle/poly brass"] },
    optional: { vox: ["dm:vox/soul lead", "dm:vox/la la"], arp: ["dm:hexop/bell"], pad: ["dm:oracle/strings"], perc: ["dm:808-cowbell", "dm:halo/shaker"] },
    extras: [1, 2],
    bass: ["a driving line in eighths with octave jumps `x.x.x.x.x.x.x.x.`", "a syncopated riff that is the hook `x..x.x..x.x_.x..`", "roots in eighths, a run of sixteenths into each change"],
    harmony: ["minor: i - bVII - bVI - bVII", "dorian: i - IV", "major: I - vi - IV - V", "mixolydian: I - bVII"],
    moves: ["guitar chops: muted sixteenths with a chord on two steps a bar", "an open hat on every offbeat", "a cowbell or percussion break of four bars", "the synth doubling the bass riff an octave up in the chorus", "[vox] a short shouted vox hook"],
    avoid: ["a programmed, stiff bass: it should feel played", "long pads", "half-time sections"],
  },
  "post-punk": {
    kits: ["salamander", "cr78", "r8"],
    drums: [
      { kick: "x.....x.x.....x.", snare: BACK, hat: S16 },
      { kick: FOUR, snare: BACK, hat: E8 },
      { kick: "x...x.....x.x...", snare: BACK, tom: "x.x.x.x.x.x.x.x." },
    ],
    core: { bass: ["dm:bass/pick grind", "dm:bass/pop punk", "inst:bass-electric"], guitar: ["dm:guitar/chime", "dm:guitar/jangle", "dm:guitar/surf twang"] },
    optional: { synth: ["dm:oracle/strings", "dm:drift", "dm:oracle/pulse keys"], vox: ["dm:vox/basso", "dm:vox/soul lead"], lead: ["dm:guitar/singing lead"] },
    extras: [1, 2],
    bass: ["a melodic line high on the neck that is the tune `x.x.x.xxx.x.x.x.`, chorus on it", "driving eighths on the root with a melodic turn every second bar", "a two-bar riff in sixteenths, picked, the same through the verse"],
    harmony: ["minor: i - bVI - bVII", "minor: i - bIII - bVII - iv", "dorian: i - IV", "phrygian: i - bII"],
    angles: ANGLES_AT(0, 3, 6),
    moves: ["chorus on the bass", "the guitar angular and sparse: single notes and two-note shapes, no full strums", "a tight, dry beat, the same all the way through", "the guitar in a delay, eighth notes", "[synth] a cold string line of long notes in the chorus"],
    avoid: ["power chords and heavy distortion", "a bass buried under the guitar", "a loose, swung feel"],
  },
  shoegaze: {
    kits: ["salamander", "drskit"],
    drums: [
      { kick: "x.....x.x.......", snare: BACK, hat: E8 },
      { kick: "x...x.....x.x...", snare: BACK, ride: E8, crash: "x..............." },
    ],
    core: { guitar: ["dm:guitar/grunge", "dm:guitar/fuzz lead", "dm:guitar/brit stack"], bass: ["dm:bass/pick grind", "dm:bass/svt fingers"], "second guitar": ["dm:guitar/chime", "dm:guitar/jangle"] },
    optional: { vox: ["dm:vox/angel ooh", "dm:vox/whisper"], pad: ["dm:oracle/strings"], lead: ["dm:guitar/singing lead"] },
    extras: [1, 2],
    bass: ["full chords strummed in eighths, every string ringing, a wall", "one chord held and re-struck each bar with bloom up so it feeds back", "chords in sixteenths, tremolo-picked"],
    harmony: ["major: I - IV, two bars each", "major: I maj7 - iii - IV", "lydian: I - II", "minor: i - bVI - bIII - bVII"],
    angles: ANGLES_AT(2, 4, 6),
    moves: ["fuzz, chorus or flanger, and a long reverb stacked on the guitar", "[vox] the vox soft and buried, long notes", "the bass in eighths on the roots, holding it together", "the drums steady and under the guitars", "a quiet verse on the clean guitar, the wall arriving in the chorus"],
    avoid: ["a dry or thin guitar", "a loud, upfront vox", "space: it is dense"],
  },
  indie: {
    kits: ["salamander", "drskit", "live"],
    drums: [
      { kick: "x.....x.x.......", snare: BACK, hat: E8 },
      { kick: "x..x....x.x.....", snare: BACK, hat: S16 },
      { kick: "x...x.....x.x...", snare: "....X.......X.o.", ride: E8 },
    ],
    core: { guitar: ["dm:guitar/jangle", "dm:guitar/chime", "dm:guitar/blues burn"], bass: ["dm:bass/svt fingers", "dm:bass/motown", "inst:bass-electric"] },
    optional: { vox: ["dm:vox/soul lead", "dm:vox/la la"], "second guitar": ["dm:guitar/chime", "inst:guitar-acoustic"], keys: ["dm:tines", "dm:hexop/organ"], lead: ["dm:guitar/singing lead"] },
    extras: [1, 2],
    bass: ["jangly chords in a syncopated strum `x.xx.xx.x.xx.xx.`", "a picked riff of single notes over each chord", "chords in eighths, muted in the verse, open in the chorus"],
    harmony: ["major: I - V - vi - IV", "major: I - iii - IV - V", "minor: i - bIII - bVII - iv", "mixolydian: I - bVII - IV"],
    moves: ["a melodic bass line that moves between the roots", "[second guitar] a second guitar playing a high counter-line in the chorus", "a tom and snare fill into each chorus", "the verse on closed hats, the chorus on the ride or open hat", "a stop for one beat before the last chorus"],
    avoid: ["drum machines", "heavy distortion", "the same strum in every section"],
  },
  doom: {
    kits: ["drskit", "salamander"],
    drums: [
      { kick: "x.......x.......", snare: "........X.......", crash: "x...............", hat: "x...x...x...x..." },
      { kick: "x.....x.........", snare: "........X.......", ride: "x...x...x...x..." },
    ],
    core: { guitar: ["dm:guitar/scooped metal", "dm:guitar/grunge", "dm:guitar/fuzz lead"], bass: ["dm:bass/growl", "dm:bass/pick grind"] },
    optional: { organ: ["dm:hexop/organ"], choir: ["dm:vox/basso", "dm:vox/monk chant"], drone: ["dm:drone/dark grone", "dm:drone/subterranean"], lead: ["dm:guitar/singing lead"] },
    extras: [0, 2],
    bass: ["a riff of three or four chords, each held for half a bar or more and left to ring", "one low chord struck on beat 1 and sustained for the bar, bloom up", "a slow riff with a b2 or tritone step `x_______x___x___`"],
    harmony: ["phrygian: i - bII - i - bVII, power chords", "minor: i - bVI - bVII", "minor pentatonic: a riff on 1, b3 and 4, very slow", "harmonic minor: i - iv - V"],
    forms: ["intro 4 | riff 8 | verse 8 | riff 8 | verse 8 | slow 8 | riff 8 | outro 4", "drone 4 | riff 8 | riff 8 | verse 8 | riff 8 | outro 8", "intro 8 | verse 8 | riff 8 | verse 8 | riff 8 | outro 4"],
    angles: ANGLES_AT(3, 4, 6),
    moves: ["the guitar tuned low (notes around E1 to A1) with the drive and sustain up", "the bass doubling the riff with fuzz", "long crash tails on the first beat of each riff", "feedback: bloom up on a held chord at the end of a section", "the last riff slower still: the same notes at half speed"],
    avoid: ["fast playing", "clean tones", "busy drums: every hit has room"],
  },
  "nu-disco": {
    swing: [0, 0.1], kits: ["909", "synth", "live"],
    drums: [
      { kick: FOUR, clap: BACK, "open hat": OFF, hat: S16 },
      { kick: FOUR, snare: BACK, "open hat": OFF, shaker: S16, cowbell: "..x..x....x..x.." },
    ],
    core: { bass: ["dm:ladder/model d bass", "dm:hexop/bass", "dm:bass/slap funk", "dm:oracle/unison bass"], chords: ["dm:tines", "dm:oracle/pulse keys", "dm:oracle/warm pad", "dm:hexop/e.piano"] },
    optional: { lead: ["dm:ladder/funk lead", "dm:ladder/vibrato lead", "dm:hexop/bell"], guitar: ["dm:guitar/funk clean"], strings: ["dm:oracle/strings"], vox: ["dm:vox/soul lead", "dm:vox/robot choir"], arp: ["dm:oracle/glass"] },
    extras: [1, 3],
    bass: ["a synth bass in octaves with a filter that opens on the offbeat `x.x.x.x.x.x.x.x.`", "a syncopated funk riff `x..x..x...x.x_..`", "octaves with a slide into each chord"],
    harmony: ["dorian: i min7 - IV7", "major: I maj7 - vi min7 - ii min7 - V7", "minor: i min9 - bVII - bVI maj7 - v min7", "minor: iv min7 - bVII7 - bIII maj7"],
    moves: ["the chords sidechained from the kick", "a cutoff lane on the bass that opens through the build", "[lead] a dreamy lead of long notes with delay", "a breakdown to chords and hats, the bass returning filtered", "[guitar] a muted guitar chop in sixteenths"],
    avoid: ["a harsh or dark mix", "half-time or broken beats", "a static filter on the bass"],
  },
  soul: {
    swing: [0.06, 0.2], kits: ["live", "virtuosity", "salamander"],
    drums: [
      { kick: "x.....x.x.......", snare: BACK, hat: E8 },
      { kick: "x.......x.x.....", snare: "....X.......X..o", hat: "x.o.x.o.x.o.x.o.", tambourine: "....x.......x..." },
      { kick: "x..x......x.....", rim: "....x.......x...", hat: E8 },
    ],
    core: { bass: ["dm:bass/motown", "inst:bass-electric", "dm:bass/svt fingers"], keys: ["dm:tines", "dm:hexop/organ", "dm:hexop/e.piano"], vox: ["dm:vox/soul lead", "dm:vox/doo wop", "dm:vox/hallelujah"] },
    optional: { guitar: ["dm:guitar/funk clean", "inst:guitar-electric", "dm:guitar/chime"], horns: ["dm:breath/brass section", "dm:breath/sax section", "dm:breath/horn stabs"], strings: ["dm:oracle/strings"], choir: ["dm:vox/choir aah"] },
    extras: [1, 2],
    bass: ["a melodic line: the root on the one, then a walk through the chord `x_..x.x_..x_x.x.`", "roots and fifths with a chromatic step into each change", "a two-bar line, simple in the first bar and busy in the second"],
    harmony: ["major: I - vi - IV - V", "major: I maj7 - IV maj7 - iii min7 - vi min7", "dorian: i min7 - IV7", "major: IV - V - iii - vi"],
    forms: ["intro 4 | verse 8 | chorus 8 | verse 8 | chorus 8 | bridge 8 | chorus 8 | outro 4", "intro 4 | verse 16 | chorus 8 | verse 16 | chorus 8 | chorus 8 | outro 4", "chorus 8 | verse 8 | chorus 8 | bridge 8 | chorus 8 | chorus 8 | outro 4"],
    angles: ANGLES_AT(0, 2, 4, 5),
    moves: ["the vox a big melody in the chorus, answered by a second line in the gaps", "[horns] horn stabs on the backbeat in the chorus", "the keys comping: chords on the offbeats, soft", "[guitar] a guitar chop on beats 2 and 4", "the last chorus a step louder: everything up, a tambourine in"],
    avoid: ["drum machines and synths", "a stiff, quantised feel", "a busy arrangement under the verse"],
  },
  dancehall: {
    kits: ["808", "synth", "909"],
    drums: [
      { kick: "x.......x.......", snare: "...x..x....x..x.", hat: E8 },
      { kick: "x..x..x.x..x..x.", clap: "......X.......X.", rim: "...x.......x...." },
      { kick: FOUR, snare: "...X..X....X..X.", shaker: S16 },
    ],
    core: { bass: ["dm:sub/808", "dm:sub/dub", "dm:hexop/bass"], hook: ["dm:oracle/pulse keys", "dm:hexop/marimba", "dm:hexop/brass", "dm:hexop/organ"] },
    optional: { vox: ["dm:vox/soul lead", "dm:vox/basso"], stab: ["dm:oracle/dirty stab", "dm:oracle/poly brass"], pad: ["dm:oracle/strings"], siren: ["plaits:2"] },
    extras: [0, 2],
    bass: ["a deep line on the 3-3-2: `x..x..x.x..x..x.`", "long notes on the roots, one a bar, with a pickup", "two notes a bar, the second sliding down"],
    harmony: ["minor: i - bVII", "minor: i - iv - bVII - bIII", "major: I - IV, one bar each", "harmonic minor: i - V"],
    moves: ["the riddim: one two-bar pattern for the whole song, parts dropping in and out over it", "a synth hook of four to six notes, staccato", "the drums cut to the snare pattern alone for a bar before the chorus", "[siren] a dub siren at the section changes", "[stab] chord stabs on the offbeats"],
    avoid: ["a snare on 2 and 4", "new chords in each section", "swing"],
  },
  ska: {
    kits: ["salamander", "live", "drskit"],
    drums: [
      { kick: "x.......x.......", snare: BACK, hat: E8 },
      { kick: FOUR, snare: BACK, hat: "..x...x...x...x." },
      { kick: "........x.......", rim: "....x.......x...", hat: E8 },
    ],
    core: { skank: ["dm:guitar/funk clean", "dm:guitar/chime", "inst:guitar-electric"], bass: ["dm:bass/motown", "dm:bass/svt fingers", "inst:bass-electric", "dm:bass/walking jazz"], horns: ["dm:breath/brass section", "dm:breath/horn stabs", "dm:breath/trombone", "dm:breath/sax section"] },
    optional: { organ: ["dm:hexop/organ"], vox: ["dm:vox/soul lead", "dm:vox/doo wop"], piano: ["dm:tines"] },
    extras: [0, 2],
    bass: ["a short chord on every offbeat eighth `..x...x...x...x.`, nothing on the beat", "offbeat chords with a double hit on the last `..x...x...x...xx`", "upstrokes on the offbeats, the chord changing every two beats"],
    harmony: ["major: I - IV - V - IV", "major: I - vi - IV - V", "minor: i - iv - bVII - bIII", "mixolydian: I - bVII - IV"],
    angles: ANGLES_AT(1, 2, 7),
    moves: ["the bass walking in quarters `x...x...x...x...` through the chord tones", "a horn melody of eight bars in unison, the tune of the song", "horn stabs answering the skank in the verse", "a drum fill on the snare into each section", "[organ] the organ doubling the skank"],
    avoid: ["a chord on the beat from the guitar", "a slow or heavy feel", "a bass that sits on one note"],
  },
  darksynth: {
    kits: ["r8", "synth", "siege-909"],
    drums: [
      { kick: FOUR, snare: BACK, hat: S16 },
      { kick: "x.....x.x.....x.", snare: BACK, hat: E8, tom: "............oxxX" },
      { kick: "x.x...x.x.x...x.", snare: BACK, hat: E8 },
    ],
    core: { bass: ["dm:sub/growl", "dm:sub/reese", "dm:contagion", "dm:snarl"], arp: ["dm:oracle/pulse keys", "dm:contagion"] },
    optional: { lead: ["dm:ladder/vibrato lead", "dm:guitar/singing lead", "dm:contagion"], pad: ["dm:oracle/strings", "dm:drone/dark grone"], choir: ["dm:vox/choir aah", "dm:vox/basso"], stab: ["dm:oracle/dirty stab"] },
    extras: [1, 2],
    bass: ["distorted sixteenths on the root with accents `XxxxXxxxXxxxXxXx`", "a syncopated chug `x.xx.x.xx.xx.x.x`, one note, fuzz on it", "eighths on the root, dropping to the b2 for the last bar of four"],
    harmony: ["minor: i - bVI - bVII", "phrygian: i - bII", "harmonic minor: i - iv - V", "minor: i - bVI - iv - v"],
    angles: ANGLES_AT(1, 3, 4, 6),
    moves: ["fuzz or shaper on the bass, the kick sidechaining it", "a dark minor arp in sixteenths over the bass", "a big gated snare", "[lead] a lead with slow vibrato playing a horror-film theme of long notes", "a half-time breakdown before the last section"],
    avoid: ["major keys and warm pads", "a clean bass", "swing"],
  },
  "new-wave": {
    kits: ["r8", "cr78", "live"],
    drums: [
      { kick: "x.....x.x.......", snare: BACK, hat: E8 },
      { kick: FOUR, snare: BACK, hat: S16 },
      { kick: "x...x.....x.x...", snare: BACK, hat: E8, tom: "............o.xX" },
    ],
    core: { bass: ["dm:bass/pick grind", "dm:bass/pop punk", "dm:hexop/bass", "inst:bass-electric"], synth: ["dm:oracle/pulse keys", "dm:drift", "dm:oracle/poly brass", "dm:oracle/strings"], guitar: ["dm:guitar/chime", "dm:guitar/jangle", "dm:guitar/funk clean"] },
    optional: { vox: ["dm:vox/soul lead", "dm:vox/basso"], lead: ["dm:ladder/vibrato lead", "dm:hexop/bell"], arp: ["dm:oracle/glass"] },
    extras: [1, 2],
    bass: ["driving eighths on the roots with chorus on them", "a melodic line in eighths that moves by step between the roots", "a syncopated riff `x.x..x.xx.x..x..`"],
    harmony: ["major: I - vi - IV - V", "minor: i - bVII - bVI - bVII", "dorian: i - IV", "major: I - V - IV - V"],
    moves: ["bright synth stabs on the offbeats", "clean guitar in sixteenths, muted, with chorus", "a synth riff that answers the vocal", "a drum machine tom fill into the chorus", "[vox] a catchy vox melody in the chorus"],
    avoid: ["heavy distortion", "a slow, dark feel", "swing"],
  },
  vaporwave: {
    swing: [0.04, 0.16], kits: ["r8", "cr78", "live"],
    drums: [
      { kick: "x.....x.x.......", snare: BACK, hat: E8 },
      { kick: "x.......x.x.....", snare: "....x.......x...", hat: "x.o.x.o.x.o.x.o." },
    ],
    core: { keys: ["dm:tines", "dm:hexop/e.piano", "dm:oracle/glass", "dm:oracle/pulse keys"], bass: ["dm:hexop/bass", "dm:bass/slap funk", "dm:bass/motown"] },
    optional: { sax: ["dm:breath/alto sax", "dm:breath/soprano sax", "dm:breath/subtone sax"], pad: ["dm:oracle/strings", "dm:oracle/warm pad"], vox: ["dm:vox/angel ooh", "dm:vox/soul lead"], bell: ["dm:hexop/bell"] },
    extras: [1, 3],
    bass: ["smooth-jazz chords in a lazy syncopated rhythm, a two-bar loop played as if sampled", "one lush chord a bar, rolled (strum)", "a four-chord loop, each chord cut short as if the sample skipped"],
    harmony: ["major: I maj9 - vi min7 - ii min9 - V13", "major: IV maj7 - iii min7 - ii min7 - I maj7", "dorian: i min9 - IV13", "lydian: I maj7 - II"],
    angles: ANGLES_AT(0, 2, 4, 6),
    moves: ["everything slow and pitched down: low notes, long decays", "cassette wow and flutter on the keys or the whole bus", "a long reverb and chorus on the keys", "the loop stuttering: a beat repeated by ratchet or the repeat stage at the end of a phrase", "[sax] a sax-like lead of long notes drifting over the loop"],
    avoid: ["a clean, punchy mix", "energy: it is drowsy", "new material in each section: one loop, worn down"],
  },
  "berlin-school": {
    layered: true,
    core: { sequence: ["dm:oracle/pulse keys", "dm:ladder/percussive", "dm:drift"], pad: ["dm:oracle/strings", "dm:oracle/warm pad"] },
    optional: { "second sequence": ["dm:hexop/bell", "dm:oracle/glass"], lead: ["dm:ladder/vibrato lead", "dm:ladder/whistle"], bass: ["dm:ladder/pedal bass", "dm:sub/pure sine"], choir: ["dm:vox/choir aah", "dm:vox/angel ooh"], noise: ["plaits:9", "dm:drone/glacier"] },
    extras: [1, 3],
    bass: ["an eight-note sequence in sixteenths, repeating, its notes changing one at a time over many bars", "a sequence five or seven steps long against the bar (track length 5, 7 or 10)", "a sixteen-step sequence with two rests, transposed with the chords"],
    harmony: ["minor: i for sixteen bars, bVI for eight, bVII for eight", "dorian: one chord; the sequence transposes 1, 4, 1, b7", "minor: i - bVII - bVI - bVII, eight bars each", "phrygian: one root, the pad moving i to bII and back"],
    forms: ["emerge 16 | sequence 16 | lift 16 | sequence 16 | peak 16 | dissolve 16", "pads 16 | sequence 16 | sequence 16 | lead 16 | sequence 16 | pads 8", "intro 8 | sequence 16 | lift 16 | break 8 | peak 16 | outro 16"],
    angles: ANGLES_AT(2, 5, 6),
    moves: ["the sequence's cutoff on a lane that opens over thirty-two bars", "delay on the sequence in dotted eighths so it doubles itself", "[second sequence] a second sequence of a different length entering halfway", "[lead] a slow lead of long notes with vibrato over the peak", "the pad chords changing only every eight or sixteen bars"],
    avoid: ["a drum kit", "verse and chorus", "sudden changes"],
  },
  idm: {
    swing: [0, 0.12], kits: ["synth", "808", "breaks"],
    drums: [
      { kick: "x..x......x.x...", snare: "....X.....o..X..", hat: "x.xx.x.xx.x.xx.x" },
      { kick: "x.....x..x....x.", snare: "...x....X....o..", hat: "xx.x.xx.x.xx.x.x", rim: "..x....x...x...." },
      { kick: "x.x....x..x.....", clap: "......X......X..", hat: "x.x.xxx.x.xx.x.x" },
    ],
    core: { pad: ["dm:oracle/warm pad", "dm:oracle/strings", "dm:tines"], bass: ["dm:sub/pure sine", "dm:hexop/bass", "dm:sub/reese"] },
    optional: { bell: ["dm:hexop/bell", "plaits:12", "dm:oracle/glass"], blip: ["plaits:2", "plaits:10", "plaits:8"], lead: ["dm:ladder/whistle"], texture: ["plaits:3", "dm:drone/bit swarm"] },
    extras: [1, 3],
    bass: ["melancholy chords held two bars each, simple, under the busy drums", "a slow four-chord loop on a soft sound", "one chord a bar with the top note moving as a melody"],
    harmony: ["minor: i min9 - bVI maj7 - bIII maj7 - bVII", "dorian: i min7 - IV", "lydian: I maj7 - II - vi", "major: IV maj7 - I maj7 - vi min7"],
    angles: ANGLES_AT(2, 3, 5, 7),
    moves: ["drum tracks of odd lengths (7, 11, 13 steps) so the beat never repeats exactly", "ratchets and nudges on the hats and snare, a different bar every bar", "the repeat stage or crush on the drums, on a lane", "[bell] a simple, pretty bell melody against the complex drums", "a hat or rim on a live euclid ring with its pulses under an LFO"],
    avoid: ["a plain four on the floor", "a one-bar drum loop", "harsh harmony: the chords are gentle"],
  },
  cinematic: {
    kits: ["drskit", "synth"],
    drums: [
      { boom: "x...............", tom: "............o.xX", crash: "x..............." },
      { boom: "x.......x.......", tom: "....x.....x.x.xx", snare: "............ooxX" },
      { boom: "x.....x...x.....", tom: "..x...x...x...xx" },
    ],
    core: { strings: ["dm:oracle/strings", "dm:oracle/warm pad"], brass: ["dm:breath/french horn", "dm:breath/low brass", "dm:breath/brass section", "dm:oracle/poly brass"] },
    optional: { choir: ["dm:vox/choir aah", "dm:vox/hallelujah", "dm:vox/basso"], piano: ["dm:tines"], sub: ["dm:sub/cinematic drop", "dm:sub/pure sine"], ostinato: ["plaits:11", "dm:oracle/pulse keys", "dm:hexop/marimba"], drone: ["dm:drone/cathedral", "dm:drone/subterranean"] },
    extras: [1, 3],
    bass: ["long string chords, one or two bars each, swelling", "a string ostinato in eighths `x.x.x.x.x.x.x.x.` under held chords", "low strings alone at first, the upper voices added section by section"],
    harmony: ["minor: i - bVI - bIII - bVII", "minor: i - bVI - iv - v", "harmonic minor: i - iv - bVI - V", "lydian: I - II - I, heroic", "dorian: i - IV - bVII - i"],
    forms: ["theme 8 | build 16 | build 16 | climax 16 | fall 8 | theme 8", "quiet 16 | rise 16 | climax 16 | quiet 8", "theme 8 | variation 8 | build 16 | climax 16 | coda 8"],
    angles: ANGLES_AT(2, 3, 5),
    moves: ["one slow build to a single climax: each section louder and fuller than the last", "booms on dm:siege (preset rumble or sub drum) or the low tom, in a huge reverb", "a simple theme of four to eight notes, first quiet, at the climax on the brass", "[choir] a choir on long notes entering at the climax", "a tom or snare roll rising into the climax, then one bar of near silence"],
    avoid: ["a steady drum beat", "the full orchestra from the start", "short dry sounds"],
  },
  drone: {
    layered: true,
    core: { drone: ["dm:drone/dark grone", "dm:drone/cathedral", "dm:drone/glacier", "dm:drone/subterranean", "dm:drone/reverse tide"] },
    optional: { "second drone": ["dm:drone/machine hum", "dm:drone/bit swarm"], sub: ["dm:sub/pure sine"], choir: ["dm:vox/monk chant", "dm:vox/choir aah"], texture: ["plaits:9", "plaits:3"], bell: ["dm:halo/gong", "dm:hexop/bell"] },
    extras: [1, 3],
    bass: ["one chord of two or three notes, struck once and latched for the whole section", "a single note, then a fifth added, then an octave, a section apart", "two notes a second apart, beating against each other"],
    harmony: ["minor: the root and fifth; the b3 arrives halfway", "phrygian: the root, with the b2 fading in and out", "lydian: the root, fifth and #4", "dorian: a stack of fourths on the root"],
    forms: ["A 16 | A' 16 | B 16 | A'' 16", "emerge 16 | hold 16 | shift 16 | hold 16 | fade 16", "A 16 | B 16 | A' 16 | coda 8"],
    moves: ["the drone's cutoff under an LFO sixteen bars or longer", "the cloud (grains) brought in by a lane, then frozen", "one note written per pattern: the latch holds it", "a slow change of the drone's equation or its A1 / A2 between sections", "[bell] a gong or bell once every eight bars, in a long reverb"],
    avoid: ["a beat", "melody", "anything that happens more than once a bar"],
  },
});
Object.assign(PLANS, MORE_PLANS);
for (const g of GENRES) {
  if (PLANS[g.id]) g.plan = PLANS[g.id];
}
for (const id of Object.keys(PLANS)) if (!GENRES.some((g) => g.id === id)) throw new Error(`a plan for no genre: ${id}`);

// One decision, one stream: a hash of (seed, genre, which), so adding a
// decision later does not reshuffle the others (chanceGen.js's bargain).
function rnd(seed, id, key) {
  let h = (2166136261 ^ (Number(seed) >>> 0)) >>> 0;
  const s = id + "|" + key;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// How a part's sound is moved off its preset for this build. A preset is the
// same sound in every song that rolls it, and a model that cannot hear is a
// poor judge of a patch built from nothing, so the roll asks for a direction
// instead: one move, on the knobs whose effect is predictable blind (the
// filter, envelope times, drive, detune). Nothing here touches what a preset
// gets right by ear and a guess gets wrong (FM ratios, formants, amp and cab).
// Low parts have their own pool: a bass is not widened or given a long tail.
const LOW_ROLE = /bass|sub|rumble|reese|wobble|acid|tuba/;
export const LOW_SHAPES = [
  "darker than the preset: its cutoff or tone down a little, the top rolled off",
  "more bite than the preset: its cutoff or tone up a little, a touch of resonance where it has one",
  "tighter than the preset: its decay or sustain shorter, so the notes stop before the next kick",
  "rounder and longer than the preset: its decay a little longer, the attack soft",
  "dirtier than the preset: its drive up a notch, so the harmonics carry on a small speaker",
];
export const VOICE_SHAPES = [
  "darker than the preset: the filter's cutoff down, a touch of resonance",
  "brighter and more open than the preset: its tone or cutoff up, nothing rolled off",
  "shorter and more plucked than the preset: its decay and release down",
  "softer and longer than the preset: a slower attack where it has one, a longer release",
  "dirtier than the preset: its drive up a notch, or a little cassette or shaper in its rack",
  "wider and less steady than the preset: a little more detune, slop, drift or chorus",
];

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
    lift: pick("lift", fam.lifts || LIFTS),
    layered: !!(plan?.layered ?? fam.layered) && r("layered") < 0.5,
  };
  if (!plan) return roll;
  const harmony = pick("harmony", plan.harmony);
  const cut = harmony.indexOf(": ");
  roll.scale = pick("scale", harmony.slice(0, cut).split("/"));
  roll.harmony = harmony.slice(cut + 2);
  if (plan.eighths) roll.eighths = true;
  if (plan.meter) roll.meter = plan.meter;
  roll.steps = plan.steps || 16;
  if (plan.swing) roll.swing = Math.round((plan.swing[0] + r("swing") * (plan.swing[1] - plan.swing[0])) * 100) / 100;
  if (plan.drums?.length) {
    roll.kit = pick("kit", plan.kits);
    roll.drums = pick("drums", plan.drums);
  }
  const voice = (role, pool) => ({ role, ...parseVoice(pick("voice:" + role, pool)) });
  roll.voices = Object.entries(plan.core).map(([role, pool]) => voice(role, pool));
  if (plan.bass) roll.voices[0].how = pick("bass", plan.bass);
  const opt = Object.keys(plan.optional || {});
  const [emin, emax] = plan.extras || [1, 2];
  const n = Math.min(opt.length, emin + Math.floor(r("extras") * (emax - emin + 1)));
  roll.voices.push(...some("extra", opt, n).map((role) => voice(role, plan.optional[role])));
  // Chiptune is the one genre whose sounds are meant to be the bare chip's.
  if (g.id !== "chiptune") {
    for (const v of roll.voices) v.shape = pick("shape:" + v.role, LOW_ROLE.test(v.role) ? LOW_SHAPES : VOICE_SHAPES);
  }
  roll.left = opt.filter((role) => !roll.voices.some((v) => v.role === role));
  const has = new Set(roll.voices.map((v) => v.role));
  const moves = plan.moves.map((m) => /^\[([^\]]+)\] (.*)$/.exec(m) || [m, "", m]).filter((m) => !m[1] || has.has(m[1]));
  roll.moves = some("move", moves.map((m) => m[2]), 2);
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
  if (roll.eighths || roll.meter) {
    const [num, den] = (roll.meter || "4/4").split("/").map(Number);
    const bar = (num * 16) / den / (roll.eighths ? 2 : 1);
    const parts = [];
    if (roll.eighths) parts.push("Write it on an EIGHTH-note grid, which is what lets it swing: every track at speed 0.5 (set_track), so a step is an eighth note and swing delays the offbeat eighths (0.33 is a triplet shuffle). Sixteenths or a triplet inside a beat are a ratchet on that step");
    if (roll.meter) parts.push(`It is in ${roll.meter}: set_meter on every pattern you use`);
    parts.push(`A bar is ${bar} steps, so each step string here (${roll.steps} steps) is ${roll.steps / bar === 1 ? "one bar" : `${roll.steps / bar} bars`}, and pattern lengths are multiples of ${bar}`);
    add(parts.join(". ") + ".");
  }
  if (roll.drums) {
    add(`Drums: ${KITS[roll.kit]}. Start the main section from ${roll.steps === 16 && !roll.eighths && !roll.meter ? "this bar" : "these steps"}, one track per line, and vary it by section: ${
      Object.entries(roll.drums).map(([k, v]) => `${k} \`${v}\``).join(", ")}.`);
  }
  if (roll.voices && !roll.drums) add("No drum kit: a faint pulse at most.");
  for (const v of roll.voices || []) {
    add(`${v.role}: ${v.engine}${v.preset ? `, preset "${v.preset}"` : ""}.${v.how ? ` ${v.how[0].toUpperCase()}${v.how.slice(1)}.` : ""}${v.shape ? ` Then make it this song's: ${v.shape}.` : ""}`);
  }
  if ((roll.voices || []).some((v) => v.shape)) {
    add("Those sound moves are small and on purpose: a preset is where a sound starts, and the move is what keeps it from being the same patch as the last build. Use the knobs the engine has for it (describe_engine names them), a few at most, and leave what the preset tuned by ear alone: an FM voice's ratios and algorithm, formants, the amp and cab. Where the genre or the angle above says otherwise, they win.");
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
  if (g.id !== "chiptune") {
    add("Make it sound like a produced record, not video game music: velocity varied on every part, a few notes nudged off the grid, notes held for their real length with rests at phrase ends, every oscillator shaped (filter, saturation, chorus or tape), and the parts sharing a reverb or delay bus.");
  }
  if (more) lines.push(`Also, and this wins over anything above: ${more}`);
  return lines.join("\n");
}
