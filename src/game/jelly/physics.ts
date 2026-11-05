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
// - 托盘也是一个小容器，和井是同一个世界（同样的重力、阻尼）：果冻坐在托盘底上，落到别人身上会顺着圆滑的表面滑下来。
//   只管左右的是一根很软的弹簧：相邻两个想留一小段间隔，远了慢慢靠过来，近了轻轻分开，整排再被很弱的力拉向中间，
//   所以是「有点吸引又不完全吸住」的松散一行。相邻两个数字相同时吸得更紧，一碰就合成。
//   新来的从两侧带着速度滑进来，撞到已有的会把它们推开
// - 按住只拉不拖：果冻待在原地，正对手指的那一小块伸出一个小突起（像细胞伸伪足），伸不到托盘框；
//   拿着的和别的果冻照样相撞（它也有体积）。松手由 game.ts 决定往哪弹：往下拉出托盘就弹进井里，
//   否则在托盘里弹出去（hopInTray）：像甩出去的一滴划抛物线，飞的时候缩小一点、照样有体积，
//   容易从别的果冻上方越过，碰到相同数字就合，落地停稳了鼓回原大小、排回队伍
// - 合成：新果冻冷却一小会才能接着合，连锁合成一步一步来；半径按欠阻尼弹簧鼓过头再回弹，Q 弹一下
// - 压扁回弹：落地、撞上别的果冻、合成时，沿撞击方向压扁、横向鼓开，按一根欠阻尼的弹簧来回晃几下才停
// - 井里：两侧墙和顶上按恢复系数反弹，地面带摩擦、不弹
// - 液体的黏性只作用在正接触着东西的果冻上（堆着、排着的停得住），在空中的按正常重力加速

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
  // 托盘这一行这一步算出来的横向力（每步重算，存在果冻上免得每步新建 Map）
  rowF: number;
  // 被拉着时朝手指的方向（单位向量）和伸出的突起长度，不拉时长度是 0
  sx: number;
  sy: number;
  reach: number;
  // 刚合成出来的冷却时间：这段时间里不跟别的合，连锁合成就是一步一步的
  cool: number;
  // 冷却期间碰到的相同数字：冷却一结束，只要还挨着就合（碰撞会把它们推开一层薄缝，不记下来的话就再也检测不到接触）
  near: Blob | null;
  // 在托盘里被弹出去、还在飞的剩余时间：飞的时候缩小一点、不排队，落地停稳了再鼓回来、排回队伍
  hop: number;
  // 这一次飞的时候缩到几倍：往上甩得越猛缩得越多，横着滑出去不缩
  hopScale: number;
  // 最近还在接触别的果冻、地面或墙的剩余子步数。黏性只作用在接触着的果冻上（消除堆叠抖动），
  // 自由下落、飞着的不受影响，否则从静止开始掉的果冻每一步都被刹车，永远加速不起来，像掉进蜂蜜里
  contact: number;
  // 半径的变化速度：合成后半径按一根欠阻尼的弹簧鼓大再回弹，就是 Q 弹的那一下
  rv: number;
  // 压扁回弹：撞上东西时沿撞击方向（qnx, qny）压扁、横向鼓开，按一根欠阻尼的弹簧来回晃几下。
  // sq 是压扁的程度（正数压扁、负数拉长），sqv 是它的变化速度；pvx / pvy 是上一子步质心的速度，用来测撞击
  sq: number;
  sqv: number;
  qnx: number;
  qny: number;
  pvx: number;
  pvy: number;
  // 包围盒，updateFrame 里更新；碰撞时先用它筛掉不可能接触的点和对
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
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
  // 按下时果冻所在的位置：拉的时候它基本待在这里，只靠形状被拉长来表现拉扯
  ax: number;
  ay: number;
  // 手指现在在哪
  tx: number;
  ty: number;
}

