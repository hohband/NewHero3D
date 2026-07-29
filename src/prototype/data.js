// 横版战斗数据装配（纯逻辑层）：CSV 文本 → 两队/多波配置
// 数据源：units.csv（身份与个性属性）、skills.csv（技能效果串+scope）、proto_awaken.csv（觉醒技）、
//         growth_curve.csv（hp/atk/def/mgc 面板曲线）、battle_constants.csv / progression.csv（常量）
// 编队由调用方传入（玩家编队来自存档，敌方来自 waves.csv），本文件不写死任何名单
import { parseCsvTable, toInt, toFloat, parseBonds } from "../shared/csv.js";
import { parseEffects, KNOWN_EFFECTS } from "../shared/effects.js";
import { computePanel, effectMult, TIER_UNLOCK, AWAKEN_RED_MULT, makeHeroState } from "./hero.js";

// 职业 → 克制原型（archetype）
export const ARCHETYPE = {
  vanguard: "tank", cavalry: "phys", infantry: "phys",
  archer: "archer", strategist: "mage", healer: "healer", support: "support",
};

// 站位（后排=远程/法师/奶/辅助）
const BACK_ROW = new Set(["archer", "strategist", "healer"]);

// 校验：效果串每个效果必须在白名单内，否则抛错并点名（红线 6）
function validateEffects(parsed, skillId) {
  for (const e of parsed) {
    if (!KNOWN_EFFECTS.has(e.name)) {
      throw new Error(`未知效果 "${e.name}"（${skillId}）——须先入 KNOWN_EFFECTS 白名单`);
    }
  }
}

function buildSkill(row, skillLevel, prog) {
  if (!row) return null;
  const parsed = parseEffects(row.effects);
  validateEffects(parsed, row.skill_id);
  const scope = row.scope || (row.target === "self" ? "self" : row.target === "ally" ? "allies" : "single");
  return {
    id: row.skill_id, name: row.name,
    cd: Math.max(1, toInt(row.cooldown)),
    scope,
    effectsStr: row.effects,
    parsed,
    effectMult: effectMult(skillLevel ?? 1, prog),
  };
}

// ctx: { unitsById, skillsByOwner, awakenById, curve, prog }
// formation 条目: { id, row?, slot?, level?, tier? }；heroState（玩家侧养成）优先于 formation 内联值
function buildUnit(entry, ctx) {
  const id = entry.id;
  const u = ctx.unitsById.get(id);
  if (!u) throw new Error(`units.csv 缺少武将: ${id}`);
  const state = ctx.heroStates?.get(id) ?? makeHeroState(id, {
    level: entry.level ?? 1,
    tier: entry.tier ?? TIER_UNLOCK.awaken, // 缺省满解锁（敌方/测试用）；玩家侧必传 heroStates
  });
  const cls = u.class;
  const owned = ctx.skillsByOwner.get(id) || { ult: null, active: null, passive: [] };
  const small = buildSkill(owned.active, state.skill.small, ctx.prog);
  const ult = buildSkill(owned.ult, state.skill.ult, ctx.prog);
  if (!small) throw new Error(`skills.csv 缺少 ${id} 的小技能(active)`);
  if (!ult) throw new Error(`skills.csv 缺少 ${id} 的大招(ult)`);
  // 培养阶过滤技能槽：蓝+被动1 / 紫+被动2 / 橙+觉醒技 / 红=觉醒强化
  const passives = [];
  for (let i = 0; i < owned.passive.length && i < 2; i++) {
    const need = i === 0 ? TIER_UNLOCK.passive1 : TIER_UNLOCK.passive2;
    if (state.tier < need) continue;
    const p = owned.passive[i];
    const parsed = parseEffects(p.effects);
    validateEffects(parsed, p.skill_id);
    passives.push({ id: p.skill_id, name: p.name, trigger: p.trigger, parsed, effectMult: 1 });
  }
  let awaken = null;
  const aw = ctx.awakenById.get(id);
  if (state.tier >= TIER_UNLOCK.awaken) {
    if (!aw) throw new Error(`proto_awaken.csv 缺少 ${id} 的觉醒技（tier=${state.tier}）`);
    const parsed = parseEffects(aw.effects);
    validateEffects(parsed, `awaken:${id}`);
    awaken = {
      name: aw.name, trigger: aw.trigger, param: toFloat(aw.param), parsed,
      effectMult: state.tier >= 4 ? AWAKEN_RED_MULT : 1,
    };
  }
  const panel = computePanel(u, ctx.curve, state);
  return {
    id, name: u.name, cls, archetype: ARCHETYPE[cls] || "phys",
    row: entry.row || (BACK_ROW.has(cls) ? "back" : "front"),
    slot: entry.slot ?? 0,
    quality: u.quality, tier: state.tier, level: state.level,
    ...panel,
    bonds: parseBonds(u.bonds),
    small, ult, passives, awaken,
    ultName: ult.name,
  };
}

