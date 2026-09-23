package com.playseqbaby.seqbaby

import com.ryanheise.audioservice.AudioServiceActivity

// audio_service's activity shares one FlutterEngine with its background
// service, so the lock-screen controls reach the running app.
class MainActivity : AudioServiceActivity()
