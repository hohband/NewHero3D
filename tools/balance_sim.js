// 批量无头平衡回归（5.2）：多阵容互打 + 推关，统计胜率/时长分布
// 用法: node tools/balance_sim.js [--runs N] [--seed S] [--json] [--scale X]
// 判定：主流阵容互打胜率无 >70% 的怪物；平均时长 30–60s（用 battle_hp_scale 调）
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildTeams } from "../src/prototype/data.js";
import { Sim, SIM_STEP } from "../src/prototype/sim.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");
const CSV = {
  unitsCsv: read("data/units.csv"),
  skillsCsv: read("data/skills.csv"),
  awakenCsv: read("data/proto_awaken.csv"),
  growthCsv: read("data/growth_curve.csv"),
  constsCsv: read("data/battle_constants.csv"),
  progressionCsv: read("data/progression.csv"),
  wavesCsv: read("data/waves.csv"),
};

const args = process.argv.slice(2);
const opt = { runs: 20, seed: 1, json: false, scale: null };
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--runs") opt.runs = +args[++i];
  else if (args[i] === "--seed") opt.seed = +args[++i];
  else if (args[i] === "--json") opt.json = true;
  else if (args[i] === "--scale") opt.scale = +args[++i];
}

// 主流阵容（archetype 各异）
const SQUADS = {
  旗舰队: ["lu_zhishen", "lin_chong", "wu_song", "gongsun_sheng", "an_daoquan"],
  双坦消耗: ["song_wan", "shi_yong", "wu_song", "an_daoquan", "hua_rong"],
  速攻刺客: ["shi_qian", "yan_qing", "wang_dingliu", "zhang_shun", "hua_rong"],
  法师控制: ["gongsun_sheng", "wu_yong", "bai_sheng", "lu_zhishen", "an_daoquan"],
  物理狂战: ["li_kui", "qin_ming", "xu_ning", "bao_xu", "an_daoquan"],
};
const BACKS = new Set(["archer", "strategist", "healer"]);
import { parseCsvTable } from "../src/shared/csv.js";
const CLS_OF = Object.fromEntries(parseCsvTable(CSV.unitsCsv).map((r) => [r.unit_id, r.class]));
const formationOf = (ids) => ids.map((id, i) => ({
  id, row: BACKS.has(CLS_OF[id]) ? "back" : "front", slot: BACKS.has(CLS_OF[id]) ? ids.slice(0, i).filter((x) => BACKS.has(CLS_OF[x])).length : ids.slice(0, i).filter((x) => !BACKS.has(CLS_OF[x])).length,
}));

function constsCsvWith(scale) {
  if (scale == null) return CSV.constsCsv;
  return CSV.constsCsv.replace(/^battle_hp_scale,.*/m, `battle_hp_scale,${scale},战斗血量全局倍率`);
}

function fight(aIds, bIds, seed) {
  const teams = buildTeams({
    ...CSV, constsCsv: constsCsvWith(opt.scale),
    playerFormation: formationOf(aIds), enemyFormation: formationOf(bIds),
  });
  const sim = new Sim(teams, seed);
  sim.autoUlt = true;
  let t = 0, guard = 0;
  while (sim.winner < 0 && t < 300) { sim.step(SIM_STEP); t += SIM_STEP; if (++guard > 300000) break; }
  return { winner: sim.winner, t };
}

function pushLevel(ids, battleId, level, seed) {
  const heroStates = new Map(ids.map((id) => [id, { level, tier: 3, skill: { small: 1, ult: 1 } }]));
  const teams = buildTeams({
    ...CSV, constsCsv: constsCsvWith(opt.scale),
    playerFormation: formationOf(ids), wavesCsv: CSV.wavesCsv, battleId, heroStates,
  });
  const sim = new Sim(teams, seed);
  sim.autoUlt = true;
  let t = 0, guard = 0;
  while (sim.winner < 0 && t < 300) { sim.step(SIM_STEP); t += SIM_STEP; if (++guard > 300000) break; }
  return { winner: sim.winner, t };
}

const names = Object.keys(SQUADS);
const report = { matrix: {}, durations: [], levels: {}, timeouts: 0 };

// 阵容互打（双向跑，按阵容对聚合，消除 side-0 连锁偏置）
for (let i = 0; i < names.length; i++) {
  for (let j = i + 1; j < names.length; j++) {
    const a = names[i], b = names[j];
    let aWins = 0, ts = 0, timeouts = 0;
    for (let r = 0; r < opt.runs; r++) {
      const f1 = fight(SQUADS[a], SQUADS[b], opt.seed * 1000 + r);
      if (f1.winner === 0) aWins++;
      const f2 = fight(SQUADS[b], SQUADS[a], opt.seed * 2000 + r);
      if (f2.winner === 1) aWins++;
      for (const f of [f1, f2]) { ts += f.t; report.durations.push(f.t); if (f.t >= 119.5) timeouts++; }
    }
    report.matrix[`${a} vs ${b}`] = { winRate: aWins / (opt.runs * 2), avgT: ts / (opt.runs * 2), timeouts };
    report.timeouts += timeouts;
  }
}
// 推关（旗舰队 vs 各关，推荐等级）
const LEVELS = [["story_01", 1], ["story_02", 2], ["story_03", 3], ["story_04", 4], ["story_05", 5]];
for (const [battleId, lv] of LEVELS) {
  let wins = 0, ts = 0;
  for (let r = 0; r < opt.runs; r++) {
    const { winner, t } = pushLevel(SQUADS.旗舰队, battleId, lv, opt.seed * 5000 + r);
    if (winner === 0) wins++;
    ts += t;
  }
  report.levels[battleId] = { winRate: wins / opt.runs, avgT: ts / opt.runs };
}

if (opt.json) { console.log(JSON.stringify(report, null, 1)); process.exit(0); }

const pct = (v) => `${(v * 100).toFixed(0)}%`;
console.log(`\n=== 阵容互打（${opt.runs} 局/对阵，scale=${opt.scale ?? "csv"}）===`);
let monster = false;
for (const [pair, r] of Object.entries(report.matrix)) {
  const flag = r.winRate > 0.7 || r.winRate < 0.3 ? " ⚠️" : "";
  if (flag) monster = true;
  console.log(`${pair.padEnd(20)} 胜率 ${pct(r.winRate).padStart(4)}  均时 ${r.avgT.toFixed(1)}s  超时局 ${r.timeouts}${flag}`);
}
console.log(`\n=== 推关（旗舰队·推荐等级）===`);
for (const [lv, r] of Object.entries(report.levels)) {
  console.log(`${lv.padEnd(12)} 胜率 ${pct(r.winRate).padStart(4)}  均时 ${r.avgT.toFixed(1)}s`);
}
const avgAll = report.durations.reduce((a, b) => a + b, 0) / report.durations.length;
console.log(`\n总平均时长 ${avgAll.toFixed(1)}s（目标 30–60s）  怪物阵容: ${monster ? "有 ⚠️" : "无"}`);
