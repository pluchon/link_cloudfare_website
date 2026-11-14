// 声音：音效拼成的一条 mp3，加上每个场景一首循环的配乐，再加一层很小声的自然音。文件都是 scripts/game-audio/pelican.py 用真实乐器采样渲染的，
// 只放在 OSS 的 personal_website_other/ 下面（scripts/game-audio/upload.py 传上去的），仓库和构建产物里都没有。
// 一打开游戏页面就开始下载音效和头两个场景的配乐，后面的场景骑到前一段时再下；浏览器不让页面自己出声，
// 所以音频环境要等玩家点过「开始」才建，建好再解码

import marks from './audio/audio.json';

const OSS_DIR = 'https://zlhimage.oss-cn-guangzhou.aliyuncs.com/personal_website_other/game/pelican-ride';
// 重新生成音频以后 OSS 上是同名覆盖，地址后面的 ?v= 跟着变，所以可以永久缓存，也不会拿旧文件去配新的时间点。
// 网页是用 fetch 读进 Web Audio 的，桶上要有允许本站来源的跨域规则（2026-11-13 用户配好了）
const SFX_URL = `${OSS_DIR}/sfx_${marks.stamp}.mp3?v=${marks.version}`;
const songUrl = (slug: string) => `${OSS_DIR}/bgm_${slug}_${marks.stamp}.mp3?v=${marks.version}`;

export type SoundName = 'fish' | 'gold' | 'bolt' | 'ring' | 'pad' | 'spring' | 'bump' | 'jump' | 'land' | 'gate' | 'bell' | 'finish' | 'fall' | 'super';

const STORE_KEY = 'nn-pelican-sound';
// 音量：用户三次说过大小。2026-11-14 那次说「背景音乐有一点点大；音效是重灾区，抢了背景音乐，音效要比背景音乐还小」。
// 配乐和音效渲染出来的平均响度差不多（-23 到 -25 dB），所以这里的倍数就是真正的大小关系：音效比音乐小七八分贝，自然音再小一截
// 2026-11-14 第四次：「音效声音太大了」，音效再往下压了三四分贝
const MUSIC_VOLUME = 0.4;
const EFFECT_VOLUME = 0.14;
// 各个音效之间的大小（2026-11-14 用户定的层次）：背景音乐为主；捡东西、连续穿圈、右下角道具这些次之；
// 落地、起跳、弹簧、撞东西、过门、出发铃这些尽量小，但不能没有。用户嫌过「很多音效大了，拾取音效反而小了」
const LEVELS: Record<SoundName, number> = {
  fish: 1,
  gold: 1,
  ring: 1,
  // 能量罐那一声渲染出来比捡鱼响五六分贝，倍数给小一点
  bolt: 0.6,
  super: 0.75,
  finish: 0.6,
  fall: 0.4,
  bump: 0.4,
  gate: 0.35,
  bell: 0.35,
  spring: 0.3,
  pad: 0.28,
  jump: 0.25,
  land: 0.22,
};
// 自然音单独一条总线，不跟着音效的总音量走
const NATURE_VOLUME = 0.18;
// 音效总线最后再削一刀高频、过一道轻轻的压缩，好几个音效叠在一起时不会一下子冲上去
const EFFECT_LOWPASS = 3200;
// 换场景时新旧两首交叉淡入淡出多久（秒）（用户要「切换要有个小过渡」）；自然音跟着一起换
const CROSSFADE = 3;
// 连着吃鱼：音高在一组五声音阶里一上一下地走（原来一路往上爬到最高那个音就不下来，吃一串鱼尖得刺耳）；隔了这么久（秒）没吃就从头数
const COMBO_SECONDS = 1.1;
const COMBO_STEPS = 6;
// 捡东西捡得密（用户嫌「拾取很多会很吵」）：离上一个同类不到这么久（秒）的直接不响；最近这么久（秒）里每多捡一个，音量再打一次折扣，最低压到这么多
const PICK_GAP = 0.07;
const PICK_WINDOW = 0.9;
const PICK_DUCK = 0.12;
const PICK_FLOOR = 0.55;
// mp3 解码后开头可能多出几十毫秒，每个音效多放这么一小段，尾巴才不会被切掉
const TAIL = 0.08;

