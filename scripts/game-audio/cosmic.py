"""星海漫游的配乐和音效：和鹈鹕骑车同一套做法，用真实乐器采样渲染，不用手算波形。

乐器校准、渲染、混音这些都借 pelican.py 的（同一个 video-studio、同一份 sfizz 和采样），只是中间文件放在 out/cosmic/，
曲子和音效是这里自己写的。

    python scripts/game-audio/cosmic.py

产出：scripts/game-audio/out/cosmic/ 里的 sfx.mp3、bgm_cosmos.mp3、bgm_galaxy.mp3（不入库），src/game/cosmic/audio/audio.json。
传到 OSS：python scripts/game-audio/upload.py --game cosmic

2026-11-18 用户要的：宇宙的「浩渺虚幻感」，不要尖锐；音效要小、不影响音乐，音乐也不要太大，不用做复杂。
所以配乐只有两首（星际航行一首、靠近黑洞一首），慢、稀、回声长；音效只用竖琴、钢琴、弦乐的中低音区，
全落在 D 大调五声音阶上（D E F# A B），和两首配乐都不打架。
"""
from __future__ import annotations

import array
import json
import logging
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import pelican as base  # noqa: E402
from pelican import RATE, GAP, BGM_PAD, Note, Part, key, load, mix, peak_db, rms_db, run, save, shape  # noqa: E402

logger = logging.getLogger(__name__)

ROOT = Path(__file__).resolve().parents[2]
WORK = Path(__file__).resolve().parent / "out" / "cosmic"
DEST = ROOT / "src" / "game" / "cosmic" / "audio"

# 音效：低通压在 3600 Hz，回声比鹈鹕的长一些（空旷）
SOFT = ",lowpass=f=3600"
SPACE = ",aecho=0.8:0.88:120|260|420:0.26|0.18|0.12"


def effects() -> dict[str, tuple[list[Part], float, float]]:
    """每个音效：几轨音符、峰值（dB）、最长多少秒。速度按 120 拍算，一拍半秒。都带回声。"""
    table: dict[str, tuple[list[Part], float, float]] = {}
    # 穿星门：竖琴一个音，底下垫一个低八度的轻音；连着穿一路往上走七个音（D 大调五声音阶，最高到 E5）
    for i, name in enumerate(["D4", "E4", "F#4", "A4", "B4", "D5", "E5"]):
        note = key(name)
        table[f"ring{i}"] = ([("harp", [(0, 0.8, note, 82), (0.02, 1.2, note - 12, 64)], 0.0)], -11.0, 1.6)
    # 收录藏品：钢琴和竖琴同一个音，收得越多越高（中低音区，最高 A4）
    for i, name in enumerate(["A3", "B3", "D4", "E4", "F#4", "A4"]):
        note = key(name)
        table[f"relic{i}"] = ([("piano", [(0, 1.4, note, 70)], 0.0), ("harp", [(0, 1.0, note, 68)], -6.0)], -10.0, 2.0)
    # 点亮一整个星系：竖琴慢慢分解上去，接钢琴一个和弦，底下弦乐轻轻铺一下
    table["hub"] = (
        [
            ("harp", [(i * 0.18, 2.0, key(n), 66 + i * 3) for i, n in enumerate(["D3", "A3", "D4", "F#4", "A4"])], 0.0),
            ("piano", [(0.95, 3.0, key(n), 62) for n in ("D3", "A3", "F#4")], -3.0),
            ("strings", [(0.6, 3.0, key(n), 50) for n in ("D4", "A4")], -10.0),
        ],
        -9.0,
        3.4,
    )
    # 引力弹弓：竖琴从低往高一口气刮上去，弦乐跟着涨上来，像被甩出去
    gliss = ["D3", "E3", "F#3", "A3", "B3", "D4", "E4", "F#4", "A4", "B4", "D5"]
    table["slingshot"] = (
        [
            ("harp", [(i * 0.035, 1.2, key(n), 62 + i * 2) for i, n in enumerate(gliss)], 0.0),
            ("strings", [(0.0, 2.6, key(n), 54) for n in ("D3", "A3")], -7.0),
        ],
        -10.0,
        2.8,
    )
    # 到终点：竖琴四个音往上，接钢琴和弦、弦乐和大提琴铺满
    run_up = [(i * 0.3, 0.9, key(n), 72 + i * 3) for i, n in enumerate(["D4", "F#4", "A4", "D5"])]
    table["finish"] = (
        [
            ("harp", run_up, 0.0),
            ("piano", [(1.3, 3.6, key(n), 66) for n in ("D3", "A3", "D4", "F#4", "A4")], -2.0),
            ("strings", [(1.1, 3.8, key(n), 54) for n in ("D3", "F#3", "A3")], -8.0),
            ("cello", [(1.1, 3.8, key("D2"), 56)], -6.0),
        ],
        -8.0,
        5.2,
    )
    return table


