import { getCollection, type CollectionEntry } from 'astro:content';

export type ContentKind = 'article' | 'info' | 'xiaomeng';
export type AnyEntry =
  | CollectionEntry<'article'>
  | CollectionEntry<'info'>
  | CollectionEntry<'xiaomeng'>;

// 按发布时间倒序。草稿（文件名以下划线开头）在加载器里就已排除
export async function getPublished<K extends ContentKind>(
  kind: K,
): Promise<CollectionEntry<K>[]> {
  const entries = await getCollection(kind);
  return entries.sort(
    (a, b) => b.data.publishedAt.valueOf() - a.data.publishedAt.valueOf(),
  ) as CollectionEntry<K>[];
}

// 两个集合合并后的统一视图，用于标签页与归档
export async function getAllPublished(): Promise<
  { kind: ContentKind; entry: AnyEntry }[]
> {
  const [article, info, xiaomeng] = await Promise.all([
    getPublished('article'),
    getPublished('info'),
    getPublished('xiaomeng'),
  ]);
  return [
    ...article.map((entry) => ({ kind: 'article' as const, entry })),
    ...info.map((entry) => ({ kind: 'info' as const, entry })),
    ...xiaomeng.map((entry) => ({ kind: 'xiaomeng' as const, entry })),
  ].sort(
    (a, b) =>
      b.entry.data.publishedAt.valueOf() - a.entry.data.publishedAt.valueOf(),
  );
}

// 详情页路径统一由 frontmatter 的 slug 决定
export function entryHref(kind: ContentKind, slug: string): string {
  return `/${kind}/${slug}/`;
}

// 中文按字计、西文按词计的字数估算
export function countWords(body: string): number {
  const text = body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!?\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/[#>*_`~\-|]/g, ' ');
  const cjk = text.match(/[一-龥぀-ヿ]/g)?.length ?? 0;
  const latin = text.match(/[A-Za-z0-9]+(?:['-][A-Za-z0-9]+)*/g)?.length ?? 0;
  return cjk + latin;
}

// 中文阅读速度按 400 字/分钟估算
export function readingMinutes(body: string): number {
  return Math.max(1, Math.round(countWords(body) / 400));
}

export function formatDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// 统计标签出现次数，按热度再按字母排序
export function tagCounts(entries: { data: { tags: string[] } }[]) {
  const map = new Map<string, number>();
  for (const item of entries) {
    for (const tag of item.data.tags) {
      map.set(tag, (map.get(tag) ?? 0) + 1);
    }
  }
  return [...map.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

// 同标签相关阅读：按共同标签数排序，取前 N 条
export function relatedEntries<T extends { id: string; data: { tags: string[] } }>(
  current: T,
  pool: T[],
  limit = 3,
): T[] {
  const tags = new Set(current.data.tags);
  return pool
    .filter((item) => item.id !== current.id)
    .map((item) => ({
      item,
      score: item.data.tags.filter((tag) => tags.has(tag)).length,
    }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ item }) => item);
}

// 列表分页大小
export const PAGE_SIZE = 5;

// 构建期分页：返回每一页的条目切片
export function paginateEntries<T>(entries: T[], size = PAGE_SIZE): T[][] {
  if (entries.length === 0) return [[]];
  const pages: T[][] = [];
  for (let i = 0; i < entries.length; i += size) {
    pages.push(entries.slice(i, i + size));
  }
  return pages;
}

// 列表页检索用的纯文本：标题 + 摘要 + 分类 + 标签 + 正文前段
// 正文截断是为了不让每页 HTML 无限膨胀；全文检索以后交给 Pagefind
export function searchText(entry: {
  body?: string;
  data: { title: string; summary: string; category: string; tags: string[] };
}): string {
  const body = (entry.body ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!?\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/[#>*_`~\-|]/g, ' ')
    .replace(/\s+/g, ' ')
    .slice(0, 500);

  return [entry.data.title, entry.data.summary, entry.data.category, ...entry.data.tags, body]
    .join(' ')
    .toLowerCase();
}

// 封面在加载器里就已经从元信息区取好了；这里保留正文兜底
export function entryCover(entry: {
  body?: string;
  data: { cover?: string };
}): string | undefined {
  if (entry.data.cover) return entry.data.cover;

  const body = entry.body ?? '';
  const md = body.match(/!\[[^\]]*\]\(\s*(\S+?)(?:\s+["'][^)]*)?\s*\)/);
  if (md) return md[1];

  const html = body.match(/<img[^>]+src=["']([^"']+)["']/i);
  return html ? html[1] : undefined;
}
