// 关卡注册表：全部 26 关 LevelConfig 的纯数据构建（移植自 Godot 版 level_registry.gd，唯一数据源 docs/spec-data.md 第 6 节）

// 结局后日谈（终章双路线）
export const EPILOGUES = {
  zhaoan: [
    "奉诏安民，北征辽寇。梁山一百单八将，自此星散四方。",
    "若干年后，茶馆里的说书人拍案一声：「各位看官，且听下回分解！」",
    "—— 结局 · 招安 ——",
  ],
  kangzhao: [
    "圣旨掷地，再举义旗。官军百万，又奈这水泊如何？",
    "梁山泊里替天行道的大旗，依旧在秋风里猎猎作响。",
    "—— 结局 · 不招安 ——",
  ],
};

// 全部关卡 id（章节顺序：主线 → 挑战关穿插其后 → 调试关 → 日常副本）
const LEVEL_IDS = [
  "ch01_01", "ch01_02", "ch01_03", "ch01_04", "ch01_05",
  "ch02_01", "ch02_02", "ch03_01", "ch04_01", "ch04_02",
  "challenge_dongchang", "challenge_majun",
  "ch05_01", "ch05_02", "ch06_01", "ch06_02", "ch06_03",
  "ch07_01a", "ch07_01b", "debug_01",
  "daily_exp_1", "daily_exp_2", "daily_gold_1", "daily_gold_2", "daily_mat_1", "daily_mat_2",
];

export function listIds() {
  return [...LEVEL_IDS];
}

export function getLevel(id) {
  const builder = BUILDERS[id];
  if (!builder) {
    console.error(`LevelRegistry: 未知关卡 '${id}'`);
    return null;
  }
  // 每次调用重新构建，天然是深拷贝，调用方可自由修改
  return builder();
}

// ---------------------------------------------------------------- 基础工具

// LevelConfig 缺省值（spec-data.md 第 5 节）
function baseLevel() {
  return {
    id: "",
    name: "",
    mode: "story",
    ending: "",
    chapter: 1,
    recommended_level: 1,
    exp_override: 0,
    pvp_template: "",
    grid_size: [8, 8],
    terrain_map: {},
    height_map: {},
    win_condition: { type: "WIPE_OUT" },
    lose_conditions: [],
    required_units: [],
    roster: [],
    deploy_zone: [0, 0, 0, 0],
    max_deploy: 0,
    fog: false,
    allowed_classes: [],
    npc_allies: [],
    enemies: [],
    objects: [],
    triggers: [],
    rewards: {},
    rank_rules: {},
    unlock_grant: {},
    achievements: [],
  };
}

// 若干格子设为同一地形
function setCells(map, cells, terrain) {
  for (const [x, y] of cells) map[`${x},${y}`] = terrain;
}

// 整列（或若干列）在 y ∈ [y0, y1] 区间设为同一地形
function fillCols(map, xs, y0, y1, terrain) {
  for (const x of xs) for (let y = y0; y <= y1; y++) map[`${x},${y}`] = terrain;
}

// 整行 y 在 x ∈ [x0, x1] 区间设为同一地形
function fillRow(map, y, x0, x1, terrain) {
  for (let x = x0; x <= x1; x++) map[`${x},${y}`] = terrain;
}

// 若干格子设为同一高度
function setHeights(map, cells, h) {
  for (const [x, y] of cells) map[`${x},${y}`] = h;
}

// ---------------------------------------------------------------- 公共底

// 第一章教学关公共底
function teachingBase(id, name, recLevel) {
  const l = baseLevel();
  l.id = id;
  l.name = name;
  l.chapter = 1;
  l.recommended_level = recLevel;
  l.grid_size = [8, 8];
  l.win_condition = { type: "WIPE_OUT" };
  l.lose_conditions = [{ type: "WIPED_OUT" }];
  l.required_units = ["shi_yong"];
  l.roster = ["song_wan", "du_qian"];
  l.deploy_zone = [0, 6, 8, 2];
  l.max_deploy = 4;
  l.rewards = { first_clear: { gold: 400, breakthrough_mat: 1 }, regular: { gold: 120 } };
  return l;
}

// 日常副本公共底（无章节门槛的刷资源关，D34）；fog 为迷雾机制开关
function dailyBase(id, name, recLevel, expOverride, rewards, enemies, fog = false) {
  const l = baseLevel();
  l.id = id;
  l.name = name;
  l.mode = "daily";
  l.recommended_level = recLevel;
  l.grid_size = [8, 8];
  l.terrain_map = { "2,2": "forest", "5,3": "hill" };
  l.height_map = { "5,3": 1 };
  l.win_condition = { type: "WIPE_OUT" };
  l.lose_conditions = [{ type: "WIPED_OUT" }];
  l.exp_override = expOverride;
  l.fog = fog;
  l.required_units = [];
  l.roster = [
    "lin_chong", "lu_zhishen", "wu_song", "gongsun_sheng", "wu_yong", "hua_rong",
    "li_kui", "qin_ming", "zhang_qing", "hu_sanniang", "dai_zong", "shi_qian",
    "sun_erniang", "an_daoquan", "cao_zheng", "jiao_ting", "bao_xu", "yu_baosi",
    "bai_sheng", "tang_long", "shi_yong", "song_wan", "du_qian", "wang_dingliu",
  ];
  l.deploy_zone = [0, 6, 8, 2];
  l.max_deploy = 5;
  l.enemies = enemies;
  l.rewards = rewards;
  return l;
}

// ---------------------------------------------------------------- 第一章：教学序列

function ch01_01() {
  // 教学 1：移动与普攻
  const l = teachingBase("ch01_01", "教学·移动与攻击", 1);
  l.enemies = [
    { unit: "xiangjun_recruit", coords: [4, 2] },
    { unit: "xiangjun_recruit", coords: [5, 2] },
  ];
  l.triggers = [{ id: "t1", once: true, on: { type: "START" }, actions: [
    { type: "dialogue", text: "【教学】左键点蓝色高亮格移动，点红圈敌人攻击。速度快的一方可能连续行动。" },
    { type: "dialogue", text: "石勇：官兵围上来了，兄弟们，跟我顶住！" }] }];
  return l;
}

function ch01_02() {
  // 教学 2：地形与高低差（森林闪避、高台加成、背刺）
  const l = teachingBase("ch01_02", "教学·地形与走位", 2);
  l.terrain_map = {
    "2,2": "forest", "3,2": "forest", "2,3": "forest",
    "5,3": "hill", "6,3": "hill", "4,4": "barricade",
  };
  l.height_map = { "5,3": 1, "6,3": 1 };
  l.enemies = [
    { unit: "xiangjun_recruit", coords: [4, 1] },
    { unit: "xiangjun_recruit", coords: [5, 1] },
  ];
  l.triggers = [{ id: "t1", once: true, on: { type: "START" }, actions: [
    { type: "dialogue", text: "【教学】森林里闪避更高；高台打低处伤害更高；绕到敌人背后是背刺加成。" }] }];
  return l;
}

