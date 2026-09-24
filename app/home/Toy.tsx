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
const BPM = 118;
// A minor pentatonic, one note per step, so the blip lane can never be wrong.
const BLIP = [0, 3, 5, 7, 10, 12, 10, 7, 5, 3, 0, 7, 12, 15, 12, 7];

const START: boolean[][] = [
  "x...x...x...x..x",
  "....x.......x...",
  "..x.x.x.x.x.xxx.",
  "x..x..x...x.x...",
].map((row) => [...row].map((c) => c === "x"));

function noiseBuffer(ctx: AudioContext): AudioBuffer {
  const buf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

function voice(ctx: AudioContext, out: AudioNode, noise: AudioBuffer, lane: number, step: number, t: number) {
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
    o.frequency.value = 220 * 2 ** (BLIP[step] / 12);
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

export default function Toy() {
  const [grid, setGrid] = useState(START);
  const [playing, setPlaying] = useState(false);
  const [now, setNow] = useState(-1);
  const gridRef = useRef(grid);
  gridRef.current = grid;
  const audio = useRef<{ ctx: AudioContext; out: GainNode; noise: AudioBuffer } | null>(null);
  const timer = useRef<number | null>(null);

  const stop = useCallback(() => {
    if (timer.current !== null) clearInterval(timer.current);
    timer.current = null;
    setPlaying(false);
    setNow(-1);
  }, []);

  const start = useCallback(async () => {
    if (!audio.current) {
      const ctx = new AudioContext();
      const out = ctx.createGain();
      out.gain.value = 0.6;
      out.connect(ctx.destination);
      audio.current = { ctx, out, noise: noiseBuffer(ctx) };
    }
    const { ctx, out, noise } = audio.current;
    await ctx.resume();
    const dur = 60 / BPM / 4;
    let step = 0;
    let at = ctx.currentTime + 0.06;
    // Schedule a little ahead of the clock, as the real transport does, so a
    // busy main thread cannot make the beat stumble.
    const tick = () => {
      while (at < ctx.currentTime + 0.12) {
        const s = step;
        gridRef.current.forEach((lane, i) => lane[s] && voice(ctx, out, noise, i, s, at));
        const delay = Math.max(0, (at - ctx.currentTime) * 1000);
        setTimeout(() => setNow(s), delay);
        at += dur;
        step = (step + 1) % STEPS;
      }
    };
    tick();
    timer.current = window.setInterval(tick, 25);
    setPlaying(true);
  }, []);

  useEffect(() => () => {
    if (timer.current !== null) clearInterval(timer.current);
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
          onClick={() => (playing ? stop() : void start())}
          aria-pressed={playing}
        >
          {playing ? "■ stop" : "▶ play"}
        </button>
        <button type="button" className={styles.toyBtn} onClick={shake} title="roll a new beat">
          ⚄ shake it
        </button>
        <span className={styles.toyBpm}>{BPM} bpm</span>
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
