# 水浒 3D · 项目状态盘点与后续研发计划

> **日期**：2026-08-02　**状态**：现行（与代码保持同步）
> **读者**：项目所有者 / 接手 coder
> **本文定位**：状态快照 + 下一步优先级路线。详细的分阶段实施任务书见 `docs/plan-roadmap.md`（实施交接版 v2，含任务拆解 / 验收 / 数据契约）；本文给出"当前完成到哪、还剩什么、先做什么"的结论与依据，不重复 plan-roadmap 的任务明细。
> **配套必读**：`AGENTS.md`（工程红线）、`docs/design-auto-battle.md`、`docs/design-hero-skills.md`。

---

## 0. 一句话结论

**游戏已"能玩"：阶段一（最小可玩闭环）与阶段二（系统补全）全部完成，`npm test` 47/47 通过；阶段三的数值平衡已收敛（2026-08-02 二轮调参：阵容互打 400 局零超时、无怪物阵容、总平均 38.5s 落在 30–60s 区间）。剩余工作集中在真模型与 VFX/音效，属于"好不好看"，而非"能不能玩 / 好不好玩"。**

当前刷新浏览器即可从大厅完整跑通「选将 → 养成 → 推关 → 结算发奖 → 存档」全链路。

---

## 1. 当前状态盘点（已有什么）

### 1.1 验证指标（2026-08-02 复测）

| 指标 | 结果 |
|---|---|
| `npm test` 无头回归 | **47 / 47 通过**（8 个测试文件，零失败） |
| 推关 story_01~05 | 5 关全通（40 局样本 100% 胜率），单场 9.6~42.9s |
| 阵容互打（balance_sim 40 局/对阵） | 总平均 38.5s（目标 30–60s），**零超时局**，无胜率 >70% 怪物阵容（最低 31%）；最慢对阵「双坦 vs 法师」74.4s 但 50% 胜率正常分胜负 |
| 真模型 | 仅 1 个（`assets/models/shiqian.glb`） |

### 1.2 阶段一 · 最小可玩闭环 —— ✅ 已完成

- **常量收口（plan-roadmap §3.0）**：`sim.js` 战斗数值全部读 `this.consts.*`（回怒 `rage_on_hit/rage_on_hit_taken/rage_on_kill/rage_on_skill/rage_on_heal/rage_refresh_kill`、连锁 `chain_window/chain_bonus`、后排减伤 `row_back_mod`）；`data.js` 装配 consts 并经 `buildTeams` 传入。`battle_constants.csv` 已补齐 `rage_on_hit=20`、`rage_refresh_kill=50`、`chain_window=3.0`、`chain_bonus=0.2`、`row_back_mod=-0.10`、`battle_hp_scale=1.5`。
- **选将 / 编队 / 存档（§3.1）**：`src/ui/save.js`（localStorage，key `shuihu3d_save_v1`，新档 30 将全解锁 lv1/tier0）；`select.html` + `src/ui/select_screen.js`（30 卡点选 ≤5、前后排 + slot 调整、出战写存档跳战斗页）；`buildTeams` 新签名 `{unitsCsv,skillsCsv,awakenCsv,growthCsv,constsCsv,progressionCsv,playerFormation,enemyFormation,wavesCsv,battleId,heroStates}`，`PLAYER_IDS/ENEMY_IDS` 已彻底删除。
- **养成接入（§3.2）**：`src/prototype/hero.js`（`computePanel` 公式 `base+per_level×(lv-1)+per_tier×tierIndex`、`TIER_UNLOCK={small:0,ult:0,passive1:1,passive2:2,awaken:3}`、红阶觉醒 ×1.3、技能等级上限 3/5）；`data/growth_curve.csv` 填满 7 职业 × 4 属性 = 28 行；`data.js` 按 tier 过滤技能槽并注入 `effectMult`；`sim.js` 各 `_exec` 均传 effectMult，**heal 分支已吃 effectMult**；`hero.html` + `src/ui/hero_screen.js` 升级/进阶/技能升级。
- **关卡 / 波次（§3.3）**：`data/waves.csv`（story_01~05，含 Boss 波 `yang_zhi_boss`）、`data/levels_proto.csv`（5 关 + 奖励）；`sim.js` 波次状态机（`wave_clear`/`wave_spawn` 事件）；跨波继承（我方 HP/怒气/buff 全继承、阵亡不复活）。

