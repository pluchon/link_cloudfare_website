"""鹈鹕骑车的音效和背景音乐：全部用真实乐器采样渲染，不用手算波形。

渲染器和采样库在隔壁的视频仓库 video-studio 里（tools/common/midi_render.py、tools/sfizz、samples/VCSL，CC0）。
默认按 ../video-studio 找，放在别处就设环境变量 VIDEO_STUDIO。还需要 ffmpeg 在 PATH 上。

    python scripts/game-audio/pelican.py

    python scripts/game-audio/pelican.py cave neon   只重渲这几首配乐（音效每次都重渲）

产出这些文件。mp3 在 scripts/game-audio/out/（不入库，传到 OSS 才会被网页用到），audio.json 进 src/game/pelican/audio/：
    sfx.mp3          所有音效拼成一条
    bgm_<短名>.mp3   每个场景一首配乐，循环段前后各多留了半秒
    audio.json       每个音效从第几秒开始、多长，每首配乐的循环点，哪个场景用哪首，文件名里的 stamp，这次生成的时刻 version

mp3 生成以后要传到 OSS 才会被网页用到：python scripts/game-audio/upload.py。
OSS 上的文件名不变（用户要求同名替换，stamp 沿用 audio.json 里已有的），网页请求时在地址后面带 ?v=version，
每次重新生成 version 都变，浏览器才不会拿着旧文件去配新的时间点。

中间文件在 scripts/game-audio/out/，不入库。

各家采样的录音音量能差几十分贝（马林巴比竖琴小二十多分贝，三角铁更小），直接混会有乐器完全听不见。
所以每样乐器先单独弹一个音量一量，统一拉到同一个峰值，再谈谁大谁小。
"""
from __future__ import annotations

import array
import json
import logging
import math
import os
import subprocess
import sys
import time
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
STUDIO = Path(os.environ.get("VIDEO_STUDIO", ROOT.parent / "video-studio"))
sys.path.insert(0, str(STUDIO / "tools" / "common"))

import midi_render as mr  # noqa: E402

logger = logging.getLogger(__name__)

VCSL = STUDIO / "samples" / "VCSL" / "VCSL-master"
STRUCK = VCSL / "Idiophones" / "Struck Idiophones"
WORK = Path(__file__).resolve().parent / "out"
DEST = ROOT / "src" / "game" / "pelican" / "audio"

RATE = 44100
# 音效之间留的空白（秒）。mp3 解码后开头可能多出几十毫秒，留够了才不会串到下一个
GAP = 0.2
# 背景音乐循环段前后各多留的长度（秒）
BGM_PAD = 0.5
# 校准时把每样乐器单个音的峰值都拉到这里（dB）
LEVEL = -14.0

# 一个音：起点拍、时值拍、键号、力度
Note = tuple[float, float, int, int]
# 一轨：乐器名、音符、相对音量（dB）。乐器名是 VOICES 里的名字，打击乐写 "kit"
Part = tuple[str, list[Note], float]

# 管弦乐和钢琴：VSCO 2 社区版（CC0），和 VCSL 放在同一个 samples 目录下
VSCO = STUDIO / "samples" / "VSCO-2-CE" / "VSCO-2-CE-master"
STEINWAY = VCSL / "Chordophones" / "Zithers" / "Grand Piano, Steinway B" / "NoSus"

# 有音高的乐器：采样文件夹、文件名里取音名的正则、余音多长（秒）、校准时弹哪个音、同一个音有好几个录音时挑文件名里带什么的、起音多慢（秒）。
# 音效还用卡林巴、钟琴、马林巴这些敲的；配乐用户两次嫌「尖锐、像电子合成的」，2026-11-13 起换成钢琴、长笛、单簧管领奏，
# 弦乐组铺底，大提琴、低音提琴拨弦做低音，挑的都是轻的那一档力度
PITCHED = {
    "kalimba": (VCSL / "Idiophones" / "Plucked Idiophones" / "Kalimba, Kenya", r"_([A-G][#b]?\d)_k\d+", 0.9, "B3", "", 0.0),
    "glock": (STRUCK / "Glockenspiel", r"loud_([A-G][#b]?\d)_", 1.4, "C6", "", 0.0),
    "marimba": (STRUCK / "Marimba", r"_([A-G][#b]?\d)_med_", 0.7, "C4", "", 0.0),
    "harp": (VCSL / "Chordophones" / "Composite Chordophones" / "Folk Harp", r"_([A-G][#b]?\d)_v3_", 1.3, "C4", "", 0.0),
    "chimes": (STRUCK / "Hand Chimes", r"sus_([A-G][#b]?\d)_r01", 2.0, "C5", "", 0.0),
    "piano": (STEINWAY, r"_Close_([A-G][#b]?\d)_vl", 1.4, "C4", "_vl2_", 0.0),
    "flute": (VSCO / "Woodwinds" / "Flute" / "susNV", r"_susNV_([A-G][#b]?\d)_", 0.5, "C5", "_v1", 0.06),
    "clarinet": (VSCO / "Woodwinds" / "Clarinet" / "susLong", r"_susLong_([A-G][#b]?\d)_", 0.45, "C4", "_v1_rr1", 0.05),
    "strings": (VSCO / "Strings" / "Violin Section" / "susVib", r"_susVib_([A-G][#b]?\d)_", 0.9, "A4", "_v1", 0.28),
    "cello": (VSCO / "Strings" / "Cello Section" / "susvib", r"susvib_([A-G][#b]?\d)_", 0.8, "C3", "_v1_", 0.2),
    "pizz": (VSCO / "Strings" / "Solo Contrabass" / "Pizz", r"_Pizz_([A-G][#b]?\d)_", 0.6, "C2", "_v1_rr1", 0.0),
}

