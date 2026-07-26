# 数据层与关卡规格（spec-data）

> 本文是 Godot 版《水浒战棋》数据层（CSV + DataLoader + 关卡配置）移植到 Three.js（JS）的规格依据。
> 源实现：`src/autoload/data_loader.gd`、`src/data/*.gd`、`src/levels/level_registry.gd`。
> 本项目 `data/` 已复制源项目全部 9 个 CSV + `reserved_units.txt`，**数值以 CSV 文件为准**，本文给出结构、规律与全量关卡定义。

---

## 1. 总原则

- **CSV 是唯一数据源**：禁止在代码里硬编码数值；改数值 = 改表重进游戏。
- **中文直接写在 CSV 原文**（units/skills 等表内中文列）；Godot 的 `.translation` 文件**忽略**（JS 版不需要）。
- 数据文件清单（`data/`）：

| 文件 | 行数（含表头） | 说明 |
|---|---|---|
| `units.csv` | 31（30 武将，含 1 空行） | 我方武将 |
| `enemies.csv` | 9（8 敌方/NPC 单位） | 与 units 同构，并入同一查询空间 |
| `skills.csv` | 95（94 技能） | 含 BOM |
| `terrains.csv` | 10（9 地形） | CRLF 行尾 |
| `weapons.csv` | 34（33 武器） | 武器→普攻范围形状 |
| `items.csv` | 6（5 道具） | |
| `progression.csv` | 16（15 参数） | key-value |
| `battle_constants.csv` | 55（54 常数） | key-value |
| `ai_weights.csv` | 8（7 职业） | AI 权重 |
| `reserved_units.txt` | 16 名 | 预留武将（未实装），供羁绊校验 |

---

## 2. CSV Schema（逐表列名）

### 2.1 units.csv / enemies.csv（同构，22 列）

```
unit_id, name, nickname, star, quality, class,
hp, atk, def, mgc, spd, crit, dodge, block, move, range_min, range_max,
weapon, skill_signature, bonds, unlock, traits
```

- `star` 为星号名（天雄星等，非数值）；`quality ∈ {green, blue, purple, orange}`；`class ∈ {vanguard, infantry, cavalry, archer, strategist, healer, support}`。
- `bonds` 格式：`目标unit_id或预留名|羁绊名;…`（例：`lu_zhishen|结义;cao_zheng|师徒`）。
- `unlock` 为中文解锁渠道（初始武将 / 第N章通关解锁 / 第N章剧情加入 / 聚义厅招募 / 挑战关「X」…，BOSS/杂兵/NPC 为敌方标记）。
- `traits` 分号列表（`alert` 警觉 / `water_walker` 水军）。

### 2.2 skills.csv（13 列，含 UTF-8 BOM）

```
skill_id, name, owner, type, trigger, range_shape, range_min, range_max, target,
cooldown, rage_cost, effects, desc
```

- `type ∈ {active, passive, ult}`；`trigger ∈ {manual, on_attack, on_hit, turn_start}`；
- `range_shape ∈ {adjacent, line, ring, diamond, all, self}`；`target ∈ {enemy, ally, self}`；
- `effects` 为效果串（语法见 spec-battle.md 第 6 节）。

### 2.3 terrains.csv（11 列，CRLF 行尾）

```
terrain_id, name, move_cost, dodge_mod, def_mod, atk_mod, range_mod,
passable, destructible, hp, special
```

### 2.4 weapons.csv（3 列）

```
weapon, range_shape, desc
```

### 2.5 items.csv（9 列）

```
item_id, name, range_shape, range_min, range_max, target, uses_per_battle, effects, desc
```

### 2.6 progression.csv / battle_constants.csv（key-value 3 列）

```
key, value, desc
```

### 2.7 ai_weights.csv（7 列）

```
class, damage_expect, kill_bonus, target_value, danger, aura_coverage, position
```

### 2.8 reserved_units.txt

一行一个 unit_id；`#` 开头为注释。

---

## 3. DataLoader API 与加载

### 3.1 API

- `get_unit(id)` / `get_skill(id)` / `get_terrain(id)` / `get_item(id)`。
- `get_skill_for_unit(unit_id, type)`：**线性扫** skills，返回 owner 与 type 都匹配的**第一个**。
- `get_passives_for_unit(unit_id, trigger)`：`type == passive && trigger 匹配 && owner 匹配` 的全部。
- `get_ai_weights(class_id)`：缺失退回**全 1.0** 并告警。
- `get_constant(key, default = 0.0)`：缺 key 告警返回 default。
- `get_weapon_shape(weapon_name)`：未登记退回 `diamond` 并告警。
- `default_item_stock()`：`{item_id: uses_per_battle}`（写进表即全员可用）。

### 3.2 加载顺序（load_all）

```
terrains → skills → units（快照 hero_ids = 纯武将名单）
→ enemies 并入 units（id 冲突报错）→ ai_weights → progression
→ battle_constants → weapons → items → reserved
```

### 3.3 CSV 解析细则

- **BOM 跳过**（检测 `EF BB BF`）；**表头 = 第一行**；
- 列数 ≠ 表头列数的行：**若整行只有一个空单元格则静默跳过**（尾部空行），否则告警跳过；
- `int()` 非法值归 0；分号列表解析去空项；
- 重复 id（unit/skill/terrain/weapon/item）报错。

---

## 4. validate() 校验规则全清单

**单位（含 enemies 并入后全部）**：

1. `quality ∈ {orange, purple, blue, green}`；
2. `class ∈ {vanguard, infantry, cavalry, archer, strategist, healer, support}`；
3. 职业必须在 ai_weights.csv 有行；
4. `skill_signature` 非空时必须存在于技能表；
5. `weapon` 非空且已登记 weapons.csv；
6. 每个羁绊目标必须在 units 或 reserved 中；
7. 11 个数值字段（hp/atk/def/mgc/spd/crit/dodge/block/move/range_min/range_max）**非负**。

**技能**：

8. type / trigger / range_shape / target 均在词表内；
9. `cooldown / rage_cost >= 0`；
10. 被动规则：`trigger != manual`；`target ∈ {self, enemy}`（不得 ally）；`turn_start` 必须 `target == self`；`cooldown == 0 && rage_cost == 0`；
11. 每条 `effects` 必须可解析（parse_effects 失败报错并指出技能 id/效果名）。

**被动配额**：

12. **每名武将（units.csv，不含敌方）恰好 2 个被动**。

**地形**：

13. `move_cost >= 0`；`move_cost == 99`（不可通行）必须 `passable = 0`。

**武器**：

14. range_shape 在词表内。

**道具**：

15. 道具表非空；range_shape / target 在词表内；`uses_per_battle >= 1`；`range_min >= 0 && range_max >= range_min`；效果串非空可解析；**每个效果 ∈ KNOWN_EFFECTS**；**禁含 refresh_on_kill / extra_action**（技能指令专属后处理）。

**key-value 表**：

16. progression.csv **15 必备键**：`level_exp_base, level_stat_growth, star_stat_mult, star_max, star_shard_cost, breakthrough_stat_step, skill_level_max, skill_level_mult, skill_book_cost, weapon_enhance_max, weapon_enhance_atk, weapon_enhance_gold, weapon_refine_max, weapon_refine_atk, bond_stat_bonus`；
17. battle_constants.csv 非空且含 **54 必备键**（怒气 4 键 + ai_* 50 键，全表见 spec-battle.md 第 15 节）。

---

## 5. LevelConfig 完整 schema

