# 战斗逻辑层规格（spec-battle）

> 本文是 Godot 版《水浒战棋》战斗逻辑层移植到 Three.js（JS）的唯一规格依据。
> 源实现：`/Users/hohbandlee/Projects/NewHeroGame/src/battle/`。数值数据源：`data/*.csv`（见 spec-data.md）。
> 所有公式、数值、次序均逐条照抄源实现口径，重写时不得"优化"次序或合并乘区。

---

## 1. 总原则

- **逻辑瞬时结算**：一次指令（Command）同步算出全部结果事件；表现层（渲染/动画/音频）只订阅事件回放，不反向影响逻辑。
- **坐标系**：`Vector2i(x, y)`，x 向右、y 向下；**4 方向**移动/攻击（无斜向）。
- **距离**：一律**曼哈顿距离** `|dx|+|dy|`；唯一例外是 `ring` 范围模板用**切比雪夫距离** `max(|dx|,|dy|)`（斜角算 1 格）。
- **随机**：全部随机判定走 RollSource 抽象（产出 `[0,100)` 判定值）。生产=带种子随机源；测试=固定序列源。JS 版保留同接口以便测试复现。
- **语言无关**：本层不依赖渲染、不依赖输入；键盘/UI 只是 Command 的生产者。

---

## 2. 类清单

### 2.1 GridCell（格子）

字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| `coords` | Vector2i | 坐标 |
| `terrain` | TerrainData | 地形数据引用 |
| `height` | int | 高度（默认 0，来自关卡 height_map） |
| `occupant` | Unit / null | 占位单位 |
| `obstacle_hp` | int | 可破坏障碍剩余耐久（destructible 地形初始化，如拒马 300） |

派生：

- `has_obstacle()`：`terrain.destructible && obstacle_hp > 0`
- `is_blocked()`：`!terrain.passable || has_obstacle()`

### 2.2 Grid（棋盘）

- `DIRS = [Vector2i(1,0), Vector2i(-1,0), Vector2i(0,1), Vector2i(0,-1)]` —— **右、左、下、上，顺序重要**（summon 找邻格等按此序取"首个"）。
- `setup(size, terrain_map, height_map)`：建格，落地形与高度；destructible 地形格置 `obstacle_hp = terrain.hp`。
- `is_inside(c)` / `get_cell(c)`。
- `can_pass(unit, cell)`：格内、可通行、无障碍；**友军（同 team）可穿过，敌军不可穿过**（occupant 为 null 或同 team 才可 pass）。
- `can_stop(unit, cell)`：`can_pass` 且 **无占位**（停留必须空格）。
- `get_reachable(unit, budget)`：**Dijkstra 洪水填充**，每格进入消耗 = `move_cost_of`；返回**不含起点、仅可停留格**的集合。
- `find_path(from, to, unit)`：**4 向 A\***，边权重 = 进入该格消耗；敌占格视为 solid（不可通过）；返回**含起点**的路径数组。
- `move_cost_of(unit, terrain)`：若 `terrain.id == water && unit 有 water_walker 特性` → 1；否则 `terrain.move_cost`。
- `place_unit(unit, coords)` / `move_unit(unit, path)`（更新占位）/ `set_terrain(coords, terrain_id)`（障碍打碎、触发器改地形共用此路径，寻路缓存随之刷新）。

### 2.3 Unit（单位）

**Team 枚举**：`PLAYER = 0`、`ENEMY = 1`、`NPC_ALLY = 2`（**枚举值本身参与 CTB 平局排序**，不得改序）。

常量：`MAX_RAGE = 100`。

字段：

| 字段 | 默认 | 说明 |
|---|---|---|
| `data` | UnitData | CSV 静态数据 |
| `team` | — | Team 枚举 |
| `coords` | Vector2i | 位置 |
| `facing` | `(0, 1)` | 朝向（4 向单位向量），部署时我方覆写为 `(0,-1)` |
| `hp` | data.hp | 当前生命 |
| `rage` | 0 | 怒气 0–100 |
| `av` | — | 行动值（CTB） |
| `buffs` | Array[Buff] | 按施加顺序排列（驱散/窃取依赖此顺序） |
| `cooldowns` | {skill_id: int} | 技能冷却 |
| `extra_action_pending` | false | 再动标记 |
| `is_elite` | false | 精英标记（bonus_vs_elite 判定） |
| `is_object` | false | 物件（旗帜/生辰纲担等）：不占 CTB、不计胜负 |
| `collectable` | false | 可夺取物件：不可被任何攻击/技能指定 |
| `hero` | null | 养成数据（见 spec-meta.md），无养成时为 null |
| `channeling` | null | 正在引导的物件 Unit |
| `alert_triggered` | false | 警觉特性：首次睡眠已减免标记 |

方法（口径逐条）：

- `reset_av()`：`av = 1000 / get_spd()`（**含 Buff 的当前速度**）。
- `_with_mods(field, base, grid)`：`mod = Σ buff.stat_mods[field] + 地形修正(站脚格的 atk_mod|def_mod 等) + 光环修正`，结果 = `max(0, round(base × (100 + mod) / 100))`。
  - `atk / def / mgc / spd` 的 mod 是**百分数**（+20 = +20%）；
  - `dodge / block / crit` 是**概率点直接相加**（不走 ×(100+mod)/100）；
  - `move` 是**格数**直接相加。
- **光环**：遍历全图**同队存活单位（不含自己）**的 buffs，凡 `aura_radius > 0` 且 `aura_mods` 含该字段、与光环源曼哈顿 ≤ 半径 → 叠加进 mod。
- `get_atk() / get_def()`：`_with_mods` 全套（buff + 地形 atk_mod/def_mod + 光环）。
- `get_mgc()`：**只吃 buff**（地形/光环无 mgc 修正）。
- `get_spd()`：`max(1, …)`（防除零）。
- `get_dodge()`：`data.dodge + Σ buff.dodge + 地形 dodge_mod`（概率点）。
- `get_block()` / `get_crit()`：同 dodge 口径（buff 概率点相加，无地形项）。
- `get_move(grid)`：`max(0, data.move + Σ buff.move + (站水面且无 water_walker ? -1 : 0))`。
- `add_buff(b)`：**同 buff_id 不叠层**，重复施加只刷新 `duration = max(旧, 新)`。
- `can_act()`：无 `stun / sleep / paralyze` 状态。
- `can_move()`：`can_act()` 且无 `bind`。
- `tick_effects()`：遍历 tick_effect——`dot` 按**最大生命百分比**扣血（走 take_damage，产 `dot` 事件）；`hot` 按最大生命百分比回血（回 0 不产事件，>0 产 `hot` 事件）。
- `tick_durations()`：**所有技能冷却 -1**；所有 buff `duration -1`，归零移除并产 `buff_expired` 事件。**必须在 can_act 判定之后调用**（见 advance_turn 次序）。
- `dispel_debuffs(count)`：按 buffs 数组顺序，驱散前 `count` 个 `is_debuff && dispellable` 的 buff。
- `take_damage(amount)`：实际扣血 `applied = min(max(amount, 0), hp)`；`applied > 0` 时**睡眠立即解除**、**引导打断**（`channeling = null` 并发 `channel_interrupted` 信号）；`hp == 0` 发 `died` 信号。
- `heal(amount)`：封顶到最大生命，返回实际恢复量。
- `gain_rage(v)`：`clamp(rage + v, 0, 100)`。

