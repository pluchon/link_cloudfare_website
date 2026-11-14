// 跟着鹈鹕的小伙伴（2026-11-14 用户要的「洞穴里有一团光动态地跟在后面，像引导精灵；海滩有海鸥跟着，要符合物理世界的感觉」）。
// 每个场景一种：海鸥、蝴蝶、小鸟、老鹰、萤火虫、无人机、蜻蜓、洞里的光团。
// 动起来都是同一套：一个点被一根有阻尼的弹簧拉向「鹈鹕身边的某个位置」，那个位置自己还会慢慢游移，
// 所以它会落后一点、追上来、转弯时甩出去再拉回来，不是死死钉在鹈鹕身上。
// 鸟按速度的方向朝前，转弯时往里侧身，往上爬、加速时用力扇翅膀，往下滑时翅膀平伸；蝴蝶和蜻蜓乱飞；无人机按加速度前倾；光团上下浮、一明一暗

import * as THREE from 'three';
import { buildBird, join, part } from './props';

export type CompanionKind = 'gull' | 'songbird' | 'hawk' | 'butterfly' | 'dragonfly' | 'firefly' | 'drone' | 'wisp';

// 每种跟多近：在鹈鹕后面多远、旁边多远、上面多高（米），弹簧多硬，四处游移多大、多快
interface Habit {
  back: number;
  side: number;
  up: number;
  stiff: number;
  wander: [number, number, number];
  pace: number;
}
// 2026-11-14 用户说「太靠前了，应该再靠后一点、再高一点」：都往后挪到鹈鹕和镜头之间、往上抬了一两米
const HABITS: Record<CompanionKind, Habit> = {
  gull: { back: 4.5, side: 4.5, up: 5.5, stiff: 3.2, wander: [2.5, 1.5, 2], pace: 0.35 },
  songbird: { back: 4, side: 3, up: 4.2, stiff: 4.5, wander: [1.5, 1, 1.2], pace: 0.6 },
  hawk: { back: -2, side: 3, up: 11, stiff: 1.6, wander: [9, 2.5, 4], pace: 0.18 },
  butterfly: { back: 3, side: 2.4, up: 2.8, stiff: 6, wander: [1, 0.7, 0.6], pace: 1.6 },
  dragonfly: { back: 3, side: 2.6, up: 2.4, stiff: 9, wander: [1.4, 0.4, 0.8], pace: 1.1 },
  firefly: { back: 3.5, side: 2.4, up: 2.8, stiff: 4, wander: [1.2, 0.8, 0.7], pace: 0.5 },
  drone: { back: 4.5, side: 2.8, up: 4.6, stiff: 5, wander: [0.6, 0.4, 0.6], pace: 0.4 },
  wisp: { back: 4, side: 2, up: 3.2, stiff: 3.5, wander: [0.9, 0.6, 0.6], pace: 0.55 },
};
// 光团身后往下掉的光点：最多同时几颗、每秒冒几颗
const TRAIL = 48;
const TRAIL_RATE = 32;

const up = new THREE.Vector3(0, 1, 0);
const goal = new THREE.Vector3();
const pull = new THREE.Vector3();
const right = new THREE.Vector3();
const ahead = new THREE.Vector3();
const look = new THREE.Vector3();
const pace = new THREE.Vector3();
// 算朝向用的替身：先让它对准要飞的方向，身子再慢慢转过去，速度方向一抖身子不会跟着抖
const aim = new THREE.Object3D();
const trailColor = new THREE.Color();

// 光团外面那圈柔光的贴图：一张画布上的径向渐变，所有光团共用一张
let halo: THREE.CanvasTexture | null = null;
function haloTexture(): THREE.CanvasTexture {
  if (halo) return halo;
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  if (context) {
    const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.25, 'rgba(255,255,255,0.45)');
    gradient.addColorStop(0.6, 'rgba(255,255,255,0.1)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 64, 64);
  }
  halo = new THREE.CanvasTexture(canvas);
  return halo;
}

// 平滑的随机游移：几个不同频率的正弦叠起来，种子不同走法就不同
function wander(t: number, seed: number): number {
  return Math.sin(t * 1.0 + seed) * 0.5 + Math.sin(t * 2.3 + seed * 1.7) * 0.3 + Math.sin(t * 4.1 + seed * 2.9) * 0.2;
}

