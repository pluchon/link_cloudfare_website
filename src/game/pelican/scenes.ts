// 十二个场景：每个场景只是一套配色加一张景物清单，路是同一条。
// 加新场景只往 SCENES 里添一项；顺序就是骑行时经过的顺序，从清晨一路骑到第二天日出

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
  | 'aurora'
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
  | 'seaStack';

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

export interface Scene extends TrackStyle {
  name: string;
  // 天空三段颜色：天顶、中段、地平线
  sky: [number, number, number];
  // 太阳或月亮：颜色、离地平线多高（度）、偏离出发方向多少（度，正数偏右）、大小
  sun: { color: number; height: number; turn: number; size: number };
  // 星星有多亮，0 到 1
  stars: number;
  // 雾从多远开始、到多远全白（米），颜色就是地平线的颜色
  fog: [number, number];
  light: { sun: number; sunPower: number; sky: number; ground: number; power: number };
  road: number;
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
  backdrop: Backdrop;
  backdropColor: number;
  air?: Air;
  props: PropRule[];
}

// 每个场景骑多长（米）
export const SCENE_LENGTH = 380;

export const SCENES: readonly Scene[] = [
  {
    name: '海滨晨光',
    curve: 0.5,
    hill: 0.6,
    sky: [0x6fb7e6, 0xbfe4f2, 0xfdf3de],
    sun: { color: 0xfff6d8, height: 24, turn: -38, size: 0.05 },
    stars: 0,
    fog: [140, 620],
    light: { sun: 0xfff2d6, sunPower: 2.2, sky: 0xd9f0ff, ground: 0xe8d3a8, power: 1.5 },
    road: 0x5d5f6b,
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
      { kind: 'gulls', per100: 1.6, near: 12, far: 110, lift: [12, 38], scale: [1, 1.7] },
      { kind: 'seaStack', per100: 1.3, near: 46, far: 150, float: true, clear: 8, scale: [0.8, 1.5] },
      { kind: 'cloud', per100: 2.4, near: 40, far: 320, lift: [45, 110], scale: [1, 2.4] },
    ],
  },
  {
    name: '花田风车',
    curve: 0.7,
    hill: 4.5,
    sky: [0x62aee6, 0xa9daf2, 0xeaf6e4],
    sun: { color: 0xfffbe4, height: 46, turn: 28, size: 0.045 },
    stars: 0,
    fog: [150, 640],
    light: { sun: 0xfff7e0, sunPower: 2.3, sky: 0xd4ecff, ground: 0xa8cf86, power: 1.5 },
    road: 0x62646f,
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
      { kind: 'birds', per100: 0.8, near: 15, far: 120, lift: [18, 48], scale: [1, 1.6] },
      { kind: 'groveGreen', per100: 2.2, near: 78, far: 200, clear: 12, scale: [0.9, 1.5] },
      { kind: 'hamlet', per100: 0.7, near: 60, far: 130, clear: 14 },
      { kind: 'ridgeGreen', per100: 1.2, near: 160, far: 300, clear: 84, scale: [0.8, 1.3] },
      { kind: 'cloud', per100: 2.4, near: 40, far: 320, lift: [50, 120], scale: [1, 2.4] },
      { kind: 'balloonB', per100: 0.5, near: 50, far: 180, lift: [30, 70] },
    ],
  },
  {
    name: '樱花大道',
    curve: 0.45,
    hill: 2,
    sky: [0x8fb8ec, 0xd7dcf6, 0xfde6ee],
    sun: { color: 0xfff4ee, height: 40, turn: -20, size: 0.045 },
    stars: 0,
    fog: [110, 520],
    light: { sun: 0xfff0ea, sunPower: 2.1, sky: 0xf1e2ff, ground: 0xd9c2c8, power: 1.6 },
    road: 0x6a6672,
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
      { kind: 'hillPink', per100: 1.5, near: 95, far: 240, clear: 46, scale: [0.7, 1.5] },
      { kind: 'birds', per100: 0.6, near: 15, far: 120, lift: [20, 48], scale: [1, 1.5] },
      { kind: 'groveCherry', per100: 2.2, near: 78, far: 200, clear: 12, scale: [0.9, 1.5] },
      { kind: 'ridgePink', per100: 1.2, near: 160, far: 300, clear: 84, scale: [0.8, 1.3] },
      { kind: 'cloudWarm', per100: 1.8, near: 40, far: 320, lift: [50, 120], scale: [1, 2.2] },
    ],
  },
  {
    name: '松林小屋',
    curve: 0.85,
    hill: 6,
    sky: [0x5f9bc2, 0xa9cdd4, 0xdfeee0],
    sun: { color: 0xf6fbe8, height: 52, turn: 60, size: 0.04 },
    stars: 0,
    fog: [70, 380],
    light: { sun: 0xf0f7dc, sunPower: 1.9, sky: 0xcfe8e2, ground: 0x6f9a72, power: 1.5 },
    road: 0x555b62,
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
      { kind: 'birds', per100: 0.6, near: 15, far: 120, lift: [24, 52], scale: [1, 1.5] },
      { kind: 'grovePine', per100: 3, near: 78, far: 200, clear: 13, scale: [1, 1.7] },
      { kind: 'ridgePine', per100: 1.2, near: 160, far: 300, clear: 84, scale: [0.8, 1.3] },
      { kind: 'cloud', per100: 1.6, near: 40, far: 320, lift: [60, 120], scale: [1.2, 2.4] },
    ],
  },
  {
    name: '秋日山谷',
    curve: 0.8,
    hill: 7,
    sky: [0x6c9fd2, 0xc9d8de, 0xfbe7c4],
    sun: { color: 0xffedc2, height: 30, turn: 42, size: 0.05 },
    stars: 0,
    fog: [120, 560],
    light: { sun: 0xffe6b8, sunPower: 2.2, sky: 0xdde9f2, ground: 0xc9a468, power: 1.5 },
    road: 0x5f5b60,
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
      { kind: 'birds', per100: 0.9, near: 15, far: 120, lift: [20, 50], scale: [1, 1.6] },
      { kind: 'groveAutumn', per100: 2.2, near: 78, far: 200, clear: 12, scale: [0.9, 1.5] },
      { kind: 'hamlet', per100: 0.6, near: 60, far: 130, clear: 14 },
      { kind: 'ridgeAutumn', per100: 1.2, near: 160, far: 300, clear: 84, scale: [0.8, 1.3] },
      { kind: 'cloudWarm', per100: 2, near: 40, far: 320, lift: [55, 120], scale: [1, 2.4] },
    ],
  },
  {
    name: '沙漠峡谷',
    curve: 0.6,
    hill: 3.5,
    sky: [0x4f9fd8, 0xbcd8e4, 0xfbe2b6],
    sun: { color: 0xfff0c8, height: 26, turn: -30, size: 0.055 },
    stars: 0,
    fog: [150, 650],
    light: { sun: 0xffe7b4, sunPower: 2.4, sky: 0xe3eef6, ground: 0xe0a868, power: 1.5 },
    road: 0x6b6058,
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
      { kind: 'dune', per100: 1.5, near: 95, far: 240, clear: 46, scale: [0.7, 1.5] },
      { kind: 'mountainWarm', per100: 0.6, near: 250, far: 400, clear: 86, scale: [0.8, 1.3] },
      { kind: 'birds', per100: 0.5, near: 15, far: 120, lift: [24, 55], scale: [1, 1.5] },
      { kind: 'ridgeSand', per100: 1.5, near: 150, far: 300, clear: 84, scale: [0.8, 1.4] },
      { kind: 'cloudWarm', per100: 1.2, near: 60, far: 320, lift: [60, 120], scale: [1, 2] },
    ],
  },
  {
    name: '棕榈晚霞',
    curve: 0.55,
    hill: 1.2,
    sky: [0xd9683f, 0xf0925a, 0xfbc98a],
    sun: { color: 0xffe2a8, height: 7, turn: 8, size: 0.085 },
    stars: 0,
    fog: [130, 600],
    light: { sun: 0xffb877, sunPower: 2.1, sky: 0xffd2a6, ground: 0xb98a6a, power: 1.5 },
    road: 0x5a4d50,
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
      { kind: 'birds', per100: 1.5, near: 12, far: 120, lift: [14, 46], scale: [1, 1.7] },
      { kind: 'balloonA', per100: 0.8, near: 40, far: 170, lift: [28, 75] },
      { kind: 'balloonB', per100: 0.5, near: 40, far: 170, lift: [28, 75] },
      { kind: 'seaStack', per100: 1.1, near: 52, far: 160, float: true, clear: 8, scale: [0.8, 1.5] },
      { kind: 'cloudWarm', per100: 3, near: 40, far: 320, lift: [45, 110], scale: [0.9, 2] },
    ],
  },
  {
    name: '灯塔夜海',
    curve: 0.5,
    hill: 1,
    sky: [0x131a3c, 0x2b3a6c, 0x7a6a94],
    sun: { color: 0xf3f0dc, height: 34, turn: -46, size: 0.04 },
    stars: 0.75,
    fog: [110, 520],
    light: { sun: 0x9fb4ff, sunPower: 1.5, sky: 0x6f82c4, ground: 0x3a3a5c, power: 1.6 },
    road: 0x3a3d52,
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
      { kind: 'sailboatLit', per100: 1.5, near: 60, far: 190, float: true, scale: [1.4, 2.4] },
      { kind: 'seaStack', per100: 1.5, near: 44, far: 150, float: true, clear: 8, scale: [0.8, 1.6] },
      { kind: 'cloudDark', per100: 1.6, near: 40, far: 320, lift: [50, 110], scale: [1, 2.2] },
    ],
  },
  {
    name: '霓虹都市',
    curve: 0.35,
    hill: 0.8,
    sky: [0x0c0f26, 0x1d1c46, 0x4a2f6a],
    sun: { color: 0xe8e6ff, height: 50, turn: 55, size: 0.03 },
    stars: 0.45,
    fog: [100, 480],
    light: { sun: 0xa9a2ff, sunPower: 1.3, sky: 0x7a6fd0, ground: 0x3a2f5c, power: 1.7 },
    road: 0x2c2d40,
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
      { kind: 'cloudDark', per100: 1.2, near: 60, far: 320, lift: [70, 130], scale: [1, 2] },
    ],
  },
  {
    name: '极光雪原',
    curve: 0.7,
    hill: 4,
    sky: [0x071028, 0x12305a, 0x2f6a80],
    sun: { color: 0xeef6ff, height: 58, turn: -60, size: 0.035 },
    stars: 1,
    fog: [130, 600],
    light: { sun: 0xa8d4ff, sunPower: 1.5, sky: 0x86c6d6, ground: 0x4a6a8c, power: 1.7 },
    road: 0x39445c,
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
      { kind: 'aurora', per100: 1.1, near: 120, far: 300, lift: [70, 120], scale: [1, 1.8] },
    ],
  },
  {
    name: '雪山黎明',
    curve: 0.8,
    hill: 7,
    sky: [0x4a6aa8, 0xb9a9cc, 0xfbcfc0],
    sun: { color: 0xffe2d0, height: 9, turn: 30, size: 0.065 },
    stars: 0.15,
    fog: [130, 600],
    light: { sun: 0xffc8b0, sunPower: 1.9, sky: 0xd6d6f6, ground: 0x9fb0cc, power: 1.6 },
    road: 0x4b5066,
    line: 0xf6f2fa,
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
      { kind: 'birds', per100: 0.5, near: 15, far: 120, lift: [24, 55], scale: [1, 1.5] },
      { kind: 'grovePineSnow', per100: 2.2, near: 78, far: 200, clear: 12, scale: [0.9, 1.5] },
      { kind: 'hamletSnow', per100: 0.5, near: 60, far: 130, clear: 14 },
      { kind: 'ridgeSnow', per100: 1.2, near: 160, far: 300, clear: 84, scale: [0.8, 1.3] },
      { kind: 'cloudWarm', per100: 2.2, near: 40, far: 320, lift: [50, 110], scale: [1, 2.2] },
    ],
  },
  {
    name: '气球之丘',
    curve: 0.6,
    hill: 5,
    sky: [0x7fb4ea, 0xf6c9d6, 0xffedc2],
    sun: { color: 0xfff3c8, height: 14, turn: 0, size: 0.07 },
    stars: 0,
    fog: [150, 650],
    light: { sun: 0xffe8c0, sunPower: 2.2, sky: 0xe6e6ff, ground: 0xb9d79a, power: 1.6 },
    road: 0x66646f,
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
];
