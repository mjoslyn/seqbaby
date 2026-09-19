// The TR-808 and TR-909 voices, modelled on the machines' own circuits rather
// than as generic drum presets.
//
// Its own file, and importable with nothing but a raw AudioContext (the only
// import is paramHold.js, which has none of its own): everything else in
// voices.js reaches for Tone, the DOM or the Plaits WASM at eval time, and
// keeping this one clean is what lets `test/drumMachine.test.js` render all
// eleven voices in a headless OfflineAudioContext and measure them.
//
// Three things decide the shape of the code, and all three are the machines:
//
//   - **A voice is one circuit, so it is monophonic.** Retriggering a voice
//     recharges the envelope generator's capacitor; it does not start a second
//     copy of the instrument beside the first. Hence the persistent VCA per
//     circuit, whose re-attack IS the choke, and `rig.ring()` for the struck
//     resonators, which are faded at the next hit. Two open hats ringing over
//     each other is the one thing a real 808 cannot do.
//   - **The metal oscillators and the noise source free-run.** The cymbal
//     section's six squares and the noise transistor are always going; a hit
//     only opens a VCA on them. That is why no two hats off a real machine are
//     bit-identical, and why the attack transient varies — building fresh
//     oscillators per hit (which is what this used to do) starts every one at
//     phase zero and makes them all the same sample. It also takes all the
//     per-hit allocation off the transport callback.
//   - **The drums are struck resonators.** A bridged-T network rings when a
//     pulse hits it and is silent otherwise, so the kick's body and the
//     snare's two shells ARE built per hit, from rest. Only the free-running
//     parts are persistent.
//
// Pitch: on the real machines only the bass drum is meaningfully tunable per
// hit (and people do play 808 kicks melodically), so the kicks track the step's
// note while every other voice sits at its fixed factory tuning with TUNE as a
// trimmer. That also keeps them right in normal use: an 808 track is a drum-kit
// track, so its steps are C2, and a voice that transposed from its own
// reference note would land octaves below where the circuit sits. TUNE is
// automatable per step if you do want a pitched hat or cowbell.
//
// Known departure: on the machines the closed hat chokes the OPEN hat, because
// the two share one circuit. Here they are separate engines on separate tracks,
// so each chokes only itself.
import { holdParamAt } from "./paramHold.js";

// Tone wrappers don't accept a native connect() — unwrap to the node underneath.
const nativeIn = (node) => node?.input?.input ?? node?.input ?? node;

// The 808's cymbal/hi-hat section runs six square oscillators at these fixed
// frequencies, and the cowbell taps two of them (540 and 800 — a 1.48 ratio,
// which is what makes it clang rather than ring). Their inharmonic beating *is*
// the 808 metal sound; a noise source can't stand in for it.
export const TR808_METAL_HZ = [205.3, 369.6, 304.4, 522.7, 540, 800];
const TR808_COWBELL_HZ = [540, 800];

const clamp01 = (v) => Math.max(0, Math.min(1, Number(v) || 0));
/** Map a 0..1 knob onto [lo, hi] exponentially (how a real pot feels on a rate). */
const knobExp = (v, lo, hi) => lo * Math.pow(hi / lo, clamp01(v));
const knobLin = (v, lo, hi) => lo + (hi - lo) * clamp01(v);

/** How fast a choked voice is taken away: long enough not to click, short
 *  enough that a closed hat on the next 16th reads as a cut, not a fade. */
const CHOKE = 0.004;

// Where the pitch sweep is sampled, in time constants. An exponential VCO fed
// a discharging capacitor moves LINEARLY IN SEMITONES at an exponentially
// decaying rate: fast out of the gate, then settling onto the note. A single
// exponentialRampToValueAtTime is geometric, so it is linear in semitones at a
// CONSTANT rate and then stops dead — an audible corner right where a 909
// kick's punch lives. Four ramps laid along exp(-t/tau) put the curve back,
// and cost no allocation (setValueCurveAtTime would want a Float32Array a hit).
const PITCH_TAPS = [0.35, 0.85, 1.75, 3.2];

