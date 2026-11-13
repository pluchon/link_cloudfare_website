// 景物的造型：每一样都是几个简单几何体拼起来、按面上色，没有贴图和模型文件。
// 同一种景物全场景共用一份几何体，摆放交给 world.ts 的实例化网格

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ROAD_WIDTH } from './course';
import type { PropKind } from './scenes';
import { seeded } from './track';

export interface PropShape {
  // 受光照的部分
  lit?: THREE.BufferGeometry;
  // 自己发光的部分（窗户、灯泡），夜里也亮，开着泛光时会晕出一圈光
  glow?: THREE.BufferGeometry;
  // 不受光照、也不发光的部分（云）：是什么颜色就画什么颜色
  flat?: THREE.BufferGeometry;
  // 叠加发光的部分（极光），越亮越透
  beam?: THREE.BufferGeometry;
  // 会一直转的部分（风车的叶片、摩天轮的轮子、灯塔的光柱）：造型以转轴为原点，pivot 是转轴在景物里的位置，speed 是每秒转多少弧度
  spin?: { part: THREE.BufferGeometry; layer: 'lit' | 'beam'; pivot: [number, number, number]; axis: 'y' | 'z'; speed: number };
}

interface Place {
  p?: [number, number, number];
  r?: [number, number, number];
  s?: [number, number, number] | number;
}

const dummy = new THREE.Object3D();
const tint = new THREE.Color();

// 给一个几何体整块上色，并摆到指定的位置、角度、大小
export function part(geometry: THREE.BufferGeometry, hex: number, place: Place = {}): THREE.BufferGeometry {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry;
  if (flat !== geometry) geometry.dispose();
  // 法线最后拼完统一重算，这里先去掉，手写的三角片和现成几何体才能拼到一起
  flat.deleteAttribute('uv');
  flat.deleteAttribute('normal');
  dummy.position.set(...(place.p ?? [0, 0, 0]));
  dummy.rotation.set(...(place.r ?? [0, 0, 0]));
  const scale = place.s ?? 1;
  if (typeof scale === 'number') dummy.scale.setScalar(scale);
  else dummy.scale.set(...scale);
  dummy.updateMatrix();
  flat.applyMatrix4(dummy.matrix);
  tint.setHex(hex);
  const count = flat.getAttribute('position').count;
  const color = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    color[i * 3] = tint.r;
    color[i * 3 + 1] = tint.g;
    color[i * 3 + 2] = tint.b;
  }
  flat.setAttribute('color', new THREE.BufferAttribute(color, 3));
  return flat;
}

// 按绕竖轴的角度给每个面轮流上色，画出气球和阳伞上一瓣一瓣的条纹
function stripes(geometry: THREE.BufferGeometry, colors: readonly number[], bands: number): THREE.BufferGeometry {
  const position = geometry.getAttribute('position');
  const color = geometry.getAttribute('color');
  for (let i = 0; i < position.count; i += 3) {
    const x = (position.getX(i) + position.getX(i + 1) + position.getX(i + 2)) / 3;
    const z = (position.getZ(i) + position.getZ(i + 1) + position.getZ(i + 2)) / 3;
    const band = Math.floor(((Math.atan2(z, x) + Math.PI) / (Math.PI * 2)) * bands) % bands;
    tint.setHex(colors[band % colors.length]);
    for (let k = 0; k < 3; k += 1) color.setXYZ(i + k, tint.r, tint.g, tint.b);
  }
  return geometry;
}

// 把顶点按位置挪一点，石头和山头就不那么规整。同一个位置的顶点挪得一样，面不会裂开
function roughen(geometry: THREE.BufferGeometry, amount: number): THREE.BufferGeometry {
  const position = geometry.getAttribute('position');
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const wave = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
    const shift = 1 + ((wave - Math.floor(wave)) - 0.5) * amount;
    position.setXYZ(i, x * shift, y * shift, z * shift);
  }
  return geometry;
}

export function join(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  // 已经拼过一次的零件带着法线，没拼过的不带；统一去掉再拼，最后重算
  parts.forEach((item) => item.deleteAttribute('normal'));
  const merged = mergeGeometries(parts, false);
  parts.forEach((item) => item.dispose());
  merged.computeVertexNormals();
  return merged;
}

const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const tube = (top: number, bottom: number, h: number, sides = 7) => new THREE.CylinderGeometry(top, bottom, h, sides);
const cone = (r: number, h: number, sides = 7) => new THREE.ConeGeometry(r, h, sides);
const blob = (r: number, detail = 1) => new THREE.IcosahedronGeometry(r, detail);

function palm(): PropShape {
  const parts: THREE.BufferGeometry[] = [];
  // 树干分四节，一节比一节歪，顶上自然就偏出去了
  let x = 0;
  let y = 0;
  for (let i = 0; i < 4; i += 1) {
    const tilt = 0.07 + i * 0.07;
    parts.push(part(tube(0.2 - i * 0.025, 0.26 - i * 0.025, 1.7, 6), i % 2 ? 0x9a6b4a : 0x8a5d40, { p: [x + Math.sin(tilt) * 0.85, y + 0.85, 0], r: [0, 0, -tilt] }));
    x += Math.sin(tilt) * 1.7;
    y += Math.cos(tilt) * 1.7;
  }
  // 叶子：每片两截，先往外伸再往下垂
  for (let k = 0; k < 9; k += 1) {
    const angle = (k / 9) * Math.PI * 2 + 0.3;
    const leaf = join([
      part(box(1.9, 0.07, 0.62), k % 2 ? 0x2f7d5a : 0x38906a, { p: [0.95, 0.12, 0], r: [0, 0, 0.14] }),
      part(box(1.7, 0.06, 0.46), k % 2 ? 0x2a7052 : 0x318260, { p: [2.55, -0.18, 0], r: [0, 0, -0.5] }),
    ]);
    dummy.position.set(x, y, 0);
    dummy.rotation.set(0, angle, 0);
    dummy.scale.setScalar(1);
    dummy.updateMatrix();
    leaf.applyMatrix4(dummy.matrix);
    parts.push(leaf);
  }
  parts.push(part(blob(0.3, 0), 0x6b4a32, { p: [x, y - 0.1, 0] }));
  // 叶子底下挂三个椰子
  for (let k = 0; k < 3; k += 1) {
    const angle = (k / 3) * Math.PI * 2;
    parts.push(part(blob(0.17, 0), 0x5a3f2c, { p: [x + Math.cos(angle) * 0.28, y - 0.36, Math.sin(angle) * 0.28] }));
  }
  return { lit: join(parts) };
}

// detail 是树冠的精细程度：路边的用 1，远处成片的树丛用 0，面数只有四分之一
function tree(leafA: number, leafB: number, trunk = 0x7a5540, detail = 1): PropShape {
  return {
    lit: join([
      part(tube(0.2, 0.34, 2.6, 7), trunk, { p: [0, 1.3, 0] }),
      // 两根斜出去的枝杈，托着两边的树冠
      part(tube(0.08, 0.13, 1.4, 5), trunk, { p: [0.5, 2.5, 0.15], r: [0, 0, -0.8] }),
      part(tube(0.08, 0.12, 1.2, 5), trunk, { p: [-0.42, 2.45, -0.25], r: [0.3, 0, 0.8] }),
      // 树冠是大小五团叶子，深浅两色错开
      part(roughen(blob(1.7, detail), 0.2), leafA, { p: [0, 3.7, 0], s: [1, 0.9, 1] }),
      part(roughen(blob(1.15, detail), 0.2), leafB, { p: [1.05, 3.0, 0.45] }),
      part(roughen(blob(1.0, detail), 0.2), leafB, { p: [-0.9, 3.1, -0.55] }),
      part(roughen(blob(0.85, detail), 0.2), leafA, { p: [0.2, 3.15, -1.0] }),
      part(roughen(blob(0.8, detail), 0.2), leafB, { p: [-0.3, 4.65, 0.3] }),
    ]),
  };
}

function pine(snow: boolean): PropShape {
  const dark = snow ? 0x4f8a86 : 0x2f6f55;
  const mid = snow ? 0x5f9a94 : 0x38805f;
  const light = snow ? 0xf2f7fb : 0x4a9470;
  const parts = [part(tube(0.18, 0.28, 1.5, 6), 0x6b4a36, { p: [0, 0.75, 0] })];
  // 四层枝叶，一层比一层小，每层转开一点；带雪的每层顶上压一圈雪
  const tiers = [
    [1.75, 2.0, 1.9],
    [1.42, 1.9, 3.0],
    [1.08, 1.8, 4.05],
    [0.72, 1.7, 5.05],
  ];
  tiers.forEach(([radius, height, y], i) => {
    parts.push(part(cone(radius, height, 8), i % 2 ? mid : dark, { p: [0, y, 0], r: [0, i * 0.4, 0] }));
    if (snow || i === tiers.length - 1) {
      parts.push(part(cone(radius * 0.64, height * 0.64, 8), light, { p: [0, y + height * 0.2, 0], r: [0, i * 0.4 + 0.2, 0] }));
    }
  });
  return { lit: join(parts) };
}

