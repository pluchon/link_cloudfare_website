// 合成音效：有点闷的「噔」，像敲在软木上。连着合成一次升一个音，升到第八个音就停在那里。
// 做法：三角波起音时高一点、30ms 内落到音高（敲击感），过一道低通把亮的泛音削掉（闷），
// 再垫一个低八度的正弦（厚），整体 0.3 秒左右收掉。音阶用五声音阶，连着噔也不刺耳。
const STEPS = [0, 2, 4, 7, 9, 12, 14, 16];
const BASE = 196;
const COMBO_GAP = 1.2;

export function createDing() {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let combo = 0;
  let last = -Infinity;
  let muted = false;

  function ensure() {
    if (ctx) return ctx;
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = 0.4;
    master.connect(ctx.destination);
    return ctx;
  }

  function voice(type: OscillatorType, freq: number, gain: number, start: number, length: number, cutoff: number) {
    if (!ctx || !master) return;
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const env = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq * 1.35, start);
    osc.frequency.exponentialRampToValueAtTime(freq, start + 0.03);
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    filter.Q.value = 0.6;
    env.gain.setValueAtTime(0.0001, start);
    env.gain.exponentialRampToValueAtTime(gain, start + 0.005);
    env.gain.exponentialRampToValueAtTime(0.0001, start + length);
    osc.connect(filter).connect(env).connect(master);
    osc.start(start);
    osc.stop(start + length + 0.02);
  }

  return {
    // 浏览器要求声音在用户操作里解锁，所以第一次按下时调一次
    unlock() {
      const c = ensure();
      if (c && c.state === 'suspended') void c.resume();
    },
    play() {
      const c = ensure();
      if (!c || muted) return;
      const now = c.currentTime;
      combo = now - last < COMBO_GAP ? Math.min(combo + 1, STEPS.length - 1) : 0;
      last = now;
      const freq = BASE * 2 ** (STEPS[combo] / 12);
      voice('triangle', freq, 0.9, now, 0.32, 900 + freq);
      voice('sine', freq / 2, 0.6, now, 0.26, 600);
    },
    setMuted(value: boolean) {
      muted = value;
    },
    close() {
      void ctx?.close();
      ctx = null;
      master = null;
    },
  };
}
