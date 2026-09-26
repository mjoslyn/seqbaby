// Tidal / Strudel mini-notation, and the small pattern algebra it needs.
//
// A pattern here is what it is in Tidal: a function from a span of time
// (measured in CYCLES, one cycle being one bar) to the events that start in
// it. That one idea is all the notation is -- `[a b]` squeezes two things
// into a step, `<a b>` takes turns a cycle each, `*2` queries twice the time
// and squeezes it back -- so rather than expanding a string straight into a
// step grid (which is how `<a b>` and `/3` get lost) the parser builds a tree
// of patterns and the caller asks it what happens in cycles 0, 1, 2 ...
//
// Only ONSETS matter to seqbaby (a step is a note that starts), so a query
// returns the events whose begin lies in [b, e) -- never a fragment of an event
// that started earlier. That keeps every combinator a few lines long.
//
// No imports, for sessionFormat.js's reason: pure, so `node --test` runs it
// (test/miniNotation.test.js) and the song builder can use it under Node.
//
// What is understood:
//   a b c        a sequence, each a step of the cycle
//   ~  -         a rest
//   [a b]        a sub-sequence squeezed into one step
//   <a b>        one per cycle, taking turns
//   a, b         (inside [] <> {} or at the top) layers played together
//   a | b        a random choice per cycle
//   {a b c}%4    polymeter: steps taken four to a cycle, wrapping
//   a*2  a/2     faster / slower (the factor may itself be a pattern: a*<2 4>)
//   a!3  a !     replicate
//   a@3  a _ _   elongate (weight in the sequence)
//   a?  a?0.3    drop at random (deterministically, see rand)
//   a(3,8,2)     euclidean: 3 of 8, rotated 2
//   0 .. 7       a range of numbers
//   a . b c      groups separated by dots

const EPS = 1e-9;

/** @typedef {{begin: number, end: number, value: any, locs: number[][]}} Hap */

/** A pattern: a query from [b, e) (cycles) to the haps that START in it. */
export class Pattern {
  /** @param {(b: number, e: number) => Hap[]} query */
  constructor(query) { this.query = query; }
  /** Every hap that starts in cycle c. */
  cycle(c) { return this.query(c, c + 1); }
  withValue(f) { return new Pattern((b, e) => this.query(b, e).map(h => ({ ...h, value: f(h.value, h) }))); }
  filter(f) { return new Pattern((b, e) => this.query(b, e).filter(f)); }
  fast(n) { return fast(this, n); }
  slow(n) { return fast(this, 1 / n); }
}

export const silence = new Pattern(() => []);

const inArc = (t, b, e) => t >= b - EPS && t < e - EPS;

/** One event a cycle, lasting the cycle. */
export function pure(value, loc) {
  const locs = loc ? [loc] : [];
  return new Pattern((b, e) => {
    const out = [];
    for (let c = Math.ceil(b - EPS); c < e - EPS; c++) out.push({ begin: c, end: c + 1, value, locs });
    return out;
  });
}

export function fast(pat, n) {
  if (!(n > 0) || !Number.isFinite(n)) return silence;
  if (Math.abs(n - 1) < EPS) return pat;
  return new Pattern((b, e) => pat.query(b * n, e * n).map(h => ({ ...h, begin: h.begin / n, end: h.end / n })));
}

/** Shift later by t cycles. */
export function late(pat, t) {
  if (!t) return pat;
  return new Pattern((b, e) => pat.query(b - t, e - t).map(h => ({ ...h, begin: h.begin + t, end: h.end + t })));
}

export function stack(...pats) {
  const ps = pats.flat().filter(Boolean);
  return new Pattern((b, e) => ps.flatMap(p => p.query(b, e)));
}

/** Split a query into whole-cycle pieces: f(c, b', e') for each cycle touched. */
function perCycle(b, e, f) {
  const out = [];
  for (let c = Math.floor(b + EPS); c < e - EPS; c++) {
    const lo = Math.max(b, c), hi = Math.min(e, c + 1);
    if (hi - lo > EPS) out.push(...f(c, lo, hi));
  }
  return out;
}

