// 骑车的角色和自行车的样子。全是简单几何体拼的：会蹬车，头比车晚一拍跟着倾，腾空时张开翅膀，喉囊越吃越鼓。
// 开局可以选角色（2026-11-13 用户要的）：三种真实存在的鹈鹕（白鹈鹕、褐鹈鹕、粉背鹈鹕），加一只企鹅、一只白熊。
// 车、蹬车、扶车把、腾空张开这些动作所有角色共用，只是身子、头和「翅膀」（企鹅是鳍、白熊是胳膊）长得不一样

import * as THREE from 'three';
import type { Bike } from './bike';
import { join, part } from './props';

const WHEEL = 0.36;
// 脚踏的圆周半径，和曲柄每转一圈车走多远
const CRANK = 0.15;
const GEAR = 2.4;

const DARK = 0x2b2d33;
const FRAME = 0xc6462f;
const STEEL = 0xb9bcc6;
// 贴地时翅膀扶车把的姿势：往前转多少、往下垂多少（弧度）
const HOLD = { forward: 1.42, down: -0.5 };
// 身子前后摆的弹簧有多硬、阻尼多大：阻尼比约 0.6，摆过头一点再回来
const BODY_STIFF = 60;
const BODY_DAMP = 9;

export type CharacterKind = 'white' | 'brown' | 'pink' | 'penguin' | 'bear';

// 鹈鹕的配色：身子、身子暗面、翅尖飞羽、脖子、头、后脑那撮毛、上喙、下喙、喙尖的钩、上喙正中那道棱、喉囊、眼周那圈皮、腿
interface PelicanLook {
  body: number;
  shade: number;
  tip: number;
  neck: number;
  head: number;
  crest: number;
  bill: number;
  billLow: number;
  hook: number;
  ridge: number;
  pouch: number;
  eyeRing: number;
  leg: number;
}

const PELICANS: Record<'white' | 'brown' | 'pink', PelicanLook> = {
  // 白鹈鹕：一身白，橙色的嘴和喉囊，黑翅尖
  white: { body: 0xfbfaf6, shade: 0xe4e1d8, tip: 0x3d3f49, neck: 0xfbfaf6, head: 0xfbfaf6, crest: 0xe4e1d8, bill: 0xf2a23a, billLow: 0xe38f2c, hook: 0xd9772f, ridge: 0xf8c766, pouch: 0xf8c766, eyeRing: 0xf8c766, leg: 0xf2a23a },
  // 褐鹈鹕：灰褐色的身子，栗色的长脖子，淡黄的头，灰嘴，喉囊是深色的，腿脚发黑
  brown: { body: 0x8a8478, shade: 0x6e6a62, tip: 0x34322e, neck: 0x6a3f2c, head: 0xf2e2a8, crest: 0xe6cf86, bill: 0x9c8e7e, billLow: 0x857868, hook: 0xc0603a, ridge: 0xd8b07a, pouch: 0x3e3a36, eyeRing: 0xf0c4b4, leg: 0x4a4a48 },
  // 粉背鹈鹕：灰白里透一点粉，背上和翅膀根是粉的，黄嘴、粉喉囊、粉橙色的脚
  pink: { body: 0xf3e7e4, shade: 0xecc4c4, tip: 0x5a5a62, neck: 0xf1e8e6, head: 0xf1e8e6, crest: 0xd9c9c9, bill: 0xf2c870, billLow: 0xf0a89e, hook: 0xe0806a, ridge: 0xf8e0a0, pouch: 0xf6b4a4, eyeRing: 0xf8b8a8, leg: 0xf2a88a },
};

// 开局可选的角色，按这个顺序排
// 开局可选的角色，按这个顺序排。swatch 是选角色卡片上那排小色块（这个角色身上的几种颜色）
export const CHARACTERS: ReadonlyArray<{ kind: CharacterKind; name: string; swatch: readonly number[] }> = [
  { kind: 'white', name: '白鹈鹕', swatch: [0xfbfaf6, 0xf2a23a, 0x3d3f49] },
  { kind: 'brown', name: '褐鹈鹕', swatch: [0x8a8478, 0x6a3f2c, 0xf2e2a8] },
  { kind: 'pink', name: '粉背鹈鹕', swatch: [0xf3e7e4, 0xecc4c4, 0xf2c870] },
  { kind: 'penguin', name: '企鹅', swatch: [0x23262e, 0xf7f6f2, 0xf2a23a] },
  { kind: 'bear', name: '白熊', swatch: [0xf6f3ea, 0xe6e1d4, 0x2b2d33] },
];

