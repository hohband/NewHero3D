// 水浒 · 横版自动战斗原型 · 表现层（three.js + HTML overlay）
// 逻辑在 ./sim.js（纯逻辑，可 node 无头跑）；本文件只消费 Sim 状态与事件做渲染
import * as THREE from "three";
import { Sim, CLS, SIM_STEP } from "./sim.js";
import { buildTeams } from "./data.js";
import { loadSave, storeSave, getHeroStates, getPendingLevel, addRewards, markCleared } from "../ui/save.js";
import { parseCsvTable } from "../shared/csv.js";

const TEAM_COLOR = { 0: 0x3f8fd0, 1: 0xd0503a };
// 已有真模型的单位：文件名约定 assets/models/<unit_id>.glb；未列入者保持胶囊（避免无谓 404）
// 第二批（2026-09-14）：补齐 strategist / support / healer 三个此前全空的职业 + 首个女性角色
// 第三批（2026-09-15）：按主线出场顺序铺量 —— 这 10 人 = story_01 + story_02 的全部敌方单位，
//   做完后前两关每个出场单位都有真模型（此前 story_01 敌将 0/3、story_02 0/7 全是胶囊）。
//   前 5 位是本项目首次做 green（绿）品质的低阶角色。
const MODEL_UNITS = new Set([
  "shi_qian", "lin_chong", "lu_zhishen", "wu_song", "hua_rong",
  "gongsun_sheng", "wu_yong", "li_kui", "qin_ming", "hu_sanniang", "yan_qing", "dai_zong", "an_daoquan",
  "song_wan", "du_qian", "bai_sheng", "shi_yong", "wang_ying",
  "wang_dingliu", "sun_erniang", "jiao_ting", "gong_wang", "ding_desun",
]);
// 文件名别名：早期资产用了无下划线命名，与 <unit_id>.glb 约定不符。
// 曾因缺这张表导致 shi_qian.glb 请求 404 → 时迁在战场里静默回退胶囊。
const MODEL_FILE = { shi_qian: "shiqian.glb" };
// GLB 的额外 Y 偏航；经 Blender 四向渲染确认本管线模型正脸原生朝 glTF +Z（镜头方向），无需旋转
const MODEL_YAW = 0;
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

// 把模型归一到指定身高、脚底贴地、水平居中。
// 注意：蒙皮网格（SkinnedMesh）的几何包围盒不含骨骼变换，单次测量会把身高算错（模型被放大数倍），
// 故先「测→缩→重测」迭代 3 轮收敛归一，并把骨骼世界坐标一并计入包围盒。
function measureBounds(obj) {
  obj.updateMatrixWorld(true);
  const b = new THREE.Box3();
  b.setFromObject(obj);
  const v = new THREE.Vector3();
  obj.traverse((o) => { if (o.isBone) b.expandByPoint(o.getWorldPosition(v)); });
  return b;
}

