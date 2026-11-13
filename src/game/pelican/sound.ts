// 声音：音效拼成的一条 mp3，加一段循环的背景音乐。两个文件都是 scripts/game-audio/pelican.py 用真实乐器采样渲染的，
// 只放在 OSS 的 personal_website_other/ 下面（scripts/game-audio/upload.py 传上去的），仓库和构建产物里都没有这两个文件。
// 一打开游戏页面就开始下载；浏览器不让页面自己出声，所以音频环境要等玩家点过「开始」才建，建好再解码

import marks from './audio/audio.json';

const OSS_DIR = 'https://zlhimage.oss-cn-guangzhou.aliyuncs.com/personal_website_other/game/pelican-ride';
// 重新生成音频以后 OSS 上是同名覆盖，地址后面的 ?v= 跟着变，所以可以永久缓存，也不会拿旧文件去配新的时间点。
// 网页是用 fetch 读进 Web Audio 的，桶上要有允许本站来源的跨域规则（2026-11-13 用户配好了）
const SFX_URL = `${OSS_DIR}/sfx_${marks.stamp}.mp3?v=${marks.version}`;
const BGM_URL = `${OSS_DIR}/bgm_${marks.stamp}.mp3?v=${marks.version}`;

export type SoundName = 'fish' | 'gold' | 'bolt' | 'ring' | 'pad' | 'spring' | 'bump' | 'jump' | 'land' | 'dash' | 'gate' | 'bell' | 'finish';

const STORE_KEY = 'nn-pelican-sound';
const MUSIC_VOLUME = 0.5;
const EFFECT_VOLUME = 0.9;
// 连着吃鱼时一条比一条高，隔了这么久（秒）没吃就从头数
const COMBO_SECONDS = 1.1;
const COMBO_STEPS = 6;
// mp3 解码后开头可能多出几十毫秒，每个音效多放这么一小段，尾巴才不会被切掉
const TAIL = 0.08;

const offsets = marks.sfx as Record<string, number[]>;

export interface Sound {
  // 进页面就调用：开始下载两个音频文件，这一步不出声，不需要玩家先点
  preload(): void;
  // 必须在点击事件里调用：建音频环境，把下载好的文件解码
  start(): void;
  play(name: SoundName, volume?: number): void;
  // 暂停和继续（游戏暂停、切走标签页时）
  pause(): void;
  resume(): void;
  readonly muted: boolean;
  setMuted(value: boolean): void;
  dispose(): void;
}

async function download(url: string): Promise<ArrayBuffer | null> {
  try {
    const response = await fetch(url);
    return response.ok ? await response.arrayBuffer() : null;
  } catch {
    // 读不到（图床连不上、断网）就没有声音，不影响玩
    return null;
  }
}

function loadMuted(): boolean {
  try {
    return localStorage.getItem(STORE_KEY) === 'off';
  } catch {
    return false;
  }
}

export function createSound(): Sound {
  let context: AudioContext | null = null;
  let master: GainNode | null = null;
  let effects: AudioBuffer | null = null;
  let music: AudioBufferSourceNode | null = null;
  let muted = loadMuted();
  let disposed = false;
  let combo = 0;
  let lastFish = -Infinity;
  // 音效还没下完时要的出发铃，下完补上
  let bellWaiting = false;
  // 两个文件各下载一次
  let files: { sfx: Promise<ArrayBuffer | null>; bgm: Promise<ArrayBuffer | null> } | null = null;

  const decode = async (file: Promise<ArrayBuffer | null>): Promise<AudioBuffer | null> => {
    try {
      const data = await file;
      if (!data || !context || disposed) return null;
      return await context.decodeAudioData(data);
    } catch {
      // 下不下来或者解不了码就没有声音，不影响玩
      return null;
    }
  };

  const startMusic = (buffer: AudioBuffer) => {
    if (!context || !master || disposed) return;
    const gain = context.createGain();
    gain.gain.value = MUSIC_VOLUME;
    gain.connect(master);
    music = context.createBufferSource();
    music.buffer = buffer;
    music.loop = true;
    // 文件里循环段前后各多留了半秒，循环点落在中间，解码多出来的那一点偏移就不会让接缝错位
    music.loopStart = marks.bgm.loopStart;
    music.loopEnd = marks.bgm.loopEnd;
    music.connect(gain);
    music.start(0, marks.bgm.loopStart);
  };

  return {
    preload() {
      if (disposed) return;
      files ??= { sfx: download(SFX_URL), bgm: download(BGM_URL) };
    },
    start() {
      if (disposed) return;
      if (context) {
        void context.resume();
        return;
      }
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      context = new Ctor();
      master = context.createGain();
      master.gain.value = muted ? 0 : 1;
      master.connect(context.destination);
      this.preload();
      if (!files) return;
      void decode(files.sfx).then((buffer) => {
        effects = buffer;
        if (bellWaiting) this.play('bell');
        bellWaiting = false;
      });
      void decode(files.bgm).then((buffer) => {
        if (buffer) startMusic(buffer);
      });
    },
    play(name, volume = 1) {
      if (!effects && name === 'bell') bellWaiting = true;
      if (!context || !master || !effects || muted) return;
      let clip: string = name;
      if (name === 'fish') {
        const now = context.currentTime;
        combo = now - lastFish < COMBO_SECONDS ? Math.min(COMBO_STEPS - 1, combo + 1) : 0;
        lastFish = now;
        clip = `fish${combo}`;
      }
      const mark = offsets[clip];
      if (!mark) return;
      const gain = context.createGain();
      gain.gain.value = EFFECT_VOLUME * volume;
      gain.connect(master);
      const source = context.createBufferSource();
      source.buffer = effects;
      source.connect(gain);
      source.start(0, mark[0], mark[1] + TAIL);
    },
    pause() {
      void context?.suspend();
    },
    resume() {
      void context?.resume();
    },
    get muted() {
      return muted;
    },
    setMuted(value) {
      muted = value;
      if (master && context) master.gain.setTargetAtTime(value ? 0 : 1, context.currentTime, 0.03);
      try {
        localStorage.setItem(STORE_KEY, value ? 'off' : 'on');
      } catch {
        // 存不进去就只在这一次有效
      }
    },
    dispose() {
      disposed = true;
      try {
        music?.stop();
      } catch {
        // 还没开始播的时候停它会抛错，不用管
      }
      void context?.close();
      context = null;
    },
  };
}
