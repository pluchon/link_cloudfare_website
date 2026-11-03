import * as THREE from 'three';

// 绕黑洞的开普勒轨道：探测器和空间站都按这个走。
// 盘面是 XZ 平面（法线 +y），轨道先在盘面里按近心点幅角转，再按倾角翻起来，最后按升交点经度转。
// 运动方向和吸积盘一致（顺行）。时间尺度是为了好看压过的：最内侧 13 Rs 的轨道一圈 60 秒，
// 其他轨道按开普勒第三定律 T ∝ a^1.5 跟着算，所以外圈明显更慢

export interface Orbit {
  // 半长轴（Rs）
  a: number;
  // 偏心率
  e: number;
  // 倾角、升交点经度、近心点幅角（度）
  inc: number;
  node: number;
  peri: number;
  // t = 0 时的平近点角（弧度）
  m0: number;
}

const REF_A = 13;
const REF_PERIOD = 60;
const GM = Math.pow((2 * Math.PI) / REF_PERIOD, 2) * Math.pow(REF_A, 3);

const Y = new THREE.Vector3(0, 1, 0);
const X = new THREE.Vector3(1, 0, 0);
const deg = THREE.MathUtils.degToRad;

export function orbitFrame(o: Orbit): THREE.Quaternion {
  return new THREE.Quaternion()
    .setFromAxisAngle(Y, deg(o.node))
    .multiply(new THREE.Quaternion().setFromAxisAngle(X, deg(o.inc)))
    .multiply(new THREE.Quaternion().setFromAxisAngle(Y, deg(o.peri)));
}

// 偏近点角 E 对应的轨道平面内坐标（近心点在 +x），再转到世界坐标
function place(o: Orbit, frame: THREE.Quaternion, E: number, out: THREE.Vector3): THREE.Vector3 {
  const x = o.a * (Math.cos(E) - o.e);
  const y = o.a * Math.sqrt(1 - o.e * o.e) * Math.sin(E);
  return out.set(x, 0, -y).applyQuaternion(frame);
}

// 由时间解开普勒方程 M = E - e·sinE（牛顿迭代，偏心率不大，几步就收敛）
export function orbitPosition(o: Orbit, frame: THREE.Quaternion, t: number, out: THREE.Vector3): THREE.Vector3 {
  const n = Math.sqrt(GM / Math.pow(o.a, 3));
  const M = o.m0 + n * t;
  let E = M;
  for (let i = 0; i < 6; i++) E -= (E - o.e * Math.sin(E) - M) / (1 - o.e * Math.cos(E));
  return place(o, frame, E, out);
}

// 整条轨道的折线，画轨迹用（2048 段高密度采样，确保黑洞正后方强引力透镜区弯折出圆润顺滑的爱因斯坦环光弧）
export function orbitPath(o: Orbit, segments = 2048): THREE.BufferGeometry {
  const frame = orbitFrame(o);
  const points: THREE.Vector3[] = [];
  for (let i = 0; i < segments; i++) points.push(place(o, frame, (i / segments) * Math.PI * 2, new THREE.Vector3()));
  return new THREE.BufferGeometry().setFromPoints(points);
}

// 金箔隔热层（MLI 多层隔热毯）：暖金基底 + 绗缝网格接缝 + 细微折光褶皱
function foilTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 256, 128);
  grad.addColorStop(0, '#c89232');
  grad.addColorStop(0.5, '#dfac4a');
  grad.addColorStop(1, '#a97422');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 128);

  // 柔和的聚酰亚胺薄膜折光块
  for (let i = 0; i < 64; i++) {
    const light = i % 2 === 0;
    g.fillStyle = light ? 'rgba(255, 232, 168, 0.22)' : 'rgba(92, 56, 12, 0.20)';
    const x = ((i * 47) % 256);
    const y = ((i * 29) % 128);
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + 14 + (i % 18), y + ((i % 7) - 3) * 3);
    g.lineTo(x + 8 + (i % 15), y + 8 + (i % 10));
    g.closePath();
    g.fill();
  }

  // 航天器隔热毯绗缝压线
  g.strokeStyle = 'rgba(72, 42, 8, 0.28)';
  g.lineWidth = 1;
  for (let x = 0; x < 256; x += 32) {
    g.beginPath();
    g.moveTo(x + 0.5, 0);
    g.lineTo(x + 0.5, 128);
    g.stroke();
  }
  for (let y = 0; y < 128; y += 24) {
    g.beginPath();
    g.moveTo(0, y + 0.5);
    g.lineTo(256, y + 0.5);
    g.stroke();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// 五个探测器共用的材质，只建一次。
// 只有吸积盘那一盏平行光，背光面会黑成一团剪影；都给一点自发光，暗面也看得出轮廓
let shared: { hull: THREE.Material; foil: THREE.Material; dark: THREE.Material; glass: THREE.Material } | null = null;
function materials() {
  if (shared) return shared;
  shared = {
    hull: new THREE.MeshStandardMaterial({
      color: 0xdfe3ea,
      emissive: 0x4a515f,
      metalness: 0.5,
      roughness: 0.32,
      side: THREE.DoubleSide,
    }),
    foil: new THREE.MeshStandardMaterial({ map: foilTexture(), emissive: 0x3a2a12, metalness: 0.85, roughness: 0.42 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x3a3f4a, emissive: 0x1a1d24, metalness: 0.6, roughness: 0.5 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x1b2433, emissive: 0x0b1626, metalness: 0.9, roughness: 0.15 }),
  };
  return shared;
}

// 两点之间的一根杆
const UP = new THREE.Vector3(0, 1, 0);
function rod(a: THREE.Vector3, b: THREE.Vector3, radius: number, mat: THREE.Material): THREE.Mesh {
  const dir = b.clone().sub(a);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, dir.length(), 6), mat);
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(UP, dir.normalize());
  return mesh;
}

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