// 托盘和井是同一个世界：同一个重力、同一个阻尼
const GRAVITY = 1500;
const DAMP = 0.996;
// 液体的黏性：正在接触东西的果冻，一个点的速度低于每秒 SLOW_SPEED 时每步再乘 SLOW_DAMP，
// 到 FAST_SPEED 之间平滑减弱，再快就不刹（真正的落地、被砸保留冲劲）。
// 堆着、排着的果冻因此真的停下来；在空中的不受影响。
// 不能用一刀切的门槛：挤得满时抖动一旦超过门槛就完全不刹，越抖越厉害
const CONTACT_STEPS = 3;
const SLOW_SPEED = 120;
const FAST_SPEED = 400;
const SLOW_DAMP = 0.75;
// 每子步 4 轮约束，每轮都做碰撞：试过隔轮做，挤成一堆时收敛不了，整堆一直抖
const ITERATIONS = 4;
const EDGE_STIFF = 0.6;
const EDGE_STRETCH = 0.04;
const SHAPE_STIFF = 0.028;
const FLOOR_FRICTION = 0.5;
const WALL_BOUNCE = 0.45;
// 撞墙时每子步挪得比这个多才反弹（约每秒 180），慢慢贴上去的直接停在墙上
const BOUNCE_MIN = 1.5;
const TRAY_BOUNCE = 0.6;
const MERGE_TIME = 0.1;
// 整个嵌进别的果冻时每次往外挪多少
const ESCAPE = 2.5;
// 碰撞推开时在边外多留这么一层，两个果冻的轮廓线不会叠成一条。留厚了每一步都会顶出一点速度，堆起来就一直抖
const SKIN = 0.5;
// 表面张力：每一步把点往两个邻居的中点拉多少
const TENSION = 0.12;
// 托盘：相邻两个之间想留的间隔、那根只管左右的软弹簧的硬度和最大力，整排往中间的拉力
const ROW_GAP = 8;
const ROW_X = 22;
const ROW_MAX = 320;
const CENTER_X = 0.6;
// 相邻两个相同数字互相吸的力
const MATCH_PULL = 420;
// 托盘底的摩擦：比井底小，落在别人身上的果冻容易滑下来、滚到旁边
const TRAY_FRICTION = 0.8;
// 准备发射时：果冻基本待在原地，质心最多往手指方向挪 HOLD_MOVE（挪多了会把旁边的挤得乱跳）。
// 伪足不是整团变形，而是像细胞伸伪足：只有正对手指的那一小块（方向夹角在 POD_WIDTH 以内）往外伸出一个小突起，身体别处不动。
// 突起最长 POD_MAX 倍半径，并且永远到不了托盘框：可伸的空间是「沿拉的方向到框的距离 − 半径 − POD_GAP」，
// 拉得越远越接近这个上限（1 − e^(−拉开距离 / POD_EASE)），只是越来越靠近，不会贴上去。
// 拉着的时候形状匹配更硬（HOLD_SHAPE），形状跟得上手
const PULL = 320;
const HOLD_MOVE = 12;
// 在托盘里弹出去：像甩出去的一滴，按重力划一条抛物线，撞顶会反弹。最多飞 HOP_TIME 秒，
// 落到东西上、速度掉到 HOP_SETTLE 以下（且至少飞了 0.1 秒）就算停稳。
// 飞的时候收缩到 HOP_SHRINK 倍大小（甩起来的一滴收紧了），还是有体积、照样碰撞，只是更容易从别的果冻上方越过；
// 停稳后半径弹簧把它鼓回原大小，顺带 Q 弹一下。
// 出手速度完全按拉的方向：横着拉就横着滑出去，不会自己蹦起来；缩小也按向上的速度分量算，到 HOP_UP 才缩满
const HOP_TIME = 1.4;
const HOP_SETTLE = 70;
const HOP_SHRINK = 0.72;
const HOP_UP = 420;
const POD_WIDTH = 0.32;
const POD_MAX = 0.9;
const POD_GAP = 7;
const POD_EASE = 70;
// 突起长度每子步追向目标的比例
const POD_FOLLOW = 0.08;
const HOLD_SHAPE = 0.12;
const HOLD_DAMP = 0.85;
// 合成：新果冻冷却 MERGE_COOL 秒才能接着合；半径弹簧的刚度和阻尼（欠阻尼，会鼓过头再回弹几下），起跳时多鼓 POP
const MERGE_COOL = 0.22;
// 压扁回弹：质心速度在一个子步里突然变了超过 SQ_HIT（每秒）就算撞上了，按变化量踢一下压扁弹簧（SQ_KICK）。
// 弹簧刚度 SQ_K、阻尼 SQ_C 是欠阻尼的，大约每秒晃三四下、一秒内停住；压扁程度最多 SQ_MAX。
// 合成出来的新果冻也踢一下（SQ_POP），和半径的回弹叠在一起更像果冻
const SQ_HIT = 120;
// 撞之前的速度至少要有这么快（每秒）
const SQ_FAST = 200;
const SQ_KICK = 0.0095;
const SQ_K = 520;
const SQ_C = 7;
const SQ_MAX = 0.32;
const SQ_POP = 2.2;
const NEAR_GAP = 4;
const POP_K = 900;
const POP_C = 13;
const POP = 0.14;
// 井里压扁的程度，越大的越扁
const SAG_BASE = 0.07;
const SAG_PER_LEVEL = 0.008;
// 形状波纹幅度：托盘里飘着、变得明显；井里被挤着，只留一点
const WOBBLE_TRAY = 0.13;
const WOBBLE_WELL = 0.05;
// 托盘里波纹转动的快慢：转快了静止的果冻也一直在晃，不像一滴安静的液体
const TRAY_SPIN = 0.5;

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
    rowF: 0,
    sx: 0,
    sy: 0,
    reach: 0,
    cool: 0,
    near: null,
    hop: 0,
    hopScale: 1,
    contact: 0,
    rv: 0,
    sq: 0,
    sqv: 0,
    qnx: 0,
    qny: 1,
    pvx: 0,
    pvy: 0,
    minX: cx,
    maxX: cx,
    minY: cy,
    maxY: cy,
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
  updateFrame(blob);
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