```js
{
  id: string,                 // 关卡 id
  name: string,               // 显示名
  mode: "story" | "daily" | "challenge" | "arena" | "expedition",  // 默认 "story"
  ending: string,             // 结局路线 id："zhaoan" | "kangzhao" | ""（空=非结局关）
  chapter: int,               // 章节（默认 1）
  recommended_level: int,     // 推荐等级
  exp_override: int,          // 覆盖通关经验（0 = 按 30+20×章 公式）
  pvp_template: string,       // PVP 守方策略模板 id（arena；空=无修正）
  grid_size: [w, h],          // 默认 [8, 8]
  terrain_map: { "x,y": terrain_id },   // 稀疏坐标表，未列出 = plain
  height_map: { "x,y": int },           // 缺省 0

  win_condition:              // 六选一
    { type: "WIPE_OUT" }
    | { type: "KILL_BOSS" }
    | { type: "SURVIVE_TURNS", turns: int }
    | { type: "COLLECT", target: string, count: int }
    | { type: "ESCORT", unit: unit_id, zone: [x, y, w, h] }
    | { type: "OCCUPY", zone: [x, y, w, h], turns: int },
  lose_conditions: [          // 每条三选一
    { type: "WIPED_OUT" }
    | { type: "TURN_LIMIT", turns: int }
    | { type: "ESCORT_DEAD", unit: unit_id } ],

  // 布阵
  required_units: [unit_id],  // 必出（自动落位，可调整不可撤）
  roster: [unit_id],          // 候选池（必出之外的备选）
  deploy_zone: [x, y, w, h],  // 部署区
  max_deploy: int,            // 上阵上限（含必出）

  // 特殊机制
  fog: bool,                  // 迷雾：布阵阶段敌方阵容与危险范围不展示（开战正常可见）
  allowed_classes: [class],   // 限定职业（空=不限；UI 过滤 + 逻辑层硬校验）

  // 单位配置
  npc_allies: [{ unit, coords, elite?, boss?, stat_mult? }],
  enemies: [{ unit, coords, elite?, boss?, stat_mult? }],
  objects: [{ id, coords, hp }],        // 场景物件（collectable）

  // 触发器（on/if/actions 语法见 spec-battle.md 第 4 节）
  triggers: [{ id, once = true, on: {...}, if?: {...}, actions: [...] }],

  rewards: { first_clear: {...}, regular: {...} },
  rank_rules: { s_max_rounds: int, s_no_death: bool },  // 空表不参与评价（固定 A）
  unlock_grant: { unit: unit_id, requires_rank?: "S" }, // 通关/达评价后发将
  achievements: [{ id, name, exclusive_group?, requires: { path? / no_player_kills? / boss_dead? } }],
}
```

坐标在源码中为 `Vector2i(x, y)` / `Rect2i(x, y, w, h)`；JS 版建议 `{x, y}` / `{x, y, w, h}` 或数组，全项目统一即可。

---

## 6. 关卡全量转录（26 关）

> 源：`src/levels/level_registry.gd`。`list_ids()`（章节顺序，含 debug_01，不含挑战/日常）：
> `ch01_01…ch01_05, ch02_01, ch02_02, ch03_01, ch04_01, ch04_02, ch05_01, ch05_02, ch06_01, ch06_02, ch06_03, ch07_01a, ch07_01b, debug_01`；
> 挑战关：`challenge_dongchang, challenge_majun`；日常副本：`daily_exp_1/2, daily_gold_1/2, daily_mat_1/2`。
> 坐标写法 `(x,y)`；区域写法 `[x,y,w,h]`；地形键省略引号。

### 6.0 公共底

**教学关公共底 `_teaching_base(id, name, rec_level)`**：chapter=1；grid 8×8；win `WIPE_OUT`；lose `[WIPED_OUT]`；required `[shi_yong]`；roster `[song_wan, du_qian]`；deploy `[0,6,8,2]`；max_deploy 4；rewards `{first_clear: {gold: 400, breakthrough_mat: 1}, regular: {gold: 120}}`。

**日常副本公共底 `_daily(id, name, rec, exp_override, rewards, enemies, fog=false)`**：mode=`daily`；无 chapter 门槛；grid 8×8；terrain `{(2,2): forest, (5,3): hill}`；height `{(5,3): 1}`；win `WIPE_OUT`；lose `[WIPED_OUT]`；required `[]`；roster = 24 将全池 `[lin_chong, lu_zhishen, wu_song, gongsun_sheng, wu_yong, hua_rong, li_kui, qin_ming, zhang_qing, hu_sanniang, dai_zong, shi_qian, sun_erniang, an_daoquan, cao_zheng, jiao_ting, bao_xu, yu_baosi, bai_sheng, tang_long, shi_yong, song_wan, du_qian, wang_dingliu]`；deploy `[0,6,8,2]`；max_deploy 5。

### 6.1 第一章：教学序列（ch01_01 ~ ch01_05）

**ch01_01「教学·移动与攻击」**（rec 1，教学底）
- enemies：`xiangjun_recruit (4,2)`、`xiangjun_recruit (5,2)`
- triggers：
  - t1（once，on START）：
    - dialogue：「【教学】左键点蓝色高亮格移动，点红圈敌人攻击。速度快的一方可能连续行动。」
    - dialogue：「石勇：官兵围上来了，兄弟们，跟我顶住！」

**ch01_02「教学·地形与走位」**（rec 2，教学底）
- terrain：`{(2,2): forest, (3,2): forest, (2,3): forest, (5,3): hill, (6,3): hill, (4,4): barricade}`
- height：`{(5,3): 1, (6,3): 1}`
- enemies：`xiangjun_recruit (4,1)`、`xiangjun_recruit (5,1)`
- triggers：
  - t1（once，on START）：dialogue：「【教学】森林里闪避更高；高台打低处伤害更高；绕到敌人背后是背刺加成。」

**ch01_03「教学·技能与怒气」**（rec 3，教学底）
- enemies：`xiangjun_recruit (4,2)`、`xiangjun_recruit (5,2)`、`xiangjun_recruit (4,1)`
- triggers：
  - t1（once，on START）：dialogue：「【教学】Q 放主动技，W 放绝技（怒气满 100）。攻击、受击、待机都会攒怒气。」

**ch01_04「坚守·山寨大门」**（rec 4，教学底；覆盖 win）
- win：`SURVIVE_TURNS turns=5`
- terrain：`{(3,3): camp, (4,3): camp, (2,2): barricade, (5,2): barricade}`
- enemies：`xiangjun_spear (3,0)`、`xiangjun_spear (4,0)`、`xiangjun_shield (2,1)`、`xiangjun_shield (5,1)`
- triggers：
  - t1（once，on START）：dialogue：「【教学】坚守 5 回合即胜，不必硬拼。营帐格每回合回血。」
  - t2（once，on TURN turn=3）：
    - dialogue：「官军增援从北面杀到！」
    - spawn：`[{unit: xiangjun_spear, coords: (4,0), team: "enemy"}]`

**ch01_05「头目·都监亲兵」**（rec 5，教学底；覆盖 win/rewards）
- win：`KILL_BOSS`
- enemies：`lao_duguan (4,1) elite boss`、`xiangjun_recruit (3,2)`、`xiangjun_recruit (5,2)`、`pai_recruit (4,2)`
- triggers：
  - t1（once，on START）：dialogue：「【教学】斩杀头目即胜。老都管会给亲兵鼓劲，优先集火（F 键标记）。」
- rewards：`{first_clear: {gold: 800, breakthrough_mat: 2}, regular: {gold: 200}}`

### 6.2 第二章：七星聚义

