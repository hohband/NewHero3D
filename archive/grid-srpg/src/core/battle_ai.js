// 战斗 AI（对应 Godot 版 battle_ai.gd，D26/D38/D45）
// 决策：枚举落点 ×（普攻/技能/待机/关卡目标/障碍兜底）候选，打分取最优，输出 Command 计划（0–2 个）。
import { manhattan } from "./coords.js";
import { Team } from "./unit.js";
import * as DamageCalculator from "./damage_calculator.js";
import * as Targeting from "./targeting.js";
import { parseEffects } from "./effect_system.js";
import { MoveCommand, AttackCommand, SkillCommand, WaitCommand, InteractCommand } from "./commands.js";
import { AutoMode } from "./battle_manager.js";

export const CONTROL_EFFECTS = ["stun", "sleep", "sleep_chance", "paralyze", "bind"];

export function decide(unit, battle) {
  const grid = battle.grid;
  const C = (key, def) => battle.data.getConstant(key, def);
  // 职业权重；PVP 守方按 pvpMods.weights 逐键乘系数
  const w = { ...battle.data.getAiWeights(unit.data.unit_class) };
  if (battle.pvpMods && battle.pvpMods.weights && unit.team === Team.ENEMY) {
    for (const [k, mult] of Object.entries(battle.pvpMods.weights)) {
      if (w[k] !== undefined) w[k] *= mult;
    }
  }
  // 枚举落点：原地 + 满移动力可达格
  const dests = [unit.coords];
  for (const key of grid.getReachable(unit, unit.getMove(grid)).keys()) {
    const [x, y] = key.split(",").map(Number);
    dests.push({ x, y });
  }
  const candidates = [];
  let hasAttackCandidate = false;
  const skills = usableSkills(unit, battle);
  for (const dest of dests) {
    // 普攻候选
    for (const enemy of enemiesOf(unit, battle)) {
      if (!battle.inAttackRangeFrom(unit, dest, enemy.coords)) continue;
      hasAttackCandidate = true;
      candidates.push({
        dest, kind: "attack", target: enemy,
        score: scoreAttack(unit, enemy, 1.0, 1, dest, battle, w),
      });
    }
    // 技能候选
    for (const skill of skills) {
      if (yaojiuReservedForStall(unit, skill, battle)) continue;
      if (skill.type === "ult" && unit.team === Team.PLAYER && battle.autoMode === AutoMode.SEMI) {
        const targets = Targeting.resolveFrom(skill, unit, null, grid, battle.units, battle.rolls, dest);
        if (!ultAllowed(unit, skill, targets, battle, C)) continue;
      }
      const scored = scoreSkill(unit, skill, dest, battle, w, C);
      if (scored !== null) candidates.push(scored);
    }
    // 待机候选
    candidates.push({ dest, kind: "wait", score: scoreWait(unit, dest, battle, w, C) });
  }
  // 关卡目标候选
  addObjectiveCandidates(unit, battle, dests, candidates, C);
  // 打障碍兜底：仅当没有任何普攻候选
  if (!hasAttackCandidate) {
    for (const dest of dests) {
      for (const cell of battle.grid.cells.values()) {
        if (!cell.hasObstacle()) continue;
        if (!battle.inAttackRangeFrom(unit, dest, cell.coords)) continue;
        candidates.push({
          dest, kind: "obstacle", targetCell: cell.coords,
          score: C("ai_obstacle_attack_base", 3),
        });
      }
    }
  }
  if (candidates.length === 0) return [];
  candidates.sort((a, b) => b.score - a.score);
  return buildPlan(unit, candidates[0], battle);
}

// —— 候选构建 ——
function usableSkills(unit, battle) {
  const out = [];
  for (const type of ["active", "ult"]) {
    const skill = battle.data.getSkillForUnit(unit.unitId, type);
    if (skill && battle.canUseSkill(unit, skill)) out.push(skill);
  }
  return out;
}

function enemiesOf(unit, battle) {
  return battle.units.filter((u) =>
    u.alive && !u.collectable && (u.team === Team.ENEMY) !== (unit.team === Team.ENEMY));
}

function alliesOf(unit, battle) {
  return battle.units.filter((u) => u.alive && !u.is_object && u.team === unit.team);
}