function ch01_03() {
  // 教学 3：技能与怒气
  const l = teachingBase("ch01_03", "教学·技能与怒气", 3);
  l.enemies = [
    { unit: "xiangjun_recruit", coords: [4, 2] },
    { unit: "xiangjun_recruit", coords: [5, 2] },
    { unit: "xiangjun_recruit", coords: [4, 1] },
  ];
  l.triggers = [{ id: "t1", once: true, on: { type: "START" }, actions: [
    { type: "dialogue", text: "【教学】Q 放主动技，W 放绝技（怒气满 100）。攻击、受击、待机都会攒怒气。" }] }];
  return l;
}

function ch01_04() {
  // 坚守关：坚持 5 回合
  const l = teachingBase("ch01_04", "坚守·山寨大门", 4);
  l.terrain_map = { "3,3": "camp", "4,3": "camp", "2,2": "barricade", "5,2": "barricade" };
  l.win_condition = { type: "SURVIVE_TURNS", turns: 5 };
  l.enemies = [
    { unit: "xiangjun_spear", coords: [3, 0] },
    { unit: "xiangjun_spear", coords: [4, 0] },
    { unit: "xiangjun_shield", coords: [2, 1] },
    { unit: "xiangjun_shield", coords: [5, 1] },
  ];
  l.triggers = [
    { id: "t1", once: true, on: { type: "START" }, actions: [
      { type: "dialogue", text: "【教学】坚守 5 回合即胜，不必硬拼。营帐格每回合回血。" }] },
    { id: "t2", once: true, on: { type: "TURN", turn: 3 }, actions: [
      { type: "dialogue", text: "官军增援从北面杀到！" },
      { type: "spawn", units: [{ unit: "xiangjun_spear", coords: [4, 0], team: "enemy" }] }] },
  ];
  return l;
}

function ch01_05() {
  // 章末 BOSS 关：击杀头目即胜
  const l = teachingBase("ch01_05", "头目·都监亲兵", 5);
  l.win_condition = { type: "KILL_BOSS" };
  l.enemies = [
    { unit: "lao_duguan", coords: [4, 1], elite: true, boss: true },
    { unit: "xiangjun_recruit", coords: [3, 2] },
    { unit: "xiangjun_recruit", coords: [5, 2] },
    { unit: "pai_recruit", coords: [4, 2] },
  ];
  l.triggers = [{ id: "t1", once: true, on: { type: "START" }, actions: [
    { type: "dialogue", text: "【教学】斩杀头目即胜。老都管会给亲兵鼓劲，优先集火（F 键标记）。" }] }];
  l.rewards = { first_clear: { gold: 800, breakthrough_mat: 2 }, regular: { gold: 200 } };
  return l;
}

// ---------------------------------------------------------------- 第二章：七星聚义

function ch02_01() {
  const l = baseLevel();
  l.id = "ch02_01";
  l.name = "聚义·东溪村";
  l.chapter = 2;
  l.recommended_level = 8;
  l.grid_size = [8, 8];
  l.terrain_map = { "2,2": "forest", "3,2": "forest", "4,4": "road", "4,3": "road" };
  l.win_condition = { type: "WIPE_OUT" };
  l.lose_conditions = [{ type: "WIPED_OUT" }];
  l.required_units = ["shi_yong"];
  l.roster = ["song_wan", "du_qian", "wang_dingliu"];
  l.deploy_zone = [0, 6, 8, 2];
  l.max_deploy = 4;
  l.npc_allies = [{ unit: "chao_gai_npc", coords: [3, 5] }];
  l.enemies = [
    { unit: "xiangjun_spear", coords: [3, 1] },
    { unit: "xiangjun_spear", coords: [4, 1] },
    { unit: "xiangjun_spear", coords: [5, 1] },
    { unit: "xiangjun_shield", coords: [4, 2] },
  ];
  l.triggers = [{ id: "t1", once: true, on: { type: "START" }, actions: [
    { type: "dialogue", text: "晁盖：官兵查到东溪村来了！诸位兄弟，随我杀出去！" },
    { type: "dialogue", text: "【教学】绿圈是 AI 操控的友军，会自行作战。" }] }];
  l.rewards = { first_clear: { gold: 600, breakthrough_mat: 1 }, regular: { gold: 150 } };
  return l;
}

function ch02_02() {
  // 章末：护送晁盖突围（ESCORT 胜利教学）
  const l = baseLevel();
  l.id = "ch02_02";
  l.name = "突围·石碣村";
  l.chapter = 2;
  l.recommended_level = 10;
  l.grid_size = [10, 8];
  fillCols(l.terrain_map, [4], 0, 7, "road");
  setCells(l.terrain_map, [[1, 2], [2, 2], [7, 3], [8, 3]], "forest");
  l.win_condition = { type: "ESCORT", unit: "chao_gai_npc", zone: [0, 0, 10, 1] };
  l.lose_conditions = [{ type: "WIPED_OUT" }, { type: "ESCORT_DEAD", unit: "chao_gai_npc" }];
  l.required_units = ["shi_yong"];
  l.roster = ["song_wan", "du_qian", "wang_dingliu"];
  l.deploy_zone = [0, 6, 10, 2];
  l.max_deploy = 4;
  l.npc_allies = [
    { unit: "chao_gai_npc", coords: [4, 6] },
    { unit: "liu_tang_npc", coords: [5, 6] },
  ];
  l.enemies = [
    { unit: "xiangjun_spear", coords: [3, 2] },
    { unit: "xiangjun_spear", coords: [5, 2] },
    { unit: "xiangjun_shield", coords: [4, 2] },
    { unit: "xiangjun_shield", coords: [4, 1] },
    { unit: "lao_duguan", coords: [4, 0], elite: true },
  ];
  l.triggers = [
    { id: "t1", once: true, on: { type: "START" }, actions: [
      { type: "dialogue", text: "【教学】护送晁盖抵达北面村口（第一排）即胜；晁盖阵亡即败。" }] },
    { id: "t2", once: true, on: { type: "TURN", turn: 3 }, actions: [
      { type: "dialogue", text: "两侧芦苇荡杀出伏兵！" },
      { type: "spawn", units: [
        { unit: "xiangjun_spear", coords: [1, 3], team: "enemy" },
        { unit: "xiangjun_spear", coords: [8, 2], team: "enemy" },
      ] }] },
  ];
  l.rewards = { first_clear: { gold: 800, breakthrough_mat: 2 }, regular: { gold: 200 } };
  return l;
}

