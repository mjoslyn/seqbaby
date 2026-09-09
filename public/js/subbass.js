// ---- subby: the sub bass ------------------------------------------------
// An instrument for the bottom two octaves and nothing else. Not "a synth you
// can play low" — a synth that only makes sense down there, because the 20-80Hz
// region has four problems that no general-purpose engine solves and that a
// dedicated one can solve properly:
//
//   1. **Most listeners cannot hear it.** A phone speaker starts at ~500Hz and
//      a laptop at ~180Hz, so a 35Hz sine is literally silent on the two things
//      most people listen on. The fix is not "turn it up": it is to generate
//      HARMONICS of the fundamental and let the ear rebuild the missing
//      fundamental from them. That is what the whole harmonics path here is,
//      and it is why DRIVE gets a track slider rather than a corner of a panel.
//   2. **Distorting the whole signal destroys the low end**, exactly as it does
//      on a bass guitar (see bass.js) — the fundamental intermodulates with
//      everything above it and the bottom disappears. So the harmonics path is
//      PARALLEL and highpassed, and the clean sub goes back underneath it.
//   3. **It has to be monophonic.** Two notes a third apart at 40Hz beat against
//      each other at a rate you feel as lumpiness rather than hear as harmony.
//      Every sub-bass instrument worth the name is mono with last-note priority
//      and a glide — which is also where the 808 slide comes from.
//   4. **Asymmetric shaping at 30Hz makes DC**, and DC is a speaker cone held
//      off-centre with the amplifier's full headroom spent on holding it there.
//      Hence DC blockers after the shaper AND at the output, a rumble filter,
//      and a ceiling.
//
//          PITCH ENV (the 808 drop)
//                  |
//                  v
//   OSC x stack ---+--> clean (the actual sub, kept clean) ------+
//   (shape morph,  |                                             |
//    detuned)      +--> SHAPER --> HPF(xover) --> LPF(tone) -----+--> GLUE --> CEILING
//                  |    (the harmonics that make it audible)     |
//   SUB OCT -------+---------------------------------------------+
//
// One list, three namespaces, as in dx7.js / guitar.js / bass.js: every control
// is `sb` + a short key, and that short key spells its LFO target (`sub_<short>`)
// and its automation lane (`sub.<short>`).
//
// Worklet, not native nodes, for the usual reasons: Web Audio has no continuous
// shape morph off one phase accumulator, no wavefolder, no sample-accurate
// pitch envelope, and no way to put a rectifier between a highpass and a
// lowpass that are both tracking a control.

