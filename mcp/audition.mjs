// Hear the song without ears: load it into the real studio in a headless
// browser, press play, and read the meters.
//
// The studio exposes `window.seqbaby` (public/js/appApi.js): applySet loads a
// session, and every track's `meterAnalyser` taps its rack output, so a few
// seconds of getFloatTimeDomainData says whether each track is making sound,
// how loud, and whether the master is near the limiter. That is what an agent
// cannot know from the JSON: a filter closed on a sub, a bus nothing reaches.
//
// Optional: needs `playwright` (npm i playwright) and a Chromium. The package
// downloads one on install; to use another, set SEQBABY_CHROME to its path.
// Tone is served by the studio itself (public/tone.js), so this needs nothing
// from a CDN.

import { createRequire } from "node:module";

async function loadPlaywright() {
  // playwright is CommonJS, so a dynamic import may hand its exports back on
  // `default`; either way the object with `chromium` on it is what is wanted.
  const unwrap = (m) => (m?.chromium ? m : m?.default?.chromium ? m.default : null);
  try { const m = unwrap(await import("playwright")); if (m) return m; } catch {}
  // Also resolve the CommonJS way from the working directory, which honours
  // NODE_PATH and a global-ish install beside the caller.
  try { const req = createRequire(process.cwd() + "/"); const m = unwrap(await import(req.resolve("playwright"))); if (m) return m; } catch {}
  throw new Error("audition needs the playwright package: npm i playwright (and a Chromium; see mcp/README.md)");
}

// The studio lives at /studio; `/` is the homepage, which has no engine on it.
// A bare site URL (SEQBABY_URL, or http://localhost:3000) is pointed there, and
// anything with a path of its own is taken as the studio it names.
function studioUrl(url) {
  try {
    const u = new URL(url);
    if (u.pathname === "/" || u.pathname === "") u.pathname = "/studio";
    return u.toString();
  } catch {
    return url;
  }
}

/**
 * @param {object} session the serialized song
 * @param {{ url?: string, seconds?: number }} opts
 */
export async function auditionSong(session, { url = "http://localhost:3000", seconds = 4 } = {}) {
  const { chromium } = await loadPlaywright();
  const args = ["--autoplay-policy=no-user-gesture-required", "--use-fake-device-for-media-stream"];
  if (process.getuid?.() === 0) args.push("--no-sandbox");
  const browser = await chromium.launch({ executablePath: process.env.SEQBABY_CHROME || undefined, args });
  const errors = [];
  try {
    const page = await browser.newPage();
    page.on("pageerror", e => errors.push(String(e).slice(0, 200)));
    // Resource 404s and React's hydration notice are the shell's, not the song's.
    page.on("console", m => { if (m.type() === "error" && !/Failed to load resource|hydrat/.test(m.text())) errors.push(m.text().slice(0, 200)); });
    await page.goto(studioUrl(url), { waitUntil: "load", timeout: 60000 });
    await page.waitForFunction(() => !!window.seqbaby?.state?.tracks, null, { timeout: 60000 });
    const loaded = await page.evaluate((s) => {
      const r = window.seqbaby.applySet(s);
      return { warnings: r?.warnings || [], tracks: window.seqbaby.state.tracks.map(t => ({ name: t.name, engine: t.engineKey })) };
    }, session);
    await page.click("#play");
    await page.waitForFunction(() => window.seqbaby.state.ready && window.seqbaby.state.playing, null, { timeout: 30000 });
    // Sample the meters at ~20 Hz for the window: peak and mean-square per track.
    const levels = await page.evaluate(async (secs) => {
      const st = window.seqbaby.state;
      const tracks = st.tracks;
      // One buffer per analyser, at ITS fftSize: a shared one sized for the
      // largest would keep the tail of a louder track's last read and hand
      // every quieter track the same peak.
      const bufs = new Map();
      const bufFor = (an) => { let b = bufs.get(an); if (!b) { b = new Float32Array(an.fftSize); bufs.set(an, b); } return b; };
      const acc = tracks.map(() => ({ sq: 0, n: 0, peak: 0 }));
      const master = { sq: 0, n: 0, peak: 0 };
      const read = (an, a) => {
        if (!an) return;
        const buf = bufFor(an);
        an.getFloatTimeDomainData(buf);
        let sq = 0, pk = 0;
        for (let i = 0; i < buf.length; i++) { const v = buf[i]; sq += v * v; const av = Math.abs(v); if (av > pk) pk = av; }
        a.sq += sq / buf.length; a.n++; if (pk > a.peak) a.peak = pk;
      };
      const until = performance.now() + secs * 1000;
      while (performance.now() < until) {
        tracks.forEach((t, i) => read(t.meterAnalyser, acc[i]));
        read(st.masterAnalyser, master);
        await new Promise(r => setTimeout(r, 50));
      }
      const db = (x) => x > 0 ? Math.round(20 * Math.log10(x) * 10) / 10 : -120;
      return {
        tracks: tracks.map((t, i) => {
          const rms = Math.sqrt(acc[i].sq / Math.max(1, acc[i].n));
          // t.out is a live track id; report the bus by index and name, as the
          // tools address it.
          const bus = t.out && t.out !== "master" ? tracks.findIndex(o => String(o.id) === String(t.out)) : -1;
          return { index: i, name: t.name, engine: t.engineKey, rmsDb: db(rms), peakDb: db(acc[i].peak), voice: t.voice?.type || null,
            silent: acc[i].peak < 0.003, muted: !!t.muted, out: bus >= 0 ? `${bus} (${tracks[bus].name})` : "master" };
        }),
        master: { rmsDb: db(Math.sqrt(master.sq / Math.max(1, master.n))), peakDb: db(master.peak), nearLimiter: master.peak > 0.79 },
        bpm: Number(document.getElementById("bpm")?.value), seconds: secs,
      };
    }, seconds);
    await page.click("#play").catch(() => {});
    return { ...levels, loadWarnings: loaded.warnings, errors };
  } finally {
    await browser.close();
  }
}
