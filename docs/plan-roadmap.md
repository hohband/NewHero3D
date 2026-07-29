# 水浒 3D · 刀塔传奇版战斗 —— 后续开发计划（实施交接版 · 修订 v2）

> **读者**：接手实现的 coder（非原作者）。本文自包含，读完即可开工。
> **项目方向**：战斗 = 刀塔传奇版本（横版实时自动战斗 + 手动大招时机），已确认（2026-07-27）。
> **必读配套**：`AGENTS.md`（工程红线）、`docs/design-auto-battle.md`（战斗正式方案）、`docs/design-hero-skills.md`（技能与养成正式方案）。
> **运行 / 测试**：`npm start` → http://localhost:8080（入口 `battle-proto.html`）；`npm test` → node 无头回归。
> **v2 修订说明**：根据首次评审修订——① 删除 `formation.csv`（玩家编队是存档数据，不进 CSV）；② 修正 §6 示例空格陷阱；③ 明确成长曲线公式与 `units.csv` 白值的分工；④ 明确波次继承规则；⑤ 托管简化为 `auto_ult` 单开关；⑥ 新增既有硬编码常量收口任务；⑦ 调整并行性建议。

---

## 1. 当前状态盘点（已有什么）

### 1.1 目录与文件职责
```
battle-proto.html          战斗运行入口（index.html 已重定向到这里）
src/
  prototype/
    sim.js                 【纯逻辑层·可在 node 跑】战斗模拟核心
    data.js                【纯逻辑层】CSV 装配：从 units/skills/awaken 建两队配置
    side_battle.js         【表现层】Three.js 场景 + HTML overlay HUD + 启动流程
  shared/
    csv.js                 parseCsvTable / toInt / toFloat / parseStringList / parseBonds
    effects.js             parseEffects / scanModifiers / KNOWN_EFFECTS / MODIFIER_EFFECTS
data/
  units.csv                30 武将面板（hp/atk/def/mgc/spd/crit/dodge/block/class/...）
  skills.csv               每将技能效果串（ult + act + 2×pas，语法见 effects.js）
  proto_awaken.csv         10 个觉醒技（unit_id,name,trigger,param,effects）
  battle_constants.csv     怒气/暴击/格挡等常量（rage_on_hit_taken=10、rage_on_kill=30 等）
  progression.csv          养成参数（key,value,desc：level_exp_base 等）
assets/models/             shiqian.glb（时迁真模型，可作表现层素材）
tests/test_prototype.js    无头回归（node --test）
archive/                   旧试验系统（战棋 grid-srpg / 劫寨 liangshan-raid），仅参考
```

### 1.2 已实现机制（原型已验证）
- 横版实时战斗：定长 tick（`SIM_STEP=0.1`）推进，单位自动寻敌/移动/普攻/放小技能。
- 前后排：`row=front|back`；近战（vanguard/cavalry/infantry）只能打前排，远程/法师/奶（archer/strategist/healer）可越前排打后排；后排承伤 -10%。
- 怒气→大招：攻击+20/受击+10/击杀+30/放技能+10，满 100 手动放（敌 AI 自动放）。
- 效果串解释器（30+ 效果）：phys/mgc_dmg、heal、rage、stun/sleep/paralyze/bind、pull/knockback、armor_break/def_up/dodge_up/block_up/buff、dispel、revive、taunt、silence_all、hot_aura、lifesteal、haste、execute_below、bonus_*、target_rule、random_target、friendly_fire、refresh_on_kill、sure_hit/hit_rate/chance。
- 闪避/格挡/暴击/buff 系统/三种被动（on_attack/on_hit/turn_start）。
- 克制矩阵（`_counterScore`：远程切后排脆皮、物理避坦克、优先断奶）、大招连锁（3s 窗口连放叠 +20%/层）、觉醒技（hp_below/on_ult/battle_start/always 触发）。
- **关键验证结论**：同阵容同种子，唯一变量是「大招时机」即定胜负（手动放胜 / 全程不放负）。

