/**
 * 开发用：滑块（分段控件 / 底部 Tab 的胶囊）与自绘下拉的验收脚本。
 *
 * 检查三件事：
 *   ① 对齐 —— 胶囊和选中格子的矩形差必须 < 1px（布局空间，忽略祖先 transform）；
 *   ② 首帧 —— 面板/卡片刚重画出来的那一帧，胶囊宽度就已经等于格子宽度
 *      （老做法量到的是"入场动画中"的投影尺寸，会先小一圈）；
 *   ③ 有动画 —— 点另一格之后，中间帧的位置确实在两端之间（不是瞬移），
 *      并且最终仍然对齐。
 *
 * 用法：先起 headless.ps1（CDP 9333）或 adb forward（9222）
 *   $env:CDP_PORT='9333'; node tools/verify-pill.js
 */
const port = process.env.CDP_PORT || '9223';

async function main() {
  const targets = await fetch('http://127.0.0.1:' + port + '/json').then((r) => r.json());
  const page = targets.find((t) => t.type === 'page') || targets[0];
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const send = (method, params) => new Promise((resolve) => {
    const myId = ++id;
    pending.set(myId, resolve);
    ws.send(JSON.stringify({ id: myId, method, params: params || {} }));
  });
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  });
  await new Promise((r) => ws.addEventListener('open', r));
  await send('Runtime.enable');

  const errors = [];
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.method === 'Runtime.exceptionThrown') {
      errors.push((msg.params.exceptionDetails.exception || {}).description || 'exception');
    }
  });

  async function run(expr) {
    const res = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, userGesture: true });
    const r = res.result || {};
    if (r.exceptionDetails) { throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 400)); }
    return r.result ? r.result.value : null;
  }

  const helper = `
    window.__vp = {
      rect(el){ const r = el.getBoundingClientRect(); return {l:r.left, t:r.top, w:r.width, h:r.height}; },
      scan(label){
        const out = [];
        const segs = document.querySelectorAll('.segmented');
        for (let i=0;i<segs.length;i++){
          const seg = segs[i];
          if (!seg.offsetWidth || !seg.offsetHeight) { continue; }   // 隐藏视图里的控件不参与
          const pill = seg.querySelector('.seg-pill');
          const act = seg.querySelector('.seg.active');
          if (!act) { out.push({label, i, err:'no-active'}); continue; }
          if (!pill) { out.push({label, i, err:'no-pill'}); continue; }
          const a = window.__vp.rect(act), p = window.__vp.rect(pill);
          out.push({label, i, key: seg.id || seg.className,
            dx: +(p.l-a.l).toFixed(2), dy: +(p.t-a.t).toFixed(2),
            dw: +(p.w-a.w).toFixed(2), dh: +(p.h-a.h).toFixed(2),
            layoutW: pill.offsetWidth - act.offsetWidth});
        }
        const bar = document.querySelector('.tabbar');
        if (bar) {
          const pill = bar.querySelector('.tab-pill'), act = bar.querySelector('.nav-btn.active');
          if (pill && act) {
            const a = window.__vp.rect(act), p = window.__vp.rect(pill);
            out.push({label, i:'tab', dx:+(p.l-a.l).toFixed(2), dy:+(p.t-a.t).toFixed(2),
              dw:+(p.w-a.w).toFixed(2), dh:+(p.h-a.h).toFixed(2), layoutW: pill.offsetWidth - act.offsetWidth});
          }
        }
        return out;
      }
    }; 'ok'`;
  await run(helper);

  const results = [];
  const bad = [];
  function check(rows) {
    for (const r of rows) {
      // layoutW 是整数取整后的差，允许 ±1；rect 差才是肉眼看到的对齐
      if (r.err || Math.abs(r.dx) > 1 || Math.abs(r.dy) > 1 || Math.abs(r.dw) > 1 || Math.abs(r.dh) > 1
        || Math.abs(r.layoutW || 0) > 1) {
        bad.push(r);
      }
    }
    results.push(rows);
  }

  // ① 逐页扫描
  for (const view of ['today', 'week', 'import', 'settings']) {
    await run(`AR.UI.show('${view}')`);
    await new Promise((r) => setTimeout(r, 900));
    check(await run(`JSON.stringify(window.__vp.scan('${view}'))`).then(JSON.parse));
  }

  // ② 今日页展开「本周概览」后（卡片展开动画中间）再扫一次
  await run(`AR.UI.show('today')`);
  await new Promise((r) => setTimeout(r, 700));
  await run(`(function(){ var z=document.getElementById('zoneWeek'); var b=z.querySelector('.zone-toggle')||z.querySelector('button'); if(b){b.click();} return 'clicked'; })()`);
  await new Promise((r) => setTimeout(r, 340));
  check(await run(`JSON.stringify(window.__vp.scan('today/week-expanding'))`).then(JSON.parse));
  await new Promise((r) => setTimeout(r, 700));
  check(await run(`JSON.stringify(window.__vp.scan('today/week-expanded'))`).then(JSON.parse));

  // ③ 点另一个分段：中间帧必须在两端之间（有动画），末帧对齐
  const animProbe = await run(`(function(){
    var seg = document.querySelector('#zoneWeek .segmented') || document.querySelector('.segmented');
    if (!seg) { return JSON.stringify({err:'no-seg'}); }
    var kids = seg.querySelectorAll('.seg');
    if (kids.length < 2) { return JSON.stringify({err:'one-seg'}); }
    var pill = seg.querySelector('.seg-pill');
    // 点"当前没选中"的那一格，否则代码会直接 return（没有动画可看）
    var targetIdx = -1;
    for (var i=0;i<kids.length;i++){ if (!kids[i].classList.contains('active')) { targetIdx = i; break; } }
    if (targetIdx < 0) { return JSON.stringify({err:'all-active'}); }
    var before = pill.getBoundingClientRect().left;
    kids[targetIdx].click();
    var samples = [];
    var t0 = performance.now();
    return new Promise(function(resolve){
      function step(){
        // 面板会重画，所以每帧都重新查一次节点（拿旧节点量出来的永远是 0）
        var s2 = document.querySelector('#weekBody .segmented') || document.querySelector('.segmented');
        var p2 = s2 ? s2.querySelector('.seg-pill') : null;
        var c2 = s2 ? s2.querySelectorAll('.seg')[targetIdx] : null;
        var rec = {t: Math.round(performance.now()-t0)};
        if (p2 && c2) {
          rec.dx = +(p2.getBoundingClientRect().left - c2.getBoundingClientRect().left).toFixed(2);
          rec.anim = p2.getAnimations().length;
        } else { rec.err = 'gone'; }
        samples.push(rec);
        if (performance.now()-t0 > 520) {
          resolve(JSON.stringify({before: +before.toFixed(2), targetIdx: targetIdx, samples: samples}));
          return;
        }
        requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    });
  })()`).then(JSON.parse);
  animProbe.midFrames = (animProbe.samples || []).filter((s) => s.dx > 1.5).length;

  await new Promise((r) => setTimeout(r, 800));
  check(await run(`JSON.stringify(window.__vp.scan('after-seg-click'))`).then(JSON.parse));

  // ④ 桌面宽度 + 窄屏都过一遍
  for (const [w, h] of [[900, 1950], [412, 892], [1280, 800]]) {
    await send('Emulation.setDeviceMetricsOverride', { width: Math.round(w / 3), height: Math.round(h / 3), deviceScaleFactor: 3, mobile: true });
    await run(`AR.UI.show('settings')`);
    await new Promise((r) => setTimeout(r, 800));
    check(await run(`JSON.stringify(window.__vp.scan('settings@${w}x${h}'))`).then(JSON.parse));
  }
  await send('Emulation.clearDeviceMetricsOverride');

  console.log(JSON.stringify({ animProbe, checks: results.length, bad, errors: errors.slice(0, 4) }, null, 2));
  ws.close();
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
