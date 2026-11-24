# -*- coding: utf-8 -*-
"""把 prop_detect_viz2.py / prop_detect_viz.py 的渲染结果打成一份自包含 HTML 证据页。

图片全部 base64 内联，单文件、无外部依赖，双击即可看。
用法：python3 tools/make_prop_evidence_page.py
"""
import base64
import io
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "docs", "prop-detect-evidence.html")

VIZ2 = "/tmp/propviz2"
VIZ1 = "/tmp/propviz"

# (组标题, 说明, [(图路径, 图注)])
GROUPS = [
    (
        "A. 逐簇配色渲染 —— 结论的唯一视觉依据",
        "prop_detect_viz2.py 把每个候选簇涂一种颜色单独渲染。"
        "<b>不要靠纯数字（bbox / 质心 / 长细比 / z 分片）推断部件身份</b> —— 本次连续误判 3 次，"
        "那个「长 0.807 的簇」看图才发现是靴子 + 袍角 + 肩甲被轴向延伸串成的假长条，根本不是矛杆。",
        [
            (f"{VIZ2}/lin_chong_ai_front.png", "林冲（单图源 lin_chong_ai）正面 · 逐簇配色"),
            (f"{VIZ2}/lin_chong_ai_right.png", "林冲（单图源）右侧 · 逐簇配色"),
            (f"{VIZ2}/lin_chong_mv30k_front.png", "林冲（多视图源 lin_chong_mv30k）正面 · 逐簇配色"),
            (f"{VIZ2}/lin_chong_mv30k_right.png", "林冲（多视图源）右侧 · 逐簇配色"),
            (f"{VIZ2}/wu_song_ai_front.png", "武松（双刀）正面 · 逐簇配色"),
            (f"{VIZ2}/wu_song_ai_right.png", "武松（双刀）右侧 · 逐簇配色"),
            (f"{VIZ2}/lu_zhishen_ai_front.png", "鲁智深（禅杖）正面 · 逐簇配色"),
            (f"{VIZ2}/lu_zhishen_ai_right.png", "鲁智深（禅杖）右侧 · 逐簇配色"),
            (f"{VIZ2}/hua_rong_ai_front.png", "花荣（弓）正面 · 逐簇配色"),
            (f"{VIZ2}/hua_rong_ai_right.png", "花荣（弓）右侧 · 逐簇配色"),
        ],
    ),
    (
        "B. 镜像不对称度 asym 的实际抓取范围",
        "prop_detect_viz.py：把 asym 高的顶点单独剔出来高亮（互补剔除，避免共面 z-fighting）。"
        "下图说明 asym 的适用面 —— 整根禅杖 / 整张弓可行，林冲只拿到矛头 + 红缨（部分），"
        "<b>武松双手对称持械在数学上就不产生不对称，恒为 0</b>。",
        [
            (f"{VIZ1}/lin_chong_ai_front.png", "林冲 正面 · asym 高亮（只剩矛头 + 红缨）"),
            (f"{VIZ1}/lin_chong_mv30k_right.png", "林冲（多视图源）右侧 · asym 高亮"),
            (f"{VIZ1}/lu_zhishen_ai_front.png", "鲁智深 正面 · asym 高亮（整根禅杖）"),
            (f"{VIZ1}/hua_rong_ai_front.png", "花荣 正面 · asym 高亮（整张弓）"),
        ],
    ),
]


def b64(path):
    if not os.path.exists(path):
        return None
    with open(path, "rb") as f:
        return base64.b64encode(f.read()).decode("ascii")


def card(path, caption):
    data = b64(path)
    if data is None:
        return f'<figure class="miss"><div class="ph">缺图</div><figcaption>{caption}<br><code>{path}</code></figcaption></figure>'
    return (
        '<figure><img src="data:image/png;base64,' + data + '" alt="' + caption + '">'
        "<figcaption>" + caption + "</figcaption></figure>"
    )