**ch02_01「聚义·东溪村」**（rec 8）
- grid 8×8；terrain `{(2,2): forest, (3,2): forest, (4,4): road, (4,3): road}`
- win `WIPE_OUT`；lose `[WIPED_OUT]`
- required `[shi_yong]`；roster `[song_wan, du_qian, wang_dingliu]`；deploy `[0,6,8,2]`；max_deploy 4
- npc_allies：`chao_gai_npc (3,5)`
- enemies：`xiangjun_spear (3,1)`、`xiangjun_spear (4,1)`、`xiangjun_spear (5,1)`、`xiangjun_shield (4,2)`
- triggers：
  - t1（once，on START）：
    - dialogue：「晁盖：官兵查到东溪村来了！诸位兄弟，随我杀出去！」
    - dialogue：「【教学】绿圈是 AI 操控的友军，会自行作战。」
- rewards：`{first_clear: {gold: 600, breakthrough_mat: 1}, regular: {gold: 150}}`

**ch02_02「突围·石碣村」**（rec 10；ESCORT 教学）
- grid 10×8；terrain：x=4 整列 `(4,0..7): road`；`{(1,2),(2,2),(7,3),(8,3)}: forest`
- win：`ESCORT unit=chao_gai_npc zone=[0,0,10,1]`；lose `[WIPED_OUT, ESCORT_DEAD unit=chao_gai_npc]`
- required `[shi_yong]`；roster `[song_wan, du_qian, wang_dingliu]`；deploy `[0,6,10,2]`；max_deploy 4
- npc_allies：`chao_gai_npc (4,6)`、`liu_tang_npc (5,6)`
- enemies：`xiangjun_spear (3,2)`、`xiangjun_spear (5,2)`、`xiangjun_shield (4,2)`、`xiangjun_shield (4,1)`、`lao_duguan (4,0) elite`
- triggers：
  - t1（once，on START）：dialogue：「【教学】护送晁盖抵达北面村口（第一排）即胜；晁盖阵亡即败。」
  - t2（once，on TURN turn=3）：
    - dialogue：「两侧芦苇荡杀出伏兵！」
    - spawn：`[{unit: xiangjun_spear, coords: (1,3), team: "enemy"}, {unit: xiangjun_spear, coords: (8,2), team: "enemy"}]`
- rewards：`{first_clear: {gold: 800, breakthrough_mat: 2}, regular: {gold: 200}}`

### 6.3 第三章：智取生辰纲（示范关）

**ch03_01「智取生辰纲」**（rec 12；非歼灭胜利 + 场景互动 + 双路线彩蛋）
- grid 10×8
- terrain：x=4、x=5 两整列 road；`{(1,2),(2,2),(1,3),(2,3),(1,4),(2,4),(7,2),(8,2),(7,3),(8,3),(7,4),(8,4)}: forest`；`{(8,0),(9,0),(9,1)}: hill`；`{(6,4): wine_stall}`
- height：`{(8,0): 1, (9,0): 1, (9,1): 1}`
- win：`COLLECT target=cargo count=3`；lose `[WIPED_OUT, TURN_LIMIT turns=10]`
- required `[wu_yong, bai_sheng]`；roster `[lin_chong, lu_zhishen, gongsun_sheng, hua_rong, an_daoquan, li_kui]`；deploy `[0,6,10,2]`；max_deploy 4
- npc_allies：`chao_gai_npc (3,5)`、`liu_tang_npc (6,5)`
- enemies：`yang_zhi_boss (5,2) elite boss`、`lao_duguan (4,2)`、`xiangjun_spear (3,2)`、`xiangjun_spear (6,2)`、`xiangjun_spear (3,3)`、`xiangjun_spear (6,3)`、`xiangjun_shield (4,1)`、`xiangjun_shield (5,1)`
- objects：`cargo (4,3) hp300`、`cargo (5,3) hp300`、`cargo (4,4) hp300`
- triggers：
  - t1_intro（once，on START）：
    - dialogue：「吴用：杨志押的是梁中书的生辰纲，硬拼不得。白胜，看你的了。」
    - dialogue：「【教学】本关目标是夺取 3 副生辰纲担，不必全歼敌军。白胜进酒摊有妙用。」
  - t1b_gongsun（once，on START，if `unit_deployed unit=gongsun_sheng`）：
    - dialogue：「公孙胜：贫道夜观天象，今日黄泥冈上，合该有这一桩富贵。」
  - t2_drugged_wine（once，on `ENTER_ZONE zone=[6,4,1,1] who=bai_sheng`）：
    - dialogue：「白胜：「好酒！烈得很哪——」杨志军汉饮了蒙汗药，一个个都倒了！」
    - status：`{side: "enemy", status: "sleep", duration: 2, except: {unit: "yang_zhi_boss", duration: 1}, name: "蒙汗药酒"}`
    - buff：`{unit: "bai_sheng", field: "atk", value: 20, duration: 99, name: "生辰纲功臣"}`
    - achievement_path：`{path: "drugged_wine"}`
    - dialogue：「【教学】敌军已麻倒，快夺取生辰纲！」
  - t3_yangzhi_rage（once，on `HP_BELOW unit=yang_zhi_boss ratio=0.5`）：
    - dialogue：「杨志：「羞刀难入鞘！」——杨志攻势大振，枪枪拼命。」
    - buff：`{unit: "yang_zhi_boss", field: "atk", value: 30, duration: 99, name: "羞刀难入鞘"}`
    - regen：`{unit: "yang_zhi_boss", percent: 5, duration: 99, name: "羞刀难入鞘·回血"}`
  - t4_reinforce（once，on TURN turn=6，if `collect_below target=cargo count=3`）：
    - dialogue：「老都管：援军到了！都给我顶住！」
    - spawn：`[{unit: xiangjun_spear, coords: (2,7), team: "enemy"}, {unit: xiangjun_spear, coords: (7,7), team: "enemy"}]`
  - t6_baisheng_down（once，on `UNIT_DEAD unit=bai_sheng`）：
    - dialogue：「杨志：「卖酒的贼厮，也敢算计爷爷！」——敌军士气大振。」
    - buff：`{side: "enemy", field: "atk", value: 10, duration: 99, name: "士气"}`
- （T5：夺取第 3 副担即通关，由 COLLECT 胜利条件承载。）
- rewards：`{first_clear: {shard_bai_sheng: 10, skill_book: 3, gold: 2000}, regular: {breakthrough_mat: 1}}`
- achievements：
  - `{id: "buzhan", name: "不战而屈人之兵", exclusive_group: "shengchengang", requires: {path: "drugged_wine", no_player_kills: ["xiangjun_spear", "xiangjun_shield"]}}`
  - `{id: "biaoshi", name: "黄泥冈镖师", exclusive_group: "shengchengang", requires: {boss_dead: "yang_zhi_boss"}}`

### 6.4 第四章：大闹清风寨

**ch04_01「清风寨·花灯夜」**（rec 14；S 评价解锁花荣）
- grid 10×8；terrain：x=4 整列 road；`{(2,2),(2,3),(7,2),(7,3),(3,5),(6,5)}: camp`；`{(1,3),(8,3),(1,4),(8,4)}: forest`
- win `WIPE_OUT`；lose `[WIPED_OUT]`
- required `[]`；roster `[lin_chong, lu_zhishen, wu_song, gongsun_sheng, wu_yong, bai_sheng, li_kui, xu_ning, shi_yong, song_wan, du_qian, an_daoquan]`；deploy `[0,6,10,2]`；max_deploy 5
- enemies：`lao_duguan (4,1) elite`（刘高亲兵头目占位）、`xiangjun_spear (3,1)`、`xiangjun_spear (5,1)`、`xiangjun_spear (4,2)`、`xiangjun_shield (3,2)`、`xiangjun_shield (5,2)`
- triggers：
  - t1（once，on START）：
    - dialogue：「花灯夜，清风寨前火光冲天。刘高的亲兵把守住各条巷口。」
    - dialogue：「【挑战】6 回合内无阵亡通关可获 S 评价，花荣闻讯来投。」
  - t2（once，on TURN turn=2）：
    - dialogue：「巷口两侧杀出伏兵！」
    - spawn：`[{unit: xiangjun_spear, coords: (0,2), team: "enemy"}, {unit: xiangjun_spear, coords: (9,2), team: "enemy"}]`
