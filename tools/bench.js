/**
 * 开发用：测一段交互期间的「主线程帧间隔」，用来判断动画是否掉帧。
 * 它只测主线程节奏（掉帧时 rAF 间隔会变大），配合真机/模拟器看更有意义。
 *
 * 用法：
 *   node tools/bench.js --ms 1200 "AR.UI.show('today');document.getElementById('zoneNext').click()"
 *   CDP_PORT=9222 node tools/bench.js ...        # 模拟器
 * 前置：Windows ABBEYROAD_DEBUG=1（9223）/ Android adb forward（9222）
 */
const raw = process.argv.slice(2);
let ms = 1200;
let label = 'run';
const rest = [];
for (let i = 0; i < raw.length; i++) {
  const a = raw[i];
  if (a === '--ms') { ms = Number(raw[++i]) || 1200; continue; }
  if (a === '--label') { label = raw[++i]; continue; }
  rest.push(a);
}
const expr = rest.join(' ');
const port = process.env.CDP_PORT || '9223';

const RECORDER = `
(function (ms) {
  var rec = { frames: [], done: false, t0: 0 };
  window.__bench = rec;
  function step(t) {
    if (!rec.t0) { rec.t0 = t; }
    rec.frames.push(+(t - rec.t0).toFixed(2));
    if (t - rec.t0 < ms) { requestAnimationFrame(step); } else { rec.done = true; }
  }
  requestAnimationFrame(step);
})(${ms})`;

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
  await send('Runtime.evaluate', { expression: RECORDER, userGesture: true });
  await new Promise((r) => setTimeout(r, 100));
  await send('Runtime.evaluate', { expression: expr, userGesture: true, returnByValue: true });
  await new Promise((r) => setTimeout(r, ms + 250));
  const res = await send('Runtime.evaluate', {
    expression: 'JSON.stringify(window.__bench.frames)', returnByValue: true
  });
  const t = JSON.parse(res.result.result.value);
  const d = [];
  for (let i = 1; i < t.length; i++) { d.push(+(t[i] - t[i - 1]).toFixed(2)); }
  const sorted = d.slice().sort((a, b) => a - b);
  const q = (p) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : 0;
  const over = (v) => d.filter((x) => x > v).length;
  console.log('[' + label + '] 帧数=' + d.length + ' 时长=' + (t.length ? t[t.length - 1] : 0) + 'ms');
  console.log('  间隔 p50=' + q(0.5) + ' p90=' + q(0.9) + ' p99=' + q(0.99) +
    ' max=' + (sorted.length ? sorted[sorted.length - 1] : 0) + 'ms');
  console.log('  >20ms=' + over(20) + ' 帧, >33ms=' + over(33) + ' 帧, >50ms=' + over(50) + ' 帧');
  console.log('  间隔序列: ' + d.slice(0, 60).join(' '));
  ws.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
