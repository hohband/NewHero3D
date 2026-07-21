// 数据表加载与查询（对应 Godot 版 GameDataLoader / data_loader.gd）
// 纯逻辑模块：构造时注入 {文件名: 文本}，浏览器 fetch 与 node fs 均可喂入。
import { parseCsvTable, toInt, toFloat, parseStringList, parseBonds } from "./csv.js";

export const QUALITY_ORDER = ["green", "blue", "purple", "orange"];
export const UNIT_CLASSES = ["vanguard", "infantry", "cavalry", "archer", "strategist", "healer", "support"];

const DEFAULT_AI_WEIGHTS = {
  damage_expect: 1.0, kill_bonus: 1.0, target_value: 1.0,
  danger: 1.0, aura_coverage: 1.0, position: 1.0,
};

export class DataLoader {
  // texts: { "units.csv": "...", ... }（缺省 key 视为空表）
  constructor(texts) {
    this.warnings = [];
    this.units = new Map();       // 武将 + 敌方并入同一查询空间
    this.skills = new Map();
    this.terrains = new Map();
    this.weapons = new Map();
    this.items = new Map();
    this.aiWeights = new Map();
    this.progression = new Map(); // key -> float
    this.constants = new Map();   // battle_constants key -> float
    this.reserved = [];
    this.heroIds = new Set();     // 纯武将名单（units.csv 快照）
    this._loadAll(texts || {});
  }

  _table(texts, name) {
    const t = texts[name];
    if (t == null) { this.warnings.push(`缺少数据表 ${name}`); return []; }
    return parseCsvTable(t, this.warnings.map ? this.warnings : null);
  }

  _loadAll(texts) {
    // 顺序与 Godot 版一致：terrains → skills → units(快照hero_ids) → enemies 并入
    // → ai_weights → progression → battle_constants → weapons → items → reserved
    for (const row of this._table(texts, "terrains.csv")) {
      this.terrains.set(row.terrain_id, {
        terrain_id: row.terrain_id,
        name: row.name,
        move_cost: toInt(row.move_cost),
        dodge_mod: toInt(row.dodge_mod),
        def_mod: toInt(row.def_mod),
        atk_mod: toInt(row.atk_mod),
        range_mod: toInt(row.range_mod),
        passable: toInt(row.passable) !== 0,
        destructible: toInt(row.destructible) !== 0,
        hp: toInt(row.hp),
        special: row.special || "",
      });
    }
    for (const row of this._table(texts, "skills.csv")) {
      this.skills.set(row.skill_id, {
        skill_id: row.skill_id,
        name: row.name,
        owner: row.owner,
        type: row.type,             // active | passive | ult
        trigger: row.trigger,       // manual | on_attack | on_hit | turn_start
        range_shape: row.range_shape, // adjacent | line | ring | diamond | all | self
        range_min: toInt(row.range_min),
        range_max: toInt(row.range_max),
        target: row.target,         // enemy | ally | self
        cooldown: toInt(row.cooldown),
        rage_cost: toInt(row.rage_cost),
        effects: row.effects || "",
        desc: row.desc || "",
      });
    }
    const loadUnits = (name, isHero) => {
      for (const row of this._table(texts, name)) {
        if (!row.unit_id) continue;
        if (this.units.has(row.unit_id)) {
          this.warnings.push(`单位 id 冲突: ${row.unit_id}`);
          continue;
        }
        this.units.set(row.unit_id, {
          unit_id: row.unit_id,
          name: row.name,
          nickname: row.nickname || "",
          star: row.star || "",
          quality: row.quality,
          unit_class: row.class,
          hp: toInt(row.hp), atk: toInt(row.atk), def: toInt(row.def),
          mgc: toInt(row.mgc), spd: toInt(row.spd),
          crit: toInt(row.crit), dodge: toInt(row.dodge), block: toInt(row.block),
          move: toInt(row.move),
          range_min: toInt(row.range_min), range_max: toInt(row.range_max),
          weapon: row.weapon || "",
          skill_signature: row.skill_signature || "",
          bonds: parseBonds(row.bonds),
          unlock: row.unlock || "",
          traits: parseStringList(row.traits),
        });
        if (isHero) this.heroIds.add(row.unit_id);
      }
    };
    loadUnits("units.csv", true);
    loadUnits("enemies.csv", false);
    for (const row of this._table(texts, "ai_weights.csv")) {
      this.aiWeights.set(row.class, {
        damage_expect: toFloat(row.damage_expect),
        kill_bonus: toFloat(row.kill_bonus),
        target_value: toFloat(row.target_value),
        danger: toFloat(row.danger),
        aura_coverage: toFloat(row.aura_coverage),
        position: toFloat(row.position),
      });
    }
    const loadKV = (name, map) => {
      for (const row of this._table(texts, name)) {
        if (row.key) map.set(row.key, toFloat(row.value));
      }
    };
    loadKV("progression.csv", this.progression);
    loadKV("battle_constants.csv", this.constants);
    for (const row of this._table(texts, "weapons.csv")) {
      this.weapons.set(row.weapon, row.range_shape);
    }
    for (const row of this._table(texts, "items.csv")) {
      this.items.set(row.item_id, {
        item_id: row.item_id,
        name: row.name,
        range_shape: row.range_shape,
        range_min: toInt(row.range_min),
        range_max: toInt(row.range_max),
        target: row.target,
        uses_per_battle: Math.max(1, toInt(row.uses_per_battle)),
        effects: row.effects || "",
        desc: row.desc || "",
      });
    }
    const reserved = texts["reserved_units.txt"];
    if (reserved) {
      for (const line of reserved.split(/\r?\n/)) {
        const s = line.trim();
        if (s === "" || s.startsWith("#")) continue;
        this.reserved.push(s);
      }
    }
  }

