"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./home.module.css";

// The homepage's toy: four lanes, sixteen steps, a play button. It is not the
// engine -- the engine is ~1.7MB and a homepage should not boot it to say
// hello -- just raw Web Audio making a kick, a snare, a hat and a blip, so a
// visitor has pressed play on something before they have been asked to click
// through to anything.

const LANES = ["kick", "snare", "hat", "blip"] as const;
const STEPS = 16;
const DEFAULT_BPM = 118;
// A minor pentatonic, one note per step, so the blip lane can never be wrong.
const DEFAULT_BLIP = [0, 3, 5, 7, 10, 12, 10, 7, 5, 3, 0, 7, 12, 15, 12, 7];

const DEFAULT_START = [
  "x...x...x...x..x",
  "....x.......x...",
  "..x.x.x.x.x.xxx.",
  "x..x..x...x.x...",
];

const parse = (rows: string[]) => rows.map((row) => [...row].map((c) => c === "x"));

// The homepage uses the defaults; another page can hand it its own beat: four
// rows of sixteen ("x" is a hit), a bpm, and the blip lane's semitones.
export type ToyProps = { bpm?: number; blip?: number[]; start?: string[] };

function noiseBuffer(ctx: AudioContext): AudioBuffer {
  const buf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

// A second of silence as a WAV, for the <audio> element that keeps iOS's
// session in playback mode (see start()).
let silentUrl = "";
function silentWavUrl(): string {
  if (silentUrl) return silentUrl;
  const rate = 8000;
  const buf = new ArrayBuffer(44 + rate);
  const v = new DataView(buf);
  const str = (o: number, t: string) => [...t].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF"); v.setUint32(4, 36 + rate, true); str(8, "WAVE"); str(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
  str(36, "data"); v.setUint32(40, rate, true);
  new Uint8Array(buf, 44).fill(0x80); // unsigned 8-bit silence
  silentUrl = URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
  return silentUrl;
}

// iOS wants a real node to have run through the destination inside the tap
// before it will pump the graph: a one-sample buffer, and an inaudible blip.
function unlockIOS(ctx: AudioContext) {
  try {
    const src = ctx.createBufferSource();
    src.buffer = ctx.createBuffer(1, 1, 22050);
    src.connect(ctx.destination);
    src.start(0);
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    g.gain.value = 0.00001;
    osc.connect(g).connect(ctx.destination);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.03);
  } catch {}
}

