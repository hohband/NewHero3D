// 水浒 · 横版自动战斗原型 · 表现层（three.js + HTML overlay）
// 逻辑在 ./sim.js（纯逻辑，可 node 无头跑）；本文件只消费 Sim 状态与事件做渲染
import * as THREE from "three";
import { Sim, CLS, SIM_STEP } from "./sim.js";
import { buildTeams } from "./data.js";
import { loadSave, storeSave, getHeroStates, getPendingLevel, addRewards, markCleared } from "../ui/save.js";
import { parseCsvTable } from "../shared/csv.js";

const TEAM_COLOR = { 0: 0x3f8fd0, 1: 0xd0503a };
// 小技能特效环样式（kind 由 sim._smallKind 推导）
const SMALLFX_STYLE = {
  thunder: { color: 0x9a6aff, size: 3.0 },
  whirl:   { color: 0x5ad0e0, size: 3.4 },
  slam:    { color: 0xff9a4a, size: 2.6 },
  support: { color: 0x5ae07a, size: 2.4 },
};

// GLB 模型加载器（vendor 自 three r160，import 'three' 走 importmap）；加载失败回退胶囊
let _gltfLoaderPromise = null;
function getGLTFLoader() {
  if (!_gltfLoaderPromise) {
    _gltfLoaderPromise = import("../../vendor/GLTFLoader.js")
      .then((m) => new m.GLTFLoader())
      .catch(() => null); // 无 loader 文件时整体回退胶囊网格
  }
  return _gltfLoaderPromise;
}

// 渲染器单例：同一 canvas 只创建一个 WebGL 上下文，重开时复用，避免上下文泄漏
let _renderer = null;
function getRenderer(canvas) {
  if (!_renderer) {
    _renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    _renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  }
  return _renderer;
}

class BattleView {
  constructor(canvas, sim) {
    this.sim = sim;
    this.canvas = canvas;
    this.renderer = getRenderer(canvas);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x141210);
    this.scene.fog = new THREE.Fog(0x141210, 16, 34);
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    this.camBase = new THREE.Vector3(0, 6.4, 13.2);
    this.camera.position.copy(this.camBase);
    this.camera.lookAt(0, 1, 0);
    this.shake = 0;

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const sun = new THREE.DirectionalLight(0xfff0d8, 1.6);
    sun.position.set(5, 12, 6);
    this.scene.add(sun);
    const rim = new THREE.DirectionalLight(0x80a0ff, 0.5);
    rim.position.set(-6, 8, -6);
    this.scene.add(rim);

    this._buildGround();
    this.unitGroup = new THREE.Group();
    this.fxGroup = new THREE.Group();
    this.scene.add(this.unitGroup, this.fxGroup);
    this.meshes = new Map();
    for (const u of sim.units) this._buildUnit(u);

