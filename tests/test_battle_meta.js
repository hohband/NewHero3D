// 战斗管理器与元游戏测试
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadDataTables } from "../src/core/node_data.js";
import { getLevel, listIds } from "../src/core/levels.js";
import { BattleManager, State, AutoMode } from "../src/core/battle_manager.js";
import { RandomRollSource, FixedRollSource } from "../src/core/roll_source.js";
import { WaitCommand, ItemCommand } from "../src/core/commands.js";
import { Team } from "../src/core/unit.js";
import { PlayerProfile } from "../src/core/meta/player_profile.js";
import * as Progression from "../src/core/meta/progression.js";
import * as Flow from "../src/core/meta/flow.js";

const data = loadDataTables();

function setupBattle(levelId, seed = 42) {
  const m = new BattleManager(data, new RandomRollSource(seed));
  const level = getLevel(levelId);
  m.setupLevel(level);
  for (const id of level.roster) {
    const cell = m._firstFreeDeployCell();
    if (!cell) break;
    if (m.deployed.length >= level.max_deploy) break;
    m.deployUnit(id, cell);
  }
  return m;
}

test("待机：+15 怒气、wait_def 1 回合不可驱散", () => {
  const m = setupBattle("ch01_01");
  m.startBattle();
  const unit = m.activeUnit;
  const rageBefore = unit.rage;
  m.submitCommand(new WaitCommand(unit));
  assert.equal(unit.rage, rageBefore + 15);
  const buff = unit.buffs.find((b) => b.buff_id === "wait_def");
  assert.ok(buff);
  assert.equal(buff.dispellable, false);
  assert.equal(buff.stat_mods.def, 20);
});

test("道具：借道技能结算、扣次数、占行动", () => {
  const m = setupBattle("ch01_01");
  m.startBattle();
  const unit = m.activeUnit;
  unit.hp = Math.max(1, unit.hp - 100); // 制造缺口
  const left = m.itemUsesLeft("jinchuangyao");
  const item = data.getItem("jinchuangyao");
  m.submitCommand(new ItemCommand(unit, item, unit));
  assert.equal(m.itemUsesLeft("jinchuangyao"), left - 1);
  assert.equal(m.actionUsed, true);
});

test("AI 托管：ch01_01 我方胜利", () => {
  const m = setupBattle("ch01_01");
  m.autoMode = AutoMode.FULL;
  let winner = null;
  m.on("battle_ended", (w) => { winner = w; });
  m.startBattle();
  let guard = 0;
  while (m.state !== State.BATTLE_END && guard++ < 2000) m.runAi();
  assert.equal(winner, Team.PLAYER);
  assert.ok(m.roundCount > 0 && m.roundCount < 30);
});

test("胜负判定：SURVIVE_TURNS 到回合数即胜", () => {
  const m = setupBattle("ch01_04"); // 坚守 5 回合
  m.autoMode = AutoMode.FULL;
  let winner = null;
  m.on("battle_ended", (w) => { winner = w; });
  m.startBattle();
  let guard = 0;
  while (m.state !== State.BATTLE_END && guard++ < 3000) m.runAi();
  // 坚守关要么满 5 回合胜、要么全灭败
  if (winner === Team.PLAYER) assert.ok(m.roundCount >= 5);
  else assert.equal(winner, Team.ENEMY);
});

test("结算：computeResult 含奖励与评价", () => {
  const m = setupBattle("ch01_01");
  m.autoMode = AutoMode.FULL;
  m.startBattle();
  let guard = 0;
  while (m.state !== State.BATTLE_END && guard++ < 2000) m.runAi();
  const result = m.computeResult(Team.PLAYER);
  assert.ok(result.rewards.first_clear.gold > 0);
});