// 把同一个材质的多个静态子网格合并成一份 BufferGeometry，大幅削减每帧（含透镜次像第二遍）的 Draw Call 数量
function mergeStaticMeshes(meshes: THREE.Mesh[]): THREE.BufferGeometry {
  const parts = meshes.map((m) => {
    m.updateMatrix();
    const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
    g.applyMatrix4(m.matrix);
    m.geometry.dispose();
    return g;
  });
  let total = 0;
  for (const g of parts) total += g.attributes.position.count;
  const pos = new Float32Array(total * 3);
  const norm = new Float32Array(total * 3);
  const uv = new Float32Array(total * 2);
  let offset = 0;
  for (const g of parts) {
    const p = g.attributes.position as THREE.BufferAttribute;
    const n = g.attributes.normal as THREE.BufferAttribute;
    const u = g.attributes.uv as THREE.BufferAttribute | undefined;
    pos.set(p.array as Float32Array, offset * 3);
    norm.set(n.array as Float32Array, offset * 3);
    if (u) uv.set(u.array as Float32Array, offset * 2);
    offset += p.count;
    g.dispose();
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(norm, 3));
  merged.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return merged;
}

// 五个探测器的几何体也完全相同，合并后缓存起来共用，每个探测器只需 5 次绘制调用（原为 31 次）
let sharedGeos: {
  hull: THREE.BufferGeometry;
  foil: THREE.BufferGeometry;
  dark: THREE.BufferGeometry;
  glass: THREE.BufferGeometry;
  beacon: THREE.BufferGeometry;
} | null = null;