type Vec = [number, number, number];

const up = new THREE.Vector3(0, 1, 0);
const from = new THREE.Vector3();
const to = new THREE.Vector3();
const span = new THREE.Vector3();
const matrix = new THREE.Matrix4();
const quaternion = new THREE.Quaternion();
const one = new THREE.Vector3(1, 1, 1);

// 两点之间的一根圆杆
function rod(a: Vec, b: Vec, radius: number, hex: number, sides = 6): THREE.BufferGeometry {
  from.set(...a);
  to.set(...b);
  span.subVectors(to, from);
  const geometry = new THREE.CylinderGeometry(radius, radius, span.length(), sides);
  quaternion.setFromUnitVectors(up, span.clone().normalize());
  matrix.compose(from.clone().add(to).multiplyScalar(0.5), quaternion, one);
  geometry.applyMatrix4(matrix);
  return part(geometry, hex);
}

// 把一根竖着的单位圆杆摆到两点之间（腿每帧都要重摆）
function stretch(mesh: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3): void {
  span.subVectors(b, a);
  const length = span.length();
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(up, span.normalize());
  mesh.scale.set(1, length, 1);
}

function buildWheel(): THREE.BufferGeometry {
  const tyre = new THREE.TorusGeometry(WHEEL - 0.04, 0.045, 6, 18);
  tyre.rotateY(Math.PI / 2);
  const parts = [part(tyre, DARK), rod([-0.05, 0, 0], [0.05, 0, 0], 0.05, STEEL)];
  for (let k = 0; k < 3; k += 1) {
    const angle = (k / 3) * Math.PI;
    const y = Math.cos(angle) * (WHEEL - 0.06);
    const z = Math.sin(angle) * (WHEEL - 0.06);
    parts.push(rod([0, -y, -z], [0, y, z], 0.012, STEEL, 4));
  }
  return join(parts);
}

const ball = (radius: number, detail = 1) => new THREE.IcosahedronGeometry(radius, detail);

// 一个角色身上和车无关的那几块：身子、翅膀（或鳍、胳膊）、脖子和头、嘴、喉囊、腿和脚的颜色
interface Figure {
  body: THREE.BufferGeometry;
  wing: THREE.BufferGeometry;
  head: THREE.BufferGeometry;
  // 鹈鹕才有的长嘴和喉囊，别的角色没有
  bill: THREE.BufferGeometry | null;
  pouch: number | null;
  leg: number;
  foot: THREE.BufferGeometry;
}

