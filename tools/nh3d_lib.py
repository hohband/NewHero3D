#!/usr/bin/env python3
"""混元 3D（HY-3D）共享库：本地图编码 + 多视角载荷组装。

被 nh3d-gen3d.py（单次提交/查询）与 nh3d-drive.py（批量调度）共用，
避免两处各写一份 base64 编码与视角拼装逻辑。

绕坑记录（均为实测/查证结论）：
  1. macOS argv 上限：base64 作为命令行参数会超限（2MB 图即触发）
     → 不走 CLI 参数，改为模块方式加载官方技能脚本 buddy-cloud.py 直调内部函数。
  2. 官方技能 CLI 的 --multi-view 只接受 ViewImageUrl（公网 URL），本地图无法用。
     接口文档：view_image 含 view_image_base64 字段，值可为「图片 url 或 base64 数据」
     → 本地图直接内联，全程无需图床。
  3. 接口约束（hy-3d-3.1，多视图为 3.1 专属）：
     - 正面图走 image_base64；其余视角走 multi_view_images
     - view_type ∈ VALID_VIEWS（**不含 front**），每视角限一张
     - 编码后所有视角图 base64 总和 ≤ 6MB；单边 128~5000；jpg / png
     - 日提交额度 5 次（按 UTC 日计，北京时间 08:00 重置）
"""
import base64
import importlib.util
import io
import pathlib

import PIL.Image

SKILL = ("/Applications/WorkBuddy.app/Contents/Resources/app.asar.unpacked/resources/"
         "plugins/workbuddy-builtin/skills/buddy-multimodal-generation/scripts/buddy-cloud.py")


def load_bc():
    """以模块方式加载官方技能脚本，返回模块对象（内含 _build_3d_body / _call_api）。"""
    spec = importlib.util.spec_from_file_location("buddy_cloud", SKILL)
    bc = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(bc)
    return bc


BC = load_bc()
CFG = BC._PROVIDER_MAP["3d"]
EP = BC._DEFAULT_ENDPOINT

# HY-3D 的 view_type 枚举（不含 front：正面图走 image_base64）
VALID_VIEWS = {"left", "right", "back", "top", "bottom", "left_front", "right_front"}
MAX_B64_TOTAL = 6 * 1024 * 1024   # 接口硬限：多视角 base64 总和 ≤ 6MB


def encode_image(path, max_side: int = 1024, quality: int = 88):
    """本地图 → JPEG 压缩后的 base64。返回 (b64, 原始字节数, 压缩后字节数)。

    统一转 JPEG 是为了压掉 PNG 的无用体积，把多视角总载荷压进 6MB 硬限内。
    """
    path = pathlib.Path(path)
    raw = path.read_bytes()
    im = PIL.Image.open(io.BytesIO(raw))
    if im.mode not in ("RGB", "L"):
        im = im.convert("RGB")
    w, h = im.size
    if max(w, h) > max_side:
        s = max_side / max(w, h)
        im = im.resize((max(1, round(w * s)), max(1, round(h * s))), PIL.Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, format="JPEG", quality=quality, optimize=True)
    comp = buf.getvalue()
    return base64.b64encode(comp).decode(), len(raw), len(comp)


def build_multiview_body(front_path, views, model="3.1", faces=None, pbr=True,
                         max_side=1024, quality=88):
    """组装多视角图生 3D 请求体。

    front_path: 正面参考图（本地路径）
    views: [(view_type, path_or_url), ...]，view_type 须在 VALID_VIEWS 内

    返回 (body, report_lines, total_b64_bytes)；调用方自行判断 total 是否超限。
    """
    b64, raw_n, comp_n = encode_image(front_path, max_side, quality)
    report = [f"front←{pathlib.Path(front_path).name} {raw_n/1048576:.2f}MB→jpeg {comp_n/1024:.0f}KB"]
    body = BC._build_3d_body(prompt="", model=model, image_base64=b64,
                             enable_pbr=pbr, face_count=faces)

    mv, total = [], len(b64)
    for vt, val in views:
        if vt not in VALID_VIEWS:
            raise ValueError(f"view_type 非法：{vt}；可选 {sorted(VALID_VIEWS)}"
                             f"（正面图用 front_path 传，不放进 views）")
        if isinstance(val, str) and (val.startswith("http://") or val.startswith("https://")):
            mv.append({"ViewType": vt, "ViewImageUrl": val})
            report.append(f"{vt}←URL")
            continue
        vb, rn, cn = encode_image(val, max_side, quality)
        mv.append({"ViewType": vt, "ViewImageBase64": vb})
        total += len(vb)
        report.append(f"{vt}←{pathlib.Path(val).name} {rn/1048576:.2f}MB→jpeg {cn/1024:.0f}KB")

    if mv:
        body["MultiViewImages"] = mv
    return body, report, total


def parse_views(spec: str):
    """解析 CLI 的视角串：`back=背.png;left_front=左前.png` → [(type, path), ...]"""
    views = []
    for chunk in filter(None, (c.strip() for c in spec.split(";"))):
        vt, _, val = chunk.partition("=")
        if not val:
            raise ValueError(f"视角串需要 <type>=<path>，收到 {chunk}")
        views.append((vt.strip(), val.strip()))
    return views
