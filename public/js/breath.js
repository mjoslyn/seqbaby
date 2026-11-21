// ---- breath: the wind instruments ---------------------------------------------
// Saxes, clarinets, oboes, trumpets, trombones, horns, tubas, flutes: one
// voice for everything a player blows into. A wind instrument is three
// things, and the model is those three:
//
//   BREATH ──▶ EXCITER ──▶ BODY ──▶ SECTION ──▶ L/R
//   pressure    reed        two        1..4
//   (attack,    lips        formants,  players
//   tongue,     jet         a mute
//   swell)        │
//                 └─ AIR (the breath you hear, through the tube)
//
// - **The tone is additive: up to 48 harmonics of the note, each with a level
//   that is recomputed every 16 samples from the blowing pressure.** A wind
//   instrument's tube locks its partials to exact multiples of the note (that
//   is what makes it play one), so nothing is lost by generating them that
//   way, and three things are gained: the pitch is the note to the cent with
//   no loop to tune, nothing can alias (a harmonic past 0.47 of the sample
//   rate is not generated), and the spectrum is a formula the tests can read
//   back. Every harmonic is the same phase rotor through a Chebyshev
//   recurrence (sin(n x) from sin((n-1) x) and sin((n-2) x)), one multiply
//   and one subtract each.
// - **Brightness follows the breath.** The spectrum has a break frequency
//   (the `tone` slider) above which the harmonics fall away, and the break
//   moves with the pressure by as many octaves as `dyn` says: a soft note is
//   nearly a sine and a hard one is brilliant, and since the pressure rises
//   through the attack and falls through the release, every note opens and
//   closes. That is most of what makes a horn a horn. Lips move it furthest
//   (the "brassy" blare), a jet least.
// - **Three exciters** (`kind`), differing in the rolloff above the break, in
//   how far the pressure moves it, in the breath noise and in the attack:
//   `reed` (single and double reeds), `lips` (brass), and `jet` (flutes),
//   which is close to a sine when blown softly, shifts its weight onto the
//   second harmonic when overblown, and starts with a chiff.
// - **The bore is the odd / even balance** (`bore`): a cylinder closed at one
//   end has no even harmonics below about 1.8kHz (a clarinet, a pan pipe), a
//   cone has them all (a sax, an oboe, every brass).
// - **The body is two fixed formants** (`f1`, `f2`, `res`): the mouthpiece,
//   the bell and the tone holes put peaks in the spectrum that do not move
//   with the note, and where they sit is which instrument it is (a trumpet
//   near 1.2kHz, a trombone 500Hz, a tuba 230Hz, an alto sax 650Hz and
//   1.5kHz, an oboe 1.1kHz and 2.7kHz). They are a gain curve the harmonics
//   are read off, not filters, so vibrato moves each harmonic across them
//   and its level follows. `mute` is a brass mute: the lows go, a nasal peak
//   comes in near 1.9kHz, and the level drops.
// - **The air** is noise through resonances: the body's for a reed or lips
//   (pulsed by the valve opening and closing), the tube's own modes at the
//   note and its octave for a jet. It follows the pressure less steeply than
//   the tone does, so a soft note is breathier than a loud one (a subtone).
// - **The breath** is the envelope: `atk`, a `tongue` that overshoots the
//   pressure and adds a burst of air (a "ta" against a "ha"), a `swell` that
//   lets a held note fall away or grow, and the release (the track's decay
//   slider). Velocity is the blowing pressure, so it is loudness AND
//   brightness. `growl` roughens the tone at around 80Hz, `flutter` is the
//   flutter tongue, 24 times a second.
// - **The pitch is played, not set**: a `scoop` up into the note, a `fall`
//   off the end of it (the pitch drops as the note is let go), vibrato after
//   a delay (pitch for reeds and lips, mostly breath for a flute), `drift`.
// - **A section** (`players` 1..4): each player has their own tuning, vibrato
//   rate, drift, entry (up to 22ms late) and place in the stereo field.
// - **A slur keeps the breath going.** A note tied into the next (the
//   silverbox's rule: written longer than a step, the next landing as it
//   ends) is taken over by the voice that played the last one, with no
//   attack, the pitch sliding there (the track's glide, else 35ms). `mode`
//   mono is a solo instrument: one voice, the last note wins.
// - **What keeps it from being an organ stop.** A sum of harmonics on a smooth
//   curve, in phase, dead steady, is a filtered sawtooth however the curve is
//   drawn. So: each harmonic has a fixed phase of its own (a second, cosine
//   recurrence beside the sine one); each harmonic of each note sits up to
//   3dB off the curve, the same way every time (a hash of harmonic and note);
//   each wavers slowly by itself; the breath's turbulence shakes the tone's
//   level (noise under 200Hz on the gain, so every harmonic has a skirt of
//   air round it, scaled with the air slider); the brightness trails the
//   pressure by 25..40ms, so the top of the tone is the last thing to arrive;
//   a note starts a few cents off and settles, wavers a couple of cents while
//   held, and its vibrato is never quite the same depth or speed twice.
//   All but the phases, the 3dB and the lag are scaled by `drift` or `air`.
// - **Reasoned, not measured.** The formant positions are the published
//   ones for each family; the rest (rolloff orders, how far the break moves,
//   the noise levels) are honest character with no instrument under test.
//
// The processor source is a string registered from a Blob URL, like every
// other worklet here. Keep backticks and dollar-brace out of it.

