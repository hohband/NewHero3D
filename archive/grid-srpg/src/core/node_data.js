// node 环境数据表加载（测试/工具用；浏览器端走 fetch，见 src/ui）
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { DataLoader } from "./data_loader.js";

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "data");

export const DATA_FILES = [
  "terrains.csv", "skills.csv", "units.csv", "enemies.csv",
  "ai_weights.csv", "progression.csv", "battle_constants.csv",
  "weapons.csv", "items.csv", "reserved_units.txt",
];

export function loadDataTables() {
  const texts = {};
  for (const f of DATA_FILES) texts[f] = readFileSync(join(DATA_DIR, f), "utf8");
  return new DataLoader(texts);
}
