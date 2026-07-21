// 劫寨 Demo 入口 —— 编排：逻辑(RealTimeBattleManager) + 表现(RaidScene) + UI(HUD) + 输入
import * as THREE from "three";
import { RealTimeBattleManager } from "./core/manager.js";
import { RandomRollSource } from "../core/roll_source.js";
import { RaidScene } from "./render/scene.js";
import { RaidHUD } from "./ui/hud.js";
import { LEVEL, HEROES } from "./core/data.js";

const canvas = document.getElementById("gl");
const bm = new RealTimeBattleManager(new RandomRollSource((Math.random() * 1e9) | 0));
bm.loadLevel();
const scene = new RaidScene(canvas, bm);
window.__bm = bm; window.__scene = scene; // 调试句柄

// 状态
let paused = false, slow = false;
let pauseCount = 0, pauseLeft = 3, slowLeft = 30;
let orderMode = null; // 指令模式（集火选目标）
let focusTarget = null;

// 指令（战术指令，覆盖单位 AI 一短暂时间）
const ORDERS = {
  focus: { cd: 8, dur: 3 }, retreat: { cd: 15, dur: 3 }, charge: { cd: 12, dur: 3 }, hold: { cd: 10, dur: 4 },
};
const orderState = {};

function hint(msg, ms = 2200) {
  const h = document.getElementById("hint");
  h.textContent = msg; h.classList.remove("hidden");
  clearTimeout(h._t); h._t = setTimeout(() => h.classList.add("hidden"), ms);
}

const hud = new RaidHUD(bm, {
  hint,
  start() { bm.start(); hint("战斗开始！点编队栏选将 → 点绿色部署圈部署"); },
  deploy(heroId, pos) {
    // 吸附最近部署点：点击部署带（地图下半区）即部署到最近部署圈，符合 CoC 直觉
    const sp = LEVEL.spawnPoints[0];
    // 允许点击部署圈附近较大范围（半径 6），吸附到部署点
    const near = Math.hypot(pos.x - sp.x, pos.y - sp.y) <= 6;
    if (!near) { hint("请点击下方绿色部署圈附近落点"); return; }
    // 部署到圈内随机空位（避免重叠）
    const jx = sp.x + ((Math.random() * 2 - 1) * 1.2);
    const jy = sp.y + ((Math.random() * 2 - 1) * 0.8);
    const u = bm.deploy(heroId, { x: jx, y: jy });
    if (u) { hud.selectedHero = null; document.querySelectorAll(".slot").forEach(s => s.classList.remove("selected")); hud.selectUnit(u); }
  },
  castSkill(u) {
    // 需要选目标的技能（公孙胜/林冲/花荣）进入选点模式，其余直接放
    if (["gongsunsheng", "linchong", "huarong"].includes(u.id)) {
      pendingSkill = u; hint(`点击战场选择 ${HEROES[u.id].skillName} 的落点/方向`);
    } else bm.castSkill(u.uid, {});
  },
  retreat(u) { if (bm.retreat(u.uid)) hint(`${u.name} 已撤兵`); },
  order(type) {
    if (bm.phase !== "battle") return;
    if (type === "focus") { orderMode = "focus"; hint("集火：点击一个敌人或建筑作为目标"); return; }
    applyOrder(type);
  },
  pause() {
    if (bm.phase !== "battle") return;
    if (!paused && pauseLeft <= 0) { hint("暂停次数已用完（3次）"); return; }
    paused = !paused;
    if (paused) { pauseLeft--; hint(`已暂停（剩 ${pauseLeft} 次）· 仅可查看`); }
    document.getElementById("pauseBtn").innerHTML = `<span class="k">Space</span>${paused ? "继续" : "暂停"}`;
  },
  slow() {
    if (bm.phase !== "battle") return;
    slow = !slow;
    document.getElementById("slowBtn").innerHTML = `<span class="k">Shift</span>${slow ? "1.0x" : "0.5x"}`;
  },
  relief(r) { return bm.applyRelief(r); },
});

let pendingSkill = null;