const BREATH_PROCESSOR_SOURCE = `
const NV = 6;          // notes at once
const NP = 4;          // players a note
const NH = 48;         // harmonics
const BLK = 16;
const QCAP = 1024;
const TBL = 256;       // the body's gain curve, 40Hz up over nine octaves
const TBL_LO = Math.log2(40);
const TBL_K = (TBL - 1) / 9;
const TAU = 6.283185307179586;

// A hash of two integers, 0..1: the same harmonic of the same note always
// gets the same answer, with no state.
function hash2(a, b) {
  let x = (Math.imul(a, 374761393) + Math.imul(b, 668265263)) | 0;
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}
// Each harmonic's fixed phase, up to a quarter turn either way. Summed in
// sine phase a spectrum is a sawtooth, whatever its levels: the buzz of a
// synth. No instrument's partials line up like that.
const PHC = new Float64Array(NH + 1), PHS = new Float64Array(NH + 1);
PHC[1] = 1;
for (let n = 2; n <= NH; n++) { const ph = (hash2(n, 7919) - 0.5) * Math.PI; PHC[n] = Math.cos(ph); PHS[n] = Math.sin(ph); }
// How far a harmonic may sit off the smooth curve, in dB either way.
const IRR_DB = 3;
const LNN = new Float64Array(NH + 1);
const LOG2N = new Float64Array(NH + 1);
for (let n = 1; n <= NH; n++) { LNN[n] = Math.log(n); LOG2N[n] = Math.log2(n); }

// Per kind: reed, lips, jet.
const ORDER   = [3, 2, 4];          // rolloff above the break, in 6dB/oct steps
const DYN_OCT = [2.5, 5, 2];        // octaves the break moves across the pressure, at dyn 1
const VIB_CENTS = [60, 50, 25];     // vibrato in pitch, at the top of the knob
const VIB_PRESS = [0.2, 0.15, 0.5]; // and in breath
const SCOOP_ST = [2.5, 1.5, 1];     // how far under the note a full scoop starts
const AIR_K   = [1, 0.5, 1.8];      // breath noise against the tone
const ATK_K   = [1, 1, 1.5];        // a jet speaks a little later
const CHIFF_T = [0.010, 0.008, 0.030];
const LAG_T   = [0.025, 0.035, 0.040];  // how far the brightness trails the breath
const TURB_K  = [1, 0.6, 1.2];          // how much the air roughens the tone
// Each player's fixed place in the section: tuning, vibrato rate, pan.
const P_TUNE = [0, 1, -0.8, 0.45];
const P_RATE = [1, 1.05, 0.96, 1.08];

function tanhA(x) {
  if (x > 3) return 1;
  if (x < -3) return -1;
  const x2 = x * x;
  return x * (27 + x2) / (27 + 9 * x2);
}
// The output ceiling: a wire to 0.75, a smooth bend to 1.
function knee(x) {
  const a = x < 0 ? -x : x;
  if (a <= 0.75) return x;
  const y = 0.75 + 0.25 * tanhA((a - 0.75) * 4);
  return x < 0 ? -y : y;
}

// ---- the event queue ------------------------------------------------------
// The guitar's allocation-free queue: parallel typed arrays, kept in order by
// inserting from the back, one scratch event reused by every shift(). off: 1
// a note-off, 0 a note-on, 2 a note-on slurred from the note before.
class EventQueue {
  constructor() {
    this.at    = new Float64Array(QCAP);
    this.id    = new Float64Array(QCAP);
    this.note  = new Float64Array(QCAP);
    this.freq  = new Float64Array(QCAP);
    this.vel   = new Float64Array(QCAP);
    this.glide = new Float64Array(QCAP);
    this.off   = new Uint8Array(QCAP);
    this.head = 0;
    this.len = 0;
    this.ev = { at: 0, off: false, leg: false, id: 0, note: 0, freq: 0, vel: 0, glide: 0 };
  }
  _move(d, s) {
    this.at[d] = this.at[s]; this.id[d] = this.id[s]; this.note[d] = this.note[s];
    this.freq[d] = this.freq[s]; this.vel[d] = this.vel[s]; this.glide[d] = this.glide[s];
    this.off[d] = this.off[s];
  }
  _compact() {
    const h = this.head, e = h + this.len;
    if (h === 0) return;
    this.at.copyWithin(0, h, e); this.id.copyWithin(0, h, e);
    this.note.copyWithin(0, h, e); this.freq.copyWithin(0, h, e);
    this.vel.copyWithin(0, h, e); this.glide.copyWithin(0, h, e);
    this.off.copyWithin(0, h, e);
    this.head = 0;
  }
  push(at, off, id, note, freq, vel, glide) {
    if (this.len >= QCAP) this.dropOldest();
    if (this.head + this.len >= QCAP) this._compact();
    let j = this.head + this.len - 1;
    while (j >= this.head && this.at[j] > at) { this._move(j + 1, j); j--; }
    const i = j + 1;
    this.at[i] = at; this.off[i] = off === true ? 1 : (off | 0); this.id[i] = id;
    this.note[i] = note; this.freq[i] = freq; this.vel[i] = vel; this.glide[i] = glide;
    this.len++;
  }
  headAt() { return this.at[this.head]; }
  shift() {
    const i = this.head, e = this.ev;
    e.at = this.at[i]; e.off = this.off[i] === 1; e.leg = this.off[i] === 2; e.id = this.id[i];
    e.note = this.note[i]; e.freq = this.freq[i]; e.vel = this.vel[i]; e.glide = this.glide[i];
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

class Voice {
  constructor() {
    this.stage = 0;                       // 0 idle 1 attack 2 held 3 release
    this.held = false; this.id = 0; this.vel = 1;
    this.age = 0;                         // samples since the breath began
    this.relAge = 0;                      // samples since it was let go
    this.claimed = -1;                    // the frame a slur last took this voice
    this.e = 0; this.sw = 0; this.peak = 1;
    this.logF = Math.log2(261.63); this.logT = this.logF; this.glideC = 1;
    this.scoop = 0; this.blip = 0; this.fall = 0;
    this.vibAmt = 0; this.chiff = 0;
    this.gain = 0; this.nGain = 0;
    this.growlPh = 0; this.flutPh = 0; this.growlW = 0;
    this.pj = 0; this.pjT = 0;            // the breath is never quite steady
    this.pb = 0;                          // the pressure the brightness has caught up with
    this.jit = 0; this.onErr = 0;         // the pitch: a fast waver, and where the note started
    this.tz = 0;                          // the turbulence riding on the tone
    this.H = 0;
    this.a = new Float64Array(NH + 1);    // the harmonics' levels, ramped
    this.da = new Float64Array(NH + 1);
    // the players
    this.c = new Float64Array(NP); this.s = new Float64Array(NP);
    this.vibPh = new Float64Array(NP);
    this.cal = new Float64Array(NP);
    this.drift = new Float64Array(NP); this.driftT = new Float64Array(NP);
    this.delay = new Float64Array(NP);    // entry, in samples after the first
    this.pg = new Float64Array(NP);       // each player's own fade in
    for (let i = 0; i < NP; i++) this.c[i] = 1;
    // the air: three band-passes
    this.n1 = new Float64Array(3); this.n2 = new Float64Array(3);
  }
  active() { return this.stage !== 0; }
}

class BreathProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    const k = (name, defaultValue, minValue = 0, maxValue = 1) =>
      ({ name, defaultValue, minValue, maxValue, automationRate: "k-rate" });
    return [
      // The four track sliders: tone / air / vibrato / release.
      k("tone", 0.5), k("air", 0.5), k("vib", 0.5), k("rel", 0.4),
      // The body.
      k("bore", 1), k("edge", 0.5), k("f1", 0.52), k("f2", 0.44), k("res", 0.5), k("mute", 0),
      // The breath.
      k("atk", 0.4), k("tongue", 0.4), k("dyn", 0.5), k("swell", 0.5), k("growl", 0), k("flutter", 0),
      // The pitch.
      k("vrate", 0.45), k("vdelay", 0.35), k("scoop", 0.2), k("fall", 0), k("drift", 0.3),
      // The section.
      k("players", 1, 1, NP), k("detune", 0.3), k("spread", 0.5),
    ];
  }

  constructor() {
    super();
    this.sr = sampleRate;
    this.alive = true;
    this.queue = new EventQueue();
    this.voices = [];
    for (let i = 0; i < NV; i++) this.voices.push(new Voice());
    this.kind = 0;
    this.mono = 0;
    this.glideSec = 0;
    this.allOff = undefined;
    this.body = new Float64Array(TBL);
    this.bf1 = -1; this.bf2 = -1; this.bres = -1; this.bmute = -1;
    this.tg = new Float64Array(NH + 1);   // scratch: a block's target spectrum
    this.bL = new Float64Array(BLK); this.bR = new Float64Array(BLK);
    this.tmp = new Float64Array(BLK);
    this.tb = new Float64Array(BLK);
    this.port.onmessage = (e) => this.onMessage(e.data);
  }

  onMessage(m) {
    if (!m) return;
    if (m.type === "note") {
      if (this.queue.len > 256) this.queue.dropOldest();
      const at = Math.max(0, Math.round(m.when * this.sr));
      this.queue.push(at, m.legato ? 2 : 0, m.id, m.note, m.freq, m.vel, m.glide);
      this.queue.push(at + Math.max(1, Math.round(m.dur * this.sr)), true, m.id, 0, 0, 0, 0);
    } else if (m.type === "off") {
      const at = Math.max(0, Math.round(m.when * this.sr));
      this.queue.keepOffsBefore(at);
      this.allOff = at;
    } else if (m.type === "set") {
      if (m.glide !== undefined) this.glideSec = Math.max(0, +m.glide || 0);
      if (m.kind !== undefined) this.kind = Math.max(0, Math.min(2, m.kind | 0));
      if (m.mono !== undefined) {
        const mono = m.mono ? 1 : 0;
        if (mono !== this.mono) this.releaseAll();
        this.mono = mono;
      }
    } else if (m.type === "dispose") {
      this.alive = false;
    }
  }

  // The body's gain against frequency: flat, plus the two formants, through
  // the mute. Rebuilt only when one of its four knobs has moved.
  buildBody(f1k, f2k, res, mute) {
    const F1 = 150 * Math.pow(2500 / 150, f1k);
    const F2 = 500 * Math.pow(12, f2k);
    const G = Math.pow(10, res * 18 / 20) - 1;
    const fm = 300 + 900 * mute;
    for (let i = 0; i < TBL; i++) {
      const f = Math.pow(2, TBL_LO + i / TBL_K);
      let d = 2.2 * (f / F1 - F1 / f);
      let g = 1 + G / Math.sqrt(1 + d * d);
      d = 3 * (f / F2 - F2 / f);
      g += 0.7 * G / Math.sqrt(1 + d * d);
      if (mute > 0) {
        const r = f / fm, r2 = r * r;
        const hp = r2 / Math.sqrt(1 + r2 * r2);
        d = 3 * (f / 1900 - 1900 / f);
        g *= (1 + mute * (hp - 1)) * (1 + 2.5 * mute / Math.sqrt(1 + d * d));
      }
      this.body[i] = g;
    }
    this.F1 = F1; this.F2 = F2;
    this.bf1 = f1k; this.bf2 = f2k; this.bres = res; this.bmute = mute;
  }

  // One block's spectrum for a note at f0 blown at pressure p, into this.tg,
  // normalised to unit power. Returns the highest harmonic worth running.
  spectrum(f0, p, tone, edge, bore, dyn, chiffBoost, noteKey, shim, secs) {
    const kind = this.kind, tg = this.tg;
    let fb = 250 * Math.pow(2, 5 * tone + DYN_OCT[kind] * dyn * (p - 0.8)) * Math.pow(f0 / 261.63, 0.35);
    if (fb < 120) fb = 120; else if (fb > 18000) fb = 18000;
    // Lips close fully every period, so their pulse is the narrower one and
    // its spectrum the flatter below the break.
    let alpha = 1.8 - 1.6 * edge - (kind === 1 ? 0.3 : 0);
    // A jet blown softly is close to a sine.
    if (kind === 2 && p < 1.1) alpha += 3.5 * (1.1 - p);
    const order = ORDER[kind];
    const top = 0.47 * this.sr;
    const log2f0 = Math.log2(f0);
    const body = this.body;
    const odd = 0.94 * (1 - bore);
    let sum = 0, max = 0, n = 1;
    for (; n <= NH; n++) {
      const fn = n * f0;
      if (fn > top) break;
      const x = fn / fb, x2 = x * x;
      const xo = order === 2 ? x2 * x2 : order === 3 ? x2 * x2 * x2 : x2 * x2 * x2 * x2;
      let a = Math.exp(-alpha * LNN[n]) / Math.sqrt(1 + xo);
      // A cylinder has no even harmonics below about 1.8kHz.
      if (odd > 0 && (n & 1) === 0) { const y = fn / 1800, y2 = y * y; a *= 1 - odd / (1 + y2 * y2); }
      let ti = (log2f0 + LOG2N[n] - TBL_LO) * TBL_K;
      if (ti < 0) ti = 0; else if (ti > TBL - 1.001) ti = TBL - 1.001;
      const i0 = ti | 0;
      a *= body[i0] + (body[i0 + 1] - body[i0]) * (ti - i0);
      if (n > 1) {
        // No instrument's spectrum is a smooth curve: each harmonic of each
        // note sits a few dB off it, the same way every time that note is
        // played. And none holds still: each wavers slowly on its own.
        a *= Math.exp((hash2(n, noteKey) - 0.5) * 2 * IRR_DB * 0.1151292546497023);
        if (shim > 0) a *= 1 + shim * (n < 10 ? 1 + n * 0.1 : 2) * Math.sin(TAU * (secs * (0.7 + (n * 0.37) % 3.1) + n * 0.61));
      }
      tg[n] = a;
    }
    const count = n - 1;
    if (kind === 2) {
      // Overblown, a flute's weight moves onto its second harmonic; and the
      // chiff is the upper modes speaking before the fundamental does.
      if (p > 0.95) { const o = Math.min(1, (p - 0.95) / 0.4); tg[1] *= 1 - 0.7 * o * o * (3 - 2 * o); }
      if (chiffBoost > 0 && count >= 3) { tg[2] *= 1 + 3 * chiffBoost; tg[3] *= 1 + 3 * chiffBoost; }
    }
    for (let i = 1; i <= count; i++) { sum += tg[i] * tg[i]; if (tg[i] > max) max = tg[i]; }
    for (let i = count + 1; i <= NH; i++) tg[i] = 0;
    if (sum <= 0) return 0;
    // Unit RMS for the sum of sines: the squares add to 2.
    const norm = Math.sqrt(2 / sum);
    const floor = max * 0.0006;
    let H = 0;
    for (let i = 1; i <= count; i++) {
      if (tg[i] < floor) tg[i] = 0; else H = i;
      tg[i] *= norm;
    }
    return H;
  }

  pickVoice() {
    for (let i = 0; i < NV; i++) if (!this.voices[i].active()) return i;
    let pick = 0, best = Infinity;
    for (let i = 0; i < NV; i++) {
      const v = this.voices[i];
      const score = (v.held ? 10 : 0) + v.e;
      if (score < best) { best = score; pick = i; }
    }
    return pick;
  }

  // The voice a slurred note carries on from: the one nearest in pitch that
  // is still held, or was let go within the last 50ms, and has not already
  // been taken by another note of this same instant (a tied chord).
  slurVoice(ev) {
    const lim = 0.05 * this.sr, lt = Math.log2(ev.freq);
    let pick = -1, best = Infinity;
    for (let i = 0; i < NV; i++) {
      const v = this.voices[i];
      if (!v.active() || v.claimed === ev.at) continue;
      if (!v.held && v.relAge > lim) continue;
      const d = Math.abs(v.logT - lt);
      if (d < best) { best = d; pick = i; }
    }
    return pick;
  }

  noteOn(ev, P) {
    const glide = ev.glide > 0 ? ev.glide : this.glideSec;
    let vi = -1, slur = false;
    if (this.mono) {
      vi = 0;
      const v0 = this.voices[0];
      slur = v0.active() && (v0.held || (ev.leg && v0.relAge <= 0.05 * this.sr));
    } else if (ev.leg) {
      vi = this.slurVoice(ev);
      slur = vi >= 0;
    }
    if (vi < 0) vi = this.pickVoice();
    const v = this.voices[vi];
    const was = v.active();
    v.logT = Math.log2(ev.freq);
    v.id = ev.id; v.held = true; v.vel = ev.vel; v.relAge = 0; v.claimed = ev.at;
    if (slur) {
      // The breath carries on: no attack, the pitch slides there.
      const t = glide > 0 ? glide : 0.035;
      v.glideC = 1 - Math.exp(-3 / Math.max(1, t * this.sr / BLK));
      v.fall = 0;
      if (v.stage === 3) v.stage = 2;
      return;
    }
    if (was && glide > 0) v.glideC = 1 - Math.exp(-3 / Math.max(1, glide * this.sr / BLK));
    else { v.logF = v.logT; v.glideC = 1; }
    const kind = this.kind;
    const scoop = P.scoop[0], tongue = P.tongue[0], drift = P.drift[0];
    v.age = 0; v.stage = 1; v.sw = 0; v.fall = 0; v.vibAmt = 0;
    v.peak = 1 + 0.35 * tongue;
    v.scoop = -scoop * scoop * SCOOP_ST[kind];
    v.blip = kind === 1 ? 0.35 * tongue : 0;
    v.chiff = tongue;
    for (let i = 0; i < NP; i++) {
      v.cal[i] = (Math.random() * 2 - 1) * drift;
      if (i === 0) v.onErr = (Math.random() * 2 - 1) * drift * 30;
      v.delay[i] = i === 0 ? 0 : Math.random() * 0.022 * this.sr;
      if (!was) {
        // A voice at rest starts each player somewhere of their own; one
        // still sounding keeps its phases (no step in the wave).
        const ph = Math.random() * TAU;
        v.c[i] = Math.cos(ph); v.s[i] = Math.sin(ph);
        v.vibPh[i] = Math.random();
        v.pg[i] = 0;
      }
    }
    if (!was) {
      v.e = 0; v.gain = 0; v.nGain = 0; v.H = 0; v.pb = 0; v.tz = 0;
      v.a.fill(0);
      v.n1.fill(0); v.n2.fill(0);
    }
  }

  noteOff(id) {
    for (const v of this.voices) if (v.held && v.id === id) { v.held = false; v.relAge = 0; }
  }

  releaseAll() {
    for (const v of this.voices) if (v.held) { v.held = false; v.relAge = 0; }
  }

  process(inputs, outputs, P) {
    if (!this.alive) return false;
    const out = outputs[0];
    if (!out || !out.length) return true;
    const oL = out[0], oR = out.length > 1 ? out[1] : null;
    const n128 = oL.length;
    const sr = this.sr;
    const startFrame = currentFrame;
    const kind = this.kind;

    const tone = P.tone[0], air = P.air[0], vib = P.vib[0], rel = P.rel[0];
    const bore = P.bore[0], edge = P.edge[0], res = P.res[0], mute = P.mute[0];
    const f1k = P.f1[0], f2k = P.f2[0];
    const atk = P.atk[0], tongue = P.tongue[0], dyn = P.dyn[0], swell = P.swell[0];
    const growl = P.growl[0], flutter = P.flutter[0];
    const vrate = P.vrate[0], vdelay = P.vdelay[0], fallK = P.fall[0], drift = P.drift[0];
    let np = Math.round(P.players[0]); if (np < 1) np = 1; else if (np > NP) np = NP;
    const detune = P.detune[0], spread = P.spread[0];
    if (f1k !== this.bf1 || f2k !== this.bf2 || res !== this.bres || mute !== this.bmute) this.buildBody(f1k, f2k, res, mute);

    // ---- what every voice shares this quantum ----
    const dtB = BLK / sr;
    const tA = 0.004 * Math.pow(100, atk) * ATK_K[kind];
    const attC = 1 - Math.exp(-dtB * 1.79 / tA);
    const tRel = 0.02 * Math.pow(75, rel) * (1 + 3 * fallK);
    const relC = Math.exp(-dtB * 6.9 / tRel);
    const fallC = 1 - Math.exp(-dtB / (tRel * 0.5));
    const setC = 1 - Math.exp(-dtB / 0.05);
    const swC = 1 - Math.exp(-dtB / 0.6);
    const sw = (swell - 0.5) * 2;
    const swT = sw > 0 ? 0.35 * sw : 0.65 * sw;
    const vibC = 1 - Math.exp(-dtB / 0.25);
    const vibHz = 3.5 + 4.5 * vrate;
    const vibOct = vib * vib * VIB_CENTS[kind] / 1200;
    const vibPr = vib * vib * VIB_PRESS[kind];
    const vibAfter = 1.2 * vdelay * sr;
    const scoopC = Math.exp(-dtB / (0.025 + 0.06 * P.scoop[0]));
    const blipC = Math.exp(-dtB / 0.012);
    const chiffC = Math.exp(-dtB / CHIFF_T[kind]);
    const onErrC = Math.exp(-dtB / 0.06);
    const lagC = 1 - Math.exp(-dtB / LAG_T[kind]);
    const turbC = 1 - Math.exp(-TAU * 200 / sr);
    const muteLvl = 1 - 0.45 * mute;
    const airLvl = air * air * 4 * AIR_K[kind] * 0.04;
    const plNorm = 1 / Math.sqrt(np);
    const pgStep = 1 / (0.004 * sr);
    // The air's three bands: the body's for a valve, the tube's modes for a jet.
    let nf0 = 0, nf1 = 0, nf2 = 0, nq0 = 1.2, nq1 = 0.8, nq2 = 0.7, nw0 = 1, nw1 = 0.6, nw2 = 0;
    if (kind !== 2) { nf0 = Math.max(500, this.F1 * 1.2); nf1 = 3000; }
    else { nq0 = 9; nq1 = 9; nw0 = 1.6; nw1 = 1; nw2 = 0.5; nf2 = 3500; }

    for (let base = 0; base < n128; base += BLK) {
      const blk = Math.min(BLK, n128 - base);
      const at = startFrame + base;
      if (this.allOff !== undefined && at >= this.allOff) { this.releaseAll(); this.allOff = undefined; }
      while (this.queue.len && this.queue.headAt() <= at) {
        const ev = this.queue.shift();
        if (ev.off) this.noteOff(ev.id); else this.noteOn(ev, P);
      }

      const bL = this.bL, bR = this.bR, tmp = this.tmp;
      for (let i = 0; i < blk; i++) { bL[i] = 0; bR[i] = 0; }
      let any = false;

      for (let vi = 0; vi < NV; vi++) {
        const v = this.voices[vi];
        if (v.stage === 0) continue;
        any = true;

        // ---- the breath ----
        if (!v.held && v.stage !== 3) v.stage = 3;
        if (v.stage === 1) {
          v.e += (1.2 * v.peak - v.e) * attC;
          if (v.e >= v.peak) { v.e = v.peak; v.stage = 2; }
        } else if (v.stage === 2) {
          v.sw += (swT - v.sw) * swC;
          v.e += (1 + v.sw - v.e) * setC;
        } else {
          v.e *= relC;
          v.relAge += blk;
          if (fallK > 0) v.fall += (-12 * fallK - v.fall) * fallC;
          if (v.e < 3e-4) { v.e = 0; v.stage = 0; v.held = false; v.gain = 0; v.nGain = 0; continue; }
        }
        v.age += blk;
        if (v.age > vibAfter && v.stage !== 3) v.vibAmt += (1 - v.vibAmt) * vibC;
        v.scoop *= scoopC; v.blip *= blipC; v.chiff *= chiffC;

        // ---- the pitch ----
        if (v.glideC < 1) {
          v.logF += (v.logT - v.logF) * v.glideC;
          if (Math.abs(v.logT - v.logF) < 1e-5) { v.logF = v.logT; v.glideC = 1; }
        }
        // A player never lands exactly on a note or sits exactly still on it:
        // the note starts a few cents off and settles, and wavers a couple of
        // cents, quickly, while it is held. Both are drift's.
        v.onErr *= onErrC;
        v.jit += (Math.random() * 2 - 1 - v.jit) * 0.02;
        const bend = (v.scoop + v.blip + v.fall) / 12 + (v.onErr + v.jit * drift * 120) / 1200;
        const b = 0.3 + 0.7 * v.vel;
        // A breath wavers: a few percent, slowly, by as much as drift says.
        v.pjT += (Math.random() * 2 - 1) * 0.08;
        if (v.pjT > 1) v.pjT = 1; else if (v.pjT < -1) v.pjT = -1;
        v.pj += (v.pjT - v.pj) * 0.01;
        // And so does a vibrato: its depth is never the same twice round.
        const wav = drift < 0.34 ? drift * 3 : 1;
        const vib0 = Math.sin(TAU * v.vibPh[0]) * v.vibAmt * (1 - 0.3 * wav * v.pj);
        let p = b * v.e * (1 + vibPr * vib0 + 0.12 * drift * v.pj);
        if (p < 0) p = 0;
        // The tone opens a little after the breath arrives: the upper
        // harmonics are the last to speak. It closes with it.
        if (p > v.pb) v.pb += (p - v.pb) * lagC; else v.pb = p;
        const f0 = Math.pow(2, v.logF + bend + vibOct * vib0);

        // ---- the spectrum, and a ramp to it ----
        const toneK = tone + 0.14 * growl;
        const Hn = this.spectrum(f0, v.pb, toneK < 1 ? toneK : 1, edge, bore, dyn, v.chiff * tongue,
          Math.round(v.logT * 12), 0.25 * drift, v.age / sr);
        const H = Hn > v.H ? Hn : v.H;
        const a = v.a, da = v.da, tg = this.tg;
        const inv = 1 / blk;
        for (let n = 1; n <= H; n++) da[n] = (tg[n] - a[n]) * inv;

        // ---- growl and flutter, on the level ----
        let am = 1;
        if (growl > 0) {
          v.growlW += (Math.random() * 2 - 1) * 0.1;
          if (v.growlW > 1) v.growlW = 1; else if (v.growlW < -1) v.growlW = -1;
          v.growlPh += (78 + 22 * v.growlW) * dtB; if (v.growlPh >= 1) v.growlPh -= 1;
          am *= 1 - growl * 0.75 * (0.5 + 0.5 * Math.sin(TAU * v.growlPh));
        }
        if (flutter > 0) {
          v.flutPh += 24 * dtB; if (v.flutPh >= 1) v.flutPh -= 1;
          am *= 1 - flutter * 0.8 * (0.5 - 0.5 * Math.cos(TAU * v.flutPh));
        }
        const gT = 0.17 * Math.pow(p, 1.25) * am * muteLvl * plNorm;
        const gStep = (gT - v.gain) * inv;
        // The air follows the pressure less steeply than the tone, so a soft
        // note is the breathier one; the chiff is a burst of it on the attack.
        const nT = 0.17 * (airLvl * Math.pow(p, 0.6) * (1 + 0.6 * growl) + v.chiff * (0.3 + air) * 0.025 * b * (kind === 2 ? 2 : 1)) * am * muteLvl;
        const nStep = (nT - v.nGain) * inv;

        // ---- the turbulence ----
        // The air does not only sit beside the note, it shakes it: the breath
        // is rough, so the tone's level is too, and every harmonic carries a
        // skirt of noise. Scaled with the air; none at zero.
        const tb = this.tb;
        const turb = air * air * TURB_K[kind] * 0.8 / Math.sqrt(p > 0.25 ? p : 0.25);   // a soft breath is the rougher
        if (turb > 0) {
          let tz = v.tz;
          for (let i = 0; i < blk; i++) { tz += (Math.random() * 2 - 1 - tz) * turbC; tb[i] = 1 + turb * tz; }
          v.tz = tz;
        }

        // ---- the players ----
        for (let i = 0; i < blk; i++) tmp[i] = 0;
        const two = H >= 1;
        for (let pl = 0; pl < np; pl++) {
          v.driftT[pl] += (Math.random() * 2 - 1) * 0.03;
          if (v.driftT[pl] > 1) v.driftT[pl] = 1; else if (v.driftT[pl] < -1) v.driftT[pl] = -1;
          v.drift[pl] += (v.driftT[pl] - v.drift[pl]) * 0.003;
          v.vibPh[pl] += vibHz * P_RATE[pl] * (1 + 0.1 * wav * v.pj) * dtB; if (v.vibPh[pl] >= 1) v.vibPh[pl] -= 1;
          const vb = pl === 0 ? vib0 : Math.sin(TAU * v.vibPh[pl]) * v.vibAmt;
          const cents = P_TUNE[pl] * detune * 20 + v.cal[pl] * 5 + v.drift[pl] * drift * 10;
          const f = Math.pow(2, v.logF + bend + vibOct * vb + cents / 1200);
          const w = TAU * f / sr;
          const cd = Math.cos(w), sd = Math.sin(w);
          let c = v.c[pl], s = v.s[pl];
          // The player's place: across the spread, the first in the middle
          // when alone.
          const pos = np === 1 ? 0 : (pl / (np - 1) - 0.5) * 2 * spread;
          const ang = (pos + 1) * 0.7853981633974483;
          const gl = Math.cos(ang) * 1.4142135623730951, gr = Math.sin(ang) * 1.4142135623730951;
          let pg = v.pg[pl];
          const entering = v.age >= v.delay[pl];
          let g = v.gain;
          for (let i = 0; i < blk; i++) {
            const c2 = c * cd - s * sd; s = s * cd + c * sd; c = c2;
            let acc = 0;
            if (two) {
              const k2 = c + c;
              let sp = 0, sc = s, cp = 1, cc = c;
              for (let n = 1; n <= H; n++) {
                acc += (a[n] + da[n] * i) * (PHC[n] * sc + PHS[n] * cc);
                let t = k2 * sc - sp; sp = sc; sc = t;
                t = k2 * cc - cp; cp = cc; cc = t;
              }
            }
            if (entering && pg < 1) { pg += pgStep; if (pg > 1) pg = 1; }
            g += gStep;
            const y = turb > 0 ? acc * g * pg * tb[i] : acc * g * pg;
            bL[i] += y * gl; bR[i] += y * gr;
            if (pl === 0) tmp[i] = c;
          }
          // The rotor drifts off the unit circle a little; put it back.
          const r = 1 / Math.sqrt(c * c + s * s);
          v.c[pl] = c * r; v.s[pl] = s * r; v.pg[pl] = pg;
        }
        for (let n = 1; n <= H; n++) a[n] = tg[n];
        v.H = Hn;
        v.gain = gT;

        // ---- the air ----
        if (nT > 1e-7 || v.nGain > 1e-7) {
          if (kind === 2) { nf0 = f0; nf1 = f0 * 2; }
          let g0 = Math.tan(Math.PI * Math.min(nf0, 0.45 * sr) / sr), k0 = 1 / nq0;
          const a10 = 1 / (1 + g0 * (g0 + k0)), a20 = g0 * a10, a30 = g0 * a20;
          let g1 = Math.tan(Math.PI * Math.min(nf1, 0.45 * sr) / sr), k1 = 1 / nq1;
          const a11 = 1 / (1 + g1 * (g1 + k1)), a21 = g1 * a11, a31 = g1 * a21;
          let g2 = Math.tan(Math.PI * Math.min(nf2 || 1000, 0.45 * sr) / sr), k2n = 1 / nq2;
          const a12 = 1 / (1 + g2 * (g2 + k2n)), a22 = g2 * a12, a32 = g2 * a22;
          const n1 = v.n1, n2 = v.n2;
          // Unity-peak band-passes pass less noise the narrower they are;
          // the square root of the Q puts the level back.
          const w0 = nw0 * k0 * Math.sqrt(nq0), w1 = nw1 * k1 * Math.sqrt(nq1), w2 = nw2 * k2n * Math.sqrt(nq2);
          const pulsed = kind !== 2;
          let ng = v.nGain;
          for (let i = 0; i < blk; i++) {
            const x = Math.random() * 2 - 1;
            let v3 = x - n2[0], v1 = a10 * n1[0] + a20 * v3, v2 = n2[0] + a20 * n1[0] + a30 * v3;
            n1[0] = 2 * v1 - n1[0]; n2[0] = 2 * v2 - n2[0];
            let y = v1 * w0;
            v3 = x - n2[1]; v1 = a11 * n1[1] + a21 * v3; v2 = n2[1] + a21 * n1[1] + a31 * v3;
            n1[1] = 2 * v1 - n1[1]; n2[1] = 2 * v2 - n2[1];
            y += v1 * w1;
            if (w2 > 0) {
              v3 = x - n2[2]; v1 = a12 * n1[2] + a22 * v3; v2 = n2[2] + a22 * n1[2] + a32 * v3;
              n1[2] = 2 * v1 - n1[2]; n2[2] = 2 * v2 - n2[2];
              y += v1 * w2;
            }
            ng += nStep;
            // A valve lets the air through in puffs, once a period.
            y *= pulsed ? ng * (0.45 + 0.55 * (0.5 + 0.5 * tmp[i])) : ng;
            bL[i] += y; bR[i] += y;
          }
        }
        v.nGain = nT;
      }

      if (!any) {
        for (let i = 0; i < blk; i++) { oL[base + i] = 0; if (oR) oR[base + i] = 0; }
        continue;
      }
      for (let i = 0; i < blk; i++) {
        oL[base + i] = knee(bL[i]);
        if (oR) oR[base + i] = knee(bR[i]);
      }
    }
    return true;
  }
}

registerProcessor("breath", BreathProcessor);
`;

