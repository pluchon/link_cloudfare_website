import * as THREE from 'three';

export interface SculptedPair {
  frame: THREE.BufferGeometry;
  core: THREE.BufferGeometry;
}

/** 将多个静态几何体合并为单一平滑法线 BufferGeometry，显著压低绘制调用 */
export function mergeBuffers(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const expanded = parts.map((p) => {
    const g = p.index ? p.toNonIndexed() : p.clone();
    if (!g.attributes.normal) g.computeVertexNormals();
    p.dispose();
    return g;
  });

  let vertCount = 0;
  for (const g of expanded) {
    vertCount += g.attributes.position.count;
  }

  const pos = new Float32Array(vertCount * 3);
  const norm = new Float32Array(vertCount * 3);
  let offset = 0;
  for (const g of expanded) {
    const pArr = g.attributes.position.array as Float32Array;
    const nArr = g.attributes.normal.array as Float32Array;
    pos.set(pArr, offset * 3);
    norm.set(nArr, offset * 3);
    offset += g.attributes.position.count;
    g.dispose();
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(norm, 3));
  return out;
}

function tf(g: THREE.BufferGeometry, rx = 0, ry = 0, rz = 0, tx = 0, ty = 0, tz = 0, sx = 1, sy = 1, sz = 1) {
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(tx, ty, tz),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(sx, sy, sz),
  );
  g.applyMatrix4(m);
  return g;
}

// 1. 基地星系：深空舱匣仪（多环筋肋筒舱 + 双翼传感舵 + 倾斜稳定环）
function buildCapsulePair(): SculptedPair {
  const frameParts: THREE.BufferGeometry[] = [
    new THREE.CylinderGeometry(0.42, 0.46, 1.32, 8),
    tf(new THREE.CylinderGeometry(0.18, 0.42, 0.34, 8), 0, 0, 0, 0, 0.83, 0),
    tf(new THREE.CylinderGeometry(0.46, 0.22, 0.32, 8), 0, 0, 0, 0, -0.82, 0),
    tf(new THREE.TorusGeometry(0.5, 0.045, 6, 16), Math.PI * 0.5, 0, 0, 0, 0.4, 0),
    tf(new THREE.TorusGeometry(0.5, 0.045, 6, 16), Math.PI * 0.5, 0, 0, 0, -0.4, 0),
    tf(new THREE.BoxGeometry(1.55, 0.42, 0.06), 0.16, 0, 0),
    tf(new THREE.TorusGeometry(1.08, 0.048, 6, 24), Math.PI * 0.35, 0.25, 0),
  ];
  const coreParts: THREE.BufferGeometry[] = [
    tf(new THREE.TorusGeometry(0.48, 0.04, 6, 16), Math.PI * 0.5, 0, 0),
    tf(new THREE.OctahedronGeometry(0.32, 0), 0, 0, 0, 0, 1.08, 0),
    tf(new THREE.OctahedronGeometry(0.24, 0), 0, 0, 0, 0, -1.04, 0),
  ];
  return { frame: mergeBuffers(frameParts), core: mergeBuffers(coreParts) };
}

// 2. 关于星系：经纬浑天仪（三层嵌套斜角刻度环 + 极轴冠钉 + 中心核球）
function buildArmillaryPair(): SculptedPair {
  const frameParts: THREE.BufferGeometry[] = [
    tf(new THREE.TorusGeometry(1.05, 0.055, 8, 24), 0.35, 0.2, 0),
    tf(new THREE.TorusGeometry(0.84, 0.05, 8, 22), Math.PI * 0.48, 0.72, 0.2),
    tf(new THREE.TorusGeometry(0.64, 0.045, 6, 20), 1.15, -0.45, 0.4),
    tf(new THREE.CylinderGeometry(0.045, 0.045, 2.15, 6), 0, 0, 0.32),
    tf(new THREE.ConeGeometry(0.11, 0.22, 6), 0, 0, 0.32, -0.34, 1.02, 0),
    tf(new THREE.ConeGeometry(0.11, 0.22, 6), Math.PI, 0, 0.32, 0.34, -1.02, 0),
  ];
  const coreParts: THREE.BufferGeometry[] = [
    new THREE.IcosahedronGeometry(0.34, 0),
    tf(new THREE.TorusGeometry(0.46, 0.032, 6, 18), Math.PI * 0.5, 0, 0),
  ];
  return { frame: mergeBuffers(frameParts), core: mergeBuffers(coreParts) };
}