const SUB_PROCESSOR_SOURCE = `
const BLK = 16;        // control-block size

function bq() { return { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0, z1: 0, z2: 0 }; }
function bqRun(f, x) {
  const y = f.b0 * x + f.z1;
  f.z1 = f.b1 * x - f.a1 * y + f.z2;
  f.z2 = f.b2 * x - f.a2 * y;
  return y;
}
function bqSet(f, b0, b1, b2, a0, a1, a2) {
  const n = 1 / a0;
  f.b0 = b0 * n; f.b1 = b1 * n; f.b2 = b2 * n; f.a1 = a1 * n; f.a2 = a2 * n;
}
function bqLP(f, sr, freq, q) {
  const w = 2 * Math.PI * Math.min(Math.max(freq, 10), sr * 0.45) / sr;
  const c = Math.cos(w), a = Math.sin(w) / (2 * q);
  bqSet(f, (1 - c) / 2, 1 - c, (1 - c) / 2, 1 + a, -2 * c, 1 - a);
}
function bqHP(f, sr, freq, q) {
  const w = 2 * Math.PI * Math.min(Math.max(freq, 5), sr * 0.45) / sr;
  const c = Math.cos(w), a = Math.sin(w) / (2 * q);
  bqSet(f, (1 + c) / 2, -(1 + c), (1 + c) / 2, 1 + a, -2 * c, 1 - a);
}
function bqBP(f, sr, freq, q) {
  const w = 2 * Math.PI * Math.min(Math.max(freq, 10), sr * 0.45) / sr;
  const c = Math.cos(w), s = Math.sin(w), a = s / (2 * q);
  bqSet(f, a, 0, -a, 1 + a, -2 * c, 1 - a);
}

// The step in a saw or a square is a discontinuity, and at 40Hz a square has
// audible harmonics all the way to Nyquist — so the naive version aliases into
// the low end, which is the one place this instrument cannot afford it.
function polyBlep(t, dt) {
  if (dt <= 0) return 0;
  if (t < dt) { const x = t / dt; return x + x - x * x - 1; }
  if (t > 1 - dt) { const x = (t - 1) / dt; return x * x + x + x + 1; }
  return 0;
}

// ---- the shapers --------------------------------------------------------
// Four ways to make harmonics out of a sine, and they are genuinely different
// instruments rather than four flavours of "distortion":
//   tube  - asymmetric soft clip. Even AND odd harmonics; the octave-up one is
//           the strongest, which is exactly what a small speaker can reproduce.
//   fold  - a wavefolder. Reflects rather than clips, so it keeps making new
//           harmonics as it is driven instead of settling into a square.
//   fuzz  - hard clip. Odd harmonics only, and it turns into a square almost at
//           once: hollow, aggressive, and the loudest of the four.
//   rect  - full-wave rectification, which DOUBLES the frequency. The cheapest
//           way there is to put a 40Hz note's energy at 80Hz where a laptop can
//           actually reproduce it.
// EDGE is the asymmetry in all four: symmetric gives odd harmonics (hollow,
// growling), asymmetric gives even ones (an octave up, and far more audible on
// something small).
function shape(mode, x, g, edge) {
  // The bias goes on BEFORE the gain, which is where it is in a real stage and
  // the only place it does anything: past the gain the signal is already tens
  // of units tall and an offset of a fraction is invisible. Biased first, a
  // clipper produces a pulse whose duty cycle is no longer half — and an
  // uneven duty cycle IS the even harmonics.
  if (mode === 3) {
    // Rectify: |x| has twice the frequency of x, which is the cheapest octave
    // up there is. It has to happen BEFORE the gain — full-wave rectifying an
    // already-clipped square gives a constant, and the DC blocker downstream
    // then removes the entire signal.
    const r = (x < 0 ? -x : x) * 2 - 1;
    const b = r * (0.35 + edge * 0.65) + x * (0.65 - edge * 0.65);
    const v = b * g;
    return v / (1 + (v < 0 ? -v : v));
  }
  const v = (x + edge * 0.55) * g;
  if (mode === 1) {
    // fold: reflect back off +/-1 rather than flatten against it, so it keeps
    // making new harmonics as it is driven instead of settling into a square
    let f = v;
    for (let i = 0; i < 8; i++) {
      if (f > 1) f = 2 - f; else if (f < -1) f = -2 - f; else break;
    }
    return f;
  }
  if (mode === 2) return v > 1 ? 1 : (v < -1 ? -1 : v);
  return v / (1 + (v < 0 ? -v : v));
}

class SubBassProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    const a = (name, defaultValue, minValue, maxValue) =>
      ({ name, defaultValue, minValue, maxValue, automationRate: "a-rate" });
    const k = (name, defaultValue, minValue, maxValue) =>
      ({ name, defaultValue, minValue, maxValue, automationRate: "k-rate" });
    return [
      // The four track sliders
      a("drive", 0.35, 0, 1), a("tone", 0.5, 0, 1), a("shape", 0, 0, 1), k("decay", 0.5, 0, 1),
      // Oscillator
      a("sub", 0, 0, 1), k("detune", 0, 0, 1), k("phase", 0, 0, 1), k("drift", 0.06, 0, 1),
      // Envelopes
      k("drop", 0.15, 0, 1), k("droptm", 0.2, 0, 1), k("atk", 0.02, 0, 1),
      k("rel", 0.15, 0, 1), k("click", 0.2, 0, 1),
      // Harmonics path
      a("xover", 0.3, 0, 1), a("edge", 0.35, 0, 1),
      // Output
      a("hpf", 0.1, 0, 1), a("glue", 0.35, 0, 1), a("ceil", 0.85, 0, 1),
    ];
  }

  constructor() {
    super();
    this.sr = sampleRate;
    this.alive = true;
    this.queue = [];
    this.glideSec = 0;
    this.stack = 1; this.satMode = 0; this.legato = 0;

    // The one voice. A sub bass is mono on purpose — see the header.
    this.ph = 0; this.ph2 = 0.33; this.ph3 = 0.66; this.subPh = 0;
    this.freq = 55; this.target = 55; this.glideA = 1;
    this.env = 0; this.gate = false; this.held = false;
    this.decayC = 0; this.relC = 0; this.attC = 1; this.attacking = false;
    this.pEnv = 0; this.pDecC = 0;
    this.clickEnv = 0; this.clickC = 0;
    this.noteId = 0;
    this.drift1 = 0; this.drift2 = 0; this.driftT = 0;

    this.hcHP = bq(); this.hcLP = bq(); this.outHP = bq(); this.clickBP = bq();
    this.shDC = 0; this.shDCx = 0;
    this.outDC = 0; this.outDCx = 0;
    this.glueEnv = 0;
    this.coefKey = -1;
    this.port.onmessage = (e) => this.onMessage(e.data);
  }

  onMessage(m) {
    if (!m) return;
    if (m.type === "note") {
      if (this.queue.length > 128) this.queue.shift();
      const at = Math.max(0, Math.round(m.when * this.sr));
      this.queue.push({ at, off: false, id: m.id, freq: m.freq, vel: m.vel, glide: m.glide });
      this.queue.push({ at: at + Math.max(1, Math.round(m.dur * this.sr)), off: true, id: m.id });
      this.queue.sort((x, y) => x.at - y.at);
    } else if (m.type === "off") {
      const at = Math.max(0, Math.round(m.when * this.sr));
      this.queue = this.queue.filter(ev => ev.off && ev.at < at);
      this.allOff = at;
    } else if (m.type === "set") {
      if (m.stack !== undefined) this.stack = Math.max(1, Math.min(3, m.stack | 0));
      if (m.sat !== undefined) this.satMode = Math.max(0, Math.min(3, m.sat | 0));
      if (m.legato !== undefined) this.legato = m.legato ? 1 : 0;
      if (m.glide !== undefined) this.glideSec = Math.max(0, m.glide);
      this.coefKey = -1;
    } else if (m.type === "dispose") {
      this.alive = false;
    }
  }

  noteOn(ev, P) {
    const drop = P.drop, droptm = P.droptm, atk = P.atk, click = P.click, phase = P.phase;
    // In legato mode the glide only happens when a note arrives while another
    // is still held — which is exactly the 808 slide, and how a 303 ties notes.
    const gl = ev.glide > 0 ? ev.glide : this.glideSec;
    const sliding = gl > 0 && (!this.legato || this.held);
    this.target = ev.freq;
    if (sliding && this.env > 1e-4) {
      this.glideA = 1 - Math.exp(-3 / Math.max(1, gl * this.sr / BLK));
    } else {
      this.freq = ev.freq; this.glideA = 1;
    }

    // Where the oscillator starts is a real control down here: a sine started
    // at zero spends its first quarter cycle — 6ms at 40Hz — climbing to its
    // peak, which is a soft note; started at the peak it hits immediately. It
    // is also how you stop a sub fighting the kick underneath it.
    if (!sliding || this.env <= 1e-4) {
      this.ph = phase; this.ph2 = phase + 0.33; this.ph3 = phase + 0.66; this.subPh = phase * 0.5;
      if (this.ph2 >= 1) this.ph2 -= 1;
      if (this.ph3 >= 1) this.ph3 -= 1;
    }

    this.noteId = ev.id;
    this.gate = true; this.held = true;
    const peak = 0.32 + ev.vel * 0.68;
    this.peak = peak;
    // A retrigger over a ringing note starts from where that note is rather
    // than from silence: a sub is one continuous thing and a hard restart is a
    // click you can see on the meter.
    if (this.env > peak) this.env = peak;
    const atkT = 0.0005 + atk * atk * 0.4;
    this.attC = 1 - Math.exp(-1 / (atkT * this.sr / 3));
    this.attacking = true;

    // The 808 drop: the pitch starts above the note and falls onto it. That
    // fall IS the attack transient — it is why an 808 has a beater sound at all
    // when it is otherwise a sine.
    if (drop > 0.0005) {
      this.pEnv = 1;
      const dT = 0.004 + droptm * droptm * 0.5;
      this.pDecC = Math.exp(-1 / (dT * this.sr));
    } else this.pEnv = 0;

    if (click > 0.0005) {
      this.clickEnv = click * (0.4 + ev.vel * 0.6);
      this.clickC = Math.exp(-1 / (0.0035 * this.sr));
    }
  }

  noteOff(id) {
    if (id !== undefined && id !== this.noteId) return;
    this.gate = false; this.held = false;
  }

  process(inputs, outputs, params) {
    if (!this.alive) return false;
    const out = outputs[0];
    if (!out || !out.length) return true;
    const o = out[0];
    const n128 = o.length;
    const sr = this.sr;
    const P = params;
    const startFrame = Math.round(currentTime * sr);

    for (let base = 0; base < n128; base += BLK) {
      const blk = Math.min(BLK, n128 - base);
      const i = base;
      const at = startFrame + base;

      // Note events land on control-block boundaries: at most 0.33ms late,
      // never early. Same bargain the virus and the bass strike.
      if (this.allOff !== undefined && at >= this.allOff) { this.noteOff(); this.allOff = undefined; }
      while (this.queue.length && this.queue[0].at <= at + blk) {
        const ev = this.queue.shift();
        if (ev.off) this.noteOff(ev.id);
        else this.noteOn(ev, {
          drop:   P.drop.length   > 1 ? P.drop[i]   : P.drop[0],
          droptm: P.droptm.length > 1 ? P.droptm[i] : P.droptm[0],
          atk:    P.atk.length    > 1 ? P.atk[i]    : P.atk[0],
          click:  P.click.length  > 1 ? P.click[i]  : P.click[0],
          phase:  P.phase.length  > 1 ? P.phase[i]  : P.phase[0],
        });
      }

      const drop   = P.drop.length   > 1 ? P.drop[i]   : P.drop[0];
      const drive  = P.drive.length  > 1 ? P.drive[i]  : P.drive[0];
      const tone   = P.tone.length   > 1 ? P.tone[i]   : P.tone[0];
      const shp    = P.shape.length  > 1 ? P.shape[i]  : P.shape[0];
      const decay  = P.decay.length  > 1 ? P.decay[i]  : P.decay[0];
      const subL   = P.sub.length    > 1 ? P.sub[i]    : P.sub[0];
      const detune = P.detune.length > 1 ? P.detune[i] : P.detune[0];
      const drift  = P.drift.length  > 1 ? P.drift[i]  : P.drift[0];
      const rel    = P.rel.length    > 1 ? P.rel[i]    : P.rel[0];
      const xover  = P.xover.length  > 1 ? P.xover[i]  : P.xover[0];
      const edge   = P.edge.length   > 1 ? P.edge[i]   : P.edge[0];
      const hpf    = P.hpf.length    > 1 ? P.hpf[i]    : P.hpf[0];
      const glue   = P.glue.length   > 1 ? P.glue[i]   : P.glue[0];
      const ceil   = P.ceil.length   > 1 ? P.ceil[i]   : P.ceil[0];

      let key = this.satMode * 4 + this.stack;
      for (const q of [tone, xover, hpf]) key = key * 256 + (q * 255 | 0);
      if (key !== this.coefKey) {
        this.coefKey = key;
        // The crossover is the whole trick, and it is the same one bass.js
        // uses: the shaped signal only ever contributes ABOVE this, so the
        // clean fundamental underneath is never intermodulated.
        const xf = 60 * Math.pow(2, xover * 3.8);
        bqHP(this.hcHP, sr, xf, 0.7);
        // TONE is the lid on the harmonics, not on the sub — 300Hz to 9kHz.
        bqLP(this.hcLP, sr, 300 * Math.pow(2, tone * 4.9), 0.7);
        // The rumble filter. Below about 25Hz there is no pitch left, only
        // cone excursion spending headroom on air it cannot move.
        bqHP(this.outHP, sr, 16 + hpf * hpf * 55, 0.7);
        bqBP(this.clickBP, sr, 1800, 0.9);
      }

      // The decay runs whether or not the step is still held — that is what an
      // 808 does, and it is why an 808 line rings over the bar line. The gate
      // only ever shortens it.
      const decT = 0.03 + decay * decay * 8;
      this.decayC = Math.exp(-1 / (decT * sr));
      const relT = Math.min(decT, 0.008 + rel * rel * 2.5);
      this.relC = Math.exp(-1 / (relT * sr));

      // Analogue pitch drift: a slow random walk, a few cents wide. Two
      // one-poles so it wanders rather than jitters.
      this.driftT += blk;
      if (this.driftT >= sr * 0.05) {
        this.driftT = 0;
        this.drift1 += 0.25 * ((Math.random() * 2 - 1) - this.drift1);
      }
      this.drift2 += 0.02 * (this.drift1 - this.drift2);
      const driftMul = Math.pow(2, this.drift2 * drift * 12 / 1200);

      // Detune is in cents and deliberately small: at 40Hz, 20 cents is a 0.5Hz
      // beat — movement you feel. What is a lush reese at 80Hz is a wobble that
      // fights the kick at 40, so the spread narrows as the note falls.
      const det = detune * 25 * Math.min(1, this.freq / 80);
      const nOsc = this.stack;
      // The spread hangs either side of the note, never off one end of it —
      // detuning a pair upward would sharpen the whole instrument by half the
      // spread, so changing the stack would retune the track.
      const m1 = nOsc === 2 ? Math.pow(2, -det / 2400) : 1;
      const m2 = nOsc === 2 ? Math.pow(2, det / 2400) : Math.pow(2, det / 1200);
      const m3 = Math.pow(2, -det / 1200);
      const oscNorm = nOsc === 1 ? 1 : (nOsc === 2 ? 0.62 : 0.5);

      const driveG = 1 + drive * drive * 60;
      // Wound up, the harmonics have to be LOUDER than the fundamental, not a
      // sheen over it — on a phone they are the entire note, and the ear
      // rebuilds the fundamental from them. Squared so the bottom of the
      // slider is still a clean sub.
      const hcMix = drive * drive * (1.5 + edge * 0.6);
      // The clean path steps back as the harmonics come up, so DRIVE is a
      // "how audible" control rather than a "how loud" one.
      const clnMix = 1 - drive * 0.35;
      const thr = 0.55 - glue * 0.42;
      const ratio = 1 + glue * 6;
      const makeup = 1 + glue * glue * 1.6;
      const atkG = 1 - Math.exp(-1 / (0.004 * sr));
      const relG = 1 - Math.exp(-1 / (0.11 * sr));
      const lim = 0.25 + ceil * 0.75;

      for (let s = 0; s < blk; s++) {
        if (this.glideA < 1) {
          this.freq += (this.target - this.freq) * this.glideA;
          if (Math.abs(this.target - this.freq) < 0.005) { this.freq = this.target; this.glideA = 1; }
        }

        // ---- envelopes ----
        if (this.attacking) {
          this.env += this.attC * (this.peak * 1.02 - this.env);
          if (this.env >= this.peak) { this.env = this.peak; this.attacking = false; }
        } else {
          this.env *= this.gate ? this.decayC : this.relC;
        }
        if (this.env < 1e-6) { this.env = 0; }
        if (this.pEnv > 1e-5) this.pEnv *= this.pDecC; else this.pEnv = 0;
        if (this.clickEnv > 1e-5) this.clickEnv *= this.clickC; else this.clickEnv = 0;

        if (this.env === 0 && this.clickEnv === 0) { o[base + s] = 0; continue; }

        // The drop, in semitones, on top of the note.
        const dropSemis = this.pEnv * drop * 40;
        const f = this.freq * driftMul * (dropSemis > 0.0001 ? Math.pow(2, dropSemis / 12) : 1);
        const dt = f / sr;

        // ---- the oscillator: one phase accumulator, four waves ----
        // Sine -> triangle -> saw -> square, all derived from the same phase so
        // the crossfades stay coherent (the same reason virus.js does it that
        // way). Down here the choice really matters: a sine has no harmonics to
        // reconstruct the fundamental from, and a square has too many.
        let osc = 0;
        const dt1 = dt * m1;
        this.ph += dt1; if (this.ph >= 1) this.ph -= 1;
        osc += this.wave(this.ph, dt1, shp);
        if (nOsc > 1) {
          const dt2 = dt * m2;
          this.ph2 += dt2; if (this.ph2 >= 1) this.ph2 -= 1;
          osc += this.wave(this.ph2, dt2, shp);
        }
        if (nOsc > 2) {
          const dt3 = dt * m3;
          this.ph3 += dt3; if (this.ph3 >= 1) this.ph3 -= 1;
          osc += this.wave(this.ph3, dt3, shp);
        }
        osc *= oscNorm;

        // The octave under, always a sine: it is there to be felt, and anything
        // with harmonics at 20Hz is just mud.
        if (subL > 0.001) {
          this.subPh += dt * 0.5; if (this.subPh >= 1) this.subPh -= 1;
          osc += Math.sin(2 * Math.PI * this.subPh) * subL;
        }

        const dry = osc * this.env;

        // ---- the harmonics path: parallel, shaped, highpassed ----
        // This is the whole reason the instrument exists. Shape hard, keep only
        // what is above the crossover, put the clean fundamental back under it.
        let sig = dry * clnMix;
        if (drive > 0.001) {
          let h = shape(this.satMode, dry, driveG, edge);
          const hd = h - this.shDCx + 0.9995 * this.shDC;
          this.shDCx = h; this.shDC = hd;
          h = bqRun(this.hcLP, bqRun(this.hcHP, hd));
          sig += h * hcMix;
        }

        // The beater. An 808's click is a band of noise at the attack, and on a
        // small speaker it is often the only part of the note that arrives.
        if (this.clickEnv > 1e-5) {
          sig += bqRun(this.clickBP, (Math.random() * 2 - 1)) * this.clickEnv * 0.8;
        }

        sig = bqRun(this.outHP, sig);

        // ---- glue ----
        const ax = sig < 0 ? -sig : sig;
        this.glueEnv += (ax > this.glueEnv ? atkG : relG) * (ax - this.glueEnv);
        if (this.glueEnv > thr) sig *= Math.pow(this.glueEnv / thr, 1 / ratio - 1);
        sig *= makeup;

        // ---- ceiling ----
        // Asymmetric shaping at these frequencies makes DC, and DC is a cone
        // held off-centre with the amplifier's headroom spent holding it there.
        const dz = sig - this.outDCx + 0.9995 * this.outDC;
        this.outDCx = sig; this.outDC = dz;
        // Linear until it is genuinely near the ceiling, then a smooth knee to
        // the asymptote. A curve that bends everywhere would put harmonics on a
        // patch whose whole point is not having any.
        const t = dz / lim;
        const a = t < 0 ? -t : t;
        if (a <= 0.75) { o[base + s] = dz; }
        else {
          const u = (a - 0.75) * 4;
          o[base + s] = (t < 0 ? -1 : 1) * (0.75 + 0.25 * u / (1 + u)) * lim;
        }
      }
    }
    return true;
  }

  // Sine -> tri -> saw -> square across the morph, two waves crossfaded at a
  // time so the ends are exactly the classic waves rather than approximations.
  // All four are ZERO-CROSSING-ALIGNED with the sine — same rise through zero
  // at phase 0, same jump at 0.5 — because they share one accumulator and
  // because the PHASE control has to mean the same thing whichever shape is
  // loaded. A saw starting at -1 while the sine starts at 0 would make the
  // punch of a note depend on the morph knob.
  wave(p, dt, m) {
    if (m <= 0) return Math.sin(2 * Math.PI * p);
    const tri = () => {
      let q = p + 0.25; if (q >= 1) q -= 1;
      return 1 - 4 * (q < 0.5 ? 0.5 - q : q - 0.5);
    };
    const saw = () => {
      let r = p + 0.5; if (r >= 1) r -= 1;
      return 2 * r - 1 - polyBlep(r, dt);
    };
    if (m < 1 / 3) {
      const u = m * 3;
      return Math.sin(2 * Math.PI * p) * (1 - u) + tri() * u;
    }
    if (m < 2 / 3) {
      const u = (m - 1 / 3) * 3;
      return tri() * (1 - u) + saw() * u;
    }
    const u = (m - 2 / 3) * 3;
    let q = p + 0.5; if (q >= 1) q -= 1;
    // A square at 40Hz is the loudest of the four by a wide margin; trimmed so
    // the morph knob is a change of colour and not of level.
    const sq = ((p < 0.5 ? 1 : -1) + polyBlep(p, dt) - polyBlep(q, dt)) * 0.8;
    return saw() * (1 - u) + sq * u;
  }
}

registerProcessor("sub-bass", SubBassProcessor);
`;

