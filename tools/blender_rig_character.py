# 无头 Blender 自动绑骨 + 动画脚本（AI 图生3D 角色 → 游戏可用 GLB）
# 流程：导入 GLB → 应用变换 → 压贴图(≤1024) → 归一化到身高 1.0 → 按实测包围盒生成人形骨架
#       → 自动权重蒙皮（含武器道具自动识别）→ idle/attack/hit/skill 四组动作 → NLA stash → 导出 GLB
# 用法：Blender -b --python tools/blender_rig_character.py -- 输入.glb 输出.glb [L|R]
#       第三参数 = 武器持握手（默认 R）；左手持武器（花荣弓 / 鲁智深禅杖）必须显式传 L，否则空挥。
# Blender 坐标系（导入后）：+Z=上，-Y=前，+X=角色左手侧
import bpy, sys
from mathutils import Vector, Quaternion

argv = sys.argv[sys.argv.index("--") + 1:]
SRC, OUT = argv[0], argv[1]
# 可选第三参数：武器持握手（L/R），默认 R。决定挥击动作主要驱动哪条手臂。
WEAPON_HAND = (argv[2].upper() if len(argv) > 2 else "R")
assert WEAPON_HAND in ("L", "R"), f"hand 参数只能是 L 或 R，收到 {WEAPON_HAND}"

# 渲染帧的文件名前缀 = 输出文件名（不含扩展名）。
# 为什么必须带前缀：原先写死 /tmp/rig_<tag>.png，批量跑时每一位都覆盖上一位，
# 结果**只有最后一个角色的验证帧能存活** —— 而「兵器到底跟不跟手」只能靠这些帧判读。
import os
PREFIX = os.path.splitext(os.path.basename(OUT))[0]
print("RENDER_PREFIX", PREFIX)

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

# ---- 归一化到身高 1.0（下方骨架坐标按 0..1 硬编码；混元输出通常已是 1.0，不同批次可能有差异） ----
bpy.ops.object.select_all(action='DESELECT')
mesh.select_set(True)
bpy.context.view_layer.objects.active = mesh
if abs(H - 1.0) > 0.005:
    s = 1.0 / H
    mesh.scale = (s, s, s)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    print("NORMALIZED_H1 scale=", round(s, 4))
else:
    print("NORMALIZED_H1 skipped (already 1.0)")
if abs(mins.z) > 0.005:  # 脚底贴 z=0
    mesh.location.z = -mins.z
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
    print("GROUND_OFFSET", round(-mins.z, 4))
# 重新实测（归一化后）
mins = Vector((1e9, 1e9, 1e9)); maxs = Vector((-1e9, -1e9, -1e9))
for v in mesh.data.vertices:
    w = mesh.matrix_world @ v.co
    mins = Vector(map(min, mins, w)); maxs = Vector(map(max, maxs, w))
H = maxs.z - mins.z
print("BBOX_NORM", tuple(round(v, 3) for v in mins), tuple(round(v, 3) for v in maxs), "H", round(H, 3))

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

# 区域感知候选骨
# 历史坑（已修）：旧版在 z<0.56 时只给 LEGS 做候选，理由是「防止手骨抓腿侧布片」。
# 但骨架里 Hand.L/R 就定义在 z=0.43..0.49（自然垂手），于是手部顶点候选集里根本没有手骨
# → Hand.L/Hand.R 权重恒为 0、前臂仅 ~350 顶点，attack 动作完全空挥。
# 现在改为：下半身也把该侧手臂链放进候选，靠 GATE 距离门限裁决归属
# （真手贴近时手骨赢；腿侧布片超门限自动回退腿胯）。
ARMCHAIN = {"Shoulder.L","UpperArm.L","Forearm.L","Hand.L","Shoulder.R","UpperArm.R","Forearm.R","Hand.R"}
TORSO = {"Hips","Spine","Chest","Neck","Head"}
LEGS = {"Hips","Thigh.L","Thigh.R","Shin.L","Shin.R","Foot.L","Foot.R"}
def cand_names(p):
    side = 'L' if p.x > 0 else 'R'
    arm = {f"Shoulder.{side}", f"UpperArm.{side}", f"Forearm.{side}", f"Hand.{side}"}
    if p.z > 0.56:  # 上半身
        if abs(p.x) < 0.10:
            return (sorted(TORSO), False)
        return (sorted(TORSO | arm), False)
    return (sorted(LEGS | arm), False)  # 下半身：腿胯为主，手/前臂靠 GATE 抢贴近的顶点

# 距离门限：手臂骨只在贴近时生效（拳头旁的衣襟超过门限就回退到腿胯）
GATE = {"Hand.L": 0.07, "Hand.R": 0.07, "Forearm.L": 0.08, "Forearm.R": 0.08,
        "UpperArm.L": 0.09, "UpperArm.R": 0.09, "Shoulder.L": 0.09, "Shoulder.R": 0.09}

