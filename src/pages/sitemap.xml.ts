import type { APIRoute } from 'astro';
import { site } from '../config/site';
import { getAllPublished, getNotices, noticeHref, tagCounts, entryHref } from '../lib/content';

export const GET: APIRoute = async () => {
  const all = await getAllPublished();
  const tags = tagCounts(all.map((item) => item.entry));
  const notices = await getNotices();

  const urls: { loc: string; lastmod?: Date }[] = [
    { loc: '/' },
    { loc: '/project/' },
    { loc: '/tool/' },
    { loc: '/explore/' },
    { loc: '/daily/' },
    { loc: '/xiaomeng/' },
    { loc: '/tags/' },
    { loc: '/about/' },
    { loc: '/notice/' },
    ...notices.map((entry) => ({
      loc: noticeHref(entry.data.slug),
      lastmod: entry.data.publishedAt,
    })),
    ...all.map(({ kind, entry }) => ({
      loc: entryHref(kind, entry.data.slug),
      lastmod: entry.data.publishedAt,
    })),
    ...tags.map(({ tag }) => ({ loc: `/tags/${encodeURIComponent(tag)}/` })),
  ];

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.map((item) =>
      [
        '  <url>',
        // 文件名里带 & 的文章，地址里也会有 &，不转义整份 XML 就解析不了
        `    <loc>${new URL(item.loc, site.url).href.replace(/&/g, '&amp;')}</loc>`,
        item.lastmod ? `    <lastmod>${item.lastmod.toISOString()}</lastmod>` : '',
        '  </url>',
      ]
        .filter(Boolean)
        .join('\n'),
    ),
    '</urlset>',
  ].join('\n');

  return new Response(xml, {
    headers: { 'content-type': 'application/xml; charset=utf-8' },
  });
};
