// 每个场景专属的路面（2026-11-14 用户要「每一个场景你都可以自己设计一个场景专属路面」）。
// 一张画布现画的贴图盖在路面上：贴图的颜色是要盖上去的东西（砖缝、木板缝、落叶、花瓣、积雪、霓虹线……），
// 透明度是盖多少，没画到的地方透明，露出路面本来的颜色。路面的底色还是场景的 road，所以同一种路面换个底色也能用。
// 贴图横着管 16 米（整条路 12 米宽都在里面，左右车道、车辙能对准），顺着路管 8 米，四边接得上，一路铺下去

import * as THREE from 'three';
import { seeded } from './track';

export type Pave =
  | 'asphalt'
  | 'patched'
  | 'sandy'
  | 'leaves'
  | 'petals'
  | 'brick'
  | 'dirt'
  | 'sandstone'
  | 'planks'
  | 'neon'
  | 'ice'
  | 'snow'
  | 'cobble'
  | 'flagstone'
  | 'gravel'
  | 'crystal'
  | 'slab';

// 贴图横着、顺着各管多少米
export const PAVE_ACROSS = 16;
export const PAVE_ALONG = 8;
// 每米多少像素
const PX = 32;
const W = PAVE_ACROSS * PX;
const H = PAVE_ALONG * PX;
// 路面中线、三条车道中线在贴图上的横坐标
const MID = W / 2;
const LANES = [MID - 4 * PX, MID, MID + 4 * PX];
const EDGE = 6 * PX;

type Ctx = CanvasRenderingContext2D;

// 画在贴图边上的东西，在对面再画一份，铺开来接缝处是连着的
function wrapped(draw: (dx: number, dy: number) => void): void {
  for (const dx of [-W, 0, W]) for (const dy of [-H, 0, H]) draw(dx, dy);
}

function dot(ctx: Ctx, x: number, y: number, r: number, color: string): void {
  ctx.fillStyle = color;
  wrapped((dx, dy) => {
    ctx.beginPath();
    ctx.arc(x + dx, y + dy, r, 0, Math.PI * 2);
    ctx.fill();
  });
}

function soft(ctx: Ctx, x: number, y: number, r: number, rgb: string, alpha: number): void {
  wrapped((dx, dy) => {
    const g = ctx.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
    g.addColorStop(0, `rgba(${rgb},${alpha})`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(x + dx - r, y + dy - r, r * 2, r * 2);
  });
}

function speckle(ctx: Ctx, random: () => number, count: number, rgb: string, alpha: number, size: number): void {
  for (let i = 0; i < count; i += 1) {
    ctx.fillStyle = `rgba(${rgb},${(alpha * (0.4 + random() * 0.6)).toFixed(3)})`;
    const s = size * (0.5 + random());
    ctx.fillRect(random() * W, random() * H, s, s);
  }
}

// 一片小叶子或花瓣：转个随机的角度，椭圆
function flake(ctx: Ctx, x: number, y: number, long: number, wide: number, angle: number, color: string): void {
  ctx.fillStyle = color;
  wrapped((dx, dy) => {
    ctx.beginPath();
    ctx.ellipse(x + dx, y + dy, long, wide, angle, 0, Math.PI * 2);
    ctx.fill();
  });
}

// 一道弯弯曲曲的裂缝
function crack(ctx: Ctx, random: () => number, x: number, y: number, steps: number, color: string, width: number): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  let angle = random() * Math.PI * 2;
  const points: Array<[number, number]> = [[x, y]];
  for (let i = 0; i < steps; i += 1) {
    angle += (random() - 0.5) * 1.2;
    const len = 6 + random() * 10;
    const [px, py] = points[points.length - 1];
    points.push([px + Math.cos(angle) * len, py + Math.sin(angle) * len]);
  }
  wrapped((dx, dy) => {
    ctx.beginPath();
    points.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px + dx, py + dy) : ctx.lineTo(px + dx, py + dy)));
    ctx.stroke();
  });
}

