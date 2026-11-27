// lib/freesound.js with a fetch of the test's own, and the two compose tools
// over it: CC0 or nothing, lengths and sizes held, a turn's caps counted.
import test from "node:test";
import assert from "node:assert/strict";
import { SOUND_MAX_SECONDS, SoundError, bytesToBase64, fetchSound, isCc0, searchSounds, soundFromApi } from "../lib/freesound.js";
import { anthropicTools, newCtx, resultText, runTool } from "../mcp/composeTurn.mjs";
import { SOUNDS_PER_TURN } from "../mcp/tools.mjs";
import * as sb from "../public/js/songBuilder.js";
import { validateSet } from "../public/js/sessionFormat.js";

const CC0 = "http://creativecommons.org/publicdomain/zero/1.0/";
const BY = "https://creativecommons.org/licenses/by/4.0/";
const raw = (id, over = {}) => ({ id, name: `snare ${id}.wav`, tags: ["snare", "dry"], duration: 0.4, license: CC0, username: "someone",
  previews: { "preview-hq-mp3": `https://cdn.freesound.org/previews/${id}_hq.mp3` }, url: `https://freesound.org/s/${id}/`, ...over });
const AUDIO = new Uint8Array(400).map((_, i) => (i * 37) & 255);

/** A freesound that knows three sounds; `seen` collects what was asked. */
function fake(seen = []) {
  const sounds = { 11: raw(11), 12: raw(12, { license: BY }), 13: raw(13, { duration: 25 }) };
  return async (url, init) => {
    seen.push({ url: String(url), auth: init?.headers?.Authorization });
    const u = new URL(url);
    const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body, arrayBuffer: async () => new ArrayBuffer(0) });
    if (u.hostname === "cdn.freesound.org") return { ok: true, status: 200, arrayBuffer: async () => AUDIO.buffer.slice(0) };
    if (u.pathname === "/apiv2/search/text/") return json({ count: 3, results: Object.values(sounds) });
    const m = u.pathname.match(/^\/apiv2\/sounds\/(\d+)\/$/);
    if (m) return sounds[m[1]] ? json(sounds[m[1]]) : json({ detail: "Not found." }, 404);
    return json({}, 500);
  };
}

test("only CC0 sounds with a preview are offered", () => {
  assert.equal(isCc0(CC0), true);
  assert.equal(isCc0(BY), false);
  assert.equal(soundFromApi(raw(1, { license: BY })), null);
  assert.equal(soundFromApi(raw(1, { previews: {} })), null);
  assert.equal(soundFromApi(raw(1, { previews: { "preview-hq-mp3": "http://plain.example/x.mp3" } })), null, "https only");
  const s = soundFromApi(raw(7));
  assert.deepEqual([s.id, s.license, s.seconds, s.by], [7, "CC0", 0.4, "someone"]);
});

test("a search asks for CC0 under the length, with the key, and drops what is not", async () => {
  const seen = [];
  const out = await searchSounds({ key: "k", query: "  dry   snare ", maxSeconds: 2, fetch: fake(seen) });
  assert.deepEqual(out.sounds.map((s) => s.id), [11], "the CC BY one and the 25s one are gone");
  const u = new URL(seen[0].url);
  assert.equal(seen[0].auth, "Token k");
  assert.equal(u.searchParams.get("query"), "dry snare");
  assert.match(u.searchParams.get("filter"), /license:"Creative Commons 0" duration:\[0\.03 TO 2\]/);
  await assert.rejects(searchSounds({ key: "", query: "x y", fetch: fake() }), (e) => e instanceof SoundError && e.status === 503);
  await assert.rejects(searchSounds({ key: "k", query: " ", fetch: fake() }), (e) => e.status === 400);
});

test("a sound is fetched only if it is CC0 and short enough", async () => {
  const s = await fetchSound({ key: "k", id: 11, maxSeconds: SOUND_MAX_SECONDS.sampler, fetch: fake() });
  assert.equal(s.bytes.length, AUDIO.length);
  assert.equal(Buffer.from(bytesToBase64(s.bytes), "base64").equals(Buffer.from(AUDIO)), true);
  await assert.rejects(fetchSound({ key: "k", id: 12, fetch: fake() }), (e) => e.status === 403 && /not CC0/.test(e.message));
  await assert.rejects(fetchSound({ key: "k", id: 13, maxSeconds: 10, fetch: fake() }), (e) => e.status === 413);
  await assert.rejects(fetchSound({ key: "k", id: 99, fetch: fake() }), (e) => e.status === 404);
  await assert.rejects(fetchSound({ key: "k", id: 11, maxBytes: 100, fetch: fake() }), (e) => e.status === 413);
});

