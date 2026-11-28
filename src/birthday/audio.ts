// Web Audio 现场合成的八音盒：《Happy Birthday to You》旋律（公有领域）与吹灭蜡烛时的一串清脆风铃。
// 只在用户点击后创建 AudioContext，不加载任何音频文件。

type Note = [midi: number, beats: number];

// G 大调 3/4 拍，弱起两拍附点
const MELODY: Note[] = [
  [67, 0.75], [67, 0.25], [69, 1], [67, 1], [72, 1], [71, 2],
  [67, 0.75], [67, 0.25], [69, 1], [67, 1], [74, 1], [72, 2],
  [67, 0.75], [67, 0.25], [79, 1], [76, 1], [72, 1], [71, 1], [69, 2],
  [77, 0.75], [77, 0.25], [76, 1], [72, 1], [74, 1], [72, 2.5],
];

const BEAT = 0.52;

const freq = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

export interface MusicBox {
  playSong(onEnd?: () => void): void;
  stopSong(): void;
  chime(): void;
  readonly playing: boolean;
  dispose(): void;
}

export function createMusicBox(): MusicBox {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let songNodes: AudioScheduledSourceNode[] = [];
  let songTimer = 0;
  let playing = false;

  const ensure = () => {
    if (!ctx) {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = 0.32;
      // 简单的反馈延迟做出八音盒的余响，不用卷积混响文件
      const delay = ctx.createDelay(1);
      delay.delayTime.value = 0.23;
      const fb = ctx.createGain();
      fb.gain.value = 0.28;
      const wet = ctx.createGain();
      wet.gain.value = 0.32;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 5200;
      master.connect(lp);
      lp.connect(ctx.destination);
      lp.connect(delay);
      delay.connect(fb);
      fb.connect(delay);
      delay.connect(wet);
      wet.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return { ctx, out: master! };
  };

  // 八音盒音色：基频 + 高八度 + 带一点失谐的第五泛音，快起慢衰
  const pluck = (at: number, f: number, vel: number, store?: AudioScheduledSourceNode[]) => {
    const { ctx: c, out } = ensure();
    const g = c.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(vel, at + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0008, at + 1.6);
    g.connect(out);
    const partials: [number, number][] = [
      [1, 1],
      [2, 0.42],
      [5.04, 0.12],
    ];
    for (const [mul, amp] of partials) {
      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.value = f * mul;
      const pg = c.createGain();
      pg.gain.setValueAtTime(amp, at);
      if (mul > 1) pg.gain.exponentialRampToValueAtTime(0.0005, at + 0.5 / mul + 0.15);
      o.connect(pg);
      pg.connect(g);
      o.start(at);
      o.stop(at + 1.7);
      store?.push(o);
    }
  };

  return {
    get playing() {
      return playing;
    },
    playSong(onEnd) {
      const { ctx: c } = ensure();
      this.stopSong();
      playing = true;
      let t = c.currentTime + 0.08;
      for (const [midi, beats] of MELODY) {
        pluck(t, freq(midi), 0.55, songNodes);
        // 伴一个低八度的根音，让旋律更饱满
        if (beats >= 1) pluck(t, freq(midi - 12), 0.18, songNodes);
        t += beats * BEAT;
      }
      const total = (t - c.currentTime + 1.2) * 1000;
      songTimer = window.setTimeout(() => {
        playing = false;
        songNodes = [];
        onEnd?.();
      }, total);
    },
    stopSong() {
      window.clearTimeout(songTimer);
      for (const n of songNodes) {
        try {
          n.stop();
        } catch {
          /* 已经停止的节点再停会抛错，忽略即可 */
        }
      }
      songNodes = [];
      playing = false;
    },
    chime() {
      const { ctx: c } = ensure();
      const base = c.currentTime + 0.02;
      [84, 88, 91, 96, 91, 100].forEach((m, i) => pluck(base + i * 0.085, freq(m), 0.22));
    },
    dispose() {
      this.stopSong();
      void ctx?.close();
      ctx = null;
    },
  };
}
