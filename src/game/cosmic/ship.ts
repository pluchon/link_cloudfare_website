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

// 喷气式加力尾焰系统：外层包络锥 + 内层马赫环激波菱形核 + 正交体积火焰翼（零离散圆球粒子）
const OUTER_PLUME_LEN = 1.45;
const INNER_PLUME_LEN = 1.08;
const FIN_PLUME_LEN = 1.38;

const jetConeVertex = /* glsl */ `
  varying float vAxial;
  varying float vAngle;
  varying vec3 vNormalV;
  varying vec3 vViewPos;
  uniform float uTime;
  uniform float uThrust;
  uniform float uLen;

  void main() {
    float t = clamp(position.y / max(uLen, 0.001), 0.0, 1.0);
    vAxial = t;
    vAngle = atan(position.z, position.x);

    float pulse = 1.0 + 0.032 * sin(uTime * 42.0 - t * 6.0) * (0.35 + uThrust);
    float lenScale = (0.88 + uThrust * 0.86) * pulse;

    // 喷口内部喉部锁定，仅末端随高速喷流产生细微热颤与极轻微收敛/膨胀呼吸
    float tipMask = t * t;
    float radialBreath = 1.0 + (0.045 * sin(uTime * 34.0 - t * 9.0) + 0.08 * uThrust) * smoothstep(0.05, 0.55, t);

    vec3 pos = position;
    pos.xz *= radialBreath;
    pos.y *= lenScale;
    pos.x += sin(uTime * 48.0 + t * 7.5) * 0.011 * tipMask * (0.4 + uThrust);
    pos.z += cos(uTime * 43.0 + t * 8.2) * 0.011 * tipMask * (0.4 + uThrust);

    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    vViewPos = -mv.xyz;
    vNormalV = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * mv;
  }
`;

const jetConeFragment = /* glsl */ `
  varying float vAxial;
  varying float vAngle;
  varying vec3 vNormalV;
  varying vec3 vViewPos;
  uniform float uTime;
  uniform float uThrust;
  uniform float uMode; // 0.0 = 外层高温射流包络, 1.0 = 内层马赫环激波核
  uniform vec3 uHotCol;
  uniform vec3 uMidCol;
  uniform vec3 uOuterCol;

  void main() {
    float t = vAxial;
    float nLen = length(vNormalV);
    float vLen = length(vViewPos);
    vec3 n = nLen > 1e-5 ? vNormalV / nLen : vec3(0.0, 0.0, 1.0);
    vec3 v = vLen > 1e-5 ? vViewPos / vLen : vec3(0.0, 0.0, 1.0);
    float rim = abs(dot(n, v));

    // 柔和菲涅尔边缘消除多边形轮廓硬边
    float radial = uMode > 0.5 ? pow(rim, 1.85) : pow(rim, 1.32);

    // 高速轴向喷流条纹（基于无缝圆周角，零 UV 接缝）
    float streakA = 0.82 + 0.18 * sin(t * 22.0 - uTime * 54.0 + cos(vAngle * 3.0) * 1.1);
    float streakB = 0.88 + 0.12 * cos(t * 34.0 - uTime * 72.0 + sin(vAngle * 5.0) * 1.4);
    float flow = streakA * streakB;

    // 驻波马赫环激波节点（近喷口密集明亮，向尾端渐弱）
    float machFreq = uMode > 0.5 ? 24.0 : 18.0;
    float machWave = 0.5 + 0.5 * cos(t * machFreq - uTime * 4.5 - 0.55);
    float machRing = pow(machWave, uMode > 0.5 ? 2.6 : 3.2) * (1.0 - smoothstep(0.08, 0.82, t));

    // 从喷口点火起步并按气动尖锥收尾
    float ignite = smoothstep(0.0, 0.045, t);
    float tailFade = pow(clamp(1.0 - smoothstep(0.12, 1.0, t), 0.0, 1.0), uMode > 0.5 ? 1.35 : 1.55);

    vec3 col = mix(uOuterCol, uMidCol, smoothstep(0.12, 0.72, radial * (1.05 - t * 0.45)));
    float hotAmt = clamp(
      (1.0 - smoothstep(0.0, 0.62, t)) * pow(rim, uMode > 0.5 ? 1.4 : 2.6) + machRing * (0.45 + 0.4 * uThrust),
      0.0,
      1.0
    );
    col = mix(col, uHotCol, hotAmt);

    float baseAlpha = uMode > 0.5 ? (0.46 + 0.34 * uThrust) : (0.52 + 0.32 * uThrust);
    float alpha = ignite * tailFade * radial * flow * (baseAlpha + machRing * (0.28 + 0.25 * uThrust));
    if (alpha < 0.008) discard;

    float radiance = uMode > 0.5 ? (1.15 + 0.65 * machRing + 0.25 * uThrust) : (0.95 + 0.45 * hotAmt + 0.2 * uThrust);
    gl_FragColor = vec4(col * radiance, clamp(alpha, 0.0, 1.0));
  }
`;

