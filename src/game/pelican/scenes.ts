// 十五个场景：每个场景只是一套配色加一张景物清单，路是同一条。每一局从里面随机挑十二个、打乱顺序。
// 加新场景只往 SCENES 里添一项

import type { GateTheme } from './props';
import type { Pave } from './pave';
import type { CompanionKind } from './companion';
import type { TrackStyle } from './track';

export type PropKind =
  | 'palm'
  | 'treeGreen'
  | 'treeCherry'
  | 'treeAutumn'
  | 'treeRed'
  | 'pine'
  | 'pineSnow'
  | 'cactus'
  | 'rock'
  | 'rockSand'
  | 'rockSnow'
  | 'bush'
  | 'flowerPink'
  | 'flowerYellow'
  | 'flowerBlue'
  | 'lighthouse'
  | 'windmill'
  | 'balloonA'
  | 'balloonB'
  | 'cloud'
  | 'cloudWarm'
  | 'cloudDark'
  | 'hut'
  | 'cabin'
  | 'cabinSnow'
  | 'lamp'
  | 'tower'
  | 'sailboat'
  | 'parasol'
  | 'mesa'
  | 'snowman'
  | 'shoreRocks'
  | 'crystalPool'
  | 'mineCart'
  | 'lanternFloat'
  | 'neonSign'
  | 'foodCart'
  | 'picnic'
  | 'pagoda'
  | 'adobe'
  | 'bushDry'
  | 'bushSnow'
  | 'towerSlim'
  | 'towerWide'
  | 'hillGreen'
  | 'hillPink'
  | 'hillPine'
  | 'hillAutumn'
  | 'hillSnow'
  | 'hillNight'
  | 'dune'
  | 'mountain'
  | 'mountainWarm'
  | 'mountainSnow'
  | 'birds'
  | 'gulls'
  | 'fenceWhite'
  | 'fenceWood'
  | 'grass'
  | 'grassDry'
  | 'pole'
  | 'surfboard'
  | 'foam'
  | 'foamNight'
  | 'islet'
  | 'isletDusk'
  | 'buoy'
  | 'lighthouseLit'
  | 'sailboatLit'
  | 'torii'
  | 'stoneLantern'
  | 'logs'
  | 'tent'
  | 'mushroom'
  | 'deer'
  | 'hay'
  | 'pumpkin'
  | 'barn'
  | 'rockArch'
  | 'flamingo'
  | 'neonArchPink'
  | 'neonArchCyan'
  | 'billboardA'
  | 'billboardB'
  | 'igloo'
  | 'iceSpike'
  | 'penguin'
  | 'flagRed'
  | 'flagBlue'
  | 'ferrisWheel'
  | 'bigTop'
  | 'bigTopBlue'
  | 'bunting'
  | 'kite'
  | 'kiteBlue'
  | 'ridgeGreen'
  | 'ridgePink'
  | 'ridgePine'
  | 'ridgeAutumn'
  | 'ridgeSand'
  | 'ridgeSnow'
  | 'groveGreen'
  | 'groveCherry'
  | 'groveAutumn'
  | 'grovePine'
  | 'grovePineSnow'
  | 'hamlet'
  | 'hamletSnow'
  | 'seaStack'
  | 'crystal'
  | 'crystalBlue'
  | 'shroomGlow'
  | 'stalagmite'
  | 'stalactites'
  // 溶洞的钟乳石和石笋（石灰岩的颜色）
  | 'dripstone'
  | 'flowstone'
  | 'caveLamp'
  | 'bats'
  | 'eagles'
  | 'waterfall'
  | 'fallArch'
  | 'ropeBridge'
  | 'lotus'
  | 'lotusBloom'
  | 'reeds'
  | 'heron'
  | 'rowboat'
  | 'jumpFish';

// 小鱼的样子：普通的、圆滚滚的、细长的、又高又扁的
export type FishForm = 'plain' | 'round' | 'long' | 'tall';

// 每个场景自己的纪念品
export type TokenKind =
  | 'shell'
  | 'sunflower'
  | 'blossom'
  | 'pinecone'
  | 'maple'
  | 'turquoise'
  | 'coconut'
  | 'starfish'
  | 'note'
  | 'snowflake'
  | 'icegem'
  | 'balloon'
  | 'feather'
  | 'lotus'
  | 'crystal'
  | 'cloud';

export type Backdrop = 'none' | 'islands' | 'hills' | 'peaks' | 'mesa' | 'city';

export interface PropRule {
  kind: PropKind;
  // 每 100 米路放几个
  per100: number;
  // 离路中心最近、最远多少米
  near: number;
  far: number;
  // 只放在一侧：-1 左，1 右；不写就两侧都放
  side?: -1 | 1;
  // 大小的范围
  scale?: [number, number];
  // 飘在空中的东西：离地多高
  lift?: [number, number];
  // 朝着路摆（路灯、小屋），不写就随机朝向
  face?: boolean;
  // 浮在水面上（浪花、浮标、帆船），不跟着地面的高低走
  float?: boolean;
  // 整个跨在路上（鸟居、彩旗、霓虹拱门）：摆在路中线上，沿路等距
  span?: boolean;
  // 占地半径（米）。大块头放之前要查一遍，别压在前面拐过来的路上
  clear?: number;
  // 贴着崖壁脚摆、和崖壁一样高（瀑布）
  wall?: boolean;
  // 只放在露天的地方（sky），或者只放在洞顶、隧道底下（roof）。不写就哪儿都放
  under?: 'sky' | 'roof';
  // 只放在这段场景的某一截里，按比例写：0 是进场景的门，1 是出场景的门
  part?: [number, number];
}

// 空气里飘着的东西：花瓣、落叶、雪、萤火
export interface Air {
  color: number;
  // 每一片多大（米）
  size: number;
  // 往下落多快（米每秒），负数是往上飘
  fall: number;
  // 顺风横着飘多快（米每秒）
  drift: number;
  // 来回晃的幅度（米）
  sway: number;
  // 多不多，0 到 1
  amount: number;
}

// 路两侧的崖壁：从离路中心 foot 米的地方拔起来，高 height 米，越往上越往外斜（lean 是每升一米往外多少米）。
// color 是岩层的两种颜色，top 是崖顶的颜色
export interface Walls {
  foot: number;
  height: number;
  lean: number;
  color: [number, number];
  top: number;
  // 岩壁上长的草木：两种绿，和长了几成（0 到 1，越往上长得越多）。不写就是光秃秃的石头
  moss?: { color: [number, number]; amount: number };
  // 过了这段场景的 from（比例）以后，崖脚往外退到 foot 这么远：峡谷到这里一下子开阔起来
  widen?: { from: number; foot: number };
  // 高山：山脊最高那一截是雪
  snow?: boolean;
}

export interface Scene extends TrackStyle {
  name: string;
  // 这个场景独有的纪念品，路上会掉几个
  token: { kind: TokenKind; name: string };
  // 进这个场景时那道门的样子（props.ts 的 GateTheme），每个场景一种（用户要求）
  gate: Exclude<GateTheme, 'finish'>;
  // 这个场景里小鱼的样子和颜色（金鱼是同一个样子的金色）。夜里和洞里的写 glow，自己发光才看得见
  fish: { form: FishForm; body: number; fin: number; glow?: boolean };
  // 天空三段颜色：天顶、中段、地平线
  sky: [number, number, number];
  // 太阳或月亮：颜色、离地平线多高（度）、偏离出发方向多少（度，正数偏右）、大小
  sun: { color: number; height: number; turn: number; size: number };
  // 星星有多亮，0 到 1
  stars: number;
  // 天上有没有极光、多亮，0 到 1。不写就是没有
  aurora?: number;
  // 雾从多远开始、到多远全白（米），颜色就是地平线的颜色
  fog: [number, number];
  light: { sun: number; sunPower: number; sky: number; ground: number; power: number };
  road: number;
  // 这个场景专属的路面（pave.ts，2026-11-14 用户要「每个场景一种路面」），贴图盖在 road 这个底色上
  pave: Pave;
  line: number;
  curb: [number, number];
  shoulder: number;
  ground: [number, number];
  // 远处一直铺到天边的那一片：陆地场景是地面，海边场景是水
  far: number;
  // 路两边的地面有多宽（米），窄的话外面就是水
  land: number;
  // 地面起伏有多大（米）
  bumps: number;
  // 峡谷和洞穴两侧的崖壁，不写就是开阔地
  walls?: Walls;
  // 哪几段头顶有顶（洞顶、隧道），按这段场景的比例写，0 是进场景的门，1 是出场景的门。要有崖壁才能有顶
  cover?: Array<[number, number]>;
  backdrop: Backdrop;
  backdropColor: number;
  air?: Air;
  // 路架在桥上：桥面以外是空的，底下一对对桥柱落到水里（world.ts 的 bridgeAt）
  bridge?: boolean;
  // 谷底飘着的雾有多浓，0 到 1。只有人在高处时看得见，下到水面就散开
  mist?: number;
  // 氛围（game.ts 的 ATMOSPHERE）：太阳在画面里往外放的光束有多强（不写就按太阳的高低和是不是夜里算）、四角压暗多少
  rays?: number;
  vignette?: number;
  // 跟着鹈鹕的小伙伴（companion.ts，2026-11-14 用户要的），每个场景一种
  companion: CompanionKind;
  props: PropRule[];
}