function cactus(): PropShape {
  const green = 0x5a9a68;
  return {
    lit: join([
      part(tube(0.42, 0.48, 3.2, 7), green, { p: [0, 1.6, 0] }),
      part(blob(0.42, 0), green, { p: [0, 3.2, 0] }),
      part(tube(0.24, 0.24, 0.9, 6), 0x4f8c5d, { p: [0.75, 1.7, 0], r: [0, 0, Math.PI / 2] }),
      part(tube(0.24, 0.26, 1.3, 6), 0x4f8c5d, { p: [1.15, 2.3, 0] }),
      part(tube(0.22, 0.22, 0.8, 6), 0x4f8c5d, { p: [-0.7, 1.2, 0], r: [0, 0, Math.PI / 2] }),
      part(tube(0.22, 0.24, 0.9, 6), 0x4f8c5d, { p: [-1.05, 1.6, 0] }),
    ]),
  };
}

function rock(main: number, cap: number): PropShape {
  return {
    lit: join([
      part(roughen(blob(1, 0), 0.5), main, { p: [0, 0.45, 0], s: [1.5, 0.95, 1.2] }),
      part(roughen(blob(0.6, 0), 0.5), cap, { p: [0.85, 0.3, 0.5], s: [1.2, 0.9, 1] }),
      part(roughen(blob(0.42, 0), 0.5), main, { p: [-1.1, 0.22, -0.5], s: [1.1, 0.8, 1] }),
    ]),
  };
}

function bush(main = 0x4f9a62, side = 0x62ab70): PropShape {
  return {
    lit: join([
      part(roughen(blob(0.75, 0), 0.3), main, { p: [0, 0.45, 0], s: [1.2, 0.8, 1] }),
      part(roughen(blob(0.55, 0), 0.3), side, { p: [0.7, 0.35, 0.25] }),
      part(roughen(blob(0.45, 0), 0.3), side, { p: [-0.55, 0.3, -0.35] }),
    ]),
  };
}

function flowers(petalA: number, petalB: number): PropShape {
  const random = seeded(petalA);
  const parts: THREE.BufferGeometry[] = [part(blob(0.5, 0), 0x6faf6a, { p: [0, 0.05, 0], s: [1.9, 0.22, 1.9] })];
  for (let i = 0; i < 9; i += 1) {
    const angle = random() * Math.PI * 2;
    const radius = 0.15 + random() * 0.85;
    const height = 0.3 + random() * 0.25;
    parts.push(part(new THREE.OctahedronGeometry(0.16, 0), i % 3 ? petalA : petalB, { p: [Math.cos(angle) * radius, height, Math.sin(angle) * radius] }));
  }
  return { lit: join(parts) };
}

function lighthouse(): PropShape {
  return {
    lit: join([
      part(tube(1.9, 2.3, 0.8, 10), 0x8d8f9c, { p: [0, 0.4, 0] }),
      part(tube(1.25, 1.85, 11, 10), 0xfaf6ee, { p: [0, 6.3, 0] }),
      part(tube(1.68, 1.8, 1.7, 10), 0xd9503a, { p: [0, 3.2, 0] }),
      part(tube(1.42, 1.54, 1.7, 10), 0xd9503a, { p: [0, 8.0, 0] }),
      part(tube(1.8, 1.8, 0.28, 10), 0x4a4c5c, { p: [0, 11.95, 0] }),
      part(cone(1.25, 1.4, 10), 0xd9503a, { p: [0, 14.4, 0] }),
    ]),
    glow: join([part(tube(0.95, 0.95, 1.5, 10), 0xffe9a6, { p: [0, 12.85, 0] })]),
  };
}

function windmill(): PropShape {
  const parts = [
    part(tube(0.85, 1.6, 7.5, 6), 0xf6efe0, { p: [0, 3.75, 0] }),
    part(cone(1.15, 1.5, 6), 0xc9573f, { p: [0, 8.25, 0] }),
    part(box(0.7, 1.3, 0.1), 0x7a5540, { p: [0, 0.65, 1.52] }),
    part(tube(0.18, 0.18, 0.9, 6), 0x7a5540, { p: [0, 7.1, 1.1], r: [Math.PI / 2, 0, 0] }),
  ];
  // 四片叶片单独一份，绕着轴慢慢转
  const blades: THREE.BufferGeometry[] = [part(blob(0.3, 0), 0x7a5540)];
  for (let k = 0; k < 4; k += 1) {
    const angle = (k / 4) * Math.PI * 2;
    blades.push(part(box(0.75, 3.9, 0.07), 0xfdfaf2, { p: [Math.sin(angle) * -2.1, Math.cos(angle) * 2.1, 0], r: [0, 0, angle] }));
    blades.push(part(box(0.1, 4.3, 0.1), 0x7a5540, { p: [Math.sin(angle) * -2.2, Math.cos(angle) * 2.2, -0.06], r: [0, 0, angle] }));
  }
  return { lit: join(parts), spin: { part: join(blades), layer: 'lit', pivot: [0, 7.1, 1.56], axis: 'z', speed: 0.7 } };
}

function balloon(colors: readonly number[]): PropShape {
  const envelope = part(new THREE.SphereGeometry(5, 12, 8), colors[0], { s: [1, 1.12, 1] });
  stripes(envelope, colors, 12);
  const skirt = part(tube(1.5, 0.8, 1.6, 12), colors[0], { p: [0, -5.9, 0] });
  stripes(skirt, colors, 12);
  return {
    lit: join([
      envelope,
      skirt,
      part(box(1.3, 1.1, 1.3), 0x8a5d40, { p: [0, -8.6, 0] }),
      part(tube(0.03, 0.03, 2.2, 4), 0x5a4638, { p: [0.55, -7.4, 0.55] }),
      part(tube(0.03, 0.03, 2.2, 4), 0x5a4638, { p: [-0.55, -7.4, 0.55] }),
      part(tube(0.03, 0.03, 2.2, 4), 0x5a4638, { p: [0.55, -7.4, -0.55] }),
      part(tube(0.03, 0.03, 2.2, 4), 0x5a4638, { p: [-0.55, -7.4, -0.55] }),
    ]),
  };
}

// 云不受光照，自己是什么颜色就画什么颜色：受光的话，云底会被地面的反光染成草地的绿色
function cloud(top: number, under: number): PropShape {
  return {
    flat: join([
      part(blob(4), top, { s: [1.5, 0.62, 1] }),
      part(blob(3), top, { p: [5, -0.3, 0.6], s: [1.4, 0.6, 1] }),
      part(blob(2.6), top, { p: [-5.2, -0.4, -0.4], s: [1.4, 0.6, 1] }),
      part(blob(2.4), under, { p: [0.5, -1.2, 0.2], s: [2.6, 0.4, 1.2] }),
    ]),
  };
}

function house(wall: number, roof: number, trim: number, window: number): PropShape {
  return {
    lit: join([
      // 石头地基、墙、挑出来的屋檐、屋顶
      part(box(4.6, 0.3, 3.8), 0x8d8f9c, { p: [0, 0.15, 0] }),
      part(box(4.2, 2.6, 3.4), wall, { p: [0, 1.6, 0] }),
      part(box(4.9, 0.16, 4.1), trim, { p: [0, 2.94, 0] }),
      part(cone(3.6, 1.9, 4), roof, { p: [0, 3.9, 0], r: [0, Math.PI / 4, 0], s: [1, 1, 0.84] }),
      // 门框、门板、门口的台阶
      part(box(0.95, 1.75, 0.12), trim, { p: [-0.9, 1.18, 1.72] }),
      part(box(0.72, 1.5, 0.14), roof, { p: [-0.9, 1.1, 1.74] }),
      part(box(1.3, 0.14, 0.7), 0x8d8f9c, { p: [-0.9, 0.22, 2.1] }),
      // 窗台和窗格
      part(box(1.3, 0.12, 0.16), trim, { p: [0.95, 1.28, 1.76] }),
      part(box(0.07, 0.9, 0.1), trim, { p: [0.95, 1.78, 1.77] }),
      part(box(1, 0.07, 0.1), trim, { p: [0.95, 1.78, 1.77] }),
      // 烟囱
      part(box(0.5, 1.5, 0.5), trim, { p: [1.2, 4.2, -0.5] }),
      part(box(0.64, 0.14, 0.64), roof, { p: [1.2, 5, -0.5] }),
    ]),
    glow: join([
      part(box(1, 0.9, 0.08), window, { p: [0.95, 1.78, 1.72] }),
      part(box(0.08, 0.9, 0.7), window, { p: [2.11, 1.78, 0.3] }),
      part(box(0.08, 0.9, 0.7), window, { p: [-2.11, 1.78, -0.3] }),
    ]),
  };
}