# 打击乐：键号 -> 录音文件、在整套鼓里比别人大多少小多少（dB）
KIT = {
    36: ("Cajon/Cajon_hit1_f_rr1.wav", 0.0),
    38: ("Cajon/Cajon_hit3_mp_rr1.wav", -5.0),
    42: ("Shaker, Small/Mid_ShakerDouble_Down_rr1.wav", -11.0),
    44: ("Shaker, Small/Mid_ShakerDouble_Up_rr1.wav", -11.0),
    46: ("Shaker, Small/Mid_Shaker_Slap_rr1.wav", -7.0),
    54: ("Tambourine 1/Tamb1_Hit_v1_rr1_Mid.wav", -9.0),
    56: ("Tambourine 1/Tamb1_Shake_rr1_Mid.wav", -6.0),
    60: ("Bell Tree/Stroke/BellTree_Stroke_3_Mid.wav", -2.0),
    62: ("Mark Trees/Legacy/windchimes_fastAsc1.wav", -3.0),
    64: ("Mark Trees/Legacy/windchimes_asc1.wav", -3.0),
    65: ("Woodblock/wood_click_f_rr1.wav", -6.0),
    75: ("Claves/Claves1_Hit_v2_rr1_Mid.wav", -7.0),
    81: ("Triangles/Triangle1_Hit_v1_rr1_Mid.wav", 0.0),
}

# 乐器名 -> (sfz 文件, 校准出来要补多少 dB)。打击乐每个键单独一项，名字是 kit36 这样
VOICES: dict[str, tuple[Path, float]] = {}


def key(name: str) -> int:
    return mr.note_number(name)


def run(command: list[str]) -> None:
    """跑一条外部命令，失败时把它自己的报错原样打出来。"""
    done = subprocess.run(command, capture_output=True, text=True, encoding="utf8", errors="replace")
    if done.returncode != 0:
        raise SystemExit(f"命令失败（退出码 {done.returncode}）：{' '.join(command)}\n{done.stderr}")


def load(path: Path) -> array.array:
    with wave.open(str(path), "rb") as wav:
        if wav.getsampwidth() != 2 or wav.getnchannels() != 2 or wav.getframerate() != RATE:
            raise SystemExit(f"{path} 不是 {RATE} Hz 16 位立体声")
        samples = array.array("h")
        samples.frombytes(wav.readframes(wav.getnframes()))
    return samples


def save(path: Path, samples: array.array) -> None:
    with wave.open(str(path), "wb") as wav:
        wav.setnchannels(2)
        wav.setsampwidth(2)
        wav.setframerate(RATE)
        wav.writeframes(samples.tobytes())


def peak_db(samples: array.array) -> float:
    top = max((abs(value) for value in samples), default=0)
    return 20 * math.log10(max(top, 1) / 32768)


def rms_db(samples: array.array) -> float:
    if not samples:
        return -120.0
    mean = (sum(value * value for value in samples) / len(samples)) ** 0.5
    return 20 * math.log10(max(mean, 1) / 32768)


def sfizz(sfz: Path, midi: Path, wav: Path) -> None:
    run([str(mr.SFIZZ), "--sfz", str(sfz), "--midi", str(midi), "--wav", str(wav), "--samplerate", str(RATE), "--quality", "3", "--polyphony", "64"])


def measure(name: str, sfz: Path, note: int) -> float:
    """这样乐器单独弹一个音，量出峰值，返回要补多少 dB 才到 LEVEL。"""
    midi = mr.write_midi(WORK / f"cal_{name}.mid", 120, [[(0, 1, note, 100)]])
    raw = WORK / f"cal_{name}_raw.wav"
    sfizz(sfz, midi, raw)
    wav = WORK / f"cal_{name}.wav"
    run(["ffmpeg", "-v", "error", "-y", "-i", str(raw), "-ar", str(RATE), "-ac", "2", "-c:a", "pcm_s16le", str(wav)])
    return LEVEL - peak_db(load(wav))


