// 果冻 2048 的软体物理。
// 每个果冻是一圈质点，按位置动力学（Müller 等 2007，Position Based Dynamics）每个子步依次满足三种约束：
// 1. 相邻质点的边长：只硬抗压缩，拉伸很软。周长和面积都锁死的话只能是圆，就压不扁了
// 2. 面积：相当于内部压强，被压扁时体积不变，往旁边鼓出去，这就是「液体」的感觉
// 3. 形状匹配（Müller 等 2005）：每一步轻轻拉回目标形状，拉得慢，所以落地、合成、被砸后会 Q 弹地晃
// 目标形状不是圆：圆上叠两道慢慢转动的波纹，形状一直在变；井里的再按重力往下压扁一点，像一滴水塌在地上。
// 果冻之间按「质点钻进对方多边形就推回最近的边」处理碰撞，推开的量按质量分摊，
// 所以飞来的果冻砸进堆里时两边都被压扁、推开，动量也跟着分过去（位置动力学里速度就是位置差）。
//
// 表面边上再加一点表面张力：每个点往两个邻居的中点拉一点，挤出来的尖角、缺口会被抹平。
//
// 托盘和井是两套规则：
// - 托盘里没有重力。从左到右相邻的两个之间有一根很软的弹簧，想留一小段间隔：远了慢慢靠过来，近了轻轻分开，
//   整排再被很弱的力拉向中间，所以是「有点吸引又不完全吸住」的松散一行。相邻两个数字相同时吸得更紧，一碰就合成。
//   新来的从两侧带着速度滑进来，撞到已有的会把它们推开
// - 按住拉扯：果冻像被粘在原位，只往拉的方向挪一点、朝那个方向被拉长一点，和别的果冻照样相撞（它也有体积），
//   拉着的时候不合成。松手时由 game.ts 顺着拉的方向、按拉开的距离把它弹出去
// - 井里有重力。两侧墙和顶上按恢复系数反弹，地面带摩擦、弹一点点

export type Zone = 'tray' | 'well';
export type BlobState = 'idle' | 'held' | 'falling' | 'merging';

export interface Blob {
  id: number;
  value: number;
  level: number;
  n: number;
  x: Float32Array;
  y: Float32Array;
  px: Float32Array;
  py: Float32Array;
  qx: Float32Array;
  qy: Float32Array;
  r: number;
  targetR: number;
  invMass: number;
  cx: number;
  cy: number;
  angle: number;
  bound: number;
  zone: Zone;
  state: BlobState;
  // 进了井以后过了多久（还在飞的时候不算）；在托盘里则是滑进来以后过了多久
  age: number;
  // 从托盘哪一侧滑进来：-1 左、1 右，滑到位以后是 0
  entering: number;
  partner: Blob | null;
  mergeT: number;
  // 形状波纹：两道谐波的相位、转速和当前幅度
  ph2: number;
  ph3: number;
  sp2: number;
  sp3: number;
  wobble: number;
}

export interface Bounds {
  trayL: number;
  trayR: number;
  trayTop: number;
  trayBottom: number;
  wellL: number;
  wellR: number;
  wellBottom: number;
}

export interface Grab {
  blob: Blob;
  // 按下时果冻所在的位置，它被「粘」在这里
  ax: number;
  ay: number;
  // 拉开的位移（game.ts 已经按最大拉距收过）
  ox: number;
  oy: number;
}

