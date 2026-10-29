import * as THREE from 'three';
import { holeVertex, holeFragment, dustVertex, dustFragment } from './shaders';

interface DoorOptions {
  canvas: HTMLCanvasElement;
  // 点进黑洞之后去哪
  target: string;
  // 进度刻度：每个机位一个，当前机位加 data-active
  ticks: HTMLElement[];
  // 黑洞吞没画面时盖上来的那层
  veil: HTMLElement;
  // 标题文案只属于第一个机位，往后走就淡出，免得压在黑洞上
  copy: HTMLElement;
  onDive?: () => void;
}

// 机位：滚轮、拖动、方向键在这几个之间移动，中间连续插值，就是「移步换景」
interface Stop {
  pos: THREE.Vector3;
  look: THREE.Vector3;
  fov: number;
}

const STOPS: Stop[] = [
  { pos: new THREE.Vector3(2.5, 0.8, 19), look: new THREE.Vector3(-6, -1.4, 0), fov: 40 },
  { pos: new THREE.Vector3(-14, 5, 15), look: new THREE.Vector3(0, -0.5, 0), fov: 46 },
  { pos: new THREE.Vector3(1.5, 0.35, 12), look: new THREE.Vector3(0.6, 0.3, 0), fov: 58 },
];

// 吸积盘几乎侧对镜头，只抬一点点
const DISK_N = new THREE.Vector3(0, 1, 0.035).normalize();
const DISK_U = new THREE.Vector3(1, 0, 0);
const DISK_V = new THREE.Vector3().crossVectors(DISK_N, DISK_U).normalize();

const smooth = (t: number) => t * t * (3 - 2 * t);

