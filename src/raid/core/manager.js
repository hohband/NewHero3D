// 劫寨 RealTimeBattleManager —— 实时战斗核心（替代 SRPG 回合制 BattleManager）
// 20Hz 固定步长；逻辑瞬时结算，事件数组供表现层回放；node 可独立运行。
import { RaidGrid } from "./grid.js";
import { makeHero, makeEnemy, makeBoss, makeSentry, makeSummon } from "./units.js";
import { HEROES, BUILDINGS, LEVEL, SCORING, LOOT, RELIEF, SKILL_FX, FOG, WEATHERS, WEATHER_IDS, DECOY, ORDERS_META } from "./data.js";
import { keyOf, manhattan } from "../../core/coords.js";

const STEP = 1 / 20; // 50ms

export class RealTimeBattleManager {
  constructor(roll) {
    this.roll = roll;                  // RollSource
    this.grid = null;
    this.units = [];                   // 所有实时单位（双方 + 援军 + 哨兵）
    this.buildings = [];               // 建筑实体
    this.traps = [];
    this.time = 0;
    this.elapsed = 0;                  // 战斗计时（不含侦查期）
    this.phase = "scout";              // scout|battle|end
    this.events = [];
    // 资源
    this.bingfu = LEVEL.bingfu;
    this.liangcao = LEVEL.liangcao;
    this.deployedHeroes = new Map();   // heroId -> {cost, redeployUntil, alive, everDeployed}
    this.lastDeployTime = -99;
    this.summonCount = 0;
    this.patrols = [];
    this.squads = [];                  // 编队槽（heroId 列表，最多 8）
    // 警报
    this.alertLevel = 0;
    this.breachCount = { };            // 被破墙方向统计（东/南/西/北门）
    // 结果
    this.result = null;
    this.looted = 0;                   // 已劫掠到的资源
    this.flowDirty = true;
    this._acc = 0;
    this._endEmitted = false;
    // v2 涌现：天气 / 迷雾 / 号令 / 诱饵
    this.weather = WEATHERS.clear;
    this.fireMult = 1.0;               // 火攻计号令
    this.deployStealth = 0;            // 夜行衣号令
    this.order = null;                 // 已选号令 id
    this.visibleTiles = new Set();     // 迷雾：当前可见格
    this.decoys = [];
  }

  // 随机天气（开局）
  rollWeather() {
    const idx = Math.floor((this.roll.roll() / 100) * WEATHER_IDS.length) % WEATHER_IDS.length;
    this.weather = WEATHERS[WEATHER_IDS[idx]];
    this.events.push({ t: "weather", weather: this.weather });
    return this.weather;
  }
  setWeather(id) { this.weather = WEATHERS[id] || WEATHERS.clear; }

  // 选择号令
  chooseOrder(orderId) {
    const o = ORDERS_META[orderId];
    if (!o) return false;
    this.order = orderId;
    o.apply(this);
    this.events.push({ t: "order_chosen", order: o });
    return true;
  }

  // 天气修正：移速 / 视野 / 射程
  moveMult() { return this.weather.moveMult; }
  visionOf(u) {
    let v = u.range > 1 ? FOG.visionRanged : FOG.visionMelee;
    if (u.id === "shiqian") v = FOG.visionShiqian;
    return Math.max(2, v + this.weather.visionMod);
  }
  rangeOf(u) { return Math.max(1, u.range + (u.team === 0 ? this.weather.rangeMod : 0)); }

  // 综合潜行判定：雪天足迹暴露（潜行失效）；雾天增强（更难被发现）
  _isHidden(u) {
    if (!u.isStealthed(this.time)) return false;
    if (this.weather.footprints) return false; // 雪天足迹暴露潜行
    return true;
  }

