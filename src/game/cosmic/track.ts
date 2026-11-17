import * as THREE from 'three';
import { STAR_NODES, type StarNodeSpec } from '../../door/starmap';
import { buildStargatePair, createStargatePortalMaterial } from './models';

export const COSMOS_SCALE = 5.0;
export const HOLE_SCALE_MULT = 3.8;

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
  sampleAtS: (s: number, out: TrackSample) => void;
  evaluateHub: (pos: THREE.Vector3) => HubProximity;
  setTime: (simTime: number) => void;
  dispose: () => void;
}

const WORLD_UP = new THREE.Vector3(0, 1, 0);

// 沿斯隆长城串联五大星系的三维深空长距巡航赛道（原始星图坐标再乘以 COSMOS_SCALE，令微粒飞船置身浩瀚星海）
const RAW_WAYPOINTS: Array<[number, number, number]> = [
  [38, 22, 72],    // 发车门：远眺整座斯隆长城与基地星系微光
  [22, 10, 36],    // 漫长接近：星系核光渐明，黑洞在视野远端缓缓显形
  [-15, 2, -5],    // 掠过基地巨型黑洞 [0,0,0] 与空间站
  [-42, -18, 16],  // 西南深空长桥
  [-46, -24, 35],  // 掠过关于星系 [-60,-26,22] 浑仪巨环
  [-86, -4, 14],   // 拐向西北望向牧夫空洞边际
  [-92, 26, -18],  // 西北星云长坡爬升
  [-53, 42, -26],  // 掠过画廊星系 [-68,40,-40] 玫瑰云带
  [-42, 62, -74],  // 登上斯隆长城最高脊背
  [0, 72, -96],    // 长城主拱巅：俯瞰绵延十亿光年的星丝巨壁
  [33, 60, -58],   // 掠过标签星系 [46,58,-76] 翡翠双环
  [78, 34, -62],   // 东北超长外弯转折
  [88, -12, -14],  // 东南大尺度星流俯冲走廊
  [49, -46, 20],   // 掠过游戏星系 [64,-50,30] 电离核心
  [28, -32, 48],   // 爬离游戏星系
  [18, -6, 66],    // 斯隆终点凯旋门
];

