// 战斗管理器（对应 Godot 版 battle_manager.gd）
// 状态机 + 指令管道 + CTB 回合流转 + 胜负判定 + 触发器。逻辑瞬时结算，表现层靠事件回放。
import { keyOf, cellKey, parseKey, manhattan, DIRS } from "./coords.js";
import { Grid } from "./grid.js";
import { Unit, Team } from "./unit.js";
import { TurnOrder } from "./turn_order.js";
import { makeBuff } from "./buff.js";
import * as PassiveSystem from "./passive_system.js";
import * as BattleAI from "./battle_ai.js";

export const State = {
  DEPLOY: "DEPLOY", IDLE: "IDLE", EXECUTING: "EXECUTING",
  AI_TURN: "AI_TURN", BATTLE_END: "BATTLE_END",
};
export const AutoMode = { MANUAL: 0, SEMI: 1, FULL: 2 };

const OBJECT_BASE_DATA = {
  nickname: "", star: "", quality: "green", unit_class: "support",
  atk: 0, def: 0, mgc: 0, spd: 1, crit: 0, dodge: 0, block: 0,
  move: 0, range_min: 1, range_max: 1, weapon: "", skill_signature: "",
  bonds: [], unlock: "", traits: [],
};

export class BattleManager {
  constructor(data, rolls) {
    this.data = data;       // DataLoader
    this.rolls = rolls;     // RollSource
    this._listeners = new Map();
    this.grid = null;
    this.units = [];
    this.turnOrder = new TurnOrder();
    this.state = State.DEPLOY;
    this.activeUnit = null;
    this.moveUsed = false;
    this.actionUsed = false;
    this.movePointsLeft = 0;
    this.activationLive = false;
    this.autoMode = AutoMode.MANUAL;
    this.focusTarget = null;
    this.pvpMods = null;             // {weights: {...}, core?: Unit}
    this.itemStock = {};
    this.level = null;
    this.bossUnit = null;
    this.roundCount = 0;
    this.collectCounts = {};
    this.occupyCounter = 0;
    this.deployed = [];              // [{unitId, unit}]
    this.triggers = [];
    this.escortReached = false;
    this.achievementPaths = {};
    this.killTeams = {};             // unitId -> 击杀者 team
    this.playerDeaths = 0;
    this.signatureMorphProvider = null; // 专武形态注入（meta 层接线）
    this._roundActors = new Set();
  }

  // —— 事件发射器 ——
  on(name, cb) {
    if (!this._listeners.has(name)) this._listeners.set(name, new Set());
    this._listeners.get(name).add(cb);
  }
  off(name, cb) {
    this._listeners.get(name)?.delete(cb);
  }
  _emit(name, ...args) {
    for (const cb of this._listeners.get(name) || []) cb(...args);
  }

  // —— 装载与布阵 ——
  // getHeroData(unitId) -> {hero, data} | null（养成数值注入；null 用基础数据）
  setupLevel(level, getHeroData = null) {
    this.level = level;
    this.grid = new Grid(
      this.data,
      { x: level.grid_size[0], y: level.grid_size[1] },
      level.terrain_map || {}, level.height_map || {},
    );
    this.units = [];
    this.grid.unitsRef = this.units;
    this.turnOrder = new TurnOrder();
    this.bossUnit = null;
    this.roundCount = 0;
    this.collectCounts = {};
    this.occupyCounter = 0;
    this.deployed = [];
    this.escortReached = false;
    this.achievementPaths = {};
    this.killTeams = {};
    this.playerDeaths = 0;
    this._roundActors = new Set();
    this.activeUnit = null;
    this.activationLive = false;
    this.triggers = (level.triggers || []).map((t) => JSON.parse(JSON.stringify(t)));
    this.itemStock = this.data.defaultItemStock();
    for (const spec of level.npc_allies || []) this.spawnFromSpec(spec, Team.NPC_ALLY);
    for (const spec of level.enemies || []) this.spawnFromSpec(spec, Team.ENEMY);
    for (const spec of level.objects || []) this._spawnObject(spec);
    this.state = State.DEPLOY;
    // 必出武将自动落位
    for (const unitId of level.required_units || []) {
      const hd = getHeroData ? getHeroData(unitId) : null;
      const cell = this._firstFreeDeployCell();
      if (cell) this._placePlayerUnit(unitId, cell, hd, true);
    }
    this._emit("deploy_changed");
  }

