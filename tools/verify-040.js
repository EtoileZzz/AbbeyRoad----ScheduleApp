/**
 * 0.4.0 专验（CDP 驱动，连 9333）：
 * A 迁移：倒计时并入日程、老事件补字段、customTab 默认开启
 * B 统一「添加日程」表单
 * C 无一键星标 + 长按菜单（含归档）
 * D 自定义类型筛选
 * E 日程一张卡：星标段置顶 + 时间线 + 已归档区；普通日程滑动归档带确认；星标删除长按确认
 * F 周表按时间画日程块（归档的不画）
 * G 设置 B′：8 分类列表 + 行内高频项 + 二级页 + 搜索命中清单
 * H 「我的」副标题 + 长期任务回归
 *
 * 用法：tools/headless.ps1 起好 8123 + 9333 后：CDP_PORT=9333 node tools/verify-040.js
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
  await sleep(1200);
  for (let i = 0; i < 40; i++) {
    const ready = await ev(ws, idRef, `(typeof AR !== 'undefined' && AR.Store && AR.UI && AR.Motion) ? 1 : 0`).catch(() => 0);
    if (ready) { break; }
    await sleep(300);
  }

  // ── A 夹具与迁移 ─────────────────────────────────────────
  const fixture = await J(`(function(){
    var S0 = AR.Store.get();
    if (!(S0.courses || []).length) {
      S0.settings.onboardingCompletedAt = new Date().toISOString();
      var e = AR.MdParse.demoEntities(S0);
      AR.MdParse.applyEntities(e, S0);
      AR.Store.save(true);
    }
    var S = AR.Store.get();
    S.events = []; S.countdowns = []; S.quickTodos = [];
    delete S.meta.countdownsMigrated;
    S.settings.experimental.customTab = { enabled: true, modules: ['events', 'homework'] };
    AR.Store.save(true);
    return { courses: (S.courses || []).length };
  })()`);
  ok('T0 夹具就绪', fixture && fixture.courses > 0, 'courses=' + (fixture && fixture.courses));

  const mig = await J(`(function(){
    var S = AR.Store.get();
    S.events.push({ id: 'vt-legacy-exam', title: '旧考试', type: 'exam', date: AR.Util.dateKey(new Date()),
      start: '09:00', end: '10:00', place: '', note: '', updatedAt: new Date().toISOString() });
    S.countdowns = [{ id: 'vt-cd-1', title: '旧四级', date: AR.Util.dateKey(new Date()) }];
    delete S.meta.customTabDefaultOn;
    S.settings.experimental.customTab.enabled = false;
    AR.Store.migrate(S);
    AR.Store.save(true);
    var ev1 = null, cd = null;
    for (var i = 0; i < S.events.length; i++) {
      if (S.events[i].id === 'vt-legacy-exam') { ev1 = S.events[i]; }
      if (S.events[i].title === '旧四级') { cd = S.events[i]; }
    }
    return {
      evStar: ev1 ? ev1.star : null, evShow: ev1 ? ev1.showOnTimetable : null, evArch: ev1 ? ev1.archived : null,
      cdMigrated: !!cd, cdStar: cd ? cd.star : null, cdShow: cd ? cd.showOnTimetable : null,
      oldKept: (S.countdowns || []).length === 1,
      tabOn: S.settings.experimental.customTab.enabled === true
    };
  })()`);
  ok('T1 迁移：老事件补字段 + 倒计时并入日程 + 「我的」默认开启（一次性）',
    mig.evStar === true && mig.evShow === true && mig.evArch === false && mig.cdMigrated === true
    && mig.cdStar === true && mig.cdShow === false && mig.oldKept === true && mig.tabOn === true,
    JSON.stringify(mig));

  // ── B 统一表单 ───────────────────────────────────────────
  const form1 = await J(`(function(){
    AR.UI.openEventForm({ date: AR.Util.dateKey(new Date()), star: false, showOn: false });
    var body = document.querySelector('.modal-body');
    return {
      open: AR.UI.modalOpen(),
      hasTitle: !!body.querySelector('#evTitle'), hasStar: !!body.querySelector('#evStar'),
      hasShow: !!body.querySelector('#evShow'), chips: body.querySelectorAll('#evTypes .chip-btn').length
    };
  })()`);
  ok('T2 统一「添加日程」表单（含类型 chips）',
    form1.open === true && form1.hasTitle && form1.hasStar && form1.hasShow && form1.chips >= 4, JSON.stringify(form1));

  const saveStar = await J(`(function(){
    var body = document.querySelector('.modal-body');
    body.querySelector('#evTitle').value = '星标条目测试';
    body.querySelector('#evDate').value = AR.Util.dateKey(new Date());
    body.querySelector('#evStart').value = '09:00';
    body.querySelector('#evStar').checked = true;
    var btns = document.querySelectorAll('.modal-actions .btn');
    for (var i = 0; i < btns.length; i++) { if (btns[i].textContent === '保存') { btns[i].click(); break; } }
    var found = null, S = AR.Store.get();
    for (var k = 0; k < S.events.length; k++) { if (S.events[k].title === '星标条目测试') { found = S.events[k]; } }
    return { created: !!found, star: found ? found.star : null, showOn: found ? found.showOnTimetable : null };
  })()`);
  ok('T3 保存生效：星标入账 + 默认不上周表',
    saveStar.created === true && saveStar.star === true && saveStar.showOn === false, JSON.stringify(saveStar));

  // ── C/E 一张卡：星标段 + 时间线 + 无一键星标 ─────────────
  const cards = await J(`(function(){
    var S = AR.Store.get();
    S.events.push({ id: 'vt-plain', title: '普通条目', type: 'lecture', date: AR.Util.dateKey(new Date()),
      start: '', end: '', place: '', note: '', star: false, showOnTimetable: false, archived: false, updatedAt: new Date().toISOString() });
    AR.Store.save(true);
    AR.UI.customTabCfg().modules = ['events'];
    AR.Store.save(true);
    AR.UI.renderCustom();
    var list = document.querySelectorAll('#customModules > .hw-card');
    var heads = [];
    for (var i = 0; i < list.length; i++) {
      var t = list[i].querySelector('.hw-t');
      heads.push(t ? t.textContent : '?');
    }
    var host = document.getElementById('customModules');
    var starBtnN = 0;
    var allRows = host.querySelectorAll('.cm-line');
    for (var r = 0; r < allRows.length; r++) {
      var bs = allRows[r].querySelectorAll('button');
      for (var b = 0; b < bs.length; b++) { if (bs[b].textContent.indexOf('★') >= 0) { starBtnN++; } }
    }
    var txt = host.textContent;
    return {
      heads: heads.join(','), modules: list.length, starBtnN: starBtnN,
      hasStarGroups: txt.indexOf('★ 星标日程') >= 0,
      hasStarRow: txt.indexOf('星标条目测试') >= 0,
      hasTime: txt.indexOf('09:00') >= 0,
      hasPlain: txt.indexOf('普通条目') >= 0,
      hasSwipeHint: host.querySelectorAll('.cm-swipe-hint').length > 0
    };
  })()`);
  ok('T4 日程一张卡：星标段置顶（日期+时间）+ 时间线，且行内没有一键星标按钮',
    cards.heads === '日程' && cards.modules === 1 && cards.starBtnN === 0
    && cards.hasStarGroups === true && cards.hasStarRow === true && cards.hasTime === true
    && cards.hasPlain === true && cards.hasSwipeHint === true,
    JSON.stringify(cards));

  // ── E 普通日程：长按 → 归档（带确认）→ 进「已归档」→ 找回 ──
  await J(`(function(){
    var rows = document.querySelectorAll('#customModules .cm-line');
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].textContent.indexOf('普通条目') >= 0) {
        rows[i].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10 }));
      }
    }
    return 'ok';
  })()`);
  await sleep(600);
  const menu = await J(`(function(){
    var btns = document.querySelectorAll('.modal-actions .btn');
    var labels = [], hit = null;
    for (var i = 0; i < btns.length; i++) {
      labels.push(btns[i].textContent);
      if (btns[i].textContent === '归档') { hit = btns[i]; }
    }
    if (hit) { hit.click(); }
    return { labels: labels.join(',') };
  })()`);
  await sleep(250);
  const archOk = await J(`(function(){
    var btns = document.querySelectorAll('.modal-actions .btn');
    var c = null, labels = [];
    for (var i = 0; i < btns.length; i++) {
      labels.push(btns[i].textContent);
      if (btns[i].textContent === '确认归档') { c = btns[i]; }
    }
    if (!c) { return { labels: labels.join(','), err: 'no confirm' }; }
    c.click();
    var S = AR.Store.get(), ev = null;
    for (var k = 0; k < S.events.length; k++) { if (S.events[k].id === 'vt-plain') { ev = S.events[k]; } }
    return { labels: labels.join(','), archived: ev ? ev.archived : null };
  })()`);
  ok('T5 长按菜单可归档 + 二次确认（确认后 archived=true）',
    menu.labels.indexOf('归档') >= 0 && archOk.archived === true, JSON.stringify({ menu: menu.labels, arch: archOk }));

  const archView = await J(`(function(){
    AR.UI.renderCustom();
    // 「已归档」是折叠段：按分组判断条目到底落在哪一段（不能只看 textContent）
    var wraps = document.querySelectorAll('#customModules .cm-group');
    var inArch = false, inNormal = false;
    for (var i = 0; i < wraps.length; i++) {
      if ((wraps[i].textContent || '').indexOf('普通条目') < 0) { continue; }
      var prev = wraps[i].previousElementSibling;
      var isArch = prev && (prev.textContent || '').indexOf('已归档') >= 0;
      if (isArch) { inArch = true; } else { inNormal = true; }
    }
    var txt = document.getElementById('customModules').textContent;
    return { inArchived: inArch, inNormal: inNormal, hasArchGroup: txt.indexOf('已归档') >= 0 };
  })()`);
  const archBack = await J(`(function(){
    var heads = document.querySelectorAll('#customModules .cm-group-head');
    for (var i = 0; i < heads.length; i++) { if (heads[i].textContent.indexOf('已归档') >= 0) { heads[i].click(); break; } }
    return 'ok';
  })()`);
  await sleep(200);
  const archBack2 = await J(`(function(){
    var btns = document.querySelectorAll('#customModules .cm-arch-back');
    if (!btns.length) { return { err: 'no back btn' }; }
    btns[0].click();
    var S = AR.Store.get(), ev = null;
    for (var k = 0; k < S.events.length; k++) { if (S.events[k].id === 'vt-plain') { ev = S.events[k]; } }
    return { archived: ev ? ev.archived : null };
  })()`);
  ok('T6 归档后从时间线移走（进「已归档」段）、可找回',
    archView.inArchived === true && archView.inNormal === false && archView.hasArchGroup === true
    && archBack2.archived === false,
    JSON.stringify({ v: archView, back: archBack2 }));

  // ── 星标删除：长按确认 ───────────────────────────────────
  await J(`(function(){
    var rows = document.querySelectorAll('#customModules .cm-line');
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].textContent.indexOf('星标条目测试') >= 0) {
        rows[i].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10 }));
      }
    }
    return 'ok';
  })()`);
  await sleep(600);
  const starDel = await J(`(function(){
    var btns = document.querySelectorAll('.modal-actions .btn');
    var del = null;
    for (var i = 0; i < btns.length; i++) { if (btns[i].textContent === '删除') { del = btns[i]; } }
    if (!del) { return { err: 'no delete' }; }
    del.click();
    return 'ok';
  })()`);
  await sleep(250);
  const starDel2 = await J(`(function(){
    var hold = document.getElementById('dangerHold');
    var btns = document.querySelectorAll('.modal-actions .btn');
    var labels = [];
    for (var i = 0; i < btns.length; i++) { labels.push(btns[i].textContent); }
    return { holdBtn: !!hold, holdLabel: hold ? hold.textContent.slice(0, 14) : '', actions: labels.join(',') };
  })()`);
  ok('T7 星标日程删除 = 长按确认（出现「按住 2 秒确认」按钮）',
    starDel2.holdBtn === true && starDel2.holdLabel.indexOf('按住') >= 0, JSON.stringify(starDel2));
  await J(`AR.UI.closeModal();'ok'`);

  // ── F 周表：按时间画块 + 归档不画 ────────────────────────
  const wt = await J(`(function(){
    var S = AR.Store.get();
    var d = AR.Util.addDays(AR.Util.mondayOf(new Date()), 1);
    S.events.push({ id: 'vt-wt-on', title: '周表显示条目', type: 'exam', date: AR.Util.dateKey(d),
      start: '21:00', end: '22:00', place: '一教', note: '', star: true, showOnTimetable: true, archived: false, updatedAt: new Date().toISOString() });
    S.events.push({ id: 'vt-wt-arch', title: '归档不该上表', type: 'exam', date: AR.Util.dateKey(d),
      start: '21:00', end: '22:00', place: '', note: '', star: false, showOnTimetable: true, archived: true, updatedAt: new Date().toISOString() });
    AR.Store.save(true);
    AR.UI.show('week');
    var texts = [];
    var blocks = document.querySelectorAll('#weekGridWrap .wt-evblock');
    for (var i = 0; i < blocks.length; i++) { texts.push(blocks[i].textContent.slice(0, 10)); }
    return { texts: texts.join('|'), starN: document.querySelectorAll('#weekGridWrap .wt-evblock.star').length };
  })()`);
  ok('T8 周表按时间画日程块；归档的不上周表；星标金描边',
    wt.texts.indexOf('周表显示条目') >= 0 && wt.texts.indexOf('归档不该上表') < 0 && wt.starN >= 1,
    JSON.stringify(wt));

  // ── G 设置 B′ ────────────────────────────────────────────
  const g1 = await J(`(function(){
    AR.UI.show('settings');
    var cats = document.querySelectorAll('#settingsGrid .set-cat');
    var ids = [];
    for (var i = 0; i < cats.length; i++) { ids.push(cats[i].id); }
    var qItems = document.querySelectorAll('#settingsGrid .q-item').length;
    var goPill = document.querySelector('#settingsGrid .set-cat-go');
    var goStyle = goPill ? getComputedStyle(goPill) : null;
    return {
      cats: ids.join(','), qItems: qItems,
      navGone: document.querySelectorAll('#settingsNav, .settings-nav').length === 0,
      hasSearch: !!document.getElementById('setSearch'),
      goIsPill: !!goPill && goStyle.borderRadius !== '0px' && goStyle.backgroundColor !== 'rgba(0, 0, 0, 0)',
      hasWidgetsQuick: (function(){
        var c = document.getElementById('set-widgets');
        return c ? c.querySelectorAll('.q-item').length : -1;
      })(),
      hasCourseQuick: (function(){
        var c = document.getElementById('set-course');
        return c ? c.querySelectorAll('.q-item').length : -1;
      })()
    };
  })()`);
  ok('T9 设置首页 = 7 个分类行（左栏已去掉，「进入」是胶囊，「桌面卡片/课程与课表」无行内高频项）',
    g1.cats === 'set-prefs,set-widgets,set-course,set-work,set-mine,set-syncdata,set-about'
    && g1.navGone === true && g1.hasSearch === true && g1.qItems >= 8 && g1.goIsPill === true
    && g1.hasWidgetsQuick === 0 && g1.hasCourseQuick === 0,
    JSON.stringify(g1));

  const g1b = await J(`(function(){
    var row = document.querySelector('#settingsGrid .set-cat[data-key="course"] .set-cat-head');
    if (!row) { return { err: 'no course row' }; }
    row.click();
    var detail = document.getElementById('set-course');
    var txt = detail ? detail.textContent : '';
    return { hasNotify: txt.indexOf('课前提醒') >= 0, back: !!document.getElementById('setBackBtn') };
  })()`);
  ok('T9b 提醒与通知已归到「课程与课表」二级页',
    g1b.hasNotify === true && g1b.back === true, JSON.stringify(g1b));

  const g2 = await J(`(function(){
    // 搜索框在首页：先返回（T9b 进过二级页）
    var back = document.getElementById('setBackBtn');
    if (back) { back.click(); }
    var input = document.getElementById('setSearch');
    if (!input) { return { err: 'no search' }; }
    input.value = '备份';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    var hits = document.querySelectorAll('#settingsGrid .set-hit');
    var labels = [];
    for (var i = 0; i < hits.length; i++) { labels.push(hits[i].textContent.replace(/\\s+/g, ' ').slice(0, 22)); }
    return { n: hits.length, labels: labels.slice(0, 3).join(' / ') };
  })()`);
  const g3 = await J(`(function(){
    var hit = document.querySelector('#settingsGrid .set-hit');
    if (!hit) { return { err: 'no hit' }; }
    hit.click();
    var detail = document.querySelector('#settingsGrid .set-detail');
    var back = document.getElementById('setBackBtn');
    var tabs = document.querySelectorAll('#settingsGrid .set-tabs .seg').length;
    return { opened: !!detail, back: !!back, tabs: tabs };
  })()`);
  ok('T10 搜索出「分类 · 项目」命中清单，点一条直接进二级页（数据类有页内标签）',
    g2.n >= 1 && g3.opened === true && g3.back === true && g3.tabs === 3,
    JSON.stringify({ hits: g2, open: g3 }));

  const g4 = await J(`(function(){
    // 先回首页，再点「我的页面」分类行
    if (document.getElementById('setBackBtn')) { document.getElementById('setBackBtn').click(); }
    var row = document.querySelector('#settingsGrid .set-cat[data-key="mine"] .set-cat-head');
    if (!row) { return { err: 'no mine row' }; }
    row.click();
    var detail = document.getElementById('set-mine');
    var txt = detail ? detail.textContent : '(none)';
    var hasSwitch = detail ? !!detail.querySelector('.setting-row input') : false;
    var back = document.getElementById('setBackBtn');
    if (back) { back.click(); }
    var home = document.querySelectorAll('#settingsGrid .set-cat').length;
    return { hasSwitch: hasSwitch, hasCompose: txt.indexOf('模块组成') >= 0, homeAfterBack: home };
  })()`);
  ok('T11 「我的页面」二级页：开关 + 模块组成；返回条回首页',
    g4.hasSwitch === true && g4.hasCompose === true && g4.homeAfterBack === 7, JSON.stringify(g4));

  // ── H 副标题 + 长期任务回归 + 危险确认组件 ───────────────
  const misc = await J(`(function(){
    var sub = document.querySelector('#view-custom .view-sub');
    return { sub: sub ? sub.textContent : '', confirmDanger: typeof AR.UI.confirmDanger === 'function' };
  })()`);
  ok('T12 「我的」副标题 = 自由添加你的模块；confirmDanger 已导出',
    misc.sub === '自由添加你的模块' && misc.confirmDanger === true, JSON.stringify(misc));

  const lt = await J(`(function(){
    var t = AR.Store.longTaskUpsert({ name: '复验·志愿时长', unit: '小时', target: 20, showInToday: true });
    t.entries = []; AR.Store.save(true);
    AR.UI.openLongTaskEntry(AR.Store.longTaskById(t.id));
    return { id: t.id };
  })()`);
  await sleep(300);
  const lt2 = await J(`(function(){
    var btns = document.querySelectorAll('#ltQuick button');
    for (var i = 0; i < btns.length; i++) { if (btns[i].textContent === '+1') { btns[i].click(); } }
    document.getElementById('ltAmount').value = '2';
    var rows = document.querySelectorAll('#ltRecent .lt-del');
    if (rows.length) { rows[0].click(); }
    var t = AR.Store.longTaskById(${JSON.stringify('')});
    return { input: document.getElementById('ltAmount').value, ae: (document.activeElement || {}).tagName };
  })()`);
  ok('T13 回归：长期任务手输不丢 + 不弹输入法', lt2.input === '2' && lt2.ae !== 'INPUT', JSON.stringify(lt2));
  await J(`AR.UI.closeModal();'ok'`);

  // ── 设置：返回一层 / 图标统一 / 二级页入场动画 ──────────
  const nav = await J(`(function(){
    AR.UI.show('settings');
    var icon = document.querySelector('#settingsGrid .set-cat[data-key="widgets"] .set-cat-ico');
    var row = document.querySelector('#settingsGrid .set-cat[data-key="prefs"] .set-cat-head');
    row.click();
    // 二级页刚渲染完，统一入场动画应该在跑
    var secs = document.querySelectorAll('#settingsGrid .set-section');
    var animN = 0;
    for (var i = 0; i < secs.length; i++) {
      if (secs[i].getAnimations) { animN += secs[i].getAnimations().length; }
    }
    return { icon: icon ? icon.textContent : '', detail: !!document.getElementById('setBackBtn'), animN: animN };
  })()`);
  const back1 = await J(`(function(){
    AR.onBack();      // 返回键 / 侧滑
    return {
      view: AR.UI.currentView(),
      home: document.querySelectorAll('#settingsGrid .set-cat').length,
      detail: !!document.getElementById('setBackBtn')
    };
  })()`);
  const back2 = await J(`(function(){
    AR.onBack();      // 首页再返回 → 才回今日页
    return { view: AR.UI.currentView() };
  })()`);
  ok('T15 二级页返回（含侧滑/返回键）先回设置首页，再返才回今日页',
    nav.detail === true && back1.view === 'settings' && back1.home === 7 && back1.detail === false
    && back2.view === 'today',
    JSON.stringify({ nav: nav, back1: back1, back2: back2 }));
  ok('T16 「桌面卡片」图标与其它分类统一（emoji，不是 ▦ 字符）',
    nav.icon === '📱' && nav.icon !== '▦', 'icon=' + nav.icon);
  ok('T17 从设置首页进二级页有统一入场动画（viewIn）',
    nav.animN > 0, 'animations=' + nav.animN);

  // ── 清理 ─────────────────────────────────────────────────
  await J(`(function(){
    var S = AR.Store.get();
    S.events = (S.events || []).filter(function (e) { return String(e.id).indexOf('vt-') !== 0; })
      .filter(function (e) { return ['旧考试','旧四级','星标条目测试','普通条目','周表显示条目','归档不该上表'].indexOf(e.title) < 0; });
    S.countdowns = [];
    if (S.settings.experimental && S.settings.experimental.customTab) {
      S.settings.experimental.customTab.enabled = true;
      S.settings.experimental.customTab.modules = ['homework', 'longterm', 'hwstats', 'weekgrid'];
    }
    AR.Store.save(true);
    return 'clean';
  })()`);
  ok('T14 收尾清理', true, '');

  console.log('');
  console.log(`RESULT: PASS=${pass} FAIL=${fail}`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('DRIVER-ERROR', e); process.exit(2); });
