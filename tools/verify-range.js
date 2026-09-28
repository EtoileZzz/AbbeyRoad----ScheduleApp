/**
 * 开发用：设置页「布局与尺寸」的拖动滑块 —— 用**真实指针事件**验证。
 *
 * 程序化地改 value 只能证明回调没坏，证明不了"手指拖得动"。
 * 这里走 CDP 的 Input.dispatchMouseEvent：按下 → 连续移动 → 抬起，
 * 再看 range.value、右栏宽度、以及设置页的滚动位置有没有被带跑。
 *
 * 用法：$env:CDP_PORT='9333'; node tools/verify-range.js
 */
const port = process.env.CDP_PORT || '9223';
const useTouch = process.argv.indexOf('--touch') >= 0;

async function main() {
  const targets = await fetch('http://127.0.0.1:' + port + '/json').then((r) => r.json());
  const page = targets.find((t) => t.type === 'page') || targets[0];
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const errors = [];
  const send = (method, params) => new Promise((resolve) => {
    const myId = ++id;
    pending.set(myId, resolve);
    ws.send(JSON.stringify({ id: myId, method, params: params || {} }));
  });
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      errors.push((d.exception && d.exception.description) || d.text);
    }
  });
  await new Promise((r) => ws.addEventListener('open', r));
  await send('Runtime.enable');
  const run = async (expr) => {
    const res = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, userGesture: true });
    const r = res.result || {};
    if (r.exceptionDetails) { throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 400)); }
    return r.result ? r.result.value : null;
  };
  const json = async (e) => JSON.parse(await run('JSON.stringify(' + e + ')'));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  async function drag(x1, y1, x2, y2) {
    const steps = 12;
    if (useTouch) {
      // Android 上必须用真触摸事件：range 在 WebView 里对 touch 的处理和鼠标不是一条路
      await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x1, y: y1, id: 1 }] });
      for (let i = 1; i <= steps; i++) {
        const x = x1 + ((x2 - x1) * i) / steps;
        const y = y1 + ((y2 - y1) * i) / steps;
        await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y, id: 1 }] });
        await wait(16);
      }
      await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      return;
    }
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x1, y: y1, button: 'left', clickCount: 1, buttons: 1 });
    for (let i = 1; i <= steps; i++) {
      const x = x1 + ((x2 - x1) * i) / steps;
      const y = y1 + ((y2 - y1) * i) / steps;
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x, y: y, button: 'left', buttons: 1 });
      await wait(16);
    }
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x2, y: y2, button: 'left', buttons: 0 });
  }

  const report = {};

  // 先把可能残留的弹层关掉（别的验收脚本会留下打开着的课程编辑器）
  await run("(function(){ var c=document.querySelector('#modalCard .modal-close'); if(c){ c.click(); }"
    + " var s=document.querySelector('.pk-root .modal-scrim'); if(s){ s.click(); } return 'ok'; })()");
  await wait(700);

  // 进入设置 → 布局与尺寸
  await run("AR.UI.show('settings')");
  await wait(700);
  await run("(function(){ var n=document.querySelector('.settings-nav [data-panel=layout], .settings-nav button[data-key=layout]');"
    + " if(!n){ var bs=document.querySelectorAll('.settings-nav button'); for(var i=0;i<bs.length;i++){ if(bs[i].textContent.indexOf('布局')>=0){ n=bs[i]; break; } } } n&&n.click(); return 'ok'; })()");
  await wait(700);
  // 等面板渲染完再把滑块滚进视野：设置页内容比一屏长，不滚进来量到的坐标在视口外，点不到
  report.scroll = await json("(function(){ var r=document.querySelector('.slider-row input[type=range]');"
    + " if(!r){ return { found:false }; } var box=document.getElementById('settingsBody');"
    + " var y0=r.getBoundingClientRect().top; r.scrollIntoView({block:'center'});"
    + " return { found:true, yBefore:Math.round(y0), yAfter:Math.round(r.getBoundingClientRect().top),"
    + " scrollTop: box?Math.round(box.scrollTop):null, boxCh: box?box.clientHeight:null, boxSh: box?box.scrollHeight:null }; })()");
  await wait(500);

  report.panel = await json("(function(){ var r=document.querySelector('.slider-row input[type=range]');"
    + " if(!r){ return { found:false }; } var b=r.getBoundingClientRect();"
    + " var cs=getComputedStyle(r); var pr=r.parentNode.getBoundingClientRect();"
    + " var mid=document.elementFromPoint(b.left+b.width/2, b.top+b.height/2);"
    + " return { found:true, x:b.left, y:b.top, w:b.width, h:b.height, value:r.value, min:r.min, max:r.max,"
    + " touchAction:cs.touchAction, pointerEvents:cs.pointerEvents,"
    + " hitIsRange: !!(mid && (mid===r || r.contains(mid))), hitTag: mid? mid.tagName+'.'+mid.className : null,"
    + " rowW: Math.round(pr.width) }; })()");

  if (report.panel && report.panel.found) {
    const p = report.panel;
    // 拖动过程中节点会不会被整体重建？（重建 = 手指还在屏幕上，滑块已经不是同一个了）
    await run("(function(){ var r=document.querySelector('.slider-row input[type=range]'); r.__probe=1; return 'ok'; })()");
    const y = p.y + p.h / 2;
    const x1 = p.x + p.w * 0.25;
    const x2 = p.x + p.w * 0.85;
    await drag(x1, y, x2, y);
    await wait(500);
    report.identity = await json("(function(){ var r=document.querySelector('.slider-row input[type=range]');"
      + " var box=document.getElementById('settingsBody');"
      + " return { sameNode: r.__probe===1, connected: r.isConnected, scrollTop: box?Math.round(box.scrollTop):null }; })()");
    report.afterDrag = await json("(function(){ var r=document.querySelector('.slider-row input[type=range]');"
      + " return { value: r.value, label: (r.closest('.slider-row').querySelector('.val')||{}).textContent,"
      + " scrollTop: (document.querySelector('#settingsGrid')||{}).scrollTop,"
      + " nextW: AR.UI.sizeOf('next').w }; })()");
    // 再往回拖一次，确认双向都跟手
    await drag(p.x + p.w * 0.8, y, p.x + p.w * 0.35, y);
    await wait(500);
    report.afterDragBack = await json("(function(){ var r=document.querySelector('.slider-row input[type=range]');"
      + " return { value: r.value, nextW: AR.UI.sizeOf('next').w }; })()");
    // − / + 微调按钮
    // 按下 + 抬起都要发：只发 pointerdown 会让"长按连续 +"一直跑下去，后面的用例全被它污染
    await run("(function(){ var b=document.querySelector('.slider-row .sld-step[data-step=\"1\"]');"
      + " b.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));"
      + " b.dispatchEvent(new PointerEvent('pointerup',{bubbles:true})); return 'ok'; })()");
    await wait(200);
    report.afterPlus = await json("(function(){ var r=document.querySelector('.slider-row input[type=range]'); return { value: r.value }; })()");

    /**
     * 纵向拖（手指从滑块上开始往上滑）：必须能正常滚设置页。
     * 以前滑块写的是 touch-action:none —— 手指落在它上面页面就完全滚不动，
     * 而它几乎占满一整行，手机上感觉就是"这个滑块没法用"。
     */
    // 重新量一次：前面几次拖动改的是布局，面板里的东西可能已经挪过位置
    const fresh = await json("(function(){ var r=document.querySelector('.slider-row input[type=range]');"
      + " var b=r.getBoundingClientRect();"
      + " return { x:b.left, y:b.top, w:b.width, h:b.height, v:r.value,"
      + "  scroll:Math.round(document.getElementById('settingsBody').scrollTop) }; })()");
    await drag(fresh.x + fresh.w * 0.5, fresh.y + fresh.h / 2, fresh.x + fresh.w * 0.5, fresh.y + fresh.h / 2 - 140);
    await wait(500);
    report.verticalScroll = await json("(function(){ var r=document.querySelector('.slider-row input[type=range]');"
      + " return { scrollBefore:" + fresh.scroll + ", scrollAfter:Math.round(document.getElementById('settingsBody').scrollTop),"
      + " valueBefore:'" + fresh.v + "', valueAfter:r.value }; })()");
  }

  report.errors = errors.slice(0, 3);
  console.log(JSON.stringify(report, null, 2));
  ws.close();
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
