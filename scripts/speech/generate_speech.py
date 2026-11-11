"""个人网站文章正文朗读合成脚本（基于 ElevenLabs eleven_v4 + whisper.cpp 自动查重验收）。

用法：
    python scripts/speech/generate_speech.py scripts/speech/<稿子目录> [--regen 3 7 ...]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
from pathlib import Path

import numpy as np
import requests

SR = 44100
WHISPER = Path(r"C:\JavaCode\items\video-studio\tools\hanzi\whisper.cpp")
PUNCT = re.compile(r"[\s，。、；：？！…—“”‘’\"'（）()《》,.;:?!·-]")
REPEAT = re.compile(r"(.{2,})\1")

# 停顿（秒）：平和悠长的叙事节奏
HEAD, TAIL = 0.8, 1.8
GAP_LINE, GAP_LONG, GAP_SECTION = 1.05, 1.45, 2.4


def api_key() -> str:
    key = os.environ.get("ELEVENLABS_API_KEY") or os.environ.get("ELEVENLAVS_APIKEY")
    if not key:
        raise SystemExit("没有找到环境变量 ELEVENLABS_API_KEY")
    return key


def tts_call(text: str, voice: str, model: str, tag: str, settings: dict, key: str) -> bytes:
    r = requests.post(
        f"https://api.elevenlabs.io/v1/text-to-speech/{voice}",
        params={"output_format": "mp3_44100_128"},
        headers={"xi-api-key": key},
        json={
            "text": f"{tag} {text}",
            "model_id": model,
            "language_code": "zh",
            "voice_settings": settings,
        },
        timeout=300,
    )
    if r.status_code != 200:
        raise SystemExit(f"ElevenLabs 返回 {r.status_code}：{r.text[:500]}")
    return r.content


def load_audio(p: Path, sr: int = SR) -> np.ndarray:
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(p), "-ac", "1", "-ar", str(sr), "-f", "f32le", "-"],
        capture_output=True,
        check=True,
    ).stdout
    return np.frombuffer(raw, np.float32).copy()


def envelope_db(x: np.ndarray) -> np.ndarray:
    win = int(0.01 * SR)
    n = len(x) // win
    e = np.sqrt((x[: n * win].reshape(n, win) ** 2).mean(axis=1))
    return 20 * np.log10(e + 1e-9)


def trim(x: np.ndarray, thr_db: float = -45.0, pad: float = 0.08) -> np.ndarray:
    on = np.where(envelope_db(x) > thr_db)[0]
    win = int(0.01 * SR)
    a = max(0, on[0] * win - int(pad * SR))
    b = min(len(x), (on[-1] + 1) * win + int(pad * SR))
    y = x[a:b].copy()
    f = int(0.02 * SR)
    y[:f] *= np.linspace(0, 1, f)
    y[-f:] *= np.linspace(1, 0, f)
    return y


def longest_gap(x: np.ndarray, thr_db: float = -45.0) -> float:
    best = run = 0
    for v in envelope_db(x):
        run = run + 1 if v <= thr_db else 0
        best = max(best, run)
    return best * 0.01


def write_wav(x: np.ndarray, p: Path) -> None:
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ar", str(SR), "-ac", "1", "-i", "-", str(p)],
        input=x.tobytes(),
        check=True,
    )


def first_utterance(x: np.ndarray, gap: float = 0.4) -> np.ndarray:
    win = int(0.01 * SR)
    loud = envelope_db(x) > -45.0
    on = np.where(loud)[0]
    run = 0
    for k in range(on[0], len(loud)):
        run = 0 if loud[k] else run + 1
        if run * 0.01 >= gap:
            return trim(x[: (k - run + 1) * win])
    return x


def split_chunks(x: np.ndarray, min_gap: float = 0.45) -> list[tuple[int, int, float]]:
    win = int(0.01 * SR)
    loud = envelope_db(x) > -45.0
    on = np.where(loud)[0]
    if len(on) == 0:
        return [(0, len(x), 0.0)]
    chunks: list[tuple[int, int, float]] = []
    start_k = int(on[0])
    run = 0
    for k in range(int(on[0]), int(on[-1]) + 1):
        if loud[k]:
            if run * 0.01 >= min_gap:
                end_k = k - run
                chunks.append((start_k * win, end_k * win, round(run * 0.01, 2)))
                start_k = k
            run = 0
        else:
            run += 1
    chunks.append((start_k * win, (int(on[-1]) + 1) * win, 0.0))
    return chunks


def transcribe_samples(samples: np.ndarray) -> str:
    exe, model = WHISPER / "main.exe", WHISPER / "ggml-small.bin"
    if not exe.exists() or not model.exists():
        return ""
    probe = WHISPER / "_probe_seg.wav"
    pad_len = max(int(0.5 * SR), int(2.0 * SR) - len(samples))
    padded = np.concatenate([
        np.zeros(int(0.4 * SR), dtype=np.float32),
        samples,
        np.zeros(pad_len, dtype=np.float32),
    ])
    subprocess.run(
        [
            "ffmpeg", "-v", "error", "-y",
            "-f", "f32le", "-ar", str(SR), "-ac", "1", "-i", "-",
            "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", str(probe),
        ],
        input=padded.tobytes(),
        check=True,
    )
    out = subprocess.run(
        [str(exe), "-m", str(model), "-l", "zh", "--prompt", "简体", "-nt", "-np", "-f", str(probe)],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    ).stdout
    probe.unlink(missing_ok=True)
    return PUNCT.sub("", out)


def strip_opening_repeat(x: np.ndarray, line: str) -> tuple[np.ndarray, bool]:
    """ElevenLabs 在带长语气 tag 时偶发把首句或前两个字念两遍（中间隔 0.5~0.9s 静音），
    而整段送进 Whisper 时容易被解码器合并去重。按静音切出前两段单独转写，若首段与次段开头重复则直接裁掉首段。"""
    chunks = split_chunks(x, min_gap=0.45)
    if len(chunks) < 2:
        return x, False
    s0, e0, gap0 = chunks[0]
    s1, e1, _ = chunks[1]
    first_clause = re.split(r"[，、；：。？！]", line)[0]
    if (e0 - s0) / SR < 1.0 and gap0 >= 0.55 and len(first_clause) >= 5:
        return trim(x[s1:]), True
    n = max(1, len(PUNCT.sub("", line)))
    if (len(x) / SR) / n < 0.34:
        return x, False
    t0 = transcribe_samples(x[s0:e0])
    t1 = transcribe_samples(x[s1:e1])
    if len(t0) >= 2 and len(t1) >= 2:
        if t1.startswith(t0[:2]) or t0.startswith(t1[:2]) or len(set(t0[:3]) & set(t1[:3])) >= 2:
            return trim(x[s1:]), True
    return x, False


def transcribe(p: Path) -> str | None:
    exe, model = WHISPER / "main.exe", WHISPER / "ggml-small.bin"
    if not exe.exists() or not model.exists():
        return None
    # whisper.cpp 在 Windows 上用窄字符 fopen，路径含中文会打不开文件，固定写到纯英文目录
    wav = WHISPER / "_probe_16k.wav"
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-i", str(p), "-ar", "16000", "-ac", "1", str(wav)],
        check=True,
    )
    out = subprocess.run(
        [str(exe), "-m", str(model), "-l", "zh", "-f", str(wav), "--prompt", "简体", "-nt"],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    ).stdout
    wav.unlink(missing_ok=True)
    return PUNCT.sub("", out)


def check(c: np.ndarray, p: Path, line: str) -> str | None:
    n = len(PUNCT.sub("", line))
    gap, dur = longest_gap(c), len(c) / SR
    if gap >= 1.5:
        return f"句中静音 {gap:.2f}s"
    if n >= 5 and dur / n > 0.52:
        return f"太长 {dur:.2f}s / {n} 字"
    heard = transcribe(p)
    if heard is None:
        return None
    if len(heard) > n * 1.15 + 1:
        return f"转写多出字：{heard}"
    m = REPEAT.search(heard)
    if m and not REPEAT.search(PUNCT.sub("", line)):
        return f"转写里有重复「{m.group(0)}」：{heard}"
    return None


def gap_after(line: str) -> float:
    if line.endswith(("？", "——", "；")) or len(line) > 30:
        return GAP_LONG
    return GAP_LINE


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("dir", help="包含 script.json 的文章语音目录")
    ap.add_argument("--regen", type=int, nargs="*", default=[])
    a = ap.parse_args()

    out = Path(a.dir).resolve()
    spec = json.loads((out / "script.json").read_text(encoding="utf-8"))
    title = spec.get("title", out.name)
    voice = spec["voice"]
    model = spec.get("model", "eleven_v4")
    tag = spec["tag"]
    settings = spec["settings"]
    sections = spec["sections"]

    clips_dir = out / "clips"
    clips_dir.mkdir(parents=True, exist_ok=True)
    key = api_key()
    regen = set(a.regen)

    pieces: list[np.ndarray] = [np.zeros(int(HEAD * SR), np.float32)]
    t = HEAD
    timing = []
    idx = 0
    for si, sec in enumerate(sections):
        sec_t = {"id": sec.get("id"), "title": sec.get("title"), "start": round(t, 3), "lines": []}
        for li, line in enumerate(sec["lines"]):
            h = hashlib.sha1(
                json.dumps([line, tag, model, voice, settings], ensure_ascii=False).encode()
            ).hexdigest()[:8]
            p = clips_dir / f"{idx:03d}_{h}.mp3"
            for attempt in range(6):
                if not p.exists() or (attempt == 0 and idx in regen) or attempt > 0:
                    p.write_bytes(tts_call(line, voice, model, tag, settings, key))
                c = trim(load_audio(p))
                c, stripped = strip_opening_repeat(c, line)
                if stripped:
                    print(f"  ✂ [{idx:02d}] 自动裁掉开头重复分句", flush=True)
                    subprocess.run(
                        [
                            "ffmpeg", "-v", "error", "-y",
                            "-f", "f32le", "-ar", str(SR), "-ac", "1", "-i", "-",
                            "-c:a", "libmp3lame", "-b:a", "128k", str(p),
                        ],
                        input=c.tobytes(),
                        check=True,
                    )
                probe = p
                if len(PUNCT.sub("", line)) <= 6 and not re.search(r"[，、；：]", line):
                    c = first_utterance(c)
                    probe = p.with_suffix(".cut.wav")
                    write_wav(c, probe)
                why = check(c, probe, line)
                if probe != p:
                    probe.unlink()
                if why is None:
                    break
                print(f"  第 {idx} 句重念（{why}）")
            else:
                print(f"!! 第 {idx} 句六次都没过检查，先用最后一次：{line}")
            last = li == len(sec["lines"]) - 1
            pieces.append(c)
            sec_t["lines"].append(
                {"i": idx, "text": line, "start": round(t, 3), "end": round(t + len(c) / SR, 3)}
            )
            t += len(c) / SR
            g = (GAP_SECTION if si < len(sections) - 1 else TAIL) if last else gap_after(line)
            pieces.append(np.zeros(int(g * SR), np.float32))
            t += g
            print(f"{idx:3d} {len(c) / SR:5.2f}s  {line}")
            idx += 1
        sec_t["end"] = sec_t["lines"][-1]["end"]
        timing.append(sec_t)

    y = np.concatenate(pieces)
    raw = out / "voice.raw.wav"
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ar", str(SR), "-ac", "1", "-i", "-", str(raw)],
        input=y.tobytes(),
        check=True,
    )
    meter = subprocess.run(
        ["ffmpeg", "-hide_banner", "-i", str(raw), "-af", "ebur128", "-f", "null", "-"],
        capture_output=True,
        text=True,
    ).stderr
    loud = float(re.findall(r"I:\s+(-?[\d.]+) LUFS", meter)[-1])
    wav_out = out / "voice.wav"
    mp3_out = out / f"{title}.mp3"
    subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-y",
            "-i",
            str(raw),
            "-af",
            f"volume={-20 - loud:.2f}dB",
            "-c:a",
            "pcm_s16le",
            str(wav_out),
        ],
        check=True,
    )
    subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-y",
            "-i",
            str(wav_out),
            "-codec:a",
            "libmp3lame",
            "-b:a",
            "192k",
            str(mp3_out),
        ],
        check=True,
    )
    shutil.copy2(mp3_out, out.parent / f"{title}.mp3")
    print(f"原始 {loud:.1f} LUFS，增益 {-20 - loud:+.1f} dB")
    raw.unlink()
    (out / "timing.json").write_text(
        json.dumps({"duration": round(len(y) / SR, 3), "sections": timing}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"共 {idx} 句，{len(y) / SR:.1f} 秒 -> {mp3_out}")


if __name__ == "__main__":
    main()
