# _tools/gen-splash.py - 生成 Android 原生启动图（与 pages/cover/cover.vue 首屏同色同构）
#
# 为什么要有这个脚本：
#   App 的原生启动界面（splash）必须是静态 png，不能播动画（见 uni-app 文档：
#   "splash只能是标准png，不要用jpg改名为png。也不支持gif等动画"）。
#   用户自己那套启动动画是 pages/cover/cover.vue 这个页面，只能等 splash 关闭后才渲染。
#   两者视觉若不一致，开屏就是"绿底图标 → 浅蓝动画页"的硬切。
#   这里按 cover 首屏的设计稿（750rpx 基准）逐项复刻成静态图，
#   让 splash → cover 的过渡看起来像同一动画的两帧。
#
# 用法：python gen-splash.py      （输出到 ../uniapp/static/splash/）
#
# 尺寸取自 uni-app 官方 manifest 说明：
#   hdpi 480x762 / xhdpi 720x1242；xxhdpi 1080x1882 为社区通用做法（一并生成）。
from PIL import Image, ImageDraw, ImageFilter, ImageFont
import math
import os

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'uniapp', 'static', 'splash')
MASCOT = os.path.join(HERE, '..', 'uniapp', 'static', 'mascot', 'arona-hi.jpg')
FONT_BOLD = 'C:/Windows/Fonts/georgiab.ttf'
FONT_REG = 'C:/Windows/Fonts/georgia.ttf'

DESIGN_W = 750            # 设计稿基准宽度（rpx）
GRAD_COLORS = [(0.00, (242, 247, 255)), (0.52, (224, 236, 255)), (1.00, (207, 224, 255))]
GRAD_DEG = 165            # CSS: linear-gradient(165deg, ...)

BRAND = (29, 79, 216)
INK = (23, 32, 26)


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def grad_color(t):
    t = max(0.0, min(1.0, t))
    for i in range(len(GRAD_COLORS) - 1):
        t0, c0 = GRAD_COLORS[i]
        t1, c1 = GRAD_COLORS[i + 1]
        if t0 <= t <= t1:
            return lerp(c0, c1, (t - t0) / (t1 - t0) if t1 > t0 else 0)
    return GRAD_COLORS[-1][1]


def make_gradient(w, h):
    """按 CSS 角度算线性渐变。低分辨率逐像素算准，再放大（渐变本身是平滑的，放大无损观感）。"""
    lw, lh = max(2, w // 8), max(2, h // 8)
    rad = math.radians(GRAD_DEG)
    dx, dy = math.sin(rad), -math.cos(rad)   # CSS 0deg = to top，顺时针为正
    # 四个角在方向向量上的投影范围
    projs = [(x * dx + y * dy) for x in (0, lw) for y in (0, lh)]
    lo, hi = min(projs), max(projs)
    span = (hi - lo) or 1
    small = Image.new('RGB', (lw, lh))
    px = small.load()
    for y in range(lh):
        for x in range(lw):
            px[x, y] = grad_color(((x * dx + y * dy) - lo) / span)
    return small.resize((w, h), Image.BILINEAR)


def text_w(draw, s, font, ls):
    """带字距的文本宽度"""
    if not s:
        return 0
    w = sum(draw.textlength(ch, font=font) for ch in s)
    return w + ls * (len(s) - 1)


def draw_spaced(draw, cx, y, s, font, fill, ls):
    """居中 + 字距绘制"""
    w = text_w(draw, s, font, ls)
    x = cx - w / 2
    for ch in s:
        draw.text((x, y), ch, font=font, fill=fill)
        x += draw.textlength(ch, font=font) + ls
    return w


def circle_mask(size, ss):
    m = Image.new('L', (size * ss, size * ss), 0)
    ImageDraw.Draw(m).ellipse((0, 0, size * ss - 1, size * ss - 1), fill=255)
    return m.resize((size, size), Image.LANCZOS)


def render(w, h, out_path, ss=2):
    S = (w / DESIGN_W) * ss       # rpx -> px（含超采样倍率）
    W, H = w * ss, h * ss
    img = make_gradient(W, H)

    def R(v):                     # rpx → px
        return v * S

    pad_top = R(180)
    stage = R(340)
    ring_bw = max(2, round(R(3)))
    mascot = R(320)
    cx = W / 2

    # ---- 光晕：ring 内侧的柔和品牌色投影（近似 cover 的 box-shadow）
    sh = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(sh).ellipse(
        (cx - stage / 2, pad_top + R(8), cx + stage / 2, pad_top + stage + R(8)),
        fill=(46, 107, 255, 60))
    sh = sh.filter(ImageFilter.GaussianBlur(R(18)))
    img = Image.alpha_composite(img.convert('RGBA'), sh).convert('RGB')

    # ---- 吉祥物（圆形裁剪 + 白底圆）
    face = Image.open(MASCOT).convert('RGB')
    side = min(face.size)
    face = face.crop(((face.width - side) // 2, (face.height - side) // 2,
                      (face.width + side) // 2, (face.height + side) // 2))
    msz = int(round(mascot))
    face = face.resize((msz, msz), Image.LANCZOS)
    img.paste(face, (int(round(cx - msz / 2)), int(round(pad_top + (stage - mascot) / 2))),
              circle_mask(msz, ss))

    d = ImageDraw.Draw(img)

    # ---- 外圈
    d.ellipse((cx - stage / 2, pad_top, cx + stage / 2, pad_top + stage),
              outline=(46, 107, 255, 102), width=ring_bw)

    # ---- 品牌文字
    y = pad_top + stage + R(72)
    f_name = ImageFont.truetype(FONT_BOLD, max(8, round(R(46))))
    draw_spaced(d, cx, y, 'ENGLISH TRAINER', f_name, BRAND, R(10))
    y += round(R(46) * 1.2) + R(36)

    d.line((cx - R(64) / 2, y, cx + R(64) / 2, y), fill=(46, 107, 255, 97), width=max(1, round(R(2))))
    y += R(32)

    f_en = ImageFont.truetype(FONT_REG, max(7, round(R(20))))
    draw_spaced(d, cx, y, 'FUJIAN \u00b7 TRANSLATION PRACTICE', f_en, (29, 79, 216), R(5))

    # ---- 底部进度槽（cover 页那条进度条的空槽，位置一致，便于动画接管）
    by = H - R(100) - R(4)
    d.rounded_rectangle((cx - R(240) / 2, by, cx + R(240) / 2, by + max(2, round(R(4)))),
                        radius=max(1, round(R(2))), fill=(46, 107, 255, 46))

    img.resize((w, h), Image.LANCZOS).save(out_path, 'PNG', optimize=True)
    return out_path


def main():
    os.makedirs(OUT, exist_ok=True)
    targets = [('splash-hdpi.png', 480, 762), ('splash-xhdpi.png', 720, 1242),
               ('splash-xxhdpi.png', 1080, 1882)]
    for name, w, h in targets:
        p = render(w, h, os.path.join(OUT, name))
        print('  ✓ %-20s %dx%d  %d KB' % (name, w, h, os.path.getsize(p) // 1024))


if __name__ == '__main__':
    main()
