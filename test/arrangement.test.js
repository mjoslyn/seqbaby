// Tests for the arrangement: a track's timeline of pattern blocks. Run with
// `npm test`.
//
// The editor, the transport, the recorder and the song builder all go through
// these functions, so the properties pinned here are what every one of them
// promises: a list that is always sorted and never overlapping, a later block
// winning the bars it lands on, a gap being a gap.

import test from "node:test";
import assert from "node:assert/strict";
import {
  arrangementBars, blockAt, blocksEnd, chainToBlocks, checkBlock, cutRange, describeBlocks,
  moveBlock, normalizeBlocks, placeBlock, remapSlots, removeBlock, resizeBlock, setBlockSlot, writeBar,
} from "../public/js/arrangement.js";

const b = (slot, start, bars) => ({ slot, start, bars });

function assertTidy(blocks) {
  for (let i = 0; i < blocks.length; i++) {
    assert.equal(checkBlock(blocks[i]), null);
    if (i) assert.ok(blocks[i - 1].start + blocks[i - 1].bars <= blocks[i].start, `overlap at ${i}: ${JSON.stringify(blocks)}`);
  }
}

test("checkBlock names what is wrong", () => {
  assert.equal(checkBlock(b(0, 0, 1)), null);
  assert.equal(checkBlock(b(31, 100, 16)), null);
  assert.match(checkBlock(b(32, 0, 1)), /slot/);
  assert.match(checkBlock(b(-1, 0, 1)), /slot/);
  assert.match(checkBlock(b(0, -1, 1)), /start/);
  assert.match(checkBlock(b(0, 0.5, 1)), /start/);
  assert.match(checkBlock(b(0, 0, 0)), /bars/);
  assert.match(checkBlock(null), /block/);
  assert.match(checkBlock("x"), /block/);
});

test("normalizeBlocks: anything in, a sorted non-overlapping list out", () => {
  assert.deepEqual(normalizeBlocks(undefined), []);
  assert.deepEqual(normalizeBlocks("nope"), []);
  assert.deepEqual(normalizeBlocks([]), []);
  const out = normalizeBlocks([b(2, 8, 4), { slot: 99, start: 0, bars: 1 }, b(0, 0, 4), null, b(1, 4, 4)]);
  assert.deepEqual(out, [b(0, 0, 4), b(1, 4, 4), b(2, 8, 4)]);
  assertTidy(out);
});

test("normalizeBlocks: the later of two overlapping blocks wins", () => {
  const out = normalizeBlocks([b(0, 0, 8), b(1, 2, 2)]);
  assert.deepEqual(out, [b(0, 0, 2), b(1, 2, 2), b(0, 4, 4)]);
  assertTidy(out);
});

test("normalizeBlocks leaves its argument alone", () => {
  const raw = [b(1, 4, 4), b(0, 0, 4)];
  const snap = JSON.stringify(raw);
  const out = normalizeBlocks(raw);
  assert.equal(JSON.stringify(raw), snap);
  assert.notEqual(out[0], raw[1]);
});

test("cutRange splits a block it lands inside and removes one it covers", () => {
  const blocks = [b(0, 0, 8), b(1, 8, 2), b(2, 10, 4)];
  assert.deepEqual(cutRange(blocks, 2, 2), [b(0, 0, 2), b(0, 4, 4), b(1, 8, 2), b(2, 10, 4)]);
  assert.deepEqual(cutRange(blocks, 8, 2), [b(0, 0, 8), b(2, 10, 4)]);
  assert.deepEqual(cutRange(blocks, 6, 6), [b(0, 0, 6), b(2, 12, 2)]);
  assert.deepEqual(cutRange(blocks, 20, 4), blocks);
});

test("placeBlock cuts what it lands on", () => {
  const out = placeBlock([b(0, 0, 8)], b(3, 4, 8));
  assert.deepEqual(out, [b(0, 0, 4), b(3, 4, 8)]);
  assertTidy(placeBlock(out, b(5, 2, 4)));
  assert.deepEqual(placeBlock(out, b(5, 2, 4)), [b(0, 0, 2), b(5, 2, 4), b(3, 6, 6)]);
});

