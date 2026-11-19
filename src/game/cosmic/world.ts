import * as THREE from 'three';
import { STAR_NODES, type StarNodeSpec } from '../../door/starmap';
import { buildRocks, type Rocks } from '../../door/rocks';
import { buildStation } from '../../door/station';
import { warpBeta, warpCenter, warpGlsl, warpImage, warpObject, warpScale } from '../../door/warp';
import {
  buildCollectibleCatalogGeos,
  buildPolarJetGeo,
  buildPulsarBeaconPair,
  buildStargatePair,
  buildTorusSectorGeo,
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
  offX: number;
  offY: number;
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

export interface FlightVisualState {
  shipPos: THREE.Vector3;
  forward: THREE.Vector3;
  right: THREE.Vector3;
  up: THREE.Vector3;
  speedNorm: number;
  ergoCharge: number;
}

export interface CosmicWorld {
  group: THREE.Group;
  gates: BoostGate[];
  collectibles: TrackCollectible[];
  catalog: AtlasItemSpec[];
  attachLandmarks: (imageLayer: number) => void;
  syncToTrack: () => void;
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
    pixelRatio?: number,
    flight?: FlightVisualState,
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

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rand: () => number) {
  const u = Math.max(rand(), 1e-6);
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ---- 1. 活动星系核外围尘埃环面着色器（紧接黑洞吸积盘外缘 10.6..22.5 Rs，纯噪声羽化分子云，无硬边管环） ----
const torusCloudVertex = /* glsl */ `
  ${warpGlsl}
  attribute float aSeed;
  varying vec2 vUv;
  varying vec3 vColor;
  varying float vRadial;
  varying float vDoppler;
  varying float vSeed;
  uniform vec3 uDiskN;
  void main() {
    vUv = uv;
    vSeed = aSeed;
    mat4 m = modelMatrix;
    #ifdef USE_INSTANCING
    m = m * instanceMatrix;
    #endif
    vec4 world = m * vec4(position, 1.0);
    #ifdef USE_INSTANCING_COLOR
    vColor = instanceColor;
    #else
    vColor = vec3(1.0);
    #endif
    vec3 rel = world.xyz - uWarpCenter;
    float rr = length(rel) / max(uWarpScale, 1e-4);
    vRadial = clamp((rr - 10.6) / 11.4, 0.0, 1.0);
    vec3 orbitDir = length(rel) > 1e-4 ? normalize(cross(uDiskN, rel)) : vec3(1.0, 0.0, 0.0);
    vec3 toCam = normalize(cameraPosition - world.xyz);
    vDoppler = clamp(1.0 + 0.42 * dot(orbitDir, toCam), 0.62, 1.48);
    gl_Position = warpClip(projectionMatrix * viewMatrix * vec4(spaceWarp(world.xyz), 1.0));
  }
`;

const torusCloudFragment = /* glsl */ `
  uniform float uTime;
  uniform float uAlpha;
  varying vec2 vUv;
  varying vec3 vColor;
  varying float vRadial;
  varying float vDoppler;
  varying float vSeed;
  varying vec3 vWarpTint;

  float hash21(vec2 p) {
    p = fract(p * vec2(127.1, 311.7));
    p += dot(p, p + 41.7);
    return fract(p.x * p.y);
  }
  float noise2(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
      mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }
  float fbm2(vec2 p) {
    return noise2(p) * 0.62 + noise2(p * 2.15 + 3.7) * 0.38;
  }

  void main() {
    if (uAlpha <= 0.01) discard;
    float fadeU = pow(sin(clamp(vUv.x, 0.0, 1.0) * 3.14159265), 1.35);
    float fadeV = pow(sin(clamp(vUv.y, 0.0, 1.0) * 3.14159265), 1.05);
    vec2 q = vec2(vUv.x * 3.4 + vSeed * 11.3, vUv.y * 2.2 - vSeed * 5.7 + uTime * 0.02);
    float cloud = smoothstep(0.24, 0.84, fbm2(q));
    float radialFade = smoothstep(0.0, 0.16, vRadial) * (1.0 - smoothstep(0.55, 1.0, vRadial));
    vec3 coolTint = mix(vec3(1.1, 0.72, 0.52), vec3(0.84, 0.94, 1.15), smoothstep(0.75, 1.35, vDoppler));
    float a = clamp(fadeU * fadeV * cloud * radialFade * 0.34 * vDoppler * uAlpha, 0.0, 0.42);
    if (a <= 0.004) discard;
    gl_FragColor = vec4(vColor * coolTint * vWarpTint * a, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

// ---- 2. 活动星系核相对论双极准直喷流着色器（掠角隐消轮廓 + 磁螺旋条纹 + 激波节脉冲） ----
const polarJetVertex = /* glsl */ `
  ${warpGlsl}
  varying vec2 vUv;
  varying vec3 vWorld;
  varying vec3 vNormal;
  void main() {
    vUv = uv;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = warpClip(projectionMatrix * viewMatrix * vec4(spaceWarp(world.xyz), 1.0));
  }
`;

const polarJetFragment = /* glsl */ `
  uniform float uTime;
  uniform float uAlpha;
  uniform vec3 uCoreCol;
  uniform vec3 uJetCol;
  varying vec2 vUv;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying vec3 vWarpTint;
  void main() {
    if (uAlpha <= 0.01) discard;
    vec3 V = normalize(cameraPosition - vWorld);
    // 圆柱锥体边缘切线自然隐去，完全没有几何体硬边
    float radialSoft = pow(abs(dot(normalize(vNormal), V)), 1.55);
    float baseFade = smoothstep(0.01, 0.14, vUv.y);
    float tipFade = 1.0 - smoothstep(0.42, 1.0, vUv.y);
    float helix = 0.55 + 0.45 * sin(vUv.x * 12.56637 - vUv.y * 15.0 - uTime * 3.4);
    float knots = 0.58 + 0.42 * pow(0.5 + 0.5 * sin(vUv.y * 22.0 - uTime * 5.2), 3.0);
    float intensity = radialSoft * baseFade * tipFade * helix * knots * 0.46;
    vec3 col = mix(uCoreCol, uJetCol, smoothstep(0.06, 0.52, vUv.y));
    float a = clamp(intensity * uAlpha, 0.0, 0.52);
    if (a <= 0.004) discard;
    gl_FragColor = vec4(col * vWarpTint * a, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

// ---- 3. 大尺度真实深空与宿主星系恒星着色器（真实星等亮度分布 + 晕染光冕绘星，绝不用硬直线十字线） ----
const cosmosStarVertex = /* glsl */ `
  attribute vec3 aColor;
  attribute float aSize;
  attribute float aKind;
  attribute float aLum;
  attribute float aSeed;

  uniform float uPixelRatio;
  uniform float uTime;
  uniform float uWarp;

  varying vec3 vColor;
  varying float vAlpha;
  varying float vKind;
  varying float vSeed;
  varying float vSoft;
  varying float vPx;
  varying float vTruePx;
  varying float vWarp;

  // 最小画布保持 6.5px 为 Nyquist 抗闪烁高斯核留出 >3σ 边距；远星不画日冕并按面积能量守恒稳住亮度
  const float MIN_POINT = 6.5;

  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    float dist = max(-mv.z, 22.0);
    // 抵消曲速 FOV 拉宽造成的亚像素缩放突变
    float focal = projectionMatrix[1][1] * 0.6745;
    float px = aSize * uPixelRatio * focal * (310.0 / dist);
    gl_PointSize = clamp(px, MIN_POINT, aKind > 1.5 ? 26.0 : 20.0);
    float subPx = mix(0.18, 1.0, smoothstep(0.12, 1.85, px));
    float distFade = pow(subPx, 0.95) * smoothstep(4000.0, 320.0, dist);
    float nearFade = smoothstep(14.0, 44.0, dist);
    vPx = gl_PointSize;
    vTruePx = px;
    vSoft = aKind > 1.5 ? 1.0 - smoothstep(MIN_POINT, 11.0, px) : 0.0;
    vColor = aColor;
    vAlpha = nearFade * distFade * aLum;
    vKind = aKind;
    vSeed = aSeed;
    vWarp = uWarp;
  }
`;

const cosmosStarFragment = /* glsl */ `
  precision highp float;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vKind;
  varying float vSeed;
  varying float vSoft;
  varying float vPx;
  varying float vTruePx;
  varying float vWarp;

  void main() {
    if (vAlpha <= 0.005) discard;
    vec2 p = gl_PointCoord - 0.5;
    float d2 = dot(p, p);
    if (d2 > 0.25) discard;
    float r = sqrt(d2) * 2.0;
    float rad = vPx * 0.5;
    float dpx = r * rad;
    float shape = 0.0;
    vec3 tint = vColor;

    if (vKind > 1.5) {
      // 遥远椭圆背景星系 / H-II 电离星云结（柔雾核心与倾角星盘）
      float ang = vSeed * 6.28318;
      float cs = cos(ang);
      float sn = sin(ang);
      vec2 q = mat2(cs, -sn, sn, cs) * p * 2.0;
      q.y *= 1.55 + fract(vSeed * 7.3) * 0.9;
      float er = length(q);
      float halo = exp(-er * er * 4.2) * 0.44 + exp(-er * 2.8) * 0.16;
      shape = halo * smoothstep(1.0, 0.36, r);
      tint = mix(vColor, vec3(1.0, 0.93, 0.85), exp(-er * er * 8.0) * 0.42);
      float softSigma = max(rad * 0.40, 0.92);
      float softGlow = exp(-dpx * dpx / (2.0 * softSigma * softSigma)) * 0.40 * smoothstep(1.0, 0.25, r);
      shape = mix(shape, softGlow, vSoft);
    } else {
      // 能量守恒 Nyquist 抗闪烁高斯核：高速曲速掠过像素网格时不出现高频明暗频闪，且保持微星纤细通透
      float trueRad = max(vTruePx * 0.5, 0.55);
      float minSigma = 0.90 + vWarp * 0.24;
      float coreSigma = max(trueRad * 0.18, minSigma);
      float core = exp(-dpx * dpx / (2.0 * coreSigma * coreSigma));
      float energyNorm = pow(min(0.64 / coreSigma, 1.0), 1.40);
      float trueR = dpx / max(trueRad, 1.0);
      float haloMask = smoothstep(2.0, 5.2, vTruePx);
      float corona = (exp(-trueR * trueR * 14.0) * 0.24 + exp(-trueR * 4.6) * 0.05) * haloMask;
      shape = (core * energyNorm + corona) * smoothstep(1.0, 0.58, r);
      if (vKind > 0.5) {
        // 极少数亮巨星：天文柔和十字衍射星芒与宽幅日冕
        float ang = atan(p.y, p.x) + vSeed * 6.28318;
        float c2 = abs(cos(2.0 * ang));
        float rays = pow(c2, 11.0) * exp(-r * 2.5) * 0.58 + pow(c2, 3.0) * exp(-r * 3.4) * 0.22;
        float aureole = exp(-r * r * 5.2) * 0.36 + rays;
        shape += aureole * haloMask * smoothstep(1.0, 0.55, r);
      }
      tint = mix(vColor, vec3(1.0), smoothstep(0.20, 0.78, core));
      // 相对论多普勒蓝移：高速曲速与弹弓期星点向青白光谱微移
      tint = mix(tint, vec3(0.74, 0.93, 1.0), vWarp * 0.36);
    }

    // THREE.AdditiveBlending（SRC_ALPHA, ONE）已乘一次 alpha，输出线性 rgb + alpha 避免平方杀光软外晕
    float a = clamp(shape * vAlpha, 0.0, 1.0);
    gl_FragColor = vec4(tint, a);
  }
`;

// ---- 4. 宏观宇宙网体积丝状星云纱带（仅在斯隆长城主脊与五大星系旋臂铺开柔和深空星雾，零硬框边缘） ----
const cosmicCloudVertex = /* glsl */ `
  attribute vec3 aWarm;
  attribute vec3 aCool;
  attribute float aSeed;
  attribute float aGain;
  varying vec2 vUv;
  varying vec3 vWarm;
  varying vec3 vCool;
  varying float vSeed;
  varying float vGain;
  void main() {
    vUv = uv - 0.5;
    vWarm = aWarm;
    vCool = aCool;
    vSeed = aSeed;
    vGain = aGain;
    vec4 wp = vec4(position, 1.0);
    #ifdef USE_INSTANCING
    wp = instanceMatrix * wp;
    #endif
    gl_Position = projectionMatrix * modelViewMatrix * wp;
  }
`;

const cosmicCloudFragment = /* glsl */ `
  precision highp float;
  uniform float uTime;
  varying vec2 vUv;
  varying vec3 vWarm;
  varying vec3 vCool;
  varying float vSeed;
  varying float vGain;

  float hash21(vec2 p) {
    p = fract(p * vec2(127.1, 311.7));
    p += dot(p, p + 43.27);
    return fract(p.x * p.y);
  }
  float noise2(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
      mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }
  float fbm2(vec2 p) {
    return noise2(p) * 0.62 + noise2(mat2(0.8, 0.6, -0.6, 0.8) * p * 2.1 + 4.1) * 0.38;
  }

  void main() {
    vec2 p = vUv * 2.0;
    float edge = (1.0 - smoothstep(0.32, 1.0, length(p))) * smoothstep(1.0, 0.28, abs(p.x)) * smoothstep(1.0, 0.28, abs(p.y));
    if (edge <= 0.004) discard;
    vec2 q = vec2(p.x * 2.2 + vSeed * 9.1 + uTime * 0.008, p.y * 1.8 - vSeed * 6.3);
    float n1 = fbm2(q);
    float n2 = fbm2(q * 1.85 + vec2(n1 * 1.6, -n1 * 1.2));
    float ridge = pow(max(1.0 - abs(n2 - 0.48) * 2.9, 0.0), 1.8);
    float mist = smoothstep(0.24, 0.84, n1) * 0.45;
    float mixCol = clamp(0.5 + (p.y + (n1 - 0.5) * 0.85) * 0.8, 0.0, 1.0);
    vec3 col = mix(vWarm, vCool, mixCol);
    float a = clamp((ridge * 0.78 + mist) * edge * vGain, 0.0, 0.24);
    if (a <= 0.003) discard;
    gl_FragColor = vec4(col * a, a);
  }
`;

// ---- 5. 深空脉冲星航标软边同步辐射光束着色器（消除锥体硬切线，只留柔光极轴脉冲射线） ----
const pulsarBeamVertex = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorld;
  varying vec3 vNormal;
  void main() {
    vUv = uv;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const pulsarBeamFragment = /* glsl */ `
  uniform float uTime;
  uniform vec3 uColor;
  varying vec2 vUv;
  varying vec3 vWorld;
  varying vec3 vNormal;
  void main() {
    vec3 V = normalize(cameraPosition - vWorld);
    float edgeSoft = pow(abs(dot(normalize(vNormal), V)), 2.2);
    float axial = smoothstep(0.0, 0.2, vUv.y) * smoothstep(1.0, 0.16, vUv.y);
    float pulse = 0.72 + 0.28 * sin(uTime * 4.2 - vUv.y * 10.0);
    float a = clamp(edgeSoft * axial * pulse * 0.24, 0.0, 0.28);
    if (a <= 0.004) discard;
    gl_FragColor = vec4(uColor * a * 1.05, a);
  }
`;

// ---- 6. 相对论星际光行差流光束着色器（高速曲速与弹弓期沿视锥周边高速掠过，不遮挡正中视野） ----
const streamerVertex = /* glsl */ `
  attribute float aAngle;
  attribute float aRadius;
  attribute float aPhase;
  attribute float aLen;
  attribute float aEnd;

  uniform vec3 uShipPos;
  uniform vec3 uFwd;
  uniform vec3 uRight;
  uniform vec3 uUp;
  uniform float uTime;
  uniform float uSpeedNorm;

  varying float vEdge;
  varying float vTail;

  void main() {
    float travel = fract(aPhase + uTime * (0.95 + uSpeedNorm * 2.85));
    float streak = aLen * (0.35 + uSpeedNorm * 2.45);
    float zAlong = mix(118.0, -24.0, travel) + aEnd * streak;
    float aberrationR = aRadius * (1.0 - uSpeedNorm * 0.24 * clamp(zAlong / 118.0, 0.0, 1.0));
    vec3 radial = cos(aAngle) * uRight + sin(aAngle) * uUp;
    vec3 worldPos = uShipPos + uFwd * zAlong + radial * aberrationR;
    vEdge = sin(clamp(travel, 0.0, 1.0) * 3.14159265);
    vTail = 1.0 - aEnd;
    gl_Position = projectionMatrix * viewMatrix * vec4(worldPos, 1.0);
  }
`;

const streamerFragment = /* glsl */ `
  uniform float uSpeedNorm;
  uniform float uErgoCharge;
  varying float vEdge;
  varying float vTail;

  void main() {
    float vis = smoothstep(0.14, 0.92, uSpeedNorm);
    if (vis <= 0.008) discard;
    float alpha = pow(vEdge, 1.15) * (0.18 + 0.82 * vTail) * vis * (0.32 + uErgoCharge * 0.26);
    if (alpha <= 0.004) discard;
    vec3 warm = vec3(1.0, 0.88, 0.68);
    vec3 cyan = vec3(0.58, 0.94, 1.0);
    vec3 col = mix(warm, cyan, clamp(uSpeedNorm * 0.62 + uErgoCharge * 0.55, 0.0, 1.0));
    gl_FragColor = vec4(col * alpha, clamp(alpha, 0.0, 0.68));
  }
`;

// ---- 7. 黑洞能层潮汐电离等离子流（沿近心内缘航线分布的天然潮汐磁通通道，引导玩家切弯汲取彭罗斯能） ----
const ergoStreamVertex = /* glsl */ `
  ${warpGlsl}
  varying vec2 vUv;
  varying vec3 vWorld;
  void main() {
    vUv = uv;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    gl_Position = warpClip(projectionMatrix * viewMatrix * vec4(spaceWarp(wp.xyz), 1.0));
  }
`;

const ergoStreamFragment = /* glsl */ `
  uniform float uTime;
  uniform float uAlpha;
  uniform float uErgoCharge;
  uniform vec3 uNearHub;
  uniform vec3 uColor;
  varying vec2 vUv;
  varying vec3 vWorld;
  varying vec3 vWarpTint;

  void main() {
    if (uAlpha <= 0.02) discard;
    float nearMask = 1.0 - smoothstep(240.0, 440.0, distance(vWorld, uNearHub));
    if (nearMask <= 0.01) discard;
    float axial = pow(sin(clamp(vUv.x, 0.0, 1.0) * 3.14159265), 1.15);
    float crossFade = pow(sin(clamp(vUv.y, 0.0, 1.0) * 3.14159265), 2.1);
    float pulseA = 0.58 + 0.42 * sin(vUv.x * 26.0 - uTime * (4.8 + uErgoCharge * 4.5));
    float pulseB = 0.65 + 0.35 * sin(vUv.x * 11.0 - uTime * 2.7 + vUv.y * 6.28318);
    float fil = pow(crossFade, 1.35) * pulseA * pulseB;
    float boost = 1.0 + uErgoCharge * 0.95;
    float a = clamp(axial * fil * nearMask * uAlpha * 0.52 * boost, 0.0, 0.72);
    if (a <= 0.004) discard;
    vec3 hotCyan = vec3(0.56, 0.94, 1.0);
    vec3 col = mix(uColor, hotCyan, 0.45 + 0.45 * uErgoCharge);
    gl_FragColor = vec4(col * vWarpTint * a, a);
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

  const origin = new THREE.Vector3(0, 0, 0);
  const centerVec = new THREE.Vector3();
  const diskBasis = new THREE.Matrix4();
  const diskQuat = new THREE.Quaternion();
  const diskEuTmp = new THREE.Euler();
  const diskQ = new THREE.Quaternion();
  const instPos = new THREE.Vector3();
  const instQuat = new THREE.Quaternion();
  const instSpin = new THREE.Quaternion();
  const instScale = new THREE.Vector3();
  const instMat4 = new THREE.Matrix4();

  // ---- 层 1：活动星系核外围尘埃环面（10.6..22.0 Rs 气体羽化云片） ----
  interface TorusSpec {
    a: number;
    r: number;
    lift: number;
    speed: number;
    scaleRad: number;
  }
  const torusCount = lite ? 32 : 54;
  const torusGeo = trackGeo(buildTorusSectorGeo());
  const torusSeeds = new Float32Array(torusCount);
  const torusSpecs: TorusSpec[] = [];
  for (let i = 0; i < torusCount; i++) {
    const t = ((i * 23) % torusCount) / torusCount;
    const r = 11.2 + Math.pow(t, 1.08) * 10.6;
    const a = (i / torusCount) * Math.PI * 2 + (i % 5) * 0.48;
    torusSpecs.push({
      a,
      r,
      lift: ((i % 7) - 3) * 0.18,
      speed: 2.0 * Math.pow(r, -1.5),
      scaleRad: r * (0.94 + (i % 3) * 0.08),
    });
    torusSeeds[i] = i * 0.73;
  }
  torusGeo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(torusSeeds, 1));

  const torusMat = trackMat(
    new THREE.ShaderMaterial({
      vertexShader: torusCloudVertex,
      fragmentShader: torusCloudFragment,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uAlpha: { value: 0 },
        uDiskN: { value: new THREE.Vector3(0, 1, 0) },
        uWarpBeta: warpBeta,
        uWarpImage: warpImage,
        uWarpCenter: warpCenter,
        uWarpScale: warpScale,
      },
    }),
  );
  const torusMesh = new THREE.InstancedMesh(torusGeo, torusMat, torusCount);
  torusMesh.frustumCulled = false;
  torusMesh.visible = false;
  const tCol = new THREE.Color();
  for (let i = 0; i < torusCount; i++) {
    const t = ((i * 23) % torusCount) / torusCount;
    tCol.setHSL(0.06 - t * 0.025, 0.65, 0.56 - t * 0.22);
    torusMesh.setColorAt(i, tCol);
  }
  if (torusMesh.instanceColor) torusMesh.instanceColor.needsUpdate = true;
  group.add(torusMesh);

  // ---- 层 2：活动星系核双极相对论准直喷流 ----
  const jetGeo = trackGeo(buildPolarJetGeo());
  const jetMat = trackMat(
    new THREE.ShaderMaterial({
      vertexShader: polarJetVertex,
      fragmentShader: polarJetFragment,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uAlpha: { value: 0 },
        uCoreCol: { value: new THREE.Color(0xd8ecff) },
        uJetCol: { value: new THREE.Color(0x5288ff) },
        uWarpBeta: warpBeta,
        uWarpImage: warpImage,
        uWarpCenter: warpCenter,
        uWarpScale: warpScale,
      },
    }),
  );
  const polarJetMesh = new THREE.Mesh(jetGeo, jetMat);
  polarJetMesh.frustumCulled = false;
  polarJetMesh.visible = false;
  group.add(polarJetMesh);

  const JET_PALETTES: Array<[number, number]> = [
    [0xfff0d2, 0x5288ff], // 0 base 暖金 + 蓝辛烷喷流
    [0xffd8f0, 0xb876ff], // 1 gallery 玫瑰银紫
    [0xc8f6ff, 0xffaa4c], // 2 game 电离青金
    [0xd2ffea, 0x4fd2ff], // 3 tags 翡翠青蓝
    [0xffdec8, 0x7a8eff], // 4 about 暮色珊瑚月靛
  ];

  // ---- 层 3：真实宇宙尺度宿主星系群（五大星系 60..265 单位恒星旋臂盘 + 斯隆长城深空星流，控制星点数与真实星等层次） ----
  const rand = mulberry32(20261118);
  const perGalaxyStars = lite ? 220 : 420;
  const cosmosStarCount = lite ? 1100 : 2100;
  const totalFieldStars = STAR_NODES.length * perGalaxyStars + cosmosStarCount;

  const starPos = new Float32Array(totalFieldStars * 3);
  const starCol = new Float32Array(totalFieldStars * 3);
  const starSize = new Float32Array(totalFieldStars);
  const starKind = new Float32Array(totalFieldStars);
  const starLum = new Float32Array(totalFieldStars);
  const starSeed = new Float32Array(totalFieldStars);
  let sIdx = 0;

  const tmpU = new THREE.Vector3();
  const tmpV = new THREE.Vector3();
  const tmpN = new THREE.Vector3();
  const tmpWorld = new THREE.Vector3();
  const tmpHub = new THREE.Vector3();
  const cTmp = new THREE.Color();

  const pushCosmosPoint = (
    x: number,
    y: number,
    z: number,
    r: number,
    g: number,
    b: number,
    size: number,
    kind: number,
    lum: number,
  ) => {
    if (sIdx >= totalFieldStars) return;
    const i3 = sIdx * 3;
    starPos[i3] = x;
    starPos[i3 + 1] = y;
    starPos[i3 + 2] = z;
    starCol[i3] = r;
    starCol[i3 + 1] = g;
    starCol[i3 + 2] = b;
    starSize[sIdx] = size;
    starKind[sIdx] = kind;
    starLum[sIdx] = lum;
    starSeed[sIdx] = rand();
    sIdx++;
  };

  // A. 五座宿主星系真尺度恒星旋臂盘（覆盖半径 55..268，严密包络中心黑洞吸积盘）
  for (let ni = 0; ni < STAR_NODES.length; ni++) {
    const node = STAR_NODES[ni];
    tmpHub.set(...node.position).multiplyScalar(COSMOS_SCALE);
    const [tx, tz] = node.diskTilt ?? [0, 0];
    diskQ.setFromEuler(diskEuTmp.set(tx, 0, tz));
    tmpU.set(1, 0, 0).applyQuaternion(diskQ);
    tmpV.set(0, 0, -1).applyQuaternion(diskQ);
    tmpN.set(0, 1, 0).applyQuaternion(diskQ);
    cTmp.set(node.color);

    const isRing = node.id === 'tags';
    const isLenticular = node.id === 'about';
    const isBarred = node.id === 'base' || node.id === 'game';

    for (let k = 0; k < perGalaxyStars; k++) {
      let lx = 0;
      let lz = 0;
      let ly = 0;
      let starTemp = rand();
      let isKnot = false;

      if (isRing) {
        if (k < perGalaxyStars * 0.22) {
          const rad = 95 + rand() * 65;
          const th = rand() * Math.PI * 2;
          lx = Math.cos(th) * rad;
          lz = Math.sin(th) * rad;
          ly = gaussian(rand) * 24;
          starTemp = 0.08;
        } else {
          const rad = 260 + gaussian(rand) * 48 + rand() * 115;
          const th = rand() * Math.PI * 2;
          lx = Math.cos(th) * rad;
          lz = Math.sin(th) * rad;
          ly = gaussian(rand) * (6.2 + rad * 0.02);
          isKnot = rand() < 0.06;
        }
      } else if (isLenticular) {
        const inRing = k > perGalaxyStars * 0.65;
        const rad = inRing ? 280 + rand() * 230 : 100 + Math.pow(rand(), 0.72) * 165;
        const th = rand() * Math.PI * 2;
        lx = Math.cos(th) * rad;
        lz = Math.sin(th) * rad;
        ly = gaussian(rand) * (inRing ? 8.0 : 28 * (1 - (rad - 90) / 210));
        isKnot = inRing && rand() < 0.04;
      } else if (isBarred && k < perGalaxyStars * 0.18) {
        const along = (rand() - 0.5) * 480;
        const across = gaussian(rand) * 34;
        const barAng = ni * 0.8 + 0.4;
        lx = along * Math.cos(barAng) - across * Math.sin(barAng);
        lz = along * Math.sin(barAng) + across * Math.cos(barAng);
        ly = gaussian(rand) * 18;
        starTemp = 0.12;
      } else {
        const rad = 128 + Math.pow(rand(), 0.82) * 405;
        const armIdx = k % 2;
        const pitch = 2.65 * Math.log(rad / 115);
        const onArm = rand() < 0.78;
        const spreadAng = onArm ? gaussian(rand) * (0.28 + rad * 0.0008) : rand() * Math.PI * 2;
        const th = armIdx * Math.PI + pitch + spreadAng;
        lx = Math.cos(th) * rad;
        lz = Math.sin(th) * rad;
        ly = gaussian(rand) * (8.5 + rad * 0.025);
        isKnot = onArm && rand() < 0.06;
      }

      tmpWorld
        .copy(tmpHub)
        .addScaledVector(tmpU, lx)
        .addScaledVector(tmpV, lz)
        .addScaledVector(tmpN, ly);

      if (isKnot) {
        pushCosmosPoint(
          tmpWorld.x,
          tmpWorld.y,
          tmpWorld.z,
          cTmp.r * 0.82 + 0.14,
          cTmp.g * 0.82 + 0.14,
          cTmp.b * 0.82 + 0.14,
          5.6 + rand() * 5.2,
          2,
          0.34 + rand() * 0.22,
        );
      } else {
        const isBright = rand() < 0.035;
        const sz = isBright ? 4.8 + rand() * 3.8 : 1.1 + rand() * 1.9;
        const lum = isBright ? 0.92 + rand() * 0.35 : 0.24 + Math.pow(rand(), 2.2) * 0.56;
        if (starTemp < 0.3) {
          pushCosmosPoint(tmpWorld.x, tmpWorld.y, tmpWorld.z, 1.0, 0.84, 0.64, sz, isBright ? 1 : 0, lum);
        } else if (starTemp < 0.7) {
          pushCosmosPoint(
            tmpWorld.x,
            tmpWorld.y,
            tmpWorld.z,
            0.74 + cTmp.r * 0.2,
            0.84 + cTmp.g * 0.14,
            0.96 + cTmp.b * 0.04,
            sz,
            isBright ? 1 : 0,
            lum,
          );
        } else {
          pushCosmosPoint(tmpWorld.x, tmpWorld.y, tmpWorld.z, 0.96, 0.98, 1.0, sz, isBright ? 1 : 0, lum);
        }
      }
    }
  }

  // B. 斯隆长城高耸主脊星流、拉尼亚凯亚引力桥与深空河外星系海（克制亮度、拉开虚实层次）
  const sloanSpine = (u: number): [number, number, number] => {
    const t = u * 2 - 1;
    return [
      (t * 168 + Math.sin(t * 2.3) * 24) * COSMOS_SCALE,
      (68 + Math.sin(t * 2.1 + 0.4) * 26 + Math.cos(t * 4.0) * 11) * COSMOS_SCALE,
      (-112 - Math.cos(t * 1.45) * 36 + Math.sin(t * 2.8) * 14) * COSMOS_SCALE,
    ];
  };
  const bootesVoid = new THREE.Vector3(-960, -240, 820);

  while (sIdx < totalFieldStars) {
    const bucket = rand();
    let gx = 0;
    let gy = 0;
    let gz = 0;
    let isCluster = false;

    if (bucket < 0.48) {
      const [sx, sy, sz] = sloanSpine(rand());
      const sp = 58 + rand() * 130;
      gx = sx + gaussian(rand) * sp;
      gy = sy + gaussian(rand) * (sp * 0.65);
      gz = sz + gaussian(rand) * (sp * 0.72);
      isCluster = rand() < 0.12;
    } else if (bucket < 0.7) {
      const t = rand();
      const sPt = track.curve.getPointAt(t);
      const rad = 115 + Math.pow(rand(), 0.7) * 440;
      const th = rand() * Math.PI * 2;
      const ph = (rand() - 0.5) * 1.4;
      gx = sPt.x + Math.cos(ph) * Math.cos(th) * rad;
      gy = sPt.y + Math.sin(ph) * rad * 0.75;
      gz = sPt.z + Math.cos(ph) * Math.sin(th) * rad;
      isCluster = rand() < 0.08;
    } else {
      const rad = 1900 + Math.pow(rand(), 0.8) * 2650;
      const th = rand() * Math.PI * 2;
      const ph = Math.acos(2 * rand() - 1) - Math.PI * 0.5;
      gx = Math.cos(ph) * Math.cos(th) * rad;
      gy = Math.sin(ph) * rad * 0.8;
      gz = Math.cos(ph) * Math.sin(th) * rad;
      const dx = gx - bootesVoid.x;
      const dy = gy - bootesVoid.y;
      const dz = gz - bootesVoid.z;
      if (dx * dx + dy * dy + dz * dz < 480 * 480 && rand() < 0.96) continue;
      isCluster = rand() < 0.16;
    }

    const temp = rand();
    if (isCluster) {
      const sz = 6.5 + rand() * 8.5;
      const lum = 0.28 + rand() * 0.22;
      if (temp < 0.45) pushCosmosPoint(gx, gy, gz, 0.96, 0.76, 0.54, sz, 2, lum);
      else if (temp < 0.8) pushCosmosPoint(gx, gy, gz, 0.62, 0.8, 0.98, sz, 2, lum);
      else pushCosmosPoint(gx, gy, gz, 0.9, 0.66, 0.88, sz, 2, lum);
    } else {
      const bright = rand() < 0.032;
      const sz = bright ? 5.2 + rand() * 4.2 : 1.05 + rand() * 1.85;
      const lum = bright ? 0.95 + rand() * 0.35 : 0.22 + Math.pow(rand(), 2.3) * 0.54;
      if (temp < 0.34) pushCosmosPoint(gx, gy, gz, 1.0, 0.84, 0.68, sz, bright ? 1 : 0, lum);
      else if (temp < 0.72) pushCosmosPoint(gx, gy, gz, 0.76, 0.88, 1.0, sz, bright ? 1 : 0, lum);
      else pushCosmosPoint(gx, gy, gz, 0.98, 0.98, 1.0, sz, bright ? 1 : 0, lum);
    }
  }

  const fieldGeo = trackGeo(new THREE.BufferGeometry());
  fieldGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  fieldGeo.setAttribute('aColor', new THREE.BufferAttribute(starCol, 3));
  fieldGeo.setAttribute('aSize', new THREE.BufferAttribute(starSize, 1));
  fieldGeo.setAttribute('aKind', new THREE.BufferAttribute(starKind, 1));
  fieldGeo.setAttribute('aLum', new THREE.BufferAttribute(starLum, 1));
  fieldGeo.setAttribute('aSeed', new THREE.BufferAttribute(starSeed, 1));
  const fieldUniforms = {
    uPixelRatio: { value: 1 },
    uTime: { value: 0 },
    uWarp: { value: 0 },
  };
  const fieldMat = trackMat(
    new THREE.ShaderMaterial({
      vertexShader: cosmosStarVertex,
      fragmentShader: cosmosStarFragment,
      uniforms: fieldUniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  const fieldPoints = new THREE.Points(fieldGeo, fieldMat);
  fieldPoints.frustumCulled = false;
  group.add(fieldPoints);

  // ---- 层 4：巨尺度斯隆长城星云脊 & 宿主星系漫射外晕星雾（1 次 InstancedMesh，静态几何） ----
  interface VeilEntry {
    pos: THREE.Vector3;
    rot: THREE.Quaternion;
    sx: number;
    sy: number;
    warm: string;
    cool: string;
    seed: number;
    gain: number;
  }
  const veils: VeilEntry[] = [];
  const qTmp = new THREE.Quaternion();
  const qRot = new THREE.Quaternion();
  const xDir = new THREE.Vector3(1, 0, 0);

  const sloanVeilN = lite ? 28 : 52;
  for (let i = 0; i < sloanVeilN; i++) {
    const u = (i + 0.5) / sloanVeilN;
    const p0 = new THREE.Vector3(...sloanSpine(Math.max(u - 0.02, 0)));
    const p1 = new THREE.Vector3(...sloanSpine(Math.min(u + 0.02, 1)));
    const dir = p1.sub(p0).normalize();
    qTmp.setFromUnitVectors(xDir, dir);
    qRot.setFromAxisAngle(dir, i * 1.15);
    qRot.multiply(qTmp);
    const warmPal = ['#e66e5e', '#f29a6e', '#d474b8'];
    const coolPal = ['#5ab8ff', '#7ce2ff', '#7d92ff'];
    veils.push({
      pos: new THREE.Vector3(...sloanSpine(u)).add(
        new THREE.Vector3((rand() - 0.5) * 95, (rand() - 0.5) * 72, (rand() - 0.5) * 78),
      ),
      rot: qRot.clone(),
      sx: 370 + rand() * 290,
      sy: 165 + rand() * 125,
      warm: warmPal[i % warmPal.length],
      cool: coolPal[i % coolPal.length],
      seed: i * 0.43,
      gain: lite ? 0.13 : 0.11,
    });
  }

  // 每个核心星系外围包裹大尺度共面星系外盘尘雾
  const galCloudPal: Array<[string, string]> = [
    ['#ffb26b', '#6ea4ff'],
    ['#6ee7b7', '#7dd3fc'],
    ['#f074b4', '#86a2ff'],
    ['#ff9872', '#8f9ef6'],
    ['#ffd076', '#56dcff'],
  ];
  for (let i = 0; i < STAR_NODES.length; i++) {
    const node = STAR_NODES[i];
    const [tx, tz] = node.diskTilt ?? [0, 0];
    diskQ.setFromEuler(diskEuTmp.set(tx, 0, tz));
    const [warm, cool] = galCloudPal[i % galCloudPal.length];
    for (let k = 0; k < 4; k++) {
      const spin = (k / 4) * Math.PI * 2;
      const offR = 195;
      tmpU.set(Math.cos(spin) * offR, 0, Math.sin(spin) * offR).applyQuaternion(diskQ);
      tmpWorld.set(...node.position).multiplyScalar(COSMOS_SCALE).add(tmpU);
      qRot.copy(diskQ).multiply(qTmp.setFromEuler(diskEuTmp.set(-Math.PI * 0.5, 0, spin)));
      veils.push({
        pos: tmpWorld.clone(),
        rot: qRot.clone(),
        sx: 390 + k * 28,
        sy: 295 + k * 22,
        warm,
        cool,
        seed: 70 + i * 7 + k,
        gain: 0.09,
      });
    }
  }

  const vGeo = trackGeo(new THREE.PlaneGeometry(1, 1));
  const vWarm = new Float32Array(veils.length * 3);
  const vCool = new Float32Array(veils.length * 3);
  const vSeed = new Float32Array(veils.length);
  const vGain = new Float32Array(veils.length);
  const vc = new THREE.Color();
  for (let i = 0; i < veils.length; i++) {
    const v = veils[i];
    vc.set(v.warm);
    vWarm[i * 3] = vc.r;
    vWarm[i * 3 + 1] = vc.g;
    vWarm[i * 3 + 2] = vc.b;
    vc.set(v.cool);
    vCool[i * 3] = vc.r;
    vCool[i * 3 + 1] = vc.g;
    vCool[i * 3 + 2] = vc.b;
    vSeed[i] = v.seed;
    vGain[i] = v.gain;
  }
  vGeo.setAttribute('aWarm', new THREE.InstancedBufferAttribute(vWarm, 3));
  vGeo.setAttribute('aCool', new THREE.InstancedBufferAttribute(vCool, 3));
  vGeo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(vSeed, 1));
  vGeo.setAttribute('aGain', new THREE.InstancedBufferAttribute(vGain, 1));

  const vMat = trackMat(
    new THREE.ShaderMaterial({
      vertexShader: cosmicCloudVertex,
      fragmentShader: cosmicCloudFragment,
      uniforms: { uTime: { value: 0 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    }),
  );
  const cosmicCloudMesh = new THREE.InstancedMesh(vGeo, vMat, veils.length);
  cosmicCloudMesh.frustumCulled = false;
  for (let i = 0; i < veils.length; i++) {
    const v = veils[i];
    instScale.set(v.sx, v.sy, 1);
    instMat4.compose(v.pos, v.rot, instScale);
    cosmicCloudMesh.setMatrixAt(i, instMat4);
  }
  cosmicCloudMesh.instanceMatrix.needsUpdate = true;
  group.add(cosmicCloudMesh);

  // ---- 层 6：相对论星际流光丝（纯 GPU 零分配 LineSegments） ----
  const STREAMER_COUNT = lite ? 44 : 76;
  const stPos = new Float32Array(STREAMER_COUNT * 2 * 3);
  const stAngle = new Float32Array(STREAMER_COUNT * 2);
  const stRadius = new Float32Array(STREAMER_COUNT * 2);
  const stPhase = new Float32Array(STREAMER_COUNT * 2);
  const stLen = new Float32Array(STREAMER_COUNT * 2);
  const stEnd = new Float32Array(STREAMER_COUNT * 2);
  for (let i = 0; i < STREAMER_COUNT; i++) {
    const ang = (i / STREAMER_COUNT) * Math.PI * 2 + (rand() - 0.5) * 0.25;
    const rad = 8.4 + Math.pow(rand(), 0.72) * 14.5;
    const ph = rand();
    const ln = 5.5 + rand() * 8.5;
    for (let e = 0; e < 2; e++) {
      const idx = i * 2 + e;
      stAngle[idx] = ang;
      stRadius[idx] = rad;
      stPhase[idx] = ph;
      stLen[idx] = ln;
      stEnd[idx] = e;
    }
  }
  const streamerGeo = trackGeo(new THREE.BufferGeometry());
  streamerGeo.setAttribute('position', new THREE.BufferAttribute(stPos, 3));
  streamerGeo.setAttribute('aAngle', new THREE.BufferAttribute(stAngle, 1));
  streamerGeo.setAttribute('aRadius', new THREE.BufferAttribute(stRadius, 1));
  streamerGeo.setAttribute('aPhase', new THREE.BufferAttribute(stPhase, 1));
  streamerGeo.setAttribute('aLen', new THREE.BufferAttribute(stLen, 1));
  streamerGeo.setAttribute('aEnd', new THREE.BufferAttribute(stEnd, 1));
  const streamerMat = trackMat(
    new THREE.ShaderMaterial({
      vertexShader: streamerVertex,
      fragmentShader: streamerFragment,
      uniforms: {
        uShipPos: { value: new THREE.Vector3() },
        uFwd: { value: new THREE.Vector3(0, 0, -1) },
        uRight: { value: new THREE.Vector3(1, 0, 0) },
        uUp: { value: new THREE.Vector3(0, 1, 0) },
        uTime: { value: 0 },
        uSpeedNorm: { value: 0 },
        uErgoCharge: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  const streamerLines = new THREE.LineSegments(streamerGeo, streamerMat);
  streamerLines.frustumCulled = false;
  group.add(streamerLines);

  // ---- 层 7：黑洞能层潮汐等离子通道（5 座黑洞近心内缘合入单个 BufferGeometry） ----
  const ERGO_SEGS = 28;
  const ergoVertsPerHub = (ERGO_SEGS + 1) * 4;
  const ergoHubN = STAR_NODES.length;
  const ergoPosArr = new Float32Array(ergoHubN * ergoVertsPerHub * 3);
  const ergoUvArr = new Float32Array(ergoHubN * ergoVertsPerHub * 2);
  const ergoIndices: number[] = [];
  for (let h = 0; h < ergoHubN; h++) {
    const baseV = h * ergoVertsPerHub;
    for (let i = 0; i < ERGO_SEGS; i++) {
      const p0 = baseV + i * 2;
      const p1 = baseV + (i + 1) * 2;
      ergoIndices.push(p0, p0 + 1, p1, p0 + 1, p1 + 1, p1);
      const q0 = baseV + (ERGO_SEGS + 1) * 2 + i * 2;
      const q1 = baseV + (ERGO_SEGS + 1) * 2 + (i + 1) * 2;
      ergoIndices.push(q0, q0 + 1, q1, q0 + 1, q1 + 1, q1);
    }
  }
  const ergoGeo = trackGeo(new THREE.BufferGeometry());
  ergoGeo.setAttribute('position', new THREE.BufferAttribute(ergoPosArr, 3));
  ergoGeo.setAttribute('uv', new THREE.BufferAttribute(ergoUvArr, 2));
  ergoGeo.setIndex(ergoIndices);
  const ergoMat = trackMat(
    new THREE.ShaderMaterial({
      vertexShader: ergoStreamVertex,
      fragmentShader: ergoStreamFragment,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uAlpha: { value: 0 },
        uErgoCharge: { value: 0 },
        uNearHub: { value: new THREE.Vector3() },
        uColor: { value: new THREE.Color(0x9be2ff) },
        uWarpBeta: warpBeta,
        uWarpImage: warpImage,
        uWarpCenter: warpCenter,
        uWarpScale: warpScale,
      },
    }),
  );
  const ergoMesh = new THREE.Mesh(ergoGeo, ergoMat);
  ergoMesh.frustumCulled = false;
  ergoMesh.visible = false;
  group.add(ergoMesh);

  // ---- 层 5：深空航道侧翼脉冲星航标塔（与 26 座巨构星门协同拉起史诗远景参照物） ----
  const sample: TrackSample = {
    u: 0,
    s: 0,
    pos: new THREE.Vector3(),
    forward: new THREE.Vector3(),
    right: new THREE.Vector3(),
    up: new THREE.Vector3(),
  };
  const pulsarPair = buildPulsarBeaconPair();
  trackGeo(pulsarPair.hull);
  trackGeo(pulsarPair.beams);
  const pulsarHullMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xbacadc,
      emissive: 0x101c30,
      emissiveIntensity: 0.22,
      roughness: 0.34,
      metalness: 0.82,
    }),
  );
  const pulsarRotators: Array<{ root: THREE.Group; s: number; speed: number; beamMat: THREE.ShaderMaterial }> = [];
  const pulsarUs = [0.15, 0.36, 0.56, 0.74];
  const pulsarColors = [0xffae8c, 0xffadd2, 0x8ef0c8, 0x7ce2ff];
  for (let i = 0; i < pulsarUs.length; i++) {
    const s = pulsarUs[i] * track.totalLength;
    track.sampleAtS(s, sample);
    const side = i % 2 === 0 ? 1 : -1;
    const pRoot = new THREE.Group();
    pRoot.position
      .copy(sample.pos)
      .addScaledVector(sample.right, side * 46)
      .addScaledVector(sample.up, (i % 2 === 0 ? 1 : -1) * 14);
    pRoot.scale.setScalar(1.65);
    const beamMat = trackMat(
      new THREE.ShaderMaterial({
        vertexShader: pulsarBeamVertex,
        fragmentShader: pulsarBeamFragment,
        uniforms: {
          uTime: { value: 0 },
          uColor: { value: new THREE.Color(pulsarColors[i]) },
        },
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    pRoot.add(new THREE.Mesh(pulsarPair.hull, pulsarHullMat), new THREE.Mesh(pulsarPair.beams, beamMat));
    pRoot.rotation.set(0.38, i * 1.1, 0.26);
    group.add(pRoot);
    pulsarRotators.push({ root: pRoot, s, speed: 0.55 + i * 0.12, beamMat });
  }

  function attachLandmarks(imageLayer: number) {
    if (station) return;
    station = buildStation();
    station.scale.setScalar(3.4);
    warpObject(station, true);
    station.traverse((obj) => obj.layers.enable(imageLayer));
    group.add(station);

    rocks = buildRocks(lite, new THREE.Vector3(1, 0, 0));
    rocks.group.scale.setScalar(3.4);
    rocks.group.traverse((obj) => obj.layers.enable(imageLayer));
    group.add(rocks.group);
  }

  const zAxis = new THREE.Vector3(0, 0, 1);

  // ---- 18 座远距星际文明巨构星门（支持随随机新航线零分配重排） ----
  const gates: BoostGate[] = [];
  const GATE_COUNT = 18;
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
  const gateColors: THREE.Color[] = Array.from({ length: GATE_COUNT }, () => new THREE.Color());
  const hullTint = new THREE.Color();

  for (let i = 0; i < GATE_COUNT; i++) {
    gates.push({ index: i, s: 0, offX: 0, offY: 0, pos: new THREE.Vector3(), radius: 7.4, triggered: false });
  }
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
  type CollectibleBind =
    | { item: TrackCollectible; kind: 'hub'; regionId: string; du: number; ox: number; oy: number }
    | { item: TrackCollectible; kind: 'probe'; u: number; ox: number; oy: number };
  const collectibleBinds: CollectibleBind[] = [];

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

  const offsets: Array<[number, number, number]> = [
    [-0.018, -8.6, 2.4],
    [-0.007, 8.0, 3.0],
    [0.008, 8.8, -2.5],
    [0.019, -7.4, -2.6],
  ];

  for (const node of STAR_NODES) {
    const defs = GALAXY_RELIC_CATALOG[node.id] ?? [];
    const pair = catalogGeos[node.id] ?? catalogGeos.base;
    const accent = new THREE.Color(node.color);
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
        id: `${node.id}-relic-${k}`,
        regionId: node.id,
        regionName: node.name,
        name: def.name,
        hint: def.hint,
        color: node.color,
      };
      catalog.push(spec);

      const rGroup = new THREE.Group();
      rGroup.scale.setScalar(1.08);
      const frame = new THREE.Mesh(pair.frame, chassisMat);
      const core = new THREE.Mesh(pair.core, coreMat);
      rGroup.add(frame, core);
      rGroup.visible = false;
      group.add(rGroup);

      const item: TrackCollectible = {
        spec,
        group: rGroup,
        core,
        frame,
        basePos: new THREE.Vector3(),
        pos: rGroup.position,
        s: 0,
        collected: false,
      };
      collectibles.push(item);
      const [du, ox, oy] = offsets[k];
      collectibleBinds.push({ item, kind: 'hub', regionId: node.id, du, ox, oy });
    }
  }

  // 五具斯隆深空探测器
  const probePair = catalogGeos.cosmos;
  for (let i = 0; i < COSMOS_PROBES.length; i++) {
    const def = COSMOS_PROBES[i];
    const col = new THREE.Color(def.color);
    const spec: AtlasItemSpec = {
      id: `cosmos-probe-${i}`,
      regionId: 'cosmos',
      regionName: '斯隆深空',
      name: def.name,
      hint: def.hint,
      color: def.color,
    };
    catalog.push(spec);

    const rGroup = new THREE.Group();
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

    const item: TrackCollectible = {
      spec,
      group: rGroup,
      core,
      frame,
      basePos: new THREE.Vector3(),
      pos: rGroup.position,
      s: 0,
      collected: false,
    };
    collectibles.push(item);
    collectibleBinds.push({ item, kind: 'probe', u: def.u, ox: def.offX, oy: def.offY });
  }

  /** 按当前随机巡航航线原地重排星门、脉冲星航标与 25 件藏品坐标，零几何体分配 */
  function syncToTrack() {
    for (let i = 0; i < pulsarRotators.length; i++) {
      const s = pulsarUs[i] * track.totalLength;
      track.sampleAtS(s, sample);
      const side = i % 2 === 0 ? 1 : -1;
      pulsarRotators[i].s = s;
      pulsarRotators[i].root.position
        .copy(sample.pos)
        .addScaledVector(sample.right, side * 52)
        .addScaledVector(sample.up, (i % 2 === 0 ? 1 : -1) * 16);
    }

    flashArr.fill(-10);
    flashAttr.needsUpdate = true;
    for (let i = 0; i < GATE_COUNT; i++) {
      const u = 0.045 + (i / (GATE_COUNT - 1)) * 0.86;
      const s = u * track.totalLength;
      track.sampleAtS(s, sample);

      let minMsGap = Infinity;
      for (const ms of track.milestones) {
        minMsGap = Math.min(minMsGap, Math.abs(s - ms.s));
      }
      const wellFade = Math.min(Math.max((minMsGap - 95) / 110, 0), 1);
      const offX = Math.sin((i + 1) * 1.45) * 6.8 * wellFade;
      const offY = Math.cos((i + 1) * 1.05) * 2.6 * wellFade;

      const gate = gates[i];
      gate.s = s;
      gate.offX = offX;
      gate.offY = offY;
      gate.triggered = false;
      gate.pos
        .copy(sample.pos)
        .addScaledVector(sample.right, offX)
        .addScaledVector(sample.up, offY);

      const near = track.evaluateHub(gate.pos);
      const col = gateColors[i];
      col.set(near.node.color);
      hullTint.copy(col).lerp(new THREE.Color(0xcad8ea), 0.62);

      dummyQuat.setFromUnitVectors(zAxis, sample.forward);
      dummyMat.compose(gate.pos, dummyQuat, dummyScale);
      gateHullInst.setMatrixAt(i, dummyMat);
      gateHullInst.setColorAt(i, hullTint);
      gatePortalInst.setMatrixAt(i, dummyMat);
      gatePortalInst.setColorAt(i, col);
    }
    gateHullInst.instanceMatrix.needsUpdate = true;
    gatePortalInst.instanceMatrix.needsUpdate = true;
    if (gateHullInst.instanceColor) gateHullInst.instanceColor.needsUpdate = true;
    if (gatePortalInst.instanceColor) gatePortalInst.instanceColor.needsUpdate = true;

    for (const bind of collectibleBinds) {
      let su = 0;
      if (bind.kind === 'hub') {
        const ms = track.milestones.find((m) => m.node.id === bind.regionId);
        const baseU = ms ? ms.u : 0.1;
        su = Math.min(Math.max(baseU + bind.du, 0.02), 0.97);
      } else {
        su = bind.u;
      }
      const s = su * track.totalLength;
      track.sampleAtS(s, sample);
      bind.item.s = s;
      bind.item.collected = false;
      bind.item.basePos
        .copy(sample.pos)
        .addScaledVector(sample.right, bind.ox)
        .addScaledVector(sample.up, bind.oy);
      bind.item.group.position.copy(bind.item.basePos);
      bind.item.frame.position.y = 0;
      bind.item.core.position.y = 0;
      bind.item.group.visible = false;
    }

    // 重算 5 座黑洞的近心内缘能层潮汐等离子通道几何（始终贴向当前黑洞质心内侧 9.6 单位走廊）
    const ergoCenter = new THREE.Vector3();
    const ergoInward = new THREE.Vector3();
    const ergoOrtho = new THREE.Vector3();
    const ergoHubPt = new THREE.Vector3();
    const ergoRibbonW = 2.6;
    for (let h = 0; h < Math.min(ergoHubN, track.milestones.length); h++) {
      const ms = track.milestones[h];
      ergoHubPt.set(...ms.node.position).multiplyScalar(COSMOS_SCALE);
      const s0 = Math.max(0, ms.s - 155);
      const s1 = Math.min(track.totalLength, ms.s + 115);
      const baseV = h * ergoVertsPerHub;
      for (let i = 0; i <= ERGO_SEGS; i++) {
        const u = i / ERGO_SEGS;
        const s = s0 + (s1 - s0) * u;
        track.sampleAtS(s, sample);
        ergoInward.copy(ergoHubPt).sub(sample.pos);
        // 投影到航道横截面上（去除沿 forward 的分量）
        ergoInward.addScaledVector(sample.forward, -ergoInward.dot(sample.forward));
        if (ergoInward.lengthSq() < 1e-4) ergoInward.copy(sample.right);
        else ergoInward.normalize();
        ergoOrtho.crossVectors(sample.forward, ergoInward).normalize();

        const edgeEnv = Math.sin(u * Math.PI);
        const shift = 9.6 * (0.35 + 0.65 * Math.pow(edgeEnv, 0.55));
        ergoCenter.copy(sample.pos).addScaledVector(ergoInward, shift);
        const halfW = ergoRibbonW * 0.5 * (0.45 + 0.55 * edgeEnv);

        const vA = baseV + i * 2;
        ergoPosArr[vA * 3] = ergoCenter.x - ergoOrtho.x * halfW;
        ergoPosArr[vA * 3 + 1] = ergoCenter.y - ergoOrtho.y * halfW;
        ergoPosArr[vA * 3 + 2] = ergoCenter.z - ergoOrtho.z * halfW;
        ergoPosArr[(vA + 1) * 3] = ergoCenter.x + ergoOrtho.x * halfW;
        ergoPosArr[(vA + 1) * 3 + 1] = ergoCenter.y + ergoOrtho.y * halfW;
        ergoPosArr[(vA + 1) * 3 + 2] = ergoCenter.z + ergoOrtho.z * halfW;
        ergoUvArr[vA * 2] = u;
        ergoUvArr[vA * 2 + 1] = 0;
        ergoUvArr[(vA + 1) * 2] = u;
        ergoUvArr[(vA + 1) * 2 + 1] = 1;

        const vB = baseV + (ERGO_SEGS + 1) * 2 + i * 2;
        ergoPosArr[vB * 3] = ergoCenter.x - ergoInward.x * halfW;
        ergoPosArr[vB * 3 + 1] = ergoCenter.y - ergoInward.y * halfW;
        ergoPosArr[vB * 3 + 2] = ergoCenter.z - ergoInward.z * halfW;
        ergoPosArr[(vB + 1) * 3] = ergoCenter.x + ergoInward.x * halfW;
        ergoPosArr[(vB + 1) * 3 + 1] = ergoCenter.y + ergoInward.y * halfW;
        ergoPosArr[(vB + 1) * 3 + 2] = ergoCenter.z + ergoInward.z * halfW;
        ergoUvArr[vB * 2] = u;
        ergoUvArr[vB * 2 + 1] = 0;
        ergoUvArr[(vB + 1) * 2] = u;
        ergoUvArr[(vB + 1) * 2 + 1] = 1;
      }
    }
    (ergoGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (ergoGeo.attributes.uv as THREE.BufferAttribute).needsUpdate = true;
    ergoGeo.computeBoundingSphere();
  }

  syncToTrack();

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
    pixelRatio = 1,
    flight?: FlightVisualState,
  ) {
    diskBasis.makeBasis(diskU, diskN, instPos.copy(diskV).negate());
    diskQuat.setFromRotationMatrix(diskBasis);

    fieldUniforms.uPixelRatio.value = pixelRatio;
    fieldUniforms.uTime.value = simTime;
    const speedNorm = flight?.speedNorm ?? 0;
    const ergoCharge = flight?.ergoCharge ?? 0;
    fieldUniforms.uWarp.value = speedNorm;
    vMat.uniforms.uTime.value = simTime;

    if (flight && speedNorm > 0.1) {
      streamerLines.visible = true;
      streamerMat.uniforms.uShipPos.value.copy(flight.shipPos);
      streamerMat.uniforms.uFwd.value.copy(flight.forward);
      streamerMat.uniforms.uRight.value.copy(flight.right);
      streamerMat.uniforms.uUp.value.copy(flight.up);
      streamerMat.uniforms.uTime.value = simTime;
      streamerMat.uniforms.uSpeedNorm.value = speedNorm;
      streamerMat.uniforms.uErgoCharge.value = ergoCharge;
    } else {
      streamerLines.visible = false;
    }

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

    const showAccretion = holeAlpha > 0.03;
    torusMesh.visible = showAccretion;
    polarJetMesh.visible = showAccretion;
    ergoMesh.visible = showAccretion;

    if (showAccretion) {
      ergoMat.uniforms.uTime.value = simTime;
      ergoMat.uniforms.uAlpha.value = holeAlpha;
      ergoMat.uniforms.uErgoCharge.value = ergoCharge;
      ergoMat.uniforms.uNearHub.value.copy(centerVec);
      ergoMat.uniforms.uColor.value.set(nearNode.color);
      // 1. 活动星系核外围羽化尘埃环面（与黑洞赤道面严格共面，开普勒 ω ∝ r^-1.5）
      torusMat.uniforms.uTime.value = simTime;
      torusMat.uniforms.uAlpha.value = holeAlpha;
      torusMat.uniforms.uDiskN.value.copy(diskN);
      for (let i = 0; i < torusCount; i++) {
        const t = torusSpecs[i];
        const ang = t.a + simTime * t.speed;
        const rad = t.scaleRad * sc;
        instPos.copy(centerVec).addScaledVector(diskN, t.lift * sc);
        instSpin.setFromAxisAngle(diskN, ang);
        instQuat.copy(instSpin).multiply(diskQuat);
        instScale.set(rad, sc, rad);
        instMat4.compose(instPos, instQuat, instScale);
        torusMesh.setMatrixAt(i, instMat4);
      }
      torusMesh.instanceMatrix.needsUpdate = true;

      // 2. 垂直穿过磁极的双极相对论准直喷流
      const themeIdx = Math.min(JET_PALETTES.length - 1, Math.max(0, Math.round(nearNode.holeTheme ?? 0)));
      const [coreHex, jetHex] = JET_PALETTES[themeIdx];
      polarJetMesh.position.copy(centerVec);
      polarJetMesh.quaternion.copy(diskQuat);
      polarJetMesh.scale.setScalar(sc);
      jetMat.uniforms.uTime.value = simTime;
      jetMat.uniforms.uAlpha.value = holeAlpha;
      jetMat.uniforms.uCoreCol.value.setHex(coreHex);
      jetMat.uniforms.uJetCol.value.setHex(jetHex);
    }

    // 深空侧翼脉冲星航标塔按航程远近显隐并旋转
    for (let i = 0; i < pulsarRotators.length; i++) {
      const p = pulsarRotators[i];
      const inView = p.s >= trackS - 280 && p.s <= trackS + 1450;
      p.root.visible = inView;
      if (inView) {
        p.beamMat.uniforms.uTime.value = simTime;
        if (dt > 0) p.root.rotation.y += dt * p.speed;
      }
    }

    // 赛道视距裁剪：仅更新和显示视野区间内的藏品
    for (let i = 0; i < collectibles.length; i++) {
      const rel = collectibles[i];
      if (rel.collected) {
        rel.group.visible = false;
        continue;
      }
      const inRange = rel.s >= trackS - 55 && rel.s <= trackS + 750;
      rel.group.visible = inRange;
      if (!inRange) continue;
      rel.group.rotation.y += dt * 0.95;
      rel.core.rotation.y += dt * 0.65;
      const bob = Math.sin(simTime * 2.0 + i) * 0.16;
      rel.frame.position.y = bob;
      rel.core.position.y = bob;
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
    for (const g of geometries) g.dispose();
    for (const m of materials) m.dispose();
  }

  return {
    group,
    gates,
    collectibles,
    catalog,
    attachLandmarks,
    syncToTrack,
    triggerGate,
    update,
    resetProgress,
    dispose,
  };
}