  getUnit(id) { return this.units.get(id) || null; }
  getSkill(id) { return this.skills.get(id) || null; }
  getTerrain(id) { return this.terrains.get(id) || null; }
  getItem(id) { return this.items.get(id) || null; }

  // 线性扫描：第一个 owner == unitId 且 type 匹配的技能
  getSkillForUnit(unitId, type) {
    for (const s of this.skills.values()) {
      if (s.owner === unitId && s.type === type) return s;
    }
    return null;
  }

  getPassivesForUnit(unitId, trigger) {
    const out = [];
    for (const s of this.skills.values()) {
      if (s.type === "passive" && s.trigger === trigger && s.owner === unitId) out.push(s);
    }
    return out;
  }

  getAiWeights(classId) {
    const w = this.aiWeights.get(classId);
    if (!w) {
      this.warnings.push(`职业 ${classId} 缺少 AI 权重行，退回全 1.0`);
      return { ...DEFAULT_AI_WEIGHTS };
    }
    return w;
  }

  getConstant(key, def = 0.0) {
    const v = this.constants.get(key);
    if (v === undefined) {
      this.warnings.push(`缺少战斗常数 ${key}，退回 ${def}`);
      return def;
    }
    return v;
  }

  getProgression(key, def = 0.0) {
    const v = this.progression.get(key);
    return v === undefined ? def : v;
  }

  getWeaponShape(weaponName) {
    const s = this.weapons.get(weaponName);
    if (!s) {
      this.warnings.push(`武器 ${weaponName} 未登记，退回 diamond`);
      return "diamond";
    }
    return s;
  }

  defaultItemStock() {
    const stock = {};
    for (const [id, item] of this.items) stock[id] = item.uses_per_battle;
    return stock;
  }
}

// 道具投影成主动技能（对应 ItemData.to_skill_data）
export function itemToSkillData(item) {
  return {
    skill_id: item.item_id,
    name: item.name,
    owner: "",
    type: "active",
    trigger: "manual",
    range_shape: item.range_shape,
    range_min: item.range_min,
    range_max: item.range_max,
    target: item.target,
    cooldown: 0,
    rage_cost: 0,
    effects: item.effects,
    desc: item.desc,
  };
}
