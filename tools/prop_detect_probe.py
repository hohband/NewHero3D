# 武器识别判据探针 v3（只读）：修正镜像不对称度 + 射线测厚 + z 分片轮廓
# 用法：Blender -b --python tools/prop_detect_probe.py -- a.glb b.glb ...
import bpy, sys
from mathutils import Vector, kdtree

FILES = sys.argv[sys.argv.index("--") + 1:]

BONES = {
    "Hips":       ((0, 0, 0.52), (0, 0, 0.60)),
    "Spine":      ((0, 0, 0.60), (0, 0, 0.70)),
    "Chest":      ((0, 0, 0.70), (0, 0, 0.82)),
    "Neck":       ((0, 0, 0.82), (0, 0, 0.88)),
    "Head":       ((0, 0, 0.88), (0, 0, 1.00)),
    "Shoulder.L": ((0.04, 0, 0.80), (0.10, 0, 0.80)),
    "UpperArm.L": ((0.10, 0, 0.80), (0.11, -0.01, 0.63)),
    "Forearm.L":  ((0.11, -0.01, 0.63), (0.11, -0.03, 0.49)),
    "Hand.L":     ((0.11, -0.03, 0.49), (0.11, -0.07, 0.43)),
    "Shoulder.R": ((-0.04, 0, 0.80), (-0.10, 0, 0.80)),
    "UpperArm.R": ((-0.10, 0, 0.80), (-0.11, -0.01, 0.63)),
    "Forearm.R":  ((-0.11, -0.01, 0.63), (-0.11, -0.03, 0.49)),
    "Hand.R":     ((-0.11, -0.03, 0.49), (-0.11, -0.07, 0.43)),
    "Thigh.L":    ((0.055, 0, 0.52), (0.06, 0.005, 0.29)),
    "Shin.L":     ((0.06, 0.005, 0.29), (0.06, -0.01, 0.05)),
    "Foot.L":     ((0.06, -0.01, 0.05), (0.06, -0.13, 0.02)),
    "Thigh.R":    ((-0.055, 0, 0.52), (-0.06, 0.005, 0.29)),
    "Shin.R":     ((-0.06, 0.005, 0.29), (-0.06, -0.01, 0.05)),
    "Foot.R":     ((-0.06, -0.01, 0.05), (-0.06, -0.13, 0.02)),
}
SEGS = {n: (Vector(a), Vector(b)) for n, (a, b) in BONES.items()}
TORSO = {"Hips", "Spine", "Chest", "Neck", "Head"}
LEGS = {"Hips", "Thigh.L", "Thigh.R", "Shin.L", "Shin.R", "Foot.L", "Foot.R"}
HAND_SIDE = {"L": ["Hand.L", "Forearm.L"], "R": ["Hand.R", "Forearm.R"]}
BODY_FULL = sorted(TORSO | LEGS | {"Shoulder.L", "Shoulder.R", "UpperArm.L", "UpperArm.R"})


def seg_dist(p, a, b):
    ab = b - a
    L2 = ab.length_squared
    t = 0.0 if L2 < 1e-12 else max(0.0, min(1.0, (p - a).dot(ab) / L2))
    return (p - (a + t * ab)).length


def load(path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=path)
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
    bpy.ops.object.select_all(action='DESELECT')
    mesh.select_set(True)
    bpy.context.view_layer.objects.active = mesh
    if abs(H - 1.0) > 0.005:
        s = 1.0 / H
        mesh.scale = (s, s, s)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if abs(mins.z) > 0.005:
        mesh.location.z = -mins.z
        bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
    return mesh


