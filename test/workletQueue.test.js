import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

// The worklets' event queues, exercised outside a browser.
//
// They are the one piece of the processors that is pure bookkeeping rather than
// DSP: what order events come out in, what a stop throws away, what happens
// when more is queued than there is room for. All of it decides when a note
// sounds, none of it is audible when you read the code, and a mistake in it is
// the kind that only shows up as a note in the wrong place two bars later.
//
// A processor source is a template literal inside its module and cannot be
// imported (the module reaches for the DOM and Tone at load), so the source is
// read as TEXT and evaluated against the two globals a worklet scope provides.
// That is also why this file asserts the queue's SEMANTICS rather than a golden
// buffer of samples: the DSP above it is meant to change, this is not.

/** The queue class out of one processor source, with the worklet scope stubbed. */
function queueClassOf(module, name) {
  const file = fs.readFileSync(new URL(`../public/js/${module}.js`, import.meta.url), "utf8");
  const m = file.match(/SOURCE = `([\s\S]*?)\n`;/);
  assert.ok(m, `${module}.js: no processor SOURCE template literal`);
  const prelude = `
    globalThis.sampleRate = 48000;
    globalThis.currentFrame = 0;
    globalThis.currentTime = 0;
    globalThis.registerProcessor = () => {};
    class AudioWorkletProcessor { constructor() { this.port = { onmessage: null, postMessage() {} }; } }
    globalThis.AudioWorkletProcessor = AudioWorkletProcessor;
  `;
  return new Function(`${prelude}${m[1]}\n return ${name};`)();
}

// The five polyphonic engines carry the identical queue; the silverbox's is the
// same shape with its own fields (it is monophonic and has no note-offs, so a
// note carries its gate length and its accent instead of an id).
const POLY = ["contagion", "hexop", "guitar", "bass", "subbass"];

/** Drain a queue into plain objects, so an assertion can read what came out. */
const drain = (q, upTo = Infinity) => {
  const out = [];
  while (q.len && q.headAt() <= upTo) {
    const e = q.shift();
    out.push({ ...e });
  }
  return out;
};

for (const module of POLY) {
  const EventQueue = queueClassOf(module, "EventQueue");
  const push = (q, at, off, id) => q.push(at, off, id, 60, 440, 1, 0);

  test(`${module}: events come out in time order however they went in`, () => {
    const q = new EventQueue();
    const ats = [500, 100, 900, 100, 300, 50, 1200, 700, 700, 20];
    ats.forEach((at, i) => push(q, at, false, i));
    const got = drain(q).map(e => e.at);
    assert.deepEqual(got, ats.slice().sort((a, b) => a - b));
    assert.equal(q.len, 0);
  });

  test(`${module}: a tie keeps the order it was pushed in`, () => {
    // The stable sort this replaced guaranteed it, and it is what puts a step's
    // note-on after the previous step's note-off when a gate ends exactly as
    // the next note lands.
    const q = new EventQueue();
    for (let i = 0; i < 6; i++) push(q, 1000, false, i);
    push(q, 999, true, 99);          // inserts BEFORE all six
    push(q, 1000, false, 6);         // and this one after them
    const got = drain(q);
    assert.deepEqual(got.map(e => e.id), [99, 0, 1, 2, 3, 4, 5, 6]);
  });

  test(`${module}: only events due are handed over`, () => {
    const q = new EventQueue();
    [10, 20, 30, 40].forEach((at, i) => push(q, at, false, i));
    assert.deepEqual(drain(q, 25).map(e => e.at), [10, 20]);
    assert.equal(q.len, 2);
    assert.equal(q.headAt(), 30);
  });

  test(`${module}: a stop keeps only the note-offs before it`, () => {
    // A note that has not started must not start, and a release past the stop
    // has nothing left to release.
    const q = new EventQueue();
    push(q, 100, false, 1); push(q, 400, true, 1);
    push(q, 200, false, 2); push(q, 250, true, 2);
    push(q, 600, false, 3); push(q, 900, true, 3);
    q.keepOffsBefore(500);
    const got = drain(q);
    assert.deepEqual(got.map(e => [e.at, e.off, e.id]), [[250, true, 2], [400, true, 1]]);
  });

  test(`${module}: a stop before everything empties the queue`, () => {
    const q = new EventQueue();
    push(q, 100, false, 1); push(q, 400, true, 1);
    q.keepOffsBefore(50);
    assert.equal(q.len, 0);
  });

  test(`${module}: dropping takes the EARLIEST pending event`, () => {
    // It is what the array's shift() took off a sorted queue, and the caller
    // still reaches for it on every note once the queue is over its cap.
    const q = new EventQueue();
    [300, 100, 200].forEach((at, i) => push(q, at, false, i));
    q.dropOldest();
    assert.deepEqual(drain(q).map(e => e.at), [200, 300]);
  });

  test(`${module}: the fields survive the round trip exactly`, () => {
    // f64 throughout, and deliberately: an f32 round trip moves a frequency by
    // a part in ten million, which decorrelates an oscillator's phase inside a
    // few hundred samples and stops a song rendering the way it used to.
    const q = new EventQueue();
    const freq = 440 * Math.pow(2, (61 - 69) / 12);   // not representable in f32
    const glide = 0.1 / 3;
    q.push(12345678, false, 7, 61, freq, 0.7, glide);
    const e = q.shift();
    assert.equal(e.at, 12345678);
    assert.equal(e.off, false);
    assert.equal(e.id, 7);
    assert.equal(e.note, 61);
    assert.equal(e.freq, freq);
    assert.equal(e.vel, 0.7);
    assert.equal(e.glide, glide);
  });

  test(`${module}: nothing is allocated after construction`, () => {
    // The whole point of the change: this runs on the audio thread, where a GC
    // pause is not a slow frame but a dropout. One scratch event is reused by
    // every shift(), and the buffers never grow or get replaced — so the queue
    // is walked well past its own capacity here, compaction included.
    const q = new EventQueue();
    const buffers = [q.at, q.id, q.note, q.freq, q.vel, q.glide, q.off];
    const scratch = q.ev;
    let at = 0;
    for (let i = 0; i < 20000; i++) {
      push(q, at, false, i);
      push(q, at + 5000, true, i);
      at += 137;
      while (q.len > 40) assert.equal(q.shift(), scratch);   // the same object, always
    }
    assert.deepEqual([q.at, q.id, q.note, q.freq, q.vel, q.glide, q.off], buffers);
    // and it is still in order after all that walking and compacting
    const got = drain(q).map(e => e.at);
    assert.deepEqual(got, got.slice().sort((a, b) => a - b));
  });
}