  _firstFreeDeployCell() {
    const [zx, zy, zw, zh] = this.level.deploy_zone;
    for (let y = zy; y < zy + zh; y++) {
      for (let x = zx; x < zx + zw; x++) {
        const cell = this.grid.getCell({ x, y });
        if (cell && !cell.isBlocked() && !cell.occupant) return { x, y };
      }
    }
    return null;
  }

  _placePlayerUnit(unitId, coords, hd, isRequired) {
    const baseData = hd && hd.data ? hd.data : this.data.getUnit(unitId);
    if (!baseData) return null;
    const unit = new Unit(baseData, Team.PLAYER, coords);
    unit.facing = { x: 0, y: -1 };
    if (hd && hd.hero) unit.hero = hd.hero;
    this.grid.placeUnit(unit, coords);
    this.units.push(unit);
    this.deployed.push({ unitId, unit, isRequired });
    return unit;
  }

  inDeployZone(coords) {
    const [zx, zy, zw, zh] = this.level.deploy_zone;
    return coords.x >= zx && coords.x < zx + zw && coords.y >= zy && coords.y < zy + zh;
  }

  deployUnit(unitId, coords, hd = null) {
    if (this.state !== State.DEPLOY) return { ok: false, reason: "当前不在布阵阶段" };
    if (!this.inDeployZone(coords)) return { ok: false, reason: "只能在蓝色部署区内落位" };
    if (this.deployed.length >= this.level.max_deploy) return { ok: false, reason: `最多上阵 ${this.level.max_deploy} 人` };
    if (this.deployed.some((d) => d.unitId === unitId)) return { ok: false, reason: "该武将已上阵" };
    const allowed = this.level.allowed_classes || [];
    if (allowed.length > 0) {
      const u = this.data.getUnit(unitId);
      if (!u || !allowed.includes(u.unit_class)) return { ok: false, reason: "本关限定职业上阵" };
    }
    const cell = this.grid.getCell(coords);
    if (!cell || cell.isBlocked() || cell.occupant) return { ok: false, reason: "该格不可落位" };
    this._placePlayerUnit(unitId, coords, hd, false);
    this._emit("deploy_changed");
    return { ok: true };
  }

  undeployUnit(unitId) {
    if (this.state !== State.DEPLOY) return { ok: false, reason: "当前不在布阵阶段" };
    const idx = this.deployed.findIndex((d) => d.unitId === unitId);
    if (idx < 0) return { ok: false, reason: "该武将未上阵" };
    if (this.deployed[idx].isRequired) return { ok: false, reason: "必出武将不可撤下" };
    const { unit } = this.deployed[idx];
    const cell = this.grid.getCell(unit.coords);
    if (cell && cell.occupant === unit) cell.occupant = null;
    this.units.splice(this.units.indexOf(unit), 1);
    this.deployed.splice(idx, 1);
    this._emit("deploy_changed");
    return { ok: true };
  }

  confirmDeploy() {
    if (this.state !== State.DEPLOY) return { ok: false, reason: "当前不在布阵阶段" };
    for (const unitId of this.level.required_units || []) {
      if (!this.deployed.some((d) => d.unitId === unitId)) {
        return { ok: false, reason: "必出武将未上阵" };
      }
    }
    if (this.deployed.length === 0) return { ok: false, reason: "尚未上阵任何武将" };
    if (this.deployed.length > this.level.max_deploy) return { ok: false, reason: "超出上阵人数上限" };
    return { ok: true };
  }

  startBattle() {
    const check = this.confirmDeploy();
    if (!check.ok) return check;
    this.state = State.IDLE;
    // 羁绊：同队在场搭档双方各挂 bond_<partner_id> buff（atk/def +bond_stat_bonus%，99 回合不可驱散）
    const bondBonus = this.data.getProgression("bond_stat_bonus", 5);
    const bondEvents = [];
    for (const unit of this.units) {
      if (unit.is_object || !unit.alive) continue;
      for (const bond of unit.data.bonds || []) {
        const partner = this.units.find((u) => u.unitId === bond.target && u.team === unit.team && u.alive && !u.is_object);
        if (!partner) continue;
        unit.addBuff(makeBuff({
          buff_id: `bond_${partner.unitId}`, name: bond.name || "羁绊",
          stat_mods: { atk: bondBonus, def: bondBonus },
          duration: 99, dispellable: false, source: partner,
        }));
        bondEvents.push({ type: "bond", unit, partner, name: bond.name || "羁绊" });
      }
    }
    if (bondEvents.length > 0) this._emit("trigger_events", bondEvents);
    this._fireTriggers({ type: "START" });
    this._emit("state_changed", this.state);
    this.advanceTurn();
    return { ok: true };
  }

