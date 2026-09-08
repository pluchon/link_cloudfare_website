# 项目说明（给后续 AI / 开发者）

> 本文是本仓库**唯一**的说明文件。站点已经建成并在线运行，下面写的是**现状**，不是待办。
> 动手前先读第 3 节的硬约束——其中有几条是用户当面推翻过早期方案定下来的，不要照旧习惯改回去。

---

## 1. 项目是什么

个人博客 + 学习资料站。纯静态，无登录态、无数据库、无评论区。

| 项 | 值 |
|----|-----|
| 站点名 | 儒雅的诺诺的学习基地 |
| 副标题 | AI Coding 与日常学习的分享 |
| 正式 URL | `https://www.nuonuoya.cn`（主站用 www） |
| GitHub | `git@github.com:pluchon/link_cloudfare_website.git`（分支 `main`） |
| 托管 | Cloudflare Pages 项目 `link-cloudfare-website` |

**日常同步：** 改代码 → `git push origin main` → 约 1 分钟 Pages 自动构建上线。

---

## 2. 基建现状（勿重复建设）

- Astro 5 静态站（`output: 'static'`），`npm run build` 产出 `dist/`
- **零运行时依赖**：`dependencies` 里只有 `astro` 一个。RSS / sitemap 是手写 endpoint，
  背景着色器是手写 WebGL2，都没引第三方库
- Cloudflare Pages ↔ GitHub 自动部署（Build: `npm run build`，Output: `dist`，`NODE_VERSION=22`）
- 阿里云 DNS：**NS 不转 Cloudflare**；`www` CNAME → Pages 项目默认域名；
  裸域 `@` 显性 URL 301 → `https://www.nuonuoya.cn`；保留 `_dnsauth` TXT
- HTTPS 由 Cloudflare 自动签发，无需自备 pem/pfx
- Turnstile 进站闸门：
  - `functions/_middleware.ts`：无有效 Cookie 则 302 → `/gate/`
  - `functions/api/turnstile-verify.ts`：校验 token，下发 HMAC 签名 Cookie（24h）
  - `functions/_lib/gate.ts`：签名与恒定时间校验（**必须放在 `functions/` 内**，Pages 打包器限制）
  - `src/pages/gate.astro`：**只保留居中 Turnstile**，无卡片/标题装饰——这是用户明确要的极简
- 探针：`public/__deploy_probe.txt` → 线上应为 `deploy-ok`

**Pages 环境变量（Production，已由用户配置）：**

| 变量 | 用途 |
|------|------|
| `PUBLIC_TURNSTILE_SITE_KEY` | 构建进 `/gate/` 前端 |
| `TURNSTILE_SECRET_KEY` | Function 调 siteverify（Secret） |
| `GATE_COOKIE_SECRET` | Cookie 签名（Secret） |
| `NODE_VERSION` | `22` |

两个 Secret 未配齐时中间件**故意不拦截**，避免把站点锁死。本地 `astro dev` **不跑** Pages Functions。

---

## 3. 硬约束（写代码时必须遵守）

1. **纯静态 Astro + Markdown**，无后端、无自建数据库。
2. **阿里云 NS 保持不动**；不要引导用户把域名整站迁入 Cloudflare DNS。
3. **图片一律 OSS 图床外链**，不建 `public/uploads`、不用 R2 存图。
   Markdown 里写完整 `https://...` URL。
4. 经典 Pages 界面：只有 Build command + Build output=`dist`，**没有** Deploy command；
   闸门用 `functions/`，不要改成依赖 `npx wrangler deploy` 的 Workers SPA 形态
   （曾导致全路径回退首页、Functions 失效）。
5. `wrangler.toml` 仅作 Pages 声明：`pages_build_output_dir = "dist"`。
6. **不加载任何 Web 字体**，用系统字体栈（宋体标题 / 黑体正文 / 等宽元信息）。
   早期方案写的是「中文字体子集化 + `font-display: swap`」，**已废弃**：
   子集化会掉生僻字，全量思源单字重 8MB+，而系统栈零外部请求也没有 FOUT。
   代价是各平台字形略有差异，判断是「差异不是问题，抖动才是」。
