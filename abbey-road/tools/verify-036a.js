/**
 * 开发用：0.3.6a 四项修复的验收脚本。
 *   ① 已完成作业折叠：连点 5 次，状态必须跟着最后一次点击，折叠后高度必须为 0
 *      （老 bug：.hw-done{display:flex} 盖掉 [hidden]，且兜底定时器用旧状态收尾）
 *   ② 设置页滑块：点一下必须是"滑过去"（中间帧有位移），不是瞬移
 *   ③ 周表 Tab 进场：滑块的进场交给所在整块的 viewIn（自己不另起一条时间线）
 *   ④ 切换主题：颜色令牌连续插值（中间值必须不等于两端）+ 光效层按时清理
 *
 * 用法：$env:CDP_PORT='9333'; node tools/verify-036a.js
 */
const port = process.env.CDP_PORT || '9223';

async function main() {
  const targets = await fetch('http://127.0.0.1:' + port + '/json').then((r) => r.json());
  const page = targets.find((t) => t.type === 'page') || targets[0];
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const errors = [];
  const send = (method, params) => new Promise((resolve) => {
    const myId = ++id;
    pending.set(myId, resolve);
    ws.send(JSON.stringify({ id: myId, method, params: params || {} }));
  });
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      errors.push((d.exception && d.exception.description) || d.text);
    }
  });
  await new Promise((r) => ws.addEventListener('open', r));
  await send('Runtime.enable');
  const run = async (expr) => {
    const res = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, userGesture: true });
    const r = res.result || {};
    if (r.exceptionDetails) { throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 400)); }
    return r.result ? r.result.value : null;
  };
  /** 表达式可以是普通值，也可以是 Promise（async IIFE）——统一 await 后再序列化 */
  const json = async (e) => JSON.parse(await run('(async function(){ return JSON.stringify(await (' + e + ')); })()'));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const report = {};

  // ── ① 已完成作业折叠 ──────────────────────────────────────
  await run("AR.UI.show('today')");
  await wait(800);
  /**
   * 造两条"今天已完成"的作业（id 带 verify- 前缀，跑完就删）。
   * 直接往 store 里塞：不依赖这台机器上有没有真实作业，验收结果才可复现。
   */
  await run("(function(){ var st=AR.Store.get(); st.tasks=st.tasks||[]; var today=AR.Util.dateKey(new Date());"
    + " for (var i=0;i<2;i++){ var id='verify-'+i;"
    + "  if(!st.tasks.filter(function(t){ return t.id===id; }).length){"
    + "   st.tasks.push({ id:id, courseId:'', blockId:'', date:today, text:'验收作业'+(i+1),"
    + "    done:true, doneAt:new Date().toISOString(), updatedAt:new Date().toISOString() }); } }"
    + " AR.Store.save(true); AR.UI.renderToday(); return 'ok'; })()");
  await wait(700);
  await run("(function(){ var s=document.querySelector('#hwToday .hw-sum'); if(s && document.querySelector('#hwToday .hw-body').hidden){ s.click(); } return 'ok'; })()");
  await wait(700);
  report.fold = await json("(async function(){"
    + " var head=document.querySelector('#hwToday .hw-done-head'); var dn=document.querySelector('#hwToday .hw-done');"
    + " if(!head||!dn){ return { err:'no-done-group' }; }"
    + " function snap(){ return { open:dn.dataset.open, hidden:dn.hidden,"
    + "  h:Math.round(dn.getBoundingClientRect().height), display:getComputedStyle(dn).display }; }"
    + " var seq=[snap()];"
    // ① 顺序点 4 次：开 / 关 / 开 / 关，每次都等动画完全落地（老 bug 就是"第二次之后折不动"）
    + " for (var i=0;i<4;i++){ head.click(); await new Promise(function(r){ setTimeout(r, 620); }); seq.push(snap()); }"
    // ② 快速连点 5 次（150ms 一次，故意让动画互相打断）：从"关"开始 → 应该是"开"
    + " for (var j=0;j<5;j++){ head.click(); await new Promise(function(r){ setTimeout(r, 150); }); }"
    + " await new Promise(function(r){ setTimeout(r, 1500); });"
    + " var burst=snap();"
    // ③ 再快速连点 4 次（偶数）→ 回到"开"（因为 5 次后是开，+4 还是开）
    + " for (var k=0;k<4;k++){ head.click(); await new Promise(function(r){ setTimeout(r, 150); }); }"
    + " await new Promise(function(r){ setTimeout(r, 1500); });"
    + " return { seq:seq, burst:burst, burst2:snap(),"
    + "  expect:'seq = 关/开/关/开/关（h 交替 0 / >0），burst.open=1' };"
    + " })()");

  // ── ② 设置页滑块必须"滑"过去 ─────────────────────────────
  await run("AR.UI.show('settings')");
  await wait(900);
  report.settingsSlide = await json("(async function(){"
    + " function firstInactive(cells){ for(var i=0;i<cells.length;i++){ if(!cells[i].classList.contains('active')) return cells[i]; } return cells[0]; }"
    + " var seg=document.querySelectorAll('#set-appearance .segmented')[0];"
    + " var cells=seg.querySelectorAll('.seg'); var target=firstInactive(cells); var ti=Array.prototype.indexOf.call(cells,target);"
    + " var out=[]; var t0=performance.now(); target.click();"
    + " function step(){ var s2=document.querySelectorAll('#set-appearance .segmented')[0];"
    + "  var p=s2?s2.querySelector('.seg-pill'):null; var c=s2?s2.querySelectorAll('.seg')[ti]:null;"
    + "  if(p&&c){ var a=c.getBoundingClientRect(), b=p.getBoundingClientRect();"
    + "   out.push({t:Math.round(performance.now()-t0), dx:+(b.left-a.left).toFixed(1), anim:p.getAnimations().length}); }"
    + "  if(performance.now()-t0<520){ requestAnimationFrame(step); } }"
    + " requestAnimationFrame(step);"
    + " await new Promise(function(r){ setTimeout(r, 700); });"
    + " var mid=out.filter(function(x){ return Math.abs(x.dx)>1.5; });"
    + " return { frames:out.length, midFrames:mid.length, first:out[0]||null, last:out[out.length-1]||null,"
    + "  active:(document.querySelectorAll('#set-appearance .segmented')[0].querySelector('.seg.active')||{}).textContent };"
    + " })()");

  // ── ③ 周表 Tab 进场：滑块跟着整块的 viewIn ────────────────
  await run("AR.UI.show('today')");
  await wait(800);
  report.weekEnter = await json("(async function(){"
    + " var tab=[].slice.call(document.querySelectorAll('.nav-btn')).filter(function(b){ return b.getAttribute('data-nav')==='week'; })[0];"
    + " tab.click(); await new Promise(function(r){ setTimeout(r, 120); });"
    + " var seg=document.getElementById('weekMode'); var pill=seg?seg.querySelector('.seg-pill'):null;"
    + " var block=seg?seg.closest('.week-bar, .zone, .glass.panel, .set-section, .view-head'):null;"
    + " return { pillOwnAnims: pill?pill.getAnimations().length:-1,"
    + "  blockCls: block?String(block.className).slice(0,40):null,"
    + "  blockAnims: block?block.getAnimations().length:-1,"
    + "  pillAligned: (function(){ if(!pill||!seg) return null; var a=seg.querySelector('.seg.active').getBoundingClientRect(), b=pill.getBoundingClientRect();"
    + "    return +Math.abs(b.left-a.left).toFixed(2); })() }; })()");

  // ── ④ 切换主题：颜色连续插值 + 光效层清理 ────────────────
  await run("AR.UI.show('settings')");
  await wait(800);
  report.theme = await json("(async function(){"
    + " var body=document.body; var before=body.getAttribute('data-theme');"
    + " var samples=[]; var fxFrames=0; var t0=performance.now();"
    + " function readBase(){ return getComputedStyle(body).getPropertyValue('--bg-base').trim(); }"
    + " var start=readBase();"
    + " AR.UI.themeSwitch(before!=='dark','click');"
    + " function step(){ var v=readBase();"
    + "  samples.push({t:Math.round(performance.now()-t0), v:v, fx:document.querySelectorAll('.theme-fx').length});"
    + "  if(document.querySelectorAll('.theme-fx').length){ fxFrames++; }"
    + "  if(performance.now()-t0<620){ requestAnimationFrame(step); } }"
    + " requestAnimationFrame(step);"
    + " await new Promise(function(r){ setTimeout(r, 900); });"
    + " var uniq=[]; for(var i=0;i<samples.length;i++){ var p=uniq[uniq.length-1]; if(!p||p.v!==samples[i].v){ uniq.push(samples[i]); } }"
    + " return { from:before, to:body.getAttribute('data-theme'), start:start, end:readBase(),"
    + "  distinct:uniq.length, fxFrames:fxFrames, fxLeft:document.querySelectorAll('.theme-fx').length,"
    + "  timeline:uniq.slice(0,10) }; })()");

  report.errors = errors.slice(0, 4);
  // 清掉验收用的假作业（不留痕）
  report.cleanup = await json("(function(){ var st=AR.Store.get();"
    + " var before=(st.tasks||[]).length;"
    + " st.tasks=(st.tasks||[]).filter(function(t){ return String(t.id).indexOf('verify-')!==0; });"
    + " AR.Store.save(true); AR.UI.renderToday();"
    + " return { before:before, after:(AR.Store.get().tasks||[]).length }; })()");
  console.log(JSON.stringify(report, null, 2));
  ws.close();
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
