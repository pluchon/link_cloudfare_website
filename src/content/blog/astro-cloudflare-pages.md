---
title: Astro + Cloudflare Pages：推一次 main 就自动上线
slug: astro-cloudflare-pages
summary: 从 GitHub 推送到线上更新只需要一分钟，中间没有任何服务器。顺手记下踩过的两个坑。
publishedAt: 2026-09-03
category: 工程
tags:
  - Astro
  - Cloudflare
  - 前端
---

整条链路很短：

```text
本地 → git push origin main → GitHub → Cloudflare Pages 构建 → www.nuonuoya.cn
```

没有服务器，没有数据库，没有 CI 配置文件。Pages 在后台监听仓库，检测到 `main` 有新提交就跑一次 `npm run build`，把 `dist/` 推到边缘节点。

## 配置只有三行

在 Pages 的项目设置里：

- Build command: `npm run build`
- Build output directory: `dist`
- 环境变量 `NODE_VERSION` = `22`

就这些。**不要**填 Deploy command — 那是 Workers 形态的字段，填了会让 Pages 走另一条部署路径。

## 坑一：SPA 回退把所有路径吃掉了

如果启用了 SPA fallback，`/blog/xxx/` 这种路径会全部回退到 `index.html`，看起来像是路由挂了。静态站不需要这个开关。

## 坑二：Functions 必须放在 functions/ 里

Pages Functions 的打包器只扫描仓库根目录的 `functions/`，共享代码也得放在里面：

```
functions/
  _middleware.ts
  _lib/gate.ts       ← 放到 src/ 里会打包失败
  api/verify.ts
```

把工具函数挪到 `src/lib/` 会构建成功但运行时找不到，属于那种不看日志排不出来的错。

## 内容更新的日常

写文章就是往 `src/content/blog/` 扔一个 `.md`：

```markdown
---
title: 标题
slug: url-slug
summary: 一句话摘要
publishedAt: 2026-09-05
category: 分类
tags: [标签]
---

正文……
```

frontmatter 写错了构建会直接失败 — zod schema 在构建期拦下来，不会带着坏数据上线。这比运行时报错好得多。
