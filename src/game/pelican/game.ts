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
import type { Scene } from './scenes';
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
const FOV = 64;
const FOV_DASH = 12;
// 嘴离鱼多近算吃到：沿路、横向、上下（米）
const REACH = { along: 1.5, across: 1.5, up: 1.6 };
// 空格按住超过这么久（秒）算长按，是冲刺；没到就松开才是起跳
const HOLD_SECONDS = 0.2;
// 速度条在这个速度（米每秒）时是满的
const SPEED_FULL = 30;
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

function pick<T extends HTMLElement>(root: HTMLElement, selector: string): T {
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
  const scoreNode = pick<HTMLElement>(root, '[data-score]');
  const progressNode = pick<HTMLElement>(root, '[data-progress]');
  const boostNode = pick<HTMLElement>(root, '[data-boost]');
  const boostBox = pick<HTMLElement>(root, '[data-boost-box]');
  const recordNode = pick<HTMLElement>(root, '[data-record]');
  const toastNode = pick<HTMLElement>(root, '[data-toast]');
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
  const jumpButton = pick<HTMLButtonElement>(root, '[data-jump]');
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
    course = new Course(shuffledOrder(), Math.floor(Math.random() * 1e9));
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
    themed = -1;
  };
  build();

  let state: State = 'ready';
  let score = 0;
  let eaten = 0;
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

  const onBikeEvent = (event: BikeEvent) => {
    // 到终点后先让镜头绕一圈再出结算面板；减少动态效果时不绕，等一下就出
    if (event === 'finish') finishTimer = still ? 1.4 : ORBIT.seconds;
    // 落地声的大小跟着摔得多重走，轻轻一颠就很小声
    if (event === 'land') sound.play('land', 0.35 + bike.squash * 0.65);
    else sound.play(event);
  };
  const bike: Bike = new Bike(onBikeEvent);
  bike.reset(course);

  // 按键和触屏各记各的，合起来才是这一步的输入
  // hold 是长按空格的冲刺。空格短按是起跳、长按是冲刺：按下时先记下时刻，按够了时间就开始冲，没按够就松开才跳
  const keys = { left: false, right: false, dash: false, hold: false };
  let spaceDown = false;
  let spaceSince = 0;
  const touch = { left: 0, right: 0, dash: false };
  const controls: Controls = { steer: 0, jump: false, dash: false };
  let jumpQueued = false;

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

  const showToast = (text: string) => {
    toastNode.textContent = text;
    toastNode.dataset.show = '1';
    toastTimer = 2.6;
  };

  const finish = () => {
    const total = course.fishTotal;
    const best = loadBest();
    const record = !best || score > best.score;
    if (record) saveBest({ score, fish: eaten, seconds: Math.round(elapsed) });
    // 面板上只写分数和用时；吃了多少鱼、是不是新纪录写在画面下面那一行的左边
    const notes = [`本局小鱼 ${eaten} / ${total}`];
    if (record && best) notes.push(`新纪录，之前最好 ${best.score}`);
    else if (record) notes.push('新纪录');
    else if (best) notes.push(`最好成绩 ${best.score}`);
    recordNode.textContent = notes.join('　');
    showOverlay('抵达终点', '再骑一次', '', [score, clock(elapsed)]);
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
    showBest();
    score = 0;
    eaten = 0;
    elapsed = 0;
    finishTimer = 0;
    accumulator = 0;
    sceneShown = -1;
    // 从出发前的环绕镜头接过来时不硬切，让镜头自己绕回车后面；再骑一次才直接跳过去
    snapCamera = state !== 'ready';
    jumpQueued = false;
    setState('playing');
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
        // 出发前按空格也能开始（这一下不算起跳）
        if (down && !event.repeat && state === 'ready') {
          sound.start();
          restart();
          break;
        }
        if (down) {
          if (!event.repeat && state === 'playing') {
            spaceDown = true;
            spaceSince = performance.now();
          }
        } else {
          // 还没按够长按的时间就松开了：这是一次起跳
          if (spaceDown && !keys.hold && state === 'playing') jumpQueued = true;
          spaceDown = false;
          keys.hold = false;
        }
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
      keys.left = keys.right = keys.dash = keys.hold = false;
      spaceDown = false;
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

  jumpButton.addEventListener(
    'pointerdown',
    (event) => {
      event.preventDefault();
      if (state === 'playing') jumpQueued = true;
    },
    { signal },
  );
  const holdDash = (down: boolean) => (event: Event) => {
    event.preventDefault();
    touch.dash = down;
  };
  dashButton.addEventListener('pointerdown', holdDash(true), { signal });
  dashButton.addEventListener('pointerup', holdDash(false), { signal });
  dashButton.addEventListener('pointercancel', holdDash(false), { signal });
  dashButton.addEventListener('pointerleave', holdDash(false), { signal });

  const resize = () => {
    const width = stage.clientWidth;
    const height = stage.clientHeight;
    if (!width || !height) return;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, QUALITY[quality].ratio));
    renderer.setSize(width, height, false);
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
      if (item.kind !== 'bolt') eaten += 1;
      score += SCORE[item.kind];
      bike.refill(REFILL[item.kind]);
      world?.collect(i, time);
      rider.gulp();
      sound.play(item.kind);
    }
  };

  // 撞路障：贴着地、又正好在它那条车道上才算撞到；跳起来就过去了。撞上只是慢一下，路障被撞飞
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
    } else if (bike.finished && !still) {
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
      const height = Math.max(bike.h, p.y);
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
      camPos.lerp(wantPos, 1 - Math.exp(-dt * 6));
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
    const rush = Math.min(1, Math.max(0, (bike.v - BIKE_SPEED.cruise) / (BIKE_SPEED.sprint - BIKE_SPEED.cruise)));
    const fov = FOV + (still ? 0 : rush * FOV_DASH) + (camera.aspect < 1 ? 14 : 0);
    camFov += (fov - camFov) * Math.min(1, dt * 5);
    if (Math.abs(camera.fov - camFov) > 0.01) {
      camera.fov = camFov;
      camera.updateProjectionMatrix();
    }
    world?.update(bike.s, camPos, rider.group.position, time);
  };

  let shownScore = -1;
  let shownSpeed = -1;
  const paint = (dt: number) => {
    if (score !== shownScore) {
      shownScore = score;
      scoreNode.textContent = String(score);
    }
    progressNode.style.transform = `scaleX(${Math.min(1, Math.max(0, bike.s / track.finish)).toFixed(4)})`;
    boostNode.style.transform = `scaleX(${bike.boost.toFixed(3)})`;
    boostBox.toggleAttribute('data-active', bike.rushing);
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
      if (sceneShown >= 0) sound.play('gate');
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
    raf = requestAnimationFrame(frame);
    const real = (now - last) / 1000;
    // 切走再回来时这一帧会特别长，按上限算，免得车一下子冲出去
    const dt = Math.min(real, 0.1);
    last = now;

    if (state === 'playing') {
      watchSpeed(real);
      time += dt;
      accumulator += dt;
      while (accumulator >= TICK) {
        controls.steer = (keys.right || touch.right > 0 ? 1 : 0) - (keys.left || touch.left > 0 ? 1 : 0);
        if (spaceDown && !keys.hold && performance.now() - spaceSince > HOLD_SECONDS * 1000) keys.hold = true;
        controls.dash = keys.dash || keys.hold || touch.dash;
        controls.jump = jumpQueued;
        jumpQueued = false;
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
