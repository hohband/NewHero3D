# GDD-04 经济与评分系统（Economy & Scoring System）

> **所属模式**：劫寨战斗模式（Raid the Stronghold）· Phase 2 系统设计
> **上游文档**：`../combat-mode-design.md`（DS-001，§5 胜负与评分、§0.1 已审批锁定 L3/L4）
> **设计支柱对齐**：P4 劫富济贫题材闭环（Loot-and-Give）、R3（技能/经济数值膨胀）、R6（认知过载：第三星"或"化）
> **架构红线**：评分/收益/拨济计算由 `RealTimeBattleManager` 在 `battle_end_event` 后驱动；**不采用 SRPG submit_command 回合模型**。暂停/侦查期计时语义须与 GDD-01 一致。

---

## ① 概述（Overview）

经济与评分系统统管单局产出与 Meta 进度：

- **三星评分**：★ 击败 Boss 并摧毁核心 / ★ 摧毁 ≥50% 建筑（口径见 §④ M7）/ ★ 剩余兵力 ≥30% **或** 用时 ≤120s（二选一，✅ 已锁定 L3）。
- **劫掠收益（v2 动词化）**：银两 / 粮草 / 装备；战斗中实时搬运/拾取（combat-mode §5.2），按四系数公式结算。
- **拨济闭环**：劫掠所得 **20–30%** 可选拨济（✅ 已锁定 L4，上调自 10–20%），反哺江湖声望，解锁剧情/武将/关卡/**兵书（v2）**。
- **补偿防失衡**：因拨济比例上调稀释成长资源，以"满额额外声望奖励"或"更快声望解锁"补偿（呼应 P4 与 R3/R6）。
- **v2 同步**：兵力比按英雄去重、超时/投降、Meta 存档接口、拨济叙事分支、残局复盘/破釜沉舟 —— 见 `../combat-mode-design.md` §0.2 / §5.3–§5.4。

---

## ② 机制（Mechanics）

1. **胜利前提（v2）**：击败 Boss 守将（核心护盾消失）并摧毁核心（忠义堂）。
2. **三星三条件**：
   - ★ 核心被毁（胜利前提，v2 须先击败 Boss）。
   - ★ 摧毁 ≥50% 建筑（**口径 M7：建筑=墙+塔+资源建筑+核心，不含陷阱/庄丁**；`buildings.csv` 加 `counts_for_star2` 布尔，见 §③）。
   - ★ 剩余兵力 ≥30% **或** 用时 ≤120s（二选一，降认知过载 R6）。
3. **劫掠收益（v2 动词化）**：银两（兵符补给/武将升级）、粮草（战斗消耗补给，与 GDD-01 闭环）、装备（概率掉落养成）；**战斗中实时搬运/拾取（combat-mode §5.2）**。
4. **拨济（已锁定 20–30%）**：
   - 劫掠所得中 20–30% 可选济贫 → 江湖声望。
   - 满额（30%）拨济触发额外声望奖励；或解锁门槛 0.85× 缩放（更快解锁），补偿成长资源稀释。
   - **v2 叙事分支（采纳 fun-opinion-li 5）**：拨济累积比例触发不同剧情线——高(≥25%)「民心所向」/ 中(15–25%)「亦侠亦盗」/ 低(≤15%)「武力威慑」，把拨济从数值变身份（SDT 自主）。
   - **v2 措辞修正（T1）**：原"不救济=无惩罚（纯选择）"改为"不救济=选择短期成长，放弃 Meta 进度"；或增加"通关固定少量声望"副路径让拨济是加速器而非唯一通道。
5. **v2 Meta 存档（G5）**：`MetaState`（声望/解锁/兵书/武魂图鉴）由 `src/ui/` 或 `src/main.js` 负责 IO（localStorage/IndexedDB），`src/core/meta.js` 仅状态管理（呼应 AGENTS.md core 不碰 localStorage 红线）。
6. **v2 失败与长尾**：超时 240s 未毁核心=0 星（G2）；投降按钮+二次确认；残局复盘（破局点分析）；破釜沉舟（核心毁前 10s 全员狂暴）；被俘→潜入营救小关（fun-opinion-li 2.7）。
5. **声望 Meta 解锁**：声望解锁剧情章节 / 新武将 / 新关卡（§6 递进）。

---

## ③ 数据（Data — 需入 CSV，基准值为建议，最终以 CSV 为准）

> ⚠️ 数值为建议基准，**最终以 CSV 为准**；系数 `k`、解锁缩放比待 Phase 3 平衡脚本（R1）标定。

**scoring_config.csv**
| 字段 | 含义 | 基准 |
|------|------|------|
| star1_core_req | 核心毁（v2 须先击败 Boss） | true |
| star2_build_destroy_pct | 建筑摧毁比 | 0.5 |
| star2_scope | **v2 建筑口径（M7）** | 墙+塔+资源+核心（不含陷阱/庄丁） |
| star3_troop_pct | 剩余兵力比 | 0.3 |
| star3_time_s | 用时上限 | 120 |
| **surviving_troop_ratio_mode** | **v2 口径（M1）** | **hero_id 去重**：`Σ bingfu(unique_hero_alive) / Σ bingfu(unique_hero_ever_deployed)`；撤兵单位计 alive |

**loot_config.csv**
| 字段 | 含义 | 基准 |
|------|------|------|
| base_loot[level] | 关卡基础收益 | 按关 |
| star_coeff | 星系数 | 1.0 / 1.3 / 1.6 |
| difficulty_coeff | 难度系数 | 按关 |

**relief_config.csv（✅ 已锁定 20–30%）**
| 字段 | 含义 | 基准 |
|------|------|------|
| relief_min / relief_max | 拨济比例区间 | 0.20 / 0.30 |
| full_relief_bonus_k | 满额额外声望系数 | 待标定 |
| unlock_scale | 解锁门槛缩放 | 0.85 |

**renown_config.csv**：renown_per_relief / unlock_thresholds
**relief_branch_config.csv（v2 叙事分支）**：branch_high(≥0.25)/branch_mid/branch_low 对应的剧情线 ID 与解锁内容（民心所向/亦侠亦盗/武力威慑）
**meta_config.csv（v2）**：meta_save_backend(localStorage/IndexedDB) / **兵书(bing_shu)池与永久微调幅度**（声望购买，不破 8 将护栏）
**disaster_config.csv（v2）**：timeout_s(240) / 破釜沉舟(last_stand 触发窗 10s, DPS+50%, HP 衰减) / 被俘营救规则

---

## ④ 公式（Formulas）

- **劫掠收益（单类资源 r）**：
  `Loot_r = Base_r(level) × DestroyRatio × StarCoeff(stars) × DifficultyCoeff`
  - `DestroyRatio = destroyed_buildings / total_buildings`（异常保护见 §⑤）
  - `StarCoeff = 1.0 / 1.3 / 1.6`（对应 1/2/3 星）
- **三星判定**：
  - `Star1 = (Boss_HP ≤ 0) AND (Core_HP ≤ 0)`（v2 先击败 Boss）
  - `Star2 = (destroyed / total ≥ 0.5)`，**total 仅计 `counts_for_star2=true` 建筑（墙+塔+资源+核心，M7）**
  - `Star3 = (surviving_troop_ratio ≥ 0.3) OR (elapsed_time ≤ 120)`
    - **v2 口径（M1）**：`surviving_troop_ratio = Σ bingfu(unique_hero_alive) / Σ bingfu(unique_hero_ever_deployed)`（英雄 ID 去重）；**撤兵单位计 alive**（否则"撤兵换星"逻辑不成立）；阵亡再部署累计 deployed 不重复计同一英雄（去重后同英雄只算一次消耗）。
- **v2 超时/失败（G2）**：`elapsed_time > 240s` 且 `Core_HP > 0 ⇒ 0 星`，无劫掠收益、不触发拨济。
- **v2 破釜沉舟（last_stand）**：核心毁前 10s 内激活 ⇒ 全场 `DPS × 1.5`，`HP` 持续衰减（disaster_config）。
- **拨济声望**：
  `Renown_gain = Loot_total × relief_ratio × renown_rate`，`relief_ratio ∈ [0.20, 0.30]`（玩家选择）
  - 满额补偿：`if relief_ratio ≥ 0.30: Renown_bonus = k × level_renown_base`（额外声望奖励）；
  - 和/或 `unlock_thresholds ×= 0.85`（更快解锁）
- **防经济失衡**：净成长资源 `= Loot_total × (1 − relief_ratio) + Renown_gain(可转化)`；因 relief 提高稀释，用 bonus/scale 补回 Meta 进度，使救济正向（不破坏 R1 兵符硬上限与成长曲线）。

---

## ⑤ 边缘情况（Edge Cases）

1. **仅毁核心未达 50% 建筑**：Star1✓ Star2✗ → 1 星仍胜利。
2. **用时 ≤120s 但兵力全损**：Star3 因时间满足仍得（剩兵 0% <30% 但时间 ≤120 → 满足），可 3 星。
3. **拨济比例 0%（不选救济）**：无 Renown_gain，无惩罚（纯选择）；UI 明示"不选则无解锁进度"。
4. **满额 30% 拨济**：触发额外声望奖励，校验 bonus 不溢出解锁阈值。
5. **关卡总建筑数 = 0（异常）**：`DestroyRatio` 视为 1（除零保护），记录告警。
6. **投降/超时未毁核心（G2）**：0 星，无劫掠收益，不触发拨济；投降按钮常驻 HUD 右上角，二次确认。
7. **暂停/侦查期计时**：`elapsed_time` 不计入侦查期 8s，暂停期不累计（与 GDD-01 语义一致）。
8. **v2 兵力比口径（M1）**：英雄 ID 去重计算；撤兵单位计 alive；同英雄多次重伤退场不重复计入 deployed。
9. **v2 建筑口径（M7）**：墙/塔/资源/核心计 Star2，陷阱与庄丁不计；`counts_for_star2` 字段控制。
10. **v2 Meta 存档（G5）**：`MetaState` 读写为幂等；IO 失败兜底（不阻塞战斗）；`src/core/meta.js` 不直连 localStorage（AGENTS.md 红线）。

---

## ⑥ UI 接口（UI Interface — 对齐 §7.5 / §7.6 HUD）

- **结算界面**：三星逐颗点亮 + 条件达成提示（核心/建筑%/兵力或时间）。
- **资源条（层 1 常驻）**：兵符/粮草/在场/核心血/计时（实时，来自 GDD-01/03）。
- **拨济面板**：滑条 20–30% + "满额额外奖励"提示 + 实时声望预览。
- **v2 30% 语义标注（M5，不改动 L4 锁定数值）**：结算界面"剩余兵力 30%（Star3）"与拨济面板"拨济 30%（满额上限）"**明确区分文案/图标**，化解两处 30% 认知混淆。
- **声望进度条（Meta）**：解锁节点提示（来自 renown_config）；**v2 兵书购买入口**（声望养永久微调）。
- **v2 失败界面**：残局复盘（差 1 格/差 5 秒/差 1 技能）+ 破釜沉舟提示 + 被俘营救入口（若触发）。

---

## ⑦ 依赖（Dependencies）

- **跨系统**：
  - GDD-01 部署系统：剩余/已部署兵符比（Star3）、用时计时、兵符预算。
  - GDD-02 武将技能系统：粮草命名一致。
  - GDD-03 基地与防御系统：建筑总数/摧毁数、核心 HP（来自 `battle_end_event`）。
- **Phase 3 接口**：
  - `RealTimeBattleManager` 暴露 `battle_end_event(boss_destroyed, core_destroyed, destroyed_buildings, total_buildings, bingfu_alive_by_hero, bingfu_deployed_by_hero, elapsed, alert_level, disaster_flags)` → 评分器计算星/收益/拨济（**v2 按英雄 ID 去重**）。
  - 计时与暂停语义统一（暂停不计入 elapsed，侦查期不计入）。
  - **v2 Meta 存档接口**：`MetaState` 读写由 `src/ui/` 或 `src/main.js` 负责（localStorage/IndexedDB）；`src/core/meta.js` 仅状态管理，不直连 localStorage（AGENTS.md 红线）。
  - **非 SRPG submit_command**：评分在战斗结束后一次性结算。

---

## ⑧ 验收标准（Acceptance Criteria）

- [ ] 三星三条件按"或"正确判定（✅ L3 锁定）；v2 胜利须先击败 Boss。
- [ ] **v2 兵力比按英雄 ID 去重（M1）**，撤兵计 alive，同英雄不重复计 deployed。
- [ ] **v2 Star2 建筑口径（M7）**：墙+塔+资源+核心计，陷阱/庄丁不计（counts_for_star2）。
- [ ] **v2 30% 语义标注（M5）**：Star3 兵力 30% 与拨济 30% 界面明确区分，不改动 L4 锁定数值。
- [ ] 收益公式四系数相乘正确，CSV 可配、可热更。
- [ ] 拨济 20–30%（✅ L4 锁定）+ 满额额外声望 / 更快解锁补偿生效，不破坏成长曲线（R3）。
- [ ] **v2 拨济叙事分支（高/中/低）**触发正确剧情线。
- [ ] **v2 超时 240s=0 星（G2）；投降二次确认**。
- [ ] **v2 Meta 存档接口（G5）**：MetaState 由 ui/main IO，core 不碰 localStorage。
- [ ] 声望解锁与 Meta 进度（含兵书）联动。
- [ ] 异常（总建筑 0 / 超时）不崩溃，除零保护。
- [ ] 与 P4 支柱一致，济贫为"正向选择而非纯惩罚"，无经济失衡。
- [ ] 计时语义与 GDD-01 暂停/侦查期一致。