# ---- 武器/道具自动识别（替代旧的「时迁剑盒」硬编码） ----
# 关键事实：混元输出的网格是「面片汤」（实测 23k 顶点 / 897 个连通岛屿，最大岛仅 390 顶点），
# 所以「找一个装下整把武器的连通块」这条路走不通。改用三步几何法：
#   1) 种子点：靠近手/前臂（<0.35）且远离躯干与腿（>0.13）→ 武器是唯一满足这个组合的东西
#   2) 空间洪泛生长（KD 树，半径 0.06，新点仍需远离躯干）→ 顺着杆身一直长到兵器尖端，
#      不受「离手多远」限制，长矛/长弓的远端才能被覆盖
#   3) 形状校验：长细比 > 3 → 判为手持兵器，整簇 100% 绑到该侧手骨（刚体随动）
# 反例拦截：披风/直裰下摆（不够细长）、散发（离手太远）。
BODY_BONES = sorted(TORSO | LEGS | {"Shoulder.L", "Shoulder.R", "UpperArm.L", "UpperArm.R"})
HAND_SIDE = {"L": ["Hand.L", "Forearm.L"], "R": ["Hand.R", "Forearm.R"]}
mw = mesh.matrix_world

from mathutils import kdtree
_kd = kdtree.KDTree(len(mesh.data.vertices))
for v in mesh.data.vertices:
    _kd.insert(mw @ v.co, v.index)
_kd.balance()

_d_body = [0.0] * len(mesh.data.vertices)
_d_hand = {"L": [9.9] * len(mesh.data.vertices), "R": [9.9] * len(mesh.data.vertices)}
for v in mesh.data.vertices:
    p = mw @ v.co
    _d_body[v.index] = min(dist_seg(p, segs[n][0], segs[n][1]) for n in BODY_BONES)
    for s in ("L", "R"):
        _d_hand[s][v.index] = min(dist_seg(p, segs[n][0], segs[n][1]) for n in HAND_SIDE[s])

forced_prop = {}
prop_report = []
for side in ("L", "R"):
    # 种子必须「贴着这只手」：dh<0.10。放宽到 0.35 会让宽体型角色的躯干/袍面大量混入（实测泄漏到 15.5k 顶点）
    seeds = [v.index for v in mesh.data.vertices
             if _d_hand[side][v.index] < 0.10 and _d_body[v.index] > 0.15]
    prop_report.append((f"{side}:种子", len(seeds), None, None))
    if len(seeds) < 10:
        continue
    seen = set(seeds)
    stack = list(seeds)
    while stack:                                   # 空间洪泛（非拓扑连通）
        i = stack.pop()
        p = mw @ mesh.data.vertices[i].co
        for _co, j, _dist in _kd.find_range(p, 0.06):
            if j in seen or _d_body[j] <= 0.12:     # 新点仍须远离躯干，防止顺着手长进身体
                continue
            seen.add(j)
            stack.append(j)
    pts = [mw @ mesh.data.vertices[i].co for i in seen]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    dims = sorted((hi - lo), reverse=True)
    elong = dims[0] / max(dims[2], 1e-6)
    if dims[0] < 0.20 or elong < 3.0 or len(seen) > 6000:
        prop_report.append((f"{side}:丢弃", len(seen), tuple(round(x, 3) for x in dims), round(elong, 1)))
        continue
    bone = HAND_SIDE[side][0]                      # 绑到手骨
    for i in seen:
        forced_prop[i] = bone
    prop_report.append((bone, len(seen), tuple(round(x, 3) for x in dims), round(elong, 1)))
print("PROP_CLUSTERS:", prop_report if prop_report else "无（未识别到手持道具）")

assigns = {}
mw = mesh.matrix_world
for v in mesh.data.vertices:
    p = mw @ v.co
    fp = forced_prop.get(v.index)
    if fp:                                   # 已识别的武器：整块刚性绑到该手骨
        assigns.setdefault(fp, []).append((v.index, 1.0))
        continue
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
def front_cam():
    """把相机放回正面（idle/attack 正视图都用它；侧视图之后必须调用复位）。"""
    RENDER_CAM.location = (0, -2.3, 0.62)
    RENDER_CAM.rotation_euler = (Vector((0, 0.05, 0.60)) - RENDER_CAM.location).to_track_quat('-Z', 'Y').to_euler()

def setup_cam():
    global RENDER_CAM
    cd = bpy.data.cameras.new("cam"); RENDER_CAM = bpy.data.objects.new("cam", cd)
    scene.collection.objects.link(RENDER_CAM); scene.camera = RENDER_CAM
    front_cam()
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.display.shading.light = 'STUDIO'
    scene.display.shading.color_type = 'TEXTURE'
    scene.render.resolution_x = 480; scene.render.resolution_y = 600

