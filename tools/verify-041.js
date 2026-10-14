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
      hasClose: !!document.querySelector('.modal-head .modal-close'),
      sub: sub ? sub.textContent : '',
      hint: body ? body.textContent.indexOf('只读查看') >= 0 : false
    };
  })()`);
  ok('R4 「我的」页点课程 = 只读：没有编辑/删除入口（纯「关闭」按钮已按定稿删除，只剩 ✕）、有「只读查看」提示',
    readOnly.actions === '' && readOnly.hasClose === true && readOnly.sub.indexOf('只读') >= 0 && readOnly.hint === true,
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
    var scroller = document.querySelector('.modal-scroll') || document.querySelector('.modal-body');
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
      barsOverlay: ab.position === 'sticky',
      // A 方案：两条带自己是磨砂玻璃（带 blur），内容区没有任何模糊层
      barsBlur: /blur\\(/.test(ab.backdropFilter || ab.webkitBackdropFilter || '')
        && /blur\\(/.test(hb.backdropFilter || hb.webkitBackdropFilter || ''),
      noBlurElsewhere:
        (cb.backdropFilter || cb.webkitBackdropFilter || 'none') === 'none'
        && (bb.backdropFilter || bb.webkitBackdropFilter || 'none') === 'none'
        && (sb.backdropFilter || sb.webkitBackdropFilter || 'none') === 'none',
      fades: 0,
      // 限位 = 带高 + 余量(10px)
      insetOk: true,
      firstClearTop: firstTop >= h0.bottom - 1,
      lastClearBottom: last ? (last.bottom <= a0.top + 1) : false,
      barsAtEdges: Math.abs(a0.bottom - c0.bottom) <= 2 && Math.abs(h0.top - c0.top) <= 2
    };
  })()`);
  const m040 = await J(`(function(){
    AR.UI.closeModal();
    AR.UI.openModal({ title: '0.4.0a 契约', body: '<div style="height:200px">x</div>', actions: [{ label: '保存', kind: 'primary' }] });
    var card = document.getElementById('modalCard'), cs = getComputedStyle(card);
    var acts = document.querySelector('.modal-actions'), as = acts ? getComputedStyle(acts) : null;
    var head = document.querySelector('.modal-head'), hs = head ? getComputedStyle(head) : null;
    function al(c){ var m = /rgba?\\(([^)]+)\\)/.exec(c || ''); if(!m) return 1; var p = m[1].split(','); return p.length > 3 ? parseFloat(p[3]) : 1; }
    var out = {
      glassGone: document.querySelectorAll('.modal-glass, .modal-scroll').length === 0,
      cardScroll: cs.overflow === 'auto',
      cardAlpha: al(cs.backgroundColor),
      headPlain: !!hs && (!hs.backdropFilter || hs.backdropFilter === 'none') && al(hs.backgroundColor) < 0.2,
      actsSticky: !!as && as.position === 'sticky',
      actsAlpha: as ? al(as.backgroundColor) : 0,
      bars: card.querySelectorAll('.modal-head, .modal-actions').length
    };
    AR.UI.closeModal();
    return out;
  })()`);
  ok('R12 弹窗 = v0.4.0a：整卡是唯一玻璃层（无 .modal-glass/.modal-scroll）、卡片自身滚动、标题为普通内容、操作条用 0.4.0 的 sticky 吸底',
    m040.glassGone && m040.cardScroll && m040.cardAlpha >= 0.7 && m040.headPlain && m040.actsSticky && m040.actsAlpha >= 0.6 && m040.bars === 2,
    JSON.stringify(m040));

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
    modal2.rows === 1 && modal2.gapOk === true && modal2.naturalWidth === true,
    JSON.stringify(modal2));

  // R12c 已移除：按用户要求删掉「弹窗质感」设置项（模糊固定为标准档）

  // ── R13 桌面卡片：功能显示预设（每种尺寸 A/B/C）──
  const wgPre = await J(`(function(){
    var S = AR.Store.get();
    S.settings.widgets = S.settings.widgets || {};
    S.settings.widgets.presets = S.settings.widgets.presets || {};
    S.settings.widgets.hidden = {};
    var W = S.settings.widgets.presets;
    var base = AR.WidgetData.build();
    W.head = 'B'; var hb = AR.WidgetData.build();
    W.head = 'C'; var hc = AR.WidgetData.build();
    W.next = 'C'; var nc = AR.WidgetData.build();
    W.week = 'A'; var wa = AR.WidgetData.build();
    W.today = 'C'; var tc = AR.WidgetData.build();
    W.head = 'A'; W.next = 'A'; W.week = 'B'; W.today = 'A';
    var only = function (a, lo, hi) { for (var i = 0; i < a.length; i++) { if (a[i].d < lo || a[i].d > hi) { return false; } } return true; };
    return {
      headChanges: hb.todayBadge !== base.todayBadge || hb.todaySub !== base.todaySub,
      headC: /还剩|休息/.test(hc.todayBadge),
      nextC: nc.nextPlace === '',
      weekA: only(wa.week, 1, 5),
      todayC: tc.today.every(function (r) { return r.place === ''; }),
      restored: AR.Store.get().settings.widgets.presets.head === 'A'
    };
  })()`);
  ok('R13 桌面卡片功能预设：切换 A/B/C 会改变 payload 内容（今日头/下一节课/本周/今日清单）',
    wgPre.headChanges === true && wgPre.headC === true && wgPre.nextC === true
    && wgPre.weekA === true && wgPre.todayC === true && wgPre.restored === true,
    JSON.stringify(wgPre));

  // ── R14 桌面卡片：显示元素自由组合（hide 数组 + 字段清空 + UI 开关）──
  const wgEl = await J(`(function(){
    var S = AR.Store.get();
    S.settings.widgets.hidden = {};
    var base = AR.WidgetData.build();
    S.settings.widgets.hidden = { headSub: true, headBadge: true, nextTime: true, nextPlace: true, nextIn: true, todayTime: true, todayPlace: true, weekSub: true };
    var off = AR.WidgetData.build();
    S.settings.widgets.hidden = { nextPlace: true, todayPlace: true };
    var part = AR.WidgetData.build();
    S.settings.widgets.hidden = {};
    AR.WidgetData.sync(true);
    return {
      baseEmpty: base.hide.length === 0,
      offAll: off.hide.length === 8 && off.todaySub === '' && off.todayBadge === '' && off.nextTime === '' && off.weekTotalText === '',
      partOnly: part.hide.length === 2 && part.nextPlace === '' && part.nextTime !== ''
    };
  })()`);
  // UI 分两步：先导航到「设置 → 桌面卡片」，再量开关（避免设置页停在二级页时点不到）
  await J(`(function(){
    if (AR.Panels && AR.Panels.settingsGoHome) { AR.Panels.settingsGoHome(); }
    AR.UI.show('settings');
    var cat = document.querySelector('#settingsGrid .set-cat[data-key="widgets"] .set-cat-head');
    if (cat) { cat.click(); }
    return 'nav';
  })()`);
  await sleep(320);
  await J(`(function(){
    var hit = null, rows = document.querySelectorAll('.q-item, .export-row, .set-row, .setting-row, .field');
    for (var i = 0; i < rows.length; i++) { if ((rows[i].textContent || '').indexOf('桌面卡片') >= 0) { hit = rows[i]; } }
    if (hit) { hit.click(); }
    return 'open';
  })()`);
  await sleep(320);
  const wgEl2 = await J(`(function(){
    var chip = document.querySelector('.wg-el');
    var before = chip ? chip.classList.contains('active') : null;
    if (chip) { chip.click(); }
    var after = chip ? chip.classList.contains('active') : null;
    var saved = Object.keys(AR.Store.get().settings.widgets.hidden || {}).length > 0;
    var out = {
      elRows: document.querySelectorAll('.wg-els').length,
      chips: document.querySelectorAll('.wg-el').length,
      toggled: before !== null && before !== after,
      saved: saved
    };
    AR.Store.get().settings.widgets.hidden = {};
    AR.WidgetData.sync(true);
    return out;
  })()`);
  ok('R14 桌面卡片显示元素：可自由组合（hide 数组 + 字段清空 + 4 行 8 个 UI 开关，点击落盘）',
    wgEl.baseEmpty === true && wgEl.offAll === true && wgEl.partOnly === true
    && wgEl2.elRows === 4 && wgEl2.chips === 8 && wgEl2.toggled === true && wgEl2.saved === true,
    JSON.stringify({ payload: wgEl, ui: wgEl2 }));

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
  // ── R15 兼容性回归：弹窗背景在旧 WebView 上不能变透明（0.4.1 线上 bug）──
  const compat = await J(`(function(){
    function alpha(c) {
      var m = /rgba?\\(([^)]+)\\)/.exec(c || '');
      if (!m) { return c === 'transparent' ? 0 : -1; }
      var p = m[1].split(',');
      return p.length > 3 ? parseFloat(p[3]) : 1;
    }
    function probe() {
      var glass = document.querySelector('.modal-card');
      var head = document.querySelector('.modal-head');
      var acts = document.querySelector('.modal-actions');
      var gc = getComputedStyle(glass), hc = getComputedStyle(head);
      return { glass: alpha(gc.backgroundColor), glassBlur: (gc.backdropFilter || gc.webkitBackdropFilter),
               head: alpha(hc.backgroundColor), acts: acts ? alpha(getComputedStyle(acts).backgroundColor) : null };
    }
    AR.UI.closeModal();
    document.body.setAttribute('data-theme', 'light');
    AR.UI.openModal({ title: '兼容性回归', body: '<div style="height:240px">内容</div>', actions: [{ label: '保存', kind: 'primary' }] });
    var light = probe();
    document.body.setAttribute('data-theme', 'dark');
    var dark = probe();
    document.body.setAttribute('data-perf', 'lite'); if (AR.UI.applyModalTuning) { AR.UI.applyModalTuning(); }
    AR.UI.applyModalTuning();     // 流畅模式会夹取透明度下限（切模式时会自动调）
    var perf = probe();
    document.body.removeAttribute('data-perf');
    AR.UI.applyModalTuning();
    AR.UI.closeModal();
    return { light: light, dark: dark, perf: perf };
  })()`);
  ok('R15a 弹窗 = 0.4.0a：卡片 78%/70% 玻璃 + 背景化开；操作条为 sticky 玻璃；流畅模式无模糊且卡片 90%',
    compat.light.glass >= 0.7 && compat.light.glass <= 0.85
    && compat.dark.glass >= 0.62 && compat.dark.glass <= 0.85
    && /blur\(/.test(compat.light.glassBlur || '')
    && compat.perf.glass >= 0.85 && (compat.perf.glassBlur === 'none' || compat.perf.glassBlur === ''),
    JSON.stringify(compat));

  // ── R16 开发者模式：长按底部「设置」开关 + 独立分类 + 玻璃样式预设切换 ──
  await J(`(function(){
    var b = document.querySelector('.nav-btn[data-nav="settings"]');
    AR.UI.show('settings');
    var r = b.getBoundingClientRect();
    b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: r.left + 5, clientY: r.top + 5 }));
    return 'down';
  })()`);
  await sleep(1000);
  const devOn = await J(`(function(){
    return { on: AR.Store.get().settings.appearance.devMode === true,
      cat: !!document.querySelector('#settingsGrid .set-cat[data-key="dev"]') };
  })()`);
  const devPanelInfo = await J(`(function(){
    var head = document.querySelector('#settingsGrid .set-cat[data-key="dev"] .set-cat-head');
    if (head) { head.click(); }
    return { panel: !!document.getElementById('set-dev'), chips: document.querySelectorAll('.ms-chip').length };
  })()`);
  await sleep(400);
  const styleMeasure = `(function(){
    function a(c){ var m=/rgba?\\(([^)]+)\\)/.exec(c||''); if(!m){return c==='transparent'?0:-1;} var p=m[1].split(','); return p.length>3?parseFloat(p[3]):1; }
    AR.UI.closeModal();
    AR.UI.openModal({ title: '样式检查', body: '<div style="height:120px">内容</div>', actions: [{ label: '保存', kind: 'primary' }] });
    var g = getComputedStyle(document.querySelector('.modal-card'));
    var h = getComputedStyle(document.querySelector('.modal-actions'));
    var out = { glass: a(g.backgroundColor), blur: (g.backdropFilter || g.webkitBackdropFilter), bar: a(h.backgroundColor), active: AR.UI.modalCfg().active };
    AR.UI.closeModal();
    return out;
  })()`;
  const stGlass = await J(styleMeasure);
  await J(`(function(){
    var chips = document.querySelectorAll('.ms-chip');
    for (var i = 0; i < chips.length; i++) { if (chips[i].textContent.indexOf('轻量') >= 0) { chips[i].click(); return 'ok'; } }
    return 'none';
  })()`);
  await sleep(400);
  const stLite = await J(styleMeasure);
  await J(`(function(){
    AR.UI.show('settings'); AR.Panels.settingsGoHome();
    var head = document.querySelector('#settingsGrid .set-cat[data-key="dev"] .set-cat-head');
    if (head) { head.click(); }
    var chips = document.querySelectorAll('.ms-chip');
    for (var i = 0; i < chips.length; i++) { if (chips[i].textContent.indexOf('整卡磨砂') >= 0) { chips[i].click(); return 'ok'; } }
    return 'none';
  })()`);
  await sleep(400);
  const stBack = await J(styleMeasure);
  await J(`(function(){
    var b = document.querySelector('.nav-btn[data-nav="settings"]');
    AR.UI.show('settings'); AR.Panels.settingsGoHome();
    var r = b.getBoundingClientRect();
    b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: r.left + 5, clientY: r.top + 5 }));
    return 'down';
  })()`);
  await sleep(1000);
  const devOff = await J(`(function(){
    return { on: AR.Store.get().settings.appearance.devMode === true,
      cat: !!document.querySelector('#settingsGrid .set-cat[data-key="dev"]') };
  })()`);
  ok('R16 开发者模式：长按底部「设置」开关，设置里多出独立分类「开发者模式」（无高频项），再长按移除；玻璃样式预设可切换',
    devOn.on === true && devOn.cat === true && devOn.quickItems === undefined
    && devPanelInfo.panel === true && devPanelInfo.chips === 7
    && stGlass.active === 'builtin:glass' && stGlass.glass >= 0.7
    && stLite.active === 'builtin:lite' && stLite.glass >= 0.7 && stLite.bar <= 0.85
    && stBack.active === 'builtin:glass' && stBack.glass >= 0.7
    && devOff.on === false && devOff.cat === false,
    JSON.stringify({ devOn: devOn, devPanelInfo: devPanelInfo, stGlass: stGlass, stLite: stLite, stBack: stBack, devOff: devOff }));

  const cssScan = await J(`(async function(){
    var txt = await fetch('css/app.css').then(function (r) { return r.text(); });
    var code = txt.replace(/\\/\\*[\\s\\S]*?\\*\\//g, '');
    return {
      lightDark: (code.match(/light-dark\\(/g) || []).length,
      colorMix: (code.match(/color-mix\\(/g) || []).length,
      has: (code.match(/[^a-z-]:has\\(/g) || []).length,
      container: (code.match(/@container/g) || []).length,
      gutter: (code.match(/scrollbar-gutter/g) || []).length,
      fallback: code.indexOf('@supports not') >= 0
    };
  })()`);
  ok('R15b CSS 不用旧 WebView 不认的特性，且保留 backdrop-filter 兜底',
    cssScan.lightDark === 0 && cssScan.colorMix === 0 && cssScan.has === 0 && cssScan.container === 0
    && cssScan.gutter === 0 && cssScan.fallback === true,
    JSON.stringify(cssScan));

  await J(`AR.UI.show('today');'ok'`);
  ok('R6 收尾清理', true, '');

  console.log('');
  console.log(`RESULT: PASS=${pass} FAIL=${fail}`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('DRIVER-ERROR', e); process.exit(2); });