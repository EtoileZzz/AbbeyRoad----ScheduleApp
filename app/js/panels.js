/* ──────────────────────────────────────────────────────────────
   Abbey Road · 面板
   导入页（提示词 / Markdown 解析与修正 / JSON 同步）、
   设置页（8 个分类，含布局滑块实时预览）、首次启动引导
   ────────────────────────────────────────────────────────────── */

var AR = window.AR || (window.AR = {});

(function () {
  'use strict';

  var U = null;
  var S = null;
  var lastParsed = null;
  var boundOnce = false;

  function $(id) { return document.getElementById(id); }
  function el(html) { var d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstChild; }
  function esc(s) { return AR.Util.escapeHtml(s); }

  /** 所有对外的入口都先调它：保证 U（工具）与 S（状态）已就绪 */
  function ensure() {
    if (!U) { U = AR.Util; }
    S = AR.Store.get();
    return S;
  }

  /* ══════════════════════════ 导入页 ══════════════════════════ */

  function renderImport() {
    ensure();
    $('promptPreview').textContent = AR.Prompt.text;
    $('promptVersion').textContent = '提示词版本 ' + AR.Prompt.version;
    // 导入选项默认值 = 当前学期
    var sem = AR.Store.currentSemester();
    if (sem) {
      if ($('optSemName') && !$('optSemName').value) { $('optSemName').value = sem.name || ''; }
      if ($('optSemStart') && !$('optSemStart').value) { $('optSemStart').value = sem.startDate || ''; }
      if ($('optSemWeeks')) { $('optSemWeeks').value = sem.weekCount || 20; }
    }
    if (!boundOnce) { bindImport(); boundOnce = true; }
    renderManualTab();
  }

  /* ── 手动添加：课程 / 特殊事件 ───────────────────────────── */

  /** 渲染手动添加页：节次下拉、颜色下拉、已添加事件列表 */
  function renderManualTab() {
    var sem = AR.Store.currentSemester();
    var periods = sem ? AR.Store.periodsOf(sem.id) : [];
    var startEl = $('manPeriodStart'), endEl = $('manPeriodEnd');
    if (startEl && !startEl.options.length) {
      for (var i = 0; i < periods.length; i++) {
        var p = periods[i];
        startEl.appendChild(el('<option value="' + p.index + '">第' + p.index + '节 ' + p.start + '</option>'));
        endEl.appendChild(el('<option value="' + p.index + '">第' + p.index + '节 ' + p.end + '</option>'));
      }
      if (endEl.options.length > 1) { endEl.selectedIndex = 1; }
    }
    var colorEl = $('manColor');
    if (colorEl && colorEl.options.length <= 1) {
      var pal = AR.Util.PALETTE;
      for (var c = 0; c < pal.length; c++) {
        colorEl.appendChild(el('<option value="' + pal[c].key + '">' + pal[c].name + '</option>'));
      }
    }
    renderEventList();
  }

  /** 已经添加过的事件（按日期排序，可删除） */
  function renderEventList() {
    var box = $('eventList');
    if (!box) { return; }
    var st = AR.Store.get();
    var list = (st.events || []).slice().sort(function (a, b) {
      return String(a.date).localeCompare(String(b.date));
    });
    box.innerHTML = '';
    if (!list.length) {
      box.appendChild(el('<div class="muted">还没有特殊事件。考试、讲座、活动都可以加在这里，'
        + '它们会在「本周概览」里用专属颜色标出来。</div>'));
      return;
    }
    for (var i = 0; i < list.length; i++) {
      (function (ev) {
        var t = AR.Store.eventType(ev.type);
        var when = ev.date + (ev.start ? (' ' + ev.start + (ev.end ? '-' + ev.end : '')) : '');
        var row = el('<div class="list-item"><span class="code-badge" style="background:' + t.hex
          + ';color:#fff">' + t.label + '</span><span class="msg"><b>' + esc(ev.title) + '</b> · '
          + esc(when) + (ev.place ? (' · ' + esc(ev.place)) : '') + '</span>'
          + '<button class="chip-btn" type="button">删除</button></div>');
        row.querySelector('button').addEventListener('click', function () {
          AR.Store.removeEvent(ev.id);
          AR.Bridge.haptic('warn', row);
          renderEventList();
          refreshAll();
          AR.UI.toast('已删除事件');
        });
        box.appendChild(row);
      })(list[i]);
    }
  }

  /** 手动添加一门课：拼成 AR-TXT 一行，走和粘贴导入完全相同的解析/写入流程 */
  function addManualCourse() {
    var name = ($('manName').value || '').trim();
    var issues = $('manIssues');
    if (issues) { issues.innerHTML = ''; }
    if (!name) {
      AR.UI.toast('请先填课程名');
      if (issues) { issues.appendChild(el('<div class="issue error"><span class="msg">课程名不能为空</span></div>')); }
      return;
    }
    var start = $('manPeriodStart').value || '1';
    var end = $('manPeriodEnd').value || start;
    if (Number(end) < Number(start)) { var tmp = start; start = end; end = tmp; }
    var sem = AR.Store.currentSemester();
    var lines = ['AbbeyRoad 课表 v1', '开学日期：' + ((sem && sem.startDate) || '?')];
    lines.push([name, $('manWeekday').value || '周一', start + '-' + end,
      ($('manWeeks').value || '全周'), ($('manPlace').value || ''), ($('manTeacher').value || ''),
      ($('manNote').value || ''), ($('manColor').value || '')].join('｜'));
    var opts = importOptions();
    var parsed = AR.MdParse.parse(lines.join('\n'), opts);
    if (parsed.summary.errors) {
      var shown = 0;
      for (var i = 0; i < parsed.issues.length && shown < 5; i++) {
        if (parsed.issues[i].level === 'error') {
          if (issues) { issues.appendChild(el('<div class="issue error"><span class="code-badge">'
            + parsed.issues[i].code + '</span><span class="msg">' + esc(parsed.issues[i].message) + '</span></div>')); }
          shown++;
        }
      }
      AR.UI.toast('还有 ' + parsed.summary.errors + ' 处需要修正');
      return;
    }
    var mode = S.settings.schedule.autoMergeConsecutive === 'never' ? 'never' : 'auto';
    var entities = AR.MdParse.toEntities(parsed, S, { mergeMode: mode });
    var res = AR.MdParse.applyEntities(entities, S);
    AR.Bridge.haptic('medium', $('btnManualAdd'));
    AR.UI.toast('已添加：' + name + '（' + (parsed.issues.length ? '已按规则对齐字段' : 'OK') + '）');
    if (res && res.periodsAdded) { toastPeriodsAdded(res.periodsAdded); }
    $('manName').value = '';
    $('manPlace').value = '';
    $('manNote').value = '';
    refreshAll();
  }

  /** 手动添加一个特殊事件 */
  function addManualEvent() {
    var title = ($('evTitle').value || '').trim();
    var date = $('evDate').value || '';
    if (!title) { AR.UI.toast('请先填事件标题'); return; }
    if (!date) { AR.UI.toast('请选择事件日期'); return; }
    AR.Store.saveEvent({
      title: title, type: $('evType').value || 'other', date: date,
      start: $('evStart').value || '', end: $('evEnd').value || '',
      place: ($('evPlace').value || '').trim(), note: ($('evNote').value || '').trim()
    });
    AR.Bridge.haptic('medium', $('btnAddEvent'));
    AR.UI.toast('已添加事件：' + title);
    $('evTitle').value = '';
    $('evPlace').value = '';
    $('evNote').value = '';
    renderEventList();
    refreshAll();
  }

  /**
   * 快速新增（周表长按空白处用）：字段对象进来，走和"粘贴导入 / 手动添加"
   * 完全相同的一条链路（AR-TXT 解析 → toEntities → applyEntities），
   * 所以连堂合并、节次自动补全、同名同色这些规则一个都不会漏。
   */
  function quickAddCourse(f) {
    ensure();
    var sem = AR.Store.currentSemester();
    var p1 = Math.max(1, Number(f.p1) || 1);
    var p2 = Math.max(p1, Number(f.p2) || p1);
    var lines = ['AbbeyRoad 课表 v1', '开学日期：' + ((sem && sem.startDate) || '?')];
    lines.push([String(f.name || '').trim(), U.WEEKDAY_NAMES[f.weekday] || '周一', p1 + '-' + p2,
      (f.weeks || '全周'), f.place || '', f.teacher || '', f.note || '', f.color || ''].join('｜'));
    var parsed = AR.MdParse.parse(lines.join('\n'), importOptions());
    // 解析结果里课程在 rows / summary.courses（不是 courses 数组）
    if (!parsed || !parsed.summary || !parsed.summary.courses) {
      return { ok: false, message: '没解析出课程，检查一下课程名' };
    }
    if (parsed.summary && parsed.summary.errors) {
      return { ok: false, message: '还有 ' + parsed.summary.errors + ' 处需要修正' };
    }
    var mode = S.settings.schedule.autoMergeConsecutive === 'never' ? 'never' : 'auto';
    var entities = AR.MdParse.toEntities(parsed, S, { mergeMode: mode });
    var res = AR.MdParse.applyEntities(entities, S);
    refreshAll();
    return { ok: true, periodsAdded: res && res.periodsAdded };
  }

  /** 快速新增特殊事件（考试 / 讲座 / 活动） */
  function quickAddEvent(f) {
    ensure();
    if (!f || !f.title || !f.date) { return { ok: false, message: '标题和日期都要填' }; }
    AR.Store.saveEvent({
      title: String(f.title), type: f.type || 'other', date: f.date,
      start: f.start || '', end: f.end || '', place: f.place || '', note: f.note || ''
    });
    refreshAll();
    return { ok: true };
  }

  function bindImport() {
    tabwires(document.querySelector('#view-import .tabs-panel'));

    $('btnCopyPrompt').addEventListener('click', function () {
      AR.Bridge.haptic('medium', $('btnCopyPrompt'));
      AR.Bridge.copy(AR.Prompt.text);
      // v0.2.2：复制完直接把用户带到下一步（「2 课表文本」），并在那里给一句明确引导
      goToTextStep();
    });
    $('btnSharePrompt').addEventListener('click', function () {
      AR.Bridge.haptic('medium', $('btnSharePrompt'));
      AR.Bridge.share('Abbey Road 课表整理提示词', AR.Prompt.text);
    });

    var mdInput = $('mdInput');
    var live = AR.Util.debounce(function () { parseMd(); }, 280);
    mdInput.addEventListener('input', live);

    // 改动导入选项（学期 / 总周数 / 默认单双周）立即重新解析
    var optIds = ['optSemName', 'optSemStart', 'optSemWeeks', 'optParity'];
    for (var oi = 0; oi < optIds.length; oi++) {
      var optNode = $(optIds[oi]);
      if (optNode) { optNode.addEventListener('change', function () { parseMd(); }); }
    }

    $('btnDemoMd').addEventListener('click', function () {
      mdInput.value = AR.MdParse.sample;
      parseMd();
      AR.Bridge.haptic('light', $('btnDemoMd'));
    });
    $('btnClearMd').addEventListener('click', function () {
      mdInput.value = '';
      parseMd();
    });
    $('btnPickMd').addEventListener('click', function () { AR.Bridge.importText(); });
    $('btnApplyMd').addEventListener('click', applyMd);

    // 手动添加：课程 / 特殊事件
    if ($('btnManualAdd')) { $('btnManualAdd').addEventListener('click', addManualCourse); }
    if ($('btnAddEvent')) { $('btnAddEvent').addEventListener('click', addManualEvent); }

    /* 配置文件：整块交给 AR.ConfigIO（见 js/configio.js） */
    $('btnExportJson').addEventListener('click', function () { AR.ConfigIO.exportFile($('btnExportJson')); });
    if ($('btnExportWechat')) {
      $('btnExportWechat').addEventListener('click', function () { AR.ConfigIO.exportToApp($('btnExportWechat')); });
    }
    $('btnImportJson').addEventListener('click', function () { AR.ConfigIO.openFromFile(); });
    if ($('btnImportFromExports')) {
      $('btnImportFromExports').addEventListener('click', function () { AR.ConfigIO.openFromExports($('btnImportFromExports')); });
    }
    $('btnCopyJson').addEventListener('click', function () { AR.ConfigIO.copyText($('btnCopyJson')); });

    // 粘贴完自动解析出预览（写成文本也一样，都在 ConfigIO 里处理）
    var jsonLive = AR.Util.debounce(function () {
      var txt = $('jsonInput').value;
      if (!String(txt || '').trim()) { return; }
      AR.ConfigIO.previewText(txt, '粘贴的配置文本');
    }, 400);
    $('jsonInput').addEventListener('input', jsonLive);
    $('btnApplyJsonText').addEventListener('click', function () {
      var txt = $('jsonInput').value;
      if (!String(txt || '').trim()) { AR.UI.toast('请先粘贴配置文本'); return; }
      AR.Bridge.haptic('light', $('btnApplyJsonText'));
      AR.ConfigIO.previewText(txt, '粘贴的配置文本');
    });
    if ($('btnClearJson')) {
      $('btnClearJson').addEventListener('click', function () {
        $('jsonInput').value = '';
        $('jsonSummary').innerHTML = '';
        $('jsonIssues').innerHTML = '';
        AR.ConfigIO.reset();
      });
    }
    $('btnApplyJson').addEventListener('click', function () { AR.ConfigIO.apply($('btnApplyJson')); });
  }

  /**
   * Tab 绑定。
   * 导入面板里有两组 .segmented：第一行是带序号的「1 提示词 / 2 课表文本」，
   * 第二行是「手动添加 / 配置文件」；它们共用同一套内容区切换逻辑与胶囊动效，
   * 所以这里一次性把面板内所有 .seg[data-tab] 都接上。
   */
  function tabwires(container) {
    var segs = container.querySelectorAll('.seg[data-tab]');
    var groups = container.querySelectorAll('.segmented');
    var subNav = $('importSubNav');
    var subMenu = $('importSubMenu');
    var subBtn = $('btnSubNav');
    var subLabel = $('subNavLabel');

    /** 「手动导入」子菜单：开合走 opacity + transform 过渡，不做生硬显隐 */
    function setSubMenu(open) {
      if (!subNav) { return; }
      subNav.classList.toggle('open', !!open);
      if (subBtn) { subBtn.setAttribute('aria-expanded', open ? 'true' : 'false'); }
      if (!subMenu) { return; }
      if (subMenu.__hideTimer) { clearTimeout(subMenu.__hideTimer); subMenu.__hideTimer = null; }
      if (open) {
        subMenu.hidden = false;
      } else {
        subMenu.__hideTimer = setTimeout(function () { subMenu.hidden = true; subMenu.__hideTimer = null; }, 200);
      }
    }

    function showTab(name, fromNode) {
      for (var j = 0; j < segs.length; j++) {
        segs[j].classList.toggle('active', segs[j].getAttribute('data-tab') === name);
      }
      for (var g = 0; g < groups.length; g++) {
        if (AR.UI.syncSegPill) { AR.UI.syncSegPill(groups[g], true); }   // 胶囊滑动 420ms
      }
      var bodies = document.querySelectorAll('[data-tab-body]');
      for (var b = 0; b < bodies.length; b++) {
        bodies[b].hidden = (bodies[b].getAttribute('data-tab-body') !== name);
      }
      // 右下角悬浮按钮：「应用到课表」只在课表文本页出现，「合并导入」只在配置文件页出现
      var fabMd = $('btnApplyMd');
      if (fabMd) { fabMd.hidden = (name !== 'md'); }
      var fabJson = $('btnApplyJson');
      if (fabJson) { fabJson.hidden = (name !== 'json'); }
      if (fromNode) { AR.Bridge.haptic('light', fromNode); }
    }

    for (var i = 0; i < segs.length; i++) {
      segs[i].addEventListener('click', function (ev) {
        var name = ev.currentTarget.getAttribute('data-tab');
        showTab(name, ev.currentTarget);
        // 选中子菜单里的项以后，菜单保持展开，并在按钮上标出当前子页
        if (name === 'manual' || name === 'json') {
          if (subLabel) { subLabel.textContent = (name === 'manual') ? '手动导入 · 手动添加' : '手动导入 · 配置文件'; }
          setSubMenu(true);
        } else if (subLabel) {
          subLabel.textContent = '手动导入';
          setSubMenu(false);
        }
      });
    }
    if (subBtn) {
      subBtn.addEventListener('click', function () {
        var open = !(subNav && subNav.classList.contains('open'));
        setSubMenu(open);
        AR.Bridge.haptic('light', subBtn);
      });
    }
    // 点到面板以外的地方，子菜单自动收起
    document.addEventListener('click', function (ev) {
      if (subNav && !subNav.contains(ev.target)) { setSubMenu(false); }
    });
    showTab('prompt', null);   // 默认停在第一步
  }

  /* ── Markdown 解析与预览 ─────────────────────────────────── */

  function parseMd() {
    ensure();
    var text = $('mdInput').value || '';
    lastParsed = AR.MdParse.parse(text, importOptions());
    renderMdResult();
  }

  /** 读取导入页的选项：学期规则 + 默认单双周 */
  function importOptions() {
    var sem = AR.Store.currentSemester();
    var startEl = $('optSemStart'), nameEl = $('optSemName');
    var weeksEl = $('optSemWeeks'), parityEl = $('optParity');
    var weeks = (weeksEl && weeksEl.value) ? Number(weeksEl.value) : ((sem && sem.weekCount) || 20);
    return {
      weekCount: weeks,
      defaultParity: parityEl ? parityEl.value : 'all',
      semester: {
        name: (nameEl && nameEl.value) || (sem ? sem.name : ''),
        startDate: (startEl && startEl.value) || (sem ? sem.startDate : null),
        weekCount: weeks
      }
    };
  }

  function renderMdResult() {
    var p = lastParsed;
    var sum = $('mdSummary');
    var issues = $('mdIssues');
    var preview = $('mdPreview');
    var btn = $('btnApplyMd');
    if (!p) { sum.innerHTML = ''; issues.innerHTML = ''; preview.innerHTML = ''; btn.disabled = true; return; }

    var s = p.summary;
    sum.innerHTML = '';
    sum.appendChild(el('<span class="tag">课程 ' + s.courses + ' 行</span>'));
    sum.appendChild(el('<span class="tag">节次 ' + s.periods + ' 条</span>'));
    sum.appendChild(el('<span class="tag">变动 ' + s.overrides + ' 条</span>'));
    if (s.errors) { sum.appendChild(el('<span class="tag danger">阻断错误 ' + s.errors + '</span>')); }
    if (s.warnings) { sum.appendChild(el('<span class="tag warn">警告 ' + s.warnings + '</span>')); }
    if (s.conflicts) { sum.appendChild(el('<span class="tag danger">冲突 ' + s.conflicts + '</span>')); }

    issues.innerHTML = '';
    var shown = 0;
    for (var i = 0; i < p.issues.length && shown < 40; i++) {
      var iss = p.issues[i];
      var cls = iss.level === 'error' ? 'error' : (iss.level === 'conflict' ? 'error' : (iss.level === 'info' ? 'info' : ''));
      issues.appendChild(el('<div class="issue ' + cls + '"><span class="code-badge">' + iss.code
        + '</span><span class="msg">' + esc(iss.message) + '</span></div>'));
      shown++;
    }

    // 可修正行：把缺字段的课程行做成内联编辑
    preview.innerHTML = '';
    if (p.rows.length) {
      var fixed = el('<div class="panel" style="margin-top:12px"><div class="panel-head">'
        + '<h2 class="panel-title">逐条检查</h2><span class="muted">有红点的行需要修正后才能导入</span></div></div>');
      var listWrap = el('<div></div>');
      for (var r = 0; r < p.rows.length; r++) {
        listWrap.appendChild(fixRow(p, r));
      }
      fixed.appendChild(listWrap);
      preview.appendChild(fixed);
    }

    btn.disabled = (s.errors > 0) || (p.rows.length === 0);
    if (s.errors > 0) { btn.textContent = '还有 ' + s.errors + ' 处待修正'; }
    else { btn.textContent = '应用到课表'; }
  }

  function fixRow(p, index) {
    var r = p.rows[index];
    var bad = false;
    for (var i = 0; i < r.issues.length; i++) { if (r.issues[i].level === 'error') { bad = true; } }
    var row = el('<div class="fix-row">'
      + '<input class="input input-sm" data-f="courseName" value="' + esc(r.courseName) + '" placeholder="课程名">'
      + '<select class="input input-sm" data-f="weekday">'
      + weekdayOptions(r.weekday) + '</select>'
      + '<input class="input input-sm" data-f="periodsRaw" value="' + esc(r.periodsRaw) + '" placeholder="节次 1-2">'
      + '<input class="input input-sm" data-f="weeksRaw" value="' + esc(r.weeksRaw) + '" placeholder="周次 1-16">'
      + '</div>');
    if (bad) { row.style.borderLeft = '3px solid var(--danger)'; row.style.paddingLeft = '8px'; }
    var fields = row.querySelectorAll('[data-f]');
    for (var f = 0; f < fields.length; f++) {
      fields[f].addEventListener('change', function (ev) {
        var name = ev.currentTarget.getAttribute('data-f');
        var val = ev.currentTarget.value;
        if (name === 'weekday') {
          r.weekday = val ? Number(val) : null;
          r.weekdayRaw = val ? U.WEEKDAY_NAMES[Number(val)] : '';
        } else {
          r[name] = val;
        }
        // 用「当前解析结果」重建 Markdown，再重新解析（文本始终是唯一真源）
        $('mdInput').value = serializeParsed(p);
        parseMd();
        AR.Bridge.haptic('light', ev.currentTarget);
      });
    }
    return row;
  }

  function weekdayOptions(current) {
    var html = '<option value="">星期?</option>';
    for (var i = 1; i <= 7; i++) {
      html += '<option value="' + i + '"' + (current === i ? ' selected' : '') + '>' + U.WEEKDAY_NAMES[i] + '</option>';
    }
    return html;
  }

  /** 把解析结果重新序列化成 MD-1 文本（修正字段后回写用） */
  function serializeParsed(p) {
    var lines = ['# Abbey Road 课表导入', '', '<!-- abbeyroad-import: v1 -->', ''];
    lines.push('## 学期');
    lines.push('| 学期名称 | 开始日期 | 总周数 |');
    lines.push('| --- | --- | --- |');
    lines.push('| ' + ((p.semester && p.semester.name) || '') + ' | '
      + ((p.semester && p.semester.startDate) || '') + ' | '
      + ((p.semester && p.semester.weekCount) || '') + ' |');
    lines.push('');
    lines.push('## 节次表');
    lines.push('| 节次 | 开始时间 | 结束时间 |');
    lines.push('| --- | --- | --- |');
    var periods = p.periods.length ? p.periods : defaultPeriodRows();
    for (var i = 0; i < periods.length; i++) {
      lines.push('| ' + periods[i].index + ' | ' + periods[i].start + ' | ' + periods[i].end + ' |');
    }
    lines.push('');
    lines.push('## 课程');
    lines.push('| 课程名 | 老师 | 地点 | 星期 | 节次 | 周次 | 单双周 | 备注 |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
    for (var r = 0; r < p.rows.length; r++) {
      var row = p.rows[r];
      lines.push('| ' + [row.courseName, row.teachersRaw, row.place,
        row.weekday ? U.WEEKDAY_NAMES[row.weekday] : (row.weekdayRaw || ''),
        row.periodsRaw, row.weeksRaw, row.parityRaw || '全周', row.note || '-'].join(' | ') + ' |');
    }
    lines.push('');
    lines.push('## 调课与停课');
    lines.push('| 课程名 | 日期 | 类型 | 新星期 | 新节次 | 新地点 | 原因/备注 |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- |');
    for (var o = 0; o < p.overrides.length; o++) {
      var ov = p.overrides[o];
      lines.push('| ' + [ov.courseName, ov.date || ov.dateRaw, typeLabel(ov.type) || ov.typeRaw,
        ov.weekday ? U.WEEKDAY_NAMES[ov.weekday] : '-',
        ov.periodsRaw || '-', ov.place || '-', ov.reason || '-'].join(' | ') + ' |');
    }
    return lines.join('\n');
  }

  function defaultPeriodRows() {
    var times = AR.Store.defaultPeriodTimes();
    var out = [];
    for (var i = 0; i < times.length; i++) { out.push({ index: i + 1, start: times[i][0], end: times[i][1] }); }
    return out;
  }

  function typeLabel(t) {
    return t === 'move' ? '调课' : (t === 'cancel' ? '停课' : (t === 'makeup' ? '补课' : (t === 'room' ? '换教室' : (t === 'time' ? '换时间' : (t === 'add' ? '加课' : '')))));
  }

  /* ── 应用 Markdown 导入 ──────────────────────────────────── */

  function applyMd() {
    ensure();
    var p = lastParsed;
    if (!p || p.summary.errors > 0) { return; }
    var mode = S.settings.schedule.autoMergeConsecutive === 'never' ? 'never' : 'auto';
    var entities = AR.MdParse.toEntities(p, S, { mergeMode: mode });
    var res = AR.MdParse.applyEntities(entities, S);
    AR.Bridge.haptic('medium', $('btnApplyMd'));

    var msg = '导入完成：课程 ' + entities.courses.length + ' 门、时段 ' + entities.blocks.length + ' 条';
    if (entities.mergedCount) { msg += '，自动合并 ' + entities.mergedCount + ' 组连堂'; }
    AR.UI.toast(msg);
    if (res && res.periodsAdded) { toastPeriodsAdded(res.periodsAdded); }

    // 导入成功后自动清空输入区与解析结果，避免误点"再导入一次"
    $('mdInput').value = '';
    lastParsed = null;
    renderMdResult();

    refreshAll();

    // 规划文档 Q4：导入后要求用户设置学期与节次
    var sem = AR.Store.currentSemester();
    var needSetup = !p.semester || !p.semester.startDate || !p.periods.length;
    if (needSetup) { openSemesterSetup(); }

    // 连堂建议（部分匹配）
    if (entities.suggestions && entities.suggestions.length) {
      var body = '<p class="panel-sub">下面是「相邻节次但周次不同」的组合，确认后可合并为连堂课。</p>';
      for (var i = 0; i < entities.suggestions.length; i++) {
        body += '<div class="list-item"><span class="msg">' + esc(entities.suggestions[i].message) + '</span></div>';
      }
      AR.UI.openModal({ title: '连堂课建议', sub: '共 ' + entities.suggestions.length + ' 组', body: body, actions: [{ label: '知道了', kind: 'primary', onClick: function (c) { c(); } }] });
    }
  }

  /** 学期与节次设置（导入后弹出；对应 Q4 的决定） */
  function openSemesterSetup() {
    ensure();
    var sem = AR.Store.currentSemester();
    var periods = AR.Store.periodsOf(sem.id);
    var body = el('<div></div>');
    body.appendChild(el('<div class="field"><label class="field-label">学期名称</label>'
      + '<input class="input" id="setSemName" value="' + esc(sem.name) + '"></div>'));
    body.appendChild(el('<div class="field"><label class="field-label">开学第一周周一（决定"当前第几周"）</label>'
      + '<input class="input" id="setSemStart" type="date" value="' + esc(sem.startDate) + '"></div>'));
    body.appendChild(el('<div class="field"><label class="field-label">总周数</label>'
      + '<input class="input" id="setSemWeeks" type="number" min="1" max="30" value="' + (sem.weekCount || 20) + '"></div>'));
    var pbox = el('<div class="field"><label class="field-label">节次作息（可稍后在设置里改）</label>'
      + '<div class="period-grid">'
      + '<div class="ph">节次</div><div class="ph">开始</div><div class="ph">结束</div><div></div>'
      + '</div><div id="periodRows"></div></div>');
    body.appendChild(pbox);
    var rows = pbox.querySelector('#periodRows');
    for (var i = 0; i < periods.length; i++) {
      var p = periods[i];
      rows.appendChild(el('<div class="period-grid" data-period="' + p.id + '" style="margin-top:6px">'
        + '<div class="muted">第 ' + p.index + ' 节</div>'
        + '<input class="input input-sm" data-f="start" value="' + esc(p.start) + '">'
        + '<input class="input input-sm" data-f="end" value="' + esc(p.end) + '">'
        + '<div></div></div>'));
    }
    AR.UI.openModal({
      title: '学期与节次设置',
      sub: '导入完成，确认这两项后「当前第几周」和上课时间才准确',
      body: body,
      actions: [
        { label: '稍后设置', onClick: function (c) { c(); } },
        {
          label: '保存', kind: 'primary', onClick: function (c) {
            var s = AR.Store.get();
            var semX = AR.Store.currentSemester();
            semX.name = $('setSemName').value || semX.name;
            semX.startDate = $('setSemStart').value || semX.startDate;
            semX.weekCount = Number($('setSemWeeks').value) || semX.weekCount;
            semX.updatedAt = new Date().toISOString();
            var rowNodes = document.querySelectorAll('[data-period]');
            for (var i2 = 0; i2 < rowNodes.length; i2++) {
              var pid = rowNodes[i2].getAttribute('data-period');
              var st = rowNodes[i2].querySelector('[data-f="start"]').value;
              var en = rowNodes[i2].querySelector('[data-f="end"]').value;
              for (var j = 0; j < s.periods.length; j++) {
                if (s.periods[j].id === pid) {
                  s.periods[j].start = st; s.periods[j].end = en;
                  s.periods[j].updatedAt = new Date().toISOString();
                }
              }
            }
            AR.Store.save(true);
            c();
            AR.Bridge.haptic('medium', $('zoneNext'));
            refreshAll();
            AR.UI.toast('学期与节次已保存');
          }
        }
      ]
    });
  }

  /* ── JSON 文本导入 ───────────────────────────────────────── */

  /**
   * 导入时检测到晚于原节次表的课 → 节次表已自动补足，
   * 隔一拍再提示（别把「导入完成」的 toast 顶掉），并告诉用户去哪儿改时间。
   */
  function toastPeriodsAdded() {
    var sem = AR.Store.currentSemester();
    var total = (AR.Store.periodsOf(sem ? sem.id : null) || []).length;
    setTimeout(function () {
      AR.UI.toast('有课排在第 12 节之后，节次表已自动扩到 ' + total + ' 节（时间可在 设置 → 课程与课表 里改）');
    }, 1900);
  }

  /**
   * 复制提示词之后：自动切到「2 课表文本」，并在粘贴区闪一下提示框，
   * 让用户一眼知道下一步该干嘛（不用自己找第二个标签）。
   */
  function goToTextStep() {
    var tab = document.querySelector('[data-tab="md"]');
    if (tab) { setTimeout(function () { tab.click(); }, 240); }
    setTimeout(function () {
      AR.UI.toast('提示词已复制 → 去 DeepSeek / 豆包粘贴并发送课表截图，再把回复整段粘到这里');
    }, 420);
    setTimeout(function () {
      var box = $('mdInput');
      if (!box) { return; }
      box.classList.remove('input-flash');
      void box.offsetWidth;
      box.classList.add('input-flash');
      setTimeout(function () { box.classList.remove('input-flash'); }, 2200);
    }, 560);
  }

  /* ── 配置文件导入导出 ──────────────────────────────────────
     v0.2.3 起这块逻辑整体搬到 js/configio.js（AR.ConfigIO）：
     导出（另存为 / 微信 / 复制）、导入（选择器 / 导出目录 / 粘贴文本）、
     预览与合并都只有一份实现，这里只留一个旧名字给 boot.js 用。 */
  function handleJsonText(text, sourceName) {
    return AR.ConfigIO.importFromText(text, sourceName);
  }

  /* ══════════════════════════ 设置页 ══════════════════════════ */

  function renderSettings() {
    ensure();
    var grid = $('settingsGrid');
    if (!grid) { return; }
    grid.innerHTML = '';
    grid.appendChild(panelAppearance());
    grid.appendChild(panelLayout());
    grid.appendChild(panelWidgets());
    grid.appendChild(panelSchedule());
    grid.appendChild(panelNotify());
    grid.appendChild(panelSync());
    grid.appendChild(panelIntegration());
    grid.appendChild(panelData());
    grid.appendChild(panelAbout());
    renderSettingsNav();
  }

  var SETTINGS_SECTIONS = [
    { key: 'appearance', label: '外观' },
    { key: 'layout', label: '布局与尺寸' },
    { key: 'widgets', label: '桌面卡片' },
    { key: 'schedule', label: '课程与课表' },
    { key: 'notify', label: '提醒与通知' },
    { key: 'sync', label: '导入与同步' },
    { key: 'integration', label: '系统集成' },
    { key: 'data', label: '数据与备份' },
    { key: 'about', label: '关于与帮助' }
  ];

  /** 左侧分类导航：点击滚动到对应分类，滚动时自动高亮当前分类 */
  function renderSettingsNav() {
    var nav = $('settingsNav');
    if (!nav) { return; }
    nav.innerHTML = '';
    for (var i = 0; i < SETTINGS_SECTIONS.length; i++) {
      (function (sec) {
        var b = el('<button type="button" data-key="' + sec.key + '">' + esc(sec.label) + '</button>');
        b.addEventListener('click', function () {
          var target = document.getElementById('set-' + sec.key);
          var body = $('settingsBody');
          if (target && body) {
            // 自己算滚动位置（scrollIntoView 在嵌套滚动容器里不一定生效）
            var delta = target.getBoundingClientRect().top - body.getBoundingClientRect().top;
            var top = body.scrollTop + delta - 8;
            navClickLock = Date.now();          // 平滑滚动期间先别让滚动监听改高亮
            try { body.scrollTo({ top: top, behavior: 'smooth' }); }
            catch (e) { body.scrollTop = top; }
          }
          setActiveNav(sec.key);
          AR.Bridge.haptic('light', b);
        });
        // 长按「外观」进入 / 退出开发者模式（不提示、不显眼，避免普通用户误触）
        if (sec.key === 'appearance') { bindDevModeLongPress(b); }
        nav.appendChild(b);
      })(SETTINGS_SECTIONS[i]);
    }
    bindSettingsScroll();
    setActiveNav(currentVisibleSection() || SETTINGS_SECTIONS[0].key);
  }

  /**
   * 长按 800ms 进入开发者模式（再长按一次退出）。
   * 用 pointerdown/up + 位移取消，避免"想滚动结果被当成长按"。
   */
  function bindDevModeLongPress(btn) {
    var timer = null;
    function cancel() {
      if (timer) { clearTimeout(timer); timer = null; }
    }
    btn.addEventListener('pointerdown', function (ev) {
      cancel();
      var x0 = ev.clientX, y0 = ev.clientY;
      timer = setTimeout(function () {
        timer = null;
        var on = !(S.settings.appearance.devMode === true);
        S.settings.appearance.devMode = on;
        AR.Store.save(true);
        AR.Bridge.haptic('heavy', btn);
        renderSettings();
        if (AR.UI && AR.UI.toast) {
          AR.UI.toast(on ? '开发者模式已开启：外观页底部可调过渡动画' : '开发者模式已关闭');
        }
      }, 800);
      var move = function (e2) {
        if (Math.abs(e2.clientX - x0) > 10 || Math.abs(e2.clientY - y0) > 10) { cancel(); }
      };
      var up = function () {
        cancel();
        btn.removeEventListener('pointermove', move);
        btn.removeEventListener('pointerup', up);
        btn.removeEventListener('pointercancel', up);
      };
      btn.addEventListener('pointermove', move);
      btn.addEventListener('pointerup', up);
      btn.addEventListener('pointercancel', up);
    });
    btn.addEventListener('pointerleave', cancel);
    btn.addEventListener('contextmenu', function (ev) { ev.preventDefault(); });
  }

  function setActiveNav(key) {
    var nav = $('settingsNav');
    if (!nav) { return; }
    var btns = nav.querySelectorAll('button');
    for (var i = 0; i < btns.length; i++) {
      var on = btns[i].getAttribute('data-key') === key;
      btns[i].classList.toggle('active', on);
      if (on && btns[i].scrollIntoView) {
        try { btns[i].scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) { }
      }
    }
  }

  function currentVisibleSection() {
    var body = $('settingsBody');
    if (!body) { return null; }
    var secs = body.querySelectorAll('.set-section');
    var bodyTop = body.getBoundingClientRect().top;
    var current = null;
    for (var i = 0; i < secs.length; i++) {
      if (secs[i].getBoundingClientRect().top - bodyTop <= 46) {
        current = secs[i].getAttribute('data-key');
      }
    }
    return current;
  }

  var settingsScrollBound = false;
  var navClickLock = 0;
  function bindSettingsScroll() {
    if (settingsScrollBound) { return; }
    var body = $('settingsBody');
    if (!body) { return; }
    settingsScrollBound = true;
    body.addEventListener('scroll', AR.Util.debounce(function () {
      if (Date.now() - navClickLock < 900) { return; }
      var cur = currentVisibleSection();
      if (cur) { setActiveNav(cur); }
    }, 90));
  }

  function panel(title, inner, key) {
    var node = el('<section class="glass panel set-section" id="set-' + key + '" data-key="' + key + '">'
      + '<header class="panel-head"><h2 class="panel-title">' + esc(title) + '</h2></header></section>');
    node.appendChild(inner);
    return node;
  }

  function rowSwitch(label, desc, checked, onChange) {
    var node = el('<div class="setting-row"><div class="setting-text"><div class="t">' + esc(label) + '</div>'
      + '<div class="d">' + esc(desc) + '</div></div>'
      + '<label class="switch"><input type="checkbox"' + (checked ? ' checked' : '') + '>'
      + '<span class="track"></span><span class="knob"></span></label></div>');
    node.querySelector('input').addEventListener('change', function (ev) {
      AR.Bridge.haptic('light', node);
      onChange(ev.currentTarget.checked);
    });
    return node;
  }

  function segmented(options, current, onPick) {
    var box = el('<div class="segmented"></div>');
    for (var i = 0; i < options.length; i++) {
      (function (opt) {
        var b = el('<button class="seg' + (opt.value === current ? ' active' : '') + '" type="button">'
          + esc(opt.label) + '</button>');
        b.addEventListener('click', function () {
          for (var k = 0; k < box.children.length; k++) { box.children[k].classList.remove('active'); }
          b.classList.add('active');
          if (AR.UI.syncSegPill) { AR.UI.syncSegPill(box, true); }
          AR.Bridge.haptic('light', b);
          onPick(opt.value);
        });
        box.appendChild(b);
      })(options[i]);
    }
    return box;
  }

  /* 1 · 外观 */
  function panelAppearance() {
    var ap = S.settings.appearance;
    var box = el('<div></div>');
    box.appendChild(el('<div class="field-label">主题</div>'));
    box.appendChild(segmented([
      { label: '跟随系统', value: 'system' }, { label: '浅色', value: 'light' }, { label: '深色', value: 'dark' }
    ], ap.theme, function (v) {
      ap.theme = v; AR.Store.save(true); AR.UI.applyTheme();
      AR.Bridge.haptic('medium', $('settingsGrid'));
      renderSettings();
    }));
    box.appendChild(el('<div class="field-label" style="margin-top:14px">主题色</div>'));
    var sw = el('<div class="swatches"></div>');
    for (var i = 0; i < U.PALETTE.length; i++) {
      (function (p) {
        var node = el('<div class="swatch' + (ap.accent === p.hex ? ' active' : '')
          + '" title="' + p.name + '" style="background:' + p.hex + '"></div>');
        node.addEventListener('click', function () {
          ap.accent = p.hex; AR.Store.save(true); AR.UI.applyTheme();
          AR.Bridge.haptic('light', node);
          renderSettings();
        });
        sw.appendChild(node);
      })(U.PALETTE[i]);
    }
    box.appendChild(sw);
    box.appendChild(el('<div class="field-label" style="margin-top:14px">毛玻璃强度</div>'));
    box.appendChild(segmented([
      { label: '关闭', value: 'off' }, { label: '低', value: 'low' },
      { label: '中', value: 'medium' }, { label: '高', value: 'high' }
    ], ap.glassLevel, function (v) {
      ap.glassLevel = v; AR.Store.save(true); AR.UI.applyGlass();
      AR.Bridge.haptic('medium', $('settingsGrid'));
      renderSettings();
    }));
    box.appendChild(el('<div class="field-label" style="margin-top:14px">动画速度</div>'));
    box.appendChild(segmented([
      { label: '0.5×', value: 0.5 }, { label: '1×', value: 1 }, { label: '1.5×', value: 1.5 }
    ], ap.animationSpeed, function (v) {
      ap.animationSpeed = v; AR.Store.save(true); AR.UI.applyMotion();
      AR.Bridge.haptic('medium', $('settingsGrid'));
      renderSettings();
    }));
    box.appendChild(rowSwitch('震动反馈', '重要操作（保存 / 删除 / 导航 / 聚焦）触发震动', S.settings.haptics.enabled, function (v) {
      S.settings.haptics.enabled = v; AR.Store.save(true);
      if (v) { AR.Bridge.haptic('heavy', $('settingsGrid')); }
    }));
    box.appendChild(el('<div class="field-label" style="margin-top:12px">震动强度</div>'));
    box.appendChild(segmented([
      { label: '弱', value: 'weak' }, { label: '中', value: 'medium' }, { label: '强', value: 'strong' }
    ], S.settings.haptics.intensity, function (v) {
      S.settings.haptics.intensity = v; AR.Store.save(true);
      AR.Bridge.haptic('heavy', $('settingsGrid'));
      renderSettings();
    }));
    /**
     * 磁贴风格：一键把全局进出场动画换成"从点击处翻入"的磁贴翻转。
     * 开着的时候忽略逐场景的样式选择（但不会清掉它们），关掉就回到各自的选择。
     */
    if (AR.Motion) {
      box.appendChild(rowSwitch('磁贴风格（全局）',
        '',
        AR.Motion.tileMode(), function (v) {
          AR.Motion.setTileMode(v);
          AR.Bridge.haptic(v ? 'heavy' : 'medium', $('settingsGrid'));
          AR.UI.toast(v ? '已开启全局磁贴风格' : '已关闭磁贴风格，恢复逐场景设置');
          renderSettings();
          if (AR.UI.renderToday) { AR.UI.renderToday(); }
        }));
    }
    if (ap.devMode === true) { box.appendChild(devMotionBox()); }
    return panel('外观', box, 'appearance');
  }

  /* ── 开发者模式：逐场景挑选过渡动画 ───────────────────────── */

  /**
   * 每个场景一行：场景名 + 样式下拉 + 「试放」。
   * 样式表来自 AR.Motion（曲线、时长、位移、缩放、旋转、模糊都在里面描述），
   * 选中即生效并落盘，不用重启。
   */
  function devMotionBox() {
    var box = el('<div class="dev-motion"></div>');
    box.appendChild(el('<div class="dev-badge">开发者模式</div>'));
    box.appendChild(el('<p class="muted" style="margin:6px 0 10px">'
      + '长按左侧「外观」可退出。这里改的是全局过渡动画，改完立刻生效，'
      + '每个场景可以先「试放」看一眼。</p>'));

    var order = AR.Motion.order;
    for (var i = 0; i < order.length; i++) {
      (function (key) {
        var sc = AR.Motion.table[key];
        if (!sc) { return; }
        var cur = AR.Motion.get(key);
        var row = el('<div class="dev-row"><div class="dev-name">' + esc(sc.name) + '</div></div>');
        var sel = el('<select class="dev-select"></select>');
        for (var j = 0; j < sc.styles.length; j++) {
          var st = sc.styles[j];
          sel.appendChild(el('<option value="' + st.k + '"'
            + (cur && cur.k === st.k ? ' selected' : '') + '>' + esc(st.name) + '</option>'));
        }
        sel.addEventListener('change', function () {
          AR.Motion.set(key, sel.value);
          AR.Bridge.haptic('light', sel);
          AR.UI.toast(sc.name + ' → ' + sel.options[sel.selectedIndex].text);
        });
        row.appendChild(sel);
        var play = el('<button class="chip-btn" type="button">试放</button>');
        play.addEventListener('click', function () { previewMotion(key); });
        row.appendChild(play);
        box.appendChild(row);
      })(order[i]);
    }

    var foot = el('<div class="row gap" style="margin-top:12px"></div>');
    var reset = el('<button class="btn" type="button">全部恢复默认</button>');
    reset.addEventListener('click', function () {
      AR.Motion.reset();
      AR.Bridge.haptic('medium', reset);
      AR.UI.toast('过渡动画已恢复默认');
      renderSettings();
    });
    foot.appendChild(reset);
    box.appendChild(foot);

    /* ── 开发者工具：随时开关，关掉立刻恢复原样 ─────────────── */
    box.appendChild(el('<div class="dev-sub">开发者工具</div>'));
    var flags = AR.UI.devFlags();
    var tools = [
      { k: 'fps', t: '帧率悬浮窗', d: '左上角显示实时帧率，低于 50fps 会变红' },
      { k: 'ripple', t: '点按涟漪', d: '每次点按在落点画一个涟漪，检查热区与命中位置' },
      { k: 'grid', t: '8px 基线网格', d: '给整页铺一层淡网格，用来对齐间距' },
      { k: 'outline', t: '布局描边', d: '给所有盒子描一层边，看布局边界' },
      { k: 'slow', t: '动画慢放 0.25×', d: '把全局动画速度调到 1/4，逐帧看曲线' }
    ];
    for (var ti = 0; ti < tools.length; ti++) {
      (function (tool) {
        var on = (tool.k === 'slow')
          ? (Number(S.settings.appearance.animationSpeed) === 0.25)
          : (flags[tool.k] === true);
        box.appendChild(rowSwitch(tool.t, tool.d, on, function (v) {
          if (tool.k === 'slow') {
            S.settings.appearance.animationSpeed = v ? 0.25 : 1;
            AR.Store.save(true);
            AR.UI.applyMotion();
          } else {
            flags[tool.k] = v;
            AR.UI.devApply(true);
          }
          AR.Bridge.haptic('light', $('settingsGrid'));
        }));
      })(tools[ti]);
    }
    var dRow = el('<div class="row gap" style="margin-top:10px"></div>');
    var copyDiag = el('<button class="btn" type="button">复制诊断信息</button>');
    copyDiag.addEventListener('click', function () { AR.UI.devDiagnostics(); });
    var closeAll = el('<button class="btn" type="button">关闭全部开发者工具</button>');
    closeAll.addEventListener('click', function () {
      var f = AR.UI.devFlags();
      for (var k in f) { if (Object.prototype.hasOwnProperty.call(f, k)) { f[k] = false; } }
      S.settings.appearance.animationSpeed = 1;
      AR.Store.save(true);
      AR.UI.devApply(true);
      AR.UI.applyMotion();
      AR.Bridge.haptic('medium', closeAll);
      AR.UI.toast('开发者工具已全部关闭');
      renderSettings();
    });
    dRow.appendChild(copyDiag);
    dRow.appendChild(closeAll);
    box.appendChild(dRow);
    return box;
  }

  /** 试放：按场景挑一个最贴近的实时预览，不用真的去点那个界面 */
  function previewMotion(key) {
    var host = $('settingsBody') || document.body;
    if (key === 'zoneExpand' || key === 'zoneCollapse' || key === 'contentIn') {
      // 聚焦放大 / 缩小 / 内容浮入：直接让真正的今日页动一次，观感最准
      AR.UI.show('today');
      var zone = document.getElementById('zoneNext');
      if (zone && zone.classList.contains('expanded')) { zone.querySelector('.zone-toggle').click(); }
      setTimeout(function () { if (zone) { zone.click(); } }, 260);
      setTimeout(function () { if (zone && zone.classList.contains('expanded')) { zone.querySelector('.zone-toggle').click(); } }, 1200);
      return;
    }
    if (key === 'modalIn' || key === 'modalOut') {
      var card = el('<div class="dev-preview-card">弹窗动画预览</div>');
      host.appendChild(card);
      card.style.position = 'fixed';
      card.style.left = '50%'; card.style.top = '50%';
      card.style.marginLeft = '-110px'; card.style.marginTop = '-40px';
      AR.UI.popIn(card, 'in');
      setTimeout(function () {
        AR.UI.popIn(card, 'out');
        setTimeout(function () { if (card.parentNode) { card.parentNode.removeChild(card); } }, 420);
      }, 700);
      return;
    }
    if (key === 'viewIn') {
      var panel = host.querySelector('.set-section');
      if (panel) { AR.UI.enterRise(panel.parentNode || host); }
      return;
    }
    if (key === 'listIn') {
      var items = host.querySelectorAll('.set-section .row, .set-section .slider-row');
      if (items.length) {
        var wrap = items[0].parentNode;
        AR.UI.fadeInList(wrap, '.row, .slider-row');
      }
    }
  }

  /* 2 · 布局与尺寸（滑块 + 实时预览） */
  function panelLayout() {
    var box = el('<div></div>');
    // 只保留两种布局：左右（左上本周概览 / 左下今日日程 / 右最近的课）与上中下。
    // 旧的「自动」「左中右」在数据迁移里会统一折算成「左右」，直板机上也不会再被三栏挤压。
    var preset = S.settings.layout.preset;
    if (preset !== 'stacked-vertical') { preset = 'dual-horizontal'; }
    box.appendChild(segmented([
      { label: '左右', value: 'dual-horizontal' },
      { label: '上中下', value: 'stacked-vertical' }
    ], preset, function (v) {
      S.settings.layout.preset = v;
      AR.Store.save(true);
      AR.UI.setPreset(v, true);
      renderSettings();
    }));

    var preview = el('<div class="layout-preview" id="layoutPreview">'
      + '<div class="pv pv-week"><span>本周</span></div>'
      + '<div class="pv pv-today"><span>今日</span></div>'
      + '<div class="pv pv-next"><span>最近</span></div></div>');
    box.appendChild(preview);
    requestAnimationFrame(function () { drawPreview(); });

    var bp = AR.UI.breakpointKey(document.documentElement.clientWidth);
    var resolved = AR.UI.layoutState.preset;
    box.appendChild(el('<div class="muted" style="margin-bottom:8px">当前断点：'
      + (bp === 'wide' ? '宽屏' : (bp === 'medium' ? '中屏' : '窄屏')) + ' · 生效布局：' + presetName(resolved) + '</div>'));

    var week = AR.UI.sizeOf('week'), next = AR.UI.sizeOf('next');
    if (resolved === 'dual-horizontal') {
      box.appendChild(slider('右栏「最近的课」宽度', 28, 62, next.w, '%', function (v) {
        AR.UI.setSize('next', 'w', v); drawPreview();
      }));
      box.appendChild(slider('左上「本周概览」高度', 18, 46, week.h, '%', function (v) {
        AR.UI.setSize('week', 'h', v); drawPreview();
      }));
    } else {
      box.appendChild(slider('上栏「本周概览」高度', 14, 38, week.h, '%', function (v) {
        AR.UI.setSize('week', 'h', v); drawPreview();
      }));
      box.appendChild(slider('下栏「最近的课」高度', 14, 38, next.h, '%', function (v) {
        AR.UI.setSize('next', 'h', v); drawPreview();
      }));
    }
    box.appendChild(el('<p class="muted" style="margin-top:8px">'
      + '宽高都是「占屏幕的比例」，所以同一套设置在任意手机上都不会挤压错位；'
      + '尺寸按屏幕宽度分别记忆，不会互相覆盖。</p>'));

    var btns = el('<div class="row" style="margin-top:10px"><button class="btn" id="btnResetLayout">恢复默认</button></div>');
    btns.querySelector('#btnResetLayout').addEventListener('click', function () {
      var key = AR.UI.breakpointKey(document.documentElement.clientWidth);
      var defaults = AR.UI.defaultProfiles()[key];
      AR.UI.layoutState.profiles[key].week = { w: defaults.week.w, h: defaults.week.h };
      AR.UI.layoutState.profiles[key].next = { w: defaults.next.w, h: defaults.next.h };
      AR.UI.saveProfiles();
      AR.UI.applyLayout(true);
      AR.Bridge.haptic('medium', $('settingsGrid'));
      renderSettings();
    });
    box.appendChild(btns);
    return panel('布局与尺寸', box, 'layout');
  }

  function presetName(v) {
    return v === 'stacked-vertical' ? '上中下' : '左右';
  }

  /* 2b · 桌面卡片（5 种样式 + 添加教程） */
  function panelWidgets() {
    var box = el('<div></div>');
    var payload = (AR.WidgetData && AR.WidgetData.build) ? AR.WidgetData.build() : null;
    var p = payload || {};

    box.appendChild(el('<p class="muted">把课表放到手机桌面，不用打开 App 就能看。'
      + '数据只放在本机，卡片显示的永远是最新导入的课表。</p>'));

    var list = el('<div class="widget-list"></div>');

    // ① 今日头
    list.appendChild(widgetCard('今日头 · 4×1', '日期、周次、今天几节课一秒看完', 'w-head',
      '<div class="wg-line"><b>' + esc(p.dateText || '9月14日 周一') + '</b>'
      + '<span class="wg-chip">' + esc(p.todayBadge || '08:00') + '</span></div>'
      + '<div class="wg-sub">第 ' + (p.weekNo || 1) + ' 周 · ' + esc(p.todaySub || '今天没有课') + '</div>'));

    // ② 下一节课
    list.appendChild(widgetCard('下一节课 · 2×2', '课程、时间、地点、还有多久上课', 'w-next',
      '<div class="wg-line"><span class="wg-dim">' + esc(p.nextLabel || '下一节课') + '</span>'
      + '<span class="wg-chip">' + esc(p.nextIn || '') + '</span></div>'
      + '<div class="wg-title">' + esc(p.nextName || '最近没有安排') + '</div>'
      + '<div class="wg-sub">' + esc(p.nextTime || '导入课表后显示下一节课') + '</div>'
      + '<div class="wg-sub">' + esc(p.nextPlace || '') + '</div>'));

    // ③ 今日课程清单
    var rows = '';
    var today = p.today || [];
    for (var i = 0; i < Math.min(today.length, 3); i++) {
      rows += '<div class="wg-row"><i style="background:' + esc(today[i].color || '#5B8DEF') + '"></i>'
        + '<span class="wg-row-name">' + esc(today[i].name) + '</span>'
        + '<span class="wg-row-time">' + esc(today[i].time) + '</span></div>';
    }
    if (!rows) { rows = '<div class="wg-sub">今天没有课，好好休息 ☕</div>'; }
    list.appendChild(widgetCard('今日课程清单 · 4×2', '最多 4 条，上课地点一起看', 'w-today',
      '<div class="wg-line"><b>今天 · ' + esc(U.WEEKDAY_NAMES[U.weekdayOf(new Date())]) + '</b>'
      + '<span class="wg-dim">' + today.length + ' 节课</span></div>' + rows));

    // ④ 本周迷你课表
    var grid = '';
    var cells = {};
    var wk = p.week || [];
    for (var c = 0; c < wk.length; c++) {
      for (var r = Math.max(1, wk[c].s); r <= Math.max(wk[c].s, Math.min(wk[c].e, 6)); r++) {
        cells[r + '_' + wk[c].d] = wk[c].color || '#5B8DEF';
      }
    }
    for (var rr = 1; rr <= 5; rr++) {
      grid += '<div class="wg-grid-row">';
      for (var dd = 1; dd <= 7; dd++) {
        var col = cells[rr + '_' + dd];
        grid += '<span class="wg-cell"' + (col ? ' style="background:' + esc(col) + '"' : '') + '></span>';
      }
      grid += '</div>';
    }
    list.appendChild(widgetCard('本周迷你课表 · 4×3', '日期在上、节次在左，和「周表」同构', 'w-week',
      '<div class="wg-line"><b>第 ' + (p.weekNo || 1) + ' 周</b><span class="wg-dim">'
      + esc(p.weekRange || '') + '</span></div>'
      + '<div class="wg-grid-head">' + (p.dates || ['一', '二', '三', '四', '五', '六', '日'])
        .map(function (d) { return '<span>' + esc(d) + '</span>'; }).join('') + '</div>'
      + grid));

    // ⑤ 快捷入口
    list.appendChild(widgetCard('快捷入口 · 4×1', '今日 / 周表 / 导入 / 设置，一键直达', 'w-shortcut',
      '<div class="wg-line"><b>' + esc(p.dateText || '今天') + '</b></div>'
      + '<div class="wg-btns"><span>今日</span><span>周表</span><span>导入</span><span>设置</span></div>'));

    box.appendChild(list);

    var tips = el('<div class="widget-tips">'
      + '<b>怎么加到桌面</b>'
      + '<ol class="steps"><li>回到手机桌面，长按空白处 → 选择「卡片 / 小组件」。</li>'
      + '<li>在列表里找到 <b>Abbey Road</b>，就能看到上面这 5 种样式。</li>'
      + '<li>拖到桌面上即可；长按卡片还能调整大小（2×2 / 4×2 / 4×3 都支持）。</li></ol>'
      + '<p class="muted">ColorOS / 一加：长按桌面空白处 → 左上角「+ 卡片」→ 找到 Abbey Road。'
      + '如果找不到，先随便打开一次 App（卡片数据会在打开时刷新）。</p></div>');
    box.appendChild(tips);

    var row = el('<div class="row gap" style="margin-top:10px">'
      + '<button class="btn primary" type="button" id="btnWidgetSync">立即刷新卡片数据</button></div>');
    row.querySelector('#btnWidgetSync').addEventListener('click', function () {
      if (AR.WidgetData && AR.WidgetData.sync) { AR.WidgetData.sync(true); }
      AR.Bridge.haptic('medium', row);
      AR.UI.toast('已把最新课表同步给桌面卡片');
    });
    box.appendChild(row);
    return panel('桌面卡片', box, 'widgets');
  }

  function widgetCard(title, sub, cls, inner) {
    var node = el('<div class="widget-preview ' + cls + '">'
      + '<div class="wp-head"><span class="wp-title">' + esc(title) + '</span>'
      + '<span class="wp-sub">' + esc(sub) + '</span></div>'
      + '<div class="wp-body">' + inner + '</div></div>');
    return node;
  }

  function slider(label, min, max, value, unit, onInput) {
    var node = el('<div class="slider-row"><div class="lbl">' + esc(label) + '</div>'
      + '<input type="range" min="' + min + '" max="' + max + '" step="1" value="' + value + '">'
      + '<div class="val">' + value + unit + '</div></div>');
    var range = node.querySelector('input');
    var val = node.querySelector('.val');
    range.addEventListener('input', function () {
      val.textContent = range.value + unit;
      onInput(Number(range.value));
    });
    range.addEventListener('change', function () { AR.Bridge.haptic('light', node); });
    return node;
  }

  /** 设置页里的实时预览（不重排真实界面） */
  function drawPreview() {
    var box = $('layoutPreview');
    if (!box) { return; }
    var st = AR.UI.layoutState;
    var preset = st.preset === 'stacked-vertical' ? 'stacked-vertical' : 'dual-horizontal';
    var W = box.clientWidth, H = box.clientHeight, gap = 4;
    var week = AR.UI.sizeOf('week'), next = AR.UI.sizeOf('next');
    var a, b, c;
    if (preset === 'dual-horizontal') {
      var wNext2 = Math.max(24, Math.min(W * next.w / 100, W * 0.7));
      var hWeek = Math.max(16, Math.min(H * week.h / 100, H * 0.6));
      a = { l: 0, t: 0, w: W - wNext2 - gap, h: hWeek };
      b = { l: 0, t: hWeek + gap, w: W - wNext2 - gap, h: H - hWeek - gap };
      c = { l: W - wNext2, t: 0, w: wNext2, h: H };
    } else {
      var hWeek3 = Math.max(14, Math.min(H * week.h / 100, H * 0.45));
      var hNext3 = Math.max(14, Math.min(H * next.h / 100, H * 0.45));
      a = { l: 0, t: 0, w: W, h: hWeek3 };
      b = { l: 0, t: hWeek3 + gap, w: W, h: H - hWeek3 - hNext3 - gap * 2 };
      c = { l: 0, t: H - hNext3, w: W, h: hNext3 };
    }
    setPreview('pv-week', a);
    setPreview('pv-today', b);
    setPreview('pv-next', c);
  }

  function setPreview(cls, box) {
    var node = document.querySelector('.' + cls);
    if (!node) { return; }
    node.style.left = box.l + 'px';
    node.style.top = box.t + 'px';
    node.style.width = Math.max(box.w, 12) + 'px';
    node.style.height = Math.max(box.h, 12) + 'px';
  }

  /* 3 · 课程与课表 */
  function panelSchedule() {
    var sem = AR.Store.currentSemester();
    var box = el('<div></div>');
    var na = S.settings.nextAlert || (S.settings.nextAlert = {
      enabled: true, nearMin: 15, soonMin: 30, thickBorder: true,
      colors: { near: '#E5484D', soon: '#D9A22B', live: '#5B8DEF' }
    });
    if (!sem) {
      box.appendChild(el('<p class="muted">还没有学期数据，导入课表后会自动创建。</p>'));
      return panel('课程与课表', box, 'schedule');
    }
    box.appendChild(el('<div class="field"><label class="field-label">学期名称</label>'
      + '<input class="input" id="semName" value="' + esc(sem.name) + '"></div>'));
    box.appendChild(el('<div class="field"><label class="field-label">开学第一周周一</label>'
      + '<input class="input" id="semStart" type="date" value="' + esc(sem.startDate) + '"></div>'));
    box.appendChild(el('<div class="field"><label class="field-label">总周数</label>'
      + '<input class="input" id="semWeeks" type="number" min="1" max="30" value="' + (sem.weekCount || 20) + '"></div>'));
    var wk = AR.Schedule.weekNumber(new Date(), sem);
    box.appendChild(el('<p class="muted">今天：' + U.dateKey(new Date()) + ' · 当前第 ' + Math.max(wk, 1) + ' 周'
      + (wk < 1 ? '（学期还没开始）' : (wk > sem.weekCount ? '（学期已结束）' : '')) + '</p>'));
    box.appendChild(rowSwitch('周表页显示月视图', '打开后周表页顶部多一个「周视图 / 月视图」开关，可以按整月看课',
      !(S.settings.schedule && S.settings.schedule.weekMonthView === false), function (v) {
        S.settings.schedule.weekMonthView = v;
        AR.Store.save(true);
        AR.UI.renderWeek();
        renderSettings();
      }));

    /**
     * 课程配色：课表里是"彩色底 + 白字"，所以预置方案里的颜色都压过亮度，
     * 保证白字读得清；同一类型的课取同一色系、靠深浅区分。
     */
    if (AR.Palette) {
      var schemeNow = (S.settings.schedule && S.settings.schedule.colorScheme) || 'classic';
      box.appendChild(el('<div class="field-label" style="margin-top:14px">课程配色方案</div>'));
      box.appendChild(segmented(AR.Palette.schemeList().map(function (s) {
        return { label: s.name.replace('（默认）', ''), value: s.key };
      }), schemeNow, function (v) {
        S.settings.schedule.colorScheme = v;
        AR.Store.save(true);
        renderSettings();
      }));
      var desc = AR.Palette.schemes[schemeNow];
      box.appendChild(el('<p class="muted" style="margin:8px 0 0">' + esc(desc ? desc.desc : '') + '</p>'));
      var pv = el('<div class="scheme-preview"></div>');
      var demo = AR.Palette.schemes.tracks.map;
      var showList = desc && desc.map ? desc.map : demo;
      ['science', 'arts', 'general', 'pe', 'water'].forEach(function (tk) {
        var arr = showList[tk] || [];
        for (var i = 0; i < Math.min(arr.length, 2); i++) {
          pv.appendChild(el('<i style="background:' + arr[i] + '"></i>'));
        }
      });
      box.appendChild(pv);
      var applyRow = el('<div class="row gap" style="margin-top:10px"></div>');
      var applyBtn = el('<button class="btn primary" type="button">按这个方案重排全部课程颜色</button>');
      applyBtn.addEventListener('click', function () {
        var res = AR.Palette.applyScheme(schemeNow);
        AR.Bridge.haptic('medium', applyBtn);
        if (!res.ok) { AR.UI.toast(res.message || '应用失败'); return; }
        var parts = [];
        for (var tk in res.stats) {
          if (Object.prototype.hasOwnProperty.call(res.stats, tk)) {
            parts.push(AR.Palette.trackLabel(tk) + ' ' + res.stats[tk]);
          }
        }
        AR.UI.toast('已重排 ' + res.changed + ' 门课的颜色' + (parts.length ? '（' + parts.join(' · ') + '）' : ''));
        AR.UI.renderToday();
        AR.UI.renderWeek();
        renderSettings();
      });
      applyRow.appendChild(applyBtn);
      box.appendChild(applyRow);
      box.appendChild(el('<p class="muted" style="margin-top:8px">类型按课程名自动识别（数学/物理→理科，'
        + '文学/历史→文科，思政/通识→公共，体育→体育）；「水课」请在课程编辑器里手动指定。</p>'));
    }

    box.appendChild(el('<div class="field-label" style="margin-top:14px">连堂课自动合并</div>'));
    box.appendChild(segmented([
      { label: '自动合并', value: 'auto' }, { label: '从不合并', value: 'never' }
    ], S.settings.schedule.autoMergeConsecutive || 'auto', function (v) {
      S.settings.schedule.autoMergeConsecutive = v; AR.Store.save(true);
      AR.Bridge.haptic('medium', $('settingsGrid'));
      renderSettings();
    }));

    /* 「最近的课」按时间切状态色：阈值与颜色都能改 */
    box.appendChild(el('<div class="field-label" style="margin-top:16px">「最近的课」状态色</div>'));
    box.appendChild(rowSwitch('按离上课时间变色', '越接近上课，卡片边框越醒目；不满足条件时用课程原色',
      na.enabled !== false, function (v) {
        na.enabled = v; AR.Store.save(true);
        AR.UI.renderToday();
        renderSettings();
      }));
    if (na.enabled !== false) {
      box.appendChild(el('<div class="field-label" style="margin-top:10px">马上上课（分钟以内，红色档）</div>'));
      box.appendChild(slider('距上课', 1, 60, na.nearMin || 15, ' 分钟', function (v) {
        na.nearMin = Math.min(v, na.soonMin || 30); AR.Store.save(); AR.UI.renderToday();
      }));
      box.appendChild(el('<div class="field-label" style="margin-top:6px">即将上课（分钟以内，黄色档）</div>'));
      box.appendChild(slider('距上课', 2, 180, na.soonMin || 30, ' 分钟', function (v) {
        na.soonMin = Math.max(v, na.nearMin || 15); AR.Store.save(); AR.UI.renderToday();
      }));
      var colorRows = [
        { key: 'near', label: '马上上课（默认红）' },
        { key: 'soon', label: '即将上课（默认黄）' },
        { key: 'live', label: '正在上课（默认蓝）' }
      ];
      for (var cr = 0; cr < colorRows.length; cr++) {
        (function (row) {
          box.appendChild(el('<div class="field-label" style="margin-top:10px">' + row.label + '</div>'));
          var sw = el('<div class="swatches"></div>');
          for (var pi = 0; pi < U.PALETTE.length; pi++) {
            (function (p) {
              var node = el('<div class="swatch' + (na.colors[row.key] === p.hex ? ' active' : '')
                + '" title="' + p.name + '" style="background:' + p.hex + '"></div>');
              node.addEventListener('click', function () {
                na.colors[row.key] = p.hex;
                AR.Store.save(true);
                AR.Bridge.haptic('light', node);
                AR.UI.renderToday();
                renderSettings();
              });
              sw.appendChild(node);
            })(U.PALETTE[pi]);
          }
          box.appendChild(sw);
        })(colorRows[cr]);
      }
      box.appendChild(rowSwitch('状态色加粗边框', '红 / 黄 / 蓝三档把卡片边框加粗到 2px',
        na.thickBorder !== false, function (v) {
          na.thickBorder = v; AR.Store.save(true); AR.UI.renderToday(); renderSettings();
        }));
    }

    box.appendChild(el('<div class="field-label" style="margin-top:14px">节次作息</div>'));
    var periods = AR.Store.periodsOf(sem.id);
    var list = el('<div></div>');
    for (var i = 0; i < periods.length; i++) {
      (function (p) {
        var node = el('<div class="period-grid" style="margin-bottom:6px">'
          + '<div class="muted">第 ' + p.index + ' 节</div>'
          + '<input class="input input-sm" data-f="start" value="' + esc(p.start) + '">'
          + '<input class="input input-sm" data-f="end" value="' + esc(p.end) + '">'
          + '<button class="icon-btn" type="button" title="删除">✕</button></div>');
        var ins = node.querySelectorAll('input');
        for (var k = 0; k < ins.length; k++) {
          ins[k].addEventListener('change', function () {
            p.start = node.querySelector('[data-f="start"]').value;
            p.end = node.querySelector('[data-f="end"]').value;
            p.updatedAt = new Date().toISOString();
            AR.Store.save(true);
            AR.UI.renderToday();
            AR.UI.renderWeek();
            AR.Bridge.haptic('medium', node);
          });
        }
        node.querySelector('.icon-btn').addEventListener('click', function () {
          S.periods = S.periods.filter(function (x) { return x.id !== p.id; });
          AR.Store.save(true);
          renderSettings();
          AR.Bridge.haptic('warn', node);
        });
        list.appendChild(node);
      })(periods[i]);
    }
    box.appendChild(list);
    var addBtn = el('<button class="btn" type="button">＋ 增加一节</button>');
    addBtn.addEventListener('click', function () {
      var maxIdx = 0;
      for (var i = 0; i < S.periods.length; i++) { if (S.periods[i].index > maxIdx) { maxIdx = S.periods[i].index; } }
      S.periods.push({
        id: U.uid(), semesterId: sem.id, index: maxIdx + 1, label: '第' + (maxIdx + 1) + '节',
        start: '08:00', end: '08:45', updatedAt: new Date().toISOString()
      });
      AR.Store.save(true);
      renderSettings();
      AR.Bridge.haptic('medium', addBtn);
    });
    box.appendChild(el('<div style="margin-top:10px"></div>')).appendChild(addBtn);

    var save = el('<div class="row end" style="margin-top:12px"><button class="btn primary" type="button">保存学期设置</button></div>');
    save.querySelector('button').addEventListener('click', function () {
      sem.name = $('semName').value || sem.name;
      sem.startDate = $('semStart').value || sem.startDate;
      sem.weekCount = Number($('semWeeks').value) || sem.weekCount;
      sem.updatedAt = new Date().toISOString();
      AR.Store.save(true);
      AR.Bridge.haptic('medium', save);
      renderSettings();
      refreshAll();
      AR.UI.toast('学期设置已保存');
    });
    box.appendChild(save);
    return panel('课程与课表', box, 'schedule');
  }

  /* 4 · 提醒与通知 */
  function panelNotify() {
    var box = el('<div></div>');
    var n = S.settings.notifications;
    box.appendChild(rowSwitch('课前提醒', '在每节课开始前提醒（需要系统通知权限）', n.enabled, function (v) {
      n.enabled = v; AR.Store.save(true);
    }));
    box.appendChild(el('<div class="field-label" style="margin-top:12px">提前量</div>'));
    box.appendChild(slider('提前分钟', 5, 60, n.defaultOffset || 15, ' 分', function (v) {
      n.defaultOffset = v; AR.Store.save();
    }));
    box.appendChild(el('<p class="muted">提醒依赖系统日历 / 通知；在 OPPO 等机型上需要在系统设置里允许后台运行。</p>'));
    return panel('提醒与通知', box, 'notify');
  }

  /* 5 · 导入与同步 */
  function panelSync() {
    var box = el('<div></div>');
    box.appendChild(el('<p class="muted">导出一份配置文件，在另一台设备上导入即可同步。App 会在合并前给出预览，'
      + '冲突逐条确认，并在应用前自动保留一份备份。</p>'));
    var row = el('<div class="row gap"><button class="btn primary" type="button" id="stExport">导出配置文件</button>'
      + '<button class="btn" type="button" id="stWechat">导出到微信</button>'
      + '<button class="btn" type="button" id="stImport">导入配置文件</button>'
      + '<button class="btn" type="button" id="stFromExports">从导出目录导入</button>'
      + '<button class="btn" type="button" id="stCopy">复制配置文本</button></div>');
    box.appendChild(row);
    row.querySelector('#stExport').addEventListener('click', function () {
      AR.UI.show('import');
      setTimeout(function () { document.querySelector('[data-tab="json"]').click(); $('btnExportJson').click(); }, 120);
    });
    row.querySelector('#stImport').addEventListener('click', function () {
      AR.UI.show('import');
      setTimeout(function () { document.querySelector('[data-tab="json"]').click(); $('btnImportJson').click(); }, 120);
    });
    row.querySelector('#stWechat').addEventListener('click', function () {
      AR.ConfigIO.exportToApp(row.querySelector('#stWechat'));
    });
    row.querySelector('#stFromExports').addEventListener('click', function () {
      AR.UI.show('import');
      setTimeout(function () { document.querySelector('[data-tab="json"]').click(); AR.ConfigIO.openFromExports(); }, 140);
    });
    row.querySelector('#stCopy').addEventListener('click', function () {
      AR.ConfigIO.copyText(row.querySelector('#stCopy'));
    });
    box.appendChild(el('<p class="muted">上次导出：' + (S.exportedAt ? esc(S.exportedAt.replace('T', ' ').slice(0, 16)) : '还没导出过')
      + ' · 提示词版本 ' + esc(AR.Prompt.version) + '</p>'));
    return panel('导入与同步', box, 'sync');
  }

  /* 6 · 系统集成 */
  function panelIntegration() {
    var box = el('<div></div>');
    var it = S.settings.integration;
    box.appendChild(el('<div class="field"><label class="field-label">大学名称</label>'
      + '<input class="input" id="uniName" value="' + esc(it.university) + '" placeholder="例如：XX大学"></div>'));
    box.appendChild(el('<div class="field"><label class="field-label">默认校区</label>'
      + '<input class="input" id="uniCampus" value="' + esc(it.campus) + '" placeholder="例如：东校区"></div>'));
    box.appendChild(el('<div class="field"><label class="field-label">所在城市</label>'
      + '<input class="input" id="uniCity" value="' + esc(it.city) + '" placeholder="例如：北京市"></div>'));
    box.appendChild(el('<div class="field-label">导航偏好</div>'));
    box.appendChild(segmented([
      { label: '系统地图', value: 'system' }, { label: '高德', value: 'amap' }, { label: '百度', value: 'baidu' }
    ], it.navApp, function (v) {
      it.navApp = v; AR.Store.save(true);
      AR.Bridge.haptic('medium', $('settingsGrid'));
      renderSettings();
    }));
    box.appendChild(rowSwitch('裁剪教室号', '导航时去掉「305教室」这类细节', it.trimRoom, function (v) {
      it.trimRoom = v; AR.Store.save(true); renderSettings();
    }));
    box.appendChild(rowSwitch('缺大学名时自动补全', '「信息楼305」→「XX大学 信息楼」', it.autoPrependUniversity, function (v) {
      it.autoPrependUniversity = v; AR.Store.save(true); renderSettings();
    }));
    box.appendChild(rowSwitch('线上课程不导航', '腾讯会议 / 钉钉等改为复制信息', it.onlineTreatAsNoNav, function (v) {
      it.onlineTreatAsNoNav = v; AR.Store.save(true); renderSettings();
    }));

    // 实时示例
    var sampleRaw = 'XX大学 信息楼 305教室';
    var nav = AR.Location.navQuery(sampleRaw, S.settings);
    box.appendChild(el('<div class="list-item" style="margin-top:10px"><span class="code-badge">示例</span>'
      + '<span class="msg">' + esc(sampleRaw) + ' → <b>' + esc(nav.trimmed) + '</b></span></div>'));

    var save = el('<div class="row end" style="margin-top:12px"><button class="btn primary" type="button">保存</button></div>');
    save.querySelector('button').addEventListener('click', function () {
      it.university = $('uniName').value;
      it.campus = $('uniCampus').value;
      it.city = $('uniCity').value;
      AR.Store.save(true);
      AR.Bridge.haptic('medium', save);
      renderSettings();
      AR.UI.toast('系统集成设置已保存');
    });
    box.appendChild(save);
    return panel('系统集成', box, 'integration');
  }

  /* 7 · 数据与备份 */
  function panelData() {
    var box = el('<div></div>');
    var size = 0;
    try { size = (JSON.stringify(S).length / 1024).toFixed(1); } catch (e) { }
    box.appendChild(el('<p class="muted">课程 ' + S.courses.length + ' 门 · 时段 ' + S.blocks.length
      + ' 条 · 变动 ' + S.overrides.length + ' 条 · 数据量约 ' + size + ' KB（只存在本机）</p>'));
    var row = el('<div class="row gap">'
      + '<button class="btn" type="button" id="stDemo">载入演示课表</button>'
      + '<button class="btn" type="button" id="stBackup">导出备份</button>'
      + '<button class="btn" type="button" id="stBackupWechat">导出到微信</button>'
      + '<button class="btn danger" type="button" id="stReset">清空所有数据</button></div>');
    box.appendChild(row);
    row.querySelector('#stDemo').addEventListener('click', function () {
      var ent = AR.MdParse.demoEntities(S);
      AR.MdParse.applyEntities(ent, S);
      AR.Bridge.haptic('medium', row);
      refreshAll();
      AR.UI.toast('已载入演示课表');
    });
    row.querySelector('#stBackup').addEventListener('click', function () {
      AR.ConfigIO.exportFile(row.querySelector('#stBackup'));
    });
    row.querySelector('#stBackupWechat').addEventListener('click', function () {
      AR.ConfigIO.exportToApp(row.querySelector('#stBackupWechat'));
    });
    row.querySelector('#stReset').addEventListener('click', function () { openResetHoldModal(); });
    return panel('数据与备份', box, 'data');
  }

  /**
   * 清空所有数据：二道确认 —— 必须**按住 3 秒**才会执行，中途松手立刻取消。
   * （单击不行、连点也不行，避免误触把课表清掉。）
   */
  function openResetHoldModal() {
    var HOLD_MS = 3000;
    var body = el('<div>'
      + '<p class="muted">清空后课程、作息、设置都会恢复初始状态，且无法撤销。'
      + '建议先在「导入与同步」里导出一份配置文件再操作。</p>'
      + '<button class="hold-btn" type="button" id="resetHold">'
      + '<span class="hold-fill"></span><span class="hold-label">按住 3 秒清空</span></button>'
      + '<p class="muted" id="resetHoldTip">按住不放，进度条走满才会执行；中途松手自动取消。</p>'
      + '</div>');
    AR.UI.openModal({
      title: '清空所有数据？', sub: '需要长按 3 秒二次确认',
      body: body,
      actions: [{ label: '取消', onClick: function (c) { c(); } }]
    });

    var btn = $('resetHold');
    var label = btn.querySelector('.hold-label');
    var tip = body.querySelector('#resetHoldTip');
    var raf = null;
    var startAt = 0;
    var fired = false;

    function paint(p) {
      btn.style.setProperty('--hold', (p * 100).toFixed(1) + '%');
      var left = Math.max(0, Math.ceil((HOLD_MS * (1 - p)) / 1000));
      label.textContent = p >= 1 ? '正在清空…' : ('按住 3 秒清空' + (p > 0 ? '（' + left + '）' : ''));
    }
    function tick() {
      var p = Math.min(1, (Date.now() - startAt) / HOLD_MS);
      paint(p);
      if (p >= 1) {
        if (!fired) { fired = true; doReset(); }
        return;
      }
      raf = requestAnimationFrame(tick);
    }
    function start(ev) {
      if (fired) { return; }
      if (ev && ev.preventDefault) { ev.preventDefault(); }
      startAt = Date.now();
      btn.classList.add('holding');
      if (tip) { tip.textContent = '松开就会取消，坚持按住 3 秒…'; }
      if (raf) { cancelAnimationFrame(raf); }
      raf = requestAnimationFrame(tick);
      AR.Bridge.haptic('light', btn);
    }
    function stop() {
      if (fired) { return; }
      if (raf) { cancelAnimationFrame(raf); raf = null; }
      btn.classList.remove('holding');
      paint(0);
      if (tip) { tip.textContent = '已取消，数据没有变动。可以再按住 3 秒重新确认。'; }
    }
    function doReset() {
      btn.classList.remove('holding');
      paint(1);
      AR.Bridge.haptic('warn', btn);
      AR.Store.reset(true);
      AR.UI.applyTheme(); AR.UI.applyGlass(); AR.UI.applyMotion();
      AR.UI.closeModal();
      renderSettings();
      refreshAll();
      AR.UI.toast('已清空所有数据');
    }

    btn.addEventListener('pointerdown', start);
    btn.addEventListener('pointerup', stop);
    btn.addEventListener('pointerleave', stop);
    btn.addEventListener('pointercancel', stop);
    // 老 WebView 兜底：没有 Pointer Events 时用 touch/mouse
    if (!window.PointerEvent) {
      btn.addEventListener('touchstart', start);
      btn.addEventListener('touchend', stop);
      btn.addEventListener('touchcancel', stop);
      btn.addEventListener('mousedown', start);
      btn.addEventListener('mouseup', stop);
      btn.addEventListener('mouseleave', stop);
    }
    // 键盘可达性：空格/回车按住也算
    btn.addEventListener('keydown', function (ev) { if ((ev.key === ' ' || ev.key === 'Enter') && !fired && !raf) { start(ev); } });
    btn.addEventListener('keyup', function (ev) { if (ev.key === ' ' || ev.key === 'Enter') { stop(); } });
  }

  /* 8 · 关于与帮助 */
  function panelAbout() {
    var box = el('<div></div>');
    var plat = AR.Bridge.platform();
    box.appendChild(el('<p class="muted">Abbey Road v' + AR.Const.APP_VERSION + ' · '
      + (plat === 'android' ? 'Android' : (plat === 'windows' ? 'Windows' : '浏览器预览'))
      + (AR.Bridge.deviceName() ? ' · ' + esc(AR.Bridge.deviceName()) : '')
      + (AR.Bridge.sdkInt() ? ' · API ' + AR.Bridge.sdkInt() : '') + '</p>'));
    box.appendChild(el('<p class="muted">数据格式 v' + AR.Const.SCHEMA_VERSION
      + ' · 导入格式 ' + AR.MdParse.PARSE_VERSION + ' · 提示词 ' + AR.Prompt.version + '</p>'));
    var row = el('<div class="row gap">'
      + '<button class="btn" type="button" id="stOnboarding">重新观看引导</button>'
      + '<button class="btn" type="button" id="stPrompt">查看固定提示词</button></div>');
    box.appendChild(row);
    row.querySelector('#stOnboarding').addEventListener('click', function () { AR.Panels.startOnboarding(true); });
    row.querySelector('#stPrompt').addEventListener('click', function () {
      AR.UI.show('import');
      setTimeout(function () { document.querySelector('[data-tab="prompt"]').click(); }, 100);
    });

    /**
     * 开源地址：项目已发布在 GitHub，这里给一个可点的入口
     * （Android 交给系统浏览器，Windows 交给默认浏览器）。
     */
    var REPO_URL = 'https://github.com/EtoileZzz/AbbeyRoad----ScheduleApp';
    var repoBox = el('<div class="repo-box">'
      + '<div class="repo-title">项目已开源</div>'
      + '<div class="repo-url">' + esc(REPO_URL) + '</div>'
      + '<div class="row gap" style="margin-top:10px">'
      + '<button class="btn primary" type="button" id="stRepo">在浏览器中打开</button>'
      + '<button class="btn" type="button" id="stRepoCopy">复制地址</button></div></div>');
    box.appendChild(repoBox);
    repoBox.querySelector('#stRepo').addEventListener('click', function () {
      AR.Bridge.haptic('light', repoBox.querySelector('#stRepo'));
      AR.Bridge.openUrl(REPO_URL);
    });
    repoBox.querySelector('#stRepoCopy').addEventListener('click', function () {
      AR.Bridge.copy(REPO_URL);
    });
    // 地址本身也可以直接点
    repoBox.querySelector('.repo-url').addEventListener('click', function () {
      AR.Bridge.haptic('light', repoBox);
      AR.Bridge.openUrl(REPO_URL);
    });

    box.appendChild(el('<p class="muted" style="margin-top:10px">本应用不联网、不收集数据；'
      + '所有内容保存在本机，导出的配置文件和备份由你自己保管。</p>'));
    return panel('关于与帮助', box, 'about');
  }

  /* ══════════════════════════ 首次引导 ══════════════════════════ */

  var obStep = 0;
  var OB_STEPS = 6;

  function startOnboarding(force) {
    ensure();
    if (!force && S.settings.onboardingCompletedAt) { return; }
    obStep = 0;
    $('onboarding').hidden = false;
    renderOnboarding();
    // 和弹窗用同一套进场动画（同一个关键帧 / 曲线 / 时长）
    if (AR.UI.popIn) { AR.UI.popIn($('obCard'), 'in'); }
  }

  function renderOnboarding() {
    var card = $('obCard');
    card.innerHTML = '';
    var html = obStepHtml(obStep);

    var dots = '<div class="ob-dots">';
    for (var i = 0; i < OB_STEPS; i++) { dots += '<i class="' + (i === obStep ? 'on' : '') + '"></i>'; }
    dots += '</div>';

    // 底部操作条固定在卡片右下角（内容再长也不用滚到底才能点「下一步」）
    var foot = '<div class="ob-foot">' + dots
      + '<div class="ob-actions">'
      + (obStep > 0 ? '<button class="btn" type="button" id="obPrev">上一步</button>' : '')
      + '<button class="btn primary" type="button" id="obNext">' + (obStep === OB_STEPS - 1 ? '开始使用' : '下一步') + '</button>'
      + '</div></div>';

    card.innerHTML = '<div class="ob-scroll">' + html + '</div>' + foot;
    bindOnboarding();
  }

  /** 每一步的正文：说清楚"是什么、怎么用"，一句话一件事 */
  function obStepHtml(step) {
    if (step === 0) {
      return '<h2 class="ob-step-title">欢迎使用 Abbey Road</h2>'
        + '<p class="ob-step-sub">本地优先的课表与日程管理。数据只保存在你自己的设备上：'
        + '没有账号、也没有云同步，换设备时导出一份配置文件带过去就行。</p>'
        + '<div class="ob-features">'
        + '<div class="ob-feature"><div class="icon">📅</div><div class="t">今日一屏</div><div class="d">本周概览、今日日程、最近的课，每一块点击都会放大看详情</div></div>'
        + '<div class="ob-feature"><div class="icon">🤖</div><div class="t">AI 帮你排课</div><div class="d">复制固定提示词，交给 DeepSeek / 豆包整理，再把结果粘回来</div></div>'
        + '<div class="ob-feature"><div class="icon">🧭</div><div class="t">一键导航</div><div class="d">自动去掉教室号、补上大学名，直接跳到地图或导航 App</div></div>'
        + '<div class="ob-feature"><div class="icon">🔔</div><div class="t">系统日历与闹钟</div><div class="d">把课程写进手机自带的日历、时钟，按时提醒</div></div>'
        + '</div>';
    }
    if (step === 1) {
      return '<h2 class="ob-step-title">四个入口</h2>'
        + '<p class="ob-step-sub">手机上在底部、电脑上在左侧，切换页面用的都是下面这四个按钮。</p>'
        + '<div class="ob-features">'
        + '<div class="ob-feature"><div class="icon">🕘</div><div class="t">今日</div><div class="d">点任意一块放大；再点位置 / 时间 / 老师 / 备注，弹出毛玻璃详情窗</div></div>'
        + '<div class="ob-feature"><div class="icon">🗓</div><div class="t">周表</div><div class="d">一整周的课表，可切换周次与月视图，自动检测时间冲突</div></div>'
        + '<div class="ob-feature"><div class="icon">📥</div><div class="t">导入</div><div class="d">粘贴 AI 整理好的课表文本、手动添加课程、导入配置文件</div></div>'
        + '<div class="ob-feature"><div class="icon">⚙️</div><div class="t">设置</div><div class="d">外观、布局与尺寸、课程与课表、提醒、系统集成、数据备份</div></div>'
        + '</div>';
    }
    if (step === 2) {
      return '<h2 class="ob-step-title">先填三项基本信息</h2>'
        + '<p class="ob-step-sub">这三项决定「今天是第几周」和导航能不能用；之后随时可以在设置里修改。</p>'
        + '<div class="field"><label class="field-label">大学名称</label>'
        + '<input class="input" id="obUni" value="' + esc(S.settings.integration.university) + '" placeholder="例如：XX大学"></div>'
        + '<div class="field"><label class="field-label">所在城市</label>'
        + '<input class="input" id="obCity" value="' + esc(S.settings.integration.city) + '" placeholder="例如：北京市"></div>'
        + '<div class="field"><label class="field-label">开学第一周周一</label>'
        + '<input class="input" id="obStart" type="date" value="' + esc(AR.Store.currentSemester().startDate) + '"></div>';
    }
    if (step === 3) {
      return '<h2 class="ob-step-title">选一个顺手的布局</h2>'
        + '<p class="ob-step-sub">点一下先试试效果；宽高也能在「设置 → 布局与尺寸」里用滑块微调。</p>'
        + '<div class="preset-cards" id="obPresets">'
        + presetCard('dual-horizontal', '左右', '左上是本周概览、左下是今日日程，右边是最近的课（推荐）')
        + presetCard('stacked-vertical', '上中下', '从上到下依次是本周概览、今日日程、最近的课')
        + '</div>'
        + '<div class="layout-preview" style="height:110px;margin-top:14px" id="obPreview">'
        + '<div class="pv pv-week"><span>本周</span></div><div class="pv pv-today"><span>今日</span></div>'
        + '<div class="pv pv-next"><span>最近</span></div></div>';
    }
    if (step === 4) {
      return '<h2 class="ob-step-title">把课表装进来</h2>'
        + '<p class="ob-step-sub">最省事的流程：复制提示词 → 连同课表截图发给手机上的 AI → '
        + '把 AI 的完整回复粘贴到「导入 → 课表文本」→ 点右下角「应用到课表」。</p>'
        + '<div class="mini-nav">'
        + '<button class="btn primary" type="button" id="obCopyPrompt">复制提示词</button>'
        + '<button class="btn" type="button" id="obGoImport">去导入页</button>'
        + '<button class="btn" type="button" id="obDemo">先看演示课表</button>'
        + '</div>'
        + '<p class="muted" style="margin-top:12px">不想用 AI 也行：在导入页切到「手动添加」逐门录入，'
        + '或者让同学发你一份配置文件直接导入。</p>';
    }
    return '<h2 class="ob-step-title">可以开始用了</h2>'
      + '<p class="ob-step-sub">几个常用入口，忘了也不怕，设置里都能找到。</p>'
      + '<div class="ob-features">'
      + '<div class="ob-feature"><div class="icon">🎨</div><div class="t">外观</div><div class="d">深浅色、主题色、毛玻璃强度、动画速度、震动反馈都在「设置 → 外观」</div></div>'
      + '<div class="ob-feature"><div class="icon">🔄</div><div class="t">换设备</div><div class="d">「导入 → 配置文件」导出，在另一台设备导入即可</div></div>'
      + '<div class="ob-feature"><div class="icon">🎓</div><div class="t">考试 / 讲座</div><div class="d">在「导入 → 手动添加」登记，本周概览会用特殊颜色标出来</div></div>'
      + '<div class="ob-feature"><div class="icon">❔</div><div class="t">随时回看</div><div class="d">设置 → 关于与帮助 → 重新观看引导</div></div>'
      + '</div>';
  }

  function presetCard(value, name, desc) {
    var cur = S.settings.layout.preset;
    var norm = (cur === 'stacked-vertical') ? 'stacked-vertical' : 'dual-horizontal';
    var active = (norm === value);
    var thumb = (value === 'stacked-vertical')
      ? '<div class="preset-thumb col">'
        + '<div class="tb" style="flex:1"></div><div class="tb" style="flex:1.8"></div><div class="tb" style="flex:1"></div></div>'
      : '<div class="preset-thumb">'
        + '<div class="tb-col"><div class="tb" style="flex:1"></div><div class="tb" style="flex:1.6"></div></div>'
        + '<div class="tb" style="flex:1.2"></div></div>';
    return '<div class="preset-card' + (active ? ' active' : '') + '" data-preset="' + value + '">'
      + thumb
      + '<div class="name">' + esc(name) + '</div><div class="desc">' + esc(desc) + '</div></div>';
  }

  function bindOnboarding() {
    var card = $('obCard');
    var prev = card.querySelector('#obPrev');
    if (prev) { prev.addEventListener('click', function () { obStep--; renderOnboarding(); }); }
    var next = card.querySelector('#obNext');
    if (next) {
      var pressTimer = null;
      var didSkip = false;
      var cancelPress = function () { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } };
      // 长按「下一步」直接跳过整套引导（隐藏手势：界面上没有跳过按钮，也不做任何提示）
      next.addEventListener('pointerdown', function () {
        didSkip = false;
        cancelPress();
        pressTimer = setTimeout(function () {
          pressTimer = null;
          didSkip = true;
          AR.Bridge.haptic('heavy', next);
          finishOnboarding(true);
        }, 620);
      });
      next.addEventListener('pointerup', cancelPress);
      next.addEventListener('pointerleave', cancelPress);
      next.addEventListener('pointercancel', cancelPress);
      next.addEventListener('click', function () {
        if (didSkip) { didSkip = false; return; }   // 长按跳过之后紧跟的那次 click 不再前进一步
        saveOnboardingStep();
        AR.Bridge.haptic('light', next);
        if (obStep >= OB_STEPS - 1) { finishOnboarding(false); return; }
        obStep++;
        renderOnboarding();
      });
    }
    // 第 4 步：布局卡片
    var cards = card.querySelectorAll('.preset-card');
    for (var i = 0; i < cards.length; i++) {
      cards[i].addEventListener('click', function (ev) {
        var v = ev.currentTarget.getAttribute('data-preset');
        S.settings.layout.preset = v;
        AR.Store.save(true);
        AR.UI.setPreset(v, true);
        for (var j = 0; j < cards.length; j++) { cards[j].classList.remove('active'); }
        ev.currentTarget.classList.add('active');
        AR.Bridge.haptic('medium', ev.currentTarget);
        drawObPreview();
      });
    }
    // 第 5 步：动作
    var cp = card.querySelector('#obCopyPrompt');
    if (cp) { cp.addEventListener('click', function () { AR.Bridge.copy(AR.Prompt.text); }); }
    var gi = card.querySelector('#obGoImport');
    if (gi) {
      gi.addEventListener('click', function () {
        finishOnboarding(false);
        AR.UI.show('import');
      });
    }
    var dm = card.querySelector('#obDemo');
    if (dm) {
      dm.addEventListener('click', function () {
        var st = AR.Store.get();
        var ent = AR.MdParse.demoEntities(st);
        AR.MdParse.applyEntities(ent, st);
        refreshAll();
        AR.UI.toast('已载入演示课表');
      });
    }
    if (obStep === 3) { requestAnimationFrame(function () { drawObPreview(); }); }
  }

  function drawObPreview() {
    var box = $('obPreview');
    if (!box) { return; }
    var preset = S.settings.layout.preset;
    if (preset !== 'stacked-vertical') { preset = 'dual-horizontal'; }
    var W = box.clientWidth, H = box.clientHeight, gap = 4;
    var a, b, c;
    if (preset === 'dual-horizontal') {
      a = { l: 0, t: 0, w: W * 0.62, h: H * 0.42 };
      b = { l: 0, t: H * 0.42 + gap, w: W * 0.62, h: H * 0.58 - gap };
      c = { l: W * 0.64, t: 0, w: W * 0.36, h: H };
    } else {
      a = { l: 0, t: 0, w: W, h: H * 0.26 };
      b = { l: 0, t: H * 0.26 + gap, w: W, h: H * 0.44 - gap * 2 };
      c = { l: 0, t: H * 0.72, w: W, h: H * 0.28 };
    }
    setPreview('pv-week', a);
    setPreview('pv-today', b);
    setPreview('pv-next', c);
  }

  function saveOnboardingStep() {
    if (obStep === 2) {
      var s = AR.Store.get();
      if ($('obUni')) { s.settings.integration.university = $('obUni').value; }
      if ($('obCity')) { s.settings.integration.city = $('obCity').value; }
      if ($('obStart')) {
        var sem = AR.Store.currentSemester();
        sem.startDate = $('obStart').value || sem.startDate;
      }
      AR.Store.save(true);
    }
  }

  function finishOnboarding(skipped) {
    saveOnboardingStep();
    S = AR.Store.get();
    S.settings.onboardingCompletedAt = new Date().toISOString();
    AR.Store.save(true);
    $('onboarding').hidden = true;
    AR.Bridge.haptic('medium', $('zoneNext'));
    AR.UI.applyTheme();
    AR.UI.applyLayout(true);
    AR.UI.renderToday();
    if (!skipped) { AR.UI.toast('欢迎使用 Abbey Road'); }
  }

  /* ── 通用刷新 ─────────────────────────────────────────────── */

  function refreshAll() {
    ensure();
    AR.UI.renderToday();
    AR.UI.renderWeek();
    if (AR.UI.currentView() === 'settings') { renderSettings(); }
    if (AR.UI.currentView() === 'import') { renderEventList(); }
  }

  AR.Panels = {
    renderImport: renderImport,
    renderSettings: renderSettings,
    startOnboarding: startOnboarding,
    openSemesterSetup: openSemesterSetup,
    handleJsonText: handleJsonText,
    serializeParsed: serializeParsed,
    quickAddCourse: quickAddCourse,
    quickAddEvent: quickAddEvent,
    refreshAll: refreshAll
  };
})();