const GRAVITY = 1500;
const DAMP = 0.997;
const TRAY_DAMP = 0.982;
const ITERATIONS = 4;
const EDGE_STIFF = 0.6;
const EDGE_STRETCH = 0.04;
const SHAPE_STIFF = 0.028;
const FLOOR_FRICTION = 0.5;
const FLOOR_BOUNCE = 0.15;
const WALL_BOUNCE = 0.45;
const TRAY_BOUNCE = 0.6;
const MERGE_TIME = 0.1;
// 整个嵌进别的果冻时每次往外挪多少
const ESCAPE = 2.5;
// 碰撞推开时在边外多留这么一层，两个果冻的轮廓线不会叠成一条
const SKIN = 1.2;
// 表面张力：每一步把点往两个邻居的中点拉多少
const TENSION = 0.12;
// 托盘：相邻两个之间想留的间隔、那根软弹簧的硬度和最大力，整排往中间的拉力，纵向回到中线的弹簧
const ROW_GAP = 8;
const ROW_X = 22;
const ROW_MAX = 320;
const CENTER_X = 0.6;
const ROW_Y = 90;
// 相邻两个相同数字互相吸的力
const MATCH_PULL = 420;
// 托盘中间一条看不见的通道：静止的果冻上下都被压进这个高度，面积不变，大的就被摊成长条
const CHANNEL = 48;
const CHANNEL_STIFF = 0.35;
// 拉扯：质心只跟过去拉开距离的 FOLLOW 那么多（被粘在原地），朝拉的方向那一侧的点再多受 STRETCH 的力，整团被拉长一点
const FOLLOW = 0.2;
const PULL = 600;
const STRETCH = 26;
const HOLD_DAMP = 0.86;
// 井里塌下来的程度，越大的越塌
const SAG_BASE = 0.07;
const SAG_PER_LEVEL = 0.008;
// 形状波纹幅度：托盘里飘着、变得明显；井里被挤着，只留一点
const WOBBLE_TRAY = 0.13;
const WOBBLE_WELL = 0.05;

// 数字越大越大，一级只大 5.5，2048 的直径也只有 150
export function radiusOf(level: number): number {
  return Math.min(19 + 5.5 * (level - 1), 84);
}

let nextId = 1;

export function makeBlob(value: number, cx: number, cy: number, zone: Zone, startR?: number): Blob {
  const level = Math.round(Math.log2(value));
  const targetR = radiusOf(level);
  const r = startR ?? targetR;
  const n = 16 + 2 * Math.min(level, 8);
  const blob: Blob = {
    id: nextId++,
    value,
    level,
    n,
    x: new Float32Array(n),
    y: new Float32Array(n),
    px: new Float32Array(n),
    py: new Float32Array(n),
    qx: new Float32Array(n),
    qy: new Float32Array(n),
    r,
    targetR,
    invMass: 1 / (targetR / 19) ** 2,
    cx,
    cy,
    angle: 0,
    bound: r,
    zone,
    state: 'idle',
    age: 0,
    entering: 0,
    partner: null,
    mergeT: 0,
    ph2: Math.random() * Math.PI * 2,
    ph3: Math.random() * Math.PI * 2,
    sp2: (0.5 + Math.random() * 0.6) * (Math.random() < 0.5 ? -1 : 1),
    sp3: (0.7 + Math.random() * 0.8) * (Math.random() < 0.5 ? -1 : 1),
    wobble: zone === 'tray' ? WOBBLE_TRAY : WOBBLE_WELL,
  };
  restShape(blob);
  for (let i = 0; i < n; i++) {
    blob.x[i] = blob.px[i] = cx + blob.qx[i];
    blob.y[i] = blob.py[i] = cy + blob.qy[i];
  }
  return blob;
}

// 目标形状：r·(1 + a·sin(2θ + φ2) + 0.6a·sin(3θ + φ3))，再按面积缩回去，波纹不改变大小
function restShape(b: Blob) {
  const a2 = b.wobble;
  const a3 = b.wobble * 0.6;
  const k = b.r / Math.sqrt(1 + (a2 * a2 + a3 * a3) / 2);
  for (let i = 0; i < b.n; i++) {
    const t = (i / b.n) * Math.PI * 2;
    const rr = k * (1 + a2 * Math.sin(2 * t + b.ph2) + a3 * Math.sin(3 * t + b.ph3));
    b.qx[i] = Math.cos(t) * rr;
    b.qy[i] = Math.sin(t) * rr;
  }
}

