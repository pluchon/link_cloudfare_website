# 小萌绘图提示词

使用 Codex CLI（`gpt-6.1-sol` + 内置 `imagegen` 技能）制作。所有生成以姐姐诺诺原稿 `nuonuo_role/character/standard.png` 与 `nuonuo_role/character/avatar.png` 作为画风与家族脸型/发色锚点，再以小萌已定稿的 `xiaomeng_role/character/standard.png` 作为跨图唯一身份锚点。

## 公共约束（所有提示词必带）

- **日常表情**：小萌的日常插画、漫画和头像遵循[姐妹日常表情与装饰](../nuonuo_role/game-and-gallery-prompts.md#姐妹日常表情与装饰)。
- **姐妹血缘锚点**：完全复用诺诺的温润细紫描边（`#5B4378` 一带）、柔粉腮红、浅紫白丝滑发色与明亮紫瞳；仅头顶一对白底粉内耳的猫耳，脸侧由白发自然衔接，**绝不出现人类耳朵或耳垂**。
- **妹妹独有区分**：身形略小巧（约 3.6 头身）、及肩微蓬松微卷披发加头顶一缕俏皮短呆毛；发饰位于**小萌自身左侧（正面看画面右侧）**，是一枚林间四瓣白花夹配柔粉蝴蝶结发带；白色卷尾尖系柔粉蝴蝶结与一枚迷你淡金星形铃铛。
- **反颗粒与纯净画风**：`No grain, paper fibers, speckles, halftones, rough textures, or scattered dust; crisp warm-violet contours, clean color edges, broad soft pastel cel shading.`
- **构图禁区**：不绘制旁侧拆分单品图（no detached outfit callout sheets）。

---

## 1. 标准立绘（`character/standard.png`）

参考图：`nuonuo_role/character/standard.png`（Input 1，仅继承画风、脸型、猫耳与姐妹气质，改穿妹妹小萌的服装与发饰）。

```text
Use case: stylized-concept.
Create a clean single full-body anime character illustration of Xiaomeng, the younger biological sister of the white-haired cat-girl Nuonuo shown in input 1, on a pure solid crisp #FFFFFF white background (or true transparent alpha cutout) in portrait orientation.
Family resemblance from input 1: exact same chibi pastel anime style, fine continuous warm-violet ink contours (#5B4378), soft round cheeks with gentle pink blush, large expressive violet eyes, pale lilac-white silky hair, and ONLY one pair of triangular white cat ears with soft pink interiors atop the head (ZERO human ears or skin patches beside the cheeks).
Younger sister identity (distinct from input 1):
1. Slightly shorter, cuter compact ~3.6-head chibi proportion with a cheerful gentle smile, holding a small lavender hardcover storybook lightly against one hip with one hand and waving softly with the other hand.
2. Shoulder-length gently fluffy wavy lilac-white hair ending cleanly just below the shoulders, plus one small playful curved white ahoge strand at the crown.
3. Hair accessories on HER anatomical LEFT temple (VIEWER-RIGHT facing front — mirror opposite of input 1): one cute dainty four-petal white blossom hairclip with a warm yellow center and one soft pastel-pink ribbon tied neatly behind the hair on that same viewer-right side.
4. Tail: one fluffy white curled feline tail emerging behind her hip, tied near the tip with a small pastel-pink ribbon and one tiny soft pastel-gold star-shaped charm bell.
5. Outfit ("Fantasy Forest Storybook"): a cozy cream short-sleeve puff-sleeve blouse with a rounded Peter Pan collar edged with thin lavender-pink piping and a small pastel-pink bow at the collar; layered with a soft pastel-lavender pleated pinafore skirt featuring a dainty double-layered cream-and-lilac ruffled hem; white ankle socks with soft pink top stripes and shiny pastel-pink Mary Jane strap shoes.
Clean, crisp warm-violet outlines, broad smooth cel shading, no grain, no paper texture, no floor shadow, no text, no labels, no extra floating garment callouts. Keep full figure comfortably centered inside frame with generous white padding around ear tips and shoes.
```

---

## 2. Q 版头像（`character/avatar.png`）

参考图：Input 1 传 `xiaomeng_role/character/standard.png`，Input 2 传 `nuonuo_role/character/avatar.png`（匹配头像构图、光圈与比例）。

```text
Use case: stylized-concept.
Create a square 1:1 cute chibi headshot avatar of Xiaomeng using input 1 as the exact character identity and outfit reference, matching the exact composition, framing scale, and soft pastel aesthetic of input 2 (her older sister's avatar).
Preserve Xiaomeng's exact traits from input 1: pale lilac-white shoulder-length fluffy hair, small curved white ahoge curl at the crown, ONLY two white cat ears with pink interiors on top (ZERO human ears alongside cheeks), round cheeks, bright violet eyes, the dainty four-petal white blossom hairclip and pastel-pink ribbon on her anatomical left (VIEWER-RIGHT), and her cream Peter Pan collar blouse with lavender-pink piping and small pastel-pink chest bow.
Expression: happy sweet smile looking warmly at the viewer with both big sparkling violet eyes open (or gentle cheerful twinkle in eyes), hands hidden below frame.
Background: match input 2's soft pastel palette with a warm blush-pink background, a large smooth cream circle halo centered behind her head, and a single cute tiny pastel-lavender four-point sparkle doodle on the left side.
No text, no border frame, no watermark, no film grain, no paper fibers, clean color edges, broad soft cel shading.
```

---

## 3. 全身三视图（`character/turnaround.png`）

参考图：Input 1 传 `xiaomeng_role/character/standard.png`。

```text
Use case: stylized-concept.
Clean anime character turnaround reference sheet of Xiaomeng on a pure crisp #FFFFFF white background, wide landscape layout, matching input 1 with 100% consistency.
Draw exactly three equally spaced full-body standing views at identical height, foot baseline, ear-tip height, and ~3.6-head chibi scale from left to right:
1. Front orthographic view (both violet eyes visible, four-petal white flower clip and pastel-pink ribbon on VIEWER-RIGHT).
2. Right-facing side profile (strict side profile facing canvas right, one violet eye visible, curly ahoge at crown, fluffy shoulder-length wavy hair).
3. Back orthographic view (face hidden, fluffy shoulder-length hair mass visible with the pastel-pink hair ribbon tucked behind her anatomically left side / VIEWER-LEFT from the back, white curled tail with pink ribbon and tiny pale-gold star bell hanging naturally from the lower spine).
Mild tidy A-pose with both hands relaxed at sides (no book held in turnaround views).
Preserve exact outfit from input 1: cream puff-sleeve Peter Pan collar blouse with pink bow, lavender pleated pinafore skirt with cream-and-lilac ruffled hem, pink-striped white socks, and pastel-pink Mary Jane flats.
No human ears beside cheeks, no text labels, no arrows, no floating callouts, no ground shadow, no film grain or paper texture. Crisp warm-violet outlines and clean flat cel shading.
```

---

## 4. 亲姐妹合影（`character/sisters-portrait.png`）

参考图：Input 1 传 `nuonuo_role/character/standard.png`（姐姐诺诺），Input 2 传 `xiaomeng_role/character/standard.png`（妹妹小萌）。

```text
Use case: illustration-story.
Create a heartwarming wide editorial anime illustration of two biological cat-girl sisters standing happily side by side on a clean soft warm-ivory studio backdrop (#FFFBF7) with zero clutter.
On the LEFT stands older sister Nuonuo (exact identity and outfit from input 1): slightly taller ~4-head chibi proportion, long flowing pale lilac-white hair reaching her waist, pink five-petal blossom clip + lavender ribbon on HER right (viewer-left), white long-sleeve lavender-striped sailor uniform, lavender pleated skirt and shoes, and white curled tail with pink ribbon and rose-pink round bell.
On the RIGHT stands younger sister Xiaomeng (exact identity and outfit from input 2): visibly half-a-head shorter ~3.6-head chibi proportion, shoulder-length wavy fluffy pale lilac-white hair with small top ahoge curl, white four-petal blossom clip + pastel-pink ribbon on HER left (viewer-right, mirroring Nuonuo cleanly!), cream puff-sleeve Peter Pan blouse with pastel-lavender ruffled pinafore skirt, pastel-pink Mary Jane shoes, cradling her lavender storybook under her outer arm, and white curled tail with pastel-pink ribbon and tiny pale-gold star charm bell.
Pose: Nuonuo warmly drapes one arm lightly around Xiaomeng's shoulder or holds Xiaomeng's inner hand while smiling gently, and Xiaomeng leans slightly toward her big sister with a bright adoring smile.
Both sisters have ONLY two white cat ears on top of their heads (zero human ears), identical pale lilac-white hair family palette and violet eyes, and crisp warm-violet anime ink outlines.
Clean soft pastel cel shading, no film grain, no paper fibers, no sparkles/confetti scatter, no text, no watermark.
```

---

## 5. 幻想之森的故事本（`scenes/forest-storybook.png`）

参考图：Input 1 传 `xiaomeng_role/character/standard.png`。

```text
Use case: illustration-story.
Cinematic 16:9 storybook anime illustration inspired by "Xiaomeng and the Fantasy Forest", matching the exact character identity and crisp warm-violet cel-shaded art style of input 1.
Preserve Xiaomeng's exact design from input 1: pale lilac-white wavy shoulder-length hair with tiny top ahoge curl, ONLY two white cat ears with pink interiors on top (zero human ears), violet eyes, four-petal white blossom clip + pastel-pink ribbon on her anatomical left (viewer-right when facing camera), cream Peter Pan collar blouse, lavender ruffled pinafore skirt, and white curled tail with pink ribbon and tiny pale-gold star bell.
Scene: Inside a cozy sunlit wooden cottage at the edge of the Fantasy Forest. Xiaomeng sits comfortably on a wide low window bench cushioned in soft cream linen, leaning forward happily as she writes in or opens her lavender cat-eared storybook on her lap. Beside her on the cushion naps a tiny plump round white kitty plush hugging a soft pink heart.
Through the warm arched cottage window behind them stretches a peaceful pastel morning forest clearing bathed in gentle dappled sunlight, soft sage greenery, and a tiny wooden garden signpost in the distance without readable letters.
A warm ceramic mug of herbal tea rests safely on the wooden sill beside the window.
Broad tidy shapes, soft cream and pastel-lavender-and-sage harmony, clean color edges, smooth cel shading, no grain, no paper fibers, no text, no watermark, wide 16:9 composition keeping all ear tips, tail charm, and window neatly framed.
```
