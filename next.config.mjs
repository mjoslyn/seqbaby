import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // The audio engine (public/js/*) is imperative, DOM- and Web-Audio-driven,
  // and relies on ambient `Tone` / `window.woscillators` globals. It is served
  // as raw static ES modules from public/ and never goes through the bundler,
  // so React StrictMode double-mounting would risk double-booting the engine.
  reactStrictMode: false,
  // The studio moved from / to /studio, and / is the homepage now. Every link
  // already sent out names the old place: a share link (`?s=`), a deep link to
  // a song (`?open=`), a jam invite (`?jam=`). Each is sent on with its query
  // intact (Next carries the query across a redirect), so it lands on the
  // studio with the song it named. The homescreen app's WebView (user agent
  // `SeqbabyApp/`) goes to the studio from a bare / as well: it is an
  // instrument, not a visitor who wants to be told about one.
  async redirects() {
    return [
      ...["s", "open", "jam"].map((key) => ({
        source: "/",
        has: [{ type: "query", key }],
        destination: "/studio",
        permanent: false,
      })),
      {
        source: "/",
        has: [{ type: "header", key: "user-agent", value: ".*SeqbabyApp/.*" }],
        destination: "/studio",
        permanent: false,
      },
    ];
  },
  // A save is a server action carrying the whole session, uploaded samples
  // included as base64, and the default body limit is 1MB: a song with one
  // real sample in it could not be saved. A Worker accepts far bigger bodies,
  // but it has 128MB of memory, and a save holds the body, the parsed session
  // and copies of both: 15mb leaves room (app/songs/trySave.ts refuses a
  // bigger song before it is sent).
  experimental: { serverActions: { bodySizeLimit: "15mb" } },
};

export default nextConfig;

// `next dev` with the Worker's bindings (D1, R2, the Durable Objects), from
// wrangler's local simulation of wrangler.jsonc. A no-op in a build.
initOpenNextCloudflareForDev();
