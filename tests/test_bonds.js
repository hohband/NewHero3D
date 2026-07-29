// 4.2 羁绊系统 · 无头测试
import { test } from "node:test";
import assert from "node:assert/strict";
import { Sim, loadCsvs, MIRROR_ENEMY } from "./helpers.js";
import { buildTeams } from "../src/prototype/data.js";

const csvs = loadCsvs();

test("羁绊双方在场：攻防 +5% 并产事件", () => {
  // lin_chong bonds: lu_zhishen|结义
  const teams = buildTeams({
    ...csvs,
    playerFormation: [
      { id: "lin_chong", row: "front", slot: 0 },
      { id: "lu_zhishen", row: "front", slot: 1 },
      { id: "wu_song", row: "front", slot: 2 },
    ],
    enemyFormation: MIRROR_ENEMY,
  });
  const sim = new Sim(teams, 1);
  const bondEvents = sim.events.filter((e) => e.type === "bond");
  assert.ok(bondEvents.some((e) => e.a === "lin_chong" && e.b === "lu_zhishen"), "结义羁绊应触发");
  const lc = sim.byId("lin_chong"), lz = sim.byId("lu_zhishen");
  assert.ok(lc._buffSum("atk") >= 0.05 && lc._buffSum("def") >= 0.05, "林冲吃羁绊加成");
  assert.ok(lz._buffSum("atk") >= 0.05, "鲁智深吃羁绊加成");
  // 公孙胜的羁绊对象（宋江等）不在场，不得有加成
  const teams2 = buildTeams({
    ...csvs,
    playerFormation: [
      { id: "gongsun_sheng", row: "back", slot: 0 },
      { id: "wu_song", row: "front", slot: 0 },
    ],
    enemyFormation: MIRROR_ENEMY,
  });
  const sim2 = new Sim(teams2, 1);
  assert.equal(sim2.byId("gongsun_sheng")._buffSum("atk"), 0, "羁绊对象不在场无加成");
});

test("羁绊对象不在场：不触发", () => {
  const teams = buildTeams({
    ...csvs,
    playerFormation: [
      { id: "gongsun_sheng", row: "back", slot: 0 },
      { id: "an_daoquan", row: "back", slot: 1 },
    ],
    enemyFormation: MIRROR_ENEMY,
  });
  const sim = new Sim(teams, 1);
  const playerIds = new Set(["gongsun_sheng", "an_daoquan"]);
  assert.ok(!sim.events.some((e) => e.type === "bond" && (playerIds.has(e.a) || playerIds.has(e.b))), "我方无羁绊对不得触发");
});
