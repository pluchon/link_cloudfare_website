import * as THREE from 'three';
import { STAR_NODES, type StarNodeSpec } from '../../door/starmap';
import { buildStargatePair, createStargatePortalMaterial } from './models';

export const COSMOS_SCALE = 11.5;
export const HOLE_SCALE_MULT = 5.4;
const TARGET_TOTAL_LENGTH = 8600;

export interface TrackSample {
  u: number;
  s: number;
  pos: THREE.Vector3;
  forward: THREE.Vector3;
  right: THREE.Vector3;
  up: THREE.Vector3;
}

export interface HubProximity {
  node: StarNodeSpec;
  dist: number;
  alpha: number;
  nucleusGlow: number;
  slingshot: boolean;
}

export interface CosmicTrack {
  curve: THREE.CatmullRomCurve3;
  totalLength: number;
  milestones: Array<{ node: StarNodeSpec; u: number; s: number; closestDist: number }>;
  miniPoints: Array<{ x: number; y: number; z: number }>;
  railsGroup: THREE.Group;
  finishPos: THREE.Vector3;
  finishDir: THREE.Vector3;
  sampleAtS: (s: number, out: TrackSample) => void;
  evaluateHub: (pos: THREE.Vector3) => HubProximity;
  regenerate: () => void;
  triggerFinishGate: (simTime: number) => void;
  setTime: (simTime: number) => void;
  dispose: () => void;
}

const WORLD_UP = new THREE.Vector3(0, 1, 0);

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

