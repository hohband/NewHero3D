// 4.1 横版新效果语义 + 白名单校验 · 无头测试
// 注意：Sim 构造时把 cfg 包装为 Unit 实例，断言必须用 sim.byId 取运行时单位
import { test } from "node:test";
import assert from "node:assert/strict";
import { Sim, SIM_STEP, makeCfg, makeUlt, makeSmall, loadCsvs } from "./helpers.js";
import { buildTeams } from "../src/prototype/data.js";

function simOf(player, enemy, seed = 7) { return new Sim({ player, enemy }, seed); }
function stepN(sim, n) { for (let i = 0; i < n; i++) sim.step(SIM_STEP); }

test("白名单校验：未知效果装配期抛错并点名", () => {
  const csvs = loadCsvs();
  const badSkills = csvs.skillsCsv + "ult_bad,坏技能,lin_chong,ult,manual,line,1,2,enemy,0,100,flying(1),飞,single\n";
  assert.throws(
    () => buildTeams({ ...csvs, skillsCsv: badSkills, playerFormation: [{ id: "lin_chong", row: "front", slot: 0 }], enemyFormation: [{ id: "song_wan", row: "front", slot: 0 }] }),
    /未知效果 "flying".*ult_bad/
  );
});

test("expose：敌后排移到前排并挂易伤", () => {
  const sim = simOf(
    [makeCfg("p1", { ult: makeUlt("expose(4,0.25)") })],
    [makeCfg("e1", { row: "back", cls: "archer", archetype: "archer" })]);
  const p1 = sim.byId("p1"), e1 = sim.byId("e1");
  p1.rage = 100; sim.castUlt(p1);
  assert.equal(e1.row, "front");
  assert.ok(e1.exposeT > 0);
  assert.ok(e1._buffSum("taken") >= 0.25);
  stepN(sim, 45); // 4.5s 后回后排
  assert.equal(e1.row, "back");
});

test("pull_to_front：永久拽到前排", () => {
  const sim = simOf(
    [makeCfg("p1", { ult: makeUlt("pull_to_front") })],
    [makeCfg("e1", { row: "back", cls: "archer", archetype: "archer" })]);
  const p1 = sim.byId("p1"), e1 = sim.byId("e1");
  p1.rage = 100; sim.castUlt(p1);
  assert.equal(e1.row, "front");
  assert.equal(e1.baseRow, "front");
});

test("dash_back：突进后近战可打后排", () => {
  const sim = simOf(
    [makeCfg("p1", { ult: makeUlt("dash_back;phys_dmg(1.0)") })],
    [makeCfg("e1", { row: "front", slot: 0 }), makeCfg("e2", { row: "back", slot: 0, cls: "archer", archetype: "archer", hp: 4000 })]);
  const p1 = sim.byId("p1");
  p1.rage = 100; sim.castUlt(p1);
  assert.ok(p1.dashed);
  assert.ok(sim._pickTarget(p1), "突进后应有目标");
  // 未突进的近战只能打前排
  const sim2 = simOf([makeCfg("q", {})], [makeCfg("f", {}), makeCfg("b", { row: "back", cls: "archer", archetype: "archer" })]);
  assert.equal(sim2._pickTarget(sim2.byId("q")).row, "front");
});

test("silence：单体沉默封技能", () => {
  const sim = simOf(
    [makeCfg("p1", { ult: makeUlt("silence(2)") })],
    [makeCfg("e1", { small: makeSmall("phys_dmg(1.0)", "single", 1) })]);
  const p1 = sim.byId("p1"), e1 = sim.byId("e1");
  p1.rage = 100; sim.castUlt(p1);
  assert.ok(e1.silence > 0);
  sim.events.length = 0;
  stepN(sim, 15); // 1.5s 内小技能 CD 早好但被沉默
  assert.ok(!sim.events.some((e) => e.type === "smallfx"), "沉默期间不得放小技能");
});

test("shield：吸收盾先于 HP 扣除", () => {
  const sim = simOf(
    [makeCfg("p1", { ult: makeUlt("shield(0.5)", "self") })],
    [makeCfg("e1", { atk: 200 })]);
  const p1 = sim.byId("p1");
  p1.rage = 100; sim.castUlt(p1);
  assert.equal(p1.shield, 500);
  sim.events.length = 0;
  stepN(sim, 30);
  assert.ok(sim.events.some((e) => e.type === "shield"), "有护盾吸收事件");
  assert.ok(p1.shield < 500, "盾被消耗");
});

