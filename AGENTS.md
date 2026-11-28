# 项目说明（给后续 AI / 开发者）

> 本文件是本仓库**唯一**的架构与约束说明；以下描述的是**当前已上线现状**，动手前先看第 3 节硬约束。

---

## 1. 项目概览

个人博客 + 学习资料站（纯静态、无登录态、无数据库、无评论区）。

| 项 | 值 |
|----|-----|
| 站点名 | 儒雅的诺诺的学习基地 |
| 副标题 | AI Coding 与日常学习的分享 |
| 正式 URL | `https://www.nuonuoya.cn`（主站用 `www`） |
| GitHub | `git@github.com:pluchon/link_cloudfare_website.git`（分支 `main`） |
| 托管 | Cloudflare Pages 项目 `link-cloudfare-website`（推 `main` 约 1 分钟自动上线） |

---

## 2. 基建与环境

- Astro 5 静态站（`output: 'static'`），`npm run build` 先跑 `scripts/unshallow.mjs` 再生成 `dist/`（Cloudflare Pages 为浅克隆，补全 git 历史失败则中止构建）。
- **运行时依赖只有 `astro` 与 `three`**：手写 RSS / sitemap、首页背景 WebGL2 着色器；`three` **仅允许**在门户页 `/door/`（含嵌入式 3D 书房 `/door/#study`）、`pelican-ride` 与 `cosmic-roam` 使用，其他页面禁止 import。
- `astro.config.mjs` 的 `vite.optimizeDeps.include` 预构建了 `three` 及全站用到的一批 `three/addons/*` 子模块；若本地 `astro dev` 运行期间执行过 `build` 或重优化导致 `504 Outdated Optimize Dep`，停掉 dev、删 `node_modules/.vite` 再重启即可。
- `public/_routes.json` 将 `/_astro/*` 等静态资源目录排除在 Pages Functions 之外以节省免费调用额度；新增纯静态资源目录时记得同步加入。
- **DNS 与 Turnstile 闸门**：阿里云 DNS **NS 不迁入 Cloudflare**（`www` CNAME → Pages，裸域 `@` 301 → `www`，保留 `_dnsauth` TXT）。闸门逻辑全在 `functions/` 内（`functions/_middleware.ts` + `functions/api/turnstile-verify.ts` + `functions/_lib/gate.ts`，签名工具必须留在 `functions/` 内），`src/pages/gate.astro` 只保留居中 Turnstile，无装饰卡片。两项 Secret 未配齐时故意放行；本地 `astro dev` 不跑 Functions。探针：`public/__deploy_probe.txt` → `deploy-ok`。

**Pages 环境变量**：`PUBLIC_TURNSTILE_SITE_KEY`、`TURNSTILE_SECRET_KEY`（Secret）、`GATE_COOKIE_SECRET`（Secret）、`NODE_VERSION=22`。

---

## 3. 硬约束（必须遵守）

1. **纯静态 Astro + Markdown**，无后端、无自建数据库（游戏成绩仅存 `localStorage`）。
2. **阿里云 NS 保持不动**；`wrangler.toml` 仅保留 `pages_build_output_dir = "dist"`；不改成 Workers SPA deploy 形态（会导致 Functions 失效与全路径回退首页）。
3. **图片 / 音频一律 OSS 图床外链**，不建 `public/uploads/`、不用 R2；Markdown 里写完整 `https://...` URL。
4. **不加载任何 Web 字体**（含 `/door/` 装饰字母也走系统栈），零 FOUT、零外部字体请求。
5. **全站发丝线视觉**：仅用 1px 发丝线分隔，禁用卡片阴影、大圆角、大色块、渐变填充；朱红 `#C6462F` 仅用于交互反馈。
6. **动效仅响应交互或滚动，禁用自循环 `@keyframes`**（仅三处例外：首页连线流光点、首页 `TargetCursor` 空闲慢转、`/door/` 吸积盘旋转）。时长走 `--dur-1/2/3` + `--stagger` token；`prefers-reduced-motion` 下压缩时长而非一刀切 `animation: none`。
7. 不提交密钥、不提交 `ssl/`、不提交 `console.log`；Windows PowerShell 下提交 commit 使用普通 `-m` 或 PowerShell here-string，不用 bash HEREDOC。

---

## 4. 零 frontmatter 内容管线与路由

`src/loaders/plain-markdown.ts` 直接从 Markdown 推断元信息，**文章不写 frontmatter**（格式模板见 `src/content/{content,profile,notice,game}_format.md`）：