def prepare() -> None:
    """给每样乐器写 sfz 映射，并校准音量。"""
    for name, (folder, pattern, release, probe, prefer, attack) in PITCHED.items():
        if not folder.exists():
            raise SystemExit(f"采样目录不存在：{folder}")
        sfz = mr.sfz_from_notes(folder, WORK / f"{name}.sfz", pattern=pattern, prefer=prefer, extra=f"ampeg_attack={attack} ampeg_release={release} amp_veltrack=45")
        trim = measure(name, sfz, key(probe))
        VOICES[name] = (sfz, trim)
        logger.info("校准 %-8s 补 %+.1f dB", name, trim)
    for note, (sample, mix) in KIT.items():
        if not (STRUCK / sample).exists():
            raise SystemExit(f"采样不存在：{STRUCK / sample}")
        sfz = WORK / f"kit{note}.sfz"
        sfz.write_text(f"<control>\ndefault_path={STRUCK.as_posix()}/\n\n<group>\nloop_mode=one_shot amp_veltrack=60\n\n<region> sample={sample} key={note}\n", encoding="utf8")
        trim = measure(f"kit{note}", sfz, note)
        VOICES[f"kit{note}"] = (sfz, trim + mix)
        logger.info("校准 kit%-5d 补 %+.1f dB", note, trim)


def resolve(parts: list[Part]) -> list[tuple[Path, list[Note], float]]:
    """把乐器名换成 sfz 文件并补上校准量；打击乐按键号拆成一键一轨。"""
    out: list[tuple[Path, list[Note], float]] = []
    for name, notes, gain in parts:
        if name != "kit":
            sfz, trim = VOICES[name]
            out.append((sfz, notes, gain + trim))
            continue
        for note in sorted({item[2] for item in notes}):
            sfz, trim = VOICES[f"kit{note}"]
            out.append((sfz, [item for item in notes if item[2] == note], gain + trim))
    return out


def stems(name: str, bpm: float, parts: list[Part]) -> list[tuple[Path, float]]:
    """逐轨用 sfizz 渲染，返回每一轨的 wav 和它该乘的音量。"""
    out: list[tuple[Path, float]] = []
    for i, (sfz, notes, gain) in enumerate(resolve(parts)):
        midi = mr.write_midi(WORK / f"{name}_{i}.mid", bpm, [notes])
        wav = WORK / f"{name}_{i}.wav"
        sfizz(sfz, midi, wav)
        out.append((wav, gain))
    return out


def mix(name: str, bpm: float, parts: list[Part], chain: str) -> Path:
    """渲染并混到一起，chain 是混完之后接的 ffmpeg 滤镜（可以为空）。输出 16 位立体声 wav。"""
    rendered = stems(name, bpm, parts)
    inputs: list[str] = []
    for wav, _ in rendered:
        inputs += ["-i", str(wav)]
    # 先转成浮点再调音量：16 位整数上直接放大二十多分贝会削顶
    labels = "".join(f"[{i}:a]aformat=sample_fmts=flt,volume={gain:.2f}dB[a{i}];" for i, (_, gain) in enumerate(rendered))
    joined = "".join(f"[a{i}]" for i in range(len(rendered))) + f"amix=inputs={len(rendered)}:normalize=0"
    out = WORK / f"{name}.wav"
    run(["ffmpeg", "-v", "error", "-y", *inputs, "-filter_complex", f"{labels}{joined}{chain}", "-ar", str(RATE), "-ac", "2", "-c:a", "pcm_s16le", str(out)])
    return out


def shape(samples: array.array, target: float, longest: float) -> array.array:
    """去掉开头的静音、把尾巴裁到几乎听不见的地方、峰值调到 target、结尾淡出。"""
    frames = len(samples) // 2
    loud = [max(abs(samples[i * 2]), abs(samples[i * 2 + 1])) for i in range(frames)]
    peak = max(loud) if loud else 0
    if peak == 0:
        raise SystemExit("渲染出来是静音，检查采样路径和音符的键号")
    # 「听不见」的门槛按这条声音自己的峰值往下算，不按满刻度算
    floor = peak * 10 ** (-44 / 20)
    first = next(i for i, value in enumerate(loud) if value > floor)
    last = max(i for i, value in enumerate(loud) if value > floor)
    first = max(0, first - int(RATE * 0.004))
    last = min(frames - 1, last + int(RATE * 0.05), first + int(RATE * longest))
    gain = 32767 * 10 ** (target / 20) / peak
    fade = int(RATE * 0.06)
    out = array.array("h")
    for i in range(first, last + 1):
        ramp = min(1.0, (last - i) / fade)
        for channel in (0, 1):
            out.append(max(-32767, min(32767, int(samples[i * 2 + channel] * gain * ramp))))
    return out


