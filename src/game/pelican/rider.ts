// 鹈鹕和自行车的样子。全是简单几何体拼的：会蹬车，头比车晚一拍跟着倾，腾空时张开翅膀，喉囊越吃越鼓

import * as THREE from 'three';
import type { Bike } from './bike';
import { join, part } from './props';

const WHEEL = 0.36;
// 脚踏的圆周半径，和曲柄每转一圈车走多远
const CRANK = 0.15;
const GEAR = 2.4;

const WHITE = 0xfbfaf6;
const SHADE = 0xe4e1d8;
const ORANGE = 0xf2a23a;
const POUCH = 0xf8c766;
const DARK = 0x2b2d33;
const FRAME = 0xc6462f;
const STEEL = 0xb9bcc6;
// 翅尖和尾巴两侧的深色飞羽
const TIP = 0x3d3f49;
// 贴地时翅膀扶车把的姿势：往前转多少、往下垂多少（弧度）
const HOLD = { forward: 1.42, down: -0.5 };

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

export interface Rider {
  group: THREE.Group;
  // fill 是吃到的鱼占全部的几成，决定喉囊有多鼓
  update(bike: Bike, dt: number, fill: number): void;
  // 吃到一条鱼：喉囊鼓一下
  gulp(): void;
  dispose(): void;
}

