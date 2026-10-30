import * as THREE from 'three';

// 外围的小天体：空间站轨道外面一圈稀疏的小行星带，再远一点两颗岩质小行星（其中一颗带一颗小卫星）。
// 都是低面数几何体 + 平直着色，小行星用 InstancedMesh，三种外形各一次绘制，几十块石头也只多三次绘制调用

// 光源在中心：吸积盘就是这片空间里唯一的灯。场景里那盏平行光是给空间站和探测器勾边用的，
// 方向固定，照到黑洞另一侧的石头时正好是背光面，看上去全是黑剪影。所以石头和行星用自己的小着色器，
// 按「指向黑洞中心」算漫反射，背面留一点冷色环境光
const rockVertex = /* glsl */ `
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying vec3 vColor;
  varying vec2 vUv;
  uniform vec3 uColor;
  void main() {
    mat4 m = modelMatrix;
    #ifdef USE_INSTANCING
    m = m * instanceMatrix;
    #endif
    vec4 world = m * vec4(position, 1.0);
    vWorld = world.xyz;
    vNormal = normalize(mat3(m) * normal);
    #ifdef USE_INSTANCING_COLOR
    vColor = instanceColor;
    #else
    vColor = uColor;
    #endif
    vUv = uv;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const rockFragment = /* glsl */ `
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying vec3 vColor;
  varying vec2 vUv;
  uniform sampler2D uMap;
  uniform float uUseMap;
  uniform float uFlat;
  void main() {
    // 石头按面算法线（棱角分明），行星用平滑法线
    vec3 faceN = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
    vec3 n = normalize(mix(vNormal, faceN, uFlat));
    vec3 toLight = normalize(-vWorld);
    float diffuse = max(dot(n, toLight), 0.0);
    vec3 base = vColor;
    if (uUseMap > 0.5) base *= texture2D(uMap, vUv).rgb;
    vec3 col = base * (vec3(0.04, 0.05, 0.07) + diffuse * vec3(1.05, 0.82, 0.6));
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

function rockMaterial(options: { color?: number; map?: THREE.Texture; flat: boolean }): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: rockVertex,
    fragmentShader: rockFragment,
    uniforms: {
      uColor: { value: new THREE.Color(options.color ?? 0xffffff) },
      uMap: { value: options.map ?? null },
      uUseMap: { value: options.map ? 1 : 0 },
      uFlat: { value: options.flat ? 1 : 0 },
    },
  });
}

// 和探测器、空间站同一套时间尺度：13 Rs 一圈 60 秒，周期按 a^1.5 放大
const period = (a: number) => 60 * Math.pow(a / 13, 1.5);

// 确定性的伪随机：每次打开页面石头摆的位置都一样，不会这次密那次疏
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// 一块石头的外形：二十面体细分一次，每个顶点沿法向随机推拉，同一位置的顶点推拉量相同，面与面之间不会裂缝
function rockGeometry(seed: number): THREE.BufferGeometry {
  const geometry = new THREE.IcosahedronGeometry(1, 1);
  const pos = geometry.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const h = Math.sin(v.x * 12.9898 + v.y * 78.233 + v.z * 37.719 + seed * 3.1) * 43758.5453;
    const bump = 0.72 + 0.5 * (h - Math.floor(h));
    v.multiplyScalar(bump);
    // 整体压扁拉长一点，不要都是球
    v.x *= 1.25;
    v.z *= 0.85;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geometry.computeVertexNormals();
  return geometry;
}

