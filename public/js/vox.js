// ---- vox: a singing voice ---------------------------------------------------
// Source-filter synthesis, which is how a voice actually works: the vocal
// folds make a train of pulses, and the throat and mouth are a set of
// resonances (formants) that the pulses ring. Change the pulses and you change
// the pitch and the effort; change the resonances and you change the vowel.
//
//   GLOTTIS x copies ─┐                    ┌─ F1 ─┐
//   (pulse, vibrato,  ├─ tilt ─┬─ voicing ─┼─ F2 ─┤
//    drift, growl)    │        │           ├─ F3 ─┼─ + ─▶ L/R
//   BREATH (noise, ───┘        │  ASPIRATION  F4 ─┤   ▲
//    pulsed by the folds) ─────┘           └─ F5 ─┘   │
//   CONSONANT (hiss, burst, murmur, formant glide) ───┘
//
// - **The source is a glottal pulse, not an oscillator.** A Rosenberg pulse:
//   the folds open smoothly, close faster, and stay shut for the rest of the
//   period. What reaches the formants is its derivative (the mouth radiates
//   the rate of change of the airflow), so every period has one sharp event,
//   the closure, and that edge is where the voice's brightness comes from.
//   BRIGHTNESS shortens the open phase and quickens the closure: a pressed,
//   brassy voice at the top, a soft, lax one at the bottom. Velocity pushes it
//   too, since singing louder is singing harder. The closure is a step in the
//   derivative, so it is band-limited with a polyBLEP.
// - **Five formants in parallel**, each a state-variable bandpass at unity
//   peak gain, alternating in sign as Klatt's parallel synthesizer does (in
//   phase, neighbouring skirts cancel into a notch between them). Their
//   frequencies, levels and bandwidths come from the classic singer tables
//   (engineData.js: VOX_FORMANTS), interpolated across the five vowels
//   (VOWEL) and four voice types, soprano to bass (SIZE). FOCUS narrows or
//   widens every bandwidth together.
// - **A singer tunes the first formant to the pitch.** A soprano's high A is
//   above the first formant of most vowels, and a resonance under the
//   fundamental rings nothing: the note would thin to nothing exactly where it
//   should soar. So F1 never sits below 1.1x the fundamental, which is what
//   trained voices do (it is why sung vowels go vague up there).
// - **Consonants are short scripts, run before the vowel** (VOX_CONSONANTS):
//   frication (s, sh, f, z, v) is noise through its own bandpass; a plosive
//   (p, t, k, b, d, g) is a burst and then a delay before the voicing starts,
//   filled with breath for the unvoiced ones; a nasal or a liquid (m, n, l, w,
//   y, r) is a murmur on its own formants. All of them start the formants
//   somewhere else (the locus) and glide them to the vowel, which is most of
//   what makes a consonant intelligible.
// - **The vowel lands on the step, the consonant before it.** A note message
//   arrives ahead of its time (the transport's lookahead), so the onset is
//   moved back by as much of the consonant as there is time for. A singer
//   does the same: the s of "sun" is before the beat, the u on it.
// - **Words** play one syllable a note from a phrase (VOX_WORDS), a chord on
//   one step sharing it, starting over when the transport stops.
// - **Breath** is noise through the same formants, pulsed by the folds (air
//   flows when they are open), so a breathy voice is still a vowel. At the
//   top of the knob the voicing goes and it whispers.
// - **Vibrato starts late**, after a delay, and fades in, as a singer's does;
//   DRIFT is a slow random wander in pitch and level per voice, plus the
//   scoop up into each note from just under it. GROWL alternates every other
//   period's length and level, which is a subharmonic an octave down: the
//   rasp of a pushed or a chanting voice.
// - **The choir is copies of the source per note**, up to eight, detuned
//   around the note and spread across the stereo field, each with its own
//   vibrato rate and drift, all through the note's formants (one bank per
//   side). Copies of one throat, not eight singers; it is still a choir.
// - **Mono** is a lead singer: one voice, last note wins, and a note arriving
//   while another sounds slides into it (the track's glide, or a short slur
//   when that is zero) with the envelope carrying on.
//
// One list, three namespaces, as in drone.js: every panel control is `sng` +
// a short key, and that short key spells its LFO target (`vox_<short>`) and
// its automation lane (`vox.<short>`). `sng`, not `vox` or `vx`: the
// contagion's prefix is `v`, and a prefix that is another engine's plus a
// letter is a collision waiting for its next control.

import {
  VOX_NUM_CTLS, VOX_MOD_KEYS, VOX_FORMANTS, VOX_VOWELS, VOX_CONSONANT_NAMES,
  VOX_CONS_FIELDS, voxConsonantRow, VOX_WORDS, voxSyllables,
} from "./engineData.js";

