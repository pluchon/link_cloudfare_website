import { site } from '../config/site';
import { entryCover, entryHref, formatDate, getAllPublished, thumbUrl } from './content';

// 把 remark-embed 留下的占位换成真正的内容，只有公告页会调用。
// 写错了直接让构建失败：公告里一个点不开的视窗，比构建报错难发现得多

const PLACEHOLDER = /<div data-embed="(post|link|xiaomeng)" data-value="([^"]*)"><\/div>/g;

const ESCAPE: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (ch) => ESCAPE[ch]);
}

// 视窗的标题栏：三颗小圆点，后面是分类和时间，不写网址
function windowBar(kind: string, date?: string): string {
  return `<span class="window__bar"><span class="window__dots" aria-hidden="true"><i></i><i></i><i></i></span><span class="window__kind">${escapeHtml(kind)}</span>${date ? `<time>${date}</time>` : ''}</span>`;
}

function windowCover(url?: string): string {
  return url ? `<img class="window__cover" src="${escapeHtml(url)}" alt="" loading="lazy" decoding="async" />` : '';
}

type Published = Awaited<ReturnType<typeof getAllPublished>>;

// ```post：站内文章的视窗，内容按地址从集合里取，文章改了这里跟着变
function renderPost(value: string, all: Published): string {
  const pathname = decodeURIComponent(new URL(value.trim(), site.url).pathname);
  const [kind, slug] = pathname.split('/').filter(Boolean);
  const found = all.find((item) => item.kind === kind && item.entry.data.slug === slug);
  if (!found) throw new Error(`公告里的 post 视窗找不到文章：${value.trim()}`);

  const { data } = found.entry;
  // 标签只占一行，全部写进去，放不下的由 NoticeLayout 的脚本按实际宽度收成「+N」
  const tags = data.tags.length
    ? `<span class="window__tags" data-window-tags>${data.tags
        .map((tag) => `<span class="window__tag">${escapeHtml(tag)}</span>`)
        .join('')}<span class="window__tag window__tag--more" hidden></span></span>`
    : '';

  return `<a class="window" href="${escapeHtml(entryHref(found.kind, data.slug))}">
${windowBar(data.category, formatDate(data.publishedAt))}
<span class="window__body">
${windowCover(thumbUrl(entryCover(found.entry)))}
<span class="window__text">
<span class="window__title">${escapeHtml(data.title)}</span>
<span class="window__summary">${escapeHtml(data.summary)}</span>
${tags}
</span>
</span>
</a>`;
}

function windowVortex(): string {
  return `<span class="window__vortex" aria-hidden="true">
<svg viewBox="0 0 80 80" fill="none">
  <circle class="window__vortex-orbit" cx="40" cy="40" r="33" />
  <g class="window__vortex-arms">
    <path d="M40 10C56 10 68 22 68 38C68 50 58 58 47 58C38 58 32 51 32 43" />
    <path d="M70 40C70 56 58 68 42 68C30 68 22 58 22 47C22 38 29 32 37 32" />
    <path d="M40 70C24 70 12 58 12 42C12 30 22 22 33 22C42 22 48 29 48 37" />
    <path d="M10 40C10 24 22 12 38 12C50 12 58 22 58 33C58 42 51 48 43 48" />
    <circle class="window__vortex-dot" cx="40" cy="10" r="1.6" />
    <circle class="window__vortex-dot" cx="70" cy="40" r="1.4" />
    <circle class="window__vortex-dot" cx="40" cy="70" r="1.6" />
    <circle class="window__vortex-dot" cx="10" cy="40" r="1.4" />
  </g>
  <ellipse class="window__vortex-disk" cx="40" cy="40" rx="26" ry="8.5" transform="rotate(-18 40 40)" />
  <circle class="window__vortex-photon" cx="40" cy="40" r="11.5" />
  <circle class="window__vortex-core" cx="40" cy="40" r="8.5" />
</svg>
</span>`;
}

// ```link：站内或站外链接的视窗，一行一个字段：title / desc / url / cover
function renderLink(value: string): string {
  const fields = new Map<string, string>();
  for (const line of value.split('\n')) {
    const at = line.indexOf(':');
    if (at > 0) fields.set(line.slice(0, at).trim(), line.slice(at + 1).trim());
  }

  const title = fields.get('title');
  const url = fields.get('url');
  if (!title || (!url?.startsWith('https://') && !url?.startsWith('/'))) {
    throw new Error(`公告里的 link 视窗要有 title 和 https 或 / 开头的 url：${value}`);
  }

  const siteOrigin = new URL(site.url).origin;
  const parsed = new URL(url, site.url);
  const isInternal = url.startsWith('/') || parsed.origin === siteOrigin;
  const href = isInternal ? `${parsed.pathname}${parsed.search}${parsed.hash}` : url;
  const targetAttr = isInternal ? '' : ' target="_blank" rel="noopener noreferrer"';
  const barLabel = fields.get('kind') ?? (isInternal ? '站内链接' : '站外链接');

  const desc = fields.get('desc');
  const cover = fields.get('cover');

  return `<a class="window" href="${escapeHtml(href)}"${targetAttr}>
${windowBar(barLabel)}
<span class="window__body">
${windowCover(cover)}
<span class="window__text">
<span class="window__title">${escapeHtml(title)}</span>
${desc ? `<span class="window__summary">${escapeHtml(desc)}</span>` : ''}
</span>
${!cover ? windowVortex() : ''}
</span>
</a>`;
}

// ```xiaomeng：小萌说的话，只有一个粉色的框，空一行分段
function renderMeow(value: string): string {
  const paragraphs = value
    .split(/\n\s*\n/)
    .map((part) => `<p>${escapeHtml(part.trim())}</p>`)
    .join('');
  return `<aside class="meow">${paragraphs}</aside>`;
}

export async function resolveEmbeds(html: string): Promise<string> {
  if (!html.includes('data-embed=')) return html;
  const all = await getAllPublished();

  return html.replace(PLACEHOLDER, (_, kind: string, encoded: string) => {
    const value = decodeURIComponent(encoded);
    if (kind === 'post') return renderPost(value, all);
    if (kind === 'link') return renderLink(value);
    return renderMeow(value);
  });
}