### 1.3 逻辑层关键接口（实现时直接用）
```js
import { Sim, Unit, makeRNG, CLS, SIM_STEP } from "./src/prototype/sim.js";
import { buildTeams } from "./src/prototype/data.js";
import { parseCsvTable, toInt, toFloat } from "./src/shared/csv.js";
import { parseEffects, scanModifiers, KNOWN_EFFECTS } from "./src/shared/effects.js";

const teams = buildTeams({ unitsCsv, skillsCsv, awakenCsv }); // → { player:[cfg], enemy:[cfg] }
const sim = new Sim(teams, seed);          // cfg 见 data.js buildUnit 返回结构
sim.step(dt);                              // 推进一个 tick（表现层用累加器按 SIM_STEP 驱动）
sim.castUlt(unit);                         // 手动大招（unit.rage>=100 才生效）
sim.units / sim.byId(id) / sim.events      // 状态与事件数组（表现层消费后 splice 清空）
```
Unit 运行时关键字段：`hp/maxHp/rage/x/z/alive/cc/silence/buffs/isMelee/isHealer/effAtk/effDef/effMgc/effCrit/effDodge/effBlock/effInterval/attackStat`。

> **注意**：当前 `data.js` 里 `PLAYER_IDS` / `ENEMY_IDS` 是写死的 5v5；技能兜底表 `FALLBACK_SMALL` / `FALLBACK_ULT` 只为这 10 将补全。后续做选将/全 30 将时要改这里。

### 1.4 已知技术债（本计划顺带清）
1. **怒气/连锁数值硬编码在 `sim.js`**：攻击+20、受击+10、击杀+30、连杀刷新+50、放技能+10、连锁 3s/+20% 全是字面量；`battle_constants.csv` 里 `rage_on_*` 键存在但没人读。→ 收口任务见 §3.0。
2. **白名单无强制校验**：`KNOWN_EFFECTS` 只是导出集合，`buildTeams` 不校验，未知效果不会报错（红线 6 未落地）。→ §4.1 补校验。
3. `battle_constants.csv` 残留网格 SRPG 的 `ai_*` 权重键（系统已归档），阶段三清理。
4. `heal` 目前不吃 `effectMult`（phys/mgc 已接）。→ §3.2 补。

---

## 2. 架构红线（必须遵守，否则拒收）

1. **逻辑/表现分离**：`sim.js`/`data.js`/`hero.js` 不得 import three.js、不得碰 DOM/window/localStorage，必须能在 node 直接跑（无头测试依赖此）。表现层只在 `side_battle.js` 与 `src/ui/`。
2. **CSV 唯一数据源**：数值只改 `data/*.csv`，装配走 `data.js`/共享解析，禁止在逻辑里硬编码数值。
3. **指令管道 + 事件回放**：逻辑瞬时结算产事件数组；表现层只消费事件做动画，不反向影响逻辑。
4. **随机走注入式 RNG**：用 `makeRNG(seed)`，不得直接 `Math.random`（表现层视觉抖动除外）。战斗要可复现。
5. **定长 tick**：逻辑用固定步长推进（整数毫秒/tick 或定点），不用浮点 dt 直接驱动核心判定。
6. **新效果必须入白名单**：`src/shared/effects.js` 的 `KNOWN_EFFECTS` 是数据校验依据；加效果要同步加白名单 + 单测；`buildTeams` 对未知效果**必须抛错**。

---

## 3. 阶段一：最小可玩闭环（关键路径）

> 目标：玩家能「选将 → 养成 → 推关」完整跑通，不再只是写死的镜像战。

### 3.0 常量收口（前置小任务）
- **目标**：消除 `sim.js` 字面量数值，全部走 `battle_constants.csv`。
- **任务**：
  1. `battle_constants.csv` 补键：`rage_on_hit=20`（攻击回怒）、`rage_refresh_kill=50`（连杀刷新）、`chain_window=3.0`、`chain_bonus=0.2`、`row_back_mod=-0.10`。
  2. `data.js` 装配 `consts` 对象传入 `Sim`；`sim.js` 全部改读 `this.consts.*`，禁止残留字面量。
  3. `skill_level_mult`、`bond_stat_bonus` 读 `progression.csv`（键已存在，见 §3.2/§4.2）。