  // ---------- 初始化 ----------
  loadLevel() {
    const L = LEVEL;
    this.grid = new RaidGrid(L.w, L.h);
    for (let y = 0; y < L.h; y++) for (let x = 0; x < L.w; x++) this.grid.ensure(x, y);
    // 建筑
    for (const b of L.buildings) {
      const def = BUILDINGS[b.type];
      const cell = this.grid.ensure(b.x, b.y);
      const ent = { uid: "b" + b.x + "_" + b.y, def, type: b.type, x: b.x, y: b.y, hp: def.hp, maxHp: def.hp, kind: def.kind, star2: def.star2, attackCd: 0, destroyed: false };
      this.buildings.push(ent);
      if (def.kind === "wall") cell.wall = ent;
      else if (def.kind === "trap") { cell.trap = ent; this.traps.push(ent); }
      else cell.building = ent;
    }
    // 守军
    for (const d of L.defenders) {
      let u;
      if (d.type === "sentry") u = makeSentry(d.x, d.y);
      else if (d.type === "boss_zhulong") u = makeBoss(d.type, d.x, d.y);
      else u = makeEnemy(d.type, d.x, d.y);
      this._place(u);
      this.units.push(u);
      if (u.isBoss) this.boss = u;
    }
    // 巡逻队
    for (const p of L.patrols) {
      const members = [];
      for (let i = 0; i < p.size; i++) {
        const u = makeEnemy(p.type, p.route[0].x + i, p.route[0].y);
        u.patrol = { route: p.route, idx: 0, alarm: false };
        this._place(u); this.units.push(u); members.push(u);
      }
      this.patrols.push({ id: p.id, members, alerted: false });
    }
    this.core = this.buildings.find(b => b.kind === "core");
    this._recomputeFlow();
    this._updateFog();
  }

  // ---------- 战争迷雾 ----------
  _updateFog() {
    if (!FOG.enabled) return;
    this.visibleTiles.clear();
    if (this.phase === "scout" && FOG.scoutFullMap) {
      for (let y = 0; y < this.grid.h; y++) for (let x = 0; x < this.grid.w; x++) this.visibleTiles.add(keyOf(x, y));
      return;
    }
    for (const u of this.units) {
      if (u.team !== 0 || !u.alive) continue;
      const v = this.visionOf(u);
      const cx = Math.round(u.x), cy = Math.round(u.y);
      for (let dy = -v; dy <= v; dy++) for (let dx = -v; dx <= v; dx++) {
        if (Math.abs(dx) + Math.abs(dy) > v) continue;
        const nx = cx + dx, ny = cy + dy;
        if (this.grid.inside(nx, ny)) this.visibleTiles.add(keyOf(nx, ny));
      }
    }
  }
  isVisible(x, y) {
    if (!FOG.enabled) return true;
    if (this.phase === "scout" && FOG.scoutFullMap) return true;
    return this.visibleTiles.has(keyOf(Math.round(x), Math.round(y)));
  }

  // ---------- 主动欺骗：诱饵 ----------
  deployDecoy(pos) {
    if (this.phase !== "battle") return null;
    if (this.liangcao < DECOY.liangcaoCost) { this.events.push({ t: "skill_fail", reason: "liangcao" }); return null; }
    this.liangcao -= DECOY.liangcaoCost;
    const d = makeEnemy("zhuangding", pos.x, pos.y);
    d.team = 0; d.name = "草人"; d.isDecoy = true;
    d.hp = DECOY.hp; d.maxHp = DECOY.hp; d.dps = 0; d.decoyUntil = this.time + DECOY.duration;
    this._place(d); this.units.push(d); this.decoys.push(d);
    this.events.push({ t: "decoy", unit: d });
    return d;
  }

  _place(u) {
    const c = this.grid.ensure(Math.round(u.x), Math.round(u.y));
    c.occupant = u;
  }
  _unplace(u) {
    const c = this.grid.cell(Math.round(u.x), Math.round(u.y));
    if (c && c.occupant === u) c.occupant = null;
  }

  // ---------- 流场 ----------
  _recomputeFlow() {
    // 目标 = 核心；阻挡 = 墙/建筑
    const blocked = (x, y) => {
      const c = this.grid.cell(x, y);
      return c && (c.wall || c.building);
    };
    this.flowCore = this.grid.computeFlow([{ x: this.core.x, y: this.core.y }], blocked);
    this.flowDirty = false;
  }

