// 门户页的着色器：黑洞与深空（全屏光线步进）、吸积粒子、俯冲时的速度线
import { warpGlsl } from './warp';


// 黑洞铺满整个画面，第一个画，空间站、探测器和粒子画在它上面。
// 是否挡得住它们，由片元着色器写的深度决定（见 holeFragment 最后）
export const holeVertex = /* glsl */ `
  varying vec2 vNdc;
  void main() {
    vNdc = position.xy;
    gl_Position = vec4(position.xy, 1.0, 1.0);
  }
`;

// 每个像素从相机出发沿光线走，光线在史瓦西黑洞附近按牛顿近似弯折
// （加速度 -1.5·h²·r̂/r⁴，半径单位取视界 rs = 1，阴影半径自然落在 2.6 左右）。
// 光线穿过吸积盘平面时取一次盘面颜色，多次穿过就是盘背面被弯到上下方的那道光环；
// 喷流和盘上下的光雾沿着弯曲的光线累加，也会被透镜弯折；
// 掉进视界就是黑，逃出去就去深空取色——银河、星云、远处的星系也一起被扭曲。
//
// 俯冲时 uBeta 是镜头速度（光速的倍数）。先按相对论光行差把每个像素的方向换回静止系：
// 速度越快，整片天空越往正前方收拢，前方变亮变蓝，四周变暗变红。
//
// 不要再加后期辉光（UnrealBloom）：它的多级模糊会把亮环溢进阴影，黑洞中间变成一片灰。
// 光雾、光子环、横向光晕都在这里自己算，被吞掉的光线一律压暗
export const holeFragment = /* glsl */ `
  precision highp float;

  uniform vec3 uCamPos;
  uniform mat4 uInvProj;
  uniform mat4 uCamWorld;
  uniform float uTime;
  uniform float uHover;
  uniform float uDive;
  uniform float uBeta;
  uniform vec3 uDiskN;
  uniform vec3 uDiskU;
  uniform vec3 uDiskV;
  uniform vec2 uHoleNdc;
  uniform float uStreak;
  uniform float uAspect;
  uniform vec2 uProjZ;

  varying vec2 vNdc;

  const float RIN = 1.72;
  const float ROUT = 11.2;

  float hash13(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
  }

  vec3 hash33(vec3 p) {
    p = fract(p * vec3(0.1031, 0.1030, 0.0973));
    p += dot(p, p.yxz + 33.33);
    return fract((p.xxy + p.yxx) * p.zyx);
  }

  float noise3(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    vec3 u = f * f * (3.0 - 2.0 * f);
    float n000 = hash13(i);
    float n100 = hash13(i + vec3(1.0, 0.0, 0.0));
    float n010 = hash13(i + vec3(0.0, 1.0, 0.0));
    float n110 = hash13(i + vec3(1.0, 1.0, 0.0));
    float n001 = hash13(i + vec3(0.0, 0.0, 1.0));
    float n101 = hash13(i + vec3(1.0, 0.0, 1.0));
    float n011 = hash13(i + vec3(0.0, 1.0, 1.0));
    float n111 = hash13(i + vec3(1.0, 1.0, 1.0));
    return mix(
      mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
      mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y),
      u.z
    );
  }

  float fbm3(vec3 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
      v += a * noise3(p);
      p = p * 2.02 + 17.3;
      a *= 0.5;
    }
    return v;
  }

  float fbm3lo(vec3 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 3; i++) {
      v += a * noise3(p);
      p = p * 2.02 + 17.3;
      a *= 0.5;
    }
    return v;
  }

  // ---- 深空 ----
  // 一层星点：每个格子最多一颗，大部分很暗、少数很亮，颜色按黑体色温分冷暖，亮星带柔和星冕
  vec3 starLayer(vec3 d, float scale, float chance, float size) {
    vec3 p = d * scale;
    vec3 id = floor(p);
    if (hash13(id) > chance) return vec3(0.0);
    vec3 c = hash33(id + 7.1) * 0.6 + 0.2;
    vec3 f = fract(p) - c;
    float d2 = dot(f, f);
    float s2 = size * size;
    if (d2 > 9.0 * s2) return vec3(0.0);
    float invS2 = 1.0 / s2;
    float mag = pow(hash13(id + 3.3), 6.5);
    float core = exp(-d2 * invS2);
    float halo = exp(-d2 * invS2 * 0.22) * 0.34 * mag;
    float s = (core + halo) * (0.09 + 4.4 * mag);
    float t = hash13(id + 11.7);
    vec3 tint = t < 0.16
      ? vec3(1.0, 0.68, 0.45)
      : (t < 0.48 ? vec3(1.0, 0.94, 0.86) : (t < 0.78 ? vec3(0.76, 0.86, 1.0) : vec3(0.62, 0.76, 1.0)));
    return tint * s;
  }

  // 发射星云：域扭曲噪声，只在 dir 附近一片天区里算，其他方向直接跳过省开销
  vec3 nebula(vec3 d, vec3 dir, vec3 hot, vec3 cool, float seed) {
    float reach = dot(d, dir);
    if (reach < 0.55) return vec3(0.0);
    float mask = smoothstep(0.55, 0.95, reach);
    vec3 q = d * 2.6 + seed;
    vec3 w = vec3(fbm3lo(q + 1.7), fbm3lo(q + 9.2), fbm3lo(q + 4.4));
    float n = fbm3(q * 1.4 + w * 2.4);
    float wisps = smoothstep(0.40, 0.78, n);
    float knots = smoothstep(0.58, 0.84, fbm3lo(q * 3.1 + w * 3.0));
    float darkLane = smoothstep(0.52, 0.76, fbm3lo(q * 2.1 - w * 1.4));
    return (hot * wisps * 0.18 + cool * knots * 0.115) * (1.0 - 0.42 * darkLane) * mask;
  }

  // 远处的旋涡星系：在 dir 方向上一小块，对数螺旋臂加一个亮核。
  // size 是角大小，roll 是盘面在天上的转角，squash 越大越接近侧视（侧视时中线压一道暗尘带）
  vec3 galaxy(vec3 d, vec3 dir, float size, float roll, float squash, float gain) {
    float c = dot(d, dir);
    if (c < 1.0 - size * size * 11.0) return vec3(0.0);
    vec3 u = normalize(cross(dir, vec3(0.0, 1.0, 0.0)));
    vec3 v = cross(dir, u);
    vec2 p = vec2(dot(d, u), dot(d, v)) / size;
    float cs = cos(roll);
    float sn = sin(roll);
    p = mat2(cs, -sn, sn, cs) * p;
    p.y *= squash;
    float r = length(p);
    float arm = 0.5 + 0.5 * cos(2.0 * atan(p.y, p.x) - 5.0 * log(r + 0.08));
    float disc = exp(-r * 1.6) * (0.35 + 0.65 * arm);
    float bulge = exp(-r * r * 9.0) * 1.72;
    float lane = 1.0 - 0.70 * smoothstep(3.0, 6.0, squash) * exp(-p.y * p.y * 4.2) * smoothstep(0.12, 0.4, r);
    return mix(vec3(0.55, 0.67, 1.0), vec3(1.0, 0.86, 0.66), smoothstep(0.0, 1.4, bulge)) * (disc + bulge) * lane * gain;
  }

  // 棒旋星系（Barred Spiral Galaxy, SBb/SBc 型）：
  // 中心一颗古老的金黄核球 + 横贯核心的恒星棒（Stellar Bar） + 从棒两端甩出的蓝白旋臂与粉红电离氢星团节
  vec3 barredGalaxy(vec3 d, vec3 dir, float size, float roll, float squash, float gain) {
    float c = dot(d, dir);
    if (c < 1.0 - size * size * 12.0) return vec3(0.0);
    vec3 u = normalize(cross(dir, vec3(0.0, 1.0, 0.0)));
    vec3 v = cross(dir, u);
    vec2 p = vec2(dot(d, u), dot(d, v)) / size;
    float cs = cos(roll);
    float sn = sin(roll);
    p = mat2(cs, -sn, sn, cs) * p;
    p.y *= squash;
    float r2 = dot(p, p);
    float r = sqrt(r2);
    // 中心核球 + 沿 x 轴延伸的恒星棒（半径约 0.55）
    float bulge = exp(-r2 * 14.0) * 1.85;
    float bar = exp(-p.x * p.x * 3.2 - p.y * p.y * 38.0) * smoothstep(0.78, 0.18, abs(p.x)) * 1.25;
    // 旋臂从棒的两端（r ≈ 0.48, θ = 0 / π）起旋
    float theta = atan(p.y, p.x);
    float phase = 2.0 * theta - 4.4 * log(max(r, 0.44) / 0.44);
    float arm = pow(0.5 + 0.5 * cos(phase), 2.2);
    float ringBridge = exp(-pow((r - 0.48) * 5.5, 2.0)) * 0.35;
    float outerMask = smoothstep(0.36, 0.54, r) * exp(-r * 1.45);
    float arms = (arm * outerMask + ringBridge) * 1.15;
    // 旋臂上的 H-II 恒星形成亮节
    float knots = arm * outerMask * pow(0.5 + 0.5 * sin(theta * 6.0 + r * 9.0), 3.0) * 0.55;
    vec3 coreCol = vec3(1.0, 0.84, 0.60) * (bulge + bar);
    vec3 armCol = vec3(0.54, 0.72, 1.0) * arms + vec3(1.0, 0.48, 0.68) * knots;
    return (coreCol + armCol) * gain;
  }

  // 环状星系（Ring Galaxy / Hoag's Object 形态）：金色孤立核心 + 暗环间隙 + 璀璨蓝白外恒星环
  vec3 ringGalaxy(vec3 d, vec3 dir, float size, float roll, float squash, float gain) {
    float c = dot(d, dir);
    if (c < 1.0 - size * size * 10.0) return vec3(0.0);
    vec3 u = normalize(cross(dir, vec3(0.0, 1.0, 0.0)));
    vec3 v = cross(dir, u);
    vec2 p = vec2(dot(d, u), dot(d, v)) / size;
    float cs = cos(roll);
    float sn = sin(roll);
    p = mat2(cs, -sn, sn, cs) * p;
    p.y *= squash;
    float r = length(p);
    float core = exp(-r * r * 16.0) * 1.75;
    float ring = exp(-pow((r - 0.62) * 5.8, 2.0)) * (0.75 + 0.25 * cos(atan(p.y, p.x) * 3.0 + 1.2));
    return (vec3(1.0, 0.85, 0.62) * core + vec3(0.52, 0.76, 1.0) * ring * 1.1) * gain;
  }

  // 球状星团（Globular Star Cluster）：向中心密集聚拢的金色/蓝白恒星群与核心漫射辉光
  vec3 starCluster(vec3 d, vec3 dir, float size, float gain) {
    float c = dot(d, dir);
    if (c < 1.0 - size * size * 8.0) return vec3(0.0);
    float ang2 = max(2.0 * (1.0 - c), 0.0) / (size * size);
    float profile = 1.0 / pow(1.0 + ang2 * 2.2, 1.8);
    float fine = hash13(floor(d * 620.0));
    float sparkle = smoothstep(0.72, 0.995, fine) * exp(-ang2 * 0.65) * 2.4;
    return (vec3(1.0, 0.88, 0.72) * profile * 0.42 + vec3(0.88, 0.92, 1.0) * sparkle) * gain;
  }

  // 整片天上极淡的两团色光（一团偏品红、一团偏青），给大片空白的深空一点冷暖起伏。
  // 只是两个点积的幂，几乎不花钱
  vec3 airglow(vec3 d) {
    float a = max(dot(d, vec3(-0.6016, 0.4512, 0.6592)), 0.0);
    float b = max(dot(d, vec3(0.7035, -0.3015, -0.6432)), 0.0);
    return vec3(0.011, 0.003, 0.013) * (a * a * a) + vec3(0.002, 0.009, 0.012) * (b * b * b);
  }

  vec3 sky(vec3 d) {
    // 银河：一条倾斜的亮带，核心方向偏暖，中线压一道清晰的暗分子云裂谷（Great Rift）
    const vec3 n = vec3(0.4197, 0.8994, 0.1199);
    const vec3 core = vec3(-0.3507, 0.1603, -0.9227);
    float lat = dot(d, n);
    float band = exp(-lat * lat * 32.0);
    float coreDot = max(dot(d, core), 0.0);
    float coreGlow = coreDot * coreDot * coreDot * coreDot * coreDot;
    vec3 col = vec3(0.0012, 0.0018, 0.0038);
    if (band > 0.008) {
      float clouds = fbm3(d * 3.4);
      float grain = fbm3lo(d * 15.0 + 3.0);
      float dust = smoothstep(0.38, 0.66, fbm3lo(d * 6.8 + 9.0)) * exp(-lat * lat * 210.0);
      // 弥散光收着：太亮的话被透镜弯成一圈灰褐色的雾，黑洞四周会显得脏
      float milky = band * (0.14 + 0.86 * clouds * clouds) * (0.45 + 0.55 * grain) * (1.0 - 0.88 * dust) * (0.38 + 1.12 * coreGlow);
      col += mix(vec3(0.52, 0.64, 0.92), vec3(1.0, 0.82, 0.62), coreGlow) * milky * 0.15;
    }

    col += nebula(d, vec3(-0.7035, 0.3518, -0.6172), vec3(0.95, 0.25, 0.35), vec3(0.3, 0.75, 0.9), 3.0);
    col += nebula(d, vec3(0.7412, -0.1977, -0.6424), vec3(0.25, 0.55, 0.95), vec3(0.95, 0.5, 0.3), 11.0);
    col += nebula(d, vec3(0.0995, 0.5970, 0.7960), vec3(0.75, 0.3, 0.8), vec3(0.4, 0.8, 0.7), 23.0);
    #ifndef LITE
    col += nebula(d, vec3(-0.3002, -0.2502, 0.9207), vec3(0.95, 0.55, 0.25), vec3(0.5, 0.35, 0.95), 31.0);
    #endif

    // 旋涡星系与侧视草帽星系（带赤道暗尘带）
    col += galaxy(d, vec3(-0.4491, 0.2794, -0.8483), 0.022, 0.6435, 2.6, 0.22);
    col += galaxy(d, vec3(0.6178, 0.1196, 0.7772), 0.05, -0.35, 6.5, 0.2);
    col += galaxy(d, vec3(-0.1997, -0.5491, 0.8087), 0.016, 1.2, 1.15, 0.26);

    // 棒状旋涡星系（Barred Spiral）：一处在甲板望出去的右上方深空，一处在自由视角巡航区
    col += barredGalaxy(d, vec3(0.4856, 0.3122, 0.8165), 0.036, -0.52, 1.65, 0.25);
    col += barredGalaxy(d, vec3(-0.5812, -0.1845, 0.7925), 0.028, 0.88, 1.45, 0.23);
    #ifndef LITE
    // 霍格天体型环状星系、侧视透镜星系与球状星团
    col += ringGalaxy(d, vec3(-0.3714, 0.4457, 0.8146), 0.020, 0.42, 1.55, 0.24);
    col += galaxy(d, vec3(0.2981, -0.3875, 0.8724), 0.026, 0.28, 5.8, 0.21);
    col += starCluster(d, vec3(0.6644, 0.2488, -0.7049), 0.028, 0.26);
    #endif
    col += airglow(d);

    // 星点：银河带里更密
    float boost = 1.0 + band * 2.6;
    col += starLayer(d, 90.0, 0.07 * boost, 0.09);
    col += starLayer(d, 210.0, 0.09 * boost, 0.08) * 0.82;
    #ifndef LITE
    col += starLayer(d, 480.0, 0.12 * boost, 0.07) * 0.62;
    #endif
    return col;
  }

  // ---- 吸积盘 ----
  float fbm2(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
      v += a * noise3(vec3(p, 0.5));
      p = p * 2.03 + 7.1;
      a *= 0.5;
    }
    return v;
  }

  // 多普勒相对论聚束（Relativistic Beaming）：朝镜头转过来的一侧更亮、偏蓝白，远离的一侧深邃偏红
  float doppler(vec3 p, vec3 rd) {
    vec3 orbit = normalize(cross(uDiskN, p));
    float speed = 0.65 * sqrt(RIN / max(length(p), RIN));
    return clamp(1.0 + 1.16 * speed * dot(orbit, -rd), 0.38, 2.02);
  }

  // 单相位开普勒流场采样：用全局刚体旋转 baseSpin 叠加有限时间窗 tau 内的开普勒差速剪切 dOmega，
  // 瞬时角速度严格保持内快外慢的开普勒定律，但径向相位梯度永远有界，彻底消除长时间停留后的同心年轮摩尔纹
  float diskFlowSample(float x, float y, float r, float baseSpin, float dOmega, float tau, float seedOffset) {
    float spin = baseSpin + dOmega * tau + seedOffset;
    float c = cos(spin);
    float s = sin(spin);
    vec2 q = vec2(c * x - s * y, s * x + c * y);
    float a = atan(q.y, q.x);
    float spiral = a + 2.2 * log(max(r / RIN, 1.001));
    float streak = fbm2(vec2(r * 2.8, 0.0) + vec2(cos(spiral), sin(spiral)) * 1.55 + q * 0.25);
    float fine = fbm2(q * 2.4 + seedOffset * 3.7);
    return pow(streak, 1.35) * (0.52 + 0.62 * fine);
  }

  vec4 disk(vec3 p, vec3 rd) {
    float r = length(p);
    if (r < RIN || r > ROUT) return vec4(0.0);

    float x = dot(p, uDiskU);
    float y = dot(p, uDiskV);
    // 开普勒差速旋转：双相位正弦平方权重平滑交叠，周期 9 秒重置剪切累积
    float omega = 2.6 * pow(r, -1.5);
    float omegaBase = 0.42;
    float baseSpin = uTime * omegaBase;
    float dOmega = (omega - omegaBase) * 0.42;
    float cycle = 9.0;
    float ph0 = fract(uTime / cycle);
    float ph1 = fract(uTime / cycle + 0.5);
    float w0 = sin(ph0 * 3.14159265);
    float w1 = sin(ph1 * 3.14159265);
    w0 *= w0;
    w1 *= w1;
    float dA = diskFlowSample(x, y, r, baseSpin, dOmega, (ph0 - 0.5) * cycle, 0.0);
    float dB = diskFlowSample(x, y, r, baseSpin, dOmega, (ph1 - 0.5) * cycle, 4.19);
    float dens = (dA * w0 + dB * w1) / max(w0 + w1, 1e-4) * 2.02;

    // 磁流体同心明暗环缝（MHD Ring Lanes）：还原卡冈图雅细腻的等离子体环带层次
    float rings = 0.74 + 0.26 * sin(r * 5.0 - sin(r * 1.8) * 1.3) * cos(r * 2.6 + 0.7);
    dens *= rings;
    dens *= smoothstep(RIN, RIN + 0.22, r) * (1.0 - smoothstep(ROUT * 0.36, ROUT, r));

    // 黑体辐射温度梯度：ISCO 内圈炽白金黄 → 中圈亮琥珀橙 → 外圈深红褐
    float t = pow(RIN / r, 0.86);
    vec3 col = mix(vec3(0.48, 0.11, 0.03), vec3(1.0, 0.50, 0.16), smoothstep(0.16, 0.48, t));
    col = mix(col, vec3(1.0, 0.95, 0.88), smoothstep(0.52, 0.94, t));

    float g = doppler(p, rd);
    col *= mix(vec3(1.24, 0.76, 0.58), vec3(0.84, 0.95, 1.28), smoothstep(0.65, 1.55, g));
    float lum = (0.22 + 4.8 * t * t * t) * g * g;
    // 最内稳定圆轨道（ISCO）边缘炽热的相对论亮脊
    lum += 8.0 * (1.0 - smoothstep(RIN, RIN + 0.32, r)) * g * (0.76 + 0.24 * rings);

    return vec4(col * lum * (1.0 + uDive * 2.0), clamp(dens * 1.32, 0.0, 1.0));
  }

  void main() {
    vec4 view = uInvProj * vec4(vNdc, 1.0, 1.0);
    vec3 viewDir = normalize(view.xyz / view.w);
    vec3 rd = normalize((uCamWorld * vec4(viewDir, 0.0)).xyz);

    // 光行差：把看到的方向换回静止系里的方向，再拿去追光线
    float boostLum = 1.0;
    vec3 boostTint = vec3(1.0);
    if (uBeta > 0.001) {
      vec3 fwd = normalize((uCamWorld * vec4(0.0, 0.0, -1.0, 0.0)).xyz);
      float c = dot(rd, fwd);
      float cr = (c - uBeta) / (1.0 - uBeta * c);
      vec3 side = rd - fwd * c;
      float sl = length(side);
      side = sl > 1e-5 ? side / sl : vec3(0.0);
      rd = normalize(fwd * cr + side * sqrt(max(1.0 - cr * cr, 0.0)));
      float gamma = inversesqrt(1.0 - uBeta * uBeta);
      float dop = gamma * (1.0 + uBeta * c);
      boostLum = clamp(pow(dop, 1.6), 0.15, 7.0);
      boostTint = mix(vec3(1.25, 0.7, 0.55), vec3(0.65, 0.85, 1.4), smoothstep(0.6, 2.5, dop));
    }

    vec3 pos = uCamPos;
    vec3 h = cross(pos, rd);
    float h2 = dot(h, h);

    vec3 col = vec3(0.0);
    float alpha = 0.0;
    vec3 haze = vec3(0.0);
    vec3 jet = vec3(0.0);
    float minR = 1e4;
    vec3 closestPos = pos;
    bool swallowed = false;
    float hitDist = -1.0;

    // 瞄准距离 b（光线到黑洞中心的最近距离）很大的光线碰不到吸积盘和光雾，
    // 不用一步步追，按弱场偏折一次算出弯折后的方向：迎面掠过偏 2/b，背离黑洞的几乎不偏。
    // 画面上绝大部分像素走这条路，光线步进只留给黑洞附近那一块
    float b = sqrt(h2);
    bool far = b > 18.0;
    if (far) {
      vec3 toHole = normalize(-pos);
      float bend = (1.0 + dot(rd, toHole)) / b;
      vec3 perp = toHole - rd * dot(toHole, rd);
      float pl = length(perp);
      if (pl > 1e-5) rd = normalize(rd * cos(bend) + perp / pl * sin(bend));
      minR = b;
    }

    for (int i = 0; i < STEPS; i++) {
      if (far) break;
      float r2 = dot(pos, pos);
      float invR = inversesqrt(r2);
      float r = r2 * invR;
      if (r < minR) {
        minR = r;
        closestPos = pos;
      }
      // 在吸积盘与光雾外围（r > 14.5）适当放大步长，靠近强引力场时保持高精度细步长
      float dt = r > 14.5 ? clamp(0.12 * r, 0.5, 4.5) : clamp(0.068 * r, 0.02, 1.6);
      vec3 next = pos + rd * dt;
      float invR2 = invR * invR;
      rd += -1.5 * h2 * pos * (invR2 * invR2 * invR) * dt;

      float d0 = dot(pos, uDiskN);
      float d1 = dot(next, uDiskN);
      if (d0 * d1 < 0.0) {
        vec3 hit = mix(pos, next, d0 / (d0 - d1));
        vec4 dc = disk(hit, normalize(rd));
        col += (1.0 - alpha) * dc.rgb * dc.a;
        bool wasClear = hitDist < 0.0;
        alpha += (1.0 - alpha) * dc.a;
        if (wasClear && alpha >= 0.08) hitDist = length(hit - uCamPos);
      }

      float rr = length(pos - uDiskN * d0);
      float ad = abs(d0);

      // 盘上下一层薄薄的光雾（仅在盘面附近计算，远离盘面直接跳过两次 exp 开销）
      float thick = 0.2 + 0.05 * rr;
      if (ad < thick * 3.2 && rr < 13.5) {
        float fog = exp(-d0 * d0 / (thick * thick)) * smoothstep(RIN, RIN + 0.9, rr) * exp(-rr * 0.34);
        haze += (1.0 - alpha) * fog * dt;
      }

      // 喷流：沿盘面法线上下两束，越远越宽越淡，仅在极轴锥区内计算
      float width = 0.12 + 0.03 * ad;
      if (ad > 1.4 && rr < width * 3.2) {
        float beam = exp(-rr * rr / (width * width)) * smoothstep(1.4, 4.0, ad) * exp(-ad * 0.11);
        float knots = 0.65 + 0.35 * sin(ad * 1.1 - uTime * 7.0);
        jet += (1.0 - alpha) * beam * knots * dt;
      }

      pos = next;
      if (dot(pos, pos) < 1.0) {
        swallowed = true;
        break;
      }
      // 光线已越过近心点正在远离黑洞，且已飞出吸积盘与喷流区（r > 24）：
      // 补上从 r 到无穷远的残余弱场引力偏折（0.5·h²/r³）后直接退出，省去飞往 r=220 的数十次空步进
      if (r > 24.0 && dot(pos, rd) > 0.0 && rr > width * 3.5) {
        rd -= 0.5 * h2 * pos * (invR2 * invR2);
        break;
      }
      if (alpha > 0.985) break;
    }

    // 掉进视界且未被前景吸积盘挡住的光线：视界阴影保持纯粹的深渊黑，不让背景光雾或喷流把黑洞中心染灰
    float keep = swallowed ? alpha : 1.0;
    col += haze * vec3(1.0, 0.58, 0.32) * 0.085 * keep * (1.0 + uDive * 2.5);
    col += jet * vec3(0.45, 0.62, 1.0) * 0.115 * keep * (1.0 + uDive * 2.0);

    if (!swallowed) {
      vec3 finalRd = normalize(rd);
      col += (1.0 - alpha) * sky(finalRd);
      // 光子环（Photon Ring）：擦着光子球逃逸的高阶透镜亮环，带相对论多普勒明暗不对称（迎面侧炽白、背离侧深金）
      float ringDop = doppler(closestPos, finalRd);
      float ringAsym = clamp(0.42 + 0.72 * ringDop, 0.45, 1.85);
      float d1 = (minR - 1.515) * 28.0;
      float d2 = (minR - 1.62) * 10.0;
      float pRing1 = exp(-d1 * d1) * 3.1 * ringAsym;
      float pRing2 = exp(-d2 * d2) * 0.85 * ringAsym;
      col += (1.0 - alpha * 0.75) * (vec3(1.0, 0.92, 0.80) * pRing1 + vec3(1.0, 0.66, 0.38) * pRing2);
      // 外层微弱电离冷光晕，与吸积盘暖色自然过渡
      float d3 = (minR - 1.72) * 3.4;
      col += (1.0 - alpha) * vec3(0.38, 0.56, 1.0) * exp(-d3 * d3) * 0.09 * (1.0 + uHover * 0.9);
    }

    col *= boostLum * boostTint;

    // 横向光晕：像电影镜头里那道水平拉开的光，穿过黑洞中心那一行（不在视界黑影内部泛白）
    #ifndef LITE
    vec2 dn = vNdc - uHoleNdc;
    dn.x *= uAspect;
    float flare = exp(-abs(dn.y) * 60.0) * exp(-abs(dn.x) * 1.4) * 0.14 * uStreak;
    col += flare * vec3(1.0, 0.72, 0.5) * keep * (1.0 + uDive * 3.0 + uHover * 0.6);
    #endif

    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>

    // 把这个像素「最先挡住光线的东西」的距离写进深度：盘面够实的地方是盘面，掉进视界或光子球内的是黑洞本身。
    // 星球、空间站和轨迹线画上来时走硬件深度测试，黑洞后方的几何体绝不会穿透前景吸积盘与视界阴影。
    float holeDist = length(uCamPos);
    float blockDist = (swallowed || minR < 1.75)
      ? (hitDist > 0.0 ? min(hitDist + 1.2, holeDist) : holeDist)
      : (hitDist > 0.0 ? hitDist + 1.2 : -1.0);
    if (blockDist > 0.0) {
      float zv = blockDist * viewDir.z;
      gl_FragDepth = clamp(0.5 * ((uProjZ.x * zv + uProjZ.y) / -zv) + 0.5, 0.0, 1.0);
    } else {
      gl_FragDepth = 1.0;
    }
  }
`;

