// 战斗单位（对应 Godot 版 unit.gd）
// 逻辑层单位：不依赖表现；死亡/引导打断通过返回事件表达。
import { cellKey, manhattan } from "./coords.js";
import { isBuffExpired } from "./buff.js";

export const Team = { PLAYER: 0, ENEMY: 1, NPC_ALLY: 2 };
export const MAX_RAGE = 100;

let nextUnitSeq = 1;

export class Unit {
  // data: UnitData（DataLoader.getUnit）；team: Team；coords: {x, y}
  constructor(data, team, coords) {
    this.uid = nextUnitSeq++;      // 运行时唯一标识（表现层用）
    this.data = data;
    this.team = team;
    this.coords = { ...coords };
    this.facing = { x: 0, y: 1 };
    this.hp = data.hp;
    this.rage = 0;
    this.av = 0;                   // CTB 行动值
    this.buffs = [];
    this.cooldowns = {};           // skill_id -> 剩余回合
    this.extra_action_pending = false;
    this.is_elite = false;
    this.is_object = false;        // 不行动、不计胜负
    this.collectable = false;      // 不可被指定
    this.hero = null;              // 养成档案（无养成时为 null → effect_mult=1.0）
    this.channeling = null;        // 引导目标（Unit）
    this.alert_triggered = false;  // 警觉特性：首次睡眠减免已用
    this.dead = false;             // died 事件只发一次的防护
    this.resetAv();
  }

  get alive() { return this.hp > 0; }
  get unitId() { return this.data.unit_id; }

  resetAv() {
    this.av = 1000.0 / this.getSpd();
  }

  // —— 属性公式 ——
  // mod = Σbuff.stat_mods[field] + 地形修正 + 光环；结果 = max(0, round(base × (100+mod) / 100))
  _withMods(grid, base, terrainField, buffField) {
    let mod = this.getStatMod(buffField);
    if (terrainField && grid) {
      const cell = grid.getCell(this.coords);
      if (cell) mod += cell.terrain[terrainField] || 0;
    }
    mod += this._auraMod(grid, buffField);
    return Math.max(0, Math.round((base * (100 + mod)) / 100));
  }

  // 光环：遍历全图同队存活单位（不含自己）的 buffs，aura_radius>0 且含该字段、曼哈顿 ≤ 半径则叠加
  _auraMod(grid, field) {
    if (!grid || !grid.unitsRef) return 0;
    let mod = 0;
    for (const u of grid.unitsRef) {
      if (u === this || !u.alive || u.team !== this.team) continue;
      for (const b of u.buffs) {
        if (b.aura_radius > 0 && b.aura_mods && b.aura_mods[field] !== undefined) {
          if (manhattan(u.coords, this.coords) <= b.aura_radius) mod += b.aura_mods[field];
        }
      }
    }
    return mod;
  }

  getAtk(grid) { return this._withMods(grid, this.data.atk, "atk_mod", "atk"); }
  getDef(grid) { return this._withMods(grid, this.data.def, "def_mod", "def"); }
  getMgc() { return Math.max(0, Math.round((this.data.mgc * (100 + this.getStatMod("mgc"))) / 100)); }
  getSpd() {
    return Math.max(1, Math.round((this.data.spd * (100 + this.getStatMod("spd"))) / 100));
  }
  getDodge(grid) {
    let v = this.data.dodge + this.getStatMod("dodge");
    if (grid) {
      const cell = grid.getCell(this.coords);
      if (cell) v += cell.terrain.dodge_mod || 0;
    }
    return v;
  }
  getBlock() { return this.data.block + this.getStatMod("block"); }
  getCrit() { return this.data.crit + this.getStatMod("crit"); }
  getMove(grid) {
    let v = this.data.move + this.getStatMod("move");
    if (grid) {
      const cell = grid.getCell(this.coords);
      if (cell && cell.terrain.terrain_id === "water" && !this.data.traits.includes("water_walker")) v -= 1;
    }
    return Math.max(0, v);
  }

