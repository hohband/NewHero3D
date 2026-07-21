// 网格寻路与效果系统测试
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadDataTables } from "../src/core/node_data.js";
import { Unit, Team } from "../src/core/unit.js";
import { Grid } from "../src/core/grid.js";
import { makeBuff } from "../src/core/buff.js";
import { FixedRollSource } from "../src/core/roll_source.js";
import * as EffectSystem from "../src/core/effect_system.js";

const data = loadDataTables();

test("Dijkstra 可达范围：森林消耗 2，敌军挡路，友军可穿", () => {
  const grid = new Grid(data, { x: 8, y: 8 }, { "2,0": "forest" });
  const mover = new Unit(data.getUnit("lin_chong"), Team.PLAYER, { x: 0, y: 0 });
  const ally = new Unit(data.getUnit("shi_yong"), Team.PLAYER, { x: 1, y: 0 });
  const enemy = new Unit(data.getUnit("xiangjun_spear"), Team.ENEMY, { x: 3, y: 0 });
  grid.placeUnit(mover, { x: 0, y: 0 });
  grid.placeUnit(ally, { x: 1, y: 0 });
  grid.placeUnit(enemy, { x: 3, y: 0 });
  grid.unitsRef = [mover, ally, enemy];
  const reach = grid.getReachable(mover, 3);
  assert.equal(reach.get("3,0"), undefined); // 敌军占位不可停留
  assert.equal(reach.get("2,0"), 3);         // 森林消耗 2 + 平原 1
  assert.ok(reach.has("1,1"));               // 穿过友军到达
});

test("findPath 返回含起点路径；不可达返回空", () => {
  const grid = new Grid(data, { x: 3, y: 3 }, { "1,0": "barricade", "1,1": "barricade", "1,2": "barricade" });
  const mover = new Unit(data.getUnit("shi_yong"), Team.PLAYER, { x: 0, y: 0 });
  grid.placeUnit(mover, { x: 0, y: 0 });
  grid.unitsRef = [mover];
  assert.deepEqual(grid.findPath(mover, { x: 2, y: 0 }), []); // 拒马墙隔断
  const grid2 = new Grid(data, { x: 3, y: 3 });
  const m2 = new Unit(data.getUnit("shi_yong"), Team.PLAYER, { x: 0, y: 0 });
  grid2.placeUnit(m2, { x: 0, y: 0 });
  grid2.unitsRef = [m2];
  const path = grid2.findPath(m2, { x: 2, y: 0 });
  assert.deepEqual(path.map((c) => `${c.x},${c.y}`), ["0,0", "1,0", "2,0"]);
});

test("效果串解析：连击 x4 与修饰词扫描", () => {
  const parsed = EffectSystem.parseEffects("phys_dmg(0.9)x4;rage(+20);sure_hit");
  assert.equal(parsed.length, 3);
  assert.deepEqual(parsed[0], { name: "phys_dmg", args: ["0.9"], times: 4 });
  const mods = EffectSystem.scanModifiers(parsed);
  assert.equal(mods.sure_hit, true);
  assert.equal(mods.rage, undefined); // rage 不是修饰词
});

function battleCtx(actor, target, grid, rollValues) {
  return {
    actor, target, grid, rolls: new FixedRollSource(rollValues),
    mods: {}, depth: 0, summoned: null, battle: null, effectMult: 1.0,
  };
}

test("连击独立结算 + 受击怒气 +10/次", () => {
  const grid = new Grid(data, { x: 8, y: 8 });
  const atk = new Unit(data.getUnit("xiangjun_recruit"), Team.PLAYER, { x: 0, y: 0 });
  const def = new Unit(data.getUnit("lao_duguan"), Team.ENEMY, { x: 0, y: 1 }); // dodge 5
  grid.placeUnit(atk, { x: 0, y: 0 });
  grid.placeUnit(def, { x: 0, y: 1 });
  grid.unitsRef = [atk, def];
  const skill = { skill_id: "t", name: "t", effects: "phys_dmg(0.5)x2", range_shape: "adjacent", target: "enemy" };
  const ctx = battleCtx(atk, def, grid, [100, 100, 100, 100, 100, 100]); // 全部命中
  const events = EffectSystem.execute(skill, ctx);
  const dmgs = events.filter((e) => e.type === "damage");
  assert.equal(dmgs.length, 2);
  assert.equal(def.rage, 20); // 每次受击 +10
});