  // ---------- 部署 ----------
  canDeploy(heroId, now) {
    const h = HEROES[heroId];
    if (!h) return { ok: false, reason: "no_hero" };
    if (this.phase !== "battle") return { ok: false, reason: "not_battle_phase" };
    const rec = this.deployedHeroes.get(heroId);
    // 顺序：再部署冷却 -> 同名在场 -> 兵符 -> 在场（M2）
    if (rec && now < rec.redeployUntil) return { ok: false, reason: "redeploy_cd" };
    const liveSame = this.units.some(u => u.kind === "hero" && u.id === heroId && u.alive);
    if (liveSame) return { ok: false, reason: "same_name" };
    if (this.bingfu < h.cost) return { ok: false, reason: "bingfu" };
    const liveCount = this.units.filter(u => u.team === 0 && u.alive && u.kind === "hero").length;
    if (liveCount >= LEVEL.liveCap) return { ok: false, reason: "live_cap" };
    return { ok: true };
  }

  deploy(heroId, spawn) {
    const now = this.time;
    const chk = this.canDeploy(heroId, now);
    if (!chk.ok) { this.events.push({ t: "deploy_fail", hero: heroId, reason: chk.reason }); return null; }
    const h = HEROES[heroId];
    this.bingfu -= h.cost;
    const u = makeHero(heroId, spawn.x, spawn.y);
    this._place(u); this.units.push(u);
    this.deployedHeroes.set(heroId, { cost: h.cost, redeployUntil: 0, alive: true, everDeployed: true });
    this.lastDeployTime = now;
    // 夜行衣号令：部署后短暂潜行
    if (this.deployStealth > 0) u.stealthUntil = now + this.deployStealth;
    this.events.push({ t: "deploy", unit: u, hero: heroId });
    return u;
  }

  // 撤兵（v2 §2.6）：不返还兵符、计 alive、进 20s 冷却
  retreat(uid) {
    const u = this.units.find(x => x.uid === uid && x.alive && x.kind === "hero");
    if (!u) return false;
    this._unplace(u);
    u.alive = false; u.retreated = true;
    const rec = this.deployedHeroes.get(u.id);
    if (rec) rec.redeployUntil = this.time + LEVEL.redeployCd;
    this.events.push({ t: "retreat", unit: u });
    return true;
  }

  liveHeroCount() { return this.units.filter(u => u.team === 0 && u.alive && (u.kind === "hero" || u.kind === "summon")).length; }

  // ---------- 技能 ----------
  castSkill(uid, target) {
    const u = this.units.find(x => x.uid === uid && x.alive && x.kind === "hero");
    if (!u) return false;
    const h = HEROES[u.id];
    const now = this.time;
    const isUlt = u.rage >= SKILL_FX.rageMax;
    if (!isUlt && now < u.cdUntil) { this.events.push({ t: "skill_fail", unit: u, reason: "cd" }); return false; }
    if (!isUlt && this.liangcao < h.lc) { this.events.push({ t: "skill_fail", unit: u, reason: "liangcao" }); return false; }
    if (!isUlt) this.liangcao -= h.lc;
    if (isUlt) u.rage = 0;
    u.cdUntil = now + h.cd;
    this._applySkill(u, target, now, isUlt);
    return true;
  }

