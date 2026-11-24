// 只读探针：摸清混元 3D 网页版「图生3D · 单张图片」模式的 DOM 结构。
// 目的：为 hy3d_web_gen.js 补一条单图路径（现脚本第 69 行硬性要求 ≥2 张）。
// 不点「立即生成」，不消耗额度。
//
// 用法：node tools/hy3d_web_single_probe.js [--headed]
import { launch, clickText, bodyText, lastPage } from './hy3d_web_lib.js';

const HEADED = process.argv.includes('--headed');
const ctx = await launch({ headless: !HEADED });
let page = lastPage(ctx);
const wait = (ms) => page.waitForTimeout(ms);
const shot = (f) => page.screenshot({ path: f }).catch(() => {});

const dumpInputs = async (tag) => {
  const info = await page.evaluate(() => {
    const ins = [...document.querySelectorAll('input[type=file]')];
    return ins.map((el, i) => {
      // 向上找 4 层，收集可读文案，用于判断这个 input 属于哪个区域
      let up = el, texts = [];
      for (let k = 0; k < 5 && up; k++) {
        up = up.parentElement;
        if (!up) break;
        const t = (up.innerText || '').trim().replace(/\s+/g, ' ');
        if (t) texts.push(t.slice(0, 60));
      }
      return {
        i,
        multiple: el.multiple,
        accept: el.accept || '(无)',
        hidden: el.offsetParent === null,
        w: Math.round(el.getBoundingClientRect().width),
        h: Math.round(el.getBoundingClientRect().height),
        context: texts.slice(0, 2),
      };
    });
  });
  console.log(`[inputs:${tag}] 共 ${info.length} 个 input[type=file]`);
  for (const r of info) console.log('   ', JSON.stringify(r));
  return info;
};

try {
  await page.goto('https://3d.hunyuan.tencent.com/', { waitUntil: 'load', timeout: 60000 });
  await wait(6000);
  if (page.url().includes('/login')) {
    console.log('[ABORT] 登录态失效，请先跑 tools/hy3d_web_login.js 扫码');
    await ctx.close();
    process.exit(2);
  }
  console.log('[ok] 登录态有效, url =', page.url());

  console.log('[before] 首页可点击文案：');
  await shot('/tmp/hy3d_single_0_home.png');

  console.log('[step] 点「立即开始」→', JSON.stringify(await clickText(page, ctx, '立即开始')));
  page = lastPage(ctx);
  await wait(4000);
  console.log('[page] url =', page.url());
  const t1 = await bodyText(page);
  console.log('[text@gen 页] ', t1.slice(0, 900).replace(/\n{2,}/g, '\n'));
  await shot('/tmp/hy3d_single_1_gen.png');
  await dumpInputs('默认(未切模式)');

  console.log('[step] 点「单张图片」→', JSON.stringify(await clickText(page, ctx, '单张图片')));
  page = lastPage(ctx);
  await wait(4000);
  const t2 = await bodyText(page);
  console.log('[text@单张模式] ', t2.slice(0, 900).replace(/\n{2,}/g, '\n'));
  await shot('/tmp/hy3d_single_2_single.png');
  await dumpInputs('单张模式');

  // 面数档与模型版本的可选项
  const opts = await page.evaluate(() => {
    const out = [];
    for (const sel of document.querySelectorAll('[class*=radio],[class*=tab],[class*=seg],[class*=option],[class*=select]')) {
      const t = (sel.innerText || '').trim().replace(/\s+/g, ' ');
      if (t && t.length < 120) out.push(t);
    }
    return [...new Set(out)].slice(0, 40);
  });
  console.log('[可选项候选] ', JSON.stringify(opts, null, 1));
} catch (e) {
  console.log('[ERROR]', e.message);
  await shot('/tmp/hy3d_single_error.png');
} finally {
  await ctx.close();
}
