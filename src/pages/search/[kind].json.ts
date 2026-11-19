import type { APIRoute, GetStaticPaths } from 'astro';
import { branches } from '../../config/site';
import { getPublished, entryHref, plainText, type ContentKind } from '../../lib/content';
import { encodePinyin } from '../../lib/search-index';

// 列表页搜索框用的全文索引：每个分类一份，包含链接、正文纯文本及上下文拼音序列；
// 标题、摘要、标签已经内嵌在列表页 HTML 里，搜索框首次聚焦时再懒拉此全文索引。
export const getStaticPaths: GetStaticPaths = () =>
  branches.map((branch) => ({ params: { kind: branch.key } }));

export const GET: APIRoute = async ({ params }) => {
  const kind = params.kind as ContentKind;
  const entries = await getPublished(kind);
  const index = entries.map((entry) => {
    const body = plainText(entry.body);
    return {
      h: entryHref(kind, entry.data.slug),
      b: body,
      pb: encodePinyin(body, false),
    };
  });
  return new Response(JSON.stringify(index), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
};