function voice(ctx: AudioContext, out: AudioNode, noise: AudioBuffer, lane: number, step: number, t: number, blip: number[]) {
  const g = ctx.createGain();
  g.connect(out);
  if (lane === 0) {
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    g.gain.setValueAtTime(1, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    o.connect(g);
    o.start(t);
    o.stop(t + 0.36);
    return;
  }
  if (lane === 3) {
    const o = ctx.createOscillator();
    o.type = "square";
    o.frequency.value = 220 * 2 ** (blip[step] / 12);
    const f = ctx.createBiquadFilter();
    f.frequency.setValueAtTime(3200, t);
    f.frequency.exponentialRampToValueAtTime(400, t + 0.15);
    f.Q.value = 8;
    g.gain.setValueAtTime(0.18, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    o.connect(f).connect(g);
    o.start(t);
    o.stop(t + 0.2);
    return;
  }
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const f = ctx.createBiquadFilter();
  f.type = lane === 1 ? "bandpass" : "highpass";
  f.frequency.value = lane === 1 ? 1800 : 7000;
  const len = lane === 1 ? 0.16 : 0.05;
  g.gain.setValueAtTime(lane === 1 ? 0.7 : 0.35, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + len);
  src.connect(f).connect(g);
  src.start(t, Math.random() * 0.3);
  src.stop(t + len + 0.01);
}

export default function Toy({ bpm = DEFAULT_BPM, blip = DEFAULT_BLIP, start: start0 = DEFAULT_START }: ToyProps = {}) {
  const [grid, setGrid] = useState(() => parse(start0));
  const [playing, setPlaying] = useState(false);
  const [now, setNow] = useState(-1);
  const gridRef = useRef(grid);
  gridRef.current = grid;
  const audio = useRef<{ ctx: AudioContext; out: GainNode; noise: AudioBuffer; hold: HTMLAudioElement | null } | null>(null);
  const timer = useRef<number | null>(null);
  const blipNow = useRef(blip);
  blipNow.current = blip;

  const stop = useCallback(() => {
    if (timer.current !== null) clearInterval(timer.current);
    timer.current = null;
    audio.current?.hold?.pause();
    setPlaying(false);
    setNow(-1);
  }, []);

  const start = useCallback(() => {
    // Everything that needs the tap's user activation happens here,
    // synchronously, before any await: phones only let audio start inside the
    // gesture, and iOS also wants something to have actually played.
    let a = audio.current;
    if (!a || a.ctx.state === "closed") {
      const ctx = new AudioContext();
      const out = ctx.createGain();
      out.gain.value = 0.6;
      out.connect(ctx.destination);
      a = { ctx, out, noise: noiseBuffer(ctx), hold: a?.hold ?? null };
      audio.current = a;
    }
    const { ctx, out, noise } = a;
    void ctx.resume().catch(() => {});
    unlockIOS(ctx);
    // iOS mutes Web Audio while the ringer switch is off, unless a media
    // element is playing: a silent looping <audio> moves the session to
    // playback, which is what the studio does too.
    if (!a.hold) {
      try {
        const el = new Audio(silentWavUrl());
        el.loop = true;
        el.setAttribute("playsinline", "");
        a.hold = el;
      } catch {}
    }
    void a.hold?.play().catch(() => {});

    if (timer.current !== null) clearInterval(timer.current);
    const dur = 60 / bpm / 4;
    let step = 0;
    let at = ctx.currentTime + 0.06;
    // Schedule a little ahead of the clock, as the real transport does, so a
    // busy main thread cannot make the beat stumble. The clock does not
    // advance while the context is suspended, so a slow resume just delays
    // the first note instead of blocking the start.
    const tick = () => {
      if (ctx.state !== "running") void ctx.resume().catch(() => {});
      // A stalled page (a phone under load, a backgrounded tab) leaves `at`
      // in the past; skip what was missed rather than firing it in a burst.
      if (at < ctx.currentTime) at = ctx.currentTime + 0.05;
      while (at < ctx.currentTime + 0.12) {
        const s = step;
        gridRef.current.forEach((lane, i) => lane[s] && voice(ctx, out, noise, i, s, at, blipNow.current));
        const delay = Math.max(0, (at - ctx.currentTime) * 1000);
        setTimeout(() => setNow(s), delay);
        at += dur;
        step = (step + 1) % STEPS;
      }
    };
    tick();
    timer.current = window.setInterval(tick, 25);
    setPlaying(true);
  }, [bpm]);

  // Coming back to the tab (or a call ending) leaves the context suspended or
  // iOS's own "interrupted": try to resume, and again on the next touch.
  useEffect(() => {
    if (!playing) return;
    const wake = () => {
      const a = audio.current;
      if (!a || a.ctx.state === "running") return;
      void a.ctx.resume().catch(() => {});
      void a.hold?.play().catch(() => {});
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("pageshow", wake);
    window.addEventListener("pointerdown", wake, true);
    return () => {
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("pageshow", wake);
      window.removeEventListener("pointerdown", wake, true);
    };
  }, [playing]);

  useEffect(() => () => {
    if (timer.current !== null) clearInterval(timer.current);
    audio.current?.hold?.pause();
    void audio.current?.ctx.close();
  }, []);

  const toggle = (lane: number, step: number) =>
    setGrid((g) => g.map((row, i) => (i === lane ? row.map((v, j) => (j === step ? !v : v)) : row)));

  const shake = () =>
    setGrid(LANES.map((_, lane) =>
      Array.from({ length: STEPS }, (_, i) =>
        lane === 0 ? i % 4 === 0 || Math.random() < 0.12 : Math.random() < [0, 0.18, 0.5, 0.3][lane],
      ),
    ));

  return (
    <div className={styles.toy}>
      <div className={styles.toyBar}>
        <button
          type="button"
          className={`${styles.toyPlay} ${playing ? styles.isOn : ""}`}
          onClick={() => (playing ? stop() : start())}
          aria-pressed={playing}
        >
          {playing ? "■ stop" : "▶ play"}
        </button>
        <button type="button" className={styles.toyBtn} onClick={shake} title="roll a new beat">
          ⚄ shake it
        </button>
        <span className={styles.toyBpm}>{bpm} bpm</span>
      </div>
      <div className={styles.toyGrid} role="grid" aria-label="toy step sequencer">
        {LANES.map((name, lane) => (
          <div key={name} className={styles.toyRow} role="row">
            <span className={styles.toyLabel}>{name}</span>
            {grid[lane].map((on, step) => (
              <button
                key={step}
                type="button"
                role="gridcell"
                aria-label={`${name} step ${step + 1}`}
                aria-pressed={on}
                className={[
                  styles.toyStep,
                  on ? styles.isOn : "",
                  step === now ? styles.isNow : "",
                  step % 4 === 0 ? styles.isBeat : "",
                ].join(" ")}
                onClick={() => toggle(lane, step)}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
