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
    AR.UI.show('settings');
    var row = document.querySelector('#settingsGrid .set-cat[data-key="syncdata"] .set-cat-head');
    row.click();
    var tabs = document.querySelectorAll('#settingsGrid .set-tabs .seg');
    var hit = null;
    for (var i = 0; i < tabs.length; i++) { if (tabs[i].textContent === '回收站') { hit = tabs[i]; } }
    if (!hit) { return { err: '没有回收站标签', n: tabs.length }; }
    hit.click();
    var panelEl = document.getElementById('set-trash');
    var rows = panelEl ? panelEl.querySelectorAll('.cm-line') : [];
    return { tabs: tabs.length, panel: !!panelEl, rows: rows.length,
             listed: panelEl ? panelEl.textContent.indexOf('待回收日程') >= 0 : false };
  })()`);
  ok('R5 设置 → 数据与同步 → 回收站：标签在、列出刚删的条目',
    trashPanel.panel === true && trashPanel.rows >= 1 && trashPanel.listed === true, JSON.stringify(trashPanel));

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
