# 时迁自动绑骨 + 动画脚本（无头 Blender）
# 流程：导入 GLB → 应用变换 → 压贴图(≤1024) → 按实测包围盒生成人形骨架 → 自动权重蒙皮
#       → 用「世界轴四元数」精确做 idle/attack/hit/skill 四组动作 → NLA stash → 导出 GLB
# Blender 坐标系（导入后）：+Z=上，-Y=前（剑尖方向），+X=角色左手侧，右手持剑
import bpy, sys
from mathutils import Vector, Quaternion

argv = sys.argv[sys.argv.index("--") + 1:]
SRC, OUT = argv[0], argv[1]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
scene = bpy.context.scene
scene.render.fps = 30

meshes = [o for o in bpy.data.objects if o.type == 'MESH']
print("MESH_IN:", [(o.name, len(o.data.vertices), len(o.data.polygons)) for o in meshes])

# ---- 压贴图到 ≤1024（28.9MB 的主因是 3 张 4096 PBR 图） ----
for img in bpy.data.images:
    try:
        if max(img.size[0], img.size[1]) > 1024:
            img.scale(1024, 1024)
            print("TEX_SCALED:", img.name)
    except Exception as e:
        print("TEX_SKIP:", img.name, e)

# ---- 应用变换，网格数据归一到世界空间 ----
bpy.ops.object.select_all(action='DESELECT')
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
if len(meshes) > 1:
    bpy.ops.object.join()
mesh = bpy.context.view_layer.objects.active

# ---- 实测包围盒 ----
mins = Vector((1e9, 1e9, 1e9)); maxs = Vector((-1e9, -1e9, -1e9))
for v in mesh.data.vertices:
    w = mesh.matrix_world @ v.co
    mins = Vector(map(min, mins, w)); maxs = Vector(map(max, maxs, w))
H = maxs.z - mins.z
print("BBOX", tuple(round(v, 3) for v in mins), tuple(round(v, 3) for v in maxs), "H", round(H, 3))

# ---- 骨架（按身高比例；front=-Y，左=+X，右=-X 持剑） ----
BONES = {
    "Root":       ((0, 0, 0.00), (0, 0, 0.10), None, False),
    "Hips":       ((0, 0, 0.52), (0, 0, 0.60), "Root", True),
    "Spine":      ((0, 0, 0.60), (0, 0, 0.70), "Hips", True),
    "Chest":      ((0, 0, 0.70), (0, 0, 0.82), "Spine", True),
    "Neck":       ((0, 0, 0.82), (0, 0, 0.88), "Chest", True),
    "Head":       ((0, 0, 0.88), (0, 0, 1.00), "Neck", True),
    "Shoulder.L": ((0.04, 0, 0.80), (0.10, 0, 0.80), "Chest", True),
    "UpperArm.L": ((0.10, 0, 0.80), (0.11, -0.01, 0.63), "Shoulder.L", True),
    "Forearm.L":  ((0.11, -0.01, 0.63), (0.11, -0.03, 0.49), "UpperArm.L", True),
    "Hand.L":     ((0.11, -0.03, 0.49), (0.11, -0.07, 0.43), "Forearm.L", True),
    "Shoulder.R": ((-0.04, 0, 0.80), (-0.10, 0, 0.80), "Chest", True),
    "UpperArm.R": ((-0.10, 0, 0.80), (-0.11, -0.01, 0.63), "Shoulder.R", True),
    "Forearm.R":  ((-0.11, -0.01, 0.63), (-0.11, -0.03, 0.49), "UpperArm.R", True),
    "Hand.R":     ((-0.11, -0.03, 0.49), (-0.11, -0.07, 0.43), "Forearm.R", True),
    "Thigh.L":    ((0.055, 0, 0.52), (0.06, 0.005, 0.29), "Hips", True),
    "Shin.L":     ((0.06, 0.005, 0.29), (0.06, -0.01, 0.05), "Thigh.L", True),
    "Foot.L":     ((0.06, -0.01, 0.05), (0.06, -0.13, 0.02), "Shin.L", True),
    "Thigh.R":    ((-0.055, 0, 0.52), (-0.06, 0.005, 0.29), "Hips", True),
    "Shin.R":     ((-0.06, 0.005, 0.29), (-0.06, -0.01, 0.05), "Thigh.R", True),
    "Foot.R":     ((-0.06, -0.01, 0.05), (-0.06, -0.13, 0.02), "Shin.R", True),
}
arm_data = bpy.data.armatures.new("rig")
arm = bpy.data.objects.new("rig", arm_data)
scene.collection.objects.link(arm)
bpy.ops.object.select_all(action='DESELECT')
arm.select_set(True)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='EDIT')
ebs = {}
for name, (h, t, parent, deform) in BONES.items():
    eb = arm_data.edit_bones.new(name)
    eb.head, eb.tail = Vector(h), Vector(t)
    ebs[name] = eb
