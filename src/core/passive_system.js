// 被动触发系统（对应 Godot 版 passive_system.gd，D41）
// on_attack：行动者自身被动，涉事对方 = 首个被命中目标（优先存活者）
// on_hit：每个存活被命中目标的被动，涉事对方 = 攻击者
// turn_start：无涉事对方（target=enemy 的此类被动被数据校验拦截）
// 被动伤害不再触发反击/连锁被动（depth=1），不产怒气（mods.passive，D41）
import * as EffectSystem from "./effect_system.js";

export function afterCommand(battle, cmd, events) {
  const out = [];
  const isAttack = cmd.constructor.name === "AttackCommand";
  const isSkill = cmd.constructor.name === "SkillCommand";
  if (!isAttack && !isSkill) return out; // 道具不触发
  // 只统计本指令 source 伤害事件的目标（反击/被动伤害不回流触发），去重
  const hitTargets = [];
  for (const e of events) {
    if (e.type === "damage" && e.source === cmd.actor && e.target && !hitTargets.includes(e.target)) {
      hitTargets.push(e.target);
    }
  }
  if (hitTargets.length === 0) return out;
  // on_attack：行动者自身被动；涉事对方 = 首个被命中目标（优先存活者）
  const firstAlive = hitTargets.find((u) => u.alive) || hitTargets[0];
  for (const skill of battle.data.getPassivesForUnit(cmd.actor.unitId, "on_attack")) {
    fire(battle, cmd.actor, skill, firstAlive, "on_attack", out);
  }
  // on_hit：每个存活被命中目标的被动；涉事对方 = 攻击者
  for (const target of hitTargets) {
    if (!target.alive) continue;
    for (const skill of battle.data.getPassivesForUnit(target.unitId, "on_hit")) {
      fire(battle, target, skill, cmd.actor, "on_hit", out);
    }
  }
  return out;
}

export function atTurnStart(battle, unit) {
  const out = [];
  for (const skill of battle.data.getPassivesForUnit(unit.unitId, "turn_start")) {
    fire(battle, unit, skill, null, "turn_start", out);
  }
  return out;
}

function fire(battle, holder, skill, other, trigger, out) {
  let target;
  if (skill.target === "self") target = holder;
  else if (skill.target === "enemy") {
    if (!other || !other.alive) return;
    target = other;
  } else return;
  const effectMult = passiveEffectMult(battle.data, holder, skill);
  const ctx = {
    actor: holder, target, grid: battle.grid, rolls: battle.rolls,
    mods: { passive: true }, depth: 1, summoned: null, battle, effectMult,
  };
  const events = EffectSystem.execute(skill, ctx);
  if (events.length > 0) {
    out.push({
      type: "passive_trigger", unit: holder, skill: skill.skill_id,
      name: skill.name, trigger,
    });
    out.push(...events);
  }
}

function passiveEffectMult(data, holder, skill) {
  if (!holder.hero) return 1.0;
  const level = holder.hero.skill_levels[skill.skill_id] || 1;
  return 1 + data.getProgression("skill_level_mult", 0.05) * (level - 1);
}
