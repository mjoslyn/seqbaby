import { ENGINE_MODULES, TONE_SRC, WOSC_SRC } from "./engineAssets";

// Emitted from the studio page so the browser starts downloading the whole
// engine while the HTML is still streaming — i.e. in parallel with the React
// bundle, the stylesheet, and (for signed-in users) the Supabase round trips
// that resolve the account bar. Without these, nothing engine-related is even
// requested until React has hydrated and ScriptLoader's effect runs.
//
// React 19 hoists <link> into <head>, so rendering these inside the page body
// is fine; they still land before the rest of the document.
export default function EnginePreload() {
  return (
    <>
      {/* Warm the TLS connection to the CDN before the Tone.js request. */}
      <link rel="preconnect" href="https://cdn.jsdelivr.net" />
      {/* No crossOrigin here or on the <script> tags: both fetch in "no-cors"
          mode, and a preload only matches the later request when the modes
          agree — a mismatch silently double-downloads. */}
      <link rel="preload" as="script" href={TONE_SRC} />
      <link rel="preload" as="script" href={WOSC_SRC} />
      {/* MAIN_SRC is itself the root of this list. */}
      {ENGINE_MODULES.map((src) => (
        <link key={src} rel="modulepreload" href={src} />
      ))}
    </>
  );
}
