import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  ARPA_CODE, phonesToVox, letterToSound, parseVoxDict, codeToPhones, voxRespell,
} from "../public/js/voxPhonetic.js";
import { voxSyllables, VOX_CONSONANT_NAMES } from "../public/js/engineData.js";
import { voxSungText } from "../public/js/vox.js";

// The vox's phonetic box: English respelled as syllables the voice can sing.
// What is pinned: the phones fold onto the vox's five vowels, glides and
// eighteen consonants the way the module says; a word is one note a
// syllable; the dictionary file is what the script writes, notice included;
// the letter-to-sound rules make anything singable; and every respelling
// reads back through voxSyllables as exactly the syllables it was written as.

const DICT_PATH = new URL("../public/js/data/cmudict.txt", import.meta.url);
const dict = parseVoxDict(fs.readFileSync(DICT_PATH, "utf8"));

test("voxPhonetic: phones fold onto the vox's vowels, glides and consonants", () => {
  assert.deepEqual(phonesToVox(["N", "AY1", "T"]), ["nait"]);
  assert.deepEqual(phonesToVox(["HH", "AH0", "L", "OW1"]), ["ha", "lou"]);
  assert.deepEqual(phonesToVox(["W", "ER1", "L", "D"]), ["wer"]);          // ER is an e with its r
  assert.deepEqual(phonesToVox(["S", "T", "R", "IH1", "NG"]), ["sin"]);    // a cluster keeps its first
  assert.deepEqual(phonesToVox(["B", "OY1"]), ["boi"]);
  assert.deepEqual(phonesToVox(["D", "EY1"]), ["dei"]);
  assert.deepEqual(phonesToVox(["N", "AW1"]), ["nau"]);
  assert.deepEqual(phonesToVox(["TH", "IH1", "NG", "K"]), ["fin"]);
  // between vowels one consonant starts the next syllable; of two, the
  // first ends this one
  assert.deepEqual(phonesToVox(["M", "AA1", "N", "S", "T", "ER0"]), ["man", "ser"]);
  assert.deepEqual(phonesToVox(["S", "IH1", "NG", "ER0"]), ["sin", "er"]); // ng never starts one
  assert.deepEqual(phonesToVox(["M"]), []);
});

test("voxPhonetic: every ARPAbet phone has a code, and codes round trip", () => {
  const codes = Object.values(ARPA_CODE);
  assert.equal(new Set(codes).size, codes.length, "two phones share a code");
  assert.ok(codes.every(c => c.length === 1 && c !== " " && c !== "#"));
  assert.deepEqual(codeToPhones("nYt"), ["N", "AY", "T"]);
});

test("voxPhonetic: the dictionary file is CMUdict, notice and all", () => {
  const text = fs.readFileSync(DICT_PATH, "utf8");
  assert.match(text, /^# CMUdict/);
  assert.match(text, /# Copyright \(C\) 1993-2015 Carnegie Mellon University/);
  assert.ok(dict.size > 100000, `${dict.size} words`);
  assert.equal(dict.get("night"), "nYt");
  assert.equal(dict.get("hello"), "h^lo");
  for (const [w, code] of dict) {
    assert.match(w, /^[a-z]+$/, `word ${w}`);
    assert.ok(codeToPhones(code).length === code.length, `${w}: unknown code in ${code}`);
  }
});

test("voxPhonetic: a lyric respelled from the dictionary", () => {
  assert.equal(voxRespell("hello world", dict), "ha-lou wer");
  assert.equal(voxRespell("The night is young!", dict), "da nait iz yan");
  assert.equal(voxRespell("hallelujah", dict), "ha-la-lu-ya");
  // a word with no vowel letter is left alone, so a hum still hums
  assert.equal(voxRespell("mmm la", dict), "mmm la");
  assert.equal(voxRespell("", dict), "");
});

test("voxPhonetic: words the dictionary lacks are guessed from their letters", () => {
  const r = (w) => phonesToVox(letterToSound(w)).join("-");
  assert.equal(r("night"), "nait");
  assert.equal(r("knight"), "nait");
  assert.equal(r("make"), "meik");      // vowel, consonant, final e
  assert.equal(r("time"), "taim");
  assert.equal(r("go"), "gou");
  assert.equal(r("my"), "mai");
  assert.equal(r("station"), "sa-shan");
  assert.equal(r("little"), "li-tal");
  assert.equal(r("zorblax"), "zor-bak");
  // with no dictionary at all, still something to sing
  assert.equal(voxRespell("make time", null), "meik taim");
});

test("voxPhonetic: a respelling reads back as exactly its syllables, one a note", () => {
  const N = VOX_CONSONANT_NAMES, V = "uoaei";
  const spell = (s) => `${s.cons ? N[s.cons] : ""}${s.vowel === -2 ? "" : V[Math.round(s.vowel * 4)]}${s.vowel2 >= 0 ? V[Math.round(s.vowel2 * 4)] : ""}${s.coda ? N[s.coda] : ""}`;
  const lines = [
    "twinkle twinkle little star how I wonder what you are",
    "I wanna dance with somebody who loves me",
    "beautiful string theory, strengths and rhythms",
    "she sells sea shells by the sea shore",
    "quixotic zephyrs jump over the lazy dogs",
  ];
  for (const line of lines) for (const d of [dict, null]) {
    const sung = voxRespell(line, d);
    const syl = sung.split(/[\s-]+/).filter(Boolean);
    const read = voxSyllables(sung);
    assert.equal(read.length, syl.length, `${line} -> ${sung}`);
    read.forEach((s, i) => assert.equal(spell(s), syl[i], `${line}: ${syl[i]} read as ${spell(s)}`));
  }
});

test("voxPhonetic: the voice sings the respelling only with the box ticked", () => {
  assert.equal(voxSungText("night", false), "night");
  assert.notEqual(voxSungText("night", true), "night");
});
