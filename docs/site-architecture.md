# 站点实现现状详述

> 从 AGENTS.md 迁出的第 5、6 节和第 8 节游戏/画廊部分的原文，改相关模块前按需阅读；硬约束摘要仍在 AGENTS.md。

## 5. 双形态主页：3D 书房（`/door/#study`）与思维导图画布（`/`）

- **3D 基地书房（`/door/#study`，不单设新 URL）**：由 `src/room/scene.ts`（`createStudyRoomModule`）直接嵌入 `/door/` 的单一 WebGL 场景与渲染循环中（与门户共享同一套 `WebGLRenderer`/`Scene`/`Camera`/`OrbitControls` 及窗外同一尊真光线步进紫粉黑洞，无双画布、无假天空盒）。采用 Blender 5.3 实体建模（含开放外侧 `0.48m` 观景栏杆、放样工学无线鼠标、48 段圆滑花盆与心形龟背竹叶片）+ 统一全房零重叠 UV 打包下的 Cycles 烘焙 AO / 真空宇宙高对比光影贴图（`scripts/room-blender/{build_room,extract_book_colors,upload}.py` 产出并托管 OSS `personal_website_other/room/`，清单在 `src/room/assets.json`），运行期由 `src/room/{types,themes,textures,books,scene}.ts` 载入。悬停功能家具以 `EdgesGeometry` 沿模型真实轮廓勾勒 1px 高亮边线；点击望远镜进入圆形光学目镜视角（`.scope-hud`，支持 `← 离开目镜` | `抵近黑洞跃迁 →`）；点击背景黑洞或「观测甲板」直飞前方同一尊紫粉黑洞并展示「通过黑洞跃迁到基地」；五格书柜按真实文章数 1:1 动态陈列精装书（色值缓存于 `src/room/book-colors.json`），展开为带内联 SVG 纸纤维与叠页书口的 3D 纸质墨色阅读册（左页无滚动条可滚长目录 + 50/50 底部操作按钮，合上平滑退回全景，兼容 375px / 320px 零溢出）。
- **思维导图画布（`/`）**：宽屏为不滚动整屏横向可拖拽/缩放思维导图（`TargetCursor.astro` 仅在首页 `(hover: hover) and (pointer: fine)` 启用，纯 `rAF` 逼近无 gsap）；窄屏（`≤ 60rem`）同一套 DOM 翻转为可滚动竖向缩进树。
- **文章书架手风琴**：同层同时仅展开一支；展开分类后右侧显示最新 5 篇三列竖卡（超过 5 篇末尾附「还有 N 篇」虚线卡），卡片标签用 `clampTags` 限制最多两行 +「+N」；面板右上角「全部 N 篇」使用 `.shelf__all`（避免 `.text-link` 等宽字体导致数字与汉字大小不一）；收起分支必须在 `fit()` 重算前保存并精确还原展开前视口。
- **背景与缩放**：昼夜插画由 `site.homeBackdrop` 配置，按 `left center` 裁切、加 32%（窄屏 48%）底色遮罩与 3% 拖拽视差，根卡保持左侧不变；顶部通栏高度用 `syncInset` 动态让出。
- **首页踩坑约束**：禁止 `.node > *` 通配子选择器（Astro 作用域叠加会压过 `.knob` 绝对定位）；量坐标用 `offsetLeft` 链（`boxIn`）而不用 `getBoundingClientRect`；缩放前先终止进行中的过渡；首页封面走 `?x-oss-process=style/thumb`，超过 14 条连线不生成流光点。

---

## 6. 门户页（`/door/`）与斯隆长城星图

- **进站分流与加载衔接**：新会话首次落在 `/` 时由 `BaseLayout` 跳转 `/door/`（仅看 `sessionStorage['nn-entered']`）；开场「校准星图」进度条在 `door.astro` 内按阶段推进至 `compileAsync` 完成；点基地黑洞直接穿越视界进入思维导图主页 `/`（探测器进各分类），跳转前写 `nn-arrive` 并通过共享 `src/styles/warp.css` 无缝渐隐衔接。从 `/door/` 内书房（底栏图标、背景黑洞或望远镜目镜）抵近黑洞时，相机在同一 `/door/` 场景与 URL 下直飞窗外同一尊紫粉黑洞事件视界前方并显示「通过黑洞跃迁到基地」，点击即触发黑洞俯冲返回 `/`。
- **全程序生成 3D 黑洞与透镜光学**：
  - `src/door/shaders.ts` 为全屏光线步进着色器，包含黑洞吸积盘（9 秒时间窗双相交叠防摩尔纹）、多普勒光子环、银河与星云（仅在片区内计算）；`sky()` 在片元着色器**仅保留单一调用点**并用无分支权重 `t0..t4` 混色 5 套主题，避免 GLSL 编译膨胀。
  - **星点抗闪烁与景深平衡**：`starLayer` 使用 6 面等角立方体贴图 2D 晶格消除 3D 斜切半星，并在 `sky()` 前分支外限幅 `gPixAng = clamp(length(fwidth(skyRd)) * 0.7071, 0.0005, 0.0028)` 保护核宽 `coreW = max(size, px * 0.76)`（仅 `mag > 0.05` 亮星展开星冕、暗星零光晕呈针尖点，配合 `cellFade` 防出格）；`sky()` 使用 `scale = 68 / 148`，`starCluster` 复用平滑星层消除 `floor(d * 620)` 摩尔闪烁。
  - 几何体（空间站 `station.ts`、小行星 `rocks.ts`、探测器 `orbits.ts`）通过 `warp.ts` 顶点透镜公式与主shader对齐，`renderSecondaryImages` 用图层 1 + `gl.frontFace(gl.CW)` 渲染次像（手机端跳过），全屏黑洞着色器写 `gl_FragDepth` 处理遮挡；灯光必须开启 `layers.enable(IMAGE_LAYER)`。
  - 像素比自动调档的升档门槛**不能低于 `16.7ms`**（建议 `>= 18ms`），避免 60Hz 屏锁死降档。
