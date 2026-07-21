# 核心层 API 契约（所有 core 模块必须遵守）

已完成模块（直接使用，不得改写其对外行为）：

- `src/core/coords.js`：`DIRS`（右左下上）、`keyOf(x,y)`、`cellKey({x,y})`、`parseKey(key)`、`manhattan(a,b)`、`chebyshev(a,b)`、`dominantDir(diff) -> {x,y}`（|dx|>=|dy| 取 x，等距优先 x；零向量返回 (0,0) 的 sign=0 结果）
- `src/core/csv.js`：`parseCsvTable(text)`、`toInt/toFloat`、`parseStringList`、`parseBonds`
- `src/core/data_loader.js`：`DataLoader`（API 见文件与 spec-data.md）、`itemToSkillData(item)`、`QUALITY_ORDER`、`UNIT_CLASSES`
- `src/core/roll_source.js`：`RandomRollSource(seed)` / `FixedRollSource(values)`，接口 `roll() -> [0,100)`
- `src/core/buff.js`：`makeBuff({...})`、`isBuffExpired(buff)`
- `src/core/unit.js`：`Unit(data, team, coords)`、`Team = {PLAYER:0, ENEMY:1, NPC_ALLY:2}`、`MAX_RAGE`。
  - 字段：`uid/data/team/coords/facing/hp/rage/av/buffs/cooldowns/extra_action_pending/is_elite/is_object/collectable/hero/channeling/alert_triggered/dead`，getter `alive`、`unitId`
  - 方法：`resetAv()`、`getAtk(grid)/getDef(grid)/getMgc()/getSpd()/getDodge(grid)/getBlock()/getCrit()/getMove(grid)`、`addBuff/removeBuff/getStatMod/hasStatus/canAct/canMove/skillCooldown/setCooldown/tickEffects()/tickDurations()/dispelDebuffs(count)`、`takeDamage(amount) -> {applied, interrupted, died}`、`heal(amount) -> healed`、`gainRage(v)`
  - 注意：`takeDamage` 不再发信号，由调用方根据返回值产出 `channel_interrupted` / 死亡处理；死亡防护 `dead` 标志保证只报一次。
- `src/core/grid.js`：`GridCell{coords,terrain,height,occupant,obstacle_hp,hasObstacle(),isBlocked()}`；`Grid(data, size, terrainMap, heightMap)`，方法 `isInside/getCell/canPass/canStop/getReachable(mover,budget)->Map<key,cost>/findPath(mover,to)->含起点路径[]/moveCostOf/placeUnit/moveUnit/setTerrain`
- `src/core/turn_order.js`：`TurnOrder`，`nextActor(units)`、`preview(units,count)`、`remove(unit)`
- `src/core/damage_calculator.js`：`compute(attacker,target,multiplier,grid,rolls,sureHit=false,attackValue=-1) -> {hit,dodged,blocked,crit,amount,dirMod,heightMod}`、`estimateAt(attacker,target,multiplier,grid,from)`、`directionModFrom/directionMod/heightMod` 及常量

## 待实现模块的导出契约

### `src/core/targeting.js`
- `resolveFrom(skill, caster, aim, grid, units, rolls, origin=null) -> Unit[]`（aim 为 null 或 {x:-1,y:-1} 表示无指向；origin 缺省 = caster.coords；后置修正读 `skill._mods` —— 由 EffectSystem 在调用前把 scanModifiers 结果挂到 skill 对象上，见下）
- `cellsInRange(skill, caster, grid, units) -> Unit[]`（= 全图扫描 _inArea，aim=(-1,-1)）
- `needsAim(skill) -> bool`（range_shape==line && target==enemy）

