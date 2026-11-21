#!/usr/bin/env node
// A fixed set of compose turns, run and scored, so a change to the guide, a
// genre plan, the checks or the model can be compared with what came before.
//
//   ANTHROPIC_API_KEY=... node scripts/compose-eval.mjs [--out eval.json]
//        [--only acid] [--model <id>] [--audition [url]]
//
// Each case is a whole turn through mcp/composeTurn.mjs, the loop the studio's
// panel runs, from an empty song. Genre cases use the picker's own prompt with
// a PINNED seed (app/songs/genres.js), so the brief is the same every run and
// only what is being tested moves. What is scored is what the code can see:
// the production notes left on the song, validation warnings, how much work
// the turn took, and, with --audition, the meters (mcp/audition.mjs, which
// needs playwright and a running studio; the panel's own listen needs a
// browser, so it is not part of a turn here).
//
// It spends real tokens: about a song's worth per case.

import fs from "node:fs";
import * as sb from "../public/js/songBuilder.js";
import { runComposeTurn } from "../mcp/composeTurn.mjs";
import { genreById, genrePrompt } from "../app/songs/genres.js";

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(`--${name}`); return i < 0 ? null : args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : true; };

// Genres across the families, each with a seed that never changes, and a few
// asks in a person's words. Add cases at the end: a case's place in the list
// is not its identity, its name is.
const GENRE_CASES = [
  ["acid", 11], ["techno", 12], ["deep-house", 13], ["dnb", 14], ["trap", 15],
  ["hiphop", 16], ["synthwave", 17], ["dub-techno", 18], ["garage", 19], ["trance", 20],
  ["lofi", 21], ["funk", 22], ["reggae", 23], ["ambient", 24], ["disco", 25],
];
const ASK_CASES = [
  ["ask: whole song", "write me a whole song: a dark, driving techno track with an intro, a build, a drop and an outro"],
  ["ask: a loop", "a slow, warm house loop with a rhodes and a round bass"],
  ["ask: sparse", "something sad and sparse with a nylon guitar and a soft kick"],
  ["ask: chiptune", "an 8-bit chiptune loop, fast and happy"],
];

const cases = [];
for (const [id, seed] of GENRE_CASES) {
  const g = genreById(id);
  if (!g) { console.error(`(no genre ${id}: skipped)`); continue; }
  cases.push({ name: `genre: ${id} #${seed}`, message: genrePrompt(g, "", seed) });
}
for (const [name, message] of ASK_CASES) cases.push({ name, message });

const only = flag("only");
const model = flag("model");
const audition = flag("audition");
const picked = only && only !== true ? cases.filter((c) => c.name.includes(only)) : cases;
if (!process.env.ANTHROPIC_API_KEY) { console.error("set ANTHROPIC_API_KEY (this runs real turns)"); process.exit(1); }

const results = [];
for (const c of picked) {
  process.stderr.write(`${c.name} ... `);
  const row = { name: c.name };
  try {
    const out = await runComposeTurn({
      apiKey: process.env.ANTHROPIC_API_KEY,
      ...(typeof model === "string" ? { model } : {}),
      message: c.message,
      session: JSON.parse(JSON.stringify(sb.newSong())),
      unnamed: true,
    });
    const song = sb.fromBlob(out.session);
    const notes = sb.productionNotes(song);
    Object.assign(row, {
      model: out.model, seconds: Math.round(out.ms / 1000), title: out.title, changed: out.changed,
      ...out.stats, production: notes, warnings: out.warnings, bpm: song.bpm, session: out.session,
    });
    if (audition) {
      const { auditionSong } = await import("../mcp/audition.mjs");
      const heard = await auditionSong(out.session, typeof audition === "string" ? { url: audition } : {});
      row.silent = heard.tracks.filter((t) => t.silent && !t.muted && t.engine !== "bus").map((t) => t.name);
      row.master = heard.master;
    }
    process.stderr.write(`${row.seconds}s, ${row.rounds} rounds, ${notes.length} notes left${row.silent?.length ? `, silent: ${row.silent.join(", ")}` : ""}\n`);
  } catch (e) {
    row.error = String(e?.message || e);
    process.stderr.write(`failed: ${row.error}\n`);
  }
  results.push(row);
}

const ok = results.filter((r) => !r.error);
const mean = (k) => (ok.length ? Math.round((ok.reduce((a, r) => a + (Number(r[k]) || 0), 0) / ok.length) * 100) / 100 : null);
const summary = {
  cases: results.length, failed: results.length - ok.length,
  seconds: mean("seconds"), rounds: mean("rounds"), toolErrors: mean("toolErrors"), nudges: mean("nudges"),
  notesFirst: mean("lintFirst"), notesLeft: ok.length ? Math.round((ok.reduce((a, r) => a + r.production.length, 0) / ok.length) * 100) / 100 : null,
  tracks: mean("tracks"), sections: mean("sections"),
  ...(audition ? { withSilentTracks: ok.filter((r) => r.silent?.length).length } : {}),
};
console.log(JSON.stringify(summary, null, 2));
const outFile = flag("out");
if (typeof outFile === "string") {
  fs.writeFileSync(outFile, JSON.stringify({ at: new Date().toISOString(), summary, results }, null, 1));
  console.error(`wrote ${outFile} (each case's song is in it: import one into the studio to hear it)`);
}