- **验收**：grep `sim.js` 无怒气/连锁字面量；改 CSV 数值战斗结果随之变化（无头测试断言）。

### 3.1 选将 / 编队界面
- **目标**：从 30 武将选 5 人、设置前后排站位，作为战斗入口。
- **现状**：`data.js` 的 `PLAYER_IDS/ENEMY_IDS` 写死；无选将 UI。
- **关键决策（v2）**：**玩家编队不进 CSV**。编队是玩家私有状态，存存档（`src/ui/save.js`，localStorage，UI 层）；CSV 只描述敌方（`waves.csv`，见 §3.3）。**不设 `formation.csv`**。
- **任务拆解**：
  1. 存档模块 `src/ui/save.js`（新，**UI 层**，可碰 localStorage）：存档 key `shuihu3d_save_v1`，schema 见 §6。新档默认 30 将全解锁（lv1 / tier0）、默认编队 5 人、资源（经验/材料/金币）为 0。
  2. 重构 `data.js`：`buildTeams({ unitsCsv, skillsCsv, awakenCsv, growthCsv, constsCsv, playerFormation, enemyFormation, heroStates })`；`playerFormation/enemyFormation` = `[{ id, row, slot }]`；`heroStates` = `Map(id → { level, tier, skillLevels })`（缺省单位默认 lv1/tier3 满解锁，便于测试与敌方直接使用）；删除 `PLAYER_IDS/ENEMY_IDS`。
  3. 新增选将界面 `select.html` + `src/ui/select_screen.js`（DOM）：武将列表（读 units.csv，显示名/职业/定位/技能）、点选 5 人、指定前排/后排与 slot 顺序、确认后写存档并跳 `battle-proto.html`。
  4. 入口流程：`index.html` → 大厅（§4.4，阶段一可先做极简导航页）→ 选将 → 战斗页。
- **涉及文件**：`src/ui/save.js`(新)、`src/prototype/data.js`(改)、`select.html`(新)、`src/ui/select_screen.js`(新)、`index.html`(改)。
- **验收标准**：能任选 5 将 + 站位开战；`buildTeams` 对任意合法编队都能产出配置；无头测试：用 3 组不同编队分别跑通一场战斗分出胜负；**同步更新既有 `tests/test_prototype.js` 到新签名**（`buildTeams` 改签名必然打破旧用例）。

### 3.2 养成系统接入（品质不设上限 · 技能区分）
- **目标**：实现「统一培养阶梯 + 技能等级 + 觉醒解锁」的养成钩子。
- **现状**：`progression.csv` 有养成参数；`effectMult` 已进 `_exec` 签名（phys/mgc 已接、heal 未接），但无技能等级来源。
- **成长公式（v2 明确，二选一歧义已消除）**：
  - `data/growth_curve.csv` 按**职业 × 属性**给曲线（schema 见 §6），公式：`stat = base + per_level × (level-1) + per_tier × tierIndex`（tierIndex：绿0/蓝1/紫2/橙3/红4）。
  - **分工**：hp/atk/def/mgc 四项面板由 `growth_curve.csv` 供给（同职业同曲线，契合"差异化 100% 来自技能组"）；crit/dodge/block/spd 保留 `units.csv` 逐将个性值；`units.csv` 的 hp/atk/def/mgc 列降级为**无曲线行时的兜底**（Boss/特殊单位用）。
  - **两轴区分（v2 明确）**：`units.csv.quality` = 先天稀有度（收集难度，仅展示）；**培养阶 tier** = 后天培养（存档数据），技能槽解锁只按 tier 判定。文档与代码命名不得混用。
