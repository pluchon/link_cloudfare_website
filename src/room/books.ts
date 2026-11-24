import * as THREE from 'three';
import type { BranchKey, RoomBook, RoomBranch } from './types';

// 与 scripts/room-blender/build_room.py 的 5 个书架隔层顶面严丝合缝对齐
interface ShelfBayLayout {
  shelfY: number;
  zStart: number;
  zEnd: number;
  xCenter: number;
}

const BAY_LAYOUT: Record<BranchKey, ShelfBayLayout> = {
  project: { shelfY: 1.84, zStart: -2.25, zEnd: -1.34, xCenter: -3.11 },
  tool: { shelfY: 1.84, zStart: -0.95, zEnd: -0.06, xCenter: -3.11 },
  explore: { shelfY: 1.0, zStart: -2.25, zEnd: -1.32, xCenter: -3.11 },
  daily: { shelfY: 1.0, zStart: -0.95, zEnd: -0.06, xCenter: -3.11 },
  xiaomeng: { shelfY: 0.16, zStart: -2.24, zEnd: -0.98, xCenter: -3.11 },
};

// 书桌中央阅读垫坐标（与 build_room.py Desk_Read_Blotter 对齐）
export const DESK_READ_POS = new THREE.Vector3(-1.26, 0.79, -2.74);

interface BookInstance {
  book: RoomBook;
  group: THREE.Group;
  frontPivot: THREE.Group;
  coverMat: THREE.MeshStandardMaterial;
  shadowMat: THREE.MeshBasicMaterial;
  hitMesh: THREE.Mesh;
  homePos: THREE.Vector3;
  homeQuat: THREE.Quaternion;
  hoverAmt: number;
  height: number;
  width: number;
  thickness: number;
}

type BookAnimPhase = 'idle' | 'flyingToDesk' | 'openOnDesk' | 'returningToShelf';

export interface BooksManager {
  group: THREE.Group;
  hitMeshes: THREE.Object3D[];
  getBookById(id: string): RoomBook | undefined;
  setHovered(id: string | null): void;
  openBook(id: string, reducedMotion: boolean, onArrived: (book: RoomBook) => void): void;
  closeBook(reducedMotion: boolean, onReturned?: () => void): void;
  getActiveBook(): RoomBook | null;
  tick(dt: number, now: number): void;
  dispose(): void;
}

