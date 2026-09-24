/// Injected into every studio page at document start. The engine was written
/// for a browser and knows nothing about the app; this script is the whole of
/// the seam, so nothing in public/js has to change.
///
/// - Downloads: the engine saves a bounce or an export by clicking an
///   `a[download]` on a blob URL (bounce.js `downloadBlob`, session.js
///   `onExportSet`). A WebView does nothing with that, so the click is caught
///   and the bytes are handed to Flutter, which offers the share sheet.
///   The blob is taken from a map kept by `URL.createObjectURL`, not fetched
///   back from its URL, because `onExportSet` revokes the URL in the same
///   tick as the click.
/// - Clipboard / share: a share link is copied with `navigator.clipboard`,
///   which WebViews support unevenly. Both go to Flutter, which copies it and
///   opens the native share sheet for a studio link.
/// - Audio session: WebKit's `navigator.audioSession` (iOS 16.4+) set to
///   playback, the in-page half of what main.dart does for the app's session.
/// - Playing: polled from `window.seqbaby.state.playing` so Flutter can keep
///   the screen awake and drive the lock-screen controls.
/// - Background: Tone schedules notes `lookAhead` seconds ahead from a
///   worker clock. A hidden page's timers can run late, so while hidden the
///   window is widened to ride out a stall; see the comment on it below.
const String bridgeScript = r'''
(function () {
  if (window.__seqbabyApp) return;
  window.__seqbabyApp = true;

  // callHandler exists from the start but is only safe once this fires.
  var ready = false;
  var queue = [];
  window.addEventListener("flutterInAppWebViewPlatformReady", function () {
    ready = true;
    queue.splice(0).forEach(function (f) { f(); });
  });
  function call(name) {
    var args = Array.prototype.slice.call(arguments, 1);
    return new Promise(function (resolve, reject) {
      var go = function () {
        var h = window.flutter_inappwebview;
        h.callHandler.apply(h, [name].concat(args)).then(resolve, reject);
      };
      if (ready) go(); else queue.push(go);
    });
  }

  // --- downloads ---------------------------------------------------------
  var blobs = new Map();
  var create = URL.createObjectURL, revoke = URL.revokeObjectURL;
  URL.createObjectURL = function (obj) {
    var url = create.call(URL, obj);
    if (obj instanceof Blob) blobs.set(url, obj);
    return url;
  };
  URL.revokeObjectURL = function (url) {
    blobs.delete(url);
    return revoke.call(URL, url);
  };

  function toBase64(blob) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(String(r.result).split(",")[1] || ""); };
      r.onerror = function () { reject(r.error); };
      r.readAsDataURL(blob);
    });
  }
  function sendDownload(href, name) {
    var held = blobs.get(href);
    var got = held ? Promise.resolve(held) : fetch(href).then(function (r) { return r.blob(); });
    return got.then(function (blob) {
      return toBase64(blob).then(function (data) {
        return call("download", {
          name: name || "seqbaby",
          mime: blob.type || "application/octet-stream",
          data: data,
        });
      });
    });
  }
  function isFileLink(a) {
    return a && a.hasAttribute("download") && /^(blob|data):/.test(a.href);
  }
  var click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (!isFileLink(this)) return click.call(this);
    sendDownload(this.href, this.getAttribute("download")).catch(function (e) {
      console.error("seqbaby app: download failed", e);
    });
  };
  document.addEventListener("click", function (e) {
    var a = e.target && e.target.closest ? e.target.closest("a") : null;
    if (!isFileLink(a)) return;
    e.preventDefault();
    sendDownload(a.href, a.getAttribute("download")).catch(function () {});
  }, true);

  // --- clipboard + share -------------------------------------------------
  var writeText = function (text) { return call("copy", String(text)).then(function () {}); };
  try {
    if (navigator.clipboard) {
      Object.defineProperty(navigator.clipboard, "writeText", { value: writeText, configurable: true });
    } else {
      Object.defineProperty(navigator, "clipboard", { value: { writeText: writeText }, configurable: true });
    }
  } catch (e) {}
  try {
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: function (d) {
        d = d || {};
        return call("share", { title: d.title || "", text: d.text || "", url: d.url || "" }).then(function () {});
      },
    });
    Object.defineProperty(navigator, "canShare", { configurable: true, value: function () { return true; } });
  } catch (e) {}

  // --- audio session ----------------------------------------------------
  try { if (navigator.audioSession) navigator.audioSession.type = "playback"; } catch (e) {}

  // --- transport state ---------------------------------------------------
  var playing = null;
  setInterval(function () {
    var s = window.seqbaby && window.seqbaby.state;
    var now = !!(s && s.playing);
    if (now !== playing) { playing = now; call("playing", now, document.title).catch(function () {}); }
  }, 1000);

  // --- background scheduling --------------------------------------------
  // The transport is one Tone scheduleRepeat, run `lookAhead` seconds ahead
  // of the audio clock. While hidden the window is widened so a late timer
  // is absorbed instead of heard as a gap, and put back on return. Both
  // directions are safe mid-play: raising it only schedules further ahead,
  // and lowering it steps Tone's clock back over steps it has already
  // queued, which scheduleRepeat does not fire twice (each step is a one-shot
  // event that removes itself). Measured with the vendored Tone: steps stay
  // exactly one 16th apart across both changes.
  var BACKGROUND_LOOKAHEAD = 1.5;
  var baseLookAhead = null;
  document.addEventListener("visibilitychange", function () {
    var c;
    try { c = window.Tone && window.Tone.getContext(); } catch (e) {}
    if (!c) return;
    if (document.visibilityState === "hidden") {
      if (baseLookAhead === null) baseLookAhead = c.lookAhead;
      if (c.lookAhead < BACKGROUND_LOOKAHEAD) c.lookAhead = BACKGROUND_LOOKAHEAD;
    } else if (baseLookAhead !== null) {
      c.lookAhead = baseLookAhead;
      baseLookAhead = null;
    }
  });
})();
''';
