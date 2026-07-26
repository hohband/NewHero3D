// 刀塔传奇版战斗原型 · 无头回归测试（node --test）
// 覆盖：CSV 装配、战斗可分出胜负、大招是胜负手、克制矩阵、大招连锁、觉醒技
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildTeams } from "../src/prototype/data.js";
import { Sim, SIM_STEP } from "../src/prototype/sim.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const teams = buildTeams({
  unitsCsv: readFileSync(join(root, "data/units.csv"), "utf8"),
  skillsCsv: readFileSync(join(root, "data/skills.csv"), "utf8"),
  awakenCsv: readFileSync(join(root, "data/proto_awaken.csv"), "utf8"),
});

function runBattle(autoUlt, maxT = 180) {
  const sim = new Sim(teams, 20260727);
  let t = 0, ults = 0, chainMax = 0, awakens = 0, guard = 0;
  while (sim.winner < 0 && t < maxT) {
    sim.step(SIM_STEP); t += SIM_STEP;
    for (const e of sim.events.splice(0)) {
      if (e.type === "chain") chainMax = Math.max(chainMax, e.count);
      if (e.type === "awaken") awakens++;
    }
    if (autoUlt) for (const u of sim.units.filter((x) => x.side === 0 && x.alive && x.rage >= 100)) if (sim.castUlt(u)) ults++;
    if (++guard > 200000) break;
  }
  return { winner: sim.winner, t, ults, chainMax, awakens, sim };
}

test("CSV 装配：两队各 5 将，技能/觉醒技齐全", () => {
  assert.equal(teams.player.length, 5);
  assert.equal(teams.enemy.length, 5);
  for (const u of teams.player.concat(teams.enemy)) {
    assert.ok(u.hp > 0 && u.atk > 0, `${u.name} 面板`);
    assert.ok(u.ult && u.ult.parsed.length > 0, `${u.name} 大招`);
    assert.ok(u.awaken, `${u.name} 觉醒技`);
  }
});

test("战斗可分出胜负，且手动大招是胜负手", () => {
  const withUlt = runBattle(true);
  const noUlt = runBattle(false);
  assert.equal(withUlt.winner, 0, "手动大招应获胜");
  assert.equal(noUlt.winner, 1, "不放大招应战败");
  assert.ok(withUlt.t > 0 && withUlt.t < 180);
});

test("大招连锁生效（连放叠层）", () => {
  const r = runBattle(true);
  assert.ok(r.ults >= 3, `放了 ${r.ults} 个大招`);
  assert.ok(r.chainMax >= 2, `连锁叠到 ×${r.chainMax}`);
});

test("觉醒技按条件触发", () => {
  const r = runBattle(true);
  assert.ok(r.awakens >= 1, `触发 ${r.awakens} 个觉醒技`);
});

test("克制矩阵：远程优先切后排脆皮，物理避开坦克", () => {
  const sim = new Sim(teams, 1);
  const gs = sim.byId("gongsun_sheng");
  assert.ok(sim._counterScore(gs, sim.byId("bai_sheng")) > sim._counterScore(gs, sim.byId("song_wan")),
    "法师应更倾向打后排法师而非坦克");
  const hr = sim.byId("hua_rong");
  assert.ok(sim._counterScore(hr, sim.byId("an_daoquan")) > sim._counterScore(hr, sim.byId("lu_zhishen")),
    "射手应更倾向打奶妈而非坦克");
});
