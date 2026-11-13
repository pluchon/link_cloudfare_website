// 车的物理：沿路的位置、横向偏移、倾角、速度、离地高度。
// 这个文件不依赖 three，可以脱离画面单独跑

import { HIGH_CLEAR, HIGH_SPEED, LAUNCH_SPEED, LAUNCH_UP, RAMP_KICK, SPRING_SPEED, type Course } from './course';
import type { TrackPoint } from './track';

export interface Controls {
  // 左右压车，-1 到 1，正数向右
  steer: number;
  // 按住冲刺
  dash: boolean;
  // 长按空格：比冲刺再快一档的猛冲，冲刺条耗得快一倍
  turbo: boolean;
}

export type BikeEvent = 'jump' | 'land' | 'finish' | 'dash' | 'turbo' | 'pad' | 'spring' | 'fall' | 'blast';

// 平常的速度和冲刺时的速度（米每秒）。用户嫌过慢，整体提过一次
const CRUISE = 19;
const SPRINT = 28;
// 猛冲（长按空格）：在冲刺上面再加一档，冲刺条耗得快一倍
const TURBO = 34;
const TURBO_DRAIN = 2;
const MIN_SPEED = 6;
const MAX_SPEED = 48;
// 火箭（超级加速）：这么多秒里一下子冲到这么快，不耗冲刺条（用户要的「持续时间短」）
const BLAST_SECONDS = 3.2;
// 磁铁：这么多秒里把周围的鱼吸过来
const MAGNET_SECONDS = 8;
const BLAST_SPEED = 46;
const ACCEL_BLAST = 5;
// 吃到辣椒：这么多秒里冲刺条不掉，各档速度都再快一点
const FEVER_SECONDS = 8;
const FEVER_SPEED = 3;
// 追上目标速度的快慢
const ACCEL = 1.1;
const ACCEL_DASH = 2.4;
const ACCEL_TURBO = 3.2;
// 压上加速带：比冲刺还快一点，持续这么久，不耗冲刺条
const SURGE_SPEED = 32;
const SURGE_SECONDS = 1.9;
const ACCEL_SURGE = 4;
// 坡度对速度的影响，1 就是没有任何阻力的自由滑行
const SLOPE = 0.5;
// 骑到路外面的草地、沙地上，速度打这个折
const ROUGH_SPEED = 0.6;
// 路外面最远能骑出去多少米，再往外是树和房子
const ROUGH_REACH = 5.5;
// 在路外面时车头往回偏的快慢（弧度每秒）
const ROUGH_HOMING = 0.22;

// 最大倾角（弧度）
const MAX_LEAN = 0.52;
// 弹簧晃过头时最多倒到这个角度
const LEAN_LIMIT = 0.7;
// 倾角是一根欠阻尼的弹簧：松手后会多晃一下再回正，这就是摇摇晃晃的来源
const LEAN_STIFF = 120;
const LEAN_DAMP = 10.5;
// 同样的倾角，转得比真车急一点，左右换道才跟手
const TURN_GAIN = 2.1;
// 一压车，车身马上往那一侧横着挪（米每秒，按每弧度倾角算）。只靠转车头再等它斜着骑过去，
// 要先倾、再转、再挪，中间隔了两层，玩家按下去半天不见动，会觉得左右挪不动
const SLIDE = 15;
// 进弯时车自己先压一部分，剩下的要靠玩家补
const CURVE_ASSIST = 0.6;
// 车头慢慢对回路的方向，松手不会一直斜着冲出去。松开手之后回得更快，车才停得住、不会滑过头
const HEADING_RETURN = 1.5;
const HEADING_RETURN_FREE = 3.4;
const MAX_HEADING = 0.7;
// 腾空时还能稍微带一点方向
const AIR_STEER = 0.3;

const GRAVITY = 19;

