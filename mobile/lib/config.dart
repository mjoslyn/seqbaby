/// Where the studio is loaded from. The app is a shell around the web engine,
/// so pointing it at a deploy preview or a dev server is one build flag:
///
///   adb reverse tcp:3000 tcp:3000
///   flutter run --dart-define=SEQBABY_URL=http://localhost:3000/
///
/// Use localhost (via `adb reverse` on Android; the iOS simulator shares the
/// host's), not a LAN address: plain http is only a secure context on
/// localhost, and AudioWorklet, which most of the engines are, needs one.
const String studioUrl = String.fromEnvironment(
  'SEQBABY_URL',
  defaultValue: 'https://www.playseqbaby.com/',
);

final Uri studioUri = Uri.parse(studioUrl);

/// Appended to the WebView's user agent, so the web side can tell it is
/// inside the app (`navigator.userAgent.includes("SeqbabyApp")`).
const String userAgentTag = 'SeqbabyApp/1';

/// The studio's own background (manifest.webmanifest), so nothing flashes
/// white between the splash and the first paint.
const int studioBackground = 0xFF0E0F12;

/// A URL the WebView should load itself rather than hand to the system
/// browser: the studio's host, with or without `www.`.
bool isStudioUrl(Uri uri) {
  if (uri.scheme != 'http' && uri.scheme != 'https') return false;
  String bare(String h) => h.startsWith('www.') ? h.substring(4) : h;
  return bare(uri.host) == bare(studioUri.host) && uri.port == studioUri.port;
}