export function translate(b: Blob, dx: number, dy: number) {
  for (let i = 0; i < b.n; i++) {
    b.x[i] += dx;
    b.y[i] += dy;
    b.px[i] += dx;
    b.py[i] += dy;
  }
  b.cx += dx;
  b.cy += dy;
}

// 给整团一个速度（单位：逻辑单位每秒）
export function setVelocity(b: Blob, vx: number, vy: number, dt: number) {
  for (let i = 0; i < b.n; i++) {
    b.px[i] = b.x[i] - vx * dt;
    b.py[i] = b.y[i] - vy * dt;
  }
}

export function velocity(b: Blob, dt: number): [number, number] {
  let vx = 0;
  let vy = 0;
  for (let i = 0; i < b.n; i++) {
    vx += b.x[i] - b.px[i];
    vy += b.y[i] - b.py[i];
  }
  return [vx / b.n / dt, vy / b.n / dt];
}

export function topOf(b: Blob): number {
  let top = Infinity;
  for (let i = 0; i < b.n; i++) top = Math.min(top, b.y[i]);
  return top;
}

export function updateFrame(b: Blob) {
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < b.n; i++) {
    cx += b.x[i];
    cy += b.y[i];
  }
  cx /= b.n;
  cy /= b.n;
  let bound = 0;
  let sin = 0;
  let cos = 0;
  for (let i = 0; i < b.n; i++) {
    const rx = b.x[i] - cx;
    const ry = b.y[i] - cy;
    bound = Math.max(bound, rx * rx + ry * ry);
    cos += b.qx[i] * rx + b.qy[i] * ry;
    sin += b.qx[i] * ry - b.qy[i] * rx;
  }
  b.cx = cx;
  b.cy = cy;
  b.bound = Math.sqrt(bound);
  b.angle = Math.atan2(sin, cos);
}

export function containsPoint(b: Blob, x: number, y: number): boolean {
  const dx = x - b.cx;
  const dy = y - b.cy;
  if (dx * dx + dy * dy > b.bound * b.bound) return false;
  let inside = false;
  for (let i = 0, j = b.n - 1; i < b.n; j = i++) {
    const yi = b.y[i];
    const yj = b.y[j];
    if (yi > y !== yj > y && x < ((b.x[j] - b.x[i]) * (y - yi)) / (yj - yi) + b.x[i]) inside = !inside;
  }
  return inside;
}

// 面积梯度和表面张力的临时数组，质点最多 32 个
const nx = new Float32Array(32);
const ny = new Float32Array(32);

