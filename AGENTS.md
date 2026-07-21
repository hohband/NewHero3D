# 水浒战棋 3D —— 工程说明

水浒战棋（SRPG + 卡牌养成）的 Three.js 2.5D 移植版。原 Godot 工程：`/Users/hohbandlee/Projects/NewHeroGame`（仅作参考，不要修改）。

## 运行

```bash
npm start          # 或 python3 -m http.server 8080，浏览器打开 http://localhost:8080
npm test           # node --test，核心逻辑单元测试（无浏览器依赖）
```

## 架构红线

1. **逻辑与表现分离**：`src/core/` 是纯逻辑层——不得 import three.js、不得访问 DOM/window/localStorage，必须能在 node 中直接跑（测试依赖此）。表现层在 `src/render/`（Three.js）与 `src/ui/`（DOM 界面）。
2. **CSV 是唯一数据源**：`data/*.csv` 从 Godot 版原样复制，数值只改 CSV；逻辑经 `src/core/data_loader.js` 查询，禁止硬编码数值。
3. **指令管道统一**：玩家输入与 AI 都生成 Command，经 `BattleManager.submit_command()` 执行；逻辑瞬时结算，表现层靠事件数组回放。
4. **随机判定必须经 RollSource 注入**（生产 RandomRollSource 可设种子 / 测试 FixedRollSource），不得直接用 Math.random。
5. 移植规格（重写依据，改规则前先读）：`docs/spec-battle.md`（战斗逻辑）、`docs/spec-data.md`（数据表与 25 关）、`docs/spec-meta.md`（养成/系统/存档/决策日志）。

## 目录

```
data/       CSV 数据表（唯一数据源，复制自 Godot 版）
docs/       移植规格书
src/
  core/     纯逻辑层（node 可测）：data_loader / grid / unit / turn_order /
            damage_calculator / effect_system / targeting / commands /
            battle_manager / battle_ai / passive_system / levels / meta
  render/   Three.js 2.5D 渲染（棋盘、单位、高亮、动画回放）
  ui/       DOM 界面（大厅、战斗 HUD、结算、设置）
  main.js   入口与游戏流程编排
tests/      node --test 单元测试
vendor/     three.module.js（本地化，无构建步骤）
```

## 代码约定

- ES Module，无构建步骤；three.js 经 importmap 引入（`"three"`）。
- 缩进 2 空格；核心逻辑文件配一句中文文件头注释。
- 坐标用 `{x, y}` 普通对象；格子键用 `"x,y"` 字符串。
