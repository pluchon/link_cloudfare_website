// 场景：路面和两侧地面、景物、小鱼和跳台、天空、远山、灯光、空气里飘的东西。
// 整条路按场景切成十二块，只画车附近的几块；峡谷和洞穴两侧另有崖壁和洞顶；天空、雾和灯光要等车过了场景交界的那道门才换

import * as THREE from 'three';
import { HIGH_RUN, LANE_WIDTH, ROAD_WIDTH, type Course, type ItemKind, type Spring } from './course';
import { buildBolt, buildBooster, buildWarning, buildChili, buildRocket, buildFish, buildGate, buildLauncher, buildObstacle, buildPad, buildProp, buildRamp, buildRing, buildBird, buildSpring, buildToken, type FlockKind, type PropShape } from './props';
import type { Backdrop, PropKind, Scene, TokenKind, Walls } from './scenes';
import { seeded, type TrackPoint } from './track';

// 场景交界处三样东西各有各的过渡距离（米）：
// 两侧地面的宽窄和起伏是地形，要在门前后各这么长的路上慢慢接上
const SHAPE_BLEND = 60;
// 路面和地面的颜色在门前后各这么长的路上换完
const PAINT_BLEND = 26;
// 天空、雾、灯光：到了门才开始变，再骑出这么远才变完（平常速度大约八秒），看得出天色一点点换过去。
// 试过两种都被用户否了：门前 60 米就开始变（「还没到就看见前面的光线了」）；过门后 26 米就变完（太快，「要有过渡的过程」）
const ARRIVE = 130;
// 路面网格沿路每隔多少米一排顶点
const ROW = 2;
// 路沿和路肩的外沿离路中心多远，再往外是地面
const CURB = ROAD_WIDTH / 2 + 0.9;
const SHOULDER = ROAD_WIDTH / 2 + 4;
// 一排路面顶点之间切成多少条
const STRIPS = 17;
// 水平面的高度：远处的地面或水面
const SEA = 0;
// 车前后各画几个场景
const BEHIND = 1;
const AHEAD = 2;
const FAR = 1100;
// 阴影罩住车周围多大一块（米），和阴影贴图的边长
const SHADOW_REACH = 75;
const SHADOW_MAP = 2048;
const ITEM_SIZE: Record<ItemKind, number> = { fish: 0.78, gold: 0.95, bolt: 1, ring: 1, chili: 1.5, token: 1.3, rocket: 1.5 };
// 崖壁按这么长一排来建（米），每排从脚到顶分几层；崖顶往外再铺多宽的一圈
const WALL_ROW = 4;
const WALL_LEVELS = 6;
const WALL_LIP = 18;
// 洞顶：最高处离路面多高，横着分几段，两头伸进崖壁里多少米。props.ts 的钟乳石是照着这条弧线挂的
const ROOF_PEAK = 11;
const ROOF_SEGMENTS = 8;
const ROOF_TUCK = 4;
// 瀑布的造型是按这么高做的，摆的时候按崖壁的高度拉长
const FALL_HEIGHT = 30;
// 云顺着风飘多大一圈（米）：飘到头缩小消失，再从另一头长出来
const SAIL_RANGE = 260;
// 成群飞的东西：一群几只、绕多大的圈（米）、飞多快（米每秒）、翅膀扇多快（弧度每秒）、
// 一轮里有几成时间是平伸着翅膀滑翔、前后两只隔多远、上下起伏多少、是不是绕圆圈（否则是 8 字）
const FLOCKS: Record<FlockKind, { count: [number, number]; radius: number; speed: number; flap: number; glide: number; gap: number; wave: number; circle: boolean }> = {
  gulls: { count: [3, 5], radius: 28, speed: 9, flap: 6, glide: 0.45, gap: 3.2, wave: 2.5, circle: false },
  birds: { count: [5, 8], radius: 36, speed: 12, flap: 9, glide: 0.2, gap: 2.6, wave: 3, circle: false },
  eagles: { count: [1, 2], radius: 20, speed: 7, flap: 4, glide: 0.8, gap: 14, wave: 2, circle: true },
  bats: { count: [3, 5], radius: 5, speed: 7, flap: 16, glide: 0, gap: 1.6, wave: 0.7, circle: false },
};
const isFlock = (kind: PropKind): kind is FlockKind => kind in FLOCKS;
// 会动的背景：云顺着风一直飘（sail，后面的数是每秒几米），极光和浪花来回晃（drift），
// 热气球、船、浮标上下浮（bob），鱼隔一阵从水里跳出来（leap）。后三种后面的数是幅度（米）
const MOTION: Partial<Record<PropKind, ['sail' | 'drift' | 'bob' | 'leap', number]>> = {
  cloud: ['sail', 3.2],
  cloudWarm: ['sail', 2.6],
  cloudDark: ['sail', 2.2],
  foam: ['drift', 1.4],
  foamNight: ['drift', 1.4],
  jumpFish: ['leap', 1.5],
  rowboat: ['bob', 0.12],
  balloonA: ['bob', 1.6],
  balloonB: ['bob', 1.6],
  kite: ['bob', 0.9],
  kiteBlue: ['bob', 0.9],
  sailboat: ['bob', 0.2],
  sailboatLit: ['bob', 0.2],
  buoy: ['bob', 0.24],
};
// 会被风吹得来回摆的景物
const SWAY: ReadonlySet<PropKind> = new Set([
  'palm',
  'treeGreen',
  'treeCherry',
  'treeAutumn',
  'treeRed',
  'pine',
  'pineSnow',
  'bush',
  'bushDry',
  'bushSnow',
  'flowerPink',
  'flowerYellow',
  'flowerBlue',
  'grass',
  'grassDry',
  'groveGreen',
  'groveCherry',
  'groveAutumn',
  'grovePine',
  'grovePineSnow',
  'reeds',
  'lotusBloom',
]);
// 起点后面也铺一段路和景物，出发前镜头是回头看的
const LEAD = 160;
// 矮得几乎贴地的景物，影子小到看不出来，数量又最多
const FLAT: ReadonlySet<PropKind> = new Set(['grass', 'grassDry', 'flowerPink', 'flowerYellow', 'flowerBlue', 'foam', 'foamNight']);

// 空气里飘的东西：一共多少片，在绕着镜头的这么大一个盒子里循环（米）
const AIR_COUNT = 340;
const AIR_BOX = [60, 24, 60] as const;

const p: TrackPoint = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, curve: 0 };
const q: TrackPoint = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, curve: 0 };
const turnMatrix = new THREE.Matrix4();
const spinMatrix = new THREE.Matrix4();
const colorA = new THREE.Color();
const colorB = new THREE.Color();
const dummy = new THREE.Object3D();

function smooth(u: number): number {
  const t = Math.max(0, Math.min(1, u));
  return t * t * (3 - 2 * t);
}

// 两个十六进制颜色按比例混合，结果写进 out
function mix(a: number, b: number, w: number, out: THREE.Color): THREE.Color {
  return out.setHex(a).lerp(colorB.setHex(b), w);
}

function lerp(a: number, b: number, w: number): number {
  return a + (b - a) * w;
}

// 固定的伪随机数，0 到 1：同一排同一层永远是同一个值，两段场景的崖壁在接缝处才对得上
function grit(a: number, b: number, c: number): number {
  const wave = Math.sin(a * 12.9898 + b * 78.233 + c * 37.719) * 43758.5453;
  return wave - Math.floor(wave);
}

interface Blend {
  a: Scene;
  b: Scene;
  w: number;
}

// 路两侧地面的起伏，左右两边不一样
function bump(s: number, side: number): number {
  return 0.6 + Math.sin(s * 0.021 + side * 1.7) * 0.6 + Math.sin(s * 0.057 + side * 4.1) * 0.4;
}

