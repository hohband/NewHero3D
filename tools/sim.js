// 数值平衡/回归模拟（对应 Godot 版 balance_sim.gd）
// 用法：node tools/sim.js [--runs N] [--level id]
// 用满级养成近似值跑全关卡 AI 托管，输出胜率/平均回合。
import { loadDataTables } from "../src/core/node_data.js";
import { getLevel, listIds } from "../src/core/levels.js";
import { BattleManager, State, AutoMode } from "../src/core/battle_manager.js";
import { RandomRollSource } from "../src/core/roll_source.js";
import { Team } from "../src/core/unit.js";
import { PlayerProfile } from "../src/core/meta/player_profile.js";
import * as Progression from "../src/core/meta/progression.js";

const data = loadDataTables();
const args = process.argv.slice(2);
const runs = args.includes("--runs") ? parseInt(args[args.indexOf("--runs") + 1], 10) : 5;
const only = args.includes("--level") ? args[args.indexOf("--level") + 1] : null;

// 模拟一个跟上章节进度的档案：全武将、等级=推荐等级
function makeProfile(recLevel) {
  const p = PlayerProfile.newDefault(data);
  for (const id of data.heroIds) p.addHero(id, data.getUnit(id).quality);
  for (const h of Object.values(p.heroes)) {
    h.level = Math.max(1, recLevel);
    Progression.addExp(data, h, 0);
  }
  return p;
}

function runOnce(level, profile, seed) {
  const m = new BattleManager(data, new RandomRollSource(seed));
  const getHeroData = (unitId) => {
    const hero = profile.heroes[unitId];
    if (!hero) return null;
    return { hero, data: Progression.computeUnitData(data, hero, data.getUnit(unitId)) };
  };
  m.setupLevel(level, getHeroData);
  // 花名册 ∩ 拥有，按等级降序部署
  const candidates = level.roster.filter((id) => profile.hasHero(id));
  const allowed = level.allowed_classes || [];
  for (const id of candidates) {
    if (m.deployed.length >= level.max_deploy) break;
    if (m.deployed.some((d) => d.unitId === id)) continue;
    if (allowed.length && !allowed.includes(data.getUnit(id).unit_class)) continue;
    const cell = m._firstFreeDeployCell();
    if (!cell) break;
    const r = m.deployUnit(id, cell, getHeroData(id));
    if (!r.ok) break;
  }
  m.autoMode = AutoMode.FULL;
  let winner = null;
  m.on("battle_ended", (w) => { winner = w; });
  const start = m.startBattle();
  if (!start.ok) return { error: start.reason };
  let guard = 0;
  while (m.state !== State.BATTLE_END && guard++ < 3000) m.runAi();
  if (guard >= 3000) return { error: "超时未分胜负" };
  return { winner, rounds: m.roundCount };
}

const ids = only ? [only] : listIds().filter((id) => id !== "debug_01");
console.log(`每关 ${runs} 场 AI 托管模拟：`);
let totalWin = 0;
let totalRuns = 0;
for (const id of ids) {
  const level = getLevel(id);
  let wins = 0;
  let roundsSum = 0;
  let errors = [];
  for (let r = 0; r < runs; r++) {
    const profile = makeProfile(level.recommended_level);
    const res = runOnce(level, profile, 1000 + r * 77 + id.length);
    if (res.error) { errors.push(res.error); continue; }
    if (res.winner === Team.PLAYER) wins++;
    roundsSum += res.rounds;
    totalRuns++;
  }
  totalWin += wins;
  const avgRounds = (roundsSum / Math.max(1, runs - errors.length)).toFixed(1);
  const errText = errors.length ? ` 错误:${[...new Set(errors)].join(",")}` : "";
  console.log(`${id.padEnd(20)} 胜率 ${wins}/${runs}  平均回合 ${avgRounds}${errText}`);
}
console.log(`总胜率 ${totalWin}/${totalRuns}`);
