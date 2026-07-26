# 元游戏 / UI / 存档 / 决策日志规格（spec-meta）

> 本文是 Godot 版《水浒战棋》元游戏层（养成/山寨/演武场/远征/流程/存档/音频/UI）移植到 Three.js（JS）的规格依据。
> 源实现：`src/meta/`、`src/autoload/`、`src/ui/hub.gd`；决策日志源：`docs/决策日志.md`。
> 战斗逻辑见 spec-battle.md；数据与关卡见 spec-data.md。

---

## 1. 养成公式（Progression，参数全在 progression.csv）

**属性倍率**：

```
stat_mult = (1 + 0.02 × (level - 1)) × (1 + 0.10 × (star - 1)) × (1 + 0.08 × 品质突破档数)
QUALITY_ORDER = [green, blue, purple, orange]     # 突破档数 = 当前品质下标（绿0/蓝1/紫2/橙3）
hp/def/mgc/spd = round(base × stat_mult)
atk = round(base × stat_mult × (1 + 0.03 × weapon_enhance + 0.05 × weapon_refine))
quality 取 hero 当前品质（突破会升档）
```

- **add_exp**：N→N+1 需 `100 × N` 经验（`level_exp_base × 当前等级`），循环升级。
- **star_up**：`star < 5` 可升；碎片 = `10 × 目标星级`（碎片扣减在调用方）。
- **breakthrough**：满 5 星品质升一档（绿→蓝→紫→橙，橙封顶），**保持星数**；材料 ×3，消耗在 UI 层。
- **skill_upgrade**：书 = `1 × 目标等级`，上限 5 级，每级效果 +5%（战斗内经 effect_mult 进入结算）。
- **weapon_enhance**：金 = `100 × 目标等级`，上限 10，每级攻 +3%。
- **weapon_refine**：上限 5，每阶攻 +5%；**无 UI 入口（半成品）**。

## 2. Hero（武将养成数据）

```js
{
  unit_id: string,
  level: 1, exp: 0, star: 1,
  quality: string,              // 当前品质（初始取 CSV）
  weapon_enhance: 0, weapon_refine: 0,
  has_signature_weapon: false,
  skill_levels: { [skill_id]: 等级 },   // 默认 1
}
```

`to_dict() / from_dict()` 可序列化（存档用）。上阵单位挂 Hero，战斗数值按养成进度生成（`apply_profile_to_deployed`）。

## 3. PlayerProfile（玩家档案）

```js
{
  heroes: { [unit_id]: Hero },
  gold: 0,
  items: { shard, skill_book, breakthrough_mat, arena_point, ... },   // 通用碎片/技能书/突破材料/荣誉点等
  progress: { chapter, cleared: [], village, arena, expedition_best, ending },
  achievements: [ ... ],
  settings: { volume_master, volume_sfx, volume_music, mute },
}
```

- **新档默认**：初始武将 = CSV `unlock == "初始武将"` 三名（石勇/宋万/杜迁）；金币 **2000**、通用碎片 **20**、技能书 **5**、突破材料 **3**；`progress = {chapter: 1, cleared: []}`。
- 方法：`spend_gold / spend_item / gain_item / add_hero`。

## 4. 羁绊系统（BondSystem）

- 同队在场羁绊搭档，**双方各得** `atk/def +5%`（`bond_stat_bonus`，百分比乘区同 Buff 口径）的 buff：`buff_id = bond_<partner_id>`，`duration = 99`，**不可驱散**；双向互有羁绊时**各计一份**；预留/未上阵搭档不生效。
- AI 目标价值的"羁绊核心"标记认 **`bond_` 前缀** buff（+15）。

## 5. 专属武器（SignatureWeapon）

- **解锁条件**：3 星 + 突破材料 ×5（消耗在 UI 层）。
- **质变注册表**：`MORPHS = { act_goulian: { effect: "armor_break", splash_radius: 2 } }`（汤隆钩镰枪破甲单体→群体溅射 2 格）。
- `morph_for(hero, skill_id)` → 注入 `ctx.mods.signature_morph`，由 armor_break 效果溅射结算（EffectSystem.execute 的 mods 为合并制）。后续新专武 = 注册表加一行 + 对应效果支持。

## 6. 山寨经营（VillageSystem）

