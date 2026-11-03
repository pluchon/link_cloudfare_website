// 站点全局文案与导航配置：页面里不要写死字符串
export const site = {
  name: '儒雅的诺诺的学习基地',
  // 窄屏顶栏放不下全名，用这个短名代替
  shortName: '诺诺',
  tagline: 'AI Coding 与日常学习的分享',
  title: '儒雅的诺诺的学习基地 | AI Coding 与日常学习的分享',
  description: '记录 AI Coding 实践、后端工程与日常学习的笔记与资料。',
  url: 'https://www.nuonuoya.cn',
  lang: 'zh-CN',
  since: 2026,
  // 门户页（/door/）标题下面那一行
  doorLine: '在辽阔之外，安放日常',
  // 首页思维导图的背景插画（OSS 完整 URL）。白天是小萌的房间，夜里是小萌坐在空间站甲板上看黑洞。
  // 人物都在左下角，导图在宽屏会往右让开。留空就用 CSS 画的同构图占位；
  // 竖屏（手机）可以单独给一张，不给就用横屏那张居中裁切
  homeBackdrop: {
    light: 'https://zlhimage.oss-cn-guangzhou.aliyuncs.com/personal_website_picture/profile_website/home-day.webp?v=20261029',
    dark: 'https://zlhimage.oss-cn-guangzhou.aliyuncs.com/personal_website_picture/profile_website/home-night.webp?v=20261029',
    lightPortrait: 'https://zlhimage.oss-cn-guangzhou.aliyuncs.com/personal_website_picture/profile_website/home-day-portrait.webp?v=20261029',
    darkPortrait: 'https://zlhimage.oss-cn-guangzhou.aliyuncs.com/personal_website_picture/profile_website/home-night-portrait.webp?v=20261029',
  },
  // 门户页标题区的装饰文字：眉题、英文副行、坐标行（人马座 A* 的天球坐标，银河系中心那个黑洞）
  door: {
    eyebrow: 'OBSERVATION DECK',
    eyebrowCn: '观测甲板 · 01',
    en: 'A QUIET BASE BEYOND THE EVENT HORIZON',
    coord: 'RA 17h 45m 40s · DEC −29° 00′ 28″ · 人马座方向',
  },
  footerNote: '今天也辛苦啦，要不要在这里休息一会儿？小萌会陪着你的♪٩(´ω`)و♪',
  gameLine: '快和诺诺一起玩游戏吧~ ヾ(≧▽≦*)o',
  notFoundPoster: {
    light: 'https://zlhimage.oss-cn-guangzhou.aliyuncs.com/personal_website_picture/profile_website/404/20261103/404-landscape.webp?v=7b4f2b54fbf8',
    dark: 'https://zlhimage.oss-cn-guangzhou.aliyuncs.com/personal_website_picture/profile_website/404/20261103/night/404-landscape.webp?v=a33d14e2fa4e',
    lightPortrait: 'https://zlhimage.oss-cn-guangzhou.aliyuncs.com/personal_website_picture/profile_website/404/20261103/404-portrait.webp?v=e29b719d072c',
    darkPortrait: 'https://zlhimage.oss-cn-guangzhou.aliyuncs.com/personal_website_picture/profile_website/404/20261103/night/404-portrait.webp?v=bd465813f231',
  },
} as const;

// 顶栏导航。icon 对应 KindIcon.astro 里的图标名；sep 表示在这一项左边画一道竖线，
// 把前面五个内容分类和后面的标签、关于分开
export const nav = [
  { label: '项目', href: '/project/', icon: 'project', sep: false },
  { label: '工具', href: '/tool/', icon: 'tool', sep: false },
  { label: '探究', href: '/explore/', icon: 'explore', sep: false },
  { label: '日常', href: '/daily/', icon: 'daily', sep: false },
  { label: '小萌', href: '/xiaomeng/', icon: 'xiaomeng', sep: false },
  { label: '标签', href: '/tags/', icon: 'tags', sep: true },
  { label: '关于', href: '/about/', icon: 'about', sep: false },
] as const;

// 首页思维导图的根节点，也是关于页的名片
// avatar 留空则渲染成占位线框；要换成照片就填 OSS 完整 URL
export const profile = {
  avatar: 'https://zlhimage.oss-cn-guangzhou.aliyuncs.com/personal_website_picture/profile_website/profile.webp?v=20261027',
  name: '诺诺',
  bio: '在写代码，也在记笔记。把踩过的坑和读过的东西留在这里',
  // 第三方链接：href 换成自己的即可。图标源文件 viewBox 各不相同
  // （24 / 512 / 32 / 128），所以渲染时统一用固定盒子 + object-fit 保证一样大。
  // mono 标记纯单色深色图标：它们在深色模式下会隐形，渲染时整体反色
  links: [
    { label: 'GitHub', href: 'https://github.com/pluchon', icon: '/icons/github.svg', mono: true },
    { label: 'X', href: 'https://x.com/pluchon200010', icon: '/icons/x.svg', mono: false },
    { label: 'Gmail', href: 'mailto:zlh8232@gmail.com', icon: '/icons/gmail.svg', mono: false },
    { label: 'Outlook', href: 'mailto:zlh8232@outlook.com', icon: '/icons/outlook.svg', mono: false },
  ],
} as const;

