# 网格健康度统计：顶点/三角面/包围盒 + 连通岛屿数与各岛规模。
#
# 用途：对比「单图生 3D」与「多视图生 3D」的成品质量 —— 兵器是否与身体粘连、
#       是否有大量漂浮碎块。看焊接后的 islands 数量与最大岛占比最直观。
#
# 【重要】GLB 导入后顶点会被 UV/法线接缝拆开（实测 50000 面 / 41154 顶点，
# 平均价数仅 2.4），直接按边连通数岛屿会得出上千个「假岛」，毫无意义。
# 所以必须先按距离焊接（remove_doubles）再数；同时把焊接前后的数量都打出来，
# 「拆分量」本身也是网格质量信号（拆得越狠说明接缝/硬边越多）。
#
# 用法：Blender -b --python tools/mesh_stats.py -- 输入.glb [更多.glb ...]
import bpy, bmesh, sys

argv = sys.argv[sys.argv.index("--") + 1:]
if not argv:
    print("用法: Blender -b --python tools/mesh_stats.py -- 输入.glb [...]")
    sys.exit(1)

WELD = 0.0006  # 焊接阈值；模型按身高 ~1.07 归一，0.0006 约合 0.06% 身高


def islands_of(bm):
    """按边连通聚类，返回各岛顶点数（降序）。"""
    bm.verts.ensure_lookup_table()
    seen = set()
    sizes = []
    for v in bm.verts:
        if v.index in seen:
            continue
        stack = [v]
        seen.add(v.index)
        n = 0
        while stack:
            cur = stack.pop()
            n += 1
            for e in cur.link_edges:
                o = e.other_vert(cur)
                if o.index not in seen:
                    seen.add(o.index)
                    stack.append(o)
        sizes.append(n)
    sizes.sort(reverse=True)
    return sizes


def island_boxes(bm, want=6):
    """返回前 N 大岛的 (顶点数, 包围盒)，用来判断某个岛是不是兵器/配件。"""
    bm.verts.ensure_lookup_table()
    seen = set()
    boxes = []
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
        xs = [c.co.x for c in comp]
        ys = [c.co.y for c in comp]
        zs = [c.co.z for c in comp]
        boxes.append((len(comp), (min(xs), max(xs)), (min(ys), max(ys)), (min(zs), max(zs))))
    boxes.sort(key=lambda b: -b[0])
    return boxes[:want]


for SRC in argv:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=SRC)
    meshes = [o for o in bpy.data.objects if o.type == 'MESH']
    if not meshes:
        print(f"=== {SRC}\n  (没有网格)")
        continue

    bpy.ops.object.select_all(action='DESELECT')
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if len(meshes) > 1:
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    me = obj.data
    mw = obj.matrix_world

    pts = [mw @ v.co for v in me.vertices]
    xs = [p.x for p in pts]; ys = [p.y for p in pts]; zs = [p.z for p in pts]
    size = (max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs))

    me.calc_loop_triangles()
    mats = [m.name for m in me.materials]
    has_img = False
    for m in me.materials:
        try:
            has_img = has_img or any(n.type == 'TEX_IMAGE' for n in m.node_tree.nodes)
        except Exception:
            pass

    bm = bmesh.new()
    bm.from_mesh(me)
    raw_v = len(bm.verts)
    raw_islands = islands_of(bm)

    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=WELD)
    bm.verts.ensure_lookup_table()
    bm.edges.ensure_lookup_table()
    weld_v = len(bm.verts)
    weld_islands = islands_of(bm)
    boxes = island_boxes(bm)
    bm.free()

    print(f"=== {SRC}")
    print(f"  对象 {len(meshes)}（已合并）  三角面 {len(me.loop_triangles)}  材质 {len(mats)}  含贴图 {has_img}")
    print(f"  包围盒 {size[0]:.3f} x {size[1]:.3f} x {size[2]:.3f}   Z {min(zs):.3f}..{max(zs):.3f}")
    print(f"  着色拆分量（导入态）顶点 {raw_v}  假岛 {len(raw_islands)}  → 焊接后顶点 {weld_v}")
    print(f"  ★ 真实连通岛屿 {len(weld_islands)} 个  最大岛占比 {weld_islands[0] / weld_v * 100:.1f}%")
    print(f"    各岛顶点数 {weld_islands[:10]}")
    small = [s for s in weld_islands if s < 50]
    print(f"    小于 50 顶点的孤立碎块 {len(small)} 个（合计 {sum(small)} 顶点，占 {sum(small) / weld_v * 100:.2f}%）")
    print("    前几大岛包围盒 [n | x范围 | y范围 | z范围]：")
    for n, xr, yr, zr in boxes:
        print(f"      n={n:6d}  x {xr[0]:+.3f}..{xr[1]:+.3f}  y {yr[0]:+.3f}..{yr[1]:+.3f}  z {zr[0]:+.3f}..{zr[1]:+.3f}")
print("MESH_STATS_DONE")