function applyOrder(type, target) {
  const o = ORDERS[type];
  const now = bm.time;
  if (orderState[type] && now < orderState[type]) { hint("指令冷却中"); return; }
  orderState[type] = now + o.cd;
  const until = now + o.dur;
  const heroes = bm.units.filter(u => u.team === 0 && u.alive && (u.kind === "hero" || u.kind === "summon"));
  if (type === "focus" && target) {
    focusTarget = target;
    for (const h of heroes) h._focusUntil = until;
    hint("全军集火！");
  } else if (type === "retreat") {
    for (const h of heroes) { h._retreatUntil = until; }
    hint("后撤！");
  } else if (type === "charge") {
    for (const h of heroes) { h._chargeUntil = until; }
    hint("冲锋！");
  } else if (type === "hold") {
    for (const h of heroes) { h._holdUntil = until; }
    hint("坚守！");
  }
}

// 注入指令影响：包装 bm 的 _combatAI 行为通过钩子（简化：在 step 前处理单位指令）
const origStep = bm._step.bind(bm);
bm._step = function (dt) {
  const now = bm.time;
  for (const h of bm.units) {
    if (h.team !== 0 || !h.alive || (h.kind !== "hero" && h.kind !== "summon")) continue;
    if (h._retreatUntil && now < h._retreatUntil) {
      const sp = LEVEL.spawnPoints[0];
      h.moveTarget = { x: sp.x, y: sp.y };
      moveTowardPoint(h, sp, dt);
      h._orderOverride = true; continue;
    }
    if (h._holdUntil && now < h._holdUntil) { h._orderOverride = true; continue; } // 坚守不动
    if (h._chargeUntil && now < h._chargeUntil) { h._chargeBoost = 1.3; } else h._chargeBoost = 1;
    if (h._focusUntil && now < h._focusUntil && focusTarget && focusTarget.alive !== false && !focusTarget.destroyed) {
      // 集火：强制攻击 focusTarget
      const d = Math.hypot(focusTarget.x - h.x, focusTarget.y - h.y);
      if (d <= h.range) bm._attack(h, focusTarget, dt); else moveTowardPoint(h, focusTarget, dt);
      h._orderOverride = true; continue;
    }
    h._orderOverride = false;
  }
  // 让被指令覆盖的单位跳过默认 AI
  const saved = bm._combatAI.bind(bm);
  bm._combatAI = function (u, dt2) { if (u._orderOverride) return; saved(u, dt2); };
  origStep(dt);
  bm._combatAI = saved;
};

function moveTowardPoint(u, pt, dt) {
  const dx = pt.x - u.x, dy = pt.y - u.y;
  const d = Math.hypot(dx, dy);
  if (d < 0.05) return;
  const sp = u.spd * (u._chargeBoost || 1) * dt;
  bm._unplace(u); u.x += (dx / d) * sp; u.y += (dy / d) * sp; bm._place(u);
}

// 直控先锋（指挥官档）：点击己方英雄 → WASD/方向键微移
let directUnit = null;
const keys = {};
window.addEventListener("keydown", (e) => {
  keys[e.key.toLowerCase()] = true;
  if (e.key === " ") { e.preventDefault(); hud.a ? 0 : 0; }
});
window.addEventListener("keyup", (e) => { keys[e.key.toLowerCase()] = false; });

function handleDirect(dt) {
  if (!directUnit || !directUnit.alive || bm.phase !== "battle" || paused) return;
  let mx = 0, my = 0;
  if (keys["w"] || keys["arrowup"]) my -= 1;
  if (keys["s"] || keys["arrowdown"]) my += 1;
  if (keys["a"] || keys["arrowleft"]) mx -= 1;
  if (keys["d"] || keys["arrowright"]) mx += 1;
  if (mx || my) {
    const d = Math.hypot(mx, my);
    const sp = directUnit.spd * dt;
    bm._unplace(directUnit);
    directUnit.x = Math.max(0, Math.min(LEVEL.w - 1, directUnit.x + (mx / d) * sp));
    directUnit.y = Math.max(0, Math.min(LEVEL.h - 1, directUnit.y + (my / d) * sp));
    bm._place(directUnit);
    directUnit._orderOverride = true;
  }
}

