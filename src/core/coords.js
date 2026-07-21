// 坐标工具：坐标用 {x, y} 普通对象，格子键用 "x,y" 字符串
export const DIRS = [
  { x: 1, y: 0 },   // 右（顺序影响 summon 落位与 guard 扫描优先级，勿改）
  { x: -1, y: 0 },  // 左
  { x: 0, y: 1 },   // 下
  { x: 0, y: -1 },  // 上
];

export const keyOf = (x, y) => `${x},${y}`;
export const cellKey = (c) => `${c.x},${c.y}`;

export function parseKey(key) {
  const i = key.indexOf(",");
  return { x: parseInt(key.slice(0, i), 10), y: parseInt(key.slice(i + 1), 10) };
}

export const manhattan = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
export const chebyshev = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

// 主导方向：|dx| >= |dy| 取 x 向（等距优先 x），否则 y 向；零向量返回 (0,1)
export function dominantDir(diff) {
  if (Math.abs(diff.x) >= Math.abs(diff.y)) {
    return { x: Math.sign(diff.x), y: 0 };
  }
  return { x: 0, y: Math.sign(diff.y) };
}
