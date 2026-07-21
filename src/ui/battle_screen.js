// 战斗界面：布阵 → CTB 战斗 → 结算的表现/交互层（对应 Godot 版 battle.gd + scenes/battle）
// 逻辑瞬时结算，本层把 manager 事件排队回放成动画；玩家输入转成 Command。
import { Team } from "../core/unit.js";
import { BattleManager, State, AutoMode } from "../core/battle_manager.js";
import { MoveCommand, AttackCommand, SkillCommand, WaitCommand, InteractCommand, ItemCommand } from "../core/commands.js";
import * as Targeting from "../core/targeting.js";
import * as Progression from "../core/meta/progression.js";
import { cellKey } from "../core/coords.js";
import { BattleScene } from "../render/scene.js";
import { QUALITY_COLORS } from "../render/portrait.js";

const AUTO_LABELS = ["手动", "半自动", "全自动"];

export class BattleScreen {
  // app: { data, profile, audio, onExit, settleBattle(screen, winner) }
  constructor(app, { level, expeditionRun = null, arena = null }) {
    this.app = app;
    this.data = app.data;
    this.profile = app.profile;
    this.level = level;
    this.expeditionRun = expeditionRun;
    this.arena = arena;
    this.mode = "deploy"; // deploy | input | skill_aim | item_target | busy | end
    this.selectedCandidate = null;
    this.pendingSkill = null;
    this.pendingItem = null;
    this._playback = Promise.resolve();
    this._busy = false;
    this._lastHover = null;

    this.manager = new BattleManager(this.data, app.rolls);
    this.manager.signatureMorphProvider = (unit, skillId) => {
      if (!unit.hero || !unit.hero.has_signature_weapon) return {};
      const { MORPHS } = app.signatureMorphs;
      return MORPHS[skillId] ? { signature_morph: MORPHS[skillId] } : {};
    };

    this._buildDom();
    this.scene = new BattleScene(document.getElementById("gl"));
    this._wireManager();
    this._wireInput();
    this._setupLevel();
  }

  // —— 初始化 ——
  _setupLevel() {
    const getHeroData = (unitId) => {
      const hero = this.profile.heroes[unitId];
      if (!hero) return null;
      return { hero, data: Progression.computeUnitData(this.data, hero, this.data.getUnit(unitId)) };
    };
    this.manager.setupLevel(this.level, getHeroData);
    this.scene.buildLevel(this.level, this.manager.grid);
    this.scene.attachGrid(this.manager.grid);

    // 演武场：守方按养成数值替换 + PVP 模板
    if (this.arena) {
      const defendUnits = this.manager.units.filter((u) => u.team === Team.ENEMY);
      this.arena.defenders.forEach((d, i) => {
        const u = defendUnits[i];
        if (!u) return;
        u.data = d.data;
        u.hero = d.hero;
        u.hp = d.data.hp;
        u.resetAv();
      });
      this.manager.pvpMods = this.arena.buildPvpMods(defendUnits);
    }

    // 远征：跳过手动布阵，自动落位 + 生命继承 + run buffs
    if (this.expeditionRun) {
      for (const d of [...this.manager.deployed]) this.manager.undeployUnit(d.unitId);
      const run = this.expeditionRun;
      for (const member of run.team) {
        if (!member.alive) continue;
        const cell = this.manager._firstFreeDeployCell();
        if (!cell) break;
        const hd = getHeroData(member.unit_id);
        const unit = this.manager._placePlayerUnit(member.unit_id, cell, hd, false);
        if (unit) {
          unit.hp = Math.max(1, Math.round(unit.data.hp * member.hp_ratio));
          for (const b of run.buffs) {
            unit.addBuff({
              buff_id: `exp_${b.field}`, name: "远征加成", stat_mods: { [b.field]: b.value },
              duration: 99, stacks: 1, dispellable: false, is_debuff: false,
              tick_effect: null, status: "", aura_mods: null, aura_radius: 0, source: null,
            });
          }
        }
      }
      this.manager.deployed = this.manager.units
        .filter((u) => u.team === Team.PLAYER)
        .map((unit) => ({ unitId: unit.unitId, unit, isRequired: false }));
    }

    this.scene.syncUnits(this.manager.units);
    if (this.expeditionRun) {
      this._beginBattle();
    } else {
      this._enterDeploy();
    }
  }

