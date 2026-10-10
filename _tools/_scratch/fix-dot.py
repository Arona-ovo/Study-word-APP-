# 一次性：把去水印后残留在右下角的一个灰色小点抹掉
#
# 定位：这块（右下角）是平滑渐变背景，"原图 - 高斯模糊" 的差值里明显偏离的像素
# 就是水印碎点。实测小点在 x≈945-951 / y≈960-968，另有一道更淡的竖向残迹在 x≈957-958。
# 回填：把这些像素（含外扩，盖住抗锯齿过渡带）换成模糊值 —— 模糊核半径 12 远大于
# 小点尺寸，模糊值基本等于局部背景色。
# 只在这一小块内动手，绝不碰角色本体。
from PIL import Image, ImageFilter, ImageChops

SRC = r'C:\Users\33156\WorkBuddy\2026-10-06-17-27-44\processed_image_img91454863-4ceb5d91-499e-4050-b7c0-cccee18053a4_1.png'
DST = r'C:\Users\33156\WorkBuddy\2026-10-06-17-27-44\generated-images\mascot-clean.png'

# 只在右下角这一小块里找（避开角色）
BOX = (930, 948, 972, 978)   # x0, y0, x1, y1（不含）
THRESH = 4                    # 差值阈值：>4 就当残留（背景本身极平滑）
PAD = 4                       # 回填外扩，盖住抗锯齿过渡带

im = Image.open(SRC).convert('RGB')
W, H = im.size
x0, y0, x1, y1 = BOX

blur = im.filter(ImageFilter.GaussianBlur(12))
diff = ImageChops.difference(im, blur).convert('L')
dp = diff.load()

pts = [(x, y) for y in range(y0, y1) for x in range(x0, x1) if dp[x, y] > THRESH]
print('命中像素', len(pts))
if not pts:
    print('没找到残留点，原样输出')
else:
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    print('包围盒 x', min(xs), '-', max(xs), ' y', min(ys), '-', max(ys))

bp = blur.load()
op = im.load()
done = set()
n = 0
for (x, y) in pts:
    for dy in range(-PAD, PAD + 1):
        for dx in range(-PAD, PAD + 1):
            nx, ny = x + dx, y + dy
            if not (0 <= nx < W and 0 <= ny < H):
                continue
            if (nx, ny) in done:
                continue
            done.add((nx, ny))
            op[nx, ny] = bp[nx, ny]
            n += 1
print('回填像素', n, '覆盖区域', len(done))

# 复检：同一小块内还有没有 >4 的偏差
blur2 = im.filter(ImageFilter.GaussianBlur(12))
d2 = ImageChops.difference(im, blur2).convert('L').load()
left = sum(1 for y in range(y0, y1) for x in range(x0, x1) if d2[x, y] > THRESH)
print('复检残留', left)

im.save(DST, 'PNG', optimize=True)
print('已保存', DST, im.size)