  // —— 指令管道 ——
  submitCommand(cmd) {
    if (this.state === State.BATTLE_END) return;
    this.state = State.EXECUTING;
    this._emit("state_changed", this.state);
    const events = cmd.execute(this);
    const passiveEvents = PassiveSystem.afterCommand(this, cmd, events);
    const all = [...events, ...passiveEvents];
    this._emit("command_executed", cmd, all);
    this._fanOutTriggerEvents(all);
    if (this.state !== State.BATTLE_END) {
      const manualPlayer = this.activeUnit && this.activeUnit.team === Team.PLAYER && this.autoMode === AutoMode.MANUAL;
      this.state = manualPlayer ? State.IDLE : State.AI_TURN;
      this._emit("state_changed", this.state);
    }
  }

  // —— 回合流转 ——
  advanceTurn() {
    const outcome = this.evaluateOutcome();
    if (outcome >= 0) {
      this.state = State.BATTLE_END;
      this._emit("state_changed", this.state);
      this._emit("battle_ended", outcome);
      return;
    }
    const unit = this.turnOrder.nextActor(this.units);
    if (!unit) return;
    this.activeUnit = unit;
    const tickEvents = [];
    // 阶段一：DoT/HoT + 地形 tick
    tickEvents.push(...unit.tickEffects());
    if (unit.alive) {
      const cell = this.grid.getCell(unit.coords);
      if (cell && cell.terrain.terrain_id === "camp") {
        const healed = unit.heal(Math.round(unit.data.hp * 0.08));
        if (healed > 0) tickEvents.push({ type: "terrain_heal", unit, terrain: "camp", amount: healed });
      } else if (cell && cell.terrain.terrain_id === "fire") {
        const amount = Math.round(unit.data.hp * 0.05);
        const td = unit.takeDamage(amount);
        tickEvents.push({ type: "terrain_dot", unit, terrain: "fire", amount: td.applied });
        if (td.died) this._onUnitDied(unit);
      }
    }
    if (!unit.alive) {
      this._onUnitDied(unit);
      if (tickEvents.length > 0) this._emit("tick_events", unit, tickEvents);
      this.activeUnit = null;
      this.advanceTurn();
      return;
    }
    // 行动能力判定（先判定，D22）
    const incapacitated = !unit.canAct();
    // 阶段二：冷却与 buff 持续 -1
    tickEvents.push(...unit.tickDurations());
    if (incapacitated) {
      tickEvents.push({ type: "turn_skipped", unit });
      this._emit("tick_events", unit, tickEvents);
      this.finishTurn();
      return;
    }
    if (tickEvents.length > 0) this._emit("tick_events", unit, tickEvents);
    // 引导收讫
    if (unit.channeling) {
      const collectEvents = this._completeCollect(unit);
      if (collectEvents.length > 0) this._emit("tick_events", unit, collectEvents);
    }
    // turn_start 被动（在移动力结算之前）
    const passiveEvents = PassiveSystem.atTurnStart(this, unit);
    if (passiveEvents.length > 0) this._emit("tick_events", unit, passiveEvents);
    // 重置激活窗口
    this.moveUsed = false;
    this.actionUsed = false;
    this.movePointsLeft = unit.getMove(this.grid);
    this.activationLive = true;
    const manualPlayer = unit.team === Team.PLAYER && this.autoMode === AutoMode.MANUAL;
    this.state = manualPlayer ? State.IDLE : State.AI_TURN;
    this._emit("state_changed", this.state);
    this._emit("turn_started", unit);
  }