const offsets = marks.sfx as Record<string, number[]>;
const songs = marks.songs as Record<string, { loopStart: number; loopEnd: number }>;
// 场景名 -> 配乐的短名、配乐的主音（键号）
const sceneSongs = marks.scenes as Record<string, string>;
const sceneKeys = (marks as { keys?: Record<string, number> }).keys ?? {};

// 每个场景捡东西、进场景的声音不一样（2026-11-14 用户要的「每个场景拾取的音效、场景切换的音效都有些许不同」）：
// 捡鱼换一样乐器，进场景换一种声音，再整体移到这个场景配乐的调上（最多移半个八度，不会移得太尖）
// 捡鱼只用拨的、敲的几样（单簧管的短音、手钟的纯音听起来是「哔」，用户嫌不好听）
type PickupVoice = 'harp' | 'kalimba' | 'marimba' | 'piano';
type GateVoice = 'chimes' | 'harp' | 'piano' | 'marimba' | 'bell' | 'flute';
const VOICES: Record<string, [PickupVoice, GateVoice]> = {
  海滨晨光: ['kalimba', 'harp'],
  花田风车: ['marimba', 'flute'],
  樱花大道: ['harp', 'harp'],
  松林小屋: ['marimba', 'marimba'],
  秋日山谷: ['piano', 'piano'],
  沙漠峡谷: ['kalimba', 'bell'],
  棕榈晚霞: ['marimba', 'marimba'],
  灯塔夜海: ['harp', 'chimes'],
  霓虹都市: ['piano', 'piano'],
  极光雪原: ['kalimba', 'bell'],
  雪山黎明: ['harp', 'chimes'],
  气球之丘: ['piano', 'flute'],
  高山峡谷: ['marimba', 'bell'],
  溪谷飞瀑: ['harp', 'harp'],
  水晶洞穴: ['kalimba', 'chimes'],
  云海断桥: ['harp', 'flute'],
};
// 音效是按 C 调渲染的，移到这个场景的调上要放快放慢多少
function keyRate(scene: string): number {
  const key = sceneKeys[scene];
  if (key === undefined) return 1;
  let shift = (((key - 60) % 12) + 12) % 12;
  if (shift > 6) shift -= 12;
  return 2 ** (shift / 12);
}

// 每个场景的自然音（2026-11-14 用户要的「适当加一点自然音，比如动物声、树叶沙沙声，声音很小，不影响主音效」）。
// 数都是 0 到 1：风、树叶沙沙、流水、虫鸣、城市里远远的嗡嗡声是噪声现做的，一直响；海浪、鸟叫是录音，隔一阵响一次，数是多密；滴水是洞里的「嘀嗒」
interface Nature {
  wind?: number;
  leaves?: number;
  water?: number;
  crickets?: number;
  city?: number;
  waves?: number;
  birds?: number;
  drips?: number;
}
const NATURE: Record<string, Nature> = {
  海滨晨光: { waves: 1, birds: 0.5, wind: 0.3 },
  花田风车: { birds: 0.8, leaves: 0.4, wind: 0.3 },
  樱花大道: { birds: 0.7, leaves: 0.5, wind: 0.2 },
  松林小屋: { birds: 0.6, leaves: 0.8, wind: 0.4 },
  秋日山谷: { leaves: 0.9, wind: 0.5, birds: 0.3 },
  沙漠峡谷: { wind: 0.9 },
  棕榈晚霞: { waves: 0.8, leaves: 0.4, birds: 0.2, wind: 0.2 },
  灯塔夜海: { waves: 0.9, crickets: 0.4, wind: 0.3 },
  霓虹都市: { city: 0.8 },
  极光雪原: { wind: 0.8 },
  雪山黎明: { wind: 0.7, birds: 0.15 },
  气球之丘: { birds: 0.7, wind: 0.4, leaves: 0.3 },
  高山峡谷: { wind: 0.6, water: 0.3, birds: 0.3 },
  溪谷飞瀑: { water: 1, birds: 0.6, leaves: 0.3 },
  水晶洞穴: { drips: 1, wind: 0.15 },
  云海断桥: { wind: 0.9, water: 0.25, birds: 0.2 },
};

