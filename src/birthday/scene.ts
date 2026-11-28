// 生日小屋 3D 场景：悬在紫粉黑洞旁的宇宙浮空岛野餐。
// GLB（Blender 烘焙接触 AO）+ 门户同款光线步进黑洞背景（书房模式：网格之后以 LessEqualDepth 绘制，Early-Z 跳过被岛遮住的像素）
// + 诺诺立牌 + 烛光 / 串灯实时光 + 吹蜡烛（烟雾、流星、黑洞光晕增亮）。
// 自循环动效只有两处（本页约定的例外）：烛火极轻微摇曳（只动火苗网格，烛光强度恒定不闪）、吸积盘旋转；
// 其余动画都由加载、拖拽、点击或吹气触发。性能按设备分档：触屏 / 小屏降步进数、像素比、草量与灯数。
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { holeVertex, holeFragment } from '../door/shaders';

export interface BirthdayAssets {
  scene: string;
  ao: string;
  nuonuo: string;
}

export interface BirthdayOptions {
  canvas: HTMLCanvasElement;
  container: HTMLElement;
  assets: BirthdayAssets;
  reducedMotion: boolean;
  onProgress?: (ratio: number) => void;
  onReady?: () => void;
  onCakeClick?: () => void;
  onCandlesOut?: () => void;
  onError?: (err: unknown) => void;
}

export interface BirthdayController {
  blow(): boolean;
  relight(): void;
  /** 平滑飞回进站时的默认机位（正对蛋糕） */
  resetView(): void;
  readonly lit: boolean;
  dispose(): void;
}

// 黑洞在岛正前方略偏左上，岛离视界约 21 个史瓦西半径：吸积盘横亘半边天，
// 又保持在着色器 16.5Rs 强场球之外（进到球内逐像素步进步长过粗，星点会被拉成雨丝状）
const HOLE_POS = new THREE.Vector3(-12.3, 6.7, -54.3);
const HOLE_SCALE = 2.6;
const ORBIT_TARGET = new THREE.Vector3(0.1, 0.95, -0.1);
// 宽屏机位；竖屏时整体后撤，让右侧的诺诺立牌与桌上蛋糕同时入画
const VIEW_POS = new THREE.Vector3(0.6, 1.35, 3.1);
const VIEW_POS_TALL = new THREE.Vector3(1.0, 1.75, 4.6);
// 开场：从岛外远处的太空缓缓飞近
const INTRO_POS = new THREE.Vector3(7.5, 3.6, 14.5);
const METEOR_N = 5;
// 浮空岛体积（与 build_birthday.py 的 RIM_R / 岛底收拢曲线一致，留出余量），镜头进到岩体里就沿视线推出去
const ISLAND_RIM = 4.95;
const islandBottom = (r: number) => {
  const t = 1 - Math.pow(Math.min(r / 4.75, 1), 1 / 0.78);
  return -0.26 - 4.4 * Math.pow(t, 1.1) - 0.9;
};
const insideIsland = (p: THREE.Vector3) => {
  const r = Math.hypot(p.x, p.z);
  return r < ISLAND_RIM && p.y < 0.25 && p.y > islandBottom(r);
};

// 与 build_birthday.py 的 ground_h() 同一公式：岛面中央平台平坦、往外缓缓起伏，岛缘圆润收边
const islandH = (x: number, z: number) => {
  const r = Math.hypot(x, z);
  const flat = Math.min(1, Math.max(0, (r - 2.4) / 1.6));
  const hump = 0.1 * Math.sin(x * 0.75 + 0.7) * Math.cos(z * 0.6 - 0.3) + 0.05 * Math.sin(z * 1.4 + x * 0.5);
  const lip = -0.55 * Math.max(0, r - 4.4 + 0.35) ** 2;
  return hump * flat + lip;
};
// 野餐垫范围（中心 (0.05, 0.10)、偏航 0.07、半宽 1.33 × 1.0），草不长在垫子上
const onBlanket = (x: number, z: number) => {
  const c = Math.cos(0.07);
  const s = Math.sin(0.07);
  const lx = (x - 0.05) * c - (z - 0.1) * s;
  const lz = (x - 0.05) * s + (z - 0.1) * c;
  return Math.abs(lx) < 1.33 && Math.abs(lz) < 1.0;
};
// 确定性伪随机：每次进站草的分布一致
const mulberry = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

