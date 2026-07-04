// Morphagene granular tape processor — AudioWorklet.
//
// Runs in AudioWorkletGlobalScope: fully self-contained, NO imports. Everything
// is derived from the global `sampleRate` (never hardcode a rate). Models the
// Make Noise Morphagene: a stereo ring-buffer "reel" that is recorded into
// (always forward, constant speed) and re-played as enveloped "genes" (grains)
// with varispeed, splice/organize scanning, slide, morph overlap, and SOS
// overdub. See morphagene-spec.md.

const HALF = 1024;               // rising-cosine half-window LUT resolution
const MAX_GRAINS = 24;           // hard concurrency cap (CPU bound)
const EPS_SPEED = 0.02;          // |variSpeed| below this = playback halted (STOP)
const MAX_FADE_SEC = 0.03;       // longest grain edge crossfade (declick)

class MorphageneProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: "variSpeed", defaultValue: 1,   minValue: -2, maxValue: 2, automationRate: "k-rate" },
      { name: "organize",  defaultValue: 0,   minValue: 0,  maxValue: 1, automationRate: "k-rate" },
      { name: "geneSize",  defaultValue: 0,   minValue: 0,  maxValue: 1, automationRate: "k-rate" },
      { name: "slide",     defaultValue: 0,   minValue: 0,  maxValue: 1, automationRate: "k-rate" },
      { name: "morph",     defaultValue: 0.2, minValue: 0,  maxValue: 1, automationRate: "k-rate" },
      { name: "sos",       defaultValue: 0,   minValue: 0,  maxValue: 1, automationRate: "k-rate" },
    ];
  }

  constructor(options) {
    super();
    const opts = (options && options.processorOptions) || {};
    const maxSeconds = opts.maxSeconds || 12;
    this.reelLen = Math.max(1, Math.floor(maxSeconds * sampleRate));
    this.reelL = new Float32Array(this.reelLen);
    this.reelR = new Float32Array(this.reelLen);
    this.writeHead = 0;
    this.filled = 0;             // valid samples in the reel (grows then pins)
    this.recording = true;       // live rolling capture on by default
    this.spliceCount = 1;
    this.loopLen = 0;            // tempo-locked reel/record length in samples (0 = full ring buffer)

    // Rising raised-cosine half window (0 -> 1). A grain's Tukey envelope is
    // built from this: fade-in reads it forward, fade-out reads it reversed, the
    // body is flat 1.0. hop = grainLen - fade makes adjacent grains crossfade
    // with constant amplitude (COLA) for ANY grain length — clean loops when
    // long, classic Hann grains when short (fade == grainLen/2).
    this.halfWin = new Float32Array(HALF);
    for (let i = 0; i < HALF; i++) {
      this.halfWin[i] = 0.5 * (1 - Math.cos((Math.PI * i) / (HALF - 1)));
    }

    this.grains = [];
    for (let i = 0; i < MAX_GRAINS; i++) {
      this.grains.push({ active: false, start: 0, pos: 0, len: 1, fade: 1, rate: 1, phase: 0, gain: 0, panL: 1, panR: 1 });
    }
    this.sinceHop = 0;
    this._seed = 0x2545f491;     // LCG state (Math.random works here too, but keep it cheap+stable)
    this.statusAccum = 0;

    this.port.onmessage = (e) => {
      const d = e.data || {};
      switch (d.type) {
        case "freeze":       this.recording = !d.value; break;
        case "captureStart": this.writeHead = 0; this.filled = 0; this.recording = true; break;
        case "captureStop":  this.recording = false; break;
        case "splices":      this.spliceCount = Math.max(1, Math.min(16, d.value | 0)); break;
        case "loopLen": {
          // Tempo-locked reel length (record window). d.value is seconds; 0 = free.
          this.loopLen = d.value > 0 ? Math.min(this.reelLen, Math.floor(d.value * sampleRate)) : 0;
          if (this.loopLen > 0 && this.filled > this.loopLen) {
            this.filled = this.loopLen;
            this.writeHead %= this.loopLen;
          }
          break;
        }
        case "reset":        this.reelL.fill(0); this.reelR.fill(0); this.filled = 0; this.writeHead = 0; break;
        default: break;
      }
    };
  }

  _rand() {
    // xorshift-ish LCG, returns [0,1)
    this._seed = (Math.imul(this._seed, 1664525) + 1013904223) >>> 0;
    return this._seed / 4294967296;
  }

  _read(buf, idx) {
    const L = this.filled;
    if (L < 2) return 0;
    let x = idx % L;
    if (x < 0) x += L;
    const i0 = x | 0;
    const frac = x - i0;
    const i1 = i0 + 1 >= L ? 0 : i0 + 1;
    return buf[i0] * (1 - frac) + buf[i1] * frac;
  }

  _spawn(start, len, fade, rate, gain, panL, panR) {
    let slot = -1;
    for (let i = 0; i < this.grains.length; i++) {
      if (!this.grains[i].active) { slot = i; break; }
    }
    if (slot < 0) {
      // pool full — steal the grain nearest completion
      let bestFrac = -1;
      for (let i = 0; i < this.grains.length; i++) {
        const f = this.grains[i].phase / this.grains[i].len;
        if (f > bestFrac) { bestFrac = f; slot = i; }
      }
    }
    const g = this.grains[slot];
    g.active = true; g.start = start; g.pos = 0; g.len = len; g.fade = fade;
    g.rate = rate; g.phase = 0; g.gain = gain; g.panL = panL; g.panR = panR;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    const outL = output[0];
    const outR = output[1] || output[0];
    const inL = input && input[0] ? input[0] : null;
    const inR = input && input[1] ? input[1] : inL;
    const blockLen = outL.length;

    const variSpeed = parameters.variSpeed[0];
    const organize  = parameters.organize[0];
    const geneSize  = parameters.geneSize[0];
    const slide     = parameters.slide[0];
    const morph     = parameters.morph[0];
    const sos       = parameters.sos[0];

    // wrapLen: the active reel length. When tempo-synced, the reel records and
    // loops over exactly this many samples (a beat-locked tape loop); otherwise
    // it's the whole ring buffer.
    const wrapLen = this.loopLen > 0 ? this.loopLen : this.reelLen;
    const Lv = Math.max(1, Math.min(this.filled, wrapLen));
    const spliceCount = this.spliceCount;
    const spliceLen = Lv / spliceCount;

    // Gene length: a constant time set by Gene-Size (geneSize 0 => whole splice,
    // exp down to ~5ms), clamped to the splice.
    const minGrain = 0.005 * sampleRate;
    const frac = Math.min(1, minGrain / spliceLen);
    let grainLen = spliceLen * Math.pow(frac, geneSize);
    grainLen = Math.max(64, Math.min(grainLen, spliceLen));
    const fade = Math.min(grainLen * 0.5, MAX_FADE_SEC * sampleRate);

    // Organize: pick the active splice (stepped); with one splice, scan freely.
    let baseStart;
    if (spliceCount === 1) {
      baseStart = organize * Lv;
    } else {
      const active = Math.max(0, Math.min(spliceCount - 1, Math.floor(organize * spliceCount - 1e-9)));
      baseStart = active * spliceLen;
    }
    // Slide: offset the play-start within the splice.
    baseStart += slide * Math.max(0, spliceLen - grainLen);

    // Morph -> hop (grain spacing). Below 0.2 leaves silent gaps (pointillist);
    // ~0.2 is the seamless COLA crossfade (hop = grainLen - fade); above that
    // grains pack denser into an overlapping cloud.
    const seamlessHop = Math.max(1, grainLen - fade);
    let hop;
    if (morph < 0.2) {
      const k = morph / 0.2;                              // 0..1
      hop = grainLen * 2 * (1 - k) + seamlessHop * k;     // 2*grainLen -> seamless
    } else {
      const k = (morph - 0.2) / 0.8;                      // 0..1
      hop = seamlessHop * (1 - k) + (grainLen * 0.25) * k; // seamless -> dense
    }
    hop = Math.max(16, Math.floor(hop));

    // Above ~0.6 pan spreads; above ~0.85 add upward pitch randomization plus
    // detuned Morph-Chord genes (+1 oct, +1 oct + 5th).
    const panSpread = morph > 0.6 ? (morph - 0.6) / 0.4 : 0;
    const pitchRand = morph > 0.85 ? (morph - 0.85) / 0.15 : 0;
    const playing = Math.abs(variSpeed) >= EPS_SPEED;

    const spawnGene = (ratio, gain) => {
      let rate = variSpeed * ratio;
      if (pitchRand > 0) rate *= 1 + pitchRand * 0.03 * this._rand(); // upward only
      let pan = 0.5 + panSpread * (this._rand() - 0.5);
      if (pan < 0) pan = 0; else if (pan > 1) pan = 1;
      const th = pan * (Math.PI / 2);
      this._spawn(baseStart, grainLen, fade, rate, gain, Math.cos(th), Math.sin(th));
    };

    for (let n = 0; n < blockLen; n++) {
      // 1) live capture into the reel (always forward, constant speed)
      if (this.recording) {
        const sL = inL ? inL[n] : 0;
        const sR = inR ? inR[n] : sL;
        this.reelL[this.writeHead] = Math.tanh(sL);
        this.reelR[this.writeHead] = Math.tanh(sR);
        this.writeHead = this.writeHead + 1 >= wrapLen ? 0 : this.writeHead + 1;
        if (this.filled < wrapLen) this.filled++;
      }

      // 2) schedule genes
      if (playing) {
        if (this.sinceHop <= 0) {
          this.sinceHop = hop;
          spawnGene(1, 1);
          if (morph > 0.85) {
            const w = (morph - 0.85) / 0.15;
            spawnGene(2, 0.5 * w);                                  // +1 octave
            if (morph > 0.92) spawnGene(3, 0.4 * ((morph - 0.92) / 0.08)); // +1 oct + 5th
          }
        }
        this.sinceHop--;
      }

      // 3) render active genes with Tukey envelope
      let accL = 0, accR = 0;
      for (let i = 0; i < this.grains.length; i++) {
        const g = this.grains[i];
        if (!g.active) continue;
        let env;
        if (g.phase < g.fade) {
          env = this.halfWin[(g.phase / g.fade * (HALF - 1)) | 0];
        } else if (g.phase > g.len - g.fade) {
          env = this.halfWin[((g.len - g.phase) / g.fade * (HALF - 1)) | 0];
        } else {
          env = 1;
        }
        const readPos = g.start + g.pos;
        const amp = env * g.gain;
        accL += this._read(this.reelL, readPos) * amp * g.panL;
        accR += this._read(this.reelR, readPos) * amp * g.panR;
        g.pos += g.rate;
        g.phase++;
        if (g.phase >= g.len) g.active = false;
      }

      const oL = accL * 0.7;
      const oR = accR * 0.7;
      outL[n] = oL;
      outR[n] = oR;

      // 4) SOS overdub — bake playback back into the freshly-recorded sample.
      if (sos > 0 && this.recording) {
        const wh = this.writeHead === 0 ? wrapLen - 1 : this.writeHead - 1;
        const s = sos < 0.98 ? sos : 0.98;
        const leak = 1 - sos * 0.05;
        this.reelL[wh] = Math.tanh(this.reelL[wh] * leak + oL * s);
        this.reelR[wh] = Math.tanh(this.reelR[wh] * leak + oR * s);
      }
    }

    // ~5 Hz reel-fill status for the UI meter
    this.statusAccum += blockLen;
    if (this.statusAccum >= sampleRate * 0.2) {
      this.statusAccum = 0;
      this.port.postMessage({ type: "status", filled: this.filled / wrapLen, recording: this.recording });
    }
    return true;
  }
}

registerProcessor("morphagene-processor", MorphageneProcessor);
