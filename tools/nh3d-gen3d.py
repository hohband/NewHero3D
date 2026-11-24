#!/usr/bin/env python3
"""图生 3D / 多视角图生 3D 薄封装（单次提交用）。

批量/多英雄请用 `nh3d-drive.py`（带限流排队 + 轮询 + 自动下载）。
载荷编码与视角拼装逻辑在 `nh3d_lib.py`，两个脚本共用。

用法：
  # 单图
  echo -n "<token>" | nh3d-gen3d.py submit <正面图> [--faces N] [--model 3.1] [--no-pbr]
  # 多视角（正面图 + 其余视角；推荐 back + left_front + right_front）
  echo -n "<token>" | nh3d-gen3d.py submit <正面图> \
      --view back=背.png --view left_front=左前.png --view right_front=右前.png
  echo -n "<token>" | nh3d-gen3d.py status <job_id>

选项：
  --view <type>=<path|http-url>   其余视角（可重复；front 不允许放这里，正面图是位置参数）
  --views "<type>=<path>;..."     同上，分号分隔一次给多个
  --max-side N   本地图压缩长边上限（默认 1024）
  --quality N    JPEG 质量（默认 88）
  --faces N / --model 3.1 / --no-pbr
  --dry-run      只打印将要提交的载荷摘要（体积/视角/字段名），不真提交
输出：JSON（stdout）
"""
import json
import pathlib
import sys

import nh3d_lib as lib

VALID_VIEWS = lib.VALID_VIEWS
MAX_B64_TOTAL = lib.MAX_B64_TOTAL


def main():
    token = sys.stdin.readline().strip()
    if not token:
        print(json.dumps({"error": "NO_TOKEN"}), flush=True)
        return 1

    mode = sys.argv[1]
    if mode == "status":
        job_id = sys.argv[2]
        r = lib.BC._call_api(lib.EP, lib.CFG["provider"], lib.CFG["service"], lib.CFG["version"],
                             lib.CFG["query_action"], {"JobId": job_id}, token)
        print(json.dumps(lib.BC._format_output(r, job_id=job_id), ensure_ascii=False), flush=True)
        return 0

    faces, model, pbr, dry = None, "3.1", True, False
    max_side, quality = 1024, 88
    views, front = [], None
    argv = sys.argv[2:]
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--faces":
            faces = int(argv[i + 1]); i += 2
        elif a == "--model":
            model = argv[i + 1]; i += 2
        elif a == "--max-side":
            max_side = int(argv[i + 1]); i += 2
        elif a == "--quality":
            quality = int(argv[i + 1]); i += 2
        elif a == "--no-pbr":
            pbr = False; i += 1
        elif a == "--dry-run":
            dry = True; i += 1
        elif a in ("--view", "--views"):
            s = argv[i + 1]
            try:
                parsed = lib.parse_views(s)
                if a == "--view" and len(parsed) != 1:
                    raise ValueError(f"--view 只接受单个 <type>=<path>，收到 {s}；多个请用 --views")
            except ValueError as e:
                print(json.dumps({"error": "BAD_VIEW", "message": str(e)}, ensure_ascii=False), flush=True)
                return 1
            views.extend(parsed)
            i += 2
        elif a.startswith("--"):
            print(json.dumps({"error": "UNKNOWN_ARG", "message": a}), flush=True)
            return 1
        else:
            front = pathlib.Path(a); i += 1

    if not front:
        print(json.dumps({"error": "NO_FRONT", "message": "位置参数需要给正面参考图"}), flush=True)
        return 1
    bad = [vt for vt, _ in views if vt not in VALID_VIEWS]
    if bad:
        print(json.dumps({"error": "BAD_VIEW_TYPE",
                          "message": f"view_type 非法：{bad}（正面图用位置参数传）；可选 {sorted(VALID_VIEWS)}"},
                         ensure_ascii=False), flush=True)
        return 1

    body, report, total = lib.build_multiview_body(
        front, views, model=model, faces=faces, pbr=pbr,
        max_side=max_side, quality=quality)

    print("[INFO] " + " | ".join(report), file=sys.stderr)
    print(f"[INFO] base64 总计 {total/1048576:.2f}MB / 上限 6.00MB"
          f"{'  ⚠ 超限' if total > MAX_B64_TOTAL else ''}", file=sys.stderr)

    if total > MAX_B64_TOTAL:
        print(json.dumps({"error": "PAYLOAD_TOO_BIG",
                          "message": f"base64 总计 {total/1048576:.2f}MB 超过 6MB，调小 --max-side / --quality"}), flush=True)
        return 1

    mv = body.get("MultiViewImages", [])
    if dry:
        print(json.dumps({"dry_run": True, "model": model, "top_level_fields": sorted(body.keys()),
                          "views": [v["ViewType"] for v in mv],
                          "view_field": list(mv[0].keys())[1] if mv else None,
                          "b64_total_mb": round(total / 1048576, 3),
                          "image_b64_mb": round(len(body.get("ImageBase64", "")) / 1048576, 3),
                          "faces": faces, "pbr": pbr}, ensure_ascii=False), flush=True)
        return 0

    resp = lib.BC._call_api(lib.EP, lib.CFG["provider"], lib.CFG["service"], lib.CFG["version"],
                            lib.CFG["submit_action"], body, token)
    job = resp.get("JobId") or resp.get("TaskId") or resp.get("id")
    out = {"job_id": job, "status": "SUBMITTED" if job else "NO_JOB_ID"}
    if not job:
        out["resp"] = resp
    print(json.dumps(out, ensure_ascii=False), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
