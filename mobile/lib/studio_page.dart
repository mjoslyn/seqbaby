import 'dart:async';
import 'dart:collection';

import 'package:app_links/app_links.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:wakelock_plus/wakelock_plus.dart';

import 'bridge.dart';
import 'config.dart';
import 'native.dart';
import 'transport_handler.dart';

/// The studio, in a WebView. Everything musical is the web engine's; this page
/// only decides where navigation goes and answers the bridge's handlers.
class StudioPage extends StatefulWidget {
  const StudioPage({super.key, required this.transport, this.initialUri});

  final TransportHandler transport;

  /// A studio link the app was opened with (`?s=`, `?open=`, `?jam=`), or
  /// null for the bare studio.
  final Uri? initialUri;

  @override
  State<StudioPage> createState() => _StudioPageState();
}

class _StudioPageState extends State<StudioPage> {
  InAppWebViewController? _web;
  StreamSubscription<Uri>? _links;
  String? _error;

  @override
  void initState() {
    super.initState();
    // The studio's own play button, not the transport directly: in a jam it
    // routes through jamTogglePlay so a start lands on the room's beat.
    widget.transport.onToggle = () async {
      await _web?.evaluateJavascript(source: 'document.getElementById("play")?.click();');
    };
    // app_links replays the launch link on the stream as well; the page was
    // already started on it, so that one is skipped.
    _links = AppLinks().uriLinkStream.listen((uri) {
      if (uri == widget.initialUri || !isStudioUrl(uri)) return;
      _web?.loadUrl(urlRequest: URLRequest(url: WebUri.uri(uri)));
    });
  }

  @override
  void dispose() {
    widget.transport.onToggle = null;
    _links?.cancel();
    WakelockPlus.disable();
    super.dispose();
  }

  void _addHandlers(InAppWebViewController c) {
    c.addJavaScriptHandler(
      handlerName: 'download',
      callback: (args) => saveDownload(context, Map<String, dynamic>.from(args.first as Map)),
    );
    c.addJavaScriptHandler(
      handlerName: 'copy',
      callback: (args) => copyText(context, args.first as String),
    );
    c.addJavaScriptHandler(
      handlerName: 'share',
      callback: (args) => shareData(context, Map<String, dynamic>.from(args.first as Map)),
    );
    c.addJavaScriptHandler(
      handlerName: 'playing',
      callback: (args) {
        final playing = args.first == true;
        final title = args.length > 1 && args[1] is String && (args[1] as String).isNotEmpty
            ? args[1] as String
            : 'seqbaby';
        widget.transport.report(playing: playing, title: title);
        return WakelockPlus.toggle(enable: playing);
      },
    );
  }

  /// The studio's own pages load here; anything else (the manual's external
  /// links, a magic-link provider, GitHub) goes to the system browser.
  Future<NavigationActionPolicy> _route(
      InAppWebViewController c, NavigationAction action) async {
    final url = action.request.url;
    if (url == null || !action.isForMainFrame) return NavigationActionPolicy.ALLOW;
    const inline = {'about', 'blob', 'data', 'javascript'};
    if (inline.contains(url.scheme) || isStudioUrl(url)) {
      return NavigationActionPolicy.ALLOW;
    }
    await launchUrl(url, mode: LaunchMode.externalApplication);
    return NavigationActionPolicy.CANCEL;
  }

  Future<void> _back() async {
    final c = _web;
    if (c != null && await c.canGoBack()) {
      await c.goBack();
    } else {
      await SystemNavigator.pop();
    }
  }

  @override
  Widget build(BuildContext context) {
    final start = widget.initialUri ?? studioUri;
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _back();
      },
      child: Scaffold(
        backgroundColor: const Color(studioBackground),
        body: SafeArea(
          child: Stack(
            children: [
              InAppWebView(
                initialUrlRequest: URLRequest(url: WebUri.uri(start)),
                initialUserScripts: UnmodifiableListView([
                  UserScript(
                    source: bridgeScript,
                    injectionTime: UserScriptInjectionTime.AT_DOCUMENT_START,
                  ),
                ]),
                initialSettings: InAppWebViewSettings(
                  // The engine starts audio from its own first-gesture unlock
                  // (main.js); a WebView's default gate would swallow it.
                  mediaPlaybackRequiresUserGesture: false,
                  // iOS: the unlock plays a silent <audio> loop inline.
                  allowsInlineMediaPlayback: true,
                  applicationNameForUserAgent: userAgentTag,
                  useShouldOverrideUrlLoading: true,
                  // A horizontal drag is a step paint or a fine knob trim,
                  // never "go back".
                  allowsBackForwardNavigationGestures: false,
                  isInspectable: kDebugMode,
                  // Android: keep the renderer at full priority when the app
                  // is not on screen, or the system reclaims it mid-song.
                  rendererPriorityPolicy: RendererPriorityPolicy(
                    rendererRequestedPriority: RendererPriority.RENDERER_PRIORITY_IMPORTANT,
                    waivedWhenNotVisible: false,
                  ),
                  transparentBackground: true,
                ),
                onWebViewCreated: (c) {
                  _web = c;
                  _addHandlers(c);
                },
                shouldOverrideUrlLoading: _route,
                onLoadStart: (_, _) {
                  if (_error != null) setState(() => _error = null);
                },
                onReceivedError: (_, request, error) {
                  if (request.isForMainFrame != true) return;
                  if (error.type == WebResourceErrorType.CANCELLED) return;
                  setState(() => _error = error.description);
                },
              ),
              if (_error != null) _Offline(message: _error!, onRetry: () => _web?.reload()),
            ],
          ),
        ),
      ),
    );
  }
}

class _Offline extends StatelessWidget {
  const _Offline({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: const Color(studioBackground),
      child: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text('seqbaby could not load', style: TextStyle(fontSize: 18)),
              const SizedBox(height: 8),
              Text(message, textAlign: TextAlign.center, style: const TextStyle(color: Colors.white54)),
              const SizedBox(height: 20),
              OutlinedButton(onPressed: onRetry, child: const Text('retry')),
            ],
          ),
        ),
      ),
    );
  }
}
