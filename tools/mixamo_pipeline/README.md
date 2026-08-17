# Mixamo 动作流水线（时迁 / 任意英雄通用）

目标：把 Mixamo 的高质量动作合并成一个游戏可直接用的 GLB，片段名对齐战斗状态机
（`idle` / `attack` / `hit` / `skill` / `run` / `die`）。`side_battle.js` 已改为优先加载
产出文件，缺失时回退到旧版 `shiqian.glb`。

> 重新绑骨 + 下载动作这步**必须在 Mixamo 网页里用你的 Adobe 账号完成**（无公开 API，
> 脚本无法代下）。本目录只负责「下完之后」的合并与接入。

---

## 第 1 步：Mixamo 重新绑骨并下载

1. 打开 https://www.mixamo.com ，用 Adobe ID 登录（免费）。
2. 上传角色：拖入 `assets/models/shiqian_ai.glb`（未绑骨的纯网格）。
   若 Mixamo 拒绝 GLB，先转 FBX：
   ```bash
   /Applications/Blender.app/Contents/MacOS/Blender --background \
     --python tools/mixamo_pipeline/glb_to_fbx.py -- \
     assets/models/shiqian_ai.glb tools/mixamo_pipeline/shiqian_upload.fbx
   ```
   然后上传生成的 `shiqian_upload.fbx`。
3. 自动绑骨：在模型上放好手/脚/头/脊柱关键点 → Auto-Rig → Download。
   - **下载「带蒙皮角色」一次**：格式 FBX，勾 **With Skin**，存为
     `tools/mixamo_pipeline/shiqian_mixamo_rig.fbx`。
4. 下载动作：在 Animations 里逐个选，每个都 Download，格式 FBX，**勾 Without Skin**
   （只要骨骼+动画，文件小、好合并），文件名按 `clip_map.json` 的关键词命名，
   存进 `tools/mixamo_pipeline/incoming/`。
   - 例：`idle.fbx`、`slash.fbx`、`spell_cast.fbx`、`death.fbx`、`run.fbx`。

建议动作清单（对应战斗状态）：

| 战斗状态 | Mixamo 动作建议 | 文件名关键词 |
|---------|---------------|-------------|
| `idle`  | Idle / Breathing Idle | idle / breath |
| `run`   | Running / Walking（移动） | run / walk |
| `attack`| Sword Strike / Sword And Shield Slash / Punch | slash / strike / sword / punch / attack |
| `hit`   | Hit Reaction / React Short | hit / react / flinch |
| `skill` | Spell Cast / War Cry / Victory（大招） | spell / cast / warcry / victory |
| `die`   | Death / Falling Back Death | death / die / knockdown |

> 同名状态下多个文件会自动编号：`slash.fbx`→`attack`，`punch.fbx`→`attack_2`。

---

## 第 2 步：合并成 GLB

```bash
/Applications/Blender.app/Contents/MacOS/Blender --background \
  --python tools/mixamo_pipeline/merge_mixamo.py -- \
  tools/mixamo_pipeline \
  tools/mixamo_pipeline/shiqian_mixamo_rig.fbx \
  assets/models/shiqian_mixamo.glb
```

脚本会打印 `CHAR_ARMATURE`、骨骼名、`INCOMING` 列表、每段 `-> 状态 帧数`，
最后打印 `CLIPS:`（成功合并的片段名）和导出字节数。

---

## 第 3 步：接入游戏

`src/prototype/side_battle.js` 的 `_attachGlbModel` 已改为：
先尝试 `assets/models/shiqian_mixamo.glb`，失败回退 `shiqian.glb`。
动作按片段名播放，**无需改其他代码**。跑 `npm start` 打开
`battle-proto.html` 即可看到时迁用 Mixamo 动作演出。

---

## 排错

- **动作在游戏里扭曲 / 不播放**：多半是骨骼名对不上。Mixamo 角色 FBX 与动作 FBX
  必须来自**同一套绑定**（都带 `mixamorig:` 前缀）。检查 `incoming/` 里的 FBX 是否都是
  Without Skin、且来自你刚绑好的那个角色。脚本打印的 `BONES:` 可对照。
- **SKIP(未匹配 clip_map)**：文件名里没有 `clip_map.json` 的任何关键词，改文件名或加关键词。
- **WARN 没有解析到动作**：该 FBX 可能导出设置不对（没勾 Without Skin / 不含动画）。
- 想要更多状态（如 `run` 移动、`die` 死亡演出）而当前游戏只播 idle/attack/hit/skill，
  多余片段会一并导出，等战斗逻辑接入对应事件即可，不影响现有播放。
