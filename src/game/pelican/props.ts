// 景物的造型：每一样都是几个简单几何体拼起来、按面上色，没有贴图和模型文件。
// 同一种景物全场景共用一份几何体，摆放交给 world.ts 的实例化网格

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ROAD_WIDTH } from './course';
import type { FishForm, PropKind, TokenKind } from './scenes';
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
  // axis 写 fall 的不是转，是一直往下滑（瀑布上的水纹）：speed 是每秒滑多少米，滑满 period 米跳回原位，造型要按这个周期重复
  spin?: { part: THREE.BufferGeometry; layer: 'lit' | 'beam' | 'flat'; pivot: [number, number, number]; axis: 'y' | 'z' | 'fall'; speed: number; period?: number };
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

// 云不受光照，自己是什么颜色就画什么颜色：受光的话，云底会被地面的反光染成草地的绿色。
// 用户嫌过早先那种三四团压扁的球「假」：现在是十来团大小不一的圆球挤成一朵，中间高两边低，
// 底下削平（真的积云底是平的），颜色按高度从云底的灰蓝慢慢过渡到顶上的白，看得出体积
function cloud(top: number, under: number): PropShape {
  const random = seeded(top % 9973);
  const puffs: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 11; i += 1) {
    const angle = random() * Math.PI * 2;
    const reach = Math.sqrt(random());
    const radius = 1.4 + random() * 1.6 + (1 - reach) * 1.6;
    puffs.push(part(blob(radius, 1), top, { p: [Math.cos(angle) * reach * 6.5, radius * 0.45 + (1 - reach) * 1.2, Math.sin(angle) * reach * 2.8] }));
  }
  const geometry = join(puffs);
  const position = geometry.getAttribute('position');
  const color = geometry.getAttribute('color');
  let highest = 0;
  for (let i = 0; i < position.count; i += 1) {
    // 低于云底的那一截压平
    if (position.getY(i) < 0) position.setY(i, position.getY(i) * 0.1);
    highest = Math.max(highest, position.getY(i));
  }
  const low = new THREE.Color(under);
  const high = new THREE.Color(top);
  for (let i = 0; i < position.count; i += 1) {
    const u = Math.min(1, Math.max(0, position.getY(i) / (highest * 0.7)));
    tint.copy(low).lerp(high, u * u * (3 - 2 * u));
    color.setXYZ(i, tint.r, tint.g, tint.b);
  }
  geometry.computeVertexNormals();
  return { flat: geometry };
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

// 一根礁石柱：一层一层的岩层往上收窄、每层错开一点，颜色深浅相间；贴着水的那一截被海水泡得发黑，顶上一片草皮
function stackColumn(x: number, z: number, layers: number, width: number, seed: number, grassy: boolean): THREE.BufferGeometry[] {
  const random = seeded(seed);
  const strata = [0x7f8490, 0x8d919c, 0x737885, 0x9a9ea8];
  const out: THREE.BufferGeometry[] = [part(roughen(tube(width * 1.05, width * 1.15, 1.2, 7), 0.12), 0x4b505b, { p: [x, 0.3, z] })];
  let y = 0.8;
  for (let k = 0; k < layers; k += 1) {
    const height = 1.6 + random() * 0.9;
    const radius = width * (1 - (k / layers) * 0.45);
    out.push(part(roughen(tube(radius * 0.9, radius, height, 7), 0.14), strata[k % strata.length], { p: [x + (random() - 0.5) * 0.5, y + height / 2, z + (random() - 0.5) * 0.5], r: [0, random() * 3, 0] }));
    y += height * 0.92;
  }
  if (grassy) {
    const top = width * 0.6;
    out.push(part(roughen(blob(1, 0), 0.3), 0x6fa86a, { p: [x, y + 0.1, z], s: [top * 1.1, 0.45, top * 1.1] }));
    out.push(part(blob(0.6, 0), 0x5a9a58, { p: [x + top * 0.4, y + 0.5, z + 0.2] }));
  }
  return out;
}

// 海里的礁石柱：一高一矮两根层层叠叠的石柱，高的顶上长着草，脚下散着几块圆石头，四周一圈白浪
function seaStack(): PropShape {
  return {
    lit: join([
      ...stackColumn(0, 0, 5, 3.4, 311, true),
      ...stackColumn(4.8, 1.8, 3, 2.1, 523, false),
      part(roughen(blob(1, 0), 0.4), 0x5d626e, { p: [-3.4, 0.4, -1.4], s: [1.8, 0.9, 1.4] }),
      part(roughen(blob(0.7, 0), 0.4), 0x6b707c, { p: [2.4, 0.3, -2.6], s: [1.4, 0.8, 1.2] }),
      part(new THREE.TorusGeometry(4.3, 0.45, 4, 18), 0xf2f7fa, { p: [1, 0.06, 0.4], r: [Math.PI / 2, 0, 0], s: [1.15, 0.8, 0.25] }),
    ]),
  };
}

// 岸边的一堆礁石：几块大小不一的圆石头挤在浅水里，下半截湿得发黑，石缝间一圈一圈的白浪
function shoreRocks(): PropShape {
  const random = seeded(887);
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 7; i += 1) {
    const angle = random() * Math.PI * 2;
    const reach = random() * 3.2;
    const size = 0.6 + random() * 1.1;
    const x = Math.cos(angle) * reach;
    const z = Math.sin(angle) * reach;
    parts.push(part(roughen(blob(size, 0), 0.35), i % 2 ? 0x8d919c : 0x7a7f8a, { p: [x, size * 0.35, z], s: [1.2, 0.8, 1], r: [0, random() * 3, 0] }));
    parts.push(part(roughen(blob(size * 1.05, 0), 0.3), 0x484d58, { p: [x, size * 0.05, z], s: [1.25, 0.32, 1.05] }));
  }
  parts.push(part(new THREE.TorusGeometry(3.6, 0.35, 4, 16), 0xf2f7fa, { p: [0, 0.05, 0], r: [Math.PI / 2, 0, 0], s: [1.2, 0.8, 0.25] }));
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

// 一簇水晶：底下一块石头，上面几根自己发光的晶柱
function crystal(a: number, b: number): PropShape {
  const shard = (x: number, z: number, h: number, r: number, tiltX: number, tiltZ: number, hex: number) =>
    part(new THREE.OctahedronGeometry(1, 0), hex, { p: [x, h * 0.42, z], r: [tiltX, 0, tiltZ], s: [r, h * 0.55, r] });
  return {
    lit: join([part(roughen(blob(0.7, 0), 0.3), 0x4a4664, { p: [0, 0.1, 0], s: [1.5, 0.5, 1.5] })]),
    glow: join([shard(0, 0, 2.6, 0.42, 0, 0, a), shard(0.6, 0.2, 1.7, 0.32, 0.1, -0.4, b), shard(-0.55, -0.15, 1.4, 0.3, -0.15, 0.45, b), shard(0.1, -0.6, 1.1, 0.26, -0.5, 0.1, a)]),
  };
}

// 会发光的蘑菇：一大两小
function shroomGlow(): PropShape {
  const stems: THREE.BufferGeometry[] = [];
  const caps: THREE.BufferGeometry[] = [];
  for (const [x, z, size] of [
    [0, 0, 1.5],
    [0.55, 0.3, 0.9],
    [-0.4, 0.35, 0.7],
  ]) {
    stems.push(part(tube(0.08, 0.12, 0.5, 6), 0xbfc8e6, { p: [x, 0.25 * size, z], s: size }));
    caps.push(part(blob(0.34, 0), 0x6fe8d0, { p: [x, 0.54 * size, z], s: [size, size * 0.55, size] }));
  }
  return { lit: join(stems), glow: join(caps) };
}

// 石笋：地上长出来的几根尖石头
function stalagmite(): PropShape {
  return {
    lit: join([
      part(roughen(cone(0.7, 3.4, 6), 0.12), 0x5a5676, { p: [0, 1.7, 0] }),
      part(roughen(cone(0.5, 2.2, 6), 0.12), 0x4c4868, { p: [0.8, 1.1, 0.3], r: [0, 0, -0.12] }),
      part(roughen(cone(0.42, 1.6, 5), 0.12), 0x656182, { p: [-0.7, 0.8, -0.2], r: [0.1, 0, 0.16] }),
    ]),
  };
}

// 洞顶在离路中线 x 米处有多高（和 world.ts 里搭洞顶用的是同一条弧线，按洞穴场景的崖壁算）
const caveRoof = (x: number) => 11 * (0.6 + 0.4 * Math.cos((x / 20) * (Math.PI / 2)));

// 钟乳石：从洞顶垂下来的一排，跨在路上。最低的尖离路面也有六米多
function stalactites(): PropShape {
  const random = seeded(733);
  const rocks: THREE.BufferGeometry[] = [];
  const tips: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 9; i += 1) {
    const x = -12 + i * 3 + (random() - 0.5) * 1.6;
    const z = (random() - 0.5) * 5;
    const length = 1.6 + random() * 2.2;
    const top = caveRoof(x) + 0.9;
    rocks.push(part(roughen(cone(0.3 + length * 0.12, length, 5), 0.12), i % 2 ? 0x4c4868 : 0x5a5676, { p: [x, top - length / 2, z], r: [Math.PI, 0, 0] }));
    // 有几根的尖上凝着一粒发光的水晶
    if (i % 3 === 1) tips.push(part(new THREE.OctahedronGeometry(0.22, 0), 0xb48cff, { p: [x, top - length - 0.1, z], s: [1, 1.5, 1] }));
  }
  return { lit: join(rocks), glow: join(tips) };
}

// 洞里的路灯：一根短杆挑着一盏暖色的灯笼
function caveLamp(): PropShape {
  return {
    lit: join([
      part(tube(0.07, 0.1, 3.2, 6), 0x2c2a44, { p: [0, 1.6, 0] }),
      part(box(0.08, 0.08, 1), 0x2c2a44, { p: [0, 3.15, 0.45] }),
      part(box(0.34, 0.08, 0.34), 0x2c2a44, { p: [0, 2.98, 0.9] }),
    ]),
    glow: join([part(tube(0.15, 0.12, 0.42, 6), 0xffd98a, { p: [0, 2.72, 0.9] })]),
  };
}

