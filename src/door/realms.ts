import * as THREE from 'three';
import { warpBeta, warpCenter, warpGlsl, warpImage, warpMaterial, warpScale } from './warp';

// 各星域核内的轻量化 3D 轨道景物（基地中继浮标阵 / 画廊晶体星碑 / 游戏能量航标塔 / 标签光谱棱板 / 关于浑仪星环）：
// 纯代码数学生成低面数几何体（零外部模型下载、零加载等待、< 1ms 初始化），
// 每个星域仅用 1 次 InstancedMesh 绘制调用 + 2 组虚线导引环，自动服从引力透镜与深度遮挡。

const realmVertex = /* glsl */ `
  ${warpGlsl}
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying vec3 vColor;
  uniform vec3 uColor;
  void main() {
    mat4 m = modelMatrix;
    #ifdef USE_INSTANCING
    m = m * instanceMatrix;
    #endif
    vec4 world = m * vec4(position, 1.0);
    vWorld = world.xyz;
    vNormal = normalize(mat3(m) * normal);
    #ifdef USE_INSTANCING_COLOR
    vColor = instanceColor;
    #else
    vColor = uColor;
    #endif
    gl_Position = warpClip(projectionMatrix * viewMatrix * vec4(spaceWarp(world.xyz), 1.0));
  }
`;

