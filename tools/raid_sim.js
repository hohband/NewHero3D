// 劫寨实时模式 离线平衡模拟（落地 combat-mode-design §8.3 / demo-plan B3 / R1）
// 无头驱动 src/raid/core/manager.js（RealTimeBattleManager），AI 托管跑 N 场，
// 聚合胜率/星级分布/平均用时/超时率/常用 combo 频率，供数值回流 data.js（CSV）。
//
// 用法：
//   node tools/raid_sim.js [--runs N] [--seed S] [--squad a,b,c,d]
//                          [--weather clear|rain|fog|snow|random]
//                          [--order id|random|none] [--knobs k=v,...] [--json] [--verbose]
//   node tools/raid_sim.js --sweep "edps=1,1.5,2;bossHp=1,1.5,2" [--runs N]   # 参数扫描
//
// 数值旋钮（--knobs / --sweep）：
//   英雄侧  hp dps cost lc cd          技能  aoeDmg whirlDmg snipeMult
//   守方侧  ehp edps（全体守军）  bossHp bossDps（BOSS 额外）  towerDps  wallHp  coreHp
//
// 与 tools/sim.js 区分：sim.js 跑 SRPG 回合制核心；本脚本跑劫寨实时模式。
// 红线：随机判定经 RollSource 注入（RandomRollSource 设种子），不用 Math.random；
//       数值只读 src/raid/core/data.js，逻辑层不硬编码；模拟结论人工复核后才回流。

import { RealTimeBattleManager } from "../src/raid/core/manager.js";
import { RandomRollSource } from "../src/core/roll_source.js";
import { HEROES, ENEMIES, BUILDINGS, LEVEL, getLevel, LEVEL_IDS, WEATHER_IDS, ORDERS_META, SKILL_FX } from "../src/raid/core/data.js";

// ---------- CLI ----------
const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const RUNS = parseInt(opt("--runs", "20"), 10);
const SEED = parseInt(opt("--seed", "1000"), 10);
const WEATHER = opt("--weather", "random");
const ORDER = opt("--order", "random");
const SQUAD = opt("--squad", "luzhishen,linchong,huarong,gongsunsheng").split(",").map(s => s.trim()).filter(Boolean);
const LEVEL_ARG = opt("--level", "L1").toUpperCase();
const CURVE = args.includes("--curve");
const JSON_OUT = args.includes("--json");
const VERBOSE = args.includes("--verbose");
const KNOBS = parseKnobs(opt("--knobs", ""));
const SWEEP = parseSweep(opt("--sweep", ""));
const LEVEL_ID = LEVEL_IDS.includes(LEVEL_ARG) ? LEVEL_ARG : "L1";
if (LEVEL_ARG !== LEVEL_ID) console.warn(`⚠ 未知关卡 "${LEVEL_ARG}"，回退到 L1。`);

function parseKnobs(s) {
  const o = {};
  if (!s) return o;
  for (const kv of s.split(",")) {
    const [k, v] = kv.split("=");
    if (k && v !== undefined && !isNaN(+v)) o[k.trim()] = +v;
  }
  return o;
}
// --sweep "edps=1,1.5,2;bossHp=1,1.5" → [{edps:1,bossHp:1},{edps:1,bossHp:1.5},...]（笛卡尔积）
function parseSweep(s) {
  if (!s) return null;
  const dims = [];
  for (const part of s.split(";")) {
    const [k, vs] = part.split("=");
    if (!k || !vs) continue;
    dims.push({ key: k.trim(), vals: vs.split(",").map(v => +v).filter(v => !isNaN(v)) });
  }
  let combos = [{}];
  for (const d of dims) {
    const next = [];
    for (const c of combos) for (const v of d.vals) next.push({ ...c, [d.key]: v });
    combos = next;
  }
  return combos;
}

