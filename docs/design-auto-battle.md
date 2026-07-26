# 刀塔传奇式横版自动战斗 —— 正式设计方案

> **状态：✅ 已确认 · 正式设计（2026-07-27）**。本方向已经可运行原型验证，项目战斗玩法确定为刀塔传奇版本。
> **决策**：废弃两个旧试验战斗系统（战棋 SRPG 网格回合制、劫寨 Demo），已归档至 `archive/`（见 `archive/README.md`）。
> **现行实现**：`src/prototype/`（逻辑层 `sim.js` 纯逻辑可 node 无头跑；表现层 `side_battle.js`）+ `src/shared/`（CSV/效果串解析）。运行入口 `battle-proto.html`。
> 原则：逻辑/表现分离、CSV 唯一数据源、指令管道统一、随机走注入式 RollSource。
> 范围：本文只负责「战斗玩法」设计；网格退化为大地图/探索层（不在本文展开）。
> 旧移植规格书已归档至 `archive/grid-srpg/docs/`（`spec-battle.md` 等），仅作历史参照。

---

## 0. 决策与验证结论

- **核心机制已确认**：怒气(`rage`)→大招(`ult`)、`RollSource` 随机、事件数组回放、养成倍率（技能等级）。
- **原型已验证「手动大招是胜负手」**：同一阵容、同一随机种子，唯一变量是「大招时机」——手动放大招 10.7s 胜、全程不放 13s 负。
- **已在原型落地的进阶机制**：前后排（近战打前排/远程切后排/后排承伤-10%）、**克制矩阵**（archetype 打分驱动选敌）、**大招连锁**（3s 窗口连放叠 +20%/层）、**觉醒技**（条件自动触发）、效果串解释器（30+ 效果，与正赛 `skills.csv` 同语法）。
- 原方案（路线 A 纯横版替换）的工程量判断成立：核心伤害公式、效果串、随机源、怒气/大招、养成倍率均复用，主要工程在「横版实时 tick 调度 + 表现层」。

---

## 0.1 复用结论（已兑现）

刀塔传奇最灵魂的部分——怒气(`rage`)→大招(`ult`)、`RollSource` 随机、事件数组回放、养成倍率——在旧战棋核心层早已具备，本方案据此成立。路线 A 的工程量主要在**两处重写**：① 把「网格 + CTB 回合」换成「横版 + 实时 tick 调度」；② 把表现层换成横版场景。核心伤害公式、效果串(`parse_effects`)、随机源、怒气/大招、养成倍率**均已复用**（CSV/效果串解析已迁移至 `src/shared/`，逻辑层为 `src/prototype/sim.js`）。

---

## 1. 核心玩法循环（横版）

| 要素 | 刀塔传奇 | 本方案对应 |
|---|---|---|
| 阵营 | 双方各最多 5 英雄 | 沿用 `Team` 枚举（PLAYER/ENEMY/NPC_ALLY），每方最多 5 |
| 站位 | 前排坦克 / 后排输出·辅助 | 新增 `formation.csv`：每个单位标 `row=front|back`、`slot=0..4` |
| 移动 | 自动向最近敌人靠拢 | 实时 tick 推进，单位向目标 x 方向连续趋近（无自由走位） |
| 普攻 | 自动，进射程即打 | 复用 `generic_melee/ranged`，自带 `rage(+20)` |
| 小技能 | 自动循环（CD 到点放） | 新增 `auto_skill_policy.csv` 控制释放时机 |
| 大招 | **手动点击释放** | 沿用 `W 绝技`、`rage_cost=100`；手动模式等玩家点击，半自动走 `ult_allowed` |
| 胜负 | 一方全灭 | 复用 `evaluate_outcome`（WIPE_OUT 为主，其余条件重定义见 §7） |

**战斗时间轴**：开场 → 单位自动寻敌/普攻/放小技能（怒气持续累积）→ 怒气满 → 大招就绪 → 玩家手动释放（时机=策略）→ 一方全灭 → 结算掉落。

> 这正对应你已有的 `怒气 → 大招` 循环（见 `spec-battle.md` 第 18 条边界规则 4/5），逻辑层无需重造。

---

## 2. 战场模型：横版 vs 网格

沿用约定：坐标仍用 `{x, y}` 普通对象，格子键 `"x,y"`。但语义改变：

