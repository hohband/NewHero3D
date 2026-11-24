#!/bin/zsh
# 第 9 步验证：把绑骨成品放进战场与单模型 viewer 各截一次图，并把 HTTP 状态码留档。
#
# 用法：zsh tools/verify_batch_shots.sh [uid ...]
#
# 关键纪律：**不能靠肉眼判断模型有没有加载成功** —— side_battle.js 加载失败会静默回退胶囊体，
# 回退占位体「看起来也像有个东西站在那里」。唯一硬证据是 `.glb` 请求的 HTTP 状态码 == 200。
# shot_battle.js 已内置记录（输出 `[glb]` 与 `[404]` 两行），本脚本把原始输出整份存到 /tmp/shotlog/。

set -u
cd "$(dirname "$0")/.."

DEFAULT_UIDS=(gongsun_sheng wu_yong li_kui qin_ming hu_sanniang yan_qing dai_zong an_daoquan)
if [ $# -gt 0 ]; then
  UIDS=("$@")
else
  UIDS=("${DEFAULT_UIDS[@]}")
fi

PORT="${PORT:-8123}"
# 产物目录可用环境变量覆盖（默认保持 batch2 的旧路径，向后兼容）：
#   OUTDIR=assets/models/batch3_shots zsh tools/verify_batch_shots.sh <uid...>
OUTDIR="${OUTDIR:-assets/models/batch2_shots}"
mkdir -p "$OUTDIR" /tmp/shotlog

# 起本地静态服务（battle-proto.html / model-viewer.html 与 assets 都在仓库根）
/Users/hohbandlee/.workbuddy/binaries/python/versions/3.13.12/bin/python3 -m http.server "$PORT" \
  >/tmp/shotlog/server.log 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null' EXIT
sleep 2
BASE="http://127.0.0.1:$PORT"
echo "[server] $BASE (pid $SRV)"

echo ""
echo "########## A. 单模型 viewer（attack 动作，便于看兵器与蒙皮）##########"
QUERY=()
for uid in "${UIDS[@]}"; do
  [ -f "assets/models/${uid}.glb" ] || { echo "[SKIP] 缺 assets/models/${uid}.glb"; continue; }
  QUERY+=("$OUTDIR/model_${uid}.png" "m=assets/models/${uid}.glb&anim=attack&t=0.35")
done
if [ ${#QUERY[@]} -gt 0 ]; then
  node tools/shot_models.js "$BASE" "${QUERY[@]}" 2>&1 | tee /tmp/shotlog/models.log | tail -30
else
  echo "[SKIP] 没有任何绑骨成品"
fi

echo ""
echo "########## B. 战场全景（分批，前排 3 + 后排 2）##########"
BATCH1=( "${UIDS[@]:0:5}" )
BATCH2=( "${UIDS[@]:5}" )
ALL=( "${UIDS[@]}" )

present() {  # 只保留已存在的，拼成逗号串
  local acc=()
  for u in "$@"; do [ -f "assets/models/${u}.glb" ] && acc+=("$u"); done
  echo "${(j:,:)acc}"
}
B1=$(present "${BATCH1[@]}")
B2=$(present "${BATCH2[@]}")

if [ -n "$B1" ]; then
  echo "--- 批次 1: $B1 ---"
  node tools/shot_battle.js "$BASE" "$OUTDIR/battle_group1.png" 9000 "$B1" 2>&1 | tee /tmp/shotlog/battle1.log | grep -E '^\[battle\]|^\[glb\]|^\[404\]|^\[patch\]|^\[shot\]|^\[pageerror\]|^\[console.error\]|^\[reqfail\]'
fi
if [ -n "$B2" ]; then
  echo "--- 批次 2: $B2 ---"
  node tools/shot_battle.js "$BASE" "$OUTDIR/battle_group2.png" 9000 "$B2" 2>&1 | tee /tmp/shotlog/battle2.log | grep -E '^\[battle\]|^\[glb\]|^\[404\]|^\[patch\]|^\[shot\]|^\[pageerror\]|^\[console.error\]|^\[reqfail\]'
fi

echo ""
echo "########## C. 回归：最初 5 个真模型（确认没被打破）##########"
node tools/shot_battle.js "$BASE" "$OUTDIR/battle_regression.png" 9000 2>&1 \
  | tee /tmp/shotlog/battle0.log | grep -E '^\[battle\]|^\[glb\]|^\[404\]|^\[shot\]|^\[pageerror\]'

echo ""
echo "########## D. 加载状态码汇总（硬证据，200 才算真加载）##########"
for f in /tmp/shotlog/battle0.log /tmp/shotlog/battle1.log /tmp/shotlog/battle2.log; do
  [ -f "$f" ] || continue
  echo "--- $(basename $f) ---"
  grep -E '^\[glb\]|^\[404\]' "$f"
done

echo ""
echo "产物目录："
ls -la "$OUTDIR" | tail -20
echo "SHOTS_ALL_DONE"
