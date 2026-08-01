// 刀塔传奇版战斗原型 · 无头回归测试（node --test）
// 覆盖：CSV 装配、战斗可分出胜负、大招是胜负手、克制矩阵、大招连锁、觉醒技
import { test } from "node:test";
import assert from "node:assert/strict";
import { teamsFor, runBattle, makeCfg, makeSmall, loadCsvs, MIRROR_PLAYER, MIRROR_ENEMY } from "./helpers.js";
import { Sim, SIM_STEP } from "../src/prototype/sim.js";
import { buildTeams } from "../src/prototype/data.js";

const teams = teamsFor();

test("CSV 装配：两队各 5 将，技能/觉醒技齐全", () => {
  assert.equal(teams.player.length, 5);
  assert.equal(teams.enemy.length, 5);
  for (const u of teams.player.concat(teams.enemy)) {
    assert.ok(u.hp > 0 && u.atk > 0, `${u.name} 面板`);
    assert.ok(u.ult && u.ult.parsed.length > 0, `${u.name} 大招`);
    assert.ok(u.small && u.small.parsed.length > 0, `${u.name} 小技能`);
    assert.ok(u.awaken, `${u.name} 觉醒技`);
  }
});

test("战斗可分出胜负，且手动大招是胜负手", () => {
  const withUlt = runBattle(teamsFor(), { autoUlt: true });
  const noUlt = runBattle(teamsFor(), { autoUlt: false });
  assert.equal(withUlt.winner, 0, "手动大招应获胜");
  assert.equal(noUlt.winner, 1, "不放大招应战败");
  assert.ok(withUlt.t > 0 && withUlt.t < 180);
});

test("大招连锁生效（连放叠层）", () => {
  const r = runBattle(teamsFor(), { autoUlt: true });
  assert.ok(r.ults >= 3, `放了 ${r.ults} 个大招`);
  assert.ok(r.chainMax >= 2, `连锁叠到 ×${r.chainMax}`);
});

test("觉醒技按条件触发", () => {
  const r = runBattle(teamsFor(), { autoUlt: true });
  assert.ok(r.awakens >= 1, `触发 ${r.awakens} 个觉醒技`);
});

test("克制矩阵：远程优先切后排脆皮，物理避开坦克", () => {
  const sim = new Sim(teamsFor(), 1);
  const gs = sim.byId("gongsun_sheng");
  assert.ok(sim._counterScore(gs, sim.byId("bai_sheng")) > sim._counterScore(gs, sim.byId("song_wan")),
    "法师应更倾向打后排法师而非坦克");
  const hr = sim.byId("hua_rong");
  assert.ok(sim._counterScore(hr, sim.byId("an_daoquan")) > sim._counterScore(hr, sim.byId("lu_zhishen")),
    "射手应更倾向打奶妈而非坦克");
});

test("治疗衰减：起始时间后线性衰减且不低于下限", () => {
  const sim = new Sim(teamsFor(), 1);
  sim.consts.heal_decay_start = 10; sim.consts.heal_decay_rate = 0.05; sim.consts.heal_decay_min = 0.2;
  sim.time = 5; assert.equal(sim.healMult, 1, "起始前不衰减");
  sim.time = 10; assert.equal(sim.healMult, 1, "起点不衰减");
  sim.time = 14; assert.ok(Math.abs(sim.healMult - 0.8) < 1e-9, "10s 后按 0.05/s 衰减");
  sim.time = 100; assert.equal(sim.healMult, 0.2, "不低于下限");
});

test("治疗衰减作用于奶妈普攻治疗量", () => {
  const healer = makeCfg("healer", { cls: "healer", mgc: 100, row: "back", slot: 0 });
  const ally = makeCfg("ally", { hp: 1000, row: "front", slot: 0 });
  const foe = makeCfg("foe", { hp: 5000, atk: 200, row: "front", slot: 0 });
  const sim = new Sim({ player: [healer, ally], enemy: [foe], consts: { battle_hp_scale: 1, heal_decay_start: 2, heal_decay_rate: 0.1, heal_decay_min: 0.2 } }, 1);
  sim.byId("ally").hp = 500;
  let early = 0, late = 0, t = 0;
  while (t < 8 && (!early || !late)) {
    sim.step(SIM_STEP); t += SIM_STEP;
    for (const e of sim.events.splice(0)) {
      if (e.type === "heal" && e.src === "healer" && e.tgt === "ally") {
        if (sim.time <= 2 && !early) early = e.amount;
        if (sim.time >= 4 && !late) late = e.amount;
      }
    }
  }
  assert.ok(early > 0 && late > 0, `应采到早晚两次治疗（early=${early} late=${late}）`);
  assert.ok(late < early * 0.9, `衰减后治疗应明显下降（${early} → ${late}）`);
});

test("CSV 常量驱动战斗结果：改 battle_hp_scale 改变战斗状态", () => {
  const base = loadCsvs();
  const scaledCsv = base.constsCsv.replace(/^battle_hp_scale,.*/m, "battle_hp_scale,4.0,测试加倍");
  assert.notEqual(scaledCsv, base.constsCsv, "常量表应被修改");
  const mk = (constsCsv) => buildTeams({ ...base, constsCsv, playerFormation: MIRROR_PLAYER, enemyFormation: MIRROR_ENEMY });
  const hpLeftAt = (teams, tEnd) => {
    const sim = new Sim(teams, 7);
    sim.autoUlt = true;
    let t = 0;
    while (sim.winner < 0 && t < tEnd) { sim.step(SIM_STEP); t += SIM_STEP; }
    return sim.units.filter((u) => u.alive).reduce((a, u) => a + u.hp, 0);
  };
  const hpBase = hpLeftAt(mk(base.constsCsv), 15);
  const hpScaled = hpLeftAt(mk(scaledCsv), 15);
  assert.ok(hpScaled > hpBase, `提高血量倍率后 15s 时剩余血量应更多（${hpBase} → ${hpScaled}）`);
});

test("小技能事件携带表现类别 kind（特效环不再走死分支）", () => {
  const sim = new Sim(teamsFor(), 3);
  sim.autoUlt = true;
  const kinds = new Set();
  let t = 0;
  while (sim.winner < 0 && t < 120) {
    sim.step(SIM_STEP); t += SIM_STEP;
    for (const e of sim.events.splice(0)) {
      if (e.type !== "smallfx") continue;
      assert.ok(["thunder", "whirl", "slam", "support"].includes(e.kind), `smallfx 未知 kind=${e.kind}`);
      kinds.add(e.kind);
    }
  }
  assert.ok(kinds.size >= 2, `镜像战应覆盖多种小技能类别（实际 ${[...kinds].join("/")}）`);
});

test("_smallKind 映射：法系→thunder、物理AOE→whirl、物理单体→slam、其他→support", () => {
  const mk = (effects, scope = "single") =>
    new Sim({ player: [makeCfg("a", { small: makeSmall(effects, scope) })], enemy: [makeCfg("b")] }, 1).byId("a");
  const sim = new Sim(teamsFor(), 1);
  assert.equal(sim._smallKind(mk("mgc_dmg(1.2);paralyze(1)")), "thunder");
  assert.equal(sim._smallKind(mk("phys_dmg(1.1)", "aoe_all")), "whirl");
  assert.equal(sim._smallKind(mk("phys_dmg(1.3)")), "slam");
  assert.equal(sim._smallKind(mk("heal(1.0)", "allies")), "support");
});
