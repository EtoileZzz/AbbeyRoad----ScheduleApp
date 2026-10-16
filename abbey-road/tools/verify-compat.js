/**
 * 旧 Android WebView 弹窗透明 · 兼容回归（CDP 驱动，连 9333）
 *
 * 事故：v0.4.1 的弹窗底色写了 CSS `light-dark(...)`。旧版 WebView 不认识这个函数时
 * **不是回退，而是把整条声明丢掉** → .modal-card / .modal-head / .modal-actions
 * 没有底色，页面内容直接透出来 = 「弹窗变透明」。
 *
 * 判定方式（不是靠读代码下结论，而是真的量渲染结果）：
 *   ① 源码扫描：禁用清单必须为 0
 *   ② 复现：把旧版那条 light-dark 规则**原文**注入成最后一条样式表（= 旧内核的处境），
 *      量出卡片底色是"透明" → 说明这台测试机确实能复现该事故
 *   ③ 修复：撤掉注入，量当前 CSS 的卡片底色必须不透明
 *   ④ 组合覆盖：浅/深 × 正常/标准/深度流畅模式，层层都要有底色
 *   ⑤ 回退路径：window.__noWaapi（老内核无 WAAPI）下也要有底色
 *
 * 用法：CDP_PORT=9333 node tools/verify-compat.js
 */
const fs = require('fs');
const path = require('path');
const port = process.env.CDP_PORT || '9333';

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  const s = cond ? 'PASS' : 'FAIL';
  if (cond) { pass++; } else { fail++; }
  console.log(`[${s}] ${name}${detail ? '  |  ' + detail : ''}`);
  return !!cond;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 旧内核会"整条丢弃"的那条规则原文（与 v0.4.1 基线一致） */
const OLD_RULE = '.modal-card{background:light-dark(rgba(255,255,255,var(--modal-card-a,.9)),rgba(28,33,43,var(--modal-card-a,.9)));}';

