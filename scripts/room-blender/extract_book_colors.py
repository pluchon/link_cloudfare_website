"""从全站五分类全部已发布文章的封面图中提取适合精装书脊的主题色，输出 src/room/book-colors.json。

只拉取 OSS ?x-oss-process=style/thumb 缩略图，按饱和度与明度加权聚类，避免取出纯白、纯黑或过灰的底色。
"""
from __future__ import annotations

import colorsys
import io
import json
import pathlib
import re
import urllib.request
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT_JSON = ROOT / "src" / "room" / "book-colors.json"
KINDS = ("project", "tool", "explore", "daily", "xiaomeng")
IMG_RE = re.compile(r'!\[[^\]]*\]\(\s*(\S+?)(?:\s+["\'][^)]*)?\s*\)')
OSS_HOST = ".oss-cn-guangzhou.aliyuncs.com"

FALLBACK_BY_KIND = {
    "project": "#4e6b8a",
    "tool": "#5e7a68",
    "explore": "#6c5b8c",
    "daily": "#b87a56",
    "xiaomeng": "#c985a8",
}


def thumb_url(url: str) -> str:
    if not url or OSS_HOST not in url or "x-oss-process=" in url:
        return url
    sep = "&" if "?" in url else "?"
    return f"{url}{sep}x-oss-process=style/thumb"


def extract_theme_hex(img_bytes: bytes, fallback: str) -> str:
    img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
    img.thumbnail((72, 72))
    pixels = list(img.getdata())

    # 将色相分成 24 桶，按 (饱和度 + 适中明度权重) 累加，找最具代表性的封面主题色
    buckets: dict[int, list[float]] = {}
    for r, g, b in pixels:
        rf, gf, bf = r / 255.0, g / 255.0, b / 255.0
        h, s, v = colorsys.rgb_to_hsv(rf, gf, bf)
        if v < 0.14 or v > 0.96:
            continue
        weight = (s ** 1.4 + 0.08) * (1.0 - abs(v - 0.56) * 0.75)
        b_idx = int(h * 24) % 24
        acc = buckets.get(b_idx)
        if acc is None:
            buckets[b_idx] = [rf * weight, gf * weight, bf * weight, weight]
        else:
            acc[0] += rf * weight
            acc[1] += gf * weight
            acc[2] += bf * weight
            acc[3] += weight

    if not buckets:
        return fallback

    best = max(buckets.values(), key=lambda x: x[3])
    if best[3] <= 1e-6:
        return fallback

    r = best[0] / best[3]
    g = best[1] / best[3]
    b = best[2] / best[3]

    # 轻度校准到精装布面书脊的雅致区间：明度 0.34..0.72，饱和度 0.24..0.68
    h, s, v = colorsys.rgb_to_hsv(r, g, b)
    s = max(0.24, min(0.66, s * 0.95 + 0.08))
    v = max(0.36, min(0.72, v))
    r2, g2, b2 = colorsys.hsv_to_rgb(h, s, v)
    return "#{:02x}{:02x}{:02x}".format(int(r2 * 255), int(g2 * 255), int(b2 * 255))


def slug_from_file(path: pathlib.Path) -> str:
    stem = path.stem
    stem = re.sub(r"^\d{4}-\d{2}-\d{2}-", "", stem)
    return re.sub(r"\s+", "-", stem)


def main() -> None:
    colors: dict[str, str] = {}
    for kind in KINDS:
        folder = ROOT / "src" / "content" / kind
        for md in sorted(folder.glob("*.md")):
            if md.name.startswith("_"):
                continue
            text = md.read_text(encoding="utf-8")
            m = IMG_RE.search(text)
            key = f"{kind}/{slug_from_file(md)}"
            fallback = FALLBACK_BY_KIND[kind]
            if not m:
                colors[key] = fallback
                continue
            url = thumb_url(m.group(1))
            try:
                req = urllib.request.Request(url, headers={"User-Agent": "nuonuoya-book-color/1.0"})
                with urllib.request.urlopen(req, timeout=15) as resp:
                    data = resp.read()
                hex_color = extract_theme_hex(data, fallback)
            except Exception:
                hex_color = fallback
            colors[key] = hex_color
            print(f"{key} -> {hex_color}")

    OUT_JSON.write_text(json.dumps(colors, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(colors)} book theme colors to {OUT_JSON}")


if __name__ == "__main__":
    main()
