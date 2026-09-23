# seqbaby mobile

The iOS and Android app. It is a shell around the studio: the web engine in
`public/js` runs unchanged in a WebView (`flutter_inappwebview`), and Flutter
supplies the native parts a browser tab can't.

| what | where |
|---|---|
| plays with the silent switch on (iOS playback audio session) | `lib/main.dart` |
| bounces and exports open the share sheet ("save to Files", AirDrop...) | `lib/bridge.dart` + `lib/native.dart` |
| the `share` button opens the share sheet as well as copying | same |
| screen stays awake while the transport runs | same (`playing` handler) |
| `?s=` / `?open=` / `?jam=` links open in the app | `app_links` + the manifest / entitlements |
| links off the site open in the system browser | `studio_page.dart` `_route` |
| Android back goes back in the page | `studio_page.dart` |

`lib/bridge.dart` is injected at document start and is the whole seam, so
nothing in `public/js` needs to know about the app. The web side can detect it
by `navigator.userAgent.includes("SeqbabyApp")`.

## Run

```
flutter pub get
flutter run                                   # against https://www.playseqbaby.com
adb reverse tcp:3000 tcp:3000                 # Android: reach `npm run dev` on the host
flutter run --dart-define=SEQBABY_URL=http://localhost:3000/
```

Stay on `localhost` for a dev server. A LAN `http://` address isn't a secure
context, so AudioWorklet (most of the engines) won't load there.

Icons come from `../public/icons`: `dart run flutter_launcher_icons`.
Bundle id / application id: `com.playseqbaby.seqbaby`.

## Links into the app (before release)

Links only open the app once the site vouches for it. Two files go in
`public/.well-known/` once the signing details exist:

`apple-app-site-association` (no extension, served as `application/json`):
```json
{ "applinks": { "details": [ { "appIDs": ["<TEAM_ID>.com.playseqbaby.seqbaby"], "components": [ { "/": "/", "?": {} } ] } ] } }
```

`assetlinks.json`:
```json
[{ "relation": ["delegate_permission/common.handle_all_urls"],
   "target": { "namespace": "android_app", "package_name": "com.playseqbaby.seqbaby",
               "sha256_cert_fingerprints": ["<RELEASE_SHA256>"] } }]
```

Also enable Associated Domains for the app id in the Apple developer portal.
The entitlement is already in `ios/Runner/Runner.entitlements`.

## Limits

- Needs the network. The engine is loaded from the site, not bundled.
- No Web MIDI: neither WKWebView nor Android WebView has it.
- Audio stops when the app goes to the background.
- iOS 14.5+ for AudioWorklet in WKWebView.
- Magic-link sign-in lands in the app only once the link files above are live.
  Until then, sign in with a password.