- 三建筑：`juyiting` 聚义厅 / `tiejiangpu` 铁匠铺 / `yanwuchang` 演武场；上限 **3 级**；升级费 `500 × 当前级` 金币。
- **每通关一次关卡收获一轮**（不用现实时间）：
  - 聚义厅：金币 `100 × 级`；
  - 铁匠铺：突破材料 `max(1, round(1 × 级 × 倍率))`；
  - 演武场：全员经验 `30 × 级`（**含未上阵武将**）。
- **派驻**：一岗一人、一人限一岗（调岗自动卸旧岗；不限制派驻者上阵）；派驻产出 **+25%**；**汤隆驻铁匠铺再 +25%**。

## 7. 演武场（ArenaSystem，本地镜像异步 PVP）

- 闭环：攻方手动 vs **自己的守方阵容**（AI 操控，按玩家养成数值生成敌方，走 `spawn_from_spec` 的 `spec.hero`）。
- 守方配置存 `progress.arena = { team: [unit_id]（<= 4）, template }`；默认阵容 = **等级前 4**。
- **三策略模板**（只作用于守方 AI 的权重修正 + 附加分）：

| 模板 | 修正 |
|---|---|
| steady（稳健防守） | danger ×1.5；damage_expect ×0.8；远离布阵区每格 -10 |
| aggressive（激进） | damage_expect ×1.3；kill_bonus ×1.5；danger ×0.6 |
| protect_core（保护核心） | 队友距核心 ≤2 格 +20；核心承伤 ×2（core_danger_mult）；核心 = 守方首单位 |

- `build_arena_level`：动态 10×8 关卡，两小高台，歼灭战，部署区底部 2 行，roster = 全武将池，守方按养成数值生成为敌方。
- **奖励**：金币 300 + `arena_point × 1`。

## 8. 梁山远征（ExpeditionSystem）

- 队伍 = **等级前 4**（自选编队后续）；**10 层**；敌人每层全属性 **+12%**（`stat_mult`）。
- run 状态（**存内存不落盘**）：

```js
{ floor, team: [{ unit_id, hp_ratio, alive }], buffs: [{ field, value }], finished }
```

- **生命比率跨层继承**（hp_ratio 带入下一层；阵亡不进下赛季）。
- **每层胜利三选一**：休整（存活者 `hp_ratio + 30%`）/ 磨刀（攻 +10）/ 扎营（防 +10）——后两者为不可驱散 buff。
- **敌人组合**：厢军枪/盾 + 老都管；**5/9 层精英**；**10 层 yang_zhi_boss 压阵**；地形按 `floor % 3` 轮换。
- **结算**：每层 200 金 + 每 3 层 1 突破材料；记 `expedition_best`。
- **跳过手动布阵**，自动落位（层间奖励后 reload 进下一层）。

## 9. 流程（Flow）

- **通关经验**：`exp_reward = 30 + 20 × 章`（`exp_override > 0` 时覆盖）。
- **apply_battle_result**（**仅胜利发放**）：
  1. `unlock_grant {unit, requires_rank}` 达条件发将；
  2. 首通/常规奖励按 `progress.cleared` 判定发放；
  3. 成就入档（永久保留）；
  4. 章节终关通关 → `chapter + 1` 并发章节解锁武将（`grant_chapter_heroes`）；
  5. `ending` 非空 → 记结局 + 播尾声（EPILOGUES）；
  6. 经验发**所有上阵武将**；
  7. 最后 `VillageSystem.collect()` 收获一轮。
- **武将解锁渠道**：
  - 「第N章通关解锁」= 通关第 N 章**终关**（该章 id 最大者）发放；
  - 「第N章剧情加入」= **抵达**第 N 章（即通关第 N-1 章终关）发放；
  - 「聚义厅招募」= 未拥有时消耗**通用碎片 ×20**。
- **结局后日谈 EPILOGUES**（原文照抄）：

```
zhaoan（招安）：
  奉诏安民，北征辽寇。梁山一百单八将，自此星散四方。
  若干年后，茶馆里的说书人拍案一声：「各位看官，且听下回分解！」
  —— 结局 · 招安 ——
kangzhao（不招安）：
  圣旨掷地，再举义旗。官军百万，又奈这水泊如何？
  梁山泊里替天行道的大旗，依旧在秋风里猎猎作响。
  —— 结局 · 不招安 ——
```

## 10. GameState（纯内存）

