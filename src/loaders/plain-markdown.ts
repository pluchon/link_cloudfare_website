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

interface Repo {
  /** 多个仓库时用来区分的名字（前端 / 后端），只有一个仓库时为空 */
  label: string;
  url: string;
}

interface ParsedDoc {
  title: string;
  summary: string;
  tags: string[];
  repos: Repo[];
  cover?: string;
  body: string;
}

const DATE_PREFIX = /^(\d{4})-(\d{2})-(\d{2})[-_]?/;
const RULE = /^(\*{3,}|-{3,}|_{3,})$/;
const IMAGE_ONLY = /^!\[[^\]]*\]\(\s*(\S+?)(?:\s+["'][^)]*)?\s*\)$/;
const ANY_IMAGE = /!\[[^\]]*\]\(\s*(\S+?)(?:\s+["'][^)]*)?\s*\)/;
const TOC = /^\[toc\]$/i;
const TAGS = /^tags\s*[:：]\s*\[(.*)\]\s*$/i;
// 仓库地址：github: https://github.com/a/b
// 多个仓库用逗号隔开，各自前面写个名字：github: 后端 https://…, 前端 https://…
const GITHUB = /^github\s*[:：]\s*(.+)$/i;
const REPO_URL = /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/?/;

function splitTags(raw: string): string[] {
  return raw
    .split(/[,，、]/)
    .map((s) => s.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean);
}

// 只认 github.com 下的仓库地址，别的一律丢掉：这个链接会直接渲染成页面上的外链
function splitRepos(raw: string): Repo[] {
  const repos: Repo[] = [];
  for (const part of raw.split(/[,，、]/)) {
    const url = part.match(REPO_URL)?.[0];
    if (!url) continue;
    const label = part.replace(url, '').replace(/[[\]<>()（）:：]/g, '').trim();
    repos.push({ label, url: url.replace(/\/$/, '') });
  }
  return repos;
}

// 文件开头那一段是元信息区：标题、摘要引用块、分隔线、封面图、tags 引用块、github 引用块、[toc]
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
  let repos: Repo[] = [];

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
      const repoLine = inner.match(GITHUB);
      if (repoLine) {
        if (!repos.length) repos = splitRepos(repoLine[1]);
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

    const repoLine = line.match(GITHUB);
    if (repoLine) {
      if (!repos.length) repos = splitRepos(repoLine[1]);
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
    repos,
    cover: cover || undefined,
    body,
  };
}

// git 提交时间比文件修改时间可靠：克隆仓库会把 mtime 全部重置成克隆那一刻。
//
// 一旦问出来就记住。这里必须缓存，否则会有这样一条坑：
// 仓库设了 core.autocrlf=true，`git commit` 会顺手把工作区文件的换行规范化，
// 于是被碰过的文件 mtime 全部变成「现在」；与此同时 .git/index.lock 还占着，
// dev server 的 watcher 这时重新解析文件，git 查询失败 → 退回 mtime
// → 所有老文章的日期一起跳到今天。构建时不会碰上（没有并发的 git 写入），
// 所以只有长时间开着的 dev server 才会看到，排查起来很费劲。
const gitDateCache = new Map<string, number>();

function runGit(args: string[]): string | null {
  try {
    return execFileSync('git', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

// 从 `git log --follow --numstat` 的输出里，取最近一次「真的改了内容」的提交时间。
//
// 不能用 `git log --follow -1`：--follow 只负责穿过重命名把更早的历史接上，
// -1 取到的仍是最新那次提交——而目录改名那次提交本身就是「最后一次碰过这个文件」。
// 2026-09-13 把 article → project、info → tool 之后，5 篇没动过内容的文章
// 日期全变成了改名那天。纯改名在 numstat 里是 `0\t0\t旧路径 => 新路径`，
// 增删行数都为 0，据此跳过；二进制文件显示 `-\t-`，按有改动算
function lastContentDate(log: string): string {
  let date = '';
  let oldest = '';
  let changed = false;

  for (const line of log.split('\n')) {
    if (line.startsWith('@@')) {
      if (date && changed) return date;
      date = line.slice(2).trim();
      oldest = date;
      changed = false;
      continue;
    }
    const cols = line.split('\t');
    if (cols.length < 3) continue;
    const [add, del] = cols;
    if (add === '-' || del === '-' || Number(add) + Number(del) > 0) changed = true;
  }

  if (date && changed) return date;
  // 所有提交都没改行（比如加进来的是空文件）：退回最早那次
  return oldest;
}

function gitDate(file: string): Date | null {
  const query = () =>
    runGit(['log', '--follow', '--format=@@%aI', '--numstat', '--', file]);

  // 失败重试一次：commit 期间 index.lock 占着会让第一次必然失败
  let out = query();
  if (out === null) out = query();

  if (out === null) {
    // git 真的用不了。有缓存就用缓存，绝不退回 mtime——
    // 那正是「加一篇新文章，老文章日期全被改写」的成因
    const cached = gitDateCache.get(file);
    return cached === undefined ? null : new Date(cached);
  }

  // git 能用但没有记录：这个文件还没进版本库，此时 mtime 才是对的
  if (!out) return null;

  const d = new Date(lastContentDate(out));
  if (Number.isNaN(d.valueOf())) return null;

  gitDateCache.set(file, d.valueOf());
  return d;
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
            repos: parsed.repos,
            cover: parsed.cover,
          },
        });

        ctx.store.set({
          id: slug,
          data,
          body: parsed.body,
          filePath,
          // 日期不在文件内容里（来自 git），也要算进摘要。只算 raw 的话，
          // 提交/改名后内容没变，dev server 会认为条目没变，继续用旧日期
          digest: ctx.generateDigest(raw + publishedAt.toISOString()),
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
        // 删除也要跟着摘掉，否则文件没了条目还留在库里
        ctx.watcher.on('unlink', (removed: string) => {
          if (!removed.startsWith(base) || !removed.endsWith('.md')) return;
          const name = path.basename(removed, '.md');
          ctx.store.delete(name.replace(DATE_PREFIX, '').replace(/\s+/g, '-'));
        });
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
        ctx.watcher.on('unlink', (removed: string) => {
          if (!removed.startsWith(base) || !removed.endsWith('.md')) return;
          ctx.store.delete(path.basename(removed, '.md'));
        });
      }
    },
  };
}