// ---------------------------------------------------------------- 第三章：智取生辰纲

function ch03_01() {
  // 示范关：非歼灭胜利（夺取）+ 场景互动（酒摊）+ 药酒/硬打双路线
  const l = baseLevel();
  l.id = "ch03_01";
  l.name = "智取生辰纲";
  l.chapter = 3;
  l.recommended_level = 12;
  l.grid_size = [10, 8];
  // 黄泥冈：中央土路纵贯南北，两侧松林，东北角高台，土路中段旁酒摊
  fillCols(l.terrain_map, [4, 5], 0, 7, "road");
  setCells(l.terrain_map, [
    [1, 2], [2, 2], [1, 3], [2, 3], [1, 4], [2, 4],
    [7, 2], [8, 2], [7, 3], [8, 3], [7, 4], [8, 4],
  ], "forest");
  setCells(l.terrain_map, [[8, 0], [9, 0], [9, 1]], "hill");
  l.terrain_map["6,4"] = "wine_stall";
  l.height_map = { "8,0": 1, "9,0": 1, "9,1": 1 };
  l.win_condition = { type: "COLLECT", target: "cargo", count: 3 };
  l.lose_conditions = [{ type: "WIPED_OUT" }, { type: "TURN_LIMIT", turns: 10 }];
  l.required_units = ["wu_yong", "bai_sheng"];
  l.roster = ["lin_chong", "lu_zhishen", "gongsun_sheng", "hua_rong", "an_daoquan", "li_kui"];
  l.deploy_zone = [0, 6, 10, 2];
  l.max_deploy = 4;
  l.npc_allies = [
    { unit: "chao_gai_npc", coords: [3, 5] },
    { unit: "liu_tang_npc", coords: [6, 5] },
  ];
  l.enemies = [
    { unit: "yang_zhi_boss", coords: [5, 2], elite: true, boss: true },
    { unit: "lao_duguan", coords: [4, 2] },
    { unit: "xiangjun_spear", coords: [3, 2] },
    { unit: "xiangjun_spear", coords: [6, 2] },
    { unit: "xiangjun_spear", coords: [3, 3] },
    { unit: "xiangjun_spear", coords: [6, 3] },
    { unit: "xiangjun_shield", coords: [4, 1] },
    { unit: "xiangjun_shield", coords: [5, 1] },
  ];
  l.objects = [
    { id: "cargo", coords: [4, 3], hp: 300 },
    { id: "cargo", coords: [5, 3], hp: 300 },
    { id: "cargo", coords: [4, 4], hp: 300 },
  ];
  l.triggers = [
    // T1 开局剧情
    { id: "t1_intro", once: true, on: { type: "START" }, actions: [
      { type: "dialogue", text: "吴用：杨志押的是梁中书的生辰纲，硬拼不得。白胜，看你的了。" },
      { type: "dialogue", text: "【教学】本关目标是夺取 3 副生辰纲担，不必全歼敌军。白胜进酒摊有妙用。" },
    ] },
    // 公孙胜彩蛋
    { id: "t1b_gongsun", once: true, on: { type: "START" },
      if: { type: "unit_deployed", unit: "gongsun_sheng" },
      actions: [{ type: "dialogue", text: "公孙胜：贫道夜观天象，今日黄泥冈上，合该有这一桩富贵。" }] },
    // T2 蒙汗药酒事件
    { id: "t2_drugged_wine", once: true,
      on: { type: "ENTER_ZONE", zone: [6, 4, 1, 1], who: "bai_sheng" },
      actions: [
        { type: "dialogue", text: "白胜：「好酒！烈得很哪——」杨志军汉饮了蒙汗药，一个个都倒了！" },
        { type: "status", side: "enemy", status: "sleep", duration: 2,
          except: { unit: "yang_zhi_boss", duration: 1 }, name: "蒙汗药酒" },
        { type: "buff", unit: "bai_sheng", field: "atk", value: 20, duration: 99, name: "生辰纲功臣" },
        { type: "achievement_path", path: "drugged_wine" },
        { type: "dialogue", text: "【教学】敌军已麻倒，快夺取生辰纲！" },
      ] },
    // T3 杨志半血狂暴
    { id: "t3_yangzhi_rage", once: true,
      on: { type: "HP_BELOW", unit: "yang_zhi_boss", ratio: 0.5 },
      actions: [
        { type: "dialogue", text: "杨志：「羞刀难入鞘！」——杨志攻势大振，枪枪拼命。" },
        { type: "buff", unit: "yang_zhi_boss", field: "atk", value: 30, duration: 99, name: "羞刀难入鞘" },
        { type: "regen", unit: "yang_zhi_boss", percent: 5, duration: 99, name: "羞刀难入鞘·回血" },
      ] },
    // T4 第 6 回合援军（若未集齐 3 担）
    { id: "t4_reinforce", once: true, on: { type: "TURN", turn: 6 },
      if: { type: "collect_below", target: "cargo", count: 3 },
      actions: [
        { type: "dialogue", text: "老都管：援军到了！都给我顶住！" },
        { type: "spawn", units: [
          { unit: "xiangjun_spear", coords: [2, 7], team: "enemy" },
          { unit: "xiangjun_spear", coords: [7, 7], team: "enemy" },
        ] },
      ] },
    // T6 白胜阵亡（硬打路线）；T5 由 COLLECT 胜利条件承载
    { id: "t6_baisheng_down", once: true, on: { type: "UNIT_DEAD", unit: "bai_sheng" },
      actions: [
        { type: "dialogue", text: "杨志：「卖酒的贼厮，也敢算计爷爷！」——敌军士气大振。" },
        { type: "buff", side: "enemy", field: "atk", value: 10, duration: 99, name: "士气" },
      ] },
  ];
  l.rewards = {
    first_clear: { shard_bai_sheng: 10, skill_book: 3, gold: 2000 },
    regular: { breakthrough_mat: 1 },
  };
  l.achievements = [
    { id: "buzhan", name: "不战而屈人之兵", exclusive_group: "shengchengang",
      requires: { path: "drugged_wine", no_player_kills: ["xiangjun_spear", "xiangjun_shield"] } },
    { id: "biaoshi", name: "黄泥冈镖师", exclusive_group: "shengchengang",
      requires: { boss_dead: "yang_zhi_boss" } },
  ];
  return l;
}

// ---------------------------------------------------------------- 第四章：大闹清风寨

