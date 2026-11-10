import { defineCollection, z } from 'astro:content';
import { plainMarkdown, profileMarkdown } from './loaders/plain-markdown';

// 五个内容集合都不写 frontmatter，元信息由加载器从文件本身推断，
// 这里的 schema 只是给推断结果兜个底
const schema = z.object({
  title: z.string(),
  slug: z.string(),
  summary: z.string(),
  publishedAt: z.coerce.date(),
  category: z.string(),
  tags: z.array(z.string()).default([]),
  // 文章里那行 github: 推出来的仓库地址，详情页日期行右边显示
  repos: z.array(z.object({ label: z.string(), url: z.string() })).default([]),
  // 文章里那行 bilibili: 推出来的视频地址，跟在仓库链接后面
  video: z.string().optional(),
  // 文章里那行 music: 推出来的伴奏，日期行最右边显示歌名
  music: z.object({ name: z.string(), url: z.string() }).optional(),
  // 文章里那行 speech: 推出来的正文朗读音频，跟在伴奏按钮右边
  speech: z.object({ name: z.string(), url: z.string() }).optional(),
  // 游戏说明里那行 play: 推出来的实际游玩路由
  play: z.string().optional(),
  cover: z.string().optional(),
});

const project = defineCollection({
  loader: plainMarkdown({ dir: 'src/content/project', defaultCategory: '项目' }),
  schema,
});

const tool = defineCollection({
  loader: plainMarkdown({ dir: 'src/content/tool', defaultCategory: '工具' }),
  schema,
});

const explore = defineCollection({
  loader: plainMarkdown({ dir: 'src/content/explore', defaultCategory: '探究' }),
  schema,
});

const xiaomeng = defineCollection({
  loader: plainMarkdown({ dir: 'src/content/xiaomeng', defaultCategory: '小萌' }),
  schema,
});

const daily = defineCollection({
  loader: plainMarkdown({ dir: 'src/content/daily', defaultCategory: '日常' }),
  schema,
});

// 公告栏：只从顶栏铃铛进入，不算内容分类，不进导航、首页导图、标签和 RSS
const notice = defineCollection({
  loader: plainMarkdown({ dir: 'src/content/notice', defaultCategory: '公告' }),
  schema,
});

// 游戏与规则说明：只从顶栏手柄图标进入，每个 .md 文件同时提供大厅卡片元信息与该游戏的规则正文
const game = defineCollection({
  loader: plainMarkdown({ dir: 'src/content/game', defaultCategory: '游戏' }),
  schema,
});

// 关于页正文：引用块里的 tags 变成技能标签，其余整篇渲染
const profile = defineCollection({
  loader: profileMarkdown({ dir: 'src/content/profile' }),
  schema: z.object({
    title: z.string(),
    skills: z.array(z.string()).default([]),
  }),
});

export const collections = { project, tool, explore, daily, xiaomeng, notice, game, profile };
