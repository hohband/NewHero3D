// Three.js 2.5D 战斗场景：棋盘建模、单位显示、高亮层、事件动画回放、格子拾取
import * as THREE from "three";
import { cellKey } from "../core/coords.js";
import { UnitCard, TEAM_COLORS, QUALITY_COLORS } from "./portrait.js";

const TILE = 1;
const BASE_H = 0.28;
const HEIGHT_STEP = 0.42;

export const TERRAIN_STYLE = {
  plain: { color: 0x8fa066, label: "平原" },
  forest: { color: 0x4e7040, label: "森林" },
  hill: { color: 0x9a8a68, label: "山地" },
  water: { color: 0x3d6a9e, label: "水面" },
  barricade: { color: 0x7a6a50, label: "拒马" },
  camp: { color: 0xa08a5a, label: "营帐" },
  fire: { color: 0x8a5a40, label: "火堆" },
  road: { color: 0xa89878, label: "土路" },
  wine_stall: { color: 0xb09a6a, label: "酒摊" },
};

const HIGHLIGHT_COLORS = {
  move: { color: 0x3d8fd6, opacity: 0.42 },
  attack: { color: 0xd04040, opacity: 0.5 },
  obstacle: { color: 0xe08830, opacity: 0.5 },
  skill: { color: 0xd04040, opacity: 0.5 },
  skill_aim: { color: 0xffd75e, opacity: 0.55 },
  item: { color: 0x6a5fd0, opacity: 0.5 },
  deploy: { color: 0x3d8fd6, opacity: 0.3 },
  danger: { color: 0xc03030, opacity: 0.16 },
  collect: { color: 0xffd75e, opacity: 0.55 },
};