function solveShape(b: Blob) {
  const n = b.n;

  // 边长
  const edge = 2 * b.r * Math.sin(Math.PI / n);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const dx = b.x[j] - b.x[i];
    const dy = b.y[j] - b.y[i];
    const d = Math.sqrt(dx * dx + dy * dy) || 1e-6;
    const k = ((d - edge) / d) * 0.5 * (d < edge ? EDGE_STIFF : EDGE_STRETCH);
    b.x[i] += dx * k;
    b.y[i] += dy * k;
    b.x[j] -= dx * k;
    b.y[j] -= dy * k;
  }

  // 表面张力：往两个邻居的中点拉一点，先算完再一起挪，免得前面挪过的点影响后面
  for (let i = 0; i < n; i++) {
    const p = (i + n - 1) % n;
    const q = (i + 1) % n;
    nx[i] = ((b.x[p] + b.x[q]) / 2 - b.x[i]) * TENSION;
    ny[i] = ((b.y[p] + b.y[q]) / 2 - b.y[i]) * TENSION;
  }
  for (let i = 0; i < n; i++) {
    b.x[i] += nx[i];
    b.y[i] += ny[i];
  }

  // 面积：沿每个质点的法向一起推，推的量由面积差和梯度算出（表面张力缩掉的面积也在这里补回来）
  const area0 = Math.PI * b.r * b.r;
  let area = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += b.x[i] * b.y[j] - b.x[j] * b.y[i];
  }
  area *= 0.5;
  let norm = 0;
  for (let i = 0; i < n; i++) {
    nx[i] = 0.5 * (b.y[(i + 1) % n] - b.y[(i + n - 1) % n]);
    ny[i] = 0.5 * (b.x[(i + n - 1) % n] - b.x[(i + 1) % n]);
    norm += nx[i] * nx[i] + ny[i] * ny[i];
  }
  if (norm > 1e-9) {
    const lambda = (area0 - area) / norm;
    for (let i = 0; i < n; i++) {
      b.x[i] += lambda * nx[i];
      b.y[i] += lambda * ny[i];
    }
  }

  // 形状匹配：找最贴合的旋转，把每个质点往目标形状上的对应位置拉一点。
  // 井里的目标再按世界坐标往下压扁（横向放宽、纵向收窄、整体下沉），不跟着果冻转，像一滴水塌着
  updateFrame(b);
  const c = Math.cos(b.angle);
  const s = Math.sin(b.angle);
  const sag = b.zone === 'well' ? SAG_BASE + SAG_PER_LEVEL * b.level : 0;
  for (let i = 0; i < n; i++) {
    let gx = c * b.qx[i] - s * b.qy[i];
    let gy = s * b.qx[i] + c * b.qy[i];
    if (sag) {
      gx *= 1 + sag;
      gy = gy / (1 + sag) + sag * b.r * 0.35;
    }
    b.x[i] += (b.cx + gx - b.x[i]) * SHAPE_STIFF;
    b.y[i] += (b.cy + gy - b.y[i]) * SHAPE_STIFF;
  }
}

// 越界的质点放回墙上，速度反向并按 bounce 打折
function bounceX(b: Blob, i: number, wall: number, bounce: number) {
  const v = b.x[i] - b.px[i];
  b.x[i] = wall;
  b.px[i] = wall + v * bounce;
}

function bounceY(b: Blob, i: number, wall: number, bounce: number) {
  const v = b.y[i] - b.py[i];
  b.y[i] = wall;
  b.py[i] = wall + v * bounce;
}

// channel：要不要压进托盘通道。只在碰撞之前压：碰撞之后再压，会把刚推开的点又压回别的果冻里
function solveBounds(b: Blob, bounds: Bounds, channel: boolean) {
  if (b.zone === 'tray') {
    // 手里拉着的可以拉出托盘，只挡在画面里
    const held = b.state === 'held';
    if (channel && b.state === 'idle' && !b.entering) {
      const mid = (bounds.trayTop + bounds.trayBottom) / 2;
      const top = mid - CHANNEL / 2;
      const bottom = mid + CHANNEL / 2;
      for (let i = 0; i < b.n; i++) {
        if (b.y[i] < top) b.y[i] += (top - b.y[i]) * CHANNEL_STIFF;
        else if (b.y[i] > bottom) b.y[i] += (bottom - b.y[i]) * CHANNEL_STIFF;
      }
    }
    const left = b.entering < 0 ? -1e4 : bounds.trayL;
    const right = b.entering > 0 ? 1e4 : bounds.trayR;
    const top = held ? 0 : bounds.trayTop;
    const bottom = held ? bounds.wellBottom : bounds.trayBottom;
    for (let i = 0; i < b.n; i++) {
      if (b.x[i] < left) bounceX(b, i, left, TRAY_BOUNCE);
      else if (b.x[i] > right) bounceX(b, i, right, TRAY_BOUNCE);
      if (b.y[i] < top) bounceY(b, i, top, TRAY_BOUNCE);
      else if (b.y[i] > bottom) bounceY(b, i, bottom, TRAY_BOUNCE);
    }
    return;
  }
  for (let i = 0; i < b.n; i++) {
    if (b.y[i] > bounds.wellBottom) {
      bounceY(b, i, bounds.wellBottom, FLOOR_BOUNCE);
      b.px[i] = b.x[i] - (b.x[i] - b.px[i]) * FLOOR_FRICTION;
    } else if (b.y[i] < 0) {
      bounceY(b, i, 0, WALL_BOUNCE);
    }
    if (b.x[i] < bounds.wellL) bounceX(b, i, bounds.wellL, WALL_BOUNCE);
    else if (b.x[i] > bounds.wellR) bounceX(b, i, bounds.wellR, WALL_BOUNCE);
  }
}