  _applySkill(u, target, now, isUlt) {
    const id = u.id;
    this.events.push({ t: "skill", unit: u, skill: id, ult: isUlt });
    const mult = isUlt ? 1.6 : 1.0;
    if (id === "luzhishen") {
      // 嘲讽周围敌 + 友军减伤
      for (const e of this.units) {
        if (e.team === 1 && e.alive && manhattan(e, u) <= 2) { e.tauntUntil = now + SKILL_FX.tauntDur; e.tauntSource = u; }
      }
      for (const a of this.units) {
        if (a.team === 0 && a.alive && manhattan(a, u) <= 2) a.reduceUntil = now + SKILL_FX.tauntDur;
      }
    } else if (id === "linchong") {
      // 直线突进 + 破甲
      const dir = target && target.x !== undefined ? norm(target.x - u.x, target.y - u.y) : { x: 0, y: 1 };
      const nx = clamp(u.x + dir.x * SKILL_FX.diveRange, 0, this.grid.w - 1);
      const ny = clamp(u.y + dir.y * SKILL_FX.diveRange, 0, this.grid.h - 1);
      this._unplace(u); u.x = nx; u.y = ny; this._place(u);
      for (const e of this.units) {
        if (e.team === 1 && e.alive && manhattan(e, u) <= 1) { e.armorShredUntil = now + 3; e.armorShred = SKILL_FX.diveArmorShred; e.takeDamage(u.dps * 1.5 * mult, now); }
      }
    } else if (id === "wuyong") {
      // 召唤援军（独立 summon_cap）
      for (let i = 0; i < SKILL_FX.summonCount && this.summonCount < LEVEL.summonCap; i++) {
        const s = makeSummon(u.x + (i ? 1 : -1), u.y, now + SKILL_FX.summonDur);
        this._place(s); this.units.push(s); this.summonCount++;
        this.events.push({ t: "summon", unit: s });
      }
    } else if (id === "gongsunsheng") {
      // AOE 雷法（火攻计号令 + 雨天导电 双重放大）
      const tx = target && target.x !== undefined ? target.x : u.x;
      const ty = target && target.y !== undefined ? target.y : u.y;
      const wMult = mult * this.fireMult * this.weather.thunderMult;
      for (const e of this.units) {
        if (e.team === 1 && e.alive && manhattan({ x: Math.round(tx), y: Math.round(ty) }, { x: Math.round(e.x), y: Math.round(e.y) }) <= SKILL_FX.aoeRadius) {
          e.takeDamage(SKILL_FX.aoeDmg * wMult, now);
        }
      }
      this.events.push({ t: "aoe", x: tx, y: ty, r: SKILL_FX.aoeRadius });
    } else if (id === "likui") {
      // 旋风 AOE + 破墙
      for (const e of this.units) {
        if (e.team === 1 && e.alive && manhattan(e, u) <= SKILL_FX.whirlRadius + 1) e.takeDamage(SKILL_FX.whirlDmg * mult, now);
      }
      for (const b of this.buildings) {
        if (b.kind === "wall" && !b.destroyed && manhattan(b, u) <= SKILL_FX.whirlRadius + 1) this._damageWall(b, SKILL_FX.whirlDmg * SKILL_FX.whirlBreach * mult, now);
      }
    } else if (id === "huarong") {
      // 狙击单体（优先塔/英雄）
      const tgt = this._pickSnipeTarget(u);
      if (tgt) {
        const r = tgt.takeDamage ? tgt.takeDamage(u.dps * SKILL_FX.snipeMult * mult, now) : this._damageBuilding(tgt, u.dps * SKILL_FX.snipeMult * mult, now);
        this.events.push({ t: "snipe", unit: u, target: tgt });
      }
    } else if (id === "shiqian") {
      u.stealthUntil = now + SKILL_FX.stealthDur;
    } else if (id === "yanqing") {
      u.dodgeUntil = now + SKILL_FX.dodgeDur;
      const dir = { x: 0, y: -1 };
      this._unplace(u); u.x = clamp(u.x + dir.x * 2, 0, this.grid.w - 1); u.y = clamp(u.y + dir.y * 2, 0, this.grid.h - 1); this._place(u);
    }
  }

  _pickSnipeTarget(u) {
    // 优先范围内塔，其次 Boss/守军英雄，最后最近敌
    let best = null, bestScore = -1;
    for (const b of this.buildings) {
      if (b.destroyed || b.kind !== "tower") continue;
      const d = manhattan(b, u);
      if (d <= HEROES.huarong.range) { const s = 100 - d; if (s > bestScore) { bestScore = s; best = b; } }
    }
    if (best) return best;
    for (const e of this.units) {
      if (e.team !== 1 || !e.alive) continue;
      const d = manhattan(e, u);
      if (d <= HEROES.huarong.range) { const s = (e.isBoss ? 50 : 0) + (100 - d); if (s > bestScore) { bestScore = s; best = e; } }
    }
    return best;
  }