- **x（横轴）**：站位进度。我方在左、敌方在右；单位向目标 x 方向连续移动。攻击范围用「横向身位间隔」判定，替代曼哈顿距离。
- **y（前后排）**：`y=0` 前排、`y=1` 后排（或 lane 偏移）。**前排阻挡后排**：近战只能打同 x 区间前排；后排仅被远程/溅射/AOE 命中（line-of-sight 简化）。
- **距离口径**：`dist = |a.x - b.x|`（横向），替代 `|dx|+|dy|`。`ring` 切比雪夫模板在横版退化为「同排 ±N 身位」。

### 2.1 需要重映射的网格机制

| 原机制（spec-battle） | 横版处理 |
|---|---|
| `height_mod`（高地 +0.15 / -0.10） | 改为 `row_mod`：**前排承伤 +0.10**（暴露），**后排 -0.10**（受保护）；数值放 `battle_constants.csv` 新增键 `row_front_mod` / `row_back_mod` |
| `direction_mod` 背刺/侧击/正面 | 保留语义：攻击者位于目标**背后**（目标 facing 与攻击来向同向）→ 背刺 +0.25；侧翼夹击（前后排同时有人打同一目标）→ 侧击 +0.10；正面 0。横版 facing 只有左/右，背刺=从目标背后方向攻击 |
| `can_pass/can_stop`（友军可穿） | 横版无格子阻挡，改为「同排不重叠」约束：单位不能越过友军站位 |
| 水域/拒马/可破坏障碍 | 路线 A 暂不移植；若需要，做成横版「地形格」占位（后续扩展） |

---

## 3. 数值框架（CSV，唯一数据源）

### 3.1 复用现有常量（`battle_constants.csv`）
怒气与暴击/格挡完全照搬，不重造：

```
rage_on_hit_taken = 10     # 受击回怒
rage_on_kill      = 30     # 击杀回怒
rage_on_wait      = 15     # 待机回怒（横版可改为「脱战回怒」）
rage_on_skill     = 10     # 施放技能回怒
CRIT_MULT         = 1.5
BLOCK_REDUCE      = 0.3
```

新增横版专用键：
```
row_front_mod = 0.10        # 前排承伤修正（加算乘区，同 dir_mod 口径）
row_back_mod  = -0.10       # 后排承伤修正
auto_attack_interval_base = 1.0   # 普攻基础间隔（秒），受 spd 缩放
```

### 3.2 新增数据表（`data/`）

**`formation.csv`** —— 每场战斗的编队与站位：
```
battle_id, side, unit_id, row, slot, hero_ref
arena_01,  player,  linchong, front, 0, linchong_hero
arena_01,  player,  wuyong,    back,  1, wuyong_hero
arena_01,  enemy,   zhiwenlong, front, 0,
```

**`auto_skill_policy.csv`** —— 小技能自动释放条件（替代玩家手动 Q）：
```
skill_id, release_cond, param
song_jiang_q, hp_below_self, 0.5        # 自身血量<50% 才放
wu_yong_q,   enemy_count_in_range, 2    # 射程内>=2 敌人才放
lu_zhishen_q, always, 0                 # CD 好就放
```
> 解析沿用 `KNOWN_EFFECTS` 白名单思路，未知 `release_cond` 必须报错。

**`growth_curve.csv`** —— 养成成长曲线（等级/星级/装备 → 面板）：
```
unit_id, stat, base, per_level, per_star, per_equip
linchong, hp,  800, 60, 200, 150
linchong, atk, 120, 8,  30,  20
```
> `hero` 养成数据（`spec-meta.md`）与 `effect_mult`（技能等级倍率）已就绪，本表只补「等级/星级/装备 → 基础面板」这一段。

---

## 4. 技能三档（普攻 / 小技能 / 大招）

效果串语法 `parse_effects`、白名单 `KNOWN_EFFECTS`、结算管线 `EffectSystem.execute` **全部复用**，只改「谁触发、何时触发」。

