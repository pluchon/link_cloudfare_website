import type { APIRoute, GetStaticPaths } from 'astro';
import { branches } from '../../config/site';
import { getPublished, entryHref, plainText, type ContentKind } from '../../lib/content';

// 列表页搜索框用的全文索引：每个分类一份，只放链接和正文纯文本，
// 标题、摘要、标签已经内嵌在列表页里了。搜索框第一次获得焦点时才去拉
export const getStaticPaths: GetStaticPaths = () =>
  branches.map((branch) => ({ params: { kind: branch.key } }));

export const GET: APIRoute = async ({ params }) => {
  const kind = params.kind as ContentKind;
  const entries = await getPublished(kind);
  const index = entries.map((entry) => ({
    h: entryHref(kind, entry.data.slug),
    b: plainText(entry.body),
  }));
  return new Response(JSON.stringify(index), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
};