  finishTurn() {
    const unit = this.activeUnit;
    if (!unit) return;
    this.activationLive = false;
    if (unit.extra_action_pending) {
      unit.extra_action_pending = false;
      unit.av = 0; // 再动：不 resetAv
    } else {
      unit.resetAv();
    }
    this._emit("turn_ended", unit);
    if (unit.alive && !unit.is_object) this._roundActors.add(unit.uid);
    this.activeUnit = null;
    this._checkRoundComplete();
    this.advanceTurn();
  }

  _checkRoundComplete() {
    for (const u of this.units) {
      if (u.alive && !u.is_object && !this._roundActors.has(u.uid)) return;
    }
    this._roundActors.clear();
    this.roundCount += 1;
    const wc = this.level ? this.level.win_condition : null;
    if (wc && wc.type === "OCCUPY") {
      if (this._anyPlayerInZone(wc.zone)) this.occupyCounter += 1;
      else this.occupyCounter = 0;
    }
    this._emit("round_started", this.roundCount);
    this._fireTriggers({ type: "TURN", turn: this.roundCount });
  }

  _anyPlayerInZone(zone) {
    return this.units.some((u) => u.alive && !u.is_object && u.team === Team.PLAYER && inZone(u.coords, zone));
  }

  _completeCollect(unit) {
    const obj = unit.channeling;
    unit.channeling = null;
    const events = [];
    if (obj && obj.alive) {
      const cell = this.grid.getCell(obj.coords);
      if (cell && cell.occupant === obj) cell.occupant = null;
      const idx = this.units.indexOf(obj);
      if (idx >= 0) this.units.splice(idx, 1);
      obj.hp = 0;
      obj.dead = true;
      this.collectCounts[obj.unitId] = (this.collectCounts[obj.unitId] || 0) + 1;
      events.push({ type: "collect", unit, object: obj, count: this.collectCounts[obj.unitId] });
    } else {
      events.push({ type: "collect_failed", unit, object: obj });
    }
    return events;
  }

  // —— 胜负判定（顺序敏感）——
  evaluateOutcome() {
    const playerAlive = this.units.some((u) => u.alive && !u.is_object && u.team === Team.PLAYER);
    const enemyAlive = this.units.some((u) => u.alive && !u.is_object && u.team === Team.ENEMY);
    // 1. 我方全灭（最高优先）
    if (!playerAlive) return Team.ENEMY;
    // 2. 失败条件
    for (const cond of this.level.lose_conditions || []) {
      if (cond.type === "WIPED_OUT" && !playerAlive) return Team.ENEMY;
      if (cond.type === "TURN_LIMIT" && this.roundCount > cond.turns) return Team.ENEMY;
      if (cond.type === "ESCORT_DEAD") {
        const u = this.units.find((x) => x.unitId === cond.unit);
        if (u && !u.alive) return Team.ENEMY;
      }
    }
    // 3. 胜利条件
    const wc = this.level.win_condition;
    if (wc) {
      if (wc.type === "WIPE_OUT" && !enemyAlive) return Team.PLAYER;
      if (wc.type === "KILL_BOSS" && (!this.bossUnit || !this.bossUnit.alive)) return Team.PLAYER;
      if (wc.type === "SURVIVE_TURNS" && this.roundCount >= wc.turns) return Team.PLAYER;
      if (wc.type === "COLLECT" && (this.collectCounts[wc.target] || 0) >= wc.count) return Team.PLAYER;
      if (wc.type === "ESCORT" && this.escortReached) return Team.PLAYER;
      if (wc.type === "OCCUPY" && this.occupyCounter >= wc.turns) return Team.PLAYER;
    }
    // 4. 敌方全灭且胜条件不是 COLLECT/ESCORT
    if (!enemyAlive && wc && wc.type !== "COLLECT" && wc.type !== "ESCORT") return Team.PLAYER;
    return -1;
  }

  // 结算：奖励由 Flow 按首通/常规挑选；此处给评价与成就
  computeResult(winner) {
    const level = this.level;
    let rank = null;
    if (winner === Team.PLAYER && level.rank_rules && level.rank_rules.s_max_rounds) {
      const noDeathOk = !level.rank_rules.s_no_death || this.playerDeaths === 0;
      rank = noDeathOk && this.roundCount <= level.rank_rules.s_max_rounds ? "S" : "A";
    }
    const achieved = [];
    if (winner === Team.PLAYER) {
      const groups = new Set();
      for (const a of level.achievements || []) {
        if (a.exclusive_group && groups.has(a.exclusive_group)) continue;
        if (!this._achievementMet(a)) continue;
        achieved.push(a);
        if (a.exclusive_group) groups.add(a.exclusive_group);
      }
    }
    return {
      winner, rank, achievements: achieved,
      rewards: level.rewards || {},
      rounds: this.roundCount,
      playerDeaths: this.playerDeaths,
    };
  }

