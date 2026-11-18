// 星海漫游的声音：两首循环配乐（星际航行一首、靠近黑洞一首，交叉淡过去）加一条拼起来的音效。
// 都是 scripts/game-audio/cosmic.py 用真实乐器采样（钢琴、竖琴、弦乐、大提琴）渲染的，不用手算波形（用户在鹈鹕骑车就嫌过机械），
// 只放在 OSS 的 personal_website_other/game/cosmic-roam/ 下面（scripts/game-audio/upload.py --game cosmic 传上去的），仓库里只有 audio.json。
// 页面一打开就下载（开场加载条等它，见 game.ts），浏览器不让页面自己出声，音频环境等玩家点「开始」才建，建好再解码

import marks from './audio/audio.json';
import { createAudioCache } from '../audio-cache';

const OSS_DIR = 'https://zlhimage.oss-cn-guangzhou.aliyuncs.com/personal_website_other/game/cosmic-roam';
// 重新生成音频以后 OSS 上是同名覆盖，地址后面的 ?v= 跟着变，可以永久缓存，也不会拿旧文件去配新的时间点
const fileUrl = (name: string) => `${OSS_DIR}/${name}_${marks.stamp}.mp3?v=${marks.version}`;

// 音量（2026-11-18 用户要的「音效小一点、不影响音乐，音乐也不要太大」）：两首配乐渲染出来平均约 -26 dB，比鹈鹕的再轻一点；
// 音效比音乐小八九分贝，还走一条削高频、轻压缩的总线
const MUSIC_VOLUME = 0.36;
const EFFECT_VOLUME = 0.12;
const EFFECT_LOWPASS = 3200;
// 换曲时新旧两首交叉淡多久（秒）
const CROSSFADE = 4;
// 进出星系要稳定这么久才换曲，免得在边界上来回切
const SWITCH_HOLD = 1.5;
// 同一种音效离上一下太近就不响（秒）
const MIN_GAP = 0.06;

const cache = createAudioCache('cosmic-audio-', marks.version);
// 每个音效：从第几秒开始、多长
const sfxMarks: Record<string, number[]> = marks.sfx;
const songs = marks.songs as Record<string, { loopStart: number; loopEnd: number }>;
type Song = 'cosmos' | 'galaxy';

export interface CosmicAudio {
  // 开始下载全部音频，progress 报 0 到 1；下完（或者下不了）就 resolve
  preload: (progress: (part: number) => void) => Promise<void>;
  unlock: () => void;
  setMuted: (muted: boolean) => void;
  isMuted: () => boolean;
  setPaused: (paused: boolean) => void;
  // 在不在星系里决定放哪首配乐；boostFactor 没有声音（加速不出声，鹈鹕骑车用户嫌过加速的沙沙声）
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
  let musicBus: GainNode | null = null;
  let effectBus: GainNode | null = null;
  let effects: AudioBuffer | null = null;
  let muted = false;
  let paused = false;
  let disposed = false;

  const files = new Map<string, Promise<ArrayBuffer | null>>();
  const buffers = new Map<string, Promise<AudioBuffer | null>>();
  const lastPlayed = new Map<string, number>();

  let wanted: Song = 'cosmos';
  let pending: Song = 'cosmos';
  let pendingSince = 0;
  let playing: { song: Song; source: AudioBufferSourceNode; gain: GainNode } | null = null;
  let switching = 0;

  const fetchFile = (name: string, progress?: (part: number) => void) => {
    let file = files.get(name);
    if (!file) {
      file = cache.download(fileUrl(name), progress);
      files.set(name, file);
    } else {
      void file.then(() => progress?.(1));
    }
    return file;
  };

  const decode = (name: string): Promise<AudioBuffer | null> => {
    let buffer = buffers.get(name);
    if (!buffer) {
      buffer = (async () => {
        try {
          const data = await fetchFile(name);
          if (!data || !ctx || disposed) return null;
          // 解码会把交进去的数据拿走，交一份复制的，原件留着
          return await ctx.decodeAudioData(data.slice(0));
        } catch {
          // 解不了码就没有声音，不影响玩
          return null;
        }
      })();
      buffers.set(name, buffer);
    }
    return buffer;
  };

  function applyMasterGain() {
    if (!ctx || !master) return;
    master.gain.setTargetAtTime(muted || paused ? 0 : 1, ctx.currentTime, 0.08);
  }