for name, (h, t, parent, deform) in BONES.items():
    if parent:
        ebs[name].parent = ebs[parent]
bpy.ops.object.mode_set(mode='OBJECT')
arm.data.bones["Root"].use_deform = False

# ---- 蒙皮：脚本化近邻平滑权重（AI 网格非流形，热权重会静默失败：组存在但全空） ----
bpy.ops.object.select_all(action='DESELECT')
mesh.select_set(True); arm.select_set(True)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.parent_set(type='ARMATURE')  # 仅建立父子关系 + Armature 修改器，不写权重

for g in list(mesh.vertex_groups):  # 清掉可能的空组
    mesh.vertex_groups.remove(g)
deform_bones = [n for n, (h, t, p, d) in BONES.items() if d]
vgs = {n: mesh.vertex_groups.new(name=n) for n in deform_bones}
segs = {n: (Vector(BONES[n][0]), Vector(BONES[n][1])) for n in deform_bones}

def dist_seg(p, a, b):
    ab = b - a
    L2 = ab.length_squared
    t = 0.0 if L2 < 1e-12 else max(0.0, min(1.0, (p - a).dot(ab) / L2))
    return (p - (a + t * ab)).length

# 区域感知候选骨（实测：手垂在腿侧，近邻法会把腿侧布片粘到手上 → 用区域盒隔离）
ARMCHAIN = {"Shoulder.L","UpperArm.L","Forearm.L","Hand.L","Shoulder.R","UpperArm.R","Forearm.R","Hand.R"}
TORSO = {"Hips","Spine","Chest","Neck","Head"}
LEGS = {"Hips","Thigh.L","Thigh.R","Shin.L","Shin.R","Foot.L","Foot.R"}
def cand_names(p):
    # 剑盒：罩住探出体前的整段刃（细长件远离骨骼是常态，须跳过距离门限）
    if -0.16 <= p.x <= -0.01 and -0.60 <= p.y <= -0.10 and 0.28 <= p.z <= 0.52:
        return (["Hand.R", "Forearm.R"], True)
    side = 'L' if p.x > 0 else 'R'
    if p.z > 0.56:  # 上半身
        if abs(p.x) < 0.10:
            return (sorted(TORSO), False)
        return (sorted(TORSO | {f"Shoulder.{side}", f"UpperArm.{side}", f"Forearm.{side}", f"Hand.{side}"}), False)
    return (sorted(LEGS), False)  # 下半身一律腿胯，杜绝手骨抓腿

# 距离门限：手臂骨只在贴近时生效（拳头旁的衣襟超过门限就回退到腿胯）
GATE = {"Hand.L": 0.06, "Hand.R": 0.06, "Forearm.L": 0.06, "Forearm.R": 0.06,
        "UpperArm.L": 0.06, "UpperArm.R": 0.06, "Shoulder.L": 0.06, "Shoulder.R": 0.06}

assigns = {}
mw = mesh.matrix_world
for v in mesh.data.vertices:
    p = mw @ v.co
    names, forced = cand_names(p)
    ds = sorted(((dist_seg(p, segs[n][0], segs[n][1]), n) for n in names), key=lambda x: x[0])
    if not forced:
        ds = [(d, n) for d, n in ds if d < GATE.get(n, 0.5)]
    if not ds:  # 全部超门限：回退最近的躯干/腿骨
        fb = TORSO if p.z > 0.56 else LEGS
        ds = [min(((dist_seg(p, segs[n][0], segs[n][1]), n) for n in fb), key=lambda x: x[0])]
    near = ds[:3]
    ws = [(1.0 / ((d + 0.01) ** 4), n) for d, n in near]
    tot = sum(w for w, _ in ws)
    for w, n in ws:
        wn = w / tot
        if wn > 0.08:
            assigns.setdefault(n, []).append((v.index, wn))