test("the sound tools are only offered where there is a key", () => {
  const names = (o) => anthropicTools(o).map((t) => t.name);
  assert.equal(names().includes("search_sounds"), false);
  assert.equal(names().includes("add_sound_track"), false);
  assert.equal(names({ sounds: true }).includes("search_sounds"), true);
  assert.equal(names({ sounds: true }).length, names().length + 2);
  const r = runTool(newCtx(null), "search_sounds", { query: "kick" });
  return Promise.resolve(r).then((x) => { assert.equal(x.ok, false); assert.match(x.error, /not set up/); });
});

test("a compose turn searches, then puts a sound on a sampler track that loads", async () => {
  const ctx = newCtx(null, { soundsKey: "k" });
  ctx.fetch = fake();
  const found = await runTool(ctx, "search_sounds", { query: "snare", maxSeconds: 2 });
  assert.equal(found.ok, true);
  assert.deepEqual(found.result.map((s) => s.id), [11]);
  assert.ok(resultText("search_sounds", found.result).length < 400, "small in the conversation");

  const made = await runTool(ctx, "add_sound_track", { sound: 11 });
  assert.equal(made.ok, true, made.error);
  const t = ctx.song.tracks[made.result.index];
  assert.equal(t.engineKey, "sampler");
  assert.equal(t.isDrumKit, true, "a snare is a drum");
  assert.equal(t.sampleSource.kind, "upload");
  assert.deepEqual([t.sampleSource.from, t.sampleSource.soundId, t.sampleSource.license], ["freesound", 11, "CC0"]);
  assert.equal(Buffer.from(t.uploadAudio, "base64").length, AUDIO.length);
  assert.equal(t.uploadAudioMime, "audio/mpeg");
  assert.equal(runTool(ctx, "set_steps", { track: made.result.index, steps: "....x.......x..." }).ok, true);
  assert.equal(validateSet(JSON.parse(sb.toJSON(ctx.song))).ok, true);
  // what the model reads back never carries the audio
  assert.match(sb.summarizeTrack(ctx.song, made.result.index).sound, /^freesound 11: /);
  assert.equal(JSON.stringify(sb.summarize(ctx.song)).includes(t.uploadAudio.slice(0, 40)), false);
  assert.equal(JSON.stringify(runTool(ctx, "export_song", {}).result).includes(t.uploadAudio.slice(0, 40)), false);

  const refused = await runTool(ctx, "add_sound_track", { sound: 12 });
  assert.equal(refused.ok, false);
  assert.match(refused.error, /not CC0/);
  const gran = await runTool(ctx, "add_sound_track", { sound: 13, engine: "granular" });
  assert.equal(gran.ok, true, gran.error);
  assert.equal(ctx.song.tracks[gran.result.index].engineKey, "dm:granular");
  assert.equal(ctx.song.tracks[gran.result.index].granularSample, null);

  while (ctx.soundsTaken < SOUNDS_PER_TURN) assert.equal((await runTool(ctx, "add_sound_track", { sound: 11 })).ok, true);
  const over = await runTool(ctx, "add_sound_track", { sound: 11 });
  assert.equal(over.ok, false);
  assert.match(over.error, /sounds this turn already/);
});

test("addTrack refuses an upload where it means nothing", () => {
  const song = sb.newSong();
  const audio = Buffer.from(AUDIO).toString("base64");
  assert.throws(() => sb.addTrack(song, { engine: "silverbox", upload: { name: "x", audio } }), /only applies/);
  assert.throws(() => sb.addTrack(song, { engine: "sampler", sample: "techno kick", upload: { name: "x", audio } }), /not both/);
  assert.throws(() => sb.addTrack(song, { engine: "sampler", upload: { name: "x", audio: "no" } }), /base64/);
});
