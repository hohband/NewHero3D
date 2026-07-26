# 归档区（旧试验战斗系统）

> 本目录存放**已废弃的旧版战斗系统**，仅作历史参考，**不再维护、不参与构建与运行**。
> 归档日期：2026-07-27。

## 决策记录

经评审与原型验证，项目**正式采用「刀塔传奇」版本的战斗**（横版实时自动战斗 + 手动大招时机）作为唯一战斗方向。该方向的可行性已通过可运行原型验证：**同一阵容、同一随机种子下，唯一变量是「大招时机」即可决定胜负**——这正是刀塔传奇的核心体验。

正式设计文档（在 `docs/`）：
- `docs/design-auto-battle.md` —— 刀塔传奇式横版自动战斗 · 正式设计方案
- `docs/design-hero-skills.md` —— 英雄技能设计（技能差异化 · 品质不设上限）

现行系统（在 `src/`）：
- `src/prototype/` —— 刀塔传奇版战斗（逻辑层 `sim.js` 纯逻辑可 node 无头跑；表现层 `side_battle.js`）
- `src/shared/` —— 战斗通用解析工具（`csv.js`、`effects.js`），从旧战棋 core 提取，供新系统复用
- 运行入口：`battle-proto.html`

## 归档的两个旧试验系统

### ① `grid-srpg/` —— 战棋 SRPG（网格回合制 CTB）
Godot 版《水浒战棋》的 Three.js 移植：网格棋盘 + CTB 行动条回合制。
- `src/` —— core（纯逻辑）/ render（Three.js 棋盘）/ ui（DOM）
- `docs/` —— 移植规格书 `spec-battle.md` / `spec-data.md` / `spec-meta.md` 与 `api-contract.md`
- `tests/` —— 网格战斗单元测试
- 废弃原因：玩法方向调整为刀塔传奇式横版自动战斗，网格回合制不再作为主战斗。

### ② `liangshan-raid/` —— 劫寨 Demo（潜入/劫掠试验）
独立的「劫寨」玩法 Demo（`raid.html` 入口）。
- `src/raid/` —— 劫寨核心/渲染/界面
- `design/` —— 劫寨设计稿（含 GDD、战斗模式设计、路线图、评审）
- `tests/` —— 劫寨核心测试
- 废弃原因：属玩法试验 Demo，与确定的刀塔传奇战斗方向不一致。

## 注意

- 两个系统仍保持各自内部完整性，可供查阅；如需参考其实现，请直接阅读对应目录。
- 新系统的 CSV 解析与效果串解析**不再依赖** `grid-srpg/src/core`，已迁移至 `src/shared/`（自包含副本）。
- `data/*.csv`（units / skills 等）为**现行共享数据源**，未归档；`data/proto_awaken.csv` 为新系统觉醒技表。
