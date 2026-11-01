import * as THREE from 'three';

// 让场景里的几何体也服从黑洞的光学。星空和吸积盘在全屏着色器里追光线，自然是弯的；
// 星球、探测器这些是普通网格，不处理就一直走直线，俯冲时星空往前收拢、它们却纹丝不动。
//
// 这里按顶点改「看到它的方向」，距离不变，所以深度和遮挡还是对的：
// 1. 引力透镜：点质量透镜方程的主像 θ = (β + √(β² + 4θE²)) / 2，θE² = 2·Dls / (Dl·Ds)（Rs = 1）。
//    每个顶点各算各的，靠近黑洞背后的东西自然被切向拉长成一段弧。和全屏着色器的弱场公式 2/b 一致。
//    挡在黑洞前面的东西 Dls <= 0，不偏折。
//    方程还有一个解 θ = (β - √(β² + 4θE²)) / 2：黑洞另一侧、爱因斯坦环以内的次像，是翻转的。
//    uWarpImage = 1 时走这个解，由 scene.ts 再画一遍。薄透镜公式算出来可能落进阴影，实际的光线绕不进去，
//    所以压在阴影边缘外。离视线轴太远（u > 2.5）的次像只剩一丝，不画。
// 2. 相对论光行差：和全屏着色器相反方向的同一个变换（那边是从看到的方向换回静止系），
//    再按多普勒因子调亮度和冷暖，前方变亮变蓝。
export const warpBeta = { value: 0 };
export const warpImage = { value: 0 };

export const warpGlsl = /* glsl */ `
  uniform float uWarpBeta;
  uniform float uWarpImage;
  varying vec3 vWarpTint;
  float warpCull = 0.0;

  // 这个顶点没有次像：扔到裁剪空间外面，整个三角形就不画了
  vec4 warpClip(vec4 clip) {
    return warpCull > 0.5 ? vec4(2.0, 2.0, 2.0, 1.0) : clip;
  }

  vec3 spaceWarp(vec3 world) {
    vWarpTint = vec3(1.0);
    warpCull = 0.0;
    vec3 rel = world - cameraPosition;
    float ds = length(rel);
    if (ds < 1e-4) return world;
    vec3 dir = rel / ds;

    float dl = length(cameraPosition);
    vec3 h = -cameraPosition / dl;
    float z = dot(world, h);
    if (z > 0.0) {
      float cb = clamp(dot(dir, h), -1.0, 1.0);
      float b = acos(cb);
      float te2 = min(2.0 * z / (dl * (dl + z)), 1.0);
      float root = sqrt(b * b + 4.0 * te2);
      vec3 side = dir - h * cb;
      float sl = length(side);
      if (uWarpImage > 0.5) {
        if (b * b > 6.25 * te2) warpCull = 1.0;
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

    return cameraPosition + dir * ds;
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
  shader.fragmentShader = 'varying vec3 vWarpTint;\n' + shader.fragmentShader.replace(
    '#include <tonemapping_fragment>',
    'gl_FragColor.rgb *= vWarpTint;\n#include <tonemapping_fragment>',
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
  const b = Math.acos(cb);
  const te2 = Math.min((2 * z) / (dl * (dl + z)), 1);
  const t = Math.min(0.5 * (b + Math.sqrt(b * b + 4 * te2)), 3.14);
  lensSide.copy(lensDir).addScaledVector(lensH, -cb);
  const sl = lensSide.length();
  if (sl <= 1e-5) return out;
  lensSide.multiplyScalar(Math.sin(t) / sl);
  return out.copy(camera).addScaledVector(lensH, ds * Math.cos(t)).addScaledVector(lensSide, ds);
}
