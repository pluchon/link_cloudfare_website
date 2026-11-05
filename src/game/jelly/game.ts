import {
  containsPoint,
  createWorld,
  hopInTray,
  predictLanding,
  makeBlob,
  radiusOf,
  setVelocity,
  step,
  topOf,
  type Blob,
  type Bounds,
} from './physics';
import { createDealer, TRAY_CAP } from './dealer';
import { createDing } from './sound';

// 逻辑坐标：高固定 600，宽在开局时按画板的宽高比定（400–1000），PC 上是一口宽井，手机上是窄井。
// 一局之中宽度不变，窗口变了只是重新缩放，物理和判定都在这套坐标里算
const H = 600;
const MIN_W = 400;
const MAX_W = 1000;
// 托盘高 112：一排果冻坐在托盘底上，上方留出的空间够弹起来的果冻从别人头上越过
const TRAY_TOP = 10;
const TRAY_BOTTOM = 122;
const WELL_TOP = 138;
const WELL_BOTTOM = 590;
const DANGER_Y = 196;
// 容错：果冻 Q 弹晃动时会擦过线，越线超过 6 个单位、刚落下 0.9 秒以后、连续 2.5 秒才算输
const DANGER_SLACK = 6;
const DANGER_GRACE = 0.9;
const DANGER_LIMIT = 2.5;
const REFILL_GAP = 0.32;
const ENTER_TIMEOUT = 1.6;
// 按住只拉不拖，松手顺着「果冻 → 手指」的方向弹出去，拉开的距离最多算 120，拉不到 14 松手算取消：
// - 手指在托盘底边以下 DROP_MARGIN：弹进井里，速度 = 距离 × 8
// - 否则在托盘里弹（往上、往两边）：速度 = 距离 × 6，不会掉进井里
const MAX_PULL = 120;
const MIN_PULL = 14;
const DROP_MARGIN = 8;
const LAUNCH = 8;
const HOP_LAUNCH = 6;
// 连锁合成慢放：上一次合成后 0.6 秒（游戏内时间）内又合成就算连锁。
// 每多连一次慢 16%，合出来的数字超过 64 每大一级再慢 3%，最慢到 0.3 倍；停下以后每秒恢复 1.2
const CHAIN_GAP = 0.6;
const CHAIN_SLOW = 0.16;
const LEVEL_SLOW = 0.03;
const MIN_SPEED = 0.3;
const SPEED_RECOVER = 1.2;
// 一帧最多补 4 个子步，卡的时候宁可慢一点，也不越补越卡
const MAX_STEPS = 4;
// 新果冻从两侧滑进来时带的速度
const ENTER_SPEED = 520;
// 井里的果冻速度超过这个就算还在飞，危险线的计时从停下来才开始
const MOVING = 260;
const STEP = 1 / 120;
const STORE_KEY = 'nn-jelly-2048';
// 本机最佳最多存这么多局，显示几行看面板放得下多少
const MAX_RECORDS = 20;
// 刷新、关页面、浏览器后退时存一份进度：15 分钟内回来接着玩（多半是误刷新），超过就把那一局记进成绩、开新局。
// 点站内链接离开、点重开是明确要走，会先问一句，确定就当场结算
const RESUME_WINDOW = 15 * 60 * 1000;
const LADDER = [2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096, 8192];

interface Rec {
  score: number;
  time: number;
  tile: number;
  at: string;
}

interface Saved {
  w: number;
  score: number;
  time: number;
  tile: number;
  reached: boolean;
  well: [number, number, number][];
  tray: number[];
  // 存档时刻（毫秒），用来判断是不是在续玩时限内回来的
  at?: number;
}

interface Store {
  best: number;
  records: Rec[];
  muted: boolean;
  save: Saved | null;
}

interface Popup {
  text: string;
  x: number;
  y: number;
  t: number;
  color: string;
}

// 每一级一个色相，2048 用站点强调色，再往上用正文色
const HUES = [340, 12, 36, 52, 95, 150, 178, 204, 228, 265];

function loadStore(): Store {
  const empty: Store = { best: 0, records: [], muted: false, save: null };
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return empty;
    return { ...empty, ...(JSON.parse(raw) as Partial<Store>) };
  } catch {
    return empty;
  }
}

function writeStore(store: Store) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch {
    // 无痕窗口或存储被禁用时只是不保存，游戏照常
  }
}