// 一串往下滑的白色水纹，接在瀑布上。columns 里每一项是一列：在哪、多长、一个周期里几条。
// 最顶上那一条整个藏在出水口的石头里，周期一到跳回原位时才看不出来
function streaks(columns: Array<[number, number, number, number]>, lip: number, period: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const [x, z, length, count] of columns) {
    for (let y = lip + length / 2 + 0.1; y > -period - length; y -= period / count) {
      parts.push(part(box(0.42, length, 0.12), 0xffffff, { p: [x, y, z] }));
    }
  }
  return join(parts);
}

// 挂在崖壁上的瀑布：按三十米高做的，摆的时候按崖壁的高度拉长。正面朝 +z
function waterfall(): PropShape {
  const tall = 30;
  return {
    lit: join([
      // 崖顶出水口的石台，水纹最顶上那一截藏在它里面
      part(roughen(box(9.5, 3.8, 7.6), 0.08), 0x6f7a72, { p: [0, tall + 1.5, -2.9] }),
      part(roughen(blob(1.7, 0), 0.3), 0x5f9a58, { p: [-3.4, tall + 3.5, -2] , s: [1.3, 0.6, 1.5] }),
      part(roughen(blob(1.5, 0), 0.3), 0x6fa86a, { p: [2.8, tall + 3.5, -3.4], s: [1.5, 0.6, 1.3] }),
      part(roughen(blob(1.6, 0), 0.3), 0x69776e, { p: [-4.4, 0.3, 0.8], s: [1, 0.9, 1.1] }),
      part(roughen(blob(1.3, 0), 0.3), 0x7d8a80, { p: [4.2, 0.2, 1.2] }),
    ]),
    flat: join([
      part(box(6, tall + 2, 0.5), 0xa9dcee, { p: [0, tall / 2 - 1, 0] }),
      // 落水的地方一团团白沫
      part(blob(2.2, 1), 0xf4fcff, { p: [0, 0.2, 1.6], s: [1.7, 0.45, 1.1] }),
      part(blob(1.4, 0), 0xffffff, { p: [-2.4, 0.3, 2.4], s: [1, 0.5, 1] }),
      part(blob(1.2, 0), 0xffffff, { p: [2.6, 0.2, 2.2], s: [1, 0.5, 1] }),
    ]),
    spin: {
      part: streaks(
        [
          [-2.4, 0, 2.4, 2],
          [-1.4, 0, 3.4, 1],
          [-0.5, 0, 2.2, 2],
          [0.5, 0, 3.2, 1],
          [1.4, 0, 2.6, 2],
          [2.4, 0, 3, 1],
        ],
        tall - 0.4,
        8,
      ),
      layer: 'flat',
      pivot: [0, 0, 0.32],
      axis: 'fall',
      speed: 9,
      period: 8,
    },
  };
}

// 跨在路上的石拱，拱顶两头各挂一道水帘，中间是一层薄薄的水雾：从瀑布底下穿过去
function fallArch(): PropShape {
  return {
    lit: join([
      part(roughen(tube(1.8, 2.5, 10.4, 6), 0.14), 0x6f7a72, { p: [-10.6, 5.2, 0] }),
      part(roughen(tube(1.7, 2.4, 10.2, 6), 0.14), 0x7d8a80, { p: [10.6, 5.1, 0.3] }),
      part(roughen(box(26.5, 3.6, 5), 0.07), 0x69776e, { p: [0, 11.3, 0] }),
      part(roughen(box(15, 1.4, 4), 0.1), 0x7d8a80, { p: [1, 13.6, 0.2] }),
      part(roughen(blob(1.8, 0), 0.3), 0x5f9a58, { p: [-6, 14.2, 0.4], s: [1.6, 0.5, 1.2] }),
      part(roughen(blob(1.5, 0), 0.3), 0x6fa86a, { p: [7, 13.5, -0.6], s: [1.6, 0.5, 1.2] }),
    ]),
    flat: join([
      part(box(2, 9.7, 0.36), 0xa9dcee, { p: [-7.9, 4.75, 0] }),
      part(box(2, 9.7, 0.36), 0xa9dcee, { p: [7.9, 4.75, 0] }),
      part(blob(1.3, 0), 0xffffff, { p: [-7.9, 0.1, 0], s: [1.2, 0.4, 1.4] }),
      part(blob(1.3, 0), 0xffffff, { p: [7.9, 0.1, 0], s: [1.2, 0.4, 1.4] }),
    ]),
    // 横在路上的那层水雾：很淡，叠在画面上
    beam: join([part(box(13.8, 9.5, 0.05), 0x35606e, { p: [0, 4.75, 0] })]),
    spin: {
      part: streaks(
        [
          [-8.5, 0.24, 1.8, 2],
          [-7.9, 0.24, 2.4, 1],
          [-7.3, 0.24, 1.6, 2],
          [7.3, 0.24, 2.2, 1],
          [7.9, 0.24, 1.7, 2],
          [8.5, 0.24, 2.5, 1],
          [-8.2, -0.24, 2.2, 1],
          [-7.5, -0.24, 1.8, 2],
          [7.5, -0.24, 2.4, 1],
          [8.2, -0.24, 1.6, 2],
        ],
        9.6,
        5,
      ),
      layer: 'flat',
      pivot: [0, 0, 0],
      axis: 'fall',
      speed: 8,
      period: 5,
    },
  };
}

// 吊桥：高高地横在峡谷两壁之间，中间往下坠一点
function ropeBridge(): PropShape {
  const parts: THREE.BufferGeometry[] = [];
  const reach = 27;
  const sag = (x: number) => 16 - 2.2 * (1 - (x / reach) ** 2);
  for (let x = -reach; x < reach; x += 1.8) {
    const mid = x + 0.9;
    const tilt = Math.atan2(sag(x + 1.8) - sag(x), 1.8);
    parts.push(part(box(1.5, 0.12, 1.7), Math.round(mid / 1.8) % 2 ? 0x9a6b4a : 0x8a5d40, { p: [mid, sag(mid), 0], r: [0, 0, tilt] }));
    for (const z of [-0.85, 0.85]) parts.push(part(box(1.86, 0.06, 0.06), 0xd9c7a0, { p: [mid, sag(mid) + 1, z], r: [0, 0, tilt] }));
    if (Math.round(mid / 1.8) % 3 === 0) for (const z of [-0.85, 0.85]) parts.push(part(box(0.05, 1, 0.05), 0xd9c7a0, { p: [mid, sag(mid) + 0.5, z] }));
  }
  for (const x of [-reach, reach]) for (const z of [-1, 1]) parts.push(part(tube(0.16, 0.2, 2.6, 6), 0x7a5540, { p: [x, sag(x) + 0.9, z] }));
  return { lit: join(parts) };
}

// 浮在水面上的几片莲叶，中间开一朵花
function lotus(): PropShape {
  const parts = [
    part(tube(0.95, 0.95, 0.05, 8), 0x4f9a62, { p: [0, 0.02, 0] }),
    part(tube(0.7, 0.7, 0.05, 8), 0x62ab70, { p: [1.4, 0.02, 0.6] }),
    part(tube(0.55, 0.55, 0.05, 7), 0x4f9a62, { p: [-0.9, 0.02, 1.2] }),
  ];
  for (let k = 0; k < 6; k += 1) {
    const angle = (k / 6) * Math.PI * 2;
    parts.push(part(cone(0.16, 0.5, 4), k % 2 ? 0xf7a8c8 : 0xfbd0de, { p: [Math.cos(angle) * 0.16, 0.26, Math.sin(angle) * 0.16], r: [Math.sin(angle) * 0.5, 0, -Math.cos(angle) * 0.5] }));
  }
  parts.push(part(blob(0.1, 0), 0xfde27a, { p: [0, 0.32, 0] }));
  return { lit: join(parts) };
}

// 挺出水面的一朵荷花：一根细茎顶着花，旁边两片立起来的荷叶
function lotusBloom(): PropShape {
  const parts = [
    part(tube(0.04, 0.05, 1.3, 5), 0x4f9a62, { p: [0, 0.65, 0] }),
    part(tube(0.04, 0.05, 0.9, 5), 0x4f9a62, { p: [0.7, 0.45, 0.3], r: [0, 0, -0.15] }),
    part(tube(0.8, 0.1, 0.12, 8), 0x62ab70, { p: [0.78, 0.92, 0.3], r: [0.2, 0, -0.25] }),
    part(tube(0.04, 0.05, 0.6, 5), 0x4f9a62, { p: [-0.6, 0.3, -0.4], r: [0, 0, 0.2] }),
    part(tube(0.62, 0.1, 0.1, 8), 0x4f9a62, { p: [-0.68, 0.62, -0.4], r: [-0.15, 0, 0.3] }),
    part(blob(0.12, 0), 0xfde27a, { p: [0, 1.36, 0] }),
  ];
  for (let ring = 0; ring < 2; ring += 1) {
    for (let k = 0; k < 6; k += 1) {
      const angle = (k / 6) * Math.PI * 2 + ring * 0.5;
      const lean = 0.45 + ring * 0.45;
      parts.push(part(cone(0.17, 0.6, 4), ring ? 0xf7a8c8 : 0xfbd0de, { p: [Math.cos(angle) * 0.2 * (1 + ring), 1.42 - ring * 0.08, Math.sin(angle) * 0.2 * (1 + ring)], r: [Math.sin(angle) * lean, 0, -Math.cos(angle) * lean] }));
    }
  }
  return { lit: join(parts) };
}