// 一块块石头、砖、木板：先整张铺上缝的颜色，再把每一块挖空（露出路面本色），最后给每一块抹一点深浅
function stones(ctx: Ctx, random: () => number, blocks: Array<[number, number, number, number]>, gap: string, round: number, shade: number): void {
  ctx.fillStyle = gap;
  ctx.fillRect(0, 0, W, H);
  for (const [x, y, w, h] of blocks) {
    const tone = random();
    wrapped((dx, dy) => {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.roundRect(x + dx, y + dy, w, h, round);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = tone < 0.5 ? `rgba(0,0,0,${(shade * (0.5 - tone) * 2).toFixed(3)})` : `rgba(255,255,255,${(shade * 0.7 * (tone - 0.5) * 2).toFixed(3)})`;
      ctx.beginPath();
      ctx.roundRect(x + dx, y + dy, w, h, round);
      ctx.fill();
    });
  }
}

// 一行行的块：每行高 rowH，每块宽在 [minW, maxW] 之间随机，行与行之间错开。宽高都按像素，整行加起来正好是贴图宽
function rows(random: () => number, rowH: number, minW: number, maxW: number, inset: number): Array<[number, number, number, number]> {
  const out: Array<[number, number, number, number]> = [];
  for (let y = 0; y < H; y += rowH) {
    let x = random() * maxW;
    const start = x;
    while (x < start + W) {
      const w = Math.min(minW + random() * (maxW - minW), start + W - x);
      if (w > 3) out.push([(x % W) + inset / 2, y + inset / 2, w - inset, rowH - inset]);
      x += w;
    }
  }
  return out;
}

