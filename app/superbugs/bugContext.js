// What a bug report says about where it came from, without anyone typing it.
//
// Two sources, because the superbugs page is rarely reached straight from the
// studio: the manual opens in a new tab, and the homepage links here too.
//
//   referrer  the page this one was opened from (document.referrer), same
//             origin only, and never superbugs itself (a second report).
//   studio    the last studio session this browser had open, left behind by
//             app/StudioBreadcrumb.tsx in localStorage whenever the studio tab
//             is hidden or left: its URL (which reopens a saved or shared
//             song), the open song's title, bpm, the tracks and their engines.
//
// A description, never the session itself: a session carries base64 samples
// and would not fit in an issue, and an issue is public.
//
// No imports, so `node --test` runs it (test/bugContext.test.js), and the
// route re-checks everything the browser sends through `cleanContext`.

export const STUDIO_KEY = "seqbaby.lastStudio.v1";

/** A studio visit older than this is not what the report is about. */
export const STUDIO_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const MAX_TRACKS = 16;

// A jam room id on a public issue is an open invite into someone's live
// session, so it goes; `by` names who shared it; `embed` is the hidden player.
const DROP_PARAMS = ["jam", "by", "embed"];

const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Same-origin URL with the private params taken off, or "" if it is not one. */
export function cleanUrl(href, origin) {
  if (typeof href !== "string" || !href) return "";
  let url;
  try {
    url = new URL(href, origin);
  } catch {
    return "";
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return "";
  if (origin && url.origin !== origin) return "";
  for (const k of DROP_PARAMS) url.searchParams.delete(k);
  url.hash = "";
  return url.toString().slice(0, 300);
}

/**
 * The studio's breadcrumb, from what the page can see. Every input is
 * optional: the engine may not have booted, the song may be nobody's.
 */
export function studioSnapshot({ href, origin, title, bpm, tracks, activePattern, playing, jam, now }) {
  const list = Array.isArray(tracks) ? tracks : [];
  return {
    url: cleanUrl(href, origin),
    at: typeof now === "number" ? now : Date.now(),
    title: str(title, 120),
    bpm: Number.isFinite(bpm) ? Math.round(bpm * 100) / 100 : null,
    pattern: Number.isInteger(activePattern) ? activePattern + 1 : null,
    playing: !!playing,
    jam: !!jam,
    trackCount: list.length,
    tracks: list.slice(0, MAX_TRACKS).map((t) => ({
      name: str(t?.name, 40),
      engine: str(t?.engineKey, 60),
    })),
  };
}

/**
 * Whatever came back from the browser, reduced to fields this module wrote.
 * Returns null for anything that is not a studio snapshot.
 */
export function cleanStudio(raw, origin) {
  if (!raw || typeof raw !== "object") return null;
  const at = Number(raw.at);
  if (!Number.isFinite(at)) return null;
  const tracks = Array.isArray(raw.tracks) ? raw.tracks : [];
  const count = Number(raw.trackCount);
  return {
    url: cleanUrl(raw.url, origin),
    at,
    title: str(raw.title, 120),
    bpm: Number.isFinite(Number(raw.bpm)) && raw.bpm !== null ? Number(raw.bpm) : null,
    pattern: Number.isInteger(raw.pattern) ? raw.pattern : null,
    playing: raw.playing === true,
    jam: raw.jam === true,
    trackCount: Number.isInteger(count) && count >= 0 ? Math.min(count, 999) : tracks.length,
    tracks: tracks.slice(0, MAX_TRACKS).map((t) => ({ name: str(t?.name, 40), engine: str(t?.engine, 60) })),
  };
}

/**
 * What to attach: the referrer (unless it is this page) and the studio
 * snapshot (unless it is stale). Either may be null.
 */
export function pickContext({ referrer, studio, origin, now }) {
  const t = typeof now === "number" ? now : Date.now();
  let ref = cleanUrl(referrer, origin);
  if (ref && new URL(ref).pathname.startsWith("/superbugs")) ref = "";
  const s = cleanStudio(studio, origin);
  const fresh = s && t - s.at >= 0 && t - s.at <= STUDIO_MAX_AGE_MS ? s : null;
  return { referrer: ref || null, studio: fresh };
}

/** `4 min ago`, the way a person would say it. */
export function ago(ms) {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return `${h} hour${h === 1 ? "" : "s"} ago`;
}

/** What to say, as label / value rows; `url` rows are links. */
export function contextRows(ctx, now) {
  const t = typeof now === "number" ? now : Date.now();
  const rows = [];
  if (ctx?.referrer) rows.push({ label: "came from", value: ctx.referrer, url: true });
  const s = ctx?.studio;
  if (s) {
    const bits = [s.title ? `"${s.title}"` : "an unsaved session", ago(t - s.at)];
    if (s.jam) bits.push("in a jam");
    rows.push({ label: "last studio session", value: bits.join(", ") });
    if (s.url) rows.push({ label: "studio link", value: s.url, url: true });
    const facts = [];
    if (s.bpm !== null) facts.push(`${s.bpm} bpm`);
    if (s.pattern !== null) facts.push(`pattern ${s.pattern}`);
    if (s.playing) facts.push("playing");
    if (facts.length) rows.push({ label: "transport", value: facts.join(", ") });
    if (s.tracks.length) {
      const more = s.trackCount > s.tracks.length ? `, +${s.trackCount - s.tracks.length} more` : "";
      const list = s.tracks.map((tr) => (tr.name && tr.name !== tr.engine ? `${tr.name} (${tr.engine})` : tr.engine));
      rows.push({ label: "tracks", value: `${list.join(", ")}${more}` });
    }
  }
  return rows;
}

/** The issue's `### Context` section, or "" when there is nothing to say. */
export function contextMarkdown(ctx, now) {
  const rows = contextRows(ctx, now);
  if (!rows.length) return "";
  // Every value here came from a browser. Backticks keep a track called
  // `**x**` or `@someone` from being read as markdown or a mention; a URL is
  // left bare so it links, and it has been through `new URL` already.
  const tick = (v) => "`" + v.replace(/`/g, "'").replace(/\n/g, " ") + "`";
  return ["### Context", ...rows.map((r) => `- ${r.label}: ${r.url ? r.value : tick(r.value)}`)].join("\n");
}
