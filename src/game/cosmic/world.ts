import * as THREE from 'three';
import { STAR_NODES, type StarNodeSpec } from '../../door/starmap';
import { buildRealmProps, type RealmPropsHandle } from '../../door/realms';
import { buildRocks, type Rocks } from '../../door/rocks';
import { buildStation } from '../../door/station';
import { warpBeta, warpCenter, warpGlsl, warpImage, warpObject, warpScale } from '../../door/warp';
import {
  buildCollectibleCatalogGeos,
  buildGalleryFrameGeo,
  buildGameBeaconGeo,
  buildPlanetesimalGeo,
  buildStargatePair,
  buildTidalFilamentGeo,
  createStargatePortalMaterial,
} from './models';
import { COSMOS_SCALE, HOLE_SCALE_MULT, type CosmicTrack, type TrackSample } from './track';

export interface AtlasItemSpec {
  id: string;
  regionId: string;
  regionName: string;
  name: string;
  hint: string;
  color: string;
}

export interface BoostGate {
  index: number;
  s: number;
  pos: THREE.Vector3;
  radius: number;
  triggered: boolean;
}

export interface TrackCollectible {
  spec: AtlasItemSpec;
  group: THREE.Group;
  core: THREE.Object3D;
  frame: THREE.Object3D;
  basePos: THREE.Vector3;
  pos: THREE.Vector3;
  s: number;
  collected: boolean;
}

export interface CosmicWorld {
  group: THREE.Group;
  gates: BoostGate[];
  collectibles: TrackCollectible[];
  catalog: AtlasItemSpec[];
  attachLandmarks: (imageLayer: number) => void;
  triggerGate: (gate: BoostGate, simTime: number) => void;
  update: (
    simTime: number,
    dt: number,
    trackS: number,
    nearNode: StarNodeSpec,
    holeAlpha: number,
    diskN: THREE.Vector3,
    diskU: THREE.Vector3,
    diskV: THREE.Vector3,
    behindHole: (p: THREE.Vector3, r: number) => boolean,
  ) => void;
  resetProgress: () => void;
  dispose: () => void;
}

const GALAXY_RELIC_CATALOG: Record<string, Array<{ name: string; hint: string }>> = {
  base: [
    { name: '观景甲板日志', hint: '基地弯道入轨段左侧' },
    { name: '旅者金唱片', hint: '空间站外侧高处航线' },
    { name: '引力波棱芯', hint: '基地黑洞近心拐点右侧' },
    { name: '白矮星灯塔', hint: '驶离基地前偏低内侧' },
  ],
  about: [
    { name: '浑仪赤道尺', hint: '关于星系入弯上层航道' },
    { name: '时间琥珀', hint: '赤道浑仪巨环右侧内弯' },
    { name: '观测手记', hint: '关于黑洞掠过点正前方' },
    { name: '初版星图卷', hint: '爬出西南峡流左侧外沿' },
  ],
  gallery: [
    { name: '玫瑰星云拓片', hint: '攀上画廊星域前高坡段' },
    { name: '零号悬浮画框', hint: '玫瑰晶体阵列外圈左侧' },
    { name: '星尘颜料盒', hint: '漂浮画框群下方中道' },
    { name: '暗物质留影', hint: '画廊黑洞后半弯高处' },
  ],
  tags: [
    { name: '翡翠索引片', hint: '斯隆脊背标签星系入口' },
    { name: '双星拓扑环', hint: '翡翠棱镜上方偏右航线' },
    { name: '光谱离散核', hint: '高空拱脊极速弯心内侧' },
    { name: '分类星标', hint: '标签星域下坡转向处' },
  ],
  game: [
    { name: '电离果冻块', hint: '游戏星系俯冲段彩块旁' },
    { name: '微型鹈鹕仪', hint: '电离航标塔左侧上空' },
    { name: '脉冲音阶芯', hint: '游戏黑洞近星掠影中线' },
    { name: '街机纪念币', hint: '驶往斯隆终点门前加速弯' },
  ],
};