export function formatTime(seconds: number): string {
  const s = Math.floor(seconds);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function dateOf(ms = Date.now()): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function mountJelly(root: HTMLElement): () => void {
  const canvas = root.querySelector<HTMLCanvasElement>('[data-canvas]')!;
  const board = canvas.parentElement!;
  const ctx = canvas.getContext('2d')!;
  const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const scoreEl = $('[data-score]');
  const bestEl = $('[data-best]');
  const timeEl = $('[data-time]');
  const tileEl = $('[data-tile]');
  const pauseBtn = $<HTMLButtonElement>('[data-pause]');
  const muteBtn = $<HTMLButtonElement>('[data-mute]');
  const restartBtn = $<HTMLButtonElement>('[data-restart]');
  const clearBtn = $<HTMLButtonElement>('[data-clear-records]');
  // 按钮里有图标，文字写在里面的文字节点上
  const textOf = (btn: HTMLElement) => btn.querySelector<HTMLElement>('[data-text]') ?? btn;
  const pauseText = textOf(pauseBtn);
  const muteText = textOf(muteBtn);
  const overlay = $('[data-overlay]');
  const overlayTitle = $('[data-overlay-title]');
  const overlayText = $('[data-overlay-text]');
  const overlayBtn = $<HTMLButtonElement>('[data-overlay-btn]');
  const recordsEl = $('[data-records]');
  const recordsBox = $('[data-records-box]');
  const recordsEmpty = $('[data-records-empty]');
  const recordsTable = $('[data-records-table]');
  const confirmBox = $<HTMLDialogElement>('[data-confirm]');
  const confirmText = $('[data-confirm-text]');
  const confirmOk = $<HTMLButtonElement>('[data-confirm-ok]');
  const narrow = window.matchMedia('(max-width: 48rem)');
  const ladderEl = root.querySelector<HTMLElement>('[data-ladder]');

  const store = loadStore();
  // 写回前先读一遍磁盘上的成绩：同时开着两个游戏标签页时，各自内存里的记录是旧的，整份写回会把对方刚记的成绩冲掉
  function commit() {
    const disk = loadStore();
    store.records = disk.records;
    store.best = Math.max(store.best, disk.best);
    writeStore(store);
  }
  const ding = createDing();
  ding.setMuted(store.muted);
  let dealer = createDealer();

  let W = MIN_W;
  const bounds: Bounds = {
    trayL: 10,
    trayR: W - 10,
    trayTop: TRAY_TOP,
    trayBottom: TRAY_BOTTOM,
    wellL: 10,
    wellR: W - 10,
    wellBottom: WELL_BOTTOM,
  };
  let traySize = 3;

  function setWidth(w: number) {
    W = w;
    bounds.trayR = bounds.wellR = W - 10;
    traySize = W >= 640 ? 4 : 3;
  }

  // 画板的内容区（去掉内边距）
  function boardBox(): { width: number; height: number } {
    const cs = getComputedStyle(board);
    const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    return { width: board.clientWidth - padX, height: board.clientHeight - padY };
  }

  // 画板现在的宽高比能放下多宽的井
  function fitWidth(): number {
    const box = boardBox();
    if (box.width <= 0 || box.height <= 0) return MIN_W;
    return Math.round(Math.min(MAX_W, Math.max(MIN_W, (H * box.width) / box.height)));
  }

  let score = 0;
  let time = 0;
  let tile = 2;
  let reached = false;
  let started = false;
  let paused = false;
  let over = false;
  let dangerT = 0;
  let refillDue = true;
  let refillT = 0;
  let popups: Popup[] = [];
  let toastT = 0;
  let saveT = 0;
  let dirty = false;
  let grabbed: Blob | null = null;
  // 落点预测的路径（x, y 交替），每帧复用
  const aimPath: number[] = [];
  // 游戏内时间（会被慢放拖慢）、上一次井里合成的时刻、连锁数、当前慢放倍率
  let simT = 0;
  let lastMerge = -Infinity;
  let chain = 0;
  let speed = 1;

  const world = createWorld(bounds, {
    // 托盘里相同的挨着就自动合，拖过去碰到也合，只是不能超过上限
    canMerge: (a) => a.zone === 'well' || a.value * 2 <= TRAY_CAP,
    onMerge: (merged, [a, b]) => {
      // 拖着的那个合掉了：手里就空了
      if (a === grabbed || b === grabbed) {
        grabbed = null;
        canvas.style.cursor = '';
      }
      score += merged.value;
      tile = Math.max(tile, merged.value);
      dirty = true;
      // 井里连锁合成：连得越多、合出的数越大，整个画面越慢，音效也跟着放慢变闷
      if (merged.zone === 'well') {
        chain = simT - lastMerge < CHAIN_GAP ? chain + 1 : 1;
        lastMerge = simT;
        if (chain >= 2) {
          const slow = 1 - CHAIN_SLOW * (chain - 1) - LEVEL_SLOW * Math.max(0, merged.level - 6);
          speed = Math.min(speed, Math.max(MIN_SPEED, slow));
        }
      }
      ding.play(speed);
      popups.push({ text: `+${merged.value}`, x: merged.cx, y: merged.cy - merged.targetR * 0.4, t: 0, color: colorOf(merged.level) });
      if (merged.value === 2048 && !reached) {
        reached = true;
        toastT = 2.4;
      }
    },
  });

  // ---------- 主题 ----------
  let dark = false;
  let theme = { fg: '#000', muted: '#666', faint: '#999', line: '#ddd', strong: '#ccc', accent: '#c6462f', pink: '#f3a3bd', mono: 'monospace', serif: 'serif' };
  // 每一级的颜色每帧都要用好几次，拼好的字符串缓存起来，主题变了再清掉
  const colorCache = new Map<number, string>();
  function readTheme() {
    const cs = getComputedStyle(document.documentElement);
    const v = (name: string) => cs.getPropertyValue(name).trim();
    dark = document.documentElement.dataset.theme === 'dark';
    colorCache.clear();
    theme = {
      fg: v('--fg'),
      muted: v('--fg-muted'),
      faint: v('--fg-faint'),
      line: v('--line'),
      strong: v('--line-strong'),
      accent: v('--accent'),
      pink: v('--icon-pink'),
      mono: v('--font-mono'),
      serif: v('--font-serif'),
    };
  }
  function colorOf(level: number): string {
    let color = colorCache.get(level);
    if (color) return color;
    if (level === 11) color = theme.accent;
    else if (level > 11) color = theme.fg;
    else {
      const hue = HUES[Math.max(0, level - 1)];
      color = dark ? `hsl(${hue} 66% 70%)` : `hsl(${hue} 58% 44%)`;
    }
    colorCache.set(level, color);
    return color;
  }
  readTheme();
  const themeWatch = new MutationObserver(() => {
    readTheme();
    renderLadder();
    if (!running) draw();
  });
  themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-palette'] });

  // ---------- 画布尺寸：按逻辑宽高比装进画板，多出来的留白居中 ----------
  let scale = 1;
  let dpr = 1;
  function resize() {
    const box = boardBox();
    if (box.width <= 0 || box.height <= 0) return;
    const cssW = Math.min(box.width, (box.height * W) / H);
    const cssH = (cssW * H) / W;
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(cssW * dpr));
    canvas.height = Math.max(1, Math.round(cssH * dpr));
    scale = canvas.width / W;
    fitRecords();
    if (!running) draw();
  }
  const sizeWatch = new ResizeObserver(resize);
  sizeWatch.observe(board);
  const recordsWatch = new ResizeObserver(() => fitRecords());
  recordsWatch.observe(recordsBox);

  // ---------- 托盘 ----------
  function spawnTray(value: number, side: number) {
    const r = radiusOf(Math.round(Math.log2(value)));
    const x = side < 0 ? bounds.trayL - r - 2 : bounds.trayR + r + 2;
    // 贴着托盘底滑进来
    const y = TRAY_BOTTOM - r - 1;
    const blob = makeBlob(value, x, y, 'tray');
    blob.entering = side;
    // 带着速度滑进来，撞到已有的会把它们推开
    setVelocity(blob, -side * ENTER_SPEED, 0, STEP);
    world.blobs.push(blob);
  }

  // ---------- 一局 ----------
  function newGame() {
    world.blobs = [];
    world.grab = null;
    grabbed = null;
    dealer = createDealer();
    setWidth(fitWidth());
    score = 0;
    time = 0;
    simT = 0;
    lastMerge = -Infinity;
    chain = 0;
    speed = 1;
    tile = 2;
    reached = false;
    started = false;
    over = false;
    paused = false;
    pauseText.textContent = '暂停';
    pauseBtn.setAttribute('aria-pressed', 'false');
    dangerT = 0;
    refillDue = true;
    refillT = 0;
    popups = [];
    toastT = 0;
    store.save = null;
    commit();
    hideOverlay();
    resize();
    renderLadder();
    syncHud(true);
    start();
  }

  // 存档里的井宽可能和现在的画板不一样（手机上存的、电脑上接着玩），按现在的宽度把横坐标等比摊开
  function restore(save: Saved) {
    const oldW = save.w || MIN_W;
    setWidth(fitWidth());
    const sx = (W - 20) / (oldW - 20);
    score = save.score;
    time = save.time;
    tile = save.tile;
    reached = save.reached;
    started = true;
    for (const [value, x, y] of save.well) {
      const r = radiusOf(Math.round(Math.log2(value)));
      const nx = Math.min(Math.max(10 + (x - 10) * sx, 10 + r), W - 10 - r);
      const blob = makeBlob(value, nx, y, 'well', r * 0.8);
      blob.age = DANGER_GRACE;
      world.blobs.push(blob);
    }
    save.tray.forEach((value, i) => {
      const x = bounds.trayL + ((i + 0.5) / traySize) * (bounds.trayR - bounds.trayL);
      world.blobs.push(makeBlob(value, x, (TRAY_TOP + TRAY_BOTTOM) / 2, 'tray', 12));
    });
    refillDue = save.tray.length < traySize;
  }

  function snapshot(): Saved {
    return {
      w: W,
      score,
      time,
      tile,
      reached,
      well: world.blobs
        .filter((b) => b.zone === 'well')
        .map((b) => [b.value, Math.round(b.cx), Math.round(Math.max(b.cy, DANGER_Y + b.targetR))]),
      tray: world.blobs.filter((b) => b.zone === 'tray').map((b) => b.value),
      at: Date.now(),
    };
  }

  function persist() {
    if (over || !started) return;
    store.save = snapshot();
    commit();
    dirty = false;
  }

  // 把一局记进成绩（0 分的不记），清掉存档
  function record(s: number, t: number, maxTile: number, at = Date.now()) {
    const disk = loadStore();
    store.records = disk.records;
    if (s > 0) {
      store.records.push({ score: s, time: Math.floor(t), tile: maxTile, at: dateOf(at) });
      store.records.sort((a, b) => b.score - a.score);
      store.records = store.records.slice(0, MAX_RECORDS);
    }
    store.best = Math.max(store.best, disk.best, s);
    store.save = null;
    writeStore(store);
  }

  // 一局正在进行：已经往井里弹过、还没结束
  const playing = () => started && !over;

  // 明确离开或重开：当场结算这一局。over 置上以后页面卸载时不会再存档
  function settle() {
    if (!playing()) return;
    over = true;
    world.grab = null;
    grabbed = null;
    record(score, time, tile);
    renderRecords();
  }

  function gameOver() {
    over = true;
    world.grab = null;
    grabbed = null;
    speed = 1;
    record(score, time, tile);
    renderRecords();
    syncHud(true);
    showOverlay('溢出啦', `得分 ${score} · 最大 ${tile} · 用时 ${formatTime(time)}`, '再来一局');
  }

  // ---------- 每个子步 ----------
  function update(dt: number) {
    step(world, dt);
    simT += dt;

    let tray = 0;
    for (const b of world.blobs) {
      if (b.zone === 'tray') {
        tray++;
        b.age += dt;
        if (b.entering && b.age > ENTER_TIMEOUT) b.entering = 0;
      } else {
        // 还在飞、还在弹的不算落定，危险线的计时从它慢下来才开始
        const vx = (b.x[0] - b.px[0]) / dt;
        const vy = (b.y[0] - b.py[0]) / dt;
        b.age = vx * vx + vy * vy > MOVING * MOVING ? 0 : b.age + dt;
      }
    }

    if (refillDue) {
      refillT -= dt;
      if (tray >= traySize) refillDue = false;
      else if (refillT <= 0) {
        spawnTray(dealer.value(), dealer.side());
        refillT = REFILL_GAP;
      }
    }

    let danger = false;
    for (const b of world.blobs) {
      if (b.zone !== 'well' || b === grabbed || b.age < DANGER_GRACE) continue;
      if (topOf(b) < DANGER_Y - DANGER_SLACK) {
        danger = true;
        break;
      }
    }
    dangerT = danger ? dangerT + dt : Math.max(0, dangerT - dt * 1.5);
    if (dangerT >= DANGER_LIMIT) gameOver();

    for (const p of popups) p.t += dt;
    popups = popups.filter((p) => p.t < 0.9);
    if (toastT > 0) toastT -= dt;
  }

  // ---------- 绘制 ----------
  function blobPath(b: Blob) {
    const n = b.n;
    ctx.beginPath();
    ctx.moveTo((b.x[n - 1] + b.x[0]) / 2, (b.y[n - 1] + b.y[0]) / 2);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      ctx.quadraticCurveTo(b.x[i], b.y[i], (b.x[i] + b.x[j]) / 2, (b.y[i] + b.y[j]) / 2);
    }
    ctx.closePath();
  }

  function label(text: string, x: number, y: number, align: CanvasTextAlign, color = theme.faint, c = ctx) {
    c.fillStyle = color;
    c.font = `9px ${theme.mono}`;
    c.textAlign = align;
    c.textBaseline = 'middle';
    c.fillText(text, x, y);
  }

  // 背景装饰：井里一层很淡的点阵，左墙一把深度刻度，托盘和井各一个小标签。
  // 这些不会动，画到一张离屏画布上，尺寸、主题、井宽变了才重画，每帧只贴一次
  const frameCanvas = document.createElement('canvas');
  const fctx = frameCanvas.getContext('2d')!;
  let frameKey = '';

  function drawFrame(px: number) {
    const key = `${canvas.width}x${canvas.height}|${W}|${theme.line}|${theme.strong}|${theme.pink}|${theme.faint}`;
    if (key !== frameKey) {
      frameKey = key;
      frameCanvas.width = canvas.width;
      frameCanvas.height = canvas.height;
      fctx.setTransform(scale, 0, 0, scale, 0, 0);
      fctx.clearRect(0, 0, W, H);
      paintFrame(fctx, px);
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(frameCanvas, 0, 0);
    ctx.restore();
  }

  function paintFrame(c: CanvasRenderingContext2D, px: number) {
    const { trayL, trayR, wellL, wellR } = bounds;

    c.fillStyle = theme.line;
    for (let y = WELL_TOP + 24; y < WELL_BOTTOM; y += 24) {
      for (let x = wellL + 24; x < wellR; x += 24) c.fillRect(x - 0.9, y - 0.9, 1.8, 1.8);
    }

    c.lineWidth = px;
    c.strokeStyle = theme.line;
    c.strokeRect(trayL, TRAY_TOP, trayR - trayL, TRAY_BOTTOM - TRAY_TOP);
    // 托盘四角的小折角
    c.strokeStyle = theme.strong;
    c.beginPath();
    for (const [x, y, dx, dy] of [
      [trayL, TRAY_TOP, 1, 1],
      [trayR, TRAY_TOP, -1, 1],
      [trayL, TRAY_BOTTOM, 1, -1],
      [trayR, TRAY_BOTTOM, -1, -1],
    ]) {
      c.moveTo(x + dx * 10, y);
      c.lineTo(x, y);
      c.lineTo(x, y + dy * 10);
    }
    c.stroke();

    c.beginPath();
    c.moveTo(wellL, WELL_TOP);
    c.lineTo(wellL, WELL_BOTTOM);
    c.lineTo(wellR, WELL_BOTTOM);
    c.lineTo(wellR, WELL_TOP);
    c.stroke();

    // 深度刻度：每 20 一短刻，每 100 一长刻
    c.strokeStyle = theme.line;
    c.beginPath();
    for (let y = WELL_BOTTOM - 20, i = 1; y > WELL_TOP; y -= 20, i++) {
      const long = i % 5 === 0;
      c.moveTo(wellL, y);
      c.lineTo(wellL + (long ? 9 : 4), y);
      c.moveTo(wellR, y);
      c.lineTo(wellR - (long ? 9 : 4), y);
    }
    c.stroke();

    c.fillStyle = theme.pink;
    c.beginPath();
    c.arc(trayL + 10, TRAY_TOP + 10, 2.2, 0, Math.PI * 2);
    c.fill();
    label('TRAY', trayL + 17, TRAY_TOP + 10.5, 'left', theme.faint, c);
  }

  // 松手会往哪弹：「果冻 → 手指」的位移（最多 MAX_PULL），以及是不是弹进井里；拉得太短就是 null，松手只是放下
  function launchPull(blob: Blob): { ox: number; oy: number; down: boolean } | null {
    const g = world.grab;
    if (!g) return null;
    let ox = g.tx - blob.cx;
    let oy = g.ty - blob.cy;
    const len = Math.hypot(ox, oy);
    if (len < MIN_PULL) return null;
    if (len > MAX_PULL) {
      ox *= MAX_PULL / len;
      oy *= MAX_PULL / len;
    }
    return { ox, oy, down: g.ty >= TRAY_BOTTOM + DROP_MARGIN };
  }

  // 拉够了就画一根虚线箭头，越长越有劲：弹进井里是强调色，在托盘里弹是粉色。
  // 先按真实物理（同一套重力、阻尼、出手速度）算出飞行轨迹，箭头从果冻边上指向轨迹上离中心「箭头长度」远的那一点，
  // 再从箭尖沿着这条轨迹画淡淡的点线，一直到第一次落地的地方，落点画一个小圈，不画反弹。
  // 箭头和点线都在真实轨迹上，飞出去的果冻就是沿着它们走的
  function drawGuide(blob: Blob, px: number) {
    const pull = launchPull(blob);
    if (!pull) return;
    const len = Math.hypot(pull.ox, pull.oy) || 1;
    const speed = pull.down ? LAUNCH : HOP_LAUNCH;
    const landed = predictLanding(world, blob, pull.ox * speed, pull.oy * speed, pull.down, STEP, aimPath);
    const n = aimPath.length;
    const reach2 = (blob.bound + 6 + len * 0.9) ** 2;
    let from = -1;
    for (let i = 0; i < n; i += 2) {
      if ((aimPath[i] - blob.cx) ** 2 + (aimPath[i + 1] - blob.cy) ** 2 >= reach2) {
        from = i;
        break;
      }
    }
    // 箭尖：轨迹上那一点；轨迹在那之前就落地了（比如横着滑），箭头就顺着拉的方向画
    let ex: number;
    let ey: number;
    if (from >= 0) {
      ex = aimPath[from];
      ey = aimPath[from + 1];
    } else {
      ex = blob.cx + (pull.ox / len) * (blob.bound + 6 + len * 0.9);
      ey = blob.cy + (pull.oy / len) * (blob.bound + 6 + len * 0.9);
    }
    const dist = Math.hypot(ex - blob.cx, ey - blob.cy) || 1;
    const ux = (ex - blob.cx) / dist;
    const uy = (ey - blob.cy) / dist;
    const sx = blob.cx + ux * (blob.bound + 6);
    const sy = blob.cy + uy * (blob.bound + 6);
    ctx.strokeStyle = pull.down ? theme.accent : theme.pink;
    ctx.globalAlpha = 0.4 + 0.5 * (len / MAX_PULL);
    ctx.lineWidth = px * 1.4;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(ex - ux * 7 - uy * 4, ey - uy * 7 + ux * 4);
    ctx.lineTo(ex, ey);
    ctx.lineTo(ex - ux * 7 + uy * 4, ey - uy * 7 - ux * 4);
    ctx.stroke();

    if (from < 0 || from >= n - 2) {
      ctx.globalAlpha = 1;
      return;
    }
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = px;
    ctx.setLineDash([2, 5]);
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    for (let i = from + 2; i < n; i += 2) ctx.lineTo(aimPath[i], aimPath[i + 1]);
    ctx.stroke();
    ctx.setLineDash([]);
    if (landed) {
      const lx = aimPath[aimPath.length - 2];
      const ly = aimPath[aimPath.length - 1];
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.arc(lx, ly, 4.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = ctx.strokeStyle;
      ctx.beginPath();
      ctx.arc(lx, ly, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawBlob(b: Blob, px: number) {
    const color = colorOf(b.level);
    blobPath(b);
    ctx.fillStyle = color;
    ctx.globalAlpha = dark ? 0.2 : 0.15;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = b === grabbed ? theme.accent : color;
    ctx.lineWidth = px * (b === grabbed ? 2.2 : 1.5);
    ctx.stroke();

    const text = String(b.value);
    const size = Math.min(b.r * 0.78, (b.r * 2.1) / text.length);
    ctx.save();
    ctx.translate(b.cx, b.cy);
    // 托盘里的数字保持正着；井里的跟着果冻转
    if (b.zone === 'well' && b !== grabbed) ctx.rotate(b.angle);
    ctx.fillStyle = color;
    // 字号取到半个单位：合成回弹时半径一直在变，按小数点后一位设字体，几乎每帧都要重新解析一次
    ctx.font = `700 ${Math.round(size * 2) / 2}px ${theme.mono}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 0, size * 0.04);
    ctx.restore();
  }

  function draw() {
    const px = dpr / scale;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.lineJoin = 'round';
    drawFrame(px);

    // 危险线：平时是淡虚线，有东西越线就变成强调色，旁边倒计时
    const heat = Math.min(1, dangerT / DANGER_LIMIT);
    ctx.setLineDash([6, 5]);
    ctx.strokeStyle = heat > 0 ? theme.accent : theme.faint;
    ctx.globalAlpha = heat > 0 ? 0.55 + 0.45 * heat : 0.7;
    ctx.lineWidth = px * (1 + heat);
    ctx.beginPath();
    ctx.moveTo(bounds.wellL, DANGER_Y);
    ctx.lineTo(bounds.wellR, DANGER_Y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    label('LIMIT', bounds.wellL + 14, DANGER_Y - 8, 'left', heat > 0 ? theme.accent : theme.faint);
    if (heat > 0) {
      ctx.fillStyle = theme.accent;
      ctx.font = `600 11px ${theme.mono}`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      ctx.fillText(`${Math.max(0, DANGER_LIMIT - dangerT).toFixed(1)}s`, bounds.wellR - 4, DANGER_Y - 4);
    }

    if (grabbed && world.grab) drawGuide(grabbed, px);

    // 托盘里飞着的最后画，从别的果冻上方越过时压在上面
    for (const b of world.blobs) if (b.hop <= 0) drawBlob(b, px);
    for (const b of world.blobs) if (b.hop > 0) drawBlob(b, px);

    for (const p of popups) {
      ctx.globalAlpha = 1 - p.t / 0.9;
      ctx.fillStyle = p.color;
      ctx.font = `600 12px ${theme.mono}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(p.text, p.x, p.y - p.t * 30);
    }
    ctx.globalAlpha = 1;

    if (toastT > 0) {
      ctx.globalAlpha = Math.min(1, toastT / 0.6);
      ctx.fillStyle = theme.accent;
      ctx.font = `600 34px ${theme.serif}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('2048 达成', W / 2, (DANGER_Y + WELL_BOTTOM) / 2 - 60);
      ctx.globalAlpha = 1;
    }
  }

  // ---------- 计分板 ----------
  const shown = { score: -1, best: -1, time: '', tile: -1 };
  function syncHud(force = false) {
    const best = Math.max(store.best, score);
    const t = formatTime(time);
    if (force || shown.score !== score) scoreEl.textContent = String((shown.score = score));
    if (force || shown.best !== best) bestEl.textContent = String((shown.best = best));
    if (force || shown.time !== t) timeEl.textContent = shown.time = t;
    if (force || shown.tile !== tile) {
      tileEl.textContent = String((shown.tile = tile));
      renderLadder();
    }
  }

  // 合成进度：2 到 8192 一排小圆点，合到过的实心，最大的那个外面再套一圈
  function renderLadder() {
    if (!ladderEl) return;
    if (ladderEl.children.length !== LADDER.length) {
      ladderEl.replaceChildren(
        ...LADDER.map((value) => {
          const dot = document.createElement('li');
          dot.title = String(value);
          return dot;
        }),
      );
    }
    LADDER.forEach((value, i) => {
      const dot = ladderEl.children[i] as HTMLElement;
      dot.style.setProperty('--dot', colorOf(i + 1));
      dot.classList.toggle('is-on', value <= tile);
      dot.classList.toggle('is-top', value === tile);
    });
  }

  function cell(text: string, className = '') {
    const td = document.createElement('td');
    td.textContent = text;
    if (className) td.className = className;
    return td;
  }

  function renderRecords() {
    // 没有记录时只放占位图，表头也藏掉
    recordsEmpty.hidden = store.records.length > 0;
    recordsTable.hidden = store.records.length === 0;
    clearBtn.disabled = store.records.length === 0;
    recordsEl.replaceChildren(
      ...store.records.map((r, i) => {
        const tr = document.createElement('tr');
        tr.append(cell(String(i + 1)), cell(String(r.score)), cell(String(r.tile)), cell(formatTime(r.time)), cell(r.at.slice(5)));
        return tr;
      }),
    );
    // 刚插进去时排版还没定，等下一帧再量
    requestAnimationFrame(fitRecords);
  }

  // 面板剩下多高就显示几行，放不下的整行藏掉；手机上记录在画板下面，固定显示前 5 行
  function fitRecords() {
    const rows = Array.from(recordsEl.children) as HTMLElement[];
    rows.forEach((row) => (row.hidden = false));
    if (narrow.matches) {
      rows.forEach((row, i) => (row.hidden = i >= 5));
      return;
    }
    const bottom = recordsBox.getBoundingClientRect().bottom;
    rows.forEach((row) => (row.hidden = row.getBoundingClientRect().bottom > bottom + 0.5));
  }

  function showOverlay(title: string, text: string, action: string) {
    overlayTitle.textContent = title;
    // 没有说明文字时整行藏掉，不留一块空白
    overlayText.textContent = text;
    overlayText.hidden = !text;
    overlayBtn.textContent = action;
    overlay.hidden = false;
  }

  function hideOverlay() {
    overlay.hidden = true;
  }

  // ---------- 循环 ----------
  let raf = 0;
  let running = false;
  let last = 0;
  let acc = 0;

  function frame(now: number) {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    // 计时按真实时间走，不受慢放影响
    if (started && !over) time += dt;
    // 慢放：物理按 speed 倍走；连锁停了以后慢慢恢复
    if (simT - lastMerge > CHAIN_GAP) speed = Math.min(1, speed + SPEED_RECOVER * dt);
    acc += dt * speed;
    let steps = 0;
    while (acc >= STEP && steps < MAX_STEPS && !over) {
      update(STEP);
      acc -= STEP;
      steps++;
    }
    if (steps === MAX_STEPS) acc = 0;
    saveT += dt;
    if (dirty && saveT > 2) {
      saveT = 0;
      persist();
    }
    syncHud();
    draw();
    if (paused || over) {
      running = false;
      return;
    }
    raf = requestAnimationFrame(frame);
  }

  function start() {
    if (running) return;
    running = true;
    last = performance.now();
    acc = 0;
    raf = requestAnimationFrame(frame);
  }

  function release() {
    world.grab = null;
    // 暂停时手里拉着的那个不发射，放回托盘
    if (grabbed) grabbed.state = 'idle';
    grabbed = null;
    canvas.style.cursor = '';
  }

  function setPaused(value: boolean) {
    if (over || paused === value) return;
    paused = value;
    pauseText.textContent = value ? '继续' : '暂停';
    pauseBtn.setAttribute('aria-pressed', String(value));
    if (value) {
      release();
      persist();
      showOverlay('已暂停', '', '继续');
    } else {
      hideOverlay();
      start();
    }
  }

  // ---------- 输入 ----------
  function toWorld(e: PointerEvent): [number, number] {
    const rect = canvas.getBoundingClientRect();
    return [((e.clientX - rect.left) / rect.width) * W, ((e.clientY - rect.top) / rect.height) * H];
  }

  function pick(x: number, y: number): Blob | null {
    let best: Blob | null = null;
    let bestD = Infinity;
    for (const b of world.blobs) {
      if (b.zone !== 'tray' || b.state === 'merging' || b.entering) continue;
      if (containsPoint(b, x, y)) return b;
      // 手指粗，边缘外 10 个单位以内也算点到
      const d = Math.hypot(b.cx - x, b.cy - y) - b.bound;
      if (d < 10 && d < bestD) {
        best = b;
        bestD = d;
      }
    }
    return best;
  }

  function onDown(e: PointerEvent) {
    ding.unlock();
    if (paused || over || grabbed) return;
    const [x, y] = toWorld(e);
    const blob = pick(x, y);
    if (!blob) return;
    e.preventDefault();
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // 指针已经抬起时拿不到捕获，拖动照样能用
    }
    grabbed = blob;
    blob.state = 'held';
    world.grab = { blob, ax: blob.cx, ay: blob.cy, tx: x, ty: y };
    canvas.style.cursor = 'grabbing';
  }

  function onMove(e: PointerEvent) {
    const [x, y] = toWorld(e);
    if (!grabbed || !world.grab) {
      canvas.style.cursor = !paused && !over && pick(x, y) ? 'grab' : '';
      return;
    }
    world.grab.tx = x;
    world.grab.ty = y;
  }

  function onUp() {
    if (!grabbed || !world.grab) return;
    const blob = grabbed;
    const pull = launchPull(blob);
    grabbed = null;
    world.grab = null;
    canvas.style.cursor = '';
    if (blob.state === 'merging') return;
    // 拉得太短：放下
    if (!pull) {
      blob.state = 'idle';
      return;
    }
    // 没往下拉出托盘：在托盘里弹出去，越过别的果冻，碰到相同数字就合，不会掉进井里
    if (!pull.down) {
      hopInTray(blob, pull.ox * HOP_LAUNCH, pull.oy * HOP_LAUNCH, STEP);
      return;
    }
    // 往下拉出托盘：顺着拉的方向弹进井里，拉得越开越有劲。从这一刻起归井里管（重力、撞墙、和井里的果冻碰）
    blob.zone = 'well';
    blob.state = 'falling';
    blob.age = 0;
    setVelocity(blob, pull.ox * LAUNCH, pull.oy * LAUNCH, STEP);
    refillDue = true;
    started = true;
    dirty = true;
  }

  function onVisibility() {
    if (document.visibilityState === 'hidden') {
      if (started) setPaused(true);
      persist();
    }
  }

  // 小确认框：一句话加两个按钮。先暂停，取消就恢复原来的状态。
  // 答案直接从按钮、Esc、点遮罩拿，不等 dialog 的 close 事件（后台标签页里它会迟迟不来）
  let answer: ((yes: boolean) => void) | null = null;
  function ask(text: string, ok: string): Promise<boolean> {
    if (answer) return Promise.resolve(false);
    const wasPaused = paused;
    setPaused(true);
    confirmText.textContent = text;
    confirmOk.textContent = ok;
    confirmBox.showModal();
    return new Promise((resolve) => {
      answer = (yes) => {
        answer = null;
        confirmBox.close();
        if (!yes && !wasPaused) setPaused(false);
        resolve(yes);
      };
    });
  }

  function onConfirmClick(e: MouseEvent) {
    if (!answer) return;
    const target = e.target as HTMLElement;
    if (target.closest('[data-confirm-ok]')) answer(true);
    else if (target.closest('[data-confirm-cancel]')) answer(false);
    else {
      // 点到框外的遮罩上等于取消
      const r = confirmBox.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) answer(false);
    }
  }

  // Esc：当成取消
  function onConfirmCancel(e: Event) {
    e.preventDefault();
    answer?.(false);
  }

  // 清空本机成绩：成绩表和最高分一起清掉，正在玩的这一局和存档不动。问过以后恢复原来的暂停状态
  async function onClearRecords() {
    const before = paused;
    if (!(await ask('清空本机所有成绩记录', '清空'))) return;
    store.records = [];
    store.best = 0;
    writeStore(store);
    renderRecords();
    syncHud(true);
    if (!before) setPaused(false);
  }

  async function onRestart() {
    if (!playing()) {
      newGame();
      return;
    }
    if (await ask('重新开始会结算这一局', '结算重开')) {
      settle();
      newGame();
    }
  }

  // 一局进行中点了会离开这一页的链接：先问，确定就结算再走。新标签页打开、只改锚点的不管
  async function onLinkClick(e: MouseEvent) {
    if (!playing() || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const link = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
    if (!link || (link.target && link.target !== '_self') || link.hasAttribute('download')) return;
    const url = new URL(link.href, location.href);
    if (url.origin === location.origin && url.pathname === location.pathname && url.search === location.search) return;
    // 在捕获阶段抢在站内路由之前拦下，不然它已经开始换页了
    e.preventDefault();
    e.stopImmediatePropagation();
    if (!(await ask('离开会结算这一局', '结算离开'))) return;
    // 结算后这一局已经不在进行中，再点一次同一个链接，交给站内路由照常换页
    settle();
    link.click();
  }

  function onMute() {
    store.muted = !store.muted;
    ding.setMuted(store.muted);
    commit();
    syncMute();
  }

  function syncMute() {
    muteText.textContent = store.muted ? '静音' : '音效';
    muteBtn.setAttribute('aria-pressed', String(!store.muted));
  }

  function onOverlay() {
    if (over) newGame();
    else setPaused(false);
  }

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  pauseBtn.addEventListener('click', () => setPaused(!paused));
  muteBtn.addEventListener('click', onMute);
  restartBtn.addEventListener('click', onRestart);
  clearBtn.addEventListener('click', onClearRecords);
  overlayBtn.addEventListener('click', onOverlay);
  confirmBox.addEventListener('click', onConfirmClick);
  confirmBox.addEventListener('cancel', onConfirmCancel);
  window.addEventListener('click', onLinkClick, true);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', persist);

  syncMute();
  // 存档在时限内：接着玩，先停在暂停上等玩家点继续；过了时限：把那一局记进成绩，开新局
  const saved = store.save;
  const resumed = Boolean(saved && Date.now() - (saved.at ?? 0) < RESUME_WINDOW);
  if (saved && resumed) restore(saved);
  else {
    if (saved) record(saved.score, saved.time, saved.tile, saved.at);
    setWidth(fitWidth());
  }
  renderRecords();
  renderLadder();
  syncHud(true);
  resize();
  start();
  if (resumed) {
    setPaused(true);
    showOverlay('接着上一局', '', '继续');
  }

  return () => {
    persist();
    cancelAnimationFrame(raf);
    running = false;
    answer = null;
    if (confirmBox.open) confirmBox.close();
    themeWatch.disconnect();
    sizeWatch.disconnect();
    recordsWatch.disconnect();
    window.removeEventListener('click', onLinkClick, true);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', persist);
    ding.close();
  };
}
