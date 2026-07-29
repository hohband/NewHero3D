// 3.1 任意编队装配 · 无头测试
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCsvs, runBattle, MIRROR_ENEMY } from "./helpers.js";
import { buildTeams } from "../src/prototype/data.js";
import { Sim } from "../src/prototype/sim.js";
import { parseCsvTable } from "../src/shared/csv.js";

const csvs = loadCsvs();

const FORMATIONS = {
  五近战: [
    { id: "lu_zhishen", row: "front", slot: 0 },
    { id: "lin_chong", row: "front", slot: 1 },
    { id: "wu_song", row: "front", slot: 2 },
    { id: "li_kui", row: "front", slot: 3 },
    { id: "qin_ming", row: "front", slot: 4 },
  ],
  远程炮台: [
    { id: "song_wan", row: "front", slot: 0 },
    { id: "hua_rong", row: "back", slot: 0 },
    { id: "zhang_qing", row: "back", slot: 1 },
    { id: "gongsun_sheng", row: "back", slot: 2 },
    { id: "wu_yong", row: "back", slot: 3 },
  ],
  混编奶坦: [
    { id: "lu_zhishen", row: "front", slot: 0 },
    { id: "shi_yong", row: "front", slot: 1 },
    { id: "wu_song", row: "front", slot: 2 },
    { id: "an_daoquan", row: "back", slot: 0 },
    { id: "yan_qing", row: "back", slot: 1 },
  ],
};

for (const [name, formation] of Object.entries(FORMATIONS)) {
  test(`编队「${name}」可装配并打完一场`, () => {
    const teams = buildTeams({ ...csvs, playerFormation: formation, enemyFormation: MIRROR_ENEMY });
    assert.equal(teams.player.length, 5);
    for (const u of teams.player) {
      assert.ok(u.small && u.ult, `${u.name} 技能齐全`);
      assert.ok(u.row === "front" || u.row === "back");
    }
    const r = runBattle(teams, { autoUlt: true, maxT: 240 });
    assert.ok(r.winner === 0 || r.winner === 1, `应分出胜负（winner=${r.winner}, t=${r.t.toFixed(1)}s）`);
  });
}

test("slot 决定同排站位顺序", () => {
  const teams = buildTeams({ ...csvs, playerFormation: FORMATIONS.五近战, enemyFormation: MIRROR_ENEMY });
  const sim = new Sim(teams, 1);
  const fronts = sim.units.filter((u) => u.side === 0 && u.row === "front").sort((a, b) => a.z - b.z);
  assert.equal(fronts[0].slot, 0, "slot0 站最左");
  assert.equal(fronts[4].slot, 4, "slot4 站最右");
});

test("全 30 将装配：小技能/大招/觉醒齐全且零未知效果", () => {
  const all = [...csvUnits()];
  assert.equal(all.length, 30);
  for (const id of all) {
    const teams = buildTeams({
      ...csvs,
      playerFormation: [{ id, row: "front", slot: 0 }],
      enemyFormation: [{ id: "song_wan", row: "front", slot: 0 }],
    });
    const u = teams.player[0];
    assert.ok(u.small?.parsed.length > 0, `${u.name} 小技能`);
    assert.ok(u.ult?.parsed.length > 0, `${u.name} 大招`);
    assert.ok(u.passives.length === 2, `${u.name} 双被动`);
    assert.ok(u.awaken?.parsed.length > 0, `${u.name} 觉醒技`);
  }
});

function csvUnits() {
  return parseCsvTable(csvs.unitsCsv).map((r) => r.unit_id).filter((id) => id !== "yang_zhi_boss");
}
