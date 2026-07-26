// 专属武器（对应 Godot 版 signature_weapon.gd，D35）
// 解锁：3 星 + 突破材料 ×5；效果：技能形态质变注册表。新专武 = MORPHS 加一行。
export const SIGNATURE_STAR_REQUIRED = 3;
export const SIGNATURE_MAT_COST = 5;

export const MORPHS = {
  // 汤隆：单体破甲 → 溅射 2 格群体
  act_goulian: { effect: "armor_break", splash_radius: 2 },
};

export function canUnlockSignature(hero) {
  return !hero.has_signature_weapon && hero.star >= SIGNATURE_STAR_REQUIRED;
}

export function unlockSignature(hero) {
  hero.has_signature_weapon = true; // 材料扣减在调用方
}

// 战斗结算时注入 ctx.mods.signature_morph（BattleManager.signatureMorphProvider 接线）
export function morphFor(hero, skillId) {
  if (!hero || !hero.has_signature_weapon) return {};
  const morph = MORPHS[skillId];
  return morph ? { signature_morph: morph } : {};
}