const COSMOS_PROBES: Array<{ name: string; hint: string; u: number; offX: number; offY: number; color: string }> = [
  { name: '长城漂流号 · Ⅰ', hint: '基地驶往关于的西南长桥', u: 0.175, offX: -7.6, offY: 2.2, color: '#ffae8c' },
  { name: '长城漂流号 · Ⅱ', hint: '关于爬升画廊的西北天梯', u: 0.34, offX: 8.0, offY: -2.0, color: '#ffadd2' },
  { name: '长城漂流号 · Ⅲ', hint: '画廊往标签的斯隆高脊', u: 0.54, offX: -7.2, offY: 2.6, color: '#8ef0c8' },
  { name: '长城漂流号 · Ⅳ', hint: '标签俯冲游戏的东侧桥段', u: 0.72, offX: 7.4, offY: -2.2, color: '#bde2ff' },
  { name: '长城漂流号 · Ⅴ', hint: '终点星门前最后直道', u: 0.945, offX: 0, offY: 0.8, color: '#ffd28a' },
];

// ---- 外层尘埃环与开普勒剪切潮汐气流弧（两端光滑渐隐、多普勒偏色、严格共面） ----
const filamentVertex = /* glsl */ `
  ${warpGlsl}
  varying vec2 vUv;
  varying vec3 vWorld;
  varying vec3 vColor;
  varying float vRadial;
  varying float vDoppler;
  varying vec3 vWarpTint;
  uniform vec3 uWarpCenter;
  uniform vec3 uDiskN;
  void main() {
    vUv = uv;
    mat4 m = modelMatrix;
    #ifdef USE_INSTANCING
    m = m * instanceMatrix;
    #endif
    vec4 world = m * vec4(position, 1.0);
    vWorld = world.xyz;
    #ifdef USE_INSTANCING_COLOR
    vColor = instanceColor;
    #else
    vColor = vec3(1.0);
    #endif
    vec3 rel = world.xyz - uWarpCenter;
    float rr = length(rel) / max(uWarpScale, 1e-4);
    vRadial = clamp((rr - 11.5) / 14.5, 0.0, 1.0);
    vec3 orbitDir = length(rel) > 1e-4 ? normalize(cross(uDiskN, rel)) : vec3(1.0, 0.0, 0.0);
    vec3 toCam = normalize(cameraPosition - world.xyz);
    vDoppler = clamp(1.0 + 0.52 * dot(orbitDir, toCam), 0.55, 1.55);
    gl_Position = warpClip(projectionMatrix * viewMatrix * vec4(spaceWarp(world.xyz), 1.0));
  }
`;