- **任务拆解**：
  1. 新增 `data/growth_curve.csv`：7 职业 × 4 属性，base 取 `units.csv` 现值职业均值，per_level ≈ base 的 7–8%，per_tier ≈ base 的 25%（取整）。
  2. 新增 `src/prototype/hero.js`（纯逻辑）：`HeroState { id, level, tier, skillLevels:{small,ult} }`；`computePanel(cls, state, curveRows, unitRow)` → 面板；`TIER_UNLOCK = { small:0, ult:0, passive1:1, passive2:2, awaken:3 }`；红阶（tier4）：觉醒技效果 ×1.3 + 技能等级上限从 3 提到 5（`progression.csv` 已有 `skill_level_max=5`，新增 `skill_level_max_normal=3`）。
  3. `data.js` 装配时按 tier 过滤技能槽（tier<1 无被动1、tier<2 无被动2、tier<3 无觉醒技），并把 `effectMult = 1 + skill_level_mult × (技能等级-1)` 注入各技能 cfg。
  4. `sim.js`：小技能/大招/被动/觉醒 `_exec` 调用处传入各自 `effectMult`；**补 `heal` 的 effectMult 分支**。
  5. 养成 UI（`hero.html` + `src/ui/hero_screen.js`，UI 层）：升级（耗经验）/进阶（耗材料）/技能升级（耗技能书），资源读写存档。数值进 `progression.csv`。
- **涉及文件**：`data/growth_curve.csv`(新)、`src/prototype/hero.js`(新)、`src/prototype/data.js`(改)、`src/prototype/sim.js`(改)、`data/progression.csv`(加键)、`hero.html`+`src/ui/hero_screen.js`(新)。
- **验收标准**：同一武将不同 tier 解锁技能槽正确（tier≥3 才有觉醒技；绿阶有普攻/小技能/大招，无被动/觉醒）；技能等级提升伤害按 effect_mult 增长；无头测试：橙阶武将有觉醒技、绿阶没有；effect_mult 公式断言；heal 吃 effectMult。

### 3.3 关卡 / 波次制
- **目标**：用波次制 PvE 关卡替换单一镜像战，提供可推进内容。
- **现状**：原型只有一场 5v5；网格关的 COLLECT/ESCORT 目标在横版不适用（设计稿 §7）。
- **跨波继承规则（v2 明确）**：我方 HP/怒气/buff/技能冷却**全部跨波继承**，阵亡单位不复活；每波间隙 `spawn_delay` 内我方单位待机（治疗光环/治疗普攻继续）。继承制是难度与奶妈价值的核心，验收测试必须断言。
- **任务拆解**：
  1. 新增 `data/waves.csv`（schema 见 §6，**一行一个敌方单位**，不用嵌套列表）：`battle_id, wave, spawn_delay, unit_id, row, slot, level, tier`。
  2. `sim.js` 支持波次：`teams.enemy` 改为 `teams.waves = [[cfg...], ...]`（兼容旧单波用法：单波 = waves[0]）；清完一波按该波 `spawn_delay` 刷下一波（事件 `wave_clear`/`wave_spawn`）；全清判胜，我方全灭判负。
  3. 关卡配置 `data/levels_proto.csv`：`level_id, name, battle_id, recommend_level, reward_exp, reward_mats, desc`。
  4. 表现层：波次提示（"第 X/Y 波"）、增援入场、关卡选择与结算界面（结算发奖励写存档，见 §4.4）。
  5. 先做 5 关验证（story_01–05，难度递增；story_05 含 Boss 波：单体高血高攻精英，可用 `units.csv` 新增 `yang_zhi_boss` 行——`skills.csv` 已有其 `act_yangjia`）。
- **涉及文件**：`data/waves.csv`(新)、`data/levels_proto.csv`(新)、`src/prototype/sim.js`(改 波次状态机)、`src/prototype/side_battle.js`(改 波次提示/结算)、选将/关卡入口。
- **验收标准**：一关多波能逐波刷出并推进；全清判胜、全灭判负；跨波继承断言（HP/怒气不复位）；无头测试：构造 2 波关卡断言波次推进与胜负。

---

## 4. 阶段二：系统补全

