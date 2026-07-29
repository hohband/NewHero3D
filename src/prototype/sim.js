// 横版自动战斗 · 纯逻辑层（无 three.js / DOM，可 node 无头跑）
// 数据来自 data.js（units/skills/awaken/growth_curve 装配）；数值常量全部来自 battle_constants.csv（teams.consts）
// 复用 shared 的 scanModifiers 解析修正类效果；随机走注入 RNG；定长 tick；产事件数组供表现层回放
// 波次制：teams.waves 逐波刷敌，清完按 spawn_delay 出下一波；我方 HP/怒气/buff 跨波继承，阵亡不复活
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

// 常量默认值（与 battle_constants.csv 对齐；CSV 缺键时兜底，保证旧测试/最小装配可跑）
const CONST_DEFAULTS = {
  rage_on_hit: 20, rage_on_hit_taken: 10, rage_on_kill: 30,
  rage_on_skill: 10, rage_on_heal: 12, rage_refresh_kill: 50,
  chain_window: 3.0, chain_bonus: 0.2, row_back_mod: -0.10,
  battle_hp_scale: 1.0, dot_pct_per_sec: 0.02, bond_stat_bonus: 5,
};

// 觉醒技目标推断：含伤害/减益类效果 → 作用于敌方，否则作用于自身/友军
const HARM_EFFECTS = new Set([
  "phys_dmg", "mgc_dmg", "silence_all", "silence", "stun", "sleep", "sleep_chance",
  "paralyze", "bind", "armor_break", "debuff_mgc", "poison", "burn", "bleed",
  "expose", "pull_to_front", "knockback", "pull", "energy_drain", "heal_cut",
]);
// 持续伤害类效果（dot）：poison/burn/bleed(n) = n 秒
const DOT_EFFECTS = new Set(["poison", "burn", "bleed"]);

export class Unit {
  constructor(cfg, side, rng, consts) {
    Object.assign(this, cfg); // id,name,cls,archetype,row,slot,quality,tier,level,hp,atk,def,mgc,spd,crit,dodge,block,bonds,small,ult,passives,awaken,ultName
    this.side = side;
    const scale = consts.battle_hp_scale;
    this.maxHp = Math.round(cfg.hp * scale); this.hp = this.maxHp;
    this.baseRow = cfg.row;
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
    this.shield = 0;           // 吸收盾池（先于 hp 扣除）
    this.invulnT = 0;          // 锁血剩余秒数
    this.counterT = 0;         // 反击状态剩余秒数
    this.exposeT = 0;          // 被暴露到前排剩余秒数
    this.dashed = false;       // 已突进敌后排（无视前排阻挡）
    this.hotAura = 0; this.lifesteal = 0; this.executeBelow = 0;
    this.awakenFired = false; this.turnTimer = 2.0;
    this.ultDelay = -1; this._lunge = 0;
    this._bonded = new Set();  // 已生效羁绊对象 id
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
  get healTaken() { return 1 - clamp(this._buffSum("heal_cut"), 0, 0.9); } // 减疗乘区
}

export class Sim {
  constructor(teams, seed = 20260727) {
    this.rng = makeRNG(seed);
    this.consts = { ...CONST_DEFAULTS, ...(teams.consts || {}) };
    this.prog = teams.prog || {};
    this.units = [];
    this.events = [];
    this.time = 0; this.winner = -1; this.focusId = null;
    this.deaths = { 0: [], 1: [] };
    this.teamHot = { 0: 0, 1: 0 };
    this.chain = { count: 0, timer: 0 };
    this._chainMult = 1;
    this.autoUlt = false;      // 玩家侧托管开关（表现层切换）
    // 波次
    this.waves = teams.waves || [teams.enemy];
    this.spawnDelays = teams.spawnDelays || this.waves.map(() => 0);
    this.waveIndex = 0;
    this._pendingWave = -1;    // 待刷新的波次序号（-1=无）
    this._spawnT = 0;
    this._rows = { 0: { front: -3.2, back: -5.4 }, 1: { front: 3.2, back: 5.4 } };
    for (const c of teams.player) this.units.push(new Unit(c, 0, this.rng, this.consts));
    this._spawnWaveCfgs(this.waves[0]);
    this._layout(0); this._layout(1);
    this._applyBonds(0); this._applyBonds(1);
    this._startBattle();
  }

