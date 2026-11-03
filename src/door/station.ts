import * as THREE from 'three';

// 空间站：顶上是观景甲板（默认视角就站在这里），下面是中心舱、四根轮辐和一圈带舷窗的环。
// 全部用 three.js 自带几何体拼，贴图在画布上现画，不需要模型文件。
// 局部坐标：甲板上表面 y = 0，+z 朝向黑洞（scene.ts 每帧用 lookAt 摆正）

export const DECK_RADIUS = 2.4;
export const RING_RADIUS = 7;

// 把同一材质的静态子网格合并成单个 BufferGeometry，甲板陈设丰富后反而减少每帧 Draw Call
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

// 甲板地面：深色金属板，同心环 + 放射线分出面板，再加导引线、检修格栅与观测位刻度
function floorTexture(): THREE.CanvasTexture {
  const size = 1024;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const mid = size / 2;

  g.fillStyle = '#181d26';
  g.fillRect(0, 0, size, size);

  // 面板之间颜色略有出入，看起来才像拼起来的
  for (let ring = 0; ring < 8; ring++) {
    for (let k = 0; k < 24; k++) {
      const shade = 24 + ((ring * 7 + k * 13) % 10);
      g.fillStyle = `rgb(${shade}, ${shade + 4}, ${shade + 12})`;
      g.beginPath();
      g.arc(mid, mid, (ring + 1) * 64, (k / 24) * Math.PI * 2, ((k + 1) / 24) * Math.PI * 2);
      g.arc(mid, mid, ring * 64, ((k + 1) / 24) * Math.PI * 2, (k / 24) * Math.PI * 2, true);
      g.fill();
    }
  }

  // 内圈精密方位刻度盘
  g.strokeStyle = 'rgba(143, 212, 255, 0.22)';
  g.lineWidth = 2;
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * Math.PI * 2;
    const r0 = i % 6 === 0 ? 112 : 120;
    const r1 = 128;
    g.beginPath();
    g.moveTo(mid + Math.cos(a) * r0, mid + Math.sin(a) * r0);
    g.lineTo(mid + Math.cos(a) * r1, mid + Math.sin(a) * r1);
    g.stroke();
  }

  // 甲板接缝线
  g.strokeStyle = '#0c0f15';
  g.lineWidth = 3;
  for (let r = 64; r < mid; r += 64) {
    g.beginPath();
    g.arc(mid, mid, r, 0, Math.PI * 2);
    g.stroke();
  }
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2;
    g.beginPath();
    g.moveTo(mid + Math.cos(a) * 64, mid + Math.sin(a) * 64);
    g.lineTo(mid + Math.cos(a) * mid, mid + Math.sin(a) * mid);
    g.stroke();
  }

  // 走道散热格栅纹理（前后左右四个象限）
  g.strokeStyle = 'rgba(10, 14, 20, 0.65)';
  g.lineWidth = 2;
  for (const ang of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
    g.save();
    g.translate(mid + Math.cos(ang) * 224, mid + Math.sin(ang) * 224);
    g.rotate(ang);
    g.fillStyle = '#12161f';
    g.fillRect(-26, -42, 52, 84);
    for (let y = -36; y <= 36; y += 6) {
      g.beginPath();
      g.moveTo(-22, y);
      g.lineTo(22, y);
      g.stroke();
    }
    g.restore();
  }

  // 外圈琥珀色虚线安全警戒线
  g.strokeStyle = '#8e7c60';
  g.lineWidth = 4;
  g.setLineDash([22, 14]);
  g.beginPath();
  g.arc(mid, mid, mid * 0.86, 0, Math.PI * 2);
  g.stroke();
  g.setLineDash([]);

  // 观景站位前方的半圆瞄准导引线
  g.strokeStyle = 'rgba(143, 212, 255, 0.28)';
  g.lineWidth = 2;
  g.beginPath();
  g.arc(mid, mid, mid * 0.42, Math.PI * 0.2, Math.PI * 0.8);
  g.stroke();

  g.strokeStyle = '#3a4252';
  g.lineWidth = 2;
  g.beginPath();
  g.arc(mid, mid, 40, 0, Math.PI * 2);
  g.stroke();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// 环的外壳：暗色底上随机排一些亮着的舷窗，同一张图既当颜色也当自发光