7. **视觉：全站只用 1px 发丝线做分隔。** 禁用卡片阴影、圆角、色块、渐变；
   层级靠字体族区分，不靠字号堆叠；朱红 `#C6462F` 只出现在交互反馈上，不做面积填充。
8. **动效只能是对操作或滚动的回应，禁用自动播放的 `@keyframes` 循环**
   （首页连线上的流光点是唯一例外）。时长收敛成 token：`--dur-1/2/3` + `--stagger`，
   页面里不要写死毫秒数。`prefers-reduced-motion` 下压缩时长，不要 `animation: none` 一刀切。
9. 不提交密钥、不提交 `ssl/`、不提交 `console.log`。
10. Windows / PowerShell 环境；commit 用 PowerShell here-string 或普通 `-m`，勿用 bash HEREDOC。

---

## 4. 内容管线：零 frontmatter

**这是本仓库最容易被改错的地方。** 早期方案要求在 frontmatter 里写
`title` / `slug` / `publishedAt` / `draft` 等字段，**已被用户当面推翻**。
现在所有元信息由 `src/loaders/plain-markdown.ts` 从文件本身推断，Markdown 里**不写 frontmatter**：

| 元信息 | 来源 |
|--------|------|
| 标题 | 第一个 `#` 一级标题 |
| 简介 | 紧跟标题的第一个 `>` 引用块（正文里后续的引用块不受影响） |
| 分类 | 所在子文件夹名 |
| 日期 | 文件名 `YYYY-MM-DD-` 前缀 > git 最后提交时间 > 文件 mtime |
| 标签 | 任意一行 `tags: [甲, 乙]`，`、` 和 `,` 都认 |
| 封面 | 元信息区的第一张图，没有就取正文第一张 |
| 草稿 | 文件名以 `_` 开头 |

标题、简介、标签这三行会从正文里剔除，不会重复渲染。格式模板见
`src/content/article_info_profile_format.md` 和 `src/content/profile_format.md`。

**日期那条有坑**：`gitDate()` 失败时**绝不能退回 mtime**。仓库开了 `core.autocrlf`，
`git commit` 会规范化换行、顺带把文件 mtime 改成当下，而此时 `.git/index.lock` 还占着、
git 查询必然失败——两者一撞，加一篇新文章会把所有老文章的日期改写成今天。
现在的实现是失败重试一次，仍失败就用缓存值，只有 git 可用且确实查不到记录时才用 mtime。

### 集合与路由

目录名、集合名、URL 三者严格一致——因为分类是从文件夹名推断的，不一致极难排查。

| 目录 | 集合 | 路由 |
|------|------|------|
| `src/content/article/` | `article` | `/article/` |
| `src/content/info/` | `info` | `/info/` |
| `src/content/xiaomeng/` | `xiaomeng` | `/xiaomeng/` |
| `src/content/daily/` | `daily` | `/daily/` |
| `src/content/profile/` | `profile` | `/about/`（**故意不一致**：它是关于页正文，不是内容分类） |

`/tags/` 是跨集合聚合页，没有对应目录。加新分类要同步改五处：
`content.config.ts`、`lib/content.ts` 的 `ContentKind` / `AnyEntry` / `getAllPublished`、
`config/site.ts` 的 `nav` 与 `branches`、`pages/<kind>/` 四个路由文件、`sitemap.xml.ts`。

---

## 5. 首页：可拖拽的思维导图画布

早期方案写的是「分区总览，**不要**参考站那种可拖拽画布」。
用户看到成品后当面推翻：「agent.md 规则说不可以拖动，但是我还是觉得拖动好看一点」。
**以现在的实现为准。**

- 宽屏：不滚动的整屏画布，一张横向生长的思维导图
  （根卡片 → 四个分类 → 每类最新 5 篇 → 标签），可拖拽平移、可缩放
- 窄屏（≤ 60rem）：同一套 DOM 翻成**竖向缩进树**，连线保留，页面回到正常滚动
- 每类超过 5 篇时，列末补一张虚线卡片「还有 N 篇 · 查看全部」
- 缩放：右下角控件、Ctrl/⌘ + 滚轮（以光标为锚点）、`Ctrl +/-/0`；
  普通滚轮平移，Shift + 滚轮横向平移