export function buildRider(): Rider {
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

  // 两只脚各带一块脚踏，位置每帧跟着曲柄算。脚是一片带蹼的三角，前宽后窄
  const web = new THREE.CylinderGeometry(0.035, 0.12, 0.26, 3);
  web.rotateY(Math.PI);
  const footGeometry = join([
    part(web, ORANGE, { p: [0, 0.035, -0.05], r: [-Math.PI / 2, 0, 0], s: [1, 1, 0.22] }),
    part(new THREE.BoxGeometry(0.1, 0.025, 0.12), DARK),
  ]);
  const feet = [mesh(footGeometry), mesh(footGeometry)];
  const legGeometry = part(new THREE.CylinderGeometry(0.03, 0.03, 1, 5), ORANGE);
  const legs = [mesh(legGeometry), mesh(legGeometry), mesh(legGeometry), mesh(legGeometry)];
  lean.add(...feet, ...legs);

  // 身子：落地时整个往下压一下。鹈鹕是个圆滚滚的大个子：胸脯往前挺，屁股往后收成一把短尾巴
  const body = new THREE.Group();
  body.position.set(0, 1.0, 0.3);
  lean.add(body);
  const tail = (side: number) =>
    part(new THREE.ConeGeometry(0.1, 0.36, 4), side === 0 ? SHADE : TIP, { p: [side * 0.1, 0.33, 0.58], r: [-1.3, side * -0.4, 0], s: [1.5, 1, 0.3] });
  body.add(
    mesh(
      join([
        part(new THREE.IcosahedronGeometry(0.42, 2), WHITE, { p: [0, 0.34, -0.02], r: [-0.32, 0, 0], s: [0.92, 0.84, 1.2] }),
        // 胸脯
        part(new THREE.IcosahedronGeometry(0.3, 1), WHITE, { p: [0, 0.38, -0.33], s: [0.96, 1, 0.9] }),
        // 大腿根：腿从这两团毛里伸出来，不是直接插在身子上
        part(new THREE.IcosahedronGeometry(0.15, 1), SHADE, { p: [-0.15, 0.13, -0.03], s: [0.8, 1.1, 1] }),
        part(new THREE.IcosahedronGeometry(0.15, 1), SHADE, { p: [0.15, 0.13, -0.03], s: [0.8, 1.1, 1] }),
        tail(-1),
        tail(0),
        tail(1),
        // 脖子根上围一条红围巾
        part(new THREE.CylinderGeometry(0.17, 0.2, 0.11, 8), FRAME, { p: [0, 0.64, -0.3], r: [-0.3, 0, 0] }),
      ]),
    ),
  );

  // 围巾飘在身后的那一截，跟着速度和倾斜摆
  const scarf = mesh(part(new THREE.BoxGeometry(0.1, 0.03, 0.44), FRAME, { p: [0, 0, 0.22] }));
  scarf.position.set(0, 0.64, -0.14);
  body.add(scarf);

  // 翅膀：三截，肩上白、中间浅灰、翅尖是鹈鹕那种黑色的飞羽。平时往前伸着扶车把，腾空时张开
  const wingGeometry = join([
    part(new THREE.IcosahedronGeometry(0.3, 1), WHITE, { p: [0.24, 0, 0.02], s: [1, 0.24, 0.66] }),
    part(new THREE.IcosahedronGeometry(0.24, 1), SHADE, { p: [0.44, -0.01, 0.07], s: [1, 0.2, 0.6] }),
    part(new THREE.IcosahedronGeometry(0.2, 0), TIP, { p: [0.62, -0.01, 0.1], s: [1.05, 0.16, 0.5] }),
  ]);
  const wingRight = mesh(wingGeometry);
  const wingLeft = mesh(wingGeometry);
  wingRight.position.set(0.27, 0.48, -0.1);
  wingLeft.position.set(-0.27, 0.48, -0.1);
  wingLeft.scale.x = -1;
  body.add(wingRight, wingLeft);

  // 脖子和头：比车晚一拍跟上倾斜，看起来才是在努力保持平衡。脖子是一道 S 形的弯
  const neck = new THREE.Group();
  neck.position.set(0, 0.64, -0.3);
  body.add(neck);
  const bend = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, -0.06, 0.02),
    new THREE.Vector3(0, 0.18, 0.13),
    new THREE.Vector3(0, 0.42, 0.1),
    new THREE.Vector3(0, 0.62, -0.05),
  ]);
  neck.add(
    mesh(
      join([
        part(new THREE.TubeGeometry(bend, 8, 0.105, 7), WHITE),
        part(new THREE.IcosahedronGeometry(0.2, 1), WHITE, { p: [0, 0.7, -0.12], s: [0.96, 0.95, 1.14] }),
        // 眼睛周围一圈没毛的黄皮，中间一粒黑眼珠
        part(new THREE.IcosahedronGeometry(0.06, 1), POUCH, { p: [0.15, 0.75, -0.2], s: [0.45, 1, 1.15] }),
        part(new THREE.IcosahedronGeometry(0.06, 1), POUCH, { p: [-0.15, 0.75, -0.2], s: [0.45, 1, 1.15] }),
        part(new THREE.IcosahedronGeometry(0.03, 0), DARK, { p: [0.172, 0.755, -0.21] }),
        part(new THREE.IcosahedronGeometry(0.03, 0), DARK, { p: [-0.172, 0.755, -0.21] }),
        // 后脑勺翘起来的两撮毛
        part(new THREE.ConeGeometry(0.05, 0.22, 4), WHITE, { p: [0, 0.86, 0.02], r: [0.9, 0, 0] }),
        part(new THREE.ConeGeometry(0.04, 0.17, 4), SHADE, { p: [0, 0.79, 0.08], r: [1.25, 0, 0] }),
      ]),
    ),
  );

  // 嘴：又长又宽又扁，往前下方伸着，尖上一个小钩；下面兜着喉囊。单独一组，方便整个往下低一点
  const bill = new THREE.Group();
  bill.position.set(0, 0.68, -0.28);
  bill.rotation.x = -0.3;
  neck.add(bill);
  const slab = (top: number, bottom: number, length: number) => {
    const geometry = new THREE.CylinderGeometry(top, bottom, length, 4);
    // 转 45 度，四棱柱才是平的一面朝上
    geometry.rotateY(Math.PI / 4);
    return geometry;
  };
  bill.add(
    mesh(
      join([
        part(slab(0.03, 0.1, 0.84), ORANGE, { p: [0, 0.02, -0.42], r: [-Math.PI / 2, 0, 0], s: [1.25, 1, 0.42] }),
        // 上喙正中一道浅色的棱
        part(new THREE.BoxGeometry(0.035, 0.02, 0.74), POUCH, { p: [0, 0.062, -0.4], r: [0.045, 0, 0] }),
        part(slab(0.02, 0.075, 0.8), 0xe38f2c, { p: [0, -0.035, -0.4], r: [-Math.PI / 2, 0, 0], s: [1.2, 1, 0.26] }),
        part(new THREE.ConeGeometry(0.035, 0.1, 4), 0xd9772f, { p: [0, -0.01, -0.85], r: [Math.PI, 0, 0] }),
      ]),
    ),
  );
  // 喉囊：挂在下喙底下的半个口袋，开口朝上贴着嘴，吃得越多往下坠得越鼓
  const pouch = mesh(part(new THREE.SphereGeometry(0.2, 8, 4, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), POUCH, { s: [0.5, 1, 1.75] }));
  pouch.position.set(0, -0.04, -0.37);
  bill.add(pouch);

  const hip = [new THREE.Vector3(-0.13, 1.12, 0.26), new THREE.Vector3(0.13, 1.12, 0.26)];
  const pedal = new THREE.Vector3();
  const knee = new THREE.Vector3();
  let headLean = 0;
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
      headLean += (bike.lean - headLean) * Math.min(1, dt * 5);
      neck.rotation.z = (bike.lean - headLean) * 1.2;
      neck.rotation.y = -bike.lean * 0.5;
      neck.rotation.x = Math.sin(clock * 7) * 0.02 * Math.min(1, bike.v / 16) - (bike.rushing ? 0.22 : 0);

      // 腾空时张开翅膀扑腾；到了终点也张开，算是庆祝
      const flying = !bike.grounded || bike.finished;
      spread += ((flying ? 1 : 0) - spread) * Math.min(1, dt * 9);
      const flap = flying ? Math.sin(clock * (bike.finished ? 10 : 16)) * (bike.finished ? 0.3 : 0.16) : 0;
      // 贴地时两只翅膀往前下方伸，翅尖搭在车把上；腾空就往两边张开
      const reach = HOLD.forward * (1 - spread);
      const droop = HOLD.down * (1 - spread) + 0.2 * spread + flap;
      wingRight.rotation.set(0, reach, droop);
      wingLeft.rotation.set(0, -reach, -droop);

      scarf.rotation.y = bike.lean * 1.4 + Math.sin(clock * 9) * 0.18 * Math.min(1, bike.v / 16);
      scarf.rotation.x = 0.5 - Math.min(0.5, bike.v / 40);

      pulse += (0 - pulse) * Math.min(1, dt * 7);
      pouch.scale.set(0.85 + fill * 0.75 + pulse * 0.35, 0.5 + fill * 1.3 + pulse * 0.6, 1);
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
