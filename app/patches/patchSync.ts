"use client";

import { deletePatch, getPatch, listBayPatches, putBayPatch } from "./actions";

// The patch bay lives in the account (`patches`, 0018); the studio reads its
// patches from localStorage (catalog.js), and a track's load button, the
// `saved:` engines and the save button all stay exactly as they were. This
// keeps the two in step for a signed-in account:
//
//   studio saves or deletes a patch  ->  the engine fires seqbaby:patchsaved /
//                                       seqbaby:patchdeleted, pushed here
//   the studio loads, or comes back  ->  syncBay(): a three-way merge of the
//   into view                            store, the account, and what the last
//                                       sync saw (so a missing patch reads as
//                                       deleted on one side, not new on other)
//
// What the last sync saw is kept per account: two accounts on one browser must
// not read each other's patches as deletions.

const PATCHES_KEY = "seqbaby.patches.v1";
const metaKey = (userId: string) => `seqbaby.patchBay.v1:${userId}`;

type Meta = Record<string, { id: string; updated_at: string }>;

function read<T>(key: string): T {
  try {
    return JSON.parse(localStorage.getItem(key) || "{}");
  } catch {
    return {} as T;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Full (a sampler patch carries its sample): the account still has it.
  }
}

function writeStore(store: Record<string, unknown>) {
  const api = window.seqbaby;
  if (api?.storePatches) {
    api.storePatches(store);
    api.refreshPatches?.();
  } else write(PATCHES_KEY, store);
}

/** Best-effort engine label for a patch config, as the gallery shows it. */
export function engineTypeOf(config: unknown): string | null {
  const c = config as Record<string, unknown> | null;
  const synth = c?.synth as Record<string, unknown> | undefined;
  return (
    (typeof c?.engineKey === "string" && c.engineKey) ||
    (typeof c?.type === "string" && c.type) ||
    (typeof synth?.type === "string" && synth.type) ||
    null
  );
}

let userId: string | null = null;
// One thing at a time: a save landing mid-sync must not be undone by it.
let queue: Promise<unknown> = Promise.resolve();
const serial = <T>(fn: () => Promise<T>) => (queue = queue.then(fn, fn)) as Promise<T>;

export function syncBay(): Promise<void> {
  return serial(async () => {
    const res = await listBayPatches();
    if (!res.userId || res.error) return;
    userId = res.userId;
    const store = read<Record<string, unknown>>(PATCHES_KEY);
    const meta = read<Meta>(metaKey(userId));
    let changed = false;

    // Newest first, so a name the gallery once held twice resolves to one.
    const rows = new Map<string, (typeof res.patches)[number]>();
    for (const r of res.patches) if (!rows.has(r.name)) rows.set(r.name, r);

    for (const [name, row] of rows) {
      const seen = meta[name];
      const unchanged = seen && seen.id === row.id && seen.updated_at === row.updated_at;
      if (name in store) {
        if (unchanged) continue;
      } else if (unchanged) {
        // Deleted here since the last sync (signed out, or the push failed).
        const del = await deletePatch(row.id);
        if (!del.error) delete meta[name];
        continue;
      }
      // New or changed in the account: the account's copy wins.
      const got = await getPatch(row.id);
      if (got.config === undefined) continue;
      store[name] = got.config;
      meta[name] = { id: row.id, updated_at: row.updated_at };
      changed = true;
    }

    for (const name of Object.keys(store)) {
      if (rows.has(name)) continue;
      if (meta[name]) {
        // Deleted from the account (another device, or settings).
        delete store[name];
        delete meta[name];
        changed = true;
        continue;
      }
      // Only ever in this browser: into the account with it.
      const put = await putBayPatch({ name, engine_type: engineTypeOf(store[name]), config: store[name] });
      if (put.id && put.updated_at) meta[name] = { id: put.id, updated_at: put.updated_at };
    }

    for (const name of Object.keys(meta)) if (!(name in store)) delete meta[name];
    if (changed) writeStore(store);
    write(metaKey(userId), meta);
  });
}

export function pushSaved(name: string): Promise<void> {
  return serial(async () => {
    if (!userId) return;
    const config = read<Record<string, unknown>>(PATCHES_KEY)[name];
    if (config === undefined) return;
    const put = await putBayPatch({ name, engine_type: engineTypeOf(config), config });
    if (!put.id || !put.updated_at) return;
    const meta = read<Meta>(metaKey(userId));
    meta[name] = { id: put.id, updated_at: put.updated_at };
    write(metaKey(userId), meta);
  });
}

export function pushDeleted(name: string): Promise<void> {
  return serial(async () => {
    if (!userId) return;
    const meta = read<Meta>(metaKey(userId));
    const seen = meta[name];
    if (!seen) return;
    const del = await deletePatch(seen.id);
    // A failed delete keeps the entry, so the next sync retries it.
    if (del.error && del.error !== "Patch not found") return;
    delete meta[name];
    write(metaKey(userId), meta);
  });
}