// 掉进深沟：飞到对岸时比路面低这么多以内还算够着了，再低就是撞在崖壁上掉下去
const FALL_GRACE = 0.45;
// 掉下去以后鹈鹕自己扑着翅膀飞上来、落在对岸，一共这么多秒；前面这一成多还在往下掉。落地后从这个速度重新起步
const RESCUE_SECONDS = 2;
const RESCUE_SINK = 0.3;
// 沟底是水，水面在高度 0（world.ts 的 SEA）：掉下去要一头扎进水里再飞出来
const RESCUE_DIVE = -1.3;
const RESCUE_SPEED = 9;
// 路面在一步里高出这么多（米）就不是坡，是一道坎：最陡的跳台以最快的速度骑上去，一步也只升 0.15 米
const STEP_UP = 0.5;

// 冲刺条满的时候能连续冲多久（秒）。用户三次嫌掉得太快：3 秒、7 秒都改过
const DASH_SECONDS = 11;
// 不冲刺的时候冲刺条自己慢慢回，每秒回这么多
const REGEN = 0.08;
// 冲刺条低于这个值时不能再起步冲刺，免得一闪一闪
const DASH_START = 0.08;

const point: TrackPoint = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, curve: 0 };

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

// 几个互不成倍数的正弦叠起来，当作路面给车把的小扰动
function wobble(t: number): number {
  return (Math.sin(t * 1.7 + 1.3) + 0.6 * Math.sin(t * 3.1) + 0.4 * Math.sin(t * 5.3 + 0.7)) * 0.5;
}

export class Bike {
  // 沿路走了多远
  s = 0;
  // 离中心线多远，正数在右边
  x = 0;
  // 高度（世界坐标）
  h = 0;
  // 前进速度
  v = 0;
  // 车头相对路的方向偏了多少，正数偏右
  heading = 0;
  // 倾角，正数向右倒
  lean = 0;
  leanVel = 0;
  // 竖直方向的速度
  vy = 0;
  grounded = true;
  // 是不是骑在路外面
  rough = false;
  // 冲刺条，0 到 1，出发时是满的
  boost = 1;
  dashing = false;
  // 是不是在猛冲（冲刺的更快一档）
  turbo = false;
  // 加速带的劲儿还剩多少秒
  surge = 0;
  // 辣椒的劲儿还剩多少秒：这段时间冲刺条不掉
  fever = 0;
  // 火箭的劲儿还剩多少秒
  blast = 0;
  // 磁铁还吸多少秒
  magnet = 0;
  finished = false;
  // 掉进深沟以后，离飞回对岸还有多少秒；0 就是没掉下去
  rescue = 0;
  // 轮子转过的角度，画面用
  spin = 0;
  // 落地时的下压量，画面用，自己会回弹
  squash = 0;
  // 脚下的路面高度和坡度（含跳台），画面用
  ground = 0;
  slope = 0;

  private clock = 0;
  // 上一步是不是在跳台的坡面上：离开坡面腾空的那一下要响一声
  private onRamp = false;
  private lastGround = 0;
  // 掉下去的那道沟的对岸在哪、掉下去那一刻有多高
  private fallEdge = 0;
  private fallFrom = 0;
  private fallAt = 0;
  private emit: (event: BikeEvent) => void;

  constructor(emit: (event: BikeEvent) => void = () => {}) {
    this.emit = emit;
  }

  reset(course: Course): void {
    course.track.at(0, point);
    this.s = 0;
    this.x = 0;
    this.h = point.y;
    this.v = CRUISE * 0.4;
    this.heading = 0;
    this.lean = 0;
    this.leanVel = 0;
    this.vy = 0;
    this.grounded = true;
    this.rough = false;
    this.boost = 1;
    this.dashing = false;
    this.turbo = false;
    this.surge = 0;
    this.fever = 0;
    this.blast = 0;
    this.magnet = 0;
    this.finished = false;
    this.rescue = 0;
    this.spin = 0;
    this.squash = 0;
    this.ground = point.y;
    this.slope = 0;
    this.clock = 0;
    this.onRamp = false;
    this.lastGround = point.y;
  }

  // 是不是正在加速（按着冲刺，或者刚压过加速带）
  get rushing(): boolean {
    return this.dashing || this.surge > 0 || this.blast > 0;
  }

  // 吃到磁铁：一段时间里把周围的鱼吸过来（吸的事在 game.ts 里做，这里只记时间）
  attract(): void {
    this.magnet = MAGNET_SECONDS;
  }