const SKY_VERTEX = `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const SKY_FRAGMENT = `
uniform vec3 uTop;
uniform vec3 uMid;
uniform vec3 uLow;
uniform vec3 uSun;
uniform vec3 uSunDir;
uniform float uSunSize;
uniform float uSunBoost;
uniform float uAurora;
uniform float uTime;
varying vec3 vDir;
void main() {
  vec3 dir = normalize(vDir);
  float h = dir.y;
  vec3 color = h < 0.2 ? mix(uLow, uMid, smoothstep(0.0, 0.2, h)) : mix(uMid, uTop, smoothstep(0.2, 0.8, h));
  float angle = acos(clamp(dot(dir, uSunDir), -1.0, 1.0));
  float disc = 1.0 - smoothstep(uSunSize * 0.94, uSunSize, angle);
  float halo = exp(-angle * angle / (uSunSize * uSunSize * 22.0)) * 0.42;
  color = mix(color, uSun * uSunBoost, disc) + uSun * halo * (1.0 - disc);
  // 极光：画在天空里，跟天空一样在无穷远处。两道帘子，下沿清楚、往上慢慢淡掉，竖着一根根光柱，底下绿、上头转紫，整片慢慢飘。
  // 用户嫌过早先那版「太低太假，像一个个条带子」：那是挂在七八十米高处的几片平面
  if (uAurora > 0.001 && h > 0.03) {
    float az = atan(dir.x, -dir.z);
    vec3 glow = vec3(0.0);
    for (int k = 0; k < 2; k++) {
      float fk = float(k);
      float base = 0.17 + fk * 0.13 + 0.06 * sin(az * 2.0 + fk * 2.3 + uTime * 0.05) + 0.035 * sin(az * 5.0 - uTime * 0.08 + fk);
      float above = h - base;
      float curtain = smoothstep(-0.012, 0.018, above) * exp(-max(above, 0.0) * (4.5 + fk * 2.5));
      float rays = 0.55 + 0.45 * sin(az * 38.0 + sin(az * 7.0 + uTime * 0.2) * 2.0 + fk * 5.0);
      rays *= 0.65 + 0.35 * sin(az * 91.0 - uTime * 0.35 + fk);
      float patchy = smoothstep(-0.3, 0.8, sin(az * 1.3 + fk * 1.7 + uTime * 0.03));
      vec3 tint = mix(vec3(0.18, 1.0, 0.55), vec3(0.6, 0.32, 1.0), smoothstep(0.03, 0.26, above));
      glow += tint * curtain * rays * patchy * (k == 0 ? 0.6 : 0.38);
    }
    color += glow * uAurora;
  }
  gl_FragColor = vec4(color, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// 飘着的每一片是一个点，位置在着色器里算：按时间往下落、顺风飘、来回晃，出了盒子就从另一头绕回来，
// 所以镜头走到哪儿周围都有，也不用每帧在脚本里挪几百个点
const AIR_VERTEX = `
uniform float uTime;
uniform vec3 uEye;
uniform vec3 uMove;
uniform float uSway;
uniform float uSize;
uniform float uHeight;
uniform float uAmount;
attribute float aSeed;
varying float vAlpha;
void main() {
  vec3 box = vec3(${AIR_BOX[0]}.0, ${AIR_BOX[1]}.0, ${AIR_BOX[2]}.0);
  vec3 pos = position + uMove * uTime;
  pos.x += sin(uTime * (0.5 + aSeed) + aSeed * 40.0) * uSway;
  pos.z += cos(uTime * (0.4 + aSeed * 0.7) + aSeed * 17.0) * uSway;
  pos.y += sin(uTime * (0.7 + aSeed * 0.5) + aSeed * 29.0) * uSway * 0.3;
  vec3 offset = vec3(box.x * 0.5, 7.0, box.z * 0.5);
  pos = mod(pos - uEye + offset, box) - offset + uEye;
  vec4 mv = viewMatrix * vec4(pos, 1.0);
  float dist = max(-mv.z, 0.1);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(uSize * uHeight * 0.5 * projectionMatrix[1][1] / dist, 1.0, 11.0);
  // 贴着镜头的和太远的都淡掉
  vAlpha = smoothstep(1.5, 5.0, dist) * (1.0 - smoothstep(22.0, 29.0, dist));
  // 这个场景用不了那么多片，多出来的挪到画面外面
  if (aSeed >= uAmount) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}`;

const AIR_FRAGMENT = `
uniform vec3 uColor;
uniform float uOpacity;
varying float vAlpha;
void main() {
  // 每一片画成一个小菱形
  vec2 c = abs(gl_PointCoord - 0.5);
  if (c.x + c.y > 0.5) discard;
  gl_FragColor = vec4(uColor, vAlpha * uOpacity);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// 远处的一圈剪影：海岛、丘陵、雪峰、平顶山、城市天际线
// 天边一圈山影在某个方位上有多高。角度只乘整数倍，转一圈正好接上；shift 让前后两层错开
function skyline(kind: Backdrop, angle: number, shift: number): number {
  const wave = (times: number, phase: number) => Math.sin(angle * times + phase + shift);
  // 取绝对值再倒过来，得到的是一道一道尖的山脊，而不是圆滚滚的波浪
  const crest = (times: number, phase: number) => 1 - Math.abs(wave(times, phase));
  if (kind === 'islands') {
    const land = wave(3, 1) * wave(7, 0) * 40 - 8;
    return land > 0 ? land * (1 + wave(31, 2) * 0.18) + 3 : 0;
  }
  if (kind === 'hills') return 26 + wave(5, 0) * 15 + wave(11, 2) * 9 + wave(23, 4) * 4 + wave(47, 1) * 1.6;
  if (kind === 'peaks') return 22 + (wave(3, 0.5) + 1) * 16 + crest(7, 1) * 44 + crest(13, 2.2) * 24 + crest(29, 0.7) * 10 + crest(61, 3) * 4;
  // 平顶山：高度是一级一级的，顶是平的，边是陡的
  const level = wave(4, 0) + wave(9, 1) * 0.6 + wave(17, 2.5) * 0.3;
  if (level > 0.45) return 42 + Math.floor((level - 0.45) * 3) * 9 + wave(53, 0) * 1.2;
  return level > -0.25 ? 21 + wave(37, 1) * 1.5 : 8 + wave(41, 2) * 1.5;
}

// 天边的一圈剪影。山和丘陵画前后两层：远的一层高一点、浅一点，近的一层矮一点、深一点；
// 每一层从山脚到山顶由浅到深，像隔着一层雾气。
// 试过把高山的山尖提亮当雪顶：这一圈是一片片从地平线竖到山顶的墙，颜色是按顶点插值的，
// 山尖一亮，整条竖带从上到下都跟着发白，看着像山上立了几根光柱。雪顶留给近处那些真有体积的山
// 颜色只存深浅，乘上场景给的颜色才是最后的样子
function buildBackdrop(kind: Backdrop): THREE.BufferGeometry {
  const position: number[] = [];
  const color: number[] = [];
  const wall = (radius: number, heights: number[], shade: number) => {
    const count = heights.length;
    for (let i = 0; i < count; i += 1) {
      const a0 = (i / count) * Math.PI * 2;
      const a1 = ((i + 1) / count) * Math.PI * 2;
      const x0 = Math.cos(a0) * radius;
      const z0 = Math.sin(a0) * radius;
      const x1 = Math.cos(a1) * radius;
      const z1 = Math.sin(a1) * radius;
      const left = heights[i];
      const right = heights[(i + 1) % count];
      position.push(x0, -12, z0, x1, -12, z1, x1, right, z1, x0, -12, z0, x1, right, z1, x0, left, z0);
      const foot = shade * 1.14;
      const tip = shade * 0.94;
      for (const value of [foot, foot, tip, foot, tip, tip]) color.push(value, value, value);
    }
  };
  if (kind === 'city') {
    // 城市的天际线是一栋一栋的方块，每一段两头一样高
    const random = seeded(kind.length * 131 + 7);
    const count = 150;
    for (let i = 0; i < count; i += 1) {
      const height = 22 + random() * random() * 100;
      const a0 = (i / count) * Math.PI * 2;
      const a1 = ((i + 1) / count) * Math.PI * 2;
      position.push(Math.cos(a0) * 560, -12, Math.sin(a0) * 560, Math.cos(a1) * 560, -12, Math.sin(a1) * 560, Math.cos(a1) * 560, height, Math.sin(a1) * 560);
      position.push(Math.cos(a0) * 560, -12, Math.sin(a0) * 560, Math.cos(a1) * 560, height, Math.sin(a1) * 560, Math.cos(a0) * 560, height, Math.sin(a0) * 560);
      for (let k = 0; k < 6; k += 1) color.push(1, 1, 1);
    }
  } else {
    const count = 260;
    const line = (shift: number, scale: number) => Array.from({ length: count }, (_, i) => skyline(kind, (i / count) * Math.PI * 2, shift) * scale);
    // 先画远的一层，再画近的一层，近的盖在远的上面
    wall(585, line(1.9, 1.3), 1.18);
    wall(545, line(0, 0.82), 0.84);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(color, 3));
  return geometry;
}

// 一只鸟：它那一群的中心在哪、多大、在队形里靠后多少、靠边多少，扇翅膀的节拍错开多少
interface Bird {
  x: number;
  y: number;
  z: number;
  size: number;
  phase: number;
  back: number;
  side: number;
  beat: number;
}

interface Flock {
  chunk: number;
  spec: (typeof FLOCKS)[FlockKind];
  bodies: THREE.InstancedMesh;
  wings: THREE.InstancedMesh;
  birds: Bird[];
}

// 会动的背景：每个实例原本摆在哪、怎么动、动多大
interface Mover {
  meshes: THREE.InstancedMesh[];
  chunk: number;
  bases: THREE.Matrix4[];
  type: 'sail' | 'drift' | 'bob' | 'leap';
  amount: number;
}

// 会转的景物：每个实例原本摆在哪、转轴在哪、转多快
interface Spinner {
  mesh: THREE.InstancedMesh;
  chunk: number;
  bases: THREE.Matrix4[];
  pivot: THREE.Matrix4;
  axis: 'y' | 'z' | 'fall';
  speed: number;
  period: number;
}

// 一个路障摆在哪、什么时候被撞的（没撞是 -1）
interface BlockSlot {
  body: THREE.InstancedMesh;
  lamps: THREE.InstancedMesh;
  id: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  hit: number;
}

interface FishSlot {
  mesh: THREE.InstancedMesh;
  id: number;
  x: number;
  y: number;
  z: number;
  // 那一处路的朝向，奖励圈要迎着来路立着
  yaw: number;
  // 被吃掉的时刻，没吃是 -1
  eaten: number;
}

export class World {
  readonly group = new THREE.Group();
  readonly fog = new THREE.Fog(0xffffff, 100, 600);

  private readonly course: Course;
  private readonly chunks: THREE.Group[] = [];
  private readonly slots: FishSlot[] = [];
  private readonly disposables: Array<{ dispose(): void }> = [];
  private readonly shapes = new Map<PropKind, PropShape>();
  private itemGeometry: Record<Exclude<ItemKind, 'token' | 'fish' | 'gold'>, THREE.BufferGeometry> | null = null;
  // 小鱼和金鱼每个场景一个样子，按「样子加颜色」存，用到了才建
  private readonly fishGeometry = new Map<string, THREE.BufferGeometry>();
  private readonly tokenGeometry = new Map<TokenKind, THREE.BufferGeometry>();
  private fishFrom = 0;

  private readonly lit: THREE.MeshLambertMaterial;
  private readonly glow: THREE.MeshBasicMaterial;
  private readonly litSway: THREE.MeshLambertMaterial;
  private readonly plain: THREE.MeshBasicMaterial;
  private readonly beam: THREE.MeshBasicMaterial;

  private readonly sky: THREE.Mesh;
  private readonly skyUniforms: Record<string, THREE.IUniform>;
  private readonly stars: THREE.Points;
  private readonly backdrops = new Map<Backdrop, THREE.Mesh>();
  // 叠加发光的景物不受雾影响，隔着两个场景也看得见，所以单独记下来按场景淡入淡出
  private readonly beams: Array<{ mesh: THREE.InstancedMesh; scene: Scene }> = [];
  private readonly spinners: Spinner[] = [];
  private readonly movers: Mover[] = [];
  private readonly flocks: Flock[] = [];
  private readonly birdShapes = new Map<FlockKind, { body: THREE.BufferGeometry; wing: THREE.BufferGeometry }>();
  private readonly swayTime = { value: 0 };
  private readonly blocks: BlockSlot[] = [];
  // 正在被撞飞的路障
  private readonly falling: number[] = [];
  private obstacleGeometry: { lit: THREE.BufferGeometry; glow: THREE.BufferGeometry } | null = null;
  private readonly air: THREE.Points;
  private readonly airUniforms: Record<string, THREE.IUniform>;
  // 减少动态效果时，飘的东西和转的东西都停住
  private readonly still: boolean;
  private readonly plane: THREE.Mesh;
  private readonly sun: THREE.DirectionalLight;
  private readonly hemi: THREE.HemisphereLight;

  constructor(course: Course, still = false) {
    this.course = course;
    this.still = still;
    this.lit = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    this.glow = new THREE.MeshBasicMaterial({ vertexColors: true });
    // 树和草用的材质：和普通的一样，只是顶点会按时间来回摆，越高的地方摆得越多，看着像有风
    this.litSway = this.lit.clone();
    this.litSway.onBeforeCompile = (shader) => {
      shader.uniforms.uSway = this.swayTime;
      shader.vertexShader =
        'uniform float uSway;\n' +
        shader.vertexShader.replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
#ifdef USE_INSTANCING
  // 每棵树按自己站的位置错开节拍，不会整片一起晃
  vec3 swayRoot = instanceMatrix[3].xyz;
  float swayBend = min(transformed.y * transformed.y * 0.004, 0.25) + transformed.y * 0.012 + min(transformed.y, 1.0) * 0.04;
  transformed.x += sin(uSway * 1.3 + swayRoot.x * 0.35 + swayRoot.z * 0.21) * swayBend;
  transformed.z += cos(uSway * 1.1 + swayRoot.z * 0.3 + swayRoot.x * 0.17) * swayBend * 0.6;
#endif`,
        );
    };
    this.litSway.customProgramCacheKey = () => 'pelican-sway';
    this.plain = new THREE.MeshBasicMaterial({ vertexColors: true });
    this.beam = new THREE.MeshBasicMaterial({
      vertexColors: true,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      fog: false,
      side: THREE.DoubleSide,
    });
    this.disposables.push(this.lit, this.litSway, this.glow, this.plain, this.beam);

    // 天空：一个跟着镜头走的大球，颜色在着色器里按高度渐变，太阳也画在里面。
    // 它不写深度也不比深度，排在最前面画，后面的东西都盖在它上面
    this.skyUniforms = {
      uTop: { value: new THREE.Color() },
      uMid: { value: new THREE.Color() },
      uLow: { value: new THREE.Color() },
      uSun: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunSize: { value: 0.05 },
      uSunBoost: { value: 1 },
      uAurora: { value: 0 },
      uTime: { value: 0 },
    };
    const skyMaterial = new THREE.ShaderMaterial({
      uniforms: this.skyUniforms,
      vertexShader: SKY_VERTEX,
      fragmentShader: SKY_FRAGMENT,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(600, 24, 16), skyMaterial);
    this.sky.renderOrder = -4;
    this.sky.frustumCulled = false;
    this.group.add(this.sky);

    const random = seeded(31);
    const starPosition: number[] = [];
    for (let i = 0; i < 520; i += 1) {
      const angle = random() * Math.PI * 2;
      const up = 0.06 + random() * 0.94;
      const flat = Math.sqrt(1 - up * up);
      starPosition.push(Math.cos(angle) * flat * 580, up * 580, Math.sin(angle) * flat * 580);
    }
    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starPosition, 3));
    // 星星和远山是半透明的，会排在路面之后画，所以要比深度，才不会盖到近处的东西上
    this.stars = new THREE.Points(
      starGeometry,
      new THREE.PointsMaterial({ color: 0xffffff, size: 1.8, sizeAttenuation: false, transparent: true, depthWrite: false, fog: false }),
    );
    this.stars.renderOrder = -3;
    this.stars.frustumCulled = false;
    this.group.add(this.stars);

    for (const kind of ['islands', 'hills', 'peaks', 'mesa', 'city'] as const) {
      const mesh = new THREE.Mesh(
        buildBackdrop(kind),
        new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide }),
      );
      mesh.renderOrder = -2;
      mesh.frustumCulled = false;
      this.backdrops.set(kind, mesh);
      this.group.add(mesh);
    }

    const airRandom = seeded(97);
    const airPosition: number[] = [];
    const airSeed: number[] = [];
    for (let i = 0; i < AIR_COUNT; i += 1) {
      airPosition.push(airRandom() * AIR_BOX[0], airRandom() * AIR_BOX[1], airRandom() * AIR_BOX[2]);
      airSeed.push(airRandom());
    }
    const airGeometry = new THREE.BufferGeometry();
    airGeometry.setAttribute('position', new THREE.Float32BufferAttribute(airPosition, 3));
    airGeometry.setAttribute('aSeed', new THREE.Float32BufferAttribute(airSeed, 1));
    this.airUniforms = {
      uTime: { value: 0 },
      uEye: { value: new THREE.Vector3() },
      uMove: { value: new THREE.Vector3() },
      uSway: { value: 1 },
      uSize: { value: 0.1 },
      uHeight: { value: 720 },
      uAmount: { value: 1 },
      uColor: { value: new THREE.Color() },
      uOpacity: { value: 0 },
    };
    this.air = new THREE.Points(
      airGeometry,
      new THREE.ShaderMaterial({
        uniforms: this.airUniforms,
        vertexShader: AIR_VERTEX,
        fragmentShader: AIR_FRAGMENT,
        transparent: true,
        depthWrite: false,
      }),
    );
    this.air.frustumCulled = false;
    this.air.renderOrder = 2;
    this.group.add(this.air);

    // 天边那一大片用带高光的材质：是水的时候，太阳和月亮会在水面上映出一道光
    this.plane = new THREE.Mesh(new THREE.PlaneGeometry(FAR * 4, FAR * 4), new THREE.MeshPhongMaterial({ shininess: 70 }));
    this.plane.rotation.x = -Math.PI / 2;
    this.plane.position.y = SEA;
    this.plane.receiveShadow = true;
    this.group.add(this.plane);

    this.hemi = new THREE.HemisphereLight();
    this.sun = new THREE.DirectionalLight();
    // 阴影：一盏平行光照出一张贴图，只罩住车周围的一块
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP);
    const frustum = this.sun.shadow.camera;
    frustum.left = -SHADOW_REACH;
    frustum.right = SHADOW_REACH;
    frustum.top = SHADOW_REACH;
    frustum.bottom = -SHADOW_REACH;
    frustum.near = 20;
    frustum.far = 420;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.35;
    this.group.add(this.hemi, this.sun, this.sun.target);

    const track = course.track;
    for (let index = 0; index < this.course.scenes.length; index += 1) {
      const chunk = new THREE.Group();
      const from = index === 0 ? -LEAD : index * track.sceneLength;
      const last = index === this.course.scenes.length - 1;
      // 第一段往后多铺了一截，终点仍然按场景本身的范围算，不能跟着 from 一起挪
      const to = last ? track.length : (index + 1) * track.sceneLength;
      const road = new THREE.Mesh(this.buildRoad(from, to), this.lit);
      road.receiveShadow = true;
      chunk.add(road);
      const { cliff, roof } = this.buildCliffs(from, to);
      if (cliff) {
        const mesh = new THREE.Mesh(cliff, this.lit);
        mesh.receiveShadow = true;
        chunk.add(mesh);
      }
      if (roof) {
        // 洞顶要投影子，洞里和隧道里才是暗的
        const mesh = new THREE.Mesh(roof, this.lit);
        mesh.castShadow = true;
        chunk.add(mesh);
      }
      this.addProps(chunk, index, from, to);
      this.addGate(chunk, last ? track.finish : to, last);
      this.addRamps(chunk, from, to);
      this.addPads(chunk, from, to);
      this.addSprings(chunk, from, to);
      this.addWarnings(chunk, from, to);
      this.addObstacles(chunk, from, to);
      this.addItems(chunk, index);
      chunk.visible = false;
      this.chunks.push(chunk);
      this.group.add(chunk);
    }
  }

  // s 处夹在哪两个场景之间、各占多少：离门还有 before 米时开始换，过了门 after 米换完
  private blend(s: number, before: number, after: number): Blend {
    const track = this.course.track;
    const scenes = this.course.scenes;
    const here = scenes[track.sceneAt(s)];
    // 离得最近的是第几道门（第 n 道门在第 n-1 和第 n 个场景之间）
    const gate = Math.round(s / track.sceneLength);
    if (gate <= 0 || gate >= scenes.length) return { a: here, b: here, w: 0 };
    const past = s - gate * track.sceneLength;
    if (past <= -before || past >= after) return { a: here, b: here, w: 0 };
    return { a: scenes[gate - 1], b: scenes[gate], w: smooth((past + before) / (before + after)) };
  }

  // 以 (s, offset) 为中心、半径 radius 的一块地方，会不会压到前后拐过来的路。
  // 路是弯的，离这一段两百多米远的地方，可能正好是三百米之后的路面
  private clearOf(s: number, offset: number, radius: number): boolean {
    const track = this.course.track;
    track.at(s, q);
    const x = q.x + Math.cos(q.yaw) * offset;
    const z = q.z + Math.sin(q.yaw) * offset;
    const need = radius + track.width / 2 + 4;
    for (let at = s - 460; at <= s + 460; at += 10) {
      if (at < -LEAD || at > track.length) continue;
      track.at(at, q);
      if (Math.hypot(q.x - x, q.z - z) < need) return false;
    }
    return true;
  }

  // 路两侧的地面在离路中心 offset 米处有多高。景物靠它站在地面上，路面网格也用同一个公式
  private terrain(s: number, offset: number, roadY: number, land: number, bumps: number): number {
    const reach = Math.abs(offset);
    if (reach <= SHOULDER) return roadY;
    const mid = SHOULDER + (land - SHOULDER) * 0.32;
    const midY = Math.max(0.25, roadY * 0.55 + bump(s, Math.sign(offset)) * bumps);
    if (reach <= mid) return lerp(roadY, midY, (reach - SHOULDER) / (mid - SHOULDER));
    if (reach <= land) return lerp(midY, SEA - 0.4, (reach - mid) / (land - mid));
    return SEA - 0.4;
  }

  // s 处两侧的崖壁：脚在哪、多高、多斜。前后两个场景一个有崖壁一个没有时，高度从零慢慢长起来
  private wallAt(s: number): { foot: number; height: number; lean: number; one: Walls; two: Walls; w: number } | null {
    const { a, b, w } = this.blend(s, SHAPE_BLEND, SHAPE_BLEND);
    if (!a.walls && !b.walls) return null;
    const one = a.walls ?? (b.walls as Walls);
    const two = b.walls ?? (a.walls as Walls);
    const height = lerp(a.walls ? a.walls.height : 0, b.walls ? b.walls.height : 0, w);
    // 写了 widen 的崖壁：过了那一点，崖脚在四十米里往外退开
    const footOf = (walls: Walls, scene: Scene) => {
      if (!walls.widen) return walls.foot;
      const at = s / this.course.track.sceneLength - this.course.scenes.indexOf(scene);
      return lerp(walls.foot, walls.widen.foot, smooth((at - walls.widen.from) / 0.07));
    };
    return { foot: lerp(footOf(one, a.walls ? a : b), footOf(two, b.walls ? b : a), w), height, lean: lerp(one.lean, two.lean, w), one, two, w };
  }

  // 崖壁和洞顶：和路面分开建。崖壁每一排从脚到顶分几层，每层往里往外错开一点，颜色一层深一层浅，看着像岩层；
  // 头顶有顶的地方（洞穴、隧道）再搭一道拱，两头各砌一面洞口
  private buildCliffs(from: number, to: number): { cliff: THREE.BufferGeometry | null; roof: THREE.BufferGeometry | null } {
    const track = this.course.track;
    const cliff = { position: [] as number[], color: [] as number[] };
    const roof = { position: [] as number[], color: [] as number[] };
    type Point = [number, number, number];
    type Tint = [number, number, number];
    interface Row {
      n: number;
      sides: Point[][];
      // 洞顶的那道拱，和它正上方、崖顶那么高的一条线（洞口那面墙和顶盖用）
      arch: Point[] | null;
      rim: Point[];
      // 岩石两种、崖顶一种、草木两种
      tints: Tint[];
      // 岩壁上草木长了几成
      moss: number;
    }
    const quad = (into: { position: number[]; color: number[] }, a: Point, b: Point, c: Point, d: Point, tint: Tint, light: number) => {
      into.position.push(...a, ...b, ...c, ...a, ...c, ...d);
      for (let i = 0; i < 6; i += 1) into.color.push(tint[0] * light, tint[1] * light, tint[2] * light);
    };
    const row = (s: number): Row | null => {
      const wall = this.wallAt(s);
      if (!wall || wall.height < 0.6) return null;
      const n = Math.round(s / WALL_ROW);
      track.at(s, p);
      const cos = Math.cos(p.yaw);
      const sin = Math.sin(p.yaw);
      const top = p.y + wall.height;
      // 崖壁还矮的时候（刚从平地长起来）不错开那么多
      const rough = Math.min(1, wall.height / 10);
      const at = (offset: number, y: number): Point => [p.x + cos * offset, y, p.z + sin * offset];
      const edge = wall.foot + wall.lean * wall.height;
      const sides = [-1, 1].map((side) => {
        const points: Point[] = [];
        for (let j = 0; j <= WALL_LEVELS; j += 1) {
          const t = j / WALL_LEVELS;
          const out = wall.foot + wall.lean * wall.height * t + (j > 0 ? (grit(n, j, side) - 0.35) * 2.6 * rough : 0);
          const y = lerp(SEA - 1.5, top, t) + (j > 0 && j < WALL_LEVELS ? (grit(n, j + 20, side) - 0.5) * 1.6 * rough : 0);
          points.push(at(side * out, y));
        }
        // 崖顶往外再铺一圈，从路上看不到崖壁后面是空的
        points.push(at(side * (edge + WALL_LIP), top));
        return points;
      });
      let arch: Point[] | null = null;
      const rim: Point[] = [];
      if (this.course.covered(s)) {
        const peak = Math.min(ROOF_PEAK, wall.height * 0.72);
        arch = [];
        for (let k = 0; k <= ROOF_SEGMENTS; k += 1) {
          const u = -1 + (2 * k) / ROOF_SEGMENTS;
          arch.push(at(u * (wall.foot + ROOF_TUCK), p.y + peak * (0.6 + 0.4 * Math.cos((u * Math.PI) / 2)) + (grit(n, k + 40, 0) - 0.5) * 0.9));
          rim.push(at(u * (edge + 3), top + 0.3));
        }
      }
      const tints = [
        mix(wall.one.color[0], wall.two.color[0], wall.w, colorA).toArray() as Tint,
        mix(wall.one.color[1], wall.two.color[1], wall.w, colorA).toArray() as Tint,
        mix(wall.one.top, wall.two.top, wall.w, colorA).toArray() as Tint,
        mix((wall.one.moss ?? wall.one).color[0], (wall.two.moss ?? wall.two).color[0], wall.w, colorA).toArray() as Tint,
        mix((wall.one.moss ?? wall.one).color[1], (wall.two.moss ?? wall.two).color[1], wall.w, colorA).toArray() as Tint,
      ];
      return { n, sides, arch, rim, tints, moss: lerp(wall.one.moss?.amount ?? 0, wall.two.moss?.amount ?? 0, wall.w) };
    };

    let near = row(from);
    for (let s = from; s < to - 0.01; s += WALL_ROW) {
      const next = row(Math.min(s + WALL_ROW, to));
      if (near && next) {
        const { n, tints } = near;
        for (let side = 0; side < 2; side += 1) {
          for (let j = 0; j <= WALL_LEVELS; j += 1) {
            // 最上面那一条是崖顶；下面每层轮流用两种岩石的颜色，每隔几排整体错一层
            // 草木一片一片地长在岩壁上，每片横着八米、竖着一层，越往上越多；没长的地方露着石头
            const green = grit(Math.floor(n / 2), j, side + 11) < near.moss * (0.25 + 0.75 * (j / WALL_LEVELS));
            const tint = j === WALL_LEVELS ? tints[2] : green ? tints[grit(n, j + 31, side) < 0.5 ? 3 : 4] : tints[Math.abs(j + Math.floor(n / 5)) % 2];
            quad(cliff, near.sides[side][j], near.sides[side][j + 1], next.sides[side][j + 1], next.sides[side][j], tint, 0.9 + grit(n, j + 60, side) * 0.2);
          }
        }
        if (near.arch && next.arch) {
          for (let k = 0; k < ROOF_SEGMENTS; k += 1) {
            quad(roof, near.arch[k], near.arch[k + 1], next.arch[k + 1], next.arch[k], tints[1], 0.62 + grit(n, k + 80, 0) * 0.16);
          }
          // 顶盖：从高处看下来洞顶上面是实的
          quad(roof, near.rim[0], near.rim[ROOF_SEGMENTS], next.rim[ROOF_SEGMENTS], next.rim[0], tints[2], 1);
        }
        // 洞口：这一排有顶、隔壁那一排没有，就在有顶的这一排砌一面墙，从拱一直砌到崖顶
        const mouth = near.arch && !next.arch ? near : !near.arch && next.arch ? next : null;
        if (mouth?.arch) {
          for (let k = 0; k < ROOF_SEGMENTS; k += 1) {
            quad(roof, mouth.arch[k], mouth.arch[k + 1], mouth.rim[k + 1], mouth.rim[k], tints[0], 0.8 + grit(n, k + 90, 0) * 0.14);
          }
        }
      }
      near = next;
    }

    const finish = (data: { position: number[]; color: number[] }) => {
      if (data.position.length === 0) return null;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.position, 3));
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(data.color, 3));
      geometry.computeVertexNormals();
      this.disposables.push(geometry);
      return geometry;
    };
    return { cliff: finish(cliff), roof: finish(roof) };
  }

  private buildRoad(from: number, to: number): THREE.BufferGeometry {
    const track = this.course.track;
    const position: number[] = [];
    const color: number[] = [];
    const half = track.width / 2;
    const shade = new THREE.Color();

    // 两条车道线离路中心多远
    const lane = LANE_WIDTH / 2;
    // 一排顶点：从最左边的地面到最右边的地面
    const row = (s: number) => {
      const shape = this.blend(s, SHAPE_BLEND, SHAPE_BLEND);
      const land = lerp(shape.a.land, shape.b.land, shape.w);
      const bumps = lerp(shape.a.bumps, shape.b.bumps, shape.w);
      const mid = SHOULDER + (land - SHOULDER) * 0.32;
      const offsets = [
        -land,
        -mid,
        -SHOULDER,
        -CURB,
        -half,
        -half + 0.2,
        -half + 0.4,
        -lane - 0.1,
        -lane + 0.1,
        lane - 0.1,
        lane + 0.1,
        half - 0.4,
        half - 0.2,
        half,
        CURB,
        SHOULDER,
        mid,
        land,
      ];
      track.at(s, p);
      const cos = Math.cos(p.yaw);
      const sin = Math.sin(p.yaw);
      const points = offsets.map((offset) => [p.x + cos * offset, this.terrain(s, offset, p.y, land, bumps), p.z + sin * offset]);
      // 颜色换得比地形快得多，另算一份
      const { a, b, w } = this.blend(s, PAINT_BLEND, PAINT_BLEND);
      return { points, a, b, w };
    };

    let near = row(from);
    // 起点后面那段的 s 是负数，行号取绝对值，下面按奇偶挑颜色才不会取到数组外面
    for (let s = from; s < to - 0.01; s += ROW) {
      const n = Math.abs(Math.round(s / ROW));
      // 断层：路面到这里断开。断口前最后一排停在崖边上（再往前半米高度就落下去了），空出来的那一截不铺路，
      // 补一面从崖边垂到水面的崖、一条水、对岸一道矮坎；下一截从对岸重新开始
      const fault = track.faults.find((item) => item.s > s && item.s <= s + ROW);
      type Patch = [number[], number[], number[], number[], number, number];
      const paintAll = (patches: Patch[]) => {
        for (const [a, b, c, d, hex, light] of patches) {
          shade.setHex(hex).multiplyScalar(light);
          position.push(...a, ...b, ...c, ...a, ...c, ...d);
          for (let i = 0; i < 6; i += 1) color.push(shade.r, shade.g, shade.b);
        }
      };
      if (fault) {
        const lip = row(fault.s - 0.5);
        const far = row(fault.s + fault.gap);
        // 断层底下是贴着对岸的一条水；深沟（断路）一直切到水面以下，两面崖壁越往下越暗，沟底就是河
        const water = fault.deep ? SEA - 0.6 : track.at(fault.s + fault.gap, p).y - 1.4;
        const split = fault.deep ? 0.45 : 1;
        // part 是从这个点往水面落了几成
        const sink = (point: number[], part = 1) => [point[0], point[1] + (water - point[1]) * part, point[2]];
        const wall = lip.a.walls?.color ?? [0x8f929c, 0x787c88];
        for (let k = 0; k < STRIPS; k += 1) {
          const patches: Patch[] = [
            [lip.points[k], lip.points[k + 1], sink(lip.points[k + 1], split), sink(lip.points[k], split), wall[k % 2], 0.9 + grit(k, 3, 7) * 0.2],
            [sink(lip.points[k]), sink(lip.points[k + 1]), sink(far.points[k + 1]), sink(far.points[k]), lip.a.far, 1],
            [sink(far.points[k], split), sink(far.points[k + 1], split), far.points[k + 1], far.points[k], wall[(k + 1) % 2], 0.8 + grit(k, 5, 9) * 0.2],
          ];
          if (fault.deep) {
            patches.push(
              [sink(lip.points[k], split), sink(lip.points[k + 1], split), sink(lip.points[k + 1]), sink(lip.points[k]), wall[(k + 1) % 2], 0.5 + grit(k, 7, 3) * 0.14],
              [sink(far.points[k]), sink(far.points[k + 1]), sink(far.points[k + 1], split), sink(far.points[k], split), wall[k % 2], 0.46 + grit(k, 9, 5) * 0.14],
            );
          }
          paintAll(patches);
        }
      }
      // 台阶：迎面一道石坎。坎脚那一排停在坎前半米，坎顶那一排从台阶上重新开始
      const ledge = track.ledges.find((item) => item.s > s && item.s <= s + ROW);
      const foot = ledge ? row(ledge.s - 0.5) : null;
      const brow = ledge ? row(ledge.s) : null;
      if (foot && brow) {
        const wall = foot.a.walls?.color ?? [0x8f929c, 0x787c88];
        const patches: Patch[] = [];
        for (let k = 0; k < STRIPS; k += 1) {
          // 坎分上下两层，颜色错开，看着是垒起来的石头
          const mid = [0, 1].map((side) => {
            const low = foot.points[k + side];
            const high = brow.points[k + side];
            return [(low[0] + high[0]) / 2, (low[1] + high[1]) / 2, (low[2] + high[2]) / 2];
          });
          patches.push(
            [foot.points[k], foot.points[k + 1], mid[1], mid[0], wall[k % 2], 0.82 + grit(k, 13, 3) * 0.2],
            [mid[0], mid[1], brow.points[k + 1], brow.points[k], wall[(k + 1) % 2], 0.92 + grit(k, 15, 5) * 0.2],
          );
        }
        paintAll(patches);
      }
      // 这一排落在断口里：不铺
      if (track.faults.some((item) => s >= item.s && s < item.s + item.gap)) {
        near = row(Math.min(s + ROW, to));
        continue;
      }
      const next = fault ? row(fault.s - 0.5) : (foot ?? row(Math.min(s + ROW, to)));
      const { a, b, w } = near;
      const pick = (get: (scene: Scene) => number) => mix(get(a), get(b), w, colorA);
      const hazard = track.faults.some((item) => item.deep && s >= item.s - 4 && s < item.s);
      // 近处的地面按四排一片换深浅，左右两边错开，不会看成整齐的条纹
      const block = Math.floor(n / 4);
      for (let k = 0; k < STRIPS; k += 1) {
        const patch = ((block * 7919 + (k < STRIPS / 2 ? 3 : 11)) % 5) % 2;
        // 每一条是什么，从外往里数：两条地面、路肩、路沿、路面的边、边线、边上那条车道、车道线、中间那条车道
        const edge = Math.min(k, STRIPS - 1 - k);
        if (edge === 0) pick((scene) => scene.ground[1]);
        else if (edge === 1) pick((scene) => scene.ground[patch]);
        else if (edge === 2) pick((scene) => scene.shoulder);
        else if (edge === 3) pick((scene) => scene.curb[Math.floor(n / 2) % 2]);
        // 边线是实线；两条车道线是虚线，画两米空四米
        // 断路崖边的最后几米：路面刷成黄黑相间的格子
        else if (edge >= 4 && hazard) colorA.setHex((k + n) % 2 ? 0xf2c14e : 0x2b2d3a);
        else if (edge === 5 || (edge === 7 && n % 3 === 0)) pick((scene) => scene.line);
        else pick((scene) => scene.road);
        // 地面每块深浅略有不同，才有一块一块的手绘感
        const jitter = edge <= 1 ? 0.95 + ((n * 7919 + k * 104729) % 17) / 17 / 10 : 1;
        shade.copy(colorA).multiplyScalar(jitter);
        const p0 = near.points[k];
        const p1 = near.points[k + 1];
        const p2 = next.points[k + 1];
        const p3 = next.points[k];
        position.push(...p0, ...p1, ...p2, ...p0, ...p2, ...p3);
        for (let i = 0; i < 6; i += 1) color.push(shade.r, shade.g, shade.b);
      }
      near = brow ?? next;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(color, 3));
    geometry.computeVertexNormals();
    this.disposables.push(geometry);
    return geometry;
  }

  private shape(kind: Exclude<PropKind, FlockKind>): PropShape {
    let found = this.shapes.get(kind);
    if (!found) {
      found = buildProp(kind);
      this.shapes.set(kind, found);
      [found.lit, found.glow, found.flat, found.beam, found.spin?.part].forEach((geometry) => geometry && this.disposables.push(geometry));
    }
    return found;
  }

  private addProps(chunk: THREE.Group, index: number, from: number, to: number): void {
    const track = this.course.track;
    const scene = this.course.scenes[index];
    const random = seeded(index * 977 + 13);
    for (const rule of scene.props) {
      const exact = (rule.per100 * (to - from)) / 100;
      const count = Math.floor(exact) + (random() < exact % 1 ? 1 : 0);
      if (count === 0) continue;
      const matrices: THREE.Matrix4[] = [];
      for (let i = 0; i < count; i += 1) {
        // 路灯这种贴着路沿的，等距左右交替；其余随机撒
        const fixed = rule.near === rule.far;
        const s = fixed ? from + ((i + 0.5) / count) * (to - from) : from + random() * (to - from);
        let side: number = rule.side ?? (fixed ? (i % 2 === 0 ? -1 : 1) : random() < 0.5 ? -1 : 1);
        let reach = rule.near + random() * (rule.far - rule.near);
        const size = rule.scale ? lerp(rule.scale[0], rule.scale[1], random()) : 1;
        const height = rule.lift ? lerp(rule.lift[0], rule.lift[1], random()) : 0;
        const facing = random() * Math.PI * 2;
        // 跨在路上的东西不放在起点附近，也不和场景交界的门挤在一起
        if (rule.span && (s < 50 || Math.abs(s - Math.round(s / track.sceneLength) * track.sceneLength) < 30)) continue;
        // 断口里和断口两边不摆东西
        if (!rule.lift && track.faults.some((item) => s > item.s - 6 && s < item.s + item.gap + 6)) continue;
        // 台阶的石坎和它前面那条高跳弹簧附近也不摆，免得栅栏插在石坎里、石头压在弹簧上
        if (!rule.lift && track.ledges.some((item) => s > item.s - HIGH_RUN - 5 && s < item.s + 4)) continue;
        // 只放在这段场景的某一截里的
        if (rule.part && (s / track.sceneLength - index < rule.part[0] || s / track.sceneLength - index > rule.part[1])) continue;
        // 只放露天的、只放洞顶底下的
        if (rule.under && (rule.under === 'roof') !== this.course.covered(s)) continue;
        // 有崖壁的地方：落在崖壁里面的不放，落在崖壁外面的站到崖顶上；瀑布贴着崖脚摆，和崖壁一样高
        const wall = this.wallAt(s);
        let onTop = false;
        let stretch = 1;
        if (rule.wall) {
          if (!wall || wall.height < 14) continue;
          reach = wall.foot + 0.6;
          stretch = wall.height / FALL_HEIGHT;
        } else if (wall && wall.height > 1.5 && !rule.span && !rule.lift && reach > wall.foot - 1.5) {
          if (rule.float || reach < wall.foot + wall.lean * wall.height + 5) continue;
          onTop = true;
        }
        // 大块头这一侧放不下就换到另一侧，两侧都压着路就不放
        if (rule.clear && !this.clearOf(s, side * reach, rule.clear * size)) {
          side = -side;
          if (!this.clearOf(s, side * reach, rule.clear * size)) continue;
        }
        const offset = side * reach;
        track.at(s, p);
        const { a, b, w } = this.blend(s, SHAPE_BLEND, SHAPE_BLEND);
        const terrain = this.terrain(s, offset, p.y, lerp(a.land, b.land, w), lerp(a.bumps, b.bumps, w));
        // 浮在水上的东西，脚下要真的是水
        if (rule.float && terrain > SEA) continue;
        let y = Math.max(SEA - 0.05, terrain) - 0.06;
        if (onTop && wall) y = p.y + wall.height - 0.15;
        else if (rule.lift) y = p.y + height;
        else if (rule.float) y = SEA + 0.03;
        else if (rule.span) y = p.y;
        dummy.position.set(p.x + Math.cos(p.yaw) * offset, y, p.z + Math.sin(p.yaw) * offset);
        dummy.rotation.set(0, rule.span ? -p.yaw : rule.face ? -side * (Math.PI / 2) - p.yaw : facing, 0);
        dummy.scale.set(size, size * stretch, size);
        dummy.updateMatrix();
        matrices.push(dummy.matrix.clone());
      }
      if (matrices.length === 0) continue;
      // 鸟不是一整块摆上去的，每只单独飞
      if (isFlock(rule.kind)) {
        this.addFlock(chunk, index, rule.kind, matrices);
        continue;
      }
      // 飘在天上的、离得太远的、贴着地的花花草草都不用投影子，阴影那一遍能少画不少东西
      const shadows = !rule.lift && rule.near < SHADOW_REACH && !FLAT.has(rule.kind);
      const shape = this.shape(rule.kind);
      const add = (geometry: THREE.BufferGeometry | undefined, material: THREE.Material) => {
        if (!geometry) return null;
        const mesh = new THREE.InstancedMesh(geometry, material, matrices.length);
        if (material === this.beam) this.beams.push({ mesh, scene });
        matrices.forEach((matrix, i) => mesh.setMatrixAt(i, matrix));
        // 实例散在整段路上，按单个几何体算出来的包围球会把它误判成看不见
        mesh.frustumCulled = false;
        mesh.castShadow = (material === this.lit || material === this.litSway) && shadows;
        chunk.add(mesh);
        return mesh;
      };
      const made = [add(shape.lit, SWAY.has(rule.kind) ? this.litSway : this.lit), add(shape.glow, this.glow), add(shape.flat, this.plain), add(shape.beam, this.beam)];
      const motion = MOTION[rule.kind];
      if (motion && !this.still) {
        this.movers.push({ meshes: made.filter((mesh): mesh is THREE.InstancedMesh => !!mesh), chunk: index, bases: matrices, type: motion[0], amount: motion[1] });
      }
      if (shape.spin) {
        const mesh = add(shape.spin.part, shape.spin.layer === 'beam' ? this.beam : shape.spin.layer === 'flat' ? this.plain : this.lit);
        if (mesh) {
          this.spinners.push({
            mesh,
            chunk: index,
            bases: matrices,
            pivot: new THREE.Matrix4().makeTranslation(...shape.spin.pivot),
            axis: shape.spin.axis,
            speed: shape.spin.speed,
            period: shape.spin.period ?? 1,
          });
        }
      }
    }
  }

  private addGate(chunk: THREE.Group, s: number, finish: boolean): void {
    const track = this.course.track;
    const geometry = buildGate(track.width, finish);
    this.disposables.push(geometry);
    const gate = new THREE.Mesh(geometry, this.lit);
    track.at(s, p);
    gate.position.set(p.x, p.y, p.z);
    gate.rotation.y = -p.yaw;
    gate.castShadow = true;
    chunk.add(gate);
  }

  private addRamps(chunk: THREE.Group, from: number, to: number): void {
    const track = this.course.track;
    const ramps = this.course.ramps.filter((ramp) => ramp.s >= from && ramp.s < to);
    if (ramps.length === 0) return;
    // 三档跳台长短高矮都不一样，一段场景里最多一个，各建各的
    for (const ramp of ramps) {
      const geometry = buildRamp(ramp.len, ramp.width, ramp.height, ramp.grade);
      this.disposables.push(geometry);
      const mesh = new THREE.Mesh(geometry, this.lit);
      track.at(ramp.s, p);
      mesh.position.set(p.x + Math.cos(p.yaw) * ramp.x, p.y + 0.02, p.z + Math.sin(p.yaw) * ramp.x);
      mesh.rotation.set(0, -p.yaw, 0);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      chunk.add(mesh);
    }
  }

  private addPads(chunk: THREE.Group, from: number, to: number): void {
    const track = this.course.track;
    const pads = this.course.pads.filter((pad) => pad.s >= from && pad.s < to);
    if (pads.length === 0) return;
    const geometry = buildPad(pads[0].len, pads[0].width);
    this.disposables.push(geometry);
    // 用自发光的材质，夜里也看得清
    const mesh = new THREE.InstancedMesh(geometry, this.glow, pads.length);
    dummy.rotation.order = 'YXZ';
    pads.forEach((pad, i) => {
      track.at(pad.s + pad.len / 2, p);
      const pitch = p.pitch;
      track.at(pad.s, p);
      dummy.position.set(p.x + Math.cos(p.yaw) * pad.x, p.y, p.z + Math.sin(p.yaw) * pad.x);
      // 顺着坡度贴在路面上
      dummy.rotation.set(pitch, -p.yaw, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    dummy.rotation.order = 'XYZ';
    mesh.frustumCulled = false;
    chunk.add(mesh);
  }

  private addSprings(chunk: THREE.Group, from: number, to: number): void {
    const track = this.course.track;
    // 直着弹的、斜着弹的、横铺整条路的高跳弹簧是三种造型，各建一批
    const sorts: Array<[(spring: Spring) => boolean, (length: number, width: number) => THREE.BufferGeometry]> = [
      [(spring) => !spring.tilt && !spring.high, buildSpring],
      [(spring) => spring.tilt, buildLauncher],
      [(spring) => !!spring.high, buildBooster],
    ];
    for (const [match, shape] of sorts) {
      const springs = this.course.springs.filter((spring) => spring.s >= from && spring.s < to && match(spring));
      if (springs.length === 0) continue;
      const geometry = shape(springs[0].len, springs[0].width);
      this.disposables.push(geometry);
      const mesh = new THREE.InstancedMesh(geometry, this.lit, springs.length);
      springs.forEach((spring, i) => {
        track.at(spring.s, p);
        dummy.position.set(p.x + Math.cos(p.yaw) * spring.x, p.y + 0.02, p.z + Math.sin(p.yaw) * spring.x);
        dummy.rotation.set(0, -p.yaw, 0);
        dummy.scale.setScalar(1);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      chunk.add(mesh);
    }
  }

  // 断路（掉得下去的深沟）前面立一道警示门
  private addWarnings(chunk: THREE.Group, from: number, to: number): void {
    const track = this.course.track;
    const mine = track.faults.filter((fault) => fault.deep && fault.s >= from && fault.s < to);
    if (mine.length === 0) return;
    const geometry = buildWarning(track.width);
    this.disposables.push(geometry);
    const mesh = new THREE.InstancedMesh(geometry, this.lit, mine.length);
    mine.forEach((fault, i) => {
      track.at(fault.s - 1.5, p);
      dummy.position.set(p.x, p.y, p.z);
      dummy.rotation.set(0, -p.yaw, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    chunk.add(mesh);
  }

  private addObstacles(chunk: THREE.Group, from: number, to: number): void {
    const track = this.course.track;
    const mine = this.course.obstacles.map((obstacle, i) => ({ obstacle, i })).filter(({ obstacle }) => obstacle.s >= from && obstacle.s < to);
    if (mine.length === 0) return;
    if (!this.obstacleGeometry) {
      this.obstacleGeometry = buildObstacle(mine[0].obstacle.width);
      this.disposables.push(this.obstacleGeometry.lit, this.obstacleGeometry.glow);
    }
    const body = new THREE.InstancedMesh(this.obstacleGeometry.lit, this.lit, mine.length);
    const lamps = new THREE.InstancedMesh(this.obstacleGeometry.glow, this.glow, mine.length);
    body.frustumCulled = false;
    lamps.frustumCulled = false;
    body.castShadow = true;
    mine.forEach(({ obstacle, i }, id) => {
      track.at(obstacle.s, p);
      const slot = { body, lamps, id, x: p.x + Math.cos(p.yaw) * obstacle.x, y: p.y, z: p.z + Math.sin(p.yaw) * obstacle.x, yaw: p.yaw, hit: -1 };
      this.blocks[i] = slot;
      this.poseBlock(slot, 0);
    });
    chunk.add(body, lamps);
  }

  // 摆一个路障：t 是被撞之后过了几成（0 是还立着，1 是已经飞没了）。被撞的往前翻着跟头飞出去，越飞越小
  private poseBlock(slot: BlockSlot, t: number): void {
    const fly = t * 7;
    dummy.rotation.order = 'YXZ';
    dummy.position.set(slot.x + Math.sin(slot.yaw) * fly, slot.y + Math.sin(Math.PI * t) * 2.2, slot.z - Math.cos(slot.yaw) * fly);
    dummy.rotation.set(-t * 5, -slot.yaw, 0);
    dummy.scale.setScalar(Math.max(0, 1 - t * t));
    dummy.updateMatrix();
    dummy.rotation.order = 'XYZ';
    slot.body.setMatrixAt(slot.id, dummy.matrix);
    slot.lamps.setMatrixAt(slot.id, dummy.matrix);
    slot.body.instanceMatrix.needsUpdate = true;
    slot.lamps.instanceMatrix.needsUpdate = true;
  }

  // 标记一个路障被撞飞了
  knock(index: number, time: number): void {
    this.blocks[index].hit = time;
    this.falling.push(index);
  }

  private tumble(time: number): void {
    for (let k = this.falling.length - 1; k >= 0; k -= 1) {
      const slot = this.blocks[this.falling[k]];
      const t = Math.min(1, (time - slot.hit) / 0.7);
      this.poseBlock(slot, t);
      if (t >= 1) this.falling.splice(k, 1);
    }
  }

  private addItems(chunk: THREE.Group, index: number): void {
    const track = this.course.track;
    if (!this.itemGeometry) {
      this.itemGeometry = { bolt: buildBolt(), ring: buildRing(), chili: buildChili(), rocket: buildRocket() };
      this.disposables.push(...Object.values(this.itemGeometry));
    }
    // 纪念品每个场景一种造型，用到了才建
    const token = this.course.scenes[index].token.kind;
    let tokenShape = this.tokenGeometry.get(token);
    if (!tokenShape) {
      tokenShape = buildToken(token);
      this.tokenGeometry.set(token, tokenShape);
      this.disposables.push(tokenShape);
    }
    const look = this.course.scenes[index].fish;
    const fishShape = (body: number, fin: number) => {
      const key = `${look.form}:${body}:${fin}`;
      let made = this.fishGeometry.get(key);
      if (!made) {
        made = buildFish(body, fin, look.form);
        this.fishGeometry.set(key, made);
        this.disposables.push(made);
      }
      return made;
    };
    const all = this.course.items;
    for (const kind of ['fish', 'gold', 'bolt', 'ring', 'chili', 'token', 'rocket'] as const) {
      const mine = all.map((item, i) => ({ item, i })).filter(({ item }) => item.scene === index && item.kind === kind);
      if (mine.length === 0) continue;
      // 金鱼和能量罐用自发光的材质，夜里也一眼看得见
      const geometry =
        kind === 'token' ? tokenShape : kind === 'fish' ? fishShape(look.body, look.fin) : kind === 'gold' ? fishShape(0xffd84a, 0xfff2b0) : this.itemGeometry[kind];
      // 夜里和洞里的小鱼也用自己发光的材质，不然黑乎乎的看不见
      const mesh = new THREE.InstancedMesh(geometry, kind === 'fish' && !look.glow ? this.lit : this.glow, mine.length);
      mesh.frustumCulled = false;
      mine.forEach(({ item, i }, id) => {
        track.at(item.s, p);
        this.slots[i] = {
          mesh,
          id,
          x: p.x + Math.cos(p.yaw) * item.x,
          y: p.y + item.y,
          z: p.z + Math.sin(p.yaw) * item.x,
          yaw: p.yaw,
          eaten: -1,
        };
        // 先摆到自己的位置上。每帧只刷新车附近的那些，没刷到的如果不先摆好，会全堆在世界原点——
        // 正好是出发的地方，开局时鹈鹕脚下就套着一堆金色的圈
        dummy.position.set(this.slots[i].x, this.slots[i].y, this.slots[i].z);
        dummy.rotation.set(0, -p.yaw, 0);
        dummy.scale.setScalar(ITEM_SIZE[kind]);
        dummy.updateMatrix();
        mesh.setMatrixAt(id, dummy.matrix);
      });
      chunk.add(mesh);
    }
  }

  // 标记一条鱼被吃掉了，time 是当前时刻
  collect(index: number, time: number): void {
    this.slots[index].eaten = time;
  }

  // 刷新 s 在 [from, to] 范围里的鱼：没吃的慢慢转，刚吃的缩小飘走
  private paintFish(from: number, to: number, time: number): void {
    const fish = this.course.items;
    while (this.fishFrom < fish.length && fish[this.fishFrom].s < from) this.fishFrom += 1;
    const touched = new Set<THREE.InstancedMesh>();
    for (let i = this.fishFrom; i < fish.length && fish[i].s < to; i += 1) {
      const slot = this.slots[i];
      const gone = slot.eaten < 0 ? 0 : Math.min(1, (time - slot.eaten) / 0.2);
      if (fish[i].kind === 'ring') {
        // 奖励圈不转也不飘，迎着来路立着，一呼一吸地放大缩小；穿过去的那一下往外胀开再消失
        dummy.position.set(slot.x, slot.y, slot.z);
        dummy.rotation.set(0, -slot.yaw, 0);
        dummy.scale.setScalar(gone > 0 ? (1 + gone * 0.9) * (gone < 1 ? 1 : 0) : 1 + Math.sin(time * 3 + i) * 0.05);
      } else {
        dummy.position.set(slot.x, slot.y + Math.sin(time * 2.4 + i) * 0.12 + gone * 0.9, slot.z);
        dummy.rotation.set(0, time * 2.2 + i * 0.7, 0);
        dummy.scale.setScalar(ITEM_SIZE[fish[i].kind] * (1 - gone));
      }
      dummy.updateMatrix();
      slot.mesh.setMatrixAt(slot.id, dummy.matrix);
      touched.add(slot.mesh);
    }
    touched.forEach((mesh) => {
      mesh.instanceMatrix.needsUpdate = true;
    });
  }

  // 开关阴影：机器吃力时关掉
  setShadows(on: boolean): void {
    this.sun.castShadow = on;
  }

  // 发光的东西（窗户、路灯、霓虹、太阳）画得比白还亮多少倍。开着泛光时调高，亮的地方才会晕出一圈光；
  // 没开泛光就是 1，否则只会白成一片
  setGlow(boost: number): void {
    this.glow.color.setScalar(boost);
    this.skyUniforms.uSunBoost.value = boost;
  }

  // 画布有多高（像素）。飘着的那些点要靠它算出该画多大
  setViewport(height: number): void {
    this.airUniforms.uHeight.value = height;
  }

  // 一群鸟：matrices 是每一群的中心（清单里摆出来的位置和大小），每群里几只、各自在队形里的哪个位置在这里定
  private addFlock(chunk: THREE.Group, index: number, kind: FlockKind, matrices: THREE.Matrix4[]): void {
    const spec = FLOCKS[kind];
    let shape = this.birdShapes.get(kind);
    if (!shape) {
      shape = buildBird(kind);
      this.birdShapes.set(kind, shape);
      this.disposables.push(shape.body, shape.wing);
    }
    const birds: Bird[] = [];
    matrices.forEach((base, f) => {
      base.decompose(dummy.position, dummy.quaternion, dummy.scale);
      const count = spec.count[0] + Math.floor(grit(f, index, 3) * (spec.count[1] - spec.count[0] + 1));
      for (let k = 0; k < count; k += 1) {
        // 人字形：领头的在最前面，后面的一左一右往后排
        const rank = Math.ceil(k / 2);
        birds.push({
          x: dummy.position.x,
          y: dummy.position.y + (grit(f, k, 9) - 0.5) * spec.gap * 0.5,
          z: dummy.position.z,
          size: dummy.scale.x * (0.85 + grit(f, k, 5) * 0.3),
          phase: f * 2.4 + index,
          back: rank * spec.gap,
          side: (k % 2 ? 1 : -1) * rank * spec.gap * 0.7,
          beat: k * 1.3 + f,
        });
      }
    });
    if (birds.length === 0) return;
    const bodies = new THREE.InstancedMesh(shape.body, this.lit, birds.length);
    const wings = new THREE.InstancedMesh(shape.wing, this.lit, birds.length * 2);
    bodies.frustumCulled = false;
    wings.frustumCulled = false;
    chunk.add(bodies, wings);
    this.flocks.push({ chunk: index, spec, bodies, wings, birds });
  }

  // 让鸟飞起来：整群沿着一条 8 字形（老鹰是圆圈）的路线飞，后面的鸟走的是领头的刚走过的路；
  // 朝着飞的方向，转弯时往里侧身；翅膀扇一阵、平伸着滑一阵
  private flyFlocks(time: number): void {
    dummy.rotation.order = 'YXZ';
    for (const flock of this.flocks) {
      if (!this.chunks[flock.chunk].visible) continue;
      const { spec } = flock;
      const R = spec.radius;
      const heading = (theta: number) => (spec.circle ? Math.atan2(R * Math.sin(theta), -R * Math.cos(theta)) : Math.atan2(-R * Math.cos(theta), -R * Math.cos(2 * theta)));
      flock.birds.forEach((bird, i) => {
        const theta = (time * spec.speed) / R + bird.phase - bird.back / R;
        const dx = spec.circle ? -R * Math.sin(theta) : R * Math.cos(theta);
        const dz = spec.circle ? R * Math.cos(theta) : R * Math.cos(2 * theta);
        const run = Math.max(0.001, Math.hypot(dx, dz));
        const yaw = heading(theta);
        let turn = heading(theta + 0.06) - yaw;
        if (turn > Math.PI) turn -= Math.PI * 2;
        if (turn < -Math.PI) turn += Math.PI * 2;
        const climb = spec.wave * 0.7 * Math.cos(0.7 * theta);
        // 往右手边错开多少：队形里的位置
        dummy.position.set(
          bird.x + (spec.circle ? R * Math.cos(theta) : R * Math.sin(theta)) - (dz / run) * bird.side,
          bird.y + spec.wave * Math.sin(0.7 * theta),
          bird.z + (spec.circle ? R * Math.sin(theta) : R * Math.sin(theta) * Math.cos(theta)) + (dx / run) * bird.side,
        );
        dummy.rotation.set(Math.atan2(climb, run), yaw, Math.max(-0.6, Math.min(0.6, (turn / 0.06) * 0.35)));
        dummy.scale.setScalar(bird.size);
        dummy.updateMatrix();
        flock.bodies.setMatrixAt(i, dummy.matrix);
        // 每四秒多一轮：前一段平伸着滑翔，后一段扇翅膀
        const round = (((time * 0.23 + bird.beat * 0.29) % 1) + 1) % 1;
        const power = spec.glide <= 0 ? 1 : smooth((round - spec.glide) / 0.08) * (1 - smooth((round - 0.92) / 0.08));
        const lift = 0.12 + power * 0.75 * Math.sin(time * spec.flap + bird.beat);
        spinMatrix.copy(dummy.matrix).multiply(turnMatrix.makeTranslation(0.1, 0.04, 0)).multiply(turnMatrix.makeRotationZ(lift));
        flock.wings.setMatrixAt(i * 2, spinMatrix);
        spinMatrix.copy(dummy.matrix).multiply(turnMatrix.makeTranslation(-0.1, 0.04, 0)).multiply(turnMatrix.makeRotationZ(-lift)).multiply(turnMatrix.makeScale(-1, 1, 1));
        flock.wings.setMatrixAt(i * 2 + 1, spinMatrix);
      });
      flock.bodies.instanceMatrix.needsUpdate = true;
      flock.wings.instanceMatrix.needsUpdate = true;
    }
    dummy.rotation.order = 'XYZ';
  }

  // 让背景动起来：云慢慢飘，鸟绕着圈飞，热气球、船和浮标上下浮。只算看得见的那几块
  private moveProps(time: number): void {
    for (const mover of this.movers) {
      if (!this.chunks[mover.chunk].visible) continue;
      mover.bases.forEach((base, i) => {
        const phase = i * 2.4 + mover.chunk;
        if (mover.type === 'sail') {
          // 云顺着风一直往一个方向飘。飘到头不能凭空跳回去，所以两头各有一段是慢慢缩小、慢慢长大的
          const along = (((time * mover.amount + phase * 41) % SAIL_RANGE) + SAIL_RANGE) % SAIL_RANGE;
          const grow = smooth(Math.min(along, SAIL_RANGE - along) / 36);
          turnMatrix.makeTranslation(along - SAIL_RANGE / 2, 0, (along - SAIL_RANGE / 2) * 0.22);
          spinMatrix.multiplyMatrices(turnMatrix, base);
          turnMatrix.makeScale(grow, grow, grow);
          spinMatrix.multiply(turnMatrix);
        } else if (mover.type === 'drift') {
          turnMatrix.makeTranslation(Math.sin(time * 0.045 + phase) * mover.amount, 0, Math.cos(time * 0.03 + phase) * mover.amount * 0.4);
          spinMatrix.multiplyMatrices(turnMatrix, base);
        } else if (mover.type === 'bob') {
          turnMatrix.makeTranslation(0, Math.sin(time * 0.7 + phase) * mover.amount, 0);
          spinMatrix.multiplyMatrices(turnMatrix, base);
        } else {
          // 跳鱼：隔几秒从水里跃出来，划一道弧线再扎回去，其余时间缩得看不见。鱼头朝 +x，顺着弧线抬头、低头
          const every = 3 + (i % 5) * 0.8;
          const u = (((time + phase * 1.7) % every) + every) % every / 1.1;
          if (u >= 1) {
            spinMatrix.makeScale(0, 0, 0);
          } else {
            turnMatrix.makeTranslation(0, mover.amount * 4 * u * (1 - u) - 0.35, 0);
            spinMatrix.multiplyMatrices(turnMatrix, base);
            spinMatrix.multiply(turnMatrix.makeTranslation((u - 0.5) * mover.amount * 1.8, 0, 0));
            spinMatrix.multiply(turnMatrix.makeRotationZ((1 - 2 * u) * 1.15));
          }
        }
        for (const mesh of mover.meshes) mesh.setMatrixAt(i, spinMatrix);
      });
      for (const mesh of mover.meshes) mesh.instanceMatrix.needsUpdate = true;
    }
  }

  // 转动的景物：只算看得见的那几块
  private turnSpinners(time: number): void {
    for (const spinner of this.spinners) {
      if (!this.chunks[spinner.chunk].visible) continue;
      spinner.bases.forEach((base, i) => {
        const angle = time * spinner.speed + i * 1.7;
        // 瀑布的水纹不是转，是一直往下滑，滑满一个周期跳回原位
        if (spinner.axis === 'fall') turnMatrix.makeTranslation(0, -(angle % spinner.period), 0);
        else if (spinner.axis === 'y') turnMatrix.makeRotationY(angle);
        else turnMatrix.makeRotationZ(angle);
        spinMatrix.multiplyMatrices(base, spinner.pivot).multiply(turnMatrix);
        spinner.mesh.setMatrixAt(i, spinMatrix);
      });
      spinner.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  // 每帧调用：s 是车沿路的位置，eye 是镜头的位置，focus 是车在世界里的位置，time 是累计时间（秒）
  update(s: number, eye: THREE.Vector3, focus: THREE.Vector3, time: number): void {
    const track = this.course.track;
    const current = track.sceneAt(s);
    this.chunks.forEach((chunk, index) => {
      chunk.visible = index >= current - BEHIND && index <= current + AHEAD;
    });
    this.paintFish(s - 30, s + 320, time);
    this.turnSpinners(this.still ? 0 : time);
    this.flyFlocks(this.still ? 0 : time);
    if (!this.still) {
      this.moveProps(time);
      this.swayTime.value = time;
      // 星空极慢地转
      this.stars.rotation.y = time * 0.004;
    }
    this.tumble(time);

    // 天空、雾、灯光：过了门才开始换
    const { a, b, w } = this.blend(s, 0, ARRIVE);
    mix(a.sky[0], b.sky[0], w, this.skyUniforms.uTop.value);
    mix(a.sky[1], b.sky[1], w, this.skyUniforms.uMid.value);
    mix(a.sky[2], b.sky[2], w, this.skyUniforms.uLow.value);
    mix(a.sun.color, b.sun.color, w, this.skyUniforms.uSun.value);
    this.skyUniforms.uSunSize.value = lerp(a.sun.size, b.sun.size, w);
    this.skyUniforms.uAurora.value = lerp(a.aurora ?? 0, b.aurora ?? 0, w);
    this.skyUniforms.uTime.value = this.still ? 0 : time;
    const height = (lerp(a.sun.height, b.sun.height, w) * Math.PI) / 180;
    const turn = (lerp(a.sun.turn, b.sun.turn, w) * Math.PI) / 180;
    const direction = this.skyUniforms.uSunDir.value as THREE.Vector3;
    direction.set(Math.sin(turn) * Math.cos(height), Math.sin(height), -Math.cos(turn) * Math.cos(height));

    mix(a.sky[2], b.sky[2], w, this.fog.color);
    this.fog.near = lerp(a.fog[0], b.fog[0], w);
    this.fog.far = lerp(a.fog[1], b.fog[1], w);

    mix(a.light.sun, b.light.sun, w, this.sun.color);
    this.sun.intensity = lerp(a.light.sunPower, b.light.sunPower, w);
    mix(a.light.sky, b.light.sky, w, this.hemi.color);
    mix(a.light.ground, b.light.ground, w, this.hemi.groundColor);
    this.hemi.intensity = lerp(a.light.power, b.light.power, w);
    // 太阳很低的时候光线几乎贴着地面，朝上的面会全黑，所以打光的方向至少抬到 38 度
    const lift = Math.max(height, 0.66);
    // 阴影那一块的中心按 8 米一格挪：每帧跟着车挪的话，阴影的边会一直抖
    const cx = Math.round(focus.x / 8) * 8;
    const cy = Math.round(focus.y / 8) * 8;
    const cz = Math.round(focus.z / 8) * 8;
    this.sun.position.set(cx + Math.sin(turn) * Math.cos(lift) * 200, cy + Math.sin(lift) * 200, cz - Math.cos(turn) * Math.cos(lift) * 200);
    this.sun.target.position.set(cx, cy, cz);

    const water = this.plane.material as THREE.MeshPhongMaterial;
    mix(a.far, b.far, w, water.color);
    // 两边的地面窄，外面就是水；是陆地的场景不要高光
    const wet = lerp(a.land < 60 ? 1 : 0, b.land < 60 ? 1 : 0, w);
    water.specular.copy(this.sun.color).multiplyScalar(wet * 0.55);
    this.plane.position.set(eye.x, SEA, eye.z);

    (this.stars.material as THREE.PointsMaterial).opacity = lerp(a.stars, b.stars, w);
    this.stars.visible = a.stars + b.stars > 0;
    this.stars.position.copy(eye);
    this.sky.position.copy(eye);

    // 飘着的东西：前一个场景的先淡掉，换成后一个场景的再淡进来
    const air = (w < 0.5 ? a : b).air;
    this.air.visible = !!air;
    if (air) {
      this.airUniforms.uTime.value = this.still ? 0 : time;
      (this.airUniforms.uEye.value as THREE.Vector3).copy(eye);
      (this.airUniforms.uMove.value as THREE.Vector3).set(air.drift, -air.fall, air.drift * 0.35);
      this.airUniforms.uSway.value = air.sway;
      this.airUniforms.uSize.value = air.size;
      this.airUniforms.uAmount.value = air.amount;
      (this.airUniforms.uColor.value as THREE.Color).setHex(air.color);
      this.airUniforms.uOpacity.value = a === b ? 1 : Math.abs(1 - 2 * w);
    }

    let beamWeight = 0;
    this.beams.forEach((item) => {
      const weight = (a === item.scene ? 1 - w : 0) + (b === item.scene ? w : 0);
      item.mesh.visible = weight > 0.001;
      beamWeight = Math.max(beamWeight, weight);
    });
    this.beam.opacity = beamWeight;

    this.backdrops.forEach((mesh, kind) => {
      const weight = (a.backdrop === kind ? 1 - w : 0) + (b.backdrop === kind ? w : 0);
      mesh.visible = weight > 0.001;
      if (!mesh.visible) return;
      const material = mesh.material as THREE.MeshBasicMaterial;
      material.opacity = weight;
      // 远山往地平线的颜色里融一点，才像隔着空气
      mix(a.backdropColor, b.backdropColor, w, material.color).lerp(mix(a.sky[2], b.sky[2], w, colorA), 0.3);
      mesh.position.set(eye.x, 0, eye.z);
    });
  }

  dispose(): void {
    this.disposables.forEach((item) => item.dispose());
    this.sky.geometry.dispose();
    (this.sky.material as THREE.Material).dispose();
    this.stars.geometry.dispose();
    (this.stars.material as THREE.Material).dispose();
    this.air.geometry.dispose();
    (this.air.material as THREE.Material).dispose();
    this.plane.geometry.dispose();
    (this.plane.material as THREE.Material).dispose();
    this.backdrops.forEach((mesh) => {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    });
    this.chunks.forEach((chunk) =>
      chunk.traverse((node) => {
        if ((node as THREE.InstancedMesh).isInstancedMesh) (node as THREE.InstancedMesh).dispose();
      }),
    );
  }
}
