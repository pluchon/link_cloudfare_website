// 一整条路线：道路本身，加上路上的小鱼、能量罐、跳台、加速带、弹簧垫和路障。
// 每一局的场景顺序和路形都是随机的，所以路线要整条重新生成。
// 这个文件不依赖 three，物理、计分和画面都从这里取同一份数据

import { RUN_SCENES, SCENE_LENGTH, SCENES, type Scene } from './scenes';
import { seeded, Track } from './track';

export interface Ramp {
  // 坡脚的位置
  s: number;
  // 中心离路中线多远
  x: number;
  len: number;
  width: number;
  height: number;
  // 第几档：0 矮、1 中、2 高
  grade: number;
}

// 加速带：骑上去白送一段冲刺，不耗冲刺条
export interface Pad {
  s: number;
  x: number;
  len: number;
  width: number;
}

// 弹簧垫：压上去被弹到半空，高处有一串鱼。tilt 是斜着的那种，往前上方弹，飞得又高又远
export interface Spring {
  s: number;
  x: number;
  len: number;
  width: number;
  tilt: boolean;
}

type Pattern = 'line' | 'weave' | 'block' | 'spring' | 'launch' | 'ramp' | 'token' | 'pad' | 'bolt';

// 路障：横在一条车道上。撞上只是慢一下、晃一下，不会输；可以绕开，也可以跳过去
export interface Obstacle {
  s: number;
  x: number;
  width: number;
}

// 路上能捡的东西：小鱼、金鱼、能量罐（把冲刺条加满）、半空中的奖励圈（飞起来从中间穿过去）、
// 辣椒（一小段时间冲刺条不掉、骑得更快）、纪念品（每个场景自己的一样小东西）
export type ItemKind = 'fish' | 'gold' | 'bolt' | 'ring' | 'chili' | 'token';

export interface Item {
  s: number;
  x: number;
  // 离路面多高
  y: number;
  kind: ItemKind;
  // 在第几段场景里
  scene: number;
}

// 路是三条车道，每条这么宽（米）。小鱼、跳台、加速带都摆在车道正中
export const LANE_WIDTH = 4;
export const ROAD_WIDTH = LANE_WIDTH * 3;
// 平常的速度，和 bike.ts 的 CRUISE 是同一个数：鱼和圈的弧线按这个速度排
const CRUISE = 19;
const GRAVITY = 19;
// 三条车道的中心
const LANES = [-LANE_WIDTH, 0, LANE_WIDTH];
// 跳台和加速带都比车道窄一点，两边露出车道线。跳台分矮、中、高三档（用户要求），越高越长越陡，飞得越高越远
const RAMP_WIDTH = LANE_WIDTH - 0.5;
const RAMP_GRADES = [
  { len: 6.5, height: 0.8, rings: 2 },
  { len: 8, height: 1.4, rings: 3 },
  { len: 10, height: 2.2, rings: 4 },
] as const;
// 车在坡面上每秒多得的速度（米每二次方秒），物理从这里取
export const RAMP_KICK = 8;
// 平常往巡航速度靠的快慢，和 bike.ts 的 ACCEL 是同一个数：算飞出去的弧线要用，改一处要改另一处
const SETTLE = 1.1;
const PAD = { len: 7, width: LANE_WIDTH - 0.5 };
// 一段场景里最多放几个跳台（场景加长以后从一个放宽到两个）
const RAMPS_PER_SCENE = 2;
const SPRING = { len: 3.2, width: LANE_WIDTH - 0.6 };
// 弹簧垫把车往上弹的速度（米每秒）：最高能到六米左右，在空中一秒半
export const SPRING_SPEED = 15;
const SPRINGS_PER_SCENE = 2;
// 斜弹簧：往上弹的速度、一下子推到多快、在空中维持多快（就是加速带的速度，bike.ts 的 SURGE_SPEED）
export const LAUNCH_UP = 13;
export const LAUNCH_SPEED = 35;
const LAUNCH_HOLD = 32;
// 两个要选车道的东西（跳台、弹簧、路障）之间至少隔这么远（米），大约三秒的路
const FEATURE_GAP = 60;
// 跳台、弹簧、路障前面先排一串鱼，把人领到该走的车道上；这是鱼打头到那样东西的距离
const LEAD = 24;
const OBSTACLE_WIDTH = LANE_WIDTH - 0.8;
// 贴地骑就能吃到的东西离路面多高
const LOW = 0.95;
// 每段场景放几个纪念品，有几成的场景会掉一根辣椒
const TOKENS_PER_SCENE = 3;
const CHILI_CHANCE = 0.6;

