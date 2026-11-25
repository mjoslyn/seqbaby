// The critic: a second reading of the song a compose turn says it has finished.
//
// The checks around a turn are code (productionNotes, the polish pass, the
// meters), and code can say a velocity is flat or a track is silent. It cannot
// say the bass is in another key than the chords, that nothing in the song is
// a hook, or that the request asked for a breakdown and there is none. The
// model that wrote the song is the wrong one to ask: it has forty rounds of
// its own decisions in context and has just said it is done. So one more
// model call, with none of that conversation: the request, the song as it
// stands, and the question a producer asks on first hearing a session.
//
// What comes back is advice, sent to the composing model once as a user
// message; it acts on what it agrees with. Only a turn that wrote a
// substantial amount gets one (`criticWanted`): reviewing a filter tweak is
// tokens for nothing.
//
// Plain JS and no SDK import: the caller hands in its client, so `node --test`
// runs everything here but the call itself.

import * as sb from "../public/js/songBuilder.js";

/** How many parts (a track's pattern) a turn must have written to be reviewed. */
export const CRITIC_MIN_PARTS = 3;
export const CRITIC_MAX_NOTES = 4;
const NOTE_MAX_CHARS = 420;
export const CRITIC_EFFORT = process.env.COMPOSE_CRITIC_EFFORT || "medium";

const parse = (v) => (typeof v === "string" ? JSON.parse(v) : v);

/** How many (track, pattern) parts differ between two songs' notes. Tracks are
 *  compared by index, which is how a turn addresses them; a track that moved
 *  counts as written, which errs towards a review. */
export function partsWritten(before, song) {
  const a = parse(before)?.tracks || [], b = song?.tracks || [];
  let n = 0;
  for (let i = 0; i < b.length; i++) {
    const pa = a[i]?.patterns || [], pb = b[i]?.patterns || [];
    for (let p = 0; p < Math.max(pa.length, pb.length); p++) {
      const has = (x) => !!x?.steps?.some(Boolean);
      if (!has(pa[p]) && !has(pb[p])) continue;
      if (JSON.stringify(pa[p] ?? null) !== JSON.stringify(pb[p] ?? null)) n++;
    }
  }
  return n;
}

/** Whether a turn wrote enough music to be worth a second opinion. */
export function criticWanted(before, song) {
  return partsWritten(before, song) >= CRITIC_MIN_PARTS;
}

export const CRITIC_SYSTEM = `You are the second pair of ears on a song written in seqbaby, a browser step sequencer. Another model wrote or edited the song from a person's request. It works blind (it cannot hear) and it has just said it is finished. You are shown the request and the song as data. Read it the way a producer reads a session before a mix: does this deliver what was asked for, and would it hold a listener?

What is worth your attention is what only a musical reading finds:
- The request: is what it names actually there (the genre's defining features, the instruments, the mood, the sections it asked for)?
- Harmony: do the bass, the chords and the lead agree on roots and scale, and move together? Is there a progression, or one note throughout?
- A hook: is there something a listener would remember, or only texture?
- Rhythm: do the kick, the bass and the hats lock into a groove, or does everything land on every step, or nothing land together?
- Register: parts stacked in one octave, an empty bottom or an empty top.
- Arrangement: do the sections differ in a way you would hear, do parts enter and leave, is there tension and release, does it begin and end?
- Density: too many parts at once, or too little happening.

Code already checks these, so leave them alone: silent tracks, flat velocities, track levels and the meters, sidechain, whether there is reverb or delay, timing feel. And judge what was asked: a loop or a beat is one pattern and needs no arrangement; an edit to an existing song is judged on the edit, not on parts the turn did not touch; chiptune is meant to be mechanical.

Reading the data: tracks are numbered from 0, patterns 0..31, and in chain mode the sections play in order for the bars given. A step string is one character per step, sixteen to a bar unless the track's speed says otherwise: x a hit, X an accent, o a soft hit, . a rest, _ the note before held on. "notes" are the hits' pitches in order (C2 is the note a drum plays). "role" is the code's guess at what a track is for.

Reply in exactly this form and nothing else. First line: "VERDICT: pass" or "VERDICT: revise". If revise, then at most ${CRITIC_MAX_NOTES} lines each starting with "- ", most important first. Each note names the track and pattern it is about and says what to change in musical terms, concretely enough to act on without hearing it (for example: "- track 2 (bass), pattern 1: it stays on C2 while the chords move Am to F; follow the roots, A1 then F1"). Only notes a listener would hear the difference of. A song that does its job passes: do not invent notes to have some.`;

