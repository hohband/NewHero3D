#!/usr/bin/env python3
"""图生 3D 调度器：限流排队（并发上限 2）+ 轮询 + 自动下载。

token 从 stdin 读一次，全程复用（同一批任务）。

用法：
  echo -n "<token>" | nh3d-drive.py <输出目录> <uid>=<图路径>[;<视角>=<路径>...][@<已有job_id>] [...]
例：
  # 单图
  echo -n "tk_x" | nh3d-drive.py assets/models \\
      lin_chong=assets/refs/lin_chong_front.png \\
      hua_rong=assets/refs/hua_rong_front.png
  # 多视角（正面图 + ;视角=路径，视角名见 nh3d_lib.VALID_VIEWS，不含 front）
  echo -n "tk_x" | nh3d-drive.py assets/models \\
      'lin_chong=assets/refs/lin_chong_front.png;back=assets/refs/lin_chong_back.png;left_front=assets/refs/lin_chong_left_front.png;right_front=assets/refs/lin_chong_right_front.png'
  # 只看载荷不提交（加 --dry-run 需经环境变量 NH3D_DRY=1）
注意：
  - 多视角需 model hy-3d-3.1（3.0 不支持 back/top/left_front/right_front）
  - 日提交额度 5 次，按 UTC 日计（北京时间 08:00 重置）
"""
import json
import pathlib
import sys
import time
import urllib.request

import nh3d_lib as lib

MAX_CONCURRENT = 2
POLL_INTERVAL = 15
MAX_WAIT = 1500  # 单个任务最长等待 25 分钟


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def submit(token, front, views, faces=30000, model="3.1", dry=False):
    body, report, total = lib.build_multiview_body(front, views, model=model, faces=faces)
    log("[PAYLOAD] " + " | ".join(report))
    log(f"[PAYLOAD] base64 总计 {total/1048576:.2f}MB / 上限 6.00MB")
    if total > lib.MAX_B64_TOTAL:
        raise RuntimeError(f"载荷超限 {total/1048576:.2f}MB > 6MB，请调小 max_side/quality")
    if dry:
        return {"dry_run": True, "fields": sorted(body.keys()),
                "views": [v["ViewType"] for v in body.get("MultiViewImages", [])],
                "b64_total_mb": round(total / 1048576, 3)}
    return lib.BC._call_api(lib.EP, lib.CFG["provider"], lib.CFG["service"], lib.CFG["version"],
                            lib.CFG["submit_action"], body, token)


def query(token, job_id):
    return lib.BC._call_api(lib.EP, lib.CFG["provider"], lib.CFG["service"], lib.CFG["version"],
                            lib.CFG["query_action"], {"JobId": job_id}, token)


def status_of(res):
    if "JobStatusCode" in res:
        return {1: "QUEUED", 2: "PROCESSING", 4: "FAIL", 5: "DONE"}.get(res["JobStatusCode"], str(res["JobStatusCode"]))
    return res.get("Status", "UNKNOWN")


def collect_files(res, acc=None):
    """递归收集所有带 Url 的文件条目（兼容 ResultFile3Ds / result_files 等不同形状）。"""
    if acc is None:
        acc = []
    if isinstance(res, dict):
        url = res.get("Url") or res.get("url") or res.get("FileUrl")
        if isinstance(url, str) and url.startswith("http"):
            acc.append({"type": (res.get("Type") or res.get("type") or "").lower(), "url": url})
        preview = res.get("PreviewImageUrl") or res.get("preview_image_url")
        if isinstance(preview, str) and preview.startswith("http"):
            acc.append({"type": "preview", "url": preview})
        for k, v in res.items():
            if k in ("Url", "url", "FileUrl", "PreviewImageUrl", "preview_image_url"):
                continue
            if isinstance(v, str) and v.startswith("http") and k.lower().endswith("url"):
                acc.append({"type": k.lower().replace("url", ""), "url": v})
            else:
                collect_files(v, acc)
    elif isinstance(res, list):
        for v in res:
            collect_files(v, acc)
    return acc


def download(url, dest):
    req = urllib.request.Request(url, headers={"User-Agent": "curl/8"})
    with urllib.request.urlopen(req, timeout=180) as r, open(dest, "wb") as f:
        while True:
            chunk = r.read(1 << 20)
            if not chunk:
                break
            f.write(chunk)
    return pathlib.Path(dest).stat().st_size


