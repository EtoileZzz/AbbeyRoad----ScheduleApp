/**
 * 开发用：点击后按帧抓图，用来肉眼检查动画（入场 / 弹窗 / 聚焦）。
 * 用法：
 *   node tools/frames.js --out shots/modal --n 10 --gap 60 "document.querySelector('.wt-block').click()"
 */
const rawArgs = process.argv.slice(2);
let out = 'shots/frames';
let n = 10;
let gap = 60;
const rest = [];
for (let i = 0; i < rawArgs.length; i++) {
  const a = rawArgs[i];
  if (a === '--out') { out = rawArgs[++i]; continue; }
  if (a === '--n') { n = Number(rawArgs[++i]) || 10; continue; }
  if (a === '--gap') { gap = Number(rawArgs[++i]) || 60; continue; }
  rest.push(a);
}
const expr = rest.join(' ');
const port = process.env.CDP_PORT || '9222';
const fs = require('fs');
const path = require('path');

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
  await send('Page.enable');
  fs.mkdirSync(out, { recursive: true });

  if (expr) { await send('Runtime.evaluate', { expression: expr, returnByValue: true, userGesture: true }); }
  for (let i = 0; i < n; i++) {
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    if (shot.result && shot.result.data) {
      fs.writeFileSync(path.join(out, 'f' + String(i).padStart(3, '0') + '.png'), Buffer.from(shot.result.data, 'base64'));
    }
    await new Promise((r) => setTimeout(r, gap));
  }
  console.log('已抓 ' + n + ' 帧 → ' + out);
  ws.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
