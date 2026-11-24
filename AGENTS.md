# 水浒 3D —— 工程说明

水浒题材（卡牌养成）Three.js 游戏。**战斗玩法已确定为「刀塔传奇」版本**（横版实时自动战斗 + 手动大招时机），2026-07-27 经原型验证后正式确认。原 Godot 工程：`/Users/hohbandlee/Projects/NewHeroGame`（仅作参考，不要修改）。

> 两个旧试验战斗系统（战棋 SRPG 网格回合制、劫寨 Demo）已废弃并归档至 `archive/`，仅作历史参考，不再维护。详见 `archive/README.md`。

## 运行

```bash
npm start          # 或 python3 -m http.server 8080，浏览器打开 http://localhost:8080（→ battle-proto.html）
npm test           # node --test，战斗逻辑无头回归测试（无浏览器依赖）
```

模型查看：`http://localhost:8080/model-viewer.html`（角色 3D 模型 / 骨骼动画 / 骨骼显示 / 多版本对比，纯离线，无 CDN 依赖）。URL 参数：`?m=<glb路径>&anim=<idle|attack|hit|skill>&t=<秒>&bones=1&box=1&spin=1`，`anim` 时会按整段动画活动范围自动取景。
（本机 8080 被 Docker 的 CVAT 占用，改用 `python3 -m http.server 8099`。截图工具见 `tools/shot_models.js` / `tools/shot_battle.js`。）

## 3D 模型管线

现役真模型 5 个：`assets/models/<unit_id>.glb`（时迁 / 林冲 / 鲁智深 / 武松 / 花荣），每个含 20 骨 + idle/attack/hit/skill。`side_battle.js` 用 `MODEL_UNITS` 白名单 + `MODEL_FILE` 别名表加载，缺文件/解析失败静默回退胶囊。

```
docs/character-<unit_id>.md   角色设定（战斗风格→视觉映射、ImageGen 提示词、3D 规格）
  ↓ 1 ImageGen（文生图）      正面全身参考图 → assets/refs/<unit_id>_front.png
  ↓ 2 ImageGen（图生图）      多视图 → assets/refs/<unit_id>_{back,left_front,right_front}.png
  ↓ 3 去水印                  tools/nh3d_dewatermark.py（ImageGen 无法关闭水印）
  ↓ 4 混元多视角图生 3D       tools/nh3d-drive.py（并发上限 2，429 自动排队）
                              → assets/models/<unit_id>_ai.glb（静态，无骨骼）
  ↓ 5 Blender 无头绑骨        tools/blender_rig_character.py <in.glb> <out.glb> [L|R]
                              → assets/models/<unit_id>.glb（战场直接加载，2 参数：武器持握手）
```

**完整管线说明（含接口约束、额度限制、逐条踩坑）见 `docs/pipeline-3d-asset.md` —— 动手前先读。**

**参考图硬约束（违反必翻车）**：全身直立站姿、双脚并拢约一肩宽、双臂自然下垂、正面朝前、**该角色只有一件兵器**。混元是单图重建，姿势力直接变成网格姿态；骨架坐标按「直立、垂手」硬编码，出了下蹲/弓步/抬臂姿就必然错位（鲁智深首版蹲姿 = 腿骨 ±0.06 vs 真实双脚 ±0.2，绑骨全崩）。

**多视图约束**：只用 `back` + `left_front` + `right_front`（3/4 近角），**不要用 `left`/`right` 纯正侧视**——图生图改视角时会把手持兵器挪到身后并脱离手掌（已实测）。原则是「宁要一致的近角，不要崩掉的远角」。水印不是每批都有，逐图检查，别靠推测。

**额度**：混元 `hy-3d` 维度日提交上限 **5 次**，重置点 = **UTC 00:00（北京 08:00）**，已两端闭合验证；**无查询接口**，只能靠 429 反推。5 名英雄正好一天一批，排期前先算额度。
**额度不够时走网页版**：`3d.hunyuan.tencent.com` 有 **20 次/天**，重置点是**北京 00:00（UTC+8）—— 和内置的 UTC 日不是一套，别混算**。微信扫码登录一次后 headless 复用 —— `tools/hy3d_web_login.js` → `hy3d_web_gen.js`（多视图提交，带 `--dry`）→ `hy3d_web_fetch.js pull`（**读接口 JSON 取签名直链下载**，不点 UI）；查额度用 `tools/hy3d_web_quota.js`（只读）。坑与流程见项目技能 `.workbuddy/skills/hunyuan3d-web-automation/`。

