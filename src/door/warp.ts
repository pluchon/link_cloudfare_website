import * as THREE from 'three';

// 让场景里的几何体也服从黑洞的光学。星空和吸积盘在全屏着色器里追光线，自然是弯的；
// 星球、探测器这些是普通网格，不处理就一直走直线，俯冲时星空往前收拢、它们却纹丝不动。
//
// 这里按顶点改「看到它的方向」，距离不变，所以深度和遮挡还是对的：
// 1. 引力透镜：点质量透镜方程的主像 θ = (β + √(β² + 4θE²)) / 2，θE² = 2·Dls / (Dl·Ds)（Rs = 1）。
//    每个顶点各算各的，靠近黑洞背后的轨道、空间站、探测器和星球自然被切向拉伸弯曲成真正的相对论引力弧。
//    为什么此前大尺寸网格（如空间站）跨过视线轴心时会在中间鼓出一团大黑盘？
//    因为主像恒有 θ >= θE（爱因斯坦环以内是空的焦散孔），但当一个三角形的三个顶点分居视线轴两侧时，
//    顶点被推向爱因斯坦环上下两端（±θE），光栅化器用平面三角形直接连线，就会横穿 θ < θE 的禁区！
//    因此在片元着色器中做逐像素焦散孔校验（fTheta < 0.95 * exactTheta），在完整保留爱因斯坦环弧形形变的同时，
//    精准剔除横穿轴心焦散孔的非法三角面片弦内像素。
//    方程还有一个解 θ = (β - √(β² + 4θE²)) / 2：黑洞另一侧、爱因斯坦环以内的次像，是翻转的。
//    uWarpImage = 1 时走这个解，由 scene.ts 再画一遍。
// 2. 相对论光行差：和全屏着色器相反方向的同一个变换（那边是从看到的方向换回静止系），
//    再按多普勒因子调亮度和冷暖，前方变亮变蓝。
export const warpBeta = { value: 0 };
export const warpImage = { value: 0 };

export const warpGlsl = /* glsl */ `
  uniform float uWarpBeta;
  uniform float uWarpImage;
  varying vec3 vWarpTint;
  varying float vWarpCull;
  varying vec3 vWarpRel;
  varying vec3 vOrigRel;
  varying float vTe2;
  float warpCull = 0.0;

  // 这个顶点没有次像：扔到裁剪空间外面，再配合片元 discard 彻底裁掉跨界三角形
  vec4 warpClip(vec4 clip) {
    vWarpCull = warpCull;
    return warpCull > 0.5 ? vec4(2.0, 2.0, 2.0, 1.0) : clip;
  }

  vec3 spaceWarp(vec3 world) {
    vWarpTint = vec3(1.0);
    vTe2 = 0.0;
    warpCull = 0.0;
    vec3 rel = world - cameraPosition;
    vOrigRel = rel;
    float ds = length(rel);
    if (ds < 1e-4) {
      vWarpRel = rel;
      return world;
    }
    vec3 dir = rel / ds;

    float dl = length(cameraPosition);
    vec3 h = -cameraPosition / dl;
    float z = dot(world, h);
    if (z > 0.0) {
      float cb = clamp(dot(dir, h), -1.0, 1.0);
      float b = acos(cb);
      float te2 = min(2.0 * z / (dl * (dl + z)), 1.0);
      vTe2 = te2;
      vec3 side = dir - h * cb;
      float sl = length(side);
      // 极近轴平滑导引（0.14·θE）：完整保留广义相对论爱因斯坦环的强引力弯曲变形，
      // 同时让几乎完全侧视的轨道线在正后方拥有平滑的转弯曲率，配合 2048 段采样画出圆润光弧
      vec3 upH = vec3(0.0, 1.0, 0.0) - h * h.y;
      float upLen = length(upH);
      if (upLen > 1e-4) {
        upH /= upLen;
        float sy = dot(side, upH);
        float sgn = sy >= 0.0 ? 1.0 : -1.0;
        float minSy = 0.14 * sqrt(te2);
        if (abs(sy) < minSy) {
          side += upH * (sgn * sqrt(sy * sy + minSy * minSy) - sy);
          sl = length(side);
          b = max(b, sl);
          vOrigRel = (h * cb + side) * ds;
        }
      }
      float root = sqrt(b * b + 4.0 * te2);
      if (uWarpImage > 0.5) {
        if (b * b > 6.25 * te2 || b * b < 0.08 * te2) warpCull = 1.0;
        float edge = 1.02 * asin(min(2.6 * sqrt(max(1.0 - 1.0 / dl, 0.0)) / dl, 1.0));
        float t = max(0.5 * (root - b), edge);
        if (sl > 1e-5) dir = h * cos(t) - side / sl * sin(t);
      } else {
        float t = min(0.5 * (b + root), 3.14);
        if (sl > 1e-5) dir = h * cos(t) + side / sl * sin(t);
      }
    } else if (uWarpImage > 0.5) {
      warpCull = 1.0;
    }

    if (uWarpBeta > 0.001) {
      vTe2 = 0.0;
      vec3 fwd = -vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
      float c = dot(dir, fwd);
      float seen = (c + uWarpBeta) / (1.0 + uWarpBeta * c);
      vec3 side = dir - fwd * c;
      float sl = length(side);
      side = sl > 1e-5 ? side / sl : vec3(0.0);
      dir = normalize(fwd * seen + side * sqrt(max(1.0 - seen * seen, 0.0)));
      float gamma = inversesqrt(1.0 - uWarpBeta * uWarpBeta);
      float dop = gamma * (1.0 + uWarpBeta * seen);
      vWarpTint = clamp(pow(dop, 1.2), 0.25, 3.0) * mix(vec3(1.25, 0.7, 0.55), vec3(0.65, 0.85, 1.4), smoothstep(0.6, 2.5, dop));
    }

    vWarpRel = dir * ds;
    return cameraPosition + vWarpRel;
  }
`;