export function supportsWebGL2(): boolean {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

export function mountBirthday(opts: BirthdayOptions): BirthdayController {
  const { canvas, container, assets, reducedMotion } = opts;
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const small = Math.min(window.innerWidth, window.innerHeight) < 700;
  const lite = coarse || small;

  // 黑洞逐像素光线步进，开销跟像素数成正比：桌面像素比 ≤ 1.25、触屏 ≤ 0.8，运行中只降不升
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  let dpr = Math.min(window.devicePixelRatio || 1, lite ? 0.8 : 1.25);
  renderer.setPixelRatio(dpr);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.05, 1200);
  camera.position.copy(reducedMotion ? VIEW_POS : INTRO_POS);
  camera.lookAt(ORBIT_TARGET);

  const controls = new OrbitControls(camera, canvas);
  controls.target.copy(ORBIT_TARGET);
  controls.enableDamping = true;
  controls.dampingFactor = 0.075;
  controls.enablePan = false;
  controls.minDistance = 1.2;
  controls.maxDistance = 19;
  controls.minPolarAngle = 0.06;
  controls.maxPolarAngle = Math.PI - 0.1;
  controls.rotateSpeed = 0.6;
  controls.zoomSpeed = 0.8;
  controls.enabled = false;

  // ---- 黑洞背景（与门户共用着色器，紫粉主题、盘面略倾） ----
  const diskQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.22, 0, -0.14));
  const holeUniforms = {
    uCamPos: { value: new THREE.Vector3() },
    uInvProj: { value: new THREE.Matrix4() },
    uCamWorld: { value: new THREE.Matrix4() },
    uTime: { value: 0 },
    uHover: { value: 0 },
    uDive: { value: 0 },
    uBeta: { value: 0 },
    uDiskN: { value: new THREE.Vector3(0, 1, 0).applyQuaternion(diskQuat).normalize() },
    uDiskU: { value: new THREE.Vector3(1, 0, 0).applyQuaternion(diskQuat).normalize() },
    uDiskV: { value: new THREE.Vector3(0, 0, -1).applyQuaternion(diskQuat).normalize() },
    uHoleNdc: { value: new THREE.Vector2() },
    uStreak: { value: 0 },
    uAspect: { value: 1 },
    uProjZ: { value: new THREE.Vector2() },
    uHoleCenter: { value: HOLE_POS.clone() },
    uHoleScale: { value: HOLE_SCALE },
    uHoleAlpha: { value: 1 },
    uHoleTheme: { value: 1 },
    uCosmosMix: { value: 0 },
    uNucleusGlow: { value: 0 },
  };
  const holeDefines: Record<string, number | string> = { STEPS: lite ? 30 : 52, NO_FRAG_DEPTH: '', STUDY_FAST: '' };
  if (lite) holeDefines.LITE = '';
  const holeMat = new THREE.ShaderMaterial({
    vertexShader: holeVertex,
    fragmentShader: holeFragment,
    uniforms: holeUniforms,
    defines: holeDefines,
    depthTest: true,
    depthWrite: false,
    depthFunc: THREE.LessEqualDepth,
  });
  const holeGeo = new THREE.PlaneGeometry(2, 2);
  const hole = new THREE.Mesh(holeGeo, holeMat);
  hole.frustumCulled = false;
  hole.renderOrder = 1;
  scene.add(hole);

  // ---- 灯光：吸积盘方向的暖粉主光 + 冷调深空半球光 + 底部冷色轮廓光 + 烛光 + 串灯 + 罐灯 ----
  const hemi = new THREE.HemisphereLight('#5a6aa8', '#1c1830', 0.55);
  scene.add(hemi);
  const diskLight = new THREE.DirectionalLight('#ffbfae', 1.5);
  diskLight.position.copy(HOLE_POS).normalize().multiplyScalar(10);
  scene.add(diskLight);
  // 触屏档省掉两盏次要灯（每盏灯都会让所有受光片元多算一遍）
  if (!lite) {
    const rimLight = new THREE.DirectionalLight('#8fa6ff', 0.45);
    rimLight.position.set(6, -2, 8);
    scene.add(rimLight);
  }
  // 从下方打一层冷紫补光，飞到岛底时岩石底座不至于黑成一片
  const underLight = new THREE.DirectionalLight('#7a68d8', 0.7);
  underLight.position.set(-2, -10, 3);
  scene.add(underLight);
  const candle = new THREE.PointLight('#ffa65c', 0, 5.5, 2);
  scene.add(candle);
  const stringLight = new THREE.PointLight('#ffc27a', 0.8, 7, 2);
  stringLight.position.set(0.0, 1.5, -1.25);
  scene.add(stringLight);
  if (!lite) {
    const stringLightB = new THREE.PointLight('#ffc6a0', 0.45, 5, 2);
    stringLightB.position.set(2.35, 1.6, 0.0);
    scene.add(stringLightB);
    const jarLight = new THREE.PointLight('#ffc98a', 0.25, 3.2, 2);
    jarLight.position.set(-1.05, 0.25, -0.55);
    scene.add(jarLight);
  }
  const CANDLE_BASE = 0.55;

  // ---- 资源 ----
  const manager = new THREE.LoadingManager();
  manager.onProgress = (_url: string, loaded: number, total: number) => opts.onProgress?.(total ? loaded / total : 0);
  const texLoader = new THREE.TextureLoader(manager);
  texLoader.setCrossOrigin('anonymous');
  const aoTex = texLoader.load(assets.ao);
  aoTex.flipY = false;
  aoTex.channel = 1;
  aoTex.colorSpace = THREE.NoColorSpace;

  const disposables: { dispose(): void }[] = [aoTex, holeGeo, holeMat];
  const flames: THREE.Mesh[] = [];
  const flameBase: { scale: THREE.Vector3; mat: THREE.MeshStandardMaterial }[] = [];
  const cakePick: THREE.Object3D[] = [];
  let candleCenter = new THREE.Vector3(0, 0.62, 0.02);

  // ---- 诺诺立牌（透明底插画，绕 Y 轴始终朝向镜头） ----
  const standee = new THREE.Group();
  standee.position.set(0.8, 0.018, 0.3);
  scene.add(standee);
  const standeeMat = new THREE.MeshBasicMaterial({
    transparent: true,
    alphaTest: 0.35,
    color: new THREE.Color('#d9d2ea'),
    toneMapped: false,
  });
  const standeeTex = texLoader.load(assets.nuonuo, (t) => {
    const img = t.image as { width: number; height: number };
    const h = 0.86;
    const w = (h * img.width) / img.height;
    const geo = new THREE.PlaneGeometry(w, h);
    geo.translate(0, h / 2, 0);
    standee.add(new THREE.Mesh(geo, standeeMat));
    disposables.push(geo);
  });
  standeeTex.colorSpace = THREE.SRGBColorSpace;
  standeeTex.anisotropy = 4;
  standeeMat.map = standeeTex;
  disposables.push(standeeTex, standeeMat);

  const shadowCanvas = document.createElement('canvas');
  shadowCanvas.width = shadowCanvas.height = 64;
  const sctx = shadowCanvas.getContext('2d')!;
  const grad = sctx.createRadialGradient(32, 32, 2, 32, 32, 32);
  grad.addColorStop(0, 'rgba(0,0,0,0.55)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  sctx.fillStyle = grad;
  sctx.fillRect(0, 0, 64, 64);
  const shadowTex = new THREE.CanvasTexture(shadowCanvas);
  const shadowMat = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false });
  const shadowGeo = new THREE.PlaneGeometry(0.62, 0.26);
  const shadow = new THREE.Mesh(shadowGeo, shadowMat);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.set(0.8, 0.026, 0.33);
  scene.add(shadow);
  disposables.push(shadowTex, shadowMat, shadowGeo);

  // ---- 草地：运行期 InstancedMesh（一株 5 片草叶，一次 draw call），数量按设备分档 ----
  const TUFTS = lite ? 1300 : 3400;
  const tuftGeo = (() => {
    const pos: number[] = [];
    const col: number[] = [];
    const rnd = mulberry(11);
    for (let b = 0; b < 5; b++) {
      const yaw = rnd() * Math.PI * 2;
      const h = 0.05 + rnd() * 0.07;
      const w = 0.004 + rnd() * 0.004;
      const lean = (rnd() - 0.5) * 0.12;
      const ox = (rnd() - 0.5) * 0.09;
      const oz = (rnd() - 0.5) * 0.09;
      const dx = Math.cos(yaw) * w;
      const dz = Math.sin(yaw) * w;
      pos.push(ox - dx, -0.01, oz - dz, ox + dx, -0.01, oz + dz, ox + lean * Math.sin(yaw), h, oz + lean * Math.cos(yaw));
      // 根部暗、尖部亮的竖向渐变，和实例色相乘
      col.push(0.55, 0.55, 0.55, 0.55, 0.55, 0.55, 1.15, 1.15, 1.15);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    return g;
  })();
  const grassMat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.9 });
  const grass = new THREE.InstancedMesh(tuftGeo, grassMat, TUFTS);
  {
    const rnd = mulberry(20261128);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const sc = new THREE.Vector3();
    const pv = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const cA = new THREE.Color('#0f2619');
    const cB = new THREE.Color('#1a3a24');
    const c = new THREE.Color();
    let placed = 0;
    while (placed < TUFTS) {
      const rr = 0.6 + Math.pow(rnd(), 0.9) * 3.05;
      const a = rnd() * Math.PI * 2;
      const x = Math.cos(a) * rr;
      const z = Math.sin(a) * rr;
      if (onBlanket(x, z)) continue;
      q.setFromAxisAngle(up, rnd() * Math.PI * 2);
      const k = 0.75 + rnd() * 0.6;
      sc.set(k, k * (0.8 + rnd() * 0.5), k);
      pv.set(x, islandH(x, z), z);
      m4.compose(pv, q, sc);
      grass.setMatrixAt(placed, m4);
      grass.setColorAt(placed, c.copy(cA).lerp(cB, rnd()));
      placed++;
    }
    grass.instanceMatrix.needsUpdate = true;
    if (grass.instanceColor) grass.instanceColor.needsUpdate = true;
  }
  grass.frustumCulled = false;
  scene.add(grass);
  disposables.push(tuftGeo, grassMat, { dispose: () => grass.dispose() });

  // ---- 状态 ----
  let disposed = false;
  let ready = false;
  let lit = true;
  let introStart = 0;
  let introDone = reducedMotion;
  let blowAt = -1;
  let relightAt = -1;
  let flare = 0;
  let flareGoal = 0;
  // 镜头飞行（开场飞近与「看蛋糕」复位共用）：用户一拖动或滚轮就立即中断
  let flyDur = reducedMotion ? 600 : 2800;
  const flyFromPos = INTRO_POS.clone();
  const flyFromTarget = ORBIT_TARGET.clone();
  const viewPos = VIEW_POS.clone();

  const holeNdc = new THREE.Vector3();
  const syncHole = () => {
    camera.updateMatrixWorld();
    holeUniforms.uCamPos.value.copy(camera.position);
    holeUniforms.uInvProj.value.copy(camera.projectionMatrixInverse);
    holeUniforms.uProjZ.value.set(camera.projectionMatrix.elements[10], camera.projectionMatrix.elements[14]);
    holeUniforms.uCamWorld.value.copy(camera.matrixWorld);
    holeNdc.copy(HOLE_POS).project(camera);
    holeUniforms.uHoleNdc.value.set(holeNdc.x, holeNdc.y);
  };

  // ---- GLB ----
  const gltfLoader = new GLTFLoader(manager);
  gltfLoader.load(
    assets.scene,
    (gltf: { scene: THREE.Group }) => {
      const root = gltf.scene;
      root.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (!mesh.isMesh) return;
        const mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as THREE.MeshStandardMaterial[];
        const hasUv1 = !!mesh.geometry.getAttribute('uv1');
        for (const mat of mats) {
          const name = mat.name || '';
          if (hasUv1) {
            mat.aoMap = aoTex;
            mat.aoMapIntensity = 1.0;
          }
          if (name === 'Mat_BD_Glass') {
            mat.transparent = true;
            mat.opacity = 0.28;
            mat.depthWrite = false;
            mat.roughness = 0.08;
          }
          if (name === 'Mat_BD_BulbGlow' || name === 'Mat_BD_BulbPink') mat.emissiveIntensity = 2.4;
          if (name === 'Mat_BD_JarGlow') mat.emissiveIntensity = 1.8;
          mat.needsUpdate = true;
        }
        const n = mesh.name || mesh.parent?.name || '';
        if (n.startsWith('Cake_Flame')) {
          // 每根火苗独立材质，熄灭时逐根淡出
          const own = (mesh.material as THREE.MeshStandardMaterial).clone();
          own.emissiveIntensity = 1.8;
          mesh.material = own;
          disposables.push(own);
          flames.push(mesh);
          flameBase.push({ scale: mesh.scale.clone(), mat: own });
          cakePick.push(mesh);
        } else if (n.startsWith('Cake')) {
          cakePick.push(mesh);
        }
      });
      scene.add(root);
      if (flames.length) {
        candleCenter = new THREE.Vector3();
        for (const f of flames) candleCenter.add(f.getWorldPosition(new THREE.Vector3()));
        candleCenter.divideScalar(flames.length);
        candleCenter.y += 0.03;
      }
      candle.position.copy(candleCenter);
      candle.intensity = CANDLE_BASE;
      disposables.push({
        dispose() {
          root.traverse((o) => {
            const m = o as THREE.Mesh;
            if (!m.isMesh) return;
            m.geometry.dispose();
            (Array.isArray(m.material) ? m.material : [m.material]).forEach((mm) => mm.dispose());
          });
        },
      });
      // 连同黑洞着色器一起预编译，开场第一帧不再因为编译卡一下
      syncHole();
      renderer
        .compileAsync(scene, camera)
        .catch(() => undefined)
        .finally(() => {
          if (disposed) return;
          ready = true;
          introStart = performance.now();
          flyFromPos.copy(camera.position);
          flyFromTarget.copy(controls.target);
          controls.enabled = true;
          opts.onReady?.();
        });
    },
    undefined,
    (err: unknown) => opts.onError?.(err),
  );

  // 用户一拖动 / 缩放就立刻接管镜头，开场飞行让位于自由视角
  const onControlStart = () => {
    introDone = true;
  };
  controls.addEventListener('start', onControlStart);

  // ---- 烟雾（吹灭时一次性升起） ----
  const SMOKE_N = 42;
  const smokeGeo = new THREE.BufferGeometry();
  const smokePos = new Float32Array(SMOKE_N * 3);
  const smokeSeed = new Float32Array(SMOKE_N);
  for (let i = 0; i < SMOKE_N; i++) smokeSeed[i] = Math.random();
  smokeGeo.setAttribute('position', new THREE.BufferAttribute(smokePos, 3));
  smokeGeo.setAttribute('aSeed', new THREE.BufferAttribute(smokeSeed, 1));
  const smokeMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uT: { value: 0 }, uPx: { value: 300 } },
    vertexShader: /* glsl */ `
      attribute float aSeed;
      uniform float uT;
      uniform float uPx;
      varying float vA;
      void main() {
        float life = clamp(uT - aSeed * 0.6, 0.0, 1.0);
        vec3 p = position;
        p.y += life * (0.32 + aSeed * 0.12);
        p.x += sin(life * 5.0 + aSeed * 12.0) * 0.022 * life;
        p.z += cos(life * 4.0 + aSeed * 7.0) * 0.014 * life;
        vA = (1.0 - life) * smoothstep(0.0, 0.08, life) * 0.2;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = uPx * (0.03 + life * 0.09) / -mv.z;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vA;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = pow(smoothstep(0.5, 0.0, d), 1.6) * vA;
        gl_FragColor = vec4(vec3(0.70, 0.71, 0.80), a);
      }
    `,
  });
  const smoke = new THREE.Points(smokeGeo, smokeMat);
  smoke.visible = false;
  smoke.frustumCulled = false;
  scene.add(smoke);
  disposables.push(smokeGeo, smokeMat);

  // ---- 流星：每颗是一条朝向镜头展开的细长加色光带（尾部渐隐、头部最亮） ----
  const metGeo = new THREE.BufferGeometry();
  const metPos = new Float32Array(METEOR_N * 4 * 3);
  const metT = new Float32Array(METEOR_N * 4);
  const metS = new Float32Array(METEOR_N * 4);
  const metA = new Float32Array(METEOR_N * 4);
  const metIdx: number[] = [];
  for (let k = 0; k < METEOR_N; k++) {
    const o = k * 4;
    metT.set([0, 0, 1, 1], o);
    metS.set([-1, 1, -1, 1], o);
    metIdx.push(o, o + 2, o + 1, o + 1, o + 2, o + 3);
  }
  metGeo.setAttribute('position', new THREE.BufferAttribute(metPos, 3));
  metGeo.setAttribute('aT', new THREE.BufferAttribute(metT, 1));
  metGeo.setAttribute('aS', new THREE.BufferAttribute(metS, 1));
  metGeo.setAttribute('aA', new THREE.BufferAttribute(metA, 1));
  metGeo.setIndex(metIdx);
  const metMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute float aT;
      attribute float aS;
      attribute float aA;
      varying float vT;
      varying float vS;
      varying float vA;
      void main() {
        vT = aT;
        vS = aS;
        vA = aA;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vT;
      varying float vS;
      varying float vA;
      void main() {
        float across = 1.0 - vS * vS;
        float a = pow(vT, 2.2) * across * vA;
        gl_FragColor = vec4(vec3(1.0, 0.93, 0.86) * a * 1.6, a);
      }
    `,
  });
  const meteorMesh = new THREE.Mesh(metGeo, metMat);
  meteorMesh.frustumCulled = false;
  meteorMesh.renderOrder = 3;
  scene.add(meteorMesh);
  disposables.push(metGeo, metMat);
  const meteors: { from: THREE.Vector3; dir: THREE.Vector3; start: number; dur: number }[] = [];

  // 流星从当前镜头朝向附近的天空划过，保证吹灭蜡烛时一定看得见
  const launchMeteors = (now: number) => {
    meteors.length = 0;
    const fwd = new THREE.Vector3();
    camera.getWorldDirection(fwd);
    const yaw0 = Math.atan2(fwd.x, -fwd.z);
    const count = reducedMotion ? 2 : METEOR_N;
    for (let i = 0; i < count; i++) {
      const yaw = yaw0 + (Math.random() - 0.5) * 1.1;
      const el = 0.2 + Math.random() * 0.45;
      const from = new THREE.Vector3(Math.sin(yaw) * Math.cos(el), Math.sin(el), -Math.cos(yaw) * Math.cos(el)).multiplyScalar(62);
      const side = new THREE.Vector3(Math.cos(yaw), 0, Math.sin(yaw)).multiplyScalar(Math.random() < 0.5 ? -1 : 1);
      const dir = side.multiplyScalar(0.75).add(new THREE.Vector3(0, -0.6, 0)).normalize();
      meteors.push({
        from,
        dir,
        start: now + 380 + i * (reducedMotion ? 240 : 360) + Math.random() * 180,
        dur: reducedMotion ? 520 : 1100,
      });
    }
  };

  const metHead = new THREE.Vector3();
  const metTail = new THREE.Vector3();
  const metSide = new THREE.Vector3();
  const metView = new THREE.Vector3();
  const putVert = (idx: number, p: THREE.Vector3, s: number, w: number) => {
    metPos[idx * 3] = p.x + metSide.x * w * s;
    metPos[idx * 3 + 1] = p.y + metSide.y * w * s;
    metPos[idx * 3 + 2] = p.z + metSide.z * w * s;
  };
  const updateMeteors = (now: number) => {
    for (let k = 0; k < METEOR_N; k++) {
      const m = meteors[k];
      const o = k * 4;
      let alpha = 0;
      if (m) {
        const p = (now - m.start) / m.dur;
        if (p >= 0 && p <= 1.25) {
          const q = Math.min(p, 1);
          alpha = p < 0.12 ? p / 0.12 : p > 1 ? 1 - (p - 1) / 0.25 : 1;
          metHead.copy(m.from).addScaledVector(m.dir, 26 * q);
          metTail.copy(metHead).addScaledVector(m.dir, -9 * Math.min(q * 3, 1));
          metView.copy(camera.position).sub(metHead);
          metSide.crossVectors(m.dir, metView).normalize();
          putVert(o, metTail, -1, 0.025);
          putVert(o + 1, metTail, 1, 0.025);
          putVert(o + 2, metHead, -1, 0.16);
          putVert(o + 3, metHead, 1, 0.16);
        }
      }
      metA.fill(Math.max(alpha, 0), o, o + 4);
    }
    metGeo.attributes.position.needsUpdate = true;
    metGeo.attributes.aA.needsUpdate = true;
  };

  // ---- 吹灭 / 重燃 ----
  let flareTimer = 0;
  let outTimer = 0;
  const blow = (): boolean => {
    if (!ready || !lit) return false;
    lit = false;
    const now = performance.now();
    blowAt = now;
    relightAt = -1;
    smoke.visible = true;
    for (let i = 0; i < SMOKE_N; i++) {
      const f = flames[i % Math.max(flames.length, 1)];
      const p = f ? f.getWorldPosition(new THREE.Vector3()) : candleCenter.clone();
      smokePos[i * 3] = p.x + (Math.random() - 0.5) * 0.008;
      smokePos[i * 3 + 1] = p.y + 0.012;
      smokePos[i * 3 + 2] = p.z + (Math.random() - 0.5) * 0.008;
    }
    smokeGeo.attributes.position.needsUpdate = true;
    launchMeteors(now);
    flareGoal = 1;
    window.clearTimeout(flareTimer);
    flareTimer = window.setTimeout(() => {
      flareGoal = 0;
    }, 3200);
    window.clearTimeout(outTimer);
    outTimer = window.setTimeout(() => {
      if (!disposed) opts.onCandlesOut?.();
    }, reducedMotion ? 300 : 3000);
    return true;
  };

  const relight = () => {
    if (lit) return;
    lit = true;
    relightAt = performance.now();
  };

  // ---- 拾取：点一下蛋糕就吹灭 ----
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let downAt: { x: number; y: number } | null = null;
  let hovering = false;
  const pickCake = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    return ray.intersectObjects(cakePick, false).length > 0;
  };
  const onMove = (e: PointerEvent) => {
    if (!ready || e.pointerType === 'touch' || e.buttons) return;
    const hit = pickCake(e);
    if (hit !== hovering) {
      hovering = hit;
      canvas.style.cursor = hit ? 'pointer' : '';
    }
  };
  const onDown = (e: PointerEvent) => {
    downAt = { x: e.clientX, y: e.clientY };
  };
  const onUp = (e: PointerEvent) => {
    if (!downAt || !ready) return;
    const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
    downAt = null;
    if (moved > 6) return;
    if (pickCake(e)) opts.onCakeClick?.();
  };
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointerup', onUp);

  // ---- 尺寸 ----
  const resize = () => {
    const w = Math.max(container.clientWidth, 1);
    const h = Math.max(container.clientHeight, 1);
    const tall = w / h < 0.9;
    camera.fov = tall ? 56 : 42;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    holeUniforms.uAspect.value = camera.aspect;
    viewPos.copy(tall ? VIEW_POS_TALL : VIEW_POS);
    smokeMat.uniforms.uPx.value = (h * renderer.getPixelRatio()) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  };
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  // ---- 帧循环 ----
  let raf = 0;
  let last = performance.now();
  let frameAcc = 0;
  let frameCount = 0;
  const tmpV = new THREE.Vector3();
  const tick = (now: number) => {
    raf = requestAnimationFrame(tick);
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    const t = now / 1000;

    // 只降不升：连续 2s 平均帧时 > 22ms 就把像素比降一档
    frameAcc += dt;
    frameCount++;
    if (frameAcc > 2) {
      const avg = (frameAcc / frameCount) * 1000;
      if (ready && avg > 22 && dpr > 0.6) {
        dpr = Math.max(0.6, dpr - 0.12);
        renderer.setPixelRatio(dpr);
        resize();
      }
      frameAcc = 0;
      frameCount = 0;
    }

    // 开场飞近 / 看蛋糕复位：用户一碰就让出镜头
    if (ready && !introDone) {
      const k = Math.min((now - introStart) / flyDur, 1);
      const e = easeInOut(k);
      camera.position.lerpVectors(flyFromPos, viewPos, e);
      controls.target.lerpVectors(flyFromTarget, ORBIT_TARGET, e);
      if (k >= 1) introDone = true;
    }
    controls.update();
    if (insideIsland(camera.position)) {
      tmpV.copy(camera.position).sub(controls.target);
      for (let i = 0; i < 40 && insideIsland(camera.position); i++) {
        tmpV.multiplyScalar(1.08);
        camera.position.copy(controls.target).add(tmpV);
      }
    }

    // 吸积盘旋转（自循环例外之一；减弱动效时放慢）
    holeUniforms.uTime.value += dt * (reducedMotion ? 0.35 : 1);
    flare += (flareGoal - flare) * Math.min(1, dt * 2.2);
    holeUniforms.uDive.value = flare * 0.22;
    syncHole();

    // 烛火：摇曳（自循环例外之二）+ 熄灭 / 重燃过渡
    let flameK = lit ? 1 : 0;
    if (blowAt > 0 && !lit) flameK = 1 - Math.min((now - blowAt) / (reducedMotion ? 150 : 320), 1);
    if (relightAt > 0 && lit) flameK = easeOut(Math.min((now - relightAt) / (reducedMotion ? 150 : 520), 1));
    // 只让火苗网格极轻、极慢地摆一摆；烛光强度与火苗亮度保持恒定，桌面不再一明一暗
    const amp = reducedMotion ? 0.3 : 1;
    flames.forEach((f, i) => {
      const base = flameBase[i];
      const sy = flameK * (1 + amp * 0.035 * Math.sin(t * 2.6 + i * 2.1));
      f.scale.set(base.scale.x * Math.max(flameK, 0.001), base.scale.y * Math.max(sy, 0.001), base.scale.z * Math.max(flameK, 0.001));
      f.rotation.z = amp * 0.035 * Math.sin(t * 1.7 + i * 1.7) * flameK;
      f.visible = flameK > 0.01;
      base.mat.emissiveIntensity = 1.8 * flameK;
    });
    candle.intensity = CANDLE_BASE * flameK;

    if (smoke.visible && blowAt > 0) {
      const st = (now - blowAt) / (reducedMotion ? 1200 : 2600);
      smokeMat.uniforms.uT.value = st * 1.6;
      if (st > 1.05) smoke.visible = false;
    }
    updateMeteors(now);

    // 立牌绕 Y 轴朝向镜头
    tmpV.copy(camera.position).sub(standee.position);
    standee.rotation.y = Math.atan2(tmpV.x, tmpV.z);

    renderer.render(scene, camera);
  };
  raf = requestAnimationFrame(tick);

  const onVis = () => {
    if (document.hidden) {
      cancelAnimationFrame(raf);
    } else {
      last = performance.now();
      raf = requestAnimationFrame(tick);
    }
  };
  document.addEventListener('visibilitychange', onVis);

  const resetView = () => {
    if (!ready) return;
    flyFromPos.copy(camera.position);
    flyFromTarget.copy(controls.target);
    flyDur = reducedMotion ? 300 : 1300;
    introStart = performance.now();
    introDone = false;
  };

  return {
    blow,
    relight,
    resetView,
    get lit() {
      return lit;
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      window.clearTimeout(flareTimer);
      window.clearTimeout(outTimer);
      document.removeEventListener('visibilitychange', onVis);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointerup', onUp);
      controls.removeEventListener('start', onControlStart);
      ro.disconnect();
      controls.dispose();
      for (const d of disposables) d.dispose();
      renderer.dispose();
    },
  };
}
