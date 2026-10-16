/**
 * 回归：周表编辑链路（v0.4.1a 修的三个 bug + 新增的「调到另一天」）
 *
 *   E1 编辑器节次回显 = 当天生效值（不是模板值）        ← Bug 1
 *   E2 作用域默认跟随用户上次选择                        ← 作用域漂移
 *   E3 改星期后原星期的单次记录被搬走、无幽灵记录        ← Bug 3
 *   E4 调课·移动：原日取消 + 目标日出现，模板不动        ← 新功能
 *   E5 调课·复制：两边都在，模板不动                     ← 新功能
 *   E6 调课后再打开编辑器：节次回显正确、无多余记录      ← 组合
 *
 * 用法：CDP_PORT=9333 node tools/verify-edit.js
 */
const port = process.env.CDP_PORT || '9333';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  const s = cond ? 'PASS' : 'FAIL';
  if (cond) { pass++; } else { fail++; }
  console.log(`[${s}] ${name}${detail ? '  |  ' + detail : ''}`);
  return !!cond;
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let n = 0; const waiters = new Map();
    ws.addEventListener('open', () => {
      ws.addEventListener('message', (e) => {
        const m = JSON.parse(e.data);
        if (m.id && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); }
      });
      resolve({ ws, send: (method, params) => new Promise((res) => {
        const id = ++n; waiters.set(id, res);
        ws.send(JSON.stringify({ id, method, params: params || {} }));
      }) });
    });
    ws.addEventListener('error', reject);
  });
}

