// 混元 3D 网页版「图生3D · 多张图片」自动提交脚本。
//
// 前置：先用 tools/hy3d_web_login.js 扫码登录一次（登录态存在持久化 profile 里）。
//
// 用法：
//   node tools/hy3d_web_gen.js --front <正图> [--single] [--view back=<背图>] [--view left_front=<左45图>] ... \
//        [--faces 50k|500k|1m|1.5m] [--out <截图前缀.png>] [--dry] [--save <目录>] [--name <前缀>]
//
//   --single 走「单张图片」模式（页面默认模式，只有一个 input[type=file]）。
//            批量铺量用这个：§8.2 实测多视图增益 ≈ 0，多送 3 张纯属浪费。
//            只接受 --front 一张；多图模式的 8 槽语义校验一并跳过。
//   --dry    只走到「上传完成 + 设好参数」，不点「立即生成」，不消耗额度。
//   --save   生成完成后，把 viewer 加载模型的签名直链直接取回落盘（省去手点「下载」）。
//
// 关键（详见 hy3d_web_lib.js 顶部的坑记录）：
//   1) 点击必须用**真实鼠标事件**。页面上 innerText 为「立即生成」的有 DIV/BUTTON/SPAN 三层，
//      querySelectorAll 按文档序返回、朴素 find() 拿到最外层 DIV，而 onClick 在内层 BUTTON 上，
//      程序化 el.click() 点 DIV 不冒泡 → 完全静默（截图零变化、零请求）。
//   2) 网页版多视图弹窗是**带方位语义的 8 个固定槽位**，顺序固定为
//      槽0 顶图 │ 槽1 左45°图 │ 槽2 正图 │ 槽3 右45°图 │ 槽4 左图 │ 槽5 右图 │ 槽6 背图 │ 槽7 底图
//      每槽一个 hidden input[type=file]（multiple=false），必须按语义对号入座。
//   3) 约束：多图 Min2 / Max8 张；png/jpg/jpeg/webp；单张 ≤10M；分辨率 ≥128x128。
//      **单张模式没有 Min2 限制**（实测：2026-09-14，默认模式即单张，仅 1 个 file input）。
import fs from 'node:fs';
import path from 'node:path';
import { launch, clickText, bodyText, hookNetwork, lastPage, ORIGIN } from './hy3d_web_lib.js';

// 弹窗槽位顺序（与 DOM 中 input[type=file] 顺序一致，已实测）
const SLOT_ORDER = ['顶图', '左45°图', '正图', '右45°图', '左图', '右图', '背图', '底图'];
const SLOT_OF = {
  front: '正图', back: '背图', top: '顶图', bottom: '底图',
  left: '左图', right: '右图',
  left_front: '左45°图', right_front: '右45°图',
};

// ---- 参数 ----
const argv = process.argv.slice(2);
const opt = { views: {} };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--dry') { opt.dry = true; continue; }
  if (a === '--single') { opt.single = true; continue; }   // 布尔开关，不能走通用 --k v 解析
  if (a === '--view') {
    const [k, v] = (argv[++i] || '').split('=');
    if (!k || !v) { console.error('--view 需要 <type>=<path>'); process.exit(1); }
    if (!SLOT_OF[k]) { console.error(`未知视角 ${k}；可选 ${Object.keys(SLOT_OF)}`); process.exit(1); }
    opt.views[k] = v;
    continue;
  }
  if (a.startsWith('--')) { opt[a.slice(2)] = argv[++i]; continue; }
}
const faces = opt.faces || '50k';
const out = opt.out || '/tmp/hy3d_gen.png';
if (!opt.front) { console.error('需要 --front <正图>'); process.exit(1); }

// 组装「槽位名 → 文件」计划
const plan = {};
const add = (viewKey, file) => {
  const slot = SLOT_OF[viewKey];
  const abs = path.resolve(file);
  if (!fs.existsSync(abs)) { console.error('文件不存在:', abs); process.exit(1); }
  const kb = fs.statSync(abs).size / 1024;
  if (kb > 10240) { console.error(`超过 10MB 上限: ${abs} (${kb.toFixed(0)}KB)`); process.exit(1); }
  plan[slot] = abs;
};
add('front', opt.front);
for (const [k, v] of Object.entries(opt.views)) add(k, v);

const total = Object.keys(plan).length;
console.log(`[input] 共 ${total} 张，模式 ${opt.single ? '单张图片' : '多张图片'}，面数档 ${faces}，dry=${!!opt.dry}`);
for (const [slot, file] of Object.entries(plan)) {
  console.log(`  槽「${slot}」(index ${SLOT_ORDER.indexOf(slot)}) ← ${path.basename(file)}`);
}
if (opt.single) {
  // 单张模式：只允许正图一张，跳过 8 槽语义校验
  if (total !== 1 || !plan['正图']) { console.error('单图模式只接受 --front 一张，不能带 --view'); process.exit(1); }
} else if (total < 2) {
  console.error('多图模式至少 2 张'); process.exit(1);
}

const ctx = await launch({ downloadsPath: opt.save ? path.resolve(opt.save) : undefined });
let page = lastPage(ctx);
const URLS = hookNetwork(page);
ctx.on('page', (p) => hookNetwork(p));
const wait = (ms) => page.waitForTimeout(ms);
const shot = (f) => page.screenshot({ path: f }).catch(() => {});

