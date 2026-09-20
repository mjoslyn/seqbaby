// The words on a link preview when the link is an invitation: a song someone
// published, or a jam someone started. Pure, with no imports, for
// app/songs/songName.js's reason: node --test exercises it
// (test/shareCopy.test.js) without a browser or a React renderer, and it is
// on the metadata path, where a throw is a page that fails to render.

/** Whoever the card names. Null or blank means nobody could be named, and
 *  the sentence says "Someone" rather than leaving a hole. */
function who(name) {
  const n = typeof name === "string" ? name.trim() : "";
  return n || "Someone";
}

/**
 * The card for a shared song: `mike has shared "cold squelch" with you`.
 * `title` is the song's; `name` is the owner's handle, or null when the
 * owner could not be resolved (a profile lookup that failed, a profile with
 * no handle yet).
 */
export function songShareTitle(name, title) {
  const t = typeof title === "string" ? title.trim() : "";
  return `${who(name)} has shared "${t}" with you`;
}

/** The card for a jam invite: `mike has shared a jam with you`. */
export function jamShareTitle(name) {
  return `${who(name)} has shared a jam with you`;
}