### 2.4 Buff

字段：

| 字段 | 默认 | 说明 |
|---|---|---|
| `buff_id` | — | 唯一 id（同名刷新不叠层） |
| `name` | "" | 显示名 |
| `stat_mods` | `{field: int}` | atk/def/mgc/spd 为 %；dodge/block/crit 为概率点；move 为格数 |
| `duration` | 1 | 持有者**自己回合开始阶段二** -1 |
| `stacks` | 1 | 预留，**未实装** |
| `dispellable` | true | 可否驱散 |
| `is_debuff` | false | 减益标记 |
| `tick_effect` | null | `{kind: "dot"\|"hot", percent: number}` |
| `status` | "" | `stun / sleep / paralyze / bind / guard / counter` |
| `aura_mods` + `aura_radius` | `{}` / 0 | `aura_radius = 0` = 非光环 |
| `source` | null | 来源（技能/触发器） |

### 2.5 TurnOrder（CTB 行动条）

- `AV = 1000 / 速度`；全体 AV **同步递减**，归零者进 `_ready` 队列。
- `next_actor()`：`_ready` 为空则 `_tick()`；死单位跳过；**10000 次防死循环**保护。
- `_tick()`：取**存活且非 is_object** 单位求 `min_av`，全体减 `min_av`；减后 `av <= 0.0001` 者进 zeroed 组，按 `_tie_less` 排序入队。
- **平局排序 `_tie_less`**：① `data.spd` **基础速度**高者优先（不是含 buff 的 get_spd）→ ② team 枚举小者优先（PLAYER=0 最优先，ENEMY=1，NPC_ALLY=2）→ ③ `unit_id` 字典序。
- `preview(n)`：**非破坏性**预演（复制 AV 沙盘推演）；假设各单位行动后按 `1000 / max(1, data.spd)`（**基础速度**）重置——与 `reset_av()` 用含 buff 速度**不一致，保留此差异**。
- `remove(unit)`：死亡/移出。

### 2.6 DamageCalculator 常量

| 常量 | 值 | 说明 |
|---|---|---|
| `CRIT_MULT` | 1.5 | 暴击倍率（独立乘区） |
| `BLOCK_REDUCE` | 0.3 | 格挡减伤比例 |
| `BACKSTAB_MOD` | +0.25 | 背刺 |
| `SIDE_MOD` | +0.10 | 侧击 |
| `HIGH_GROUND_MOD` | +0.15 | 高打低 |
| `LOW_GROUND_MOD` | -0.10 | 低打高 |

### 2.7 EffectContext（效果上下文）

`{actor, target, grid, rolls(RollSource), mods = {}, depth = 0, summoned = null, battle = null, effect_mult = 1.0}`

- `mods`：修正类效果前置扫描结果（sure_hit、bonus_* 等键）。
- `depth`：递归深度（反击/被动 = 1，防连锁）。
- `effect_mult`：技能等级倍率（养成），无养成 = 1.0。

---

## 3. 战斗流程（BattleManager）

状态机：`DEPLOY → IDLE ⇄ AI_TURN ⇄ EXECUTING → BATTLE_END`。

### 3.1 setup_level(level)

1. 建 `Grid`（grid_size / terrain_map / height_map）。
2. `spawn_from_spec(spec, team)` 逐个落敌方与 NPC：
   - spec 支持 `stat_mult`（全属性缩放）、`elite`、`boss`、`team` 覆盖（触发器增援用）、`hero`（PVP 守方按养成数值生成）。
   - **落点被占时 BFS 外扩**到最近可站立格。
3. `_spawn_object(spec)`：关卡 objects——`is_object = true`、`collectable = true`、`team = NPC_ALLY`、`hp` 默认 300、`spd = 1`。
4. **深拷贝** triggers（运行期消耗 once，不污染配置）。
5. 道具栏：`DataLoader.default_item_stock()`（{item_id: uses_per_battle} 全员通用）。
6. 进 `DEPLOY`；**必出武将自动落位**（required_units 自动放进部署区，可调整不可撤下）。

### 3.2 deploy_unit / confirm_deploy

- `deploy_unit(unit_id, coords)` 校验：`DEPLOY` 状态；coords 在部署区内；未超 `max_deploy`；职业 ∈ `allowed_classes`（空 = 不限，**逻辑层硬校验**）；**我方 facing = (0, -1)**（朝上）。
- 撤下：点已上阵单位撤下（**必出不可撤**）；`deploy_changed` 信号刷新 UI。
- `confirm_deploy()`：校验必出全在阵 → `start_battle()`。

### 3.3 start_battle

1. **BondSystem.apply_bonds**：同队在场羁绊搭档，**双方各得** `bond_<partner_id>` buff：`atk/def +bond_stat_bonus%`（默认 5，progression.csv）、`duration = 99`、**不可驱散**；每对羁绊产 `bond` 事件（经 `tick_events(null, events)` 发出）。
2. 触发 **START** 触发器。
3. `advance_turn()`。

### 3.4 advance_turn（严格次序）

1. `evaluate_outcome()` 已分胜负 → 置 `BATTLE_END`、发 `battle_ended(winner)`、返回。
2. `active_unit = turn_order.next_actor()`。
3. **阶段一**：`active_unit.tick_effects()`（DoT/HoT）+ `_terrain_tick()`（脚下 `camp` 回 **8% 最大生命**；`fire` 烧 **5% 最大生命**）。若单位因此死亡 → 发 `tick_events` 后**递归 advance_turn**（本激活整个跳过）。
4. `incapacitated = not active_unit.can_act()`（**先判定**）。
5. **阶段二**：`active_unit.tick_durations()`（冷却与 buff 时长 -1）。
6. 若 `incapacitated`：追加 `turn_skipped` 事件 → 发 `tick_events` → `finish_turn`（眩晕 1 回合恰好跳过一次行动，全靠"先判后减"）。
7. 发 `tick_events(active_unit, tick)`。
8. **引导收讫**：`active_unit.channeling != null` → `_complete_collect()`：物件存活则移除、`collect_counts[id] + 1`、产 `collect` 事件；物件已死产 `collect_failed`。
9. **turn_start 被动**：`PassiveSystem.at_turn_start`（在移动力结算**之前**；被跳过激活的不触发）。
10. `move_used = false; action_used = false; move_points_left = active_unit.get_move(grid); _activation_live = true`。
11. 敌方/NPC → 进 `AI_TURN`；我方 → 进 `IDLE` 并发 `turn_started(active_unit)`。

