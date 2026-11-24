// 混元 3D 网页版自动化：共享启动 + 点击工具（hy3d_web_login / gen / fetch / probe 系列共用）。
//
// ============================ 必读：踩过的坑 ============================
// 【坑 1 · 程序化 el.click() 会静默失效】
// 页面上 innerText 恰为「立即生成」的元素有 3 个：
//   #0 <DIV>    depth=5  rect=20,472,292,68   childTags=[BUTTON]
//   #1 <BUTTON> depth=6  rect=36,486,260,38   childTags=[svg,SPAN]   ← onClick 挂在这里
//   #2 <SPAN>   depth=7  rect=143,494,61,22
// document.querySelectorAll 按**文档序**返回（父在子前），朴素的 find() 拿到的是最外层 DIV。
// 点 DIV 不会把事件向下传给 BUTTON —— 结果是完全静默：截图与点击前逐字节相同、
// 一个请求都不发（实测就这样空跑了 16 分钟）。
// 正确做法：先算出目标元素的中心坐标，再用 page.mouse.click 打**真实鼠标事件**；
// 顶层命中到 BUTTON/SPAN，事件向上冒泡，React handler 正常触发。
//
// 【坑 2 · 同一 profile 不能并发】
// chromium.launchPersistentContext 对同一 userDataDir 有单例锁，
// 上一个脚本没退出就启下一个会直接报错。串行执行。
// ======================================================================
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

const require = createRequire('/Users/hohbandlee/.workbuddy/binaries/node/workspace/');
const { chromium } = require('playwright-core');

export const EXE = path.join(
  os.homedir(),
  'Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'
);
export const PROFILE = path.join(os.homedir(), '.workbuddy/browser-profiles/hunyuan3d');
export const ORIGIN = 'https://3d.hunyuan.tencent.com';

export async function launch({ downloadsPath } = {}) {
  return chromium.launchPersistentContext(PROFILE, {
    executablePath: EXE,
    headless: true,
    acceptDownloads: !!downloadsPath,
    ...(downloadsPath ? { downloadsPath } : {}),
    viewport: { width: 1600, height: 1100 },
    args: ['--no-sandbox', '--hide-scrollbars'],
  });
}

export const lastPage = (ctx) => {
  const p = ctx.pages();
  return p[p.length - 1];
};
export const bodyText = (page) => page.evaluate(() => document.body.innerText || '');

