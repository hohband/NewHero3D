// 棋盘格子与寻路（对应 Godot 版 grid.gd / grid_cell.gd）
import { DIRS, keyOf, cellKey, manhattan } from "./coords.js";

export class GridCell {
  constructor(coords, terrain, height = 0) {
    this.coords = coords;
    this.terrain = terrain;
    this.height = height;
    this.occupant = null;
    this.obstacle_hp = 0; // >0 即有可破坏障碍
  }
  hasObstacle() { return this.obstacle_hp > 0; }
  isBlocked() { return !this.terrain.passable || this.hasObstacle(); }
}

export class Grid {
  // data: DataLoader；size: {x: w, y: h}
  // terrainMap/heightMap: { "x,y": terrain_id | height }（缺省 plain / 0）
  constructor(data, size, terrainMap = {}, heightMap = {}) {
    this.data = data;
    this.size = size;
    this.cells = new Map(); // "x,y" -> GridCell
    const plain = data.getTerrain("plain");
    for (let y = 0; y < size.y; y++) {
      for (let x = 0; x < size.x; x++) {
        const key = keyOf(x, y);
        const terrain = data.getTerrain(terrainMap[key]) || plain;
        const cell = new GridCell({ x, y }, terrain, heightMap[key] || 0);
        if (terrain.destructible && terrain.hp > 0) cell.obstacle_hp = terrain.hp;
        this.cells.set(key, cell);
      }
    }
  }

  isInside(coords) {
    return coords.x >= 0 && coords.y >= 0 && coords.x < this.size.x && coords.y < this.size.y;
  }

  getCell(coords) {
    return this.cells.get(cellKey(coords)) || null;
  }

  // 在界内、未 blocked、无敌队占位（友军可穿过）
  canPass(coords, mover) {
    if (!this.isInside(coords)) return false;
    const cell = this.getCell(coords);
    if (cell.isBlocked()) return false;
    if (cell.occupant && cell.occupant !== mover && cell.occupant.team !== mover.team) return false;
    return true;
  }

  // 可停留：canPass 且格上无人（或就是自己）
  canStop(coords, mover) {
    if (!this.canPass(coords, mover)) return false;
    const cell = this.getCell(coords);
    return !cell.occupant || cell.occupant === mover;
  }

  // 按地形消耗的 Dijkstra 洪水填充；返回 Map<key, cost>，不含起点、仅可停留格
  getReachable(mover, budget) {
    const start = mover.coords;
    const cost = new Map([[cellKey(start), 0]]);
    const result = new Map();
    // 朴素数组优先队列（图小，结果与原版一致）
    const frontier = [{ coords: start, cost: 0 }];
    while (frontier.length > 0) {
      let minIdx = 0;
      for (let i = 1; i < frontier.length; i++) {
        if (frontier[i].cost < frontier[minIdx].cost) minIdx = i;
      }
      const current = frontier.splice(minIdx, 1)[0];
      for (const d of DIRS) {
        const next = { x: current.coords.x + d.x, y: current.coords.y + d.y };
        if (!this.canPass(next, mover)) continue;
        const cell = this.getCell(next);
        const stepCost = current.cost + this.moveCostOf(cell, mover);
        if (stepCost > budget) continue;
        const key = cellKey(next);
        if (cost.has(key) && cost.get(key) <= stepCost) continue;
        cost.set(key, stepCost);
        frontier.push({ coords: next, cost: stepCost });
        if (this.canStop(next, mover)) result.set(key, stepCost);
      }
    }
    result.delete(cellKey(start));
    return result;
  }

  // 4 向 A*（禁斜），权重 = max(1, 进入消耗)，敌占格 solid；返回含起点的路径，不可达返回 []
  findPath(mover, to) {
    if (!this.isInside(to)) return [];
    const start = mover.coords;
    const startKey = cellKey(start);
    const goalKey = cellKey(to);
    const isSolid = (coords) => {
      const cell = this.getCell(coords);
      if (cell.isBlocked()) return true;
      if (cell.occupant && cell.occupant !== mover && cell.occupant.team !== mover.team) return true;
      return false;
    };
    if (goalKey !== startKey && isSolid(to)) return [];
    const open = [{ coords: start, f: 0, g: 0 }];
    const gScore = new Map([[startKey, 0]]);
    const cameFrom = new Map();
    const closed = new Set();
    while (open.length > 0) {
      let minIdx = 0;
      for (let i = 1; i < open.length; i++) if (open[i].f < open[minIdx].f) minIdx = i;
      const current = open.splice(minIdx, 1)[0];
      const curKey = cellKey(current.coords);
      if (curKey === goalKey) {
        const path = [current.coords];
        let k = curKey;
        while (cameFrom.has(k)) {
          const prev = cameFrom.get(k);
          path.unshift(prev.coords);
          k = prev.key;
        }
        return path;
      }
      if (closed.has(curKey)) continue;
      closed.add(curKey);
      for (const d of DIRS) {
        const next = { x: current.coords.x + d.x, y: current.coords.y + d.y };
        if (!this.isInside(next)) continue;
        const nextKey = cellKey(next);
        if (closed.has(nextKey)) continue;
        if (nextKey !== goalKey && isSolid(next)) continue;
        const cell = this.getCell(next);
        const w = Math.max(1, this.moveCostOf(cell, mover));
        const g = current.g + w;
        if (gScore.has(nextKey) && gScore.get(nextKey) <= g) continue;
        gScore.set(nextKey, g);
        cameFrom.set(nextKey, { coords: current.coords, key: curKey });
        open.push({ coords: next, g, f: g + manhattan(next, to) });
      }
    }
    return [];
  }

  moveCostOf(cell, mover) {
    if (cell.terrain.terrain_id === "water" && mover.data.traits.includes("water_walker")) return 1;
    return cell.terrain.move_cost;
  }

  placeUnit(unit, coords) {
    const cell = this.getCell(coords);
    cell.occupant = unit;
    unit.coords = { ...coords };
  }

  moveUnit(unit, to) {
    const from = this.getCell(unit.coords);
    if (from && from.occupant === unit) from.occupant = null;
    this.placeUnit(unit, to);
  }

  // 运行时改地形（触发器/拆拒马用），重算 obstacle_hp
  setTerrain(coords, terrainId) {
    const cell = this.getCell(coords);
    if (!cell) return;
    const terrain = this.data.getTerrain(terrainId);
    if (!terrain) return;
    cell.terrain = terrain;
    cell.obstacle_hp = terrain.destructible && terrain.hp > 0 ? terrain.hp : 0;
  }
}
