// 声音：音效拼成的一条 mp3，加上每个场景一首循环的配乐。文件都是 scripts/game-audio/pelican.py 用真实乐器采样渲染的，
// 只放在 OSS 的 personal_website_other/ 下面（scripts/game-audio/upload.py 传上去的），仓库和构建产物里都没有。
// 一打开游戏页面就开始下载音效和头两个场景的配乐，后面的场景骑到前一段时再下；浏览器不让页面自己出声，
// 所以音频环境要等玩家点过「开始」才建，建好再解码

import marks from './audio/audio.json';

const OSS_DIR = 'https://zlhimage.oss-cn-guangzhou.aliyuncs.com/personal_website_other/game/pelican-ride';
// 重新生成音频以后 OSS 上是同名覆盖，地址后面的 ?v= 跟着变，所以可以永久缓存，也不会拿旧文件去配新的时间点。
// 网页是用 fetch 读进 Web Audio 的，桶上要有允许本站来源的跨域规则（2026-11-13 用户配好了）
const SFX_URL = `${OSS_DIR}/sfx_${marks.stamp}.mp3?v=${marks.version}`;
const songUrl = (slug: string) => `${OSS_DIR}/bgm_${slug}_${marks.stamp}.mp3?v=${marks.version}`;

export type SoundName = 'fish' | 'gold' | 'bolt' | 'ring' | 'pad' | 'spring' | 'bump' | 'jump' | 'land' | 'dash' | 'gate' | 'bell' | 'finish' | 'fall' | 'super';

const STORE_KEY = 'nn-pelican-sound';
// 用户嫌过「音乐有点大，音效也是，音效应该比音乐小一点」：配乐（钢琴、木管、弦乐那一版）平均响度约 -23.5 dB、音效约 -24 dB，
// 按这两个数配的音量，音效比音乐小 3 dB 左右
const MUSIC_VOLUME = 0.5;
const EFFECT_VOLUME = 0.38;
// 换场景时新旧两首交叉淡入淡出多久（秒）（用户要「切换要有个小过渡」）
const CROSSFADE = 3;
// 连着吃鱼时一条比一条高，隔了这么久（秒）没吃就从头数
const COMBO_SECONDS = 1.1;
const COMBO_STEPS = 6;
// mp3 解码后开头可能多出几十毫秒，每个音效多放这么一小段，尾巴才不会被切掉
const TAIL = 0.08;

const offsets = marks.sfx as Record<string, number[]>;
const songs = marks.songs as Record<string, { loopStart: number; loopEnd: number }>;
// 场景名 -> 配乐的短名
const sceneSongs = marks.scenes as Record<string, string>;

export interface Sound {
  // 进页面就调用：开始下载音效，这一步不出声，不需要玩家先点
  preload(): void;
  // 先把这几个场景的配乐下载下来（不出声）
  fetchScenes(names: readonly string[]): void;
  // 必须在点击事件里调用：建音频环境，把下载好的文件解码
  start(): void;
  // 换到这个场景的配乐，和正在放的那首交叉淡过去
  setScene(name: string): void;
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
  let muted = loadMuted();
  let disposed = false;
  let combo = 0;
  let lastFish = -Infinity;
  // 音效还没下完时要的出发铃，下完补上
  let bellWaiting = false;
  let sfxFile: Promise<ArrayBuffer | null> | null = null;
  // 每首配乐只下载一次、只解码一次
  const songFiles = new Map<string, Promise<ArrayBuffer | null>>();
  const songBuffers = new Map<string, Promise<AudioBuffer | null>>();
  // 现在应该放哪一首、正在放的是哪一首
  let wanted = '';
  let playing: { slug: string; source: AudioBufferSourceNode; gain: GainNode } | null = null;

  const decode = async (file: Promise<ArrayBuffer | null>): Promise<AudioBuffer | null> => {
    try {
      const data = await file;
      if (!data || !context || disposed) return null;
      // 解码会把交进去的数据拿走，交一份复制的，原件留着
      return await context.decodeAudioData(data.slice(0));
    } catch {
      // 下不下来或者解不了码就没有声音，不影响玩
      return null;
    }
  };

  const fetchSong = (slug: string) => {
    if (!songs[slug]) return null;
    let file = songFiles.get(slug);
    if (!file) {
      file = download(songUrl(slug));
      songFiles.set(slug, file);
    }
    return file;
  };

  const bufferOf = (slug: string) => {
    let buffer = songBuffers.get(slug);
    const file = fetchSong(slug);
    if (!buffer && file && context) {
      buffer = decode(file);
      songBuffers.set(slug, buffer);
    }
    return buffer ?? null;
  };

  // 新的一首从零淡进来，旧的那首淡出去再停掉
  const switchTo = (slug: string, buffer: AudioBuffer) => {
    if (!context || !master || disposed || playing?.slug === slug) return;
    const now = context.currentTime;
    if (playing) {
      const old = playing;
      old.gain.gain.cancelScheduledValues(now);
      old.gain.gain.setValueAtTime(old.gain.gain.value, now);
      old.gain.gain.linearRampToValueAtTime(0, now + CROSSFADE);
      old.source.stop(now + CROSSFADE + 0.05);
    }
    const loop = songs[slug];
    const gain = context.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(MUSIC_VOLUME, now + (playing ? CROSSFADE : 1.2));
    gain.connect(master);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    // 文件里循环段前后各多留了半秒，循环点落在中间，解码多出来的那一点偏移就不会让接缝错位
    source.loopStart = loop.loopStart;
    source.loopEnd = loop.loopEnd;
    source.connect(gain);
    source.start(now, loop.loopStart);
    playing = { slug, source, gain };
  };

  const follow = () => {
    const slug = wanted;
    const buffer = slug ? bufferOf(slug) : null;
    if (!buffer) return;
    void buffer.then((ready) => {
      // 解码完的时候可能已经又换了场景，那就不放这一首了
      if (ready && wanted === slug) switchTo(slug, ready);
    });
  };

  return {
    preload() {
      if (disposed) return;
      sfxFile ??= download(SFX_URL);
    },
    fetchScenes(names) {
      if (disposed) return;
      for (const name of names) {
        const slug = sceneSongs[name];
        if (slug) fetchSong(slug);
      }
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
      if (sfxFile) {
        void decode(sfxFile).then((buffer) => {
          effects = buffer;
          if (bellWaiting) this.play('bell');
          bellWaiting = false;
        });
      }
      follow();
    },
    setScene(name) {
      const slug = sceneSongs[name] ?? '';
      if (slug === wanted) return;
      wanted = slug;
      follow();
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
        playing?.source.stop();
      } catch {
        // 还没开始播的时候停它会抛错，不用管
      }
      void context?.close();
      context = null;
    },
  };
}