- rank_rules：`{s_max_rounds: 6, s_no_death: true}`
- unlock_grant：`{unit: "hua_rong", requires_rank: "S"}`
- rewards：`{first_clear: {gold: 1000, breakthrough_mat: 2}, regular: {gold: 250}}`

**ch04_02「霹雳火·秦明」**（rec 16；通关解锁秦明）
- grid 10×8；terrain：`{(3,3),(4,3),(5,3),(6,3)}: road`；`{(2,2),(7,2),(2,4),(7,4)}: hill`
- height：`{(2,2): 1, (7,2): 1, (2,4): 1, (7,4): 1}`
- win `KILL_BOSS`；lose `[WIPED_OUT]`
- required `[]`；roster `[lin_chong, lu_zhishen, wu_song, gongsun_sheng, wu_yong, bai_sheng, li_kui, xu_ning, hua_rong, shi_yong, song_wan, du_qian, an_daoquan]`；deploy `[0,6,10,2]`；max_deploy 5
- enemies：`qin_ming (4,1) elite boss stat_mult=1.5`、`xiangjun_spear (3,1)`、`xiangjun_spear (5,1)`、`xiangjun_shield (3,2)`、`xiangjun_shield (5,2)`
- triggers：
  - t1（once，on START）：
    - dialogue：「秦明：「反贼休走，吃我一棒！」——霹雳火当先来搦战。」
    - dialogue：「【挑战】击退秦明即胜。他攻高性烈，半血后愈发凶猛。」
  - t2（once，on `HP_BELOW unit=qin_ming ratio=0.5`）：
    - dialogue：「秦明怒火攻心，狼牙棒势如霹雳！」
    - buff：`{unit: "qin_ming", field: "atk", value: 20, duration: 99, name: "霹雳怒火"}`
- unlock_grant：`{unit: "qin_ming"}`
- rewards：`{first_clear: {gold: 1200, breakthrough_mat: 3}, regular: {gold: 300}}`

### 6.5 挑战关

**challenge_dongchang「挑战·东昌府张清」**（mode=challenge，chapter 4，rec 18；通关解锁张清）
- grid 10×8；terrain：`{(4,1),(4,2),(5,1),(5,2)}: hill`；`{(1,4),(2,4),(7,4),(8,4)}: forest`
- height：`{(4,1): 1, (4,2): 1, (5,1): 1, (5,2): 1}`
- win `KILL_BOSS`；lose `[WIPED_OUT]`
- required `[]`；roster `[lin_chong, lu_zhishen, wu_song, gongsun_sheng, wu_yong, bai_sheng, li_kui, xu_ning, hua_rong, qin_ming, shi_yong, song_wan, du_qian, an_daoquan]`；deploy `[0,6,10,2]`；max_deploy 5
- enemies：`zhang_qing (4,1) elite boss`、`gong_wang (3,2)`、`ding_desun (5,2)`、`xiangjun_shield (3,3)`、`xiangjun_shield (5,3)`
- triggers：
  - t1（once，on START）：
    - dialogue：「没羽箭张清坐镇东昌府，飞石打人百发百中。」
    - dialogue：「【挑战】龚旺、丁得孙两员副将护翼左右，先剪羽翼再擒主将。」
- unlock_grant：`{unit: "zhang_qing"}`
- rewards：`{first_clear: {gold: 1500, breakthrough_mat: 3}, regular: {gold: 350}}`

**challenge_majun「挑战·马军试炼」**（mode=challenge，chapter 5，rec 22；限定职业示范）
- grid 10×8；terrain：x=4、x=5 两整列 road；`{(1,2),(8,2),(1,5),(8,5)}: hill`
- height：`{(1,2): 1, (8,2): 1, (1,5): 1, (8,5): 1}`
- win `KILL_BOSS`；lose `[WIPED_OUT]`
- allowed_classes `["cavalry"]`
- required `[]`；roster（混排非马军，候选条只显示马军：林冲/秦明/扈三娘）`[lin_chong, wu_song, qin_ming, hua_rong, hu_sanniang, lu_zhishen, li_kui, an_daoquan]`；deploy `[0,6,10,2]`；max_deploy 3
- enemies：`yang_zhi_boss (4,1) elite boss`（官军马军教头占位）、`xiangjun_spear (3,2)`、`xiangjun_spear (6,2)`、`xiangjun_shield (4,3)`
- triggers：
  - t1（once，on START）：
    - dialogue：「官军马军教头立马校场，指名会一会梁山马军。」
    - dialogue：「【挑战】本关限马军上阵。敌枪兵克马，绕开正面、侧翼驰突。」
  - t2（once，on `HP_BELOW unit=yang_zhi_boss ratio=0.5`）：
    - dialogue：「马军教头：「好马！再来——」攻势愈发凶狠。」
    - buff：`{unit: "yang_zhi_boss", field: "atk", value: 20, duration: 99, name: "棋逢敌手"}`
- rewards：`{first_clear: {gold: 2000, breakthrough_mat: 4, skill_book: 2}, regular: {gold: 400}}`

### 6.6 第五章：江州劫法场

**ch05_01「江州·劫法场」**（rec 18）
- grid 10×8；terrain：`{(4,2..5),(5,2..5)}: road`（x=4、x=5 两列的 y∈[2,5]）；`{(1,1),(8,1),(1,6),(8,6)}: barricade`
- win `WIPE_OUT`；lose `[WIPED_OUT]`
- required `[li_kui]`；roster `[lin_chong, lu_zhishen, wu_song, gongsun_sheng, wu_yong, bai_sheng, dai_zong, xu_ning, hua_rong, qin_ming, an_daoquan, jiao_ting, bao_xu]`；deploy `[0,6,10,2]`；max_deploy 6
- enemies：`lao_duguan (4,0) elite stat_mult=1.5`（蔡九 proxy 占位）、`xiangjun_spear (3,0)`、`xiangjun_spear (5,0)`、`xiangjun_shield (3,2)`、`xiangjun_shield (6,2)`、`xiangjun_spear (3,3)`、`xiangjun_spear (6,3)`
- triggers：
  - t1（once，on START）：
    - dialogue：「午时三刻，法场四周刀枪如林。黑旋风从半空里跳将下来！」
    - dialogue：「李逵：「都闪开！砍翻他们一个不留！」」
  - t2（once，on TURN turn=2）：
    - dialogue：「城外官兵增援杀到！」
    - spawn：`[{unit: xiangjun_spear, coords: (0,1), team: "enemy"}, {unit: xiangjun_spear, coords: (9,1), team: "enemy"}]`
- rewards：`{first_clear: {gold: 1500, breakthrough_mat: 3}, regular: {gold: 350}}`