test("move and resize go through the same cut", () => {
  const blocks = [b(0, 0, 4), b(1, 4, 4), b(2, 8, 4)];
  assert.deepEqual(moveBlock(blocks, 2, 2), [b(0, 0, 2), b(2, 2, 4), b(1, 6, 2)]);
  assert.deepEqual(resizeBlock(blocks, 0, 6), [b(0, 0, 6), b(1, 6, 2), b(2, 8, 4)]);
  assert.deepEqual(resizeBlock(blocks, 0, 0), [b(0, 0, 1), b(1, 4, 4), b(2, 8, 4)], "at least one bar");
  assert.deepEqual(moveBlock(blocks, 0, -3), blocks, "never before bar 0");
  assert.deepEqual(moveBlock(blocks, 7, 2), blocks, "no such block");
  assert.deepEqual(removeBlock(blocks, 1), [b(0, 0, 4), b(2, 8, 4)]);
  assert.deepEqual(setBlockSlot(blocks, 1, 9), [b(0, 0, 4), b(9, 4, 4), b(2, 8, 4)]);
});

test("blockAt finds the block on a bar and null in a gap", () => {
  const blocks = [b(0, 0, 4), b(2, 8, 4)];
  assert.deepEqual(blockAt(blocks, 0), b(0, 0, 4));
  assert.deepEqual(blockAt(blocks, 3), b(0, 0, 4));
  assert.equal(blockAt(blocks, 4), null);
  assert.deepEqual(blockAt(blocks, 11), b(2, 8, 4));
  assert.equal(blockAt(blocks, 12), null);
  assert.equal(blockAt([], 0), null);
});

test("the arrangement is as long as its last block, never shorter than a bar", () => {
  assert.equal(blocksEnd([]), 0);
  assert.equal(blocksEnd([b(0, 0, 4), b(1, 8, 2)]), 10);
  assert.equal(arrangementBars([]), 1);
  assert.equal(arrangementBars([{ arrangement: [] }, {}]), 1);
  assert.equal(arrangementBars([{ arrangement: [b(0, 0, 4)] }, { arrangement: [b(1, 12, 4)] }]), 16);
});

test("writeBar records a held clip as one block and a stop as a gap", () => {
  let a = [];
  a = writeBar(a, 0, 3);
  a = writeBar(a, 1, 3);
  a = writeBar(a, 2, 3);
  assert.deepEqual(a, [b(3, 0, 3)]);
  a = writeBar(a, 3, null);          // stopped for a bar
  assert.deepEqual(a, [b(3, 0, 3)]);
  a = writeBar(a, 4, 5);
  a = writeBar(a, 5, 3);             // a different clip, then back to 3: a new block, not an extension
  assert.deepEqual(a, [b(3, 0, 3), b(5, 4, 1), b(3, 5, 1)]);
  assertTidy(a);
});

test("writeBar over an existing arrangement rewrites only the bars it passes", () => {
  let a = [b(0, 0, 8)];
  a = writeBar(a, 2, 1);
  assert.deepEqual(a, [b(0, 0, 2), b(1, 2, 1), b(0, 3, 5)]);
  a = writeBar(a, 3, 1);
  assert.deepEqual(a, [b(0, 0, 2), b(1, 2, 2), b(0, 4, 4)]);
  a = writeBar(a, 7, null);
  assert.deepEqual(a, [b(0, 0, 2), b(1, 2, 2), b(0, 4, 3)]);
  a = writeBar(a, 20, 2);            // past the end: a gap, then a block
  assert.deepEqual(a, [b(0, 0, 2), b(1, 2, 2), b(0, 4, 3), b(2, 20, 1)]);
});

test("remapSlots follows the pattern bar's permutation and drops a vanished slot", () => {
  // movePattern's `order`: order[newIdx] === oldIdx. Moving slot 2 before slot 0:
  const order = [2, 0, 1, 3];
  assert.deepEqual(remapSlots([b(0, 0, 4), b(2, 4, 4), b(1, 8, 4)], order), [b(1, 0, 4), b(0, 4, 4), b(2, 8, 4)]);
  assert.deepEqual(remapSlots([b(7, 0, 4), b(3, 4, 4)], order), [b(3, 4, 4)]);
});

test("chainToBlocks lays the chain end to end, a repeat count each", () => {
  const repeats = Array.from({ length: 32 }, () => 1);
  repeats[0] = 4; repeats[2] = 8;
  assert.deepEqual(chainToBlocks(repeats, [0, 2, 5]), [b(0, 0, 4), b(2, 4, 8), b(5, 12, 1)]);
  assert.deepEqual(chainToBlocks(repeats, []), []);
  assert.deepEqual(chainToBlocks(null, [1]), [b(1, 0, 1)]);
});

test("describeBlocks reads back in bars and patterns numbered from 1", () => {
  assert.equal(describeBlocks([]), "empty");
  assert.equal(describeBlocks([b(0, 0, 4), b(2, 8, 8)]), "1-4 p1, 5-8 rest, 9-16 p3");
});
