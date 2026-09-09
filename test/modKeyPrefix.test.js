import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// The mod / automation key namespaces are `<engine>_<short>` and `<engine>.<short>`,
// and both dispatchers strip that prefix to get the voice's param name. When the
// emulators were renamed, `virus_`/`dx7_` became `contagion_`/`hexop_` but the
// hand-counted `slice(6)` / `slice(4)` stayed behind — so every contagion and
// hexop panel control resolved to a param name that doesn't exist, and attaching
// an LFO or a lane to one did nothing at all. Nothing failed loudly; the knob
// just sat there.
//
// So: a prefix is never counted by hand. This walks the two dispatchers and
// asserts that any literal slice inside a `startsWith("<prefix>")` branch is
// exactly that prefix's length.
const FILES = ["public/js/lfo.js", "public/js/automation.js"];

test("prefixed mod/automation keys are stripped by the prefix's own length", () => {
  for (const file of FILES) {
    const src = readFileSync(file, "utf8");
    const re = /startsWith\("([^"]+)"\)[\s\S]{0,240}?key\.slice\((\d+)\)/g;
    for (const [, prefix, n] of src.matchAll(re)) {
      assert.equal(Number(n), prefix.length,
        `${file}: key.slice(${n}) under startsWith("${prefix}") — use afterPrefix(key, "${prefix}")`);
    }
  }
});