**多视图到底值不值（2026-09-13 两轮复跑结论）**：林冲四视角 vs 单图，轮廓 IoU 均值 **0.633 vs 0.633（网页版 50k 面）**、**0.637 vs 0.633（内置管线同面数档 30k）** —— **打平**。唯一跨两轮稳定为正的是**背面（+0.038 / +0.024）与右前 45°（+0.033 / +0.043）、正右视（+0.013 / +0.043）**，即单图只能靠猜的方向；左前 45° 与正左视稳定为负。**结论：不给所有英雄补做多视图**，只留给「背面有重要识别特征」的角色（大披风 / 背负兵器 / 背纹）—— 且林冲本人就是大白披风角色、增益仍≈0，门槛要卡得更严。数据见 `docs/pipeline-3d-asset.md` §8.2。

**绑骨轴复验：多视图同样无改善（2026-09-13）**。两版都过 `blender_rig_character.py`，看 `PROP_CLUSTERS` 那行：武器侧种子 **6（多视图） vs 7（单图）**，都低于 10 的门槛 → **两版都没认出丈八蛇矛**。这推翻了「多视图版手/兵器与躯干分离更早（z≈0.68 vs 0.78）→ 识别窗口更大」的推断。对照图 `assets/models/lin_chong_rig_mv_vs_single.png`，详见 §8.3。

**当前真正的瓶颈 = 兵器识别的「种子门控」**：`blender_rig_character.py` 要求种子同时满足「离手 <0.10」且「离躯干 >0.15」，而**竖贴身持握**的长兵器杆身中上段离躯干 <0.15，永远凑不够 10 个种子 → 林冲长枪 / 鲁智深禅杖 / 花荣弓（5 个成品里的 3 个）识别全部失败，兵器被按最近骨加权、大幅挥击时会弯（武松双刀是外张的，所以成功）。**这是性价比最高的一处待改项**（改判据，不是改重建方案）。

**诊断工具**：`tools/analyze_mesh_profile.py <glb> [切片数]` —— 把网格按高度切成 N 片、在每片做 x 投影间隙聚类，打印每个团块的 `[x中心 宽 | y范围 | 顶点数]`。绑骨出问题先跑它看真实几何，别猜。
`tools/mesh_stats.py <glb>...` —— 顶点/三角面/包围盒 + 连通岛屿数。**注意：必须先 `remove_doubles` 焊接再数**，否则 GLB 的 UV/法线接缝会把顶点拆开（5 万面 / 4.1 万顶点），数出的「岛」全是接缝碎片（该脚本已内置焊接并同时打印焊接前后的数）。
`tools/mesh_clean_islands.py <in.glb> <out.glb> [最小顶点数=50]` —— 焊接 → 按连通分量聚类 → 删掉过小的悬浮碎块 → 导出。**混元多视图版会残留披风下摆碎片**（实测 30k 多视图版 2 块共 89 顶点），送进绑骨前先清。
`blender_rig_character.py` 输出里的 **`PROP_CLUSTERS` 行是「兵器有没有被自动认出」的判据**：`('<手骨名>', 顶点数, 尺寸, 长细比)` = 识别成功；只见 `('X:种子', n)` 无结果 = 种子不足（n<10）跳过；`('X:丢弃', …)` = 簇没过长细比 3.0 或超 6000 顶点上限。**跑完绑骨先看这一行。**
`tools/render_model_views.py <glb> <outdir>` + `tools/silhouette_compare.py` —— 按方位角渲染 6 个正交视角，与参考图算轮廓 IoU 并出并排拼图，用于比较两种重建方案的质量。

**已知局限（源自混元输出是「融合单面网格」）**：单个 mesh、无部件语义，**焊接后是单一连通壳体**（5 个成品实测最大岛占比均 100%；旧文档里「897 连通岛屿」是未焊接的接缝假岛计数，已纠正）。故 ① 长兵器只在「肩线以上呈孤立细长团块」或「远离身体前方」时可被自动识别（武松双刀成功；林冲枪/鲁智深禅杖/花荣弓贴身持握 → 识别失败，兵器按最近骨权重，大幅挥击会轻微弯曲）；② 宽体型角色模板骨架横向偏窄；③ 披风/战袍跨肩到地、被多组骨共牵，腿部旋转 >0.3rad 会把下摆撕成扇形（`skill` 幅度已据此封顶）。