export function buildCosmicTrack(): CosmicTrack {
  const curve = new THREE.CatmullRomCurve3(
    RAW_WAYPOINTS.map((p) => new THREE.Vector3(p[0] * COSMOS_SCALE, p[1] * COSMOS_SCALE, p[2] * COSMOS_SCALE)),
    false,
    'catmullrom',
    0.55,
  );
  const totalLength = curve.getLength();

  // 预计算各星系在赛道上的最近里程点
  const milestones = STAR_NODES.map((node) => {
    const np = new THREE.Vector3(...node.position).multiplyScalar(COSMOS_SCALE);
    let bestU = 0;
    let bestD = Infinity;
    const pTmp = new THREE.Vector3();
    for (let i = 0; i <= 480; i++) {
      const u = i / 480;
      curve.getPointAt(u, pTmp);
      const d = pTmp.distanceTo(np);
      if (d < bestD) {
        bestD = d;
        bestU = u;
      }
    }
    return { node, u: bestU, s: bestU * totalLength, closestDist: bestD };
  });

  // 给右下角迷你星图用的低采样赛道点（还原回星图原生坐标系）
  const miniPoints = Array.from({ length: 64 }, (_, i) => {
    const p = curve.getPointAt(i / 63);
    return { x: p.x / COSMOS_SCALE, y: p.y / COSMOS_SCALE, z: p.z / COSMOS_SCALE };
  });

  // 赛道左右发光导引细线（宏大星空走廊双轨 + 终点巨环）
  const railsGroup = new THREE.Group();
  const RAIL_STEPS = 480;
  const RAIL_HALF = 16.5;
  const leftArr = new Float32Array((RAIL_STEPS + 1) * 3);
  const rightArr = new Float32Array((RAIL_STEPS + 1) * 3);
  const tickPts: number[] = [];

  const pt = new THREE.Vector3();
  const tan = new THREE.Vector3();
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();

  for (let i = 0; i <= RAIL_STEPS; i++) {
    const u = i / RAIL_STEPS;
    curve.getPointAt(u, pt);
    curve.getTangentAt(u, tan).normalize();
    right.crossVectors(tan, WORLD_UP);
    if (right.lengthSq() < 1e-4) right.set(1, 0, 0);
    right.normalize();
    up.crossVectors(right, tan).normalize();

    const lx = pt.x - right.x * RAIL_HALF;
    const ly = pt.y - right.y * RAIL_HALF;
    const lz = pt.z - right.z * RAIL_HALF;
    const rx = pt.x + right.x * RAIL_HALF;
    const ry = pt.y + right.y * RAIL_HALF;
    const rz = pt.z + right.z * RAIL_HALF;

    leftArr[i * 3] = lx;
    leftArr[i * 3 + 1] = ly;
    leftArr[i * 3 + 2] = lz;
    rightArr[i * 3] = rx;
    rightArr[i * 3 + 1] = ry;
    rightArr[i * 3 + 2] = rz;

    if (i % 8 === 0) {
      // 宽阔航道底横标线
      tickPts.push(
        pt.x - right.x * 9.0 - up.x * 5.6,
        pt.y - right.y * 9.0 - up.y * 5.6,
        pt.z - right.z * 9.0 - up.z * 5.6,
        pt.x + right.x * 9.0 - up.x * 5.6,
        pt.y + right.y * 9.0 - up.y * 5.6,
        pt.z + right.z * 9.0 - up.z * 5.6,
      );
    }
  }

  const leftGeo = new THREE.BufferGeometry();
  leftGeo.setAttribute('position', new THREE.BufferAttribute(leftArr, 3));
  const rightGeo = new THREE.BufferGeometry();
  rightGeo.setAttribute('position', new THREE.BufferAttribute(rightArr, 3));
  const tickGeo = new THREE.BufferGeometry();
  tickGeo.setAttribute('position', new THREE.Float32BufferAttribute(tickPts, 3));

  const railMat = new THREE.LineBasicMaterial({
    color: 0x9ecaff,
    transparent: true,
    opacity: 0.2,
    depthWrite: false,
  });
  const tickMat = new THREE.LineBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.11,
    depthWrite: false,
  });

  const leftLine = new THREE.Line(leftGeo, railMat);
  const rightLine = new THREE.Line(rightGeo, railMat);
  const ticksLine = new THREE.LineSegments(tickGeo, tickMat);

  // 终点凯旋星际之门（宏伟双层巨构星门 + 金色传送光环）
  const endPos = curve.getPointAt(1);
  const endTan = curve.getTangentAt(1).normalize();
  const finishPair = buildStargatePair(2.15);
  const finishHullMat = new THREE.MeshStandardMaterial({
    color: 0xd8c39b,
    emissive: 0x3f2908,
    emissiveIntensity: 0.32,
    roughness: 0.34,
    metalness: 0.78,
  });
  const finishPortalMat = createStargatePortalMaterial(2.15, 0xffd28a);
  const finishGate = new THREE.Group();
  finishGate.add(
    new THREE.Mesh(finishPair.hull, finishHullMat),
    new THREE.Mesh(finishPair.portal, finishPortalMat),
  );
  finishGate.position.copy(endPos);
  finishGate.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), endTan);

  railsGroup.add(leftLine, rightLine, ticksLine, finishGate);

  function setTime(simTime: number) {
    finishPortalMat.uniforms.uTime.value = simTime;
  }

  function sampleAtS(s: number, out: TrackSample) {
    const clampedS = Math.min(Math.max(s, 0), totalLength);
    const u = clampedS / totalLength;
    out.u = u;
    out.s = clampedS;
    curve.getPointAt(u, out.pos);
    curve.getTangentAt(u, out.forward).normalize();
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
    const voronoiT = Math.min(Math.max((secondDist - bestDist) / 70, 0), 1);
    const voronoiBlend = voronoiT * voronoiT * (3 - 2 * voronoiT);

    // 极远端先泛起星系核辉光（320 -> 135），随后在漫长逼近中缓缓凝结出事件视界与吸积盘（245 -> 92）
    const glowT = Math.min(Math.max((320 - bestDist) / 185, 0), 1);
    const nucleusGlow = glowT * glowT * (3 - 2 * glowT) * 0.62 * voronoiBlend;

    const holeT = Math.min(Math.max((245 - bestDist) / 153, 0), 1);
    const rawAlpha = holeT * holeT * (3 - 2 * holeT);
    const alpha = Math.pow(rawAlpha, 1.35) * voronoiBlend;

    const slingshot = bestDist < 115 && alpha > 0.65;
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
    curve,
    totalLength,
    milestones,
    miniPoints,
    railsGroup,
    sampleAtS,
    evaluateHub,
    setTime,
    dispose,
  };
}