  _achievementMet(a) {
    const req = a.requires || {};
    if (req.path && !this.achievementPaths[req.path]) return false;
    if (req.no_player_kills) {
      for (const id of req.no_player_kills) {
        if (this.killTeams[id] === Team.PLAYER) return false;
      }
    }
    if (req.boss_dead) {
      const u = this.units.find((x) => x.unitId === req.boss_dead);
      if (u && u.alive) return false;
    }
    return true;
  }

  // —— 触发器 ——
  _fireTriggers(event) {
    for (const t of this.triggers) {
      const once = t.once !== false;
      if (once && t._fired) continue;
      if (!this._triggerMatches(t.on, event)) continue;
      if (t.if && !this._triggerIf(t.if)) continue;
      t._fired = true;
      this._runTriggerActions(t.actions || []);
    }
  }

  _triggerMatches(on, event) {
    if (!on) return false;
    switch (on.type) {
      case "START": return event.type === "START";
      case "TURN": return event.type === "TURN" && event.turn === on.turn;
      case "UNIT_DEAD": return event.type === "UNIT_DEAD" && event.unit && event.unit.unitId === on.unit;
      case "ENTER_ZONE": {
        if (event.type !== "UNIT_MOVED" || !event.unit) return false;
        if (!inZone(event.unit.coords, on.zone)) return false;
        const who = on.who || "any";
        if (who === "any") return true;
        if (who === "player") return event.unit.team === Team.PLAYER;
        if (who === "enemy") return event.unit.team === Team.ENEMY;
        return event.unit.unitId === who;
      }
      case "HP_BELOW": {
        if (event.type !== "UNIT_DAMAGED" || !event.unit) return false;
        if (event.unit.unitId !== on.unit) return false;
        return event.unit.hp / event.unit.data.hp < on.ratio;
      }
      default: return false;
    }
  }

  _triggerIf(cond) {
    switch (cond.type) {
      case "collect_below": return (this.collectCounts[cond.target] || 0) < cond.count;
      case "unit_deployed": return this.deployed.some((d) => d.unitId === cond.unit);
      case "unit_alive": return this.units.some((u) => u.unitId === cond.unit && u.alive);
      default: return true;
    }
  }

  _runTriggerActions(actions) {
    const events = [];
    for (const a of actions) {
      switch (a.type) {
        case "dialogue":
          this._emit("dialogue", a.text);
          break;
        case "spawn":
          for (const spec of a.units) {
            const team = spec.team === "npc" ? Team.NPC_ALLY : Team.ENEMY;
            const unit = this.spawnFromSpec(spec, team);
            if (unit) events.push({ type: "spawn", unit });
          }
          break;
        case "terrain":
          for (const [key, terrainId] of Object.entries(a.cells || {})) {
            const coords = parseKey(key);
            const cell = this.grid.getCell(coords);
            const from = cell ? cell.terrain.terrain_id : "plain";
            this.grid.setTerrain(coords, terrainId);
            events.push({ type: "terrain_change", coords, from, to: terrainId });
          }
          break;
        case "buff": {
          const targets = this._triggerTargets(a);
          for (const u of targets) {
            const buffId = `trigger_${a.field}`;
            u.addBuff(makeBuff({
              buff_id: buffId, name: a.name || "触发器",
              stat_mods: { [a.field]: a.value }, duration: a.duration || 1,
            }));
            events.push({ type: "buff", target: u, buff: buffId, field: a.field, value: a.value, duration: a.duration || 1 });
          }
          break;
        }
        case "status": {
          for (const u of this._triggerTargets(a)) {
            let dur = a.duration || 1;
            if (a.except && u.unitId === a.except.unit) dur = a.except.duration;
            u.addBuff(makeBuff({
              buff_id: a.status, name: a.name || a.status, duration: dur,
              status: a.status, is_debuff: true,
            }));
            events.push({ type: "status", target: u, status: a.status, duration: dur });
          }
          break;
        }
        case "regen": {
          const u = this.units.find((x) => x.unitId === a.unit);
          if (u && u.alive) {
            const buffId = `regen_${a.unit}`;
            u.addBuff(makeBuff({
              buff_id: buffId, name: a.name || "再生", duration: a.duration || 1,
              tick_effect: { kind: "hot", percent: a.percent },
            }));
            events.push({ type: "buff", target: u, buff: buffId, field: null, value: a.percent, duration: a.duration || 1 });
          }
          break;
        }
        case "achievement_path":
          this.achievementPaths[a.path] = true;
          events.push({ type: "achievement_path", path: a.path });
          break;
        default:
          break;
      }
    }
    if (events.length > 0) this._emit("trigger_events", events);
  }

