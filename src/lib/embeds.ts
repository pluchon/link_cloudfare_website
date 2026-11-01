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

// ```link：站外链接的视窗，一行一个字段：title / desc / url / cover
function renderLink(value: string): string {
  const fields = new Map<string, string>();
  for (const line of value.split('\n')) {
    const at = line.indexOf(':');
    if (at > 0) fields.set(line.slice(0, at).trim(), line.slice(at + 1).trim());
  }

  const title = fields.get('title');
  const url = fields.get('url');
  if (!title || !url?.startsWith('https://')) {
    throw new Error(`公告里的 link 视窗要有 title 和 https 开头的 url：${value}`);
  }

  const desc = fields.get('desc');

  return `<a class="window" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">
${windowBar('站外链接')}
<span class="window__body">
${windowCover(fields.get('cover'))}
<span class="window__text">
<span class="window__title">${escapeHtml(title)}</span>
${desc ? `<span class="window__summary">${escapeHtml(desc)}</span>` : ''}
</span>
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