  // —— DOM / HUD ——
  _buildDom() {
    this.root = document.createElement("div");
    this.root.id = "battle-ui";
    this.root.innerHTML = `
      <div class="top-bar">
        <span class="level-name"></span>
        <span class="round-label"></span>
        <span class="spacer"></span>
        <span class="auto-group"></span>
        <button class="btn small" data-act="exit">撤退</button>
      </div>
      <div class="turn-preview"></div>
      <div class="deploy-bar hidden">
        <div class="deploy-title">布阵 —— 点选武将，再点蓝色区域落位（点已上阵武将撤下）</div>
        <div class="candidate-list"></div>
        <button class="btn primary" data-act="start-battle">开始战斗 ▶</button>
      </div>
      <div class="bottom-panel hidden">
        <div class="unit-info"></div>
        <div class="action-buttons">
          <button class="btn" data-act="skill" title="Q">主动技<span class="key">Q</span></button>
          <button class="btn ult" data-act="ult" title="W">绝技<span class="key">W</span></button>
          <button class="btn" data-act="item" title="R">道具<span class="key">R</span></button>
          <button class="btn" data-act="interact" title="E">夺取<span class="key">E</span></button>
          <button class="btn" data-act="wait" title="空格">待机<span class="key">␣</span></button>
        </div>
        <div class="item-panel hidden"></div>
      </div>
      <div class="message-log"></div>
      <div class="dialogue-toast hidden"></div>
      <div class="result-modal hidden"></div>
      <div class="hint-bar"></div>`;
    document.getElementById("ui").appendChild(this.root);
    this.$ = (sel) => this.root.querySelector(sel);
    this.root.querySelector('[data-act="exit"]').addEventListener("click", () => {
      if (confirm("确定撤退？本场战斗进度将丢失。")) this.app.onExitBattle(null);
    });
    this.root.querySelector('[data-act="start-battle"]').addEventListener("click", () => this._tryStartBattle());
    for (const btn of this.root.querySelectorAll(".action-buttons .btn")) {
      btn.addEventListener("click", () => this._onActionButton(btn.dataset.act));
    }
    const autoGroup = this.root.querySelector(".auto-group");
    AUTO_LABELS.forEach((label, i) => {
      const b = document.createElement("button");
      b.className = "btn small auto-btn";
      b.textContent = label;
      b.title = `${i + 1}`;
      b.addEventListener("click", () => this._setAutoMode(i));
      autoGroup.appendChild(b);
    });
    this.$(".level-name").textContent = this.level.name;
    this._updateAutoButtons();
  }