# 音效混完都过一道低通，再看要不要混响（用户嫌过尖）
SOFT = ",lowpass=f=5600"
REVERB = ",aecho=0.8:0.85:70|130:0.22|0.14"


def effects() -> dict[str, tuple[list[Part], bool, float, float]]:
    """每个音效：几轨音符、要不要混响、峰值（dB）、最长多少秒。速度都按 120 拍算，一拍半秒。"""
    table: dict[str, tuple[list[Part], bool, float, float]] = {}
    # 吃鱼：连着吃的时候一条比一条高，六个音是一组五声音阶
    for i, name in enumerate(["E4", "G4", "A4", "B4", "D5", "E5"]):
        table[f"fish{i}"] = ([("kalimba", [(0, 0.6, key(name), 104)], 0.0), ("glock", [(0, 0.4, key(name) + 12, 48)], -16.0)], False, -6.0, 0.7)
    table["gold"] = ([("glock", [(0, 0.5, key("E5"), 90), (0.16, 0.5, key("G5"), 94), (0.32, 1.2, key("C6"), 100)], -3.0), ("chimes", [(0, 1.4, key("C5"), 80)], -5.0)], True, -5.0, 1.6)
    table["bolt"] = (
        [
            ("chimes", [(0, 1.6, key("C5"), 96), (0, 1.6, key("G5"), 90)], 0.0),
            ("glock", [(0.2, 0.4, key("C5"), 90), (0.4, 0.4, key("G5"), 94), (0.6, 1.2, key("C6"), 100)], -6.0),
            ("kit", [(0, 2, 62, 84)], -6.0),
        ],
        True,
        -5.0,
        2.0,
    )
    table["pad"] = (
        [
            ("marimba", [(0, 0.2, key("C4"), 96), (0.1, 0.2, key("E4"), 98), (0.2, 0.2, key("G4"), 102), (0.3, 0.6, key("C5"), 108)], 0.0),
            ("kit", [(0, 2, 62, 96)], -4.0),
        ],
        True,
        -5.0,
        1.6,
    )
    table["jump"] = ([("marimba", [(0, 0.15, key("G3"), 92), (0.14, 0.4, key("D4"), 100)], 0.0), ("kit", [(0, 0.3, 65, 70)], -8.0)], False, -8.0, 0.6)
    table["land"] = ([("kit", [(0, 0.5, 36, 84), (0, 0.3, 46, 60)], 0.0)], False, -9.0, 0.5)
    table["dash"] = ([("kit", [(0, 1.2, 60, 100), (0, 0.8, 56, 80)], 0.0)], True, -7.0, 1.3)
    # 穿过奖励圈：两声往上的钟琴，底下垫一下竖琴
    table["ring"] = ([("glock", [(0, 0.3, key("G5"), 90), (0.12, 0.9, key("D6"), 96)], -3.0), ("harp", [(0, 0.9, key("G4"), 90), (0.06, 0.9, key("D5"), 92)], -3.0)], True, -6.0, 1.1)
    # 弹簧垫：马林巴从低到高很快地滑上去，像「嘣」的一下
    table["spring"] = (
        [
            ("marimba", [(i * 0.045, 0.25, key(name), 96 + i * 3) for i, name in enumerate(["C3", "G3", "C4", "E4", "G4", "C5", "G5"])], 0.0),
            ("kit", [(0, 0.3, 65, 90), (0.28, 0.8, 60, 70)], -6.0),
        ],
        False,
        -6.0,
        1.0,
    )
    # 撞上路障：木箱鼓闷的一下，加一声铃鼓，像撞翻了什么
    table["bump"] = ([("kit", [(0, 0.5, 36, 110), (0.02, 0.4, 38, 96), (0.04, 0.5, 54, 92), (0.03, 0.3, 65, 84)], 0.0), ("marimba", [(0, 0.3, key("C3"), 100)], -4.0)], False, -6.0, 0.7)
    # 掉下悬崖：马林巴从高往低一路滑下去，最后箱鼓闷的一下
    table["fall"] = (
        [
            ("marimba", [(i * 0.07, 0.3, key(name), 100 - i * 4) for i, name in enumerate(["C5", "A4", "F4", "D4", "C4", "A3", "F3"])], 0.0),
            ("kit", [(0.55, 0.5, 36, 100), (0.56, 0.4, 54, 70)], -4.0),
        ],
        False,
        -7.0,
        1.1,
    )
    # 超级加速：竖琴一口气刮上去，接一串风铃，像一下子被风推走
    table["super"] = (
        [
            ("harp", [(i * 0.035, 0.6, key(name), 80 + i * 2) for i, name in enumerate(["C4", "E4", "G4", "A4", "C5", "D5", "E5", "G5", "A5", "C6"])], 0.0),
            ("chimes", [(0.36, 1.6, key("C5"), 84), (0.36, 1.6, key("G5"), 78)], -5.0),
            ("kit", [(0, 2, 62, 90), (0.36, 1.2, 60, 76)], -5.0),
        ],
        True,
        -6.0,
        2.0,
    )
    table["gate"] = ([("chimes", [(0, 1.4, key("E4"), 76), (0.5, 1.4, key("G4"), 80), (1.0, 2.4, key("C5"), 86)], 0.0)], True, -9.0, 2.6)
    table["bell"] = ([("kit", [(0, 0.5, 81, 100), (0.36, 1.2, 81, 108)], 0.0)], True, -7.0, 1.6)
    run_up = [(i * 0.25, 0.3, key(name), 96 + i * 4) for i, name in enumerate(["C5", "E5", "G5", "C6"])]
    chord = [(1.25, 2.4, key(name), 110) for name in ["C5", "E5", "G5", "C6"]]
    table["finish"] = (
        [
            ("marimba", run_up + chord, 0.0),
            ("glock", [(start, dur, note, 72) for start, dur, note, _ in run_up + chord], -12.0),
            ("chimes", [(1.25, 3, key("C4"), 90), (1.25, 3, key("G4"), 84)], -5.0),
            ("kit", [(1.25, 3, 64, 90)], -5.0),
        ],
        True,
        -4.0,
        4.2,
    )
    return table


