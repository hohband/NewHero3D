// 大厅页：资源总览 + 关卡列表（点关写待战关卡并跳转选将页）
import { loadSave, setPendingLevel } from "./save.js";
import { parseCsvTable, toInt } from "../shared/csv.js";

const save = await loadSave(); // 无存档时自动初始化新档

const p = save.progress;
document.getElementById("resbar").innerHTML =
  `<span>经验<b>${p.exp}</b></span><span>材料<b>${p.mats}</b></span>` +
  `<span>技能书<b>${p.books}</b></span><span>金币<b>${p.gold}</b></span>`;

document.getElementById("heroBtn").onclick = () => (location.href = "hero.html");

const levelsCsv = await fetch("data/levels_proto.csv").then((r) => r.text());
const levels = parseCsvTable(levelsCsv);
const cleared = new Set(save.progress.cleared);

const listEl = document.getElementById("levelList");
listEl.innerHTML = "";
for (const lv of levels) {
  const done = cleared.has(lv.level_id);
  const el = document.createElement("div");
  el.className = "level";
  el.innerHTML =
    `<span class="nm">${lv.name}${done ? ' <span class="cleared">✓ 已通关</span>' : ""}</span>` +
    `<span class="desc">${lv.desc || ""}</span>` +
    `<span class="meta">推荐等级 ${toInt(lv.recommend_level)}<br>奖励 经验×${toInt(lv.reward_exp)} 材料×${toInt(lv.reward_mats)}</span>` +
    `<span class="go">前往 →</span>`;
  el.onclick = () => {
    setPendingLevel(lv.level_id);
    location.href = "select.html";
  };
  listEl.appendChild(el);
}
