/**
 * 0.3.8c 专验（CDP 驱动，连 9333）：
 * T1 快速添加独立逻辑：点了立刻入账、撤销上一笔真删、手输的值永不丢
 * T4 不弹输入法（回归）
 * T2 长期任务独立卡片（回归）
 * T3 「我的」改名 + 默认 4 模块 + 12 模块 + 倒计时 / 待办速记 + 无加载动画
 * T5 加载动画已删（AR.Motion 无「加载」场景），进场走统一 listIn
 *
 * 用法：tools/headless.ps1 起好 8123 + 9333 后：
 *   CDP_PORT=9333 node tools/verify-038c.js
 */
const port = process.env.CDP_PORT || '9333';

async function ev(ws, idRef, expr) {
  return new Promise((resolve, reject) => {
    const myId = ++idRef.n;
    const onMsg = (ev2) => {
      const msg = JSON.parse(ev2.data);
      if (msg.id === myId) {
        ws.removeEventListener('message', onMsg);
        if (msg.result && msg.result.exceptionDetails) {
          reject(new Error('EVAL: ' + (msg.result.exceptionDetails.exception && msg.result.exceptionDetails.exception.description || msg.result.exceptionDetails.text)));
        } else {
          resolve(msg.result && msg.result.result ? msg.result.result.value : undefined);
        }
      }
    };
    ws.addEventListener('message', onMsg);
    ws.send(JSON.stringify({ id: myId, method: 'Runtime.evaluate', params: { expression: expr, awaitPromise: true, returnByValue: true } }));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
function ok(name, cond, detail) {
  const s = cond ? 'PASS' : 'FAIL';
  if (cond) { pass++; } else { fail++; }
  console.log(`[${s}] ${name}${detail ? '  |  ' + detail : ''}`);
  return !!cond;
}

async function main() {
  const targets = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json());
  let page = targets.find((t) => t.type === 'page' && /127\.0\.0\.1:8123|abbeyroad\.local|:8123\//.test(t.url || ''));
  if (!page) {
    page = targets.find((t) => t.type === 'page' && /^https?:/.test(t.url || ''));
  }
  if (!page) { page = targets.find((t) => t.type === 'page') || targets[0]; }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res) => ws.addEventListener('open', res));
  const idRef = { n: 0 };
  const J = (expr) => ev(ws, idRef, expr).then((v) => {
    if (typeof v !== 'string') { return v; }
    try { return JSON.parse(v); } catch (e) { return v; }
  });

  await ev(ws, idRef, `(function(){
    if (typeof AR === 'undefined') { location.href = 'http://127.0.0.1:8123/index.html'; return 'nav'; }
    setTimeout(function(){ location.reload(); }, 30); return 'reload';
  })()`);
  await sleep(1200);
  for (let i = 0; i < 40; i++) {
    const ready = await ev(ws, idRef, `(typeof AR !== 'undefined' && AR.Store && AR.UI && AR.Motion) ? 1 : 0`).catch(() => 0);
    if (ready) { break; }
    await sleep(300);
  }

  // ── 夹具 ─────────────────────────────────────────────────
  const fixture = await J(`(function(){
    var S0 = AR.Store.get();
    if (!(S0.courses || []).length) {
      S0.settings.onboardingCompletedAt = new Date().toISOString();
      var e = AR.MdParse.demoEntities(S0);
      AR.MdParse.applyEntities(e, S0);
      AR.Store.save(true);
    }
    var t = AR.Store.longTaskUpsert({ name: '复验·志愿时长', unit: '小时', target: 20, showInToday: true });
    t.entries = []; AR.Store.save(true);
    var S = AR.Store.get();
    S.countdowns = []; S.quickTodos = [];
    delete S.settings.experimental.customTab;
    AR.Store.save(true);
    return { id: t.id, courses: (S.courses || []).length };
  })()`);
  ok('T0 夹具就绪', fixture && fixture.id && fixture.courses > 0,
    'id=' + (fixture && fixture.id) + ' courses=' + (fixture && fixture.courses));

  // ── T1 快速添加独立逻辑 ──────────────────────────────────
  await J(`AR.UI.openLongTaskEntry(AR.Store.longTaskById(${JSON.stringify(fixture.id)}));'ok'`);
  await sleep(300);

  const chip1 = await J(`(function(){
    var btns = document.querySelectorAll('#ltQuick button');
    var plus1 = null;
    for (var i = 0; i < btns.length; i++) { if (btns[i].textContent === '+1') { plus1 = btns[i]; } }
    if (!plus1) { return { err: 'no +1 chip' }; }
    plus1.click();
    var t = AR.Store.longTaskById(${JSON.stringify(fixture.id)});
    return {
      entries: t.entries.length,
      first: t.entries[0] ? t.entries[0].amount : null,
      undoBtn: !!document.querySelector('#ltQuick .lt-undo'),
      open: AR.UI.modalOpen()
    };
  })()`);
  ok('T1a 点 +1 立刻入账一笔，出现「撤销上一笔」', chip1.entries === 1 && chip1.first === 1 && chip1.undoBtn === true, JSON.stringify(chip1));

  const undo1 = await J(`(function(){
    var u = document.querySelector('#ltQuick .lt-undo');
    if (!u) { return { err: 'no undo btn' }; }
    u.click();
    var t = AR.Store.longTaskById(${JSON.stringify(fixture.id)});
    return { entries: t.entries.length, open: AR.UI.modalOpen() };
  })()`);
  ok('T1b 撤销上一笔真删掉（不是假撤销）', undo1.entries === 0 && undo1.open === true, JSON.stringify(undo1));

  // 核心回归：手输数量 + 快速添加 / 撤销混着用，输入永不丢
  const mixed = await J(`(function(){
    var btns = document.querySelectorAll('#ltQuick button');
    for (var i = 0; i < btns.length; i++) { if (btns[i].textContent === '+5') { btns[i].click(); } }
    document.getElementById('ltAmount').value = '2';
    var rows = document.querySelectorAll('#ltRecent .lt-del');
    if (rows.length) { rows[0].click(); }   // ✕ 删掉刚记的 +5
    var t = AR.Store.longTaskById(${JSON.stringify(fixture.id)});
    return { entries: t.entries.length, input: document.getElementById('ltAmount').value };
  })()`);
  ok('T1c 快速添加 / 删除之后手输的数量还在（用户报的 bug）',
    mixed.entries === 0 && mixed.input === '2', JSON.stringify(mixed));

  const chipKeep = await J(`(function(){
    var btns = document.querySelectorAll('#ltQuick button');
    for (var i = 0; i < btns.length; i++) { if (btns[i].textContent === '+1') { btns[i].click(); } }
    return { input: document.getElementById('ltAmount').value,
             entries: AR.Store.longTaskById(${JSON.stringify(fixture.id)}).entries.length };
  })()`);
  ok('T1d 再点 +1 也不碰输入框', chipKeep.input === '2' && chipKeep.entries === 1, JSON.stringify(chipKeep));

  const saveTyped = await J(`(function(){
    var btns = document.querySelectorAll('.modal-actions .btn');
    for (var i = 0; i < btns.length; i++) { if (btns[i].textContent === '保存') { btns[i].click(); break; } }
    var t = AR.Store.longTaskById(${JSON.stringify(fixture.id)});
    return { entries: t.entries.length, amounts: t.entries.map(function(e){ return e.amount; }), open: AR.UI.modalOpen() };
  })()`);
  ok('T1e 保存按手输的数量入账（+1、+2 两笔）',
    saveTyped.entries === 2 && saveTyped.amounts.join(',') === '1,2' && saveTyped.open === false,
    JSON.stringify(saveTyped));

  const emptySave = await J(`(function(){
    AR.UI.openLongTaskEntry(AR.Store.longTaskById(${JSON.stringify(fixture.id)}));
    return 'ok';
  })()`);
  await sleep(300);
  const emptySave2 = await J(`(function(){
    var btns = document.querySelectorAll('.modal-actions .btn');
    for (var i = 0; i < btns.length; i++) { if (btns[i].textContent === '保存') { btns[i].click(); break; } }
    var t = AR.Store.longTaskById(${JSON.stringify(fixture.id)});
    return { entries: t.entries.length, open: AR.UI.modalOpen() };
  })()`);
  ok('T1f 空数量点保存不入账（只提示）', emptySave2.entries === 2 && emptySave2.open === true, JSON.stringify(emptySave2));
  await J(`AR.UI.closeModal();'ok'`);
  await sleep(350);

  // ── T4 不弹输入法（回归）─────────────────────────────────
  await J(`AR.UI.openLongTaskEntry(AR.Store.longTaskById(${JSON.stringify(fixture.id)}));'ok'`);
  await sleep(250);
  const ae1 = await J(`(function(){ var ae = document.activeElement; return ae ? ae.tagName : 'none'; })()`);
  ok('T4a 记一笔打开后焦点不在输入框', ae1 !== 'INPUT' && ae1 !== 'TEXTAREA', 'activeElement=' + ae1);
  await J(`AR.UI.closeModal();'ok'`);
  await sleep(350);
  await J(`AR.UI.openLongTaskEdit(null);'ok'`);
  await sleep(250);
  const ae2 = await J(`(function(){ var ae = document.activeElement; return ae ? ae.tagName : 'none'; })()`);
  ok('T4b 编辑长期任务打开后焦点不在输入框', ae2 !== 'INPUT' && ae2 !== 'TEXTAREA', 'activeElement=' + ae2);
  await J(`AR.UI.closeModal();'ok'`);
  await sleep(350);

  // ── T2 长期任务独立卡片（回归）──────────────────────────
  const todayDom = await J(`(function(){
    AR.UI.show('today');
    var hw = document.getElementById('hwToday');
    var ltInHw = hw ? hw.querySelectorAll('.lt-row').length : -1;
    var all = document.querySelectorAll('.hw-card');
    var ltCards = 0, ltOutside = true;
    for (var i = 0; i < all.length; i++) {
      var t = all[i].querySelector('.hw-t');
      if (t && t.textContent === '长期任务') {
        ltCards++;
        if (hw && hw.contains(all[i])) { ltOutside = false; }
      }
    }
    return { ltInHw: ltInHw, ltCards: ltCards, ltOutside: ltOutside };
  })()`);
  ok('T2a 作业卡里不夹长期任务', todayDom.ltInHw === 0, JSON.stringify(todayDom));
  ok('T2b 长期任务是独立卡片', todayDom.ltCards >= 1 && todayDom.ltOutside, JSON.stringify(todayDom));

  // ── T3 「我的」/ 模块页（无加载动画，立刻出内容）────────
  const defaults = await J(`(function(){
    var S = AR.Store.get();
    delete S.settings.experimental.customTab;
    AR.Store.save(true);
    var ct = AR.UI.customTabCfg();
    return { modules: (ct.modules || []).join(','), enabled: ct.enabled };
  })()`);
  ok('T3a 默认模块组合是 4 个（含本周课表）',
    defaults.modules === 'homework,longterm,hwstats,weekgrid' && defaults.enabled === false, JSON.stringify(defaults));

  const navOn = await J(`(function(){
    var ct = AR.UI.customTabCfg();
    ct.enabled = true;
    AR.Store.save(true);
    AR.UI.syncCustomTabNav();
    var btns = document.querySelectorAll('.nav-btn');
    var custom = 0, labels = [];
    for (var i = 0; i < btns.length; i++) {
      if (btns[i].getAttribute('data-nav') === 'custom') { custom++; labels.push(btns[i].querySelector('span').textContent); }
    }
    var title = (document.querySelector('#view-custom .view-title') || {}).textContent || '';
    return { custom: custom, labels: labels.join('/'), active: AR.UI.customTabActive(), title: title };
  })()`);
  ok('T3b 开关后「导入」换成「我的」（底栏+侧栏+页标题）',
    navOn.custom === 2 && navOn.labels === '我的/我的' && navOn.active === true && navOn.title === '我的', JSON.stringify(navOn));

  const instant = await J(`(function(){
    AR.UI.show('custom');
    var host = document.getElementById('customModules');
    var cards = host.querySelectorAll(':scope > .hw-card');
    var heads = [];
    for (var i = 0; i < cards.length; i++) {
      var t = cards[i].querySelector('.hw-t');
      heads.push(t ? t.textContent : '?');
    }
    return { skel: host.querySelectorAll('.cm-skeleton').length, n: cards.length, heads: heads.join(',') };
  })()`);
  ok('T3c 切进「我的」立刻出内容（没有加载动画）',
    instant.skel === 0 && instant.n === 4 && instant.heads === '作业,长期任务,作业统计,本周课表', JSON.stringify(instant));

  const allMods = await J(`(function(){
    var ct = AR.UI.customTabCfg();
    ct.modules = ['semester', 'events', 'keyevents', 'nextclass', 'todaycourses', 'hwstats', 'longterm', 'homework',
                  'weekgrid', 'calendar', 'freetime', 'countdown', 'todo'];
    AR.Store.save(true);
    AR.UI.renderCustom();
    var cards = document.querySelectorAll('#customModules > .hw-card');
    var heads = [];
    for (var i = 0; i < cards.length; i++) {
      var t = cards[i].querySelector('.hw-t');
      heads.push(t ? t.textContent : '?');
    }
    var today = new Date();
    var daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
    return {
      n: cards.length, heads: heads.join(','),
      wcols: document.querySelectorAll('#customModules .cm-wcol').length,
      calCells: document.querySelectorAll('#customModules .cm-cal-cell:not(.empty)').length,
      daysInMonth: daysInMonth
    };
  })()`);
  ok('T3d 十三个模块齐全且按顺序渲染（自选 5 个已撤回）', allMods.n === 13
    && allMods.heads === '学期进度,近期事件,重要事件,接下来,今日课表,作业统计,长期任务,作业,本周课表,日历,没课时段,倒计时,待办速记',
    JSON.stringify(allMods));
  ok('T3e 本周课表 7 列 + 日历格子铺满当月',
    allMods.wcols === 7 && allMods.calCells === allMods.daysInMonth, JSON.stringify(allMods));

  const cd = await J(`(function(){
    var S = AR.Store.get();
    var d = new Date(); d.setDate(d.getDate() + 20);
    S.countdowns = [{ id: 'vt-cd-1', title: '复验·四级', date: AR.Util.dateKey(d) }];
    S.quickTodos = [
      { id: 'vt-td-1', text: '复验·速记甲', done: false, at: new Date().toISOString() },
      { id: 'vt-td-2', text: '复验·速记乙', done: true, at: new Date().toISOString() }
    ];
    AR.Store.save(true);
    AR.UI.renderCustom();
    var cdRow = null, rows = document.querySelectorAll('#customModules .cm-line');
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].textContent.indexOf('复验·四级') >= 0) { cdRow = rows[i]; }
    }
    var todoRows = document.querySelectorAll('#customModules .cm-todo-row');
    return {
      cdText: cdRow ? cdRow.textContent : '(none)',
      todoN: todoRows.length,
      todoDone: document.querySelectorAll('#customModules .cm-todo-row.done').length
    };
  })()`);
  ok('T3f 倒计时显示「还有 20 天」+ 待办速记 2 条 1 条已完成',
    cd.cdText.indexOf('还有 20 天') >= 0 && cd.todoN === 2 && cd.todoDone === 1, JSON.stringify(cd));

  const cdDel = await J(`(function(){
    var rows = document.querySelectorAll('#customModules .cm-line');
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].textContent.indexOf('复验·四级') >= 0) {
        var del = rows[i].querySelector('.lt-del');
        if (del) { del.click(); break; }
      }
    }
    AR.UI.renderCustom();
    return { n: (AR.Store.get().countdowns || []).length,
             gone: document.getElementById('customModules').textContent.indexOf('复验·四级') < 0 };
  })()`);
  ok('T3g 倒计时可删除', cdDel.n === 0 && cdDel.gone === true, JSON.stringify(cdDel));

  // ── T6 本轮新增模块专项 ──────────────────────────────────
  const semFix = await J(`(function(){
    var sem = AR.Store.currentSemester();
    var weekNo = AR.Schedule.weekNumber(new Date());
    var expect = 0;
    for (var w = 1; w <= 7; w++) {
      try { expect += (AR.Schedule.weekItems(Math.max(1, Math.min(weekNo, sem.weekCount)), w) || []).length; } catch (e) { }
    }
    var txt = document.getElementById('customModules').textContent;
    return { expect: expect, ok: txt.indexOf('本周 ' + expect + ' 节课') >= 0,
             noZero: txt.indexOf('本周 0 节课') < 0 };
  })()`);
  ok('T6a 学期进度的「本周节数」算对了（旧版永远显示 0）',
    semFix.ok === true && semFix.noZero === true, JSON.stringify(semFix));

  const polish = await J(`(function(){
    var txt = document.getElementById('customModules').textContent;
    return { noShuru: txt.indexOf('够自习') < 0,
             noSub: !document.querySelector('#view-custom .view-sub') };
  })()`);
  ok('T6b 「够自习」文案已删 + 「我的」页描述文字已删',
    polish.noShuru === true && polish.noSub === true, JSON.stringify(polish));

  const calNav = await J(`(function(){
    var label = document.querySelector('#customModules .cm-cal-label');
    var before = label ? label.textContent : '';
    var cellsBefore = document.querySelectorAll('#customModules .cm-cal-cell:not(.empty)').length;
    var btns = document.querySelectorAll('#customModules .cm-cal-nav .chip-btn');
    if (btns.length >= 3) { btns[0].click(); }   // ‹ 上个月
    return { before: before, cellsBefore: cellsBefore };
  })()`);
  await sleep(150);
  const calNav2 = await J(`(function(){
    var label = document.querySelector('#customModules .cm-cal-label');
    var after = label ? label.textContent : '';
    var cellsAfter = document.querySelectorAll('#customModules .cm-cal-cell:not(.empty)').length;
    var btns = document.querySelectorAll('#customModules .cm-cal-nav .chip-btn');
    if (btns.length >= 3) { btns[2].click(); }   // 回到今天
    return { after: after, cellsAfter: cellsAfter,
             detail: !!document.querySelector('#customModules .cm-cal-daytitle') };
  })()`);
  ok('T6c 日历可翻月（月份变了、格子数跟着变）+ 有点选日详情',
    calNav2.after !== calNav.before && calNav2.cellsAfter > 0 && calNav2.detail === true,
    JSON.stringify({ a: calNav, b: calNav2 }));

  const keyEv = await J(`(function(){
    var S = AR.Store.get();
    var d = new Date(); d.setDate(d.getDate() + 20);
    var k = AR.Util.dateKey(d);
    S.countdowns = [
      { id: 'vt-cd-k', title: '复验·四级', date: k },
      { id: 'vt-cd-dup', title: '复验·期末', date: k }
    ];
    S.events = S.events || [];
    S.events.push({ id: 'vt-ev-exam', type: 'exam', title: '复验·期末', date: k, start: '', end: '', place: '一教', updatedAt: new Date().toISOString() });
    S.events.push({ id: 'vt-ev-lec', type: 'lecture', title: '复验·讲座', date: k, start: '', end: '', place: '', updatedAt: new Date().toISOString() });
    AR.Store.save(true);
    AR.UI.renderCustom();
    var card = null, cards = document.querySelectorAll('#customModules > .hw-card');
    for (var i = 0; i < cards.length; i++) {
      var t = cards[i].querySelector('.hw-t');
      if (t && t.textContent === '重要事件') { card = cards[i]; }
    }
    var txt = card ? card.textContent : '(none)';
    return {
      found: !!card,
      hasExam: txt.indexOf('复验·期末') >= 0,
      examOnce: (txt.match(/复验·期末/g) || []).length === 1,   // 同名同日的考试+倒计时合并成一行
      noLecture: txt.indexOf('复验·讲座') < 0,                    // 讲座不进「重要」（方案 A 分工）
      hasCd: txt.indexOf('复验·四级') >= 0,
      hasDays: txt.indexOf('还有 20 天') >= 0
    };
  })()`);
  ok('T6d 重要事件=考试+倒计时（讲座不进、同名同日只显示一次、带倒数）',
    keyEv.found === true && keyEv.hasExam === true && keyEv.examOnce === true
    && keyEv.noLecture === true && keyEv.hasCd === true && keyEv.hasDays === true,
    JSON.stringify(keyEv));

  // ── T5 加载动画已删，进场走统一接口 ──────────────────────
  const motion = await J(`(function(){
    return {
      noLoading: !AR.Motion.table.loading && AR.Motion.order.indexOf('loading') < 0,
      order: AR.Motion.order.join(','),
      noSplash: !document.getElementById('bootSplash'),
      noSkeleton: document.querySelectorAll('.cm-skeleton').length === 0
    };
  })()`);
  ok('T5a 加载动画已整个删掉（无「加载」场景 / 开屏 / 骨架）',
    motion.noLoading === true && motion.noSplash === true && motion.noSkeleton === true, JSON.stringify(motion));

  const devPanel = await J(`(function(){
    var ap = AR.Store.get().settings.appearance;
    ap.devMode = true;
    AR.Store.save(true);
    AR.UI.show('settings');
    var rows = document.querySelectorAll('.dev-motion .dev-row');
    var sc = 0;
    for (var i = 0; i < rows.length; i++) { if (rows[i].querySelector('.pick-trigger')) { sc++; } }
    var txt = document.getElementById('settingsGrid').innerHTML;
    return { rows: sc, order: AR.Motion.order.length,
             hasExp: txt.indexOf('实验性功能') >= 0, hasCompose: txt.indexOf('模块组成') >= 0 };
  })()`);
  ok('T5b 开发者面板：场景每景一行（与注册表一致），实验开关在',
    devPanel.rows === devPanel.order && devPanel.hasExp === true && devPanel.hasCompose === true, JSON.stringify(devPanel));

  // ── 收尾：关掉实验开关，恢复「导入」 ─────────────────────
  const navOff = await J(`(function(){
    var ct = AR.UI.customTabCfg();
    ct.enabled = false;
    AR.Store.save(true);
    AR.UI.syncCustomTabNav();
    var btns = document.querySelectorAll('.nav-btn');
    var imp = 0, labels = [];
    for (var i = 0; i < btns.length; i++) {
      if (btns[i].getAttribute('data-nav') === 'import') { imp++; labels.push(btns[i].querySelector('span').textContent); }
    }
    AR.Store.get().settings.appearance.devMode = false;
    var Sx = AR.Store.get();
    Sx.events = (Sx.events || []).filter(function (e) { return String(e.id).indexOf('vt-') !== 0; });
    Sx.countdowns = (Sx.countdowns || []).filter(function (e) { return String(e.id).indexOf('vt-') !== 0; });
    AR.Store.save(true);
    return { imp: imp, labels: labels.join('/') };
  })()`);
  ok('T3h 关掉开关标签恢复「导入」', navOff.imp === 2 && navOff.labels === '导入/导入', JSON.stringify(navOff));

  console.log('');
  console.log(`RESULT: PASS=${pass} FAIL=${fail}`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('DRIVER-ERROR', e); process.exit(2); });
