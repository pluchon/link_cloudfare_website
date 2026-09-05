---
title: 本站 Frontmatter 字段速查
slug: markdown-frontmatter-cheatsheet
summary: 写文章前扫一眼：哪些字段必填、哪些有默认值、图片和附件该怎么放。
publishedAt: 2026-09-04
category: 约定
tags:
  - Astro
  - 约定
sourceUrl: https://docs.astro.build/en/guides/content-collections/
---

两个集合共用一套基础字段，`library` 多两个。

## 必填

| 字段 | 类型 | 说明 |
|------|------|------|
| `title` | string | 标题 |
| `slug` | string | URL 片段，决定 `/blog/<slug>/` |
| `summary` | string | 列表页和 OG 描述都用它 |
| `publishedAt` | date | `2026-09-05` 这种写法即可 |
| `category` | string | 单个分类 |

## 可选

| 字段 | 默认 | 说明 |
|------|------|------|
| `tags` | `[]` | 数组 |
| `updatedAt` | — | 有则在正文页显示「更新于」 |
| `cover` | — | **必须是 OSS 完整 URL** |
| `draft` | `false` | `true` 时构建期直接排除 |
| `featured` | `false` | 预留给首页置顶 |

`library` 额外支持 `attachments`（`name` + `url`）和 `sourceUrl`，同样只填外链。

## 图片怎么放

不建 `public/uploads`，不用 R2，一律传 OSS 后写完整 URL：

```markdown
![架构图](https://你的OSS域名/blog/2026/arch.png)
```

理由是仓库不该背二进制文件的历史 — 图片一旦提交进 Git 就永远删不干净，克隆速度会一路变慢。

> 附件同理：网盘链接或 OSS 直链都行，就是别进 Git。

## 草稿流程

写一半的文章加上 `draft: true`，正常提交推送，构建时会跳过，线上看不到。改成 `false` 再推一次就发布了。