  // 让正在放的那首和 wanted 对上：没在放就淡入，放的是另一首就交叉淡过去
  async function follow() {
    if (!ctx || !musicBus || disposed) return;
    const song = wanted;
    if (playing?.song === song) return;
    const ticket = ++switching;
    const buffer = await decode(`bgm_${song}`);
    if (!buffer || !ctx || !musicBus || disposed || ticket !== switching || wanted !== song) return;
    const now = ctx.currentTime;
    const old = playing;
    if (old) {
      old.gain.gain.cancelScheduledValues(now);
      old.gain.gain.setValueAtTime(old.gain.gain.value, now);
      old.gain.gain.linearRampToValueAtTime(0, now + CROSSFADE);
      old.source.stop(now + CROSSFADE + 0.05);
    }
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(1, now + (old ? CROSSFADE : 2.5));
    gain.connect(musicBus);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const loop = songs[song];
    source.loopStart = loop.loopStart;
    source.loopEnd = loop.loopEnd;
    source.connect(gain);
    source.start(now, loop.loopStart);
    playing = { song, source, gain };
  }

  function play(name: string, volume = 1, delay = 0) {
    if (!ctx || !effectBus || !effects || muted || paused) return;
    const mark = sfxMarks[name];
    if (!mark) return;
    const now = ctx.currentTime;
    if (now - (lastPlayed.get(name) ?? -Infinity) < MIN_GAP) return;
    lastPlayed.set(name, now);
    const source = ctx.createBufferSource();
    source.buffer = effects;
    const gain = ctx.createGain();
    gain.gain.value = volume;
    source.connect(gain);
    gain.connect(effectBus);
    source.start(now + delay, mark[0], mark[1]);
  }

  return {
    async preload(progress) {
      if (disposed) return;
      void cache.dropOld();
      const names = ['sfx', ...Object.keys(songs).map((slug) => `bgm_${slug}`)];
      const parts = names.map(() => 0);
      const report = (index: number) => (part: number) => {
        parts[index] = part;
        progress(parts.reduce((sum, value) => sum + value, 0) / parts.length);
      };
      await Promise.all(names.map((name, i) => fetchFile(name, report(i))));
      progress(1);
    },
    unlock() {
      if (disposed) return;
      if (ctx) {
        if (ctx.state === 'suspended') void ctx.resume();
        return;
      }
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      ctx = new Ctor();
      master = ctx.createGain();
      master.gain.value = muted || paused ? 0 : 1;
      master.connect(ctx.destination);
      musicBus = ctx.createGain();
      musicBus.gain.value = MUSIC_VOLUME;
      musicBus.connect(master);
      // 音效总线：音量、削高频、轻轻压一下
      effectBus = ctx.createGain();
      effectBus.gain.value = EFFECT_VOLUME;
      const soften = ctx.createBiquadFilter();
      soften.type = 'lowpass';
      soften.frequency.value = EFFECT_LOWPASS;
      soften.Q.value = 0.5;
      const squeeze = ctx.createDynamicsCompressor();
      squeeze.threshold.value = -20;
      squeeze.knee.value = 12;
      squeeze.ratio.value = 4;
      squeeze.attack.value = 0.004;
      squeeze.release.value = 0.25;
      effectBus.connect(soften);
      soften.connect(squeeze);
      squeeze.connect(master);
      void decode('sfx').then((buffer) => {
        effects = buffer;
      });
      void follow();
    },
    setMuted(next) {
      muted = next;
      applyMasterGain();
    },
    isMuted() {
      return muted;
    },
    setPaused(next) {
      paused = next;
      applyMasterGain();
    },
    updatePad(inGalaxy) {
      if (!ctx) return;
      const song: Song = inGalaxy ? 'galaxy' : 'cosmos';
      const now = ctx.currentTime;
      if (song !== pending) {
        pending = song;
        pendingSince = now;
      }
      if (pending !== wanted && now - pendingSince >= SWITCH_HOLD) {
        wanted = pending;
        void follow();
      }
    },
    ring(combo) {
      const index = Math.min(Math.max(combo - 1, 0), 6);
      play(`ring${index}`, 0.85);
    },
    relic(collected, galaxyDone) {
      const index = Math.min(Math.max(collected - 1, 0), 5);
      play(`relic${index}`);
      if (galaxyDone) play('hub', 1, 0.35);
    },
    slingshot() {
      play('slingshot', 0.9);
    },
    // 加速和受击不出声：加速在鹈鹕骑车里被用户嫌过「沙沙声」；这个游戏里没有受击
    warp() {},
    hurt() {},
    finish() {
      play('finish');
    },
    dispose() {
      disposed = true;
      if (ctx) void ctx.close();
      ctx = null;
      master = null;
      musicBus = null;
      effectBus = null;
      effects = null;
      playing = null;
    },
  };
}
