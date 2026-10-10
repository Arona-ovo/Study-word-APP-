# 一次性脚本：从收款码海报里裁出纯二维码（PIL only，无 numpy）
from PIL import Image
import os

OUT = r"C:\Users\33156\WorkBuddy\2026-10-06-17-27-44\uniapp\static\donate"
os.makedirs(OUT, exist_ok=True)

def profile(im, axis):
    """dark 像素占比曲线：axis=0 → 每行；axis=1 → 每列"""
    b = im.point(lambda v: 255 if v < 80 else 0)
    w, h = im.size
    if axis == 0:
        small = b.resize((1, h), Image.BOX)
        return [small.getpixel((0, y)) / 255.0 for y in range(h)]
    small = b.resize((w, 1), Image.BOX)
    return [small.getpixel((x, 0)) / 255.0 for x in range(w)]

def largest_band(fracs, th):
    bands, start = [], None
    for i, f in enumerate(fracs):
        if f > th:
            if start is None:
                start = i
        else:
            if start is not None:
                bands.append((start, i - 1))
                start = None
    if start is not None:
        bands.append((start, len(fracs) - 1))
    return max(bands, key=lambda b: b[1] - b[0]) if bands else (0, len(fracs) - 1)

def find_qr_band(g, im_h):
    """二维码带应占图高 1/4 以上；阈值从紧到松试，第一个够高的带胜出"""
    for th in (0.15, 0.12, 0.10, 0.08, 0.06, 0.04):
        r0, r1 = largest_band(profile(g, 0), th)
        if r1 - r0 > im_h * 0.25:
            return th, r0, r1
    return None, 0, 0

def crop_qr(src, dst):
    im = Image.open(src).convert('RGB')
    g = im.convert('L')
    th, r0, r1 = find_qr_band(g, im.height)
    c0, c1 = largest_band(profile(g.crop((0, r0, im.width, r1 + 1)), 1), th)
    print(os.path.basename(src), 'th', th, 'box', (c0, r0, c1, r1), 'w', c1 - c0, 'h', r1 - r0)
    assert abs((c1 - c0) - (r1 - r0)) < max(c1 - c0, r1 - r0) * 0.15, '不是正方形，检测失败'
    # 四周留静区（白边），再补成正方形白底。
    # 下边要防「名字文字」贴进来：先找 QR 下方第一行深色像素（文字顶），
    # 下边距最多留到文字上方 6px。
    m = int(max(c1 - c0, r1 - r0) * 0.08)
    gp = profile(g, 0)
    text_top = None
    for y in range(r1 + 1, min(im.height, r1 + 200)):
        if gp[y] > 0.03:
            text_top = y
            break
    mb = m if text_top is None else max(6, min(m, text_top - r1 - 6))
    box = (max(0, c0 - m), max(0, r0 - m), min(im.width, c1 + m), min(im.height, r1 + mb))
    qr = im.crop(box)
    side = max(qr.size)
    sq = Image.new('RGB', (side, side), (255, 255, 255))
    sq.paste(qr, ((side - qr.width) // 2, (side - qr.height) // 2))
    sq.save(dst)
    print(' ->', dst, sq.size)

crop_qr(r"C:\Users\33156\Downloads\1791456707258.jpg", os.path.join(OUT, "alipay-qr.png"))
crop_qr(r"C:\Users\33156\Downloads\mm_facetoface_collect_qrcode_1791456569181.png", os.path.join(OUT, "wechat-qr.png"))