| 元信息 | 来源 |
|--------|------|
| 标题 / 简介 | 第一个 `#` 一级标题 / 紧跟标题的首个 `>` 引用块（正文后续引用不受影响） |
| 分类 / 草稿 | 所在子文件夹名 / 文件名以 `_` 开头 |
| 日期 | 元信息区 `date: YYYY-MM-DD[ HH:mm]`（按 `Asia/Taipei`） > 文件名 `YYYY-MM-DD-` > `git log --follow` 首次提交 > mtime |
| 标签 / 封面 | 任意 `tags: [甲, 乙]` / 元信息区首图或正文首图 |
| 外链与媒体 | `github:`（多仓库可加名称前缀）、`bilibili:`、`music:`（OSS `personal_website_music/`）、`speech:`（OSS `personal_website_speech/`） |

- **发布时间手写规则**：每篇文章带 `> date:`，改错字或修图链**不要顺手改 `date` 行**，仅重大更新由用户手动改；`gitDate()` 遇 `.git/index.lock` 竞争失败时重试并回退缓存，不轻易回退 mtime。
- **集合与路由**：`project` / `tool` / `explore` / `daily` / `xiaomeng` 保持目录名、集合名、URL 三者严格一致；`profile` → `/about/`、`notice` → `/notice/`；新增分类同步改 5 处：`content.config.ts`、`lib/content.ts`、`config/site.ts`、`pages/<kind>/`、`sitemap.xml.ts`。分类改名由 `functions/_middleware.ts` 的 `RENAMED` 表 301 重定向。

---

## 5–6. 首页、门户与 3D 书房（约束摘要；现状详述见 `docs/site-architecture.md`，改这些模块前先读）

- 3D 书房（`/door/#study`）嵌在 `/door/` 的单一 WebGL 场景里：不单设 URL、不开第二块画布；资源清单 `src/room/assets.json`，由 `src/room/*` 载入。
- 首页 `/`：禁止 `.node > *` 通配子选择器；量坐标用 `offsetLeft` 链（`boxIn`），不用 `getBoundingClientRect`；缩放前先终止进行中的过渡；手风琴收起分支必须在 `fit()` 重算前保存并精确还原展开前视口；封面走 `?x-oss-process=style/thumb`，超过 14 条连线不生成流光点；`TargetCursor` 仅在 `(hover: hover) and (pointer: fine)` 的首页启用。
- `/door/`：`sky()` 在片元着色器里只保留单一调用点，用无分支权重混色主题；终端数据构建时写入，禁止改用 iframe（`_headers` 的 `X-Frame-Options: DENY`）；像素比升档门槛不低于 `16.7ms`（建议 `>= 18ms`）；灯光必须 `layers.enable(IMAGE_LAYER)`；`STAR_NODES` 由 `/door/` 与 `cosmic-roam` 共用。

---

## 7. 其余页面与全站通用规范

- **列表 / 搜索 / 标签**：五个分类与 `/tags/[tag]/` 共用 `ListLayout`（每页 5 条）+ 构建期预编码零字典检索（`devDependencies` 的 `pinyin-pro` 经 `src/lib/search-index.ts` 按上下文生成逐字拼音序列并写入首屏索引与懒加载 `/search/<kind>.json`，客户端 `src/lib/search-engine.ts` 支持繁简全半角逐字折叠、全拼/首字母/中拼混输、注音 `ㄅㄆㄇㄈ` 实时折算、普通话模糊音及短字段 Damerau-Levenshtein 拼写容错，并精准 `<mark>` 高亮回原汉字下标）；`PageBackdrop` 不加模糊和额外遮罩，统一 `quality,q_85`；`/tags/` 单页不分页（老链接 `/tags/page/N/` 由中间件 301），拼音首字母分组默认展示 3 行并复用同一套检索与高亮筛选。
- **详情页与音频**（`ArticleLayout` + `MusicBar`）：`preload="none"` 点前不下载，伴奏循环、朗读播完即停，换页时务必停掉旧音频，合成脚本在 `scripts/speech/`；禁跳动音柱。
- **公告栏**（`NoticeLayout`、`src/content/notice/`）：仅从顶栏小铃铛进入（不进 `ContentKind`/导图/RSS）；三栏布局，`tags` 含「置顶」置前，铃铛红点与 `NEW` 共用 `data-new-since` 按最新一篇 24h 内客户端计算；支持 ```` ```xiaomeng ```` / ```` ```post ```` / ```` ```link ```` 嵌入；正文图共用 `lightbox.ts` 放大（头图及外链图不放大）。
- **Markdown 渲染约束**：
  - ```` ```mermaid ```` 经 `remark-mermaid` 转为 `<pre class="mermaid">`，由 `MermaidRenderer.astro` 懒加载 jsDelivr ESM，配 **`htmlLabels: false`** 防裁切；**严禁定义全局 `.label` 工具类**，否则劫持 Mermaid 节点文字（本站此类改用 `.eyebrow`）；图内边标签避免裸写 `<`/`>`。
  - 触屏下代码块改为折叠 `22rem` + 展开按钮，不用内部 `overflow-y` + `overscroll-behavior: contain` 以免吃掉页面滑动。