// 每个场景骑多长（米）。必须是 4 的倍数：崖壁是按 4 米一排建的，两段场景要在同一排上接缝。
// 用户三次要「每个场景路程长一点」：380 -> 560 -> 700 -> 900。场景里按几成写的位置（cover、widen、part）会跟着伸缩，按米写的（climb、steps）不会，
// 改长度要回头看高山峡谷和云海断桥：隧道、崖壁退开、湖边景物这几处按几成写的，要和按米写的断层对上
export const SCENE_LENGTH = 900;

export const SCENES: readonly Scene[] = [
  {
    name: '海滨晨光',
    // 一只海鸥贴着海岸跟着飞
    companion: 'gull',
    token: { kind: 'shell', name: '贝壳' },
    gate: 'driftwood',
    fish: { form: 'plain', body: 0xf2933a, fin: 0xfbc46a },
    curve: 0.5,
    hill: 0.6,
    sky: [0x6fb7e6, 0xbfe4f2, 0xfdf3de],
    sun: { color: 0xfff6d8, height: 24, turn: -38, size: 0.05 },
    stars: 0,
    fog: [140, 620],
    light: { sun: 0xfff2d6, sunPower: 2.2, sky: 0xd9f0ff, ground: 0xe8d3a8, power: 1.5 },
    road: 0x5d5f6b,
    // 海边的柏油路，两边吹上来一片片沙
    pave: 'sandy',
    line: 0xfdfaf0,
    curb: [0xe56a54, 0xfdf6ea],
    shoulder: 0xf1dcae,
    ground: [0xf3e2b8, 0xeed9a6],
    far: 0x58b9c9,
    land: 30,
    bumps: 0.3,
    backdrop: 'islands',
    backdropColor: 0x8fc4cf,
    props: [
      { kind: 'palm', per100: 5, near: 8.4, far: 8.4, scale: [1.1, 1.5] },
      { kind: 'palm', per100: 6, near: 11, far: 26, scale: [0.9, 1.4] },
      { kind: 'parasol', per100: 3.5, near: 10, far: 22, scale: [0.9, 1.2] },
      { kind: 'surfboard', per100: 2.2, near: 9, far: 22, scale: [0.9, 1.2] },
      { kind: 'hut', per100: 1.2, near: 13, far: 22, face: true },
      { kind: 'rockSand', per100: 2, near: 9, far: 26, scale: [0.5, 1.1] },
      { kind: 'foam', per100: 7, near: 33, far: 95, face: true, float: true, scale: [0.8, 1.6] },
      { kind: 'buoy', per100: 0.9, near: 42, far: 110, float: true },
      { kind: 'sailboat', per100: 1.8, near: 60, far: 190, float: true, scale: [1.4, 2.6] },
      { kind: 'islet', per100: 0.6, near: 110, far: 250, float: true, clear: 16, scale: [0.9, 1.6] },
      { kind: 'lighthouse', per100: 0.3, near: 20, far: 26, side: -1 },
      { kind: 'gulls', per100: 1.6, near: 12, far: 110, lift: [26, 62], scale: [1, 1.7] },
      { kind: 'seaStack', per100: 1.3, near: 46, far: 150, float: true, clear: 8, scale: [0.8, 1.5] },
      { kind: 'shoreRocks', per100: 2.4, near: 31, far: 38, float: true, scale: [0.7, 1.3] },
      { kind: 'cloud', per100: 2.4, near: 40, far: 320, lift: [45, 110], scale: [1, 2.4] },
    ],
  },
  {
    name: '花田风车',
    // 一只黄蝴蝶跟着乱飞
    companion: 'butterfly',
    token: { kind: 'sunflower', name: '向日葵' },
    gate: 'flowers',
    fish: { form: 'round', body: 0xf7b84a, fin: 0xfde27a },
    curve: 0.7,
    hill: 4.5,
    sky: [0x62aee6, 0xa9daf2, 0xeaf6e4],
    sun: { color: 0xfffbe4, height: 46, turn: 28, size: 0.045 },
    stars: 0,
    fog: [150, 640],
    light: { sun: 0xfff7e0, sunPower: 2.3, sky: 0xd4ecff, ground: 0xa8cf86, power: 1.5 },
    road: 0x9c5a46,
    // 乡间的红砖路
    pave: 'brick',
    line: 0xfdfaf0,
    curb: [0xf2c14e, 0xfdf6ea],
    shoulder: 0xc9d99a,
    ground: [0x9fd07c, 0x8cc46e],
    far: 0x86bf6c,
    land: 75,
    bumps: 2.2,
    backdrop: 'hills',
    backdropColor: 0x8fc0a0,
    air: { color: 0xfff6b8, size: 0.09, fall: 0.35, drift: 1.1, sway: 0.9, amount: 0.5 },
    props: [
      { kind: 'fenceWhite', per100: 12, near: 8, far: 8, face: true },
      { kind: 'flowerPink', per100: 16, near: 8.6, far: 42, scale: [0.9, 1.6] },
      { kind: 'flowerYellow', per100: 16, near: 8.6, far: 42, scale: [0.9, 1.6] },
      { kind: 'flowerBlue', per100: 9, near: 8.6, far: 42, scale: [0.9, 1.6] },
      { kind: 'grass', per100: 16, near: 8.6, far: 30, scale: [0.9, 1.5] },
      { kind: 'treeGreen', per100: 4, near: 12, far: 60, scale: [0.9, 1.5] },
      { kind: 'windmill', per100: 1.1, near: 20, far: 58, face: true, clear: 5, scale: [1, 1.5] },
      { kind: 'bush', per100: 5, near: 9, far: 50, scale: [0.8, 1.4] },
      { kind: 'hillGreen', per100: 1.5, near: 95, far: 240, clear: 46, scale: [0.7, 1.5] },
      { kind: 'birds', per100: 0.8, near: 15, far: 120, lift: [34, 78], scale: [1, 1.6] },
      { kind: 'groveGreen', per100: 2.2, near: 78, far: 200, clear: 12, scale: [0.9, 1.5] },
      { kind: 'hamlet', per100: 0.7, near: 60, far: 130, clear: 14 },
      { kind: 'ridgeGreen', per100: 1.2, near: 160, far: 300, clear: 84, scale: [0.8, 1.3] },
      { kind: 'cloud', per100: 2.4, near: 40, far: 320, lift: [50, 120], scale: [1, 2.4] },
      { kind: 'balloonB', per100: 0.5, near: 50, far: 180, lift: [30, 70] },
    ],
  },
  {
    name: '樱花大道',
    // 一只蝴蝶穿过花瓣跟着飞
    companion: 'butterfly',
    token: { kind: 'blossom', name: '樱花' },
    gate: 'sakura',
    fish: { form: 'tall', body: 0xf58fb2, fin: 0xfde3ec },
    curve: 0.45,
    hill: 2,
    sky: [0x8fb8ec, 0xd7dcf6, 0xfde6ee],
    sun: { color: 0xfff4ee, height: 40, turn: -20, size: 0.045 },
    stars: 0,
    fog: [110, 520],
    light: { sun: 0xfff0ea, sunPower: 2.1, sky: 0xf1e2ff, ground: 0xd9c2c8, power: 1.6 },
    road: 0x9a929c,
    // 浅色方石板，落满樱花瓣
    pave: 'petals',
    line: 0xfff6f6,
    curb: [0xf3a3bd, 0xfdf3f5],
    shoulder: 0xf3d6dc,
    ground: [0xb9d79a, 0xc6dea6],
    far: 0xb3d39a,
    land: 75,
    bumps: 1.2,
    backdrop: 'hills',
    backdropColor: 0xc7b6cf,
    air: { color: 0xffc4d8, size: 0.13, fall: 1.1, drift: 1.7, sway: 1.2, amount: 1 },
    props: [
      { kind: 'torii', per100: 0.8, near: 0, far: 0, span: true },
      { kind: 'treeCherry', per100: 10, near: 9, far: 12.5, scale: [1.1, 1.5] },
      { kind: 'treeCherry', per100: 9, near: 14, far: 60, scale: [0.9, 1.7] },
      { kind: 'stoneLantern', per100: 5, near: 7.9, far: 7.9, face: true },
      { kind: 'flowerPink', per100: 12, near: 8.6, far: 30, scale: [0.8, 1.4] },
      { kind: 'grass', per100: 10, near: 8.6, far: 26, scale: [0.9, 1.4] },
      { kind: 'bush', per100: 4, near: 9, far: 40 },
      { kind: 'picnic', per100: 1.2, near: 11, far: 22 },
      { kind: 'pagoda', per100: 0.5, near: 30, far: 60, face: true, clear: 4, scale: [1, 1.4] },
      { kind: 'hillPink', per100: 1.5, near: 95, far: 240, clear: 46, scale: [0.7, 1.5] },
      { kind: 'birds', per100: 0.6, near: 15, far: 120, lift: [36, 80], scale: [1, 1.5] },
      { kind: 'groveCherry', per100: 2.2, near: 78, far: 200, clear: 12, scale: [0.9, 1.5] },
      { kind: 'ridgePink', per100: 1.2, near: 160, far: 300, clear: 84, scale: [0.8, 1.3] },
      { kind: 'cloudWarm', per100: 1.8, near: 40, far: 320, lift: [50, 120], scale: [1, 2.2] },
    ],
  },
  {
    name: '松林小屋',
    // 一只小鸟在林子边上跟着
    companion: 'songbird',
    token: { kind: 'pinecone', name: '松果' },
    gate: 'log',
    fish: { form: 'long', body: 0x7fae6a, fin: 0xc9d99a },
    curve: 0.85,
    hill: 6,
    sky: [0x5f9bc2, 0xa9cdd4, 0xdfeee0],
    sun: { color: 0xf6fbe8, height: 52, turn: 60, size: 0.04 },
    stars: 0,
    fog: [70, 380],
    light: { sun: 0xf0f7dc, sunPower: 1.9, sky: 0xcfe8e2, ground: 0x6f9a72, power: 1.5 },
    road: 0x7a6650,
    // 林间土路，两道车辙、一地松针
    pave: 'dirt',
    line: 0xf2f4ea,
    curb: [0x7b8f6a, 0xe9eedd],
    shoulder: 0x8aa57a,
    ground: [0x5e9a6a, 0x528c60],
    far: 0x4f8760,
    land: 75,
    bumps: 3,
    backdrop: 'peaks',
    backdropColor: 0x7fa9a4,
    air: { color: 0xeaffd2, size: 0.07, fall: 0.08, drift: 0.5, sway: 1.1, amount: 0.5 },
    props: [
      { kind: 'pine', per100: 16, near: 9, far: 26, scale: [0.9, 1.6] },
      { kind: 'pine', per100: 14, near: 26, far: 70, scale: [1.2, 2.1] },
      { kind: 'rock', per100: 3, near: 8.6, far: 40, scale: [0.6, 1.6] },
      { kind: 'cabin', per100: 0.9, near: 14, far: 28, face: true },
      { kind: 'tent', per100: 0.9, near: 11, far: 20, face: true },
      { kind: 'logs', per100: 1.8, near: 8.6, far: 14 },
      { kind: 'mushroom', per100: 4, near: 8.4, far: 16, scale: [0.8, 1.4] },
      { kind: 'deer', per100: 1.1, near: 10, far: 24 },
      { kind: 'grass', per100: 12, near: 8.6, far: 24, scale: [0.9, 1.5] },
      { kind: 'bush', per100: 5, near: 8.6, far: 30 },
      { kind: 'hillPine', per100: 1.6, near: 95, far: 230, clear: 46, scale: [0.7, 1.5] },
      { kind: 'mountain', per100: 0.6, near: 250, far: 400, clear: 86, scale: [0.8, 1.3] },
      { kind: 'birds', per100: 0.6, near: 15, far: 120, lift: [38, 82], scale: [1, 1.5] },
      { kind: 'grovePine', per100: 3, near: 78, far: 200, clear: 13, scale: [1, 1.7] },
      { kind: 'ridgePine', per100: 1.2, near: 160, far: 300, clear: 84, scale: [0.8, 1.3] },
      { kind: 'cloud', per100: 1.6, near: 40, far: 320, lift: [60, 120], scale: [1.2, 2.4] },
    ],
  },
  {
    name: '秋日山谷',
    // 一只小鸟跟着
    companion: 'songbird',
    token: { kind: 'maple', name: '枫叶' },
    gate: 'harvest',
    fish: { form: 'plain', body: 0xe5632e, fin: 0xf2b550 },
    curve: 0.8,
    hill: 7,
    sky: [0x6c9fd2, 0xc9d8de, 0xfbe7c4],
    sun: { color: 0xffedc2, height: 30, turn: 42, size: 0.05 },
    stars: 0,
    fog: [120, 560],
    light: { sun: 0xffe6b8, sunPower: 2.2, sky: 0xdde9f2, ground: 0xc9a468, power: 1.5 },
    road: 0x5f5b60,
    // 柏油路上落满枫叶和银杏叶
    pave: 'leaves',
    line: 0xfbf3e2,
    curb: [0xd9772f, 0xfbf0dc],
    shoulder: 0xd9bd84,
    ground: [0xd2b266, 0xc7a257],
    far: 0xbf9a52,
    land: 75,
    bumps: 3.2,
    backdrop: 'peaks',
    backdropColor: 0xb59a86,
    air: { color: 0xe98a3a, size: 0.14, fall: 1.3, drift: 2.2, sway: 1.4, amount: 0.8 },
    props: [
      { kind: 'fenceWood', per100: 10, near: 8, far: 8, face: true },
      { kind: 'treeAutumn', per100: 9, near: 9.5, far: 60, scale: [0.9, 1.7] },
      { kind: 'treeRed', per100: 7, near: 9.5, far: 60, scale: [0.9, 1.6] },
      { kind: 'treeGreen', per100: 2, near: 12, far: 60, scale: [0.9, 1.4] },
      { kind: 'rock', per100: 3, near: 8.6, far: 45, scale: [0.6, 1.8] },
      { kind: 'hay', per100: 2.4, near: 9.5, far: 30, scale: [0.9, 1.2] },
      { kind: 'pumpkin', per100: 3, near: 8.6, far: 15, scale: [0.8, 1.3] },
      { kind: 'barn', per100: 0.5, near: 18, far: 34, face: true, clear: 6, scale: [1.4, 1.7] },
      { kind: 'cabin', per100: 0.5, near: 14, far: 30, face: true },
      { kind: 'grassDry', per100: 14, near: 8.6, far: 28, scale: [0.9, 1.5] },
      { kind: 'flowerYellow', per100: 6, near: 8.6, far: 30 },
      { kind: 'hillAutumn', per100: 1.5, near: 95, far: 240, clear: 46, scale: [0.7, 1.5] },
      { kind: 'mountainWarm', per100: 0.5, near: 250, far: 400, clear: 86, scale: [0.8, 1.3] },
      { kind: 'birds', per100: 0.9, near: 15, far: 120, lift: [36, 80], scale: [1, 1.6] },
      { kind: 'groveAutumn', per100: 2.2, near: 78, far: 200, clear: 12, scale: [0.9, 1.5] },
      { kind: 'hamlet', per100: 0.6, near: 60, far: 130, clear: 14 },
      { kind: 'ridgeAutumn', per100: 1.2, near: 160, far: 300, clear: 84, scale: [0.8, 1.3] },
      { kind: 'cloudWarm', per100: 2, near: 40, far: 320, lift: [55, 120], scale: [1, 2.4] },
    ],
  },
  {
    name: '沙漠峡谷',
    // 一只鹰在前头高处盘着
    companion: 'hawk',
    token: { kind: 'turquoise', name: '绿松石' },
    gate: 'adobe',
    fish: { form: 'long', body: 0xd99a58, fin: 0xf8e6c4 },
    curve: 0.6,
    hill: 3.5,
    sky: [0x4f9fd8, 0xbcd8e4, 0xfbe2b6],
    sun: { color: 0xfff0c8, height: 26, turn: -30, size: 0.055 },
    stars: 0,
    fog: [150, 650],
    light: { sun: 0xffe7b4, sunPower: 2.4, sky: 0xe3eef6, ground: 0xe0a868, power: 1.5 },
    road: 0xa47c58,
    // 大块砂岩板，缝里积着沙
    pave: 'sandstone',
    line: 0xfbf0d8,
    curb: [0xc45a34, 0xf8e6c4],
    shoulder: 0xe7c088,
    ground: [0xe6b06c, 0xdca25e],
    far: 0xd99a58,
    land: 75,
    bumps: 2.4,
    backdrop: 'mesa',
    backdropColor: 0xc98a62,
    air: { color: 0xf6dcae, size: 0.07, fall: 0.05, drift: 4.2, sway: 0.6, amount: 0.6 },
    props: [
      { kind: 'pole', per100: 3.4, near: 8.4, far: 8.4, side: 1, face: true },
      { kind: 'cactus', per100: 7, near: 9, far: 50, scale: [0.8, 1.6] },
      { kind: 'rockSand', per100: 6, near: 8.6, far: 60, scale: [0.6, 2.2] },
      { kind: 'rockArch', per100: 0.5, near: 24, far: 52, face: true, clear: 9, scale: [0.9, 1.3] },
      { kind: 'mesa', per100: 1.6, near: 34, far: 72, clear: 9, scale: [0.9, 1.9] },
      { kind: 'bushDry', per100: 4, near: 8.6, far: 40, scale: [0.6, 1.1] },
      { kind: 'grassDry', per100: 9, near: 8.6, far: 30, scale: [0.9, 1.4] },
      { kind: 'adobe', per100: 0.8, near: 16, far: 40, face: true, clear: 4, scale: [0.9, 1.2] },
      { kind: 'dune', per100: 1.5, near: 95, far: 240, clear: 46, scale: [0.7, 1.5] },
      { kind: 'mountainWarm', per100: 0.6, near: 250, far: 400, clear: 86, scale: [0.8, 1.3] },
      { kind: 'birds', per100: 0.5, near: 15, far: 120, lift: [40, 85], scale: [1, 1.5] },
      { kind: 'ridgeSand', per100: 1.5, near: 150, far: 300, clear: 84, scale: [0.8, 1.4] },
      { kind: 'cloudWarm', per100: 1.2, near: 60, far: 320, lift: [60, 120], scale: [1, 2] },
    ],
  },
  {
    name: '棕榈晚霞',
    // 一只海鸥跟着
    companion: 'gull',
    token: { kind: 'coconut', name: '椰子' },
    gate: 'tiki',
    fish: { form: 'tall', body: 0xff8a5c, fin: 0xffd08a },
    curve: 0.55,
    hill: 1.2,
    sky: [0xd9683f, 0xf0925a, 0xfbc98a],
    sun: { color: 0xffe2a8, height: 7, turn: 8, size: 0.085 },
    stars: 0,
    fog: [130, 600],
    light: { sun: 0xffb877, sunPower: 2.1, sky: 0xffd2a6, ground: 0xb98a6a, power: 1.5 },
    road: 0x5a4d50,
    // 补过好几回的老柏油路
    pave: 'patched',
    line: 0xfdeedb,
    curb: [0xd0563a, 0xfbe6cf],
    shoulder: 0xe9c08e,
    ground: [0xdcb488, 0xd0a67a],
    // 晚霞这一段也是海边：两边的沙地不宽，再往外是映着霞光的水
    far: 0xcf7f66,
    land: 38,
    bumps: 0.5,
    backdrop: 'islands',
    backdropColor: 0xc9785e,
    air: { color: 0xffdca8, size: 0.07, fall: 0.06, drift: 0.7, sway: 1, amount: 0.4 },
    props: [
      { kind: 'palm', per100: 6, near: 8.4, far: 8.4, scale: [1.2, 1.7] },
      { kind: 'palm', per100: 7, near: 12, far: 32, scale: [0.9, 1.6] },
      { kind: 'flamingo', per100: 2.6, near: 9, far: 26, scale: [0.9, 1.3] },
      { kind: 'rockSand', per100: 3, near: 9, far: 32, scale: [0.5, 1.3] },
      { kind: 'bushDry', per100: 3, near: 9, far: 30 },
      { kind: 'surfboard', per100: 1, near: 9, far: 22 },
      { kind: 'foam', per100: 5, near: 42, far: 100, face: true, float: true, scale: [0.8, 1.6] },
      { kind: 'sailboat', per100: 1.4, near: 60, far: 190, float: true, scale: [1.4, 2.6] },
      { kind: 'isletDusk', per100: 0.7, near: 110, far: 250, float: true, clear: 16, scale: [0.9, 1.6] },
      { kind: 'birds', per100: 1.5, near: 12, far: 120, lift: [30, 72], scale: [1, 1.7] },
      { kind: 'balloonA', per100: 0.8, near: 40, far: 170, lift: [28, 75] },
      { kind: 'balloonB', per100: 0.5, near: 40, far: 170, lift: [28, 75] },
      { kind: 'seaStack', per100: 1.1, near: 52, far: 160, float: true, clear: 8, scale: [0.8, 1.5] },
      { kind: 'shoreRocks', per100: 2, near: 39, far: 46, float: true, scale: [0.7, 1.3] },
      { kind: 'cloudWarm', per100: 3, near: 40, far: 320, lift: [45, 110], scale: [0.9, 2] },
    ],
  },
  {
    name: '灯塔夜海',
    // 一小团萤火虫跟着，照亮身边
    companion: 'firefly',
    token: { kind: 'starfish', name: '海星' },
    gate: 'harbor',
    fish: { form: 'round', body: 0x8fd8ff, fin: 0xe6f8ff, glow: true },
    curve: 0.5,
    hill: 1,
    sky: [0x131a3c, 0x2b3a6c, 0x7a6a94],
    sun: { color: 0xf3f0dc, height: 34, turn: -46, size: 0.04 },
    stars: 0.75,
    fog: [110, 520],
    light: { sun: 0x9fb4ff, sunPower: 1.5, sky: 0x6f82c4, ground: 0x3a3a5c, power: 1.6 },
    road: 0x5a4a46,
    // 海边栈桥的木板
    pave: 'planks',
    line: 0xd9dcf0,
    curb: [0x8c5f86, 0xcfd3ea],
    shoulder: 0x6b6a86,
    ground: [0x5a6384, 0x525b7c],
    far: 0x1f3564,
    land: 28,
    bumps: 0.4,
    backdrop: 'islands',
    backdropColor: 0x3a4678,
    air: { color: 0xfff2a6, size: 0.09, fall: -0.25, drift: 0.4, sway: 1.5, amount: 0.6 },
    props: [
      { kind: 'lighthouseLit', per100: 0.8, near: 18, far: 25 },
      { kind: 'lamp', per100: 3.2, near: 7.8, far: 7.8, face: true },
      { kind: 'rock', per100: 5, near: 9, far: 26, scale: [0.6, 1.7] },
      { kind: 'palm', per100: 2.5, near: 9, far: 22, scale: [0.9, 1.3] },
      { kind: 'foamNight', per100: 6, near: 31, far: 85, face: true, float: true, scale: [0.8, 1.6] },
      { kind: 'buoy', per100: 1.8, near: 36, far: 110, float: true },
      { kind: 'lanternFloat', per100: 6, near: 32, far: 80, float: true, scale: [0.9, 1.4] },
      { kind: 'sailboatLit', per100: 1.5, near: 60, far: 190, float: true, scale: [1.4, 2.4] },
      { kind: 'seaStack', per100: 1.5, near: 44, far: 150, float: true, clear: 8, scale: [0.8, 1.6] },
      { kind: 'shoreRocks', per100: 2.4, near: 29, far: 36, float: true, scale: [0.7, 1.3] },
      { kind: 'cloudDark', per100: 1.6, near: 40, far: 320, lift: [50, 110], scale: [1, 2.2] },
    ],
  },
  {
    name: '霓虹都市',
    // 一架小无人机跟拍
    companion: 'drone',
    token: { kind: 'note', name: '音符' },
    gate: 'neon',
    fish: { form: 'long', body: 0xff6fb5, fin: 0x8ee6ff, glow: true },
    curve: 0.35,
    hill: 0.8,
    sky: [0x0c0f26, 0x1d1c46, 0x4a2f6a],
    sun: { color: 0xe8e6ff, height: 50, turn: 55, size: 0.03 },
    stars: 0.45,
    fog: [100, 480],
    light: { sun: 0xa9a2ff, sunPower: 1.3, sky: 0x7a6fd0, ground: 0x3a2f5c, power: 1.7 },
    road: 0x2c2d40,
    // 深色地砖上一格格发光的霓虹线
    pave: 'neon',
    line: 0xe6e2ff,
    curb: [0xe0569a, 0x3f3f5c],
    shoulder: 0x47465f,
    ground: [0x3c3d55, 0x35364d],
    far: 0x2c2d44,
    land: 75,
    bumps: 0.2,
    backdrop: 'city',
    backdropColor: 0x2a2850,
    air: { color: 0xff9ad6, size: 0.07, fall: -0.2, drift: 0.5, sway: 1.2, amount: 0.45 },
    props: [
      { kind: 'neonArchPink', per100: 0.8, near: 0, far: 0, span: true },
      { kind: 'neonArchCyan', per100: 0.55, near: 0, far: 0, span: true },
      { kind: 'tower', per100: 6, near: 17, far: 30, scale: [0.7, 1.5], face: true },
      { kind: 'towerWide', per100: 5, near: 18, far: 46, scale: [0.8, 1.4], face: true },
      { kind: 'towerSlim', per100: 5, near: 22, far: 60, scale: [0.8, 1.5], face: true },
      { kind: 'tower', per100: 7, near: 36, far: 75, scale: [1, 2.3], face: true },
      { kind: 'billboardA', per100: 1.7, near: 9.5, far: 13, face: true },
      { kind: 'billboardB', per100: 1.7, near: 9.5, far: 13, face: true },
      { kind: 'lamp', per100: 4, near: 7.8, far: 7.8, face: true },
      { kind: 'treeGreen', per100: 3, near: 9, far: 13, scale: [0.7, 1] },
      { kind: 'neonSign', per100: 2.4, near: 14, far: 16, face: true, scale: [0.9, 1.3] },
      { kind: 'foodCart', per100: 1.6, near: 10.5, far: 13, face: true },
      { kind: 'cloudDark', per100: 1.2, near: 60, far: 320, lift: [70, 130], scale: [1, 2] },
    ],
  },
  {
    name: '极光雪原',
    // 一只白色的海鸟跟着
    companion: 'gull',
    token: { kind: 'snowflake', name: '雪花' },
    gate: 'ice',
    fish: { form: 'plain', body: 0xa8e4ff, fin: 0xf2fbff },
    curve: 0.7,
    hill: 4,
    sky: [0x071028, 0x12305a, 0x2f6a80],
    sun: { color: 0xeef6ff, height: 58, turn: -60, size: 0.035 },
    stars: 1,
    // 天上的极光（画在天空里，见 world.ts 的 SKY_FRAGMENT）
    aurora: 1,
    fog: [130, 600],
    light: { sun: 0xa8d4ff, sunPower: 1.5, sky: 0x86c6d6, ground: 0x4a6a8c, power: 1.7 },
    road: 0x4e6380,
    // 冻住的路，一片片冰和冰裂
    pave: 'ice',
    line: 0xe4f1ff,
    curb: [0x55b6a6, 0xdcecf6],
    shoulder: 0xa9c4d8,
    ground: [0xc9deec, 0xb9d2e4],
    far: 0xb3cde0,
    land: 75,
    bumps: 2.6,
    backdrop: 'peaks',
    backdropColor: 0x2e5674,
    air: { color: 0xffffff, size: 0.1, fall: 2.1, drift: 1.4, sway: 0.8, amount: 1 },
    props: [
      { kind: 'pineSnow', per100: 10, near: 9, far: 65, scale: [0.9, 1.9] },
      { kind: 'rockSnow', per100: 4, near: 8.6, far: 55, scale: [0.6, 2] },
      { kind: 'iceSpike', per100: 4, near: 8.6, far: 40, scale: [0.7, 1.8] },
      { kind: 'snowman', per100: 1.2, near: 8.6, far: 14, face: true },
      { kind: 'penguin', per100: 2.4, near: 8.4, far: 13, face: true },
      { kind: 'igloo', per100: 1, near: 11, far: 24, face: true },
      { kind: 'cabinSnow', per100: 0.7, near: 14, far: 30, face: true },
      { kind: 'bushSnow', per100: 4, near: 8.6, far: 36 },
      { kind: 'hillSnow', per100: 1.6, near: 95, far: 240, clear: 46, scale: [0.7, 1.5] },
      { kind: 'mountainSnow', per100: 0.6, near: 250, far: 400, clear: 86, scale: [0.8, 1.3] },
      { kind: 'grovePineSnow', per100: 2.2, near: 78, far: 200, clear: 12, scale: [0.9, 1.5] },
      { kind: 'hamletSnow', per100: 0.6, near: 60, far: 130, clear: 14 },
      { kind: 'ridgeSnow', per100: 1.2, near: 160, far: 300, clear: 84, scale: [0.8, 1.3] },
    ],
  },
  {
    name: '雪山黎明',
    // 一只鹰在前头高处盘着
    companion: 'hawk',
    token: { kind: 'icegem', name: '冰晶' },
    gate: 'prayer',
    fish: { form: 'tall', body: 0xbfd4ff, fin: 0xfdf6ea },
    curve: 0.8,
    hill: 7,
    sky: [0x4a6aa8, 0xb9a9cc, 0xfbcfc0],
    sun: { color: 0xffe2d0, height: 9, turn: 30, size: 0.065 },
    stars: 0.15,
    fog: [130, 600],
    light: { sun: 0xffc8b0, sunPower: 1.9, sky: 0xd6d6f6, ground: 0x9fb0cc, power: 1.6 },
    road: 0x6c7488,
    // 压实的雪，车道上两道车辙
    pave: 'snow',
    // 雪地上白线看不见，车道线刷成蓝灰色
    line: 0x5b6a8c,
    curb: [0xe58a8a, 0xf2eef6],
    shoulder: 0xd6dcea,
    ground: [0xeef2f8, 0xe2e8f2],
    far: 0xdde4f0,
    land: 75,
    bumps: 3.4,
    backdrop: 'peaks',
    backdropColor: 0xb7a9cc,
    air: { color: 0xfff2f6, size: 0.09, fall: 1.1, drift: 0.9, sway: 1, amount: 0.6 },
    props: [
      { kind: 'flagRed', per100: 4.6, near: 7.7, far: 7.7, side: -1, face: true },
      { kind: 'flagBlue', per100: 4.6, near: 7.7, far: 7.7, side: 1, face: true },
      { kind: 'pineSnow', per100: 8, near: 9, far: 65, scale: [0.9, 1.8] },
      { kind: 'rockSnow', per100: 6, near: 8.6, far: 60, scale: [0.7, 2.6] },
      { kind: 'iceSpike', per100: 2, near: 8.6, far: 40, scale: [0.7, 1.6] },
      { kind: 'cabinSnow', per100: 0.8, near: 14, far: 30, face: true },
      { kind: 'snowman', per100: 0.8, near: 8.6, far: 14, face: true },
      { kind: 'bushSnow', per100: 4, near: 8.6, far: 36 },
      { kind: 'hillSnow', per100: 1.6, near: 95, far: 240, clear: 46, scale: [0.7, 1.5] },
      { kind: 'mountainSnow', per100: 0.9, near: 240, far: 400, clear: 86, scale: [0.8, 1.4] },
      { kind: 'birds', per100: 0.5, near: 15, far: 120, lift: [40, 85], scale: [1, 1.5] },
      { kind: 'grovePineSnow', per100: 2.2, near: 78, far: 200, clear: 12, scale: [0.9, 1.5] },
      { kind: 'hamletSnow', per100: 0.5, near: 60, far: 130, clear: 14 },
      { kind: 'ridgeSnow', per100: 1.2, near: 160, far: 300, clear: 84, scale: [0.8, 1.3] },
      { kind: 'cloudWarm', per100: 2.2, near: 40, far: 320, lift: [50, 110], scale: [1, 2.2] },
    ],
  },
  {
    name: '气球之丘',
    // 一只蝴蝶跟着
    companion: 'butterfly',
    token: { kind: 'balloon', name: '小气球' },
    gate: 'balloons',
    fish: { form: 'round', body: 0xff6f61, fin: 0xfdf3e0 },
    curve: 0.6,
    hill: 5,
    sky: [0x7fb4ea, 0xf6c9d6, 0xffedc2],
    sun: { color: 0xfff3c8, height: 14, turn: 0, size: 0.07 },
    stars: 0,
    fog: [150, 650],
    light: { sun: 0xffe8c0, sunPower: 2.2, sky: 0xe6e6ff, ground: 0xb9d79a, power: 1.6 },
    road: 0x8a8088,
    // 圆圆的鹅卵石
    pave: 'cobble',
    line: 0xfffaf0,
    curb: [0xe56a54, 0xfdf6ea],
    shoulder: 0xdfe4a8,
    ground: [0xa9d98c, 0x99cf7e],
    far: 0x93c97a,
    land: 75,
    bumps: 2.6,
    backdrop: 'hills',
    backdropColor: 0xb9c7b0,
    air: { color: 0xfff2a8, size: 0.1, fall: 0.7, drift: 1.2, sway: 1.3, amount: 0.6 },
    props: [
      { kind: 'bunting', per100: 1.1, near: 0, far: 0, span: true },
      { kind: 'fenceWhite', per100: 8, near: 8, far: 8, face: true },
      { kind: 'balloonA', per100: 2.2, near: 26, far: 190, lift: [16, 85] },
      { kind: 'balloonB', per100: 2.2, near: 26, far: 190, lift: [16, 85] },
      { kind: 'kite', per100: 1.4, near: 10, far: 70, lift: [10, 30], scale: [0.9, 1.5] },
      { kind: 'kiteBlue', per100: 1.2, near: 10, far: 70, lift: [10, 30], scale: [0.9, 1.5] },
      { kind: 'ferrisWheel', per100: 0.45, near: 26, far: 48, face: true, clear: 10, scale: [1, 1.3] },
      { kind: 'bigTop', per100: 0.8, near: 14, far: 32, clear: 4, scale: [0.9, 1.3] },
      { kind: 'bigTopBlue', per100: 0.8, near: 14, far: 32, clear: 4, scale: [0.9, 1.3] },
      { kind: 'treeGreen', per100: 5, near: 10, far: 60, scale: [0.9, 1.6] },
      { kind: 'flowerPink', per100: 9, near: 8.6, far: 36 },
      { kind: 'flowerYellow', per100: 9, near: 8.6, far: 36 },
      { kind: 'grass', per100: 14, near: 8.6, far: 30, scale: [0.9, 1.5] },
      { kind: 'bush', per100: 5, near: 9, far: 45 },
      { kind: 'hillGreen', per100: 1.5, near: 95, far: 240, clear: 46, scale: [0.7, 1.5] },
      { kind: 'groveGreen', per100: 2.2, near: 78, far: 200, clear: 12, scale: [0.9, 1.5] },
      { kind: 'ridgeGreen', per100: 1.2, near: 160, far: 300, clear: 84, scale: [0.8, 1.3] },
      { kind: 'cloudWarm', per100: 2.6, near: 40, far: 320, lift: [50, 120], scale: [1, 2.4] },
    ],
  },
  {
    name: '高山峡谷',
    // 一只鹰在峡谷里领路
    companion: 'hawk',
    token: { kind: 'feather', name: '鹰羽' },
    gate: 'stone',
    fish: { form: 'long', body: 0x6fb4a0, fin: 0xdff4e6 },
    curve: 0.4,
    // 这一段的高低全靠下面的爬坡、断路和台阶，路本身不再随机起伏
    hill: 0,
    // 先在窄窄的峡谷里爬高八米；一道深沟（断路），底下是河，冲刺才稳稳飞得过去，落到矮三米的一截；
    // 接着一条高跳弹簧把车弹上四米高的台阶；钻过隧道，出来没多远路又断了：飞过一道水，落到底下九米开阔的湖边。
    // 八减三加四减九正好是零，出这段场景时路回到平常的高度
    climb: { from: 10, to: 150, height: 8 },
    steps: [
      { at: 210, drop: 3, gap: 10, deep: true },
      { at: 310, drop: -4 },
      { at: 470, drop: 9, gap: 8 },
    ],
    sky: [0x4d93d6, 0xa9d2ee, 0xe6f1f2],
    sun: { color: 0xfffbe6, height: 54, turn: 14, size: 0.045 },
    stars: 0,
    fog: [140, 600],
    light: { sun: 0xfff4dc, sunPower: 2.3, sky: 0xd6e8ff, ground: 0x8fa58a, power: 1.5 },
    road: 0x6f6a66,
    // 大小不一的石板路
    pave: 'flagstone',
    line: 0xfdfaf0,
    curb: [0xe0a02a, 0xfdf6ea],
    shoulder: 0xb9c79a,
    ground: [0x86b56e, 0x78a964],
    // 两边的地面只有三十来米宽，外面是湖水：上半段被崖壁挡着看不见，过了断层崖壁往外退，湖就露出来了
    far: 0x3fa0a8,
    land: 34,
    bumps: 1.2,
    walls: {
      foot: 21,
      // 用户要「高山就要高耸入云」：崖顶六十多米，往外还有一道更高的山脊，最高那截是雪
      height: 64,
      lean: 0.3,
      snow: true,
      color: [0x9a968c, 0x837f76],
      top: 0x6fa25e,
      moss: { color: [0x6fa860, 0x5c9652], amount: 0.8 },
      widen: { from: 0.525, foot: 54 },
    },
    // 断层前面的那条隧道：2026-11-14 用户要「隧道稍微长一点，洞里是溶洞的感觉」，从 60 米加长到 110 米，
    // 从高跳弹簧的台阶落地以后才开始（再早的话弹起来那一下会撞到洞口），里面挂着钟乳石、立着石笋、有一汪发光的水
    cover: [[0.375, 0.497]],
    backdrop: 'peaks',
    backdropColor: 0x9fb4c8,
    props: [
      { kind: 'fenceWood', per100: 8, near: 8, far: 8, face: true },
      { kind: 'pine', per100: 9, near: 9.5, far: 17, scale: [0.8, 1.3], under: 'sky' },
      { kind: 'treeGreen', per100: 4, near: 10, far: 17, scale: [0.8, 1.2], under: 'sky' },
      { kind: 'rock', per100: 7, near: 8.6, far: 18, scale: [0.5, 1.6] },
      { kind: 'bush', per100: 6, near: 9, far: 18, under: 'sky' },
      { kind: 'grass', per100: 16, near: 8.6, far: 18, scale: [0.9, 1.5] },
      { kind: 'flowerBlue', per100: 8, near: 8.6, far: 17, under: 'sky' },
      { kind: 'flowerYellow', per100: 6, near: 8.6, far: 17, under: 'sky' },
      { kind: 'mushroom', per100: 2, near: 9, far: 16, under: 'sky' },
      { kind: 'logs', per100: 0.9, near: 10, far: 16, under: 'sky' },
      { kind: 'tent', per100: 0.5, near: 11, far: 16, under: 'sky' },
      { kind: 'deer', per100: 1.2, near: 10, far: 17, under: 'sky' },
      { kind: 'ropeBridge', per100: 0.9, near: 0, far: 0, span: true, under: 'sky', part: [0.04, 0.19] },
      // 隧道里的溶洞
      { kind: 'dripstone', per100: 8, near: 0, far: 0, span: true, under: 'roof' },
      { kind: 'flowstone', per100: 12, near: 8.8, far: 16, scale: [0.5, 1.3], under: 'roof' },
      { kind: 'crystalPool', per100: 2, near: 11, far: 14, scale: [0.7, 1], under: 'roof' },
      { kind: 'caveLamp', per100: 4, near: 8.2, far: 8.2, face: true, under: 'roof' },
      { kind: 'shroomGlow', per100: 5, near: 8.6, far: 14, scale: [0.6, 1.1], under: 'roof' },
      { kind: 'eagles', per100: 1.4, near: 0, far: 6, lift: [36, 54], scale: [1, 1.5] },
      // 半山腰缠着一圈云
      { kind: 'cloud', per100: 3, near: 24, far: 70, lift: [40, 58], scale: [1.2, 2.4] },
      // 上半段崖顶上的一排松树
      { kind: 'pine', per100: 16, near: 50, far: 66, scale: [1, 1.7], part: [0, 0.52] },
      // 下半段的湖：荷叶、荷花、芦苇、跳出水面的鱼、白鹭、小船，对岸崖壁上挂着瀑布
      { kind: 'reeds', per100: 14, near: 34.6, far: 39, float: true, scale: [0.9, 1.5] },
      { kind: 'lotus', per100: 12, near: 36, far: 63, float: true, scale: [0.9, 1.8] },
      { kind: 'lotusBloom', per100: 9, near: 35.5, far: 60, float: true, scale: [0.9, 1.5] },
      { kind: 'jumpFish', per100: 6, near: 37, far: 60, float: true, scale: [1.2, 2] },
      { kind: 'heron', per100: 1.8, near: 34.6, far: 38, float: true, scale: [1, 1.3] },
      { kind: 'rowboat', per100: 1, near: 40, far: 58, float: true },
      { kind: 'foam', per100: 5, near: 38, far: 63, face: true, float: true, scale: [0.7, 1.3] },
      { kind: 'waterfall', per100: 1, near: 66, far: 66, wall: true, face: true, part: [0.58, 1] },
      { kind: 'gulls', per100: 1.2, near: 20, far: 50, lift: [26, 48], scale: [1, 1.5], part: [0.55, 1] },
      { kind: 'pine', per100: 12, near: 82, far: 100, scale: [1, 1.8], part: [0.58, 1] },
      { kind: 'grovePine', per100: 2, near: 100, far: 150, clear: 12, scale: [0.9, 1.4] },
      { kind: 'mountainSnow', per100: 0.6, near: 240, far: 400, clear: 86, scale: [0.8, 1.3] },
      { kind: 'cloud', per100: 2, near: 40, far: 320, lift: [75, 130], scale: [1, 2.4] },
    ],
  },
  {
    name: '溪谷飞瀑',
    // 一只蜻蜓贴着水面跟着
    companion: 'dragonfly',
    token: { kind: 'lotus', name: '莲花' },
    gate: 'bamboo',
    fish: { form: 'tall', body: 0xfdfaf2, fin: 0xe5604a },
    curve: 0.45,
    hill: 2.2,
    sky: [0x5aa6dc, 0xb4e0ee, 0xeaf7ee],
    sun: { color: 0xfffbe4, height: 42, turn: -24, size: 0.045 },
    stars: 0,
    fog: [130, 560],
    light: { sun: 0xfff6dc, sunPower: 2.2, sky: 0xd8f0ff, ground: 0x7fb58a, power: 1.5 },
    road: 0x7a7468,
    // 碎石子路
    pave: 'gravel',
    line: 0xfdfaf0,
    curb: [0x4fb3a4, 0xfdf6ea],
    shoulder: 0xc9d6a0,
    ground: [0x8fc47a, 0x7fb86c],
    // 路是河中间的一道堤，两边是河水，再往外是挂着瀑布的崖壁
    far: 0x3fa7a8,
    land: 19,
    bumps: 0.3,
    // 丘陵的峡谷（用户要的「有高山的峡谷，也有丘陵的峡谷」）：两边是缓一点的绿山包，一座连一座
    walls: { foot: 50, height: 30, lean: 0.45, color: [0x9c9a8c, 0x86857a], top: 0x5f9a58, moss: { color: [0x6aa862, 0x579a56], amount: 0.95 } },
    backdrop: 'peaks',
    backdropColor: 0x9fc0b8,
    air: { color: 0xf2fbff, size: 0.09, fall: -0.3, drift: 0.8, sway: 1, amount: 0.5 },
    props: [
      { kind: 'fenceWood', per100: 8, near: 8, far: 8, face: true },
      { kind: 'grass', per100: 16, near: 8.6, far: 14, scale: [0.9, 1.5] },
      { kind: 'flowerYellow', per100: 9, near: 8.6, far: 13 },
      { kind: 'flowerPink', per100: 6, near: 8.6, far: 13 },
      { kind: 'bush', per100: 5, near: 9, far: 13 },
      { kind: 'treeGreen', per100: 2.5, near: 10, far: 13, scale: [0.8, 1.1] },
      { kind: 'fallArch', per100: 0.45, near: 0, far: 0, span: true },
      { kind: 'waterfall', per100: 1.1, near: 50, far: 50, wall: true, face: true },
      { kind: 'reeds', per100: 14, near: 19.6, far: 24, float: true, scale: [0.9, 1.5] },
      { kind: 'lotus', per100: 11, near: 21, far: 47, float: true, scale: [0.8, 1.7] },
      { kind: 'lotusBloom', per100: 8, near: 21, far: 44, float: true, scale: [0.9, 1.5] },
      { kind: 'jumpFish', per100: 7, near: 23, far: 46, float: true, scale: [1.2, 2] },
      { kind: 'heron', per100: 1.6, near: 19.6, far: 23, float: true, scale: [1, 1.3] },
      { kind: 'rowboat', per100: 0.9, near: 26, far: 42, float: true },
      { kind: 'foam', per100: 6, near: 21, far: 46, face: true, float: true, scale: [0.7, 1.3] },
      { kind: 'seaStack', per100: 1.6, near: 27, far: 43, float: true, clear: 3, scale: [0.35, 0.6] },
      { kind: 'gulls', per100: 1.4, near: 0, far: 24, lift: [26, 46], scale: [1, 1.5] },
      { kind: 'pine', per100: 11, near: 68, far: 84, scale: [1, 1.8] },
      { kind: 'grovePine', per100: 2, near: 80, far: 130, clear: 12, scale: [0.9, 1.4] },
      { kind: 'mountain', per100: 0.6, near: 250, far: 400, clear: 86, scale: [0.8, 1.3] },
      { kind: 'cloud', per100: 2.2, near: 40, far: 320, lift: [80, 130], scale: [1, 2.4] },
    ],
  },
  {
    name: '水晶洞穴',
    // 一团会发光的引路光团跟在身后，照亮岩壁
    companion: 'wisp',
    token: { kind: 'crystal', name: '紫水晶' },
    gate: 'crystal',
    fish: { form: 'round', body: 0xb48cff, fin: 0xe6d8ff, glow: true },
    curve: 0.4,
    hill: 2.5,
    sky: [0x0a0c1a, 0x151a33, 0x1d2444],
    sun: { color: 0xcfe0ff, height: 52, turn: 20, size: 0.035 },
    stars: 0.9,
    fog: [40, 300],
    light: { sun: 0x9fb4ff, sunPower: 0.8, sky: 0x9aa8f0, ground: 0x4a4070, power: 2.6 },
    road: 0x3a3c4e,
    // 深色石面上发紫光的裂纹和碎晶
    pave: 'crystal',
    line: 0xcfd8ff,
    curb: [0x8f6fe0, 0x2c2a44],
    shoulder: 0x3d3a56,
    ground: [0x45415f, 0x3a3752],
    far: 0x1a1c30,
    land: 60,
    bumps: 1,
    // 高山底下的洞（2026-11-14 用户说「洞穴场景就设定为高山下的洞穴」）：崖壁从 16 米抬到 46 米、山顶积雪，从天窗和洞口看得到上面的雪山
    walls: { foot: 16, height: 46, lean: 0.3, color: [0x64647a, 0x525266], top: 0x4a4a5c, snow: true },
    // 整段都在洞里，中间开两处天窗，能看见外面的星星
    cover: [
      [0.035, 0.3],
      [0.34, 0.63],
      [0.67, 0.965],
    ],
    backdrop: 'none',
    backdropColor: 0x1d2444,
    air: { color: 0xbfe6ff, size: 0.06, fall: -0.25, drift: 0.3, sway: 1.2, amount: 0.7 },
    props: [
      { kind: 'caveLamp', per100: 3.2, near: 8.2, far: 8.2, face: true },
      { kind: 'crystal', per100: 9, near: 8.6, far: 14, scale: [0.6, 1.7] },
      { kind: 'crystalBlue', per100: 8, near: 8.6, far: 14, scale: [0.6, 1.7] },
      { kind: 'shroomGlow', per100: 11, near: 8.4, far: 13, scale: [0.7, 1.5] },
      { kind: 'stalagmite', per100: 9, near: 9, far: 14.5, scale: [0.6, 1.5] },
      { kind: 'rock', per100: 5, near: 8.6, far: 14, scale: [0.5, 1.2] },
      { kind: 'stalactites', per100: 6, near: 0, far: 0, span: true, under: 'roof' },
      { kind: 'bats', per100: 2, near: 0, far: 3, lift: [4.5, 6.5], under: 'roof' },
      { kind: 'crystalPool', per100: 1.2, near: 10.5, far: 12.5, scale: [0.8, 1.1] },
      { kind: 'mineCart', per100: 0.7, near: 10, far: 12, face: true },
    ],
  },
  {
    name: '云海断桥',
    // 一只鹰在云海上空领路
    companion: 'hawk',
    token: { kind: 'cloud', name: '云朵' },
    gate: 'pailou',
    fish: { form: 'long', body: 0x7fc8f0, fin: 0xeaf6ff },
    curve: 0.35,
    // 高低全靠下面的台阶和断口，路本身不再随机起伏
    hill: 0,
    // 用户要的「断桥」（2026-11-13 第二版，2026-11-14 第三版）：路是一座座架在峡谷里的石桥，底下立着桥柱，不要斜坡。
    // 第三版用户要「一个个大断桥，之间高度差挺大，下面雾茫茫的，慢慢到达底部是一个湖，路在湖上面穿行」：
    // 三条高跳弹簧一层十二米，把车弹上三十六米高的桥，桥底下是一片云海；顺着桥骑一百来米，
    // 然后四座断桥一座比一座低九米，一路穿过雾层跳下去，最后落到谷底的湖上，路贴着湖面穿过去，湖上再连着三条高跳弹簧连续穿圈。
    // 十二乘三上去、九乘四下来，出这段场景时路回到平常的高度。雾有四层（world.ts 的 MIST_LAYERS），人在高处时最浓，下到湖面就散开
    bridge: true,
    mist: 1,
    steps: [
      { at: 80, drop: -12 },
      { at: 170, drop: -12 },
      { at: 260, drop: -12 },
      { at: 380, drop: 9, gap: 14, deep: true },
      { at: 470, drop: 9, gap: 14, deep: true },
      { at: 560, drop: 9, gap: 14, deep: true },
      { at: 650, drop: 9, gap: 12, deep: true },
      { at: 716, drop: 0, bounce: 5 },
      { at: 780, drop: 0, bounce: 5 },
      { at: 844, drop: 0, bounce: 5 },
    ],
    // 用户截图嫌过「过曝」：地平线和雾原来几乎是纯白，再叠上白雾和泛光，下半个画面白成一片。地平线压成浅灰蓝，光也收一点
    sky: [0x5f9fd8, 0xb6d6ec, 0xdde8ee],
    sun: { color: 0xfff8e6, height: 40, turn: -18, size: 0.045 },
    stars: 0,
    fog: [110, 560],
    light: { sun: 0xfff2dc, sunPower: 1.8, sky: 0xdceaf8, ground: 0x98a8b8, power: 1.4 },
    road: 0x6e6a66,
    // 石桥的大石板，桥边缝里长着青苔
    pave: 'slab',
    line: 0xfdfaf0,
    curb: [0xc9a46a, 0xfdf6ea],
    shoulder: 0xa9a29a,
    // 门口那一小段还是普通的路：两边窄窄一条，再往外就是水
    ground: [0x9c958c, 0x8a847c],
    far: 0x5fb4b8,
    land: 12,
    bumps: 0,
    walls: { foot: 64, height: 70, lean: 0.3, color: [0x9a968c, 0x837f76], top: 0x6fa25e, moss: { color: [0x6fa860, 0x5c9652], amount: 0.7 }, snow: true },
    backdrop: 'peaks',
    backdropColor: 0xb4c8d8,
    // 空气里飘着一缕缕白雾
    air: { color: 0xffffff, size: 0.14, fall: -0.15, drift: 1.6, sway: 0.6, amount: 0.55 },
    props: [
      // 桥上：两边一排白栏杆、石灯笼（桥面边在 7.5 米）
      { kind: 'fenceWhite', per100: 8, near: 7.2, far: 7.2, face: true },
      { kind: 'stoneLantern', per100: 3, near: 7.1, far: 7.1, face: true },
      // 半山腰缠着一圈云
      { kind: 'cloud', per100: 2.5, near: 30, far: 70, lift: [42, 60], scale: [1.2, 2.4] },
      { kind: 'cloud', per100: 2, near: 40, far: 320, lift: [70, 130], scale: [1, 2.4] },
      { kind: 'gulls', per100: 1.4, near: 10, far: 60, lift: [30, 50], scale: [1, 1.5] },
      // 峡谷底的湖（最后一座断桥落下来以后，七成多往后）：荷叶、荷花、芦苇、跃出水面的鱼、白鹭、小船
      { kind: 'reeds', per100: 14, near: 12.6, far: 17, float: true, scale: [0.9, 1.5], part: [0.73, 1] },
      { kind: 'lotus', per100: 12, near: 14, far: 50, float: true, scale: [0.9, 1.8], part: [0.73, 1] },
      { kind: 'lotusBloom', per100: 9, near: 13.5, far: 46, float: true, scale: [0.9, 1.5], part: [0.73, 1] },
      { kind: 'jumpFish', per100: 6, near: 16, far: 50, float: true, scale: [1.2, 2], part: [0.73, 1] },
      { kind: 'heron', per100: 1.6, near: 12.6, far: 16, float: true, scale: [1, 1.3], part: [0.73, 1] },
      { kind: 'rowboat', per100: 1, near: 20, far: 48, float: true, part: [0.73, 1] },
      // 两边的崖壁上挂着瀑布，崖顶一排松树，远处雪山
      { kind: 'waterfall', per100: 1, near: 92, far: 92, wall: true, face: true },
      { kind: 'pine', per100: 10, near: 92, far: 112, scale: [1, 1.8] },
      { kind: 'mountainSnow', per100: 0.6, near: 260, far: 400, clear: 86, scale: [0.8, 1.3] },
    ],
  },
];