function lamp(): PropShape {
  return {
    lit: join([
      part(tube(0.07, 0.1, 4.6, 6), 0x4a4c5c, { p: [0, 2.3, 0] }),
      part(box(0.08, 0.08, 1.3), 0x4a4c5c, { p: [0, 4.55, 0.6] }),
      part(cone(0.34, 0.3, 6), 0x4a4c5c, { p: [0, 4.5, 1.2] }),
    ]),
    glow: join([part(blob(0.2, 0), 0xffe7a8, { p: [0, 4.3, 1.2] })]),
  };
}

// 一栋楼：宽 width、高 height，窗户随机亮着几种颜色，楼顶一道霓虹灯带
function tower(seed: number, width: number, height: number, wall: number, neon: number): PropShape {
  const random = seeded(seed);
  const lights = [0xffd98a, 0x8ee6ff, 0xff8fc7, 0xfff2c8];
  const body = [
    part(box(width, height, width), wall, { p: [0, height / 2, 0] }),
    part(box(width * 0.76, 3, width * 0.76), 0x45466a, { p: [0, height + 1.5, 0] }),
    part(tube(0.08, 0.08, 4, 4), 0x6a6b90, { p: [width * 0.22, height + 5, width * 0.22] }),
  ];
  const windows: THREE.BufferGeometry[] = [];
  const rows = Math.floor((height - 3) / 2.2);
  const cols = Math.max(2, Math.floor(width / 2.2));
  for (let face = 0; face < 4; face += 1) {
    const turn = (face * Math.PI) / 2;
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        if (random() < 0.36) continue;
        const pane = part(box(1.2, 1.3, 0.06), lights[Math.floor(random() * lights.length)], {
          p: [(col - (cols - 1) / 2) * 2, 2.4 + row * 2.2, width / 2 + 0.03],
        });
        pane.rotateY(turn);
        windows.push(pane);
      }
    }
  }
  windows.push(part(box(width + 0.1, 0.25, width + 0.1), neon, { p: [0, height + 0.1, 0] }));
  return { lit: join(body), glow: join(windows) };
}

function sailboat(): PropShape {
  const sail = new THREE.BufferGeometry();
  sail.setAttribute('position', new THREE.Float32BufferAttribute([0.1, 0.9, 0, 0.1, 5.2, 0, 2.6, 0.9, 0], 3));
  const jib = new THREE.BufferGeometry();
  jib.setAttribute('position', new THREE.Float32BufferAttribute([-0.1, 1.1, 0, -1.7, 1.1, 0, -0.1, 4.2, 0], 3));
  return {
    lit: join([
      part(box(4.2, 0.7, 1.3), 0xfaf6ee, { p: [0, 0.3, 0] }),
      part(box(4.3, 0.18, 1.34), 0xd9503a, { p: [0, 0.62, 0] }),
      part(tube(0.05, 0.05, 5, 4), 0x6b4a36, { p: [0, 3, 0] }),
      part(sail, 0xfffdf6),
      part(jib, 0xf6dfb0),
    ]),
  };
}

function parasol(): PropShape {
  const canopy = part(cone(1.9, 0.8, 8), 0xe56a54, { p: [0, 2.6, 0] });
  stripes(canopy, [0xe56a54, 0xfdf6ea], 8);
  return {
    lit: join([
      canopy,
      part(tube(0.05, 0.05, 2.6, 5), 0xf6efe0, { p: [0, 1.3, 0], r: [0, 0, 0.08] }),
      part(box(0.8, 0.1, 1.9), 0x58b9c9, { p: [0.9, 0.25, 0.3], r: [0, 0.4, 0] }),
    ]),
  };
}

function mesa(): PropShape {
  return {
    lit: join([
      part(roughen(tube(6.2, 8, 4, 7), 0.12), 0xb8683f, { p: [0, 2, 0] }),
      part(roughen(tube(5.2, 6, 3.2, 7), 0.12), 0xcf8050, { p: [0.3, 5.6, 0] }),
      part(roughen(tube(4.6, 5.1, 1.4, 7), 0.1), 0xe0a06a, { p: [0.4, 7.9, 0.2] }),
    ]),
  };
}

function snowman(): PropShape {
  return {
    lit: join([
      part(blob(0.75), 0xfbfdff, { p: [0, 0.65, 0] }),
      part(blob(0.52), 0xfbfdff, { p: [0, 1.65, 0] }),
      part(blob(0.36), 0xfbfdff, { p: [0, 2.38, 0] }),
      part(cone(0.07, 0.42, 5), 0xf2933a, { p: [0, 2.38, 0.5], r: [Math.PI / 2, 0, 0] }),
      part(tube(0.24, 0.24, 0.36, 7), 0x3a3d52, { p: [0, 2.86, 0] }),
      part(tube(0.38, 0.38, 0.05, 7), 0x3a3d52, { p: [0, 2.7, 0] }),
      part(tube(0.4, 0.4, 0.14, 8), 0xd9503a, { p: [0, 2.08, 0] }),
    ]),
  };
}

function aurora(): PropShape {
  const curtain = new THREE.PlaneGeometry(150, 34, 16, 1).toNonIndexed();
  curtain.deleteAttribute('uv');
  const position = curtain.getAttribute('position');
  const color = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const y = position.getY(i);
    position.setZ(i, Math.sin(x * 0.045) * 14 + Math.sin(x * 0.11 + 1) * 5);
    // 底边亮绿，往上转紫并暗下去；叠加混合里越暗就越透明
    const up = (y + 17) / 34;
    const fade = Math.max(0, 1 - Math.abs(x) / 75) ** 0.6;
    tint.setRGB(0.25 + up * 0.35, 0.95 - up * 0.75, 0.6 + up * 0.1).multiplyScalar((1 - up) * 0.4 * fade);
    color[i * 3] = tint.r;
    color[i * 3 + 1] = tint.g;
    color[i * 3 + 2] = tint.b;
  }
  curtain.setAttribute('color', new THREE.BufferAttribute(color, 3));
  return { beam: curtain };
}

interface Massif {
  seed: number;
  // 占地多宽、多深，最高多高（米）
  width: number;
  depth: number;
  height: number;
  // 几个山头
  peaks: number;
  // 圆头的土丘，还是尖顶的山
  round: boolean;
  // 从山脚到山顶四层颜色，最上面一层是雪或者受光的浅色
  colors: [number, number, number, number];
  // 多高以上算最上面一层（0 到 1）
  cap: number;
}