export function supportsWebGL2(): boolean {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

export function mountDoor(options: DoorOptions): () => void {
  const { canvas, target, ticks, veil, copy } = options;

  // 手机和小屏：步数、粒子、分辨率都往下压，怎么简单怎么来
  const lite = matchMedia('(pointer: coarse)').matches || innerWidth < 768;
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, lite ? 1 : 1.5));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(STOPS[0].fov, 1, 0.1, 400);

  // 黑洞：全屏四边形，先画，后面的东西都盖在它上面
  const holeUniforms = {
    uCamPos: { value: new THREE.Vector3() },
    uInvProj: { value: new THREE.Matrix4() },
    uCamWorld: { value: new THREE.Matrix4() },
    uTime: { value: 0 },
    uHover: { value: 0 },
    uDive: { value: 0 },
    uDiskN: { value: DISK_N },
    uDiskU: { value: DISK_U },
    uDiskV: { value: DISK_V },
  };
  const hole = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({
      vertexShader: holeVertex,
      fragmentShader: holeFragment,
      uniforms: holeUniforms,
      defines: { STEPS: lite ? 110 : 220 },
      depthTest: false,
      depthWrite: false,
    }),
  );
  hole.frustumCulled = false;
  hole.renderOrder = -1;
  scene.add(hole);

  // 平台：两段圆柱叠出台面和护栏，几何体都是 three.js 自带的，不用建模
  const stone = new THREE.MeshStandardMaterial({ color: 0xc7cde0, roughness: 0.32, metalness: 0.05 });
  const platform = new THREE.Group();
  const deck = new THREE.Mesh(new THREE.CylinderGeometry(6, 5.4, 1.4, 96), stone);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(5.85, 0.16, 12, 128), stone);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.72;
  const pillar = new THREE.Mesh(new THREE.CylinderGeometry(4.6, 4.2, 9, 64), stone);
  pillar.position.y = -5.2;
  platform.add(deck, rim, pillar);
  platform.position.set(6.2, -4.1, 10.5);
  scene.add(platform);

  // 光从吸积盘那边来：冷色环境光打底，暖色平行光勾边
  scene.add(new THREE.HemisphereLight(0x5a6fa8, 0x0a0f22, 1.1));
  const diskLight = new THREE.DirectionalLight(0xffe4c0, 2.6);
  diskLight.position.set(0, 1.5, 0);
  diskLight.target = platform;
  scene.add(diskLight, diskLight.target);

  // 粒子：大部分贴着盘面，一小部分散在上下方，俯冲时一起被吸进去
  const count = lite ? 14000 : 52000;
  const radius = new Float32Array(count);
  const angle = new Float32Array(count);
  const lift = new Float32Array(count);
  const seed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const s = Math.random();
    const thin = i % 5 !== 0;
    radius[i] = 3 + Math.pow(Math.random(), 1.6) * (thin ? 22 : 34);
    angle[i] = Math.random() * Math.PI * 2;
    lift[i] = (Math.random() - 0.5) * (thin ? radius[i] * 0.06 : radius[i] * 0.9);
    seed[i] = s;
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
    uSize: { value: lite ? 70 : 60 },
    uPixelRatio: { value: renderer.getPixelRatio() },
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

  // 不加后期辉光（UnrealBloom）：它的多级模糊会把亮环溢进阴影，黑洞中间变成一片灰，
  // 半径收到 0.18 也一样。光晕改由黑洞着色器自己算，粒子本身就是叠加发光的

  function resize() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // 竖屏放不下平台，会压到文字上，干脆不画
    platform.visible = camera.aspect >= 1;
    camera.updateProjectionMatrix();
  }
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();

  // ---- 机位与交互 ----
  let progress = 0;
  let aim = 0;
  const pointer = new THREE.Vector2();
  const sway = new THREE.Vector2();
  let hover = 0;
  let diving = false;
  let diveStart = 0;
  const diveFrom = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 0 };
  const look = new THREE.Vector3();
  let introAt = 0;

  // 竖屏时把镜头往后拉、把黑洞挪回中间，不然右半边会被切掉
  function framing(stop: Stop, out: { pos: THREE.Vector3; look: THREE.Vector3 }) {
    const portrait = camera.aspect < 1;
    out.pos.copy(stop.pos);
    out.look.copy(stop.look);
    if (portrait) {
      out.pos.multiplyScalar(1 + (1 - camera.aspect) * 0.9);
      out.look.lerp(new THREE.Vector3(0, 0, 0), 0.85);
    }
  }

  const a = { pos: new THREE.Vector3(), look: new THREE.Vector3() };
  const b = { pos: new THREE.Vector3(), look: new THREE.Vector3() };
  function pose(p: number, outPos: THREE.Vector3, outLook: THREE.Vector3): number {
    const i = Math.min(Math.floor(p), STOPS.length - 2);
    const t = smooth(Math.min(Math.max(p - i, 0), 1));
    framing(STOPS[i], a);
    framing(STOPS[i + 1], b);
    outPos.lerpVectors(a.pos, b.pos, t);
    outLook.lerpVectors(a.look, b.look, t);
    return THREE.MathUtils.lerp(STOPS[i].fov, STOPS[i + 1].fov, t);
  }

  function setAim(next: number) {
    aim = Math.min(Math.max(next, 0), STOPS.length - 1);
  }

  // 视线到黑洞中心的最近距离（直线近似）小于阴影半径，就算点中了黑洞
  const ray = new THREE.Raycaster();
  function overHole(x: number, y: number): boolean {
    ray.setFromCamera(new THREE.Vector2(x, y), camera);
    const o = ray.ray.origin;
    const d = ray.ray.direction;
    if (o.dot(d) > 0) return false;
    return new THREE.Vector3().crossVectors(o, d).length() < 3.4;
  }

  function toNdc(e: PointerEvent) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * 2 - 1,
      y: -((e.clientY - rect.top) / rect.height) * 2 + 1,
    };
  }

  function dive() {
    if (diving) return;
    options.onDive?.();
    if (still) {
      location.assign(target);
      return;
    }
    diving = true;
    diveStart = performance.now();
    diveFrom.pos.copy(camera.position);
    diveFrom.look.copy(look);
    diveFrom.fov = camera.fov;
    canvas.style.cursor = '';
  }

  let down: { x: number; y: number; p: number } | null = null;
  const onDown = (e: PointerEvent) => {
    down = { x: e.clientX, y: e.clientY, p: aim };
    canvas.setPointerCapture(e.pointerId);
  };
  const onMove = (e: PointerEvent) => {
    const n = toNdc(e);
    pointer.set(n.x, n.y);
    if (down) {
      // 拖动：竖着拖切换机位，手机上就靠这个
      setAim(down.p + (down.y - e.clientY) * 0.006);
    }
    if (!diving && e.pointerType === 'mouse') {
      canvas.style.cursor = overHole(n.x, n.y) ? 'pointer' : '';
    }
  };
  const onUp = (e: PointerEvent) => {
    if (!down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    down = null;
    if (moved < 6) {
      const n = toNdc(e);
      if (overHole(n.x, n.y)) dive();
    }
  };
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    setAim(aim + e.deltaY * 0.0016);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight' || e.key === 'PageDown') setAim(Math.round(aim) + 1);
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft' || e.key === 'PageUp') setAim(Math.round(aim) - 1);
    else if (e.key === 'Enter' || e.key === ' ') dive();
    else return;
    e.preventDefault();
  };
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', () => (down = null));
  canvas.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('keydown', onKey);

  // ---- 每帧 ----
  let last = performance.now();
  const basePos = new THREE.Vector3();
  const baseLook = new THREE.Vector3();
  const introFrom = new THREE.Vector3();
  let raf = 0;
  let activeTick = -1;

  function frame() {
    raf = requestAnimationFrame(frame);
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    if (!introAt) introAt = now;

    if (!still) {
      holeUniforms.uTime.value += dt;
      dustUniforms.uTime.value += dt;
    }

    progress += (aim - progress) * Math.min(dt * 3.2, 1);
    let fov = pose(progress, basePos, baseLook);

    // 入场：从更远处缓缓推到第一个机位
    const enter = still ? 1 : smooth(Math.min((now - introAt) / 2600, 1));
    if (enter < 1) {
      introFrom.copy(basePos).multiplyScalar(1.45).add(new THREE.Vector3(0, 3, 0));
      basePos.lerpVectors(introFrom, basePos, enter);
    }

    // 鼠标带一点视差，镜头像是跟着视线微微偏
    sway.lerp(pointer, Math.min(dt * 2.5, 1));
    basePos.x += sway.x * 0.6;
    basePos.y += sway.y * 0.35;

    if (diving) {
      const t = Math.min((now - diveStart) / 2400, 1);
      const e = t * t * t;
      camera.position.lerpVectors(diveFrom.pos, new THREE.Vector3(0, 0.25, 1.6), e);
      look.lerpVectors(diveFrom.look, new THREE.Vector3(0, 0, 0), smooth(Math.min(t * 2, 1)));
      fov = THREE.MathUtils.lerp(diveFrom.fov, 100, e);
      holeUniforms.uDive.value = t;
      dustUniforms.uDive.value = t;
      veil.style.opacity = String(smooth(Math.max(0, (t - 0.72) / 0.28)));
      if (t >= 1) {
        cancelAnimationFrame(raf);
        location.assign(target);
        return;
      }
    } else {
      camera.position.copy(basePos);
      look.copy(baseLook);
    }

    if (camera.fov !== fov) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    camera.lookAt(look);
    camera.updateMatrixWorld();

    hover += ((!diving && canvas.style.cursor === 'pointer' ? 1 : 0) - hover) * Math.min(dt * 6, 1);
    holeUniforms.uHover.value = hover;
    holeUniforms.uCamPos.value.copy(camera.position);
    holeUniforms.uInvProj.value.copy(camera.projectionMatrixInverse);
    holeUniforms.uCamWorld.value.copy(camera.matrixWorld);

    const leaving = diving ? smooth(Math.min((now - diveStart) / 600, 1)) : 0;
    copy.style.opacity = String((1 - smooth(Math.min(progress / 0.6, 1))) * (1 - leaving));

    const tick = Math.round(progress);
    if (tick !== activeTick) {
      ticks.forEach((el, i) => el.toggleAttribute('data-active', i === tick));
      activeTick = tick;
    }

    renderer.render(scene, camera);
  }
  frame();

  return () => {
    cancelAnimationFrame(raf);
    observer.disconnect();
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerup', onUp);
    canvas.removeEventListener('wheel', onWheel);
    window.removeEventListener('keydown', onKey);
    renderer.dispose();
  };
}
