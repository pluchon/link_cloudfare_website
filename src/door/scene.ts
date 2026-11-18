import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { holeVertex, holeFragment, dustVertex, dustFragment } from './shaders';
import { buildStation } from './station';
import { buildProbe, orbitFrame, orbitPath, orbitPosition, type Orbit } from './orbits';
import { travel, type LoaderUI } from './loader';
import { buildRocks } from './rocks';
import { buildRealmProps } from './realms';
import { lensPoint, warpBeta, warpCenter, warpImage, warpMaterial, warpObject, warpScale } from './warp';
import { AZIMUTH_LABELS, STAR_NODES, buildStarMap, renderMiniMap, type StarNodeSpec } from './starmap';

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
  // 着色器编译完、第一帧画出来时调用（开场加载画面据此收起）
  onReady?: () => void;
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
  | 'galaxy';

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

// 自由视角：绕人马座 A* 黑洞巡航，略压低仰角让空间站、五颗探测器、中继浮标阵与吸积盘更有史诗纵深
const FREE_DISTANCE = 68;
const FREE_PHI = 0.76;

const DISK_N = new THREE.Vector3(0, 1, 0);
const DISK_U = new THREE.Vector3(1, 0, 0);
const DISK_V = new THREE.Vector3(0, 0, -1);

const LEAVE_MS = 3800;
const RETURN_MS = 5200;
const DOCK_MS = 3200;
const UNDOCK_MS = 2600;
const MAP_ENTER_MS = 2400;
const MAP_LEAVE_MS = 2000;
const GALAXY_FLY_MS = 3800;
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

