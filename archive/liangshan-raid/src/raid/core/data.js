// 劫寨 Demo 数据定义（L1 祝家庄）—— 唯一数据源，数值来自 combat-mode-design v2 / GDD
// 纯数据，无逻辑依赖；坐标用 {x,y}，格子键用 "x,y"。

// ============ 武将（8 名，GDD-02 §3.1）============
// cost=兵符, lc=粮草消耗, cd=冷却(秒), hp/dps/range(格)/spd(格每秒), breach=破墙系数, tag=标签
export const HEROES = {
  luzhishen: { id: "luzhishen", name: "鲁智深", role: "tank", cost: 6, lc: 10, cd: 18, hp: 460, dps: 16, range: 1, spd: 1.2, breach: 1, tag: ["肉盾"], skillName: "罗汉金身" },
  linchong:  { id: "linchong",  name: "林冲",   role: "dive", cost: 6, lc: 15, cd: 14, hp: 320, dps: 34, range: 1, spd: 1.6, breach: 1, tag: ["突进"], skillName: "风雪山神庙" },
  wuyong:    { id: "wuyong",    name: "吴用",   role: "buffer", cost: 6, lc: 30, cd: 22, hp: 260, dps: 14, range: 4, spd: 1.3, breach: 1, tag: ["增益","召唤"], skillName: "七星聚义" },
  gongsunsheng:{ id: "gongsunsheng", name: "公孙胜", role: "aoe", cost: 10, lc: 25, cd: 16, hp: 240, dps: 26, range: 4, spd: 1.3, breach: 1, tag: ["AOE"], skillName: "五雷天罡" },
  yanqing:   { id: "yanqing",   name: "燕青",   role: "kiter", cost: 3, lc: 10, cd: 10, hp: 270, dps: 24, range: 4, spd: 1.9, breach: 1, tag: ["远程"], skillName: "鹞子翻身" },
  likui:     { id: "likui",     name: "李逵",   role: "berserker", cost: 6, lc: 15, cd: 15, hp: 400, dps: 32, range: 1, spd: 1.4, breach: 2, tag: ["狂暴","AOE"], skillName: "板斧旋风" },
  huarong:   { id: "huarong",   name: "花荣",   role: "sniper", cost: 3, lc: 15, cd: 12, hp: 230, dps: 44, range: 7, spd: 1.1, breach: 1, tag: ["远程"], skillName: "百步穿杨" },
  shiqian:   { id: "shiqian",   name: "时迁",   role: "stealth", cost: 3, lc: 20, cd: 20, hp: 240, dps: 22, range: 1, spd: 1.9, breach: 1, tag: ["潜行"], skillName: "神偷" },
};

// ============ 防御建筑（GDD-03 §③）============
export const BUILDINGS = {
  outer_wall: { id: "outer_wall", name: "外墙", hp: 70, dps: 0, range: 0, kind: "wall", star2: true },
  inner_wall: { id: "inner_wall", name: "内墙", hp: 130, dps: 0, range: 0, kind: "wall", star2: true },
  arrow_tower: { id: "arrow_tower", name: "箭塔", hp: 70, dps: 9, range: 5, kind: "tower", star2: true },
  watchtower: { id: "watchtower", name: "瞭望塔", hp: 60, dps: 6, range: 7, kind: "tower", star2: true, slow: 0.3 },
  granary: { id: "granary", name: "粮仓", hp: 90, dps: 0, range: 0, kind: "resource", star2: true, loot: 60 },
  core: { id: "core", name: "忠义堂", hp: 380, dps: 0, range: 0, kind: "core", star2: true },
  trap_pit: { id: "trap_pit", name: "陷坑", hp: 1, dps: 40, range: 0, kind: "trap", star2: false },
};

// ============ 敌方单位 ============
// v2.1 平衡标定（tools/raid_sim.js，B3/§8.3）：分布式压力梯度。
// 原值过弱（4 将抱团 100% 胜率 18s 速通）。标定目标 L1：胜率 65–80%、用时 60–100s。
// 实测落带：庄丁360/15.75、枪兵560/20.25、哨兵80、BOSS祝龙1610/32.5 → 76% 胜 / 72s（50 场，换种子复核）。
export const ENEMIES = {
  zhuangding: { id: "zhuangding", name: "庄丁", hp: 360, dps: 15.75, range: 1, spd: 1.4, tag: ["守军"] },
  spearman:   { id: "spearman",   name: "枪兵", hp: 560, dps: 20.25, range: 1, spd: 1.0, tag: ["反突进"] },
  sentry:     { id: "sentry",     name: "哨兵", hp: 80, dps: 0, range: 0, spd: 0, tag: ["哨兵"], vision: 5 },
  boss_zhulong: { id: "boss_zhulong", name: "祝龙", hp: 1610, dps: 32.5, range: 1, spd: 1.3, tag: ["boss","守将"] },
  // —— L2 曾头市专属兵种（不污染 L1 已标定共享数值）—— 史文恭的精锐铁骑
  // 铁骑定位为"肉度+低攻"的分布式压力（对齐 L1 庄丁 360hp/15.75 攻的落带经验：
  // 高血低攻才能扛住提供持续压力，高攻会把难度推成二元团灭）。
  tieqi: { id: "tieqi", name: "铁骑", hp: 420, dps: 16, range: 1, spd: 1.9, tag: ["骑兵","反突进"] },
  boss_shiwengong: { id: "boss_shiwengong", name: "史文恭", hp: 2000, dps: 40, range: 1, spd: 1.6, tag: ["boss","骑将"] },
};