function ch04_01() {
  // 清风寨·花灯夜（S 评价解锁花荣）
  const l = baseLevel();
  l.id = "ch04_01";
  l.name = "清风寨·花灯夜";
  l.chapter = 4;
  l.recommended_level = 14;
  l.grid_size = [10, 8];
  fillCols(l.terrain_map, [4], 0, 7, "road");
  setCells(l.terrain_map, [[2, 2], [2, 3], [7, 2], [7, 3], [3, 5], [6, 5]], "camp");
  setCells(l.terrain_map, [[1, 3], [8, 3], [1, 4], [8, 4]], "forest");
  l.win_condition = { type: "WIPE_OUT" };
  l.lose_conditions = [{ type: "WIPED_OUT" }];
  l.required_units = [];
  l.roster = [
    "lin_chong", "lu_zhishen", "wu_song", "gongsun_sheng", "wu_yong", "bai_sheng",
    "li_kui", "xu_ning", "shi_yong", "song_wan", "du_qian", "an_daoquan",
  ];
  l.deploy_zone = [0, 6, 10, 2];
  l.max_deploy = 5;
  l.enemies = [
    { unit: "lao_duguan", coords: [4, 1], elite: true }, // 刘高亲兵头目（占位）
    { unit: "xiangjun_spear", coords: [3, 1] },
    { unit: "xiangjun_spear", coords: [5, 1] },
    { unit: "xiangjun_spear", coords: [4, 2] },
    { unit: "xiangjun_shield", coords: [3, 2] },
    { unit: "xiangjun_shield", coords: [5, 2] },
  ];
  l.triggers = [
    { id: "t1", once: true, on: { type: "START" }, actions: [
      { type: "dialogue", text: "花灯夜，清风寨前火光冲天。刘高的亲兵把守住各条巷口。" },
      { type: "dialogue", text: "【挑战】6 回合内无阵亡通关可获 S 评价，花荣闻讯来投。" }] },
    { id: "t2", once: true, on: { type: "TURN", turn: 2 }, actions: [
      { type: "dialogue", text: "巷口两侧杀出伏兵！" },
      { type: "spawn", units: [
        { unit: "xiangjun_spear", coords: [0, 2], team: "enemy" },
        { unit: "xiangjun_spear", coords: [9, 2], team: "enemy" },
      ] }] },
  ];
  l.rank_rules = { s_max_rounds: 6, s_no_death: true };
  l.unlock_grant = { unit: "hua_rong", requires_rank: "S" };
  l.rewards = { first_clear: { gold: 1000, breakthrough_mat: 2 }, regular: { gold: 250 } };
  return l;
}

function ch04_02() {
  // 霹雳火·秦明（通关解锁秦明）
  const l = baseLevel();
  l.id = "ch04_02";
  l.name = "霹雳火·秦明";
  l.chapter = 4;
  l.recommended_level = 16;
  l.grid_size = [10, 8];
  setCells(l.terrain_map, [[3, 3], [4, 3], [5, 3], [6, 3]], "road");
  setCells(l.terrain_map, [[2, 2], [7, 2], [2, 4], [7, 4]], "hill");
  setHeights(l.height_map, [[2, 2], [7, 2], [2, 4], [7, 4]], 1);
  l.win_condition = { type: "KILL_BOSS" };
  l.lose_conditions = [{ type: "WIPED_OUT" }];
  l.required_units = [];
  l.roster = [
    "lin_chong", "lu_zhishen", "wu_song", "gongsun_sheng", "wu_yong", "bai_sheng",
    "li_kui", "xu_ning", "hua_rong", "shi_yong", "song_wan", "du_qian", "an_daoquan",
  ];
  l.deploy_zone = [0, 6, 10, 2];
  l.max_deploy = 5;
  l.enemies = [
    { unit: "qin_ming", coords: [4, 1], elite: true, boss: true, stat_mult: 1.5 },
    { unit: "xiangjun_spear", coords: [3, 1] },
    { unit: "xiangjun_spear", coords: [5, 1] },
    { unit: "xiangjun_shield", coords: [3, 2] },
    { unit: "xiangjun_shield", coords: [5, 2] },
  ];
  l.triggers = [
    { id: "t1", once: true, on: { type: "START" }, actions: [
      { type: "dialogue", text: "秦明：「反贼休走，吃我一棒！」——霹雳火当先来搦战。" },
      { type: "dialogue", text: "【挑战】击退秦明即胜。他攻高性烈，半血后愈发凶猛。" }] },
    { id: "t2", once: true, on: { type: "HP_BELOW", unit: "qin_ming", ratio: 0.5 }, actions: [
      { type: "dialogue", text: "秦明怒火攻心，狼牙棒势如霹雳！" },
      { type: "buff", unit: "qin_ming", field: "atk", value: 20, duration: 99, name: "霹雳怒火" }] },
  ];
  l.unlock_grant = { unit: "qin_ming" };
  l.rewards = { first_clear: { gold: 1200, breakthrough_mat: 3 }, regular: { gold: 300 } };
  return l;
}

// ---------------------------------------------------------------- 挑战关

function challenge_dongchang() {
  // 挑战关·东昌府（通关解锁张清）
  const l = baseLevel();
  l.id = "challenge_dongchang";
  l.name = "挑战·东昌府张清";
  l.mode = "challenge";
  l.chapter = 4;
  l.recommended_level = 18;
  l.grid_size = [10, 8];
  setCells(l.terrain_map, [[4, 1], [4, 2], [5, 1], [5, 2]], "hill");
  setHeights(l.height_map, [[4, 1], [4, 2], [5, 1], [5, 2]], 1);
  setCells(l.terrain_map, [[1, 4], [2, 4], [7, 4], [8, 4]], "forest");
  l.win_condition = { type: "KILL_BOSS" };
  l.lose_conditions = [{ type: "WIPED_OUT" }];
  l.required_units = [];
  l.roster = [
    "lin_chong", "lu_zhishen", "wu_song", "gongsun_sheng", "wu_yong", "bai_sheng",
    "li_kui", "xu_ning", "hua_rong", "qin_ming", "shi_yong", "song_wan", "du_qian", "an_daoquan",
  ];
  l.deploy_zone = [0, 6, 10, 2];
  l.max_deploy = 5;
  l.enemies = [
    { unit: "zhang_qing", coords: [4, 1], elite: true, boss: true },
    { unit: "gong_wang", coords: [3, 2] },
    { unit: "ding_desun", coords: [5, 2] },
    { unit: "xiangjun_shield", coords: [3, 3] },
    { unit: "xiangjun_shield", coords: [5, 3] },
  ];
  l.triggers = [{ id: "t1", once: true, on: { type: "START" }, actions: [
    { type: "dialogue", text: "没羽箭张清坐镇东昌府，飞石打人百发百中。" },
    { type: "dialogue", text: "【挑战】龚旺、丁得孙两员副将护翼左右，先剪羽翼再擒主将。" }] }];
  l.unlock_grant = { unit: "zhang_qing" };
  l.rewards = { first_clear: { gold: 1500, breakthrough_mat: 3 }, regular: { gold: 350 } };
  return l;
}