`current_level_id` / `custom_level`（消费后置空）/ `expedition` / `last_result`。场景切换经它传递，不落盘。

## 11. 存档（SaveSystem）

- **单文件 JSON**，带 `version: 1`；结构 = `PlayerProfile.to_dict()`。
- Godot 存 `user://save1.json`；**JS 对应 localStorage 单 key**。
- **存档时机**：新开局 / hub 内每次操作 / 战斗胜利结算后 / 远征层间。
- **读档时机**：仅 hub 启动。

## 12. 音频（AudioManager）

- SFX 按**基名分组** `_01.._0N` 变体随机轮换；**8 路播放池**；**Music / SFX 双总线**；音量（master/sfx/music/mute）存 `settings`，滑块即时生效。
- `play_event(event)`：战斗事件类型 → 音效映射（经 `command_executed` 事件回放，纯表现层）。
- `play_skill`：**签名绝技专属音**（风雪/垂杨柳/蒋门神/五雷），其余按 ult / 远程 / 近战归类。
- 缺曲静默（不报错）。**JS 用 WebAudio 合成重建同接口**（源项目 SFX/BGM 本身即程序合成 chiptune，替换路径不变）。

---

## 13. 游戏流程状态机

```
启动 → hub（读档 / 新游戏）
hub 主菜单六入口：出征 / 演武场 / 梁山远征 / 武将 / 山寨 / 设置（另有「重新开局」）
进战斗三路径：current_level_id（出征/挑战/日常） | custom_level = arena（演武场） | expedition（远征）
battle 取关优先级：expedition > custom_level > current_level_id
→ setup_level → PVP 模板（arena 时）→ apply_profile_to_deployed
→ 布阵（远征跳过：自动落位 + 生命 carryover）
→ 战斗结束分支：
   远征：胜 → floor+1，>10 层 finish_run 结算回 hub，否则三选一奖励 → 存档 → reload 下一层；
         败 → finish_run 结算回 hub
   常规：compute_result → Flow.apply_battle_result → save → 结算面板 → 回 hub；
         失败不结算不存档直接回 hub
```

## 14. Hub UI 功能清单

- **主菜单**：资源栏（金币/碎片/技能书/突破材料/当前章）；六入口 + 重新开局。
- **出征**：关卡列表（✓ 已通关标记、章节、推荐等级；锁章置灰；≥7 章显示结局路线双关）；日常副本区；挑战关区。
- **演武场**：守方阵容配置 + 模板切换（steady/aggressive/protect_core）+ 开始切磋。
- **远征**：最佳纪录 + 规则说明 + 开始。
- **武将**：养成界面每将一行五按钮（升星/突破/强化/技能升级/专武解锁）+ 招募区（通用碎片 ×20）。
- **山寨**：三建筑行（等级/派驻/产出预览/升级/调岗）。
- **设置**：三滑块（master/sfx/music）+ 静音，即时生效并存档。

## 15. 战斗玩家交互流程

- **布阵**：候选条选中 → 点部署区空格上阵；点已上阵撤下（**必出不可撤**）；回车开战（校验必出）；候选 = `roster ∩ 拥有 ∩ allowed_classes`；迷雾关不展示敌方阵容与危险范围。
- **战斗**：
  - 激活时算 reachable（蓝格）；移动点数制可分段；
  - 普攻：点红圈敌人 / 橙圈障碍；
  - Q 主动技 / W 绝技（不可用时报原因；line 技能进入"待指向"状态，点敌人格给 aim）；
  - R 道具列表（self 直接用，其余选目标）；
  - E 夺取相邻物件；空格待机；F 集火；1/2/3 切托管；
  - ESC/右键取消层级：道具目标 → 道具列表 → 技能指向；
  - 激活结束 = 行动已用且移动力耗尽，或主动待机。

---

## 16. 决策日志（D3~D49 逐条，规则决定）

> 源：`docs/决策日志.md`（2026-07-18）。D1（脚本语言 GDScript）、D2（CSV 唯一数据源）为 Godot 期拍板，JS 版按本规格重写即可；D3 起为规则类决定，**重写必须遵守**。标注 ⚠️ 者为占位待策划确认。

**基础规则**