def top_axis(pts):
    n = len(pts)
    c = Vector((0.0, 0.0, 0.0))
    for p in pts:
        c += p
    c /= n
    xx = xy = xz = yy = yz = zz = 0.0
    for p in pts:
        d = p - c
        xx += d.x * d.x; xy += d.x * d.y; xz += d.x * d.z
        yy += d.y * d.y; yz += d.y * d.z; zz += d.z * d.z
    cols = ((xx, xy, xz), (xy, yy, yz), (xz, yz, zz))
    v = Vector((0.4, 0.6, 0.7)).normalized()
    for _ in range(200):
        nv = Vector((sum(cols[0][k] * v[k] for k in range(3)),
                     sum(cols[1][k] * v[k] for k in range(3)),
                     sum(cols[2][k] * v[k] for k in range(3))))
        if nv.length < 1e-14:
            break
        nv.normalize()
        done = (nv - v).length < 1e-12
        v = nv
        if done:
            break
    return c, v


def clusterize(idxs, co, kd, r):
    pool = set(idxs); out = []
    while pool:
        s = pool.pop(); comp = [s]; stack = [s]
        while stack:
            i = stack.pop()
            for _c, j, _d in kd.find_range(co[i], r):
                if j in pool:
                    pool.discard(j); comp.append(j); stack.append(j)
        out.append(comp)
    return out


def geo(idx, co):
    pts = [co[i] for i in idx]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    dims = sorted((hi - lo), reverse=True)
    return len(idx), dims, dims[0] / max(dims[2], 1e-6), lo, hi, (lo + hi) / 2


def verdict(n, dims, elong):
    if dims[0] < 0.20:
        return "丢弃(太短)"
    if elong < 3.0:
        return "丢弃(不细长)"
    if n > 6000:
        return "丢弃(太大)"
    return "★通过"