function challenge_majun() {
  // 挑战关·马军试炼（限定职业：仅马军可上阵）
  const l = baseLevel();
  l.id = "challenge_majun";
  l.name = "挑战·马军试炼";
  l.mode = "challenge";
  l.chapter = 5;
  l.recommended_level = 22;
  l.grid_size = [10, 8];
  // 开阔校场：中央官道纵贯，两侧高台箭楼
  fillCols(l.terrain_map, [4, 5], 0, 7, "road");
  setCells(l.terrain_map, [[1, 2], [8, 2], [1, 5], [8, 5]], "hill");
  setHeights(l.height_map, [[1, 2], [8, 2], [1, 5], [8, 5]], 1);
  l.win_condition = { type: "KILL_BOSS" };
  l.lose_conditions = [{ type: "WIPED_OUT" }];
  l.required_units = [];
  l.allowed_classes = ["cavalry"];
  // 候选池混排非马军（布阵条只显示马军：林冲/秦明/扈三娘）
  l.roster = [
    "lin_chong", "wu_song", "qin_ming", "hua_rong", "hu_sanniang",
    "lu_zhishen", "li_kui", "an_daoquan",
  ];
  l.deploy_zone = [0, 6, 10, 2];
  l.max_deploy = 3; // 马军仅三员，全员可上
  l.enemies = [
    { unit: "yang_zhi_boss", coords: [4, 1], elite: true, boss: true }, // 官军马军教头（占位）
    { unit: "xiangjun_spear", coords: [3, 2] },
    { unit: "xiangjun_spear", coords: [6, 2] },
    { unit: "xiangjun_shield", coords: [4, 3] },
  ];
  l.triggers = [
    { id: "t1", once: true, on: { type: "START" }, actions: [
      { type: "dialogue", text: "官军马军教头立马校场，指名会一会梁山马军。" },
      { type: "dialogue", text: "【挑战】本关限马军上阵。敌枪兵克马，绕开正面、侧翼驰突。" }] },
    { id: "t2", once: true, on: { type: "HP_BELOW", unit: "yang_zhi_boss", ratio: 0.5 }, actions: [
      { type: "dialogue", text: "马军教头：「好马！再来——」攻势愈发凶狠。" },
      { type: "buff", unit: "yang_zhi_boss", field: "atk", value: 20, duration: 99, name: "棋逢敌手" }] },
  ];
  l.rewards = { first_clear: { gold: 2000, breakthrough_mat: 4, skill_book: 2 }, regular: { gold: 400 } };
  return l;
}

// ---------------------------------------------------------------- 第五章：江州劫法场

function ch05_01() {
  // 江州·法场（李逵跳楼劫囚，官兵四面合围）
  const l = baseLevel();
  l.id = "ch05_01";
  l.name = "江州·劫法场";
  l.chapter = 5;
  l.recommended_level = 18;
  l.grid_size = [10, 8];
  // 法场：中央开阔广场，四面官兵合围
  fillCols(l.terrain_map, [4, 5], 2, 5, "road");
  setCells(l.terrain_map, [[1, 1], [8, 1], [1, 6], [8, 6]], "barricade");
  l.win_condition = { type: "WIPE_OUT" };
  l.lose_conditions = [{ type: "WIPED_OUT" }];
  l.required_units = ["li_kui"];
  l.roster = [
    "lin_chong", "lu_zhishen", "wu_song", "gongsun_sheng", "wu_yong", "bai_sheng",
    "dai_zong", "xu_ning", "hua_rong", "qin_ming", "an_daoquan", "jiao_ting", "bao_xu",
  ];
  l.deploy_zone = [0, 6, 10, 2];
  l.max_deploy = 6;
  l.enemies = [
    { unit: "lao_duguan", coords: [4, 0], elite: true, stat_mult: 1.5 }, // 蔡九 proxy（占位）
    { unit: "xiangjun_spear", coords: [3, 0] },
    { unit: "xiangjun_spear", coords: [5, 0] },
    { unit: "xiangjun_shield", coords: [3, 2] },
    { unit: "xiangjun_shield", coords: [6, 2] },
    { unit: "xiangjun_spear", coords: [3, 3] },
    { unit: "xiangjun_spear", coords: [6, 3] },
  ];
  l.triggers = [
    { id: "t1", once: true, on: { type: "START" }, actions: [
      { type: "dialogue", text: "午时三刻，法场四周刀枪如林。黑旋风从半空里跳将下来！" },
      { type: "dialogue", text: "李逵：「都闪开！砍翻他们一个不留！」" }] },
    { id: "t2", once: true, on: { type: "TURN", turn: 2 }, actions: [
      { type: "dialogue", text: "城外官兵增援杀到！" },
      { type: "spawn", units: [
        { unit: "xiangjun_spear", coords: [0, 1], team: "enemy" },
        { unit: "xiangjun_spear", coords: [9, 1], team: "enemy" },
      ] }] },
  ];
  l.rewards = { first_clear: { gold: 1500, breakthrough_mat: 3 }, regular: { gold: 350 } };
  return l;
}

