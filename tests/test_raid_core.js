// 劫寨逻辑层单元测试 —— 验证 RealTimeBattleManager 无 three 依赖可独立运行
import test from "node:test";
import assert from "node:assert/strict";
import { RealTimeBattleManager } from "../src/raid/core/manager.js";
import { FixedRollSource } from "../src/core/roll_source.js";
import { HEROES, LEVEL } from "../src/raid/core/data.js";

function newBattle() {
  const bm = new RealTimeBattleManager(new FixedRollSource([50]));
  bm.loadLevel();
  return bm;
}

// 快进 n 秒（按 50ms 步长）
function run(bm, seconds) {
  const steps = Math.round(seconds / 0.05);
  for (let i = 0; i < steps; i++) bm._step(0.05);
}

test("初始化：地图/建筑/守军/Boss/核心就绪", () => {
  const bm = newBattle();
  assert.ok(bm.grid);
  assert.ok(bm.core, "核心存在");
  assert.ok(bm.boss, "Boss 存在");
  assert.ok(bm.buildings.some(b => b.kind === "wall"), "有墙");
  assert.ok(bm.buildings.some(b => b.kind === "tower"), "有塔");
  assert.equal(bm.bingfu, LEVEL.bingfu);
  assert.equal(bm.liangcao, LEVEL.liangcao);
  assert.equal(bm.phase, "scout");
});

test("部署许可顺序：再部署冷却→同名→兵符→在场", () => {
  const bm = newBattle();
  bm.start();
  const spawn = LEVEL.spawnPoints[0];
  // 部署鲁智深成功
  const u = bm.deploy("luzhishen", spawn);
  assert.ok(u, "首次部署成功");
  // 同名在场 → 拒绝
  const chk = bm.canDeploy("luzhishen", bm.time);
  assert.equal(chk.ok, false);
  assert.equal(chk.reason, "same_name");
  // 兵符扣除
  assert.equal(bm.bingfu, LEVEL.bingfu - HEROES.luzhishen.cost);
});

test("兵符预算耗尽后拒绝部署", () => {
  const bm = newBattle();
  bm.start();
  const spawn = LEVEL.spawnPoints[0];
  bm.bingfu = 3; // 只够一个普通将
  assert.ok(bm.deploy("yanqing", spawn));
  const chk = bm.canDeploy("gongsunsheng", bm.time); // 传奇 10
  assert.equal(chk.ok, false);
  assert.equal(chk.reason, "bingfu");
});

test("撤兵：不返还兵符、计 alive、进 20s 冷却", () => {
  const bm = newBattle();
  bm.start();
  const spawn = LEVEL.spawnPoints[0];
  const before = bm.bingfu;
  const u = bm.deploy("linchong", spawn);
  const after = bm.bingfu;
  assert.equal(before - after, HEROES.linchong.cost);
  bm.retreat(u.uid);
  assert.equal(bm.bingfu, after, "撤兵不返还兵符");
  const chk = bm.canDeploy("linchong", bm.time);
  assert.equal(chk.ok, false);
  assert.equal(chk.reason, "redeploy_cd");
});

test("墙可被破，破墙后流场/路径更新", () => {
  const bm = newBattle();
  bm.start();
  const wall = bm.buildings.find(b => b.kind === "wall");
  assert.ok(wall);
  bm._damageWall(wall, 9999, bm.time);
  assert.ok(wall.destroyed, "墙被摧毁");
  assert.ok(bm.alertLevel >= 2, "破墙提升警报");
});

test("粮草：所有主动技耗粮草，耗尽拒绝", () => {
  const bm = newBattle();
  bm.start();
  const spawn = LEVEL.spawnPoints[0];
  const u = bm.deploy("gongsunsheng", spawn);
  const before = bm.liangcao;
  u.cdUntil = 0;
  bm.castSkill(u.uid, { x: u.x, y: u.y });
  assert.equal(bm.liangcao, before - HEROES.gongsunsheng.lc, "释放耗粮草");
  bm.liangcao = 0;
  u.cdUntil = 0;
  const ok = bm.castSkill(u.uid, { x: u.x, y: u.y });
  assert.equal(ok, false, "粮草耗尽拒绝");
});