  // ---------- 墙/建筑伤害 ----------
  _damageWall(b, dmg, now) {
    if (b.destroyed) return;
    b.hp -= dmg;
    this.events.push({ t: "wall_hit", b, dmg });
    if (b.hp <= 0) { this._destroyWall(b); }
  }
  _destroyWall(b) {
    b.destroyed = true; b.hp = 0;
    const c = this.grid.cell(b.x, b.y);
    if (c && c.wall === b) c.wall = null;
    this.flowDirty = true;
    // 记录破墙方向（动态防御增援用）
    const side = b.x < this.grid.w / 2 ? "W" : "E";
    this.breachCount[side] = (this.breachCount[side] || 0) + 1;
    this.events.push({ t: "wall_down", b });
    this._raiseAlert(2, "wall_breach");
  }
  _damageBuilding(b, dmg, now) {
    if (b.destroyed) return { applied: 0, died: false };
    b.hp -= dmg;
    this.events.push({ t: "b_hit", b, dmg });
    if (b.hp <= 0) {
      b.destroyed = true; b.hp = 0;
      const c = this.grid.cell(b.x, b.y);
      if (c && c.building === b) c.building = null;
      this.events.push({ t: "b_down", b });
      if (b.kind === "resource") { this.looted += b.def.loot || 0; this.events.push({ t: "loot", amount: b.def.loot }); }
      if (b.kind === "core") this._onCoreDown();
      return { applied: dmg, died: true };
    }
    return { applied: dmg, died: false };
  }
  _onCoreDown() { this._finish(true, "core_down"); }

  // ---------- 警报 / 动态防御 ----------
  _raiseAlert(lv, why) {
    if (lv > this.alertLevel) {
      this.alertLevel = lv;
      this.events.push({ t: "alert", level: lv, why });
      if (lv >= 2) this._commanderAct();
    }
  }
  _commanderAct() {
    // 指挥官：增援被破墙最多的方向；限制总增援次数，避免无限刷兵压死进攻方
    this._reinforceCount = (this._reinforceCount || 0);
    if (this._reinforceCount >= 2) return;
    this._reinforceCount++;
    const side = (this.breachCount.E || 0) >= (this.breachCount.W || 0) ? "E" : "W";
    const gx = side === "E" ? this.grid.w - 6 : 5;
    for (let i = 0; i < 2; i++) {
      const u = makeEnemy("zhuangding", gx, 9 + i);
      this._place(u); this.units.push(u);
      this.events.push({ t: "reinforce", unit: u, side });
    }
  }

  // ---------- 主循环 ----------
  start() { this.phase = "battle"; this.events.push({ t: "battle_start" }); }

  update(dt) {
    if (this.phase !== "battle") return;
    this._acc += dt;
    while (this._acc >= STEP) {
      this._acc -= STEP;
      this._step(STEP);
    }
  }

  _step(dt) {
    this.time += dt; this.elapsed += dt;
    if (this.flowDirty) this._recomputeFlow();
    // 超时
    if (this.elapsed >= SCORING.timeoutS && !this._endEmitted) return this._finish(false, "timeout");
    // 迷雾更新
    this._updateFog();
    // 单位 AI
    for (const u of this.units) {
      if (!u.alive) continue;
      if (u.kind === "sentry") { this._sentryAI(u, dt); continue; }
      if (u.isDecoy && this.time > u.decoyUntil) { this._unplace(u); u.alive = false; continue; }
      if (u.isDecoy) continue; // 草人不动
      if (u.summonUntil && this.time > u.summonUntil) { this._unplace(u); u.alive = false; this.summonCount--; continue; }
      if (u.patrol) this._patrolAI(u, dt);
      else this._combatAI(u, dt);
    }
    // 塔攻击
    for (const b of this.buildings) {
      if (b.destroyed || b.kind !== "tower") continue;
      b.attackCd -= dt;
      if (b.attackCd <= 0) { this._towerFire(b); b.attackCd = 1; }
    }
    // 清理阵亡
    for (const u of this.units) {
      if (u.alive) continue;
      if (!u.dead) { u.dead = true; this._onUnitDead(u); }
    }
    // 胜负：进攻方兵力耗尽且无法再部署
    const liveHero = this.units.some(u => u.team === 0 && u.alive);
    const canMore = this.bingfu >= 3;
    if (!liveHero && !canMore && !this._endEmitted) this._finish(false, "wiped");
  }

