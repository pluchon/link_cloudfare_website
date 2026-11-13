// 鹈鹕骑车：把物理、场景、镜头、按键和界面接到一起

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { Bike, BIKE_SPEED, type BikeEvent, type Controls } from './bike';
import { Course, REFILL, SCORE, shuffledOrder } from './course';
import { buildRider } from './rider';
import { createSound } from './sound';
import type { Scene, TokenKind } from './scenes';
import type { Track, TrackPoint } from './track';
import { World } from './world';

type State = 'ready' | 'playing' | 'paused' | 'finished';

// 物理固定按这个步长走，和屏幕刷新率无关
const TICK = 1 / 120;
// 镜头在车后面多远、多高，往前看多远（米）
const CAM_BACK = 6.6;
const CAM_UP = 3;
const CAM_AHEAD = 12;
// 车横着挪一米，镜头跟着挪多少、视线的落点跟着挪多少
const CAM_FOLLOW = 0.42;
const CAM_AIM = 0.3;
// 到终点后镜头绕着鹈鹕转：转多久、一共转过多少弧度（一圈多一点，停在侧前方）、最后离多远多高
const ORBIT = { seconds: 4.6, sweep: Math.PI * 2 + 2.3, radius: 5.4, height: 1.9 };
// 离地不到这么高才会撞上路障（米）；撞上之后镜头抖多久（秒）
const BLOCK_HEIGHT = 0.85;
const SHAKE_SECONDS = 0.3;
// 血条（用户要的，先轻一点）：三颗心，每颗两半。撞一次路障掉半颗，掉进深沟掉一颗，每进一个新场景回半颗；掉光了这一趟就到此为止
const HEARTS = 3;
const HURT = { block: 1, fall: 2 };
const FOV = 64;
const FOV_DASH = 12;
// 捡到东西时弹框里的小图标：24 格的线条画，和顶栏那些图标一个画法。这里写的是 svg 里面的内容
const ring = (count: number, rx: number, ry: number, cy: number) =>
  Array.from({ length: count }, (_, i) => `<ellipse cx="12" cy="${cy}" rx="${rx}" ry="${ry}" transform="rotate(${(360 / count) * i} 12 12)"/>`).join('');
const ICONS: Record<TokenKind | 'chili' | 'rocket', string> = {
  rocket: '<path d="M14.5 4.5c3-1.6 5-1.5 5-1.5s.1 2-1.5 5l-6.5 6.5-3.5-3.5zM9.5 10.5 6 10l-2.5 2.5 3.5 1M13.5 14.5l.5 3.5-2.5 2.5-1-3.5M8 16c-1.6.4-3 1.6-3.5 3.5 1.9-.5 3.1-1.9 3.5-3.5z"/>',
  shell: '<path d="M12 20 4.5 10.5a8 8 0 0 1 15 0zM12 20V6.6M12 20 8 7.6M12 20l4-12.4"/>',
  sunflower: `${ring(10, 1.5, 3, 5.2)}<circle cx="12" cy="12" r="3.2"/>`,
  blossom: `${ring(5, 2.9, 3.8, 6.6)}<circle cx="12" cy="12" r="1.3"/>`,
  pinecone: '<path d="M12 3c3.6 2 5.6 5.6 5.6 9.6a5.6 5.6 0 0 1-11.2 0C6.4 8.6 8.4 5 12 3zM7 11.5l5 3 5-3M7.6 15.6 12 18l4.4-2.4M9.2 7.4 12 9.2l2.8-1.8"/>',
  maple: '<path d="M12 21v-5.5M12 15.5l-7.5-2 2.3-2.2L3.5 7l4.3.6L7.6 4 12 7l4.4-3-.2 3.6 4.3-.6-3.3 4.3 2.3 2.2z"/>',
  turquoise: '<path d="M6.5 4h11L21 9l-9 11L3 9zM3 9h18M9.5 4 8 9l4 11 4-11-1.5-5"/>',
  coconut: '<circle cx="12" cy="12.5" r="7.5"/><path d="M9.6 10.5h.01M14.4 10.5h.01M12 14h.01" stroke-width="2.4"/>',
  starfish: '<path d="M12 3l2.5 5.8 6.3.6-4.8 4.1 1.5 6.2L12 16.4 6.5 19.7 8 13.5 3.2 9.4l6.3-.6z"/>',
  note: '<circle cx="7" cy="17.5" r="2.5"/><circle cx="17" cy="15.5" r="2.5"/><path d="M9.5 17.5V6l10-2v11.5M9.5 9.5l10-2"/>',
  snowflake: '<path d="M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9M9.8 4.6 12 6.6l2.2-2M9.8 19.4l2.2-2 2.2 2"/>',
  icegem: '<path d="M12 2.5l5 7-5 12-5-12zM7 9.5h10M12 2.5v19"/>',
  balloon: '<path d="M12 3a6 6 0 0 1 6 6c0 3.8-3 6.6-6 7.6-3-1-6-3.8-6-7.6a6 6 0 0 1 6-6zM11 16.6h2l-.4 1.4h-1.2zM12 18c-1.6 1.2 1.6 2 0 3.4"/>',
  feather: '<path d="M20 4C12 4 7 9 6 16.5L4 20M6 16.5C13.5 15.5 19 11 20 4M8.5 14l6-6M6.4 16.4l3.4-.6"/>',
  lotus: '<path d="M12 5c2.4 3.2 2.4 9 0 13-2.4-4-2.4-9.8 0-13zM4 10c4 0 7 3 8 8-5 0-8-3-8-8zM20 10c-4 0-7 3-8 8 5 0 8-3 8-8z"/>',
  crystal: '<path d="M12 2.5l3.6 6-3.6 12.5L8.4 8.5zM6 10.5l2.4 8.5-5-2.2zM18 10.5l-2.4 8.5 5-2.2z"/>',
  chili: '<path d="M14.5 6.5c5 2.4 5.5 9-1.5 12.5-3 1.5-7 1-9-1 6 0 8.5-4 8.5-9 0-1.6.8-2.5 2-2.5zM14.5 6.5c0-2 1.5-3.2 3.5-3.2"/>',
};

