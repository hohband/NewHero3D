// 混元 3D 网页版：把生成结果抓回本地。
//
// 前置：已用 tools/hy3d_web_login.js 扫码登录（登录态在持久化 profile 里）。
// 注意：同一 profile 不能并发启动两个浏览器（Chromium 单例锁），gen 脚本跑完退出后再跑本脚本。
//
// 用法：
//   node tools/hy3d_web_fetch.js pull --out <目录> --name <前缀> [--id <creationUUID>] [--timeout 900]
//   node tools/hy3d_web_fetch.js list                            # 探路：资产页可点元素 + 截图
//   node tools/hy3d_web_fetch.js grab --out <目录> [--name <前缀>]  # 兜底：走 UI 点「下载」
//
// ==== pull（首选，不碰 UI）====
// 资产页会请求 POST /api/3d/creations/list，响应 JSON 里**直接带签名 COS 直链**：
//   {"totalCount":1,"creations":[{"id":"3ac137dc-…","modelType":"multiView2ModelV3.1",
//     "modelUrl3d":{},"imageList":[4 张输入图直链],…}]}
// 生成中 modelUrl3d 是空对象，纹理跑完后填入 .glb 直链。
// 所以每轮 reload 抓一次 list JSON → 深度扫出结果直链 → 用 ctx.request 带会话 cookie 取回。
// 这条路径不依赖任何按钮文案/坐标，页面改版也不容易崩。
//
// 【踩坑】顶栏「资产」点了不跳转（SPA 导航问题），必须先 goto /assets 再看内容。
// 【踩坑】JSON 里的 URL 带 \u0026/\ / 转义，提取时正则不能排除反斜杠，否则签名参数被截断。
import fs from 'node:fs';
import path from 'node:path';
import {
  launch, clickText, bodyText, dumpClickables, hookNetwork, lastPage, waitJson, deepFindUrls, briefFields, ORIGIN,
} from './hy3d_web_lib.js';

const argv = process.argv.slice(2);
const cmd = argv[0] || 'pull';
const opt = { out: '/tmp', name: 'hy3d' };
for (let i = 1; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) opt[a.slice(2)] = argv[++i];
}
const OUT = path.resolve(opt.out);
const wait = (p, ms) => p.waitForTimeout(ms);
const shot = (p, f) => p.screenshot({ path: f }).catch(() => {});

const ctx = await launch({ downloadsPath: OUT });
let page = lastPage(ctx);
const URLS = hookNetwork(page);
ctx.on('page', (p) => hookNetwork(p));

/** 在一个时间窗口内收集所有匹配的 JSON 响应（页面可能连发多次 list/count）。 */
function collectJson(p, re, windowMs) {
  const acc = [];
  const h = async (r) => {
    try {
      if (!re.test(r.url())) return;
      if (!/json/i.test(r.headers()['content-type'] || '')) return;
      acc.push(JSON.parse(await r.text()));
    } catch {}
  };
  p.on('response', h);
  return new Promise((res) => setTimeout(() => { p.off('response', h); res(acc); }, windowMs));
}