function ch05_02() {
  // 白龙庙·江边断后（张顺水战，坚守待船）
  const l = baseLevel();
  l.id = "ch05_02";
  l.name = "白龙庙·江边断后";
  l.chapter = 5;
  l.recommended_level = 20;
  l.grid_size = [10, 8];
  // 江边：南侧水面，张顺水中来去
  fillRow(l.terrain_map, 7, 0, 9, "water");
  setCells(l.terrain_map, [[2, 3], [7, 3], [3, 5], [6, 5]], "forest");
  setCells(l.terrain_map, [[4, 4], [5, 4]], "camp");
  l.win_condition = { type: "SURVIVE_TURNS", turns: 6 };
  l.lose_conditions = [{ type: "WIPED_OUT" }];
  l.required_units = [];
  l.roster = [
    "lin_chong", "lu_zhishen", "wu_song", "gongsun_sheng", "wu_yong", "bai_sheng",
    "li_kui", "dai_zong", "xu_ning", "hua_rong", "qin_ming", "an_daoquan", "zhang_shun",
  ];
  l.deploy_zone = [0, 5, 10, 2];
  l.max_deploy = 6;
  l.npc_allies = [{ unit: "zhang_shun", coords: [4, 7] }]; // 水中接应（水战特性展示）
  l.enemies = [
    { unit: "xiangjun_spear", coords: [3, 0] },
    { unit: "xiangjun_spear", coords: [4, 0] },
    { unit: "xiangjun_spear", coords: [5, 0] },
    { unit: "xiangjun_spear", coords: [6, 0] },
    { unit: "xiangjun_shield", coords: [4, 1] },
    { unit: "xiangjun_shield", coords: [5, 1] },
  ];
  l.triggers = [
    { id: "t1", once: true, on: { type: "START" }, actions: [
      { type: "dialogue", text: "【教学】坚守 6 回合，船到即走。张顺在水中接应——他不受水面迟滞。" }] },
    { id: "t2", once: true, on: { type: "TURN", turn: 2 }, actions: [
      { type: "dialogue", text: "官军第二波涌上江岸！" },
      { type: "spawn", units: [
        { unit: "xiangjun_spear", coords: [2, 0], team: "enemy" },
        { unit: "xiangjun_spear", coords: [7, 0], team: "enemy" },
      ] }] },
    { id: "t3", once: true, on: { type: "TURN", turn: 4 }, actions: [
      { type: "dialogue", text: "官军弓手压上来了，再撑两回合！" },
      { type: "spawn", units: [
        { unit: "gong_wang", coords: [4, 0], team: "enemy" },
        { unit: "ding_desun", coords: [5, 0], team: "enemy" },
      ] }] },
  ];
  l.rewards = { first_clear: { gold: 1800, breakthrough_mat: 3 }, regular: { gold: 400 } };
  return l;
}

// ---------------------------------------------------------------- 第六章：三打祝家庄

function ch06_01() {
  // 一打·前哨探庄
  const l = baseLevel();
  l.id = "ch06_01";
  l.name = "一打·祝家庄前哨";
  l.chapter = 6;
  l.recommended_level = 22;
  l.grid_size = [10, 8];
  fillCols(l.terrain_map, [4], 0, 7, "road");
  setCells(l.terrain_map, [[2, 2], [3, 2], [6, 2], [7, 2], [2, 5], [7, 5]], "forest");
  l.win_condition = { type: "WIPE_OUT" };
  l.lose_conditions = [{ type: "WIPED_OUT" }];
  l.required_units = [];
  l.roster = [
    "lin_chong", "lu_zhishen", "wu_song", "gongsun_sheng", "wu_yong", "bai_sheng",
    "li_kui", "xu_ning", "hua_rong", "qin_ming", "wang_ying", "an_daoquan", "zhang_qing",
  ];
  l.deploy_zone = [0, 6, 10, 2];
  l.max_deploy = 6;
  l.enemies = [
    { unit: "xiangjun_spear", coords: [3, 1] },
    { unit: "xiangjun_spear", coords: [5, 1] },
    { unit: "xiangjun_shield", coords: [4, 1] },
    { unit: "xiangjun_shield", coords: [4, 2] },
    { unit: "gong_wang", coords: [4, 0] },
  ];
  l.triggers = [
    { id: "t1", once: true, on: { type: "START" }, actions: [
      { type: "dialogue", text: "祝家庄外，吊桥高悬。庄丁平日横惯了，见人就杀。" }] },
    { id: "t2", once: true, on: { type: "ENTER_ZONE", zone: [0, 2, 10, 2], who: "player" }, actions: [
      { type: "dialogue", text: "两侧松林里冲出庄丁伏兵！" },
      { type: "spawn", units: [
        { unit: "xiangjun_spear", coords: [2, 2], team: "enemy" },
        { unit: "xiangjun_spear", coords: [7, 2], team: "enemy" },
      ] }] },
  ];
  l.rewards = { first_clear: { gold: 1800, breakthrough_mat: 3 }, regular: { gold: 400 } };
  return l;
}

function ch06_02() {
  // 二打·盘陀路（路径曲折，拒马拦路）
  const l = baseLevel();
  l.id = "ch06_02";
  l.name = "二打·盘陀路";
  l.chapter = 6;
  l.recommended_level = 24;
  l.grid_size = [12, 10];
  setCells(l.terrain_map, [[3, 2], [5, 3], [7, 4], [5, 5], [3, 6], [8, 2]], "barricade");
  setCells(l.terrain_map, [[1, 3], [2, 3], [9, 5], [10, 5], [5, 7], [6, 7]], "forest");
  setCells(l.terrain_map, [[10, 1], [11, 1]], "hill");
  setHeights(l.height_map, [[10, 1], [11, 1]], 1);
  l.win_condition = { type: "WIPE_OUT" };
  l.lose_conditions = [{ type: "WIPED_OUT" }];
  l.required_units = [];
  l.roster = [
    "lin_chong", "lu_zhishen", "wu_song", "gongsun_sheng", "wu_yong", "bai_sheng",
    "li_kui", "xu_ning", "hua_rong", "qin_ming", "wang_ying", "an_daoquan", "zhang_qing",
  ];
  l.deploy_zone = [0, 8, 12, 2];
  l.max_deploy = 6;
  l.enemies = [
    { unit: "xiangjun_spear", coords: [4, 2] },
    { unit: "xiangjun_spear", coords: [6, 3] },
    { unit: "xiangjun_shield", coords: [5, 2] },
    { unit: "xiangjun_shield", coords: [7, 3] },
    { unit: "ding_desun", coords: [10, 1] },
    { unit: "gong_wang", coords: [11, 1] },
  ];
  l.triggers = [
    { id: "t1", once: true, on: { type: "START" }, actions: [
      { type: "dialogue", text: "盘陀路弯弯曲曲，到处都是拒马。白杨树才是转弯的记号……" },
      { type: "dialogue", text: "【教学】拒马挡路，绕行或打碎（约 3 次攻击）。山上飞叉冷箭，小心。" }] },
    { id: "t2", once: true, on: { type: "TURN", turn: 3 }, actions: [
      { type: "dialogue", text: "后路又有庄丁包抄！" },
      { type: "spawn", units: [{ unit: "xiangjun_spear", coords: [11, 8], team: "enemy" }] }] },
  ];
  l.rewards = { first_clear: { gold: 2000, breakthrough_mat: 4 }, regular: { gold: 450 } };
  return l;
}