for f in FILES:
    mesh = load(f)
    co = [mesh.matrix_world @ v.co for v in mesh.data.vertices]
    N = len(co)
    kd = kdtree.KDTree(N)
    for i, p in enumerate(co):
        kd.insert(p, i)
    kd.balance()
    kdm = kdtree.KDTree(N)
    for i, p in enumerate(co):
        kdm.insert(Vector((-p.x, p.y, p.z)), i)
    kdm.balance()

    bone_d = {n: [seg_dist(p, *SEGS[n]) for p in co] for n in BONES}
    d_full = [min(bone_d[n][i] for n in BODY_FULL) for i in range(N)]
    d_hand = {s: [min(bone_d[n][i] for n in HAND_SIDE[s]) for i in range(N)] for s in ("L", "R")}
    # ★ 修正：拿原坐标去查镜像点云（上一版查的是镜像坐标，退化成"最近邻距离"）
    asym = [kdm.find(co[i])[2] for i in range(N)]

    # 射线测厚：从顶点沿 -法线 打第二条命中，距离≈局部厚度
    bpy.context.view_layer.objects.active = mesh
    thick = []
    for i, v in enumerate(mesh.data.vertices):
        p = co[i]; nvec = v.normal
        if nvec.length < 1e-6:
            thick.append(9.9); continue
        hit, loc, _n, dist = mesh.ray_cast(p + nvec * 0.002, -nvec, distance=0.5)
        thick.append(dist if hit else 9.9)

    print("\n" + "=" * 80)
    print("FILE %s   N=%d" % (f.split("/")[-1], N))
    print("=" * 80)

    # [A] 镜像不对称：排除 |x| 极小（对称面上必然自匹配）
    asy_idx = [i for i in range(N) if asym[i] > 0.05 and abs(co[i].x) > 0.02]
    print("\n[A] 镜像不对称顶点 (asym>0.05 且 |x|>0.02) = %d / %d" % (len(asy_idx), N))
    comps = [c for c in clusterize(asy_idx, co, kd, 0.05) if len(c) >= 40]
    comps.sort(key=lambda c: -len(c))
    for k, c in enumerate(comps[:8]):
        n, dims, e, lo, hi, ctr = geo(c, co)
        mt = sum(thick[i] for i in c if thick[i] < 9) / max(1, sum(1 for i in c if thick[i] < 9))
        mh = min(min(d_hand["L"][i] for i in c), min(d_hand["R"][i] for i in c))
        side = "L" if min(d_hand["L"][i] for i in c) < min(d_hand["R"][i] for i in c) else "R"
        print("    #%d n=%-5d dims=%-26s elong=%5.1f ctr=(%.2f,%.2f,%.2f) z=[%.2f,%.2f] 厚=%.3f 近手=%s(%.2f) %s" %
              (k, n, tuple(round(x, 3) for x in dims), e, ctr.x, ctr.y, ctr.z, lo.z, hi.z, mt, side, mh,
               verdict(n, dims, e)))

    # [B] 细长且远离骨架
    thin_far = [i for i in range(N) if thick[i] < 0.05 and d_full[i] > 0.12]
    print("\n[B] 细(厚<0.05)且离骨架>0.12 = %d" % len(thin_far))
    c2 = [c for c in clusterize(thin_far, co, kd, 0.04) if len(c) >= 40]
    c2.sort(key=lambda c: -len(c))
    for k, c in enumerate(c2[:8]):
        n, dims, e, lo, hi, ctr = geo(c, co)
        mt = sum(thick[i] for i in c if thick[i] < 9) / max(1, sum(1 for i in c if thick[i] < 9))
        mh = min(min(d_hand["L"][i] for i in c), min(d_hand["R"][i] for i in c))
        side = "L" if min(d_hand["L"][i] for i in c) < min(d_hand["R"][i] for i in c) else "R"
        print("    #%d n=%-5d dims=%-26s elong=%5.1f ctr=(%.2f,%.2f,%.2f) z=[%.2f,%.2f] 厚=%.3f 近手=%s(%.2f) %s" %
              (k, n, tuple(round(x, 3) for x in dims), e, ctr.x, ctr.y, ctr.z, lo.z, hi.z, mt, side, mh,
               verdict(n, dims, e)))

    # [C] z 分片轮廓：每片最外 |x|，看"贴着身体的斜长条"
    print("\n[C] z 分片轮廓（每片：顶点数 / 最外|x| / |x|>0.16 的顶点数及其 x 均值）")
    for k in range(20):
        z0 = k * 0.05
        sl = [i for i in range(N) if z0 <= co[i].z < z0 + 0.05]
        if not sl:
            print("    z %.2f-%.2f  (空)" % (z0, z0 + 0.05)); continue
        out = [i for i in sl if abs(co[i].x) > 0.16]
        mx = max(abs(co[i].x) for i in sl)
        ox = (sum(co[i].x for i in out) / len(out)) if out else 0.0
        print("    z %.2f-%.2f  n=%-5d 最外|x|=%.3f  |x|>0.16:%-5d x均值=%+.3f" % (z0, z0 + 0.05, len(sl), mx, len(out), ox))

    # [D] 逐手：现行判据
    for s in ("L", "R"):
        dh, df = d_hand[s], d_full
        seedsA = [i for i in range(N) if dh[i] < 0.10 and df[i] > 0.15]
        hs = [i for i in range(N) if dh[i] < 0.12]
        print("\n[D] side %s: 手邻域(dh<0.12)=%d  现行A种子=%d  (d_full>0.20 的 %d)" %
              (s, len(hs), len(seedsA), sum(1 for i in hs if df[i] > 0.20)))
        # 手邻域里 asym>0.05 的（真武器候选）
        w = [i for i in hs if asym[i] > 0.05]
        print("    手邻域内 asym>0.05 = %d" % len(w))
        if w:
            n, dims, e, lo, hi, ctr = geo(w, co)
            print("      其 bbox=%s..%s ctr=(%.2f,%.2f,%.2f) dims=%s 厚均值=%.3f" %
                  (tuple(round(x, 2) for x in lo), tuple(round(x, 2) for x in hi), ctr.x, ctr.y, ctr.z,
                   tuple(round(x, 3) for x in dims),
                   sum(thick[i] for i in w if thick[i] < 9) / max(1, sum(1 for i in w if thick[i] < 9))))
print("\nPROBE_DONE")