/**
 * The scheduled sweep, as `[seconds after the trigger, hertz]`. Exported so
 * `test/drumMachine.test.js` can hold it against the curve it is approximating
 * (`freq · bend^exp(-t/tau)`) without a browser to schedule it in.
 * @param {number} freq @param {number} bend @param {number} tau
 */
export function pitchSweep(freq, bend, tau) {
  const pts = [[0, freq * bend]];
  for (const k of PITCH_TAPS) pts.push([k * tau, freq * Math.pow(bend, Math.exp(-k))]);
  pts.push([6 * tau, freq]);
  return pts;
}

/** Where an exponential decay stops, before the VCA is stepped to true zero. */
const FLOOR = 0.0001;

// One two-second noise buffer per context, looped, for every voice that needs
// noise. Each hit used to fill a fresh buffer the length of its decay — up to
// 60,000 randoms for a 909 open hat, four buffers for a clap — on the main
// thread, inside the transport callback.
const noiseBufs = new WeakMap();
function sharedNoise(ctx) {
  let buf = noiseBufs.get(ctx);
  if (!buf) {
    const len = Math.ceil(2 * ctx.sampleRate);
    buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    noiseBufs.set(ctx, buf);
  }
  return buf;
}

/**
 * Strike a persistent VCA: recharge to `peak`, then discharge over `decay`.
 * A hit arriving while the last one is still ringing holds whatever is left and
 * ramps up from there — no step, and no second copy of the voice. That is both
 * the machine's envelope generator and, for free, the choke.
 * @param {AudioParam} param
 */
function strike(param, { t0, peak, decay, attack = 0.001, hold = 0, holdTime = 0.04 }) {
  const top = Math.max(0.0002, peak);
  holdParamAt(param, t0);
  // The charge is LINEAR and the discharge exponential, which is the wrong way
  // round for an RC by a millisecond nobody can hear and the only shape that
  // survives being retriggered: an exponential ramp out of a VCA that has been
  // taken to zero stays at zero and then jumps, which is a click on the one
  // event a drum machine does most.
  param.linearRampToValueAtTime(top, t0 + attack);
  if (hold > 0) param.exponentialRampToValueAtTime(Math.max(FLOOR * 2, top * hold), t0 + attack + holdTime);
  param.exponentialRampToValueAtTime(FLOOR, t0 + attack + decay);
  // And then actually zero, because a VCA parked at the exponential's floor
  // passes that much of a free-running oscillator bank for the rest of the
  // session — six squares at 1e-4 is -64 dB of hum under a silent track.
  param.setValueAtTime(0, t0 + attack + decay + 0.001);
}

/**
 * A bridged-T drum voice: one sine rung by a trigger, decaying exponentially,
 * with the downward pitch bend the network's excitation produces. Built per hit
 * because that is what a struck resonator is, and registered with the rig so the
 * next hit takes it away.
 */
function ringSine(rig, dest, { freq, bend = 1, tau = 0.01, peak, decay, t0 }) {
  const { ctx } = rig;
  const osc = ctx.createOscillator();
  osc.type = "sine";
  const sweep = pitchSweep(freq, bend, tau);
  osc.frequency.setValueAtTime(sweep[0][1], t0);
  if (bend !== 1) {
    for (let i = 1; i < sweep.length; i++) {
      osc.frequency.exponentialRampToValueAtTime(sweep[i][1], t0 + sweep[i][0]);
    }
  }
  const vca = ctx.createGain();
  vca.gain.setValueAtTime(0.0001, t0);
  vca.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + 0.002);
  vca.gain.exponentialRampToValueAtTime(0.0001, t0 + decay);
  osc.connect(vca).connect(dest);
  osc.start(t0);
  osc.stop(t0 + decay + 0.05);
  rig.ring(vca);
  return osc;
}