// 思维导图的一级分支，也是站点的内容分类。加板块往这里追加即可
// cover 填 OSS 完整 URL，留空则渲染成占位线框
export const branches = [
  {
    key: 'project',
    label: '项目',
    href: '/project/',
    desc: '做过的项目与笔记',
    cover: 'https://zlhimage.oss-cn-guangzhou.aliyuncs.com/personal_website_picture/profile_website/project.webp?v=20261027',
  },
  {
    key: 'tool',
    label: '工具',
    href: '/tool/',
    desc: '对使用的工具进行整理，包含教程清单',
    cover: 'https://zlhimage.oss-cn-guangzhou.aliyuncs.com/personal_website_picture/profile_website/tool.webp?v=20261027',
  },
  {
    key: 'explore',
    label: '探究',
    href: '/explore/',
    desc: '自己奇思妙想或时代的自我研究成果展示',
    cover: 'https://zlhimage.oss-cn-guangzhou.aliyuncs.com/personal_website_picture/profile_website/explore.webp?v=20261027',
  },
  {
    key: 'daily',
    label: '日常',
    href: '/daily/',
    desc: '生活里的碎片记录',
    cover: 'https://zlhimage.oss-cn-guangzhou.aliyuncs.com/personal_website_picture/profile_website/daily.webp?v=20261027',
  },
  {
    key: 'xiaomeng',
    label: '小萌',
    href: '/xiaomeng/',
    desc: '小萌的一些资料与设计构想',
    cover: 'https://zlhimage.oss-cn-guangzhou.aliyuncs.com/personal_website_picture/profile_website/xiaomeng.webp?v=20261027',
  },
] as const;

// 主题色。默认是墨色，另外三套只改强调色和底色的冷暖，线条骨架不动。
// key 对应 <html data-palette>，具体色值在 global.css 里；
// dot 是菜单里那个小圆点的颜色，用浅色模式下的强调色
export const palettes = [
  { key: 'ink', label: '默认', dot: '#c6462f' },
  { key: 'moss', label: '淡雅绿', dot: '#2f6b46' },
  { key: 'wood', label: '木叶棕', dot: '#96551f' },
  { key: 'mist', label: '远山黛', dot: '#2f4d78' },
] as const;

export type PaletteKey = (typeof palettes)[number]['key'];

// 五个分类列表页和关于页的背景插画：白天 / 夜里各一套，横屏 / 竖屏各一张，都在同一个 OSS 目录下按名字取。
// 换图时上传到新日期的目录，改 PAGE_BACKDROP_DIR 即可（新目录名顺带绕开 CDN 缓存）
const PAGE_BACKDROP_DIR =
  'https://zlhimage.oss-cn-guangzhou.aliyuncs.com/personal_website_picture/category_backgrounds/20261030';

export interface PageBackdrop {
  light: string;
  dark: string;
  lightPortrait: string;
  darkPortrait: string;
}

function pageBackdrop(name: string, directory = PAGE_BACKDROP_DIR): PageBackdrop {
  return {
    light: `${directory}/${name}-landscape.webp`,
    dark: `${directory}/night/${name}-landscape.webp`,
    lightPortrait: `${directory}/${name}-portrait.webp`,
    darkPortrait: `${directory}/night/${name}-portrait.webp`,
  };
}

export const pageBackdrops = {
  project: pageBackdrop('project'),
  tool: pageBackdrop('tool'),
  explore: pageBackdrop('explore'),
  daily: pageBackdrop('daily'),
  xiaomeng: pageBackdrop('xiaomeng'),
  about: pageBackdrop('about'),
  tags: pageBackdrop('tags'),
  tagDetail: pageBackdrop('tag-detail'),
  notice: pageBackdrop('notice', 'https://zlhimage.oss-cn-guangzhou.aliyuncs.com/personal_website_picture/category_backgrounds/20261102'),
  game: pageBackdrop('game', 'https://zlhimage.oss-cn-guangzhou.aliyuncs.com/personal_website_picture/category_backgrounds/20261103'),
} as const;

// 游戏大厅条目：每一项都是一个独立的小游戏。cover 填 OSS 完整 URL，留空则显示发丝线点阵占位框；href 填好后即可点击进入该游戏
export interface GameEntry {
  id: string;
  title: string;
  summary: string;
  tag: string;
  cover: string;
  href: string;
}

export const games: readonly GameEntry[] = [
  {
    id: '01',
    title: '新游戏 · 筹备中',
    summary: '第一个独立小游戏正在装机调试，敬请期待。',
    tag: '街机 / 益智',
    cover: '',
    href: '',
  },
  {
    id: '02',
    title: '新游戏 · 筹备中',
    summary: '第二个独立小游戏正在装机调试，敬请期待。',
    tag: '策略 / 解谜',
    cover: '',
    href: '',
  },
  {
    id: '03',
    title: '新游戏 · 筹备中',
    summary: '第三个独立小游戏正在装机调试，敬请期待。',
    tag: '休闲 / 日常',
    cover: '',
    href: '',
  },
] as const;

// 每条分支在首页最多展示几篇
export const BRANCH_LEAF_LIMIT = 5;

// 首页导图一次能展开十几张封面，全拉原图太费流量，统一走 OSS 的缩略图样式。
// 样式在 OSS 控制台「图片处理 / 样式」里新建，名字要和这里一致；
// 列表页和详情页仍然用原图，不受这个影响
export const OSS_THUMB_STYLE = 'thumb';
