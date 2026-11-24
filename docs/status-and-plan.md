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
| 真模型 | **5 个**（`assets/models/<unit_id>.glb`：时迁 / 林冲 / 鲁智深 / 武松 / 花荣，20 骨 + idle/attack/hit/skill，2026-09-13 新增后 4 位） |

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

- **5.1 真模型 + VFX**：**5 个真模型**（`assets/models/<unit_id>.glb` = 时迁 / 林冲 / 鲁智深 / 武松 / 花荣，各含 20 骨与 idle/attack/hit/skill 四段动作），`side_battle.js` 按 `MODEL_UNITS` 集合 + `MODEL_FILE` 别名表加载（其余 28 将 + Boss 为胶囊，回退机制健壮）。
  - **管线（2026-09-13 校订，补入「多视图」环节）**：角色设定文档 → ImageGen 正面全身图（文生图）→ ImageGen 多视图（图生图，`back` + `left_front` + `right_front`）→ 去水印 → 混元**多视角**图生 3D（`hy-3d-3.1`）→ Blender 无头绑骨 → 战场加载。**完整说明与踩坑见 `docs/pipeline-3d-asset.md`。**
  - 工具：`tools/nh3d_lib.py`（共享库：JPEG 编码 / 多视角载荷组装 / 6MB 门禁）、`tools/nh3d-gen3d.py`（单次提交，带 `--dry-run`）、`tools/nh3d-drive.py`（批量调度，并发上限 2，支持 `uid=front;view=path` 多视角语法与 `--dry-run`）、`tools/nh3d_dewatermark.py`（参考图去水印）、`tools/analyze_mesh_profile.py`（剖面分析：按高度切片 + x 投影间隙聚类，判断兵器是否贴身）、`tools/mesh_stats.py`（**焊接后**数真实连通岛，须先焊接否则全是接缝假岛）、`tools/render_model_views.py` + `tools/silhouette_compare.py`（按方位渲染 + 轮廓 IoU 比对）。
  - 网页版替代路径工具（20 次/天）：`tools/hy3d_web_lib.js`（共享库）、`hy3d_web_login.js`、`hy3d_web_gen.js`、`hy3d_web_fetch.js`（`pull` 直接读接口 JSON 取签名直链下载）。
  - **管线硬前置（踩坑结论）**：① ImageGen 参考图**必须是「全身直立站姿、双臂自然下垂、单件兵器」**——鲁智深首版出了下蹲蓄力姿，导致硬编码骨架（腿骨 ±0.06）与真实网格（双脚落在 ±0.2）差 3 倍，绑骨必崩；重出直立图后正常。② 多视图**只用 3/4 与背面视角**，纯正侧视（`left`/`right`）经图生图会把手持兵器挪到身后并脱离手掌（已实测失败）——宁要一致的近角，不要崩掉的远角。③ ImageGen **无法关闭水印**，部分批次会在右下角压「AI生成/WORKBUDDY」，送进重建会生成悬浮碎块，必须先去水印。
  - **额度限制（两条路径的重置点不是一套，别混算）**：① **内置 `hy-3d` 维度 5 次/天，按 UTC 日**（北京 08:00 重置，已两端闭合验证：北京 09-13 00:47 报 `daily submit limit exceeded (5/5)`，08:33 同参数提交成功）；**无额度查询接口**，只能靠 429 反推。② **网页版 `3d.hunyuan.tencent.com` 20 次/天，按北京日（UTC+8）00:00 重置**，扫码登录一次后 headless 复用；额度**可查**（`node tools/hy3d_web_quota.js`，或接口 `POST /api/3d/quotainfo` → `{date,totalQuota,remainQuota,consumeQuota}`）。工具 `tools/hy3d_web_{login,gen,fetch,quota}.js`（详见 `docs/pipeline-3d-asset.md` §5.3.2）。
  - **多视图收益已实测（2026-09-13，两轮独立复跑 + 两条独立轴线）**：轮廓 IoU 均值 —— 用**网页版**跑的林冲四视角（50k 面）对比单图版 30k：**0.633 vs 0.633（+0.000）**；用**内置管线**补跑的同面数档对照（多视图 30k vs 单图 30k）：**0.637 vs 0.633（+0.004）**。两轮都指向同一结论：**均值打平**，唯一跨两轮稳定为正的方向是**背面**（+0.038 / +0.024）与**右前 45°**（+0.033 / +0.043，且 `right −90°` 也 +0.043）——正是单图只能靠猜的方向；**左前 45°（−0.008 / −0.058）与正左视（−0.083 / −0.039）稳定为负**。**第二条轴线（绑骨时能否认出兵器）同样无改善**：两版 `PROP_CLUSTERS` 的武器侧种子 **6（多视图） vs 7（单图）**，都低于 10 的门槛 → **都没认出丈八蛇矛**；这推翻了「多视图分离更早 → 识别窗口更大」的推断。**结论：收益很小且方向性明确 → 不为另 3 位补做多视图**；多视图只留给「背面有重要识别特征」的角色（大披风 / 背负兵器 / 背纹），且林冲本人就是大白披风角色而增益仍≈0，门槛要卡更严。数据与方法见 `docs/pipeline-3d-asset.md` §8.2 / §8.3；**注意 §8.3 对失败原因的归因（「种子门控太严」）已被 §8.4 推翻，见下一条**。对照拼图 `assets/models/lin_chong_mv_vs_single.png`（50k）、`lin_chong_mv30k_vs_single.png`（30k）、`lin_chong_rig_mv_vs_single.png`（绑骨姿态）。
  - **当前的根因已查清（2026-09-13 深夜实测，`docs/pipeline-3d-asset.md` §8.4）：不是判据问题，是「骨架姿势不匹配」。** 硬编码骨架假设**双臂自然垂放**（`Hand.L/R` 在 z 0.43–0.49、x ±0.11），而生成模型是**持械架势** —— 林冲实拍：右手抬起斜握长矛（矛头过头顶、矛尾及地），握持手实际在 (x≈−0.25, z≈0.59)，**距模板手骨 0.17（≈ 身高 17%）**。因此「离手 <0.10」永远圈不到真手 → 武器侧种子恒为 6–7，凑不够 10。
    - **已实测否掉的两个替代方案**（都试过并用逐簇配色渲染验证）：① **放开设种的 `d_body>0.15`** → 种子 7→1665，但洪泛立刻吞下 10913 顶点（跨度 1.0，整个人）、长细比 2.6 仍丢弃，**只把失败点从种子搬到形状校验，零净收益**；② **改用镜像不对称簇找兵器** → 能干净抓出**非对称单兵器**（鲁智深禅杖整根、花荣弓整张、林冲矛头+红缨），但对**双手对称持械的武松完全失效（asym 顶点 = 0）**，且会把「因另一臂姿势不同而多出来的那条自由手臂」误判成兵器，更要命的是**林冲的杆身中下段被袍角的镜像位置遮蔽、`asym` 看不见 → 只能拿到矛头**，结果是「矛头随手动、杆身不动」，挥击时**兵器从中间撕断，比完全不绑更糟** → **故不上线，`blender_rig_character.py` 保持原样**。
    - **推荐下一条路：给骨架做「手臂链姿势拟合」**（从网格拟合出真实的手/肘位置再回写骨架）。拟合成立后，现有的「手部半径 0.10 + 空间洪泛」简单规则会重新生效，且顺带修好另两件事：手臂动画「空挥」（权重全落在模板手附近，真手没有骨）、肘/膝错位导致的蒙皮变形。难点：兵器紧贴手臂会污染拟合，需鲁棒/修剪拟合。**未做，待决策。**
    - 次优先：披风/战袍在多骨共牵下被拧成锥形，比兵器问题更影响观感。
  - **已知局限**：混元输出是「融合单面网格」——单个 mesh、无部件语义 **且焊接后是单一连通壳体**（`tools/mesh_stats.py` 实测 5 个成品最大岛占比均 100%；此前这里写的「897 个连通岛屿」是**未焊接的接缝假岛**计数，已纠正）。因此 (a) 长兵器只在「肩线以上呈孤立细长团块」或「远离身体前方」时能被自动识别（武松双刀成功；林冲长枪、鲁智深禅杖、花荣弓贴身持握，识别失败 → 兵器按最近骨权重、大幅挥击时会轻微弯曲）。**注意这仍是"症状"层描述，真正的成因是骨架姿势不匹配，见 §1.4 上一条与 `pipeline-3d-asset.md` §8.4**；(b) 宽体型角色的模板骨架横向偏窄（鲁智深最明显）；(c) 披风/战袍跨肩到地被多骨共牵，腿部旋转须 ≤0.3rad，否则下摆被撕成扇形（`skill` 幅度已按此封顶）。
  - VFX 仅通用表现（大招震屏/闪光/光环、远程弹道、觉醒光环、飘字），**无职业动画 / 弹道差异化 / 大招特写 / 音效**。
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