/**
 * A sequence squeezed into each cycle: `items` are {pat, weight}. Each child is
 * queried at its own cycle c and compressed into its slot, which is what makes
 * `<a b> c` alternate the first step and not the whole bar.
 */
export function timecat(items) {
  const list = items.filter(it => it.weight > 0);
  const W = list.reduce((s, it) => s + it.weight, 0);
  if (!list.length || !(W > 0)) return silence;
  return new Pattern((b, e) => perCycle(b, e, (c, lo, hi) => {
    const out = [];
    let acc = 0;
    for (const { pat, weight } of list) {
      const s0 = c + acc / W, s1 = c + (acc + weight) / W, k = weight / W;
      acc += weight;
      const qb = Math.max(lo, s0), qe = Math.min(hi, s1);
      if (qe - qb <= EPS) continue;
      const cb = c + (qb - s0) / k, ce = c + (qe - s0) / k;
      for (const h of pat.query(cb, ce)) {
        out.push({ ...h, begin: s0 + (h.begin - c) * k, end: s0 + (h.end - c) * k });
      }
    }
    return out;
  }));
}
export const fastcat = (...pats) => timecat(pats.flat().map(pat => ({ pat, weight: 1 })));

/** One child per cycle, in turn; each child's own cycles advance only when it plays. */
export function slowcat(...pats) {
  const ps = pats.flat();
  const n = ps.length;
  if (!n) return silence;
  return new Pattern((b, e) => perCycle(b, e, (c, lo, hi) => {
    const i = ((c % n) + n) % n, k = Math.floor(c / n), shift = c - k;
    return ps[i].query(lo - shift, hi - shift).map(h => ({ ...h, begin: h.begin + shift, end: h.end + shift }));
  }));
}

/** A random child per cycle. */
export function randcat(pats, seed = 0) {
  const n = pats.length;
  if (!n) return silence;
  return new Pattern((b, e) => perCycle(b, e, (c, lo, hi) => pats[Math.floor(rand(c, seed + 7919) * n) % n].query(lo, hi)));
}

/** Reverse each cycle. */
export function rev(pat) {
  return new Pattern((b, e) => perCycle(b, e, (c) => pat.cycle(c).map(h => {
    const nb = 2 * c + 1 - h.end;
    return { ...h, begin: Math.max(c, nb), end: 2 * c + 1 - h.begin };
  })).filter(h => inArc(h.begin, b, e)));
}

/** Each event repeated n times inside its own span. */
export function ply(pat, n) {
  const k = Math.max(1, Math.round(n));
  return new Pattern((b, e) => {
    const out = [];
    // an event that starts before b can still have repeats inside [b, e)
    for (const h of pat.query(Math.floor(b), e)) {
      const d = (h.end - h.begin) / k;
      for (let i = 0; i < k; i++) {
        const t = h.begin + i * d;
        if (inArc(t, b, e)) out.push({ ...h, begin: t, end: t + d });
      }
    }
    return out;
  });
}

/** Drop events at random, the same ones every time (hash of when + seed). */
export function degradeBy(pat, amount = 0.5, seed = 0) {
  return pat.filter(h => rand(h.begin, seed) >= amount);
}

/** Bjorklund proper (the same answer as euclid.js): E(3,8) is x..x..x. */
export function bjorklund(pulses, steps) {
  const n = Math.max(1, Math.round(steps)), k = Math.max(0, Math.min(n, Math.round(pulses)));
  if (k === 0) return Array(n).fill(0);
  if (k === n) return Array(n).fill(1);
  let a = Array.from({ length: k }, () => [1]), bb = Array.from({ length: n - k }, () => [0]);
  while (bb.length > 1) {
    const m = Math.min(a.length, bb.length);
    const na = [];
    for (let i = 0; i < m; i++) na.push(a[i].concat(bb[i]));
    const rest = a.length > m ? a.slice(m) : bb.slice(m);
    a = na; bb = rest;
  }
  return a.concat(bb).flat();
}
export function euclidPat(pat, pulses, steps, rotate = 0) {
  const ring = bjorklund(pulses, steps);
  const r = ((Math.round(rotate) % ring.length) + ring.length) % ring.length;
  const rot = ring.slice(r).concat(ring.slice(0, r));
  return fastcat(rot.map(on => on ? pat : silence));
}