def build_effects() -> dict[str, list[float]]:
    sprite = array.array("h")
    gap = array.array("h", [0] * (int(RATE * GAP) * 2))
    marks: dict[str, list[float]] = {}
    sprite.extend(gap)
    for name, (parts, reverb, target, longest) in effects().items():
        clip = shape(load(mix(name, 120, parts, SOFT + (REVERB if reverb else ""))), target, longest)
        marks[name] = [round(len(sprite) / 2 / RATE, 4), round(len(clip) / 2 / RATE, 4)]
        logger.info("音效 %-7s 长 %.2f 秒，平均响度 %.1f dB", name, marks[name][1], rms_db(clip))
        sprite.extend(clip)
        sprite.extend(gap)
    wav = WORK / "sfx.wav"
    save(wav, sprite)
    run(["ffmpeg", "-v", "error", "-y", "-i", str(wav), "-c:a", "libmp3lame", "-b:a", "128k", str(WORK / "sfx.mp3")])
    return marks


# 背景音乐：每个场景一首（用户要求「每个场景最好有不同的音乐」），调、速度、领奏乐器、伴奏和节奏型都不同，旋律按场景自己的种子生成。
# 用户嫌过早先那首「有点尖锐」：领奏是中音区的马林巴，后半圈还有钟琴在高八度跟着。现在领奏压在中音区、不用钟琴，混完再削一刀高频
BARS = 16
# 和弦级数 -> 根音离主音几个半音、大三还是小三
DEGREES = {
    "I": (0, "maj"), "ii": (2, "min"), "iii": (4, "min"), "IV": (5, "maj"), "V": (7, "maj"), "vi": (9, "min"),
    "i": (0, "min"), "iv": (5, "min"), "v": (7, "min"), "III": (3, "maj"), "VI": (8, "maj"), "VII": (10, "maj"),
}
PROGRESSIONS = {
    "maj": [
        ["I", "I", "vi", "vi", "IV", "IV", "V", "V", "I", "iii", "IV", "V", "vi", "IV", "V", "V"],
        ["I", "V", "vi", "IV", "I", "V", "IV", "IV", "vi", "IV", "I", "V", "vi", "IV", "ii", "V"],
        ["I", "IV", "I", "V", "vi", "IV", "ii", "V", "I", "IV", "iii", "vi", "ii", "IV", "V", "V"],
    ],
    "min": [
        ["i", "i", "VI", "VI", "III", "III", "VII", "VII", "i", "iv", "VI", "VII", "i", "iv", "v", "v"],
        ["i", "VII", "VI", "VII", "i", "VII", "VI", "v", "iv", "VI", "III", "VII", "iv", "VI", "v", "v"],
    ],
}
# 旋律用五声音阶（相对主音的半音数），不会有刺耳的半音
PENTA = {"maj": [0, 2, 4, 7, 9], "min": [0, 3, 5, 7, 10]}
# 两小节一句的节奏型：（句内第几拍，几拍长）。慢歌用后两种，音少一点
RHYTHMS = [
    [(0, 1), (1, 0.5), (1.5, 0.5), (2, 1), (3, 1), (4, 1.5), (5.5, 0.5), (6, 2)],
    [(0, 0.5), (0.5, 0.5), (1, 1), (2, 0.5), (2.5, 0.5), (3, 1), (4, 1), (5, 1), (6, 2)],
    [(0, 1.5), (1.5, 0.5), (2, 1), (3, 1), (4, 0.5), (4.5, 0.5), (5, 1), (6, 1.5), (7.5, 0.5)],
    [(0, 2), (2, 1), (3, 1), (4, 3), (7, 1)],
    [(0, 1), (1, 1), (2, 2), (4, 1.5), (5.5, 0.5), (6, 2)],
]