// ---------- 数据快照/恢复（sweep 多配置互不串扰；数值仅内存覆盖，不写盘） ----------
const _orig = {
  heroes: JSON.parse(JSON.stringify(HEROES)),
  enemies: JSON.parse(JSON.stringify(ENEMIES)),
  buildings: JSON.parse(JSON.stringify(BUILDINGS)),
  skillfx: JSON.parse(JSON.stringify(SKILL_FX)),
};
function restoreOrig() {
  for (const k of Object.keys(_orig.heroes)) Object.assign(HEROES[k], _orig.heroes[k]);
  for (const k of Object.keys(_orig.enemies)) Object.assign(ENEMIES[k], _orig.enemies[k]);
  for (const k of Object.keys(_orig.buildings)) Object.assign(BUILDINGS[k], _orig.buildings[k]);
  Object.assign(SKILL_FX, _orig.skillfx);
}

// ---------- 数值倍率（--knobs）：内存覆盖 data 副本，不污染源文件 ----------
function applyKnobs(knobs) {
  if (!knobs || !Object.keys(knobs).length) return;
  const mul = (obj, key, f) => { if (obj[key] !== undefined) obj[key] = Math.round(obj[key] * f * 100) / 100; };
  // 英雄侧
  for (const h of Object.values(HEROES)) {
    if (knobs.hp) mul(h, "hp", knobs.hp);
    if (knobs.dps) mul(h, "dps", knobs.dps);
    if (knobs.cost) mul(h, "cost", knobs.cost);
    if (knobs.lc) mul(h, "lc", knobs.lc);
    if (knobs.cd) mul(h, "cd", knobs.cd);
  }
  // 技能
  if (knobs.aoeDmg) mul(SKILL_FX, "aoeDmg", knobs.aoeDmg);
  if (knobs.whirlDmg) mul(SKILL_FX, "whirlDmg", knobs.whirlDmg);
  if (knobs.snipeMult) mul(SKILL_FX, "snipeMult", knobs.snipeMult);
  // 守方侧（压缩胜率主杠杆）。小兵与 BOSS 分开控制，语义清晰：
  //   ehp/edps 只作用于普通守军（庄丁/枪兵/铁骑等），BOSS 单独由 bossHp/bossDps 控制。
  //   凡 tag 含 "boss" 的守军单位都视为 BOSS（兼容 boss_zhulong / boss_shiwengong）。
  for (const e of Object.values(ENEMIES)) {
    if (e.tag && e.tag.includes("boss")) {
      if (knobs.bossHp) mul(e, "hp", knobs.bossHp);
      if (knobs.bossDps) mul(e, "dps", knobs.bossDps);
      continue;
    }
    if (knobs.ehp) mul(e, "hp", knobs.ehp);
    if (knobs.edps) mul(e, "dps", knobs.edps);
  }
  // 建筑
  for (const b of Object.values(BUILDINGS)) {
    if (knobs.towerDps && b.kind === "tower") mul(b, "dps", knobs.towerDps);
    if (knobs.wallHp && b.kind === "wall") mul(b, "hp", knobs.wallHp);
    if (knobs.coreHp && b.kind === "core") mul(b, "hp", knobs.coreHp);
  }
}

