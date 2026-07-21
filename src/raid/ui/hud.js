// 劫寨 Demo HUD —— 编队栏 / 资源条 / 技能栏 / 指令 / 结算
import { HEROES, LEVEL, RELIEF } from "../core/data.js";

const FACE = { luzhishen: "🟩", linchong: "🟦", wuyong: "🟨", gongsunsheng: "🟪", yanqing: "🟦", likui: "🟥", huarong: "🟧", shiqian: "⬜" };
const HERO_LIST = Object.keys(HEROES);

export class RaidHUD {
  constructor(bm, actions) {
    this.bm = bm;
    this.a = actions; // {deploy, castSkill, retreat, order, pause, slow, start, again, relief}
    this.selectedHero = null;   // 编队栏选中的待部署将
    this.selectedUnit = null;   // 战场上选中的单位
    this.el = (id) => document.getElementById(id);
    this._buildSquad();
    this._bindOrders();
    this._bindStart();
  }

  _buildSquad() {
    const bar = this.el("squad");
    bar.innerHTML = "";
    HERO_LIST.forEach((id, i) => {
      const h = HEROES[id];
      const d = document.createElement("div");
      d.className = "slot"; d.dataset.hero = id;
      d.innerHTML = `<span class="key">${i + 1}</span><div class="face">${FACE[id] || "🟦"}</div><div class="nm">${h.name}</div><div class="cost">兵符${h.cost}·粮${h.lc}</div><div class="cd"></div>`;
      d.onclick = () => this._selectHero(id);
      bar.appendChild(d);
    });
  }

  _selectHero(id) {
    if (this.bm.phase !== "battle") return;
    this.selectedHero = id;
    this.selectedUnit = null;
    document.querySelectorAll(".slot").forEach(s => s.classList.toggle("selected", s.dataset.hero === id));
    this._renderSkillbar();
    this.a.hint(`已选 ${HEROES[id].name}，点击战场部署（部署点绿色圈）`);
  }

  selectUnit(u) {
    this.selectedUnit = u;
    this.selectedHero = null;
    document.querySelectorAll(".slot").forEach(s => s.classList.remove("selected"));
    this._renderSkillbar();
  }

  _renderSkillbar() {
    const bar = this.el("skillbar");
    const u = this.selectedUnit;
    if (!u || !u.alive || u.kind !== "hero") { bar.innerHTML = ""; return; }
    const h = HEROES[u.id];
    const now = this.bm.time;
    const cd = Math.max(0, u.cdUntil - now);
    const rageFull = u.rage >= 100;
    bar.innerHTML = `
      <button class="skillbtn ${cd <= 0 || rageFull ? "ready" : ""}" id="castBtn">
        <span class="k">Q</span>${h.skillName}<span class="cd">${rageFull ? "绝技!" : cd > 0 ? cd.toFixed(0) + "s" : "粮" + h.lc}</span>
      </button>
      <button class="skillbtn" id="retreatBtn"><span class="k">X</span>撤兵</button>
      <div id="ragebar"><div id="ragefill" style="width:${u.rage}%"></div></div>`;
    this.el("castBtn").onclick = () => this.a.castSkill(u);
    this.el("retreatBtn").onclick = () => { this.a.retreat(u); this.selectedUnit = null; this._renderSkillbar(); };
  }

  _bindOrders() {
    document.querySelectorAll(".orderbtn[data-order]").forEach(b => {
      b.onclick = () => this.a.order(b.dataset.order);
    });
    this.el("pauseBtn").onclick = () => this.a.pause();
    this.el("slowBtn").onclick = () => this.a.slow();
  }

  _bindStart() {
    this.el("startBtn").onclick = () => {
      this.el("scoutMask").classList.add("hidden");
      this.a.start();
    };
    this.el("againBtn").onclick = () => location.reload();
    const rr = this.el("reliefRange");
    rr.oninput = () => { this.el("reliefVal").textContent = rr.value + "%"; this._updateRelief(); };
  }

  _updateRelief() {
    const r = this.el("reliefRange").value / 100;
    const out = this.a.relief(r);
    if (out) this.el("reliefOut").textContent = `济贫 ${out.amount} → 声望 +${out.renown}，自留 ${out.net}`;
  }

  showEnd(result) {
    this.el("endPanel").style.display = "flex";
    this.el("endTitle").textContent = result.win ? "劫寨成功！" : "梁山受挫……";
    this.el("endTitle").style.color = result.win ? "#ffd27a" : "#e88";
    let stars = "";
    for (let i = 1; i <= 3; i++) stars += `<span class="${i <= result.stars ? "star-on" : "star-off"}">★</span>`;
    this.el("stars").innerHTML = stars;
    this.el("endInfo").innerHTML = result.win
      ? `用时 ${result.elapsed}s · 劫掠 ${result.loot + result.looted} · 毁核心 ✓`
      : `原因：${result.reason === "timeout" ? "超时未破核心" : "兵力耗尽"} · 坚持 ${result.elapsed}s`;
    this.el("reliefRow").style.display = result.win ? "block" : "none";
    if (result.win) this._updateRelief();
  }

  // 每帧刷新
  sync() {
    const bm = this.bm;
    this.el("bingfu").textContent = bm.bingfu;
    this.el("liangcao").textContent = bm.liangcao;
    this.el("liveN").textContent = bm.liveHeroCount();
    this.el("coreHp").textContent = bm.core ? Math.max(0, Math.round(bm.core.hp)) : "—";
    const t = Math.floor(bm.elapsed);
    this.el("timer").textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
    const badge = this.el("alertBadge");
    badge.textContent = `警报 Lv.${bm.alertLevel}`;
    badge.style.background = ["#444", "#665a20", "#864", "#a33", "#c22"][bm.alertLevel] || "#444";
    // 编队栏禁用态
    document.querySelectorAll(".slot").forEach(s => {
      const id = s.dataset.hero;
      const chk = bm.canDeploy(id, bm.time);
      s.classList.toggle("disabled", !chk.ok);
      const rec = bm.deployedHeroes.get(id);
      const cdEl = s.querySelector(".cd");
      if (rec && bm.time < rec.redeployUntil) cdEl.textContent = `冷却${Math.ceil(rec.redeployUntil - bm.time)}s`;
      else if (!chk.ok && chk.reason === "same_name") cdEl.textContent = "在场";
      else cdEl.textContent = "";
    });
    // 选中单位技能冷却实时
    if (this.selectedUnit && this.selectedUnit.alive) {
      const rf = this.el("ragefill");
      if (rf) rf.style.width = this.selectedUnit.rage + "%";
    } else if (this.selectedUnit && !this.selectedUnit.alive) {
      this.selectedUnit = null; this._renderSkillbar();
    }
  }
}
