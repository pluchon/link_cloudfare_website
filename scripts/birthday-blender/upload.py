"""生日小屋素材整理并上传阿里云 OSS（personal_website_other/birthday/），写出 src/birthday/assets.json。

- birthday-scene.glb / birthday_ao.png 来自 build_birthday.py 的 out/；AO 轻度高斯平滑后压 WebP。
- 诺诺立牌、书法标题与贺卡蛋糕插画来自生图目录（默认 test-output/birthday/img/ 下选定的两张）：
  Alpha 去掉生成器残留的低透明光晕（< 24 归零、> 232 补满、中间线性拉伸），裁掉透明边留 2% 余量，导出带 Alpha 的 WebP。
- OSS 密钥读环境变量 ALIYUN_ACCESS_KEY_ID / ALIYUN_ACCESS_KEY_SECRET（沿用书房上传脚本的签名实现），不打印。

用法：py -3.14 scripts/birthday-blender/upload.py [--nuonuo PATH] [--title PATH]
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
import time
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "room-blender"))
import upload as room_upload  # noqa: E402

log = logging.getLogger(__name__)

OUT = Path(__file__).resolve().parent / "out"
MANIFEST = ROOT / "src" / "birthday" / "assets.json"
PREFIX = "personal_website_other/birthday"
IMG_DIR = ROOT / "test-output" / "birthday" / "img"


def clean_cutout(src: Path, dst: Path, max_side: int, lo: float = 24.0) -> None:
    with Image.open(src) as im:
        rgba = np.array(im.convert("RGBA")).astype(np.float32)
    a = rgba[:, :, 3]
    a = np.clip((a - lo) / (232.0 - lo), 0.0, 1.0) * 255.0
    rgba[:, :, 3] = a
    ys, xs = np.nonzero(a > 8)
    pad = int(max(rgba.shape[:2]) * 0.02)
    y0, y1 = max(ys.min() - pad, 0), min(ys.max() + pad, rgba.shape[0] - 1)
    x0, x1 = max(xs.min() - pad, 0), min(xs.max() + pad, rgba.shape[1] - 1)
    out = Image.fromarray(rgba[y0 : y1 + 1, x0 : x1 + 1].astype(np.uint8), "RGBA")
    scale = max_side / max(out.size)
    if scale < 1.0:
        out = out.resize((round(out.width * scale), round(out.height * scale)), Image.LANCZOS)
    out.save(dst, "WEBP", quality=90, method=6, exact=False)
    log.info("[WebP] %s -> %s %dx%d (%d KB)", src.name, dst.name, out.width, out.height, dst.stat().st_size // 1024)


def prepare(nuonuo: Path, title: Path, card_cake: Path) -> list[tuple[str, str, Path]]:
    ao_png = OUT / "birthday_ao.png"
    ao_webp = OUT / "birthday_ao.webp"
    with Image.open(ao_png) as im:
        im.filter(ImageFilter.GaussianBlur(radius=0.4)).save(ao_webp, "WEBP", quality=88, method=6)
    log.info("[WebP] birthday_ao.webp (%d KB)", ao_webp.stat().st_size // 1024)
    nuonuo_webp = OUT / "nuonuo-standee.webp"
    title_webp = OUT / "title-calligraphy.webp"
    clean_cutout(nuonuo, nuonuo_webp, 1400)
    clean_cutout(title, title_webp, 1400)
    # 贺卡左侧扁平蛋糕插画：火苗暖光晕是半透明的，阈值放低保住它
    cake_webp = OUT / "card-cake.webp"
    clean_cutout(card_cake, cake_webp, 900, lo=4.0)
    return [
        ("scene", "model/gltf-binary", OUT / "birthday-scene.glb"),
        ("ao", "image/webp", ao_webp),
        ("nuonuo", "image/webp", nuonuo_webp),
        ("title", "image/webp", title_webp),
        ("cardCake", "image/webp", cake_webp),
    ]


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    ap = argparse.ArgumentParser()
    ap.add_argument("--nuonuo", default=str(IMG_DIR / "nuonuo-final-0.png"))
    ap.add_argument("--title", default=str(IMG_DIR / "title-1.png"))
    ap.add_argument("--card-cake", default=str(IMG_DIR / "card-cake-0.png"))
    ap.add_argument("--skip-upload", action="store_true")
    args = ap.parse_args()

    files = prepare(Path(args.nuonuo), Path(args.title), Path(args.card_cake))
    if args.skip_upload:
        return
    stamp = time.strftime("%Y%m%d%H%M%S")
    manifest: dict[str, str] = {"version": stamp}
    for key, mime, path in files:
        data = path.read_bytes()
        obj_key = f"{PREFIX}/{path.name}"
        room_upload.put_object(obj_key, data, mime)
        url = f"https://{room_upload.HOST}/{obj_key}?v={stamp}"
        room_upload.verify_public(url, len(data))
        manifest[key] = url
    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    log.info("Wrote manifest -> %s", MANIFEST)


if __name__ == "__main__":
    main()
