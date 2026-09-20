/**
 * 开发用：把「聚焦放大」动画定格在指定时间点逐张截图，用来看清每一阶段的观感
 * （是否变暗、是否变形、几何是否连贯）。做法是点击后立刻 pause 所有 WAAPI/CSS
 * 动画，再用 currentTime 精确定位。
 *
 * 用法：
 *   node tools/morph-shots.js --out dist/morph --times 0,60,120,180,240,320,430 --zone next
 * 前置：Windows 端 ABBEYROAD_DEBUG=1（CDP 9223）或 Android adb forward 9222。
 */
const fs = require('fs');
const path = require('path');

const raw = process.argv.slice(2);
let out = 'dist/morph';
let times = [0, 60, 120, 180, 240, 320, 430];
let zone = 'next';
let collapse = false;
for (let i = 0; i < raw.length; i++) {
  const a = raw[i];
  if (a === '--collapse') { collapse = true; continue; }
  if (a === '--out') { out = raw[++i]; continue; }
  if (a === '--times') { times = raw[++i].split(',').map(Number); continue; }
  if (a === '--zone') { zone = raw[++i]; continue; }
}
const port = process.env.CDP_PORT || '9223';
const zoneId = 'zone' + zone.charAt(0).toUpperCase() + zone.slice(1);
const ZONES = ['week', 'today', 'next'];
const zoneExpr = (k) => "document.getElementById('zone" + k.charAt(0).toUpperCase() + k.slice(1) + "')";

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

  // 回到收起态并等干净（注意：再点一次栏位不会收起，必须点栏内的 ✕ 按钮）
  await send('Runtime.evaluate', {
    expression: "AR.UI.show('today');(function(){var n=" + zoneExpr(zone) +
      ";if(n.classList.contains('expanded')){n.querySelector('.zone-toggle').click();}})()",
    userGesture: true
  });
  await new Promise((r) => setTimeout(r, 900));

  // 收起动画：先展开，等落定，再点 ✕
  if (collapse) {
    await send('Runtime.evaluate', { expression: zoneExpr(zone) + ".click()", userGesture: true });
    await new Promise((r) => setTimeout(r, 900));
  }

  // 点击并立刻冻结所有动画
  await send('Runtime.evaluate', {
    expression: "(function(){var n=" + zoneExpr(zone) + ";" +
      (collapse ? "n.querySelector('.zone-toggle').click();" : "n.click();") +
      "requestAnimationFrame(function(){window.__paused=document.getAnimations().filter(function(a){" +
      "var d=a.effect&&a.effect.getTiming?a.effect.getTiming().duration:0;return d&&d>0;});" +
      "window.__paused.forEach(function(a){try{a.pause();}catch(e){}});});})()",
    userGesture: true
  });
  await new Promise((r) => setTimeout(r, 120));

  const info = await send('Runtime.evaluate', {
    expression: "JSON.stringify(window.__paused.map(function(a){return {" +
      "t:(a.effect.target&&(a.effect.target.id||a.effect.target.className))||''," +
      "d:a.effect.getTiming().duration, e:String(a.effect.getTiming().easing)," +
      "p:(a.effect.getKeyframes&&a.effect.getKeyframes()||[]).map(function(k){return k.transform||k.opacity;})};}))",
    returnByValue: true
  });
  console.log('冻结动画：' + (info.result.result.value || '[]').slice(0, 900));

  for (const t of times) {
    const geo = await send('Runtime.evaluate', {
      expression: "window.__paused.forEach(function(a){try{a.currentTime=" + t + ";}catch(e){}});'ok'"
    });
    void geo;
    await new Promise((r) => setTimeout(r, 60));
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    if (shot.result && shot.result.data) {
      fs.writeFileSync(path.join(out, 't' + String(t).padStart(3, '0') + '.png'),
        Buffer.from(shot.result.data, 'base64'));
    }
    // 顺便打印这一时刻三栏的真实矩形，方便判断"几何到底有没有在动"
    const rects = await send('Runtime.evaluate', {
      expression: "['week','today','next'].map(function(k){var n=document.getElementById('zone'+k.charAt(0).toUpperCase()+k.slice(1));" +
        "var r=n.getBoundingClientRect();return k+'='+Math.round(r.left)+','+Math.round(r.top)+' '+Math.round(r.width)+'x'+Math.round(r.height);}).join(' | ')",
      returnByValue: true
    });
    console.log('  t=' + String(t).padStart(3) + 'ms  ' + rects.result.result.value);
  }
  // 收尾：取消冻结，恢复自然状态
  await send('Runtime.evaluate', { expression: "window.__paused.forEach(function(a){try{a.cancel();}catch(e){}});'done'" });
  await new Promise((r) => setTimeout(r, 300));
  await send('Runtime.evaluate', { expression: "AR.UI.renderToday();'rerender'" });
  console.log('输出 → ' + out + '（' + times.join(',') + 'ms）');
  ws.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
