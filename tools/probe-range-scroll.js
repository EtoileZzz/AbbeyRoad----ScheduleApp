/**
 * 开发用：盯一次"手指落在滑块上纵向滑"的完整事件序列。
 * 用来确认：纵向手势不该改值（值要还原）、页面要滚起来。
 * 用法：$env:CDP_PORT='9222'; node tools/probe-range-scroll.js
 */
const port = process.env.CDP_PORT || '9222';

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
  const run = async (expr) => {
    const res = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, userGesture: true });
    if (res.result && res.result.exceptionDetails) { throw new Error(JSON.stringify(res.result.exceptionDetails).slice(0, 300)); }
    return res.result && res.result.result ? res.result.result.value : null;
  };

  const rect = JSON.parse(await run("(function(){ var r=document.querySelector('.slider-row input[type=range]');"
    + " if(!r) return 'null'; r.scrollIntoView({block:'center'});"
    + " window.__log=[]; ['pointerdown','pointermove','pointerup','pointercancel','input','change','click','touchstart','touchmove','touchend','touchcancel']"
    + ".forEach(function(t){ r.addEventListener(t, function(ev){ window.__log.push(t + ' y=' + (ev.clientY==null?'-':Math.round(ev.clientY)) + ' v=' + r.value); }, true); });"
    + " var b=r.getBoundingClientRect(); return JSON.stringify({x:b.left,y:b.top,w:b.width,h:b.height, v:r.value}); })()"));
  if (!rect) { console.log('没找到滑块'); ws.close(); return; }

  const x = rect.x + rect.w / 2, y = rect.y + rect.h / 2;
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
  for (let i = 1; i <= 10; i++) {
    await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - i * 14, id: 1 }] });
    await new Promise((r) => setTimeout(r, 16));
  }
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await new Promise((r) => setTimeout(r, 600));

  const out = await run("JSON.stringify({ v:document.querySelector('.slider-row input[type=range]').value,"
    + " scroll:Math.round(document.getElementById('settingsBody').scrollTop), log:window.__log.slice(0,20) })");
  console.log(JSON.stringify({ before: rect.v, after: JSON.parse(out) }, null, 2));
  ws.close();
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