// 3. 画廊星系：多面星晶匣（八角底座托架 + 外框环 + 三柱斜生石英晶体簇）
function buildCrystalPair(): SculptedPair {
  const frameParts: THREE.BufferGeometry[] = [
    tf(new THREE.CylinderGeometry(0.58, 0.68, 0.26, 8), 0, 0, 0, 0, -0.68, 0),
    tf(new THREE.TorusGeometry(0.95, 0.048, 6, 22), Math.PI * 0.4, -0.22, 0),
    tf(new THREE.BoxGeometry(0.1, 0.65, 0.14), 0, 0, 0.45, 0.46, -0.36, 0),
    tf(new THREE.BoxGeometry(0.1, 0.65, 0.14), 0, 0, -0.45, -0.46, -0.36, 0),
    tf(new THREE.BoxGeometry(0.14, 0.65, 0.1), -0.45, 0, 0, 0, -0.36, 0.46),
  ];
  const coreParts: THREE.BufferGeometry[] = [
    tf(new THREE.CylinderGeometry(0.08, 0.24, 1.45, 6), 0.06, 0.2, -0.05, 0, 0.08, 0),
    tf(new THREE.CylinderGeometry(0.06, 0.18, 1.05, 6), -0.28, 0.5, 0.32, 0.22, -0.08, 0.16),
    tf(new THREE.CylinderGeometry(0.05, 0.17, 0.96, 6), 0.32, -0.3, -0.35, -0.24, -0.1, -0.12),
  ];
  return { frame: mergeBuffers(frameParts), core: mergeBuffers(coreParts) };
}

// 4. 标签星系：三叶棱谱仪（三向叶片导流罩 + 端环 + 双尖分光棱柱芯）
function buildPrismPair(): SculptedPair {
  const frameParts: THREE.BufferGeometry[] = [
    tf(new THREE.TorusGeometry(0.86, 0.048, 6, 20), Math.PI * 0.5, 0, 0, 0, 0.48, 0),
    tf(new THREE.TorusGeometry(0.86, 0.048, 6, 20), Math.PI * 0.5, 0, 0, 0, -0.48, 0),
  ];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    frameParts.push(
      tf(
        new THREE.BoxGeometry(0.14, 1.15, 0.44),
        0,
        a,
        0,
        Math.cos(a) * 0.72,
        0,
        Math.sin(a) * 0.72,
      ),
    );
  }
  const coreParts: THREE.BufferGeometry[] = [
    tf(new THREE.ConeGeometry(0.36, 0.85, 6), 0, 0, 0, 0, 0.42, 0),
    tf(new THREE.ConeGeometry(0.36, 0.85, 6), Math.PI, 0, 0, 0, -0.42, 0),
    tf(new THREE.TorusGeometry(1.12, 0.036, 6, 20), Math.PI * 0.28, 0.4, 0),
  ];
  return { frame: mergeBuffers(frameParts), core: mergeBuffers(coreParts) };
}