// a 的质点钻进 b 就推回 b 最近的那条边，两边按质量分摊。返回是否接触。
// 托盘里两边各让一半：按质量分的话小的全让，会被两边的大果冻挤成月牙
function pushOut(a: Blob, b: Blob): boolean {
  let touched = false;
  const tray = a.zone === 'tray';
  const wa = tray ? 1 : a.invMass;
  const wb = tray ? 1 : b.invMass;
  const sum = wa + wb;
  const bound2 = (b.bound + 1) * (b.bound + 1);
  for (let i = 0; i < a.n; i++) {
    const x = a.x[i];
    const y = a.y[i];
    const dx = x - b.cx;
    const dy = y - b.cy;
    if (dx * dx + dy * dy > bound2) continue;
    if (!containsPoint(b, x, y)) continue;
    touched = true;
    let best = Infinity;
    let bj = 0;
    let bt = 0;
    let qx = 0;
    let qy = 0;
    for (let j = 0; j < b.n; j++) {
      const k = (j + 1) % b.n;
      const ex = b.x[k] - b.x[j];
      const ey = b.y[k] - b.y[j];
      const len2 = ex * ex + ey * ey || 1e-9;
      const t = Math.max(0, Math.min(1, ((x - b.x[j]) * ex + (y - b.y[j]) * ey) / len2));
      const cx = b.x[j] + ex * t;
      const cy = b.y[j] + ey * t;
      const d2 = (x - cx) * (x - cx) + (y - cy) * (y - cy);
      if (d2 < best) {
        best = d2;
        bj = j;
        bt = t;
        qx = cx;
        qy = cy;
      }
    }
    // 推到边外 SKIN 处：沿「点 → 最近点」的方向多推一点
    const dist = Math.sqrt(best) || 1e-6;
    const mx = ((qx - x) / dist) * (dist + SKIN);
    const my = ((qy - y) / dist) * (dist + SKIN);
    a.x[i] += (mx * wa) / sum;
    a.y[i] += (my * wa) / sum;
    const k = (bj + 1) % b.n;
    const s = 1 / ((1 - bt) * (1 - bt) + bt * bt);
    const ex = (mx * wb) / sum;
    const ey = (my * wb) / sum;
    b.x[bj] -= ex * (1 - bt) * s;
    b.y[bj] -= ey * (1 - bt) * s;
    b.x[k] -= ex * bt * s;
    b.y[k] -= ey * bt * s;
  }
  return touched;
}

export interface World {
  blobs: Blob[];
  bounds: Bounds;
  grab: Grab | null;
  // 两个相同数字碰到时问一声能不能合：托盘里有上限
  canMerge: (a: Blob, b: Blob) => boolean;
  onMerge: (blob: Blob, from: [Blob, Blob]) => void;
}

export function createWorld(bounds: Bounds, hooks: Pick<World, 'canMerge' | 'onMerge'>): World {
  return { blobs: [], bounds, grab: null, ...hooks };
}

