# 网格剖面剖析：把 AI 图生3D 的角色网格按高度切片，在每片做 x 投影间隙聚类，
# 用来定位躯干/手臂/腿的真实位置（替代「拍脑袋硬编码骨架坐标」）。
# 用法：Blender -b --python tools/analyze_mesh_profile.py -- 输入.glb [切片数]
import bpy, sys
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
SRC = argv[0]
N = int(argv[1]) if len(argv) > 1 else 20

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
mw = mesh.matrix_world

pts = [mw @ v.co for v in mesh.data.vertices]
zmin = min(p.z for p in pts)
zmax = max(p.z for p in pts)
H = zmax - zmin
print(f"VERTS {len(pts)}  Z {zmin:.3f}..{zmax:.3f}  H {H:.3f}")

# 归一到身高 1.0、脚底 z=0，与绑骨脚本一致
s = 1.0 / H
pts = [Vector((p.x * s, p.y * s, (p.z - zmin) * s)) for p in pts]

GAP = 0.030  # x 方向间隙阈值：超过它认为分属不同「侧向团块」


def blobs(band):
    """按 x 排序切断，返回每个团块的 (x中心, x宽, y范围, 顶点数)。"""
    band = sorted(band, key=lambda p: p.x)
    out = []
    cur = [band[0]]
    for p in band[1:]:
        if p.x - cur[-1].x > GAP:
            out.append(cur)
            cur = []
        cur.append(p)
    out.append(cur)
    res = []
    for c in out:
        xs = [p.x for p in c]
        ys = [p.y for p in c]
        res.append(((min(xs) + max(xs)) / 2, max(xs) - min(xs), (min(ys), max(ys)), len(c)))
    return res


print(f"{'z':>5} {'n':>5}  " + "侧向团块 [x中心 宽 | y范围 | n]（+x=角色左手侧，-y=前）")
for i in range(N):
    z0 = i / N
    z1 = (i + 1) / N
    band = [p for p in pts if z0 <= p.z < z1]
    if len(band) < 20:
        print(f"{z0 + 0.5 / N:5.2f} {len(band):5d}  (稀疏)")
        continue
    bs = blobs(band)
    desc = "  ".join(
        f"[{c:+.3f} w{w:.3f} | y{yl:+.3f}..{yh:+.3f} | n{n}]" for c, w, (yl, yh), n in bs
    )
    print(f"{z0 + 0.5 / N:5.2f} {len(band):5d}  {desc}")
print("ANALYZE_DONE")