/** Soft clipper standing in for the mixer saturation an 808 hits on the way out. */
// The curve is memoised per amount (to 1/128th): it was 1024 tanh calls per
// kick, on every kick. The node itself now lives for the life of the voice, so
// the curve is only re-assigned when the knob has actually moved.
const satCurves = new Map();
export function satCurve(amount) {
  const q = Math.round(clamp01(amount) * 128);
  let c = satCurves.get(q);
  if (!c) {
    // ODD length, and the input mapped over n-1 rather than n. A WaveShaper
    // reads index `(x + 1) / 2 * (n - 1)`, so a curve laid out over `i*2/n - 1`
    // is half a cell out: silence landed between c[511] and c[512] and came out
    // at -0.004, a DC offset the kick then carried for the life of the voice
    // (and, before the shaper was persistent, one more copy of per hit).
    const n = 1025;
    c = new Float32Array(n);
    const k = 1 + (q / 128) * 12;
    const norm = Math.tanh(k);
    for (let i = 0; i < n; i++) c[i] = Math.tanh(((i * 2) / (n - 1) - 1) * k) / norm;
    satCurves.set(q, c);
  }
  return { q, c };
}
function setSaturation(ws, amount) {
  const { q, c } = satCurve(amount);
  if (ws._q !== q) { ws.curve = c; ws._q = q; }
}

/**
 * Shared scaffolding for the drum-machine voices: a native sum bus into the
 * voice's Tone output, the four track sliders kept as 0..1 knob values, and the
 * monophony. `setup(rig)` builds the voice's persistent circuit once and
 * returns the function that strikes it.
 * @param {AudioContext} ctx @param {*} output @param {Record<string, number>} defaults
 */
function drumMachineVoice(ctx, output, defaults, setup) {
  const bus = ctx.createGain();
  bus.gain.value = 1;
  bus.connect(nativeIn(output));
  const knobs = { ...defaults };
  /** Free-running sources: started once, stopped only when the voice goes. */
  const parts = [];
  /** The circuit's own VCAs — one per envelope generator on the panel. */
  const vcas = [];
  /** Struck resonators still sounding, to be taken away by the next hit. */
  let ringing = [];
  let noise = null;

  const rig = {
    ctx, bus, knobs,
    /** The voice's noise transistor: one per voice, always running, branched to
     *  wherever the circuit taps it. Started at its own offset into the shared
     *  buffer so two tracks are not hissing in unison. */
    noise: () => {
      if (noise) return noise;
      const buf = sharedNoise(ctx);
      noise = ctx.createBufferSource();
      noise.buffer = buf;
      noise.loop = true;
      noise.start(ctx.currentTime, Math.random() * buf.duration);
      parts.push(noise);
      return noise;
    },
    /** The cymbal section's free-running square bank. */
    bank: (freqs) => {
      const sum = ctx.createGain();
      sum.gain.value = 1;
      const oscs = freqs.map((hz) => {
        const o = ctx.createOscillator();
        o.type = "square";
        o.frequency.value = hz;
        o.connect(sum);
        o.start(ctx.currentTime);
        parts.push(o);
        return o;
      });
      return {
        sum,
        retune: (ratio, t) => oscs.forEach((o, i) => o.frequency.setValueAtTime(freqs[i] * ratio, t)),
      };
    },
    vca: () => {
      const g = ctx.createGain();
      g.gain.value = 0;              // shut until struck, so nothing leaks through

      vcas.push(g);
      return g;
    },
    filter: (type, freq, q) => {
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      if (q != null) f.Q.value = q;
      return f;
    },
    ring: (g) => { ringing.push(g); },
  };

  const hit = setup(rig);

  const quiet = (t) => {
    for (const g of ringing) {
      holdParamAt(g.gain, t);
      try { g.gain.linearRampToValueAtTime(0.0001, t + CHOKE); } catch {}
    }
    ringing = [];
  };

  // The track's four generic sliders drive the panel controls; params.js labels
  // them per engine so they read as the real knobs.
  const MAP = { harm: "tune", timb: "tone", morph: "colour", decay: "decay" };
  return {
    nodes: [{
      dispose() {
        for (const p of parts) { try { p.stop(); } catch {} try { p.disconnect(); } catch {} }
        try { bus.disconnect(); } catch {}
      },
    }],
    setParam: (key, val) => {
      const k = MAP[key];
      if (k && knobs[k] !== undefined) knobs[k] = clamp01(val);
    },
    trigger: (note, time, dur, vel) => {
      const t0 = Math.max(Number(time) || 0, ctx.currentTime + 0.001);
      quiet(t0);                      // one circuit per voice: the last hit goes
      hit({ note, t0, vel: Math.max(0.02, Math.min(1, vel ?? 1)), dur });
    },
    // A drum voice has a trigger input and no gate: note-off does nothing on
    // either machine, so a key lifting must not cut a hat that is still ringing.
    release: () => {},
    silence: (time) => {
      const t = Math.max(Number(time) || 0, ctx.currentTime);
      quiet(t);
      for (const g of vcas) {
        holdParamAt(g.gain, t);
        try {
          g.gain.linearRampToValueAtTime(FLOOR, t + 0.006);
          g.gain.setValueAtTime(0, t + 0.007);   // shut, not nearly shut
        } catch {}
      }
    },
  };
}

