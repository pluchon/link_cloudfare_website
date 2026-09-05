import type { APIRoute } from 'astro';
import { site } from '../config/site';
import { getAllPublished, tagCounts, entryHref } from '../lib/content';

export const GET: APIRoute = async () => {
  const all = await getAllPublished();
  const tags = tagCounts(all.map((item) => item.entry));

  const urls: { loc: string; lastmod?: Date }[] = [
    { loc: '/' },
    { loc: '/blog/' },
    { loc: '/library/' },
    { loc: '/tags/' },
    { loc: '/about/' },
    ...all.map(({ kind, entry }) => ({
      loc: entryHref(kind, entry.data.slug),
      lastmod: entry.data.updatedAt ?? entry.data.publishedAt,
    })),
    ...tags.map(({ tag }) => ({ loc: `/tags/${encodeURIComponent(tag)}/` })),
  ];

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.map((item) =>
      [
        '  <url>',
        `    <loc>${new URL(item.loc, site.url).href}</loc>`,
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