// The tables, flattened into the processor's prelude so the worklet and the
// panel read one copy.
function tablePrelude() {
  const F = [], DB = [], BW = [];
  for (const type of VOX_FORMANTS) {
    for (const v of VOX_VOWELS) {
      const [f, db, bw] = type.v[v];
      F.push(...f); DB.push(...db); BW.push(...bw);
    }
  }
  const cons = VOX_CONSONANT_NAMES.flatMap(n => voxConsonantRow(n));
  return `
const NTYPE = ${VOX_FORMANTS.length};
const NVOW = ${VOX_VOWELS.length};
const FORM_F = ${JSON.stringify(F)};
const FORM_DB = ${JSON.stringify(DB)};
const FORM_BW = ${JSON.stringify(BW)};
const CF = ${VOX_CONS_FIELDS};
const NCONS = ${VOX_CONSONANT_NAMES.length};
const CONS = ${JSON.stringify(cons)};
const CTLS = ${JSON.stringify(VOX_NUM_CTLS.map(([k, lo, hi, def]) => [k, lo, hi, def]))};
`;
}

const VOX_PROCESSOR_BODY = `
const BLK = 16;           // control-block size, at the host rate
const NV = 8;             // notes at once
const NU = 8;             // choir copies per note
const NF = 5;             // formants
const OUT_GAIN = 1.6;     // a single default note at about -16dBFS rms

// The formant table at (vowel, size), bilinear, as voxFormantsAt in
// engineData.js. out: f[5], db[5], bw[5].
function formantsAt(vowel, size, f, db, bw) {
  const vp = Math.max(0, Math.min(1, vowel)) * (NVOW - 1);
  const sp = Math.max(0, Math.min(1, size)) * (NTYPE - 1);
  const v0 = Math.min(NVOW - 2, Math.floor(vp)), vf = vp - v0;
  const s0 = Math.min(NTYPE - 2, Math.floor(sp)), sf = sp - s0;
  const i00 = (s0 * NVOW + v0) * NF, i01 = i00 + NF;
  const i10 = ((s0 + 1) * NVOW + v0) * NF, i11 = i10 + NF;
  const w00 = (1 - vf) * (1 - sf), w01 = vf * (1 - sf), w10 = (1 - vf) * sf, w11 = vf * sf;
  for (let i = 0; i < NF; i++) {
    f[i]  = FORM_F[i00 + i] * w00 + FORM_F[i01 + i] * w01 + FORM_F[i10 + i] * w10 + FORM_F[i11 + i] * w11;
    db[i] = FORM_DB[i00 + i] * w00 + FORM_DB[i01 + i] * w01 + FORM_DB[i10 + i] * w10 + FORM_DB[i11 + i] * w11;
    bw[i] = FORM_BW[i00 + i] * w00 + FORM_BW[i01 + i] * w01 + FORM_BW[i10 + i] * w10 + FORM_BW[i11 + i] * w11;
  }
}

// ---- the event queue ------------------------------------------------------
// The same allocation-free queue as drone.js / subbass.js: parallel typed
// arrays, kept in order by inserting from the back, one scratch event reused
// by every shift(). Two more fields: the consonant and the vowel a note sings.
const QCAP = 1024;
class EventQueue {
  constructor() {
    this.at    = new Float64Array(QCAP);
    this.id    = new Float64Array(QCAP);
    this.freq  = new Float64Array(QCAP);
    this.vel   = new Float64Array(QCAP);
    this.glide = new Float64Array(QCAP);
    this.cons  = new Float64Array(QCAP);
    this.vowel = new Float64Array(QCAP);
    this.off   = new Uint8Array(QCAP);
    this.head = 0;
    this.len = 0;
    this.ev = { at: 0, off: false, id: 0, freq: 0, vel: 0, glide: 0, cons: 0, vowel: -1 };
  }
  _move(d, s) {
    this.at[d] = this.at[s]; this.id[d] = this.id[s]; this.freq[d] = this.freq[s];
    this.vel[d] = this.vel[s]; this.glide[d] = this.glide[s]; this.cons[d] = this.cons[s];
    this.vowel[d] = this.vowel[s]; this.off[d] = this.off[s];
  }
  _compact() {
    const h = this.head, e = h + this.len;
    if (h === 0) return;
    this.at.copyWithin(0, h, e); this.id.copyWithin(0, h, e); this.freq.copyWithin(0, h, e);
    this.vel.copyWithin(0, h, e); this.glide.copyWithin(0, h, e); this.cons.copyWithin(0, h, e);
    this.vowel.copyWithin(0, h, e); this.off.copyWithin(0, h, e);
    this.head = 0;
  }
  push(at, off, id, freq, vel, glide, cons, vowel) {
    if (this.len >= QCAP) this.dropOldest();
    if (this.head + this.len >= QCAP) this._compact();
    let j = this.head + this.len - 1;
    while (j >= this.head && this.at[j] > at) { this._move(j + 1, j); j--; }
    const i = j + 1;
    this.at[i] = at; this.off[i] = off ? 1 : 0; this.id[i] = id; this.freq[i] = freq;
    this.vel[i] = vel; this.glide[i] = glide; this.cons[i] = cons; this.vowel[i] = vowel;
    this.len++;
  }
  headAt() { return this.at[this.head]; }
  shift() {
    const i = this.head, e = this.ev;
    e.at = this.at[i]; e.off = this.off[i] === 1; e.id = this.id[i]; e.freq = this.freq[i];
    e.vel = this.vel[i]; e.glide = this.glide[i]; e.cons = this.cons[i]; e.vowel = this.vowel[i];
    this.head++; this.len--;
    if (this.len === 0) this.head = 0;
    return e;
  }
  keepOffsBefore(limit) {
    const h = this.head, end = h + this.len;
    let w = h;
    for (let r = h; r < end; r++) {
      if (this.off[r] === 1 && this.at[r] < limit) { if (w !== r) this._move(w, r); w++; }
    }
    this.len = w - h;
    if (this.len === 0) this.head = 0;
  }
  dropOldest() {
    if (this.len === 0) return;
    this.head++; this.len--;
    if (this.len === 0) this.head = 0;
  }
}

// How far ahead of the vowel a consonant starts, in ms: the voicing delay, or
// most of a murmur.
function consLead(c) {
  const r = c * CF;
  const mur = CONS[r + 15];
  return mur > 0 ? mur * 0.7 : CONS[r + 8];
}

class VoxProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    const a = (name, defaultValue, minValue = 0, maxValue = 1) => ({ name, defaultValue, minValue, maxValue, automationRate: "a-rate" });
    return [
      // The four track sliders. Defaults match the track's own (0.5 x3, 0.4).
      a("vowel", 0.5), a("size", 0.5), a("breath", 0.5), a("rel", 0.4),
      ...CTLS.map(([k, lo, hi, def]) => a(k, def, lo, hi)),
    ];
  }

  constructor() {
    super();
    const sr = this.sr = sampleRate;
    this.alive = true;
    this.queue = new EventQueue();
    this.cons = 0;            // the consonant select, when words are off
    this.syl = [];            // [cons, vowel, cons, vowel, ...] from words
    this.sylIdx = -1;
    this.lastMsgWhen = -1;
    this.mono = 0;
    this.glideSec = 0;

    // ---- voices ----
    this.vOn   = new Uint8Array(NV);
    this.vEnv  = new Float64Array(NV);
    this.vPeak = new Float64Array(NV);
    this.vAtk  = new Uint8Array(NV);
    this.vAtkC = new Float64Array(NV);
    this.vFreq = new Float64Array(NV);
    this.vTgt  = new Float64Array(NV);
    this.vGlA  = new Float64Array(NV);
    this.vId   = new Float64Array(NV);
    this.vAge  = new Float64Array(NV);
    this.vVel  = new Float64Array(NV);
    this.vT    = new Float64Array(NV);     // samples since the syllable began
    this.vVib  = new Float64Array(NV);     // samples since the vibrato clock began
    this.vCons = new Int32Array(NV);
    this.vVow  = new Float64Array(NV);     // -1: follow the vowel slider
    this.vSnap = new Uint8Array(NV);       // formants jump, not glide, next block
    // smoothed formant targets and the coefficients built from them
    this.vF   = new Float64Array(NV * NF);
    this.vDb  = new Float64Array(NV * NF);
    this.vBw  = new Float64Array(NV * NF);
    this.cA1  = new Float64Array(NV * NF);
    this.cA2  = new Float64Array(NV * NF);
    this.cA3  = new Float64Array(NV * NF);
    this.cG   = new Float64Array(NV * NF);  // output gain: k (unity peak) x level x sign
    // filter states, [voice][formant][side]
    this.s1 = new Float64Array(NV * NF * 2);
    this.s2 = new Float64Array(NV * NF * 2);
    // the consonant's own noise bandpass
    this.n1 = new Float64Array(NV); this.n2 = new Float64Array(NV);
    // the source's tilt lowpass, per side
    this.tl = new Float64Array(NV * 2);
    // per-block results of the consonant script
    this.kVg = new Float64Array(NV); this.kAsp = new Float64Array(NV); this.kNz = new Float64Array(NV);
    this.kNa1 = new Float64Array(NV); this.kNa2 = new Float64Array(NV); this.kNa3 = new Float64Array(NV);
    this.kNk = new Float64Array(NV);

    // ---- choir copies, [voice][copy] ----
    this.uPh   = new Float64Array(NV * NU);
    this.uFlip = new Uint8Array(NV * NU);
    this.uDr   = new Float64Array(NV * NU);   // drift, -1..1
    this.uDrT  = new Float64Array(NV * NU);
    this.uAm   = new Float64Array(NV * NU);   // level drift
    this.uVr   = new Float64Array(NV * NU);   // vibrato rate trim
    this.uVph  = new Float64Array(NV * NU);   // vibrato phase
    this.uOff  = new Float64Array(NV * NU);   // fixed detune scatter, cents
    this.uDp   = new Float64Array(NV * NU);   // phase increment this block
    this.uGL   = new Float64Array(NV * NU);
    this.uGR   = new Float64Array(NV * NU);
    for (let i = 0; i < NV * NU; i++) {
      this.uVr[i] = 1 + (Math.random() - 0.5) * 0.12;
      this.uOff[i] = (Math.random() - 0.5) * 6;
      this.uVph[i] = Math.random();
    }
    this.age = 0;
    this.lastOnAt = -1;

    this.f = new Float64Array(NF); this.db = new Float64Array(NF); this.bw = new Float64Array(NF);

    this.port.onmessage = (e) => this.onMessage(e.data);
  }

  onMessage(m) {
    if (!m) return;
    if (m.type === "note") {
      if (this.queue.len > 128) this.queue.dropOldest();
      const at = Math.max(0, Math.round(m.when * this.sr));
      // What this note sings: the next syllable of the words (a chord on one
      // instant shares one), else the consonant select and the vowel slider.
      let cons = this.cons, vowel = -1;
      if (this.syl.length) {
        if (at !== this.lastMsgWhen) this.sylIdx = (this.sylIdx + 1) % (this.syl.length / 2);
        cons = this.syl[this.sylIdx * 2]; vowel = this.syl[this.sylIdx * 2 + 1];
      }
      this.lastMsgWhen = at;
      // The consonant goes before the step, as far as there is time for.
      const now = typeof currentFrame === "number" ? currentFrame : 0;
      const lead = Math.max(0, Math.min(Math.round(consLead(cons) * this.sr / 1000), at - now));
      this.queue.push(at - lead, false, m.id, m.freq, m.vel, m.glide, cons, vowel);
      this.queue.push(at + Math.max(1, Math.round(m.dur * this.sr)), true, m.id, 0, 0, 0, 0, 0);
    } else if (m.type === "off") {
      const at = Math.max(0, Math.round(m.when * this.sr));
      this.queue.keepOffsBefore(at);
      this.allOff = at;
      // A stop starts the words over.
      this.sylIdx = -1; this.lastMsgWhen = -1;
    } else if (m.type === "set") {
      if (m.cons !== undefined) this.cons = Math.max(0, Math.min(NCONS - 1, m.cons | 0));
      if (m.syl !== undefined) { this.syl = Array.isArray(m.syl) ? m.syl.slice(0, 256) : []; this.sylIdx = -1; this.lastMsgWhen = -1; }
      if (m.mono !== undefined) {
        const mono = m.mono ? 1 : 0;
        if (mono !== this.mono) this.allNotesOff();
        this.mono = mono;
      }
      if (m.glide !== undefined) this.glideSec = Math.max(0, m.glide);
    } else if (m.type === "dispose") {
      this.alive = false;
    }
  }

  // A free voice, else the quietest releasing one, else the oldest held.
  pickVoice() {
    let best = 0, bestScore = Infinity;
    for (let v = 0; v < NV; v++) {
      const score = !this.vOn[v] && this.vEnv[v] === 0 ? -1 : (this.vOn[v] ? 10 + this.vAge[v] * 1e-9 : this.vEnv[v]);
      if (score < bestScore) { bestScore = score; best = v; }
    }
    if (bestScore >= 10) {
      let old = Infinity;
      for (let v = 0; v < NV; v++) if (this.vAge[v] < old) { old = this.vAge[v]; best = v; }
    }
    return best;
  }

  noteOn(ev, atk) {
    let v, legato = false;
    if (this.mono) {
      v = 0;
      legato = this.vOn[0] === 1 && this.vEnv[0] > 1e-3;
    } else {
      v = this.pickVoice();
    }
    const fresh = !legato && this.vEnv[v] < 1e-4;
    const gl = ev.glide > 0 ? ev.glide : this.glideSec;
    this.vTgt[v] = ev.freq;
    if (legato) {
      // A slur: the track's glide, or a short one when it is zero.
      const t = gl > 0 ? gl : 0.04;
      this.vGlA[v] = 1 - Math.exp(-3 / Math.max(1, t * this.sr / BLK));
    } else {
      this.vFreq[v] = ev.freq; this.vGlA[v] = 1;
      this.vVib[v] = 0;
    }
    if (fresh) {
      // A voice that had finished starts from rest; a stolen one keeps its
      // filter state (zeroing a ringing filter is a click).
      const b = v * NF * 2;
      for (let i = 0; i < NF * 2; i++) { this.s1[b + i] = 0; this.s2[b + i] = 0; }
      this.n1[v] = 0; this.n2[v] = 0; this.tl[v * 2] = 0; this.tl[v * 2 + 1] = 0;
      this.vSnap[v] = 1;
      for (let u = 0; u < NU; u++) {
        const j = v * NU + u;
        this.uPh[j] = u === 0 ? 0.9 : Math.random();
        this.uFlip[j] = 0;
        this.uDr[j] = (Math.random() - 0.5) * 0.6; this.uDrT[j] = this.uDr[j];
        this.uAm[j] = 0;
      }
    }
    const atkT = 0.005 + atk * atk * 2;
    this.vAtkC[v] = 1 - Math.exp(-1 / (atkT * this.sr / 3));
    this.vPeak[v] = 0.35 + ev.vel * 0.65;
    this.vAtk[v] = this.vEnv[v] < this.vPeak[v] ? 1 : 0;
    this.vVel[v] = ev.vel;
    this.vOn[v] = 1;
    this.vId[v] = ev.id;
    this.vAge[v] = ++this.age;
    this.vT[v] = 0;
    this.vCons[v] = ev.cons | 0;
    this.vVow[v] = ev.vowel;
  }

  noteOff(id) {
    for (let v = 0; v < NV; v++) if (this.vOn[v] && this.vId[v] === id) this.vOn[v] = 0;
  }

  allNotesOff() {
    for (let v = 0; v < NV; v++) this.vOn[v] = 0;
  }

  // The consonant script at this voice's time, into kVg (voicing), kAsp
  // (breath through the formants), kNz (the consonant's own noise), the noise
  // filter (kNa*, kNk), and returns the locus weight; the locus and the murmur
  // damping are written into the formant targets by the caller.
  consonant(v, bite) {
    const c = this.vCons[v];
    const ms = this.vT[v] * 1000 / this.sr;
    if (c <= 0) { this.kVg[v] = 1; this.kAsp[v] = 0; this.kNz[v] = 0; return 0; }
    const r = c * CF;
    const fricMs = CONS[r], burMs = CONS[r + 4];
    const vot = CONS[r + 8], pre = CONS[r + 9], asp = CONS[r + 10];
    const trans = CONS[r + 14], murMs = CONS[r + 15], murL = CONS[r + 16];
    // voicing
    let vg;
    if (murMs > 0) vg = ms < murMs ? murL : Math.min(1, murL + (ms - murMs) / 15 * (1 - murL));
    else vg = ms < vot ? pre : Math.min(1, pre + (ms - vot) / 12 * (1 - pre));
    this.kVg[v] = vg;
    // breath until the voicing, faded out over 8ms
    this.kAsp[v] = asp > 0 ? asp * bite * Math.max(0, Math.min(1, (vot + 8 - ms) / 8)) : 0;
    // the consonant's own noise: a burst, or frication
    let nz = 0, hz = 1000, q = 1;
    if (burMs > 0 && ms < burMs) {
      nz = CONS[r + 7] * (1 - ms / burMs); hz = CONS[r + 5]; q = CONS[r + 6];
    } else if (fricMs > 0 && ms < fricMs) {
      nz = CONS[r + 3] * Math.min(1, ms / 15) * Math.min(1, (fricMs - ms) / 20);
      hz = CONS[r + 1]; q = CONS[r + 2];
    }
    this.kNz[v] = nz * bite * (0.4 + 0.6 * this.vVel[v]);
    if (nz > 0) {
      const g = Math.tan(Math.PI * Math.min(hz, this.sr * 0.45) / this.sr), k = 1 / q;
      const a1 = 1 / (1 + g * (g + k));
      this.kNa1[v] = a1; this.kNa2[v] = g * a1; this.kNa3[v] = g * g * a1; this.kNk[v] = k;
    }
    // where the formants start, and how far along the glide away from it
    if (CONS[r + 11] <= 0) return 0;
    const t0 = murMs > 0 ? murMs : vot;
    return ms < t0 ? 1 : Math.max(0, 1 - (ms - t0) / Math.max(1, trans));
  }

  process(inputs, outputs, params) {
    if (!this.alive) return false;
    const out = outputs[0];
    if (!out || !out.length) return true;
    const oL = out[0], oR = out[1] || out[0];
    const n128 = oL.length;
    const sr = this.sr;
    const P = params;
    const startFrame = currentFrame;
    const f = this.f, db = this.db, bw = this.bw;

    for (let base = 0; base < n128; base += BLK) {
      const blk = Math.min(BLK, n128 - base);
      const i = base;
      const at = startFrame + base;

      if (this.allOff !== undefined && at >= this.allOff) { this.allNotesOff(); this.allOff = undefined; }
      while (this.queue.len && this.queue.headAt() <= at) {
        const ev = this.queue.shift();
        if (ev.off) this.noteOff(ev.id);
        else this.noteOn(ev, this.pv(P, "atk", i));
      }

      let anyVoice = false;
      for (let v = 0; v < NV; v++) if (this.vOn[v] || this.vEnv[v] > 0) { anyVoice = true; break; }
      if (!anyVoice) {
        for (let s = 0; s < blk; s++) { oL[base + s] = 0; if (oR !== oL) oR[base + s] = 0; }
        continue;
      }

      for (let s = 0; s < blk; s++) { oL[base + s] = 0; if (oR !== oL) oR[base + s] = 0; }

      // ---- control rate ----
      const vowelP = this.pv(P, "vowel", i), size = this.pv(P, "size", i);
      const breath = this.pv(P, "breath", i);
      const relT = 0.02 + Math.pow(this.pv(P, "rel", i), 2) * 3;
      const relC = Math.exp(-1 / (relT * sr / 3));
      const bright = this.pv(P, "bright", i), focus = this.pv(P, "focus", i);
      const vib = this.pv(P, "vib", i), vHz = 3.5 + this.pv(P, "vrate", i) * 4.5;
      const vDel = this.pv(P, "vdelay", i) * 1.5 * sr;
      const drift = this.pv(P, "drift", i), growl = this.pv(P, "growl", i);
      const nU = Math.max(1, Math.min(NU, Math.round(this.pv(P, "voices", i))));
      const detune = this.pv(P, "detune", i), spread = this.pv(P, "spread", i);
      const bite = this.pv(P, "bite", i);
      const stereo = nU > 1 && spread > 0.01;
      const bwMul = Math.pow(2, (0.5 - focus) * 2);
      const whisper = breath > 0.75 ? Math.min(1, (breath - 0.75) / 0.25) : 0;
      // the air in a voiced note, and more of it as the voicing goes
      const aspAmt = breath * breath * 0.55 + whisper * 0.8;
      const voiceAmt = 1 - whisper * whisper * (3 - 2 * whisper);   // smoothstep down to a whisper
      const uNorm = 1 / Math.sqrt(nU);
      const smooth = 1 - Math.exp(-blk / (0.03 * sr));
      const drC = 1 - Math.exp(-blk / (0.15 * sr));

      for (let v = 0; v < NV; v++) {
        if (!this.vOn[v] && this.vEnv[v] === 0) continue;
        // pitch glide
        if (this.vGlA[v] < 1) {
          this.vFreq[v] += (this.vTgt[v] - this.vFreq[v]) * this.vGlA[v];
          if (Math.abs(this.vTgt[v] - this.vFreq[v]) < 0.001) { this.vFreq[v] = this.vTgt[v]; this.vGlA[v] = 1; }
        }
        const f0 = this.vFreq[v];
        const lw = this.consonant(v, bite);

        // ---- formants: the vowel, smoothed, then the consonant's locus ----
        formantsAt(this.vVow[v] >= 0 ? this.vVow[v] : vowelP, size, f, db, bw);
        const sm = this.vSnap[v] ? 1 : smooth;
        this.vSnap[v] = 0;
        const c = this.vCons[v], r = c * CF;
        const murMs = c > 0 ? CONS[r + 15] : 0;
        const damp = murMs > 0 ? 1 - (1 - CONS[r + 17]) * lw : 1;
        // One closure a period, so a low note has fewer of them a second: about
        // 3dB an octave quieter, which this takes back out.
        const pitchG = Math.max(0.5, Math.min(2.5, Math.sqrt(262 / f0)));
        for (let k = 0; k < NF; k++) {
          const j = v * NF + k;
          this.vF[j] += (f[k] - this.vF[j]) * sm;
          this.vDb[j] += (db[k] - this.vDb[j]) * sm;
          this.vBw[j] += (bw[k] - this.vBw[j]) * sm;
          let fk = this.vF[j];
          if (k < 3 && lw > 0) fk = fk * (1 - lw) + CONS[r + 11 + k] * lw;
          // F1 follows the pitch up rather than sitting under it.
          if (k === 0 && fk < f0 * 1.1) fk = f0 * 1.1;
          if (fk > sr * 0.45) fk = sr * 0.45;
          const bwk = Math.max(20, this.vBw[j] * bwMul * (k === 0 && murMs > 0 && lw > 0 ? 1 + lw : 1));
          const g = Math.tan(Math.PI * fk / sr), kq = bwk / fk;
          const a1 = 1 / (1 + g * (g + kq));
          this.cA1[j] = a1; this.cA2[j] = g * a1; this.cA3[j] = g * g * a1;
          // Level from the table, tilted back up by the source's own -6dB/oct
          // (against a fixed 500Hz, so an open a with its F1 at 800Hz is not
          // quieter than a closed i) so the table's dB are what comes out;
          // alternating sign (Klatt).
          const lvl = Math.pow(10, this.vDb[j] / 20) * (fk / 500) * (k > 0 ? damp : 1) * pitchG;
          this.cG[j] = kq * lvl * (k & 1 ? -1 : 1);
        }

        // ---- the copies' pitch for this block ----
        const vibIn = this.vVib[v] < vDel ? 0 : Math.min(1, (this.vVib[v] - vDel) / (0.4 * sr));
        const vibC = vib * 80 * vibIn;
        // the scoop: a note starts just under itself and rises into it
        const scoop = -drift * 60 * Math.exp(-this.vVib[v] / (0.05 * sr));
        for (let u = 0; u < nU; u++) {
          const j = v * NU + u;
          if (Math.random() < blk / (0.25 * sr)) this.uDrT[j] = Math.random() * 2 - 1;
          this.uDr[j] += (this.uDrT[j] - this.uDr[j]) * drC;
          this.uVph[j] += vHz * this.uVr[j] * blk / sr;
          if (this.uVph[j] >= 1) this.uVph[j] -= 1;
          const pos = nU > 1 ? u / (nU - 1) * 2 - 1 : 0;
          const cents = (nU > 1 ? detune * 25 * pos + this.uOff[j] * detune : 0)
            + vibC * Math.sin(2 * Math.PI * this.uVph[j]) + drift * 25 * this.uDr[j] + scoop;
          this.uDp[j] = f0 * Math.pow(2, cents / 1200) / sr;
          this.uAm[j] = 1 + drift * 0.15 * this.uDr[j];
          const pan = stereo ? 0.5 + spread * 0.5 * pos : 0.5;
          this.uGL[j] = Math.cos(pan * Math.PI * 0.5) * Math.SQRT2 * uNorm;
          this.uGR[j] = Math.sin(pan * Math.PI * 0.5) * Math.SQRT2 * uNorm;
        }
        this.vVib[v] += blk;
        this.vT[v] += blk;

        // effort: brighter with velocity, as singing louder is singing harder
        const eff = Math.max(0, Math.min(1, bright + (this.vVel[v] - 0.75) * 0.3));
        const Oq = 0.8 - 0.4 * eff, Tp = Oq * 0.6, Tn = Oq - Tp;
        const piTp = Math.PI / Tp, hpTn = 0.5 * Math.PI / Tn, nrm = Tn / (0.5 * Math.PI);
        const tiltA = 1 - Math.exp(-2 * Math.PI * Math.min(sr * 0.45, 800 * Math.pow(2, eff * 5)) / sr);
        const vg = this.kVg[v] * voiceAmt, asp = this.kAsp[v], nz = this.kNz[v];
        const na1 = this.kNa1[v], na2 = this.kNa2[v], na3 = this.kNa3[v], nk = this.kNk[v];

        for (let s = 0; s < blk; s++) {
          // envelope
          if (this.vOn[v]) {
            if (this.vAtk[v]) {
              this.vEnv[v] += this.vAtkC[v] * (this.vPeak[v] * 1.02 - this.vEnv[v]);
              if (this.vEnv[v] >= this.vPeak[v]) { this.vEnv[v] = this.vPeak[v]; this.vAtk[v] = 0; }
            } else this.vEnv[v] += (this.vPeak[v] - this.vEnv[v]) * 0.001;
          } else {
            this.vEnv[v] *= relC;
            if (this.vEnv[v] < 1e-5) this.vEnv[v] = 0;
          }
          const env = this.vEnv[v];

          // ---- the glottis, per copy ----
          let xL = 0, xR = 0, flow0 = 0;
          if (vg > 0 && env > 0) {
            for (let u = 0; u < nU; u++) {
              const j = v * NU + u;
              let ph = this.uPh[j];
              const flip = this.uFlip[j];
              const dp = this.uDp[j] * (growl > 0 ? (flip ? 1 + growl * 0.08 : 1 - growl * 0.08) : 1);
              ph += dp;
              if (ph >= 1) { ph -= 1; this.uFlip[j] = flip ^ 1; }
              let d;
              if (ph < Tp) d = 0.5 * piTp * Math.sin(piTp * ph) * nrm;
              else if (ph < Oq) d = -hpTn * Math.sin(hpTn * (ph - Tp)) * nrm;
              else d = 0;
              // polyBLEP over the closure, a step of +1 at ph = Oq
              const dd = (ph - Oq) / dp;
              if (dd >= 0 && dd < 1) d += 0.5 * (2 * dd - dd * dd - 1);
              else if (dd > -1 && dd < 0) d += 0.5 * (dd * dd + 2 * dd + 1);
              this.uPh[j] = ph;
              const amp = this.uAm[j] * (growl > 0 && flip ? 1 - growl * 0.75 : 1);
              xL += d * amp * this.uGL[j];
              xR += d * amp * this.uGR[j];
              if (u === 0) flow0 = ph < Tp ? 0.5 - 0.5 * Math.cos(piTp * ph) : ph < Oq ? Math.cos(hpTn * (ph - Tp)) : 0;
            }
          } else {
            // the folds still move under a voiceless consonant, for the breath
            const j = v * NU;
            let ph = this.uPh[j] + this.uDp[j];
            if (ph >= 1) ph -= 1;
            this.uPh[j] = ph;
            flow0 = ph < Tp ? 0.5 - 0.5 * Math.cos(piTp * ph) : ph < Oq ? Math.cos(hpTn * (ph - Tp)) : 0;
          }
          // the tilt
          const tb = v * 2;
          this.tl[tb] += tiltA * (xL - this.tl[tb]);
          this.tl[tb + 1] += tiltA * (xR - this.tl[tb + 1]);
          // breath: noise pulsed by the folds, through the same formants
          const air = (Math.random() * 2 - 1) * (0.35 + 0.65 * flow0) * (aspAmt * env + asp);
          const inL = this.tl[tb] * vg * env + air;
          const inR = stereo ? this.tl[tb + 1] * vg * env + air : inL;

          // ---- the formants ----
          let yL = 0, yR = 0;
          for (let k = 0; k < NF; k++) {
            const j = v * NF + k, sj = j * 2;
            const a1 = this.cA1[j], a2 = this.cA2[j], a3 = this.cA3[j], gk = this.cG[j];
            let ic1 = this.s1[sj], ic2 = this.s2[sj];
            let v3 = inL - ic2;
            let v1 = a1 * ic1 + a2 * v3;
            let v2 = ic2 + a2 * ic1 + a3 * v3;
            this.s1[sj] = 2 * v1 - ic1; this.s2[sj] = 2 * v2 - ic2;
            yL += v1 * gk;
            if (stereo) {
              ic1 = this.s1[sj + 1]; ic2 = this.s2[sj + 1];
              v3 = inR - ic2;
              v1 = a1 * ic1 + a2 * v3;
              v2 = ic2 + a2 * ic1 + a3 * v3;
              this.s1[sj + 1] = 2 * v1 - ic1; this.s2[sj + 1] = 2 * v2 - ic2;
              yR += v1 * gk;
            }
          }
          if (!stereo) yR = yL;

          // ---- the consonant's own noise ----
          if (nz > 0) {
            const x = Math.random() * 2 - 1;
            const v3 = x - this.n2[v];
            const v1 = na1 * this.n1[v] + na2 * v3;
            const v2 = this.n2[v] + na2 * this.n1[v] + na3 * v3;
            this.n1[v] = 2 * v1 - this.n1[v]; this.n2[v] = 2 * v2 - this.n2[v];
            const h = v1 * nk * nz;
            yL += h; yR += h;
          }

          const idx = base + s;
          oL[idx] += yL;
          if (oR !== oL) oR[idx] += yR;
        }
      }
      for (let s = 0; s < blk; s++) {
        const idx = base + s;
        let l = oL[idx] * OUT_GAIN, r = oR[idx] * OUT_GAIN;
        // A soft ceiling at full scale for a full choir on a chord; nearly
        // linear at ordinary levels.
        l = l / Math.sqrt(1 + l * l);
        oL[idx] = l;
        if (oR !== oL) { r = r / Math.sqrt(1 + r * r); oR[idx] = r; }
      }
    }
    return true;
  }

  pv(P, name, i) { const p = P[name]; return p.length > 1 ? p[i] : p[0]; }
}

registerProcessor("vox", VoxProcessor);
`;