/** A deterministic 0..1 from a time and a seed -- the same bargain as the
 *  random square LFO: the same answer every time it is asked. */
export function rand(t, seed = 0) {
  let x = (Math.round(t * 1e6) ^ Math.imul(seed | 0, 0x9e3779b1)) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  return x / 4294967296;
}

/** A pattern whose shape changes cycle by cycle with a number read off
 *  another pattern (`a*<2 4>`): the number at each cycle's start decides it. */
function patterned(numPat, make) {
  return new Pattern((b, e) => perCycle(b, e, (c, lo, hi) => {
    const h = numPat.query(c, c + 1)[0];
    const n = Number(h?.value);
    return Number.isFinite(n) ? make(n).query(lo, hi) : [];
  }));
}

// ---- the parser --------------------------------------------------------------

export class MiniError extends Error {
  constructor(msg, pos) { super(msg); this.name = "MiniError"; this.pos = pos; }
}

const PUNCT = new Set(["[", "]", "<", ">", "{", "}", "(", ")", ",", "|", "*", "/", "!", "@", "?", "%", "~"]);

function tokenize(src) {
  const toks = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (PUNCT.has(ch)) { toks.push({ t: ch, s: i, e: i + 1 }); i++; continue; }
    let j = i;
    while (j < src.length && !/\s/.test(src[j]) && !PUNCT.has(src[j])) j++;
    toks.push({ t: "w", v: src.slice(i, j), s: i, e: j });
    i = j;
  }
  return toks;
}

/**
 * Parse a mini-notation string into a Pattern of atom strings. `offset` is
 * added to every source location, so a string lifted out of a longer program
 * reports where its atoms sit in the program (the code panel lights them up).
 * Atom values are the raw words ("bd", "bd:3", "c3", "0", "C^7").
 */
