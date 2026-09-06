import type { APIRoute, GetStaticPaths } from 'astro';
import { getPublished } from '../../lib/content';

// 提供 Markdown 原文下载
export const getStaticPaths: GetStaticPaths = async () => {
  const entries = await getPublished('article');
  return entries.map((entry) => ({
    params: { slug: entry.data.slug },
    props: { body: entry.body ?? '' },
  }));
};

export const GET: APIRoute = ({ props }) =>
  new Response((props as { body: string }).body, {
    headers: { 'content-type': 'text/markdown; charset=utf-8' },
  });
