import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import roomAssets from './assets.json';
import { buildBookshelfBooks, DESK_READ_POS } from './books';
import {
  createCalendarTexture,
  createCorkBoardTexture,
  createFloorTextures,
  createGalleryFrameTexture,
  createMonitorTexture,
  createPlasterTexture,
  createRugTexture,
  createShelfPlateTexture,
  createTvScreenController,
  type UpdatableTexture,
} from './textures';
import { getRoomTheme, readDomTheme } from './themes';
import type {
  CameraPreset,
  FocusTarget,
  HotspotId,
  HotspotMeta,
  HoverPayload,
  RoomBook,
  RoomPayload,
  RoomThemeConfig,
} from './types';

// 书房在门户页 / 星海漫游公共坐标系内的绝对锚点（悬浮于斯隆长城「书房星系」紫粉黑洞适当外侧，全景窗完整装入黑洞与深空星海）
export const STUDY_ROOM_POS = new THREE.Vector3(28.0, -3.6, 44.0);

export const STUDY_OVERVIEW_PRESET: CameraPreset = {
  pos: [5.25, 3.15, 5.45],
  target: [-0.4, 1.28, -0.35],
  fov: 40,
};

const DESK_READING_PRESET: CameraPreset = {
  pos: [-1.26, 1.62, -1.68],
  target: [DESK_READ_POS.x, DESK_READ_POS.y, DESK_READ_POS.z],
  fov: 38,
};

// 望远镜目镜局部坐标点（位于全景观测窗右侧玻璃外侧，对齐望远镜瞄向原点黑洞的光轴，彻底无窗棂遮挡）
export const STUDY_SCOPE_LOCAL_POS = new THREE.Vector3(-1.08, 1.38, -3.76);

export const STUDY_HOTSPOTS: Record<HotspotId, HotspotMeta> = {
  'shelf-project': {
    id: 'shelf-project',
    label: '项目',
    href: '/project/',
    preset: { pos: [-1.18, 2.26, -1.78], target: [-3.12, 2.02, -1.78], fov: 38 },
  },
  'shelf-tool': {
    id: 'shelf-tool',
    label: '工具',
    href: '/tool/',
    preset: { pos: [-1.18, 2.26, -0.46], target: [-3.12, 2.02, -0.46], fov: 38 },
  },
  'shelf-explore': {
    id: 'shelf-explore',
    label: '探究',
    href: '/explore/',
    preset: { pos: [-1.18, 1.44, -1.78], target: [-3.12, 1.2, -1.78], fov: 38 },
  },
  'shelf-daily': {
    id: 'shelf-daily',
    label: '日常',
    href: '/daily/',
    preset: { pos: [-1.18, 1.44, -0.46], target: [-3.12, 1.2, -0.46], fov: 38 },
  },
  'shelf-xiaomeng': {
    id: 'shelf-xiaomeng',
    label: '小萌',
    href: '/xiaomeng/',
    preset: { pos: [-0.96, 0.88, -1.16], target: [-3.12, 0.44, -1.16], fov: 38 },
  },
  'tv-game': {
    id: 'tv-game',
    label: '游戏大厅',
    href: '/game/',
    preset: { pos: [-1.05, 1.22, 2.42], target: [-3.06, 0.85, 2.1], fov: 38 },
  },
  'calendar-notice': {
    id: 'calendar-notice',
    label: '公告栏',
    href: '/notice/',
    preset: { pos: [-1.52, 2.06, 0.78], target: [-3.35, 1.88, 0.78], fov: 38 },
  },
  'gallery-wall': {
    id: 'gallery-wall',
    label: '画廊',
    href: '/gallery/',
    preset: { pos: [2.15, 2.2, -1.12], target: [2.15, 1.98, -3.37], fov: 40 },
  },
  'board-tags': {
    id: 'board-tags',
    label: '标签',
    href: '/tags/',
    preset: { pos: [0.28, 2.16, -1.6], target: [0.28, 1.98, -3.37], fov: 38 },
  },
  'desk-about': {
    id: 'desk-about',
    label: '关于我',
    href: '/about/',
    preset: { pos: [-1.52, 1.56, -1.24], target: [-1.85, 1.0, -3.02], fov: 38 },
  },
  'desk-cake': {
    id: 'desk-cake',
    label: '生日蛋糕',
    href: '/birthday/',
    // 书房模式 controls.minDistance = 1.15：机位需离目标 ≥ 1.15m，否则会被钳制推远而偏离构图，故用 1.2m + 窄视角拉近
    preset: { pos: [-0.95, 1.28, -1.7], target: [-1.22, 0.84, -2.78], fov: 22 },
  },
  'scope-door': {
    id: 'scope-door',
    label: '望远镜 · 观测黑洞',
    href: '/door/',
    preset: { pos: [0.95, 1.48, 3.55], target: [2.66, 0.92, 2.08], fov: 38 },
  },
};

export interface EmbeddedStudyRoomOptions {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  canvas: HTMLCanvasElement;
  container: HTMLElement;
  payload: RoomPayload;
  anchorPos?: THREE.Vector3;
  holeCenter?: THREE.Vector3;
  lite?: boolean;
  reducedMotion?: boolean;
  onFocusChange?: (target: FocusTarget, meta: HotspotMeta | null) => void;
  onHover?: (info: HoverPayload | null, clientX: number, clientY: number) => void;
  onBookOpening?: (book: RoomBook) => void;
  onBookOpened?: (book: RoomBook) => void;
  onBookClosed?: () => void;
  onEnterScope?: () => void;
  onApproachBlackHole?: () => void;
  onReady?: () => void;
}

