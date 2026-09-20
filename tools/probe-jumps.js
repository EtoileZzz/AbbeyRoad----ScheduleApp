/**
 * 开发用：连续快点「聚焦放大 / 收起」时，逐帧记录三栏矩形，
 * 找出"单帧位移异常大"的跳变（动画被打断后从头开始就会出现这种跳）。
 * 用法：node tools/probe-jumps.js [--gap 160] [--n 4]
 */
const raw = process.argv.slice(2);
let gap = 160, n = 4;
for (let i = 0; i < raw.length; i++) {
  if (raw[i] === '--gap') { gap = Number(raw[++i]) || 160; }
  if (raw[i] === '--n') { n = Number(raw[++i]) || 4; }
}
const port = process.env.CDP_PORT || '9223';

const EXPR = `
(function (gap, n) {
  var ids = ['week', 'today', 'next'];
  var log = [];
  var t0 = 0, stop = false, clicks = 0;
  window.__jump = { frames: log, done: false };
  function node(i) { return document.getElementById('zone' + i.charAt(0).toUpperCase() + i.slice(1)); }
  function rect() {
    var o = {};
    for (var i = 0; i < ids.length; i++) {
      var r = node(ids[i]).getBoundingClientRect();
      o[ids[i]] = [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)];
    }
    return o;
  }
  function step(t) {
    if (!t0) { t0 = t; }
    log.push({ t: +(t - t0).toFixed(1), r: rect() });
    if (!stop && t - t0 < gap * (n + 2)) { requestAnimationFrame(step); } else { window.__jump.done = true; }
  }
  requestAnimationFrame(step);
  var targets = ['next', 'today', 'week', 'next'];
  for (var k = 0; k < n; k++) {
    (function (k) {
      setTimeout(function () {
        var z = node(targets[k % targets.length]);
        if (z.classList.contains('expanded')) { z.querySelector('.zone-toggle').click(); }
        else { z.click(); }
        clicks++;
      }, 120 + k * gap);
    })(k);
  }
  setTimeout(function () { stop = true; }, 120 + n * gap + 200);
  return 'armed';
})(${gap}, ${n})`;

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
  await send('Runtime.evaluate', { expression: 'AR.UI.show("today")', userGesture: true });
  await new Promise((r) => setTimeout(r, 500));
  await send('Runtime.evaluate', { expression: EXPR, returnByValue: true, userGesture: true });
  await new Promise((r) => setTimeout(r, gap * (n + 2) + 700));
  const res = await send('Runtime.evaluate', { expression: 'JSON.stringify(window.__jump.frames)', returnByValue: true });
  const frames = JSON.parse(res.result.result.value);
  const ids = ['week', 'today', 'next'];
  const worst = {};
  for (const k of ids) { worst[k] = { d: 0, t: 0, from: null, to: null }; }
  for (let i = 1; i < frames.length; i++) {
    for (const k of ids) {
      const a = frames[i - 1].r[k], b = frames[i].r[k];
      const d = Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]),
        Math.abs(a[2] - b[2]), Math.abs(a[3] - b[3]));
      if (d > worst[k].d) { worst[k] = { d: d, t: frames[i].t, from: a, to: b }; }
    }
  }
  console.log('采样帧数=' + frames.length + '（间隔约 16.7ms，单帧位移 > 80px 视为跳变）');
  for (const k of ids) {
    const w = worst[k];
    console.log('  ' + k.padEnd(6) + ' 单帧最大变化 ' + String(w.d).padStart(4) + 'px @ t=' + w.t +
      'ms  ' + JSON.stringify(w.from) + ' → ' + JSON.stringify(w.to) + (w.d > 80 ? '   ← 跳变！' : ''));
  }
  ws.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