function ch06_03() {
  // 三打·庄门决战（扈三娘出战，通关后入队）
  const l = baseLevel();
  l.id = "ch06_03";
  l.name = "三打·祝家庄";
  l.chapter = 6;
  l.recommended_level = 26;
  l.grid_size = [12, 10];
  fillCols(l.terrain_map, [5, 6], 0, 9, "road");
  setCells(l.terrain_map, [[2, 4], [9, 4], [3, 7], [8, 7]], "camp");
  setCells(l.terrain_map, [[4, 1], [7, 1]], "barricade");
  l.win_condition = { type: "KILL_BOSS" };
  l.lose_conditions = [{ type: "WIPED_OUT" }];
  l.required_units = [];
  l.roster = [
    "lin_chong", "lu_zhishen", "wu_song", "gongsun_sheng", "wu_yong", "bai_sheng",
    "li_kui", "xu_ning", "hua_rong", "qin_ming", "wang_ying", "an_daoquan", "zhang_qing",
  ];
  l.deploy_zone = [0, 8, 12, 2];
  l.max_deploy = 6;
  l.npc_allies = [{ unit: "wang_ying", coords: [6, 8] }];
  l.enemies = [
    { unit: "lao_duguan", coords: [5, 0], elite: true, boss: true, stat_mult: 2.0 }, // 祝朝奉 proxy（占位）
    { unit: "hu_sanniang", coords: [6, 2], elite: true, stat_mult: 1.3 }, // 一丈青出战（战后入队）
    { unit: "xiangjun_spear", coords: [4, 2] },
    { unit: "xiangjun_spear", coords: [7, 2] },
    { unit: "xiangjun_shield", coords: [4, 3] },
    { unit: "xiangjun_shield", coords: [7, 3] },
  ];
  l.triggers = [
    { id: "t1", once: true, on: { type: "START" }, actions: [
      { type: "dialogue", text: "祝朝奉门前，一丈青扈三娘纵马提刀杀出——好一个女将！" },
      { type: "dialogue", text: "王英：「这娘子交给我……哎哟！」（小心她的红棉套索）" }] },
    { id: "t2", once: true, on: { type: "UNIT_DEAD", unit: "hu_sanniang" }, actions: [
      { type: "dialogue", text: "扈三娘被擒。宋江：「好生看护，不得无礼。」" }] },
  ];
  l.rewards = { first_clear: { gold: 2500, breakthrough_mat: 5 }, regular: { gold: 500 } };
  return l;
}

// ---------------------------------------------------------------- 终章：大聚义（招安 / 不招安双路线）

function ch07_01a() {
  // 招安线：奉诏征辽
  const l = baseLevel();
  l.id = "ch07_01a";
  l.name = "终章·奉诏征辽";
  l.chapter = 7;
  l.recommended_level = 28;
  l.ending = "zhaoan";
  l.grid_size = [12, 10];
  fillCols(l.terrain_map, [5, 6], 0, 9, "road");
  setCells(l.terrain_map, [[2, 3], [9, 3], [3, 6], [8, 6]], "hill");
  setHeights(l.height_map, [[2, 3], [9, 3], [3, 6], [8, 6]], 1);
  l.win_condition = { type: "KILL_BOSS" };
  l.lose_conditions = [{ type: "WIPED_OUT" }];
  l.required_units = [];
  l.roster = [
    "lin_chong", "lu_zhishen", "wu_song", "gongsun_sheng", "wu_yong", "hua_rong",
    "li_kui", "qin_ming", "zhang_qing", "hu_sanniang", "xu_ning", "an_daoquan",
  ];
  l.deploy_zone = [0, 8, 12, 2];
  l.max_deploy = 8;
  l.enemies = [
    { unit: "yang_zhi_boss", coords: [5, 1], elite: true, boss: true, stat_mult: 1.6 }, // 辽将 proxy（占位）
    { unit: "xiangjun_spear", coords: [4, 2], stat_mult: 1.3 },
    { unit: "xiangjun_spear", coords: [7, 2], stat_mult: 1.3 },
    { unit: "xiangjun_shield", coords: [4, 3], stat_mult: 1.3 },
    { unit: "xiangjun_shield", coords: [7, 3], stat_mult: 1.3 },
    { unit: "gong_wang", coords: [3, 2], stat_mult: 1.3 },
    { unit: "ding_desun", coords: [8, 2], stat_mult: 1.3 },
  ];
  l.triggers = [
    { id: "t1", once: true, on: { type: "START" }, actions: [
      { type: "dialogue", text: "奉旨讨辽！梁山军旗号改成了「顺天」——众兄弟，最后一战。" }] },
    { id: "t2", once: true, on: { type: "TURN", turn: 3 }, actions: [
      { type: "dialogue", text: "辽军骑兵自两翼杀到！" },
      { type: "spawn", units: [
        { unit: "xiangjun_spear", coords: [0, 2], team: "enemy", stat_mult: 1.3 },
        { unit: "xiangjun_spear", coords: [11, 2], team: "enemy", stat_mult: 1.3 },
      ] }] },
  ];
  l.rewards = { first_clear: { gold: 3000, breakthrough_mat: 6 }, regular: { gold: 600 } };
  return l;
}

function ch07_01b() {
  // 不招安线：抗诏·官军围剿
  const l = baseLevel();
  l.id = "ch07_01b";
  l.name = "终章·抗诏再聚义";
  l.chapter = 7;
  l.recommended_level = 28;
  l.ending = "kangzhao";
  l.grid_size = [12, 10];
  fillRow(l.terrain_map, 9, 0, 11, "water");
  setCells(l.terrain_map, [[2, 4], [9, 4], [4, 6], [7, 6]], "camp");
  setCells(l.terrain_map, [[4, 2], [7, 2]], "barricade");
  l.win_condition = { type: "WIPE_OUT" };
  l.lose_conditions = [{ type: "WIPED_OUT" }];
  l.required_units = [];
  l.roster = [
    "lin_chong", "lu_zhishen", "wu_song", "gongsun_sheng", "wu_yong", "hua_rong",
    "li_kui", "qin_ming", "zhang_qing", "hu_sanniang", "xu_ning", "an_daoquan",
  ];
  l.deploy_zone = [0, 7, 12, 2];
  l.max_deploy = 8;
  l.enemies = [
    { unit: "qin_ming", coords: [5, 1], elite: true, stat_mult: 1.6 }, // 官军统制 proxy（占位）
    { unit: "xiangjun_spear", coords: [4, 2], stat_mult: 1.3 },
    { unit: "xiangjun_spear", coords: [7, 2], stat_mult: 1.3 },
    { unit: "xiangjun_shield", coords: [4, 3], stat_mult: 1.3 },
    { unit: "xiangjun_shield", coords: [7, 3], stat_mult: 1.3 },
    { unit: "lao_duguan", coords: [6, 0], elite: true, stat_mult: 1.4 },
  ];
  l.triggers = [
    { id: "t1", once: true, on: { type: "START" }, actions: [
      { type: "dialogue", text: "圣旨掷地于尘埃：「梁山贼寇，安敢不臣！」——官军水陆并进，围了山寨。" },
      { type: "dialogue", text: "众头领：「不让咱弟兄快活，就再打他个落花流水！」" }] },
    { id: "t2", once: true, on: { type: "TURN", turn: 2 }, actions: [
      { type: "dialogue", text: "官军后继人马压上！" },
      { type: "spawn", units: [
        { unit: "xiangjun_spear", coords: [2, 0], team: "enemy", stat_mult: 1.3 },
        { unit: "xiangjun_spear", coords: [9, 0], team: "enemy", stat_mult: 1.3 },
      ] }] },
    { id: "t3", once: true, on: { type: "TURN", turn: 4 }, actions: [
      { type: "dialogue", text: "水军自芦苇荡杀出，断了官军后路！" },
      { type: "spawn", units: [
        { unit: "zhang_shun", coords: [5, 9], team: "npc" },
      ] }] },
  ];
  l.rewards = { first_clear: { gold: 3000, breakthrough_mat: 6 }, regular: { gold: 600 } };
  return l;
}