// ============ 关卡 L1 布局 ============
// 地图 24 x 16。y=0 底（玩家部署带），y 增大向上（敌方核心在顶部）。
export const LEVEL_L1 = {
  id: "L1",
  name: "祝家庄",
  w: 24, h: 16,
  bingfu: 30, liangcao: 150,
  scoutTime: 8, timeout: 240,
  deployInterval: 1.5, redeployCd: 20, liveCap: 12, summonCap: 4,
  spawnPoints: [{ x: 11, y: 1 }],           // 梁山泊大营（底部安全区）
  // 建筑摆放 {type, x, y}
  buildings: [
    // 外墙圈（y=6 一线，留门 x=11）
    ...wallRow("outer_wall", 4, 18, 6, [11, 12]),
    // 内墙圈（y=10 一线，留门 x=11）
    ...wallRow("inner_wall", 7, 16, 10, [11, 12]),
    { type: "arrow_tower", x: 7, y: 7 },
    { type: "arrow_tower", x: 16, y: 7 },
    { type: "watchtower", x: 11, y: 12 },
    { type: "granary", x: 5, y: 8 },
    { type: "granary", x: 18, y: 8 },
    { type: "trap_pit", x: 11, y: 8 },
    { type: "trap_pit", x: 12, y: 8 },
    { type: "core", x: 11, y: 13 },
  ],
  // 初始守军 {type, x, y}
  defenders: [
    { type: "sentry", x: 11, y: 6 },        // 外门口哨兵
    { type: "zhuangding", x: 8, y: 11 },
    { type: "zhuangding", x: 14, y: 11 },
    { type: "spearman", x: 11, y: 11 },
    { type: "boss_zhulong", x: 11, y: 12 }, // Boss 守核心前
  ],
  // 巡逻队（v2 动态防御）：沿路线循环
  patrols: [
    { id: "p1", type: "zhuangding", route: [{ x: 5, y: 9 }, { x: 17, y: 9 }], size: 2 },
  ],
};

// ============ 关卡 L2 布局 ============
// 曾头市（进阶关）。同一 24x16 地图，但守军更密、箭塔更多、新增精锐铁骑，
// BOSS 史文恭（杀晁盖者）比祝龙更强。难度须高于 L1，且全程用 L2 专属单位，
// 不复用/不改 L1 已标定的共享守军数值（庄丁/枪兵/哨兵）。
export const LEVEL_L2 = {
  id: "L2",
  name: "曾头市",
  w: 24, h: 16,
  bingfu: 34, liangcao: 170,
  scoutTime: 8, timeout: 240,
  deployInterval: 1.5, redeployCd: 20, liveCap: 12, summonCap: 4,
  spawnPoints: [{ x: 11, y: 1 }],           // 梁山泊大营（底部安全区）
  buildings: [
    // 外墙圈（y=6 一线，留门 x=11,12）
    ...wallRow("outer_wall", 4, 18, 6, [11, 12]),
    // 内墙圈（y=10 一线，留门 x=11,12）
    ...wallRow("inner_wall", 7, 16, 10, [11, 12]),
    // 外翼箭塔（与 L1 同款安全塔位，避免门口绞肉机式二元团灭）
    { type: "arrow_tower", x: 6, y: 7 },
    { type: "arrow_tower", x: 17, y: 7 },
    { type: "watchtower", x: 11, y: 12 },
    { type: "granary", x: 5, y: 8 },
    { type: "granary", x: 18, y: 8 },
    { type: "trap_pit", x: 11, y: 8 },
    { type: "trap_pit", x: 12, y: 8 },
    { type: "core", x: 11, y: 13 },
  ],
  defenders: [
    { type: "sentry", x: 11, y: 6 },        // 外门口哨兵
    { type: "zhuangding", x: 8, y: 11 },
    { type: "zhuangding", x: 14, y: 11 },
    { type: "spearman", x: 11, y: 11 },
    { type: "boss_shiwengong", x: 11, y: 12 }, // BOSS 守核心前（小兵墙对齐 L1，难度来自更强 BOSS + 铁骑游骑）
  ],
  patrols: [
    { id: "p1", type: "tieqi", route: [{ x: 4, y: 9 }, { x: 18, y: 9 }], size: 2 }, // 铁骑游骑
  ],
};