const realmFragment = /* glsl */ `
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying vec3 vColor;
  varying vec3 vWarpTint;
  uniform vec3 uWarpCenter;
  uniform vec3 uLightCol;
  uniform vec3 uRimCol;
  uniform float uGlowGain;
  uniform float uOpacity;
  uniform float uWarpImage;

  void main() {
    if (uOpacity <= 0.005) discard;
    vec3 faceN = normalize(cross(dFdx(vWorld), dFdy(vWorld))) * (uWarpImage > 0.5 ? -1.0 : 1.0);
    vec3 n = faceN;
    vec3 toLight = normalize(uWarpCenter - vWorld);
    vec3 viewDir = normalize(cameraPosition - vWorld);
    float ndl = max(dot(n, toLight), 0.0);
    float ndv = max(dot(n, viewDir), 0.0);
    float fresnel = pow(1.0 - ndv, 2.8) * (0.28 + 0.72 * smoothstep(-0.2, 0.55, dot(n, toLight)));
    float facetSpec = pow(max(dot(reflect(-toLight, n), viewDir), 0.0), 14.0) * 0.65;

    vec3 col =
      vColor * (vec3(0.06, 0.05, 0.09) + ndl * uLightCol + facetSpec * uLightCol) +
      uRimCol * (fresnel * uGlowGain);
    gl_FragColor = vec4(col * vWarpTint * uOpacity, uOpacity);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// 基地外围引力监测浮标（扁棱观测翼 + 菱心结构）
function relayGeometry(): THREE.BufferGeometry {
  const geo = new THREE.OctahedronGeometry(1, 0);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    pos.setXYZ(i, x * 1.15, y * 0.55, z * 0.42);
  }
  geo.computeVertexNormals();
  return geo;
}

// 低面晶体菱柱（画廊：8 面长棱晶雕塑）
function crystalGeometry(): THREE.BufferGeometry {
  const geo = new THREE.OctahedronGeometry(1, 0);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    pos.setXYZ(i, x * 0.42, y * 1.48, z * 0.34);
  }
  geo.computeVertexNormals();
  return geo;
}

// 低面航天信标棱塔（游戏：双锥尖塔结构）
function pylonGeometry(): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(0.18, 0.52, 2.1, 4, 1);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const flare = y > 0.6 ? 0.55 : 1.0;
    pos.setXYZ(i, x * flare, y, z * flare);
  }
  geo.computeVertexNormals();
  return geo;
}

// 六角光谱索引棱板（标签：切面索引石板）
function prismGeometry(): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(0.56, 0.44, 1.8, 6, 1);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    pos.setXYZ(i, x * 1.15, y, z * 0.34);
  }
  geo.computeVertexNormals();
  return geo;
}

// 切面天文浑仪星环（关于：档案天文仪环）
function astrolabeGeometry(): THREE.BufferGeometry {
  const geo = new THREE.TorusGeometry(0.92, 0.14, 4, 10);
  geo.computeVertexNormals();
  return geo;
}

function buildOrbitRing(radius: number, tiltX: number, tiltZ: number, hex: number, segments = 140) {
  const pts: number[] = [];
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(tiltX, 0, tiltZ));
  const v = new THREE.Vector3();
  for (let i = 0; i < segments; i++) {
    if (i % 3 === 2) continue;
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;
    v.set(Math.cos(a0) * radius, 0, Math.sin(a0) * radius).applyQuaternion(q);
    pts.push(v.x, v.y, v.z);
    v.set(Math.cos(a1) * radius, 0, Math.sin(a1) * radius).applyQuaternion(q);
    pts.push(v.x, v.y, v.z);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const mat = new THREE.LineBasicMaterial({
    color: hex,
    transparent: true,
    opacity: 0.24,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  warpMaterial(mat);
  const lines = new THREE.LineSegments(geo, mat);
  lines.frustumCulled = false;
  return { lines, geo, mat };
}

interface OrbitalItem {
  a: number;
  rad: number;
  y: number;
  sc: number;
  speed: number;
  spin: [number, number, number];
}

interface OrbitalSet {
  container: THREE.Group;
  geo: THREE.BufferGeometry;
  mat: THREE.ShaderMaterial;
  mesh: THREE.InstancedMesh;
  specs: OrbitalItem[];
  rings: { ring: ReturnType<typeof buildOrbitRing>; alpha: number }[];
  bobAmp: number;
  bobRate: number;
  spinRate: [number, number, number];
}

function makeSet(
  geo: THREE.BufferGeometry,
  lightHex: [number, number, number],
  rimHex: number,
  glowGain: number,
  defaultColor: number,
  specs: OrbitalItem[],
  colorFn: (i: number) => THREE.Color,
  rings: { radius: number; tilt: [number, number]; hex: number; alpha: number }[],
  motion: { bobAmp: number; bobRate: number; spinRate: [number, number, number] },
): OrbitalSet {
  const container = new THREE.Group();
  const mat = new THREE.ShaderMaterial({
    vertexShader: realmVertex,
    fragmentShader: realmFragment,
    transparent: true,
    depthWrite: true,
    uniforms: {
      uColor: { value: new THREE.Color(defaultColor) },
      uLightCol: { value: new THREE.Color(...lightHex) },
      uRimCol: { value: new THREE.Color(rimHex) },
      uGlowGain: { value: glowGain },
      uOpacity: { value: 0 },
      uWarpBeta: warpBeta,
      uWarpImage: warpImage,
      uWarpCenter: warpCenter,
      uWarpScale: warpScale,
    },
  });
  const mesh = new THREE.InstancedMesh(geo, mat, specs.length);
  mesh.frustumCulled = false;
  specs.forEach((_, i) => mesh.setColorAt(i, colorFn(i)));
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  container.add(mesh);

  const builtRings = rings.map((r) => {
    const built = buildOrbitRing(r.radius, r.tilt[0], r.tilt[1], r.hex);
    container.add(built.lines);
    return { ring: built, alpha: r.alpha };
  });

  return {
    container,
    geo,
    mat,
    mesh,
    specs,
    rings: builtRings,
    bobAmp: motion.bobAmp,
    bobRate: motion.bobRate,
    spinRate: motion.spinRate,
  };
}

export interface RealmPropsHandle {
  group: THREE.Group;
  update: (theme: number, opacity: number, simTime: number, center: THREE.Vector3, scale: number) => void;
  dispose: () => void;
}

export function buildRealmProps(lite: boolean): RealmPropsHandle {
  const group = new THREE.Group();
  group.visible = false;

  // ---- 0. 基地（人马座 A*）：近盘观测浮标参照剪影 + 外层高低轨中继站 ----
  const rBase = rng(1042);
  const baseCount = lite ? 12 : 22;
  const baseSpecs: OrbitalItem[] = Array.from({ length: baseCount }, (_, i) => {
    const nearScale = i < 6;
    const a = (i / baseCount) * Math.PI * 2 + (rBase() - 0.5) * 0.25;
    const rad = nearScale ? 11.2 + rBase() * 3.8 : 40 + rBase() * 44;
    const y = nearScale ? (i % 2 === 0 ? 1 : -1) * (1.8 + rBase() * 1.4) : (i % 2 === 0 ? 1 : -1) * (5 + rBase() * 12);
    const sc = nearScale ? 0.14 + rBase() * 0.1 : 0.34 + rBase() * 0.38;
    const speed = 0.036 * Math.pow(24 / rad, 1.4);
    const spin: [number, number, number] = [rBase() * 0.3, rBase() * 6, rBase() * 0.3];
    return { a, rad, y, sc, speed, spin };
  });
  const baseSet = makeSet(
    relayGeometry(),
    [1.12, 0.86, 0.62],
    0x7fb4ff,
    0.95,
    0xefe2cc,
    baseSpecs,
    (i) => (i % 3 === 0 ? new THREE.Color(0xffcf94) : new THREE.Color(0xc4daf8)),
    [
      { radius: 41, tilt: [0.14, -0.09], hex: 0xffcf92, alpha: 0.14 },
      { radius: 78, tilt: [-0.18, 0.12], hex: 0x7cb8ff, alpha: 0.11 },
    ],
    { bobAmp: 0.3, bobRate: 0.55, spinRate: [0.06, 0.22, 0] },
  );

  // ---- 1. 画廊星系：漂浮晶体星碑 + 玫瑰紫轨线 ----
  const rGal = rng(7026);
  const galCount = lite ? 14 : 26;
  const galSpecs: OrbitalItem[] = Array.from({ length: galCount }, (_, i) => {
    const nearScale = i < 6;
    const a = (i / galCount) * Math.PI * 2 + (rGal() - 0.5) * 0.28;
    const rad = nearScale ? 11.5 + rGal() * 4.5 : 19 + rGal() * 25;
    const y = (rGal() - 0.5) * (nearScale ? 2.4 : 7.5);
    const sc = nearScale ? 0.16 + rGal() * 0.14 : 0.45 + rGal() * 0.65;
    const speed = 0.042 * Math.pow(20 / rad, 1.4);
    const spin: [number, number, number] = [rGal() * 6, rGal() * 6, rGal() * 6];
    return { a, rad, y, sc, speed, spin };
  });
  const galSet = makeSet(
    crystalGeometry(),
    [1.05, 0.72, 0.88],
    0xd29aff,
    1.05,
    0xecd4ea,
    galSpecs,
    () => new THREE.Color().setHSL(0.88 + rGal() * 0.14, 0.42, 0.76 + rGal() * 0.16),
    [
      { radius: 22, tilt: [0.18, -0.14], hex: 0xf29cd8, alpha: 0.22 },
      { radius: 34, tilt: [-0.24, 0.2], hex: 0xb89cff, alpha: 0.15 },
    ],
    { bobAmp: 0.5, bobRate: 0.6, spinRate: [0.18, 0.24, 0] },
  );

  // ---- 2. 游戏星系：轨道能量航标棱塔 + 电离青金轨线 ----
  const rGame = rng(4321);
  const gameCount = lite ? 12 : 20;
  const gameSpecs: OrbitalItem[] = Array.from({ length: gameCount }, (_, i) => {
    const nearBeacon = i < 5;
    const a = (i / gameCount) * Math.PI * 2 + (rGame() - 0.5) * 0.22;
    const rad = nearBeacon ? 12 + rGame() * 4.5 : 21 + (i % 3) * 10 + rGame() * 5;
    const y = (rGame() - 0.5) * (nearBeacon ? 2.2 : 6.0);
    const sc = nearBeacon ? 0.15 + rGame() * 0.13 : 0.45 + rGame() * 0.52;
    const speed = 0.064 * Math.pow(20 / rad, 1.4);
    const spin: [number, number, number] = [rGame() * 0.4 - 0.2, rGame() * 6, rGame() * 0.4 - 0.2];
    return { a, rad, y, sc, speed, spin };
  });
  const gameSet = makeSet(
    pylonGeometry(),
    [0.75, 0.94, 1.15],
    0x52e0ff,
    1.25,
    0x9ed8ee,
    gameSpecs,
    (i) => (i % 3 === 0 ? new THREE.Color(0xffc978) : new THREE.Color(0x88dcff)),
    [
      { radius: 23, tilt: [-0.16, 0.14], hex: 0x5ae0ff, alpha: 0.25 },
      { radius: 37, tilt: [0.22, -0.18], hex: 0xffbe6b, alpha: 0.18 },
    ],
    { bobAmp: 0.35, bobRate: 0.8, spinRate: [0, 0.32, 0] },
  );

  // ---- 3. 标签星系：翡翠光谱索引棱板 + 青碧/星蓝轨线 ----
  const rTags = rng(1237);
  const tagsCount = lite ? 14 : 24;
  const tagsSpecs: OrbitalItem[] = Array.from({ length: tagsCount }, (_, i) => {
    const nearScale = i < 6;
    const a = (i / tagsCount) * Math.PI * 2 + (rTags() - 0.5) * 0.24;
    const rad = nearScale ? 11.4 + rTags() * 4.4 : 20 + rTags() * 24;
    const y = (rTags() - 0.5) * (nearScale ? 2.4 : 7.0);
    const sc = nearScale ? 0.15 + rTags() * 0.12 : 0.42 + rTags() * 0.54;
    const speed = 0.048 * Math.pow(20 / rad, 1.4);
    const spin: [number, number, number] = [rTags() * 0.5 - 0.25, rTags() * 6, rTags() * 0.5 - 0.25];
    return { a, rad, y, sc, speed, spin };
  });
  const tagsSet = makeSet(
    prismGeometry(),
    [0.55, 1.15, 0.88],
    0x52f2b8,
    1.15,
    0xcffce8,
    tagsSpecs,
    (i) => (i % 3 === 0 ? new THREE.Color(0xaad8ff) : new THREE.Color(0x82f4c4)),
    [
      { radius: 22, tilt: [0.22, 0.14], hex: 0x6ee7b7, alpha: 0.24 },
      { radius: 36, tilt: [-0.18, -0.22], hex: 0x93c5fd, alpha: 0.17 },
    ],
    { bobAmp: 0.42, bobRate: 0.72, spinRate: [0.08, 0.26, 0.05] },
  );

  // ---- 4. 关于星系：暮色天文浑仪环 + 珊瑚/月靛轨线 ----
  const rAbout = rng(2402);
  const aboutCount = lite ? 12 : 22;
  const aboutSpecs: OrbitalItem[] = Array.from({ length: aboutCount }, (_, i) => {
    const nearScale = i < 6;
    const a = (i / aboutCount) * Math.PI * 2 + (rAbout() - 0.5) * 0.26;
    const rad = nearScale ? 11.2 + rAbout() * 4.0 : 19 + rAbout() * 23;
    const y = (rAbout() - 0.5) * (nearScale ? 2.2 : 6.4);
    const sc = nearScale ? 0.15 + rAbout() * 0.13 : 0.44 + rAbout() * 0.52;
    const speed = 0.040 * Math.pow(20 / rad, 1.4);
    const spin: [number, number, number] = [rAbout() * 6, rAbout() * 6, rAbout() * 6];
    return { a, rad, y, sc, speed, spin };
  });
  const aboutSet = makeSet(
    astrolabeGeometry(),
    [1.16, 0.72, 0.56],
    0xff8a65,
    1.1,
    0xf7d8cc,
    aboutSpecs,
    (i) => (i % 3 === 0 ? new THREE.Color(0xb4c2ff) : new THREE.Color(0xffb08e)),
    [
      { radius: 21, tilt: [-0.20, -0.14], hex: 0xff9d76, alpha: 0.23 },
      { radius: 35, tilt: [0.24, 0.16], hex: 0xa5b4fc, alpha: 0.17 },
    ],
    { bobAmp: 0.36, bobRate: 0.54, spinRate: [0.16, 0.18, 0.12] },
  );

  const sets = [baseSet, galSet, gameSet, tagsSet, aboutSet];
  for (const set of sets) group.add(set.container);

  const dummy = new THREE.Object3D();

  const update = (theme: number, opacity: number, simTime: number, center: THREE.Vector3, scale: number) => {
    const show = opacity > 0.01;
    group.visible = show;
    if (!show) return;

    group.position.copy(center);
    group.scale.setScalar(scale);

    const activeIdx = Math.min(sets.length - 1, Math.max(0, Math.round(theme)));
    for (let k = 0; k < sets.length; k++) {
      sets[k].container.visible = k === activeIdx;
    }

    const active = sets[activeIdx];
    active.mat.uniforms.uOpacity.value = opacity;
    for (const r of active.rings) r.ring.mat.opacity = r.alpha * opacity;

    for (let i = 0; i < active.specs.length; i++) {
      const s = active.specs[i];
      const ang = s.a + simTime * s.speed;
      dummy.position.set(
        Math.cos(ang) * s.rad,
        s.y + Math.sin(simTime * active.bobRate + i) * active.bobAmp,
        Math.sin(ang) * s.rad,
      );
      dummy.rotation.set(
        s.spin[0] + simTime * active.spinRate[0],
        s.spin[1] + simTime * active.spinRate[1],
        s.spin[2] + simTime * active.spinRate[2],
      );
      dummy.scale.setScalar(s.sc);
      dummy.updateMatrix();
      active.mesh.setMatrixAt(i, dummy.matrix);
    }
    active.mesh.instanceMatrix.needsUpdate = true;
  };

  const dispose = () => {
    for (const set of sets) {
      set.geo.dispose();
      set.mat.dispose();
      for (const r of set.rings) {
        r.ring.geo.dispose();
        r.ring.mat.dispose();
      }
    }
  };

  return { group, update, dispose };
}
