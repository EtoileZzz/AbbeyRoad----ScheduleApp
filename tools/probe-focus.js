/**
 * 开发用：逐帧记录「今日页聚焦放大」时的合成指标。
 * 用法：node tools/probe-focus.js [zoneKey]   # zoneKey: today | week | next
 * 前置：Windows 端以 ABBEYROAD_DEBUG=1 启动，CDP 9223。
 */
const zoneKey = process.argv[2] || 'next';
const port = process.env.CDP_PORT || '9223';

const zoneId = 'zone' + zoneKey.charAt(0).toUpperCase() + zoneKey.slice(1);

const EXPR = `
(function () {
  var zone = document.getElementById('${zoneId}');
  var ids = ['week', 'today', 'next'];
  var log = [];
  var t0 = 0;
  var stopped = false;
  window.__probe = { frames: log, done: false };
  function sample(t) {
    if (!t0) { t0 = t; }
    var rec = { t: +(t - t0).toFixed(1) };
    for (var i = 0; i < ids.length; i++) {
      var n = document.getElementById('zone' + ids[i].charAt(0).toUpperCase() + ids[i].slice(1));
      if (!n) { continue; }
      var cs = getComputedStyle(n);
      var r = n.getBoundingClientRect();
      rec[ids[i]] = {
        op: cs.opacity,
        bf: cs.backdropFilter || cs.webkitBackdropFilter,
        tf: cs.transform,
        w: Math.round(r.width),
        cls: n.className.replace('zone zone-', '')
      };
    }
    log.push(rec);
    if (!stopped && t - t0 < 1400) { requestAnimationFrame(sample); }
    else { window.__probe.done = true; }
  }
  requestAnimationFrame(sample);
  setTimeout(function () { zone.click(); }, 120);
  return 'armed';
})()`;

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
  await new Promise((r) => setTimeout(r, 400));
  const armed = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true, userGesture: true });
  if (armed.result && armed.result.exceptionDetails) {
    console.error('探针注入失败：' + JSON.stringify(armed.result.exceptionDetails).slice(0, 800));
  }
  await new Promise((r) => setTimeout(r, 1900));
  const res = await send('Runtime.evaluate', {
    expression: 'JSON.stringify(window.__probe.frames)', returnByValue: true
  });
  if (!res.result || !res.result.result || res.result.result.value == null) {
    console.error('探针取值失败：' + JSON.stringify(res.result).slice(0, 600));
    ws.close();
    process.exit(3);
  }
  const frames = JSON.parse(res.result.result.value);
  let prev = 0;
  const rows = frames.map((f) => {
    const dt = +(f.t - prev).toFixed(1);
    prev = f.t;
    return { t: f.t, dt: dt, next: f.next, today: f.today, week: f.week };
  });
  console.log('帧数=' + rows.length);
  const dts = rows.map((r) => r.dt).filter((d) => d > 0);
  const long = dts.filter((d) => d > 20);
  console.log('最长帧=' + Math.max.apply(null, dts).toFixed(1) + 'ms  平均=' +
    (dts.reduce((a, b) => a + b, 0) / dts.length).toFixed(1) + 'ms  >20ms 帧数=' + long.length);
  console.log('t(ms)  dt  next{op,bf,tf,w,cls} | today{w,cls}');
  for (const r of rows) {
    const n = r.next || {};
    console.log([
      String(r.t).padStart(6), String(r.dt).padStart(6),
      'op=' + (n.op || ''), 'bf=' + String(n.bf || '').slice(0, 10),
      'w=' + n.w, 'cls=' + n.cls,
      '| today w=' + (r.today ? r.today.w : '') + ' ' + (r.today ? r.today.cls : '')
    ].join(' '));
  }
  ws.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