/** The song as the critic reads it: the builder's summary, with each track's
 *  role and without the per-step detail that repeats the step strings. */
export function songForCritic(song) {
  const s = sb.summarize(song);
  const tracks = (s.tracks || []).map((t, i) => {
    const out = { ...t, role: sb.trackRole(song.tracks[i]) };
    if (Array.isArray(out.patterns)) out.patterns = out.patterns.map(({ detail, ...p }) => p);
    return out;
  });
  return { ...s, tracks };
}

/** What the critic is sent. `before` is the song the turn started from. */
export function criticBrief(song, message, before) {
  const was = parse(before);
  const hadMusic = (was?.tracks || []).some((t) => (t.patterns || []).some((p) => p?.steps?.some(Boolean)));
  const context = hadMusic
    ? `The song already had music in it before this turn, and ${partsWritten(was, song)} parts (a track's pattern) were written or changed. Judge what the turn did.`
    : "The song was empty before this turn: all of it was written for this request.";
  return `What the person asked for:\n<request>\n${String(message || "").slice(0, 6000)}\n</request>\n\n${context}\n\nThe song as it stands:\n${JSON.stringify(songForCritic(song))}`;
}

/**
 * The critic's reply as notes, or null when it cannot be read as a verdict.
 * @returns {{ pass: boolean, notes: string[] } | null}
 */
export function parseCritique(text) {
  const t = String(text || "");
  const verdict = /VERDICT:\s*(pass|revise)/i.exec(t);
  if (!verdict) return null;
  const notes = t.slice(verdict.index).split("\n")
    .map((l) => /^\s*[-*•]\s+(.*\S)/.exec(l)?.[1])
    .filter(Boolean)
    .slice(0, CRITIC_MAX_NOTES)
    .map((n) => (n.length > NOTE_MAX_CHARS ? `${n.slice(0, NOTE_MAX_CHARS)}…` : n));
  // "revise" with nothing to act on is a pass; "pass" with notes is still a pass.
  const pass = verdict[1].toLowerCase() === "pass" || !notes.length;
  return { pass, notes: pass ? [] : notes };
}

/** The message a turn is sent back with after a review, or null to let it stop. */
export function criticNudge(notes) {
  if (!notes?.length) return null;
  return `A second listener read the finished song against what was asked for, with fresh ears and none of this conversation. Their notes:\n- ${notes.join("\n- ")}\nThis is a producer's opinion, not an error report. Act on the notes you agree with and that fit the request, leave the rest, then reply. There is no second review this turn.`;
}

/**
 * Ask for the review. One request, no tools, its own short system prompt.
 * Never throws: a review that fails costs the review, not the turn.
 * @returns {Promise<{ pass: boolean, notes: string[], usage: object | null } | null>}
 */
export async function critique({ anthropic, model, song, message, before, effort = CRITIC_EFFORT }) {
  try {
    const res = await anthropic.messages
      .stream({
        model,
        max_tokens: 8192,
        output_config: { effort },
        system: CRITIC_SYSTEM,
        messages: [{ role: "user", content: criticBrief(song, message, before) }],
      })
      .finalMessage();
    // A refusal or a reply cut off before its verdict reads as no review.
    const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
    const read = res.stop_reason === "refusal" ? null : parseCritique(text);
    return read ? { ...read, usage: res.usage || null } : null;
  } catch (e) {
    console.error("[compose] critic failed", e);
    return null;
  }
}
