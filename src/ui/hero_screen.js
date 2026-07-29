// 养成页：升级（耗经验）/ 进阶（耗材料）/ 升技能（耗技能书），全部写存档
import { loadSave, storeSave } from "./save.js";
import { parseCsvTable } from "../shared/csv.js";

const CLS_LABEL = { vanguard: "先锋", cavalry: "马军", infantry: "步军", archer: "神射", strategist: "谋士", healer: "医者", support: "辅助" };
const QUALITY_LABEL = { green: "绿", blue: "蓝", purple: "紫", orange: "橙", red: "红" };
const TIER_NAMES = ["绿", "蓝", "紫", "橙", "红"];
// 解锁说明：蓝=被动1 紫=被动2 橙=觉醒技 红=觉醒强化+技能上限5
const UNLOCKS = [
  { tier: 1, label: "蓝阶 · 解锁被动技能①" },
  { tier: 2, label: "紫阶 · 解锁被动技能②" },
  { tier: 3, label: "橙阶 · 解锁觉醒技" },
  { tier: 4, label: "红阶 · 觉醒强化 ×1.3，技能等级上限提升至 5" },
];
const skillCap = (tier) => (tier >= 4 ? 5 : 3);
const levelCost = (h) => 100 * h.level;      // 升级经验 = 100 × 当前等级
const tierCost = (h) => 30 * (h.tier + 1);   // 进阶材料 = 30 × (tier+1)

const save = await loadSave();
const unitsCsv = await fetch("data/units.csv").then((r) => r.text());
const units = parseCsvTable(unitsCsv).filter((r) => r.unit_id && !(r.traits || "").includes("boss"));
let selId = units[0]?.unit_id;

const resbarEl = document.getElementById("resbar");
const rosterEl = document.getElementById("roster");
const detailEl = document.getElementById("detail");

function renderRes() {
  const p = save.progress;
  resbarEl.innerHTML =
    `<span>经验<b>${p.exp}</b></span><span>材料<b>${p.mats}</b></span><span>技能书<b>${p.books}</b></span>`;
}

function renderRoster() {
  rosterEl.innerHTML = "";
  for (const u of units) {
    const h = save.roster[u.unit_id];
    if (!h) continue;
    const el = document.createElement("div");
    el.className = "ritem" + (u.unit_id === selId ? " sel" : "");
    el.innerHTML =
      `<span class="nm">${u.name}</span>` +
      `<span class="lv">Lv.${h.level}</span><span class="tier tier-${h.tier}">${TIER_NAMES[h.tier]}阶</span>`;
    el.onclick = () => { selId = u.unit_id; render(); };
    rosterEl.appendChild(el);
  }
}

function renderDetail(toast = "") {
  const u = units.find((r) => r.unit_id === selId);
  const h = save.roster[selId];
  if (!u || !h) { detailEl.textContent = "未找到武将"; return; }
  const p = save.progress;
  const cap = skillCap(h.tier);
  const lc = levelCost(h), tc = tierCost(h);
  const unlockHtml = UNLOCKS.map((x) =>
    `<div class="${h.tier >= x.tier ? "on" : "off"}">${h.tier >= x.tier ? "✓" : "✗"} ${x.label}</div>`
  ).join("");

  detailEl.innerHTML =
    `<h2>${u.name} <span class="tier tier-${h.tier}">${TIER_NAMES[h.tier]}阶</span></h2>` +
    `<div class="nick">${u.nickname || ""} · ${u.star || ""} · <span class="q-${u.quality}">${QUALITY_LABEL[u.quality] || u.quality}将</span> · ${CLS_LABEL[u.class] || u.class}</div>` +
    `<div class="kv">` +
    `<span class="k">等级</span><span>Lv.${h.level}</span>` +
    `<span class="k">培养阶</span><span>${TIER_NAMES[h.tier]}阶（tier ${h.tier}）</span>` +
    `<span class="k">小技能</span><span>Lv.${h.skill.small} / 上限 ${cap}</span>` +
    `<span class="k">大招</span><span>Lv.${h.skill.ult} / 上限 ${cap}</span>` +
    `<span class="k">兵刃</span><span>${u.weapon || "—"}</span>` +
    `</div>` +
    `<div class="unlock">${unlockHtml}</div>` +
    `<div class="ops">` +
    `<div class="op"><button class="btn" id="lvBtn" ${p.exp < lc ? "disabled" : ""}>升级</button>` +
    `<span class="cost ${p.exp < lc ? "lack" : ""}">耗经验 ${lc}（当前 ${p.exp}）</span></div>` +
    `<div class="op"><button class="btn" id="tierBtn" ${h.tier >= 4 || p.mats < tc ? "disabled" : ""}>进阶</button>` +
    `<span class="cost ${h.tier >= 4 ? "" : p.mats < tc ? "lack" : ""}">${h.tier >= 4 ? "已达最高红阶" : `耗材料 ${tc}（当前 ${p.mats}）`}</span></div>` +
    `<div class="op"><button class="btn" id="smallBtn" ${h.skill.small >= cap || p.books < h.skill.small + 1 ? "disabled" : ""}>升级小技能</button>` +
    `<span class="cost ${h.skill.small >= cap ? "" : p.books < h.skill.small + 1 ? "lack" : ""}">${h.skill.small >= cap ? "已达当前上限" : `耗技能书 ${h.skill.small + 1}（当前 ${p.books}）`}</span></div>` +
    `<div class="op"><button class="btn" id="ultBtn" ${h.skill.ult >= cap || p.books < h.skill.ult + 1 ? "disabled" : ""}>升级大招</button>` +
    `<span class="cost ${h.skill.ult >= cap ? "" : p.books < h.skill.ult + 1 ? "lack" : ""}">${h.skill.ult >= cap ? "已达当前上限" : `耗技能书 ${h.skill.ult + 1}（当前 ${p.books}）`}</span></div>` +
    `</div>` +
    `<div class="toast">${toast}</div>`;

  detailEl.querySelector("#lvBtn").onclick = () => {
    if (p.exp < lc) return;
    p.exp -= lc; h.level += 1;
    commit(`升级成功：${u.name} → Lv.${h.level}`);
  };
  detailEl.querySelector("#tierBtn").onclick = () => {
    if (h.tier >= 4 || p.mats < tc) return;
    p.mats -= tc; h.tier += 1;
    commit(`进阶成功：${u.name} → ${TIER_NAMES[h.tier]}阶`);
  };
  detailEl.querySelector("#smallBtn").onclick = () => {
    if (h.skill.small >= cap || p.books < h.skill.small + 1) return;
    p.books -= h.skill.small + 1; h.skill.small += 1;
    commit(`小技能升级 → Lv.${h.skill.small}`);
  };
  detailEl.querySelector("#ultBtn").onclick = () => {
    if (h.skill.ult >= cap || p.books < h.skill.ult + 1) return;
    p.books -= h.skill.ult + 1; h.skill.ult += 1;
    commit(`大招升级 → Lv.${h.skill.ult}`);
  };
}

function commit(toast) {
  storeSave(save);
  renderRes();
  renderRoster();
  renderDetail(toast);
}

function render() { renderRes(); renderRoster(); renderDetail(); }
render();
