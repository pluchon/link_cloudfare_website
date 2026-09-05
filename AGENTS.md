# 项目说明（给后续 AI / 开发者）

> 本文是本仓库**唯一**的需求与进度说明。已完成的连通与基建不要重做；按「未完成」继续实现站点。

---

## 1. 项目是什么

个人博客 + 学习资料站。

| 项 | 值 |
|----|-----|
| 站点名 | 儒雅的诺诺的学习基地 |
| 副标题 | AI Coding 与日常学习的分享 |
| 正式 URL | `https://www.nuonuoya.cn`（主站用 www） |
| 备案号 | `湘ICP备2026019722号-1`（**页脚不展示**，仅 `src/config/site.ts` 备查） |
| 本地路径 | `C:\JavaCode\items\personal_website` |
| GitHub | `git@github.com:pluchon/link_cloudfare_website.git`（分支 `main`） |
| 托管 | Cloudflare Pages 项目名 `link-cloudfare-website` |
| 备用域名 | `https://link-cloudfare-website.pages.dev` |

---

## 2. 已完成（勿重复建设）

- [x] Git 仓库接管、`.gitignore` / `.gitattributes`(LF) / `.nvmrc`(Node 22)
- [x] Astro 5 静态站骨架（`output: 'static'`），`npm run build` 产出 `dist/`
- [x] Cloudflare Pages ↔ GitHub 自动部署（Build: `npm run build`，Output: `dist`，`NODE_VERSION=22`）
- [x] 阿里云 DNS：**NS 不转 Cloudflare**；`www` CNAME → `link-cloudfare-website.pages.dev`；裸域 `@` 显性 URL 301 → `https://www.nuonuoya.cn`；保留 `_dnsauth` TXT
- [x] HTTPS（Cloudflare 自动证书，无需自备 pem/pfx）
- [x] Turnstile 进站闸门（保留阿里云 NS 的前提下）：
  - `functions/_middleware.ts`：无有效 Cookie 则 302 → `/gate/`
  - `functions/api/turnstile-verify.ts`：校验 token，下发签名 Cookie（24h）
  - `functions/_lib/gate.ts`：Cookie HMAC 逻辑（**必须放在 `functions/` 内**，Pages 打包器限制）
  - `src/pages/gate.astro`：页面**只保留居中 Turnstile**，无卡片/标题装饰
- [x] 站点配置：`src/config/site.ts`
- [x] 占位首页：`src/pages/index.astro`（非正式设计）
- [x] 探针：`public/__deploy_probe.txt` → 线上应为 `deploy-ok`

**日常同步：** 改代码 → `git push origin main` → 约 1 分钟 Pages 自动构建上线。

**Pages 环境变量（Production，已由用户配置）：**

| 变量 | 用途 |
|------|------|
| `PUBLIC_TURNSTILE_SITE_KEY` | 构建进 `/gate/` 前端 |
| `TURNSTILE_SECRET_KEY` | Function 调 siteverify（Secret） |
| `GATE_COOKIE_SECRET` | Cookie 签名（Secret） |
| `NODE_VERSION` | `22` |

未配齐两个 Secret 时中间件**故意不拦截**（避免锁死站点）。本地 `astro dev` **不会**跑 Pages Functions。

---

## 3. 硬约束（写代码时必须遵守）

1. **纯静态 Astro + Markdown Content Collections**，无 Spring Boot / 无自建数据库。
2. **阿里云 NS 保持不动**；不要引导用户把域名整站迁入 Cloudflare DNS。
3. **图片一律 OSS 图床外链**，不建 `public/uploads`，不用 R2 存图，CMS 不配本地媒体上传。Markdown / `cover` 写完整 `https://...` URL。
4. **页脚不挂备案号**。
5. 经典 Pages 界面：只有 Build command + Build output=`dist`，**没有** Deploy command；闸门用 `functions/`，不要改成依赖 `npx wrangler deploy` 的 Workers SPA 形态（曾导致全路径回退首页、Functions 失效）。
6. `wrangler.toml` 仅作 Pages 声明：`pages_build_output_dir = "dist"`。
7. 参考站 https://jasonai.me 只借信息架构，**视觉不要复刻**暖米色 + Inter；本站方向：编辑部学刊风（宋体标题 + 黑体正文 + JetBrains Mono，强调色印章朱红 `#C6462F`）。
8. 中文字体需子集化 + `font-display: swap`。
9. 不提交密钥、不提交 `ssl/`、不提交 `console.log`。
10. Windows / PowerShell 环境；commit 用 PowerShell here-string 或普通 `-m`，勿用 bash HEREDOC。