// 一片山或者一片丘陵：在一张网格上堆几个山头，每个面按自己的高度上色。
// 夹在路边景物和天边那圈剪影之间，画面才有前中后三层。
// 早先是两三个压扁的球和圆锥拼的，用户嫌远山粗糙；这样做出来有山脊、有鞍部、有雪线
function massif(spec: Massif): PropShape {
  const random = seeded(spec.seed);
  const cells = 14;
  const tops = [{ x: 0, z: 0, r: 0.85, h: 1 }];
  for (let i = 1; i < spec.peaks; i += 1) {
    tops.push({ x: (random() * 2 - 1) * 0.62, z: (random() * 2 - 1) * 0.4, r: 0.4 + random() * 0.4, h: 0.5 + random() * 0.42 });
  }
  // (u, v) 都在 -1 到 1 之间，返回 0 到 1 的高度
  const rise = (u: number, v: number): number => {
    let h = 0;
    for (const top of tops) {
      const d = Math.hypot(u - top.x, v - top.z) / top.r;
      if (d < 1) h = Math.max(h, top.h * (spec.round ? 1 - d * d : (1 - d) ** 1.25));
    }
    // 四边压到地面，中间加一点起伏，山脊才不是一条直线
    const edge = 1 - Math.max(Math.abs(u), Math.abs(v)) ** 4;
    const rough = 1 + Math.sin(u * 9.1 + spec.seed) * Math.cos(v * 7.3 + spec.seed * 1.7) * (spec.round ? 0.08 : 0.2);
    return Math.max(0, h * edge * rough);
  };
  // 网格顶点先各自挪一点，三角面才不整齐
  const grid: Array<[number, number, number]> = [];
  for (let j = 0; j <= cells; j += 1) {
    for (let i = 0; i <= cells; i += 1) {
      const inner = i > 0 && i < cells && j > 0 && j < cells;
      const u = (i / cells) * 2 - 1 + (inner ? (random() - 0.5) * 0.09 : 0);
      const v = (j / cells) * 2 - 1 + (inner ? (random() - 0.5) * 0.09 : 0);
      grid.push([u, rise(u, v), v]);
    }
  }
  const position: number[] = [];
  const color: number[] = [];
  const face = (a: number, b: number, c: number) => {
    const level = (grid[a][1] + grid[b][1] + grid[c][1]) / 3;
    // 压在地面上的那一圈不用画
    if (level <= 0) return;
    for (const index of [a, b, c]) position.push((grid[index][0] * spec.width) / 2, grid[index][1] * spec.height, (grid[index][2] * spec.depth) / 2);
    const band = level > spec.cap ? 3 : level > spec.cap * 0.62 ? 2 : level > spec.cap * 0.28 ? 1 : 0;
    tint.setHex(spec.colors[band]);
    for (let k = 0; k < 3; k += 1) color.push(tint.r, tint.g, tint.b);
  };
  for (let j = 0; j < cells; j += 1) {
    for (let i = 0; i < cells; i += 1) {
      const a = j * (cells + 1) + i;
      const b = a + 1;
      const c = a + cells + 1;
      const d = c + 1;
      // 对角线一格朝这边、一格朝那边，山坡上不会全是同一个方向的斜纹
      if ((i + j) % 2 === 0) {
        face(a, c, b);
        face(b, c, d);
      } else {
        face(a, c, d);
        face(a, d, b);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(color, 3));
  geometry.computeVertexNormals();
  return { lit: geometry };
}

// 圆头的丘陵
const hill = (seed: number, colors: Massif['colors']): PropShape =>
  massif({ seed, width: 104, depth: 86, height: 19, peaks: 3, round: true, colors, cap: 0.7 });
// 尖顶的远山，最上面一层是雪
const mountain = (seed: number, colors: Massif['colors']): PropShape =>
  massif({ seed, width: 170, depth: 128, height: 82, peaks: 5, round: false, colors, cap: 0.6 });
// 横着的一道长岭，比丘陵高、比远山矮，放在两者之间
const ridge = (seed: number, colors: Massif['colors']): PropShape =>
  massif({ seed, width: 230, depth: 78, height: 34, peaks: 6, round: false, colors, cap: 0.72 });

// 把几样现成的景物随机摆成一堆、合成一个：远处的树丛、小村子。一样一样单摆的话，远处会稀稀拉拉
function cluster(seed: number, radius: number, items: Array<[() => PropShape, number]>): PropShape {
  const random = seeded(seed);
  const lit: THREE.BufferGeometry[] = [];
  const glow: THREE.BufferGeometry[] = [];
  for (const [make, count] of items) {
    for (let i = 0; i < count; i += 1) {
      const shape = make();
      const angle = random() * Math.PI * 2;
      const reach = Math.sqrt(random()) * radius;
      dummy.position.set(Math.cos(angle) * reach, 0, Math.sin(angle) * reach);
      dummy.rotation.set(0, random() * Math.PI * 2, 0);
      dummy.scale.setScalar(0.85 + random() * 0.6);
      dummy.updateMatrix();
      if (shape.lit) lit.push(shape.lit.applyMatrix4(dummy.matrix));
      if (shape.glow) glow.push(shape.glow.applyMatrix4(dummy.matrix));
    }
  }
  return { lit: lit.length ? join(lit) : undefined, glow: glow.length ? join(glow) : undefined };
}

// 海里的礁石柱：一高一矮两根，高的那根顶上长着草
function seaStack(): PropShape {
  return {
    lit: join([
      part(roughen(tube(2.1, 3.6, 10, 6), 0.2), 0x7f8490, { p: [0, 4.6, 0] }),
      part(roughen(blob(1, 0), 0.3), 0x6fa86a, { p: [0, 9.7, 0], s: [2.3, 0.8, 2.3] }),
      part(roughen(tube(1.3, 2.4, 5.5, 6), 0.2), 0x8d919c, { p: [4.6, 2.4, 1.6] }),
      part(roughen(blob(1, 0), 0.4), 0x9a9ea8, { p: [-3.6, 0.5, -1.4], s: [2, 1.1, 1.6] }),
    ]),
  };
}

// 一小群鸟：每只是两片往上翘的翅膀
function birds(color: number): PropShape {
  const parts: THREE.BufferGeometry[] = [];
  const spots = [
    [0, 0, 0],
    [2.4, 0.5, 1.7],
    [-2.6, 0.3, 1.5],
    [4.9, 1, 3.6],
    [-4.7, 0.9, 3.3],
    [1.1, 1.7, 5.4],
  ];
  for (const [x, y, z] of spots) {
    parts.push(part(box(1.15, 0.06, 0.36), color, { p: [x + 0.52, y + 0.16, z], r: [0, 0, 0.36] }));
    parts.push(part(box(1.15, 0.06, 0.36), color, { p: [x - 0.52, y + 0.16, z], r: [0, 0, -0.36] }));
  }
  return { lit: join(parts) };
}

// 一段栅栏，顺着路摆
function fence(post: number, rail: number): PropShape {
  const parts = [part(box(6.3, 0.1, 0.08), rail, { p: [0, 0.5, 0] }), part(box(6.3, 0.1, 0.08), rail, { p: [0, 0.92, 0] })];
  for (const x of [-3, -1, 1, 3]) parts.push(part(box(0.16, 1.15, 0.16), post, { p: [x, 0.57, 0] }));
  return { lit: join(parts) };
}

// 一丛草：几根细长的尖叶
function grass(a: number, b: number): PropShape {
  const random = seeded(a);
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 6; i += 1) {
    const angle = random() * Math.PI * 2;
    const radius = random() * 0.42;
    const height = 0.42 + random() * 0.46;
    parts.push(
      part(cone(0.1, height, 3), i % 2 ? a : b, {
        p: [Math.cos(angle) * radius, height / 2, Math.sin(angle) * radius],
        r: [(random() - 0.5) * 0.5, 0, (random() - 0.5) * 0.5],
      }),
    );
  }
  return { lit: join(parts) };
}

// 电线杆
function pole(): PropShape {
  return {
    lit: join([
      part(tube(0.09, 0.13, 6.6, 6), 0x6b4a36, { p: [0, 3.3, 0] }),
      part(box(1.9, 0.1, 0.1), 0x6b4a36, { p: [0, 6.05, 0] }),
      part(box(1.3, 0.09, 0.09), 0x6b4a36, { p: [0, 5.5, 0] }),
      part(box(0.1, 0.16, 0.1), 0xd9dcf0, { p: [0.8, 6.18, 0] }),
      part(box(0.1, 0.16, 0.1), 0xd9dcf0, { p: [-0.8, 6.18, 0] }),
    ]),
  };
}

// 两块斜插在沙里的冲浪板
function surfboard(): PropShape {
  return {
    lit: join([
      part(blob(1, 1), 0x4fb3a4, { p: [0, 1.25, 0], r: [0, 0, 0.14], s: [0.34, 1.3, 0.07] }),
      part(box(0.07, 1.9, 0.09), 0xfdf6ea, { p: [0, 1.25, 0.03], r: [0, 0, 0.14] }),
      part(blob(1, 1), 0xf2c14e, { p: [0.75, 1.1, 0.25], r: [0, 0.5, -0.2], s: [0.32, 1.15, 0.07] }),
    ]),
  };
}

// 浮在水面上的几道浪花
function foam(color: number): PropShape {
  return {
    lit: join([
      part(box(9, 0.05, 0.6), color),
      part(box(5.5, 0.05, 0.45), color, { p: [3.5, 0, 2.4] }),
      part(box(4, 0.05, 0.4), color, { p: [-4.5, 0, -2] }),
    ]),
  };
}

// 小岛：一个沙丘上长着一棵棕榈
function islet(sand: number): PropShape {
  const tree = palm().lit as THREE.BufferGeometry;
  dummy.position.set(1.5, 1.7, 0);
  dummy.rotation.set(0, 0.8, 0);
  dummy.scale.setScalar(1.25);
  dummy.updateMatrix();
  tree.applyMatrix4(dummy.matrix);
  return {
    lit: join([
      part(roughen(blob(1, 1), 0.16), sand, { s: [15, 2.4, 11] }),
      part(roughen(blob(1, 0), 0.4), 0x8d919c, { p: [-6, 0.9, 3], s: [2.2, 1.6, 1.8] }),
      tree,
    ]),
  };
}

// 浮标：红白相间，顶上一盏灯
function buoy(): PropShape {
  return {
    lit: join([
      part(tube(0.9, 1.1, 0.9, 8), 0xd9503a, { p: [0, 0.4, 0] }),
      part(tube(0.42, 0.8, 1.5, 8), 0xfaf6ee, { p: [0, 1.6, 0] }),
      part(tube(0.3, 0.42, 0.9, 8), 0xd9503a, { p: [0, 2.8, 0] }),
    ]),
    glow: join([part(blob(0.32, 0), 0xffe9a6, { p: [0, 3.5, 0] })]),
  };
}

// 夜里的灯塔：塔身一样，多两道慢慢扫过海面的光柱
function lighthouseLit(): PropShape {
  const base = lighthouse();
  const ray = (flip: number) =>
    part(new THREE.ConeGeometry(2.3, 44, 8, 1, true), 0x1d1b10, { p: [flip * 22, 0, 0], r: [0, 0, (flip * Math.PI) / 2] });
  return { ...base, spin: { part: join([ray(1), ray(-1)]), layer: 'beam', pivot: [0, 12.85, 0], axis: 'y', speed: 0.5 } };
}

// 夜里挂着灯笼的帆船
function sailboatLit(): PropShape {
  return {
    lit: sailboat().lit,
    glow: join([part(blob(0.26, 0), 0xffd98a, { p: [0, 5.6, 0] }), part(blob(0.2, 0), 0xffd98a, { p: [1.9, 0.95, 0] })]),
  };
}

// 鸟居：两根红柱子，上面两道横梁，整个跨在路上
function torii(): PropShape {
  const half = ROAD_WIDTH / 2 + 1.6;
  const red = 0xd9453a;
  return {
    lit: join([
      part(tube(0.3, 0.36, 7.4, 8), red, { p: [-half, 3.7, 0] }),
      part(tube(0.3, 0.36, 7.4, 8), red, { p: [half, 3.7, 0] }),
      part(box(0.9, 0.5, 0.9), 0x3a3d52, { p: [-half, 0.25, 0] }),
      part(box(0.9, 0.5, 0.9), 0x3a3d52, { p: [half, 0.25, 0] }),
      part(box(half * 2 + 1.2, 0.4, 0.42), red, { p: [0, 6.25, 0] }),
      part(box(half * 2 + 2.6, 0.55, 0.7), red, { p: [0, 7.55, 0] }),
      part(box(half * 2 + 3.8, 0.3, 0.95), 0x3a3d52, { p: [0, 7.98, 0] }),
      part(box(0.5, 0.95, 0.3), red, { p: [0, 6.9, 0] }),
    ]),
  };
}

// 石灯笼
function stoneLantern(): PropShape {
  return {
    lit: join([
      part(box(0.8, 0.22, 0.8), 0x9a9ca8, { p: [0, 0.11, 0] }),
      part(tube(0.16, 0.2, 1.1, 6), 0xa9abb6, { p: [0, 0.77, 0] }),
      part(box(0.7, 0.14, 0.7), 0x9a9ca8, { p: [0, 1.38, 0] }),
      part(cone(0.62, 0.42, 4), 0x8d8f9c, { p: [0, 2.1, 0], r: [0, Math.PI / 4, 0] }),
    ]),
    glow: join([part(box(0.46, 0.46, 0.46), 0xffe2a0, { p: [0, 1.68, 0] })]),
  };
}

// 一堆原木
function logs(): PropShape {
  const parts: THREE.BufferGeometry[] = [];
  const spots = [
    [0.32, -0.34],
    [0.32, 0.34],
    [0.88, 0],
  ];
  for (const [y, z] of spots) {
    parts.push(part(tube(0.32, 0.32, 2.6, 7), 0x8a5d40, { p: [0, y, z], r: [0, 0, Math.PI / 2] }));
    parts.push(part(tube(0.24, 0.24, 2.64, 7), 0xdcb890, { p: [0, y, z], r: [0, 0, Math.PI / 2] }));
  }
  return { lit: join(parts) };
}

// 露营帐篷，门口透出一点灯光
function tent(cloth: number): PropShape {
  return {
    lit: join([
      part(cone(2, 2.2, 4), cloth, { p: [0, 1.1, 0], r: [0, Math.PI / 4, 0], s: [1, 1, 1.25] }),
      part(tube(0.04, 0.04, 2.5, 4), 0x5a4638, { p: [0, 1.25, 1.75] }),
    ]),
    glow: join([part(cone(0.62, 1.25, 3), 0xffdf9a, { p: [0, 0.62, 1.42], s: [1, 1, 0.12] })]),
  };
}

// 蘑菇：一大一小
function mushroom(): PropShape {
  const one = (x: number, z: number, size: number) => [
    part(tube(0.09, 0.12, 0.42, 6), 0xfdf6ea, { p: [x, 0.21 * size, z], s: size }),
    part(blob(0.34, 0), 0xd9453a, { p: [x, 0.46 * size, z], s: [size, size * 0.62, size] }),
    part(blob(0.07, 0), 0xfdf6ea, { p: [x + 0.14 * size, 0.6 * size, z + 0.1 * size], s: size }),
    part(blob(0.06, 0), 0xfdf6ea, { p: [x - 0.12 * size, 0.58 * size, z - 0.12 * size], s: size }),
  ];
  return { lit: join([...one(0, 0, 1.5), ...one(0.6, 0.3, 0.9)]) };
}

// 小鹿
function deer(): PropShape {
  const coat = 0xb07a4c;
  const parts = [
    part(box(0.5, 0.56, 1.25), coat, { p: [0, 1.05, 0] }),
    part(box(0.28, 0.72, 0.3), coat, { p: [0, 1.58, 0.62], r: [0.5, 0, 0] }),
    part(box(0.3, 0.3, 0.5), coat, { p: [0, 1.95, 0.95] }),
    part(box(0.2, 0.22, 0.12), 0xfdf6ea, { p: [0, 1.2, -0.66] }),
    part(blob(0.045, 0), 0x2b2d33, { p: [0, 1.93, 1.22] }),
  ];
  const legs = [
    [-0.17, 0.48],
    [0.17, 0.48],
    [-0.17, -0.48],
    [0.17, -0.48],
  ];
  for (const [x, z] of legs) parts.push(part(box(0.11, 0.8, 0.11), 0x8a5d40, { p: [x, 0.4, z] }));
  for (const side of [-1, 1]) {
    parts.push(part(box(0.05, 0.5, 0.05), 0xe6d2b0, { p: [side * 0.16, 2.3, 0.82], r: [0, 0, -side * 0.4] }));
    parts.push(part(box(0.05, 0.26, 0.05), 0xe6d2b0, { p: [side * 0.3, 2.42, 0.9], r: [0.5, 0, -side * 0.9] }));
  }
  return { lit: join(parts) };
}

// 一卷干草
function hay(): PropShape {
  return {
    lit: join([
      part(tube(1.05, 1.05, 1.5, 10), 0xe2bf62, { p: [0, 1.02, 0], r: [0, 0, Math.PI / 2] }),
      part(tube(0.72, 0.72, 1.54, 10), 0xf0d68a, { p: [0, 1.02, 0], r: [0, 0, Math.PI / 2] }),
    ]),
  };
}

// 三个南瓜
function pumpkin(): PropShape {
  const one = (x: number, z: number, size: number) => [
    part(blob(0.5, 1), 0xe8822e, { p: [x, 0.36 * size, z], s: [size, size * 0.74, size] }),
    part(tube(0.05, 0.07, 0.2, 5), 0x5a7a3a, { p: [x, 0.78 * size, z], s: size }),
  ];
  return { lit: join([...one(0, 0, 1.1), ...one(0.95, 0.35, 0.75), ...one(-0.5, 0.8, 0.6)]) };
}

// 石拱：两根石柱顶着一块横石
function rockArch(): PropShape {
  return {
    lit: join([
      part(roughen(tube(1.9, 2.7, 9.5, 6), 0.16), 0xb8683f, { p: [-5.2, 4.75, 0] }),
      part(roughen(tube(1.7, 2.5, 9, 6), 0.16), 0xc2744a, { p: [5.4, 4.5, 0.4] }),
      part(roughen(box(15.5, 3, 4.4), 0.1), 0xcf8050, { p: [0, 10.4, 0.2] }),
      part(roughen(box(9, 1.3, 3.6), 0.1), 0xe0a06a, { p: [0.6, 12.4, 0.2] }),
    ]),
  };
}

// 火烈鸟
function flamingo(): PropShape {
  const pink = 0xf58fa8;
  return {
    lit: join([
      part(tube(0.025, 0.025, 1.05, 4), 0xe07a8a, { p: [0.06, 0.52, 0] }),
      part(tube(0.025, 0.025, 1.05, 4), 0xe07a8a, { p: [-0.06, 0.52, 0.05] }),
      part(blob(0.36, 1), pink, { p: [0, 1.22, 0], s: [0.8, 0.74, 1.3] }),
      part(tube(0.06, 0.08, 0.62, 5), pink, { p: [0, 1.6, 0.4], r: [0.45, 0, 0] }),
      part(tube(0.055, 0.06, 0.42, 5), pink, { p: [0, 1.98, 0.5], r: [-0.3, 0, 0] }),
      part(blob(0.12, 0), pink, { p: [0, 2.2, 0.48] }),
      part(cone(0.06, 0.24, 4), 0x2b2d33, { p: [0, 2.14, 0.66], r: [Math.PI / 2 + 0.5, 0, 0] }),
    ]),
  };
}

// 霓虹拱门：两根发光的柱子加一道横梁，整个跨在路上
function neonArch(main: number, inner: number): PropShape {
  const half = ROAD_WIDTH / 2 + 1.5;
  return {
    lit: join([part(box(0.9, 0.6, 0.9), 0x2c2d40, { p: [-half, 0.3, 0] }), part(box(0.9, 0.6, 0.9), 0x2c2d40, { p: [half, 0.3, 0] })]),
    glow: join([
      part(box(0.26, 8.4, 0.26), main, { p: [-half, 4.4, 0] }),
      part(box(0.26, 8.4, 0.26), main, { p: [half, 4.4, 0] }),
      part(box(half * 2 + 0.26, 0.26, 0.26), main, { p: [0, 8.6, 0] }),
      part(box(half * 2 - 1.6, 0.14, 0.14), inner, { p: [0, 7.8, 0] }),
      part(box(0.14, 7.2, 0.14), inner, { p: [-half + 0.8, 4.2, 0] }),
      part(box(0.14, 7.2, 0.14), inner, { p: [half - 0.8, 4.2, 0] }),
    ]),
  };
}

// 霓虹广告牌：一根杆子顶着一块亮板，板上几道色块
function billboard(panel: number, a: number, b: number): PropShape {
  return {
    lit: join([part(tube(0.14, 0.18, 6, 6), 0x3a3b5a, { p: [0, 3, 0] }), part(box(5.6, 3.2, 0.16), 0x24253a, { p: [0, 7.4, 0] })]),
    glow: join([
      part(box(5.2, 2.8, 0.06), panel, { p: [0, 7.4, 0.1] }),
      part(box(3.4, 0.5, 0.06), a, { p: [-0.6, 8, 0.14] }),
      part(box(2.2, 0.5, 0.06), b, { p: [0.9, 7.1, 0.14] }),
      part(blob(0.5, 0), a, { p: [-1.7, 6.9, 0.14], s: [1, 1, 0.1] }),
    ]),
  };
}

// 雪屋
function igloo(): PropShape {
  return {
    lit: join([
      part(blob(1, 1), 0xf2f8fd, { s: [2.3, 1.75, 2.3] }),
      part(tube(0.85, 0.85, 1.3, 8), 0xdfeaf4, { p: [0, 0.35, 2.2], r: [Math.PI / 2, 0, 0] }),
      part(tube(0.55, 0.55, 1.34, 8), 0x39445c, { p: [0, 0.3, 2.22], r: [Math.PI / 2, 0, 0] }),
    ]),
  };
}

// 冰晶：几根歪着的尖冰柱
function iceSpike(): PropShape {
  return {
    lit: join([
      part(cone(0.5, 2.6, 5), 0xbfe9ff, { p: [0, 1.3, 0] }),
      part(cone(0.36, 1.8, 5), 0xe6f8ff, { p: [0.55, 0.85, 0.2], r: [0, 0, -0.34] }),
      part(cone(0.3, 1.4, 5), 0x9fd6f2, { p: [-0.5, 0.65, -0.2], r: [0.2, 0, 0.4] }),
    ]),
  };
}

// 企鹅
function penguin(): PropShape {
  return {
    lit: join([
      part(blob(0.4, 1), 0x2b3044, { p: [0, 0.55, 0], s: [0.86, 1.3, 0.8] }),
      part(blob(0.32, 1), 0xfbfdff, { p: [0, 0.5, 0.13], s: [0.8, 1.25, 0.7] }),
      part(blob(0.25, 1), 0x2b3044, { p: [0, 1.18, 0] }),
      part(cone(0.07, 0.2, 4), 0xf2933a, { p: [0, 1.15, 0.28], r: [Math.PI / 2, 0, 0] }),
      part(box(0.1, 0.5, 0.26), 0x2b3044, { p: [0.37, 0.62, 0], r: [0, 0, 0.3] }),
      part(box(0.1, 0.5, 0.26), 0x2b3044, { p: [-0.37, 0.62, 0], r: [0, 0, -0.3] }),
      part(box(0.2, 0.06, 0.3), 0xf2933a, { p: [0.15, 0.03, 0.12] }),
      part(box(0.2, 0.06, 0.3), 0xf2933a, { p: [-0.15, 0.03, 0.12] }),
    ]),
  };
}

// 插在雪地里的小旗
function flag(cloth: number): PropShape {
  return {
    lit: join([
      part(tube(0.035, 0.045, 2.3, 5), 0xf2eef6, { p: [0, 1.15, 0] }),
      part(cone(0.34, 0.9, 3), cloth, { p: [0.45, 1.95, 0], r: [0, 0, -Math.PI / 2], s: [1, 1, 0.12] }),
    ]),
  };
}

// 摩天轮：撑脚不动，轮子慢慢转
function ferrisWheel(): PropShape {
  const radius = 9;
  const colors = [0xe5604a, 0xf2b93a, 0x4fb3a4, 0x6f8fe0, 0xf58fb2];
  const wheel: THREE.BufferGeometry[] = [
    part(new THREE.TorusGeometry(radius, 0.16, 5, 24), 0xfdf6ea),
    part(new THREE.TorusGeometry(radius * 0.52, 0.1, 4, 18), 0xfdf6ea),
    part(tube(0.5, 0.5, 0.9, 8), 0xe5604a, { r: [Math.PI / 2, 0, 0] }),
  ];
  for (let i = 0; i < 10; i += 1) {
    const angle = (i / 10) * Math.PI * 2;
    wheel.push(
      part(box(0.09, radius, 0.09), 0xfdf6ea, {
        p: [Math.cos(angle) * radius * 0.5, Math.sin(angle) * radius * 0.5, 0],
        r: [0, 0, angle - Math.PI / 2],
      }),
    );
    wheel.push(part(blob(0.78, 0), colors[i % colors.length], { p: [Math.cos(angle) * radius, Math.sin(angle) * radius, 0], s: [1, 0.9, 0.8] }));
  }
  return {
    lit: join([
      part(box(0.34, 13, 0.34), 0x8d8f9c, { p: [-3.1, 5.9, 0.7], r: [0, 0, -0.26] }),
      part(box(0.34, 13, 0.34), 0x8d8f9c, { p: [3.1, 5.9, 0.7], r: [0, 0, 0.26] }),
      part(box(0.34, 13, 0.34), 0x8d8f9c, { p: [-3.1, 5.9, -0.7], r: [0, 0, -0.26] }),
      part(box(0.34, 13, 0.34), 0x8d8f9c, { p: [3.1, 5.9, -0.7], r: [0, 0, 0.26] }),
      part(box(8, 0.5, 2.6), 0xe5604a, { p: [0, 0.25, 0] }),
    ]),
    spin: { part: join(wheel), layer: 'lit', pivot: [0, 11.5, 0], axis: 'z', speed: 0.22 },
  };
}

// 条纹大篷：圆筒的围布，尖顶，顶上一面小旗
function bigTop(a: number, b: number): PropShape {
  const wall = part(tube(3.3, 3.3, 2.6, 12), a, { p: [0, 1.3, 0] });
  stripes(wall, [a, b], 12);
  const roof = part(cone(3.9, 2.8, 12), a, { p: [0, 4, 0] });
  stripes(roof, [b, a], 12);
  return {
    lit: join([
      wall,
      roof,
      part(tube(0.04, 0.04, 1.5, 4), 0x5a4638, { p: [0, 6.1, 0] }),
      part(cone(0.3, 0.8, 3), 0xf2c14e, { p: [0.4, 6.55, 0], r: [0, 0, -Math.PI / 2], s: [1, 1, 0.12] }),
    ]),
  };
}

// 彩旗：两根杆子之间拉一串小旗，中间垂下来一点，整个跨在路上
function bunting(): PropShape {
  const half = ROAD_WIDTH / 2 + 1.5;
  const colors = [0xe5604a, 0xfdf6ea, 0xf2c14e, 0x4fb3a4, 0xf58fb2, 0x6f8fe0];
  const parts = [
    part(tube(0.07, 0.1, 7.2, 6), 0xfdf6ea, { p: [-half, 3.6, 0] }),
    part(tube(0.07, 0.1, 7.2, 6), 0xfdf6ea, { p: [half, 3.6, 0] }),
  ];
  const count = 17;
  for (let i = 0; i < count; i += 1) {
    const t = i / (count - 1);
    const sag = 1.3 * (1 - (2 * t - 1) ** 2);
    parts.push(
      part(cone(0.3, 0.66, 3), colors[i % colors.length], { p: [-half + t * half * 2, 6.75 - sag, 0], r: [Math.PI, 0, 0], s: [1, 1, 0.14] }),
    );
  }
  return { lit: join(parts) };
}

// 风筝：一片菱形，拖一串小尾巴
function kite(a: number, b: number): PropShape {
  const parts = [part(new THREE.OctahedronGeometry(1, 0), a, { r: [0.5, 0, 0.3], s: [1.1, 1.5, 0.06] })];
  for (let i = 0; i < 5; i += 1) {
    parts.push(part(box(0.3, 0.16, 0.04), i % 2 ? a : b, { p: [-0.5 - i * 0.42, -1.5 - i * 0.6, 0.6 + i * 0.25], r: [0, 0, 0.5] }));
  }
  return { lit: join(parts) };
}

const BUILDERS: Record<PropKind, () => PropShape> = {
  palm,
  treeGreen: () => tree(0x4f9f66, 0x62b274),
  treeCherry: () => tree(0xf6b4cb, 0xfbd0de, 0x6a4a44),
  treeAutumn: () => tree(0xe9953a, 0xf2b550),
  treeRed: () => tree(0xcf5a3c, 0xe07a48),
  pine: () => pine(false),
  pineSnow: () => pine(true),
  cactus,
  rock: () => rock(0x8d919c, 0xa3a7b0),
  rockSand: () => rock(0xcf9a6a, 0xdcae7e),
  rockSnow: () => rock(0x93a6ba, 0xf2f7fb),
  bush: () => bush(),
  bushDry: () => bush(0xb89a5e, 0xcdb478),
  bushSnow: () => bush(0xe6eef6, 0xf6fafe),
  flowerPink: () => flowers(0xf58fb2, 0xfde3ec),
  flowerYellow: () => flowers(0xf7cf4a, 0xfff3c2),
  flowerBlue: () => flowers(0x7fa8f2, 0xdfe9ff),
  lighthouse,
  windmill,
  balloonA: () => balloon([0xe5604a, 0xfdf3e0, 0x4fb3a4, 0xfdf3e0]),
  balloonB: () => balloon([0xf2b93a, 0xfdf3e0, 0x6f8fe0, 0xfdf3e0]),
  cloud: () => cloud(0xffffff, 0xe6f0f6),
  cloudWarm: () => cloud(0xfff4e6, 0xf6cfc0),
  cloudDark: () => cloud(0x6f7aa8, 0x4a5384),
  hut: () => house(0x7fd0d6, 0xfdf6ea, 0xe56a54, 0xfff0c2),
  cabin: () => house(0x9a6b4a, 0x5a4638, 0x6b4a36, 0xffdf9a),
  cabinSnow: () => house(0x8a5d4a, 0xf6fafe, 0x5a4638, 0xffdf9a),
  lamp,
  tower: () => tower(77, 7, 22, 0x3a3b5a, 0xff6fb5),
  towerSlim: () => tower(41, 4.6, 36, 0x34365a, 0x8ee6ff),
  towerWide: () => tower(19, 11, 15, 0x403c62, 0xffd98a),
  sailboat,
  parasol,
  mesa,
  snowman,
  aurora,
  hillGreen: () => hill(11, [0x6fb264, 0x7fbf6e, 0x8fca7a, 0xa4d68a]),
  hillPink: () => hill(12, [0x9cc88a, 0xb4d39c, 0xe8b6c8, 0xf6cbd9]),
  hillPine: () => hill(13, [0x356f50, 0x3f7f5c, 0x4a8d66, 0x5a9c72]),
  hillAutumn: () => hill(14, [0xb9853a, 0xc9953f, 0xd9a84c, 0xe8bc5c]),
  hillSnow: () => hill(15, [0xbcd2e4, 0xcfe0ee, 0xe2edf6, 0xf6fafe]),
  hillNight: () => hill(16, [0x2c2e50, 0x34365a, 0x3d3f66, 0x494b74]),
  dune: () => hill(17, [0xcf9452, 0xdca25e, 0xe6b06c, 0xf0c284]),
  mountain: () => mountain(21, [0x4f7a6c, 0x64877f, 0x7f9a96, 0xf0f5f4]),
  mountainWarm: () => mountain(22, [0x8f6048, 0xa9785c, 0xc0906c, 0xf2d8b4]),
  mountainSnow: () => mountain(23, [0x6f88a8, 0x8fa6c2, 0xb9cbe0, 0xfafcff]),
  ridgeGreen: () => ridge(31, [0x5fa25a, 0x6fb264, 0x82c074, 0x9ad088]),
  ridgePink: () => ridge(32, [0x8fbc80, 0xa4c890, 0xddb0c4, 0xf2c6d6]),
  ridgePine: () => ridge(33, [0x2c6048, 0x356f50, 0x40805c, 0x8fa8a0]),
  ridgeAutumn: () => ridge(34, [0xa87434, 0xbc8a3c, 0xcf9e48, 0xe2b65a]),
  ridgeSand: () => ridge(35, [0xb8683f, 0xc87a4c, 0xd99160, 0xecb47e]),
  ridgeSnow: () => ridge(36, [0x9ab4cc, 0xb6cbde, 0xd6e4f0, 0xf8fbfe]),
  groveGreen: () => cluster(41, 10, [[() => tree(0x4f9f66, 0x62b274, 0x7a5540, 0), 6], [() => bush(), 3]]),
  groveCherry: () => cluster(42, 10, [[() => tree(0xf6b4cb, 0xfbd0de, 0x6a4a44, 0), 6], [() => bush(), 2]]),
  groveAutumn: () => cluster(43, 10, [[() => tree(0xe9953a, 0xf2b550, 0x7a5540, 0), 4], [() => tree(0xcf5a3c, 0xe07a48, 0x7a5540, 0), 3]]),
  grovePine: () => cluster(44, 11, [[() => pine(false), 8]]),
  grovePineSnow: () => cluster(45, 11, [[() => pine(true), 7]]),
  hamlet: () =>
    cluster(46, 12, [
      [() => house(0xf6efe0, 0xc9573f, 0x7a5540, 0xffdf9a), 2],
      [() => house(0xe9d8b8, 0x6b7a8c, 0x7a5540, 0xffdf9a), 1],
      [() => tree(0x4f9f66, 0x62b274, 0x7a5540, 0), 3],
    ]),
  hamletSnow: () =>
    cluster(47, 12, [
      [() => house(0x8a5d4a, 0xf6fafe, 0x5a4638, 0xffdf9a), 3],
      [() => pine(true), 3],
    ]),
  seaStack,
  birds: () => birds(0x3a3d52),
  gulls: () => birds(0xfdfaf2),
  fenceWhite: () => fence(0xfdf6ea, 0xfdf6ea),
  fenceWood: () => fence(0x7a5540, 0x9a6b4a),
  grass: () => grass(0x5fae62, 0x7cc272),
  grassDry: () => grass(0xc9a24e, 0xdcb866),
  pole,
  surfboard,
  foam: () => foam(0xfdfdf6),
  foamNight: () => foam(0x8ea4d8),
  islet: () => islet(0xf1dcae),
  isletDusk: () => islet(0xd9a878),
  buoy,
  lighthouseLit,
  sailboatLit,
  torii,
  stoneLantern,
  logs,
  tent: () => tent(0xe8822e),
  mushroom,
  deer,
  hay,
  pumpkin,
  barn: () => house(0xb8402f, 0x6b3a34, 0xfdf6ea, 0xffdf9a),
  rockArch,
  flamingo,
  neonArchPink: () => neonArch(0xff6fb5, 0x8ee6ff),
  neonArchCyan: () => neonArch(0x6fe6ff, 0xffd98a),
  billboardA: () => billboard(0x2a1f4a, 0xff6fb5, 0x8ee6ff),
  billboardB: () => billboard(0x123a4a, 0xffd98a, 0xff8fc7),
  igloo,
  iceSpike,
  penguin,
  flagRed: () => flag(0xe5604a),
  flagBlue: () => flag(0x4f8fe0),
  ferrisWheel,
  bigTop: () => bigTop(0xe5604a, 0xfdf6ea),
  bigTopBlue: () => bigTop(0x4f8fe0, 0xfdf6ea),
  bunting,
  kite: () => kite(0xe5604a, 0xf2c14e),
  kiteBlue: () => kite(0x4fb3a4, 0xfdf6ea),
};

export function buildProp(kind: PropKind): PropShape {
  return BUILDERS[kind]();
}

// 场景交界处的门：两根柱子、一道横梁，梁下挂一排小旗
export function buildGate(width: number, finish: boolean): THREE.BufferGeometry {
  const half = width / 2 + 1.6;
  const parts = [
    part(box(0.55, 7, 0.55), 0xfdf6ea, { p: [-half, 3.5, 0] }),
    part(box(0.55, 7, 0.55), 0xfdf6ea, { p: [half, 3.5, 0] }),
    part(box(half * 2 + 1.4, 0.9, 0.6), finish ? 0x2b2d33 : 0xe56a54, { p: [0, 7.1, 0] }),
  ];
  const flags = finish ? [0xfdf6ea, 0x2b2d33] : [0xf2c14e, 0xfdf6ea, 0x4fb3a4, 0xfdf6ea];
  const count = 14;
  for (let i = 0; i < count; i += 1) {
    const x = -half + 0.9 + (i / (count - 1)) * (half * 2 - 1.8);
    if (finish) {
      // 终点门的横梁贴黑白格
      parts.push(part(box(0.62, 0.46, 0.64), flags[i % 2], { p: [x, 7.33, 0] }));
      parts.push(part(box(0.62, 0.46, 0.64), flags[(i + 1) % 2], { p: [x, 6.87, 0] }));
    } else {
      parts.push(part(cone(0.3, 0.7, 3), flags[i % flags.length], { p: [x, 6.25, 0], r: [Math.PI, 0, 0] }));
    }
  }
  return join(parts);
}

// 小鱼：身子是拉长的八面体，后面一片尾巴
export function buildFish(body: number, fin: number): THREE.BufferGeometry {
  return join([
    part(new THREE.OctahedronGeometry(0.34, 0), body, { s: [1.7, 1, 0.5] }),
    part(cone(0.24, 0.36, 3), fin, { p: [-0.68, 0, 0], r: [0, 0, -Math.PI / 2], s: [1, 1, 0.3] }),
    part(blob(0.05, 0), 0x2b2d33, { p: [0.3, 0.07, 0.11] }),
    part(blob(0.05, 0), 0x2b2d33, { p: [0.3, 0.07, -0.11] }),
  ]);
}

// 半空中的奖励圈：一个金色的大环套一个细白环，迎着来路立着
export function buildRing(): THREE.BufferGeometry {
  return join([
    part(new THREE.TorusGeometry(1.5, 0.11, 6, 22), 0xffd84a),
    part(new THREE.TorusGeometry(1.22, 0.04, 4, 22), 0xfff6d0),
  ]);
}

// 能量罐：一颗发蓝光的菱形，腰上一圈白
export function buildBolt(): THREE.BufferGeometry {
  return join([
    part(new THREE.OctahedronGeometry(0.36, 0), 0x4fc3ff, { s: [0.72, 1.3, 0.72] }),
    part(new THREE.TorusGeometry(0.34, 0.045, 4, 10), 0xf2fbff, { r: [Math.PI / 2, 0, 0] }),
  ]);
}

// 加速带：贴在路面上的一块深色底板，上面三道朝前的箭头
export function buildPad(length: number, width: number): THREE.BufferGeometry {
  const half = width / 2;
  const position: number[] = [];
  const color: number[] = [];
  // 四个角按 左后、右后、右前、左前 给，面才朝上
  const quad = (points: number[][], hex: number, y: number) => {
    const [a, b, c, d] = points;
    for (const [x, z] of [a, b, c, a, c, d]) position.push(x, y, z);
    tint.setHex(hex);
    for (let i = 0; i < 6; i += 1) color.push(tint.r, tint.g, tint.b);
  };
  quad([[-half, 0], [half, 0], [half, -length], [-half, -length]], 0x1d5f7a, 0.03);
  const arm = half * 0.82;
  const count = 3;
  for (let k = 0; k < count; k += 1) {
    const z = -(0.9 + k * ((length - 1.4) / count)) - 1.2;
    const hex = k % 2 === 0 ? 0x7fe9ff : 0xf2fbff;
    quad([[-arm, z + 1.9], [0, z + 0.7], [0, z], [-arm, z + 1.2]], hex, 0.05);
    quad([[0, z + 0.7], [arm, z + 1.9], [arm, z + 1.2], [0, z]], hex, 0.05);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(color, 3));
  geometry.computeVertexNormals();
  return geometry;
}

// 弹簧垫：深色的框，四角四根弹簧，上面一块黄色的蹦床面，中间一个粉色的圆
export function buildSpring(length: number, width: number): THREE.BufferGeometry {
  const z = -length / 2;
  const parts = [
    part(box(width, 0.1, length), 0x2b2d3a, { p: [0, 0.05, z] }),
    part(box(width - 0.3, 0.07, length - 0.3), 0xf2c14e, { p: [0, 0.34, z] }),
    part(tube(0.85, 0.85, 0.03, 14), 0xff6fa0, { p: [0, 0.39, z] }),
    part(tube(0.42, 0.42, 0.03, 14), 0xfdf6ea, { p: [0, 0.41, z] }),
  ];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      parts.push(part(tube(0.11, 0.11, 0.26, 6), 0xd9dcf0, { p: [sx * (width / 2 - 0.22), 0.21, z + sz * (length / 2 - 0.22)] }));
    }
  }
  return join(parts);
}