| 档位 | 触发方 | 怒气 | 实现 |
|---|---|---|---|
| **普攻** | 自动 | `+20`（自带 `rage(+20)`） | 复用 `generic_melee`(adjacent) / `generic_ranged`(diamond 2-5)；进射程即 `AttackCommand` |
| **小技能(Q)** | 自动 | 视效果串 `rage()` | `auto_skill_policy.csv` 满足即 `SkillCommand`；CD 走现有 `cooldowns` |
| **大招(W/ult)** | **手动** | 消耗 `rage_cost=100` | 玩家点击 → `SkillCommand`；怒气未满则按钮置灰；半自动模式 `ult_allowed` 门控（沿用 `spec-battle.md` §14.3 职业表） |

> 怒气来源、上限、`rage_cost=100` 全部来自现有实现（spec §18.4/18.5），不改。

---

## 5. 自动战斗 AI（实时 tick 驱动）

### 5.1 调度模型：用「实时调度」替换 CTB
现有 `TurnOrder`（CTB，`av=1000/spd`）改为**每单位独立攻击冷却 + 实时 tick 循环**：

- `core/auto_battle.js` 新类，持有 `BattleManager` 状态（复用 `DEPLOY→...→BATTLE_END` 状态机，去掉 `AI_TURN/IDLE` 的玩家手动等待）。
- `update(dt)`：对每个存活单位累加 `atk_timer`；`atk_timer >= interval(spd)` 且目标在射程 → 自动生成 `AttackCommand` 或按 policy 生成 `SkillCommand`，经 `submit_command` 瞬时结算、产事件。
- 移动：每 tick 朝目标 x 方向移动 `speed*dt` 身位（连续），到达射程停止。
- **纯逻辑、无 three.js/DOM**：`update(dt)` 只是数字推进；表现层按帧调用并消费 `command_executed` 事件流。
- **可复现 + 可测**：随机全走 `RollSource`；测试用 `FixedRollSource` 跑完整对局断言结果。

### 5.2 决策复用 `BattleAI` 思路
- **选目标/集火**：复用 `BattleAI._score_attack` 的期望伤害与 `focus_target` 集火逻辑，但去掉「落点枚举」（横版无自由走位），只做目标选择。
- **小技能 policy**：`auto_skill_policy.csv` 的条件求值（血量阈值、射程内敌人数）映射到现有 `_usable_skills` + 条件判断。
- **大招**：AI 单位 / 半自动模式下，按 `ult_allowed`（§14.3 职业表）自动放；玩家单位在手动模式下**搁置**，等 `request_ult(unit)` 由 UI 调用。

### 5.3 手动大招接口
```js
// core 暴露，UI 点击大招按钮时调用
autoBattle.request_ult(unit_id) {
  if (unit.rage < 100) return false;        // 按钮置灰已由 UI 处理
  submit_command(new SkillCommand(unit, ult_skill, aim));
  return true;
}
```
> 不破坏「指令管道统一」红线：`request_ult` 只是生产者，最终仍走 `submit_command` → 事件回放。

---

## 6. 实时性如何守住「逻辑瞬时结算」红线

红线原文：*一次指令同步算出全部结果事件；表现层只订阅事件回放，不反向影响逻辑。*

路线 A 的两种实现选型：

- **选型 A（推荐）：实时交互式**。`core` 跑 `update(dt)` 循环，每个动作仍「瞬时结算 + 产事件」；大招由玩家实时 `request_ult` 触发。逻辑层不依赖时钟/渲染。最贴合现有 `submit_command` 语义，手动大招自然。
- 选型 B：模拟到结束产时间轴。`core` 一次性算出整场事件流（含预设的 AI 大招决策），表现层按时间轴播放。实现最简单，但**手动大招时机**需要「玩家输入回灌」机制，交互性弱。

→ 选 **A**：既保留手动大招策略点（刀塔传奇灵魂），又完全符合红线。

> **评审修正（P0-1 确定性）**：`update(dt)` **不得用浮点 dt 直接推进**，否则两次模拟不一致、违反「可复现」红线、测试 flaky。改为**定长整数 tick**：内部以固定步长（如 100ms）推进，计时器/冷却/攻速全用整数（毫秒 tick 数）或定点数；表现层只把 tick 号映射成动画时间轴。测试用 `FixedRollSource` + 固定 tick 序列驱动，逐 tick 断言事件，保证可复现。

---

## 7. 关卡适配（网格关 → 横版关）

现有 25 关（`spec-data.md`）是网格关，需迁移为「编队 + 敌方编队 + 站位」配置：