// 这一局经过哪些场景、按什么顺序：全部打乱以后取前面 RUN_SCENES 个，所以每一局不光顺序不同，碰到的场景也不全一样
export function shuffledOrder(random: () => number = Math.random): number[] {
  const order = SCENES.map((_, index) => index);
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order.slice(0, RUN_SCENES);
}

export class Course {
  // 这一局依次经过的场景
  readonly scenes: readonly Scene[];
  readonly track: Track;
  readonly ramps: readonly Ramp[];
  readonly pads: readonly Pad[];
  readonly springs: readonly Spring[];
  readonly obstacles: readonly Obstacle[];
  readonly items: readonly Item[];
  // 小鱼和金鱼一共多少条，评星用
  readonly fishTotal: number;

  constructor(order: readonly number[], seed: number) {
    this.scenes = order.map((index) => SCENES[index]);
    this.track = new Track(this.scenes, SCENE_LENGTH, ROAD_WIDTH, seed);
    const random = seeded(seed + 4099);
    const ramps: Ramp[] = [];
    const pads: Pad[] = [];
    const springs: Spring[] = [];
    const obstacles: Obstacle[] = [];
    const items: Item[] = [];
    const lane = () => LANES[Math.floor(random() * LANES.length)];

    // 一条车道上连着排几条鱼
    const row = (scene: number, from: number, x: number, count: number, step: number) => {
      for (let i = 0; i < count; i += 1) items.push({ s: from + i * step, x, y: LOW, kind: 'fish', scene });
    };

    for (let scene = 0; scene < this.scenes.length; scene += 1) {
      const end = (scene + 1) * SCENE_LENGTH - 26;
      let s = scene * SCENE_LENGTH + (scene === 0 ? 46 : 22);
      // 每段场景保证有一个能量罐和一条加速带，其余随机
      let bolts = 0;
      let boosts = 0;
      let jumps = 0;
      let bounces = 0;
      let tokens = 0;
      // 上一个要选车道的东西（跳台、弹簧、路障）过去以后，到这里才能放下一个
      let clearFrom = s;
      // 这一段掉不掉辣椒、掉在哪
      let chiliAt = random() < CHILI_CHANCE ? s + (0.15 + random() * 0.6) * (end - s) : Infinity;
      // 这一段有没有断层
      const fault = this.scenes[scene].fault;
      let faultAt = fault ? scene * SCENE_LENGTH + fault.at : Infinity;

      while (s < end - 30) {
        if (fault && s > faultAt - 130) {
          // 断层：路在这里断开，落到下面一截。前后都不放要躲的东西，只在中间那条车道排一串鱼把人领到崖边，
          // 半空中三个圈，落地的地方等着一条金鱼
          row(scene, faultAt - 66, 0, 9, 7);
          const air = Math.sqrt((2 * fault.drop) / GRAVITY);
          for (const u of [0.3, 0.55, 0.8]) {
            const t = air * u;
            items.push({ s: faultAt + CRUISE * t, x: 0, y: fault.drop - 0.5 * GRAVITY * t * t + 0.8, kind: 'ring', scene });
          }
          items.push({ s: faultAt + CRUISE * air + 5, x: 0, y: LOW, kind: 'gold', scene });
          s = faultAt + CRUISE * air + 30;
          clearFrom = s + FEATURE_GAP / 2;
          faultAt = Infinity;
          continue;
        }
        if (s >= chiliAt) {
          items.push({ s, x: lane(), y: LOW + 0.2, kind: 'chili', scene });
          chiliAt = Infinity;
          s += 24;
        }
        const roll = random();
        let pattern: Pattern =
          roll < 0.22 ? 'line' : roll < 0.31 ? 'block' : roll < 0.47 ? 'weave' : roll < 0.53 ? 'spring' : roll < 0.58 ? 'launch' : roll < 0.68 ? 'ramp' : roll < 0.77 ? 'token' : roll < 0.91 ? 'pad' : 'bolt';
        // 纪念品、加速带、能量罐要放够数：越到后面越要补
        if (tokens < TOKENS_PER_SCENE && s > end - 60 - (TOKENS_PER_SCENE - tokens) * 110) pattern = 'token';
        if (s > end - 110 && boosts === 0) pattern = 'pad';
        else if (s > end - 75 && bolts === 0) pattern = 'bolt';
        // 头顶有洞顶或隧道的地方不放弹簧，跳台只放最矮的那档，免得一头撞进石头里
        const roofed = this.covered(s - 10) || this.covered(s + 110);
        const bounce = pattern === 'spring' || pattern === 'launch';
        if (pattern === 'token' && tokens >= TOKENS_PER_SCENE) pattern = 'line';
        if (pattern === 'ramp' && jumps >= RAMPS_PER_SCENE) pattern = 'line';
        if (bounce && (bounces >= SPRINGS_PER_SCENE || roofed)) pattern = 'line';
        // 跳台、弹簧、路障之间要隔开，不然刚落地又来一个，来不及换道（用户嫌过）。离上一个太近就改成鱼
        if ((pattern === 'ramp' || pattern === 'block' || pattern === 'spring' || pattern === 'launch') && s < clearFrom) pattern = random() < 0.5 ? 'line' : 'weave';

        if (pattern === 'block') {
          // 路障：挡住一条或两条车道。没挡的那条上先排一串鱼，隔着二十多米就告诉人往哪边绕
          const open = Math.floor(random() * LANES.length);
          const shut = [0, 1, 2].filter((index) => index !== open);
          if (random() < 0.6) shut.splice(Math.floor(random() * 2), 1);
          for (const index of shut) obstacles.push({ s: s + LEAD, x: LANES[index], width: OBSTACLE_WIDTH });
          row(scene, s, LANES[open], 7, 4.4);
          s += LEAD + 6;
          clearFrom = s + FEATURE_GAP;
        } else if (pattern === 'spring' || pattern === 'launch') {
          // 弹簧垫把车直直地弹上天；斜弹簧往前上方弹，飞得又高又远。前面先排一串鱼把人领到那条车道上
          const x = lane();
          const tilt = pattern === 'launch';
          row(scene, s, x, 4, 4.6);
          const at = s + LEAD;
          springs.push({ s: at, x, ...SPRING, tilt });
          bounces += 1;
          const from = at + SPRING.len / 2;
          const up = tilt ? LAUNCH_UP : SPRING_SPEED;
          const air = (2 * up) / GRAVITY;
          // 斜弹簧会把车一下子推到 LAUNCH_SPEED，之后在空中慢慢回落到加速带那么快
          const along = (t: number) => (tilt ? LAUNCH_HOLD * t + ((LAUNCH_SPEED - LAUNCH_HOLD) * (1 - Math.exp(-4 * t))) / 4 : CRUISE * t);
          // 弧线上三个奖励圈，圈和圈之间各一条金鱼，刚弹起来的地方一条小鱼
          const arc: Array<[number, ItemKind]> = [
            [0.14, 'fish'],
            [0.26, 'ring'],
            [0.38, 'gold'],
            [0.5, 'ring'],
            [0.63, 'gold'],
            [0.76, 'ring'],
          ];
          for (const [u, kind] of arc) {
            const t = air * u;
            items.push({ s: from + along(t), x, y: up * t - 0.5 * GRAVITY * t * t + 0.8, kind, scene });
          }
          s = from + along(air) + 6;
          clearFrom = s + FEATURE_GAP;
        } else if (pattern === 'line') {
          // 一排：同一条车道上连着五条
          row(scene, s, lane(), 5, 3.4);
          s += 17;
        } else if (pattern === 'weave') {
          // 蛇形：从一侧摆到另一侧
          const from = random() < 0.5 ? -1 : 1;
          for (let i = 0; i < 7; i += 1) {
            items.push({ s: s + i * 4.6, x: from * LANE_WIDTH * Math.cos((i / 6) * Math.PI), y: LOW, kind: 'fish', scene });
          }
          s += 32;
        } else if (pattern === 'ramp') {
          // 跳台：只放在左右两条车道上，中间那条始终留给不想跳的人。前面先排一串鱼把人领过去
          const x = random() < 0.5 ? LANES[0] : LANES[2];
          const pick = random();
          const grade = roofed || pick < 0.4 ? 0 : pick < 0.75 ? 1 : 2;
          const { len, height, rings } = RAMP_GRADES[grade];
          row(scene, s, x, 4, 4.6);
          const foot = s + LEAD;
          ramps.push({ s: foot, x, len, width: RAMP_WIDTH, height, grade });
          jumps += 1;
          // 照平常速度骑上去会怎么飞：坡面上先白得一点速度，离开坡顶后速度慢慢回落
          let fast = CRUISE;
          for (let d = 0; d < len; d += fast / 120) fast += (RAMP_KICK + (CRUISE - fast) * SETTLE) / 120;
          const up = ((2 * height) / len) * fast;
          const air = (up + Math.sqrt(up * up + 2 * GRAVITY * height)) / GRAVITY;
          const lip = foot + len;
          const along = (t: number) => CRUISE * t + ((fast - CRUISE) * (1 - Math.exp(-SETTLE * t))) / SETTLE;
          const rise = (t: number) => height + up * t - 0.5 * GRAVITY * t * t;
          // 奖励圈就挂在这道弧线上（用户要求按这道轨迹排），圈和圈之间各一条鱼，落地的地方等着一条金鱼
          for (let k = 0; k <= rings; k += 1) {
            const fish = (air * (k + 0.5)) / (rings + 1);
            if (k < rings) items.push({ s: lip + along(fish), x, y: rise(fish) + 0.8, kind: 'fish', scene });
            if (k === 0) continue;
            const t = (air * k) / (rings + 1);
            items.push({ s: lip + along(t), x, y: rise(t) + 0.8, kind: 'ring', scene });
          }
          items.push({ s: lip + along(air) + 3, x, y: LOW, kind: 'gold', scene });
          s = lip + along(air) + 4;
          clearFrom = s + FEATURE_GAP;
        } else if (pattern === 'token') {
          // 纪念品：这个场景自己的小东西，前后各带两条鱼
          const x = lane();
          for (const i of [0, 1, 3, 4]) items.push({ s: s + i * 3.6, x, y: LOW, kind: 'fish', scene });
          items.push({ s: s + 7.2, x, y: LOW + 0.25, kind: 'token', scene });
          tokens += 1;
          s += 16;
        } else if (pattern === 'pad') {
          // 加速带：后面跟一长串鱼，冲过去正好一口气吃完
          const x = lane();
          pads.push({ s, x, ...PAD });
          row(scene, s + PAD.len + 8, x, 6, 6);
          boosts += 1;
          s += PAD.len + 44;
        } else {
          // 能量罐：单独一个，放在车道上
          items.push({ s, x: lane(), y: LOW + 0.15, kind: 'bolt', scene });
          bolts += 1;
          s += 4;
        }
        s += 20 + random() * 16;
      }
    }
    this.ramps = ramps;
    this.pads = pads;
    this.springs = springs;
    this.obstacles = obstacles;
    this.items = items;
    // 一条路线上的东西要按位置排好，吃的时候是顺着往后找的；跳台上的鱼和圈是两批排进去的，这里统一排一遍
    items.sort((a, b) => a.s - b.s);
    this.fishTotal = items.filter((item) => item.kind === 'fish' || item.kind === 'gold').length;
  }

