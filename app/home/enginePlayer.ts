"use client";

// Plays a published song on the homepage with the studio's own engine, loaded
// only when somebody presses play on a card.
//
// Full fidelity means the real engine: every model, the rack, the worklets,
// samples. That is ~1.7MB, which is exactly why the homepage does not boot it
// (see page.tsx). So the first press loads the studio itself, in a hidden
// same-origin frame (`/studio?embed`), and drives it through `window.seqbaby`
// like the MCP server's audition does. One frame for the whole page: the
// next card is an `applySet` into the engine already running, not a second
// engine. A frame rather than the engine in this document because the engine
// owns its document: the keyboard, undo, the step grid and ~1000 controls
// all assume they are the page.
//
// Audio has to be unlocked by a gesture, and the gesture landed here, before
// the frame existed. Chrome lets a same-origin frame start audio once its
// parent has been clicked. Safari wants the gesture at the moment of the
// resume, which is long gone after a download, so there the card asks for
// one more tap and calls the engine's `unlock` synchronously inside it.

type Api = NonNullable<Window["seqbaby"]>;
type EngineState = { playing?: boolean; audioCtx?: AudioContext | null };

export type PlayerStatus = "idle" | "loading" | "playing" | "tap" | "error";
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

const sessions = new Map<string, Promise<unknown>>();

function loadSession(slug: string): Promise<unknown> {
  let p = sessions.get(slug);
  if (!p) {
    // The same route the studio's own `?s=` load reads.
    p = fetch(`/api/share?id=${encodeURIComponent(slug)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`share ${r.status}`))))
      .then((j: { session?: unknown }) => {
        if (!j.session) throw new Error("empty session");
        return j.session;
      });
    p.catch(() => sessions.delete(slug));
    sessions.set(slug, p);
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