// 粒子绕黑洞按开普勒速度公转；uDive 从 0 到 1 时一层层往里掉，越近越快
export const dustVertex = /* glsl */ `
  ${warpGlsl}
  attribute float aRadius;
  attribute float aAngle;
  attribute float aLift;
  attribute float aSeed;

  uniform float uTime;
  uniform float uDive;
  uniform float uSize;
  uniform float uPixelRatio;
  uniform vec3 uDiskN;
  uniform vec3 uDiskU;
  uniform vec3 uDiskV;

  varying float vSeed;
  varying float vFade;
  varying float vHeat;

  void main() {
    float fall = clamp(uDive * 1.7 - aSeed * 0.7, 0.0, 1.0);
    fall = fall * fall * (3.0 - 2.0 * fall);
    float r = mix(aRadius, 0.9, fall);

    float a = aAngle + uTime * 2.6 * pow(r, -1.5) + fall * fall * 9.0;
    float lift = aLift * (1.0 - fall);
    // 和星空一样被透镜弯折、被光行差往前收拢
    vec3 p = spaceWarp((uDiskU * cos(a) + uDiskV * sin(a)) * r + uDiskN * lift);

    // 黑洞是画在背景上的，粒子却总盖在它前面。弯折之后视线还穿过阴影的粒子一律藏起来
    vec3 toP = p - cameraPosition;
    float miss = length(cross(normalize(toP), -cameraPosition));
    float hidden = 1.0 - smoothstep(2.4, 3.0, miss);

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize * uPixelRatio * (1.0 + fall * 2.0) / -mv.z;

    vSeed = aSeed;
    vHeat = clamp(3.0 / r, 0.0, 1.0);
    // 落到视界附近就收掉
    vFade = smoothstep(1.2, 2.6, r) * (1.0 - hidden);
  }
`;

export const dustFragment = /* glsl */ `
  precision highp float;

  uniform float uDive;

  varying float vSeed;
  varying float vFade;
  varying float vHeat;

  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    if (d > 0.5) discard;
    float core = smoothstep(0.5, 0.0, d);
    vec3 cool = vec3(1.0, 0.55, 0.3);
    vec3 warm = vec3(1.0, 0.9, 0.78);
    vec3 col = mix(cool, warm, clamp(vHeat + vSeed * 0.25, 0.0, 1.0));
    float a = core * core * vFade * (0.22 + 0.78 * uDive);
    gl_FragColor = vec4(col * a, a);
    #include <colorspace_fragment>
  }
`;