function pelicanFigure(look: PelicanLook): Figure {
  const tail = (side: number) =>
    part(new THREE.ConeGeometry(0.1, 0.36, 4), side === 0 ? look.shade : look.tip, { p: [side * 0.1, 0.33, 0.58], r: [-1.3, side * -0.4, 0], s: [1.5, 1, 0.3] });
  // 鹈鹕是个圆滚滚的大个子：胸脯往前挺，屁股往后收成一把短尾巴
  const body = join([
    part(ball(0.42, 2), look.body, { p: [0, 0.34, -0.02], r: [-0.32, 0, 0], s: [0.92, 0.84, 1.2] }),
    part(ball(0.3), look.body, { p: [0, 0.38, -0.33], s: [0.96, 1, 0.9] }),
    // 大腿根：腿从这两团毛里伸出来，不是直接插在身子上
    part(ball(0.15), look.shade, { p: [-0.15, 0.13, -0.03], s: [0.8, 1.1, 1] }),
    part(ball(0.15), look.shade, { p: [0.15, 0.13, -0.03], s: [0.8, 1.1, 1] }),
    tail(-1),
    tail(0),
    tail(1),
    // 脖子根上围一条红围巾
    part(new THREE.CylinderGeometry(0.17, 0.2, 0.11, 8), FRAME, { p: [0, 0.64, -0.3], r: [-0.3, 0, 0] }),
  ]);
  // 翅膀：三截，肩上身子的颜色、中间暗一点、翅尖是黑色的飞羽
  const wing = join([
    part(ball(0.3), look.body, { p: [0.24, 0, 0.02], s: [1, 0.24, 0.66] }),
    part(ball(0.24), look.shade, { p: [0.44, -0.01, 0.07], s: [1, 0.2, 0.6] }),
    part(ball(0.2, 0), look.tip, { p: [0.62, -0.01, 0.1], s: [1.05, 0.16, 0.5] }),
  ]);
  // 脖子是一道 S 形的弯
  const bend = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, -0.06, 0.02),
    new THREE.Vector3(0, 0.18, 0.13),
    new THREE.Vector3(0, 0.42, 0.1),
    new THREE.Vector3(0, 0.62, -0.05),
  ]);
  const head = join([
    part(new THREE.TubeGeometry(bend, 8, 0.105, 7), look.neck),
    part(ball(0.2), look.head, { p: [0, 0.7, -0.12], s: [0.96, 0.95, 1.14] }),
    // 眼睛周围一圈没毛的皮，中间一粒黑眼珠
    part(ball(0.06), look.eyeRing, { p: [0.15, 0.75, -0.2], s: [0.45, 1, 1.15] }),
    part(ball(0.06), look.eyeRing, { p: [-0.15, 0.75, -0.2], s: [0.45, 1, 1.15] }),
    part(ball(0.03, 0), DARK, { p: [0.172, 0.755, -0.21] }),
    part(ball(0.03, 0), DARK, { p: [-0.172, 0.755, -0.21] }),
    // 后脑勺翘起来的两撮毛
    part(new THREE.ConeGeometry(0.05, 0.22, 4), look.head, { p: [0, 0.86, 0.02], r: [0.9, 0, 0] }),
    part(new THREE.ConeGeometry(0.04, 0.17, 4), look.crest, { p: [0, 0.79, 0.08], r: [1.25, 0, 0] }),
  ]);
  const slab = (top: number, bottom: number, length: number) => {
    const geometry = new THREE.CylinderGeometry(top, bottom, length, 4);
    // 转 45 度，四棱柱才是平的一面朝上
    geometry.rotateY(Math.PI / 4);
    return geometry;
  };
  // 嘴：又长又宽又扁，往前下方伸着，尖上一个小钩
  const bill = join([
    part(slab(0.03, 0.1, 0.84), look.bill, { p: [0, 0.02, -0.42], r: [-Math.PI / 2, 0, 0], s: [1.25, 1, 0.42] }),
    part(new THREE.BoxGeometry(0.035, 0.02, 0.74), look.ridge, { p: [0, 0.062, -0.4], r: [0.045, 0, 0] }),
    part(slab(0.02, 0.075, 0.8), look.billLow, { p: [0, -0.035, -0.4], r: [-Math.PI / 2, 0, 0], s: [1.2, 1, 0.26] }),
    part(new THREE.ConeGeometry(0.035, 0.1, 4), look.hook, { p: [0, -0.01, -0.85], r: [Math.PI, 0, 0] }),
  ]);
  return { body, wing, head, bill, pouch: look.pouch, leg: look.leg, foot: webFoot(look.leg) };
}

// 带蹼的脚：一片前宽后窄的三角，底下一块脚踏
function webFoot(hex: number): THREE.BufferGeometry {
  const web = new THREE.CylinderGeometry(0.035, 0.12, 0.26, 3);
  web.rotateY(Math.PI);
  return join([part(web, hex, { p: [0, 0.035, -0.05], r: [-Math.PI / 2, 0, 0], s: [1, 1, 0.22] }), part(new THREE.BoxGeometry(0.1, 0.025, 0.12), DARK)]);
}