function hashSeed(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

export function buildBookshelfBooks(branches: RoomBranch[]): BooksManager {
  const root = new THREE.Group();
  const hitMeshes: THREE.Object3D[] = [];
  const bookMap = new Map<string, BookInstance>();
  const instances: BookInstance[] = [];

  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const textures: THREE.Texture[] = [];

  const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
    geometries.push(g);
    return g;
  };
  const trackMat = <T extends THREE.Material>(m: T): T => {
    materials.push(m);
    return m;
  };
  const trackTex = <T extends THREE.Texture>(t: T): T => {
    textures.push(t);
    return t;
  };

  // 共享书架底部接触阴影贴图（64×64 柔边暗斑，无实时 ShadowMap 开销）
  const shadowCanvas = document.createElement('canvas');
  shadowCanvas.width = 64;
  shadowCanvas.height = 64;
  const sCtx = shadowCanvas.getContext('2d')!;
  const sGrad = sCtx.createRadialGradient(32, 32, 4, 32, 32, 31);
  sGrad.addColorStop(0, 'rgba(10, 7, 5, 0.92)');
  sGrad.addColorStop(0.55, 'rgba(10, 7, 5, 0.45)');
  sGrad.addColorStop(1, 'rgba(10, 7, 5, 0)');
  sCtx.fillStyle = sGrad;
  sCtx.fillRect(0, 0, 64, 64);
  const shadowTex = trackTex(new THREE.CanvasTexture(shadowCanvas));

  // 共享精装布纹凹凸贴图（64×128 轻微十字布纹）
  const linenCanvas = document.createElement('canvas');
  linenCanvas.width = 64;
  linenCanvas.height = 128;
  const lCtx = linenCanvas.getContext('2d')!;
  lCtx.fillStyle = '#808080';
  lCtx.fillRect(0, 0, 64, 128);
  lCtx.fillStyle = '#929292';
  for (let y = 0; y < 128; y += 2) lCtx.fillRect(0, y, 64, 1);
  lCtx.fillStyle = '#6e6e6e';
  for (let x = 0; x < 64; x += 2) lCtx.fillRect(x, 0, 1, 128);
  const linenBumpTex = trackTex(new THREE.CanvasTexture(linenCanvas));
  linenBumpTex.wrapS = THREE.RepeatWrapping;
  linenBumpTex.wrapT = THREE.RepeatWrapping;
  linenBumpTex.repeat.set(2, 4);

  const bookendShadowMat = trackMat(
    new THREE.MeshBasicMaterial({
      map: shadowTex,
      transparent: true,
      opacity: 0.44,
      depthWrite: false,
    }),
  );

  // 共享内页纸块材质、黄铜书立材质与书签金带材质
  const pageMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: '#f3eee2',
      roughness: 0.9,
      metalness: 0.0,
    }),
  );
  const brassMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: '#cba352',
      roughness: 0.28,
      metalness: 0.82,
    }),
  );

  // 书本放置于桌面平摊时的目标朝向（严格右手正交基：local +X书脊->world -X左, +Y书顶->world -Z窗侧, +Z封底->world -Y贴桌, -Z封面朝上+Y）
  const deskBasis = new THREE.Matrix4().makeBasis(
    new THREE.Vector3(-1, 0, 0),
    new THREE.Vector3(0, 0, -1),
    new THREE.Vector3(0, -1, 0),
  );
  const deskFlatQuat = new THREE.Quaternion().setFromRotationMatrix(deskBasis);
  // 临时插值向量/四元数提前声明，杜绝 GC 与 TDZ
  const p0 = new THREE.Vector3();
  const p1 = new THREE.Vector3();
  const p2 = new THREE.Vector3();
  const tmpA = new THREE.Vector3();
  const tmpB = new THREE.Vector3();

  // 逐分类严格 1:1 创建每一篇文章对应的真实精装书
  for (const branch of branches) {
    const bay = BAY_LAYOUT[branch.key];
    if (!bay) continue;

    const count = branch.books.length;
    if (count === 0) continue;

    const span = bay.zEnd - bay.zStart;
    // 根据实际书本数量自适应厚度与间距，确保 2~20 本都优雅紧凑不越界
    const maxSlot = Math.min(0.068, Math.max(0.036, (span - 0.06) / count));
    let cursorZ = bay.zStart;

    for (let i = 0; i < count; i++) {
      const book = branch.books[i];
      const rnd = hashSeed(book.id);
      const thickness = Math.min(maxSlot - 0.006, 0.032 + rnd * 0.016);
      const height = 0.255 + (hashSeed(book.title) * 0.065);
      const depth = 0.205 + rnd * 0.032; // 书宽（沿 X 纵深）

      const bookGroup = new THREE.Group();
      const coverMat = trackMat(
        new THREE.MeshStandardMaterial({
          color: book.coverColor,
          roughness: 0.56,
          metalness: 0.06,
          bumpMap: linenBumpTex,
          bumpScale: 0.0025,
          emissive: book.coverColor,
          emissiveIntensity: 0.0,
        }),
      );

      // 局部坐标系约定：
      // +X = 书脊面向房间的正面方向（所以放在左墙书架时，书脊朝 +X 面对读者！）
      // +Y = 书高（书顶到书底）
      // +Z = 书厚度方向（左封底在 -Z/2，右封面在 +Z/2）
      const boardT = 0.0045;
      const spineR = thickness * 0.5;

      // 1. 弧形书脊（沿 Y 轴半圆柱）
      const spineGeo = trackGeo(
        new THREE.CylinderGeometry(spineR, spineR, height, 12, 1, false, 0, Math.PI),
      );
      const spineMesh = new THREE.Mesh(spineGeo, coverMat);
      spineMesh.position.set(depth * 0.5 - spineR * 0.15, 0, 0);
      spineMesh.castShadow = true;
      spineMesh.receiveShadow = true;
      bookGroup.add(spineMesh);

      // 书脊上下两道精致烫金细纹
      for (const bandY of [height * 0.34, -height * 0.34]) {
        const bandGeo = trackGeo(
          new THREE.CylinderGeometry(spineR + 0.0012, spineR + 0.0012, 0.007, 12, 1, false, 0, Math.PI),
        );
        const band = new THREE.Mesh(bandGeo, brassMat);
        band.position.set(depth * 0.5 - spineR * 0.15, bandY, 0);
        bookGroup.add(band);
      }

      // 2. 封底硬壳（固定侧 +Z，放平在桌面时贴合桌垫 -Y）
      const backBoardGeo = trackGeo(new THREE.BoxGeometry(depth, height, boardT));
      const backBoard = new THREE.Mesh(backBoardGeo, coverMat);
      backBoard.position.set(0, 0, thickness * 0.5 - boardT * 0.5);
      backBoard.castShadow = true;
      backBoard.receiveShadow = true;
      bookGroup.add(backBoard);

      // 3. 奶油纸页内芯
      const pageGeo = trackGeo(
        new THREE.BoxGeometry(depth - 0.012, height - 0.014, Math.max(0.01, thickness - boardT * 2.2)),
      );
      const pageMesh = new THREE.Mesh(pageGeo, pageMat);
      pageMesh.position.set(-0.004, 0, 0);
      bookGroup.add(pageMesh);

      // 4. 可绕书脊旋转翻开的封面硬壳（-Z 侧，放平在桌面时朝上 +Y，绕 +Y 负向旋转翻向左开）
      const frontPivot = new THREE.Group();
      frontPivot.position.set(depth * 0.5, 0, -thickness * 0.5 + boardT * 0.5);
      const frontBoardGeo = trackGeo(new THREE.BoxGeometry(depth, height, boardT));
      const frontBoard = new THREE.Mesh(frontBoardGeo, coverMat);
      frontBoard.position.set(-depth * 0.5, 0, 0);
      frontBoard.castShadow = true;
      frontBoard.receiveShadow = true;
      frontPivot.add(frontBoard);
      bookGroup.add(frontPivot);

      // 5. 略微加宽一点的隐形射线拾取碰撞体，确保薄书也一指即中
      const hitGeo = trackGeo(
        new THREE.BoxGeometry(depth + 0.04, height + 0.02, Math.max(thickness + 0.008, 0.042)),
      );
      const hitMat = trackMat(new THREE.MeshBasicMaterial({ visible: false }));
      const hitMesh = new THREE.Mesh(hitGeo, hitMat);
      hitMesh.userData.bookId = book.id;
      bookGroup.add(hitMesh);
      hitMeshes.push(hitMesh);

      const zCenter = cursorZ + thickness * 0.5;
      cursorZ += thickness + 0.007;

      const homePos = new THREE.Vector3(
        bay.xCenter + (0.23 - depth) * 0.35,
        bay.shelfY + height * 0.5 + 0.002,
        zCenter,
      );
      const homeQuat = new THREE.Quaternion();

      bookGroup.position.copy(homePos);
      bookGroup.quaternion.copy(homeQuat);
      root.add(bookGroup);

      const shadowMat = trackMat(
        new THREE.MeshBasicMaterial({
          map: shadowTex,
          transparent: true,
          opacity: 0.52,
          depthWrite: false,
        }),
      );
      const shadowGeo = trackGeo(new THREE.PlaneGeometry(depth + 0.036, thickness + 0.030));
      shadowGeo.rotateX(-Math.PI * 0.5);
      const shadowMesh = new THREE.Mesh(shadowGeo, shadowMat);
      shadowMesh.position.set(homePos.x, bay.shelfY + 0.0015, zCenter);
      shadowMesh.renderOrder = 1;
      root.add(shadowMesh);

      const inst: BookInstance = {
        book,
        group: bookGroup,
        frontPivot,
        coverMat,
        shadowMat,
        hitMesh,
        homePos,
        homeQuat,
        hoverAmt: 0,
        height,
        width: depth,
        thickness,
      };
      bookMap.set(book.id, inst);
      instances.push(inst);
    }

    // 书排右端放置精巧黄铜 L 型书立 + 底部接触投影，让 2 本 / 4 本书排立得优雅稳当
    const bookendZ = Math.min(bay.zEnd, cursorZ + 0.018);
    const beVert = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.14, 0.16, 0.008)), brassMat);
    beVert.position.set(bay.xCenter, bay.shelfY + 0.082, bookendZ);
    beVert.castShadow = true;
    const beBase = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.14, 0.008, 0.085)), brassMat);
    beBase.position.set(bay.xCenter, bay.shelfY + 0.004, bookendZ + 0.04);
    const beShadowGeo = trackGeo(new THREE.PlaneGeometry(0.18, 0.12));
    beShadowGeo.rotateX(-Math.PI * 0.5);
    const beShadow = new THREE.Mesh(beShadowGeo, bookendShadowMat);
    beShadow.position.set(bay.xCenter, bay.shelfY + 0.0015, bookendZ + 0.036);
    beShadow.renderOrder = 1;
    root.add(beVert, beBase, beShadow);
  }

  // ---- 抽书悬停 & 飞向书桌状态机 ----
  let hoveredId: string | null = null;
  let activeInst: BookInstance | null = null;
  let phase: BookAnimPhase = 'idle';
  let phaseStart = 0;
  let phaseDur = 920;
  let arrivalCb: ((book: RoomBook) => void) | null = null;
  let returnCb: (() => void) | null = null;
  const startPos = new THREE.Vector3();
  const startQuat = new THREE.Quaternion();

  const easeInOutCubic = (x: number) =>
    x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;

  return {
    group: root,
    hitMeshes,
    getBookById(id) {
      return bookMap.get(id)?.book;
    },
    setHovered(id) {
      hoveredId = id;
    },
    getActiveBook() {
      return activeInst?.book ?? null;
    },
    openBook(id, reducedMotion, onArrived) {
      const target = bookMap.get(id);
      if (!target) return;

      // 若已有别的书在桌上，先瞬间归位它
      if (activeInst && activeInst !== target) {
        activeInst.group.position.copy(activeInst.homePos);
        activeInst.group.quaternion.copy(activeInst.homeQuat);
        activeInst.frontPivot.rotation.y = 0;
        activeInst.coverMat.emissiveIntensity = 0;
      }

      activeInst = target;
      startPos.copy(target.group.position);
      startQuat.copy(target.group.quaternion);
      arrivalCb = onArrived;
      returnCb = null;
      phase = 'flyingToDesk';
      phaseStart = performance.now();
      phaseDur = reducedMotion ? 120 : 1220;
    },
    closeBook(reducedMotion, onReturned) {
      if (!activeInst || phase === 'idle' || phase === 'returningToShelf') {
        onReturned?.();
        return;
      }
      startPos.copy(activeInst.group.position);
      startQuat.copy(activeInst.group.quaternion);
      returnCb = onReturned ?? null;
      arrivalCb = null;
      phase = 'returningToShelf';
      phaseStart = performance.now();
      phaseDur = reducedMotion ? 120 : 1080;
    },
    tick(dt, now) {
      // 1. 书架悬停抽出动画（平滑滑出 + 微微仰角 + 微光）
      const damp = 1 - Math.exp(-12 * Math.min(dt, 0.05));
      for (const inst of instances) {
        if (inst === activeInst && phase !== 'idle') {
          inst.shadowMat.opacity = 0;
          continue;
        }
        const want = inst.book.id === hoveredId ? 1 : 0;
        inst.hoverAmt += (want - inst.hoverAmt) * damp;
        inst.shadowMat.opacity = 0.52 * (1 - inst.hoverAmt);
        if (inst.hoverAmt > 0.001 || want > 0) {
          inst.group.position.set(
            inst.homePos.x + inst.hoverAmt * 0.105,
            inst.homePos.y + inst.hoverAmt * 0.014,
            inst.homePos.z,
          );
          inst.group.rotation.set(0, 0, -inst.hoverAmt * 0.085);
          inst.coverMat.emissiveIntensity = inst.hoverAmt * 0.24;
        } else {
          inst.group.position.copy(inst.homePos);
          inst.group.quaternion.copy(inst.homeQuat);
          inst.coverMat.emissiveIntensity = 0;
        }
      }

      // 2. 抽书飞往书桌 & 翻开封面动画
      if (activeInst && phase === 'flyingToDesk') {
        const p = Math.min(1, (now - phaseStart) / Math.max(phaseDur, 1));
        const k = easeInOutCubic(p);

        p0.copy(startPos);
        p2.copy(DESK_READ_POS);
        p1.set(-2.02, Math.max(startPos.y + 0.36, 1.56), -1.68);

        tmpA.lerpVectors(p0, p1, k);
        tmpB.lerpVectors(p1, p2, k);
        activeInst.group.position.lerpVectors(tmpA, tmpB, k);
        activeInst.group.quaternion.slerpQuaternions(startQuat, deskFlatQuat, k);
        activeInst.coverMat.emissiveIntensity = (1 - k) * 0.22;

        // 书接近落桌最后 30% 时平稳翻开硬壳封面
        const openT = Math.max(0, (p - 0.68) / 0.32);
        activeInst.frontPivot.rotation.y = -easeInOutCubic(openT) * Math.PI * 0.86;

        if (p >= 1) {
          phase = 'openOnDesk';
          activeInst.group.position.copy(DESK_READ_POS);
          activeInst.group.quaternion.copy(deskFlatQuat);
          activeInst.frontPivot.rotation.y = -Math.PI * 0.86;
          const cb = arrivalCb;
          arrivalCb = null;
          cb?.(activeInst.book);
        }
      } else if (activeInst && phase === 'returningToShelf') {
        const p = Math.min(1, (now - phaseStart) / Math.max(phaseDur, 1));
        const k = easeInOutCubic(p);

        // 先合上封面再优雅飞回书架原位
        const closeT = Math.min(1, p / 0.35);
        activeInst.frontPivot.rotation.y = -(1 - easeInOutCubic(closeT)) * Math.PI * 0.86;

        p0.copy(startPos);
        p2.copy(activeInst.homePos);
        p1.set(-2.06, Math.max(activeInst.homePos.y + 0.34, 1.5), -1.65);

        tmpA.lerpVectors(p0, p1, k);
        tmpB.lerpVectors(p1, p2, k);
        activeInst.group.position.lerpVectors(tmpA, tmpB, k);
        activeInst.group.quaternion.slerpQuaternions(startQuat, activeInst.homeQuat, k);

        if (p >= 1) {
          activeInst.group.position.copy(activeInst.homePos);
          activeInst.group.quaternion.copy(activeInst.homeQuat);
          activeInst.frontPivot.rotation.y = 0;
          activeInst.coverMat.emissiveIntensity = 0;
          activeInst = null;
          phase = 'idle';
          const cb = returnCb;
          returnCb = null;
          cb?.();
        }
      }
    },
    dispose() {
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
      for (const t of textures) t.dispose();
    },
  };
}