// 水边的一丛芦苇，几根顶上带着褐色的蒲棒
function reeds(): PropShape {
  const random = seeded(517);
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 9; i += 1) {
    const x = (random() - 0.5) * 1.8;
    const z = (random() - 0.5) * 1.8;
    const tall = 1.4 + random() * 1.4;
    const tilt = (random() - 0.5) * 0.3;
    parts.push(part(cone(0.07, tall, 4), i % 2 ? 0x6fa860 : 0x8cbc6e, { p: [x, tall / 2, z], r: [tilt, 0, tilt] }));
    if (i % 3 === 0) parts.push(part(tube(0.09, 0.09, 0.42, 6), 0x7a4a2a, { p: [x + tilt * 0.3, tall * 0.92, z] }));
  }
  return { lit: join(parts) };
}

// 站在浅水里的白鹭：细长腿，弯脖子，长嘴
function heron(): PropShape {
  const white = 0xfdfaf2;
  return {
    lit: join([
      part(tube(0.03, 0.03, 1, 4), 0x3a3d52, { p: [0.08, 0.5, 0] }),
      part(tube(0.03, 0.03, 1, 4), 0x3a3d52, { p: [-0.08, 0.5, 0.1] }),
      part(blob(0.34, 1), white, { p: [0, 1.2, 0.05], s: [0.7, 0.7, 1.25] }),
      part(cone(0.16, 0.5, 4), 0xe6e9ee, { p: [0, 1.16, 0.56], r: [1.3, 0, 0], s: [1, 1, 0.4] }),
      part(tube(0.06, 0.08, 0.6, 5), white, { p: [0, 1.6, -0.3], r: [-0.35, 0, 0] }),
      part(tube(0.055, 0.06, 0.4, 5), white, { p: [0, 1.96, -0.34], r: [0.3, 0, 0] }),
      part(blob(0.11, 0), white, { p: [0, 2.16, -0.36], s: [0.9, 0.9, 1.2] }),
      part(cone(0.04, 0.42, 4), 0xf2c14e, { p: [0, 2.14, -0.66], r: [-Math.PI / 2, 0, 0] }),
      part(cone(0.03, 0.26, 3), white, { p: [0, 2.24, -0.2], r: [1.1, 0, 0] }),
    ]),
  };
}

// 一条小木船，船头翘着，里面横着一支桨
function rowboat(): PropShape {
  return {
    lit: join([
      part(box(1.3, 0.34, 3.2), 0x9a6b4a, { p: [0, 0.2, 0] }),
      part(box(1.06, 0.2, 2.9), 0xc9a27a, { p: [0, 0.34, 0] }),
      part(cone(0.66, 1, 4), 0x9a6b4a, { p: [0, 0.22, -2.05], r: [-Math.PI / 2, Math.PI / 4, 0], s: [1, 1, 0.5] }),
      part(box(1.2, 0.07, 0.3), 0x7a5540, { p: [0, 0.42, 0.5] }),
      part(box(1.2, 0.07, 0.3), 0x7a5540, { p: [0, 0.42, -0.6] }),
      part(box(0.07, 0.07, 2.4), 0xd9c7a0, { p: [0.3, 0.5, 0], r: [0, 0.3, 0.1] }),
    ]),
  };
}

// 从水里跳出来的鱼：造型朝 +x，怎么跳在 world.ts 里算
function jumpFish(): PropShape {
  return {
    lit: join([
      part(new THREE.OctahedronGeometry(0.34, 0), 0x8fc4d8, { s: [1.9, 1, 0.5] }),
      part(new THREE.OctahedronGeometry(0.3, 0), 0xdff4ff, { p: [0.05, -0.1, 0], s: [1.6, 0.6, 0.42] }),
      part(cone(0.26, 0.4, 3), 0x6fa8c4, { p: [-0.76, 0, 0], r: [0, 0, -Math.PI / 2], s: [1, 1, 0.3] }),
      part(cone(0.12, 0.3, 3), 0x6fa8c4, { p: [0, 0.34, 0], s: [1, 1, 0.3] }),
      part(blob(0.05, 0), 0x2b2d33, { p: [0.36, 0.07, 0.12] }),
      part(blob(0.05, 0), 0x2b2d33, { p: [0.36, 0.07, -0.12] }),
    ]),
  };
}

// 成群飞的东西不走普通景物那一套：每只单独算位置，翅膀单独扇
export type FlockKind = 'birds' | 'gulls' | 'eagles' | 'bats';
const BIRDS: Record<FlockKind, { body: number; head: number; wing: number; tip: number; beak: number; tail: number; span: number; chord: number }> = {
  gulls: { body: 0xfdfaf2, head: 0xfdfaf2, wing: 0xdfe4ea, tip: 0x3a3d52, beak: 0xf2a23a, tail: 0xfdfaf2, span: 1, chord: 0.46 },
  birds: { body: 0x3a3d52, head: 0x3a3d52, wing: 0x4a4d64, tip: 0x2b2d3a, beak: 0xf2c14e, tail: 0x2b2d3a, span: 0.8, chord: 0.42 },
  eagles: { body: 0x5a4030, head: 0xfdf6ea, wing: 0x6b4c38, tip: 0x3a2a20, beak: 0xf2c14e, tail: 0xfdf6ea, span: 1.5, chord: 0.74 },
  bats: { body: 0x2a2440, head: 0x2a2440, wing: 0x3d3560, tip: 0x2a2440, beak: 0x2a2440, tail: 0x2a2440, span: 0.8, chord: 0.72 },
};

// 一只鸟：身子朝 -z；翅膀单独一块（这是右翅，根在原点、往 +x 伸，分三截往后掠），左翅是它的镜像
export function buildBird(kind: FlockKind): { body: THREE.BufferGeometry; wing: THREE.BufferGeometry } {
  const look = BIRDS[kind];
  const body = [
    gem(0.5, look.body, { s: [0.34, 0.3, 1.2] }),
    part(blob(0.17, 0), look.head, { p: [0, 0.07, -0.56] }),
    part(cone(0.06, 0.24, 4), look.beak, { p: [0, 0.05, -0.8], r: [-Math.PI / 2, 0, 0] }),
    gem(0.5, look.tail, { p: [0, 0.02, 0.66], s: [0.42, 0.05, 0.5] }),
  ];
  // 蝙蝠多两只尖耳朵
  if (kind === 'bats') for (const side of [-1, 1]) body.push(part(cone(0.06, 0.18, 3), look.body, { p: [side * 0.09, 0.22, -0.54] }));
  const span = look.span;
  const wing = [
    gem(0.5, look.wing, { p: [0.45 * span, 0, 0.02], s: [0.95 * span, 0.05, look.chord] }),
    gem(0.5, look.wing, { p: [1.05 * span, 0, 0.1], r: [0, -0.3, 0], s: [0.9 * span, 0.045, look.chord * 0.8] }),
    gem(0.5, look.tip, { p: [1.5 * span, 0, 0.24], r: [0, -0.5, 0], s: [0.5 * span, 0.04, look.chord * 0.5] }),
  ];
  return { body: join(body), wing: join(wing) };
}

// 洞里的一汪发光的水：一圈碎石围着一片青色的水面，边上冒出几根小水晶
function crystalPool(): PropShape {
  const rim: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 9; k += 1) {
    const angle = (k / 9) * Math.PI * 2;
    rim.push(part(roughen(blob(0.42, 0), 0.25), k % 2 ? 0x4c4868 : 0x5a5676, { p: [Math.cos(angle) * 2, 0.12, Math.sin(angle) * 1.5], s: [1.2, 0.6, 1] }));
  }
  return {
    lit: join(rim),
    glow: join([
      part(tube(1.9, 1.9, 0.04, 14), 0x5fe0e8, { p: [0, 0.06, 0], s: [1, 1, 0.78] }),
      part(new THREE.OctahedronGeometry(1, 0), 0xb48cff, { p: [1.6, 0.6, 0.6], s: [0.22, 0.7, 0.22], r: [0, 0, -0.3] }),
      part(new THREE.OctahedronGeometry(1, 0), 0x8fd8ff, { p: [-1.7, 0.45, -0.4], s: [0.18, 0.5, 0.18], r: [0.2, 0, 0.35] }),
    ]),
  };
}

// 洞里的矿车：一截短铁轨上停着一辆木头矿车，车斗里堆着发光的矿石
function mineCart(): PropShape {
  const lit = [
    part(box(0.1, 0.08, 4), 0x6a6f80, { p: [-0.55, 0.04, 0] }),
    part(box(0.1, 0.08, 4), 0x6a6f80, { p: [0.55, 0.04, 0] }),
    part(box(1.5, 0.75, 1.9), 0x7a5a3a, { p: [0, 0.75, 0] }),
    part(box(1.6, 0.1, 2), 0x4a3a2a, { p: [0, 1.15, 0] }),
  ];
  for (let k = -2; k <= 2; k += 1) lit.push(part(box(1.5, 0.06, 0.24), 0x5a4632, { p: [0, 0.02, k * 0.8] }));
  for (const x of [-0.6, 0.6]) for (const z of [-0.6, 0.6]) lit.push(part(tube(0.2, 0.2, 0.12, 8), 0x3a3d52, { p: [x, 0.24, z], r: [0, 0, Math.PI / 2] }));
  return {
    lit: join(lit),
    glow: join([
      part(new THREE.OctahedronGeometry(0.3, 0), 0xb48cff, { p: [-0.3, 1.3, 0.3] }),
      part(new THREE.OctahedronGeometry(0.26, 0), 0x8fd8ff, { p: [0.3, 1.28, -0.2] }),
      part(new THREE.OctahedronGeometry(0.22, 0), 0xffd98a, { p: [0.1, 1.36, 0.5] }),
    ]),
  };
}

// 水面上漂着的一盏河灯：木头小托盘上一只暖色的纸灯笼
function lanternFloat(): PropShape {
  return {
    lit: join([part(box(0.9, 0.12, 0.9), 0x6a4a32, { p: [0, 0.06, 0] })]),
    glow: join([part(tube(0.3, 0.26, 0.6, 6), 0xffc46a, { p: [0, 0.45, 0] }), part(cone(0.32, 0.22, 6), 0xff8a4a, { p: [0, 0.86, 0] })]),
  };
}

