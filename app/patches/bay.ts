"use client";

// The patch bay from the browser: the studio's saved patches, read and written
// through /api/bay (app/api/bay), which checks the session and keeps every
// patch to its owner. Routes rather than server actions because a sampler
// patch carries its sample as base64.

export type BayEntry = {
  id: string;
  name: string;
  engineKey: string | null;
  kind: string | null;
  /** Only for a legacy custom-Tone patch, which the engine builds as an engine. */
  config?: unknown;
};

async function call<T>(url: string, init?: RequestInit): Promise<{ status: number; body: T & { error?: string } }> {
  const res = await fetch(url, {
    ...init,
    headers: init?.body ? { "content-type": "application/json" } : undefined,
    credentials: "same-origin",
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  return { status: res.status, body };
}

/** The account's patches, newest first and one per name, without configs
 *  except the small legacy ones. Null when signed out. */
export async function loadIndex(): Promise<BayEntry[] | null> {
  const { status, body } = await call<{ patches: BayEntry[] | null }>("/api/bay");
  if (status === 401) return null;
  if (body.error) throw new Error(body.error);
  return body.patches ?? null;
}

export async function fetchConfig(id: string): Promise<unknown> {
  const { body } = await call<{ config: unknown }>(`/api/bay/${encodeURIComponent(id)}`);
  if (body.error) throw new Error(body.error);
  return body.config;
}

/** Save by name, as the studio always has: the patch of that name is
 *  replaced, else a private one is made. Returns its id. */
export async function putPatch(name: string, config: unknown): Promise<string> {
  const { body } = await call<{ id: string }>("/api/bay", {
    method: "POST",
    body: JSON.stringify({ name: name.slice(0, 120), config }),
  });
  if (body.error || !body.id) throw new Error(body.error || "save failed");
  return body.id;
}

export async function removePatch(id: string): Promise<void> {
  const { body } = await call<{ ok: boolean }>(`/api/bay/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (body.error) throw new Error(body.error);
}

// ---- off localStorage ------------------------------------------------------
//
// Patches used to live in this browser (seqbaby.patches.v1). The first time a
// signed-in account opens the studio or settings here, they go up into it and
// the browser's copy is removed. A patch the account already has under that
// name is skipped when it is the same patch, and saved beside it as `name 2`
// when it is not: nothing here overwrites what the account holds.

const LEGACY_KEY = "seqbaby.patches.v1";

export async function migrateLocalPatches(): Promise<number> {
  let local: Record<string, unknown>;
  try {
    local = JSON.parse(localStorage.getItem(LEGACY_KEY) || "{}");
  } catch {
    local = {};
  }
  const names = Object.keys(local);
  if (!names.length) return clearLeftovers(), 0;
  const { status, body } = await call<{ moved: string[] }>("/api/bay", {
    method: "POST",
    body: JSON.stringify({ import: local }),
  });
  if (status === 401 || body.error) return 0;
  const moved = new Set(body.moved ?? []);
  // Only what made it across leaves the browser; the rest waits for next time.
  const left: Record<string, unknown> = {};
  for (const name of names) if (!moved.has(name)) left[name] = local[name];
  try {
    if (Object.keys(left).length) localStorage.setItem(LEGACY_KEY, JSON.stringify(left));
    else localStorage.removeItem(LEGACY_KEY);
  } catch {}
  clearLeftovers();
  return moved.size;
}

// The branch-only sync that preceded this kept a record per account.
function clearLeftovers() {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k?.startsWith("seqbaby.patchBay.v1:")) localStorage.removeItem(k);
    }
  } catch {}
}