// 5. 游戏星系：悬臂量子方碑（立体棱梁外笼 + 四角锚舱 + 内嵌发光八面晶核）
function buildTesseractPair(): SculptedPair {
  const s = 0.62;
  const r = 0.055;
  const len = s * 2 + r;
  const frameParts: THREE.BufferGeometry[] = [];
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      frameParts.push(tf(new THREE.BoxGeometry(r, r, len), 0, 0, 0, sx * s, sy * s, 0));
    }
    for (const sz of [-1, 1]) {
      frameParts.push(tf(new THREE.BoxGeometry(r, len, r), 0, 0, 0, sx * s, 0, sz * s));
    }
  }
  for (const sy of [-1, 1]) {
    for (const sz of [-1, 1]) {
      frameParts.push(tf(new THREE.BoxGeometry(len, r, r), 0, 0, 0, 0, sy * s, sz * s));
    }
  }
  for (const cx of [-s, s]) {
    for (const cy of [-s, s]) {
      frameParts.push(tf(new THREE.OctahedronGeometry(0.12, 0), 0, 0, 0, cx, cy, cx));
    }
  }
  const coreParts: THREE.BufferGeometry[] = [
    tf(new THREE.BoxGeometry(0.56, 0.56, 0.56), 0.6, 0.78, 0.25),
    tf(new THREE.TorusGeometry(1.06, 0.036, 6, 22), Math.PI * 0.42, 0.3, 0),
  ];
  return { frame: mergeBuffers(frameParts), core: mergeBuffers(coreParts) };
}

// 6. 斯隆深空：远航先驱探测器（八角箔舱 + 抛物面天线碟 + 三脚馈源 + 双展太阳能翼 + 放射性电池桁架）
function buildProbePair(): SculptedPair {
  const dishPts = [
    new THREE.Vector2(0.0, 0.0),
    new THREE.Vector2(0.28, 0.05),
    new THREE.Vector2(0.56, 0.18),
    new THREE.Vector2(0.76, 0.34),
  ];
  const frameParts: THREE.BufferGeometry[] = [
    new THREE.CylinderGeometry(0.42, 0.46, 0.58, 8),
    tf(new THREE.LatheGeometry(dishPts, 14), 0, 0, 0, 0, 0.32, 0),
    tf(new THREE.CylinderGeometry(0.03, 0.05, 0.56, 6), 0, 0, 0, 0, 0.62, 0),
    tf(new THREE.CylinderGeometry(0.035, 0.035, 2.35, 6), 0, 0, Math.PI * 0.5),
    tf(new THREE.BoxGeometry(1.05, 0.04, 0.44), 0.32, 0, 0, 1.05, 0, 0),
    tf(new THREE.BoxGeometry(1.05, 0.04, 0.44), 0.32, 0, 0, -1.05, 0, 0),
    tf(new THREE.CylinderGeometry(0.09, 0.11, 0.54, 6), Math.PI * 0.5, 0, 0, 0, -0.15, 0.62),
  ];
  const coreParts: THREE.BufferGeometry[] = [
    tf(new THREE.OctahedronGeometry(0.18, 0), 0, 0, 0, 0, 0.92, 0),
    tf(new THREE.TorusGeometry(1.36, 0.04, 6, 24), Math.PI * 0.4, 0, 0),
  ];
  return { frame: mergeBuffers(frameParts), core: mergeBuffers(coreParts) };
}

// 6. 书房星域：观星仪赤道臂与悬窗晶匣
function buildStudyPair(): SculptedPair {
  const frameParts: THREE.BufferGeometry[] = [
    tf(new THREE.TorusGeometry(0.95, 0.055, 8, 24), Math.PI * 0.36, 0.25, 0),
    tf(new THREE.TorusGeometry(0.68, 0.045, 6, 20), Math.PI * 0.5, 0, 0.45),
    tf(new THREE.CylinderGeometry(0.11, 0.14, 1.55, 8), 0.15, 0.2, Math.PI * 0.48),
    tf(new THREE.BoxGeometry(1.1, 0.08, 1.1), 0, 0, 0, 0, -0.78, 0),
  ];
  const coreParts: THREE.BufferGeometry[] = [
    new THREE.OctahedronGeometry(0.32, 0),
    tf(new THREE.SphereGeometry(0.16, 10, 10), 0, 0, 0, 0, 0.48, 0),
  ];
  return { frame: mergeBuffers(frameParts), core: mergeBuffers(coreParts) };
}