// 蒙汗药酒保留：act_yaojiu 持有者且场上有空酒摊时，不把它当普通技能放
function yaojiuReservedForStall(unit, skill, battle) {
  if (skill.skill_id !== "act_yaojiu") return false;
  for (const cell of battle.grid.cells.values()) {
    if (cell.terrain.terrain_id === "wine_stall" && !cell.occupant) return true;
  }
  return false;
}

function buildPlan(unit, best, battle) {
  const plan = [];
  const sameSpot = best.dest.x === unit.coords.x && best.dest.y === unit.coords.y;
  if (!sameSpot) {
    const path = battle.grid.findPath(unit, best.dest);
    if (path.length > 1) plan.push(new MoveCommand(unit, path.slice(1)));
  }
  switch (best.kind) {
    case "attack":
      plan.push(new AttackCommand(unit, best.target, battle.genericAttackSkill(unit)));
      break;
    case "skill": {
      let aim = null;
      if (Targeting.needsAim(best.skill)) aim = bestAim(unit, best.skill, best.dest, battle);
      plan.push(new SkillCommand(unit, best.skill, aim));
      break;
    }
    case "interact":
      plan.push(new InteractCommand(unit, best.target));
      break;
    case "obstacle":
      plan.push(new AttackCommand(unit, null, battle.genericAttackSkill(unit), best.targetCell));
      break;
    case "wait":
    default:
      plan.push(new WaitCommand(unit));
      break;
  }
  return plan;
}

// line 技能指向：选命中敌数最多的敌人格
function bestAim(unit, skill, dest, battle) {
  let best = null;
  let bestCount = 0;
  for (const enemy of enemiesOf(unit, battle)) {
    const aim = enemy.coords;
    const count = enemiesOf(unit, battle).filter((u) =>
      Targeting.inArea(skill, dest, u.coords, aim)).length;
    if (count > bestCount) { bestCount = count; best = aim; }
  }
  return best;
}

// —— 打分 ——
function scoreAttack(unit, target, mult, times, dest, battle, w, targetCount = 1) {
  const C = (key, def) => battle.data.getConstant(key, def);
  const est = DamageCalculator.estimateAt(unit, target, mult, battle.grid, dest) * times;
  let score = est * w.damage_expect;
  if (est >= target.hp) score += C("ai_kill_base", 50) * w.kill_bonus;
  score += targetValue(target, C) * w.target_value;
  score += danger(unit, dest, battle, C) * w.danger;
  score += auraCoverage(unit, dest, battle) * C("ai_aura_coverage_factor", 10) * w.aura_coverage;
  score += positionBonus(unit, target, dest, battle, C) * w.position;
  score += classSpecial(unit, target, dest, est, battle, C, targetCount);
  if (battle.pvpMods && unit.team === Team.ENEMY) score += pvpTemplateBonus(unit, dest, battle);
  if (battle.focusTarget === target) score += C("ai_focus_bonus", 100);
  return score;
}

function targetValue(target, C) {
  let v;
  switch (target.data.unit_class) {
    case "healer": v = C("ai_target_value_healer", 30); break;
    case "strategist": v = C("ai_target_value_strategist", 25); break;
    case "archer": case "infantry": case "cavalry": v = C("ai_target_value_dps", 20); break;
    case "vanguard": v = C("ai_target_value_vanguard", 10); break;
    default: v = C("ai_target_value_default", 15); break;
  }
  v += (1 - target.hp / target.data.hp) * C("ai_target_value_low_hp", 20);
  if (target.buffs.some((b) => b.buff_id.startsWith("bond_"))) v += C("ai_target_value_bond_core", 15);
  if (target.rage >= 100) v += C("ai_target_value_full_rage", 15);
  return v;
}

// 危险度：假想落点承伤总量 / 自身最大HP × (-30)
function danger(unit, dest, battle, C) {
  let total = 0;
  for (const e of enemiesOf(unit, battle)) {
    if (manhattan(e.coords, dest) <= e.data.move + e.data.range_max) {
      total += DamageCalculator.estimateAt(e, unit, 1.0, battle.grid, e.coords);
    }
  }
  let score = (total / unit.data.hp) * C("ai_danger_base", -30);
  if (battle.pvpMods && battle.pvpMods.core === unit && battle.pvpMods.coreDangerMult) {
    score *= battle.pvpMods.coreDangerMult;
  }
  return score;
}

