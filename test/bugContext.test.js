import test from "node:test";
import assert from "node:assert/strict";
import {
  cleanUrl,
  studioSnapshot,
  cleanStudio,
  pickContext,
  contextRows,
  contextMarkdown,
  STUDIO_MAX_AGE_MS,
} from "../app/superbugs/bugContext.js";

const ORIGIN = "https://seqbaby.netlify.app";
const NOW = 1_800_000_000_000;

const snap = (over = {}) =>
  studioSnapshot({
    href: `${ORIGIN}/studio?open=abc`,
    origin: ORIGIN,
    title: "cold squelch",
    bpm: 128,
    tracks: [
      { name: "kick", engineKey: "808:kick" },
      { name: "dm:silverbox", engineKey: "dm:silverbox" },
    ],
    activePattern: 2,
    playing: true,
    jam: false,
    now: NOW - 4 * 60000,
    ...over,
  });

test("a jam invite never lands on a public issue", () => {
  assert.equal(cleanUrl(`${ORIGIN}/studio?jam=room1&by=mike&open=x#h`, ORIGIN), `${ORIGIN}/studio?open=x`);
});

test("only this site's pages, and only web links", () => {
  assert.equal(cleanUrl("https://evil.example/x", ORIGIN), "");
  assert.equal(cleanUrl("javascript:alert(1)"), "");
  assert.equal(cleanUrl("not a url"), "");
  assert.equal(cleanUrl(""), "");
});

test("the snapshot survives the round trip through storage and the route", () => {
  const s = snap();
  assert.deepEqual(cleanStudio(JSON.parse(JSON.stringify(s)), ORIGIN), s);
  assert.equal(s.pattern, 3, "numbered from 1, as the pattern bar is");
});

test("anything else in the key is not a snapshot", () => {
  assert.equal(cleanStudio(null), null);
  assert.equal(cleanStudio("hello"), null);
  assert.equal(cleanStudio({ url: "x" }), null);
});

test("an engine that has not booted still leaves a usable note", () => {
  const s = studioSnapshot({ href: `${ORIGIN}/studio`, origin: ORIGIN, bpm: NaN, now: NOW });
  assert.equal(s.bpm, null);
  assert.equal(s.trackCount, 0);
  assert.deepEqual(contextRows({ studio: s }, NOW).map((r) => r.label), ["last studio session", "studio link"]);
});

test("the referrer is dropped when it is superbugs itself or another site", () => {
  assert.equal(pickContext({ referrer: `${ORIGIN}/superbugs`, origin: ORIGIN, now: NOW }).referrer, null);
  assert.equal(pickContext({ referrer: "https://google.com/", origin: ORIGIN, now: NOW }).referrer, null);
  assert.equal(pickContext({ referrer: `${ORIGIN}/manual`, origin: ORIGIN, now: NOW }).referrer, `${ORIGIN}/manual`);
});

test("a studio visit from yesterday is not what the report is about", () => {
  const stale = snap({ now: NOW - STUDIO_MAX_AGE_MS - 1 });
  assert.equal(pickContext({ studio: stale, origin: ORIGIN, now: NOW }).studio, null);
  assert.ok(pickContext({ studio: snap(), origin: ORIGIN, now: NOW }).studio);
});

test("the issue says where, what and when", () => {
  const md = contextMarkdown({ referrer: `${ORIGIN}/manual`, studio: snap() }, NOW);
  assert.equal(
    md,
    [
      "### Context",
      `- came from: ${ORIGIN}/manual`,
      '- last studio session: `"cold squelch", 4 min ago`',
      `- studio link: ${ORIGIN}/studio?open=abc`,
      "- transport: `128 bpm, pattern 3, playing`",
      "- tracks: `kick (808:kick), dm:silverbox`",
    ].join("\n"),
  );
});

test("a track name cannot break out of its code span", () => {
  const md = contextMarkdown({ studio: snap({ tracks: [{ name: "a`@b`", engineKey: "x" }] }) }, NOW);
  assert.ok(md.includes("`a'@b' (x)`"));
});

test("nothing to say is an empty section, not a heading", () => {
  assert.equal(contextMarkdown({ referrer: null, studio: null }, NOW), "");
});
