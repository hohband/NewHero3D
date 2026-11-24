# 武器检测算法 v2 沙盘：对称不对称双判据并集 + 轴向延伸，渲染结果供肉眼验收
# 用法：Blender -b --python tools/prop_detect_viz2.py -- <in.glb>
# 输出：/tmp/propviz2/<tag>_{front,right,top}.png（红=判定为武器的顶点）
import bpy, sys, os, bmesh, math
from mathutils import Vector, kdtree

FILES = sys.argv[sys.argv.index("--") + 1:]
OUTDIR = "/tmp/propviz2"
os.makedirs(OUTDIR, exist_ok=True)

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
TRUNK = sorted(TORSO | LEGS)
LEG_BONES = sorted({"Thigh.L", "Shin.L", "Foot.L", "Thigh.R", "Shin.R", "Foot.R"})
ARM_CHAIN = sorted({"Shoulder.L", "UpperArm.L", "Forearm.L", "Hand.L",
                    "Shoulder.R", "UpperArm.R", "Forearm.R", "Hand.R"})

# ---- 阈值集中在此，便于调参 ----
SEED_A_HAND, SEED_A_BODY, FLOOD_A_R, FLOOD_A_BODY = 0.10, 0.15, 0.06, 0.12
ASYM_THR, ASYM_XMIN, ASYM_CL_R, ASYM_MIN_N = 0.05, 0.02, 0.05, 80
# 延伸时放宽到 asym>0.015：杆身中下段 asym≈0.02-0.05（被袍角在镜像位置部分遮蔽，够不到 0.05 种子线），
# 放宽后它能进来；袍角虽然也进来，但不在轴的 3cm 内，被 r_perp 剔掉。
EXT_ASYM_MIN, EXT_RPERP, EXT_GAP, EXT_ITERS = 0.015, 0.03, 0.035, 6
W_LEN_MIN, W_ELONG_MIN, W_N_MAX, W_WID_MAX, W_HAND_MAX = 0.35, 3.0, 5000, 0.22, 0.35
# 孤立度：簇顶点到「簇外最近顶点」的距离中位数。兵器悬于空中（大），袍角连着整片面片（≈顶点间距）
ISO_R, ISO_MED_MIN = 0.08, 0.020
# ★ 关键判据：簇内顶点到「手臂链骨架」距离的中位数。
# 手臂贴着骨头（≈0.03-0.09），兵器悬在手中（中段贴手，但整条杆/刃离臂远 → 0.15+）。
# 用于剔除「因另一臂姿势不同而被判为不对称的那条自由手臂」——它是长管状，形状判据拦不住。
ARM_MED_MIN = 0.12
# 剔除「紧贴腿骨」的顶点：杆尾落在靴旁，半径 0.045 的圆柱会把踝/靴吞进来。
# 实测分布（林冲单图 簇0 1952 点）：<0.035 → 0 点；0.035-0.05 → 90 点（靴踝）；0.05-0.08 → 851 点（下杆！）。
# 故 0.05 是分界：只砍靴踝，下杆完整保留（曾用 0.08，把整段下杆连带砍掉，杆身中下段变灰）。
LEG_MIN = 0.05
# 簇内「距腿骨 <0.06」的顶点占比上限：靴子/腿甲必然大面积贴骨，兵器杆身保持 >0.06。
# 用于剔除形如「靴+袍角竖列」的假长条（它靠贴腿的靴子撑出 0.8 的长度）。
FRAC_LEG_MAX = 0.03


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


def flood(seed, co, kd, allow, r):
    seen = set(seed); stack = list(seed)
    while stack:
        i = stack.pop()
        for _c, j, _d in kd.find_range(co[i], r):
            if j in seen or not allow[j]:
                continue
            seen.add(j); stack.append(j)
    return seen


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


