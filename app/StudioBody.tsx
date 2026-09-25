"use client";

import { useRef } from "react";

// The engine's DOM: the studio markup, handed to React once and then left to
// the engine for good.
//
// The engine's deferred scripts run before React hydrates and immediately
// rewrite this subtree (populating the scale/engine selects, the pattern grid,
// the starter tracks), so React always finds the DOM different from the HTML
// it served and logs a hydration mismatch. suppressHydrationWarning is React's
// escape hatch for exactly this third-party-mutation case; it applies to this
// element only.
//
// The ref is the load-bearing part. React 19 diffs props by identity, and it
// writes `innerHTML` whenever `dangerouslySetInnerHTML` is a different object
// -- whether or not the string inside it changed. Written inline in the page,
// every re-render from the server brought a fresh `{__html}` object, and the
// studio gets one whenever a server action writes a cookie, which Supabase
// does when it refreshes a signed-in session. So opening the songs menu (its
// list is a server action) could put the bare skeleton back under a running
// engine: every track gone from the screen while `state.tracks` still held
// them. Holding the first object means a re-render hands React the same one,
// and React leaves the engine's DOM alone.
export default function StudioBody({ html }: { html: string }) {
  const inner = useRef({ __html: html });
  return (
    <div
      suppressHydrationWarning
      style={{ display: "contents" }}
      dangerouslySetInnerHTML={inner.current}
    />
  );
}
