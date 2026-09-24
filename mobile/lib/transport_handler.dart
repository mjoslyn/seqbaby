import 'package:audio_service/audio_service.dart';

/// The OS's view of the transport: the lock screen, Control Center, the
/// Android media notification and headset buttons.
///
/// It plays nothing itself; the web engine does. On Android its real job is
/// the foreground service audio_service runs while [playing] is true, which is
/// what keeps the process (and so the WebView) alive once the app is in the
/// background. On iOS the audio background mode does that and this only
/// supplies the Now Playing controls.
class TransportHandler extends BaseAudioHandler {
  /// Presses the studio's own play button (studio_page.dart), so a jam's
  /// play still lands on the room's beat.
  Future<void> Function()? onToggle;

  bool _playing = false;

  /// Called by the bridge whenever the engine's transport starts or stops.
  void report({required bool playing, required String title}) {
    _playing = playing;
    mediaItem.add(MediaItem(id: 'studio', title: title, album: 'seqbaby'));
    playbackState.add(PlaybackState(
      // A sequencer has no pause: stop rewinds. Shown as pause/play because
      // that is the button every lock screen draws in the middle.
      controls: [playing ? MediaControl.pause : MediaControl.play],
      androidCompactActionIndices: const [0],
      processingState: AudioProcessingState.ready,
      playing: playing,
    ));
  }

  Future<void> _toggleTo(bool want) async {
    if (_playing == want) return;
    await onToggle?.call();
  }

  @override
  Future<void> play() => _toggleTo(true);

  @override
  Future<void> pause() => _toggleTo(false);

  @override
  Future<void> stop() async {
    await _toggleTo(false);
    playbackState.add(playbackState.value.copyWith(
      processingState: AudioProcessingState.idle,
      playing: false,
    ));
  }
}
