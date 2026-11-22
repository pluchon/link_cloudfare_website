import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { holeVertex, holeFragment, dustVertex, dustFragment } from './shaders';
import { buildStation } from './station';
import { buildProbe, orbitFrame, orbitPath, orbitPosition, type Orbit } from './orbits';
import { travel, type LoaderUI } from './loader';
import { buildRocks } from './rocks';
import { warpBeta, warpCenter, warpImage, warpMaterial, warpObject, warpScale, lensPoint } from './warp';
import { AZIMUTH_LABELS, DOOR_STAR_NODES, STAR_NODES, STUDY_NODE, buildStarMap, renderMiniMap, type StarNodeSpec } from './starmap';
import {
  createStudyRoomModule,
  STUDY_OVERVIEW_PRESET,
  STUDY_ROOM_POS,
  STUDY_SCOPE_LOCAL_POS,
  type StudyRoomModule,
} from '../room/scene';
import type { FocusTarget, HotspotMeta, HoverPayload, RoomBook, RoomPayload } from '../room/types';

// 屏幕上的一组标注：引线、端点圈、文字
interface Tag {
  line: SVGPolylineElement;
  dot: SVGCircleElement;
  label: HTMLElement;
}

export interface ProbeSpec {
  key: string;
  // 分类名，加载画面上用
  label: string;
  href: string;
  tag: Tag;
  // 停靠后展开的终端屏幕
  terminal: HTMLElement;
}

export interface StarMapUI {
  miniBtn: HTMLButtonElement;
  miniCanvas: HTMLCanvasElement;
  layer: HTMLElement;
  nodeTags: { id: string; tag: Tag }[];
  azimuthLabels: HTMLElement[];
  scaleRoot: HTMLElement;
  scaleTrack: HTMLElement;
  scaleThumb: HTMLElement;
  barCode: HTMLElement;
  barTitle: HTMLElement;
  barMeta: HTMLElement;
}

interface DoorOptions {
  canvas: HTMLCanvasElement;
  // 穿过黑洞之后去哪
  target: string;
  // 盖在画面上的那层：开场从黑里亮起、俯冲最后白光一闪
  veil: HTMLElement;
  // 标题文案：离开甲板就淡出，回到甲板再出现
  copy: HTMLElement;
  // 黑洞上的引线
  hole: Tag;
  // 空间站的标注，只在自由视角下显示
  base: Tag;
  // 五个分类各一个探测器，顺序和 PROBE_ORBITS 对应
  probes: ProbeSpec[];
  // 深空星图交互 UI（左上角入口、全屏星图标注、尺度尺、档案栏）
  starmap?: StarMapUI;
  // 穿过视界之后的加载画面
  loader: LoaderUI;
  // 开场加载进度汇报（floor 与 cap 均在 [0, 0.95] 区间，就绪后再走 done）
  onProgress?: (floor: number, cap: number) => void;
  // 着色器编译完、首轮完整画面合成提交后调用（开场加载画面据此走完 100% 并收起）
  onReady?: () => void;
  // 初始模式：默认从甲板起步；若 URL 含 #study 则直接进入 3D 书房
  initialMode?: 'deck' | 'study';
  // 同一 WebGL 场景内嵌的 3D 书房模块挂载配置
  room?: {
    payload: RoomPayload;
    container: HTMLElement;
    onFocusChange?: (target: FocusTarget, meta: HotspotMeta | null) => void;
    onHover?: (info: HoverPayload | null, clientX: number, clientY: number) => void;
    onBookOpening?: (book: RoomBook) => void;
    onBookOpened?: (book: RoomBook) => void;
    onBookClosed?: () => void;
    onRoomReady?: () => void;
    onModeChange?: (mode: Mode) => void;
    onScopePhase?: (phase: 'hidden' | 'aligning' | 'eyepiece') => void;
  };
  // 四周的读数和刻度带
  hud: {
    distance: HTMLElement;
    heading: HTMLElement;
    view: HTMLElement;
    headingTape: HTMLElement;
    pitchTape: HTMLElement;
    guide: HTMLElement;
  };
}

export interface DoorController {
  dispose(): void;
  travelTo(href: string, title: string): void;
  enterStudyDirect(): void;
  openStarMapFromStudy(): void;
  approachStudyBlackHole(): void;
  focusRoom(target: FocusTarget): void;
  closeRoomBook(): void;
  enterStudyScope(): void;
  exitStudyScope(): void;
}

type Mode =
  | 'deck'
  | 'leaving'
  | 'free'
  | 'returning'
  | 'docking'
  | 'docked'
  | 'undocking'
  | 'warping'
  | 'diving'
  | 'enteringMap'
  | 'starmap'
  | 'leavingMap'
  | 'flyingGalaxy'
  | 'galaxy'
  | 'flyingStudy'
  | 'study'
  | 'studyScope'
  | 'flyingStudyToBh'
  | 'leavingStudyToMap';

// 五条探测器轨道都在盘面里（共面），半长轴 13 到 37 Rs，都在吸积盘（外径 10）外面；
// 偏心率和近心点方向各不相同，俯视时是五个错开的椭圆
const PROBE_ORBITS: Orbit[] = [
  { a: 13, e: 0.12, inc: 0, node: 0, peri: 40, m0: 0.5 },
  { a: 18, e: 0.08, inc: 0, node: 0, peri: 120, m0: 2.0 },
  { a: 24, e: 0.16, inc: 0, node: 0, peri: 200, m0: 3.6 },
  { a: 30, e: 0.1, inc: 0, node: 0, peri: 300, m0: 5.0 },
  { a: 37, e: 0.18, inc: 0, node: 0, peri: 60, m0: 1.2 },
];

// 五个探测器的信标灯颜色：项目琥珀、工具青、探究紫、日常绿、小萌粉
const PROBE_BEACONS = [0xffc070, 0x8fd4ff, 0xc8a0ff, 0x9fe6b0, 0xffa6c9];

// 空间站：45 Rs 的圆轨道，和盘面只差 3°，所以甲板上看到的几乎是侧视的经典造型。
// 起点放在盘面上方最高处，开场是从盘面上方一点点俯看
const STATION_ORBIT: Orbit = { a: 45, e: 0, inc: -3, node: 0, peri: 0, m0: -Math.PI / 2 };

// 甲板局部坐标里的人眼：离扶栏 1.4，眼高 0.32，扶栏在视线下方约 6.5°。
// 黑洞在 45 Rs 外，阴影加下方光弧约占 5°，再近扶栏就太大、再远就挡住光弧
const EYE_LOCAL = new THREE.Vector3(0, 0.32, 0.95);

// 自由视角：绕人马座 A* 黑洞巡航，略压低仰角让空间站、五颗探测器与吸积盘更有史诗纵深
const FREE_DISTANCE = 68;
const FREE_PHI = 0.76;

const DISK_N = new THREE.Vector3(0, 1, 0);
const DISK_U = new THREE.Vector3(1, 0, 0);
const DISK_V = new THREE.Vector3(0, 0, -1);

const LEAVE_MS = 3800;
const RETURN_MS = 5200;
const DOCK_MS = 2400;
const UNDOCK_MS = 2600;
const MAP_ENTER_MS = 2400;
const MAP_LEAVE_MS = 2000;
const GALAXY_FLY_MS = 3800;
const STUDY_FLY_MS = 2350;
const STUDY_SCOPE_MS = 820;
const STUDY_FLY_BH_MS = 2200;
const STUDY_LEAVE_MAP_MS = 1600;
// 点屏幕后，屏幕收起要这么久，收完才开始俯冲
const FOLD_MS = 650;
const DIVE_MS = 4600;
// 要画次像的物体和灯光额外放在这一层
const IMAGE_LAYER = 1;

// 斯隆长城高空俯瞰默认机位与共用对数尺度参数（顶部 6 Rs -> 分界 35% -> 底部 1.4 GLY）
const BASE_MIN_DIST = 6;
const BASE_MAX_DIST = 240;
const SCALE_SPLIT = 0.35;
const MAP_OVERVIEW_POS = new THREE.Vector3(22, 114, 224);
const MAP_MIN_DIST = 42;
const MAP_MAX_DIST = 460;

const ORIGIN = new THREE.Vector3();
const smooth = (t: number) => t * t * (3 - 2 * t);
// 五次平滑阶跃：起步与刹停零加速度冲击，转场平移顺滑不晕
const smoother = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
// 慢加速巡航曲线（Beta(3,4) 精确积分）：极缓磁吸起步 -> 中段加速跃迁 -> 悠长失重悬停刹停
const asymmetricCruise = (t: number) => t * t * t * (20 - 45 * t + 36 * t * t - 10 * t * t * t);
const clamp01 = (t: number) => Math.min(Math.max(t, 0), 1);

const baseDistToU = (d: number) =>
  SCALE_SPLIT *
  clamp01((Math.log(Math.max(d, BASE_MIN_DIST)) - Math.log(BASE_MIN_DIST)) / (Math.log(BASE_MAX_DIST) - Math.log(BASE_MIN_DIST)));
const uToBaseDist = (u: number) =>
  Math.exp(THREE.MathUtils.lerp(Math.log(BASE_MIN_DIST), Math.log(BASE_MAX_DIST), clamp01(u / SCALE_SPLIT)));
const mapDistToU = (d: number) =>
  SCALE_SPLIT +
  (1 - SCALE_SPLIT) *
    clamp01((Math.log(Math.max(d, MAP_MIN_DIST)) - Math.log(MAP_MIN_DIST)) / (Math.log(MAP_MAX_DIST) - Math.log(MAP_MIN_DIST)));
const uToMapDist = (u: number) =>
  Math.exp(THREE.MathUtils.lerp(Math.log(MAP_MIN_DIST), Math.log(MAP_MAX_DIST), clamp01((u - SCALE_SPLIT) / (1 - SCALE_SPLIT))));

// 三次贝塞尔：飞行路线用，起点终点每帧可以重新算（空间站、探测器都在动）
function bezier(p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3, p3: THREE.Vector3, t: number, out: THREE.Vector3) {
  const u = 1 - t;
  return out
    .copy(p0)
    .multiplyScalar(u * u * u)
    .addScaledVector(p1, 3 * u * u * t)
    .addScaledVector(p2, 3 * u * t * t)
    .addScaledVector(p3, t * t * t);
}

