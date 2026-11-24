# 把角色模型渲染成 4 张正交视角图（front/back/left/right），透明背景，供轮廓比对。
#
# 用途：验证「多视图生 3D」是否真的比「单图生 3D」更贴合参考图 ——
#       尤其是背面/侧面这两个单图方案只能靠猜的方向。
#
# 坐标约定（与 tools/analyze_mesh_profile.py 一致）：-y = 角色前方，+x = 角色左手侧。
# 所以「看角色左侧面」= 相机放在 +X 侧。
#
# 用法：Blender -b --python tools/render_model_views.py -- 输入.glb 输出目录 [正交视野尺寸]
import bpy, sys, os, math
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
SRC, OUT = argv[0], argv[1]
SCALE = float(argv[2]) if len(argv) > 2 else 1.3
os.makedirs(OUT, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)

meshes = [o for o in bpy.data.objects if o.type == 'MESH']
bpy.ops.object.select_all(action='DESELECT')
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
if len(meshes) > 1:
    bpy.ops.object.join()
obj = bpy.context.view_layer.objects.active
mw = obj.matrix_world

# 归一化：身高 1.0、脚底 z=0、xy 居中
pts = [mw @ v.co for v in obj.data.vertices]
zmin = min(p.z for p in pts); zmax = max(p.z for p in pts)
H = zmax - zmin
cx = (min(p.x for p in pts) + max(p.x for p in pts)) / 2
cy = (min(p.y for p in pts) + max(p.y for p in pts)) / 2
s = 1.0 / H
obj.scale = (s, s, s)
obj.location = (-cx * s, -cy * s, -zmin * s)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
print(f"[norm] 身高 {H:.3f} → 1.0，脚底归零，xy 居中")

scene = bpy.context.scene
cam_data = bpy.data.cameras.new('cam')
cam_data.type = 'ORTHO'
cam_data.ortho_scale = SCALE
cam = bpy.data.objects.new('cam', cam_data)
scene.collection.objects.link(cam)
scene.camera = cam

scene.render.engine = 'BLENDER_WORKBENCH'
scene.display.shading.light = 'STUDIO'
scene.display.shading.color_type = 'TEXTURE'
scene.display.shading.show_shadows = False
scene.render.film_transparent = True
scene.render.resolution_x = scene.render.resolution_y = 512
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'

D = 3.0
TARGET = Vector((0, 0, 0.5))
# 视角名 → 相机方位角（度，0=正前，+ 往角色左侧转）；-y 是角色前方，+x 是角色左手侧
VIEWS = {
    'front': 0,
    'left_front': 45,
    'left': 90,
    'back': 180,
    'right': -90,
    'right_front': -45,
}
for name, a in VIEWS.items():
    rad = math.radians(a)
    pos = Vector((D * math.sin(rad), -D * math.cos(rad), 0.5))
    cam.location = pos
    cam.rotation_euler = (TARGET - pos).normalized().to_track_quat('-Z', 'Y').to_euler()
    scene.render.filepath = os.path.join(OUT, f'{name}.png')
    bpy.ops.render.render(write_still=True)
    print(f"[view] {name} (方位 {a:+d}°) → {scene.render.filepath}")
print("RENDER_VIEWS_DONE")
