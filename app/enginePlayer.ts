"use client";

import { patchSession } from "./home/patchPreview";

// Plays a published song on the homepage with the studio's own engine -- or a
// published patch, as a one-track session playing a short phrase written for
// it (home/patchPreview.js). Both are a KEY here: a song's share slug, or
// `patch:<id>`; everything past fetching the session is the same.
//
// Full fidelity means the real engine: every model, the rack, the worklets,
// samples. That is ~1.7MB, which is why the homepage does not boot it with
// the page (see page.tsx). It is DEFERRED instead (`scheduleWarm`): once the
// page has loaded and the browser is idle, the studio itself loads in a
// hidden same-origin frame (`/studio?embed`), so it is usually ready by the
// time anyone presses play. The page drives it through `window.seqbaby`
// like the MCP server's audition does. One frame for the whole page: the
// next card is an `applySet` into the engine already running, not a second
// engine. A frame rather than the engine in this document because the engine
// owns its document: the keyboard, undo, the step grid and ~1000 controls
// all assume they are the page.
//
// Audio has to be unlocked by a gesture, and the gesture lands in this page,
// not the frame. With the engine already warm, the click calls its `unlock`
// synchronously, inside the gesture, which is what Safari needs. If the press
// beat the warm-up (or it was skipped), Chrome still lets a same-origin frame
// start audio once its parent has been clicked; Safari does not, so there the
// card asks for one more tap and unlocks inside that.

type Api = NonNullable<Window["seqbaby"]>;
type EngineState = { playing?: boolean; audioCtx?: AudioContext | null };

export type PlayerStatus = "idle" | "loading" | "playing" | "tap" | "error";
/** `slug` is the key being played: a share slug, or `patchKey(id)`. */
export type PlayerState = { slug: string | null; status: PlayerStatus };

let current: PlayerState = { slug: null, status: "idle" };
const subscribers = new Set<() => void>();

export function getPlayer(): PlayerState {
  return current;
}

export function subscribePlayer(fn: () => void): () => void {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}

function set(next: PlayerState) {
  current = next;
  for (const fn of subscribers) fn();
}

let frame: HTMLIFrameElement | null = null;
let engine: Promise<Api> | null = null;

function loadEngine(): Promise<Api> {
  if (engine) return engine;
  engine = new Promise<Api>((resolve, reject) => {
    const f = document.createElement("iframe");
    f.src = "/studio?embed";
    f.title = "song player";
    f.tabIndex = -1;
    f.setAttribute("aria-hidden", "true");
    f.allow = "autoplay";
    // Off screen but laid out at a desktop size: a frame with no box gets no
    // animation frames, and the engine's desktop layout is the tested one.
    Object.assign(f.style, {
      position: "fixed",
      left: "-10000px",
      top: "0",
      width: "1024px",
      height: "768px",
      border: "0",
      opacity: "0",
      pointerEvents: "none",
    });
    document.body.appendChild(f);
    frame = f;
    const t0 = Date.now();
    const poll = () => {
      const api = f.contentWindow?.seqbaby;
      if (api?.state && typeof api.play === "function") return resolve(api);
      if (Date.now() - t0 > 60000) return reject(new Error("the engine did not load"));
      setTimeout(poll, 150);
    };
    poll();
  });
  engine.catch(() => {
    engine = null;
    frame?.remove();
    frame = null;
  });
  return engine;
}

let warmScheduled = false;

/**
 * Load the engine ahead of the first press, once the page has loaded and the
 * browser has a quiet moment. Called by every card; the first call counts.
 * Skipped when the visitor has asked to save data or is on 2g, where 1.7MB
 * nobody asked for is a real cost -- the first press then loads it instead.
 */
export function scheduleWarm(): void {
  if (warmScheduled || typeof window === "undefined") return;
  warmScheduled = true;
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } })
    .connection;
  if (conn?.saveData || /(^|-)2g$/.test(conn?.effectiveType ?? "")) return;
  const idle =
    window.requestIdleCallback ??
    ((fn: () => void) => window.setTimeout(fn, 1));
  const go = () => idle(() => void loadEngine().catch(() => {}), { timeout: 4000 });
  if (document.readyState === "complete") go();
  else window.addEventListener("load", go, { once: true });
}

const sessions = new Map<string, Promise<unknown>>();

