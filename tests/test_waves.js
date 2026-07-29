// 3.3 波次制关卡 · 无头测试（波次推进 / 跨波继承 / 胜负判定）
import { test } from "node:test";
import assert from "node:assert/strict";
import { Sim, SIM_STEP, loadCsvs, runBattle } from "./helpers.js";
import { buildTeams } from "../src/prototype/data.js";

const csvs = loadCsvs();
const WAVES_CSV = `battle_id,wave,spawn_delay,unit_id,row,slot,level,tier
t01,1,0,song_wan,front,0,1,1
t01,2,1,bai_sheng,back,0,1,1
t01,2,1,du_qian,front,0,1,1
`;
const PLAYER = [
  { id: "lu_zhishen", row: "front", slot: 0 },
  { id: "lin_chong", row: "front", slot: 1 },
  { id: "wu_song", row: "front", slot: 2 },
  { id: "gongsun_sheng", row: "back", slot: 0 },
  { id: "an_daoquan", row: "back", slot: 1 },
];

function buildTwoWave() {
  return buildTeams({ ...csvs, wavesCsv: WAVES_CSV, battleId: "t01", playerFormation: PLAYER });
}

function runToEnd(sim, maxT = 240) {
  let t = 0;
  const seen = [];
  while (sim.winner < 0 && t < maxT) {
    sim.step(SIM_STEP); t += SIM_STEP;
    for (const e of sim.events.splice(0)) seen.push(e);
    if (sim.autoUlt) for (const u of sim.units.filter((x) => x.side === 0 && x.alive && x.rage >= 100)) sim.castUlt(u);
  }
  return { t, seen };
}

test("waves.csv 装配：两波分组 + spawn_delay", () => {
  const teams = buildTwoWave();
  assert.equal(teams.waves.length, 2);
  assert.equal(teams.waves[0].length, 1);
  assert.equal(teams.waves[1].length, 2);
  assert.deepEqual(teams.spawnDelays, [0, 1]);
});

test("波次推进：清一波出下一波，全清判胜", () => {
  const teams = buildTwoWave();
  const sim = new Sim(teams, 42);
  sim.autoUlt = true;
  const { seen } = runToEnd(sim);
  assert.equal(sim.winner, 0, "全清应胜");
  assert.ok(seen.some((e) => e.type === "wave_clear" && e.wave === 1), "第 1 波清完事件");
  assert.ok(seen.some((e) => e.type === "wave_spawn" && e.wave === 2), "第 2 波刷出事件");
  assert.equal(sim.waveInfo.total, 2);
});

test("跨波继承：HP/怒气不复位、单位引用不变", () => {
  const teams = buildTwoWave();
  const sim = new Sim(teams, 42);
  sim.autoUlt = true;
  const ref = sim.units.filter((u) => u.side === 0);
  // 打到第二波出现
  let t = 0, spawned = false;
  while (t < 240 && !spawned) {
    sim.step(SIM_STEP); t += SIM_STEP;
    for (const e of sim.events.splice(0)) if (e.type === "wave_spawn") spawned = true;
    for (const u of sim.units.filter((x) => x.side === 0 && x.alive && x.rage >= 100)) sim.castUlt(u);
  }
  assert.ok(spawned, "第二波应出现");
  const after = sim.units.filter((u) => u.side === 0);
  assert.deepEqual(after, ref, "我方单位对象跨波不变（HP/怒气自然继承）");
  for (const u of after) if (u.alive) assert.ok(u.hp <= u.maxHp, "HP 不因换波回满");
});

test("我方全灭判负", () => {
  const weak = [
    { id: "bai_sheng", row: "back", slot: 0 },
    { id: "wang_dingliu", row: "front", slot: 0 },
  ];
  const teams = buildTeams({
    ...csvs,
    wavesCsv: `battle_id,wave,spawn_delay,unit_id,row,slot,level,tier\nt02,1,0,yang_zhi_boss,front,0,8,4\nt02,1,0,qin_ming,front,1,6,4\nt02,1,0,xu_ning,front,2,6,4\nt02,1,0,hua_rong,back,0,6,4\nt02,2,1,lin_chong,front,0,6,4\n`,
    battleId: "t02",
    playerFormation: weak,
  });
  const sim = new Sim(teams, 1);
  const { seen } = runToEnd(sim);
  assert.equal(sim.winner, 1, "全灭应负");
  assert.ok(!seen.some((e) => e.type === "wave_spawn"), "未清完不得刷下一波");
});

test("真实关卡 story_01 可跑通", () => {
  const teams = buildTeams({
    ...csvs, wavesCsv: csvs.wavesCsv, battleId: "story_01",
    playerFormation: PLAYER,
  });
  const r = runBattle(teams, { autoUlt: true, seed: 5 });
  assert.equal(r.winner, 0);
});
