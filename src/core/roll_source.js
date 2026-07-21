// 随机源抽象（对应 Godot 版 RollSource / RandomRollSource，D12）
// 所有概率判定都是 roll() < p，p 为百分数 0-100。

// 可设种子 PRNG（mulberry32）
export class RandomRollSource {
  constructor(seed = (Date.now() % 2147483647)) {
    this.setSeed(seed);
  }
  setSeed(seed) {
    this._s = seed >>> 0;
    if (this._s === 0) this._s = 1;
  }
  _next() {
    this._s = (this._s + 0x6d2b79f5) >>> 0;
    let t = this._s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  // 返回 [0, 100)
  roll() {
    return this._next() * 100;
  }
}

// 测试用固定序列随机源：依次吐出队列值，耗尽后重复最后一个
export class FixedRollSource {
  constructor(values = [100]) {
    this.values = [...values];
    this.index = 0;
  }
  roll() {
    const v = this.values[Math.min(this.index, this.values.length - 1)];
    this.index++;
    return v;
  }
  reset() { this.index = 0; }
}
