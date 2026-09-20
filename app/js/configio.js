/* ──────────────────────────────────────────────────────────────
   Abbey Road · 配置文件导入导出（v0.2.3 整块重构）

   以前这块逻辑散在 panels.js 里：导出按钮一个写法、文件导入一个写法、
   粘贴解析又一套，出了问题很难查，而且「当前学期」没跟着切 ——
   清空数据后再导入，课程其实进来了，界面却还盯着那个空学期，
   看起来就是「导入成功但一片空白」。

   现在全部收在这一个模块里，只有四条出口 / 三条入口：

     导出：exportFile()   系统「另存为」
           exportToApp()  微信 / 其它 App（存到下载目录 + 系统分享）
           copyText()     复制配置文本

     导入：openFromFile()      系统文件选择器
           openFromExports()   App 自己导出过的文件（不依赖系统选择器）
           importFromText()    粘贴的文本 / 其它 App 分享过来的文件

   合并统一走 mergePayload()：按内容指纹匹配 + 修正当前学期 + 补齐节次表。
   ────────────────────────────────────────────────────────────── */

var AR = window.AR || (window.AR = {});

(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }
  function el(html) { var d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstChild; }
  function esc(s) { return AR.Util.escapeHtml(s == null ? '' : s); }

  var pending = null;        // 预览通过、等待「合并导入」的配置对象
  var lastReport = null;     // 上一次预览的结果，用来说明「新增 / 更新」了多少

  /* ══════════════════════ 导出 ══════════════════════ */

  /** 组装要导出的对象：打上导出时间，其余交给 Store */
  function buildPayload() {
    var payload = AR.Store.exportPayload();
    payload.exportedAt = new Date().toISOString();
    payload.appVersion = AR.Const.APP_VERSION;
    var S = AR.Store.get();
    S.exportedAt = payload.exportedAt;
    AR.Store.save(true);
    return payload;
  }

  function payloadText() { return JSON.stringify(buildPayload(), null, 2); }

  /** 导出到设备（Android 走「另存为」，Windows 走保存对话框，浏览器直接下载） */
  function exportFile(btn) {
    if (btn) { AR.Bridge.haptic('medium', btn); }
    AR.Bridge.exportText(AR.Store.exportFileName(), payloadText(), 'application/json');
  }

  /**
   * 导出到微信 / 其它 App。
   * Android：先写进「下载 / Abbey Road」，再拉起系统分享面板（选微信发文件）。
   * Windows：没有发到微信的接口 → 存进「下载」并复制内容（拖进微信或直接粘贴）。
   * 浏览器：直接下载。
   */
  function exportToApp(btn) {
    if (btn) { AR.Bridge.haptic('medium', btn); }
    AR.Bridge.shareFile(AR.Store.exportFileName(), payloadText(), 'application/json', 'Abbey Road 课表配置');
  }

  function copyText(btn) {
    if (btn) { AR.Bridge.haptic('light', btn); }
    AR.Bridge.copy(payloadText());
  }

  /* ══════════════════════ 导入入口 ══════════════════════ */

  function openFromFile() { AR.Bridge.importText(); }

  /**
   * 「从导出目录导入」：把 App 自己导出过的配置文件列出来，点一条就导入。
   * 完全绕开系统文件选择器 —— 个别系统的选择器找不到刚导出的文件也能用。
   */
  function openFromExports(btn) {
    if (btn) { AR.Bridge.haptic('light', btn); }
    AR.Bridge.listExports().then(function (list) {
      if (!list || !list.length) {
        AR.UI.openModal({
          title: '还没有导出过配置文件',
          sub: '导出目录里是空的',
          body: '<p class="muted">先点「导出配置文件」或「导出到微信」，导出的文件会出现在这里，'
            + '之后换设备时点一下就能导入。</p>',
          actions: [{ label: '知道了', kind: 'primary', onClick: function (c) { c(); } }]
        });
        return;
      }
      var body = el('<div></div>');
      body.appendChild(el('<p class="muted">这些是 App 导出过的配置文件（最新的在最上面），点一条就能预览导入：</p>'));
      var box = el('<div class="export-list"></div>');
      for (var i = 0; i < list.length; i++) { box.appendChild(exportRow(list[i])); }
      body.appendChild(box);
      AR.UI.openModal({
        title: '从导出目录导入', sub: '共 ' + list.length + ' 个配置文件',
        body: body,
        actions: [{ label: '取消', onClick: function (c) { c(); } }]
      });
    });
  }

  function exportRow(rec) {
    var when = rec.modified ? new Date(rec.modified) : null;
    var whenText = when ? (when.getFullYear() + '-' + AR.Util.pad2(when.getMonth() + 1) + '-'
      + AR.Util.pad2(when.getDate()) + ' ' + AR.Util.pad2(when.getHours()) + ':' + AR.Util.pad2(when.getMinutes())) : '';
    var sizeText = rec.size ? (Math.max(1, Math.round(rec.size / 1024)) + ' KB') : '';
    var row = el('<button class="export-row" type="button">'
      + '<span class="er-name">' + esc(rec.name) + '</span>'
      + '<span class="er-meta">' + esc(whenText + (sizeText ? ' · ' + sizeText : '')) + '</span></button>');
    row.addEventListener('click', function () {
      AR.Bridge.haptic('light', row);
      AR.Bridge.readTextUri(rec.uri).then(function (text) {
        AR.UI.closeModal();
        if (!text) { AR.UI.toast('这个文件读不出来，换一个试试'); return; }
        importFromText(text, rec.name);
      });
    });
    return row;
  }

  /** 其它 App / 网页把文本交过来（分享、用其他应用打开、拖文件进来都走这里） */
  function importFromText(text, sourceName) {
    var S = AR.Store.get();
    if (AR.UI.currentView && AR.UI.currentView() !== 'import') { AR.UI.show('import'); }
    var tab = document.querySelector('[data-tab="json"]');
    if (tab) { tab.click(); }
    var ok = previewText(text, sourceName);
    if (ok) {
      AR.UI.toast('已读取 ' + (sourceName || '配置文本') + '，确认预览后点「合并导入」');
    }
    return ok;
  }

  /* ══════════════════════ 预览 ══════════════════════ */

  function cleanText(text) {
    var t = String(text == null ? '' : text);
    while (t.charCodeAt(0) === 0xFEFF) { t = t.slice(1); }
    return t.replace(/^\uFEFF/, '').trim();
  }

  function hooks() {
    return {
      summary: $('jsonSummary'), issues: $('jsonIssues'),
      input: $('jsonInput'), apply: $('btnApplyJson')
    };
  }

  /** 看起来像课表文本（不是配置文件）就转给「课表文本」页，别让用户卡住 */
  function looksLikeTimetableText(t) {
    if (!t) { return false; }
    if (/AbbeyRoad\s*课表/.test(t)) { return true; }
    if (/^\s*\[/.test(t)) { return true; }
    if (/[｜|]/.test(t) && /周[一二三四五六日天]/.test(t)) { return true; }
    return false;
  }

  function routeToText(text, sourceName) {
    var tab = document.querySelector('[data-tab="md"]');
    if (tab) { tab.click(); }
    var input = $('mdInput');
    if (input) {
      input.value = text;
      var ev = document.createEvent('Event');
      ev.initEvent('input', true, true);
      input.dispatchEvent(ev);
    }
    if ($('jsonSummary')) { $('jsonSummary').innerHTML = '<span class="tag warn">已按课表文本处理</span>'; }
    if ($('jsonIssues')) {
      $('jsonIssues').innerHTML = '<div class="issue info"><span class="msg">'
        + esc(sourceName || '这段内容') + '看起来不是配置文件，已放到「课表文本」里按课表解析。</span></div>';
    }
    AR.UI.toast('已转到「课表文本」');
  }

  /**
   * 校验 + 预览。成功返回 true，并把 pending 交给「合并导入」。
   * 失败会把原因写在预览区（而不是只弹一个 toast 就没了）。
   */
  function previewText(text, sourceName) {
    var h = hooks();
    if (!h.summary) { return false; }
    var clean = cleanText(text);
    if (!clean) {
      h.summary.innerHTML = '<span class="tag danger">没有内容</span>';
      h.issues.innerHTML = '<div class="issue error"><span class="msg">内容为空，请确认文件或粘贴内容是否完整。</span></div>';
      return false;
    }

    var data = null;
    try {
      data = JSON.parse(clean);
    } catch (e) {
      if (looksLikeTimetableText(clean)) { pending = null; routeToText(clean, sourceName); return false; }
      h.summary.innerHTML = '<span class="tag danger">解析失败</span>';
      h.issues.innerHTML = '<div class="issue error"><span class="code-badge">E100</span>'
        + '<span class="msg">这不是合法的配置文件（JSON 格式错误）。请确认复制 / 导出时内容完整；'
        + '如果这是 AI 给的课表文本，请改用「2 课表文本」页导入。</span></div>';
      AR.UI.toast('不是配置文件，请检查内容');
      return false;
    }

    if (!data || data.kind !== 'abbeyroad.sync') {
      if (looksLikeTimetableText(clean) || Object.prototype.toString.call(data) === '[object Array]') {
        pending = null;
        routeToText(clean, sourceName);
        return false;
      }
      h.summary.innerHTML = '<span class="tag danger">不是 Abbey Road 配置文件</span>';
      h.issues.innerHTML = '<div class="issue error"><span class="code-badge">E101</span>'
        + '<span class="msg">这个 JSON 里没有 kind = abbeyroad.sync 标记，不是本 App 导出的配置文件。</span></div>';
      return false;
    }

    var report;
    try {
      report = AR.Store.previewMerge(data);
    } catch (e) {
      h.summary.innerHTML = '<span class="tag danger">配置文件读不了</span>';
      h.issues.innerHTML = '<div class="issue error"><span class="code-badge">E102</span>'
        + '<span class="msg">' + esc(e && e.message ? e.message : String(e)) + '</span></div>';
      return false;
    }

    pending = data;
    lastReport = report;

    h.summary.innerHTML = '';
    h.summary.appendChild(el('<span class="tag success">新增 ' + report.added + '</span>'));
    h.summary.appendChild(el('<span class="tag">更新 ' + report.updated + '</span>'));
    if (report.matched) { h.summary.appendChild(el('<span class="tag">按内容合并 ' + report.matched + '</span>')); }
    if (report.removed) { h.summary.appendChild(el('<span class="tag warn">删除 ' + report.removed + '</span>')); }
    h.summary.appendChild(el('<span class="muted">来源：' + esc(sourceName || '文件') + '</span>'));

    var list = h.issues;
    list.innerHTML = '';
    if (report.unknown && report.unknown.length) {
      for (var i = 0; i < report.unknown.length; i++) {
        list.appendChild(el('<div class="issue"><span class="code-badge">W200</span><span class="msg">'
          + esc(report.unknown[i]) + '</span></div>'));
      }
    }
    var shown = 0;
    for (var d = 0; d < report.details.length && shown < 20; d++) {
      var det = report.details[d];
      list.appendChild(el('<div class="list-item"><span class="code-badge">'
        + (det.action === 'add' ? '新增' : (det.action === 'conflict' ? '冲突' : '更新'))
        + '</span><span class="msg">' + esc(det.table) + ' · ' + esc(det.label) + '</span></div>'));
      shown++;
    }
    if (!report.added && !report.updated && !report.conflicts) {
      list.appendChild(el('<div class="issue info"><span class="msg">两边数据一致，不需要变更。点「合并导入」也不会重复添加。</span></div>'));
    }
    if (h.apply) { h.apply.disabled = false; }
    return true;
  }

  /* ══════════════════════ 合并 ══════════════════════ */

  /**
   * 真正把预览过的配置合并进本机数据。
   * 除了 Store.applyMerge，还负责：
   *   · 当前学期纠偏（导入后能立刻看到课，而不是一片空白）
   *   · 节次表按实际用到的节数补足（第 13 节及以后）
   *   · 刷新界面并跳到「今日」，让用户马上确认导入结果
   */
  function mergePayload(payload) {
    if (!payload || payload.kind !== 'abbeyroad.sync') {
      return { ok: false, message: '不是 Abbey Road 配置文件' };
    }
    var semBefore = AR.Store.currentSemester();
    var periodsBefore = AR.Store.periodsOf(semBefore ? semBefore.id : null).length;
    var coursesBefore = AR.Store.get().courses.length;

    AR.Store.applyMerge(payload, {});

    var semAfter = AR.Store.currentSemester();
    var periodsAfter = AR.Store.periodsOf(semAfter ? semAfter.id : null).length;
    var S = AR.Store.get();
    return {
      ok: true,
      courses: S.courses.length,
      addedCourses: S.courses.length - coursesBefore,
      blocks: S.blocks.length,
      semester: semAfter ? semAfter.name : '',
      semesterSwitched: !!(semBefore && semAfter && semBefore.id !== semAfter.id),
      periodsAdded: Math.max(0, periodsAfter - periodsBefore)
    };
  }

  /** 「合并导入」按钮：把预览过的配置合并进来 */
  function apply(btn) {
    var h = hooks();
    var payload = pending;
    if (!payload) {
      var txt = cleanText(h.input ? h.input.value : '');
      if (!txt) { AR.UI.toast('请先选择配置文件，或把配置文本粘贴到上面'); return false; }
      if (!previewText(txt, '粘贴的配置文本')) { return false; }
      payload = pending;
    }
    if (!payload) { return false; }
    if (btn) { AR.Bridge.haptic('medium', btn); }

    var res = mergePayload(payload);
    pending = null;
    lastReport = null;
    if (h.input) { h.input.value = ''; }
    if (h.apply) { h.apply.disabled = true; }

    if (!res.ok) {
      AR.UI.toast(res.message || '导入失败');
      return false;
    }

    var msg = '已导入：课程 ' + res.courses + ' 门 · 时段 ' + res.blocks + ' 条';
    if (res.semester) { msg += ' · 当前学期「' + res.semester + '」'; }
    AR.UI.toast(msg);
    if (res.periodsAdded) {
      AR.UI.toast('有课排在第 12 节之后，节次表已自动扩到 ' + (AR.Store.periodsOf(
        (AR.Store.currentSemester() || {}).id).length) + ' 节（时间可在设置里改）');
    }

    if (h.summary) {
      h.summary.innerHTML = '<span class="tag success">合并完成</span>'
        + '<span class="muted">' + esc(msg.replace('已导入：', '')) + '</span>';
    }
    if (h.issues) { h.issues.innerHTML = ''; }

    if (AR.Panels && AR.Panels.refreshAll) { AR.Panels.refreshAll(); }
    AR.UI.renderToday();
    AR.UI.show('today');      // 导完直接看课表，别让用户以为没导进去
    return true;
  }

  function hasPending() { return !!pending; }

  /** 清空待合并状态（「清空」按钮用） */
  function reset() {
    pending = null;
    lastReport = null;
    var b = $('btnApplyJson');
    if (b) { b.disabled = true; }
  }

  AR.ConfigIO = {
    buildPayload: buildPayload,
    payloadText: payloadText,
    exportFile: exportFile,
    exportToApp: exportToApp,
    copyText: copyText,
    openFromFile: openFromFile,
    openFromExports: openFromExports,
    importFromText: importFromText,
    previewText: previewText,
    mergePayload: mergePayload,
    apply: apply,
    hasPending: hasPending,
    reset: reset
  };
})();
