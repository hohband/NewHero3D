// 梁山远征（Roguelike 爬塔，对应 Godot 版 expedition_system.gd，D35）
// 队伍 = 等级前 4；10 层；敌人每层全属性 +12%；生命按比率跨层继承；每层胜利三选一。
export const MAX_FLOOR = 10;
export const FLOOR_STAT_STEP = 0.12;
export const FLOOR_GOLD = 200;
export const MAT_EVERY_FLOORS = 3;

export const CHOICES = [
  { id: "rest", name: "休整", desc: "存活队友恢复 30% 生命" },
  { id: "hone", name: "磨刀", desc: "全队攻击 +10%（不可驱散）" },
  { id: "camp", name: "扎营", desc: "全队防御 +10%（不可驱散）" },
];

export function newRun(profile) {
  const team = Object.values(profile.heroes)
    .sort((a, b) => b.level - a.level)
    .slice(0, 4)
    .map((h) => ({ unit_id: h.unit_id, hp_ratio: 1, alive: true }));
  return { floor: 1, team, buffs: [], finished: false };
}

export function statMult(floor) {
  return 1 + FLOOR_STAT_STEP * (floor - 1);
}

// 每层敌人组合（占位，沿用原作口径：厢军枪/盾 + 老都管，5/9 层精英、10 层杨志压阵）
function floorEnemies(floor) {
  const mult = statMult(floor);
  const S = "xiangjun_spear";
  const D = "xiangjun_shield";
  if (floor >= MAX_FLOOR) {
    return [
      { unit: "yang_zhi_boss", coords: [4, 1], elite: true, boss: true, stat_mult: mult },
      { unit: S, coords: [3, 2], stat_mult: mult },
      { unit: S, coords: [5, 2], stat_mult: mult },
      { unit: D, coords: [4, 3], stat_mult: mult },
    ];
  }
  const elite = floor === 5 || floor === 9;
  const list = [];
  if (floor <= 3) {
    list.push(
      { unit: S, coords: [3, 1], stat_mult: mult, elite },
      { unit: S, coords: [5, 1], stat_mult: mult },
      { unit: D, coords: [4, 2], stat_mult: mult },
    );
  } else if (floor <= 6) {
    list.push(
      { unit: S, coords: [3, 1], stat_mult: mult, elite },
      { unit: S, coords: [5, 1], stat_mult: mult },
      { unit: D, coords: [3, 2], stat_mult: mult },
      { unit: D, coords: [5, 2], stat_mult: mult },
      { unit: "lao_duguan", coords: [4, 0], stat_mult: mult },
    );
  } else {
    list.push(
      { unit: S, coords: [2, 1], stat_mult: mult, elite },
      { unit: S, coords: [4, 1], stat_mult: mult },
      { unit: S, coords: [6, 1], stat_mult: mult },
      { unit: D, coords: [3, 2], stat_mult: mult },
      { unit: D, coords: [5, 2], stat_mult: mult },
      { unit: "lao_duguan", coords: [4, 0], stat_mult: mult },
    );
  }
  return list;
}

// 地形按 floor%3 轮换
function floorTerrain(floor) {
  const r = floor % 3;
  if (r === 0) {
    return {
      terrain_map: { "2,2": "forest", "3,2": "forest", "5,4": "forest", "6,4": "forest" },
      height_map: {},
    };
  }
  if (r === 1) {
    return {
      terrain_map: { "2,3": "hill", "5,3": "hill" },
      height_map: { "2,3": 1, "5,3": 1 },
    };
  }
  return {
    terrain_map: { "3,3": "camp", "4,3": "camp", "1,4": "forest", "6,4": "forest" },
    height_map: {},
  };
}

export function buildFloor(run) {
  const { terrain_map, height_map } = floorTerrain(run.floor);
  return {
    id: `expedition_${run.floor}`, name: `梁山远征·第 ${run.floor} 层`, mode: "expedition",
    ending: "", chapter: 1, recommended_level: run.floor * 3, exp_override: 0,
    pvp_template: "", grid_size: [8, 8], terrain_map, height_map,
    win_condition: { type: "WIPE_OUT" },
    lose_conditions: [{ type: "WIPED_OUT" }],
    required_units: [], roster: run.team.filter((m) => m.alive).map((m) => m.unit_id),
    deploy_zone: [0, 6, 8, 2], max_deploy: 4,
    fog: false, allowed_classes: [],
    npc_allies: [], enemies: floorEnemies(run.floor), objects: [], triggers: [],
    rewards: { first_clear: {}, regular: {} },
    rank_rules: {}, unlock_grant: {}, achievements: [],
  };
}

export function applyChoice(run, choiceId) {
  if (choiceId === "rest") {
    for (const m of run.team) {
      if (m.alive) m.hp_ratio = Math.min(1, m.hp_ratio + 0.3);
    }
  } else if (choiceId === "hone") {
    run.buffs.push({ field: "atk", value: 10 });
  } else if (choiceId === "camp") {
    run.buffs.push({ field: "def", value: 10 });
  }
}

// 层间记录队伍状态（战斗结束后调用）
export function recordTeamState(run, units) {
  for (const m of run.team) {
    const u = units.find((x) => x.unitId === m.unit_id && x.hero);
    if (!u) continue;
    m.alive = u.alive;
    m.hp_ratio = u.alive ? u.hp / u.data.hp : 0;
  }
}

export function isRunDead(run) {
  return run.team.every((m) => !m.alive);
}

// 结算：每层 200 金 + 每 3 层 1 突破材料；返回 {gold, mat, floors}
export function settleRun(profile, run) {
  const floors = run.finished ? MAX_FLOOR : run.floor - 1;
  const gold = FLOOR_GOLD * floors;
  const mat = Math.floor(floors / MAT_EVERY_FLOORS);
  profile.gold += gold;
  if (mat > 0) profile.gainItem("breakthrough_mat", mat);
  const best = profile.progress.expedition_best || 0;
  if (floors > best) profile.progress.expedition_best = floors;
  run.finished = true;
  return { gold, mat, floors };
}