### 3.5 finish_turn

1. 若 `extra_action_pending` → 清标记、`av = 0`（**再动不 reset_av**）；否则 `reset_av()`。
2. 发 `turn_ended(unit)`。
3. 本激活单位（存活非物件）记入 `_round_actors`。
4. `_check_round_complete()`。
5. 递归 `advance_turn()`。

### 3.6 回合（round）与 _check_round_complete

- **round 定义**：全体存活非物件单位各行动一次 = 1 回合（CTB 无自然轮次）。**再动不重复计数**；死亡即时移出当轮名单。
- 完成一轮：`round_count + 1` → **OCCUPY 计数**（占领区域内有我方存活单位则连续 +1，否则清零）→ 发 `round_started(round_count)` → 触发 **TURN** 触发器（on.turn == round_count）。

### 3.7 玩家回合规则

- **移动点数制**：可拆**任意多段**，只要 `move_points_left > 0`；行动不扣移动力。
- **行动四选一**（用掉 `action_used`）：普攻 / Q 主动技 / W 绝技 / E 夺取 / R 道具。
- **激活结束条件**：`action_used && move_points_left <= 0` 自动 finish_turn；待机立即 finish_turn。
- `AttackCommand / SkillCommand / WaitCommand` 自身**不置** `action_used`，由 UI 层设置；只有 `ItemCommand` **内部自置** `battle.action_used = true`（JS 版建议统一收进 Command 层，但**行为必须一致**）。
- `F` 键集火 `focus_target`（AI 评分 +100，目标死亡自动清除）；`1 / 2 / 3` 切托管模式（手动 MANUAL / 半自动 SEMI / 全自动 FULL）。

### 3.8 evaluate_outcome（**次序敏感**）

1. **我方全灭**（无存活非物件 PLAYER 单位）→ ENEMY 胜（**最高优先**）。
2. `lose_conditions` 任一满足 → ENEMY 胜：
   - `WIPED_OUT`（同 1）；`TURN_LIMIT`（`round_count > turns`）；`ESCORT_DEAD`（护送单位已死）。
3. `win_condition` 满足 → PLAYER 胜：
   - `WIPE_OUT`（敌方全灭）；`KILL_BOSS`（boss 标记单位全灭）；`SURVIVE_TURNS`（`round_count >= turns`）；`COLLECT`（`collect_counts[target] >= count`）；`ESCORT`（`_escort_reached`）；`OCCUPY`（`occupy_counter >= turns`）。
4. **敌方全灭**且胜条件**不是** COLLECT / ESCORT → PLAYER 胜（目标未达成不能靠杀光取胜）。
5. 否则 -1（未分胜负）。

### 3.9 compute_result

- 发放：胜利才有奖励；奖励分首通（first_clear）/常规（regular），按 `progress.cleared` 判定。
- **评价**：`rank_rules` 全满足（`s_no_death` 且 `round_count <= s_max_rounds`）→ **S**；其余通关 → **A**；无规则关固定 A。我方阵亡按 `_player_deaths` 统计。
- **成就**：`requires` 支持 `path`（剧情路线标记）/ `no_player_kills([unit_id])`（按 `_kill_teams` 判定击杀者阵营，NPC 友军击杀不阻断）/ `boss_dead`；同 `exclusive_group` 互斥，**取配置中先列出者**。

---

## 4. 触发器系统

- **事件源**（内部扇出 `_fan_out_trigger_events`）：
  - `START`（开局）/ `TURN`（每 round 完成）；
  - `UNIT_DEAD` / `UNIT_MOVED`（`move / pull / push / teleport / swap` 事件**全部扇出**，拉拽撞线也算 ENTER_ZONE）；
  - `UNIT_DAMAGED`（`damage` 事件扇出；**died 时记录 `_kill_teams[unit_id] = source.team`**，供 no_player_kills 成就）。
- **on**：`{type: TURN, turn}` / `{type: UNIT_DEAD, unit}` / `{type: ENTER_ZONE, zone: Rect2i, who: "player"|"enemy"|"any"|具体 unit_id}` / `{type: HP_BELOW, unit, ratio}`（当前血/最大血 `< ratio`）。
- **if（附加条件）**：`{type: collect_below, target, count}` / `{type: unit_deployed, unit}` / `{type: unit_alive, unit}`。
- **actions**：
  - `spawn {units: [{unit, coords, team, stat_mult?}]}`；
  - `dialogue {text}`；
  - `terrain {cells: {Vector2i: terrain_id}}`；
  - `buff {side: "player"|"enemy" | unit: unit_id, field, value, duration, name}`；
  - `status {side, status, duration, except: {unit, duration}, name?}`（阵营控制 + 例外时长）；
  - `regen {unit, percent, duration, name?}`（挂 hot buff）；
  - `achievement_path {path}`。
- `once` **默认 true**。

---

## 5. 伤害公式（DamageCalculator）

`compute(attacker, target, multiplier, grid, rolls, sure_hit = false, attack_value = -1)` —— **严格按此次序**：

1. **闪避**：`!sure_hit && rolls.roll() < target.get_dodge()` → `miss`，全免（不产生任何伤害）。
2. `dir_mod = direction_mod(attacker, target)`；`height_mod`（高低差，见下）。
3. **攻击值**：`attack_value < 0 ? attacker.get_atk() : attack_value`；`mgc_dmg` 传 `get_mgc()` 作为 attack_value，但**仍用目标的 get_def() 结算**。
4. `base = atk × multiplier × 100 / (100 + target.get_def())`。
5. `amount = base × (1 + dir_mod + height_mod)` —— 方位与高低差**相加合并为一个加算乘区**（D6，不叠乘）。
6. **暴击**：`rolls.roll() < get_crit()` → `× CRIT_MULT`（×1.5，独立乘区）。
7. **格挡**：`rolls.roll() < get_block()` → `× (1 - BLOCK_REDUCE)`（×0.7；**暴击与格挡可同时发生**）。
8. `max(1, round(amount))`。

**方位（direction_mod）**：

- `diff = target.coords - attacker.coords`；`dir = dominant_dir(diff)`：`|dx| >= |dy|` 取 x 向（**等距优先 x**），否则 y 向。
- `dir == target.facing` → **背刺 +0.25**（从背后打，攻击方向与目标朝向同向）；
- `dir == -target.facing` → **正面 +0**；
- 其余 → **侧击 +0.10**。
- `direction_mod_from(attacker, target, from_coords)` 支持**假想落点**（AI 评分用）。

**高低差（height_mod）**：攻击者所在格 `height >` 目标格 → **+0.15**；`<` → **-0.10**；相等 → 0。

**estimate_at（AI 期望值，不掷骰）**：

```
est = base × (1 + dir_mod + height_mod) × (1 + crit/100 × 0.5) × clamp(1 - dodge/100, 0.05, 1.0)
```