  _triggerTargets(a) {
    if (a.unit) return this.units.filter((u) => u.unitId === a.unit && u.alive);
    if (a.side) {
      const team = a.side === "enemy" ? Team.ENEMY : a.side === "npc" ? Team.NPC_ALLY : Team.PLAYER;
      return this.units.filter((u) => u.alive && u.team === team && !u.is_object);
    }
    return [];
  }

  _fanOutTriggerEvents(events) {
    for (const e of events) {
      switch (e.type) {
        case "move":
          this._fireTriggers({ type: "UNIT_MOVED", unit: e.unit });
          this._checkEscort(e.unit);
          break;
        case "pull": case "push": {
          this._fireTriggers({ type: "UNIT_MOVED", unit: e.target });
          this._checkEscort(e.target);
          break;
        }
        case "teleport":
          this._fireTriggers({ type: "UNIT_MOVED", unit: e.unit });
          this._checkEscort(e.unit);
          break;
        case "swap":
          this._fireTriggers({ type: "UNIT_MOVED", unit: e.source });
          this._fireTriggers({ type: "UNIT_MOVED", unit: e.target });
          this._checkEscort(e.source);
          this._checkEscort(e.target);
          break;
        case "damage":
          if (e.died && e.source) this.killTeams[e.target.unitId] = e.source.team;
          this._fireTriggers({ type: "UNIT_DAMAGED", unit: e.target, source: e.source });
          break;
        default:
          break;
      }
    }
  }

  _checkEscort(unit) {
    const wc = this.level ? this.level.win_condition : null;
    if (!wc || wc.type !== "ESCORT" || this.escortReached) return;
    if (unit.unitId === wc.unit && inZone(unit.coords, wc.zone)) {
      this.escortReached = true;
    }
  }

  _onUnitDied(unit) {
    if (unit._deathReported) return;
    unit._deathReported = true;
    this.turnOrder.remove(unit);
    const cell = this.grid.getCell(unit.coords);
    if (cell && cell.occupant === unit) cell.occupant = null;
    if (unit.team === Team.PLAYER && !unit.is_object) this.playerDeaths++;
    this._emit("unit_died", unit);
    this._fireTriggers({ type: "UNIT_DEAD", unit });
  }

  // —— 布阵/战斗辅助 ——
  spawnFromSpec(spec, defaultTeam) {
    const base = this.data.getUnit(spec.unit);
    if (!base) return null;
    let unitData = base;
    if (spec.stat_mult && spec.stat_mult !== 1) {
      unitData = {
        ...base,
        hp: Math.round(base.hp * spec.stat_mult),
        atk: Math.round(base.atk * spec.stat_mult),
        def: Math.round(base.def * spec.stat_mult),
        mgc: Math.round(base.mgc * spec.stat_mult),
        spd: Math.round(base.spd * spec.stat_mult),
      };
    }
    const team = spec.team !== undefined ? spec.team : defaultTeam;
    let coords = { x: spec.coords[0], y: spec.coords[1] };
    const unit = new Unit(unitData, team, coords);
    if (spec.elite) unit.is_elite = true;
    if (spec.boss) this.bossUnit = unit;
    // 落点被占时 BFS 外扩找最近可站立格
    if (!this.grid.canStop(coords, unit)) {
      const alt = this._findNearestFree(coords, unit);
      if (!alt) return null;
      coords = alt;
    }
    this.grid.placeUnit(unit, coords);
    this.units.push(unit);
    return unit;
  }

