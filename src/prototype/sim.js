// 横版自动战斗 · 纯逻辑层（无 three.js / DOM，可 node 无头跑）
// 数据来自 data.js（units.csv / skills.csv / proto_awaken.csv 装配）
// 复用 core 的 scanModifiers 解析修正类效果；随机走注入 RNG；定长 tick；产事件数组供表现层回放
import { scanModifiers } from "../shared/effects.js";

export function makeRNG(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const SIM_STEP = 0.1;

const RANGE = { vanguard: 2.3, cavalry: 2.3, infantry: 2.3, archer: 7.6, strategist: 7.6, healer: 7.6, support: 7.6 };
const MELEE = new Set(["vanguard", "cavalry", "infantry"]);
const CASTER = new Set(["strategist", "healer"]);
// 职业样式（表现层用）
export const CLS = {
  vanguard:   { color: 0x8a6a45, label: "先锋" },
  cavalry:    { color: 0xb0543a, label: "马军" },
  infantry:   { color: 0x4a6baa, label: "步军" },
  archer:     { color: 0x4aa05e, label: "神射" },
  strategist: { color: 0x8a55b0, label: "谋士" },
  healer:     { color: 0x3fa89a, label: "医者" },
  support:    { color: 0xa89a4a, label: "辅助" },
};
const CHAIN_WINDOW = 3.0, CHAIN_BONUS = 0.2;

export class Unit {
  constructor(cfg, side, rng) {
    Object.assign(this, cfg); // id,name,cls,archetype,row,hp,atk,def,mgc,spd,crit,dodge,block,small,ult,passives,awaken,ultName
    this.side = side;
    this.maxHp = cfg.hp; this.hp = cfg.hp;
    this.alive = true; this.rage = 0;
    this.x = 0; this.z = 0;
    this.atkInterval = clamp(2.4 - cfg.spd * 0.012, 1.0, 2.2);
    this.moveSpeed = 0.9 + cfg.spd * 0.011;
    this.range = RANGE[cfg.cls] || 2.3;
    this.isMelee = MELEE.has(cfg.cls);
    this.isHealer = cfg.cls === "healer";
    this.atkTimer = this.atkInterval * (0.4 + rng() * 0.4);
    this.smallTimer = cfg.small ? cfg.small.cd * 0.6 : 0;
    this.cc = { stun: 0, paralyze: 0, sleep: 0, bind: 0 };
    this.silence = 0; this.taunt = 0;
    this.buffs = []; // {field,val,t}
    this.hotAura = 0; this.lifesteal = 0; this.executeBelow = 0;
    this.awakenFired = false; this.turnTimer = 2.0;
    this.ultDelay = -1; this._lunge = 0;
  }
  get ccLocked() { return this.cc.stun > 0 || this.cc.paralyze > 0 || this.cc.sleep > 0; }
  _buffSum(field) { let s = 0; for (const b of this.buffs) if (b.field === field) s += b.val; return s; }
  get effAtk() { return this.atk * (1 + this._buffSum("atk")); }
  get effDef() { return Math.max(0, this.def * (1 + this._buffSum("def"))); }
  get effMgc() { return this.mgc * (1 + this._buffSum("mgc")); }
  get effCrit() { return clamp(this.crit + this._buffSum("crit") * 100, 0, 100); }
  get effDodge() { return clamp(this.dodge + this._buffSum("dodge") * 100, 0, 75); }
  get effBlock() { return clamp(this.block + this._buffSum("block") * 100, 0, 75); }
  get effInterval() { return this.atkInterval * Math.max(0.4, 1 - this._buffSum("haste")); }
  get attackStat() { return CASTER.has(this.cls) ? this.effMgc : this.effAtk; }
}

export class Sim {
  constructor(teams, seed = 20260727) {
    this.rng = makeRNG(seed);
    this.units = [];
    this.events = [];
    this.time = 0; this.winner = -1; this.focusId = null;
    this.deaths = { 0: [], 1: [] };
    this.teamHot = { 0: 0, 1: 0 };
    this.chain = { count: 0, timer: 0 };
    this._chainMult = 1;
    for (const c of teams.player) this.units.push(new Unit(c, 0, this.rng));
    for (const c of teams.enemy) this.units.push(new Unit(c, 1, this.rng));
    this._layout();
    this._startBattle();
  }
  _layout() {
    const rows = { 0: { front: -3.2, back: -5.4 }, 1: { front: 3.2, back: 5.4 } };
    for (const side of [0, 1]) {
      const front = this.units.filter((u) => u.side === side && u.row === "front");
      const back = this.units.filter((u) => u.side === side && u.row === "back");
      front.forEach((u, i) => { u.x = rows[side].front; u.z = (i - (front.length - 1) / 2) * 1.5; });
      back.forEach((u, i) => { u.x = rows[side].back; u.z = (i - (back.length - 1) / 2) * 1.7; });
    }
  }
  _startBattle() {
    for (const u of this.units) {
      if (!u.awaken) continue;
      if (u.awaken.trigger === "battle_start") this._fireAwaken(u);
      else if (u.awaken.trigger === "always") { u.awakenFired = true; this._exec(u, u.awaken.parsed, [u], { awaken: true }); }
    }
  }
  byId(id) { return this.units.find((u) => u.id === id); }
  enemiesOf(side) { return this.units.filter((u) => u.alive && u.side !== side); }
  alliesOf(side) { return this.units.filter((u) => u.alive && u.side === side); }
  frontAlive(side) { return this.units.some((u) => u.alive && u.side === side && u.row === "front"); }

  step(dt) {
    if (this.winner >= 0) return;
    this.time += dt;
    this.chain.timer = Math.max(0, this.chain.timer - dt);
    if (this.chain.timer === 0) this.chain.count = 0;
    for (const u of this.units) {
      if (!u.alive) continue;
      for (const k of ["stun", "paralyze", "sleep", "bind"]) u.cc[k] = Math.max(0, u.cc[k] - dt);
      u.silence = Math.max(0, u.silence - dt);
      u.taunt = Math.max(0, u.taunt - dt);
      for (let i = u.buffs.length - 1; i >= 0; i--) { u.buffs[i].t -= dt; if (u.buffs[i].t <= 0) u.buffs.splice(i, 1); }
      // 团队治疗光环
      if (this.teamHot[u.side] > 0) u.hp = Math.min(u.maxHp, u.hp + u.maxHp * this.teamHot[u.side] * dt);
      // 觉醒技：血量阈值
      if (u.awaken && !u.awakenFired && u.awaken.trigger === "hp_below" && u.hp / u.maxHp <= u.awaken.param) this._fireAwaken(u);
      // 敌方 AI 大招：怒满后短暂延迟自动放
      if (u.side === 1 && u.rage >= 100 && u.silence <= 0 && u.ultDelay < 0) u.ultDelay = 0.8;
      if (u.ultDelay >= 0) { u.ultDelay -= dt; if (u.ultDelay < 0) this.castUlt(u); }
      // 周期性 turn_start 被动
      u.turnTimer -= dt;
      if (u.turnTimer <= 0) { u.turnTimer = 2.0; this._firePassives(u, "turn_start", u); }
      if (u.ccLocked) continue;
      if (u.isHealer) this._healerAct(u, dt); else this._fighterAct(u, dt);
      if (u.small && !u.ccLocked && u.silence <= 0) {
        u.smallTimer -= dt;
        if (u.smallTimer <= 0) { u.smallTimer = u.small.cd; this._castSmall(u); }
      }
    }
  }

  _fighterAct(u, dt) {
    const tgt = this._pickTarget(u);
    if (!tgt) return;
    const dist = Math.abs(tgt.x - u.x);
    if (dist > u.range) {
      if (u.cc.bind <= 0) u.x += Math.sign(tgt.x - u.x) * u.moveSpeed * dt;
    } else {
      u.atkTimer -= dt;
      if (u.atkTimer <= 0) { u.atkTimer = u.effInterval; this._attack(u, tgt); }
    }
  }
  _healerAct(u, dt) {
    u.atkTimer -= dt;
    if (u.atkTimer > 0) return;
    u.atkTimer = u.effInterval;
    const allies = this.alliesOf(u.side).filter((a) => a.hp < a.maxHp);
    if (!allies.length) return;
    allies.sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp);
    const tgt = allies[0];
    const amount = Math.round(u.effMgc * 0.9);
    tgt.hp = Math.min(tgt.maxHp, tgt.hp + amount);
    u.rage = clamp(u.rage + 12, 0, 100);
    this.events.push({ type: "heal", src: u.id, tgt: tgt.id, amount });
  }

  _counterScore(att, def) {
    const a = att.archetype, d = def.archetype;
    const squishy = d === "mage" || d === "archer" || d === "healer" || d === "support";
    let s = 0;
    if ((a === "archer" || a === "mage") && squishy) s += 6; // 远程切后排脆皮
    if (a === "phys" && d === "tank") s -= 3;                 // 物理避开坦克墙
    if (a === "phys" && squishy) s += 2;                      // 物理优先脆皮
    if (d === "healer") s += 2;                               // 优先断奶
    return s;
  }
  _pickTarget(u) {
    const enemies = this.enemiesOf(u.side);
    if (!enemies.length) return null;
    let pool = enemies;
    if (u.isMelee && this.frontAlive(1 - u.side)) pool = enemies.filter((e) => e.row === "front");
    const taunters = pool.filter((e) => e.taunt > 0);
    if (taunters.length) pool = taunters;
    if (u.side === 0 && this.focusId) {
      const f = pool.find((e) => e.id === this.focusId) || enemies.find((e) => e.id === this.focusId);
      if (f && (!u.isMelee || f.row === "front" || !this.frontAlive(1))) return f;
    }
    let best = null, bs = -1e9;
    for (const e of pool) {
      let score = -(Math.abs(e.x - u.x) * 2 + Math.abs(e.z - u.z));
      score += this._counterScore(u, e) + (1 - e.hp / e.maxHp) * 2;
      if (score > bs) { bs = score; best = e; }
    }
    return best;
  }

  // —— 伤害计算：闪避/暴击/格挡/前后排/连锁 ——
  _computeDmg(att, tgt, mult, { magic = false, sureHit = false, chainMult = 1 } = {}) {
    if (!sureHit && this.rng() < tgt.effDodge / 100) return { dodged: true };
    let base = (att.attackStat * 100) / (100 + tgt.effDef);
    if (tgt.row === "back") base *= 0.9; // 后排承伤 -10%
    const crit = this.rng() < att.effCrit / 100;
    if (crit) base *= 1.5;
    let blocked = false;
    if (this.rng() < tgt.effBlock / 100) { base *= 0.7; blocked = true; }
    const dmg = Math.max(1, Math.round(base * mult * chainMult * (0.92 + this.rng() * 0.16)));
    return { dmg, crit, blocked, magic, chainMult };
  }
  _damage(att, tgt, dmg, opts = {}) {
    if (!tgt.alive) return;
    if (att && (att.executeBelow > 0 || opts.executeBelow) && tgt.hp / tgt.maxHp <= (opts.executeBelow || att.executeBelow)) {
      dmg = tgt.hp; opts = { ...opts, executed: true };
    }
    tgt.hp -= dmg;
    tgt.rage = clamp(tgt.rage + 10, 0, 100);
    if (att && att.lifesteal > 0 && dmg > 0) att.hp = Math.min(att.maxHp, att.hp + Math.round(dmg * att.lifesteal));
    this.events.push({ type: "damage", tgt: tgt.id, amount: dmg, ...opts });
    // on_hit 被动
    if (att) this._firePassives(tgt, "on_hit", att);
    if (tgt.hp <= 0) {
      tgt.hp = 0; tgt.alive = false;
      this.deaths[tgt.side].push(tgt.id);
      if (att) att.rage = clamp(att.rage + 30, 0, 100);
      this.events.push({ type: "die", tgt: tgt.id, by: att ? att.id : null });
      if (this.focusId === tgt.id) this.focusId = null;
      this._checkEnd();
    }
  }

  _attack(att, tgt) {
    const r = this._computeDmg(att, tgt, 1.0);
    this.events.push({ type: "attack", att: att.id, tgt: tgt.id, melee: att.isMelee, crit: r.crit });
    if (r.dodged) { this.events.push({ type: "dodge", tgt: tgt.id }); return; }
    this._damage(att, tgt, r.dmg, r);
    att.rage = clamp(att.rage + 20, 0, 100);
    this._firePassives(att, "on_attack", tgt); // on_attack 被动
  }

  // —— 效果串解释器（实时横版模型） ——
  _exec(caster, parsed, targets, { chainMult = 1, effectMult = 1, awaken = false } = {}) {
    const mods = scanModifiers(parsed);
    if (mods.hit_rate !== undefined && this.rng() >= mods.hit_rate) { this.events.push({ type: "miss", tgt: targets[0] ? targets[0].id : null }); return; }
    if (mods.chance !== undefined && this.rng() >= mods.chance) return;
    const killedBefore = new Set(this.deaths[0].concat(this.deaths[1]));
    let pool = targets.slice();
    if (mods.target_rule === "lowest_hp") pool = pool.length ? [pool.slice().sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0]] : [];
    if (mods.random_target) pool = this._pickRandom(pool, mods.random_target);

    for (const e of parsed) {
      if (MODIFIER_ONLY.has(e.name)) continue;
      for (let rep = 0; rep < e.times; rep++) {
        this._applyEffect(e, caster, pool, mods, { chainMult, effectMult });
      }
    }
    // refresh_on_kill：本技能造成击杀则回怒 + 重置攻击
    if (mods.refresh_on_kill) {
      const killedNow = this.deaths[0].concat(this.deaths[1]).some((id) => !killedBefore.has(id));
      if (killedNow) { caster.rage = clamp(caster.rage + 50, 0, 100); caster.atkTimer = 0; this.events.push({ type: "buffself", unit: caster.id, label: "连杀" }); }
    }
  }
  _pickRandom(pool, n) {
    const arr = pool.slice();
    for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(this.rng() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
    return arr.slice(0, n);
  }
  _bonusMult(caster, t, mods) {
    let m = 1;
    if (mods.bonus_by_self_lost_hp) m *= 1 + mods.bonus_by_self_lost_hp * (1 - caster.hp / caster.maxHp);
    if (mods.bonus_vs_elite && t.cls === "vanguard") m *= 1 + mods.bonus_vs_elite; // 横版以前排坦克为精英
    if (mods.bonus_vs_high_def && t.effDef >= 100) m *= 1 + mods.bonus_vs_high_def;
    if (mods.bonus_vs_cavalry && t.cls === "cavalry") m *= 1 + mods.bonus_vs_cavalry;
    return m;
  }
  _applyEffect(e, caster, pool, mods, { chainMult, effectMult }) {
    const selfSide = caster.side;
    switch (e.name) {
      case "phys_dmg": case "mgc_dmg": {
        const magic = e.name === "mgc_dmg";
        const mult = parseFloat(e.args[0]) * effectMult;
        for (const t of pool) {
          if (!t.alive) continue;
          if (mods.execute_below !== undefined && t.hp / t.maxHp <= mods.execute_below) { this._damage(caster, t, t.hp, { executed: true }); continue; }
          const r = this._computeDmg(caster, t, mult * this._bonusMult(caster, t, mods), { magic, sureHit: !!mods.sure_hit, chainMult });
          if (r.dodged) { this.events.push({ type: "dodge", tgt: t.id }); continue; }
          this._damage(caster, t, r.dmg, { ...r, ult: chainMult > 1 });
        }
        // 误伤
        if (mods.friendly_fire) {
          for (const ally of this.alliesOf(selfSide)) {
            if (ally === caster || !ally.alive) continue;
            if (this.rng() < mods.friendly_fire) {
              const r = this._computeDmg(caster, ally, parseFloat(e.args[0]) * 0.5, { magic, sureHit: true });
              if (!r.dodged) this._damage(caster, ally, r.dmg, { friendly: true });
            }
          }
        }
        return;
      }
      case "heal": {
        const mult = parseFloat(e.args[0]) * effectMult;
        for (const t of pool) {
          if (!t.alive) continue;
          const amount = Math.round(caster.attackStat * mult);
          t.hp = Math.min(t.maxHp, t.hp + amount);
          this.events.push({ type: "heal", src: caster.id, tgt: t.id, amount });
        }
        return;
      }
      case "rage": caster.rage = clamp(caster.rage + parseFloat(e.args[0]), 0, 100); return;
      case "stun": case "sleep": case "paralyze": case "bind": {
        const n = parseFloat(e.args[0]);
        for (const t of pool) if (t.alive) { t.cc[e.name] = Math.max(t.cc[e.name], n); this.events.push({ type: "cc", tgt: t.id, label: CC_LABEL[e.name] }); }
        return;
      }
      case "sleep_chance": {
        const p = parseFloat(e.args[0]), n = parseFloat(e.args[1]);
        for (const t of pool) if (t.alive) { if (this.rng() < p) { t.cc.sleep = Math.max(t.cc.sleep, n); this.events.push({ type: "cc", tgt: t.id, label: "沉睡" }); } }
        return;
      }
      case "pull": for (const t of pool) if (t.alive) t.x += Math.sign(caster.x - t.x) * parseFloat(e.args[0]) * 0.6; return;
      case "knockback": for (const t of pool) if (t.alive) t.x += Math.sign(t.x - caster.x) * parseFloat(e.args[0]) * 0.6; return;
      case "armor_break": { const v = parseFloat(e.args[0]), d = parseFloat(e.args[1] || 2); for (const t of pool) if (t.alive) { t.buffs.push({ field: "def", val: -v, t: d }); this.events.push({ type: "cc", tgt: t.id, label: "破甲" }); } return; }
      case "def_up": { const v = parseFloat(e.args[0]), d = parseFloat(e.args[1] || 2); caster.buffs.push({ field: "def", val: v, t: d }); return; }
      case "block_up": { const v = parseFloat(e.args[0]), d = parseFloat(e.args[1] || 2); caster.buffs.push({ field: "block", val: v, t: d }); return; }
      case "dodge_up": { const v = parseFloat(e.args[0]), d = parseFloat(e.args[1] || 2); caster.buffs.push({ field: "dodge", val: v, t: d }); return; }
      case "buff": { const f = e.args[0], v = parseFloat(e.args[1]), d = parseFloat(e.args[2] || 1); const tgt = pool[0] && pool[0].side === selfSide ? pool[0] : caster; tgt.buffs.push({ field: f, val: v, t: d }); return; }
      case "debuff_mgc": { const v = parseFloat(e.args[0]), d = parseFloat(e.args[1] || 2); for (const t of pool) if (t.alive) t.buffs.push({ field: "mgc", val: -v, t: d }); return; }
      case "dispel": { const n = parseInt(e.args[0], 10); for (const t of pool) { if (!t.alive) continue; for (const k of ["stun", "paralyze", "sleep", "bind"]) t.cc[k] = 0; let c = 0; for (let i = t.buffs.length - 1; i >= 0 && c < n; i--) if (t.buffs[i].val < 0) { t.buffs.splice(i, 1); c++; } this.events.push({ type: "buffself", unit: t.id, label: "驱散" }); } return; }
      case "revive": { const v = parseFloat(e.args[0]); const deadId = this.deaths[selfSide].pop(); if (deadId) { const d = this.byId(deadId); if (d) { d.alive = true; d.hp = Math.round(d.maxHp * v); d.rage = 0; this.events.push({ type: "revive", tgt: d.id }); } } return; }
      case "taunt": caster.taunt = Math.max(caster.taunt, parseFloat(e.args[0])); this.events.push({ type: "buffself", unit: caster.id, label: "嘲讽" }); return;
      case "silence_all": { const n = parseFloat(e.args[0]); for (const t of this.enemiesOf(selfSide)) if (t.alive) { t.silence = Math.max(t.silence, n); this.events.push({ type: "cc", tgt: t.id, label: "沉默" }); } return; }
      case "hot_aura": this.teamHot[selfSide] = Math.max(this.teamHot[selfSide], parseFloat(e.args[0])); return;
      case "lifesteal": caster.lifesteal = Math.max(caster.lifesteal, parseFloat(e.args[0])); return;
      case "haste": { const v = parseFloat(e.args[0]), d = parseFloat(e.args[1] || 2); caster.buffs.push({ field: "haste", val: v, t: d }); return; }
      case "guard": { const n = parseFloat(e.args[0] || 1); caster.buffs.push({ field: "def", val: 0.3, t: n }); caster.taunt = Math.max(caster.taunt, n); return; }
      case "counter": case "move_mod": case "av_mod": case "extra_action": case "summon": case "aura": case "steal_buff": case "poison": case "burn": case "bleed": case "teleport": case "swap_position": case "pull_to_front": case "random_buff":
        return; // 横版原型暂不实现，安全忽略
      default: return;
    }
  }

  _firePassives(owner, trigger, target) {
    if (!owner.alive || !owner.passives) return;
    for (const p of owner.passives) {
      if (p.trigger !== trigger) continue;
      const t = trigger === "turn_start" ? owner : (target && target.alive ? target : owner);
      this.events.push({ type: "passive", unit: owner.id, name: p.name });
      this._exec(owner, p.parsed, [t], {});
    }
  }
  _fireAwaken(u) {
    u.awakenFired = true;
    this.events.push({ type: "awaken", unit: u.id, name: u.awaken.name });
    const targets = this._awakenTargets(u);
    this._exec(u, u.awaken.parsed, targets, { awaken: true });
  }
  _awakenTargets(u) {
    // 觉醒技默认作用于自身（buff/taunt/lifesteal/hot_aura 等自我/团队效果），伤害类则取敌方
    const hasHarm = u.awaken.parsed.some((e) => e.name === "phys_dmg" || e.name === "mgc_dmg" || e.name === "silence_all");
    return hasHarm ? this.enemiesOf(u.side) : [u];
  }

  _resolveTargets(caster, skill) {
    const scope = skill.scope || "single";
    const enemies = this.enemiesOf(caster.side);
    const allies = this.alliesOf(caster.side);
    if (scope === "self") return [caster];
    if (scope === "allies") return allies;
    if (!enemies.length) return [];
    if (scope === "single") { const t = this._pickTarget(caster); return t ? [t] : []; }
    if (scope === "single_lowest") return [enemies.slice().sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0]];
    if (scope === "aoe_front") { const f = enemies.filter((e) => e.row === "front"); return f.length ? f : enemies; }
    if (scope === "aoe_all") return enemies;
    return [this._pickTarget(caster)].filter(Boolean);
  }
  _castSmall(u) {
    if (!u.small) return;
    const targets = this._resolveTargets(u, u.small);
    this.events.push({ type: "smallfx", unit: u.id, name: u.small.name });
    this._exec(u, u.small.parsed, targets, {});
    u.rage = clamp(u.rage + 10, 0, 100); // 施放小技能回怒
  }

  castUlt(u) {
    if (!u.alive || u.rage < 100 || u.silence > 0 || this.winner >= 0 || !u.ult) return false;
    u.rage = 0;
    // 大招连锁（玩家侧）
    let chainMult = 1;
    if (u.side === 0) {
      if (this.chain.timer > 0) this.chain.count++; else this.chain.count = 1;
      this.chain.timer = CHAIN_WINDOW;
      chainMult = 1 + CHAIN_BONUS * (this.chain.count - 1);
      this.events.push({ type: "chain", count: this.chain.count });
    }
    this.events.push({ type: "ult", unit: u.id, name: u.ultName, cls: u.cls });
    const targets = this._resolveTargets(u, u.ult);
    this._exec(u, u.ult.parsed, targets, { chainMult });
    // on_ult 觉醒技
    if (u.awaken && !u.awakenFired && u.awaken.trigger === "on_ult") this._fireAwaken(u);
    this._checkEnd();
    return true;
  }

  _checkEnd() {
    if (this.winner >= 0) return;
    if (!this.units.some((u) => u.alive && u.side === 0)) this.winner = 1;
    else if (!this.units.some((u) => u.alive && u.side === 1)) this.winner = 0;
  }
}

const MODIFIER_ONLY = new Set(["sure_hit", "hit_rate", "chance", "bonus_by_self_lost_hp", "bonus_vs_elite", "bonus_vs_high_def", "bonus_vs_cavalry", "execute_below", "target_rule", "random_target", "friendly_fire", "refresh_on_kill", "extra_action"]);
const CC_LABEL = { stun: "眩晕", sleep: "沉睡", paralyze: "麻痹", bind: "束缚" };