  _combatAI(u, dt) {
    const now = this.time;
    // 嘲讽强制索敌
    if (u.team === 1 && now < u.tauntUntil && u.tauntSource && u.tauntSource.alive) {
      this._engage(u, u.tauntSource, dt);
      return;
    }
    // 找目标：敌方单位优先；进攻方接近核心且 Boss 存活则集火 Boss（胜利前置）
    let tgt = this._nearestEnemyUnit(u);
    if (u.team === 0 && this.boss && this.boss.alive && manhattan(u, this.core) <= 7) {
      tgt = this.boss;
    }
    // 进攻方：Boss 已死，无视残敌直取核心（收尾）
    if (u.team === 0 && this.boss && !this.boss.alive && this.core && !this.core.destroyed) {
      tgt = null; // 清空单位目标，走下方建筑分支打核心
    }
    if (tgt && manhattan(u, tgt) <= u.range) { this._attack(u, tgt, dt); return; }
    if (tgt) { this._moveToward(u, tgt, dt); return; }
    // 无单位目标：进攻方打建筑/墙；守方无目标则待命
    if (u.team === 0) {
      const obj = this._nearestObjective(u);
      if (!obj) return;
      if (manhattan(u, obj) <= u.range) {
        if (obj.kind === "wall") this._damageWall(obj, u.dps * u.breach * dt * 4, now);
        else this._damageBuilding(obj, u.dps * dt * 4, now);
      } else this._moveToward(u, obj, dt);
    }
  }

  _engage(u, tgt, dt) {
    if (manhattan(u, tgt) <= u.range) this._attack(u, tgt, dt);
    else this._moveToward(u, tgt, dt);
  }

  _attack(u, tgt, dt) {
    u.attackCd -= dt;
    if (u.attackCd > 0) return;
    u.attackCd = 1;
    const now = this.time;
    let dmg = u.dps;
    if (now < tgt.armorShredUntil) dmg *= (1 + tgt.armorShred);
    const r = tgt.takeDamage(dmg, now);
    u.gainRage(SKILL_FX.rageOnHit);
    if (r.died) u.gainRage(SKILL_FX.rageOnKill);
    // 击杀少量回复（嗜血/收割反馈，教学关降低挫败）
    if (r.died && u.kind === "hero") u.heal(u.maxHp * 0.08);
    this.events.push({ t: "hit", from: u, to: tgt, dmg: r.applied });
    if (u.team === 1) this._raiseAlert(2, "combat");
  }

  _nearestEnemyUnit(u) {
    // 守军/塔优先攻击范围内诱饵（主动欺骗生效）
    if (u.team === 1) {
      let decoy = null, dd = Infinity;
      for (const e of this.units) {
        if (!e.alive || !e.isDecoy) continue;
        const d = manhattan(u, e);
        if (d <= DECOY.attractRange && d < dd) { dd = d; decoy = e; }
      }
      if (decoy) return decoy;
    }
    let best = null, bd = Infinity;
    for (const e of this.units) {
      if (!e.alive || e.team === u.team || e.kind === "sentry") continue;
      if (e.isDecoy) continue; // 真目标跳过草人（已被上面优先处理）
      if (this._isHidden(e)) continue;
      const d = manhattan(u, e);
      if (d < bd) { bd = d; best = e; }
    }
    // 远程射程内才算有效目标；近战无限索敌
    return best;
  }

