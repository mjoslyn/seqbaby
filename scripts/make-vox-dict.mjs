// Builds public/js/data/cmudict.txt, the dictionary the vox's `phonetic` box
// loads (public/js/voxPhonetic.js), from CMUdict:
//
//   node scripts/make-vox-dict.mjs [path/to/cmudict.dict]
//
// With no path it downloads cmusphinx/cmudict's cmudict.dict from GitHub.
// Kept: words of plain letters (no apostrophes, digits or dots), the first
// pronunciation of each. Each phone is one character (ARPA_CODE), stress
// dropped, so a line is `night nYt`. The CMUdict notice heads the file as `#`
// lines, which is what its license asks of a redistribution.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ARPA_CODE } from "../public/js/voxPhonetic.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = "https://raw.githubusercontent.com/cmusphinx/cmudict/master/";

const get = async (name) => {
  const r = await fetch(SRC + name);
  if (!r.ok) throw new Error(`${name}: ${r.status}`);
  return r.text();
};

const dictText = process.argv[2] ? await readFile(process.argv[2], "utf8") : await get("cmudict.dict");
const license = process.argv[3] ? await readFile(process.argv[3], "utf8") : await get("LICENSE");

const lines = [];
for (const line of dictText.split("\n")) {
  const m = line.match(/^([a-z]+) ([A-Z0-9 ]+?)(\s*#.*)?$/);
  if (!m) continue;   // alternates are word(2), and anything with punctuation
  const code = m[2].split(" ").map(p => ARPA_CODE[p.replace(/\d/g, "")]);
  if (code.some(c => !c)) continue;
  lines.push(`${m[1]} ${code.join("")}`);
}

const header = [
  "CMUdict, respelled one character a phone for seqbaby's vox (scripts/make-vox-dict.mjs).",
  "Source: https://github.com/cmusphinx/cmudict",
  "",
  ...license.trim().split("\n"),
].map(l => `# ${l}`.trimEnd());

const out = join(root, "public", "js", "data", "cmudict.txt");
await mkdir(dirname(out), { recursive: true });
await writeFile(out, header.join("\n") + "\n" + lines.join("\n") + "\n");
console.log(`[make-vox-dict] ${lines.length} words -> public/js/data/cmudict.txt`);
