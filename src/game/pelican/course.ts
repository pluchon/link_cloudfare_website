// 一整条路线：道路本身，加上路上的小鱼、能量罐、跳台、加速带、弹簧垫和路障。
// 每一局的场景顺序和路形都是随机的，所以路线要整条重新生成。
// 这个文件不依赖 three，物理、计分和画面都从这里取同一份数据

import { SCENE_LENGTH, SCENES, type Scene } from './scenes';
import { seeded, Track } from './track';

export interface Ramp {
  // 坡脚的位置
  s: number;
  // 中心离路中线多远
  x: number;
  len: number;
  width: number;
  height: number;
}

// 加速带：骑上去白送一段冲刺，不耗冲刺条
export interface Pad {
  s: number;
  x: number;
  len: number;
  width: number;
}

// 弹簧垫：压上去被弹到半空，高处有一串鱼
export interface Spring {
  s: number;
  x: number;
  len: number;
  width: number;
}

// 路障：横在一条车道上。撞上只是慢一下、晃一下，不会输；可以绕开，也可以跳过去
export interface Obstacle {
  s: number;
  x: number;
  width: number;
}

// 路上能捡的东西：小鱼、金鱼、能量罐（把冲刺条加满）、半空中的奖励圈（飞起来从中间穿过去）
export type ItemKind = 'fish' | 'gold' | 'bolt' | 'ring';

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
// 平常的速度，鱼的弧线按这个速度排
const CRUISE = 16;
const GRAVITY = 19;
// 三条车道的中心
const LANES = [-LANE_WIDTH, 0, LANE_WIDTH];
// 跳台和加速带都比车道窄一点，两边露出车道线
const RAMP = { len: 7, width: LANE_WIDTH - 0.5, height: 1.3 };
const PAD = { len: 7, width: LANE_WIDTH - 0.5 };
// 一段场景里最多放几个跳台；平均下来两段才有一个
const RAMPS_PER_SCENE = 1;
const SPRING = { len: 3.2, width: LANE_WIDTH - 0.6 };
// 弹簧垫把车往上弹的速度（米每秒）：最高能到六米左右，在空中一秒半
export const SPRING_SPEED = 15;
const SPRINGS_PER_SCENE = 1;
const OBSTACLE_WIDTH = LANE_WIDTH - 0.8;
// 离路面的高度：贴地骑就能吃到的，和要跳起来才够得着的
const LOW = 0.95;
const HIGH = 3.3;
// 自己起跳的速度，和 bike.ts 里的是同一个数：跳台上的奖励圈按「在坡顶再跳一下」的弧线排
export const JUMP_SPEED = 10.5;