/** The processor source, for test/breath.test.js, which evaluates it against
 *  the worklet globals a test stubs, as oracle.test.js does. */
export function breathProcessorSource() { return BREATH_PROCESSOR_SOURCE; }

const _loads = new WeakMap();
const _ready = new WeakSet();

/**
 * Register the breath processor on this context. Called at init() so the
 * await on the play path has already resolved by the time a voice is built.
 * @param {BaseAudioContext} ctx @returns {Promise<void>}
 */
export function loadBreathWorklet(ctx) {
  if (!ctx?.audioWorklet) return Promise.reject(new Error("no AudioWorklet"));
  let p = _loads.get(ctx);
  if (!p) {
    const url = URL.createObjectURL(new Blob([BREATH_PROCESSOR_SOURCE], { type: "text/javascript" }));
    p = ctx.audioWorklet.addModule(url)
      .then(() => { URL.revokeObjectURL(url); _ready.add(ctx); })
      .catch((e) => { URL.revokeObjectURL(url); _loads.delete(ctx); throw e; });
    _loads.set(ctx, p);
  }
  return p;
}

/** Has the processor finished registering on this context? */
export function breathReady(ctx) { return !!ctx && _ready.has(ctx); }

// ---- the panel ----------------------------------------------------------
// Keys are `brt` + short key -> `breath_<short>` / `breath.<short>`. The
// lists, the ranges, the defaults and the instruments are data in
// engineData.js; re-exported here.
import { BREATH_KINDS, BREATH_MOD_KEYS } from "./engineData.js";
export {
  BREATH_NUM_CTLS, BREATH_SEL_CTLS, BREATH_MOD_KEYS, BREATH_NUM_KEYS, BREATH_SEL_KEYS,
  BREATH_MOD_RANGE, BREATH_MOD_LABELS, BREATH_DEFAULTS, BREATH_KINDS, breathFromUnit,
  BREATH_TONE_NAMES, breathToneDescription, breathTone,
} from "./engineData.js";