function rowsToConstMap(csv) {
  const m = {};
  for (const r of parseCsvTable(csv)) m[r.key] = toFloat(r.value);
  return m;
}

// 主入口：构建两队（或多波）配置
// 入参二选一：enemyFormation=[{id,row,slot,level,tier}]（单波）或 wavesCsv+battleId（多波）
export function buildTeams({
  unitsCsv, skillsCsv, awakenCsv, growthCsv, constsCsv, progressionCsv,
  playerFormation, enemyFormation, wavesCsv, battleId, heroStates,
}) {
  const unitsById = new Map(parseCsvTable(unitsCsv).map((r) => [r.unit_id, r]));
  const skillsByOwner = new Map();
  for (const s of parseCsvTable(skillsCsv)) {
    const id = s.owner;
    if (!skillsByOwner.has(id)) skillsByOwner.set(id, { ult: null, active: null, passive: [] });
    const bucket = skillsByOwner.get(id);
    if (s.type === "ult") bucket.ult = s;
    else if (s.type === "active") bucket.active = s;
    else if (s.type === "passive") bucket.passive.push(s);
  }
  const awakenById = new Map(parseCsvTable(awakenCsv).map((r) => [r.unit_id, r]));
  const curve = new Map();
  for (const r of parseCsvTable(growthCsv || "")) {
    curve.set(`${r.unit_class}|${r.stat}`, { base: toFloat(r.base), per_level: toFloat(r.per_level), per_tier: toFloat(r.per_tier) });
  }
  const ctx = {
    unitsById, skillsByOwner, awakenById, curve,
    consts: rowsToConstMap(constsCsv || ""),
    prog: rowsToConstMap(progressionCsv || ""),
    heroStates: heroStates instanceof Map ? heroStates : heroStates ? new Map(Object.entries(heroStates)) : null,
  };

  let waves, spawnDelays;
  if (wavesCsv && battleId) {
    const rows = parseCsvTable(wavesCsv).filter((r) => r.battle_id === battleId);
    if (!rows.length) throw new Error(`waves.csv 没有 ${battleId} 的配置`);
    const byWave = new Map();
    for (const r of rows) {
      const w = toInt(r.wave);
      if (!byWave.has(w)) byWave.set(w, { delay: toFloat(r.spawn_delay), entries: [] });
      byWave.get(w).entries.push({
        id: r.unit_id, row: r.row || undefined, slot: toInt(r.slot),
        level: toInt(r.level) || 1, tier: r.tier === "" || r.tier === undefined ? undefined : toInt(r.tier),
      });
    }
    const ordered = [...byWave.entries()].sort((a, b) => a[0] - b[0]);
    waves = ordered.map(([, g]) => g.entries.map((e) => buildUnit(e, ctx)));
    spawnDelays = ordered.map(([, g]) => g.delay);
  } else {
    if (!enemyFormation) throw new Error("buildTeams 需要 enemyFormation 或 wavesCsv+battleId");
    waves = [enemyFormation.map((e) => buildUnit(e, ctx))];
    spawnDelays = [0];
  }
  if (!playerFormation?.length) throw new Error("buildTeams 需要 playerFormation");
  const player = playerFormation.map((e) => buildUnit(e, ctx));
  return { player, enemy: waves[0], waves, spawnDelays, consts: ctx.consts, prog: ctx.prog };
}