function integrate(world: World, dt: number) {
  const g = world.grab;
  const bounds = world.bounds;
  const trayCx = (bounds.trayL + bounds.trayR) / 2;
  const trayCy = (bounds.trayTop + bounds.trayBottom) / 2;
  const dt2 = dt * dt;

  // 托盘这一行：按现在的左右顺序，相邻两个之间一根软弹簧，想留 ROW_GAP 的间隔，力有上限；
  // 整排被很弱的力拉向中间。数字相同的两个吸得更紧，碰到就合。手里拖着的和正在合成的不参加
  const row = world.blobs
    .filter((b) => b.zone === 'tray' && b.state === 'idle')
    .sort((a, b) => a.cx - b.cx);
  const rowX = new Map<Blob, number>();
  const edges = new Map<Blob, [number, number]>();
  for (const b of row) {
    rowX.set(b, (trayCx - b.cx) * CENTER_X);
    let l = Infinity;
    let r = -Infinity;
    for (let i = 0; i < b.n; i++) {
      l = Math.min(l, b.x[i]);
      r = Math.max(r, b.x[i]);
    }
    edges.set(b, [l, r]);
  }
  for (let i = 0; i + 1 < row.length; i++) {
    const a = row[i];
    const b = row[i + 1];
    // 按两个果冻真实的左右边缘量间隙：形状有波纹，按半径估会偏小
    const gap = edges.get(b)![0] - edges.get(a)![1];
    let f = Math.max(-ROW_MAX, Math.min(ROW_MAX, (gap - ROW_GAP) * ROW_X));
    if (a.value === b.value && !a.entering && !b.entering && world.canMerge(a, b)) f += MATCH_PULL;
    rowX.set(a, rowX.get(a)! + f);
    rowX.set(b, rowX.get(b)! - f);
  }

  for (const b of world.blobs) {
    const held = g?.blob === b;
    let ax = 0;
    let ay = b.zone === 'tray' ? 0 : GRAVITY;
    const fx0 = rowX.get(b);
    if (fx0 !== undefined) {
      ax += fx0;
      ay += (trayCy - b.cy) * ROW_Y;
    }
    const damp = held ? HOLD_DAMP : b.zone === 'tray' ? TRAY_DAMP : DAMP;

    // 拉扯：质心被弹簧拉向「原位 + 拉开位移 × FOLLOW」，朝拉的方向那一侧的点再顺着拉的方向多受一点力
    let reach = 0;
    if (held) {
      ax += (g.ax + g.ox * FOLLOW - b.cx) * PULL;
      ay += (g.ay + g.oy * FOLLOW - b.cy) * PULL;
      reach = Math.hypot(g.ox, g.oy);
    }

    for (let i = 0; i < b.n; i++) {
      let px = ax;
      let py = ay;
      if (reach > 1e-3) {
        const rx = b.x[i] - b.cx;
        const ry = b.y[i] - b.cy;
        const near = Math.max(0, (rx * g!.ox + ry * g!.oy) / (reach * (Math.hypot(rx, ry) || 1)));
        px += g!.ox * STRETCH * near * near;
        py += g!.oy * STRETCH * near * near;
      }
      const vx = (b.x[i] - b.px[i]) * damp;
      const vy = (b.y[i] - b.py[i]) * damp;
      b.px[i] = b.x[i];
      b.py[i] = b.y[i];
      b.x[i] += vx + px * dt2;
      b.y[i] += vy + py * dt2;
    }
  }

  // 正在合成的两个互相吸过去
  for (const b of world.blobs) {
    if (b.state !== 'merging' || !b.partner) continue;
    const p = b.partner;
    const mx = (p.cx - b.cx) * 0.18;
    const my = (p.cy - b.cy) * 0.18;
    for (let i = 0; i < b.n; i++) {
      b.x[i] += mx;
      b.y[i] += my;
    }
  }
}

