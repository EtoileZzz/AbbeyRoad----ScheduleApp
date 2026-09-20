/* ──────────────────────────────────────────────────────────────
   Abbey Road · 启动
   串起：数据加载 → 主题/毛玻璃/动效 → 界面渲染 → 首次引导
   并接好来自原生外壳的回调（文件、导出、返回键、尺寸变化）
   ────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  var U = AR.Util;

  /* 文件导入：JSON 与 Markdown 自动分流 */
  AR.onFileText = function (text, name) {
    var t = String(text == null ? '' : text);
    while (t.charCodeAt(0) === 0xFEFF) { t = t.slice(1); }     // 去掉 UTF-8 BOM
    var head = t.replace(/^\s+/, '').charAt(0);
    // 只有「以 { 开头的配置文件」走 JSON 流程；以 [ 开头的是 AI 常给的 JSON 数组，
    // 交给课表文本解析器更合适（它认 JSON 数组）。
    var isJson = (/\.json$/i.test(name || '') && head === '{') || head === '{';
    AR.UI.show('import');
    setTimeout(function () {
      if (isJson) {
        var tab = document.querySelector('[data-tab="json"]');
        if (tab) { tab.click(); }
        var ok = AR.ConfigIO
          ? AR.ConfigIO.importFromText(t, name || '导入的配置文件')
          : AR.Panels.handleJsonText(t, name || '导入的配置文件');
        if (ok) { AR.UI.toast('已读取配置文件，确认预览后点「合并导入」'); }
      } else {
        var tab2 = document.querySelector('[data-tab="md"]');
        if (tab2) { tab2.click(); }
        var input = document.getElementById('mdInput');
        input.value = t;
        // 触发一次输入事件，让解析流程跑起来
        var ev = document.createEvent('Event');
        ev.initEvent('input', true, true);
        input.dispatchEvent(ev);
        AR.UI.toast('已读取 ' + (name || '课表文本'));
      }
    }, 140);
  };

  AR.onExported = function (name) {
    AR.UI.toast('已保存：' + name);
  };

  /** 桌面卡片点进来：直接切到对应的一屏 */
  AR.onOpenView = function (view) {
    if (!view) { return; }
    AR.UI.show(view);
    AR.UI.toast(view === 'week' ? '已打开周表' : '已打开今天');
  };

  /* Android 返回键 / Windows Esc 之外的返回动作 */
  AR.onBack = function () {
    if (AR.UI.modalOpen()) { AR.UI.closeModal(); return; }
    var ob = document.getElementById('onboarding');
    if (ob && !ob.hidden) { return; }          // 引导中不退出
    if (AR.UI.currentView() !== 'today') { AR.UI.show('today'); return; }
    AR.Bridge.exitApp();
  };

  function start() {
    try {
      AR.UI.init();
    } catch (e) {
      console.error('初始化失败', e);
      document.body.innerHTML = '<pre style="padding:24px;font-size:13px;white-space:pre-wrap">'
        + 'Abbey Road 启动失败：\n' + (e && e.stack ? e.stack : e) + '</pre>';
      return;
    }

    var S = AR.Store.get();
    S.device = S.device || {};
    if (AR.Bridge.deviceName()) { S.device.name = AR.Bridge.deviceName(); }
    S.device.platform = AR.Bridge.platform();
    AR.Store.save();

    if (!S.settings.onboardingCompletedAt) {
      setTimeout(function () { AR.Panels.startOnboarding(false); }, 260);
    } else {
      AR.Panels.refreshAll();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
