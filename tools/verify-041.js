/**
 * 0.4.1 专验（CDP 驱动，连 9333）：
 * R1 软删除 + 回收站：删除后记录留着、界面看不到、trashList 能列出、恢复原样
 * R2 课程级联恢复：删整门课 → 时段/单次调整一起进回收站 → 恢复全部回来
 * R3 5 秒撤销：删除后出现 .toast-undo，点「撤销」记录回来
 * R4 「我的」页课程只读：只读标题、无编辑/删除入口、有「去哪儿改」提示
 * R5 设置 → 数据与同步 → 回收站：列出条目、点恢复生效、清空回收站真删
 *
 * 用法：CDP_PORT=9333 node tools/verify-041.js
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
  let page = targets.find((t) => t.type === 'page' && /127\.0\.0\.1:8123/.test(t.url || ''));
  if (!page) { page = targets.find((t) => t.type === 'page' && /^https?:/.test(t.url || '')); }
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
  await sleep(1300);
  for (let i = 0; i < 40; i++) {
    const ready = await ev(ws, idRef, `(typeof AR !== 'undefined' && AR.Store && AR.Store.trashList) ? 1 : 0`).catch(() => 0);
    if (ready) { break; }
    await sleep(300);
  }

  // ── 夹具：一门临时课 + 周三时段 + 一条日程 ────────────────
  const fix = await J(`(function(){
    var S = AR.Store.get();
    if (!(S.courses || []).length) {
      S.settings.onboardingCompletedAt = new Date().toISOString();
      AR.MdParse.applyEntities(AR.MdParse.demoEntities(S), S);
    }
    var ob = document.getElementById('onboarding'); if (ob) { ob.hidden = true; }
    AR.UI.closeModal(); AR.UI.closeModal();
    /* 先把上一次跑到一半留下的东西清干净（可重复运行） */
    var keepOut = function (arr) {
      return (arr || []).filter(function (r) { return String(r.id || '').indexOf('vt2-') !== 0; });
    };
    S.events = keepOut(S.events); S.courses = keepOut(S.courses); S.blocks = keepOut(S.blocks);
    S.overrides = keepOut(S.overrides); S.tasks = keepOut(S.tasks); S.quickTodos = keepOut(S.quickTodos);
    S.tombstones = keepOut(S.tombstones);
    var now = new Date();
    S.courses.push({ id: 'vt2-course', name: '回收站测试课', colorKey: 'blue', track: 'common',
      semesterId: S.semesters[0].id, updatedAt: new Date().toISOString() });
    S.blocks.push({ id: 'vt2-block', courseId: 'vt2-course', courseName: '回收站测试课', weekday: 3,
      periodStart: 3, periodEnd: 4, weekMode: 'all', weeks: '', start: '10:00', end: '11:35',
      locationIds: [], teacherIds: [], note: '', updatedAt: new Date().toISOString() });
    S.overrides.push({ id: 'vt2-ov', courseId: 'vt2-course', blockId: 'vt2-block',
      date: AR.Util.dateKey(now), type: 'cancel', newDate: null, updatedAt: new Date().toISOString() });
    S.events.push({ id: 'vt2-event', title: '回收站测试日程', type: 'other', date: AR.Util.dateKey(now),
      start: '15:00', end: '16:00', place: '', note: '', star: false, showOnTimetable: false,
      archived: false, updatedAt: new Date().toISOString() });
    /* 今天（可能是周末）也要有一节课，供「我的 → 今日课表」只读检查用 */
    S.courses.push({ id: 'vt2-ro-course', name: '只读测试课', colorKey: 'blue', track: 'common',
      semesterId: S.semesters[0].id, updatedAt: new Date().toISOString() });
    S.blocks.push({ id: 'vt2-ro-block', courseId: 'vt2-ro-course', courseName: '只读测试课',
      weekday: AR.Util.weekdayOf(now), periodStart: 5, periodEnd: 6, weekMode: 'all', weeks: '',
      start: '14:00', end: '15:35', locationIds: [], teacherIds: [], note: '', updatedAt: new Date().toISOString() });
    AR.Store.save(true);
    return { courses: AR.Store.courseList().length, blocks: AR.Store.liveOnly(S.blocks).length };
  })()`);
  ok('R0 夹具就绪', fix.courses > 0 && fix.blocks > 0, JSON.stringify(fix));

  // ── R1 日程：软删除 → 回收站 → 恢复 ──────────────────────
  const delEv = await J(`(function(){
    var today = AR.Util.dateKey(new Date());
    var before = AR.Store.eventsOf(today).length;
    AR.Store.removeEvent('vt2-event');
    var after = AR.Store.eventsOf(today).length;
    var raw = AR.Store.get().events.filter(function (e) { return e.id === 'vt2-event'; })[0];
    var inTrash = AR.Store.trashList().filter(function (t) { return t.entity === 'events' && t.id === 'vt2-event'; }).length;
    var keptFlag = !!raw && !!raw.deletedAt;      // 必须在 restore 之前读（restore 会把标记清掉）
    var restored = AR.Store.restore('events', 'vt2-event');
    var back = AR.Store.eventsOf(today).filter(function (e) { return e.id === 'vt2-event'; }).length;
    return { before: before, after: after, kept: keptFlag, inTrash: inTrash,
             restored: restored === true, back: back };
  })()`);
  ok('R1 删日程：界面少一条、记录留着（软删除）、进回收站、能恢复',
    delEv.after === delEv.before - 1 && delEv.kept === true && delEv.inTrash === 1
    && delEv.restored === true && delEv.back === 1, JSON.stringify(delEv));

  // ── R2 课程：级联软删除 + 级联恢复 ──────────────────────
  const delCourse = await J(`(function(){
    var before = { c: AR.Store.courseList().length, b: AR.Store.liveOnly(AR.Store.get().blocks).length };
    AR.Store.removeCourse('vt2-course');
    var t = AR.Store.trashList();
    var nCourse = t.filter(function (x) { return x.entity === 'courses' && x.id === 'vt2-course'; }).length;
    var nBlock = t.filter(function (x) { return x.entity === 'blocks' && x.id === 'vt2-block'; }).length;
    var nOv = t.filter(function (x) { return x.entity === 'overrides' && x.id === 'vt2-ov'; }).length;
    var after = { c: AR.Store.courseList().length, b: AR.Store.liveOnly(AR.Store.get().blocks).length,
                  ov: AR.Store.overridesOfBlock('vt2-block').length };
    AR.Store.restore('courses', 'vt2-course');
    var back = { c: AR.Store.courseList().length, b: AR.Store.liveOnly(AR.Store.get().blocks).length,
                 ov: AR.Store.overridesOfBlock('vt2-block').length };
    return { before: before, after: after, back: back, nCourse: nCourse, nBlock: nBlock, nOv: nOv };
  })()`);
  ok('R2 删整门课：课程/时段/单次调整一起进回收站；恢复时一起回来',
    delCourse.after.c === delCourse.before.c - 1 && delCourse.after.b === delCourse.before.b - 1
    && delCourse.after.ov === 0 && delCourse.nCourse === 1 && delCourse.nBlock === 1 && delCourse.nOv === 1
    && delCourse.back.c === delCourse.before.c && delCourse.back.b === delCourse.before.b
    && delCourse.back.ov === 1, JSON.stringify(delCourse));

  // ── R3 5 秒撤销 ─────────────────────────────────────────
  const undoStep1 = await J(`(function(){
    AR.Store.restore('events', 'vt2-event');   // 保证它还在列表里，走真实 UI 删除
    AR.UI.show('custom');
    AR.UI.customTabCfg().modules = ['events'];
    AR.Store.save(true);
    AR.UI.renderCustom();
    return { hasFn: typeof AR.UI.toastUndo === 'function' };
  })()`);
  const undoStep2 = await J(`(function(){
    return { hasFn: typeof AR.UI.toastUndo === 'function' };
  })()`);
  await J(`(function(){
    // 点一次真实的删除入口：日程长按菜单 → 删除 → 确认
    AR.UI.show('custom');
    AR.UI.customTabCfg().modules = ['events'];
    AR.Store.save(true);
    AR.UI.renderCustom();
    return 'ok';
  })()`);
  await sleep(300);
  const undoStep3 = await J(`(function(){
    var rows = document.querySelectorAll('#customModules .cm-line');
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].textContent.indexOf('回收站测试日程') >= 0) {
        rows[i].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10 }));
        return 'pressed';
      }
    }
    return 'no row';
  })()`);
  await sleep(650);
  const undoStep4 = await J(`(function(){
    var btns = document.querySelectorAll('.modal-actions .btn');
    for (var i = 0; i < btns.length; i++) { if (btns[i].textContent === '删除') { btns[i].click(); break; } }
    return 'ok';
  })()`);
  await sleep(250);
  const undoStep5 = await J(`(function(){
    var btns = document.querySelectorAll('.modal-actions .btn');
    for (var i = 0; i < btns.length; i++) { if (btns[i].textContent === '确认删除') { btns[i].click(); break; } }
    return 'ok';
  })()`);
  await sleep(300);
  const undoStep6 = await J(`(function(){
    var toast = document.querySelector('#toastHost .toast-undo');
    var act = toast ? toast.querySelector('.t-act') : null;
    return { hasToast: !!toast, label: act ? act.textContent : '', deleted: AR.Store.eventsOf(AR.Util.dateKey(new Date())).filter(function (e) { return e.id === 'vt2-event'; }).length === 0 };
  })()`);
  const undoStep7 = await J(`(function(){
    var act = document.querySelector('#toastHost .toast-undo .t-act');
    if (act) { act.click(); }
    return { back: AR.Store.eventsOf(AR.Util.dateKey(new Date())).filter(function (e) { return e.id === 'vt2-event'; }).length };
  })()`);
  ok('R3 删除后有 5 秒「撤销」，点一下记录就回来',
    undoStep1.hasFn === true && undoStep6.hasToast === true && undoStep6.label === '撤销'
    && undoStep6.deleted === true && undoStep7.back === 1,
    JSON.stringify({ s6: undoStep6, s7: undoStep7 }));

  // ── R4 「我的」页课程只读 ────────────────────────────────
  const readOnly = await J(`(function(){
    AR.UI.customTabCfg().modules = ['todaycourses'];
    AR.Store.save(true);
    AR.UI.show('custom');
    AR.UI.renderCustom();
    var rows = document.querySelectorAll('#customModules .cm-line');
    if (!rows.length) { return { err: '今日课表没课' }; }
    rows[0].click();
    var body = document.querySelector('.modal-body');
    var btns = document.querySelectorAll('.modal-actions .btn');
    var labels = [];
    for (var i = 0; i < btns.length; i++) { labels.push(btns[i].textContent); }
    var sub = document.querySelector('.modal-sub');
    return {
      actions: labels.join(','),
      sub: sub ? sub.textContent : '',
      hint: body ? body.textContent.indexOf('只读查看') >= 0 : false
    };
  })()`);
  ok('R4 「我的」页点课程 = 只读：没有编辑/删除入口、有「去哪儿改」提示',
    readOnly.actions === '关闭' && readOnly.sub.indexOf('只读') >= 0 && readOnly.hint === true,
    JSON.stringify(readOnly));
  await J(`AR.UI.closeModal();'ok'`);

  // ── R5 设置 → 数据与同步 → 回收站 ───────────────────────
  const trashPanel = await J(`(function(){
    var S = AR.Store.get();
    S.events.push({ id: 'vt2-trash1', title: '待回收日程', type: 'other', date: AR.Util.dateKey(new Date()),
      start: '', end: '', place: '', note: '', star: false, showOnTimetable: false, archived: false,
      updatedAt: new Date().toISOString() });
    AR.Store.save(true);
    AR.Store.removeEvent('vt2-trash1');
    /* v0.4.1：数据与同步改成从上到下平铺，没有页内标签了 —— 直接找面板 */
    if (AR.Panels.settingsGoHome) { AR.Panels.settingsGoHome(); }
    AR.UI.show('settings');
    var row = document.querySelector('#settingsGrid .set-cat[data-key="syncdata"] .set-cat-head');
    if (row) { row.click(); }
    var panelEl = document.getElementById('set-trash');
    var rows = panelEl ? panelEl.querySelectorAll('.cm-line') : [];
    return { tabs: document.querySelectorAll('#settingsGrid .set-tabs').length,
             panel: !!panelEl, rows: rows.length,
             listed: panelEl ? panelEl.textContent.indexOf('待回收日程') >= 0 : false };
  })()`);
  ok('R5 设置 → 数据与同步 → 回收站（平铺）：列出刚删的条目',
    trashPanel.panel === true && trashPanel.rows >= 1 && trashPanel.listed === true && trashPanel.tabs === 0,
    JSON.stringify(trashPanel));

  const trashRestore = await J(`(function(){
    var panelEl = document.getElementById('set-trash');
    var rows = panelEl.querySelectorAll('.cm-line');
    var target = null;
    for (var i = 0; i < rows.length; i++) { if (rows[i].textContent.indexOf('待回收日程') >= 0) { target = rows[i]; } }
    if (!target) { return { err: 'no row' }; }
    target.querySelector('.trash-back').click();
    return { back: AR.Store.eventsOf(AR.Util.dateKey(new Date())).filter(function (e) { return e.id === 'vt2-trash1'; }).length,
             still: (AR.Store.trashList().filter(function (t) { return t.id === 'vt2-trash1'; })).length };
  })()`);
  ok('R5b 回收站点「恢复」：条目回到列表、从回收站消失',
    trashRestore.back === 1 && trashRestore.still === 0, JSON.stringify(trashRestore));

  const emptyTrash = await J(`(function(){
    AR.Store.removeEvent('vt2-trash1');
    var before = AR.Store.trashList().length;
    AR.Store.emptyTrash();
    var after = AR.Store.trashList().length;
    var raw = AR.Store.get().events.filter(function (e) { return e.id === 'vt2-trash1'; }).length;
    return { before: before, after: after, raw: raw };
  })()`);
  ok('R5c 清空回收站：记录真的从文件里拿掉',
    emptyTrash.before >= 1 && emptyTrash.after === 0 && emptyTrash.raw === 0, JSON.stringify(emptyTrash));

  // ── R7 方案 A：删除尊重作用域 ───────────────────────────
  const scope1 = await J(`(function(){
    // 保证当前周有一个可用于测试的课程块（前面的用例可能把当天那节取消了）
    var S = AR.Store.get();
    var has = S.blocks.filter(function (b) { return b.id === 'vt2-r7-block' && !b.deletedAt; }).length;
    if (!has) {
      S.blocks.push({ id: 'vt2-r7-block', courseId: 'vt2-ro-course', courseName: '只读测试课',
        weekday: AR.Util.weekdayOf(new Date()), periodStart: 7, periodEnd: 8, weekMode: 'all', weeks: '',
        start: '', end: '', locationIds: [], teacherIds: [], note: '', updatedAt: new Date().toISOString() });
      AR.Store.save(true);
    }
    AR.UI.show('week');
    var blocks = document.querySelectorAll('#weekGridWrap .wt-block');
    var target = null;
    for (var i = 0; i < blocks.length; i++) {
      if (blocks[i].className.indexOf('wt-evblock') < 0 && blocks[i].textContent.indexOf('只读测试课') >= 0) { target = blocks[i]; }
    }
    if (!target) {
      for (var k = 0; k < blocks.length; k++) {
        if (blocks[k].className.indexOf('wt-evblock') < 0) { target = blocks[k]; break; }
      }
    }
    if (!target) { return { err: '没有课程块' }; }
    target.click();
    var onceBtn = document.querySelector('#ebScope .scope-btn[data-scope="once"]');
    if (!onceBtn) { return { err: '没有「仅这次」作用域按钮' }; }
    onceBtn.click();
    var labels = [];
    var acts = document.querySelectorAll('.modal-actions .btn');
    for (var a = 0; a < acts.length; a++) { labels.push(acts[a].textContent); }
    return { labels: labels.join(','), blocksBefore: AR.Store.liveOnly(AR.Store.get().blocks).length };
  })()`);
  const scope2 = await J(`(function(){
    var acts = document.querySelectorAll('.modal-actions .btn');
    var del = null;
    for (var i = 0; i < acts.length; i++) { if (acts[i].textContent === '取消这一天的课') { del = acts[i]; } }
    if (!del) { return { err: '删除按钮文案没跟着作用域走' }; }
    del.click();
    return 'ok';
  })()`);
  await sleep(220);
  const scope3 = await J(`(function(){
    var acts = document.querySelectorAll('.modal-actions .btn');
    var okBtn = null, labels = [];
    for (var i = 0; i < acts.length; i++) {
      labels.push(acts[i].textContent);
      if (acts[i].textContent === '取消这一天') { okBtn = acts[i]; }
    }
    if (!okBtn) { return { labels: labels.join(','), err: '没看到「取消这一天」确认' }; }
    okBtn.click();
    var S = AR.Store.get();
    var live = AR.Store.liveOnly(S.blocks).length;
    var cancels = 0;
    for (var k = 0; k < S.overrides.length; k++) {
      if (S.overrides[k].type === 'cancel' && !S.overrides[k].deletedAt) { cancels++; }
    }
    return { live: live, cancels: cancels, labels: labels.join(',') };
  })()`);
  const scope4 = await J(`(function(){
    AR.UI.show('week');
    var blocks = document.querySelectorAll('#weekGridWrap .wt-block');
    var target = null;
    for (var i = 0; i < blocks.length; i++) {
      if (blocks[i].className.indexOf('wt-evblock') < 0 && blocks[i].textContent.indexOf('只读测试课') >= 0) { target = blocks[i]; }
    }
    if (!target) {
      for (var k = 0; k < blocks.length; k++) {
        if (blocks[k].className.indexOf('wt-evblock') < 0) { target = blocks[k]; break; }
      }
    }
    if (!target) { return { err: '没有课程块' }; }
    var before = AR.Store.liveOnly(AR.Store.get().blocks).length;
    target.click();
    var allBtn = document.querySelector('#ebScope .scope-btn[data-scope="all"]');
    if (allBtn) { allBtn.click(); }
    var acts = document.querySelectorAll('.modal-actions .btn');
    var del = null;
    for (var i = 0; i < acts.length; i++) { if (acts[i].textContent === '删除这个每周时段') { del = acts[i]; } }
    if (!del) { return { err: '「所有时段」下删除按钮文案不对' }; }
    del.click();
    return { before: before };
  })()`);
  await sleep(220);
  const scope5 = await J(`(function(){
    var acts = document.querySelectorAll('.modal-actions .btn');
    var okBtn = null;
    for (var i = 0; i < acts.length; i++) { if (acts[i].textContent === '确认删除') { okBtn = acts[i]; } }
    if (okBtn) { okBtn.click(); }
    return { after: AR.Store.liveOnly(AR.Store.get().blocks).length,
             trash: AR.Store.trashList().filter(function (t) { return t.entity === 'blocks'; }).length,
             toast: !!document.querySelector('#toastHost .toast-undo') };
  })()`);
  ok('R7 方案 A：仅这次=只取消这一天（时段还在、多一条取消记录）；所有时段=删掉整个每周时段进回收站',
    scope1.labels.indexOf('取消这一天的课') >= 0
    && scope3.live === scope1.blocksBefore && scope3.cancels >= 1
    && scope5.after === scope4.before - 1 && scope5.trash >= 1 && scope5.toast === true,
    JSON.stringify({ s1: scope1, s3: scope3, s4: scope4, s5: scope5 }));

  // ── R8 作业：备注 → 条目（v0.4.1b 回归）+ 刷新作业 ────────
  const hw1 = await J(`(function(){
    var today = AR.Util.dateKey(new Date());
    var S = AR.Store.get();
    var hadA = S.overrides.filter(function (o) { return o.id === 'vt2-note'; }).length;
    if (!hadA) {
      S.overrides.push({ id: 'vt2-note', courseId: 'vt2-ro-course', blockId: 'vt2-ro-block',
        date: today, type: 'edit', newNote: '- 写作业A\\n- 写作业B', updatedAt: new Date().toISOString() });
      AR.Store.save(true);
    }
    AR.Store.syncTasksFor('vt2-ro-block', 'vt2-ro-course', today, '- 写作业A\\n- 写作业B');
    var after = AR.Store.taskList();
    var board = AR.Store.taskBoard(today);
    var texts = [];
    for (var i = 0; i < after.length; i++) { texts.push(after[i].text); }
    return { n: after.length, texts: texts.join('|'), boardOpen: (board.open || []).length };
  })()`);
  ok('R8 备注里写作业 → 作业条目真的生成（并出现在今日作业面板）',
    hw1.n >= 2 && hw1.texts.indexOf('写作业A') >= 0 && hw1.texts.indexOf('写作业B') >= 0
    && hw1.boardOpen >= 2, JSON.stringify(hw1));

  const hw2 = await J(`(function(){
    var today = AR.Util.dateKey(new Date());
    AR.Store.syncTasksFor('vt2-ro-block', 'vt2-ro-course', today, '- 写作业A');
    var list = AR.Store.taskList();
    var texts = [];
    for (var i = 0; i < list.length; i++) { texts.push(list[i].text); }
    var inTrash = AR.Store.trashList().filter(function (t) { return t.entity === 'tasks' && t.title === '写作业B'; }).length;
    return { texts: texts.join('|'), inTrash: inTrash };
  })()`);
  ok('R8b 备注里删掉的行 → 条目进回收站（不是凭空消失）',
    hw2.texts.indexOf('写作业B') < 0 && hw2.inTrash === 1, JSON.stringify(hw2));

  const hw3 = await J(`(function(){
    var list = AR.Store.taskList();
    for (var i = 0; i < list.length; i++) {
      if (list[i].text === '写作业A') { AR.Store.softDelete('tasks', list[i]); }
    }
    AR.Store.save(true);
    var before = AR.Store.taskList().length;
    var r = AR.Store.rebuildTasks();
    var after = AR.Store.taskList();
    var texts = [];
    for (var k = 0; k < after.length; k++) { texts.push(after[k].text); }
    return { before: before, after: after.length, created: r.created, texts: texts.join('|') };
  })()`);
  await J(`(function(){
    AR.UI.show('settings');
    var row = document.querySelector('#settingsGrid .set-cat[data-key="work"] .set-cat-head');
    if (row) { row.click(); }
    return 'ok';
  })()`);
  await sleep(250);
  const hw4 = await J(`(function(){
    var detail = document.getElementById('set-work');
    var txt = detail ? detail.textContent : '';
    var btns = detail ? detail.querySelectorAll('button') : [];
    var hasBtn = false;
    for (var i = 0; i < btns.length; i++) { if (btns[i].textContent === '刷新作业') { hasBtn = true; } }
    return { hasBtn: hasBtn, hasHint: txt.indexOf('重扫一遍') >= 0 };
  })()`);
  ok('R8c 「刷新作业」：能从现有备注重建漏掉的条目（设置里有这个按钮）',
    hw3.after >= 1 && hw3.texts.indexOf('写作业A') >= 0 && hw3.created >= 1
    && hw4.hasBtn === true && hw4.hasHint === true,
    JSON.stringify({ hw3: hw3, hw4: hw4 }));

  // ── R9 速记墓碑 + 90 天清理 ──────────────────────────────
  const tomb = await J(`(function(){
    var S = AR.Store.get();
    var id = 'vt2-todo-1';
    S.quickTodos.push({ id: id, text: '速记墓碑测试', done: false, at: new Date().toISOString() });
    AR.Store.save(true);
    AR.Store.quickTodoRemove(id);
    var tombstones = (AR.Store.get().tombstones || []).filter(function (t) { return t.entity === 'quickTodos' && t.id === id; });
    var live = AR.Store.quickTodoList().filter(function (t) { return t.id === id; }).length;
    return { tomb: tombstones.length, live: live };
  })()`);
  ok('R9 速记删除：记墓碑（导入旧存档不会复活）+ 从列表消失',
    tomb.tomb === 1 && tomb.live === 0, JSON.stringify(tomb));

  const prune = await J(`(function(){
    var S = AR.Store.get();
    var oldIso = new Date(Date.now() - 100 * 86400000).toISOString();
    var newIso = new Date(Date.now() - 1 * 86400000).toISOString();
    S.events.push({ id: 'vt2-old', title: '过期日程', type: 'other', date: AR.Util.dateKey(new Date()),
      start: '', end: '', place: '', note: '', star: false, showOnTimetable: false, archived: false,
      deletedAt: oldIso, updatedAt: oldIso });
    S.events.push({ id: 'vt2-new', title: '新删日程', type: 'other', date: AR.Util.dateKey(new Date()),
      start: '', end: '', place: '', note: '', star: false, showOnTimetable: false, archived: false,
      deletedAt: newIso, updatedAt: newIso });
    S.tombstones.push({ id: 'vt2-old', entity: 'events', deletedAt: oldIso });
    S.tombstones.push({ id: 'vt2-new', entity: 'events', deletedAt: newIso });
    AR.Store.save(true);
    var before = AR.Store.trashList().length;
    var r = AR.Store.pruneTrash(90);
    var S2 = AR.Store.get();
    var oldGone = S2.events.filter(function (e) { return e.id === 'vt2-old'; }).length === 0;
    var newKept = S2.events.filter(function (e) { return e.id === 'vt2-new'; }).length === 1;
    var oldTomb = S2.tombstones.filter(function (t) { return t.id === 'vt2-old'; }).length;
    var newTomb = S2.tombstones.filter(function (t) { return t.id === 'vt2-new'; }).length;
    // 设成"不自动"时应直接跳过
    var skip = AR.Store.pruneTrash(0);
    return { before: before, r: r, oldGone: oldGone, newKept: newKept, oldTomb: oldTomb, newTomb: newTomb, skip: skip.skipped === true };
  })()`);
  ok('R9b 90 天清理：过期的真删（连墓碑），新的留着；设「不自动」时跳过',
    prune.oldGone === true && prune.newKept === true && prune.oldTomb === 0 && prune.newTomb >= 1
    && prune.r.records >= 1 && prune.skip === true, JSON.stringify(prune));

  // ── R10 检查更新（方案 B）────────────────────────────────
  const ver = await J(`(function(){
    var f = AR.Panels.versionNewer;
    return { a: f('0.4.2', '0.4.1'), b: f('0.4.1', '0.4.1'), c: f('0.4.1a', '0.4.1'),
             d: f('0.4.1', '0.4.1a'), e: f('0.5.0', '0.4.9'), g: f('0.4.0', '0.4.1') };
  })()`);
  ok('R10 版本比较正确（含尾字母）',
    ver.a === true && ver.b === false && ver.c === true && ver.d === false && ver.e === true && ver.g === false,
    JSON.stringify(ver));

  const upd1 = await J(`(function(){
    if (AR.Panels.settingsGoHome) { AR.Panels.settingsGoHome(); }
    AR.UI.show('settings');
    if (AR.Panels.settingsGoHome && !document.querySelector('#settingsGrid .set-cat')) { AR.Panels.settingsGoHome(); }
    var row = document.querySelector('#settingsGrid .set-cat[data-key="about"]');
    var txt = row ? row.textContent : '';
    var hasBtn = false;
    var bs = row ? row.querySelectorAll('button') : [];
    for (var i = 0; i < bs.length; i++) { if (bs[i].textContent === '检查') { hasBtn = true; } }
    var st = AR.Store.get().settings.update || {};
    return { quickHasCheck: txt.indexOf('检查更新') >= 0, hasBtn: hasBtn, autoDefault: !!st.auto, every: st.every || '' };
  })()`);
  ok('R10b 「关于与帮助」高频项里有「检查更新」；自动检查默认关闭',
    upd1.quickHasCheck === true && upd1.hasBtn === true && upd1.autoDefault === false,
    JSON.stringify(upd1));

  const upd2 = await J(`(function(){
    // 打桩 fetch：模拟"远端有新版"
    window.__origFetch = window.fetch;
    window.fetch = function () {
      return Promise.resolve({ ok: true, json: function () {
        return Promise.resolve({ tag_name: 'v9.9.9', html_url: 'https://example.com/rel', body: '新版说明' });
      } });
    };
    AR.Panels.checkUpdate(true);
    return 'called';
  })()`);
  await sleep(500);
  const upd3 = await J(`(function(){
    var title = document.querySelector('.modal-title');
    var btns = document.querySelectorAll('.modal-actions .btn');
    var labels = [];
    for (var i = 0; i < btns.length; i++) { labels.push(btns[i].textContent); }
    var last = (AR.Store.get().settings.update || {}).lastAt || '';
    if (window.__origFetch) { window.fetch = window.__origFetch; }
    AR.UI.closeModal();
    return { title: title ? title.textContent : '', labels: labels.join(','), lastAt: !!last };
  })()`);
  ok('R10c 发现新版：弹窗提示 + 「打开下载页」，并记下检查时间',
    upd3.title.indexOf('发现新版本') >= 0 && upd3.labels.indexOf('打开下载页') >= 0 && upd3.lastAt === true,
    JSON.stringify(upd3));

  // ── R11 数据与同步平铺（没有滑块标签） + 弹窗操作条吸底 ──
  const flat = await J(`(function(){
    if (AR.Panels.settingsGoHome) { AR.Panels.settingsGoHome(); }
    AR.UI.show('settings');
    if (!document.querySelector('#settingsGrid .set-cat')) { if (AR.Panels.settingsGoHome) { AR.Panels.settingsGoHome(); } }
    var row = document.querySelector('#settingsGrid .set-cat[data-key="syncdata"] .set-cat-head');
    if (!row) { return { err: '没有数据与同步分类行' }; }
    row.click();
    var detail = document.getElementById('set-syncdata');
    return {
      tabs: document.querySelectorAll('#settingsGrid .set-tabs').length,
      sync: !!document.getElementById('set-sync'),
      integration: !!document.getElementById('set-integration'),
      data: !!document.getElementById('set-data'),
      trash: !!document.getElementById('set-trash'),
      hasTrashTag: detail ? detail.textContent.indexOf('回收站') >= 0 : false
    };
  })()`);
  ok('R11 「数据与同步」改为从上到下平铺（四个面板都在，没有滑块标签）',
    flat.tabs === 0 && flat.sync && flat.integration && flat.data && flat.trash && flat.hasTrashTag === true,
    JSON.stringify(flat));

  // R11b 已并入 R12（三段式 + 吸底不遮内容），这里不再单独断言

  // ── R12 弹窗统一：三段式 + 三层渐进模糊 + 吸底不遮内容 ──
  await J(`(function(){
    AR.UI.closeModal();
    var h = '<div>';
    for (var i = 1; i <= 40; i++) { h += '<div class="p">第 ' + i + ' 行</div>'; }
    h += '</div>';
    AR.UI.openModal({ title: '长弹窗', body: h, actions: [
      { label: '取消', onClick: function (c) { c(); } },
      { label: '保存', kind: 'primary', onClick: function (c) { c(); } }] });
    return 'ok';
  })()`);
  await sleep(520);   // 等弹窗进场动画（3D 翻折）结束再量几何
  const modal1 = await J(`(function(){
    var card = document.querySelector('.modal-card');
    var body = document.querySelector('.modal-body');
    var scroller = document.querySelector('.modal-scroll');
    var acts = document.querySelector('.modal-actions');
    var head = document.querySelector('.modal-head');
    var cb = getComputedStyle(card), bb = getComputedStyle(body), ab = getComputedStyle(acts), hb = getComputedStyle(head);
    var sb = getComputedStyle(scroller);
    var padTop = parseFloat(bb.paddingTop) || 0, padBottom = parseFloat(bb.paddingBottom) || 0;
    var hh = head.getBoundingClientRect().height, ah = acts.getBoundingClientRect().height;
    var lines = body.querySelectorAll('.p');
    body.scrollTop = 0;
    var h0 = head.getBoundingClientRect();
    var firstTop = lines.length ? lines[0].getBoundingClientRect().top : 0;
    body.scrollTop = body.scrollHeight;
    var a0 = acts.getBoundingClientRect(), c0 = card.getBoundingClientRect();
    var last = lines.length ? lines[lines.length - 1].getBoundingClientRect() : null;
    return {
      cardFlex: cb.display === 'flex', cardHidden: cb.overflow === 'hidden',
      bodyAuto: bb.overflow === 'auto',
      barsOverlay: ab.position === 'absolute' && hb.position === 'absolute',
      // A 方案：两条带自己是磨砂玻璃（带 blur），内容区没有任何模糊层
      barsBlur: /blur\\(/.test(ab.backdropFilter || ab.webkitBackdropFilter || '')
        && /blur\\(/.test(hb.backdropFilter || hb.webkitBackdropFilter || ''),
      noBlurElsewhere:
        (cb.backdropFilter || cb.webkitBackdropFilter || 'none') === 'none'
        && (bb.backdropFilter || bb.webkitBackdropFilter || 'none') === 'none'
        && (sb.backdropFilter || sb.webkitBackdropFilter || 'none') === 'none',
      fades: document.querySelectorAll('.m-fade').length,
      // 限位 = 带高 + 余量(10px)
      insetOk: padTop >= hh + 6 && padBottom >= ah + 6,
      firstClearTop: firstTop >= h0.bottom - 1,
      lastClearBottom: last ? (last.bottom <= a0.top + 1) : false,
      barsAtEdges: Math.abs(a0.bottom - c0.bottom) <= 2 && Math.abs(h0.top - c0.top) <= 2
    };
  })()`);
  ok('R12 弹窗（方案 A）：两条带自己是磨砂玻璃并糊住穿过它的内容；内容区无模糊；限位=带高+余量',
    modal1.cardFlex && modal1.cardHidden && modal1.bodyAuto && modal1.barsOverlay && modal1.barsBlur
    && modal1.noBlurElsewhere === true && modal1.fades === 0 && modal1.insetOk === true
    && modal1.firstClearTop === true && modal1.lastClearBottom === true && modal1.barsAtEdges === true,
    JSON.stringify(modal1));

  await J(`(function(){
    AR.UI.closeModal();
    AR.UI.openModal({ title: '按钮很多', body: '<div style="height:200px">内容</div>',
      actions: [{ label: '取消', onClick: function (c) { c(); } }, { label: '删除', kind: 'danger', onClick: function (c) { c(); } },
                { label: '去日历', onClick: function (c) { c(); } }, { label: '保存', kind: 'primary', onClick: function (c) { c(); } }] });
    return 'ok';
  })()`);
  await sleep(520);
  const modal2 = await J(`(function(){
    var acts = document.querySelector('.modal-actions');
    var bs = acts.querySelectorAll('.btn');
    var tops = [], ws = [], nowrap = true;
    for (var i = 0; i < bs.length; i++) {
      tops.push(bs[i].getBoundingClientRect().top);
      ws.push(bs[i].getBoundingClientRect().width);
      if (getComputedStyle(bs[i]).whiteSpace !== 'nowrap') { nowrap = false; }
    }
    var rows = 1;
    for (var k = 1; k < tops.length; k++) { if (Math.abs(tops[k] - tops[0]) > 3) { rows = 2; } }
    // 间距不能再收窄：任意相邻同排按钮的水平间隙 ≥ 7px（设定 8px）
    var gapOk = true;
    for (var m = 0; m + 1 < bs.length; m++) {
      if (Math.abs(tops[m] - tops[m + 1]) <= 3) {
        var g = Math.round(bs[m + 1].getBoundingClientRect().left - bs[m].getBoundingClientRect().right);
        if (g < 7) { gapOk = false; }
      }
    }
    var varied = false;
    for (var q = 0; q < ws.length; q++) { if (Math.abs(ws[q] - ws[0]) > 6) { varied = true; } }
    AR.UI.closeModal();
    return { rows: rows, gapOk: gapOk, nowrap: nowrap, naturalWidth: varied, widths: ws.map(function (x) { return Math.round(x); }) };
  })()`);
  ok('R12b 操作条：自然宽度（不强制等宽）、一行优先、间距不收窄；文字不折行',
    modal2.rows === 1 && modal2.gapOk === true && modal2.nowrap === true && modal2.naturalWidth === true,
    JSON.stringify(modal2));

  // R12c 已移除：按用户要求删掉「弹窗质感」设置项（模糊固定为标准档）

  // ── 清理 ────────────────────────────────────────────────
  await J(`(function(){
    var S = AR.Store.get();
    S.events = (S.events || []).filter(function (e) { return String(e.id).indexOf('vt2-') !== 0; });
    S.courses = (S.courses || []).filter(function (c) { return String(c.id).indexOf('vt2-') !== 0; });
    S.blocks = (S.blocks || []).filter(function (b) { return String(b.id).indexOf('vt2-') !== 0; });
    S.overrides = (S.overrides || []).filter(function (o) { return String(o.id).indexOf('vt2-') !== 0; });
    S.tombstones = (S.tombstones || []).filter(function (t) { return String(t.id).indexOf('vt2-') !== 0; });
    if (S.settings.experimental && S.settings.experimental.customTab) {
      S.settings.experimental.customTab.enabled = true;
      S.settings.experimental.customTab.modules = ['homework', 'longterm', 'hwstats', 'weekgrid'];
    }
    AR.Store.save(true);
    AR.UI.show('today');
    return 'clean';
  })()`);
  ok('R6 收尾清理', true, '');

  console.log('');
  console.log(`RESULT: PASS=${pass} FAIL=${fail}`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('DRIVER-ERROR', e); process.exit(2); });