| 现有机制 | 横版重定义 |
|---|---|
| 网格地形/高度图 | 移除；站位由 `formation.csv` 决定 |
| `win_condition` | `WIPE_OUT`（敌全灭）保留；`SURVIVE_TURNS` 保留（撑过 N 秒）；`COLLECT/ESCORT/OCCUPY` 在横版无格子，**改为波次(WAVE)制**：清完一波刷下一波，全清即胜 |
| `lose_condition` | `WIPED_OUT`（我全灭）、`TURN_LIMIT`（超时）保留 |
| 触发器 `on: TURN` | 改为 `on: WAVE`（每波开始）/`on: START` |
| `evaluate_outcome` | 复用次序，仅把格子相关条件替换为波次/计时 |

> 波次系统新增 `waves.csv`：`battle_id, wave, enemy_units..., spawn_delay`。

---

## 8. 养成接入（品质不设上限 · 技能差异化）

> **核心变更**：取消「品质决定强度上限」。所有武将都能培养到最高品质，武将之间只用**技能组**区分。详见姊妹篇 **`design-hero-skills.md`**。

- **品质 = 培养阶段，不是天花板**：品质仅表初始获取稀有度；统一阶梯 `绿→蓝→紫→橙→红(无双)`，每阶解锁技能内容（被动1/被动2/觉醒技/技能等级上限），不解锁数值天花板。
- **数值成长**：`growth_curve.csv` 改为「等级 + 培养阶」二维统一公式（同职业同曲线，橙将不天生面板高）。差异化 100% 来自技能组。
- **技能槽位**：普攻(自动) + 小技能(自动, policy) + 大招(手动, rage 100) + 被动1/被动2(紫阶解锁) + **觉醒技(橙阶解锁)**。与现有 `skills.csv` 的 `act + ult + 2×pas` 骨架一一对应，大量沿用。
- **平衡基石**：无数值上限后靠**技能克制矩阵**制衡（控制克输出、驱散克增益、刺客克后排、斩杀克回复），见技能文档 §5。
- **羁绊**：沿用 `BondSystem`（`bond_*` buff）作横向搭配维度。
- **掉落/资源**：结算 `compute_result` 的 `first_clear/regular` 奖励框架复用，数值按横版重新配 `progress.csv`。

---

## 9. 改动点清单（按文件）

### 9.1 新增
| 文件 | 职责 |
|---|---|
| `src/core/auto_battle.js` | 实时 tick 调度器（替代 `TurnOrder` 的 CTB 推进）、`update(dt)`、`request_ult()` |
| `src/core/auto_ai.js` | 横版自动决策：目标选择、小技能 policy 求值、大招 `ult_allowed` |
| `src/core/formation.js` | 解析 `formation.csv`、站位初始化、前后排阻挡判定 |
| `data/formation.csv` | 编队与站位 |
| `data/auto_skill_policy.csv` | 小技能自动释放条件 |
| `data/growth_curve.csv` | 养成成长曲线 |
| `data/waves.csv` | 波次配置 |
| `src/render/side_battle.js` | 横版场景、单位 sprite、按事件流做动画回放 |
| `src/ui/ult_hud.js` | 大招能量条 + 按钮、手动/半自动切换 |

### 9.2 修改（最小改动）
| 文件 | 改动 |
|---|---|
| `src/core/battle_manager.js` | 新增横版状态分支（或新 `AutoBattle` 组合 `BattleManager`）；移除非横版需要的网格部署流程 |
| `src/core/targeting.js` | 距离口径从曼哈顿改为横向 `|dx|`；`ring` 模板改同排 ±N |
| `src/core/damage_calculator.js` | `height_mod` → `row_mod`（前后排），数值走 `battle_constants.csv` |
| `src/core/unit.js` | 移除网格专属字段（`facing` 简化为左右；`move_points` 改为连续 speed）；保留 `rage/buffs/cooldowns` |
| `src/core/effect_system.js` | 不动（效果串复用） |
| `src/core/roll_source.js` | 不动 |
| `src/core/data_loader.js` | 新增上述 CSV 的加载与校验 |

### 9.3 测试（tests/）
- `tests/auto_battle.test.js`：固定 `RollSource` 跑完整对局，断言胜方、事件数、怒气曲线。
- `tests/auto_ai.test.js`：断言目标选择/集火/小技能 policy/大招门控符合预期。
- `tests/formation.test.js`：前后排阻挡、射程判定。