def snap(tag, frame):
    scene.frame_set(frame)
    bpy.context.view_layer.update()
    scene.render.filepath = f"/tmp/rig_{PREFIX}_{tag}.png"
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

# ---- attack：拧身挥击（16 帧 once）；手臂权重有限，幅度克制 ----
# 武器手由 WEAPON_HAND 决定（花荣持弓在左、鲁智深禅杖在左，右臂驱动会完全空挥）
WH = WEAPON_HAND
OH = "L" if WH == "R" else "R"
TWIST = 1 if WH == "R" else -1                     # 拧身方向随持握手翻转
ATK_BONES = [f"UpperArm.{WH}", f"Forearm.{WH}", f"Hand.{WH}", f"UpperArm.{OH}", "Chest"]
act = new_action("attack")
rest_all(1, ATK_BONES)
keyw(f"UpperArm.{WH}", 5, axis=X, angle=0.55)      # 持械臂后引
keyw(f"Forearm.{WH}", 5, axis=X, angle=0.30)
keyw(f"Hand.{WH}", 5, axis=X, angle=-0.25)
keyw(f"UpperArm.{OH}", 5, axis=X, angle=-0.15)     # 副臂反向配平
keyw("Chest", 5, axis=Z, angle=-0.22 * TWIST)      # 拧身蓄力
keyw(f"UpperArm.{WH}", 9, axis=X, angle=-0.80)     # 向前挥
keyw(f"Forearm.{WH}", 9, axis=X, angle=-0.25)
keyw(f"Hand.{WH}", 9, axis=X, angle=0.45)          # 压腕，刃口朝前下
keyw(f"UpperArm.{OH}", 9, axis=X, angle=0.25)
keyw("Chest", 9, axis=Z, angle=0.32 * TWIST)
rest_all(16, ATK_BONES)
setup_cam(); snap("attack", 9)
RENDER_CAM.location = (-2.2, -0.6, 0.62)
RENDER_CAM.rotation_euler = (Vector((0, 0, 0.60)) - RENDER_CAM.location).to_track_quat('-Z', 'Y').to_euler()
scene.render.filepath = f"/tmp/rig_{PREFIX}_attack_side.png"
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
# 幅度刻意克制：混元输出是「融合单面网格」，战袍/披风从肩挂到地、被多组骨共同牵引，
# 大腿旋转超过 ~0.3rad 就会把下摆撕成扇形（实测 0.55/0.75 时炸开），故按 0.28/0.42 封顶。
SK_BONES = ["Chest", "UpperArm.L", "UpperArm.R", "Thigh.L", "Thigh.R", "Shin.L", "Shin.R"]
act = new_action("skill")
rest_all(1, SK_BONES); keyw("Hips", 1, loc=(0, 0, 0))
# 蹲伏蓄力
keyw("Hips", 8, loc=(0, -0.07, 0))
for s in ("L", "R"):
    keyw(f"Thigh.{s}", 8, axis=X, angle=-0.28)
    keyw(f"Shin.{s}", 8, axis=X, angle=0.42)
keyw("Chest", 8, axis=X, angle=0.18)
keyw("UpperArm.L", 8, axis=X, angle=0.32); keyw("UpperArm.R", 8, axis=X, angle=0.32)
# 起跳展开，双臂微张保持平衡（手臂权重有限，靠腿部跳跃做表现）
keyw("Hips", 14, loc=(0, 0.16, 0))
for s in ("L", "R"):
    keyw(f"Thigh.{s}", 14, axis=X, angle=-0.10)
    keyw(f"Shin.{s}", 14, axis=X, angle=0.14)
keyw("Chest", 14, axis=X, angle=-0.10)
keyw("UpperArm.L", 14, axis=X, angle=-0.42); keyw("UpperArm.R", 14, axis=X, angle=-0.42)
# 落地缓冲
keyw("Hips", 24, loc=(0, -0.06, 0))
for s in ("L", "R"):
    keyw(f"Thigh.{s}", 24, axis=X, angle=-0.25)
    keyw(f"Shin.{s}", 24, axis=X, angle=0.35)
keyw("Chest", 24, axis=X, angle=0.12)
keyw("UpperArm.L", 24, axis=X, angle=-0.12); keyw("UpperArm.R", 24, axis=X, angle=-0.12)
rest_all(30, SK_BONES); keyw("Hips", 30, loc=(0, 0, 0))
snap("skill", 14)

# idle 验证帧（attack/skill 渲染后补拍；切 action 必须同时换 slot）
front_cam()   # 侧视图把相机挪走了，不复位会拍成斜视角
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