// 霓虹灯牌：一根杆子挑着三块竖着的发光牌子，颜色各不一样
function neonSign(): PropShape {
  return {
    lit: join([part(tube(0.12, 0.16, 7, 6), 0x3a3b5a, { p: [0, 3.5, 0] }), part(box(1.3, 5, 0.3), 0x24253a, { p: [0, 6.6, 0] })]),
    glow: join([
      part(box(1, 1.3, 0.06), 0xff5fa8, { p: [0, 8.2, 0.18] }),
      part(box(1, 1.3, 0.06), 0x5fe8ff, { p: [0, 6.7, 0.18] }),
      part(box(1, 1.3, 0.06), 0xffd84a, { p: [0, 5.2, 0.18] }),
      part(box(1.4, 0.1, 0.1), 0xff5fa8, { p: [0, 9.1, 0.16] }),
    ]),
  };
}

// 夜市小推车：车身、四个轮子、一顶条纹棚子，棚子底下挂一排小灯泡
function foodCart(): PropShape {
  const lit = [
    part(box(2.6, 1.1, 1.4), 0xe5604a, { p: [0, 0.95, 0] }),
    part(box(2.8, 0.1, 1.6), 0xfdf6ea, { p: [0, 1.55, 0] }),
    part(tube(0.05, 0.05, 1.4, 5), 0xdcdce6, { p: [-1.25, 2.25, 0.65] }),
    part(tube(0.05, 0.05, 1.4, 5), 0xdcdce6, { p: [1.25, 2.25, 0.65] }),
  ];
  for (let k = 0; k < 6; k += 1) {
    lit.push(part(box(0.5, 0.1, 1.8), k % 2 ? 0xfdf6ea : 0x4fb3a4, { p: [-1.25 + k * 0.5, 3, 0.1], r: [0.18, 0, 0] }));
  }
  for (const x of [-0.9, 0.9]) lit.push(part(tube(0.28, 0.28, 0.14, 8), 0x2b2d3a, { p: [x, 0.3, 0.72], r: [Math.PI / 2, 0, 0] }));
  const bulbs: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 6; k += 1) bulbs.push(part(blob(0.09, 0), k % 2 ? 0xffd98a : 0xff8fb8, { p: [-1.2 + k * 0.48, 2.78, 0.95] }));
  return { lit: join(lit), glow: join(bulbs) };
}

// 樱花树下的野餐：一块红白格子的布、一只藤编篮子、一个保温壶
function picnic(): PropShape {
  const lit: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 4; i += 1) {
    for (let j = 0; j < 4; j += 1) lit.push(part(box(0.6, 0.03, 0.6), (i + j) % 2 ? 0xfdf6ea : 0xe5604a, { p: [-0.9 + i * 0.6, 0.02, -0.9 + j * 0.6] }));
  }
  lit.push(
    part(box(0.7, 0.42, 0.5), 0xc49a5a, { p: [0.4, 0.24, -0.2] }),
    part(new THREE.TorusGeometry(0.28, 0.04, 4, 10, Math.PI), 0xa07a42, { p: [0.4, 0.45, -0.2] }),
    part(tube(0.12, 0.12, 0.42, 7), 0x4fb3a4, { p: [-0.5, 0.23, 0.4] }),
    part(tube(0.13, 0.13, 0.08, 7), 0xfdf6ea, { p: [-0.5, 0.48, 0.4] }),
  );
  return { lit: join(lit) };
}

// 三层的小塔：石台基、三层越来越小的屋檐、顶上一根相轮
function pagoda(): PropShape {
  const lit = [part(box(5, 0.8, 5), 0x9a9ca8, { p: [0, 0.4, 0] })];
  let y = 0.8;
  for (let k = 0; k < 3; k += 1) {
    const w = 3.4 - k * 0.7;
    const h = 2 - k * 0.3;
    lit.push(part(box(w, h, w), 0xfdf3e6, { p: [0, y + h / 2, 0] }));
    lit.push(part(box(w * 0.18, h * 0.6, w + 0.04), 0xd9453a, { p: [0, y + h / 2, 0] }));
    lit.push(part(cone(w * 0.95, 1, 4), 0x3a3d52, { p: [0, y + h + 0.45, 0], r: [0, Math.PI / 4, 0] }));
    y += h + 0.75;
  }
  lit.push(part(tube(0.08, 0.08, 2, 6), 0xc9a24a, { p: [0, y + 1, 0] }));
  for (let k = 0; k < 4; k += 1) lit.push(part(tube(0.2, 0.2, 0.06, 8), 0xc9a24a, { p: [0, y + 0.4 + k * 0.4, 0] }));
  return { lit: join(lit) };
}

// 沙漠里的土坯房：方方的一间，屋顶伸出几根木椽，门口一盏暖色的窗
function adobe(): PropShape {
  const lit = [
    part(box(5, 3, 4), 0xd9a06a, { p: [0, 1.5, 0] }),
    part(box(3, 1.6, 2.8), 0xcf9560, { p: [1.2, 3.8, -0.4] }),
    part(box(1, 1.9, 0.12), 0x6a4a32, { p: [-1.2, 0.95, 2.02] }),
  ];
  for (let k = 0; k < 4; k += 1) lit.push(part(tube(0.09, 0.09, 0.9, 5), 0x7a5a3a, { p: [-2 + k * 1.3, 2.7, 2.3], r: [Math.PI / 2, 0, 0] }));
  return {
    lit: join(lit),
    glow: join([part(box(0.9, 0.8, 0.08), 0xffd08a, { p: [1, 1.7, 2.02] }), part(box(0.7, 0.6, 0.08), 0xffd08a, { p: [1.2, 3.9, 1.02] })]),
  };
}

const BUILDERS: Record<Exclude<PropKind, FlockKind>, () => PropShape> = {
  crystalPool,
  mineCart,
  lanternFloat,
  neonSign,
  foodCart,
  picnic,
  pagoda,
  adobe,
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
  shoreRocks,
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
  crystal: () => crystal(0xb48cff, 0xd0b4ff),
  crystalBlue: () => crystal(0x7fd8ff, 0xb4ecff),
  shroomGlow: () => shroomGlow(),
  stalagmite: () => stalagmite(),
  stalactites: () => stalactites(),
  caveLamp: () => caveLamp(),
  lotusBloom: () => lotusBloom(),
  reeds: () => reeds(),
  heron: () => heron(),
  rowboat: () => rowboat(),
  jumpFish: () => jumpFish(),
  waterfall: () => waterfall(),
  fallArch: () => fallArch(),
  ropeBridge: () => ropeBridge(),
  lotus: () => lotus(),
};

export function buildProp(kind: Exclude<PropKind, FlockKind>): PropShape {
  return BUILDERS[kind]();
}

// 场景交界处的门（用户要「每个场景的龙门架都要有不同的主题和建模」）：进哪个场景，门就是那个场景的样子。
// 每种门是两根柱子、一道横梁加各自的装饰，全是简单几何体按面上色；发光的部分（灯笼、霓虹、水晶、火把）单独一份，用发光材质
export type GateTheme =
  | 'driftwood'
  | 'flowers'
  | 'sakura'
  | 'log'
  | 'harvest'
  | 'adobe'
  | 'tiki'
  | 'harbor'
  | 'neon'
  | 'ice'
  | 'prayer'
  | 'balloons'
  | 'stone'
  | 'bamboo'
  | 'crystal'
  | 'pailou'
  | 'finish';

type Pieces = { lit: THREE.BufferGeometry[]; glow: THREE.BufferGeometry[] };

// 从左柱顶到右柱顶垂下来的一根绳上等距挂 count 个东西：make 拿到每个的位置和序号
function hang(half: number, top: number, sag: number, count: number, make: (x: number, y: number, i: number) => THREE.BufferGeometry[]): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  for (let i = 0; i < count; i += 1) {
    const u = (i + 0.5) / count;
    const x = -half + u * half * 2;
    out.push(...make(x, top - sag * 4 * u * (1 - u), i));
  }
  return out;
}

// 一道从左柱顶到右柱顶的拱：沿着半个椭圆等距摆 count 个东西
function arch(half: number, base: number, rise: number, count: number, make: (x: number, y: number, angle: number, i: number) => THREE.BufferGeometry[]): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  for (let i = 0; i <= count; i += 1) {
    const angle = (i / count) * Math.PI;
    out.push(...make(-Math.cos(angle) * half, base + Math.sin(angle) * rise, angle, i));
  }
  return out;
}

// 一根竹子：一节一节的，节上一圈深一点的箍
function bamboo(x: number, height: number, radius: number, hex: number, joint: number, z = 0): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  const segments = Math.round(height / 1.1);
  for (let k = 0; k < segments; k += 1) {
    const y = (k + 0.5) * (height / segments);
    out.push(part(tube(radius, radius, height / segments - 0.04, 7), hex, { p: [x, y, z] }));
    out.push(part(tube(radius + 0.03, radius + 0.03, 0.08, 7), joint, { p: [x, (k + 1) * (height / segments), z] }));
  }
  return out;
}