// 在托盘里弹出去：留在托盘、开始飞，速度就是拉出来的速度
export function hopInTray(b: Blob, vx: number, vy: number, dt: number) {
  b.state = 'idle';
  b.hop = HOP_TIME;
  b.hopScale = hopScaleOf(vy);
  setVelocity(b, vx, vy, dt);
}

function hopScaleOf(vy: number): number {
  return 1 - (1 - HOP_SHRINK) * Math.min(1, Math.max(0, -vy / HOP_UP));
}

// 预测弹出去以后第一次落在哪：和物理同一套重力、阻尼（托盘里飞的按缩小后的大小算），
// 碰到第一个果冻、地面或墙就停，不算反弹。往 path 里每隔几步放一个点（x, y 交替），返回是不是真的落到了东西上
export function predictLanding(
  world: World,
  b: Blob,
  vx: number,
  vy: number,
  intoWell: boolean,
  dt: number,
  path: number[],
): boolean {
  const bounds = world.bounds;
  const r = intoWell ? b.targetR : b.targetR * hopScaleOf(vy);
  const zone: Zone = intoWell ? 'well' : 'tray';
  const left = intoWell ? bounds.wellL : bounds.trayL;
  const right = intoWell ? bounds.wellR : bounds.trayR;
  const top = intoWell ? 0 : bounds.trayTop;
  const floor = intoWell ? bounds.wellBottom : bounds.trayBottom;
  let x = b.cx;
  let y = b.cy;
  let ux = vx * dt;
  let uy = vy * dt;
  const g = GRAVITY * dt * dt;
  path.length = 0;
  for (let k = 0; k < 360; k++) {
    ux *= DAMP;
    uy = uy * DAMP + g;
    x += ux;
    y += uy;
    if (k % 3 === 0) path.push(x, y);
    if (x - r < left || x + r > right || y - r < top) return false;
    if (y + r >= floor) {
      path.push(x, floor - r);
      return true;
    }
    // 只在往下落的时候算落在别人身上，往上飞擦过的不算
    if (uy <= 0) continue;
    for (const o of world.blobs) {
      if (o === b || o.zone !== zone) continue;
      if (x + r < o.minX || x - r > o.maxX || y + r < o.minY || y - r > o.maxY) continue;
      if (Math.hypot(x - o.cx, y - o.cy) < r + o.bound * 0.85) {
        path.push(x, y);
        return true;
      }
    }
  }
  return false;
}

