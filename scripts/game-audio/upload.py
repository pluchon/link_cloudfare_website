"""把鹈鹕骑车的音效和背景音乐传到 OSS 的 personal_website_other/ 下面。

    python scripts/game-audio/upload.py          上传 scripts/game-audio/out/ 里的两个 mp3
    python scripts/game-audio/upload.py --check  只看：桶里有没有这两个文件、桶的跨域规则配了没有

文件名用 audio.json 里的 stamp，重新生成音频以后名字不变，直接覆盖桶里的同名文件（用户要求同名替换；桶开了版本控制，旧的找得回来）。
网页请求时地址后面带 ?v=生成时刻，所以浏览器可以永久缓存，换了音频也不会用到旧的。

密钥从环境变量 ALIYUN_ACCESS_KEY_ID / ALIYUN_ACCESS_KEY_SECRET 读，不写进仓库，也不打印。
只用标准库，自己按 OSS 的 V1 规则签名，不用另装 SDK。

注意：网页要用 fetch 把音频读进 Web Audio，桶上必须有一条允许本站来源 GET 的跨域规则，
否则文件传上去了浏览器也读不到。--check 会把现有的规则列出来。
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import hmac
import json
import logging
import os
import urllib.error
import urllib.request
from email.utils import formatdate
from pathlib import Path

logger = logging.getLogger(__name__)

ROOT = Path(__file__).resolve().parents[2]
SOURCE = Path(__file__).resolve().parent / "out"
MARKS = ROOT / "src" / "game" / "pelican" / "audio" / "audio.json"
BUCKET = "zlhimage"
ENDPOINT = "oss-cn-guangzhou.aliyuncs.com"
HOST = f"{BUCKET}.{ENDPOINT}"
PREFIX = "personal_website_other/game/pelican-ride"
NAMES = ("sfx", "bgm")


def credentials() -> tuple[str, str]:
    key_id = os.environ.get("ALIYUN_ACCESS_KEY_ID", "")
    secret = os.environ.get("ALIYUN_ACCESS_KEY_SECRET", "")
    if not key_id or not secret:
        raise SystemExit("环境变量 ALIYUN_ACCESS_KEY_ID / ALIYUN_ACCESS_KEY_SECRET 没有设置")
    return key_id, secret


def call(method: str, key: str, query: str = "", body: bytes | None = None, headers: dict[str, str] | None = None) -> tuple[int, dict[str, str], bytes]:
    """发一个签过名的请求。key 是对象路径，query 是 cors 这类子资源名。返回状态码、响应头、响应体。"""
    key_id, secret = credentials()
    sent = dict(headers or {})
    sent["Date"] = formatdate(usegmt=True)
    sent["Host"] = HOST
    special = "".join(f"{name.lower()}:{value}\n" for name, value in sorted(sent.items()) if name.lower().startswith("x-oss-"))
    resource = f"/{BUCKET}/{key}" + (f"?{query}" if query else "")
    text = f"{method}\n{sent.get('Content-MD5', '')}\n{sent.get('Content-Type', '')}\n{sent['Date']}\n{special}{resource}"
    signature = base64.b64encode(hmac.new(secret.encode(), text.encode(), hashlib.sha1).digest()).decode()
    sent["Authorization"] = f"OSS {key_id}:{signature}"
    url = f"https://{HOST}/{key}" + (f"?{query}" if query else "")
    request = urllib.request.Request(url, data=body, method=method, headers=sent)
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return response.status, dict(response.headers), response.read()
    except urllib.error.HTTPError as error:
        return error.code, dict(error.headers), error.read()


def targets() -> list[tuple[Path, str]]:
    stamp = json.loads(MARKS.read_text(encoding="utf8"))["stamp"]
    return [(SOURCE / f"{name}.mp3", f"{PREFIX}/{name}_{stamp}.mp3") for name in NAMES]


def public_size(key: str) -> int | None:
    """不带签名去读，就是浏览器看到的样子。读得到返回文件大小，读不到返回 None。"""
    request = urllib.request.Request(f"https://{HOST}/{key}", method="HEAD")
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return int(response.headers.get("Content-Length", "0"))
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return None
        raise


def check() -> None:
    for path, key in targets():
        size = public_size(key)
        local = path.stat().st_size
        state = "桶里没有" if size is None else ("已在桶里，大小一致" if size == local else f"已在桶里，但大小不一致（桶里 {size}，本地 {local}）")
        logger.info("%s  %s", key, state)
    status, _, body = call("GET", "", "cors")
    if status == 404:
        logger.info("跨域规则：桶上一条也没有，网页用 fetch 读不到这些文件")
    elif status == 200:
        logger.info("跨域规则：\n%s", body.decode("utf8", "replace"))
    else:
        logger.info("跨域规则没查到（HTTP %d）：%s", status, body.decode("utf8", "replace")[:300])


def upload() -> None:
    for path, key in targets():
        data = path.read_bytes()
        headers = {
            "Content-Type": "audio/mpeg",
            "Content-MD5": base64.b64encode(hashlib.md5(data).digest()).decode(),
            "Cache-Control": "public, max-age=31536000, immutable",
        }
        status, _, body = call("PUT", key, body=data, headers=headers)
        if status != 200:
            raise SystemExit(f"{key} 上传失败（HTTP {status}）：{body.decode('utf8', 'replace')[:400]}")
        size = public_size(key)
        if size != len(data):
            raise SystemExit(f"{key} 传完以后公开地址读到的大小不对：{size}，本地 {len(data)}")
        logger.info("%s  %d KB  https://%s/%s", key, len(data) // 1024, HOST, key)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    parser = argparse.ArgumentParser(description="把鹈鹕骑车的音频传到 OSS")
    parser.add_argument("--check", action="store_true", help="只检查，不上传")
    if parser.parse_args().check:
        check()
    else:
        upload()


if __name__ == "__main__":
    main()