  _nearestObjective(u) {
    let best = null, bd = Infinity;
    for (const b of this.buildings) {
      if (b.destroyed) continue;
      // 墙/塔/资源/核心都是可攻击目标；核心在 Boss 存活时不可被攻击
      if (b.kind === "core" && this.boss && this.boss.alive) continue;
      const d = manhattan(u, b);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }

  _moveToward(u, tgt, dt) {
    // 用流场朝核心走；若目标是单位/建筑则直线逼近（简化）
    const tx = tgt.x, ty = tgt.y;
    const dx = tx - u.x, dy = ty - u.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.05) return;
    let sp = u.spd * dt * this.moveMult(); // 天气影响移速
    if (this.time < u.slowUntil) sp *= (1 - u.slowPct);
    const nx = u.x + (dx / dist) * sp;
    const ny = u.y + (dy / dist) * sp;
    const cx = Math.round(nx), cy = Math.round(ny);
    // 撞墙/建筑则转拆墙；撞敌方单位则攻击之
    const c = this.grid.cell(cx, cy);
    if (c && (c.wall || c.building)) {
      if (u.team === 0) {
        if (c.wall) this._damageWall(c.wall, u.dps * u.breach * dt * 4, this.time);
        else if (c.building && !(c.building.kind === "core" && this.boss && this.boss.alive)) this._damageBuilding(c.building, u.dps * dt * 4, this.time);
      }
      return;
    }
    if (c && c.occupant && c.occupant !== u && c.occupant.team !== u.team && c.occupant.alive) {
      // 被敌人挡路：若在射程内直接攻击，否则尝试绕行（横向挪一格）
      if (manhattan(u, c.occupant) <= u.range) { this._attack(u, c.occupant, dt); return; }
      const side = (u.uid % 2 === 0) ? { x: 1, y: 0 } : { x: -1, y: 0 };
      const ax = u.x + side.x * sp, ay = u.y + side.y * sp;
      const ac = this.grid.cell(Math.round(ax), Math.round(ay));
      if (ac && !ac.wall && !ac.building && !ac.occupant) { this._unplace(u); u.x = ax; u.y = ay; this._place(u); }
      return;
    }
    // 陷阱触发
    if (c && c.trap && !c.trap.destroyed && u.team === 0) {
      if (!u.trapImmune) {
        u.takeDamage(c.trap.def.dps, this.time);
        this.events.push({ t: "trap", unit: u, trap: c.trap });
      } else {
        this.events.push({ t: "trap_disarm", unit: u, trap: c.trap });
      }
      c.trap.destroyed = true;
      const cc = this.grid.cell(c.trap.x, c.trap.y);
      if (cc) cc.trap = null;
    }
    this._unplace(u);
    u.x = nx; u.y = ny;
    this._place(u);
  }

  _towerFire(b) {
    // 优先攻击范围内诱饵（主动欺骗）
    let best = null, bd = Infinity;
    for (const u of this.units) {
      if (!u.alive || !u.isDecoy) continue;
      const d = manhattan(b, u);
      if (d <= b.def.range && d < bd) { bd = d; best = u; }
    }
    // 找范围内最近梁山单位（尊重潜行/嘲讽）
    if (!best) for (const u of this.units) {
      if (u.team !== 0 || !u.alive || u.isDecoy) continue;
      if (this._isHidden(u)) continue;
      const d = manhattan(b, u);
      if (d <= b.def.range && d < bd) { bd = d; best = u; }
    }
    // 嘲讽改向
    for (const u of this.units) {
      if (u.team === 0 && u.alive && this.time < u.tauntUntil === false && u.reduceUntil > this.time) {
        // 鲁智深减伤光环期间若其在范围内，塔优先打它
      }
    }
    const taunter = this.units.find(u => u.team === 0 && u.alive && u.id === "luzhishen" && this.time < u.reduceUntil && manhattan(b, u) <= b.def.range);
    if (taunter) best = taunter;
    if (!best) return;
    const r = best.takeDamage(b.def.dps, this.time);
    if (b.def.slow) { best.slowUntil = this.time + 1; best.slowPct = b.def.slow; }
    this.events.push({ t: "tower_fire", b, target: best, dmg: r.applied });
    this._raiseAlert(1, "tower");
  }

  _sentryAI(u, dt) {
    // 哨兵：发现梁山单位则点火（2s 后警报+1）
    if (u.ignited) return;
    let seen = false;
    for (const e of this.units) {
      if (e.team !== 0 || !e.alive) continue;
      if (this._isHidden(e)) continue;
      if (manhattan(u, e) <= u.vision) { seen = true; break; }
    }
    if (seen) {
      u.igniteT = (u.igniteT || 0) + dt;
      if (u.igniteT >= SKILL_FX.alertSentryDelay) {
        u.ignited = true;
        this._raiseAlert(2, "sentry");
        this.events.push({ t: "sentry_fire", unit: u });
      }
    } else u.igniteT = 0;
  }