  // 吃到火箭：一小段时间里冲到最快
  launch(): void {
    this.blast = BLAST_SECONDS;
    this.emit('blast');
  }

  // 撞上路障：速度掉一半，冲刺和加速带的劲儿都断掉，车往 side 那一侧晃一下（1 右，-1 左）
  hit(side: number): void {
    this.v *= 0.5;
    this.surge = 0;
    this.blast = 0;
    this.dashing = false;
    this.turbo = false;
    this.leanVel += side * 3.2;
    this.squash = 0.7;
  }

  // 吃到辣椒：一段时间里冲刺条是满的、不会掉，骑得也更快
  ignite(): void {
    this.fever = FEVER_SECONDS;
    this.boost = 1;
  }

  // 给冲刺条加一点（吃到鱼时）
  refill(amount: number): void {
    this.boost = clamp(this.boost + amount, 0, 1);
  }

  // 没血了：这一趟到此为止，车慢慢停下来，不算冲过终点
  stop(): void {
    this.finished = true;
    this.dashing = false;
    this.turbo = false;
    this.surge = 0;
    this.blast = 0;
  }

  // 掉进深沟的那一段：先接着往下掉一小会儿，然后扑着翅膀划一道弧飞上来，落在对岸
  private climbOut(dt: number, course: Course): void {
    this.rescue = Math.max(0, this.rescue - dt);
    const u = 1 - this.rescue / RESCUE_SECONDS;
    const low = Math.min(this.fallFrom - 3, RESCUE_DIVE);
    course.track.at(this.fallEdge + 6, point);
    if (u < RESCUE_SINK) {
      const fall = u / RESCUE_SINK;
      this.h = this.fallFrom + (low - this.fallFrom) * fall * fall;
    } else {
      const w = (u - RESCUE_SINK) / (1 - RESCUE_SINK);
      const ease = w * w * (3 - 2 * w);
      this.s = this.fallAt + (this.fallEdge + 6 - this.fallAt) * ease;
      this.h = low + (point.y - low) * ease + Math.sin(w * Math.PI) * 1.8;
    }
    this.lean += (0 - this.lean) * Math.min(1, dt * 6);
    this.leanVel = 0;
    this.heading += (0 - this.heading) * Math.min(1, dt * 6);
    this.x *= 1 - Math.min(1, dt * 0.8);
    this.spin += 3 * dt;
    this.ground = point.y;
    this.lastGround = point.y;
    if (this.rescue > 0) return;
    this.h = point.y;
    this.vy = 0;
    this.v = RESCUE_SPEED;
    this.grounded = true;
    this.squash = 0.5;
    this.emit('land');
  }

