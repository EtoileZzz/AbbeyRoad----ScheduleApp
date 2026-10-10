// 直板机宽度（390px）设置首页截图 + 高频项布局一致性检查
const port = process.env.CDP_PORT || '9333';
const fs = require('fs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ts = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json());
  const p = ts.find((t) => t.type === 'page' && /8123/.test(t.url || ''));
  const ws = new WebSocket(p.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let seq = 0;
  const pending = new Map();
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  const cmd = (method, params) => new Promise((res, rej) => {
    const id = ++seq;
    const t = setTimeout(() => rej(new Error('timeout ' + method)), 15000);
    pending.set(id, (m) => { clearTimeout(t); res(m.result); });
    ws.send(JSON.stringify({ id, method, params: params || {} }));
  });
  const ev = async (expr) => {
    const r = await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    return r && r.result ? r.result.value : undefined;
  };
  await cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(400);
  console.log('layout:', await ev(`(function(){
    AR.UI.show('settings');
    var rows = document.querySelectorAll('#settingsGrid .q-item');
    var out = [];
    for (var i = 0; i < rows.length; i++) {
      var ctl = rows[i].querySelector('.segmented, .switch, .q-swatches, .q-btns, .q-step, .q-ver, .chip-btn');
      var r = rows[i].getBoundingClientRect();
      var cr = ctl ? ctl.getBoundingClientRect() : null;
      out.push({ label: rows[i].textContent.slice(0, 6), w: Math.round(r.width), ctl: ctl ? ctl.className.split(' ')[0] : '-',
        cw: cr ? Math.round(cr.width) : 0, right: cr ? Math.round(390 - cr.right) : -1 });
    }
    var segs = document.querySelectorAll('#settingsGrid .q-item .segmented');
    var sw = [];
    for (var s = 0; s < segs.length; s++) { sw.push(Math.round(segs[s].getBoundingClientRect().width)); }
    return JSON.stringify({ items: out, segWidths: sw.join(','), body: Math.round(document.getElementById('settingsBody').getBoundingClientRect().width) });
  })()`));
  await sleep(800);   // 等统一入场动画播完再截图（不然拍到的是动画第一帧）
  const shot = await cmd('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(process.argv[2] || 'shot-settings-390.png', Buffer.from(shot.data, 'base64'));
  console.log('shot saved');
  await cmd('Emulation.clearDeviceMetricsOverride');
  process.exit(0);
})().catch((e) => { console.error('ERR', e.message); process.exit(2); });
