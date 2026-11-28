"""经 OpenRouter `POST /api/v1/images` 调用 GPT Image 2.6 生图 / 参考图编辑。

用法（PowerShell）：
    py -3.14 scripts/image-gen/openrouter_image.py --model flare --prompt-file p.txt \
        --ref nuonuo_role/character/standard.png --aspect 2:3 --quality medium \
        --background transparent --out test-output/birthday/img/nuonuo-draft

- 密钥只从环境变量 OPENROUTER_API_KEY 读取，不打印、不落盘。
- 参考图先等比缩到长边 1024 再以 base64 data URL 放入 input_references，节省输入图像 token。
- 输出 <out>-<i>.<format>，并把本次请求参数与 usage.cost 追加写入 <out 所在目录>/cost-log.jsonl。
"""
from __future__ import annotations

import argparse
import base64
import io
import json
import logging
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

from PIL import Image

log = logging.getLogger(__name__)

API_URL = "https://openrouter.ai/api/v1/images"
MODELS = {
    "flare": "openai/gpt-image-2.6-flare",
    "sunburst": "openai/gpt-image-2.6-sunburst",
}
REF_MAX_SIDE = 1024


def encode_ref(path: Path) -> str:
    with Image.open(path) as im:
        im.load()
        has_alpha = im.mode in ("RGBA", "LA") or "transparency" in im.info
        im = im.convert("RGBA" if has_alpha else "RGB")
        scale = REF_MAX_SIDE / max(im.size)
        if scale < 1.0:
            im = im.resize((round(im.width * scale), round(im.height * scale)), Image.LANCZOS)
        buf = io.BytesIO()
        im.save(buf, "PNG", optimize=True)
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


def build_body(args: argparse.Namespace, prompt: str) -> dict[str, object]:
    body: dict[str, object] = {
        "model": MODELS[args.model],
        "prompt": prompt,
        "n": args.n,
        "aspect_ratio": args.aspect,
        "quality": args.quality,
        "output_format": args.format,
        "response_format": "b64_json",
    }
    if args.background:
        body["background"] = args.background
    if args.ref:
        body["input_references"] = [
            {"type": "image_url", "image_url": {"url": encode_ref(Path(p))}} for p in args.ref
        ]
    return body


def request_images(body: dict[str, object], key: str, timeout: int) -> dict[str, object]:
    req = urllib.request.Request(
        API_URL,
        data=json.dumps(body).encode("utf-8"),
        method="POST",
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "X-Title": "nuonuoya-site image pipeline",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as err:
        detail = err.read().decode("utf-8", "replace")[:600]
        raise SystemExit(f"OpenRouter HTTP {err.code}: {detail}")


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", choices=sorted(MODELS), required=True)
    ap.add_argument("--prompt-file", required=True)
    ap.add_argument("--ref", action="append", default=[])
    ap.add_argument("--aspect", default="1:1")
    ap.add_argument("--quality", default="medium")
    ap.add_argument("--background", default="")
    ap.add_argument("--format", default="png")
    ap.add_argument("--n", type=int, default=1)
    ap.add_argument("--out", required=True)
    ap.add_argument("--timeout", type=int, default=600)
    args = ap.parse_args()

    key = os.environ.get("OPENROUTER_API_KEY", "")
    if not key:
        raise SystemExit("环境变量 OPENROUTER_API_KEY 未设置")
    prompt = Path(args.prompt_file).read_text(encoding="utf-8").strip()
    body = build_body(args, prompt)

    t0 = time.time()
    data = request_images(body, key, args.timeout)
    elapsed = time.time() - t0

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    items = data.get("data") or []
    if not items:
        raise SystemExit(f"响应中没有图片: {json.dumps(data, ensure_ascii=False)[:600]}")
    saved = []
    for i, item in enumerate(items):
        b64 = item.get("b64_json")
        if not b64:
            raise SystemExit(f"第 {i} 张缺少 b64_json: {list(item)}")
        path = out.with_name(f"{out.name}-{i}.{args.format}")
        path.write_bytes(base64.b64decode(b64))
        with Image.open(path) as im:
            log.info("saved %s  %dx%d %s", path, im.width, im.height, im.mode)
        saved.append(str(path))

    usage = data.get("usage") or {}
    record = {
        "time": time.strftime("%Y-%m-%d %H:%M:%S"),
        "model": body["model"],
        "aspect": args.aspect,
        "quality": args.quality,
        "background": args.background or None,
        "n": args.n,
        "refs": args.ref,
        "prompt_file": args.prompt_file,
        "outputs": saved,
        "seconds": round(elapsed, 1),
        "usage": usage,
    }
    with (out.parent / "cost-log.jsonl").open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(record, ensure_ascii=False) + "\n")
    log.info("cost=%s USD  tokens=%s  %.1fs", usage.get("cost"), usage.get("total_tokens"), elapsed)


if __name__ == "__main__":
    sys.exit(main())
