# 检测可视化调试：把「镜像不对称顶点」单独剔出来渲染，肉眼确认它到底抓到了什么
# 用法：Blender -b --python tools/prop_detect_viz.py -- <in.glb> [asym阈值]
import bpy, sys, os, math, bmesh
from mathutils import Vector, kdtree

argv = sys.argv[sys.argv.index("--") + 1:]
SRC = argv[0]
THR = float(argv[1]) if len(argv) > 1 else 0.05
OUTDIR = "/tmp/propviz"
os.makedirs(OUTDIR, exist_ok=True)
TAG = os.path.basename(SRC).replace(".glb", "")

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
mesh = bpy.context.view_layer.objects.active

mins = Vector((1e9, 1e9, 1e9)); maxs = Vector((-1e9, -1e9, -1e9))
for v in mesh.data.vertices:
    w = mesh.matrix_world @ v.co
    mins = Vector(map(min, mins, w)); maxs = Vector(map(max, maxs, w))
H = maxs.z - mins.z
if abs(H - 1.0) > 0.005:
    s = 1.0 / H
    mesh.scale = (s, s, s)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
if abs(mins.z) > 0.005:
    mesh.location.z = -mins.z
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)

co = [mesh.matrix_world @ v.co for v in mesh.data.vertices]
N = len(co)
kdm = kdtree.KDTree(N)
for i, p in enumerate(co):
    kdm.insert(Vector((-p.x, p.y, p.z)), i)
kdm.balance()
asym = [kdm.find(co[i])[2] for i in range(N)]
sel = set(i for i in range(N) if asym[i] > THR and abs(co[i].x) > 0.02)
print("ASYM_SEL %d / %d (thr=%.3f)" % (len(sel), N, THR))

# 复制一份网格：iso 只留 asym 面，原网格删掉 asym 面（互补，避免共面 z-fighting 把红色盖住）
bpy.ops.object.select_all(action='DESELECT')
mesh.select_set(True)
bpy.context.view_layer.objects.active = mesh
bpy.ops.object.duplicate()
iso = bpy.context.view_layer.objects.active
iso.name = "asym_only"


def keep_faces(obj, pred):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.verts.ensure_lookup_table()
    drop = [f for f in bm.faces if not pred(f)]
    bmesh.ops.delete(bm, geom=drop, context='FACES')
    bm.to_mesh(obj.data)
    bm.free()


keep_faces(iso, lambda f: all(v.index in sel for v in f.verts))
keep_faces(mesh, lambda f: not all(v.index in sel for v in f.verts))
print("ASYM_FACES iso=%d body=%d (总 %d)" %
      (len(iso.data.polygons), len(mesh.data.polygons), len(iso.data.polygons) + len(mesh.data.polygons)))

mesh.color = (0.55, 0.55, 0.58, 1.0)
iso.color = (1.0, 0.15, 0.05, 1.0)

sc = bpy.context.scene
cd = bpy.data.cameras.new("cam")
cam = bpy.data.objects.new("cam", cd)
sc.collection.objects.link(cam)
sc.camera = cam
sc.render.engine = 'BLENDER_WORKBENCH'
sc.display.shading.light = 'STUDIO'
sc.display.shading.color_type = 'OBJECT'
sc.render.resolution_x = 520
sc.render.resolution_y = 620
sc.render.film_transparent = False


def shot(tag, loc, tgt=(0, 0, 0.55)):
    cam.location = loc
    cam.rotation_euler = (Vector(tgt) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    sc.render.filepath = "%s/%s_%s.png" % (OUTDIR, TAG, tag)
    bpy.ops.render.render(write_still=True)
    print("SHOT", sc.render.filepath)


shot("front", (0, -2.2, 0.60))
shot("right", (-2.2, 0, 0.60))
shot("left", (2.2, 0, 0.60))
shot("top", (0, -0.001, 2.4), (0, 0, 0.5))
print("VIZ_DONE", OUTDIR)