test("睡眠受击即醒；同 buff_id 刷新不叠层", () => {
  const grid = new Grid(data, { x: 8, y: 8 });
  const atk = new Unit(data.getUnit("xiangjun_recruit"), Team.PLAYER, { x: 0, y: 0 });
  const def = new Unit(data.getUnit("xiangjun_shield"), Team.ENEMY, { x: 0, y: 1 });
  grid.placeUnit(atk, { x: 0, y: 0 });
  grid.placeUnit(def, { x: 0, y: 1 });
  grid.unitsRef = [atk, def];
  // 上睡眠
  const sleepSkill = { skill_id: "s", name: "s", effects: "sleep(2)", range_shape: "diamond", target: "enemy" };
  EffectSystem.execute(sleepSkill, battleCtx(atk, def, grid, []));
  assert.equal(def.canAct(), false);
  // 重复上睡眠：仍只有一个 sleep buff，duration 取 max
  EffectSystem.execute(sleepSkill, battleCtx(atk, def, grid, []));
  assert.equal(def.buffs.filter((b) => b.buff_id === "sleep").length, 1);
  // 受击醒来
  const dmgSkill = { skill_id: "d", name: "d", effects: "phys_dmg(0.5)", range_shape: "adjacent", target: "enemy" };
  EffectSystem.execute(dmgSkill, battleCtx(atk, def, grid, [100, 100, 100]));
  assert.equal(def.hasStatus("sleep"), false);
});

test("DoT 每跳 = 最大生命 5%；警觉特性首睡压到 1 回合", () => {
  const grid = new Grid(data, { x: 8, y: 8 });
  const atk = new Unit(data.getUnit("bai_sheng"), Team.PLAYER, { x: 0, y: 0 });
  const yangzhi = new Unit(data.getUnit("yang_zhi_boss"), Team.ENEMY, { x: 0, y: 1 }); // alert 特性
  grid.placeUnit(atk, { x: 0, y: 0 });
  grid.placeUnit(yangzhi, { x: 0, y: 1 });
  grid.unitsRef = [atk, yangzhi];
  const poison = { skill_id: "p", name: "p", effects: "poison(2)", range_shape: "diamond", target: "enemy" };
  EffectSystem.execute(poison, battleCtx(atk, yangzhi, grid, []));
  const events = yangzhi.tickEffects();
  const dot = events.find((e) => e.type === "dot");
  assert.equal(dot.amount, Math.round(yangzhi.data.hp * 0.05));
  // 警觉：sleep(2) → 1 回合
  const sleep = { skill_id: "s", name: "s", effects: "sleep(2)", range_shape: "diamond", target: "enemy" };
  EffectSystem.execute(sleep, battleCtx(atk, yangzhi, grid, []));
  const sb = yangzhi.buffs.find((b) => b.buff_id === "sleep");
  assert.equal(sb.duration, 1);
});

test("guard 援护只挡远程；counter 反击 depth=1 不互反", () => {
  const grid = new Grid(data, { x: 8, y: 8 });
  const archer = new Unit(data.getUnit("hua_rong"), Team.PLAYER, { x: 0, y: 0 });
  const guarder = new Unit(data.getUnit("shi_yong"), Team.ENEMY, { x: 0, y: 2 });
  const target = new Unit(data.getUnit("du_qian"), Team.ENEMY, { x: 1, y: 2 });
  for (const u of [archer, guarder, target]) grid.placeUnit(u, u.coords);
  grid.unitsRef = [archer, guarder, target];
  guarder.addBuff(makeBuff({ buff_id: "guard", duration: 1, status: "guard" }));
  const skill = { skill_id: "shoot", name: "shoot", effects: "phys_dmg(1.0)", range_shape: "diamond", target: "enemy" };
  const events = EffectSystem.execute(skill, battleCtx(archer, target, grid, [100, 100, 100]));
  const dmg = events.find((e) => e.type === "damage");
  assert.equal(dmg.target, guarder); // 远程被援护
  // 近战（曼哈顿=1）不援护
  const melee = new Unit(data.getUnit("wu_song"), Team.PLAYER, { x: 1, y: 1 });
  grid.placeUnit(melee, { x: 1, y: 1 });
  grid.unitsRef.push(melee);
  target.addBuff(makeBuff({ buff_id: "counter", duration: 1, status: "counter" }));
  const hpBefore = melee.hp;
  const ev2 = EffectSystem.execute(skill, battleCtx(melee, target, grid, [100, 100, 100, 100, 100, 100]));
  const dmg2 = ev2.find((e) => e.type === "damage");
  assert.equal(dmg2.target, target);
  const counterDmg = ev2.filter((e) => e.type === "damage" && e.target === melee);
  assert.equal(counterDmg.length, 1); // 反击一次
  assert.ok(melee.hp < hpBefore);
  assert.equal(ev2.filter((e) => e.type === "damage").length, 2); // 不互反
});
