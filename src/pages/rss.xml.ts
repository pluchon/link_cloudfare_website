import type { APIRoute } from 'astro';
import { site } from '../config/site';
import { getAllPublished, entryHref } from '../lib/content';

// XML 特殊字符转义，避免标题里的 & < > 破坏结构
function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export const GET: APIRoute = async () => {
  const items = (await getAllPublished()).slice(0, 30);

  const body = items
    .map(({ kind, entry }) => {
      const link = new URL(entryHref(kind, entry.data.slug), site.url).href;
      return [
        '    <item>',
        `      <title>${esc(entry.data.title)}</title>`,
        `      <link>${link}</link>`,
        `      <guid isPermaLink="true">${link}</guid>`,
        `      <description>${esc(entry.data.summary)}</description>`,
        `      <pubDate>${entry.data.publishedAt.toUTCString()}</pubDate>`,
        ...entry.data.tags.map((tag) => `      <category>${esc(tag)}</category>`),
        '    </item>',
      ].join('\n');
    })
    .join('\n');

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0">',
    '  <channel>',
    `    <title>${esc(site.name)}</title>`,
    `    <link>${site.url}</link>`,
    `    <description>${esc(site.description)}</description>`,
    `    <language>${site.lang}</language>`,
    body,
    '  </channel>',
    '</rss>',
  ].join('\n');

  return new Response(xml, {
    headers: { 'content-type': 'application/xml; charset=utf-8' },
  });
};
