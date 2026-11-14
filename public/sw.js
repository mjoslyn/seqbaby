// seqbaby's service worker: what makes the installed app start without a
// network, and start fast with one. Registered by app/InstallApp.tsx, in
// production only (in dev it would serve yesterday's engine module to an
// edit-and-reload loop).
//
// Three rules, by what a request is for:
//
//   the engine and the shell's code   cache first. /e/<sha>/ and
//     (/e/<sha>/..., /_next/static/)  /_next/static/ are addressed by content
//                                     or by deploy, so a hit is never stale.
//   other static files                the cached copy at once, refreshed
//     (samples, wavetables, icons,    behind it for next time.
//      the bare engine paths)
//   the studio and the homepage       the network, and the last copy seen
//                                     when there is none: offline, the studio
//                                     opens as it last did.
//
// Everything else is left to the browser untouched: the API, auth, server
// actions (POSTs), the RSC payloads of a client-side navigation, another
// origin. Nothing about an account is decided here; a cached page is only
// ever shown when the network could not be reached.

const STATIC = "sq-static-v1";
const PAGES = "sq-pages-v1";
const KEEP = [STATIC, PAGES];
const MAX_STATIC = 700;                    // entries; a deploy's engine is ~120
const PAGE_PATHS = ["/studio", "/"];

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const name of await caches.keys()) if (name.startsWith("sq-") && !KEEP.includes(name)) await caches.delete(name);
    await self.clients.claim();
  })());
});

const immutable = (p) => p.startsWith("/e/") || p.startsWith("/_next/static/");
const staticFile = (p) =>
  immutable(p) || p.startsWith("/js/") || p.startsWith("/samples/") || p.startsWith("/wavetables/") ||
  p.startsWith("/icons/") || p === "/tone.js" || p === "/woscillators.js" || p === "/style.css" ||
  p === "/favicon.svg" || p === "/favicon.ico" || p === "/manifest.webmanifest";

async function put(cacheName, key, res) {
  if (!res || !res.ok || res.status !== 200 || res.type === "opaque") return;
  try { await (await caches.open(cacheName)).put(key, res); } catch { /* quota: the app still runs */ }
}

async function cacheFirst(req) {
  const hit = await caches.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  put(STATIC, req, res.clone());
  return res;
}

async function staleWhileRevalidate(req) {
  const hit = await caches.match(req);
  const fresh = fetch(req).then((res) => { put(STATIC, req, res.clone()); return res; });
  if (hit) { fresh.catch(() => {}); return hit; }
  return fresh;
}

// A page: the network's answer, kept when it is the plain page (a link that
// names a song, a jam or an unlock is that visit's, not the app's), and the
// kept one when the network has nothing to say.
async function page(req, url) {
  const key = PAGE_PATHS.includes(url.pathname) ? url.pathname : null;
  try {
    const res = await fetch(req);
    if (key && !url.search && res.ok && !res.redirected) put(PAGES, key, res.clone());
    return res;
  } catch (err) {
    const cache = await caches.open(PAGES);
    const hit = (key && await cache.match(key)) || (url.pathname.startsWith("/studio") && await cache.match("/studio"));
    if (hit) return hit;
    throw err;
  }
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || req.headers.has("range")) return;
  let url;
  try { url = new URL(req.url); } catch { return; }
  if (url.origin !== self.location.origin) return;
  const p = url.pathname;
  if (p.startsWith("/api/") || p === "/sw.js") return;
  if (url.searchParams.has("_rsc") || req.headers.get("rsc")) return;
  if (req.mode === "navigate") {
    if (PAGE_PATHS.includes(p) || p.startsWith("/studio")) e.respondWith(page(req, url));
    return;
  }
  if (!staticFile(p)) return;
  e.respondWith(immutable(p) ? cacheFirst(req) : staleWhileRevalidate(req));
});

// The page says what it loaded (`warm`): on a first visit the worker arrives
// after the engine did, so without this the app would only work offline from
// its second visit on. The same message names this deploy's engine prefix,
// and the engines of deploys before it are let go.
self.addEventListener("message", (e) => {
  const d = e.data;
  if (!d || d.type !== "warm") return;
  e.waitUntil((async () => {
    const cache = await caches.open(STATIC);
    const urls = (Array.isArray(d.urls) ? d.urls : []).filter((u) => {
      try { const x = new URL(u, self.location.origin); return x.origin === self.location.origin && staticFile(x.pathname); } catch { return false; }
    });
    await Promise.all(urls.map(async (u) => {
      try { if (!(await cache.match(u))) await put(STATIC, u, await fetch(u)); } catch { /* next visit */ }
    }));
    if (typeof d.page === "string" && PAGE_PATHS.includes(d.page)) {
      try { await put(PAGES, d.page, await fetch(d.page, { credentials: "include" })); } catch { /* offline already */ }
    }
    const keys = await cache.keys();
    const prefix = typeof d.engine === "string" && /^\/e\/[\w.-]+$/.test(d.engine) ? d.engine + "/" : null;
    let n = keys.length;
    for (const k of keys) {
      const kp = new URL(k.url).pathname;
      const old = prefix && kp.startsWith("/e/") && !kp.startsWith(prefix);
      if (old || n > MAX_STATIC) { await cache.delete(k); n--; }
    }
  })());
});
