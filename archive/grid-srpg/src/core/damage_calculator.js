// 伤害计算（对应 Godot 版 damage_calculator.gd，全部 static 纯函数）
import { dominantDir } from "./coords.js";

export const CRIT_MULT = 1.5;
export const BLOCK_REDUCE = 0.3;
export const BACKSTAB_MOD = 0.25;
export const SIDE_MOD = 0.10;
export const HIGH_GROUND_MOD = 0.15;
export const LOW_GROUND_MOD = -0.10;

// 方位修正：攻击方向 == 目标朝向 → 背刺 +0.25；相反 → 正面 +0；其余 → 侧击 +0.10
export function directionModFrom(attacker, target, from) {
  const diff = { x: target.coords.x - from.x, y: target.coords.y - from.y };
  const dir = dominantDir(diff);
  if (dir.x === target.facing.x && dir.y === target.facing.y) return BACKSTAB_MOD;
  if (dir.x === -target.facing.x && dir.y === -target.facing.y) return 0;
  return SIDE_MOD;
}

export function directionMod(attacker, target) {
  return directionModFrom(attacker, target, attacker.coords);
}

// 高低差：攻击格 height > 目标格 → +0.15；< → -0.10；相等 0
export function heightMod(grid, from, targetCoords) {
  const a = grid.getCell(from);
  const b = grid.getCell(targetCoords);
  const ha = a ? a.height : 0;
  const hb = b ? b.height : 0;
  if (ha > hb) return HIGH_GROUND_MOD;
  if (ha < hb) return LOW_GROUND_MOD;
  return 0;
}

// 主入口：compute(attacker, target, multiplier, grid, rolls, sureHit=false, attackValue=-1)
// 返回 {hit, dodged, blocked, crit, amount, dirMod, heightMod}
export function compute(attacker, target, multiplier, grid, rolls, sureHit = false, attackValue = -1) {
  // 1. 闪避（完全免伤）
  if (!sureHit && rolls.roll() < target.getDodge(grid)) {
    return { hit: false, dodged: true, blocked: false, crit: false, amount: 0, dirMod: 0, heightMod: 0 };
  }
  const dirMod = directionMod(attacker, target);
  const hMod = heightMod(grid, attacker.coords, target.coords);
  // 攻击值：attackValue < 0 用攻击者 atk（mgc_dmg 传入 getMgc()，但仍用目标 def 结算——原作如此）
  const atkValue = attackValue < 0 ? attacker.getAtk(grid) : attackValue;
  // 基础伤害
  const base = (atkValue * multiplier * 100) / (100 + target.getDef(grid));
  // 方位/高低差：相加不叠乘（D6）
  let amount = base * (1 + dirMod + hMod);
  // 暴击
  let crit = false;
  if (rolls.roll() < attacker.getCrit()) {
    amount *= CRIT_MULT;
    crit = true;
  }
  // 格挡（与暴击可同时发生）
  let blocked = false;
  if (rolls.roll() < target.getBlock()) {
    amount *= 1 - BLOCK_REDUCE;
    blocked = true;
  }
  amount = Math.max(1, Math.round(amount));
  return { hit: true, dodged: false, blocked, crit, amount, dirMod, heightMod: hMod };
}

// AI 期望值（不掷骰）；from 只影响方位/高低差
export function estimateAt(attacker, target, multiplier, grid, from) {
  const dirMod = directionModFrom(attacker, target, from);
  const hMod = heightMod(grid, from, target.coords);
  const base = (attacker.getAtk(grid) * multiplier * 100) / (100 + target.getDef(grid));
  let est = base * (1 + dirMod + hMod);
  est *= 1 + (attacker.getCrit() / 100) * (CRIT_MULT - 1);
  est *= Math.min(1.0, Math.max(0.05, 1 - target.getDodge(grid) / 100));
  return est;
}