function probeGeometries(mats: ReturnType<typeof materials>) {
  if (sharedGeos) return sharedGeos;
  const { hull, foil, dark, glass } = mats;
  const hullList: THREE.Mesh[] = [];
  const foilList: THREE.Mesh[] = [];
  const darkList: THREE.Mesh[] = [];
  const glassList: THREE.Mesh[] = [];

  // 机身
  const bus = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.18, 10), foil);
  bus.rotation.x = Math.PI / 2;
  bus.position.z = 0.08;
  foilList.push(bus);
  for (const z of [-0.01, 0.17]) {
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.006, 4, 10), dark);
    band.position.z = z;
    darkList.push(band);
  }
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    const nozzle = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.05, 8, 1, true), dark);
    nozzle.rotation.x = -Math.PI / 2;
    nozzle.position.set(Math.cos(a) * 0.13, Math.sin(a) * 0.13, 0.19);
    darkList.push(nozzle);
  }

  // 抛物面天线：y = 0.9·r² 的旋转体，焦距 1/(4×0.9) ≈ 0.28
  const R = 0.48;
  const depth = R * R * 0.9;
  const profile: THREE.Vector2[] = [];
  for (let i = 0; i <= 12; i++) {
    const r = (i / 12) * R;
    profile.push(new THREE.Vector2(r, r * r * 0.9));
  }
  const dish = new THREE.Mesh(new THREE.LatheGeometry(profile, 40), hull);
  dish.rotation.x = -Math.PI / 2;
  dish.position.z = -0.03;
  hullList.push(dish);
  const rimZ = -0.03 - depth;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(R, 0.009, 6, 48), hull);
  rim.position.z = rimZ;
  hullList.push(rim);
  const focusZ = -0.03 - 0.28;
  const sub = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.04, 0.02, 16), hull);
  sub.rotation.x = Math.PI / 2;
  sub.position.z = focusZ;
  hullList.push(sub);
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + Math.PI / 2;
    darkList.push(rod(v(Math.cos(a) * R * 0.95, Math.sin(a) * R * 0.95, rimZ), v(0, 0, focusZ), 0.004, dark));
  }

  // 同位素电池桁架：上下两根主杆加斜撑，末端两节电池
  const root = 0.2;
  const tip = 0.78;
  darkList.push(rod(v(root, 0.04, 0.08), v(tip, 0.03, 0.08), 0.006, dark));
  darkList.push(rod(v(root, -0.04, 0.08), v(tip, -0.03, 0.08), 0.006, dark));
  for (let i = 0; i < 4; i++) {
    const x0 = root + ((tip - root) / 4) * i;
    const x1 = x0 + (tip - root) / 4;
    darkList.push(rod(v(x0, i % 2 ? 0.04 : -0.04, 0.08), v(x1, i % 2 ? -0.04 : 0.04, 0.08), 0.003, dark));
  }
  for (const x of [0.86, 1.0]) {
    const rtg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.11, 12), dark);
    rtg.rotation.z = Math.PI / 2;
    rtg.position.set(x, 0, 0.08);
    darkList.push(rtg);
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.004, 0.035), dark);
      fin.position.set(x, Math.sin(a) * 0.065, 0.08 + Math.cos(a) * 0.065);
      fin.rotation.x = -a;
      darkList.push(fin);
    }
  }

  // 科学仪器杆和扫描平台
  const platform = v(-0.82, 0.06, 0.1);
  darkList.push(rod(v(-0.2, 0.02, 0.08), platform, 0.007, dark));
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 0.1), foil);
  box.position.copy(platform);
  foilList.push(box);
  for (const [dx, r, len] of [
    [-0.03, 0.025, 0.12],
    [0.035, 0.018, 0.09],
  ] as const) {
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 12), glass);
    lens.rotation.x = Math.PI / 2;
    lens.position.set(platform.x + dx, platform.y + 0.02, platform.z + 0.05 + len / 2);
    glassList.push(lens);
  }

  // 磁强计杆：又细又长，往斜上方伸
  darkList.push(rod(v(-0.12, 0.15, 0.06), v(-0.9, 1.15, 0.0), 0.004, dark));
  // 等离子波天线：机身下方一对 V 形细杆
  for (const side of [-1, 1]) darkList.push(rod(v(0, -0.18, 0.12), v(side * 0.45, -0.95, 0.2), 0.003, dark));

  const beaconMesh = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8));
  beaconMesh.position.set(0, 0.22, 0.1);

  sharedGeos = {
    hull: mergeStaticMeshes(hullList),
    foil: mergeStaticMeshes(foilList),
    dark: mergeStaticMeshes(darkList),
    glass: mergeStaticMeshes(glassList),
    beacon: mergeStaticMeshes([beaconMesh]),
  };
  return sharedGeos;
}

// 探测器：参照旅行者号的构型。
// - 十棱柱的金箔机身，背面四个姿态推进器喷口
// - 一口大抛物面天线，外圈加强环、三根支撑杆撑着焦点上的副反射面；开口朝 -z，scene.ts 每帧把它对准空间站
// - +x 一侧：三角桁架挑出去的两节同位素电池，带散热鳍片
// - -x 一侧：科学仪器杆，末端是扫描平台和两个相机镜筒（朝 +z，也就是黑洞那边）
// - 斜上方一根很长的磁强计杆，下方一对 V 形等离子波天线，机身顶上一盏信标灯
export function buildProbe(beaconColor = 0xffd2a0): { group: THREE.Group; beacon: THREE.MeshBasicMaterial } {
  const mats = materials();
  const geos = probeGeometries(mats);
  const beacon = new THREE.MeshBasicMaterial({ color: beaconColor });
  const group = new THREE.Group();

  group.add(new THREE.Mesh(geos.hull, mats.hull));
  group.add(new THREE.Mesh(geos.foil, mats.foil));
  group.add(new THREE.Mesh(geos.dark, mats.dark));
  group.add(new THREE.Mesh(geos.glass, mats.glass));
  group.add(new THREE.Mesh(geos.beacon, beacon));

  group.scale.setScalar(0.65);
  return { group, beacon };
}
