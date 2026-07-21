// 劫寨 Demo 实时网格 + 流场寻路（Flow Field）
// 与 SRPG 回合制 grid 解耦：实时连续移动用流场，墙破时分块重算（R2/H1）。
import { keyOf, DIRS } from "../../core/coords.js";

export class RaidGrid {
  constructor(w, h) {
    this.w = w; this.h = h;
    this.cells = new Map(); // "x,y" -> {x,y, wall:{id,hp,kind}|null, trap, occupant, building}
  }
  key(x, y) { return keyOf(x, y); }
  inside(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
  cell(x, y) { return this.cells.get(this.key(x, y)) || null; }
  ensure(x, y) {
    const k = this.key(x, y);
    if (!this.cells.has(k)) this.cells.set(k, { x, y, wall: null, trap: null, occupant: null, building: null });
    return this.cells.get(k);
  }
  // 是否可通行（近战）：墙阻挡，建筑核心可攻击（不可穿过），单位占位阻挡
  passable(x, y, mover = null) {
    if (!this.inside(x, y)) return false;
    const c = this.cell(x, y);
    if (!c) return true;
    if (c.wall) return false;
    if (c.building) return false;
    if (c.occupant && c.occupant !== mover) return false;
    return true;
  }
  // 流场：从目标集合反向 Dijkstra，返回每格到最近目标的 cost 与下一步方向
  // targets: [{x,y}]，blocked(x,y) 谓词
  computeFlow(targets, blocked) {
    const dist = new Map();
    const q = [];
    for (const t of targets) {
      dist.set(this.key(t.x, t.y), 0);
      q.push(t);
    }
    while (q.length) {
      const cur = q.shift();
      const cd = dist.get(this.key(cur.x, cur.y));
      for (const d of DIRS) {
        const nx = cur.x + d.x, ny = cur.y + d.y;
        if (!this.inside(nx, ny)) continue;
        if (blocked(nx, ny)) continue;
        const k = this.key(nx, ny);
        if (dist.has(k)) continue;
        dist.set(k, cd + 1);
        q.push({ x: nx, y: ny });
      }
    }
    return dist;
  }
  // 取某格朝目标的下一步（选 dist 最小的邻居）
  nextStep(dist, x, y) {
    let best = null, bestD = Infinity;
    for (const d of DIRS) {
      const nx = x + d.x, ny = y + d.y;
      const k = this.key(nx, ny);
      if (dist.has(k) && dist.get(k) < bestD) { bestD = dist.get(k); best = { x: nx, y: ny }; }
    }
    return best;
  }
}