**ch05_02「白龙庙·江边断后」**（rec 20；水战展示）
- grid 10×8；terrain：y=7 整行 `(0..9,7): water`；`{(2,3),(7,3),(3,5),(6,5)}: forest`；`{(4,4),(5,4)}: camp`
- win `SURVIVE_TURNS turns=6`；lose `[WIPED_OUT]`
- required `[]`；roster `[lin_chong, lu_zhishen, wu_song, gongsun_sheng, wu_yong, bai_sheng, li_kui, dai_zong, xu_ning, hua_rong, qin_ming, an_daoquan, zhang_shun]`；deploy `[0,5,10,2]`；max_deploy 6
- npc_allies：`zhang_shun (4,7)`（水中接应，水战特性展示）
- enemies：`xiangjun_spear (3,0)`、`xiangjun_spear (4,0)`、`xiangjun_spear (5,0)`、`xiangjun_spear (6,0)`、`xiangjun_shield (4,1)`、`xiangjun_shield (5,1)`
- triggers：
  - t1（once，on START）：dialogue：「【教学】坚守 6 回合，船到即走。张顺在水中接应——他不受水面迟滞。」
  - t2（once，on TURN turn=2）：
    - dialogue：「官军第二波涌上江岸！」
    - spawn：`[{unit: xiangjun_spear, coords: (2,0), team: "enemy"}, {unit: xiangjun_spear, coords: (7,0), team: "enemy"}]`
  - t3（once，on TURN turn=4）：
    - dialogue：「官军弓手压上来了，再撑两回合！」
    - spawn：`[{unit: gong_wang, coords: (4,0), team: "enemy"}, {unit: ding_desun, coords: (5,0), team: "enemy"}]`
- rewards：`{first_clear: {gold: 1800, breakthrough_mat: 3}, regular: {gold: 400}}`

### 6.7 第六章：三打祝家庄

**ch06_01「一打·祝家庄前哨」**（rec 22）
- grid 10×8；terrain：x=4 整列 road；`{(2,2),(3,2),(6,2),(7,2),(2,5),(7,5)}: forest`
- win `WIPE_OUT`；lose `[WIPED_OUT]`
- required `[]`；roster `[lin_chong, lu_zhishen, wu_song, gongsun_sheng, wu_yong, bai_sheng, li_kui, xu_ning, hua_rong, qin_ming, wang_ying, an_daoquan, zhang_qing]`；deploy `[0,6,10,2]`；max_deploy 6
- enemies：`xiangjun_spear (3,1)`、`xiangjun_spear (5,1)`、`xiangjun_shield (4,1)`、`xiangjun_shield (4,2)`、`gong_wang (4,0)`
- triggers：
  - t1（once，on START）：dialogue：「祝家庄外，吊桥高悬。庄丁平日横惯了，见人就杀。」
  - t2（once，on `ENTER_ZONE zone=[0,2,10,2] who=player`）：
    - dialogue：「两侧松林里冲出庄丁伏兵！」
    - spawn：`[{unit: xiangjun_spear, coords: (2,2), team: "enemy"}, {unit: xiangjun_spear, coords: (7,2), team: "enemy"}]`
- rewards：`{first_clear: {gold: 1800, breakthrough_mat: 3}, regular: {gold: 400}}`

**ch06_02「二打·盘陀路」**（rec 24；拒马拦路）
- grid 12×10；terrain：`{(3,2),(5,3),(7,4),(5,5),(3,6),(8,2)}: barricade`；`{(1,3),(2,3),(9,5),(10,5),(5,7),(6,7)}: forest`；`{(10,1),(11,1)}: hill`
- height：`{(10,1): 1, (11,1): 1}`
- win `WIPE_OUT`；lose `[WIPED_OUT]`
- required `[]`；roster `[lin_chong, lu_zhishen, wu_song, gongsun_sheng, wu_yong, bai_sheng, li_kui, xu_ning, hua_rong, qin_ming, wang_ying, an_daoquan, zhang_qing]`；deploy `[0,8,12,2]`；max_deploy 6
- enemies：`xiangjun_spear (4,2)`、`xiangjun_spear (6,3)`、`xiangjun_shield (5,2)`、`xiangjun_shield (7,3)`、`ding_desun (10,1)`、`gong_wang (11,1)`
- triggers：
  - t1（once，on START）：
    - dialogue：「盘陀路弯弯曲曲，到处都是拒马。白杨树才是转弯的记号……」
    - dialogue：「【教学】拒马挡路，绕行或打碎（约 3 次攻击）。山上飞叉冷箭，小心。」
  - t2（once，on TURN turn=3）：
    - dialogue：「后路又有庄丁包抄！」
    - spawn：`[{unit: xiangjun_spear, coords: (11,8), team: "enemy"}]`
- rewards：`{first_clear: {gold: 2000, breakthrough_mat: 4}, regular: {gold: 450}}`

**ch06_03「三打·祝家庄」**（rec 26；扈三娘战后入队）
- grid 12×10；terrain：x=5、x=6 两整列 road；`{(2,4),(9,4),(3,7),(8,7)}: camp`；`{(4,1),(7,1)}: barricade`
- win `KILL_BOSS`；lose `[WIPED_OUT]`
- required `[]`；roster `[lin_chong, lu_zhishen, wu_song, gongsun_sheng, wu_yong, bai_sheng, li_kui, xu_ning, hua_rong, qin_ming, wang_ying, an_daoquan, zhang_qing]`；deploy `[0,8,12,2]`；max_deploy 6
- npc_allies：`wang_ying (6,8)`
- enemies：`lao_duguan (5,0) elite boss stat_mult=2.0`（祝朝奉 proxy 占位）、`hu_sanniang (6,2) elite stat_mult=1.3`（战后入队）、`xiangjun_spear (4,2)`、`xiangjun_spear (7,2)`、`xiangjun_shield (4,3)`、`xiangjun_shield (7,3)`
- triggers：
  - t1（once，on START）：
    - dialogue：「祝朝奉门前，一丈青扈三娘纵马提刀杀出——好一个女将！」
    - dialogue：「王英：「这娘子交给我……哎哟！」（小心她的红棉套索）」
  - t2（once，on `UNIT_DEAD unit=hu_sanniang`）：
    - dialogue：「扈三娘被擒。宋江：「好生看护，不得无礼。」」
- rewards：`{first_clear: {gold: 2500, breakthrough_mat: 5}, regular: {gold: 500}}`

### 6.8 终章：大聚义（双路线）

**ch07_01a「终章·奉诏征辽」**（rec 28；ending=`zhaoan`）
- grid 12×10；terrain：x=5、x=6 两整列 road；`{(2,3),(9,3),(3,6),(8,6)}: hill`
- height：`{(2,3): 1, (9,3): 1, (3,6): 1, (8,6): 1}`
- win `KILL_BOSS`；lose `[WIPED_OUT]`
- required `[]`；roster `[lin_chong, lu_zhishen, wu_song, gongsun_sheng, wu_yong, hua_rong, li_kui, qin_ming, zhang_qing, hu_sanniang, xu_ning, an_daoquan]`；deploy `[0,8,12,2]`；max_deploy 8
- enemies：`yang_zhi_boss (5,1) elite boss stat_mult=1.6`（辽将 proxy 占位）、`xiangjun_spear (4,2) stat_mult=1.3`、`xiangjun_spear (7,2) stat_mult=1.3`、`xiangjun_shield (4,3) stat_mult=1.3`、`xiangjun_shield (7,3) stat_mult=1.3`、`gong_wang (3,2) stat_mult=1.3`、`ding_desun (8,2) stat_mult=1.3`
- triggers：
  - t1（once，on START）：dialogue：「奉旨讨辽！梁山军旗号改成了「顺天」——众兄弟，最后一战。」
  - t2（once，on TURN turn=3）：
    - dialogue：「辽军骑兵自两翼杀到！」
    - spawn：`[{unit: xiangjun_spear, coords: (0,2), team: "enemy", stat_mult: 1.3}, {unit: xiangjun_spear, coords: (11,2), team: "enemy", stat_mult: 1.3}]`
