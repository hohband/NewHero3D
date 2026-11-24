# -*- coding: utf-8 -*-
"""身份核验拼图：把「参考图正面」与「混元重建预览图」并排拼成一张，用于一次核完全部角色。

为什么需要它：批量 pull 取的是 creations[0]（= 最新任务），若列表顺序在任何一次出错，
产物就会张冠李戴 —— 而这种错误**只靠文件大小/creation id 是发现不了的**，必须看图认脸。
拼成一张后只需看一次图，比逐张读省得多。

用法：python tools/verify_batch_identity.py <out.png> uid [uid ...]
"""
import os
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = sys.argv[1]
UIDS = sys.argv[2:]

W, H = 460, 620          # 每格尺寸
PAD = 14
LABEL_H = 34
HEADER_H = 46
BG = (246, 247, 249)
LINE = (210, 214, 219)
INK = (28, 32, 36)

CONFIRMED = {
    "gongsun_sheng": "公孙胜 · 白发长须道袍 + 横托古剑",
    "wu_yong": "吴用 · 清瘦书生 + 双手铜链",
    "li_kui": "李逵 · 矮壮黑汉 + 双板斧外张",
    "qin_ming": "秦明 · 朱红重甲 + 狼牙棒举肩",
    "hu_sanniang": "扈三娘 · 女将 + 日月双刀",
    "yan_qing": "燕青 · 俊美青年 + 横置川弩",
    "dai_zong": "戴宗 · 行脚差役 + 绑腿甲符 + 朴刀",
    "an_daoquan": "安道全 · 温和医者 + 银针",
}


def font(size):
    for p in ("/System/Library/Fonts/PingFang.ttc",
              "/System/Library/Fonts/Supplemental/Songti.ttc",
              "/Library/Fonts/Arial Unicode.ttf"):
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                pass
    return ImageFont.load_default()


F_TITLE = font(22)
F_LABEL = font(17)
F_CAP = font(16)


def fit(img, w, h):
    """等比缩放并居中贴到 w×h 的画布上。"""
    canvas = Image.new("RGB", (w, h), (235, 237, 240))
    if img is None:
        return canvas
    img = img.convert("RGB")
    r = min(w / img.width, h / img.height)
    nw, nh = max(1, int(img.width * r)), max(1, int(img.height * r))
    img = img.resize((nw, nh), Image.LANCZOS)
    canvas.paste(img, ((w - nw) // 2, (h - nh) // 2))
    return canvas


def load(path):
    try:
        return Image.open(path)
    except Exception:
        return None


rows = len(UIDS)
CW = PAD + (W + PAD) * 2
CH = HEADER_H + rows * (LABEL_H + H + PAD) + PAD
sheet = Image.new("RGB", (CW, CH), BG)
d = ImageDraw.Draw(sheet)

d.text((PAD, 12), "批次身份核验 · 参考图（ImageGen）  vs  混元单图重建预览",
       fill=INK, font=F_TITLE)

y = HEADER_H
for uid in UIDS:
    ref = load(os.path.join(ROOT, "assets/refs", f"{uid}_front.png"))
    pre = load(os.path.join(ROOT, "assets/models", f"{uid}_ai_preview.png"))

    cap = CONFIRMED.get(uid, uid)
    d.text((PAD, y + 6), f"{uid} — {cap}", fill=INK, font=F_LABEL)
    y += LABEL_H

    for i, (img, tag) in enumerate(((ref, "参考图"), (pre, "重建预览"))):
        x = PAD + i * (W + PAD)
        sheet.paste(fit(img, W, H), (x, y))
        d.rectangle([x, y, x + W - 1, y + H - 1], outline=LINE, width=1)
        d.text((x + 6, y + 6), tag, fill=(90, 96, 104), font=F_CAP)
        if img is None:
            d.text((x + W // 2 - 40, y + H // 2), "缺图", fill=(170, 60, 60), font=F_LABEL)
    y += H + PAD

os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
sheet.save(OUT)
print(f"[OK] {OUT}  {sheet.width}x{sheet.height}  {rows} 行")
for uid in UIDS:
    a = os.path.exists(os.path.join(ROOT, "assets/refs", f"{uid}_front.png"))
    b = os.path.exists(os.path.join(ROOT, "assets/models", f"{uid}_ai_preview.png"))
    print(f"   {uid:<16} ref={'有' if a else '缺'}  preview={'有' if b else '缺'}")