/**
 * The 808's metal voice: the six free-running squares through a VCA, a
 * high-pass and a resonant band-pass. Both hats are this same source — only the
 * envelope differs, exactly as on the machine, where they share a circuit.
 */
function metal808(rig, { decayAt, level }) {
  const { knobs } = rig;
  const bank = rig.bank(TR808_METAL_HZ);
  const vca = rig.vca();
  const hp = rig.filter("highpass", 7000);
  const bp = rig.filter("bandpass", 10000, 1.4);
  bank.sum.connect(vca).connect(hp).connect(bp).connect(rig.bus);
  return ({ t0, vel }) => {
    bank.retune(knobExp(knobs.tune, 0.7, 1.4), t0);   // fixed tuning; TUNE trims
    hp.frequency.setValueAtTime(knobExp(knobs.tone, 5000, 10000), t0);
    bp.frequency.setValueAtTime(knobExp(knobs.tone, 8000, 13000), t0);
    strike(vca.gain, { t0, peak: vel * level, decay: decayAt(knobs.decay) });
  };
}

/**
 * The 909 metal voice. Its hats were 6-bit samples of a real hi-hat rather than
 * an oscillator bank, so the model mixes broadband noise over the same square
 * cluster: the cluster keeps the metallic pitch, the noise supplies the sizzle
 * an oscillator bank can't. Both run free, so the sizzle's grain and the
 * cluster's phase differ hit to hit, as a sampled hat's never would — but a
 * real 909's analogue output stage and its own VCA do.
 */
function metal909(rig, { decayAt, level }) {
  const { knobs } = rig;
  const bank = rig.bank(TR808_METAL_HZ);
  const hp = rig.filter("highpass", 6000);
  const peaking = rig.filter("peaking", 10000, 1.2);
  peaking.gain.value = 6;
  hp.connect(peaking).connect(rig.bus);
  const vca = rig.vca();
  bank.sum.connect(vca).connect(hp);
  const hiss = rig.vca();
  rig.noise().connect(hiss).connect(hp);
  return ({ t0, vel }) => {
    const decay = decayAt(knobs.decay);
    bank.retune(knobExp(knobs.tune, 0.75, 1.35) * 1.18, t0);   // the sample sits brighter
    hp.frequency.setValueAtTime(knobExp(knobs.tone, 4500, 9000), t0);
    strike(vca.gain, { t0, peak: vel * level, decay });
    strike(hiss.gain, { t0, peak: vel * level * 1.1, decay });
  };
}

