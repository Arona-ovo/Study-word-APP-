# scripts/gen-tab-icons.py - 生成底部导航图标（4 tab × 选中/未选中）
# 线性图标，透明底；选中=#2E6BFF，未选中=#98A19B。2x 输出 96x96 PNG。
import os
from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(__file__), '..', 'static', 'tabbar')
os.makedirs(OUT, exist_ok=True)

SEL = (46, 107, 255, 255)     # #2E6BFF
UNSEL = (152, 161, 155, 255)  # #98A19B
SIZE = 96
W = 6  # 线宽


def canvas():
    img = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    return img, ImageDraw.Draw(img)


def home(color):
    img, d = canvas()
    # 屋顶三角（两条斜边 + 底边）
    d.line([(20, 46), (48, 20)], fill=color, width=W)
    d.line([(48, 20), (76, 46)], fill=color, width=W)
    # 墙体
    d.rectangle([28, 46, 68, 80], outline=color, width=W)
    # 门
    d.rectangle([44, 60, 52, 80], outline=color, width=W)
    return img


def library(color):
    img, d = canvas()
    # 两本堆叠的书（圆角矩形）
    d.rounded_rectangle([24, 28, 72, 46], radius=6, outline=color, width=W)
    d.rounded_rectangle([24, 50, 72, 68], radius=6, outline=color, width=W)
    # 书脊
    d.line([(44, 28), (44, 46)], fill=color, width=W)
    d.line([(44, 50), (44, 68)], fill=color, width=W)
    # 书签
    d.line([(60, 28), (60, 38)], fill=color, width=W)
    d.polygon([(60, 38), (55, 34), (65, 34)], fill=color)
    return img


def wrong(color):
    img, d = canvas()
    # 圆圈
    d.ellipse([22, 22, 74, 74], outline=color, width=W)
    # 叉
    d.line([(36, 36), (60, 60)], fill=color, width=W)
    d.line([(60, 36), (36, 60)], fill=color, width=W)
    return img


def profile(color):
    img, d = canvas()
    # 头
    d.ellipse([36, 20, 60, 44], outline=color, width=W)
    # 肩（大圆上半弧）
    d.arc([14, 44, 82, 116], start=180, end=360, fill=color, width=W)
    return img


ICONS = {
    'home': home,
    'library': library,
    'wrong': wrong,
    'profile': profile,
}

for name, fn in ICONS.items():
    fn(UNSEL).save(os.path.join(OUT, name + '.png'))
    fn(SEL).save(os.path.join(OUT, name + '-active.png'))
    print('generated', name)

print('done ->', os.path.abspath(OUT))
