// 4.3 托管与敌方 AI 大招时机 · 无头测试
import { test } from "node:test";
import assert from "node:assert/strict";
import { Sim, SIM_STEP, makeCfg, makeUlt } from "./helpers.js";

function stepN(sim, n, drain = true) {
  for (let i = 0; i < n; i++) {
    sim.step(SIM_STEP);
    if (drain) sim.events.length = 0;
  }
}

test("敌方奶妈留大：友军健康时不放，残血才放", () => {
  const sim = new Sim({
    player: [makeCfg("p1", { atk: 30 })],
    enemy: [makeCfg("eh", { cls: "healer", archetype: "healer", mgc: 80, ult: makeUlt("heal(1.5)", "allies") }), makeCfg("et", { hp: 3000 })],
  }, 3);
  const healer = sim.byId("eh"), tank = sim.byId("et");
  healer.rage = 100;
  stepN(sim, 20);
  assert.ok(healer.rage === 100, "友军健康，奶妈留大");
  tank.hp = tank.maxHp * 0.5; // 压到 70% 以下
  stepN(sim, 15);
  assert.ok(healer.rage < 100, "友军残血，奶妈放大");
});

test("敌方输出留大反制：我方蓄大时不放", () => {
  const sim = new Sim({
    player: [makeCfg("p1", { hp: 3000 })],
    enemy: [makeCfg("ed", { atk: 200, ult: makeUlt("phys_dmg(2.0)") })],
  }, 3);
  const dps = sim.byId("ed"), p1 = sim.byId("p1");
  dps.rage = 100; p1.rage = 95; // 我方蓄大 → 反制保留
  stepN(sim, 15);
  assert.ok(dps.rage === 100, "我方蓄大时敌方留大");
  p1.rage = 10; // 反制解除
  stepN(sim, 15);
  assert.ok(dps.rage < 100, "无反制压力即放");
});

test("敌方输出大招：可斩杀优先放（即使我方蓄大）", () => {
  const sim = new Sim({
    player: [makeCfg("p1", { hp: 3000 })],
    enemy: [makeCfg("ed", { atk: 200, ult: makeUlt("phys_dmg(2.0)") })],
  }, 3);
  const dps = sim.byId("ed"), p1 = sim.byId("p1");
  p1.hp = 100; // 可斩杀
  p1.rage = 95;  // 我方蓄大中
  dps.rage = 100;
  stepN(sim, 15);
  assert.ok(dps.rage < 100 || !p1.alive, "斩杀优先，不留大");
});

test("玩家托管 autoUlt：输出怒满自动放", () => {
  const sim = new Sim({
    player: [makeCfg("p1", { atk: 200, ult: makeUlt("phys_dmg(2.0)") })],
    enemy: [makeCfg("e1", { hp: 4000 })],
  }, 3);
  sim.autoUlt = true;
  sim.byId("p1").rage = 100;
  stepN(sim, 3);
  assert.ok(sim.byId("p1").rage < 100, "托管自动放大");
});

test("手动模式：玩家大招不自动放", () => {
  const sim = new Sim({
    player: [makeCfg("p1", { atk: 200, ult: makeUlt("phys_dmg(2.0)") })],
    enemy: [makeCfg("e1", { hp: 4000 })],
  }, 3);
  sim.byId("p1").rage = 100;
  stepN(sim, 10);
  assert.equal(sim.byId("p1").rage, 100, "手动模式搁置");
});