## 架构红线

1. **逻辑与表现分离**：战斗逻辑层 `src/prototype/sim.js` 是纯逻辑——不得 import three.js、不得访问 DOM/window/localStorage，必须能在 node 中直接跑（测试依赖此）。表现层在 `src/prototype/side_battle.js`（Three.js + HTML overlay HUD）。
2. **CSV 是唯一数据源**：数值只改 `data/*.csv`（units / skills / proto_awaken 等）；装配经 `src/prototype/data.js` 查询，禁止在逻辑里硬编码数值。CSV 解析与效果串解析在 `src/shared/`（`csv.js` / `effects.js`），与正赛语法一致。
3. **指令管道统一 + 事件回放**：逻辑按定长 tick 瞬时结算，产出事件数组；表现层消费事件数组做动画回放，不反向影响逻辑。
4. **随机必须走注入式 RollSource**：`sim.js` 的 `makeRNG(seed)` 注入随机源（可设种子复现），不得直接用 `Math.random`（表现层视觉抖动除外）。
5. 设计依据（改规则前先读）：`docs/design-auto-battle.md`（刀塔传奇式战斗 · 正式方案）、`docs/design-hero-skills.md`（英雄技能 · 品质不设上限）。

## 目录

```
assets/
  models/      真模型 GLB（<unit_id>.glb 为战场加载的绑骨版；<unit_id>_ai.glb 为混元静态版）
  refs/        ImageGen 角色参考图（<unit_id>_front.png 正面；<unit_id>_<view>.png 多视图）
data/          CSV 数据表（唯一数据源）：units / skills / proto_awaken 等
docs/          策划设计文档（design-auto-battle / design-hero-skills 正式版 + character-<unit_id>.md 角色设定
               + pipeline-3d-asset.md 3D 资产管线）
src/
  prototype/   刀塔传奇版战斗：sim.js（纯逻辑层，node 可测）/ data.js（CSV 装配）/
               side_battle.js（Three.js 表现层 + HUD）
  shared/      战斗通用解析工具（csv.js / effects.js，自包含，与正赛语法一致）
tools/         资产管线与诊断：
               nh3d_lib.py（共享库：编码/多视角载荷/体积门禁）/ nh3d-gen3d.py + nh3d-drive.py（混元图生 3D，支持多视角与 --dry-run）
               hy3d_web_lib.js（网页版共享库）/ hy3d_web_login.js + hy3d_web_gen.js + hy3d_web_fetch.js + hy3d_web_quota.js + hy3d_web_diag.js（网页版 20 次/天路径）
               nh3d_dewatermark.py（参考图去水印）/ blender_rig_character.py（绑骨）
               analyze_mesh_profile.py（网格剖面）/ mesh_stats.py（焊接后岛屿统计）/ mesh_clean_islands.py（焊接+删悬浮碎块）
               render_model_views.py + silhouette_compare.py（多视角渲染 + 轮廓 IoU 比对）
               shot_models.js + shot_battle.js（无头截图）
battle-proto.html  战斗运行入口（index.html 已指向它）
model-viewer.html  角色 3D 模型查看器（骨骼动画 / 骨骼显示 / 多版本对比，本地 vendor three.js，无 CDN）
tests/         node --test 无头回归测试（test_prototype.js）
vendor/        three.module.js（本地化，无构建步骤）
archive/       旧试验战斗系统归档（grid-srpg 战棋 / liangshan-raid 劫寨，仅参考）
```

## 代码约定

- ES Module，无构建步骤；three.js 经 importmap 引入（`"three"` → `./vendor/three.module.js`）。
- 缩进 2 空格；核心逻辑文件配一句中文文件头注释。
- 战斗世界坐标：横版以 x 为进攻轴（我方左、敌方右），z 为横向展开；逻辑只用普通数值与对象。
- 已实现的战斗机制：自动寻敌普攻、前后排（近战打前排/远程切后排/后排承伤-10%）、攒怒→手动大招、克制矩阵选敌、大招连锁、觉醒技、闪避/格挡/暴击、效果串解释器（30+ 效果）。