const GATE_STYLES: Record<Exclude<GateTheme, 'finish'>, (half: number) => Pieces> = {
  // 海滨：两根歪歪的浮木，横一根浮木，绳上挂一串贝壳，柱脚靠着两块冲浪板
  driftwood: (half) => ({
    lit: [
      ...[-1, 1].map((side) => part(roughen(tube(0.26, 0.36, 7.4, 6), 0.06), 0xc9b49a, { p: [side * half, 3.6, 0], r: [0, 0, -side * 0.06] })),
      part(roughen(tube(0.25, 0.25, half * 2 + 1.8, 6), 0.06), 0xb89f84, { p: [0, 7.15, 0], r: [0, 0, Math.PI / 2] }),
      ...hang(half - 0.4, 6.9, 0.9, 11, (x, y, i) => [
        part(blob(0.2, 0), i % 2 ? 0xffd9c2 : 0xfdf6ea, { p: [x, y - 0.25, 0], s: [1, 1.1, 0.4] }),
        part(box(0.03, 0.35, 0.03), 0x8a6a4a, { p: [x, y, 0] }),
      ]),
      part(blob(1, 1), 0x4fb3a4, { p: [-half - 1, 1.6, 0.4], r: [0, 0.3, 0.22], s: [0.45, 1.7, 0.1] }),
      part(blob(1, 1), 0xe56a54, { p: [half + 1, 1.5, -0.3], r: [0, -0.4, -0.2], s: [0.42, 1.6, 0.1] }),
    ],
    glow: [],
  }),
  // 花田：白色的格栅柱子，顶上一道开满花的拱
  flowers: (half) => ({
    lit: [
      ...[-1, 1].flatMap((side) => [
        part(box(0.42, 6.4, 0.42), 0xfdfaf2, { p: [side * half, 3.2, 0] }),
        ...[1.2, 2.6, 4, 5.4].map((y) => part(box(0.9, 0.08, 0.5), 0xfdfaf2, { p: [side * half, y, 0] })),
        ...[1.6, 3.4, 5].map((y) => part(blob(0.32, 0), 0x6fb064, { p: [side * (half + 0.15), y, 0.2] })),
      ]),
      ...arch(half, 6.2, 2.2, 16, (x, y, _, i) => [
        part(blob(0.62, 0), 0x5f9e58, { p: [x, y, -0.15], s: [1, 0.9, 0.8] }),
        part(blob(0.36, 0), [0xf58fb2, 0xf2c14e, 0xfdf6ea, 0xe5604a][i % 4], { p: [x, y + 0.15, 0.32] }),
      ]),
    ],
    glow: [],
  }),
  // 樱花：深红漆的柱子，两道横梁，上面那道两头翘起来，梁上压着一团团樱花
  sakura: (half) => ({
    lit: [
      ...[-1, 1].flatMap((side) => [
        part(tube(0.3, 0.36, 7.2, 8), 0xb8352c, { p: [side * half, 3.6, 0] }),
        part(box(0.8, 0.4, 0.8), 0x3a3d52, { p: [side * half, 0.2, 0] }),
        part(box(1.6, 0.28, 0.7), 0x2f2f3a, { p: [side * (half + 1.3), 7.75, 0], r: [0, 0, side * 0.28] }),
      ]),
      part(box(half * 2 + 1, 0.35, 0.45), 0xb8352c, { p: [0, 6.3, 0] }),
      part(box(half * 2 + 1.8, 0.45, 0.7), 0x2f2f3a, { p: [0, 7.55, 0] }),
      ...Array.from({ length: 9 }, (_, i) => part(blob(0.75, 0), i % 2 ? 0xf7b8cc : 0xfbd0de, { p: [-half + (i / 8) * half * 2, 8.1 + (i % 3) * 0.2, (i % 2) * 0.3 - 0.15], s: [1.2, 0.8, 1] })),
    ],
    glow: [],
  }),
  // 松林：两根粗原木，顶上横一根原木，梁下用两根绳挂一块木牌，柱顶各戴一棵小松树
  log: (half) => ({
    lit: [
      ...[-1, 1].flatMap((side) => [
        part(tube(0.45, 0.5, 7.2, 8), 0x7a5540, { p: [side * half, 3.6, 0] }),
        part(tube(0.47, 0.47, 0.06, 8), 0xc9a27a, { p: [side * half, 7.22, 0] }),
        part(cone(0.9, 1.9, 7), 0x2f6a46, { p: [side * half, 8.6, 0] }),
        part(cone(0.65, 1.3, 7), 0x3d7c52, { p: [side * half, 9.5, 0] }),
        part(box(0.04, 1.1, 0.04), 0x5a4638, { p: [side * 1.6, 6.3, 0] }),
      ]),
      part(tube(0.4, 0.4, half * 2 + 1.6, 8), 0x8a6248, { p: [0, 7.2, 0], r: [0, 0, Math.PI / 2] }),
      part(box(4, 1.1, 0.16), 0xd9b27a, { p: [0, 5.4, 0] }),
      part(box(3.6, 0.12, 0.18), 0x7a5540, { p: [0, 5.85, 0] }),
      part(box(3.6, 0.12, 0.18), 0x7a5540, { p: [0, 4.95, 0] }),
    ],
    glow: [],
  }),
  // 秋日：木头柱子，柱顶各蹲一只南瓜，柱脚堆着干草捆，横梁下挂一串红黄橙的枫叶
  harvest: (half) => ({
    lit: [
      ...[-1, 1].flatMap((side) => [
        part(box(0.5, 6.8, 0.5), 0x8a5d40, { p: [side * half, 3.4, 0] }),
        part(blob(0.62, 1), 0xe8822a, { p: [side * half, 7.6, 0], s: [1.2, 0.85, 1.2] }),
        part(tube(0.07, 0.09, 0.4, 5), 0x5a7a3a, { p: [side * half, 8.25, 0] }),
        part(box(1.6, 0.9, 1.1), 0xe2c26a, { p: [side * (half + 0.9), 0.45, 0.4] }),
        part(box(1.2, 0.8, 1), 0xd8b45a, { p: [side * (half + 0.6), 1.3, 0.5] }),
      ]),
      part(box(half * 2 + 1.4, 0.55, 0.55), 0x7a5540, { p: [0, 6.9, 0] }),
      ...hang(half - 0.3, 6.6, 1.1, 14, (x, y, i) => [part(new THREE.OctahedronGeometry(0.28, 0), [0xe5604a, 0xf2a23a, 0xf2c14e][i % 3], { p: [x, y - 0.2, 0], s: [1, 1.3, 0.25], r: [0, 0, i * 0.7] })]),
    ],
    glow: [],
  }),
  // 沙漠：两根粗粗的土坯柱子，顶上一道土坯的拱，柱脚各长一棵仙人掌
  adobe: (half) => ({
    lit: [
      ...[-1, 1].flatMap((side) => [
        part(box(1.3, 6, 1.3), 0xd9a06a, { p: [side * half, 3, 0] }),
        part(box(1.6, 0.4, 1.6), 0xc48a58, { p: [side * half, 6.1, 0] }),
        part(tube(0.28, 0.32, 2.6, 7), 0x5a9a4a, { p: [side * (half + 1.9), 1.3, 0.6] }),
        part(tube(0.18, 0.18, 1, 6), 0x5a9a4a, { p: [side * (half + 2.35), 1.8, 0.6], r: [0, 0, side * 0.9] }),
      ]),
      ...arch(half, 6.1, 2, 14, (x, y, angle) => [part(box(1.25, 0.9, 1.2), 0xcf9560, { p: [x, y, 0], r: [0, 0, angle - Math.PI / 2] })]),
    ],
    glow: [],
  }),
  // 棕榈：竹竿搭的门，顶上一道茅草檐，两边各插一支烧着的火把
  tiki: (half) => ({
    lit: [
      ...[-1, 1].flatMap((side) => [
        ...bamboo(side * half, 7, 0.24, 0xc9a86a, 0x8a6a3a),
        part(tube(0.07, 0.09, 3, 5), 0x6a4a2a, { p: [side * (half + 1.5), 1.5, 0.5] }),
        part(tube(0.18, 0.12, 0.4, 6), 0x3a2a1a, { p: [side * (half + 1.5), 3.1, 0.5] }),
      ]),
      ...bamboo(0, half * 2 + 1.6, 0.22, 0xc9a86a, 0x8a6a3a).map((piece) => piece.rotateZ(Math.PI / 2).translate(half + 0.8, 7, 0)),
      part(cone(1.6, 1.4, 4), 0xd8b46a, { p: [0, 7.9, 0], r: [0, Math.PI / 4, 0], s: [half * 0.92, 1, 0.6] }),
    ],
    glow: [-1, 1].map((side) => part(cone(0.22, 0.6, 6), 0xffa040, { p: [side * (half + 1.5), 3.6, 0.5] })),
  }),
  // 夜海：深色的木桩，柱脚盘着缆绳，梁下挂一排暖色的船灯，正中挂一只锚
  harbor: (half) => ({
    lit: [
      ...[-1, 1].flatMap((side) => [
        part(tube(0.38, 0.42, 7.2, 8), 0x4a3a30, { p: [side * half, 3.6, 0] }),
        part(new THREE.TorusGeometry(0.5, 0.12, 5, 10), 0xd9c8a0, { p: [side * half, 1.2, 0], r: [Math.PI / 2, 0, 0] }),
        part(new THREE.TorusGeometry(0.5, 0.12, 5, 10), 0xd9c8a0, { p: [side * half, 1.45, 0], r: [Math.PI / 2, 0, 0] }),
      ]),
      part(box(half * 2 + 1.4, 0.5, 0.5), 0x3a2e28, { p: [0, 7.1, 0] }),
      part(new THREE.TorusGeometry(0.7, 0.12, 5, 12, Math.PI), 0x8d919c, { p: [0, 5.3, 0], r: [0, 0, Math.PI] }),
      part(box(0.18, 1.6, 0.18), 0x8d919c, { p: [0, 5.9, 0] }),
      part(box(0.9, 0.14, 0.18), 0x8d919c, { p: [0, 6.4, 0] }),
      ...hang(half - 0.6, 6.85, 0.5, 6, (x, y) => [part(box(0.04, 0.5, 0.04), 0x2a2a30, { p: [x, y - 0.1, 0] })]),
    ],
    glow: hang(half - 0.6, 6.85, 0.5, 6, (x, y) => [part(tube(0.18, 0.18, 0.4, 6), 0xffd08a, { p: [x, y - 0.55, 0] })]),
  }),
  // 霓虹：两层发光的灯管框，外层粉、内层青，柱脚一截深色的底座
  neon: (half) => ({
    lit: [-1, 1].map((side) => part(box(0.8, 0.6, 0.8), 0x24253a, { p: [side * half, 0.3, 0] })),
    glow: [
      ...[-1, 1].flatMap((side) => [
        part(box(0.16, 7, 0.16), 0xff5fa8, { p: [side * half, 3.8, 0] }),
        part(box(0.12, 5.8, 0.12), 0x5fe8ff, { p: [side * (half - 0.7), 3.6, 0] }),
      ]),
      part(box(half * 2 + 0.16, 0.16, 0.16), 0xff5fa8, { p: [0, 7.3, 0] }),
      part(box(half * 2 - 1.4, 0.12, 0.12), 0x5fe8ff, { p: [0, 6.5, 0] }),
      ...Array.from({ length: 5 }, (_, i) => part(box(0.5, 0.5, 0.08), [0xffd84a, 0xff5fa8, 0x5fe8ff][i % 3], { p: [-2.4 + i * 1.2, 7.9, 0] })),
    ],
  }),
  // 极光雪原：冰砖垒的柱子和拱，顶上几块发着光的冰晶
  ice: (half) => ({
    lit: [
      ...[-1, 1].flatMap((side) => Array.from({ length: 6 }, (_, k) => part(box(1.2, 1.05, 1.1), k % 2 ? 0xcfeaf6 : 0xbfe0f0, { p: [side * half + (k % 2 ? 0.08 : -0.08), 0.52 + k * 1.05, 0] }))),
      ...arch(half, 6.3, 1.8, 12, (x, y, angle, i) => [part(box(1.15, 0.85, 1.1), i % 2 ? 0xcfeaf6 : 0xbfe0f0, { p: [x, y, 0], r: [0, 0, angle - Math.PI / 2] })]),
    ],
    glow: [
      part(new THREE.OctahedronGeometry(0.55, 0), 0x8fe8ff, { p: [0, 8.8, 0], s: [0.7, 1.4, 0.7] }),
      ...[-1, 1].map((side) => part(new THREE.OctahedronGeometry(0.4, 0), 0xb4f0ff, { p: [side * half, 7.1, 0], s: [0.7, 1.4, 0.7] })),
    ],
  }),
  // 雪山黎明：顶着雪的石柱，柱顶之间拉一串五色经幡
  prayer: (half) => ({
    lit: [
      ...[-1, 1].flatMap((side) => [
        part(roughen(box(1, 7, 1), 0.05), 0x8d8f9c, { p: [side * half, 3.5, 0] }),
        part(blob(0.75, 0), 0xf4f6fa, { p: [side * half, 7.1, 0], s: [1, 0.5, 1] }),
        part(tube(0.05, 0.05, 2.4, 5), 0x6a4a3a, { p: [side * half, 8.4, 0] }),
      ]),
      ...hang(half, 9.4, 1.8, 18, (x, y, i) => [part(cone(0.35, 0.6, 3), [0x4f8fe0, 0xfdfaf2, 0xe5604a, 0x55b86a, 0xf2c14e][i % 5], { p: [x, y - 0.32, 0], r: [Math.PI, 0, 0], s: [1, 1, 0.2] })]),
    ],
    glow: [],
  }),
  // 气球之丘：两根柱子和一道拱全是一串串彩色气球
  balloons: (half) => {
    const colors = [0xe5604a, 0xf2c14e, 0x4fb3a4, 0x6f8fe0, 0xf58fb2, 0xfdf6ea];
    return {
      lit: [
        ...[-1, 1].flatMap((side) =>
          Array.from({ length: 10 }, (_, k) => part(blob(0.5, 1), colors[(k + (side > 0 ? 3 : 0)) % colors.length], { p: [side * half + Math.sin(k * 2.1) * 0.25, 0.5 + k * 0.62, Math.cos(k * 2.1) * 0.25], s: [1, 1.12, 1] })),
        ),
        ...arch(half, 6.6, 2.3, 18, (x, y, _, i) => [
          part(blob(0.52, 1), colors[i % colors.length], { p: [x, y, 0.18], s: [1, 1.12, 1] }),
          part(blob(0.45, 1), colors[(i + 2) % colors.length], { p: [x, y - 0.1, -0.3], s: [1, 1.12, 1] }),
        ]),
      ],
      glow: [],
    };
  },
  // 高山峡谷：两根粗粗的石柱、一块压顶的大石条，石头上长着青苔，梁下挂两盏石灯
  stone: (half) => ({
    lit: [
      ...[-1, 1].flatMap((side) => [
        part(roughen(box(1.7, 7, 1.7), 0.08), 0x8f8a80, { p: [side * half, 3.5, 0] }),
        part(roughen(blob(0.9, 0), 0.2), 0x6fa25e, { p: [side * half, 7.15, 0], s: [1.3, 0.35, 1.3] }),
        part(box(0.06, 0.8, 0.06), 0x3a3a40, { p: [side * 3, 6.3, 0] }),
      ]),
      part(roughen(box(half * 2 + 3, 1.2, 2), 0.06), 0x9a948a, { p: [0, 7.5, 0] }),
      part(roughen(blob(1, 0), 0.25), 0x6fa25e, { p: [0, 8.15, 0], s: [half * 0.9, 0.25, 1.2] }),
    ],
    glow: [-1, 1].map((side) => part(box(0.5, 0.6, 0.5), 0xffd98a, { p: [side * 3, 5.7, 0] })),
  }),
  // 溪谷飞瀑：青竹搭的门，横梁上缠着绿叶，下面挂三盏粉色的荷花灯
  bamboo: (half) => ({
    lit: [
      ...[-1, 1].flatMap((side) => [...bamboo(side * half, 7, 0.22, 0x6fae5a, 0x4f8a42), ...bamboo(side * (half + 0.55), 6, 0.17, 0x7fbe68, 0x4f8a42)]),
      ...bamboo(0, half * 2 + 1.6, 0.2, 0x6fae5a, 0x4f8a42).map((piece) => piece.rotateZ(Math.PI / 2).translate(half + 0.8, 6.9, 0)),
      ...Array.from({ length: 10 }, (_, i) => part(new THREE.OctahedronGeometry(0.35, 0), i % 2 ? 0x5f9e58 : 0x7fbe68, { p: [-half + (i / 9) * half * 2, 7.15, 0.15], s: [1.4, 0.5, 0.8], r: [0, i, 0.4] })),
      ...[-2.6, 0, 2.6].map((x) => part(box(0.04, 0.9, 0.04), 0x3a5a2a, { p: [x, 6.3, 0] })),
    ],
    glow: [-2.6, 0, 2.6].flatMap((x) => [
      ...[0, 1, 2, 3, 4].map((k) => part(new THREE.OctahedronGeometry(0.28, 0), 0xffa8c8, { p: [x + Math.cos(k * 1.26) * 0.2, 5.75, Math.sin(k * 1.26) * 0.2], r: [0, k * 1.26, 0.6], s: [0.6, 1.2, 0.6] })),
      part(blob(0.16, 0), 0xffe9a0, { p: [x, 5.8, 0] }),
    ]),
  }),
  // 水晶洞穴：深色的岩柱，柱上和顶上的拱长满发光的紫色、青色水晶
  crystal: (half) => ({
    lit: [
      ...[-1, 1].map((side) => part(roughen(tube(0.9, 1.2, 7, 6), 0.12), 0x4a4664, { p: [side * half, 3.5, 0] })),
      ...arch(half, 6.6, 1.6, 10, (x, y) => [part(roughen(blob(0.8, 0), 0.25), 0x544f72, { p: [x, y, 0] })]),
    ],
    glow: [
      ...[-1, 1].flatMap((side) =>
        [1.2, 2.8, 4.6, 6].map((y, k) => part(new THREE.OctahedronGeometry(0.4, 0), k % 2 ? 0x8fd8ff : 0xb48cff, { p: [side * (half + 0.8), y, (k % 2) * 0.4 - 0.2], r: [0, 0, side * 0.6], s: [0.6, 1.6, 0.6] })),
      ),
      ...arch(half, 7.4, 1.6, 8, (x, y, _, i) => [part(new THREE.OctahedronGeometry(0.45, 0), i % 2 ? 0x8fd8ff : 0xb48cff, { p: [x, y + 0.3, 0], s: [0.6, 1.8, 0.6] })]),
    ],
  }),
  // 云海断桥：一座牌楼——白石底座上的朱红柱子，青绿琉璃瓦的屋顶两头翘起，正中一块金匾
  pailou: (half) => ({
    lit: [
      ...[-1, 1].flatMap((side) => [
        part(box(1.2, 0.8, 1.2), 0xeeeae2, { p: [side * half, 0.4, 0] }),
        part(tube(0.34, 0.38, 7, 8), 0xc0392b, { p: [side * half, 4.2, 0] }),
        part(box(1.8, 0.3, 0.6), 0x2f6f6a, { p: [side * (half + 0.6), 8.55, 0], r: [0, 0, side * 0.3] }),
      ]),
      part(box(half * 2 + 0.8, 0.5, 0.5), 0xc0392b, { p: [0, 6.6, 0] }),
      part(box(half * 2 + 0.6, 0.7, 0.6), 0x2a8a7a, { p: [0, 7.35, 0] }),
      part(cone(1.7, 1.3, 4), 0x2f6f6a, { p: [0, 8.3, 0], r: [0, Math.PI / 4, 0], s: [half * 0.95, 1, 0.7] }),
      part(box(2.8, 1, 0.2), 0x2b2d33, { p: [0, 5.7, 0.05] }),
    ],
    glow: [part(box(2.4, 0.7, 0.08), 0xf2c14e, { p: [0, 5.7, 0.16] })],
  }),
};