const VOX_PROCESSOR_SOURCE = tablePrelude() + VOX_PROCESSOR_BODY;

/** The processor source, for test/vox.test.js. */
export function voxProcessorSource() { return VOX_PROCESSOR_SOURCE; }

const _loads = new WeakMap();
const _ready = new WeakSet();

/**
 * Register the vox processor on this context. Called at init() so the await
 * on the play path has already resolved by the time a voice is built.
 * @param {BaseAudioContext} ctx @returns {Promise<void>}
 */
export function loadVoxWorklet(ctx) {
  if (!ctx?.audioWorklet) return Promise.reject(new Error("no AudioWorklet"));
  let p = _loads.get(ctx);
  if (!p) {
    const url = URL.createObjectURL(new Blob([VOX_PROCESSOR_SOURCE], { type: "text/javascript" }));
    p = ctx.audioWorklet.addModule(url)
      .then(() => { URL.revokeObjectURL(url); _ready.add(ctx); })
      .catch((e) => { URL.revokeObjectURL(url); _loads.delete(ctx); throw e; });
    _loads.set(ctx, p);
  }
  return p;
}

/** Has the processor finished registering on this context? */
export function voxReady(ctx) { return !!ctx && _ready.has(ctx); }

// ---- the panel ----------------------------------------------------------
// Keys are `sng` + short key -> `vox_<short>` / `vox.<short>`. The list, the
// ranges, the defaults and the voices are data in engineData.js; re-exported.
export {
  VOX_NUM_CTLS, VOX_SEL_CTLS, VOX_MOD_KEYS, VOX_NUM_KEYS, VOX_SEL_KEYS,
  VOX_MOD_RANGE, VOX_MOD_LABELS, VOX_DEFAULTS, voxFromUnit,
  VOX_VOWELS, VOX_CONSONANT_NAMES, VOX_WORD_NAMES, VOX_WORDS, voxSyllables,
  VOX_TONE_NAMES, voxToneDescription, voxTone,
} from "./engineData.js";