// 把所有场景打乱成这一局的顺序
export function shuffledOrder(random: () => number = Math.random): number[] {
  const order = SCENES.map((_, index) => index);
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
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

    for (let scene = 0; scene < this.scenes.length; scene += 1) {
      const end = (scene + 1) * SCENE_LENGTH - 26;
      let s = scene * SCENE_LENGTH + (scene === 0 ? 46 : 22);
      // 每段场景保证有一个能量罐和一条加速带，其余随机
      let bolts = 0;
      let boosts = 0;
      let jumps = 0;
      let bounces = 0;
      while (s < end - 30) {
        let roll = random();
        if (s > end - 110 && boosts === 0) roll = 0.85;
        else if (s > end - 75 && bolts === 0) roll = 0.97;
        // 跳台放够了，这一格改成一排鱼
        if (roll >= 0.62 && roll < 0.71 && jumps >= RAMPS_PER_SCENE) roll = 0;
        if (roll >= 0.56 && roll < 0.62 && bounces >= SPRINGS_PER_SCENE) roll = 0;
        if (roll >= 0.27 && roll < 0.36) {
          // 路障：挡住一条或两条车道，没挡的那条上排几条鱼，提前告诉人往哪边绕
          const open = Math.floor(random() * LANES.length);
          const shut = [0, 1, 2].filter((index) => index !== open);
          if (random() < 0.6) shut.splice(Math.floor(random() * 2), 1);
          for (const index of shut) obstacles.push({ s: s + 10, x: LANES[index], width: OBSTACLE_WIDTH });
          for (let i = 0; i < 4; i += 1) items.push({ s: s + 2 + i * 3.4, x: LANES[open], y: LOW, kind: 'fish', scene });
          s += 16;
        } else if (roll >= 0.56 && roll < 0.62) {
          // 弹簧垫：鱼排在被弹起来的那道弧线上，最高处两条金鱼
          const x = lane();
          springs.push({ s, x, ...SPRING });
          bounces += 1;
          const from = s + SPRING.len / 2;
          // 弧线上三个奖励圈，圈和圈之间各一条金鱼，刚弹起来的地方一条小鱼
          const arc: Array<[number, ItemKind]> = [
            [0.22, 'fish'],
            [0.4, 'ring'],
            [0.6, 'gold'],
            [0.8, 'ring'],
            [1.0, 'gold'],
            [1.2, 'ring'],
          ];
          for (const [t, kind] of arc) {
            const y = SPRING_SPEED * t - 0.5 * GRAVITY * t * t;
            items.push({ s: from + CRUISE * t, x, y: y + 0.8, kind, scene });
          }
          s += 30;
        } else if (roll < 0.36) {
          // 一排：同一条车道上连着五条
          const x = lane();
          for (let i = 0; i < 5; i += 1) items.push({ s: s + i * 3.4, x, y: LOW, kind: 'fish', scene });
          s += 17;
        } else if (roll < 0.62) {
          // 蛇形：从一侧摆到另一侧
          const from = random() < 0.5 ? -1 : 1;
          for (let i = 0; i < 7; i += 1) {
            items.push({ s: s + i * 4.2, x: from * LANE_WIDTH * Math.cos((i / 6) * Math.PI), y: LOW, kind: 'fish', scene });
          }
          s += 30;
        } else if (roll < 0.71) {
          // 跳台：只放在左右两条车道上，中间那条始终留给不想跳的人。鱼排在飞出去的那道弧线上，最高点是一条金鱼
          const x = random() < 0.5 ? LANES[0] : LANES[2];
          ramps.push({ s, x, ...RAMP });
          jumps += 1;
          const lip = s + RAMP.len;
          const up = ((2 * RAMP.height) / RAMP.len) * CRUISE;
          [0.12, 0.27, 0.42, 0.57, 0.72].forEach((t, i) => {
            const y = RAMP.height + up * t - 0.5 * GRAVITY * t * t;
            items.push({ s: lip + CRUISE * t, x, y: y + 0.8, kind: i === 2 ? 'gold' : 'fish', scene });
          });
          // 在坡顶再跳一下会飞得高得多，那道更高的弧线上挂三个奖励圈
          for (const t of [0.5, 0.86, 1.22]) {
            const y = RAMP.height + (up + JUMP_SPEED) * t - 0.5 * GRAVITY * t * t;
            items.push({ s: lip + CRUISE * t, x, y: y + 0.8, kind: 'ring', scene });
          }
          s += 26;
        } else if (roll < 0.8) {
          // 要跳一下才够得着的三条，中间是金鱼
          const x = lane();
          for (let i = 0; i < 3; i += 1) items.push({ s: s + i * 3.2, x, y: HIGH, kind: i === 1 ? 'gold' : 'fish', scene });
          s += 12;
        } else if (roll < 0.93) {
          // 加速带：后面跟一长串鱼，冲过去正好一口气吃完
          const x = lane();
          pads.push({ s, x, ...PAD });
          for (let i = 0; i < 6; i += 1) items.push({ s: s + PAD.len + 8 + i * 6, x, y: LOW, kind: 'fish', scene });
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

  // (s, x) 是不是压在弹簧垫上
  onSpring(s: number, x: number): boolean {
    for (const spring of this.springs) {
      if (s < spring.s) break;
      if (s <= spring.s + spring.len && Math.abs(x - spring.x) <= spring.width / 2) return true;
    }
    return false;
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

export const SCORE: Record<ItemKind, number> = { fish: 10, gold: 50, bolt: 20, ring: 40 };
// 吃到一样东西给冲刺条加多少
export const REFILL: Record<ItemKind, number> = { fish: 0.07, gold: 0.3, bolt: 1, ring: 0.12 };