// 终点门：黑白格的横梁
function finishGate(half: number): Pieces {
  const parts = [part(box(0.55, 7, 0.55), 0xfdf6ea, { p: [-half, 3.5, 0] }), part(box(0.55, 7, 0.55), 0xfdf6ea, { p: [half, 3.5, 0] }), part(box(half * 2 + 1.4, 0.9, 0.6), 0x2b2d33, { p: [0, 7.1, 0] })];
  const count = 14;
  for (let i = 0; i < count; i += 1) {
    const x = -half + 0.9 + (i / (count - 1)) * (half * 2 - 1.8);
    parts.push(part(box(0.62, 0.46, 0.64), i % 2 ? 0x2b2d33 : 0xfdf6ea, { p: [x, 7.33, 0] }));
    parts.push(part(box(0.62, 0.46, 0.64), i % 2 ? 0xfdf6ea : 0x2b2d33, { p: [x, 6.87, 0] }));
  }
  return { lit: parts, glow: [] };
}

export function buildGate(width: number, theme: GateTheme): { lit: THREE.BufferGeometry; glow: THREE.BufferGeometry | null } {
  const half = width / 2 + 1.6;
  const pieces = theme === 'finish' ? finishGate(half) : GATE_STYLES[theme](half);
  return { lit: join(pieces.lit), glow: pieces.glow.length ? join(pieces.glow) : null };
}