def main():
    used = [p for _, _, items in GROUPS for p, _ in items]
    found = sum(1 for p in used if os.path.exists(p))
    if found == 0:
        print("没有任何源图存在，检查 /tmp/propviz2 与 /tmp/propviz 是否已被清理", file=sys.stderr)
        return 1

    parts = [
        "<!DOCTYPE html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\">",
        "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">",
        "<title>兵器识别排查 · 视觉证据</title><style>",
        ":root{--bg:#f6f7f9;--card:#fff;--ink:#1c2024;--dim:#6b7280;--line:#e3e6ea;--accent:#1f6feb}",
        "*{box-sizing:border-box}",
        "body{margin:0;background:var(--bg);color:var(--ink);",
        "font:15px/1.7 -apple-system,'PingFang SC','Helvetica Neue',sans-serif}",
        "header{background:var(--card);border-bottom:1px solid var(--line);padding:28px 32px 22px}",
        "h1{margin:0 0 6px;font-size:22px;letter-spacing:.2px}",
        ".sub{color:var(--dim);font-size:13px}",
        ".verdict{margin-top:16px;padding:14px 16px;background:#fff8e6;border:1px solid #f0d9a0;",
        "border-radius:8px;font-size:14px}",
        ".verdict b{color:#8a5a00}",
        "main{padding:24px 32px 64px;max-width:1280px;margin:0 auto}",
        "section{margin-bottom:44px}",
        "h2{font-size:17px;margin:0 0 8px;padding-bottom:8px;border-bottom:2px solid var(--accent)}",
        ".desc{color:var(--dim);font-size:13.5px;margin:0 0 18px}",
        ".grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px}",
        "figure{margin:0;background:var(--card);border:1px solid var(--line);border-radius:10px;",
        "overflow:hidden;display:flex;flex-direction:column}",
        "figure img{width:100%;display:block;background:#2b2b2b;aspect-ratio:1/1;object-fit:contain}",
        "figcaption{padding:10px 12px;font-size:12.5px;color:var(--dim);border-top:1px solid var(--line)}",
        "figure.miss .ph{aspect-ratio:1/1;display:grid;place-items:center;color:#b0b4ba;background:#eceef1;font-size:13px}",
        "code{font-family:ui-monospace,Menlo,monospace;font-size:11.5px;word-break:break-all}",
        "footer{padding:20px 32px 40px;color:var(--dim);font-size:12.5px;border-top:1px solid var(--line);",
        "background:var(--card)}",
        "footer code{background:#f0f2f4;padding:1px 5px;border-radius:3px}",
        "</style></head><body>",
        "<header>",
        "<h1>兵器识别排查 · 视觉证据</h1>",
        '<div class="sub">水浒 3D · NewHero3D &nbsp;|&nbsp; 由 <code>tools/make_prop_evidence_page.py</code> 生成 &nbsp;|&nbsp; 源渲染：'
        + str(found)
        + " / "
        + str(len(used))
        + " 张</div>",
        '<div class="verdict"><b>结论（已推翻原处方）</b>：种子门控不是瓶颈。真因是'
        "<b>骨架姿势不匹配</b> —— 硬编码骨架假设双臂自然垂放（<code>Hand.L/R</code> 在 x±0.11、z 0.43~0.49），"
        "而图生 3D 是持械架势，林冲真实握持手在 (x≈−0.25, z≈0.59)，<b>距模板手骨 0.17 ≈ 身高 17%</b>，"
        "故 <code>_d_hand&lt;0.10</code> 永远圈不到真手。放开阈值的替代方案已被证伪（种子 7→1665，"
        "但洪泛吞 10913 顶点、长细比 2.6 仍被形状校验丢弃）。"
        "<b>故 <code>tools/blender_rig_character.py</code> 一行未改</b>；asym 路径判定不上线（会撕断兵器）。</div>",
        "</header><main>",
    ]

    for title, desc, items in GROUPS:
        parts.append("<section><h2>" + title + "</h2><p class=\"desc\">" + desc + "</p><div class=\"grid\">")
        for p, cap in items:
            parts.append(card(p, cap))
        parts.append("</div></section>")

    parts.append("</main><footer>")
    parts.append("源工具：<code>tools/prop_detect_viz2.py</code>（逐簇配色，阈值写在文件顶部）、"
                 "<code>tools/prop_detect_viz.py</code>（asym 高亮）、<code>tools/prop_detect_probe.py</code>（判据对比探针）。"
                 "完整数字与判据取值见 <code>docs/pipeline-3d-asset.md</code> §8.4。")
    parts.append("</footer></body></html>")

    html = "".join(parts)
    with io.open(OUT, "w", encoding="utf-8") as f:
        f.write(html)
    print("已生成 %s（%.2f MB，%d 张图内联）" % (OUT, len(html.encode("utf-8")) / 1048576.0, found))
    return 0


if __name__ == "__main__":
    sys.exit(main())
