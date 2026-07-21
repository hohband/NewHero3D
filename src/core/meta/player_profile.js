// 玩家档案（对应 Godot 版 player_profile.gd，D30）
import { makeHero, heroToDict, heroFromDict } from "./hero.js";

export const SAVE_VERSION = 1;

export class PlayerProfile {
  constructor() {
    this.heroes = {};        // unit_id -> Hero
    this.gold = 0;
    this.items = {};         // shard / skill_book / breakthrough_mat / arena_point ...
    this.progress = {};      // chapter, cleared[], village, arena, expedition_best, ending
    this.achievements = {};  // id -> true
    this.settings = {};
  }

  // 新档（D30）：初始武将 = CSV unlock=="初始武将"；金 2000、碎片 20、技能书 5、突破材料 3
  static newDefault(data) {
    const p = new PlayerProfile();
    for (const [id, u] of data.units) {
      if (u.unlock === "初始武将" && data.heroIds.has(id)) {
        p.heroes[id] = makeHero(id, u.quality);
      }
    }
    p.gold = 2000;
    p.items = { shard: 20, skill_book: 5, breakthrough_mat: 3 };
    p.progress = { chapter: 1, cleared: [] };
    p.achievements = {};
    p.settings = defaultSettings();
    return p;
  }

  static defaultSettings() {
    return defaultSettings();
  }

  hasHero(unitId) { return !!this.heroes[unitId]; }

  addHero(unitId, quality) {
    if (this.heroes[unitId]) return false;
    this.heroes[unitId] = makeHero(unitId, quality);
    return true;
  }

  spendGold(amount) {
    if (this.gold < amount) return false;
    this.gold -= amount;
    return true;
  }

  itemCount(itemId) { return this.items[itemId] || 0; }

  spendItem(itemId, count) {
    if (this.itemCount(itemId) < count) return false;
    this.items[itemId] -= count;
    return true;
  }

  gainItem(itemId, count) {
    this.items[itemId] = this.itemCount(itemId) + count;
  }

  getSettings() {
    return { ...defaultSettings(), ...this.settings };
  }

  toDict() {
    const heroes = {};
    for (const [id, h] of Object.entries(this.heroes)) heroes[id] = heroToDict(h);
    return {
      version: SAVE_VERSION,
      heroes,
      gold: this.gold,
      items: { ...this.items },
      progress: JSON.parse(JSON.stringify(this.progress)),
      achievements: { ...this.achievements },
      settings: { ...this.getSettings() },
    };
  }

  static fromDict(d) {
    const p = new PlayerProfile();
    for (const [id, h] of Object.entries(d.heroes || {})) p.heroes[id] = heroFromDict(h);
    p.gold = d.gold || 0;
    p.items = { ...(d.items || {}) };
    p.progress = d.progress || { chapter: 1, cleared: [] };
    if (!Array.isArray(p.progress.cleared)) p.progress.cleared = [];
    p.achievements = { ...(d.achievements || {}) };
    p.settings = { ...defaultSettings(), ...(d.settings || {}) };
    return p;
  }
}

function defaultSettings() {
  return { volume_master: 1.0, volume_sfx: 1.0, volume_music: 1.0, mute: false };
}
