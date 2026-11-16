import * as THREE from 'three';

// 斯隆长城星图节点：hub 为可飞入中心黑洞并跃迁的核心星系
export interface StarNodeSpec {
  id: string;
  kind: 'hub' | 'landmark';
  name: string;
  code: string;
  sub: string;
  scaleLabel: string;
  position: [number, number, number];
  color: string;
  href?: string;
  targetLabel?: string;
  holeTheme?: number;
  holeScale?: number;
  diskTilt?: [number, number];
}

// 三个可交互核心星系节点（画面简洁聚焦，不堆砌无关地标文字）
export const STAR_NODES: StarNodeSpec[] = [
  {
    id: 'base',
    kind: 'hub',
    name: '基地',
    code: 'OBSERVATION DECK · SGR A*',
    sub: 'BASE',
    scaleLabel: '0 MPC · 原点',
    position: [0, 0, 0],
    color: '#ffc878',
    href: '/',
    targetLabel: '基地',
    holeTheme: 0,
    holeScale: 1,
    diskTilt: [0, 0],
  },
  {
    id: 'gallery',
    kind: 'hub',
    name: '画廊',
    code: 'NGC-2026G · 玫瑰星云核心',
    sub: 'GALLERY',
    scaleLabel: '58 MPC · 旋涡星系奇点',
    position: [-62, 54, -34],
    color: '#ff9ec7',
    href: '/gallery/',
    targetLabel: '诺诺的画廊',
    holeTheme: 1,
    holeScale: 1.85,
    diskTilt: [0.24, -0.15],
  },
  {
    id: 'game',
    kind: 'hub',
    name: '游戏',
    code: 'M-4321A · 电离棒旋核心',
    sub: 'ARCADE',
    scaleLabel: '64 MPC · 棒旋星系奇点',
    position: [68, -48, 34],
    color: '#7ce2ff',
    href: '/game/',
    targetLabel: '游戏大厅',
    holeTheme: 2,
    holeScale: 1.85,
    diskTilt: [-0.2, 0.16],
  },
];

// 极坐标外环方位角刻度（每 30° 一组，配合外圈天球罗盘刻度）
export const AZIMUTH_LABELS = Array.from({ length: 12 }, (_, i) => {
  const deg = i * 30;
  const rad = (deg * Math.PI) / 180;
  const r = 160;
  return {
    deg: `${deg}°`,
    position: new THREE.Vector3(Math.cos(rad) * r, 0, Math.sin(rad) * r),
  };
});

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

// 水平参考面着色器：无蜘蛛网辐射线，改为清晰立体星盘（极淡宇宙基底光晕 + 4道主距离环 + 双外环游标刻度 + 舒缓扫掠极光波）
const gridVertex = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const gridFragment = /* glsl */ `
  precision highp float;
  uniform float uOpacity;
  uniform float uTime;
  varying vec3 vWorld;

  void main() {
    if (uOpacity <= 0.002) discard;
    float r = length(vWorld.xz);
    if (r > 168.0 || r < 2.0) discard;

    float ang = atan(vWorld.z, vWorld.x);
    float deg = ang * 57.2957795;
    float fwR = max(fwidth(r), 0.05);
    float fwAng = max(fwidth(deg), 0.03);

    // 柔和极盘底辉：让水平面在 3D 空间中有清晰的纵深切片感，边缘自然融入深空
    float discMask = smoothstep(156.0, 128.0, r) * smoothstep(2.0, 14.0, r);
    float discSheen = discMask * (0.04 + 0.036 * exp(-r * 0.018));

    // 4 道清晰分层同心环 + 环带微晕（r = 32 / 68 / 108 / 152）
    float r1 = 1.0 - smoothstep(0.0, 1.5, abs(r - 32.0) / fwR);
    float r2 = 1.0 - smoothstep(0.0, 1.5, abs(r - 68.0) / fwR);
    float r3 = 1.0 - smoothstep(0.0, 1.6, abs(r - 108.0) / fwR);
    float r4 = 1.0 - smoothstep(0.0, 1.8, abs(r - 152.0) / fwR);
    float r4Inner = 1.0 - smoothstep(0.0, 1.4, abs(r - 148.5) / fwR);

    float dash2 = smoothstep(0.18, 0.32, abs(sin(ang * 12.0 + 0.35)));
    float dash3 = smoothstep(0.12, 0.25, abs(sin(ang * 18.0 - 0.2)));
    float ringGlow =
      exp(-abs(r - 32.0) * 0.55) * 0.08 +
      exp(-abs(r - 68.0) * 0.52) * 0.08 +
      exp(-abs(r - 108.0) * 0.48) * 0.1 +
      exp(-abs(r - 152.0) * 0.42) * 0.15;

    float rings = r1 * 0.36 + r2 * dash2 * 0.34 + r3 * dash3 * 0.4 + r4 * 0.62 + r4Inner * 0.24;

    // 外环精细罗盘游标刻度（5° 细刻 / 15° 中刻 / 90° 主准星短标）
    float notch5 = 1.0 - smoothstep(0.0, 1.15, abs(fract(deg / 5.0 - 0.5) - 0.5) * 5.0 / fwAng);
    float notch15 = 1.0 - smoothstep(0.0, 1.25, abs(fract(deg / 15.0 - 0.5) - 0.5) * 15.0 / fwAng);
    float notch90 = 1.0 - smoothstep(0.0, 1.35, abs(fract(deg / 90.0 - 0.5) - 0.5) * 90.0 / fwAng);
    float band5 = smoothstep(149.0, 149.8, r) * (1.0 - smoothstep(151.6, 152.2, r));
    float band15 = smoothstep(147.0, 148.0, r) * (1.0 - smoothstep(155.2, 156.0, r));
    float band90 = smoothstep(138.0, 139.0, r) * (1.0 - smoothstep(157.5, 158.5, r));
    float ticks = notch5 * band5 * 0.26 + notch15 * band15 * 0.42 + notch90 * band90 * 0.58;

    float innerCross = notch90 * smoothstep(6.0, 7.5, r) * (1.0 - smoothstep(16.0, 18.0, r)) * 0.3;

    // 舒缓脉冲扫描弧与径向引力波环
    float sweepPhase = fract((ang - uTime * 0.15) / 6.2831853);
    float sweepSector = pow(1.0 - sweepPhase, 10.0);
    float sweepRingWash = sweepSector * discMask * 0.08;
    float waveR = fract(uTime * 0.072) * 162.0;
    float waveMask = smoothstep(4.0, 18.0, waveR) * (1.0 - smoothstep(132.0, 160.0, waveR));
    float waveBand = exp(-pow((r - waveR) / 1.4, 2.0)) * waveMask;

    float baseLine = rings + ticks + innerCross;
    float scanGlow = baseLine * (sweepSector * 0.65 + exp(-pow((r - waveR) / 9.0, 2.0)) * waveMask * 0.5);

    vec3 deepNavy = vec3(0.16, 0.38, 0.78);
    vec3 rimBlue = vec3(0.36, 0.66, 0.98);
    vec3 softCyan = vec3(0.56, 0.90, 1.0);
    vec3 col =
      deepNavy * (discSheen + ringGlow) +
      rimBlue * baseLine +
      softCyan * (scanGlow + sweepRingWash + waveBand * 0.16);

    float alpha = clamp((discSheen + ringGlow + baseLine * 0.82 + scanGlow + sweepRingWash + waveBand * 0.16) * uOpacity, 0.0, 0.74);
    gl_FragColor = vec4(col, alpha);
  }
`;

