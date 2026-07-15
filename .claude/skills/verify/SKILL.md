---
name: verify
description: How to launch and drive seqbaby to verify engine changes at runtime.
---

# Verifying seqbaby engine changes

## Launch

```
npm run dev        # Next.js on :3000; engine works with no env vars
```

Open `http://localhost:3000/` in Chrome (claude-in-chrome tools work well).

## Drive

- A real click on **play** provides the user gesture that unlocks audio and
  builds voices/racks (`ensureAudio`). Synthetic `element.click()` does NOT
  count for step cells — the step grid listens on pointer events, so use the
  computer tool with real coordinates (`.sq-step` cells, get coords via
  `getBoundingClientRect` after `scrollIntoView`).
- The starter session has 6 tracks (kick/snare/hat/accent/bass/lead); all
  patterns start EMPTY — toggle steps before expecting sound.
- `window.seqbaby.state` exposes everything: `tracks[i].fxRack`, `.voice`,
  `.meterAnalyser` (taps fxRack.output), `state.masterAnalyser`.
- Measure audio without ears: `getFloatTimeDomainData` RMS on an analyser,
  sampled in a loop. Silence floor is ~0.0002 (keep-alive source); a kick hit
  peaks ~0.2.
- Range sliders don't respond to synthetic drags; drive them via the native
  value setter + `dispatchEvent(new Event("input", {bubbles:true}))`, which
  runs the app's real onInput handler.
- FX panel per track: the "fx" button on the track row opens it.

## Gotchas

- Anything you play is AUDIBLE on the user's machine — warn them before
  probing with rapid parameter changes (instant wet.value steps click).
- resize_window may silently fail (fullscreen); check `window.innerWidth`.
- `isMobileDevice()` (dom.js) gates mobile-only paths — can't be faked after
  page load; on-device checks need a phone or DevTools device emulation.