// —— 元游戏 ——
test("养成公式：等级/星级/突破/强化乘区", () => {
  const profile = PlayerProfile.newDefault(data);
  const hero = profile.heroes.shi_yong;
  const base = data.getUnit("shi_yong");
  // 1 级 1 星：与基础一致
  let d = Progression.computeUnitData(data, hero, base);
  assert.equal(d.hp, base.hp);
  assert.equal(d.atk, base.atk);
  // 升到 11 级（+20%）
  hero.level = 11;
  d = Progression.computeUnitData(data, hero, base);
  assert.equal(d.hp, Math.round(base.hp * 1.2));
  // 2 星（再 ×1.1）
  hero.star = 2;
  d = Progression.computeUnitData(data, hero, base);
  assert.equal(d.hp, Math.round(base.hp * 1.2 * 1.1));
  // 强化 2 级武器（atk +6%）
  hero.weapon_enhance = 2;
  d = Progression.computeUnitData(data, hero, base);
  assert.equal(d.atk, Math.round(base.atk * 1.2 * 1.1 * 1.06));
});

test("addExp 循环升级", () => {
  const profile = PlayerProfile.newDefault(data);
  const hero = profile.heroes.shi_yong;
  const ups = Progression.addExp(data, hero, 250); // 1→2 需 100；2→3 需 200，不足
  assert.equal(ups, 1);
  assert.equal(hero.level, 2);
  assert.equal(hero.exp, 150);
});

test("存档序列化往返", () => {
  const profile = PlayerProfile.newDefault(data);
  profile.gold = 1234;
  profile.progress.cleared.push("ch01_01");
  profile.heroes.shi_yong.level = 5;
  const restored = PlayerProfile.fromDict(JSON.parse(JSON.stringify(profile.toDict())));
  assert.equal(restored.gold, 1234);
  assert.deepEqual(restored.progress.cleared, ["ch01_01"]);
  assert.equal(restored.heroes.shi_yong.level, 5);
  assert.equal(restored.settings.volume_master, 1.0);
});

test("Flow 结算：发奖励/经验/推章/发将", () => {
  const profile = PlayerProfile.newDefault(data);
  const level = getLevel("ch01_01");
  const goldBefore = profile.gold;
  const result = { winner: Team.PLAYER, rank: null, achievements: [], rewards: level.rewards };
  const fakeDeployed = [];
  const summary = Flow.applyBattleResult(profile, level, result, data, fakeDeployed);
  assert.equal(summary.victory, true);
  assert.equal(profile.gold, goldBefore + 400 + 100); // 首通 400 + 聚义厅收获 100
  assert.ok(profile.progress.cleared.includes("ch01_01"));
  // 山寨聚义厅 1 级：+100 金
  assert.equal(summary.village.gold, 100);
});

test("招募：碎片×20 招募聚义厅武将", () => {
  const profile = PlayerProfile.newDefault(data);
  profile.gainItem("shard", 20); // 初始 20 + 20 = 40
  const r = Flow.recruit(profile, data, "dai_zong");
  assert.equal(r.ok, true);
  assert.ok(profile.hasHero("dai_zong"));
  assert.equal(profile.itemCount("shard"), 20);
});

test("全部关卡可加载且坐标合法", () => {
  const ids = listIds();
  assert.equal(ids.length, 26);
  for (const id of ids) {
    const l = getLevel(id);
    const [w, h] = l.grid_size;
    const inBounds = ([x, y]) => x >= 0 && y >= 0 && x < w && y < h;
    for (const e of [...l.enemies, ...l.npc_allies, ...l.objects]) {
      assert.ok(inBounds(e.coords), `${id} 单位 ${e.unit || e.id} 坐标越界`);
    }
    for (const key of Object.keys(l.terrain_map)) {
      const [x, y] = key.split(",").map(Number);
      assert.ok(inBounds([x, y]), `${id} 地形 ${key} 越界`);
      assert.ok(data.getTerrain(l.terrain_map[key]), `${id} 未知地形 ${l.terrain_map[key]}`);
    }
  }
});
