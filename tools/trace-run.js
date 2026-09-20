/**
 * 开发用：录一段 Chrome trace，看动画期间「谁在吃时间」——
 * 主线程的 Paint / Layout / UpdateLayerTree，还是合成线程的帧提交。
 * 掉帧的真相都在这里，rAF 间隔看不出来。
 *
 * 用法：
 *   node tools/trace-run.js --ms 1200 "document.getElementById('zoneNext').click()"
 *   CDP_PORT=9222 node tools/trace-run.js ...   # 模拟器
 */
const fs = require('fs');
const raw = process.argv.slice(2);
let ms = 1200;
let top = 22;
let save = '';
const rest = [];
for (let i = 0; i < raw.length; i++) {
  const a = raw[i];
  if (a === '--ms') { ms = Number(raw[++i]) || 1200; continue; }
  if (a === '--top') { top = Number(raw[++i]) || 22; continue; }
  if (a === '--save') { save = raw[++i]; continue; }
  rest.push(a);
}
const expr = rest.join(' ');
const port = process.env.CDP_PORT || '9223';

async function main() {
  const targets = await fetch('http://127.0.0.1:' + port + '/json').then((r) => r.json());
  const page = targets.find((t) => t.type === 'page') || targets[0];
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const events = [];
  const send = (method, params) => new Promise((resolve) => {
    const myId = ++id;
    pending.set(myId, resolve);
    ws.send(JSON.stringify({ id: myId, method, params: params || {} }));
  });
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
    if (msg.method === 'Tracing.dataCollected') { events.push.apply(events, msg.params.value); }
  });
  await new Promise((r) => ws.addEventListener('open', r));

  await send('Tracing.start', {
    categories: ['devtools.timeline', 'benchmark', 'disabled-by-default-devtools.timeline.frame',
      'cc', 'latencyInfo', 'viz', 'blink', 'gpu'].join(','),
    transferMode: 'ReportEvents'
  });
  await new Promise((r) => setTimeout(r, 150));
  await send('Runtime.evaluate', { expression: expr, userGesture: true, returnByValue: true });
  await new Promise((r) => setTimeout(r, ms));
  await send('Tracing.end');
  await new Promise((r) => setTimeout(r, 900));

  if (save) { fs.writeFileSync(save, JSON.stringify(events)); }
  const dur = (e) => (e.dur || 0);
  const groups = new Map();
  for (const e of events) {
    if (e.ph !== 'X' || !e.dur) { continue; }
    const key = e.name;
    let g = groups.get(key);
    if (!g) { g = { n: 0, total: 0, max: 0 }; groups.set(key, g); }
    g.n++; g.total += dur(e); if (dur(e) > g.max) { g.max = dur(e); }
  }
  const rows = Array.from(groups.entries()).map(([k, v]) => ({ name: k, n: v.n, total: v.total, max: v.max }))
    .sort((a, b) => b.total - a.total).slice(0, top);
  console.log('事件总数=' + events.length + '  耗时统计（总时长 ms / 次数 / 单次最长 ms）');
  for (const r of rows) {
    console.log('  ' + r.name.slice(0, 44).padEnd(46) + r.total.toFixed(1).padStart(9) +
      String(r.n).padStart(6) + r.max.toFixed(2).padStart(10));
  }
  // 逐帧：PipelineReporter / DrawFrame 的间隔与耗时
  const frames = events.filter((e) => e.name === 'PipelineReporter' && e.ph === 'X');
  if (frames.length) {
    const d = frames.map((e) => e.dur).sort((a, b) => a - b);
    const q = (p) => d[Math.min(d.length - 1, Math.floor(d.length * p))];
    console.log('帧提交次数=' + frames.length + ' 单帧耗时 p50=' + q(0.5).toFixed(2) + ' p90=' +
      q(0.9).toFixed(2) + ' p99=' + q(0.99).toFixed(2) + ' max=' + d[d.length - 1].toFixed(2) + 'ms');
    console.log('  超过 16.7ms 的帧：' + d.filter((x) => x > 16.7).length +
      '，超过 33ms：' + d.filter((x) => x > 33).length);
  }
  ws.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