// 企鹅：黑背白肚皮，圆脑袋直接顶在身子上，脖子上一圈淡黄，短短的黑嘴，两片鳍搭在车把上，橙色的脚
function penguinFigure(): Figure {
  const black = 0x23262e;
  const white = 0xf7f6f2;
  const body = join([
    part(ball(0.42, 2), black, { p: [0, 0.36, 0.02], r: [-0.2, 0, 0], s: [0.9, 1.05, 1.02] }),
    // 白肚皮：往前凸出来一块
    part(ball(0.36, 2), white, { p: [0, 0.32, -0.12], r: [-0.2, 0, 0], s: [0.86, 1.05, 0.8] }),
    part(ball(0.14), black, { p: [-0.15, 0.1, -0.03], s: [0.8, 1, 1] }),
    part(ball(0.14), black, { p: [0.15, 0.1, -0.03], s: [0.8, 1, 1] }),
    part(new THREE.ConeGeometry(0.1, 0.26, 4), black, { p: [0, 0.12, 0.42], r: [-1.6, 0, 0], s: [1.3, 1, 0.3] }),
    part(new THREE.CylinderGeometry(0.2, 0.24, 0.1, 8), FRAME, { p: [0, 0.7, -0.18], r: [-0.2, 0, 0] }),
  ]);
  // 鳍：一片扁扁的黑板子，底面是白的
  const wing = join([
    part(ball(0.28), black, { p: [0.26, 0, 0.02], s: [1.25, 0.16, 0.5] }),
    part(ball(0.24), white, { p: [0.26, -0.03, 0.02], s: [1.2, 0.1, 0.42] }),
  ]);
  const head = join([
    part(ball(0.25, 2), black, { p: [0, 0.18, -0.06] }),
    // 脸两侧的白斑、脖子前面一圈淡黄
    part(ball(0.12), white, { p: [0.12, 0.2, -0.2], s: [0.5, 0.9, 0.6] }),
    part(ball(0.12), white, { p: [-0.12, 0.2, -0.2], s: [0.5, 0.9, 0.6] }),
    part(ball(0.14), 0xf6d77a, { p: [0, 0.04, -0.17], s: [1.1, 0.6, 0.6] }),
    part(ball(0.035, 0), DARK, { p: [0.12, 0.25, -0.26] }),
    part(ball(0.035, 0), DARK, { p: [-0.12, 0.25, -0.26] }),
    // 嘴：一小截往前伸的黑尖，嘴角一抹橙
    part(new THREE.ConeGeometry(0.06, 0.24, 5), black, { p: [0, 0.15, -0.38], r: [-Math.PI / 2, 0, 0], s: [1, 1, 0.7] }),
    part(new THREE.BoxGeometry(0.1, 0.03, 0.08), 0xf2a23a, { p: [0, 0.12, -0.3] }),
  ]);
  return { body, wing, head, bill: null, pouch: null, leg: 0xf2a23a, foot: webFoot(0xf2a23a) };
}

