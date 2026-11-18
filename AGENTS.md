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
- **运行时依赖只有 `astro` 与 `three`**：手写 RSS / sitemap、首页背景 WebGL2 着色器；`three` **仅允许**在门户页 `/door/`、`pelican-ride` 与 `cosmic-roam` 使用，其他页面禁止 import。
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

## 5. 首页思维导图画布（`/`）

- 宽屏为不滚动整屏横向可拖拽/缩放思维导图（`TargetCursor.astro` 仅在首页 `(hover: hover) and (pointer: fine)` 启用，纯 `rAF` 逼近无 gsap）；窄屏（`≤ 60rem`）同一套 DOM 翻转为可滚动竖向缩进树。
- **文章书架手风琴**：同层同时仅展开一支；展开分类后右侧显示最新 5 篇三列竖卡（超过 5 篇末尾附「还有 N 篇」虚线卡），卡片标签用 `clampTags` 限制最多两行 +「+N」；面板右上角「全部 N 篇」使用 `.shelf__all`（避免 `.text-link` 等宽字体导致数字与汉字大小不一）；收起分支必须在 `fit()` 重算前保存并精确还原展开前视口。
- **背景与缩放**：昼夜插画由 `site.homeBackdrop` 配置，按 `left center` 裁切、加 32%（窄屏 48%）底色遮罩与 3% 拖拽视差，根卡保持左侧不变；顶部通栏高度用 `syncInset` 动态让出。
- **首页踩坑约束**：禁止 `.node > *` 通配子选择器（Astro 作用域叠加会压过 `.knob` 绝对定位）；量坐标用 `offsetLeft` 链（`boxIn`）而不用 `getBoundingClientRect`；缩放前先终止进行中的过渡；首页封面走 `?x-oss-process=style/thumb`，超过 14 条连线不生成流光点。

---

## 6. 门户页（`/door/`）与斯隆长城星图

- **进站分流与加载衔接**：新会话首次落在 `/` 时由 `BaseLayout` 跳转 `/door/`（仅看 `sessionStorage['nn-entered']`）；开场「校准星图」进度条在 `door.astro` 内按阶段推进至 `compileAsync` 完成；点黑洞或探测器后穿过视界切入 `src/door/loader.ts` 网格加载画面，跳转前写 `nn-arrive` 并通过共享 `src/styles/warp.css` 无缝渐隐衔接。
- **全程序生成 3D 黑洞与透镜光学**：
  - `src/door/shaders.ts` 为全屏光线步进着色器，包含黑洞吸积盘（9 秒时间窗双相交叠防摩尔纹）、多普勒光子环、银河与星云（仅在片区内计算）；`sky()` 在片元着色器**仅保留单一调用点**并用无分支权重 `t0..t4` 混色 5 套主题，避免 GLSL 编译膨胀。
  - **星点抗闪烁与景深平衡**：`starLayer` 使用 6 面等角立方体贴图 2D 晶格消除 3D 斜切半星，并在 `sky()` 前分支外限幅 `gPixAng = clamp(length(fwidth(skyRd)) * 0.7071, 0.0005, 0.0028)` 保护核宽 `coreW = max(size, px * 0.76)`（仅 `mag > 0.05` 亮星展开星冕、暗星零光晕呈针尖点，配合 `cellFade` 防出格）；`sky()` 使用 `scale = 68 / 148`，`starCluster` 复用平滑星层消除 `floor(d * 620)` 摩尔闪烁。
  - 几何体（空间站 `station.ts`、小行星 `rocks.ts`、探测器 `orbits.ts`、外围景物 `realms.ts`）通过 `warp.ts` 顶点透镜公式与主shader对齐，`renderSecondaryImages` 用图层 1 + `gl.frontFace(gl.CW)` 渲染次像（手机端跳过），全屏黑洞着色器写 `gl_FragDepth` 处理遮挡；灯光必须开启 `layers.enable(IMAGE_LAYER)`。
  - 像素比自动调档的升档门槛**不能低于 `16.7ms`**（建议 `>= 18ms`），避免 60Hz 屏锁死降档。
- **斯隆长城五系星图与终端**：`starmap.ts` 定义 `base` / `tags` / `gallery` / `about` / `game` 五座四层落差枢纽；`realms.ts` 为各星域提供单次 `InstancedMesh` 科学浮标/碎岩/浑仪星环；终端数据在构建时写入（禁止改用 iframe，受 `_headers` `X-Frame-Options: DENY` 限制）；双击飞回甲板需恢复 `minDistance=0`、结清阻尼并插值视线方向。

---

## 7. 其余页面与全站通用规范