export interface StudyRoomModule {
  group: THREE.Group;
  isReady(): boolean;
  isCameraFlying(): boolean;
  isInteracting(): boolean;
  cancelActiveFly(): void;
  setVisible(visible: boolean): void;
  setTransform(scale: number, yOffset: number, rotY: number): void;
  resetStateForEntry(): void;
  focus(target: FocusTarget): void;
  closeBook(): void;
  getWorldView(preset: CameraPreset, isOverview: boolean): { pos: THREE.Vector3; target: THREE.Vector3; fov: number };
  getReadingWorldView(): { pos: THREE.Vector3; target: THREE.Vector3; fov: number };
  handlePointerDown(e: PointerEvent): void;
  handlePointerMove(e: PointerEvent): void;
  handlePointerLeave(): void;
  handlePointerUp(e: PointerEvent): void;
  handleWheel(): void;
  tick(dt: number, now: number, elapsed: number, interactive: boolean): void;
  dispose(): void;
}

function resolveHotspotId(obj: THREE.Object3D, stopAt: THREE.Object3D | null): HotspotId | null {
  let curr: THREE.Object3D | null = obj;
  while (curr && curr !== stopAt) {
    const n = curr.name || '';
    if (n.startsWith('Hotspot_TV_Game') || n.startsWith('Screen_CRT')) return 'tv-game';
    if (n.startsWith('Hotspot_Cal_Notice') || n.startsWith('Face_Calendar')) return 'calendar-notice';
    if (n.startsWith('Hotspot_Gallery_Wall') || n.startsWith('Art_Gallery_')) return 'gallery-wall';
    if (n.startsWith('Hotspot_Board_Tags') || n.startsWith('Face_Cork')) return 'board-tags';
    if (n.startsWith('Hotspot_Desk_Cake') || n.startsWith('Cake_Flame')) return 'desk-cake';
    if (n.startsWith('Hotspot_Desk_About') || n.startsWith('Screen_Monitor')) return 'desk-about';
    if (n.startsWith('Hotspot_Scope_Door') || n.startsWith('Scope_ObjLens')) return 'scope-door';
    curr = curr.parent;
  }
  return null;
}

