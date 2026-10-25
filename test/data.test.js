// The data layer's access rules, over the real schema (db/migrations) on
// node:sqlite and an in-memory R2. These replace supabase/tests/rls_test.sql:
// with D1 there is no Row Level Security, so every rule it held is a WHERE
// clause in lib/data/*.js, and this file is what says each one is there.

import test from "node:test";
import assert from "node:assert/strict";
import { makeEnv } from "./helpers/cf.js";
import { createProfile } from "../lib/auth/config.js";
import * as songs from "../lib/data/songs.js";
import * as patches from "../lib/data/patches.js";
import * as profiles from "../lib/data/profiles.js";
import { INLINE_MAX } from "../lib/data/blob.js";

async function user(env, id, email) {
  env.DB.sqlite
    .prepare(`insert into "user" (id, name, email, emailVerified, createdAt, updatedAt) values (?, '', ?, 1, '2026-01-01', '2026-01-01')`)
    .run(id, email);
  await createProfile(env.DB, { id, email });
  return id;
}

const session = (n = 1) => ({
  _version: 3,
  bpm: 120 + n,
  activePattern: 0,
  tracks: [
    {
      engineKey: "dm:silverbox",
      name: "acid",
      length: 16,
      patterns: [{ steps: Array.from({ length: 16 }, (_, i) => i % 4 === 0), velocities: [], lengths: [] }],
    },
    { engineKey: "bus", name: "fx", length: 16, patterns: [] },
  ],
});

async function world() {
  const env = makeEnv();
  const alice = await user(env, "00000000-0000-4000-8000-00000000000a", "alice@example.com");
  const bob = await user(env, "00000000-0000-4000-8000-00000000000b", "bob@example.com");
  return { env, alice, bob };
}

test("a new account gets a profile named from its email, unique case-insensitively", async () => {
  const env = makeEnv();
  await user(env, "00000000-0000-4000-8000-000000000001", "Mike@example.com");
  await user(env, "00000000-0000-4000-8000-000000000002", "mike@other.com");
  const rows = env.DB.sqlite.prepare("select username from profiles order by created_at, username").all();
  assert.deepEqual(rows.map((r) => r.username).sort(), ["mike", "mike-2"]);
});

test("a song is its owner's: nobody else reads a private one, writes it, or sees its versions", async () => {
  const { env, alice, bob } = await world();
  const saved = await songs.saveSong(env, alice, { title: "mine", data: session() });
  assert.ok(saved.id && saved.versionId, JSON.stringify(saved));

  assert.equal((await songs.loadSong(env, bob, saved.id)).error, "song not found");
  assert.equal((await songs.loadSong(env, null, saved.id)).error, "song not found");
  assert.equal((await songs.loadSong(env, alice, saved.id)).owned, true);

  // Another account naming the id gets nothing written.
  assert.equal((await songs.saveSong(env, bob, { id: saved.id, title: "taken", data: session(2) })).error, "song not found");
  assert.equal((await songs.renameSong(env, bob, saved.id, "x")).error, "song not found");
  assert.equal((await songs.deleteSong(env, bob, saved.id)).error, "song not found");
  assert.equal((await songs.publishSong(env, bob, saved.id)).error, "song not found");
  assert.equal((await songs.loadSong(env, alice, saved.id)).title, "mine");

  assert.deepEqual((await songs.listVersions(env, bob, saved.id)).versions, []);
  assert.equal((await songs.loadVersion(env, bob, saved.versionId)).error, "version not found");
  assert.equal((await songs.labelVersion(env, bob, saved.versionId, "x")).error, "version not found");
});

test("publishing makes a song readable by anyone, and never its versions", async () => {
  const { env, alice, bob } = await world();
  const saved = await songs.saveSong(env, alice, { title: "out", data: session() });
  const { slug } = await songs.publishSong(env, alice, saved.id);
  assert.ok(slug);
  const seen = await songs.loadSong(env, null, saved.id);
  assert.equal(seen.owned, false);
  assert.equal(seen.data.bpm, 121);
  assert.deepEqual((await songs.listVersions(env, bob, saved.id)).versions, []);
  assert.equal((await songs.loadVersion(env, null, saved.versionId)).error, "not signed in");

  await songs.unpublishSong(env, alice, saved.id);
  assert.equal((await songs.loadSong(env, bob, saved.id)).error, "song not found");
});

