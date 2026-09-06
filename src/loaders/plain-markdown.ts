import type { Loader, LoaderContext } from 'astro/loaders';
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 不写 frontmatter 的 Markdown 加载器：元信息全部从文件本身推断
//   标题   ← 第一个 # 一级标题
//   简介   ← 紧跟标题的 > 引用块
//   分类   ← 所在子文件夹名；直接放在根目录则用集合默认名
//   日期   ← 文件名的 YYYY-MM-DD- 前缀 > git 最后提交时间 > 文件修改时间
//   标签   ← 文件里任意一行 tags: [甲, 乙]
//   封面   ← 正文第一张图（在 lib/content.ts 的 entryCover 里取）
//   草稿   ← 文件名以下划线开头
// 标题、简介、标签这三行会从正文里剔除，不会在文章里重复出现

export interface PlainMarkdownOptions {
  /** 相对项目根目录，例如 src/content/blog */
  dir: string;
  /** 文件直接放在 dir 下时使用的分类名 */
  defaultCategory: string;
}

interface ParsedDoc {
  title: string;
  summary: string;
  tags: string[];
  cover?: string;
  body: string;
}

const DATE_PREFIX = /^(\d{4})-(\d{2})-(\d{2})[-_]?/;
const RULE = /^(\*{3,}|-{3,}|_{3,})$/;
const IMAGE_ONLY = /^!\[[^\]]*\]\(\s*(\S+?)(?:\s+["'][^)]*)?\s*\)$/;
const ANY_IMAGE = /!\[[^\]]*\]\(\s*(\S+?)(?:\s+["'][^)]*)?\s*\)/;
const TOC = /^\[toc\]$/i;
const TAGS = /^tags\s*[:：]\s*\[(.*)\]\s*$/i;

function splitTags(raw: string): string[] {
  return raw
    .split(/[,，、]/)
    .map((s) => s.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean);
}

// 文件开头那一段是元信息区：标题、摘要引用块、分隔线、封面图、tags 引用块、[toc]
// 都算在内，一直读到第一行「正经正文」为止，整段不进正文
function parseDoc(raw: string, fallbackTitle: string): ParsedDoc {
  const lines = raw.replace(/\r\n/g, '\n').split('\n');

  let i = 0;
  // 万一还留着 frontmatter，整段跳过，不报错也不显示
  if (lines[0]?.trim() === '---') {
    const end = lines.indexOf('---', 1);
    if (end > 0) i = end + 1;
  }

  let title = '';
  let summary = '';
  let cover = '';
  let tags: string[] = [];

  for (; i < lines.length; i++) {
    const line = lines[i].trim();

    if (!line || RULE.test(line) || TOC.test(line)) continue;

    if (!title) {
      const h1 = line.match(/^#\s+(.+?)\s*$/);
      if (h1) {
        title = h1[1];
        continue;
      }
    }

    if (line.startsWith('>')) {
      const inner = line.replace(/^>\s?/, '').trim();
      const tagged = inner.match(TAGS);
      if (tagged) {
        if (!tags.length) tags = splitTags(tagged[1]);
        continue;
      }
      // 摘要只认第一段引用；再出现引用块说明正文已经开始了
      if (summary) break;
      summary = inner;
      continue;
    }

    const tagged = line.match(TAGS);
    if (tagged) {
      if (!tags.length) tags = splitTags(tagged[1]);
      continue;
    }

    const img = line.match(IMAGE_ONLY);
    if (img) {
      if (!cover) cover = img[1];
      continue;
    }

    break;
  }

  // 正文里残留的 tags 行和 [toc] 一并清掉（有人习惯把 tags 写在末尾）
  const body = lines
    .slice(i)
    .filter((line) => {
      const t = line.trim();
      if (TOC.test(t)) return false;
      return !TAGS.test(t.replace(/^>\s?/, ''));
    })
    .join('\n')
    .trim();

  // 元信息区没放图就退回正文第一张
  if (!cover) cover = body.match(ANY_IMAGE)?.[1] ?? '';

  // 没写引用块就退回正文第一段，截一句话
  if (!summary) {
    for (const line of body.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#') || t.startsWith('!') || t.startsWith('|')) continue;
      summary = t.replace(/[*_`>]/g, '').slice(0, 80);
      break;
    }
  }

  return {
    title: title || fallbackTitle,
    summary,
    tags,
    cover: cover || undefined,
    body,
  };
}

// git 提交时间比文件修改时间可靠：克隆仓库会把 mtime 全部重置成克隆那一刻
function gitDate(file: string): Date | null {
  try {
    const out = execFileSync('git', ['log', '-1', '--format=%aI', '--', file], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (!out) return null;
    const d = new Date(out);
    return Number.isNaN(d.valueOf()) ? null : d;
  } catch {
    return null;
  }
}

async function listMarkdown(dir: string): Promise<string[]> {
  let items;
  try {
    items = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const found: string[] = [];
  for (const item of items) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) {
      found.push(...(await listMarkdown(full)));
    } else if (item.name.endsWith('.md')) {
      found.push(full);
    }
  }
  return found;
}

export function plainMarkdown(options: PlainMarkdownOptions): Loader {
  return {
    name: 'plain-markdown',

    async load(ctx: LoaderContext) {
      const root = fileURLToPath(ctx.config.root);
      const base = path.join(root, options.dir);

      async function sync(file: string): Promise<string | null> {
        const name = path.basename(file, '.md');
        // 下划线开头当草稿，不进集合
        if (name.startsWith('_')) return null;

        const raw = await fs.readFile(file, 'utf8');
        const parsed = parseDoc(raw, name);

        // 日期：文件名前缀最可靠，其次 git，最后才是文件修改时间
        const prefix = name.match(DATE_PREFIX);
        let publishedAt: Date;
        if (prefix) {
          publishedAt = new Date(`${prefix[1]}-${prefix[2]}-${prefix[3]}T00:00:00Z`);
        } else {
          publishedAt = gitDate(file) ?? (await fs.stat(file)).mtime;
        }

        // 分类看它放在哪个子文件夹里
        const rel = path.relative(base, file);
        const folder = path.dirname(rel).split(path.sep)[0];
        const category = folder && folder !== '.' ? folder : options.defaultCategory;

        const slug = name.replace(DATE_PREFIX, '').replace(/\s+/g, '-');
        const filePath = path.relative(root, file).split(path.sep).join('/');

        const data = await ctx.parseData({
          id: slug,
          filePath,
          data: {
            title: parsed.title,
            slug,
            summary: parsed.summary,
            publishedAt,
            category,
            tags: parsed.tags,
            cover: parsed.cover,
          },
        });

        ctx.store.set({
          id: slug,
          data,
          body: parsed.body,
          filePath,
          digest: ctx.generateDigest(raw),
          rendered: await ctx.renderMarkdown(parsed.body),
        });

        return slug;
      }

      ctx.store.clear();
      for (const file of await listMarkdown(base)) {
        try {
          await sync(file);
        } catch (error) {
          ctx.logger.error(`解析失败 ${file}：${(error as Error).message}`);
        }
      }

      // 开发时改动文件立即生效；删除和重命名走整体重载，省得维护映射
      if (ctx.watcher) {
        ctx.watcher.add(base);
        const onChange = async (changed: string) => {
          if (!changed.startsWith(base) || !changed.endsWith('.md')) return;
          try {
            await sync(changed);
          } catch (error) {
            ctx.logger.error(`解析失败 ${changed}：${(error as Error).message}`);
          }
        };
        ctx.watcher.on('change', onChange);
        ctx.watcher.on('add', onChange);
      }
    },
  };
}

// 关于页正文的加载器。格式：
//   # 标题
//   > tags: [甲, 乙]
//   正文……
// 引用块里的 tags 会变成个人资料卡上的技能标签，最多取 20 个，并从正文剔除
export function profileMarkdown(options: { dir: string }): Loader {
  return {
    name: 'profile-markdown',

    async load(ctx: LoaderContext) {
      const root = fileURLToPath(ctx.config.root);
      const base = path.join(root, options.dir);

      async function sync(file: string) {
        const name = path.basename(file, '.md');
        if (name.startsWith('_')) return;

        const raw = await fs.readFile(file, 'utf8');
        const lines = raw.replace(/\r\n/g, '\n').split('\n');

        let skills: string[] = [];
        const kept: string[] = [];
        for (const line of lines) {
          // 无论有没有包在引用块里，这一行都只用来取标签
          const m = line
            .trim()
            .replace(/^>\s*/, '')
            .match(/^tags\s*[:：]\s*\[(.*)\]\s*$/i);
          if (m && !skills.length) {
            skills = m[1]
              .split(/[,，]/)
              .map((s) => s.trim().replace(/^["']|["']$/g, ''))
              .filter(Boolean)
              .slice(0, 20);
            continue;
          }
          kept.push(line);
        }

        const body = kept.join('\n').trim();
        const title = body.match(/^#\s+(.+?)\s*$/m)?.[1] ?? name;

        const data = await ctx.parseData({
          id: name,
          filePath: path.relative(root, file).split(path.sep).join('/'),
          data: { title, skills },
        });

        ctx.store.set({
          id: name,
          data,
          body,
          filePath: path.relative(root, file).split(path.sep).join('/'),
          digest: ctx.generateDigest(raw),
          rendered: await ctx.renderMarkdown(body),
        });
      }

      ctx.store.clear();
      for (const file of await listMarkdown(base)) {
        try {
          await sync(file);
        } catch (error) {
          ctx.logger.error(`解析失败 ${file}：${(error as Error).message}`);
        }
      }

      if (ctx.watcher) {
        ctx.watcher.add(base);
        const onChange = async (changed: string) => {
          if (!changed.startsWith(base) || !changed.endsWith('.md')) return;
          try {
            await sync(changed);
          } catch (error) {
            ctx.logger.error(`解析失败 ${changed}：${(error as Error).message}`);
          }
        };
        ctx.watcher.on('change', onChange);
        ctx.watcher.on('add', onChange);
      }
    },
  };
}
