# 轮廓比对：把模型正交渲染图与参考图做并排拼图 + 计算轮廓 IoU。
#
# 为什么用轮廓 IoU：参考图（ImageGen 产出）与 3D 渲染的着色/光照完全不同，
# 逐像素比色毫无意义；但**剪影**是可比的 —— 尤其背面/侧面，
# 单图生 3D 只能靠猜，轮廓会明显跑偏。
#
# 对齐方式：各自裁到内容包围盒 → 按高度归一到 256px（保持长宽比）→ 水平居中到画布。
# 这样比的是「形状比例」，不是绝对位置/大小。
#
# 用法：python tools/silhouette_compare.py [多视图渲染目录] [单图渲染目录] [输出拼图路径]
#   三个参数全部可选，默认 /tmp/views_mv、/tmp/views_single、
#   assets/models/lin_chong_mv_vs_single.png（保持与历史结论可比）。
#   做第二轮对照时显式传参，避免覆盖上一轮的拼图。
import os
import sys
from PIL import Image, ImageChops

ROOT = '/Users/hohbandlee/Projects/NewHero3D'
CELL = (300, 400)
H = 256          # 归一化高度
CANVAS_W = 420   # 居中画布宽
BG_TOL = 32      # 参考图背景判定阈值（与四角中位色的距离）


def ref_mask(path):
    """参考图：取四角 12x12 中位色为背景，偏离超过阈值即视为角色。"""
    im = Image.open(path).convert('RGB')
    px = im.load()
    w, h = im.size
    corners = []
    for (x0, y0) in [(0, 0), (w - 12, 0), (0, h - 12), (w - 12, h - 12)]:
        for x in range(x0, x0 + 12):
            for y in range(y0, y0 + 12):
                corners.append(px[x, y])
    bg = tuple(sorted(c[i] for c in corners)[len(corners) // 2] for i in range(3))
    m = Image.new('L', (w, h), 0)
    mp = m.load()
    for y in range(h):
        for x in range(w):
            p = px[x, y]
            if abs(p[0] - bg[0]) + abs(p[1] - bg[1]) + abs(p[2] - bg[2]) > BG_TOL:
                mp[x, y] = 255
    return m, im, bg


def render_mask(path):
    """渲染图：alpha 通道即剪影。"""
    im = Image.open(path).convert('RGBA')
    m = im.split()[3].point(lambda a: 255 if a > 128 else 0)
    return m, im


def norm_mask(mask):
    """裁到内容包围盒 → 高度归一 → 水平居中到固定画布。"""
    bbox = mask.getbbox()
    if not bbox:
        return None
    m = mask.crop(bbox)
    w, h = m.size
    scale = H / h
    nw = max(1, int(round(w * scale)))
    m = m.resize((nw, H), Image.LANCZOS)
    canvas = Image.new('L', (CANVAS_W, H), 0)
    canvas.paste(m, ((CANVAS_W - nw) // 2, 0))
    return canvas


def iou(a, b):
    # 必须显式转 mode '1'，ImageChops.logical_* 只吃二值图；用 histogram 计数比逐像素快得多
    a1 = a.point(lambda v: 255 if v > 127 else 0).convert('1')
    b1 = b.point(lambda v: 255 if v > 127 else 0).convert('1')
    inter = ImageChops.logical_and(a1, b1)
    uni = ImageChops.logical_or(a1, b1)
    # mode '1' 的 histogram 依然是 256 桶（只有 0 和 255 有值），别取 h[1]
    ni = inter.histogram()[255]
    nu = uni.histogram()[255]
    return ni / nu if nu else 0.0


def on_white(im):
    im = im.convert('RGBA')
    bg = Image.new('RGBA', im.size, (255, 255, 255, 255))
    return Image.alpha_composite(bg, im).convert('RGB')


PAIRS = [
    ('front 0°', 'lin_chong_front.png', 'front'),
    ('left45 +45°', 'lin_chong_left_front.png', 'left_front'),
    ('right45 -45°', 'lin_chong_right_front.png', 'right_front'),
    ('back 180°', 'lin_chong_back.png', 'back'),
    ('left 90°', 'lin_chong_left.png', 'left'),
    ('right -90°', 'lin_chong_right.png', 'right'),
]

# 命令行可覆盖渲染目录与输出路径（不传则用历史默认值）
argv = sys.argv[1:]
MV_DIR = argv[0] if len(argv) > 0 else '/tmp/views_mv'
SINGLE_DIR = argv[1] if len(argv) > 1 else '/tmp/views_single'
OUT_SHEET = argv[2] if len(argv) > 2 else os.path.join(ROOT, 'assets/models/lin_chong_mv_vs_single.png')
print(f'[dirs] 多视图={MV_DIR}  单图={SINGLE_DIR}  输出={OUT_SHEET}')

rows = []
print(f"{'视角':<14}{'参考图':<24}{'多视图 IoU':>12}{'单图 IoU':>12}{'增益':>10}")
for label, ref_name, view in PAIRS:
    ref_path = os.path.join(ROOT, 'assets/refs', ref_name)
    rm, ref_im, bg = ref_mask(ref_path)
    rn = norm_mask(rm)
    cell_imgs = [ref_im.resize(CELL, Image.LANCZOS)]

    ious = []
    for tag, d in [('多视图', MV_DIR), ('单图', SINGLE_DIR)]:
        p = os.path.join(d, f'{view}.png')
        mm, im = render_mask(p)
        mn = norm_mask(mm)
        v = iou(rn, mn)
        ious.append(v)
        cell_imgs.append(on_white(im).resize(CELL, Image.LANCZOS))
    gain = ious[0] - ious[1]
    print(f"{label:<14}{ref_name:<24}{ious[0]:>12.3f}{ious[1]:>12.3f}{gain:>+10.3f}")
    rows.append(cell_imgs)

# 拼图：列 = 参考图 | 多视图渲染 | 单图渲染；行 = 视角
sheet = Image.new('RGB', (CELL[0] * 3 + 24, CELL[1] * len(rows) + 16 * (len(rows) - 1)), (255, 255, 255))
for r, cells in enumerate(rows):
    for c, im in enumerate(cells):
        sheet.paste(im, (c * (CELL[0] + 12), r * (CELL[1] + 16)))
out = OUT_SHEET
sheet.save(out)
print('[sheet]', out)
print('列：参考图 | 多视图渲染 | 单图渲染')
print('SILHOUETTE_DONE')