export class Companion {
  readonly kind: CompanionKind;
  readonly group = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly position = new THREE.Vector3();
  private readonly velocity = new THREE.Vector3();
  private readonly accel = new THREE.Vector3();
  private readonly habit: Habit;
  private readonly seed = Math.random() * 100;
  private readonly wings: THREE.Object3D[] = [];
  private readonly spinners: THREE.Object3D[] = [];
  private readonly glows: THREE.Mesh[] = [];
  private readonly sparks: THREE.Mesh[] = [];
  private light: THREE.PointLight | null = null;
  private readonly lampColor = new THREE.Color();
  private halo: THREE.Sprite | null = null;
  private readonly owned: Array<{ dispose(): void }> = [];
  // 离场：往上往外飞走，飞远了再拿掉
  private leaving = 0;
  private side = Math.random() < 0.5 ? -1 : 1;
  private roll = 0;
  private flapPhase = 0;
  // 车速一帧一帧地算出来会抖，先平滑一下再用
  private speed = 0;
  // 光团身后掉下来的光点：世界里的位置、速度、活了多久、能活多久
  private trail: THREE.Points | null = null;
  private readonly trailPos = new Float32Array(TRAIL * 3);
  private readonly trailVel = new Float32Array(TRAIL * 3);
  private readonly trailAge = new Float32Array(TRAIL).fill(9);
  private readonly trailLife = new Float32Array(TRAIL).fill(1);
  private trailNext = 0;
  private trailDue = 0;

  // lamp 是场景里常驻的那盏点光源（world.ts 的 lamp）：光团和萤火虫借它照亮周围。不现建一盏——灯的数量一变，所有受光的材质都要重新编译，进洞那一下会卡
  constructor(kind: CompanionKind, lit: THREE.Material, glow: THREE.MeshBasicMaterial, start: THREE.Vector3, private readonly lamp: THREE.PointLight) {
    this.kind = kind;
    this.habit = HABITS[kind];
    this.group.add(this.body);
    this.position.copy(start);
    this.build(lit, glow);
    this.group.position.copy(start);
  }

  private mesh(geometry: THREE.BufferGeometry, material: THREE.Material): THREE.Mesh {
    geometry.computeVertexNormals();
    this.owned.push(geometry);
    const made = new THREE.Mesh(geometry, material);
    made.castShadow = true;
    return made;
  }