// ---------------------------------------------------------------- 调试关

function debug_01() {
  // 调试关卡：3 必出 + 候选池布阵，演示 TURN/ENTER_ZONE 两类触发器
  const l = baseLevel();
  l.id = "debug_01";
  l.name = "调试关卡";
  l.grid_size = [8, 8];
  l.terrain_map = {
    "2,2": "forest", "3,2": "forest", "2,3": "forest",
    "5,5": "forest", "6,2": "hill", "6,3": "hill",
    "4,4": "barricade", "3,4": "camp", "1,5": "water",
    "4,0": "road", "4,1": "road",
  };
  l.height_map = { "6,2": 1, "6,3": 1 };
  l.win_condition = { type: "WIPE_OUT" };
  l.lose_conditions = [{ type: "WIPED_OUT" }];
  l.required_units = ["lin_chong", "lu_zhishen", "an_daoquan"];
  l.roster = [
    "wu_yong", "hua_rong", "li_kui", "dai_zong", "shi_qian",
    "sun_erniang", "cao_zheng", "jiao_ting", "bao_xu", "yu_baosi",
  ];
  l.deploy_zone = [0, 6, 8, 2];
  l.max_deploy = 6;
  l.enemies = [
    { unit: "shi_yong", coords: [5, 1] },
    { unit: "song_wan", coords: [4, 1], elite: true },
    { unit: "du_qian", coords: [6, 1] },
  ];
  l.triggers = [
    { id: "t_reinforce", once: true,
      on: { type: "TURN", turn: 2 },
      actions: [
        { type: "dialogue", text: "敌军援军从北面赶到了！" },
        { type: "spawn", units: [{ unit: "wang_dingliu", coords: [7, 0], team: "enemy" }] },
      ] },
    { id: "t_mid", once: true,
      on: { type: "ENTER_ZONE", zone: [0, 3, 8, 2], who: "player" },
      actions: [{ type: "dialogue", text: "我军已突入中场，注意两侧松林伏兵。" }] },
  ];
  return l;
}

// ---------------------------------------------------------------- 日常副本（6 关，自动战斗主战场，D34）

function daily_exp_1() {
  return dailyBase("daily_exp_1", "演武·新兵试炼", 5, 100,
    { first_clear: { gold: 200 }, regular: { gold: 50 } },
    [
      { unit: "xiangjun_spear", coords: [3, 1] },
      { unit: "xiangjun_spear", coords: [4, 1] },
      { unit: "xiangjun_spear", coords: [5, 1] },
      { unit: "xiangjun_shield", coords: [4, 2] },
    ]);
}

function daily_exp_2() {
  return dailyBase("daily_exp_2", "演武·精锐试炼", 12, 200,
    { first_clear: { gold: 400 }, regular: { gold: 100 } },
    [
      { unit: "xiangjun_spear", coords: [3, 1] },
      { unit: "xiangjun_spear", coords: [5, 1] },
      { unit: "xiangjun_shield", coords: [4, 1] },
      { unit: "xiangjun_shield", coords: [4, 2] },
      { unit: "xiangjun_spear", coords: [3, 2] },
      { unit: "xiangjun_spear", coords: [5, 2] },
    ]);
}

function daily_gold_1() {
  return dailyBase("daily_gold_1", "押镖·黄泥小道", 6, 0,
    { first_clear: { gold: 800 }, regular: { gold: 600 } },
    [
      { unit: "xiangjun_spear", coords: [3, 1] },
      { unit: "xiangjun_spear", coords: [4, 1] },
      { unit: "xiangjun_shield", coords: [5, 2] },
    ]);
}

function daily_gold_2() {
  return dailyBase("daily_gold_2", "押镖·官道风云", 13, 0,
    { first_clear: { gold: 1500 }, regular: { gold: 1200 } },
    [
      { unit: "xiangjun_spear", coords: [3, 1] },
      { unit: "xiangjun_spear", coords: [5, 1] },
      { unit: "xiangjun_shield", coords: [4, 1] },
      { unit: "xiangjun_shield", coords: [4, 2] },
      { unit: "lao_duguan", coords: [4, 0], elite: true },
    ]);
}

function daily_mat_1() {
  // 迷雾示范关（布阵阶段不展示敌方阵容与危险范围）
  return dailyBase("daily_mat_1", "奇袭·辎重营", 7, 0,
    { first_clear: { breakthrough_mat: 3 }, regular: { breakthrough_mat: 2 } },
    [
      { unit: "xiangjun_shield", coords: [3, 1] },
      { unit: "xiangjun_shield", coords: [5, 1] },
      { unit: "xiangjun_spear", coords: [4, 2] },
    ], true);
}

function daily_mat_2() {
  return dailyBase("daily_mat_2", "奇袭·军械库", 14, 0,
    { first_clear: { breakthrough_mat: 6 }, regular: { breakthrough_mat: 4 } },
    [
      { unit: "xiangjun_shield", coords: [3, 1] },
      { unit: "xiangjun_shield", coords: [5, 1] },
      { unit: "xiangjun_spear", coords: [3, 2] },
      { unit: "xiangjun_spear", coords: [5, 2] },
      { unit: "lao_duguan", coords: [4, 0], elite: true },
    ]);
}

// ---------------------------------------------------------------- 注册表

const BUILDERS = {
  ch01_01, ch01_02, ch01_03, ch01_04, ch01_05,
  ch02_01, ch02_02, ch03_01, ch04_01, ch04_02,
  challenge_dongchang, challenge_majun,
  ch05_01, ch05_02, ch06_01, ch06_02, ch06_03,
  ch07_01a, ch07_01b, debug_01,
  daily_exp_1, daily_exp_2, daily_gold_1, daily_gold_2, daily_mat_1, daily_mat_2,
};
