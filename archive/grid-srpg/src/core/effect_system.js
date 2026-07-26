// 技能/效果系统（对应 Godot 版 effect_system.gd，全 static 纯函数）
// 效果串语法："phys_dmg(0.9)x4;rage(+20)" → [{name, args[], times}]
// 数值惯例：CSV 中 0.3 = 30%（_percentValue = round(x×100)）
import { DIRS, manhattan, dominantDir } from "./coords.js";
import { Team, Unit } from "./unit.js";
import { makeBuff } from "./buff.js";
import * as DamageCalculator from "./damage_calculator.js";

export const DOT_PERCENT = 5;
export const HIGH_DEF_THRESHOLD = 100;
export const SUMMON_HP = 300;

// 修正类效果：不进序列执行，前置扫描进 mods（refresh_on_kill / extra_action 由 SkillCommand 后处理，不进 mods）
const MODIFIER_EFFECTS = new Set([
  "sure_hit", "hit_rate", "chance", "bonus_by_self_lost_hp", "bonus_vs_elite",
  "bonus_vs_high_def", "bonus_vs_cavalry", "execute_below", "target_rule",
  "random_target", "friendly_fire", "refresh_on_kill", "extra_action",
]);

export const KNOWN_EFFECTS = new Set([
  ...MODIFIER_EFFECTS,
  "phys_dmg", "mgc_dmg", "heal", "rage",
  "pull", "push", "pull_to_front", "swap_position", "teleport",
  "stun", "sleep", "sleep_chance", "paralyze", "bind", "guard", "counter",
  "buff", "def_up", "dodge_up", "block_up", "armor_break", "debuff_mgc", "move_mod",
  "random_buff", "steal_buff", "dispel",
  "poison", "burn", "bleed",
  "summon", "aura", "av_mod",
]);

const CONTROL_DEBUFFS = new Set(["stun", "sleep", "paralyze", "bind"]);

export function parseEffects(str) {
  const out = [];
  if (!str) return out;
  for (const part of String(str).split(";")) {
    const s = part.trim();
    if (s === "") continue;
    const m = s.match(/^([a-zA-Z_][a-zA-Z0-9_]*)(?:\((.*)\))?(?:\s*x(\d+))?$/);
    if (!m) throw new Error(`效果解析失败: "${s}"（完整串: "${str}"）`);
    const name = m[1];
    const args = m[2] !== undefined ? m[2].split(",").map((a) => a.trim()) : [];
    const times = m[3] ? parseInt(m[3], 10) : 1;
    out.push({ name, args, times });
  }
  return out;
}

export function scanModifiers(parsed) {
  const mods = {};
  for (const e of parsed) {
    switch (e.name) {
      case "sure_hit": mods.sure_hit = true; break;
      case "hit_rate": mods.hit_rate = parseFloat(e.args[0]); break;
      case "chance": mods.chance = parseFloat(e.args[0]); break;
      case "bonus_by_self_lost_hp": mods.bonus_by_self_lost_hp = parseFloat(e.args[0]); break;
      case "bonus_vs_elite": mods.bonus_vs_elite = parseFloat(e.args[0]); break;
      case "bonus_vs_high_def": mods.bonus_vs_high_def = parseFloat(e.args[0]); break;
      case "bonus_vs_cavalry": mods.bonus_vs_cavalry = parseFloat(e.args[0]); break;
      case "execute_below": mods.execute_below = parseFloat(e.args[0]); break;
      case "target_rule": mods.target_rule = e.args[0]; break;
      case "random_target": mods.random_target = parseInt(e.args[0], 10); break;
      case "friendly_fire": mods.friendly_fire = parseFloat(e.args[0]); break;
      default: break; // refresh_on_kill / extra_action 不进 mods
    }
  }
  return mods;
}

function percentValue(x) {
  return Math.round(parseFloat(x) * 100);
}

function intValue(x) {
  return parseInt(x, 10) || 0;
}

