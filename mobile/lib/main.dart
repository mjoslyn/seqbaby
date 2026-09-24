import 'package:app_links/app_links.dart';
import 'package:audio_service/audio_service.dart';
import 'package:audio_session/audio_session.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'config.dart';
import 'studio_page.dart';
import 'transport_handler.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // iOS: WKWebView plays through the app's audio session, and the default
  // category (ambient) is silenced by the ring/silent switch, which is why a
  // sequencer in mobile Safari goes quiet with the phone on silent. `music`
  // is the playback category: it plays regardless, like any music app.
  final session = await AudioSession.instance;
  await session.configure(const AudioSessionConfiguration.music());

  // Lock-screen controls, and on Android the foreground service that keeps
  // the app alive while the transport runs in the background.
  final transport = await AudioService.init(
    builder: TransportHandler.new,
    config: const AudioServiceConfig(
      androidNotificationChannelId: 'com.playseqbaby.seqbaby.transport',
      androidNotificationChannelName: 'Playback',
    ),
  );

  SystemChrome.setSystemUIOverlayStyle(SystemUiOverlayStyle.light.copyWith(
    systemNavigationBarColor: const Color(studioBackground),
  ));

  Uri? initial;
  try {
    final link = await AppLinks().getInitialLink();
    if (link != null && isStudioUrl(link)) initial = link;
  } catch (_) {}

  runApp(SeqbabyApp(transport: transport, initialUri: initial));
}

class SeqbabyApp extends StatelessWidget {
  const SeqbabyApp({super.key, required this.transport, this.initialUri});

  final TransportHandler transport;
  final Uri? initialUri;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'seqbaby',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        brightness: Brightness.dark,
        scaffoldBackgroundColor: const Color(studioBackground),
        fontFamily: 'monospace',
      ),
      home: StudioPage(transport: transport, initialUri: initialUri),
    );
  }
}