// 光环覆盖：落点被我方光环罩住 +1/源；自己是光环源时落点罩住队友 +1/人
function auraCoverage(unit, dest, battle) {
  let count = 0;
  for (const ally of battle.units) {
    if (!ally.alive || ally.team !== unit.team) continue;
    for (const b of ally.buffs) {
      if (b.aura_radius > 0 && b.aura_mods) {
        if (ally === unit) {
          for (const other of battle.units) {
            if (other !== unit && other.alive && other.team === unit.team &&
                manhattan(other.coords, dest) <= b.aura_radius) count += 1;
          }
        } else if (manhattan(ally.coords, dest) <= b.aura_radius) {
          count += 1;
        }
      }
    }
  }
  return count;
}

function positionBonus(unit, target, dest, battle, C) {
  let bonus = 0;
  if (target) {
    const dirMod = DamageCalculator.directionModFrom(unit, target, dest);
    if (dirMod >= 0.2) bonus += C("ai_pos_backstab", 20);
    else if (dirMod >= 0.05) bonus += C("ai_pos_side", 10);
  }
  const cell = battle.grid.getCell(dest);
  if (cell && cell.height > 0) bonus += C("ai_pos_highground", 15);
  return bonus;
}

function classSpecial(unit, target, dest, est, battle, C, targetCount = 1) {
  switch (unit.data.unit_class) {
    case "vanguard": {
      let v = 0;
      for (const ally of alliesOf(unit, battle)) {
        if (ally !== unit && manhattan(ally.coords, dest) <= 1) v += C("ai_vanguard_cover", 10);
      }
      if (target && onCoverLine(unit, target, dest, battle)) v += C("ai_vanguard_cover_line", 25);
      return v;
    }
    case "infantry": {
      if (target && DamageCalculator.directionModFrom(unit, target, dest) >= 0.2) {
        return C("ai_infantry_backstab", 20);
      }
      return 0;
    }
    case "cavalry": {
      let v = manhattan(unit.coords, dest) * C("ai_cavalry_charge_per_cell", 3);
      if (target && est >= target.hp && hasRefreshOnKill(unit, battle)) {
        v += C("ai_cavalry_refresh_kill", 30);
      }
      return v;
    }
    case "archer": {
      let v = 0;
      for (const e of enemiesOf(unit, battle)) {
        if (manhattan(e.coords, dest) <= C("ai_archer_safe_dist", 3)) {
          v += C("ai_archer_danger_penalty", -40);
          break;
        }
      }
      const cell = battle.grid.getCell(dest);
      if (cell && cell.height > 0) v += C("ai_archer_highground", 20);
      return v;
    }
    case "strategist":
      return Math.max(0, targetCount - 1) * C("ai_strategist_aoe_per_extra", 15);
    default:
      return 0;
  }
}

function hasRefreshOnKill(unit, battle) {
  for (const type of ["active", "ult"]) {
    const skill = battle.data.getSkillForUnit(unit.unitId, type);
    if (skill && skill.effects.includes("refresh_on_kill")) return true;
  }
  return false;
}

// 落点是否在敌我连线格（共线且严格在线段内部）
function onCoverLine(unit, target, dest, battle) {
  for (const ally of alliesOf(unit, battle)) {
    if (ally === unit) continue;
    const a = ally.coords;
    const b = target.coords;
    if (a.x === b.x && dest.x === a.x) {
      const minY = Math.min(a.y, b.y);
      const maxY = Math.max(a.y, b.y);
      if (dest.y > minY && dest.y < maxY) return true;
    }
    if (a.y === b.y && dest.y === a.y) {
      const minX = Math.min(a.x, b.x);
      const maxX = Math.max(a.x, b.x);
      if (dest.x > minX && dest.x < maxX) return true;
    }
  }
  return false;
}

function pvpTemplateBonus(unit, dest, battle) {
  const mods = battle.pvpMods;
  if (!mods || !mods.template) return 0;
  if (mods.template === "steady" && mods.deployAnchor) {
    return -10 * manhattan(dest, mods.deployAnchor);
  }
  if (mods.template === "protect_core" && mods.core && mods.core !== unit) {
    return manhattan(dest, mods.core.coords) <= 2 ? 20 : 0;
  }
  return 0;
}