    this.projectiles = [];
    this.rings = [];
    this.raycaster = new THREE.Raycaster();
    this.ui = document.getElementById("ui");
    this.barEls = new Map();
    for (const u of sim.units) this._makeBars(u);
    this.time = 0;
    this._onResize = () => this.resize();
    window.addEventListener("resize", this._onResize);
    this.resize();
  }

  dispose() {
    window.removeEventListener("resize", this._onResize);
    // 场景对象随引用释放；渲染器单例保留复用
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  _buildGround() {
    const g = new THREE.Mesh(new THREE.PlaneGeometry(30, 12), new THREE.MeshLambertMaterial({ color: 0x2b241c }));
    g.rotation.x = -Math.PI / 2;
    this.scene.add(g);
    const mid = new THREE.Mesh(
      new THREE.PlaneGeometry(0.12, 12),
      new THREE.MeshBasicMaterial({ color: 0x554433, transparent: true, opacity: 0.6 })
    );
    mid.rotation.x = -Math.PI / 2; mid.position.y = 0.01;
    this.scene.add(mid);
    for (const sx of [-1, 1]) {
      const zone = new THREE.Mesh(
        new THREE.PlaneGeometry(8, 12),
        new THREE.MeshLambertMaterial({ color: sx < 0 ? 0x2e3038 : 0x382c28, transparent: true, opacity: 0.5 })
      );
      zone.rotation.x = -Math.PI / 2; zone.position.set(sx * 8.5, 0.005, 0);
      this.scene.add(zone);
    }
  }

  _buildUnit(u) {
    const grp = new THREE.Group();
    const c = CLS[u.cls];
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.6, 4, 12), new THREE.MeshLambertMaterial({ color: c.color }));
    body.position.y = 0.78;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 16, 12), new THREE.MeshLambertMaterial({ color: 0xe8c39a }));
    head.position.y = 1.5;
    const weapon = new THREE.Mesh(
      new THREE.BoxGeometry(u.isMelee ? 0.08 : 0.06, u.isMelee ? 0.9 : 0.6, 0.08),
      new THREE.MeshLambertMaterial({ color: 0xcccccc })
    );
    weapon.position.set(0.42, 0.95, 0);
    weapon.rotation.z = u.isMelee ? -0.5 : 0;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.4, 0.52, 24),
      new THREE.MeshBasicMaterial({ color: TEAM_COLOR[u.side], side: THREE.DoubleSide, transparent: true, opacity: 0.9 })
    );
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.02;
    grp.add(body, head, weapon, ring);
    grp.position.set(u.x, 0, u.z);
    grp.userData.id = u.id;
    grp.userData.body = body; grp.userData.ring = ring; grp.userData.flash = 0;
    if (u.side === 1) grp.rotation.y = Math.PI;
    this.unitGroup.add(grp);
    this.meshes.set(u.id, grp);
    if (u.id === "shi_qian") this._attachGlbModel(grp, body); // 时迁专用 GLB，失败保持胶囊
  }

  // 加载 assets/models/shiqian.glb 替换胶囊身体（缩放对齐原胶囊身高 ~1.1）；任何失败静默回退
  async _attachGlbModel(grp, body) {
    const loader = await getGLTFLoader();
    if (!loader) return;
    try {
      const gltf = await loader.loadAsync("assets/models/shiqian.glb");
      const model = gltf.scene;
      const box = new THREE.Box3().setFromObject(model);
      const h = box.max.y - box.min.y || 1;
      model.scale.setScalar(1.1 / h);
      box.setFromObject(model); // 缩放后重算包围盒：脚底贴地、水平居中
      model.position.y -= box.min.y;
      model.position.x -= (box.min.x + box.max.x) / 2;
      model.position.z -= (box.min.z + box.max.z) / 2;
      body.visible = false;
      grp.add(model);
    } catch { /* 模型缺失/解析失败：保持胶囊兜底 */ }
  }

  _makeBars(u) {
    const el = document.createElement("div");
    el.className = "bars" + (u.side === 1 ? " enemy" : "");
    el.innerHTML = `<div class="name">${u.name}</div><div class="hp"><i></i></div><div class="rg"><i></i></div><div class="cc"></div>`;
    this.ui.appendChild(el);
    this.barEls.set(u.id, el);
  }

  worldToScreen(x, y, z) {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    return { x: (v.x * 0.5 + 0.5) * window.innerWidth, y: (-v.y * 0.5 + 0.5) * window.innerHeight };
  }

  float(x, y, z, text, color = "#fff", size = 22) {
    const p = this.worldToScreen(x, y, z);
    const el = document.createElement("div");
    el.className = "float";
    el.style.cssText = `left:${p.x}px;top:${p.y}px;color:${color};font-size:${size}px;`;
    el.textContent = text;
    this.ui.appendChild(el);
    setTimeout(() => el.remove(), 920);
  }

  _spawnProjectile(att, tgt, color) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), new THREE.MeshBasicMaterial({ color }));
    m.position.set(att.x, 1.1, att.z);
    this.fxGroup.add(m);
    this.projectiles.push({ m, from: { x: att.x, z: att.z }, to: { id: tgt.id, x: tgt.x, z: tgt.z }, t: 0, dur: 0.22 });
  }
  _spawnRing(x, z, color, maxR = 3.4) {
    const m = new THREE.Mesh(
      new THREE.RingGeometry(0.2, 0.34, 32),
      new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.95 })
    );
    m.rotation.x = -Math.PI / 2; m.position.set(x, 0.05, z);
    this.fxGroup.add(m);
    this.rings.push({ m, t: 0, dur: 0.5, maxR });
  }
  screenFlash(color = "255,180,60", alpha = 0.26) {
    const el = document.createElement("div");
    el.style.cssText = `position:absolute;inset:0;background:rgba(${color},${alpha});pointer-events:none;transition:opacity .4s;`;
    this.ui.appendChild(el);
    requestAnimationFrame(() => (el.style.opacity = "0"));
    setTimeout(() => el.remove(), 450);
  }

  sync(dt, hooks = {}) {
    const sim = this.sim;
    const { onUlt, onChain } = hooks;
    this.time += dt;
    for (const e of sim.events.splice(0)) {
      if (e.type === "attack") {
        const att = sim.byId(e.att), tgt = sim.byId(e.tgt);
        if (att && tgt) {
          if (e.melee) att._lunge = 0.18;
          else this._spawnProjectile(att, tgt, att.cls === "archer" ? 0xffe08a : 0xbf9aff);
        }
      } else if (e.type === "damage") {
        const tgt = sim.byId(e.tgt);
        if (tgt) {
          const color = e.crit ? "#ffd75e" : e.magic ? "#c08aff" : "#ffffff";
          const size = e.ult ? 30 : e.crit ? 26 : 20;
          this.float(tgt.x, 1.9, tgt.z, `${e.crit ? "暴击 " : ""}-${e.amount}`, color, size);
          const mesh = this.meshes.get(tgt.id);
          if (mesh) mesh.userData.flash = 0.12;
        }
      } else if (e.type === "heal") {
        const tgt = sim.byId(e.tgt);
        if (tgt) this.float(tgt.x, 1.9, tgt.z, `+${e.amount}`, "#5ae07a", 20);
      } else if (e.type === "ult") {
        const u = sim.byId(e.unit);
        if (u) {
          this.shake = 0.45;
          this.screenFlash();
          this._spawnRing(u.x, u.z, u.side === 0 ? 0xffd75e : 0xff6a4a, 4.2);
          this.float(u.x, 2.4, u.z, u.ultName, "#ffd75e", 30);
          if (onUlt) onUlt(u);
        }
      } else if (e.type === "smallfx") {
        const u = sim.byId(e.unit);
        const style = SMALLFX_STYLE[e.kind];
        if (u && style) this._spawnRing(u.x, u.z, style.color, style.size);
      } else if (e.type === "die") {
        const tgt = sim.byId(e.tgt);
        if (tgt) this.float(tgt.x, 1.6, tgt.z, "阵亡", "#ff5a4a", 24);
      } else if (e.type === "revive") {
        const tgt = sim.byId(e.tgt);
        if (tgt) { this.float(tgt.x, 2.2, tgt.z, "复活!", "#5ae07a", 30); this._spawnRing(tgt.x, tgt.z, 0x5ae07a, 2.4); }
      } else if (e.type === "cc") {
        const tgt = sim.byId(e.tgt);
        if (tgt) this.float(tgt.x, 1.9, tgt.z, e.label, "#ff9a5e", 22);
      } else if (e.type === "buffself") {
        const u = sim.byId(e.unit);
        if (u) this.float(u.x, 2.0, u.z, e.label, "#ffd75e", 22);
      } else if (e.type === "dodge") {
        const tgt = sim.byId(e.tgt);
        if (tgt) this.float(tgt.x, 1.9, tgt.z, "闪避", "#8fd0ff", 18);
      } else if (e.type === "miss") {
        const tgt = sim.byId(e.tgt);
        if (tgt) this.float(tgt.x, 1.9, tgt.z, "未命中", "#aaaaaa", 18);
      } else if (e.type === "awaken") {
        const u = sim.byId(e.unit);
        if (u) { this.float(u.x, 2.5, u.z, `觉醒·${e.name}`, "#ff9a3a", 28); this._spawnRing(u.x, u.z, 0xff9a3a, 3); }
      } else if (e.type === "chain") {
        if (onChain) onChain(e.count);
      } else if (e.type === "wave_spawn") {
        if (hooks.onWave) hooks.onWave(`第 ${e.wave}/${e.total} 波来袭`);
      } else if (e.type === "wave_clear") {
        if (hooks.onWave) hooks.onWave(`第 ${e.wave}/${e.total} 波已肃清`);
      } else if (e.type === "passive") {
        const u = sim.byId(e.unit);
        if (u) this.float(u.x, 2.2, u.z, `【${e.name}】`, "#e0b0ff", 16);
      }
    }

    for (const u of sim.units) {
      const mesh = this.meshes.get(u.id);
      if (!mesh) continue;
      const ud = mesh.userData;
      if (u.alive) {
        mesh.visible = true;
        mesh.position.x += (u.x - mesh.position.x) * Math.min(1, dt * 10);
        mesh.position.z += (u.z - mesh.position.z) * Math.min(1, dt * 10);
        let y = Math.sin(this.time * 3 + u.x) * 0.03;
        let lz = 0;
        if (u._lunge > 0) { u._lunge -= dt; lz = Math.sin((u._lunge / 0.18) * Math.PI) * 0.3 * (u.side === 0 ? 1 : -1); }
        mesh.position.y = y;
        mesh.position.x += lz * 0.2;
        if (ud.flash > 0) { ud.flash -= dt; ud.body.material.emissive.setHex(0xffffff).multiplyScalar(ud.flash * 4); }
        else ud.body.material.emissive.setHex(0x000000);
        mesh.rotation.z = 0; mesh.rotation.x = 0;
      } else {
        mesh.rotation.z += (1.5 - mesh.rotation.z) * Math.min(1, dt * 6);
        mesh.position.y += (-0.3 - mesh.position.y) * Math.min(1, dt * 6);
      }
      ud.ring.material.color.setHex(sim.focusId === u.id ? 0xffd75e : TEAM_COLOR[u.side]);
      const bar = this.barEls.get(u.id);
      if (bar) {
        if (!u.alive) bar.style.display = "none";
        else {
          bar.style.display = "block";
          const p = this.worldToScreen(mesh.position.x, 2.15, mesh.position.z);
          bar.style.left = p.x + "px"; bar.style.top = p.y + "px";
          bar.querySelector(".hp i").style.width = (u.hp / u.maxHp) * 100 + "%";
          bar.querySelector(".rg i").style.width = (u.rage / 100) * 100 + "%";
          bar.querySelector(".cc").textContent = u.ccLocked ? "眩晕" : "";
        }
      }
    }

    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.t += dt;
      const k = Math.min(1, p.t / p.dur);
      const tgt = sim.byId(p.to.id);
      const tx = tgt ? tgt.x : p.to.x, tz = tgt ? tgt.z : p.to.z;
      p.m.position.set(p.from.x + (tx - p.from.x) * k, 1.1 + Math.sin(k * Math.PI) * 0.4, p.from.z + (tz - p.from.z) * k);
      if (k >= 1) { this.fxGroup.remove(p.m); this.projectiles.splice(i, 1); }
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.t += dt;
      const k = Math.min(1, r.t / r.dur);
      r.m.scale.setScalar(1 + k * r.maxR);
      r.m.material.opacity = 0.95 * (1 - k);
      if (k >= 1) { this.fxGroup.remove(r.m); this.rings.splice(i, 1); }
    }

    if (this.shake > 0) {
      this.shake -= dt;
      const s = this.shake * 0.25;
      this.camera.position.set(
        this.camBase.x + (Math.random() - 0.5) * s,
        this.camBase.y + (Math.random() - 0.5) * s,
        this.camBase.z
      );
    } else this.camera.position.copy(this.camBase);

    this.renderer.render(this.scene, this.camera);
  }

  pickEnemy(clientX, clientY) {
    const ndc = new THREE.Vector2((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const meshes = this.sim.units.filter((u) => u.side === 1 && u.alive).map((u) => this.meshes.get(u.id));
    const hits = this.raycaster.intersectObjects(meshes, true);
    if (hits.length) {
      let o = hits[0].object;
      while (o && !o.userData.id) o = o.parent;
      return o ? o.userData.id : null;
    }
    return null;
  }
}

// ---------- 启动 / HUD ----------
const canvas = document.getElementById("gl");
let sim, view, speed = 1, paused = false, raf = null, ended = false, acc = 0, lastT = 0;
let autoUlt = false;            // 托管开关（重开保持）
let csvCache = null;            // CSV 文本缓存（不含编队，重开按最新存档重装配）
let currentLevel = null;        // 当前关卡行（结算发奖励用）
let currentSave = null;         // 本局存档快照（结算写回）
const ultbar = document.getElementById("ultbar");
const logEl = document.getElementById("log");
const ultToast = document.getElementById("ultToast");
const chainEl = document.getElementById("chain");
const waveEl = document.getElementById("waveInfo");
const autoBtn = document.getElementById("autoBtn");

async function ensureCsv() {
  if (csvCache) return csvCache;
  const files = ["units", "skills", "proto_awaken", "growth_curve", "battle_constants", "progression", "waves", "levels_proto"];
  const texts = await Promise.all(files.map((f) => fetch(`data/${f}.csv`).then((r) => r.text())));
  csvCache = Object.fromEntries(files.map((f, i) => [f, texts[i]]));
  return csvCache;
}

// 每局都按最新存档装配：编队/养成改动立即生效
async function buildBattleTeams() {
  const csv = await ensureCsv();
  const save = await loadSave();
  const levelId = getPendingLevel();
  currentLevel = parseCsvTable(csv.levels_proto).find((r) => r.level_id === levelId)
    || parseCsvTable(csv.levels_proto)[0];
  const teams = buildTeams({
    unitsCsv: csv.units, skillsCsv: csv.skills, awakenCsv: csv.proto_awaken,
    growthCsv: csv.growth_curve, constsCsv: csv.battle_constants, progressionCsv: csv.progression,
    playerFormation: save.formation,
    wavesCsv: csv.waves, battleId: currentLevel.battle_id,
    heroStates: getHeroStates(save),
  });
  return { teams, save };
}

function log(msg) {
  const d = document.createElement("div");
  d.textContent = msg;
  logEl.prepend(d);
  while (logEl.children.length > 6) logEl.lastChild.remove();
}
function buildUltBar() {
  ultbar.innerHTML = "";
  sim.units.filter((u) => u.side === 0).forEach((u, i) => {
    const el = document.createElement("div");
    el.className = "ult";
    el.dataset.id = u.id;
    el.innerHTML = `<span class="key">${i + 1}</span><div class="nm">${u.name}</div><div class="sk">${u.ultName}</div><div class="rage"><i></i></div>`;
    el.onclick = () => tryUlt(u.id);
    ultbar.appendChild(el);
  });
}
function refreshUltBar() {
  sim.units.filter((u) => u.side === 0).forEach((u) => {
    const el = ultbar.querySelector(`[data-id="${u.id}"]`);
    if (!el) return;
    el.querySelector(".rage i").style.width = u.rage + "%";
    el.classList.toggle("full", u.alive && u.rage >= 100);
    el.classList.toggle("dead", !u.alive);
  });
}
function tryUlt(id) {
  const u = sim.byId(id);
  if (!u || !u.alive || u.rage < 100) return;
  sim.castUlt(u);
}
function onUlt(u) {
  ultToast.textContent = u.ultName;
  ultToast.classList.remove("show");
  void ultToast.offsetWidth;
  ultToast.classList.add("show");
  log(`${u.side === 0 ? "我方" : "敌方"} ${u.name} 释放【${u.ultName}】`);
}
let chainHideT = null;
function onChain(count) {
  if (count < 2) { chainEl.classList.remove("show"); return; }
  chainEl.textContent = `连锁 ×${count}  伤害+${(count - 1) * 20}%`;
  chainEl.classList.add("show");
  if (chainHideT) clearTimeout(chainHideT);
  chainHideT = setTimeout(() => chainEl.classList.remove("show"), 3000);
}
// 结算：胜/负 + 评价（S=无阵亡，A=有阵亡，B=战败）+ 发奖写存档
function showBanner(winner, save) {
  const win = winner === 0;
  const rating = win ? (sim.deaths[0].length === 0 ? "S" : "A") : "B";
  document.getElementById("bannerTitle").textContent = win ? "胜  利" : "战  败";
  document.getElementById("bannerTitle").style.color = win ? "#ffd27a" : "#ff6a5a";
  document.getElementById("bannerSub").textContent =
    `评价 ${rating} · ${win ? (rating === "S" ? "全员生还，毫发无损" : "梁山好汉凯旋而归") : "兄弟们撤回梁山，重整旗鼓"}`;
  let rewardText = "战败无奖励";
  if (win && currentLevel && save) {
    const firstClear = !save.progress.cleared.includes(currentLevel.level_id);
    const mult = firstClear ? 2 : 1; // 首通双倍
    const exp = Number(currentLevel.reward_exp) * mult;
    const mats = Number(currentLevel.reward_mats) * mult;
    addRewards(save, { exp, mats });
    markCleared(save, currentLevel.level_id);
    storeSave(save);
    rewardText = `获得 经验×${exp} 材料×${mats}${firstClear ? "（首通双倍）" : ""}`;
  }
  document.getElementById("bannerReward").textContent = rewardText;
  document.getElementById("banner").classList.add("show");
}

function refreshWaveInfo() {
  const wi = sim.waveInfo;
  waveEl.textContent = `第 ${wi.wave}/${wi.total} 波${wi.pending ? " · 援军逼近…" : ""}`;
}

function loop(t) {
  raf = requestAnimationFrame(loop);
  const dt = Math.min((t - lastT) / 1000, 0.05);
  lastT = t;
  if (!paused && sim.winner < 0) {
    acc += dt * speed;
    while (acc >= SIM_STEP) { sim.step(SIM_STEP); acc -= SIM_STEP; }
  }
  view.sync(dt, { onUlt, onChain, onWave: log });
  refreshUltBar();
  refreshWaveInfo();
  if (sim.winner >= 0 && !ended) { ended = true; setTimeout(() => showBanner(sim.winner, currentSave), 700); }
}

async function start() {
  if (raf) cancelAnimationFrame(raf);
  if (view) view.dispose();
  document.querySelectorAll(".bars").forEach((e) => e.remove());
  document.getElementById("banner").classList.remove("show");
  logEl.innerHTML = "";
  const { teams, save } = await buildBattleTeams();
  currentSave = save;
  sim = new Sim(teams, 20260727);
  sim.autoUlt = autoUlt;
  view = new BattleView(canvas, sim);
  buildUltBar();
  document.getElementById("battleTitle").textContent = `水浒 · ${currentLevel.name}`;
  refreshWaveInfo();
  ended = false; acc = 0; lastT = performance.now();
  log(`出战「${currentLevel.name}」：自动普攻攒怒，怒满点下方大招（或按 1-5）`);
  raf = requestAnimationFrame(loop);
}

canvas.addEventListener("click", (e) => {
  const id = view.pickEnemy(e.clientX, e.clientY);
  if (id) { sim.focusId = id; log(`集火 → ${sim.byId(id).name}`); }
});
document.getElementById("speedBtn").onclick = (e) => {
  speed = speed >= 3 ? 1 : speed + 1;
  e.target.textContent = `速度 ×${speed}`;
  e.target.classList.toggle("on", speed > 1);
};
document.getElementById("pauseBtn").onclick = (e) => {
  paused = !paused;
  e.target.textContent = paused ? "继续" : "暂停";
  e.target.classList.toggle("on", paused);
};
document.getElementById("restartBtn").onclick = start;
document.getElementById("againBtn").onclick = start;
document.getElementById("hallBtn").onclick = () => (location.href = "hall.html");
autoBtn.onclick = () => {
  autoUlt = !autoUlt;
  if (sim) sim.autoUlt = autoUlt;
  autoBtn.classList.toggle("on", autoUlt);
  autoBtn.textContent = autoUlt ? "托管中" : "托管";
  log(autoUlt ? "托管开启：怒气满自动放大招" : "托管关闭：手动放大招");
};
window.addEventListener("keydown", (e) => {
  const players = sim.units.filter((u) => u.side === 0);
  const idx = parseInt(e.key, 10) - 1;
  if (idx >= 0 && idx < players.length) tryUlt(players[idx].id);
});

start();
