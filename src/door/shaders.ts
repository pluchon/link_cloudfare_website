// 门户页的两组着色器：黑洞（全屏光线步进）和吸积粒子

// 黑洞铺满整个画面，画在远平面上，平台和粒子盖在它前面
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
// 掉进视界就是黑，逃出去就去背景星空取色——星空也因此被透镜扭曲
export const holeFragment = /* glsl */ `
  precision highp float;

  uniform vec3 uCamPos;
  uniform mat4 uInvProj;
  uniform mat4 uCamWorld;
  uniform float uTime;
  uniform float uHover;
  uniform float uDive;
  uniform vec3 uDiskN;
  uniform vec3 uDiskU;
  uniform vec3 uDiskV;

  varying vec2 vNdc;

  const float RIN = 2.6;
  const float ROUT = 10.0;

  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash(vec3(i, 1.0));
    float b = hash(vec3(i + vec2(1.0, 0.0), 1.0));
    float c = hash(vec3(i + vec2(0.0, 1.0), 1.0));
    float d = hash(vec3(i + vec2(1.0, 1.0), 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }

  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
      v += a * noise(p);
      p = p * 2.03 + 7.1;
      a *= 0.5;
    }
    return v;
  }

  // 背景：深蓝底色 + 两层大小不同的星点
  vec3 sky(vec3 d) {
    vec3 col = vec3(0.003, 0.006, 0.02) + vec3(0.006, 0.012, 0.035) * (1.0 - abs(d.y));
    for (int layer = 0; layer < 2; layer++) {
      float scale = layer == 0 ? 70.0 : 150.0;
      vec3 p = d * scale;
      vec3 id = floor(p);
      vec3 f = fract(p) - 0.5;
      float h = hash(id);
      if (h > 0.982) {
        vec3 off = vec3(hash(id + 1.3), hash(id + 2.7), hash(id + 4.1)) - 0.5;
        float s = smoothstep(0.14, 0.0, length(f - off * 0.6));
        vec3 tint = mix(vec3(0.7, 0.8, 1.0), vec3(1.0, 0.92, 0.8), hash(id + 5.9));
        col += s * tint * (h - 0.982) * 90.0;
      }
    }
    return col;
  }

  // 盘面：内圈奶白、外圈褪成灰蓝，按开普勒角速度差速旋转，所以花纹会被拉成弧线
  vec4 disk(vec3 p, vec3 rd) {
    float r = length(p);
    if (r < RIN || r > ROUT) return vec4(0.0);

    float x = dot(p, uDiskU);
    float y = dot(p, uDiskV);
    float spin = uTime * 1.6 * pow(r, -1.5);
    float c = cos(spin);
    float s = sin(spin);
    vec2 q = vec2(c * x - s * y, s * x + c * y);

    // 先拉成细长的气流丝，再叠一层团块，避免一圈圈同心环像唱片
    float a = atan(q.y, q.x);
    float streaks = fbm(vec2(r * 3.2, cos(a) * 1.4 + sin(a) * 0.6) + q * 0.35);
    float clumps = fbm(q * 0.7 + 3.0);
    float density = pow(streaks, 1.6) * 1.8 * (0.55 + 0.6 * clumps);
    density *= smoothstep(RIN, RIN + 0.35, r) * (1.0 - smoothstep(ROUT * 0.35, ROUT, r));

    float heat = pow(RIN / r, 1.3);
    vec3 col = mix(vec3(0.32, 0.42, 0.75), vec3(1.0, 0.84, 0.62), clamp(heat * 1.4, 0.0, 1.0));
    // 最内一圈额外亮一道细边，没有后期辉光，亮边要自己画
    col += vec3(1.0, 0.85, 0.65) * 2.5 * (1.0 - smoothstep(RIN, RIN + 0.5, r));

    // 朝向镜头一侧的气体更亮（多普勒增亮），收着用，保持画面基本对称
    vec3 orbit = normalize(cross(uDiskN, p));
    float beam = clamp(1.0 + 0.35 * dot(orbit, -rd), 0.5, 1.6);

    float glow = (2.2 * heat + 0.22) * beam * (1.0 + uDive * 1.5);
    return vec4(col * glow, clamp(density * 1.3, 0.0, 1.0));
  }

  void main() {
    vec4 view = uInvProj * vec4(vNdc, 1.0, 1.0);
    vec3 rd = normalize((uCamWorld * vec4(view.xyz / view.w, 0.0)).xyz);
    vec3 pos = uCamPos;

    vec3 h = cross(pos, rd);
    float h2 = dot(h, h);

    vec3 col = vec3(0.0);
    float alpha = 0.0;
    float halo = 0.0;
    bool swallowed = false;

    for (int i = 0; i < STEPS; i++) {
      float r = length(pos);
      float dt = clamp(0.07 * r, 0.025, 2.0);
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

      // 光子球附近一圈蓝色辉光，再加一层很淡的大范围雾
      halo += (exp(-pow((r - 1.6) * 2.2, 2.0)) * 0.05 + exp(-r * 0.3) * 0.0012) * dt;

      pos = next;
      if (dot(pos, pos) < 1.0) {
        swallowed = true;
        break;
      }
      if (r > 90.0 && dot(pos, rd) > 0.0) break;
      if (alpha > 0.98) break;
    }

    vec3 bg = swallowed ? vec3(0.0) : sky(normalize(rd));
    col += (1.0 - alpha) * bg;
    // 掉进视界的光线在光子球附近绕了很多圈，辉光会累加成一层灰雾，把阴影糊掉
    if (swallowed) halo *= 0.06;
    col += halo * vec3(0.38, 0.55, 1.0) * (1.0 + uHover * 0.8 + uDive * 2.0);

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

    float a = aAngle + uTime * 1.6 * pow(r, -1.5) + fall * fall * 9.0;
    float lift = aLift * (1.0 - fall);
    vec3 p = (uDiskU * cos(a) + uDiskV * sin(a)) * r + uDiskN * lift;

    // 黑洞是画在背景上的，粒子却总盖在它前面。视线穿过阴影的粒子一律藏起来：
    // 背面的本来就该被挡住，前面那些零星光点落在纯黑上也只像噪点
    vec3 toP = p - cameraPosition;
    float miss = length(cross(normalize(toP), -cameraPosition));
    float hidden = 1.0 - smoothstep(2.4, 3.0, miss);

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize * uPixelRatio * (1.0 + fall * 1.5) / -mv.z;

    vSeed = aSeed;
    vHeat = clamp(3.0 / r, 0.0, 1.0);
    // 落到视界附近就收掉，不然会在黑色阴影上留一层亮点
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
    vec3 cool = vec3(0.55, 0.68, 1.0);
    vec3 warm = vec3(1.0, 0.88, 0.7);
    vec3 col = mix(cool, warm, clamp(vHeat + vSeed * 0.3, 0.0, 1.0));
    float a = core * core * vFade * (0.35 + 0.65 * uDive);
    gl_FragColor = vec4(col * a, a);
    #include <colorspace_fragment>
  }
`;