export interface Sound {
  // 进页面就调用：开始下载音效，这一步不出声，不需要玩家先点
  preload(): void;
  // 进页面就调用：音效和全部配乐都下下来（缓存里有的直接拿），progress 报 0 到 1 的进度，全部下完（或者下不了）时兑现
  preloadAll(progress: (part: number) => void): Promise<void>;
  // 先把这几个场景的配乐下载下来（不出声）
  fetchScenes(names: readonly string[]): void;
  // 必须在点击事件里调用：建音频环境，把下载好的文件解码
  start(): void;
  // 换到这个场景的配乐和自然音，和正在放的交叉淡过去
  setScene(name: string): void;
  play(name: SoundName, volume?: number): void;
  // 暂停和继续（游戏暂停、切走标签页时）
  pause(): void;
  resume(): void;
  readonly muted: boolean;
  setMuted(value: boolean): void;
  dispose(): void;
}

// 下载过的音频存进浏览器的 Cache Storage（2026-11-14 用户要「下载好的资源刷新后也留存，避免重复下」），按这一版音频的 version 分一格，
// 换了一版音频旧的那一格整个删掉。浏览器自己的 HTTP 缓存也能留，但它说清就清，这里是明明白白存一份
const CACHE_NAME = `pelican-audio-${marks.version}`;
const CACHE_PREFIX = 'pelican-audio-';

async function openCache(): Promise<Cache | null> {
  try {
    if (!('caches' in window)) return null;
    return await caches.open(CACHE_NAME);
  } catch {
    // 无痕模式、存储被禁用时打不开，就只走网络
    return null;
  }
}

// 把旧版本的音频缓存清掉
async function dropOldCaches(): Promise<void> {
  try {
    if (!('caches' in window)) return;
    for (const key of await caches.keys()) if (key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME) await caches.delete(key);
  } catch {
    // 清不掉也不影响玩
  }
}

