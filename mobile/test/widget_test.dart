import 'package:flutter_test/flutter_test.dart';
import 'package:seqbaby/config.dart';

void main() {
  test('studio links stay in the app, others go to the browser', () {
    expect(isStudioUrl(Uri.parse('https://www.playseqbaby.com/?s=abc')), isTrue);
    expect(isStudioUrl(Uri.parse('https://playseqbaby.com/?jam=room')), isTrue);
    expect(isStudioUrl(Uri.parse('https://playseqbaby.com/u/mike')), isTrue);
    expect(isStudioUrl(Uri.parse('https://github.com/mjoslyn/seqbaby')), isFalse);
    expect(isStudioUrl(Uri.parse('https://evilplayseqbaby.com/')), isFalse);
    expect(isStudioUrl(Uri.parse('mailto:x@playseqbaby.com')), isFalse);
  });
}
