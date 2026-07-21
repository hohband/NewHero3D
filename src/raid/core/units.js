// 劫寨 Demo 实时单位（武将 / 守军 / Boss / 哨兵 / 巡逻 / 援军）
// 连续坐标（浮点），实时移动/攻击；逻辑层无 three 依赖。
import { HEROES, ENEMIES, SKILL_FX } from "./data.js";

let seq = 1;

export class RaidUnit {
  // kind: 'hero'|'enemy'|'boss'|'sentry'|'summon'
  constructor(defId, kind, x, y) {
    this.uid = seq++;
    this.kind = kind;
    const src = kind === "hero" || kind === "summon" ? HEROES[defId] || ENEMIES[defId] : ENEMIES[defId];
    this.def = src;
    this.id = defId;
    this.name = src.name;
    this.x = x; this.y = y;             // 浮点坐标（格中心）
    this.hp = src.hp;
    this.maxHp = src.hp;
    this.dps = src.dps || 0;
    this.range = src.range || 1;
    this.spd = src.spd || 1.2;
    this.breach = src.breach || 1;
    this.alive = true;
    this.team = (kind === "hero" || kind === "summon") ? 0 : 1; // 0=梁山 1=守方
    // 战斗状态
    this.target = null;                 // 攻击目标（unit 或 building）
    this.attackCd = 0;
    this.moveTarget = null;             // {x,y}
    this.path = [];
    // 状态组件
    this.tauntUntil = 0;                // 嘲讽生效至
    this.tauntSource = null;
    this.reduceUntil = 0;               // 减伤
    this.stealthUntil = 0;              // 潜行
    this.dodgeUntil = 0;
    this.slowUntil = 0; this.slowPct = 0;
    this.armorShredUntil = 0; this.armorShred = 0;
    this.rage = 0;
    this.cdUntil = 0;                   // 技能冷却至
    this.redeployUntil = 0;             // 再部署冷却至
    this.carrying = false;              // 劫掠搬运中
    this.carryLoot = 0;
    this.trapImmune = defId === "shiqian";
    this.isBoss = kind === "boss";
    this.vision = src.vision || 0;
    this.cost = src.cost || 0;
    this.dead = false;
  }
  get effDps() { return this.dps; }
  takeDamage(amount, now) {
    if (!this.alive) return { applied: 0, died: false };
    let dmg = amount;
    if (now < this.reduceUntil) dmg *= (1 - SKILL_FX.tauntReduce);
    if (now < this.dodgeUntil) dmg = 0; // 位移闪避期间免伤
    this.hp -= dmg;
    this.gainRage(SKILL_FX.rageOnHit);
    if (this.hp <= 0) { this.hp = 0; this.alive = false; return { applied: dmg, died: true }; }
    return { applied: dmg, died: false };
  }
  heal(v) { if (this.alive) this.hp = Math.min(this.maxHp, this.hp + v); }
  gainRage(v) { this.rage = Math.min(SKILL_FX.rageMax, this.rage + v); }
  isStealthed(now) { return now < this.stealthUntil; }
}

export function makeHero(defId, x, y) { return new RaidUnit(defId, "hero", x, y); }
export function makeEnemy(defId, x, y) { return new RaidUnit(defId, "enemy", x, y); }
export function makeBoss(defId, x, y) { return new RaidUnit(defId, "boss", x, y); }
export function makeSentry(x, y) { const u = new RaidUnit("sentry", "sentry", x, y); return u; }
export function makeSummon(x, y, dur) {
  const u = new RaidUnit("zhuangding", "summon", x, y);
  u.team = 0; u.hp = SKILL_FX.summonHp; u.maxHp = SKILL_FX.summonHp; u.dps = 8;
  u.summonUntil = dur; u.name = "援军";
  return u;
}