const _loads = new WeakMap();
const _ready = new WeakSet();

/**
 * Register the sub-bass processor on this context. Called at init() so the
 * await on the play path has already resolved by the time a voice is built.
 * @param {BaseAudioContext} ctx @returns {Promise<void>}
 */
export function loadSubBassWorklet(ctx) {
  if (!ctx?.audioWorklet) return Promise.reject(new Error("no AudioWorklet"));
  let p = _loads.get(ctx);
  if (!p) {
    const url = URL.createObjectURL(new Blob([SUB_PROCESSOR_SOURCE], { type: "text/javascript" }));
    p = ctx.audioWorklet.addModule(url)
      .then(() => { URL.revokeObjectURL(url); _ready.add(ctx); })
      .catch((e) => { URL.revokeObjectURL(url); _loads.delete(ctx); throw e; });
    _loads.set(ctx, p);
  }
  return p;
}

/** Has the processor finished registering on this context? */
export function subBassReady(ctx) { return !!ctx && _ready.has(ctx); }

// ---- the panel ----------------------------------------------------------

/** Numeric panel controls: [short key, min, max, default, label]. */
export const SUB_NUM_CTLS = [
  ["sub",    0, 1, 0,    "sub oct"],
  ["detune", 0, 1, 0,    "detune"],
  ["phase",  0, 1, 0,    "phase"],
  ["drift",  0, 1, 0.06, "drift"],
  ["drop",   0, 1, 0.15, "drop"],
  ["droptm", 0, 1, 0.2,  "drop time"],
  ["atk",    0, 1, 0.02, "attack"],
  ["rel",    0, 1, 0.15, "release"],
  ["click",  0, 1, 0.2,  "click"],
  ["xover",  0, 1, 0.3,  "xover"],
  ["edge",   0, 1, 0.35, "edge"],
  ["hpf",    0, 1, 0.1,  "low cut"],
  ["glue",   0, 1, 0.35, "glue"],
  ["ceil",   0, 1, 0.85, "ceiling"],
];