// 一圈花瓣（或者一把扇骨）立在竖着的平面里：鱼和纪念品都是绕竖轴转的，转起来像一枚硬币。
// angles 是每一瓣朝哪个方向（弧度）
function petals(angles: number[], hex: number, length: number, width: number): THREE.BufferGeometry[] {
  return angles.map((angle) =>
    part(new THREE.OctahedronGeometry(0.5, 0), hex, {
      p: [Math.cos(angle) * length * 0.5, Math.sin(angle) * length * 0.5, 0],
      r: [0, 0, angle],
      s: [length, width, 0.16],
    }),
  );
}

const around = (count: number, turn = 0) => Array.from({ length: count }, (_, i) => (i / count) * Math.PI * 2 + turn);
const fan = (count: number, from: number, to: number) => Array.from({ length: count }, (_, i) => from + ((to - from) * i) / (count - 1));
const disc = (radius: number, hex: number) => part(blob(radius, 0), hex, { s: [1, 1, 0.5] });
const gem = (radius: number, hex: number, place: { p?: [number, number, number]; r?: [number, number, number]; s?: [number, number, number] | number } = {}) =>
  part(new THREE.OctahedronGeometry(radius, 0), hex, place);

const TOKENS: Record<TokenKind, () => THREE.BufferGeometry[]> = {
  shell: () => [...petals(fan(5, 0.5, Math.PI - 0.5), 0xffd9c2, 0.6, 0.3), ...petals(fan(4, 0.76, Math.PI - 0.76), 0xff9f8a, 0.52, 0.14), part(blob(0.16, 0), 0xfff2e0, { p: [0, -0.02, 0] })],
  sunflower: () => [...petals(around(10), 0xf7c93a, 0.46, 0.2), disc(0.2, 0x7a4a24)],
  blossom: () => [...petals(around(5, Math.PI / 2), 0xf9a8c4, 0.42, 0.34), disc(0.11, 0xfde27a)],
  pinecone: () => [
    part(cone(0.3, 0.36, 6), 0x8a5d40, { p: [0, -0.2, 0] }),
    part(cone(0.26, 0.34, 6), 0x9a6b4a, { p: [0, 0, 0] }),
    part(cone(0.2, 0.32, 6), 0xa9785c, { p: [0, 0.2, 0] }),
    part(cone(0.12, 0.26, 6), 0xb98a66, { p: [0, 0.38, 0] }),
  ],
  maple: () => [...petals(fan(5, 0.2, Math.PI - 0.2), 0xe5632e, 0.54, 0.26), part(box(0.05, 0.34, 0.05), 0x9a4a24, { p: [0, -0.18, 0] }), disc(0.14, 0xf2933a)],
  turquoise: () => [gem(0.4, 0x3fd0c0, { s: [0.9, 1.2, 0.9] }), part(new THREE.TorusGeometry(0.42, 0.05, 4, 12), 0xffd84a, { r: [Math.PI / 2, 0, 0] })],
  coconut: () => [
    part(blob(0.36, 1), 0x9a6b4a),
    part(blob(0.06, 0), 0x3a2a20, { p: [0.1, 0.2, 0.26] }),
    part(blob(0.06, 0), 0x3a2a20, { p: [-0.1, 0.2, 0.26] }),
    part(blob(0.06, 0), 0x3a2a20, { p: [0, 0.06, 0.33] }),
    ...petals(fan(3, 0.6, Math.PI - 0.6), 0x4fae5a, 0.4, 0.14).map((leaf) => leaf.translate(0, 0.3, 0)),
  ],
  starfish: () => [...petals(around(5, Math.PI / 2), 0xff8a5c, 0.52, 0.22), disc(0.17, 0xffb07c)],
  note: () => [
    part(blob(0.2, 0), 0xff6fb5, { p: [-0.12, -0.3, 0], s: [1.25, 0.9, 0.6] }),
    part(box(0.07, 0.72, 0.07), 0xff6fb5, { p: [0.1, 0.04, 0] }),
    part(box(0.3, 0.14, 0.07), 0x8ee6ff, { p: [0.24, 0.33, 0], r: [0, 0, -0.35] }),
  ],
  snowflake: () => [...petals(around(6), 0xdff4ff, 0.52, 0.1), ...petals(around(6, Math.PI / 6), 0xffffff, 0.3, 0.08), disc(0.09, 0xffffff)],
  icegem: () => [gem(0.4, 0xa8e4ff, { s: [0.7, 1.4, 0.7] }), gem(0.22, 0xe6f8ff, { p: [0.3, -0.26, 0], r: [0, 0, -0.5], s: [0.7, 1.3, 0.7] }), gem(0.2, 0xcfeeff, { p: [-0.28, -0.3, 0], r: [0, 0, 0.5], s: [0.7, 1.2, 0.7] })],
  balloon: () => [
    part(blob(0.34, 1), 0xff6f61, { p: [0, 0.16, 0], s: [1, 1.2, 1] }),
    part(cone(0.07, 0.1, 4), 0xff6f61, { p: [0, -0.28, 0] }),
    part(box(0.03, 0.34, 0.03), 0xfdf6ea, { p: [0, -0.5, 0] }),
  ],
  feather: () => [
    gem(0.5, 0xa9744a, { p: [0.04, 0.1, 0], r: [0, 0, -0.3], s: [0.42, 1.4, 0.14] }),
    gem(0.5, 0xfdf6ea, { p: [-0.1, 0.5, 0], r: [0, 0, -0.3], s: [0.26, 0.5, 0.14] }),
    part(box(0.04, 0.5, 0.04), 0xfdf6ea, { p: [0.22, -0.5, 0], r: [0, 0, -0.3] }),
  ],
  lotus: () => [...petals(around(8, Math.PI / 8), 0xf7a8c8, 0.46, 0.2), ...petals(around(8), 0xfbd0de, 0.3, 0.16), disc(0.12, 0xfde27a)],
  cloud: () => [
    part(blob(0.3, 1), 0xffffff, { p: [0, 0.06, 0] }),
    part(blob(0.22, 1), 0xeef6ff, { p: [-0.3, -0.03, 0] }),
    part(blob(0.24, 1), 0xeef6ff, { p: [0.3, -0.03, 0] }),
    part(blob(0.18, 1), 0xdcecff, { p: [0.12, 0.26, 0] }),
  ],
  crystal: () => [gem(0.4, 0xb48cff, { s: [0.62, 1.5, 0.62] }), gem(0.26, 0xd0b4ff, { p: [0.3, -0.24, 0], r: [0, 0, -0.55], s: [0.6, 1.3, 0.6] }), gem(0.24, 0x9a78f0, { p: [-0.28, -0.28, 0], r: [0, 0, 0.5], s: [0.6, 1.2, 0.6] })],
};

// 场景自己的纪念品：每种只有巴掌大，自己发光，远远就看得见
export function buildToken(kind: TokenKind): THREE.BufferGeometry {
  return join(TOKENS[kind]());
}

// 辣椒：弯弯的一根红的，顶上一截绿蒂。吃了一小段时间里冲刺条不掉
export function buildChili(): THREE.BufferGeometry {
  return join([
    part(tube(0.17, 0.2, 0.3, 6), 0xff4a3a, { p: [0, 0.22, 0] }),
    part(tube(0.2, 0.15, 0.32, 6), 0xff4a3a, { p: [0.03, -0.06, 0], r: [0, 0, 0.18] }),
    part(tube(0.15, 0.08, 0.3, 6), 0xf23a2e, { p: [0.12, -0.32, 0], r: [0, 0, 0.5] }),
    part(cone(0.08, 0.24, 6), 0xe0322a, { p: [0.27, -0.52, 0], r: [0, 0, 0.85 + Math.PI] }),
    part(tube(0.05, 0.1, 0.2, 5), 0x4fae5a, { p: [-0.03, 0.46, 0], r: [0, 0, 0.3] }),
    part(new THREE.TorusGeometry(0.17, 0.04, 4, 8), 0x62c26a, { p: [0, 0.37, 0], r: [Math.PI / 2, 0, 0] }),
  ]);
}

// 磁铁：一块红色的马蹄铁，两只脚尖是银白色的，中间夹着两道小闪光
export function buildMagnet(): THREE.BufferGeometry {
  return join([
    part(new THREE.TorusGeometry(0.34, 0.12, 6, 12, Math.PI), 0xe5604a, { p: [0, 0.12, 0] }),
    part(box(0.24, 0.32, 0.24), 0xe5604a, { p: [-0.34, -0.04, 0] }),
    part(box(0.24, 0.32, 0.24), 0xe5604a, { p: [0.34, -0.04, 0] }),
    part(box(0.25, 0.16, 0.25), 0xeef2fa, { p: [-0.34, -0.28, 0] }),
    part(box(0.25, 0.16, 0.25), 0xeef2fa, { p: [0.34, -0.28, 0] }),
    part(box(0.05, 0.22, 0.05), 0xffe27a, { p: [-0.12, -0.42, 0], r: [0, 0, 0.5] }),
    part(box(0.05, 0.22, 0.05), 0xffe27a, { p: [0.12, -0.42, 0], r: [0, 0, -0.5] }),
  ]);
}

