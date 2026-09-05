// 站点全局文案与导航配置：页面里不要写死字符串
export const site = {
  name: '儒雅的诺诺的学习基地',
  shortName: '诺诺',
  tagline: 'AI Coding 与日常学习的分享',
  title: '儒雅的诺诺的学习基地 | AI Coding 与日常学习的分享',
  description: '记录 AI Coding 实践、后端工程与日常学习的笔记与资料。',
  url: 'https://www.nuonuoya.cn',
  lang: 'zh-CN',
  since: 2026,
} as const;

// 顶栏导航
export const nav = [
  { label: '文章', href: '/blog/' },
  { label: '资料', href: '/library/' },
  { label: '标签', href: '/tags/' },
  { label: '关于', href: '/about/' },
] as const;

// 首页分区文案
export const home = {
  intro:
    '这里放我在 AI Coding、后端工程和日常学习里攒下的笔记。写给未来的自己，也顺手分享出来。',
  sections: {
    blog: { label: 'Writing', title: '最近的文章', more: '全部文章' },
    library: { label: 'Library', title: '学习资料', more: '全部资料' },
    tags: { label: 'Topics', title: '在写的话题' },
  },
} as const;