### 4.1 13 个横版新效果正式入白名单 + 校验 + 单测
- **目标**：把设计稿 §7 的新效果收编进共享层并补齐未实现的；**补上白名单强制校验**（红线 6 落地）。
- **现状**：`sim.js` 已临时实现 taunt/silence_all/lifesteal/revive/haste/knockback/execute_below；但都未入 `KNOWN_EFFECTS`；expose/dash_back/silence(单体)/shield/energy_drain/act_now/invuln_dying/heal_cut 未实现；`buildTeams` 对未知效果不报错。
- **任务拆解**：
  1. `KNOWN_EFFECTS` 补 15 个名：`taunt, expose, dash_back, silence, silence_all, shield, lifesteal, revive, energy_drain, haste, act_now, knockback, invuln_dying, heal_cut, hot_aura`（后三个已在用但未入单）。
  2. `sim.js _applyEffect` 实现缺失 8 个（结算口径按设计稿 §7）：
     - `expose(d,v)` 敌后排移到前排 d 秒 + 承伤 +v（默认 4s/+25%）
     - `dash_back` 自身突进敌后排（无视前排阻挡，`dashed` 标记影响目标选择）
     - `silence(n)` 单体沉默 n 秒（pool 目标；保留群体版 `silence_all`）
     - `shield(v)` 吸收盾 = v×最大生命（独立护盾池，先扣盾）
     - `energy_drain(v)` 抽敌方怒最高者 v 怒 → 己方怒最低者
     - `act_now(n)` 己方攻击面板最高 n 人 atkTimer 立即就绪
     - `invuln_dying(n)` n 秒锁血（最低 1 血）
     - `heal_cut(v,d)` 目标受疗 ×(1-v)，持续 d 秒（默认 3）
  3. `data.js` 装配校验：所有效果串（技能/被动/觉醒）解析后逐个查 `KNOWN_EFFECTS`，未知名**抛错并点名 skill_id**。
  4. 每个新效果配无头单测（构造最小场景断言生效）+ 未知效果抛错用例。
- **涉及文件**：`src/shared/effects.js`(白名单)、`src/prototype/sim.js`(_applyEffect)、`src/prototype/data.js`(校验)、`tests/test_effects.js`(新)。
- **验收标准**：15 个效果全部在白名单且语义正确；每个有通过的单测；未知效果装配期抛错。
- **依赖**：无；建议尽早做（后续技能组依赖它）。

### 4.2 全 30 武将技能组 / 觉醒技 + 羁绊
- **目标**：把 30 个武将的技能组与觉醒技全部实配，接入羁绊横向搭配。
- **现状**：只有 10 将有 ult；`proto_awaken.csv` 只有 10 条；兜底表只为 10 将补全。
- **任务拆解**：
  1. 按 `design-hero-skills.md` §6 总表，为全 30 将补齐「小技能(active) + 大招(ult)」进 `skills.csv`（新增行）、「觉醒技」进 `proto_awaken.csv`（补到 30 条）。效果串只允许用 §4.1 后的白名单效果。沿用现有行不改身份（旗舰 8 将小技能沿用兜底表内容转正）。
  2. 全 30 将数据齐后**删除** `data.js` 的 `FALLBACK_SMALL/FALLBACK_ULT` 与 `SCOPE` 硬编码表，scope 统一由 CSV `target` 列或按技能类型推导（映射表进 data.js 注释说明）。
  3. 羁绊：`units.csv` 的 `bonds` 列（`搭档|羁绊名`），同队双方在场各得 atk/def +`bond_stat_bonus`%（`progression.csv` 键已存在，值 5），进 sim 开战钩子（永久 buff，事件 `bond`）。
  4. 用选将界面实测各 archetype 是否都有克制手段（对照设计稿 §5 克制矩阵）。
- **涉及文件**：`data/skills.csv`(补)、`data/proto_awaken.csv`(补到30)、`src/prototype/data.js`(改)、`src/prototype/sim.js`(加羁绊钩子)。
- **验收标准**：30 将每个都有完整 普攻/小技能/大招/双被动/觉醒技；装配零未知效果报错；羁绊在场生效；无头装配测试 30/30 通过 + 羁绊断言。
- **依赖**：4.1（新效果白名单）、3.1（编队界面便于实测）。

