// CTB 行动顺序（对应 Godot 版 turn_order.gd）
// AV = 1000 ÷ 速度；全体 AV 同步递减，归零者进入 ready 队列；行动后由调用方 resetAv()。
import { Team } from "./unit.js";

export class TurnOrder {
  constructor() {
    this._ready = [];
  }

  nextActor(units) {
    let guard = 0;
    while (guard++ < 10000) {
      if (this._ready.length === 0) this._tick(units);
      const unit = this._ready.shift();
      if (!unit) return null;
      if (!unit.alive) continue;
      return unit;
    }
    return null;
  }

  _tick(units) {
    const active = units.filter((u) => u.alive && !u.is_object);
    if (active.length === 0) return;
    let minAv = Infinity;
    for (const u of active) minAv = Math.min(minAv, u.av);
    const zeroed = [];
    for (const u of active) {
      u.av -= minAv;
      if (u.av <= 0.0001) zeroed.push(u);
    }
    zeroed.sort((a, b) => this._tieLess(a, b) ? -1 : 1);
    this._ready.push(...zeroed);
  }

  // 平局：spd 高者优先（基础 spd）→ team 枚举小者优先 → unit_id 字典序
  _tieLess(a, b) {
    if (a.data.spd !== b.data.spd) return a.data.spd > b.data.spd;
    if (a.team !== b.team) return a.team < b.team;
    return a.unitId < b.unitId;
  }

  // 非破坏性预演（复制 av 模拟）；行动后重置用 1000 / max(1, data.spd)（基础速度，
  // 与 resetAv 用含 buff 速度不一致——保留此差异以求行为一致，D17）
  preview(units, count) {
    const sim = units
      .filter((u) => u.alive && !u.is_object)
      .map((u) => ({ u, av: u.av }));
    const out = [];
    let guard = 0;
    while (out.length < count && sim.length > 0 && guard++ < 10000) {
      let minAv = Infinity;
      for (const s of sim) minAv = Math.min(minAv, s.av);
      const zeroed = [];
      for (const s of sim) {
        s.av -= minAv;
        if (s.av <= 0.0001) zeroed.push(s);
      }
      zeroed.sort((a, b) => this._tieLess(a.u, b.u) ? -1 : 1);
      for (const s of zeroed) {
        out.push(s.u);
        s.av = 1000 / Math.max(1, s.u.data.spd);
      }
    }
    return out;
  }

  remove(unit) {
    this._ready = this._ready.filter((u) => u !== unit);
  }
}