for n, lst in assigns.items():
    for idx, w in lst:
        vgs[n].add([idx], w, 'REPLACE')
print("WEIGHT_COVERAGE:", {n: len(l) for n, l in sorted(assigns.items())})
# ---- 动画工具：世界轴旋转（换算进骨骼局部空间，绕世界 axis 转 angle） ----
rest_q = {n: arm.data.bones[n].matrix_local.to_quaternion() for n in BONES}
def keyw(pb_name, frame, axis=None, angle=0.0, loc=None):
    pb = arm.pose.bones[pb_name]
    if axis is not None:
        pb.rotation_mode = 'QUATERNION'
        qw = Quaternion(Vector(axis), angle)
        pb.rotation_quaternion = rest_q[pb_name].inverted() @ qw @ rest_q[pb_name]
        pb.keyframe_insert('rotation_quaternion', frame=frame)
    if loc is not None:
        pb.location = loc
        pb.keyframe_insert('location', frame=frame)

X, Y, Z = (1, 0, 0), (0, 1, 0), (0, 0, 1)
arm.animation_data_create()

def new_action(name):
    act = bpy.data.actions.new(name)
    ad = arm.animation_data
    ad.action = act
    # Blender 4.4+ slotted actions：必须显式绑定 slot，否则曲线不参与求值
    slot = act.slots.new('OBJECT', name)
    ad.action_slot = slot
    return act

def rest_all(frame, bones):
    for b in bones:
        keyw(b, frame, axis=X, angle=0.0)

RENDER_CAM = None
def setup_cam():
    global RENDER_CAM
    cd = bpy.data.cameras.new("cam"); RENDER_CAM = bpy.data.objects.new("cam", cd)
    scene.collection.objects.link(RENDER_CAM); scene.camera = RENDER_CAM
    RENDER_CAM.location = (0, -2.3, 0.62)
    RENDER_CAM.rotation_euler = (Vector((0, 0.05, 0.60)) - RENDER_CAM.location).to_track_quat('-Z', 'Y').to_euler()
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.display.shading.light = 'STUDIO'
    scene.display.shading.color_type = 'TEXTURE'
    scene.render.resolution_x = 480; scene.render.resolution_y = 600

def snap(tag, frame):
    scene.frame_set(frame)
    bpy.context.view_layer.update()
    scene.render.filepath = f"/tmp/rig_{tag}.png"
    bpy.ops.render.render(write_still=True)
    print("SNAP", tag)

# ---- idle：呼吸微动（48 帧循环） ----
IDLE_BONES = ["Chest", "Head", "UpperArm.L", "UpperArm.R"]
act = new_action("idle")
rest_all(1, IDLE_BONES); keyw("Hips", 1, loc=(0, 0, 0))
keyw("Chest", 24, axis=X, angle=0.045)
keyw("Head", 24, axis=X, angle=-0.035)
keyw("UpperArm.L", 24, axis=X, angle=0.05)
keyw("UpperArm.R", 24, axis=X, angle=0.05)
keyw("Hips", 24, loc=(0, -0.008, 0))
rest_all(48, IDLE_BONES); keyw("Hips", 48, loc=(0, 0, 0))

# ---- attack：拧身小挥剑（16 帧 once）；手臂权重有限，幅度克制 ----
ATK_BONES = ["UpperArm.R", "Forearm.R", "Hand.R", "Chest"]
act = new_action("attack")
rest_all(1, ATK_BONES)
keyw("UpperArm.R", 5, axis=X, angle=0.55)         # 抬臂后引
keyw("Forearm.R", 5, axis=X, angle=0.30)
keyw("Hand.R", 5, axis=X, angle=-0.25)
keyw("Chest", 5, axis=Z, angle=-0.22)             # 拧身蓄力
keyw("UpperArm.R", 9, axis=X, angle=-0.80)        # 向前挥
keyw("Forearm.R", 9, axis=X, angle=-0.25)
keyw("Hand.R", 9, axis=X, angle=0.45)             # 压腕，刃口朝前下
keyw("Chest", 9, axis=Z, angle=0.32)
rest_all(16, ATK_BONES)
setup_cam(); snap("attack", 9)
RENDER_CAM.location = (-2.2, -0.6, 0.62)
RENDER_CAM.rotation_euler = (Vector((0, 0, 0.60)) - RENDER_CAM.location).to_track_quat('-Z', 'Y').to_euler()
scene.render.filepath = "/tmp/rig_attack_side.png"
bpy.ops.render.render(write_still=True)
print("SNAP attack_side")

