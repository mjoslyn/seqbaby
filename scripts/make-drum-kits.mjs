#!/usr/bin/env node
// Render the acoustic kits the sampler offers (public/samples/<kit>/<part>.mp3)
// from three open sample libraries. One hit per piece, every mic the library
// records that piece on summed into one stereo file, the way each library's
// own default stereo patch mixes them. The kits and their credits are listed in
// engineData.js (ACOUSTIC_KITS); this is where each file came from.
//
// One-off: run it when a pick changes, and commit the mp3s.
//
//   git clone --depth 1 https://github.com/studiorack/salamander-drumkit
//   git clone --depth 1 https://github.com/sfzinstruments/virtuosity_drums
//   git clone --depth 1 https://github.com/sfzinstruments/DrumGizmo.DRSKit
//   node scripts/make-drum-kits.mjs <folder holding those three>   # needs ffmpeg
//
// - Salamander Drumkit, Alexander Holm (CC BY-SA 3.0): stereo overheads only,
//   so each piece is one file.
// - Virtuosity Drums, Versilian Studios (CC0): the piece's close mic (kick and
//   snare have one), the overhead pair, and the mid and room pairs at half.
// - DRSKit, DrumGizmo / DRSDrums (CC BY 4.0): thirteen mono mics. The piece's
//   own close mics plus overheads and ambience, panned and levelled as the
//   library's stereo patch sets them (toms 0.4 / 0.6 / 0.8 across, hihat 0.3,
//   ride 0.7, the hihat and ride close mics at a tenth, the snare bottom under
//   the kick and toms), with bleed into the other close mics off, as there.
//
// The velocity picked is about four fifths of the way up each piece's range:
// a firm hit, not the hardest, since a step's velocity can only turn it down.
// Every file is peak-normalised to -2dBFS (headroom for the mp3's overshoot), has the silence before the hit cut
// (the Salamander originals carry some), and is faded out by a length that
// suits the piece. 44.1kHz 128kbps stereo, so the three kits cost ~0.8MB.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = resolve(process.argv[2] || join(root, ".."));
const out = join(root, "public", "samples");

// The longest each piece is allowed to ring, in seconds.
const MAX_LEN = { kick: 1.5, snare: 1.2, rim: 0.8, hihat: 0.6, openhat: 2, tom1: 2, tom2: 2.5, ride: 3, crash: 3.5 };

// ---- picking a file --------------------------------------------------------------

/** `round(0.8 * n)`, at least 1: four fifths of the way up a range of n. */
const firm = (n) => Math.max(1, Math.round(n * 0.8));

/** Virtuosity names a hit `<mic>_<piece>_<artic>_vl<V>[_rr<R>].flac`. */
function virtuosityHit(piece, artic) {
  const dir = join(src, "virtuosity_drums/Samples/oh", piece);
  const re = new RegExp(`^oh_${piece}_${artic}_vl(\\d+)(?:_rr(\\d+))?\\.flac$`);
  const vls = readdirSync(dir).map(f => re.exec(f)).filter(Boolean).map(m => Number(m[1]));
  if (!vls.length) throw new Error(`virtuosity: no ${piece} ${artic}`);
  const vl = firm(Math.max(...vls));
  const rr = readdirSync(dir).some(f => f === `oh_${piece}_${artic}_vl${vl}_rr1.flac`) ? "_rr1" : "";
  return (mic) => join(src, "virtuosity_drums/Samples", mic, piece, `${mic}_${piece}_${artic}_vl${vl}${rr}.flac`);
}

/** DrumGizmo numbers a piece's hits 1..n, quietest first: `<i>-<piece>-<mic>.flac`. */
function drsHit(piece) {
  const dir = join(src, "DrumGizmo.DRSKit/DrumGizmo/DRSKit/Samples", piece);
  const n = readdirSync(dir).filter(f => f.endsWith("-OHL.flac")).length;
  const i = firm(n);
  return (mic) => join(dir, `${i}-${piece}-${mic}.flac`);
}

const sal = (name) => join(src, "salamander-drumkit/Samples", `${name}.flac`);

// ---- the kits ----------------------------------------------------------------------

// An input is [file, gain, pan]: pan is -1..1 for a mono mic, null for a pair.
const virtuosity = (piece, artic, close) => {
  const f = virtuosityHit(piece, artic);
  return [...(close ? [[f(close), 1, 0]] : []), [f("oh"), 1, null], [f("mid"), 0.5, null], [f("room"), 0.5, null]];
};
// The library's 0..1 pan knob as -1..1.
const knob = (v) => v * 2 - 1;
const drs = (piece, close) => {
  const f = drsHit(piece);
  return [
    ...close.map(([mic, gain, pan]) => [f(mic), gain, pan]),
    [f("OHL"), 1, -1], [f("OHR"), 1, 1], [f("AmbL"), 1, -1], [f("AmbR"), 1, 1],
  ];
};