- **斯隆长城六系星图、书房与终端**：`starmap.ts` 中 `STAR_NODES` 统一包含 `base` / `gallery` / `tags` / `about` / `game` / `study`（`DOOR_STAR_NODES = STAR_NODES`，5 条拉尼亚凯亚引力流）供 `/door/` 与 `cosmic-roam` 共用；终端数据在构建时写入（禁止改用 iframe，受 `_headers` `X-Frame-Options: DENY` 限制）；双击飞回甲板或退出望远镜目镜需恢复 `minDistance=0`、结清阻尼并插值视线方向。


## 游戏大厅（`/game/`）与画廊（`/gallery/`）详述

- **游戏大厅与画册**：每款游戏一份 `src/content/game/*.md`（正文即规则，含点列写成嵌套列表，有 `play:` 才可玩）；`site.ts` 中 `gameAlbums` 配五格「上两大下三小」或九格实机画册（`1280×800` WebP，同名覆盖 OSS 后需更新 `?v=` 破一年强缓存）；成绩均存 `localStorage`。
- **共享游戏音频流水线**：`src/game/audio-cache.ts` 封装 `Cache Storage` 按游戏前缀与 `audio.json` 的 `version` 分格存储并淘汰旧缓存；音频由 `scripts/game-audio/{pelican,cosmic}.py` 基于真实采样渲染进 `scripts/game-audio/out/`（不入库），用 **`py -3.14` 跑 `scripts/game-audio/upload.py`（星海漫游加 `--game cosmic`）** 覆盖传 OSS 并带 `?v=`，桶已配 CORS；**重生成音频前先关闭本地游戏页**，防止热更新用旧 OSS 文件写入新版本 Cache。
- **果冻 2048**（`src/game/jelly/`）：手写位置动力学软体，Web Audio 现场合成。
- **鹈鹕骑车**（`src/game/pelican/`）：16 个 900m 随机顺序三车道场景（过门后 130m 才渐变天色灯光），含跳台/弹簧/斜板/断桥深沟/崖壁溶洞；`EffectComposer` 泛光 + `ATMOSPHERE` + `NeutralToneMapping`，所有自定义几何体必须确保有法线，点光源复用 `world.lamp` 不现建，四档画质仅降不升；支持 `?scenes=...` 与开发钩子 `window.__pelican`。
- **星海漫游**（`src/game/cosmic/`）：
  - 基于门户页 6 系星图（含 `study` 书房星系）与 `COSMOS_SCALE = 11.5`、`HOLE_SCALE_MULT = 5.4` 缩放，开局洗牌外围星系顺序并二分求得恒定 `~8600` 单位曲线航道；书房星系外围偏移摆放轻量悬浮 3D 书房地标，航线掠过角与样条推离算法（`studyCabinPos`）确保飞船不穿过书房本体；含共面分子尘埃、双极喷流、18 座涡旋星门、3 段开普勒/奥伯特黑洞引力弹弓及 29 件藏品（含书房星域 4 件，拾取后就地缩小抛物线飞入「图鉴」按钮）。黑洞周边保持真实天体结构，不摆奇幻石碑或漂浮雕塑。
  - **星点与移动端规范**：`ship.ts` 采用三层连续体积喷气式加力尾焰（外焰锥 + 内马赫环激波核 + 正交立体火焰翼，不用离散球状粒子）；`world.ts` 星点保留 `MIN_POINT = 5.0` 给高斯留足边距、移除时间 `shimmer`，片元传未钳制真实视尺寸 `vTruePx`，保持白热峰值 `1.0`（`coreSigma >= 0.62` px）并按真实比例 `haloMask` 仅在亮星展开彩晕、远星呈纯净针尖点，线性 `vec4(tint, a)` 传给 `AdditiveBlending`；触屏遥测留在左下（`HUD_TEXT_INTERVAL = 160`ms 节流刷新 + 脏检查），固定摇杆浮在遥测上方、`曲速` 键在右下、`雷达` 在右上；`WARP_RESUME = 0.2` 防止耗尽临界闪烁；手机 DPR 起步 `0.95`、上限 `1.3`（升档门槛 `18ms`）；支持开发钩子 `window.__cosmic`。
- **画廊**（`/gallery/`）：清单在 `src/content/gallery.json`，页面 `GalleryView.astro` 按允许的分类校验（`插画`/`漫画`/`海报`/`角色立绘`/`常服设定`/`头像特写`），网格走 OSS `thumb` 样式，透明底设定设 `cutout: true`；每条作品 `summary` 须控制在单行内（约 `24～32` 字、不超过 `36` 字），保证灯箱底栏不换行；**后续角色设定与常服不画旁侧拆解服装配件的「call-out 拆分图」**，统一画完整穿戴效果。
