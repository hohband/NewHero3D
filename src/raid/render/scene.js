// 劫寨 Demo Three.js 场景（2.5D 俯视棋盘）
// 表现层：只读逻辑状态，不写逻辑。颜色块+头顶血条，后续可换模型。
import * as THREE from "three";
import { HEROES, BUILDINGS, LEVEL } from "../core/data.js";

const TILE = 1;

export class RaidScene {
  constructor(canvas, bm) {
    this.bm = bm;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a1410);
    this.scene.fog = new THREE.Fog(0x1a1410, 20, 45);

    // 摄像机（2.5D 俯视斜视）
    this.camera = new THREE.PerspectiveCamera(46, 1, 0.1, 200);
    this.camTarget = new THREE.Vector3(LEVEL.w / 2, 0, LEVEL.h / 2);
    this.camDist = 20; this.camAngle = Math.PI / 4; this.camPitch = 0.95;
    this._updateCamera();

    // 灯光
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const sun = new THREE.DirectionalLight(0xfff2d8, 1.1);
    sun.position.set(10, 18, 6);
    this.scene.add(sun);

    this.unitMeshes = new Map();   // uid -> mesh
    this.buildingMeshes = new Map();
    this.hpBars = new Map();
    this.groundTiles = [];
    this.effects = [];             // 临时特效