- rewards：`{first_clear: {gold: 3000, breakthrough_mat: 6}, regular: {gold: 600}}`

**ch07_01b「终章·抗诏再聚义」**（rec 28；ending=`kangzhao`）
- grid 12×10；terrain：y=9 整行 `(0..11,9): water`；`{(2,4),(9,4),(4,6),(7,6)}: camp`；`{(4,2),(7,2)}: barricade`
- win `WIPE_OUT`；lose `[WIPED_OUT]`
- required `[]`；roster `[lin_chong, lu_zhishen, wu_song, gongsun_sheng, wu_yong, hua_rong, li_kui, qin_ming, zhang_qing, hu_sanniang, xu_ning, an_daoquan]`；deploy `[0,7,12,2]`；max_deploy 8
- enemies：`qin_ming (5,1) elite stat_mult=1.6`（官军统制 proxy 占位）、`xiangjun_spear (4,2) stat_mult=1.3`、`xiangjun_spear (7,2) stat_mult=1.3`、`xiangjun_shield (4,3) stat_mult=1.3`、`xiangjun_shield (7,3) stat_mult=1.3`、`lao_duguan (6,0) elite stat_mult=1.4`
- triggers：
  - t1（once，on START）：
    - dialogue：「圣旨掷地于尘埃：「梁山贼寇，安敢不臣！」——官军水陆并进，围了山寨。」
    - dialogue：「众头领：「不让咱弟兄快活，就再打他个落花流水！」」
  - t2（once，on TURN turn=2）：
    - dialogue：「官军后继人马压上！」
    - spawn：`[{unit: xiangjun_spear, coords: (2,0), team: "enemy", stat_mult: 1.3}, {unit: xiangjun_spear, coords: (9,0), team: "enemy", stat_mult: 1.3}]`
  - t3（once，on TURN turn=4）：
    - dialogue：「水军自芦苇荡杀出，断了官军后路！」
    - spawn：`[{unit: zhang_shun, coords: (5,9), team: "npc"}]`
- rewards：`{first_clear: {gold: 3000, breakthrough_mat: 6}, regular: {gold: 600}}`

### 6.9 调试关

**debug_01「调试关卡」**（3 必出 + 候选池，演示 TURN/ENTER_ZONE 触发器）
- grid 8×8；terrain：`{(2,2),(3,2),(2,3),(5,5)}: forest`、`{(6,2),(6,3)}: hill`、`{(4,4)}: barricade`、`{(3,4)}: camp`、`{(1,5)}: water`、`{(4,0),(4,1)}: road`
- height：`{(6,2): 1, (6,3): 1}`
- win `WIPE_OUT`；lose `[WIPED_OUT]`
- required `[lin_chong, lu_zhishen, an_daoquan]`；roster `[wu_yong, hua_rong, li_kui, dai_zong, shi_qian, sun_erniang, cao_zheng, jiao_ting, bao_xu, yu_baosi]`；deploy `[0,6,8,2]`；max_deploy 6
- enemies：`shi_yong (5,1)`、`song_wan (4,1) elite`、`du_qian (6,1)`
- triggers：
  - t_reinforce（once，on TURN turn=2）：
    - dialogue：「敌军援军从北面赶到了！」
    - spawn：`[{unit: wang_dingliu, coords: (7,0), team: "enemy"}]`
  - t_mid（once，on `ENTER_ZONE zone=[0,3,8,2] who=player`）：
    - dialogue：「我军已突入中场，注意两侧松林伏兵。」

### 6.10 日常副本（6 关，自动战斗主战场，D34）

公共底见 6.0 `_daily`。

| id | name | rec | exp_override | rewards | enemies | fog |
|---|---|---|---|---|---|---|
| daily_exp_1 | 演武·新兵试炼 | 5 | 100 | first `{gold: 200}` / reg `{gold: 50}` | spear(3,1) spear(4,1) spear(5,1) shield(4,2) | 否 |
| daily_exp_2 | 演武·精锐试炼 | 12 | 200 | first `{gold: 400}` / reg `{gold: 100}` | spear(3,1) spear(5,1) shield(4,1) shield(4,2) spear(3,2) spear(5,2) | 否 |
| daily_gold_1 | 押镖·黄泥小道 | 6 | 0 | first `{gold: 800}` / reg `{gold: 600}` | spear(3,1) spear(4,1) shield(5,2) | 否 |
| daily_gold_2 | 押镖·官道风云 | 13 | 0 | first `{gold: 1500}` / reg `{gold: 1200}` | spear(3,1) spear(5,1) shield(4,1) shield(4,2) lao_duguan(4,0) elite | 否 |
| daily_mat_1 | 奇袭·辎重营 | 7 | 0 | first `{breakthrough_mat: 3}` / reg `{breakthrough_mat: 2}` | shield(3,1) shield(5,1) spear(4,2) | **是**（迷雾示范） |
| daily_mat_2 | 奇袭·军械库 | 14 | 0 | first `{breakthrough_mat: 6}` / reg `{breakthrough_mat: 4}` | shield(3,1) shield(5,1) spear(3,2) spear(5,2) lao_duguan(4,0) elite | 否 |

（spear = xiangjun_spear，shield = xiangjun_shield；均带公共底地形 `{(2,2): forest, (5,3): hill}` + height `{(5,3): 1}`。）

---

## 7. 数据表全量数值

### 7.1 units.csv（30 武将全量）