---

## 10. 风险与权衡

1. **实时回放 vs 瞬时结算**：选「实时交互式」(§6 选型 A)，手动大招自然，逻辑仍纯函数式、可测。
2. **网格机制损耗**：背刺/侧击/高地 → 简化为前后排 + 侧翼；水域/拒马/可破坏障碍横版暂不移植（可后续做横版地形格扩展）。
3. **工作量**：路线 A 是三条路线里最大的——等于重写表现层 + 部分 AI + 25 关数据迁移。但核心 `rage/ult`、伤害公式、效果串、`RollSource`、养成倍率**零重写**，这是主要降本点。
4. **表现层耦合**：`render/` 需完全新建横版场景；务必只消费 `command_executed` 事件流，不反向写逻辑（守红线）。

---

## 11. 落地里程碑

1. **数值框架 + CSV 表**（不动逻辑）：`formation/auto_skill_policy/growth_curve/waves` 四表 + `data_loader` 校验。
2. **core 实时 tick + 自动 AI**：`auto_battle.js` / `auto_ai.js` / `formation.js`，单测覆盖（固定 `RollSource` 复现）。
3. **表现层横版场景 + 事件回放**：`side_battle.js` 消费事件流做动画。
4. **大招 HUD + 手动/半自动切换**：`ult_hud.js`，按钮置灰/能量条/`ult_allowed` 门控。
5. **关卡数据迁移**：先迁前 3 关验证波次 + 站位 + 胜负。
6. **养成接入**：`growth_curve` + `effect_mult` 接 `hero` 数据，跑完整养成链路。
7. **技能体系**（见 `design-hero-skills.md`）：品质阶段解锁、13 个新效果入白名单、30 武将技能组/觉醒技、克制矩阵接入 `auto_ai.js`。

---

## 12. 评审记录与待办（自审）

> 对本文做了一次挑刺式自审，按严重度列出问题与处置。技能侧详见 `design-hero-skills.md`。

**P0（不改会出事）**
- [x] **确定性**：`update(dt)` 浮点推进 → 改定长整数 tick（已在 §6 修正）。
- [x] **平衡**：取消品质上限后数值无天花板 → 建立**技能克制矩阵**（技能文档 §5）作平衡基石。
- [ ] **操作密度**：全程只点一次大招会像看片 → 补三个玩家杠杆：**集火指令**（沿用 `focus_target`）、**大招连锁**（多名武将怒满可连放/攒怒）、**能量运营**（`energy_drain` 等）。待细化进 `ult_hud.js`。

**P1（影响手感/深度）**
- [ ] **前后排过简**：已补纵深规则（近战打同排/远程越前排/刺客突后排/嘲讽护后排），见技能文档 §3；落到 `formation.js` 与 `targeting.js`。
- [ ] **横版效果缺口**：`teleport/swap_position/move_mod/extra_action` 需重表达，另需新增 `taunt/expose/dash_back/silence/shield/lifesteal/revive/energy_drain/haste/act_now/knockback/invuln_dying/heal_cut` → 见技能文档 §7（**扩 `KNOWN_EFFECTS` 白名单**，碰红线，须同步单测）。
- [ ] **敌方 AI 大招时机**：半自动只有 `ult_allowed` 门控 → 全自动需加「留大招反制 / 斩杀收割 / 按克制矩阵选目标」，扩展 `auto_ai.js`。

**P2（内容厚度）**
- [ ] **关卡同质化**：波次制丢了 COLLECT/ESCORT/OCCUPY 叙事 → 补波次修饰词（增益/减益/限时）、Boss 阶段机制、场地危险（火焰/落石身位）。

---

## 附：与现有红线对照

| 红线 | 本方案遵守方式 |
|---|---|
| 逻辑/表现分离 | `core/auto_battle.js` 不 import three.js / 不碰 DOM；`render/side_battle.js` 只消费事件 |
| CSV 唯一数据源 | 所有数值（站位、policy、成长、波次）进 `data/*.csv`，逻辑不硬编码 |
| 指令管道统一 | 自动普攻/小技能/手动大招全走 `submit_command` → `command_executed` 事件 |
| 随机走 RollSource | 暴击/格挡/闪避/AI 概率全走注入源；测试用 `FixedRollSource` |