// 路障：两只脚撑着一块红白相间的横板，板上两盏小灯
export function buildObstacle(width: number): { lit: THREE.BufferGeometry; glow: THREE.BufferGeometry } {
  const parts: THREE.BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    parts.push(part(box(0.1, 1.05, 0.1), 0x4a4c5c, { p: [side * (width / 2 - 0.3), 0.52, 0.22], r: [0.38, 0, 0] }));
    parts.push(part(box(0.1, 1.05, 0.1), 0x4a4c5c, { p: [side * (width / 2 - 0.3), 0.52, -0.22], r: [-0.38, 0, 0] }));
  }
  const stripes = 8;
  for (let i = 0; i < stripes; i += 1) {
    const x = -width / 2 + (i + 0.5) * (width / stripes);
    parts.push(part(box(width / stripes, 0.34, 0.08), i % 2 ? 0xfdf6ea : 0xe5604a, { p: [x, 0.92, 0] }));
    parts.push(part(box(width / stripes, 0.2, 0.08), i % 2 ? 0xe5604a : 0xfdf6ea, { p: [x, 0.45, 0] }));
  }
  const lamps = [-1, 1].map((side) => part(blob(0.11, 0), 0xffc24a, { p: [side * (width / 2 - 0.3), 1.2, 0] }));
  return { lit: join(parts), glow: join(lamps) };
}

