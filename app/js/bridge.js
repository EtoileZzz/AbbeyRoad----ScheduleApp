/* ──────────────────────────────────────────────────────────────
   Abbey Road · 平台桥
   同一套调用方式，三种后端：
     · Android：window.ARBridge（Java @JavascriptInterface，同步返回）
     · Windows：window.chrome.webview（WebView2 postMessage，异步回包）
     · 浏览器：降级实现（用于本地预览）
   方法名两端保持一致，见 android/MainActivity.java 与 windows/Bridge.cs。
   ────────────────────────────────────────────────────────────── */

var AR = window.AR || (window.AR = {});

(function () {
  'use strict';

  var hasAndroid = (typeof window.ARBridge !== 'undefined' && window.ARBridge);
  var hasWebView2 = !!(window.chrome && window.chrome.webview && window.chrome.webview.postMessage);
  var PLATFORM = hasAndroid ? 'android' : (hasWebView2 ? 'windows' : 'web');

  var seq = 0;
  var pending = {};

  if (hasWebView2) {
    window.chrome.webview.addEventListener('message', function (ev) {
      var msg = ev.data;
      if (typeof msg === 'string') {
        try { msg = JSON.parse(msg); } catch (e) { return; }
      }
      if (!msg) { return; }
      if (msg.replyTo && pending[msg.replyTo]) {
        var p = pending[msg.replyTo];
        delete pending[msg.replyTo];
        if (msg.error) { p.reject(new Error(msg.error)); } else { p.resolve(msg.result); }
        return;
      }
      dispatch(msg);
    });
  }

  /** 宿主主动推来的事件：文件名、导出完成、返回键、窗口尺寸变化 */
  function dispatch(msg) {
    if (!msg || !msg.event) { return; }
    if (msg.event === 'fileText' && AR.onFileText) { AR.onFileText(msg.text, msg.name); }
    else if (msg.event === 'exported' && AR.onExported) { AR.onExported(msg.name); }
    else if (msg.event === 'back' && AR.onBack) { AR.onBack(); }
    else if (msg.event === 'resize' && AR.onResize) { AR.onResize(); }
    else if (msg.event === 'theme' && AR.onSystemTheme) { AR.onSystemTheme(msg.dark); }
  }

  /** 统一调用入口 */
  function call(method, args) {
    args = args || [];
    if (hasAndroid) {
      try {
        var fn = window.ARBridge[method];
        if (typeof fn === 'function') {
          return Promise.resolve(fn.apply(window.ARBridge, args));
        }
      } catch (e) {
        console.warn('bridge call failed: ' + method, e);
      }
      return Promise.resolve(null);
    }
    if (hasWebView2) {
      var id = 'c' + (++seq);
      return new Promise(function (resolve, reject) {
        pending[id] = { resolve: resolve, reject: reject };
        try {
          window.chrome.webview.postMessage(JSON.stringify({ id: id, method: method, args: args }));
        } catch (e) {
          delete pending[id];
          reject(e);
        }
        setTimeout(function () {
          if (pending[id]) { delete pending[id]; resolve(null); }
        }, 8000);
      });
    }
    return Promise.resolve(null);
  }

  /* ── 触觉反馈 ─────────────────────────────────────────────── */

  var HAPTIC = {
    tap: { ms: 12, amp: 55 },          // 切换日期这类"高频但要有手感"的轻点反馈
    light: { ms: 8, amp: 40 },
    medium: { ms: 20, amp: 100 },
    heavy: { ms: 30, amp: 180 },
    warn: { ms: 10, amp: 120 }
  };

  var INTENSITY = { weak: 0.45, medium: 1, strong: 1.8 };
  var lastHaptic = 0;

  /**
   * 重要操作反馈：Android 真震动；Windows 视觉脉冲 + 可选系统音；浏览器只做视觉。
   * kind: light | medium | heavy | warn
   */
  function haptic(kind, targetEl) {
    kind = HAPTIC[kind] ? kind : 'light';
    var st = (AR.Store.get().settings.haptics) || { enabled: true, intensity: 'medium' };
    var now = Date.now();
    if (now - lastHaptic < 60) { return; }   // 60ms 节流，防空震
    lastHaptic = now;

    // 规格书 4.15：只有"主要操作"才震动（28ms 级），导航/滑块这类只有光效
    var shouldBuzz = (kind === 'tap' || kind === 'medium' || kind === 'heavy' || kind === 'warn');
    if (st.enabled && hasAndroid && shouldBuzz) {
      var spec = HAPTIC[kind];
      var amp = Math.round(spec.amp * (INTENSITY[st.intensity] || 1));
      call('vibrate', [spec.ms, Math.max(1, Math.min(255, amp))]);
    } else if (st.enabled && hasWebView2 && shouldBuzz) {
      call('beep', [kind]);
    }
    // 视觉反馈：两端都有（Windows 是主要反馈，Android 作为叠加动效）
    visualPulse(kind, targetEl);
  }

  function visualPulse(kind, el) {
    // el === false：只震动、不要视觉脉冲（弹窗自己已经有进出场动画，叠加会打架）
    if (el === false) { return; }
    var t = el || document.getElementById('zoneNext');
    if (!t) { return; }
    var cls = (kind === 'warn') ? 'shake' : 'pulse';
    t.classList.remove(cls);
    // 强制回流，保证连续点击也能重放动画
    void t.offsetWidth;
    t.classList.add(cls);
    setTimeout(function () { t.classList.remove(cls); }, 220);
  }

  /* ── 系统集成 ─────────────────────────────────────────────── */

  function copy(text) {
    if (hasAndroid || hasWebView2) {
      call('copy', [text]).then(function () {
        if (AR.UI && AR.UI.toast) { AR.UI.toast('已复制'); }
      });
      return;
    }
    // 浏览器兜底
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text);
      } else {
        var ta = document.createElement('textarea');
        ta.value = text; document.body.appendChild(ta); ta.select();
        document.execCommand('copy'); document.body.removeChild(ta);
      }
      if (AR.UI && AR.UI.toast) { AR.UI.toast('已复制'); }
    } catch (e) {
      if (AR.UI && AR.UI.toast) { AR.UI.toast('复制失败'); }
    }
  }

  function share(title, text) {
    if (hasAndroid || hasWebView2) { return call('shareText', [title, text]); }
    copy(text);
    return Promise.resolve(null);
  }

  function exportText(fileName, content, mime) {
    if (hasAndroid || hasWebView2) {
      return call('exportText', [fileName, content, mime || 'application/json']);
    }
    // 浏览器：直接下载
    try {
      var blob = new Blob([content], { type: (mime || 'application/json') + ';charset=utf-8' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = fileName;
      document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); document.body.removeChild(a); }, 500);
      if (AR.UI && AR.UI.toast) { AR.UI.toast('已导出 ' + fileName); }
    } catch (e) {
      if (AR.UI && AR.UI.toast) { AR.UI.toast('导出失败'); }
    }
    return Promise.resolve(null);
  }

  /**
   * 导出到微信 / 其它 App：
   *   Android —— 先把文件写进「下载/Abbey Road」，再拉起系统分享面板（选微信即可发文件）；
   *   Windows —— 没有「发到微信」的接口，降级为存到「下载」目录 + 复制内容（拖进微信或直接粘贴）；
   *   浏览器  —— 直接下载。
   */
  function shareFile(fileName, content, mime, title) {
    if (hasAndroid || hasWebView2) {
      return call('shareFile', [fileName, content, mime || 'application/json', title || '']).then(function (res) {
        if (typeof res === 'string' && res) {
          if (AR.UI && AR.UI.toast) { AR.UI.toast(res); }
        } else if (hasAndroid && AR.UI && AR.UI.toast) {
          AR.UI.toast('选微信就能把配置文件发出去');
        }
        return res;
      });
    }
    return exportText(fileName, content, mime);
  }

  function importText() {
    if (hasAndroid || hasWebView2) { return call('importText', []); }
    // 浏览器：用 input[type=file] 兜底
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.md,.txt,application/json,text/plain';
    input.onchange = function () {
      var f = input.files && input.files[0];
      if (!f) { return; }
      var reader = new FileReader();
      reader.onload = function () {
        if (AR.onFileText) { AR.onFileText(String(reader.result), f.name); }
      };
      reader.readAsText(f, 'utf-8');
    };
    input.click();
    return Promise.resolve(null);
  }

  function openUrl(url) { return call('openUrl', [url]); }

  /**
   * 列出「导出目录」里 App 自己导出的配置文件。
   * Android：媒体库里的 下载/Abbey Road；Windows：用户「下载」目录。
   * 返回 [{name, uri, size, modified}]，浏览器端没有这个能力就返回空数组。
   */
  function listExports() {
    if (!hasAndroid && !hasWebView2) { return Promise.resolve([]); }
    return call('listExports', []).then(function (res) {
      if (Array.isArray(res)) { return res; }
      if (typeof res === 'string' && res.length) {
        try { var arr = JSON.parse(res); return Array.isArray(arr) ? arr : []; } catch (e) { return []; }
      }
      return [];
    });
  }

  /** 读取清单里某个文件的文本（Android 是 content://，Windows 是本地路径） */
  function readTextUri(uri) {
    if (!uri) { return Promise.resolve(''); }
    if (!hasAndroid && !hasWebView2) { return Promise.resolve(''); }
    return call('readTextUri', [uri]).then(function (res) {
      return typeof res === 'string' ? res : '';
    });
  }

  function openMap(pref, query, webFallback) {
    return call('openMap', [pref || 'system', query, webFallback || '']);
  }

  function setAlarm(hour, minute, message) {
    return call('setAlarm', [hour, minute, message || 'Abbey Road 提醒']);
  }

  function addCalendarEvent(title, location, description, beginMs, endMs) {
    return call('addCalendarEvent', [title, location || '', description || '', beginMs, endMs]);
  }

  function setSystemBars(hex, lightIcons) {
    return call('setSystemBars', [hex, !!lightIcons]);
  }

  /** Windows 端：系统级背景材质（Mica/亚克力）跟着毛玻璃开关走；Android 端是空操作。 */
  function setBackdrop(enabled) {
    return call('setBackdrop', [!!enabled]);
  }

  function exitApp() { return call('exitApp', []); }

  function beep(kind) { return call('beep', [kind || 'light']); }

  /** 桌面卡片数据同步（Android 端落盘并刷新小组件；其它平台空操作） */
  function syncWidget(json) { return call('syncWidget', [String(json || '')]); }

  function isNative() { return hasAndroid || hasWebView2; }

  AR.Bridge = {
    /** 返回运行平台：android / windows / web */
    platform: function () { return PLATFORM; },
    isNative: isNative,
    hasAndroid: hasAndroid,
    hasWebView2: hasWebView2,
    call: call,
    haptic: haptic,
    visualPulse: visualPulse,
    copy: copy,
    share: share,
    shareFile: shareFile,
    listExports: listExports,
    readTextUri: readTextUri,
    exportText: exportText,
    importText: importText,
    openUrl: openUrl,
    openMap: openMap,
    setAlarm: setAlarm,
    addCalendarEvent: addCalendarEvent,
    setSystemBars: setSystemBars,
    setBackdrop: setBackdrop,
    exitApp: exitApp,
    beep: beep,
    syncWidget: syncWidget,
    deviceName: function () {
      if (hasAndroid && window.ARBridge.deviceName) { return window.ARBridge.deviceName(); }
      return '';
    },
    sdkInt: function () {
      if (hasAndroid && window.ARBridge.sdkInt) { return window.ARBridge.sdkInt(); }
      return 0;
    },
    appVersion: function () {
      if (hasAndroid && window.ARBridge.appVersion) { return window.ARBridge.appVersion(); }
      return AR.Const.APP_VERSION;
    }
  };
})();
