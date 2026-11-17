import * as THREE from 'three';
import { buildStarMap, renderMiniMap, STAR_NODES } from '../../door/starmap';
import { dustFragment, dustVertex, holeFragment, holeVertex } from '../../door/shaders';
import { warpBeta, warpCenter, warpImage, warpScale } from '../../door/warp';
import { createCosmicAudio } from './audio';
import { getAtlasModelSvg } from './models';
import { buildShip, SHIPS, type ShipModel, type ShipSpec } from './ship';
import { buildCosmicTrack, COSMOS_SCALE, HOLE_SCALE_MULT, type TrackSample } from './track';
import { buildCosmicWorld, type AtlasItemSpec } from './world';

const BEST_KEY = 'nn-cosmic-atlas-best';
const SHIP_KEY = 'nn-cosmic-ship';
const IMAGE_LAYER = 1;
const SHIP_SCALE = 0.36;
const BASE_SPEED = 24.0;
const BASE_FOV = 68;
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const DISK_N = new THREE.Vector3(0, 1, 0);
const DISK_U = new THREE.Vector3(1, 0, 0);
const DISK_V = new THREE.Vector3(0, 0, -1);
const diskEulerTmp = new THREE.Euler();
const diskQuatTmp = new THREE.Quaternion();
function diskFrame(rx: number, rz: number, n: THREE.Vector3, u: THREE.Vector3, v: THREE.Vector3) {
  diskQuatTmp.setFromEuler(diskEulerTmp.set(rx, 0, rz));
  n.copy(DISK_N).applyQuaternion(diskQuatTmp).normalize();
  u.copy(DISK_U).applyQuaternion(diskQuatTmp).normalize();
  v.copy(DISK_V).applyQuaternion(diskQuatTmp).normalize();
}

type GameState = 'ready' | 'playing' | 'paused' | 'atlas' | 'finished';

const ICONS = {
  ring: '<circle cx="12" cy="12" r="7.5" /><circle cx="12" cy="12" r="3" />',
  relic: '<path d="M12 3l6 9-6 9-6-9z" />',
  sling: '<path d="M13 2.5L5.5 13.5h5l-1 8 8.5-11.5h-5z" />',
  star: '<path d="M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.4l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" />',
} as const;