const jetFinVertex = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormalV;
  varying vec3 vViewPos;
  uniform float uTime;
  uniform float uThrust;

  void main() {
    vUv = uv;
    float t = uv.y;
    float pulse = 1.0 + 0.032 * sin(uTime * 42.0 - t * 6.0) * (0.35 + uThrust);
    float lenScale = (0.88 + uThrust * 0.86) * pulse;
    float tipMask = t * t;
    float radialBreath = 1.0 + (0.045 * sin(uTime * 34.0 - t * 9.0) + 0.08 * uThrust) * smoothstep(0.05, 0.55, t);

    vec3 pos = position;
    pos.xz *= radialBreath;
    pos.y *= lenScale;
    pos.x += sin(uTime * 48.0 + t * 7.5) * 0.011 * tipMask * (0.4 + uThrust);
    pos.z += cos(uTime * 43.0 + t * 8.2) * 0.011 * tipMask * (0.4 + uThrust);

    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    vViewPos = -mv.xyz;
    vNormalV = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * mv;
  }
`;

const jetFinFragment = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormalV;
  varying vec3 vViewPos;
  uniform float uTime;
  uniform float uThrust;
  uniform vec3 uHotCol;
  uniform vec3 uMidCol;
  uniform vec3 uOuterCol;

  void main() {
    float t = vUv.y;
    float nx = (vUv.x - 0.5) * 2.0;
    float nLen = length(vNormalV);
    float vLen = length(vViewPos);
    vec3 n = nLen > 1e-5 ? vNormalV / nLen : vec3(0.0, 0.0, 1.0);
    vec3 v = vLen > 1e-5 ? vViewPos / vLen : vec3(0.0, 0.0, 1.0);

    // 掠射角平滑消隐，防止正对片面边缘时出现细线穿帮
    float angleFade = smoothstep(0.07, 0.42, abs(dot(n, v)));

    float transverse = exp(-nx * nx * 4.6);
    float coreGauss = exp(-nx * nx * 12.0);
    float streak = 0.84 + 0.16 * sin(t * 26.0 - uTime * 62.0 + nx * 2.4);
    float machWave = 0.5 + 0.5 * cos(t * 22.0 - uTime * 3.5 - 0.4);
    float machDiamond = pow(machWave, 3.0) * (1.0 - smoothstep(0.05, 0.80, t));

    float ignite = smoothstep(0.0, 0.05, t);
    float tailFade = pow(clamp(1.0 - smoothstep(0.08, 1.0, t), 0.0, 1.0), 1.45);

    vec3 col = mix(uOuterCol, uMidCol, smoothstep(0.15, 0.85, transverse));
    float hotAmt = clamp(coreGauss * (1.0 - smoothstep(0.0, 0.72, t)) + machDiamond * coreGauss * 0.85, 0.0, 1.0);
    col = mix(col, uHotCol, hotAmt);

    float alpha = angleFade * ignite * tailFade * transverse * streak * (0.42 + 0.34 * uThrust + machDiamond * 0.24);
    if (alpha < 0.008) discard;

    gl_FragColor = vec4(col * (1.05 + 0.45 * hotAmt + 0.25 * uThrust), clamp(alpha, 0.0, 1.0));
  }
`;