async function downloadAll(items, skip = new Set()) {
  let n = 0;
  for (const [u, label] of items) {
    if (skip.has(u)) continue;
    const ext = (u.match(/\.(glb|gltf|obj|zip|fbx|usdz|stl|png|jpg|jpeg|webp)(?=[?#]|$)/i) || ['.bin'])[0].toLowerCase();
    const dest = path.join(OUT, `${opt.name}${label ? '.' + label : n === 0 ? '' : '_' + n}${ext}`);
    const resp = await ctx.request.get(u).catch(() => null);
    if (!resp || !resp.ok()) { console.log(`[http] 取回失败(${resp ? resp.status() : 'err'}): ${u.slice(0, 110)}`); continue; }
    const buf = await resp.body();
    fs.writeFileSync(dest, buf);
    console.log(`[SAVED] ${dest}  (${(buf.length / 1024).toFixed(0)} KB)`);
    n++;
  }
  return n;
}

// urlResult 字段 → 落盘后缀名（按优先级；textureGlb 是带 PBR 纹理的成品）
const PICK = [
  ['textureGlb', ''],
  ['glb', ''],
  ['geometryGlb', 'geometry'],
  ['textureObj', 'objzip'],
  ['obj_url', 'obj'],
  ['mtl', 'mtl'],
  ['image_url', 'preview'],
  ['pbrImage', 'pbr'],
  ['pbrNormalImage', 'pbr_normal'],
  ['pbrRoughnessImage', 'pbr_roughness'],
  ['pbrMetallicImage', 'pbr_metallic'],
];

/** 从一次 creation 记录里挑出该下载的文件（按字段名精确取，失败再退回深度扫描）。 */
function pickFiles(c) {
  const items = [];
  const seenUrl = new Set();
  const add = (u, label) => {
    if (typeof u !== 'string' || !u || seenUrl.has(u)) return;
    seenUrl.add(u);
    items.push([u, label]);
  };
  const ur = c?.result?.[0]?.urlResult || {};
  for (const [k, label] of PICK) if (ur[k]) add(ur[k], label);
  // 兜底：schema 变了就退回深度扫描（注意 URL 带 ?q-sign-… 查询串，扩展名判定必须允许后面跟 ?/#）
  if (!items.length) for (const u of deepFindUrls(c)) add(u, '');
  return items;
}

/** 结果是否已就绪：有 status=success 且拿到了 glb/zip。 */
function isReady(c, items) {
  const st = c?.result?.[0]?.status || c?.status;
  return st === 'success' && items.some(([u]) => /\.(glb|obj|zip)(?=[?#]|$)/i.test(u));
}

try {
  page = lastPage(ctx);
  await page.goto(ORIGIN + '/', { waitUntil: 'load', timeout: 60000 });
  await wait(page, 5000);
  if (page.url().includes('/login')) {
    console.log('[ABORT] 登录态失效，请先跑 tools/hy3d_web_login.js');
    await ctx.close();
    process.exit(2);
  }
  console.log('[ok] 登录态有效');

  if (cmd === 'pull') {
    fs.mkdirSync(OUT, { recursive: true });
    const deadline = Date.now() + Number(opt.timeout || 900) * 1000;
    let round = 0;
    let saved = 0;
    while (Date.now() < deadline) {
      round++;
      const collect = collectJson(page, /\/api\/3d\/creations\/list/, 25000);
      if (round === 1) await page.goto(ORIGIN + '/assets', { waitUntil: 'load', timeout: 60000 }).catch(() => {});
      else await page.reload({ waitUntil: 'load', timeout: 60000 }).catch(() => {});
      const all = await collect;

      const withItems = all.filter((j) => Array.isArray(j.creations) && j.creations.length);
      const list = withItems.length ? withItems[withItems.length - 1] : null;
      const t = await bodyText(page);
      const prog = (t.match(/生成中\s*(\d+)%/) || [])[1];
      if (!list) {
        console.log(`[round ${round}] 没抓到带条目的 list JSON（收到 ${all.length} 个响应）${prog ? ` 页面进度=${prog}%` : ''}`);
        await wait(page, 20000);
        continue;
      }

      const c = opt.id ? list.creations.find((x) => x.id === opt.id) || list.creations[0] : list.creations[0];
      console.log(`[round ${round}] totalCount=${list.totalCount} 选中 id=${c.id}${prog ? ` 页面进度=${prog}%` : ''}`);
      console.log('  ' + briefFields(c));
      console.log(`  模型=${c.modelType} 面数=${c.faceCount} 版本=${c.sceneVersion} 多视图=${c.isMultiView} PBR=${c.enable_pbr}`);
      console.log(`  视角标签=${JSON.stringify(c.imageTagList || [])}`);
      if (c.result?.[0]) console.log(`  任务 ${c.result[0].taskId} status=${c.result[0].status}`);
      fs.writeFileSync(path.join(OUT, `${opt.name}.creation.json`), JSON.stringify(c, null, 2));

      const inputImgs = new Set(c.imageList || []);
      const items = pickFiles(c);
      console.log(`  待下载 ${items.length} 项：`);
      for (const [u, label] of items) console.log(`   → [${label || 'main'}] ${u.slice(0, 130)}`);

      if (isReady(c, items)) {
        console.log('[DONE] 结果已就绪，开始下载');
        saved = await downloadAll(items, inputImgs);
        break;
      }
      const left = Math.round((deadline - Date.now()) / 1000);
      console.log(`  [wait] 结果未就绪（status=${c.result?.[0]?.status || c.status}），剩余 ${left}s 后重试`);
      await wait(page, 20000);
    }
    console.log(saved ? `[OK] 共落盘 ${saved} 个文件 → ${OUT}` : '[TIMEOUT/EMPTY] 没拿到结果文件');
  } else if (cmd === 'open' || cmd === 'grab' || cmd === 'list') {
    await page.goto(ORIGIN + '/assets', { waitUntil: 'load', timeout: 60000 });
    await wait(page, 7000);
    page = lastPage(ctx);
    await shot(page, '/tmp/hy3d_fetch_assets.png');
    console.log('[url]', page.url());
    console.log('[text:assets]\n' + (await bodyText(page)).slice(0, 900));
    const els = await dumpClickables(page, 'assets');

    if (cmd === 'list') {
      console.log('[DONE] list');
    } else {
      let target = opt.text;
      if (!target && opt.idx !== undefined) {
        const t = els.filter((e) => e.y > 150 && !/资产|API|3D创作|生成|设置|升级|协议|帮助/.test(e.t));
        target = t[Number(opt.idx)]?.t;
      }
      if (!target) {
        const cand = els.find((e) => e.y > 150 && e.t.length >= 2 && e.t.length <= 30 && !/资产|API|3D创作|生成|设置|升级|协议|帮助|下载|导出|生成完成/.test(e.t));
        target = cand ? cand.t : null;
        console.log('[pick] 自动选中 =', JSON.stringify(target), cand ? `@(${cand.x},${cand.y}) ${cand.w}x${cand.h}` : '');
      }
      if (target) {
        console.log('[step] 打开条目 →', JSON.stringify(await clickText(page, ctx, target, { waitMs: 12000 })));
        page = lastPage(ctx);
        await shot(page, '/tmp/hy3d_fetch_open.png');
        console.log('[text:open]\n' + (await bodyText(page)).slice(0, 1200));
        await dumpClickables(page, 'detail');
        for (let i = 0; i < 6 && URLS.size === 0; i++) await wait(page, 3000);
        console.log(`[urls] 捕获 ${URLS.size} 条`);
      }
      if (cmd === 'grab') {
        let saved = 0;
        saved = await downloadAll([...URLS].map((u) => [u, '']), new Set());
        if (!saved) {
          console.log('[step] 直链没拿到，退回点「下载」…');
          console.log('[grab] 命中 =', JSON.stringify(await clickText(page, ctx, opt.dl || '下载')));
          page = lastPage(ctx);
          await wait(page, 3000);
          await shot(page, '/tmp/hy3d_fetch_dlmenu.png');
          console.log('[text:after-click]\n' + (await bodyText(page)).slice(0, 1000));
          await dumpClickables(page, 'dlmenu');
          for (const f of ['GLB', 'glb', 'OBJ', 'obj']) {
            const g = await clickText(page, ctx, f);
            if (g) { console.log(`[grab] 选了 ${f} →`, JSON.stringify(g)); break; }
          }
          const dl = await page.waitForEvent('download', { timeout: 60000 }).catch(() => null);
          if (dl) {
            const dest = path.join(OUT, `${opt.name}${path.extname(dl.suggestedFilename()) || '.bin'}`);
            await dl.saveAs(dest);
            console.log(`[SAVED] ${dest}  (${(fs.statSync(dest).size / 1024).toFixed(0)} KB, 原名 ${dl.suggestedFilename()})`);
          } else console.log('[MISS] 60s 内没有 download 事件');
        }
      }
    }
  } else {
    console.log('[usage] pull --out <目录> --name <前缀> [--id uuid] [--timeout 秒] | list | open | grab --out <目录>');
  }

  console.log(`[urls] hookNetwork 共捕获 ${URLS.size} 条`);
  for (const u of URLS) console.log('  ' + u.slice(0, 260));
  await shot(page, '/tmp/hy3d_fetch_final.png');
  console.log('[DONE] 结束');
} catch (e) {
  console.log('[ERROR]', e.message);
  await shot(page, '/tmp/hy3d_fetch_error.png');
} finally {
  await ctx.close();
}