# ---- hit：受击后仰（12 帧 once） ----
HIT_BONES = ["Chest", "Head"]
act = new_action("hit")
rest_all(1, HIT_BONES); keyw("Hips", 1, loc=(0, 0, 0))
keyw("Chest", 4, axis=X, angle=-0.28)
keyw("Head", 4, axis=X, angle=-0.22)
keyw("Hips", 4, loc=(0, 0.03, 0))
rest_all(12, HIT_BONES); keyw("Hips", 12, loc=(0, 0, 0))

# ---- skill：蹲伏起跳空袭（30 帧 once） ----
SK_BONES = ["Chest", "UpperArm.L", "UpperArm.R", "Thigh.L", "Thigh.R", "Shin.L", "Shin.R"]
act = new_action("skill")
rest_all(1, SK_BONES); keyw("Hips", 1, loc=(0, 0, 0))
# 蹲伏蓄力
keyw("Hips", 8, loc=(0, -0.13, 0))
for s in ("L", "R"):
    keyw(f"Thigh.{s}", 8, axis=X, angle=-0.55)
    keyw(f"Shin.{s}", 8, axis=X, angle=0.75)
keyw("Chest", 8, axis=X, angle=0.22)
keyw("UpperArm.L", 8, axis=X, angle=0.45); keyw("UpperArm.R", 8, axis=X, angle=0.45)
# 起跳展开，双臂微张保持平衡（手臂权重有限，靠腿部跳跃做表现）
keyw("Hips", 14, loc=(0, 0.24, 0))
for s in ("L", "R"):
    keyw(f"Thigh.{s}", 14, axis=X, angle=-0.15)
    keyw(f"Shin.{s}", 14, axis=X, angle=0.20)
keyw("Chest", 14, axis=X, angle=-0.12)
keyw("UpperArm.L", 14, axis=X, angle=-0.55); keyw("UpperArm.R", 14, axis=X, angle=-0.55)
# 落地缓冲
keyw("Hips", 24, loc=(0, -0.10, 0))
for s in ("L", "R"):
    keyw(f"Thigh.{s}", 24, axis=X, angle=-0.45)
    keyw(f"Shin.{s}", 24, axis=X, angle=0.60)
keyw("Chest", 24, axis=X, angle=0.15)
keyw("UpperArm.L", 24, axis=X, angle=-0.15); keyw("UpperArm.R", 24, axis=X, angle=-0.15)
rest_all(30, SK_BONES); keyw("Hips", 30, loc=(0, 0, 0))
snap("skill", 14)

# idle 验证帧（attack/skill 渲染后补拍；切 action 必须同时换 slot）
_idle_act = bpy.data.actions["idle"]
arm.animation_data.action = _idle_act
arm.animation_data.action_slot = _idle_act.slots[0]
snap("idle", 24)

# ---- 全部 stash 进 NLA（导出成多条动画） ----
arm.animation_data.action = None
for name in ("idle", "attack", "hit", "skill"):
    act = bpy.data.actions[name]
    tr = arm.animation_data.nla_tracks.new(); tr.name = name
    st = tr.strips.new(name, int(act.frame_range[0]), act)
    if hasattr(st, "action_slot") and len(act.slots):
        st.action_slot = act.slots[0]
    tr.mute = True

# ---- 导出 GLB ----
bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format='GLB',
    export_animation_mode='NLA_TRACKS',
    export_animations=True,
    export_skins=True,
    export_yup=True,
)
import os
print("EXPORTED:", OUT, os.path.getsize(OUT), "bytes")
print("DONE")
