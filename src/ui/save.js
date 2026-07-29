// 存档模块（UI 层）：localStorage 读写 + 奖励/通关便捷操作
// 注意：模块顶层不得触碰 window/localStorage（保持 node --check 与测试环境安全），只在函数内访问
import { parseCsvTable } from "../shared/csv.js";

export const SAVE_KEY = "shuihu3d_save_v1";
export const PENDING_LEVEL_KEY = "shuihu3d_pending_level";
export const SAVE_VERSION = 1;

// 新档默认编队：鲁智深/林冲/武松前排 0-2，公孙胜/安道全后排 0-1
const DEFAULT_FORMATION = [
  { id: "lu_zhishen", row: "front", slot: 0 },
  { id: "lin_chong", row: "front", slot: 1 },
  { id: "wu_song", row: "front", slot: 2 },
  { id: "gongsun_sheng", row: "back", slot: 0 },
  { id: "an_daoquan", row: "back", slot: 1 },
];

// 读档；无存档时按 units.csv（排除 Boss 行）生成新档并落盘
export async function loadSave() {
  const raw = localStorage.getItem(SAVE_KEY);
  if (raw) {
    try {
      const save = JSON.parse(raw);
      if (save && save.version === SAVE_VERSION) return normalizeSave(save);
    } catch { /* 存档损坏则重建 */ }
  }
  const save = await createNewSave();
  storeSave(save);
  return save;
}

export function storeSave(save) {
  localStorage.setItem(SAVE_KEY, JSON.stringify(save));
}

// 删档（下次 loadSave 将重建新档）
export function resetSave() {
  localStorage.removeItem(SAVE_KEY);
}

// 兼容旧档/缺字段的归一化
function normalizeSave(save) {
  save.roster = save.roster || {};
  save.formation = Array.isArray(save.formation) && save.formation.length ? save.formation : DEFAULT_FORMATION.map((f) => ({ ...f }));
  save.progress = { cleared: [], exp: 0, mats: 0, gold: 0, books: 0, ...(save.progress || {}) };
  if (!Array.isArray(save.progress.cleared)) save.progress.cleared = [];
  return save;
}

async function createNewSave() {
  const unitsCsv = await fetch("data/units.csv").then((r) => r.text());
  const roster = {};
  for (const row of parseCsvTable(unitsCsv)) {
    if (!row.unit_id || (row.traits || "").includes("boss")) continue; // 排除 Boss 行，只收 30 将
    roster[row.unit_id] = { level: 1, tier: 0, skill: { small: 1, ult: 1 }, exp: 0 };
  }
  return {
    version: SAVE_VERSION,
    roster,
    formation: DEFAULT_FORMATION.map((f) => ({ ...f })),
    progress: { cleared: [], exp: 0, mats: 0, gold: 0, books: 0 },
  };
}

// 存档 roster → buildTeams 所需的 heroStates Map（含 makeHeroState 兼容字段 {id,level,tier,skill,exp}）
export function getHeroStates(save) {
  const m = new Map();
  for (const [id, h] of Object.entries(save.roster || {})) {
    m.set(id, {
      id,
      level: h.level ?? 1,
      tier: h.tier ?? 0,
      skill: { small: h.skill?.small ?? 1, ult: h.skill?.ult ?? 1 },
      exp: h.exp ?? 0,
    });
  }
  return m;
}

// 发放共享资源池奖励（原地修改 save，调用方负责 storeSave）
export function addRewards(save, { exp = 0, mats = 0, books = 0 } = {}) {
  const p = save.progress;
  p.exp = Math.max(0, (p.exp || 0) + exp);
  p.mats = Math.max(0, (p.mats || 0) + mats);
  p.books = Math.max(0, (p.books || 0) + books);
  return save;
}

// 记录通关；返回是否为首通（用于首通双倍奖励）
export function markCleared(save, levelId) {
  const c = save.progress.cleared;
  if (c.includes(levelId)) return false;
  c.push(levelId);
  return true;
}

// 读/写待战关卡（缺省 story_01）
export function getPendingLevel() {
  return localStorage.getItem(PENDING_LEVEL_KEY) || "story_01";
}
export function setPendingLevel(levelId) {
  localStorage.setItem(PENDING_LEVEL_KEY, levelId);
}
