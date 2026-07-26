// 伤害公式与 CTB 行动顺序测试
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadDataTables } from "../src/core/node_data.js";
import { Unit, Team } from "../src/core/unit.js";
import { Grid } from "../src/core/grid.js";
import { TurnOrder } from "../src/core/turn_order.js";
import { FixedRollSource } from "../src/core/roll_source.js";
import * as Dmg from "../src/core/damage_calculator.js";

const data = loadDataTables();

function makeUnit(id, team, x, y) {
  const grid = new Grid(data, { x: 8, y: 8 });
  const u = new Unit(data.getUnit(id), team, { x, y });
  grid.placeUnit(u, { x, y });
  grid.unitsRef = [u];
  return { u, grid };
}

test("闪避：roll < dodge 完全免伤", () => {
  const { u: atk, grid } = makeUnit("lin_chong", Team.PLAYER, 0, 0);
  const { u: def } = makeUnit("wang_dingliu", Team.ENEMY, 0, 1); // dodge 18
  grid.unitsRef.push(def);
  grid.placeUnit(def, { x: 0, y: 1 });
  const rolls = new FixedRollSource([0]); // 0 < 18 → 闪避
  const r = Dmg.compute(atk, def, 1.0, grid, rolls);
  assert.equal(r.hit, false);
  assert.equal(r.dodged, true);
  assert.equal(r.amount, 0);
});

test("基础公式：atk×mult×100/(100+def)，方位与高低差加算", () => {
  const { u: atk, grid } = makeUnit("xiangjun_recruit", Team.PLAYER, 0, 0); // atk 80
  const { u: def } = makeUnit("xiangjun_recruit", Team.ENEMY, 0, 1); // def 45
  grid.unitsRef.push(def);
  grid.placeUnit(def, { x: 0, y: 1 });
  def.facing = { x: 0, y: -1 }; // 面朝攻击者 → 与攻击方向相反 → 正面 +0
  const rolls = new FixedRollSource([100, 100, 100]); // 不闪不暴不格挡
  const r = Dmg.compute(atk, def, 1.0, grid, rolls);
  assert.equal(r.amount, Math.max(1, Math.round(80 * 100 / 145)));
});

test("背刺 +25% 与暴击 ×1.5、格挡 ×0.7", () => {
  const { u: atk, grid } = makeUnit("xiangjun_recruit", Team.PLAYER, 0, 0); // atk 80
  const { u: def } = makeUnit("xiangjun_shield", Team.ENEMY, 0, 1); // def 85, block 25
  grid.unitsRef.push(def);
  grid.placeUnit(def, { x: 0, y: 1 });
  def.facing = { x: 0, y: 1 }; // 背对攻击者 → 攻击方向 == 朝向 → 背刺
  const rolls = new FixedRollSource([100, 0, 0]); // 不闪避、暴击、格挡
  const r = Dmg.compute(atk, def, 1.0, grid, rolls);
  const base = 80 * 100 / 185;
  assert.equal(r.crit, true);
  assert.equal(r.blocked, true);
  assert.equal(r.dirMod, 0.25);
  assert.equal(r.amount, Math.max(1, Math.round(base * 1.25 * 1.5 * 0.7)));
});

test("CTB：速度高者先动；平局 我方优先", () => {
  const a = new Unit(data.getUnit("lin_chong"), Team.ENEMY, { x: 0, y: 0 });   // spd 88
  const b = new Unit(data.getUnit("shi_yong"), Team.PLAYER, { x: 1, y: 0 });  // spd 58
  const to = new TurnOrder();
  assert.equal(to.nextActor([a, b]), a);
  // 同速平局：team 枚举小者（PLAYER）优先
  const c = new Unit(data.getUnit("lin_chong"), Team.PLAYER, { x: 2, y: 0 });
  const d = new Unit(data.getUnit("lin_chong"), Team.ENEMY, { x: 3, y: 0 });
  const to2 = new TurnOrder();
  assert.equal(to2.nextActor([d, c]).team, Team.PLAYER);
});

test("CTB preview 非破坏且长度正确", () => {
  const a = new Unit(data.getUnit("lin_chong"), Team.PLAYER, { x: 0, y: 0 });
  const b = new Unit(data.getUnit("shi_yong"), Team.ENEMY, { x: 1, y: 0 });
  const to = new TurnOrder();
  const prev = to.preview([a, b], 6);
  assert.equal(prev.length, 6);
  assert.equal(prev[0], a); // 88 > 58 先动
});