  step(dt: number, course: Course, controls: Controls): void {
    const track = course.track;
    this.clock += dt;
    this.squash += (0 - this.squash) * Math.min(1, dt * 9);
    if (this.rescue > 0) {
      this.climbOut(dt, course);
      return;
    }
    const before = this.s;

    track.at(this.s, point);
    const half = track.width / 2;
    this.rough = Math.abs(this.x) > half + 0.9;

    // 速度：平常回到巡航，按住冲刺且还有余量时冲上去；骑到路外面会慢下来
    const wantTurbo = controls.turbo && !this.finished;
    const wantDash = (controls.dash || wantTurbo) && !this.finished;
    if (wantDash && !this.dashing && this.boost > DASH_START) {
      this.dashing = true;
      if (!wantTurbo) this.emit('dash');
    }
    if (!wantDash || this.boost <= 0) this.dashing = false;
    // 猛冲是冲刺的更快一档：速度更高，冲刺条耗得快一倍
    const turbo = this.dashing && wantTurbo;
    if (turbo && !this.turbo) this.emit('turbo');
    this.turbo = turbo;
    this.fever = Math.max(0, this.fever - dt);
    this.magnet = Math.max(0, this.magnet - dt);
    this.blast = Math.max(0, this.blast - dt);
    // 吃了辣椒、或者火箭正在推着走的时候，冲刺条都不掉
    if (this.fever > 0) this.boost = 1;
    else if (this.blast > 0) this.boost = Math.min(1, this.boost + dt * REGEN);
    else if (this.dashing) this.boost = Math.max(0, this.boost - (dt / DASH_SECONDS) * (turbo ? TURBO_DRAIN : 1));
    else this.boost = Math.min(1, this.boost + dt * REGEN);

    if (this.grounded && !this.finished && course.onPad(this.s, this.x)) {
      // 同一条加速带只响一次
      if (this.surge < SURGE_SECONDS - 0.6) this.emit('pad');
      this.surge = SURGE_SECONDS;
    }
    this.surge = Math.max(0, this.surge - dt);

    let target = this.finished ? 0 : this.blast > 0 ? BLAST_SPEED : this.turbo ? TURBO : this.surge > 0 ? SURGE_SPEED : this.dashing ? SPRINT : CRUISE;
    if (this.fever > 0 && !this.finished) target += FEVER_SPEED;
    if (this.rough && this.grounded) target *= ROUGH_SPEED;
    const pull = this.blast > 0 ? ACCEL_BLAST : this.turbo ? ACCEL_TURBO : this.surge > 0 ? ACCEL_SURGE : this.dashing ? ACCEL_DASH : ACCEL;
    this.v += (target - this.v) * pull * dt;
    // 上跳台的那一段白送一点速度，飞出去更远更爽；course.ts 排奖励圈时用的是同一个数
    const climbing = this.grounded && course.rampHeight(this.s, this.x) > 0;
    if (climbing && !this.finished) this.v += RAMP_KICK * dt;
    if (this.grounded) this.v -= 9.8 * Math.sin(point.pitch) * SLOPE * dt;
    this.v = clamp(this.v, this.finished ? 0 : MIN_SPEED, MAX_SPEED);

    // 倾角：玩家要的倾角加上过弯自带的那一部分，再叠一点扰动
    const steer = clamp(controls.steer, -1, 1) * (this.finished ? 0 : 1);
    const curveLean = Math.atan((point.curve * this.v * this.v) / (9.8 * TURN_GAIN));
    const want = clamp(steer * MAX_LEAN + curveLean * CURVE_ASSIST, -MAX_LEAN * 1.15, MAX_LEAN * 1.15);
    const shake = this.grounded ? (this.rough ? 3.4 : 0.5 + (this.v / SPRINT) * 1.2) : 0.2;
    const leanAcc = LEAN_STIFF * (want - this.lean) - LEAN_DAMP * this.leanVel + wobble(this.clock * (this.rough ? 3 : 1)) * shake;
    this.leanVel += leanAcc * dt;
    this.lean = clamp(this.lean + this.leanVel * dt, -LEAN_LIMIT, LEAN_LIMIT);

    // 方向：倾着就会转，倾得越多、骑得越慢转得越急
    const grip = this.grounded ? 1 : AIR_STEER;
    const turn = (Math.tan(this.lean) * 9.8 * TURN_GAIN * grip) / Math.max(this.v, 8);
    const forward = (this.v * Math.cos(this.heading)) / Math.max(0.5, 1 - point.curve * this.x);
    // 骑到路外面时车头自己往路上偏一点，松着手也能慢慢回到路上
    const homing = this.rough && this.grounded ? -Math.sign(this.x) * ROUGH_HOMING : 0;
    const settle = steer === 0 ? HEADING_RETURN_FREE : HEADING_RETURN;
    this.heading += (turn + homing - point.curve * forward - settle * this.heading) * dt;
    this.heading = clamp(this.heading, -MAX_HEADING, MAX_HEADING);

    this.s += forward * dt;
    // 横向：车头斜着骑过去的那一部分，加上压车直接带来的横移。过弯自带的那点倾角不算，否则不压车也会往弯里滑
    const slide = (this.lean - curveLean * CURVE_ASSIST) * SLIDE * grip;
    this.x += (this.v * Math.sin(this.heading) + (this.finished ? 0 : slide)) * dt;
    this.spin += this.v * dt;

    // 路外面有一道软边界：越往外越被推回来，车头也跟着摆正
    const reach = half + ROUGH_REACH;
    if (Math.abs(this.x) > reach) {
      this.x = Math.sign(this.x) * reach;
      if (Math.sign(this.heading) === Math.sign(this.x)) this.heading *= 1 - Math.min(1, dt * 12);
    }

    // 竖直方向：贴着路面走，路面突然落下去（坡顶、跳台尽头）就腾空
    track.at(this.s, point);
    // 悬在深沟上面时，脚下是沟底
    const pit = track.pit(this.s);
    const ground = point.y + course.rampHeight(this.s, this.x) - pit;
    // 路面一步高出一大截（台阶的石坎、深沟的对岸）不是车自己在往上走，不能算成上升的速度，否则下一步会被甩上天
    const rise = ground - this.lastGround;
    const groundSpeed = rise > STEP_UP ? 0 : rise / dt;

    // 深沟：这一步刚越过对岸的崖边时还比路面低，或者干脆落到了沟底，就是掉下去了
    const crossed = pit === 0 && track.pit(before) > 0;
    if ((crossed && this.h + this.vy * dt < ground - FALL_GRACE) || (pit > 0 && !this.grounded && this.h + this.vy * dt <= ground)) {
      let edge = this.s;
      for (const fault of track.faults) if (fault.deep && before >= fault.s && before < fault.s + fault.gap) edge = fault.s + fault.gap;
      this.fallEdge = edge;
      this.fallFrom = Math.min(this.h, point.y - 0.6);
      this.s = Math.min(this.s, edge - 0.9);
      this.fallAt = this.s;
      this.rescue = RESCUE_SECONDS;
      this.v = 0;
      this.vy = 0;
      this.grounded = false;
      this.dashing = false;
      this.turbo = false;
      this.surge = 0;
      this.blast = 0;
      this.emit('fall');
      return;
    }

    // 弹簧垫：轮子压上去就被弹到半空。斜着的那种还往前推一把，在空中的这段时间一直保持加速带那么快
    const spring = this.grounded && !this.finished ? course.onSpring(this.s, this.x) : null;
    if (spring) {
      this.vy = spring.high ? Math.sqrt(2 * GRAVITY * (spring.high + HIGH_CLEAR)) : spring.tilt ? LAUNCH_UP : SPRING_SPEED;
      if (spring.tilt) {
        this.v = Math.max(this.v, LAUNCH_SPEED);
        this.surge = (2 * LAUNCH_UP) / GRAVITY;
      }
      // 高跳弹簧：速度不够就补上，在空中一直往加速带的速度上靠，保证落在台阶上面
      if (spring.high) {
        this.v = Math.max(this.v, HIGH_SPEED);
        this.surge = (2 * this.vy) / GRAVITY;
      }
      this.grounded = false;
      this.emit('spring');
    }

    if (this.grounded) {
      if (this.vy - GRAVITY * dt > groundSpeed + 0.5) {
        this.grounded = false;
        // 从跳台的坡顶飞出去
        if (this.onRamp) this.emit('jump');
      } else {
        this.h = ground;
        this.vy = groundSpeed;
      }
    }

    this.onRamp = climbing;

    if (!this.grounded) {
      this.vy -= GRAVITY * dt;
      this.h += this.vy * dt;
      if (this.h <= ground) {
        this.squash = clamp(-this.vy / 14, 0, 1);
        this.leanVel += wobble(this.clock * 7) * this.squash * 3;
        this.h = ground;
        // 落地后竖直速度直接跟上路面，下坡时才不会刚落地又被判成腾空
        this.vy = groundSpeed;
        this.grounded = true;
        this.emit('land');
      }
    }
    this.lastGround = ground;
    this.ground = ground;
    this.slope = this.grounded ? Math.atan2(groundSpeed, Math.max(forward, 1)) : this.slope;

    if (!this.finished && this.s >= track.finish) {
      this.finished = true;
      this.dashing = false;
      this.turbo = false;
      this.emit('finish');
    }
  }
}

export const BIKE_SPEED = { cruise: CRUISE, sprint: SPRINT, turbo: TURBO } as const;
// 各种道具一共管多少秒，右下角的计时条按这个算还剩几成
export const EFFECT_SECONDS = { blast: BLAST_SECONDS, fever: FEVER_SECONDS, magnet: MAGNET_SECONDS, surge: SURGE_SECONDS } as const;