test("saving appends a version off its parent, so loading an old one and saving branches", async () => {
  const { env, alice } = await world();
  const v1 = await songs.saveSong(env, alice, { title: "tree", data: session(1) });
  const v2 = await songs.saveSong(env, alice, { id: v1.id, title: "tree", data: session(2) });
  const v3 = await songs.saveSong(env, alice, { id: v1.id, title: "tree", data: session(3), parentVersionId: v1.versionId });
  assert.deepEqual([v1.versionSeq, v2.versionSeq, v3.versionSeq], [1, 2, 3]);
  const { versions, currentId } = await songs.listVersions(env, alice, v1.id);
  assert.equal(currentId, v3.versionId);
  assert.equal(versions.find((v) => v.id === v3.versionId).parent_id, v1.versionId, "a branch off v1");

  // The same data as its parent is the parent, not a new row.
  const again = await songs.saveSong(env, alice, { id: v1.id, title: "tree", data: session(3) });
  assert.equal(again.unchanged, true);
  assert.equal(again.versionId, v3.versionId);

  // The tip and a version with children cannot be deleted; a leaf can.
  assert.equal((await songs.deleteVersion(env, alice, v3.versionId)).error, "that is the current version");
  assert.equal((await songs.deleteVersion(env, alice, v1.versionId)).error, "delete the branches off it first");
  assert.equal((await songs.deleteVersion(env, alice, v2.versionId)).ok, true);
});

test("the lists' columns are written with the song", async () => {
  const { env, alice } = await world();
  const saved = await songs.saveSong(env, alice, { title: "cols", data: session(7) });
  const row = env.DB.sqlite.prepare("select bpm, preview, engines from songs where id = ?").get(saved.id);
  assert.equal(row.bpm, 127);
  assert.deepEqual(JSON.parse(row.engines), ["dm:silverbox"], "buses left out");
  assert.ok(JSON.parse(row.preview).t.length >= 1);
});

test("samples are lifted into R2 once per song, and put back on every read", async () => {
  const { env, alice, bob } = await world();
  const data = session();
  const audio = "UklGR".padEnd(4000, "A");
  data.tracks[0].uploadAudio = audio;
  const saved = await songs.saveSong(env, alice, { title: "sampled", data });
  const stored = JSON.parse(env.DB.sqlite.prepare("select data from songs where id = ?").get(saved.id).data);
  assert.match(stored.tracks[0].uploadAudio, /^@sample:[0-9a-f]{64}$/);
  const keys = [...env.BLOBS.objects.keys()].filter((k) => k.includes("/samples/"));
  assert.equal(keys.length, 1);
  assert.equal((await songs.loadSong(env, alice, saved.id)).data.tracks[0].uploadAudio, audio);

  // A remix gets its own copies, under its own song.
  await songs.publishSong(env, alice, saved.id);
  const remix = await songs.remixSong(env, bob, saved.id);
  assert.ok(remix.id);
  assert.equal((await songs.loadSong(env, bob, remix.id)).data.tracks[0].uploadAudio, audio);
  // Deleting the source leaves the remix's samples where they are.
  await songs.deleteSong(env, alice, saved.id);
  assert.equal([...env.BLOBS.objects.keys()].some((k) => k.startsWith(`songs/${saved.id}/`)), false);
  assert.equal((await songs.loadSong(env, bob, remix.id)).data.tracks[0].uploadAudio, audio);
});

test("a session too big for a D1 row goes to R2 and comes back whole", async () => {
  const { env, alice } = await world();
  const data = session();
  data.tracks[0].notes = "x".repeat(INLINE_MAX + 10);
  const saved = await songs.saveSong(env, alice, { title: "big", data });
  const col = env.DB.sqlite.prepare("select data from songs where id = ?").get(saved.id).data;
  assert.ok(col.length < 200 && col.includes("$r2"), col.slice(0, 80));
  assert.equal((await songs.loadSong(env, alice, saved.id)).data.tracks[0].notes.length, INLINE_MAX + 10);
});

