// 演武场异步 PVP（对应 Godot 版 arena_system.gd，D34）
// 本地镜像闭环：攻方手动 vs 「自己的守方阵容」AI 镜像；守方默认等级前 4。
import { computeUnitData } from "./progression.js";

export const ARENA_MAX_TEAM = 4;
export const ARENA_REWARD = { gold: 300, arena_point: 1 };

export const TEMPLATES = {
  steady: {
    name: "稳健防守", desc: "承伤意识×1.5，伤害期望×0.8，远离布阵区每格 -10 分",
    weights: { danger: 1.5, damage_expect: 0.8 },
  },
  aggressive: {
    name: "激进突进", desc: "伤害期望×1.3，击杀加分×1.5，承伤意识×0.6",
    weights: { damage_expect: 1.3, kill_bonus: 1.5, danger: 0.6 },
  },
  protect_core: {
    name: "保护核心", desc: "队友距核心 ≤2 格 +20 分，核心承伤预估×2（核心 = 守方首单位）",
    weights: {},
  },
};
export const TEMPLATE_IDS = Object.keys(TEMPLATES);

export function getArena(profile) {
  if (!profile.progress.arena) {
    profile.progress.arena = { team: [], template: "steady" };
  }
  return profile.progress.arena;
}

// 守方阵容：已配置或等级前 4
export function defendTeam(profile) {
  const arena = getArena(profile);
  const owned = Object.values(profile.heroes);
  if (!arena.team || arena.team.length === 0) {
    return owned
      .sort((a, b) => b.level - a.level)
      .slice(0, ARENA_MAX_TEAM)
      .map((h) => h.unit_id);
  }
  return arena.team.filter((id) => profile.heroes[id]).slice(0, ARENA_MAX_TEAM);
}

export function setDefendTeam(profile, team) {
  getArena(profile).team = team.slice(0, ARENA_MAX_TEAM);
}

export function cycleTemplate(profile) {
  const arena = getArena(profile);
  const idx = TEMPLATE_IDS.indexOf(arena.template);
  arena.template = TEMPLATE_IDS[(idx + 1) % TEMPLATE_IDS.length];
  return arena.template;
}

// 动态生成 10×8 关卡；守方按玩家养成数值生成为敌方（defenders 供战斗场景替换数值）
export function buildArenaLevel(profile, data) {
  const team = defendTeam(profile);
  const defenders = team.map((unitId) => {
    const hero = profile.heroes[unitId];
    return { unitId, hero, data: computeUnitData(data, hero, data.getUnit(unitId)) };
  });
  const coords = [[4, 1], [5, 1], [3, 2], [6, 2]];
  const enemies = defenders.map((d, i) => ({ unit: d.unitId, coords: coords[i % coords.length] }));
  const level = {
    id: "arena", name: "演武场·切磋", mode: "arena", ending: "", chapter: 1,
    recommended_level: 1, exp_override: 0, pvp_template: getArena(profile).template,
    grid_size: [10, 8],
    terrain_map: { "2,2": "hill", "2,3": "hill", "7,2": "hill", "7,3": "hill" },
    height_map: { "2,2": 1, "2,3": 1, "7,2": 1, "7,3": 1 },
    win_condition: { type: "WIPE_OUT" },
    lose_conditions: [{ type: "WIPED_OUT" }],
    required_units: [], roster: Object.keys(profile.heroes),
    deploy_zone: [0, 6, 10, 2], max_deploy: 4,
    fog: false, allowed_classes: [],
    npc_allies: [], enemies, objects: [], triggers: [],
    rewards: { first_clear: { ...ARENA_REWARD }, regular: { ...ARENA_REWARD } },
    rank_rules: {}, unlock_grant: {}, achievements: [],
  };
  return { level, defenders };
}

// 战斗 setup 后调用：生成 pvpMods（权重 + 模板附加参数）
export function buildPvpMods(profile, defendUnits) {
  const template = getArena(profile).template;
  const mods = { template, weights: TEMPLATES[template].weights };
  if (template === "steady") mods.deployAnchor = { x: 4, y: 1 };
  if (template === "protect_core") {
    mods.core = defendUnits[0] || null;
    mods.coreDangerMult = 2;
  }
  return mods;
}
