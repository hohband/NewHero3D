// 养成线（对应 Godot 版 progression.gd，D29 占位公式）
// 数值参数全部来自 data/progression.csv（经 DataLoader.getProgression 读取）。
import { QUALITY_ORDER } from "../data_loader.js";

function P(data, key, def) { return data.getProgression(key, def); }

// 战斗数值 = f(基础数据, 养成档案)
export function computeUnitData(data, hero, base) {
  const levelGrowth = P(data, "level_stat_growth", 0.02);
  const starMult = P(data, "star_stat_mult", 0.1);
  const breakStep = P(data, "breakthrough_stat_step", 0.08);
  const enhanceAtk = P(data, "weapon_enhance_atk", 0.03);
  const refineAtk = P(data, "weapon_refine_atk", 0.05);
  const qualitySteps = QUALITY_ORDER.indexOf(hero.quality) - QUALITY_ORDER.indexOf(base.quality);
  const statMult = (1 + levelGrowth * (hero.level - 1)) * (1 + starMult * (hero.star - 1)) * (1 + breakStep * qualitySteps);
  return {
    ...base,
    quality: hero.quality,
    hp: Math.round(base.hp * statMult),
    def: Math.round(base.def * statMult),
    mgc: Math.round(base.mgc * statMult),
    spd: Math.round(base.spd * statMult),
    atk: Math.round(base.atk * statMult * (1 + enhanceAtk * hero.weapon_enhance + refineAtk * hero.weapon_refine)),
  };
}

export function expForLevel(data, level) {
  return P(data, "level_exp_base", 100) * level;
}

// 吃经验循环升级，返回升了几级（无等级上限）
export function addExp(data, hero, exp) {
  hero.exp += exp;
  let ups = 0;
  while (hero.exp >= expForLevel(data, hero.level)) {
    hero.exp -= expForLevel(data, hero.level);
    hero.level += 1;
    ups += 1;
  }
  return ups;
}

export function starShardCost(data, targetStar) {
  return P(data, "star_shard_cost", 10) * targetStar;
}

export function canStarUp(data, hero) {
  return hero.star < P(data, "star_max", 5);
}

export function starUp(hero) {
  hero.star += 1; // 碎片扣减在调用方
}

// 满星才可突破：品质沿 绿→蓝→紫→橙 升一档，保持星数（D29）
export function canBreakthrough(data, hero) {
  return hero.star >= P(data, "star_max", 5) && QUALITY_ORDER.indexOf(hero.quality) < QUALITY_ORDER.length - 1;
}

export function breakthrough(hero) {
  const idx = QUALITY_ORDER.indexOf(hero.quality);
  hero.quality = QUALITY_ORDER[idx + 1];
}

export const BREAKTHROUGH_MAT_COST = 3; // 消耗写死在 UI 层（原作如此）

export function skillBookCost(data, targetLevel) {
  return P(data, "skill_book_cost", 1) * targetLevel;
}

export function canSkillUpgrade(data, hero, skillId) {
  return (hero.skill_levels[skillId] || 1) < P(data, "skill_level_max", 5);
}

export function skillUpgrade(hero, skillId) {
  hero.skill_levels[skillId] = (hero.skill_levels[skillId] || 1) + 1;
}

export function enhanceGoldCost(data, targetLevel) {
  return P(data, "weapon_enhance_gold", 100) * targetLevel;
}

export function canWeaponEnhance(data, hero) {
  return hero.weapon_enhance < P(data, "weapon_enhance_max", 10);
}

export function weaponEnhance(hero) {
  hero.weapon_enhance += 1;
}

export function canWeaponRefine(data, hero) {
  return hero.weapon_refine < P(data, "weapon_refine_max", 5);
}

export function weaponRefine(hero) {
  hero.weapon_refine += 1;
}