  private build(lit: THREE.Material, glow: THREE.MeshBasicMaterial): void {
    const kind = this.kind;
    if (kind === 'gull' || kind === 'songbird' || kind === 'hawk') {
      const shape = buildBird(kind === 'gull' ? 'gulls' : kind === 'hawk' ? 'eagles' : 'birds');
      this.owned.push(shape.body, shape.wing);
      const scale = kind === 'hawk' ? 1.6 : kind === 'gull' ? 1.1 : 0.7;
      this.body.scale.setScalar(scale);
      this.body.add(new THREE.Mesh(shape.body, lit));
      for (const sideSign of [1, -1]) {
        const pivot = new THREE.Group();
        pivot.position.set(sideSign * 0.1, 0.04, 0);
        const wing = new THREE.Mesh(shape.wing, lit);
        if (sideSign < 0) wing.scale.x = -1;
        pivot.add(wing);
        pivot.userData.side = sideSign;
        this.body.add(pivot);
        this.wings.push(pivot);
      }
      return;
    }
    if (kind === 'butterfly' || kind === 'dragonfly') {
      // 蝴蝶：细身子、两对宽翅膀；蜻蜓：长身子、两对窄长的透明感翅膀
      const fly = kind === 'dragonfly';
      const palette = fly ? [0x2f7fb8, 0xbfe6f4, 0x9ad0e8] : [0x3a2a24, 0xf2a03a, 0xffd66a];
      this.body.add(this.mesh(part(new THREE.BoxGeometry(0.05, 0.05, fly ? 0.7 : 0.32), palette[0]), lit));
      for (const sideSign of [1, -1]) {
        const pivot = new THREE.Group();
        pivot.userData.side = sideSign;
        const front = part(new THREE.PlaneGeometry(fly ? 0.6 : 0.36, fly ? 0.1 : 0.3), palette[1], { p: [sideSign * (fly ? 0.32 : 0.2), 0, -0.06], r: [-Math.PI / 2, 0, 0] });
        const back = part(new THREE.PlaneGeometry(fly ? 0.55 : 0.28, fly ? 0.09 : 0.24), palette[2], { p: [sideSign * (fly ? 0.3 : 0.16), 0, fly ? 0.1 : 0.14], r: [-Math.PI / 2, 0, 0] });
        const wing = this.mesh(join([front, back]), lit);
        pivot.add(wing);
        this.body.add(pivot);
        this.wings.push(pivot);
      }
      this.body.scale.setScalar(fly ? 1.1 : 1.3);
      return;
    }
    if (kind === 'drone') {
      // 无人机：一块小机身、四根臂、四个转着的螺旋桨，前面一颗绿灯后面一颗红灯一闪一闪
      this.body.add(this.mesh(join([part(new THREE.BoxGeometry(0.42, 0.12, 0.42), 0x2c2e3a), part(new THREE.BoxGeometry(0.2, 0.08, 0.16), 0x4fd8ff, { p: [0, -0.08, -0.12] })]), lit));
      for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        this.body.add(this.mesh(part(new THREE.BoxGeometry(0.42, 0.04, 0.05), 0x3a3d4c, { p: [x * 0.24, 0.02, z * 0.24], r: [0, (x * z * Math.PI) / 4, 0] }), lit));
        const rotor = this.mesh(part(new THREE.BoxGeometry(0.34, 0.01, 0.05), 0xd8dce8), lit);
        rotor.position.set(x * 0.4, 0.08, z * 0.4);
        this.body.add(rotor);
        this.spinners.push(rotor);
      }
      for (const [z, hex] of [[-0.24, 0x5fff8a], [0.24, 0xff4a5a]] as const) {
        const lamp = new THREE.Mesh(this.track(part(new THREE.OctahedronGeometry(0.05, 0), hex)), glow);
        lamp.position.set(0, 0, z);
        this.body.add(lamp);
        this.glows.push(lamp);
      }
      this.body.scale.setScalar(1.3);
      return;
    }
    // 光团（洞里）和萤火虫：一颗或几颗自己发光的小球，外面一圈柔光，再带一盏真的点光源，照亮周围的岩壁和路面
    const warm = kind === 'firefly';
    const color = warm ? 0xd8ff7a : 0x9fe8ff;
    const count = warm ? 6 : 1;
    for (let i = 0; i < count; i += 1) {
      // 光团是一颗小小的光球（用户说原来那颗太晃眼）
      const spark = new THREE.Mesh(this.track(part(new THREE.IcosahedronGeometry(warm ? 0.06 : 0.07, 1), color)), glow);
      this.body.add(spark);
      this.sparks.push(spark);
    }
    // 外面那圈柔光是一张中间亮、往外渐渐透明的贴图，始终正对镜头（一个均匀的半透明球看着像一块扁圆片）
    const haloMaterial = new THREE.SpriteMaterial({ map: haloTexture(), color, transparent: true, opacity: warm ? 0.5 : 0.55, depthWrite: false, blending: THREE.AdditiveBlending });
    this.owned.push(haloMaterial);
    this.halo = new THREE.Sprite(haloMaterial);
    this.halo.scale.setScalar(warm ? 2.4 : 0.9);
    this.body.add(this.halo);
    if (!warm) {
      // 光团飞过的地方一路往下掉细细的光点（用户要的「粒子效果掉下来」），慢慢落、慢慢暗下去
      const geometry = this.track(new THREE.BufferGeometry());
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL * 3), 3));
      geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(TRAIL * 3), 3));
      const material = this.track(
        new THREE.PointsMaterial({ size: 0.16, map: haloTexture(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }),
      );
      this.trail = new THREE.Points(geometry, material);
      this.trail.frustumCulled = false;
      this.group.add(this.trail);
    }
    this.light = this.lamp;
    this.lampColor.setHex(color);
  }

  private track<T extends { dispose(): void }>(thing: T): T {
    this.owned.push(thing);
    return thing;
  }

  // 让它离场：往上往外飞走
  retire(): void {
    if (this.leaving === 0) this.leaving = 0.0001;
  }

  // 飞远了、可以拿掉了
  get gone(): boolean {
    return this.leaving > 4;
  }

  // anchor 是鹈鹕的位置，yaw 是路的朝向（0 朝 -z），speed 是车速，time 是累计时间
  // ceiling 是头顶最多能飞多高（离鹈鹕），隧道里鹰就压低一点，不会钻进山里
  update(dt: number, anchor: THREE.Vector3, yaw: number, speed: number, time: number, still: boolean, ceiling = Infinity): void {
    const h = this.habit;
    this.speed += (speed - this.speed) * Math.min(1, dt * 6);
    ahead.set(Math.sin(yaw), 0, -Math.cos(yaw));
    right.set(Math.cos(yaw), 0, Math.sin(yaw));
    const t = time * h.pace;
    // 偶尔换到另一边去
    if (Math.sin(t * 0.37 + this.seed) > 0.995) this.side = -this.side;
    goal
      .copy(anchor)
      .addScaledVector(ahead, -h.back + wander(t, this.seed) * h.wander[2])
      .addScaledVector(right, this.side * h.side + wander(t, this.seed + 11) * h.wander[0])
      .addScaledVector(up, h.up + wander(t, this.seed + 23) * h.wander[1]);
    goal.y = Math.min(goal.y, anchor.y + ceiling);
    if (this.leaving > 0) {
      this.leaving += dt;
      goal.addScaledVector(up, this.leaving * 14).addScaledVector(right, this.side * this.leaving * 18).addScaledVector(ahead, -this.leaving * 10);
    }
    // 有阻尼的弹簧（接近临界阻尼，略微欠一点，追上来时会稍微冲过头再回来）
    const k = h.stiff * h.stiff;
    const c = 2 * h.stiff * 0.82;
    // 阻尼按「和鹈鹕的速度差」算，不按自己的绝对速度：后者等于一直被往后拽，车速十九米每秒时会落后九米，跑到镜头后面去
    // 用户说「有的场景卡卡的」：原来一帧最多只算三十分之一秒，帧慢的时候它就落后、下一帧又猛追，一顿一顿的。
    // 现在把这一帧的时间切成几小步一步步算完，帧快帧慢走的路都一样
    const steps = Math.max(1, Math.ceil(dt * 90));
    const step = dt / steps;
    for (let i = 0; i < steps; i += 1) {
      pace.copy(ahead).multiplyScalar(this.speed);
      pull.copy(goal).sub(this.position).multiplyScalar(k).addScaledVector(pace.sub(this.velocity), c);
      this.accel.copy(pull);
      this.velocity.addScaledVector(this.accel, step);
      this.position.addScaledVector(this.velocity, step);
    }
    this.group.position.copy(this.position);
    if (still) {
      this.group.position.copy(goal);
      this.position.copy(goal);
      this.velocity.set(0, 0, 0);
    }
    this.pose(dt, time, this.speed, yaw);
    this.fall(dt, still);
  }

  // 光团身后的光点：按时间冒出来，往下慢慢落，越来越暗；位置记在世界里，画的时候换成相对光团的位置
  private fall(dt: number, still: boolean): void {
    if (!this.trail) return;
    const position = this.trail.geometry.getAttribute('position') as THREE.BufferAttribute;
    const color = this.trail.geometry.getAttribute('color') as THREE.BufferAttribute;
    this.trailDue += still || this.leaving > 0 ? 0 : dt * TRAIL_RATE;
    while (this.trailDue >= 1) {
      this.trailDue -= 1;
      const i = this.trailNext;
      this.trailNext = (this.trailNext + 1) % TRAIL;
      this.trailPos[i * 3] = this.position.x + (Math.random() - 0.5) * 0.12;
      this.trailPos[i * 3 + 1] = this.position.y - 0.05;
      this.trailPos[i * 3 + 2] = this.position.z + (Math.random() - 0.5) * 0.12;
      // 跟着光团的速度走一点（不然一冒出来就被甩在后面一大截），再往四周散一点、往下掉
      this.trailVel[i * 3] = this.velocity.x * 0.6 + (Math.random() - 0.5) * 0.5;
      this.trailVel[i * 3 + 1] = -0.3 - Math.random() * 0.4;
      this.trailVel[i * 3 + 2] = this.velocity.z * 0.6 + (Math.random() - 0.5) * 0.5;
      this.trailAge[i] = 0;
      this.trailLife[i] = 0.9 + Math.random() * 0.7;
    }
    trailColor.copy(this.lampColor);
    for (let i = 0; i < TRAIL; i += 1) {
      const age = (this.trailAge[i] += dt);
      const left = Math.max(0, 1 - age / this.trailLife[i]);
      // 往下落得越来越快一点，横着的速度慢慢衰减
      this.trailVel[i * 3] *= 1 - Math.min(1, dt * 1.5);
      this.trailVel[i * 3 + 2] *= 1 - Math.min(1, dt * 1.5);
      this.trailVel[i * 3 + 1] -= 1.1 * dt;
      for (let a = 0; a < 3; a += 1) this.trailPos[i * 3 + a] += this.trailVel[i * 3 + a] * dt;
      position.setXYZ(i, this.trailPos[i * 3] - this.position.x, this.trailPos[i * 3 + 1] - this.position.y, this.trailPos[i * 3 + 2] - this.position.z);
      const glowLeft = left * left;
      color.setXYZ(i, trailColor.r * glowLeft, trailColor.g * glowLeft, trailColor.b * glowLeft);
    }
    position.needsUpdate = true;
    color.needsUpdate = true;
  }

  // 朝向和扇翅膀、闪灯
  private pose(dt: number, time: number, speed: number, yaw: number): void {
    const kind = this.kind;
    const v = this.velocity;
    const flat = Math.hypot(v.x, v.z);
    if (kind === 'wisp' || kind === 'firefly') {
      const breathe = 0.8 + 0.2 * Math.sin(time * 3.1 + this.seed) + 0.1 * Math.sin(time * 7.3 + this.seed * 2);
      if (this.light && this.leaving === 0) {
        this.light.color.copy(this.lampColor);
        this.light.position.copy(this.group.position);
        this.light.distance = kind === 'wisp' ? 12 : 9;
        this.light.intensity = (kind === 'wisp' ? 7 : 3.5) * breathe;
      }
      if (this.halo) this.halo.scale.setScalar((kind === 'wisp' ? 0.9 : 2.4) * (0.9 + 0.2 * breathe));
      this.sparks.forEach((spark, i) => {
        if (kind === 'wisp') {
          spark.position.set(0, Math.sin(time * 2 + this.seed) * 0.12, 0);
          return;
        }
        // 萤火虫一颗颗各自绕着中心乱飞，一闪一闪
        const a = time * (0.8 + i * 0.13) + i * 1.9 + this.seed;
        spark.position.set(Math.sin(a) * 0.9 + Math.sin(a * 2.3) * 0.3, Math.sin(a * 1.4 + i) * 0.5, Math.cos(a * 0.9) * 0.9);
        spark.scale.setScalar(0.6 + 0.6 * Math.max(0, Math.sin(time * (2 + i * 0.4) + i * 2.2)));
      });
      return;
    }
    // 朝着飞的方向（几乎不动时朝着路的方向）；鸟和虫子的头在 -z
    if (flat > 0.5 || Math.abs(v.y) > 0.5) look.copy(this.position).sub(v);
    else look.copy(this.position).add(new THREE.Vector3(-Math.sin(yaw), 0, Math.cos(yaw)));
    aim.position.copy(this.position);
    aim.lookAt(look);
    // 转弯时往里侧身：横向的加速度越大侧得越多
    right.set(-v.z, 0, v.x).normalize();
    const lateral = this.accel.dot(right);
    const bank = THREE.MathUtils.clamp(-lateral * (kind === 'drone' ? 0.02 : 0.035), -0.7, 0.7);
    this.roll += (bank - this.roll) * Math.min(1, dt * 5);
    aim.rotateZ(this.roll);
    // 往加速的方向前倾一点（无人机）
    if (kind === 'drone') aim.rotateX(THREE.MathUtils.clamp(this.accel.length() * 0.012, 0, 0.35));
    // 身子慢慢转到那个朝向，不是一帧一下子扭过去
    this.body.quaternion.slerp(aim.quaternion, Math.min(1, dt * (kind === 'butterfly' || kind === 'dragonfly' ? 12 : 7)));
    if (kind === 'drone') {
      // 螺旋桨一直转；灯一闪一闪
      this.spinners.forEach((rotor, i) => (rotor.rotation.y = time * 40 * (i % 2 ? 1 : -1)));
      this.glows.forEach((lamp, i) => (lamp.visible = Math.sin(time * 6 + i * Math.PI) > 0));
      return;
    }
    // 扇翅膀：往上爬、往前追的时候用力扇，往下滑的时候平伸着滑翔
    const forward = flat > 0.1 ? (this.accel.x * v.x + this.accel.z * v.z) / flat : 0;
    const effort = kind === 'butterfly' || kind === 'dragonfly' ? 1 : THREE.MathUtils.clamp(0.25 + forward / 25 + v.y / 5 + (speed > 30 ? 0.2 : 0), 0, 1);
    const rate = kind === 'butterfly' ? 16 : kind === 'dragonfly' ? 38 : kind === 'songbird' ? 18 : kind === 'gull' ? 7 : 4.5;
    this.flapPhase += dt * rate * (0.5 + effort * 0.7);
    const swing = kind === 'butterfly' ? 0.15 + 1.1 * (0.5 + 0.5 * Math.sin(this.flapPhase)) : kind === 'dragonfly' ? 0.25 * Math.sin(this.flapPhase) : 0.1 + effort * 0.75 * Math.sin(this.flapPhase);
    this.wings.forEach((pivot) => (pivot.rotation.z = swing * (pivot.userData.side as number)));
  }

  dispose(): void {
    this.group.removeFromParent();
    this.owned.forEach((thing) => thing.dispose());
  }
}