// 主入口：execute(skill, ctx) -> events[]
// ctx = {actor, target, grid, rolls, mods={}, depth=0, summoned=null, battle=null, effectMult=1.0}
export function execute(skill, ctx) {
  const parsed = parseEffects(skill.effects);
  const mods = Object.assign({}, ctx.mods, scanModifiers(parsed));
  ctx.mods = mods;
  skill._mods = mods; // 供 Targeting 后置修正读取
  // hit_rate(p)：整技能对该目标 miss（逐目标判定）
  if (mods.hit_rate !== undefined && ctx.rolls.roll() >= mods.hit_rate * 100) {
    return [{ type: "miss", source: ctx.actor, target: ctx.target, skill: skill.skill_id }];
  }
  // chance(p)：整串不触发（无事件）
  if (mods.chance !== undefined && ctx.rolls.roll() >= mods.chance * 100) {
    return [];
  }
  const events = [];
  for (const e of parsed) {
    if (MODIFIER_EFFECTS.has(e.name)) continue;
    if (!KNOWN_EFFECTS.has(e.name)) {
      throw new Error(`未实现效果 "${e.name}"（技能 ${skill.skill_id}）`);
    }
    for (let i = 0; i < e.times; i++) {
      applyEffect(e.name, e.args, skill, ctx, events);
    }
  }
  return events;
}

function constant(ctx, key, def) {
  return ctx.battle && ctx.battle.data ? ctx.battle.data.getConstant(key, def) : def;
}

function notifyDeath(ctx, unit) {
  if (ctx.battle && typeof ctx.battle._onUnitDied === "function") {
    ctx.battle._onUnitDied(unit);
  }
}