// ---------- AI 策略（可替换策略模块） ----------
// 目标：模拟一个"会玩但不极限"的玩家：起手铺满编队，技能冷却好就放，号令/天气按种子随机。
class RaidAI {
  constructor(bm, squad, level) {
    this.bm = bm;
    this.squad = squad.filter(id => HEROES[id]); // 只保留有效英雄
    this.level = level; // 关卡 id（决定出生点）
    this.skillLog = []; // [{t, hero, ult}] 用于 combo 统计
    this._decoyUsed = false;
  }
  // 选号令（按种子在 chooseOrder 前已随机定好）
  pickOrder(orderId) {
    if (orderId && orderId !== "none") this.bm.chooseOrder(orderId);
  }
  // 每个决策周期跑一次（低频，~0.5s）
  tick() {
    const bm = this.bm;
    if (bm.phase !== "battle") return;
    this._deploy();
    this._castSkills();
    this._maybeDecoy();
  }
  _deploy() {
    const bm = this.bm;
    const spawn = getLevel(this.level).spawnPoints[0];
    for (const id of this.squad) {
      const chk = bm.canDeploy(id, bm.time);
      if (chk.ok) bm.deploy(id, spawn);
    }
  }
  _castSkills() {
    const bm = this.bm;
    for (const u of bm.units) {
      if (u.team !== 0 || !u.alive || u.kind !== "hero") continue;
      const h = HEROES[u.id];
      const isUlt = u.rage >= SKILL_FX.rageMax;
      if (!isUlt && (bm.time < u.cdUntil || bm.liangcao < h.lc)) continue;
      const target = this._skillTarget(u);
      const ok = bm.castSkill(u.uid, target);
      if (ok) this.skillLog.push({ t: bm.time, hero: u.id, ult: isUlt });
    }
  }
  _skillTarget(u) {
    const bm = this.bm;
    // 公孙胜雷法 / 林冲突进 需要落点；其余技能内部自寻目标
    if (u.id === "gongsunsheng") {
      if (bm.boss && bm.boss.alive) return { x: bm.boss.x, y: bm.boss.y };
      if (bm.core && !bm.core.destroyed) return { x: bm.core.x, y: bm.core.y };
      return { x: u.x, y: u.y };
    }
    if (u.id === "linchong") {
      if (bm.boss && bm.boss.alive) return { x: bm.boss.x, y: bm.boss.y };
      if (bm.core && !bm.core.destroyed) return { x: bm.core.x, y: bm.core.y };
      return { x: u.x, y: u.y + 1 };
    }
    return { x: u.x, y: u.y };
  }
  _maybeDecoy() {
    const bm = this.bm;
    // 破墙阶段放一次诱饵吸塔火（演示主动欺骗的 AI 使用）
    if (this._decoyUsed) return;
    const tower = bm.buildings.find(b => b.kind === "tower" && !b.destroyed);
    if (!tower) return;
    const nearWall = bm.units.some(u => u.team === 0 && u.alive && Math.abs(u.x - tower.x) < 4 && Math.abs(u.y - tower.y) < 4);
    if (nearWall && bm.liangcao >= 15) {
      bm.deployDecoy({ x: tower.x, y: tower.y - 2 });
      this._decoyUsed = true;
    }
  }
}

// ---------- 单场模拟 ----------
function runOnce(cfg, runIdx) {
  const L = getLevel(cfg.level);
  const bm = new RealTimeBattleManager(new RandomRollSource(cfg.seed + runIdx * 131), cfg.level);
  bm.loadLevel();
  // 天气
  const weather = cfg.weather === "random" ? WEATHER_IDS[(cfg.seed + runIdx) % WEATHER_IDS.length] : cfg.weather;
  bm.setWeather(weather);
  // 号令
  const orderIds = Object.keys(ORDERS_META);
  const order = cfg.order === "random" ? orderIds[(cfg.seed + runIdx) % orderIds.length] : cfg.order;
  const ai = new RaidAI(bm, cfg.squad, cfg.level);
  ai.pickOrder(order);
  bm.start();

  let decisionAcc = 0;
  const step = 0.05;
  let guard = 0;
  const maxSteps = Math.ceil((L.timeout + 30) / step);
  while (bm.phase !== "end" && guard++ < maxSteps) {
    bm._step(step);
    decisionAcc += step;
    if (decisionAcc >= 0.5) { decisionAcc = 0; ai.tick(); }
  }
  const r = bm.result || { win: false, reason: "guard", stars: 0, elapsed: bm.elapsed, loot: 0 };
  return {
    win: r.win, reason: r.reason, stars: r.stars, elapsed: r.elapsed, loot: r.loot,
    weather, order, skillLog: ai.skillLog,
  };
}

