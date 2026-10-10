# _tools/gen-sfx.py - 合成答题音效（正确 / 半对 / 错误）到 uniapp/static/sfx/
#
# 为什么自己合成而不是找素材：
#   1) 没有版权与署名问题，可以随包分发；
#   2) 三个音效用同一套音色参数生成，听感是一家人；
#   3) 想调音色改参数重跑即可，不用再找素材。
#
# 音色取向：短促、干净、不刺耳 —— 答题时会连续触发，任何"有攻击性"的
# 音色听十几遍都会烦。所以全部用正弦叠少量谐波 + 指数衰减（钟琴/木琴感），
# 错误音刻意压低音高与音量，做成"提醒"而不是"惩罚"。
#
# 运行：python _tools/gen-sfx.py
import math
import os
import struct
import wave

RATE = 22050          # 采样率：足够还原这几个音，又不至于把包撑大
OUT = os.path.join(os.path.dirname(__file__), '..', 'uniapp', 'static', 'sfx')


def env(t, dur, attack=0.006):
    """包络：极短 attack（避免咔哒声） + 指数衰减"""
    if t < 0 or t > dur:
        return 0.0
    a = 1.0 - math.exp(-t / attack) if attack > 0 else 1.0
    d = math.exp(-3.2 * t / dur)
    # 末尾 30ms 强制淡出，杜绝截断爆音
    tail = max(0.0, min(1.0, (dur - t) / 0.03))
    return a * d * tail


def tone(t, freq, harmonics=(1.0, 0.34, 0.12)):
    """基频 + 2/3 次谐波，让单音有"实体感"而不是纯电子哔声"""
    s = 0.0
    for i, amp in enumerate(harmonics, start=1):
        s += amp * math.sin(2 * math.pi * freq * i * t)
    return s / sum(harmonics)


def render(notes, total, gain=0.72):
    """notes: [(start, freq, dur, amp)]"""
    n = int(RATE * total)
    buf = []
    for i in range(n):
        t = i / RATE
        v = 0.0
        for (start, freq, dur, amp) in notes:
            local = t - start
            if 0 <= local <= dur:
                v += amp * tone(local, freq) * env(local, dur)
        v *= gain
        v = max(-1.0, min(1.0, v))
        buf.append(int(v * 32000))
    return buf


def write(name, samples):
    os.makedirs(OUT, exist_ok=True)
    p = os.path.join(OUT, name)
    with wave.open(p, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(b''.join(struct.pack('<h', s) for s in samples))
    print('  %-12s %5.1f KB  %.2fs' % (name, os.path.getsize(p) / 1024, len(samples) / RATE))


# 正确：上行大三和弦琶音 C6-E6-G6，明亮但不尖锐
write('correct.wav', render([
    (0.000, 1046.50, 0.19, 1.00),
    (0.072, 1318.51, 0.19, 0.92),
    (0.144, 1567.98, 0.24, 0.86),
], total=0.40, gain=0.66))

# 半对：单音，音高居中、时值最短 —— "注意到了，但还不算过"
write('partial.wav', render([
    (0.000, 880.00, 0.16, 1.00),
], total=0.20, gain=0.58))

# 错误：下行小三度 Bb3-Ab3，低沉、音量更低 —— 是提醒不是惩罚
write('wrong.wav', render([
    (0.000, 233.08, 0.20, 1.00),
    (0.085, 207.65, 0.26, 0.90),
], total=0.38, gain=0.52))

print('输出目录:', os.path.abspath(OUT))