- **D3 CTB 平局**：速度高者优先 → 我方优先（team 枚举小者）→ unit_id 字典序。
- **D4 移动**：4 方向；友军可穿不可停；敌军不可穿；障碍不可通行。
- **D5 朝向与背刺**：单位持 facing（4 向），初始按阵营（我方朝上/敌方朝下），移动与攻击后更新；攻击方向与目标朝向一致 = 背刺 +25%，垂直 = 侧击 +10%，相对 = 正面 +0。
- **D6 加算乘区**：方位 + 高低差 + 光环合并为单一加算乘区 `(1 + Σ)`；暴击 ×1.5 独立乘区。（后 D42 修正：光环改走属性% 乘区，见 D42。）
- **D7 怒气占位 ⚠️**：受击 +10（普攻 +20 / 技能 +10 / 待机 +15 / 击杀 +30）。
- **D8 开发顺序**：CTB 与伤害结算提前实现（历史决定，JS 版无关）。
- **D9 攻击范围**：range_min–range_max 曼哈顿区间（后被 D47 武器模板细化）。

**数据与随机**

- **D10 调试关占位**：调试关敌方由绿将客串（debug_01 沿用）。
- **D11 测试框架**：GUT（Godot 专用，JS 版自选）。
- **D12 RollSource 抽象**：产出 `[0,100)` 判定值；生产带种子、测试固定序列（GDScript 原生类静态分派才需此抽象，JS 版保留接口语义即可）。
- **D13 调试场景无中文**（历史决定，JS 版无关）。
- **D14 无参原子效果**：`pull_to_front / swap_position / sure_hit` 无括号，args 为空。
- **D15 Buff 口径**：同 buff_id 刷新不叠层（duration 取 max）；CSV `0.3 = 30%`；`move_mod` 直接给格数；dodge/block/crit 概率点相加，atk/def/mgc/spd 百分比乘区；`dispel(n)` 只驱可驱散减益；待机 +20% 防御 = 1 回合不可驱散 buff。
- **D16 DoT 每跳 = 最大生命 5%**（⚠️ 待策划确认；与火堆对齐）。

**回合与流程**

- **D17 行动预览条**：非破坏性 CTB 沙盘推演；假设行动后 AV = 1000÷基础速度。
- **D18 地形回合效果**：统一在持有者回合开始结算：营帐回 8%、火堆烧 5%、水面当回合移动 -1（水军系免疫）。
- **D19 治疗公式 ⚠️**：`heal(倍率)` = 施法者当前谋略 × 倍率。
- **D20 测试类型陷阱**（GDScript 专用，JS 版无关）。

**技能与效果**

- **D21 范围模板与修正类**：adjacent/diamond = 曼哈顿；ring = 切比雪夫；line = 同横/纵线贯穿（手动施放需指向格）；all = 全图；self = 自身。修正类（bonus_*/sure_hit/hit_rate/target_rule/execute_below/random_target/friendly_fire/refresh_on_kill）前置扫描进 ctx.mods，与书写顺序无关。`bonus_by_self_lost_hp(k)`：倍率 ×(1+k×已损血比)；高防阈值暂定 def ≥ 100。
- **D22 控制与再动 ⚠️**：stun/paralyze/sleep = 跳过行动；sleep 受击解除；bind = 不可移动可行动；结算次序 = 先 DoT/地形 → 判行动能力 → 再减 buff 回合数；再动 = AV 清零而非重置（extra_action_pending）；is_elite 挂 Unit 上。
- **D23 多目标口径**：AOE 逐目标完整执行效果序列；pull 逐格拉近遇阻即停不改朝向；target_rule(lowest_hp) 只留血最少；random_target(n) 不放回抽取；friendly_fire 逐个 roll；execute_below 血比 ≤ v 直接致死（事件带 executed）。
- **D24 冷却与怒气**：冷却按持有者回合开始 -1（与 buff 同节拍），施放成功后 set_cooldown；绝技 rage_cost=100；无目标或条件不足报错且不消耗。
- **D25 怒气先扣后算**：目标解析通过后、效果结算前扣 rage_cost；技能过程中的回怒累积到扣后余额（林冲满怒绝技击杀后怒气为 30）。

**AI**