def build_effects() -> dict[str, list[float]]:
    sprite = array.array("h")
    gap = array.array("h", [0] * (int(RATE * GAP) * 2))
    marks: dict[str, list[float]] = {}
    sprite.extend(gap)
    for name, (parts, target, longest) in effects().items():
        clip = shape(load(mix(name, 120, parts, SOFT + SPACE)), target, longest)
        marks[name] = [round(len(sprite) / 2 / RATE, 4), round(len(clip) / 2 / RATE, 4)]
        logger.info("音效 %-10s 长 %.2f 秒，平均响度 %.1f dB", name, marks[name][1], rms_db(clip))
        sprite.extend(clip)
        sprite.extend(gap)
    wav = WORK / "sfx.wav"
    save(wav, sprite)
    run(["ffmpeg", "-v", "error", "-y", "-i", str(wav), "-c:a", "libmp3lame", "-b:a", "96k", str(WORK / "sfx.mp3")])
    return marks


# 配乐：每个和弦停四小节（4/4 拍），八个和弦一圈。和弦写成 (低音, 铺底的几个音)
SONGS = [
    {
        # 星际航行：D 利底亚调式（升四级那个 G# 是「飘」的来源），开阔、亮一点
        "slug": "cosmos",
        "bpm": 60,
        "seed": 41,
        "chords": [
            ("D2", ["F#3", "A3", "C#4", "E4"]),
            ("D2", ["E3", "G#3", "B3", "E4"]),
            ("B1", ["F#3", "A3", "D4", "E4"]),
            ("G1", ["F#3", "B3", "D4", "E4"]),
            ("D2", ["F#3", "A3", "C#4", "E4"]),
            ("E2", ["G#3", "B3", "D4", "F#4"]),
            ("G2", ["F#3", "A3", "B3", "D4"]),
            ("A1", ["E3", "A3", "C#4", "E4"]),
        ],
        # 钢琴落音用的音阶（中音区，最高 C#5，不往上走）
        "scale": ["D4", "E4", "F#4", "G#4", "A4", "B4", "C#5"],
        # 每个和弦里钢琴落几个音
        "notes": (3, 4),
        # 哪几个和弦开头有竖琴分解
        "harp": {0, 2, 4, 6},
    },
    {
        # 靠近黑洞：B 小调（自然小调），更深更暗、更稀
        "slug": "galaxy",
        "bpm": 56,
        "seed": 73,
        "chords": [
            ("B1", ["D3", "F#3", "A3", "C#4"]),
            ("G1", ["D3", "G3", "B3", "F#4"]),
            ("E2", ["E3", "G3", "B3", "F#4"]),
            ("F#2", ["C#3", "F#3", "B3", "C#4"]),
            ("B1", ["D3", "F#3", "A3", "C#4"]),
            ("D2", ["D3", "F#3", "A3", "E4"]),
            ("G1", ["D3", "G3", "B3", "F#4"]),
            ("F#2", ["C#3", "F#3", "A#3", "C#4"]),
        ],
        "scale": ["B3", "C#4", "D4", "E4", "F#4", "A4", "B4"],
        "notes": (2, 3),
        "harp": {0, 4},
    },
]

CHORD_BEATS = 16
# 各轨相对音量（dB）：钢琴领，弦乐铺底，大提琴托低音，竖琴点缀
GAINS = {"piano": 0.0, "strings": -8.0, "cello": -7.0, "harp": -11.0}
# 混完：很长的回声（空旷）、低通 4200 Hz、响度压到 -23（比鹈鹕的 -21 再小一点，用户要「音乐声音也不要太大」）
MUSIC_CHAIN = ",aecho=0.8:0.9:240|480|720|960:0.3|0.22|0.15|0.1,lowpass=f=4200,loudnorm=I=-23:TP=-4:LRA=9,alimiter=limit=0.8"


def one_loop(offset: float, song: dict, melody: list[Note]) -> dict[str, list[Note]]:
    tracks: dict[str, list[Note]] = {"piano": [], "strings": [], "cello": [], "harp": []}
    for i, (bass, pad) in enumerate(song["chords"]):
        start = offset + i * CHORD_BEATS
        # 铺底和低音比和弦长一点点，和下一个和弦叠着过去，不留缝
        tracks["strings"] += [(start, CHORD_BEATS + 0.6, key(n), 44) for n in pad]
        low = key(bass)
        # 大提琴最低只到 C2，再低就抬一个八度
        tracks["cello"].append((start, CHORD_BEATS + 0.6, low + 12 if low < key("C2") else low, 50))
        if i in song["harp"]:
            tracks["harp"] += [(start + j * 0.5, 6, key(n), 50 + j * 2) for j, n in enumerate(pad)]
    tracks["piano"] = [(offset + beat, dur, note, vel) for beat, dur, note, vel in melody]
    return tracks