- **列表 / 搜索 / 标签**：五个分类与 `/tags/[tag]/` 共用 `ListLayout`（每页 5 条）+ 客户端搜索（首屏前 500 字即时搜、聚焦后懒拉 `/search/<kind>.json` 全文索引；逐字折叠全半角而不用整段 `NFKC`，避免省略号错位）；`PageBackdrop` 不加模糊和额外遮罩，统一 `quality,q_85`；`/tags/` 单页不分页（老链接 `/tags/page/N/` 由中间件 301），拼音首字母分组默认展示 3 行。
- **详情页与音频**（`ArticleLayout` + `MusicBar`）：`preload="none"` 点前不下载，伴奏循环、朗读播完即停，换页时务必停掉旧音频，合成脚本在 `scripts/speech/`；禁跳动音柱。
- **公告栏**（`NoticeLayout`、`src/content/notice/`）：仅从顶栏小铃铛进入（不进 `ContentKind`/导图/RSS）；三栏布局，`tags` 含「置顶」置前，铃铛红点与 `NEW` 共用 `data-new-since` 按最新一篇 24h 内客户端计算；支持 ```` ```xiaomeng ```` / ```` ```post ```` / ```` ```link ```` 嵌入；正文图共用 `lightbox.ts` 放大（头图及外链图不放大）。
- **Markdown 渲染约束**：
  - ```` ```mermaid ```` 经 `remark-mermaid` 转为 `<pre class="mermaid">`，由 `MermaidRenderer.astro` 懒加载 jsDelivr ESM，配 **`htmlLabels: false`** 防裁切；**严禁定义全局 `.label` 工具类**，否则劫持 Mermaid 节点文字（本站此类改用 `.eyebrow`）；图内边标签避免裸写 `<`/`>`。
  - 触屏下代码块改为折叠 `22rem` + 展开按钮，不用内部 `overflow-y` + `overscroll-behavior: contain` 以免吃掉页面滑动。

---

## 8. 游戏大厅（`/game/`）与画廊（`/gallery/`）

均仅从顶栏图标进入，不进 `ContentKind`/导图/RSS。

- **游戏大厅与画册**：每款游戏一份 `src/content/game/*.md`（正文即规则，含点列写成嵌套列表，有 `play:` 才可玩）；`site.ts` 中 `gameAlbums` 配五格「上两大下三小」或九格实机画册（`1280×800` WebP，同名覆盖 OSS 后需更新 `?v=` 破一年强缓存）；成绩均存 `localStorage`。
- **共享游戏音频流水线**：`src/game/audio-cache.ts` 封装 `Cache Storage` 按游戏前缀与 `audio.json` 的 `version` 分格存储并淘汰旧缓存；音频由 `scripts/game-audio/{pelican,cosmic}.py` 基于真实采样渲染进 `scripts/game-audio/out/`（不入库），用 **`py -3.14` 跑 `scripts/game-audio/upload.py`（星海漫游加 `--game cosmic`）** 覆盖传 OSS 并带 `?v=`，桶已配 CORS；**重生成音频前先关闭本地游戏页**，防止热更新用旧 OSS 文件写入新版本 Cache。
- **果冻 2048**（`src/game/jelly/`）：手写位置动力学软体，Web Audio 现场合成。
- **鹈鹕骑车**（`src/game/pelican/`）：16 个 900m 随机顺序三车道场景（过门后 130m 才渐变天色灯光），含跳台/弹簧/斜板/断桥深沟/崖壁溶洞；`EffectComposer` 泛光 + `ATMOSPHERE` + `NeutralToneMapping`，所有自定义几何体必须确保有法线，点光源复用 `world.lamp` 不现建，四档画质仅降不升；支持 `?scenes=...` 与开发钩子 `window.__pelican`。
- **星海漫游**（`src/game/cosmic/`）：
  - 基于门户页 5 系星图与 `COSMOS_SCALE = 11.5`、`HOLE_SCALE_MULT = 5.4` 缩放，开局洗牌 5 星系顺序并二分求得恒定 `~745 Mpc` 曲线航道；含共面分子尘埃、双极喷流、18 座涡旋星门、3 段开普勒/奥伯特黑洞引力弹弓及 25 件藏品（拾取后就地缩小抛物线飞入「图鉴」按钮）。黑洞周边保持真实天体结构，不摆奇幻石碑或漂浮雕塑。
  - **星点与移动端规范**：`world.ts` 星点保留 `MIN_POINT = 5.0` 给高斯留足边距、移除时间 `shimmer`，片元传未钳制真实视尺寸 `vTruePx`，保持白热峰值 `1.0`（`coreSigma >= 0.62` px）并按真实比例 `haloMask` 仅在亮星展开彩晕、远星呈纯净针尖点，线性 `vec4(tint, a)` 传给 `AdditiveBlending`；触屏遥测留在左下（`HUD_TEXT_INTERVAL = 160`ms 节流刷新 + 脏检查），固定摇杆浮在遥测上方、`曲速` 键在右下、`雷达` 在右上；`WARP_RESUME = 0.2` 防止耗尽临界闪烁；手机 DPR 起步 `0.95`、上限 `1.3`（升档门槛 `18ms`）；支持开发钩子 `window.__cosmic`。
- **画廊**（`/gallery/`）：清单在 `src/content/gallery.json`，页面 `GalleryView.astro` 按允许的分类校验（`插画`/`漫画`/`海报`/`角色立绘`/`常服设定`/`头像特写`），网格走 OSS `thumb` 样式，透明底设定设 `cutout: true`；**后续角色设定与常服不画旁侧拆解服装配件的「call-out 拆分图」**，统一画完整穿戴效果。

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
