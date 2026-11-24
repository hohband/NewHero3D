#!/bin/zsh
# 批量走「混元 3D 网页版 · 单张图片」重建：提交 → 拉取 → 规范化文件名 → 剔冗余。
#
# 前置：先用 tools/hy3d_web_login.js 扫码登录过一次（登录态在持久化 profile 里）。
# 用法：zsh tools/batch_hy3d_web.sh [uid ...]      # 不传 uid 则跑默认名单
#
# 为什么不用 gen.js 的 --save：
#   hookNetwork 会把 /api/3d/creations/list 里**所有历史任务的直链**都抓进来
#   （实测一次抓到 9 条，含前一位角色的旧产物），落盘会张冠李戴。
#   正解是 pull（读 creations[0]，已在公孙胜上验证 = 最新任务）。
#
# 为什么删 objzip / mtl / pbr 分图：
#   .objzip.zip 与 .obj+.mtl 重复；.mtl.bin 实测 0 字节（该直链是坏的）；
#   .pbr*.png 全部已内嵌在 .glb 里（textureGlb）。
#   本机磁盘已用 95%，剔除后每人从 ~96MB 降到 ~38MB。

set -u
cd "$(dirname "$0")/.."

DEFAULT_UIDS=(wu_yong li_kui qin_ming hu_sanniang yan_qing dai_zong an_daoquan)
if [ $# -gt 0 ]; then
  UIDS=("$@")
else
  UIDS=("${DEFAULT_UIDS[@]}")
fi

FAILED=()
OKS=()

for uid in "${UIDS[@]}"; do
  echo ""
  echo "==================== $uid : submit @ $(date +%H:%M:%S) ===================="

  if [ ! -f "assets/refs/${uid}_front.png" ]; then
    echo "[SKIP] 缺参考图 assets/refs/${uid}_front.png"
    FAILED+=("$uid:no-ref")
    continue
  fi

  LOG="/tmp/hy3d_${uid}.log"
  node tools/hy3d_web_gen.js --single --front "assets/refs/${uid}_front.png" \
       --faces 50k --out "/tmp/hy3d_${uid}.png" >"$LOG" 2>&1
  # 只回显关键行，避免把一堆签名直链刷屏
  grep -E '^\[input\]|^\[ok\]|^\[step\]|^\[slots\]|^\[upload\]|^\[gen\]|^\[DONE\]|^\[TIMEOUT|^\[ERROR\]|^\[ABORT\]|^\[WARN\]' "$LOG" | tail -14

  if grep -q '^\[ERROR\]\|^\[ABORT\]' "$LOG"; then
    echo "[FAIL] $uid 提交阶段报错，见 $LOG"
    FAILED+=("$uid:submit")
    continue
  fi
  if grep -q '^\[TIMEOUT' "$LOG"; then
    echo "[WARN] $uid 20 分钟未等到完成标记，仍尝试 pull"
  fi

  echo "==================== $uid : pull @ $(date +%H:%M:%S) ===================="
  node tools/hy3d_web_fetch.js pull --out assets/models --name "${uid}_ai" --timeout 900 2>&1 \
    | grep -E '^\[SAVED\]|^\[OK\]|^\[TIMEOUT|^\[ABORT|选中 id=' | tail -14

  # 规范化文件名（对齐 docs/pipeline-3d-asset.md §7）
  [ -f "assets/models/${uid}_ai.obj.obj" ]     && mv -f "assets/models/${uid}_ai.obj.obj"     "assets/models/${uid}_ai.obj"
  [ -f "assets/models/${uid}_ai.preview.png" ] && mv -f "assets/models/${uid}_ai.preview.png" "assets/models/${uid}_ai_preview.png"

  # 剔冗余
  rm -f "assets/models/${uid}_ai.objzip.zip" \
        "assets/models/${uid}_ai.mtl.bin" \
        "assets/models/${uid}_ai.pbr.png" \
        "assets/models/${uid}_ai.pbr_normal.png" \
        "assets/models/${uid}_ai.pbr_roughness.png" \
        "assets/models/${uid}_ai.pbr_metallic.png"

  if [ -f "assets/models/${uid}_ai.glb" ]; then
    echo "==================== $uid : OK @ $(date +%H:%M:%S) ===================="
    ls -la "assets/models/${uid}_ai.glb" "assets/models/${uid}_ai.obj" "assets/models/${uid}_ai_preview.png" 2>/dev/null \
      | awk '{printf "   %7.1f MB  %s\n", $5/1048576, $NF}'
    OKS+=("$uid")
  else
    echo "==================== $uid : FAILED @ $(date +%H:%M:%S) ===================="
    FAILED+=("$uid:download")
  fi
done

echo ""
echo "################ 批量结束 $(date +%H:%M:%S) ################"
echo "成功 ${#OKS[@]} 个：${OKS[@]}"
[ ${#FAILED[@]} -gt 0 ] && echo "失败 ${#FAILED[@]} 个：${FAILED[@]}"
echo "=== 剩余额度 ==="
node tools/hy3d_web_quota.js 2>&1 | tail -2
echo "=== 磁盘 ==="
df -h . | tail -1