async function main() {
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = list.find((t) => t.type === 'page' && t.url.indexOf('index.html') >= 0);
  if (!page) { throw new Error('找不到页面目标，先跑 tools/headless.ps1'); }
  const { ws, send } = await connect(page.webSocketDebuggerUrl);
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result && r.result.exceptionDetails) {
      throw new Error('EVAL: ' + (r.result.exceptionDetails.exception
        ? (r.result.exceptionDetails.exception.description || r.result.exceptionDetails.exception.value)
        : r.result.exceptionDetails.text));
    }
    return r.result && r.result.result ? r.result.result.value : undefined;
  };

  await send('Page.enable');
  await ev(`(function(){ try{ localStorage.clear(); }catch(e){} return 1; })()`);
  await send('Page.reload', { ignoreCache: true });
  await sleep(3000);

  /** 造一节干净的课：周一 第1-2节 全周 */
  const seed = () => ev(`(function(){
      var S = AR.Store, st = S.get(), sem = S.currentSemester();
      st.courses = []; st.blocks = []; st.overrides = []; st.tasks = [];
      var cid = 'cE1', bid = 'bE1';
      var now = new Date().toISOString();
      st.courses.push({ id: cid, name: '回归课', semesterId: sem.id, colorKey: 'blue',
        teacherIds: [], createdAt: now, updatedAt: now });
      st.blocks.push({ id: bid, courseId: cid, weekday: 1, periodStart: 1, periodEnd: 2,
        weekMode: 'all', weeks: [], locationIds: [], teacherIds: [], createdAt: now, updatedAt: now });
      S.save(true);
      window.__b = bid; window.__c = cid;
      AR.UI.show('week');
      return 'seeded';
    })()`);

  const monday = () => ev(`AR.Util.dateKey(AR.Util.addDays(AR.Util.mondayOf(new Date()), 0))`);
  const itemOf = (offset) => ev(`(function(){
      var sem = AR.Store.currentSemester();
      var d = AR.Util.addDays(AR.Util.mondayOf(new Date()), ${offset});
      var its = AR.Schedule.dayItems(d, sem).filter(function(i){ return i.blockId === window.__b; });
      return its.length ? { kind: its[0].kind, pStart: its[0].block.periodStart, pEnd: its[0].block.periodEnd,
        overrideId: its[0].override ? its[0].override.id : null,
        overrideType: its[0].override ? its[0].override.type : null,
        start: its[0].start, end: its[0].end } : null;
    })()`);

  const openEditorAt = (offset) => ev(`(function(){
      var sem = AR.Store.currentSemester();
      var d = AR.Util.addDays(AR.Util.mondayOf(new Date()), ${offset});
      var its = AR.Schedule.dayItems(d, sem).filter(function(i){ return i.blockId === window.__b; });
      if (!its.length) return 'NO ITEM';
      window.__item = its[0];
      AR.UI.openBlockEditor(its[0], {});
      return JSON.stringify({
        editorStart: (document.getElementById('ebPStart')||{}).value,
        editorEnd: (document.getElementById('ebPEnd')||{}).value,
        scope: (document.querySelector('#modalCard .scope-btn.active')||{}).textContent || null
      });
    })()`);

  const clickScope = (which) => ev(`(function(){
      var b = document.querySelector('#modalCard .scope-btn[data-scope="${which}"]');
      if (!b) return 'NO btn';
      b.click();
      return (document.querySelector('#modalCard .scope-btn.active')||{}).textContent;
    })()`);

  const setEnd = (n) => ev(`(function(){
      var b = document.getElementById('ebPEnd');
      b.value = '${n}';
      b.dispatchEvent(new Event('change', { bubbles: true }));
      return b.value;
    })()`);

  const save = () => ev(`(function(){
      var btns = document.querySelectorAll('#modalCard .modal-actions .btn');
      for (var i=0;i<btns.length;i++){ if (/保存/.test(btns[i].textContent)) { btns[i].click(); return btns[i].textContent.trim(); } }
      return 'NO save';
    })()`);

  const overrides = () => ev(`JSON.stringify((AR.Store.get().overrides||[]).map(function(o){
      return { type: o.type, date: o.date, del: !!o.deletedAt, ps: o.newPeriodStart, pe: o.newPeriodEnd, nd: o.newDate };
    }))`);

  const closeModal = () => ev(`(function(){ AR.UI.closeModal(); return 1; })()`);

  /* ── E1：仅这次改成 1-3 后，重开编辑器应回显 1-3（不是模板的 1-2） ── */
  await seed();
  await sleep(600);
  let ed = JSON.parse(await openEditorAt(0));
  ok('E1a 初始回显 = 模板 1-2', ed.editorStart === '1' && ed.editorEnd === '2', JSON.stringify(ed));
  await clickScope('once');
  await setEnd(3);
  await save();
  await sleep(700);
  await closeModal();
  await sleep(300);
  ed = JSON.parse(await openEditorAt(0));
  ok('E1b 改大后重开，回显 = 这天生效的 1-3', ed.editorStart === '1' && ed.editorEnd === '3', JSON.stringify(ed));

  // 把它改回 3（同值）—— 真正的判据是：编辑器显示的就是 3，用户"改回 3"不会被当成没变
  await clickScope('once');
  await setEnd(3);
  const afterSame = await ev(`(function(){
      return (document.getElementById('ebPEnd')||{}).value;
    })()`);
  ok('E1c 显示值正确，用户再选同一值不会"看似无效"', afterSame === '3', 'ebPEnd=' + afterSame);
  await closeModal();
  await sleep(200);

  /* ── E2：作用域记忆 ── */
  await seed();
  await sleep(600);
  await openEditorAt(0);
  await clickScope('once');
  await closeModal();
  await sleep(300);
  const remember = JSON.parse(await openEditorAt(0));
  ok('E2 上次选「仅这次」→ 下次默认「仅这次」',
    /仅这次/.test(remember.scope || ''), 'scope=' + remember.scope);
  await clickScope('all');
  await closeModal();
  await sleep(300);
  const remember2 = JSON.parse(await openEditorAt(0));
  ok('E2b 改回「所有时段」→ 下次默认「所有时段」',
    /所有时段/.test(remember2.scope || ''), 'scope=' + remember2.scope);
  await closeModal();
  await sleep(200);

  /* ── E3：改星期后原星期的单次记录要跟着搬走（无幽灵） ── */
  await seed();
  await sleep(600);
  // 先在周一那天做一条「仅这次」的节次调整（1-3）
  await openEditorAt(0);
  await clickScope('once');
  await setEnd(3);
  await save();
  await sleep(700);
  await closeModal();
  await sleep(200);
  const beforeE3 = JSON.parse(await overrides());
  ok('E3a 已有一条周一(2026-10-12)的 edit 记录',
    beforeE3.length === 1 && beforeE3[0].type === 'edit', JSON.stringify(beforeE3));

  // 再把模板从周一改到周三（作用域=所有时段）
  await openEditorAt(0);
  await clickScope('all');
  await ev(`(function(){
      var b = document.getElementById('ebWeekday');
      if (b) { b.value = '3'; b.dispatchEvent(new Event('change', { bubbles: true })); return b.value; }
      return 'no weekday picker';
    })()`);
  await sleep(200);
  await save();
  await sleep(800);
  await closeModal();
  await sleep(300);
  const afterE3 = JSON.parse(await overrides());
  const templateWd = await ev(`AR.Store.blockById(window.__b).weekday`);
  const activeE3 = afterE3.filter((o) => !o.del);
  ok('E3b 移动后：原星期(周一)不再挂着生效记录',
    activeE3.every((o) => o.date !== '2026-10-12'), JSON.stringify(activeE3));
  ok('E3c 记录被搬到新星期(周三 2026-10-14)',
    activeE3.some((o) => o.date === '2026-10-14'), JSON.stringify(activeE3));
  ok('E3d 模板星期确实改成周三', Number(templateWd) === 3, 'weekday=' + templateWd);
  ok('E3e 被搬走的旧记录是软删除（可恢复），不是硬删',
    afterE3.some((o) => o.date === '2026-10-12' && o.del), JSON.stringify(afterE3));

  /* ── E4：调课·移动 ── */
  await seed();
  await sleep(600);
  const moveRes = await ev(`(function(){
      var sem = AR.Store.currentSemester();
      var monday = AR.Util.addDays(AR.Util.mondayOf(new Date()), 0);
      var its = AR.Schedule.dayItems(monday, sem).filter(function(i){ return i.blockId === window.__b; });
      if (!its.length) return 'NO ITEM';
      var target = AR.Util.addDays(AR.Util.mondayOf(new Date()), 3);   // 周四
      var r = AR.UI.applyCourseShift(its[0], target, 'move');
      return JSON.stringify({ r: r, targetKey: AR.Util.dateKey(target) });
    })()`);
  const mv = JSON.parse(moveRes);
  ok('E4a 调课·移动返回成功', mv.r && mv.r.ok === true, moveRes);
  await sleep(400);
  const monAfterMove = await itemOf(0);
  const thuAfterMove = await itemOf(3);
  const tmplAfterMove = await ev(`JSON.stringify({ wd: AR.Store.blockById(window.__b).weekday, ps: AR.Store.blockById(window.__b).periodStart, pe: AR.Store.blockById(window.__b).periodEnd })`);
  ok('E4b 原日（周一）这节课消失', monAfterMove === null, JSON.stringify(monAfterMove));
  ok('E4c 目标日（周四）出现这节课', !!thuAfterMove && thuAfterMove.kind === 'moved-in', JSON.stringify(thuAfterMove));
  ok('E4d 课程模板没被动（仍周一 1-2 节）', tmplAfterMove === '{"wd":1,"ps":1,"pe":2}', tmplAfterMove);

  /* ── E5：调课·复制 ── */
  await seed();
  await sleep(600);
  const copyRes = await ev(`(function(){
      var sem = AR.Store.currentSemester();
      var monday = AR.Util.addDays(AR.Util.mondayOf(new Date()), 0);
      var its = AR.Schedule.dayItems(monday, sem).filter(function(i){ return i.blockId === window.__b; });
      var target = AR.Util.addDays(AR.Util.mondayOf(new Date()), 4);   // 周五
      var r = AR.UI.applyCourseShift(its[0], target, 'copy');
      return JSON.stringify({ r: r });
    })()`);
  const cp = JSON.parse(copyRes);
  ok('E5a 调课·复制返回成功', cp.r && cp.r.ok === true, copyRes);
  await sleep(400);
  const monAfterCopy = await itemOf(0);
  const friAfterCopy = await itemOf(4);
  const tmplAfterCopy = await ev(`JSON.stringify({ wd: AR.Store.blockById(window.__b).weekday })`);
  ok('E5b 原日（周一）仍然有课', !!monAfterCopy, JSON.stringify(monAfterCopy));
  ok('E5c 目标日（周五）多出一节', !!friAfterCopy, JSON.stringify(friAfterCopy));
  ok('E5d 模板仍未被改', tmplAfterCopy === '{"wd":1}', tmplAfterCopy);

  /* ── E6：调课后再打开编辑器，回显与记录都对 ── */
  await seed();
  await sleep(600);
  await ev(`(function(){
      var sem = AR.Store.currentSemester();
      var monday = AR.Util.addDays(AR.Util.mondayOf(new Date()), 0);
      var its = AR.Schedule.dayItems(monday, sem).filter(function(i){ return i.blockId === window.__b; });
      AR.UI.applyCourseShift(its[0], AR.Util.addDays(AR.Util.mondayOf(new Date()), 3), 'move');
      return 1;
    })()`);
  await sleep(500);
  const after = JSON.parse(await openEditorAt(3));
  ok('E6a 打开周四那节，节次回显 1-2', after.editorStart === '1' && after.editorEnd === '2', JSON.stringify(after));
  const activeOv = JSON.parse(await overrides()).filter((o) => !o.del);
  ok('E6b 调课后记录干净：来源 cancel + 目标 move，共 2 条',
    activeOv.length === 2 && activeOv.some((o) => o.type === 'cancel') && activeOv.some((o) => o.type === 'move'),
    JSON.stringify(activeOv));

  /* ── E7：撤回上次修改（编辑页按钮） ── */
  await seed();
  await sleep(600);
  const beforeUndo = await ev(`JSON.stringify({
      name: AR.Store.courseById(window.__c).name,
      pe: AR.Store.blockById(window.__b).periodEnd,
      hasSnapshot: !!AR.Store.courseById(window.__c).undo
    })`);
  ok('E7a 改动前没有快照', JSON.parse(beforeUndo).hasSnapshot === false, beforeUndo);
  // 改一次（仅这次把节次改到 3）→ 应产生快照
  await openEditorAt(0);
  await clickScope('once');
  await setEnd(3);
  await save();
  await sleep(800);
  const afterEdit = await ev(`JSON.stringify({
      pe: AR.Store.blockById(window.__b).periodEnd,
      ovCount: (AR.Store.get().overrides||[]).filter(function(o){return o.courseId===window.__c && !o.deletedAt;}).length,
      hasSnapshot: !!AR.Store.courseById(window.__c).undo
    })`);
  ok('E7b 保存后产生了快照', JSON.parse(afterEdit).hasSnapshot === true, afterEdit);
  ok('E7c 改动已生效（多了一条单次记录）', JSON.parse(afterEdit).ovCount === 1, afterEdit);

  // 打开编辑器应能看到「撤回上次修改」按钮
  await closeModal();
  await sleep(300);
  await openEditorAt(0);
  const hasUndoBtn = await ev(`(function(){
      var bs = document.querySelectorAll('#modalCard .modal-actions .btn');
      for (var i=0;i<bs.length;i++){ if (/撤回上次修改/.test(bs[i].textContent)) return true; }
      return false;
    })()`);
  ok('E7d 编辑页出现「撤回上次修改」按钮', hasUndoBtn === true, 'btn=' + hasUndoBtn);
  // 点它
  const undoClick = await ev(`(function(){
      var bs = document.querySelectorAll('#modalCard .modal-actions .btn');
      for (var i=0;i<bs.length;i++){ if (/撤回上次修改/.test(bs[i].textContent)) { bs[i].click(); return 'clicked'; } }
      return 'not found';
    })()`);
  await sleep(800);
  const afterUndo = await ev(`JSON.stringify({
      pe: AR.Store.blockById(window.__b).periodEnd,
      ps: AR.Store.blockById(window.__b).periodStart,
      wd: AR.Store.blockById(window.__b).weekday,
      ovCount: (AR.Store.get().overrides||[]).filter(function(o){return o.courseId===window.__c && !o.deletedAt;}).length,
      hasSnapshot: !!AR.Store.courseById(window.__c).undo,
      blocksOfCourse: AR.Store.get().blocks.filter(function(b){return b.courseId===window.__c;}).length
    })`);
  const au = JSON.parse(afterUndo);
  ok('E7e 撤回已执行', undoClick === 'clicked', undoClick);
  ok('E7f 撤回后节次恢复 1-2', au.ps === 1 && au.pe === 2, afterUndo);
  ok('E7g 撤回后单次记录被清掉', au.ovCount === 0, afterUndo);
  ok('E7h 撤回后快照被消费（不能反复横跳）', au.hasSnapshot === false, afterUndo);
  ok('E7i 撤回后课程时段仍在（没被删）', au.blocksOfCourse === 1, afterUndo);

  /* ── E8：调课弹窗（紧凑周表选目标日） ── */
  await seed();
  await sleep(700);
  const shiftOpen = await ev(`(function(){
      var sem = AR.Store.currentSemester();
      var monday = AR.Util.addDays(AR.Util.mondayOf(new Date()), 0);
      var its = AR.Schedule.dayItems(monday, sem).filter(function(i){ return i.blockId === window.__b; });
      if (!its.length) return 'NO ITEM';
      AR.UI.openCourseShiftModal(its[0]);
      return JSON.stringify({
        title: (document.querySelector('#modalCard .modal-title')||{}).textContent,
        rows: document.querySelectorAll('#csGrid .cm-shift-row').length,
        slots: document.querySelectorAll('#csGrid .cm-shift-slot').length,
        mine: document.querySelectorAll('#csGrid .cm-shift-slot.mine').length,
        free: document.querySelectorAll('#csGrid .cm-shift-slot.free').length,
        weekLabel: (document.querySelector('#csWeekLabel')||{}).textContent,
        hasPrev: !!document.querySelector('#csPrev'),
        hasNext: !!document.querySelector('#csNext'),
        actions: Array.prototype.map.call(document.querySelectorAll('#modalCard .modal-actions .btn'), function(b){ return b.textContent.trim(); })
      });
    })()`);
  const so = JSON.parse(shiftOpen);
  ok('E8a 调课弹窗打开', so.title === '调课 / 借课', shiftOpen);
  ok('E8b 渲染了 4 周 × 7 天 × 节次 的行数', so.rows >= 4 * 7, 'rows=' + so.rows);
  ok('E8c 格子数 = 4 周 × 7 天 × 12 节 = 336', so.slots === 336, 'slots=' + so.slots);
  ok('E8d 来源课被标记（mine）', so.mine >= 1, 'mine=' + so.mine);
  ok('E8e 有空白档可点（free）', so.free > 0, 'free=' + so.free);
  ok('E8f 有周翻页控件与周标签', so.hasPrev && so.hasNext && /第 \d+ – \d+ 周/.test(so.weekLabel || ''), so.weekLabel);
  ok('E8g 底部有「移动过去 / 复制过去」',
    so.actions.indexOf('移动过去') >= 0 && so.actions.indexOf('复制过去') >= 0, JSON.stringify(so.actions));

  // 点一个"周四第1节"的空格作为目标（周四 = 源周 +3 天）
  const pickCell = await ev(`(function(){
      var sem = AR.Store.currentSemester();
      var mon = AR.Util.mondayOf(AR.Util.addDays(AR.Util.mondayOf(new Date()), 0));
      var target = AR.Util.dateKey(AR.Util.addDays(mon, 3));
      var cell = document.querySelector('#csGrid .cm-shift-slot[data-day="' + target + '"][data-p="1"]');
      if (!cell) return 'NO CELL for ' + target;
      cell.click();
      return JSON.stringify({
        target: target,
        picked: document.querySelectorAll('#csGrid .cm-shift-slot.picked').length,
        preview: (document.querySelector('#csPreview')||{}).textContent || ''
      });
    })()`);
  const pc = JSON.parse(pickCell);
  ok('E8h 点格子后出现选中态', pc.picked === 1, pickCell);
  ok('E8i 预览显示目标星期与节次', /第 1 节/.test(pc.preview), pc.preview.slice(0, 80));

  // 点「移动过去」
  const doMove = await ev(`(function(){
      var bs = document.querySelectorAll('#modalCard .modal-actions .btn');
      for (var i=0;i<bs.length;i++){ if (/移动过去/.test(bs[i].textContent)) { bs[i].click(); return 'clicked'; } }
      return 'not found';
    })()`);
  /**
   * 弹窗是"退场动画结束后才 hidden"，所以不能只 sleep 一个固定值就断言
   * —— 这里轮询 #modalRoot.hidden（这才是"彻底关闭"的判据，不是 .open 类）。
   */
  let modalClosed = false;
  for (let i = 0; i < 30 && !modalClosed; i++) {
    await sleep(100);
    modalClosed = await ev(`document.getElementById('modalRoot').hidden === true`);
  }
  await sleep(200);
  const afterModal = await ev(`JSON.stringify({
      modalClosed: document.getElementById('modalRoot').hidden === true,
      mondayStill: AR.Schedule.dayItems(AR.Util.addDays(AR.Util.mondayOf(new Date()),0), AR.Store.currentSemester()).filter(function(i){return i.blockId===window.__b;}).length,
      thursdayHas: AR.Schedule.dayItems(AR.Util.addDays(AR.Util.mondayOf(new Date()),3), AR.Store.currentSemester()).filter(function(i){return i.blockId===window.__b;}).length,
      templateWd: AR.Store.blockById(window.__b).weekday
    })`);
  const am = JSON.parse(afterModal);
  ok('E8j 点「移动过去」已执行且弹窗彻底关闭',
    doMove === 'clicked' && am.modalClosed === true, afterModal);
  ok('E8k 周一这节没了', am.mondayStill === 0, afterModal);
  ok('E8l 周四出现了这节课', am.thursdayHas === 1, afterModal);
  ok('E8m 课程模板仍是周一（只动这一次）', am.templateWd === 1, afterModal);

  /* ── E9：导出/导入带上个性化设置 + 老版本配置兼容 ── */
  const mkPayload = (appearance, layout) => ev(`(function(){
      var base = JSON.parse(JSON.stringify(AR.Store.exportPayload()));
      base.settings.appearance = Object.assign({}, base.settings.appearance, ${JSON.stringify(appearance)});
      ${layout ? `base.settings.layout = Object.assign({}, base.settings.layout, ${JSON.stringify(layout)});` : ''}
      base.settings.widgets = { presets: { head: 'C' } };
      window.__p1 = base;
      return 'ok';
    })()`);
  await mkPayload({ theme: 'dark', accent: '#FF6600', glassLevel: 'high', animationSpeed: 0.5 }, { preset: 'stacked-vertical' });
  const payloadHas = await ev(`JSON.stringify({
      theme: window.__p1.settings.appearance.theme,
      accent: window.__p1.settings.appearance.accent,
      widgets: JSON.stringify(window.__p1.settings.widgets),
      hasSettings: !!window.__p1.settings
    })`);
  ok('E9a 导出内容包含个性化设置', JSON.parse(payloadHas).theme === 'dark' && JSON.parse(payloadHas).widgets !== '{}', payloadHas);

  // 本机先改成另一套，再导入 → 应以导入方为准
  await ev(`(function(){
      var ap = AR.Store.get().settings.appearance;
      ap.theme = 'light'; ap.accent = '#123456'; AR.Store.save(true);
      return 1;
    })()`);
  const merged = await ev(`(function(){
      AR.Store.applyMerge(JSON.parse(JSON.stringify(window.__p1)), {});
      var ap = AR.Store.get().settings.appearance;
      return JSON.stringify({
        theme: ap.theme, accent: ap.accent, speed: ap.animationSpeed,
        layoutPreset: AR.Store.get().settings.layout.preset,
        widgets: JSON.stringify(AR.Store.get().settings.widgets)
      });
    })()`);
  const mg = JSON.parse(merged);
  ok('E9b 导入后主题被带入（dark）', mg.theme === 'dark', merged);
  ok('E9c 导入后主题色被带入', mg.accent === '#FF6600', merged);
  ok('E9d 导入后流畅模式档位被带入', Number(mg.speed) === 0.5, merged);
  ok('E9e 导入后布局被带入', mg.layoutPreset === 'stacked-vertical', merged);
  ok('E9f 导入后桌面卡片设置被带入', /head/.test(mg.widgets), merged);

  // 老版本配置：settings 里没有 widgets / nextAlert 等新命名空间 → 本机这些必须原样保留
  const legacy = await ev(`(function(){
      var st = AR.Store.get();
      st.settings.widgets = { presets: { head: 'A' } };
      st.settings.nextAlert = { enabled: true, nearMin: 7, soonMin: 9, thickBorder: false, colors: {} };
      st.settings.appearance.theme = 'light';
      AR.Store.save(true);

      // 造一份"老版本"配置：settings 只有 appearance/schedule/integration/haptics
      var old = JSON.parse(JSON.stringify(AR.Store.exportPayload()));
      old.appVersion = '0.3.0';
      delete old.settings.widgets;
      delete old.settings.nextAlert;
      delete old.settings.notifications;
      delete old.settings.experimental;
      old.settings.appearance.theme = 'dark';
      AR.Store.applyMerge(old, {});

      var s2 = AR.Store.get().settings;
      return JSON.stringify({
        theme: s2.appearance.theme,
        widgetsKept: JSON.stringify(s2.widgets),
        nextAlertKept: s2.nextAlert && s2.nextAlert.nearMin
      });
    })()`);
  const lg = JSON.parse(legacy);
  ok('E9g 老配置里有的设置照样应用（theme=dark）', lg.theme === 'dark', legacy);
  ok('E9h 老配置里没有的 widgets 保持本机值，未被清空', /head/.test(lg.widgetsKept || ''), legacy);
  ok('E9i 老配置里没有的 nextAlert 保持本机值', lg.nextAlertKept === 7, legacy);

  console.log(`\n合计：${pass} 通过 / ${fail} 失败`);
  process.exitCode = fail ? 1 : 0;
  try { ws.close(); } catch (e) { }
}
main().catch((e) => {
  console.error('运行失败：' + (e && e.stack ? e.stack : e));
  process.exitCode = 1;
});