function hullTexture(): THREE.CanvasTexture {
  const w = 2048;
  const h = 128;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = '#14171d';
  g.fillRect(0, 0, w, h);
  for (let x = 0; x < w; x += 64) {
    g.fillStyle = '#1c2029';
    g.fillRect(x, 0, 2, h);
  }
  for (let i = 0; i < 260; i++) {
    if (Math.random() < 0.35) continue;
    const x = Math.random() * w;
    const y = h * (0.38 + Math.random() * 0.24);
    g.fillStyle = Math.random() < 0.8 ? '#ffd9a6' : '#a9c8ff';
    g.fillRect(x, y, 6, 3);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// 控制台屏幕上的界面：读数、引力势阱网格、频谱波形、轨道雷达，青色和琥珀色
function consoleTexture(seed: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 144;
  const g = c.getContext('2d')!;
  g.fillStyle = '#050d17';
  g.fillRect(0, 0, 256, 144);
  g.strokeStyle = 'rgba(130, 208, 255, 0.42)';
  g.strokeRect(4.5, 4.5, 247, 135);

  // 顶部状态条
  g.fillStyle = 'rgba(130, 208, 255, 0.16)';
  g.fillRect(8, 8, 240, 12);
  g.fillStyle = 'rgba(255, 196, 120, 0.9)';
  g.fillRect(11, 12, 18, 4);
  g.fillStyle = 'rgba(150, 215, 255, 0.85)';
  g.fillRect(34, 12, 48, 4);

  // 左侧遥测条码与参数条
  for (let i = 0; i < 6; i++) {
    g.fillStyle = i === 0 ? 'rgba(255, 196, 120, 0.85)' : 'rgba(150, 215, 255, 0.78)';
    g.fillRect(12, 28 + i * 11, 26 + ((seed * 37 + i * 53) % 68), 3);
  }

  // 下方引力波/频谱曲线
  g.strokeStyle = seed % 2 === 0 ? 'rgba(143, 212, 255, 0.92)' : 'rgba(255, 196, 120, 0.92)';
  g.lineWidth = 1.5;
  g.beginPath();
  for (let x = 0; x <= 122; x += 3) {
    const y = 122 - Math.abs(Math.sin(x * 0.11 + seed) * 20) - Math.sin(x * 0.37 + seed * 2) * 5;
    if (x === 0) g.moveTo(12 + x, y);
    else g.lineTo(12 + x, y);
  }
  g.stroke();

  // 右侧：轨道雷达或黑洞引力漏斗线框
  const cx = 196;
  const cy = 78;
  g.strokeStyle = 'rgba(120, 200, 255, 0.58)';
  g.lineWidth = 1;
  for (const r of [14, 27, 40]) {
    g.beginPath();
    g.ellipse(cx, cy, r, seed % 2 === 0 ? r * 0.62 : r, 0, 0, Math.PI * 2);
    g.stroke();
  }
  g.fillStyle = 'rgba(255, 196, 120, 0.95)';
  g.beginPath();
  g.arc(cx + Math.cos(seed * 1.7) * 27, cy + Math.sin(seed * 1.7) * 18, 2.5, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.moveTo(cx, cy);
  g.lineTo(cx + Math.cos(seed) * 40, cy + Math.sin(seed) * 40);
  g.stroke();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// 甲板装饰：正前方视线留给黑洞和下方光弧；
// 前侧左右两翼布置低矮的斜置遥测副控台与光学追踪望远镜，脚下中心布置全息投影井，身后布置主控台与服务器机柜
function decorateDeck(station: THREE.Group, dark: THREE.Material, hull: THREE.Material) {
  const amber = new THREE.MeshBasicMaterial({ color: 0xffb46a });
  const dim = new THREE.MeshBasicMaterial({ color: 0x6b5236 });
  const cyan = new THREE.MeshBasicMaterial({ color: 0x8fd4ff, transparent: true, opacity: 0.6, depthWrite: false });
  const cyanSolid = new THREE.MeshBasicMaterial({ color: 0x8fd4ff });

  const darkMeshes: THREE.Mesh[] = [];
  const hullMeshes: THREE.Mesh[] = [];
  const amberMeshes: THREE.Mesh[] = [];
  const dimMeshes: THREE.Mesh[] = [];
  const cyanMeshes: THREE.Mesh[] = [];

  // 扶栏顶上一圈暖色灯带
  const railGlow = new THREE.Mesh(new THREE.TorusGeometry(DECK_RADIUS - 0.05, 0.003, 4, 256), amber);
  railGlow.rotation.x = Math.PI / 2;
  railGlow.position.y = 0.17;
  amberMeshes.push(railGlow);

  // 地面：八条放射状引导线 + 中心全息投影底座与双徽环
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.002, 1.3), dim);
    strip.position.set(Math.sin(a) * 1.15, 0.002, Math.cos(a) * 1.15);
    strip.rotation.y = a;
    dimMeshes.push(strip);
  }
  for (const r of [0.22, 0.32, 0.42]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.004, 4, 96), r === 0.32 ? amber : r === 0.22 ? cyanSolid : dim);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.004;
    if (r === 0.32) amberMeshes.push(ring);
    else if (r === 0.22) cyanMeshes.push(ring);
    else dimMeshes.push(ring);
  }
  // 中心投影井基座与四个发射端节点
  const emitterBase = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.014, 24), dark);
  emitterBase.position.y = 0.007;
  darkMeshes.push(emitterBase);
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    const node = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.012, 0.045), hull);
    node.position.set(Math.sin(a) * 0.32, 0.006, Math.cos(a) * 0.32);
    node.rotation.y = a;
    hullMeshes.push(node);
  }

  // ---- 前侧左右两翼：低矮的双联斜置电脑遥测副控台（高度 0.145 < 扶栏 0.16，绝不挡黑洞，余光与转头可见） ----
  for (const [idx, side] of [
    [0, -1],
    [1, 1],
  ] as const) {
    const a = side * 0.68;
    const r = 1.62;
    const cx = Math.sin(a) * r;
    const cz = Math.cos(a) * r;
    const yaw = Math.atan2(-cx, 0.95 - cz);

    // 斜立金属底座
    const pedestal = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.11, 0.16), dark);
    pedestal.position.set(cx, 0.055, cz);
    pedestal.rotation.y = yaw;
    darkMeshes.push(pedestal);

    // 键盘与触控操作台面
    const deckPlate = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.014, 0.2), hull);
    deckPlate.position.set(cx, 0.112, cz);
    deckPlate.rotation.y = yaw;
    deckPlate.rotateX(0.18);
    hullMeshes.push(deckPlate);

    // 触控发光条
    const keyGlow = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.004, 0.04), side < 0 ? cyanSolid : amber);
    keyGlow.position.set(cx, 0.121, cz);
    keyGlow.rotation.y = yaw;
    keyGlow.rotateX(0.18);
    if (side < 0) cyanMeshes.push(keyGlow);
    else amberMeshes.push(keyGlow);

    // 斜置遥测液晶屏（朝向人眼观景位）
    const panel = new THREE.Mesh(
      new THREE.PlaneGeometry(0.32, 0.15),
      new THREE.MeshBasicMaterial({ map: consoleTexture(idx + 4) }),
    );
    panel.position.set(cx - Math.sin(yaw) * 0.04, 0.195, cz - Math.cos(yaw) * 0.04);
    panel.rotation.y = yaw;
    panel.rotateX(-0.42);
    station.add(panel);

    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.165, 0.012), dark);
    frame.position.copy(panel.position);
    frame.rotation.copy(panel.rotation);
    frame.translateZ(-0.008);
    darkMeshes.push(frame);
  }

  // ---- 左右两翼栏杆内侧：深空光学追踪望远镜筒（对准黑洞方向） ----
  for (const side of [-1, 1]) {
    const sx = side * 1.96;
    const sz = 0.72;
    const tripod = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.045, 0.22, 8), dark);
    tripod.position.set(sx, 0.11, sz);
    darkMeshes.push(tripod);

    const yoke = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 0.04), hull);
    yoke.position.set(sx, 0.23, sz);
    hullMeshes.push(yoke);

    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.032, 0.26, 12), hull);
    tube.position.set(sx, 0.25, sz + 0.02);
    tube.rotation.x = Math.PI / 2 - 0.08;
    tube.rotation.z = side * 0.04;
    hullMeshes.push(tube);

    const hood = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.05, 12), dark);
    hood.position.set(sx - side * 0.005, 0.26, sz + 0.15);
    hood.rotation.x = Math.PI / 2 - 0.08;
    darkMeshes.push(hood);

    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.029, 0.003, 4, 16), cyanSolid);
    ring.position.set(sx, 0.252, sz + 0.06);
    cyanMeshes.push(ring);
  }

  // ---- 身后的弧形主控制台、三块大屏与两侧立式服务器机柜 ----
  const desk = new THREE.Mesh(new THREE.TorusGeometry(1.75, 0.045, 8, 48, 1.3), dark);
  desk.rotation.x = Math.PI / 2;
  desk.rotation.z = Math.PI / 2 - 0.65 + Math.PI;
  desk.position.y = 0.11;
  darkMeshes.push(desk);
  for (let i = 0; i < 3; i++) {
    const a = Math.PI + (i - 1) * 0.42;
    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(0.34, 0.19),
      new THREE.MeshBasicMaterial({ map: consoleTexture(i + 1) }),
    );
    screen.position.set(Math.sin(a) * 1.68, 0.24, Math.cos(a) * 1.68);
    screen.lookAt(0, 0.3, 0);
    screen.rotateX(-0.25);
    station.add(screen);
  }

  // 主控台两侧的立式遥测服务器机柜 + 状态灯阵
  for (const side of [-1, 1]) {
    const rx = side * 1.42;
    const rz = -1.22;
    const rack = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.46, 0.18), dark);
    rack.position.set(rx, 0.23, rz);
    rack.rotation.y = side * 0.55;
    darkMeshes.push(rack);

    for (let row = 0; row < 4; row++) {
      const led = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.008, 0.184), row % 2 === 0 ? cyanSolid : amber);
      led.position.set(rx, 0.12 + row * 0.09, rz);
      led.rotation.y = side * 0.55;
      if (row % 2 === 0) cyanMeshes.push(led);
      else amberMeshes.push(led);
    }
  }

  // 两侧灯柱
  for (const side of [-1, 1]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.018, 0.4, 8), dark);
    pole.position.set(side * 2.0, 0.2, 0.2);
    darkMeshes.push(pole);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.025, 10, 8), amber);
    cap.position.set(side * 2.0, 0.41, 0.2);
    amberMeshes.push(cap);
  }

  // 后方的天线桅杆，顶上一盏红色航标灯（闪烁在 scene.ts 里做）
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.025, 1.3, 8), dark);
  mast.position.set(0.5, 0.65, -2.0);
  darkMeshes.push(mast);
  for (const y of [0.5, 0.9]) {
    const spar = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.008, 0.008), dark);
    spar.position.set(0.5, y, -2.0);
    darkMeshes.push(spar);
  }
  const beacon = new THREE.MeshBasicMaterial({ color: 0xff3b30 });
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.022, 10, 8), beacon);
  lamp.position.set(0.5, 1.32, -2.0);
  station.add(lamp);
  station.userData.beacon = beacon;

  // 把静态装饰按材质一次性合并挂载
  station.add(new THREE.Mesh(mergeStaticMeshes(darkMeshes), dark));
  station.add(new THREE.Mesh(mergeStaticMeshes(hullMeshes), hull));
  station.add(new THREE.Mesh(mergeStaticMeshes(amberMeshes), amber));
  station.add(new THREE.Mesh(mergeStaticMeshes(dimMeshes), dim));
  station.add(new THREE.Mesh(mergeStaticMeshes(cyanMeshes), cyanSolid));

  // 甲板中央上方一圈很淡的全息陀螺环，慢慢转
  const holo = new THREE.Group();
  const holoParts: THREE.Mesh[] = [];
  for (const [r, tilt] of [
    [0.44, -0.35],
    [0.55, 0],
    [0.62, 0.5],
  ] as const) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.0025, 4, 128), cyan);
    ring.rotation.x = Math.PI / 2 + tilt;
    holoParts.push(ring);
  }
  holo.add(new THREE.Mesh(mergeStaticMeshes(holoParts), cyan));
  holo.position.y = 0.95;
  station.add(holo);
  station.userData.holo = holo;
}

