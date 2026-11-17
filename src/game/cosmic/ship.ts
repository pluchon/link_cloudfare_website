import * as THREE from 'three';

export interface ShipSpec {
  id: 'voyager' | 'glider' | 'shuttle';
  name: string;
  swatches: [string, string, string];
  accent: string;
}

export const SHIPS: readonly ShipSpec[] = [
  {
    id: 'voyager',
    name: '金箔旅者',
    swatches: ['#e8b658', '#f2e8d8', '#38465a'],
    accent: '#e8b658',
  },
  {
    id: 'glider',
    name: '纸鸢流萤',
    swatches: ['#f4efe6', '#c6462f', '#3b4a5e'],
    accent: '#c6462f',
  },
  {
    id: 'shuttle',
    name: '蓝鲸穿梭',
    swatches: ['#3d6898', '#6fe3ff', '#dbe6f4'],
    accent: '#6fe3ff',
  },
];

export interface ShipModel {
  root: THREE.Group;
  body: THREE.Group;
  trail: THREE.Object3D;
  updateVisuals: (simTime: number, dt: number, boostFactor: number) => void;
  updateTrail: (dt: number, boostFactor: number) => void;
  resetTrail: () => void;
  dispose: () => void;
}

// 共享的 256×256 航天器蒙皮接缝凹凸贴图（仅创建一次，零重复画布开销）
let sharedHullBump: THREE.CanvasTexture | null = null;
function getHullBump(): THREE.CanvasTexture {
  if (sharedHullBump) return sharedHullBump;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, 256, 256);
    // 面板接缝与微凹槽
    ctx.strokeStyle = '#404040';
    ctx.lineWidth = 2;
    for (const p of [0, 64, 128, 192]) {
      ctx.beginPath();
      ctx.moveTo(0, p);
      ctx.lineTo(256, p);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(p, 0);
      ctx.lineTo(p, 256);
      ctx.stroke();
    }
    ctx.strokeStyle = '#9c9c9c';
    ctx.lineWidth = 1;
    for (let y = 16; y < 256; y += 32) {
      for (let x = 16; x < 256; x += 32) {
        ctx.fillStyle = '#a8a8a8';
        ctx.fillRect(x, y, 2, 2);
      }
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
  sharedHullBump = tex;
  return tex;
}

// 真空离子推力羽流着色器：无大气压缩马赫环与风压抖振，呈真空 Prandtl-Meyer 顺滑膨胀电离扇
const plumeVertex = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormalV;
  varying vec3 vViewPos;
  uniform float uTime;
  uniform float uThrust;

  void main() {
    vUv = uv;
    // uv.y: 0 在喷口喉部，1 在真空膨胀末端
    float t = uv.y;
    float expansion = 1.0 + pow(t, 0.82) * (0.58 + 0.34 * uThrust);
    vec3 pos = position;
    pos.xz *= expansion;
    pos.y *= (0.76 + uThrust * 0.82);
    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    vViewPos = -mv.xyz;
    vNormalV = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * mv;
  }
`;

const plumeFragment = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormalV;
  varying vec3 vViewPos;
  uniform float uTime;
  uniform float uThrust;
  uniform vec3 uCoreCol;
  uniform vec3 uOuterCol;

  void main() {
    float t = vUv.y;
    vec3 n = normalize(vNormalV);
    vec3 v = normalize(vViewPos);
    float rim = abs(dot(n, v));
    float radial = pow(rim, 1.6);

    // 真空中平滑稀释，仅留轻微磁场谐振微脉动（无大气湍流噪点）
    float magPulse = 0.92 + 0.08 * sin(t * 10.0 - uTime * 22.0);
    float axial = smoothstep(0.0, 0.08, t) * pow(1.0 - smoothstep(0.04, 1.0, t), 1.9);
    float coreMask = pow(rim, 3.0) * (1.0 - smoothstep(0.0, 0.55, t));

    vec3 hotWhite = vec3(1.0, 0.98, 0.94);
    vec3 col = mix(uOuterCol, uCoreCol, smoothstep(0.18, 0.84, radial));
    col = mix(col, hotWhite, clamp(coreMask * 0.85, 0.0, 1.0));

    float intensity = axial * radial * magPulse * (0.58 + uThrust * 0.92);
    if (intensity < 0.008) discard;
    gl_FragColor = vec4(col * intensity * 1.4, clamp(intensity, 0.0, 1.0));
  }
`;

