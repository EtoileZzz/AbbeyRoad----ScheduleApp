/**
 * 开发用：用 CDP 录屏（Page.startScreencast）抓「真实合成出来的每一帧」，
 * 用来检查动画是否掉帧、是否变暗。比定时截图准，因为它跟着合成器出帧。
 *
 * 用法：
 *   node tools/screencast.js --out dist/cast --ms 1200 --jpeg "document.getElementById('zoneNext').click()"
 * 说明：
 *   --ms   录制时长（默认 1200）
 *   --fps  每秒最多抓多少帧（默认 60，0=不限）
 *   --jpeg 输出 jpg（默认 png，体积小很多）
 * 前置：Windows 端 ABBEYROAD_DEBUG=1（CDP 9223）或 Android 端 adb forward 9222。
 */
const fs = require('fs');
const path = require('path');

const raw = process.argv.slice(2);
let out = 'dist/cast';
let ms = 1200;
let fps = 60;
let jpeg = false;
const rest = [];
for (let i = 0; i < raw.length; i++) {
  const a = raw[i];
  if (a === '--out') { out = raw[++i]; continue; }
  if (a === '--ms') { ms = Number(raw[++i]) || 1200; continue; }
  if (a === '--fps') { fps = Number(raw[++i]); continue; }
  if (a === '--jpeg') { jpeg = true; continue; }
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
  const send = (method, params) => new Promise((resolve) => {
    const myId = ++id;
    pending.set(myId, resolve);
    ws.send(JSON.stringify({ id: myId, method, params: params || {} }));
  });

  fs.mkdirSync(out, { recursive: true });
  const frames = [];
  let t0 = 0;

  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
    if (msg.method === 'Page.screencastFrame') {
      const meta = msg.params.metadata || {};
      const ts = meta.timestamp ? meta.timestamp * 1000 : Date.now();
      if (!t0) { t0 = ts; }
      frames.push({ t: Math.round(ts - t0), data: msg.params.data });
      send('Page.screencastFrameAck', { sessionId: msg.params.sessionId });
    }
  });
  await new Promise((r) => ws.addEventListener('open', r));
  await send('Page.enable');
  await send('Page.startScreencast', {
    format: jpeg ? 'jpeg' : 'png',
    quality: jpeg ? 88 : undefined,
    everyNthFrame: fps > 0 ? Math.max(1, Math.round(60 / fps)) : 1,
    maxWidth: 1280, maxHeight: 800
  });

  if (expr) {
    await new Promise((r) => setTimeout(r, 200));
    await send('Runtime.evaluate', { expression: expr, returnByValue: true, userGesture: true });
  }
  await new Promise((r) => setTimeout(r, ms));
  await send('Page.stopScreencast');
  await new Promise((r) => setTimeout(r, 150));

  const ext = jpeg ? '.jpg' : '.png';
  let prev = 0;
  const gaps = [];
  frames.forEach((f, i) => {
    fs.writeFileSync(path.join(out, 'f' + String(i).padStart(3, '0') + '_t' + String(f.t).padStart(4, '0') + ext),
      Buffer.from(f.data, 'base64'));
    if (i) { gaps.push(f.t - prev); }
    prev = f.t;
  });
  gaps.sort((a, b) => a - b);
  const p = (q) => (gaps.length ? gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * q))] : 0);
  console.log('抓帧数=' + frames.length + ' 时长=' + (frames.length ? frames[frames.length - 1].t : 0) + 'ms');
  console.log('帧间隔 p50=' + p(0.5) + 'ms p90=' + p(0.9) + 'ms p99=' + p(0.99) + 'ms max=' + (gaps.length ? gaps[gaps.length - 1] : 0) + 'ms');
  console.log('输出 → ' + out);
  ws.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
