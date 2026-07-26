// 指令管道（对应 Godot 版 command.gd 及各子类）
// 玩家输入与 AI 都生成 Command，经 BattleManager.submitCommand() 执行；逻辑瞬时结算，事件供表现层回放。
import { dominantDir } from "./coords.js";
import * as EffectSystem from "./effect_system.js";
import * as Targeting from "./targeting.js";
import { itemToSkillData } from "./data_loader.js";

export class Command {
  constructor(actor) {
    this.actor = actor;
  }
  execute(battle) { return []; }
}

// 移动：path 含起点之后的逐格路径（findPath 结果去掉首格）
export class MoveCommand extends Command {
  constructor(actor, path) {
    super(actor);
    this.path = path;
  }
  execute(battle) {
    if (this.path.length === 0) return [];
    const grid = battle.grid;
    const dest = this.path[this.path.length - 1];
    if (!grid.canStop(dest, this.actor)) return [];
    // 路径消耗 = 每格进入消耗求和
    let cost = 0;
    for (const coords of this.path) {
      cost += grid.moveCostOf(grid.getCell(coords), this.actor);
    }
    // 仅当前激活单位且在激活窗口内校验扣减；窗口外脚本化移动不校验
    const isActivation = battle.activationLive && battle.activeUnit === this.actor;
    if (isActivation) {
      if (cost > battle.movePointsLeft) return [];
      battle.movePointsLeft -= cost;
      battle.moveUsed = true;
    }
    const from = { ...this.actor.coords };
    grid.moveUnit(this.actor, dest);
    // 朝向 = 最后一步方向
    const lastStep = { x: dest.x - from.x, y: dest.y - from.y };
    if (lastStep.x !== 0 || lastStep.y !== 0) this.actor.facing = dominantDir(lastStep);
    return [{ type: "move", unit: this.actor, from, path: this.path }];
  }
}

// 普攻：target 为敌人；targetCell 非空 = 打可破坏障碍
export class AttackCommand extends Command {
  constructor(actor, target, skill, targetCell = null) {
    super(actor);
    this.target = target;
    this.skill = skill;
    this.targetCell = targetCell;
  }
  execute(battle) {
    const grid = battle.grid;
    // 打障碍：伤害 = max(1, 攻击力)，无防/闪/格/暴（D44）
    if (this.targetCell) {
      const cell = grid.getCell(this.targetCell);
      if (!cell || !cell.hasObstacle()) return [];
      const amount = Math.max(1, this.actor.getAtk(grid));
      cell.obstacle_hp -= amount;
      const events = [{
        type: "obstacle_damage", unit: this.actor, coords: this.targetCell,
        amount, remaining: Math.max(0, cell.obstacle_hp),
      }];
      if (cell.obstacle_hp <= 0) {
        const fromTerrain = cell.terrain.terrain_id;
        grid.setTerrain(this.targetCell, "plain");
        events.push({ type: "terrain_change", coords: this.targetCell, from: fromTerrain, to: "plain" });
      }
      this._faceTarget(this.targetCell);
      return events;
    }
    if (!this.target || !this.target.alive) return [];
    this._faceTarget(this.target.coords);
    const ctx = {
      actor: this.actor, target: this.target, grid, rolls: battle.rolls,
      mods: {}, depth: 0, summoned: null, battle, effectMult: 1.0,
    };
    return EffectSystem.execute(this.skill, ctx);
  }
  _faceTarget(coords) {
    const diff = { x: coords.x - this.actor.coords.x, y: coords.y - this.actor.coords.y };
    if (diff.x !== 0 || diff.y !== 0) this.actor.facing = dominantDir(diff);
  }
}