/** Select controls: [short key, default, [values]]. */
export const SUB_SEL_CTLS = [
  ["stack",  "1",    ["1", "2", "3"]],
  ["sat",    "tube", ["tube", "fold", "fuzz", "rect"]],
  ["glidem", "always", ["always", "legato"]],
];

export const SUB_MOD_KEYS = SUB_NUM_CTLS.map(c => c[0]);
export const SUB_NUM_KEYS = SUB_MOD_KEYS.map(k => `sb${k}`);
export const SUB_SEL_KEYS = SUB_SEL_CTLS.map(c => `sb${c[0]}`);

export const SUB_MOD_RANGE = Object.fromEntries(SUB_NUM_CTLS.map(c => [c[0], [c[1], c[2]]]));

export const SUB_MOD_LABELS = Object.fromEntries(
  SUB_NUM_CTLS.map(([k, , , , label]) => [k, `subby ${label}`]));

export const SUB_DEFAULTS = {
  ...Object.fromEntries(SUB_NUM_CTLS.map(c => [`sb${c[0]}`, c[3]])),
  ...Object.fromEntries(SUB_SEL_CTLS.map(c => [`sb${c[0]}`, c[1]])),
};

/** A 0..1 lane value in this control's own units. @param {string} k short key */
export function subFromUnit(k, u) {
  const [lo, hi] = SUB_MOD_RANGE[k] ?? [0, 1];
  return lo + Math.max(0, Math.min(1, u)) * (hi - lo);
}

