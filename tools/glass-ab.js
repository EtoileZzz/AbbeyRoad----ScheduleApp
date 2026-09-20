/**
 * 开发用：毛玻璃「有 / 无 backdrop-filter」的 A/B 对照截图。
 * 用来确认聚焦动画期间关掉模糊到底会不会让面板变暗。
 * 用法：node tools/glass-ab.js --out dist/glass-ab --sel "#zoneNext" [--theme dark|light]
 */
const fs = require('fs');
const path = require('path');
const raw = process.argv.slice(2);
let out = 'dist/glass-ab';
let sel = '#zoneNext';
let theme = '';
for (let i = 0; i < raw.length; i++) {
  const a = raw[i];
  if (a === '--out') { out = raw[++i]; continue; }
  if (a === '--sel') { sel = raw[++i]; continue; }
  if (a === '--theme') { theme = raw[++i]; continue; }
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
  fs.mkdirSync(out, { recursive: true });

  if (theme) {
    await send('Runtime.evaluate', {
      expression: "(function(){var s=AR.Store.get().settings.appearance;s.theme='" + theme +
        "';AR.Store.save();AR.UI.applyTheme();})()", userGesture: true
    });
    await new Promise((r) => setTimeout(r, 500));
  }
  await send('Runtime.evaluate', { expression: "AR.UI.show('today')", userGesture: true });
  await new Promise((r) => setTimeout(r, 600));

  const box = await send('Runtime.evaluate', {
    expression: "JSON.stringify((function(){var r=document.querySelector('" + sel + "').getBoundingClientRect();" +
      "return {x:r.x,y:r.y,width:r.width,height:r.height};})())", returnByValue: true
  });
  const clip = JSON.parse(box.result.result.value);
  clip.scale = 1;

  for (const [name, css] of [['blur', ''], ['noblur', 'backdrop-filter:none!important;-webkit-backdrop-filter:none!important;']]) {
    await send('Runtime.evaluate', {
      expression: "(function(){var n=document.querySelector('" + sel + "');" +
        "n.style.cssText='" + css + "';})()"
    });
    await new Promise((r) => setTimeout(r, 300));
    const shot = await send('Page.captureScreenshot', { format: 'png', clip: clip });
    if (shot.result && shot.result.data) {
      fs.writeFileSync(path.join(out, name + '.png'), Buffer.from(shot.result.data, 'base64'));
    }
  }
  await send('Runtime.evaluate', { expression: "document.querySelector('" + sel + "').style.cssText=''" });
  console.log('输出 → ' + out);
  ws.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