// ---------- 聚合 ----------
function aggregate(results) {
  const n = results.length;
  const wins = results.filter(r => r.win).length;
  const starHist = { 1: 0, 2: 0, 3: 0 };
  let timeSum = 0, timeouts = 0, wiped = 0;
  const heroCasts = {}; // hero -> casts
  const comboPairs = {}; // "a+b" -> count（3s 窗口内相邻共现）
  const byWeather = {};
  for (const r of results) {
    if (r.win && r.stars >= 1) starHist[Math.min(3, r.stars)]++;
    timeSum += r.elapsed;
    if (r.reason === "timeout") timeouts++;
    if (r.reason === "wiped") wiped++;
    (byWeather[r.weather] = byWeather[r.weather] || []).push(r);
    for (const ev of r.skillLog) heroCasts[ev.hero] = (heroCasts[ev.hero] || 0) + 1;
    // combo：3s 窗口内相邻两次不同英雄技能记一对
    for (let i = 0; i + 1 < r.skillLog.length; i++) {
      const a = r.skillLog[i], b = r.skillLog[i + 1];
      if (b.t - a.t <= 3 && a.hero !== b.hero) {
        const key = [a.hero, b.hero].sort().join("+");
        comboPairs[key] = (comboPairs[key] || 0) + 1;
      }
    }
  }
  const topCombos = Object.entries(comboPairs).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const totalCombo = Object.values(comboPairs).reduce((a, v) => a + v, 0) || 1;
  const weatherStat = Object.fromEntries(Object.entries(byWeather).map(([w, arr]) => {
    const wn = arr.filter(x => x.win).length;
    return [w, { runs: arr.length, winRate: +(wn / arr.length * 100).toFixed(0), avgTime: +(arr.reduce((a, x) => a + x.elapsed, 0) / arr.length).toFixed(1) }];
  }));
  return {
    runs: n,
    winRate: +(wins / n * 100).toFixed(1),
    starDist: {
      "1★": +(starHist[1] / Math.max(1, wins) * 100).toFixed(0),
      "2★": +(starHist[2] / Math.max(1, wins) * 100).toFixed(0),
      "3★": +(starHist[3] / Math.max(1, wins) * 100).toFixed(0),
    },
    avgTime: +(timeSum / n).toFixed(1),
    timeoutRate: +(timeouts / n * 100).toFixed(1),
    wipedRate: +(wiped / n * 100).toFixed(1),
    heroCasts,
    topCombos: topCombos.map(([k, v]) => ({ combo: k, count: v, share: +(v / totalCombo * 100).toFixed(0) })),
    byWeather: weatherStat,
  };
}

// ---------- 目标带校验（按关卡 band 验收） ----------
function checkBand(s, band = BANDS.L1) {
  const issues = [];
  if (s.winRate < band.winLo) issues.push(`胜率 ${s.winRate}% 偏低（目标 ${band.winLo}–${band.winHi}%）→ 进攻方偏弱，考虑降守方/建筑或升英雄`);
  if (s.winRate > band.winHi) issues.push(`胜率 ${s.winRate}% 偏高（目标 ${band.winLo}–${band.winHi}%）→ 进攻方偏强，考虑升守方/建筑或降英雄`);
  if (s.avgTime < band.timeLo) issues.push(`平均用时 ${s.avgTime}s 偏短（目标 ${band.timeLo}–${band.timeHi}s）→ 核心/墙太脆`);
  if (s.avgTime > band.timeHi) issues.push(`平均用时 ${s.avgTime}s 偏长（目标 ${band.timeLo}–${band.timeHi}s）→ 数值偏肉或 DPS 不足`);
  if (s.timeoutRate > 10) issues.push(`超时率 ${s.timeoutRate}% 偏高（目标 <10%）→ 配合 B1 降核心 HP/增援`);
  const top = s.topCombos[0];
  if (top && top.share > 60) issues.push(`combo "${top.combo}" 占比 ${top.share}% 过高（目标 <60%）→ 存在唯一最优解，需分化`);
  return issues;
}

// ---------- 单配置运行 ----------
function runConfig(cfg, knobs, runs, verbose) {
  restoreOrig();
  applyKnobs(knobs);
  const results = [];
  for (let i = 0; i < runs; i++) {
    const r = runOnce(cfg, i);
    results.push(r);
    if (verbose) console.log(`#${i + 1} ${r.win ? "胜" : "负"}(${r.reason}) ${r.stars}★ ${r.elapsed}s 天气=${r.weather} 号令=${r.order}`);
  }
  return { summary: aggregate(results), results };
}

