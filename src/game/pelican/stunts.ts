// 角色的花样动作（2026-11-13 用户要的）：出发前换角色时的出场，冲过终点后的庆祝。
// 这里只算「这一刻摆成什么样」，game.ts 把它叠到车本来的位置和朝向上。不依赖 three

// 出场：从后面骑过来；从天上掉下来、落地弹一下；原地蹦起来转一圈；翘着前轮骑过来再落下。
// 早先还有一种「从路边横着漂移过来」，2026-11-14 用户要删掉，别加回去
export type EntranceKind = 'ride' | 'drop' | 'spin' | 'wheelie';
// 庆祝：翘起前轮；一蹦一蹦；隔一会儿蹦起来转一圈；左右大幅度地摇
export type CelebrateKind = 'wheelie' | 'hops' | 'twirl' | 'sway';

export const ENTRANCES: readonly EntranceKind[] = ['ride', 'drop', 'spin', 'wheelie'];
export const CELEBRATIONS: readonly CelebrateKind[] = ['wheelie', 'hops', 'twirl', 'sway'];

// 出场动作多长（秒）；冲过终点后等车慢下来再开始庆祝（秒）
export const ENTRANCE_SECONDS = 1.6;
export const CELEBRATE_DELAY = 0.9;

// 叠在车本来的样子上的那一点：往后挪多少米（沿着路）、往旁边挪多少米、往上抬多少、车头往上翘多少、绕竖轴转多少、往一侧歪多少（都是弧度），
// 腾空没有（腾空时翅膀张开）
export interface Pose {
  back: number;
  side: number;
  lift: number;
  pitch: number;
  yaw: number;
  roll: number;
  airborne: boolean;
}

const still = (): Pose => ({ back: 0, side: 0, lift: 0, pitch: 0, yaw: 0, roll: 0, airborne: false });

function smooth(u: number): number {
  const v = Math.min(1, Math.max(0, u));
  return v * v * (3 - 2 * v);
}

// u 是出场进行到几成（0 到 1）
export function entrancePose(kind: EntranceKind, u: number): Pose {
  const pose = still();
  if (kind === 'ride') {
    // 从后面二十多米骑过来，越近越慢，到了晃一下停稳；最后那一下前轮微微抬一抬，像捏了一把闸
    const left = (1 - u) ** 3;
    pose.back = 26 * left;
    pose.roll = Math.sin(u * 14) * 0.07 * (1 - u);
    pose.pitch = u > 0.85 ? Math.sin(((u - 0.85) / 0.15) * Math.PI) * 0.12 : 0;
    pose.lift = Math.sin(pose.pitch) * 0.62;
  } else if (kind === 'drop') {
    // 前四分之三从十米高处越落越快地掉下来，落地以后弹一下
    if (u < 0.72) {
      const fall = u / 0.72;
      pose.lift = 10 * (1 - fall * fall);
      pose.yaw = (1 - fall) * 0.6;
      pose.airborne = true;
    } else {
      pose.lift = 0.45 * Math.sin(((u - 0.72) / 0.28) * Math.PI);
      pose.airborne = pose.lift > 0.04;
    }
  } else if (kind === 'wheelie') {
    // 翘着前轮从后面骑过来，到了把前轮放下来，落地颠一下
    pose.back = 22 * (1 - u) ** 2.4;
    const up = u < 0.8 ? 0.42 + Math.sin(u * 18) * 0.04 : 0.42 * (1 - smooth((u - 0.8) / 0.12));
    pose.pitch = up + (u > 0.92 ? Math.sin(((u - 0.92) / 0.08) * Math.PI) * 0.06 : 0);
    pose.lift = Math.sin(pose.pitch) * 0.62;
  } else {
    // 蹦起来一米多，在空中整整转一圈
    pose.lift = 1.7 * Math.sin(Math.PI * u);
    pose.yaw = Math.PI * 2 * smooth(u);
    pose.airborne = u > 0.03 && u < 0.97;
  }
  return pose;
}

// t 是开始庆祝以后过了多少秒（一直做到结算面板出来）
export function celebratePose(kind: CelebrateKind, t: number): Pose {
  const pose = still();
  if (kind === 'wheelie') {
    // 前轮翘起来稳住，轻轻地一点一点；车是绕后轮着地的那一点翘起来的，所以要整个往上抬一点
    const rise = smooth(t / 0.5);
    pose.pitch = (0.5 + Math.sin(t * 4) * 0.05) * rise;
    pose.lift = Math.sin(pose.pitch) * 0.62;
  } else if (kind === 'hops') {
    // 原地一蹦一蹦，左右摇头晃脑
    pose.lift = Math.abs(Math.sin(t * 4.5)) * 0.55;
    pose.roll = Math.sin(t * 2.25) * 0.12;
    pose.airborne = pose.lift > 0.05;
  } else if (kind === 'sway') {
    // 左右大幅度地摇，摇到两边时轻轻一跳
    pose.roll = Math.sin(t * 3) * 0.28;
    pose.lift = Math.max(0, Math.abs(Math.sin(t * 3)) - 0.8) * 1.6;
    pose.yaw = Math.sin(t * 1.5) * 0.25;
  } else {
    // 每 1.8 秒蹦起来转一圈，中间歇一会儿
    const cycle = (t % 1.8) / 1.8;
    if (cycle < 0.5) {
      const v = cycle / 0.5;
      pose.lift = 1.4 * Math.sin(Math.PI * v);
      pose.yaw = Math.PI * 2 * smooth(v);
      pose.airborne = v > 0.03 && v < 0.97;
    }
  }
  return pose;
}

// 随机挑一个，但不和上一次一样（用户要「每次切换动作不一样，先后顺序也不固定」）
export function pickOne<T>(list: readonly T[], last?: T): T {
  const choices = list.length > 1 && last !== undefined ? list.filter((item) => item !== last) : list;
  return choices[Math.floor(Math.random() * choices.length)];
}
