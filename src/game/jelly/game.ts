import {
  containsPoint,
  createWorld,
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
const TRAY_TOP = 10;
const TRAY_BOTTOM = 102;
const WELL_TOP = 120;
const WELL_BOTTOM = 590;
const DANGER_Y = 178;
// 容错：果冻 Q 弹晃动时会擦过线，越线超过 6 个单位、刚落下 0.9 秒以后、连续 2.5 秒才算输
const DANGER_SLACK = 6;
const DANGER_GRACE = 0.9;
const DANGER_LIMIT = 2.5;
const REFILL_GAP = 0.32;
const ENTER_TIMEOUT = 1.6;
// 拉扯发射：最多拉开 120，松手时顺着拉的方向，速度 = 拉开的位移 × 9（每秒）；拉不到 16 松手算取消
const MAX_PULL = 120;
const LAUNCH = 9;
const MIN_PULL = 16;
// 新果冻从两侧滑进来时带的速度
const ENTER_SPEED = 520;
// 井里的果冻速度超过这个就算还在飞，危险线的计时从停下来才开始
const MOVING = 260;
const STEP = 1 / 120;
const STORE_KEY = 'nn-jelly-2048';
// 本机最佳最多存这么多局，显示几行看面板放得下多少
const MAX_RECORDS = 20;
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

function today(): string {
  const d = new Date();
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
  // 按钮里有图标，文字写在里面的文字节点上
  const textOf = (btn: HTMLElement) => btn.querySelector<HTMLElement>('[data-text]') ?? btn;
  const pauseText = textOf(pauseBtn);
  const muteText = textOf(muteBtn);
  const restartText = textOf(restartBtn);
  const overlay = $('[data-overlay]');
  const overlayTitle = $('[data-overlay-title]');
  const overlayText = $('[data-overlay-text]');
  const overlayBtn = $<HTMLButtonElement>('[data-overlay-btn]');
  const recordsEl = $('[data-records]');
  const recordsBox = $('[data-records-box]');
  const narrow = window.matchMedia('(max-width: 48rem)');
  const ladderEl = root.querySelector<HTMLElement>('[data-ladder]');

  const store = loadStore();
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
  // 按下的位置，拉开的位移从这里量
  let press: { x: number; y: number } | null = null;

  const world = createWorld(bounds, {
    // 托盘里相同的挨着就自动合，只是不能超过上限；手里拖着的在托盘里不跟别的合，拖进井里碰到相同的就合
    canMerge: (a, b) => a.zone === 'well' || (a !== grabbed && b !== grabbed && a.value * 2 <= TRAY_CAP),
    onMerge: (merged, [a, b]) => {
      score += merged.value;
      tile = Math.max(tile, merged.value);
      dirty = true;
      ding.play();
      popups.push({ text: `+${merged.value}`, x: merged.cx, y: merged.cy - merged.targetR * 0.4, t: 0, color: colorOf(merged.level) });
      // 拖着直接在井里合上了，也算这一下放下去了
      if (a === grabbed || b === grabbed) {
        grabbed = null;
        press = null;
        canvas.style.cursor = '';
        refillDue = true;
        started = true;
      }
      if (merged.value === 2048 && !reached) {
        reached = true;
        toastT = 2.4;
      }
    },
  });

  // ---------- 主题 ----------
  let dark = false;
  let theme = { fg: '#000', muted: '#666', faint: '#999', line: '#ddd', strong: '#ccc', accent: '#c6462f', pink: '#f3a3bd', mono: 'monospace', serif: 'serif' };
  function readTheme() {
    const cs = getComputedStyle(document.documentElement);
    const v = (name: string) => cs.getPropertyValue(name).trim();
    dark = document.documentElement.dataset.theme === 'dark';
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
    if (level === 11) return theme.accent;
    if (level > 11) return theme.fg;
    const hue = HUES[Math.max(0, level - 1)];
    return dark ? `hsl(${hue} 66% 70%)` : `hsl(${hue} 58% 44%)`;
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
    const y = (TRAY_TOP + TRAY_BOTTOM) / 2;
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
    press = null;
    dealer = createDealer();
    setWidth(fitWidth());
    score = 0;
    time = 0;
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
    writeStore(store);
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
    };
  }

  function persist() {
    if (over || !started) return;
    store.save = snapshot();
    writeStore(store);
    dirty = false;
  }

  function gameOver() {
    over = true;
    world.grab = null;
    grabbed = null;
    press = null;
    if (score > 0) {
      store.records.push({ score, time: Math.floor(time), tile, at: today() });
      store.records.sort((a, b) => b.score - a.score);
      store.records = store.records.slice(0, MAX_RECORDS);
    }
    store.best = Math.max(store.best, score);
    store.save = null;
    writeStore(store);
    renderRecords();
    syncHud(true);
    showOverlay('溢出啦', `得分 ${score} · 最大 ${tile} · 用时 ${formatTime(time)}`, '再来一局');
  }

  // ---------- 每个子步 ----------
  function update(dt: number) {
    step(world, dt);
    if (started) time += dt;

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

  function label(text: string, x: number, y: number, align: CanvasTextAlign, color = theme.faint) {
    ctx.fillStyle = color;
    ctx.font = `9px ${theme.mono}`;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y);
  }

  // 背景装饰：井里一层很淡的点阵，左墙一把深度刻度，托盘和井各一个小标签
  function drawFrame(px: number) {
    const { trayL, trayR, wellL, wellR } = bounds;

    ctx.fillStyle = theme.line;
    for (let y = WELL_TOP + 24; y < WELL_BOTTOM; y += 24) {
      for (let x = wellL + 24; x < wellR; x += 24) ctx.fillRect(x - 0.9, y - 0.9, 1.8, 1.8);
    }

    ctx.lineWidth = px;
    ctx.strokeStyle = theme.line;
    ctx.strokeRect(trayL, TRAY_TOP, trayR - trayL, TRAY_BOTTOM - TRAY_TOP);
    // 托盘四角的小折角
    ctx.strokeStyle = theme.strong;
    ctx.beginPath();
    for (const [x, y, dx, dy] of [
      [trayL, TRAY_TOP, 1, 1],
      [trayR, TRAY_TOP, -1, 1],
      [trayL, TRAY_BOTTOM, 1, -1],
      [trayR, TRAY_BOTTOM, -1, -1],
    ]) {
      ctx.moveTo(x + dx * 10, y);
      ctx.lineTo(x, y);
      ctx.lineTo(x, y + dy * 10);
    }
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(wellL, WELL_TOP);
    ctx.lineTo(wellL, WELL_BOTTOM);
    ctx.lineTo(wellR, WELL_BOTTOM);
    ctx.lineTo(wellR, WELL_TOP);
    ctx.stroke();

    // 深度刻度：每 20 一短刻，每 100 一长刻
    ctx.strokeStyle = theme.line;
    ctx.beginPath();
    for (let y = WELL_BOTTOM - 20, i = 1; y > WELL_TOP; y -= 20, i++) {
      const long = i % 5 === 0;
      ctx.moveTo(wellL, y);
      ctx.lineTo(wellL + (long ? 9 : 4), y);
      ctx.moveTo(wellR, y);
      ctx.lineTo(wellR - (long ? 9 : 4), y);
    }
    ctx.stroke();

    ctx.fillStyle = theme.pink;
    ctx.beginPath();
    ctx.arc(trayL + 10, TRAY_TOP + 10, 2.2, 0, Math.PI * 2);
    ctx.fill();
    label('TRAY', trayL + 17, TRAY_TOP + 10.5, 'left');
  }

  // 拉扯时从果冻边上顺着拉的方向一根虚线箭头，越长越有劲；拉不够取消距离时不画
  function drawGuide(blob: Blob, px: number) {
    const g = world.grab;
    if (!g) return;
    const len = Math.hypot(g.ox, g.oy);
    if (len < MIN_PULL) return;
    const ux = g.ox / len;
    const uy = g.oy / len;
    const sx = blob.cx + ux * (blob.bound + 6);
    const sy = blob.cy + uy * (blob.bound + 6);
    const ex = sx + ux * len * 0.9;
    const ey = sy + uy * len * 0.9;
    ctx.strokeStyle = theme.accent;
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
    ctx.globalAlpha = 1;
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

    for (const b of world.blobs) {
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
      ctx.font = `700 ${size.toFixed(1)}px ${theme.mono}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, 0, size * 0.04);
      ctx.restore();
    }

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
    if (!store.records.length) {
      const empty = cell('还没有记录，先来一局吧', 'jelly__empty');
      empty.colSpan = 5;
      const tr = document.createElement('tr');
      tr.append(empty);
      recordsEl.replaceChildren(tr);
      return;
    }
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
    overlayText.textContent = text;
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
    acc += dt;
    let steps = 0;
    while (acc >= STEP && steps < 6 && !over) {
      update(STEP);
      acc -= STEP;
      steps++;
    }
    if (steps === 6) acc = 0;
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
    press = null;
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
      showOverlay('已暂停', '按 P 或点下面的按钮继续', '继续');
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
    press = { x, y };
    world.grab = { blob, ax: blob.cx, ay: blob.cy, ox: 0, oy: 0 };
    canvas.style.cursor = 'grabbing';
  }

  function onMove(e: PointerEvent) {
    const [x, y] = toWorld(e);
    if (!grabbed || !world.grab || !press) {
      canvas.style.cursor = !paused && !over && pick(x, y) ? 'grab' : '';
      return;
    }
    // 拉开的位移从按下的位置量，最多 MAX_PULL
    let ox = x - press.x;
    let oy = y - press.y;
    const len = Math.hypot(ox, oy);
    if (len > MAX_PULL) {
      ox *= MAX_PULL / len;
      oy *= MAX_PULL / len;
    }
    world.grab.ox = ox;
    world.grab.oy = oy;
  }

  function onUp() {
    if (!grabbed || !world.grab) return;
    const blob = grabbed;
    const { ox, oy } = world.grab;
    grabbed = null;
    press = null;
    world.grab = null;
    canvas.style.cursor = '';
    if (blob.state === 'merging') return;
    // 拉得太短算取消，留在托盘里
    if (Math.hypot(ox, oy) < MIN_PULL) {
      blob.state = 'idle';
      return;
    }
    // 松手：顺着拉的方向弹出去，拉得越开越有劲。从这一刻起归井里管（重力、撞墙、和井里的果冻碰）
    blob.zone = 'well';
    blob.state = 'falling';
    blob.age = 0;
    setVelocity(blob, ox * LAUNCH, oy * LAUNCH, STEP);
    refillDue = true;
    started = true;
    dirty = true;
  }

  function onKey(e: KeyboardEvent) {
    if (e.target instanceof HTMLInputElement || document.querySelector('dialog[open]')) return;
    if (e.key === 'p' || e.key === 'P') {
      if (over) return;
      setPaused(!paused);
    }
  }

  function onVisibility() {
    if (document.visibilityState === 'hidden') {
      if (started) setPaused(true);
      persist();
    }
  }

  let armed = 0;
  function onRestart() {
    if (over || !started) {
      newGame();
      return;
    }
    if (armed) {
      clearTimeout(armed);
      armed = 0;
      restartText.textContent = '重开';
      newGame();
      return;
    }
    restartText.textContent = '确定？';
    armed = window.setTimeout(() => {
      armed = 0;
      restartText.textContent = '重开';
    }, 3000);
  }

  function onMute() {
    store.muted = !store.muted;
    ding.setMuted(store.muted);
    writeStore(store);
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
  overlayBtn.addEventListener('click', onOverlay);
  window.addEventListener('keydown', onKey);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', persist);

  syncMute();
  renderRecords();
  if (store.save) restore(store.save);
  else setWidth(fitWidth());
  renderLadder();
  syncHud(true);
  resize();
  start();

  return () => {
    persist();
    cancelAnimationFrame(raf);
    running = false;
    clearTimeout(armed);
    themeWatch.disconnect();
    sizeWatch.disconnect();
    recordsWatch.disconnect();
    window.removeEventListener('keydown', onKey);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', persist);
    ding.close();
  };
}