---

## 4. 当前仓库结构（相关部分）

```
personal_website/
  src/
    config/site.ts          # 站点名、URL、备案备查
    pages/index.astro       # 占位首页（待替换）
    pages/gate.astro        # Turnstile 闸门（保持极简）
    env.d.ts
  functions/                # Cloudflare Pages Functions（闸门，勿挪出）
    _middleware.ts
    api/turnstile-verify.ts
    _lib/gate.ts
  public/
    __deploy_probe.txt
  wrangler.toml             # pages_build_output_dir = dist
  package.json              # astro；scripts: dev / build / preview
  AGENTS.md                 # 本文件
  README.md                 # 简短入口
```

**尚不存在、需要新建：**

```
src/content.config.ts
src/content/blog/*.md
src/content/library/*.md
src/layouts/
src/components/
src/styles/                 # tokens.scss、global.scss 等
public/admin/               # 若做 Sveltia CMS
```

---

## 5. 未完成（按优先级做）

### P0 — 站点本体

- [ ] 视觉 token 与全局样式（浅/深色；宋体标题、黑体正文、JetBrains Mono；朱红强调 `#C6462F`；背景 `#FCFCFA` / `#101114`）
- [ ] 站点骨架：顶栏导航、深色模式（无闪烁）、页脚（**无备案号**）、移动端适配；文案继续走 `src/config/site.ts`
- [ ] Content Collections：`blog` + `library`，zod schema；`draft: true` 构建期排除；`slug` 写在 frontmatter
- [ ] 首页：分区总览（简介、最近更新、资料入口、标签云等），**不要**参考站那种可拖拽画布
- [ ] `/blog`、`/library`：列表 + 构建期分页 + 标签筛选入口
- [ ] `/blog/[slug]`、`/library/[slug]`：正文约 768px 栏宽、右侧粘性目录（移动端抽屉）、阅读进度、字数/阅读时长、代码复制与语言标签、上一篇/下一篇、同标签相关阅读、可下载 Markdown 原文
- [ ] 示例文章若干（OSS 图床 URL 演示即可）

### P1

- [ ] Pagefind 站内搜索（中文可用）
- [ ] `/tags/[tag]`、`/categories/[category]`、`/archive`、`/about`
- [ ] RSS、sitemap、OG、JSON-LD、404、robots.txt
- [ ] Sveltia CMS（`public/admin/config.yml` 与 content schema **字段必须同步**）+ GitHub OAuth 中转；封面/图只填 OSS URL
- [ ] `library` 的 `attachments[]` 仅外链（OSS/网盘），不进 Git

### P2

- [ ] 浏览量统计（外链服务选型）
- [ ] 图片 lightbox、置顶/专栏、评论方案评估
- [ ] 若大陆访问实测不可接受，再单独立项评估国内镜像（会重新引入服务器，勿擅自开做）

---

## 6. 内容模型约定（实现 Collections 时用）

**blog：** `title`、`slug`、`summary`、`publishedAt`、`updatedAt`、`category`、`tags[]`、`cover`（OSS URL）、`draft`、`featured`

**library：** 同上 + `attachments[]`（名称 + 外链 URL）、`sourceUrl`

正文示例：

```markdown
![说明](https://你的OSS域名/path/xxx.png)
```

---

## 7. 验收清单（站点做完时）

- [ ] `npm run build` 通过；故意写错 frontmatter 能被 schema 拦住
- [ ] 无痕访问首页仍先过 `/gate/`；验证后进站
- [ ] `/gate/` 仍为极简 Turnstile（不要加回大卡片装饰）
- [ ] `__deploy_probe.txt` 仍为 `deploy-ok`
- [ ] 深色模式状态矩阵；禁用 JS 后正文/列表仍可读
- [ ] 长文目录高亮、阅读进度、代码复制正常
- [ ] 移动端窄屏可用
- [ ] 页脚无备案号；图片均为外链

---

## 8. 参考

- 参考站（结构参考，勿抄视觉）：https://jasonai.me
- Cloudflare Pages 自定义域文档；Turnstile siteverify API
- 旧 Cursor 计划文件已废弃，以**本文件**为准