### 1.3 阶段二 · 系统补全 —— ✅ 已完成

- **新效果白名单 + 强制校验（§4.1）**：`KNOWN_EFFECTS` 收编全部 15 名（taunt/expose/dash_back/silence/silence_all/shield/lifesteal/revive/energy_drain/haste/act_now/knockback/invuln_dying/heal_cut/hot_aura）；`sim.js _applyEffect` 补齐 expose/dash_back/silence(单体)/shield/energy_drain/act_now/invuln_dying/heal_cut；`data.js validateEffects` 装配期对未知效果**抛错并点名 skill_id**（红线 6 落地）。
- **全 30 将技能组 / 觉醒 / 羁绊（§4.2）**：30 将全部具备 ult + active + 双被动；`proto_awaken.csv` 31 条（30 将 + boss）；`FALLBACK_SMALL/FALLBACK_ULT/SCOPE` 已删除；羁绊 `_applyBonds` 开战钩子（双方在场各得 atk/def +5%，产 `bond` 事件）。
- **托管 + 敌 AI（§4.3）**：`sim.autoUlt` 托管开关（HUD 切换）；敌 AI `_enemyUltGate`——斩杀优先 / 自身危急 / 反制保留（我方怒≥90 留大）/ 留大上限 / 奶妈按残血 / 防御型按 HP<50%，不再"怒满无脑放"。
- **大厅 / 结算 / 存档（§4.4）**：`hall.html` + `src/ui/hall_screen.js`；导航链 `index.html → hall → select → battle-proto → 结算 banner → 再战/回大厅` 闭合；结算评价 S/A/B、首通双倍、奖励写存档。

### 1.4 阶段三 · 表现与平衡 —— ⚠️ 部分完成

- **5.1 真模型 + VFX**：仅 `shiqian.glb` 1 个真模型，`side_battle.js` 仅对 `shi_qian` 加载（其余 29 将 + Boss 为胶囊，回退机制健壮）；VFX 仅通用表现（大招震屏/闪光/光环、远程弹道、觉醒光环、飘字），**无职业动画 / 弹道差异化 / 大招特写 / 音效**。
- **5.2 数值平衡**：✅ **已收敛**（2026-08-02 二轮调参）。根因：安道全治疗溢出（`act_miaoshou` 2s CD 群奶 1.5× + 觉醒 `hot_aura(0.02)`，全场治疗 ~550hps 远超 DPS）+ 双奶局僵持。处置：① 小技能砍至 `heal(1.0)`/CD6s、光环 `hot_aura(0.01)`、大招复活 `revive(0.4)`；② 新增**治疗衰减机制**（`heal_decay_start=50`/`heal_decay_rate=0.025`/`heal_decay_min=0.2`，sim `healMult` 作用于普攻奶/技能奶/光环/复活，专杀长局僵持、不伤短局）；③ story_04 敌兵 lv8→lv7（修推关边际）。结果：400 局零超时、无怪物、总平均 38.5s、推关 5×100%。配套无头断言：治疗衰减 getter/奶妈奶量/CSV 常量驱动（§3.0 验收缺口已补）。
- **5.3 体验细节**：已做集火（focusId）、站位指令、连锁 UI、护盾量事件、波次提示、托管开关；未做能量运营策略化、集火/觉醒触发可读性强化。

---

## 2. 已确认的问题

### 2.1 已修复 —— 小技能特效环死分支（2026-08-02）
- **修复方案**：sim 侧 `_castSmall` 按效果串推导 `kind`（`_smallKind`：法系→`thunder`、物理AOE→`whirl`、物理单体→`slam`、治疗/增益/控制→`support`），`smallfx` 事件携带 `kind`；表现层 `SMALLFX_STYLE` 按 kind 映射颜色/尺寸，四类小技能全部有特效环。
- **验收**：无头断言（镜像战 smallfx 全部带合法 kind、`_smallKind` 映射表）+ 浏览器手工验收（thunder 紫环 / whirl 青环实机可见）。