// 岩质行星的表面：铁锈色底子、几片深浅斑块、一些带亮边的环形坑
function planetTexture(base: string, dark: string, light: string, seed: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const rand = rng(seed);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 256, 128);
  for (let i = 0; i < 26; i++) {
    ctx.fillStyle = rand() < 0.5 ? dark : light;
    ctx.globalAlpha = 0.18 + rand() * 0.2;
    ctx.beginPath();
    ctx.ellipse(rand() * 256, rand() * 128, 10 + rand() * 40, 4 + rand() * 14, rand() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < 40; i++) {
    const x = rand() * 256;
    const y = 12 + rand() * 104;
    const r = 1.5 + Math.pow(rand(), 2) * 9;
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = dark;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.45;
    ctx.strokeStyle = light;
    ctx.lineWidth = Math.max(0.8, r * 0.25);
    ctx.beginPath();
    ctx.arc(x - r * 0.15, y - r * 0.15, r, Math.PI * 0.9, Math.PI * 1.9);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  return texture;
}

interface Planet {
  mesh: THREE.Mesh;
  a: number;
  theta0: number;
  tilt: THREE.Quaternion;
  spin: number;
  moon?: { mesh: THREE.Mesh; r: number; speed: number };
}

export interface Rocks {
  group: THREE.Group;
  // 每帧：按时间摆好位置，被黑洞挡住的藏起来（黑洞画在背景上，不藏会盖在阴影前面）
  update(simTime: number, hidden: (p: THREE.Vector3) => boolean): void;
  dispose(): void;
}

// startDir：开场时空间站在哪个方向。两颗行星的初始位置按它摆，保证一开始从甲板望出去，
// 它们分别落在黑洞左右两侧的画面里，而不是正好躲在黑洞背后
export function buildRocks(lite: boolean, startDir: THREE.Vector3): Rocks {
  const group = new THREE.Group();
  const disposables: { dispose(): void }[] = [];
  const rand = rng(20261030);

  // ---- 小行星带：52–72 Rs，薄薄一层，整体和盘面只差 2°，从甲板看是贴着盘面那条地平线的一串碎石 ----
  const beltTilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), THREE.MathUtils.degToRad(2));
  const material = rockMaterial({ flat: true });
  disposables.push(material);

  type Rock = { r: number; theta: number; y: number; size: number; axis: THREE.Vector3; spin: number; mesh: THREE.InstancedMesh; index: number };
  const rocks: Rock[] = [];
  // 只要一点点：桌面三种外形各 14 块，手机各 7 块
  const perShape = lite ? 7 : 14;
  const color = new THREE.Color();
  for (let shape = 0; shape < 3; shape++) {
    const geometry = rockGeometry(shape + 1);
    disposables.push(geometry);
    const mesh = new THREE.InstancedMesh(geometry, material, perShape);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    for (let i = 0; i < perShape; i++) {
      // 大部分是碎石，少数几块大的
      const big = rand() < 0.08;
      const size = big ? 0.6 + rand() * 0.35 : 0.1 + Math.pow(rand(), 2) * 0.35;
      rocks.push({
        r: 52 + rand() * 20,
        theta: rand() * Math.PI * 2,
        y: (rand() - 0.5) * 2,
        size,
        axis: new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize(),
        spin: 0.05 + rand() * 0.25,
        mesh,
        index: i,
      });
      // 灰褐色之间略有深浅
      color.setHSL(0.07 + rand() * 0.05, 0.1 + rand() * 0.1, 0.2 + rand() * 0.14);
      mesh.setColorAt(i, color);
    }
    group.add(mesh);
  }

  // ---- 两颗岩质行星 ----
  // 甲板望向黑洞的方向是 -startDir；两颗行星分别往两侧偏开一点
  const away = Math.atan2(-startDir.z, -startDir.x);
  const planets: Planet[] = [];
  const makePlanet = (radius: number, texture: THREE.CanvasTexture) => {
    const geometry = new THREE.SphereGeometry(radius, lite ? 24 : 40, lite ? 16 : 28);
    const mat = rockMaterial({ map: texture, flat: false });
    disposables.push(geometry, mat, texture);
    return new THREE.Mesh(geometry, mat);
  };

  const rusty = makePlanet(1.9, planetTexture('#8c5a43', '#4a2c22', '#c08a68', 7));
  const moonGeometry = new THREE.SphereGeometry(0.42, 18, 12);
  const moonMaterial = rockMaterial({ color: 0x9a948c, flat: true });
  disposables.push(moonGeometry, moonMaterial);
  const moon = new THREE.Mesh(moonGeometry, moonMaterial);
  planets.push({
    mesh: rusty,
    a: 96,
    theta0: away + 0.62,
    tilt: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), THREE.MathUtils.degToRad(6)),
    spin: 0.05,
    moon: { mesh: moon, r: 4.2, speed: 0.22 },
  });

  const icy = makePlanet(1.25, planetTexture('#6f7f96', '#3d4658', '#b6c4d6', 19));
  planets.push({
    mesh: icy,
    a: 128,
    theta0: away - 0.5,
    tilt: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), THREE.MathUtils.degToRad(-9)),
    spin: -0.03,
  });

  for (const planet of planets) {
    group.add(planet.mesh);
    if (planet.moon) group.add(planet.moon.mesh);
  }

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  const touched = new Set<THREE.InstancedMesh>();

  function update(simTime: number, hidden: (p: THREE.Vector3) => boolean) {
    for (const rock of rocks) {
      const theta = rock.theta + (simTime / period(rock.r)) * Math.PI * 2;
      p.set(Math.cos(theta) * rock.r, rock.y, Math.sin(theta) * rock.r).applyQuaternion(beltTilt);
      if (hidden(p)) {
        rock.mesh.setMatrixAt(rock.index, zero);
      } else {
        q.setFromAxisAngle(rock.axis, simTime * rock.spin);
        s.setScalar(rock.size);
        rock.mesh.setMatrixAt(rock.index, m.compose(p, q, s));
      }
      touched.add(rock.mesh);
    }
    for (const mesh of touched) mesh.instanceMatrix.needsUpdate = true;
    touched.clear();

    for (const planet of planets) {
      const theta = planet.theta0 + (simTime / period(planet.a)) * Math.PI * 2;
      planet.mesh.position.set(Math.cos(theta) * planet.a, 0, Math.sin(theta) * planet.a).applyQuaternion(planet.tilt);
      planet.mesh.rotation.y = simTime * planet.spin;
      planet.mesh.visible = !hidden(planet.mesh.position);
      if (planet.moon) {
        const phi = simTime * planet.moon.speed;
        planet.moon.mesh.position
          .set(Math.cos(phi) * planet.moon.r, Math.sin(phi) * planet.moon.r * 0.25, Math.sin(phi) * planet.moon.r)
          .add(planet.mesh.position);
        planet.moon.mesh.visible = !hidden(planet.moon.mesh.position);
      }
    }
  }

  return {
    group,
    update,
    dispose() {
      for (const item of disposables) item.dispose();
    },
  };
}