/** The key a patch card plays under. Share slugs never carry a colon. */
export const patchKey = (id: string) => `patch:${id}`;

function fetchSession(key: string): Promise<unknown> {
  if (key.startsWith("patch:")) {
    return fetch(`/api/patch?id=${encodeURIComponent(key.slice(6))}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`patch ${r.status}`))))
      .then((j: { name?: string; config?: unknown }) => {
        if (j.config == null) throw new Error("empty patch");
        return patchSession(j.config, j.name);
      });
  }
  // The same route the studio's own `?s=` load reads.
  return fetch(`/api/share?id=${encodeURIComponent(key)}`)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`share ${r.status}`))))
    .then((j: { session?: unknown }) => {
      if (!j.session) throw new Error("empty session");
      return j.session;
    });
}

function loadSession(key: string): Promise<unknown> {
  let p = sessions.get(key);
  if (!p) {
    p = fetchSession(key);
    p.catch(() => sessions.delete(key));
    sessions.set(key, p);
  }
  return p;
}

/** Start fetching a song before the click: a pointer on the play button is
 *  intent enough. Only the session, never the engine -- a mouse passing over
 *  the feed must not cost anyone 1.7MB. */
export function prefetch(slug: string): void {
  loadSession(slug).catch(() => {});
}

const engineState = (api: Api) => api.state as EngineState;
const running = (api: Api) => engineState(api).audioCtx?.state === "running";

function until(test: () => boolean, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const tick = () => {
      if (test()) return resolve(true);
      if (Date.now() - t0 > ms) return resolve(false);
      setTimeout(tick, 50);
    };
    tick();
  });
}

type FrameTone = { Transport?: { ticks?: number; PPQ?: number; state?: string } };

/**
 * The step the playing session is on NOW, for a card drawing a playhead, or
 * null when nothing is playing. Read off the frame's Tone transport, which
 * counts at the audio clock, rather than `state.tick`, which runs a
 * scheduler lookahead ahead of what is heard.
 */
export function playheadStep(): number | null {
  const win = frame?.contentWindow as (Window & { Tone?: FrameTone }) | null | undefined;
  const api = win?.seqbaby;
  if (!api || !engineState(api).playing) return null;
  const tr = win?.Tone?.Transport;
  if (tr && tr.state === "started" && Number.isFinite(tr.ticks) && tr.PPQ) {
    return Math.floor((tr.ticks as number) / (tr.PPQ / 4));
  }
  const tick = (api.state as { tick?: number }).tick;
  return Number.isFinite(tick) ? (tick as number) : null;
}

/** The card's button: play this song, stop it, or finish unlocking it. */
export function togglePlay(slug: string): void {
  const same = current.slug === slug;

  // Stop. Synchronous state first so the button answers at once.
  if (same && (current.status === "playing" || current.status === "loading")) {
    set({ slug: null, status: "idle" });
    engine?.then((api) => api.stop()).catch(() => {});
    return;
  }

  // The second tap Safari needs: unlock inside this gesture, then let the
  // play already waiting on the context go through.
  if (same && current.status === "tap") {
    const api = frame?.contentWindow?.seqbaby;
    if (api) {
      api.unlock();
      set({ slug, status: "loading" });
      const ok = until(() => current.slug === slug && !!engineState(api).playing && running(api), 4000);
      ok.then((yes) => {
        if (current.slug !== slug) return;
        set({ slug, status: yes ? "playing" : "tap" });
      });
      return;
    }
  }

  set({ slug, status: "loading" });
  // If the engine is already here, prime it inside this click too: on Safari
  // that is what makes every card after the first play on one tap.
  frame?.contentWindow?.seqbaby?.unlock?.();
  (async () => {
    try {
      const [api, session] = await Promise.all([loadEngine(), loadSession(slug)]);
      if (current.slug !== slug) return;
      await api.stop();
      api.applySet(session);
      if (current.slug !== slug) return;
      // `play` awaits the context's resume, which on Safari never settles
      // without a gesture in reach, so it is raced rather than awaited.
      void api.play();
      const ok = await until(() => !!engineState(api).playing && running(api), 2500);
      if (current.slug !== slug) {
        if (current.slug === null) void api.stop();
        return;
      }
      set({ slug, status: ok ? "playing" : "tap" });
    } catch {
      if (current.slug === slug) set({ slug, status: "error" });
    }
  })();
}