// 给整团一个速度（单位：逻辑单位每秒）。顺手记成「上一子步的速度」，不然发射那一下会被当成撞击
export function setVelocity(b: Blob, vx: number, vy: number, dt: number) {
  for (let i = 0; i < b.n; i++) {
    b.px[i] = b.x[i] - vx * dt;
    b.py[i] = b.y[i] - vy * dt;
  }
  b.pvx = vx;
  b.pvy = vy;
}

// 压扁回弹：先看这一子步质心速度变了多少，变得猛就是撞上了，沿减速的方向踢一下弹簧；然后弹簧往前走一步
function squash(b: Blob, dt: number) {
  const [vx, vy] = velocity(b, dt);
  const dx = b.pvx - vx;
  const dy = b.pvy - vy;
  const hit = Math.hypot(dx, dy);
  b.pvx = vx;
  b.pvy = vy;
  // 撞之前得本来就在快速运动才算撞击：挤在堆里的小晃动也会让速度一步一变，
  // 当成撞击去踢弹簧的话，压扁的形状又去推旁边的，越推越抖
  const before = Math.hypot(dx + vx, dy + vy);
  if (hit > SQ_HIT && before > SQ_FAST && b.state !== 'held') {
    // 方向按撞击的轻重和原来的方向混一下，连着撞几下不会突然换方向
    const w = Math.min(1, hit / 600);
    const nx = b.qnx * (1 - w) + (dx / hit) * w;
    const ny = b.qny * (1 - w) + (dy / hit) * w;
    const nl = Math.hypot(nx, ny) || 1;
    b.qnx = nx / nl;
    b.qny = ny / nl;
    b.sqv += Math.min(hit, 1500) * SQ_KICK;
  }
  if (b.sq !== 0 || b.sqv !== 0) {
    b.sqv += (-SQ_K * b.sq - SQ_C * b.sqv) * dt;
    b.sq = Math.max(-SQ_MAX, Math.min(SQ_MAX, b.sq + b.sqv * dt));
    if (Math.abs(b.sq) < 1e-3 && Math.abs(b.sqv) < 0.02) {
      b.sq = 0;
      b.sqv = 0;
    }
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
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < b.n; i++) {
    const x = b.x[i];
    const y = b.y[i];
    const rx = x - cx;
    const ry = y - cy;
    bound = Math.max(bound, rx * rx + ry * ry);
    cos += b.qx[i] * rx + b.qy[i] * ry;
    sin += b.qx[i] * ry - b.qy[i] * rx;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  b.cx = cx;
  b.cy = cy;
  b.bound = Math.sqrt(bound);
  b.angle = Math.atan2(sin, cos);
  b.minX = minX;
  b.maxX = maxX;
  b.minY = minY;
  b.maxY = maxY;
}

export function containsPoint(b: Blob, x: number, y: number): boolean {
  if (x < b.minX || x > b.maxX || y < b.minY || y > b.maxY) return false;
  return inside(b, x, y);
}

// 射线法判断点在不在多边形里（调用方已经筛过包围盒）
function inside(b: Blob, x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = b.n - 1; i < b.n; j = i++) {
    const yi = b.y[i];
    const yj = b.y[j];
    if (yi > y !== yj > y && x < ((b.x[j] - b.x[i]) * (y - yi)) / (yj - yi) + b.x[i]) hit = !hit;
  }
  return hit;
}

