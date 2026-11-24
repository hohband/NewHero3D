// 「立即生成」点不动 —— 诊断脚本。
//
// 已确认的现象：上传 4 张多视图 + 选好面数后，clickText('立即生成') 返回命中，
// 但 10 秒后截图与点击前**逐字节相同**（md5 一致），弹窗仍开着，无任何请求发出。
//
// 本脚本一次性排掉以下可能：
//   A. 命中的元素不是真按钮（外层 wrapper / 被 pointer-events:none 覆盖）
//   B. 按钮处于 disabled 状态
//   C. 弹窗遮罩拦截了点击（程序化 el.click() 绕过命中测试，但真实鼠标不会）
//   D. 弹窗未关闭导致表单不认这批多视图图（需先关弹窗）
//
// 做法：dump 所有 innerText 恰为「立即生成」的元素（tag/class/深度/disabled/矩形），
// 然后用**真实鼠标**点最内层那个，全程记录 POST 请求与响应；若无反应则按 Esc 关弹窗再点一次。
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';

const require = createRequire('/Users/hohbandlee/.workbuddy/binaries/node/workspace/');
const { chromium } = require('playwright-core');

const EXE = path.join(
  os.homedir(),
  'Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'
);
const PROFILE = path.join(os.homedir(), '.workbuddy/browser-profiles/hunyuan3d');
const ORIGIN = 'https://3d.hunyuan.tencent.com';

const SLOT_ORDER = ['顶图', '左45°图', '正图', '右45°图', '左图', '右图', '背图', '底图'];
const R = (p) => path.resolve('/Users/hohbandlee/Projects/NewHero3D', p);
const PLAN = {
  '正图': R('assets/refs/lin_chong_front.png'),
  '背图': R('assets/refs/lin_chong_back.png'),
  '左45°图': R('assets/refs/lin_chong_left_front.png'),
  '右45°图': R('assets/refs/lin_chong_right_front.png'),
};

const md5 = (f) => crypto.createHash('md5').update(fs.readFileSync(f)).digest('hex');

const ctx = await chromium.launchPersistentContext(PROFILE, {
  executablePath: EXE,
  headless: true,
  viewport: { width: 1600, height: 1100 },
  args: ['--no-sandbox', '--hide-scrollbars'],
});
const page = ctx.pages()[0] || (await ctx.newPage());
const wait = (ms) => page.waitForTimeout(ms);

const MUT = [];
page.on('request', (r) => {
  if (r.method() !== 'GET' && r.method() !== 'OPTIONS') {
    MUT.push({ m: r.method(), u: r.url().slice(0, 200) });
    console.log(`[req] ${r.method()} ${r.url().slice(0, 160)}`);
  }
});
page.on('response', (r) => {
  if (r.request().method() !== 'GET' && r.request().method() !== 'OPTIONS') {
    console.log(`[res] ${r.status()} ${r.url().slice(0, 140)}`);
  }
});
const bodyText = () => page.evaluate(() => document.body.innerText || '');
const shot = (p) => page.screenshot({ path: p }).catch(() => {});

async function clickText(t) {
  const hit = await page.evaluate((tt) => {
    const all = [...document.querySelectorAll('button,a,[role=button],div,span')];
    let el = all.find((e) => (e.innerText || '').trim() === tt);
    if (!el) {
      const c = all.filter((e) => (e.innerText || '').includes(tt) && e.children.length <= 4);
      c.sort((a, b) => (a.innerText || '').length - (b.innerText || '').length);
      el = c[0];
    }
    if (!el) return null;
    el.click();
    return (el.innerText || '').trim().slice(0, 40);
  }, t).catch(() => null);
  await wait(2500);
  return hit;
}

// 找出所有 innerText 恰为目标的元素，从最内层开始列
async function findByText(t) {
  return page.evaluate((tt) => {
    const all = [...document.querySelectorAll('*')].filter((e) => (e.innerText || '').trim() === tt);
    return all.map((e) => {
      let d = 0;
      for (let p = e; (p = p.parentElement); ) d++;
      const b = e.getBoundingClientRect();
      const cs = getComputedStyle(e);
      return {
        tag: e.tagName,
        cls: ('' + (e.className || '')).slice(0, 70),
        depth: d,
        disabled: e.disabled === undefined ? null : e.disabled,
        pe: cs.pointerEvents,
        vis: cs.visibility,
        op: cs.opacity,
        rect: [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)],
        childTags: [...e.children].map((c) => c.tagName).join(','),
      };
    });
  }, t);
}