function makeFlameFinGeometry(len: number): THREE.BufferGeometry {
  const segs = 14;
  // 按尾焰外包络比例插值每一节半宽，形成顺滑收尖的喷气焰心翼
  const profile: [number, number][] = [
    [0.0, 0.088],
    [0.09, 0.118],
    [0.24, 0.106],
    [0.48, 0.076],
    [0.74, 0.042],
    [1.0, 0.008],
  ];
  function halfWidthAt(u: number): number {
    for (let k = 0; k < profile.length - 1; k++) {
      const [u0, w0] = profile[k];
      const [u1, w1] = profile[k + 1];
      if (u <= u1) {
        const f = (u - u0) / Math.max(u1 - u0, 1e-5);
        return w0 + (w1 - w0) * f;
      }
    }
    return profile[profile.length - 1][1];
  }

  const positions = new Float32Array((segs + 1) * 2 * 3);
  const normals = new Float32Array((segs + 1) * 2 * 3);
  const uvs = new Float32Array((segs + 1) * 2 * 2);
  const indices: number[] = [];

  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const y = t * len;
    const hw = halfWidthAt(t);

    const v0 = i * 2;
    positions[v0 * 3] = -hw;
    positions[v0 * 3 + 1] = y;
    positions[v0 * 3 + 2] = 0;
    normals[v0 * 3] = 0;
    normals[v0 * 3 + 1] = 0;
    normals[v0 * 3 + 2] = 1;
    uvs[v0 * 2] = 0;
    uvs[v0 * 2 + 1] = t;

    const v1 = i * 2 + 1;
    positions[v1 * 3] = hw;
    positions[v1 * 3 + 1] = y;
    positions[v1 * 3 + 2] = 0;
    normals[v1 * 3] = 0;
    normals[v1 * 3 + 1] = 0;
    normals[v1 * 3 + 2] = 1;
    uvs[v1 * 2] = 1;
    uvs[v1 * 2 + 1] = t;

    if (i < segs) {
      const a = v0;
      const b = v1;
      const c = v0 + 2;
      const d = v1 + 2;
      indices.push(a, b, c, b, d, c);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

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

  // ---- 内凹矢量喷口 + 连续喷气加力尾焰系统 ----
  const palette =
    spec.id === 'glider'
      ? { hot: 0xfff8e8, mid: 0xffa03d, outer: 0xf03a18 }
      : spec.id === 'voyager'
        ? { hot: 0xfffaeb, mid: 0xffc852, outer: 0xe86b1c }
        : { hot: 0xf2fdff, mid: 0x5ce2ff, outer: 0x1860f5 };

  const hotCol = new THREE.Color(palette.hot);
  const midCol = new THREE.Color(palette.mid);
  const outerCol = new THREE.Color(palette.outer);
  const throatCoolCol = midCol.clone().lerp(hotCol, 0.35);

  const outerPlumeMat = trackMat(
    new THREE.ShaderMaterial({
      vertexShader: jetConeVertex,
      fragmentShader: jetConeFragment,
      uniforms: {
        uTime: { value: 0 },
        uThrust: { value: 0.35 },
        uLen: { value: OUTER_PLUME_LEN },
        uMode: { value: 0.0 },
        uHotCol: { value: hotCol },
        uMidCol: { value: midCol },
        uOuterCol: { value: outerCol },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    }),
  );

  const innerPlumeMat = trackMat(
    new THREE.ShaderMaterial({
      vertexShader: jetConeVertex,
      fragmentShader: jetConeFragment,
      uniforms: {
        uTime: { value: 0 },
        uThrust: { value: 0.35 },
        uLen: { value: INNER_PLUME_LEN },
        uMode: { value: 1.0 },
        uHotCol: { value: hotCol },
        uMidCol: { value: midCol },
        uOuterCol: { value: midCol },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    }),
  );

  const finPlumeMat = trackMat(
    new THREE.ShaderMaterial({
      vertexShader: jetFinVertex,
      fragmentShader: jetFinFragment,
      uniforms: {
        uTime: { value: 0 },
        uThrust: { value: 0.35 },
        uHotCol: { value: hotCol },
        uMidCol: { value: midCol },
        uOuterCol: { value: outerCol },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    }),
  );

  const throatMat = trackMat(
    new THREE.MeshBasicMaterial({
      color: throatCoolCol.clone(),
    }),
  );

  // 外层喷气焰锥：喉部贴合喷管内腔，出喷口后平滑膨胀至气动腰线并顺滑收尖
  const outerPlumeGeo = trackGeo(
    new THREE.LatheGeometry(
      [
        new THREE.Vector2(0.095, 0.0),
        new THREE.Vector2(0.128, 0.14),
        new THREE.Vector2(0.122, 0.34),
        new THREE.Vector2(0.095, 0.65),
        new THREE.Vector2(0.056, 1.02),
        new THREE.Vector2(0.022, 1.28),
        new THREE.Vector2(0.004, OUTER_PLUME_LEN),
      ],
      28,
    ),
  );

  // 内层马赫激波高能芯：更收拢聚焦的激波核锥
  const innerPlumeGeo = trackGeo(
    new THREE.LatheGeometry(
      [
        new THREE.Vector2(0.064, 0.0),
        new THREE.Vector2(0.078, 0.14),
        new THREE.Vector2(0.062, 0.42),
        new THREE.Vector2(0.032, 0.78),
        new THREE.Vector2(0.003, INNER_PLUME_LEN),
      ],
      22,
    ),
  );

  // 正交十字立体焰芯翼：保证任意追踪/侧视角度都有致密喷气焰体
  const finGeo = trackGeo(makeFlameFinGeometry(FIN_PLUME_LEN));

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
  const throatDiskGeo = trackGeo(new THREE.CircleGeometry(0.108, 18));

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

    // 三层连续喷气式加力尾焰（从喉部 z = 0.05 顺滑喷出至 +Z 尾流，renderOrder 后置防遮挡）
    const plumeGroup = new THREE.Group();
    plumeGroup.position.z = 0.05;
    plumeGroup.rotation.x = Math.PI * 0.5;

    const outerMesh = new THREE.Mesh(outerPlumeGeo, outerPlumeMat);
    outerMesh.renderOrder = 4;

    const innerMesh = new THREE.Mesh(innerPlumeGeo, innerPlumeMat);
    innerMesh.renderOrder = 5;

    const finA = new THREE.Mesh(finGeo, finPlumeMat);
    finA.renderOrder = 5;
    const finB = new THREE.Mesh(finGeo, finPlumeMat);
    finB.rotation.y = Math.PI * 0.5;
    finB.renderOrder = 5;

    plumeGroup.add(outerMesh, innerMesh, finA, finB);
    tGroup.add(plumeGroup);

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

  // 保留空 Group 以兼容 game.ts 的 scene 挂接与销毁协议，彻底取消离散球状尾迹粒子
  const trail = new THREE.Group();

  function resetTrail() {}

  function updateVisuals(simTime: number, _dt: number, boostFactor: number) {
    const thrust = Math.max(0, Math.min(1, boostFactor));
    outerPlumeMat.uniforms.uTime.value = simTime;
    outerPlumeMat.uniforms.uThrust.value = thrust;
    innerPlumeMat.uniforms.uTime.value = simTime;
    innerPlumeMat.uniforms.uThrust.value = thrust;
    finPlumeMat.uniforms.uTime.value = simTime;
    finPlumeMat.uniforms.uThrust.value = thrust;
    throatMat.color.copy(throatCoolCol).lerp(hotCol, 0.25 + thrust * 0.75);
  }

  function updateTrail(_dt: number, _boostFactor: number) {}

  function dispose() {
    for (const g of geometries) g.dispose();
    for (const m of materials) m.dispose();
  }

  return { root, body, trail, updateVisuals, updateTrail, resetTrail, dispose };
}