function scoreSkill(unit, skill, dest, battle, w, C) {
  const parsed = parseEffects(skill.effects);
  const dmgEffect = parsed.find((e) => e.name === "phys_dmg" || e.name === "mgc_dmg");
  const isDamage = !!dmgEffect && skill.target === "enemy";
  const healEffect = parsed.find((e) => e.name === "heal");
  const hasControl = parsed.some((e) => CONTROL_EFFECTS.includes(e.name));
  if (isDamage) {
    const mult = parseFloat(dmgEffect.args[0]);
    let aim = null;
    if (Targeting.needsAim(skill)) aim = bestAim(unit, skill, dest, battle);
    let targets = Targeting.resolveFrom(skill, unit, aim, battle.grid, battle.units, battle.rolls, dest);
    // friendly_fire：AI 评估时排除卷入的友军
    targets = targets.filter((u) => u.team !== unit.team);
    if (targets.length === 0) return null;
    let best = -Infinity;
    for (const target of targets) {
      let s = scoreAttack(unit, target, mult, dmgEffect.times, dest, battle, w, targets.length);
      if (hasControl && unit.data.unit_class === "strategist" &&
          targetValue(target, C) >= 30) {
        s += C("ai_strategist_control_high_value", 40);
      }
      if (s > best) best = s;
    }
    return { dest, kind: "skill", skill, score: best };
  }
  if (healEffect) {
    const mult = parseFloat(healEffect.args[0]);
    const amount = unit.getMgc() * mult;
    let score = 0;
    let anyInjured = false;
    for (const ally of alliesOf(unit, battle)) {
      const missing = ally.data.hp - ally.hp;
      if (missing <= 0) continue;
      // 只统计技能覆盖到的友军
      if (!Targeting.inArea(skill, dest, ally.coords, null)) continue;
      anyInjured = true;
      score += Math.min(amount, missing) * C("ai_heal_expect_factor", 1.2);
      if (ally.hp / ally.data.hp < C("ai_heal_urgent_threshold", 0.35)) {
        score += C("ai_heal_urgent_bonus", 60);
      }
      const over = amount - missing;
      if (over > 0) score -= over * C("ai_heal_overheal_factor", 0.3);
    }
    if (!anyInjured) score = -99999; // 无人受伤不放
    score += danger(unit, dest, battle, C) * w.danger;
    score += auraCoverage(unit, dest, battle) * C("ai_aura_coverage_factor", 10) * w.aura_coverage;
    return { dest, kind: "skill", skill, score };
  }
  // 增益/控制/功能型
  let targets = Targeting.resolveFrom(skill, unit, null, battle.grid, battle.units, battle.rolls, dest);
  if (skill.target === "enemy") targets = targets.filter((u) => u.team !== unit.team);
  let score;
  if (targets.length === 0) {
    score = -99999;
  } else {
    score = targets.length * C("ai_buff_target_base", 20);
    for (const target of targets) {
      if (skill.target === "enemy") {
        score += targetValue(target, C);
        if (hasControl && unit.data.unit_class === "strategist" && targetValue(target, C) >= 30) {
          score += C("ai_strategist_control_high_value", 40);
        }
      }
      if (target.buffs.some((b) => b.buff_id.startsWith("bond_")) &&
          (unit.data.unit_class === "support" || unit.data.unit_class === "healer")) {
        score += C("ai_support_buff_core", 25);
      }
    }
  }
  score += danger(unit, dest, battle, C) * w.danger;
  score += auraCoverage(unit, dest, battle) * C("ai_aura_coverage_factor", 10) * w.aura_coverage;
  return { dest, kind: "skill", skill, score };
}

function scoreWait(unit, dest, battle, w, C) {
  let nearest = Infinity;
  for (const e of enemiesOf(unit, battle)) {
    nearest = Math.min(nearest, manhattan(e.coords, dest));
  }
  if (nearest === Infinity) nearest = 0;
  return C("ai_wait_base", 5)
    + danger(unit, dest, battle, C) * w.danger
    + auraCoverage(unit, dest, battle) * C("ai_aura_coverage_factor", 10) * w.aura_coverage
    + positionBonus(unit, null, dest, battle, C) * w.position
    - nearest * C("ai_close_bonus", 2);
}