// 输入：点击部署 / 选单位 / 技能选点 / 指令选目标
let rightDown = false, lastX = 0, lastY = 0;
canvas.addEventListener("contextmenu", (e) => e.preventDefault());
canvas.addEventListener("mousedown", (e) => {
  if (e.button === 2) { rightDown = true; lastX = e.clientX; lastY = e.clientY; return; }
  if (bm.phase !== "battle" || paused) return;
  const g = scene.screenToGround(e.clientX, e.clientY);
  if (!g) return;
  // 技能选点
  if (pendingSkill) { bm.castSkill(pendingSkill.uid, g); pendingSkill = null; scene.clearSkillPreview(); return; }
  // 集火选目标
  if (orderMode === "focus") {
    const tgt = pickAt(g, true);
    if (tgt) applyOrder("focus", tgt); else hint("未选中目标");
    orderMode = null; return;
  }
  // 部署
  if (hud.selectedHero) { hud.a.deploy(hud.selectedHero, g); return; }
  // 选单位（优先己方英雄用于直控/技能）
  const u = pickAt(g, false);
  if (u && u.team === 0 && u.kind === "hero") { hud.selectUnit(u); directUnit = u; hint(`直控 ${u.name}（WASD 移动 / Q 技能 / X 撤兵）`); }
  else if (u) hud.selectUnit(u);
});
window.addEventListener("mouseup", (e) => { if (e.button === 2) rightDown = false; });
window.addEventListener("mousemove", (e) => {
  if (rightDown) { scene.rotateCam((e.clientX - lastX) * 0.005); scene.panCam(0, (e.clientY - lastY) * 0.4); lastX = e.clientX; lastY = e.clientY; }
  // 技能选点实时预览
  if (pendingSkill) {
    const g = scene.screenToGround(e.clientX, e.clientY);
    if (g) {
      if (pendingSkill.id === "gongsunsheng") scene.showSkillPreview("aoe", g.x, g.y, 2);
      else if (pendingSkill.id === "linchong") {
        const ang = Math.atan2(g.y - pendingSkill.y, g.x - pendingSkill.x);
        scene._dashAngle = -ang;
        const mx = pendingSkill.x + Math.cos(ang) * 2, my = pendingSkill.y + Math.sin(ang) * 2;
        scene.showSkillPreview("dash", mx, my, 4);
      }
      else if (pendingSkill.id === "huarong") scene.showSkillPreview("snipe", g.x, g.y, 0);
    }
  }
});
canvas.addEventListener("wheel", (e) => { e.preventDefault(); scene.zoomCam(e.deltaY * 0.01); }, { passive: false });

function pickAt(g, enemyOnly) {
  let best = null, bd = 1.2;
  for (const u of bm.units) {
    if (!u.alive) continue;
    if (enemyOnly && u.team !== 1) continue;
    const d = Math.hypot(u.x - g.x, u.y - g.y);
    if (d < bd) { bd = d; best = u; }
  }
  if (!best && enemyOnly) {
    for (const b of bm.buildings) {
      if (b.destroyed || b.kind === "trap") continue;
      const d = Math.hypot(b.x - g.x, b.y - g.y);
      if (d < bd) { bd = d; best = b; }
    }
  }
  return best;
}

// 键盘快捷键
window.addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase();
  if (k === " ") { e.preventDefault(); hud.el("pauseBtn").click(); return; }
  if (e.key === "Shift") { hud.el("slowBtn").click(); return; }
  if (bm.phase !== "battle") return;
  if (k >= "1" && k <= "8") {
    const idx = parseInt(k) - 1;
    const slots = document.querySelectorAll(".slot");
    if (slots[idx]) slots[idx].click();
  }
  if (k === "q" && hud.selectedUnit) hud.a.castSkill(hud.selectedUnit);
  if (k === "x" && hud.selectedUnit) { hud.a.retreat(hud.selectedUnit); hud.selectedUnit = null; hud._renderSkillbar(); }
  if (k === "f") hud.a.order("focus");
  if (k === "g") hud.a.order("retreat");
  if (k === "h") hud.a.order("charge");
  if (k === "j") hud.a.order("hold");
});