// 给 three 自带的材质接上弯折。同一个函数引用，所有材质共用一份着色器缓存键
function injectWarp(shader: THREE.WebGLProgramParametersWithUniforms) {
  shader.uniforms.uWarpBeta = warpBeta;
  shader.uniforms.uWarpImage = warpImage;
  shader.vertexShader = warpGlsl + shader.vertexShader.replace(
    '#include <project_vertex>',
    /* glsl */ `#include <project_vertex>
    vec4 warpPos = vec4(transformed, 1.0);
    #ifdef USE_INSTANCING
      warpPos = instanceMatrix * warpPos;
    #endif
    warpPos = modelMatrix * warpPos;
    mvPosition = viewMatrix * vec4(spaceWarp(warpPos.xyz), 1.0);
    gl_Position = warpClip(projectionMatrix * mvPosition);`,
  );
  shader.fragmentShader =
    'uniform float uWarpImage;\nvarying vec3 vWarpTint;\nvarying float vWarpCull;\nvarying vec3 vWarpRel;\nvarying vec3 vOrigRel;\nvarying float vTe2;\n' +
    shader.fragmentShader.replace(
      '#include <tonemapping_fragment>',
      /* glsl */ `if (vWarpCull > 0.001) discard;
      if (vTe2 > 0.0) {
        vec3 fDir = normalize(vWarpRel);
        vec3 h = -normalize(cameraPosition);
        float fTheta = acos(clamp(dot(fDir, h), -1.0, 1.0));
        vec3 uDir = normalize(vOrigRel);
        float ub = acos(clamp(dot(uDir, h), -1.0, 1.0));
        vec3 sW = fDir - h * dot(fDir, h);
        vec3 sU = uDir - h * dot(uDir, h);
        float align = dot(sW, sU) / max(length(sW) * length(sU), 1e-6);
        if (uWarpImage < 0.5) {
          float exactTheta = 0.5 * (ub + sqrt(ub * ub + 4.0 * vTe2));
          if (fTheta < 0.94 * exactTheta || align < 0.72) discard;
        } else {
          if (align > -0.72) discard;
        }
      }
      gl_FragColor.rgb *= vWarpTint;
      #include <tonemapping_fragment>`,
    );
}

export function warpMaterial(material: THREE.Material) {
  material.onBeforeCompile = injectWarp;
}

// 整棵子树都接上。cull=false 时关掉视锥剔除：光行差会把画面外的东西挪进画面，按原位置剔除会突然消失
export function warpObject(root: THREE.Object3D, cull: boolean) {
  root.traverse((object) => {
    const material = (object as THREE.Mesh).material;
    if (!material) return;
    for (const item of Array.isArray(material) ? material : [material]) warpMaterial(item);
    if (!cull) object.frustumCulled = false;
  });
}

// 和 spaceWarp 的透镜那段一样的算法，给标注和点击判定用：它们要跟着画面上的像走。
// 标注和点击只在不俯冲时才有，所以不算光行差
const lensH = new THREE.Vector3();
const lensDir = new THREE.Vector3();
const lensSide = new THREE.Vector3();
const lensUp = new THREE.Vector3();

export function lensPoint(p: THREE.Vector3, camera: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  out.copy(p);
  const dl = camera.length();
  lensH.copy(camera).multiplyScalar(-1 / dl);
  const z = p.dot(lensH);
  if (z <= 0) return out;
  lensDir.copy(p).sub(camera);
  const ds = lensDir.length();
  if (ds < 1e-4) return out;
  lensDir.multiplyScalar(1 / ds);
  const cb = THREE.MathUtils.clamp(lensDir.dot(lensH), -1, 1);
  let b = Math.acos(cb);
  const te2 = Math.min((2 * z) / (dl * (dl + z)), 1);
  lensSide.copy(lensDir).addScaledVector(lensH, -cb);
  let sl = lensSide.length();
  lensUp.set(0, 1, 0).addScaledVector(lensH, -lensH.y);
  const upLen = lensUp.length();
  if (upLen > 1e-4) {
    lensUp.multiplyScalar(1 / upLen);
    const sy = lensSide.dot(lensUp);
    const sgn = sy >= 0 ? 1 : -1;
    const minSy = 0.14 * Math.sqrt(te2);
    if (Math.abs(sy) < minSy) {
      lensSide.addScaledVector(lensUp, sgn * Math.sqrt(sy * sy + minSy * minSy) - sy);
      sl = lensSide.length();
      b = Math.max(b, sl);
    }
  }
  const t = Math.min(0.5 * (b + Math.sqrt(b * b + 4 * te2)), 3.14);
  if (sl <= 1e-5) return out;
  lensSide.multiplyScalar(Math.sin(t) / sl);
  return out.copy(camera).addScaledVector(lensH, ds * Math.cos(t)).addScaledVector(lensSide, ds);
}