### 4.3 托管模式 + 敌方 AI
- **目标**：手动 / 全自动两档托管（v2 简化：砍掉"半自动"，普攻小技能本来就一直自动，三档只剩大招一个维度）；敌方 AI 大招更聪明。
- **现状**：玩家只能手动放大招；敌 AI 怒满延迟 0.8s 固定放。
- **任务拆解**：
  1. `sim.autoUlt`（side 0 托管开关，HUD 切换）：开启时玩家单位怒满按门控自动放——输出/控制职业怒满即放；奶妈（healer）等有友军 HP<70% 或有阵亡才放。
  2. 敌方 AI 大招时机（替换固定 0.8s）：①斩杀优先——大招预估伤害可击杀目标立即放；②反制保留——我方有单位怒气 ≥90 且其大招为治疗/复活类时，敌方输出大招延迟到我方放完后或目标出现再放；③防御性大招（taunt/shield/heal）在自身/队伍 HP<50% 才放；④AOE 大招在多目标可覆盖时放。规则按 cfg 的 `scope`+效果串推断，不写死 unit_id。
- **涉及文件**：`src/prototype/sim.js`(敌 AI 决策)、`src/prototype/side_battle.js`(托管切换)。
- **验收标准**：两档模式行为正确；敌 AI 不再"怒满就无脑放"（无头构造：敌方治疗大招等我方残血才放、可斩杀时立即放）；无头测试覆盖。

### 4.4 大厅 / 结算 / 存档
- **目标**：战斗外的游戏外壳。
- **任务拆解**：
  1. 大厅 `hall.html` + `src/ui/hall_screen.js`：入口导航（出战→关卡选择→选将→战斗 / 武将养成 / 关卡进度展示）。
  2. 战斗结算：胜负、评价（S=无阵亡 / A=获胜 / B=失败）、奖励发放（`levels_proto.csv` 的 reward_exp/reward_mats，首通双倍），写入存档。
  3. 存档：`src/ui/save.js`（§3.1 已建，此处扩展结算写入与进度标记）；**逻辑层不碰 localStorage**，存档读写全部在 UI 层。
- **涉及文件**：`hall.html`+`src/ui/hall_screen.js`(新)、`src/prototype/side_battle.js`(结算)、`src/ui/save.js`(扩)。
- **验收标准**：从大厅能选关进战斗、打完回结算拿奖励、进度与养成可保存并读取（刷新页面仍在）。
- **依赖**：3.1/3.2/3.3 都就位后。

---

## 5. 阶段三：表现与平衡

### 5.1 真实模型 + 技能 VFX
- **目标**：把胶囊占位换成真模型，补表现。
- **现状**：`assets/models/shiqian.glb`（时迁）可用；现为胶囊 + HTML 飘字。
- **任务拆解**：vendor GLTFLoader（注意 three 版本与 vendored `vendor/three.module.js` 对齐）；`side_battle.js` 按 unit_id 加载 .glb 替换网格（无模型回退胶囊）；按职业配攻击/受击/技能动画；技能 VFX（弹道/AOE/大招特写）；音效。表现层仍只消费事件，不加逻辑。
- **验收标准**：至少时迁加载真模型；核心 5–10 将后续按 `tools/make_shiqian.py` 同款流程补模型。

### 5.2 数值平衡回归
- **目标**：拉长节奏、平衡连锁与养成。
- **现状**：一场 10–14s 偏快；完美连锁滚雪球。
- **任务拆解**：`battle_constants.csv` 加 `battle_hp_scale`（战斗血量全局倍率，调时长主杠杆）；调 HP/攻击/怒气速率把单场拉到 30–60s；连锁系数、觉醒技强度、养成曲线；写**批量无头平衡回归** `tools/balance_sim.js`（多阵容互打，统计胜率/时长分布，避免单一阵容过强）。
- **验收标准**：主流阵容胜率无 >70% 的怪物；平均时长 30–60s；回归脚本可重复跑。