const PAINTERS: Record<Pave, (ctx: Ctx, random: () => number) => void> = {
  // 沥青：深浅不一的小颗粒
  asphalt: (ctx, random) => {
    speckle(ctx, random, 2600, '0,0,0', 0.16, 2);
    speckle(ctx, random, 1200, '255,255,255', 0.08, 1.5);
  },
  // 老沥青：补过的几块深色补丁，几道细裂缝
  patched: (ctx, random) => {
    PAINTERS.asphalt(ctx, random);
    for (let i = 0; i < 4; i += 1) {
      const x = random() * W;
      const y = random() * H;
      const w = (1.2 + random() * 2.4) * PX;
      const h = (0.8 + random() * 1.6) * PX;
      ctx.fillStyle = 'rgba(0,0,0,0.16)';
      wrapped((dx, dy) => ctx.fillRect(x + dx, y + dy, w, h));
    }
    for (let i = 0; i < 7; i += 1) crack(ctx, random, random() * W, random() * H, 6, 'rgba(0,0,0,0.35)', 1.2);
  },
  // 海边的路：路两边吹上来的沙，一片片的，越靠路边越多
  sandy: (ctx, random) => {
    PAINTERS.asphalt(ctx, random);
    for (let i = 0; i < 26; i += 1) {
      const side = random() < 0.5 ? -1 : 1;
      const x = MID + side * (EDGE - random() * random() * 4 * PX);
      soft(ctx, x, random() * H, (0.6 + random() * 1.2) * PX, '238,220,180', 0.35 + random() * 0.3);
    }
    speckle(ctx, random, 500, '240,226,190', 0.5, 2);
  },
  // 秋天的路：落了一地的枫叶和银杏叶
  leaves: (ctx, random) => {
    PAINTERS.asphalt(ctx, random);
    const colors = ['rgba(230,118,48,0.92)', 'rgba(208,72,44,0.9)', 'rgba(242,186,66,0.92)', 'rgba(170,96,52,0.85)'];
    for (let i = 0; i < 150; i += 1) {
      // 车道中间被车压过，叶子少；靠边多
      const x = random() * W;
      const lane = Math.min(...LANES.map((l) => Math.abs(x - l)));
      if (lane < 0.6 * PX && random() < 0.7) continue;
      flake(ctx, x, random() * H, 4 + random() * 4, 2.5 + random() * 2, random() * Math.PI, colors[Math.floor(random() * colors.length)]);
    }
  },
  // 樱花大道：浅色方石板，缝里、石板上落着樱花瓣
  petals: (ctx, random) => {
    const blocks: Array<[number, number, number, number]> = [];
    for (let y = 0; y < H; y += PX) {
      const shift = (y / PX) % 2 ? PX / 2 : 0;
      for (let x = shift; x < W + shift; x += PX) blocks.push([x % W + 1, y + 1, PX - 2, PX - 2]);
    }
    stones(ctx, random, blocks, 'rgba(60,50,60,0.3)', 2, 0.12);
    const colors = ['rgba(247,182,204,0.95)', 'rgba(252,214,226,0.95)', 'rgba(240,150,180,0.9)'];
    for (let i = 0; i < 220; i += 1) flake(ctx, random() * W, random() * H, 3 + random() * 2.5, 2 + random() * 1.5, random() * Math.PI, colors[Math.floor(random() * 3)]);
  },
  // 花田的乡间小路：红砖，一行行错开，浅色的灰缝
  brick: (ctx, random) => {
    const blocks: Array<[number, number, number, number]> = [];
    const bw = 0.5 * PX;
    const bh = 0.25 * PX;
    for (let y = 0; y < H; y += bh) {
      const shift = (y / bh) % 2 ? bw / 2 : 0;
      for (let x = shift; x < W + shift; x += bw) blocks.push([x % W + 1, y + 1, bw - 2, bh - 2]);
    }
    stones(ctx, random, blocks, 'rgba(232,220,200,0.6)', 1, 0.22);
  },
  // 松林里的土路：一块块深浅不一的土，每条车道两道车辙，散着松针
  dirt: (ctx, random) => {
    for (let i = 0; i < 40; i += 1) soft(ctx, random() * W, random() * H, (0.4 + random()) * PX, random() < 0.5 ? '0,0,0' : '255,240,220', 0.08 + random() * 0.08);
    for (const lane of LANES) {
      for (const off of [-0.7, 0.7]) {
        const x = lane + off * PX;
        const g = ctx.createLinearGradient(x - 8, 0, x + 8, 0);
        g.addColorStop(0, 'rgba(40,26,14,0)');
        g.addColorStop(0.5, 'rgba(40,26,14,0.3)');
        g.addColorStop(1, 'rgba(40,26,14,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x - 8, 0, 16, H);
      }
    }
    ctx.lineCap = 'round';
    for (let i = 0; i < 420; i += 1) {
      const x = random() * W;
      const y = random() * H;
      const a = random() * Math.PI;
      ctx.strokeStyle = random() < 0.5 ? 'rgba(120,88,52,0.7)' : 'rgba(84,96,58,0.6)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * 6, y + Math.sin(a) * 6);
      ctx.stroke();
    }
  },
  // 沙漠：大块的砂岩板，缝里、板上积着吹进来的沙
  sandstone: (ctx, random) => {
    stones(ctx, random, rows(random, 1.5 * PX, 1.6 * PX, 3 * PX, 3), 'rgba(70,44,24,0.38)', 4, 0.16);
    for (let i = 0; i < 18; i += 1) soft(ctx, random() * W, random() * H, (0.5 + random() * 1.1) * PX, '244,214,160', 0.3 + random() * 0.3);
    speckle(ctx, random, 700, '90,60,30', 0.2, 2);
  },
  // 海边栈桥：横着铺的木板，每块深浅不一，板与板之间一道缝，接头错开，钉子两颗一对
  planks: (ctx, random) => {
    const board = 0.25 * PX;
    for (let y = 0; y < H; y += board) {
      ctx.fillStyle = random() < 0.5 ? `rgba(0,0,0,${(random() * 0.16).toFixed(3)})` : `rgba(255,236,210,${(random() * 0.1).toFixed(3)})`;
      ctx.fillRect(0, y, W, board);
      ctx.fillStyle = 'rgba(20,12,8,0.55)';
      ctx.fillRect(0, y, W, 1.5);
      // 木纹：顺着木板几道细线
      for (let k = 0; k < 3; k += 1) {
        ctx.fillStyle = 'rgba(0,0,0,0.07)';
        ctx.fillRect(0, y + 2 + random() * (board - 3), W, 1);
      }
      let x = random() * 3 * PX;
      while (x < W) {
        ctx.fillStyle = 'rgba(20,12,8,0.5)';
        ctx.fillRect(x, y, 1.5, board);
        dot(ctx, x + 4, y + board * 0.3, 0.9, 'rgba(30,30,36,0.7)');
        dot(ctx, x + 4, y + board * 0.7, 0.9, 'rgba(30,30,36,0.7)');
        x += (2 + random() * 2.5) * PX;
      }
    }
  },
  // 霓虹都市：深色地砖，两米一格的青色发光线，中间细细的粉线，交叉处一颗亮点
  neon: (ctx, random) => {
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.fillRect(0, 0, W, H);
    for (let x = 0; x <= W; x += PX) {
      const major = (x / PX) % 2 === 0;
      ctx.fillStyle = major ? 'rgba(80,226,255,0.75)' : 'rgba(255,96,210,0.3)';
      ctx.fillRect(x - (major ? 1 : 0.5), 0, major ? 2 : 1, H);
    }
    for (let y = 0; y <= H; y += PX) {
      const major = (y / PX) % 2 === 0;
      ctx.fillStyle = major ? 'rgba(80,226,255,0.75)' : 'rgba(255,96,210,0.3)';
      ctx.fillRect(0, y - (major ? 1 : 0.5), W, major ? 2 : 1);
    }
    for (let x = 0; x <= W; x += 2 * PX) for (let y = 0; y <= H; y += 2 * PX) dot(ctx, x, y, 2.4, 'rgba(220,250,255,0.95)');
    speckle(ctx, random, 300, '120,200,255', 0.25, 1.5);
  },
  // 极光雪原：冻住的路，一片片泛着冷光的冰，几道白色冰裂，路边积着雪
  ice: (ctx, random) => {
    for (let i = 0; i < 22; i += 1) soft(ctx, random() * W, random() * H, (0.8 + random() * 1.4) * PX, '214,240,255', 0.2 + random() * 0.25);
    for (let i = 0; i < 9; i += 1) crack(ctx, random, random() * W, random() * H, 7, 'rgba(255,255,255,0.6)', 1);
    for (const side of [-1, 1]) {
      for (let i = 0; i < 14; i += 1) soft(ctx, MID + side * (EDGE - random() * 0.6 * PX), random() * H, (0.4 + random() * 0.6) * PX, '250,253,255', 0.7);
    }
  },
  // 雪山：压实的雪，每条车道两道压出来的车辙露着底下的路
  snow: (ctx, random) => {
    ctx.fillStyle = 'rgba(244,248,255,0.5)';
    ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 30; i += 1) soft(ctx, random() * W, random() * H, (0.3 + random() * 0.8) * PX, '255,255,255', 0.35);
    for (const lane of LANES) {
      for (const off of [-0.65, 0.65]) {
        const x = lane + off * PX;
        ctx.globalCompositeOperation = 'destination-out';
        const g = ctx.createLinearGradient(x - 7, 0, x + 7, 0);
        g.addColorStop(0, 'rgba(0,0,0,0)');
        g.addColorStop(0.5, 'rgba(0,0,0,0.75)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x - 7, 0, 14, H);
        ctx.globalCompositeOperation = 'source-over';
      }
    }
    speckle(ctx, random, 400, '150,170,200', 0.25, 1.5);
  },
  // 气球之丘：圆圆的鹅卵石
  cobble: (ctx, random) => {
    const blocks: Array<[number, number, number, number]> = [];
    const c = 0.42 * PX;
    for (let y = 0; y < H; y += c) {
      const shift = random() * c;
      for (let x = shift; x < W + shift; x += c * (0.85 + random() * 0.3)) blocks.push([x % W + 1.5, y + 1.5 + (random() - 0.5) * 1.5, c * (0.8 + random() * 0.2), c - 3]);
    }
    stones(ctx, random, blocks, 'rgba(40,36,44,0.42)', 5, 0.2);
  },
  // 高山峡谷：大小不一的石板路
  flagstone: (ctx, random) => {
    const blocks: Array<[number, number, number, number]> = [];
    const rowsH = [1.1, 1.4, 0.9, 1.6, 1.2, 1.8];
    let y = 0;
    let k = 0;
    while (y < H) {
      const h = Math.min(rowsH[k % rowsH.length] * PX, H - y);
      for (const block of rows(random, h, 1 * PX, 2.6 * PX, 3)) if (block[1] === 1.5) blocks.push([block[0], y + 1.5, block[2], h - 3]);
      y += h;
      k += 1;
    }
    stones(ctx, random, blocks, 'rgba(36,34,30,0.42)', 6, 0.2);
    speckle(ctx, random, 500, '0,0,0', 0.15, 2);
  },
  // 溪谷：碎石子路
  gravel: (ctx, random) => {
    for (let i = 0; i < 3400; i += 1) {
      const r = 0.8 + random() * 1.8;
      dot(ctx, random() * W, random() * H, r, random() < 0.5 ? `rgba(255,250,236,${(0.15 + random() * 0.3).toFixed(3)})` : `rgba(0,0,0,${(0.15 + random() * 0.3).toFixed(3)})`);
    }
  },
  // 水晶洞穴：深色石面上一道道发紫光的裂纹，散着几粒亮晶晶的碎晶
  crystal: (ctx, random) => {
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 14; i += 1) crack(ctx, random, random() * W, random() * H, 8, 'rgba(180,140,255,0.8)', 1.6);
    for (let i = 0; i < 60; i += 1) {
      const x = random() * W;
      const y = random() * H;
      soft(ctx, x, y, 5, '170,230,255', 0.5);
      dot(ctx, x, y, 1.4, 'rgba(235,250,255,0.95)');
    }
  },
  // 云海断桥：一块块大石板，缝里长了点青苔，靠桥边多
  slab: (ctx, random) => {
    stones(ctx, random, rows(random, 1.5 * PX, 2 * PX, 3.2 * PX, 4), 'rgba(40,40,36,0.45)', 3, 0.18);
    for (let i = 0; i < 40; i += 1) {
      const side = random() < 0.5 ? -1 : 1;
      soft(ctx, MID + side * (EDGE - random() * random() * 3 * PX), random() * H, (0.15 + random() * 0.35) * PX, '96,150,80', 0.55);
    }
    speckle(ctx, random, 500, '0,0,0', 0.14, 2);
  },
};

