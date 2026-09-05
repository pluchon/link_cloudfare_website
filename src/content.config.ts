import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

// 两个集合共用的基础字段
const baseSchema = z.object({
  title: z.string(),
  slug: z.string(),
  summary: z.string(),
  publishedAt: z.coerce.date(),
  updatedAt: z.coerce.date().optional(),
  category: z.string(),
  tags: z.array(z.string()).default([]),
  // 封面必须是 OSS 外链完整 URL，不放 public/
  cover: z.string().url().optional(),
  draft: z.boolean().default(false),
  featured: z.boolean().default(false),
});

const blog = defineCollection({
  loader: glob({ base: './src/content/blog', pattern: '**/*.md' }),
  schema: baseSchema,
});

const library = defineCollection({
  loader: glob({ base: './src/content/library', pattern: '**/*.md' }),
  schema: baseSchema.extend({
    // 附件一律外链（OSS / 网盘），不进 Git
    attachments: z
      .array(z.object({ name: z.string(), url: z.string().url() }))
      .default([]),
    sourceUrl: z.string().url().optional(),
  }),
});

export const collections = { blog, library };