// 三维纤维星云丝带着色器（沿斯隆长城与引力流切线螺旋排布，用域扭曲噪波织出连绵发光的星际激波丝状云带）
const veilVertex = /* glsl */ `
  attribute vec3 aVeilWarm;
  attribute vec3 aVeilCool;
  attribute float aVeilSeed;
  attribute float aVeilGain;

  varying vec2 vUv;
  varying vec3 vWarm;
  varying vec3 vCool;
  varying float vSeed;
  varying float vGain;

  void main() {
    vUv = uv - 0.5;
    vWarm = aVeilWarm;
    vCool = aVeilCool;
    vSeed = aVeilSeed;
    vGain = aVeilGain;
    vec4 localPos = vec4(position, 1.0);
    #ifdef USE_INSTANCING
      localPos = instanceMatrix * localPos;
    #endif
    gl_Position = projectionMatrix * modelViewMatrix * localPos;
  }
`;

const veilFragment = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform float uOpacity;

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
    float v = 0.0;
    float a = 0.55;
    for (int i = 0; i < 2; i++) {
      v += a * noise2(p);
      p = mat2(0.8, 0.6, -0.6, 0.8) * p * 2.15 + 4.3;
      a *= 0.45;
    }
    return v;
  }

  void main() {
    if (uOpacity <= 0.004) discard;
    // 长条形星云薄纱局部坐标（x 沿纤维流延伸，y 为横截面）
    vec2 p = vUv * 2.0;
    float edgeX = smoothstep(1.0, 0.18, abs(p.x));
    float edgeY = smoothstep(1.0, 0.14, abs(p.y));
    float mask = edgeX * edgeY;
    if (mask <= 0.002) discard;

    // 域扭曲做出轻盈丝缕与电离激波前缘（2 倍频兼顾丝感与移动端填充率性能）
    float flow = uTime * 0.012;
    vec2 q = vec2(p.x * 2.4 + vSeed * 11.3 + flow, p.y * 1.9 - vSeed * 7.1);
    float n1 = fbm2(q);
    float n2 = fbm2(q * 1.9 + vec2(n1 * 1.85, -n1 * 1.4));
    float ridge = pow(max(1.0 - abs(n2 - 0.48) * 3.1, 0.0), 1.9);
    float mist = smoothstep(0.24, 0.82, n1) * 0.46;

    // 纵深方向一条略微交错的电离暖红/冷青激波分层
    float sep = clamp(0.5 + (p.y + (n1 - 0.5) * 0.9) * 0.85, 0.0, 1.0);
    vec3 ribbonCol = mix(vWarm, vCool, sep);
    float density = (ridge * 0.82 + mist) * mask * vGain;

    float a = clamp(density * uOpacity, 0.0, 0.55);
    gl_FragColor = vec4(ribbonCol * a, a);
  }
`;

// 实例化三维多形态星系盘着色器（收敛尺寸且边缘柔融入周边星云）
const galaxyDiscVertex = /* glsl */ `
  attribute vec3 aInstCore;
  attribute vec3 aInstArm;
  attribute vec3 aInstRim;
  attribute float aInstType;
  attribute float aInstSeed;

  varying vec2 vUv;
  varying vec3 vCore;
  varying vec3 vArm;
  varying vec3 vRim;
  varying float vType;
  varying float vSeed;

  void main() {
    vUv = uv - 0.5;
    vCore = aInstCore;
    vArm = aInstArm;
    vRim = aInstRim;
    vType = aInstType;
    vSeed = aInstSeed;
    vec4 localPos = vec4(position, 1.0);
    #ifdef USE_INSTANCING
      localPos = instanceMatrix * localPos;
    #endif
    gl_Position = projectionMatrix * modelViewMatrix * localPos;
  }
`;

const galaxyDiscFragment = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform float uOpacity;

  varying vec2 vUv;
  varying vec3 vCore;
  varying vec3 vArm;
  varying vec3 vRim;
  varying float vType;
  varying float vSeed;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
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

  void main() {
    if (uOpacity <= 0.005) discard;
    vec2 p = vUv * 2.0;
    float r = length(p);
    if (r > 1.0) discard;

    float edgeFade = smoothstep(1.0, 0.28, r);
    float spin = uTime * 0.065 + vSeed * 6.283;
    float cs = cos(spin);
    float sn = sin(spin);
    vec2 q = mat2(cs, -sn, sn, cs) * p;
    float theta = atan(q.y, q.x);

    float core = exp(-r * r * 36.0) * 1.45;
    float halo = exp(-r * 5.8) * 0.3;
    float arms = 0.0;
    float knots = 0.0;
    float dust = 1.0;

    if (vType > 1.5) {
      float ring = exp(-pow((r - 0.6) * 8.0, 2.0)) * (0.68 + 0.32 * cos(theta * 3.0 + vSeed * 4.0));
      float n = noise2(q * 8.0 + vSeed * 7.0);
      arms = ring * (0.65 + 0.55 * n) * 0.88;
      knots = ring * smoothstep(0.62, 0.92, n) * 0.42;
    } else if (vType > 0.5) {
      float bar = exp(-q.x * q.x * 9.0 - q.y * q.y * 72.0) * smoothstep(0.5, 0.1, abs(q.x)) * 1.05;
      float phase = 2.0 * theta - 5.2 * log(max(r, 0.24) / 0.24);
      float spiral = pow(0.5 + 0.5 * cos(phase), 3.2) * smoothstep(0.18, 0.38, r) * exp(-r * 2.5);
      float n = noise2(q * 10.0 + vSeed * 5.0);
      arms = bar + spiral * (0.65 + 0.75 * n);
      knots = spiral * smoothstep(0.56, 0.9, n) * 0.58;
      dust = 1.0 - 0.52 * pow(0.5 - 0.5 * cos(phase + 0.48), 3.4) * smoothstep(0.2, 0.48, r);
    } else {
      float phase = 2.0 * theta - 5.8 * log(r + 0.08);
      float spiral = pow(0.5 + 0.5 * cos(phase), 2.8) * exp(-r * 2.6);
      float n = noise2(q * 11.0 + vSeed * 9.0);
      arms = spiral * (0.6 + 0.8 * n) * smoothstep(0.05, 0.2, r);
      knots = spiral * smoothstep(0.6, 0.9, n) * 0.55;
      dust = 1.0 - 0.55 * pow(0.5 - 0.5 * cos(phase + 0.42), 3.4) * smoothstep(0.1, 0.42, r);
    }

    vec3 col =
      vCore * (core + halo) +
      vArm * arms * dust +
      vRim * knots;
    float a = clamp((core + halo + arms + knots) * edgeFade * uOpacity, 0.0, 1.0);
    gl_FragColor = vec4(col * a, a);
  }
`;