  _patrolAI(u, dt) {
    const p = u.patrol;
    // 发现敌→报警（跑向最近哨兵/塔）；否则沿路线巡逻
    let enemy = null, ed = Infinity;
    for (const e of this.units) {
      if (e.team !== 0 || !e.alive) continue;
      if (this._isHidden(e)) continue;
      const d = manhattan(u, e);
      if (d <= 3 && d < ed) { ed = d; enemy = e; }
    }
    if (enemy && !p.alarm) {
      p.alarm = true;
      this._raiseAlert(2, "patrol");
      this.events.push({ t: "patrol_alarm", unit: u });
    }
    if (p.alarm) {
      // 报警后转战斗
      this._combatAI(u, dt);
      return;
    }
    // 巡逻：朝当前路点走
    const wp = p.route[p.idx];
    const dx = wp.x - u.x, dy = wp.y - u.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.3) { p.idx = (p.idx + 1) % p.route.length; return; }
    const sp = u.spd * 0.6 * dt;
    this._unplace(u);
    u.x += (dx / dist) * sp; u.y += (dy / dist) * sp;
    this._place(u);
  }

  _onUnitDead(u) {
    this.events.push({ t: "dead", unit: u });
    if (u.kind === "hero") {
      const rec = this.deployedHeroes.get(u.id);
      if (rec) rec.redeployUntil = this.time + LEVEL.redeployCd;
      this._unplace(u);
    }
    if (u.isBoss) {
      this.events.push({ t: "boss_down", unit: u });
      this._raiseAlert(3, "boss");
    }
  }

  // ---------- 结算 ----------
  _finish(win, reason) {
    if (this._endEmitted) return;
    this._endEmitted = true;
    this.phase = "end";
    const stars = win ? this._calcStars() : 0;
    const lootTotal = win ? Math.round((LOOT.base + this.looted) * LOOT.starCoeff[Math.max(0, stars - 1)] || LOOT.starCoeff[0]) : 0;
    this.result = { win, reason, stars, loot: lootTotal, looted: this.looted, elapsed: Math.round(this.elapsed) };
    this.events.push({ t: "battle_end", result: this.result });
  }

  _calcStars() {
    let s = 0;
    // ★ 毁核心（已隐含 win）
    if (this.core.destroyed) s++;
    // ★ 毁 50% 建筑（口径：star2=true 的）
    const star2b = this.buildings.filter(b => b.star2);
    const destroyed = star2b.filter(b => b.destroyed).length;
    if (star2b.length && destroyed / star2b.length >= SCORING.star2Pct) s++;
    // ★ 剩兵≥30%（英雄 ID 去重）或 ≤120s
    const aliveCost = [...this.deployedHeroes.values()].filter(r => this.units.some(u => u.kind === "hero" && u.alive && this.deployedHeroes.get(u.id) === r)).reduce((a, r) => a + r.cost, 0);
    const deployedCost = [...this.deployedHeroes.values()].reduce((a, r) => a + r.cost, 0);
    const ratio = deployedCost ? aliveCost / deployedCost : 0;
    if (ratio >= SCORING.star3TroopPct || this.elapsed <= SCORING.star3TimeS) s++;
    return Math.max(1, s);
  }

  // 拨济（结算后调用）
  applyRelief(ratio) {
    if (!this.result || !this.result.win) return null;
    const r = Math.min(RELIEF.max, Math.max(RELIEF.min, ratio));
    const reliefAmt = Math.round(this.result.loot * r);
    const renown = Math.round(reliefAmt * 1.0);
    this.result.relief = { ratio: r, amount: reliefAmt, renown, net: this.result.loot - reliefAmt };
    return this.result.relief;
  }

  drainEvents() { const e = this.events; this.events = []; return e; }
}

function norm(dx, dy) { const d = Math.hypot(dx, dy) || 1; return { x: dx / d, y: dy / d }; }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
