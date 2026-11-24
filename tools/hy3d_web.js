// 混元 3D 网页版操作脚本（复用持久化登录态，headless 不弹窗）。
//
// 登录态来自 tools/hy3d_web_login.js 的扫码结果，存在 ~/.workbuddy/browser-profiles/hunyuan3d。
//
// 用法：
//   node tools/hy3d_web.js probe <url> <out.png> [waitMs]
//   node tools/hy3d_web.js links <url>
//   node tools/hy3d_web.js flow  <url> "<点1,点2,...>" <out.png> [每步等待ms]
//     flow 按顺序点击指定文本，每步后自动跟进新开标签页（SPA 内部切换则 URL 不变）。
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

const require = createRequire('/Users/hohbandlee/.workbuddy/binaries/node/workspace/');
const { chromium } = require('playwright-core');

const EXE = path.join(
  os.homedir(),
  'Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'
);
const PROFILE = path.join(os.homedir(), '.workbuddy/browser-profiles/hunyuan3d');
const ORIGIN = 'https://3d.hunyuan.tencent.com';

const [action, ...rest] = process.argv.slice(2);
const url = rest[0] || ORIGIN + '/';
const stepMs = Number(rest[3] || 2500);

const ctx = await chromium.launchPersistentContext(PROFILE, {
  executablePath: EXE,
  headless: true,
  viewport: { width: 1600, height: 1100 },
  args: ['--no-sandbox', '--hide-scrollbars'],
});

let page = ctx.pages()[0] || (await ctx.newPage());

async function clickText(t) {
  const before = ctx.pages().length;
  const hit = await page.evaluate((tt) => {
    const all = [...document.querySelectorAll('button,a,[role=button],div,span')];
    let el = all.find((e) => (e.innerText || '').trim() === tt);
    if (!el) {
      const cands = all.filter((e) => (e.innerText || '').includes(tt) && e.children.length <= 4);
      cands.sort((a, b) => (a.innerText || '').length - (b.innerText || '').length);
      el = cands[0];
    }
    if (!el) return false;
    el.click();
    return (el.innerText || '').trim().slice(0, 40);
  }, t).catch(() => false);
  await page.waitForTimeout(stepMs);
  const pages = ctx.pages();
  if (pages.length > before) page = pages[pages.length - 1];
  return hit;
}

async function dumpText(max = 1600) {
  const body = await page.evaluate(() => document.body.innerText || '');
  console.log('[url]', page.url());
  console.log('[text]', body.slice(0, max).replace(/\n{2,}/g, '\n'));
}

async function dumpFileInputs() {
  const files = await page.evaluate(() =>
    [...document.querySelectorAll('input[type=file]')].map((el, i) => ({
      i, accept: el.accept || '', multiple: el.multiple, hidden: el.offsetParent === null,
    }))
  );
  console.log('[file-inputs]', JSON.stringify(files));
}

try {
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  const initialWait = action === 'probe' && rest[2] ? Number(rest[2]) : 6000;
  await page.waitForTimeout(initialWait);
  const ok = !page.url().includes('/login') && !page.url().includes('/scan');
  console.log('[登录态]', ok ? '有效' : '失效（需重新扫码）');

  if (action === 'links') {
    const links = await page.evaluate(() => {
      const o = 'https://3d.hunyuan.tencent.com';
      return [...new Set([...document.querySelectorAll('a[href]')].map((a) => a.href).filter((h) => h.startsWith(o)))];
    });
    console.log('[links]', JSON.stringify(links, null, 1));

  } else if (action === 'flow') {
    for (const t of (rest[1] || '').split(',').map((s) => s.trim()).filter(Boolean)) {
      const hit = await clickText(t);
      console.log(`[step] 点击「${t}」→ ${hit ? '命中' : '未找到'}`);
    }
    if (rest[2]) await page.screenshot({ path: rest[2] });
    await dumpText();
    await dumpFileInputs();

  } else {
    if (rest[1]) await page.screenshot({ path: rest[1] });
    await dumpText(1500);
  }
} catch (e) {
  console.log('[ERROR]', e.message);
} finally {
  await ctx.close();
}