export function supportsWebGL2(): boolean {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

export function mountDoor(options: DoorOptions): DoorController {
  const { canvas, target, veil, copy, hud } = options;

  // 手机和小屏：步数、星点层、粒子、速度线都往下压，横向光晕也不画
  const lite = matchMedia('(pointer: coarse)').matches || innerWidth < 768;
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // 黑洞是逐像素光线步进，开销跟像素数成正比。开场先用 0.75 倍，帧时间宽裕再慢慢往上加
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  const maxRatio = Math.min(devicePixelRatio, lite ? 0.95 : 1.35);
  let ratio = Math.min(maxRatio, lite ? 0.7 : 0.75);
  renderer.setPixelRatio(ratio);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.enabled = false;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.02, 1200);
  scene.add(camera);

  // ---- 黑洞与深空：全屏四边形，先画，后面的东西都盖在它上面 ----
  const diskN = DISK_N.clone();
  const diskU = DISK_U.clone();
  const diskV = DISK_V.clone();
  const holeCenter = new THREE.Vector3();
  let holeScale = 1;
  let holeAlpha = 1;
  let holeTheme = 0;
  let dustAlpha = 1;
  let mapOpacity = 0;
  let cosmosMix = 0;
  let nucleusGlow = 0;

  const holeUniforms = {
    uCamPos: { value: new THREE.Vector3() },
    uInvProj: { value: new THREE.Matrix4() },
    uCamWorld: { value: new THREE.Matrix4() },
    uTime: { value: 0 },
    uHover: { value: 0 },
    uDive: { value: 0 },
    uBeta: { value: 0 },
    uDiskN: { value: diskN },
    uDiskU: { value: diskU },
    uDiskV: { value: diskV },
    uHoleNdc: { value: new THREE.Vector2() },
    uStreak: { value: 0 },
    uAspect: { value: 1 },
    uProjZ: { value: new THREE.Vector2() },
    uHoleCenter: { value: holeCenter },
    uHoleScale: { value: 1 },
    uHoleAlpha: { value: 1 },
    uHoleTheme: { value: 0 },
    uCosmosMix: { value: 0 },
    uNucleusGlow: { value: 0 },
  };
  const mainDefines: Record<string, number | string> = { STEPS: lite ? 60 : 96 };
  if (lite) mainDefines.LITE = '';
  const mainHoleMat = new THREE.ShaderMaterial({
    vertexShader: holeVertex,
    fragmentShader: holeFragment,
    uniforms: holeUniforms,
    defines: mainDefines,
    // 深度由片元着色器按光线算出来写入，所以不做比较、只写
    depthFunc: THREE.AlwaysDepth,
  });
  const studyDefines: Record<string, number | string> = {
    STEPS: lite ? 36 : 48,
    NO_FRAG_DEPTH: '',
    STUDY_FAST: '',
  };
  if (lite) studyDefines.LITE = '';
  const studyHoleMat = new THREE.ShaderMaterial({
    vertexShader: holeVertex,
    fragmentShader: holeFragment,
    uniforms: holeUniforms,
    defines: studyDefines,
    // 书房室内模式：在实景网格之后以 LessEqualDepth 绘制全屏背景，GPU Early-Z 直接跳过被墙壁和家具遮挡的像素
    depthTest: true,
    depthWrite: false,
    depthFunc: THREE.LessEqualDepth,
  });
  const hole = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mainHoleMat);
  hole.frustumCulled = false;
  hole.renderOrder = -1;
  scene.add(hole);

  // ---- 空间站 ----
  const station = buildStation();
  scene.add(station);
  const stationFrame = orbitFrame(STATION_ORBIT);
  const stationUp = new THREE.Vector3(0, 1, 0).applyQuaternion(stationFrame);
  station.up.copy(stationUp);
  warpObject(station, true);
  const stationBeacon = station.userData.beacon as THREE.MeshBasicMaterial;
  const holo = station.userData.holo as THREE.Object3D;
  const deckLight = new THREE.PointLight(0xffd2a0, 0.6, 4, 2);
  deckLight.position.set(0, 0.25, 0);
  station.add(deckLight);
  deckLight.layers.enable(IMAGE_LAYER);

  // 光从黑洞吸积盘中心向四周辐射：无衰减中心点光源让任意公转方位的探测器和空间站都严格受吸积盘方向照明，
  // 极轴上方再补一盏微弱冷色喷流散射光勾出暗部金属轮廓
  const skyLight = new THREE.HemisphereLight(0x4e6088, 0x05070d, 0.38);
  skyLight.layers.enable(IMAGE_LAYER);
  scene.add(skyLight);
  const diskLight = new THREE.PointLight(0xffc894, 2.55, 0, 0);
  diskLight.position.set(0, 0, 0);
  diskLight.layers.enable(IMAGE_LAYER);
  scene.add(diskLight);
  const coronaLight = new THREE.PointLight(0x88b4ff, 0.52, 0, 0);
  coronaLight.position.set(0, 4.5, 0);
  coronaLight.layers.enable(IMAGE_LAYER);
  scene.add(coronaLight);

  // ---- 轨迹线：甲板上看很淡，离开甲板才清楚；空间站自己的虚线轨道只在自由视角显示 ----
  const trackMaterial = new THREE.LineBasicMaterial({ color: 0xe9e6f0, transparent: true, opacity: 0.06, depthWrite: false });
  warpMaterial(trackMaterial);
  for (const orbit of PROBE_ORBITS) scene.add(new THREE.LineLoop(orbitPath(orbit), trackMaterial));
  const stationTrackMaterial = new THREE.LineDashedMaterial({
    color: 0xe9e6f0,
    transparent: true,
    opacity: 0,
    dashSize: 1.2,
    gapSize: 1.2,
    depthWrite: false,
  });
  warpMaterial(stationTrackMaterial);
  const stationTrack = new THREE.LineLoop(orbitPath(STATION_ORBIT), stationTrackMaterial);
  stationTrack.computeLineDistances();
  scene.add(stationTrack);

  // ---- 探测器 ----
  const probes = options.probes.map((spec, i) => {
    const tint = new THREE.Color(PROBE_BEACONS[i]);
    const { group, beacon } = buildProbe(PROBE_BEACONS[i]);
    warpObject(group, false);
    scene.add(group);
    return { ...spec, orbit: PROBE_ORBITS[i], frame: orbitFrame(PROBE_ORBITS[i]), group, beacon, tint, phase: i * 1.3 };
  });
  type Probe = (typeof probes)[number];

  // ---- 粒子：数量收着，只在盘外圈淡淡地转，俯冲时才亮起来 ----
  const count = lite ? 1800 : 4000;
  const radius = new Float32Array(count);
  const angle = new Float32Array(count);
  const lift = new Float32Array(count);
  const seed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const thin = i % 6 !== 0;
    radius[i] = 3 + Math.pow(Math.random(), 1.3) * (thin ? 9 : 14);
    angle[i] = Math.random() * Math.PI * 2;
    lift[i] = (Math.random() - 0.5) * (thin ? radius[i] * 0.05 : radius[i] * 0.6);
    seed[i] = Math.random();
  }
  const dustGeometry = new THREE.BufferGeometry();
  // three.js 需要 position 才能算包围盒；真实位置在顶点着色器里算，这里给零
  dustGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  dustGeometry.setAttribute('aRadius', new THREE.BufferAttribute(radius, 1));
  dustGeometry.setAttribute('aAngle', new THREE.BufferAttribute(angle, 1));
  dustGeometry.setAttribute('aLift', new THREE.BufferAttribute(lift, 1));
  dustGeometry.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const dustUniforms = {
    uTime: { value: 0 },
    uDive: { value: 0 },
    uSize: { value: 22 },
    uPixelRatio: { value: ratio },
    uDiskN: { value: diskN },
    uDiskU: { value: diskU },
    uDiskV: { value: diskV },
    uWarpBeta: warpBeta,
    uWarpCenter: warpCenter,
    uWarpScale: warpScale,
    uDustAlpha: { value: 1 },
    uHoleTheme: { value: 0 },
  };
  const dust = new THREE.Points(
    dustGeometry,
    new THREE.ShaderMaterial({
      vertexShader: dustVertex,
      fragmentShader: dustFragment,
      uniforms: dustUniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  dust.frustumCulled = false;
  scene.add(dust);

  // ---- 深空星图与斯隆长城（门户含「书房」第 6 个枢纽节点） ----
  const starMap = buildStarMap(lite, true);
  scene.add(starMap.group);

  // ---- 速度线：挂在相机上，只在俯冲和跃迁时出现，从前方迎面掠过 ----
  const streakCount = lite ? 140 : 360;
  const streakSeed = new Float32Array(streakCount * 3);
  for (let i = 0; i < streakCount; i++) {
    const a = Math.random() * Math.PI * 2;
    // 内圈留空，速度线不压在正前方
    const r = 1.6 + Math.pow(Math.random(), 0.7) * 5;
    streakSeed[i * 3] = Math.cos(a) * r;
    streakSeed[i * 3 + 1] = Math.sin(a) * r;
    streakSeed[i * 3 + 2] = -Math.random() * 60;
  }
  const streakPositions = new Float32Array(streakCount * 6);
  const streakGeometry = new THREE.BufferGeometry();
  streakGeometry.setAttribute('position', new THREE.BufferAttribute(streakPositions, 3));
  const streakMaterial = new THREE.LineBasicMaterial({
    color: 0xc8dcff,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const streaks = new THREE.LineSegments(streakGeometry, streakMaterial);
  streaks.frustumCulled = false;
  camera.add(streaks);

  // 速度线：每条线在相机坐标里从远处迎面飞来，越快拉得越长
  function updateStreaks(beta: number, dt: number) {
    if (beta <= 0.001 && streakMaterial.opacity === 0) return;
    const speed = 20 + beta * 260;
    const len = 0.5 + beta * 9;
    for (let i = 0; i < streakCount; i++) {
      let z = streakSeed[i * 3 + 2] + speed * dt;
      if (z > -0.5) z -= 60;
      streakSeed[i * 3 + 2] = z;
      const x = streakSeed[i * 3];
      const y = streakSeed[i * 3 + 1];
      const base = i * 6;
      streakPositions[base] = x;
      streakPositions[base + 1] = y;
      streakPositions[base + 2] = z;
      streakPositions[base + 3] = x;
      streakPositions[base + 4] = y;
      streakPositions[base + 5] = z - len;
    }
    streakGeometry.attributes.position.needsUpdate = true;
    streakMaterial.opacity = Math.min(beta * 0.6, 0.45);
  }

  // ---- 视角：OrbitControls 负责拖动；甲板上是绕眼前一点转，相当于原地转头 ----
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.enableZoom = false;
  controls.rotateSpeed = 0.45;
  controls.minPolarAngle = 0.01;
  controls.maxPolarAngle = Math.PI - 0.01;

  let simTime = 0;
  const stationPos = new THREE.Vector3();
  const eye = new THREE.Vector3();
  const stationQuat = new THREE.Quaternion();
  const lastQuat = new THREE.Quaternion();
  const offsetTmp = new THREE.Vector3();
  const sideTmp = new THREE.Vector3();
  const crossTmp = new THREE.Vector3();
  const changeDirTmp = new THREE.Vector3();
  const ndcTmp = new THREE.Vector2();

  function placeStation() {
    orbitPosition(STATION_ORBIT, stationFrame, simTime, stationPos);
    station.position.copy(stationPos);
    station.lookAt(ORIGIN);
    station.updateMatrixWorld();
    eye.copy(EYE_LOCAL).applyMatrix4(station.matrixWorld);
  }
  function updateProbes() {
    for (const p of probes) {
      orbitPosition(p.orbit, p.frame, simTime, p.group.position);
      // 天线（局部 -z）始终对准空间站，像真的探测器对着地球通讯
      p.group.lookAt(offsetTmp.copy(p.group.position).multiplyScalar(2).sub(stationPos));
      p.beacon.color.copy(p.tint).multiplyScalar(0.4 + 0.6 * Math.max(0, Math.sin(simTime * 3 + p.phase)));
    }
  }
  placeStation();
  updateProbes();
  lastQuat.copy(station.quaternion);

  // ---- 外围的小行星带和两颗岩质行星：按开场时空间站的方向摆，从甲板一眼就能看见 ----
  const rocks = buildRocks(lite, stationPos.clone().normalize());
  scene.add(rocks.group);
  for (const root of [station, rocks.group, ...probes.map((p) => p.group)]) {
    root.traverse((object) => object.layers.enable(IMAGE_LAYER));
  }

  // 甲板上的默认朝向：正对黑洞
  const deckLook = (out = new THREE.Vector3()) => out.copy(eye).add(offsetTmp.copy(ORIGIN).sub(eye).setLength(0.05));
  camera.position.copy(eye);
  controls.target.copy(deckLook());
  controls.update();

  let mode: Mode = options.initialMode === 'study' ? 'study' : 'deck';
  let modeAt = performance.now();
  let leavePhi = Math.PI / 2;
  let docked: Probe | null = null;
  let activeGalaxy: StarNodeSpec | null = null;
  let selectedStar: StarNodeSpec | null = null;
  let mapFocus: { fromTarget: THREE.Vector3; toTarget: THREE.Vector3; fromPos: THREE.Vector3; toPos: THREE.Vector3; startAt: number } | null = null;
  const from = { pos: new THREE.Vector3(), target: new THREE.Vector3(), fov: 41, holeAlpha: 1, holeScale: 1, mapOpacity: 0, scaleU: baseDistToU(STATION_ORBIT.a) };
  let scaleU = baseDistToU(STATION_ORBIT.a);
  const offset = new THREE.Vector3();
  const spherical = new THREE.Spherical();
  const sm = options.starmap;
  const holeTextEl = options.hole.label.querySelector<HTMLElement>('[data-tag-text]') ?? options.hole.label;
  const baseHoleText = holeTextEl.textContent ?? '';
  const starNodeMap = new Map(DOOR_STAR_NODES.map((n) => [n.id, n]));
  const starPosVec = new Map(DOOR_STAR_NODES.map((n) => [n.id, new THREE.Vector3(...n.position)]));
  const studyPos = starPosVec.get('study')!.clone();
  const diskTiltQuat = new THREE.Quaternion();
  const diskTiltEuler = new THREE.Euler();

  // ---- 单一场景内嵌 3D 书房状态（共享同一个渲染器与紫粉黑洞，零双画布切换） ----
  const scopeWorldPos = STUDY_ROOM_POS.clone().add(STUDY_SCOPE_LOCAL_POS);
  const scopeLookDir = ORIGIN.clone().sub(scopeWorldPos).normalize();
  const scopeRightVec = new THREE.Vector3().crossVectors(scopeLookDir, new THREE.Vector3(0, 1, 0)).normalize();
  const scopeUpVec = new THREE.Vector3().crossVectors(scopeRightVec, scopeLookDir).normalize();
  const scopeAimTarget = new THREE.Vector3();
  const SCOPE_SC_RY = 0.587;
  const SCOPE_SC_EL = 0.046;
  const scopeBarrelDir = new THREE.Vector3(
    -Math.sin(SCOPE_SC_RY) * Math.cos(SCOPE_SC_EL),
    Math.sin(SCOPE_SC_EL),
    -Math.cos(SCOPE_SC_RY) * Math.cos(SCOPE_SC_EL),
  ).normalize();
  const scopePivotWorld = STUDY_ROOM_POS.clone().add(new THREE.Vector3(2.66, 1.07, 2.08));
  const scopeAlignWorld = scopePivotWorld
    .clone()
    .addScaledVector(scopeBarrelDir, -1.38)
    .add(new THREE.Vector3(0, 0.22, 0));
  const scopeAlignTarget = scopePivotWorld.clone().addScaledVector(scopeBarrelDir, 0.85);
  const scopeEyepieceWorld = scopePivotWorld
    .clone()
    .addScaledVector(scopeBarrelDir, -0.32)
    .add(new THREE.Vector3(0, 0.08, 0));
  const scopeForwardTmp = new THREE.Vector3();
  let scopeParallaxGoalX = 0;
  let scopeParallaxGoalY = 0;
  let scopeParallaxCurX = 0;
  let scopeParallaxCurY = 0;
  let scopeAlignMs = 680;
  const SCOPE_PUSH_MS = 920;
  let scopeAlignArc = 0;
  let scopeEnteredEyepiece = false;
  let scopePhase: 'hidden' | 'aligning' | 'eyepiece' = 'hidden';
  const setScopePhase = (next: 'hidden' | 'aligning' | 'eyepiece') => {
    if (scopePhase === next) return;
    scopePhase = next;
    options.room?.onScopePhase?.(next);
  };
  let studyFlyCrossed = false;
  const studyFlyStartPos = new THREE.Vector3();
  const studyFlyStartTarget = new THREE.Vector3();
  let studyFlyStartFov = 50;
  const studyFlyGoalPos = new THREE.Vector3();
  const studyFlyGoalTarget = new THREE.Vector3();
  let studyFlyGoalFov = 40;
  let studyBhFromScope = false;

  const studyRoom: StudyRoomModule | null = options.room
    ? createStudyRoomModule({
        renderer,
        scene,
        camera,
        controls,
        canvas,
        container: options.room.container,
        payload: options.room.payload,
        anchorPos: STUDY_ROOM_POS,
        holeCenter: ORIGIN,
        lite,
        reducedMotion: still,
        onFocusChange: options.room.onFocusChange,
        onHover: options.room.onHover,
        onBookOpening: options.room.onBookOpening,
        onBookOpened: options.room.onBookOpened,
        onBookClosed: options.room.onBookClosed,
        onEnterScope: () => enterStudyScope(),
        onApproachBlackHole: () => approachStudyBlackHole(),
        onReady: options.room.onRoomReady,
      })
    : null;

  function setDiskTilt(rx = 0, rz = 0) {
    diskTiltQuat.setFromEuler(diskTiltEuler.set(rx, 0, rz));
    diskN.copy(DISK_N).applyQuaternion(diskTiltQuat).normalize();
    diskU.copy(DISK_U).applyQuaternion(diskTiltQuat).normalize();
    diskV.copy(DISK_V).applyQuaternion(diskTiltQuat).normalize();
  }

  const galQuat = new THREE.Quaternion();
  const galEuler = new THREE.Euler();
  const galVec = new THREE.Vector3();

  function galaxyViewPos(node: StarNodeSpec, out = new THREE.Vector3()) {
    const sc = node.holeScale ?? 1.85;
    const [rx, rz] = node.diskTilt ?? [0, 0];
    galQuat.setFromEuler(galEuler.set(rx, 0, rz));
    // 卡冈图雅贴盘超近巨物构图：仅贴近外吸积盘上方 0.38 Rs，黑洞巨影与光弧扑面压满天幕
    const dist = (camera.aspect < 1 ? 6.8 : 4.55) * sc;
    galVec.set(0.42 * sc, 0.38 * sc, dist).applyQuaternion(galQuat);
    return out.set(...node.position).add(galVec);
  }

  function galaxyViewTarget(node: StarNodeSpec, out = new THREE.Vector3()) {
    const sc = node.holeScale ?? 1.85;
    const [rx, rz] = node.diskTilt ?? [0, 0];
    galQuat.setFromEuler(galEuler.set(rx, 0, rz));
    // 视线略右偏上仰，让庞大黑洞占满左侧主视野并向右上铺开吸积盘纵深
    const offsetX = (camera.aspect < 1 ? 0.52 : 1.28) * sc;
    galVec.set(offsetX, 0.24 * sc, 0).applyQuaternion(galQuat);
    return out.set(...node.position).add(galVec);
  }

  function baseFov() {
    // 竖屏放宽视野；基地取 41° 增强甲板与轨道透视宏阔感，斯隆长城俯瞰取 42°，星系黑洞近景取 58° 放大巨物压迫感
    if (camera.aspect < 1) {
      if (mode === 'galaxy' || mode === 'flyingGalaxy' || mode === 'flyingStudyToBh') return 64;
      if (mode === 'study') return 48;
      if (mode === 'studyScope') return 22;
      return 62;
    }
    if (mode === 'galaxy' || mode === 'flyingGalaxy') return 58;
    if (mode === 'flyingStudyToBh') return 54;
    if (mode === 'studyScope') return 17;
    if (mode === 'study') return STUDY_OVERVIEW_PRESET.fov;
    if (mode === 'starmap' || mode === 'enteringMap') return 42;
    return 41;
  }

  // 标注文字的宽度：只在启动和窗口变化时量。每帧读 offsetWidth 会逼浏览器每帧重排，开场那点卡顿有一部分就是它
  const labelWidth = new Map<HTMLElement, number>();
  const allTags = [
    options.hole,
    options.base,
    ...probes.map((p) => p.tag),
    ...(sm ? sm.nodeTags.map((n) => n.tag) : []),
  ];
  function measureLabels() {
    for (const tag of allTags) labelWidth.set(tag.label, tag.label.offsetWidth);
  }

  function resize() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    if (
      mode !== 'diving' &&
      mode !== 'warping' &&
      mode !== 'study' &&
      mode !== 'studyScope' &&
      mode !== 'flyingStudy' &&
      mode !== 'flyingStudyToBh'
    ) {
      camera.fov = baseFov();
    }
    camera.updateProjectionMatrix();
    holeUniforms.uAspect.value = camera.aspect;
    measureLabels();
  }
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();
  document.fonts?.ready.then(measureLabels);

  // OrbitControls 开着阻尼时，松手后还会按余量继续转。切换模式前把余量一次结清，
  // 不然飞回甲板后它接着转，视角就歪了
  function settleControls() {
    controls.enableDamping = false;
    controls.update();
    controls.enableDamping = true;
  }

  const viewNames: Record<Mode, string> = {
    deck: '视角 · 甲板',
    leaving: '离开甲板',
    free: '视角 · 自由',
    returning: '返回甲板',
    docking: '对接中',
    undocking: '断开对接',
    docked: '已对接',
    warping: '跃迁',
    diving: '穿越视界',
    enteringMap: '',
    starmap: '',
    leavingMap: '',
    flyingGalaxy: '星际跃迁',
    galaxy: '星系奇点',
    flyingStudy: '飞向基地书房',
    study: '基地书房',
    studyScope: '望远镜观测',
    flyingStudyToBh: '抵近书房黑洞',
    leavingStudyToMap: '',
  };

  function selectStarNode(node: StarNodeSpec | null) {
    selectedStar = node;
    if (!sm) return;
    if (mode === 'galaxy' && activeGalaxy) {
      sm.barCode.textContent = activeGalaxy.code;
      sm.barTitle.textContent = activeGalaxy.targetLabel ?? activeGalaxy.name;
      sm.barMeta.textContent = activeGalaxy.scaleLabel;
      return;
    }
    // 斯隆长城界面仅保留唯一主标题与非重复尺度副注，避免「斯隆长城」四字重复出现
    sm.barCode.textContent = 'DEEP SPACE · 1.37 GLY';
    sm.barTitle.textContent = '斯隆长城';
    sm.barMeta.textContent = 'Z = 0.073 · 大尺度纤维网';
  }

  function setMode(next: Mode) {
    mode = next;
    modeAt = performance.now();
    from.pos.copy(camera.position);
    from.target.copy(controls.target);
    from.fov = camera.fov;
    from.holeAlpha = holeAlpha;
    from.holeScale = holeScale;
    from.mapOpacity = mapOpacity;
    from.scaleU = scaleU;
    leavePhi = spherical.setFromVector3(offset.copy(camera.position).sub(controls.target)).phi;
    document.documentElement.dataset.doorMode = next;
    hud.view.textContent = viewNames[next];
    hud.guide.dataset.mode = next;
    if (sm) {
      sm.miniBtn.dataset.mode = next;
      sm.layer.dataset.mode = next;
      sm.scaleRoot.dataset.mode = next;
      if (next === 'starmap') {
        selectStarNode(selectedStar);
      } else if (next === 'galaxy' && activeGalaxy) {
        selectStarNode(activeGalaxy);
      }
    }
    options.room?.onModeChange?.(next);
  }

  // 甲板上一拖动，就开始慢慢退出空间站。只认拖动期间和松手后 0.4 秒：
  // 开着阻尼，快速一甩的转动大半发生在松手之后；但时间不能放太长，
  // 不然回到甲板时残留的 change 会把人又送出去
  const startDir = new THREE.Vector3();
  let armed = false;
  let disarm = 0;
  controls.addEventListener('start', () => {
    armed = true;
    mapFocus = null;
    scaleDampingActive = false;
    targetScaleU = null;
    dragScaleU = null;
    clearTimeout(disarm);
    camera.getWorldDirection(startDir);
  });
  controls.addEventListener('end', () => {
    disarm = window.setTimeout(() => (armed = false), 400);
  });
  controls.addEventListener('change', () => {
    if (mode !== 'deck' || !armed) return;
    camera.getWorldDirection(changeDirTmp);
    if (changeDirTmp.angleTo(startDir) > 0.06) setMode('leaving');
  });

  // 视线到当前激活黑洞中心的最近距离（直线近似）小于阴影半径，就算点中了黑洞
  const ray = new THREE.Raycaster();
  function overHole(x: number, y: number): boolean {
    if (holeAlpha < 0.5) return false;
    ray.setFromCamera(ndcTmp.set(x, y), camera);
    const o = offsetTmp.copy(ray.ray.origin).sub(holeCenter);
    const d = ray.ray.direction;
    if (o.dot(d) > 0) return false;
    return crossTmp.crossVectors(o, d).length() < 3.4 * holeScale;
  }

  // 屏幕上离指针最近、20px 以内的探测器
  function probeAt(clientX: number, clientY: number): Probe | null {
    if (mode !== 'deck' && mode !== 'free' && mode !== 'leaving') return null;
    const rect = canvas.getBoundingClientRect();
    let best: Probe | null = null;
    let bestD = 20;
    for (const p of probes) {
      if (!p.group.visible) continue;
      const v = lensPoint(p.group.position, camera.position, offsetTmp).project(camera);
      if (v.z > 1) continue;
      const sx = rect.left + (v.x * 0.5 + 0.5) * rect.width;
      const sy = rect.top + (-v.y * 0.5 + 0.5) * rect.height;
      const d = Math.hypot(sx - clientX, sy - clientY);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }

  // 深空星图模式：屏幕上离指针最近、28px 以内的星系/地标节点
  function starNodeAt(clientX: number, clientY: number): StarNodeSpec | null {
    if (mode !== 'starmap') return null;
    const rect = canvas.getBoundingClientRect();
    let best: StarNodeSpec | null = null;
    let bestD = 28;
    for (const node of DOOR_STAR_NODES) {
      const pos = starPosVec.get(node.id)!;
      const v = offsetTmp.copy(pos).project(camera);
      if (v.z > 1) continue;
      const sx = rect.left + (v.x * 0.5 + 0.5) * rect.width;
      const sy = rect.top + (-v.y * 0.5 + 0.5) * rect.height;
      const d = Math.hypot(sx - clientX, sy - clientY);
      if (d < bestD) {
        bestD = d;
        best = node;
      }
    }
    return best;
  }

  function toNdc(e: PointerEvent | MouseEvent) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * 2 - 1,
      y: -((e.clientY - rect.top) / rect.height) * 2 + 1,
    };
  }

  // 镜头被脚本接管、用户不能拖的模式
  function scripted() {
    return (
      mode !== 'deck' &&
      mode !== 'free' &&
      mode !== 'leaving' &&
      mode !== 'starmap' &&
      mode !== 'galaxy' &&
      mode !== 'study'
    );
  }

  // 俯冲进黑洞：基地黑洞去首页，探测器去对应分类，画廊/游戏星系中心黑洞去画廊或游戏大厅
  const diveTo = { href: target, title: '正在穿越视界 · 前往基地' };
  function startDive(href: string, title: string) {
    diveTo.href = href;
    diveTo.title = title;
    if (still) {
      travel(href, title, options.loader);
      return;
    }
    settleControls();
    controls.enabled = false;
    canvas.style.cursor = '';
    veil.style.transition = '';
    setMode('diving');
  }

  function dive() {
    if (mode === 'diving' || mode === 'warping') return;
    closeTerminal();
    if (mode === 'galaxy' && activeGalaxy?.href) {
      const diveTitle =
        activeGalaxy.id === 'base'
          ? '正在穿越视界 · 前往基地'
          : `正在穿越视界 · 前往「${activeGalaxy.targetLabel ?? activeGalaxy.name}」`;
      startDive(activeGalaxy.href, diveTitle);
      return;
    }
    if (
      mode === 'starmap' ||
      mode === 'enteringMap' ||
      mode === 'leavingMap' ||
      mode === 'flyingGalaxy' ||
      mode === 'flyingStudy' ||
      mode === 'study' ||
      mode === 'studyScope' ||
      mode === 'flyingStudyToBh' ||
      mode === 'leavingStudyToMap'
    )
      return;
    startDive(target, '正在穿越视界 · 前往基地');
  }

  // ---- 斯隆长城与星系黑洞切换 ----
  const enterMapGoal = MAP_OVERVIEW_POS.clone();
  const leaveMapTo = new THREE.Vector3();
  const galaxyGoalPos = new THREE.Vector3();
  const galaxyGoalTarget = new THREE.Vector3();
  const studyBhGoalPos = new THREE.Vector3();
  const studyBhGoalTarget = new THREE.Vector3();

  function openStarMap(goalPos = MAP_OVERVIEW_POS) {
    if (!sm || mode === 'starmap' || mode === 'enteringMap' || mode === 'diving' || mode === 'warping') return;
    closeTerminal();
    docked = null;
    activeGalaxy = null;
    mapFocus = null;
    enterMapGoal.copy(goalPos);
    if (goalPos === MAP_OVERVIEW_POS && camera.aspect < 1) {
      enterMapGoal.multiplyScalar(1.22);
    }
    settleControls();
    controls.enabled = false;
    canvas.style.cursor = '';
    if (still) {
      setMode('starmap');
      camera.position.copy(enterMapGoal);
      controls.target.copy(ORIGIN);
      camera.fov = baseFov();
      camera.updateProjectionMatrix();
      holeAlpha = 0;
      dustAlpha = 0;
      mapOpacity = 1;
      cosmosMix = 1;
      controls.enableZoom = true;
      controls.enablePan = true;
      controls.minDistance = MAP_MIN_DIST;
      controls.maxDistance = MAP_MAX_DIST;
      controls.enabled = true;
      controls.update();
      return;
    }
    setMode('enteringMap');
  }

  function closeStarMap(targetDist = FREE_DISTANCE) {
    if (mode !== 'starmap' && mode !== 'enteringMap') return;
    activeGalaxy = null;
    mapFocus = null;
    holeCenter.copy(ORIGIN);
    holeScale = 1;
    holeTheme = 0;
    setDiskTilt(0, 0);
    holeTextEl.textContent = baseHoleText;
    labelWidth.set(options.hole.label, options.hole.label.offsetWidth);
    const theta = Math.atan2(camera.position.x, camera.position.z);
    spherical.set(THREE.MathUtils.clamp(targetDist, BASE_MIN_DIST, BASE_MAX_DIST), FREE_PHI, theta);
    leaveMapTo.setFromSpherical(spherical);
    settleControls();
    controls.enabled = false;
    canvas.style.cursor = '';
    if (still) {
      camera.position.copy(leaveMapTo);
      controls.target.copy(ORIGIN);
      camera.fov = baseFov();
      camera.updateProjectionMatrix();
      holeAlpha = 1;
      dustAlpha = 1;
      mapOpacity = 0;
      cosmosMix = 0;
      controls.enableZoom = true;
      controls.enablePan = true;
      controls.minDistance = BASE_MIN_DIST;
      controls.maxDistance = BASE_MAX_DIST;
      controls.enabled = true;
      controls.update();
      setMode('free');
      return;
    }
    setMode('leavingMap');
  }

  function focusStarLandmark(node: StarNodeSpec) {
    selectStarNode(node);
    const targetPos = new THREE.Vector3(...node.position);
    const dir = offsetTmp.copy(camera.position).sub(controls.target);
    const dist = THREE.MathUtils.clamp(dir.length(), 85, 195);
    if (dir.lengthSq() < 1e-4) dir.set(0.2, 0.4, 1);
    dir.normalize();
    mapFocus = {
      fromTarget: controls.target.clone(),
      toTarget: targetPos,
      fromPos: camera.position.clone(),
      toPos: targetPos.clone().addScaledVector(dir, dist),
      startAt: performance.now(),
    };
  }

  function flyToGalaxy(node: StarNodeSpec) {
    if (!node.href) return;
    activeGalaxy = node;
    selectedStar = node;
    mapFocus = null;
    holeCenter.set(...node.position);
    holeScale = node.holeScale ?? 1.85;
    holeTheme = node.holeTheme ?? 0;
    const [rx, rz] = node.diskTilt ?? [0, 0];
    setDiskTilt(rx, rz);
    holeTextEl.textContent = `进入${node.targetLabel ?? node.name}`;
    labelWidth.set(options.hole.label, options.hole.label.offsetWidth);
    settleControls();
    controls.enabled = false;
    canvas.style.cursor = '';
    if (still) {
      galaxyViewPos(node, camera.position);
      galaxyViewTarget(node, controls.target);
      holeAlpha = 1;
      dustAlpha = 1;
      mapOpacity = 0;
      setMode('galaxy');
      camera.fov = baseFov();
      camera.updateProjectionMatrix();
      controls.enableZoom = true;
      controls.enablePan = false;
      controls.minDistance = 2.9 * holeScale;
      controls.maxDistance = 36 * holeScale;
      controls.enabled = true;
      controls.update();
      return;
    }
    setMode('flyingGalaxy');
  }

  function returnToStarMap() {
    if (mode !== 'galaxy' && mode !== 'flyingGalaxy') return;
    enterMapGoal.copy(MAP_OVERVIEW_POS);
    if (camera.aspect < 1) {
      enterMapGoal.multiplyScalar(1.22);
    }
    settleControls();
    controls.enabled = false;
    canvas.style.cursor = '';
    if (still) {
      activeGalaxy = null;
      holeCenter.copy(ORIGIN);
      holeScale = 1;
      holeAlpha = 0;
      dustAlpha = 0;
      nucleusGlow = 0;
      holeTheme = 0;
      setDiskTilt(0, 0);
      holeTextEl.textContent = baseHoleText;
      labelWidth.set(options.hole.label, options.hole.label.offsetWidth);
      mapOpacity = 1;
      cosmosMix = 1;
      camera.position.copy(enterMapGoal);
      controls.target.copy(ORIGIN);
      camera.fov = baseFov();
      camera.updateProjectionMatrix();
      controls.enableZoom = true;
      controls.enablePan = true;
      controls.minDistance = MAP_MIN_DIST;
      controls.maxDistance = MAP_MAX_DIST;
      controls.enabled = true;
      controls.update();
      setMode('starmap');
      return;
    }
    setMode('enteringMap');
  }

  function applyStudySpaceState() {
    activeGalaxy = {
      ...STUDY_NODE,
      href: '/',
      targetLabel: '书房奇点 · 紫粉黑洞',
      scaleLabel: '34 MPC · 事件视界前',
      holeTheme: 1,
      holeScale: 1.55,
      diskTilt: [0.22, -0.14],
    };
    selectedStar = STUDY_NODE;
    mapFocus = null;
    holeCenter.copy(ORIGIN);
    holeTheme = 1;
    holeScale = 1.55;
    setDiskTilt(0.22, -0.14);
    holeAlpha = 1;
    dustAlpha = 0;
    mapOpacity = 0;
    cosmosMix = 0;
    nucleusGlow = 0;
  }

  function configureStudyControls() {
    controls.enableZoom = true;
    controls.enablePan = false;
    controls.minDistance = 2.0;
    controls.maxDistance = 12.0;
    controls.minPolarAngle = 0.25;
    controls.maxPolarAngle = Math.PI * 0.62;
    controls.enabled = true;
  }

  function restoreOrbitLimits() {
    controls.minPolarAngle = 0;
    controls.maxPolarAngle = Math.PI;
  }

  function enterStudyRoomNow() {
    applyStudySpaceState();
    veil.style.transition = '';
    veil.style.opacity = '0';
    lastVeilOpacity = '0';
    if (studyRoom) {
      studyRoom.setVisible(true);
      studyRoom.resetStateForEntry();
      const ov = studyRoom.getWorldView(STUDY_OVERVIEW_PRESET, true);
      camera.position.copy(ov.pos);
      controls.target.copy(ov.target);
      camera.fov = ov.fov;
      camera.updateProjectionMatrix();
    }
    configureStudyControls();
    settleControls();
    setMode('study');
  }

  function flyToStudy() {
    activeGalaxy = null;
    selectedStar = STUDY_NODE;
    mapFocus = null;
    studyFlyCrossed = false;
    settleControls();
    controls.enabled = false;
    canvas.style.cursor = '';
    veil.style.transition = '';
    if (still) {
      enterStudyRoomNow();
      return;
    }
    setMode('flyingStudy');
  }

  function enterStudyScope() {
    if (disposed || mode !== 'study' || !studyRoom) return;
    studyRoom.cancelActiveFly();
    studyRoom.handlePointerLeave();
    restoreOrbitLimits();
    settleControls();
    controls.enabled = false;
    canvas.style.cursor = 'crosshair';
    scopeParallaxGoalX = 0;
    scopeParallaxGoalY = 0;
    scopeParallaxCurX = 0;
    scopeParallaxCurY = 0;

    const posDist = camera.position.distanceTo(scopeAlignWorld);
    camera.getWorldDirection(scopeForwardTmp);
    const angErr = scopeForwardTmp.angleTo(scopeBarrelDir);
    scopeAlignMs =
      posDist < 0.75 && angErr < 0.22
        ? 200
        : Math.min(980, Math.max(520, Math.round(posDist * 135 + angErr * 280)));
    scopeAlignArc = Math.min(0.85, posDist * 0.14);
    scopeEnteredEyepiece = false;

    const targetFov = camera.aspect < 1 ? 22 : 17;
    if (still) {
      studyRoom.setVisible(false);
      camera.position.copy(scopeWorldPos);
      controls.target.copy(ORIGIN);
      camera.fov = targetFov;
      camera.updateProjectionMatrix();
      dustAlpha = 0.85;
      veil.style.transition = '';
      veil.style.opacity = '0';
      lastVeilOpacity = '0';
      setScopePhase('eyepiece');
      setMode('studyScope');
      return;
    }
    setScopePhase('aligning');
    setMode('studyScope');
  }

  function exitStudyScope() {
    if (disposed || mode !== 'studyScope') return;
    const wasInEyepiece = scopeEnteredEyepiece;
    setScopePhase('hidden');
    scopeEnteredEyepiece = false;
    veil.style.transition = '';
    veil.style.opacity = '0';
    lastVeilOpacity = '0';
    studyRoom?.setVisible(true);
    dustAlpha = 0;
    if (wasInEyepiece) {
      camera.position.copy(scopeEyepieceWorld);
      controls.target.copy(scopeAlignTarget);
      camera.fov = camera.aspect < 1 ? 46 : 38;
      camera.updateProjectionMatrix();
    }
    canvas.style.cursor = '';
    configureStudyControls();
    setMode('study');
    studyRoom?.focus('overview');
  }

  function approachStudyBlackHole() {
    if (disposed || (mode !== 'study' && mode !== 'studyScope')) return;
    const fromScope = mode === 'studyScope';
    setScopePhase('hidden');
    scopeEnteredEyepiece = false;
    studyRoom?.cancelActiveFly();
    studyRoom?.handlePointerLeave();
    restoreOrbitLimits();
    try {
      if (location.hash === '#study') history.replaceState(null, '', location.pathname);
    } catch {
      /* ignore */
    }
    applyStudySpaceState();
    holeTextEl.textContent = '通过黑洞跃迁到基地';
    labelWidth.set(options.hole.label, options.hole.label.offsetWidth);

    const sc = 1.55;
    const dist = (camera.aspect < 1 ? 7.2 : 4.9) * sc;
    const radialDir = offsetTmp.copy(STUDY_ROOM_POS).normalize();
    studyBhGoalPos.copy(radialDir).multiplyScalar(dist);
    studyBhGoalPos.y += 0.34 * sc;
    studyBhGoalTarget.set(0, -0.05 * sc, 0);
    studyBhFromScope = fromScope;

    settleControls();
    controls.enabled = false;
    canvas.style.cursor = '';
    veil.style.transition = '';
    veil.style.opacity = '0';
    lastVeilOpacity = '0';

    if (still) {
      studyRoom?.setVisible(false);
      holeScale = sc;
      dustAlpha = 1;
      camera.position.copy(studyBhGoalPos);
      controls.target.copy(studyBhGoalTarget);
      camera.fov = camera.aspect < 1 ? 64 : 54;
      camera.updateProjectionMatrix();
      controls.enableZoom = true;
      controls.enablePan = false;
      controls.minDistance = 2.9 * sc;
      controls.maxDistance = 36 * sc;
      controls.enabled = true;
      settleControls();
      setMode('galaxy');
      measureLabels();
      return;
    }
    setMode('flyingStudyToBh');
  }

  function handleStarNodeClick(node: StarNodeSpec) {
    if (mode !== 'starmap') return;
    if (node.id === 'study') {
      flyToStudy();
    } else if (node.id === 'base') {
      closeStarMap();
    } else if (node.kind === 'hub') {
      flyToGalaxy(node);
    } else {
      focusStarLandmark(node);
    }
  }

  // ---- 探测器对接：切向掠近后与探测器伴飞同行，终端屏幕从旁边展开 ----
  // 停靠基准位：探测器外侧约 5.4、上方约 0.92、偏右约 1.55，使探测器处于左侧前景，右边留给终端面板
  const dockPos = new THREE.Vector3();
  const dockLook = new THREE.Vector3();
  let dockPhase = 0;
  let dockBlend = 0;
  let dockPointerX = 0;
  let dockPointerY = 0;
  let dockLookX = 0;
  let dockLookY = 0;
  function placeDock(p: Probe, followWeight = 0) {
    const pLen = p.group.position.length();
    const out = offsetTmp.copy(p.group.position).normalize();
    sideTmp.crossVectors(DISK_N, out).normalize();

    const narrow = camera.aspect < 1;
    const baseOut = narrow ? 5.8 : 5.4;
    const baseUp = narrow ? 1.15 : 0.92;
    const baseSide = narrow ? 0.25 : 1.55;

    // 缓慢柔和的零重力伴飞漂移 + 鼠标微视差，保持探测器稳居左侧且呈现真实空间跟随纵深
    const driftOut = (Math.sin(dockPhase * 0.43) * 0.36 + Math.cos(dockPhase * 0.19) * 0.16) * followWeight;
    const driftUp = (Math.sin(dockPhase * 0.61 + 1.1) * 0.24 - dockLookY * 0.32) * followWeight;
    const driftSide = (Math.cos(dockPhase * 0.37 + 0.5) * 0.52 + dockLookX * 0.58) * followWeight;

    dockPos
      .copy(p.group.position)
      .addScaledVector(out, baseOut + driftOut)
      .addScaledVector(DISK_N, baseUp + driftUp)
      .addScaledVector(sideTmp, baseSide + driftSide);

    // 各轨道半径（13~37 Rs）统一景深构图，避免外轨探测器偏出左边缘
    const lookIn = Math.min(pLen * 0.5, 10.5);
    dockLook
      .copy(p.group.position)
      .addScaledVector(out, -lookIn)
      .addScaledVector(DISK_N, (narrow ? -0.35 : 0.08) - dockLookY * 0.18 * followWeight)
      .addScaledVector(sideTmp, dockLookX * 0.22 * followWeight);
  }

  function dock(p: Probe) {
    if (scripted() && mode !== 'docked') return;
    if (still) {
      location.assign(p.href);
      return;
    }
    closeTerminal();
    docked = p;
    dockPhase = 0;
    dockBlend = 0;
    dockPointerX = 0;
    dockPointerY = 0;
    dockLookX = 0;
    dockLookY = 0;
    scaleDampingActive = false;
    targetScaleU = null;
    dragScaleU = null;
    settleControls();
    controls.enabled = false;
    canvas.style.cursor = '';
    setMode('docking');
  }

  function openTerminal(p: Probe) {
    p.terminal.hidden = false;
    // 等一帧让 hidden 生效，过渡才会从起始状态开始
    requestAnimationFrame(() => (p.terminal.dataset.state = 'open'));
  }

  function closeTerminal() {
    for (const p of probes) {
      if (p.terminal.hidden) continue;
      p.terminal.dataset.state = '';
      window.setTimeout(() => {
        if (!p.terminal.dataset.state) p.terminal.hidden = true;
      }, 450);
    }
  }

  // 点屏幕：先把屏幕收起来（有动画），收完再转向黑洞俯冲，穿过视界后加载这个分类
  function warp(p: Probe) {
    if (mode !== 'docked') return;
    dockPointerX = 0;
    dockPointerY = 0;
    closeTerminal();
    if (still) {
      travel(p.href, `正在前往「${p.label}」`, options.loader);
      return;
    }
    setMode('warping');
  }

  // 对接时在面板以外的地方拖动：收起屏幕，镜头沿曲线退回自由视角（保留当前方位，抬到默认俯瞰角度）
  const undockTo = new THREE.Vector3();
  function undock() {
    if (mode !== 'docked') return;
    closeTerminal();
    spherical.setFromVector3(camera.position);
    spherical.radius = FREE_DISTANCE;
    spherical.phi = FREE_PHI;
    undockTo.setFromSpherical(spherical);
    setMode('undocking');
  }

  function goBack() {
    if (mode === 'studyScope') {
      exitStudyScope();
      return;
    }
    if (mode === 'galaxy' || mode === 'flyingGalaxy') {
      returnToStarMap();
      return;
    }
    if (mode === 'starmap' || mode === 'enteringMap') {
      closeStarMap();
      return;
    }
    if (mode === 'free' || mode === 'leaving' || mode === 'docked' || mode === 'docking' || mode === 'undocking') {
      closeTerminal();
      settleControls();
      controls.enabled = false;
      setMode('returning');
    }
  }

  let hovering = false;
  let down: { x: number; y: number } | null = null;
  const onDown = (e: PointerEvent) => {
    if (mode === 'study') {
      studyRoom?.handlePointerDown(e);
      return;
    }
    if (mode === 'studyScope') return;
    down = { x: e.clientX, y: e.clientY };
  };
  const onLeave = () => {
    if (mode === 'study') {
      studyRoom?.handlePointerLeave();
      return;
    }
    hovering = false;
    dockPointerX = 0;
    dockPointerY = 0;
  };
  const onMove = (e: PointerEvent) => {
    if (mode === 'study') {
      studyRoom?.handlePointerMove(e);
      return;
    }
    if (mode === 'studyScope') {
      if (e.pointerType === 'mouse') {
        const n = toNdc(e);
        scopeParallaxGoalX = THREE.MathUtils.clamp(n.x, -1, 1);
        scopeParallaxGoalY = THREE.MathUtils.clamp(n.y, -1, 1);
      }
      return;
    }
    if (down && mode === 'docked' && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8) {
      undock();
      return;
    }
    if (!down && mode === 'docked' && e.pointerType === 'mouse') {
      const rect = canvas.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        dockPointerX = THREE.MathUtils.clamp(((e.clientX - rect.left) / rect.width) * 2 - 1, -1, 1);
        dockPointerY = THREE.MathUtils.clamp(((e.clientY - rect.top) / rect.height) * 2 - 1, -1, 1);
      }
      return;
    }
    if (e.pointerType !== 'mouse' || scripted()) {
      hovering = false;
      return;
    }
    if (mode === 'starmap') {
      hovering = false;
      const onStar = !!starNodeAt(e.clientX, e.clientY);
      canvas.style.cursor = onStar ? 'pointer' : down ? 'grabbing' : 'grab';
      return;
    }
    const n = toNdc(e);
    hovering = overHole(n.x, n.y);
    const onProbe = !!probeAt(e.clientX, e.clientY);
    canvas.style.cursor = hovering || onProbe ? 'pointer' : down ? 'grabbing' : 'grab';
  };
  const onUp = (e: PointerEvent) => {
    if (mode === 'study') {
      studyRoom?.handlePointerUp(e);
      return;
    }
    if (mode === 'studyScope') return;
    if (!down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    down = null;
    if (moved >= 6 || scripted()) return;
    if (mode === 'starmap') {
      const node = starNodeAt(e.clientX, e.clientY);
      if (node) handleStarNodeClick(node);
      return;
    }
    const p = probeAt(e.clientX, e.clientY);
    if (p) {
      dock(p);
      return;
    }
    const n = toNdc(e);
    if (overHole(n.x, n.y)) dive();
  };
  const onHoleLabel = (e: MouseEvent) => {
    e.preventDefault();
    dive();
  };
  const handlers = probes.map((p) => {
    const onLabel = (e: MouseEvent) => {
      e.preventDefault();
      dock(p);
    };
    const onScreen = (e: MouseEvent) => {
      e.preventDefault();
      warp(p);
    };
    p.tag.label.addEventListener('click', onLabel);
    p.terminal.addEventListener('click', onScreen);
    return { onLabel, onScreen };
  });

  // 统一对数尺度滑尺：顶部 6 Rs (基地黑洞) <-> 分界 35% <-> 底部 1.4 GLY (斯隆长城)
  // 长按拖动拥有 1.48x 轻微放大杠杆 + 流体阻尼惯性；普通滚轮缩放保持标准阻尼
  const DRAG_LEVER = 1.48;
  let draggingScale = false;
  let dragScaleU: number | null = null;
  let targetScaleU: number | null = null;
  let scaleDampingActive = false;
  let scaleAnchorU = 0;
  let scaleDownY = 0;
  let scaleMoved = false;
  let scaleDownAtStarMap = false;

  const pointerYToU = (clientY: number) => {
    const rect = sm!.scaleTrack.getBoundingClientRect();
    return clamp01((clientY - rect.top) / Math.max(rect.height, 1));
  };

  const applyLiveScale = (u: number) => {
    if (!sm) return;
    dragScaleU = u;
    scaleU = u;
    mapFocus = null;

    const holeFade = 1 - smooth(clamp01((u - 0.27) / 0.14));
    const mapFade = smooth(clamp01((u - 0.30) / 0.12));
    const cosFade = smooth(clamp01((u - 0.28) / 0.13));

    if (mode === 'deck' || mode === 'returning' || mode === 'leaving') {
      offset.copy(eye).normalize();
      controls.target.copy(ORIGIN);
    } else {
      offset.copy(camera.position).sub(controls.target);
      if (offset.lengthSq() < 1e-4) offset.copy(MAP_OVERVIEW_POS);
      offset.normalize();
    }

    if (u < SCALE_SPLIT) {
      const d = uToBaseDist(u);
      activeGalaxy = null;
      holeCenter.copy(ORIGIN);
      holeScale = 1;
      holeTheme = 0;
      setDiskTilt(0, 0);
      if (mode !== 'free') {
        controls.target.copy(ORIGIN);
        controls.enableZoom = true;
        controls.enablePan = true;
        controls.minDistance = BASE_MIN_DIST;
        controls.maxDistance = BASE_MAX_DIST;
        controls.enabled = true;
        setMode('free');
      }
      holeAlpha = holeFade;
      dustAlpha = holeAlpha;
      mapOpacity = mapFade;
      cosmosMix = cosFade;
      nucleusGlow = 0;
      camera.position.copy(controls.target).addScaledVector(offset, d);
      camera.fov = THREE.MathUtils.lerp(camera.aspect < 1 ? 62 : 41, camera.aspect < 1 ? 62 : 42, cosFade);
      camera.updateProjectionMatrix();
    } else {
      const d = uToMapDist(u);
      if (u < 0.46 && controls.target.lengthSq() > 0.05) {
        controls.target.lerp(ORIGIN, smooth(clamp01((0.46 - u) / 0.11)));
      }
      if (mode !== 'starmap') {
        if (offset.y < 0.26) {
          offset.y = 0.26;
          offset.normalize();
        }
        controls.target.copy(ORIGIN);
        controls.enableZoom = true;
        controls.enablePan = true;
        controls.minDistance = MAP_MIN_DIST;
        controls.maxDistance = MAP_MAX_DIST;
        controls.enabled = true;
        setMode('starmap');
      }
      holeAlpha = holeFade;
      dustAlpha = holeAlpha;
      mapOpacity = mapFade;
      cosmosMix = cosFade;
      nucleusGlow = 0;
      camera.position.copy(controls.target).addScaledVector(offset, d);
      camera.fov = camera.aspect < 1 ? 62 : 42;
      camera.updateProjectionMatrix();
    }
  };

  const scalable = () => mode === 'leaving' || mode === 'free' || mode === 'starmap';

  const onScaleDown = (e: PointerEvent) => {
    if (!sm || !scalable()) return;
    e.preventDefault();
    draggingScale = true;
    scaleDownY = e.clientY;
    scaleMoved = false;
    scaleDownAtStarMap = mode === 'starmap';
    sm.scaleRoot.setPointerCapture(e.pointerId);
    const clickU = pointerYToU(e.clientY);
    const sameRealm = (!scaleDownAtStarMap && clickU < SCALE_SPLIT) || (scaleDownAtStarMap && clickU >= SCALE_SPLIT);
    if (sameRealm) {
      targetScaleU = clickU;
      scaleAnchorU = clickU;
      scaleDampingActive = true;
    } else {
      targetScaleU = null;
      scaleDampingActive = false;
    }
  };

  const onScaleMove = (e: PointerEvent) => {
    if (!draggingScale || !scalable() || !sm) return;
    if (!scaleMoved && Math.abs(e.clientY - scaleDownY) > 5) {
      scaleMoved = true;
      if (targetScaleU === null) {
        scaleAnchorU = scaleU;
        scaleDownY = e.clientY;
        scaleDampingActive = true;
      }
    }
    if (scaleMoved) {
      const trackH = Math.max(sm.scaleTrack.getBoundingClientRect().height, 1);
      const deltaU = ((e.clientY - scaleDownY) / trackH) * DRAG_LEVER;
      targetScaleU = clamp01(scaleAnchorU + deltaU);
      scaleDampingActive = true;
    }
  };

  const onScaleUp = (e: PointerEvent) => {
    if (!draggingScale) return;
    const wasTapAcross = !scaleMoved && targetScaleU === null;
    draggingScale = false;
    try {
      sm?.scaleRoot.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    if (wasTapAcross && sm) {
      dragScaleU = null;
      scaleDampingActive = false;
      const u = pointerYToU(e.clientY);
      if (!scaleDownAtStarMap && u >= SCALE_SPLIT) {
        const goal = MAP_OVERVIEW_POS.clone().setLength(uToMapDist(u));
        openStarMap(goal);
      } else if (scaleDownAtStarMap && u < SCALE_SPLIT) {
        closeStarMap(uToBaseDist(u));
      }
    }
  };

  // 滚轮触及尺度边界时平滑双向跨越（基地最远 240 Rs 往外拉出斯隆长城；斯隆长城原点拉近至 42 Mpc 回归基地）
  const onWheel = (e: WheelEvent) => {
    if (mode === 'study') {
      studyRoom?.handleWheel();
      return;
    }
    if (mode === 'studyScope' || draggingScale || scripted()) return;
    if (mode === 'free' && e.deltaY > 0 && camera.position.distanceTo(controls.target) >= BASE_MAX_DIST - 8) {
      openStarMap();
    } else if (
      mode === 'starmap' &&
      e.deltaY < 0 &&
      controls.target.length() < 16 &&
      camera.position.distanceTo(controls.target) <= MAP_MIN_DIST + 4
    ) {
      closeStarMap();
    }
  };
  const onMiniClick = () => {
    if (mode === 'galaxy' || mode === 'flyingGalaxy') returnToStarMap();
    else openStarMap();
  };
  const starTagHandlers = (sm?.nodeTags ?? []).map((item) => {
    const fn = (e: MouseEvent) => {
      e.preventDefault();
      const node = starNodeMap.get(item.id);
      if (node) handleStarNodeClick(node);
    };
    item.tag.label.addEventListener('click', fn);
    return { el: item.tag.label, fn };
  });
  if (sm) {
    sm.miniBtn.addEventListener('click', onMiniClick);
    sm.scaleRoot.addEventListener('pointerdown', onScaleDown);
    sm.scaleRoot.addEventListener('pointermove', onScaleMove);
    sm.scaleRoot.addEventListener('pointerup', onScaleUp);
    sm.scaleRoot.addEventListener('pointercancel', onScaleUp);
  }

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (mode === 'study') return;
      goBack();
    } else if (e.key === 'Enter' && document.activeElement === canvas) {
      dive();
    }
  };
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointerleave', onLeave);
  canvas.addEventListener('wheel', onWheel, { passive: true });
  canvas.addEventListener('dblclick', goBack);
  options.hole.label.addEventListener('click', onHoleLabel);
  window.addEventListener('keydown', onKey);

  // ---- 屏幕标注 ----
  const projected = new THREE.Vector3();
  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  const rim = new THREE.Vector3();

  function show(tag: Tag, on: boolean) {
    const v = on ? '1' : '0';
    if (tag.label.style.opacity === v) return;
    tag.line.style.opacity = v;
    tag.dot.style.opacity = v;
    tag.label.style.opacity = v;
    tag.label.style.pointerEvents = on ? '' : 'none';
  }

  // 直接将世界坐标投影到屏幕（不经过引力透镜偏移，给星图和黑洞中心用）
  function projectWorld(p: THREE.Vector3) {
    projected.copy(p).project(camera);
    camera.getWorldDirection(forward);
    if (forward.dot(offset.copy(p).sub(camera.position)) <= 0) return null;
    if (Math.abs(projected.x) > 0.96 || Math.abs(projected.y) > 0.96) return null;
    return {
      x: (projected.x * 0.5 + 0.5) * canvas.clientWidth,
      y: (-projected.y * 0.5 + 0.5) * canvas.clientHeight,
    };
  }

  // 把一个世界坐标点投到屏幕上；在镜头后面或出了画面就返回 null
  function toScreen(point: THREE.Vector3) {
    // 标注要贴着画面上的像，不是物体的真实位置
    const p = lensPoint(point, camera.position, lensedTmp);
    return projectWorld(p);
  }

  // 引线：从端点斜着出去一段，再水平拉到文字下面。右边放不下翻到左边；
  // 两边都放不下（窄屏）就竖直往上引
  function drawTag(tag: Tag, ax: number, ay: number, rise: number) {
    const w = canvas.clientWidth;
    const labelW = labelWidth.get(tag.label) ?? 120;
    const run = labelW + 8;
    const margin = 16;
    let points: string;
    let lx: number;
    let ly: number;
    if (ax + rise + run < w - margin || ax - rise - run > margin) {
      const sx = ax + rise + run < w - margin ? 1 : -1;
      const bx = ax + sx * rise;
      const by = ay - rise;
      const ex = bx + sx * run;
      points = `${ax},${ay} ${bx},${by} ${ex},${by}`;
      lx = sx > 0 ? bx + 4 : ex + 4;
      ly = by - 26;
    } else {
      const by = ay - rise - 10;
      points = `${ax},${ay} ${ax},${by}`;
      lx = ax - labelW / 2;
      ly = by - 28;
    }
    lx = Math.min(Math.max(lx, margin), w - labelW - margin);
    tag.line.setAttribute('points', points);
    tag.dot.setAttribute('cx', String(ax));
    tag.dot.setAttribute('cy', String(ay));
    tag.label.style.transform = `translate(${lx}px, ${ly}px)`;
  }

  // 黑洞的引线从阴影右上方的边缘引出，返回黑洞是否在画面里
  function placeHoleTag(on: boolean): boolean {
    if (holeAlpha < 0.45) {
      show(options.hole, false);
      return false;
    }
    const s = projectWorld(holeCenter);
    holeUniforms.uHoleNdc.value.set(projected.x, projected.y);
    if (!s) {
      show(options.hole, false);
      return false;
    }
    if (on) {
      right.setFromMatrixColumn(camera.matrixWorld, 0);
      rim.copy(holeCenter).addScaledVector(right, 2.9 * holeScale).project(camera);
      const radiusPx = Math.abs((rim.x * 0.5 + 0.5) * canvas.clientWidth - s.x);
      if (mode === 'galaxy') {
        if (activeGalaxy?.id === 'base' || activeGalaxy?.id === 'study') {
          const dotX = THREE.MathUtils.clamp(s.x - radiusPx * 0.36, 64, canvas.clientWidth - 260);
          const dotY = THREE.MathUtils.clamp(s.y + radiusPx * 0.44, canvas.clientHeight * 0.46, canvas.clientHeight - 175);
          drawTag(options.hole, dotX, dotY, 22);
        } else {
          const dotX = THREE.MathUtils.clamp(s.x + radiusPx * 0.16, 56, canvas.clientWidth * 0.30);
          const dotY = THREE.MathUtils.clamp(s.y - radiusPx * 0.08, 200, canvas.clientHeight * 0.50);
          drawTag(options.hole, dotX, dotY, 24);
        }
      } else {
        drawTag(options.hole, s.x + radiusPx * 0.72, Math.max(s.y - radiusPx * 0.72, 110), 46);
      }
    }
    show(options.hole, on);
    return true;
  }

  // 物体是否几乎正对黑洞背后。透镜会把黑洞背后的东西弯到阴影外面，所以不用再藏；
  // 只有物体横跨在视线轴上时不行：它两边的顶点被甩到黑洞两侧，三角形会横穿阴影
  function behindHole(p: THREE.Vector3, radius = 1) {
    offset.copy(camera.position).normalize();
    const along = -p.dot(offset);
    if (along <= 0) return false;
    return Math.sqrt(Math.max(p.lengthSq() - along * along, 0)) < radius * 1.3;
  }

  function placeTag(tag: Tag, p: THREE.Vector3, on: boolean, occludedRadius = 0) {
    const s = on && (occludedRadius <= 0 || !behindHole(p, occludedRadius)) ? toScreen(p) : null;
    if (!s) {
      show(tag, false);
      return;
    }
    drawTag(tag, s.x, s.y, 18);
    show(tag, true);
  }

  // ---- 每帧 ----
  let startAt = performance.now();
  let last = startAt;
  let hover = 0;
  // 自适应分辨率：连续几十帧算平均帧时间，掉帧就降像素比，宽裕了再慢慢升回去
  let frames = 0;
  let spent = 0;
  let longFrame = false;
  let frameStart = 0;
  let ceiling = maxRatio;
  let raf = 0;
  const lookNow = new THREE.Vector3();
  const lookDir = new THREE.Vector3();
  const lensedTmp = new THREE.Vector3();
  let shakePhase = 0;
  const c1 = new THREE.Vector3();
  const c2 = new THREE.Vector3();
  const goalPos = new THREE.Vector3();
  const goalLook = new THREE.Vector3();

  // 广义相对论等效原理：自由落体穿过视界局部惯性系平顺滑行；
  // 仅在深入内光子球层（rush > 0.4）后保留极低频（~0.85 Hz）、微幅的参考系拖曳微倾，消除近距高频机械震动带来的眩晕
  function shakeCamera(rush: number, beta: number, dt: number) {
    const drag = smooth(clamp01((rush - 0.4) / 0.55));
    if (drag <= 0.001) return;
    const drift = drag * (0.45 + 0.55 * clamp01(beta / 0.82));
    shakePhase += dt * Math.PI * 2 * 0.85;
    camera.rotateX(Math.sin(shakePhase) * drift * 0.0012);
    camera.rotateY(Math.sin(shakePhase * 0.79 + 1.4) * drift * 0.0012);
    camera.rotateZ(Math.sin(shakePhase * 0.63 + 2.7) * drift * 0.002);
  }

  // 第二遍只画几何体，走透镜方程的另一个解（次像）。材质、矩阵、灯光都和第一遍共用，不用维护一份克隆。
  // 次像是翻转的，三角形绕向也反了，这一遍要反过来算正面，否则看到的是物体的背面。
  // 在黑洞前面的物体没有次像，直接跳过省绘制调用。手机上不画：次像很小，看不出来
  const gl = renderer.getContext();
  const probesShown = new Array<boolean>(probes.length);
  let lastDistText = '';
  let lastHeadText = '';
  let lastVeilOpacity = '0';
  let lastCopyOpacity = '';
  let miniAt = -1000;
  function isBehind(p: THREE.Vector3) {
    return p.dot(offset.copy(camera.position)) < 0;
  }
  function renderSecondaryImages(skip: boolean) {
    if (lite || skip) return;
    const stationShown = station.visible;
    station.visible = stationShown && isBehind(stationPos);
    for (let i = 0; i < probes.length; i++) {
      const p = probes[i];
      probesShown[i] = p.group.visible;
      p.group.visible = p.group.visible && isBehind(p.group.position);
    }
    camera.layers.set(IMAGE_LAYER);
    warpImage.value = 1;
    renderer.autoClear = false;
    renderer.state.setFlipSided(false);
    gl.frontFace(gl.CW);
    renderer.render(scene, camera);
    gl.frontFace(gl.CCW);
    renderer.autoClear = true;
    warpImage.value = 0;
    camera.layers.set(0);
    station.visible = stationShown;
    for (let i = 0; i < probes.length; i++) probes[i].group.visible = probesShown[i];
  }

  function frame() {
    if (disposed || navigating) {
      raf = 0;
      return;
    }
    raf = requestAnimationFrame(frame);
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.05);
    spent += now - last;
    frameStart = last;
    last = now;
    const t = now - modeAt;

    if (!still) {
      simTime += dt;
      holeUniforms.uTime.value += dt;
      dustUniforms.uTime.value += dt;
      holo.rotation.y += dt * 0.25;
      holo.rotation.x = Math.sin(simTime * 0.35) * 0.1;
    }
    // 桅杆顶上的航标灯：短促地闪一下，大部分时间是暗的
    const blink = 0.25 + 0.75 * Math.max(0, Math.sin(simTime * 2.2)) ** 8;
    stationBeacon.color.setRGB(blink, blink * 0.14, blink * 0.1);

    let beta = 0;
    let diveRush = 0;

    placeStation();
    if (mode !== 'starmap' && mode !== 'galaxy' && mode !== 'flyingGalaxy') updateProbes();
    stationQuat.copy(station.quaternion);

    if (mode === 'deck') {
      // 站在跟着空间站一起转的参考系里：视线方向跟着空间站的朝向转，人跟着甲板走
      offset.copy(controls.target).sub(camera.position);
      offset.applyQuaternion(lastQuat.invert()).applyQuaternion(stationQuat);
      camera.position.copy(eye);
      controls.target.copy(eye).add(offset);
      holeAlpha += (1 - holeAlpha) * Math.min(dt * 6, 1);
      dustAlpha = holeAlpha;
      mapOpacity += (0 - mapOpacity) * Math.min(dt * 6, 1);
      cosmosMix = mapOpacity;
    } else if (mode === 'free') {
      if (dragScaleU === null && !scaleDampingActive) {
        holeAlpha += (1 - holeAlpha) * Math.min(dt * 6, 1);
        dustAlpha = holeAlpha;
        mapOpacity += (0 - mapOpacity) * Math.min(dt * 6, 1);
        cosmosMix = mapOpacity;
      }
    } else if (mode === 'leaving') {
      // 减少动态效果时一步到位
      const k = still ? 1 : smooth(clamp01(t / LEAVE_MS));
      goalLook.lerpVectors(from.target, ORIGIN, k);
      offset.copy(camera.position).sub(controls.target);
      spherical.setFromVector3(offset);
      spherical.radius = THREE.MathUtils.lerp(0.05, FREE_DISTANCE, k);
      // 俯仰按时间插值、不按帧累加：页面在后台被降帧时也要走到俯瞰角度；水平方向留给拖动
      spherical.phi = THREE.MathUtils.lerp(leavePhi, FREE_PHI, k);
      controls.target.copy(goalLook);
      camera.position.copy(goalLook).add(offset.setFromSpherical(spherical));
      if (k >= 1) {
        controls.enableZoom = true;
        controls.enablePan = true;
        controls.minDistance = 6;
        controls.maxDistance = 240;
        setMode('free');
      }
    } else if (mode === 'returning') {
      // 整段飞回去都看得到：先抬升、绕到空间站后上方，再降落到甲板上。终点跟着空间站走，每帧重新算
      const k = still ? 1 : clamp01(t / RETURN_MS);
      const e = smooth(k);
      const back = offsetTmp.copy(eye).normalize();
      c1.copy(from.pos).addScaledVector(stationUp, from.pos.distanceTo(eye) * 0.25);
      c2.copy(eye).addScaledVector(back, 14).addScaledVector(stationUp, 7);
      bezier(from.pos, c1, c2, eye, e, camera.position);
      // 视线：前半程看着黑洞，最后一段转成甲板上的默认朝向。插值的是视线方向、不是注视点：
      // 注视点从远处收到眼前 0.05 的话，镜头离终点只差几厘米时方向会被这点残差带着甩一下，落地前视角就抽一下
      goalLook.lerpVectors(from.target, ORIGIN, smooth(clamp01(k / 0.5)));
      lookNow.copy(goalLook).sub(camera.position).normalize();
      lookDir.copy(ORIGIN).sub(eye).normalize();
      lookNow.lerp(lookDir, smooth(clamp01((k - 0.75) / 0.25))).normalize();
      controls.target.copy(camera.position).addScaledVector(lookNow, 0.05);
      if (k >= 1) {
        camera.position.copy(eye);
        controls.target.copy(deckLook());
        controls.enableZoom = false;
        controls.enablePan = false;
        // 自由视角把最近距离设成了 6，甲板上视线目标只在眼前 0.05：不还原的话第一次 update 会把镜头往后弹出 6，
        // 下一帧又被拉回眼睛的位置，落地那一下就是闪一下、卡一下
        controls.minDistance = 0;
        controls.maxDistance = Infinity;
        controls.enabled = true;
        setMode('deck');
      }
    } else if (mode === 'undocking') {
      const k = still ? 1 : clamp01(t / UNDOCK_MS);
      const e = smooth(k);
      // 先往外退一段，再升到俯瞰位置
      c1.copy(from.pos).addScaledVector(offsetTmp.copy(from.pos).normalize(), 10);
      c2.copy(undockTo).addScaledVector(DISK_N, 12);
      bezier(from.pos, c1, c2, undockTo, e, camera.position);
      controls.target.lerpVectors(from.target, ORIGIN, smooth(clamp01(k / 0.8)));
      if (k >= 1) {
        camera.position.copy(undockTo);
        controls.target.copy(ORIGIN);
        controls.enableZoom = true;
        controls.enablePan = true;
        controls.minDistance = 6;
        controls.maxDistance = 240;
        controls.enabled = true;
        controls.update();
        setMode('free');
      }
    } else if ((mode === 'docking' || mode === 'docked' || mode === 'warping') && docked) {
      if (mode === 'docking') {
        placeDock(docked, 0);
        const k = clamp01(t / DOCK_MS);
        const e = smoother(k);
        const out = offsetTmp.copy(docked.group.position).normalize();
        const tangent = sideTmp.crossVectors(DISK_N, out).normalize();
        c1.copy(from.pos).lerp(dockPos, 0.34).addScaledVector(DISK_N, Math.min(from.pos.distanceTo(dockPos) * 0.14, 7));
        c2.copy(dockPos).addScaledVector(out, 4.0).addScaledVector(DISK_N, 1.3).addScaledVector(tangent, -3.2);
        bezier(from.pos, c1, c2, dockPos, e, camera.position);
        controls.target.lerpVectors(from.target, dockLook, smoother(clamp01(k / 0.85)));
        if (k >= 1) {
          camera.position.copy(dockPos);
          controls.target.copy(dockLook);
          dockPhase = 0;
          dockBlend = 0;
          setMode('docked');
          openTerminal(docked);
        }
      } else {
        // 停靠后沿开普勒轨道伴飞跟随：柔缓引入微幅零重力相对漂移与悬停视差，跃迁收屏时平稳归正
        dockPhase += dt;
        dockBlend = Math.min(1, dockBlend + dt * 0.65);
        const pd = 1 - Math.exp(-5 * dt);
        dockLookX += (dockPointerX - dockLookX) * pd;
        dockLookY += (dockPointerY - dockLookY) * pd;
        placeDock(docked, smooth(dockBlend));
        camera.position.copy(dockPos);
        controls.target.copy(dockLook);
        if (mode === 'warping' && t >= FOLD_MS) startDive(docked.href, `正在穿越视界 · 前往「${docked.label}」`);
      }
    } else if (mode === 'enteringMap') {
      // 从基地或星系黑洞顺滑退回星际尺度：先退入核球星云，再掠出宿主星系、展开斯隆长城全景
      const k = clamp01(t / MAP_ENTER_MS);
      const e = smoother(k);
      camera.position.lerpVectors(from.pos, enterMapGoal, e);
      controls.target.lerpVectors(from.target, ORIGIN, smoother(clamp01(k / 0.88)));
      camera.fov = THREE.MathUtils.lerp(from.fov, camera.aspect < 1 ? 62 : 42, e);
      camera.updateProjectionMatrix();
      holeAlpha = from.holeAlpha * (1 - smooth(clamp01(k / 0.38)));
      holeScale = THREE.MathUtils.lerp(from.holeScale, from.holeScale * 0.28, clamp01(k / 0.42));
      dustAlpha = holeAlpha;
      const fromGalaxy = activeGalaxy !== null;
      nucleusGlow = fromGalaxy ? Math.pow(Math.sin(clamp01((k - 0.14) / 0.36) * Math.PI), 1.4) * 0.44 : 0;
      mapOpacity = THREE.MathUtils.lerp(from.mapOpacity, 1, smoother(clamp01((k - 0.24) / 0.76)));
      cosmosMix = THREE.MathUtils.lerp(from.mapOpacity, 1, smoother(clamp01((k - 0.12) / 0.72)));
      if (k >= 1) {
        activeGalaxy = null;
        holeCenter.copy(ORIGIN);
        holeScale = 1;
        holeAlpha = 0;
        dustAlpha = 0;
        nucleusGlow = 0;
        holeTheme = 0;
        setDiskTilt(0, 0);
        holeTextEl.textContent = baseHoleText;
        labelWidth.set(options.hole.label, options.hole.label.offsetWidth);
        mapOpacity = 1;
        cosmosMix = 1;
        camera.position.copy(enterMapGoal);
        controls.target.copy(ORIGIN);
        controls.enableZoom = true;
        controls.enablePan = true;
        controls.minDistance = MAP_MIN_DIST;
        controls.maxDistance = MAP_MAX_DIST;
        controls.enabled = true;
        controls.update();
        setMode('starmap');
      }
    } else if (mode === 'starmap') {
      if (dragScaleU === null && !scaleDampingActive) {
        holeAlpha += (0 - holeAlpha) * Math.min(dt * 6, 1);
        dustAlpha = holeAlpha;
        nucleusGlow = 0;
        mapOpacity += (1 - mapOpacity) * Math.min(dt * 6, 1);
        cosmosMix = mapOpacity;
      }
      if (mapFocus) {
        const fk = clamp01((now - mapFocus.startAt) / 850);
        const fe = smoother(fk);
        controls.target.lerpVectors(mapFocus.fromTarget, mapFocus.toTarget, fe);
        camera.position.lerpVectors(mapFocus.fromPos, mapFocus.toPos, fe);
        if (fk >= 1) mapFocus = null;
      }
    } else if (mode === 'leavingMap') {
      // 从斯隆长城顺滑推进回人马座 A* 自由视角
      const k = clamp01(t / MAP_LEAVE_MS);
      const e = smoother(k);
      camera.position.lerpVectors(from.pos, leaveMapTo, e);
      controls.target.lerpVectors(from.target, ORIGIN, e);
      camera.fov = THREE.MathUtils.lerp(from.fov, camera.aspect < 1 ? 62 : 41, e);
      camera.updateProjectionMatrix();
      mapOpacity = 1 - smoother(clamp01(k / 0.68));
      cosmosMix = mapOpacity;
      nucleusGlow = 0;
      holeAlpha = smooth(clamp01((k - 0.32) / 0.68));
      dustAlpha = holeAlpha;
      holeScale = 1;
      if (k >= 1) {
        mapOpacity = 0;
        cosmosMix = 0;
        nucleusGlow = 0;
        holeAlpha = 1;
        dustAlpha = 1;
        camera.position.copy(leaveMapTo);
        controls.target.copy(ORIGIN);
        controls.enableZoom = true;
        controls.enablePan = true;
        controls.minDistance = BASE_MIN_DIST;
        controls.maxDistance = BASE_MAX_DIST;
        controls.enabled = true;
        controls.update();
        setMode('free');
      }
    } else if (mode === 'flyingGalaxy' && activeGalaxy) {
      // 符合天体物理尺度的四阶段跨尺度航行：
      // 1) 星系际锁星慢加速接近宿主星系（此时看不见黑洞）
      // 2) 穿入星系旋臂，星云核球辉光迎面点亮
      // 3) 核球光晕退散，中心超大质量黑洞与吸积盘解析显现
      // 4) 引力势阱内平滑制动，悬停于贴盘面近景
      const k = clamp01(t / GALAXY_FLY_MS);
      const posEase = asymmetricCruise(k);
      const aimEase = smoother(clamp01(k / 0.45));
      const targetScale = activeGalaxy.holeScale ?? 1.85;
      const targetFov = camera.aspect < 1 ? 66 : 58;
      const warpPulse = Math.pow(Math.sin(Math.PI * k), 1.6) * 2.4;
      galaxyViewPos(activeGalaxy, galaxyGoalPos);
      galaxyViewTarget(activeGalaxy, galaxyGoalTarget);
      camera.position.lerpVectors(from.pos, galaxyGoalPos, posEase);
      controls.target.lerpVectors(from.target, galaxyGoalTarget, aimEase);
      camera.fov = THREE.MathUtils.lerp(from.fov, targetFov, smoother(k)) + warpPulse;
      camera.updateProjectionMatrix();

      mapOpacity = from.mapOpacity * (1 - smoother(clamp01((k - 0.16) / 0.42)));
      cosmosMix = 1 - smooth(clamp01((k - 0.22) / 0.42));
      nucleusGlow = Math.pow(Math.sin(clamp01((k - 0.24) / 0.44) * Math.PI), 1.4) * 0.56;
      holeAlpha = smooth(clamp01((k - 0.56) / 0.30));
      holeScale = THREE.MathUtils.lerp(targetScale * 0.34, targetScale, smoother(clamp01((k - 0.54) / 0.40)));
      dustAlpha = smooth(clamp01((k - 0.40) / 0.44));
      beta = 0.10 * Math.pow(Math.sin(clamp01((k - 0.22) / 0.50) * Math.PI), 1.5);

      if (k >= 1) {
        holeScale = targetScale;
        nucleusGlow = 0;
        cosmosMix = 0;
        beta = 0;
        camera.fov = targetFov;
        camera.updateProjectionMatrix();
        camera.position.copy(galaxyGoalPos);
        controls.target.copy(galaxyGoalTarget);
        mapOpacity = 0;
        holeAlpha = 1;
        dustAlpha = 1;
        controls.enableZoom = true;
        controls.enablePan = false;
        controls.minDistance = 2.9 * holeScale;
        controls.maxDistance = 36 * holeScale;
        controls.enabled = true;
        controls.update();
        setMode('galaxy');
      }
    } else if (mode === 'galaxy') {
      holeAlpha = 1;
      dustAlpha = 1;
      mapOpacity = 0;
      cosmosMix = 0;
      nucleusGlow = 0;
    } else if (mode === 'flyingStudy') {
      // 从斯隆长城顺滑俯冲进入「书房」扇区，中段跨尺度融接并推开真实紫粉黑洞窗外景的 3D 书房
      const k = clamp01(t / STUDY_FLY_MS);
      if (k < 0.5) {
        const k1 = clamp01(k / 0.5);
        const posEase = asymmetricCruise(k1);
        const aimPos = offsetTmp.copy(studyPos).add(sideTmp.set(1.8, 1.0, 2.6));
        camera.position.lerpVectors(from.pos, aimPos, posEase);
        controls.target.lerpVectors(from.target, studyPos, smoother(clamp01(k1 / 0.78)));
        const warpPulse = Math.pow(Math.sin(Math.PI * k1), 1.5) * 4.2;
        camera.fov = THREE.MathUtils.lerp(from.fov, 26, smoother(k1)) + warpPulse;
        camera.updateProjectionMatrix();
        mapOpacity = from.mapOpacity * (1 - smoother(clamp01(k1 / 0.92)));
        cosmosMix = 1 - smooth(clamp01((k1 - 0.16) / 0.84));
        nucleusGlow = Math.pow(Math.sin(clamp01((k1 - 0.08) / 0.88) * Math.PI), 1.4) * 0.56;
        beta = 0.16 * Math.pow(Math.sin(k1 * Math.PI), 1.4);
        veil.style.transition = '';
        veil.style.background = '#06040f';
        const studyVeil = String(smooth(clamp01((k - 0.32) / 0.18)) * 0.94);
        lastVeilOpacity = studyVeil;
        veil.style.opacity = studyVeil;
      } else {
        if (!studyFlyCrossed) {
          studyFlyCrossed = true;
          applyStudySpaceState();
          beta = 0;
          if (studyRoom) {
            studyRoom.setVisible(true);
            studyRoom.resetStateForEntry();
            const ov = studyRoom.getWorldView(STUDY_OVERVIEW_PRESET, true);
            studyFlyGoalPos.copy(ov.pos);
            studyFlyGoalTarget.copy(ov.target);
            studyFlyGoalFov = ov.fov;
            studyFlyStartPos.copy(ov.pos).add(sideTmp.set(3.4, 2.1, 4.2));
            studyFlyStartTarget.copy(ov.target);
            studyFlyStartFov = Math.min(62, ov.fov + 12);
          } else {
            studyFlyGoalPos.copy(STUDY_ROOM_POS).add(sideTmp.set(5.25, 3.15, 5.45));
            studyFlyGoalTarget.copy(STUDY_ROOM_POS).add(sideTmp.set(-0.4, 1.28, -0.35));
            studyFlyGoalFov = 40;
            studyFlyStartPos.copy(studyFlyGoalPos).add(sideTmp.set(3.4, 2.1, 4.2));
            studyFlyStartTarget.copy(studyFlyGoalTarget);
            studyFlyStartFov = 52;
          }
        }
        const k2 = smoother(clamp01((k - 0.5) / 0.5));
        camera.position.lerpVectors(studyFlyStartPos, studyFlyGoalPos, k2);
        controls.target.lerpVectors(studyFlyStartTarget, studyFlyGoalTarget, k2);
        camera.fov = THREE.MathUtils.lerp(studyFlyStartFov, studyFlyGoalFov, k2);
        camera.updateProjectionMatrix();
        studyRoom?.setTransform(THREE.MathUtils.lerp(0.92, 1, k2), THREE.MathUtils.lerp(-0.35, 0, k2), 0);
        veil.style.transition = '';
        veil.style.background = '#06040f';
        const fadeVeil = String((1 - smooth(clamp01((k - 0.5) / 0.24))) * 0.94);
        lastVeilOpacity = fadeVeil;
        veil.style.opacity = fadeVeil;
      }
      if (k >= 1) {
        beta = 0;
        veil.style.opacity = '0';
        lastVeilOpacity = '0';
        studyRoom?.setTransform(1, 0, 0);
        camera.position.copy(studyFlyGoalPos);
        controls.target.copy(studyFlyGoalTarget);
        camera.fov = studyFlyGoalFov;
        camera.updateProjectionMatrix();
        configureStudyControls();
        settleControls();
        setMode('study');
        return;
      }
    } else if (mode === 'studyScope') {
      // 两段式望远镜观测：1) 平滑转到望远镜目镜正后方 -> 2) 俯身贴近眼罩并透视锁定窗外黑洞
      const targetFov = camera.aspect < 1 ? 22 : 17;
      const alignFov = camera.aspect < 1 ? 44 : 36;
      const entryFov = camera.aspect < 1 ? 32 : 26;
      if (t < scopeAlignMs) {
        const k1 = clamp01(t / Math.max(scopeAlignMs, 1));
        const e1 = smoother(k1);
        camera.position.lerpVectors(from.pos, scopeAlignWorld, e1);
        camera.position.y += Math.sin(Math.PI * k1) * scopeAlignArc;
        controls.target.lerpVectors(from.target, scopeAlignTarget, e1);
        camera.fov = THREE.MathUtils.lerp(from.fov, alignFov, e1);
        camera.updateProjectionMatrix();
        dustAlpha = 0;
        veil.style.transition = '';
        veil.style.opacity = '0';
        lastVeilOpacity = '0';
      } else {
        const k2 = clamp01((t - scopeAlignMs) / SCOPE_PUSH_MS);
        veil.style.transition = '';
        veil.style.background = '#020308';
        if (k2 < 0.48) {
          const u = smoother(k2 / 0.48);
          camera.position.lerpVectors(scopeAlignWorld, scopeEyepieceWorld, u);
          controls.target.lerpVectors(scopeAlignTarget, ORIGIN, u);
          camera.fov = THREE.MathUtils.lerp(alignFov, entryFov, u);
          camera.updateProjectionMatrix();
          dustAlpha = 0;
          const vOp = String(smooth(clamp01((k2 - 0.16) / 0.3)) * 0.94);
          lastVeilOpacity = vOp;
          veil.style.opacity = vOp;
        } else {
          if (!scopeEnteredEyepiece) {
            scopeEnteredEyepiece = true;
            studyRoom?.setVisible(false);
            setScopePhase('eyepiece');
          }
          const u = smoother((k2 - 0.48) / 0.52);
          const pd = 1 - Math.exp(-8 * dt);
          scopeParallaxCurX += (scopeParallaxGoalX - scopeParallaxCurX) * pd;
          scopeParallaxCurY += (scopeParallaxGoalY - scopeParallaxCurY) * pd;
          scopeAimTarget
            .copy(ORIGIN)
            .addScaledVector(scopeRightVec, scopeParallaxCurX * 0.42)
            .addScaledVector(scopeUpVec, scopeParallaxCurY * 0.34);
          camera.position.copy(scopeWorldPos);
          controls.target.copy(scopeAimTarget);
          camera.fov = THREE.MathUtils.lerp(entryFov, targetFov, u);
          camera.updateProjectionMatrix();
          dustAlpha = THREE.MathUtils.lerp(0, 0.85, u);
          const vOp = String((1 - smooth(clamp01((k2 - 0.48) / 0.3))) * 0.94);
          lastVeilOpacity = vOp;
          veil.style.opacity = vOp;
        }
      }
    } else if (mode === 'flyingStudyToBh') {
      // 同场景直飞：从书房窗外平滑滑弧穿越深空，直抵该紫粉黑洞事件视界前方
      const sc = 1.55;
      const k = clamp01(t / STUDY_FLY_BH_MS);
      const e = asymmetricCruise(k);
      const goalFov = camera.aspect < 1 ? 64 : 54;
      camera.position.lerpVectors(from.pos, studyBhGoalPos, e);
      if (!studyBhFromScope) {
        camera.position.y += Math.sin(Math.PI * k) * 2.2;
      }
      controls.target.lerpVectors(from.target, studyBhGoalTarget, smoother(clamp01(k / 0.55)));
      camera.fov = THREE.MathUtils.lerp(from.fov, goalFov, smoother(k)) + Math.pow(Math.sin(Math.PI * k), 1.5) * 7.5;
      camera.updateProjectionMatrix();

      holeScale = sc;
      holeAlpha = 1;
      dustAlpha = THREE.MathUtils.lerp(studyBhFromScope ? 0.85 : 0, 1, smoother(k));
      mapOpacity = 0;
      cosmosMix = 0;
      nucleusGlow = 0;
      beta = 0.14 * Math.pow(Math.sin(Math.PI * k), 1.4);

      if (camera.position.distanceTo(ORIGIN) < 22 || (k > 0.38 && camera.position.distanceTo(STUDY_ROOM_POS) > 12)) {
        studyRoom?.setVisible(false);
      }

      if (k >= 1) {
        studyRoom?.setVisible(false);
        holeScale = sc;
        dustAlpha = 1;
        beta = 0;
        camera.position.copy(studyBhGoalPos);
        controls.target.copy(studyBhGoalTarget);
        camera.fov = goalFov;
        camera.updateProjectionMatrix();
        controls.enableZoom = true;
        controls.enablePan = false;
        controls.minDistance = 2.9 * sc;
        controls.maxDistance = 36 * sc;
        restoreOrbitLimits();
        controls.enabled = true;
        settleControls();
        setMode('galaxy');
        measureLabels();
      }
    } else if (mode === 'leavingStudyToMap') {
      // 从书房同场景平滑拉远回升，重展斯隆长城全览
      const k = clamp01(t / STUDY_LEAVE_MAP_MS);
      const e = smoother(k);
      camera.position.lerpVectors(from.pos, enterMapGoal, e);
      controls.target.lerpVectors(from.target, ORIGIN, smoother(clamp01(k / 0.72)));
      camera.fov = THREE.MathUtils.lerp(from.fov, camera.aspect < 1 ? 62 : 42, e);
      camera.updateProjectionMatrix();

      holeAlpha = 1 - smooth(clamp01(k / 0.36));
      dustAlpha = holeAlpha * 0.85;
      mapOpacity = smooth(clamp01((k - 0.16) / 0.84));
      cosmosMix = smooth(clamp01((k - 0.1) / 0.78));
      nucleusGlow = Math.pow(Math.sin(clamp01((k - 0.08) / 0.45) * Math.PI), 1.4) * 0.28;

      if (k > 0.34) {
        studyRoom?.setVisible(false);
      } else {
        const kFade = k / 0.34;
        studyRoom?.setTransform(THREE.MathUtils.lerp(1, 0.55, kFade), THREE.MathUtils.lerp(0, -0.6, kFade), 0);
      }

      if (k >= 1) {
        studyRoom?.setVisible(false);
        studyRoom?.setTransform(1, 0, 0);
        activeGalaxy = null;
        holeCenter.copy(ORIGIN);
        holeScale = 1;
        holeTheme = 0;
        setDiskTilt(0, 0);
        holeAlpha = 0;
        dustAlpha = 0;
        mapOpacity = 1;
        cosmosMix = 1;
        nucleusGlow = 0;
        veil.style.opacity = '0';
        lastVeilOpacity = '0';
        camera.position.copy(enterMapGoal);
        controls.target.copy(ORIGIN);
        controls.enableZoom = true;
        controls.enablePan = true;
        controls.minDistance = MAP_MIN_DIST;
        controls.maxDistance = MAP_MAX_DIST;
        restoreOrbitLimits();
        controls.enabled = true;
        controls.update();
        setMode('starmap');
        measureLabels();
      }
    } else if (mode === 'diving') {
      // 先平滑转正对准当前黑洞中心，再沿测地线加速冲进视界；后半段速度接近光速，星空往前方收拢成隧道
      const k = clamp01(t / DIVE_MS);
      const turn = smoother(clamp01(k / 0.36));
      const rush = clamp01((k - 0.15) / 0.8);
      diveRush = rush;
      const e = Math.pow(rush, 2.2);
      goalPos.copy(from.pos).sub(holeCenter).setLength(1.05 * holeScale).add(holeCenter);
      camera.position.lerpVectors(from.pos, goalPos, e);
      lookNow.lerpVectors(from.target, holeCenter, turn);
      controls.target.copy(lookNow);
      camera.fov = THREE.MathUtils.lerp(from.fov, 88, smooth(rush));
      camera.updateProjectionMatrix();
      // 速度在中段最快、接近视界时收下来：光行差会把正前方的东西压小，
      // 一直全速的话冲到最后黑洞只剩画面中间一个点，胀满全屏的那一下就没了
      beta = 0.82 * Math.pow(Math.sin(Math.PI * clamp01((rush - 0.08) / 0.86)), 1.3);
      holeUniforms.uDive.value = rush;
      dustUniforms.uDive.value = rush;
      mapOpacity = from.mapOpacity * (1 - smooth(clamp01(k / 0.35)));
      // 最后越过视界：一黑，接着是加载画面
      veil.style.background = '#000';
      const diveVeil = String(smooth(clamp01((k - 0.88) / 0.12)));
      lastVeilOpacity = diveVeil;
      veil.style.opacity = diveVeil;
      const r = Math.max(camera.position.distanceTo(holeCenter) / Math.max(holeScale, 1e-4), 1.0001);
      hud.distance.textContent = `距视界 ${(r - 1).toFixed(2)} Rs · 时间流速 ×${Math.sqrt(1 - 1 / r).toFixed(2)}`;
      if (k >= 1) {
        // 场景不用再画了，把显卡和主线程都让给加载
        cancelAnimationFrame(raf);
        travel(diveTo.href, diveTo.title, options.loader);
        return;
      }
    }

    // 滑尺长按拖动的流体阻尼惯性（持续平滑逼近 targetScaleU，松手后保留一小段丝滑尾迹）
    if (scaleDampingActive && targetScaleU !== null) {
      scaleU += (targetScaleU - scaleU) * Math.min(dt * 9.5, 1);
      applyLiveScale(scaleU);
      if (!draggingScale && Math.abs(targetScaleU - scaleU) < 0.0008) {
        scaleU = targetScaleU;
        applyLiveScale(scaleU);
        scaleDampingActive = false;
        targetScaleU = null;
        dragScaleU = null;
        if (mode === 'free' || mode === 'starmap') controls.update();
      }
    }

    // 基地局域物体：仅在基地近景或从基地退回星图、基地黑洞尚未消退时显示；
    // 在斯隆长城、其他星系或从其他星系返回斯隆长城全览的整段航行中全程隐藏
    const inCosmos =
      mode === 'starmap' ||
      mode === 'galaxy' ||
      mode === 'flyingGalaxy' ||
      mode === 'flyingStudy' ||
      mode === 'study' ||
      mode === 'studyScope' ||
      mode === 'flyingStudyToBh' ||
      mode === 'leavingStudyToMap' ||
      mapOpacity > 0.55 ||
      (mode === 'enteringMap' && (activeGalaxy !== null || holeAlpha < 0.25)) ||
      (mode === 'diving' && activeGalaxy !== null);

    if (!inCosmos) {
      station.visible = mode !== 'diving' || !behindHole(stationPos, 2.0);
      for (const p of probes) p.group.visible = true;
      rocks.group.visible = true;
      rocks.update(simTime, behindHole);
    } else {
      station.visible = false;
      for (const p of probes) p.group.visible = false;
      rocks.group.visible = false;
    }

    const studyVisible =
      Boolean(studyRoom?.group.visible) &&
      (mode === 'study' ||
        mode === 'studyScope' ||
        mode === 'flyingStudyToBh' ||
        mode === 'leavingStudyToMap' ||
        (mode === 'flyingStudy' && studyFlyCrossed));
    const studyEarlyZ =
      Boolean(studyRoom?.group.visible) && (mode === 'study' || (mode === 'studyScope' && !scopeEnteredEyepiece));
    const wantHoleMat = studyEarlyZ ? studyHoleMat : mainHoleMat;
    if (hole.material !== wantHoleMat) hole.material = wantHoleMat;
    hole.renderOrder = studyEarlyZ ? 1 : -1;

    if (studyVisible) {
      // 真空宇宙高对比光比：关闭全局大灯避免双重叠加与地毯炫紫反光，仅由 studyRoom 局域灯 + 柔化窗光照明
      skyLight.intensity = 0;
      diskLight.intensity = 0;
      coronaLight.intensity = 0;
      studyRoom?.tick(dt, now, simTime, mode === 'study');
    } else {
      skyLight.intensity = 0.38;
      diskLight.intensity = 2.55;
      diskLight.color.setHex(0xffc894);
      coronaLight.intensity = 0.52;
    }

    holeUniforms.uBeta.value = beta;
    warpBeta.value = beta;
    warpCenter.value.copy(holeCenter);
    warpScale.value = holeScale;
    holeUniforms.uHoleScale.value = holeScale;
    holeUniforms.uHoleAlpha.value = holeAlpha;
    holeUniforms.uHoleTheme.value = holeTheme;
    holeUniforms.uCosmosMix.value =
      mode === 'flyingGalaxy' ||
      mode === 'enteringMap' ||
      mode === 'flyingStudy' ||
      mode === 'leavingStudyToMap' ||
      dragScaleU !== null ||
      mapOpacity > 0.005
        ? cosmosMix
        : mapOpacity;
    holeUniforms.uNucleusGlow.value =
      mode === 'flyingGalaxy' || mode === 'enteringMap' || mode === 'flyingStudy' || mode === 'leavingStudyToMap'
        ? nucleusGlow
        : 0;
    dustUniforms.uDustAlpha.value = dustAlpha;
    dustUniforms.uHoleTheme.value = holeTheme;
    dustUniforms.uSize.value = holeScale > 1.25 ? 14 : 18;
    dust.visible = dustAlpha > 0.005;
    starMap.setOpacity(mapOpacity, simTime, ratio);
    updateStreaks(beta, dt);

    if (scripted() || scaleDampingActive || (mode === 'study' && studyRoom?.isCameraFlying())) {
      camera.lookAt(controls.target);
    } else {
      controls.update();
    }
    if (mode === 'diving') shakeCamera(diveRush, beta, dt);
    camera.updateMatrixWorld();
    lastQuat.copy(stationQuat);

    // 平时保持完全透明（开场由加载层直接渐隐揭开），转场与深空入场阶段由对应状态控制遮幕
    const ownsVeil = mode === 'diving' || mode === 'flyingStudy' || mode === 'studyScope';
    if (!ownsVeil && lastVeilOpacity !== '0') {
      lastVeilOpacity = '0';
      veil.style.opacity = '0';
    }

    // 标题只在甲板上显示，按时间算
    const onDeck =
      mode === 'deck'
        ? 1
        : mode === 'returning'
          ? clamp01((t - RETURN_MS * 0.75) / (RETURN_MS * 0.25))
          : mode === 'leaving'
            ? 1 - clamp01(t / 800)
            : 0;
    const co = String(onDeck);
    if (co !== lastCopyOpacity) {
      lastCopyOpacity = co;
      copy.style.opacity = co;
    }

    // 轨迹线：甲板上很淡，离开甲板就清楚一些；对接、星图或离开基地向深空退回时收起
    const away = mode === 'free' || mode === 'leaving' ? 1 : 0;
    const nearProbe = mode === 'docked' || mode === 'docking' || mode === 'warping';
    const baseFade = inCosmos || mode === 'diving' ? 0 : mode === 'enteringMap' ? holeAlpha : 1;
    const trackGoal = (away ? 0.18 : nearProbe ? 0.11 : 0.06) * baseFade;
    if (inCosmos && (activeGalaxy !== null || mode === 'starmap' || mode === 'galaxy' || mode === 'flyingGalaxy')) {
      trackMaterial.opacity = 0;
      stationTrackMaterial.opacity = 0;
    } else {
      const rate = Math.min(dt * (mode === 'enteringMap' ? 8 : 3), 1);
      trackMaterial.opacity += (trackGoal - trackMaterial.opacity) * rate;
      stationTrackMaterial.opacity += (away * 0.2 * baseFade - stationTrackMaterial.opacity) * rate;
    }

    hover += ((hovering && !scripted() ? 1 : 0) - hover) * Math.min(dt * 6, 1);
    holeUniforms.uHover.value = hover;
    holeUniforms.uCamPos.value.copy(camera.position);
    holeUniforms.uInvProj.value.copy(camera.projectionMatrixInverse);
    holeUniforms.uProjZ.value.set(camera.projectionMatrix.elements[10], camera.projectionMatrix.elements[14]);
    holeUniforms.uCamWorld.value.copy(camera.matrixWorld);

    // 标注：基地（甲板/自由）、星系核心巨型黑洞、深空星图各管各的标注
    const baseTagsOn = mode === 'deck' || mode === 'free' || mode === 'leaving';
    const galaxyTagsOn = mode === 'galaxy';
    const holeOn = placeHoleTag(baseTagsOn || galaxyTagsOn);
    // 横向光晕只属于侧视：越接近俯视越淡，正上方往下看时它就是一道莫名其妙的横线
    const edgeOn = 1 - Math.abs(offset.copy(camera.position).sub(holeCenter).normalize().dot(diskN));
    holeUniforms.uStreak.value = holeOn ? edgeOn * edgeOn : 0;
    for (const p of probes) placeTag(p.tag, p.group.position, baseTagsOn, 1.8);
    placeTag(options.base, stationPos, away === 1, 0);

    // 深空星图节点标注 + 极坐标方位刻度 + 右侧缩放尺游标
    if (sm) {
      const mapTagsOn = mode === 'starmap';
      for (const item of sm.nodeTags) {
        const pos = starPosVec.get(item.id)!;
        const s = mapTagsOn ? projectWorld(pos) : null;
        if (!s) {
          show(item.tag, false);
        } else {
          drawTag(item.tag, s.x, s.y, starNodeMap.get(item.id)?.kind === 'hub' ? 22 : 14);
          show(item.tag, true);
        }
      }
      for (let i = 0; i < sm.azimuthLabels.length; i++) {
        const el = sm.azimuthLabels[i];
        const s = mapTagsOn ? projectWorld(AZIMUTH_LABELS[i].position) : null;
        if (!s) {
          el.style.opacity = '0';
        } else {
          el.style.opacity = '0.58';
          el.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, -50%)`;
        }
      }
      if (dragScaleU !== null) {
        scaleU = dragScaleU;
      } else if (mode === 'starmap') {
        scaleU = mapDistToU(camera.position.distanceTo(controls.target));
      } else if (mode === 'enteringMap') {
        scaleU = THREE.MathUtils.lerp(from.scaleU, mapDistToU(enterMapGoal.length()), smoother(clamp01(t / MAP_ENTER_MS)));
      } else if (mode === 'leavingStudyToMap') {
        scaleU = THREE.MathUtils.lerp(0.35, mapDistToU(enterMapGoal.length()), smoother(clamp01(t / STUDY_LEAVE_MAP_MS)));
      } else if (mode === 'leavingMap') {
        scaleU = THREE.MathUtils.lerp(from.scaleU, baseDistToU(leaveMapTo.length()), smoother(clamp01(t / MAP_LEAVE_MS)));
      } else if (mode === 'deck' || mode === 'leaving' || mode === 'free' || mode === 'returning') {
        const d = mode === 'deck' ? camera.position.distanceTo(ORIGIN) : camera.position.distanceTo(controls.target);
        scaleU = baseDistToU(d);
      }
      sm.scaleThumb.style.top = `${(clamp01(scaleU) * 100).toFixed(2)}%`;
    }

    // 读数：离视界多远（或深空尺度）、朝哪个方向、俯仰多少
    camera.getWorldDirection(forward);
    const heading = (THREE.MathUtils.radToDeg(Math.atan2(forward.x, -forward.z)) + 360) % 360;
    const pitch = THREE.MathUtils.radToDeg(Math.asin(forward.y));
    if (mode !== 'diving') {
      let distText: string;
      if (mode === 'starmap' || mode === 'enteringMap' || mode === 'leavingMap' || mode === 'leavingStudyToMap') {
        const mpc = camera.position.distanceTo(controls.target);
        distText = `观测半径 ${mpc.toFixed(0)} Mpc`;
      } else if (mode === 'flyingStudyToBh') {
        const rs = Math.max(camera.position.distanceTo(holeCenter) / Math.max(holeScale, 1e-4) - 1, 0.1);
        distText = `距「书房奇点 · 紫粉黑洞」视界 ${rs.toFixed(1)} Rs`;
      } else if (mode === 'flyingGalaxy') {
        const k = clamp01(t / GALAXY_FLY_MS);
        const label = activeGalaxy?.targetLabel ?? '星系';
        if (k < 0.3) {
          const mpc = THREE.MathUtils.lerp(62, 3.2, clamp01(k / 0.3));
          distText = `飞向「${label}」 · ${mpc.toFixed(1)} Mpc`;
        } else if (k < 0.58) {
          const kly = THREE.MathUtils.lerp(95, 2.4, clamp01((k - 0.3) / 0.28));
          distText = `穿入星系旋臂 · ${kly.toFixed(1)} kly`;
        } else if (k < 0.82) {
          const pc = THREE.MathUtils.lerp(80, 0.8, clamp01((k - 0.58) / 0.24));
          distText = `逼近星系核球 · ${pc.toFixed(1)} pc`;
        } else {
          const rs = Math.max(camera.position.distanceTo(holeCenter) / Math.max(holeScale, 1e-4) - 1, 0.1);
          distText = `引力制动 · 视界 ${rs.toFixed(1)} Rs`;
        }
      } else if (mode === 'galaxy') {
        const rs = Math.max(camera.position.distanceTo(holeCenter) / Math.max(holeScale, 1e-4) - 1, 0.1);
        distText = `距「${activeGalaxy?.targetLabel ?? '星系'}」视界 ${rs.toFixed(1)} Rs`;
      } else {
        distText = `距视界 ${(camera.position.length() - 1).toFixed(1)} Rs`;
      }
      if (distText !== lastDistText) {
        lastDistText = distText;
        hud.distance.textContent = distText;
      }
    }
    const headText = `方位 ${heading.toFixed(0).padStart(3, '0')}° · 俯仰 ${pitch >= 0 ? '+' : ''}${pitch.toFixed(0)}°`;
    if (headText !== lastHeadText) {
      lastHeadText = headText;
      hud.heading.textContent = headText;
      hud.headingTape.style.backgroundPositionX = `${-Math.round(heading * 4)}px`;
      hud.pitchTape.style.backgroundPositionY = `${Math.round(pitch * 4)}px`;
    }

    // 右上角微缩斯隆长城全景图（桌面 50ms / 移动端 80ms 节流，基地和各星系核内均显示）
    if (
      sm &&
      (mode === 'deck' ||
        mode === 'leaving' ||
        mode === 'free' ||
        mode === 'returning' ||
        mode === 'galaxy' ||
        mode === 'flyingGalaxy' ||
        mode === 'flyingStudyToBh') &&
      now - miniAt >= (lite ? 80 : 50)
    ) {
      miniAt = now;
      const pinId =
        mode === 'galaxy' || mode === 'flyingGalaxy' || mode === 'flyingStudyToBh' ? activeGalaxy?.id ?? null : null;
      renderMiniMap(sm.miniCanvas, starMap.miniPoints, simTime, pinId, undefined, DOOR_STAR_NODES);
    }

    renderer.render(scene, camera);
    renderSecondaryImages(inCosmos);

    // 自适应分辨率。几个坑：
    // - 60Hz 屏幕上帧间隔最快就是 16.7ms，升档门槛不能低于它，否则永远升不上去，只降不升，越待越糊
    // - 切走标签页再回来，那一帧间隔是好几秒；这种窗口整段作废，不能拿来降档
    // - 在哪一档掉过帧就记住，之后最多升到它下面一点，免得在两档之间来回抖
    if (now - frameStart > 100) longFrame = true;
    if (++frames === 30) {
      const avg = spent / frames;
      const interacting = Boolean(down || draggingScale || studyRoom?.isInteracting());
      if (!longFrame && (!interacting || avg > 38)) {
        const minRatio = lite ? 0.5 : 0.6;
        let next = ratio;
        if (avg > 23) {
          ceiling = Math.max(minRatio, ratio - 0.06);
          next = ratio - 0.16;
        } else if (avg < 18.5) {
          next = Math.min(ratio + 0.08, ceiling);
        }
        const clamped = Math.min(Math.max(next, minRatio), maxRatio);
        if (Math.abs(clamped - ratio) > 0.01) {
          ratio = clamped;
          renderer.setPixelRatio(ratio);
          renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
          dustUniforms.uPixelRatio.value = ratio;
        }
      }
      frames = 0;
      spent = 0;
      longFrame = false;
    }
  }

  // 页面重新可见时清掉统计，隐藏期间那一大段间隔不算数
  const onVisible = () => {
    if (document.visibilityState !== 'visible') return;
    frames = 0;
    spent = 0;
    longFrame = false;
    last = performance.now();
    if (!disposed && !navigating && !raf) {
      raf = requestAnimationFrame(frame);
    }
  };
  document.addEventListener('visibilitychange', onVisible);

  // 开场：所有景物与星图已提前挂载，等待所有着色器异步编译与字体就绪，完成首轮完整渲染合成后再交棒收起加载画面
  veil.style.opacity = '0';
  const initialStudy = options.initialMode === 'study' && !!studyRoom;
  copy.style.opacity = initialStudy ? '0' : '1';
  lastCopyOpacity = initialStudy ? '0' : '1';
  if (initialStudy && studyRoom) {
    applyStudySpaceState();
    studyRoom.setVisible(true);
    studyRoom.resetStateForEntry();
    hole.material = studyHoleMat;
    hole.renderOrder = 1;
    const ov = studyRoom.getWorldView(STUDY_OVERVIEW_PRESET, true);
    camera.position.copy(ov.pos);
    controls.target.copy(ov.target);
    camera.fov = ov.fov;
    camera.updateProjectionMatrix();
    configureStudyControls();
    settleControls();
  }
  setMode(initialStudy ? 'study' : 'deck');
  let disposed = false;
  let navigating = false;
  let readyRaf1 = 0;
  let readyRaf2 = 0;
  const snapTags = (noTransition: boolean) => {
    const val = noTransition ? 'none' : '';
    for (const tag of allTags) {
      tag.line.style.transition = val;
      tag.dot.style.transition = val;
      tag.label.style.transition = val;
    }
  };
  const begin = () => {
    if (disposed) return;
    options.onProgress?.(0.88, 0.95);
    measureLabels();
    startAt = performance.now();
    last = startAt;
    modeAt = startAt;
    snapTags(true);
    frame();
    readyRaf1 = requestAnimationFrame(() => {
      if (disposed) return;
      snapTags(false);
      readyRaf2 = requestAnimationFrame(() => {
        if (disposed) return;
        options.onReady?.();
      });
    });
  };
  options.onProgress?.(0.68, 0.86);
  const fontsReady = document.fonts ? document.fonts.ready.catch(() => {}) : Promise.resolve();
  const precompileAll = async () => {
    const savedMat = hole.material;
    const savedOrder = hole.renderOrder;
    try {
      await renderer.compileAsync(scene, camera);
      const altMat = savedMat === studyHoleMat ? mainHoleMat : studyHoleMat;
      hole.material = altMat;
      hole.renderOrder = altMat === studyHoleMat ? 1 : -1;
      await renderer.compileAsync(scene, camera);
    } finally {
      hole.material = savedMat;
      hole.renderOrder = savedOrder;
    }
  };
  Promise.all([precompileAll(), fontsReady]).then(begin, begin);

  return {
    travelTo(href, title) {
      if (disposed || navigating) return;
      navigating = true;
      cancelAnimationFrame(raf);
      raf = 0;
      travel(href, title, options.loader);
    },
    enterStudyDirect() {
      if (disposed) return;
      enterStudyRoomNow();
    },
    openStarMapFromStudy() {
      if (disposed || !sm) return;
      if (mode !== 'study' && mode !== 'studyScope') return;
      setScopePhase('hidden');
      scopeEnteredEyepiece = false;
      studyRoom?.cancelActiveFly();
      studyRoom?.handlePointerLeave();
      restoreOrbitLimits();
      try {
        if (location.hash === '#study') history.replaceState(null, '', location.pathname);
      } catch {
        /* ignore */
      }
      activeGalaxy = null;
      selectedStar = STUDY_NODE;
      mapFocus = null;
      holeCenter.copy(ORIGIN);
      holeTextEl.textContent = baseHoleText;
      labelWidth.set(options.hole.label, options.hole.label.offsetWidth);
      veil.style.transition = '';
      veil.style.opacity = '0';
      lastVeilOpacity = '0';

      enterMapGoal.copy(MAP_OVERVIEW_POS);
      if (camera.aspect < 1) enterMapGoal.multiplyScalar(1.22);

      if (still) {
        studyRoom?.setVisible(false);
        holeAlpha = 0;
        dustAlpha = 0;
        nucleusGlow = 0;
        holeTheme = 0;
        holeScale = 1;
        setDiskTilt(0, 0);
        mapOpacity = 1;
        cosmosMix = 1;
        camera.position.copy(enterMapGoal);
        controls.target.copy(ORIGIN);
        camera.fov = camera.aspect < 1 ? 62 : 42;
        camera.updateProjectionMatrix();
        controls.enableZoom = true;
        controls.enablePan = true;
        controls.minDistance = MAP_MIN_DIST;
        controls.maxDistance = MAP_MAX_DIST;
        controls.enabled = true;
        settleControls();
        setMode('starmap');
        measureLabels();
      } else {
        controls.enabled = false;
        settleControls();
        setMode('leavingStudyToMap');
      }
    },
    approachStudyBlackHole() {
      approachStudyBlackHole();
    },
    focusRoom(targetFocus) {
      if (disposed || mode !== 'study') return;
      studyRoom?.focus(targetFocus);
    },
    closeRoomBook() {
      if (disposed) return;
      studyRoom?.closeBook();
    },
    enterStudyScope() {
      enterStudyScope();
    },
    exitStudyScope() {
      exitStudyScope();
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(readyRaf1);
      cancelAnimationFrame(readyRaf2);
      cancelAnimationFrame(raf);
      observer.disconnect();
      controls.dispose();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('dblclick', goBack);
      options.hole.label.removeEventListener('click', onHoleLabel);
      probes.forEach((p, i) => {
        p.tag.label.removeEventListener('click', handlers[i].onLabel);
        p.terminal.removeEventListener('click', handlers[i].onScreen);
      });
      if (sm) {
        sm.miniBtn.removeEventListener('click', onMiniClick);
        sm.scaleRoot.removeEventListener('pointerdown', onScaleDown);
        sm.scaleRoot.removeEventListener('pointermove', onScaleMove);
        sm.scaleRoot.removeEventListener('pointerup', onScaleUp);
        sm.scaleRoot.removeEventListener('pointercancel', onScaleUp);
        starTagHandlers.forEach((h) => h.el.removeEventListener('click', h.fn));
      }
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('visibilitychange', onVisible);
      mainHoleMat.dispose();
      studyHoleMat.dispose();
      hole.geometry.dispose();
      studyRoom?.dispose();
      starMap.dispose();
      rocks.dispose();
      renderer.dispose();
    },
  };
}