/** The clap's noise band, retriggered three times and then left to ring out. */
function clap(rig, { centreAt, qAt, gapAt, tailAt, slapLevel, tailLevel, tailPath }) {
  const { knobs } = rig;
  const bp = rig.filter("bandpass", 1100, 2);
  const vca = rig.vca();
  rig.noise().connect(bp).connect(vca).connect(rig.bus);
  // The tail is the same noise through the same VCA on the 808, where one
  // envelope generator does all four. The 909 hangs its tail on a wider band.
  let tailVca = vca;
  let tailHp = null;
  if (tailPath) {
    tailHp = rig.filter("highpass", 700);
    tailVca = rig.vca();
    rig.noise().connect(tailHp).connect(tailVca).connect(rig.bus);
  }
  return ({ t0, vel }) => {
    const centre = centreAt(knobs.tune);
    bp.frequency.setValueAtTime(centre, t0);
    bp.Q.setValueAtTime(qAt(knobs.tone), t0);
    if (tailHp) tailHp.frequency.setValueAtTime(centre * 0.6, t0);
    // Three slaps from the retrigger oscillator, whose RC slows a little each
    // lap — evenly spaced pulses read as a machine-gun, not as hands.
    const gap = gapAt(knobs.colour);
    for (let i = 0; i < 3; i++) {
      strike(vca.gain, { t0: t0 + i * gap * (1 + i * 0.08), peak: vel * slapLevel, decay: 0.004, attack: 0.0005 });
    }
    strike(tailVca.gain, {
      t0: t0 + 3.2 * gap, peak: vel * tailLevel, decay: tailAt(knobs.decay), attack: 0.002,
    });
  };
}

/**
 * Build one of the eleven TR-808 / TR-909 voices, or null if `kind` isn't one.
 * @param {string} kind @param {*} output @param {AudioContext} ctx
 */
