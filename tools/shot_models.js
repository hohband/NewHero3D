// 无头截图：批量给 model-viewer.html 出图（playwright-core + 缓存 Chromium）
// 用法：node tools/shot_models.js <baseUrl> <out1.png> <query1> [<out2.png> <query2> ...]
//   query 形如 "m=assets/models/lin_chong.glb&anim=attack&t=0.3"
// 依赖 ~/.workbuddy/skills/webgl-headless-screenshot 记录的组合；页面需暴露 window.__viewerReady。
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

const [base, ...rest] = process.argv.slice(2);
const jobs = [];
for (let i = 0; i + 1 < rest.length; i += 2) jobs.push({ out: rest[i], query: rest[i + 1] });

const browser = await chromium.launch({
  executablePath: EXE,
  args: ['--no-sandbox', '--disable-gpu-sandbox', '--enable-unsafe-swiftshader', '--hide-scrollbars'],
});
const page = await browser.newPage({ viewport: { width: 1000, height: 1250 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('[console.error]', m.text()); });

for (const { out, query } of jobs) {
  const url = `${base}/model-viewer.html?${query}`;
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__viewerReady === true, null, { timeout: 90000 });
  await page.waitForTimeout(600);
  const info = await page.evaluate(() => window.__viewerInfo());
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await page.screenshot({ path: out });
  console.log('[shot]', out, JSON.stringify(info));
}

await browser.close();
console.log('SHOTS_DONE');