export function supportsWebGL2(): boolean {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

function clamp01(v: number) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function formatClock(sec: number) {
  const s = Math.max(0, Math.floor(sec));
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

export function mountCosmicRoam(root: HTMLElement): () => void {
  const stage = root.querySelector<HTMLElement>('[data-stage]')!;
  const canvas = root.querySelector<HTMLCanvasElement>('[data-canvas]')!;
  const rushCanvas = root.querySelector<HTMLCanvasElement>('[data-rush]')!;
  const rushCtx = rushCanvas.getContext('2d');

  const progressBar = root.querySelector<HTMLElement>('[data-progress]')!;
  const sectorEl = root.querySelector<HTMLElement>('[data-sector]')!;
  const relicsEl = root.querySelector<HTMLElement>('[data-relics]')!;
  const atlasBtn = root.querySelector<HTMLButtonElement>('[data-atlas-btn]')!;
  const miniCanvas = root.querySelector<HTMLCanvasElement>('[data-mini]')!;

  const muteBtn = root.querySelector<HTMLButtonElement>('[data-mute]')!;
  const pauseBtn = root.querySelector<HTMLButtonElement>('[data-pause]')!;
  const toastsEl = root.querySelector<HTMLElement>('[data-toasts]')!;

  const teleBox = root.querySelector<HTMLElement>('[data-tele-box]')!;
  const teleModeEl = root.querySelector<HTMLElement>('[data-tele-mode]')!;
  const warpBar = root.querySelector<HTMLElement>('[data-warp]')!;
  const warpNum = root.querySelector<HTMLElement>('[data-warp-num]')!;
  const teleSpeed = root.querySelector<HTMLElement>('[data-tele-speed]')!;
  const teleNext = root.querySelector<HTMLElement>('[data-tele-next]')!;

  const readyBox = root.querySelector<HTMLElement>('[data-ready]')!;
  const picksEl = root.querySelector<HTMLElement>('[data-picks]')!;
  const pauseHint = root.querySelector<HTMLElement>('[data-pause-hint]')!;
  const loaderEl = root.querySelector<HTMLElement>('[data-loader]')!;
  const loaderBarEl = root.querySelector<HTMLElement>('[data-loader-bar]')!;
  const loaderPctEl = root.querySelector<HTMLElement>('[data-loader-pct]')!;

  const finishModal = root.querySelector<HTMLElement>('[data-finish]')!;
  const statRelics = root.querySelector<HTMLElement>('[data-stat-relics]')!;
  const statLit = root.querySelector<HTMLElement>('[data-stat-lit]')!;
  const statSlings = root.querySelector<HTMLElement>('[data-stat-slings]')!;
  const statTime = root.querySelector<HTMLElement>('[data-stat-time]')!;

  const atlasDialog = root.querySelector<HTMLElement>('[data-atlas]')!;
  const atlasListEl = root.querySelector<HTMLElement>('[data-atlas-list]')!;
  const atlasCloseBtn = root.querySelector<HTMLButtonElement>('[data-atlas-close]')!;

  const recordValEl = root.querySelector<HTMLElement>('[data-record-val]')!;
  const stickEl = root.querySelector<HTMLElement>('[data-stick]')!;
  const knobEl = root.querySelector<HTMLElement>('[data-knob]')!;
  const turboBtn = root.querySelector<HTMLButtonElement>('[data-turbo]')!;

  const keyL = root.querySelector<HTMLElement>('.roam__key--l');
  const keyR = root.querySelector<HTMLElement>('.roam__key--r');
  const keyU = root.querySelector<HTMLElement>('.roam__key--u');
  const keyD = root.querySelector<HTMLElement>('.roam__key--d');
  const keyA = root.querySelector<HTMLElement>('.roam__key--a');
  const keyB = root.querySelector<HTMLElement>('.roam__key--b');

  const touch = matchMedia('(pointer: coarse)').matches;
  const lite = touch || innerWidth < 768;
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const audio = createCosmicAudio();

  const scopeAttr = [...root.attributes].find((a) => a.name.startsWith('data-astro-cid-'))?.name ?? '';
  function scopeTree(el: Element) {
    if (!scopeAttr) return;
    el.setAttribute(scopeAttr, '');
    el.querySelectorAll('*').forEach((child) => child.setAttribute(scopeAttr, ''));
  }

  // ---- WebGL 场景与渲染器 ----
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  const maxRatio = Math.min(devicePixelRatio || 1, lite ? 0.95 : 1.2);
  let ratio = Math.min(maxRatio, lite ? 0.7 : 0.85);
  renderer.setPixelRatio(ratio);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x03050c);
  const camera = new THREE.PerspectiveCamera(BASE_FOV, 1, 0.05, 4200);
  scene.add(camera);

  // ---- 黑洞着色器常驻场景（uHoleAlpha 接近 0 时 GPU 跳过步进循环，STEPS 收敛至 56/76 降编译与渲染开销） ----
  const diskN = DISK_N.clone();
  const diskU = DISK_U.clone();
  const diskV = DISK_V.clone();
  const holeCenter = new THREE.Vector3();
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
    uHoleAlpha: { value: 0 },
    uHoleTheme: { value: 0 },
    uCosmosMix: { value: 1 },
    uNucleusGlow: { value: 0 },
  };
  const hole = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({
      vertexShader: holeVertex,
      fragmentShader: holeFragment,
      uniforms: holeUniforms,
      defines: lite ? { STEPS: 56, LITE: '' } : { STEPS: 76 },
      depthFunc: THREE.AlwaysDepth,
    }),
  );
  hole.frustumCulled = false;
  hole.renderOrder = -1;
  scene.add(hole);

  const dustCount = lite ? 240 : 420;
  const dRad = new Float32Array(dustCount);
  const dAng = new Float32Array(dustCount);
  const dLift = new Float32Array(dustCount);
  const dSeed = new Float32Array(dustCount);
  for (let i = 0; i < dustCount; i++) {
    const thin = i % 5 !== 0;
    dRad[i] = 3.2 + Math.pow(Math.random(), 1.3) * (thin ? 10 : 15);
    dAng[i] = Math.random() * Math.PI * 2;
    dLift[i] = (Math.random() - 0.5) * (thin ? dRad[i] * 0.06 : dRad[i] * 0.55);
    dSeed[i] = Math.random();
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(dustCount * 3), 3));
  dustGeo.setAttribute('aRadius', new THREE.BufferAttribute(dRad, 1));
  dustGeo.setAttribute('aAngle', new THREE.BufferAttribute(dAng, 1));
  dustGeo.setAttribute('aLift', new THREE.BufferAttribute(dLift, 1));
  dustGeo.setAttribute('aSeed', new THREE.BufferAttribute(dSeed, 1));
  const dustUniforms = {
    uTime: { value: 0 },
    uDive: { value: 0 },
    uSize: { value: 8 },
    uPixelRatio: { value: ratio },
    uDiskN: { value: diskN },
    uDiskU: { value: diskU },
    uDiskV: { value: diskV },
    uWarpBeta: warpBeta,
    uWarpCenter: warpCenter,
    uWarpScale: warpScale,
    uDustAlpha: { value: 0 },
    uHoleTheme: { value: 0 },
  };
  const dust = new THREE.Points(
    dustGeo,
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

  // ---- 灯光 ----
  const skyLight = new THREE.HemisphereLight(0x7088ba, 0x0b101d, 0.85);
  skyLight.layers.enable(IMAGE_LAYER);
  scene.add(skyLight);

  const diskLight = new THREE.PointLight(0xffcf9a, 2.5, 0, 0);
  diskLight.layers.enable(IMAGE_LAYER);
  scene.add(diskLight);

  const shipLight = new THREE.DirectionalLight(0xffffff, 0.85);
  shipLight.position.set(14, 26, 20);
  scene.add(shipLight);

  // ---- 斯隆长城星图 + 连续巡航赛道 + 藏品世界 ----
  const starMap = buildStarMap(lite);
  starMap.group.scale.setScalar(COSMOS_SCALE);
  starMap.setOpacity(1, 0, ratio);
  scene.add(starMap.group);

  const track = buildCosmicTrack();
  scene.add(track.railsGroup);

  const world = buildCosmicWorld(track, lite);
  scene.add(world.group);
  const totalAtlas = world.catalog.length;

  // ---- 精细化飞船（纯外观选择，功能完全一致） ----
  const savedShipId = localStorage.getItem(SHIP_KEY);
  let selectedShip: ShipSpec = SHIPS.find((s) => s.id === savedShipId) ?? SHIPS[0];
  let ship: ShipModel = buildShip(selectedShip);
  ship.root.scale.setScalar(SHIP_SCALE);
  scene.add(ship.root, ship.trail);

  // ---- 速度线 ----
  const streakN = lite ? 110 : 220;
  const streakSeed = new Float32Array(streakN * 3);
  for (let i = 0; i < streakN; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 1.6 + Math.pow(Math.random(), 0.75) * 5.6;
    streakSeed[i * 3] = Math.cos(a) * r;
    streakSeed[i * 3 + 1] = Math.sin(a) * r;
    streakSeed[i * 3 + 2] = -Math.random() * 55;
  }
  const streakArr = new Float32Array(streakN * 6);
  const streakGeo = new THREE.BufferGeometry();
  streakGeo.setAttribute('position', new THREE.BufferAttribute(streakArr, 3));
  const streakMat = new THREE.LineBasicMaterial({
    color: 0xc8e4ff,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const streaks = new THREE.LineSegments(streakGeo, streakMat);
  streaks.frustumCulled = false;
  camera.add(streaks);

  // ---- 游戏状态 ----
  let state: GameState = 'ready';
  let stateBeforeAtlas: GameState = 'playing';

  let bestCollected = Number(localStorage.getItem(BEST_KEY) || 0) || 0;
  let trackS = 0;
  let laneX = 0;
  let laneY = 0;
  let velX = 0;
  let velY = 0;
  let bankRoll = 0;
  let pitchTilt = 0;
  let trackSpeed = BASE_SPEED;
  let warpEnergy = 1;
  let slingshotCount = 0;
  let slingshotTimer = 0;
  let escapeCarry = 0;
  let isWarpHeld = false;
  let camLock = 0;
  let ringToneIndex = 0;
  let elapsed = 0;
  let simTime = 0;
  let lastTheme = -1;

  const litGalaxies = new Set<string>();
  const collectedIds = new Set<string>();
  const slingshotSeen = new Set<string>();

  const trackSample: TrackSample = {
    u: 0,
    s: 0,
    pos: new THREE.Vector3(),
    forward: new THREE.Vector3(),
    right: new THREE.Vector3(),
    up: new THREE.Vector3(),
  };
  const lookSample: TrackSample = {
    u: 0,
    s: 0,
    pos: new THREE.Vector3(),
    forward: new THREE.Vector3(),
    right: new THREE.Vector3(),
    up: new THREE.Vector3(),
  };

  const shipPos = new THREE.Vector3();
  const camGoal = new THREE.Vector3();
  const camLook = new THREE.Vector3();
  const tmpA = new THREE.Vector3();
  const tmpB = new THREE.Vector3();
  const basisMat = new THREE.Matrix4();
  const qBase = new THREE.Quaternion();
  const qBank = new THREE.Quaternion();
  const qPitch = new THREE.Quaternion();
  const axisZ = new THREE.Vector3(0, 0, 1);
  const axisX = new THREE.Vector3(1, 0, 0);

  // ---- 播报队列 ----
  interface ToastItem {
    el: HTMLElement;
    until: number;
    leaving: boolean;
  }
  const toasts: ToastItem[] = [];

  function layoutToasts() {
    toasts.forEach((item, idx) => item.el.style.setProperty('--row', String(idx)));
  }

  function pushToast(text: string, iconSvg = '', duration = 2.4) {
    const el = document.createElement('p');
    el.className = 'roam__toast';
    if (iconSvg) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('aria-hidden', 'true');
      svg.classList.add('roam__toast-icon');
      svg.innerHTML = iconSvg;
      el.appendChild(svg);
    }
    const span = document.createElement('span');
    span.textContent = text;
    el.appendChild(span);

    if (toasts.length >= 3) {
      toasts.shift()?.el.remove();
    }
    scopeTree(el);
    toastsEl.appendChild(el);
    toasts.push({ el, until: performance.now() + duration * 1000, leaving: false });
    layoutToasts();
    requestAnimationFrame(() => el.setAttribute('data-show', '1'));
  }

  function tickToasts(now: number) {
    let changed = false;
    for (let i = toasts.length - 1; i >= 0; i--) {
      const item = toasts[i];
      if (!item.leaving && now >= item.until) {
        item.leaving = true;
        item.el.removeAttribute('data-show');
        item.el.setAttribute('data-leave', '1');
        window.setTimeout(() => {
          const idx = toasts.indexOf(item);
          if (idx >= 0) {
            toasts.splice(idx, 1);
            layoutToasts();
          }
          item.el.remove();
        }, 280);
        changed = true;
      }
    }
    if (changed) layoutToasts();
  }

  // ---- 选船按钮（仅颜色与名称） ----
  function renderShipPicks() {
    picksEl.innerHTML = '';
    for (const spec of SHIPS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'roam__pick';
      btn.setAttribute('aria-pressed', String(spec.id === selectedShip.id));

      const swatches = document.createElement('span');
      swatches.className = 'roam__pick-swatches';
      for (const hex of spec.swatches) {
        const dot = document.createElement('i');
        dot.style.background = hex;
        swatches.appendChild(dot);
      }
      const name = document.createElement('strong');
      name.textContent = spec.name;

      btn.append(swatches, name);
      scopeTree(btn);
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        (e.currentTarget as HTMLElement).blur();
        if (spec.id === selectedShip.id) return;
        selectedShip = spec;
        localStorage.setItem(SHIP_KEY, spec.id);
        rebuildShip();
        renderShipPicks();
        applyAccent(selectedShip.accent);
      });
      picksEl.appendChild(btn);
    }
  }

  function rebuildShip() {
    const prevPos = ship.root.position.clone();
    const prevRot = ship.root.quaternion.clone();
    scene.remove(ship.root, ship.trail);
    ship.dispose();
    ship = buildShip(selectedShip);
    ship.root.scale.setScalar(SHIP_SCALE);
    ship.root.position.copy(prevPos);
    ship.root.quaternion.copy(prevRot);
    ship.resetTrail();
    scene.add(ship.root, ship.trail);
  }

  function applyAccent(hex: string) {
    root.style.setProperty('--hud-accent', hex);
  }

  // ---- 星海图鉴弹窗（双列紧凑卡片，集齐区域打勾，不撑破容器） ----
  function renderAtlasModal() {
    atlasListEl.innerHTML = '';

    const groups = new Map<string, { title: string; color: string; items: AtlasItemSpec[] }>();
    for (const item of world.catalog) {
      let g = groups.get(item.regionId);
      if (!g) {
        g = { title: item.regionName, color: item.color, items: [] };
        groups.set(item.regionId, g);
      }
      g.items.push(item);
    }

    for (const [regionId, group] of groups) {
      const got = group.items.filter((i) => collectedIds.has(i.id)).length;
      const done = got >= group.items.length;

      const card = document.createElement('section');
      card.className = done ? 'roam__atlas-group is-complete' : 'roam__atlas-group';
      card.style.setProperty('--group-accent', group.color);

      const head = document.createElement('header');
      head.className = 'roam__atlas-head';
      const title = document.createElement('strong');
      title.textContent = regionId === 'cosmos' ? group.title : `${group.title}星系`;
      const stat = document.createElement('span');
      stat.className = 'roam__atlas-stat';
      stat.textContent = `${got} / ${group.items.length}`;
      if (done) {
        const chk = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        chk.setAttribute('viewBox', '0 0 16 16');
        chk.setAttribute('aria-hidden', 'true');
        chk.classList.add('roam__atlas-check');
        chk.innerHTML = '<path d="M3 8.5l3.2 3.2L13 4.5" />';
        stat.prepend(chk);
      }
      head.append(title, stat);

      const grid = document.createElement('ul');
      grid.className = 'roam__atlas-items';
      for (const item of group.items) {
        const li = document.createElement('li');
        const found = collectedIds.has(item.id);
        li.className = found ? 'is-found' : 'is-hidden';
        li.title = item.hint;
        const mark = document.createElement('i');
        mark.setAttribute('aria-hidden', 'true');
        const nm = document.createElement('span');
        nm.textContent = found ? item.name : item.hint;
        const modelSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        modelSvg.setAttribute('viewBox', '0 0 28 28');
        modelSvg.setAttribute('aria-hidden', 'true');
        modelSvg.classList.add('roam__atlas-model');
        modelSvg.innerHTML = getAtlasModelSvg(item.regionId);
        li.append(mark, nm, modelSvg);
        grid.appendChild(li);
      }

      card.append(head, grid);
      scopeTree(card);
      atlasListEl.appendChild(card);
    }
  }

  function toggleAtlas() {
    if (state === 'ready' || state === 'finished') return;
    if (state === 'atlas') {
      state = stateBeforeAtlas;
      audio.setPaused(state !== 'playing');
      syncOverlay();
    } else {
      stateBeforeAtlas = state;
      state = 'atlas';
      audio.setPaused(true);
      renderAtlasModal();
      syncOverlay();
    }
  }

  // ---- 状态同步 ----
  function syncOverlay() {
    root.dataset.state = state;
    pauseBtn.setAttribute('aria-pressed', String(state === 'paused'));
    readyBox.hidden = state !== 'ready';
    pauseHint.hidden = state !== 'paused';
    atlasDialog.hidden = state !== 'atlas';
    finishModal.hidden = state !== 'finished';

    if (state === 'finished') {
      statRelics.textContent = `${collectedIds.size} / ${totalAtlas}`;
      statLit.textContent = `${litGalaxies.size} / ${STAR_NODES.length}`;
      statSlings.textContent = String(slingshotCount);
      statTime.textContent = formatClock(elapsed);
    }
  }

  function placeShipFromTrack(dt: number, animate = true) {
    track.sampleAtS(trackS, trackSample);
    shipPos
      .copy(trackSample.pos)
      .addScaledVector(trackSample.right, laneX)
      .addScaledVector(trackSample.up, laneY);

    ship.root.position.copy(shipPos);

    // 局部 -Z 沿 forward，+Y 沿 trackSample.up，+X 沿 trackSample.right
    basisMat.makeBasis(trackSample.right, trackSample.up, tmpA.copy(trackSample.forward).negate());
    qBase.setFromRotationMatrix(basisMat);
    qBank.setFromAxisAngle(axisZ, bankRoll);
    qPitch.setFromAxisAngle(axisX, pitchTilt);
    ship.root.quaternion.copy(qBase).multiply(qBank).multiply(qPitch);

    const boostFactor = clamp01((trackSpeed - BASE_SPEED) / 18);
    ship.updateVisuals(simTime, animate ? dt : 0, boostFactor);
    ship.updateTrail(animate ? dt : 0, boostFactor);

    if (animate) {
      // 微粒飞船贴尾与超广角宏大视角；黑洞引力弹弓期间视角居中锁定中轴航线，稳住构图
      camGoal
        .copy(shipPos)
        .addScaledVector(trackSample.forward, -1.42)
        .addScaledVector(trackSample.up, 0.4);
      tmpA
        .copy(trackSample.pos)
        .addScaledVector(trackSample.forward, -1.62)
        .addScaledVector(trackSample.up, 0.38);
      camGoal.lerp(tmpA, camLock);
      camera.position.lerp(camGoal, 1 - Math.exp(-(6.5 + camLock * 6.5) * dt));

      track.sampleAtS(Math.min(trackS + 68, track.totalLength), lookSample);
      const lookFreeScale = (1 - camLock) * 0.35;
      camLook
        .copy(lookSample.pos)
        .addScaledVector(lookSample.right, laneX * lookFreeScale)
        .addScaledVector(lookSample.up, laneY * lookFreeScale);
      camera.lookAt(camLook);

      const targetFov = BASE_FOV + boostFactor * 10 + camLock * 4;
      if (Math.abs(camera.fov - targetFov) > 0.05) {
        camera.fov += (targetFov - camera.fov) * Math.min(dt * 8, 1);
        camera.updateProjectionMatrix();
      }
    }
  }

  function resetRun() {
    trackS = 0;
    laneX = 0;
    laneY = 0;
    velX = 0;
    velY = 0;
    bankRoll = 0;
    pitchTilt = 0;
    trackSpeed = BASE_SPEED;
    warpEnergy = 1;
    slingshotCount = 0;
    slingshotTimer = 0;
    escapeCarry = 0;
    isWarpHeld = false;
    camLock = 0;
    ringToneIndex = 0;
    elapsed = 0;
    lastTheme = -1;
    litGalaxies.clear();
    collectedIds.clear();
    slingshotSeen.clear();
    world.resetProgress();

    placeShipFromTrack(0, false);
    ship.resetTrail();
    track.sampleAtS(0, trackSample);
    camera.position
      .copy(shipPos)
      .addScaledVector(trackSample.forward, -1.42)
      .addScaledVector(trackSample.up, 0.4);
    track.sampleAtS(68, lookSample);
    camera.lookAt(lookSample.pos);
    camera.fov = BASE_FOV;
    camera.updateProjectionMatrix();

    applyAccent(selectedShip.accent);
    updateHUD();
  }

  function startRun() {
    if (!readyToPlay) {
      pendingStart = true;
      return;
    }
    (document.activeElement as HTMLElement | null)?.blur?.();
    audio.unlock();
    if (state === 'ready' || state === 'finished') {
      resetRun();
      pushToast('进入斯隆长城巡航航道', ICONS.star, 2.2);
    }
    state = 'playing';
    audio.setPaused(false);
    syncOverlay();
  }

  function togglePause() {
    if (state === 'atlas') {
      toggleAtlas();
      return;
    }
    if (state === 'playing') {
      state = 'paused';
      audio.setPaused(true);
      syncOverlay();
    } else if (state === 'paused') {
      state = 'playing';
      audio.unlock();
      audio.setPaused(false);
      syncOverlay();
    }
  }

  function finishRun() {
    state = 'finished';
    if (collectedIds.size > bestCollected) {
      bestCollected = collectedIds.size;
      localStorage.setItem(BEST_KEY, String(bestCollected));
    }
    audio.finish(true);
    updateRecordText();
    syncOverlay();
  }

  function recordCollection(id: string) {
    collectedIds.add(id);
    if (collectedIds.size > bestCollected) {
      bestCollected = collectedIds.size;
      localStorage.setItem(BEST_KEY, String(bestCollected));
      updateRecordText();
    }
  }

  function updateRecordText() {
    recordValEl.textContent = `${bestCollected} / ${totalAtlas}`;
  }

  // ---- 输入控制 ----
  const keys = new Set<string>();
  let stickSteerX = 0;
  let stickSteerY = 0;
  let touchBoost = false;
  let stickId: number | null = null;
  let stickOriginX = 0;
  let stickOriginY = 0;

  function updateKeyVisuals() {
    const left = keys.has('ArrowLeft') || keys.has('KeyA');
    const right = keys.has('ArrowRight') || keys.has('KeyD');
    const up = keys.has('ArrowUp') || keys.has('KeyW');
    const down = keys.has('ArrowDown') || keys.has('KeyS');
    const boost = keys.has('Space') || keys.has('ShiftLeft') || keys.has('ShiftRight') || touchBoost;
    keyL?.classList.toggle('is-on', left);
    keyR?.classList.toggle('is-on', right);
    keyU?.classList.toggle('is-on', up);
    keyD?.classList.toggle('is-on', down);
    keyA?.classList.toggle('is-on', boost);
    keyB?.classList.toggle('is-on', keys.has('KeyG'));
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.repeat) return;
    if (e.code === 'KeyP') {
      e.preventDefault();
      togglePause();
      return;
    }
    if (e.code === 'KeyG') {
      e.preventDefault();
      toggleAtlas();
      return;
    }
    if (e.code === 'Escape' && state === 'atlas') {
      e.preventDefault();
      toggleAtlas();
      return;
    }
    if (e.code === 'KeyM') {
      e.preventDefault();
      const next = !audio.isMuted();
      audio.setMuted(next);
      muteBtn.setAttribute('aria-pressed', String(!next));
      return;
    }
    if ((e.code === 'Space' || e.code === 'Enter') && (state === 'ready' || state === 'finished')) {
      e.preventDefault();
      startRun();
      return;
    }
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
      e.preventDefault();
    }
    keys.add(e.code);
    updateKeyVisuals();
  };

  const onKeyUp = (e: KeyboardEvent) => {
    keys.delete(e.code);
    updateKeyVisuals();
  };

  const onStageClick = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, a')) return;
    if (state === 'ready' || state === 'finished') {
      startRun();
    } else if (state === 'paused') {
      togglePause();
    }
  };

  const onPointerDown = (e: PointerEvent) => {
    if (state !== 'playing' || !touch) return;
    const rect = stage.getBoundingClientRect();
    const relX = e.clientX - rect.left;
    if (relX > rect.width * 0.56 || stickId !== null) return;
    if ((e.target as HTMLElement).closest('button, a')) return;
    stickId = e.pointerId;
    stickOriginX = e.clientX;
    stickOriginY = e.clientY;
    stickEl.style.left = `${relX}px`;
    stickEl.style.top = `${e.clientY - rect.top}px`;
    stickEl.setAttribute('data-on', '1');
    knobEl.style.transform = 'translate(-50%, -50%)';
    stage.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: PointerEvent) => {
    if (e.pointerId !== stickId) return;
    const dx = e.clientX - stickOriginX;
    const dy = e.clientY - stickOriginY;
    const maxR = 46;
    const len = Math.hypot(dx, dy);
    const scale = len > maxR ? maxR / len : 1;
    const cx = dx * scale;
    const cy = dy * scale;
    knobEl.style.transform = `translate(calc(-50% + ${cx}px), calc(-50% + ${cy}px))`;
    stickSteerX = Math.abs(cx) < 5 ? 0 : cx / maxR;
    stickSteerY = Math.abs(cy) < 5 ? 0 : -cy / maxR;
  };

  const clearStick = (e: PointerEvent) => {
    if (e.pointerId !== stickId) return;
    stickId = null;
    stickSteerX = 0;
    stickSteerY = 0;
    stickEl.removeAttribute('data-on');
    try {
      stage.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  const onTurboDown = (e: PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    touchBoost = true;
    turboBtn.classList.add('is-on');
    updateKeyVisuals();
  };
  const onTurboUp = (e: PointerEvent) => {
    e.stopPropagation();
    touchBoost = false;
    turboBtn.classList.remove('is-on');
    updateKeyVisuals();
  };

  const onMute = (e: MouseEvent) => {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).blur();
    const next = !audio.isMuted();
    audio.setMuted(next);
    muteBtn.setAttribute('aria-pressed', String(!next));
  };
  const onPause = (e: MouseEvent) => {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).blur();
    togglePause();
  };
  const onAtlasClick = (e: MouseEvent) => {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).blur();
    toggleAtlas();
  };

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  stage.addEventListener('click', onStageClick);
  stage.addEventListener('pointerdown', onPointerDown);
  stage.addEventListener('pointermove', onPointerMove);
  stage.addEventListener('pointerup', clearStick);
  stage.addEventListener('pointercancel', clearStick);
  turboBtn.addEventListener('pointerdown', onTurboDown);
  turboBtn.addEventListener('pointerup', onTurboUp);
  turboBtn.addEventListener('pointercancel', onTurboUp);
  muteBtn.addEventListener('click', onMute);
  pauseBtn.addEventListener('click', onPause);
  atlasBtn.addEventListener('click', onAtlasClick);
  atlasCloseBtn.addEventListener('click', onAtlasClick);

  function behindHole(p: THREE.Vector3, r: number) {
    const toHole = tmpA.copy(holeCenter).sub(camera.position);
    const holeDist = toHole.length();
    if (holeDist < 1e-4) return false;
    toHole.divideScalar(holeDist);
    const toP = tmpB.copy(p).sub(camera.position);
    const along = toP.dot(toHole);
    if (along <= holeDist) return false;
    const perp = toP.addScaledVector(toHole, -along).length();
    return perp < r + (holeUniforms.uHoleScale.value || 1) * 1.4;
  }

  function drawRush(factor: number, isSling: boolean) {
    if (!rushCtx) return;
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    if (w < 8 || h < 8) return;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    if (rushCanvas.width !== Math.round(w * dpr) || rushCanvas.height !== Math.round(h * dpr)) {
      rushCanvas.width = Math.round(w * dpr);
      rushCanvas.height = Math.round(h * dpr);
    }
    rushCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    rushCtx.clearRect(0, 0, w, h);
    if (factor < 0.08 || still) return;

    const cx = w * 0.5;
    const cy = h * 0.5;
    const diag = Math.hypot(cx, cy);
    const n = Math.round((lite ? 14 : 24) * clamp01(factor));
    rushCtx.strokeStyle = isSling ? 'rgba(130, 232, 255, 0.55)' : 'rgba(255, 224, 178, 0.34)';
    rushCtx.lineWidth = isSling ? 1.5 : 1.0;

    for (let i = 0; i < n; i++) {
      const a = (i * 2.39996 + simTime * 4.5) % (Math.PI * 2);
      const inner = diag * (0.44 + ((i * 17) % 10) * 0.025);
      const outer = inner + diag * (0.14 + factor * 0.22);
      rushCtx.beginPath();
      rushCtx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
      rushCtx.lineTo(cx + Math.cos(a) * outer, cy + Math.sin(a) * outer);
      rushCtx.stroke();
    }
  }

  function updateHUD() {
    const progress = clamp01(trackS / track.totalLength);
    progressBar.style.transform = `scaleX(${Math.max(0.015, progress)})`;
    relicsEl.textContent = `${collectedIds.size}/${totalAtlas}`;

    const prox = track.evaluateHub(shipPos);
    if (prox.alpha > 0.25) {
      sectorEl.textContent = `${prox.node.name}星域`;
    } else {
      sectorEl.textContent = '斯隆长城';
    }

    const nextMs = track.milestones.find((m) => m.s > trackS);
    if (nextMs) {
      const rem = Math.max(0, nextMs.s - trackS);
      teleNext.textContent = `${nextMs.node.name} · ${(rem / COSMOS_SCALE).toFixed(0)} Mpc`;
    } else {
      const rem = Math.max(0, track.totalLength - trackS);
      teleNext.textContent = `终点 · ${(rem / COSMOS_SCALE).toFixed(0)} Mpc`;
    }

    warpBar.style.transform = `scaleX(${clamp01(warpEnergy)})`;
    warpNum.textContent = `${Math.round(warpEnergy * 100)}%`;
    const isSling = slingshotTimer > 0;
    teleBox.dataset.mode = isSling ? 'sling' : 'cruise';
    teleModeEl.textContent = isSling ? 'GRAV-ASSIST' : isWarpHeld ? 'WARP' : 'CRUISE';
    teleSpeed.textContent = `${(trackSpeed * 1.1).toFixed(1)} c`;
  }

  function syncSize() {
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    if (w < 8 || h < 8) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    holeUniforms.uAspect.value = w / h;
  }
  const resizeObserver = new ResizeObserver(syncSize);
  resizeObserver.observe(stage);
  syncSize();

  let readyToPlay = false;
  let pendingStart = false;
  let loadPct = 0.18;

  function setLoadProgress(p: number) {
    loadPct = Math.max(loadPct, clamp01(p));
    loaderBarEl.style.transform = `scaleX(${loadPct.toFixed(3)})`;
    loaderPctEl.textContent = `${Math.round(loadPct * 100)}%`;
  }

  renderShipPicks();
  updateRecordText();
  applyAccent(selectedShip.accent);
  syncOverlay();
  setLoadProgress(0.28);

  let raf = 0;
  let last = performance.now();
  let miniAt = 0;
  let frames = 0;
  let spent = 0;
  let longFrame = false;
  let ceiling = maxRatio;
  let disposed = false;
  let warmupTimer = 0;

  const finishWarmup = () => {
    if (disposed) return;
    setLoadProgress(1);
    readyToPlay = true;
    loaderEl.setAttribute('data-done', '1');
    window.setTimeout(() => {
      if (!disposed) loaderEl.hidden = true;
    }, 320);
    if (pendingStart && state === 'ready') {
      pendingStart = false;
      startRun();
    }
  };

  // 先等首屏核心着色器异步编译完成再开动画循环，避免首帧同步编译锁死页面；
  // 重型星域地标则在首屏亮出后后台分批挂载与预编译
  const begin = () => {
    if (disposed) return;
    setLoadProgress(0.68);
    last = performance.now();
    raf = requestAnimationFrame(frame);
    warmupTimer = window.setTimeout(() => {
      if (disposed) return;
      world.attachLandmarks(IMAGE_LAYER);
      setLoadProgress(0.86);
      renderer.compileAsync(scene, camera).then(finishWarmup, finishWarmup);
    }, 220);
  };
  setLoadProgress(0.45);
  renderer.compileAsync(scene, camera).then(begin, begin);

  function updateStreaks3D(beta: number, dt: number) {
    if (beta <= 0.01 && streakMat.opacity === 0) return;
    const spd = 24 + beta * 240;
    const len = 0.6 + beta * 8.5;
    for (let i = 0; i < streakN; i++) {
      let z = streakSeed[i * 3 + 2] + spd * dt;
      if (z > -0.5) z -= 55;
      streakSeed[i * 3 + 2] = z;
      const x = streakSeed[i * 3];
      const y = streakSeed[i * 3 + 1];
      const b = i * 6;
      streakArr[b] = x;
      streakArr[b + 1] = y;
      streakArr[b + 2] = z;
      streakArr[b + 3] = x;
      streakArr[b + 4] = y;
      streakArr[b + 5] = z - len;
    }
    streakGeo.attributes.position.needsUpdate = true;
    streakMat.opacity = Math.min(beta * 0.55, 0.42);
  }

  function stepPlaying(dt: number) {
    elapsed += dt;

    const steerLeft = keys.has('ArrowLeft') || keys.has('KeyA');
    const steerRight = keys.has('ArrowRight') || keys.has('KeyD');
    const steerUp = keys.has('ArrowUp') || keys.has('KeyW');
    const steerDown = keys.has('ArrowDown') || keys.has('KeyS');

    let inX = (steerRight ? 1 : 0) - (steerLeft ? 1 : 0);
    let inY = (steerUp ? 1 : 0) - (steerDown ? 1 : 0);
    if (Math.abs(stickSteerX) > 0.01) inX = stickSteerX;
    if (Math.abs(stickSteerY) > 0.01) inY = stickSteerY;

    const wantBoost = keys.has('Space') || keys.has('ShiftLeft') || keys.has('ShiftRight') || touchBoost;
    const isBoosting = wantBoost && warpEnergy > 0.02;
    isWarpHeld = isBoosting;

    // 真实开普勒引力弹弓 + 奥伯特近心机动（以黑洞最近点 ms.s 为势阱零点，划分：势能落入归中 -> 近心点奥伯特爆发 -> 双曲线逃逸余速滑行）
    const activeMs = track.milestones.find((m) => trackS >= m.s - 95 && trackS <= m.s + 105);
    const inGravWell = !!activeMs;
    let dsPeri = 0;
    let guideLock = 0;
    let gravBoost = 0;

    if (activeMs) {
      dsPeri = trackS - activeMs.s;
      const enterLock = clamp01((dsPeri + 95) / 42);
      const exitLock = clamp01((88 - dsPeri) / 48);
      guideLock = enterLock * exitLock;

      // 引力势阱下落 (1/sqrt(r)) + 近心点奥伯特爆发 + 离境双曲线余速延续
      const infallGain = dsPeri <= 0 ? Math.pow(clamp01((dsPeri + 95) / 95), 1.45) * 14.0 : 14.0 * clamp01((90 - dsPeri) / 90);
      const oberthPeak = Math.exp(-Math.pow((dsPeri - 2) / 18, 2)) * 7.5;
      gravBoost = Math.max(infallGain, 0) + oberthPeak;

      if (dsPeri >= -20 && dsPeri <= 28 && !slingshotSeen.has(activeMs.node.id)) {
        slingshotSeen.add(activeMs.node.id);
        slingshotCount++;
        warpEnergy = Math.min(1, warpEnergy + 0.45);
        audio.slingshot();
        pushToast(`近心点奥伯特加速 · ${activeMs.node.name}引力弹弓`, ICONS.sling, 2.5);
      }

      if (dsPeri >= 6 && dsPeri <= 52) {
        escapeCarry = Math.max(escapeCarry, 12.5);
      }
      slingshotTimer = guideLock > 0.05 ? 0.2 : 0;
    } else {
      slingshotTimer = 0;
    }

    if (dsPeri > 52 || !inGravWell) {
      escapeCarry *= Math.exp(-0.24 * dt);
      if (escapeCarry < 0.08) escapeCarry = 0;
    }

    if (isBoosting && !inGravWell) {
      warpEnergy = Math.max(0, warpEnergy - 0.24 * dt);
    } else {
      warpEnergy = Math.min(1, warpEnergy + (inGravWell ? 0.22 : 0.14) * dt);
    }

    // 视角锁定权重：进入黑洞引力井即柔和固定居中视角，离开时缓慢交还
    camLock += (guideLock - camLock) * (1 - Math.exp(-5.8 * dt));

    // 宽幅且从容的星际巡航惯性；黑洞牵引锁定时接管并先将飞船柔和拉回中轴航线
    const freeControl = 1 - guideLock;
    const targetVelX = inX * 10.6 * freeControl;
    const targetVelY = inY * 6.8 * freeControl;
    const steerBlend = 1 - Math.exp(-3.8 * dt);
    velX += (targetVelX - velX) * steerBlend;
    velY += (targetVelY - velY) * steerBlend;

    laneX += velX * dt;
    laneY += velY * dt;

    if (guideLock > 0.01) {
      const pull = 1 - Math.exp(-5.4 * dt * guideLock);
      const prevX = laneX;
      laneX *= 1 - pull;
      laneY *= 1 - pull;
      velX *= 1 - pull;
      velY *= 1 - pull;
      const pullRateX = (laneX - prevX) / Math.max(dt, 1e-4);
      const tiltBlend = 1 - Math.exp(-5.2 * dt);
      const targetBank = THREE.MathUtils.clamp(-pullRateX * 0.025, -0.28, 0.28) * (1 - clamp01((dsPeri + 95) / 60) * 0.85);
      bankRoll += (targetBank - bankRoll) * tiltBlend;
      pitchTilt += (0 - pitchTilt) * tiltBlend;
    } else {
      if (laneX > 14.2) {
        laneX = 14.2;
        if (velX > 0) velX = 0;
      } else if (laneX < -14.2) {
        laneX = -14.2;
        if (velX < 0) velX = 0;
      }

      if (laneY > 6.6) {
        laneY = 6.6;
        if (velY > 0) velY = 0;
      } else if (laneY < -6.6) {
        laneY = -6.6;
        if (velY < 0) velY = 0;
      }

      const tiltBlend = 1 - Math.exp(-4.6 * dt);
      bankRoll += ((-velX / 10.6) * 0.42 - bankRoll) * tiltBlend;
      pitchTilt += ((velY / 6.8) * 0.22 - pitchTilt) * tiltBlend;
    }

    const totalBoost = Math.max(gravBoost, escapeCarry);
    const targetSpeed = Math.min(BASE_SPEED + (isBoosting ? 16.0 : 0) + totalBoost, 52);
    trackSpeed += (targetSpeed - trackSpeed) * Math.min(dt * (inGravWell ? 3.5 : 4.2), 1);
    trackS = Math.min(trackS + trackSpeed * dt, track.totalLength);

    placeShipFromTrack(dt, true);

    const prox = track.evaluateHub(shipPos);

    // 曲速星门判定（穿门瞬间激发传送门能量激波特效）
    for (const g of world.gates) {
      if (g.triggered) continue;
      if (Math.abs(g.s - trackS) < 10.5 && shipPos.distanceTo(g.pos) < g.radius) {
        world.triggerGate(g, simTime);
        warpEnergy = Math.min(1, warpEnergy + 0.3);
        trackSpeed = Math.min(trackSpeed + 6.5, 52);
        ringToneIndex = (ringToneIndex + 1) % 7;
        audio.ring(ringToneIndex + 1);
      }
    }

    // 藏品收录判定：黑洞引力井牵引或高速滑行期间自动卷吸航线周边藏品
    const inSlingshot = inGravWell && guideLock > 0.25;
    const pullBlend = inSlingshot ? 1 - Math.exp(-11 * dt) : 0;
    for (const rel of world.collectibles) {
      if (rel.collected) continue;
      const ds = rel.s - trackS;
      const dist = shipPos.distanceTo(rel.pos);
      if (inSlingshot && ds >= -18 && ds <= 56 && dist < 38) {
        rel.group.position.lerp(shipPos, pullBlend);
      }
      const hit =
        (Math.abs(ds) < 12.0 && dist < 8.4) ||
        (inSlingshot && Math.abs(ds) < 15.0 && dist < 24.0);
      if (hit) {
        rel.collected = true;
        rel.group.visible = false;
        recordCollection(rel.spec.id);
        warpEnergy = Math.min(1, warpEnergy + 0.28);

        let hubComplete = false;
        if (rel.spec.regionId !== 'cosmos') {
          const regionItems = world.collectibles.filter((c) => c.spec.regionId === rel.spec.regionId);
          const gotInRegion = regionItems.filter((c) => c.collected).length;
          if (gotInRegion >= regionItems.length) {
            litGalaxies.add(rel.spec.regionId);
            hubComplete = true;
            pushToast(`${rel.spec.regionName}星域已点亮！（${gotInRegion}/${regionItems.length}）`, ICONS.star, 2.8);
          } else {
            pushToast(`已收录 · ${rel.spec.name}`, ICONS.relic, 2.1);
          }
          audio.relic(gotInRegion, hubComplete);
        } else {
          pushToast(`已收录 · ${rel.spec.name}`, ICONS.relic, 2.2);
          audio.relic(collectedIds.size, false);
        }
      }
    }

    audio.updatePad(prox.alpha > 0.25, clamp01((trackSpeed - BASE_SPEED) / 18));

    if (trackS >= track.totalLength) {
      finishRun();
    }
  }

  function frame() {
    raf = requestAnimationFrame(frame);
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.05);
    spent += now - last;
    const frameStart = last;
    last = now;

    if (!still && state !== 'paused' && state !== 'atlas') {
      simTime += dt;
      holeUniforms.uTime.value = simTime;
      dustUniforms.uTime.value = simTime;
    }

    if (state === 'playing') {
      stepPlaying(dt);
    } else if (state === 'ready') {
      // 开场停在发车点前，缓慢旋转近距离展示精雕飞船、矢量喷口与等离子尾焰
      trackS = 0;
      laneX = 0;
      laneY = 0;
      placeShipFromTrack(0, false);
      const oa = simTime * 0.35;
      ship.root.rotateY(Math.sin(oa) * 0.25);
      ship.updateVisuals(simTime, dt, 0.14);
      ship.updateTrail(dt, 0.14);
      camera.position.set(
        shipPos.x + Math.sin(oa) * 1.48,
        shipPos.y + 0.42,
        shipPos.z + Math.cos(oa) * 1.48,
      );
      camera.lookAt(shipPos.x, shipPos.y - 0.04, shipPos.z);
    }

    camera.updateMatrixWorld();

    // 连续平滑切入最近星系黑洞（星系核辉光先行浮现，黑洞随接近缓缓凝结）
    const prox = track.evaluateHub(shipPos);
    const theme = prox.node.holeTheme ?? 0;
    const sc = (prox.node.holeScale ?? 1.85) * HOLE_SCALE_MULT;
    if (theme !== lastTheme) {
      lastTheme = theme;
      const [tx, tz] = prox.node.diskTilt ?? [0, 0];
      diskFrame(tx, tz, diskN, diskU, diskV);
      holeUniforms.uHoleTheme.value = theme;
      holeUniforms.uHoleScale.value = sc;
      dustUniforms.uHoleTheme.value = theme;
      warpScale.value = sc;
      if (state === 'playing') {
        applyAccent(prox.node.color);
      }
    }
    holeCenter.set(...prox.node.position).multiplyScalar(COSMOS_SCALE);
    warpCenter.value.copy(holeCenter);
    diskLight.position.copy(holeCenter);
    holeUniforms.uHoleAlpha.value = prox.alpha;
    holeUniforms.uNucleusGlow.value = prox.nucleusGlow;
    dustUniforms.uDustAlpha.value = prox.alpha;

    const beta = state === 'playing' ? clamp01((trackSpeed - 25.0) * 0.015 + (slingshotTimer > 0 ? 0.24 : 0)) : 0;
    warpBeta.value = beta;
    holeUniforms.uBeta.value = beta;
    holeUniforms.uCamPos.value.copy(camera.position);
    holeUniforms.uInvProj.value.copy(camera.projectionMatrixInverse);
    holeUniforms.uProjZ.value.set(camera.projectionMatrix.elements[10], camera.projectionMatrix.elements[14]);
    holeUniforms.uCamWorld.value.copy(camera.matrixWorld);

    const activeDt = state === 'playing' ? dt : 0;
    starMap.setOpacity(1, simTime, ratio);
    track.setTime(simTime);
    world.update(simTime, activeDt, trackS, prox.node, prox.alpha, diskN, diskU, diskV, behindHole);
    drawRush(state === 'playing' ? clamp01((trackSpeed - 31) / 16) : 0, slingshotTimer > 0);
    updateStreaks3D(beta, activeDt);
    tickToasts(now);
    if (state === 'playing') updateHUD();

    if (now - miniAt >= (lite ? 95 : 65)) {
      miniAt = now;
      renderMiniMap(miniCanvas, starMap.miniPoints, simTime, prox.alpha > 0.25 ? prox.node.id : null, {
        shipPos: { x: shipPos.x / COSMOS_SCALE, y: shipPos.y / COSMOS_SCALE, z: shipPos.z / COSMOS_SCALE },
        litIds: litGalaxies,
        trackPoints: track.miniPoints,
      });
    }

    renderer.render(scene, camera);

    if (now - frameStart > 100) longFrame = true;
    if (++frames === 40) {
      const avg = spent / frames;
      if (!longFrame) {
        let next = ratio;
        if (avg > 24.5) {
          ceiling = ratio - 0.05;
          next = ratio - 0.14;
        } else if (avg < 17.8) {
          next = Math.min(ratio + 0.08, ceiling);
        }
        const clamped = Math.min(Math.max(next, lite ? 0.5 : 0.65), maxRatio);
        if (Math.abs(clamped - ratio) > 0.01) {
          ratio = clamped;
          renderer.setPixelRatio(ratio);
          renderer.setSize(stage.clientWidth, stage.clientHeight, false);
          dustUniforms.uPixelRatio.value = ratio;
        }
      }
      frames = 0;
      spent = 0;
      longFrame = false;
    }
  }

  const onVisible = () => {
    if (document.visibilityState !== 'visible') return;
    frames = 0;
    spent = 0;
    longFrame = false;
    last = performance.now();
  };
  document.addEventListener('visibilitychange', onVisible);

  return () => {
    disposed = true;
    clearTimeout(warmupTimer);
    cancelAnimationFrame(raf);
    resizeObserver.disconnect();
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    stage.removeEventListener('click', onStageClick);
    stage.removeEventListener('pointerdown', onPointerDown);
    stage.removeEventListener('pointermove', onPointerMove);
    stage.removeEventListener('pointerup', clearStick);
    stage.removeEventListener('pointercancel', clearStick);
    turboBtn.removeEventListener('pointerdown', onTurboDown);
    turboBtn.removeEventListener('pointerup', onTurboUp);
    turboBtn.removeEventListener('pointercancel', onTurboUp);
    muteBtn.removeEventListener('click', onMute);
    pauseBtn.removeEventListener('click', onPause);
    atlasBtn.removeEventListener('click', onAtlasClick);
    atlasCloseBtn.removeEventListener('click', onAtlasClick);

    warpBeta.value = 0;
    warpImage.value = 0;
    warpCenter.value.set(0, 0, 0);
    warpScale.value = 1;

    audio.dispose();
    ship.dispose();
    world.dispose();
    track.dispose();
    starMap.dispose();
    dustGeo.dispose();
    streakGeo.dispose();
    hole.geometry.dispose();
    (hole.material as THREE.Material).dispose();
    (dust.material as THREE.Material).dispose();
    streakMat.dispose();
    renderer.dispose();
  };
}