const KITS = {
  salamander: {
    kick: [[sal("kick_OH_FF_1"), 1, null]],
    snare: [[sal("snare_OH_FF_1"), 1, null]],
    rim: [[sal("snareStick_OH_F_1"), 1, null]],
    hihat: [[sal("hihatClosed_OH_F_1"), 1, null]],
    openhat: [[sal("hihatOpen_OH_F_1"), 1, null]],
    tom1: [[sal("hiTom_OH_FF_1"), 1, null]],
    tom2: [[sal("loTom_OH_FF_1"), 1, null]],
    ride: [[sal("ride1_OH_FF_1"), 1, null]],
    crash: [[sal("crash1_OH_FF_1"), 1, null]],
  },
  virtuosity: {
    kick: virtuosity("kick", "snoff", "kickmic"),
    snare: virtuosity("snare", "center", "snaremic"),
    rim: virtuosity("snare", "crossstick", "snaremic"),
    hihat: virtuosity("hh", "closed"),
    openhat: virtuosity("hh", "open"),
    tom1: virtuosity("htom", "center"),
    tom2: virtuosity("ltom", "center"),
    ride: virtuosity("ride", "ride"),
    crash: virtuosity("crash", "crash"),
  },
  drskit: {
    kick: drs("Kdrum_without_contact", [["Kdrum_back", 1, 0], ["Kdrum_front", 1, 0], ["Snare_bottom", 1, 0]]),
    snare: drs("Snare", [["Snare_top", 1, 0], ["Snare_bottom", 1, 0]]),
    rim: drs("Snare_rim", [["Snare_top", 1, 0], ["Snare_bottom", 1, 0]]),
    hihat: drs("Hihat_closed", [["Hihat", 0.1, knob(0.3)]]),
    openhat: drs("Hihat_open", [["Hihat", 0.1, knob(0.3)]]),
    tom1: drs("Tom1", [["Tom1", 1, knob(0.4)], ["Snare_bottom", 1, 0]]),
    tom2: drs("Tom3", [["Tom3", 1, knob(0.8)], ["Snare_bottom", 1, 0]]),
    ride: drs("Ride_tip", [["Ride", 0.1, knob(0.7)]]),
    crash: drs("Crash_left_tip", []),
  },
};

// ---- rendering -----------------------------------------------------------------------

const ff = (args) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: ["ignore", "pipe", "pipe"] });
const probe = (f) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString());
// The true sample peak, from astats on stderr. Not volumedetect: it stops
// counting at 0dBFS, and summing a dozen mics goes well past that.
const peakDb = (f) => {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-i", f, "-af", "astats=measure_perchannel=none", "-f", "null", "-"], { encoding: "utf8" });
  return Number(/Peak level dB: (-?[\d.]+)/.exec(r.stderr)?.[1] ?? 0);
};

const tmp = join(tmpdir(), "seqbaby-kits");
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });

for (const [kit, pieces] of Object.entries(KITS)) {
  mkdirSync(join(out, kit), { recursive: true });
  for (const [part, inputs] of Object.entries(pieces)) {
    for (const [f] of inputs) if (!existsSync(f)) throw new Error(`missing ${f}`);
    // 1. every mic to stereo at 44.1k, panned (equal power) and levelled, then summed
    const chains = inputs.map(([, gain, pan], i) => {
      if (pan == null) return `[${i}]aresample=44100,aformat=channel_layouts=stereo,volume=${gain}[m${i}]`;
      const a = (pan + 1) * Math.PI / 4;
      const l = (Math.cos(a) * gain).toFixed(4), r = (Math.sin(a) * gain).toFixed(4);
      return `[${i}]aresample=44100,aformat=channel_layouts=mono,pan=stereo|c0=${l}*c0|c1=${r}*c0[m${i}]`;
    });
    const mixed = join(tmp, `${kit}-${part}-mix.wav`);
    const sum = inputs.length > 1
      ? `${inputs.map((_, i) => `[m${i}]`).join("")}amix=inputs=${inputs.length}:normalize=0:duration=longest[mix]`
      : `[m0]anull[mix]`;
    ff([...inputs.flatMap(([f]) => ["-i", f]), "-filter_complex", [...chains, sum].join(";"), "-map", "[mix]", "-c:a", "pcm_f32le", mixed]);
    // 2. normalise, cut the silence before the hit, cap the length
    const gain = -2 - peakDb(mixed);
    const cut = join(tmp, `${kit}-${part}-cut.wav`);
    ff(["-i", mixed, "-af", `volume=${gain.toFixed(2)}dB,silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.001`, "-c:a", "pcm_f32le", cut]);
    const len = Math.min(probe(cut), MAX_LEN[part]);
    const fade = Math.min(len * 0.4, MAX_LEN[part] * 0.4);
    const dest = join(out, kit, `${part}.mp3`);
    ff(["-i", cut, "-af", `atrim=0:${len},afade=t=out:st=${(len - fade).toFixed(3)}:d=${fade.toFixed(3)}`,
      "-c:a", "libmp3lame", "-b:a", "128k", "-ar", "44100", "-ac", "2", dest]);
    console.log(`${kit}/${part}.mp3  ${len.toFixed(2)}s  ${inputs.map(([f]) => f.split("/").pop()).join(" + ")}`);
  }
}
rmSync(tmp, { recursive: true, force: true });
