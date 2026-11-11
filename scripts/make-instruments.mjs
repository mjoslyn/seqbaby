#!/usr/bin/env node
// Render the multisampled instruments (public/samples/inst/<id>/<note>.mp3)
// from nbrosowsky/tonejs-instruments (code MIT; samples from open libraries,
// edited there for consistency). The instruments and their credits are
// INSTRUMENTS in engineData.js; this is where each file came from.
//
// One-off: run it when a pick changes, and commit the mp3s.
//
//   git clone --depth 1 https://github.com/nbrosowsky/tonejs-instruments
//   node scripts/make-instruments.mjs <that folder>   # needs ffmpeg
//
// The originals are 192kbps mono and ring for up to 17s, ~90MB for the four.
// Each is cut to the length below with a fade over its last second, and
// re-encoded 44.1kHz 96kbps mono, which brings the four to a few MB. Levels
// are left as the repo matched them, so notes sit together across the range.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = resolve(process.argv[2] || join(root, "..", "tonejs-instruments"));
const out = join(root, "public", "samples", "inst");

// id here -> the repo's folder, and the longest a note may ring (seconds).
const PICKS = {
  "guitar-acoustic": { from: "guitar-acoustic", len: 5 },
  "guitar-nylon": { from: "guitar-nylon", len: 4.5 },
  "guitar-electric": { from: "guitar-electric", len: 4 },
  "bass-electric": { from: "bass-electric", len: 4 },
};

for (const [id, { from, len }] of Object.entries(PICKS)) {
  const dir = join(src, "samples", from);
  if (!existsSync(dir)) throw new Error(`missing ${dir}`);
  const dest = join(out, id);
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  const notes = readdirSync(dir).filter((f) => f.endsWith(".mp3"));
  for (const f of notes) {
    const fade = `afade=t=out:st=${len - 1}:d=1`;
    execFileSync("ffmpeg", ["-v", "error", "-y", "-i", join(dir, f), "-t", String(len), "-af", fade,
      "-ac", "1", "-ar", "44100", "-b:a", "96k", join(dest, f)]);
  }
  console.log(`${id}: ${notes.length} notes`);
}
