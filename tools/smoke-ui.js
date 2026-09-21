/**
 * Abbey Road · 界面冒烟测试（v0.2.0）
 *
 * 通过 CDP 驱动**正在运行的 App**，在真实 DOM 上验证：
 *   ① 周表左栏显示「几点到几点」
 *   ② 周表点课程块 → 打开可编辑全部字段的编辑器
 *   ③ 编辑保存后数据与界面都更新（星期 / 节次 / 单双周 / 老师 / 地点 / 颜色）
 *   ④ 今日页「最近的课」的每个模块都能点，且都能进编辑器
 *   ⑤ 弹窗关闭后遮罩真的消失（不会留一层透明遮罩挡住点击）
 *   ⑥ 配置文件：粘贴自动解析、导出到微信、导入自己的导出不会重复添加（v0.2.1）
 *   ⑦ 默认作息是新的「8:00-8:45 / 8:50-9:35 … 20:30-22:00」
 *   ⑧ v0.2.2：第 13 节自动扩表、复制提示词后跳到课表文本、从导出目录导入、
 *      清空数据必须按住 3 秒（提前松手不会清）
 *
 * 用法：
 *   Windows 调试版：  $env:ABBEYROAD_DEBUG='1'; 启动 exe；$env:CDP_PORT='9223'; node tools/smoke-ui.js
 *   Android 模拟器：  powershell -File tools/adb-cdp.ps1；node tools/smoke-ui.js
 *
 * 测试用的临时课程会在结束时删掉，localStorage 也会还原成测试前的样子。
 */

const port = process.env.CDP_PORT || '9222';