| unit_id | 名称 | 绰号 | 星号 | quality | class | hp | atk | def | mgc | spd | crit | dodge | block | move | range | 武器 | 签名技 | 羁绊 | 解锁 | 特性 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| lin_chong | 林冲 | 豹子头 | 天雄星 | orange | cavalry | 700 | 108 | 70 | 45 | 88 | 12 | 8 | 5 | 6 | 1-2 | 丈八蛇矛 | ult_fengxue | lu_zhishen\|结义; cao_zheng\|师徒 | 第4章通关解锁 | |
| lu_zhishen | 鲁智深 | 花和尚 | 天孤星 | orange | vanguard | 800 | 85 | 95 | 40 | 62 | 8 | 5 | 22 | 4 | 1-1 | 水磨禅杖 | ult_chuiyangliu | lin_chong\|结义; wu_song\|二龙山 | 第2章通关解锁 | |
| wu_song | 武松 | 行者 | 天伤星 | orange | infantry | 640 | 112 | 62 | 40 | 84 | 18 | 10 | 5 | 5 | 1-1 | 雪花镔铁戒刀 | ult_jiangmenshen | lu_zhishen\|二龙山; sun_erniang\|十字坡 | 第3章通关解锁 | |
| gongsun_sheng | 公孙胜 | 入云龙 | 天闲星 | orange | strategist | 520 | 52 | 42 | 118 | 72 | 10 | 8 | 0 | 4 | 2-3 | 松纹古定剑 | ult_wulei | wu_yong\|七星聚义 | 第5章通关解锁 | |
| wu_yong | 吴用 | 智多星 | 天机星 | purple | strategist | 540 | 55 | 45 | 115 | 74 | 8 | 8 | 0 | 4 | 2-3 | 两条铜链 | ult_diaohulishan | gongsun_sheng\|七星聚义; bai_sheng\|智取生辰纲 | 第3章剧情加入 | |
| hua_rong | 花荣 | 小李广 | 天英星 | purple | archer | 540 | 112 | 48 | 55 | 78 | 20 | 10 | 0 | 4 | 3-5 | 天地日月弓 | ult_baibu | qin_ming\|清风寨 | 挑战关「清风寨」S评价 | |
| li_kui | 李逵 | 黑旋风 | 天杀星 | purple | infantry | 680 | 105 | 55 | 30 | 78 | 15 | 8 | 5 | 5 | 1-1 | 鬼王板斧 | ult_heixuanfeng | bao_xu\|绞肉机; jiao_ting\|绞肉机 | 第4章剧情加入 | |
| qin_ming | 秦明 | 霹雳火 | 天猛星 | purple | cavalry | 690 | 102 | 68 | 35 | 86 | 12 | 6 | 8 | 6 | 1-1 | 狼牙棒 | ult_pili | hua_rong\|清风寨 | 挑战关「霹雳火」通关 | |
| zhang_qing | 张清 | 没羽箭 | 天捷星 | purple | archer | 520 | 106 | 46 | 50 | 80 | 15 | 10 | 0 | 4 | 2-4 | 飞石 | ult_feishi | gong_wang\|副将; ding_desun\|副将 | 挑战关「东昌府」通关 | |
| hu_sanniang | 扈三娘 | 一丈青 | 地慧星 | purple | cavalry | 620 | 96 | 60 | 55 | 88 | 12 | 12 | 5 | 6 | 1-1 | 日月双刀 | ult_taosuo | wang_ying\|夫妻 | 第6章「三打祝家庄」通关 | |
| xu_ning | 徐宁 | 金枪手 | 天佑星 | purple | infantry | 640 | 100 | 68 | 40 | 78 | 12 | 8 | 8 | 5 | 1-2 | 金枪 | act_jinqiang | tang_long\|表兄弟; shi_qian\|盗甲 | 第4章剧情加入 | |
| yan_qing | 燕青 | 浪子 | 天巧星 | purple | archer | 560 | 104 | 50 | 70 | 86 | 18 | 14 | 0 | 5 | 2-4 | 川弩 | act_zhulian | lu_junyi\|主仆 | 聚义厅招募 | |
| dai_zong | 戴宗 | 神行太保 | 天速星 | blue | support | 560 | 62 | 55 | 75 | 95 | 8 | 12 | 5 | 6 | 1-1 | 朴刀 | act_shenxing | li_kui\|江州旧识 | 聚义厅招募 | |
| shi_qian | 时迁 | 鼓上蚤 | 地贼星 | blue | infantry | 540 | 88 | 50 | 60 | 92 | 15 | 20 | 0 | 6 | 1-1 | 短刀 | act_feiyan | xu_ning\|盗甲 | 聚义厅招募 | |
| sun_erniang | 孙二娘 | 母夜叉 | 地壮星 | blue | infantry | 580 | 90 | 55 | 65 | 80 | 12 | 10 | 5 | 5 | 1-1 | 柳叶双刀 | act_menghan | wu_song\|十字坡; zhang_qing2\|夫妻 | 聚义厅招募 | |
| an_daoquan | 安道全 | 神医 | 地灵星 | blue | healer | 560 | 45 | 48 | 108 | 72 | 5 | 8 | 0 | 4 | 2-2 | 银针 | act_miaoshou | zhang_shun\|背友上山 | 聚义厅招募 | |
| cao_zheng | 曹正 | 操刀鬼 | 地稽星 | blue | infantry | 590 | 92 | 58 | 45 | 78 | 14 | 8 | 5 | 5 | 1-1 | 剔骨尖刀 | act_jieniu | lin_chong\|师徒 | 聚义厅招募 | |
| jiao_ting | 焦挺 | 没面目 | 地恶星 | blue | infantry | 620 | 85 | 62 | 35 | 76 | 10 | 10 | 10 | 5 | 1-1 | 铁拳 | act_xiangpu | li_kui\|绞肉机 | 聚义厅招募 | |
| bao_xu | 鲍旭 | 丧门神 | 地暴星 | blue | infantry | 600 | 95 | 55 | 30 | 80 | 16 | 6 | 5 | 5 | 1-1 | 丧门剑 | act_sangmen | li_kui\|绞肉机 | 聚义厅招募 | |
| yu_baosi | 郁保四 | 险道神 | 地健星 | blue | support | 640 | 65 | 70 | 60 | 65 | 5 | 5 | 10 | 4 | 1-1 | 替天行道旗 | act_qi | （无） | 聚义厅招募 | |
| zhang_shun | 张顺 | 浪里白条 | 天损星 | blue | infantry | 600 | 92 | 55 | 35 | 85 | 14 | 12 | 5 | 6 | 1-1 | 鱼肠剑 | act_langli | an_daoquan\|背友上山; wang_dingliu\|同乡 | 聚义厅招募 | water_walker |
| wang_ying | 王英 | 矮脚虎 | 地微星 | blue | infantry | 610 | 95 | 58 | 30 | 82 | 15 | 10 | 5 | 5 | 1-1 | 双刀 | act_aiguhu | hu_sanniang\|夫妻 | 聚义厅招募 | |
| gong_wang | 龚旺 | 花项虎 | 地捷星 | blue | archer | 540 | 98 | 45 | 40 | 78 | 15 | 10 | 0 | 4 | 2-4 | 飞枪 | act_feijiang | zhang_qing\|副将 | 聚义厅招募 | |
| ding_desun | 丁得孙 | 中箭虎 | 地速星 | blue | archer | 540 | 96 | 46 | 40 | 80 | 15 | 10 | 0 | 4 | 2-4 | 飞叉 | act_feicha | zhang_qing\|副将 | 聚义厅招募 | |
| bai_sheng | 白胜 | 白日鼠 | 地耗星 | green | strategist | 480 | 48 | 40 | 88 | 70 | 5 | 8 | 0 | 4 | 2-2 | 酒桶 | act_yaojiu | wu_yong\|智取生辰纲 | 第3章剧情加入 | |
| tang_long | 汤隆 | 金钱豹子 | 地孤星 | green | support | 560 | 70 | 60 | 55 | 68 | 8 | 6 | 8 | 4 | 1-2 | 钩镰枪 | act_goulian | xu_ning\|表兄弟 | 聚义厅招募 | |
| shi_yong | 石勇 | 石将军 | 地丑星 | green | vanguard | 700 | 68 | 80 | 30 | 58 | 5 | 5 | 20 | 4 | 1-1 | 熟铜棍 | act_duming | song_jiang\|赌友 | 初始武将 | |
| song_wan | 宋万 | 云里金刚 | 地魔星 | green | vanguard | 720 | 65 | 82 | 30 | 55 | 5 | 3 | 22 | 4 | 1-1 | 长柄大刀 | act_tiebi | du_qian\|开山元老 | 初始武将 | |
| du_qian | 杜迁 | 摸着天 | 地妖星 | green | infantry | 680 | 70 | 78 | 30 | 56 | 5 | 5 | 20 | 4 | 1-1 | 长枪 | act_mozhetian | song_wan\|开山元老 | 初始武将 | |
| wang_dingliu | 王定六 | 活闪婆 | 地劣星 | green | infantry | 520 | 72 | 50 | 40 | 90 | 10 | 18 | 0 | 6 | 1-1 | 短枪 | act_huoshan | zhang_shun\|同乡 | 聚义厅招募 | |

**规律**：品质分布 orange 4 / purple 8 / blue 12 / green 6（共 30）；签名技：橙紫多为 `ult_*`（例外：徐宁/燕青为 `act_*`），蓝绿全为 `act_*`；初始武将 = `unlock == "初始武将"` 三名（石勇/宋万/杜迁）。

