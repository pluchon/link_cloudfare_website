# 游戏画册与站内画廊扩展绘图提示词（GPT 专用）

> 本文件用于指导 GPT 生成并上传两类美术资源：
> 1. **游戏画册（`/game/` 各 5 格）**：补齐《果冻 2048》最后 2 格主题插画/海报（前 3 格已接入实机满井截图），以及《鹈鹕骑车》全套 5 格主题插画/概念海报。
> 2. **主站画廊（`/gallery/`）**：新增 5 组诺诺插画、四格漫画、常服设定与游戏厅海报提示词，严格沿用 `nuonuo_role` 既有角色锚点。

---

## 公共角色与画风锚点（生成诺诺相关画面时必读）

- **核心参考图**：如当前工具支持多图参考，生成诺诺画面时优先附带 `nuonuo_role/character/standard.png` 与 `nuonuo_role/character/avatar.png`；如果生成「小萌」暖系插画，保持与 `jelly-2048` 既定小萌形象一致（琥珀棕瞳、双丸子系浅紫发带、杏色长袜、红白猫耳耳机或头戴物、日系绘本水彩感或清晰赛璐璐）。
- **诺诺唯一耳型**：头顶一对白毛粉内耳猫耳，脸颊两侧由白色长发自然垂落衔接，**绝不出现人类耳朵或耳垂**。
- **诺诺固定发饰与尾饰**：
  - 五瓣粉色小花夹 + 淡紫发带固定在诺诺**自身右侧**（正面视角为**画面左侧**）。
  - 白色卷尾靠近尾尖处系粉色缎带，下方垂挂一枚玫瑰粉小圆铃铛。
- **线条与色彩**：温润细紫色描边（`#5B4378` 一带），平涂大色块加简洁柔和阴影，干净通透、无噪点、无混乱纹理。
- **比例与上传格式**：
  - 画册全部按 **16:10 横图** 生成（建议输出分辨率 `1600×1000` 或 `1280×800`，导出 **WebP q90** 上传 OSS，这样在画册卡片 `aspect-ratio: 16 / 10` 中零黑边裁切）。
  - 画廊作品按对应提示词注明比例（16:9 / 4:3 / 3:4 / 2:3 或透明底 PNG），上传后填入 `src/config/site.ts`（`gameAlbums`）或 `src/content/gallery.json`。

---

## 一、游戏画册：《果冻 2048》待补 2 张（Slots 04–05）

> 说明：Slots `01`、`02`、`03` 已使用新版实机截图 `live-01.webp`～`live-03.webp` 接入 `src/config/site.ts`。以下 2 张补足第 `04`、`05` 格，上传后直接把 URL 填进 `gameAlbums['/game/jelly-2048/'][3].src` 与 `[4].src`。

### Slot 04｜双冻相撞・Q 弹合成瞬间

- **对应条目标题**：`双冻相撞・Q 弹合成瞬间`
- **推荐 OSS 对象路径**：`personal_website_picture/game/jelly-2048/album/20261113/art-04.webp`
- **参考输入**：可参考 `nuonuo_role/character/game-portrait.png` 或小萌 Q 版造型

```text
Use case: stylized-concept (16:10 wide game album illustration, clean modern 2D anime cel shading, warm storybook lighting).
Scene: Close-up cheerful moment inside the bright cream-paper desk world of the physics puzzle game "Jelly 2048".
A tall clear frosted-glass 2D vertical physics well stands at center-right, packed full at the bottom with glossy translucent jelly cubes in pastel berry-pink, peach, mint, amber, and sky-blue colors showing crisp white number badges (2, 4, 8, 16, 32, 64).
Right at the top of the pile inside the glass well, two squishy rounded amber "64" jelly cubes bounce together mid-collision, squashing softly and glowing in a tiny celebratory burst of pastel sparkles as they begin to merge into a larger golden "128" jelly cube.
To the left of the glass well, cute chibi cat-girl Nuonuo leans happily against the outside glass wall, hands pressed against the rim with wide excited violet eyes watching the merge. Keep her exact identity: pale lilac-white long hair, ONLY two white-and-pink cat ears on top with zero human ears, a pink five-petal blossom clip and lavender ribbon on her anatomical right temple (viewer-left), white sailor blouse with lavender striped collar and bow.
Soft warm cream notebook-grid background with gentle mint/coral desk accents, crisp fine linework, soft translucent highlights inside every jelly block, ZERO text banner, ZERO watermark, ZERO UI buttons.
```