// 嘴离鱼多近算吃到：沿路、横向、上下（米）
const REACH = { along: 1.5, across: 1.5, up: 1.6 };
// 速度条在这个速度（米每秒）时是满的
const SPEED_FULL = 34;
const STORE_KEY = 'nn-pelican-ride';
// 画质分四档，从高到低：像素比上限、要不要阴影、要不要泛光。机器吃力时往下降，不往回升
const QUALITY = [
  { ratio: 1.5, shadows: true, bloom: true },
  { ratio: 1, shadows: true, bloom: true },
  { ratio: 1, shadows: false, bloom: false },
  { ratio: 0.75, shadows: false, bloom: false },
];
// 泛光：多强、晕开多大、比这个亮度还亮的地方才晕；开着泛光时发光的东西画得比白亮多少倍
const BLOOM = { strength: 0.28, radius: 0.5, threshold: 1.08 };
const GLOW_BOOST = 1.7;
// 连续这么多帧的平均帧时间超过这个值（秒）就降一档
const SLOW_FRAMES = 90;
const SLOW_SECONDS = 0.024;

interface Best {
  score: number;
  fish: number;
  seconds: number;
}

export function supportsWebGL2(): boolean {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

function pick<T extends Element>(root: HTMLElement, selector: string): T {
  const node = root.querySelector<T>(selector);
  if (!node) throw new Error(`鹈鹕骑车：页面上缺少 ${selector}`);
  return node;
}

function clock(seconds: number): string {
  const whole = Math.floor(seconds);
  return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`;
}

function loadBest(): Best | null {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    const data = raw ? (JSON.parse(raw) as Partial<Best>) : null;
    if (data && typeof data.score === 'number' && typeof data.fish === 'number' && typeof data.seconds === 'number') {
      return { score: data.score, fish: data.fish, seconds: data.seconds };
    }
  } catch {
    // 无痕模式或存储被禁用时读不到，当作没有记录
  }
  return null;
}

function saveBest(best: Best): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(best));
  } catch {
    // 存不进去就算了，不影响玩
  }
}

// 颜色的小工具：0xrrggbb 写成样式里的 #rrggbb；有多亮（0 到 1）；整体调暗或调亮
function css(hex: number): string {
  return `#${hex.toString(16).padStart(6, '0')}`;
}

function luminance(hex: number): number {
  return (((hex >> 16) & 255) * 0.2126 + ((hex >> 8) & 255) * 0.7152 + (hex & 255) * 0.0722) / 255;
}

function shade(hex: number, factor: number): number {
  const channel = (value: number) => Math.min(255, Math.round(factor > 1 ? 255 - (255 - value) / factor : value * factor));
  return (channel((hex >> 16) & 255) << 16) | (channel((hex >> 8) & 255) << 8) | channel(hex & 255);
}

export function mountPelican(root: HTMLElement): () => void {
  const stage = pick<HTMLElement>(root, '[data-stage]');
  const canvas = pick<HTMLCanvasElement>(root, '[data-canvas]');
  const rushCanvas = pick<HTMLCanvasElement>(root, '[data-rush]');
  const scoreNode = pick<HTMLElement>(root, '[data-score]');
  const eatenNode = pick<HTMLElement>(root, '[data-eaten]');
  const keepsakeNode = pick<HTMLElement>(root, '[data-keepsake]');
  const keepsakeTotal = pick<HTMLElement>(root, '[data-keepsake-total]');
  const progressNode = pick<HTMLElement>(root, '[data-progress]');
  const boostNode = pick<HTMLElement>(root, '[data-boost]');
  const boostBox = pick<HTMLElement>(root, '[data-boost-box]');
  const boostLabel = pick<HTMLElement>(root, '[data-boost-label]');
  const boostNum = pick<HTMLElement>(root, '[data-boost-num]');
  const flameBox = pick<HTMLElement>(root, '[data-flames]');
  const flames = Array.from(flameBox.children) as HTMLElement[];
  const recordNode = pick<HTMLElement>(root, '[data-record]');
  const heartBox = pick<HTMLElement>(root, '[data-hearts]');
  const hearts = Array.from(heartBox.querySelectorAll<SVGElement>('[data-heart]'));
  const toastNode = pick<HTMLElement>(root, '[data-toast]');
  const toastIcon = pick<SVGElement>(root, '[data-toast-icon]');
  const toastText = pick<HTMLElement>(root, '[data-toast-text]');
  const pauseButton = pick<HTMLButtonElement>(root, '[data-pause]');
  const muteButton = pick<HTMLButtonElement>(root, '[data-mute]');
  const overlay = pick<HTMLElement>(root, '[data-overlay]');
  const overlayTitle = pick<HTMLElement>(root, '[data-overlay-title]');
  const statsNode = pick<HTMLElement>(root, '[data-overlay-stats]');
  const statScore = pick<HTMLElement>(root, '[data-stat-score]');
  const statTime = pick<HTMLElement>(root, '[data-stat-time]');
  const speedNode = pick<HTMLElement>(root, '[data-speed]');
  const speedNum = pick<HTMLElement>(root, '[data-speed-num]');
  const overlayText = pick<HTMLElement>(root, '[data-overlay-text]');
  const overlayButton = pick<HTMLButtonElement>(root, '[data-overlay-btn]');
  const turboButton = pick<HTMLButtonElement>(root, '[data-turbo]');
  const dashButton = pick<HTMLButtonElement>(root, '[data-dash]');
  const gameTitle = root.dataset.title ?? '鹈鹕骑车';

  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const sound = createSound();
  // 一进页面就开始下载音效和音乐，等玩家点「开始」时多半已经下完了
  sound.preload();
  // 这颗按钮的 aria-pressed 表示「声音开着」
  muteButton.setAttribute('aria-pressed', String(!sound.muted));
  const abort = new AbortController();
  const { signal } = abort;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  // 色调映射：太亮的地方柔和地压下来而不是直接削成白色，普通亮度的颜色不动
  renderer.toneMapping = THREE.NeutralToneMapping;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 16 / 9, 0.2, 2600);

  // 泛光要先把画面画进一张能存下「比白还亮」的图里（半浮点），晕完再做色调映射输出到屏幕
  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), BLOOM.strength, BLOOM.radius, BLOOM.threshold));
  composer.addPass(new OutputPass());

  const rider = buildRider();
  rider.group.rotation.order = 'YXZ';
  scene.add(rider.group);

  // 触屏设备从第二档起步
  let quality = matchMedia('(pointer: coarse)').matches ? 1 : 0;

  // 界面现在用的是第几个场景的颜色
  let themed = -1;
  // 画面里的面板和按钮跟着场景换颜色：底色取地平线的颜色，字按底色深浅取黑或白，强调色取路沿的颜色
  const applyTheme = (look: Scene) => {
    const paper = look.sky[2];
    const light = luminance(paper) > 0.42;
    // 强调色和底色太接近的话看不清，浅底上压暗，深底上提亮
    let accent = look.curb[0];
    if (Math.abs(luminance(accent) - luminance(paper)) < 0.28) accent = shade(accent, light ? 0.62 : 1.9);
    root.style.setProperty('--hud-paper', css(paper));
    root.style.setProperty('--hud-ink', light ? '#20242e' : '#f6f2ea');
    root.style.setProperty('--hud-accent', css(accent));
  };

  // 每一局的路线和场景都是随机的：场景顺序打乱，路形也换一条
  let course!: Course;
  let track!: Track;
  let world: World | null = null;
  let taken = new Uint8Array(0);
  let knocked = new Uint8Array(0);
  // 刚生成、还没骑过的路线，点开始时直接用，不用再生成一次
  let fresh = false;
  const build = () => {
    if (world) {
      scene.remove(world.group);
      world.dispose();
    }
    // 本地开发时可以在地址后面写 ?scenes=12,13,14 指定这一局经过哪几个场景（SCENES 里的下标），看新场景用；构建产物里没有
    const forced = import.meta.env.DEV ? new URLSearchParams(location.search).get('scenes') : null;
    course = new Course(forced ? forced.split(',').map(Number) : shuffledOrder(), Math.floor(Math.random() * 1e9));
    track = course.track;
    world = new World(course, still);
    world.setShadows(QUALITY[quality].shadows);
    world.setGlow(QUALITY[quality].bloom ? GLOW_BOOST : 1);
    world.setViewport(canvas.height);
    scene.add(world.group);
    scene.fog = world.fog;
    taken = new Uint8Array(course.items.length);
    knocked = new Uint8Array(course.obstacles.length);
    fresh = true;
    // 头两段场景的配乐先下着，后面的骑到前一段时再下
    sound.fetchScenes(course.scenes.slice(0, 2).map((item) => item.name));
    themed = -1;
  };
  build();

  let state: State = 'ready';
  let score = 0;
  let eaten = 0;
  // 这一局在哪几个场景捡到过纪念品
  const keepsakes = new Set<number>();
  let elapsed = 0;
  let time = 0;
  let finishTimer = 0;
  let sceneShown = -1;
  let toastTimer = 0;
  // 路上的东西按位置排好了，从这个下标往后找就行
  let itemFrom = 0;
  let blockFrom = 0;
  // 撞到路障后镜头还要抖多久
  let shake = 0;
  // 还剩几个半颗心；是不是没血了才停下来的；掉血后那几颗心还要放大多久
  let health = HEARTS * 2;
  let out = false;
  let hurtTimer = 0;

  // 掉血。掉光了车慢慢停下来，过一会儿出结算面板
  const hurt = (halves: number) => {
    if (out || bike.finished) return;
    health = Math.max(0, health - halves);
    hurtTimer = 0.45;
    shake = SHAKE_SECONDS;
    if (health > 0) return;
    out = true;
    bike.stop();
    finishTimer = 2.2;
  };

  const onBikeEvent = (event: BikeEvent) => {
    // 掉进深沟：扣一颗心，鹈鹕自己会飞回对岸
    if (event === 'fall') {
      hurt(HURT.fall);
      sound.play('fall');
      if (!out) showToast('掉下去了 · 冲刺才飞得过去');
      return;
    }
    // 到终点后先让镜头绕一圈再出结算面板；减少动态效果时不绕，等一下就出
    if (event === 'finish') finishTimer = still ? 1.4 : ORBIT.seconds;
    // 落地声的大小跟着摔得多重走，轻轻一颠就很小声
    if (event === 'land') sound.play('land', 0.35 + bike.squash * 0.65);
    // 吃到火箭：整屏一闪
    else if (event === 'blast') {
      flash = 1;
      sound.play('super');
    }
    // 猛冲没有单独的声音，再响一次冲刺那一声
    else sound.play(event === 'turbo' ? 'dash' : event);
  };
  const bike: Bike = new Bike(onBikeEvent);
  bike.reset(course);

  // 按键和触屏各记各的，合起来才是这一步的输入
  // dash 是按住 ↑ 的冲刺，turbo 是按住空格的猛冲。没有起跳键（用户取消的），要飞起来靠跳台和弹簧垫
  const keys = { left: false, right: false, dash: false, turbo: false };
  const touch = { left: 0, right: 0, dash: false, turbo: false };
  const controls: Controls = { steer: 0, dash: false, turbo: false };
  // 这一下空格是用来开始游戏的，还没松开
  let spaceStarted = false;

  const p: TrackPoint = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, curve: 0 };
  const camPos = new THREE.Vector3();
  const camLook = new THREE.Vector3();
  const wantPos = new THREE.Vector3();
  const wantLook = new THREE.Vector3();
  let camSide = 0;
  let camFov = FOV;
  let riderPitch = 0;
  let snapCamera = true;

  // button 留空就不放按钮（暂停时点画面空白处继续）；stats 是结算时的分数和用时
  const showOverlay = (title: string, button: string, text = '', stats: [number, string] | null = null) => {
    overlayTitle.textContent = title;
    overlayText.textContent = text;
    overlayButton.textContent = button;
    overlayButton.hidden = !button;
    statsNode.hidden = !stats;
    if (stats) {
      statScore.textContent = String(stats[0]);
      statTime.textContent = stats[1];
    }
    // 弹出来有个过渡：先摆成收着的样子，让浏览器算一遍，再展开
    delete overlay.dataset.open;
    overlay.hidden = false;
    void overlay.offsetWidth;
    overlay.dataset.open = '1';
    if (button) overlayButton.focus({ preventScroll: true });
  };

  // icon 是 ICONS 里的一项（我们自己写死的线条画）；报场景名的时候不带图标
  const showToast = (text: string, icon = '') => {
    toastIcon.innerHTML = icon;
    toastText.textContent = text;
    toastNode.dataset.show = '1';
    toastTimer = 2.6;
  };

  const finish = () => {
    const total = course.fishTotal;
    const best = loadBest();
    const record = !best || score > best.score;
    if (record) saveBest({ score, fish: eaten, seconds: Math.round(elapsed) });
    // 面板上只写分数和用时；吃了多少鱼、是不是新纪录写在画面下面那一行的左边
    const notes = [`本局小鱼 ${eaten} / ${total}`, `纪念品 ${keepsakes.size} / ${course.scenes.length}`];
    if (out) notes.unshift(`骑到第 ${track.sceneAt(bike.s) + 1} / ${course.scenes.length} 段`);
    if (record && best) notes.push(`新纪录，之前最好 ${best.score}`);
    else if (record) notes.push('新纪录');
    else if (best) notes.push(`最好成绩 ${best.score}`);
    recordNode.textContent = notes.join('　');
    showOverlay(out ? '骑不动了' : '抵达终点', '再骑一次', '', [score, clock(elapsed)]);
  };

  // 画面下面那一行左边：平常写最好成绩，没有记录就空着
  const showBest = () => {
    const best = loadBest();
    recordNode.textContent = best ? `最好成绩 ${best.score}　用时 ${clock(best.seconds)}` : '';
  };
  showBest();

  const setState = (next: State) => {
    state = next;
    root.dataset.state = next;
    pauseButton.setAttribute('aria-pressed', String(next === 'paused'));
    pauseButton.disabled = next === 'ready' || next === 'finished';
    if (next === 'playing') {
      overlay.hidden = true;
      sound.resume();
    }
    if (next === 'paused') sound.pause();
    // 出发前没有面板，只有标题和一行提示，点画面任何地方开始
    if (next === 'ready') showOverlay(gameTitle, '', '点击任意区域开始');
    if (next === 'paused') showOverlay('暂停中', '', '点击游戏画面空白处继续');
    if (next === 'finished') finish();
  };

  const restart = () => {
    // 骑过的路线不再用，换一条新的
    if (!fresh) build();
    fresh = false;
    bike.reset(course);
    itemFrom = 0;
    blockFrom = 0;
    shake = 0;
    health = HEARTS * 2;
    out = false;
    hurtTimer = 0;
    showBest();
    score = 0;
    eaten = 0;
    keepsakes.clear();
    elapsed = 0;
    finishTimer = 0;
    accumulator = 0;
    sceneShown = -1;
    // 从出发前的环绕镜头接过来时不硬切，让镜头自己绕回车后面；再骑一次才直接跳过去
    snapCamera = state !== 'ready';
    setState('playing');
    sound.setScene(course.scenes[0].name);
    sound.play('bell');
  };

  const togglePause = () => {
    if (state === 'playing') setState('paused');
    else if (state === 'paused') setState('playing');
  };

  overlayButton.addEventListener(
    'click',
    () => {
      // 浏览器只允许在点击里开声音，所以放在这里
      sound.start();
      if (state === 'paused') setState('playing');
      else restart();
    },
    { signal },
  );
  pauseButton.addEventListener('click', togglePause, { signal });
  // 暂停时面板上没有按钮：点画面上任何不是按钮的地方就继续
  stage.addEventListener(
    'click',
    (event) => {
      if ((event.target as HTMLElement).closest('button')) return;
      if (state === 'paused') setState('playing');
      else if (state === 'ready') {
        // 浏览器只允许在点击里开声音，所以放在这里
        sound.start();
        restart();
      }
    },
    { signal },
  );
  const toggleMute = () => {
    sound.setMuted(!sound.muted);
    muteButton.setAttribute('aria-pressed', String(!sound.muted));
  };
  muteButton.addEventListener('click', toggleMute, { signal });

  const onKey = (event: KeyboardEvent, down: boolean) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
    let handled = true;
    switch (event.code) {
      case 'ArrowLeft':
      case 'KeyA':
        keys.left = down;
        break;
      case 'ArrowRight':
      case 'KeyD':
        keys.right = down;
        break;
      case 'ArrowUp':
      case 'KeyW':
      case 'ShiftLeft':
      case 'ShiftRight':
        keys.dash = down;
        break;
      case 'Space':
        // 焦点在按钮上时空格本来就会点它，这里不抢
        if (target?.closest('button, a')) {
          handled = false;
          break;
        }
        // 出发前按空格也能开始。这一下按着不松不算猛冲，松开再按才算
        if (down && !event.repeat && state === 'ready') {
          sound.start();
          restart();
          spaceStarted = true;
          break;
        }
        if (!down) spaceStarted = false;
        keys.turbo = down && !spaceStarted && state === 'playing';
        break;
      case 'Escape':
      case 'KeyP':
        if (down && !event.repeat) togglePause();
        break;
      case 'KeyM':
        if (down && !event.repeat) toggleMute();
        break;
      default:
        handled = false;
    }
    // 游戏进行中方向键和空格不让页面跟着滚
    if (handled && state === 'playing') event.preventDefault();
  };
  window.addEventListener('keydown', (event) => onKey(event, true), { signal });
  window.addEventListener('keyup', (event) => onKey(event, false), { signal });
  window.addEventListener(
    'blur',
    () => {
      keys.left = keys.right = keys.dash = keys.turbo = false;
    },
    { signal },
  );
  document.addEventListener(
    'visibilitychange',
    () => {
      if (document.hidden && state === 'playing') setState('paused');
    },
    { signal },
  );

  // 触屏：按住画面左半边往左压，右半边往右压
  const sides = new Map<number, 'left' | 'right'>();
  const refreshTouch = () => {
    touch.left = 0;
    touch.right = 0;
    sides.forEach((value) => {
      touch[value] += 1;
    });
  };
  stage.addEventListener(
    'pointerdown',
    (event) => {
      if (event.pointerType === 'mouse' || state !== 'playing') return;
      if ((event.target as HTMLElement).closest('button')) return;
      const box = stage.getBoundingClientRect();
      sides.set(event.pointerId, event.clientX - box.left < box.width / 2 ? 'left' : 'right');
      refreshTouch();
    },
    { signal },
  );
  const release = (event: PointerEvent) => {
    if (sides.delete(event.pointerId)) refreshTouch();
  };
  window.addEventListener('pointerup', release, { signal });
  window.addEventListener('pointercancel', release, { signal });

  // 触屏右下角两个键：按住「冲」是冲刺，按住「猛」是猛冲
  const holdKey = (button: HTMLButtonElement, key: 'dash' | 'turbo') => {
    const set = (down: boolean) => (event: Event) => {
      event.preventDefault();
      touch[key] = down;
    };
    button.addEventListener('pointerdown', set(true), { signal });
    button.addEventListener('pointerup', set(false), { signal });
    button.addEventListener('pointercancel', set(false), { signal });
    button.addEventListener('pointerleave', set(false), { signal });
  };
  holdKey(dashButton, 'dash');
  holdKey(turboButton, 'turbo');

  const resize = () => {
    const width = stage.clientWidth;
    const height = stage.clientHeight;
    if (!width || !height) return;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, QUALITY[quality].ratio));
    renderer.setSize(width, height, false);
    // 速度线那张画布不用太细，像素比最多 1.5
    const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
    rushCanvas.width = Math.round(width * ratio);
    rushCanvas.height = Math.round(height * ratio);
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(width, height);
    world?.setViewport(canvas.height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  const sizeWatch = new ResizeObserver(resize);
  sizeWatch.observe(stage);
  resize();

  // 帧时间一直偏长就降一档画质
  let slowFrames = 0;
  let slowTotal = 0;
  const watchSpeed = (dt: number) => {
    // 切标签页回来那种特别长的一帧不算数，这一轮统计作废
    if (dt >= 0.1) {
      slowFrames = 0;
      slowTotal = 0;
      return;
    }
    slowFrames += 1;
    slowTotal += dt;
    if (slowFrames < SLOW_FRAMES) return;
    if (slowTotal / slowFrames > SLOW_SECONDS && quality < QUALITY.length - 1) {
      quality += 1;
      world?.setShadows(QUALITY[quality].shadows);
      world?.setGlow(QUALITY[quality].bloom ? GLOW_BOOST : 1);
      resize();
    }
    slowFrames = 0;
    slowTotal = 0;
  };

  // 嘴够得着的东西都吃掉
  const eat = () => {
    const items = course.items;
    while (itemFrom < items.length && items[itemFrom].s < bike.s - REACH.along) itemFrom += 1;
    // 东西的高度是相对路面记的，嘴的高度也换算成离路面多高
    const mouth = bike.h - track.at(bike.s, p).y + 0.95;
    for (let i = itemFrom; i < items.length && items[i].s < bike.s + REACH.along; i += 1) {
      if (taken[i]) continue;
      const item = items[i];
      if (Math.abs(item.x - bike.x) > REACH.across || Math.abs(item.y - mouth) > REACH.up) continue;
      taken[i] = 1;
      if (item.kind === 'fish' || item.kind === 'gold') eaten += 1;
      score += SCORE[item.kind];
      bike.refill(REFILL[item.kind]);
      world?.collect(i, time);
      rider.gulp();
      if (item.kind === 'rocket') {
        // 火箭：三秒多的超级加速
        bike.launch();
        showToast('捡到“火箭”', ICONS.rocket);
      } else if (item.kind === 'chili') {
        // 辣椒：一小段时间里冲刺条不掉，骑得也更快
        bike.ignite();
        showToast('捡到“辣椒”', ICONS.chili);
        sound.play('bolt');
        sound.play('dash', 0.8);
      } else if (item.kind === 'token') {
        // 纪念品：每个场景自己的小东西，头一回捡到报一下名字
        const token = course.scenes[item.scene].token;
        if (!keepsakes.has(item.scene)) showToast(`捡到“${token.name}”`, ICONS[token.kind]);
        keepsakes.add(item.scene);
        sound.play('ring');
      } else sound.play(item.kind);
    }
  };

  // 撞路障：贴着地、又正好在它那条车道上才算撞到；从跳台或弹簧垫上飞过去不算。撞上只是慢一下，路障被撞飞
  const bump = () => {
    const list = course.obstacles;
    while (blockFrom < list.length && list[blockFrom].s < bike.s - 1) blockFrom += 1;
    for (let i = blockFrom; i < list.length && list[i].s < bike.s + 0.8; i += 1) {
      if (knocked[i]) continue;
      const block = list[i];
      if (Math.abs(block.x - bike.x) > block.width / 2 + 0.35 || bike.h - bike.ground > BLOCK_HEIGHT) continue;
      knocked[i] = 1;
      bike.hit(bike.x >= block.x ? 1 : -1);
      world?.knock(i, time);
      sound.play('bump');
      shake = SHAKE_SECONDS;
      hurt(HURT.block);
    }
  };

  const place = (dt: number) => {
    // 车
    track.at(bike.s, p);
    const cos = Math.cos(p.yaw);
    const sin = Math.sin(p.yaw);
    rider.group.position.set(p.x + cos * bike.x, bike.h, p.z + sin * bike.x);
    const pitch = bike.grounded ? bike.slope : Math.atan2(bike.vy, Math.max(bike.v, 1)) * 0.5;
    riderPitch += (pitch - riderPitch) * Math.min(1, dt * 10);
    rider.group.rotation.set(riderPitch, -(p.yaw + bike.heading), 0);
    rider.update(bike, dt, eaten / course.fishTotal);

    if (state === 'ready') {
      // 出发前：镜头绕着鹈鹕慢慢转，一圈半分钟，顺便把这个场景四周都看一遍；高度也跟着一起一伏。
      // 往下看一点，鹈鹕落在画面上半部，下面留给标题
      const around = p.yaw + 2.5 + (still ? 0 : time * 0.21);
      const radius = 6.6 + (still ? 0 : Math.sin(time * 0.33) * 0.9);
      wantPos.set(p.x - Math.sin(around) * radius, p.y + 2 + (still ? 0 : Math.sin(time * 0.27) * 0.5), p.z + Math.cos(around) * radius);
      wantLook.set(p.x, p.y + 0.5, p.z);
    } else if (bike.finished && !still && !out) {
      // 冲过终点：镜头绕着鹈鹕转一圈多，最后停在它的侧前方，结算面板出在画面下半
      const u = Math.min(1, Math.max(0, 1 - finishTimer / ORBIT.seconds));
      const ease = u * u * (3 - 2 * u);
      // 0 是正后方，转过去的角度加在路的朝向上
      const around = p.yaw + ease * ORBIT.sweep;
      const radius = CAM_BACK + (ORBIT.radius - CAM_BACK) * ease;
      const centre = rider.group.position;
      wantPos.set(centre.x - Math.sin(around) * radius, bike.h + CAM_UP + (ORBIT.height - CAM_UP) * ease, centre.z + Math.cos(around) * radius);
      // 视线越转越往下落，鹈鹕就升到画面上半，正中间留给结算面板
      wantLook.set(centre.x, bike.h + 1.1 - 1.65 * ease, centre.z);
    } else {
      // 骑行中：镜头跟着路走而不是跟着车头走，车左右晃的时候画面不跟着甩。
      // 镜头横着只跟一小半：跟得太紧的话车永远在画面正中，换了车道也看不出自己挪了
      camSide += (bike.x * CAM_FOLLOW - camSide) * Math.min(1, dt * 4);
      // 掉进深沟时镜头留在崖上，视线往沟里压，看得见鹈鹕扑腾着飞上来
      const height = bike.rescue > 0 ? bike.h : Math.max(bike.h, p.y);
      track.at(bike.s - CAM_BACK, p);
      wantPos.set(p.x + Math.cos(p.yaw) * camSide, Math.max(p.y, height - 1.2) + CAM_UP, p.z + Math.sin(p.yaw) * camSide);
      track.at(bike.s + CAM_AHEAD, p);
      wantLook.set(p.x + Math.cos(p.yaw) * bike.x * CAM_AIM, (p.y + height) / 2 + 1.1, p.z + Math.sin(p.yaw) * bike.x * CAM_AIM);
    }
    if (snapCamera) {
      camPos.copy(wantPos);
      camLook.copy(wantLook);
      snapCamera = false;
    } else {
      // 骑得越快镜头追得越紧：追的快慢不变的话，猛冲时车会甩开镜头五六米，鹈鹕小得看不清
      camPos.lerp(wantPos, 1 - Math.exp(-dt * 6 * Math.max(1, bike.v / 19)));
      camLook.lerp(wantLook, 1 - Math.exp(-dt * 8));
    }
    camera.position.copy(camPos);
    camera.lookAt(camLook);
    // 撞到路障：镜头上下抖两三下，越抖越小
    if (shake > 0) {
      shake = Math.max(0, shake - dt);
      if (!still) camera.position.y += Math.sin(shake * 70) * 0.12 * (shake / SHAKE_SECONDS);
    }

    // 冲刺时视野稍微拉宽一点
    const rush = Math.min(1.6, Math.max(0, (bike.v - BIKE_SPEED.cruise) / (BIKE_SPEED.sprint - BIKE_SPEED.cruise)));
    const fov = FOV + (still ? 0 : rush * FOV_DASH) + (camera.aspect < 1 ? 14 : 0);
    camFov += (fov - camFov) * Math.min(1, dt * 5);
    if (Math.abs(camera.fov - camFov) > 0.01) {
      camera.fov = camFov;
      camera.updateProjectionMatrix();
    }
    world?.update(bike.s, camPos, rider.group.position, time);
  };

  // 冲刺时屏幕上的速度线（用户要的「按方向键、按空格、捡了火箭三种特效不一样」）：画在盖在画面上的一张 2D 画布上。
  // 冲刺是边上几根细白线；猛冲更密更长、偏橙色，四周压一圈暖色；超级加速是满屏的青白色线，四周一圈青光，刚吃到那一下整屏一闪
  const rushCtx = rushCanvas.getContext('2d');
  const STREAKS = 90;
  const streaks = Array.from({ length: STREAKS }, () => ({ angle: Math.random() * Math.PI * 2, r: 0.3 + Math.random() * 0.9, speed: 0.6 + Math.random() * 0.8 }));
  let rushLevel = 0;
  let rushMode: '' | 'dash' | 'turbo' | 'super' = '';
  let flash = 0;
  const RUSH_LOOK = {
    dash: { count: 26, length: 0.12, width: 1, color: '255,255,255', alpha: 0.38, edge: '', edgeAlpha: 0 },
    turbo: { count: 54, length: 0.2, width: 1.4, color: '255,214,170', alpha: 0.5, edge: '255,110,40', edgeAlpha: 0.26 },
    super: { count: 90, length: 0.3, width: 1.8, color: '200,248,255', alpha: 0.62, edge: '70,210,255', edgeAlpha: 0.34 },
  } as const;
  const paintRush = (dt: number) => {
    if (!rushCtx) return;
    const mode = state !== 'playing' || bike.finished ? '' : bike.blast > 0 ? 'super' : bike.turbo ? 'turbo' : bike.rushing ? 'dash' : '';
    if (mode) rushMode = mode;
    rushLevel += ((mode ? 1 : 0) - rushLevel) * Math.min(1, dt * (mode ? 6 : 4));
    flash = Math.max(0, flash - dt * 3.2);
    const width = rushCanvas.width;
    const height = rushCanvas.height;
    rushCtx.clearRect(0, 0, width, height);
    if (rushLevel < 0.01 && flash <= 0) return;
    const look = RUSH_LOOK[rushMode || 'dash'];
    const cx = width / 2;
    const cy = height * 0.42;
    const reach = Math.hypot(width, height) / 2;
    if (look.edge) {
      // 四周一圈光：中间透明，越往边上越浓
      const glow = rushCtx.createRadialGradient(cx, cy, reach * 0.45, cx, cy, reach * 1.05);
      glow.addColorStop(0, `rgba(${look.edge},0)`);
      glow.addColorStop(1, `rgba(${look.edge},${(look.edgeAlpha * rushLevel).toFixed(3)})`);
      rushCtx.fillStyle = glow;
      rushCtx.fillRect(0, 0, width, height);
    }
    if (flash > 0) {
      rushCtx.fillStyle = `rgba(220,250,255,${(flash * 0.35).toFixed(3)})`;
      rushCtx.fillRect(0, 0, width, height);
    }
    // 减少动态效果时只留四周那圈光，不画飞过去的线
    if (still) return;
    const pace = 0.55 + bike.v / 30;
    rushCtx.lineCap = 'round';
    rushCtx.lineWidth = look.width * (width / Math.max(1, rushCanvas.clientWidth));
    rushCtx.strokeStyle = `rgb(${look.color})`;
    for (let i = 0; i < look.count; i += 1) {
      const streak = streaks[i];
      streak.r += dt * streak.speed * pace * (0.4 + streak.r);
      if (streak.r > 1.25) {
        streak.r = 0.3 + Math.random() * 0.15;
        streak.angle = Math.random() * Math.PI * 2;
      }
      // 越靠近中间越淡，中间那一块（鹈鹕在的地方）几乎看不见
      const fade = Math.min(1, Math.max(0, (streak.r - 0.38) / 0.3));
      if (fade <= 0) continue;
      const dx = Math.cos(streak.angle);
      const dy = Math.sin(streak.angle);
      const from = streak.r * reach;
      const to = from + look.length * reach * (0.6 + streak.speed * 0.4);
      rushCtx.globalAlpha = look.alpha * fade * rushLevel;
      rushCtx.beginPath();
      rushCtx.moveTo(cx + dx * from, cy + dy * from);
      rushCtx.lineTo(cx + dx * to, cy + dy * to);
      rushCtx.stroke();
    }
    rushCtx.globalAlpha = 1;
  };

  let shownScore = -1;
  let shownSpeed = -1;
  let shownHealth = -1;
  let shownEaten = -1;
  let shownKeepsakes = -1;
  const paint = (dt: number) => {
    if (score !== shownScore) {
      shownScore = score;
      scoreNode.textContent = String(score);
    }
    if (eaten !== shownEaten) {
      shownEaten = eaten;
      eatenNode.textContent = String(eaten);
    }
    if (keepsakes.size !== shownKeepsakes) {
      shownKeepsakes = keepsakes.size;
      keepsakeNode.textContent = String(keepsakes.size);
      keepsakeTotal.textContent = `/${course.scenes.length}`;
    }
    if (health !== shownHealth) {
      shownHealth = health;
      hearts.forEach((heart, i) => {
        heart.dataset.fill = String(Math.max(0, Math.min(2, health - i * 2)));
      });
      heartBox.setAttribute('aria-label', `生命 ${health / 2} 颗心`);
    }
    if (hurtTimer > 0) {
      hurtTimer -= dt;
      heartBox.toggleAttribute('data-hurt', hurtTimer > 0);
    }
    progressNode.style.transform = `scaleX(${Math.min(1, Math.max(0, bike.s / track.finish)).toFixed(4)})`;
    boostNode.style.transform = `scaleX(${(bike.blast > 0 ? bike.blastLeft : bike.boost).toFixed(3)})`;
    boostBox.toggleAttribute('data-active', bike.rushing);
    // 冲刺时冲刺条上烧着一排火苗，猛冲时烧得更高（用户要求）。火苗的高矮每帧在这里算，不用自己循环的动画
    // 吃了辣椒的那几秒一直烧着，冲刺条是金色的
    // 火箭那几秒是第四种：青色，冲刺条变成倒计时
    const burn = bike.blast > 0 ? '4' : bike.fever > 0 ? '3' : bike.turbo ? '2' : bike.dashing ? '1' : '';
    // 状态栏上那两个字和右边的小字也跟着换：冲刺 / 猛冲（耗双倍）/ 辣椒（不掉）/ 超级加速（还剩几秒）
    const label = burn === '4' ? '超速' : burn === '3' ? '辣椒' : burn === '2' ? '猛冲' : '冲刺';
    if (boostLabel.textContent !== label) boostLabel.textContent = label;
    const note = burn === '4' ? (bike.blast).toFixed(1) : burn === '3' ? '∞' : burn === '2' ? '×2' : '';
    if (boostNum.textContent !== note) boostNum.textContent = note;
    if ((boostBox.dataset.burn ?? '') !== burn) {
      if (burn) boostBox.dataset.burn = burn;
      else delete boostBox.dataset.burn;
    }
    if (burn) {
      flameBox.style.width = `${((bike.blast > 0 ? bike.blastLeft : bike.boost) * 100).toFixed(1)}%`;
      const tall = burn === '1' ? 0.55 : burn === '4' ? 1.25 : 1;
      flames.forEach((flame, i) => {
        // 越靠近冲刺条的头上烧得越高；几个不成倍数的正弦叠起来，每根火苗各跳各的
        const lead = 0.4 + 0.6 * (i / (flames.length - 1));
        const flick = still ? 0.8 : 0.62 + 0.24 * Math.sin(time * 23 + i * 2.4) + 0.14 * Math.sin(time * 37 + i * 5.1);
        flame.style.transform = `scaleY(${(tall * lead * flick).toFixed(3)})`;
      });
    }
    // 画面外框上的十字键和两颗圆键跟着按键亮
    const press = `${keys.left || touch.left > 0 ? 'l ' : ''}${keys.right || touch.right > 0 ? 'r ' : ''}${keys.dash || touch.dash ? 'u ' : ''}${keys.turbo || touch.turbo ? 'a' : ''}`;
    if (root.dataset.press !== press) root.dataset.press = press;
    // 冲刺条的颜色跟着余量走：多、不多、快没了
    const level = bike.boost < 0.25 ? 'low' : bike.boost < 0.6 ? 'mid' : 'high';
    if (boostBox.dataset.level !== level) boostBox.dataset.level = level;

    speedNode.style.transform = `scaleX(${Math.min(1, bike.v / SPEED_FULL).toFixed(3)})`;
    const speed = Math.round(bike.v * 3.6);
    if (speed !== shownSpeed) {
      shownSpeed = speed;
      speedNum.textContent = String(speed);
    }

    // 每进一个新场景，报一次名字
    const current = track.sceneAt(bike.s);
    if (current !== themed) {
      themed = current;
      applyTheme(course.scenes[current]);
    }
    if (state === 'playing' && current !== sceneShown && !bike.finished) {
      // 一出发报的那一次不敲钟，后面每进一个新场景敲一下
      // 每个场景一首配乐，过门时交叉淡过去；顺手把下一段的先下载下来
      sound.setScene(course.scenes[current].name);
      const next = course.scenes[current + 1];
      if (next) sound.fetchScenes([next.name]);
      if (sceneShown >= 0) {
        sound.play('gate');
        // 每进一个新场景回半颗心
        health = Math.min(HEARTS * 2, health + 1);
      }
      sceneShown = current;
      showToast(course.scenes[current].name);
    }
    // 出发前那行提示一明一暗地呼吸
    overlayText.style.opacity = state === 'ready' && !still ? (0.62 + Math.sin(time * 2.4) * 0.38).toFixed(2) : '';
    if (toastTimer > 0 && state !== 'paused') {
      toastTimer -= dt;
      if (toastTimer <= 0) delete toastNode.dataset.show;
    }
  };

  let raf = 0;
  let last = performance.now();
  let accumulator = 0;

  const frame = (now: number) => {
    // 先取消上一次排的：调试时会手动多调几次这个函数，不取消的话每调一次就多出一条一直跑下去的循环
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(frame);
    const real = (now - last) / 1000;
    // 切走再回来时这一帧会特别长，按上限算，免得车一下子冲出去
    // 下限是 0：调试时手动把时钟往前推过以后，浏览器自己的下一帧时刻反而更早，
    // 时间差是负的，镜头的缓动会被反着算，越追越远，画面只剩天空甚至全黑
    const dt = Math.min(Math.max(real, 0), 0.1);
    last = now;

    if (state === 'playing') {
      watchSpeed(real);
      time += dt;
      accumulator += dt;
      while (accumulator >= TICK) {
        controls.steer = (keys.right || touch.right > 0 ? 1 : 0) - (keys.left || touch.left > 0 ? 1 : 0);
        controls.dash = keys.dash || touch.dash;
        // 按住空格是冲刺的更快一档（用户要求）：比按方向键还快，冲刺条耗得快一倍
        controls.turbo = keys.turbo || touch.turbo;
        bike.step(TICK, course, controls);
        eat();
        bump();
        accumulator -= TICK;
      }
      if (!bike.finished) elapsed += dt;
      if (finishTimer > 0) {
        finishTimer -= dt;
        if (finishTimer <= 0) setState('finished');
      }
    } else if (state === 'ready') {
      time += dt;
    }

    place(dt);
    paint(dt);
    paintRush(dt);
    if (QUALITY[quality].bloom) composer.render();
    else renderer.render(scene, camera);
  };

  // 只在本地开发时挂出来，方便在控制台里看车的状态；构建产物里没有
  if (import.meta.env.DEV) {
    Object.assign(window, {
      __pelican: {
        bike,
        get course() {
          return course;
        },
        get quality() {
          return quality;
        },
        get renderer() {
          return renderer;
        },
        // 窗口被隐藏时浏览器不给动画帧，手动往前推这么多秒，照样能看画面
        advance(seconds: number) {
          for (let t = 0; t < seconds; t += 1 / 30) frame(last + 1000 / 30);
        },
        // 直接跳到路上某个位置，镜头也跟着跳过去，看各个场景用
        jump(s: number) {
          bike.s = s;
          // 往回跳的时候，「从哪个下标往后找」也要退回去
          itemFrom = 0;
          blockFrom = 0;
          bike.x = 0;
          bike.heading = 0;
          // 放在离地一点的空中让它自己落下去：直接贴地的话，两处路面的高度差会被当成一步之内升上去的，车会被弹上天
          bike.h = track.at(s, p).y + 0.4;
          bike.vy = 0;
          bike.grounded = false;
          snapCamera = true;
        },
      },
    });
  }

  setState('ready');
  raf = requestAnimationFrame(frame);

  return () => {
    cancelAnimationFrame(raf);
    abort.abort();
    sizeWatch.disconnect();
    sound.dispose();
    rider.dispose();
    world?.dispose();
    composer.dispose();
    renderer.dispose();
  };
}
