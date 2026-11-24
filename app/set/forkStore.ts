"use client";

// A fork's hand-off from the set player to the studio.
//
// A fork point is the whole studio at the moment a replay was paused: the
// song, every deck's song (samples included) and the counts. That is often
// megabytes, past what localStorage or a URL will carry, and the player and
// the studio are two different pages. So it goes through IndexedDB, one slot,
// read once and cleared by the studio that opens it (SetRecordPanel.tsx).

const DB = "seqbaby-sets";
const STORE = "fork";
const KEY = "pending";

export type ForkHandoff = { point: { start: unknown; step: number }; setId: string | null; title?: string };

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export async function putFork(h: ForkHandoff): Promise<void> {
  await tx("readwrite", (s) => s.put(h, KEY));
}

/** The pending fork, removed as it is read: a reload must not fork again. */
export async function takeFork(): Promise<ForkHandoff | null> {
  try {
    const h = (await tx("readonly", (s) => s.get(KEY))) as ForkHandoff | undefined;
    await tx("readwrite", (s) => s.delete(KEY));
    return h ?? null;
  } catch {
    return null;
  }
}