try {
  await page.goto(ORIGIN + '/', { waitUntil: 'load', timeout: 60000 });
  await wait(6000);
  if (page.url().includes('/login')) { console.log('[ABORT] 未登录'); await ctx.close(); process.exit(2); }
  console.log('[ok] 登录态有效');

  await clickText('立即开始');
  await clickText('多张图片');
  await clickText('添加多视图');
  const inputs = await page.$$('input[type=file]');
  console.log('[slots]', inputs.length);
  for (const [slot, file] of Object.entries(PLAN)) {
    await inputs[SLOT_ORDER.indexOf(slot)].setInputFiles(file);
    await wait(2500);
  }
  await wait(8000);
  await clickText('50k');
  await shot('/tmp/diag_pre.png');
  const pre = md5('/tmp/diag_pre.png');
  console.log('[pre] md5 =', pre);

  // ---- A/B: 按钮的 DOM 真相 ----
  const cands = await findByText('立即生成');
  console.log(`[button] innerText==="立即生成" 的元素共 ${cands.length} 个`);
  cands.forEach((c, i) =>
    console.log(`  #${i} <${c.tag}> depth=${c.depth} disabled=${c.disabled} pe=${c.pe} vis=${c.vis} op=${c.op} rect=${c.rect} childTags=[${c.childTags}] cls="${c.cls}"`)
  );
  const inner = cands.sort((a, b) => b.depth - a.depth)[0];
  if (!inner) { console.log('[FATAL] 找不到按钮'); await ctx.close(); process.exit(1); }
  console.log('[pick] 最内层 =', inner.tag, inner.rect);

  // ---- C: 真实鼠标点击（走命中测试，会被遮罩拦截） ----
  const [x, y, w, h] = inner.rect;
  console.log(`[mouse] click @(${x + w / 2}, ${y + h / 2})`);
  MUT.length = 0;
  await page.mouse.click(x + w / 2, y + h / 2);
  await wait(6000);
  await shot('/tmp/diag_after_mouse.png');
  const afterMouse = md5('/tmp/diag_after_mouse.png');
  console.log('[mouse] 截图 md5 =', afterMouse, '| 与点击前相同 =', afterMouse === pre);
  console.log('[mouse] 该次点击发出的非 GET 请求 =', JSON.stringify(MUT));
  console.log('[mouse] 页面文本片段 =\n' + (await bodyText()).slice(0, 400));
  if (afterMouse !== pre) { console.log('[RESULT] 真实鼠标点击**生效**'); await ctx.close(); process.exit(0); }

  // ---- C2: 元素中心点被谁挡着？ ----
  const top = await page.evaluate(
    ({ px, py }) => {
      const e = document.elementFromPoint(px, py);
      return e ? { tag: e.tagName, cls: ('' + (e.className || '')).slice(0, 70), txt: (e.innerText || '').trim().slice(0, 40) } : null;
    },
    { px: x + w / 2, py: y + h / 2 }
  );
  console.log('[hit-test] 该坐标最顶层元素 =', JSON.stringify(top));

  // ---- D: 关掉弹窗再点 ----
  console.log('[step] 按 Esc 关弹窗…');
  await page.keyboard.press('Escape');
  await wait(3000);
  await shot('/tmp/diag_after_esc.png');
  const afterEsc = md5('/tmp/diag_after_esc.png');
  console.log('[esc] 截图 md5 =', afterEsc, '| 与点击前相同 =', afterEsc === pre);
  if (afterEsc !== pre) {
    const c2 = await findByText('立即生成');
    const inn2 = c2.sort((a, b) => b.depth - a.depth)[0];
    if (inn2) {
      const [x2, y2, w2, h2] = inn2.rect;
      console.log(`[mouse2] click @(${x2 + w2 / 2}, ${y2 + h2 / 2}) (disabled=${inn2.disabled})`);
      MUT.length = 0;
      await page.mouse.click(x2 + w2 / 2, y2 + h2 / 2);
      await wait(6000);
      await shot('/tmp/diag_after_esc_click.png');
      const h3 = md5('/tmp/diag_after_esc_click.png');
      console.log('[mouse2] 截图 md5 =', h3, '| 与 esc 后相同 =', h3 === afterEsc);
      console.log('[mouse2] 非 GET 请求 =', JSON.stringify(MUT));
      console.log('[mouse2] 文本 =\n' + (await bodyText()).slice(0, 600));
    }
  }
  console.log('[DONE]');
} catch (e) {
  console.log('[ERROR]', e.message);
  await shot('/tmp/diag_error.png');
} finally {
  await ctx.close();
}