// 托盘里的和井里的互不相撞：甩出去的果冻一出手就归井里，不会被托盘里的撞偏。
// 手里拖着的也有体积，和同一区的照样相撞，拖过去会把挡路的推开，不会叠在别的上面
function collide(world: World) {
  const list = world.blobs;
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    for (let j = i + 1; j < list.length; j++) {
      const b = list[j];
      if (a.zone !== b.zone) continue;
      if (a.partner === b) continue;
      const dx = a.cx - b.cx;
      const dy = a.cy - b.cy;
      const reach = a.bound + b.bound + 2;
      if (dx * dx + dy * dy > reach * reach) continue;
      // 中心都进了对方里面（合成出来的新果冻正好生在第三个里面时会这样）：
      // 边缘的点往两侧推会互相抵消、卡死在里面，所以整个往外挪
      const aIn = containsPoint(b, a.cx, a.cy);
      if (aIn || containsPoint(a, b.cx, b.cy)) {
        const inner = aIn ? a : b;
        const outer = aIn ? b : a;
        let ux = inner.cx - outer.cx;
        let uy = inner.cy - outer.cy;
        const d = Math.hypot(ux, uy);
        if (d < 1e-3) {
          ux = 0;
          uy = -1;
        } else {
          ux /= d;
          uy /= d;
        }
        translate(inner, ux * ESCAPE, uy * ESCAPE);
        translate(outer, -ux * ESCAPE * 0.3, -uy * ESCAPE * 0.3);
      }
      // 两个方向都要推，不能写成 || 短路掉后一个
      const hitA = pushOut(a, b);
      const hitB = pushOut(b, a);
      if (
        (hitA || hitB) &&
        a.value === b.value &&
        a.state !== 'merging' &&
        b.state !== 'merging' &&
        a.entering === 0 &&
        b.entering === 0 &&
        world.canMerge(a, b)
      ) {
        a.state = b.state = 'merging';
        a.partner = b;
        b.partner = a;
        a.mergeT = b.mergeT = 0;
      }
    }
  }
}

function finishMerges(world: World, dt: number) {
  const done: Blob[] = [];
  for (const a of world.blobs) {
    if (a.state !== 'merging' || !a.partner || done.includes(a)) continue;
    a.mergeT += dt;
    const b = a.partner;
    const close = Math.hypot(a.cx - b.cx, a.cy - b.cy) < Math.max(a.r, b.r) * 0.6;
    if (a.mergeT < MERGE_TIME && !close) continue;
    done.push(a, b);
    const wa = a.r * a.r;
    const wb = b.r * b.r;
    const cx = (a.cx * wa + b.cx * wb) / (wa + wb);
    const cy = (a.cy * wa + b.cy * wb) / (wa + wb);
    const [vax, vay] = velocity(a, dt);
    const [vbx, vby] = velocity(b, dt);
    // 新的那个从原来的大小鼓起来，鼓的过程就是一下回弹
    const merged = makeBlob(a.value * 2, cx, cy, a.zone, Math.max(a.r, b.r) * 1.05);
    setVelocity(merged, (vax + vbx) / 4, (vay + vby) / 4, dt);
    merged.state = a.zone === 'well' ? 'falling' : 'idle';
    merged.age = Math.max(a.age, b.age);
    world.onMerge(merged, [a, b]);
    world.blobs.push(merged);
  }
  if (done.length) {
    if (world.grab && done.includes(world.grab.blob)) world.grab = null;
    world.blobs = world.blobs.filter((b) => !done.includes(b));
  }
}

export function step(world: World, dt: number) {
  for (const b of world.blobs) {
    if (b.r !== b.targetR) {
      b.r += (b.targetR - b.r) * Math.min(1, dt * 14);
      if (Math.abs(b.targetR - b.r) < 0.05) b.r = b.targetR;
    }
    const wobble = b.zone === 'tray' ? WOBBLE_TRAY : WOBBLE_WELL;
    b.wobble += (wobble - b.wobble) * Math.min(1, dt * 2);
    const slow = b.zone === 'tray' ? 1 : 0.35;
    b.ph2 += b.sp2 * slow * dt;
    b.ph3 += b.sp3 * slow * dt;
    restShape(b);
    if (b.entering) {
      const inside = b.entering < 0 ? b.cx - b.bound > world.bounds.trayL : b.cx + b.bound < world.bounds.trayR;
      if (inside) b.entering = 0;
    }
  }
  integrate(world, dt);
  for (let k = 0; k < ITERATIONS; k++) {
    for (const b of world.blobs) {
      solveShape(b);
      solveBounds(b, world.bounds, true);
    }
    collide(world);
    for (const b of world.blobs) {
      solveBounds(b, world.bounds, false);
      updateFrame(b);
    }
  }
  finishMerges(world, dt);
}