### 2.2 技术债
1. ~~`data/` 残留旧 SRPG 文件~~ ✅ 已删（2026-08-02）。
2. ~~`battle_constants.csv` 残留 `ai_*` 死键 + `rage_on_wait`~~ ✅ 已清（保留 `ai_ult_max_hold`，横版敌 AI 留大在用；常量表从 67 键瘦身为 16 个活键）。
3. ~~plan-roadmap §3.0 "改 CSV 常量→战斗结果变化"无头断言~~ ✅ 已补（`test_prototype.js`：改 `battle_hp_scale` → 15s 时剩余血量显著变化）。
4. ~~平衡未收敛~~ ✅ 已收敛（见 §1.4-5.2）。

### 2.3 说明（非问题）
- `sim.js` `CONST_DEFAULTS` 仍以字面量存在，作为 CSV 缺键兜底（有注释说明），非逻辑硬编码。
- `sim.js:575-576` 对 move_mod/av_mod/extra_action/summon 等走 `return` 安全忽略（横版无对应概念，注释已说明）。
- Boss `yang_zhi_boss` 无被动（空数组安全跳过，不报错）。

---

## 3. 后续研发计划（按优先级）

> 原则：逻辑层改动必须配无头测试且 `npm test` 全绿；表现层改动手工验收（`npm start`）；每个 PR 保持全绿。详细任务拆解 / 数据契约 / 验收口径见 `docs/plan-roadmap.md` 对应章节。

### P0 —— 数值平衡精调 —— ✅ 已完成（2026-08-02）
- 结果与手法见 §1.4-5.2。验收全达标：无 >70% 胜率怪物（最低 31%）；总平均 38.5s ∈ 30–60s；**超时占比 135/400 → 0/400**。

### P1 —— 补核心将真模型
- **目标**：旗舰 5–10 将用真模型替换胶囊。
- **做法**：复用 `tools/make_shiqian.py` 同款流程（Blender 生成 → GLB 导出），产出 `assets/models/*.glb`；`side_battle.js` 由 `shi_qian` 特判扩展为按 `unit_id` 查表加载（无模型回退胶囊，保持健壮）。
- **涉及**：`assets/models/`、`tools/make_shiqian.py`、`src/prototype/side_battle.js`。
- **验收**：至少核心 5 将出真模型；加载失败静默回退胶囊。

### P2 —— 小技能特效死分支修复 + 职业/技能专属 VFX + 音效
- **状态**：① smallfx 死分支 ✅ 已修（见 §2.1）；② 职业攻击/受击动画、③ 弹道差异化 / AOE 范围 / 大招特写、④ 音效 未做。
- **做法**（剩余）：职业攻击/受击动画；弹道差异化 / AOE 范围 / 大招特写；音效（可选，需素材）。
- **涉及**：`src/prototype/side_battle.js`。
- **验收**：大招/觉醒表现明显区分于普攻；各职业攻击动作可辨。

### P3 —— 技术债清理 —— ✅ 已完成（2026-08-02）
- 三项全部落地（见 §2.2），`npm test` 47/47 全绿。

### 后续可选（体验细节，5.3）
能量运营策略化 UI、集火/觉醒触发可读性强化（谁被集火、谁觉醒已触发）、战斗信息面板。

---

## 4. 架构红线（改代码前必读）

1. **逻辑/表现分离**：`sim.js`/`data.js`/`hero.js` 不得 import three.js、不得碰 DOM/window/localStorage，必须能在 node 直接跑。
2. **CSV 唯一数据源**：数值只改 `data/*.csv`，禁止在逻辑里硬编码数值。
3. **指令管道 + 事件回放**：逻辑瞬时结算产事件数组；表现层只消费事件，不反向影响逻辑。
4. **随机走注入式 RNG**：`makeRNG(seed)`，不得直接 `Math.random`（表现层视觉抖动除外）。
5. **定长 tick**：逻辑用固定步长推进，不用浮点 dt 直接驱动核心判定。
6. **新效果必须入白名单**：`KNOWN_EFFECTS` + 装配期校验抛错 + 单测。
