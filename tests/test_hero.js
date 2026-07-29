// 3.2 养成系统 · 无头测试（成长曲线 / 培养阶解锁 / 技能等级倍率）
import { test } from "node:test";
import assert from "node:assert/strict";
import { computePanel, effectMult, skillLevelCap, expToNext, makeHeroState, TIER_UNLOCK, AWAKEN_RED_MULT } from "../src/prototype/hero.js";
import { parseCsvTable, toFloat } from "../src/shared/csv.js";
import { loadCsvs } from "./helpers.js";
import { buildTeams } from "../src/prototype/data.js";

const csvs = loadCsvs();
const curve = new Map();
for (const r of parseCsvTable(csvs.growthCsv)) {
  curve.set(`${r.unit_class}|${r.stat}`, { base: toFloat(r.base), per_level: toFloat(r.per_level), per_tier: toFloat(r.per_tier) });
}
const unitsById = new Map(parseCsvTable(csvs.unitsCsv).map((r) => [r.unit_id, r]));
const prog = Object.fromEntries(parseCsvTable(csvs.progressionCsv).map((r) => [r.key, toFloat(r.value)]));

test("成长曲线公式：stat = base + per_level×(lv-1) + per_tier×tierIndex", () => {
  const row = unitsById.get("lin_chong"); // cavalry
  assert.equal(computePanel(row, curve, makeHeroState("lin_chong", { level: 1, tier: 0 })).hp, 670);
  assert.equal(computePanel(row, curve, makeHeroState("lin_chong", { level: 5, tier: 2 })).hp, 670 + 50 * 4 + 170 * 2);
  assert.equal(computePanel(row, curve, makeHeroState("lin_chong", { level: 1, tier: 0 })).atk, 102);
});

test("effect_mult = 1 + skill_level_mult × (等级-1)", () => {
  assert.equal(effectMult(1, prog), 1);
  assert.ok(Math.abs(effectMult(3, prog) - (1 + prog.skill_level_mult * 2)) < 1e-9);
});

test("技能等级上限：红阶放开", () => {
  assert.equal(skillLevelCap(0, prog), prog.skill_level_max_normal);
  assert.equal(skillLevelCap(4, prog), prog.skill_level_max);
});

test("升级经验 = base × 当前等级", () => {
  assert.equal(expToNext(3, prog), prog.level_exp_base * 3);
});

function assembleWith(tier, skill = { small: 1, ult: 1 }) {
  const heroStates = new Map([["lin_chong", { level: 1, tier, skill }]]);
  const teams = buildTeams({
    ...csvs,
    playerFormation: [{ id: "lin_chong", row: "front", slot: 0 }],
    enemyFormation: [{ id: "song_wan", row: "front", slot: 0 }],
    heroStates,
  });
  return teams.player[0];
}

test("培养阶解锁技能槽：绿=无被动无觉醒 / 蓝+被动1 / 紫+被动2 / 橙+觉醒 / 红=觉醒强化", () => {
  assert.equal(TIER_UNLOCK.awaken, 3);
  const t0 = assembleWith(0);
  assert.equal(t0.passives.length, 0, "绿阶无被动");
  assert.equal(t0.awaken, null, "绿阶无觉醒技");
  assert.ok(t0.small && t0.ult, "绿阶有小技能与大招");
  assert.equal(assembleWith(1).passives.length, 1, "蓝阶解锁被动1");
  assert.equal(assembleWith(2).passives.length, 2, "紫阶解锁被动2");
  const t3 = assembleWith(3);
  assert.ok(t3.awaken, "橙阶解锁觉醒技");
  assert.equal(t3.awaken.effectMult, 1);
  const t4 = assembleWith(4);
  assert.equal(t4.awaken.effectMult, AWAKEN_RED_MULT, "红阶觉醒强化 ×1.3");
});

test("技能等级注入 effectMult", () => {
  const u = assembleWith(3, { small: 3, ult: 2 });
  assert.ok(Math.abs(u.small.effectMult - (1 + prog.skill_level_mult * 2)) < 1e-9);
  assert.ok(Math.abs(u.ult.effectMult - (1 + prog.skill_level_mult)) < 1e-9);
});
