// The critic turn's pure half: which turns are reviewed, what the critic is
// sent, and how its reply is read. The call itself is given a stand-in client.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as sb from "../public/js/songBuilder.js";
import { CRITIC_MAX_NOTES, CRITIC_SYSTEM, criticBrief, criticNudge, criticWanted, critique, parseCritique, partsWritten, songForCritic } from "../mcp/critic.mjs";

const song = () => {
  const s = sb.newSong({ bpm: 124 });
  sb.addTrack(s, { engine: "dm:808-kick", name: "kick" });
  sb.addTrack(s, { engine: "dm:silverbox", name: "bass" });
  sb.addTrack(s, { engine: "dm:poly-saw", name: "chords" });
  return s;
};

test("only a turn that wrote a few parts is reviewed", () => {
  const s = song();
  const before = JSON.stringify(s);
  sb.setFilter(s, 1, { cutoff: 0.4 });
  sb.setTempo(s, { bpm: 130 });
  assert.equal(partsWritten(before, s), 0);
  assert.equal(criticWanted(before, s), false, "a sound edit is not");
  sb.setSteps(s, 0, { steps: "x...x...x...x..." });
  sb.setSteps(s, 1, { steps: "X.x_o.X_..x.Xo..", notes: ["C2", "Eb2"] });
  assert.equal(criticWanted(before, s), false, "two parts are not");
  sb.setSteps(s, 2, { steps: "x_______x_______", notes: ["C4", "Ab3"] });
  assert.equal(partsWritten(before, s), 3);
  assert.equal(criticWanted(before, s), true);
  // unchanged from here on: nothing written since
  assert.equal(partsWritten(JSON.stringify(s), s), 0);
});

test("the brief holds the request and the song, not the per-step detail", () => {
  const s = song();
  const before = JSON.stringify(s);
  sb.setSteps(s, 1, { steps: "X.x_o.X_..x.Xo..", notes: ["C2", "Eb2"] });
  const read = songForCritic(s);
  assert.equal(read.tracks[0].role, "kick");
  assert.equal(read.tracks[1].patterns[0].steps, "X.x_o.X_..x.Xo..");
  assert.ok(!("detail" in read.tracks[1].patterns[0]));
  const brief = criticBrief(s, "an acid loop", before);
  assert.match(brief, /<request>\nan acid loop\n<\/request>/);
  assert.match(brief, /was empty before this turn/);
  assert.match(criticBrief(s, "more", JSON.stringify(s)), /already had music/);
});

test("a reply is read as a verdict and at most a few notes", () => {
  assert.deepEqual(parseCritique("VERDICT: pass"), { pass: true, notes: [] });
  const r = parseCritique("Some preamble.\nVERDICT: revise\n- track 1 (bass), pattern 0: follow the roots\n* track 2: thin the chords\n\n- a\n- b\n- c");
  assert.equal(r.pass, false);
  assert.equal(r.notes.length, CRITIC_MAX_NOTES);
  assert.equal(r.notes[0], "track 1 (bass), pattern 0: follow the roots");
  // revise with nothing to act on is a pass; no verdict is no review
  assert.deepEqual(parseCritique("VERDICT: revise\nIt could be better."), { pass: true, notes: [] });
  assert.equal(parseCritique("I think it's fine."), null);
  assert.equal(parseCritique(""), null);
  assert.ok(parseCritique(`VERDICT: revise\n- ${"x".repeat(2000)}`).notes[0].length < 500);
  assert.equal(criticNudge([]), null);
  assert.match(criticNudge(r.notes), /- track 1 \(bass\)[\s\S]*no second review/);
  assert.match(CRITIC_SYSTEM, /VERDICT: pass/);
});

test("the call: one request without tools, and a failure is no review", async () => {
  const s = song();
  let sent = null;
  const client = (reply) => ({ messages: { stream: (req) => { sent = req; return { finalMessage: async () => reply }; } } });
  const ok = await critique({ anthropic: client({ stop_reason: "end_turn", usage: { input_tokens: 9, output_tokens: 3 }, content: [{ type: "thinking", thinking: "" }, { type: "text", text: "VERDICT: revise\n- track 1: move" }] }), model: "m", song: s, message: "acid", before: JSON.stringify(s) });
  assert.deepEqual(ok.notes, ["track 1: move"]);
  assert.equal(ok.usage.input_tokens, 9);
  assert.equal(sent.model, "m");
  assert.equal(sent.tools, undefined);
  assert.equal(sent.system, CRITIC_SYSTEM);
  assert.equal(await critique({ anthropic: client({ stop_reason: "refusal", content: [] }), model: "m", song: s, message: "x", before: "{}" }), null);
  const broken = { messages: { stream: () => { throw new Error("down"); } } };
  const err = console.error; console.error = () => {};
  try { assert.equal(await critique({ anthropic: broken, model: "m", song: s, message: "x", before: "{}" }), null); } finally { console.error = err; }
});