const filamentFragment = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vColor;
  varying float vRadial;
  varying float vDoppler;
  varying vec3 vWarpTint;
  uniform float uAlpha;
  void main() {
    if (uAlpha <= 0.01) discard;
    float arcFade = pow(sin(clamp(vUv.x, 0.0, 1.0) * 3.14159265), 1.45);
    float edgeFade = pow(sin(clamp(vUv.y, 0.0, 1.0) * 3.14159265), 0.75);
    float fadeOut = 1.0 - smoothstep(0.68, 1.0, vRadial);
    vec3 dopTint = mix(vec3(1.15, 0.72, 0.56), vec3(0.86, 0.96, 1.18), smoothstep(0.75, 1.35, vDoppler));
    float lum = arcFade * edgeFade * fadeOut * (0.28 + 0.36 * (1.0 - vRadial)) * vDoppler;
    float a = clamp(lum * uAlpha, 0.0, 0.65);
    if (a <= 0.004) discard;
    gl_FragColor = vec4(vColor * dopTint * vWarpTint * a, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

// ---- 洛希极限外极远环带硅酸盐微行星着色器（暗玄武岩质，背盘面入夜深暗、向盘面灼热勾边） ----
const planetesimalVertex = /* glsl */ `
  ${warpGlsl}
  varying vec3 vWorld;
  varying vec3 vColor;
  varying vec3 vWarpTint;
  void main() {
    mat4 m = modelMatrix;
    #ifdef USE_INSTANCING
    m = m * instanceMatrix;
    #endif
    vec4 world = m * vec4(position, 1.0);
    vWorld = world.xyz;
    #ifdef USE_INSTANCING_COLOR
    vColor = instanceColor;
    #else
    vColor = vec3(0.32);
    #endif
    gl_Position = warpClip(projectionMatrix * viewMatrix * vec4(spaceWarp(world.xyz), 1.0));
  }
`;

const planetesimalFragment = /* glsl */ `
  varying vec3 vWorld;
  varying vec3 vColor;
  varying vec3 vWarpTint;
  uniform vec3 uWarpCenter;
  uniform vec3 uDiskTint;
  uniform float uAlpha;
  void main() {
    if (uAlpha <= 0.01) discard;
    vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
    vec3 toLight = normalize(uWarpCenter - vWorld);
    vec3 viewDir = normalize(cameraPosition - vWorld);
    float ndl = max(dot(n, toLight), 0.0);
    float ndv = max(dot(n, viewDir), 0.0);
    float regolith = ndl / max(ndl + ndv * 0.6, 0.22);
    float rim = pow(1.0 - ndv, 3.0) * smoothstep(-0.15, 0.55, dot(n, toLight));
    vec3 col = vColor * (vec3(0.025, 0.028, 0.042) + regolith * uDiskTint * 1.1) + uDiskTint * rim * 0.42;
    gl_FragColor = vec4(col * vWarpTint * uAlpha, uAlpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function buildCosmicWorld(track: CosmicTrack, lite: boolean): CosmicWorld {
  const group = new THREE.Group();
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

  let station: THREE.Group | null = null;
  let rocks: Rocks | null = null;
  let realmProps: RealmPropsHandle | null = null;

  // ---- 符合天体物理学规律的双层黑洞外围吸积系统（严格与黑洞盘面共面，开普勒 ω ∝ r^-1.5） ----
  interface FilamentSpec {
    a: number;
    r: number;
    lift: number;
    speed: number;
    lenScale: number;
    thick: number;
  }
  const filamentCount = lite ? 44 : 76;
  const filamentGeo = trackGeo(buildTidalFilamentGeo());
  const filamentMat = trackMat(
    new THREE.ShaderMaterial({
      vertexShader: filamentVertex,
      fragmentShader: filamentFragment,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: {
        uAlpha: { value: 0 },
        uDiskN: { value: new THREE.Vector3(0, 1, 0) },
        uWarpBeta: warpBeta,
        uWarpImage: warpImage,
        uWarpCenter: warpCenter,
        uWarpScale: warpScale,
      },
    }),
  );
  const filamentMesh = new THREE.InstancedMesh(filamentGeo, filamentMat, filamentCount);
  filamentMesh.frustumCulled = false;
  filamentMesh.visible = false;
  const filamentSpecs: FilamentSpec[] = [];
  const fCol = new THREE.Color();
  for (let i = 0; i < filamentCount; i++) {
    const t = ((i * 29) % filamentCount) / filamentCount;
    const r = 11.8 + Math.pow(t, 1.15) * 14.0;
    const a = (i / filamentCount) * Math.PI * 2 + (i % 7) * 0.42;
    filamentSpecs.push({
      a,
      r,
      lift: ((i % 9) - 4) * 0.085,
      speed: 2.2 * Math.pow(r, -1.5),
      lenScale: 0.72 + (i % 5) * 0.18,
      thick: 0.65 + (1 - t) * 0.65,
    });
    // 越靠内圈色温越炽白金橙，越靠外圈逐渐冷却成尘埃红褐与深空蓝晕
    fCol.setHSL(0.065 - t * 0.03, 0.62, 0.68 - t * 0.28);
    filamentMesh.setColorAt(i, fCol);
  }
  if (filamentMesh.instanceColor) filamentMesh.instanceColor.needsUpdate = true;
  group.add(filamentMesh);

  interface ColdRockSpec {
    a: number;
    r: number;
    lift: number;
    speed: number;
    sc: number;
    rx: number;
    ry: number;
    spin: number;
  }
  const coldCount = lite ? 20 : 34;
  const coldGeo = trackGeo(buildPlanetesimalGeo());
  const coldMat = trackMat(
    new THREE.ShaderMaterial({
      vertexShader: planetesimalVertex,
      fragmentShader: planetesimalFragment,
      transparent: true,
      depthWrite: true,
      uniforms: {
        uAlpha: { value: 0 },
        uDiskTint: { value: new THREE.Color(0xffbe84) },
        uWarpBeta: warpBeta,
        uWarpImage: warpImage,
        uWarpCenter: warpCenter,
        uWarpScale: warpScale,
      },
    }),
  );
  const coldBeltMesh = new THREE.InstancedMesh(coldGeo, coldMat, coldCount);
  coldBeltMesh.frustumCulled = false;
  coldBeltMesh.visible = false;
  const coldSpecs: ColdRockSpec[] = [];
  const cCol = new THREE.Color();
  for (let i = 0; i < coldCount; i++) {
    const r = 30.0 + ((i * 23) % 21) * 1.05;
    const a = (i / coldCount) * Math.PI * 2 + (i % 5) * 0.31;
    coldSpecs.push({
      a,
      r,
      lift: ((i % 7) - 3) * 0.22,
      speed: 1.65 * Math.pow(r, -1.5),
      sc: 0.14 + (i % 4) * 0.065,
      rx: i * 0.9,
      ry: i * 1.3,
      spin: 0.08 + (i % 4) * 0.05,
    });
    cCol.setHSL(0.07 + (i % 4) * 0.015, 0.1, 0.22 + (i % 4) * 0.05);
    coldBeltMesh.setColorAt(i, cCol);
  }
  if (coldBeltMesh.instanceColor) coldBeltMesh.instanceColor.needsUpdate = true;
  group.add(coldBeltMesh);

  function attachLandmarks(imageLayer: number) {
    if (station) return;
    station = buildStation();
    station.scale.setScalar(2.6);
    warpObject(station, true);
    station.traverse((obj) => obj.layers.enable(imageLayer));
    group.add(station);

    rocks = buildRocks(lite, new THREE.Vector3(1, 0, 0));
    rocks.group.scale.setScalar(2.6);
    rocks.group.traverse((obj) => obj.layers.enable(imageLayer));
    group.add(rocks.group);

    realmProps = buildRealmProps(lite);
    group.add(realmProps.group);
  }

  const sample: TrackSample = {
    u: 0,
    s: 0,
    pos: new THREE.Vector3(),
    forward: new THREE.Vector3(),
    right: new THREE.Vector3(),
    up: new THREE.Vector3(),
  };
  const zAxis = new THREE.Vector3(0, 0, 1);

  // ---- 精细化画廊立体画框雕塑与游戏电离灯塔雕像（各共用 1 份合并几何体） ----
  const extras: THREE.Object3D[] = [];
  const galFrameGeo = trackGeo(buildGalleryFrameGeo());
  const gameBeaconGeo = trackGeo(buildGameBeaconGeo());

  const galNode = STAR_NODES.find((n) => n.id === 'gallery');
  if (galNode) {
    const frameMat = trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xf4c8df,
        emissive: 0x62244a,
        emissiveIntensity: 0.45,
        roughness: 0.3,
        metalness: 0.65,
      }),
    );
    const gx = galNode.position[0] * COSMOS_SCALE;
    const gy = galNode.position[1] * COSMOS_SCALE;
    const gz = galNode.position[2] * COSMOS_SCALE;
    for (let f = 0; f < 4; f++) {
      const holder = new THREE.Mesh(galFrameGeo, frameMat);
      const a = (f / 4) * Math.PI * 2 + 0.5;
      holder.position.set(gx + Math.cos(a) * 82, gy + (f % 2 === 0 ? 14 : -14), gz + Math.sin(a) * 82);
      holder.scale.setScalar(2.8);
      holder.lookAt(gx, gy, gz);
      group.add(holder);
      extras.push(holder);
    }
  }

  const gameNode = STAR_NODES.find((n) => n.id === 'game');
  if (gameNode) {
    const jx = gameNode.position[0] * COSMOS_SCALE;
    const jy = gameNode.position[1] * COSMOS_SCALE;
    const jz = gameNode.position[2] * COSMOS_SCALE;
    const jellyColors = [0x7ce2ff, 0xffd27a, 0xff9ec7];
    for (let j = 0; j < 3; j++) {
      const jMat = trackMat(
        new THREE.MeshStandardMaterial({
          color: jellyColors[j],
          emissive: jellyColors[j],
          emissiveIntensity: 0.42,
          roughness: 0.25,
          metalness: 0.35,
        }),
      );
      const beacon = new THREE.Mesh(gameBeaconGeo, jMat);
      const a = (j / 3) * Math.PI * 2 + 0.8;
      beacon.position.set(jx + Math.cos(a) * 78, jy + (j - 1) * 14, jz + Math.sin(a) * 78);
      beacon.scale.setScalar(2.8);
      group.add(beacon);
      extras.push(beacon);
    }
  }

  // ---- 26 座星际文明巨构星门（双层批处理 InstancedMesh：外装甲巨环 1 次 + 能量传送门环 1 次） ----
  const gates: BoostGate[] = [];
  const GATE_COUNT = 26;
  const stargatePair = buildStargatePair(1.0);
  trackGeo(stargatePair.hull);
  trackGeo(stargatePair.portal);

  const gateHullMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xc2d0e2,
      roughness: 0.36,
      metalness: 0.78,
      emissive: 0x10192b,
      emissiveIntensity: 0.3,
    }),
  );
  const gatePortalMat = trackMat(createStargatePortalMaterial(1.0, 0xffffff));
  const flashArr = new Float32Array(GATE_COUNT).fill(-10);
  const flashAttr = new THREE.InstancedBufferAttribute(flashArr, 1);
  stargatePair.portal.setAttribute('aFlash', flashAttr);

  const gateHullInst = new THREE.InstancedMesh(stargatePair.hull, gateHullMat, GATE_COUNT);
  const gatePortalInst = new THREE.InstancedMesh(stargatePair.portal, gatePortalMat, GATE_COUNT);
  gateHullInst.frustumCulled = false;
  gatePortalInst.frustumCulled = false;

  const dummyMat = new THREE.Matrix4();
  const dummyQuat = new THREE.Quaternion();
  const dummyScale = new THREE.Vector3(1, 1, 1);
  const gateColors: THREE.Color[] = [];
  const hullTint = new THREE.Color();

  for (let i = 0; i < GATE_COUNT; i++) {
    const u = 0.03 + ((i + 1) / (GATE_COUNT + 1)) * 0.92;
    const s = u * track.totalLength;
    track.sampleAtS(s, sample);
    const offX = Math.sin((i + 1) * 1.65) * 9.5;
    const offY = Math.cos((i + 1) * 1.15) * 4.2;
    const gatePos = sample.pos
      .clone()
      .addScaledVector(sample.right, offX)
      .addScaledVector(sample.up, offY);
    const near = track.evaluateHub(gatePos);
    const col = new THREE.Color(near.node.color);
    gateColors.push(col);
    hullTint.copy(col).lerp(new THREE.Color(0xcad8ea), 0.62);

    dummyQuat.setFromUnitVectors(zAxis, sample.forward);
    dummyMat.compose(gatePos, dummyQuat, dummyScale);
    gateHullInst.setMatrixAt(i, dummyMat);
    gateHullInst.setColorAt(i, hullTint);
    gatePortalInst.setMatrixAt(i, dummyMat);
    gatePortalInst.setColorAt(i, col);

    gates.push({ index: i, s, pos: gatePos, radius: 6.8, triggered: false });
  }
  gateHullInst.instanceMatrix.needsUpdate = true;
  gatePortalInst.instanceMatrix.needsUpdate = true;
  if (gateHullInst.instanceColor) gateHullInst.instanceColor.needsUpdate = true;
  if (gatePortalInst.instanceColor) gatePortalInst.instanceColor.needsUpdate = true;
  group.add(gateHullInst, gatePortalInst);

  const dimGateColor = new THREE.Color();
  function triggerGate(gate: BoostGate, simTime: number) {
    gate.triggered = true;
    flashArr[gate.index] = simTime;
    flashAttr.needsUpdate = true;
    dimGateColor.copy(gateColors[gate.index]).multiplyScalar(0.28);
    gatePortalInst.setColorAt(gate.index, dimGateColor);
    if (gatePortalInst.instanceColor) gatePortalInst.instanceColor.needsUpdate = true;
  }

  // ---- 25 件精细化藏品建模（按星域分工缓存 6 套合并几何体，共享金属壳 + 发光核材质） ----
  const catalog: AtlasItemSpec[] = [];
  const collectibles: TrackCollectible[] = [];
  const catalogGeos = buildCollectibleCatalogGeos();
  for (const pair of Object.values(catalogGeos)) {
    trackGeo(pair.frame);
    trackGeo(pair.core);
  }

  const chassisMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xd8dee9,
      roughness: 0.34,
      metalness: 0.78,
      emissive: 0x161e2e,
      emissiveIntensity: 0.25,
    }),
  );
  const probeChassisMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xe6ba64,
      roughness: 0.3,
      metalness: 0.76,
      emissive: 0x3b2609,
      emissiveIntensity: 0.28,
    }),
  );

  // 适应加宽后星际航道（±14.2）的藏品弧线走位点
  const offsets: Array<[number, number, number]> = [
    [-0.028, -8.6, 2.4],
    [-0.01, 8.0, 3.0],
    [0.012, 8.8, -2.5],
    [0.03, -7.4, -2.6],
  ];

  for (const ms of track.milestones) {
    const defs = GALAXY_RELIC_CATALOG[ms.node.id] ?? [];
    const pair = catalogGeos[ms.node.id] ?? catalogGeos.base;
    const accent = new THREE.Color(ms.node.color);
    const coreMat = trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: accent,
        emissiveIntensity: 0.88,
        roughness: 0.2,
        metalness: 0.35,
      }),
    );

    for (let k = 0; k < defs.length; k++) {
      const def = defs[k];
      const spec: AtlasItemSpec = {
        id: `${ms.node.id}-relic-${k}`,
        regionId: ms.node.id,
        regionName: ms.node.name,
        name: def.name,
        hint: def.hint,
        color: ms.node.color,
      };
      catalog.push(spec);

      const [du, ox, oy] = offsets[k];
      const su = Math.min(Math.max(ms.u + du, 0.02), 0.97);
      const s = su * track.totalLength;
      track.sampleAtS(s, sample);
      const pos = sample.pos.clone().addScaledVector(sample.right, ox).addScaledVector(sample.up, oy);

      const rGroup = new THREE.Group();
      rGroup.position.copy(pos);
      rGroup.scale.setScalar(1.08);
      const frame = new THREE.Mesh(pair.frame, chassisMat);
      const core = new THREE.Mesh(pair.core, coreMat);
      rGroup.add(frame, core);
      rGroup.visible = false;
      group.add(rGroup);

      collectibles.push({
        spec,
        group: rGroup,
        core,
        frame,
        basePos: pos.clone(),
        pos: rGroup.position,
        s,
        collected: false,
      });
    }
  }

  // 五具斯隆深空探测器
  const probePair = catalogGeos.cosmos;
  for (let i = 0; i < COSMOS_PROBES.length; i++) {
    const item = COSMOS_PROBES[i];
    const col = new THREE.Color(item.color);
    const spec: AtlasItemSpec = {
      id: `cosmos-probe-${i}`,
      regionId: 'cosmos',
      regionName: '斯隆深空',
      name: item.name,
      hint: item.hint,
      color: item.color,
    };
    catalog.push(spec);

    const s = item.u * track.totalLength;
    track.sampleAtS(s, sample);
    const pos = sample.pos.clone().addScaledVector(sample.right, item.offX).addScaledVector(sample.up, item.offY);

    const rGroup = new THREE.Group();
    rGroup.position.copy(pos);
    rGroup.scale.setScalar(1.12);
    const frame = new THREE.Mesh(probePair.frame, probeChassisMat);
    const core = new THREE.Mesh(
      probePair.core,
      trackMat(
        new THREE.MeshStandardMaterial({
          color: 0xffffff,
          emissive: col,
          emissiveIntensity: 0.95,
          roughness: 0.22,
          metalness: 0.3,
        }),
      ),
    );
    frame.rotation.x = 0.28;
    rGroup.add(frame, core);
    rGroup.visible = false;
    group.add(rGroup);

    collectibles.push({
      spec,
      group: rGroup,
      core,
      frame,
      basePos: pos.clone(),
      pos: rGroup.position,
      s,
      collected: false,
    });
  }

  const origin = new THREE.Vector3(0, 0, 0);
  const centerVec = new THREE.Vector3();
  const diskBasis = new THREE.Matrix4();
  const diskQuat = new THREE.Quaternion();
  const instPos = new THREE.Vector3();
  const instQuat = new THREE.Quaternion();
  const instSpin = new THREE.Quaternion();
  const instEuler = new THREE.Euler();
  const instScale = new THREE.Vector3();
  const instMat4 = new THREE.Matrix4();

  function update(
    simTime: number,
    dt: number,
    trackS: number,
    nearNode: StarNodeSpec,
    holeAlpha: number,
    diskN: THREE.Vector3,
    diskU: THREE.Vector3,
    diskV: THREE.Vector3,
    behindHole: (p: THREE.Vector3, r: number) => boolean,
  ) {
    // 严格复用黑洞盘面的倾斜坐标系 (diskU, diskN, -diskV)
    diskBasis.makeBasis(diskU, diskN, instPos.copy(diskV).negate());
    diskQuat.setFromRotationMatrix(diskBasis);

    if (station && rocks) {
      const baseNear = nearNode.id === 'base' && holeAlpha > 0.02;
      station.visible = baseNear;
      rocks.group.visible = baseNear;
      if (baseNear) {
        const sa = simTime * 0.085;
        const sr = 14 * HOLE_SCALE_MULT;
        station.position.set(Math.cos(sa) * sr, 2.2 * Math.sin(sa * 0.7), Math.sin(sa) * sr);
        station.lookAt(origin);
        rocks.group.quaternion.copy(diskQuat);
        rocks.update(simTime, behindHole);
      }
    }

    centerVec.set(...nearNode.position).multiplyScalar(COSMOS_SCALE);
    const sc = (nearNode.holeScale ?? 1.85) * HOLE_SCALE_MULT;
    gatePortalMat.uniforms.uTime.value = simTime;

    if (realmProps) {
      realmProps.update(nearNode.holeTheme ?? 0, holeAlpha, simTime, centerVec, sc, diskQuat, true);
    }

    const showAccretion = holeAlpha > 0.04;
    filamentMesh.visible = showAccretion;
    coldBeltMesh.visible = showAccretion;

    if (showAccretion) {
      // 1. 外层分子尘埃环带与剪切潮汐气流弧（严格沿 diskU / diskV 盘面以 ω ∝ r^-1.5 差速公转）
      filamentMat.uniforms.uAlpha.value = holeAlpha;
      filamentMat.uniforms.uDiskN.value.copy(diskN);
      for (let i = 0; i < filamentCount; i++) {
        const f = filamentSpecs[i];
        const ang = f.a + simTime * f.speed;
        const rad = f.r * sc;
        instPos
          .copy(centerVec)
          .addScaledVector(diskN, f.lift * sc);
        instSpin.setFromAxisAngle(diskN, ang);
        instQuat.copy(instSpin).multiply(diskQuat);
        instScale.set(rad, f.thick * sc * 0.85, rad);
        instMat4.compose(instPos, instQuat, instScale);
        filamentMesh.setMatrixAt(i, instMat4);
      }
      filamentMesh.instanceMatrix.needsUpdate = true;

      // 2. 洛希极限外极远硅酸盐冷碎岩盘（薄赤道层 H/R ≈ 0.025）
      coldMat.uniforms.uAlpha.value = holeAlpha;
      coldMat.uniforms.uDiskTint.value.set(nearNode.color);
      for (let i = 0; i < coldCount; i++) {
        const c = coldSpecs[i];
        const ang = c.a + simTime * c.speed;
        const ca = Math.cos(ang);
        const sa = Math.sin(ang);
        const rad = c.r * sc;
        instPos
          .copy(centerVec)
          .addScaledVector(diskU, ca * rad)
          .addScaledVector(diskV, sa * rad)
          .addScaledVector(diskN, c.lift * sc);
        instSpin.setFromEuler(instEuler.set(c.rx + simTime * c.spin, c.ry + simTime * c.spin * 0.7, 0));
        instQuat.copy(diskQuat).multiply(instSpin);
        instScale.setScalar(c.sc * sc);
        instMat4.compose(instPos, instQuat, instScale);
        coldBeltMesh.setMatrixAt(i, instMat4);
      }
      coldBeltMesh.instanceMatrix.needsUpdate = true;
    }

    // 赛道视距裁剪：仅更新和显示视野区间内的藏品（大幅节省矩阵更新与 GPU 顶点绘制）
    for (let i = 0; i < collectibles.length; i++) {
      const rel = collectibles[i];
      if (rel.collected) {
        rel.group.visible = false;
        continue;
      }
      const inRange = rel.s >= trackS - 35 && rel.s <= trackS + 380;
      rel.group.visible = inRange;
      if (!inRange) continue;
      rel.group.rotation.y += dt * 0.95;
      rel.core.rotation.y += dt * 0.65;
      const bob = Math.sin(simTime * 2.0 + i) * 0.16;
      rel.frame.position.y = bob;
      rel.core.position.y = bob;
    }

    if (dt > 0) {
      for (let i = 0; i < extras.length; i++) {
        extras[i].rotation.y += dt * 0.35;
      }
    }
  }

  function resetProgress() {
    flashArr.fill(-10);
    flashAttr.needsUpdate = true;
    for (let i = 0; i < gates.length; i++) {
      gates[i].triggered = false;
      gatePortalInst.setColorAt(i, gateColors[i]);
    }
    if (gatePortalInst.instanceColor) gatePortalInst.instanceColor.needsUpdate = true;

    for (const rel of collectibles) {
      rel.collected = false;
      rel.group.position.copy(rel.basePos);
      rel.frame.position.y = 0;
      rel.core.position.y = 0;
      rel.group.visible = false;
    }
  }

  function dispose() {
    rocks?.dispose();
    realmProps?.dispose();
    for (const g of geometries) g.dispose();
    for (const m of materials) m.dispose();
  }

  return {
    group,
    gates,
    collectibles,
    catalog,
    attachLandmarks,
    triggerGate,
    update,
    resetProgress,
    dispose,
  };
}
