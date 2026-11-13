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

  // 两只脚各带一块脚踏，位置每帧跟着曲柄算
  const footGeometry = join([
    part(new THREE.BoxGeometry(0.11, 0.03, 0.2), ORANGE, { p: [0, 0.03, -0.03] }),
    part(new THREE.BoxGeometry(0.1, 0.025, 0.12), DARK),
  ]);
  const feet = [mesh(footGeometry), mesh(footGeometry)];
  const legGeometry = part(new THREE.CylinderGeometry(0.028, 0.028, 1, 5), ORANGE);
  const legs = [mesh(legGeometry), mesh(legGeometry), mesh(legGeometry), mesh(legGeometry)];
  lean.add(...feet, ...legs);

  // 身子：落地时整个往下压一下
  const body = new THREE.Group();
  body.position.set(0, 1.0, 0.3);
  lean.add(body);
  body.add(
    mesh(
      join([
        part(new THREE.IcosahedronGeometry(0.4, 1), WHITE, { p: [0, 0.34, -0.04], r: [-0.3, 0, 0], s: [0.84, 0.86, 1.22] }),
        part(new THREE.ConeGeometry(0.17, 0.42, 5), SHADE, { p: [0, 0.3, 0.52], r: [-1.25, 0, 0], s: [1, 1, 0.45] }),
        // 脖子根上围一条红围巾
        part(new THREE.CylinderGeometry(0.15, 0.17, 0.1, 8), FRAME, { p: [0, 0.62, -0.3], r: [-0.35, 0, 0] }),
      ]),
    ),
  );

  // 围巾飘在身后的那一截，跟着速度和倾斜摆
  const scarf = mesh(part(new THREE.BoxGeometry(0.1, 0.03, 0.44), FRAME, { p: [0, 0, 0.22] }));
  scarf.position.set(0, 0.62, -0.16);
  body.add(scarf);

  // 翅膀：平时收在身侧，腾空时张开
  const wingGeometry = join([
    part(new THREE.IcosahedronGeometry(0.3, 1), WHITE, { p: [0.26, 0, 0.02], s: [1, 0.2, 0.62] }),
    part(new THREE.IcosahedronGeometry(0.2, 0), 0x8d8f9c, { p: [0.56, 0, 0.06], s: [1, 0.18, 0.6] }),
  ]);
  const wingRight = mesh(wingGeometry);
  const wingLeft = mesh(wingGeometry);
  wingRight.position.set(0.24, 0.42, -0.04);
  wingLeft.position.set(-0.24, 0.42, -0.04);
  wingLeft.scale.x = -1;
  body.add(wingRight, wingLeft);

  // 脖子和头：比车晚一拍跟上倾斜，看起来才是在努力保持平衡
  const neck = new THREE.Group();
  neck.position.set(0, 0.64, -0.3);
  body.add(neck);
  neck.add(
    mesh(
      join([
        rod([0, 0, 0], [0, 0.34, 0.06], 0.09, WHITE, 7),
        rod([0, 0.34, 0.06], [0, 0.56, -0.08], 0.085, WHITE, 7),
        part(new THREE.IcosahedronGeometry(0.17, 1), WHITE, { p: [0, 0.62, -0.16], s: [0.95, 0.95, 1.1] }),
        // 上喙：又长又扁，尖上一个小钩
        part(new THREE.ConeGeometry(0.075, 0.74, 5), ORANGE, { p: [0, 0.62, -0.66], r: [-Math.PI / 2, 0, 0], s: [1.25, 1, 0.5] }),
        part(new THREE.ConeGeometry(0.03, 0.09, 4), 0xd9772f, { p: [0, 0.59, -1.04], r: [Math.PI, 0, 0] }),
        part(new THREE.IcosahedronGeometry(0.028, 0), DARK, { p: [0.12, 0.69, -0.26] }),
        part(new THREE.IcosahedronGeometry(0.028, 0), DARK, { p: [-0.12, 0.69, -0.26] }),
        // 头顶翘起来的一小撮毛
        part(new THREE.ConeGeometry(0.05, 0.2, 4), WHITE, { p: [0, 0.8, -0.04], r: [0.7, 0, 0] }),
      ]),
    ),
  );
  // 喉囊：挂在下喙上，吃得越多越鼓
  const pouch = mesh(part(new THREE.IcosahedronGeometry(0.2, 1), POUCH, { p: [0, -0.2, 0], s: [0.5, 1, 1.5] }));
  pouch.position.set(0, 0.6, -0.56);
  neck.add(pouch);

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
      spread += ((flying ? 1 : bike.rushing ? 0.25 : 0) - spread) * Math.min(1, dt * 9);
      const flap = flying ? Math.sin(clock * (bike.finished ? 10 : 16)) * (bike.finished ? 0.3 : 0.16) : 0;
      wingRight.rotation.set(0, -0.5 + spread * 0.5, -1.25 + spread * 1.45 + flap);
      wingLeft.rotation.set(0, 0.5 - spread * 0.5, 1.25 - spread * 1.45 - flap);

      scarf.rotation.y = bike.lean * 1.4 + Math.sin(clock * 9) * 0.18 * Math.min(1, bike.v / 16);
      scarf.rotation.x = 0.5 - Math.min(0.5, bike.v / 40);

      pulse += (0 - pulse) * Math.min(1, dt * 7);
      pouch.scale.set(0.8 + fill * 0.9 + pulse * 0.4, 0.55 + fill * 1.2 + pulse * 0.6, 1);
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
