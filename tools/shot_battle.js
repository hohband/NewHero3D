// 战场截图：给 battle-proto.html 注入指定编队（与关卡）后截图
// 用法：node tools/shot_battle.js <baseUrl> <out.png> [waitMs] [id1,id2,...] [level] [timesMs]
//   - id 列表：单位按顺序自动排位，前 3 个前排（slot 0/1/2），其余进后排（slot 0/1/2…）。
//     不传则用「最初 5 个真模型」做回归。
//   - level：默认 story_01。关卡由 localStorage 的 shuihu3d_pending_level 决定。
//   - timesMs：可选，逗号分隔的额外采样时刻（相对页面 load），例如 "6000,14000,22000"
//     —— 用来抓多波次关卡的**第二波**（波次推进靠时间，单张截图抓不稳）。
//
// 两侧都会出放大裁切（战场是广角镜头，模型只有几十像素）：
//   <out>-zoom.png   = 我方半场      <out>-enemy.png = 敌方半场
//   2026-09-15 补敌方侧：此前只裁 .bars:not(.enemy)，导致「敌将是胶囊还是有模型」根本看不出来，
//   而第三批的验收对象恰恰全是敌方单位（story_01 / story_02 的出场单位）。
//
// 依赖 webgl-headless-screenshot 记录的 playwright-core + 缓存 Chromium 组合。
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const require = createRequire('/Users/hohbandlee/.workbuddy/binaries/node/workspace/');
const { chromium } = require('playwright-core');

const EXE = path.join(
  os.homedir(),
  'Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'
);

const [base, out, waitMsArg, idsArg, levelArg, timesArg] = process.argv.slice(2);
const waitMs = Number(waitMsArg || 9000);
const LEVEL = (levelArg && levelArg.trim()) || 'story_01';
const EXTRA_TIMES = (timesArg || '')
  .split(',')
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isFinite(n) && n > 0)
  .sort((a, b) => a - b);

// 默认 = 最初 5 个真模型（回归基线）
const DEFAULT_IDS = ['lu_zhishen', 'lin_chong', 'wu_song', 'shi_qian', 'hua_rong'];
const IDS = (idsArg ? idsArg.split(',').map((s) => s.trim()).filter(Boolean) : DEFAULT_IDS);
const FORMATION = IDS.map((id, i) => (i < 3
  ? { id, row: 'front', slot: i }
  : { id, row: 'back', slot: i - 3 }));

const browser = await chromium.launch({
  executablePath: EXE,
  args: ['--no-sandbox', '--disable-gpu-sandbox', '--enable-unsafe-swiftshader', '--hide-scrollbars'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('[console.error]', m.text()); });
page.on('requestfailed', (r) => console.log('[reqfail]', r.url().split('/').pop(), r.failure()?.errorText));
// 记录每个 .glb 的返回码：这是「模型是否真的被加载」的硬证据（缺失/解析失败会静默回退胶囊）
const glbStatus = {};
page.on('response', (r) => {
  const u = r.url();
  if (u.includes('.glb')) glbStatus[u.split('/').pop()] = r.status();
});
const notFound = [];
page.on('response', (r) => { if (r.status() === 404) notFound.push(r.url()); });

const url = `${base}/battle-proto.html`;
// 第 1 次加载：让页面按 units.csv 自建新档（保证 schema 正确）
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(2500);

const patched = await page.evaluate(({ formation, level }) => {
  const KEY = 'shuihu3d_save_v1';
  const raw = localStorage.getItem(KEY);
  if (!raw) return 'NO_SAVE';
  const save = JSON.parse(raw);
  // 为新编队里缺失的单位补一条 roster 记录，结构照抄已有条目
  const tpl = Object.values(save.roster)[0] || { level: 1, tier: 0, skill: { small: 1, ult: 1 }, exp: 0 };
  for (const f of formation) if (!save.roster[f.id]) save.roster[f.id] = JSON.parse(JSON.stringify(tpl));
  save.formation = formation;
  localStorage.setItem(KEY, JSON.stringify(save));
  localStorage.setItem('shuihu3d_pending_level', level);
  return `level=${level} formation=${save.formation.map((f) => f.id).join(',')}`;
}, { formation: FORMATION, level: LEVEL });
console.log('[patch]', patched);

// 同时抓两侧的放大裁切（各裁一次，复用同一个 clip 计算函数）
async function sideClip(sel) {
  return page.evaluate((s) => {
    const rs = [...document.querySelectorAll(s)].map((e) => e.getBoundingClientRect());
    if (!rs.length) return null;
    const x0 = Math.min(...rs.map((r) => r.left)) - 70;
    const x1 = Math.max(...rs.map((r) => r.right)) + 70;
    const y0 = Math.min(...rs.map((r) => r.top));
    return {
      x: Math.max(0, x0), y: Math.max(0, y0),
      width: Math.min(1280, x1) - Math.max(0, x0),
      height: Math.min(800, y0 + 340) - y0,
    };
  }, sel);
}

async function shoot(tag) {
  const info = await page.evaluate(() => ({
    title: document.getElementById('battleTitle')?.textContent,
    bars: [...document.querySelectorAll('.bars .name')].map((e) => e.textContent),
    log: [...document.querySelectorAll('#log div')].slice(-6).map((e) => e.textContent),
  }));
  console.log(`[battle${tag}]`, JSON.stringify(info));
  const png = tag ? out.replace(/\.png$/, `-${tag}.png`) : out;
  await page.screenshot({ path: png });
  console.log('[shot]', png);
  for (const [suffix, sel] of [['zoom', '.bars:not(.enemy)'], ['enemy', '.bars.enemy']]) {
    const clip = await sideClip(sel);
    if (clip && clip.width > 20 && clip.height > 20) {
      const p = png.replace(/\.png$/, `-${suffix}.png`);
      await page.screenshot({ path: p, clip });
      console.log('[shot]', p, JSON.stringify(clip));
    } else {
      console.log(`[shot] (无 ${suffix} 侧可见单位，跳过裁切)`);
    }
  }
}

// 第 2 次加载：按注入的编队与关卡开战
await page.goto(url, { waitUntil: 'load' });

let prev = 0;
for (const t of EXTRA_TIMES) {
  await page.waitForTimeout(Math.max(0, t - prev));
  prev = t;
  await shoot(`t${t}`);
}
await page.waitForTimeout(Math.max(0, waitMs - prev));
await shoot('');
console.log('[glb]', JSON.stringify(glbStatus));
console.log('[404]', JSON.stringify([...new Set(notFound)].map((u) => u.replace(base, ''))));
await browser.close();
console.log('SHOT_BATTLE_DONE');