// 面积梯度、表面张力、形状目标的临时数组，质点最多 32 个；pod 是每个点属于伪足的程度（0–1）
const nx = new Float32Array(32);
const ny = new Float32Array(32);
const pod = new Float32Array(32);

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
  // 井里的目标再按世界坐标压扁（横向放宽、纵向收窄），不跟着果冻转，像一滴水塌着。
  // 只压扁、不下沉：目标整体往下偏的话，等于每一步多给一份往下的力，堆起来就一直被压着抖
  updateFrame(b);
  const c = Math.cos(b.angle);
  const s = Math.sin(b.angle);
  // 井里的、托盘里坐着的都被重力压扁一点；拿着的、飞着的不压
  const resting = b.state !== 'held' && b.hop <= 0;
  const sag = resting ? SAG_BASE + SAG_PER_LEVEL * b.level : 0;
  // 被拉着：只有正对手指的那一小块伸出去（伪足），越正对伸得越多，夹角超出 POD_WIDTH 的部分不动
  const reach = b.reach;
  const ux = b.sx;
  const uy = b.sy;
  // 先把目标点都算出来（借用 nx / ny），再减掉它们的平均值：
  // 伸出突起的形状整体偏向手指，不对中的话每一步都会把整团往手指那边拖一点，等于多了一股拉力
  // 每个点的形状匹配硬度：伪足那一小块用 HOLD_SHAPE（跟得上手），身体其余部分照常软
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    let gx = c * b.qx[i] - s * b.qy[i];
    let gy = s * b.qx[i] + c * b.qy[i];
    if (sag) {
      gx *= 1 + sag;
      gy /= 1 + sag;
    }
    // 压扁回弹：沿撞击方向收 sq、垂直方向放 sq（面积基本不变，剩下的由面积约束补）
    if (b.sq !== 0) {
      const along = gx * b.qnx + gy * b.qny;
      const px = gx - b.qnx * along;
      const py = gy - b.qny * along;
      gx = b.qnx * along * (1 - b.sq) + px * (1 + b.sq);
      gy = b.qny * along * (1 - b.sq) + py * (1 + b.sq);
    }
    pod[i] = 0;
    if (reach > 0.01) {
      const gl = Math.hypot(gx, gy) || 1;
      const along = (gx * ux + gy * uy) / gl;
      // along 从 1 − POD_WIDTH 到 1 之间平滑地从 0 升到 1（smoothstep），再平方让尖端更集中
      const t = (along - (1 - POD_WIDTH)) / POD_WIDTH;
      if (t > 0) {
        const s = t * t * (3 - 2 * t);
        pod[i] = s;
        const push = reach * s * s;
        gx += ux * push;
        gy += uy * push;
      }
    }
    nx[i] = gx;
    ny[i] = gy;
    mx += gx;
    my += gy;
  }
  mx /= n;
  my /= n;
  for (let i = 0; i < n; i++) {
    const stiff = SHAPE_STIFF + (HOLD_SHAPE - SHAPE_STIFF) * pod[i];
    b.x[i] += (b.cx + nx[i] - mx - b.x[i]) * stiff;
    b.y[i] += (b.cy + ny[i] - my - b.y[i]) * stiff;
  }
}

// 越界的质点放回墙上，速度反向并按 bounce 打折。
// 只有真撞上去（每步挪得比 BOUNCE_MIN 多）才反弹：一堆果冻被挤着贴在墙上时，越墙的那一点是碰撞推过去的，
// 不是速度，按反弹处理的话每一步都会被墙弹回来一下，整堆一直抖
// 碰到墙、底也算接触（黏性要用）
function bounceX(b: Blob, i: number, wall: number, bounce: number) {
  const v = b.x[i] - b.px[i];
  b.x[i] = wall;
  b.px[i] = Math.abs(v) > BOUNCE_MIN ? wall + v * bounce : wall;
  b.contact = CONTACT_STEPS;
}

function bounceY(b: Blob, i: number, wall: number, bounce: number) {
  const v = b.y[i] - b.py[i];
  b.y[i] = wall;
  b.py[i] = Math.abs(v) > BOUNCE_MIN ? wall + v * bounce : wall;
  b.contact = CONTACT_STEPS;
}

// 托盘里正被拿着或正在飞的：撞到排着的果冻时只有它让开
function moving(b: Blob): boolean {
  return b.hop > 0 || b.state === 'held';
}

// 托盘里弹起来、还在往上升的（pvy 是上一子步质心的竖直速度，往上是负的）
function rising(b: Blob): boolean {
  return b.hop > 0 && b.pvy < 0;
}

// 托盘这一排算间距用的左右边缘。拿着的按身体本身算（半径），不算伸出去的伪足，否则一拉伪足就把旁边的推走
function rowLeft(b: Blob): number {
  return b.state === 'held' ? b.cx - b.r : b.minX;
}

function rowRight(b: Blob): number {
  return b.state === 'held' ? b.cx + b.r : b.maxX;
}