// 事件 → 特效（高光时刻 Juiciness）
let slowmoT = 0; // 慢动作剩余
function consumeEvents() {
  for (const ev of bm.drainEvents()) {
    if (ev.t === "hit" && ev.to) scene.hitFx(ev.to.x, ev.to.y);
    else if (ev.t === "tower_fire" && ev.target) scene.hitFx(ev.target.x, ev.target.y, 0xff8844);
    else if (ev.t === "aoe") scene.aoeFx(ev.x, ev.y, ev.r);
    else if (ev.t === "skill") {
      // 技能差异化特效
      const u = ev.unit;
      if (ev.skill === "luzhishen") scene.goldenFx(u.x, u.y);
      else if (ev.skill === "likui") scene.whirlFx(u.x, u.y);
      else if (ev.skill === "linchong") scene.shake(0.12, 0.2);
      else if (ev.skill === "gongsunsheng") scene.shake(0.08, 0.15);
    }
    else if (ev.t === "snipe" && ev.target) scene.snipeFx(ev.unit.x, ev.unit.y, ev.target.x, ev.target.y);
    else if (ev.t === "wall_down") { hint("破墙！敌军增援将至", 1800); scene.shake(0.22, 0.35); }
    else if (ev.t === "sentry_fire") hint("哨兵点燃烽火！警报升级", 1800);
    else if (ev.t === "patrol_alarm") hint("巡逻队发现你，报警了！", 1800);
    else if (ev.t === "boss_down") { hint("祝龙被击败！核心护盾消失——摧毁忠义堂！", 2600); scene.bossDownFx(ev.unit.x, ev.unit.y); slowmoT = 0.9; }
    else if (ev.t === "loot") hint(`劫掠粮仓 +${ev.amount}`, 1500);
    else if (ev.t === "battle_end") {
      if (ev.result.win) { scene.flash(); slowmoT = 1.4; }
      setTimeout(() => hud.showEnd(ev.result), ev.result.win ? 900 : 100);
    }
    else if (ev.t === "deploy_fail") hint(`无法部署：${reasonText(ev.reason)}`);
    else if (ev.t === "skill_fail") hint(ev.reason === "cd" ? "技能冷却中" : "粮草不足");
  }
}
function reasonText(r) {
  return { redeploy_cd: "再部署冷却中", same_name: "同名已在场", bingfu: "兵符不足", live_cap: "在场已满", not_battle_phase: "未在战斗阶段" }[r] || r;
}

// 主循环
let last = performance.now();
let slowTimer = 0;
function loop(now) {
  requestAnimationFrame(loop);
  let dt = (now - last) / 1000; last = now;
  dt = Math.min(dt, 0.1);
  if (!paused && bm.phase === "battle") {
    let sdt = dt;
    if (slowmoT > 0) { sdt = dt * 0.3; slowmoT -= dt; } // 高光慢动作
    else if (slow) {
      sdt = dt * 0.5; slowTimer += dt;
      if (slowTimer > slowLeft) { slow = false; document.getElementById("slowBtn").innerHTML = `<span class="k">Shift</span>0.5x`; hint("慢放时长已用完"); }
    }
    bm.update(sdt);
  }
  handleDirect(dt);
  consumeEvents();
  scene.sync(dt);
  hud.sync();
  scene.render();
}
// 侦查期倒计时
let scoutLeft = LEVEL.scoutTime;
const scoutEl = document.getElementById("scoutCount");
const scoutTimer = setInterval(() => {
  scoutLeft--;
  if (scoutLeft <= 0) { clearInterval(scoutTimer); scoutEl.textContent = "▶"; }
  else scoutEl.textContent = scoutLeft;
}, 1000);

requestAnimationFrame(loop);
