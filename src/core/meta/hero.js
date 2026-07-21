// 武将养成实例（对应 Godot 版 hero.gd）
export function makeHero(unitId, quality) {
  return {
    unit_id: unitId,
    level: 1,
    exp: 0,
    star: 1,
    quality,                 // 当前品质（可突破改变）
    weapon_enhance: 0,
    weapon_refine: 0,
    has_signature_weapon: false,
    skill_levels: {},        // skill_id -> 等级（默认 1）
  };
}

export function heroToDict(hero) {
  return { ...hero, skill_levels: { ...hero.skill_levels } };
}

export function heroFromDict(d) {
  return {
    ...makeHero(d.unit_id, d.quality),
    ...d,
    skill_levels: { ...(d.skill_levels || {}) },
  };
}