function solveBounds(b: Blob, bounds: Bounds) {
  if (b.zone === 'tray') {
    // 托盘是个小容器：两侧和顶上按恢复系数反弹，底下像井底一样不弹、带一点摩擦。
    // 拿着的碰到框不反弹，免得贴着框抖
    const held = b.state === 'held';
    const left = b.entering < 0 ? -1e4 : bounds.trayL;
    const right = b.entering > 0 ? 1e4 : bounds.trayR;
    const bounce = held ? 0 : TRAY_BOUNCE;
    for (let i = 0; i < b.n; i++) {
      if (b.x[i] < left) bounceX(b, i, left, bounce);
      else if (b.x[i] > right) bounceX(b, i, right, bounce);
      if (b.y[i] < bounds.trayTop) bounceY(b, i, bounds.trayTop, bounce);
      else if (b.y[i] > bounds.trayBottom) {
        bounceY(b, i, bounds.trayBottom, 0);
        b.px[i] = b.x[i] - (b.x[i] - b.px[i]) * TRAY_FRICTION;
      }
    }
    return;
  }
  for (let i = 0; i < b.n; i++) {
    // 井底不弹：液体落地是摊开，不是蹦起来
    if (b.y[i] > bounds.wellBottom) {
      bounceY(b, i, bounds.wellBottom, 0);
      b.px[i] = b.x[i] - (b.x[i] - b.px[i]) * FLOOR_FRICTION;
    } else if (b.y[i] < 0) {
      bounceY(b, i, 0, WALL_BOUNCE);
    }
    if (b.x[i] < bounds.wellL) bounceX(b, i, bounds.wellL, WALL_BOUNCE);
    else if (b.x[i] > bounds.wellR) bounceX(b, i, bounds.wellR, WALL_BOUNCE);
  }
}