### 7.2 enemies.csv（8 行全量，与 units 同构）

| unit_id | 名称 | 绰号 | 星号 | quality | class | hp | atk | def | mgc | spd | crit | dodge | block | move | range | 武器 | 签名技 | unlock | 特性 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| yang_zhi_boss | 杨志 | 青面兽 | 天暗星 | purple | cavalry | 1400 | 190 | 110 | 60 | 85 | 10 | 5 | 8 | 6 | 1-2 | 杨家枪 | act_yangjia | BOSS | alert |
| lao_duguan | 老都管 | | | green | support | 400 | 60 | 50 | 70 | 60 | 5 | 5 | 0 | 4 | 1-1 | 拐杖 | act_guli | NPC | |
| xiangjun_spear | 厢军枪兵 | | | green | infantry | 520 | 105 | 60 | 20 | 70 | 8 | 3 | 5 | 4 | 1-2 | 长枪 | | 杂兵 | |
| xiangjun_shield | 厢军刀牌手 | | | green | vanguard | 620 | 95 | 85 | 20 | 65 | 5 | 3 | 25 | 4 | 1-1 | 刀牌 | | 杂兵 | |
| chao_gai_npc | 晁盖 | 托塔天王 | 天魁星 | purple | infantry | 900 | 120 | 85 | 50 | 78 | 10 | 5 | 10 | 5 | 1-1 | 朴刀 | | NPC | |
| liu_tang_npc | 刘唐 | 赤发鬼 | 地异星 | blue | infantry | 780 | 110 | 70 | 40 | 80 | 12 | 8 | 5 | 5 | 1-1 | 朴刀 | | NPC | |
| xiangjun_recruit | 厢军新兵 | | | green | infantry | 400 | 80 | 45 | 15 | 60 | 5 | 3 | 0 | 4 | 1-1 | 长枪 | | 杂兵 | |
| pai_recruit | 刀牌新兵 | | | green | vanguard | 500 | 75 | 65 | 15 | 55 | 5 | 3 | 15 | 4 | 1-1 | 刀牌 | | 杂兵 | |

敌方数值视为对应等级终值，不走养成；敌方不配被动。

### 7.3 terrains.csv（9 行全量）

| terrain_id | 名称 | move_cost | dodge_mod | def_mod | atk_mod | range_mod | passable | destructible | hp | special |
|---|---|---|---|---|---|---|---|---|---|---|
| plain | 平原 | 1 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 无 |
| forest | 森林 | 2 | 15 | 10 | 0 | 0 | 1 | 0 | 0 | 提供伏击位 |
| hill | 山地 | 2 | 0 | 0 | 0 | 1 | 1 | 0 | 0 | 高打低伤害+15%；射手射程+1 |
| water | 水面 | 3 | 0 | -10 | 0 | 0 | 1 | 0 | 0 | 每回合移动力-1；水军系免疫 |
| barricade | 拒马 | 99 | 0 | 0 | 0 | 0 | 0 | 1 | 300 | 阻挡通行；克制马军冲锋；约3次攻击可破坏 |
| camp | 营帐 | 1 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 站上去每回合回血8% |
| fire | 火堆 | 1 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 进入及停留每回合灼烧（最大生命5%） |
| road | 土路 | 1 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 视觉变体，属性同平原 |
| wine_stall | 酒摊 | 1 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 场景互动点（智取生辰纲：白胜进入触发蒙汗药酒事件） |

### 7.4 weapons.csv（33 行，按 range_shape 分类）

- **line（6）**：丈八蛇矛、钩镰枪、长枪、短枪、金枪、杨家枪（蛇矛/枪矛类直线突刺）。
- **adjacent（18）**：水磨禅杖、雪花镔铁戒刀、鬼王板斧、狼牙棒、日月双刀、朴刀、短刀、柳叶双刀、剔骨尖刀、铁拳、丧门剑、替天行道旗、熟铜棍、长柄大刀、鱼肠剑、双刀、拐杖、刀牌。
- **diamond（9）**：松纹古定剑、两条铜链、天地日月弓、飞石、银针、酒桶、飞枪、飞叉、川弩。

> 逐行映射以 `data/weapons.csv` 为准（武器名 → range_shape，数值射程在单位 range_min/max）；未登记武器退回 diamond 并告警。

### 7.5 skills.csv（94 行概览）

- 构成：`generic_*` ×2（generic_melee / generic_ranged）+ `ult_*` ×10（橙紫绝技）+ `act_*` ×22（主动技，含敌方 act_yangjia / act_guli）+ `pas_*` ×60（30 将每人 2 被动）。
- 全量效果串见 `data/skills.csv`；语法与原子效果口径见 spec-battle.md 第 6/8 节。
- 敌方单位不配被动；每名武将恰好 2 被动（validate 硬校验）。

### 7.6 items.csv（5 件全量）

| item_id | 名称 | range | target | uses | effects | 说明 |
|---|---|---|---|---|---|---|
| jinchuangyao | 金疮药 | adjacent 0-1 | ally | 3 | heal(1.2) | 为自己或相邻友军敷药止血（谋略×1.2） |
| xingjunjiu | 行军酒 | self 0-0 | self | 2 | rage(+30) | 痛饮壮行，怒气+30 |
| jiedusan | 解毒散 | adjacent 0-1 | ally | 2 | dispel(2) | 驱散2个减益 |
| huxinjing | 护心镜 | self 0-0 | self | 2 | def_up(0.4,2) | 防御+40%，持续2回合 |
| feihuangshi | 飞蝗石 | diamond 2-4 | enemy | 3 | phys_dmg(0.6) | 投掷打击（攻击×0.6） |

### 7.7 progression.csv（15 键全量）

| key | value | 说明 |
|---|---|---|
| level_exp_base | 100 | 升级所需经验 = base × 当前等级 |
| level_stat_growth | 0.02 | 每级全属性 +2% |
| star_stat_mult | 0.1 | 每星全属性 +10%（叠乘） |
| star_max | 5 | 星级上限 |
| star_shard_cost | 10 | 升星碎片 = cost × 目标星级 |
| breakthrough_stat_step | 0.08 | 突破每档全属性 +8% |
| skill_level_max | 5 | 技能等级上限 |
| skill_level_mult | 0.05 | 技能效果每级 +5% |
| skill_book_cost | 1 | 技能书 = cost × 目标等级 |
| weapon_enhance_max | 10 | 武器强化上限 |
| weapon_enhance_atk | 0.03 | 强化每级攻 +3% |
| weapon_enhance_gold | 100 | 强化金币 = cost × 目标等级 |
| weapon_refine_max | 5 | 精炼上限 |
| weapon_refine_atk | 0.05 | 精炼每阶攻 +5% |
| bond_stat_bonus | 5 | 羁绊攻防 +5% |

### 7.8 battle_constants.csv / ai_weights.csv

全表见 spec-battle.md 第 15 / 14.4 节（54 键与 7×6 权重，本文不重复）。

### 7.9 reserved_units.txt（16 名）

- **第二批候选（12）**：guan_sheng, hu_yanzhuo, yang_zhi, suo_chao, shi_jin, ruan_xiaoer, ruan_xiaowu, ruan_xiaoqi, gu_dasao, sun_li, xie_zhen, xie_bao
- **其他预留（4）**：song_jiang, zhang_qing2, pang_wanchun, lu_junyi

实装后从本文件移除、加入 units.csv；羁绊目标允许落在预留名上（不生效但不报错）。