---

## 6. 效果串语法（parse_effects）

- 例：`"phys_dmg(0.9)x4;rage(+20)"` → `[{name: "phys_dmg", args: ["0.9"], times: 4}, {name: "rage", args: ["+20"], times: 1}]`。
- `;` 分隔多个效果；`)xN` 后缀 = 重复 N 次（连击每段独立结算）；**无参效果不写括号**（`pull_to_front`、`swap_position`、`sure_hit`）；参数 `,` 分隔。
- **CSV 数值惯例：`0.3 = 30%`**（`_percent_value = round(x × 100)`）；`move_mod` 例外，直接给整数格数。
- 未知效果名必须报错：`KNOWN_EFFECTS` 白名单（同时是数据校验依据），报错指出技能 id 与效果名。

## 7. EffectSystem.execute 管线

`execute(ctx, skill_data)`：

1. `ctx.mods.merge(scan_modifiers(parse(effects)))` —— **修正类效果前置扫描，与 CSV 书写顺序无关**（预设 mods 与扫描并存）。
2. `hit_rate(p)`：`roll() >= p × 100` → **整个技能对该目标 miss**，返回 `[{type: "miss"}]`；**逐目标判定**（AOE 中每个目标独立 roll）。
3. `chance(p)`：`roll() >= p × 100` → 整串不触发，返回 `[]`（无事件无表现）。
4. 顺序执行非修正类效果，每个 × `times`。

**scan_modifiers 识别的修正类**：`sure_hit / hit_rate / chance / bonus_by_self_lost_hp / bonus_vs_elite / bonus_vs_high_def / bonus_vs_cavalry / execute_below / target_rule / random_target / friendly_fire`。

**例外**：`refresh_on_kill / extra_action` 在 MODIFIER_EFFECTS 名单中但**不进 mods**，由 SkillCommand 后处理（见 10.4）。

---

## 8. 原子效果全词表（逐个参数与结算）

### 8.1 伤害类

**phys_dmg(mult) / mgc_dmg(mult)** 结算链：

1. **guard 援护**：仅当 `depth == 0`、目标 ≠ 施法者、施法者与目标**曼哈顿 > 1（远程）**时，扫目标 4 邻格，第一个存活同队且带 `guard` 状态的单位**替为目标**。
2. **execute_below(v)**：目标当前血量比例 `<= v` → 直接扣光（事件带 `executed: true, died: true`，跳过伤害公式）。
3. **倍率修正**：`mult ×= ctx.effect_mult`；`bonus_by_self_lost_hp(k)` → `mult ×= (1 + k × (1 - 自己血比))`；`bonus_vs_elite(k)` / `bonus_vs_high_def(k)`（目标 `def >= HIGH_DEF_THRESHOLD = 100`）/ `bonus_vs_cavalry(k)` 各 `mult ×= 1 + k`。
4. `DamageCalculator.compute(..., sure_hit = mods.sure_hit)`；被闪避产 `dodge` 事件（不继续后续步骤）。
5. `take_damage`；**非被动**（`mods` 无 `passive` 键）时：受击方 `+rage_on_hit_taken`（10）；击杀时攻方 `+rage_on_kill`（30）。
6. 产 `damage` 事件：`{source, target, skill, amount, crit, blocked, dir_mod, height_mod, died}`。
7. **counter 反击**：目标未死、`depth == 0`、目标带 `counter` 状态、**攻方在目标武器射程内**（有 battle 引用用 `in_attack_range`（含目标脚下 terrain.range_mod）；无则曼哈顿 ∈ `[range_min, range_max]`）→ 以 `depth = 1`、倍率 1.0 再结算一次 `_phys_dmg`（depth 防互反；**反击产怒气**；反击事件的 `skill` 仍是原技能 id；**guard 不拦反击**）。

### 8.2 治疗与怒气

- `heal(mult)`：`round(actor.get_mgc() × mult × effect_mult)`，封顶目标缺口，产 `heal` 事件 `{source, target, skill, amount}`。
- `rage(v)`：加给**施法者自己**，产 `rage` 事件 `{unit, value}`。

### 8.3 位移类

- `pull(n) / push(n)`：逐格移动 n 格上限；每格方向 = `dominant_dir(actor.coords - target.coords) × (1 / -1)`（**每格重算**），`can_stop` 失败即停；产 `pull`/`push` 事件 `{target, cells, to}`。
- `pull_to_front`：沿 dominant_dir 拉至与施法者曼哈顿 ≤ 1。
- `swap_position`：双方直接换位，**零校验**。
- `teleport(n)`：以自身为圆心、曼哈顿 ≤ n 的菱形内，找"**距最近敌人曼哈顿最小**"的可站立格（`is_blocked` 或有任何占位均排除），**无视地形消耗**；产 `teleport` 事件 `{unit, from, to}`。

### 8.4 状态类

- `stun(n) / sleep(n) / paralyze(n)`：跳过行动。**sleep**：警觉特性 `alert` 单位首次受睡眠时长 `min(n, 1)`（并置 alert_triggered）；睡眠者**受任何伤害立即打醒**。
- `sleep_chance(p, n)`：`roll() < p × 100` 才上睡眠，否则产 `status_resist` 事件。
- `bind(n)`：不可移动、可行动。
- `guard(n) / counter(n)`：见 8.1。
- 统一 `_apply_status`：`buff_id = status 名`，`is_debuff = true`，产 `status` 事件 `{target, status, duration}`。

### 8.5 增益/减益类

- `buff(field, val, dur)`：任意字段，val 走百分比惯例（`buff(crit, 0.1, 1)` = 暴击 +10 点）。
- `def_up(val, dur) / dodge_up(val, dur) / block_up(val, dur)`。
- `armor_break(val, dur)`：def 减（debuff）；**专武溅射**：`ctx.mods.signature_morph.effect == "armor_break"` 时，溅射到目标 `splash_radius` 曼哈顿范围内的其他敌人（每人各挂一份）。
- `debuff_mgc(val, dur)`。
- `move_mod(v, dur)`：v 为**整数格数**；负值算 debuff。
- `random_buff(A参数 | B参数)`：`roll()` 均匀选分支（二选一各 50%），递归执行该分支。
- `steal_buff(n)`：从目标（`target == self` 时改取**最近敌人**）偷前 n 个**非 debuff 且可驱散**的 buff 转给自己；产 `steal` 事件 `{from, count, stolen}`。
- `dispel(n)`：驱目标前 n 个可驱散 debuff，产 `dispel` 事件 `{target, removed}`。
- `poison(n) / burn(n) / bleed(n)`：挂 DoT buff（`buff_id` = 效果名），每跳 = **目标最大生命 5%**（`DOT_PERCENT = 5`），持续 n 回合。
- 统一 `_apply_stat_buff`：`buff_id = "{skill_id}_{field}"`，产 `buff` 事件 `{target, buff, field, value, duration}`。