- **D26 评分制 AI 落地**：权重 CSV 化（7 职业 × 6 因子）；行动得分 = 伤害期望×w + 击杀 50×w + 目标价值×w + 危险度×w + 覆盖 10/人×w + 站位×w + 职业特殊项；占位项 ⚠️（support 目标价值取 15；危险度只按敌人当前位置；无行动可出时每格 +2 向敌接近）；半自动绝技门按职业逐条实现，SEMI 模式我方生效，敌方与 FULL 不限；集火 +100 死亡自动清除；攻击者地形修正按当前格读取。
- **D38 AI 目标行为**：COLLECT 我方 AI 靠近并夺取（相邻 120、接近 100−2d）；ESCORT 护送本人趋向目标区最高优先（250−3d）；持 act_yaojiu 者优先进酒摊；collectable 物件三处排除（杨志不砸自己的镖）；ENTER_ZONE who 支持具体 unit_id；教学新兵用于第一章；模拟主线胜率 90–100%。
- **D45 AI 占位收口**：先锋敌我连线格 +25（严格线段内部，叉积共线 + 点积判区间，每落点一次）；谋士控制命中高价值 +40（高价值线 = 30）；辅助/医者增益命中核心 +25；_aura_coverage 改读真实光环（落点被罩 +1/源，自身是源按罩住队友 +1/人）；核心标记改认 bond_ 前缀，满怒代理保留 +15；医者无治疗需求不放治疗、增益按辅助同口径；AI 评估敌方技能滤掉 friendly_fire 卷入的友军；酒摊候选补危险度折算，场上有空酒摊时药酒不当普通技能放；增援落点被占 BFS 外扩。
- **D46 移动拆段**：点数制，MoveCommand 按路径消耗扣减、超耗拒绝；不限段数；激活结束 = 行动+移动力耗尽或待机；AI 仍单段移动。

**关卡与触发器**

- **D28 关卡口径**：round = 全体存活非物件各行动一次（再动不重复计数，死亡即时移出）；胜负评估次序 = 我方全灭 → 失败条件（TURN_LIMIT 为 round_count > turns）→ 胜利条件 → 敌方全灭（COLLECT/ESCORT 除外）；OCCUPY 连续回合计数中断清零；ESCORT 进区即胜死亡即败；触发器 on（TURN/UNIT_DEAD/HP_BELOW/ENTER_ZONE）+ actions（spawn/dialogue/terrain/buff），once 默认 true，移动类事件都检查 ENTER_ZONE；布阵 = 必出自动落位（可调整不可撤）+ 候选手动；危险范围热力图按「敌方移动力+射程」曼哈顿覆盖近似；LevelConfig 代码构建（.tres 待迁）；物件复用 summon 口径，COLLECT 经 collect() 计数。
- **D31 生辰纲落地**：enemies.csv 与武将同 schema 并入查询空间（数值视为终值不走养成）；InteractCommand 引导（相邻、耗行动）→ 下次回合开始收讫，受任何伤害打断（含 DoT）；alert 特性首次睡眠减为 1 回合（⚠️ 两处文案不一致，取触发器表口径）；tick_effect 新增 hot；触发器扩展 on=START、if（collect_below/unit_deployed）、actions（status/regen/achievement_path/buff.unit）；「不击杀」按击杀者阵营记录（_kill_teams），NPC 友军击杀不阻断（⚠️）；同组互斥取先列出者；酒摊为可通行地形（ENTER_ZONE 触发）；老都管随机鼓劲 = target_rule(random)。
- **D49 迷雾与职业限定**：迷雾只隐藏布阵阶段敌情（阵容+热力图），不做全图战争迷雾；allowed_classes = UI 过滤 + 逻辑层硬校验（含必出自动落位同一入口）；实例 = challenge_majun 与 daily_mat_1。

**养成与 meta**