    this._buildGround();
    this._buildings();
    this._resize();
    window.addEventListener("resize", () => this._resize());
  }

  _resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  _updateCamera() {
    const { camDist, camAngle, camPitch, camTarget } = this;
    let ox = 0, oy = 0;
    if (this._shake && this._shake.t > 0) {
      const s = this._shake;
      ox = (Math.random() * 2 - 1) * s.mag * (s.t / s.dur);
      oy = (Math.random() * 2 - 1) * s.mag * (s.t / s.dur);
    }
    this.camera.position.set(
      camTarget.x + Math.cos(camAngle) * Math.cos(camPitch) * camDist + ox,
      Math.sin(camPitch) * camDist + oy,
      camTarget.z + Math.sin(camAngle) * Math.cos(camPitch) * camDist
    );
    this.camera.lookAt(camTarget);
  }

  // 震屏：mag 幅度、dur 时长(秒)
  shake(mag = 0.25, dur = 0.3) { this._shake = { mag, dur, t: dur }; }

  rotateCam(d) { this.camAngle += d; this._updateCamera(); }
  zoomCam(d) { this.camDist = Math.max(10, Math.min(32, this.camDist + d)); this._updateCamera(); }
  panCam(dx, dz) {
    const s = 0.02 * this.camDist;
    const fx = -Math.sin(this.camAngle), fz = Math.cos(this.camAngle);
    const rx = Math.cos(this.camAngle), rz = Math.sin(this.camAngle);
    this.camTarget.x += (rx * dx - fx * dz) * s;
    this.camTarget.z += (rz * dx - fz * dz) * s;
    this.camTarget.x = Math.max(2, Math.min(LEVEL.w - 2, this.camTarget.x));
    this.camTarget.z = Math.max(2, Math.min(LEVEL.h - 2, this.camTarget.z));
    this._updateCamera();
  }

  _buildGround() {
    const g = new THREE.PlaneGeometry(LEVEL.w, LEVEL.h);
    const mat = new THREE.MeshLambertMaterial({ color: 0x3d3125 });
    const ground = new THREE.Mesh(g, mat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(LEVEL.w / 2 - 0.5, 0, LEVEL.h / 2 - 0.5);
    this.scene.add(ground);
    // 网格线
    const grid = new THREE.GridHelper(LEVEL.w, LEVEL.w, 0x554433, 0x554433);
    grid.position.set(LEVEL.w / 2 - 0.5, 0.01, LEVEL.h / 2 - 0.5);
    grid.scale.z = LEVEL.h / LEVEL.w;
    this.scene.add(grid);
    // 部署区高亮
    for (const sp of LEVEL.spawnPoints) {
      const m = new THREE.Mesh(new THREE.CircleGeometry(1.2, 24), new THREE.MeshBasicMaterial({ color: 0x2a7a3a, transparent: true, opacity: 0.35 }));
      m.rotation.x = -Math.PI / 2; m.position.set(sp.x, 0.02, sp.y);
      this.scene.add(m);
    }
  }

  _buildingColor(b) {
    switch (b.kind) {
      case "wall": return b.type === "inner_wall" ? 0x777777 : 0x8a6a3a;
      case "tower": return b.type === "watchtower" ? 0x4a6a9a : 0xa05a2a;
      case "core": return 0xc8a838;
      case "resource": return 0x7a9a3a;
      case "trap": return 0x994444;
      default: return 0x888888;
    }
  }

  _buildings() {
    for (const b of this.bm.buildings) {
      let mesh;
      if (b.kind === "trap") {
        mesh = new THREE.Mesh(new THREE.CircleGeometry(0.4, 6), new THREE.MeshBasicMaterial({ color: 0x994444 }));
        mesh.rotation.x = -Math.PI / 2; mesh.position.set(b.x, 0.03, b.y);
      } else {
        const hgt = b.kind === "core" ? 1.6 : b.kind === "tower" ? 1.5 : 0.9;
        const size = b.kind === "core" ? 1.6 : 0.92;
        mesh = new THREE.Mesh(new THREE.BoxGeometry(size, hgt, size), new THREE.MeshLambertMaterial({ color: this._buildingColor(b) }));
        mesh.position.set(b.x, hgt / 2, b.y);
      }
      mesh.userData.building = b;
      this.scene.add(mesh);
      this.buildingMeshes.set(b.uid, mesh);
      if (b.kind !== "trap") this._addHpBar(b.uid, b, 1.2);
      // 粮仓加脉冲高亮圈（引导劫掠）
      if (b.kind === "resource") {
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.05, 24), new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.5, side: THREE.DoubleSide }));
        ring.rotation.x = -Math.PI / 2; ring.position.set(b.x, 0.04, b.y);
        this.scene.add(ring);
        b._lootRing = ring;
      }
    }
  }

  _heroColor(id) {
    const map = { luzhishen: 0x4a9a4a, linchong: 0x4a7ac8, wuyong: 0xb8b04a, gongsunsheng: 0x9a5ac8, yanqing: 0x4ac8b8, likui: 0xc84a4a, huarong: 0xc89a4a, shiqian: 0x888888 };
    return map[id] || 0x4a9ac8;
  }

  _unitMesh(u) {
    let color, size = 0.6, hgt = 0.9;
    if (u.kind === "hero") { color = this._heroColor(u.id); size = 0.62; hgt = 1.0; }
    else if (u.isBoss) { color = 0xd03030; size = 1.0; hgt = 1.5; }
    else if (u.kind === "sentry") { color = 0xd8b84a; size = 0.5; hgt = 0.8; }
    else if (u.kind === "summon") { color = 0x8ab84a; size = 0.5; hgt = 0.7; }
    else color = u.def && u.def.id === "spearman" ? 0x7a5a9a : 0x9a5a4a; // 守军
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(size / 2, size / 2, hgt, 10), new THREE.MeshLambertMaterial({ color }));
    mesh.position.set(u.x, hgt / 2, u.y);
    mesh.userData.unit = u;
    // Boss 加冠
    if (u.isBoss) {
      const crown = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.4, 6), new THREE.MeshLambertMaterial({ color: 0xffd27a }));
      crown.position.y = hgt / 2 + 0.25; mesh.add(crown);
    }
    this.scene.add(mesh);
    this.unitMeshes.set(u.uid, mesh);
    this._addHpBar(u.uid, u, hgt + 0.4);
    return mesh;
  }

  _addHpBar(uid, ent, y) {
    const cvs = document.createElement("canvas"); cvs.width = 64; cvs.height = 8;
    const tex = new THREE.CanvasTexture(cvs);
    const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false });
    const spr = new THREE.Sprite(mat);
    spr.scale.set(1.1, 0.14, 1);
    this.scene.add(spr);
    this.hpBars.set(uid, { spr, cvs, tex, ent, y });
  }

  _updateHpBar(uid) {
    const hb = this.hpBars.get(uid);
    if (!hb) return;
    const { cvs, tex, ent } = hb;
    const ctx = cvs.getContext("2d");
    const ratio = Math.max(0, ent.hp / ent.maxHp);
    ctx.clearRect(0, 0, 64, 8);
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, 64, 8);
    ctx.fillStyle = ratio > 0.5 ? "#4c4" : ratio > 0.25 ? "#ec3" : "#e44";
    ctx.fillRect(1, 1, 62 * ratio, 6);
    tex.needsUpdate = true;
  }

  // 命中特效
  hitFx(x, y, color = 0xffcc44) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.18, 6, 6), new THREE.MeshBasicMaterial({ color }));
    m.position.set(x, 0.6, y);
    this.scene.add(m);
    this.effects.push({ m, life: 0.25, vy: 3 });
  }
  aoeFx(x, y, r) {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.2, r, 24), new THREE.MeshBasicMaterial({ color: 0xaa66ff, transparent: true, opacity: 0.7, side: THREE.DoubleSide }));
    m.rotation.x = -Math.PI / 2; m.position.set(x, 0.05, y);
    this.scene.add(m);
    this.effects.push({ m, life: 0.5, grow: 1 });
  }

  // 鲁智深金身：金色光柱 + 扩散环
  goldenFx(x, y) {
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 2.2, 12, 1, true), new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.4, side: THREE.DoubleSide }));
    pillar.position.set(x, 1.1, y);
    this.scene.add(pillar); this.effects.push({ m: pillar, life: 0.6, grow: 0.5 });
    this.shake(0.12, 0.25);
  }
  // 林冲突进：残影直线
  dashFx(x0, y0, x1, y1) {
    const n = 6;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.22, 6, 6), new THREE.MeshBasicMaterial({ color: 0x66aaff, transparent: true, opacity: 0.7 * (1 - t) }));
      m.position.set(x0 + (x1 - x0) * t, 0.5, y0 + (y1 - y0) * t);
      this.scene.add(m); this.effects.push({ m, life: 0.3 });
    }
  }
  // 花荣狙击：弹道线
  snipeFx(x0, y0, x1, y1) {
    const pts = [new THREE.Vector3(x0, 0.7, y0), new THREE.Vector3(x1, 0.7, y1)];
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xffe08a }));
    this.scene.add(line); this.effects.push({ m: line, life: 0.25 });
    this.shake(0.15, 0.2);
  }
  // 旋风：旋转环
  whirlFx(x, y) {
    const m = new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.18, 8, 16), new THREE.MeshBasicMaterial({ color: 0xff6644, transparent: true, opacity: 0.7 }));
    m.rotation.x = Math.PI / 2; m.position.set(x, 0.5, y);
    this.scene.add(m); this.effects.push({ m, life: 0.45, spin: 8 });
    this.shake(0.1, 0.2);
  }
  // 全屏白闪（核心摧毁）
  flash() {
    const d = document.createElement("div");
    d.style.cssText = "position:fixed;inset:0;background:#fff;opacity:0.9;pointer-events:none;z-index:99;transition:opacity 0.5s;";
    document.body.appendChild(d);
    requestAnimationFrame(() => { d.style.opacity = "0"; setTimeout(() => d.remove(), 550); });
  }
  // Boss 击败特写：镜头拉近 + 震屏
  bossDownFx(x, y) {
    this.camTarget.set(x, 0, y);
    this.camDist = Math.max(11, this.camDist - 3);
    this._updateCamera();
    this.shake(0.4, 0.6);
    for (let i = 0; i < 10; i++) this.hitFx(x + (Math.random() * 2 - 1) * 1.5, y + (Math.random() * 2 - 1) * 1.5, 0xff5544);
  }

  // 每帧同步逻辑状态 → 表现
  sync(dt) {
    const bm = this.bm;
    if (this._shake && this._shake.t > 0) { this._shake.t -= dt; this._updateCamera(); }
    // 天气粒子下落
    if (this._weatherP) {
      const pos = this._weatherP.geometry.attributes.position;
      const sp = this._weatherP.userData.speed;
      for (let i = 0; i < pos.count; i++) {
        let y = pos.getY(i) - sp * dt * 10;
        if (y < 0) y = 12;
        pos.setY(i, y);
      }
      pos.needsUpdate = true;
    }
    // 新单位
    for (const u of bm.units) {
      if (!this.unitMeshes.has(u.uid)) this._unitMesh(u);
      const mesh = this.unitMeshes.get(u.uid);
      // 迷雾：敌方单位在迷雾外不渲染（己方始终可见）
      const inFog = u.team === 1 && !bm.isVisible(u.x, u.y);
      mesh.visible = u.alive && !inFog;
      if (u.alive) {
        mesh.position.x += (u.x - mesh.position.x) * Math.min(1, dt * 12);
        mesh.position.z += (u.y - mesh.position.z) * Math.min(1, dt * 12);
        // 潜行半透明
        mesh.material.opacity = u.isStealthed && u.isStealthed(bm.time) ? 0.35 : 1;
        mesh.material.transparent = true;
        // 诱饵草人标记（棕色）
        if (u.isDecoy && !u._decoyTinted) { mesh.material.color.setHex(0x9a7a4a); u._decoyTinted = true; }
      }
      const hb = this.hpBars.get(u.uid);
      if (hb) { hb.spr.visible = u.alive && !inFog; hb.spr.position.set(mesh.position.x, hb.y, mesh.position.z); this._updateHpBar(u.uid); }
    }
    // 建筑
    for (const b of bm.buildings) {
      const mesh = this.buildingMeshes.get(b.uid);
      if (!mesh) continue;
      // 迷雾：建筑在迷雾外不渲染（核心/陷阱始终可见以维持目标感）
      const inFogB = b.kind !== "core" && b.kind !== "trap" && !bm.isVisible(b.x, b.y);
      mesh.visible = !inFogB;
      if (b.destroyed) { mesh.visible = b.kind === "trap" ? false : mesh.visible; mesh.scale.y = Math.max(0.08, mesh.scale.y - dt * 2); if (b.kind !== "trap") mesh.position.y = mesh.scale.y / 2 * (b.kind === "core" ? 1.6 : 0.9); }
      const hb = this.hpBars.get(b.uid);
      if (hb) { hb.spr.visible = !b.destroyed && !inFogB; hb.spr.position.set(b.x, hb.y, b.y); this._updateHpBar(b.uid); }
      // 粮仓高亮圈脉冲 + 摧毁后隐藏
      if (b._lootRing) {
        b._lootRing.visible = !b.destroyed;
        if (!b.destroyed) { const s = 1 + Math.sin(bm.time * 4) * 0.12; b._lootRing.scale.set(s, s, 1); }
      }
    }
    // 特效
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i];
      e.life -= dt;
      if (e.vy) e.m.position.y += e.vy * dt;
      if (e.grow) e.m.scale.multiplyScalar(1 + dt * 6);
      if (e.spin) e.m.rotation.z += e.spin * dt;
      if (e.life <= 0) { this.scene.remove(e.m); this.effects.splice(i, 1); }
    }
  }

  render() { this.renderer.render(this.scene, this.camera); }

  // 天气视觉：色调 + 粒子
  setWeatherFx(weatherId) {
    // 清理旧天气粒子
    if (this._weatherP) { this.scene.remove(this._weatherP); this._weatherP = null; }
    this.scene.fog.color.setHex(0x1a1410);
    this.scene.fog.near = 20; this.scene.fog.far = 45;
    if (weatherId === "rain") {
      this.scene.fog.color.setHex(0x141820); this.scene.fog.near = 12; this.scene.fog.far = 34;
      this._weatherP = this._makeParticles(0x6a8ac8, 300, 0.05, 0.4);
    } else if (weatherId === "fog") {
      this.scene.fog.color.setHex(0x2a2a2e); this.scene.fog.near = 6; this.scene.fog.far = 22;
      this._weatherP = this._makeParticles(0xaaaaaa, 150, 0.02, 0.15);
    } else if (weatherId === "snow") {
      this.scene.fog.color.setHex(0x1e2026); this.scene.fog.near = 14; this.scene.fog.far = 40;
      this._weatherP = this._makeParticles(0xffffff, 250, 0.03, 0.2);
    }
  }
  _makeParticles(color, count, size, speed) {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = Math.random() * 24;
      pos[i * 3 + 1] = Math.random() * 12;
      pos[i * 3 + 2] = Math.random() * 16;
    }
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ color, size, transparent: true, opacity: 0.7 });
    const pts = new THREE.Points(geo, mat);
    pts.userData.speed = speed;
    this.scene.add(pts);
    return pts;
  }

  // —— 技能选点预览 ——
  showSkillPreview(kind, x, y, param) {
    this.clearSkillPreview();
    let m;
    if (kind === "aoe") {
      m = new THREE.Mesh(new THREE.RingGeometry(param - 0.15, param, 32), new THREE.MeshBasicMaterial({ color: 0xaa66ff, transparent: true, opacity: 0.6, side: THREE.DoubleSide }));
      m.rotation.x = -Math.PI / 2; m.position.set(x, 0.06, y);
    } else if (kind === "dash") {
      m = new THREE.Mesh(new THREE.PlaneGeometry(0.5, param), new THREE.MeshBasicMaterial({ color: 0x66aaff, transparent: true, opacity: 0.5, side: THREE.DoubleSide }));
      m.rotation.x = -Math.PI / 2; m.position.set(x, 0.06, y);
      m.rotation.z = this._dashAngle || 0;
    } else if (kind === "snipe") {
      m = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.4, 24), new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
      m.rotation.x = -Math.PI / 2; m.position.set(x, 0.06, y);
    }
    if (m) { this.scene.add(m); this._preview = m; }
  }
  clearSkillPreview() { if (this._preview) { this.scene.remove(this._preview); this._preview = null; } }

  // 屏幕点 → 地面坐标（部署/技能选点）
  screenToGround(px, py) {
    const ndc = new THREE.Vector2((px / window.innerWidth) * 2 - 1, -(py / window.innerHeight) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const pt = new THREE.Vector3();
    ray.ray.intersectPlane(plane, pt);
    if (!pt) return null;
    return { x: Math.round(pt.x), y: Math.round(pt.z) };
  }
}