function normalizeModel(obj, targetHeight) {
  let box = measureBounds(obj);
  for (let pass = 0; pass < 3; pass++) {
    const h = box.max.y - box.min.y;
    if (!(h > 1e-6)) break;
    obj.scale.multiplyScalar(1 / h); // 先归一到身高 1
    box = measureBounds(obj);
  }
  const h = (box.max.y - box.min.y) || 1;
  obj.scale.multiplyScalar(targetHeight / h);
  box = measureBounds(obj);
  obj.position.y -= box.min.y;
  obj.position.x -= (box.min.x + box.max.x) / 2;
  obj.position.z -= (box.min.z + box.max.z) / 2;
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

  // 补建「后到」的单位。sim.js 构造时只刷第一波（`_spawnWaveCfgs(this.waves[0])`），
  // 后续波次由 `_startNextWave()` 直接 push 进 sim.units；而视觉层只在构造时按当时的
  // sim.units 建过一次 → **第 2 波起的敌人没有 3D 组、也没有血条**，
  // 表现上就是「看不见的敌人在打你」（战斗日志里它照样放技能）。
  // 2026-09-15 第三批验收 story_02 第二波时发现 —— 与模型资产无关，是既有缺口。
  _buildPendingUnits() {
    for (const u of this.sim.units) {
      if (this.meshes.has(u.id)) continue;
      this._buildUnit(u);
      this._makeBars(u);
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
    // 胶囊占位件的三个 Mesh 都记下来：真模型接上后要一起隐藏。
    // 曾只隐藏 body 而漏掉 head → 有模型的单位头顶永远飘着一个肤色球（回退胶囊的头）。
    grp.userData.body = body; grp.userData.head = head; grp.userData.weapon = weapon;
    grp.userData.ring = ring; grp.userData.flash = 0;
    if (u.side === 1) grp.rotation.y = Math.PI;
    this.unitGroup.add(grp);
    this.meshes.set(u.id, grp);
    // 按 unit_id 查表加载真模型；无模型或加载失败一律保持胶囊（表现层不因资源缺失而崩）
    if (MODEL_UNITS.has(u.id)) this._attachGlbModel(grp, `assets/models/${MODEL_FILE[u.id] || `${u.id}.glb`}`);
  }

  // 加载 GLB 替换胶囊占位（身高对齐胶囊 ~1.1）；任何失败静默回退胶囊
  async _attachGlbModel(grp, url) {
    const loader = await getGLTFLoader();
    if (!loader) return;
    try {
      const gltf = await loader.loadAsync(url);
      const model = gltf.scene;
      normalizeModel(model, 1.1);
      model.rotation.y = MODEL_YAW;
      // 占位胶囊要整组隐藏（身体 + 头 + 那根示意武器棒），只留脚下的队伍色环
      for (const k of ["body", "head", "weapon"]) {
        const ph = grp.userData[k];
        if (ph) ph.visible = false;
      }
      grp.add(model);
      // 骨骼动画：GLB 带 idle/attack/hit/skill 时建 mixer，默认循环 idle
      if (gltf.animations && gltf.animations.length) {
        const mixer = new THREE.AnimationMixer(model);
        const actions = {};
        for (const clip of gltf.animations) actions[clip.name] = mixer.clipAction(clip);
        grp.userData.mixer = mixer;
        grp.userData.actions = actions;
        mixer.addEventListener("finished", () => this._playUnitAnim(grp, "idle")); // 一次性动作播完回 idle
        this._playUnitAnim(grp, "idle");
      }
    } catch { /* 模型缺失/解析失败：保持胶囊兜底 */ }
  }

  // 切换骨骼动画：once=true 播一次（attack/hit/skill），靠 finished 事件回 idle
  _playUnitAnim(grp, name, once = false) {
    const ud = grp.userData;
    if (!ud.actions || !ud.actions[name]) return;
    const next = ud.actions[name];
    if (ud.curAnim === next && !once) return;
    next.reset();
    next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    next.clampWhenFinished = once;
    if (ud.curAnim && ud.curAnim !== next) next.crossFadeFrom(ud.curAnim, 0.12, false);
    next.play();
    ud.curAnim = next;
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
          if (e.melee) {
            att._lunge = 0.18;
            const m = this.meshes.get(att.id);
            if (m && m.userData.actions) this._playUnitAnim(m, "attack", true); // 近战挥击动作
          }
          else this._spawnProjectile(att, tgt, att.cls === "archer" ? 0xffe08a : 0xbf9aff);
        }
      } else if (e.type === "damage") {
        const tgt = sim.byId(e.tgt);
        if (tgt) {
          const color = e.crit ? "#ffd75e" : e.magic ? "#c08aff" : "#ffffff";
          const size = e.ult ? 30 : e.crit ? 26 : 20;
          this.float(tgt.x, 1.9, tgt.z, `${e.crit ? "暴击 " : ""}-${e.amount}`, color, size);
          const mesh = this.meshes.get(tgt.id);
          if (mesh) {
            mesh.userData.flash = 0.12;
            // 受击动作：仅在 idle 时插播，避免打断攻击/大招
            const ud = mesh.userData;
            if (ud.actions && ud.curAnim === ud.actions.idle) this._playUnitAnim(mesh, "hit", true);
          }
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
          const m = this.meshes.get(u.id);
          if (m && m.userData.actions) this._playUnitAnim(m, "skill", true); // 大招跳劈动作
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
        // 必须在这里补建：新波的敌人在这一刻才被 push 进 sim.units（见 _buildPendingUnits）
        this._buildPendingUnits();
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
      if (u.alive && ud.mixer) ud.mixer.update(dt); // 推进骨骼动画（阵亡定格随组倾倒）
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