def write_melody(song: dict) -> list[Note]:
    """每个和弦里钢琴落几个音，挑的位置和音都按种子随机，和弦一开头那个音落在铺底的和弦音上。"""
    random = base.Seeded(song["seed"])
    scale = [key(n) for n in song["scale"]]
    low, high = song["notes"]
    melody: list[Note] = []
    for i, (_, pad) in enumerate(song["chords"]):
        start = i * CHORD_BEATS
        count = low + int(random() * (high - low + 1))
        slots = sorted({0, *[random.choice([3, 5, 6, 8, 10, 11, 13]) for _ in range(count - 1)]})
        chord_tones = [n for n in scale if any((n - key(p)) % 12 == 0 for p in pad)] or scale
        last = None
        for j, beat in enumerate(slots):
            pool = chord_tones if j == 0 else scale
            note = random.choice(pool)
            # 不连着弹同一个音
            if note == last and len(pool) > 1:
                note = pool[(pool.index(note) + 1) % len(pool)]
            last = note
            nxt = slots[j + 1] if j + 1 < len(slots) else CHORD_BEATS
            melody.append((start + beat, max(2.0, nxt - beat + 1.5), note, 50 + int(random() * 10)))
    return melody


def build_song(song: dict) -> dict[str, float]:
    slug = song["slug"]
    bpm = song["bpm"]
    beats = CHORD_BEATS * len(song["chords"])
    length = beats * 60 / bpm
    melody = write_melody(song)
    # 连着渲三圈，取中间那一圈：它的开头带着上一圈的余音和回声，接起来才没有缝
    tracks: dict[str, list[Note]] = {}
    for turn in range(3):
        for name, notes in one_loop(turn * beats, song, melody).items():
            tracks.setdefault(name, []).extend(notes)
    parts: list[Part] = [(name, notes, GAINS[name]) for name, notes in tracks.items() if notes]
    full = mix(f"bgm_{slug}_full", bpm, parts, MUSIC_CHAIN)
    cut = WORK / f"bgm_{slug}_cut.wav"
    run(["ffmpeg", "-v", "error", "-y", "-ss", f"{length - BGM_PAD:.5f}", "-t", f"{length + BGM_PAD * 2:.5f}", "-i", str(full), "-c:a", "pcm_s16le", "-ac", "2", "-ar", str(RATE), str(cut)])
    run(["ffmpeg", "-v", "error", "-y", "-i", str(cut), "-c:a", "libmp3lame", "-b:a", "96k", str(WORK / f"bgm_{slug}.mp3")])
    samples = load(cut)
    edge = int(RATE * 0.05) * 2
    head = int(RATE * BGM_PAD) * 2
    tail = head + int(RATE * length) * 2
    logger.info(
        "配乐 %-7s 一圈 %.1f 秒，平均 %.1f dB，峰值 %.1f dB，循环点 %.1f / %.1f dB",
        slug, length, rms_db(samples), peak_db(samples), rms_db(samples[head : head + edge]), rms_db(samples[tail : tail + edge]),
    )
    return {"loopStart": BGM_PAD, "loopEnd": round(BGM_PAD + length, 5)}


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    if not base.mr.SFIZZ.exists():
        raise SystemExit(f"没有 {base.mr.SFIZZ}，先在 video-studio 里装好 sfizz")
    WORK.mkdir(parents=True, exist_ok=True)
    DEST.mkdir(parents=True, exist_ok=True)
    # pelican.py 的渲染函数都往它的 WORK 里写，换成这里的目录，免得和鹈鹕的 sfx.mp3 撞名
    base.WORK = WORK
    target = DEST / "audio.json"
    previous = json.loads(target.read_text(encoding="utf8")) if target.exists() else {}
    base.prepare()
    marks = build_effects()
    songs = {song["slug"]: build_song(song) for song in SONGS}
    now = time.strftime("%Y%m%d%H%M")
    stamp = previous.get("stamp", now)
    target.write_text(json.dumps({"stamp": stamp, "version": now, "sfx": marks, "songs": songs}, ensure_ascii=False, indent=2) + "\n", encoding="utf8")
    for path in sorted(WORK.glob("*.mp3")):
        logger.info("%s  %d KB", path.name, path.stat().st_size // 1024)


if __name__ == "__main__":
    main()
