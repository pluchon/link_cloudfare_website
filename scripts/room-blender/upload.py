"""将 Blender 导出的 3D 书房 GLB 模型与 Cycles 烘焙光影/AO 贴图上传到阿里云 OSS（personal_website_other/room/）。

密钥从环境变量 ALIYUN_ACCESS_KEY_ID / ALIYUN_ACCESS_KEY_SECRET 读取，不写进仓库也不打印。
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time
import urllib.error
import urllib.request
from email.utils import formatdate
from pathlib import Path
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parent / "out"
MANIFEST = ROOT / "src" / "room" / "assets.json"
BUCKET = "zlhimage"
ENDPOINT = "oss-cn-guangzhou.aliyuncs.com"
HOST = f"{BUCKET}.{ENDPOINT}"
PREFIX = "personal_website_other/room"

FILES = [
    ("study-room.glb", "model/gltf-binary"),
    ("room_ao.webp", "image/webp"),
    ("room_night_lm.webp", "image/webp"),
]


def prepare_baked_webp() -> None:
    """将 Cycles 烘焙出的 PNG 平滑去噪并压成轻量化 WebP。"""
    specs = [
        ("room_ao.png", "room_ao.webp", 0.9),
        ("room_night_lm.png", "room_night_lm.webp", 1.35),
    ]
    for src_name, dst_name, blur_r in specs:
        src = OUT / src_name
        dst = OUT / dst_name
        if not src.exists():
            continue
        if dst.exists() and dst.stat().st_mtime >= src.stat().st_mtime:
            continue
        with Image.open(src) as im:
            im.filter(ImageFilter.GaussianBlur(radius=blur_r)).save(dst, "WEBP", quality=88, method=6)
        print(f"[WebP] Converted {src_name} -> {dst_name} ({dst.stat().st_size // 1024} KB)")


def credentials() -> tuple[str, str]:
    key_id = os.environ.get("ALIYUN_ACCESS_KEY_ID", "")
    secret = os.environ.get("ALIYUN_ACCESS_KEY_SECRET", "")
    if not key_id or not secret:
        raise SystemExit("环境变量 ALIYUN_ACCESS_KEY_ID / ALIYUN_ACCESS_KEY_SECRET 未设置")
    return key_id, secret


def put_object(key: str, data: bytes, content_type: str) -> None:
    key_id, secret = credentials()
    md5_b64 = base64.b64encode(hashlib.md5(data).digest()).decode()
    date = formatdate(usegmt=True)
    resource = f"/{BUCKET}/{key}"
    sign_str = f"PUT\n{md5_b64}\n{content_type}\n{date}\n{resource}"
    sig = base64.b64encode(hmac.new(secret.encode(), sign_str.encode(), hashlib.sha1).digest()).decode()
    headers = {
        "Date": date,
        "Host": HOST,
        "Content-Type": content_type,
        "Content-MD5": md5_b64,
        "Cache-Control": "public, max-age=31536000, immutable",
        "Authorization": f"OSS {key_id}:{sig}",
    }
    req = urllib.request.Request(f"https://{HOST}/{key}", data=data, method="PUT", headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            if resp.status != 200:
                raise SystemExit(f"上传失败 {key}: HTTP {resp.status}")
    except urllib.error.HTTPError as err:
        raise SystemExit(f"上传失败 {key}: HTTP {err.code} {err.read().decode('utf8', 'replace')[:300]}")


def verify_public(url: str, expected_len: int) -> None:
    req = urllib.request.Request(url, method="HEAD", headers={"Origin": "https://www.nuonuoya.cn"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        cl = int(resp.headers.get("Content-Length", "0"))
        acao = resp.headers.get("Access-Control-Allow-Origin", "")
        if cl != expected_len:
            raise SystemExit(f"校验失败 {url}: 线上 {cl} != 本地 {expected_len}")
        print(f"OK {url} ({cl // 1024} KB, ACAO={acao or 'none'})")


def main() -> None:
    prepare_baked_webp()
    stamp = time.strftime("%Y%m%d%H%M%S")
    urls: dict[str, str] = {"version": stamp}
    for filename, mime in FILES:
        path = OUT / filename
        if not path.exists():
            raise SystemExit(f"缺少待上传产物: {path}")
        data = path.read_bytes()
        key = f"{PREFIX}/{filename}"
        put_object(key, data, mime)
        url = f"https://{HOST}/{key}?v={stamp}"
        verify_public(url, len(data))
        stem = filename.replace("-", "_").split(".")[0]
        urls[stem] = url

    MANIFEST.write_text(json.dumps(urls, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote asset manifest -> {MANIFEST}")


if __name__ == "__main__":
    main()
