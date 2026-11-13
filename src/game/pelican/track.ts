// 道路：一条连着穿过所有场景的长路，按固定步长采样出中心线。
// 弯道和起伏是用固定种子随机出来的，每次打开都是同一条路。
// 这个文件不依赖 three，物理和画面都从这里取同一份数据

export interface TrackPoint {
  x: number;
  y: number;
  z: number;
  // 朝向：0 是 -z 方向，正数向右转
  yaw: number;
  // 坡度角，正数是上坡
  pitch: number;
  // 曲率（每米转过的弧度），正数向右弯
  curve: number;
}

// 每个场景对路形的要求
export interface TrackStyle {
  // 弯多不多，0 到 1
  curve: number;
  // 路面最高能起伏到多高（米）
  hill: number;
  // 断层：这段场景里离进场的门 at 米的地方，路面突然落下去 drop 米，前面 gap 米是空的，车照常骑就飞得过去。
  // 路在这之前的 climb[0] 到 climb[1] 米之间慢慢爬高 drop 米，才有高度可落
  fault?: { at: number; drop: number; gap: number; climb: [number, number] };
}

// 采样步长（米）
const STEP = 0.5;
// 终点之后留一段路给车滑行
const RUNOUT = 90;
// 路面最低的高度：两边的地面要从这里往下坡到水平面，不能贴着水平面
const BASE = 0.7;
// 弯最急时的曲率：半径约 130 米，冲刺时也压得过去，两侧 75 米宽的地面也不会在弯内侧叠起来
const MAX_CURVE = 0.0077;
// 最陡的坡
const MAX_SLOPE = 0.07;
// 路的走向最多偏离出发方向这么多（弧度），这样整条路只会左右蜿蜒，不会绕回来压到自己
const MAX_YAW = 0.9;

// 固定种子的随机数，同一个种子永远出同一串
export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Segment {
  len: number;
  // 这一段里总共转过的弧度，正数向右
  turn: number;
  // 这一段里总共升高多少（米）
  rise: number;
}

export class Track {
  // 路面宽度（米）
  readonly width: number;
  // 整条路的长度，包含终点之后那段滑行的路
  readonly length: number;
  // 终点线的位置
  readonly finish: number;
  // 每个场景占多长
  readonly sceneLength: number;
  readonly sceneCount: number;
  // 路上的断层：在哪、落多高、空多长
  readonly faults: Array<{ s: number; drop: number; gap: number }> = [];

  private readonly px: Float32Array;
  private readonly py: Float32Array;
  private readonly pz: Float32Array;
  private readonly yaw: Float32Array;
  private readonly count: number;

  constructor(styles: readonly TrackStyle[], sceneLength: number, width: number, seed: number) {
    this.width = width;
    this.sceneLength = sceneLength;
    this.sceneCount = styles.length;
    this.finish = sceneLength * styles.length;

    const random = seeded(seed);
    const segments: Segment[] = [];
    let heading = 0;
    let height = BASE;
    styles.forEach((style, index) => {
      let left = sceneLength;
      while (left > 0) {
        let len = 70 + Math.floor(random() * 31) * 2;
        if (left - len < 60) len = left;
        left -= len;
        // 开头一段是直的平路，给人起步的时间
        const opening = index === 0 && segments.length === 0;
        let turn = 0;
        if (!opening && random() > 0.18) {
          turn = (random() * 2 - 1) * ((MAX_CURVE * len) / 1.5) * style.curve;
          if (Math.abs(heading + turn) > MAX_YAW) turn = -Math.sign(heading) * Math.abs(turn);
        }
        let rise = 0;
        if (!opening) {
          const limit = (MAX_SLOPE * len) / 1.5;
          rise = Math.max(-limit, Math.min(limit, BASE + random() * style.hill - height));
        }
        heading += turn;
        height += rise;
        segments.push({ len, turn, rise });
      }
    });
    segments.push({ len: RUNOUT, turn: 0, rise: 0 });

    const total = this.finish + RUNOUT;
    this.count = Math.floor(total / STEP) + 1;
    this.length = (this.count - 1) * STEP;
    this.px = new Float32Array(this.count);
    this.py = new Float32Array(this.count);
    this.pz = new Float32Array(this.count);
    this.yaw = new Float32Array(this.count);

    let x = 0;
    let y = BASE;
    let z = 0;
    let yaw = 0;
    let index = 0;
    let start = 0;
    for (const seg of segments) {
      const end = start + seg.len;
      while (index < this.count && index * STEP < end) {
        this.px[index] = x;
        this.py[index] = y;
        this.pz[index] = z;
        this.yaw[index] = yaw;
        // 转弯和起坡都按 6u(1-u) 分配：两头为零、中间最大，段与段接起来曲率是连续的
        const u = (index * STEP + STEP * 0.5 - start) / seg.len;
        const weight = (6 * u * (1 - u) * STEP) / seg.len;
        yaw += seg.turn * weight;
        y += seg.rise * weight;
        x += Math.sin(yaw) * STEP;
        z -= Math.cos(yaw) * STEP;
        index += 1;
      }
      start = end;
    }
    // 最后一个采样点正好落在路的尽头，上面的循环轮不到它，这里补上
    for (; index < this.count; index += 1) {
      this.px[index] = x;
      this.py[index] = y;
      this.pz[index] = z;
      this.yaw[index] = yaw;
    }

    // 断层：断层之前的路整体垫高，先慢慢爬上去，到了断层那一点一步落回原来的高度
    styles.forEach((style, scene) => {
      const fault = style.fault;
      if (!fault) return;
      const from = scene * sceneLength;
      this.faults.push({ s: from + fault.at, drop: fault.drop, gap: fault.gap });
      for (let i = Math.ceil((from + fault.climb[0]) / STEP); i * STEP < from + fault.at && i < this.count; i += 1) {
        const u = Math.min(1, (i * STEP - from - fault.climb[0]) / (fault.climb[1] - fault.climb[0]));
        this.py[i] += fault.drop * u * u * (3 - 2 * u);
      }
    });
  }

  // 取中心线上离起点 s 米处的位置和朝向，结果写进 out
  at(s: number, out: TrackPoint): TrackPoint {
    const last = this.count - 1;
    if (s <= 0 || s >= this.length) {
      // 两头之外按端点的朝向平着延伸出去，镜头在起点后面时要用
      const i = s <= 0 ? 0 : last;
      const over = s <= 0 ? s : s - this.length;
      out.yaw = this.yaw[i];
      out.x = this.px[i] + Math.sin(out.yaw) * over;
      out.y = this.py[i];
      out.z = this.pz[i] - Math.cos(out.yaw) * over;
      out.pitch = 0;
      out.curve = 0;
      return out;
    }
    const f = s / STEP;
    const i = Math.min(Math.floor(f), last - 1);
    const t = f - i;
    out.x = this.px[i] + (this.px[i + 1] - this.px[i]) * t;
    out.y = this.py[i] + (this.py[i + 1] - this.py[i]) * t;
    out.z = this.pz[i] + (this.pz[i + 1] - this.pz[i]) * t;
    out.yaw = this.yaw[i] + (this.yaw[i + 1] - this.yaw[i]) * t;
    out.pitch = Math.atan2(this.py[i + 1] - this.py[i], STEP);
    out.curve = (this.yaw[i + 1] - this.yaw[i]) / STEP;
    return out;
  }

  // s 处属于第几个场景（终点之后算最后一个）
  sceneAt(s: number): number {
    return Math.max(0, Math.min(this.sceneCount - 1, Math.floor(s / this.sceneLength)));
  }
}
