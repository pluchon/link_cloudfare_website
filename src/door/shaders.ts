// 门户页的着色器：黑洞与深空（全屏光线步进）、吸积粒子、俯冲时的速度线

// 黑洞铺满整个画面，画在远平面上，空间站、探测器和粒子盖在它前面
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

  varying vec2 vNdc;

  const float RIN = 2.6;
  const float ROUT = 10.0;

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
  // 一层星点：每个格子最多一颗，大部分很暗、少数很亮，颜色按色温分冷暖
  vec3 starLayer(vec3 d, float scale, float chance, float size) {
    vec3 p = d * scale;
    vec3 id = floor(p);
    if (hash13(id) > chance) return vec3(0.0);
    vec3 c = hash33(id + 7.1) * 0.6 + 0.2;
    vec3 f = fract(p) - c;
    float mag = pow(hash13(id + 3.3), 7.0);
    float s = exp(-dot(f, f) / (size * size)) * (0.08 + 4.0 * mag);
    float t = hash13(id + 11.7);
    vec3 tint = t < 0.18 ? vec3(1.0, 0.72, 0.52) : (t < 0.55 ? vec3(1.0, 0.95, 0.88) : vec3(0.72, 0.82, 1.0));
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
    float wisps = smoothstep(0.42, 0.78, n);
    float knots = smoothstep(0.6, 0.85, fbm3lo(q * 3.1 + w * 3.0));
    return (hot * wisps * 0.16 + cool * knots * 0.1) * mask;
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
    float bulge = exp(-r * r * 9.0) * 1.6;
    float lane = 1.0 - 0.65 * smoothstep(3.0, 6.0, squash) * exp(-p.y * p.y * 4.0) * smoothstep(0.15, 0.4, r);
    return mix(vec3(0.55, 0.65, 1.0), vec3(1.0, 0.86, 0.68), smoothstep(0.0, 1.5, bulge)) * (disc + bulge) * lane * gain;
  }

  // 整片天上极淡的两团色光（一团偏品红、一团偏青），给大片空白的深空一点冷暖起伏。
  // 只是两个点积的幂，几乎不花钱
  vec3 airglow(vec3 d) {
    float a = pow(max(dot(d, normalize(vec3(-0.6, 0.45, 0.66))), 0.0), 3.0);
    float b = pow(max(dot(d, normalize(vec3(0.7, -0.3, -0.64))), 0.0), 3.0);
    return vec3(0.010, 0.003, 0.012) * a + vec3(0.002, 0.008, 0.011) * b;
  }

  vec3 sky(vec3 d) {
    // 银河：一条倾斜的亮带，核心方向偏暖，中线压一道暗尘带
    vec3 n = normalize(vec3(0.42, 0.9, 0.12));
    float lat = dot(d, n);
    float band = exp(-lat * lat / 0.03);
    vec3 core = normalize(vec3(-0.35, 0.16, -0.92));
    float coreGlow = pow(max(dot(d, core), 0.0), 5.0);
    vec3 col = vec3(0.0015, 0.002, 0.004);
    if (band > 0.01) {
      float clouds = fbm3(d * 3.2);
      float grain = fbm3lo(d * 14.0 + 3.0);
      float dust = smoothstep(0.42, 0.68, fbm3lo(d * 6.5 + 9.0)) * exp(-lat * lat / 0.005);
      // 弥散光收着：太亮的话被透镜弯成一圈灰褐色的雾，黑洞四周会显得脏
      float milky = band * (0.15 + 0.85 * clouds * clouds) * (0.5 + 0.5 * grain) * (1.0 - 0.85 * dust) * (0.35 + 1.0 * coreGlow);
      col += mix(vec3(0.55, 0.64, 0.9), vec3(1.0, 0.84, 0.66), coreGlow) * milky * 0.14;
    }

    col += nebula(d, normalize(vec3(-0.7, 0.35, -0.6)), vec3(0.95, 0.25, 0.35), vec3(0.3, 0.75, 0.9), 3.0);
    col += nebula(d, normalize(vec3(0.75, -0.2, -0.65)), vec3(0.25, 0.55, 0.95), vec3(0.95, 0.5, 0.3), 11.0);
    col += nebula(d, normalize(vec3(0.1, 0.6, 0.8)), vec3(0.75, 0.3, 0.8), vec3(0.4, 0.8, 0.7), 23.0);
    #ifndef LITE
    col += nebula(d, normalize(vec3(-0.3, -0.25, 0.92)), vec3(0.95, 0.55, 0.25), vec3(0.5, 0.35, 0.95), 31.0);
    #endif
    col += galaxy(d, normalize(vec3(-0.45, 0.28, -0.85)), 0.022, 0.6435, 2.6, 0.22);
    // 一个大一点、几乎侧对着我们的星系，和一个很小的正面旋涡
    col += galaxy(d, normalize(vec3(0.62, 0.12, 0.78)), 0.05, -0.35, 6.5, 0.2);
    col += galaxy(d, normalize(vec3(-0.2, -0.55, 0.81)), 0.016, 1.2, 1.15, 0.26);
    col += airglow(d);

    // 星点：银河带里更密
    float boost = 1.0 + band * 2.5;
    col += starLayer(d, 90.0, 0.07 * boost, 0.09);
    col += starLayer(d, 210.0, 0.09 * boost, 0.08) * 0.8;
    #ifndef LITE
    col += starLayer(d, 480.0, 0.12 * boost, 0.07) * 0.6;
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

  // 多普勒：朝镜头转过来的一侧更亮、偏蓝白，远离的一侧暗、偏红
  float doppler(vec3 p, vec3 rd) {
    vec3 orbit = normalize(cross(uDiskN, p));
    float speed = 0.62 * sqrt(RIN / max(length(p), RIN));
    return clamp(1.0 + 1.1 * speed * dot(orbit, -rd), 0.4, 1.9);
  }

  vec4 disk(vec3 p, vec3 rd) {
    float r = length(p);
    if (r < RIN || r > ROUT) return vec4(0.0);

    // 按开普勒角速度差速旋转，花纹被拉成弧线
    float x = dot(p, uDiskU);
    float y = dot(p, uDiskV);
    float spin = uTime * 2.6 * pow(r, -1.5);
    float c = cos(spin);
    float s = sin(spin);
    vec2 q = vec2(c * x - s * y, s * x + c * y);
    float a = atan(q.y, q.x);

    float streak = fbm2(vec2(r * 3.4, 0.0) + vec2(cos(a), sin(a)) * 1.5 + q * 0.3);
    float fine = fbm2(q * 3.0 + 11.0);
    float dens = pow(streak, 1.4) * 2.0 * (0.55 + 0.6 * fine);
    dens *= smoothstep(RIN, RIN + 0.2, r) * (1.0 - smoothstep(ROUT * 0.4, ROUT, r));

    // 温度：内圈白热，往外橙、再往外暗红
    float t = pow(RIN / r, 0.9);
    vec3 col = mix(vec3(0.55, 0.14, 0.04), vec3(1.0, 0.52, 0.2), smoothstep(0.2, 0.5, t));
    col = mix(col, vec3(1.0, 0.94, 0.86), smoothstep(0.55, 0.95, t));

    float g = doppler(p, rd);
    col *= mix(vec3(1.2, 0.8, 0.65), vec3(0.85, 0.95, 1.25), smoothstep(0.7, 1.5, g));
    float lum = (0.25 + 4.5 * t * t * t) * g * g;
    // 最内一圈额外亮一道边
    lum += 7.0 * (1.0 - smoothstep(RIN, RIN + 0.25, r)) * g;

    return vec4(col * lum * (1.0 + uDive * 2.0), clamp(dens * 1.3, 0.0, 1.0));
  }

  void main() {
    vec4 view = uInvProj * vec4(vNdc, 1.0, 1.0);
    vec3 rd = normalize((uCamWorld * vec4(view.xyz / view.w, 0.0)).xyz);

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
    bool swallowed = false;

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
      float r = length(pos);
      minR = min(minR, r);
      float dt = clamp(0.07 * r, 0.02, 3.0);
      vec3 next = pos + rd * dt;
      rd += -1.5 * h2 * pos / pow(r, 5.0) * dt;

      float d0 = dot(pos, uDiskN);
      float d1 = dot(next, uDiskN);
      if (d0 * d1 < 0.0) {
        vec3 hit = mix(pos, next, d0 / (d0 - d1));
        vec4 dc = disk(hit, normalize(rd));
        col += (1.0 - alpha) * dc.rgb * dc.a;
        alpha += (1.0 - alpha) * dc.a;
      }

      float rr = length(pos - uDiskN * d0);

      // 盘上下一层薄薄的光雾
      float thick = 0.2 + 0.05 * rr;
      float fog = exp(-d0 * d0 / (thick * thick)) * smoothstep(RIN, RIN + 1.0, rr) * exp(-rr * 0.32);
      haze += (1.0 - alpha) * fog * dt;

      // 喷流：沿盘面法线上下两束，越远越宽越淡，一节一节往外涌
      float ad = abs(d0);
      float width = 0.12 + 0.03 * ad;
      float beam = exp(-rr * rr / (width * width)) * smoothstep(1.4, 4.0, ad) * exp(-ad * 0.11);
      float knots = 0.65 + 0.35 * sin(ad * 1.1 - uTime * 7.0);
      jet += (1.0 - alpha) * beam * knots * dt;

      pos = next;
      if (dot(pos, pos) < 1.0) {
        swallowed = true;
        break;
      }
      if (r > 220.0 && dot(pos, rd) > 0.0) break;
      if (alpha > 0.985) break;
    }

    // 掉进视界的光线在光子球附近绕了很多圈，光雾会累加成灰雾，把阴影糊掉
    float keep = swallowed ? 0.06 : 1.0;
    col += haze * vec3(1.0, 0.6, 0.34) * 0.09 * keep * (1.0 + uDive * 2.5);
    col += jet * vec3(0.45, 0.62, 1.0) * 0.12 * keep * (1.0 + uDive * 2.0);

    if (!swallowed) {
      col += (1.0 - alpha) * sky(normalize(rd));
      // 光子环：擦着光子球逃出来的光线，一道很细的亮环
      col += (1.0 - alpha) * vec3(1.0, 0.88, 0.75) * exp(-pow((minR - 1.53) * 24.0, 2.0)) * 2.6;
      // 外面再罩一圈冷色光晕
      col += vec3(0.35, 0.5, 1.0) * exp(-pow((minR - 1.8) * 2.4, 2.0)) * 0.14 * (1.0 + uHover);
    }

    col *= boostLum * boostTint;

    // 横向光晕：像电影镜头里那道水平拉开的光，穿过黑洞中心那一行
    #ifndef LITE
    vec2 dn = vNdc - uHoleNdc;
    dn.x *= uAspect;
    float flare = exp(-abs(dn.y) * 60.0) * exp(-abs(dn.x) * 1.4) * 0.14 * uStreak;
    col += flare * vec3(1.0, 0.72, 0.5) * keep * (1.0 + uDive * 3.0 + uHover * 0.6);
    #endif

    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

// 粒子绕黑洞按开普勒速度公转；uDive 从 0 到 1 时一层层往里掉，越近越快
export const dustVertex = /* glsl */ `
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
    vec3 p = (uDiskU * cos(a) + uDiskV * sin(a)) * r + uDiskN * lift;

    // 黑洞是画在背景上的，粒子却总盖在它前面。视线穿过阴影的粒子一律藏起来
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