- **D29 养成公式占位 ⚠️**：升级 100×N；每级全属性 +2%；升星每星 +10% 叠乘，碎片 10×目标星级；突破满 5 星绿→蓝→紫→橙每档 +8% 保持星数；武器强化 ≤10 每级攻 +3%（金 100×目标级）；精炼 ≤5 每阶 +5%；技能 ≤5 每级效果 +5%（书 = 目标级 ×1），倍率经 unit.hero 进战斗；羁绊同队同场攻防 +5%（不可驱散全场），双向各计一份。
- **D30 存档**：单文件 JSON 带 version；新档 = 初始三将 + 金 2000/碎片 20/书 5/材料 3。
- **D32 核心循环**：主场景 hub；通关经验 30+20×章（上阵人人有份，⚠️ 占位）；章节按 progress.chapter 解锁、通关章节终关进下一章；武将解锁 = 「第N章通关解锁」通关终关发 /「第N章剧情加入」抵达发 /「聚义厅招募」碎片 ×20；首通/常规按 cleared；成就永久；必出自动落位后 apply_profile_to_deployed 补养成数值；中文字体 Noto Sans CJK SC。
- **D33 山寨与手柄**：三建筑上限 3 级（升级 500×级）；每通关收获一轮（金 100×级/材料 1×级/全员经验 30×级）；派驻一岗一人 +25%，汤隆驻铁匠铺再 +25%；手柄映射（Deck 适配基础，JS 版可缓）。
- **D34 玩法模式**：日常副本无体力/次数限制（⚠️）；6 关经验/金币/材料 ×2 档，经验本 exp_override 覆盖；LevelConfig.mode（story/daily/arena/expedition）；异步 PVP 本地镜像闭环（联网真 PVP 列阻塞）；守方三模板原值落地；守方默认等级前 4；演武场奖励金 300 + arena_point ×1。
- **D35 远征与专武 ⚠️**：远征 = 等级前 4、10 层、每层全属性 +12%、生命比率跨层继承、阵亡不进下赛季、每层三选一（休整 30%/攻+10/防+10）、每层 200 金 + 每 3 层 1 材料、记最佳层数、5/9 层精英 10 层杨志；跳过手动布阵自动落位，层间 reload；专武 = 3 星 + 材料 ×5，MORPHS 注册表（汤隆破甲溅射 2 格），ctx.mods.signature_morph + 合并制。
- **D36 第二批将与水战**：徐宁/张顺/王英/龚旺/丁得孙/燕青 6 将；解锁占位（徐宁 = 第4章剧情加入，其余聚义厅招募）；units.csv 新增 traits 列；water_walker 水面进入消耗按 1、不吃移动 -1，Grid.move_cost_of 统一处理。
- **D37 评价与挑战关解锁**：rank_rules 全满足 = S 其余通关 = A，无规则固定 A；我方阵亡经 _player_deaths；unlock_grant {unit, requires_rank}（清风寨 S→花荣、霹雳火→秦明、东昌府→张清）；challenge 模式独立于章节门槛；徐宁按「剧情加入按抵达」通关生辰纲即入队。
- **D39 占位音频**：SFX 全程序合成 chiptune，编号对齐外包规格，正式音频按同名文件整体替换接口不变；AudioManager 变体随机 + 8 路池；战斗音效走 command_executed 回放；签名绝技专属音；BGM 三首程序合成五声音阶循环曲（hub/战斗/结算），play_bgm() 接口预留；Music/SFX 双总线，音量存 settings。
- **D40 发布目标（用户拍板）**：桌面 app 直发优先（macOS/Windows），Steam 与 Deck 暂缓；手柄映射保留。
- **D43 战斗常数表**：怒气四常数与 AI 评分基准全部入 battle_constants.csv（50+ key），代码仅保留缺表 fallback 并告警；技能施放回怒 +10 走常数表（与普攻 +20 区分：普攻回怒是「效果」，技能回怒是「规则」）；被动/道具施放不产此怒气。
- **D44 拒马可破坏**：普攻可指定射程内 destructible 格；障碍无防/闪/格/暴，伤害 = atk 保底 1；归零变 plain（复用 Grid.set_terrain，AStar 自动刷新）；技能不能打障碍；AI 只在普攻候选为空时打、固定 3 分；「克制马军冲锋」不做。
- **D47 武器范围模板**：weapons.csv 33 武器名 → range_shape，数值射程用单位 range_min/max；枪矛 1-2 → line，弓弩投掷 → diamond，近战 1-1 → adjacent；飞枪 → diamond（弧线投掷语义）；line 不做遮挡判定；in_attack_range_from 统一普攻/打拒马/反击/AI 候选口径（假想落点计入 range_mod）。
- **D48 道具系统**：items.csv 第 9 张表；道具 = 效果序列 + 范围模板 + 目标规则 + 每局次数，全拼现有原子效果；ItemData.to_skill_data() 借道结算；首批 5 件；单目标指定（技能是范围全体），脚本化不传 target 退回技能同口径；使用 = 本激活行动（内部自置 action_used），不触发被动、不产施放怒气，伤害类道具的受击/击杀回怒走统一伤害路径；道具栏每局按表建标准栏（set_item_stock 预留 meta 对接）；AI 不使用道具。
- **D27 剩余原子效果**：mgc_dmg 同公式取谋略；swap 直接换位；push = pull 反向；guard 只拦远程（>1）；counter 武器范围内反击（深度 1 防互反）；teleport 落到「与最近敌人距离最小」的可站立格；steal_buff target=self 时从最近敌人偷；extra_action 列修正类、施放后给 AV 最小 n 名友军清零；av_mod 目标 AV ×=(1+v)；summon 相邻空格静态物件（耐久 300、不行动、可被攻击、不计胜负、不占 CTB）；aura 挂召唤物（无则自身）；hit_rate 提升为整技能对该目标判定。
- **D41 被动体系**：on_attack = 普攻/技能命中结算后；on_hit = 被攻击命中后；turn_start = 激活开始（DoT/buff 递减之后、移动力结算之前，被跳过的激活不触发）；target=self → 持有者，enemy → 涉事对方（on_attack→被攻击者，on_hit→攻击者），turn_start 必须 self；PassiveSystem 统一触发，只认指令行动者本人造成的伤害（反击/被动伤害不回流）；ctx.depth=1 防连锁；被动伤害不产怒气（mods.passive 跳过受击/击杀回怒）；新增 chance(p) 修饰词；30 将每人 2 被动（pas_ 前缀），敌方不配被动；validate 规则见 spec-data.md 第 4 节。
- **D42 射程与光环修正**：山地 range_mod 接入 in_attack_range（攻击者脚下格加上限，下限不变），只影响普攻（含打拒马），技能范围不受理；enemies_in_range 只认 ENEMY 队；光环走 atk/def 属性%（Unit._with_mods），DamageCalculator 的 aura_mod 死参数废除（与 D6 书面口径有偏差，以本实现为准）；random_buff 经 RollSource 均匀选取。