const script = String.raw`(async () => {
  const report = { version: '', checks: [], fatal: null };
  const check = (name, ok, extra) => report.checks.push({ name: name, ok: !!ok, extra: extra === undefined ? '' : String(extra) });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (s) => document.querySelector(s);
  const byText = (nodes, text) => Array.prototype.filter.call(nodes, (n) => (n.textContent || '').trim() === text);
  const key = AR.Const.STORAGE_KEY;
  const backup = localStorage.getItem(key);

  try {
    report.version = AR.Const.APP_VERSION;
    const sem = AR.Store.currentSemester();
    const semMonday = AR.Util.mondayOf(AR.Util.parseDateKey(sem.startDate));
    report.coursesBefore = AR.Store.get().courses.length;
    report.blocksBefore = AR.Store.get().blocks.length;

    /* 先找一个「没课的空档」当测试位：真机上本来就有课，
       随便挑周一 1-2 会和学生自己的课撞格子（周表里一格只画一门课），
       那样测试会误判。周日→周六、靠后的节次优先。 */
    function freeSlots() {
      const periods = AR.Store.periodsOf(sem.id);
      const out = [];
      const order = [7, 6, 5, 4, 3, 2, 1];
      for (let di = 0; di < order.length; di++) {
        const wd = order[di];
        const busy = [];
        [0, 1].forEach((wk) => {
          AR.Schedule.dayItems(AR.Util.addDays(semMonday, wk * 7 + wd - 1)).forEach((i) => {
            busy.push([i.startMin, i.endMin]);
          });
        });
        for (let pi = periods.length - 2; pi >= 0; pi--) {
          const a = periods[pi], b = periods[pi + 1];
          const s = AR.Util.hmToMinutes(a.start), e = AR.Util.hmToMinutes(b.end);
          const clash = busy.some((seg) => seg[0] < e && s < seg[1]);
          if (!clash) { out.push({ wd: wd, p1: a.index, p2: b.index }); }
        }
      }
      return out;
    }
    const slots = freeSlots();
    const slotA = slots[0] || { wd: 6, p1: 1, p2: 2 };
    const slotB = slots.filter((s) => s.wd !== slotA.wd)[0] || { wd: slotA.wd === 6 ? 7 : 6, p1: slotA.p1, p2: slotA.p2 };

    /* 造一门临时课（放在空档里），结束时删掉 */
    const txt = [
      'AbbeyRoad 课表 v1',
      '开学日期：' + sem.startDate,
      '冒烟测试课｜' + AR.Util.WEEKDAY_NAMES[slotA.wd] + '｜' + slotA.p1 + '-' + slotA.p2 + '｜1-16｜冒烟楼101｜测试老师｜｜蓝'
    ].join('\n');
    const parsed = AR.MdParse.parse(txt, {
      weekCount: sem.weekCount,
      semester: { name: sem.name, startDate: sem.startDate, weekCount: sem.weekCount }
    });
    const ent = AR.MdParse.toEntities(parsed, AR.Store.get(), { mergeMode: 'never' });
    AR.MdParse.applyEntities(ent, AR.Store.get());
    const tempCourse = AR.Store.get().courses.filter((c) => c.name === '冒烟测试课')[0];
    check('临时课程已建立', !!tempCourse);
    // 留一份「清空前导出的配置」，最后用来验证「清空后再导入」
    const configSnapshot = AR.ConfigIO.payloadText();
    let tempBlock = tempCourse ? AR.Store.get().blocks.filter((b) => b.courseId === tempCourse.id)[0] : null;
    check('临时时段已建立', !!tempBlock);

    /* ── ① 周表左栏：几点到几点 ─────────────────────────── */
    AR.UI.show('week');
    await sleep(120);
    const times = document.querySelectorAll('#weekGridWrap .wt-time');
    check('周表左栏有时间列', times.length > 0, times.length);
    if (times.length) {
      const t = times[0].querySelectorAll('.t');
      const periods = AR.Store.periodsOf(sem.id);
      const first = periods[0];
      check('周表左栏第一行是开始时间', t[0] && t[0].textContent.trim() === first.start, t[0] && t[0].textContent.trim());
      check('周表左栏第二行是结束时间', t[1] && t[1].textContent.trim() === first.end, t[1] && t[1].textContent.trim());
      check('周表左栏节次号还在（小角标）', !!times[0].querySelector('.p'));
    }

    /* ── ② 周表点课程块 → 编辑器 ─────────────────────────── */
    // 回到第 1 周（临时课在第 1 周），再按课程名找方块 —— 真机上本来就有别的课，
    // 不能拿「第一个方块」当目标。
    const chip1 = byText(document.querySelectorAll('#weekStrip .week-chip'), '1')[0];
    if (chip1) { chip1.click(); await sleep(220); }
    function findBlock(name) {
      const list = document.querySelectorAll('#weekGridWrap .wt-block');
      for (let i = 0; i < list.length; i++) {
        if (list[i].textContent.indexOf(name) >= 0) { return list[i]; }
      }
      return null;
    }
    check('周表里能看到课程块', document.querySelectorAll('#weekGridWrap .wt-block').length > 0);
    const tempBlockEl = findBlock('冒烟测试课');
    check('能在周表里按名字找到冒烟测试课', !!tempBlockEl);
    if (!tempBlockEl) { throw new Error('周表里找不到冒烟测试课方块'); }
    tempBlockEl.click();
    await sleep(260);
    const card = $('#modalCard');
    check('点课程块打开了编辑器', !!card.querySelector('#ebName'));
    check('编辑器打开的是被点的这门课', card.querySelector('#ebName').value === '冒烟测试课',
      card.querySelector('#ebName').value);
    check('编辑器是宽弹窗', card.classList.contains('modal-wide'));
    ['#ebTeachers', '#ebPlace', '#ebWeekday', '#ebPStart', '#ebPEnd', '#ebStart', '#ebEnd', '#ebWeekMode', '#ebWeeks', '#ebNote', '#ebColors']
      .forEach((sel) => check('编辑器有字段 ' + sel, !!card.querySelector(sel)));

    /* ── ③ 改字段并保存 ──────────────────────────────────── */
    card.querySelector('#ebName').value = '冒烟测试课';
    card.querySelector('#ebTeachers').value = '测试老师、第二位老师';
    card.querySelector('#ebPlace').value = '冒烟楼 202';
    card.querySelector('#ebWeekday').value = String(slotB.wd);
    card.querySelector('#ebPStart').value = String(slotB.p1);
    card.querySelector('#ebPEnd').value = String(slotB.p2);
    card.querySelector('#ebWeekMode').value = 'even';
    card.querySelector('#ebWeeks').value = '';
    card.querySelector('#ebNote').value = '冒烟测试备注';
    const saveBtn = byText(card.querySelectorAll('.modal-actions .btn'), '保存')[0];
    saveBtn.click();
    await sleep(320);
    tempBlock = AR.Store.blockById(tempBlock.id) || tempBlock;
    check('保存后星期改了', tempBlock.weekday === slotB.wd, tempBlock.weekday + ' 期望 ' + slotB.wd);
    check('保存后节次改了', tempBlock.periodStart === slotB.p1 && tempBlock.periodEnd === slotB.p2,
      tempBlock.periodStart + '-' + tempBlock.periodEnd);
    check('保存后周次改成双周', tempBlock.weekMode === 'even', tempBlock.weekMode);
    check('保存后地点写入', !!(tempBlock.locationIds && tempBlock.locationIds.length));
    check('保存后老师两条', (tempBlock.teacherIds || []).length === 2, (tempBlock.teacherIds || []).length);
    check('保存后备注写入', tempBlock.note === '冒烟测试备注', tempBlock.note);
    check('保存后弹窗彻底关闭（遮罩不残留）', $('#modalRoot').hidden === true);
    const oldDayItems = AR.Schedule.dayItems(AR.Util.addDays(semMonday, slotA.wd - 1))
      .filter((i) => i.course.name === '冒烟测试课');
    // 改成了「双周 + 目标星期」：第 1 周是单周不该有课，第 2 周那天才应该有
    const newDayItems = AR.Schedule.dayItems(AR.Util.addDays(semMonday, 7 + slotB.wd - 1))
      .filter((i) => i.course.name === '冒烟测试课');
    check('保存后原来的星期没有这门课了', oldDayItems.length === 0, oldDayItems.length);
    check('保存后第 2 周目标日出现这门课（双周生效）', newDayItems.length === 1, newDayItems.length);
    check('保存后第 1 周目标日没有课（单周被排除）',
      AR.Schedule.dayItems(AR.Util.addDays(semMonday, slotB.wd - 1)).filter((i) => i.course.name === '冒烟测试课').length === 0);

    /* ── ④ 单次改动：编辑器顶部出现「仅这次 / 所有时段」──── */
    // 这门课现在是「双周 + 周三」→ 第 1 周没有，切到第 2 周才看得到
    const chip2 = byText(document.querySelectorAll('#weekStrip .week-chip'), '2')[0];
    if (chip2) { chip2.click(); await sleep(220); }
    const shownMonday = AR.Util.addDays(semMonday, 7);
    const shownTarget = AR.Util.addDays(shownMonday, slotB.wd - 1);
    AR.Store.upsertOverride(tempBlock.id, tempCourse.id, AR.Util.dateKey(shownTarget), {
      type: 'room', newLocationIds: [AR.Store.ensureLocationByRaw('冒烟楼 303').id]
    });
    AR.UI.renderWeek();
    await sleep(120);
    const tempBlockEl2 = findBlock('冒烟测试课');
    check('第 2 周能点到冒烟测试课的方块', !!tempBlockEl2);
    if (tempBlockEl2) { tempBlockEl2.click(); }
    await sleep(260);
    const scope = $('#modalCard').querySelector('.scope-switch');
    check('单次改动后出现范围开关', !!scope);
    const scopeBtns = scope ? scope.querySelectorAll('.scope-btn') : [];
    check('默认选中「仅这次」', scopeBtns[0] && scopeBtns[0].classList.contains('active'));
    const cancelBtn = byText($('#modalCard').querySelectorAll('.modal-actions .btn'), '取消')[0];
    cancelBtn.click();
    await sleep(300);
    check('取消后弹窗彻底关闭', $('#modalRoot').hidden === true);

    /* ── ⑤ 今日页「最近的课」：焦点卡 + 信息格 + 编辑入口 ────── */
    AR.UI.show('today');
    AR.UI.setExpanded('next');        // 先展开这一栏，模块才可点（收起时点一下是"展开"）
    await sleep(460);
    check('最近的课有焦点卡（课程 + 时间）', !!document.querySelector('#zoneNext .next-hero .nh-title'));
    check('焦点卡里的倒计时元素还在', !!document.getElementById('nextCountdown'));
    const moduleKeys = Array.prototype.map.call(document.querySelectorAll('#zoneNext .info-grid .info-cell .ic-k'),
      (n) => n.textContent.trim());
    check('最近的课有 6 个信息格', moduleKeys.length === 6, moduleKeys.join('/'));
    check('信息格里有位置 / 节次 / 时间 / 老师 / 周次 / 备注',
      ['位置', '节次', '时间', '老师', '周次', '备注'].every((k) => moduleKeys.indexOf(k) >= 0), moduleKeys.join('/'));
    const mods = document.querySelectorAll('#zoneNext .info-grid .info-cell');
    if (mods.length) {
      mods[1].click();                       // 节次模块
      await sleep(260);
      check('节次模块能打开编辑器', !!$('#modalCard').querySelector('#ebPStart'));
      byText($('#modalCard').querySelectorAll('.modal-actions .btn'), '取消')[0].click();
      await sleep(300);
    }
    check('今日页收起时三栏都在', !!(document.getElementById('zoneWeek') && document.getElementById('zoneToday') && document.getElementById('zoneNext')));
    check('三栏布局默认左右（左中右已移除）',
      ['dual-horizontal', 'stacked-vertical'].indexOf(AR.UI.layoutState.preset) >= 0, AR.UI.layoutState.preset);

    /**
     * 左手模式：开一下，「最近的课」应该换到左边，关掉要能原样还原。
     * 直接读布局算出来的目标矩形（Layout.rects），不受正在播放的补间影响。
     */
    {
      const rects = () => (AR.UI.layoutState.rects) || {};
      const s = AR.Store.get();
      const setHand = (v) => {
        s.settings.layout.leftHand = v;
        AR.Store.save(true);
        AR.UI.applyLayout(false);
        return { week: (rects().week || {}).x, next: (rects().next || {}).x };
      };
      // 先归零再测：不管上一次跑测试时留下的是什么状态，结果都可复现
      const before = setHand(false);
      const mirrored = setHand(true);
      const restored = setHand(false);
      /**
       * 判据只取"两侧对调 + 可还原"：
       * 两栏宽度并不相同（本周概览那栏宽得多），镜像后 x 不是简单的互换，
       * 所以只比"谁在左、谁在右"，以及关掉开关后能不能原样回到默认。
       */
      check('左手模式把「最近的课」换到左侧（关闭后能还原）',
        typeof before.week === 'number' && before.week < before.next
        && mirrored.next < mirrored.week
        && restored.week === before.week && restored.next === before.next,
        'week x ' + before.week + '→' + mirrored.week + '→' + restored.week
        + ' · next x ' + before.next + '→' + mirrored.next + '→' + restored.next);
    }

    /* 「本周概览」折叠态：缩略图只画周一到周五，且**不可滑动** */
    AR.UI.setExpanded(null);
    await sleep(260);
    {
      const mini = document.querySelector('#weekBody .mini-table');
      const heads = mini ? mini.querySelectorAll('.mg-day') : [];
      const cols = mini ? (mini.style.gridTemplateColumns || '').split(' ').length : 0;
      check('缩略图只画周一到周五（5 列 + 时间列）', !!mini && heads.length === 5 && cols === 6,
        mini ? ('天=' + heads.length + ' 列=' + cols + ' 模板=' + mini.style.gridTemplateColumns) : '无 .mini-table');
      check('缩略图不横向滚动', !!mini && mini.scrollWidth <= mini.clientWidth + 2,
        mini ? (mini.scrollWidth + ' / ' + mini.clientWidth) : '无');
      const weekendHint = /周末 \d+ 节/.test(document.querySelector('#weekBody .mini-foot')?.textContent || '');
      const weekendCount = [6, 7].reduce((n, wd) =>
        n + AR.Schedule.weekItems(AR.Schedule.weekNumber(new Date(), AR.Store.currentSemester()), wd).length, 0);
      check('周末有课时缩略图会提示（不丢信息）', weekendCount === 0 || weekendHint,
        'weekend=' + weekendCount + ' hint=' + weekendHint);
    }

    /* 「本周概览」展开态：这才是可以左右滑动的地方，点课程块只出只读详情 */
    AR.UI.setExpanded('week');
    await sleep(420);
    {
      const sc = document.querySelector('#weekBody .wt-scroll');
      const rail = sc ? sc.querySelector('.week-table') : null;
      const timeCell = rail ? rail.querySelector('.wt-time') : null;
      check('本周概览展开态放在横向滚动容器里', !!sc && !!rail,
        sc ? 'ok' : '无 .wt-scroll');
      if (sc && rail && timeCell) {
        const maxScroll = sc.scrollWidth - sc.clientWidth;
        if (maxScroll > 0) {
          sc.scrollLeft = maxScroll;
          const stuck = Math.abs(timeCell.getBoundingClientRect().left - sc.getBoundingClientRect().left) < 6;
          sc.scrollLeft = 0;
          check('展开态时间列横滑时吸在左侧', stuck, 'stuck=' + stuck);
        } else {
          check('展开态时间列横滑时吸在左侧', true, '当前宽度放得下整周，无需滚动');
        }
        const block = rail.querySelector('.wt-block');
        if (block) {
          block.click();
          await sleep(260);
          const btns = Array.prototype.map.call(
            $('#modalCard').querySelectorAll('.modal-actions .btn'), (b) => b.textContent.trim());
          check('展开态点课程块只弹只读详情（没有编辑按钮）',
            btns.length === 1 && btns[0] === '关闭', btns.join('/'));
          byText($('#modalCard').querySelectorAll('.modal-actions .btn'), '关闭')[0]?.click();
          await sleep(300);
        }
      }
    }
    AR.UI.setExpanded(null);
    await sleep(260);

    /* 展开今日栏：长条卡片 + 编辑全部信息 */
    AR.UI.setExpanded('today');
    await sleep(420);
    const editChips = document.querySelectorAll('#todayBody .zone-tools [data-act="edit"]');
    const dayCards = document.querySelectorAll('#todayBody .info-grid .info-cell');
    const todayHasItems = AR.Schedule.dayItems(AR.Util.startOfDay(new Date())).length > 0;
    if (todayHasItems) {
      check('展开今日栏后有「编辑全部信息」', editChips.length > 0 || dayCards.length > 0,
        'chips=' + editChips.length + ' modules=' + dayCards.length);
    } else {
      check('今天没课：今日卡片检查跳过', true, '本地数据今天没有课');
    }
    // 「最近的课」展开态一定带编辑入口（和有没有今日课无关）
    AR.UI.setExpanded('next');
    await sleep(420);
    check('展开「最近的课」有编辑课程入口',
      document.querySelectorAll('#zoneNext .zone-tools [data-act="edit"]').length > 0);
    AR.UI.setExpanded(null);
    await sleep(200);

    /* ── ⑥ 配置文件：粘贴自动解析 / 导出到微信 / 不重复添加 ── */
    AR.UI.show('import');
    await sleep(300);
    const jsonTab = document.querySelector('[data-tab="json"]');
    if (jsonTab) { jsonTab.click(); }
    await sleep(300);
    check('配置文件页有「导出到微信」按钮', !!$('#btnExportWechat'));

    // 导出到微信：桥接层要真的被调用
    let shared = null;
    const origShareFile = AR.Bridge.shareFile;
    AR.Bridge.shareFile = function (fn, content, mime, title) {
      shared = { name: fn, len: (content || '').length, mime: mime, title: title };
      return Promise.resolve('stub');
    };
    if ($('#btnExportWechat')) { $('#btnExportWechat').click(); }
    await sleep(200);
    AR.Bridge.shareFile = origShareFile;
    check('点「导出到微信」会把配置交给桥接层', !!shared && shared.len > 1000, shared ? (shared.name + ' ' + shared.len) : 'none');
    check('导出文件名是 .json', !!shared && /\.json$/i.test(shared.name), shared && shared.name);

    // Windows 端原生桥曾经把参数丢光（导出的文件是 0 字节、复制是空串），这里守住它
    if (AR.Bridge.platform() === 'windows') {
      const echo = await AR.Bridge.call('shareFile',
        ['smoke-arg-check.json', '{"probe":1}', 'application/json', 'probe']);
      check('Windows 原生调用能收到参数（导出不会变成空文件）',
        typeof echo === 'string' && echo.indexOf('smoke-arg-check.json') >= 0, echo);
    }

    // 粘贴配置文本 → 自动解析出预览（不用先点按钮）
    const payload = AR.Store.exportPayload();
    payload.exportedAt = new Date().toISOString();
    const jsonText = JSON.stringify(payload);
    const jsonBox = $('#jsonInput');
    jsonBox.value = jsonText;
    const ev = document.createEvent('Event');
    ev.initEvent('input', true, true);
    jsonBox.dispatchEvent(ev);
    await sleep(900);
    const summaryText = ($('#jsonSummary').textContent || '').trim();
    check('粘贴配置文本会自动解析出预览', summaryText.indexOf('新增') >= 0, summaryText.slice(0, 60));
    check('解析后「合并导入」可用', $('#btnApplyJson').disabled === false);
    check('导入自己的导出不会重复添加（按内容合并）', /新增\s*0/.test(summaryText.replace(/\s+/g, ' ')) || summaryText.indexOf('新增 0') >= 0,
      summaryText.slice(0, 60));
    if ($('#jsonInput')) { $('#jsonInput').value = ''; }

    /* ── ⑦ 默认作息表 ─────────────────────────────────────── */
    const ps = AR.Store.periodsOf(sem.id);
    const expect = [['08:00', '08:45'], ['08:50', '09:35'], ['10:00', '10:45'], ['10:50', '11:35'],
      ['13:30', '14:15'], ['14:20', '15:05'], ['15:30', '16:15'], ['16:20', '17:05'],
      ['18:00', '18:45'], ['18:50', '19:35'], ['19:40', '20:25'], ['20:30', '22:00']];
    let periodBad = '';
    for (let i = 0; i < expect.length && i < ps.length; i++) {
      if (ps[i].start !== expect[i][0] || ps[i].end !== expect[i][1]) {
        periodBad += '第' + (i + 1) + '节 ' + ps[i].start + '-' + ps[i].end + '; ';
      }
    }
    check('默认作息表是新版（12 节）', ps.length === 12 && !periodBad, periodBad || ('共 ' + ps.length + ' 节'));
    check('第 2 节 8:50-9:35', ps[1] && ps[1].start === '08:50' && ps[1].end === '09:35', ps[1] ? ps[1].start + '-' + ps[1].end : '');
    check('第 5 节 13:30-14:15', ps[4] && ps[4].start === '13:30' && ps[4].end === '14:15', ps[4] ? ps[4].start + '-' + ps[4].end : '');
    check('第 12 节 20:30-22:00', ps[11] && ps[11].start === '20:30' && ps[11].end === '22:00', ps[11] ? ps[11].start + '-' + ps[11].end : '');

    /* ── ⑨ v0.2.4：配置文件页改版 / 学期切换 / 快捷操作 / 色盘 / 倒计时 / 开源地址 ── */

    // a) 配置文件页现在和「课表文本」同一套逻辑：粘贴自动解析 + 右下角浮动「合并导入」
    AR.UI.show('import');
    await sleep(300);
    jsonTab.click();
    await sleep(300);
    check('配置文件页有「选择 .json / .txt 文件」入口', !!$('#btnImportJson'));
    check('配置文件页有「清空」按钮', !!$('#btnClearJson'));
    const jsonFab = $('#btnApplyJson');
    check('配置文件页的悬浮「合并导入」按钮存在', !!jsonFab);
    if (jsonFab) {
      jsonFab.disabled = true;
      const sample = AR.ConfigIO.payloadText();
      $('#jsonInput').value = sample;
      const ev2 = document.createEvent('Event');
      ev2.initEvent('input', true, true);
      $('#jsonInput').dispatchEvent(ev2);
      await sleep(900);
      check('粘贴配置文本后「合并导入」自动可用', jsonFab.disabled === false);
      check('粘贴后显示预览', ($('#jsonSummary').textContent || '').indexOf('新增') >= 0);
      check('切到「课表文本」时配置文件页的悬浮按钮会收起',
        (function () { document.querySelector('[data-tab="md"]').click(); return jsonFab.hidden; })());
      jsonTab.click();
      await sleep(250);
      check('切回配置文件页时悬浮按钮重新出现', jsonFab.hidden === false);
      if ($('#btnClearJson')) { $('#btnClearJson').click(); }
      await sleep(200);
      check('「清空」会清掉粘贴区与预览',
        ($('#jsonInput').value === '' && ($('#jsonSummary').textContent || '') === ''));
    }

    // b) 周表可以切换学期
    AR.UI.show('week');
    await sleep(350);
    check('周表右上角有学期按钮', !!$('#weekSemBtn'));
    check('学期按钮显示当前学期名', ($('#weekSemBtn').textContent || '').indexOf(sem.name) >= 0,
      $('#weekSemBtn') ? $('#weekSemBtn').textContent : '');
    const semCountBefore = AR.Store.semesterList().length;
    AR.Store.addSemester({ name: '测试第二学期', startDate: '2027-02-22', weekCount: 18 });
    AR.UI.renderWeek();
    await sleep(300);
    $('#weekSemBtn').click();
    await sleep(400);
    const semRows = document.querySelectorAll('.export-row');
    check('学期弹窗列出全部学期', semRows.length >= semCountBefore + 1, semRows.length);
    // 按开学日期找原来那个学期（可能有重名学期，不能只按名字挑）
    const backRow = Array.prototype.filter.call(semRows, (r) => r.textContent.indexOf(sem.startDate) >= 0)[0];
    check('弹窗里能找到原来的学期', !!backRow, semRows.length + ' 行 / ' + sem.startDate);
    if (backRow) { backRow.click(); }
    await sleep(500);
    check('切回原学期后当前学期正确',
      (AR.Store.currentSemester() || {}).id === sem.id,
      (AR.Store.currentSemester() || {}).name + ' / ' + (AR.Store.currentSemester() || {}).startDate);
    check('切学期后周表重画过', document.querySelectorAll('#weekGridWrap .wt-block').length >= 0);
    // 清掉刚建的测试学期（连它的节次一起清）
    const testSem = AR.Store.semesterList().filter((x) => x.name === '测试第二学期')[0];
    if (testSem) {
      AR.Store.get().periods = AR.Store.get().periods.filter((p2) => p2.semesterId !== testSem.id);
      AR.Store.get().semesters = AR.Store.get().semesters.filter((x) => x.id !== testSem.id);
    }
    AR.Store.save(true);
    AR.UI.renderWeek();
    await sleep(250);

    // c) 周表点课程 → 编辑窗口里有「加日程 / 闹钟 / 导航」，还有自定义色盘
    const chip1b = byText(document.querySelectorAll('#weekStrip .week-chip'), '2')[0];
    if (chip1b) { chip1b.click(); await sleep(300); }
    const wb = findBlock('冒烟测试课');
    check('周表里还能找到冒烟测试课', !!wb);
    if (wb) {
      wb.click();
      await sleep(350);
      const tools = $('#modalCard').querySelector('#ebTools');
      check('课程编辑窗口有快捷操作条', !!tools);
      if (tools) {
        const acts = Array.prototype.map.call(tools.querySelectorAll('[data-act]'), (b) => b.getAttribute('data-act'));
        check('快捷操作含 日程 / 闹钟 / 导航',
          acts.indexOf('cal') >= 0 && acts.indexOf('alarm') >= 0 && acts.indexOf('nav') >= 0, acts.join(','));
        let calCalled = null, alarmCalled = null;
        const origCal = AR.Bridge.addCalendarEvent, origAlarm = AR.Bridge.setAlarm;
        AR.Bridge.addCalendarEvent = function (t, l, d, s, e) { calCalled = { t: t, s: s, e: e }; return Promise.resolve(); };
        AR.Bridge.setAlarm = function (h, m, msg) { alarmCalled = { h: h, m: m, msg: msg }; return Promise.resolve(); };
        tools.querySelector('[data-act="cal"]').click();
        await sleep(150);
        tools.querySelector('[data-act="alarm"]').click();
        await sleep(150);
        AR.Bridge.addCalendarEvent = origCal;
        AR.Bridge.setAlarm = origAlarm;
        check('点「加入系统日历」会带上时间', !!calCalled && calCalled.s > 0, JSON.stringify(calCalled));
        check('点「设置闹钟」会带上课程名与时间', !!alarmCalled, JSON.stringify(alarmCalled));
      }
      const pick = $('#ebColorPick');
      check('颜色区有自绘色盘入口', !!pick && typeof AR.UI.openColorPicker === 'function');
      if (pick) {
        // 新色盘：点开 → 填十六进制 → 用这个颜色（回调写回编辑器）
        pick.click();
        await sleep(340);
        const hexIn = document.querySelector('.cp-hex');
        check('色盘有十六进制输入框', !!hexIn);
        if (hexIn) {
          hexIn.value = '#1F7A5C';
          hexIn.dispatchEvent(new Event('input', { bubbles: true }));
          await sleep(100);
        }
        // 取色器是独立浮层（盖在编辑器上），按钮在 .cp-root 里
        const useBtn = byText(document.querySelectorAll('.cp-root .modal-actions .btn'), '用这个颜色')[0];
        check('色盘有「用这个颜色」按钮', !!useBtn);
        if (useBtn) { useBtn.click(); }
        await sleep(380);
        check('选完颜色后课程编辑器仍在（没被顶掉）', !!$('#ebName'));
        byText($('#modalCard').querySelectorAll('.modal-actions .btn'), '保存')[0].click();
        await sleep(400);
        const tb = AR.Store.blockById(tempBlock.id);
        const tc = tb ? AR.Store.courseById(tb.courseId) : null;
        check('自定义颜色保存成 #RRGGBB',
          tc && String(tc.colorKey).toLowerCase() === '#1f7a5c', tc ? tc.colorKey : 'none');
        check('自定义颜色的课在周表里用这个色画',
          !!(tc && AR.Schedule.dayItems(AR.Util.addDays(semMonday, 7 + slotB.wd - 1))
            .filter((i) => i.color && i.color.toLowerCase() === '#1f7a5c').length));
      }
    }

    // d) 「最近的课」倒计时元素 + 定时刷新存在
    AR.UI.show('today');
    AR.UI.setExpanded('next');        // 展开态才会画倒计时那一行
    await sleep(600);
    check('「最近的课」有倒计时元素（会自动刷新）', !!$('#nextCountdown'),
      'expanded=' + AR.UI.expanded() + ' hasNext=' + !!AR.Schedule.nextItem(new Date())
      + ' body=' + ($('#nextBody') ? ($('#nextBody').textContent || '').slice(0, 30) : 'no-body'));
    AR.UI.setExpanded(null);
    await sleep(300);

    // e) 关于与帮助：开源地址可点
    AR.UI.show('settings');
    await sleep(400);
    const navAbout = Array.prototype.filter.call(document.querySelectorAll('.settings-nav button'),
      (b) => (b.textContent || '').indexOf('关于') >= 0)[0];
    if (navAbout) { navAbout.click(); }
    await sleep(400);
    const repoBtn = $('#stRepo');
    check('关于页有「在浏览器中打开」按钮', !!repoBtn);
    if (repoBtn) {
      let opened = null;
      const origOpen = AR.Bridge.openUrl;
      AR.Bridge.openUrl = function (u) { opened = u; return Promise.resolve(); };
      repoBtn.click();
      await sleep(150);
      AR.Bridge.openUrl = origOpen;
      check('点它会打开 GitHub 仓库地址',
        opened === 'https://github.com/EtoileZzz/AbbeyRoad----ScheduleApp', String(opened));
    }

    // f) 所有弹窗的进出场动画必须完全一致（今日页「时间」vs 周表「课程」）
    function grabModalAnim() {
      const card = document.getElementById('modalCard');
      const list = (card.getAnimations ? card.getAnimations() : []).filter(
        (a) => a.effect && a.effect.getTiming && a.effect.target === card
          && !a.animationName);      // 排掉 CSS 动画（按钮脉冲等），只看弹窗自身的进场动画
      if (!list.length) { return null; }
      const a = list[0];
      const t = a.effect.getTiming();
      const k = a.effect.getKeyframes();
      return {
        dur: t.duration,
        ease: t.easing,
        from: (k[0] && k[0].transform) || '',
        to: (k[1] && k[1].transform) || ''
      };
    }
    // ① 今日页 →「最近的课」里的「时间」模块
    AR.UI.show('today');
    AR.UI.setExpanded('next');
    await sleep(560);
    const modList = document.querySelectorAll('#zoneNext .info-grid .info-cell');
    check('「最近的课」有时间模块可点', modList.length >= 3);
    if (modList.length >= 3) {
      modList[2].click();
      await sleep(60);
      var animToday = grabModalAnim();
      AR.UI.closeModal();
      await sleep(420);
    }
    // ② 周表 → 点课程卡片
    const chip3 = byText(document.querySelectorAll('#weekStrip .week-chip'), '2')[0];
    AR.UI.show('week');
    await sleep(350);
    if (chip3) { chip3.click(); await sleep(300); }
    const wb2 = findBlock('冒烟测试课');
    check('周表里能看到课程卡片（弹窗动画对比用）', !!wb2);
    if (wb2) {
      wb2.click();
      await sleep(60);
      var animWeek = grabModalAnim();
      AR.UI.closeModal();
      await sleep(420);
    }
    check('今日页弹窗与周表弹窗动画完全一致',
      !!animToday && !!animWeek && JSON.stringify(animToday) === JSON.stringify(animWeek),
      JSON.stringify(animToday) + '  vs  ' + JSON.stringify(animWeek));
    check('弹窗进场用的是非线性曲线',
      !!animToday && /cubic-bezier/.test(String(animToday.ease)), animToday && String(animToday.ease));
    check('弹窗关闭后遮罩不残留', $('#modalRoot').hidden === true);

    /* ── ⑧ v0.2.2 四项 ───────────────────────────────────── */

    // a) 第 13 节及以后：导入时自动扩节次表
    const lateTxt = ['AbbeyRoad 课表 v1', '开学日期：' + sem.startDate,
      '晚课自动扩表测试｜周日｜13-14｜1-16｜测试楼101｜测试老师'].join('\n');
    const lateParsed = AR.MdParse.parse(lateTxt, {
      weekCount: sem.weekCount,
      semester: { name: sem.name, startDate: sem.startDate, weekCount: sem.weekCount }
    });
    const lateEnt = AR.MdParse.toEntities(lateParsed, AR.Store.get(), { mergeMode: 'never' });
    const lateRes = AR.MdParse.applyEntities(lateEnt, AR.Store.get());
    const periodsAfter = AR.Store.periodsOf(sem.id);
    check('第 13 节：导入时自动补了节次', lateRes.periodsAdded === 2, 'added=' + lateRes.periodsAdded);
    check('第 13 节：节次表扩到 14 节', periodsAfter.length === 14, periodsAfter.length);
    check('第 13 节：新补的时间接在最后一节之后',
      periodsAfter[12].start > periodsAfter[11].end, periodsAfter[12].start + ' > ' + periodsAfter[11].end);
    const lateSunday = AR.Util.addDays(semMonday, 6);
    const lateItems = AR.Schedule.dayItems(lateSunday).filter((i) => i.course.name === '晚课自动扩表测试');
    check('第 13 节：周日的课有时间了', lateItems.length === 1 && !!lateItems[0].start,
      lateItems.length ? (lateItems[0].start + '-' + lateItems[0].end) : 'no item');
    check('第 13 节：节次标签是 13-14', lateItems.length ? lateItems[0].periodLabel : '', lateItems.length ? lateItems[0].periodLabel : '');
    // 清掉这节测试课
    const lateCourse = AR.Store.get().courses.filter((c) => c.name === '晚课自动扩表测试')[0];
    if (lateCourse) {
      AR.Store.get().blocks = AR.Store.get().blocks.filter((b) => b.courseId !== lateCourse.id);
      AR.Store.get().courses = AR.Store.get().courses.filter((c) => c.id !== lateCourse.id);
      AR.Store.save(true);
    }

    // b) 复制提示词后自动切到「课表文本」
    let copiedPrompt = false;
    const origCopyPrompt = AR.Bridge.copy;
    AR.Bridge.copy = function () { copiedPrompt = true; return Promise.resolve(); };
    AR.UI.show('import');
    await sleep(300);
    const promptTab = document.querySelector('[data-tab="prompt"]');
    if (promptTab) { promptTab.click(); }
    await sleep(300);
    $('#btnCopyPrompt').click();
    await sleep(900);
    AR.Bridge.copy = origCopyPrompt;
    check('复制提示词会真的复制', copiedPrompt);
    check('复制提示词后自动切到「课表文本」',
      !document.querySelector('[data-tab-body="md"]').hidden
      && document.querySelector('[data-tab-body="prompt"]').hidden);

    // c) 从导出目录导入
    AR.UI.show('import');
    await sleep(250);
    jsonTab.click();
    await sleep(300);
    check('配置文件页有「从导出目录导入」按钮', !!$('#btnImportFromExports'));
    const exportsList = await AR.Bridge.listExports();
    check('能列出导出目录里的配置文件', Array.isArray(exportsList), 'count=' + (exportsList ? exportsList.length : 'n/a'));
    if (exportsList && exportsList.length) {
      const biggest = exportsList.slice().sort((a, b) => (b.size || 0) - (a.size || 0))[0];
      const firstText = await AR.Bridge.readTextUri(biggest.uri);
      check('导出的文件能读回文本', typeof firstText === 'string' && firstText.length > 50,
        biggest.name + ' len=' + (firstText || '').length);
      $('#btnImportFromExports').click();
      await sleep(500);
      const rows = document.querySelectorAll('.export-row');
      check('「从导出目录导入」弹出文件清单', rows.length > 0, rows.length);
      if (rows.length) {
        rows[0].click();
        await sleep(900);
        const sum = ($('#jsonSummary').textContent || '');
        check('点清单里的文件能解析出预览', sum.indexOf('新增') >= 0, sum.slice(0, 50));
      }
      AR.UI.closeModal();
      await sleep(300);
    }

    // d) 清空所有数据：提前松手不清、按住 3 秒才清
    AR.UI.show('settings');
    await sleep(400);
    const navToData = document.querySelectorAll('.settings-nav button');
    for (let i = 0; i < navToData.length; i++) {
      if ((navToData[i].textContent || '').indexOf('数据') >= 0) { navToData[i].click(); break; }
    }
    await sleep(400);
    check('设置里有「清空所有数据」按钮', !!document.getElementById('stReset'));
    const coursesBeforeReset = AR.Store.get().courses.length;
    document.getElementById('stReset').click();
    await sleep(350);
    const holdBtn = document.getElementById('resetHold');
    check('清空需要按住 3 秒（弹窗里有长按按钮）', !!holdBtn);
    if (holdBtn) {
      const firePointer = (type) => holdBtn.dispatchEvent(new Event(type, { bubbles: true }));
      // 按下 1 秒就松手 → 不能清
      firePointer('pointerdown');
      await sleep(1000);
      firePointer('pointerup');
      await sleep(300);
      check('提前松手不会清空数据', AR.Store.get().courses.length === coursesBeforeReset,
        AR.Store.get().courses.length + ' vs ' + coursesBeforeReset);
      // 按住 3.3 秒 → 清空
      firePointer('pointerdown');
      await sleep(3300);
      firePointer('pointerup');
      await sleep(400);
      check('按住 3 秒后数据被清空', AR.Store.get().courses.length === 0, AR.Store.get().courses.length);
      check('清空后弹窗自动关闭', $('#modalRoot').hidden === true);
    }

    // e) 清空后再导入原来的配置 → 必须能看到课（用户反馈的核心场景）
    const merged = AR.ConfigIO.mergePayload(JSON.parse(configSnapshot));
    check('清空后导入原配置：合并成功', !!merged.ok && AR.Store.get().courses.length > 0,
      'courses=' + AR.Store.get().courses.length);
    const curSem = AR.Store.currentSemester();
    check('清空后导入原配置：当前学期有课（界面不再空白）',
      AR.Store.blockCountOfSemester(curSem ? curSem.id : null) > 0,
      'sem=' + (curSem ? curSem.name : '') + ' blocks=' + AR.Store.blockCountOfSemester(curSem ? curSem.id : null));
    AR.UI.show('week');
    await sleep(500);
    const visAfter = document.querySelectorAll('#weekGridWrap .wt-block').length;
    check('清空后导入原配置：周表重新画出来', visAfter > 0, 'blocks=' + visAfter);
    AR.UI.show('settings');
    await sleep(300);

    /* ── ⑩ v0.2.7 开发者模式：长按「外观」调过渡动画 ─────── */
    const devBefore = AR.Store.get().settings.appearance.devMode === true;
    const navAppearance = document.querySelector('.settings-nav button[data-key="appearance"]');
    check('设置导航里有「外观」入口', !!navAppearance);
    if (navAppearance) {
      navAppearance.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 8, clientY: 8 }));
      await sleep(1000);
      const devAfter = AR.Store.get().settings.appearance.devMode === true;
      check('长按「外观」切换开发者模式', devAfter !== devBefore, 'devMode=' + devAfter);
      await sleep(260);
      check('开发者模式打开后出现动画设置区', !devAfter || !!document.querySelector('.dev-motion'));
      const rows = document.querySelectorAll('.dev-motion .dev-row');
      check('5 个可调场景都在（聚焦放大/缩小、内容、弹窗进出、页面、列表）', !devAfter || rows.length === 5,
        'rows=' + rows.length);
      if (devAfter && rows.length) {
        const sel = rows[0].querySelector('select');
        const before = AR.Motion.get('zoneFocus').k;
        const alt = Array.prototype.map.call(sel.options, (o) => o.value).filter((v) => v !== before)[0];
        sel.value = alt;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        await sleep(120);
        check('换一个动画样式立刻生效', AR.Motion.get('zoneFocus').k === alt,
          before + ' → ' + AR.Motion.get('zoneFocus').k);
        check('样式选择已落盘', AR.Motion.saved().zoneFocus === alt);
        check('进入/退出是同一选项的两个方向（in/out 都在）',
          !!AR.Motion.dir('zoneFocus', 'in') && !!AR.Motion.dir('zoneFocus', 'out'));
        check('默认动画：今日页=点击处扩散+回弹、弹窗=内容逐条拼合、页面=错峰上浮',
          AR.Motion.table.zoneFocus.default === 'rippleSpring'
          && AR.Motion.table.modal.default === 'cascade'
          && AR.Motion.table.viewIn.default === 'rise');
        AR.Motion.reset();
        await sleep(80);
        check('「全部恢复默认」把样式清空', Object.keys(AR.Motion.saved()).length === 0);
      }
      // 关掉开发者模式，别把用户界面留在调试态（除非本来就是开的）
      AR.Store.get().settings.appearance.devMode = devBefore;
      AR.Store.save(true);
      AR.Panels.renderSettings();
      await sleep(260);
    }

    /* ── ⑪ v0.2.8：配色方案 / 色盘 / 调休 / 长按快速新增 ────── */
    check('配色模块已加载（5 套方案）', !!AR.Palette && AR.Palette.schemeList().length === 5,
      AR.Palette ? AR.Palette.schemeList().length + ' 套' : '无');
    if (AR.Palette) {
      check('课程类型能自动识别（高等数学→理科，英语→文科，体育→体育）',
        AR.Palette.inferTrack('高等数学A') === 'science'
        && AR.Palette.inferTrack('大学英语') === 'arts'
        && AR.Palette.inferTrack('体育（一）') === 'pe',
        [AR.Palette.inferTrack('高等数学A'), AR.Palette.inferTrack('大学英语'),
          AR.Palette.inferTrack('体育（一）')].join('/'));
      const colorBackup = AR.Store.get().courses.map((c) => c.id + ':' + c.colorKey).join(',');
      AR.Palette.applyScheme('tracks');
      const changedColors = AR.Store.get().courses.filter((c) => String(c.colorKey).charAt(0) === '#').length;
      check('一键按类型重排后课程都拿到了方案色（#RRGGBB）', changedColors > 0, changedColors + ' 门');
      // 还原原来的颜色（测试不改用户数据）
      const map = {};
      colorBackup.split(',').forEach((p) => { const i = p.indexOf(':'); map[p.substring(0, i)] = p.substring(i + 1); });
      AR.Store.get().courses.forEach((c) => { if (map[c.id]) { c.colorKey = map[c.id]; } });
      AR.Store.save(true);
      check('配色测试后颜色已还原', AR.Store.get().courses.every((c) => c.colorKey === map[c.id]));
    }

    AR.UI.show('week');
    await sleep(360);
    check('周表有「调休 / 借课」入口', !!document.getElementById('btnDayShift'));
    check('周表空白格可用于快速新增（存在长按热区）', document.querySelectorAll('.wt-empty').length > 0,
      document.querySelectorAll('.wt-empty').length + ' 个空格');
    /* 周表排版：按可用高度自适应行高，尽量一屏放下整周 */
    const wrapEl = document.getElementById('weekGridWrap');
    const weekTable = wrapEl ? wrapEl.querySelector('.week-table') : null;
    check('周表按容器高度算行高（px，不再写死 minmax）',
      !!weekTable && /repeat\(\d+, \d+px\)/.test(weekTable.style.gridTemplateRows || ''),
      weekTable ? weekTable.style.gridTemplateRows : '无');
    /**
     * "尽量"一屏放下：行高是从可用高度算出来的，但有个下限（40px，窄栏 34px）——
     * 14 节课塞进 300px 高的容器时，再压就看不清字了，这时允许滚动是设计选择。
     * 所以判据是"要么放得下，要么已经压到最小行高"。
     */
    const weekRowPx = weekTable ? parseFloat(weekTable.style.getPropertyValue('--wt-row')) || 0 : 0;
    const weekFits = !!wrapEl && wrapEl.scrollHeight <= wrapEl.clientHeight + 4;
    check('周表尽量一屏放下（放不下时也已压到最小行高）',
      weekFits || weekRowPx <= 40.5,
      (wrapEl ? (wrapEl.scrollHeight + ' / ' + wrapEl.clientHeight) : '无') + ' · 行高=' + weekRowPx + 'px');
    const blocksAll = wrapEl ? wrapEl.querySelectorAll('.wt-block') : [];
    const namedBlocks = Array.prototype.filter.call(blocksAll,
      (b) => !!((b.querySelector('.n') || {}).textContent || '').trim());
    const contrastOk = namedBlocks.every((b) => /wt-block (lt|dk)/.test(b.className));
    check('每个课程块都按颜色亮度标注了文字对比档位（lt/dk）', contrastOk,
      namedBlocks.length + ' 块有课名 / 共 ' + blocksAll.length + ' 块');
    if (document.getElementById('btnDayShift')) {
      document.getElementById('btnDayShift').click();
      await sleep(320);
      check('调休弹窗能打开并显示来源/目标与预览',
        !!document.getElementById('dsSrc') && !!document.getElementById('dsDst')
        && !!document.querySelector('.ds-preview'),
        (document.querySelector('.ds-preview') || {}).textContent);
      const cancelBtn = byText($('#modalCard').querySelectorAll('.modal-actions .btn'), '取消')[0];
      if (cancelBtn) { cancelBtn.click(); }
      await sleep(320);
    }
    check('自绘色盘入口可用', typeof AR.UI.openColorPicker === 'function');
    AR.UI.openColorPicker('#2F6FD0', null, { title: '冒烟测试色盘' });
    await sleep(320);
    check('色盘有饱和/明度方块 + 色相条 + 十六进制输入',
      !!document.querySelector('.cp-sv') && !!document.querySelector('.cp-hue')
      && !!document.querySelector('.cp-hex'));
    // 取色器的按钮在自己的浮层里（.cp-root），别去点主弹窗的取消
    const cpCancel = byText(document.querySelectorAll('.cp-root .modal-actions .btn'), '取消')[0];
    if (cpCancel) {
      cpCancel.click();
      await sleep(360);
    }
    check('关闭取色浮层后不残留遮罩', document.querySelectorAll('.cp-root').length === 0,
      document.querySelectorAll('.cp-root').length + ' 个');
    await sleep(320);
    AR.UI.show('settings');
    await sleep(240);

    /* ── 收尾：内容清掉 + 数据还原 ───────────────────────── */
    if (tempBlock) { AR.Store.removeBlock(tempBlock.id); }
    if (tempCourse) {
      AR.Store.get().courses = AR.Store.get().courses.filter((c) => c.id !== tempCourse.id);
      AR.Store.save(true);
    }
    check('临时课程已删除',
      AR.Store.get().courses.filter((c) => c.name === '冒烟测试课').length === 0);
  } catch (e) {
    report.fatal = String((e && e.stack) || e);
  } finally {
    try {
      if (backup === null) { localStorage.removeItem(key); } else { localStorage.setItem(key, backup); }
      /**
       * 用 reload() 而不是 load()：load() 会换掉整个 state 对象，
       * 而 ui.js / panels.js 缓存了 state 引用 —— 那样后面的检查项会对着
       * 新对象改设置、界面却读旧对象（左手模式那类检查会假失败）。
       */
      if (AR.Store.reload) { AR.Store.reload(); } else { AR.Store.load(); }
      report.coursesAfterRestore = AR.Store.get().courses.length;
      report.blocksAfterRestore = AR.Store.get().blocks.length;
      AR.UI.renderToday();
      if (AR.UI.currentView() === 'week') { AR.UI.renderWeek(); }
    } catch (e2) { report.restoreError = String(e2); }
  }
  return JSON.stringify(report);
})()`;