// 纯净天体恒星着色器：彻底摒弃会形成「碎屑感」的倾斜小椭圆碎块，只留锐利钻石星点与精致十字衍射亮星
const starVertex = /* glsl */ `
  attribute vec3 aColor;
  attribute float aSize;
  attribute float aFlare;
  attribute float aSeed;

  uniform float uOpacity;
  uniform float uPixelRatio;
  uniform float uTime;

  varying vec3 vColor;
  varying float vAlpha;
  varying float vFlare;
  varying float vSeed;

  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    float dist = max(-mv.z, 6.0);
    float px = aSize * uPixelRatio * (260.0 / dist);
    gl_PointSize = clamp(px, 1.3, 30.0);

    float shimmer = 0.86 + 0.14 * sin(uTime * 1.2 + aSeed * 62.83);
    float fadeNear = smoothstep(2.5, 10.0, dist);
    vColor = aColor;
    vAlpha = uOpacity * shimmer * fadeNear;
    vFlare = aFlare;
    vSeed = aSeed;
  }
`;

const starFragment = /* glsl */ `
  precision highp float;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vFlare;
  varying float vSeed;

  void main() {
    if (vAlpha <= 0.005) discard;
    vec2 p = gl_PointCoord - 0.5;
    float d2 = dot(p, p);
    if (d2 > 0.25) discard;

    float r = sqrt(d2) * 2.0;
    float core = exp(-r * r * 38.0) * 1.45;
    float halo = exp(-r * 6.5) * 0.2;
    float shape = (core + halo) * smoothstep(1.0, 0.65, r);

    if (vFlare > 0.5) {
      float ang = vSeed * 6.28318;
      float cs = cos(ang);
      float sn = sin(ang);
      vec2 q = mat2(cs, -sn, sn, cs) * p * 2.0;
      float sx = exp(-abs(q.y) * 34.0) * exp(-abs(q.x) * 3.6);
      float sy = exp(-abs(q.x) * 34.0) * exp(-abs(q.y) * 3.6);
      shape += (sx + sy) * 0.72 * smoothstep(1.0, 0.68, r);
    }

    vec3 tint = mix(vColor, vec3(1.0), smoothstep(0.35, 1.05, core));
    float a = clamp(shape * vAlpha, 0.0, 1.0);
    gl_FragColor = vec4(tint * a, a);
  }
`;

// 垂直投影引线渐变着色器
const stalkVertex = /* glsl */ `
  attribute float aTop;
  attribute vec3 aColor;
  varying float vTop;
  varying vec3 vColor;
  varying vec2 vXZ;
  void main() {
    vTop = aTop;
    vColor = aColor;
    vXZ = position.xz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const stalkFragment = /* glsl */ `
  precision highp float;
  uniform float uOpacity;
  uniform float uTime;
  uniform float uBaseAlpha;
  varying float vTop;
  varying vec3 vColor;
  varying vec2 vXZ;

  void main() {
    if (uOpacity <= 0.005) discard;
    float r = length(vXZ);
    float ang = atan(vXZ.y, vXZ.x);
    float sweepPhase = fract((ang - uTime * 0.15) / 6.2831853);
    float sweep = pow(1.0 - sweepPhase, 10.0);
    float waveR = fract(uTime * 0.072) * 162.0;
    float wave = exp(-pow((r - waveR) / 9.0, 2.0));

    float grad = mix(0.2 + 0.65 * (sweep + wave), 0.95, vTop);
    float a = uBaseAlpha * grad * uOpacity;
    vec3 col = mix(vec3(0.52, 0.82, 1.0), vColor, 0.45 + 0.55 * vTop);
    gl_FragColor = vec4(col * a, a);
  }