const cache = new Map<Pave, THREE.CanvasTexture>();

export function paveTexture(kind: Pave): THREE.CanvasTexture {
  let texture = cache.get(kind);
  if (texture) return texture;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (ctx) PAINTERS[kind](ctx, seeded(kind.length * 131 + kind.charCodeAt(0) * 7));
  texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  cache.set(kind, texture);
  return texture;
}

// 路面材质：普通受光材质，在着色器里按每个顶点带的 pave（是不是路面，0 或 1）把贴图盖上去，路肩和地面不盖
export function paveMaterial(kind: Pave): THREE.MeshLambertMaterial {
  const material = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const map = paveTexture(kind);
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uPave = { value: map };
    shader.vertexShader =
      'attribute float pave;\nattribute vec2 paveUv;\nvarying float vPave;\nvarying vec2 vPaveUv;\n' +
      shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vPave = pave;\n  vPaveUv = paveUv;');
    shader.fragmentShader =
      'uniform sampler2D uPave;\nvarying float vPave;\nvarying vec2 vPaveUv;\n' +
      shader.fragmentShader.replace(
        '#include <color_fragment>',
        '#include <color_fragment>\n  vec4 paveTint = texture2D(uPave, vPaveUv);\n  diffuseColor.rgb = mix(diffuseColor.rgb, paveTint.rgb, paveTint.a * vPave);',
      );
  };
  material.customProgramCacheKey = () => 'pelican-pave';
  return material;
}