def main():
    token = sys.stdin.readline().strip()
    outdir = pathlib.Path(sys.argv[1])
    outdir.mkdir(parents=True, exist_ok=True)

    dry = "--dry-run" in sys.argv[2:]
    specs = [a for a in sys.argv[2:] if a != "--dry-run"]

    jobs = []
    for spec_arg in specs:
        uid, _, right = spec_arg.partition("=")
        parts, _, job = right.partition("@")
        chunks = [c for c in parts.split(";") if c]
        if not uid or not chunks:
            log(f"[FAIL] 参数无法解析（需 <uid>=<正面图>[;<视角>=<路径>...]）：{spec_arg}")
            return 1
        views = []
        for c in chunks[1:]:
            vt, _, p = c.partition("=")
            if not p:
                log(f"[FAIL] 视角串需要 <type>=<path>：{c}")
                return 1
            views.append((vt, p))
        jobs.append({"uid": uid, "image": chunks[0], "views": views, "job": job or None,
                     "state": "RUNNING" if job else "PENDING", "files": [], "started": time.time()})

    log(f"[INFO] 任务 {len(jobs)} 个，并发上限 {MAX_CONCURRENT}，"
        f"视角配置 {[(j['uid'], [v[0] for v in j['views']]) for j in jobs]}")
    if dry:
        for j in jobs:
            log(f"[DRY] {j['uid']} ← {json.dumps(submit('', j['image'], j['views'], dry=True), ensure_ascii=False)}")
        print(json.dumps({"dry_run": True, "jobs": len(jobs)}, ensure_ascii=False), flush=True)
        return 0

    pending_retry = {}

    while any(j["state"] in ("PENDING", "RUNNING", "DOWNLOADING") for j in jobs):
        running = [j for j in jobs if j["state"] == "RUNNING"]

        # 有空位则提交（429 时 20s 后重试）
        for j in jobs:
            if j["state"] != "PENDING":
                continue
            if len(running) >= MAX_CONCURRENT:
                break
            if pending_retry.get(j["uid"], 0) > time.time():
                continue
            try:
                r = submit(token, j["image"], j["views"])
                j["job"] = r.get("JobId")
                if not j["job"]:
                    j["state"] = "FAIL"
                    j["error"] = f"NO_JOB_ID {json.dumps(r, ensure_ascii=False)[:300]}"
                    log(f"[FAIL] {j['uid']} 未拿到 JobId: {json.dumps(r, ensure_ascii=False)[:200]}")
                else:
                    j["state"] = "RUNNING"
                    j["started"] = time.time()
                    running.append(j)
                    log(f"[SUBMIT] {j['uid']} job={j['job']}")
            except Exception as e:
                if "429" in str(e) or "concurrent" in str(e).lower():
                    pending_retry[j["uid"]] = time.time() + 20
                    log(f"[WAIT] {j['uid']} 并发已满，20s 后重试")
                else:
                    j["state"] = "FAIL"
                    j["error"] = str(e)[:300]
                    log(f"[FAIL] {j['uid']} 提交异常: {str(e)[:200]}")

        # 轮询运行中的
        for j in jobs:
            if j["state"] != "RUNNING":
                continue
            if time.time() - j["started"] > MAX_WAIT:
                j["state"] = "FAIL"
                j["error"] = "TIMEOUT"
                log(f"[FAIL] {j['uid']} 超时")
                continue
            try:
                res = query(token, j["job"])
            except Exception as e:
                log(f"[WARN] {j['uid']} 查询异常: {str(e)[:120]}")
                continue
            st = status_of(res)
            log(f"[POLL] {j['uid']} {st}")
            if st == "DONE":
                files = collect_files(res)
                log(f"[DONE] {j['uid']} 文件 {[(f['type'], f['url'][:60]) for f in files]}")
                j["files"] = files
                j["state"] = "DOWNLOADING"
            elif st == "FAIL":
                j["state"] = "FAIL"
                j["error"] = json.dumps(res, ensure_ascii=False)[:500]

        # 下载
        for j in jobs:
            if j["state"] != "DOWNLOADING":
                continue
            ok = 0
            for f in j["files"]:
                t = f["type"] or "bin"
                if t in ("preview", "previewimage"):
                    dest = outdir / f"{j['uid']}_ai_preview.png"
                else:
                    ext = t if t in ("glb", "obj", "fbx", "stl", "usdz") else "glb"
                    dest = outdir / f"{j['uid']}_ai.{ext}"
                try:
                    size = download(f["url"], dest)
                    log(f"[SAVE] {dest} {size/1048576:.2f}MB")
                    ok += 1
                except Exception as e:
                    log(f"[WARN] 下载失败 {f['url'][:80]}: {str(e)[:120]}")
            j["state"] = "DONE" if ok else "FAIL"
            if not ok:
                j["error"] = "DOWNLOAD_FAILED"

        if any(j["state"] in ("PENDING", "RUNNING", "DOWNLOADING") for j in jobs):
            time.sleep(POLL_INTERVAL)

    summary = [{"uid": j["uid"], "state": j["state"], "job": j["job"],
                "error": j.get("error"), "files": j["files"]} for j in jobs]
    print(json.dumps(summary, ensure_ascii=False, indent=2), flush=True)
    return 0 if all(j["state"] == "DONE" for j in jobs) else 1


if __name__ == "__main__":
    sys.exit(main())