test("怒气满可无视冷却放大招", () => {
  const bm = newBattle();
  bm.start();
  const spawn = LEVEL.spawnPoints[0];
  const u = bm.deploy("likui", spawn);
  u.rage = 100; // 满怒
  u.cdUntil = bm.time + 99; // 冷却中
  const before = bm.liangcao;
  const ok = bm.castSkill(u.uid, {});
  assert.ok(ok, "满怒可放大招");
  assert.equal(bm.liangcao, before, "大招不耗粮草");
  assert.equal(u.rage, 0, "怒气清空");
});

test("哨兵发现→点火→警报升级", () => {
  const bm = newBattle();
  bm.start();
  const sentry = bm.units.find(u => u.kind === "sentry");
  assert.ok(sentry);
  // 在哨兵视野内部署并钉住（持续处于视野内）
  const u = bm.deploy("yanqing", { x: sentry.x, y: sentry.y - 1 });
  for (let i = 0; i < 80; i++) { bm._step(0.05); u.x = sentry.x; u.y = sentry.y - 1; }
  assert.ok(sentry.ignited, "哨兵点火");
  assert.ok(bm.alertLevel >= 2, "警报升级");
});

test("Boss 存活时核心不可被攻击，击败后可毁", () => {
  const bm = newBattle();
  bm.start();
  const spawn = LEVEL.spawnPoints[0];
  // Boss 存活：最近目标不含核心
  const hero = bm.deploy("luzhishen", { x: bm.core.x, y: bm.core.y - 1 });
  const obj = bm._nearestObjective(hero);
  assert.ok(!obj || obj.kind !== "core", "Boss 存活核心不可攻");
  // 击杀 Boss
  bm.boss.takeDamage(9999, bm.time);
  bm._step(0.05);
  assert.ok(!bm.boss.alive);
  // 毁核心 → 胜利
  bm._damageBuilding(bm.core, 9999, bm.time);
  assert.ok(bm.result && bm.result.win, "毁核心胜利");
});

test("三星：毁核心+50%建筑+剩兵/用时", () => {
  const bm = newBattle();
  bm.start();
  // 直接胜利
  bm.boss.takeDamage(9999, bm.time);
  bm._step(0.05);
  bm._damageBuilding(bm.core, 9999, bm.time);
  assert.ok(bm.result.win);
  assert.ok(bm.result.stars >= 1 && bm.result.stars <= 3);
});

test("超时判负", () => {
  const bm = newBattle();
  bm.start();
  bm.elapsed = 9999;
  bm._step(0.05);
  assert.ok(bm.result);
  assert.equal(bm.result.win, false);
  assert.equal(bm.result.reason, "timeout");
});

test("拨济：20-30% 比例结算声望", () => {
  const bm = newBattle();
  bm.start();
  bm.boss.takeDamage(9999, bm.time);
  bm._step(0.05);
  bm._damageBuilding(bm.core, 9999, bm.time);
  const relief = bm.applyRelief(0.30);
  assert.ok(relief);
  assert.equal(relief.ratio, 0.30);
  assert.ok(relief.renown > 0);
  assert.equal(relief.net + relief.amount, bm.result.loot);
});

test("吴用召唤受独立 summon_cap 限制", () => {
  const bm = newBattle();
  bm.start();
  const spawn = LEVEL.spawnPoints[0];
  const u = bm.deploy("wuyong", spawn);
  u.cdUntil = 0;
  bm.castSkill(u.uid, {});
  assert.ok(bm.summonCount > 0 && bm.summonCount <= LEVEL.summonCap);
});