// Tone wrappers don't accept a native connect() — unwrap to the node underneath.
const nativeIn = (node) => node?.input?.input ?? node?.input ?? node;

/**
 * Build the breath voice. Returns null when the worklet isn't registered yet,
 * so the caller can fall back rather than leave the track silent.
 * @param {*} output Tone node the voice writes into.
 */
export function buildBreathVoice(output) {
  const ctx = Tone.getContext().rawContext;
  if (!breathReady(ctx)) { loadBreathWorklet(ctx).catch(() => {}); return null; }

  let node;
  try {
    node = new AudioWorkletNode(ctx, "breath",
      { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
  } catch (e) {
    console.warn("breath worklet node failed", e);
    return null;
  }
  node.connect(nativeIn(output));

  const PARAM_OF = { harm: "tone", timb: "air", morph: "vib", decay: "rel" };
  for (const k of BREATH_MOD_KEYS) PARAM_OF[`brt${k}`] = k;

  const P = {};
  for (const name of Object.values(PARAM_OF)) P[name] = node.parameters.get(name);
  const post = (m) => { try { node.port.postMessage(m); } catch {} };

  let noteId = 0;
  let glide = 0;
  // A note tied into the next (written longer than a step, the next landing
  // where it ends) asks for that next note slurred: the silverbox's rule.
  // Every note of a chord gets the answer its first note got.
  let prevEnd = -1, prevTied = false, lastWhen = -1, lastLegato = false;
  const paramFor = (key) => P[PARAM_OF[key]] ?? null;

  return {
    nodes: [{ dispose() { try { node.port.postMessage({ type: "dispose" }); } catch {} try { node.disconnect(); } catch {} } }],
    setGlide: (g) => { glide = Math.max(0, Number(g) || 0); post({ type: "set", glide }); },
    setParam: (key, val) => {
      if (key === "brtkind") { post({ type: "set", kind: Math.max(0, BREATH_KINDS.indexOf(String(val))) }); return; }
      if (key === "brtmode") { post({ type: "set", mono: val === "mono" }); return; }
      const p = paramFor(key);
      if (!p) return;
      const v = Number(val);
      if (!Number.isFinite(v)) return;
      p.value = Math.max(p.minValue, Math.min(p.maxValue, v));
    },
    getAudioParam: (key) => paramFor(key),
    trigger: (note, time, dur, vel, opts) => {
      const when = Math.max(Number(time) || 0, ctx.currentTime);
      const span = Math.max(1, Math.round(opts?.span ?? 1));
      const d = Math.max(0.01, Number(dur) || 0.1);
      const legato = when === lastWhen ? lastLegato
        : prevTied && prevEnd >= 0 && when >= prevEnd - 0.03 && when <= prevEnd + Math.min(0.05, d * 0.35);
      lastWhen = when; lastLegato = legato;
      prevEnd = when + d; prevTied = span > 1;
      post({
        type: "note", when, id: ++noteId, note,
        freq: 440 * Math.pow(2, (note - 69) / 12),
        dur: d,
        vel: Math.max(0.05, Math.min(1, vel ?? 1)),
        glide, legato,
      });
    },
    release: (time) => (prevTied = false, prevEnd = -1, lastWhen = -1, post({ type: "off", when: Math.max(Number(time) || 0, ctx.currentTime) })),
  };
}