export function buildCosmicTrack(): CosmicTrack {
  const railsGroup = new THREE.Group();
  const RAIL_STEPS = 960;
  const RAIL_HALF = 16.5;

  const railMat = new THREE.LineBasicMaterial({
    color: 0x9ecaff,
    transparent: true,
    opacity: 0.085,
    depthWrite: false,
  });
  const tickMat = new THREE.LineBasicMaterial({
    color: 0xb6d6ff,
    transparent: true,
    opacity: 0.045,
    depthWrite: false,
  });

  const leftGeo = new THREE.BufferGeometry();
  const rightGeo = new THREE.BufferGeometry();
  const tickGeo = new THREE.BufferGeometry();
  const leftArr = new Float32Array((RAIL_STEPS + 1) * 3);
  const rightArr = new Float32Array((RAIL_STEPS + 1) * 3);
  leftGeo.setAttribute('position', new THREE.BufferAttribute(leftArr, 3));
  rightGeo.setAttribute('position', new THREE.BufferAttribute(rightArr, 3));

  const leftLine = new THREE.Line(leftGeo, railMat);
  const rightLine = new THREE.Line(rightGeo, railMat);
  const ticksLine = new THREE.LineSegments(tickGeo, tickMat);

  // 终点凯旋星际之门（宏伟双层巨构星门 + 金色传送光环）
  const finishPair = buildStargatePair(2.9);
  const finishHullMat = new THREE.MeshStandardMaterial({
    color: 0xd8c39b,
    emissive: 0x3f2908,
    emissiveIntensity: 0.36,
    roughness: 0.32,
    metalness: 0.8,
  });
  const finishPortalMat = createStargatePortalMaterial(2.9, 0xffd28a);
  const finishGate = new THREE.Group();
  finishGate.add(
    new THREE.Mesh(finishPair.hull, finishHullMat),
    new THREE.Mesh(finishPair.portal, finishPortalMat),
  );
  railsGroup.add(leftLine, rightLine, ticksLine, finishGate);

  const hubPositions = STAR_NODES.map((node) => ({
    node,
    pos: new THREE.Vector3(...node.position).multiplyScalar(COSMOS_SCALE),
  }));

  const curveState: {
    curve: THREE.CatmullRomCurve3;
    totalLength: number;
    milestones: Array<{ node: StarNodeSpec; u: number; s: number; closestDist: number }>;
    miniPoints: Array<{ x: number; y: number; z: number }>;
    finishPos: THREE.Vector3;
    finishDir: THREE.Vector3;
  } = {
    curve: new THREE.CatmullRomCurve3([new THREE.Vector3(), new THREE.Vector3(0, 0, -100)]),
    totalLength: TARGET_TOTAL_LENGTH,
    milestones: [],
    miniPoints: [],
    finishPos: new THREE.Vector3(),
    finishDir: new THREE.Vector3(0, 0, -1),
  };

  const pt = new THREE.Vector3();
  const tan = new THREE.Vector3();
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  const zAxis = new THREE.Vector3(0, 0, 1);

  /** 随机生成一条经过所有已知星系且总航程恒定约 8600 的深空遨游航线 */
  function buildProceduralRoute(seed: number) {
    const rand = mulberry32(seed);
    const outer = hubPositions.slice(1);
    for (let i = outer.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const tmp = outer[i];
      outer[i] = outer[j];
      outer[j] = tmp;
    }
    const tour = [hubPositions[0], ...outer];

    // 起点悬停在基地外围宏大星域前缘，望向基地与斯隆长城巨壁
    const startAng = (rand() - 0.5) * 0.9;
    const startPos = new THREE.Vector3(
      Math.sin(startAng) * 340 + 360,
      210 + (rand() - 0.5) * 80,
      Math.cos(startAng) * 360 + 520,
    );

    // 为每座星系生成带安全近心掠过偏置（145..185 单位）与切向出射的航点，绝不撞入视界
    const flybys = tour.map((hub, idx) => {
      const prevCenter = idx === 0 ? startPos : tour[idx - 1].pos;
      const nextCenter = idx + 1 < tour.length ? tour[idx + 1].pos : prevCenter;
      const chord = nextCenter.clone().sub(prevCenter);
      if (chord.lengthSq() < 1) chord.set(-1, 0, -1);
      chord.normalize();

      const sideVec = new THREE.Vector3().crossVectors(chord, WORLD_UP);
      if (sideVec.lengthSq() < 1e-4) sideVec.set(1, 0, 0);
      sideVec.normalize();
      const perpUp = new THREE.Vector3().crossVectors(sideVec, chord).normalize();

      const flyAngle = rand() * Math.PI * 2;
      const flyDist = 148 + rand() * 34;
      const offset = sideVec
        .clone()
        .multiplyScalar(Math.cos(flyAngle) * flyDist)
        .addScaledVector(perpUp, Math.sin(flyAngle) * flyDist * 0.52);

      const passPos = hub.pos.clone().add(offset);
      const tanDir = chord
        .clone()
        .addScaledVector(sideVec, (rand() - 0.5) * 0.35)
        .normalize();
      return { hub, passPos, tanDir };
    });

    // 每个星系间生成两条随机外弯大跨度遨游弧线向量（含安全避让非当前黑洞机制）
    interface DetourMeta {
      midA: THREE.Vector3;
      midB: THREE.Vector3;
      outDirA: THREE.Vector3;
      outDirB: THREE.Vector3;
      weightA: number;
      weightB: number;
    }

    const pushOutOfHoles = (p: THREE.Vector3) => {
      for (const h of hubPositions) {
        const delta = p.clone().sub(h.pos);
        const d = delta.length();
        if (d < 290) {
          if (d < 1e-3) delta.set(1, 0.3, 0);
          p.copy(h.pos).add(delta.normalize().multiplyScalar(295));
        }
      }
      return p;
    };

    const legs: DetourMeta[] = [];
    for (let i = 0; i < flybys.length; i++) {
      const p0 = i === 0 ? startPos : flybys[i - 1].passPos;
      const p1 = flybys[i].passPos;
      const span = p1.clone().sub(p0);
      const fwd = span.clone().normalize();
      const side = new THREE.Vector3().crossVectors(fwd, WORLD_UP);
      if (side.lengthSq() < 1e-4) side.set(1, 0, 0);
      side.normalize();
      const upOrtho = new THREE.Vector3().crossVectors(side, fwd).normalize();

      const makeOutDir = (baseSign: number) => {
        const radial = p0.clone().lerp(p1, 0.5).setY(0);
        if (radial.lengthSq() < 1) radial.set(1, 0, 1);
        radial.normalize();
        return side
          .clone()
          .multiplyScalar(baseSign * (0.7 + rand() * 0.6))
          .addScaledVector(upOrtho, (rand() - 0.35) * 1.1)
          .addScaledVector(radial, 0.55 + rand() * 0.55)
          .normalize();
      };

      const sign = rand() < 0.5 ? 1 : -1;
      legs.push({
        midA: p0.clone().lerp(p1, 0.34),
        midB: p0.clone().lerp(p1, 0.68),
        outDirA: makeOutDir(sign),
        outDirB: makeOutDir(rand() < 0.65 ? sign : -sign),
        weightA: 0.72 + rand() * 0.56,
        weightB: 0.72 + rand() * 0.56,
      });
    }

    // 末尾出港遨游直道通往斯隆凯旋星门
    const last = flybys[flybys.length - 1];
    const exitFwd = last.passPos.clone().setY(0).normalize();
    if (exitFwd.lengthSq() < 1e-4) exitFwd.set(0.3, 0, 0.95);
    const exitMid = pushOutOfHoles(
      last.passPos
        .clone()
        .addScaledVector(last.tanDir, 420)
        .addScaledVector(exitFwd, 260)
        .add(new THREE.Vector3(0, 65, 0)),
    );
    const exitEnd = pushOutOfHoles(
      exitMid
        .clone()
        .addScaledVector(last.tanDir, 480)
        .addScaledVector(exitFwd, 310),
    );
    const outDirExit = exitFwd.clone().add(new THREE.Vector3(0, 0.25, 0)).normalize();

    const makeCurveWithBulge = (bulge: number) => {
      const pts: THREE.Vector3[] = [startPos.clone()];
      for (let i = 0; i < flybys.length; i++) {
        const leg = legs[i];
        const aPt = pushOutOfHoles(leg.midA.clone().addScaledVector(leg.outDirA, bulge * leg.weightA));
        const bPt = pushOutOfHoles(leg.midB.clone().addScaledVector(leg.outDirB, bulge * leg.weightB));
        pts.push(aPt, bPt, flybys[i].passPos.clone());
      }
      pts.push(
        pushOutOfHoles(exitMid.clone().addScaledVector(outDirExit, bulge * 0.55)),
        pushOutOfHoles(exitEnd.clone().addScaledVector(outDirExit, bulge * 0.85)),
      );
      return new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.52);
    };

    // 二分调参外弯跨度，确保总路程恒定在 TARGET_TOTAL_LENGTH (~8600 ≈ 748 Mpc)
    let lo = 20;
    let hi = 780;
    let chosen = makeCurveWithBulge(260);
    for (let iter = 0; iter < 11; iter++) {
      const mid = (lo + hi) * 0.5;
      const cand = makeCurveWithBulge(mid);
      const len = cand.getLength();
      chosen = cand;
      if (Math.abs(len - TARGET_TOTAL_LENGTH) < 22) break;
      if (len < TARGET_TOTAL_LENGTH) lo = mid;
      else hi = mid;
    }

    curveState.curve = chosen;
    curveState.totalLength = chosen.getLength();

    // 按轨迹实测最近点生成本次巡航的星系路程标定与排序
    const computedMilestones = hubPositions.map((hub) => {
      let bestU = 0;
      let bestD = Infinity;
      const pTmp = new THREE.Vector3();
      for (let i = 0; i <= 640; i++) {
        const u = i / 640;
        chosen.getPointAt(u, pTmp);
        const d = pTmp.distanceTo(hub.pos);
        if (d < bestD) {
          bestD = d;
          bestU = u;
        }
      }
      return { node: hub.node, u: bestU, s: bestU * curveState.totalLength, closestDist: bestD };
    });
    computedMilestones.sort((a, b) => a.s - b.s);
    curveState.milestones = computedMilestones;

    curveState.miniPoints = Array.from({ length: 76 }, (_, i) => {
      const p = chosen.getPointAt(i / 75);
      return { x: p.x / COSMOS_SCALE, y: p.y / COSMOS_SCALE, z: p.z / COSMOS_SCALE };
    });

    // 重建左右导引轨道与终点凯旋星门姿态
    const tickPts: number[] = [];
    for (let i = 0; i <= RAIL_STEPS; i++) {
      const u = i / RAIL_STEPS;
      chosen.getPointAt(u, pt);
      chosen.getTangentAt(u, tan).normalize();
      right.crossVectors(tan, WORLD_UP);
      if (right.lengthSq() < 1e-4) right.set(1, 0, 0);
      right.normalize();
      up.crossVectors(right, tan).normalize();

      leftArr[i * 3] = pt.x - right.x * RAIL_HALF;
      leftArr[i * 3 + 1] = pt.y - right.y * RAIL_HALF;
      leftArr[i * 3 + 2] = pt.z - right.z * RAIL_HALF;
      rightArr[i * 3] = pt.x + right.x * RAIL_HALF;
      rightArr[i * 3 + 1] = pt.y + right.y * RAIL_HALF;
      rightArr[i * 3 + 2] = pt.z + right.z * RAIL_HALF;

      if (i % 12 === 0) {
        tickPts.push(
          pt.x - right.x * 10.5 - up.x * 6.4,
          pt.y - right.y * 10.5 - up.y * 6.4,
          pt.z - right.z * 10.5 - up.z * 6.4,
          pt.x + right.x * 10.5 - up.x * 6.4,
          pt.y + right.y * 10.5 - up.y * 6.4,
          pt.z + right.z * 10.5 - up.z * 6.4,
        );
      }
    }

    (leftGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (rightGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    tickGeo.setAttribute('position', new THREE.Float32BufferAttribute(tickPts, 3));
    leftGeo.computeBoundingSphere();
    rightGeo.computeBoundingSphere();
    tickGeo.computeBoundingSphere();

    chosen.getPointAt(1, curveState.finishPos);
    chosen.getTangentAt(1, curveState.finishDir).normalize();
    finishGate.position.copy(curveState.finishPos);
    finishGate.quaternion.setFromUnitVectors(zAxis, curveState.finishDir);
  }

  buildProceduralRoute(20261119);

  function regenerate() {
    const seed = ((Date.now() & 0xffffffff) ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
    buildProceduralRoute(seed);
  }

  function triggerFinishGate(simTime: number) {
    finishPortalMat.uniforms.uFlashTime.value = simTime;
  }

  function setTime(simTime: number) {
    finishPortalMat.uniforms.uTime.value = simTime;
  }

  function sampleAtS(s: number, out: TrackSample) {
    const clampedS = Math.min(Math.max(s, 0), curveState.totalLength);
    const u = clampedS / curveState.totalLength;
    out.u = u;
    out.s = clampedS;
    curveState.curve.getPointAt(u, out.pos);
    curveState.curve.getTangentAt(u, out.forward).normalize();
    out.right.crossVectors(out.forward, WORLD_UP);
    if (out.right.lengthSq() < 1e-4) out.right.set(1, 0, 0);
    out.right.normalize();
    out.up.crossVectors(out.right, out.forward).normalize();
  }

  const hubVec = new THREE.Vector3();
  function evaluateHub(pos: THREE.Vector3): HubProximity {
    let bestNode = STAR_NODES[0];
    let bestDist = Infinity;
    let secondDist = Infinity;
    for (const node of STAR_NODES) {
      hubVec.set(...node.position).multiplyScalar(COSMOS_SCALE);
      const d = pos.distanceTo(hubVec);
      if (d < bestDist) {
        secondDist = bestDist;
        bestDist = d;
        bestNode = node;
      } else if (d < secondDist) {
        secondDist = d;
      }
    }

    // 相邻星系中界平滑消融，确保切换目标黑洞时严格零跳变
    const voronoiT = Math.min(Math.max((secondDist - bestDist) / 170, 0), 1);
    const voronoiBlend = voronoiT * voronoiT * (3 - 2 * voronoiT);

    // 极远端先泛起星系核辉光（680 -> 270），随后在漫长逼近中缓缓凝结出事件视界与吸积盘（510 -> 195）
    const glowT = Math.min(Math.max((680 - bestDist) / 410, 0), 1);
    const nucleusGlow = glowT * glowT * (3 - 2 * glowT) * 0.62 * voronoiBlend;

    const holeT = Math.min(Math.max((510 - bestDist) / 315, 0), 1);
    const rawAlpha = holeT * holeT * (3 - 2 * holeT);
    const alpha = Math.pow(rawAlpha, 1.35) * voronoiBlend;

    const slingshot = bestDist < 250 && alpha > 0.6;
    return { node: bestNode, dist: bestDist, alpha, nucleusGlow, slingshot };
  }

  function dispose() {
    leftGeo.dispose();
    rightGeo.dispose();
    tickGeo.dispose();
    finishPair.hull.dispose();
    finishPair.portal.dispose();
    railMat.dispose();
    tickMat.dispose();
    finishHullMat.dispose();
    finishPortalMat.dispose();
  }

  return {
    get curve() {
      return curveState.curve;
    },
    get totalLength() {
      return curveState.totalLength;
    },
    get milestones() {
      return curveState.milestones;
    },
    get miniPoints() {
      return curveState.miniPoints;
    },
    railsGroup,
    finishPos: curveState.finishPos,
    finishDir: curveState.finishDir,
    sampleAtS,
    evaluateHub,
    regenerate,
    triggerFinishGate,
    setTime,
    dispose,
  };
}