`;

export interface MiniPoint {
  x: number;
  y: number;
  z: number;
  color: string;
}

export interface StarMapHandle {
  group: THREE.Group;
  polarDots: THREE.Vector3[];
  miniPoints: MiniPoint[];
  setOpacity: (opacity: number, time: number, pixelRatio: number) => void;
  dispose: () => void;
}

export function buildStarMap(lite: boolean): StarMapHandle {
  const rand = mulberry32(20261117);
  const group = new THREE.Group();
  group.visible = false;

  // 1. 清晰分层的天文水平参考盘
  const gridUniforms = {
    uOpacity: { value: 0 },
    uTime: { value: 0 },
  };
  const gridGeo = new THREE.PlaneGeometry(348, 348, 1, 1);
  gridGeo.rotateX(-Math.PI / 2);
  const gridMat = new THREE.ShaderMaterial({
    vertexShader: gridVertex,
    fragmentShader: gridFragment,
    uniforms: gridUniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const gridMesh = new THREE.Mesh(gridGeo, gridMat);
  gridMesh.frustumCulled = false;
  group.add(gridMesh);

  // 斯隆长城主拱脊线参数函数（更高耸绵延的十亿光年巨壁骨架，横贯南北天幕）
  const sloanSpine = (u: number): [number, number, number] => {
    const t = u * 2 - 1;
    const x = t * 154 + Math.sin(t * 2.3) * 20;
    const y = 62 + Math.sin(t * 2.1 + 0.4) * 22 + Math.cos(t * 4.0) * 9;
    const z = -104 - Math.cos(t * 1.45) * 32 + Math.sin(t * 2.8) * 12;
    return [x, y, z];
  };

  // 拉尼亚凯亚三条主要星际引力流弧线
  const laniakeaStream = (branch: number, t: number): [number, number, number] => {
    if (branch === 0) {
      return [
        THREE.MathUtils.lerp(-18, 92, t) + Math.sin(t * 4.2) * 8,
        THREE.MathUtils.lerp(4, 34, t) + Math.cos(t * 3.1) * 7,
        THREE.MathUtils.lerp(8, -56, t) - Math.sin(t * 2.6) * 10,
      ];
    }
    if (branch === 1) {
      return [
        THREE.MathUtils.lerp(-104, 10, t) + Math.cos(t * 3.4) * 7,
        THREE.MathUtils.lerp(-16, 48, t) + Math.sin(t * 3.2) * 6,
        THREE.MathUtils.lerp(66, -24, t) + Math.sin(t * 2.5) * 9,
      ];
    }
    return [
      THREE.MathUtils.lerp(18, 108, t) + Math.sin(t * 3.0) * 6,
      THREE.MathUtils.lerp(-6, -48, t) + Math.cos(t * 2.8) * 5,
      THREE.MathUtils.lerp(-4, 72, t) - Math.sin(t * 2.4) * 8,
    ];
  };

  // 2. 体积感三维星际丝状星云带（沿斯隆长城与拉尼亚凯亚脊线布置交错丝巾面，消除离散“碎屑感”）
  interface VeilSeg {
    pos: THREE.Vector3;
    dir: THREE.Vector3;
    len: number;
    wid: number;
    roll: number;
    warm: string;
    cool: string;
    seed: number;
    gain: number;
  }

  const veils: VeilSeg[] = [];
  const sloanVeilCount = lite ? 34 : 68;
  for (let i = 0; i < sloanVeilCount; i++) {
    const u = (i + 0.5) / sloanVeilCount;
    const p0 = new THREE.Vector3(...sloanSpine(Math.max(u - 0.02, 0)));
    const p1 = new THREE.Vector3(...sloanSpine(Math.min(u + 0.02, 1)));
    const dir = p1.clone().sub(p0).normalize();
    const pos = new THREE.Vector3(...sloanSpine(u)).add(
      new THREE.Vector3((rand() - 0.5) * 8, (rand() - 0.5) * 7, (rand() - 0.5) * 7),
    );
    const knotBoost = 0.72 + 0.45 * Math.pow(Math.sin(u * Math.PI * 4.0), 2);
    // 玫瑰金-珊瑚氢电离丝带 + 冰青蓝氧电离丝带
    const warmPalette = ['#e8685c', '#f2946e', '#d678b8'];
    const coolPalette = ['#5cb8ff', '#7ce2ff', '#7d92ff'];
    veils.push({
      pos,
      dir,
      len: 26 + rand() * 18,
      wid: 14 + rand() * 11,
      roll: (i * 1.18) % Math.PI,
      warm: warmPalette[i % warmPalette.length],
      cool: coolPalette[i % coolPalette.length],
      seed: i * 0.37,
      gain: (lite ? 0.36 : 0.29) * knotBoost,
    });
  }

  const streamVeilPerBranch = lite ? 10 : 20;
  for (let branch = 0; branch < 3; branch++) {
    for (let i = 0; i < streamVeilPerBranch; i++) {
      const t = (i + 0.5) / streamVeilPerBranch;
      const p0 = new THREE.Vector3(...laniakeaStream(branch, Math.max(t - 0.025, 0)));
      const p1 = new THREE.Vector3(...laniakeaStream(branch, Math.min(t + 0.025, 1)));
      const dir = p1.clone().sub(p0).normalize();
      const pos = new THREE.Vector3(...laniakeaStream(branch, t)).add(
        new THREE.Vector3((rand() - 0.5) * 6, (rand() - 0.5) * 5, (rand() - 0.5) * 6),
      );
      veils.push({
        pos,
        dir,
        len: 22 + rand() * 14,
        wid: 11 + rand() * 8,
        roll: ((branch * 2 + i) * 1.15) % Math.PI,
        warm: branch === 1 ? '#e284bc' : '#eb986c',
        cool: branch === 2 ? '#5dd6ff' : '#6ca4ff',
        seed: 40 + branch * 17 + i * 0.41,
        gain: lite ? 0.25 : 0.21,
      });
    }
  }

  // 三座交互中心外围也点亮柔和深空星云晕（令核心星系与纤维丝自然焊接）
  const hubVeils: [StarNodeSpec, string, string][] = [
    [STAR_NODES[0], '#ffb46e', '#6ea4ff'],
    [STAR_NODES[1], '#f078b0', '#7ca8ff'],
    [STAR_NODES[2], '#ffd078', '#52dcff'],
  ];
  for (let i = 0; i < hubVeils.length; i++) {
    const [node, warm, cool] = hubVeils[i];
    for (let k = 0; k < 2; k++) {
      veils.push({
        pos: new THREE.Vector3(...node.position),
        dir: new THREE.Vector3(Math.cos(i + k * 1.4), 0.35 * (k - 0.5), Math.sin(i + k * 1.4)).normalize(),
        len: 28,
        wid: 22,
        roll: k * 1.35 + i * 0.5,
        warm,
        cool,
        seed: 95 + i * 3 + k,
        gain: 0.22,
      });
    }
  }

  // 天球坐标盘之外（r = 175..265）的遥远背景宇宙网余晖丝带，打破「圆盘边界感」，拉开深空大尺度纵深
  const outerVeilCount = lite ? 8 : 16;
  for (let i = 0; i < outerVeilCount; i++) {
    const ang = (i / outerVeilCount) * Math.PI * 2 + 0.2;
    const rad = 185 + rand() * 82;
    const y = (rand() - 0.5) * 110;
    veils.push({
      pos: new THREE.Vector3(Math.cos(ang) * rad, y, Math.sin(ang) * rad),
      dir: new THREE.Vector3(-Math.sin(ang), (rand() - 0.5) * 0.4, Math.cos(ang)).normalize(),
      len: 48 + rand() * 28,
      wid: 22 + rand() * 14,
      roll: (i * 0.9) % Math.PI,
      warm: i % 2 === 0 ? '#a85a7a' : '#7b68b4',
      cool: i % 2 === 0 ? '#4d78cc' : '#4a98c8',
      seed: 130 + i * 0.83,
      gain: 0.14,
    });
  }

  const veilCount = veils.length;
  const veilGeo = new THREE.PlaneGeometry(1, 1);
  const veilWarmAttr = new Float32Array(veilCount * 3);
  const veilCoolAttr = new Float32Array(veilCount * 3);
  const veilSeedAttr = new Float32Array(veilCount);
  const veilGainAttr = new Float32Array(veilCount);
  const vCol = new THREE.Color();

  for (let i = 0; i < veilCount; i++) {
    const v = veils[i];
    const i3 = i * 3;
    vCol.set(v.warm);
    veilWarmAttr[i3] = vCol.r;
    veilWarmAttr[i3 + 1] = vCol.g;
    veilWarmAttr[i3 + 2] = vCol.b;
    vCol.set(v.cool);
    veilCoolAttr[i3] = vCol.r;
    veilCoolAttr[i3 + 1] = vCol.g;
    veilCoolAttr[i3 + 2] = vCol.b;
    veilSeedAttr[i] = v.seed;
    veilGainAttr[i] = v.gain;
  }
  veilGeo.setAttribute('aVeilWarm', new THREE.InstancedBufferAttribute(veilWarmAttr, 3));
  veilGeo.setAttribute('aVeilCool', new THREE.InstancedBufferAttribute(veilCoolAttr, 3));
  veilGeo.setAttribute('aVeilSeed', new THREE.InstancedBufferAttribute(veilSeedAttr, 1));
  veilGeo.setAttribute('aVeilGain', new THREE.InstancedBufferAttribute(veilGainAttr, 1));

  const veilUniforms = {
    uTime: { value: 0 },
    uOpacity: { value: 0 },
  };
  const veilMat = new THREE.ShaderMaterial({
    vertexShader: veilVertex,
    fragmentShader: veilFragment,
    uniforms: veilUniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const veilMesh = new THREE.InstancedMesh(veilGeo, veilMat, veilCount);
  veilMesh.frustumCulled = false;

  const xAxis = new THREE.Vector3(1, 0, 0);
  const qAlign = new THREE.Quaternion();
  const qRoll = new THREE.Quaternion();
  const mTmp = new THREE.Matrix4();
  const sTmp = new THREE.Vector3();

  for (let i = 0; i < veilCount; i++) {
    const v = veils[i];
    qAlign.setFromUnitVectors(xAxis, v.dir);
    qRoll.setFromAxisAngle(v.dir, v.roll);
    qRoll.multiply(qAlign);
    sTmp.set(v.len, v.wid, 1);
    mTmp.compose(v.pos, qRoll, sTmp);
    veilMesh.setMatrixAt(i, mTmp);
  }
  veilMesh.instanceMatrix.needsUpdate = true;
  group.add(veilMesh);

  // 3. 纤细连续的宇宙网骨骼引力丝线（贯穿斯隆长城与拉尼亚凯亚流，与星云带轻柔贴合）
  const tendrilPositions: number[] = [];
  const tendrilColors: number[] = [];
  const tendrilTops: number[] = [];
  const tendrilSteps = 32;

  const pushTendril = (sampler: (t: number) => [number, number, number], hex: string, jitter: number, phase: number) => {
    vCol.set(hex);
    for (let i = 0; i < tendrilSteps; i++) {
      const t0 = i / tendrilSteps;
      const t1 = (i + 1) / tendrilSteps;
      const p0 = sampler(t0);
      const p1 = sampler(t1);
      const j0 = Math.sin(t0 * Math.PI * 5 + phase) * jitter;
      const j1 = Math.sin(t1 * Math.PI * 5 + phase) * jitter;
      const k0 = Math.cos(t0 * Math.PI * 4 + phase * 1.3) * jitter * 0.7;
      const k1 = Math.cos(t1 * Math.PI * 4 + phase * 1.3) * jitter * 0.7;
      tendrilPositions.push(p0[0] + j0, p0[1] + k0, p0[2] - j0 * 0.5, p1[0] + j1, p1[1] + k1, p1[2] - j1 * 0.5);
      tendrilColors.push(vCol.r, vCol.g, vCol.b, vCol.r, vCol.g, vCol.b);
      const fade0 = Math.sin(t0 * Math.PI);
      const fade1 = Math.sin(t1 * Math.PI);
      tendrilTops.push(fade0, fade1);
    }
  };

  pushTendril(sloanSpine, '#f0a69a', 2.4, 0.2);
  pushTendril(sloanSpine, '#88d4ff', 3.2, 2.1);
  pushTendril(sloanSpine, '#a6b8ff', 2.8, 4.0);
  for (let b = 0; b < 3; b++) {
    pushTendril((t) => laniakeaStream(b, t), b === 1 ? '#e49ad0' : '#7ecaff', 2.1, b * 1.7);
    pushTendril((t) => laniakeaStream(b, t), '#ffd6a2', 1.8, b * 1.7 + 2.4);
  }

  const tendrilGeo = new THREE.BufferGeometry();
  tendrilGeo.setAttribute('position', new THREE.Float32BufferAttribute(tendrilPositions, 3));
  tendrilGeo.setAttribute('aColor', new THREE.Float32BufferAttribute(tendrilColors, 3));
  tendrilGeo.setAttribute('aTop', new THREE.Float32BufferAttribute(tendrilTops, 1));
  const tendrilUniforms = {
    uOpacity: { value: 0 },
    uTime: { value: 0 },
    uBaseAlpha: { value: 0.14 },
  };
  const tendrilMat = new THREE.ShaderMaterial({
    vertexShader: stalkVertex,
    fragmentShader: stalkFragment,
    uniforms: tendrilUniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const tendrilLines = new THREE.LineSegments(tendrilGeo, tendrilMat);
  tendrilLines.frustumCulled = false;
  group.add(tendrilLines);

  // 4. 精选且尺度协调的 3D 程序化星系群（3 核心枢纽 + 11 伴星系）
  interface GalaxyDef {
    pos: [number, number, number];
    size: number;
    euler: [number, number, number];
    core: string;
    arm: string;
    rim: string;
    type: 0 | 1 | 2;
    seed: number;
  }

  const galaxyDefs: GalaxyDef[] = [
    {
      pos: STAR_NODES[0].position,
      size: 12.0,
      euler: [Math.PI * 0.46, 0.12, 0.18],
      core: '#fff4dc',
      arm: '#ffb464',
      rim: '#94c8ff',
      type: 0,
      seed: 0.12,
    },
    {
      pos: STAR_NODES[1].position,
      size: 14.5,
      euler: [Math.PI * 0.34, 0.3, -0.22],
      core: '#fff2f8',
      arm: '#ff88be',
      rim: '#c2a6ff',
      type: 0,
      seed: 0.47,
    },
    {
      pos: STAR_NODES[2].position,
      size: 14.5,
      euler: [-Math.PI * 0.36, -0.34, 0.25],
      core: '#fff7de',
      arm: '#62e0ff',
      rim: '#ffd086',
      type: 1,
      seed: 0.83,
    },
  ];

  const palettes: [string, string, string][] = [
    ['#fff4dc', '#ffb673', '#96c8ff'],
    ['#eef6ff', '#82beff', '#ffd69e'],
    ['#fff1f8', '#e29eff', '#94c4ff'],
  ];

  const companionUs = [0.12, 0.28, 0.46, 0.62, 0.78, 0.91];
  for (let i = 0; i < companionUs.length; i++) {
    const [sx, sy, sz] = sloanSpine(companionUs[i]);
    const pal = palettes[i % palettes.length];
    galaxyDefs.push({
      pos: [sx + (rand() - 0.5) * 6, sy + (rand() - 0.5) * 5, sz + (rand() - 0.5) * 5],
      size: 6.2 + rand() * 3.8,
      euler: [(rand() - 0.5) * 2.1, (rand() - 0.5) * 2.2, (rand() - 0.5) * 1.6],
      core: pal[0],
      arm: pal[1],
      rim: pal[2],
      type: (i % 3) as 0 | 1 | 2,
      seed: 1.5 + i * 0.85,
    });
  }
  for (let i = 0; i < 5; i++) {
    const branch = i % 3;
    const t = 0.25 + (i / 5) * 0.62;
    const [lx, ly, lz] = laniakeaStream(branch, t);
    const pal = palettes[(i + 1) % palettes.length];
    galaxyDefs.push({
      pos: [lx + (rand() - 0.5) * 5, ly + (rand() - 0.5) * 4, lz + (rand() - 0.5) * 5],
      size: 5.8 + rand() * 3.4,
      euler: [(rand() - 0.5) * 1.8, (rand() - 0.5) * 2.4, (rand() - 0.5) * 1.5],
      core: pal[0],
      arm: pal[1],
      rim: pal[2],
      type: ((i + 1) % 3) as 0 | 1 | 2,
      seed: 9.2 + i * 0.91,
    });
  }

  const instCount = galaxyDefs.length;
  const instGeo = new THREE.PlaneGeometry(1, 1);
  const instCore = new Float32Array(instCount * 3);
  const instArm = new Float32Array(instCount * 3);
  const instRim = new Float32Array(instCount * 3);
  const instType = new Float32Array(instCount);
  const instSeed = new Float32Array(instCount);

  for (let i = 0; i < instCount; i++) {
    const g = galaxyDefs[i];
    const i3 = i * 3;
    vCol.set(g.core);
    instCore[i3] = vCol.r;
    instCore[i3 + 1] = vCol.g;
    instCore[i3 + 2] = vCol.b;
    vCol.set(g.arm);
    instArm[i3] = vCol.r;
    instArm[i3 + 1] = vCol.g;
    instArm[i3 + 2] = vCol.b;
    vCol.set(g.rim);
    instRim[i3] = vCol.r;
    instRim[i3 + 1] = vCol.g;
    instRim[i3 + 2] = vCol.b;
    instType[i] = g.type;
    instSeed[i] = g.seed;
  }

  instGeo.setAttribute('aInstCore', new THREE.InstancedBufferAttribute(instCore, 3));
  instGeo.setAttribute('aInstArm', new THREE.InstancedBufferAttribute(instArm, 3));
  instGeo.setAttribute('aInstRim', new THREE.InstancedBufferAttribute(instRim, 3));
  instGeo.setAttribute('aInstType', new THREE.InstancedBufferAttribute(instType, 1));
  instGeo.setAttribute('aInstSeed', new THREE.InstancedBufferAttribute(instSeed, 1));

  const instUniforms = {
    uTime: { value: 0 },
    uOpacity: { value: 0 },
  };
  const instMat = new THREE.ShaderMaterial({
    vertexShader: galaxyDiscVertex,
    fragmentShader: galaxyDiscFragment,
    uniforms: instUniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const galaxyInstanced = new THREE.InstancedMesh(instGeo, instMat, instCount);
  galaxyInstanced.frustumCulled = false;

  const dummyObj = new THREE.Object3D();
  for (let i = 0; i < instCount; i++) {
    const g = galaxyDefs[i];
    dummyObj.position.set(...g.pos);
    dummyObj.rotation.set(...g.euler);
    dummyObj.scale.setScalar(g.size);
    dummyObj.updateMatrix();
    galaxyInstanced.setMatrixAt(i, dummyObj.matrix);
  }
  galaxyInstanced.instanceMatrix.needsUpdate = true;
  group.add(galaxyInstanced);

  // 5. 纯净钻石星海：嵌于发光星云带内的针尖恒星 + 稀疏十字星芒（彻底无“碎屑感”）
  const total = lite ? 900 : 1800;
  const positions = new Float32Array(total * 3);
  const colors = new Float32Array(total * 3);
  const sizes = new Float32Array(total);
  const flares = new Float32Array(total);
  const seeds = new Float32Array(total);
  const miniPoints: MiniPoint[] = [];

  const cTmp = new THREE.Color();
  const bootesCenter = new THREE.Vector3(-84, -22, 72);

  let idx = 0;
  const pushStar = (
    x: number,
    y: number,
    z: number,
    rCol: number,
    gCol: number,
    bCol: number,
    size: number,
    flare: number,
    keepMini = false,
  ) => {
    if (idx >= total) return;
    const i3 = idx * 3;
    positions[i3] = x;
    positions[i3 + 1] = y;
    positions[i3 + 2] = z;
    colors[i3] = rCol;
    colors[i3 + 1] = gCol;
    colors[i3 + 2] = bCol;
    sizes[idx] = size;
    flares[idx] = flare;
    seeds[idx] = rand();
    if (keepMini && miniPoints.length < 130) {
      cTmp.setRGB(Math.min(rCol, 1), Math.min(gCol, 1), Math.min(bCol, 1));
      miniPoints.push({ x, y, z, color: `#${cTmp.getHexString()}` });
    }
    idx++;
  };

  // A. 斯隆长城丝带上的细碎钻石恒星群（46%）
  const sloanCount = Math.floor(total * 0.46);
  for (let i = 0; i < sloanCount; i++) {
    const u = rand();
    const [sx, sy, sz] = sloanSpine(u);
    const spread = 2.6 + rand() * 5.2;
    const gx = sx + gaussian(rand) * spread;
    const gy = sy + gaussian(rand) * (spread * 0.65);
    const gz = sz + gaussian(rand) * (spread * 0.62);
    const flare = rand() < 0.08 ? 1 : 0;
    const szScale = flare ? 4.4 + rand() * 3.8 : 1.5 + rand() * 2.2;
    const warm = rand();
    if (warm < 0.36) {
      pushStar(gx, gy, gz, 1.0, 0.85, 0.68, szScale, flare, i % 7 === 0);
    } else if (warm < 0.74) {
      pushStar(gx, gy, gz, 0.76, 0.9, 1.0, szScale, flare, i % 7 === 0);
    } else {
      pushStar(gx, gy, gz, 0.98, 0.97, 1.0, szScale, flare, i % 7 === 0);
    }
  }

  // B. 拉尼亚凯亚星流中的星点（34%）
  const streamCount = Math.floor(total * 0.34);
  for (let i = 0; i < streamCount; i++) {
    const branch = i % 3;
    const t = rand();
    const [lx, ly, lz] = laniakeaStream(branch, t);
    const spread = 2.6 + Math.sin(t * Math.PI) * 3.0;
    const x = lx + gaussian(rand) * spread;
    const y = ly + gaussian(rand) * (spread * 0.72);
    const z = lz + gaussian(rand) * spread;
    const flare = rand() < 0.09 ? 1 : 0;
    const szScale = flare ? 4.2 + rand() * 3.6 : 1.4 + rand() * 2.1;
    const tint = rand();
    if (tint < 0.4) {
      pushStar(x, y, z, 0.76, 0.89, 1.0, szScale, flare, i % 10 === 0);
    } else if (tint < 0.74) {
      pushStar(x, y, z, 1.0, 0.89, 0.74, szScale, flare, i % 10 === 0);
    } else {
      pushStar(x, y, z, 0.96, 0.97, 1.0, szScale, flare, false);
    }
  }

  // C. 深空缀星背景（20%，避开牧夫座巨洞留出幽深对照）
  while (idx < total) {
    const rad = 42 + Math.pow(rand(), 0.78) * 120;
    const th = rand() * Math.PI * 2;
    const ph = (rand() - 0.5) * 0.98;
    const x = Math.cos(ph) * Math.cos(th) * rad;
    const y = Math.sin(ph) * rad * 0.75;
    const z = Math.cos(ph) * Math.sin(th) * rad;

    const dx = x - bootesCenter.x;
    const dy = y - bootesCenter.y;
    const dz = z - bootesCenter.z;
    if (dx * dx + dy * dy + dz * dz < 44 * 44 && rand() < 0.98) continue;

    const flare = rand() < 0.12 ? 1 : 0;
    const szScale = flare ? 4.4 + rand() * 4.2 : 1.5 + rand() * 2.1;
    const tint = rand();
    if (tint < 0.36) {
      pushStar(x, y, z, 0.78, 0.9, 1.0, szScale, flare, false);
    } else if (tint < 0.72) {
      pushStar(x, y, z, 1.0, 0.88, 0.74, szScale, flare, false);
    } else {
      pushStar(x, y, z, 0.98, 0.98, 1.0, szScale, flare, false);
    }
  }

  const cloudGeo = new THREE.BufferGeometry();
  cloudGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  cloudGeo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  cloudGeo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  cloudGeo.setAttribute('aFlare', new THREE.BufferAttribute(flares, 1));
  cloudGeo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));

  const cloudUniforms = {
    uOpacity: { value: 0 },
    uPixelRatio: { value: 1 },
    uTime: { value: 0 },
  };
  const cloudMat = new THREE.ShaderMaterial({
    vertexShader: starVertex,
    fragmentShader: starFragment,
    uniforms: cloudUniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const cloudPoints = new THREE.Points(cloudGeo, cloudMat);
  cloudPoints.frustumCulled = false;
  group.add(cloudPoints);

  // 6. 垂直投影引线（3 核心枢纽 + 14 根远空星标垂线）
  const mainStalkPos: number[] = [];
  const mainStalkTop: number[] = [];
  const mainStalkCol: number[] = [];
  const bgStalkPos: number[] = [];
  const bgStalkTop: number[] = [];
  const bgStalkCol: number[] = [];
  const ringPosList: [number, number, number, string][] = [];

  const tmpCol = new THREE.Color();
  for (const node of STAR_NODES) {
    const [x, y, z] = node.position;
    tmpCol.set(node.color);
    if (Math.abs(y) > 0.2) {
      mainStalkPos.push(x, y, z, x, 0, z);
      mainStalkTop.push(1, 0);
      mainStalkCol.push(tmpCol.r, tmpCol.g, tmpCol.b, tmpCol.r, tmpCol.g, tmpCol.b);
    }
    ringPosList.push([x, 0, z, node.color]);
  }

  const pillarCount = lite ? 8 : 14;
  const pillarPositions = new Float32Array(pillarCount * 3);
  const pillarColors = new Float32Array(pillarCount * 3);
  const pillarSizes = new Float32Array(pillarCount);
  const pillarFlares = new Float32Array(pillarCount);
  const pillarSeeds = new Float32Array(pillarCount);

  for (let i = 0; i < pillarCount; i++) {
    let x: number;
    let y: number;
    let z: number;
    if (i < pillarCount * 0.45) {
      const [sx, sy, sz] = sloanSpine(0.1 + (i / (pillarCount * 0.45)) * 0.8);
      x = sx + (rand() - 0.5) * 5;
      y = sy + (rand() - 0.5) * 5;
      z = sz + (rand() - 0.5) * 5;
    } else {
      const branch = i % 3;
      const t = 0.28 + ((i - Math.floor(pillarCount * 0.45)) / (pillarCount * 0.55)) * 0.62;
      const [lx, ly, lz] = laniakeaStream(branch, t);
      x = lx;
      y = ly + (i % 2 === 0 ? 16 : -14);
      z = lz;
    }

    const warm = rand();
    const hex = warm < 0.35 ? '#ffd49e' : warm < 0.72 ? '#a8d0ff' : '#ffffff';
    tmpCol.set(hex);

    bgStalkPos.push(x, y, z, x, 0, z);
    bgStalkTop.push(1, 0);
    bgStalkCol.push(tmpCol.r, tmpCol.g, tmpCol.b, tmpCol.r, tmpCol.g, tmpCol.b);
    ringPosList.push([x, 0, z, hex]);

    const p3 = i * 3;
    pillarPositions[p3] = x;
    pillarPositions[p3 + 1] = y;
    pillarPositions[p3 + 2] = z;
    pillarColors[p3] = tmpCol.r;
    pillarColors[p3 + 1] = tmpCol.g;
    pillarColors[p3 + 2] = tmpCol.b;
    pillarSizes[i] = 5.5 + rand() * 3.5;
    pillarFlares[i] = 1;
    pillarSeeds[i] = rand();
  }

  const pillarGeo = new THREE.BufferGeometry();
  pillarGeo.setAttribute('position', new THREE.BufferAttribute(pillarPositions, 3));
  pillarGeo.setAttribute('aColor', new THREE.BufferAttribute(pillarColors, 3));
  pillarGeo.setAttribute('aSize', new THREE.BufferAttribute(pillarSizes, 1));
  pillarGeo.setAttribute('aFlare', new THREE.BufferAttribute(pillarFlares, 1));
  pillarGeo.setAttribute('aSeed', new THREE.BufferAttribute(pillarSeeds, 1));
  const pillarPoints = new THREE.Points(pillarGeo, cloudMat);
  pillarPoints.frustumCulled = false;
  group.add(pillarPoints);

  const makeStalkMesh = (posArr: number[], topArr: number[], colArr: number[], baseAlpha: number) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(posArr, 3));
    geo.setAttribute('aTop', new THREE.Float32BufferAttribute(topArr, 1));
    geo.setAttribute('aColor', new THREE.Float32BufferAttribute(colArr, 3));
    const uniforms = {
      uOpacity: { value: 0 },
      uTime: { value: 0 },
      uBaseAlpha: { value: baseAlpha },
    };
    const mat = new THREE.ShaderMaterial({
      vertexShader: stalkVertex,
      fragmentShader: stalkFragment,
      uniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const lines = new THREE.LineSegments(geo, mat);
    lines.frustumCulled = false;
    return { geo, mat, uniforms, lines };
  };

  const mainStalk = makeStalkMesh(mainStalkPos, mainStalkTop, mainStalkCol, 0.62);
  const bgStalk = makeStalkMesh(bgStalkPos, bgStalkTop, bgStalkCol, 0.22);
  group.add(mainStalk.lines);
  group.add(bgStalk.lines);

  // 7. 基准面落点标尺环
  const ringGeo = new THREE.RingGeometry(0.65, 0.95, 28);
  ringGeo.rotateX(-Math.PI / 2);
  const ringMats: { mat: THREE.MeshBasicMaterial; isMain: boolean }[] = [];
  ringPosList.forEach(([x, , z, color], i) => {
    const isMain = i < STAR_NODES.length;
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(ringGeo, mat);
    mesh.position.set(x, 0.06, z);
    if (!isMain) mesh.scale.setScalar(0.55);
    ringMats.push({ mat, isMain });
    group.add(mesh);
  });

  const polarDots = AZIMUTH_LABELS.map((item) => item.position);

  const setOpacity = (opacity: number, time: number, pixelRatio: number) => {
    const clamped = THREE.MathUtils.clamp(opacity, 0, 1);
    group.visible = clamped > 0.002;
    if (!group.visible) return;
    gridUniforms.uOpacity.value = clamped;
    gridUniforms.uTime.value = time;
    veilUniforms.uTime.value = time;
    veilUniforms.uOpacity.value = clamped;
    tendrilUniforms.uOpacity.value = clamped;
    tendrilUniforms.uTime.value = time;
    cloudUniforms.uOpacity.value = clamped;
    cloudUniforms.uTime.value = time;
    cloudUniforms.uPixelRatio.value = pixelRatio;
    mainStalk.uniforms.uOpacity.value = clamped;
    mainStalk.uniforms.uTime.value = time;
    bgStalk.uniforms.uOpacity.value = clamped;
    bgStalk.uniforms.uTime.value = time;
    instUniforms.uTime.value = time;
    instUniforms.uOpacity.value = clamped;
    for (const r of ringMats) r.mat.opacity = clamped * (r.isMain ? 0.58 : 0.24);
  };

  const dispose = () => {
    gridGeo.dispose();
    gridMat.dispose();
    veilGeo.dispose();
    veilMat.dispose();
    tendrilGeo.dispose();
    tendrilMat.dispose();
    instGeo.dispose();
    instMat.dispose();
    cloudGeo.dispose();
    pillarGeo.dispose();
    cloudMat.dispose();
    mainStalk.geo.dispose();
    mainStalk.mat.dispose();
    bgStalk.geo.dispose();
    bgStalk.mat.dispose();
    ringGeo.dispose();
    for (const r of ringMats) r.mat.dispose();
  };

  return { group, polarDots, miniPoints, setOpacity, dispose };
}

// 右上角独立斯隆长城深空视窗：在幽深黑底之上勾勒发光星云丝带、同心星盘与核心星系定位
export function renderMiniMap(
  canvas: HTMLCanvasElement,
  miniPoints: MiniPoint[],
  simTime: number,
  activeGalaxyId?: string | null,
) {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (w < 8 || h < 8) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const pw = Math.round(w * dpr);
  const ph = Math.round(h * dpr);
  if (canvas.width !== pw || canvas.height !== ph) {
    canvas.width = pw;
    canvas.height = ph;
  }

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  // 沉稳极慢旋转全景（避免头部朝向造成的晃动）
  const yaw = 0.24 + simTime * 0.024;
  const pitch = 0.28;
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const scale = Math.min(w * 0.0029, h * 0.0049);
  const cx = w * 0.5;
  const cyScreen = h * 0.62;

  const project = (x: number, y: number, z: number) => {
    const rx = x * cy - z * sy;
    const rz = x * sy + z * cy;
    const ry = y * cp - rz * sp;
    const tz = y * sp + rz * cp;
    const persp = 360 / Math.max(360 + tz, 120);
    return {
      x: cx + rx * scale * persp,
      y: cyScreen - ry * scale * persp,
    };
  };

  // 同心参考坐标环
  ctx.lineWidth = 1;
  for (const r of [42, 96, 150]) {
    ctx.strokeStyle = r === 150 ? 'rgba(130, 196, 255, 0.34)' : 'rgba(116, 178, 255, 0.18)';
    ctx.beginPath();
    for (let i = 0; i <= 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      const p = project(Math.cos(a) * r, 0, Math.sin(a) * r);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
  }

  // 斯隆长城星云柔光主带（柔和多层电离丝带缩影）
  const prevComp = ctx.globalCompositeOperation;
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i <= 14; i++) {
    const u = i / 14;
    const t = u * 2 - 1;
    const sx = t * 154 + Math.sin(t * 2.3) * 20;
    const sySloan = 62 + Math.sin(t * 2.1 + 0.4) * 22 + Math.cos(t * 4.0) * 9;
    const sz = -104 - Math.cos(t * 1.45) * 32 + Math.sin(t * 2.8) * 12;
    const p = project(sx, sySloan, sz);
    const rad = Math.max(6, Math.min(w, h) * 0.11);
    const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, rad);
    grad.addColorStop(0, i % 2 === 0 ? 'rgba(235, 118, 124, 0.13)' : 'rgba(110, 198, 255, 0.13)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(p.x, p.y, rad, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = prevComp;

  // 斯隆长城主拱脊细线
  ctx.strokeStyle = 'rgba(218, 236, 255, 0.2)';
  ctx.beginPath();
  for (let i = 0; i <= 24; i++) {
    const u = i / 24;
    const t = u * 2 - 1;
    const sx = t * 154 + Math.sin(t * 2.3) * 20;
    const sySloan = 62 + Math.sin(t * 2.1 + 0.4) * 22 + Math.cos(t * 4.0) * 9;
    const sz = -104 - Math.cos(t * 1.45) * 32 + Math.sin(t * 2.8) * 12;
    const p = project(sx, sySloan, sz);
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();

  // 星流细星点
  for (const pt of miniPoints) {
    const p = project(pt.x, pt.y, pt.z);
    ctx.fillStyle = pt.color;
    ctx.globalAlpha = 0.72;
    ctx.fillRect(p.x - 0.55, p.y - 0.55, 1.1, 1.1);
  }
  ctx.globalAlpha = 1;

  // 核心星系标点；身处某个黑洞星系核内时，用呼吸十字准星高亮该星系
  for (let i = 0; i < STAR_NODES.length; i++) {
    const node = STAR_NODES[i];
    const [nx, ny, nz] = node.position;
    const top = project(nx, ny, nz);
    const base = project(nx, 0, nz);
    const isActive = activeGalaxyId === node.id;

    if (Math.abs(ny) > 0.2) {
      ctx.strokeStyle = isActive ? node.color : 'rgba(210, 232, 255, 0.4)';
      ctx.beginPath();
      ctx.moveTo(base.x, base.y);
      ctx.lineTo(top.x, top.y);
      ctx.stroke();
    }

    const rDot = isActive ? 2.6 : 1.9;
    ctx.fillStyle = node.color;
    ctx.beginPath();
    ctx.arc(top.x, top.y, rDot, 0, Math.PI * 2);
    ctx.fill();

    if (isActive) {
      const pulseR = 5.5 + 2.0 * Math.sin(simTime * 3.4);
      ctx.strokeStyle = node.color;
      ctx.globalAlpha = 0.88;
      ctx.beginPath();
      ctx.arc(top.x, top.y, pulseR, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(top.x - pulseR - 3, top.y);
      ctx.lineTo(top.x - pulseR + 1, top.y);
      ctx.moveTo(top.x + pulseR - 1, top.y);
      ctx.lineTo(top.x + pulseR + 3, top.y);
      ctx.moveTo(top.x, top.y - pulseR - 3);
      ctx.lineTo(top.x, top.y - pulseR + 1);
      ctx.moveTo(top.x, top.y + pulseR - 1);
      ctx.lineTo(top.x, top.y + pulseR + 3);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }
}