export function buildDrumMachineVoice(kind, output, ctx) {
  switch (kind) {
    // Bass drum: a 55 Hz bridged-T rung by the trigger. TONE mixes in the attack
    // click the pulse shaper produces, DECAY lengthens the ring by lowering the
    // network's damping — the two knobs that are actually on the machine.
    case "808-kick":
      return drumMachineVoice(ctx, output, { tune: 0.5, tone: 0.35, colour: 0.25, decay: 0.55 }, (rig) => {
        const { knobs } = rig;
        const drive = ctx.createWaveShaper();
        drive.oversample = "2x";
        setSaturation(drive, knobs.colour);
        drive.connect(rig.bus);
        // Click: the trigger pulse through the shaper, down the same path so it
        // saturates with the body.
        const hp = rig.filter("highpass", 1400);
        const click = rig.vca();
        rig.noise().connect(hp).connect(click).connect(drive);
        return ({ note, t0, vel }) => {
          setSaturation(drive, knobs.colour);
          const base = 55 * Math.pow(2, (note - 36) / 12) * knobExp(knobs.tune, 0.7, 1.45);
          // The 808's drop is small and quick — a few semitones off a twin-T
          // that is already near its resonance, not the 909's dive.
          ringSine(rig, drive, {
            freq: base, bend: 1.26, tau: 0.012, peak: vel,
            decay: knobExp(knobs.decay, 0.14, 1.5), t0,
          });
          strike(click.gain, { t0, peak: vel * knobs.tone * 0.5, decay: 0.0025, attack: 0.0006 });
        };
      });

    // Snare: two bridged-T shells (185 / 330 Hz) plus a noise "snare" band.
    // SNAPPY balances noise against the shells, TONE opens the noise band up.
    case "808-snare":
      return drumMachineVoice(ctx, output, { tune: 0.5, tone: 0.5, colour: 0.5, decay: 0.4 }, (rig) => {
        const { knobs } = rig;
        const hp = rig.filter("highpass", 1800);
        const bp = rig.filter("bandpass", 5000, 0.6);
        const snares = rig.vca();
        rig.noise().connect(hp).connect(bp).connect(snares).connect(rig.bus);
        return ({ t0, vel }) => {
          const ratio = knobExp(knobs.tune, 0.7, 1.4);
          const shellDecay = knobLin(knobs.decay, 0.05, 0.25);
          const snappy = knobs.colour;                       // noise vs. shell balance
          ringSine(rig, rig.bus, { freq: 185 * ratio, bend: 1.08, tau: 0.003, peak: vel * (1 - snappy * 0.55) * 0.74, decay: shellDecay, t0 });
          ringSine(rig, rig.bus, { freq: 330 * ratio, bend: 1.08, tau: 0.003, peak: vel * (1 - snappy * 0.55) * 0.5, decay: shellDecay * 0.7, t0 });
          hp.frequency.setValueAtTime(knobExp(knobs.tone, 800, 4000), t0);
          bp.frequency.setValueAtTime(knobExp(knobs.tone, 3000, 9000), t0);
          strike(snares.gain, {
            t0, peak: vel * (0.25 + snappy * 0.75) * 0.62,
            decay: knobLin(knobs.decay, 0.08, 0.4),
          });
        };
      });

    // Closed hat: the six-oscillator metal cluster, high-passed and cut short.
    case "808-chat":
      return drumMachineVoice(ctx, output, { tune: 0.5, tone: 0.5, colour: 0.5, decay: 0.3 },
        (rig) => metal808(rig, { decayAt: (d) => knobExp(d, 0.02, 0.12), level: 1.05 }));

    // Open hat: the same cluster held open — DECAY is the panel knob for it.
    case "808-ohat":
      return drumMachineVoice(ctx, output, { tune: 0.5, tone: 0.5, colour: 0.5, decay: 0.5 },
        (rig) => metal808(rig, { decayAt: (d) => knobExp(d, 0.12, 1.1), level: 1.1 }));

    // Hand clap: a band of noise struck three times ~10 ms apart, then the
    // longer "room" tail — the retrigger is what makes it read as hands. One
    // noise source and one filter for all four, as on the machine: the slaps
    // are the same noise re-gated, which is why they share a grain and a colour
    // instead of sounding like four unrelated bursts.
    case "808-clap":
      return drumMachineVoice(ctx, output, { tune: 0.5, tone: 0.5, colour: 0.45, decay: 0.4 },
        (rig) => clap(rig, {
          centreAt: (v) => knobExp(v, 700, 1800),
          qAt: (v) => knobLin(v, 1.2, 4),
          gapAt: (v) => knobLin(v, 0.006, 0.016),
          tailAt: (v) => knobExp(v, 0.1, 0.6),
          slapLevel: 3.9, tailLevel: 3.35, tailPath: false,
        }));

    // Cowbell: two of the cymbal section's square oscillators, 540 and 800 Hz —
    // a 1.48 ratio, which is what makes it clang rather than ring. The band-pass
    // has to stay near those fundamentals: park it up on their harmonics and the
    // bell turns thin and whistly. A gentle high-pass takes the square waves'
    // boxiness out instead, and the envelope is the 808's hard spike into a tail.
    case "808-cowbell":
      return drumMachineVoice(ctx, output, { tune: 0.5, tone: 0.5, colour: 0.5, decay: 0.45 }, (rig) => {
        const { knobs } = rig;
        const bank = rig.bank(TR808_COWBELL_HZ);
        const vca = rig.vca();
        const hp = rig.filter("highpass", 400);
        const bp = rig.filter("bandpass", 1500, 0.7);       // wide: both tones speak
        bank.sum.connect(vca).connect(hp).connect(bp).connect(rig.bus);
        return ({ t0, vel }) => {
          bank.retune(knobExp(knobs.tune, 0.7, 1.4), t0);
          bp.frequency.setValueAtTime(knobExp(knobs.tone, 900, 2600), t0);   // on the fundamentals
          strike(vca.gain, {
            t0, peak: vel * 0.5, decay: knobExp(knobs.decay, 0.15, 0.9),
            hold: 0.5, holdTime: 0.04,                      // clonk, then tail
          });
        };
      });

    // TR-909 bass drum: same bridged-T idea as the 808, but the pitch envelope
    // sweeps far deeper and faster, and the beater click is a voice of its own —
    // that click is most of why a 909 kick cuts through where an 808 sits under.
    // Panel: TUNE, ATTACK, DECAY.
    case "909-kick":
      return drumMachineVoice(ctx, output, { tune: 0.5, tone: 0.55, colour: 0.3, decay: 0.35 }, (rig) => {
        const { knobs } = rig;
        const drive = ctx.createWaveShaper();
        drive.oversample = "2x";
        setSaturation(drive, 0.15 + knobs.colour * 0.85);
        drive.connect(rig.bus);
        const bp = rig.filter("bandpass", 2400, 0.8);
        const beater = rig.vca();
        rig.noise().connect(bp).connect(beater).connect(drive);
        return ({ note, t0, vel }) => {
          setSaturation(drive, 0.15 + knobs.colour * 0.85);
          const base = 50 * Math.pow(2, (note - 36) / 12) * knobExp(knobs.tune, 0.75, 1.5);
          ringSine(rig, drive, {
            freq: base, bend: 3.8, tau: 0.009, peak: vel,
            decay: knobExp(knobs.decay, 0.1, 0.9), t0,
          });
          // Beater: a bandpassed noise crack, level set by ATTACK.
          strike(beater.gain, { t0, peak: vel * knobs.tone * 0.85, decay: 0.005, attack: 0.0006 });
        };
      });

    // TR-909 snare: the shells are shorter than the 808's and the noise carries
    // the sound. TONE opens the noise band, SNAPPY sets how much of it there is.
    case "909-snare":
      return drumMachineVoice(ctx, output, { tune: 0.5, tone: 0.55, colour: 0.65, decay: 0.35 }, (rig) => {
        const { knobs } = rig;
        const hp = rig.filter("highpass", 1800);
        const snares = rig.vca();
        rig.noise().connect(hp).connect(snares).connect(rig.bus);
        return ({ t0, vel }) => {
          const ratio = knobExp(knobs.tune, 0.7, 1.4);
          const shell = knobLin(knobs.decay, 0.03, 0.12);
          const snappy = knobs.colour;
          ringSine(rig, rig.bus, { freq: 185 * ratio, bend: 1.06, tau: 0.0025, peak: vel * (1 - snappy * 0.5) * 0.56, decay: shell, t0 });
          ringSine(rig, rig.bus, { freq: 330 * ratio, bend: 1.06, tau: 0.0025, peak: vel * (1 - snappy * 0.5) * 0.4, decay: shell * 0.8, t0 });
          hp.frequency.setValueAtTime(knobExp(knobs.tone, 500, 6000), t0);
          strike(snares.gain, {
            t0, peak: vel * (0.3 + snappy * 0.7) * 0.75,
            decay: knobLin(knobs.decay, 0.06, 0.35),
          });
        };
      });

    // The 909's hats were samples of a real hi-hat, not the 808's oscillator
    // bank — hence the sizzle. Modelled as the metal cluster with noise mixed in
    // over the top, which is what separates it from the 808's purer ring.
    case "909-chat":
      return drumMachineVoice(ctx, output, { tune: 0.5, tone: 0.5, colour: 0.5, decay: 0.3 },
        (rig) => metal909(rig, { decayAt: (d) => knobExp(d, 0.02, 0.1), level: 0.235 }));

    case "909-ohat":
      return drumMachineVoice(ctx, output, { tune: 0.5, tone: 0.5, colour: 0.5, decay: 0.5 },
        (rig) => metal909(rig, { decayAt: (d) => knobExp(d, 0.12, 1.2), level: 0.29 }));

    // TR-909 clap: tighter slaps than the 808's and a noisier tail behind them,
    // which is why its tail hangs off a wider band rather than the slaps' own.
    case "909-clap":
      return drumMachineVoice(ctx, output, { tune: 0.5, tone: 0.5, colour: 0.4, decay: 0.35 },
        (rig) => clap(rig, {
          centreAt: (v) => knobExp(v, 900, 2200),
          qAt: (v) => knobLin(v, 0.8, 2.5),
          gapAt: (v) => knobLin(v, 0.005, 0.012),
          tailAt: (v) => knobExp(v, 0.09, 0.5),
          slapLevel: 1.7, tailLevel: 0.52, tailPath: true,
        }));
  }
  return null;
}