test("only a public song can be liked, and a like is your own", async () => {
  const { env, alice, bob } = await world();
  const saved = await songs.saveSong(env, alice, { title: "likes", data: session() });
  assert.equal((await songs.setLike(env, bob, saved.id, true)).error, "song not found", "private");
  await songs.publishSong(env, alice, saved.id);
  assert.equal((await songs.setLike(env, bob, saved.id, true)).likes, 1);
  assert.equal((await songs.setLike(env, bob, saved.id, true)).likes, 1, "idempotent");
  assert.equal((await songs.setLike(env, null, saved.id, true)).error, "not signed in");
  assert.deepEqual(await songs.likedSongs(env, bob, [saved.id]), [saved.id]);
  assert.deepEqual(await songs.likedSongs(env, alice, [saved.id]), []);
  assert.equal((await songs.setLike(env, bob, saved.id, false)).likes, 0);
});

test("a compose chat is its author's alone, both ways", async () => {
  const { env, alice, bob } = await world();
  const saved = await songs.saveSong(env, alice, { title: "chat", data: session() });
  await songs.publishSong(env, alice, saved.id);
  await songs.saveSongChat(env, alice, saved.id, [{ role: "user", text: "make it faster" }]);
  assert.equal((await songs.loadSongChat(env, alice, saved.id)).messages.length, 1);
  assert.deepEqual((await songs.loadSongChat(env, bob, saved.id)).messages, [], "a public song's chat stays private");
  assert.equal((await songs.saveSongChat(env, bob, saved.id, [])).error, "song not found");
  assert.equal((await songs.loadSongChat(env, alice, saved.id)).messages[0].text, "make it faster");
});

test("templates: at most one default, and the first save off one makes a new song", async () => {
  const { env, alice } = await world();
  const a = await songs.saveSong(env, alice, { title: "a", data: session(1) });
  const b = await songs.saveSong(env, alice, { title: "b", data: session(2) });
  await songs.setDefaultTemplate(env, alice, a.id);
  await songs.setDefaultTemplate(env, alice, b.id);
  const n = env.DB.sqlite.prepare("select count(*) as n from songs where is_default_template = 1").get().n;
  assert.equal(n, 1);
  assert.equal((await songs.getDefaultTemplate(env, alice)).template.id, b.id);

  const made = await songs.saveSong(env, alice, { id: b.id, title: "b", data: session(3), fromTemplateId: b.id, titleGenerated: true });
  assert.notEqual(made.id, b.id);
  assert.equal(made.title, "b 2", "never the template's own name");
  const row = env.DB.sqlite.prepare("select forked_from, is_template from songs where id = ?").get(made.id);
  assert.equal(row.forked_from, b.id);
  assert.equal(row.is_template, 0);
});

test("a patch is its owner's; a public one can be copied, liked, and played by anyone", async () => {
  const { env, alice, bob } = await world();
  const { id } = await patches.putPatch(env, alice, "bass", { _kind: "track-patch", engineKey: "dm:sub", isDrumKit: false });
  assert.equal((await patches.patchConfig(env, bob, id)).error, "patch not found");
  assert.equal((await patches.savePatchToBay(env, bob, id)).error, "patch not found");
  assert.equal((await patches.setPatchLike(env, bob, id, true)).error, "patch not found");
  assert.equal((await patches.deletePatch(env, bob, id)).error, "patch not found");
  assert.equal((await patches.setPatchPublic(env, bob, id, true)).error, "patch not found");

  await patches.setPatchPublic(env, alice, id, true);
  assert.equal((await patches.patchConfig(env, null, id)).config.engineKey, "dm:sub");
  const copy = await patches.savePatchToBay(env, bob, id);
  assert.ok(copy.id && copy.id !== id);
  assert.equal((await patches.savePatchToBay(env, bob, id)).already, true, "a second save finds the first");
  assert.deepEqual((await patches.savedFrom(env, bob, [id])).sort(), [id]);
  assert.equal((await patches.setPatchLike(env, bob, id, true)).likes, 1);

  const row = env.DB.sqlite.prepare("select engine_key, kind, drum from patches where id = ?").get(id);
  assert.deepEqual({ ...row }, { engine_key: "dm:sub", kind: "track-patch", drum: "false" });
});