function knobsLabel(k) {
  return Object.keys(k).length ? Object.entries(k).map(([a, b]) => `${a}=${b}`).join(",") : "基准";
}

// ---------- 各关目标带（难度递增，落带区间随之放宽） ----------
const BANDS = {
  L1: { winLo: 65, winHi: 80, timeLo: 60, timeHi: 100 }, // §8.3 教学关基线
  L2: { winLo: 50, winHi: 75, timeLo: 60, timeHi: 110 }, // 进阶关：更难、更松
};
function bandOf(id) { return BANDS[id] || BANDS.L1; }

// ---------- 主流程 ----------
const cfg = { seed: SEED, squad: SQUAD, weather: WEATHER, order: ORDER, level: LEVEL_ID };

// ========== 难度曲线模式：遍历所有关卡，横评胜负/用时/星级 ==========
if (CURVE) {
  console.log(`\n劫寨难度曲线 · 标准编队 ${SQUAD.join("/")} · ${RUNS} 场/关 · 种子=${SEED}`);
  console.log("─".repeat(80));
  console.log(`${"关卡".padEnd(14)} ${"胜率".padStart(6)} ${"平均用时".padStart(9)} ${"1★/2★/3★".padStart(12)} ${"超时".padStart(6)} ${"团灭".padStart(6)}  评价`);
  console.log("─".repeat(80));
  const curve = [];
  for (const id of LEVEL_IDS) {
    const { summary: s } = runConfig({ ...cfg, level: id }, KNOBS, RUNS, false);
    const b = bandOf(id);
    const inBand = s.winRate >= b.winLo && s.winRate <= b.winHi && s.avgTime >= b.timeLo && s.avgTime <= b.timeHi;
    const verdict = inBand ? `✓落带(${b.winLo}-${b.winHi}%)` : (s.winRate > b.winHi ? "⚠偏易" : "⚠偏难");
    curve.push({ id, s, b });
    console.log(`${`${id} ${getLevel(id).name}`.padEnd(14)} ${(s.winRate + "%").padStart(6)} ${(s.avgTime + "s").padStart(9)} ${`${s.starDist["1★"]}/${s.starDist["2★"]}/${s.starDist["3★"]}`.padStart(12)} ${(s.timeoutRate + "%").padStart(6)} ${(s.wipedRate + "%").padStart(6)}  ${verdict}`);
  }
  // ASCII 胜率曲线（0–100% 映射 30 格）
  console.log("─".repeat(80));
  console.log("胜率曲线（│=落带区间下界，▮=胜率）：");
  for (const c of curve) {
    const b = c.b;
    const bar = ".".repeat(30).split("");
    const lo = Math.round(b.winLo / 100 * 30);
    const hi = Math.round(b.winHi / 100 * 30);
    for (let i = lo; i <= hi; i++) bar[i] = "─"; // 落带区间底色
    const px = Math.max(0, Math.min(30, Math.round(c.s.winRate / 100 * 30)));
    bar[px] = "▮";
    console.log(`  ${c.id.padEnd(3)} ${"["}${bar.join("")}${"]"} ${c.s.winRate}%`);
  }
  // 天气分项（L2 偏难时尤需关注）
  console.log("─".repeat(80));
  for (const id of LEVEL_IDS) {
    const { summary: s } = runConfig({ ...cfg, level: id }, KNOBS, RUNS, false);
    console.log(`${id} ${getLevel(id).name} 天气分项： ${Object.entries(s.byWeather).map(([w, v]) => `${w}:${v.winRate}%胜/${v.avgTime}s`).join("  ")}`);
  }
  console.log("");
} else if (SWEEP) {
  // 参数扫描：每个组合跑 --runs 场，紧凑表格输出
  const lvlName = getLevel(LEVEL_ID).name;
  console.log(`\n劫寨平衡扫描 · ${LEVEL_ID} ${lvlName} · 每组合 ${RUNS} 场 · 种子=${SEED} · 编队=${SQUAD.join("/")}`);
  console.log("─".repeat(78));
  console.log(`${"配置".padEnd(30)} ${"胜率".padStart(6)} ${"用时".padStart(7)} ${"2★".padStart(5)} ${"3★".padStart(5)} ${"超时".padStart(6)}`);
  console.log("─".repeat(78));
  const rows = [];
  const b = bandOf(LEVEL_ID);
  for (const k of SWEEP) {
    const { summary: s } = runConfig(cfg, k, RUNS, false);
    rows.push({ k, s });
    const inBand = s.winRate >= b.winLo && s.winRate <= b.winHi && s.avgTime >= b.timeLo && s.avgTime <= b.timeHi;
    console.log(`${knobsLabel(k).padEnd(30)} ${(s.winRate + "%").padStart(6)} ${(s.avgTime + "s").padStart(7)} ${(s.starDist["2★"] + "%").padStart(5)} ${(s.starDist["3★"] + "%").padStart(5)} ${(s.timeoutRate + "%").padStart(6)} ${inBand ? "✓落带" : ""}`);
  }
  console.log("─".repeat(78));
  const best = rows.filter(r => r.s.winRate >= b.winLo && r.s.winRate <= b.winHi && r.s.avgTime >= b.timeLo && r.s.avgTime <= b.timeHi)
    .sort((a, c) => Math.abs((b.winLo + b.winHi) / 2 - a.s.winRate) - Math.abs((b.winLo + b.winHi) / 2 - c.s.winRate))[0];
  if (best) console.log(`推荐落带配置：${knobsLabel(best.k)} → 胜率 ${best.s.winRate}% / ${best.s.avgTime}s`);
  else console.log(`无组合落带（${LEVEL_ID} 目标 ${b.winLo}-${b.winHi}% 胜 / ${b.timeLo}-${b.timeHi}s）：请扩大扫描范围或调整旋钮维度。`);
  if (JSON_OUT) console.log(JSON.stringify(rows.map(r => ({ knobs: r.k, summary: r.s })), null, 2));
  console.log("");
} else {
  const { summary: s } = runConfig(cfg, KNOBS, RUNS, VERBOSE);
  const issues = checkBand(s, bandOf(LEVEL_ID));
  const lvlName = getLevel(LEVEL_ID).name;
  if (JSON_OUT) {
    console.log(JSON.stringify({ level: LEVEL_ID, config: { runs: RUNS, seed: SEED, squad: SQUAD, weather: WEATHER, order: ORDER, knobs: KNOBS }, summary: s, issues }, null, 2));
  } else {
    const hr = "─".repeat(46);
    console.log(`\n劫寨平衡模拟 · ${LEVEL_ID} ${lvlName}  ·  ${RUNS} 场  种子=${SEED}  编队=${SQUAD.join("/")}  配置=${knobsLabel(KNOBS)}`);
    console.log(hr);
    console.log(`胜率        ${s.winRate}%`);
    console.log(`星级分布    1★ ${s.starDist["1★"]}%  2★ ${s.starDist["2★"]}%  3★ ${s.starDist["3★"]}%`);
    console.log(`平均用时    ${s.avgTime}s   超时率 ${s.timeoutRate}%   团灭率 ${s.wipedRate}%`);
    console.log(`天气分项    ${Object.entries(s.byWeather).map(([w, v]) => `${w}:${v.winRate}%胜/${v.avgTime}s`).join("  ")}`);
    console.log(`技能施放    ${Object.entries(s.heroCasts).map(([h, c]) => `${HEROES[h] ? HEROES[h].name : h}:${c}`).join("  ") || "无"}`);
    console.log(`常用 combo  ${s.topCombos.map(c => `${c.combo}(${c.share}%)`).join("  ") || "无"}`);
    console.log(hr);
    if (issues.length) {
      const b = bandOf(LEVEL_ID);
      console.log(`⚠ 目标带偏差（${LEVEL_ID} 基线 ${b.winLo}–${b.winHi}% 胜 / ${b.timeLo}–${b.timeHi}s / 超时<10% / 无 combo>60%）：`);
      for (const it of issues) console.log("  - " + it);
    } else {
      console.log(`✓ 全部指标落在 ${LEVEL_ID} 目标带内。`);
    }
    console.log("");
  }
}