# 每个场景一首：场景名（和 scenes.ts 里的 name 一样）、文件名里用的短名、主音（领奏那个八度的键号）、大调小调、速度、
# 领奏、伴奏、节奏型、种子
SONGS = [
    ("海滨晨光", "beach", 62, "maj", 100, "flute", "harp", "light", 11),
    ("花田风车", "flower", 65, "maj", 106, "clarinet", "piano", "folk", 23),
    ("樱花大道", "sakura", 57, "min", 88, "piano", "harp", "soft", 37),
    ("松林小屋", "pine", 55, "maj", 92, "clarinet", "harp", "folk", 41),
    ("秋日山谷", "autumn", 64, "min", 94, "piano", "harp", "light", 53),
    ("沙漠峡谷", "desert", 62, "min", 96, "clarinet", "pizz", "light", 67),
    ("棕榈晚霞", "palm", 58, "maj", 90, "flute", "piano", "soft", 71),
    ("灯塔夜海", "lighthouse", 56, "maj", 80, "piano", "harp", "sparse", 83),
    ("霓虹都市", "neon", 57, "min", 108, "piano", "pizz", "dance", 97),
    ("极光雪原", "aurora", 64, "maj", 76, "flute", "harp", "sparse", 101),
    ("雪山黎明", "dawn", 60, "maj", 84, "piano", "harp", "soft", 113),
    ("气球之丘", "balloon", 67, "maj", 112, "flute", "pizz", "folk", 127),
    ("高山峡谷", "canyon", 62, "maj", 96, "clarinet", "harp", "folk", 131),
    ("溪谷飞瀑", "creek", 65, "maj", 88, "flute", "piano", "soft", 139),
    ("水晶洞穴", "cave", 54, "min", 78, "piano", "harp", "sparse", 149),
    ("云海断桥", "cloudbridge", 63, "maj", 98, "flute", "harp", "light", 163),
]
# 各轨相对音量（dB）。乐器都校准过了，这里的数字就是真正的大小关系：领奏最清楚，弦乐铺在底下，打击乐只是一点点
GAINS = {"lead": 0.0, "pad": -10.0, "comp": -9.0, "bass": -6.0, "drums": -13.0}
# 混完接的滤镜：大厅一样长一点的混响、轻轻削一点最高的频率、统一响度
MUSIC_CHAIN = ",aecho=0.8:0.88:110|210|330:0.24|0.18|0.12,lowpass=f=7000,loudnorm=I=-21:TP=-3:LRA=9,alimiter=limit=0.85"


def chord_notes(tonic: int, degree: str) -> list[int]:
    """这个和弦的三个音，放在主音往下一个八度那一组。"""
    root, quality = DEGREES[degree]
    base = tonic - 12 + root
    return [base, base + (4 if quality == "maj" else 3), base + 7]