// 火箭（超级加速，用户要的「持续时间短」的那种）：白色的身子、红色的尖头、三片青色的尾翼，屁股后面一团黄火
export function buildRocket(): THREE.BufferGeometry {
  const parts = [
    part(tube(0.17, 0.17, 0.62, 8), 0xf6f8ff, { p: [0, 0.05, 0] }),
    part(cone(0.17, 0.32, 8), 0xe5604a, { p: [0, 0.52, 0] }),
    part(tube(0.18, 0.18, 0.06, 8), 0x4fc3ff, { p: [0, 0.2, 0] }),
    part(cone(0.13, 0.34, 6), 0xffc24a, { p: [0, -0.42, 0], r: [Math.PI, 0, 0] }),
  ];
  for (let k = 0; k < 3; k += 1) {
    const angle = (k / 3) * Math.PI * 2;
    parts.push(part(box(0.04, 0.3, 0.22), 0x4fc3ff, { p: [Math.cos(angle) * 0.2, -0.18, Math.sin(angle) * 0.2], r: [0, -angle, 0] }));
  }
  // 斜着摆，像正往前上方飞
  return join(parts.map((geometry) => geometry.rotateZ(-0.5)));
}

// 小鱼：头朝 +x，后面一片尾巴。每个场景的鱼样子不一样（用户要求）：普通的、圆滚滚的、细长的、又高又扁的
export function buildFish(body: number, fin: number, form: FishForm = 'plain'): THREE.BufferGeometry {
  const eye = (x: number, y: number, z: number) => [part(blob(0.05, 0), 0x2b2d33, { p: [x, y, z] }), part(blob(0.05, 0), 0x2b2d33, { p: [x, y, -z] })];
  const tail = (x: number, size = 1) => part(cone(0.24 * size, 0.36 * size, 3), fin, { p: [x, 0, 0], r: [0, 0, -Math.PI / 2], s: [1, 1, 0.3] });
  if (form === 'round') {
    // 圆滚滚的：一个球，背上一片小鳍，两边各一片小胸鳍
    return join([
      part(blob(0.36, 1), body, { s: [1.2, 1.1, 0.8] }),
      tail(-0.54, 0.9),
      part(cone(0.14, 0.24, 3), fin, { p: [-0.04, 0.42, 0], s: [1, 1, 0.3] }),
      part(cone(0.1, 0.2, 3), fin, { p: [0.06, -0.12, 0.3], r: [1.2, 0, 0], s: [1, 1, 0.3] }),
      part(cone(0.1, 0.2, 3), fin, { p: [0.06, -0.12, -0.3], r: [-1.2, 0, 0], s: [1, 1, 0.3] }),
      ...eye(0.3, 0.1, 0.2),
    ]);
  }
  if (form === 'long') {
    // 细长的：身子拉得很长，背上腹下各一片小鳍
    return join([
      part(new THREE.OctahedronGeometry(0.34, 0), body, { s: [2.4, 0.66, 0.46] }),
      tail(-0.9, 0.85),
      part(cone(0.1, 0.2, 3), fin, { p: [-0.1, 0.24, 0], s: [1, 1, 0.3] }),
      part(cone(0.08, 0.16, 3), fin, { p: [-0.2, -0.22, 0], r: [0, 0, Math.PI], s: [1, 1, 0.3] }),
      ...eye(0.5, 0.05, 0.1),
    ]);
  }
  if (form === 'tall') {
    // 又高又扁的：身子是立着的菱形，背鳍和腹鳍都拖得很长
    return join([
      part(new THREE.OctahedronGeometry(0.34, 0), body, { s: [1.3, 1.4, 0.4] }),
      tail(-0.56, 0.9),
      part(cone(0.14, 0.5, 3), fin, { p: [-0.12, 0.52, 0], r: [0, 0, 0.5], s: [1, 1, 0.3] }),
      part(cone(0.14, 0.5, 3), fin, { p: [-0.12, -0.52, 0], r: [0, 0, Math.PI - 0.5], s: [1, 1, 0.3] }),
      ...eye(0.24, 0.08, 0.1),
    ]);
  }
  return join([part(new THREE.OctahedronGeometry(0.34, 0), body, { s: [1.7, 1, 0.5] }), tail(-0.68), ...eye(0.3, 0.07, 0.11)]);
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

// 斜弹簧：一块前头翘起来的弹板，底下两根粗弹簧顶着，板面上三道朝前的箭头。压上去往前上方弹出去
export function buildLauncher(length: number, width: number): THREE.BufferGeometry {
  const z = -length / 2;
  const tilt = 0.4;
  const parts = [
    part(box(width, 0.1, length), 0x2b2d3a, { p: [0, 0.05, z] }),
    part(box(width - 0.3, 0.09, length), 0x4fc3ff, { p: [0, 0.78, z], r: [tilt, 0, 0] }),
    part(box(width - 0.9, 0.05, length - 0.5), 0xfdf6ea, { p: [0, 0.83, z], r: [tilt, 0, 0] }),
  ];
  // 箭头：每道是两根斜杠拼的尖角，尖朝前
  for (let k = 0; k < 3; k += 1) {
    const along = -0.9 + k * 0.9;
    for (const side of [-1, 1]) {
      parts.push(part(box(0.9, 0.05, 0.22), 0xff6fa0, { p: [side * 0.34, 0.87 - along * Math.sin(tilt), z + along * Math.cos(tilt)], r: [tilt, side * 0.7, 0] }));
    }
  }
  for (const sx of [-1, 1]) {
    parts.push(part(tube(0.16, 0.16, 1.25, 7), 0xd9dcf0, { p: [sx * (width / 2 - 0.3), 0.72, z - length / 2 + 0.35] }));
    parts.push(part(tube(0.12, 0.12, 0.3, 6), 0xd9dcf0, { p: [sx * (width / 2 - 0.3), 0.2, z + length / 2 - 0.3] }));
    for (let ring = 0; ring < 4; ring += 1) {
      parts.push(part(tube(0.24, 0.24, 0.06, 8), 0x8d91a8, { p: [sx * (width / 2 - 0.3), 0.3 + ring * 0.28, z - length / 2 + 0.35] }));
    }
  }
  return join(parts);
}

// 断路前的警示门：崖边两根红白相间的杆子，顶上横一条黄黑相间的板，板上两盏黄灯。
// 从车后面看过去，崖边把后面的深沟整个挡住了，不立这个根本看不出前面路断了
export function buildWarning(width: number): THREE.BufferGeometry {
  const reach = width / 2 + 1.1;
  const parts: THREE.BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    for (let k = 0; k < 9; k += 1) {
      parts.push(part(tube(0.16, 0.16, 0.6, 8), k % 2 ? 0xfdf6ea : 0xe5604a, { p: [side * reach, 0.3 + k * 0.6, 0] }));
    }
    parts.push(part(blob(0.26, 0), 0xffc24a, { p: [side * reach, 5.75, 0] }));
  }
  const stripes = 14;
  for (let i = 0; i < stripes; i += 1) {
    const x = -reach + ((i + 0.5) * 2 * reach) / stripes;
    parts.push(part(box((2 * reach) / stripes, 0.8, 0.14), i % 2 ? 0x2b2d3a : 0xf2c14e, { p: [x, 5, 0] }));
  }
  return join(parts);
}

// 高跳弹簧：横着铺满整条路的一长条蹦床，橙色的面上一排朝前的白箭头，底下一排粗弹簧，两头各立一根红白相间的杆子。
// 压上去被弹上前面那道台阶
export function buildBooster(length: number, width: number): THREE.BufferGeometry {
  const z = -length / 2;
  const parts = [
    part(box(width, 0.12, length), 0x2b2d3a, { p: [0, 0.06, z] }),
    part(box(width - 0.3, 0.1, length - 0.2), 0xff8a3c, { p: [0, 0.5, z] }),
    part(box(width - 0.3, 0.04, 0.22), 0xfdf6ea, { p: [0, 0.56, z + length / 2 - 0.3] }),
    part(box(width - 0.3, 0.04, 0.22), 0xfdf6ea, { p: [0, 0.56, z - length / 2 + 0.3] }),
  ];
  const count = Math.max(3, Math.round(width / 2.4));
  for (let i = 0; i < count; i += 1) {
    const x = -width / 2 + ((i + 0.5) * width) / count;
    // 箭头：两根斜杠拼的尖角，尖朝前，前后两道
    for (const side of [-1, 1]) {
      parts.push(part(box(0.75, 0.04, 0.2), 0xfdf6ea, { p: [x + side * 0.26, 0.57, z - 0.15], r: [0, side * 0.75, 0] }));
      parts.push(part(box(0.75, 0.04, 0.2), 0xfdf6ea, { p: [x + side * 0.26, 0.57, z + 0.65], r: [0, side * 0.75, 0] }));
    }
    for (const sz of [-1, 1]) {
      parts.push(part(tube(0.15, 0.15, 0.36, 7), 0xd9dcf0, { p: [x, 0.29, z + sz * (length / 2 - 0.4)] }));
    }
  }
  for (const side of [-1, 1]) {
    for (let k = 0; k < 5; k += 1) {
      parts.push(part(tube(0.13, 0.13, 0.5, 8), k % 2 ? 0xfdf6ea : 0xe5604a, { p: [side * (width / 2 + 0.35), 0.25 + k * 0.5, z] }));
    }
    parts.push(part(blob(0.2, 0), 0xffc24a, { p: [side * (width / 2 + 0.35), 2.7, z] }));
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
// 三档的坡面条纹和侧面各一种颜色，远远就认得出哪个高：矮的青绿、中的琥珀、高的朱红
const RAMP_TINT = [
  [0x58bfa8, 0x2f8f7c],
  [0xf2c14e, 0xe08a2a],
  [0xf08a6a, 0xd24a36],
] as const;

export function buildRamp(length: number, width: number, height: number, grade = 1): THREE.BufferGeometry {
  const steps = 6;
  const [band, wall] = RAMP_TINT[grade] ?? RAMP_TINT[1];
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
    tint.setHex(top ? (stripe ? 0xfdf6ea : band) : wall);
    color[i * 3] = tint.r;
    color[i * 3 + 1] = tint.g;
    color[i * 3 + 2] = tint.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(color, 3));
  geometry.computeVertexNormals();
  return geometry;
}