export function buildStation(): THREE.Group {
  const station = new THREE.Group();

  const hull = new THREE.MeshStandardMaterial({ color: 0x7d879a, metalness: 0.55, roughness: 0.42 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2b313d, metalness: 0.6, roughness: 0.5 });
  const solar = new THREE.MeshStandardMaterial({
    color: 0x1a2c48,
    emissive: 0x081326,
    metalness: 0.78,
    roughness: 0.24,
  });
  const glow = new THREE.MeshBasicMaterial({ color: 0xffd2a0 });

  // 甲板：上表面在 y = 0
  const deck = new THREE.Mesh(
    new THREE.CylinderGeometry(DECK_RADIUS, DECK_RADIUS * 0.94, 0.22, 128),
    [hull, new THREE.MeshStandardMaterial({ map: floorTexture(), metalness: 0.35, roughness: 0.62 }), hull],
  );
  deck.position.y = -0.11;
  station.add(deck);

  // 甲板边缘的灯带和地面引导灯
  const edge = new THREE.Mesh(new THREE.TorusGeometry(DECK_RADIUS - 0.02, 0.006, 6, 256), glow);
  edge.rotation.x = Math.PI / 2;
  edge.position.y = 0.004;
  station.add(edge);

  // 引导灯做得很扁很小：人眼离它们不到一个单位，做大了在画面下方就是几颗白球
  const lamps = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.008, 0.008, 0.002, 10), glow, 48);
  const m = new THREE.Matrix4();
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    m.makeTranslation(Math.cos(a) * DECK_RADIUS * 0.86, 0.006, Math.sin(a) * DECK_RADIUS * 0.86);
    lamps.setMatrixAt(i, m);
  }
  station.add(lamps);

  // 扶栏：立柱加上下两道横杆，高度按「人眼 0.32、扶栏 0.16」的比例
  const posts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.006, 0.006, 0.16, 6), dark, 90);
  for (let i = 0; i < 90; i++) {
    const a = (i / 90) * Math.PI * 2;
    m.makeTranslation(Math.cos(a) * (DECK_RADIUS - 0.05), 0.08, Math.sin(a) * (DECK_RADIUS - 0.05));
    posts.setMatrixAt(i, m);
  }
  station.add(posts);

  const railParts: THREE.Mesh[] = [];
  for (const [y, tube] of [
    [0.16, 0.008],
    [0.09, 0.004],
  ] as const) {
    const rail = new THREE.Mesh(new THREE.TorusGeometry(DECK_RADIUS - 0.05, tube, 6, 256), dark);
    rail.rotation.x = Math.PI / 2;
    rail.position.y = y;
    railParts.push(rail);
  }
  station.add(new THREE.Mesh(mergeStaticMeshes(railParts), dark));

  decorateDeck(station, dark, hull);

  // 甲板下方的中心舱、四根轮辐与外圈太阳能散热翼桁架
  const ringY = -2.2;
  const hullStructure: THREE.Mesh[] = [];
  const solarWings: THREE.Mesh[] = [];

  const core = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 0.75, 2.6, 64, 16), hull);
  core.position.y = -1.52;
  hullStructure.push(core);

  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, RING_RADIUS - 0.9, 1, 1, 20), hull);
    spoke.position.set(Math.cos(a) * (RING_RADIUS / 2 + 0.3), ringY, Math.sin(a) * (RING_RADIUS / 2 + 0.3));
    spoke.rotation.y = -a + Math.PI / 2;
    hullStructure.push(spoke);

    // 居住环外侧挑出的深空光伏/散热翼板，自由视角俯瞰时空间站轮廓更修长完整
    const wingBoom = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 3.4, 1, 1, 16), hull);
    wingBoom.position.set(Math.cos(a) * (RING_RADIUS + 1.9), ringY, Math.sin(a) * (RING_RADIUS + 1.9));
    wingBoom.rotation.y = -a + Math.PI / 2;
    hullStructure.push(wingBoom);

    for (const side of [-1, 1]) {
      const wing = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.018, 2.8, 4, 1, 16), solar);
      const px = Math.cos(a) * (RING_RADIUS + 2.0) - Math.sin(a) * (side * 0.48);
      const pz = Math.sin(a) * (RING_RADIUS + 2.0) + Math.cos(a) * (side * 0.48);
      wing.position.set(px, ringY, pz);
      wing.rotation.y = -a + Math.PI / 2;
      solarWings.push(wing);
    }
  }
  station.add(new THREE.Mesh(mergeStaticMeshes(hullStructure), hull));
  station.add(new THREE.Mesh(mergeStaticMeshes(solarWings), solar));

  // 居住环
  const windows = hullTexture();
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(RING_RADIUS, 0.42, 24, 256),
    new THREE.MeshStandardMaterial({
      map: windows,
      emissiveMap: windows,
      emissive: 0xffffff,
      emissiveIntensity: 1.4,
      metalness: 0.5,
      roughness: 0.45,
    }),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = ringY;
  station.add(ring);

  return station;
}
