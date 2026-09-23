import 'dart:convert';
import 'dart:io';

import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';

import 'config.dart';

/// The native halves of the bridge's handlers (bridge.dart).

/// iPad presents the share sheet as a popover and throws without an anchor.
Rect _shareOrigin(BuildContext context) {
  final size = MediaQuery.sizeOf(context);
  return Rect.fromCenter(center: size.center(Offset.zero), width: 1, height: 1);
}

/// A bounce or an export: written to the cache and offered through the share
/// sheet, which is where "save to Files", AirDrop and every other app live.
Future<void> saveDownload(BuildContext context, Map<String, dynamic> file) async {
  final origin = _shareOrigin(context);
  final name = _safeName(file['name'] as String? ?? 'seqbaby');
  final bytes = base64Decode(file['data'] as String? ?? '');
  final dir = await getTemporaryDirectory();
  final out = File('${dir.path}/$name');
  await out.writeAsBytes(bytes, flush: true);
  await SharePlus.instance.share(ShareParams(
    files: [XFile(out.path, mimeType: file['mime'] as String?, name: name)],
    sharePositionOrigin: origin,
  ));
}

/// The engine copies a share link to the clipboard and says so in its status
/// line. That still happens; a studio link also opens the share sheet, since
/// on a phone sending it somewhere is what the copy was for.
Future<void> copyText(BuildContext context, String text) async {
  final origin = _shareOrigin(context);
  await Clipboard.setData(ClipboardData(text: text));
  final uri = Uri.tryParse(text.trim());
  if (uri != null && isStudioUrl(uri)) {
    await SharePlus.instance.share(ShareParams(text: text.trim(), sharePositionOrigin: origin));
  }
}

Future<void> shareData(BuildContext context, Map<String, dynamic> data) async {
  final origin = _shareOrigin(context);
  final parts = [data['text'], data['url']]
      .whereType<String>()
      .where((s) => s.isNotEmpty)
      .join('\n');
  if (parts.isEmpty) return;
  final title = data['title'] as String?;
  await SharePlus.instance.share(ShareParams(
    text: parts,
    subject: (title == null || title.isEmpty) ? null : title,
    sharePositionOrigin: origin,
  ));
}

String _safeName(String name) {
  final cleaned = name.replaceAll(RegExp(r'[/\\:*?"<>|]'), '_').trim();
  return cleaned.isEmpty ? 'seqbaby' : cleaned;
}