  _wireInput() {
    this._onClick = (e) => this._handleClick(e.clientX, e.clientY);
    this._onMove = (e) => {
      const hit = this.scene.pick(e.clientX, e.clientY);
      this._lastHover = hit && hit.unit ? hit.unit : null;
    };
    this._onKey = (e) => this._handleKey(e);
    this._onWheel = (e) => { this.scene.zoom(e.deltaY * 0.01); };
    this._onDown = (e) => { this._drag = { x: e.clientX, y: e.clientY, moved: false }; };
    this._onDrag = (e) => {
      if (!this._drag) return;
      const dx = e.clientX - this._drag.x;
      const dy = e.clientY - this._drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 6) this._drag.moved = true;
      if (this._drag.moved) {
        this.scene.pan(dx, dy);
        this._drag.x = e.clientX;
        this._drag.y = e.clientY;
      }
    };
    const canvas = document.getElementById("gl");
    canvas.addEventListener("click", this._onClick);
    canvas.addEventListener("mousemove", this._onMove);
    canvas.addEventListener("mousemove", this._onDrag);
    canvas.addEventListener("mousedown", this._onDown);
    window.addEventListener("mouseup", () => { this._drag = null; });
    canvas.addEventListener("wheel", this._onWheel);
    window.addEventListener("keydown", this._onKey);
    this._canvas = canvas;
  }

  destroy() {
    const canvas = this._canvas;
    canvas.removeEventListener("click", this._onClick);
    canvas.removeEventListener("mousemove", this._onMove);
    canvas.removeEventListener("mousemove", this._onDrag);
    canvas.removeEventListener("mousedown", this._onDown);
    canvas.removeEventListener("wheel", this._onWheel);
    window.removeEventListener("keydown", this._onKey);
    this.root.remove();
    this.scene.renderer.dispose();
  }

  // —— manager 事件接线 ——
  _wireManager() {
    const m = this.manager;
    m.on("turn_started", (unit) => this._onTurnStarted(unit));
    m.on("turn_ended", () => {});
    m.on("command_executed", (cmd, events) => this._enqueuePlayback(events));
    m.on("tick_events", (unit, events) => this._enqueuePlayback(events));
    m.on("trigger_events", (events) => this._enqueuePlayback(events));
    m.on("dialogue", (text) => this._enqueueDialogue(text));
    m.on("unit_died", (unit) => this.scene.removeUnit(unit));
    m.on("round_started", (n) => { this.$(".round-label").textContent = `第 ${n} 轮`; });
    m.on("battle_ended", (winner) => this._onBattleEnded(winner));
    m.on("deploy_changed", () => this._refreshDeployBar());
  }

  // —— 布阵 ——
  _enterDeploy() {
    this.mode = "deploy";
    this.$(".deploy-bar").classList.remove("hidden");
    // 部署区高亮 + 危险范围（迷雾关不画）
    const cells = [];
    const [zx, zy, zw, zh] = this.level.deploy_zone;
    for (let y = zy; y < zy + zh; y++) {
      for (let x = zx; x < zx + zw; x++) cells.push({ x, y });
    }
    this.scene.setHighlights(cells, "deploy");
    if (!this.level.fog) this._showDangerZone();
    this._refreshDeployBar();
    this._updateHint("布阵：点选左侧武将 → 点蓝色格落位");
  }

  _showDangerZone() {
    const danger = new Set();
    for (const u of this.manager.units) {
      if (u.team !== Team.ENEMY || u.is_object) continue;
      const reach = u.data.move + u.data.range_max;
      for (let y = 0; y < this.manager.grid.size.y; y++) {
        for (let x = 0; x < this.manager.grid.size.x; x++) {
          const d = Math.abs(x - u.coords.x) + Math.abs(y - u.coords.y);
          if (d <= reach) danger.add(`${x},${y}`);
        }
      }
    }
    const cells = [...danger].map((k) => {
      const [x, y] = k.split(",").map(Number);
      return { x, y });
    });
    this.scene.setHighlights(cells, "danger");
  }

  _refreshDeployBar() {
    if (this.mode !== "deploy") return;
    const list = this.$(".candidate-list");
    list.innerHTML = "";
    const allowed = this.level.allowed_classes || [];
    const candidates = this.level.roster
      .filter((id) => this.profile.hasHero(id))
      .filter((id) => allowed.length === 0 || allowed.includes(this.data.getUnit(id).unit_class))
      .filter((id) => !this.manager.deployed.some((d) => d.unitId === id));
    for (const id of candidates) {
      const u = this.data.getUnit(id);
      const hero = this.profile.heroes[id];
      const card = document.createElement("div");
      card.className = "candidate-card" + (this.selectedCandidate === id ? " selected" : "");
      card.style.borderColor = QUALITY_COLORS[u.quality] || "#888";
      card.innerHTML = `<div class="c-name">${u.name}</div><div class="c-sub">Lv.${hero.level} ${"★".repeat(hero.star)}</div>`;
      card.addEventListener("click", () => {
        this.app.audio.play("click");
        this.selectedCandidate = this.selectedCandidate === id ? null : id;
        this._refreshDeployBar();
      });
      list.appendChild(card);
    }
    const deployedCount = this.manager.deployed.length;
    this._updateHint(`布阵：已上阵 ${deployedCount}/${this.level.max_deploy}（必出 ${this.level.required_units.length} 人自动落位）`);
  }

  _tryStartBattle() {
    const check = this.manager.confirmDeploy();
    if (!check.ok) {
      this._message(check.reason);
      return;
    }
    this._beginBattle();
  }

  _beginBattle() {
    this.$(".deploy-bar").classList.add("hidden");
    this.$(".bottom-panel").classList.remove("hidden");
    this.scene.clearHighlights();
    this.mode = "busy";
    this.manager.startBattle();
  }

  // —— 回合驱动 ——
  _onTurnStarted(unit) {
    this.scene.syncUnits(this.manager.units);
    this.scene.setActiveUnit(unit);
    this._refreshUnitPanel();
    this._refreshTurnPreview();
    this._enqueue(async () => {
      if (this.manager.state === State.BATTLE_END) return;
      if (unit.team === Team.PLAYER && this.manager.autoMode === AutoMode.MANUAL) {
        this._enterInput();
      } else {
        this.mode = "busy";
        this._updateHint(`${unit.data.name} 行动中…`);
        await sleep(350);
        this.manager.runAi();
      }
    });
  }

  _enterInput() {
    if (this.manager.state === State.BATTLE_END) return;
    this.mode = "input";
    this.pendingSkill = null;
    this.pendingItem = null;
    this._refreshHighlights();
    this._refreshUnitPanel();
    const u = this.manager.activeUnit;
    this._updateHint(`${u.data.name} 行动：移动 ${this.manager.movePointsLeft} 步${this.manager.actionUsed ? "，行动已用" : ""}`);
  }

  _refreshHighlights() {
    this.scene.clearHighlights();
    const m = this.manager;
    const unit = m.activeUnit;
    if (!unit) return;
    if (this.mode === "skill_aim" && this.pendingSkill) {
      const targets = Targeting.cellsInRange(this.pendingSkill, unit, m.grid, m.units);
      this.scene.setHighlights(targets.map((u) => u.coords), "skill_aim");
      return;
    }
    if (this.mode === "item_target" && this.pendingItem) {
      const skill = itemToSkillCached(this.pendingItem);
      const targets = Targeting.resolveFrom(skill, unit, null, m.grid, m.units, m.rolls);
      this.scene.setHighlights(targets.map((u) => u.coords), "item");
      return;
    }
    // 常规：可达格 / 敌人 / 障碍 / 可夺取物件
    if (unit.canMove() && m.movePointsLeft > 0) {
      const reach = m.reachableFor(unit);
      this.scene.setHighlights([...reach.keys()].map(parseKeyFromStr), "move");
    }
    if (!m.actionUsed) {
      this.scene.setHighlights(m.enemiesInRange(unit).map((u) => u.coords), "attack");
      this.scene.setHighlights(m.obstaclesInRange(unit), "obstacle");
      const objects = m.units.filter((u) => u.is_object && u.alive && m.canChannel(unit, u));
      this.scene.setHighlights(objects.map((u) => u.coords), "collect");
    }
  }

  // —— 输入处理 ——
  _handleClick(x, y) {
    if (this._busy || this._drag?.moved) return;
    const hit = this.scene.pick(x, y);
    if (this.mode === "deploy") return this._handleDeployClick(hit);
    if (this.mode === "input") return this._handleInputClick(hit);
    if (this.mode === "skill_aim") return this._handleSkillAimClick(hit);
    if (this.mode === "item_target") return this._handleItemTargetClick(hit);
  }

  _handleDeployClick(hit) {
    if (!hit) return;
    if (hit.cell && this.selectedCandidate) {
      const hero = this.profile.heroes[this.selectedCandidate];
      const hd = { hero, data: Progression.computeUnitData(this.data, hero, this.data.getUnit(this.selectedCandidate)) };
      const r = this.manager.deployUnit(this.selectedCandidate, hit.cell, hd);
      if (!r.ok) this._message(r.reason);
      else {
        this.app.audio.play("click");
        this.selectedCandidate = null;
        this.scene.syncUnits(this.manager.units);
      }
      return;
    }
    if (hit.unit && hit.unit.team === Team.PLAYER) {
      const r = this.manager.undeployUnit(hit.unit.unitId);
      if (!r.ok) this._message(r.reason);
      else this.scene.syncUnits(this.manager.units);
    }
  }

  _handleInputClick(hit) {
    const m = this.manager;
    const unit = m.activeUnit;
    if (!hit || !unit) return;
    // 点敌人：射程内 → 普攻
    if (hit.unit && !m.actionUsed && hit.unit.team === Team.ENEMY && !hit.unit.collectable) {
      if (m.enemiesInRange(unit).includes(hit.unit)) {
        this._submit(new AttackCommand(unit, hit.unit, m.genericAttackSkill(unit)));
        return;
      }
      this._message("目标不在射程内");
      return;
    }
    // 点障碍：拆拒马
    if (hit.cell && !m.actionUsed) {
      const cell = m.grid.getCell(hit.cell);
      if (cell && cell.hasObstacle()) {
        if (m.obstaclesInRange(unit).some((c) => cellKey(c) === cellKey(hit.cell))) {
          this._submit(new AttackCommand(unit, null, m.genericAttackSkill(unit), hit.cell));
          return;
        }
        this._message("障碍不在射程内");
        return;
      }
    }
    // 点物件：夺取
    if (hit.unit && hit.unit.is_object && !m.actionUsed) {
      if (m.canChannel(unit, hit.unit)) {
        m.actionUsed = true;
        this._submit(new InteractCommand(unit, hit.unit));
        return;
      }
      this._message("需要与物件相邻才能夺取");
      return;
    }
    // 点可达格：移动
    if (hit.cell && unit.canMove()) {
      const reach = m.reachableFor(unit);
      if (reach.has(cellKey(hit.cell))) {
        const path = m.grid.findPath(unit, hit.cell);
        if (path.length > 1) this._submit(new MoveCommand(unit, path.slice(1)));
        return;
      }
    }
  }

  _handleSkillAimClick(hit) {
    if (!hit) return this._cancelModes();
    const cell = hit.cell || (hit.unit && hit.unit.coords);
    if (!cell) return;
    const m = this.manager;
    const unit = m.activeUnit;
    const targets = Targeting.cellsInRange(this.pendingSkill, unit, m.grid, m.units);
    if (!targets.some((u) => cellKey(u.coords) === cellKey(cell))) {
      this._message("该方向无可命中目标");
      return;
    }
    const skill = this.pendingSkill;
    this.pendingSkill = null;
    m.actionUsed = true;
    this._submit(new SkillCommand(unit, skill, cell));
  }

  _handleItemTargetClick(hit) {
    if (!hit || !hit.unit) return this._cancelModes();
    const m = this.manager;
    const unit = m.activeUnit;
    const skill = itemToSkillCached(this.pendingItem);
    const targets = Targeting.resolveFrom(skill, unit, null, m.grid, m.units, m.rolls);
    if (!targets.includes(hit.unit)) {
      this._message("不是合法目标");
      return;
    }
    const item = this.pendingItem;
    this.pendingItem = null;
    this.$(".item-panel").classList.add("hidden");
    this._submit(new ItemCommand(unit, item, hit.unit));
  }

  _cancelModes() {
    this.pendingSkill = null;
    this.pendingItem = null;
    this.$(".item-panel").classList.add("hidden");
    if (this.manager.activeUnit) this._enterInput();
  }

  _onActionButton(act) {
    if (this._busy) return;
    const m = this.manager;
    const unit = m.activeUnit;
    if (!unit || this.mode === "busy" || this.mode === "deploy") return;
    this.app.audio.play("click");
    switch (act) {
      case "skill": this._trySkill("active"); break;
      case "ult": this._trySkill("ult"); break;
      case "item": this._toggleItemPanel(); break;
      case "interact": this._tryInteract(); break;
      case "wait": this._doWait(); break;
    }
  }

  _trySkill(type) {
    const m = this.manager;
    const unit = m.activeUnit;
    if (m.actionUsed) return this._message("本回合行动已用");
    const skill = this.data.getSkillForUnit(unit.unitId, type);
    if (!skill) return this._message(type === "ult" ? "没有绝技" : "没有主动技");
    if (!m.canUseSkill(unit, skill)) {
      if (unit.rage < skill.rage_cost) return this._message(`怒气不足（${unit.rage}/${skill.rage_cost}）`);
      return this._message(`冷却中（剩 ${unit.skillCooldown(skill.skill_id)} 回合）`);
    }
    if (Targeting.needsAim(skill)) {
      this.pendingSkill = skill;
      this.mode = "skill_aim";
      this._refreshHighlights();
      this._updateHint(`${skill.name}：点选方向上的敌人施放`);
      return;
    }
    // 直接施放（目标解析交给 SkillCommand）
    const targets = Targeting.resolveFrom(skill, unit, null, m.grid, m.units, m.rolls);
    if (targets.length === 0) return this._message("范围内没有合法目标");
    m.actionUsed = true;
    this.app.audio.playSkill(skill);
    this._submit(new SkillCommand(unit, skill));
  }

  _toggleItemPanel() {
    const panel = this.$(".item-panel");
    if (!panel.classList.contains("hidden")) {
      panel.classList.add("hidden");
      return;
    }
    const m = this.manager;
    if (m.actionUsed) return this._message("本回合行动已用");
    panel.innerHTML = "";
    let any = false;
    for (const [itemId, left] of Object.entries(m.itemStock)) {
      if (left <= 0) continue;
      any = true;
      const item = this.data.getItem(itemId);
      const btn = document.createElement("button");
      btn.className = "btn small";
      btn.textContent = `${item.name} ×${left}`;
      btn.title = item.desc;
      btn.addEventListener("click", () => this._chooseItem(item));
      panel.appendChild(btn);
    }
    if (!any) return this._message("没有可用道具");
    panel.classList.remove("hidden");
  }

  _chooseItem(item) {
    const m = this.manager;
    const unit = m.activeUnit;
    this.app.audio.play("click");
    if (item.target === "self") {
      this.$(".item-panel").classList.add("hidden");
      this._submit(new ItemCommand(unit, item, unit));
      return;
    }
    this.pendingItem = item;
    this.mode = "item_target";
    this.$(".item-panel").classList.add("hidden");
    this._refreshHighlights();
    this._updateHint(`${item.name}：点选目标`);
  }

  _tryInteract() {
    const m = this.manager;
    const unit = m.activeUnit;
    if (m.actionUsed) return this._message("本回合行动已用");
    const objects = m.units.filter((u) => u.is_object && u.alive && m.canChannel(unit, u));
    if (objects.length === 0) return this._message("没有相邻可夺取的物件");
    m.actionUsed = true;
    this._submit(new InteractCommand(unit, objects[0]));
  }

  _doWait() {
    const m = this.manager;
    const unit = m.activeUnit;
    if (!unit) return;
    this._submit(new WaitCommand(unit), true);
  }

  _submit(cmd, finishAfter = false) {
    const m = this.manager;
    this.mode = "busy";
    this.scene.clearHighlights();
    m.submitCommand(cmd);
    if (m.state === State.BATTLE_END) return;
    if (finishAfter) {
      m.finishTurn();
      return;
    }
    // 行动已用且移动力耗尽 → 自动结束激活；否则继续操作
    if (m.actionUsed && m.movePointsLeft <= 0) {
      m.finishTurn();
    } else if (m.activeUnit && m.activeUnit.team === Team.PLAYER && m.autoMode === AutoMode.MANUAL) {
      this._enterInput();
    }
  }

  _handleKey(e) {
    if (e.repeat) return;
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    switch (e.key) {
      case "q": case "Q": this._onActionButton("skill"); break;
      case "w": case "W": this._onActionButton("ult"); break;
      case "r": case "R": this._onActionButton("item"); break;
      case "e": case "E": this._onActionButton("interact"); break;
      case " ": e.preventDefault(); this._onActionButton("wait"); break;
      case "f": case "F": this._toggleFocus(); break;
      case "1": this._setAutoMode(0); break;
      case "2": this._setAutoMode(1); break;
      case "3": this._setAutoMode(2); break;
      case "Escape": this._cancelModes(); break;
      case "Enter":
        if (this.mode === "deploy") this._tryStartBattle();
        break;
      default: break;
    }
  }

  _toggleFocus() {
    if (this.mode !== "input") return;
    const target = this._lastHover;
    if (!target || target.team !== Team.ENEMY) {
      this._message("先指向一名敌人，再按 F 集火");
      return;
    }
    this.manager.focusTarget = this.manager.focusTarget === target ? null : target;
    this.scene.setFocusTarget(this.manager.focusTarget);
    this._message(this.manager.focusTarget ? `集火 ${target.data.name}` : "取消集火");
    this.app.audio.play("click");
  }

  _setAutoMode(mode) {
    if (this.manager.autoMode === mode) return;
    this.manager.autoMode = mode;
    this._updateAutoButtons();
    this._message(`托管模式：${AUTO_LABELS[mode]}`);
    // 当前是我方手动输入中 → 立刻切换为 AI 驱动
    if (mode !== AutoMode.MANUAL && this.mode === "input" && this.manager.activeUnit) {
      this.mode = "busy";
      this.scene.clearHighlights();
      this._enqueue(async () => {
        await sleep(250);
        this.manager.runAi();
      });
    }
  }

  _updateAutoButtons() {
    const btns = this.root.querySelectorAll(".auto-btn");
    btns.forEach((b, i) => b.classList.toggle("active", this.manager && this.manager.autoMode === i));
  }

  // —— 回放队列 ——
  _enqueuePlayback(events) {
    if (!events || events.length === 0) return;
    this._enqueue(async () => {
      this.scene.syncUnits(this.manager.units);
      for (const e of events) this.app.audio.playEvent(e);
      await this.scene.playEvents(events);
      this.scene.syncUnits(this.manager.units);
      this._refreshUnitPanel();
      this._refreshTurnPreview();
    });
  }

  _enqueueDialogue(text) {
    this._enqueue(async () => {
      const toast = this.$(".dialogue-toast");
      toast.textContent = text;
      toast.classList.remove("hidden");
      this._message(text);
      await sleep(1600);
      toast.classList.add("hidden");
    });
  }

  _enqueue(task) {
    this._busy = true;
    this._playback = this._playback.then(task).catch((err) => {
      console.error("回放异常", err);
    }).finally(() => {
      this._busy = false;
    });
  }

  // —— 面板刷新 ——
  _refreshUnitPanel() {
    const info = this.$(".unit-info");
    const unit = this.manager.activeUnit;
    if (!unit) { info.innerHTML = ""; return; }
    const buffs = unit.buffs.slice(0, 5).map((b) =>
      `<span class="buff-dot ${b.is_debuff ? "debuff" : ""}" title="${b.name}">${b.name.slice(0, 1)}</span>`).join("");
    const active = this.data.getSkillForUnit(unit.unitId, "active");
    const ult = this.data.getSkillForUnit(unit.unitId, "ult");
    info.innerHTML = `
      <div class="u-name">${unit.data.name}<span class="u-class">${classLabel(unit.data.unit_class)}</span></div>
      <div class="u-bars">
        <div class="bar hp"><i style="width:${(unit.hp / unit.data.hp) * 100}%"></i><span>${unit.hp}/${unit.data.hp}</span></div>
        <div class="bar rage"><i style="width:${unit.rage}%"></i><span>怒 ${unit.rage}</span></div>
      </div>
      <div class="u-skills">
        ${active ? `<span title="${active.desc}">Q ${active.name}${unit.skillCooldown(active.skill_id) > 0 ? `(CD${unit.skillCooldown(active.skill_id)})` : ""}</span>` : ""}
        ${ult ? `<span title="${ult.desc}">W ${ult.name}（怒${ult.rage_cost}）</span>` : ""}
      </div>
      <div class="u-buffs">${buffs}</div>`;
  }

  _refreshTurnPreview() {
    const preview = this.manager.turnOrder.preview(this.manager.units, 6);
    const el = this.$(".turn-preview");
    el.innerHTML = "<div class='tp-title'>行动顺序</div>";
    for (const u of preview) {
      const chip = document.createElement("div");
      chip.className = `tp-chip team-${u.team}`;
      chip.textContent = u.data.name;
      chip.title = `${u.data.name} 速度 ${u.data.spd}`;
      el.appendChild(chip);
    }
  }

  _message(text) {
    const log = this.$(".message-log");
    const line = document.createElement("div");
    line.textContent = text;
    log.appendChild(line);
    while (log.children.length > 3) log.removeChild(log.firstChild);
  }

  _updateHint(text) {
    this.$(".hint-bar").textContent = text;
  }

  // —— 战斗结束 ——
  _onBattleEnded(winner) {
    this._enqueue(async () => {
      this.mode = "end";
      this.scene.clearHighlights();
      this.scene.setActiveUnit(null);
      await sleep(500);
      this.app.audio.play(winner === Team.PLAYER ? "win" : "lose");
      const summary = this.app.settleBattle(this, winner);
      this._showResult(summary);
    });
  }

  _showResult(summary) {
    const modal = this.$(".result-modal");
    modal.classList.remove("hidden");
    const lines = summary.lines.map((l) => `<div class="r-line">${l}</div>`).join("");
    modal.innerHTML = `
      <div class="r-card">
        <div class="r-title ${summary.victory ? "win" : "lose"}">${summary.title}</div>
        ${summary.rank ? `<div class="r-rank rank-${summary.rank}">${summary.rank}</div>` : ""}
        <div class="r-lines">${lines}</div>
        <div class="r-buttons"></div>
      </div>`;
    const btns = modal.querySelector(".r-buttons");
    for (const b of summary.buttons) {
      const btn = document.createElement("button");
      btn.className = `btn ${b.primary ? "primary" : ""}`;
      btn.textContent = b.label;
      btn.addEventListener("click", () => {
        this.app.audio.play("click");
        b.action();
      });
      btns.appendChild(btn);
    }
  }
}

function classLabel(cls) {
  return { vanguard: "先锋", infantry: "步军", cavalry: "马军", archer: "神射", strategist: "谋士", healer: "医者", support: "辅助" }[cls] || cls;
}

function parseKeyFromStr(key) {
  const [x, y] = key.split(",").map(Number);
  return { x, y };
}

const itemSkillCache = new Map();
function itemToSkillCached(item) {
  if (!itemSkillCache.has(item.item_id)) {
    itemSkillCache.set(item.item_id, {
      skill_id: item.item_id, name: item.name, owner: "", type: "active", trigger: "manual",
      range_shape: item.range_shape, range_min: item.range_min, range_max: item.range_max,
      target: item.target, cooldown: 0, rage_cost: 0, effects: item.effects, desc: item.desc,
    });
  }
  return itemSkillCache.get(item.item_id);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
