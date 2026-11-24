# 清理 AI 图生 3D 网格里的悬浮碎块：焊接顶点 → 按连通分量聚类 → 删掉过小的分量 → 导出 GLB。
#
# 为什么要先焊接：GLB 导入后顶点被 UV/法线接缝拆开（实测 5 万面 / 4.1 万顶点，平均价数仅 2.4），
# 不焊接直接按边连通数出来的「岛屿」绝大多数是接缝碎片，按它删会把模型戳出洞。
# 焊接（remove_doubles）只合并**位置重合**的顶点，UV 存放在 loop 上不受影响，对后续绑骨也只会有好处。
#
# 用途：混元多视图版会残留披风下摆等悬浮小碎片（实测 30k 多视图版有 2 块、共 89 顶点、占 0.6%），
# 送进绑骨会被最近邻权重胡乱牵连，绑骨前应先删。
#
# 用法：Blender -b --python tools/mesh_clean_islands.py -- <in.glb> <out.glb> [最小顶点数=50]
import bpy, bmesh, sys

argv = sys.argv[sys.argv.index("--") + 1:]
if len(argv) < 2:
    print("用法: Blender -b --python tools/mesh_clean_islands.py -- <in.glb> <out.glb> [最小顶点数]")
    sys.exit(1)
SRC, OUT = argv[0], argv[1]
MIN_V = int(argv[2]) if len(argv) > 2 else 50
WELD = 0.0006


def components(bm):
    """按边连通聚类，返回 [[vert_index, ...], ...]。"""
    bm.verts.ensure_lookup_table()
    seen = set()
    out = []
    for v in bm.verts:
        if v.index in seen:
            continue
        stack = [v]
        seen.add(v.index)
        comp = []
        while stack:
            cur = stack.pop()
            comp.append(cur)
            for e in cur.link_edges:
                o = e.other_vert(cur)
                if o.index not in seen:
                    seen.add(o.index)
                    stack.append(o)
        out.append(comp)
    return out


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
v_in, f_in = len(obj.data.vertices), len(obj.data.polygons)

bm = bmesh.new()
bm.from_mesh(obj.data)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=WELD)
bm.verts.ensure_lookup_table()
v_weld = len(bm.verts)

comps = components(bm)
comps.sort(key=len, reverse=True)
keep = [c for c in comps if len(c) >= MIN_V]
drop = [c for c in comps if len(c) < MIN_V]
print(f"[in]  顶点 {v_in} → 焊接后 {v_weld}  三角面 {f_in}")
print(f"[islands] 共 {len(comps)} 个：保留 {len(keep)} / 删除 {len(drop)}")
for i, c in enumerate(comps[:8]):
    xs = [v.co.x for v in c]; ys = [v.co.y for v in c]; zs = [v.co.z for v in c]
    tag = "保留" if len(c) >= MIN_V else "★删除"
    print(f"   {tag} n={len(c):6d}  x {min(xs):+.3f}..{max(xs):+.3f}  y {min(ys):+.3f}..{max(ys):+.3f}  z {min(zs):+.3f}..{max(zs):+.3f}")

if drop:
    dead = [v for c in drop for v in c]
    bmesh.ops.delete(bm, geom=dead, context='VERTS')
    print(f"[clean] 删除 {len(drop)} 个碎块、共 {len(dead)} 顶点")
else:
    print("[clean] 没有需要删除的碎块")

bm.to_mesh(obj.data)
bm.free()
obj.data.update()
print(f"[out] 顶点 {len(obj.data.vertices)}  三角面 {len(obj.data.polygons)}  → {OUT}")

bpy.ops.object.select_all(action='DESELECT')
obj.select_set(True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True)
print("CLEAN_DONE")