/** 定位可点目标，返回其中心坐标（会自动 scrollIntoView 后再量）。 */
export async function findTarget(page, t, { exact = false } = {}) {
  return page.evaluate(
    ({ tt, ex }) => {
      const INTER = 'button,a,[role=button],input[type=submit],input[type=button],[class*=btn]';
      const visible = (e) => {
        const cs = getComputedStyle(e);
        if (cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0') return false;
        const r = e.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      const among = (nodes) => {
        const scored = [];
        for (const e of nodes) {
          if (!visible(e)) continue;
          e.scrollIntoView({ block: 'center' });
          const r = e.getBoundingClientRect();
          const area = r.width * r.height;
          if (area < 30) continue;
          scored.push({ area, cx: Math.round(r.x + r.width / 2), cy: Math.round(r.y + r.height / 2) });
        }
        scored.sort((a, b) => a.area - b.area); // 取最小面积 = 最内层
        return scored[0] || null;
      };
      const norm = (s) => (s || '').replace(/\s+/g, '').trim();
      const nt = norm(tt);

      const inter = [...document.querySelectorAll(INTER)];
      let hit = inter.filter((e) => norm(e.innerText) === nt);
      if (!hit.length && !ex) hit = inter.filter((e) => (e.innerText || '').includes(tt));
      if (hit.length) {
        const p = among(hit);
        if (p) return { kind: 'interactive', n: hit.length, ...p };
      }

      const any = [...document.querySelectorAll('div,span,li,p')];
      let h2 = any.filter((e) => norm(e.innerText) === nt);
      if (!h2.length && !ex) h2 = any.filter((e) => (e.innerText || '').includes(tt) && e.children.length <= 4);
      if (h2.length) {
        const p = among(h2);
        if (p) return { kind: 'text', n: h2.length, ...p };
      }
      return null;
    },
    { tt: t, ex: exact }
  );
}

/** 真实鼠标点击。返回 {hit,kind,at} 或 null（没找到）。 */
export async function clickText(page, ctx, t, { exact = false, waitMs = 2500 } = {}) {
  const tgt = await findTarget(page, t, { exact });
  if (!tgt) return null;
  const before = ctx.pages().length;
  await page.mouse.click(tgt.cx, tgt.cy);
  await page.waitForTimeout(waitMs);
  const out = { hit: t, kind: tgt.kind, n: tgt.n, at: [tgt.cx, tgt.cy], newTab: ctx.pages().length > before };
  return out;
}

/** 列出当前页可点元素（调试用）。 */
export async function dumpClickables(page, tag = '') {
  const els = await page.evaluate(() => {
    const out = [];
    const sel = 'button,a,[role=button],[class*=btn],[class*=card],[class*=item],div';
    for (const e of document.querySelectorAll(sel)) {
      const t = (e.innerText || '').trim().replace(/\s+/g, ' ');
      if (!t || t.length > 60 || e.offsetParent === null || e.children.length > 5) continue;
      const r = e.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) continue;
      out.push({
        tag: e.tagName,
        t,
        cls: ('' + (e.className || '')).slice(0, 40),
        x: Math.round(r.x),
        y: Math.round(r.y),
        w: Math.round(r.width),
        h: Math.round(r.height),
      });
    }
    const best = new Map();
    for (const o of out) {
      const k = o.t;
      const a = o.w * o.h;
      if (!best.has(k) || a < best.get(k).w * best.get(k).h) best.set(k, o);
    }
    return [...best.values()].sort((a, b) => a.y - b.y || a.x - b.x);
  });
  if (tag) console.log(`[clickables:${tag}] ${els.length} 个`);
  for (const e of els.slice(0, 70)) console.log(`  <${e.tag}> @(${e.x},${e.y}) ${e.w}x${e.h} "${e.t.slice(0, 48)}"`);
  return els;
}

/** 结果文件直链监听：.glb/.obj/.zip 或 model/gltf 响应，外加 API JSON 内嵌直链。 */export function hookNetwork(page, onHit) {
  const seen = new Set();
  const FILE_RE = /\.(glb|gltf|obj|zip|fbx|usdz|stl|tar\.gz)(\?|#|$)/i;
  const CT_RE = /model\/gltf|application\/zip|application\/octet-stream/i;
  page.on('response', async (r) => {
    try {
      const u = r.url();
      const ct = (r.headers()['content-type'] || '').toLowerCase();
      if (FILE_RE.test(u) || CT_RE.test(ct)) {
        if (!seen.has(u)) {
          seen.add(u);
          console.log(`[net] ${r.status()} ${ct || '-'} len=${r.headers()['content-length'] || '?'}`);
          console.log(`      ${u.slice(0, 300)}`);
          onHit && onHit(u);
        }
        return;
      }
      if (/json/i.test(ct) && /(asset|task|model|download|result|creation|generation)/i.test(u)) {
        const t = await r.text().catch(() => '');
        // 注意：JSON 里的 URL 带 \u0026 / \/ 转义，正则**不能**把反斜杠排除在字符类外，
        // 否则会在第一个 \u0026 处截断（踩过：签名参数全丢，直链不可用）。
        const raw = t.match(/https?:(?:\\\/|\/)[^"']+/g) || [];
        const files = raw
          .map((x) => x.replace(/\\u0026/g, '&').replace(/\\\//g, '/'))
          .filter((x) => FILE_RE.test(x));
        if (files.length || process.env.HY3D_DEBUG) {
          console.log(`[api-json] ${u.slice(0, 150)}  body=${t.length}B  文件直链=${files.length}`);
          if (process.env.HY3D_DEBUG) console.log('  body> ' + t.slice(0, 1800));
        }
        for (const uu of new Set(files)) {
          if (!seen.has(uu)) {
            seen.add(uu);
            console.log('  URL> ' + uu.slice(0, 260));
            onHit && onHit(uu);
          }
        }
      }
    } catch {}
  });
  return seen;
}

export const FILE_EXT_RE = /\.(glb|gltf|obj|zip|fbx|usdz|stl)(?=[?#]|$)/i;

/**
 * 等下一个匹配的响应并解析成 JSON。**必须在 goto 之前调用**（先挂监听再导航）。
 * 非 JSON / 超时都 resolve(null)，由调用方决定重试。
 */
export function waitJson(page, re, timeoutMs = 90000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      page.off('response', h);
      resolve(v);
    };
    const h = async (r) => {
      try {
        if (!re.test(r.url())) return;
        if (!/json/i.test(r.headers()['content-type'] || '')) return;
        finish(JSON.parse(await r.text()));
      } catch {
        finish(null);
      }
    };
    page.on('response', h);
    setTimeout(() => finish(null), timeoutMs);
  });
}

/** 深度扫描对象里的所有字符串，挑出结果文件直链（顺手把 \u0026 解回来）。 */
export function deepFindUrls(obj, re = FILE_EXT_RE) {
  const out = new Set();
  const walk = (v) => {
    if (typeof v === 'string') {
      const s = v.replace(/\\u0026/g, '&').replace(/\\\//g, '/');
      if (re.test(s)) out.add(s);
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(obj);
  return [...out];
}

/** 只打印一眼能看出状态的字段（短字符串/数字），避免刷屏。 */
export function briefFields(obj, n = 18) {
  const out = [];
  for (const [k, v] of Object.entries(obj || {})) {
    if (typeof v === 'number' || typeof v === 'boolean') out.push(`${k}=${v}`);
    else if (typeof v === 'string' && v.length <= 40) out.push(`${k}="${v}"`);
    else if (Array.isArray(v)) out.push(`${k}[${v.length}]`);
    else if (v && typeof v === 'object') out.push(`${k}{${Object.keys(v).length}}`);
    if (out.length >= n) break;
  }
  return out.join(' ');
}