// 下载一个文件：缓存里有就直接拿，没有就边下边报进度（0 到 1），下完存进缓存
async function download(url: string, progress?: (part: number) => void): Promise<ArrayBuffer | null> {
  try {
    const cache = await openCache();
    const hit = await cache?.match(url);
    if (hit) {
      progress?.(1);
      return await hit.arrayBuffer();
    }
    const response = await fetch(url);
    if (!response.ok) return null;
    const total = Number(response.headers.get('content-length')) || 0;
    let data: ArrayBuffer;
    if (response.body && total > 0 && progress) {
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let got = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        got += value.length;
        progress(Math.min(1, got / total));
      }
      const joined = new Uint8Array(got);
      let at = 0;
      for (const chunk of chunks) {
        joined.set(chunk, at);
        at += chunk.length;
      }
      data = joined.buffer;
    } else {
      data = await response.arrayBuffer();
    }
    progress?.(1);
    try {
      await cache?.put(url, new Response(data.slice(0), { headers: { 'content-type': 'audio/mpeg' } }));
    } catch {
      // 存不进去（空间不够之类）就下次再下
    }
    return data;
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

// 一直响的那几层自然音：一段循环的白噪声，过不同的滤波器，音量按很慢的随机起伏走（一阵一阵的风、一阵一阵的沙沙声）
interface Bed {
  gain: GainNode;
  // 这一层在当前场景该多响（0 到 1），起伏围着它转
  level: number;
  // 起伏有多大、多快换一次（秒）
  swing: number;
  pace: [number, number];
  next: number;
}

export function createSound(): Sound {
  let context: AudioContext | null = null;
  let master: GainNode | null = null;
  let effectBus: GainNode | null = null;
  let natureBus: GainNode | null = null;
  let effects: AudioBuffer | null = null;
  let muted = loadMuted();
  let disposed = false;
  let suspended = false;
  let combo = 0;
  let comboDir = 1;
  let lastFish = -Infinity;
  // 最近捡东西的时刻，算「捡得多密」用
  const picks: number[] = [];
  const lastPlayed = new Map<string, number>();
  // 音效还没下完时要的出发铃，下完补上
  let bellWaiting = false;
  let sfxFile: Promise<ArrayBuffer | null> | null = null;
  // 每首配乐只下载一次、只解码一次
  const songFiles = new Map<string, Promise<ArrayBuffer | null>>();
  const songBuffers = new Map<string, Promise<AudioBuffer | null>>();
  // 现在应该放哪一首、正在放的是哪一首
  let wanted = '';
  let sceneName = '';
  let playing: { slug: string; source: AudioBufferSourceNode; gain: GainNode } | null = null;
  // 自然音
  const beds = new Map<keyof Nature, Bed>();
  let natureTimer = 0;
  let nextWave = 0;
  let nextBird = 0;
  let nextDrip = 0;
  let nextChirp = 0;
  let echo: DelayNode | null = null;

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

  const fetchSong = (slug: string, progress?: (part: number) => void) => {
    if (!songs[slug]) return null;
    let file = songFiles.get(slug);
    if (!file) {
      file = download(songUrl(slug), progress);
      songFiles.set(slug, file);
    } else {
      void file.then(() => progress?.(1));
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

  // 从音效那一条里切一段放出来。rate 是放快放慢（顺带变高变低），pan 是左右
  const clip = (name: string, volume: number, bus: AudioNode, rate = 1, pan = 0, when = 0) => {
    if (!context || !effects) return;
    const mark = offsets[name];
    if (!mark) return;
    const gain = context.createGain();
    gain.gain.value = volume;
    let out: AudioNode = gain;
    if (pan !== 0 && context.createStereoPanner) {
      const panner = context.createStereoPanner();
      panner.pan.value = pan;
      gain.connect(panner);
      out = panner;
    }
    out.connect(bus);
    const source = context.createBufferSource();
    source.buffer = effects;
    source.playbackRate.value = rate;
    source.connect(gain);
    source.start(when || context.currentTime, mark[0], mark[1] + TAIL);
  };

  // 建自然音的那几层：一段两秒的白噪声循环着放，每层过自己的滤波器
  const buildNature = () => {
    if (!context || !natureBus) return;
    const length = context.sampleRate * 2;
    const noise = context.createBuffer(1, length, context.sampleRate);
    const data = noise.getChannelData(0);
    // 粉一点的噪声（低频多、高频少），比白噪声柔和
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    for (let i = 0; i < length; i += 1) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + white * 0.099046;
      b1 = 0.963 * b1 + white * 0.2965164;
      b2 = 0.57 * b2 + white * 1.0526913;
      data[i] = (b0 + b1 + b2 + white * 0.1848) * 0.2;
    }
    const bed = (name: keyof Nature, filters: Array<[BiquadFilterType, number, number]>, swing: number, pace: [number, number]) => {
      if (!context || !natureBus) return;
      const source = context.createBufferSource();
      source.buffer = noise;
      source.loop = true;
      // 每层从噪声的不同地方开始，几层叠在一起不会一模一样地起伏
      source.start(0, Math.random() * 2);
      let node: AudioNode = source;
      for (const [type, frequency, q] of filters) {
        const filter = context.createBiquadFilter();
        filter.type = type;
        filter.frequency.value = frequency;
        filter.Q.value = q;
        node.connect(filter);
        node = filter;
      }
      const gain = context.createGain();
      gain.gain.value = 0;
      node.connect(gain);
      gain.connect(natureBus);
      beds.set(name, { gain, level: 0, swing, pace, next: 0 });
    };
    // 风：只留低频，一阵大一阵小
    bed('wind', [['lowpass', 420, 0.7]], 0.7, [1.5, 4]);
    // 树叶沙沙：中高频的一条窄带，起伏得快一点
    bed('leaves', [['bandpass', 2600, 0.9], ['lowpass', 5000, 0.5]], 0.85, [0.4, 1.6]);
    // 流水：中频，比较稳
    bed('water', [['bandpass', 900, 0.8], ['lowpass', 2400, 0.5]], 0.25, [1, 3]);
    // 城市里远远的车流和空调外机：很低的嗡嗡声
    bed('city', [['lowpass', 220, 0.9]], 0.3, [2, 5]);
    // 滴水的回声：一个延时，自己接回自己，洞里「嘀嗒」之后还有一串
    echo = context.createDelay(1);
    echo.delayTime.value = 0.32;
    const feedback = context.createGain();
    feedback.gain.value = 0.38;
    echo.connect(feedback);
    feedback.connect(echo);
    echo.connect(natureBus);
  };

  // 洞里的一滴水：一个很短的正弦，音高往下一沉，像「嘀」
  const drip = (at: number) => {
    if (!context || !natureBus || !echo) return;
    const tone = context.createOscillator();
    const gain = context.createGain();
    const pitch = 620 + Math.random() * 380;
    tone.frequency.setValueAtTime(pitch, at);
    tone.frequency.exponentialRampToValueAtTime(pitch * 0.55, at + 0.12);
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(0.08, at + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0005, at + 0.18);
    tone.connect(gain);
    gain.connect(natureBus);
    gain.connect(echo);
    tone.start(at);
    tone.stop(at + 0.2);
  };

  // 夜里的一声虫鸣：三四下很快的「唧」
  const chirp = (at: number) => {
    if (!context || !natureBus) return;
    const tone = context.createOscillator();
    const gain = context.createGain();
    tone.frequency.value = 3900 + Math.random() * 500;
    gain.gain.value = 0;
    const pulses = 3 + Math.floor(Math.random() * 2);
    for (let k = 0; k < pulses; k += 1) {
      const t = at + k * 0.055;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.012, t + 0.012);
      gain.gain.linearRampToValueAtTime(0, t + 0.035);
    }
    const pan = context.createStereoPanner?.();
    tone.connect(gain);
    if (pan) {
      pan.pan.value = Math.random() * 1.6 - 0.8;
      gain.connect(pan);
      pan.connect(natureBus);
    } else {
      gain.connect(natureBus);
    }
    tone.start(at);
    tone.stop(at + pulses * 0.055 + 0.05);
  };

  // 每隔一小会儿调一次：一直响的几层按场景的量一阵大一阵小，海浪、鸟叫、滴水、虫鸣到点了就来一下
  const tickNature = () => {
    if (!context || !natureBus || disposed || suspended || muted) return;
    const now = context.currentTime;
    const scene = NATURE[sceneName] ?? {};
    for (const [name, bed] of beds) {
      const target = (scene[name] as number | undefined) ?? 0;
      // 换场景时一层一层慢慢换过去，和配乐交叉淡同样长
      bed.level += (target - bed.level) * 0.12;
      if (now < bed.next && Math.abs(target - bed.level) < 0.02) continue;
      const wobble = 1 - bed.swing * 0.5 + Math.random() * bed.swing;
      const value = Math.max(0, bed.level * wobble) * (name === 'city' ? 0.5 : name === 'leaves' ? 0.6 : 0.9);
      const span = bed.pace[0] + Math.random() * (bed.pace[1] - bed.pace[0]);
      bed.gain.gain.setTargetAtTime(value, now, span / 3);
      bed.next = now + span;
    }
    if (scene.waves && now > nextWave) {
      clip(`wave${Math.floor(Math.random() * 3)}`, 0.5 * scene.waves, natureBus, 0.85 + Math.random() * 0.2, Math.random() * 1.2 - 0.6);
      nextWave = now + 4.5 + Math.random() * 3.5;
    }
    if (scene.birds && now > nextBird) {
      // 鸟哨放慢放快一点就是不同的鸟，左右随机，远近（音量）也随机
      clip(`bird${Math.random() < 0.65 ? 0 : 1}`, (0.12 + Math.random() * 0.2) * scene.birds, natureBus, 0.8 + Math.random() * 0.55, Math.random() * 1.6 - 0.8);
      nextBird = now + (3 + Math.random() * 7) / scene.birds;
    }
    if (scene.drips && now > nextDrip) {
      drip(now + 0.05);
      nextDrip = now + (0.9 + Math.random() * 2.6) / scene.drips;
    }
    if (scene.crickets && now > nextChirp) {
      chirp(now + 0.05);
      nextChirp = now + (0.5 + Math.random() * 1.2) / scene.crickets;
    }
  };

  return {
    preload() {
      if (disposed) return;
      sfxFile ??= download(SFX_URL);
    },
    async preloadAll(progress) {
      if (disposed) return;
      void dropOldCaches();
      const slugs = Object.keys(songs);
      const parts = new Array(slugs.length + 1).fill(0);
      const report = (index: number) => (part: number) => {
        parts[index] = part;
        progress(parts.reduce((sum, value) => sum + value, 0) / parts.length);
      };
      sfxFile ??= download(SFX_URL, report(0));
      const files = [sfxFile, ...slugs.map((slug, i) => fetchSong(slug, report(i + 1)))];
      await Promise.all(files.map((file) => file ?? Promise.resolve(null)));
      progress(1);
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
      // 音效总线：音量、削高频、轻轻压一下
      effectBus = context.createGain();
      effectBus.gain.value = EFFECT_VOLUME;
      const soften = context.createBiquadFilter();
      soften.type = 'lowpass';
      soften.frequency.value = EFFECT_LOWPASS;
      soften.Q.value = 0.5;
      const squeeze = context.createDynamicsCompressor();
      squeeze.threshold.value = -20;
      squeeze.knee.value = 12;
      squeeze.ratio.value = 4;
      squeeze.attack.value = 0.004;
      squeeze.release.value = 0.25;
      effectBus.connect(soften);
      soften.connect(squeeze);
      squeeze.connect(master);
      natureBus = context.createGain();
      natureBus.gain.value = NATURE_VOLUME;
      natureBus.connect(master);
      buildNature();
      natureTimer = window.setInterval(tickNature, 250);
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
      sceneName = name;
      const slug = sceneSongs[name] ?? '';
      if (slug === wanted) return;
      wanted = slug;
      follow();
    },
    play(name, volume = 1) {
      if (!effects && name === 'bell') bellWaiting = true;
      if (!context || !effectBus || !effects || muted) return;
      const now = context.currentTime;
      let part: string = name;
      let duck = 1;
      // 捡东西：同一种离上一下太近就不响；最近捡得越多越小声，还略微错开一点音高，一串下来不会一模一样地「叮叮叮」
      const pickup = name === 'fish' || name === 'gold' || name === 'ring';
      if (pickup) {
        if (now - (lastPlayed.get(name) ?? -Infinity) < PICK_GAP) return;
        lastPlayed.set(name, now);
        while (picks.length && now - picks[0] > PICK_WINDOW) picks.shift();
        duck = Math.max(PICK_FLOOR, 1 / (1 + PICK_DUCK * picks.length));
        picks.push(now);
      }
      if (name === 'fish') {
        if (now - lastFish < COMBO_SECONDS) {
          combo += comboDir;
          if (combo >= COMBO_STEPS - 1 || combo <= 0) comboDir = -comboDir;
          combo = Math.max(0, Math.min(COMBO_STEPS - 1, combo));
        } else {
          combo = 0;
          comboDir = 1;
        }
        lastFish = now;
        const voice = VOICES[sceneName]?.[0] ?? 'harp';
        part = voice === 'harp' ? `fish${combo}` : `fish_${voice}${combo}`;
      }
      if (name === 'gate') {
        const voice = VOICES[sceneName]?.[1] ?? 'chimes';
        if (voice !== 'chimes') part = `gate_${voice}`;
      }
      const tuned = pickup || name === 'gate' ? keyRate(sceneName) : 1;
      clip(part, volume * duck * LEVELS[name], effectBus, tuned * (pickup ? 0.97 + Math.random() * 0.06 : 1));
    },
    pause() {
      suspended = true;
      void context?.suspend();
    },
    resume() {
      suspended = false;
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
      window.clearInterval(natureTimer);
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