/** A words select value as the flat [cons, vowel, ...] list the processor takes. */
export function voxSyllableList(name) {
  return voxSyllables(VOX_WORDS[name] ?? "").flatMap(s => [s.cons, s.vowel]);
}

// Tone wrappers don't accept a native connect() — unwrap to the node underneath.
const nativeIn = (node) => node?.input?.input ?? node?.input ?? node;

/**
 * Build the vox voice. Returns null when the worklet isn't registered yet, so
 * the caller can fall back rather than leave the track silent.
 * @param {*} output Tone node the voice writes into.
 */
export function buildVoxVoice(output) {
  const ctx = Tone.getContext().rawContext;
  if (!voxReady(ctx)) { loadVoxWorklet(ctx).catch(() => {}); return null; }

  let node;
  try {
    node = new AudioWorkletNode(ctx, "vox",
      { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
  } catch (e) {
    console.warn("vox worklet node failed", e);
    return null;
  }
  node.connect(nativeIn(output));

  const PARAM_OF = { harm: "vowel", timb: "size", morph: "breath", decay: "rel" };
  for (const k of VOX_MOD_KEYS) PARAM_OF[`sng${k}`] = k;

  const P = {};
  for (const name of Object.values(PARAM_OF)) P[name] = node.parameters.get(name);
  const post = (m) => { try { node.port.postMessage(m); } catch {} };

  let noteId = 0;
  let glide = 0;
  const paramFor = (key) => P[PARAM_OF[key]] ?? null;

  return {
    nodes: [{ dispose() { try { node.port.postMessage({ type: "dispose" }); } catch {} try { node.disconnect(); } catch {} } }],
    setGlide: (g) => { glide = Math.max(0, Number(g) || 0); post({ type: "set", glide }); },
    setParam: (key, val) => {
      if (key === "sngcons")  { post({ type: "set", cons: Math.max(0, VOX_CONSONANT_NAMES.indexOf(String(val))) }); return; }
      if (key === "sngwords") { post({ type: "set", syl: voxSyllableList(String(val)) }); return; }
      if (key === "sngmode")  { post({ type: "set", mono: val === "mono" }); return; }
      const p = paramFor(key);
      if (!p) return;
      const v = Number(val);
      if (!Number.isFinite(v)) return;
      p.value = Math.max(p.minValue, Math.min(p.maxValue, v));
    },
    getAudioParam: (key) => paramFor(key),
    trigger: (note, time, dur, vel) => {
      const when = Math.max(Number(time) || 0, ctx.currentTime);
      post({
        type: "note", when, id: ++noteId, note,
        freq: 440 * Math.pow(2, (note - 69) / 12),
        dur: Math.max(0.01, Number(dur) || 0.1),
        vel: Math.max(0.05, Math.min(1, vel ?? 1)),
        glide,
      });
    },
    release: (time) => post({ type: "off", when: Math.max(Number(time) || 0, ctx.currentTime) }),
  };
}
