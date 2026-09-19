// Keeping the screen on while the transport runs — the Screen Wake Lock API,
// and nothing else. No imports, deliberately: this file touches `navigator`
// and `document` and nothing of the engine, so nothing of the engine has to
// know it exists beyond two calls on the play path.
//
// The display timing out is the one interruption the page cannot work around
// from the inside. On iOS the screen locking parks the AudioContext in the
// non-standard "interrupted" state (see `needsResume` in main.js) and no
// samples are rendered until the next tap; on Android the audio usually
// survives, but the studio you were playing has gone dark. Either way the
// thing a sequencer is for — leaving it running while you do something else
// with your hands — stops working after thirty seconds.
//
// It is tied to the TRANSPORT rather than to the page. A tab holding a stopped
// session has no claim on anybody's battery, and a lock that outlived the
// music would be indistinguishable from a bug. Held from play, dropped by
// stop, and dropped by a session load that stops the transport on its way in
// (session.js) — the one other place `state.playing` goes false.

let sentinel = null;   // the live WakeLockSentinel, or null
let wanted = false;    // whether the transport is asking for one right now
let pending = null;    // an in-flight request, so two play clicks take one lock
let listening = false;

/**
 * Ask for the lock, if we are supposed to be holding one and haven't got it.
 * Every way this can fail is a way it is allowed to fail: `navigator.wakeLock`
 * is missing (older Safari, an insecure origin), the platform refuses (low
 * power mode, a battery saver, a permissions policy), or the document is
 * hidden, in which case the request would be rejected anyway and the
 * visibility listener below will come back for it. None of them is worth a
 * status line: the music plays either way, and the only consequence is the
 * screen behaving the way it did before this file.
 */
function acquire() {
  if (!wanted || sentinel || pending) return;
  const api = navigator.wakeLock;
  if (!api || typeof api.request !== "function") return;
  if (document.visibilityState !== "visible") return;
  let p;
  try { p = api.request("screen"); } catch { return; }
  if (!p || typeof p.then !== "function") return;
  pending = p.then(
    (s) => {
      pending = null;
      // Stopped while the request was in flight: take the lock and hand it
      // straight back, rather than leaving the screen held by a transport
      // that is no longer running.
      if (!wanted) { drop(s); return; }
      sentinel = s;
      // The platform revokes the lock whenever the document goes hidden —
      // which, on a phone, is the screen timing out in the moment before the
      // lock could have stopped it, or the user switching apps. Forget the
      // dead sentinel so the visibility listener asks for a fresh one.
      try { s.addEventListener("release", () => { if (sentinel === s) sentinel = null; }); } catch {}
    },
    () => { pending = null; },
  );
}

/** Hand a sentinel back, swallowing both ways `release()` can complain. */
function drop(s) {
  try {
    const p = s.release();
    if (p && typeof p.catch === "function") p.catch(() => {});
  } catch {}
}

/**
 * Hold the screen on. Called when the transport starts; idempotent, so the
 * bounce's stop-then-play and a doubled click both cost one lock.
 */
export function holdScreenAwake() {
  wanted = true;
  if (!listening) {
    listening = true;
    // A lock cannot be requested while the document is hidden and does not
    // survive the document becoming hidden, so coming back is always a fresh
    // request rather than a resume. `pageshow` is here for the bfcache
    // restore, which on iOS Safari can bring the page back with every bit of
    // JS state intact and no visibilitychange to go with it.
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") acquire();
    });
    window.addEventListener("pageshow", () => acquire());
  }
  acquire();
}

/** Let the screen sleep again. Called when the transport stops. */
export function releaseScreenAwake() {
  wanted = false;
  const s = sentinel;
  sentinel = null;
  if (s) drop(s);
}
