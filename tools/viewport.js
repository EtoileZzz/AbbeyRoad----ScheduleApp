/**
 * 开发用：把页面按手机/平板的逻辑分辨率渲染，截图检查排版（Windows 端快速验证窄屏）。
 * 用法：node tools/viewport.js --w 412 --h 915 --dpr 2.5 --out dist/phone [--expr "..."]
 *      留空 --expr 就只截图；给了表达式就先执行（支持 promise）。
 */
const fs = require('fs');
const path = require('path');
const raw = process.argv.slice(2);
let w = 412, h = 915, dpr = 2.5, out = 'dist/phone', expr = '';
let clear = false;
let mobile = true;
for (let i = 0; i < raw.length; i++) {
  const a = raw[i];
  if (a === '--clear') { clear = true; continue; }
  if (a === '--desktop') { mobile = false; continue; }
  if (a === '--w') { w = Number(raw[++i]); continue; }
  if (a === '--h') { h = Number(raw[++i]); continue; }
  if (a === '--dpr') { dpr = Number(raw[++i]); continue; }
  if (a === '--out') { out = raw[++i]; continue; }
  if (a === '--expr') { expr = raw[++i]; continue; }
}
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
  await send('Page.enable');
  if (clear) {
    await send('Emulation.clearDeviceMetricsOverride');
    await send('Page.reload');
    await new Promise((r) => setTimeout(r, 1500));
    console.log('已恢复真实窗口尺寸');
    ws.close();
    return;
  }
  await send('Emulation.setDeviceMetricsOverride', {
    width: w, height: h, deviceScaleFactor: dpr, mobile: mobile
  });
  await send('Page.reload');
  await new Promise((r) => setTimeout(r, 1800));
  if (expr) {
    await send('Runtime.evaluate', { expression: expr, userGesture: true, awaitPromise: true, returnByValue: true });
    await new Promise((r) => setTimeout(r, 500));
  }
  fs.mkdirSync(out, { recursive: true });
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  if (shot.result && shot.result.data) {
    fs.writeFileSync(path.join(out, 'phone-' + w + 'x' + h + '.png'), Buffer.from(shot.result.data, 'base64'));
  }
  console.log('输出 → ' + out + ' (' + w + 'x' + h + ')');
  ws.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
