// 目标选择（对应 Godot 版 targeting.gd，全 static 纯函数）
// 距离口径：adjacent/diamond 曼哈顿；ring 切比雪夫；line 有向/无向；all 全图；self 自身。
import { manhattan, chebyshev, dominantDir } from "./coords.js";
import { Team } from "./unit.js";

const NO_AIM = { x: -1, y: -1 };

function targetFilter(skill, caster, u) {
  if (!u.alive) return false;
  if (u.collectable) return false; // 物件一律不可指定
  switch (skill.target) {
    case "enemy":
      // PLAYER 与 NPC_ALLY 互不敌对，但也互不算 ally
      return (u.team === Team.ENEMY) !== (caster.team === Team.ENEMY);
    case "ally":
      return u.team === caster.team; // 含自己（如金疮药「为自己或相邻友军」）
    case "self":
      return u === caster;
    default:
      return false;
  }
}

function inArea(skill, from, coords, aim) {
  const shape = skill.range_shape;
  if (shape === "self") return coords.x === from.x && coords.y === from.y;
  if (shape === "all") return true;
  if (shape === "ring") {
    const d = chebyshev(from, coords);
    return d >= skill.range_min && d <= skill.range_max;
  }
  if (shape === "line") {
    const hasAim = aim && !(aim.x === NO_AIM.x && aim.y === NO_AIM.y);
    if (!hasAim) {
      // 无指向（AI/预览）：同横或同纵线且曼哈顿在程内
      const sameAxis = coords.x === from.x || coords.y === from.y;
      if (!sameAxis) return false;
      const d = manhattan(from, coords);
      return d >= skill.range_min && d <= skill.range_max;
    }
    const dir = dominantDir({ x: aim.x - from.x, y: aim.y - from.y });
    if (dir.x === 0 && dir.y === 0) return false;
    const diff = { x: coords.x - from.x, y: coords.y - from.y };
    // 只保留该方向轴线上、同号、距离在程内的格
    if (dir.x !== 0) {
      if (diff.y !== 0 || Math.sign(diff.x) !== dir.x) return false;
    } else {
      if (diff.x !== 0 || Math.sign(diff.y) !== dir.y) return false;
    }
    const d = manhattan(from, coords);
    return d >= skill.range_min && d <= skill.range_max;
  }
  // adjacent / diamond：曼哈顿区间（同义）
  const d = manhattan(from, coords);
  return d >= skill.range_min && d <= skill.range_max;
}

// resolveFrom(skill, caster, aim, grid, units, rolls, origin=null)
// 后置修正从 skill._mods 读（EffectSystem 在调用前挂好；AI/无修饰时为空）
export function resolveFrom(skill, caster, aim, grid, units, rolls, origin = null) {
  if (skill.range_shape === "self") return [caster];
  const from = origin || caster.coords;
  const mods = skill._mods || {};
  let targets = units.filter((u) => targetFilter(skill, caster, u) && inArea(skill, from, u.coords, aim));
  if (mods.target_rule === "lowest_hp" && targets.length > 1) {
    let lowest = targets[0];
    for (const u of targets) if (u.hp < lowest.hp) lowest = u;
    targets = [lowest];
  } else if (mods.target_rule === "random" && targets.length > 1) {
    const idx = Math.floor(Math.min(Math.max(rolls.roll() / 100, 0), 0.9999) * targets.length);
    targets = [targets[idx]];
  }
  if (mods.random_target !== undefined && targets.length > mods.random_target) {
    const n = mods.random_target;
    const pool = [...targets];
    targets = [];
    for (let i = 0; i < n && pool.length > 0; i++) {
      const idx = Math.floor(Math.min(Math.max(rolls.roll() / 100, 0), 0.9999) * pool.length);
      targets.push(pool.splice(idx, 1)[0]);
    }
  }
  if (mods.friendly_fire !== undefined) {
    const p = mods.friendly_fire * 100;
    const hit = new Set(targets);
    for (const u of units) {
      if (!u.alive || u === caster || hit.has(u)) continue;
      if (u.team !== caster.team) continue;
      if (!inArea(skill, from, u.coords, aim)) continue;
      if (rolls.roll() < p) targets.push(u);
    }
  }
  return targets;
}

// 预览/AI 用：全图扫描（aim=(-1,-1)）
export function cellsInRange(skill, caster, grid, units) {
  return units.filter((u) => targetFilter(skill, caster, u) && inArea(skill, caster.coords, u.coords, NO_AIM));
}

export function needsAim(skill) {
  return skill.range_shape === "line" && skill.target === "enemy";
}

export { inArea, targetFilter, NO_AIM };
