// 山寨经营（对应 Godot 版 village_system.gd，D33）
// 三建筑（上限 3 级，升级费 = 500×当前级），每通关一次收获一轮；派驻 +25%，汤隆驻铁匠铺再 +25%。
import { addExp } from "./progression.js";

export const BUILDINGS = {
  juyiting: { name: "聚义厅", desc: "每通关产出金币 100×级" },
  tiejiangpu: { name: "铁匠铺", desc: "每通关产出突破材料" },
  yanwuchang: { name: "演武场", desc: "每通关全员经验 30×级" },
};
export const MAX_LEVEL = 3;
export const ASSIGN_BONUS = 0.25;
export const TANGLONG_BONUS = 0.25;

export function getVillage(profile) {
  if (!profile.progress.village) {
    profile.progress.village = {
      juyiting: { level: 1, assigned: null },
      tiejiangpu: { level: 0, assigned: null },
      yanwuchang: { level: 0, assigned: null },
    };
  }
  return profile.progress.village;
}

export function upgradeCost(building) {
  return 500 * building.level;
}

export function canUpgrade(building) {
  return building.level < MAX_LEVEL;
}

export function upgrade(profile, buildingId) {
  const village = getVillage(profile);
  const b = village[buildingId];
  if (!canUpgrade(b)) return { ok: false, reason: "已满级" };
  const cost = upgradeCost(b);
  if (!profile.spendGold(cost)) return { ok: false, reason: `金币不足（需 ${cost}）` };
  b.level += 1;
  return { ok: true };
}

// 派驻：一岗一人、一人限一岗（派驻自动从旧岗卸下）
export function assign(profile, buildingId, unitId) {
  const village = getVillage(profile);
  for (const b of Object.values(village)) {
    if (b.assigned === unitId) b.assigned = null;
  }
  village[buildingId].assigned = unitId;
}

export function unassign(profile, buildingId) {
  getVillage(profile)[buildingId].assigned = null;
}

// 产出倍率：派驻 +25%，汤隆驻铁匠铺再 +25%
export function yieldMult(building, buildingId) {
  let mult = 1;
  if (building.assigned) mult += ASSIGN_BONUS;
  if (buildingId === "tiejiangpu" && building.assigned === "tang_long") mult += TANGLONG_BONUS;
  return mult;
}

// 每通关收获一轮（Flow 在胜利结算时调用）；经验全员（含未上阵）发放
export function collect(profile, data) {
  const village = getVillage(profile);
  const out = { gold: 0, breakthrough_mat: 0, exp: 0, levelUps: 0 };
  const j = village.juyiting;
  if (j.level > 0) {
    out.gold = Math.round(100 * j.level * yieldMult(j, "juyiting"));
    profile.gold += out.gold;
  }
  const t = village.tiejiangpu;
  if (t.level > 0) {
    out.breakthrough_mat = Math.max(1, Math.round(1 * t.level * yieldMult(t, "tiejiangpu")));
    profile.gainItem("breakthrough_mat", out.breakthrough_mat);
  }
  const y = village.yanwuchang;
  if (y.level > 0) {
    out.exp = Math.round(30 * y.level * yieldMult(y, "yanwuchang"));
    for (const hero of Object.values(profile.heroes)) {
      out.levelUps += addExp(data, hero, out.exp);
    }
  }
  return out;
}