test("energy_drain：抽敌最高怒给己方最低怒", () => {
  const sim = simOf(
    [makeCfg("p1", { ult: makeUlt("energy_drain(30)", "self") })],
    [makeCfg("e1", {})]);
  const p1 = sim.byId("p1"), e1 = sim.byId("e1");
  e1.rage = 80;
  p1.rage = 100; sim.castUlt(p1); // 大招耗光 100 → 0，再被灌 30
  assert.equal(e1.rage, 50);
  assert.equal(p1.rage, 30);
});

test("act_now：队友攻击立即就绪", () => {
  const sim = simOf(
    [makeCfg("p1", { atk: 50, ult: makeUlt("act_now(1)", "allies") }), makeCfg("p2", { atk: 200 })],
    [makeCfg("e1", { hp: 4000 })]);
  const p1 = sim.byId("p1"), p2 = sim.byId("p2");
  p2.atkTimer = 5;
  p1.rage = 100; sim.castUlt(p1);
  assert.equal(p2.atkTimer, 0);
});

test("invuln_dying：锁血最低 1", () => {
  const sim = simOf(
    [makeCfg("p1", { ult: makeUlt("invuln_dying(2)", "self") })],
    [makeCfg("e1", { atk: 5000 })]);
  const p1 = sim.byId("p1"), e1 = sim.byId("e1");
  e1.x = p1.x + 1; // 贴脸，保证锁血窗口内必被打
  p1.rage = 100; sim.castUlt(p1);
  p1.hp = 50;
  stepN(sim, 15); // 1.5s 内 e1 必出手，但锁血 2s 未过期
  assert.ok(p1.alive);
  assert.equal(p1.hp, 1);
});

test("heal_cut：目标受疗减半", () => {
  const sim = simOf(
    [makeCfg("p1", { ult: makeUlt("heal_cut(0.5,3)", "single_lowest") })],
    [makeCfg("e1", { cls: "healer", archetype: "healer", mgc: 100 }), makeCfg("e2", { hp: 2000 })]);
  const p1 = sim.byId("p1"), e2 = sim.byId("e2");
  e2.hp = 500; // 让奶妈有治疗对象
  p1.rage = 100; sim.castUlt(p1);
  assert.ok(e2._buffSum("heal_cut") >= 0.5);
  sim.events.length = 0;
  stepN(sim, 40);
  const heals = sim.events.filter((e) => e.type === "heal" && e.tgt === "e2");
  assert.ok(heals.length > 0, "奶妈应治疗");
  assert.ok(heals.every((h) => h.amount <= Math.round(100 * 0.9 * 0.5) + 1), "治疗量被减疗");
});

test("counter：反击状态回击攻击者", () => {
  const sim = simOf(
    [makeCfg("p1", { ult: makeUlt("counter(2)", "self"), atk: 200 })],
    [makeCfg("e1", {})]);
  const p1 = sim.byId("p1"), e1 = sim.byId("e1");
  e1.x = p1.x + 1; // 贴脸省去走位
  p1.rage = 100; sim.castUlt(p1);
  assert.ok(p1.counterT > 0);
  sim.events.length = 0;
  stepN(sim, 20);
  assert.ok(sim.events.some((e) => e.type === "counter"), "应触发反击");
  assert.ok(e1.hp < e1.maxHp, "攻击者被反伤");
});

test("steal_buff：偷取目标增益", () => {
  const sim = simOf(
    [makeCfg("p1", { ult: makeUlt("steal_buff(1)") })],
    [makeCfg("e1", {})]);
  const p1 = sim.byId("p1"), e1 = sim.byId("e1");
  e1.buffs.push({ field: "atk", val: 0.2, t: 5 });
  p1.rage = 100; sim.castUlt(p1);
  assert.ok(p1._buffSum("atk") >= 0.2, "增益被偷到己方");
  assert.equal(e1._buffSum("atk"), 0, "敌方增益被移除");
});

test("poison：持续伤害按秒扣血", () => {
  const sim = simOf(
    [makeCfg("p1", { ult: makeUlt("poison(3)") })],
    [makeCfg("e1", { hp: 5000 })]);
  const p1 = sim.byId("p1"), e1 = sim.byId("e1");
  const before = e1.hp;
  p1.rage = 100; sim.castUlt(p1);
  assert.ok(e1._buffSum("dot") > 0);
  stepN(sim, 10); // 1s → 2% maxHp
  assert.ok(e1.hp < before, "DoT 扣血");
});

test("aura：全队永久增益", () => {
  const sim = simOf(
    [makeCfg("p1", { ult: makeUlt("aura(atk+0.2,r99)", "self") }), makeCfg("p2", {})],
    [makeCfg("e1", {})]);
  const p1 = sim.byId("p1"), p2 = sim.byId("p2");
  p1.rage = 100; sim.castUlt(p1);
  assert.ok(p1._buffSum("atk") >= 0.2);
  assert.ok(p2._buffSum("atk") >= 0.2, "队友同享光环");
});
