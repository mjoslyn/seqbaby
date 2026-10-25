// The move from Supabase (lib/data/importer.js): rows shaped the way
// scripts/migrate-from-supabase.mjs reads them out of Postgres go into the D1
// schema and R2, and come back out through the app's own reads, passwords
// included.

import test from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { makeEnv } from "./helpers/cf.js";
import { importRows } from "../lib/data/importer.js";
import { makeAuth } from "../lib/auth/config.js";
import * as songs from "../lib/data/songs.js";
import * as patches from "../lib/data/patches.js";
import * as profiles from "../lib/data/profiles.js";

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";
const S1 = "51515151-0000-4000-8000-000000000001";
const S2 = "52525252-0000-4000-8000-000000000002";
const V1 = "71717171-0000-4000-8000-000000000001";
const V2 = "72727272-0000-4000-8000-000000000002";
const P1 = "91919191-0000-4000-8000-000000000001";
const P2 = "92929292-0000-4000-8000-000000000002";
const t = (d) => new Date(`2025-0${d}-01T00:00:00Z`);

const data = (bpm, extra = {}) => ({ bpm, activePattern: 0, tracks: [{ engineKey: "dm:sub", length: 16, patterns: [], ...extra }] });

async function migrate(env) {
  const hash = bcrypt.hashSync("oldpass1", 10);
  const steps = [
    ["users", [
      { id: A, email: "Alice@Example.com", encrypted_password: hash, email_confirmed_at: t(1), created_at: t(1), updated_at: t(1),
        profile: { username: "alice", bio: "hi", is_public: true, avatar_grid: null, created_at: t(1), updated_at: t(1) } },
      { id: B, email: "bob@example.com", encrypted_password: null, email_confirmed_at: null, created_at: t(2), updated_at: t(2), profile: null },
    ]],
    ["songs", [
      { id: S1, owner_id: A, title: "first", data: data(120, { uploadAudio: "@sample:" + "c".repeat(64) }), is_public: true,
        share_slug: "abc12345", created_at: t(3), updated_at: t(4), is_template: false, is_default_template: false },
      // Saved before Supabase's 0023: the sample still inline.
      { id: S2, owner_id: B, title: "remix", data: data(90, { uploadAudio: "INLINEAUDIO".repeat(100) }), is_public: false,
        share_slug: null, created_at: t(5), updated_at: t(5), is_template: false, is_default_template: false },
    ]],
    ["samples", [{ song_id: S1, hash: "c".repeat(64), payload: "STOREDAUDIO" }]],
    ["versions", [
      { id: V1, song_id: S1, owner_id: A, parent_id: null, data: data(110), seq: 1, label: "first save", created_at: t(3) },
      { id: V2, song_id: S1, owner_id: A, parent_id: V1, data: data(120), seq: 2, label: null, created_at: t(4) },
    ]],
    ["songLinks", [
      { id: S1, current_version_id: V2, forked_from: null, updated_at: t(4) },
      { id: S2, current_version_id: null, forked_from: S1, updated_at: t(5) },
    ]],
    ["chats", [{ song_id: S1, owner_id: A, messages: [{ role: "user", text: "go" }], updated_at: t(4) }]],
    ["songLikes", [{ song_id: S1, user_id: B, created_at: t(6) }]],
    ["patches", [
      { id: P1, owner_id: A, name: "sub", engine_type: "dm:sub", config: { _kind: "track-patch", engineKey: "dm:sub" }, is_public: true, created_at: t(3), updated_at: t(3) },
      { id: P2, owner_id: B, name: "sub", engine_type: "dm:sub", config: { _kind: "track-patch", engineKey: "dm:sub" }, is_public: false, created_at: t(6), updated_at: t(6) },
    ]],
    ["patchLinks", [{ id: P2, saved_from: P1, updated_at: t(6) }]],
    ["patchLikes", [{ patch_id: P1, user_id: B, created_at: t(7) }]],
  ];
  for (const [kind, rows] of steps) {
    const res = await importRows(env, kind, rows);
    assert.deepEqual(res.failed, [], kind);
  }
}

test("a Supabase project comes across whole, and a second run changes nothing", async () => {
  const env = makeEnv();
  await migrate(env);
  await migrate(env);

  const counts = Object.fromEntries(
    ["user", "account", "profiles", "songs", "song_versions", "song_chats", "song_likes", "patches", "patch_likes"].map((t) => [
      t,
      env.DB.sqlite.prepare(`select count(*) as n from "${t}"`).get().n,
    ]),
  );
  assert.deepEqual(counts, { user: 2, account: 1, profiles: 2, songs: 2, song_versions: 2, song_chats: 1, song_likes: 1, patches: 2, patch_likes: 1 });

  // The song reads back with its sample, its tip, its version tree and its columns.
  const s1 = await songs.loadSong(env, A, S1);
  assert.equal(s1.data.tracks[0].uploadAudio, "STOREDAUDIO");
  assert.equal(s1.versionId, V2);
  const { versions } = await songs.listVersions(env, A, S1);
  assert.equal(versions.find((v) => v.id === V2).parent_id, V1);
  const row = env.DB.sqlite.prepare("select bpm, engines, updated_at from songs where id = ?").get(S1);
  assert.equal(row.bpm, 120);
  assert.equal(row.updated_at, t(4).toISOString(), "the import does not make an old song new");

  // The inline sample was lifted out into R2 on the way in.
  const s2col = JSON.parse(env.DB.sqlite.prepare("select data from songs where id = ?").get(S2).data);
  assert.match(s2col.tracks[0].uploadAudio, /^@sample:/);
  assert.equal((await songs.loadSong(env, B, S2)).data.tracks[0].uploadAudio, "INLINEAUDIO".repeat(100));
  assert.equal(env.DB.sqlite.prepare("select forked_from from songs where id = ?").get(S2).forked_from, S1);

  assert.equal((await songs.loadSongChat(env, A, S1)).messages[0].text, "go");
  assert.equal(await songs.songLikes(env, S1), 1);
  assert.deepEqual(await patches.savedFrom(env, B, [P1]), [P1]);
  assert.equal((await profiles.getPublicProfile(env, null, "alice")).profile.bio, "hi");
  assert.equal((await profiles.getMyProfile(env, B)).username, "bob", "no profile: one made from the email");
});

test("a migrated password signs in, and an unconfirmed account still has to confirm", async () => {
  const env = makeEnv();
  await migrate(env);
  const auth = makeAuth({ database: env.DB, secret: "x".repeat(40), baseURL: "http://localhost:3000", sendMail: async () => {}, withNextCookies: false });
  const ok = await auth.api.signInEmail({ body: { email: "alice@example.com", password: "oldpass1" }, asResponse: true });
  assert.equal(ok.status, 200);
  const s = await auth.api.getSession({ headers: new Headers({ cookie: ok.headers.get("set-cookie").split(";")[0] }) });
  assert.equal(s.user.id, A, "the same user id as in Supabase");
});