export function buildCollectibleCatalogGeos(): Record<string, SculptedPair> {
  return {
    base: buildCapsulePair(),
    about: buildArmillaryPair(),
    gallery: buildCrystalPair(),
    tags: buildPrismPair(),
    game: buildTesseractPair(),
    study: buildStudyPair(),
    cosmos: buildProbePair(),
  };
}

export interface StargatePair {
  hull: THREE.BufferGeometry;
  portal: THREE.BufferGeometry;
}

/** 宏伟星际文明巨构星门（三环护甲 + 八向尖楔锁止巨塔 + 十六肋桁架 + 四向轴向加速导轨 + 能量涡旋膜面） */
export function buildStargatePair(scale = 1.0): StargatePair {
  const hullParts: THREE.BufferGeometry[] = [
    tf(new THREE.TorusGeometry(7.6, 0.34, 8, 32), 0, 0, 0, 0, 0, 0, scale, scale, scale),
    tf(new THREE.TorusGeometry(9.2, 0.24, 6, 32), 0, 0, 0, 0, 0, 0, scale, scale, scale),
    tf(new THREE.TorusGeometry(6.95, 0.14, 6, 32), 0, 0, 0, 0, 0, 0, scale, scale, scale),
    tf(new THREE.TorusGeometry(8.4, 0.13, 6, 16), 0, 0, 0, 0, 0, 0.78 * scale, scale, scale, scale),
    tf(new THREE.TorusGeometry(8.4, 0.13, 6, 16), 0, 0, 0, 0, 0, -0.78 * scale, scale, scale, scale),
  ];

  // 八座阶梯装甲楔形锁止巨塔（外锚座 + 前后护肩 + 向内尖楔导流角）
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    hullParts.push(
      tf(
        new THREE.BoxGeometry(1.18 * scale, 3.1 * scale, 1.52 * scale),
        0,
        0,
        a - Math.PI * 0.5,
        ca * 8.45 * scale,
        sa * 8.45 * scale,
        0,
      ),
    );
    hullParts.push(
      tf(
        new THREE.BoxGeometry(0.56 * scale, 2.15 * scale, 2.25 * scale),
        0,
        0,
        a - Math.PI * 0.5,
        ca * 8.95 * scale,
        sa * 8.95 * scale,
        0,
      ),
    );
    hullParts.push(
      tf(
        new THREE.ConeGeometry(0.54 * scale, 1.32 * scale, 4),
        0,
        0,
        a + Math.PI * 0.5,
        ca * 6.35 * scale,
        sa * 6.35 * scale,
        0,
      ),
    );
  }

  // 十六根径向环形桁架连肋
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + Math.PI / 16;
    hullParts.push(
      tf(
        new THREE.BoxGeometry(0.24 * scale, 1.65 * scale, 0.58 * scale),
        0,
        0,
        a - Math.PI * 0.5,
        Math.cos(a) * 8.4 * scale,
        Math.sin(a) * 8.4 * scale,
        0,
      ),
    );
  }

  // 四条纵向电磁场加速导臂（赋予星门沿航线纵深的立体工业巨物感）
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI * 0.25;
    hullParts.push(
      tf(
        new THREE.BoxGeometry(0.42 * scale, 0.85 * scale, 4.4 * scale),
        0,
        0,
        a,
        Math.cos(a) * 9.5 * scale,
        Math.sin(a) * 9.5 * scale,
        0,
      ),
    );
  }

  // 内环传送门特效载体（双侧电离环 + 中心薄纱事件膜 + 八枚锁止充能核）
  const portalParts: THREE.BufferGeometry[] = [
    tf(new THREE.TorusGeometry(6.75, 0.12, 6, 36), 0, 0, 0, 0, 0, 0, scale, scale, scale),
    tf(new THREE.TorusGeometry(6.35, 0.06, 6, 36), 0, 0, 0, 0, 0, 0.46 * scale, scale, scale, scale),
    tf(new THREE.TorusGeometry(6.35, 0.06, 6, 36), 0, 0, 0, 0, 0, -0.46 * scale, scale, scale, scale),
    tf(new THREE.CircleGeometry(6.72 * scale, 36), 0, 0, 0),
  ];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    portalParts.push(
      tf(
        new THREE.OctahedronGeometry(0.36 * scale, 0),
        0,
        0,
        a,
        Math.cos(a) * 6.75 * scale,
        Math.sin(a) * 6.75 * scale,
        0,
      ),
    );
  }

  return { hull: mergeBuffers(hullParts), portal: mergeBuffers(portalParts) };
}

