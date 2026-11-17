// 轻量宇宙音效系统（全手写 Web Audio 柔和过滤波形，零外部下载，无刺耳高频）

const PENTATONIC = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25, 783.99];

export interface CosmicAudio {
  unlock: () => void;
  setMuted: (muted: boolean) => void;
  isMuted: () => boolean;
  setPaused: (paused: boolean) => void;
  updatePad: (inGalaxy: boolean, boostFactor: number) => void;
  ring: (combo: number) => void;
  relic: (collected: number, galaxyDone: boolean) => void;
  slingshot: () => void;
  warp: () => void;
  hurt: () => void;
  finish: (won: boolean) => void;
  dispose: () => void;
}

export function createCosmicAudio(): CosmicAudio {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let padGain: GainNode | null = null;
  let padFilter: BiquadFilterNode | null = null;
  let muted = false;
  let paused = false;
  let padStarted = false;

  function ensureContext() {
    if (ctx) return ctx;
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted || paused ? 0 : 0.24;
    master.connect(ctx.destination);
    return ctx;
  }

  function startPad(ac: AudioContext) {
    if (padStarted || !master) return;
    padStarted = true;
    padFilter = ac.createBiquadFilter();
    padFilter.type = 'lowpass';
    padFilter.frequency.value = 340;
    padFilter.Q.value = 0.7;

    padGain = ac.createGain();
    padGain.gain.value = 0.08;
    padFilter.connect(padGain);
    padGain.connect(master);

    for (const [freq, type, detune] of [
      [65.41, 'sine', 0],
      [98.0, 'triangle', 4],
      [130.81, 'sine', -5],
    ] as const) {
      const osc = ac.createOscillator();
      osc.type = type;
      osc.frequency.value = freq;
      osc.detune.value = detune;
      osc.connect(padFilter);
      osc.start();
    }
  }

  function unlock() {
    const ac = ensureContext();
    if (!ac) return;
    if (ac.state === 'suspended') {
      void ac.resume();
    }
    startPad(ac);
  }

  function applyMasterGain() {
    if (!ctx || !master) return;
    const target = muted || paused ? 0 : 0.24;
    master.gain.setTargetAtTime(target, ctx.currentTime, 0.06);
  }

  function setMuted(next: boolean) {
    muted = next;
    applyMasterGain();
  }

  function isMuted() {
    return muted;
  }

  function setPaused(next: boolean) {
    paused = next;
    applyMasterGain();
  }

  function updatePad(inGalaxy: boolean, boostFactor: number) {
    if (!ctx || !padFilter || !padGain || muted || paused) return;
    const cutoff = (inGalaxy ? 280 : 380) + Math.min(boostFactor, 1.5) * 420;
    padFilter.frequency.setTargetAtTime(cutoff, ctx.currentTime, 0.12);
    padGain.gain.setTargetAtTime(0.065 + Math.min(boostFactor, 1.2) * 0.055, ctx.currentTime, 0.12);
  }

  function playNote(freq: number, dur: number, vol: number, type: OscillatorType = 'sine', cutoff = 1800) {
    if (!ctx || !master || muted || paused) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(cutoff, now);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(vol, now + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    osc.connect(filter);
    filter.connect(g);
    g.connect(master);
    osc.start(now);
    osc.stop(now + dur + 0.03);
  }

  function ring(combo: number) {
    if (!ctx || muted || paused) return;
    const idx = Math.min(Math.max(combo - 1, 0), PENTATONIC.length - 1);
    const f = PENTATONIC[idx];
    playNote(f, 0.26, 0.18, 'triangle', 1700);
    playNote(f * 1.5, 0.34, 0.08, 'sine', 2100);
  }

  function relic(collected: number, galaxyDone: boolean) {
    if (!ctx || muted || paused) return;
    const base = PENTATONIC[Math.min(collected, PENTATONIC.length - 1)];
    playNote(base, 0.32, 0.22, 'sine', 2200);
    window.setTimeout(() => playNote(base * 1.25, 0.4, 0.16, 'triangle', 2200), 65);
    if (galaxyDone) {
      window.setTimeout(() => playNote(523.25, 0.55, 0.22, 'sine', 2400), 140);
      window.setTimeout(() => playNote(659.25, 0.65, 0.2, 'sine', 2400), 240);
      window.setTimeout(() => playNote(783.99, 0.8, 0.18, 'sine', 2400), 340);
    }
  }

  function whoosh(f0: number, f1: number, dur: number, vol: number) {
    if (!ctx || !master || muted || paused) return;
    const ac = ctx;
    const len = Math.floor(ac.sampleRate * dur);
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = ac.createBufferSource();
    src.buffer = buf;

    const filter = ac.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 1.6;
    const now = ac.currentTime;
    filter.frequency.setValueAtTime(f0, now);
    filter.frequency.exponentialRampToValueAtTime(f1, now + dur);

    const g = ac.createGain();
    g.gain.setValueAtTime(0.001, now);
    g.gain.exponentialRampToValueAtTime(vol, now + dur * 0.22);
    g.gain.exponentialRampToValueAtTime(0.001, now + dur);

    src.connect(filter);
    filter.connect(g);
    g.connect(master);
    src.start(now);
    src.stop(now + dur + 0.02);
  }

  function slingshot() {
    whoosh(180, 920, 0.65, 0.24);
    playNote(329.63, 0.45, 0.14, 'sine', 1600);
  }

  function warp() {
    whoosh(130, 740, 0.52, 0.2);
  }

  function hurt() {
    playNote(110, 0.28, 0.26, 'triangle', 480);
    playNote(82.41, 0.34, 0.22, 'sine', 360);
  }

  function finish(won: boolean) {
    if (won) {
      [261.63, 329.63, 392.0, 523.25, 659.25].forEach((f, i) => {
        window.setTimeout(() => playNote(f, 0.7, 0.18, 'sine', 2400), i * 90);
      });
    } else {
      playNote(220, 0.4, 0.18, 'sine', 900);
      window.setTimeout(() => playNote(164.81, 0.55, 0.16, 'sine', 700), 140);
    }
  }

  function dispose() {
    if (ctx) {
      void ctx.close();
      ctx = null;
      master = null;
      padGain = null;
      padFilter = null;
      padStarted = false;
    }
  }

  return { unlock, setMuted, isMuted, setPaused, updatePad, ring, relic, slingshot, warp, hurt, finish, dispose };
}