function applyEffect(name, args, skill, ctx, events) {
  switch (name) {
    case "phys_dmg": return physDmg(parseFloat(args[0]), skill, ctx, events, false);
    case "mgc_dmg": return physDmg(parseFloat(args[0]), skill, ctx, events, true);
    case "heal": {
      const amount = Math.round(ctx.actor.getMgc() * parseFloat(args[0]) * ctx.effectMult);
      const healed = ctx.target.heal(amount);
      events.push({ type: "heal", source: ctx.actor, target: ctx.target, skill: skill.skill_id, amount: healed });
      return;
    }
    case "rage": {
      const v = intValue(args[0]);
      ctx.actor.gainRage(v);
      events.push({ type: "rage", unit: ctx.actor, value: v });
      return;
    }
    case "pull": return pullPush(intValue(args[0]), skill, ctx, events, true);
    case "push": return pullPush(intValue(args[0]), skill, ctx, events, false);
    case "pull_to_front": {
      const { actor, target, grid } = ctx;
      const cells = [];
      while (manhattan(actor.coords, target.coords) > 1) {
        const dir = dominantDir({ x: actor.coords.x - target.coords.x, y: actor.coords.y - target.coords.y });
        const next = { x: target.coords.x + dir.x, y: target.coords.y + dir.y };
        if (!grid.canStop(next, target)) break;
        grid.moveUnit(target, next);
        cells.push(next);
      }
      if (cells.length > 0) events.push({ type: "pull", target, cells, to: target.coords });
      return;
    }
    case "swap_position": {
      const { actor, target, grid } = ctx;
      const a = { ...actor.coords };
      const b = { ...target.coords };
      grid.getCell(a).occupant = null;
      grid.getCell(b).occupant = null;
      grid.placeUnit(actor, b);
      grid.placeUnit(target, a);
      events.push({ type: "swap", source: actor, target });
      return;
    }
    case "teleport": return teleport(intValue(args[0]), skill, ctx, events);
    case "stun": case "sleep": case "paralyze": case "bind": case "guard": case "counter":
      return applyStatus(ctx.target, name, intValue(args[0]), skill, ctx, events);
    case "sleep_chance": {
      const p = parseFloat(args[0]);
      const n = intValue(args[1]);
      if (ctx.rolls.roll() < p * 100) {
        applyStatus(ctx.target, "sleep", n, skill, ctx, events);
      } else {
        events.push({ type: "status_resist", target: ctx.target, status: "sleep" });
      }
      return;
    }
    case "buff": return applyStatBuff(ctx.target, skill, args[0], percentValue(args[1]), intValue(args[2]), false, events);
    case "def_up": return applyStatBuff(ctx.target, skill, "def", percentValue(args[0]), intValue(args[1]), false, events);
    case "dodge_up": return applyStatBuff(ctx.target, skill, "dodge", percentValue(args[0]), intValue(args[1]), false, events);
    case "block_up": return applyStatBuff(ctx.target, skill, "block", percentValue(args[0]), intValue(args[1]), false, events);
    case "armor_break": {
      const val = percentValue(args[0]);
      const dur = intValue(args[1]);
      applyStatBuff(ctx.target, skill, "def", -val, dur, true, events);
      // 专属武器溅射：signature_morph {effect:"armor_break", splash_radius}
      const morph = ctx.mods.signature_morph;
      if (morph && morph.effect === "armor_break") {
        const radius = morph.splash_radius || 0;
        for (const u of ctx.grid.unitsRef || []) {
          if (u === ctx.target || !u.alive || u.collectable) continue;
          if ((u.team === Team.ENEMY) === (ctx.actor.team === Team.ENEMY)) continue;
          if (manhattan(u.coords, ctx.target.coords) > radius) continue;
          applyStatBuff(u, skill, "def", -val, dur, true, events, true);
        }
      }
      return;
    }
    case "debuff_mgc": return applyStatBuff(ctx.target, skill, "mgc", -percentValue(args[0]), intValue(args[1]), true, events);
    case "move_mod": {
      const v = intValue(args[0]);
      return applyStatBuff(ctx.target, skill, "move", v, intValue(args[1]), v < 0, events);
    }
    case "random_buff": {
      // random_buff(def_up,0.4,2|counter,1)：| 分隔分支，roll 均匀选一
      const raw = args.join(",");
      const branches = raw.split("|").map((b) => {
        const parts = b.split(",").map((s) => s.trim());
        return { name: parts[0], args: parts.slice(1) };
      });
      const idx = Math.floor(Math.min(Math.max(ctx.rolls.roll() / 100, 0), 0.9999) * branches.length);
      const branch = branches[idx];
      return applyEffect(branch.name, branch.args, skill, ctx, events);
    }
    case "steal_buff": {
      const n = intValue(args[0]);
      let victim = ctx.target;
      if (skill.target === "self") {
        victim = nearestEnemy(ctx.actor, ctx.grid.unitsRef || []);
        if (!victim) return;
      }
      const stolen = [];
      for (const b of [...victim.buffs]) {
        if (stolen.length >= n) break;
        if (b.is_debuff || !b.dispellable) continue;
        victim.removeBuff(b.buff_id);
        ctx.actor.addBuff({ ...b, source: ctx.actor });
        stolen.push(b.buff_id);
      }
      if (stolen.length > 0) events.push({ type: "steal", from: victim, count: stolen.length, stolen });
      return;
    }
    case "dispel": {
      const removed = ctx.target.dispelDebuffs(intValue(args[0]));
      events.push({ type: "dispel", target: ctx.target, removed });
      return;
    }
    case "poison": case "burn": case "bleed": {
      const n = intValue(args[0]);
      ctx.target.addBuff(makeBuff({
        buff_id: name, name, duration: n, is_debuff: true,
        tick_effect: { kind: "dot", percent: DOT_PERCENT },
      }));
      events.push({ type: "buff", target: ctx.target, buff: name, field: null, value: 0, duration: n });
      return;
    }
    case "summon": return summon(args[0], skill, ctx, events);
    case "aura": {
      const auraMods = {};
      let radius = 0;
      for (const a of args) {
        const m = a.match(/^([a-z]+)\+(-?[\d.]+)$/);
        if (m) auraMods[m[1]] = percentValue(m[2]);
        else if (/^r\d+$/.test(a)) radius = parseInt(a.slice(1), 10);
      }
      const holder = ctx.summoned || ctx.actor;
      holder.addBuff(makeBuff({
        buff_id: `aura_${skill.skill_id}`, name: skill.name, duration: 99,
        dispellable: false, aura_mods: auraMods, aura_radius: radius,
      }));
      events.push({ type: "aura", holder, radius, mods: auraMods });
      return;
    }
    case "av_mod": {
      const v = parseFloat(args[0]);
      ctx.target.av *= 1 + v;
      events.push({ type: "av_mod", target, value: v });
      return;
    }
    default:
      throw new Error(`未实现效果 "${name}"（技能 ${skill.skill_id}）`);
  }
}