// a 的质点钻进 b 就推回 b 最近的那条边，两边按质量分摊。返回是否接触。
// 托盘里两边各让一半：按质量分的话小的全让，会被两边的大果冻挤成月牙。
// 例外是拿着的、飞着的撞上排着的：只有动的那个让开（它照样被挡住、贴着滑过去），排着的不动，托盘里就不会被撞乱
function pushOut(a: Blob, b: Blob): boolean {
  let touched = false;
  const tray = a.zone === 'tray';
  let wa = tray ? 1 : a.invMass;
  let wb = tray ? 1 : b.invMass;
  if (tray && moving(a) !== moving(b)) {
    wa = moving(a) ? 1 : 0;
    wb = 1 - wa;
  }
  const sum = wa + wb;
  for (let i = 0; i < a.n; i++) {
    const x = a.x[i];
    const y = a.y[i];
    // 先用 b 的包围盒筛：压扁的果冻包围盒比外接圆紧得多，大部分点在这里就跳过了
    if (x < b.minX || x > b.maxX || y < b.minY || y > b.maxY) continue;
    if (!inside(b, x, y)) continue;
    touched = true;
    a.contact = b.contact = CONTACT_STEPS;
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

// 托盘这一行，每个子步复用
const row: Blob[] = [];

function integrate(world: World, dt: number) {
  const g = world.grab;
  const bounds = world.bounds;
  const trayCx = (bounds.trayL + bounds.trayR) / 2;
  const dt2 = dt * dt;

  // 托盘这一行：按现在的左右顺序，相邻两个之间一根软弹簧，想留 ROW_GAP 的间隔，力有上限；
  // 整排被很弱的力拉向中间。数字相同的两个吸得更紧，碰到就合。正在合成的不参加。
  // 手里拉着的也占着它的位置（旁边的照常和它留间隔，不会因为它被拿起来就重新排队），只是它自己不受这些力。
  // 这一步每个子步都跑，所以复用同一个数组、把中间结果存在果冻身上，不新建 Map
  row.length = 0;
  for (const b of world.blobs) {
    // 还在飞的不排队，停稳了再排进来
    if (b.zone !== 'tray' || (b.state !== 'idle' && b.state !== 'held') || b.hop > 0) continue;
    row.push(b);
    b.rowF = (trayCx - b.cx) * CENTER_X;
  }
  row.sort((a, b) => a.cx - b.cx);
  for (let i = 0; i + 1 < row.length; i++) {
    const a = row[i];
    const b = row[i + 1];
    // 按两个果冻真实的左右边缘量间隙：形状有波纹，按半径估会偏小
    let f = Math.max(-ROW_MAX, Math.min(ROW_MAX, (rowLeft(b) - rowRight(a) - ROW_GAP) * ROW_X));
    if (a.value === b.value && !a.entering && !b.entering && world.canMerge(a, b)) f += MATCH_PULL;
    a.rowF += f;
    b.rowF -= f;
  }

  // 速度按「每子步挪多少」算
  const slowStep = SLOW_SPEED * dt;
  const fastStep = FAST_SPEED * dt;

  for (const b of world.blobs) {
    const held = g?.blob === b;
    const inRow = b.zone === 'tray' && b.state === 'idle' && b.hop <= 0;
    let ax = inRow ? b.rowF : 0;
    // 重力：托盘和井一样；拿着的由手上的弹簧托着，不加重力
    let ay = held ? 0 : GRAVITY;
    const damp = held ? HOLD_DAMP : DAMP;

    // 按住只拉不拖：质心被弹簧拉回锚点（按下时的位置），只左右偏 HOLD_MOVE，上下不跟（往下拖会贴到托盘底上）。
    // 不跟着手指满托盘跑，就不会一路推着别的果冻乱动。手指离得远时朝手指伸出伪足；
    // 方向和长度存到果冻上，solveShape 按它改目标形状。松手往哪弹由 game.ts 按手指的位置决定
    const prevReach = b.reach;
    b.reach = 0;
    if (held) {
      const ox = Math.max(-HOLD_MOVE, Math.min(HOLD_MOVE, (g.tx - g.ax) * 0.15));
      ax += (g.ax + ox - b.cx) * PULL;
      ay += (g.ay - b.cy) * PULL;
      const dx = g.tx - b.cx;
      const dy = g.ty - b.cy;
      const dlen = Math.hypot(dx, dy);
      if (dlen > 1e-3) {
        const ux = dx / dlen;
        const uy = dy / dlen;
        // 沿拉的方向：质心到托盘框的距离，减去身体本身的半径，再留 POD_GAP，就是突起能伸的空间。
        // 按半径估身体边缘，不量当前形状：量当前形状的话，伸出去的突起会反过来改变量出来的边缘，一伸一缩地振荡
        const toX = ux > 1e-6 ? (bounds.trayR - b.cx) / ux : ux < -1e-6 ? (bounds.trayL - b.cx) / ux : Infinity;
        const toY = uy > 1e-6 ? (bounds.trayBottom - b.cy) / uy : uy < -1e-6 ? (bounds.trayTop - b.cy) / uy : Infinity;
        const room = Math.max(0, Math.min(toX, toY) - b.r - POD_GAP);
        const target = Math.min(b.r * POD_MAX, room) * (1 - Math.exp(-dlen / POD_EASE));
        b.sx = ux;
        b.sy = uy;
        // 平滑地追向目标长度，手指一动突起不会跳
        b.reach = prevReach + (target - prevReach) * POD_FOLLOW;
      }
    }

    for (let i = 0; i < b.n; i++) {
      const px = ax;
      const py = ay;
      let vx = (b.x[i] - b.px[i]) * damp;
      let vy = (b.y[i] - b.py[i]) * damp;
      // 黏性：接触着东西、几乎不动的点再刹一下，堆着、排着的果冻就真的停住（拿着的、在空中的不算）
      if (!held && b.contact > 0) {
        const v = Math.hypot(vx, vy);
        if (v < fastStep) {
          const t = Math.max(0, (v - slowStep) / (fastStep - slowStep));
          const k = SLOW_DAMP + (1 - SLOW_DAMP) * t * t * (3 - 2 * t);
          vx *= k;
          vy *= k;
        }
      }
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
      // 托盘里弹起来、还在往上升的，不和排着的相撞：刚出手时还没缩小、邻居就挨在旁边，往侧上方一飞就会蹭上被挡回来。
      // 升到顶开始往下落才恢复碰撞，落在别人身上照样有体积、会滑下去（落点预测也是这么算的）
      if (a.zone === 'tray' && rising(a) !== rising(b) && a.value !== b.value) continue;
      // 包围盒不相交就不可能碰上
      if (a.maxX < b.minX || b.maxX < a.minX || a.maxY < b.minY || b.maxY < a.minY) continue;
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
      if ((hitA || hitB) && mergeable(world, a, b)) {
        if (a.cool > 0 || b.cool > 0) {
          a.near = b;
          b.near = a;
        } else {
          startMerge(a, b);
        }
      }
    }
  }
}

function mergeable(world: World, a: Blob, b: Blob): boolean {
  return (
    a.value === b.value &&
    a.state !== 'merging' &&
    b.state !== 'merging' &&
    a.entering === 0 &&
    b.entering === 0 &&
    world.canMerge(a, b)
  );
}

function startMerge(a: Blob, b: Blob) {
  a.state = b.state = 'merging';
  a.partner = b;
  b.partner = a;
  a.mergeT = b.mergeT = 0;
  a.near = b.near = null;
}

// 冷却结束时，冷却期间碰到过的相同数字只要还挨着（包围盒间隙小于 NEAR_GAP）就开始合
function resolveNear(world: World) {
  for (const a of world.blobs) {
    const b = a.near;
    if (!b || a.cool > 0 || b.cool > 0) continue;
    a.near = null;
    if (b.near === a) b.near = null;
    if (!world.blobs.includes(b) || a.zone !== b.zone || !mergeable(world, a, b)) continue;
    const gap = Math.max(b.minX - a.maxX, a.minX - b.maxX, b.minY - a.maxY, a.minY - b.maxY);
    if (gap < NEAR_GAP) startMerge(a, b);
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
    // 新的那个从原来的大小鼓起来：半径弹簧起跳时再往外推一把，会鼓过头、回弹几下，就是 Q 弹。
    // 冷却期间不跟别的合，连锁合成一步一步来
    const merged = makeBlob(a.value * 2, cx, cy, a.zone, Math.max(a.r, b.r));
    merged.rv = merged.targetR * POP * Math.sqrt(POP_K);
    merged.cool = MERGE_COOL;
    merged.sqv = SQ_POP;
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
    if (b.contact > 0) b.contact--;
    // 半径按欠阻尼弹簧走向目标：刚合成、刚恢复存档的会鼓过头再回弹几下；在托盘里飞着的目标是缩小后的大小
    const goal = b.hop > 0 ? b.targetR * b.hopScale : b.targetR;
    const growing = b.r !== goal || b.rv !== 0;
    if (growing) {
      b.rv += ((goal - b.r) * POP_K - b.rv * POP_C) * dt;
      b.r += b.rv * dt;
      if (Math.abs(goal - b.r) < 0.02 && Math.abs(b.rv) < 0.5) {
        b.r = goal;
        b.rv = 0;
      }
    }
    if (b.cool > 0) b.cool -= dt;
    if (b.hop > 0) {
      b.hop -= dt;
      const [vx, vy] = velocity(b, dt);
      // 落到东西上、慢下来才算停稳（只看速度的话，抛物线最高点速度也很小，会在半空就算停了）
      if (b.hop < HOP_TIME - 0.1 && b.contact > 0 && vx * vx + vy * vy < HOP_SETTLE * HOP_SETTLE) b.hop = 0;
    }
    const wobble = b.zone === 'tray' ? WOBBLE_TRAY : WOBBLE_WELL;
    const settling = Math.abs(wobble - b.wobble) > 1e-4;
    if (settling) b.wobble += (wobble - b.wobble) * Math.min(1, dt * 2);
    // 波纹只在托盘里慢慢转；井里的定住，挤在一起的果冻才不会被一直推来推去
    if (b.zone === 'tray') {
      b.ph2 += b.sp2 * TRAY_SPIN * dt;
      b.ph3 += b.sp3 * TRAY_SPIN * dt;
    }
    if (b.zone === 'tray' || settling || growing) restShape(b);
    if (b.entering) {
      const inside = b.entering < 0 ? b.cx - b.bound > world.bounds.trayL : b.cx + b.bound < world.bounds.trayR;
      if (inside) b.entering = 0;
    }
  }
  integrate(world, dt);
  for (let k = 0; k < ITERATIONS; k++) {
    for (const b of world.blobs) {
      solveShape(b);
      solveBounds(b, world.bounds);
    }
    collide(world);
    for (const b of world.blobs) {
      solveBounds(b, world.bounds);
      updateFrame(b);
    }
  }
  for (const b of world.blobs) squash(b, dt);
  resolveNear(world);
  finishMerges(world, dt);
}
