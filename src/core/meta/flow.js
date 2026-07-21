// 结算与招募规则（对应 Godot 版 flow.gd，D32/D37）
import { addExp } from "./progression.js";
import * as VillageSystem from "./village_system.js";
import * as ArenaSystem from "./arena_system.js";
import { listIds, getLevel, EPILOGUES } from "../levels.js";
import { Team } from "../unit.js";

export { EPILOGUES };

export const RECRUIT_COST = 20; // 通用碎片 ×20

export function expReward(level) {
  if (level.exp_override > 0) return level.exp_override;
  return 30 + 20 * level.chapter;
}

// 章节终关判定：同章 story 关中 listIds 顺序最后者
export function chapterFinalId(chapter) {
  const story = listIds().filter((id) => {
    const l = getLevel(id);
    return l.mode === "story" && l.chapter === chapter;
  });
  return story.length > 0 ? story[story.length - 1] : null;
}

// 胜利结算（仅胜利调用）。deployedUnits：实际上阵的我方 Unit（经验发上阵武将）。
// 返回结算摘要（结算面板用）。
export function applyBattleResult(profile, level, result, data, deployedUnits) {
  const summary = {
    victory: result.winner === Team.PLAYER,
    rank: result.rank,
    rewards: {}, firstClear: false,
    exp: 0, levelUps: [],
    newHeroes: [], newChapter: 0,
    achievements: result.achievements || [],
    ending: "", epilogue: [],
    village: null,
  };
  if (!summary.victory) return summary;

  // 奖励（首通/常规按 cleared 区分；演武场固定奖励）
  summary.firstClear = !profile.progress.cleared.includes(level.id);
  const rewardSet = level.mode === "arena"
    ? ArenaSystem.ARENA_REWARD
    : (summary.firstClear ? level.rewards.first_clear : level.rewards.regular) || {};
  for (const [key, count] of Object.entries(rewardSet)) {
    if (count <= 0) continue;
    if (key === "gold") profile.gold += count;
    else profile.gainItem(key, count);
    summary.rewards[key] = count;
  }
  if (!profile.progress.cleared.includes(level.id)) {
    profile.progress.cleared.push(level.id);
  }

  // 成就入档
  for (const a of summary.achievements) profile.achievements[a.id] = true;

  // 挑战关发将（unlock_grant{unit, requires_rank}）
  const grant = level.unlock_grant || {};
  if (grant.unit && !profile.hasHero(grant.unit)) {
    if (!grant.requires_rank || result.rank === grant.requires_rank) {
      grantHero(profile, data, grant.unit, summary.newHeroes);
    }
  }

  // 章节推进：通关本章终关 → chapter+1 并发章节解锁武将
  if (level.mode === "story" && level.id === chapterFinalId(level.chapter)) {
    if (profile.progress.chapter <= level.chapter) {
      profile.progress.chapter = level.chapter + 1;
      summary.newChapter = profile.progress.chapter;
    }
    grantChapterHeroes(profile, data, summary.newHeroes);
  } else {
    grantChapterHeroes(profile, data, summary.newHeroes);
  }

  // 结局路线
  if (level.ending) {
    profile.progress.ending = level.ending;
    summary.ending = level.ending;
    summary.epilogue = EPILOGUES[level.ending] || [];
  }

  // 经验：发给所有上阵武将
  const exp = expReward(level);
  summary.exp = exp;
  for (const unit of deployedUnits) {
    if (!unit.hero) continue;
    const ups = addExp(data, unit.hero, exp);
    if (ups > 0) summary.levelUps.push({ unit_id: unit.unitId, levels: ups, level: unit.hero.level });
  }

  // 山寨收获
  summary.village = VillageSystem.collect(profile, data);
  return summary;
}

// 章节解锁武将：「第N章通关解锁」通关第 N 章终关发放；「第N章剧情加入」抵达第 N 章发放
export function grantChapterHeroes(profile, data, out = []) {
  for (const id of data.heroIds) {
    if (profile.hasHero(id)) continue;
    const unlock = data.getUnit(id).unlock || "";
    const m = unlock.match(/^第(\d+)章(通关解锁|剧情加入)$/);
    if (!m) continue;
    const chapter = parseInt(m[1], 10);
    if (m[2] === "通关解锁") {
      const finalId = chapterFinalId(chapter);
      if (finalId && profile.progress.cleared.includes(finalId)) grantHero(profile, data, id, out);
    } else {
      if (profile.progress.chapter >= chapter) grantHero(profile, data, id, out);
    }
  }
  return out;
}

function grantHero(profile, data, unitId, out) {
  const u = data.getUnit(unitId);
  if (!u || profile.hasHero(unitId)) return;
  profile.addHero(unitId, u.quality);
  out.push({ unit_id: unitId, name: u.name, nickname: u.nickname });
}

// 聚义厅招募：unlock=="聚义厅招募" 且未拥有，通用碎片 ×20
export function recruitable(profile, data) {
  const out = [];
  for (const id of data.heroIds) {
    if (profile.hasHero(id)) continue;
    if (data.getUnit(id).unlock === "聚义厅招募") out.push(data.getUnit(id));
  }
  return out;
}

export function recruit(profile, data, unitId) {
  const u = data.getUnit(unitId);
  if (!u || profile.hasHero(unitId)) return { ok: false, reason: "不可招募" };
  if (u.unlock !== "聚义厅招募") return { ok: false, reason: "该武将不能招募" };
  if (!profile.spendItem("shard", RECRUIT_COST)) {
    return { ok: false, reason: `碎片不足（需 ${RECRUIT_COST}）` };
  }
  profile.addHero(unitId, u.quality);
  return { ok: true };
}
