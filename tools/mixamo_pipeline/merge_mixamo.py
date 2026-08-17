# Mixamo 角色 + 多段动作 → 单 GLB（按战斗状态命名）。无头 Blender 运行。
# 用法:
#   Blender --background --python merge_mixamo.py -- <PIPELINE_DIR> <CHAR_FBX> <OUT_GLB>
# 约定:
#   CHAR_FBX  = Mixamo 下载的「带蒙皮角色」(With Skin)，骨骼为 mixamorig:*
#   PIPELINE_DIR/incoming/*.fbx(.glb) = 各段动作(Without Skin)，文件名含 clip_map 关键词
# 产出:
#   OUT_GLB 含 mesh+骨骼+N 条动画片段，片段名 = idle/attack/hit/skill/run/die(+变体)
import bpy, sys, os, json

argv = sys.argv[sys.argv.index("--") + 1:]
PIPE, CHAR, OUT = argv[0], argv[1], argv[2]

with open(os.path.join(PIPE, "clip_map.json"), encoding="utf-8") as f:
    CLIP_MAP = json.load(f)


def map_name(fname):
    base = os.path.splitext(os.path.basename(fname))[0].lower()
    for key, state in CLIP_MAP.items():
        if key.lower() in base:
            return state
    return None


bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.scene.render.fps = 30

# ---- 1) 导入带蒙皮角色 ----
print("IMPORT_CHAR:", CHAR)
bpy.ops.import_scene.fbx(filepath=CHAR)
meshes = [o for o in bpy.data.objects if o.type == 'MESH']
char_arm = meshes[0].find_armature() if meshes else None
if char_arm is None:
    arms = [o for o in bpy.data.objects if o.type == 'ARMATURE']
    char_arm = arms[0] if arms else None
assert char_arm, "角色 FBX 里找不到骨骼"
print("CHAR_ARMATURE:", char_arm.name, "bones:", len(char_arm.data.bones))
print("BONES:", [b.name for b in char_arm.data.bones])
# 丢弃角色自带的可能动作，后面只放我们挑的
if char_arm.animation_data:
    char_arm.animation_data.action = None


def activate(action):
    char_arm.animation_data_create()
    char_arm.animation_data.action = action
    if len(action.slots):
        try:
            char_arm.animation_data.action_slot = action.slots[0]
        except Exception:
            pass


# ---- 2) 逐个导入动作并收集 ----
inc_dir = os.path.join(PIPE, "incoming")
anim_files = sorted(
    os.path.join(inc_dir, f) for f in os.listdir(inc_dir)
    if f.lower().endswith(('.fbx', '.glb', '.gltf'))
)
print("INCOMING:", [os.path.basename(f) for f in anim_files])

states = []          # 最终片段名列表（按导入顺序）
used = {}            # state -> 计数（处理变体）


def import_anim(af):
    if af.lower().endswith('.fbx'):
        bpy.ops.import_scene.fbx(filepath=af)
    else:
        bpy.ops.import_scene.gltf(filepath=af)


for af in anim_files:
    print("IMPORT_ANIM:", os.path.basename(af))
    before = set(bpy.data.actions)
    import_anim(af)
    after = set(bpy.data.actions)
    new_actions = list(after - before)
    imp_arms = [o for o in bpy.data.objects if o.type == 'ARMATURE' and o != char_arm]
    imp_arm = imp_arms[0] if imp_arms else None
    action = None
    if imp_arm and imp_arm.animation_data and imp_arm.animation_data.action:
        action = imp_arm.animation_data.action
    elif new_actions:
        action = new_actions[0]
    if action is None:
        print("  WARN: 没有解析到动作，跳过", os.path.basename(af))
        if imp_arm:
            bpy.data.objects.remove(imp_arm, do_unlink=True)
        continue
    state = map_name(af)
    if state is None:
        print("  SKIP(未匹配 clip_map):", os.path.basename(af))
        if imp_arm:
            bpy.data.objects.remove(imp_arm, do_unlink=True)
        continue
    if state in used:
        used[state] += 1
        state = f"{state}_{used[state] + 1}"
    else:
        used[state] = 1
    action.name = state
    activate(action)
    states.append(state)
    print("  ->", state, "frames", tuple(round(x, 1) for x in action.frame_range))
    if imp_arm:
        bpy.data.objects.remove(imp_arm, do_unlink=True)

# ---- 3) 全部 stash 进 NLA（导出成多条动画） ----
if char_arm.animation_data:
    char_arm.animation_data.action = None
for state in states:
    act = bpy.data.actions[state]
    tr = char_arm.animation_data.nla_tracks.new()
    tr.name = state
    st = tr.strips.new(state, int(act.frame_range[0]), act)
    if hasattr(st, "action_slot") and len(act.slots):
        try:
            st.action_slot = act.slots[0]
        except Exception:
            pass
    tr.mute = True

# ---- 4) 导出 GLB ----
bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format='GLB',
    export_animation_mode='NLA_TRACKS',
    export_animations=True,
    export_skins=True,
    export_yup=True,
)
import os as _os
print("EXPORTED:", OUT, _os.path.getsize(OUT), "bytes")
print("CLIPS:", states)
print("DONE")