### Slot 05｜深夜桌面・玻璃井微光

- **对应条目标题**：`深夜桌面・玻璃井微光`
- **推荐 OSS 对象路径**：`personal_website_picture/game/jelly-2048/album/20261113/art-05.webp`

```text
Use case: stylized-concept (16:10 wide cozy atmospheric concept poster for "Jelly 2048", clean anime editorial illustration style).
Scene: Late-night study desk viewed from a gentle three-quarter isometric angle in a dimly lit cozy room bathed in soft indigo-violet night shadows (`#17161B`) and warm amber lamp glow.
At the center of the desk sits an illuminated transparent glass prism well filled to 70% height with dozens of glowing translucent pastel jelly cubes stacked snugly together (mint 2, sky 4, peach 8, coral 16, lavender 32, warm gold 64, radiant pearl 128), casting soft colorful caustics onto the dark wood desk and nearby open graph-paper notebook.
Beside the glass well rests a small matte-black fountain pen, a pair of tiny cat-paw keycaps, and a warm ceramic mug of tea giving off subtle wisps of steam.
In the soft warm rim-lit foreground corner, a miniature white curled cat tail tip with a tiny rose-pink ribbon and bell peeks neatly near the edge of a coaster, hinting at Nuonuo playing nearby.
Minimalist geometric aesthetic with subtle hairline framing feeling, luminous subsurface scattering on the translucent jellies, NO words, NO logos, NO clutter, clean edges.
```

---

## 二、游戏画册：《鹈鹕骑车》全套 5 张（Slots 01–05）

> 说明：以下 5 张严格对照 `src/game/pelican/` 真实玩法与美术设定编写：**朱红（`#C6462F`）车架单车 + 编织前筐、白羽深灰翼尖（`#3D3F49`）圆润胖鹈鹕、橙黄大嘴与伸缩喉囊（`#F2A23A` / `#F8C766`）、三车道海滨/峡谷/樱花/霓虹/极光赛道、红白三档跳台、弹簧垫、红辣椒无限冲刺、金环与金鱼**。上传后依次写入 `gameAlbums['/game/pelican-ride/'][0..4].src`。

### Slot 01｜红架单车・鹈鹕出发（概念海报）

- **对应条目标题**：`红架单车・鹈鹕出发`
- **推荐 OSS 对象路径**：`personal_website_picture/game/pelican-ride/album/20261113/art-01.webp`

