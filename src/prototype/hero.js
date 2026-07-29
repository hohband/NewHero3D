// 养成数据模型（纯逻辑层）：培养阶 tier / 等级 / 技能等级 → 面板与技能槽解锁
// 品质（units.csv.quality）= 先天稀有度（收集），培养阶 tier = 后天提升（解锁技能槽），两轴不得混用
// 公式：stat = base + per_level×(level-1) + per_tier×tierIndex（growth_curve.csv，同职业同曲线）

export const TIER_NAMES = ["绿", "蓝", "紫", "橙", "红"];
export const TIER_INDEX = { green: 0, blue: 1, purple: 2, orange: 3, red: 4 };

// 技能槽解锁所需 tier（绿=普攻+小技能+大招，蓝+被动1，紫+被动2，橙+觉醒技）
export const TIER_UNLOCK = { small: 0, ult: 0, passive1: 1, passive2: 2, awaken: 3 };

// 红阶（tier4）：觉醒技效果 ×1.3，技能等级上限放开到 skill_level_max
export const AWAKEN_RED_MULT = 1.3;

export function makeHeroState(id, o = {}) {
  return {
    id,
    level: o.level ?? 1,
    tier: o.tier ?? 0,
    skill: { small: o.skill?.small ?? 1, ult: o.skill?.ult ?? 1 },
    exp: o.exp ?? 0,
  };
}

export function skillLevelCap(tier, prog) {
  return tier >= 4 ? (prog.skill_level_max ?? 5) : (prog.skill_level_max_normal ?? 3);
}

// 技能效果倍率：1 + skill_level_mult × (技能等级-1)
export function effectMult(skillLevel, prog) {
  return 1 + (prog.skill_level_mult ?? 0) * (skillLevel - 1);
}

// 升级所需经验 = level_exp_base × 当前等级
export function expToNext(level, prog) {
  return (prog.level_exp_base ?? 100) * level;
}

// curve: Map("class|stat" → {base, per_level, per_tier})；unitRow: units.csv 行（兜底与个性属性）
// 有曲线行 → hp/atk/def/mgc 走曲线；无曲线行（Boss/特殊单位）→ units.csv 白值兜底
export function computePanel(unitRow, curve, state) {
  const cls = unitRow.class;
  const lv = state.level, ti = state.tier;
  const stat = (name, fallback) => {
    const c = curve.get(`${cls}|${name}`);
    if (!c) return fallback;
    return Math.round(c.base + c.per_level * (lv - 1) + c.per_tier * ti);
  };
  const num = (v) => parseInt(String(v).trim(), 10) || 0;
  return {
    hp: stat("hp", num(unitRow.hp)),
    atk: stat("atk", num(unitRow.atk)),
    def: stat("def", num(unitRow.def)),
    mgc: stat("mgc", num(unitRow.mgc)),
    spd: num(unitRow.spd), crit: num(unitRow.crit),
    dodge: num(unitRow.dodge), block: num(unitRow.block),
  };
}
