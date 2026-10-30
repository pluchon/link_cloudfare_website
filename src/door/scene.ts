import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { holeVertex, holeFragment, dustVertex, dustFragment } from './shaders';
import { buildStation } from './station';
import { buildProbe, orbitFrame, orbitPath, orbitPosition, type Orbit } from './orbits';
import { travel, type LoaderUI } from './loader';
import { buildRocks } from './rocks';

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
  };
}

type Mode = 'deck' | 'leaving' | 'free' | 'returning' | 'docking' | 'docked' | 'undocking' | 'warping' | 'diving';

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

// 自由视角：绕黑洞转，默认从高处斜着看下去，五条轨道和空间站都在画面里
const FREE_DISTANCE = 82;
const FREE_PHI = 0.62;

const DISK_N = new THREE.Vector3(0, 1, 0);
const DISK_U = new THREE.Vector3(1, 0, 0);
const DISK_V = new THREE.Vector3(0, 0, -1);

const LEAVE_MS = 3800;
const RETURN_MS = 5200;
const DOCK_MS = 3200;
const UNDOCK_MS = 2600;
// 点屏幕后，屏幕收起要这么久，收完才开始俯冲
const FOLD_MS = 650;
const DIVE_MS = 4600;

const ORIGIN = new THREE.Vector3();
const smooth = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (t: number) => Math.min(Math.max(t, 0), 1);

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
  const holeUniforms = {
    uCamPos: { value: new THREE.Vector3() },
    uInvProj: { value: new THREE.Matrix4() },
    uCamWorld: { value: new THREE.Matrix4() },
    uTime: { value: 0 },
    uHover: { value: 0 },
    uDive: { value: 0 },
    uBeta: { value: 0 },
    uDiskN: { value: DISK_N },
    uDiskU: { value: DISK_U },
    uDiskV: { value: DISK_V },
    uHoleNdc: { value: new THREE.Vector2() },
    uStreak: { value: 0 },
    uAspect: { value: 1 },
  };
  const defines: Record<string, number | string> = { STEPS: lite ? 100 : 170 };
  if (lite) defines.LITE = '';
  const hole = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({
      vertexShader: holeVertex,
      fragmentShader: holeFragment,
      uniforms: holeUniforms,
      defines,
      depthTest: false,
      depthWrite: false,
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
  const stationBeacon = station.userData.beacon as THREE.MeshBasicMaterial;
  const holo = station.userData.holo as THREE.Object3D;
  const deckLight = new THREE.PointLight(0xffd2a0, 0.6, 4, 2);
  deckLight.position.set(0, 0.25, 0);
  station.add(deckLight);

  // 光从吸积盘那边来：暖色平行光勾边，冷色环境光很弱，暗面要够暗才有深空感
  scene.add(new THREE.HemisphereLight(0x4a5a80, 0x05070d, 0.35));
  const diskLight = new THREE.DirectionalLight(0xffc690, 2.4);
  diskLight.target = station;
  scene.add(diskLight);

  // ---- 轨迹线：甲板上看很淡，离开甲板才清楚；空间站自己的虚线轨道只在自由视角显示 ----
  const trackMaterial = new THREE.LineBasicMaterial({ color: 0xe9e6f0, transparent: true, opacity: 0.06, depthWrite: false });
  for (const orbit of PROBE_ORBITS) scene.add(new THREE.LineLoop(orbitPath(orbit), trackMaterial));
  const stationTrackMaterial = new THREE.LineDashedMaterial({
    color: 0xe9e6f0,
    transparent: true,
    opacity: 0,
    dashSize: 1.2,
    gapSize: 1.2,
    depthWrite: false,
  });
  const stationTrack = new THREE.LineLoop(orbitPath(STATION_ORBIT), stationTrackMaterial);
  stationTrack.computeLineDistances();
  scene.add(stationTrack);

  // ---- 探测器 ----
  const probes = options.probes.map((spec, i) => {
    const tint = new THREE.Color(PROBE_BEACONS[i]);
    const { group, beacon } = buildProbe(PROBE_BEACONS[i]);
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
    uDiskN: { value: DISK_N },
    uDiskU: { value: DISK_U },
    uDiskV: { value: DISK_V },
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
    const speed = 20 + beta * 260;
    const len = 0.5 + beta * 9;
    for (let i = 0; i < streakCount; i++) {
      let z = streakSeed[i * 3 + 2] + speed * dt;
      if (z > -0.5) z -= 60;
      streakSeed[i * 3 + 2] = z;
      const x = streakSeed[i * 3];
      const y = streakSeed[i * 3 + 1];
      streakPositions.set([x, y, z, x, y, z - len], i * 6);
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

  // 甲板上的默认朝向：正对黑洞
  const deckLook = (out = new THREE.Vector3()) => out.copy(eye).add(offsetTmp.copy(ORIGIN).sub(eye).setLength(0.05));
  const offsetTmp = new THREE.Vector3();
  camera.position.copy(eye);
  controls.target.copy(deckLook());
  controls.update();

  let mode: Mode = 'deck';
  let modeAt = performance.now();
  let leavePhi = Math.PI / 2;
  let docked: Probe | null = null;
  const from = { pos: new THREE.Vector3(), target: new THREE.Vector3(), fov: 38 };
  const offset = new THREE.Vector3();
  const spherical = new THREE.Spherical();

  function baseFov() {
    // 竖屏视野放宽，黑洞和甲板都要进得来
    return camera.aspect < 1 ? 62 : 38;
  }

  // 标注文字的宽度：只在启动和窗口变化时量。每帧读 offsetWidth 会逼浏览器每帧重排，开场那点卡顿有一部分就是它
  const labelWidth = new Map<HTMLElement, number>();
  const allTags = [options.hole, options.base, ...probes.map((p) => p.tag)];
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
  };

  function setMode(next: Mode) {
    mode = next;
    modeAt = performance.now();
    from.pos.copy(camera.position);
    from.target.copy(controls.target);
    from.fov = camera.fov;
    leavePhi = spherical.setFromVector3(offset.copy(camera.position).sub(controls.target)).phi;
    hud.view.textContent = viewNames[next];
  }

  // 甲板上一拖动，就开始慢慢退出空间站。只认拖动期间和松手后 0.4 秒：
  // 开着阻尼，快速一甩的转动大半发生在松手之后；但时间不能放太长，
  // 不然回到甲板时残留的 change 会把人又送出去
  const startDir = new THREE.Vector3();
  let armed = false;
  let disarm = 0;
  controls.addEventListener('start', () => {
    armed = true;
    clearTimeout(disarm);
    camera.getWorldDirection(startDir);
  });
  controls.addEventListener('end', () => {
    disarm = window.setTimeout(() => (armed = false), 400);
  });
  controls.addEventListener('change', () => {
    if (mode !== 'deck' || !armed) return;
    const now = new THREE.Vector3();
    camera.getWorldDirection(now);
    if (now.angleTo(startDir) > 0.06) setMode('leaving');
  });

  // 视线到黑洞中心的最近距离（直线近似）小于阴影半径，就算点中了黑洞
  const ray = new THREE.Raycaster();
  function overHole(x: number, y: number): boolean {
    ray.setFromCamera(new THREE.Vector2(x, y), camera);
    const o = ray.ray.origin;
    const d = ray.ray.direction;
    if (o.dot(d) > 0) return false;
    return new THREE.Vector3().crossVectors(o, d).length() < 3.4;
  }

  // 屏幕上离指针最近、20px 以内的探测器
  function probeAt(clientX: number, clientY: number): Probe | null {
    const rect = canvas.getBoundingClientRect();
    let best: Probe | null = null;
    let bestD = 20;
    for (const p of probes) {
      if (!p.group.visible) continue;
      const v = offsetTmp.copy(p.group.position).project(camera);
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

  function toNdc(e: PointerEvent | MouseEvent) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * 2 - 1,
      y: -((e.clientY - rect.top) / rect.height) * 2 + 1,
    };
  }

  // 镜头被脚本接管、用户不能拖的模式
  function scripted() {
    return mode !== 'deck' && mode !== 'free' && mode !== 'leaving';
  }

  // 俯冲进黑洞：去思维导图首页是它，点探测器屏幕的跃迁最后也是它，只是终点换成那个分类
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
    startDive(target, '正在穿越视界 · 前往基地');
  }

  // ---- 探测器对接：飞到探测器侧后方停住，终端屏幕从旁边展开 ----
  // 停靠点：探测器外侧 5.5、上方 0.9、往右 1.6。镜头朝黑洞看，探测器落在画面左下，右边留给屏幕
  const dockPos = new THREE.Vector3();
  const dockLook = new THREE.Vector3();
  function placeDock(p: Probe) {
    const out = offsetTmp.copy(p.group.position).normalize();
    const side = new THREE.Vector3().crossVectors(DISK_N, out);
    dockPos.copy(p.group.position).addScaledVector(out, 5.5).addScaledVector(DISK_N, 0.9).addScaledVector(side, 1.6);
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
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') goBack();
    else if (e.key === 'Enter' && document.activeElement === canvas) dive();
  };
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
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

  // 把一个世界坐标点投到屏幕上；在镜头后面或出了画面就返回 null
  function toScreen(p: THREE.Vector3) {
    projected.copy(p).project(camera);
    camera.getWorldDirection(forward);
    if (forward.dot(offset.copy(p).sub(camera.position)) <= 0) return null;
    if (Math.abs(projected.x) > 0.96 || Math.abs(projected.y) > 0.96) return null;
    return {
      x: (projected.x * 0.5 + 0.5) * canvas.clientWidth,
      y: (-projected.y * 0.5 + 0.5) * canvas.clientHeight,
    };
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
    const s = toScreen(ORIGIN);
    holeUniforms.uHoleNdc.value.set(projected.x, projected.y);
    if (!s) {
      show(options.hole, false);
      return false;
    }
    if (on) {
      right.setFromMatrixColumn(camera.matrixWorld, 0);
      rim.copy(right).multiplyScalar(2.9).project(camera);
      const radiusPx = Math.abs((rim.x * 0.5 + 0.5) * canvas.clientWidth - s.x);
      drawTag(options.hole, s.x + radiusPx * 0.72, s.y - radiusPx * 0.72, 46);
    }
    show(options.hole, on);
    return true;
  }

  // 一个点是否被黑洞挡住：比黑洞远，视线又穿过阴影
  function behindHole(p: THREE.Vector3) {
    offset.copy(p).sub(camera.position);
    if (offset.lengthSq() < camera.position.lengthSq()) return false;
    return offset.normalize().cross(camera.position).length() < 2.8;
  }

  function placeTag(tag: Tag, p: THREE.Vector3, on: boolean) {
    const s = on && !behindHole(p) ? toScreen(p) : null;
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
  const shake = new THREE.Vector3();
  const c1 = new THREE.Vector3();
  const c2 = new THREE.Vector3();
  const goalPos = new THREE.Vector3();
  const goalLook = new THREE.Vector3();

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
    }
    // 桅杆顶上的航标灯：短促地闪一下，大部分时间是暗的
    const blink = 0.25 + 0.75 * Math.max(0, Math.sin(simTime * 2.2)) ** 8;
    stationBeacon.color.setRGB(blink, blink * 0.14, blink * 0.1);

    // 空间站和探测器按各自轨道走；被黑洞挡住的不画（黑洞画在背景上，不藏的话会盖在阴影前面）
    placeStation();
    station.visible = !behindHole(stationPos);
    stationQuat.copy(station.quaternion);
    for (const p of probes) {
      orbitPosition(p.orbit, p.frame, simTime, p.group.position);
      // 天线（局部 -z）始终对准空间站，像真的探测器对着地球通讯
      p.group.lookAt(offsetTmp.copy(p.group.position).multiplyScalar(2).sub(stationPos));
      p.group.visible = !behindHole(p.group.position);
      p.beacon.color.copy(p.tint).multiplyScalar(0.4 + 0.6 * Math.max(0, Math.sin(simTime * 3 + p.phase)));
    }
    rocks.update(simTime, behindHole);

    let beta = 0;

    if (mode === 'deck') {
      // 站在跟着空间站一起转的参考系里：视线方向跟着空间站的朝向转，人跟着甲板走
      offset.copy(controls.target).sub(camera.position);
      offset.applyQuaternion(lastQuat.invert()).applyQuaternion(stationQuat);
      camera.position.copy(eye);
      controls.target.copy(eye).add(offset);
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
    } else if (mode === 'diving') {
      // 先转过去对准黑洞，再一路加速冲进视界；后半段速度接近光速，星空往前方收拢成隧道
      const k = clamp01(t / DIVE_MS);
      const turn = smooth(clamp01(k / 0.2));
      const rush = clamp01((k - 0.15) / 0.8);
      const e = Math.pow(rush, 2.2);
      goalPos.copy(from.pos).setLength(1.05);
      camera.position.lerpVectors(from.pos, goalPos, e);
      lookNow.lerpVectors(from.target, ORIGIN, turn);
      controls.target.copy(lookNow);
      camera.fov = THREE.MathUtils.lerp(from.fov, 88, smooth(rush));
      camera.updateProjectionMatrix();
      // 速度在中段最快、接近视界时收下来：光行差会把正前方的东西压小，
      // 一直全速的话冲到最后黑洞只剩画面中间一个点，胀满全屏的那一下就没了
      beta = 0.82 * Math.pow(Math.sin(Math.PI * clamp01((rush - 0.08) / 0.86)), 1.3);
      holeUniforms.uDive.value = rush;
      dustUniforms.uDive.value = rush;
      // 越快抖得越厉害
      shake.set(Math.random() - 0.5, Math.random() - 0.5, 0).multiplyScalar(beta * 0.012 * camera.position.length());
      camera.position.add(shake.applyQuaternion(camera.quaternion));
      // 最后越过视界：一黑，接着是加载画面
      veil.style.background = '#000';
      veil.style.opacity = String(smooth(clamp01((k - 0.88) / 0.12)));
      const r = Math.max(camera.position.length(), 1.0001);
      hud.distance.textContent = `距视界 ${(r - 1).toFixed(2)} Rs · 时间流速 ×${Math.sqrt(1 - 1 / r).toFixed(2)}`;
      if (k >= 1) {
        // 场景不用再画了，把显卡和主线程都让给加载
        cancelAnimationFrame(raf);
        travel(diveTo.href, diveTo.title, options.loader);
        return;
      }
    }

    holeUniforms.uBeta.value = beta;
    updateStreaks(beta, dt);

    if (scripted()) camera.lookAt(controls.target);
    else controls.update();
    camera.updateMatrixWorld();
    lastQuat.copy(stationQuat);

    // 开场从黑里亮起来
    if (mode !== 'diving') veil.style.opacity = String(still ? 0 : 1 - smooth(clamp01((now - startAt) / 1600)));

    // 标题只在甲板上显示，按时间算
    const onDeck =
      mode === 'deck'
        ? 1
        : mode === 'returning'
          ? clamp01((t - RETURN_MS * 0.75) / (RETURN_MS * 0.25))
          : mode === 'leaving'
            ? 1 - clamp01(t / 800)
            : 0;
    copy.style.opacity = String(onDeck);

    // 轨迹线：甲板上很淡，离开甲板就清楚一些；空间站的虚线只在自由视角
    const away = mode === 'free' || mode === 'leaving' ? 1 : 0;
    // 俯冲时轨迹线收掉，不然最后会有几根线横穿在黑洞阴影上
    const trackGoal = mode === 'diving' ? 0 : away ? 0.18 : 0.06;
    trackMaterial.opacity += (trackGoal - trackMaterial.opacity) * Math.min(dt * 3, 1);
    stationTrackMaterial.opacity += (away * 0.2 - stationTrackMaterial.opacity) * Math.min(dt * 3, 1);

    hover += ((hovering && !scripted() ? 1 : 0) - hover) * Math.min(dt * 6, 1);
    holeUniforms.uHover.value = hover;
    holeUniforms.uCamPos.value.copy(camera.position);
    holeUniforms.uInvProj.value.copy(camera.projectionMatrixInverse);
    holeUniforms.uCamWorld.value.copy(camera.matrixWorld);

    // 标注：对接、跃迁、俯冲时都收起来，画面留给屏幕和特效
    const tagsOn = mode === 'deck' || mode === 'free' || mode === 'leaving';
    const holeOn = placeHoleTag(tagsOn);
    // 横向光晕只属于侧视：越接近俯视越淡，正上方往下看时它就是一道莫名其妙的横线
    const edgeOn = 1 - Math.abs(offset.copy(camera.position).normalize().dot(DISK_N));
    holeUniforms.uStreak.value = holeOn ? edgeOn * edgeOn : 0;
    for (const p of probes) placeTag(p.tag, p.group.position, tagsOn);
    placeTag(options.base, stationPos, away === 1);

    // 读数：离视界多远、朝哪个方向、俯仰多少
    camera.getWorldDirection(forward);
    const heading = (THREE.MathUtils.radToDeg(Math.atan2(forward.x, -forward.z)) + 360) % 360;
    const pitch = THREE.MathUtils.radToDeg(Math.asin(forward.y));
    if (mode !== 'diving') hud.distance.textContent = `距视界 ${(camera.position.length() - 1).toFixed(1)} Rs`;
    hud.heading.textContent = `方位 ${heading.toFixed(0).padStart(3, '0')}° · 俯仰 ${pitch >= 0 ? '+' : ''}${pitch.toFixed(0)}°`;
    hud.headingTape.style.backgroundPositionX = `${-heading * 4}px`;
    hud.pitchTape.style.backgroundPositionY = `${pitch * 4}px`;

    renderer.render(scene, camera);

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
  const begin = () => {
    if (disposed) return;
    startAt = performance.now();
    last = startAt;
    modeAt = startAt;
    frame();
    options.onReady?.();
  };
  renderer.compileAsync(scene, camera).then(begin, begin);

  return () => {
    disposed = true;
    cancelAnimationFrame(raf);
    observer.disconnect();
    controls.dispose();
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerup', onUp);
    canvas.removeEventListener('dblclick', goBack);
    options.hole.label.removeEventListener('click', onHoleLabel);
    probes.forEach((p, i) => {
      p.tag.label.removeEventListener('click', handlers[i].onLabel);
      p.terminal.removeEventListener('click', handlers[i].onScreen);
    });
    window.removeEventListener('keydown', onKey);
    document.removeEventListener('visibilitychange', onVisible);
    rocks.dispose();
    renderer.dispose();
  };
}