try {
  await page.goto(ORIGIN + '/', { waitUntil: 'load', timeout: 60000 });
  await wait(6000);
  if (page.url().includes('/login')) {
    console.log('[ABORT] 登录态失效，请先跑 tools/hy3d_web_login.js 扫码');
    await ctx.close();
    process.exit(2);
  }
  console.log('[ok] 登录态有效');

  console.log('[step] 进入 图/文生3D →', JSON.stringify(await clickText(page, ctx, '立即开始')));
  page = lastPage(ctx);

  let inputs;
  if (opt.single) {
    // 单张模式是页面默认模式，点一下确保状态（幂等）
    console.log('[step] 确认「单张图片」模式 →', JSON.stringify(await clickText(page, ctx, '单张图片')));
    page = lastPage(ctx);
    await wait(2000);
    inputs = await page.$$('input[type=file]');
    console.log('[slots] 单张模式 file input 数 =', inputs.length);
    if (inputs.length < 1) throw new Error(`单张模式未找到 file input（实际 ${inputs.length}）`);
    await inputs[0].setInputFiles(plan['正图']);
    await wait(6000);
    console.log(`[upload] 单张 ← ${path.basename(plan['正图'])}`);
  } else {
    console.log('[step] 切到 多张图片 →', JSON.stringify(await clickText(page, ctx, '多张图片')));
    page = lastPage(ctx);
    console.log('[step] 打开多视图弹窗 →', JSON.stringify(await clickText(page, ctx, '添加多视图')));
    page = lastPage(ctx);

    inputs = await page.$$('input[type=file]');
    console.log('[slots] 弹窗 file input 数 =', inputs.length);
    if (inputs.length < 8) throw new Error(`槽位数量异常：期望 ≥8，实际 ${inputs.length}`);

    for (const [slot, file] of Object.entries(plan)) {
      const idx = SLOT_ORDER.indexOf(slot);
      await inputs[idx].setInputFiles(file);
      await wait(2500);
      console.log(`[upload] 槽${idx}「${slot}」← ${path.basename(file)}`);
    }
    await wait(10000);

    const t0 = await bodyText(page);
    const stillEmpty = [...t0.matchAll(/上传(顶图|左45°图|正图|右45°图|左图|右图|背图|底图)/g)].map((m) => m[1]);
    console.log('[verify] 仍显示「上传X」的空槽 =', stillEmpty.join(',') || '(无)');
    console.log('[verify] 已填充槽位 =', SLOT_ORDER.filter((s) => !stillEmpty.includes(s)).join(',') || '(无)');
  }
  await wait(3000);

  console.log(`[step] 选择面数 ${faces} →`, JSON.stringify(await clickText(page, ctx, faces)));
  page = lastPage(ctx);
  await shot(out);
  console.log('[shot]', out);

  if (opt.dry) {
    console.log('[DRY] 到此为止，未点击「立即生成」，未消耗额度。');
    await ctx.close();
    process.exit(0);
  }

  console.log('[step] 点「立即生成」…');
  const gen = await clickText(page, ctx, '立即生成', { waitMs: 8000 });
  page = lastPage(ctx);
  console.log('[gen] 结果 =', JSON.stringify(gen));
  if (!gen) throw new Error('没找到「立即生成」按钮');
  await shot(out.replace(/\.png$/, '_submitted.png'));
  const tSubmit = await bodyText(page);
  console.log('[text-after-submit]', tSubmit.slice(0, 600).replace(/\n{2,}/g, '\n'));
  if (/额度|已用完|上限|超出/.test(tSubmit)) console.log('[WARN] 页面出现额度相关文案，检查是否已被限流');

  // 轮询到出现「下载」入口或进度 100%
  const deadline = Date.now() + 20 * 60 * 1000;
  let done = false;
  while (Date.now() < deadline) {
    await wait(15000);
    page = lastPage(ctx);
    const t = await bodyText(page);
    const left = Math.round((deadline - Date.now()) / 1000);
    const q = (t.match(/前方\s*(\d+)\s*个任务/) || [])[1];
    const prog = (t.match(/(\d+)%/g) || []).slice(-2).join(',');
    console.log(`[poll] 剩余 ${left}s${q ? ` 排队前方${q}个` : ''} 进度=${prog || '-'} 直链=${URLS.size}`);
    if (/下载|导出/.test(t)) { done = true; break; }
  }
  await shot(out.replace(/\.png$/, '_done.png'));
  console.log(done ? '[DONE] 检测到下载入口' : '[TIMEOUT] 未检测到完成');
  console.log('[final-text]', (await bodyText(page)).slice(0, 800).replace(/\n{2,}/g, '\n'));

  if (done && opt.save) {
    const OUT = path.resolve(opt.save);
    fs.mkdirSync(OUT, { recursive: true });
    const extOf = (u) => (u.match(/\.(glb|gltf|obj|zip|fbx|usdz|stl)(?=[?#]|$)/i) || ['.bin'])[0].toLowerCase();
    let i = 0;
    for (const u of URLS) {
      const resp = await ctx.request.get(u).catch(() => null);
      if (!resp || !resp.ok()) { console.log(`[http] 取回失败(${resp ? resp.status() : 'err'}): ${u.slice(0, 120)}`); continue; }
      const buf = await resp.body();
      const dest = path.join(OUT, `${opt.name || 'hy3d'}${i === 0 ? '' : '.' + i}${extOf(u)}`);
      fs.writeFileSync(dest, buf);
      console.log(`[SAVED] ${dest} (${(buf.length / 1024).toFixed(0)} KB)`);
      i++;
    }
  }
  console.log(`[urls] 共捕获 ${URLS.size} 条可疑直链`);
  for (const u of URLS) console.log('  ' + u.slice(0, 300));
} catch (e) {
  console.log('[ERROR]', e.message);
  await shot(out.replace(/\.png$/, '_error.png'));
} finally {
  await ctx.close();
}