### 8.6 机制类

- `summon(object_id)`：按 **DIRS 顺序**找施法者首个可站立邻格，放 `is_object = true`、`hp = 300`（`SUMMON_HP`）、`spd = 1` 的静态友军物件；注册进 `battle.units`；写入 `ctx.summoned`；产 `summon` 事件 `{object, unit, cell, ok}`。
- `aura(field+v, ..., rN)`：如 `aura(atk+0.15, def+0.15, r3)`——光环 buff（`duration = 99`、**不可驱散**）挂在**本次 summon 的物件**上（无召唤物则挂自身），半径 rN；产 `aura` 事件 `{holder, radius, mods}`。
- `av_mod(v)`：`target.av ×= (1 + v)`，产 `av_mod` 事件。
- `extra_action(n)`：**不在此执行**，见 SkillCommand 后处理。
- **未实现效果**：`push_error` 指出技能 id 与效果名。

### 8.7 EffectSystem 常量

| 常量 | 值 |
|---|---|
| `DOT_PERCENT` | 5 |
| `HIGH_DEF_THRESHOLD` | 100 |
| `SUMMON_HP` | 300 |

---

## 9. 被动系统（PassiveSystem）

- **挂点**：`after_command(cmd, events, battle)` 仅认 `AttackCommand / SkillCommand`（**道具不触发**）；`at_turn_start` 挂 advance_turn 第 9 步。
- **命中目标统计**：只统计事件里 `type == "damage" && source == cmd.actor` 的目标（**反击/被动造成的伤害不回流触发**），去重得 `hit_targets`。
- **触发语义**：
  - `on_attack`：行动者自身的 on_attack 被动，涉事对方 = **首个被命中目标（优先存活者）**；
  - `on_hit`：**每个存活被命中目标**的 on_hit 被动，涉事对方 = 攻击者；
  - `turn_start`：无涉事对方（CSV 强制 target = self）。
- `_fire`：`target == self` → 作用于持有者；`target == enemy` → 作用于涉事对方（**已死跳过**）。
- 结算上下文：`ctx.depth = 1`（被动伤害不再触发反击/连锁被动）；`ctx.mods.passive = true`（**被动伤害不给目标送受击怒气**，D41）。
- **技能等级**：有 `hero` 时 `effect_mult = 1 + skill_level_mult × (技能等级 - 1)`（无养成 = 1.0）。
- **概率**：用 `chance(p)`（整串按概率触发，未触发无事件）。
- **事件**：先产 `passive_trigger` 事件 `{unit, skill, …}`，再并入效果事件队列回放。
- **AI 完全不评估被动**。

## 10. Buff 规则汇总

- 同 buff_id 重复施加 = **刷新不叠层**，duration 取 max。
- 持续口径：持有者**自己回合开始阶段二** -1；`duration = 1` 的控制 = 恰好跳过一次行动。
- 同字段修正**直接相加**，与地形、光环一起进 `base × (100 + mod) / 100`。
- 驱散：仅 `is_debuff && dispellable`，按**施加顺序**取前 n 个。
- 特殊 buff id 约定：
  - `wait_def`：待机 +20% def，1 回合，**不可驱散**；
  - `bond_*` / `aura_*`：99 回合，**不可驱散**；
  - `trigger_*`：触发器施加。

---

## 11. 目标解析（Targeting）

`resolve_from(skill, caster, aim, grid, units, rolls, origin)`：

1. `range_shape == "self"` → 仅 `[caster]`，不再过滤。
2. 遍历**存活单位**，过 `_target_filter` 与 `_in_area`：
   - **collectable 一律不可指定**（Targeting / BattleAI / enemies_in_range 三处排除）；
   - `enemy`：`(u.team == ENEMY) != (caster.team == ENEMY)`——注意 **PLAYER 与 NPC_ALLY 互不敌对，但也互不算 ally**；
   - `ally`：同 team；
   - `self`：本人。
3. **后置修正**：
   - `target_rule(lowest_hp)`：多目标只留 hp 最低者；
   - `target_rule(random)`：随机 1 个（`int(clamp(roll/100, 0, 0.9999) × size)`）；
   - `random_target(n)`：范围内随机 n 个，**无放回**；
   - `friendly_fire(p)`：范围内每个**同队友军**（非自己、未在目标列表）按 `p × 100` 概率追加。

**_in_area 范围模板**：

| range_shape | 口径 |
|---|---|
| `adjacent` / `diamond` | 曼哈顿距离 ∈ [min, max]（二者同义） |
| `ring` | 切比雪夫距离 ∈ [min, max] |
| `all` | 全图 |
| `self` | 自身格 |
| `line` | 无 aim（`(-1,-1)`）：同横线或同纵线且曼哈顿在程内；有 aim：`dir = dominant_dir(aim - from)`，只保留该方向轴线上、与 diff 同号、距离 ∈ [min, max] 的格 |

- `needs_aim = (range_shape == "line" && target == "enemy")`。
- `cells_in_range`：全图扫描（aim = (-1,-1)），供预览/AI 用。
- **line 不做遮挡判定**：只看格子在 4 向直线上且距离在区间内，拒马/单位不挡射线。

## 12. 武器与普攻射程

- **weapons.csv** 只决定普攻**范围形状**：`line` = 4 向直线；`adjacent` = 近战；`diamond` = 远程（都按曼哈顿/直线区间）。射程数值在单位自身 `range_min / range_max`。武器未登记 → 退回 `diamond` 并告警。
- **普攻射程修正**：`range_max += 攻击者脚下 terrain.range_mod`（山地 +1；**下限不变**；按站立格**实时计算**，含反击判定与 AI 假想落点）。
- line 武器要求同轴（见上表）。
- `enemies_in_range`：只认 **ENEMY 队**且非 collectable（NPC 友军不可被指定）。
- **普攻技能合成**：单位普攻技能 = `range_min >= 2` → `generic_ranged`（diamond 2-5，`phys_dmg(0.9)`）；否则 `generic_melee`（adjacent 1-1，`phys_dmg(1.0)`）；都自带 `rage(+20)`。

## 13. 移动规则

- **无 ZoC**（控制区）；4 方向；**友军可穿不可停；敌军不可穿；障碍/不可通行格不可进入**。
- Dijkstra 洪水填充，预算 = 剩余移动力 `move_points_left`。
- **分段移动**：`MoveCommand` 按 `path_cost`（路径每格进入消耗求和，path 不含起点）扣减，超耗拒绝；不限段数。
- **仅当前激活单位在激活窗口内**校验与扣减；窗口外的脚本化移动（AI 单段/触发器）不校验。
- 移动后**朝向 = 最后一步的 dominant_dir**。
- `teleport` 无视消耗。

---

## 14. AI（BattleAI）

### 14.1 decide(unit, battle) 流程