// 物理/谋略伤害结算链
function physDmg(mult, skill, ctx, events, isMagic) {
  const { actor, grid, rolls, mods } = ctx;
  let target = ctx.target;
  // 1. guard 援护：仅 depth==0、目标非施法者、远程（曼哈顿>1）
  if (ctx.depth === 0 && target !== actor && manhattan(actor.coords, target.coords) > 1) {
    for (const d of DIRS) {
      const c = { x: target.coords.x + d.x, y: target.coords.y + d.y };
      const cell = grid.getCell(c);
      const u = cell ? cell.occupant : null;
      if (u && u.alive && u.team === target.team && u.hasStatus("guard")) {
        target = u;
        break;
      }
    }
  }
  // 2. execute_below(v)：目标血比 ≤ v 直接扣光
  if (mods.execute_below !== undefined && target.hp / target.data.hp <= mods.execute_below) {
    const td = target.takeDamage(target.hp);
    events.push({
      type: "damage", source: actor, target, skill: skill.skill_id,
      amount: td.applied, crit: false, blocked: false, dirMod: 0, heightMod: 0,
      died: td.died, executed: true,
    });
    if (td.interrupted) events.push({ type: "channel_interrupted", unit: target });
    if (td.died) notifyDeath(ctx, target);
    return;
  }
  // 3. 倍率修正
  let m = mult * ctx.effectMult;
  if (mods.bonus_by_self_lost_hp !== undefined) {
    m *= 1 + mods.bonus_by_self_lost_hp * (1 - actor.hp / actor.data.hp);
  }
  if (mods.bonus_vs_elite !== undefined && target.is_elite) m *= 1 + mods.bonus_vs_elite;
  if (mods.bonus_vs_high_def !== undefined && target.getDef(grid) >= HIGH_DEF_THRESHOLD) m *= 1 + mods.bonus_vs_high_def;
  if (mods.bonus_vs_cavalry !== undefined && target.data.unit_class === "cavalry") m *= 1 + mods.bonus_vs_cavalry;
  // 4. 伤害公式
  const result = DamageCalculator.compute(actor, target, m, grid, rolls, !!mods.sure_hit, isMagic ? actor.getMgc() : -1);
  if (result.dodged) {
    events.push({ type: "dodge", source: actor, target, skill: skill.skill_id });
    return;
  }
  const td = target.takeDamage(result.amount);
  // 5. 怒气（被动伤害不产怒气，D41）
  if (!mods.passive) {
    target.gainRage(constant(ctx, "rage_on_hit_taken", 10));
    if (td.died) actor.gainRage(constant(ctx, "rage_on_kill", 30));
  }
  events.push({
    type: "damage", source: actor, target, skill: skill.skill_id,
    amount: td.applied, crit: result.crit, blocked: result.blocked,
    dirMod: result.dirMod, heightMod: result.heightMod, died: td.died,
  });
  if (td.interrupted) events.push({ type: "channel_interrupted", unit: target });
  if (td.died) {
    notifyDeath(ctx, target);
    return; // 目标已死，不反击
  }
  // 7. counter 反击：目标带 counter、depth==0、攻方在目标武器射程内
  if (ctx.depth === 0 && target.hasStatus("counter")) {
    let inRange;
    if (ctx.battle && typeof ctx.battle.inAttackRange === "function") {
      inRange = ctx.battle.inAttackRange(target, actor);
    } else {
      const d = manhattan(target.coords, actor.coords);
      inRange = d >= target.data.range_min && d <= target.data.range_max;
    }
    if (inRange) {
      const counterCtx = { ...ctx, actor: target, target: actor, depth: 1 };
      physDmg(1.0, skill, counterCtx, events, false);
    }
  }
}