### `src/core/effect_system.js`
- `parseEffects(str) -> [{name, args[], times}]`（解析失败 throw Error 并指出技能/效果名）
- `scanModifiers(parsed) -> mods{}`（识别 sure_hit/hit_rate/chance/bonus_by_self_lost_hp/bonus_vs_elite/bonus_vs_high_def/bonus_vs_cavalry/execute_below/target_rule/random_target/friendly_fire；refresh_on_kill/extra_action 不进 mods）
- `execute(skill, ctx) -> events[]`；ctx = `{actor, target, grid, rolls, mods={}, depth=0, summoned=null, battle=null, effectMult=1.0}`
- 流程：合并 mods（scan_modifiers 前置，且 `skill._mods = mods` 供 Targeting 后置修正使用）→ hit_rate → chance → 顺序执行非修正效果 ×times
- 常量 `DOT_PERCENT=5`、`HIGH_DEF_THRESHOLD=100`、`SUMMON_HP=300`
- 词表与结算细节严格按 docs/spec-battle.md 第 4 节

### `src/core/passive_system.js`
- `afterCommand(battle, cmd, events) -> events[]`、`atTurnStart(battle, unit) -> events[]`

### `src/core/commands.js`
每个类有 `.actor` 与 `execute(battle) -> events[]`：
- `MoveCommand(actor, path)`（path 含起点之后的逐格路径，即 findPath 结果去掉首格）
- `AttackCommand(actor, target, skill, targetCell=null)`（targetCell 非空 = 打障碍）
- `SkillCommand(actor, skill, aim=null)`
- `WaitCommand(actor)`
- `InteractCommand(actor, target)`
- `ItemCommand(actor, item, targetUnit=null, aim=null)`

### `src/core/battle_manager.js`
- `class BattleManager`；构造 `new BattleManager(data, rolls)`（data=DataLoader，rolls=RollSource）
- 简单事件发射器：`on(name, cb)` / `off(name, cb)` / `_emit(name, ...args)`；信号：`state_changed, turn_started, turn_ended, command_executed, tick_events, unit_died, battle_ended, round_started, dialogue, deploy_changed`
- 字段：`data, grid, units[], rolls, turnOrder, state, activeUnit, moveUsed, actionUsed, movePointsLeft, activationLive, autoMode, focusTarget, pvpMods, itemStock{}, level, bossUnit, roundCount, collectCounts{}, occupyCounter, deployed[], triggers[], escortReached, achievementPaths{}, killTeams{}, playerDeaths`
- `State = {DEPLOY, IDLE, EXECUTING, AI_TURN, BATTLE_END}`；`AutoMode = {MANUAL, SEMI, FULL}`（导出）
- 方法（命令层/AI 依赖）：`setupLevel(level)`、`deployUnit(unitId, coords, hero=null)`、`confirmDeploy()`、`startBattle()`、`submitCommand(cmd)`、`finishTurn()`、`evaluateOutcome()`、`computeResult()`、`canUseSkill(unit, skill)`、`inAttackRange(attacker, target)`（含攻击者脚下 terrain.range_mod 加上限）、`inAttackRangeFrom(attacker, from, targetCoords)`、`enemiesInRange(unit)`、`genericAttackSkill(unit)`（range_min>=2 → generic_ranged 否则 generic_melee）、`canChannel(actor, target)`、`canUseItem(unit)`、`itemUsesLeft(itemId)`、`runAi()`、触发器 `_fireTriggers(event)` 等内部实现按 spec
- **光环依赖**：`setupLevel` 时必须 `grid.unitsRef = this.units`（Unit._auraMod 读取）；spawn/移除单位时保持同步（units 是同一数组引用即可）
- `submitCommand`：EXECUTING → `events = cmd.execute(this)` → 追加 `PassiveSystem.afterCommand` → emit `command_executed(cmd, events)` → 触发器扇出 → 状态回 IDLE/AI_TURN

### `src/core/battle_ai.js`
- `decide(unit, battle) -> Command[]`（0–2 个：移动 + 行动）
- 导出 `CONTROL_EFFECTS`

### `src/core/levels.js`
- `getLevel(id) -> LevelConfig（深拷贝）`、`listIds() -> string[]`、`EPILOGUES`

### 其他约定
- 事件对象字段名与 Godot 版一致（spec-battle.md 第 8.3 节），但引用单位时用 Unit 实例本身（表现层按 uid 解析）
- 逻辑层任何模块不得 import three.js / DOM / localStorage / fetch
- 缩进 2 空格，中文注释，文件头一句中文说明