// 白熊：圆滚滚的白身子，圆脑袋上两只小耳朵，往前凸的口鼻，黑鼻头；两只胳膊搭在车把上，腿和脚掌也是白的
function bearFigure(): Figure {
  const fur = 0xf6f3ea;
  const shade = 0xe6e1d4;
  const body = join([
    part(ball(0.44, 2), fur, { p: [0, 0.34, 0], r: [-0.25, 0, 0], s: [1, 0.95, 1.12] }),
    part(ball(0.18), shade, { p: [-0.16, 0.12, -0.04], s: [0.9, 1.1, 1.1] }),
    part(ball(0.18), shade, { p: [0.16, 0.12, -0.04], s: [0.9, 1.1, 1.1] }),
    part(ball(0.08), fur, { p: [0, 0.22, 0.48] }),
    part(new THREE.CylinderGeometry(0.2, 0.24, 0.1, 8), FRAME, { p: [0, 0.68, -0.22], r: [-0.25, 0, 0] }),
  ]);
  // 胳膊：一根粗粗的白胳膊，头上一只带黑肉垫的熊掌
  const wing = join([
    part(ball(0.13), fur, { p: [0.08, 0, 0.02], s: [1, 1, 1] }),
    part(new THREE.CylinderGeometry(0.1, 0.12, 0.46, 7), fur, { p: [0.32, 0, 0.04], r: [0, 0, Math.PI / 2] }),
    part(ball(0.12), shade, { p: [0.58, 0, 0.05], s: [1, 0.85, 1] }),
    part(ball(0.06), DARK, { p: [0.64, -0.06, 0.05], s: [0.8, 0.5, 1] }),
  ]);
  const head = join([
    part(ball(0.27, 2), fur, { p: [0, 0.2, -0.08] }),
    part(ball(0.08), fur, { p: [0.18, 0.4, -0.02] }),
    part(ball(0.08), fur, { p: [-0.18, 0.4, -0.02] }),
    part(ball(0.045, 0), 0xc9b8a8, { p: [0.19, 0.4, -0.07] }),
    part(ball(0.045, 0), 0xc9b8a8, { p: [-0.19, 0.4, -0.07] }),
    // 口鼻往前凸出一截，尖上黑鼻头
    part(ball(0.13), shade, { p: [0, 0.14, -0.33], s: [0.9, 0.75, 1] }),
    part(ball(0.05, 0), DARK, { p: [0, 0.18, -0.45], s: [1.3, 0.9, 1] }),
    part(ball(0.032, 0), DARK, { p: [0.11, 0.28, -0.3] }),
    part(ball(0.032, 0), DARK, { p: [-0.11, 0.28, -0.3] }),
  ]);
  const foot = join([part(ball(0.09), fur, { p: [0, 0.04, -0.03], s: [0.9, 0.6, 1.4] }), part(new THREE.BoxGeometry(0.1, 0.025, 0.12), DARK)]);
  return { body, wing, head, bill: null, pouch: null, leg: fur, foot };
}

function figureOf(kind: CharacterKind): Figure {
  if (kind === 'penguin') return penguinFigure();
  if (kind === 'bear') return bearFigure();
  return pelicanFigure(PELICANS[kind]);
}

export interface Rider {
  group: THREE.Group;
  // fill 是吃到的鱼占全部的几成，决定喉囊有多鼓
  update(bike: Bike, dt: number, fill: number): void;
  // 吃到一条鱼：喉囊鼓一下（没有喉囊的角色点一下头）
  gulp(): void;
  dispose(): void;
}

