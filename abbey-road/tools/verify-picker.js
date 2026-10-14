/**
 * 开发用：自绘下拉（替换原生 select）的验收脚本。
 *   · 导入页 / 手动添加页的下拉能不能建出来、点开、选中、回写；
 *   · 课程编辑器里的 5 个下拉（星期 / 起止节次 / 单双周 / 课程类型）同样跑一遍；
 *   · 关闭后浮层必须从 DOM 里消失，编辑器还在原处；全程不允许有异常。
 *
 * 用法：$env:CDP_PORT='9333'; node tools/verify-picker.js
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

  async function run(expr) {
    const res = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, userGesture: true });
    const r = res.result || {};
    if (r.exceptionDetails) { throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 500)); }
    return r.result ? r.result.value : null;
  }
  const json = async (expr) => JSON.parse(await run('JSON.stringify(' + expr + ')'));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const report = { triggers: [], picker: {}, editor: [], errors };

  // ① 导入页 → 手动添加：几个下拉都建好了吗
  await run("AR.UI.show('import')");
  await wait(600);
  await run("(function(){ var t=document.querySelector('[data-tab=\"manual\"]'); if(t){t.click();} return 'ok'; })()");
  await wait(500);
  const trigExpr = "['manWeekday','manPeriodStart','manPeriodEnd','manColor','evType','optParity']"
    + ".map(function(k){ var b=document.getElementById(k); return { id:k, tag: b?b.tagName:'',"
    + " value: b?b.value:null, label: b?((b.querySelector('.pick-txt')||{}).textContent||'').trim():null,"
    + " n: (b&&b.__opts)?b.__opts.length:0 }; })";
  report.triggers = await json(trigExpr);
  report.triggers.forEach((t) => { if (t.tag !== 'BUTTON' || !t.n) { errors.push('trigger-bad:' + JSON.stringify(t)); } });

  // ② 点开星期下拉 → 选项数 / 当前项 / 毛玻璃；选中后回写 + change 事件
  await run("document.getElementById('manWeekday').click()");
  await wait(280);
  report.picker.open = await json("(function(){ var root=document.querySelector('.pk-root');"
    + " return { exists: !!root, n: root?root.querySelectorAll('.pk-opt').length:0,"
    + " title: root?((root.querySelector('.modal-title')||{}).textContent||''):'',"
    + " onLabel: root?(((root.querySelector('.pk-opt.on .pk-txt')||{}).textContent)||'').trim():'',"
    + " glass: root?getComputedStyle(root.querySelector('.pk-card')).backdropFilter:'' }; })()");
  await run("(function(){ window.__chg=0; var b=document.getElementById('manWeekday');"
    + " b.addEventListener('change', function(){ window.__chg++; });"
    + " var opts=document.querySelectorAll('.pk-root .pk-opt'); opts[4].click(); return 'clicked'; })()");
  await wait(460);
  report.picker.picked = await json("(function(){ var b=document.getElementById('manWeekday');"
    + " return { value: b.value, label: ((b.querySelector('.pick-txt')||{}).textContent||'').trim(),"
    + " changes: window.__chg, rootLeft: document.querySelectorAll('.pk-root').length }; })()");

  // ③ 点遮罩关闭
  await run("document.getElementById('manPeriodStart').click()");
  await wait(260);
  const opened = await run("document.querySelectorAll('.pk-root .pk-opt').length");
  await run("document.querySelector('.pk-root .modal-scrim').click()");
  await wait(460);
  report.picker.scrimClose = { opened: opened, left: await run("document.querySelectorAll('.pk-root').length") };

  // ④ 课程编辑器里的 5 个下拉
  await run("AR.UI.show('today')");
  await wait(700);
  report.editorOpened = await run("(function(){"
    + " var item=null, sem=AR.Store.currentSemester();"
    + " try { for(var d=0; d<14 && !item; d++){ var day=new Date(); day.setDate(day.getDate()+d);"
    + " var list=AR.Schedule.dayItems(day, sem); if(list && list.length){ item=list[0]; } } } catch(e){}"
    + " if(!item){ return 'no-item'; } AR.UI.openBlockEditor(item, {}); return 'ok'; })()");
  await wait(700);
  if (report.editorOpened !== 'ok') {
    report.editorPicker = { skipped: true };
    console.log(JSON.stringify(report, null, 2));
    ws.close();
    return;
  }
  const edExpr = "['ebWeekday','ebPStart','ebPEnd','ebWeekMode','ebTrack']"
    + ".map(function(k){ var b=document.getElementById(k); return { id:k, tag: b?b.tagName:'', value: b?b.value:null,"
    + " label: b?((b.querySelector('.pick-txt')||{}).textContent||'').trim():null, n:(b&&b.__opts)?b.__opts.length:0 }; })";
  report.editor = await json(edExpr);
  await run("document.getElementById('ebWeekMode').click()");
  await wait(320);
  report.editorPicker = await json("(function(){ var root=document.querySelector('.pk-root');"
    + " if(!root){ return { exists:false }; } var opts=root.querySelectorAll('.pk-opt'); var labels=[];"
    + " for(var i=0;i<opts.length;i++){ labels.push(opts[i].textContent.trim()); } opts[3].click();"
    + " return { exists:true, labels: labels }; })()");
  await wait(460);
  report.editorAfter = await json("(function(){ var b=document.getElementById('ebWeekMode');"
    + " return { value: b.value, label: ((b.querySelector('.pick-txt')||{}).textContent||'').trim(),"
    + " left: document.querySelectorAll('.pk-root').length, editorAlive: !!document.getElementById('ebName') }; })()");

  console.log(JSON.stringify(report, null, 2));
  ws.close();
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