export function mini(src, offset = 0) {
  const toks = tokenize(String(src));
  let p = 0;
  let seedN = 0;
  const peek = () => toks[p];
  const next = () => toks[p++];
  const expect = (t) => {
    const k = next();
    if (!k || k.t !== t) throw new MiniError(`expected ${t}${k ? ` but found ${k.t === "w" ? k.v : k.t}` : " before the end"}`, k ? k.s + offset : src.length + offset);
    return k;
  };
  const isNum = (v) => /^-?\d+(\.\d+)?$/.test(v);

  // A layer: steps up to , | or a closer. Returns a list of {pat, weight}.
  function parseLayer(closers) {
    const steps = [];
    const groups = [];
    while (p < toks.length) {
      const k = peek();
      if (closers.includes(k.t) || k.t === "," || k.t === "|") break;
      if (k.t === "w" && k.v === ".") { next(); groups.push(steps.splice(0)); continue; }
      if (k.t === "w" && k.v === "_") {
        next();
        if (!steps.length) throw new MiniError("`_` needs a step before it", k.s + offset);
        steps[steps.length - 1].weight += 1;
        continue;
      }
      if (k.t === "!") {
        next();
        if (!steps.length) throw new MiniError("`!` needs a step before it", k.s + offset);
        const nk = peek();
        if (nk && nk.t === "w" && isNum(nk.v) && nk.s === k.e) {
          next();
          const last = steps[steps.length - 1];
          for (let i = 1; i < Number(nk.v); i++) steps.push({ ...last });
        } else steps.push({ ...steps[steps.length - 1] });
        continue;
      }
      if (k.t === "w" && k.v === ".." ) {
        next();
        const prev = steps[steps.length - 1];
        const to = next();
        if (!prev || prev.num == null || !to || to.t !== "w" || !isNum(to.v)) throw new MiniError("`..` needs a number either side", k.s + offset);
        const a = prev.num, bnum = Number(to.v), dir = bnum >= a ? 1 : -1;
        for (let v = a + dir; dir > 0 ? v <= bnum : v >= bnum; v += dir) {
          steps.push({ pat: pure(String(v), [to.s + offset, to.e + offset]), weight: 1, num: v });
        }
        continue;
      }
      steps.push(parseStep());
    }
    if (groups.length) {
      groups.push(steps.splice(0));
      return groups.filter(g => g.length).map(g => ({ pat: timecat(g), weight: 1 }));
    }
    return steps;
  }

  function parseStep() {
    let { pat, num } = parseTerm();
    let weight = 1;
    for (;;) {
      const k = peek();
      if (!k) break;
      if (k.t === "*" || k.t === "/") {
        next();
        const f = parseFactor();
        const inv = k.t === "/";
        pat = typeof f === "number" ? fast(pat, inv ? 1 / f : f)
          : ((base) => patterned(f, n => fast(base, inv ? 1 / n : n)))(pat);
        num = null;
      } else if (k.t === "@") {
        next();
        const w = next();
        if (!w || w.t !== "w" || !isNum(w.v)) throw new MiniError("`@` needs a number", k.s + offset);
        weight = Number(w.v);
      } else if (k.t === "?") {
        next();
        let amt = 0.5;
        const w = peek();
        if (w && w.t === "w" && isNum(w.v) && w.s === k.e) { next(); amt = Number(w.v); }
        pat = degradeBy(pat, amt, ++seedN);
        num = null;
      } else if (k.t === "(") {
        next();
        const args = [];
        for (;;) {
          const w = next();
          if (!w || w.t !== "w" || !isNum(w.v)) throw new MiniError("euclid `(k,n,r)` takes numbers", (w || k).s + offset);
          args.push(Number(w.v));
          const sep = next();
          if (sep?.t === ")") break;
          if (sep?.t !== ",") throw new MiniError("euclid `(k,n,r)`: expected , or )", (sep || k).s + offset);
        }
        if (args.length < 2) throw new MiniError("euclid needs at least (pulses,steps)", k.s + offset);
        pat = euclidPat(pat, args[0], args[1], args[2] || 0);
        num = null;
      } else break;
    }
    return { pat, weight, num };
  }

  // A number, or a bracketed pattern of numbers (`*<2 3>`).
  function parseFactor() {
    const k = peek();
    if (k && k.t === "w" && isNum(k.v)) { next(); return Number(k.v); }
    if (k && (k.t === "[" || k.t === "<")) return parseTerm().pat;
    throw new MiniError("`*` and `/` need a number", k ? k.s + offset : src.length + offset);
  }

  function parseTerm() {
    const k = next();
    if (!k) throw new MiniError("unexpected end", src.length + offset);
    if (k.t === "~" || (k.t === "w" && k.v === "-")) return { pat: silence, num: null };
    if (k.t === "w") {
      const loc = [k.s + offset, k.e + offset];
      return { pat: pure(k.v, loc), num: isNum(k.v) ? Number(k.v) : null };
    }
    if (k.t === "[") { const pat = parseStack("]", "seq"); expect("]"); return { pat, num: null }; }
    if (k.t === "<") { const pat = parseStack(">", "alt"); expect(">"); return { pat, num: null }; }
    if (k.t === "{") {
      const layers = parseLayers("}");
      expect("}");
      let steps = layers[0]?.length || 1;
      if (peek()?.t === "%") {
        next();
        const w = next();
        if (!w || w.t !== "w" || !isNum(w.v)) throw new MiniError("`%` needs a number", k.s + offset);
        steps = Number(w.v);
      }
      return { pat: polymeter(layers, steps), num: null };
    }
    throw new MiniError(`unexpected ${k.t}`, k.s + offset);
  }

  function parseLayers(closer) {
    const layers = [parseLayer([closer])];
    while (peek() && (peek().t === "," || peek().t === "|")) {
      if (peek().t === "|") throw new MiniError("`|` cannot be mixed with `,` here", peek().s + offset);
      next();
      layers.push(parseLayer([closer]));
    }
    return layers;
  }

  // [a b, c d] / <a b, c d> / a | b
  function parseStack(closer, kind) {
    const layers = [parseLayer([closer])];
    let choice = false;
    while (peek() && (peek().t === "," || peek().t === "|")) {
      if (next().t === "|") choice = true;
      layers.push(parseLayer([closer]));
    }
    const build = (steps) => {
      if (kind === "alt") {
        const flat = [];
        for (const s of steps) for (let i = 0; i < Math.max(1, Math.round(s.weight)); i++) flat.push(s.pat);
        return slowcat(flat);
      }
      return timecat(steps);
    };
    const pats = layers.map(build);
    if (choice) return randcat(pats, ++seedN);
    return pats.length === 1 ? pats[0] : stack(pats);
  }

  const pat = parseStack(null, "seq");
  if (p < toks.length) throw new MiniError(`unexpected ${toks[p].t === "w" ? toks[p].v : toks[p].t}`, toks[p].s + offset);
  return pat;
}

