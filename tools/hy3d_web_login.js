// 混元 3D 网页版（3d.hunyuan.tencent.com）登录助手。
//
// 为什么需要它：网页版强制登录，登录方式只有 微信扫码 / QQ / 邮箱验证码 三种，
// 无法绕过人工。本脚本用持久化 profile 启动有头浏览器，让用户扫码一次，
// 登录态（cookie/localStorage）落在 PROFILE 目录里，之后即可 headless 复用。
//
// 用法：node tools/hy3d_web_login.js [等待秒数]
// 退出码：0 = 已登录，2 = 等待超时
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
const PROFILE = path.join(os.homedir(), '.workbuddy/browser-profiles/hunyuan3d');
const HOME_URL = 'https://3d.hunyuan.tencent.com/';
const WAIT_SEC = Number(process.argv[2] || 300);

fs.mkdirSync(PROFILE, { recursive: true });

const ctx = await chromium.launchPersistentContext(PROFILE, {
  executablePath: EXE,
  headless: false,
  viewport: { width: 1440, height: 900 },
  args: ['--no-sandbox', '--hide-scrollbars'],
});

const page = ctx.pages()[0] || (await ctx.newPage());
console.log('[open] profile =', PROFILE);
await page.goto(HOME_URL, { waitUntil: 'load', timeout: 60000 });

// 该站是 SPA，未登录时由客户端再跳一次 / → /login。
// 必须等 URL 稳定后再判定，否则会把跳转前的 / 误判为「已登录」。
let prev = '';
for (let i = 0; i < 12; i++) {
  await page.waitForTimeout(1000);
  const cur = page.url();
  if (cur === prev) break;
  prev = cur;
}

const isLoggedIn = (u) => !u.includes('/login');
const deadline = Date.now() + WAIT_SEC * 1000;
let logged = isLoggedIn(page.url());
console.log(`[state] 初始 url = ${page.url()} → ${logged ? '已登录' : '待扫码登录'}`);

while (!logged && Date.now() < deadline) {
  await page.waitForTimeout(3000);
  logged = isLoggedIn(page.url());
  const left = Math.round((deadline - Date.now()) / 1000);
  console.log(`[wait] 剩余 ${left}s，url = ${page.url()}`);
}

if (logged) {
  await page.waitForTimeout(4000); // 让首页数据加载完
  await page.screenshot({ path: '/tmp/hy3d_logged_in.png' });
  console.log('[LOGGED_IN] url =', page.url());
  console.log('[text-begin]');
  console.log((await page.evaluate(() => document.body.innerText || '')).slice(0, 2000));
  console.log('[text-end]');
  await ctx.close();
  process.exit(0);
} else {
  console.log('[TIMEOUT] 未在限定时间内检测到登录');
  await ctx.close();
  process.exit(2);
}
