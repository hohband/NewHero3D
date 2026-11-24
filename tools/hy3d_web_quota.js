// 混元 3D 网页版：查剩余额度（只读，不消耗额度）。
//
// 背景：内置技能路径的 `hy-3d` 额度**没有查询接口**（buddy-cloud.py 里没有 quota 相关函数），
// 只能靠提交时返回的 429「daily submit limit exceeded (n/5)」反推，粒度粗且要真提交一次。
// 网页版则可以在首页直接读到 —— 顶栏常驻一个数字，且页面加载时会请求 /api/3d/quotainfo。
//
// 用法：node tools/hy3d_web_quota.js [--raw]
//   --raw  额外打印 quotainfo 的原始 JSON
//
// 【踩坑】未登录时 `/` 会再跳一次 `/login`，判定登录态必须**等 URL 稳定**。
import { launch, lastPage, bodyText, ORIGIN } from './hy3d_web_lib.js';

const argv = process.argv.slice(2);
const raw = argv.includes('--raw');

const ctx = await launch();
const page = lastPage(ctx);
const wait = (ms) => page.waitForTimeout(ms);

// 页面自己会 POST /api/3d/quotainfo，挂监听等它
const quotaJson = new Promise((resolve) => {
  let done = false;
  const h = async (r) => {
    if (done || !/quotainfo/.test(r.url())) return;
    try {
      if (!/json/i.test(r.headers()['content-type'] || '')) return;
      const j = JSON.parse(await r.text());
      done = true;
      page.off('response', h);
      resolve(j);
    } catch {}
  };
  page.on('response', h);
  setTimeout(() => { if (!done) { done = true; resolve(null); } }, 30000);
});

try {
  await page.goto(ORIGIN + '/', { waitUntil: 'load', timeout: 60000 });
  // 等 URL 稳定（SPA 可能再跳一次 /login）
  let prev = '';
  for (let i = 0; i < 12; i++) {
    await wait(1000);
    const cur = page.url();
    if (cur === prev) break;
    prev = cur;
  }
  if (page.url().includes('/login')) {
    console.log('[ABORT] 登录态失效，请先跑 tools/hy3d_web_login.js 扫码');
    await ctx.close();
    process.exit(2);
  }

  const t = await bodyText(page);
  const head = t.split('\n').slice(0, 6);
  // 顶栏形如：腾讯混元3D / 3D创作 / 资产 / API / 20
  const nums = head.map((s) => s.trim()).filter((s) => /^\d+$/.test(s));
  console.log('[顶栏]', head.map((s) => s.trim()).filter(Boolean).join(' | '));
  console.log('[网页版剩余额度]', nums.length ? nums[nums.length - 1] + ' 次/天' : '(没在顶栏读到数字，用 --raw 看接口)');

  const q = await quotaJson;
  if (q) {
    console.log('[quotainfo]', JSON.stringify(q));
    if (raw) console.log('[quotainfo:raw]', JSON.stringify(q, null, 2));
  } else {
    console.log('[quotainfo] 没抓到该接口响应');
  }
  console.log('[DONE] 未消耗额度');
} catch (e) {
  console.log('[ERROR]', e.message);
} finally {
  await ctx.close();
}