```text
Use case: stylized-concept (16:10 widescreen clean stylized 3D-inspired editorial illustration / game key art poster).
Subject: A plump, expressive white pelican riding a bright vermilion-red steel-framed classic bicycle (`#C6462F`) fitted with a rustic woven wicker front basket and shiny silver handlebars.
The pelican has crisp geometric low-poly-inspired clean planes with smooth stylized shading: snowy white rounded body, dark charcoal-slate wingtips (`#3D3F49`) gripping the handlebars, determined cute round eyes, and a long golden-orange beak (`#F2A23A`) with a cheerful soft-yellow throat pouch holding one tiny shimmering gold fish sticking halfway out.
Pose & Camera: Dynamic three-quarter front-right heroic tracking shot on a sunlit coastal three-lane asphalt road with crisp white dashed lane dividers and red-and-white curbstones.
Background: Sparkling turquoise ocean on the left, warm sandstone coastal cliffs on the right, bright clear daytime sky with crisp sunlit clouds and subtle speed-wind lines around the spinning spoked wheels.
Clean refined Japanese stylized vector-3D hybrid aesthetic, vibrant focal vermilion red against cool sea cyan, ZERO text, ZERO title logo, ZERO HUD overlay.
```

### Slot 02｜三档跳台・峡谷飞跃

- **对应条目标题**：`三档跳台・峡谷飞跃`
- **推荐 OSS 对象路径**：`personal_website_picture/game/pelican-ride/album/20261113/art-02.webp`

```text
Use case: stylized-concept (16:10 widescreen dynamic action illustration for "Pelican Ride").
Scene: Mid-air stunt jump! The plump white pelican on its vermilion-red bicycle with woven wicker basket has just launched high off a sleek three-tier striped launch ramp painted in teal, amber, and vermilion chevron markings along a cliffside coastal highway.
Right below the soaring bicycle and pelican stretches a dramatic sunlit canyon road curve beside bright cerulean sea waves, leading straight toward a stone cliff tunnel archway in the distance.
The pelican leans forward excitedly over the handlebars, wing feathers fanned out for balance, wind streaming past its red bike frame, and a row of floating shiny silver souvenir tokens arcing through the air along the jump trajectory right ahead of the front wheel.
Crisp sunlit shadows, fresh geometric stylized modeling feel, exhilarating height and motion blur only on the background cliff edges, ZERO text, ZERO watermark.
```

### Slot 03｜红辣椒冲刺・炽热赛道

- **对应条目标题**：`红辣椒冲刺・炽热赛道`
- **推荐 OSS 对象路径**：`personal_website_picture/game/pelican-ride/album/20261113/art-03.webp`

```text
Use case: stylized-concept (16:10 widescreen high-speed arcade illustration for "Pelican Ride").
Scene: Sunset neon-palm highway sprint! The plump white pelican on its vermilion-red bicycle has just chomped a glowing bright red chili pepper, triggering blazing infinite-sprint mode.
From the rear wheel and exhaust trail burst sleek stylized orange-gold and crimson comic flame ribbons (`#FF5A2E`, `#FFB74D`), propelling the bicycle past a row of tall tropical palm silhouettes and sleek minimalist glowing sunset arches lining the three-lane track.
The pelican puffs its cheeks slightly while wide-eyed with thrilled determination, pedals spinning in a bright blur, while floating golden energy soda cans glitter just ahead in the center lane.
Warm dusk gradient sky from apricot-coral to deep twilight violet (`#2B233D`), sharp clean stylized lighting, dynamic radial speed streaks, ZERO text, ZERO UI counters.
```

### Slot 04｜樱花风道・金圈衔鱼

- **对应条目标题**：`樱花风道・金圈衔鱼`
- **推荐 OSS 对象路径**：`personal_website_picture/game/pelican-ride/album/20261113/art-04.webp`

```text
Use case: stylized-concept (16:10 widescreen whimsical spring-airborne illustration for "Pelican Ride").
Scene: Bouncing straight off a bright striped roadside spring pad below, the white pelican and its vermilion-red bicycle soar gracefully through a fluttering cloud of soft pink sakura blossoms alongside a sunlit cherry-tree boulevard.
Directly ahead in mid-air floats a gleaming circular golden ring hoop with a plump sparkling gold fish hovering right at its center. The pelican stretches its neck forward and opens its huge golden-orange beak and elastic throat pouch wide, mere inches from snapping up the flying gold fish cleanly inside the hoop.
Soft spring afternoon light, drifting pink flower petals catching sunlit rim highlights against crisp blue sky and gentle pastel clouds, joyful whimsical rhythm-arcade charm, ZERO text, ZERO watermark.
```

### Slot 05｜极光终点・夜航纪念章（概念海报）

- **对应条目标题**：`极光终点・夜航纪念章`
- **推荐 OSS 对象路径**：`personal_website_picture/game/pelican-ride/album/20261113/art-05.webp`

```text
Use case: stylized-concept (16:10 widescreen serene night-stage finale concept poster for "Pelican Ride").
Scene: Under a sweeping velvet night sky lit by shimmering emerald-green and violet aurora ribbons (`#3CE3B5`, `#8E6CEB`) above calm polar sea water dotted with crisp faceted icebergs, the white pelican coasts smoothly along the illuminated starry roadway on its vermilion-red bicycle.
The bike's round chrome headlight beam cuts gently forward onto the asphalt lane markings. Inside the bicycle's front woven wicker basket sit three shiny metallic gold souvenir badges and two cute plump goldfish tails peeking up cozily, while the pelican's orange pouch looks contentedly full.
A peaceful finish archway glows softly ahead on the horizon with twinkling festival string lights.
Refined atmospheric night contrast, crisp faceted low-poly charm blended with smooth painterly sky glow, ZERO text, ZERO watermark.
```

---

## 三、主站画廊 `/gallery/` 扩展插画提示词（5 张）

> 说明：主站 `src/content/gallery.json` 目前支持六个分类标签：`插画`、`漫画`、`海报`、`角色立绘`、`常服设定`、`头像特写`。以下 5 张涵盖场景插画、四格漫画、常服三件套设定、活动海报与日系氛围图。上传后写入 `personal_website_picture/nuonuo_gallery/<日期>/...webp` 并追加条目到 `src/content/gallery.json`。

### 1. 【插画】黑洞观测甲板的下午茶（16:9 横图）

- **分类 (`category`)**：`插画`
- **推荐 OSS 路径**：`personal_website_picture/nuonuo_gallery/20261113/aurora-tea-deck.webp`
- **设计思路**：联动站点 `/door/` 门户页的黑洞空间站设定，把硬核科幻观景甲板变成诺诺吃甜点写日志的日常角落。

```text
Use case: stylized-concept (16:9 widescreen character scene illustration, clean warm anime cel shading with crisp fine purple linework).
Input 1 is the character reference for Nuonuo (`character/standard.png`): preserve her round cute face, large violet eyes, pale lilac-white long hair with rounded bangs, a five-petal pink blossom hairclip and lavender ribbon on her anatomical right temple (viewer-left), ONLY two white cat ears with pink inner ears on top (NO human ears beside cheeks), white-and-lavender sailor uniform, and her curled white tail tipped with a pink ribbon and rose-pink bell.
Scene: Inside the sleek minimalist observation deck of an orbital space station (`nuonuoya` base portal motif). A huge floor-to-ceiling geometric observation window dominates the background, framing a luminous golden-orange relativistic accretion-disk black hole surrounded by a delicate starry Milky Way arc.
In the warm softly lit indoor foreground, Nuonuo sits comfortably at a thin hairline-metal café table near the window, resting her chin in one hand while holding a silver spoon beside a tall glass strawberry parfait and an open minimalist hardcover notebook with a fountain pen. Her curled white tail swishes happily behind her chair.
Warm cozy indoor rim light contrasting gently against the deep starfield outside, serene scholarly daydream vibe, NO text, NO watermark.
```

### 2. 【漫画】半夜调 Bug 四格：从破防到绿灯（2:3 竖版 2×2 四格漫画）

- **分类 (`category`)**：`漫画`
- **推荐 OSS 路径**：`personal_website_picture/nuonuo_gallery/20261113/midnight-debug-4koma.webp`
- **设计思路**：贴合站长日常写 Astro + WebGL + Three.js 的真实开发乐趣，补强画廊里目前较稀缺的 `漫画` 分类。

```text
Use case: comic-panel (2:3 vertical crisp 4-panel Japanese 2x2 yonkoma manga page with clean thin dark-purple hairline borders `#4E3D66` on cream paper).
Input 1 is the identity reference for chibi cat-girl Nuonuo (`character/standard.png` / `character/avatar.png`): pale lilac-white long hair, violet eyes, ONLY top cat ears (never human ears), right-temple pink five-petal flower clip + lavender ribbon (viewer-left when facing forward), white-and-lavender sailor outfit, pink bell on tail tip.
Panel 1 (top-left): Late night at the desk under a warm lamp. Nuonuo's cat ears flatten sideways in comical frustration as she stares at a laptop screen covered in tiny red warning squiggles; a comical little spiral doodle floats above her head.
Panel 2 (top-right): Close-up "eureka" snap! Both cat ears pop straight upright with crisp sparkle stars around her head as she taps one tiny finger against a sticky note with a hand-drawn bracket diagram.
Panel 3 (bottom-left): Triumphant lean-back! Both arms raised in a cheerful "V" victory pose while the laptop monitor glows softly with crisp green checkmarks cleanly lined up in a row.
Panel 4 (bottom-right): Cozy cooldown. Nuonuo is fast asleep folded peacefully over her desk pillow cradling a plump toy plush gold fish, one cat ear twitching happily and tail curled around her chair.
Zero speech-bubble English/Chinese garbled words — use clean universal comic symbols only (`!`, `?`, `✓`, sparkles, Zzz doodles), crisp fine purple ink contours, clean cel tones.
```

### 3. 【插画】梅雨书店檐下的透明伞（4:3 横图）

- **分类 (`category`)**：`插画`
- **推荐 OSS 路径**：`personal_website_picture/nuonuo_gallery/20261113/rainy-eaves-umbrella.webp`
- **设计思路**：呼应站内文章里反复出现的雨声元素（`rain02` 音乐主题），营造温润透明的纸媒水景氛围。

```text
Use case: stylized-concept (4:3 editorial anime scene illustration, soft atmospheric cel shading with delicate crisp purple outlines).
Input 1 is the character reference for Nuonuo (`character/standard.png`): preserve her exact pale lilac-white long hair, violet eyes, pink five-petal flower clip and lavender ribbon on her anatomical right temple (viewer-left), ONLY two cat ears on top with zero human ears, white-and-lavender sailor uniform, and white tail with pink bow and bell near the tip.
Scene: Just after light afternoon rain outside a quiet Japanese-inspired independent bookstore with dark timber sliding doors and vermilion-painted hairline signboard accent (`#C6462F` color touch on an unlabelled wooden shop lantern/eaves trim).
Nuonuo stands under the sheltered stone step holding a clear vinyl transparent umbrella tilted casually over one shoulder with droplets beading along the plastic dome. Wearing her sailor uniform plus thin translucent rain-cardigan sleeves, she peeks upward with one hand outstretched to catch a falling raindrop off the eaves, smiling softly as the wet stone pavement reflects warm golden window light from inside the bookshop.
Her curled white tail with pink bell peeks delicately beside her pleated lavender skirt.
Peaceful translucent rain mood, gentle cool periwinkle blue shadows paired with warm amber shop glow, ZERO text, ZERO watermark.
```

### 4. 【常服设定】秋日焦糖开衫与贝雷帽设定页（透明底 PNG，建议 `cutout: true`）

- **分类 (`category`)**：`常服设定`
- **推荐 OSS 路径**：`personal_website_picture/nuonuo_gallery/20261113/autumn-beret-outfit.webp`
- **设计思路**：扩充 `常服设定` 分类的换装库，同时明确处理猫耳避让贝雷帽斜戴的细节；上传后在 `gallery.json` 里设置 `"cutout": true` 以适配画廊悬浮透明裁切卡片效果。

```text
Use case: character-sheet (1:1 or 4:5 transparent-background full-body character outfit turnaround sheet + small accessory callouts, pure transparent PNG alpha channel, NO backdrop paper).
Input 1 & 2 reference Nuonuo (`character/standard.png` and `outfits/spring-outing.png`): keep exact chibi proportions, round face, violet eyes, pale lilac-white long hair, ONLY two cat ears on top (NO human ears beside cheeks), right-temple pink five-petal blossom clip + lavender ribbon (viewer-left), and white curled tail with pink satin bow + rose-pink bell near tip.
Outfit Design ("Cozy Autumn Editorial"):
- Soft cream turtleneck knit inner sweater with tidy ribbed cuffs.
- Warm caramel-oatmeal oversized cable-knit cardigan left open, with two wooden buttons and subtle tiny cat-paw embroidery stitched near one pocket.
- Muted plum-lavender checked pleated midi skirt, dark espresso tights, and shiny chestnut-brown low-heel strap loafers.
- Tilted softly to her left side (between her two cat ears without flattening or covering either ear!) sits a charming muted grape-violet wool beret pinned with a tiny brass crescent brooch.
Pose & Layout: Center main standing full-body pose looking warmly forward with one hand holding a small leather-bound sketchbook; neatly spaced beside her on the transparent canvas are isolated small callout illustrations of the folded beret, knit cardigan pocket detail, and strap loafer shoe.
Crisp uniform purple ink contours, flat clean cel shading, pure transparent background, ZERO text labels.
```

### 5. 【海报】诺诺的游戏厅周末特辑海报（3:4 竖版印刷风海报）

- **分类 (`category`)**：`海报`
- **推荐 OSS 路径**：`personal_website_picture/nuonuo_gallery/20261113/arcade-weekend-poster.webp`
- **设计思路**：串联本轮《果冻 2048》与《鹈鹕骑车》两款小游戏，为画廊添一张高完成度 3:4 竖版手账印刷风宣传海报。

```text
Use case: editorial-poster (3:4 vertical Japanese independent magazine / zine exhibition poster composition, hairline geometric grid layout on warm cream paper `#FBF8F3`).
Input 1 is the character reference for Nuonuo (`character/standard.png`): preserve her exact pale lilac-white long hair, large violet eyes, pink five-petal blossom clip + lavender ribbon on her anatomical right (viewer-left), ONLY top cat ears (NO human ears), white-and-lavender sailor uniform, and white tail with pink bow + rose-pink bell.
Poster Composition: Clean minimalist 1px vermilion-red (`#C6462F`) and slate-ink editorial framing with subtle dot-matrix corner registration marks and clean paper whitespace.
Centerpiece: Cheerful waist-up pose of Nuonuo in an energetic showcase gesture—one hand cradling a miniature glossy glass cube jar filled with tiny colorful smiling jelly blocks (`Jelly 2048` homage), and the other hand presenting a cute miniature red-framed toy bicycle carrying a tiny round white-and-orange plush pelican figurine (`Pelican Ride` homage).
Surrounding framing vignettes in tidy crisp rectangular hairline boxes along the corners show simple iconic silhouettes of four-point stars, a cat paw stamp, pixel sparkles, and dashed race-track stripes.
Crisp purple line-art, fresh coral-vermilion + pastel-lavender + cream palette, zero garbled faux-typography, ZERO unreadable small text, clean print-poster graphic elegance.
```

---

## 四、GPT 生成完图片后的接入速查清单

1. **《果冻 2048》画册第 04、05 格**：
   - 将图片转为 WebP 后上传至 `personal_website_picture/game/jelly-2048/album/20261113/art-04.webp`、`art-05.webp`。
   - 打开 [`src/config/site.ts`](../src/config/site.ts)，在 `gameAlbums['/game/jelly-2048/']` 第 4、5 个对象里分别加上 `src: '${JELLY_2048_ALBUM_DIR}/art-04.webp'` 和 `art-05.webp`。
2. **《鹈鹕骑车》画册第 01–05 格**：
   - 上传 5 张 WebP 至 `personal_website_picture/game/pelican-ride/album/20261113/art-01.webp` ～ `art-05.webp`。
   - 在 [`src/config/site.ts`](../src/config/site.ts) 新增 `PELICAN_ALBUM_DIR` 常量，并将地址依次填入 `gameAlbums['/game/pelican-ride/']` 的 5 个条目的 `src`。
3. **主站画廊 `/gallery/` 扩展**：
   - 上传 5 张 WebP 至 `personal_website_picture/nuonuo_gallery/20261113/...webp`。
   - 按 `src/content/gallery.json` 现有格式追加作品对象（注意 `秋日焦糖开衫与贝雷帽设定页` 若为透明底 PNG 转 lossless/alpha WebP，可设 `"cutout": true`）。