  _findNearestFree(center, unit) {
    const visited = new Set([cellKey(center)]);
    const queue = [center];
    while (queue.length > 0) {
      const cur = queue.shift();
      for (const d of DIRS) {
        const next = { x: cur.x + d.x, y: cur.y + d.y };
        const key = cellKey(next);
        if (visited.has(key) || !this.grid.isInside(next)) continue;
        visited.add(key);
        if (this.grid.canStop(next, unit)) return next;
        queue.push(next);
      }
    }
    return null;
  }

  _spawnObject(spec) {
    const data = {
      ...OBJECT_BASE_DATA,
      unit_id: spec.id, name: spec.id,
      hp: spec.hp || 300,
    };
    const coords = { x: spec.coords[0], y: spec.coords[1] };
    const unit = new Unit(data, Team.NPC_ALLY, coords);
    unit.is_object = true;
    unit.collectable = true;
    this.grid.placeUnit(unit, coords);
    this.units.push(unit);
    return unit;
  }

  // —— 移动辅助 ——
  reachableFor(unit) {
    if (!this.activationLive || this.activeUnit !== unit) return new Map();
    return this.grid.getReachable(unit, this.movePointsLeft);
  }

  // —— 攻击辅助 ——
  attackRangeMax(attacker, from = null) {
    const cell = this.grid.getCell(from || attacker.coords);
    const rangeMod = cell ? cell.terrain.range_mod : 0;
    return attacker.data.range_max + rangeMod;
  }

  inAttackRange(attacker, target) {
    return this.inAttackRangeFrom(attacker, attacker.coords, target.coords);
  }

  inAttackRangeFrom(attacker, from, targetCoords) {
    const shape = this.data.getWeaponShape(attacker.data.weapon);
    if (shape === "line") {
      if (from.x !== targetCoords.x && from.y !== targetCoords.y) return false;
    }
    const d = manhattan(from, targetCoords);
    return d >= attacker.data.range_min && d <= this.attackRangeMax(attacker, from);
  }

  // 普攻目标：只认 ENEMY 队且非 collectable
  enemiesInRange(unit) {
    return this.units.filter((u) =>
      u.alive && u.team === Team.ENEMY && !u.collectable && this.inAttackRange(unit, u));
  }

  // 射程内的可破坏障碍格
  obstaclesInRange(unit) {
    const out = [];
    const rangeMax = this.attackRangeMax(unit);
    const shape = this.data.getWeaponShape(unit.data.weapon);
    for (const cell of this.grid.cells.values()) {
      if (!cell.hasObstacle()) continue;
      if (shape === "line" && cell.coords.x !== unit.coords.x && cell.coords.y !== unit.coords.y) continue;
      const d = manhattan(unit.coords, cell.coords);
      if (d >= unit.data.range_min && d <= rangeMax) out.push(cell.coords);
    }
    return out;
  }

  genericAttackSkill(unit) {
    return unit.data.range_min >= 2
      ? this.data.getSkill("generic_ranged")
      : this.data.getSkill("generic_melee");
  }

  canUseSkill(unit, skill) {
    return !!skill && unit.rage >= skill.rage_cost && unit.skillCooldown(skill.skill_id) <= 0;
  }

  canChannel(actor, target) {
    return !!target && target.is_object && target.alive &&
      !actor.is_object && !actor.channeling &&
      manhattan(actor.coords, target.coords) === 1;
  }

  canUseItem(unit) {
    if (!unit.alive || this.actionUsed) return false;
    return Object.values(this.itemStock).some((n) => n > 0);
  }

  itemUsesLeft(itemId) {
    return this.itemStock[itemId] || 0;
  }

  signatureMorphFor(unit, skillId) {
    return this.signatureMorphProvider ? this.signatureMorphProvider(unit, skillId) : {};
  }

  // —— AI 驱动 ——
  runAi() {
    if (!this.activeUnit || this.state === State.BATTLE_END) return;
    const plan = BattleAI.decide(this.activeUnit, this);
    for (const cmd of plan) {
      if (this.state === State.BATTLE_END) break;
      this.submitCommand(cmd);
    }
    if (this.state !== State.BATTLE_END) this.finishTurn();
  }
}

export function inZone(coords, zone) {
  const [zx, zy, zw, zh] = zone;
  return coords.x >= zx && coords.x < zx + zw && coords.y >= zy && coords.y < zy + zh;
}