// ============ 关卡注册表 ============
export const LEVELS = { L1: LEVEL_L1, L2: LEVEL_L2 };
export const LEVEL_IDS = Object.keys(LEVELS);
export function getLevel(id) { return LEVELS[id] || LEVEL_L1; }
export const LEVEL = LEVEL_L1; // 兼容旧代码（render/ui/main_raid 仍按 L1 渲染）

function wallRow(type, x0, x1, y, gaps = []) {
  const out = [];
  for (let x = x0; x <= x1; x++) {
    if (gaps.includes(x)) continue;
    out.push({ type, x, y });
  }
  return out;
}

// ============ 评分 / 经济（GDD-04）============
export const SCORING = {
  star2Pct: 0.5,
  star3TroopPct: 0.3,
  star3TimeS: 120,
  timeoutS: 240,
};
export const LOOT = { starCoeff: [1.0, 1.3, 1.6], base: 100 };
export const RELIEF = { min: 0.20, max: 0.30, unlockScale: 0.85 };

// ============ 战争迷雾（v2 §4.7）============
export const FOG = {
  enabled: true,
  visionMelee: 4,   // 近战视野
  visionRanged: 5,  // 远程视野
  visionShiqian: 6, // 时迁侦察视野
  scoutFullMap: true, // 侦查期全图可见
  spawnVision: 3,   // 大营部署区常驻可见半径（开局无单位也能看到部署圈）
};

// ============ 天气环境（v2 §4.8）============
// 开局随机；影响全局规则，覆盖所有单位。
export const WEATHERS = {
  clear: { id: "clear", name: "晴", moveMult: 1.0, visionMod: 0, rangeMod: 0, fireValid: true, thunderMult: 1.0, stealthBonus: 0, footprints: false },
  rain:  { id: "rain",  name: "雨", moveMult: 0.9, visionMod: -1, rangeMod: 0, fireValid: false, thunderMult: 1.5, stealthBonus: 0, footprints: false },
  fog:   { id: "fog",   name: "雾", moveMult: 1.0, visionMod: -3, rangeMod: -2, fireValid: true, thunderMult: 1.0, stealthBonus: 0.10, footprints: false },
  snow:  { id: "snow",  name: "雪", moveMult: 0.8, visionMod: 0, rangeMod: 0, fireValid: true, thunderMult: 1.0, stealthBonus: 0, footprints: true },
};
export const WEATHER_IDS = Object.keys(WEATHERS);

// ============ 主动欺骗（v2 §4.6 诱饵）============
export const DECOY = { hp: 60, attractRange: 5, duration: 8, liangcaoCost: 15 };

// ============ 梁山号令（v2 §8.1 战前三选一）============
export const ORDERS_META = {
  liangcao_first: { id: "liangcao_first", name: "粮草先行", desc: "本局粮草 +50", apply: (bm) => { bm.liangcao += 50; } },
  fire_attack:    { id: "fire_attack",    name: "火攻计",   desc: "火系效果 +50%（公孙胜雷法/火油）", apply: (bm) => { bm.fireMult = 1.5; } },
  night_cloak:    { id: "night_cloak",    name: "夜行衣",   desc: "部署后 4s 潜行（不被索敌）", apply: (bm) => { bm.deployStealth = 4; } },
};

// ============ 技能效果参数（GDD-02）============
export const SKILL_FX = {
  tauntDur: 4, tauntReduce: 0.25,        // 鲁智深嘲讽/减伤
  diveArmorShred: 0.40, diveRange: 4,    // 林冲突进
  summonCount: 2, summonDur: 12, summonHp: 60, // 吴用援军
  aoeRadius: 2, aoeDmg: 60,              // 公孙胜雷法
  dodgeDur: 2,                           // 燕青位移
  whirlBreach: 2, whirlRadius: 1, whirlDmg: 40, // 李逵旋风
  snipeMult: 2.5,                        // 花荣狙杀
  stealthDur: 5,                         // 时迁潜行
  rageMax: 100, rageOnHit: 8, rageOnKill: 30,  // 怒气
  alertSentryDelay: 2,                   // 哨兵点火延迟
  commanderCd: 15,                       // 指挥官决策周期
};
