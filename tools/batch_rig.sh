#!/bin/zsh
# 批量「清碎块 → 无头绑骨」：assets/models/<uid>_ai.glb  →  assets/models/<uid>.glb
#
# 用法：zsh tools/batch_rig.sh [uid ...]      # 不传 uid 则跑默认名单
#
# 两个设计决定：
#  1) 清碎块写 /tmp 临时文件、不覆盖 <uid>_ai.glb —— 原始重建件保留，便于复跑与溯源。
#     每跑完一位立刻删临时件（本机磁盘已用 95%）。
#  2) 从 Blender 日志里把 PROP_CLUSTERS / MESH_IN / 顶点数 抓出来存档，
#     兵器到底认没认出来只看这一行，不能凭肉眼看渲染图猜。
#
# 注意：tools/mesh_clean_islands.py 与 tools/blender_rig_character.py 都依赖 bpy，
#       必须用 Blender 自带的 Python 跑（-- 之后才是脚本自己的参数）。

set -u
cd "$(dirname "$0")/.."

BLENDER="/Applications/Blender.app/Contents/MacOS/Blender"
DEFAULT_UIDS=(song_wan du_qian bai_sheng shi_yong wang_ying wang_dingliu sun_erniang jiao_ting gong_wang ding_desun)
if [ $# -gt 0 ]; then
  UIDS=("$@")
else
  UIDS=("${DEFAULT_UIDS[@]}")
fi

# 武器持握手（第三参数）。两批 18 人全部是右手持械（或双手持） → 全 R。
# ⚠️ 缺键会在 set -u 下直接报错，新批次务必先补这张表。
# 详见各 docs/character-<uid>.md 的 §5 提示词。
typeset -A HAND
HAND=(gongsun_sheng R wu_yong R li_kui R qin_ming R hu_sanniang R yan_qing R dai_zong R an_daoquan R
      song_wan R du_qian R bai_sheng R shi_yong R wang_ying R wang_dingliu R sun_erniang R jiao_ting R gong_wang R ding_desun R)

OKS=(); FAILED=()
mkdir -p /tmp/riglog

for uid in "${UIDS[@]}"; do
  SRC="assets/models/${uid}_ai.glb"
  TMP="/tmp/${uid}_clean.glb"
  DST="assets/models/${uid}.glb"
  CLEANLOG="/tmp/riglog/${uid}_clean.log"
  RIGLOG="/tmp/riglog/${uid}_rig.log"

  echo ""
  echo "==================== $uid : clean @ $(date +%H:%M:%S) ===================="
  if [ ! -f "$SRC" ]; then
    echo "[SKIP] 缺 $SRC"
    FAILED+=("$uid:no-src")
    continue
  fi

  "$BLENDER" -b --python tools/mesh_clean_islands.py -- "$SRC" "$TMP" >"$CLEANLOG" 2>&1
  grep -E '^\[in\]|^\[islands\]|^\[clean\]|^\[out\]|CLEAN_DONE|用法' "$CLEANLOG" | tail -8

  if [ ! -f "$TMP" ]; then
    echo "[FAIL] 清碎块未产出 $TMP，见 $CLEANLOG"
    FAILED+=("$uid:clean")
    continue
  fi

  echo "==================== $uid : rig @ $(date +%H:%M:%S) ===================="
  "$BLENDER" -b --python tools/blender_rig_character.py -- "$TMP" "$DST" "${HAND[$uid]}" >"$RIGLOG" 2>&1
  grep -E '^MESH_IN|^TEX_SCALED|^BBOX|^NORMALIZED|^GROUND_OFFSET|^PROP_CLUSTERS|^WEIGHT_COVERAGE|^EXPORTED|^DONE|Error|Traceback' "$RIGLOG" | tail -14

  rm -f "$TMP"

  if [ -f "$DST" ]; then
    printf "   %s : %.2f MB\n" "$DST" "$(stat -f%z "$DST" | awk '{print $1/1048576}')"
    OKS+=("$uid")
  else
    echo "[FAIL] 绑骨未产出 $DST，见 $RIGLOG"
    FAILED+=("$uid:rig")
  fi
done

echo ""
echo "################ 绑骨批量结束 $(date +%H:%M:%S) ################"
echo "成功 ${#OKS[@]}：${OKS[@]}"
[ ${#FAILED[@]} -gt 0 ] && echo "失败 ${#FAILED[@]}：${FAILED[@]}"

echo ""
echo "=== 兵器识别一览（PROP_CLUSTERS 行）==="
for uid in "${UIDS[@]}"; do
  printf "%-16s " "$uid"
  grep -h 'PROP_CLUSTERS' "/tmp/riglog/${uid}_rig.log" 2>/dev/null | tail -1 || echo "(无日志)"
done

echo ""
echo "=== 磁盘 ==="
df -h . | tail -1