/** {a b c, d e}%k -- each layer stepped k to a cycle, wrapping round. */
function polymeter(layers, k) {
  const steps = Math.max(1, Math.round(k));
  const ls = layers.filter(l => l.length);
  return new Pattern((b, e) => perCycle(b, e, (c, lo, hi) => stack(ls.map(layer => {
    const m = layer.length;
    const items = Array.from({ length: steps }, (_, j) => layer[(((c * steps + j) % m) + m) % m]).map(s => ({ pat: s.pat, weight: 1 }));
    return timecat(items);
  })).query(lo, hi)));
}

// ---- signals ---------------------------------------------------------------------
// A continuous pattern (sine, saw ...) has no onsets. Here it is a plain object
// the caller can sample at a time, turn into an LFO, or `segment` into steps.

const SHAPES = {
  sine: (t) => 0.5 + 0.5 * Math.sin(2 * Math.PI * t),
  cosine: (t) => 0.5 + 0.5 * Math.cos(2 * Math.PI * t),
  saw: (t) => t - Math.floor(t),
  isaw: (t) => 1 - (t - Math.floor(t)),
  tri: (t) => { const x = t - Math.floor(t); return x < 0.5 ? 2 * x : 2 - 2 * x; },
  square: (t) => (t - Math.floor(t)) < 0.5 ? 0 : 1,
  rand: (t) => rand(Math.floor(t * 16) / 16, 101),
  perlin: (t) => {
    const i = Math.floor(t), f = t - i, s = f * f * (3 - 2 * f);
    return rand(i, 202) * (1 - s) + rand(i + 1, 202) * s;
  },
};
SHAPES.triangle = SHAPES.tri;
SHAPES.sawtooth = SHAPES.saw;
export const SIGNAL_NAMES = Object.keys(SHAPES);

/** @typedef {{kind: "signal", shape: string, lo: number, hi: number, speed: number}} Signal */
/** @returns {Signal} */
export function signal(shape) { return { kind: "signal", shape, lo: 0, hi: 1, speed: 1 }; }
export function sampleSignal(sig, t) { return sig.lo + (sig.hi - sig.lo) * SHAPES[sig.shape](t * sig.speed); }
/** n steps a cycle, each holding the signal's value where it starts. */
export function segment(sig, n) {
  const k = Math.max(1, Math.round(n));
  return fast(new Pattern((b, e) => {
    const out = [];
    for (let c = Math.ceil(b - EPS); c < e - EPS; c++) out.push({ begin: c, end: c + 1, value: sampleSignal(sig, c / k), locs: [] });
    return out;
  }), k);
}