test("silverbox: notes come out in time order and ties hold", () => {
  const NoteQueue = queueClassOf("silverbox", "NoteQueue");
  const q = new NoteQueue();
  const ats = [500, 100, 900, 100, 300, 50];
  ats.forEach((at, i) => q.push(at, 110 + i, 0.05, 0, false, 0.058));
  const got = drain(q);
  assert.deepEqual(got.map(e => e.at), ats.slice().sort((a, b) => a - b));
  // the two notes at 100 kept their push order, so their freqs are in it too
  assert.deepEqual(got.filter(e => e.at === 100).map(e => e.freq), [111, 113]);
});

test("silverbox: a stop drops later notes and shortens the gates of earlier ones", () => {
  // The transport schedules ~100ms ahead, so a stop lands in the middle of
  // notes that have not been triggered yet: the ones before it still play, but
  // only up to the stop.
  const NoteQueue = queueClassOf("silverbox", "NoteQueue");
  const sr = 48000;
  const q = new NoteQueue();
  q.push(1000, 110, 0.5, 0, false, 0.058);    // gate runs well past the stop
  q.push(2000, 220, 0.001, 0, false, 0.058);  // gate already ends before it
  q.push(9000, 330, 0.05, 0, false, 0.058);   // never starts
  q.truncateAt(5000, sr);
  const got = drain(q);
  assert.deepEqual(got.map(e => e.freq), [110, 220]);
  assert.equal(got[0].gate, (5000 - 1000) / sr);   // shortened to the stop
  assert.equal(got[1].gate, 0.001);                // already shorter, untouched
});

test("silverbox: dropping takes the earliest, and nothing is allocated after construction", () => {
  const NoteQueue = queueClassOf("silverbox", "NoteQueue");
  const q = new NoteQueue();
  [300, 100, 200].forEach((at, i) => q.push(at, 110 + i, 0.05, 0, false, 0.058));
  q.dropOldest();
  assert.deepEqual(drain(q).map(e => e.at), [200, 300]);

  const buffers = [q.at, q.freq, q.gate, q.accent, q.slideTime, q.slide];
  let at = 0;
  for (let i = 0; i < 20000; i++) {
    q.push(at, 110, 0.05, 0, false, 0.058);
    at += 61;
    while (q.len > 20) assert.equal(q.shift(), q.ev);
  }
  assert.deepEqual([q.at, q.freq, q.gate, q.accent, q.slideTime, q.slide], buffers);
});
