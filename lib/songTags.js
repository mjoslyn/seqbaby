// A song's tags: a genre from the picker's list, or anything the owner types.
//
// Stored on the song as a JSON array of strings (songs.tags), like `engines`.
// One spelling per tag, so "Dub Techno", "dub  techno" and "#dub techno" are
// the same tag in a search: lowercase, single spaces, no leading #, no commas
// (a comma is how a tag is ended when typing). Pure, no imports: the data
// layer, the save box and `node --test` all run it.

export const TAG_MAX_LEN = 32;
export const TAGS_MAX = 8;

/** One tag as stored, or "" when nothing is left of it. @param {unknown} raw */
export function normalizeTag(raw) {
  if (typeof raw !== "string") return "";
  return raw
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u0000-\u001f\u007f,#<>"`]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, TAG_MAX_LEN)
    .trim();
}

/** A list of tags as stored: normalized, distinct, in the order given, at
 *  most TAGS_MAX. Anything that is not a list is no tags. @param {unknown} raw
 *  @returns {string[]} */
export function normalizeTags(raw) {
  const out = [];
  for (const t of Array.isArray(raw) ? raw : []) {
    const tag = normalizeTag(t);
    if (tag && !out.includes(tag)) out.push(tag);
    if (out.length >= TAGS_MAX) break;
  }
  return out;
}

/** `have` with `more` added after it (compose's auto-tag: it never removes). */
export function mergeTags(have, more) {
  return normalizeTags([...normalizeTags(have), ...normalizeTags(more)]);
}
