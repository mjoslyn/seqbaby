import test from "node:test";
import assert from "node:assert/strict";
import {
  externalizeSamples,
  hashBytes,
  hashIp,
  MAX_SAMPLE_BYTES,
  quotaLimits,
  SampleError,
  sniffAudio,
  storeSample,
} from "../lib/sampleStore.js";

const ascii = (s) => [...s].map((c) => c.charCodeAt(0));
const file = (head, size = 64) => {
  const b = new Uint8Array(size);
  b.set(head);
  for (let i = head.length; i < size; i++) b[i] = (i * 31) & 0xff;
  return b;
};
const wav = (size = 64, salt = 0) => {
  const b = file([...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WAVE")], size);
  b[size - 1] = salt;
  return b;
};

// ---- a fake of the few supabase-js calls storeSample makes ----------------

function fakeDb({ limits = null, uploadError = null } = {}) {
  const samples = new Map();
  const uploads = [];
  const objects = new Map();
  let nextId = 1;
  const calls = { reserve: 0, upload: 0 };
  const table = (name) => {
    const q = { filters: [] };
    const api = {
      select() { return api; },
      eq(col, v) { q.filters.push([col, v]); return api; },
      async maybeSingle() {
        if (name !== "samples") return { data: null, error: null };
        const [, hash] = q.filters.find(([c]) => c === "hash") ?? [];
        return { data: samples.has(hash) ? { hash } : null, error: null };
      },
      async upsert(row) {
        if (!samples.has(row.hash)) samples.set(row.hash, row);
        return { error: null };
      },
      delete() {
        return {
          async eq(col, v) {
            const i = uploads.findIndex((u) => u[col] === v);
            if (i >= 0) uploads.splice(i, 1);
            return { error: null };
          },
        };
      },
    };
    return api;
  };
  return {
    samples, uploads, objects, calls,
    from: table,
    async rpc(fn, args) {
      assert.equal(fn, "reserve_sample_bytes");
      calls.reserve++;
      const key = args.p_user_id ? ["user_id", args.p_user_id, args.p_user_limit] : ["ip_hash", args.p_ip_hash, args.p_ip_limit];
      const used = uploads.filter((u) => (args.p_user_id ? u.user_id === args.p_user_id : u.ip_hash === args.p_ip_hash && !u.user_id))
        .reduce((a, u) => a + u.bytes, 0);
      const all = uploads.reduce((a, u) => a + u.bytes, 0);
      if (all + args.p_bytes > args.p_global_limit || used + args.p_bytes > key[2]) {
        return { data: [{ granted: false, reservation_id: null, retry_after: 1234 }], error: null };
      }
      const row = { id: nextId++, ip_hash: args.p_ip_hash, user_id: args.p_user_id, bytes: args.p_bytes };
      uploads.push(row);
      return { data: [{ granted: true, reservation_id: row.id, retry_after: 0 }], error: null };
    },
    storage: {
      from() {
        return {
          async upload(hash, bytes) {
            calls.upload++;
            if (uploadError) return { error: uploadError };
            if (objects.has(hash)) return { error: { statusCode: "409", message: "The resource already exists" } };
            objects.set(hash, bytes);
            return { error: null };
          },
        };
      },
    },
  };
}

const small = { ip: 200, user: 400, global: 1000 };

// ---- what a file is --------------------------------------------------------

test("sniffAudio reads the format from the bytes", () => {
  assert.equal(sniffAudio(wav()), "audio/wav");
  assert.equal(sniffAudio(file([...ascii("FORM"), 0, 0, 0, 0, ...ascii("AIFF")])), "audio/aiff");
  assert.equal(sniffAudio(file(ascii("OggS"))), "audio/ogg");
  assert.equal(sniffAudio(file(ascii("fLaC"))), "audio/flac");
  assert.equal(sniffAudio(file([0x1a, 0x45, 0xdf, 0xa3])), "audio/webm");
  assert.equal(sniffAudio(file([0, 0, 0, 0x20, ...ascii("ftypM4A ")])), "audio/mp4");
  assert.equal(sniffAudio(file(ascii("ID3"))), "audio/mpeg");
  assert.equal(sniffAudio(file([0xff, 0xfb, 0x90])), "audio/mpeg");
  assert.equal(sniffAudio(file([0xff, 0xf1, 0x50])), "audio/aac");
});

test("sniffAudio refuses what is not audio", () => {
  assert.equal(sniffAudio(file(ascii("%PDF-1.7"))), null);
  assert.equal(sniffAudio(file([0x89, ...ascii("PNG")])), null);
  assert.equal(sniffAudio(file(ascii("<html>"))), null);
  assert.equal(sniffAudio(new Uint8Array(4)), null);
});

test("the quota defaults, and the env overrides them", () => {
  assert.deepEqual(quotaLimits({}), { ip: 50 * 1048576, user: 200 * 1048576, global: 5120 * 1048576 });
  assert.equal(quotaLimits({ SAMPLE_QUOTA_ANON_MB: "10" }).ip, 10 * 1048576);
  assert.equal(quotaLimits({ SAMPLE_QUOTA_ANON_MB: "nonsense" }).ip, 50 * 1048576);
});

test("an address is stored salted, never as itself", () => {
  const h = hashIp("203.0.113.9", "salt");
  assert.ok(!h.includes("203.0.113.9"));
  assert.equal(h, hashIp("203.0.113.9", "salt"));
  assert.notEqual(h, hashIp("203.0.113.9", "other salt"));
});

// ---- storing -------------------------------------------------------------

test("the server names the file by its own hash of the bytes", async () => {
  const db = fakeDb();
  const bytes = wav(100);
  const out = await storeSample({ bytes, ipHash: "ip", userId: null }, { db, limits: small });
  assert.equal(out.hash, hashBytes(bytes));
  assert.equal(out.mime, "audio/wav");
  assert.ok(db.objects.has(out.hash));
  assert.equal(db.uploads.length, 1);
});

test("a file already stored is not counted or written again", async () => {
  const db = fakeDb();
  const bytes = wav(100);
  await storeSample({ bytes, ipHash: "ip", userId: null }, { db, limits: small });
  const again = await storeSample({ bytes, ipHash: "someone else", userId: null }, { db, limits: small });
  assert.equal(again.stored, false);
  assert.equal(db.uploads.length, 1);
  assert.equal(db.calls.reserve, 1);
  assert.equal(db.calls.upload, 1);
});

test("the size cap, the audio check and an empty body are refused before the quota", async () => {
  const db = fakeDb();
  const refuse = async (bytes, status) => {
    await assert.rejects(() => storeSample({ bytes, ipHash: "ip", userId: null }, { db, limits: small }),
      (e) => e instanceof SampleError && e.status === status);
  };
  await refuse(new Uint8Array(0), 400);
  await refuse(wav(MAX_SAMPLE_BYTES + 1), 413);
  await refuse(file(ascii("%PDF-1.7")), 415);
  assert.equal(db.calls.reserve, 0);
});

test("an address over its day's quota gets a 429 with when to retry", async () => {
  const db = fakeDb();
  await storeSample({ bytes: wav(150, 1), ipHash: "ip", userId: null }, { db, limits: small });
  await assert.rejects(
    () => storeSample({ bytes: wav(100, 2), ipHash: "ip", userId: null }, { db, limits: small }),
    (e) => e instanceof SampleError && e.status === 429 && e.retryAfter === 1234,
  );
  assert.equal(db.calls.upload, 1);
});

test("an account is counted on its own, not against the address it shares", async () => {
  const db = fakeDb();
  await storeSample({ bytes: wav(150, 1), ipHash: "office", userId: null }, { db, limits: small });
  const out = await storeSample({ bytes: wav(150, 2), ipHash: "office", userId: "u1" }, { db, limits: small });
  assert.ok(out.hash);
});

test("everyone together stops at the global cap", async () => {
  const db = fakeDb();
  const limits = { ip: 600, user: 600, global: 250 };
  await storeSample({ bytes: wav(150, 1), ipHash: "a", userId: null }, { db, limits });
  await assert.rejects(() => storeSample({ bytes: wav(150, 2), ipHash: "b", userId: null }, { db, limits }),
    (e) => e.status === 429);
});

test("a failed write gives its reservation back", async () => {
  const db = fakeDb({ uploadError: { statusCode: "500", message: "boom" } });
  await assert.rejects(() => storeSample({ bytes: wav(100), ipHash: "ip", userId: null }, { db, limits: small }),
    (e) => e.status === 502);
  assert.equal(db.uploads.length, 0);
});

test("a file someone else stored in the meantime is not counted", async () => {
  const db = fakeDb();
  const bytes = wav(100);
  db.objects.set(hashBytes(bytes), bytes);   // in the bucket, no row yet
  const out = await storeSample({ bytes, ipHash: "ip", userId: null }, { db, limits: small });
  assert.equal(out.stored, false);
  assert.equal(db.uploads.length, 0);
  assert.ok(db.samples.has(out.hash));
});

// ---- the backfill ---------------------------------------------------------------

test("externalizeSamples swaps inline payloads for references, once per payload", async () => {
  const a = Buffer.from(wav(80, 1)).toString("base64");
  const b = Buffer.from(wav(80, 2)).toString("base64");
  const session = {
    bpm: 120,
    tracks: [
      { name: "one", uploadAudio: a, uploadAudioMime: "audio/x-wav" },
      { name: "two", uploadAudio: a, uploadAudioMime: "audio/wav" },
      { name: "three", elevenAudio: b, elevenAudioMime: "audio/wav" },
      { name: "four", uploadAudio: null },
    ],
  };
  const puts = [];
  const { blob, changed } = await externalizeSamples(session, async (bytes, mime) => {
    puts.push(mime);
    return hashBytes(bytes);
  });
  assert.equal(changed, true);
  assert.equal(puts.length, 2);
  assert.deepEqual(blob.tracks[0].uploadRef, { hash: hashBytes(Buffer.from(a, "base64")), mime: "audio/wav" });
  assert.deepEqual(blob.tracks[1].uploadRef, blob.tracks[0].uploadRef);
  assert.equal(blob.tracks[0].uploadAudio, undefined);
  assert.equal(blob.tracks[2].elevenAudio, undefined);
  assert.ok(blob.tracks[2].uploadRef);
  assert.equal(blob.tracks[3], session.tracks[3]);
  assert.equal(session.tracks[0].uploadAudio, a, "the input is not mutated");
});

test("externalizeSamples works on a track patch, and leaves what the route would refuse", async () => {
  const good = Buffer.from(wav(80)).toString("base64");
  const { blob } = await externalizeSamples({ _kind: "track-patch", uploadAudio: good }, async (bytes) => hashBytes(bytes));
  assert.ok(blob.uploadRef);
  const junk = Buffer.from("not audio at all, just text").toString("base64");
  const kept = await externalizeSamples({ tracks: [{ uploadAudio: junk }] }, async () => assert.fail("not stored"));
  assert.equal(kept.changed, false);
});
