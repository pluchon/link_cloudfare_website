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
  footerNote: '今天也辛苦啦，要不要在这里休息一会儿？小萌会陪着你的♪٩(´ω`)و♪',
  notFoundPoster:
    'https://zlhimage.oss-cn-guangzhou.aliyuncs.com/profile_website/404.webp',
} as const;

// 顶栏导航（/tags/ 页面保留，只是不进导航）
export const nav = [
  { label: '文章', href: '/article/' },
  { label: '资料', href: '/info/' },
  { label: '小萌', href: '/xiaomeng/' },
  { label: '关于', href: '/about/' },
] as const;

// 首页思维导图的根节点，也是关于页的名片
// avatar 留空则渲染成占位线框；要换成照片就填 OSS 完整 URL
export const profile = {
  avatar: 'https://zlhimage.oss-cn-guangzhou.aliyuncs.com/profile_website/profile_avatar.webp',
  name: '诺诺',
  bio: '在写代码，也在记笔记。把踩过的坑和读过的东西留在这里',
  // 第三方链接：href 换成自己的即可。三个图标源文件 viewBox 各不相同
  // （24 / 32 / 512），所以渲染时统一用固定盒子 + object-fit 保证一样大
  links: [
    { label: 'GitHub', href: 'https://github.com/pluchon', icon: '/icons/github.svg' },
    { label: 'X', href: 'https://x.com/pluchon200010', icon: '/icons/x.svg' },
    { label: 'Gmail', href: 'mailto:zlh8232@gmail.com', icon: '/icons/gmail.svg' },
  ],
} as const;

// 思维导图的一级分支，也是站点的内容分类。加板块往这里追加即可
// cover 填 OSS 完整 URL，留空则渲染成占位线框
export const branches = [
  {
    key: 'article',
    label: '文章',
    href: '/article/',
    desc: '自己写的东西',
    cover: 'https://zlhimage.oss-cn-guangzhou.aliyuncs.com/profile_website/article.webp',
  },
  {
    key: 'info',
    label: '资料',
    href: '/info/',
    desc: '整理过的教程与清单',
    cover: 'https://zlhimage.oss-cn-guangzhou.aliyuncs.com/profile_website/info.webp',
  },
  {
    key: 'xiaomeng',
    label: '小萌',
    href: '/xiaomeng/',
    desc: '小萌的一些资料与设计构想',
    cover: 'https://zlhimage.oss-cn-guangzhou.aliyuncs.com/profile_website/xiaomeng.webp',
  },
] as const;

// 每条分支在首页最多展示几篇
export const BRANCH_LEAF_LIMIT = 5;

// 首页导图一次能展开十几张封面，全拉原图太费流量，统一走 OSS 的缩略图样式。
// 样式在 OSS 控制台「图片处理 / 样式」里新建，名字要和这里一致；
// 列表页和详情页仍然用原图，不受这个影响
export const OSS_THUMB_STYLE = 'thumb';