---

## 8. 游戏大厅（`/game/`）与画廊（`/gallery/`）

均仅从顶栏图标进入，不进 `ContentKind`/导图/RSS。

- **游戏与画廊约束**（详述见 `docs/site-architecture.md`）：
  - 游戏成绩仅存 `localStorage`；重生成音频前先关闭本地游戏页；用 `py -3.14` 跑 `scripts/game-audio/upload.py`（星海漫游加 `--game cosmic`）覆盖传 OSS 并带 `?v=`，`scripts/game-audio/out/` 不入库。
  - 鹈鹕骑车：自定义几何体必须有法线；点光源复用 `world.lamp`；画质只降不升。星海漫游：黑洞周边保持真实天体结构，不摆奇幻石碑；星点 `MIN_POINT = 5.0`、不加时间 `shimmer`、`coreSigma >= 0.62` px；手机 DPR 起步 `0.95`、上限 `1.3`（升档门槛 `18ms`）。
  - 画廊：清单 `src/content/gallery.json`，分类限定 `插画`/`漫画`/`海报`/`角色立绘`/`常服设定`/`头像特写`；透明底设定设 `cutout: true`；每条 `summary` 单行（约 24～32 字、不超过 36 字）；角色设定与常服不画「call-out 拆分图」，统一画完整穿戴效果。
- **角色设定与生图作画规范**（`nuonuo_role/` 与 `xiaomeng_role/`）：
  - **画风底线**：精致日漫 Q 版赛璐璐风（温润细紫描边、干净清透平涂与柔和光影），**零颗粒噪点、零纸纹杂斑、零脏影**。
  - **姐妹锚点**：姐姐诺诺为浅紫白及腰长发、纯紫瞳、仅头顶一对白猫耳（无人类耳）、自身右侧（正面看画面左侧）五瓣粉花夹 + 淡紫发带、白卷尾尖系粉缎带与玫瑰粉圆铃铛；亲妹妹小萌矮半头、及肩微卷发 + 头顶小呆毛、同款白猫耳无人类耳、自身左侧（正面看画面右侧）四瓣小白花夹 + 柔粉发带、尾尖柔粉蝴蝶结 + 浅金星形铃铛；同框严禁画反长幼或串饰。
  - **尾巴自然度**：正/侧/背三视图及场景图中，猫尾巴必须从腰后尾椎、裙摆下缘自然探出（背面由裙摆自然遮住尾根），**严禁像贴纸一样直接粘在衣服表面**。
  - **表情与氛围**：日常插画/漫画/头像优先使用鲜活卡哇伊的猫娘小表情（小得意挑眉、纯紫瞳内星形高光、俏皮小虎牙笑、饱满柔粉腮红、软萌眯眼害羞笑），可少量点缀四角星芒、淡紫猫爪印与小爱心；借鉴外部梗图时**仅参考神态与装饰，严禁混入外部角色特征**（不异瞳、不串角色）。
  - **生图工作流**：经 OpenRouter `POST /api/v1/images`（密钥读用户环境变量 `OPENROUTER_API_KEY`，不落盘、不打印）调用 GPT Image 2.6：`openai/gpt-image-2.6-flare` 快速出构图草稿，`openai/gpt-image-2.6-sunburst` 出定稿与多轮一致性编辑；角色设定图经 `input_references`（base64 data URL，最多 16 张）作身份锚点，交代简洁自然的中文要求让模型自主构思细节；临时成图放 `test-output/`，记录每张返回的 `usage.cost`；成图须逐张目视复核，透明底设定（`background: transparent` + png/webp）额外校验 RGBA Alpha 通道。

---

## 9. 发布验收清单

- [ ] `npm run build` 无报错，`git status` 无 `console.log` / 密钥 / 本地临时音频图产物
- [ ] 无痕访问经 `/gate/`（极简居中）验证进站；`__deploy_probe.txt` 为 `deploy-ok`
- [ ] 四套主题色 × 深浅色完整，首页思维导图拖拽缩放、手风琴展开/收起精确还原、`TargetCursor` 正常
- [ ] 375px / 320px 窄屏无横向溢出；列表搜索、标签拼音分组、文章目录/Mermaid/MusicBar、公告红点与嵌入卡片正常
- [ ] `/door/`、三款小游戏桌面与触屏均正常渲染、无控制台与 WebGL 报错，所有图片/音频均为 OSS 外链

---

## 10. 参考

- 线条骨架气质参考（不抄暖米色与字体）：https://jasonai.me
- Cloudflare Pages 自定义域 & Turnstile siteverify 文档