1. 取职业权重（ai_weights.csv）；**PVP 守方**按 `pvp_mods.weights` 逐键乘（见 spec-meta.md 演武场）。
2. 枚举落点 `dests = [原地] + get_reachable(满移动力)`。
3. 对每个 dest 枚举行动候选：
   - **普攻**：每个敌人 `in_attack_range_from(dest)` → `_score_attack(mult = 1.0, times = 1)`；
   - **技能**：`_usable_skills`——active + ult，需怒气够、无冷却；**蒙汗药酒保留**：`_yaojiu_reserved_for_stall`——场上有空酒摊时 `act_yaojiu` 不当普通技能放；**半自动模式**下我方 ult 需过 `ult_allowed` 门；
   - **待机**：`_score_wait`。
4. **关卡目标候选**（均 `+ danger × ai_obj_danger_factor(0.5)`）：
   - COLLECT 且我方：相邻物件 → interact **120 分**；否则趋向最近物件的 wait：`100 - d×2`；
   - ESCORT 且本人是被护送者：趋向目标区 `250 - d×3`；
   - 蒙汗药酒：`act_yaojiu` 持有者到酒摊格 **150**、趋向酒摊 `140 - d×2`。
5. **打障碍候选**：仅当**没有任何普攻候选**时，对射程内拒马固定 **3 分**。
6. 按分降序取最优 `_build_plan`：dest ≠ 原地 → `find_path` 去首格生成 MoveCommand + 行动 Command；**line 技能 aim** 选命中敌数最多的敌人格（`_best_aim`）。

### 14.2 打分公式（各评分因子 × 职业权重后求和）

**_score_attack**：

```
score = est × w.damage_expect
      + (est >= target.hp ? ai_kill_base(50) × w.kill_bonus : 0)
      + target_value × w.target_value
      + danger × w.danger                     # danger 为负值
      + aura_coverage × ai_aura_coverage_factor(10) × w.aura_coverage
      + position_bonus × w.position
      + class_special                         # 不乘权重
      + pvp_template_bonus
      + (target == focus_target ? ai_focus_bonus(100) : 0)
est = DamageCalculator.estimate_at(...) × times
```

**_target_value**：

```
职业基础值（healer 30 / strategist 25 / archer·infantry·cavalry 20 / vanguard 10 / 其他 15）
+ (1 - 目标血比) × ai_target_value_low_hp(20)
+ 羁绊核心（带 bond_ 前缀 buff）→ +15
+ 满怒 → +15
```

**_danger**（对假想落点 dest）：对每个满足 `曼哈顿(e.coords, dest) <= e.move + e.range_max` 的敌人，累加 `estimate_at(e, unit, 1.0, grid, e.coords)`（按敌人当前位置，不模拟走位）；`总分 = (承伤总量 / 自己最大HP) × ai_danger_base(-30)`。PVP protect_core 模板的核心单位 `× core_danger_mult`。

**_aura_coverage**：落点被我方光环罩住 **+1/源**；自己是光环源时，落点能罩住的队友 **+1/人**。

**_position_bonus**（按 dest 假想方位）：背刺 **+20** / 侧击 **+10**；dest 高度 > 0 → **+15**。

**_class_special**（不乘权重）：

- `vanguard`：每个相邻（≤1）队友 × 10；落点在敌我连线格 +25（`_on_cover_line`：叉积共线且点积判定**严格在线段内部**）；
- `infantry`：背刺位 +20；
- `cavalry`：移动格数 × 3；若 `est >= 目标血` 且自己有 `refresh_on_kill` 技能 → +30；
- `archer`：3 格内有敌人 **-40**（只扣一次）；高地 +20；
- `strategist`：`max(0, 目标数 - 1) × 15`。

**_score_skill**：

- **伤害型**（含 phys_dmg 且 target = enemy）：对每个假想目标取 `_score_attack(mult, times)` + AOE 加分（strategist 每多 1 目标 +15）+ 谋士控制高价值加分（目标价值 >= 30 → +40），取 max；
- **治疗型**（含 heal）：`amount = mgc × mult`；对每个受伤友军 `min(amount, 缺口) × ai_heal_expect_factor(1.2)`；友军血比 < `ai_heal_urgent_threshold(0.35)` 再 +60；溢出 `-(amount - 缺口) × 0.3`；无人受伤 → **-99999**；再加 danger、aura；
- **增益/控制/功能型**：每覆盖 1 目标 +20；敌方目标另加目标价值与控制加分；目标是羁绊核心且自己 class ∈ {support, healer} → +25；无目标 → **-99999**；再加 danger、aura。

**_score_wait**：

```
5 + danger × w.danger + aura × 10 × w.aura_coverage + position × w.position - 最近敌距离 × ai_close_bonus(2)
```

### 14.3 ult_allowed（半自动绝技门，按职业）

| 职业 | 允许放绝技条件 |
|---|---|
| vanguard | 自身血比 < 0.4，或 2 格内敌人数 >= 3 |
| infantry / cavalry | 可击杀任一敌人，或一次命中 >= 2 |
| archer | 绝技目标中可击杀任意，或任意目标满怒 |
| strategist | 一次命中 >= 3 |
| healer | 任一友军血比 < 0.35，或友军平均血比 < 0.6 |
| support | 一次覆盖 >= 4 |

### 14.4 ai_weights.csv（7 职业 × 6 因子）

| class | damage_expect | kill_bonus | target_value | danger | aura_coverage | position |
|---|---|---|---|---|---|---|
| vanguard | 0.6 | 0.5 | 0.4 | 0.5 | 1.0 | 1.5 |
| infantry | 1.0 | 1.0 | 1.0 | 1.0 | 0.5 | 1.2 |
| cavalry | 1.1 | 1.3 | 1.2 | 0.8 | 0.5 | 1.0 |
| archer | 1.0 | 1.1 | 1.2 | 1.5 | 0.5 | 1.5 |
| strategist | 0.9 | 0.8 | 1.0 | 1.8 | 1.2 | 1.0 |
| healer | 0.2 | 0.1 | 0.2 | 2.0 | 1.0 | 0.8 |
| support | 0.4 | 0.5 | 0.6 | 1.5 | 2.0 | 1.0 |

缺行退回全 1.0 并告警。

---

## 15. battle_constants.csv（54 键全表）

