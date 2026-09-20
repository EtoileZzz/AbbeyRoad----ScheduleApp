/**
 * 开发用：通过 Chrome DevTools Protocol 直接驱动 App 里的 WebView。
 * 前置：adb forward tcp:9222 localabstract:chrome_devtools_remote
 *
 * 用法：
 *   node tools/cdp.js "AR.Const.APP_VERSION"
 *   node tools/cdp.js --watch "location.href"      # 顺便打印 1.5 秒内的报错
 */

// 端口：Android（adb forward 9222）/ Windows（WebView2 调试端口 9223）
const port = process.env.CDP_PORT || '9222';
const url = 'http://127.0.0.1:' + port + '/json';
const rawArgs = process.argv.slice(2);
const watch = rawArgs.indexOf('--watch') >= 0;
let shotPath = null;
let waitMs = 0;
const rest = [];
for (let i = 0; i < rawArgs.length; i++) {
  const a = rawArgs[i];
  if (a === '--watch') { continue; }
  if (a === '--shot') { shotPath = rawArgs[++i]; continue; }
  if (a === '--wait') { waitMs = Number(rawArgs[++i]) || 0; continue; }
  rest.push(a);
}
const expr = rest.join(' ');

async function main() {
  const targets = await fetch(url).then((r) => r.json()).catch((e) => {
    console.error('无法连接 CDP，请先执行 adb forward：' + e.message);
    process.exit(2);
  });
  const page = targets.find((t) => t.type === 'page') || targets[0];
  if (!page) { console.error('没有找到页面目标'); process.exit(3); }

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
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
      return;
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      console.error('EXCEPTION: ' + (d.exception && d.exception.description ? d.exception.description : d.text));
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      console.error('CONSOLE.ERROR: ' + msg.params.args.map((a) => a.value || a.description || '').join(' '));
    }
  });

  await new Promise((resolve) => ws.addEventListener('open', resolve));
  await send('Runtime.enable');
  await send('Log.enable');

  if (!expr) { console.log('已连接：' + page.url); }

  if (expr) {
    const res = await send('Runtime.evaluate', {
      expression: expr,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true
    });
    if (res.result && res.result.exceptionDetails) {
      console.error('EVAL ERROR: ' + JSON.stringify(res.result.exceptionDetails).slice(0, 600));
      process.exitCode = 1;
    } else if (res.result && res.result.result) {
      const v = res.result.result.value;
      console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 2));
    }
  }

  if (waitMs) { await new Promise((r) => setTimeout(r, waitMs)); }

  if (shotPath) {
    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const data = shot.result && shot.result.data;
    if (!data) { console.error('截图失败'); process.exitCode = 1; }
    else {
      require('fs').writeFileSync(shotPath, Buffer.from(data, 'base64'));
      console.log('截图已保存：' + shotPath);
    }
  }
  if (watch) { await new Promise((r) => setTimeout(r, 1200)); }
  ws.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