  // ---------- 布阵 / 波次 ----------
  _fireEntryAwakens(units) {
    for (const u of units) {
      if (!u.awaken || u.awakenFired) continue;
      if (u.awaken.trigger === "battle_start") this._fireAwaken(u);
      else if (u.awaken.trigger === "always") { u.awakenFired = true; this._exec(u, u.awaken.parsed, [u], { awaken: true, effectMult: u.awaken.effectMult || 1 }); }
    }
  }
  _startBattle() { this._fireEntryAwakens(this.units); }
  _spawnWaveCfgs(cfgs) {
    for (const c of cfgs) this.units.push(new Unit(c, 1, this.rng, this.consts));
  }
  _layout(side) {
    const rows = this._rows[side];
    for (const rowName of ["front", "back"]) {
      const group = this.units
        .filter((u) => u.side === side && u.alive && u.baseRow === rowName && !u.dashed)
        .sort((a, b) => a.slot - b.slot);
      group.forEach((u, i) => {
        u.x = rows[rowName];
        u.z = (i - (group.length - 1) / 2) * (rowName === "front" ? 1.5 : 1.7);
      });
    }
  }
  _startNextWave() {
    this._pendingWave = -1;
    this.waveIndex++;
    this._spawnWaveCfgs(this.waves[this.waveIndex]);
    this._layout(1);
    this._applyBonds(1);
    // 新波次的 battle_start / always 觉醒
    this._fireEntryAwakens(this.units.filter((u) => u.side === 1 && u.alive));
    this.events.push({ type: "wave_spawn", wave: this.waveIndex + 1, total: this.waves.length });
  }

  // ---------- 羁绊：同队双方在场 → 攻防 +bond_stat_bonus%（永久） ----------
  _applyBonds(side) {
    const bonus = (this.prog.bond_stat_bonus ?? this.consts.bond_stat_bonus) / 100;
    if (!bonus) return;
    const mine = this.units.filter((u) => u.side === side && u.alive);
    for (const u of mine) {
      for (const b of u.bonds || []) {
        const partner = mine.find((p) => p.id === b.target);
        if (!partner || u._bonded.has(partner.id)) continue;
        u._bonded.add(partner.id); partner._bonded.add(u.id);
        for (const t of [u, partner]) {
          t.buffs.push({ field: "atk", val: bonus, t: 999 });
          t.buffs.push({ field: "def", val: bonus, t: 999 });
        }
        this.events.push({ type: "bond", a: u.id, b: partner.id, name: b.name });
      }
    }
  }

  byId(id) { return this.units.find((u) => u.id === id); }
  enemiesOf(side) { return this.units.filter((u) => u.alive && u.side !== side); }
  alliesOf(side) { return this.units.filter((u) => u.alive && u.side === side); }
  frontAlive(side) { return this.units.some((u) => u.alive && u.side === side && u.row === "front"); }
  get waveInfo() { return { wave: this.waveIndex + 1, total: this.waves.length, pending: this._pendingWave >= 0 }; }