async function main() {
  const targets = await fetch('http://127.0.0.1:' + port + '/json').then((r) => r.json()).catch((e) => {
    console.error('无法连接 CDP（端口 ' + port + '）：' + e.message);
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
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  });
  await new Promise((resolve) => ws.addEventListener('open', resolve));
  await send('Runtime.enable');

  const res = await send('Runtime.evaluate', {
    expression: script, returnByValue: true, awaitPromise: true, userGesture: true
  });
  const payload = res.result && res.result.result && res.result.result.value;
  if (!payload) {
    console.error('执行失败：' + JSON.stringify(res).slice(0, 800));
    process.exit(1);
  }
  const report = JSON.parse(payload);
  let pass = 0, fail = 0;
  report.checks.forEach((c) => {
    if (c.ok) { pass++; return; }
    fail++;
    console.log('  ✗ ' + c.name + (c.extra ? '  →  ' + c.extra : ''));
  });
  console.log('App 版本 ' + report.version + ' · 通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  const dataBack = report.coursesBefore === report.coursesAfterRestore && report.blocksBefore === report.blocksAfterRestore;
  console.log('测试数据已还原：' + (dataBack ? '是' : '否（课程 ' + report.coursesBefore + '→' + report.coursesAfterRestore
    + '，时段 ' + report.blocksBefore + '→' + report.blocksAfterRestore + '）'));
  if (report.fatal) { console.log('脚本异常：' + report.fatal); }
  if (report.restoreError) { console.log('数据还原异常：' + report.restoreError); }
  process.exit(fail || report.fatal ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