test("saving a patch by name replaces the one of that name, and the bay lists one per name", async () => {
  const { env, alice } = await world();
  const a = await patches.putPatch(env, alice, "lead", { _kind: "track-patch", engineKey: "dm:hexop" });
  const b = await patches.putPatch(env, alice, "lead", { _kind: "track-patch", engineKey: "dm:oracle" });
  assert.equal(a.id, b.id);
  const bay = await patches.bayIndex(env, alice);
  assert.equal(bay.length, 1);
  assert.equal(bay[0].engineKey, "dm:oracle");
  assert.equal(bay[0].config, undefined, "a track patch's config is fetched when loaded");

  const moved = await patches.importPatches(env, alice, {
    lead: { _kind: "track-patch", engineKey: "dm:oracle" },
    pad: { type: "PolySynth" },
  });
  assert.deepEqual(moved.moved.sort(), ["lead", "pad"]);
  assert.equal((await patches.bayIndex(env, alice)).length, 2, "the identical one was not copied");
});

test("a private profile shows only to its owner, and never hides attribution", async () => {
  const { env, alice, bob } = await world();
  const saved = await songs.saveSong(env, alice, { title: "credited", data: session() });
  await songs.publishSong(env, alice, saved.id);
  await profiles.updateProfile(env, alice, { bio: "secret bio", is_public: false });

  const asBob = await profiles.getPublicProfile(env, bob, "ALICE");
  assert.deepEqual(asBob, { private: true, username: "alice" });
  const asAlice = await profiles.getPublicProfile(env, alice, "alice");
  assert.equal(asAlice.profile.bio, "secret bio");
  assert.equal(asAlice.songs.length, 1);

  const cards = await profiles.profileCards(env, [alice]);
  assert.equal(cards[0].username, "alice");
  assert.equal("bio" in cards[0], false, "attribution never carries the bio");

  assert.deepEqual(await profiles.getPublicProfile(env, bob, "a_ice"), { notFound: true }, "no LIKE wildcards");
});

test("profile edits are checked, and names stay unique ignoring case", async () => {
  const { env, alice, bob } = await world();
  assert.equal((await profiles.updateProfile(env, bob, { username: "ALICE" })).error, "that name is taken");
  assert.match((await profiles.updateProfile(env, bob, { username: "a b" })).error, /name/);
  assert.match((await profiles.updateProfile(env, bob, { avatar_url: "http://x/y.png" })).error, /https/);
  assert.match((await profiles.updateProfile(env, bob, { avatar_grid: "z".repeat(256) })).error, /grid/);
  assert.equal((await profiles.updateProfile(env, bob, { avatar_grid: "1".repeat(256) })).ok, true);
  assert.equal((await profiles.updateProfile(env, null, { bio: "x" })).error, "not signed in");
  assert.equal((await profiles.getMyProfile(env, alice)).username, "alice");
});

test("deleting a user takes everything of theirs with it", async () => {
  const { env, alice, bob } = await world();
  const saved = await songs.saveSong(env, alice, { title: "gone", data: session() });
  await songs.publishSong(env, alice, saved.id);
  await songs.setLike(env, bob, saved.id, true);
  await patches.putPatch(env, alice, "p", { engineKey: "dm:sub" });
  env.DB.sqlite.prepare('delete from "user" where id = ?').run(alice);
  for (const t of ["profiles", "songs", "song_versions", "song_likes", "patches"]) {
    const n = env.DB.sqlite.prepare(`select count(*) as n from ${t} where ${t === "profiles" ? "id" : t === "song_likes" ? "song_id" : "owner_id"} = ?`).get(t === "song_likes" ? saved.id : alice).n;
    assert.equal(n, 0, t);
  }
  assert.ok(await profiles.getMyProfile(env, bob), "nobody else's");
});