export class BattleScene {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a2028);
    this.scene.fog = new THREE.Fog(0x1a2028, 18, 42);
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    this.camTarget = new THREE.Vector3(0, 0, 0);
    this.camDist = 14;
    this.camYaw = Math.PI / 4;   // 45°
    this.camPitch = 0.92;        // ~53°
    this._updateCamera();

    const ambient = new THREE.AmbientLight(0xffffff, 0.75);
    this.scene.add(ambient);
    const sun = new THREE.DirectionalLight(0xfff2dd, 1.5);
    sun.position.set(6, 12, 4);
    this.scene.add(sun);

    this.boardGroup = new THREE.Group();
    this.unitGroup = new THREE.Group();
    this.fxGroup = new THREE.Group();
    this.highlightGroup = new THREE.Group();
    this.scene.add(this.boardGroup, this.unitGroup, this.fxGroup, this.highlightGroup);

    this.tiles = new Map();      // key -> {mesh, top}
    this.unitViews = new Map();  // unit.uid -> view
    this.raycaster = new THREE.Raycaster();
    this._tweens = [];
    this._time = 0;
    this._activeUid = null;
    this._focusUid = null;

    this._clock = new THREE.Clock();
    const loop = () => {
      requestAnimationFrame(loop);
      const dt = Math.min(this._clock.getDelta(), 0.05);
      this._time += dt;
      this._tickTweens(dt);
      this._tickIdle();
      this.renderer.render(this.scene, this.camera);
    };
    loop();
    this.resize();
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  _updateCamera() {
    const p = this.camPitch;
    const y = Math.sin(p) * this.camDist;
    const r = Math.cos(p) * this.camDist;
    this.camera.position.set(
      this.camTarget.x + Math.cos(this.camYaw) * r,
      this.camTarget.y + y,
      this.camTarget.z + Math.sin(this.camYaw) * r,
    );
    this.camera.lookAt(this.camTarget);
  }

  zoom(delta) {
    this.camDist = Math.max(7, Math.min(26, this.camDist + delta));
    this._updateCamera();
  }

  pan(dx, dy) {
    // 屏幕平移 → 世界平移（沿相机地面基向量）
    const s = this.camDist * 0.0016;
    const right = new THREE.Vector3(-Math.sin(this.camYaw), 0, Math.cos(this.camYaw));
    const fwd = new THREE.Vector3(-Math.cos(this.camYaw), 0, -Math.sin(this.camYaw));
    this.camTarget.addScaledVector(right, dx * s);
    this.camTarget.addScaledVector(fwd, -dy * s);
    this._updateCamera();
  }

  cellTop(coords) {
    const tile = this.tiles.get(cellKey(coords));
    return tile ? tile.top : BASE_H;
  }

  cellToWorld(coords) {
    const size = this._size || { x: 8, y: 8 };
    return new THREE.Vector3(
      (coords.x - (size.x - 1) / 2) * TILE,
      this.cellTop(coords),
      (coords.y - (size.y - 1) / 2) * TILE,
    );
  }

  // —— 棋盘建模 ——
  buildLevel(level, grid) {
    this._size = { x: level.grid_size[0], y: level.grid_size[1] };
    this.boardGroup.clear();
    this.highlightGroup.clear();
    this.tiles.clear();
    this.unitGroup.clear();
    this.unitViews.clear();
    this.fxGroup.clear();
    for (const cell of grid.cells.values()) {
      this._buildTile(cell);
    }
    this.camTarget.set(0, 0, 0);
    this.camDist = Math.max(this._size.x, this._size.y) * 1.55 + 4;
    this._updateCamera();
  }

  _buildTile(cell) {
    const key = cellKey(cell.coords);
    const old = this.tiles.get(key);
    if (old) {
      this.boardGroup.remove(old.mesh);
      if (old.props) this.boardGroup.remove(old.props);
    }
    const style = TERRAIN_STYLE[cell.terrain.terrain_id] || TERRAIN_STYLE.plain;
    const isWater = cell.terrain.terrain_id === "water";
    const top = isWater ? 0.08 : BASE_H + cell.height * HEIGHT_STEP;
    const geo = new THREE.BoxGeometry(TILE * 0.98, top, TILE * 0.98);
    const mat = new THREE.MeshLambertMaterial({ color: style.color });
    if (isWater) {
      mat.transparent = true;
      mat.opacity = 0.85;
    }
    const mesh = new THREE.Mesh(geo, mat);
    const world = this.cellToWorld(cell.coords);
    mesh.position.set(world.x, top / 2, world.z);
    mesh.userData.coords = cell.coords;
    this.boardGroup.add(mesh);
    const entry = { mesh, top };
    const props = this._buildProps(cell, world, top);
    if (props) {
      this.boardGroup.add(props);
      entry.props = props;
    }
    this.tiles.set(key, entry);
  }

  _buildProps(cell, world, top) {
    const id = cell.terrain.terrain_id;
    const g = new THREE.Group();
    g.position.set(world.x, top, world.z);
    if (id === "forest") {
      const trunkMat = new THREE.MeshLambertMaterial({ color: 0x5a4630 });
      const leafMat = new THREE.MeshLambertMaterial({ color: 0x2e5a28 });
      for (const [ox, oz] of [[-0.18, -0.1], [0.2, 0.18]]) {
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.3), trunkMat);
        trunk.position.set(ox, 0.15, oz);
        const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.55, 6), leafMat);
        leaf.position.set(ox, 0.55, oz);
        g.add(trunk, leaf);
      }
      return g;
    }
    if (id === "camp") {
      const tent = new THREE.Mesh(
        new THREE.ConeGeometry(0.32, 0.42, 4),
        new THREE.MeshLambertMaterial({ color: 0xc8b088 }),
      );
      tent.position.y = 0.21;
      tent.rotation.y = Math.PI / 4;
      g.add(tent);
      return g;
    }
    if (id === "fire") {
      const fire = new THREE.Mesh(
        new THREE.ConeGeometry(0.16, 0.4, 5),
        new THREE.MeshBasicMaterial({ color: 0xff7830 }),
      );
      fire.position.y = 0.2;
      g.add(fire);
      return g;
    }
    if (id === "barricade") {
      const mat = new THREE.MeshLambertMaterial({ color: 0x6a5030 });
      for (const rot of [Math.PI / 4, -Math.PI / 4]) {
        const plank = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.7, 0.08), mat);
        plank.position.y = 0.3;
        plank.rotation.z = rot;
        g.add(plank);
      }
      return g;
    }
    if (id === "wine_stall") {
      const mat = new THREE.MeshLambertMaterial({ color: 0x8a6a42 });
      const table = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.34), mat);
      table.position.y = 0.15;
      const roof = new THREE.Mesh(
        new THREE.ConeGeometry(0.42, 0.26, 4),
        new THREE.MeshLambertMaterial({ color: 0xa04838 }),
      );
      roof.position.y = 0.75;
      roof.rotation.y = Math.PI / 4;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.6), mat);
      pole.position.y = 0.45;
      g.add(table, roof, pole);
      return g;
    }
    return null;
  }

  updateTerrain(coords) {
    // 地形变化后重建该格（含 props）
    const grid = this._grid;
    if (!grid) return;
    const cell = grid.getCell(coords);
    if (cell) this._buildTile(cell);
  }

  attachGrid(grid) {
    this._grid = grid;
  }

  // —— 单位显示 ——
  addUnit(unit) {
    if (this.unitViews.has(unit.uid)) return;
    const view = { unit };
    if (unit.is_object) {
      // 物件：木箱 + 顶牌
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(0.55, 0.5, 0.55),
        new THREE.MeshLambertMaterial({ color: 0xb08648 }),
      );
      const pos = this.cellToWorld(unit.coords);
      box.position.set(pos.x, pos.y + 0.25, pos.z);
      const label = this._makeTextSprite("货", "#ffd75e", 42);
      label.position.set(pos.x, pos.y + 0.9, pos.z);
      label.scale.set(0.5, 0.5, 1);
      this.unitGroup.add(box, label);
      view.box = box;
      view.label = label;
    } else {
      const card = new UnitCard(unit.data);
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: card.texture, transparent: true }));
      sprite.scale.set(0.86, 1.24, 1);
      const pos = this.cellToWorld(unit.coords);
      sprite.position.set(pos.x, pos.y + 0.72, pos.z);
      sprite.userData.unit = unit;
      // 队伍色底座圈
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.3, 0.4, 24),
        new THREE.MeshBasicMaterial({ color: TEAM_COLORS[unit.team], side: THREE.DoubleSide, transparent: true, opacity: 0.9 }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(pos.x, pos.y + 0.02, pos.z);
      // 朝向标
      const arrow = new THREE.Mesh(
        new THREE.ConeGeometry(0.08, 0.2, 4),
        new THREE.MeshBasicMaterial({ color: 0xffffff }),
      );
      arrow.rotation.x = Math.PI / 2;
      this.unitGroup.add(sprite, ring, arrow);
      view.sprite = sprite;
      view.ring = ring;
      view.arrow = arrow;
      view.card = card;
      this._updateArrow(view);
    }
    this.unitViews.set(unit.uid, view);
  }

  _updateArrow(view) {
    const f = view.unit.facing;
    const pos = this.cellToWorld(view.unit.coords);
    view.arrow.position.set(pos.x + f.x * 0.42, pos.y + 0.05, pos.z + f.y * 0.42);
    view.arrow.rotation.set(Math.PI / 2, 0, 0);
    view.arrow.rotateZ(-Math.atan2(f.x, f.y) + Math.PI);
  }

  removeUnit(unit) {
    const view = this.unitViews.get(unit.uid);
    if (!view) return;
    for (const k of ["sprite", "ring", "arrow", "box", "label"]) {
      if (view[k]) this.unitGroup.remove(view[k]);
    }
    this.unitViews.delete(unit.uid);
  }

  syncUnits(units) {
    const seen = new Set();
    for (const u of units) {
      seen.add(u.uid);
      if (!this.unitViews.has(u.uid)) this.addUnit(u);
      this.refreshUnit(u);
    }
    for (const [uid, view] of this.unitViews) {
      if (!seen.has(uid)) this.removeUnit(view.unit);
    }
  }

  refreshUnit(unit) {
    const view = this.unitViews.get(unit.uid);
    if (!view || !view.card) return;
    view.card.draw(unit.hp / unit.data.hp, unit.rage / 100, !!unit.channeling);
  }

  setActiveUnit(unit) {
    this._activeUid = unit ? unit.uid : null;
  }

  setFocusTarget(unit) {
    this._focusUid = unit ? unit.uid : null;
  }

  _tickIdle() {
    for (const [uid, view] of this.unitViews) {
      if (!view.ring) continue;
      const base = new THREE.Color(TEAM_COLORS[view.unit.team]);
      if (uid === this._activeUid) {
        const pulse = 0.6 + 0.4 * Math.sin(this._time * 6);
        view.ring.material.color.setRGB(1, 1, 1).multiplyScalar(pulse + 0.4);
        view.ring.scale.setScalar(1.1);
      } else if (uid === this._focusUid) {
        view.ring.material.color.setRGB(1, 0.75, 0.2);
        view.ring.scale.setScalar(1.15);
      } else if (view.unit.is_elite) {
        view.ring.material.color.setRGB(0.95, 0.8, 0.3);
        view.ring.scale.setScalar(1);
      } else {
        view.ring.material.color.copy(base);
        view.ring.scale.setScalar(1);
      }
    }
  }

  // —— 高亮层 ——
  setHighlights(cells, kind) {
    const style = HIGHLIGHT_COLORS[kind];
    for (const coords of cells) {
      const pos = this.cellToWorld(coords);
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(TILE * 0.92, TILE * 0.92),
        new THREE.MeshBasicMaterial({ color: style.color, transparent: true, opacity: style.opacity, depthWrite: false }),
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(pos.x, pos.y + 0.03, pos.z);
      mesh.userData.hl = kind;
      this.highlightGroup.add(mesh);
    }
  }

  clearHighlights(kind = null) {
    for (let i = this.highlightGroup.children.length - 1; i >= 0; i--) {
      const c = this.highlightGroup.children[i];
      if (!kind || c.userData.hl === kind) {
        this.highlightGroup.remove(c);
        c.geometry.dispose();
        c.material.dispose();
      }
    }
  }

  // —— 拾取 ——
  pick(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    // 优先单位
    const sprites = [];
    for (const view of this.unitViews.values()) {
      if (view.sprite) sprites.push(view.sprite);
    }
    const hitUnits = this.raycaster.intersectObjects(sprites, false);
    if (hitUnits.length > 0) return { unit: hitUnits[0].object.userData.unit };
    const hitTiles = this.raycaster.intersectObjects([...this.tiles.values()].map((t) => t.mesh), false);
    if (hitTiles.length > 0) return { cell: hitTiles[0].object.userData.coords };
    return null;
  }

  // —— 补间 ——
  _tickTweens(dt) {
    for (let i = this._tweens.length - 1; i >= 0; i--) {
      const t = this._tweens[i];
      t.elapsed += dt;
      const k = Math.min(1, t.elapsed / t.duration);
      t.onUpdate(k);
      if (k >= 1) {
        this._tweens.splice(i, 1);
        t.resolve();
      }
    }
  }

  tween(duration, onUpdate) {
    return new Promise((resolve) => {
      this._tweens.push({ duration, onUpdate, resolve, elapsed: 0 });
    });
  }

  _moveViewTo(view, coords, duration = 0.18) {
    const from = view.sprite ? view.sprite.position.clone() : view.box.position.clone();
    const to = this.cellToWorld(coords);
    to.y += view.sprite ? 0.72 : 0.25;
    return this.tween(duration, (k) => {
      const p = from.clone().lerp(to, k);
      if (view.sprite) view.sprite.position.copy(p);
      if (view.box) view.box.position.copy(p);
      if (view.ring) view.ring.position.set(p.x, this.cellToWorld(coords).y + 0.02, p.z);
      if (view.arrow) this._updateArrow(view);
      if (view.label) view.label.position.set(p.x, p.y + 0.65, p.z);
    });
  }

  async _floatText(coords, text, color = "#fff", size = 44, rise = 0.9) {
    const sprite = this._makeTextSprite(text, color, size);
    const pos = this.cellToWorld(coords);
    sprite.position.set(pos.x, pos.y + 1.2, pos.z);
    sprite.scale.set(0.9, 0.45, 1);
    this.fxGroup.add(sprite);
    await this.tween(0.75, (k) => {
      sprite.position.y = pos.y + 1.2 + rise * k;
      sprite.material.opacity = 1 - k * k;
    });
    this.fxGroup.remove(sprite);
  }

  _makeTextSprite(text, color, size) {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 128;
    const ctx = canvas.getContext("2d");
    ctx.font = `bold ${size}px 'Songti SC', sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.strokeStyle = "rgba(0,0,0,0.85)";
    ctx.lineWidth = 8;
    ctx.strokeText(text, 128, 64);
    ctx.fillStyle = color;
    ctx.fillText(text, 128, 64);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  }

  async _flashUnit(unit, scaleTo = 1.25) {
    const view = this.unitViews.get(unit.uid);
    if (!view || !view.sprite) return;
    const s0 = view.sprite.scale.x;
    await this.tween(0.12, (k) => {
      const s = s0 + (scaleTo * s0 - s0) * Math.sin(k * Math.PI);
      view.sprite.scale.set(s, s * 1.44, 1);
    });
  }

  // —— 事件动画回放 ——
  async playEvents(events, hooks = {}) {
    for (const e of events) {
      await this._playEvent(e, hooks);
      if (hooks.afterEach) hooks.afterEach(e);
    }
  }

  async _playEvent(e, hooks) {
    switch (e.type) {
      case "move": {
        const view = this.unitViews.get(e.unit.uid);
        if (!view) return;
        for (const step of e.path) {
          await this._moveViewTo(view, step, 0.12);
        }
        this._updateArrow(view);
        return;
      }
      case "pull": case "push": {
        const view = this.unitViews.get(e.target.uid);
        if (view) await this._moveViewTo(view, e.to, 0.2);
        return;
      }
      case "teleport": {
        const view = this.unitViews.get(e.unit.uid);
        if (view) await this._moveViewTo(view, e.to, 0.25);
        return;
      }
      case "swap": {
        const v1 = this.unitViews.get(e.source.uid);
        const v2 = this.unitViews.get(e.target.uid);
        await Promise.all([
          v1 ? this._moveViewTo(v1, e.source.coords, 0.2) : null,
          v2 ? this._moveViewTo(v2, e.target.coords, 0.2) : null,
        ]);
        return;
      }
      case "damage": {
        if (e.source) this._lunge(e.source, e.target);
        await this._flashUnit(e.target);
        const color = e.executed ? "#ff3030" : e.crit ? "#ffd75e" : e.blocked ? "#7ab3e0" : "#ffffff";
        const text = `${e.crit ? "暴击 " : ""}${e.blocked ? "格挡 " : ""}-${e.amount}`;
        await this._floatText(e.target.coords, text, color, e.crit ? 56 : 44);
        this.refreshUnit(e.target);
        if (e.died) await this._dieAnim(e.target);
        return;
      }
      case "dodge":
        await this._floatText(e.target.coords, "闪避", "#8fd0ff");
        return;
      case "miss":
        await this._floatText(e.target.coords, "未命中", "#aaa");
        return;
      case "heal":
        await this._floatText(e.target.coords, `+${e.amount}`, "#5ae07a");
        this.refreshUnit(e.target);
        return;
      case "dot":
        await this._floatText(e.unit.coords, `-${e.amount}`, "#c060e0");
        this.refreshUnit(e.unit);
        if (!e.unit.alive) await this._dieAnim(e.unit);
        return;
      case "terrain_dot":
        await this._floatText(e.unit.coords, `-${e.amount} 灼烧`, "#ff7830");
        this.refreshUnit(e.unit);
        if (!e.unit.alive) await this._dieAnim(e.unit);
        return;
      case "hot":
        await this._floatText(e.unit.coords, `+${e.amount}`, "#5ae07a");
        this.refreshUnit(e.unit);
        return;
      case "terrain_heal":
        await this._floatText(e.unit.coords, `+${e.amount} 营帐`, "#5ae07a");
        this.refreshUnit(e.unit);
        return;
      case "buff":
        if (e.field) await this._floatText(e.target.coords, `${fieldLabel(e.field)}${e.value > 0 ? "+" : ""}${e.value}`, e.value >= 0 ? "#ffd75e" : "#c060e0", 36);
        else await this._floatText(e.target.coords, buffLabel(e.buff), "#c060e0", 36);
        this.refreshUnit(e.target);
        return;
      case "status":
        await this._floatText(e.target.coords, statusLabel(e.status), "#ff9a5e", 40);
        this.refreshUnit(e.target);
        return;
      case "status_resist":
        await this._floatText(e.target.coords, "抵抗", "#8fd0ff", 36);
        return;
      case "dispel":
        if (e.removed.length) await this._floatText(e.target.coords, "驱散", "#8fd0ff", 36);
        this.refreshUnit(e.target);
        return;
      case "steal":
        await this._floatText(e.from.coords, "夺取增益", "#ffd75e", 36);
        return;
      case "buff_expired":
        this.refreshUnit(e.unit);
        return;
      case "rage":
        if (Math.abs(e.value) >= 15) await this._floatText(e.unit.coords, `怒${e.value > 0 ? "+" : ""}${e.value}`, "#ffd75e", 32);
        this.refreshUnit(e.unit);
        return;
      case "wait":
        await this._floatText(e.unit.coords, "待机", "#c8c8c8", 36);
        return;
      case "obstacle_damage": {
        await this._floatText(e.coords, `-${e.amount}`, "#e08830");
        return;
      }
      case "terrain_change":
        this.updateTerrain(e.coords);
        return;
      case "summon":
        if (e.ok && e.object) {
          this.addUnit(e.object);
          await this._floatText(e.cell, "召唤", "#ffd75e", 36);
        }
        return;
      case "spawn":
        this.addUnit(e.unit);
        await this._floatText(e.unit.coords, "增援", "#ff9a5e", 40);
        return;
      case "aura":
        await this._floatText(e.holder.coords, "光环", "#ffd75e", 36);
        return;
      case "extra_action":
        await this._floatText(e.target.coords, "再动！", "#ffd75e", 48);
        return;
      case "av_mod":
        return;
      case "passive_trigger":
        await this._floatText(e.unit.coords, `【${e.name}】`, "#e0b0ff", 38);
        return;
      case "bond":
        await this._floatText(e.unit.coords, `羁绊·${e.name}`, "#ffb0c0", 36);
        return;
      case "item_use":
        await this._floatText(e.unit.coords, `使用·${e.name}`, "#b0a0ff", 38);
        return;
      case "channel_start":
        await this._floatText(e.unit.coords, "夺取中…", "#ffd75e", 36);
        this.refreshUnit(e.unit);
        return;
      case "channel_interrupted":
        await this._floatText(e.unit.coords, "夺取被打断！", "#ff9a5e", 36);
        this.refreshUnit(e.unit);
        return;
      case "collect":
        await this._floatText(e.unit.coords, `夺取得手 ${e.count}`, "#ffd75e", 44);
        this.removeUnit(e.object);
        return;
      case "collect_failed":
        await this._floatText(e.unit.coords, "夺取失败", "#aaa", 36);
        return;
      case "turn_skipped":
        await this._floatText(e.unit.coords, "无法行动", "#aaa", 36);
        return;
      case "achievement_path":
        return;
      default:
        return;
    }
  }

  _lunge(source, target) {
    const view = this.unitViews.get(source.uid);
    if (!view || !view.sprite) return;
    const from = view.sprite.position.clone();
    const to = this.cellToWorld(target.coords);
    to.y = from.y;
    const mid = from.clone().lerp(to, 0.3);
    this.tween(0.22, (k) => {
      const p = k < 0.5
        ? from.clone().lerp(mid, k * 2)
        : mid.clone().lerp(from, (k - 0.5) * 2);
      view.sprite.position.copy(p);
    });
  }

  async _dieAnim(unit) {
    const view = this.unitViews.get(unit.uid);
    if (!view) return;
    if (view.sprite) {
      await this.tween(0.5, (k) => {
        view.sprite.material.opacity = 1 - k;
        view.sprite.position.y -= 0.01;
      });
    }
    this.removeUnit(unit);
  }
}

function fieldLabel(field) {
  return { atk: "攻", def: "防", mgc: "谋", spd: "速", dodge: "闪避", block: "格挡", crit: "暴击", move: "移动" }[field] || field;
}

function statusLabel(status) {
  return { stun: "眩晕", sleep: "沉睡", paralyze: "麻痹", bind: "束缚", guard: "援护", counter: "反击" }[status] || status;
}

function buffLabel(buff) {
  return { poison: "中毒", burn: "灼烧", bleed: "流血" }[buff] || buff;
}