### 5.3 体验细节
- 能量运营（`energy_drain` 类技能的策略价值）、大招连锁 UI 强化、集火/站位指令、战斗内信息可读性（谁被集火、谁的觉醒已触发、护盾量显示）。

---

## 6. 数据契约（schema）

> 全部遵循现有 CSV 约定：首行表头、UTF-8（可带 BOM）、**带逗号的字段必须双引号包裹**。
> **v2 新增铁律**：逗号后**不得留空格**——`parseCsvTable` 已改为 trim 无引号字段（双保险），但书写示例与数据文件一律 `"a,b,c"` 紧凑格式。

**存档（localStorage，非 CSV）** key `shuihu3d_save_v1`：
```json
{
  "version": 1,
  "roster": { "lin_chong": { "level": 1, "tier": 0, "skill": { "small": 1, "ult": 1 }, "exp": 0 } },
  "formation": [{ "id": "lin_chong", "row": "front", "slot": 0 }],
  "progress": { "cleared": [], "exp": 0, "mats": 0, "gold": 0, "books": 0 }
}
```

**`data/growth_curve.csv`**（职业 × 属性曲线；公式 `stat = base + per_level×(level-1) + per_tier×tierIndex`）：
```
unit_class,stat,base,per_level,per_tier
cavalry,hp,670,50,170
cavalry,atk,102,7,26
```

**`data/waves.csv`**（一行一个敌方单位；tier 缺省 3 满解锁）：
```
battle_id,wave,spawn_delay,unit_id,row,slot,level,tier
story_01,1,0,song_wan,front,0,1,3
story_01,2,3,qin_ming,front,0,2,3
```

**`data/levels_proto.csv`**：
```
level_id,name,battle_id,recommend_level,reward_exp,reward_mats,desc
story_01,祝家庄前哨,story_01,1,100,20,教学关
```

**`data/auto_skill_policy.csv`**（小技能自动释放条件，阶段二可选）：
```
skill_id,release_cond,param
act_miaoshou,ally_hp_below,0.6
```

**`data/battle_constants.csv` 新增键**：`rage_on_hit`、`rage_refresh_kill`、`chain_window`、`chain_bonus`、`row_back_mod`、`battle_hp_scale`。
**`data/progression.csv` 新增键**：`skill_level_max_normal=3`（`skill_level_max=5` 已有，红阶上限）。

---

## 7. 测试与验收约定

- **无头测试**是主要验收手段：用 `node:fs` 读 CSV → `buildTeams` → `new Sim` → 定长 step 驱动 → 断言。逻辑层改动必须配无头测试且 `npm test` 全绿。
- 测试文件按阶段拆：`test_prototype.js`（既有，3.1 改签名时同步更新）、`test_effects.js`（4.1）、`test_formation.js`（3.1）、`test_hero.js`（3.2）、`test_waves.js`（3.3）、`test_bonds.js`（4.2）、`test_ai.js`（4.3）。
- 表现层改动手动验收：`npm start` 后浏览器跑 `battle-proto.html`。
- 每个 PR 保持 `npm test` 全绿。

## 8. 实施顺序与并行性（v2 修订）

- **第 0 步（串行，必须先做）**：3.0 常量收口 + 4.1 白名单/校验 + `data.js` 新签名与 cfg 契约（tier/skillLevels/effectMult/consts）冻结。**3.1 与 3.2 都重写 `data.js` 同一函数，契约冻结前禁止并行改它。**
- **第一波（契约后可并行）**：3.1 选将/存档 + 3.2 养成 + 4.2 数据内容补全（CSV 内容工作与代码解耦）。
- **第二波**：3.3 关卡波次（依赖 3.1）+ 4.3 托管/AI（依赖 4.2）。
- **第三波**：4.4 大厅结算存档（依赖阶段一）。
- **第四波**：5.x 表现与平衡（依赖主体功能）。
