// Buff 数据结构（对应 Godot 版 buff.gd）
// stat_mods 字段口径：atk/def/mgc/spd 为百分数；dodge/block/crit 为概率点直接相加；move 为格数。
// status 词表：stun / sleep / paralyze / bind / guard / counter
export function makeBuff({
  buff_id,
  name = "",
  stat_mods = {},
  duration = 1,          // 持有者自己回合开始阶段二 -1
  stacks = 1,            // 未实装叠层（沿用原作）
  dispellable = true,
  is_debuff = false,
  tick_effect = null,    // {kind: "dot"|"hot", percent: int}（按最大生命百分比）
  status = "",
  aura_mods = null,      // {field: int}；aura_radius>0 时生效
  aura_radius = 0,       // 0 = 非光环
  source = null,
}) {
  return {
    buff_id, name, stat_mods, duration, stacks, dispellable,
    is_debuff, tick_effect, status, aura_mods, aura_radius, source,
  };
}

export function isBuffExpired(buff) {
  return buff.duration <= 0;
}