// ---- the tones ----------------------------------------------------------
// Sub-bass is a small number of very well-established sounds, and the useful
// thing an instrument can do is put you inside one of them in a click. Each is
// a complete patch: every panel control plus the four track sliders.
const TONES = {
  "808": {
    d: "the trap 808: a sine with a short pitch drop for the beater, a decay that rings over the bar, and just enough drive to survive a phone speaker",
    drive: 0.52, tone: 0.42, shape: 0, decay: 0.62,
    p: { sub: 0, detune: 0, phase: 0.25, drift: 0.04, drop: 0.22, droptm: 0.16,
         atk: 0.01, rel: 0.12, click: 0.22, xover: 0.34, edge: 0.4,
         hpf: 0.08, glue: 0.3, ceil: 0.85, stack: "1", sat: "tube", glidem: "legato" },
  },
  "distorted 808": {
    d: "the same 808 driven until the harmonics are louder than the fundamental — the version that still reads as bass on a laptop, because on a laptop that is all you are hearing",
    drive: 0.82, tone: 0.62, shape: 0.08, decay: 0.6,
    p: { sub: 0, detune: 0, phase: 0.25, drift: 0.05, drop: 0.2, droptm: 0.14,
         atk: 0.01, rel: 0.1, click: 0.3, xover: 0.4, edge: 0.55,
         hpf: 0.14, glue: 0.5, ceil: 0.8, stack: "1", sat: "tube", glidem: "legato" },
  },
  "pure sine": {
    d: "no harmonics at all — the reference sub. Inaudible on anything small by design: this is the one you use when something else in the mix is already carrying the note",
    drive: 0, tone: 0.3, shape: 0, decay: 0.45,
    p: { sub: 0, detune: 0, phase: 0.25, drift: 0, drop: 0, droptm: 0.2,
         atk: 0.05, rel: 0.2, click: 0, xover: 0.3, edge: 0,
         hpf: 0.06, glue: 0.15, ceil: 0.9, stack: "1", sat: "tube", glidem: "always" },
  },
  "reese": {
    d: "three detuned oscillators beating against each other and then folded — the drum-and-bass sub, where the movement is the sound and the notch sweeping through it is the rest",
    drive: 0.6, tone: 0.7, shape: 0.75, decay: 0.75,
    p: { sub: 0.3, detune: 0.55, phase: 0, drift: 0.12, drop: 0, droptm: 0.2,
         atk: 0.06, rel: 0.25, click: 0, xover: 0.28, edge: 0.2,
         hpf: 0.12, glue: 0.45, ceil: 0.82, stack: "3", sat: "fold", glidem: "always" },
  },
  "dub": {
    d: "slow in, slow out, an octave underneath and nothing above 200Hz. A note you feel arriving before you hear it",
    drive: 0.14, tone: 0.18, shape: 0.12, decay: 0.7,
    p: { sub: 0.55, detune: 0.08, phase: 0, drift: 0.14, drop: 0, droptm: 0.2,
         atk: 0.22, rel: 0.4, click: 0, xover: 0.2, edge: 0.15,
         hpf: 0.02, glue: 0.5, ceil: 0.88, stack: "2", sat: "tube", glidem: "always" },
  },
  "drill slide": {
    d: "808 with the glide on legato, so tied notes slide into each other and separate ones do not — which is the entire bassline in half of what is on the radio",
    drive: 0.58, tone: 0.5, shape: 0, decay: 0.55,
    p: { sub: 0, detune: 0, phase: 0.25, drift: 0.05, drop: 0.12, droptm: 0.1,
         atk: 0.01, rel: 0.08, click: 0.18, xover: 0.36, edge: 0.45,
         hpf: 0.1, glue: 0.38, ceil: 0.84, stack: "1", sat: "tube", glidem: "legato" },
  },
  "memphis": {
    d: "driven past the point of politeness through a fuzz, tone up, glue hard — the tape-saturated sub that sounds like it has been through a generation of dubbing",
    drive: 0.9, tone: 0.78, shape: 0.3, decay: 0.5,
    p: { sub: 0.15, detune: 0, phase: 0.25, drift: 0.2, drop: 0.18, droptm: 0.2,
         atk: 0.01, rel: 0.12, click: 0.35, xover: 0.3, edge: 0.7,
         hpf: 0.16, glue: 0.65, ceil: 0.72, stack: "1", sat: "fuzz", glidem: "legato" },
  },
  "house sub": {
    d: "short, tight and gone before the next kick — a clean fundamental with only enough top on it to be findable, ducking out of the way rather than filling the bar",
    drive: 0.38, tone: 0.45, shape: 0.35, decay: 0.2,
    p: { sub: 0.1, detune: 0, phase: 0.25, drift: 0.03, drop: 0.05, droptm: 0.08,
         atk: 0.02, rel: 0.06, click: 0.08, xover: 0.32, edge: 0.25,
         hpf: 0.18, glue: 0.3, ceil: 0.88, stack: "1", sat: "tube", glidem: "always" },
  },
  "growl": {
    d: "folded hard and wide open on top: the harmonics are the note now and the sub is only there to be felt under them. Put an LFO on edge and this is a wobble",
    drive: 0.95, tone: 0.9, shape: 0.6, decay: 0.7,
    p: { sub: 0.4, detune: 0.3, phase: 0, drift: 0.1, drop: 0, droptm: 0.2,
         atk: 0.04, rel: 0.2, click: 0, xover: 0.42, edge: 0.6,
         hpf: 0.14, glue: 0.55, ceil: 0.78, stack: "2", sat: "fold", glidem: "always" },
  },
  "cinematic drop": {
    d: "a very deep, very slow pitch fall onto the note, rectified so the octave above carries it. The trailer hit, and it needs a long step to be worth anything",
    drive: 0.5, tone: 0.35, shape: 0.05, decay: 0.85,
    p: { sub: 0.5, detune: 0.12, phase: 0.25, drift: 0.08, drop: 0.75, droptm: 0.62,
         atk: 0.03, rel: 0.5, click: 0.1, xover: 0.24, edge: 0.3,
         hpf: 0.04, glue: 0.6, ceil: 0.9, stack: "2", sat: "rect", glidem: "always" },
  },
};

