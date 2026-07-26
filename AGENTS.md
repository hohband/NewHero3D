# 水浒 3D —— 工程说明

水浒题材（卡牌养成）Three.js 游戏。**战斗玩法已确定为「刀塔传奇」版本**（横版实时自动战斗 + 手动大招时机），2026-07-27 经原型验证后正式确认。原 Godot 工程：`/Users/hohbandlee/Projects/NewHeroGame`（仅作参考，不要修改）。

> 两个旧试验战斗系统（战棋 SRPG 网格回合制、劫寨 Demo）已废弃并归档至 `archive/`，仅作历史参考，不再维护。详见 `archive/README.md`。

## 运行

```bash
npm start          # 或 python3 -m http.server 8080，浏览器打开 http://localhost:8080（→ battle-proto.html）
npm test           # node --test，战斗逻辑无头回归测试（无浏览器依赖）
```

## 架构红线

1. **逻辑与表现分离**：战斗逻辑层 `src/prototype/sim.js` 是纯逻辑——不得 import three.js、不得访问 DOM/window/localStorage，必须能在 node 中直接跑（测试依赖此）。表现层在 `src/prototype/side_battle.js`（Three.js + HTML overlay HUD）。
2. **CSV 是唯一数据源**：数值只改 `data/*.csv`（units / skills / proto_awaken 等）；装配经 `src/prototype/data.js` 查询，禁止在逻辑里硬编码数值。CSV 解析与效果串解析在 `src/shared/`（`csv.js` / `effects.js`），与正赛语法一致。
3. **指令管道统一 + 事件回放**：逻辑按定长 tick 瞬时结算，产出事件数组；表现层消费事件数组做动画回放，不反向影响逻辑。
4. **随机必须走注入式 RollSource**：`sim.js` 的 `makeRNG(seed)` 注入随机源（可设种子复现），不得直接用 `Math.random`（表现层视觉抖动除外）。
5. 设计依据（改规则前先读）：`docs/design-auto-battle.md`（刀塔传奇式战斗 · 正式方案）、`docs/design-hero-skills.md`（英雄技能 · 品质不设上限）。

## 目录

```
data/          CSV 数据表（唯一数据源）：units / skills / proto_awaken 等
docs/          策划设计文档（design-auto-battle / design-hero-skills，均为已确认正式版）
src/
  prototype/   刀塔传奇版战斗：sim.js（纯逻辑层，node 可测）/ data.js（CSV 装配）/
               side_battle.js（Three.js 表现层 + HUD）
  shared/      战斗通用解析工具（csv.js / effects.js，自包含，与正赛语法一致）
battle-proto.html  战斗运行入口（index.html 已指向它）
tests/         node --test 无头回归测试（test_prototype.js）
vendor/        three.module.js（本地化，无构建步骤）
archive/       旧试验战斗系统归档（grid-srpg 战棋 / liangshan-raid 劫寨，仅参考）
```

## 代码约定

- ES Module，无构建步骤；three.js 经 importmap 引入（`"three"` → `./vendor/three.module.js`）。
- 缩进 2 空格；核心逻辑文件配一句中文文件头注释。
- 战斗世界坐标：横版以 x 为进攻轴（我方左、敌方右），z 为横向展开；逻辑只用普通数值与对象。
- 已实现的战斗机制：自动寻敌普攻、前后排（近战打前排/远程切后排/后排承伤-10%）、攒怒→手动大招、克制矩阵选敌、大招连锁、觉醒技、闪避/格挡/暴击、效果串解释器（30+ 效果）。
