// 选将编队页：30 将卡片点选 5 人 → 编队板调站位/顺位 → 写存档出战
import { loadSave, storeSave, getPendingLevel } from "./save.js";
import { parseCsvTable } from "../shared/csv.js";

const CLS_LABEL = { vanguard: "先锋", cavalry: "马军", infantry: "步军", archer: "神射", strategist: "谋士", healer: "医者", support: "辅助" };
const QUALITY_LABEL = { green: "绿", blue: "蓝", purple: "紫", orange: "橙", red: "红" };
const TIER_NAMES = ["绿", "蓝", "紫", "橙", "红"];
const DEFAULT_FORMATION = [
  { id: "lu_zhishen", row: "front" }, { id: "lin_chong", row: "front" }, { id: "wu_song", row: "front" },
  { id: "gongsun_sheng", row: "back" }, { id: "an_daoquan", row: "back" },
];

const save = await loadSave();
const [unitsCsv, levelsCsv] = await Promise.all([
  fetch("data/units.csv").then((r) => r.text()),
  fetch("data/levels_proto.csv").then((r) => r.text()),
]);
const units = parseCsvTable(unitsCsv).filter((r) => r.unit_id && !(r.traits || "").includes("boss"));
const levelId = getPendingLevel();
const level = parseCsvTable(levelsCsv).find((r) => r.level_id === levelId);
document.getElementById("levelName").textContent = level ? `目标：${level.name}（推荐等级 ${level.recommend_level}）` : "";

// 编队初始化为存档编队（无效则默认编队），slot 顺序即列表顺序
const init = (Array.isArray(save.formation) && save.formation.length === 5 ? save.formation : DEFAULT_FORMATION)
  .slice()
  .sort((a, b) => (a.row === b.row ? a.slot - b.slot : 0))
  .filter((f) => save.roster[f.id]);
let board = init.map((f) => ({ id: f.id, row: f.row === "back" ? "back" : "front" }));

const gridEl = document.getElementById("cardGrid");
const boardEl = document.getElementById("boardList");
const fightBtn = document.getElementById("fightBtn");

function heroInfo(id) {
  const u = units.find((r) => r.unit_id === id);
  const h = save.roster[id] || { level: 1, tier: 0 };
  return { u, h };
}

function renderCards() {
  gridEl.innerHTML = "";
  for (const u of units) {
    const h = save.roster[u.unit_id] || { level: 1, tier: 0 };
    const sel = board.some((b) => b.id === u.unit_id);
    const el = document.createElement("div");
    el.className = "card" + (sel ? " sel" : "");
    el.innerHTML =
      `<div class="nm">${u.name} <span class="tier tier-${h.tier}">${TIER_NAMES[h.tier]}阶</span></div>` +
      `<div class="nick">${u.nickname || ""} · <span class="q-${u.quality}">${QUALITY_LABEL[u.quality] || u.quality}将</span></div>` +
      `<div class="meta">${CLS_LABEL[u.class] || u.class} · Lv.${h.level}</div>`;
    el.onclick = () => {
      if (sel) board = board.filter((b) => b.id !== u.unit_id);
      else if (board.length < 5) board.push({ id: u.unit_id, row: "front" });
      render();
    };
    gridEl.appendChild(el);
  }
}

function renderBoard() {
  boardEl.innerHTML = "";
  board.forEach((b, i) => {
    const { u } = heroInfo(b.id);
    const el = document.createElement("div");
    el.className = "slot";
    el.innerHTML =
      `<span class="pos">${i + 1}</span><span class="who">${u ? u.name : b.id}</span>` +
      `<button class="rowbtn${b.row === "back" ? " back" : ""}" data-act="row">${b.row === "back" ? "后排" : "前排"}</button>` +
      `<button class="mv" data-act="up" ${i === 0 ? "disabled" : ""}>▲</button>` +
      `<button class="mv" data-act="down" ${i === board.length - 1 ? "disabled" : ""}>▼</button>` +
      `<button class="mv" data-act="del">✕</button>`;
    el.onclick = (e) => {
      const act = e.target.dataset.act;
      if (!act) return;
      if (act === "row") b.row = b.row === "back" ? "front" : "back";
      else if (act === "up" && i > 0) [board[i - 1], board[i]] = [board[i], board[i - 1]];
      else if (act === "down" && i < board.length - 1) [board[i + 1], board[i]] = [board[i], board[i + 1]];
      else if (act === "del") board.splice(i, 1);
      render();
    };
    boardEl.appendChild(el);
  });
  for (let i = board.length; i < 5; i++) {
    const el = document.createElement("div");
    el.className = "slot empty";
    el.textContent = "空位 — 点左侧武将加入";
    boardEl.appendChild(el);
  }
  document.getElementById("pickCount").textContent = `${board.length}/5`;
  fightBtn.disabled = board.length !== 5;
}

function render() { renderCards(); renderBoard(); }

fightBtn.onclick = () => {
  save.formation = board.map((b, i) => ({ id: b.id, row: b.row, slot: i }));
  storeSave(save);
  location.href = "battle-proto.html";
};

render();