- 展开某一支会自动聚焦过去；**收起时必须精确还原展开前的视图**
  （倍率和平移都要在 `fit()` 之前存下来，`fit()` 会按新布局重算并覆盖 `scale`）

### 首页改动的几个雷区

- **不要用 `.node > *` 这类通配子选择器。** Astro 作用域会给通配符也加上属性选择器，
  特异性变成 0,3,0，会压过 `.knob` 的绝对定位。要写具体类名。
- **量卡片位置必须用 `offsetLeft` 链（`boxIn`），不能用 `getBoundingClientRect`。**
  后者会把入场动画的 `translateX` 和画布的 `scale` 一起算进去。
- **缩放前要先把进行中的过渡掐掉并逼到终值**，否则量到的是动画中间态，锚点会算歪。
- 首页封面走 OSS 缩略图样式 `?x-oss-process=style/thumb`（480px / webp / q75）；
  列表页和详情页用原图。全展开时这一项把流量从 18.6MB 压到 98KB。
- 性能：辉光伪元素只给当前悬浮的那张卡生成；`.node` 上没有 `backdrop-filter`；
  连线超过 14 条就不再创建流光点（每个点都会让整层 SVG 每帧重绘）。

---

## 6. 其余页面

- **列表页**（四个分类共用 `ListLayout`）：封面 + 标题行 + 客户端搜索框 + 条目列表 + 构建期分页（每页 5 条）
- **详情页**（`ArticleLayout`）：左侧卷轴式目录（< 93rem 隐藏）、阅读进度、
  代码复制与语言标签、上一篇/下一篇、同标签相关阅读、Markdown 原文下载
- **`/tags/`**：每页 48 个，标签名过长时截断（格子要 `min-width: 0`，
  否则 `text-overflow` 不生效）；`/tags/[tag]/` 是单个标签的聚合
- **`/about/`**：正文来自 `src/content/profile/`，技能标签取自那篇 md 的 `> tags:` 行
- 搜索是客户端过滤内嵌的 JSON 索引，**没有**引入 Pagefind
- RSS、sitemap、404、robots.txt 均已就位

### 全站已定的细节

- 视口滚动条全站隐藏（写在 `<html>` 上，写 `body` 无效）
- 触屏下代码块**不做内部竖向滚动**，改成折叠 22rem + 「展开全部」按钮。
  竖向滚动会吃掉手指的翻页手势——真正的元凶是 `overscroll-behavior: contain`
  配上 `overflow-y: hidden`（后者仍是滚动端口，只是范围为零），两者一撞页面就滚不动
- ` ```mermaid ` 代码块会渲染成图：remark 插件先把它换成 `<pre class="mermaid">`
  绕开 Shiki，再由 `MermaidRenderer.astro` 从 jsDelivr 懒加载 ESM 入口（30KB，
  按图类型拉分块）。这是全站**唯一**的第三方运行时脚本，将来若启用 CSP
  要给 `script-src` 放行 `cdn.jsdelivr.net`
- 全局 `.label` 工具类会劫持 mermaid 的节点文字（同名 class），图内已单独还原
- 画布拖动光标是自绘 SVG，深浅两套——原生 `grab` 手跟随系统光标主题，浅色底上会看不见

---

## 7. 验收清单

- [ ] `npm run build` 通过
- [ ] 无痕访问首页仍先过 `/gate/`；验证后进站
- [ ] `/gate/` 仍为极简 Turnstile（不要加回卡片装饰）
- [ ] `__deploy_probe.txt` 仍为 `deploy-ok`
- [ ] 深浅色状态矩阵：页面、悬浮、禁用态、代码块、图片失败态
- [ ] 首页导图：展开 / 收起 / 拖动 / 缩放；收起后视图精确还原
- [ ] 窄屏 375 与 320：无横向溢出，导航单行不折字
- [ ] 长文目录高亮、阅读进度、代码复制、mermaid 渲染
- [ ] 图片均为外链

---

## 8. 参考

- 参考站（**只借线条骨架气质**，不抄它的暖米色 + Inter）：https://jasonai.me
- Cloudflare Pages 自定义域文档；Turnstile siteverify API
