// 车的物理：沿路的位置、横向偏移、倾角、速度、离地高度。
// 这个文件不依赖 three，可以脱离画面单独跑

import { JUMP_SPEED, SPRING_SPEED, type Course } from './course';
import type { TrackPoint } from './track';

export interface Controls {
  // 左右压车，-1 到 1，正数向右
  steer: number;
  // 这一步里刚按下跳
  jump: boolean;
  // 按住冲刺
  dash: boolean;
}

export type BikeEvent = 'jump' | 'land' | 'finish' | 'dash' | 'pad' | 'spring';

// 平常的速度和冲刺时的速度（米每秒）
const CRUISE = 16;
const SPRINT = 25;
const MIN_SPEED = 6;
const MAX_SPEED = 33;
// 追上目标速度的快慢
const ACCEL = 1.1;
const ACCEL_DASH = 2.4;
// 压上加速带：比冲刺还快一点，持续这么久，不耗冲刺条
const SURGE_SPEED = 29;
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
const SLIDE = 13;
// 进弯时车自己先压一部分，剩下的要靠玩家补
const CURVE_ASSIST = 0.6;
// 车头慢慢对回路的方向，松手不会一直斜着冲出去。松开手之后回得更快，车才停得住、不会滑过头
const HEADING_RETURN = 1.5;
const HEADING_RETURN_FREE = 3.4;
const MAX_HEADING = 0.7;
// 腾空时还能稍微带一点方向
const AIR_STEER = 0.3;

const GRAVITY = 19;
// 提前一点按跳、离开路面一瞬间按跳都算数
const JUMP_BUFFER = 0.12;
const COYOTE = 0.1;

// 冲刺条满的时候能连续冲多久（秒）
const DASH_SECONDS = 7;
// 不冲刺的时候冲刺条自己慢慢回，每秒回这么多
const REGEN = 0.07;
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
  // 加速带的劲儿还剩多少秒
  surge = 0;
  finished = false;
  // 轮子转过的角度，画面用
  spin = 0;
  // 落地时的下压量，画面用，自己会回弹
  squash = 0;
  // 脚下的路面高度和坡度（含跳台），画面用
  ground = 0;
  slope = 0;

  private clock = 0;
  private jumpBuffer = 0;
  private coyote = 0;
  private lastGround = 0;
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
    this.surge = 0;
    this.finished = false;
    this.spin = 0;
    this.squash = 0;
    this.ground = point.y;
    this.slope = 0;
    this.clock = 0;
    this.jumpBuffer = 0;
    this.coyote = 0;
    this.lastGround = point.y;
  }

  // 是不是正在加速（按着冲刺，或者刚压过加速带）
  get rushing(): boolean {
    return this.dashing || this.surge > 0;
  }

  // 撞上路障：速度掉一半，冲刺和加速带的劲儿都断掉，车往 side 那一侧晃一下（1 右，-1 左）
  hit(side: number): void {
    this.v *= 0.5;
    this.surge = 0;
    this.dashing = false;
    this.leanVel += side * 3.2;
    this.squash = 0.7;
  }

  // 给冲刺条加一点（吃到鱼时）
  refill(amount: number): void {
    this.boost = clamp(this.boost + amount, 0, 1);
  }

  step(dt: number, course: Course, controls: Controls): void {
    const track = course.track;
    this.clock += dt;
    this.squash += (0 - this.squash) * Math.min(1, dt * 9);

    track.at(this.s, point);
    const half = track.width / 2;
    this.rough = Math.abs(this.x) > half + 0.9;

    // 速度：平常回到巡航，按住冲刺且还有余量时冲上去；骑到路外面会慢下来
    const wantDash = controls.dash && !this.finished;
    if (wantDash && !this.dashing && this.boost > DASH_START) {
      this.dashing = true;
      this.emit('dash');
    }
    if (!wantDash || this.boost <= 0) this.dashing = false;
    if (this.dashing) this.boost = Math.max(0, this.boost - dt / DASH_SECONDS);
    else this.boost = Math.min(1, this.boost + dt * REGEN);

    if (this.grounded && !this.finished && course.onPad(this.s, this.x)) {
      // 同一条加速带只响一次
      if (this.surge < SURGE_SECONDS - 0.6) this.emit('pad');
      this.surge = SURGE_SECONDS;
    }
    this.surge = Math.max(0, this.surge - dt);

    let target = this.finished ? 0 : this.surge > 0 ? SURGE_SPEED : this.dashing ? SPRINT : CRUISE;
    if (this.rough && this.grounded) target *= ROUGH_SPEED;
    const pull = this.surge > 0 ? ACCEL_SURGE : this.dashing ? ACCEL_DASH : ACCEL;
    this.v += (target - this.v) * pull * dt;
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
    const ground = point.y + course.rampHeight(this.s, this.x);
    const groundSpeed = (ground - this.lastGround) / dt;

    if (controls.jump) this.jumpBuffer = JUMP_BUFFER;
    this.jumpBuffer -= dt;
    this.coyote -= dt;

    // 弹簧垫：轮子压上去就被弹起来，比自己跳高得多
    if (this.grounded && !this.finished && course.onSpring(this.s, this.x)) {
      this.vy = SPRING_SPEED;
      this.grounded = false;
      this.coyote = 0;
      this.emit('spring');
    }

    if (this.grounded) {
      if (this.vy - GRAVITY * dt > groundSpeed + 0.5) {
        this.grounded = false;
        this.coyote = COYOTE;
      } else {
        this.h = ground;
        this.vy = groundSpeed;
      }
    }

    if (this.jumpBuffer > 0 && (this.grounded || this.coyote > 0) && !this.finished) {
      this.vy = Math.max(this.vy, 0) + JUMP_SPEED;
      this.grounded = false;
      this.jumpBuffer = 0;
      this.coyote = 0;
      this.emit('jump');
    }

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
      this.emit('finish');
    }
  }
}

export const BIKE_SPEED = { cruise: CRUISE, sprint: SPRINT } as const;