/** 星环门中心旋涡能量膜与过门脉冲激波着色器（支持批处理 InstancedMesh 与单体主星门） */
export function createStargatePortalMaterial(gateScale = 1.0, baseHex = 0xffffff): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `
      #ifdef USE_INSTANCING
      attribute float aFlash;
      #endif
      uniform float uTime;
      uniform float uFlashTime;
      uniform vec3 uColor;
      varying vec3 vLocal;
      varying vec3 vCol;
      varying float vFlash;
      void main() {
        vLocal = position;
        vec4 p = vec4(position, 1.0);
        vCol = uColor;
        float flashT = uFlashTime;
        #ifdef USE_INSTANCING
        p = instanceMatrix * p;
        #ifdef USE_INSTANCING_COLOR
        vCol *= instanceColor;
        #endif
        flashT = aFlash;
        #endif
        float dt = uTime - flashT;
        vFlash = flashT >= 0.0 && dt >= 0.0 && dt < 0.85 ? pow(1.0 - dt / 0.85, 1.4) : 0.0;
        gl_Position = projectionMatrix * modelViewMatrix * p;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uGateScale;
      varying vec3 vLocal;
      varying vec3 vCol;
      varying float vFlash;
      void main() {
        float r = length(vLocal.xy) / max(uGateScale, 0.1);
        float ang = atan(vLocal.y, vLocal.x);
        float rim = smoothstep(5.4, 6.78, r);
        float coreRing = exp(-pow((r - 6.52) * 3.1, 2.0));
        float wave1 = 0.5 + 0.5 * sin(ang * 8.0 + r * 1.8 - uTime * 3.6);
        float wave2 = 0.5 + 0.5 * cos(ang * 5.0 - r * 2.4 + uTime * 2.3);
        float chevrons = pow(0.5 + 0.5 * cos(ang * 8.0), 10.0) * smoothstep(4.6, 6.85, r);
        float membrane = (0.045 + 0.065 * wave1 * wave2) * smoothstep(6.75, 4.2, r) * smoothstep(0.6, 4.8, r);
        float shockRing = vFlash * exp(-pow((r - (6.8 - (1.0 - vFlash) * 4.2)) * 2.1, 2.0)) * 2.2;
        float intensity = rim * (0.45 + 0.55 * wave1) + coreRing * 0.95 + chevrons * 0.9 + membrane + shockRing;
        vec3 col = mix(vCol, vec3(0.95, 0.99, 1.0), clamp(coreRing * 0.45 + vFlash * 0.85, 0.0, 1.0));
        float alpha = clamp(intensity * 0.78, 0.0, 0.95);
        if (alpha <= 0.004) discard;
        gl_FragColor = vec4(col * alpha * 1.15, alpha);
      }
    `,
    uniforms: {
      uTime: { value: 0 },
      uFlashTime: { value: -10 },
      uGateScale: { value: gateScale },
      uColor: { value: new THREE.Color(baseHex) },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

/** 保持画廊与游戏奇观坐标宏伟尺寸，供 track / world 复用 */
export function buildGateGeo(): THREE.BufferGeometry {
  return buildStargatePair(1.0).hull;
}

/** 活动星系核外围尘埃环面与旋涡进气云扇区网格（严格平铺 XZ 赤道面，留完整 uv 供片元噪声羽化为星云） */
export function buildTorusSectorGeo(): THREE.BufferGeometry {
  const segU = 14;
  const segV = 4;
  const arc = 1.15;
  const rMin = 0.82;
  const rMax = 1.18;
  const verts: number[] = [];
  const norms: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let iv = 0; iv <= segV; iv++) {
    const v = iv / segV;
    const r = rMin + (rMax - rMin) * v;
    for (let iu = 0; iu <= segU; iu++) {
      const u = iu / segU;
      const ang = (u - 0.5) * arc;
      verts.push(Math.cos(ang) * r, 0, Math.sin(ang) * r);
      norms.push(0, 1, 0);
      uvs.push(u, v);
    }
  }
  const stride = segU + 1;
  for (let iv = 0; iv < segV; iv++) {
    for (let iu = 0; iu < segU; iu++) {
      const a = iv * stride + iu;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(norms, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

/** 活动星系核相对论双极准直喷流几何体（±Y 磁极轴，开端渐张圆锥，留柱面 UV 绘磁螺旋与激波节） */
export function buildPolarJetGeo(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  // 北极 & 南极外层同步辐射茧锥 + 内层高能准直喷流芯
  for (const sgn of [1, -1]) {
    const outer = new THREE.CylinderGeometry(sgn > 0 ? 3.5 : 0.42, sgn > 0 ? 0.42 : 3.5, 34.0, 24, 1, true);
    outer.translate(0, sgn * 18.6, 0);
    if (sgn < 0) {
      // 令 uv.y 一律从黑洞近极 (0) 指向远端宇宙 (1)
      const uv = outer.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
    }
    const core = new THREE.CylinderGeometry(sgn > 0 ? 1.45 : 0.16, sgn > 0 ? 0.16 : 1.45, 36.0, 18, 1, true);
    core.translate(0, sgn * 19.6, 0);
    if (sgn < 0) {
      const uv = core.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
    }
    parts.push(outer, core);
  }
  const expanded = parts.map((p) => {
    const g = p.index ? p.toNonIndexed() : p.clone();
    p.dispose();
    return g;
  });
  let count = 0;
  for (const g of expanded) count += g.attributes.position.count;
  const pos = new Float32Array(count * 3);
  const norm = new Float32Array(count * 3);
  const uvArr = new Float32Array(count * 2);
  let off = 0;
  for (const g of expanded) {
    const c = g.attributes.position.count;
    pos.set(g.attributes.position.array as Float32Array, off * 3);
    norm.set(g.attributes.normal.array as Float32Array, off * 3);
    uvArr.set(g.attributes.uv.array as Float32Array, off * 2);
    off += c;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(norm, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uvArr, 2));
  return out;
}

/** 深空脉冲星航标塔（磁层偶极笼环 + 中子星双极锥形光束，用于星系际深空桥梁奇观） */
export function buildPulsarBeaconPair(): { hull: THREE.BufferGeometry; beams: THREE.BufferGeometry } {
  const hullParts: THREE.BufferGeometry[] = [
    new THREE.OctahedronGeometry(1.15, 1),
    tf(new THREE.TorusGeometry(4.2, 0.11, 6, 32), Math.PI * 0.5, 0, 0),
    tf(new THREE.TorusGeometry(3.4, 0.08, 6, 28), 0.35, 0, 0.45),
    tf(new THREE.TorusGeometry(2.6, 0.07, 6, 24), -0.35, 0, -0.45),
    tf(new THREE.TorusGeometry(5.6, 0.07, 6, 36), Math.PI * 0.5, 0.4, 0),
  ];
  const beamParts: THREE.BufferGeometry[] = [
    tf(new THREE.ConeGeometry(2.4, 18.0, 16, 1, true), 0, 0, Math.PI * 0.5, -10.2, 0, 0),
    tf(new THREE.ConeGeometry(2.4, 18.0, 16, 1, true), 0, 0, -Math.PI * 0.5, 10.2, 0, 0),
  ];
  return { hull: mergeBuffers(hullParts), beams: mergeBuffers(beamParts) };
}

// 图鉴面板每行最右侧的 28×28 CAD 轴测微缩建模图标
const SVG_MODELS: Record<string, string> = {
  base:
    '<polygon points="14,3 20,7 20,17 14,21 8,17 8,7" fill="currentColor" fill-opacity="0.14" />' +
    '<ellipse cx="14" cy="12" rx="10.5" ry="4.2" transform="rotate(-24 14 12)" />' +
    '<line x1="8" y1="9" x2="20" y2="9" />' +
    '<line x1="8" y1="15" x2="20" y2="15" />' +
    '<circle cx="14" cy="12" r="2.1" fill="currentColor" fill-opacity="0.45" />',
  about:
    '<circle cx="14" cy="14" r="9.5" />' +
    '<ellipse cx="14" cy="14" rx="9.5" ry="3.8" transform="rotate(28 14 14)" />' +
    '<ellipse cx="14" cy="14" rx="4.2" ry="9.5" transform="rotate(-18 14 14)" />' +
    '<line x1="11" y1="3.5" x2="17" y2="24.5" />' +
    '<circle cx="14" cy="14" r="2.2" fill="currentColor" fill-opacity="0.45" />',
  gallery:
    '<polygon points="14,3 17,15 14,19 11,15" fill="currentColor" fill-opacity="0.22" />' +
    '<polygon points="9,8 12,18 7,19" fill="currentColor" fill-opacity="0.12" />' +
    '<polygon points="19,9 21,19 16,18" fill="currentColor" fill-opacity="0.12" />' +
    '<polygon points="6,19 22,19 19,23.5 9,23.5" />' +
    '<ellipse cx="14" cy="13" rx="9.5" ry="3.4" transform="rotate(-16 14 13)" />',
  tags:
    '<polygon points="14,3 19,12 14,25 9,12" fill="currentColor" fill-opacity="0.18" />' +
    '<line x1="9" y1="12" x2="19" y2="12" />' +
    '<rect x="5" y="7" width="3.2" height="10" />' +
    '<rect x="19.8" y="7" width="3.2" height="10" />' +
    '<ellipse cx="14" cy="14" rx="10" ry="3.2" transform="rotate(22 14 14)" />',
  game:
    '<polygon points="14,3.5 23,8.5 23,19.5 14,24.5 5,19.5 5,8.5" />' +
    '<line x1="14" y1="14" x2="14" y2="24.5" />' +
    '<line x1="14" y1="14" x2="5" y2="8.5" />' +
    '<line x1="14" y1="14" x2="23" y2="8.5" />' +
    '<polygon points="14,9.5 18,14 14,18.5 10,14" fill="currentColor" fill-opacity="0.32" />',
  study:
    '<circle cx="14" cy="14" r="9" />' +
    '<ellipse cx="14" cy="14" rx="9" ry="3.5" transform="rotate(-32 14 14)" />' +
    '<line x1="6" y1="21.5" x2="22" y2="6.5" />' +
    '<polygon points="14,10 17.5,14 14,18 10.5,14" fill="currentColor" fill-opacity="0.28" />',
  cosmos:
    '<path d="M9,8 Q14,4 19,8 L16.5,11.5 L11.5,11.5 Z" fill="currentColor" fill-opacity="0.18" />' +
    '<rect x="10.5" y="12" width="7" height="7" fill="currentColor" fill-opacity="0.14" />' +
    '<rect x="3" y="13" width="6.5" height="3.2" />' +
    '<rect x="18.5" y="13" width="6.5" height="3.2" />' +
    '<line x1="14" y1="3" x2="14" y2="12" />' +
    '<line x1="14" y1="19" x2="14" y2="24.5" />',
};

export function getAtlasModelSvg(regionId: string): string {
  return SVG_MODELS[regionId] ?? SVG_MODELS.base;
}