def axis_extend(seed, N, co, r_perp, gap, iters, allow=None):
    """沿主轴迭代延伸：切段取含当前成员最多的那段，重拟合。
    目的：把被「镜像位置的袍角/垂手」遮蔽掉的杆身中段接回来。allow 为 None 表示不设限制。"""
    cur = list(seed); axis = None
    for _ in range(iters):
        c, axis = top_axis([co[i] for i in cur])
        cand = []
        for i in range(N):
            if allow is not None and not allow[i]:
                continue
            d = co[i] - c
            t = d.dot(axis)
            if (d - t * axis).length < r_perp:
                cand.append((t, i))
        if not cand:
            break
        cand.sort(key=lambda x: x[0])
        runs = []; run = []
        for t, i in cand:
            if run and t - run[-1][0] > gap:
                runs.append(run); run = []
            run.append((t, i))
        if run:
            runs.append(run)
        curset = set(cur)
        best = None; bestkey = (-1, -1.0)
        for r_ in runs:
            key = (sum(1 for _t, i in r_ if i in curset), r_[-1][0] - r_[0][0])
            if key > bestkey:
                bestkey = key; best = r_
        if not best:
            break
        new = [i for _t, i in best]
        if set(new) == curset:
            break
        cur = new
    return set(cur)


def geo(idx, co):
    pts = [co[i] for i in idx]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    dims = sorted((hi - lo), reverse=True)
    return len(idx), dims, dims[0] / max(dims[2], 1e-6), lo, hi, (lo + hi) / 2