// 技能：Q 主动技 / W 绝技；aim 为 line 技能指向格
export class SkillCommand extends Command {
  constructor(actor, skill, aim = null) {
    super(actor);
    this.skill = skill;
    this.aim = aim;
  }
  execute(battle) {
    const skill = this.skill;
    if (!battle.canUseSkill(this.actor, skill)) return [];
    // 修正前置扫描需先挂到 skill._mods 供 Targeting 读取
    const parsed = EffectSystem.parseEffects(skill.effects);
    skill._mods = EffectSystem.scanModifiers(parsed);
    const targets = Targeting.resolveFrom(skill, this.actor, this.aim, battle.grid, battle.units, battle.rolls);
    if (targets.length === 0) return [];
    // 先扣怒气（D25：目标解析后、结算前扣）
    this.actor.gainRage(-skill.rage_cost);
    // 施放技能回怒（与效果串自带 rage() 不重复计，D43）
    this.actor.gainRage(battle.data.getConstant("rage_on_skill", 10));
    const effectMult = skillEffectMult(battle.data, this.actor, skill);
    const events = [];
    let killedAny = false;
    for (const target of targets) {
      const ctx = {
        actor: this.actor, target, grid: battle.grid, rolls: battle.rolls,
        mods: battle.signatureMorphFor ? battle.signatureMorphFor(this.actor, skill.skill_id) : {},
        depth: 0, summoned: null, battle, effectMult,
      };
      const subEvents = EffectSystem.execute(skill, ctx);
      events.push(...subEvents);
      for (const e of subEvents) {
        if (e.type === "damage" && e.died) killedAny = true;
      }
    }
    // 后处理：refresh_on_kill 击杀任意 → 再动
    const effectNames = parsed.map((e) => e.name);
    if (effectNames.includes("refresh_on_kill") && killedAny) {
      this.actor.extra_action_pending = true;
    }
    // extra_action(n)：目标中同队存活友军按 av 升序前 n 名 av=0
    const extra = parsed.find((e) => e.name === "extra_action");
    if (extra) {
      const n = parseInt(extra.args[0], 10) || 1;
      const allies = targets
        .filter((u) => u.alive && u.team === this.actor.team)
        .sort((a, b) => a.av - b.av)
        .slice(0, n);
      for (const u of allies) {
        u.av = 0;
        events.push({ type: "extra_action", target: u });
      }
    }
    this.actor.setCooldown(skill);
    return events;
  }
}

// 待机：+rage_on_wait(15)；挂 wait_def（def +20%，1 回合，不可驱散）
export class WaitCommand extends Command {
  execute(battle) {
    this.actor.gainRage(battle.data.getConstant("rage_on_wait", 15));
    this.actor.addBuff({
      buff_id: "wait_def", name: "待机防御", stat_mods: { def: 20 },
      duration: 1, stacks: 1, dispellable: false, is_debuff: false,
      tick_effect: null, status: "", aura_mods: null, aura_radius: 0, source: this.actor,
    });
    return [
      { type: "wait", unit: this.actor },
      { type: "rage", unit: this.actor, value: battle.data.getConstant("rage_on_wait", 15) },
    ];
  }
}

// 夺取：对相邻（恰好距离 1）场景物件开始引导；下次自己回合开始收讫；受击打断
export class InteractCommand extends Command {
  constructor(actor, target) {
    super(actor);
    this.target = target;
  }
  execute(battle) {
    if (!battle.canChannel(this.actor, this.target)) return [];
    this.actor.channeling = this.target;
    return [{ type: "channel_start", unit: this.actor, object: this.target }];
  }
}

// 道具：借道技能结算（D48）；内部自置 action_used；不触发攻击类被动
export class ItemCommand extends Command {
  constructor(actor, item, targetUnit = null, aim = null) {
    super(actor);
    this.item = item;
    this.targetUnit = targetUnit;
    this.aim = aim;
  }
  execute(battle) {
    if (!battle.canUseItem(this.actor)) return [];
    const left = battle.itemUsesLeft(this.item.item_id);
    if (left <= 0) return [];
    const skill = itemToSkillData(this.item);
    skill._mods = {};
    let targets = Targeting.resolveFrom(skill, this.actor, this.aim, battle.grid, battle.units, battle.rolls);
    if (this.targetUnit) {
      // 指定目标时必须在合法列表内且只对其生效
      if (!targets.includes(this.targetUnit)) return [];
      targets = [this.targetUnit];
    }
    if (targets.length === 0) return [];
    // 先扣次数
    battle.itemStock[this.item.item_id] = left - 1;
    const events = [{
      type: "item_use", unit: this.actor, item: this.item.item_id,
      name: this.item.name, left: left - 1,
    }];
    for (const target of targets) {
      const ctx = {
        actor: this.actor, target, grid: battle.grid, rolls: battle.rolls,
        mods: {}, depth: 0, summoned: null, battle, effectMult: 1.0,
      };
      events.push(...EffectSystem.execute(skill, ctx));
    }
    battle.actionUsed = true; // 道具内部自置行动标记
    return events;
  }
}

function skillEffectMult(data, unit, skill) {
  if (!unit.hero) return 1.0;
  const level = unit.hero.skill_levels[skill.skill_id] || 1;
  return 1 + data.getProgression("skill_level_mult", 0.05) * (level - 1);
}