// 跳台：一块往前翘起来的坡板，侧面一道提示色
export function buildRamp(length: number, width: number, height: number): THREE.BufferGeometry {
  const steps = 6;
  const position: number[] = [];
  const half = width / 2;
  // 坡面按 u² 往上翘，和物理里用的高度公式一致
  const rise = (u: number) => height * u * u;
  for (let i = 0; i < steps; i += 1) {
    const u0 = i / steps;
    const u1 = (i + 1) / steps;
    const z0 = -u0 * length;
    const z1 = -u1 * length;
    const y0 = rise(u0);
    const y1 = rise(u1);
    position.push(-half, y0, z0, half, y0, z0, half, y1, z1, -half, y0, z0, half, y1, z1, -half, y1, z1);
    position.push(-half, 0, z0, -half, y0, z0, -half, y1, z1, -half, 0, z0, -half, y1, z1, -half, 0, z1);
    position.push(half, 0, z0, half, y1, z1, half, y0, z0, half, 0, z0, half, 0, z1, half, y1, z1);
  }
  position.push(-half, 0, -length, -half, height, -length, half, height, -length, -half, 0, -length, half, height, -length, half, 0, -length);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  const count = position.length / 3;
  const color = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    // 坡面一条深一条浅，侧面和背面用提示色
    const top = i < steps * 18 && i % 18 < 6;
    const stripe = Math.floor(i / 18) % 2 === 0;
    tint.setHex(top ? (stripe ? 0xfdf6ea : 0xf2c14e) : 0xe56a54);
    color[i * 3] = tint.r;
    color[i * 3 + 1] = tint.g;
    color[i * 3 + 2] = tint.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(color, 3));
  geometry.computeVertexNormals();
  return geometry;
}
