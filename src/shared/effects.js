// 效果串解析（战斗通用，与具体战斗模型无关）
// 从旧战棋 core/effect_system.js 提取的纯函数子集，供刀塔传奇版战斗复用；
// 保证效果串语法与正赛一致："phys_dmg(0.9)x4;rage(+20)" → [{name, args[], times}]
// 数值惯例：CSV 中 0.3 = 30%

// 修正类效果：不进序列执行，前置扫描进 mods（refresh_on_kill / extra_action 由调用方后处理，不进 mods）
export const MODIFIER_EFFECTS = new Set([
  "sure_hit", "hit_rate", "chance", "bonus_by_self_lost_hp", "bonus_vs_elite",
  "bonus_vs_high_def", "bonus_vs_cavalry", "execute_below", "target_rule",
  "random_target", "friendly_fire", "refresh_on_kill", "extra_action",
]);

export const KNOWN_EFFECTS = new Set([
  ...MODIFIER_EFFECTS,
  "phys_dmg", "mgc_dmg", "heal", "rage",
  "pull", "push", "pull_to_front", "swap_position", "teleport",
  "stun", "sleep", "sleep_chance", "paralyze", "bind", "guard", "counter",
  "buff", "def_up", "dodge_up", "block_up", "armor_break", "debuff_mgc", "move_mod",
  "random_buff", "steal_buff", "dispel",
  "poison", "burn", "bleed",
  "summon", "aura", "av_mod",
]);

export function parseEffects(str) {
  const out = [];
  if (!str) return out;
  for (const part of String(str).split(";")) {
    const s = part.trim();
    if (s === "") continue;
    const m = s.match(/^([a-zA-Z_][a-zA-Z0-9_]*)(?:\((.*)\))?(?:\s*x(\d+))?$/);
    if (!m) throw new Error(`效果解析失败: "${s}"（完整串: "${str}"）`);
    const name = m[1];
    const args = m[2] !== undefined ? m[2].split(",").map((a) => a.trim()) : [];
    const times = m[3] ? parseInt(m[3], 10) : 1;
    out.push({ name, args, times });
  }
  return out;
}

export function scanModifiers(parsed) {
  const mods = {};
  for (const e of parsed) {
    switch (e.name) {
      case "sure_hit": mods.sure_hit = true; break;
      case "hit_rate": mods.hit_rate = parseFloat(e.args[0]); break;
      case "chance": mods.chance = parseFloat(e.args[0]); break;
      case "bonus_by_self_lost_hp": mods.bonus_by_self_lost_hp = parseFloat(e.args[0]); break;
      case "bonus_vs_elite": mods.bonus_vs_elite = parseFloat(e.args[0]); break;
      case "bonus_vs_high_def": mods.bonus_vs_high_def = parseFloat(e.args[0]); break;
      case "bonus_vs_cavalry": mods.bonus_vs_cavalry = parseFloat(e.args[0]); break;
      case "execute_below": mods.execute_below = parseFloat(e.args[0]); break;
      case "target_rule": mods.target_rule = e.args[0]; break;
      case "random_target": mods.random_target = parseInt(e.args[0], 10); break;
      case "friendly_fire": mods.friendly_fire = parseFloat(e.args[0]); break;
      default: break; // refresh_on_kill / extra_action 不进 mods
    }
  }
  return mods;
}