// —— 关卡目标候选（D38）——
function addObjectiveCandidates(unit, battle, dests, candidates, C) {
  const level = battle.level;
  if (!level) return;
  const wc = level.win_condition || {};
  const dangerFactor = C("ai_obj_danger_factor", 0.5);
  const objDanger = (dest) => danger(unit, dest, battle, C) * dangerFactor;
  // 夺取：我方单位趋向物件
  if (wc.type === "COLLECT" && unit.team !== Team.ENEMY && !unit.is_object) {
    const objects = battle.units.filter((u) => u.is_object && u.alive);
    if (objects.length > 0) {
      for (const dest of dests) {
        let dMin = Infinity;
        for (const obj of objects) dMin = Math.min(dMin, manhattan(dest, obj.coords));
        if (dMin === 1) {
          const obj = objects.find((o) => manhattan(dest, o.coords) === 1);
          candidates.push({
            dest, kind: "interact", target: obj,
            score: C("ai_collect_interact", 120) + objDanger(dest),
          });
        } else {
          candidates.push({
            dest, kind: "wait",
            score: C("ai_collect_approach_base", 100) - dMin * C("ai_collect_approach_cell_cost", 2) + objDanger(dest),
          });
        }
      }
    }
  }
  // 护送：被护送者趋向目标区
  if (wc.type === "ESCORT" && unit.unitId === wc.unit) {
    for (const dest of dests) {
      let dMin = Infinity;
      const [zx, zy, zw, zh] = wc.zone;
      for (let y = zy; y < zy + zh; y++) {
        for (let x = zx; x < zx + zw; x++) {
          dMin = Math.min(dMin, manhattan(dest, { x, y }));
        }
      }
      candidates.push({
        dest, kind: "wait",
        score: C("ai_escort_base", 250) - dMin * C("ai_escort_cell_cost", 3) + objDanger(dest),
      });
    }
  }
  // 蒙汗药酒路线：act_yaojiu 持有者趋向酒摊
  const signature = battle.data.getSkillForUnit(unit.unitId, "active");
  if (signature && signature.skill_id === "act_yaojiu") {
    const stalls = [];
    for (const cell of battle.grid.cells.values()) {
      if (cell.terrain.terrain_id === "wine_stall" && !cell.occupant) stalls.push(cell.coords);
    }
    if (stalls.length > 0) {
      for (const dest of dests) {
        let dMin = Infinity;
        for (const s of stalls) dMin = Math.min(dMin, manhattan(dest, s));
        const score = dMin === 0
          ? C("ai_wine_stall_arrive", 150)
          : C("ai_wine_stall_approach_base", 140) - dMin * C("ai_wine_stall_cell_cost", 2);
        candidates.push({ dest, kind: "wait", score: score + objDanger(dest) });
      }
    }
  }
}

// —— 半自动绝技门（表 16）——
function ultAllowed(unit, skill, targets, battle, C) {
  const cls = unit.data.unit_class;
  switch (cls) {
    case "vanguard": {
      if (unit.hp / unit.data.hp < C("ai_ult_vanguard_hp", 0.4)) return true;
      let near = 0;
      for (const e of enemiesOf(unit, battle)) {
        if (manhattan(e.coords, unit.coords) <= 2) near++;
      }
      return near >= C("ai_ult_vanguard_near", 3);
    }
    case "infantry": case "cavalry": {
      const mult = firstDmgMult(skill);
      for (const t of targets) {
        const est = DamageCalculator.estimateAt(unit, t, mult, battle.grid, unit.coords);
        if (est >= t.hp) return true;
      }
      return targets.length >= C("ai_ult_dps_min_targets", 2);
    }
    case "archer": {
      const mult = firstDmgMult(skill);
      for (const t of targets) {
        const est = DamageCalculator.estimateAt(unit, t, mult, battle.grid, unit.coords);
        if (est >= t.hp) return true;
        if (t.rage >= 100) return true;
      }
      return false;
    }
    case "strategist":
      return targets.length >= C("ai_ult_strategist_min_targets", 3);
    case "healer": {
      const allies = alliesOf(unit, battle);
      if (allies.some((a) => a.hp / a.data.hp < C("ai_ult_healer_urgent_hp", 0.35))) return true;
      const avg = allies.reduce((s, a) => s + a.hp / a.data.hp, 0) / Math.max(1, allies.length);
      return avg < C("ai_ult_healer_avg_hp", 0.6);
    }
    case "support":
      return targets.length >= C("ai_ult_support_min_targets", 4);
    default:
      return true;
  }
}

function firstDmgMult(skill) {
  const e = parseEffects(skill.effects).find((x) => x.name === "phys_dmg" || x.name === "mgc_dmg");
  return e ? parseFloat(e.args[0]) : 1.0;
}