---

## 17. 已完成 vs 半成品清单

### 17.1 已完成（源项目现状，JS 版应全量覆盖）

- **M1 战斗原型** ✅：CTB、伤害公式、移动/寻路、触发器、物件/夺取、被动、道具、评分制 AI、25+ 关。
- **M2 垂直切片（程序侧）** ✅：养成→布阵→战斗→资源→升级闭环、存档、中文 UI。
- **M3 EA 范围** ✅：7 章 15 关 + 双结局、30 将 + 8 敌方 + 16 预留、全玩法模式（主线/挑战/日常/演武场/远征）、专属武器、山寨经营。
- **美术** ✅（38/38 单位立绘）；**音频** ✅（SFX 30 + BGM×3，均程序合成、有正式素材替换路径）。
- **质量**：240 项单元测试全绿；数值模拟主线胜率 90–100%；决策日志 49 条。
- **桌面导出** ✅（macOS dmg / Windows exe）。

### 17.2 半成品 / 占位 / 暂缓（JS 版按口径保留或缓做）

- **weapon_refine（武器精炼）**：逻辑与数值已备（≤5 阶每阶攻 +5%），**无 UI 入口**（半成品）。
- **占位数值待策划平衡 ⚠️**：受击怒气 +10（D7）、DoT 5%（D16）、治疗公式（D19）、控制状态行为（D22）、养成全公式（D29）、日常副本无体力限制（D34）、远征数值（D35）、通关经验公式（D32）。
- **LevelConfig 代码构建**：.tres 设计师工作流未迁（D28）；JS 版可直接用 JSON/JS 数据文件。
- **背包/商店系统本体不做**：道具栏已按 items.csv 建标准栏，`set_item_stock` 为对接预留（D48）。
- **联网异步 PVP 服务器**：暂缓；本地镜像闭环已可玩（D34）。
- **Steam 接入 / Steam Deck 验证**：暂缓（D40）；成就映射、云存档封存。
- **同名卡碎片 / 同名武器材料规则**：后续（D29）；宝石/套装后续版本。
- **拒马「克制马军冲锋」**：不做（冲锋机制不存在，D44）。
- **远征自选编队**：后续（现为等级前 4）。
- **手柄映射**：Godot 期已留（D33），JS 桌面版可缓。
- **人工数值试玩**：源项目最高优先阻塞项；JS 版数值先照抄 CSV，后续同样以改表调优。