function makeWingGeometry(
  innerR: number,
  span: number,
  sweep: number,
  chordRoot: number,
  chordTip: number,
  thickRoot: number,
  thickTip: number,
): THREE.BufferGeometry {
  const hr = thickRoot * 0.5;
  const ht = thickTip * 0.5;
  const x0 = innerR;
  const x1 = innerR + span;
  const zA0 = -chordRoot * 0.5;
  const zB0 = chordRoot * 0.5;
  const zA1 = sweep - chordTip * 0.5;
  const zB1 = sweep + chordTip * 0.5;

  const positions = new Float32Array([
    x0, hr, zA0,  x1, ht, zA1,  x1, ht, zB1,
    x0, hr, zA0,  x1, ht, zB1,  x0, hr, zB0,
    x0, -hr, zA0, x1, -ht, zB1, x1, -ht, zA1,
    x0, -hr, zA0, x0, -hr, zB0, x1, -ht, zB1,
    x0, hr, zA0,  x0, -hr, zA0, x1, -ht, zA1,
    x0, hr, zA0,  x1, -ht, zA1, x1, ht, zA1,
    x0, hr, zB0,  x1, ht, zB1,  x1, -ht, zB1,
    x0, hr, zB0,  x1, -ht, zB1, x0, -hr, zB0,
    x1, ht, zA1,  x1, -ht, zA1, x1, -ht, zB1,
    x1, ht, zA1,  x1, -ht, zB1, x1, ht, zB1,
  ]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.computeVertexNormals();
  return geo;
}

export function buildShip(spec: ShipSpec): ShipModel {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
    geometries.push(g);
    return g;
  };
  const trackMat = <T extends THREE.Material>(m: T): T => {
    materials.push(m);
    return m;
  };

  const bump = getHullBump();
  const accentCol = new THREE.Color(spec.accent);

  const goldMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xdfa94a,
      roughness: 0.28,
      metalness: 0.82,
      bumpMap: bump,
      bumpScale: 0.015,
      emissive: 0x3b2408,
      emissiveIntensity: 0.18,
    }),
  );
  const ceramicMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xf1ece3,
      roughness: 0.34,
      metalness: 0.22,
      bumpMap: bump,
      bumpScale: 0.01,
      emissive: 0x151822,
      emissiveIntensity: 0.12,
    }),
  );
  const cobaltMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x346194,
      roughness: 0.32,
      metalness: 0.56,
      bumpMap: bump,
      bumpScale: 0.014,
      emissive: 0x0a1e38,
      emissiveIntensity: 0.2,
    }),
  );
  const titaniumMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x5c687a,
      roughness: 0.36,
      metalness: 0.78,
      emissive: 0x0e131e,
      emissiveIntensity: 0.15,
    }),
  );
  const darkAlloyMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x1b212e,
      roughness: 0.45,
      metalness: 0.68,
      bumpMap: bump,
      bumpScale: 0.012,
      emissive: 0x080c14,
      emissiveIntensity: 0.18,
    }),
  );
  const visorMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x09111f,
      roughness: 0.1,
      metalness: 0.94,
      emissive: accentCol,
      emissiveIntensity: 0.22,
    }),
  );
  const trimMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: spec.accent,
      roughness: 0.26,
      metalness: 0.45,
      emissive: accentCol,
      emissiveIntensity: 0.45,
    }),
  );

  // ---- 内凹矢量喷口 + 体积等离子尾焰系统 ----
  const plumeCoreCol = accentCol.clone().lerp(new THREE.Color(0xffffff), 0.48);
  const plumeOuterCol = spec.id === 'glider' ? new THREE.Color(0xff7248) : accentCol.clone().lerp(new THREE.Color(0x4cb8ff), 0.55);

  const plumeMat = trackMat(
    new THREE.ShaderMaterial({
      vertexShader: plumeVertex,
      fragmentShader: plumeFragment,
      uniforms: {
        uTime: { value: 0 },
        uThrust: { value: 0.35 },
        uCoreCol: { value: plumeCoreCol },
        uOuterCol: { value: plumeOuterCol },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    }),
  );
  const throatMat = trackMat(
    new THREE.MeshBasicMaterial({
      color: plumeCoreCol.clone().lerp(new THREE.Color(0xffffff), 0.55),
    }),
  );

  // 外层包裹的开放抛物面软壳（uv.y = 0 在喷口处，1 在尾部渐隐）
  const plumePts = [
    new THREE.Vector2(0.08, 0.0),
    new THREE.Vector2(0.115, 0.2),
    new THREE.Vector2(0.105, 0.55),
    new THREE.Vector2(0.072, 0.85),
    new THREE.Vector2(0.025, 1.0),
  ];
  const outerPlumeGeo = trackGeo(new THREE.LatheGeometry(plumePts, 20));
  const innerPlumePts = [
    new THREE.Vector2(0.052, 0.0),
    new THREE.Vector2(0.068, 0.22),
    new THREE.Vector2(0.045, 0.65),
    new THREE.Vector2(0.008, 1.0),
  ];
  const innerPlumeGeo = trackGeo(new THREE.LatheGeometry(innerPlumePts, 16));

  const nozzleBellGeo = trackGeo(
    new THREE.LatheGeometry(
      [
        new THREE.Vector2(0.09, -0.06),
        new THREE.Vector2(0.135, 0.02),
        new THREE.Vector2(0.165, 0.14),
        new THREE.Vector2(0.18, 0.24),
      ],
      18,
    ),
  );
  const nozzleRibGeo = trackGeo(new THREE.TorusGeometry(0.16, 0.014, 6, 20));
  const throatDiskGeo = trackGeo(new THREE.CircleGeometry(0.1, 16));

  const emitters: THREE.Object3D[] = [];

  function mountThruster(pos: THREE.Vector3, scale = 1.0) {
    const tGroup = new THREE.Group();
    tGroup.position.copy(pos);
    tGroup.scale.setScalar(scale);

    // 喷管钟罩（朝 +Z 方向张开）
    const bell = new THREE.Mesh(nozzleBellGeo, darkAlloyMat);
    bell.rotation.x = Math.PI * 0.5;
    tGroup.add(bell);

    for (const zOff of [0.06, 0.14, 0.21]) {
      const rib = new THREE.Mesh(nozzleRibGeo, titaniumMat);
      rib.position.z = zOff;
      rib.scale.setScalar(0.84 + zOff * 0.72);
      tGroup.add(rib);
    }

    // 喷口深处电离炽白喉芯
    const throat = new THREE.Mesh(throatDiskGeo, throatMat);
    throat.position.z = 0.02;
    tGroup.add(throat);

    // 双层体积等离子尾焰（y 轴正向映射到 +Z 尾流）
    const outerMesh = new THREE.Mesh(outerPlumeGeo, plumeMat);
    outerMesh.rotation.x = Math.PI * 0.5;
    outerMesh.position.z = 0.08;
    const innerMesh = new THREE.Mesh(innerPlumeGeo, plumeMat);
    innerMesh.rotation.x = Math.PI * 0.5;
    innerMesh.position.z = 0.08;
    tGroup.add(outerMesh, innerMesh);

    // 粒子的世界空间发射锚点
    const anchor = new THREE.Object3D();
    anchor.position.set(0, 0, 0.24);
    tGroup.add(anchor);
    emitters.push(anchor);

    body.add(tGroup);
  }

  // ---- 精细化飞船主体建模（局部前向为 -Z） ----
  if (spec.id === 'voyager') {
    // 十二棱金箔隔热舱 + 前锥传感器桅杆 + 机械三脚馈源天线碟 + 桁架展开式太阳能阵列
    const bus = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.32, 0.36, 0.62, 12)), goldMat);
    bus.rotation.x = Math.PI * 0.5;
    body.add(bus);

    // 舱体环箍筋条
    for (const zOff of [-0.26, 0, 0.26]) {
      const ring = new THREE.Mesh(trackGeo(new THREE.TorusGeometry(0.34, 0.02, 8, 24)), titaniumMat);
      ring.position.z = zOff;
      body.add(ring);
    }

    const fwdCollar = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.24, 0.34, 0.22, 12)), darkAlloyMat);
    fwdCollar.rotation.x = Math.PI * 0.5;
    fwdCollar.position.z = -0.4;
    body.add(fwdCollar);

    const noseCone = new THREE.Mesh(trackGeo(new THREE.ConeGeometry(0.22, 0.52, 12)), ceramicMat);
    noseCone.rotation.x = -Math.PI * 0.5;
    noseCone.position.z = -0.74;
    body.add(noseCone);

    const probeMast = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.022, 0.04, 0.34, 8)), titaniumMat);
    probeMast.rotation.x = Math.PI * 0.5;
    probeMast.position.z = -1.06;
    const sensorTip = new THREE.Mesh(trackGeo(new THREE.OctahedronGeometry(0.05, 0)), trimMat);
    sensorTip.position.z = -1.24;
    body.add(probeMast, sensorTip);

    // 背脊抛物面高增益天线 + 真三脚架馈源杆
    const dishGroup = new THREE.Group();
    dishGroup.position.set(0, 0.35, 0.02);
    dishGroup.rotation.x = 0.28;
    const dishBowl = new THREE.Mesh(
      trackGeo(
        new THREE.LatheGeometry(
          [
            new THREE.Vector2(0.03, 0.015),
            new THREE.Vector2(0.16, 0.04),
            new THREE.Vector2(0.3, 0.1),
            new THREE.Vector2(0.38, 0.17),
          ],
          24,
        ),
      ),
      ceramicMat,
    );
    const dishRim = new THREE.Mesh(trackGeo(new THREE.TorusGeometry(0.38, 0.016, 8, 28)), goldMat);
    dishRim.rotation.x = Math.PI * 0.5;
    dishRim.position.y = 0.17;
    const feedCap = new THREE.Mesh(trackGeo(new THREE.SphereGeometry(0.042, 10, 8)), trimMat);
    feedCap.position.y = 0.28;
    dishGroup.add(dishBowl, dishRim, feedCap);

    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2;
      const strut = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.009, 0.012, 0.3, 6)), titaniumMat);
      strut.position.set(Math.cos(a) * 0.14, 0.17, Math.sin(a) * 0.14);
      strut.lookAt(0, 0.28, 0);
      strut.rotateX(Math.PI * 0.5);
      dishGroup.add(strut);
    }
    body.add(dishGroup);

    // 双翼展开光伏阵列 + 铰链 + 磁强计长臂
    const panelGeo = trackGeo(new THREE.BoxGeometry(0.68, 0.026, 0.34));
    const frameGeo = trackGeo(new THREE.BoxGeometry(0.72, 0.036, 0.045));
    for (const sx of [-1, 1]) {
      const rootJoint = new THREE.Mesh(trackGeo(new THREE.SphereGeometry(0.08, 10, 8)), titaniumMat);
      rootJoint.position.set(sx * 0.36, 0, 0.08);
      body.add(rootJoint);

      const panel = new THREE.Mesh(panelGeo, darkAlloyMat);
      panel.position.set(sx * 0.78, 0, 0.08);
      panel.rotation.x = 0.1;
      body.add(panel);

      for (const zEdge of [-0.09, 0.25]) {
        const bar = new THREE.Mesh(frameGeo, goldMat);
        bar.position.set(sx * 0.78, 0.005, zEdge);
        bar.rotation.x = 0.1;
        body.add(bar);
      }

      const tipCap = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.06, 0.048, 0.38)), trimMat);
      tipCap.position.set(sx * 1.15, 0, 0.08);
      tipCap.rotation.x = 0.1;
      body.add(tipCap);

      // 外挂小型副推进舱 + 真实微型喷口
      const auxPod = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.078, 0.092, 0.44, 10)), titaniumMat);
      auxPod.rotation.x = Math.PI * 0.5;
      auxPod.position.set(sx * 0.31, -0.05, 0.22);
      body.add(auxPod);
      mountThruster(new THREE.Vector3(sx * 0.31, -0.05, 0.42), 0.56);
    }

    // 主尾部矢量推进器
    mountThruster(new THREE.Vector3(0, 0, 0.32), 1.05);
  } else if (spec.id === 'glider') {
    // 雕塑流线机身 + 金属框气泡座舱 + 双边条翼 + 折翼梢 + 双斜垂尾 + 双矢量加力喷口
    const fuselagePts = [
      new THREE.Vector2(0.01, -1.18),
      new THREE.Vector2(0.09, -0.92),
      new THREE.Vector2(0.19, -0.45),
      new THREE.Vector2(0.24, 0.08),
      new THREE.Vector2(0.22, 0.42),
    ];
    const fuselageGeo = trackGeo(new THREE.LatheGeometry(fuselagePts, 14));
    const fuselage = new THREE.Mesh(fuselageGeo, ceramicMat);
    fuselage.rotation.x = Math.PI * 0.5;
    fuselage.scale.set(1.24, 1, 0.68);
    body.add(fuselage);

    // 腹侧钛合金进气整流匣
    const belly = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.46, 0.11, 0.66)), darkAlloyMat);
    belly.position.set(0, -0.09, -0.05);
    body.add(belly);

    // 座舱盖 + 金属框筋
    const canopy = new THREE.Mesh(trackGeo(new THREE.CapsuleGeometry(0.11, 0.36, 8, 12)), visorMat);
    canopy.rotation.x = Math.PI * 0.5;
    canopy.scale.set(1.02, 1, 0.72);
    canopy.position.set(0, 0.12, -0.34);
    const canopyFrame = new THREE.Mesh(trackGeo(new THREE.TorusGeometry(0.11, 0.014, 6, 16)), titaniumMat);
    canopyFrame.scale.set(1.02, 0.74, 1);
    canopyFrame.position.set(0, 0.12, -0.26);
    body.add(canopy, canopyFrame);

    // 背脊朱红整流脊梁
    const spine = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.08, 0.09, 0.68)), trimMat);
    spine.position.set(0, 0.15, 0.08);
    body.add(spine);

    const mainWingGeo = trackGeo(makeWingGeometry(0.16, 0.88, 0.3, 0.74, 0.26, 0.058, 0.022));
    const strakeGeo = trackGeo(makeWingGeometry(0.1, 0.34, -0.2, 0.46, 0.16, 0.04, 0.02));
    const flapGeo = trackGeo(new THREE.BoxGeometry(0.44, 0.022, 0.09));
    const wingletGeo = trackGeo(new THREE.BoxGeometry(0.028, 0.2, 0.26));
    const finGeo = trackGeo(new THREE.BoxGeometry(0.03, 0.32, 0.34));

    for (const sx of [-1, 1]) {
      const wing = new THREE.Mesh(mainWingGeo, ceramicMat);
      if (sx < 0) wing.scale.x = -1;
      wing.position.set(0, -0.02, 0.08);
      body.add(wing);

      const strake = new THREE.Mesh(strakeGeo, trimMat);
      if (sx < 0) strake.scale.x = -1;
      strake.position.set(0, 0.01, -0.38);
      body.add(strake);

      const flap = new THREE.Mesh(flapGeo, darkAlloyMat);
      flap.position.set(sx * 0.56, -0.015, 0.44);
      flap.rotation.y = sx * -0.26;
      body.add(flap);

      const winglet = new THREE.Mesh(wingletGeo, trimMat);
      winglet.position.set(sx * 1.05, 0.075, 0.4);
      winglet.rotation.z = sx * -0.4;
      body.add(winglet);

      const fin = new THREE.Mesh(finGeo, titaniumMat);
      fin.position.set(sx * 0.28, 0.19, 0.32);
      fin.rotation.z = sx * -0.34;
      fin.rotation.x = 0.2;
      body.add(fin);

      const engTube = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.11, 0.125, 0.56, 12)), darkAlloyMat);
      engTube.rotation.x = Math.PI * 0.5;
      engTube.position.set(sx * 0.15, -0.01, 0.24);
      body.add(engTube);

      mountThruster(new THREE.Vector3(sx * 0.15, -0.01, 0.46), 0.72);
    }
  } else {
    // 蓝鲸重型深空穿梭艇：宽阔阶梯舰桥、多片散热背鳍、双侧大口径等离子短舱与双主引擎
    const hull = new THREE.Mesh(trackGeo(new THREE.CapsuleGeometry(0.24, 0.88, 10, 14)), cobaltMat);
    hull.rotation.x = Math.PI * 0.5;
    hull.scale.set(1.3, 0.74, 1);
    hull.position.set(0, 0.02, -0.08);
    body.add(hull);

    const armorNose = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.14, 0.25, 0.36, 10)), ceramicMat);
    armorNose.rotation.x = Math.PI * 0.5;
    armorNose.scale.set(1.22, 0.68, 1);
    armorNose.position.set(0, 0.01, -0.68);
    body.add(armorNose);

    // 舰桥多层全景舷窗
    const bridge = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.36, 0.11, 0.44)), visorMat);
    bridge.position.set(0, 0.14, -0.34);
    bridge.rotation.x = 0.14;
    const bridgeFrame = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.39, 0.03, 0.46)), titaniumMat);
    bridgeFrame.position.set(0, 0.1, -0.34);
    bridgeFrame.rotation.x = 0.14;
    body.add(bridge, bridgeFrame);

    // 背脊三片式散热鳍片阵列
    for (let r = 0; r < 3; r++) {
      const fin = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.025, 0.12, 0.44)), ceramicMat);
      fin.position.set((r - 1) * 0.075, 0.21, 0.12);
      body.add(fin);
    }

    const pylonGeo = trackGeo(makeWingGeometry(0.22, 0.46, 0.1, 0.48, 0.34, 0.06, 0.042));
    const nacGeo = trackGeo(new THREE.CylinderGeometry(0.125, 0.145, 0.96, 14));
    const intakeConeGeo = trackGeo(new THREE.ConeGeometry(0.075, 0.22, 10));
    const cowlGeo = trackGeo(new THREE.TorusGeometry(0.13, 0.022, 8, 20));
    const radiatorGeo = trackGeo(new THREE.BoxGeometry(0.022, 0.085, 0.58));

    for (const sx of [-1, 1]) {
      const pylon = new THREE.Mesh(pylonGeo, cobaltMat);
      if (sx < 0) pylon.scale.x = -1;
      pylon.position.set(0, 0, 0.04);
      body.add(pylon);

      const nac = new THREE.Mesh(nacGeo, darkAlloyMat);
      nac.rotation.x = Math.PI * 0.5;
      nac.position.set(sx * 0.68, -0.02, 0.1);
      body.add(nac);

      const spinner = new THREE.Mesh(intakeConeGeo, trimMat);
      spinner.rotation.x = -Math.PI * 0.5;
      spinner.position.set(sx * 0.68, -0.02, -0.42);
      body.add(spinner);

      const cowlFront = new THREE.Mesh(cowlGeo, ceramicMat);
      cowlFront.position.set(sx * 0.68, -0.02, -0.36);
      body.add(cowlFront);

      const radStrip = new THREE.Mesh(radiatorGeo, trimMat);
      radStrip.position.set(sx * 0.81, 0.02, 0.1);
      body.add(radStrip);

      mountThruster(new THREE.Vector3(sx * 0.68, -0.02, 0.54), 0.78);
    }

    // 尾部中央辅助主引擎
    mountThruster(new THREE.Vector3(0, 0.02, 0.46), 0.65);
  }

  // ---- 真实感物理尾迹粒子流（紧贴每个真实喷口后方在世界坐标里喷射消散，零硬折线） ----
  const P_COUNT = 84;
  const pPos = new Float32Array(P_COUNT * 3);
  const pVel = new Float32Array(P_COUNT * 3);
  const pLife = new Float32Array(P_COUNT);
  const pSize = new Float32Array(P_COUNT);
  for (let i = 0; i < P_COUNT; i++) {
    pLife[i] = i / P_COUNT;
    pSize[i] = 1.0;
  }

  const pGeo = trackGeo(new THREE.BufferGeometry());
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  pGeo.setAttribute('aLife', new THREE.BufferAttribute(pLife, 1));
  pGeo.setAttribute('aSize', new THREE.BufferAttribute(pSize, 1));

  const pMat = trackMat(
    new THREE.ShaderMaterial({
      vertexShader: /* glsl */ `
        attribute float aLife;
        attribute float aSize;
        uniform float uTrailScale;
        varying float vLife;
        void main() {
          vLife = aLife;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp((18.0 + aSize * 12.0) * uTrailScale * (1.0 - aLife * 0.55) / max(-mv.z, 0.18), 1.5, 18.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vLife;
        uniform vec3 uCoreCol;
        uniform vec3 uOuterCol;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float r2 = dot(c, c) * 4.0;
          if (r2 > 1.0) discard;
          float alpha = pow(1.0 - r2, 1.8) * (1.0 - smoothstep(0.15, 1.0, vLife));
          vec3 col = mix(uCoreCol, uOuterCol, smoothstep(0.0, 0.65, vLife));
          gl_FragColor = vec4(col * 1.1, alpha * 0.72);
        }
      `,
      uniforms: {
        uCoreCol: { value: plumeCoreCol.clone().lerp(new THREE.Color(0xffffff), 0.3) },
        uOuterCol: { value: plumeOuterCol },
        uTrailScale: { value: 1 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  const trail = new THREE.Points(pGeo, pMat);
  trail.frustumCulled = false;

  const spawnPos = new THREE.Vector3();
  const aftDir = new THREE.Vector3();
  const worldQuat = new THREE.Quaternion();
  let spawnCursor = 0;
  let spawnAccum = 0;

  function spawnParticle(boostFactor: number) {
    const sc = Math.max(root.scale.x, 0.1);
    const anchor = emitters[spawnCursor % emitters.length];
    spawnCursor++;
    anchor.getWorldPosition(spawnPos);
    root.getWorldQuaternion(worldQuat);
    aftDir.set(0, 0, 1).applyQuaternion(worldQuat);

    const idx = Math.floor(Math.random() * P_COUNT);
    const b = idx * 3;
    const jitter = 0.045 * sc;
    pPos[b] = spawnPos.x + (Math.random() - 0.5) * jitter;
    pPos[b + 1] = spawnPos.y + (Math.random() - 0.5) * jitter;
    pPos[b + 2] = spawnPos.z + (Math.random() - 0.5) * jitter;

    const ejectSpeed = (3.2 + boostFactor * 5.2 + Math.random() * 1.6) * sc;
    const spread = (0.35 + boostFactor * 0.25) * sc;
    pVel[b] = aftDir.x * ejectSpeed + (Math.random() - 0.5) * spread;
    pVel[b + 1] = aftDir.y * ejectSpeed + (Math.random() - 0.5) * spread;
    pVel[b + 2] = aftDir.z * ejectSpeed + (Math.random() - 0.5) * spread;
    pLife[idx] = 0.001;
    pSize[idx] = 0.6 + boostFactor * 0.7 + Math.random() * 0.35;
  }

  function resetTrail() {
    root.updateMatrixWorld(true);
    const anchor = emitters[0];
    anchor.getWorldPosition(spawnPos);
    for (let i = 0; i < P_COUNT; i++) {
      const b = i * 3;
      pPos[b] = spawnPos.x;
      pPos[b + 1] = spawnPos.y;
      pPos[b + 2] = spawnPos.z;
      pVel[b] = 0;
      pVel[b + 1] = 0;
      pVel[b + 2] = 0;
      pLife[i] = 1.0;
    }
    pGeo.attributes.position.needsUpdate = true;
    pGeo.attributes.aLife.needsUpdate = true;
  }

  function updateVisuals(simTime: number, _dt: number, boostFactor: number) {
    plumeMat.uniforms.uTime.value = simTime;
    plumeMat.uniforms.uThrust.value = 0.25 + boostFactor * 0.85;
  }

  function updateTrail(dt: number, boostFactor: number) {
    if (dt <= 0) return;
    root.updateMatrixWorld(true);
    pMat.uniforms.uTrailScale.value = Math.max(root.scale.x, 0.1);
    const rate = 42 + boostFactor * 85;
    spawnAccum += dt * rate;
    const nSpawn = Math.min(Math.floor(spawnAccum), 8);
    spawnAccum -= nSpawn;
    for (let s = 0; s < nSpawn; s++) {
      spawnParticle(boostFactor);
    }

    const lifeRate = 1.65 - boostFactor * 0.25;
    for (let i = 0; i < P_COUNT; i++) {
      if (pLife[i] >= 1.0) continue;
      pLife[i] = Math.min(1.0, pLife[i] + dt * lifeRate);
      const b = i * 3;
      pPos[b] += pVel[b] * dt;
      pPos[b + 1] += pVel[b + 1] * dt;
      pPos[b + 2] += pVel[b + 2] * dt;
    }
    pGeo.attributes.position.needsUpdate = true;
    pGeo.attributes.aLife.needsUpdate = true;
    pGeo.attributes.aSize.needsUpdate = true;
  }

  function dispose() {
    for (const g of geometries) g.dispose();
    for (const m of materials) m.dispose();
  }

  return { root, body, trail, updateVisuals, updateTrail, resetTrail, dispose };
}