export function mountDoor(options: DoorOptions): () => void {
  const { canvas, target, veil, copy, hud } = options;

  // 手机和小屏：步数、星点层、粒子、速度线都往下压，横向光晕也不画
  const lite = matchMedia('(pointer: coarse)').matches || innerWidth < 768;
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // 黑洞是逐像素光线步进，开销跟像素数成正比。开场先用 0.75 倍，帧时间宽裕再慢慢往上加
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  const maxRatio = Math.min(devicePixelRatio, lite ? 1 : 1.5);
  let ratio = Math.min(maxRatio, 0.75);
  renderer.setPixelRatio(ratio);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

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
  const defines: Record<string, number | string> = { STEPS: lite ? 84 : 136 };
  if (lite) defines.LITE = '';
  const hole = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({
      vertexShader: holeVertex,
      fragmentShader: holeFragment,
      uniforms: holeUniforms,
      defines,
      // 深度由片元着色器按光线算出来写入，所以不做比较、只写
      depthFunc: THREE.AlwaysDepth,
    }),
  );
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

  // ---- 深空星图与斯隆长城（开场渲染就绪后再挂入场景后台预编译，避免阻塞首屏加载） ----
  const starMap = buildStarMap(lite);

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

  function placeStation() {
    orbitPosition(STATION_ORBIT, stationFrame, simTime, stationPos);
    station.position.copy(stationPos);
    station.lookAt(ORIGIN);
    station.updateMatrixWorld();
    eye.copy(EYE_LOCAL).applyMatrix4(station.matrixWorld);
  }
  placeStation();
  lastQuat.copy(station.quaternion);

  // ---- 外围的小行星带和两颗岩质行星：按开场时空间站的方向摆，从甲板一眼就能看见 ----
  const rocks = buildRocks(lite, stationPos.clone().normalize());
  scene.add(rocks.group);
  // ---- 画廊/游戏星系与基地外围轻量化三维景物（首屏就绪后再后台预热，零首屏卡顿） ----
  const realmProps = buildRealmProps(lite);
  let extrasReadyAt = 0;
  const attachExtras = () => {
    if (!starMap.group.parent) scene.add(starMap.group);
    if (!realmProps.group.parent) {
      scene.add(realmProps.group);
      extrasReadyAt = performance.now();
    }
  };
  for (const root of [station, rocks.group, ...probes.map((p) => p.group)]) {
    root.traverse((object) => object.layers.enable(IMAGE_LAYER));
  }

  // 甲板上的默认朝向：正对黑洞
  const offsetTmp = new THREE.Vector3();
  const sideTmp = new THREE.Vector3();
  const crossTmp = new THREE.Vector3();
  const changeDirTmp = new THREE.Vector3();
  const ndcTmp = new THREE.Vector2();
  const deckLook = (out = new THREE.Vector3()) => out.copy(eye).add(offsetTmp.copy(ORIGIN).sub(eye).setLength(0.05));
  camera.position.copy(eye);
  controls.target.copy(deckLook());
  controls.update();

  let mode: Mode = 'deck';
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
  const starNodeMap = new Map(STAR_NODES.map((n) => [n.id, n]));
  const starPosVec = new Map(STAR_NODES.map((n) => [n.id, new THREE.Vector3(...n.position)]));
  const diskTiltQuat = new THREE.Quaternion();
  const diskTiltEuler = new THREE.Euler();

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
    if (camera.aspect < 1) return mode === 'galaxy' || mode === 'flyingGalaxy' ? 66 : 62;
    if (mode === 'galaxy' || mode === 'flyingGalaxy') return 58;
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
    if (mode !== 'diving' && mode !== 'warping') camera.fov = baseFov();
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
    for (const node of STAR_NODES) {
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
    return mode !== 'deck' && mode !== 'free' && mode !== 'leaving' && mode !== 'starmap' && mode !== 'galaxy';
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
    setMode('diving');
  }

  function dive() {
    if (mode === 'diving' || mode === 'warping') return;
    closeTerminal();
    if (mode === 'galaxy' && activeGalaxy?.href) {
      startDive(activeGalaxy.href, `正在穿越视界 · 前往「${activeGalaxy.targetLabel ?? activeGalaxy.name}」`);
      return;
    }
    if (mode === 'starmap' || mode === 'enteringMap' || mode === 'leavingMap' || mode === 'flyingGalaxy') return;
    startDive(target, '正在穿越视界 · 前往基地');
  }

  // ---- 斯隆长城与星系黑洞切换 ----
  const enterMapGoal = MAP_OVERVIEW_POS.clone();
  const leaveMapTo = new THREE.Vector3();
  const galaxyGoalPos = new THREE.Vector3();
  const galaxyGoalTarget = new THREE.Vector3();

  function openStarMap(goalPos = MAP_OVERVIEW_POS) {
    if (!sm || mode === 'starmap' || mode === 'enteringMap' || mode === 'diving' || mode === 'warping') return;
    attachExtras();
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
    attachExtras();
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

  function handleStarNodeClick(node: StarNodeSpec) {
    if (mode !== 'starmap') return;
    if (node.id === 'base') {
      closeStarMap();
    } else if (node.kind === 'hub') {
      flyToGalaxy(node);
    } else {
      focusStarLandmark(node);
    }
  }

  // ---- 探测器对接：飞到探测器侧后方停住，终端屏幕从旁边展开 ----
  // 停靠点：探测器外侧 5.5、上方 0.9、往右 1.6。镜头朝黑洞看，探测器落在画面左下，右边留给屏幕
  const dockPos = new THREE.Vector3();
  const dockLook = new THREE.Vector3();
  function placeDock(p: Probe) {
    const out = offsetTmp.copy(p.group.position).normalize();
    sideTmp.crossVectors(DISK_N, out);
    dockPos.copy(p.group.position).addScaledVector(out, 5.5).addScaledVector(DISK_N, 0.9).addScaledVector(sideTmp, 1.6);
    dockLook.copy(p.group.position).multiplyScalar(0.5);
  }

  function dock(p: Probe) {
    if (scripted() && mode !== 'docked') return;
    if (still) {
      location.assign(p.href);
      return;
    }
    closeTerminal();
    docked = p;
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
    down = { x: e.clientX, y: e.clientY };
  };
  const onMove = (e: PointerEvent) => {
    if (down && mode === 'docked' && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8) {
      undock();
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
    attachExtras();
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
    if (draggingScale || scripted()) return;
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
    if (e.key === 'Escape') goBack();
    else if (e.key === 'Enter' && document.activeElement === canvas) dive();
  };
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
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
        const dotX = THREE.MathUtils.clamp(s.x + radiusPx * 0.16, 56, canvas.clientWidth * 0.30);
        const dotY = THREE.MathUtils.clamp(s.y - radiusPx * 0.08, 200, canvas.clientHeight * 0.50);
        drawTag(options.hole, dotX, dotY, 24);
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

  // 俯冲时的抖动：转镜头而不是挪位置，离得再远也看得出来。
  // 强度来自引力梯度（1/r³，越近涨得越猛）和速度，平方之后小的时候几乎不抖、快到视界才真正剧烈。
  // 用几个正弦叠出来的连续噪声，每帧纯随机看着是电视雪花式的高频闪动，不像被甩动
  function shakeCamera(beta: number, dt: number) {
    // 尺度取 12 * holeScale 是看画面定的：r 不到 5 时黑场已经盖上来了，峰值要赶在那之前
    const distRs = Math.max(camera.position.distanceTo(holeCenter) / Math.max(holeScale, 1e-4), 1.01);
    const tide = Math.min((12 / distRs) ** 3, 1);
    const trauma = Math.min(0.45 * (beta / 0.82) + 0.9 * tide, 1);
    shakePhase += dt * Math.PI * 2 * (3 + 6 * trauma);
    const noise = (t: number) => (Math.sin(t) + 0.6 * Math.sin(2.17 * t + 1.3) + 0.35 * Math.sin(4.31 * t + 2.7)) / 1.95;
    const amount = trauma * trauma;
    camera.rotateX(noise(shakePhase) * amount * 0.022);
    camera.rotateY(noise(shakePhase + 37) * amount * 0.022);
    camera.rotateZ(noise(shakePhase + 91) * amount * 0.035);
  }

  // 第二遍只画几何体，走透镜方程的另一个解（次像）。材质、矩阵、灯光都和第一遍共用，不用维护一份克隆。
  // 次像是翻转的，三角形绕向也反了，这一遍要反过来算正面，否则看到的是物体的背面。
  // 在黑洞前面的物体没有次像，直接跳过省绘制调用。手机上不画：次像很小，看不出来
  const gl = renderer.getContext();
  const probesShown = new Array<boolean>(probes.length);
  let lastDistText = '';
  let lastHeadText = '';
  let lastVeilOpacity = '';
  let lastCopyOpacity = '';
  let miniAt = 0;
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

    placeStation();
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
      placeDock(docked);
      if (mode === 'docking') {
        const k = clamp01(t / DOCK_MS);
        const e = smooth(k);
        const out = offsetTmp.copy(docked.group.position).normalize();
        c1.copy(from.pos).lerp(dockPos, 0.3).addScaledVector(DISK_N, from.pos.distanceTo(dockPos) * 0.15);
        c2.copy(dockPos).addScaledVector(out, 6).addScaledVector(DISK_N, 2);
        bezier(from.pos, c1, c2, dockPos, e, camera.position);
        controls.target.lerpVectors(from.target, dockLook, smooth(clamp01(k / 0.7)));
        if (k >= 1) {
          setMode('docked');
          openTerminal(docked);
        }
      } else {
        // 停靠后（以及屏幕收起的那一小段）跟着探测器一起公转；收完就转向黑洞俯冲
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
    } else if (mode === 'diving') {
      // 先转过去对准当前黑洞中心，再一路加速冲进视界；后半段速度接近光速，星空往前方收拢成隧道
      const k = clamp01(t / DIVE_MS);
      const turn = smooth(clamp01(k / 0.2));
      const rush = clamp01((k - 0.15) / 0.8);
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
      veil.style.opacity = String(smooth(clamp01((k - 0.88) / 0.12)));
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
      mapOpacity > 0.55 ||
      (mode === 'enteringMap' && (activeGalaxy !== null || holeAlpha < 0.25)) ||
      (mode === 'diving' && activeGalaxy !== null);

    if (!inCosmos) {
      station.visible = mode !== 'diving' || !behindHole(stationPos, 2.0);
      for (const p of probes) {
        orbitPosition(p.orbit, p.frame, simTime, p.group.position);
        // 天线（局部 -z）始终对准空间站，像真的探测器对着地球通讯
        p.group.lookAt(offsetTmp.copy(p.group.position).multiplyScalar(2).sub(stationPos));
        p.group.visible = true;
        p.beacon.color.copy(p.tint).multiplyScalar(0.4 + 0.6 * Math.max(0, Math.sin(simTime * 3 + p.phase)));
      }
      rocks.group.visible = true;
      rocks.update(simTime, behindHole);
    } else {
      station.visible = false;
      for (const p of probes) p.group.visible = false;
      rocks.group.visible = false;
    }

    holeUniforms.uBeta.value = beta;
    warpBeta.value = beta;
    warpCenter.value.copy(holeCenter);
    warpScale.value = holeScale;
    holeUniforms.uHoleScale.value = holeScale;
    holeUniforms.uHoleAlpha.value = holeAlpha;
    holeUniforms.uHoleTheme.value = holeTheme;
    holeUniforms.uCosmosMix.value =
      mode === 'flyingGalaxy' || mode === 'enteringMap' || dragScaleU !== null || mapOpacity > 0.005 ? cosmosMix : mapOpacity;
    holeUniforms.uNucleusGlow.value =
      mode === 'flyingGalaxy' || mode === 'enteringMap' ? nucleusGlow : 0;
    dustUniforms.uDustAlpha.value = dustAlpha;
    dustUniforms.uHoleTheme.value = holeTheme;
    dustUniforms.uSize.value = holeScale > 1.25 ? 14 : 18;
    dust.visible = dustAlpha > 0.005;
    starMap.setOpacity(mapOpacity, simTime, ratio);
    const realmFade = extrasReadyAt > 0 ? smooth(clamp01((now - extrasReadyAt) / 900)) : 0;
    const propsAlpha = holeAlpha * (1 - mapOpacity) * realmFade;
    realmProps.update(holeTheme, propsAlpha, simTime, holeCenter, holeScale);
    updateStreaks(beta, dt);

    if (scripted() || scaleDampingActive) camera.lookAt(controls.target);
    else controls.update();
    if (mode === 'diving') shakeCamera(beta, dt);
    camera.updateMatrixWorld();
    lastQuat.copy(stationQuat);

    // 开场从黑里亮起来
    if (mode !== 'diving') {
      const vo = String(still ? 0 : 1 - smooth(clamp01((now - startAt) / 1600)));
      if (vo !== lastVeilOpacity) {
        lastVeilOpacity = vo;
        veil.style.opacity = vo;
      }
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
    const trackGoal = (away ? 0.18 : nearProbe ? 0.02 : 0.06) * baseFade;
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
      if (mode === 'starmap' || mode === 'enteringMap' || mode === 'leavingMap') {
        const mpc = camera.position.distanceTo(controls.target);
        distText = `观测半径 ${mpc.toFixed(0)} Mpc`;
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
        mode === 'flyingGalaxy') &&
      now - miniAt >= (lite ? 80 : 50)
    ) {
      miniAt = now;
      const pinId = mode === 'galaxy' || mode === 'flyingGalaxy' ? activeGalaxy?.id ?? null : null;
      renderMiniMap(sm.miniCanvas, starMap.miniPoints, simTime, pinId);
    }

    renderer.render(scene, camera);
    renderSecondaryImages(inCosmos);

    // 自适应分辨率。几个坑：
    // - 60Hz 屏幕上帧间隔最快就是 16.7ms，升档门槛不能低于它，否则永远升不上去，只降不升，越待越糊
    // - 切走标签页再回来，那一帧间隔是好几秒；这种窗口整段作废，不能拿来降档
    // - 在哪一档掉过帧就记住，之后最多升到它下面一点，免得在两档之间来回抖
    if (now - frameStart > 100) longFrame = true;
    if (++frames === 40) {
      const avg = spent / frames;
      if (!longFrame) {
        let next = ratio;
        if (avg > 26) {
          ceiling = ratio - 0.05;
          next = ratio - 0.15;
        } else if (avg < 18.5) {
          next = Math.min(ratio + 0.1, ceiling);
        }
        const clamped = Math.min(Math.max(next, lite ? 0.5 : 0.6), maxRatio);
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
  };
  document.addEventListener('visibilitychange', onVisible);

  // 开场：黑场盖着，先把所有着色器异步编译好再开始画。
  // 同步编译黑洞那个大着色器要卡主线程几百毫秒，开场那一下顿挫主要来自它
  veil.style.opacity = '1';
  setMode('deck');
  let disposed = false;
  let warmupTimer = 0;
  const begin = () => {
    if (disposed) return;
    startAt = performance.now();
    last = startAt;
    modeAt = startAt;
    frame();
    options.onReady?.();
    warmupTimer = window.setTimeout(() => {
      if (disposed) return;
      attachExtras();
      renderer.compileAsync(scene, camera);
    }, 450);
  };
  renderer.compileAsync(scene, camera).then(begin, begin);

  return () => {
    disposed = true;
    clearTimeout(warmupTimer);
    cancelAnimationFrame(raf);
    observer.disconnect();
    controls.dispose();
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerup', onUp);
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
    starMap.dispose();
    realmProps.dispose();
    rocks.dispose();
    renderer.dispose();
  };
}
