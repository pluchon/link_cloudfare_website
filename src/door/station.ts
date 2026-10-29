import * as THREE from 'three';

// 空间站：顶上是观景甲板（默认视角就站在这里），下面是中心舱、四根轮辐和一圈带舷窗的环。
// 全部用 three.js 自带几何体拼，贴图在画布上现画，不需要模型文件。
// 局部坐标：甲板上表面 y = 0，+z 朝向黑洞（scene.ts 每帧用 lookAt 摆正）

export const DECK_RADIUS = 2.4;
export const RING_RADIUS = 7;

// 甲板地面：深色金属板，同心环 + 放射线分出面板，再加一圈导引线
function floorTexture(): THREE.CanvasTexture {
  const size = 1024;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const mid = size / 2;

  g.fillStyle = '#1a1f28';
  g.fillRect(0, 0, size, size);

  // 面板之间颜色略有出入，看起来才像拼起来的
  for (let ring = 0; ring < 8; ring++) {
    for (let k = 0; k < 24; k++) {
      const shade = 26 + Math.floor(Math.random() * 10);
      g.fillStyle = `rgb(${shade}, ${shade + 4}, ${shade + 12})`;
      g.beginPath();
      g.arc(mid, mid, (ring + 1) * 64, (k / 24) * Math.PI * 2, ((k + 1) / 24) * Math.PI * 2);
      g.arc(mid, mid, ring * 64, ((k + 1) / 24) * Math.PI * 2, (k / 24) * Math.PI * 2, true);
      g.fill();
    }
  }

  g.strokeStyle = '#0d1016';
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

  g.strokeStyle = '#8a7a60';
  g.lineWidth = 4;
  g.setLineDash([22, 14]);
  g.beginPath();
  g.arc(mid, mid, mid * 0.86, 0, Math.PI * 2);
  g.stroke();
  g.setLineDash([]);

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

// 控制台屏幕上的界面：几行读数、一条波形、一个小雷达，青色和琥珀色
function consoleTexture(seed: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 144;
  const g = c.getContext('2d')!;
  g.fillStyle = '#06101a';
  g.fillRect(0, 0, 256, 144);
  g.strokeStyle = 'rgba(120, 200, 255, 0.35)';
  g.strokeRect(4.5, 4.5, 247, 135);
  g.fillStyle = 'rgba(150, 215, 255, 0.85)';
  for (let i = 0; i < 6; i++) g.fillRect(12, 14 + i * 12, 30 + ((seed * 37 + i * 53) % 70), 3);
  g.strokeStyle = 'rgba(255, 196, 120, 0.9)';
  g.beginPath();
  for (let x = 0; x <= 120; x += 3) {
    const y = 112 - Math.abs(Math.sin(x * 0.11 + seed) * 22) - Math.sin(x * 0.37 + seed * 2) * 6;
    if (x === 0) g.moveTo(12 + x, y);
    else g.lineTo(12 + x, y);
  }
  g.stroke();
  g.strokeStyle = 'rgba(120, 200, 255, 0.6)';
  for (const r of [14, 28, 42]) {
    g.beginPath();
    g.arc(196, 72, r, 0, Math.PI * 2);
    g.stroke();
  }
  g.beginPath();
  g.moveTo(196, 72);
  g.lineTo(196 + Math.cos(seed) * 42, 72 + Math.sin(seed) * 42);
  g.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// 甲板装饰：都放在不挡视线的地方。往黑洞那边看只有扶栏灯带和地面引导线，
// 控制台、桅杆在身后，转头才看得到
function decorateDeck(station: THREE.Group, dark: THREE.Material) {
  const amber = new THREE.MeshBasicMaterial({ color: 0xffb46a });
  const dim = new THREE.MeshBasicMaterial({ color: 0x6b5236 });
  const cyan = new THREE.MeshBasicMaterial({ color: 0x8fd4ff, transparent: true, opacity: 0.55, depthWrite: false });

  // 扶栏顶上一圈暖色灯带
  const railGlow = new THREE.Mesh(new THREE.TorusGeometry(DECK_RADIUS - 0.05, 0.003, 4, 256), amber);
  railGlow.rotation.x = Math.PI / 2;
  railGlow.position.y = 0.17;
  station.add(railGlow);

  // 地面：八条放射状引导线 + 中心徽环
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.002, 1.3), dim);
    strip.position.set(Math.sin(a) * 1.15, 0.002, Math.cos(a) * 1.15);
    strip.rotation.y = a;
    station.add(strip);
  }
  for (const r of [0.32, 0.4]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.004, 4, 96), r === 0.32 ? amber : dim);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.003;
    station.add(ring);
  }

  // 身后的弧形控制台和三块屏幕
  const desk = new THREE.Mesh(new THREE.TorusGeometry(1.75, 0.045, 8, 48, 1.3), dark);
  desk.rotation.x = Math.PI / 2;
  desk.rotation.z = Math.PI / 2 - 0.65 + Math.PI;
  desk.position.y = 0.11;
  station.add(desk);
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

  // 两侧灯柱
  for (const side of [-1, 1]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.018, 0.4, 8), dark);
    pole.position.set(side * 2.0, 0.2, 0.2);
    station.add(pole);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.025, 10, 8), amber);
    cap.position.set(side * 2.0, 0.41, 0.2);
    station.add(cap);
  }

  // 后方的天线桅杆，顶上一盏红色航标灯（闪烁在 scene.ts 里做）
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.025, 1.3, 8), dark);
  mast.position.set(0.5, 0.65, -2.0);
  station.add(mast);
  for (const y of [0.5, 0.9]) {
    const spar = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.008, 0.008), dark);
    spar.position.set(0.5, y, -2.0);
    station.add(spar);
  }
  const beacon = new THREE.MeshBasicMaterial({ color: 0xff3b30 });
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.022, 10, 8), beacon);
  lamp.position.set(0.5, 1.32, -2.0);
  station.add(lamp);
  station.userData.beacon = beacon;

  // 甲板中央上方一圈很淡的全息环，慢慢转
  const holo = new THREE.Group();
  for (const [r, tilt] of [
    [0.55, 0],
    [0.62, 0.5],
  ] as const) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.0025, 4, 128), cyan);
    ring.rotation.x = Math.PI / 2 + tilt;
    holo.add(ring);
  }
  holo.position.y = 0.95;
  station.add(holo);
  station.userData.holo = holo;
}

export function buildStation(): THREE.Group {
  const station = new THREE.Group();

  const hull = new THREE.MeshStandardMaterial({ color: 0x7d879a, metalness: 0.55, roughness: 0.42 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2b313d, metalness: 0.6, roughness: 0.5 });
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
  for (const [y, tube] of [
    [0.16, 0.008],
    [0.09, 0.004],
  ] as const) {
    const rail = new THREE.Mesh(new THREE.TorusGeometry(DECK_RADIUS - 0.05, tube, 6, 256), dark);
    rail.rotation.x = Math.PI / 2;
    rail.position.y = y;
    station.add(rail);
  }

  decorateDeck(station, dark);

  // 甲板下方的中心舱
  const core = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 0.75, 2.6, 64), hull);
  core.position.y = -1.52;
  station.add(core);

  // 居住环和轮辐
  const ringY = -2.2;
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

  for (let k = 0; k < 4; k++) {
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, RING_RADIUS - 0.9), hull);
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    spoke.position.set(Math.cos(a) * (RING_RADIUS / 2 + 0.3), ringY, Math.sin(a) * (RING_RADIUS / 2 + 0.3));
    spoke.rotation.y = -a + Math.PI / 2;
    station.add(spoke);
  }

  return station;
}