export function buildRider(kind: CharacterKind = 'white'): Rider {
  const figure = figureOf(kind);
  const pelican = figure.bill !== null;
  // group 的原点是车轮着地的那一点，整车绕它倾斜；车头朝 -z
  const group = new THREE.Group();
  const lean = new THREE.Group();
  group.add(lean);
  // 左翅膀是右翅膀镜像出来的，面的朝向会反过来，所以两面都画
  const material = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const geometries: THREE.BufferGeometry[] = [];
  const mesh = (geometry: THREE.BufferGeometry) => {
    geometries.push(geometry);
    // 单独一块、没经过拼合的零件（腿、喉囊）不带法线，要自己算一遍。
    // 没有法线的面算出来的光照是无效值，平时只是颜色不对，开了泛光会被一圈圈糊开，整个画面发黑
    if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
    const made = new THREE.Mesh(geometry, material);
    made.castShadow = true;
    return made;
  };

  // 车架
  const axleBack: Vec = [0, WHEEL, 0.62];
  const axleFront: Vec = [0, WHEEL, -0.62];
  const bracket: Vec = [0, 0.4, 0.1];
  const seat: Vec = [0, 0.98, 0.34];
  const head: Vec = [0, 1.02, -0.4];
  lean.add(
    mesh(
      join([
        rod(axleBack, bracket, 0.028, FRAME),
        rod(bracket, seat, 0.032, FRAME),
        rod(seat, head, 0.032, FRAME),
        rod(bracket, [0, 0.82, -0.45], 0.032, FRAME),
        rod(axleBack, seat, 0.024, FRAME),
        rod(head, axleFront, 0.03, STEEL),
        rod(head, [0, 1.16, -0.37], 0.026, STEEL),
        rod([-0.3, 1.16, -0.37], [0.3, 1.16, -0.37], 0.024, STEEL),
        rod([-0.3, 1.16, -0.37], [-0.3, 1.16, -0.25], 0.03, DARK),
        rod([0.3, 1.16, -0.37], [0.3, 1.16, -0.25], 0.03, DARK),
        part(new THREE.BoxGeometry(0.2, 0.06, 0.32), DARK, { p: [0, 1.02, 0.36] }),
        // 车把前面挂一只小藤篮
        part(new THREE.CylinderGeometry(0.17, 0.13, 0.2, 7), 0xd9b27a, { p: [0, 1.02, -0.62] }),
      ]),
    ),
  );

  const wheelGeometry = buildWheel();
  const wheelFront = mesh(wheelGeometry);
  const wheelBack = mesh(wheelGeometry);
  wheelFront.position.set(...axleFront);
  wheelBack.position.set(...axleBack);
  lean.add(wheelFront, wheelBack);

  // 曲柄和脚踏，绕中轴转
  const crank = mesh(
    join([
      rod([-0.1, 0, 0], [0.1, 0, 0], 0.03, STEEL),
      rod([-0.1, 0, 0], [-0.1, CRANK, 0], 0.016, STEEL, 4),
      rod([0.1, 0, 0], [0.1, -CRANK, 0], 0.016, STEEL, 4),
    ]),
  );
  crank.position.set(...bracket);
  lean.add(crank);

  // 两只脚各带一块脚踏，位置每帧跟着曲柄算
  const feet = [mesh(figure.foot), mesh(figure.foot)];
  const legGeometry = part(new THREE.CylinderGeometry(kind === 'bear' ? 0.06 : 0.03, kind === 'bear' ? 0.06 : 0.03, 1, 5), figure.leg);
  const legs = [mesh(legGeometry), mesh(legGeometry), mesh(legGeometry), mesh(legGeometry)];
  lean.add(...feet, ...legs);

  // 身子：落地时整个往下压一下
  const body = new THREE.Group();
  body.position.set(0, 1.0, 0.3);
  lean.add(body);
  body.add(mesh(figure.body));

  // 围巾飘在身后的那一截，跟着速度和倾斜摆
  const scarf = mesh(part(new THREE.BoxGeometry(0.1, 0.03, 0.44), FRAME, { p: [0, 0, 0.22] }));
  scarf.position.set(0, pelican ? 0.64 : 0.7, pelican ? -0.14 : -0.04);
  body.add(scarf);

  // 翅膀（企鹅是鳍、白熊是胳膊）：平时往前伸着扶车把，腾空时张开
  const wingRight = mesh(figure.wing);
  const wingLeft = mesh(figure.wing);
  const shoulder = pelican ? 0.48 : 0.5;
  wingRight.position.set(0.27, shoulder, -0.1);
  wingLeft.position.set(-0.27, shoulder, -0.1);
  wingLeft.scale.x = -1;
  body.add(wingRight, wingLeft);

  // 脖子和头：比车晚一拍跟上倾斜，看起来才是在努力保持平衡
  const neck = new THREE.Group();
  neck.position.set(0, pelican ? 0.64 : 0.72, pelican ? -0.3 : -0.18);
  body.add(neck);
  neck.add(mesh(figure.head));

  // 嘴和喉囊只有鹈鹕有：嘴单独一组，方便整个往下低一点；喉囊挂在下喙底下，吃得越多往下坠得越鼓
  const bill = new THREE.Group();
  bill.position.set(0, 0.68, -0.28);
  bill.rotation.x = -0.3;
  neck.add(bill);
  let pouch: THREE.Mesh | null = null;
  if (figure.bill && figure.pouch !== null) {
    bill.add(mesh(figure.bill));
    pouch = mesh(part(new THREE.SphereGeometry(0.2, 8, 4, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), figure.pouch, { s: [0.5, 1, 1.75] }));
    pouch.position.set(0, -0.04, -0.37);
    bill.add(pouch);
  }

  const hip = [new THREE.Vector3(-0.13, 1.12, 0.26), new THREE.Vector3(0.13, 1.12, 0.26)];
  const pedal = new THREE.Vector3();
  const knee = new THREE.Vector3();
  let headLean = 0;
  // 身子前后摆的那根弹簧：现在偏了多少、摆得多快，平滑过的加速度和上一帧的速度
  let bodyPitch = 0;
  let bodyPitchVel = 0;
  let accel = 0;
  let lastSpeed = 0;
  let spread = 0;
  let pulse = 0;
  let clock = 0;

  return {
    group,
    update(bike, dt, fill) {
      clock += dt;
      lean.rotation.z = -bike.lean;
      wheelFront.rotation.x = -bike.spin / WHEEL;
      wheelBack.rotation.x = -bike.spin / WHEEL;

      const turn = -bike.spin / GEAR;
      crank.rotation.x = turn;
      for (let i = 0; i < 2; i += 1) {
        const side = i === 0 ? -1 : 1;
        const angle = turn + (i === 0 ? 0 : Math.PI);
        pedal.set(side * 0.13, bracket[1] + Math.cos(angle) * CRANK, bracket[2] + Math.sin(angle) * CRANK);
        feet[i].position.copy(pedal);
        // 膝盖放在胯和脚踏的中点再往前上方顶出去一点，腿就有了弯
        knee.copy(hip[i]).add(pedal).multiplyScalar(0.5);
        knee.z -= 0.2;
        knee.y += 0.05;
        knee.x += side * 0.05;
        stretch(legs[i * 2], hip[i], knee);
        stretch(legs[i * 2 + 1], knee, pedal);
      }

      body.scale.y = 1 - bike.squash * 0.2;
      // 身子挂在一根弹簧上（用户要「多一点物理」）：加速时往后仰、减速和撞东西时往前一冲，腾空时往前探一点，
      // 松开以后带着一点回弹摆回来。加速度先平滑一下，免得每一步的小抖动都传上来
      if (dt > 0) {
        accel += ((bike.v - lastSpeed) / dt - accel) * Math.min(1, dt * 6);
        lastSpeed = bike.v;
        const target = Math.max(-0.2, Math.min(0.24, accel * 0.022)) - (bike.grounded ? 0 : 0.1);
        bodyPitchVel += (BODY_STIFF * (target - bodyPitch) - BODY_DAMP * bodyPitchVel) * dt;
        bodyPitch += bodyPitchVel * dt;
        body.rotation.x = bodyPitch;
      }
      headLean += (bike.lean - headLean) * Math.min(1, dt * 5);
      neck.rotation.z = (bike.lean - headLean) * 1.2;
      neck.rotation.y = -bike.lean * 0.5;
      // 没有喉囊的角色吃到鱼时点一下头
      neck.rotation.x = Math.sin(clock * 7) * 0.02 * Math.min(1, bike.v / 16) - (bike.rushing ? 0.22 : 0) + (pouch ? 0 : pulse * 0.25);

      // 腾空时张开翅膀扑腾；到了终点也张开，算是庆祝
      const flying = !bike.grounded || bike.finished;
      spread += ((flying ? 1 : 0) - spread) * Math.min(1, dt * 9);
      // 掉进深沟往上飞的时候扑得又大又急
      const flap = bike.rescue > 0 ? Math.sin(clock * 22) * 0.55 : flying ? Math.sin(clock * (bike.finished ? 10 : 16)) * (bike.finished ? 0.3 : 0.16) : 0;
      // 贴地时两只翅膀往前下方伸，翅尖搭在车把上；腾空就往两边张开
      const reach = HOLD.forward * (1 - spread);
      const droop = HOLD.down * (1 - spread) + 0.2 * spread + flap;
      wingRight.rotation.set(0, reach, droop);
      wingLeft.rotation.set(0, -reach, -droop);

      scarf.rotation.y = bike.lean * 1.4 + Math.sin(clock * 9) * 0.18 * Math.min(1, bike.v / 16);
      scarf.rotation.x = 0.5 - Math.min(0.5, bike.v / 40);

      pulse += (0 - pulse) * Math.min(1, dt * 7);
      pouch?.scale.set(0.85 + fill * 0.75 + pulse * 0.35, 0.5 + fill * 1.3 + pulse * 0.6, 1);
    },
    gulp() {
      pulse = 1;
    },
    dispose() {
      geometries.forEach((geometry) => geometry.dispose());
      material.dispose();
    },
  };
}