export function createStudyRoomModule(options: EmbeddedStudyRoomOptions): StudyRoomModule {
  const {
    renderer,
    scene,
    camera,
    controls,
    canvas,
    container,
    payload,
    anchorPos = STUDY_ROOM_POS,
    holeCenter = new THREE.Vector3(),
    lite = false,
    reducedMotion: initialReducedMotion = false,
    onFocusChange,
    onHover,
    onBookOpening,
    onBookOpened,
    onBookClosed,
    onEnterScope,
    onApproachBlackHole,
    onReady,
  } = options;

  let reducedMotion = initialReducedMotion;
  const reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const onReducedChange = () => {
    reducedMotion = reducedQuery.matches;
  };
  reducedQuery.addEventListener('change', onReducedChange);

  const domTheme = readDomTheme();
  let activeTheme: RoomThemeConfig = getRoomTheme(domTheme.palette, 'dark');

  const group = new THREE.Group();
  group.position.copy(anchorPos);
  group.visible = false;
  scene.add(group);

  // 柔和 RoomEnvironment 仅作用于书房内部材质，提供均匀软环境反射而不洗白深空背景
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(new RoomEnvironment(), 0.085).texture;

  // 复用临时向量
  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2();
  const dirTmp = new THREE.Vector3();
  const holeDirTmp = new THREE.Vector3();
  const fromPos = new THREE.Vector3();
  const fromTarget = new THREE.Vector3();
  const goalPos = new THREE.Vector3();
  const goalTarget = new THREE.Vector3();
  const flySpherical = new THREE.Spherical();
  const flyOffsetTmp = new THREE.Vector3();
  const savedPosTmp = new THREE.Vector3();
  const savedTargetTmp = new THREE.Vector3();
  const curLampColor = new THREE.Color(activeTheme.lampColor);
  const goalLampColor = new THREE.Color(activeTheme.lampColor);
  const curBhColor = new THREE.Color(activeTheme.keyLightColor);
  const goalBhColor = new THREE.Color(activeTheme.keyLightColor);
  const curHemiSky = new THREE.Color(activeTheme.hemiSkyColor);
  const goalHemiSky = new THREE.Color(activeTheme.hemiSkyColor);
  const curHemiGround = new THREE.Color(activeTheme.hemiGroundColor);
  const goalHemiGround = new THREE.Color(activeTheme.hemiGroundColor);
  const curFillColor = new THREE.Color(activeTheme.fillLightColor);
  const goalFillColor = new THREE.Color(activeTheme.fillLightColor);

  // ---- 建筑级柔光与深空对比：紫粉黑洞斜掠进窗轮廓光 + 室内暖柔补光 + 四盏局部灯（全程依赖 Cycles 烘焙阴影，零实时 ShadowMap 开销） ----
  const roomHemiLight = new THREE.HemisphereLight(
    activeTheme.hemiSkyColor,
    activeTheme.hemiGroundColor,
    activeTheme.hemiIntensity,
  );
  group.add(roomHemiLight);

  const bhDirLight = new THREE.DirectionalLight(activeTheme.keyLightColor, activeTheme.keyLightIntensity);
  bhDirLight.position.set(-4.8, 5.2, -7.8);
  bhDirLight.target.position.set(0.4, 0.8, 0.4);
  bhDirLight.castShadow = false;
  group.add(bhDirLight, bhDirLight.target);

  const indoorFillLight = new THREE.DirectionalLight(activeTheme.fillLightColor, activeTheme.fillLightIntensity);
  indoorFillLight.position.set(4.2, 5.6, 4.6);
  indoorFillLight.target.position.set(-1.2, 1.1, -1.2);
  indoorFillLight.castShadow = false;
  group.add(indoorFillLight, indoorFillLight.target);

  const deskLiveLight = new THREE.PointLight(activeTheme.lampColor, activeTheme.lampIntensity * 0.36, 3.4, 1.55);
  deskLiveLight.position.set(-2.18, 1.24, -2.62);
  group.add(deskLiveLight);

  const floorLiveLight = new THREE.PointLight(activeTheme.lampColor, activeTheme.lampIntensity * 0.44, 4.4, 1.55);
  floorLiveLight.position.set(1.65, 1.72, 0.22);
  group.add(floorLiveLight);

  const shelfLiveLight = new THREE.PointLight(activeTheme.lampColor, activeTheme.lampIntensity * 0.24, 3.2, 1.65);
  shelfLiveLight.position.set(-2.35, 1.48, -1.05);
  group.add(shelfLiveLight);

  const galleryLiveLight = new THREE.PointLight(activeTheme.fillLightColor, activeTheme.lampIntensity * 0.20, 3.6, 1.65);
  galleryLiveLight.position.set(1.65, 2.25, -2.35);
  group.add(galleryLiveLight);

  // ---- 烘焙图与动态画布纹理 ----
  const disposableTextures: THREE.Texture[] = [];
  const extraGeos: THREE.BufferGeometry[] = [];
  const extraMats: THREE.Material[] = [];

  const texLoader = new THREE.TextureLoader();
  texLoader.setCrossOrigin('anonymous');

  const aoTex = texLoader.load(roomAssets.room_ao);
  aoTex.flipY = false;
  aoTex.channel = 1;
  aoTex.colorSpace = THREE.NoColorSpace;
  disposableTextures.push(aoTex);

  const nightLmTex = texLoader.load(roomAssets.room_night_lm);
  nightLmTex.flipY = false;
  nightLmTex.channel = 1;
  nightLmTex.colorSpace = THREE.SRGBColorSpace;
  disposableTextures.push(nightLmTex);

  const updatables: UpdatableTexture[] = [];
  const floorTex = createFloorTextures(activeTheme);
  updatables.push(floorTex.map);
  disposableTextures.push(floorTex.map.texture, floorTex.roughnessMap);

  const plasterTex = createPlasterTexture(activeTheme);
  updatables.push(plasterTex);
  disposableTextures.push(plasterTex.texture);

  const rugTex = createRugTexture(activeTheme);
  updatables.push(rugTex);
  disposableTextures.push(rugTex.texture);

  const tvScreen = createTvScreenController(payload, activeTheme);
  disposableTextures.push(tvScreen.texture);

  const monitorTex = createMonitorTexture(payload, activeTheme);
  updatables.push(monitorTex);
  disposableTextures.push(monitorTex.texture);

  const calendarTex = createCalendarTexture(payload, activeTheme);
  updatables.push(calendarTex);
  disposableTextures.push(calendarTex.texture);

  const corkTex = createCorkBoardTexture(payload, activeTheme);
  updatables.push(corkTex);
  disposableTextures.push(corkTex.texture);

  const galleryTex = [0, 1, 2].map((idx) => {
    const tex = createGalleryFrameTexture(payload.gallery[idx], idx, activeTheme);
    updatables.push(tex);
    disposableTextures.push(tex.texture);
    return tex;
  });

  const plateTex = payload.branches.slice(0, 5).map((branch, idx) => {
    const tex = createShelfPlateTexture(`0${idx + 1}`, branch.label, branch.total, activeTheme);
    updatables.push(tex);
    disposableTextures.push(tex.texture);
    return tex;
  });

  // ---- 1:1 真实数量与封面主色精装书 ----
  const books = buildBookshelfBooks(payload.branches);
  books.group.traverse((obj) => {
    const m = obj as THREE.Mesh;
    if (m.isMesh && m.material && !Array.isArray(m.material)) {
      const std = m.material as THREE.MeshStandardMaterial;
      if (std.isMeshStandardMaterial) {
        std.envMap = envTex;
        std.envMapIntensity = 0.18;
      }
    }
  });
  group.add(books.group);

  // ---- 真实模型几何边缘描边与拾取集合 ----
  const hotspotPickMeshes: THREE.Object3D[] = [];
  const opaqueRoomMeshes: THREE.Object3D[] = [];
  const edgeMats = new Map<HotspotId, THREE.LineBasicMaterial>();
  const edgeLinesByHotspot = new Map<HotspotId, THREE.LineSegments[]>();

  const getEdgeMaterial = (id: HotspotId): THREE.LineBasicMaterial => {
    let m = edgeMats.get(id);
    if (!m) {
      m = new THREE.LineBasicMaterial({
        color: activeTheme.accent,
        transparent: true,
        opacity: 0,
        depthTest: true,
        depthWrite: false,
      });
      edgeMats.set(id, m);
      extraMats.push(m);
    }
    return m;
  };

  // 为望远镜细铜管补充一个不可见交互柱，避免手指或鼠标悬停过于苛刻（不产生方块描边！）
  const scopePickGeo = new THREE.CylinderGeometry(0.24, 0.34, 1.15, 8);
  extraGeos.push(scopePickGeo);
  const scopePickMat = new THREE.MeshBasicMaterial({ visible: false });
  extraMats.push(scopePickMat);
  const scopePickHelper = new THREE.Mesh(scopePickGeo, scopePickMat);
  scopePickHelper.name = 'Scope_PickHelper';
  scopePickHelper.position.set(2.66, 0.68, 2.08);
  scopePickHelper.userData.hotspotId = 'scope-door';
  group.add(scopePickHelper);
  hotspotPickMeshes.push(scopePickHelper);

  const namedMats = new Map<string, THREE.MeshStandardMaterial[]>();
  const bakedMats: THREE.MeshStandardMaterial[] = [];
  let floorLampShadeMat: THREE.MeshStandardMaterial | null = null;
  let glbRoot: THREE.Object3D | null = null;
  let glbReady = false;
  let disposed = false;

  const applyThemeToGlbMaterials = (theme: RoomThemeConfig) => {
    const setColor = (name: string, hex: string) => {
      const list = namedMats.get(name);
      if (!list) return;
      for (const m of list) m.color.set(hex);
    };

    setColor('Mat_HullOuter', theme.hullOuter);
    setColor('Mat_Plinth', theme.plinth);
    setColor('Mat_Trim', theme.trim);
    setColor('Mat_WoodLight', theme.woodLight);
    setColor('Mat_WoodMid', theme.woodMid);
    setColor('Mat_WoodDark', theme.woodDark);
    setColor('Mat_Brass', theme.metalBrass);
    setColor('Mat_Steel', theme.metalSteel);
    setColor('Mat_Curtain', theme.curtain);
    setColor('Mat_Upholstery', theme.upholstery);
    setColor('Mat_Pillow', theme.pillow);
    setColor('Mat_Ceramic', theme.ceramic);
    setColor('Mat_PinkAccent', theme.pinkAccent);
    setColor('Mat_Plant', theme.plantLeaf);

    const glassList = namedMats.get('Mat_Glass');
    if (glassList) {
      for (const m of glassList) {
        m.color.set(theme.glassTint);
        m.opacity = theme.glassOpacity;
      }
    }

    const glowList = namedMats.get('Mat_WarmGlow');
    if (glowList) {
      for (const m of glowList) {
        m.color.set(theme.emissiveWarm);
        m.emissive.set(theme.emissiveWarm);
        m.emissiveIntensity = 1.95;
      }
    }

    const crtList = namedMats.get('Mat_ScreenCRT');
    if (crtList) {
      for (const m of crtList) m.emissiveIntensity = 0.88;
    }

    const monList = namedMats.get('Mat_ScreenMonitor');
    if (monList) {
      for (const m of monList) m.emissiveIntensity = 0.88;
    }

    if (floorLampShadeMat) {
      floorLampShadeMat.color.set(theme.curtain);
      floorLampShadeMat.emissive.set(theme.emissiveWarm);
      floorLampShadeMat.emissiveIntensity = 0.92;
    }

    for (const bm of bakedMats) {
      bm.lightMapIntensity = 1.20;
      bm.aoMapIntensity = 0.84;
    }
  };

  const gltfLoader = new GLTFLoader();
  gltfLoader.setCrossOrigin('anonymous');
  gltfLoader.load(
    roomAssets.study_room,
    (gltf) => {
      if (disposed) {
        gltf.scene.traverse((obj) => {
          if ((obj as THREE.Mesh).isMesh) {
            const m = obj as THREE.Mesh;
            m.geometry.dispose();
            const mats = Array.isArray(m.material) ? m.material : [m.material];
            mats.forEach((mm) => mm.dispose());
          }
        });
        return;
      }

      glbRoot = gltf.scene;
      glbRoot.traverse((obj) => {
        if (!(obj as THREE.Mesh).isMesh) return;
        const mesh = obj as THREE.Mesh;
        const hasUv1 = Boolean(mesh.geometry.attributes.uv1);
        const origMats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        let isGlass = false;

        origMats.forEach((raw) => {
          let mat = raw as THREE.MeshStandardMaterial;
          const name = mat.name || '';
          if (mesh.name === 'FL_Shade') {
            mat = mat.clone();
            mat.side = THREE.DoubleSide;
            mesh.material = mat;
            floorLampShadeMat = mat;
            extraMats.push(mat);
          }

          const list = namedMats.get(name) ?? [];
          list.push(mat);
          namedMats.set(name, list);

          mat.envMap = envTex;
          if (name === 'Mat_Brass' || name === 'Mat_Steel') {
            mat.envMapIntensity = 0.48;
          } else if (name === 'Mat_Ceramic' || name === 'Mat_PinkAccent' || name === 'Mat_Plant') {
            mat.envMapIntensity = 0.24;
          } else if (name === 'Mat_Glass') {
            mat.envMapIntensity = 0.28;
          } else if (
            name === 'Mat_Floor' ||
            name === 'Mat_WoodLight' ||
            name === 'Mat_WoodMid' ||
            name === 'Mat_WoodDark' ||
            name === 'Mat_FaceCork' ||
            name === 'Mat_FaceCalendar' ||
            name.startsWith('Mat_Art') ||
            name.startsWith('Mat_Plate')
          ) {
            mat.envMapIntensity = 0.14;
          } else if (name === 'Mat_ScreenCRT' || name === 'Mat_ScreenMonitor') {
            mat.envMapIntensity = 0.0;
          } else {
            mat.envMapIntensity = 0.09;
          }

          if (name === 'Mat_Glass') {
            isGlass = true;
            mat.transparent = true;
            mat.depthWrite = false;
            mat.roughness = 0.08;
            mat.metalness = 0.1;
            mesh.renderOrder = 2;
            mesh.castShadow = false;
            mesh.receiveShadow = false;
          } else {
            mesh.castShadow = false;
            mesh.receiveShadow = false;
          }

          if (name === 'Mat_Floor') {
            mat.color.set('#ffffff');
            mat.map = floorTex.map.texture;
            mat.roughnessMap = floorTex.roughnessMap;
            mat.bumpMap = floorTex.roughnessMap;
            mat.bumpScale = 0.007;
            mat.roughness = 0.80;
            mat.needsUpdate = true;
          } else if (name === 'Mat_WallInner') {
            mat.color.set('#ffffff');
            mat.map = plasterTex.texture;
            mat.bumpMap = plasterTex.texture;
            mat.bumpScale = 0.004;
            mat.roughness = 0.86;
            mat.needsUpdate = true;
          } else if (name === 'Mat_Rug') {
            mat.color.set('#ffffff');
            mat.map = rugTex.texture;
            mat.bumpMap = rugTex.texture;
            mat.bumpScale = 0.005;
            mat.roughness = 0.94;
            mat.needsUpdate = true;
          } else if (name === 'Mat_ScreenCRT') {
            mat.color.set('#ffffff');
            mat.map = tvScreen.texture;
            mat.emissive.set('#ffffff');
            mat.emissiveMap = tvScreen.texture;
            mat.roughness = 0.94;
            mat.metalness = 0.0;
            mat.envMapIntensity = 0.0;
            mat.needsUpdate = true;
          } else if (name === 'Mat_ScreenMonitor') {
            mat.color.set('#ffffff');
            mat.map = monitorTex.texture;
            mat.emissive.set('#ffffff');
            mat.emissiveMap = monitorTex.texture;
            mat.roughness = 0.94;
            mat.metalness = 0.0;
            mat.envMapIntensity = 0.0;
            mat.needsUpdate = true;
          } else if (name === 'Mat_FaceCalendar') {
            mat.color.set('#ffffff');
            mat.map = calendarTex.texture;
            mat.needsUpdate = true;
          } else if (name === 'Mat_FaceCork') {
            mat.color.set('#ffffff');
            mat.map = corkTex.texture;
            mat.needsUpdate = true;
          } else if (name.startsWith('Mat_Art')) {
            const idx = Number(name.replace('Mat_Art', ''));
            if (galleryTex[idx]) {
              mat.color.set('#ffffff');
              mat.map = galleryTex[idx].texture;
              mat.needsUpdate = true;
            }
          } else if (name.startsWith('Mat_Plate')) {
            const idx = Number(name.replace('Mat_Plate', ''));
            if (plateTex[idx]) {
              mat.color.set('#ffffff');
              mat.map = plateTex[idx].texture;
              mat.needsUpdate = true;
            }
          }

          if (
            hasUv1 &&
            name !== 'Mat_Glass' &&
            name !== 'Mat_WarmGlow' &&
            name !== 'Mat_ScreenCRT' &&
            name !== 'Mat_ScreenMonitor'
          ) {
            mat.aoMap = aoTex;
            mat.aoMapIntensity = 0.84;
            mat.lightMap = nightLmTex;
            mat.lightMapIntensity = 1.20;
            mat.needsUpdate = true;
            bakedMats.push(mat);
          }
        });

        const hotspotId = resolveHotspotId(mesh, glbRoot);
        if (hotspotId) {
          mesh.userData.hotspotId = hotspotId;
          if (hotspotId === 'scope-door' && isGlass) {
            opaqueRoomMeshes.push(mesh);
          } else {
            hotspotPickMeshes.push(mesh);
            // 沿实体模型几何边缘生成 1px 轮廓线（绝不使用方块盒子！）
            // 蛋糕满是珠链、圆点与淋面细节，放宽阈值只勾大轮廓，避免悬停时描成一团碎线
            const edgesGeo = new THREE.EdgesGeometry(mesh.geometry, hotspotId === 'desk-cake' ? 58 : 30);
            extraGeos.push(edgesGeo);
            const edgeLine = new THREE.LineSegments(edgesGeo, getEdgeMaterial(hotspotId));
            edgeLine.raycast = () => {};
            edgeLine.visible = false;
            edgeLine.renderOrder = 3;
            mesh.add(edgeLine);
            const list = edgeLinesByHotspot.get(hotspotId) ?? [];
            list.push(edgeLine);
            edgeLinesByHotspot.set(hotspotId, list);
          }
        } else if (!isGlass && (mesh.name.startsWith('Arch_Room') || mesh.name.startsWith('Arch_Bookcase'))) {
          // 仅由建筑墙体/地板/书柜拦截背后黑洞射线，跳过细碎软装网格，彻底消除悬停拾取卡顿
          opaqueRoomMeshes.push(mesh);
        }
      });

      applyThemeToGlbMaterials(activeTheme);
      group.add(glbRoot);
      Promise.all([
        renderer.compileAsync(glbRoot, camera, scene),
        renderer.compileAsync(books.group, camera, scene),
      ])
        .catch(() => {})
        .finally(() => {
          if (!disposed) {
            glbReady = true;
            onReady?.();
          }
        });
    },
    undefined,
    () => {
      if (!disposed) {
        glbReady = true;
        onReady?.();
      }
    },
  );

  // ---- 自适应局部坐标机位换算 -> 自动叠加 anchorPos 转为门户公共世界坐标 ----
  const getWorldView = (
    preset: CameraPreset,
    isOverview: boolean,
  ): { pos: THREE.Vector3; target: THREE.Vector3; fov: number } => {
    const aspect = Math.max(container.clientWidth, 1) / Math.max(container.clientHeight, 1);
    const tall = aspect < 1;

    if (isOverview) {
      const pull = tall ? Math.min(1.58, Math.max(1.16, 0.94 / Math.max(aspect, 0.52))) : 1;
      const baseTarget = new THREE.Vector3(
        preset.target[0],
        tall ? preset.target[1] - 0.12 : preset.target[1],
        preset.target[2],
      );
      dirTmp.set(preset.pos[0], preset.pos[1], preset.pos[2]).sub(baseTarget).multiplyScalar(pull);
      const localPos = baseTarget.clone().add(dirTmp);
      return {
        pos: localPos.add(anchorPos),
        target: baseTarget.add(anchorPos),
        fov: tall ? 44 : preset.fov ?? 40,
      };
    }

    const focalTarget = new THREE.Vector3(...preset.target);
    const focalPos = new THREE.Vector3(...preset.pos);
    if (tall) {
      dirTmp.copy(focalPos).sub(focalTarget).multiplyScalar(1.24);
      focalPos.copy(focalTarget).add(dirTmp);
    }
    return {
      pos: focalPos.add(anchorPos),
      target: focalTarget.add(anchorPos),
      fov: tall ? (preset.fov ?? 38) + 4 : preset.fov ?? 38,
    };
  };

  // ---- 相机丝滑漫游过渡 ----
  let flying = false;
  let flyStart = 0;
  let flyDur = 1150;
  let fromFov = camera.fov;
  let goalFov = camera.fov;
  let currentFocus: FocusTarget = 'overview';

  const smootherstep = (x: number) => {
    const t = Math.min(1, Math.max(0, x));
    return t * t * t * (t * (t * 6 - 15) + 10);
  };

  // 清空 OrbitControls 残留阻尼惯性，同时保持当前相机位置与朝向完全不变，避免起飞或落地瞬间的多余偏移
  const flushControlsVelocity = () => {
    savedPosTmp.copy(camera.position);
    savedTargetTmp.copy(controls.target);
    const prevDamping = controls.enableDamping;
    controls.enableDamping = false;
    controls.update();
    controls.enableDamping = prevDamping;
    camera.position.copy(savedPosTmp);
    controls.target.copy(savedTargetTmp);
  };

  // 预先将目标机位对齐到 OrbitControls 的距离与俯仰约束内，使飞行全程直达最终可控位姿，收尾零强制校准卡顿
  const clampGoalToControls = (pos: THREE.Vector3, target: THREE.Vector3) => {
    flyOffsetTmp.copy(pos).sub(target);
    flySpherical.setFromVector3(flyOffsetTmp);
    const minDist = Number.isFinite(controls.minDistance) ? controls.minDistance : 0;
    const maxDist = Number.isFinite(controls.maxDistance) ? controls.maxDistance : Infinity;
    flySpherical.radius = Math.min(maxDist, Math.max(minDist, flySpherical.radius));
    flySpherical.phi = Math.min(controls.maxPolarAngle, Math.max(controls.minPolarAngle, flySpherical.phi));
    flySpherical.makeSafe();
    pos.copy(target).add(flyOffsetTmp.setFromSpherical(flySpherical));
  };

  const flyToPreset = (preset: CameraPreset, isOverview: boolean, dur = 1150) => {
    const view = getWorldView(preset, isOverview);
    clampGoalToControls(view.pos, view.target);
    if (reducedMotion) {
      flying = false;
      flushControlsVelocity();
      camera.position.copy(view.pos);
      controls.target.copy(view.target);
      camera.fov = view.fov;
      camera.updateProjectionMatrix();
      controls.enabled = true;
      controls.update();
      return;
    }
    flushControlsVelocity();
    fromPos.copy(camera.position);
    fromTarget.copy(controls.target);
    fromFov = camera.fov;
    goalPos.copy(view.pos);
    goalTarget.copy(view.target);
    goalFov = view.fov;
    flyStart = performance.now();
    flyDur = dur;
    flying = true;
    controls.enabled = false;
  };

  const closeCurrentBook = (flyBackOverview = true) => {
    const active = books.getActiveBook();
    if (!active) return;
    onBookClosed?.();
    if (flyBackOverview) {
      currentFocus = 'overview';
      onFocusChange?.('overview', null);
      flyToPreset(STUDY_OVERVIEW_PRESET, true, 1280);
    }
    books.closeBook(reducedMotion);
  };

  const focusTarget = (target: FocusTarget) => {
    if (target === 'scope-door') {
      if (books.getActiveBook()) {
        closeCurrentBook(false);
      }
      currentFocus = 'overview';
      onFocusChange?.('overview', null);
      onEnterScope?.();
      return;
    }
    if (books.getActiveBook()) {
      closeCurrentBook(false);
    }
    currentFocus = target;
    if (target === 'overview') {
      onFocusChange?.('overview', null);
      flyToPreset(STUDY_OVERVIEW_PRESET, true, 1180);
      return;
    }
    const meta = STUDY_HOTSPOTS[target];
    if (!meta) return;
    onFocusChange?.(target, meta);
    flyToPreset(meta.preset, false, 1150);
  };

  // ---- 4 色板联动 ----
  let curLampIntensity = activeTheme.lampIntensity;
  let goalLampIntensity = activeTheme.lampIntensity;
  let curBhIntensity = activeTheme.keyLightIntensity;
  let curHemiIntensity = activeTheme.hemiIntensity;
  let goalHemiIntensity = activeTheme.hemiIntensity;
  let curFillIntensity = activeTheme.fillLightIntensity;
  let goalFillIntensity = activeTheme.fillLightIntensity;

  const syncTheme = () => {
    const next = readDomTheme();
    const cfg = getRoomTheme(next.palette, 'dark');
    activeTheme = cfg;

    for (const u of updatables) u.update(cfg);
    tvScreen.tick(0, cfg, true);

    goalLampColor.set(cfg.lampColor);
    goalLampIntensity = cfg.lampIntensity;
    goalBhColor.set(cfg.keyLightColor);
    goalHemiSky.set(cfg.hemiSkyColor);
    goalHemiGround.set(cfg.hemiGroundColor);
    goalHemiIntensity = cfg.hemiIntensity;
    goalFillColor.set(cfg.fillLightColor);
    goalFillIntensity = cfg.fillLightIntensity;

    for (const mat of edgeMats.values()) {
      mat.color.set(cfg.accent);
    }
    applyThemeToGlbMaterials(cfg);
  };

  const observer = new MutationObserver(syncTheme);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-palette'],
  });

  // ---- 射线拾取（单本书 > 家具实体 > 房间遮挡 > 窗口或开放视野中的真实紫粉黑洞） ----
  let downPos: { x: number; y: number } | null = null;
  let isDragging = false;
  let lastMoveTime = 0;
  let hoveredFurniture: HotspotId | null = null;
  let hoveredBookId: string | null = null;
  let hoveredBlackHole = false;

  const hotspotEdgeAlpha = new Map<HotspotId, number>();

  const pickAt = (
    clientX: number,
    clientY: number,
  ): { bookId?: string; furnitureId?: HotspotId; blackhole?: boolean } => {
    if (!group.visible) return {};
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return {};
    pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointerNdc, camera);

    const targets: THREE.Object3D[] = [
      ...(books.getActiveBook() ? [] : books.hitMeshes),
      ...hotspotPickMeshes,
      ...opaqueRoomMeshes,
    ];
    const hits = raycaster.intersectObjects(targets, false);
    if (hits.length > 0) {
      const first = hits[0].object;
      const bookId = first.userData.bookId as string | undefined;
      if (bookId && !books.getActiveBook()) return { bookId };
      const furnitureId = first.userData.hotspotId as HotspotId | undefined;
      if (furnitureId) return { furnitureId };
      return {};
    }

    holeDirTmp.copy(holeCenter).sub(camera.position).normalize();
    if (raycaster.ray.direction.dot(holeDirTmp) > 0.88) {
      return { blackhole: true };
    }
    return {};
  };

  const clearHover = () => {
    if (!hoveredBookId && !hoveredFurniture && !hoveredBlackHole) return;
    hoveredBookId = null;
    hoveredFurniture = null;
    hoveredBlackHole = false;
    books.setHovered(null);
    onHover?.(null, 0, 0);
  };

  const onControlsEnd = () => {
    isDragging = false;
  };
  controls.addEventListener('end', onControlsEnd);

  return {
    group,
    isReady() {
      return glbReady;
    },
    isCameraFlying() {
      return flying;
    },
    isInteracting() {
      return isDragging;
    },
    cancelActiveFly() {
      if (flying) {
        flying = false;
        controls.enabled = true;
      }
    },
    setVisible(visible) {
      group.visible = visible;
      if (!visible) {
        isDragging = false;
        clearHover();
        flying = false;
      }
    },
    setTransform(scale, yOffset, rotY) {
      group.scale.setScalar(scale);
      group.position.set(anchorPos.x, anchorPos.y + yOffset, anchorPos.z);
      group.rotation.y = rotY;
    },
    resetStateForEntry() {
      group.scale.setScalar(1);
      group.position.copy(anchorPos);
      group.rotation.y = 0;
      if (books.getActiveBook()) {
        books.closeBook(true);
        onBookClosed?.();
      }
      clearHover();
      flying = false;
      currentFocus = 'overview';
      onFocusChange?.('overview', null);
    },
    focus(target) {
      focusTarget(target);
    },
    closeBook() {
      closeCurrentBook(true);
    },
    getWorldView,
    getReadingWorldView() {
      return getWorldView(DESK_READING_PRESET, false);
    },
    handlePointerDown(e) {
      downPos = { x: e.clientX, y: e.clientY };
      isDragging = true;
      if (flying) {
        flying = false;
        controls.enabled = true;
      }
    },
    handlePointerMove(e) {
      if (e.buttons === 0) isDragging = false;
      if (e.pointerType !== 'mouse') return;
      const now = performance.now();
      if (now - lastMoveTime < 20) return;
      lastMoveTime = now;

      if (e.buttons !== 0) {
        isDragging = true;
        clearHover();
        canvas.style.cursor = 'grabbing';
        return;
      }

      const hit = pickAt(e.clientX, e.clientY);
      if (hit.bookId) {
        hoveredBookId = hit.bookId;
        hoveredFurniture = null;
        hoveredBlackHole = false;
        books.setHovered(hit.bookId);
        const b = books.getBookById(hit.bookId);
        canvas.style.cursor = 'pointer';
        if (b) {
          onHover?.({ kind: 'book', label: b.title, color: b.coverColor }, e.clientX, e.clientY);
        }
        return;
      }

      if (hoveredBookId !== null) {
        hoveredBookId = null;
        books.setHovered(null);
      }

      if (hit.furnitureId) {
        hoveredFurniture = hit.furnitureId;
        hoveredBlackHole = false;
        const meta = STUDY_HOTSPOTS[hit.furnitureId];
        canvas.style.cursor = 'pointer';
        onHover?.({ kind: 'furniture', label: meta.label }, e.clientX, e.clientY);
        return;
      }

      hoveredFurniture = null;

      if (hit.blackhole) {
        hoveredBlackHole = true;
        canvas.style.cursor = 'pointer';
        onHover?.({ kind: 'blackhole', label: '紫粉黑洞 · 点击抵近跃迁', color: '#e45cc6' }, e.clientX, e.clientY);
        return;
      }

      hoveredBlackHole = false;
      canvas.style.cursor = 'grab';
      onHover?.(null, e.clientX, e.clientY);
    },
    handlePointerLeave() {
      isDragging = false;
      clearHover();
      canvas.style.cursor = '';
    },
    handlePointerUp(e) {
      isDragging = false;
      if (!downPos) return;
      const dist = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y);
      downPos = null;
      if (dist > 6) return;

      const hit = pickAt(e.clientX, e.clientY);
      if (hit.bookId) {
        const book = books.getBookById(hit.bookId);
        if (!book) return;
        clearHover();
        onBookOpening?.(book);
        flyToPreset(DESK_READING_PRESET, false, reducedMotion ? 120 : 1220);
        books.openBook(hit.bookId, reducedMotion, (arrived) => {
          onBookOpened?.(arrived);
        });
        return;
      }

      if (hit.furnitureId) {
        clearHover();
        if (hit.furnitureId === 'scope-door') {
          onEnterScope?.();
        } else {
          focusTarget(hit.furnitureId);
        }
        return;
      }

      if (hit.blackhole) {
        clearHover();
        onApproachBlackHole?.();
      }
    },
    handleWheel() {
      if (flying) {
        flying = false;
        controls.enabled = true;
      }
    },
    tick(dt, now, elapsed, interactive) {
      if (!group.visible) return;

      if (flying) {
        const p = Math.min(1, Math.max(0, (now - flyStart) / Math.max(flyDur, 1)));
        const k = smootherstep(p);
        camera.position.lerpVectors(fromPos, goalPos, k);
        controls.target.lerpVectors(fromTarget, goalTarget, k);
        const nextFov = fromFov + (goalFov - fromFov) * k;
        if (Math.abs(nextFov - camera.fov) > 0.01) {
          camera.fov = nextFov;
          camera.updateProjectionMatrix();
        }
        if (p >= 1) {
          flying = false;
          if (camera.fov !== goalFov) {
            camera.fov = goalFov;
            camera.updateProjectionMatrix();
          }
          controls.enabled = true;
          camera.lookAt(controls.target);
        }
      }

      const lerpK = reducedMotion ? 1 : Math.min(dt * 8, 1);
      curLampColor.lerp(goalLampColor, lerpK);
      curLampIntensity += (goalLampIntensity - curLampIntensity) * lerpK;
      curBhColor.lerp(goalBhColor, lerpK);
      curBhIntensity += (activeTheme.keyLightIntensity - curBhIntensity) * lerpK;
      curHemiSky.lerp(goalHemiSky, lerpK);
      curHemiGround.lerp(goalHemiGround, lerpK);
      curHemiIntensity += (goalHemiIntensity - curHemiIntensity) * lerpK;
      curFillColor.lerp(goalFillColor, lerpK);
      curFillIntensity += (goalFillIntensity - curFillIntensity) * lerpK;

      deskLiveLight.color.copy(curLampColor);
      deskLiveLight.intensity = curLampIntensity * 0.36;
      floorLiveLight.color.copy(curLampColor);
      floorLiveLight.intensity = curLampIntensity * 0.44;
      shelfLiveLight.color.copy(curLampColor);
      shelfLiveLight.intensity = curLampIntensity * 0.24;
      galleryLiveLight.color.copy(curFillColor);
      galleryLiveLight.intensity = curLampIntensity * 0.20;
      roomHemiLight.color.copy(curHemiSky);
      roomHemiLight.groundColor.copy(curHemiGround);
      roomHemiLight.intensity = curHemiIntensity;
      bhDirLight.color.copy(curBhColor);
      bhDirLight.intensity = curBhIntensity;
      indoorFillLight.color.copy(curFillColor);
      indoorFillLight.intensity = curFillIntensity;

      // 平滑淡入淡出实体边缘轮廓线（悬停高亮，离开隐去）
      for (const [id, mat] of edgeMats) {
        const goal = interactive && id === hoveredFurniture ? 0.88 : 0;
        const cur = hotspotEdgeAlpha.get(id) ?? 0;
        const next = cur + (goal - cur) * Math.min(dt * 12, 1);
        hotspotEdgeAlpha.set(id, next);
        mat.opacity = next;
        const show = next > 0.015;
        const lines = edgeLinesByHotspot.get(id);
        if (lines) {
          for (const l of lines) l.visible = show;
        }
      }

      books.tick(dt, now);
      if (!isDragging) {
        tvScreen.tick(elapsed, activeTheme, reducedMotion, lite);
      }
    },
    dispose() {
      disposed = true;
      observer.disconnect();
      reducedQuery.removeEventListener('change', onReducedChange);
      controls.removeEventListener('end', onControlsEnd);
      scene.remove(group);
      books.dispose();
      for (const g of extraGeos) g.dispose();
      for (const m of extraMats) m.dispose();
      for (const t of disposableTextures) t.dispose();
      if (glbRoot) {
        glbRoot.traverse((obj) => {
          if ((obj as THREE.Mesh).isMesh) {
            const m = obj as THREE.Mesh;
            m.geometry.dispose();
            const mats = Array.isArray(m.material) ? m.material : [m.material];
            mats.forEach((mm) => mm.dispose());
          }
        });
      }
      envTex.dispose();
      pmrem.dispose();
    },
  };
}
