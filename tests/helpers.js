// 测试共享工具：CSV 加载、编队构建、战斗驱动
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildTeams } from "../src/prototype/data.js";
import { Sim, SIM_STEP } from "../src/prototype/sim.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

export function loadCsvs() {
  return {
    unitsCsv: read("data/units.csv"),
    skillsCsv: read("data/skills.csv"),
    awakenCsv: read("data/proto_awaken.csv"),
    growthCsv: read("data/growth_curve.csv"),
    constsCsv: read("data/battle_constants.csv"),
    progressionCsv: read("data/progression.csv"),
    wavesCsv: read("data/waves.csv"),
    levelsCsv: read("data/levels_proto.csv"),
  };
}

// 原型镜像战编队（旧 PLAYER_IDS/ENEMY_IDS 的显式化，供回归用例复用）
export const MIRROR_PLAYER = [
  { id: "lu_zhishen", row: "front", slot: 0 },
  { id: "lin_chong", row: "front", slot: 1 },
  { id: "wu_song", row: "front", slot: 2 },
  { id: "gongsun_sheng", row: "back", slot: 0 },
  { id: "an_daoquan", row: "back", slot: 1 },
];
export const MIRROR_ENEMY = [
  { id: "song_wan", row: "front", slot: 0 },
  { id: "li_kui", row: "front", slot: 1 },
  { id: "qin_ming", row: "front", slot: 2 },
  { id: "hua_rong", row: "back", slot: 0 },
  { id: "bai_sheng", row: "back", slot: 1 },
];

export function teamsFor(playerFormation = MIRROR_PLAYER, enemyFormation = MIRROR_ENEMY, heroStates = null) {
  return buildTeams({ ...loadCsvs(), playerFormation, enemyFormation, heroStates });
}

export function runBattle(teams, { autoUlt = true, maxT = 180, seed = 20260727 } = {}) {
  const sim = new Sim(teams, seed);
  let t = 0, ults = 0, chainMax = 0, awakens = 0, guard = 0;
  while (sim.winner < 0 && t < maxT) {
    sim.step(SIM_STEP); t += SIM_STEP;
    for (const e of sim.events.splice(0)) {
      if (e.type === "chain") chainMax = Math.max(chainMax, e.count);
      if (e.type === "awaken") awakens++;
    }
    if (autoUlt) for (const u of sim.units.filter((x) => x.side === 0 && x.alive && x.rage >= 100)) if (sim.castUlt(u)) ults++;
    if (++guard > 200000) break;
  }
  return { winner: sim.winner, t, ults, chainMax, awakens, sim };
}

// 手工构造最小战斗单位 cfg（绕开 CSV，精确测效果语义）
export function makeCfg(id, over = {}) {
  return {
    id, name: id, cls: "infantry", archetype: "phys", row: "front", slot: 0,
    quality: "green", tier: 3, level: 1,
    hp: 1000, atk: 100, def: 50, mgc: 50, spd: 60, crit: 10, dodge: 5, block: 5,
    bonds: [], small: null, ult: null, passives: [], awaken: null, ultName: "大招",
    ...over,
  };
}
export function makeUlt(effects, scope = "single") {
  return { id: "ult_test", name: "测试大招", cd: 0, scope, effectsStr: effects, parsed: parseEffects(effects), effectMult: 1 };
}
export function makeSmall(effects, scope = "single", cd = 2) {
  return { id: "act_test", name: "测试小技能", cd, scope, effectsStr: effects, parsed: parseEffects(effects), effectMult: 1 };
}
import { parseEffects } from "../src/shared/effects.js";
export { Sim, SIM_STEP };