function pullPush(n, skill, ctx, events, isPull) {
  const { actor, target, grid } = ctx;
  const cells = [];
  for (let i = 0; i < n; i++) {
    const diff = { x: actor.coords.x - target.coords.x, y: actor.coords.y - target.coords.y };
    let dir = dominantDir(diff);
    if (!isPull) dir = { x: -dir.x, y: -dir.y };
    const next = { x: target.coords.x + dir.x, y: target.coords.y + dir.y };
    if (!grid.canStop(next, target)) break;
    grid.moveUnit(target, next);
    cells.push(next);
  }
  if (cells.length > 0) {
    events.push({ type: isPull ? "pull" : "push", target, cells, to: target.coords });
  }
}

function teleport(n, skill, ctx, events) {
  const { actor, grid } = ctx;
  const enemy = nearestEnemy(actor, grid.unitsRef || []);
  if (!enemy) return;
  let best = null;
  let bestDist = Infinity;
  for (let y = 0; y < grid.size.y; y++) {
    for (let x = 0; x < grid.size.x; x++) {
      const c = { x, y };
      if (manhattan(actor.coords, c) > n) continue;
      if (!grid.canStop(c, actor)) continue;
      const d = manhattan(c, enemy.coords);
      if (d < bestDist) {
        bestDist = d;
        best = c;
      }
    }
  }
  if (!best) return;
  const from = { ...actor.coords };
  grid.moveUnit(actor, best);
  events.push({ type: "teleport", unit: actor, from, to: best });
}

function nearestEnemy(actor, units) {
  let best = null;
  let bestDist = Infinity;
  for (const u of units) {
    if (!u.alive || u === actor) continue;
    if ((u.team === Team.ENEMY) === (actor.team === Team.ENEMY)) continue;
    const d = manhattan(actor.coords, u.coords);
    if (d < bestDist) { bestDist = d; best = u; }
  }
  return best;
}

function applyStatus(target, status, duration, skill, ctx, events) {
  let dur = duration;
  // 警觉特性：首次睡眠时长压到 min(n,1)
  if (status === "sleep" && target.data.traits.includes("alert") && !target.alert_triggered) {
    dur = Math.min(dur, 1);
    target.alert_triggered = true;
  }
  target.addBuff(makeBuff({
    buff_id: status, name: skill.name, duration: dur, status,
    is_debuff: CONTROL_DEBUFFS.has(status),
  }));
  events.push({ type: "status", target, status, duration: dur });
}

function applyStatBuff(target, skill, field, value, duration, isDebuff, events, splash = false) {
  const buffId = `${skill.skill_id}_${field}`;
  target.addBuff(makeBuff({
    buff_id: buffId, name: skill.name, duration,
    stat_mods: { [field]: value }, is_debuff: isDebuff,
  }));
  events.push({ type: "buff", target, buff: buffId, field, value, duration, splash });
}

function summon(objectId, skill, ctx, events) {
  const { actor, grid } = ctx;
  let cell = null;
  for (const d of DIRS) {
    const c = { x: actor.coords.x + d.x, y: actor.coords.y + d.y };
    if (grid.canStop(c, actor)) { cell = c; break; }
  }
  if (!cell) {
    events.push({ type: "summon", object: null, cell: null, ok: false });
    return;
  }
  let data = ctx.battle && ctx.battle.data ? ctx.battle.data.getUnit(objectId) : null;
  if (!data) {
    data = {
      unit_id: objectId, name: objectId, nickname: "", star: "", quality: "green",
      unit_class: "support", hp: SUMMON_HP, atk: 0, def: 0, mgc: 0, spd: 1,
      crit: 0, dodge: 0, block: 0, move: 0, range_min: 1, range_max: 1,
      weapon: "", skill_signature: "", bonds: [], unlock: "", traits: [],
    };
  }
  const unit = new Unit(data, actor.team, cell);
  unit.is_object = true;
  unit.collectable = true;
  unit.hp = SUMMON_HP;
  grid.placeUnit(unit, cell);
  if (ctx.battle) ctx.battle.units.push(unit);
  ctx.summoned = unit;
  events.push({ type: "summon", object: unit, cell, ok: true });
}