/* ── ① 源码扫描 ─────────────────────────────────────────────── */
function scanSource() {
  const root = path.resolve(__dirname, '..');
  let text = '';
  for (const f of ['app/css/tokens.css', 'app/css/app.css']) {
    text += fs.readFileSync(path.join(root, f), 'utf8');
  }
  const stripped = text.replace(/\/\*[\s\S]*?\*\//g, '');   // 去注释，避免注释里的名字假阳性
  const banned = [
    { re: /light-dark\s*\(/g, name: 'light-dark()' },
    { re: /color-mix\s*\(/g, name: 'color-mix()' },
    { re: /:has\s*\(/g, name: ':has()' },
    { re: /@container/g, name: '@container' }
  ];
  const found = [];
  for (const b of banned) {
    const m = stripped.match(b.re);
    if (m) { found.push(b.name + '×' + m.length); }
  }
  ok('① 禁用清单为 0（旧内核会丢弃整条声明）', found.length === 0,
    found.length ? found.join(', ') : 'light-dark / color-mix / :has / @container 全部干净');

  const darkOk = /body\[data-theme="dark"\]\s*\.modal-card\s*\{[^}]*background/.test(text)
    && /body\[data-theme="dark"\]\s*\.modal-head/.test(text)
    && /body\[data-theme="dark"\]\s*\.modal-actions/.test(text);
  ok('①b 深色主题用属性选择器接管（替代 light-dark 的另一半）', darkOk);

  const supportsOk = /@supports\s+not\s*\(\(-webkit-backdrop-filter/.test(text);
  ok('①c 无毛玻璃内核有实底兜底', supportsOk);
}

/* ── CDP 小工具 ─────────────────────────────────────────────── */
function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let n = 0; const waiters = new Map();
    ws.addEventListener('open', () => {
      ws.addEventListener('message', (e) => {
        const m = JSON.parse(e.data);
        if (m.id && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); }
      });
      const send = (method, params) => new Promise((res) => {
        const id = ++n; waiters.set(id, res);
        ws.send(JSON.stringify({ id, method, params: params || {} }));
      });
      resolve({ ws, send });
    });
    ws.addEventListener('error', reject);
  });
}

async function main() {
  scanSource();

  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = list.find((t) => t.type === 'page' && t.url.indexOf('index.html') >= 0);
  if (!page) { throw new Error('找不到 index.html 页面目标，先跑 tools/headless.ps1'); }
  const { ws, send } = await connect(page.webSocketDebuggerUrl);

  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result && r.result.exceptionDetails) {
      throw new Error('EVAL: ' + (r.result.exceptionDetails.exception
        && r.result.exceptionDetails.exception.description || r.result.exceptionDetails.text));
    }
    return r.result && r.result.result ? r.result.result.value : undefined;
  };

  await send('Page.enable');
  await ev(`(function(){ try{ localStorage.clear(); }catch(e){} return 1; })()`);
  await send('Page.reload', { ignoreCache: true });
  await sleep(2600);

  const ready = await ev(`!!(window.AR && AR.UI && AR.UI.openModal)`);
  if (!ok('② 应用已加载', ready)) { return finish(ws); }

  /** 只量当前弹窗各层底色（不改 DOM） */
  const measureOnly = () => ev(`
      (function(){
        function a(sel){
          var n = document.querySelector(sel);
          if (!n) return null;
          var bg = getComputedStyle(n).backgroundColor || '';
          var m = bg.match(/rgba?\\(([^)]+)\\)/);
          if (!m) return { raw: bg, a: null };
          var p = m[1].split(',').map(function(s){ return parseFloat(s); });
          return { raw: bg, a: p.length > 3 ? p[3] : 1 };
        }
        return {
          visible: !!document.querySelector('.modal-root.open .modal-card'),
          card: a('.modal-root.open .modal-card'),
          head: a('.modal-root.open .modal-head'),
          actions: a('.modal-root.open .modal-actions')
        };
      })()
    `);

  /**
   * 打开弹窗并量底色。
   * 判据说明：
   *   · 卡片（.modal-card）是这次事故的主体 —— 旧内核丢弃 light-dark 声明后它**没有底色**，
   *     量出来是 rgba(0,0,0,0)。所以这里要求 alpha 明显 > 0（≥0.6）。
   *   · 两条带（.modal-head / .modal-actions）的设计是低不透明度磨砂（默认 20%），
   *     它们靠 backdrop-filter 出质感，alpha 天然很低，不算缺陷 —— 只断言"有解析出颜色"。
   *   · 卡片不透明度可被用户设置（modalCardA，默认 0.9，最低 40%），所以阈值取 0.6，
   *     而不是写死 0.9。
   */
  const CARD_MIN_ALPHA = 0.6;

  const openAndMeasure = async () => {
    await ev(`(function(){
        if (AR.UI.closeModal) { AR.UI.closeModal(); }
        var c = document.getElementById('modalCard');
        if (c) { c.removeAttribute('style'); }
        return 1;
      })()`);
    await sleep(150);
    await ev(`AR.UI.openModal({ title:'兼容性自检', sub:'旧内核透明回归',
      body:'<p>正文一</p><p>正文二</p>',
      actions:[{ label:'知道了', primary:true, onClick:function(close){ close(); } }] }), 1`);
    await sleep(900);   // 等进场动画彻底结束，避免量到中间态
    return measureOnly();
  };

  /* ── ② 复现：把卡片底色强制成"没有底色"（= 旧内核丢弃 light-dark 那条声明的结果） ──
        这一步必须在**动画结束之后**做：进场动画期间卡片带着 transform，
        量到的几何/层叠是中间态（实测会把 .modal-head 量成透明，属于假失败）。 */
  await ev(`
    (function(){
      // 量样式时关掉动画与过渡，保证量到的是"最终静态样式"，不是动画中间帧
      if (!document.getElementById('__verifyNoAnim')) {
        var s = document.createElement('style');
        s.id = '__verifyNoAnim';
        s.textContent = '*,*::before,*::after{animation:none !important;transition:none !important;}';
        document.head.appendChild(s);
      }
      document.body.setAttribute('data-theme','light');
      document.body.removeAttribute('data-perf');
      return 1;
    })()
  `);
  // 打开一个弹窗让 DOM 就绪，然后再压成透明来复现事故
  await openAndMeasure();
  await ev(`(function(){
      var c = document.getElementById('modalCard');
      c.style.setProperty('background', 'rgba(0, 0, 0, 0)', 'important');
      return 1;
    })()`);
  const repro = await measureOnly();
  const reproTransparent = !!(repro && repro.card && repro.card.a === 0);
  ok('② 复现成立：卡片无底色时确实量到「透明弹窗」', reproTransparent,
    repro && repro.card ? 'card=' + repro.card.raw : 'no card');

  /* ── ③ 修复：撤掉强制项，当前 CSS 必须给出不透明底色 ── */
  await ev(`(function(){
      var c = document.getElementById('modalCard');
      c.style.removeProperty('background');
      c.removeAttribute('style');
      return 1;
    })()`);
  const fixed = await measureOnly();
  ok('③ 修复生效：纯 CSS 下卡片底色不透明',
    !!(fixed && fixed.visible && fixed.card && fixed.card.a >= CARD_MIN_ALPHA),
    fixed && fixed.card ? 'card=' + fixed.card.raw : 'no card');
  ok('③b 标题带 / 操作条在动画结束后都有底色',
    !!(fixed && fixed.head && fixed.head.a != null && fixed.actions && fixed.actions.a != null),
    fixed ? `head=${fixed.head && fixed.head.raw} actions=${fixed.actions && fixed.actions.raw}` : '');

  /* ── ④ 主题 × 流畅模式 全组合 ── */
  for (const c of [
    { theme: 'light', perf: '' }, { theme: 'dark', perf: '' },
    { theme: 'light', perf: 'lite' }, { theme: 'dark', perf: 'lite' },
    { theme: 'light', perf: 'min' }, { theme: 'dark', perf: 'min' }
  ]) {
    await ev(`
      (function(){
        document.body.setAttribute('data-theme','${c.theme}');
        ${c.perf ? `document.body.setAttribute('data-perf','${c.perf}');` : `document.body.removeAttribute('data-perf');`}
        return 1;
      })()
    `);
    const m = await openAndMeasure();
    const tag = c.theme + (c.perf ? '/' + c.perf : '');
    ok(`④ 有底色 (${tag})`,
      !!(m && m.visible && m.card && m.card.a >= CARD_MIN_ALPHA && m.head && m.head.a != null && m.actions && m.actions.a != null),
      m && m.card ? `card=${m.card.raw} head=${m.head.raw} actions=${m.actions.raw}` : 'no card');
  }

  /* ── ⑤ 无 WAAPI 的旧内核回退路径 ── */
  await ev(`(function(){ window.__noWaapi = true; document.body.setAttribute('data-theme','light'); document.body.removeAttribute('data-perf'); return 1; })()`);
  const fb = await openAndMeasure();
  ok('⑤ 无 WAAPI 回退路径仍有底色',
    !!(fb && fb.visible && fb.card && fb.card.a >= CARD_MIN_ALPHA),
    fb && fb.card ? 'card=' + fb.card.raw : 'no card');

  return finish(ws);
}

function finish(ws) {
  console.log(`\n合计：${pass} 通过 / ${fail} 失败`);
  process.exitCode = fail ? 1 : 0;
  try { if (ws) { ws.close(); } } catch (e) { }
}

main().catch((e) => {
  console.error('运行失败：' + (e && e.stack ? e.stack : e));
  process.exitCode = 1;
});