  step(dt) {
    if (this.winner >= 0) return;
    this.time += dt;
    this.chain.timer = Math.max(0, this.chain.timer - dt);
    if (this.chain.timer === 0) this.chain.count = 0;
    // 波次刷新计时
    if (this._pendingWave >= 0) {
      this._spawnT -= dt;
      if (this._spawnT <= 0) this._startNextWave();
    }
    for (const u of this.units) {
      if (!u.alive) continue;
      for (const k of ["stun", "paralyze", "sleep", "bind"]) u.cc[k] = Math.max(0, u.cc[k] - dt);
      u.silence = Math.max(0, u.silence - dt);
      u.taunt = Math.max(0, u.taunt - dt);
      u.invulnT = Math.max(0, u.invulnT - dt);
      u.counterT = Math.max(0, u.counterT - dt);
      if (u.exposeT > 0) { u.exposeT -= dt; if (u.exposeT <= 0) u.row = u.baseRow; }
      for (let i = u.buffs.length - 1; i >= 0; i--) { u.buffs[i].t -= dt; if (u.buffs[i].t <= 0) u.buffs.splice(i, 1); }
      // 团队治疗光环
      if (this.teamHot[u.side] > 0) u.hp = Math.min(u.maxHp, u.hp + u.maxHp * this.teamHot[u.side] * dt * u.healTaken);
      // 持续伤害（毒/灼烧/流血）
      const dot = u._buffSum("dot");
      if (dot > 0) this._damage(null, u, Math.max(1, Math.round(u.maxHp * dot * dt)), { dot: true });
      if (!u.alive) continue;
      // 觉醒技：血量阈值
      if (u.awaken && !u.awakenFired && u.awaken.trigger === "hp_below" && u.hp / u.maxHp <= u.awaken.param) this._fireAwaken(u);
      // 大招：敌方 AI 门控 / 玩家托管
      if (u.rage >= 100 && u.silence <= 0 && u.ultDelay < 0) {
        if (u.side === 1 && this._enemyUltGate(u)) u.ultDelay = 0.8;
        else if (u.side === 0 && this.autoUlt && this._autoUltGate(u)) this.castUlt(u);
      }
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
    const amount = Math.round(u.effMgc * 0.9 * tgt.healTaken);
    tgt.hp = Math.min(tgt.maxHp, tgt.hp + amount);
    u.rage = clamp(u.rage + this.consts.rage_on_heal, 0, 100);
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
    if (u.isMelee && !u.dashed && this.frontAlive(1 - u.side)) pool = enemies.filter((e) => e.row === "front");
    const taunters = pool.filter((e) => e.taunt > 0);
    if (taunters.length) pool = taunters;
    if (u.side === 0 && this.focusId) {
      const f = pool.find((e) => e.id === this.focusId) || enemies.find((e) => e.id === this.focusId);
      if (f && (!u.isMelee || u.dashed || f.row === "front" || !this.frontAlive(1))) return f;
    }
    let best = null, bs = -1e9;
    for (const e of pool) {
      let score = -(Math.abs(e.x - u.x) * 2 + Math.abs(e.z - u.z));
      score += this._counterScore(u, e) + (1 - e.hp / e.maxHp) * 2;
      if (score > bs) { bs = score; best = e; }
    }
    return best;
  }

  // —— 大招 AI 门控（敌方 + 玩家托管共用规则，按技能构成推断，不写死 id） ——
  _ultKind(u) {
    if (!u.ult) return "none";
    const names = u.ult.parsed.map((e) => e.name);
    if (names.some((n) => n === "heal" || n === "revive")) return "heal";
    if (names.some((n) => n === "phys_dmg" || n === "mgc_dmg")) return "damage";
    return "defense"; // taunt/shield/def_up/cc/增益类
  }
  _enemyUltGate(u) {
    const kind = this._ultKind(u);
    if (kind === "none") return false;
    if (kind === "heal") {
      // 奶妈留大：有友军残血或已阵亡才放
      return this.deaths[u.side].length > 0 || this.alliesOf(u.side).some((a) => a.hp / a.maxHp < 0.7);
    }
    if (kind === "defense") return u.hp / u.maxHp < 0.5; // 防御性大招：自身半血以下才放
    // 输出大招：可斩杀即放；我方无人蓄大（无反制压力）即放；自身危急即放；否则留大
    const mult = parseFloat(u.ult.parsed.find((e) => e.name === "phys_dmg" || e.name === "mgc_dmg")?.args[0] || 1);
    const est = u.attackStat * mult * 0.9;
    if (this.enemiesOf(u.side).some((t) => t.hp <= est)) return true;
    if (!this.enemiesOf(u.side).some((t) => t.rage >= 90)) return true;
    return u.hp / u.maxHp < 0.4;
  }
  _autoUltGate(u) {
    const kind = this._ultKind(u);
    if (kind === "heal") {
      return this.deaths[u.side].length > 0 || this.alliesOf(u.side).some((a) => a.hp / a.maxHp < 0.7);
    }
    if (kind === "defense") return u.hp / u.maxHp < 0.5;
    return true;
  }

  // —— 伤害计算：闪避/暴击/格挡/前后排/易伤/连锁 ——
  _computeDmg(att, tgt, mult, { magic = false, sureHit = false, chainMult = 1 } = {}) {
    if (!sureHit && this.rng() < tgt.effDodge / 100) return { dodged: true };
    let base = (att.attackStat * 100) / (100 + tgt.effDef);
    if (tgt.row === "back") base *= 1 + this.consts.row_back_mod;
    base *= 1 + tgt._buffSum("taken"); // 易伤（expose 等）
    const crit = this.rng() < att.effCrit / 100;
    if (crit) base *= 1.5;
    let blocked = false;
    if (this.rng() < tgt.effBlock / 100) { base *= 0.7; blocked = true; }
    const dmg = Math.max(1, Math.round(base * mult * chainMult * (0.92 + this.rng() * 0.16)));
    return { dmg, crit, blocked, magic, chainMult };
  }
  _damage(att, tgt, dmg, opts = {}) {
    if (!tgt.alive || dmg <= 0 && !opts.executeBelow) return;
    if (att && (att.executeBelow > 0 || opts.executeBelow) && tgt.hp / tgt.maxHp <= (opts.executeBelow || att.executeBelow)) {
      dmg = tgt.hp; opts = { ...opts, executed: true };
    }
    // 锁血：invuln_dying 期间最低 1 血
    if (tgt.invulnT > 0 && tgt.hp - dmg < 1) dmg = Math.max(0, tgt.hp - 1);
    // 吸收盾先扣
    if (dmg > 0 && tgt.shield > 0) {
      const absorbed = Math.min(tgt.shield, dmg);
      tgt.shield -= absorbed; dmg -= absorbed;
      this.events.push({ type: "shield", tgt: tgt.id, absorbed, left: Math.round(tgt.shield) });
    }
    if (dmg > 0) {
      tgt.hp -= dmg;
      tgt.rage = clamp(tgt.rage + this.consts.rage_on_hit_taken, 0, 100);
      if (att && att.lifesteal > 0) att.hp = Math.min(att.maxHp, att.hp + Math.round(dmg * att.lifesteal));
    }
    this.events.push({ type: "damage", tgt: tgt.id, amount: dmg, ...opts });
    if (att && !opts.noCounter) this._firePassives(tgt, "on_hit", att);
    // 反击状态：受击立即回击（物攻 50%，必中，不连锁反击）
    if (att && tgt.alive && tgt.counterT > 0 && !opts.noCounter && !opts.dot && att.side !== tgt.side) {
      const r = this._computeDmg(tgt, att, 0.5, { sureHit: true });
      if (!r.dodged) { this.events.push({ type: "counter", src: tgt.id, tgt: att.id }); this._damage(tgt, att, r.dmg, { noCounter: true }); }
    }
    if (tgt.hp <= 0) {
      tgt.hp = 0; tgt.alive = false;
      this.deaths[tgt.side].push(tgt.id);
      if (att) att.rage = clamp(att.rage + this.consts.rage_on_kill, 0, 100);
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
    att.rage = clamp(att.rage + this.consts.rage_on_hit, 0, 100);
    this._firePassives(att, "on_attack", tgt);
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
    if (mods.refresh_on_kill) {
      const killedNow = this.deaths[0].concat(this.deaths[1]).some((id) => !killedBefore.has(id));
      if (killedNow) { caster.rage = clamp(caster.rage + this.consts.rage_refresh_kill, 0, 100); caster.atkTimer = 0; this.events.push({ type: "buffself", unit: caster.id, label: "连杀" }); }
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
    if (mods.bonus_vs_elite && t.cls === "vanguard") m *= 1 + mods.bonus_vs_elite;
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
          const amount = Math.round(caster.attackStat * mult * t.healTaken);
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
      case "pull_to_front": {
        // 把目标拽到其前排线并视为前排（持续本场）
        for (const t of pool) if (t.alive) {
          t.baseRow = "front"; t.row = "front"; t.x = this._rows[t.side].front;
          this.events.push({ type: "cc", tgt: t.id, label: "拖拽" });
        }
        return;
      }
      case "expose": {
        const d = parseFloat(e.args[0] || 4), v = parseFloat(e.args[1] || 0.25);
        for (const t of pool) if (t.alive) {
          t.exposeT = Math.max(t.exposeT, d); t.row = "front";
          t.buffs.push({ field: "taken", val: v, t: d });
          this.events.push({ type: "cc", tgt: t.id, label: "暴露" });
        }
        return;
      }
      case "dash_back": {
        caster.dashed = true;
        const dir = caster.side === 0 ? 1 : -1;
        caster.x = this._rows[1 - caster.side].back + dir * 0.8;
        this.events.push({ type: "dash", unit: caster.id });
        return;
      }
      case "silence": {
        const n = parseFloat(e.args[0]);
        for (const t of pool) if (t.alive) { t.silence = Math.max(t.silence, n); this.events.push({ type: "cc", tgt: t.id, label: "沉默" }); }
        return;
      }
      case "silence_all": {
        const n = parseFloat(e.args[0]);
        for (const t of this.enemiesOf(selfSide)) if (t.alive) { t.silence = Math.max(t.silence, n); this.events.push({ type: "cc", tgt: t.id, label: "沉默" }); }
        return;
      }
      case "shield": {
        const v = parseFloat(e.args[0]);
        caster.shield += Math.round(caster.maxHp * v);
        this.events.push({ type: "buffself", unit: caster.id, label: "护盾" });
        return;
      }
      case "energy_drain": {
        const v = parseFloat(e.args[0]);
        const foes = this.enemiesOf(selfSide);
        const friends = this.alliesOf(selfSide);
        if (!foes.length || !friends.length) return;
        const from = foes.slice().sort((a, b) => b.rage - a.rage)[0];
        const to = friends.slice().sort((a, b) => a.rage - b.rage)[0];
        const drained = Math.min(from.rage, v);
        from.rage -= drained; to.rage = clamp(to.rage + drained, 0, 100);
        this.events.push({ type: "drain", from: from.id, to: to.id, amount: drained });
        return;
      }
      case "act_now": {
        const n = parseInt(e.args[0] || 1, 10);
        const friends = this.alliesOf(selfSide).filter((a) => a !== caster)
          .sort((a, b) => b.attackStat - a.attackStat).slice(0, n);
        for (const f of friends) { f.atkTimer = 0; this.events.push({ type: "actnow", unit: f.id }); }
        return;
      }
      case "invuln_dying": {
        caster.invulnT = Math.max(caster.invulnT, parseFloat(e.args[0]));
        this.events.push({ type: "buffself", unit: caster.id, label: "锁血" });
        return;
      }
      case "heal_cut": {
        const v = parseFloat(e.args[0]), d = parseFloat(e.args[1] || 3);
        for (const t of pool) if (t.alive) { t.buffs.push({ field: "heal_cut", val: v, t: d }); this.events.push({ type: "cc", tgt: t.id, label: "减疗" }); }
        return;
      }
      case "counter": {
        caster.counterT = Math.max(caster.counterT, parseFloat(e.args[0] || 1));
        this.events.push({ type: "buffself", unit: caster.id, label: "反击" });
        return;
      }
      case "steal_buff": {
        const n = parseInt(e.args[0] || 1, 10);
        for (const t of pool) {
          if (!t.alive) continue;
          let stolen = 0;
          for (let i = t.buffs.length - 1; i >= 0 && stolen < n; i--) {
            if (t.buffs[i].val > 0 && t.buffs[i].field !== "dot") {
              caster.buffs.push({ ...t.buffs[i] });
              t.buffs.splice(i, 1); stolen++;
            }
          }
          if (stolen) this.events.push({ type: "steal", from: t.id, to: caster.id, count: stolen });
        }
        return;
      }
      case "aura": {
        // 横版光环 = 全队永久增益："aura(atk+0.15,def+0.15,r3)"；hot → 团队治疗光环
        for (const spec of e.args) {
          const m = String(spec).match(/^([a-z_]+)\+(-?[\d.]+)$/);
          if (!m || m[1] === "r") continue;
          const field = m[1], val = parseFloat(m[2]);
          if (field === "hot") { this.teamHot[selfSide] = Math.max(this.teamHot[selfSide], val); continue; }
          for (const a of this.alliesOf(selfSide)) a.buffs.push({ field, val, t: 999 });
        }
        this.events.push({ type: "buffself", unit: caster.id, label: "光环" });
        return;
      }
      case "poison": case "burn": case "bleed": {
        const d = parseFloat(e.args[0]);
        for (const t of pool) if (t.alive) {
          t.buffs.push({ field: "dot", val: this.consts.dot_pct_per_sec, t: d });
          this.events.push({ type: "cc", tgt: t.id, label: DOT_LABEL[e.name] });
        }
        return;
      }
      case "armor_break": { const v = parseFloat(e.args[0]), d = parseFloat(e.args[1] || 2); for (const t of pool) if (t.alive) { t.buffs.push({ field: "def", val: -v, t: d }); this.events.push({ type: "cc", tgt: t.id, label: "破甲" }); } return; }
      case "def_up": { const v = parseFloat(e.args[0]), d = parseFloat(e.args[1] || 2); caster.buffs.push({ field: "def", val: v, t: d }); return; }
      case "block_up": { const v = parseFloat(e.args[0]), d = parseFloat(e.args[1] || 2); caster.buffs.push({ field: "block", val: v, t: d }); return; }
      case "dodge_up": { const v = parseFloat(e.args[0]), d = parseFloat(e.args[1] || 2); caster.buffs.push({ field: "dodge", val: v, t: d }); return; }
      case "buff": { const f = e.args[0], v = parseFloat(e.args[1]), d = parseFloat(e.args[2] || 1); const tgt = pool[0] && pool[0].side === selfSide ? pool[0] : caster; tgt.buffs.push({ field: f, val: v, t: d }); return; }
      case "debuff_mgc": { const v = parseFloat(e.args[0]), d = parseFloat(e.args[1] || 2); for (const t of pool) if (t.alive) t.buffs.push({ field: "mgc", val: -v, t: d }); return; }
      case "dispel": { const n = parseInt(e.args[0], 10); for (const t of pool) { if (!t.alive) continue; for (const k of ["stun", "paralyze", "sleep", "bind"]) t.cc[k] = 0; let c = 0; for (let i = t.buffs.length - 1; i >= 0 && c < n; i--) if (t.buffs[i].val < 0) { t.buffs.splice(i, 1); c++; } this.events.push({ type: "buffself", unit: t.id, label: "驱散" }); } return; }
      case "revive": { const v = parseFloat(e.args[0]); const deadId = this.deaths[selfSide].pop(); if (deadId) { const d = this.byId(deadId); if (d) { d.alive = true; d.hp = Math.round(d.maxHp * v); d.rage = 0; this.events.push({ type: "revive", tgt: d.id }); } } return; }
      case "taunt": caster.taunt = Math.max(caster.taunt, parseFloat(e.args[0])); this.events.push({ type: "buffself", unit: caster.id, label: "嘲讽" }); return;
      case "hot_aura": this.teamHot[selfSide] = Math.max(this.teamHot[selfSide], parseFloat(e.args[0])); return;
      case "lifesteal": caster.lifesteal = Math.max(caster.lifesteal, parseFloat(e.args[0])); return;
      case "haste": { const v = parseFloat(e.args[0]), d = parseFloat(e.args[1] || 2); const tgts = pool.length && pool[0].side === selfSide ? pool : [caster]; for (const t of tgts) if (t.alive) t.buffs.push({ field: "haste", val: v, t: d }); return; }
      case "guard": { const n = parseFloat(e.args[0] || 1); caster.buffs.push({ field: "def", val: 0.3, t: n }); caster.taunt = Math.max(caster.taunt, n); return; }
      case "move_mod": case "av_mod": case "extra_action": case "summon": case "swap_position": case "teleport": case "random_buff":
        return; // 横版无对应概念（act_now/haste/dash_back/expose 已分别替代），安全忽略
      default: return;
    }
  }

  _firePassives(owner, trigger, target) {
    if (!owner.alive || !owner.passives) return;
    for (const p of owner.passives) {
      if (p.trigger !== trigger) continue;
      const t = trigger === "turn_start" ? owner : (target && target.alive ? target : owner);
      this.events.push({ type: "passive", unit: owner.id, name: p.name });
      this._exec(owner, p.parsed, [t], { effectMult: p.effectMult || 1 });
    }
  }
  _fireAwaken(u) {
    u.awakenFired = true;
    this.events.push({ type: "awaken", unit: u.id, name: u.awaken.name });
    const targets = this._awakenTargets(u);
    this._exec(u, u.awaken.parsed, targets, { awaken: true, effectMult: u.awaken.effectMult || 1 });
  }
  _awakenTargets(u) {
    const hasHarm = u.awaken.parsed.some((e) => HARM_EFFECTS.has(e.name));
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
    this._exec(u, u.small.parsed, targets, { effectMult: u.small.effectMult || 1 });
    u.rage = clamp(u.rage + this.consts.rage_on_skill, 0, 100);
  }

  castUlt(u) {
    if (!u.alive || u.rage < 100 || u.silence > 0 || this.winner >= 0 || !u.ult) return false;
    u.rage = 0;
    let chainMult = 1;
    if (u.side === 0) {
      if (this.chain.timer > 0) this.chain.count++; else this.chain.count = 1;
      this.chain.timer = this.consts.chain_window;
      chainMult = 1 + this.consts.chain_bonus * (this.chain.count - 1);
      this.events.push({ type: "chain", count: this.chain.count });
    }
    this.events.push({ type: "ult", unit: u.id, name: u.ultName, cls: u.cls });
    const targets = this._resolveTargets(u, u.ult);
    this._exec(u, u.ult.parsed, targets, { chainMult, effectMult: u.ult.effectMult || 1 });
    if (u.awaken && !u.awakenFired && u.awaken.trigger === "on_ult") this._fireAwaken(u);
    this._checkEnd();
    return true;
  }

  _checkEnd() {
    if (this.winner >= 0) return;
    if (!this.units.some((u) => u.alive && u.side === 0)) { this.winner = 1; return; }
    if (!this.units.some((u) => u.alive && u.side === 1)) {
      if (this.waveIndex < this.waves.length - 1) {
        if (this._pendingWave < 0) {
          this._pendingWave = this.waveIndex + 1;
          this._spawnT = this.spawnDelays[this._pendingWave] ?? 0;
          this.events.push({ type: "wave_clear", wave: this.waveIndex + 1, total: this.waves.length, delay: this._spawnT });
        }
      } else this.winner = 0;
    }
  }
}

const MODIFIER_ONLY = new Set(["sure_hit", "hit_rate", "chance", "bonus_by_self_lost_hp", "bonus_vs_elite", "bonus_vs_high_def", "bonus_vs_cavalry", "execute_below", "target_rule", "random_target", "friendly_fire", "refresh_on_kill", "extra_action"]);
const CC_LABEL = { stun: "眩晕", sleep: "沉睡", paralyze: "麻痹", bind: "束缚" };
const DOT_LABEL = { poison: "中毒", burn: "灼烧", bleed: "流血" };
