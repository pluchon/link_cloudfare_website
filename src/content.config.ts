import { defineCollection, z } from 'astro:content';
import { plainMarkdown, profileMarkdown } from './loaders/plain-markdown';

// 三个内容集合都不写 frontmatter，元信息由加载器从文件本身推断，
// 这里的 schema 只是给推断结果兜个底
const schema = z.object({
  title: z.string(),
  slug: z.string(),
  summary: z.string(),
  publishedAt: z.coerce.date(),
  category: z.string(),
  tags: z.array(z.string()).default([]),
  cover: z.string().optional(),
});

const article = defineCollection({
  loader: plainMarkdown({ dir: 'src/content/article', defaultCategory: '文章' }),
  schema,
});

const info = defineCollection({
  loader: plainMarkdown({ dir: 'src/content/info', defaultCategory: '资料' }),
  schema,
});

const xiaomeng = defineCollection({
  loader: plainMarkdown({ dir: 'src/content/xiaomeng', defaultCategory: '小萌' }),
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

export const collections = { article, info, xiaomeng, profile };