  // s 处头顶有没有洞顶或隧道
  covered(s: number): boolean {
    const index = Math.floor(s / SCENE_LENGTH);
    const cover = this.scenes[index]?.cover;
    if (!cover) return false;
    const at = s / SCENE_LENGTH - index;
    return cover.some(([from, to]) => at >= from && at <= to);
  }

  // 跳台在 (s, x) 处把路面垫高了多少
  rampHeight(s: number, x: number): number {
    for (const ramp of this.ramps) {
      if (s < ramp.s) break;
      if (s > ramp.s + ramp.len || Math.abs(x - ramp.x) > ramp.width / 2) continue;
      const u = (s - ramp.s) / ramp.len;
      return ramp.height * u * u;
    }
    return 0;
  }

  // (s, x) 压在哪块弹簧垫上，没压着是 null
  onSpring(s: number, x: number): Spring | null {
    for (const spring of this.springs) {
      if (s < spring.s) break;
      if (s <= spring.s + spring.len && Math.abs(x - spring.x) <= spring.width / 2) return spring;
    }
    return null;
  }

  // (s, x) 是不是压在加速带上
  onPad(s: number, x: number): boolean {
    for (const pad of this.pads) {
      if (s < pad.s) break;
      if (s <= pad.s + pad.len && Math.abs(x - pad.x) <= pad.width / 2) return true;
    }
    return false;
  }
}

export const SCORE: Record<ItemKind, number> = { fish: 10, gold: 50, bolt: 20, ring: 40, chili: 30, token: 80 };
// 吃到一样东西给冲刺条加多少
export const REFILL: Record<ItemKind, number> = { fish: 0.07, gold: 0.3, bolt: 1, ring: 0.12, chili: 1, token: 0.15 };
