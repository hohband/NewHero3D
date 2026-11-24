// 探查脚本：用无头 Chromium 打开目标页，截图并抓取可见文本/交互元素。
// 用法：node tools/probe_page.js <url> <out.png> [等待毫秒] [点击文本]
// 复用 tools/shot_models.js 同款 playwright-core + 本地 Chromium 缓存，无需额外下载。
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

const require = createRequire('/Users/hohbandlee/.workbuddy/binaries/node/workspace/');
const { chromium } = require('playwright-core');

const EXE = path.join(
  os.homedir(),
  'Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'
);

const [url, out, waitMs = '5000', clickText] = process.argv.slice(2);
if (!url || !out) {
  console.error('usage: node tools/probe_page.js <url> <out.png> [waitMs] [clickText]');
  process.exit(1);
}

const browser = await chromium.launch({
  executablePath: EXE,
  args: ['--no-sandbox', '--disable-gpu-sandbox', '--enable-unsafe-swiftshader', '--hide-scrollbars'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 200)); });

try {
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(Number(waitMs));
  if (clickText) {
    const clicked = await page.evaluate((t) => {
      const el = [...document.querySelectorAll('button,a,[role=button],span,div')]
        .find((e) => (e.innerText || '').trim() === t);
      if (el) { el.click(); return true; }
      return false;
    }, clickText);
    console.log('[click]', JSON.stringify(clickText), clicked);
    await page.waitForTimeout(Number(waitMs));
  }
  await page.screenshot({ path: out });
  console.log('[final-url]', page.url());
  console.log('[title]', await page.title());
  const text = await page.evaluate(() => document.body.innerText || '');
  console.log('[text-begin]');
  console.log(text.slice(0, 2500));
  console.log('[text-end]');
  const inputs = await page.evaluate(() =>
    [...document.querySelectorAll('input,button,a[href],[role=button]')]
      .slice(0, 40)
      .map((el) => `${el.tagName.toLowerCase()}${el.type ? '[' + el.type + ']' : ''} "${(el.innerText || el.placeholder || el.value || '').trim().slice(0, 40)}"`)
  );
  console.log('[interactive]', JSON.stringify(inputs, null, 1));
  const frames = page.frames().map((f) => f.url()).filter((u) => u && u !== 'about:blank');
  console.log('[frames]', JSON.stringify([...new Set(frames)], null, 1));
} catch (e) {
  console.log('[ERROR]', e.message);
} finally {
  if (errors.length) console.log('[page-errors]', errors.slice(0, 8).join(' | '));
  await browser.close();
}
