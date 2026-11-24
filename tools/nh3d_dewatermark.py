#!/usr/bin/env python3
"""去除 ImageGen 输出图右下角的「AI生成 / WORKBUDDY」水印。

为什么需要单独一步：
  ImageGen 只能自定义水印文案（footnote，≤16 字），无法关闭；水印固定压在
  右下角。参考图要送进图生 3D，水印会被当作前景 → 生成悬浮碎块，必须清掉。

原理：
  1. 背景色 = 左上角 3×3 的中位数（生成图均为纯色浅灰背景）。
  2. 定位安全区：默认自动取「右下区域人物（明显暗于背景的墨线）最右边界 + 15px」，
     且不小于 0.80w；可用 --safe-x 手动覆盖。安全区 = 画面右下角一块确认过的纯背景。
  3. 安全区内整块填充背景：逐行取左侧背景条带的中位色，保留背景的行向渐变。
     之所以整块填而不是按亮度逐像素判断 —— 半透明水印的边缘像素与背景差异极小
     （实测远低于可用阈值），逐像素判断一定会留下灰白鬼影。
  4. --check 只报告将填充的范围、不改文件；改动前原图自动备份为 <name>.wm.bak.png。

注意：填充不可逆。务必先 --check 确认安全区没压到人物，处理后目视复核。

用法：
  python nh3d_dewatermark.py <img...>            # 原地覆盖前先备份为 <name>.wm.bak.png
  python nh3d_dewatermark.py --check <img...>    # 只报告安全区异常像素，不改文件
选项：
  --safe-x F   手动指定安全区起始 x 比例（默认自动：人物右边界 +15px，且不小于 0.80w）
  --safe-y F   安全区起始 y 比例（默认 0.88）
  --tol N      亮度差阈值，超过才判为水印（默认 10）
"""
import pathlib
import shutil
import sys

from PIL import Image


def luminance(c):
    return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]


def median_color(im, x0, y0, n=3):
    px = im.load()
    vals = [px[x, y] for x in range(x0, x0 + n) for y in range(y0, y0 + n)]
    return tuple(sorted(v[i] for v in vals)[len(vals) // 2] for i in range(3))


def find_person_right(px, w, h, bg, dark_tol=60.0, y_from=0.78):
    """右下区域中人物（明显暗于背景的墨线/铠甲）的最右边界 x；没有则返回 -1。

    阈值取得很严（默认 60）：水印的浅灰描边比真正的人物轮廓亮得多，
    若阈值太松，水印自身会被误判成人物，安全区就会推到水印中间而漏清左半截。
    """
    dist = lambda c: abs(c[0] - bg[0]) + abs(c[1] - bg[1]) + abs(c[2] - bg[2])
    right = -1
    for y in range(int(h * y_from), h):
        for x in range(w - 1, int(w * 0.5), -1):
            if dist(px[x, y]) > dark_tol * 3 and luminance(px[x, y]) < luminance(bg):
                if x > right:
                    right = x
                break
    return right


def process(path, safe_x=None, safe_y=0.88, tol=10.0, check=False):
    im = Image.open(path).convert("RGB")
    w, h = im.size
    bg = median_color(im, 2, 2)
    px = im.load()

    if safe_x is None:
        pr = find_person_right(px, w, h, bg)
        x_start = max(pr + 15, int(w * 0.80))
        origin = f"auto(人物右边界={pr})"
    else:
        x_start = int(w * safe_x)
        origin = f"manual({safe_x})"
    y_start = int(h * safe_y)

    # 安全区已推到人物右侧，是确认过的纯背景区 → 整块填充，彻底消除水印
    # （半透明水印的边缘像素与背景差异极小，按阈值逐像素判断会留下鬼影）。
    # 逐行取左侧背景条带的中位色填充，保留背景的行向渐变，避免出现色块边界。
    for y in range(y_start, h):
        band = [px[x, y] for x in range(max(0, x_start - 15), x_start)]
        bg_row = tuple(sorted(v[i] for v in band)[len(band) // 2] for i in range(3))
        if not check:
            for x in range(x_start, w):
                px[x, y] = bg_row

    wiped = (w - x_start) * (h - y_start)

    if not check:
        im.save(path)

    tag = "CHECK" if check else "WIPE"
    print(f"[{tag}] {pathlib.Path(path).name} bg={bg} 安全区 x≥{x_start},y≥{y_start} ({origin}) "
          f"填充={wiped}", file=sys.stderr)
    return wiped


def main():
    args = sys.argv[1:]
    check = "--check" in args
    args = [a for a in args if a != "--check"]
    kwargs = {}
    for key, cast in (("--safe-x", float), ("--safe-y", float), ("--tol", float)):
        if key in args:
            i = args.index(key)
            kwargs[key.lstrip("-").replace("-", "_")] = cast(args[i + 1])
            del args[i:i + 2]
    if not args:
        print(__doc__)
        return 1

    for a in args:
        p = pathlib.Path(a)
        if not check:
            bak = p.with_suffix(".wm.bak" + p.suffix)
            if not bak.exists():
                shutil.copy2(p, bak)
        process(p, check=check, **kwargs)
    return 0


if __name__ == "__main__":
    sys.exit(main())