def write_melody(tonic: int, mode: str, chords: list[str], slow: bool, random) -> list[Note]:
    """生成十六小节的旋律：八句、两小节一句，按 A A' B C A A' B' 尾 排。强拍落在和弦音上，其余按音阶一步一步走。"""
    scale = sorted({tonic + octave * 12 + step for octave in (-1, 0, 1) for step in PENTA[mode]})
    scale = [note for note in scale if tonic - 3 <= note <= tonic + 16]

    def phrase(start_bar: int, rhythm: list[tuple[float, float]], last: int) -> list[tuple[float, float, int]]:
        out: list[tuple[float, float, int]] = []
        for index, (beat, dur) in enumerate(rhythm):
            bar = start_bar + int(beat // 4)
            tones = {note % 12 for note in chord_notes(tonic, chords[bar])}
            strong = beat % 2 == 0
            if strong or index == len(rhythm) - 1:
                near = sorted((note for note in scale if note % 12 in tones), key=lambda note: abs(note - last) + random() * 3)
                pick = near[0]
                # 句尾落在和弦根音上，听着像说完了一句
                if index == len(rhythm) - 1:
                    root = (chord_notes(tonic, chords[bar])[0]) % 12
                    roots = [note for note in scale if note % 12 == root]
                    # 根音不在五声音阶里（比如四级和弦）就落在最近的和弦音上
                    if roots:
                        pick = min(roots, key=lambda note: abs(note - last))
            else:
                at = min(range(len(scale)), key=lambda i: abs(scale[i] - last))
                move = random.choice([-2, -1, -1, 1, 1, 2])
                pick = scale[max(0, min(len(scale) - 1, at + move))]
            out.append((beat, dur, pick))
            last = pick
        return out

    pool = [3, 4] if slow else [0, 1, 2, 4]
    pick_rhythm = lambda: RHYTHMS[pool[int(random() * len(pool))]]
    a = phrase(0, pick_rhythm(), tonic + 4)
    # A' 前一小节和 A 一样，后一小节换个说法
    head = [note for note in a if note[0] < 4]
    a2 = head + [note for note in phrase(2, pick_rhythm(), head[-1][2]) if note[0] >= 4]
    b = phrase(4, pick_rhythm(), tonic + 7)
    c = phrase(6, pick_rhythm(), b[-1][2])
    b2 = phrase(12, pick_rhythm(), tonic + 9)
    end = phrase(14, pick_rhythm(), b2[-1][2])
    notes: list[Note] = []
    for at, body in [(0, a), (8, a2), (16, b), (24, c), (32, a), (40, a2), (48, b2), (56, end)]:
        for beat, dur, note in body:
            notes.append((at + beat, dur, note, 78 if beat % 2 == 0 else 68))
    return notes


class Seeded:
    """固定种子的随机数，同一个场景每次生成都是同一首。"""

    def __init__(self, seed: int) -> None:
        self.state = seed * 2654435761 % 4294967296

    def __call__(self) -> float:
        self.state = (self.state * 1664525 + 1013904223) % 4294967296
        return self.state / 4294967296

    def choice(self, items: list[int]) -> int:
        return items[int(self() * len(items))]


def one_loop(offset: float, tonic: int, chords: list[str], melody: list[Note], comp: str, groove: str, slow: bool) -> dict[str, list[Note]]:
    """一圈 16 小节里每一轨弹什么，offset 是这一圈从第几拍开始。
    领奏、弦乐铺底、低音、伴奏、一点点打击乐。都是轻的力度，没有敲得很脆的东西"""
    bass: list[Note] = []
    pad: list[Note] = []
    backing: list[Note] = []
    drums: list[Note] = []
    for bar, degree in enumerate(chords):
        low, mid, top = chord_notes(tonic, degree)
        start = offset + bar * 4
        # 弦乐组：每小节一个长和弦，慢慢起来，垫在底下
        pad += [(start, 4.1, note + 12, 48) for note in (low, mid, top)]
        # 低音：慢歌是大提琴拉长音；快一点的是低音提琴拨弦，一拍和三拍
        if slow:
            bass.append((start, 4.1, low - 12, 56))
        else:
            bass += [(start, 1.5, low - 12, 70), (start + 2, 1.5, low - 12, 60)]
        if comp == "harp":
            # 竖琴：八分音符的分解和弦
            for step, note in enumerate([low, top, mid + 12, top, low + 12, top, mid + 12, top]):
                backing.append((start + step * 0.5, 1.5, note, 58 if step % 2 == 0 else 46))
        elif comp == "piano":
            # 钢琴：四分音符的分解和弦，轻轻地
            for beat, note in enumerate((low, top, mid + 12, top)):
                backing.append((start + beat, 1.2, note, 52 if beat == 0 else 42))
        else:
            # 拨弦：反拍上一下一下的和弦音
            for beat, note in ((0.5, mid), (1.5, top), (2.5, mid), (3.5, top)):
                backing.append((start + beat, 0.5, note + 12, 54))
        if groove == "light":
            for step in range(8):
                drums.append((start + step * 0.5, 0.25, 42 if step % 2 == 0 else 44, 40 if step % 2 == 0 else 28))
            drums += [(start, 0.5, 36, 58), (start + 2.5, 0.5, 36, 44)]
        elif groove == "folk":
            drums += [(start, 0.5, 36, 60), (start + 2, 0.5, 36, 52)]
            drums += [(start + beat, 0.25, 44, 32) for beat in (0.5, 1.5, 2.5, 3.5)]
        elif groove == "dance":
            drums += [(start + beat, 0.5, 36, 58) for beat in range(4)]
            drums += [(start + beat + 0.5, 0.25, 44, 34) for beat in range(4)]
        elif groove == "soft":
            drums += [(start, 0.5, 36, 46), (start + 2, 0.25, 44, 30)]
            if bar % 4 == 0:
                drums.append((start, 2, 64, 44))
        else:
            if bar % 4 == 0:
                drums.append((start, 2, 64, 42))
    lead = [(offset + beat, dur, note, vel) for beat, dur, note, vel in melody]
    return {"lead": lead, "pad": pad, "comp": backing, "bass": bass, "drums": drums}


def build_song(slug: str, tonic: int, mode: str, bpm: float, lead: str, comp: str, groove: str, seed: int) -> dict[str, float]:
    random = Seeded(seed)
    chords = PROGRESSIONS[mode][int(random() * len(PROGRESSIONS[mode]))]
    slow = bpm < 92
    melody = write_melody(tonic, mode, chords, slow, random)
    # 长笛在低音区发虚，旋律整体抬一个八度
    if lead == "flute" and tonic < 64:
        melody = [(beat, dur, note + 12, vel) for beat, dur, note, vel in melody]
    # 管乐和钢琴领奏都压轻一点
    melody = [(beat, dur, note, vel - 8) for beat, dur, note, vel in melody]
    beats = BARS * 4
    length = beats * 60 / bpm
    # 连着渲三圈，取中间那一圈：它的开头带着上一圈的余音，接起来才没有缝
    tracks: dict[str, list[Note]] = {}
    for turn in range(3):
        for name, notes in one_loop(turn * beats, tonic, chords, melody, comp, groove, slow).items():
            tracks.setdefault(name, []).extend(notes)
    instruments = {"lead": lead, "pad": "strings", "comp": comp, "bass": "cello" if slow else "pizz", "drums": "kit"}
    parts: list[Part] = [(instruments[name], tracks[name], GAINS[name]) for name in ("lead", "pad", "comp", "bass", "drums")]
    full = mix(f"bgm_{slug}_full", bpm, parts, MUSIC_CHAIN)
    cut = WORK / f"bgm_{slug}_cut.wav"
    run(["ffmpeg", "-v", "error", "-y", "-ss", f"{length - BGM_PAD:.5f}", "-t", f"{length + BGM_PAD * 2:.5f}", "-i", str(full), "-c:a", "pcm_s16le", "-ac", "2", "-ar", str(RATE), str(cut)])
    run(["ffmpeg", "-v", "error", "-y", "-i", str(cut), "-c:a", "libmp3lame", "-b:a", "96k", str(WORK / f"bgm_{slug}.mp3")])
    samples = load(cut)
    edge = int(RATE * 0.05) * 2
    head = int(RATE * BGM_PAD) * 2
    tail = head + int(RATE * length) * 2
    logger.info(
        "配乐 %-10s 一圈 %.1f 秒，平均 %.1f dB，峰值 %.1f dB，循环点 %.1f / %.1f dB",
        slug, length, rms_db(samples), peak_db(samples), rms_db(samples[head : head + edge]), rms_db(samples[tail : tail + edge]),
    )
    return {"loopStart": BGM_PAD, "loopEnd": round(BGM_PAD + length, 5)}


def build_music(only: set[str] | None = None, old: dict | None = None) -> tuple[dict[str, dict[str, float]], dict[str, str]]:
    songs: dict[str, dict[str, float]] = {}
    scenes: dict[str, str] = {}
    for name, slug, tonic, mode, bpm, lead, comp, groove, seed in SONGS:
        scenes[name] = slug
        if only and slug not in only and old and slug in old:
            songs[slug] = old[slug]
            continue
        songs[slug] = build_song(slug, tonic, mode, bpm, lead, comp, groove, seed)
    return songs, scenes


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    if not mr.SFIZZ.exists():
        raise SystemExit(f"没有 {mr.SFIZZ}，先在 video-studio 里装好 sfizz")
    WORK.mkdir(parents=True, exist_ok=True)
    DEST.mkdir(parents=True, exist_ok=True)
    # 后面跟几首的短名就只重渲这几首，其余沿用上次的循环点
    only = set(sys.argv[1:]) or None
    target = DEST / "audio.json"
    previous = json.loads(target.read_text(encoding="utf8")) if target.exists() else {}
    prepare()
    marks = build_effects()
    songs, scenes = build_music(only, previous.get("songs"))
    now = time.strftime("%Y%m%d%H%M")
    stamp = previous.get("stamp", now)
    target.write_text(json.dumps({"stamp": stamp, "version": now, "sfx": marks, "songs": songs, "scenes": scenes}, ensure_ascii=False, indent=2) + "\n", encoding="utf8")
    for path in sorted(WORK.glob("*.mp3")):
        logger.info("%s  %d KB", path.name, path.stat().st_size // 1024)


if __name__ == "__main__":
    main()