  // —— Buff 管理 ——
  // 同 buff_id 不叠层，持续时间取 max 刷新
  addBuff(buff) {
    const existing = this.buffs.find((b) => b.buff_id === buff.buff_id);
    if (existing) {
      existing.duration = Math.max(existing.duration, buff.duration);
      return existing;
    }
    this.buffs.push(buff);
    return buff;
  }

  removeBuff(buffId) {
    const i = this.buffs.findIndex((b) => b.buff_id === buffId);
    if (i >= 0) this.buffs.splice(i, 1);
  }

  getStatMod(field) {
    let v = 0;
    for (const b of this.buffs) v += b.stat_mods[field] || 0;
    return v;
  }

  hasStatus(status) {
    return this.buffs.some((b) => b.status === status);
  }

  canAct() {
    return !(this.hasStatus("stun") || this.hasStatus("sleep") || this.hasStatus("paralyze"));
  }
  canMove() {
    return this.canAct() && !this.hasStatus("bind");
  }

  skillCooldown(skillId) { return this.cooldowns[skillId] || 0; }
  setCooldown(skill) {
    if (skill.cooldown > 0) this.cooldowns[skill.skill_id] = skill.cooldown;
  }

  // 回合开始阶段一：DoT/HoT；amount = round(最大生命 × percent / 100)
  tickEffects() {
    const events = [];
    for (const b of this.buffs) {
      if (!b.tick_effect) continue;
      const amount = Math.round((this.data.hp * b.tick_effect.percent) / 100);
      if (b.tick_effect.kind === "dot") {
        this.takeDamage(amount);
        events.push({ type: "dot", unit: this, buff: b.buff_id, amount });
      } else if (b.tick_effect.kind === "hot") {
        const healed = this.heal(amount);
        if (healed > 0) events.push({ type: "hot", unit: this, buff: b.buff_id, amount: healed });
      }
      if (!this.alive) break;
    }
    return events;
  }

  // 阶段二：冷却与 buff 持续 -1（必须在 canAct 判定之后执行，D22）
  tickDurations() {
    const events = [];
    for (const id of Object.keys(this.cooldowns)) {
      this.cooldowns[id] -= 1;
      if (this.cooldowns[id] <= 0) delete this.cooldowns[id];
    }
    for (let i = this.buffs.length - 1; i >= 0; i--) {
      const b = this.buffs[i];
      b.duration -= 1;
      if (isBuffExpired(b)) {
        this.buffs.splice(i, 1);
        events.push({ type: "buff_expired", unit: this, buff: b.buff_id });
      }
    }
    return events;
  }

  // 按数组顺序驱散前 count 个可驱散减益，返回 buff_id 列表
  dispelDebuffs(count) {
    const removed = [];
    for (let i = 0; i < this.buffs.length && removed.length < count;) {
      const b = this.buffs[i];
      if (b.is_debuff && b.dispellable) {
        removed.push(b.buff_id);
        this.buffs.splice(i, 1);
      } else i++;
    }
    return removed;
  }

  // 返回 {applied, interrupted, died}
  takeDamage(amount) {
    const applied = Math.min(Math.max(amount, 0), this.hp);
    let interrupted = false;
    if (applied > 0) {
      // 睡眠立即解除
      for (let i = this.buffs.length - 1; i >= 0; i--) {
        if (this.buffs[i].status === "sleep") this.buffs.splice(i, 1);
      }
      // 引导中被打断
      if (this.channeling) {
        this.channeling = null;
        interrupted = true;
      }
    }
    this.hp -= applied;
    const diedNow = this.hp <= 0 && !this.dead;
    if (diedNow) this.dead = true;
    return { applied, interrupted, died: diedNow };
  }

  heal(amount) {
    const healed = Math.min(Math.max(amount, 0), this.data.hp - this.hp);
    this.hp += healed;
    return healed;
  }

  gainRage(v) {
    this.rage = Math.max(0, Math.min(MAX_RAGE, this.rage + v));
  }
}