def isolation_stats(cluster, co, kd, r):
    """簇顶点到簇外最近顶点的距离分布。返回 (中位数, >0.03 的占比)。"""
    vals = []
    cs = cluster if isinstance(cluster, set) else set(cluster)
    for i in cs:
        best = 9.9
        for _c, j, d in kd.find_range(co[i], r):
            if j not in cs and d < best:
                best = d
        vals.append(best)
    if not vals:
        return 9.9, 0.0
    vals.sort()
    return vals[len(vals) // 2], sum(1 for v in vals if v > 0.03) / len(vals)


def keep_faces(obj, pred):
    bm = bmesh.new(); bm.from_mesh(obj.data); bm.verts.ensure_lookup_table()
    drop = [fc for fc in bm.faces if not pred(fc)]
    bmesh.ops.delete(bm, geom=drop, context='FACES')
    bm.to_mesh(obj.data); bm.free()


def dist_median(cluster, dlist):
    vs = sorted(dlist[i] for i in (cluster if isinstance(cluster, set) else set(cluster)))
    return vs[len(vs) // 2] if vs else 9.9


def axis_profile(cluster, co, nsl=14, nbin=12):
    """沿主轴的截面剖面。返回 (RMS半径中位数, 角度扇区占用率中位数, 占用>=0.5的片占比, 轴向有效片数)。
    管状杆：RMS 小且稳定、扇区占用高（顶点绕轴铺开）；扁平布条：RMS 大、扇区只有 2 个峰。"""
    pts = [co[i] for i in (cluster if isinstance(cluster, set) else set(cluster))]
    if len(pts) < 30:
        return 9.9, 0.0, 0.0, 0
    c, axis = top_axis(pts)
    u1 = axis.orthogonal().normalized()
    u2 = axis.cross(u1).normalized()
    par = []
    for p in pts:
        d = p - c
        t = d.dot(axis)
        perp = d - t * axis
        par.append((t, perp.dot(u1), perp.dot(u2)))
    par.sort(key=lambda x: x[0])
    tmin, tmax = par[0][0], par[-1][0]
    if tmax - tmin < 1e-6:
        return 9.9, 0.0, 0.0, 0
    w = (tmax - tmin) / nsl
    rms_l, occ_l = [], []
    for k in range(nsl):
        sl = [x for x in par if (k * w) <= (x[0] - tmin) < ((k + 1) * w) or (k == nsl - 1 and x[0] == tmax)]
        if len(sl) < 8:
            continue
        rms = (sum(x[1] * x[1] + x[2] * x[2] for x in sl) / len(sl)) ** 0.5
        bins = set()
        for _t, a, b in sl:
            if a * a + b * b < 1e-10:
                continue
            ang = math.atan2(b, a)
            bins.add(int((ang + math.pi) / (2 * math.pi) * nbin) % nbin)
        rms_l.append(rms)
        occ_l.append(len(bins) / float(nbin))
    if not rms_l:
        return 9.9, 0.0, 0.0, 0
    rms_l.sort(); occ_l.sort()
    return (rms_l[len(rms_l) // 2], occ_l[len(occ_l) // 2],
            sum(1 for o in occ_l if o >= 0.5) / len(occ_l), len(rms_l))


def shaft_extend(seed, N, co, d_arm, r_perp, gap):
    """沿「握持手 -> 矛头质心」这条线延伸。
    为什么不用 PCA：弯月刃的形状会把主轴带偏（实测头簇 PCA 延伸走不出杆身）。
    手是握在杆上的，所以「手 -> 矛头」方向就等于杆的走向，角度误差 ~1-2 度，0.7 长度上偏移 <0.025。"""
    seed = set(seed)
    c, _ax = top_axis([co[i] for i in seed])
    anchor = min(seed, key=lambda i: d_arm[i])          # 簇内离手臂链最近 = 握把
    axis = c - co[anchor]
    if axis.length < 1e-6:
        return seed
    axis.normalize()
    tseed = sum((co[i] - c).dot(axis) for i in seed) / len(seed)
    cand = []
    for i in range(N):
        d = co[i] - c
        t = d.dot(axis)
        if (d - t * axis).length < r_perp:
            cand.append((t, i))
    cand.sort(key=lambda x: x[0])
    runs = []; run = []
    for t, i in cand:
        if run and t - run[-1][0] > gap:
            runs.append(run); run = []
        run.append((t, i))
    if run:
        runs.append(run)
    best = None
    for r_ in runs:
        if r_[0][0] <= tseed <= r_[-1][0]:
            best = r_
            break
    if best is None and runs:
        best = max(runs, key=len)
    if best:
        seed |= set(i for _t, i in best)
    return seed


def detect(N, co, kd, d_full, d_hand, asym, d_arm=None, d_trunk=None, d_leg=None):
    forced = {}; report = []; forced_sets = []
    allow_ext = [asym[i] > EXT_ASYM_MIN for i in range(N)]
    # P1 手部种子洪泛（对称双持，如武松双刀）
    for side in ("L", "R"):
        seeds = [i for i in range(N) if d_hand[side][i] < SEED_A_HAND and d_full[i] > SEED_A_BODY]
        report.append(("P1:%s种子" % side, len(seeds), None, None))
        if len(seeds) < 10:
            continue
        c = flood(seeds, co, kd, [d_full[i] > FLOOD_A_BODY for i in range(N)], FLOOD_A_R)
        n, dims, e, _lo, _hi, _ctr = geo(c, co)
        if dims[0] < 0.20 or e < W_ELONG_MIN or n > 6000:
            report.append(("P1:%s丢弃" % side, n, tuple(round(x, 3) for x in dims), round(e, 1)))
            continue
        for i in c:
            forced[i] = "Hand." + side
        forced_sets.append(("Hand." + side, sorted(c)))
        report.append(("P1:Hand.%s" % side, n, tuple(round(x, 3) for x in dims), round(e, 1)))
    # P2 镜像不对称种子 + 轴向延伸（非对称单兵器，如长矛/禅杖/弓）
    cand = [i for i in range(N) if asym[i] > ASYM_THR and abs(co[i].x) > ASYM_XMIN]
    seeds_all = [c for c in clusterize(cand, co, kd, ASYM_CL_R) if len(c) >= ASYM_MIN_N]
    report.append(("P2:不对称种子顶点", len(cand), "簇数=%d" % len(seeds_all), None))
    for k, seed in enumerate(seeds_all):
        # 先不加位置限制地长完（限制会在杆身中段制造空隙，把延伸截断），再事后剔除贴腿顶点
        grown = shaft_extend(seed, N, co, d_arm, EXT_RPERP, EXT_GAP)
        if d_leg:
            grown = set(i for i in grown if d_leg[i] > LEG_MIN)
            if not grown:
                continue
        n, dims, e, _lo, _hi, ctr = geo(grown, co)
        dl = min(min(d_hand["L"][i] for i in grown), min(d_hand["R"][i] for i in grown))
        side = "L" if min(d_hand["L"][i] for i in grown) < min(d_hand["R"][i] for i in grown) else "R"
        if d_leg:
            bk = [(0, .02), (.02, .035), (.035, .05), (.05, .08), (.08, 9)]
            row = " ".join(
                "<%.3f: 簇内%-5d 其中双脚区%-5d" % (b, sum(1 for i in grown if a <= d_leg[i] < b),
                                              sum(1 for i in grown if a <= d_leg[i] < b
                                                  and co[i].z < 0.08 and abs(co[i].x) < 0.11))
                for a, b in bk)
            print("      d_leg 分布 " + row)
        med_iso, frac_iso = isolation_stats(grown, co, kd, ISO_R)
        rms_med, occ_med, occ_frac, nsl = axis_profile(grown, co)
        m_df = dist_median(grown, d_full)
        m_dt = dist_median(grown, d_trunk) if d_trunk else -1
        m_da = dist_median(grown, d_arm) if d_arm else -1
        frac_leg = (sum(1 for i in grown if d_leg[i] < 0.06) / float(len(grown))) if d_leg else 0.0
        why = ""
        if n > W_N_MAX:
            why = "太大"
        elif dims[0] < W_LEN_MIN:
            why = "太短"
        elif e < W_ELONG_MIN:
            why = "不细长"
        elif dims[1] > W_WID_MAX:
            why = "太宽"
        elif dl > W_HAND_MAX:
            why = "离手太远"
        elif m_da < ARM_MED_MIN:
            why = "贴着手臂(%.3f)" % m_da
        elif frac_leg > FRAC_LEG_MAX:
            why = "裹进腿靴(%.0f%%)" % (100 * frac_leg)
        tag = "P2:Hand.%s ★" % side if not why else "P2:簇%d丢弃(%s)" % (k, why)
        report.append((tag, n, tuple(round(x, 3) for x in dims), round(e, 1)))
        print("    簇%d: 种子%-5d grown=%-5d dims=%-24s elong=%5.1f 近手%s(%.2f) 中位距: 骨架=%.3f 手臂链=%.3f 躯干腿=%.3f 贴腿占比=%.1f%% 扇区=%.2f %s" %
              (k, len(seed), n, tuple(round(x, 3) for x in dims), e, side, dl,
               m_df, m_da, m_dt, 100 * frac_leg, occ_med, ("★" if not why else "丢弃:" + why)))
        if not why:
            for i in grown:
                forced[i] = "Hand." + side
            forced_sets.append(("Hand." + side, sorted(grown)))
    return forced, report, forced_sets


for f in FILES:
    mesh = load(f)
    tag = os.path.basename(f).replace(".glb", "")
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
    d_trunk = [min(bone_d[n][i] for n in TRUNK) for i in range(N)]
    d_hand = {s: [min(bone_d[n][i] for n in HAND_SIDE[s]) for i in range(N)] for s in ("L", "R")}
    d_arm = [min(bone_d[n][i] for n in ARM_CHAIN) for i in range(N)]
    d_leg = [min(bone_d[n][i] for n in LEG_BONES) for i in range(N)]
    asym = [kdm.find(co[i])[2] for i in range(N)]

    forced, report, forced_sets = detect(N, co, kd, d_full, d_hand, asym, d_arm, d_trunk, d_leg)
    print("\n" + "=" * 78)
    print("FILE %s  N=%d  绑定为武器 %d 顶点 (%.2f%%)" % (tag, N, len(forced), 100.0 * len(forced) / N))
    print("=" * 78)
    for r in report:
        print("   %-24s n=%-6s dims=%-26s elong=%s" % (r[0], r[1], r[2], r[3]))
    from collections import Counter
    print("   归属:", dict(Counter(forced.values())))
    feet = sum(1 for i in forced if co[i].z < 0.08 and abs(co[i].x) < 0.11)
    head = sum(1 for i in forced if co[i].z > 0.95)
    fl = [i for i in forced if co[i].z < 0.08 and abs(co[i].x) < 0.11]
    if fl:
        print("   自检: 双脚区顶点 x范围=[%.3f,%.3f] y=[%.3f,%.3f] z=[%.3f,%.3f]  x<0的%d个 x>0的%d个" %
              (min(co[i].x for i in fl), max(co[i].x for i in fl),
               min(co[i].y for i in fl), max(co[i].y for i in fl),
               min(co[i].z for i in fl), max(co[i].z for i in fl),
               sum(1 for i in fl if co[i].x < 0), sum(1 for i in fl if co[i].x > 0)))
    print("   自检: 误入双脚区(z<0.08,|x|<0.11)=%d  误入头顶区(z>0.95)=%d" % (feet, head))
    print("   自检 z 分片（绑定顶点）：")
    for k in range(20):
        z0 = k * 0.05
        sl = [i for i in forced if z0 <= co[i].z < z0 + 0.05]
        if not sl:
            continue
        cx = sum(co[i].x for i in sl) / len(sl)
        cy = sum(co[i].y for i in sl) / len(sl)
        near_body = sum(1 for i in sl if abs(co[i].x) < 0.12)
        print("      z %.2f-%.2f n=%-5d x质心=%+.3f y质心=%+.3f |x|<0.12的%d个" %
              (z0, z0 + 0.05, len(sl), cx, cy, near_body))

    # 渲染：每个通过门限的簇单独配色（一眼看清每簇到底是什么东西）
    palette = [(1.0, 0.10, 0.05, 1.0), (0.10, 0.35, 1.0, 1.0), (0.10, 0.85, 0.25, 1.0),
               (1.0, 0.80, 0.05, 1.0), (0.85, 0.10, 0.85, 1.0), (0.05, 0.85, 0.85, 1.0)]
    sc = bpy.context.scene
    mesh.hide_render = True          # 原网格隐藏，避免与分组对象共面遮挡
    used = set()
    for _bone, vs in forced_sets:
        used |= set(vs)

    def new_obj(name, vs, col):
        data = mesh.data.copy()                 # 独立数据块，避免多对象共享网格后 bmesh 崩溃
        o = bpy.data.objects.new(name, data)
        sc.collection.objects.link(o)
        keep_faces(o, lambda fc: all(v.index in vs for v in fc.verts))
        o.color = col
        return o

    objs = []
    for gi, (bone, vs) in enumerate(forced_sets):
        o = new_obj("g%d_%s" % (gi, bone), set(vs), palette[gi % len(palette)])
        objs.append((o.name, len(o.data.polygons)))
    body = new_obj("body", set(range(N)) - used, (0.62, 0.62, 0.64, 1.0))
    objs.append(("body", len(body.data.polygons)))
    print("   渲染分组:", objs)

    cd = bpy.data.cameras.new("cam"); cam = bpy.data.objects.new("cam", cd)
    sc.collection.objects.link(cam); sc.camera = cam
    sc.render.engine = 'BLENDER_WORKBENCH'
    sc.display.shading.light = 'STUDIO'
    sc.display.shading.color_type = 'OBJECT'
    sc.render.resolution_x = 520; sc.render.resolution_y = 620

    def shot(t, loc, tgt=(0, 0, 0.55)):
        cam.location = loc
        cam.rotation_euler = (Vector(tgt) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
        sc.render.filepath = "%s/%s_%s.png" % (OUTDIR, tag, t)
        bpy.ops.render.render(write_still=True)

    shot("front", (0, -2.2, 0.60))
    shot("right", (-2.2, 0, 0.60))
    print("SHOT", OUTDIR, tag)
print("VIZ2_DONE")