| key | value | 说明 |
|---|---|---|
| rage_on_hit_taken | 10 | 受击回怒（D7 占位） |
| rage_on_kill | 30 | 击杀回怒 |
| rage_on_wait | 15 | 待机回怒 |
| rage_on_skill | 10 | 施放技能回怒（与效果串自带 rage() 不重复） |
| ai_kill_base | 50 | AI 击杀基准分 |
| ai_focus_bonus | 100 | AI 集火目标加分 |
| ai_danger_base | -30 | AI 危险度基准分（预估承伤÷自身HP×基准） |
| ai_close_bonus | 2 | AI 待机向敌接近每格加分（D26 占位） |
| ai_aura_coverage_factor | 10 | AI 光环覆盖每队友加分系数 |
| ai_wait_base | 5 | AI 待机基准分 |
| ai_target_value_default | 15 | 目标价值：support/未列明职业占位 |
| ai_target_value_healer | 30 | 目标价值：医者 |
| ai_target_value_strategist | 25 | 目标价值：谋士 |
| ai_target_value_dps | 20 | 目标价值：神射/步军/马军 |
| ai_target_value_vanguard | 10 | 目标价值：先锋 |
| ai_target_value_low_hp | 20 | 目标价值：残血加成上限 |
| ai_target_value_full_rage | 15 | 目标价值：满怒高威胁次要加分 |
| ai_target_value_bond_core | 15 | 目标价值：羁绊核心标记加分 |
| ai_pos_backstab | 20 | 站位奖励：背刺 |
| ai_pos_side | 10 | 站位奖励：侧击 |
| ai_pos_highground | 15 | 站位奖励：高地 |
| ai_heal_expect_factor | 1.2 | 有效恢复期望系数 |
| ai_heal_urgent_threshold | 0.35 | 濒危血量比例阈值 |
| ai_heal_urgent_bonus | 60 | 濒危队友加分 |
| ai_heal_overheal_factor | 0.3 | 治疗溢出扣分系数 |
| ai_buff_target_base | 20 | 增益/控制技能每覆盖 1 人加分 |
| ai_support_buff_core | 25 | 辅助增益命中羁绊核心每人加分（医者退化同口径） |
| ai_vanguard_cover | 10 | 先锋掩护每队友加分 |
| ai_vanguard_cover_line | 25 | 先锋落点在敌我连线格加分 |
| ai_infantry_backstab | 20 | 步军背刺位加分 |
| ai_cavalry_charge_per_cell | 3 | 马军冲锋每格加分 |
| ai_cavalry_refresh_kill | 30 | 马军预计击杀刷新加分 |
| ai_archer_safe_dist | 3 | 神射安全距离（格） |
| ai_archer_danger_penalty | -40 | 神射安全距离内有敌人扣分 |
| ai_archer_highground | 20 | 神射高地加分 |
| ai_strategist_aoe_per_extra | 15 | 谋士 AOE 每多覆盖 1 敌加分 |
| ai_strategist_control_high_value | 40 | 谋士控制命中高价值目标每人加分 |
| ai_obj_danger_factor | 0.5 | 关卡目标行为危险度折算系数 |
| ai_collect_interact | 120 | 夺取：相邻物件夺取基准分 |
| ai_collect_approach_base | 100 | 夺取：接近物件基准分 |
| ai_collect_approach_cell_cost | 2 | 夺取：每格距离扣分 |
| ai_escort_base | 250 | 护送：趋向目标区基准分 |
| ai_escort_cell_cost | 3 | 护送：每格距离扣分 |
| ai_wine_stall_arrive | 150 | 蒙汗药酒：到达酒摊基准分 |
| ai_wine_stall_approach_base | 140 | 蒙汗药酒：接近酒摊基准分 |
| ai_wine_stall_cell_cost | 2 | 蒙汗药酒：每格距离扣分 |
| ai_obstacle_attack_base | 3 | 打拒马基准分（无普攻候选时的低优先级备选） |
| ai_ult_vanguard_hp | 0.4 | 半自动绝技：先锋自身血量比例阈值 |
| ai_ult_vanguard_near | 3 | 半自动绝技：先锋近身敌人数阈值 |
| ai_ult_dps_min_targets | 2 | 半自动绝技：步军/马军一次命中数阈值 |
| ai_ult_strategist_min_targets | 3 | 半自动绝技：谋士一次命中数阈值 |
| ai_ult_healer_urgent_hp | 0.35 | 半自动绝技：医者濒危队友血量阈值 |
| ai_ult_healer_avg_hp | 0.6 | 半自动绝技：医者队友平均血量阈值 |
| ai_ult_support_min_targets | 4 | 半自动绝技：辅助覆盖人数阈值 |

代码侧仅保留缺表时的 fallback 并告警。

---

## 16. Command 管道

`submit_command(cmd)`：状态 → `EXECUTING` → `events = cmd.execute(battle)` → 追加 `PassiveSystem.after_command` → 发 `command_executed(cmd, events)` → `_fan_out_trigger_events(events)` → 状态回 `IDLE` / `AI_TURN`。

### 16.1 MoveCommand(actor, path)

- `path` **含起点**，之后逐格路径；dest 必须 `can_stop`；
- 激活窗口内 `path_cost > move_points_left` 拒绝；扣减并置 `move_used`；
- 更新占位与朝向；产 `move` 事件 `{unit, from, path}`。

### 16.2 AttackCommand(actor, target, skill, target_cell)

- `target_cell` 有效（指向可破坏障碍格）→ 打障碍：`amount = max(1, actor.get_atk())`（**障碍无防/闪/格/暴**），`obstacle_hp -= amount`，归零 `set_terrain(plain)`；产 `obstacle_damage` 事件 + 摧毁时 `terrain_change` 事件 `{coords, from, to}`。
- 否则：朝向目标 → `EffectSystem.execute`（**普攻不经 Targeting.resolve 校验合法性，由 UI/AI 前置校验**）。

### 16.3 SkillCommand(actor, skill, aim)

1. 校验 `can_use_skill`（`rage >= rage_cost && cooldown <= 0`）；`Targeting.resolve`（**空目标报错**，不消耗任何东西）。
2. **先扣怒气**（先付费后战斗，D25：技能过程中的击杀回怒累积到扣后余额）。
3. 施放成功 `+rage_on_skill`（10）（规则回怒，不走效果串）。
4. 逐目标 `EffectSystem.execute`（带 `effect_mult` 与 `signature_morph`）。
5. **后处理**：
   - `refresh_on_kill` 且本次击杀任意目标 → `actor.extra_action_pending = true`；
   - `extra_action(n)` → 目标中**同队存活友军按 av 升序前 n 名 av = 0**，产 `extra_action` 事件 `{target}`；
   - `set_cooldown`（技能成功施放后设置）。

### 16.4 WaitCommand(actor)

`+rage_on_wait`（15）；挂 `wait_def` buff（def +20%、1 回合、不可驱散）；产 `wait` + `rage` 事件。

### 16.5 InteractCommand(actor, target)

- `can_channel`：目标 `is_object` 且存活、actor 非物件、未在引导、**曼哈顿距离恰好 == 1**。
- 执行：`actor.channeling = target`，消耗本回合行动（UI 置 `action_used`），产 `channel_start` 事件 `{unit, object}`。
- **下次自己回合开始收讫**（advance_turn 第 8 步）；引导期间**受任何伤害立即打断**（含 DoT）。

### 16.6 ItemCommand(actor, item, target_unit?, aim)