export const SUB_TONE_NAMES = Object.keys(TONES);

/** One line saying what a tone is reaching for. @param {string} name */
export function subToneDescription(name) { return TONES[name]?.d ?? ""; }

/**
 * A tone as a complete set of track params — every panel control plus the four
 * track sliders, so nothing of the last patch survives.
 * @param {string} name
 * @returns {Record<string, number|string>|null}
 */
export function subTone(name) {
  const v = TONES[name];
  if (!v) return null;
  const out = { ...SUB_DEFAULTS };
  for (const [k, val] of Object.entries(v.p)) out[`sb${k}`] = val;
  out.harm = v.drive; out.timb = v.tone; out.morph = v.shape; out.decay = v.decay;
  return out;
}

const SAT_IDX = { tube: 0, fold: 1, fuzz: 2, rect: 3 };

// Tone wrappers don't accept a native connect() — unwrap to the node underneath.
const nativeIn = (node) => node?.input?.input ?? node?.input ?? node;

/**
 * Build the sub-bass voice. Returns null when the worklet isn't registered yet,
 * so the caller can fall back rather than leave the track silent.
 * @param {*} output Tone node the voice writes into.
 */
export function buildSubBassVoice(output) {
  const ctx = Tone.getContext().rawContext;
  if (!subBassReady(ctx)) { loadSubBassWorklet(ctx).catch(() => {}); return null; }

  let node;
  try {
    node = new AudioWorkletNode(ctx, "sub-bass",
      { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1] });
  } catch (e) {
    console.warn("sub-bass worklet node failed", e);
    return null;
  }
  node.connect(nativeIn(output));

  const PARAM_OF = { harm: "drive", timb: "tone", morph: "shape", decay: "decay" };
  for (const k of SUB_MOD_KEYS) PARAM_OF[`sb${k}`] = k;

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
      if (key === "sbstack")  { post({ type: "set", stack: parseInt(val, 10) || 1 }); return; }
      if (key === "sbsat")    { post({ type: "set", sat: SAT_IDX[val] ?? 0 }); return; }
      if (key === "sbglidem") { post({ type: "set", legato: val === "legato" }); return; }
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
