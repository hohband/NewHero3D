// 原型数据装配：从 CSV 文本构建两队配置（纯函数，text in → config out）
// 数据源：data/units.csv（面板）、data/skills.csv（ult/active/被动效果串）、data/proto_awaken.csv（觉醒技）
// 复用 core 的 parseCsvTable / parseEffects，保证效果串语法与正赛一致
import { parseCsvTable, toInt, toFloat } from "../shared/csv.js";
import { parseEffects } from "../shared/effects.js";

// 两队出场名单（unit_id，取自 units.csv）
export const PLAYER_IDS = ["lu_zhishen", "lin_chong", "wu_song", "gongsun_sheng", "an_daoquan"];
export const ENEMY_IDS = ["song_wan", "li_kui", "qin_ming", "hua_rong", "bai_sheng"];

// 职业 → 克制原型（archetype）
export const ARCHETYPE = {
  vanguard: "tank", cavalry: "phys", infantry: "phys",
  archer: "archer", strategist: "mage", healer: "healer", support: "support",
};

// 站位（前排=近战职业，后排=远程/奶）
const BACK_ROW = new Set(["archer", "strategist", "healer"]);

// 技能目标范围（横版）：单体/AOE前排/AOE全体/奶队友/自身
const SCOPE = {
  ult_chuiyangliu: "aoe_front", ult_fengxue: "single", ult_jiangmenshen: "single",
  ult_wulei: "aoe_all", ult_heixuanfeng: "aoe_front", ult_pili: "aoe_front",
  ult_baibu: "single_lowest", act_miaoshou: "allies", act_tiebi: "self", act_yaojiu: "aoe_all",
};
// 设计稿 §6 兜底：flagship 缺 act_、fodder 缺 ult_，用设计版补齐（语法同 skills.csv）
const FALLBACK_SMALL = {
  lu_zhishen: { name: "禅杖横扫", cd: 3, scope: "aoe_front", effects: "phys_dmg(1.0);knockback(1)" },
  lin_chong: { name: "枪挑", cd: 2, scope: "single", effects: "phys_dmg(1.4);bonus_vs_high_def(0.4)" },
  wu_song: { name: "醉拳", cd: 2, scope: "single", effects: "phys_dmg(1.2);bonus_vs_elite(0.5)" },
  gongsun_sheng: { name: "掌心雷", cd: 3, scope: "single", effects: "mgc_dmg(1.2);paralyze(1)" },
  li_kui: { name: "板斧旋风", cd: 3, scope: "aoe_front", effects: "phys_dmg(1.1)x2" },
  qin_ming: { name: "狼牙猛击", cd: 2, scope: "single", effects: "phys_dmg(1.3);armor_break(0.3,2)" },
  hua_rong: { name: "连珠箭", cd: 2, scope: "single", effects: "phys_dmg(0.7)x2;sure_hit" },
};
const FALLBACK_ULT = {
  an_daoquan: { name: "华佗再世", scope: "allies", effects: "heal(1.6);dispel(99);revive(0.3)" },
  song_wan: { name: "铁壁", scope: "self", effects: "taunt(2);block_up(0.3,2)" },
  bai_sheng: { name: "蒙汗药酒", scope: "aoe_all", effects: "sleep(2);hit_rate(0.9)" },
};

function buildSkill(row, fallback) {
  const src = row || fallback;
  if (!src) return null;
  const effects = src.effects;
  const scope = (row && SCOPE[row.skill_id]) || src.scope || "single";
  return {
    id: src.skill_id || src.name,
    name: src.name,
    cd: row ? Math.max(1, toInt(row.cooldown)) : (fallback ? fallback.cd : 0),
    scope,
    effectsStr: effects,
    parsed: parseEffects(effects),
  };
}

function buildUnit(id, unitsById, skillsByOwner, awakenById) {
  const u = unitsById.get(id);
  if (!u) throw new Error(`units.csv 缺少武将: ${id}`);
  const cls = u.class;
  const owned = skillsByOwner.get(id) || { ult: null, active: null, passive: [] };
  const small = buildSkill(owned.active, FALLBACK_SMALL[id]);
  const ult = buildSkill(owned.ult, FALLBACK_ULT[id]);
  const passives = owned.passive.map((p) => ({
    id: p.skill_id, name: p.name, trigger: p.trigger, parsed: parseEffects(p.effects),
  }));
  const aw = awakenById.get(id);
  const awaken = aw ? { name: aw.name, trigger: aw.trigger, param: toFloat(aw.param), parsed: parseEffects(aw.effects) } : null;
  return {
    id, name: u.name, cls, archetype: ARCHETYPE[cls] || "phys",
    row: BACK_ROW.has(cls) ? "back" : "front",
    hp: toInt(u.hp), atk: toInt(u.atk), def: toInt(u.def), mgc: toInt(u.mgc),
    spd: toInt(u.spd), crit: toInt(u.crit), dodge: toInt(u.dodge), block: toInt(u.block),
    small, ult, passives, awaken,
    ultName: ult ? ult.name : "大招",
  };
}

// 主入口：构建两队配置
export function buildTeams({ unitsCsv, skillsCsv, awakenCsv }) {
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
  return {
    player: PLAYER_IDS.map((id) => buildUnit(id, unitsById, skillsByOwner, awakenById)),
    enemy: ENEMY_IDS.map((id) => buildUnit(id, unitsById, skillsByOwner, awakenById)),
  };
}