- `can_use_item`：存活、`!action_used`、`item_uses_left > 0`。
- `item.to_skill_data()` 投影成技能数据走 Targeting（**指定 target_unit 时必须 ∈ 合法目标列表且只对其生效**；脚本化不传 target 退回技能同口径）。
- **先扣次数** → 产 `item_use` 事件 → 逐目标 `EffectSystem.execute` → **内部自置 `battle.action_used = true`**。
- **不触发攻击类被动**；道具效果禁用 `refresh_on_kill / extra_action`（validate 硬校验）；**AI 不使用道具**。

---

## 17. 表现事件全集

### 17.1 事件类型（逻辑层产出，表现层订阅回放）

| 类别 | type | 字段 |
|---|---|---|
| 伤害 | `damage` | source, target, skill, amount, crit, blocked, dir_mod, height_mod, died（斩杀另带 executed） |
| 伤害 | `dodge` | source, target, skill |
| 伤害 | `miss` | source, target, skill（hit_rate 未中，整技能对该目标 miss） |
| 位移 | `move` | unit, from, path |
| 位移 | `pull` / `push` | target, cells, to |
| 位移 | `teleport` | unit, from, to |
| 位移 | `swap` | source, target |
| 状态 | `status` | target, status, duration |
| 状态 | `status_resist` | target, status |
| 增益 | `buff` | target, buff(buff_id), field, value, duration |
| 增益 | `buff_expired` | unit, buff |
| 增益 | `dispel` | target, removed（被驱 buff_id 列表） |
| 增益 | `steal` | from, count, stolen |
| DoT/HoT | `dot` | unit, buff, amount |
| DoT/HoT | `hot` | unit, buff, amount |
| 地形 | `terrain_heal` | unit, terrain(camp), amount |
| 地形 | `terrain_dot` | unit, terrain(fire), amount |
| 机制 | `heal` | source, target, skill, amount |
| 机制 | `rage` | unit, value |
| 机制 | `av_mod` | target, value |
| 机制 | `summon` | object, unit?, cell?, ok |
| 机制 | `aura` | holder, radius, mods |
| 机制 | `wait` | unit |
| 机制 | `item_use` | unit, item, … |
| 机制 | `extra_action` | target |
| 机制 | `passive_trigger` | unit, skill, … |
| 机制 | `turn_skipped` | unit |
| 机制 | `channel_start` | unit, object |
| 机制 | `collect` | unit, object, … |
| 机制 | `collect_failed` | unit |
| 机制 | `obstacle_damage` | unit, coords, … |
| 机制 | `terrain_change` | coords, from, to |
| 机制 | `bond` | unit, partner, name |

### 17.2 Unit 信号（JS 可做事件/回调）

- `died(unit)`（hp 归零）；`channel_interrupted(unit)`（引导受击打断）。

### 17.3 BattleManager 信号

`turn_started(unit)` / `turn_ended(unit)` / `battle_ended(winner_team)` / `round_started(round_count)` / `dialogue(text)` / `state_changed(new_state)` / `command_executed(command, events)` / `tick_events(unit, events)` / `unit_died(unit)` / `deploy_changed`。

---

## 18. 边界规则（22 条，逐条对应实现）

1. **连击独立结算**：`phys_dmg(0.9)x4` 每段独立掷闪避/暴击/格挡、独立产事件。
2. **反击规则**：depth==0 才反击；depth=1 再结算防互反；反击产怒气；事件 skill 仍是原技能 id；射程按目标武器（含脚下 range_mod）。
3. **guard 只挡远程**：施法者与目标曼哈顿 > 1 才触发援护；近战不触发；guard 不拦反击。
4. **怒气来源与上限**：普攻 +20（效果串 rage()）/ 施放技能 +10（规则）/ 待机 +15 / 受击 +10 / 击杀 +30；clamp(0, 100)。
5. **大招 rage_cost = 100**（ult 类技能 CSV 全为 100）。
6. **两种再动**：`refresh_on_kill`（击杀后 extra_action_pending，finish_turn 时 av=0 不 reset_av）与 `extra_action(n)`（友军按 av 升序前 n 名 av=0）；`av_mod(v)` 是第三种 AV 操作（×=1+v）。
7. **道具**：有限次数、借道技能结算（to_skill_data → Targeting/EffectSystem）、**禁 refresh_on_kill/extra_action**、不触发被动、不产施放怒气。
8. **interact**：距离**恰好 == 1**；消耗行动；**下次自己回合开始收讫**；引导期间受任何伤害打断（含 DoT）。
9. **睡眠**：受任何伤害立即醒；`alert` 特性首次睡眠 `min(n, 1)`。
10. **眩晕 1 回合恰好跳过一次**：依赖 advance_turn"**先判 can_act、后减 duration**"次序。
11. **DoT 致死递归跳过**：阶段一死亡 → 发 tick_events 后递归 advance_turn，本激活整个不存在。
12. **CTB 平局用基础 spd**（data.spd，不含 buff）。
13. **preview 与 reset_av 不一致**：preview 假设 `1000 / max(1, data.spd)`（基础），reset_av 用 `1000 / get_spd()`（含 buff）——**保留此差异**。
14. **普攻只认 ENEMY 队**；collectable 物件不可被任何攻击/技能指定（三处排除）。
15. **PLAYER 与 NPC_ALLY 互不敌对、互不算 ally**：enemy 过滤按 `(team==ENEMY)` 异或；heal 等 ally 目标要求**同 team**。
16. **拒马**：伤害 = 攻击者 atk、保底 1；归零地形变 `plain`（走 Grid.set_terrain，寻路自动刷新）；AI 只在打不到任何敌人时打，固定 3 分。
17. **高地两套机制**：`height_map` 影响**伤害**（+15% / -10%）与 AI 站位加分；`terrain.range_mod` 只加**射程上限**（山地 +1），按站立格实时计算，含反击判定。
18. **水面**：move_cost 3、def -10%、当回合移动 -1；`water_walker` 全免（进入消耗按 1、不吃移动 -1）。
19. **hit_rate vs sure_hit**：`hit_rate(p)` = 整技能**逐目标** roll，未中整串 miss；`sure_hit` 只跳过闪避判定，伤害/暴击/格挡照常。
20. **friendly_fire 误伤**：按概率把范围内同队友军卷入目标列表；**AI 评估敌方技能时滤掉被卷入的友军**。
21. **位移边角**：`swap_position` 零校验直接换位；`summon` 按 DIRS 序取首个可站立邻格；`aura` 挂召唤物（无则自身）99 回合；`steal_buff` target=self 时改偷最近敌人；`teleport` 落点为菱形内"距最近敌人曼哈顿最小"的可站立格。
22. **其他**：take_damage 对同一单位重复 died 的边缘（多段伤害鞭尸）JS 版加 **alive 防护**；触发器 `_kill_teams` 只记 `damage` 事件 source 的队伍；**未知效果必须报错**，`KNOWN_EFFECTS` 白名单同时用于数据校验。
