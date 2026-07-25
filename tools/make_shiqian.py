# 时迁（鼓上蚤）Blender 模型生成脚本 —— 匹配 src/raid/render/models.js 低多边形图腾风格
# 用法: /Applications/Blender.app/Contents/MacOS/Blender --background --python tools/make_shiqian.py
# 产物: assets/models/shiqian.glb (+ .blend + 预览图)
# 坐标约定: Blender Z 向上、正面朝 -Y；glTF 导出后 = Y 向上、正面朝 +Z（与游戏一致）
import bpy, math, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "assets", "models")
os.makedirs(OUT_DIR, exist_ok=True)

# ---------- 清场 ----------
bpy.ops.wm.read_factory_settings(use_empty=True)

# ---------- 材质（Principled，平色，匹配 MeshLambert 观感） ----------
def mkmat(name, rgb, metallic=0.0, roughness=0.85):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*rgb, 1.0)
    b.inputs["Metallic"].default_value = metallic
    b.inputs["Roughness"].default_value = roughness
    m.diffuse_color = (*rgb, 1.0)   # 视口/Workbench 预览色
    return m

def hexrgb(h):  # "4a4f58" -> (r,g,b) 线性近似直接用 sRGB 值即可
    return tuple(int(h[i:i+2], 16) / 255 for i in (0, 2, 4))

M = {
    "cloth":  mkmat("夜行衣",   hexrgb("343943")),            # 深灰蓝夜行衣
    "hood":   mkmat("头罩",     hexrgb("69717d")),            # 灰头罩
    "mask":   mkmat("面巾",     hexrgb("33373e")),            # 深色面巾
    "skin":   mkmat("皮肤",     hexrgb("e8b890")),
    "dark":   mkmat("深色件",   hexrgb("23262c")),            # 腰带/鞋/握把
    "blade":  mkmat("匕首",     hexrgb("d8d8d8"), 0.6, 0.4),  # 金属刃
    "rope":   mkmat("绳索",     hexrgb("8a6a3a")),            # 麻绳
    "drum":   mkmat("小鼓身",   hexrgb("a33a2a")),            # 鼓上蚤彩蛋：腰挂小鼓
    "drumhead": mkmat("鼓面",   hexrgb("e0cfa0")),
}

# ---------- 建模辅助 ----------
def finish(ob, mat, name):
    if mat: ob.data.materials.append(mat)
    ob.name = name
    return ob

def cyl(rt, rb, h, mat, x=0, y=0, z=0, seg=10, rot=None, name="part"):
    # 圆台: radius1=下底, radius2=上底
    bpy.ops.mesh.primitive_cone_add(vertices=seg, radius1=rb, radius2=rt, depth=h, location=(x, y, z))
    o = bpy.context.object
    if rot: o.rotation_euler = rot
    return finish(o, mat, name)

def sph(r, mat, x=0, y=0, z=0, name="part", scale=None):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, segments=12, ring_count=8, location=(x, y, z))
    o = bpy.context.object
    if scale: o.scale = scale
    return finish(o, mat, name)

def box(w, d, h, mat, x=0, y=0, z=0, rot=None, name="part"):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(x, y, z))
    o = bpy.context.object
    o.scale = (w, d, h)            # size=1 -> 半边长即 w/d/h
    if rot: o.rotation_euler = rot
    bpy.ops.object.transform_apply(scale=True)
    return finish(bpy.context.object, mat, name)

def torus(R, r, mat, x=0, y=0, z=0, rot=None, name="part"):
    bpy.ops.mesh.primitive_torus_add(major_radius=R, minor_radius=r,
        major_segments=12, minor_segments=6, location=(x, y, z))
    o = bpy.context.object
    if rot: o.rotation_euler = rot
    return finish(o, mat, name)

RX90 = (math.radians(90), 0, 0)
RY90 = (0, math.radians(90), 0)

# ---------- 时迁：瘦小 + 蒙面 + 匕首 + 飞索 + 腰鼓 ----------
parts = []
# 躯干（夜行衣，瘦削圆台）+ 腰带
parts.append(cyl(0.16, 0.22, 0.8, M["cloth"], z=0.4, name="躯干"))
parts.append(cyl(0.205, 0.205, 0.06, M["dark"], z=0.55, seg=10, name="腰带"))
# 蒙面头：灰头罩 + 露脸 + 面巾 + 双眼
parts.append(sph(0.18, M["hood"], z=0.95, name="头罩"))
parts.append(sph(0.10, M["skin"], y=-0.11, z=0.93, name="脸", scale=(1, 0.7, 1)))
parts.append(box(0.11, 0.05, 0.06, M["mask"], y=-0.165, z=0.895, name="面巾"))
for s in (-1, 1):
    parts.append(sph(0.02, M["dark"], x=0.045*s, y=-0.175, z=0.955, name="眼"))
# 匕首（右手侧，反握斜向前下方，大剪影）
parts.append(box(0.02, 0.045, 0.13, M["blade"], x=0.30, y=-0.10, z=0.50,
                 rot=(math.radians(55), 0, 0), name="匕首刃"))
parts.append(box(0.03, 0.05, 0.06, M["dark"], x=0.30, y=0.0, z=0.43,
                 rot=(math.radians(55), 0, 0), name="匕首柄"))
# 飞索（背后绳圈 + 钩）
parts.append(torus(0.13, 0.035, M["rope"], y=0.17, z=0.62, rot=RX90, name="绳圈"))
parts.append(box(0.045, 0.04, 0.09, M["blade"], y=0.18, z=0.78, name="飞钩"))
# 小鼓（腰左侧竖挂，鼓上蚤标志：红鼓身 +  pale 鼓面）
parts.append(cyl(0.07, 0.07, 0.08, M["drum"], x=-0.205, y=-0.10, z=0.52, name="小鼓"))
for s in (-1, 1):
    parts.append(cyl(0.072, 0.072, 0.014, M["drumhead"], x=-0.205, y=-0.10, z=0.52 + 0.047*s,
                     name="鼓面"))

# ---------- 合并为单网格 ----------
for p in parts: p.select_set(True)
bpy.context.view_layer.objects.active = parts[0]
bpy.ops.object.join()
hero = bpy.context.object
hero.name = "ShiQian"

blend_path = os.path.join(OUT_DIR, "shiqian.blend")
bpy.ops.wm.save_as_mainfile(filepath=blend_path)

glb_path = os.path.join(OUT_DIR, "shiqian.glb")
bpy.ops.export_scene.gltf(filepath=glb_path, export_format="GLB", export_yup=True)

# ---------- 预览渲染（从导出的 GLB 重新导入渲染，端到端验证） ----------
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=glb_path)
scene = bpy.context.scene
bpy.ops.object.camera_add(location=(1.7, -2.1, 1.35))
cam = bpy.context.object
def point_at(ob, target):
    d = target - ob.location
    ob.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
from mathutils import Vector
point_at(cam, Vector((0, 0, 0.55)))
scene.camera = cam
bpy.ops.object.light_add(type="SUN", location=(2, -3, 4))
sun = bpy.context.object
sun.data.energy = 1.6
point_at(sun, Vector((0, 0, 0.5)))
world = bpy.data.worlds.new("预览"); scene.world = world
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.13, 0.11, 0.09, 1)

engines = [i.identifier for i in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items]
eevee = next((e for e in engines if "EEVEE" in e), "BLENDER_WORKBENCH")
scene.render.engine = eevee
scene.render.resolution_x = scene.render.resolution_y = 512
scene.render.filepath = os.path.join(OUT_DIR, "shiqian_preview.png")
bpy.ops.render.render(write_still=True)

print("OK ->", glb_path)
